const express = require('express');
const { Enquiry, EnquiryItem, Product, Customer, Notification, User, Query, VendorQuotation, AuditLog } = require('../db');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { isValidId, asString, toPositive, toNonNegative } = require('../middleware/validate');
const { createEnquiryWithNumber } = require('../utils/enquiryNumber');
const { effectiveLanding, allowedLinks } = require('../constants/permissions');
const { audit, inr } = require('../utils/audit');

const router = express.Router();

const STAGES = ['new', 'open', 'updated', 'completed'];
// How many closed enquiries the list sends (all open ones are always sent)
const CLOSED_LIST_CAP = Number(process.env.CLOSED_LIST_CAP || 1500);
const CLOSED_ITEM_STATUSES = ['completed', 'unsuccessful'];
const CLOSED_ENQUIRY_STATUSES = ['completed', 'unsuccessful', 'closed'];
// Items that are still waiting for (re)assignment
const UNCLAIMED = ['unassigned', 'pending'];

// Every :id / :itemId in this router is an ObjectId; a malformed one is a 400, not a CastError 500
router.param('id', (req, res, next, value) => (isValidId(value) ? next() : res.status(400).json({ error: 'Invalid enquiry id' })));
router.param('itemId', (req, res, next, value) => (isValidId(value) ? next() : res.status(400).json({ error: 'Invalid item id' })));

// ── Helpers ──────────────────────────────────────────────────────────────────

// Which enquiries can this person see? Every "see" permission they have adds to the list; having one
// never takes another away. (It used to be "first match wins", so adding the purchase permission to a sales
// role silently hid their own enquiries.)
const buildVisibilityQuery = async (user) => {
    const perms = user.permissions || [];

    if (perms.includes('enquiry.view.all')) {
        return {}; // sees everything
    }

    const either = [];

    if (perms.includes('enquiry.view.own')) {
        either.push({ createdBy: user.id });
    }

    if (perms.includes('enquiry.view.assigned_customers')) {
        const kamCustomers = await Customer.find({ assignedKAM: user.id }).select('_id');
        either.push({ customerId: { $in: kamCustomers.map(c => c._id) } });
    }

    if (perms.includes('enquiry.view.assigned') || perms.includes('enquiry.self_assign')) {
        // Purchase work: items assigned to them, plus enquiries that still have an unclaimed item (the waiting list).
        // The database returns just the distinct enquiry ids (not every item) and both questions run together.
        const [assigned, unclaimed] = await Promise.all([
            EnquiryItem.distinct('enquiryId', { assignedTo: user.id }),
            EnquiryItem.distinct('enquiryId', { status: { $in: UNCLAIMED } }),
        ]);
        either.push({ _id: { $in: [...assigned, ...unclaimed] } });
    }

    if (either.length === 0) return { _id: null }; // sees nothing
    return either.length === 1 ? either[0] : { $or: either };
};

// Purchase work can be handed to anyone whose role can enter vendor prices
const canTakeWork = (user) => !!(user.roleId && (user.roleId.permissions || []).includes('purchase_price.add'));

const hasViewPermission = (user) => {
    const perms = user.permissions || [];
    return perms.some(p => p.startsWith('enquiry.view')) || perms.includes('enquiry.self_assign');
};

// Find an enquiry only if this user is allowed to see it (the list is filtered by visibility,
// but fetching one by id used to skip that check entirely).
const findVisibleEnquiry = async (user, enquiryId) => {
    const visibility = await buildVisibilityQuery(user);
    return Enquiry.findOne({ $and: [{ _id: enquiryId }, visibility] });
};

// Load an item, making sure it actually belongs to the enquiry in the URL.
// Sends the error response itself and returns null when it can't be used.
const loadItem = async (req, res) => {
    const item = await EnquiryItem.findOne({ _id: req.params.itemId, enquiryId: req.params.id });
    if (!item) {
        res.status(404).json({ error: 'Item not found in this enquiry' });
        return null;
    }
    return item;
};

// Send a query notification to all relevant parties (except the sender)
const notifyQueryRecipients = async ({ enquiryId, senderId, enquiryNumber, senderName }) => {
    const enquiry = await Enquiry.findById(enquiryId);
    if (!enquiry) return;

    const recipients = new Set();

    if (enquiry.createdBy && enquiry.createdBy.toString() !== senderId) {
        recipients.add(enquiry.createdBy.toString());
    }
    if (enquiry.assignedTo && enquiry.assignedTo.toString() !== senderId) {
        recipients.add(enquiry.assignedTo.toString());
    }

    const items = await EnquiryItem.find({
        enquiryId,
        assignedTo: { $exists: true, $ne: null },
    }).select('assignedTo');

    for (const item of items) {
        if (item.assignedTo.toString() !== senderId) {
            recipients.add(item.assignedTo.toString());
        }
    }

    // Send each person to the screen their role starts on
    const recipientUsers = await User.find({ _id: { $in: [...recipients] } }).populate('roleId');

    for (const u of recipientUsers) {
        const page = (u.roleId && effectiveLanding(u.roleId)) || 'sales.html';
        await Notification.create({
            userId: u._id,
            message: `New query from ${senderName} on ${enquiryNumber}`,
            type: 'info',
            link: `/${page}?enquiryId=${enquiryId}`,
        });
    }
};

// What a person would call an item: its material
const itemName = async (item) => {
    const product = await Product.findById(item.productId).select('materialName');
    return product ? product.materialName : 'an item';
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Recompute and save enquiry status based on current item statuses
const syncEnquiryStatus = async (enquiryId) => {
    const allItems = await EnquiryItem.find({ enquiryId });
    if (!allItems.length) return;

    const allClosed = allItems.every(i => CLOSED_ITEM_STATUSES.includes(i.status));
    if (!allClosed) return;

    const allCompleted    = allItems.every(i => i.status === 'completed');
    const allUnsuccessful = allItems.every(i => i.status === 'unsuccessful');
    const finalStatus = allCompleted ? 'completed' : allUnsuccessful ? 'unsuccessful' : 'closed';
    await Enquiry.findByIdAndUpdate(enquiryId, { status: finalStatus, stage: 'completed', closedAt: new Date() });
};

// Managers (enquiry.assign) and the purchase team (self_assign) hear about a new enquiry.
// Awaited by the caller: on Vercel the function can be frozen the moment the response is sent,
// which silently dropped these when they ran in the background.
const notifyNewEnquiry = async ({ enquiry, creatorId, customerName, creatorName }) => {
    try {
        const allUsers = await User.find({ _id: { $ne: creatorId } }).select('_id').populate({
            path: 'roleId',
            select: 'permissions',
        });
        const notifs = [];
        for (const u of allUsers) {
            const perms    = u.roleId?.permissions || [];
            const isManager  = perms.includes('enquiry.assign');
            const isPurchase = perms.includes('enquiry.self_assign');
            if (!isManager && !isPurchase) continue;
            notifs.push({
                userId:  u._id,
                message: isManager
                    ? `New enquiry ${enquiry.enquiryNumber} created by ${creatorName} for ${customerName} — ready to assign`
                    : `New items available to claim in ${enquiry.enquiryNumber} (${customerName})`,
                type: 'info',
                link: isPurchase && !isManager
                    ? '/sourcing.html'
                    : `/sales.html?enquiryId=${enquiry._id}`,
            });
        }
        if (notifs.length) await Notification.insertMany(notifs);
    } catch (e) {
        // A notification failure must never fail (or roll back) the enquiry itself
        console.error('Enquiry notification error:', e.message);
    }
};

// Enquiry plus its items, populated the way the screens expect
const enquiryWithItems = async (enquiryId) => {
    const [enquiry, items] = await Promise.all([
        Enquiry.findById(enquiryId)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone'),
        EnquiryItem.find({ enquiryId }).populate('productId').populate('assignedTo', 'name email'),
    ]);
    return enquiry ? { ...enquiry.toObject(), items } : null;
};

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/enquiries — list enquiries (filtered by permissions + optional stage/user filters)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const perms = req.user.permissions || [];

        if (!hasViewPermission(req.user)) return res.status(403).json({ error: 'Permission required: enquiry.view.*' });

        // Every clause is ANDed with the user's visibility, so a filter can narrow the list but
        // never widen it beyond what that user is allowed to see.
        const filters = [await buildVisibilityQuery(req.user)];

        // Query-string values must be plain strings: ?stage[$ne]=x would otherwise reach Mongo as an operator
        if (req.query.stage !== undefined) {
            const stage = asString(req.query.stage);
            if (!STAGES.includes(stage)) return res.status(400).json({ error: `stage must be one of: ${STAGES.join(', ')}` });
            filters.push({ stage });
            filters.push(stage === 'completed' ? { status: { $in: CLOSED_ENQUIRY_STATUSES } } : { status: 'active' });
        }

        if (req.query.sourcingUser !== undefined && perms.includes('filter.by_sourcing_user')) {
            const sourcingUser = asString(req.query.sourcingUser);
            if (!isValidId(sourcingUser)) return res.status(400).json({ error: 'Invalid sourcingUser' });
            const assignedItems = await EnquiryItem.find({ assignedTo: sourcingUser }).select('enquiryId');
            const ids = assignedItems.map(i => i.enquiryId);
            filters.push({ $or: [{ assignedTo: sourcingUser }, { _id: { $in: ids } }] });
        }

        if (req.query.kamUser !== undefined && perms.includes('filter.by_key_account_manager')) {
            const kamUser = asString(req.query.kamUser);
            if (!isValidId(kamUser)) return res.status(400).json({ error: 'Invalid kamUser' });
            const kamCustomers = await Customer.find({ assignedKAM: kamUser }).select('_id');
            filters.push({ customerId: { $in: kamCustomers.map(c => c._id) } });
        }

        // Open enquiries are the work in hand, so all of them are always sent. Closed ones are history and are sent
        // newest first up to a cap, so the list stays quick (and under a hosted function's response-size limit) however
        // long the app has been in use. The headers say how many exist so the screen can tell people when some are left out.
        const openFilter = { $and: [...filters, { status: { $nin: CLOSED_ENQUIRY_STATUSES } }] };
        const closedFilter = { $and: [...filters, { status: { $in: CLOSED_ENQUIRY_STATUSES } }] };
        const [openList, closedList, closedTotal] = await Promise.all([
            Enquiry.find(openFilter),
            Enquiry.find(closedFilter).sort({ createdAt: -1 }).limit(CLOSED_LIST_CAP),
            Enquiry.countDocuments(closedFilter),
        ]);
        const enquiries = [...openList, ...closedList].sort((a, b) => b.createdAt - a.createdAt);
        res.set('X-Total-Count', String(openList.length + closedTotal));
        res.set('X-Returned-Count', String(enquiries.length));

        // Items and chat counts for every enquiry at once
        const enquiryIds = enquiries.map(e => e._id);
        const [allItems, queryCounts] = await Promise.all([
            EnquiryItem.find({ enquiryId: { $in: enquiryIds } }),
            Query.aggregate([
                { $match: { enquiryId: { $in: enquiryIds } } },
                { $group: { _id: '$enquiryId', count: { $sum: 1 } } },
            ]),
        ]);

        // Everything the rows refer to (people, customers, materials, chosen quotes) is fetched in ONE query per kind
        // and attached here, instead of one lookup per kind per list. Same shape the screens always received.
        const ids = (list) => [...new Set(list.filter(Boolean).map(String))];
        const [people, customers, products, quotes] = await Promise.all([
            User.find({ _id: { $in: ids([...enquiries.flatMap(e => [e.createdBy, e.assignedTo]), ...allItems.map(i => i.assignedTo)]) } }).select('name email').lean(),
            Customer.find({ _id: { $in: ids(enquiries.map(e => e.customerId)) } }).select('name contactPerson address email phone assignedKAM').lean(),
            Product.find({ _id: { $in: ids(allItems.map(i => i.productId)) } }).lean(),
            VendorQuotation.find({ _id: { $in: ids(allItems.map(i => i.selectedVendorQuoteId)) } }).lean(),
        ]);
        const byId = (docs) => new Map(docs.map(d => [String(d._id), d]));
        const personOf = byId(people), customerOf = byId(customers), productOf = byId(products), quoteOf = byId(quotes);
        // like a populated field: nothing set stays as it is; set to something that no longer exists becomes null
        const attach = (map, id) => (id === undefined || id === null ? id : (map.get(String(id)) || null));

        const itemsByEnquiry = new Map();
        for (const item of allItems) {
            const key = item.enquiryId.toString();
            if (!itemsByEnquiry.has(key)) itemsByEnquiry.set(key, []);
            itemsByEnquiry.get(key).push({
                ...item.toObject(),
                productId: attach(productOf, item.productId),
                assignedTo: attach(personOf, item.assignedTo),
                selectedVendorQuoteId: attach(quoteOf, item.selectedVendorQuoteId),
            });
        }
        const countByEnquiry = new Map(queryCounts.map(c => [c._id.toString(), c.count]));

        res.json(enquiries.map(enquiry => ({
            ...enquiry.toObject(),
            createdBy: attach(personOf, enquiry.createdBy),
            assignedTo: attach(personOf, enquiry.assignedTo),
            customerId: attach(customerOf, enquiry.customerId),
            items: itemsByEnquiry.get(enquiry._id.toString()) || [],
            queryCount: countByEnquiry.get(enquiry._id.toString()) || 0,
        })));
    } catch (error) {
        handleRouteError(res, error, 'list enquiries');
    }
});

// GET /api/enquiries/todo — what needs THIS person today, worked out from what their role lets them do.
// Counts only (with where to click), never the enquiries themselves, so it is cheap and shows nothing they couldn't already see.
router.get('/todo', authenticateToken, async (req, res) => {
    try {
        if (!hasViewPermission(req.user)) return res.json({ applicable: false, tasks: [], allClear: true }); // this role has no enquiry screens
        const perms = new Set(req.user.permissions || []);
        const me = String(req.user.id);

        const visible = await Enquiry.find({ $and: [await buildVisibilityQuery(req.user), { status: { $nin: CLOSED_ENQUIRY_STATUSES } }] })
            .select('_id createdAt').sort({ createdAt: -1 }).limit(5000).lean();
        const createdAt = new Map(visible.map(e => [String(e._id), e.createdAt]));
        const items = visible.length
            ? await EnquiryItem.find({ enquiryId: { $in: visible.map(e => e._id) } }).select('enquiryId status assignedTo updatedAt').lean()
            : [];

        const count = (test) => items.filter(test).length;
        const mine = (i) => i.assignedTo && String(i.assignedTo) === me;
        const tasks = [];
        // a card only links where this person can actually go (a role that can't open the page gets a plain card, never a dead end)
        const openable = new Set(allowedLinks([...perms]));
        const reach = (...hrefs) => hrefs.find(h => openable.has(h.split('?')[0])) || null;
        const add = (key, label, n, href, tone, hint) => { if (n > 0) tasks.push({ key, label, count: n, href: href ? reach(href, '/sales.html', '/sourcing.html', '/key-accounts.html', '/admin.html') : null, tone, hint }); };

        // Purchase work
        if (perms.has('purchase_price.add')) {
            add('quote', 'Items waiting for your vendor price', count(i => mine(i) && ['assigned', 'sales_query_resolved'].includes(i.status)), '/sourcing.html?tab=my_work', 'warn', 'Enter what the vendors quoted');
            add('waiting-sales', 'Questions you are waiting on sales for', count(i => mine(i) && i.status === 'in_sales_query'), '/sourcing.html?tab=my_work', 'info', 'Nothing to do until sales replies');
        }
        // Handing out work
        const unclaimed = count(i => UNCLAIMED.includes(i.status));
        if (perms.has('enquiry.assign')) add('assign', 'Items nobody has been given yet', unclaimed, '/sales.html?filter=pending', 'warn', 'Choose who should get them');
        else if (perms.has('enquiry.self_assign')) add('pickup', 'New items you can pick up', unclaimed, '/sourcing.html?tab=new_queue', 'warn', 'Claim the ones you will handle');
        // Sales work
        if (perms.has('sales_price.add')) {
            add('price', 'Vendor prices in: set your selling price', count(i => i.status === 'vendor_quoted'), '/sales.html?filter=quoted', 'warn', 'The vendors have answered');
            add('reply', 'Questions waiting for your reply', count(i => i.status === 'in_sales_query'), '/sales.html?filter=needs_response', 'danger', 'Purchase is waiting on you');
        }
        if (perms.has('quotation.send') || perms.has('quotation.download')) {
            const byEnquiry = new Map();
            for (const i of items) byEnquiry.set(String(i.enquiryId), [...(byEnquiry.get(String(i.enquiryId)) || []), i.status]);
            const ready = [...byEnquiry.values()].filter(st => st.length && st.every(x => ['priced', 'sales_priced', 'completed', 'unsuccessful'].includes(x)) && st.some(x => ['priced', 'sales_priced'].includes(x))).length;
            add('send', 'Quotations ready to send', ready, '/sales.html?filter=quoted', 'success', 'Every item is priced');
        }
        // Keeping things moving (people who see everything)
        if (perms.has('enquiry.view.all') || perms.has('dashboard.admin')) {
            const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
            const stalled = visible.filter(e => new Date(e.createdAt).getTime() < cutoff).length;
            add('stalled', 'Enquiries open for more than 3 days', stalled, perms.has('dashboard.admin') ? '/admin.html' : '/sales.html', 'danger', 'Worth a nudge');
        }

        res.json({ applicable: true, tasks, allClear: tasks.length === 0 });
    } catch (error) {
        handleRouteError(res, error, 'todo');
    }
});

// GET /api/enquiries/:id — fetch single enquiry with items
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        if (!hasViewPermission(req.user)) return res.status(403).json({ error: 'Permission required: enquiry.view.*' });

        // Same visibility rules as the list (a 404, not a 403, so ids can't be probed)
        const visible = await findVisibleEnquiry(req.user, req.params.id);
        if (!visible) return res.status(404).json({ error: 'Enquiry not found' });

        const enquiry = await Enquiry.findById(req.params.id)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone assignedKAM');

        const [items, queryCount] = await Promise.all([
            EnquiryItem.find({ enquiryId: enquiry._id })
                .populate('productId')
                .populate('assignedTo', 'name email')
                .populate('selectedVendorQuoteId'),
            Query.countDocuments({ enquiryId: enquiry._id }),
        ]);

        res.json({ ...enquiry.toObject(), items, queryCount });
    } catch (error) {
        handleRouteError(res, error, 'get enquiry');
    }
});

// POST /api/enquiries — create enquiry
router.post('/', authenticateToken, requirePermission('enquiry.create'), async (req, res) => {
    try {
        const { customerId, items } = req.body;

        if (!customerId) return res.status(400).json({ error: 'Customer ID is required' });
        if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one item is required' });

        // Validate everything up front so we never leave a half-created enquiry behind
        if (!isValidId(customerId)) return res.status(400).json({ error: 'Invalid customer' });
        const lines = [];
        for (const item of items) {
            if (!item || !isValidId(item.productId)) return res.status(400).json({ error: 'Every item needs a valid product' });
            const quantity = toPositive(item.quantity);
            if (Number.isNaN(quantity)) return res.status(400).json({ error: 'Every item needs a quantity greater than 0' });
            lines.push({ productId: item.productId, quantity });
        }

        if (!(await Customer.exists({ _id: customerId }))) return res.status(400).json({ error: 'Customer not found' });
        const productIds = [...new Set(lines.map(l => l.productId))];
        if ((await Product.countDocuments({ _id: { $in: productIds } })) !== productIds.length) {
            return res.status(400).json({ error: 'One or more products no longer exist' });
        }

        const enquiry = await createEnquiryWithNumber({
            customerId,
            createdBy: req.user.id,
            stage: 'new',
        });

        try {
            await EnquiryItem.insertMany(lines.map(line => ({
                enquiryId: enquiry._id,
                productId: line.productId,
                quantity: line.quantity,
                status: 'unassigned',
            })));
        } catch (err) {
            // Never leave an enquiry with no items behind
            await Enquiry.findByIdAndDelete(enquiry._id).catch(() => {});
            await EnquiryItem.deleteMany({ enquiryId: enquiry._id }).catch(() => {});
            throw err;
        }

        const populated = await Enquiry.findById(enquiry._id)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone');

        const populatedItems = await EnquiryItem.find({ enquiryId: enquiry._id })
            .populate('productId')
            .populate('assignedTo', 'name email');

        await notifyNewEnquiry({
            enquiry,
            creatorId: req.user.id,
            customerName: populated.customerId?.name || 'Unknown customer',
            creatorName: populated.createdBy?.name || 'Someone',
        });

        await audit(req, {
            action: 'enquiry.created', entity: 'enquiry', entityId: enquiry._id, entityLabel: enquiry.enquiryNumber, enquiryId: enquiry._id,
            summary: `Created enquiry ${enquiry.enquiryNumber} for ${populated.customerId?.name || 'a customer'} with ${plural(lines.length, 'item')}`,
        });

        res.status(201).json({ ...populated.toObject(), items: populatedItems });
    } catch (error) {
        handleRouteError(res, error, 'create enquiry');
    }
});

// PUT /api/enquiries/:id/assign — assign entire enquiry to a purchase user
router.put('/:id/assign', authenticateToken, requirePermission('enquiry.assign'), async (req, res) => {
    try {
        const { sourcingUserId } = req.body;
        if (!isValidId(sourcingUserId)) return res.status(400).json({ error: 'Choose a valid person to assign to' });

        const enquiry = await Enquiry.findById(req.params.id);
        if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });
        if (CLOSED_ENQUIRY_STATUSES.includes(enquiry.status)) {
            return res.status(409).json({ error: `This enquiry is ${enquiry.status}; reopen it before assigning` });
        }

        const assignee = await User.findById(sourcingUserId).populate('roleId', 'permissions');
        if (!assignee) return res.status(404).json({ error: 'That user no longer exists' });
        if (!canTakeWork(assignee) && sourcingUserId !== req.user.id) {
            return res.status(400).json({ error: `${assignee.name} can't be given purchase work, because their role can't enter vendor prices.` });
        }

        enquiry.assignedTo = sourcingUserId;
        if (enquiry.stage === 'new') enquiry.stage = 'open';
        await enquiry.save();

        await EnquiryItem.updateMany(
            { enquiryId: enquiry._id, status: { $in: UNCLAIMED } },
            { $set: { status: 'assigned', assignedTo: sourcingUserId, assignedAt: new Date(), updatedAt: new Date() } }
        );
        await audit(req, {
            action: 'enquiry.assigned', entity: 'enquiry', entityId: enquiry._id, entityLabel: enquiry.enquiryNumber, enquiryId: enquiry._id,
            summary: `Assigned ${enquiry.enquiryNumber} to ${assignee.name}`,
        });

        await Notification.create({
            userId: sourcingUserId,
            message: `New enquiry assigned to you: ${enquiry.enquiryNumber}`,
            type: 'info',
            link: `/sourcing.html?enquiryId=${enquiry._id}`,
        });

        const populated = await Enquiry.findById(enquiry._id)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone');

        res.json(populated);
    } catch (error) {
        handleRouteError(res, error, 'assign enquiry');
    }
});

// POST /api/enquiries/:id/assign-items — assign selected items to a purchase user
router.post('/:id/assign-items', authenticateToken,
    requireAnyPermission('enquiry.assign', 'enquiry.self_assign'),
    async (req, res) => {
        try {
            const { itemIds, sourcingUserId } = req.body;

            if (!Array.isArray(itemIds) || itemIds.length === 0) return res.status(400).json({ error: 'No items selected' });
            if (!itemIds.every(isValidId)) return res.status(400).json({ error: 'Invalid item selection' });
            if (!isValidId(sourcingUserId)) return res.status(400).json({ error: 'Choose a valid person to assign to' });

            const perms = req.user.permissions || [];
            const isManager = perms.includes('enquiry.assign');

            if (!isManager && sourcingUserId !== req.user.id) {
                return res.status(403).json({ error: 'You can only self-assign items' });
            }

            const enquiry = await Enquiry.findById(req.params.id);
            if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });
            if (CLOSED_ENQUIRY_STATUSES.includes(enquiry.status)) {
                return res.status(409).json({ error: `This enquiry is ${enquiry.status}; reopen it before assigning` });
            }

            const assignee = await User.findById(sourcingUserId).populate('roleId', 'permissions');
            if (!assignee) return res.status(404).json({ error: 'That user no longer exists' });
            if (assignee.active === false) return res.status(400).json({ error: `${assignee.name}'s access is turned off, so they can't be given work.` });
            // Handing work to someone else: their role must be able to enter vendor prices. Picking it up for
            // yourself is governed by the "pick up new items" permission instead.
            if (!canTakeWork(assignee) && sourcingUserId !== req.user.id) {
                return res.status(400).json({ error: `${assignee.name} can't be given purchase work, because their role can't enter vendor prices.` });
            }

            // A manager may reassign an item that is still at the 'assigned' step. Nobody may touch an item that
            // is further along (quoted, priced, completed...) — that used to reset its status — and a self-assigning
            // purchase user may only claim items nobody has claimed yet (they used to be able to take others' items).
            const claimable = isManager ? [...UNCLAIMED, 'assigned'] : UNCLAIMED;
            const result = await EnquiryItem.updateMany(
                { _id: { $in: itemIds }, enquiryId: req.params.id, status: { $in: claimable } },
                { $set: { status: 'assigned', assignedTo: sourcingUserId, assignedAt: new Date(), updatedAt: new Date() } }
            );

            if (result.modifiedCount === 0 && result.matchedCount === 0) {
                return res.status(409).json({ error: 'None of those items can be assigned (already taken, or no longer open)' });
            }

            if (enquiry.stage === 'new') {
                await Enquiry.findByIdAndUpdate(req.params.id, { stage: 'open' });
            }

            if (sourcingUserId !== req.user.id) {
                await Notification.create({
                    userId: sourcingUserId,
                    message: `${result.modifiedCount} item(s) assigned to you`,
                    type: 'info',
                    link: `/sourcing.html?enquiryId=${req.params.id}`,
                });
            }

            await audit(req, {
                action: 'items.assigned', entity: 'enquiry', entityId: enquiry._id, entityLabel: enquiry.enquiryNumber, enquiryId: enquiry._id,
                summary: sourcingUserId === req.user.id
                    ? `Picked up ${plural(result.modifiedCount, 'item')} of ${enquiry.enquiryNumber}`
                    : `Assigned ${plural(result.modifiedCount, 'item')} of ${enquiry.enquiryNumber} to ${assignee.name}`,
            });

            res.json(await enquiryWithItems(req.params.id));
        } catch (error) {
            handleRouteError(res, error, 'assign items');
        }
    }
);

// POST /api/enquiries/assign-items — the same as /:id/assign-items, for items spread over several enquiries
// (pick items in a list, hand them all to one person). Same rules as the single-enquiry route; items that can't be
// assigned (already taken, further along, or in a closed enquiry) are skipped and counted rather than failing the lot.
router.post('/assign-items', authenticateToken,
    requireAnyPermission('enquiry.assign', 'enquiry.self_assign'),
    async (req, res) => {
        try {
            const { itemIds, sourcingUserId } = req.body || {};
            if (!Array.isArray(itemIds) || itemIds.length === 0) return res.status(400).json({ error: 'No items selected' });
            if (itemIds.length > 500) return res.status(400).json({ error: 'Select up to 500 items at a time' });
            if (!itemIds.every(isValidId)) return res.status(400).json({ error: 'Invalid item selection' });
            if (!isValidId(sourcingUserId)) return res.status(400).json({ error: 'Choose a valid person to assign to' });

            const isManager = (req.user.permissions || []).includes('enquiry.assign');
            if (!isManager && sourcingUserId !== req.user.id) {
                return res.status(403).json({ error: 'You can only self-assign items' });
            }

            const assignee = await User.findById(sourcingUserId).populate('roleId', 'permissions');
            if (!assignee) return res.status(404).json({ error: 'That user no longer exists' });
            if (assignee.active === false) return res.status(400).json({ error: `${assignee.name}'s access is turned off, so they can't be given work.` });
            if (!canTakeWork(assignee) && sourcingUserId !== req.user.id) {
                return res.status(400).json({ error: `${assignee.name} can't be given purchase work, because their role can't enter vendor prices.` });
            }

            const items = await EnquiryItem.find({ _id: { $in: itemIds } }).select('enquiryId').lean();
            const enquiries = await Enquiry.find({ _id: { $in: [...new Set(items.map(i => String(i.enquiryId)))] } }).select('enquiryNumber status').lean();
            const openIds = enquiries.filter(e => !CLOSED_ENQUIRY_STATUSES.includes(e.status)).map(e => e._id);

            const claimable = isManager ? [...UNCLAIMED, 'assigned'] : UNCLAIMED;
            const stamp = new Date();
            const result = await EnquiryItem.updateMany(
                { _id: { $in: itemIds }, enquiryId: { $in: openIds }, status: { $in: claimable } },
                { $set: { status: 'assigned', assignedTo: sourcingUserId, assignedAt: stamp, updatedAt: stamp } }
            );
            if (result.modifiedCount === 0) {
                return res.status(409).json({ error: 'None of those items can be assigned (already taken, or no longer open)' });
            }

            // which enquiries actually got items (the shared timestamp marks this batch)
            const moved = await EnquiryItem.find({ _id: { $in: itemIds }, assignedTo: sourcingUserId, assignedAt: stamp }).select('enquiryId').lean();
            const perEnquiry = new Map();
            for (const m of moved) perEnquiry.set(String(m.enquiryId), (perEnquiry.get(String(m.enquiryId)) || 0) + 1);
            await Enquiry.updateMany({ _id: { $in: [...perEnquiry.keys()] }, stage: 'new' }, { $set: { stage: 'open' } });

            if (sourcingUserId !== req.user.id) {
                await Notification.create({
                    userId: sourcingUserId,
                    message: `${result.modifiedCount} item(s) assigned to you`,
                    type: 'info',
                    link: '/sourcing.html?tab=my_work',
                });
            }
            // one line in each enquiry's history
            for (const enquiry of enquiries) {
                const count = perEnquiry.get(String(enquiry._id));
                if (!count) continue;
                await audit(req, {
                    action: 'items.assigned', entity: 'enquiry', entityId: enquiry._id, entityLabel: enquiry.enquiryNumber, enquiryId: enquiry._id,
                    summary: sourcingUserId === req.user.id
                        ? `Picked up ${plural(count, 'item')} of ${enquiry.enquiryNumber}`
                        : `Assigned ${plural(count, 'item')} of ${enquiry.enquiryNumber} to ${assignee.name}`,
                });
            }

            res.json({ assigned: result.modifiedCount, skipped: itemIds.length - result.modifiedCount, enquiries: perEnquiry.size });
        } catch (error) {
            handleRouteError(res, error, 'assign items');
        }
    }
);

// PUT /api/enquiries/:id/items/:itemId — edit quantity or delete item
router.put('/:id/items/:itemId', authenticateToken, requireAnyPermission('enquiry.create', 'enquiry.assign'), async (req, res) => {
    try {
        const { quantity, deleted } = req.body;

        // Only people who can see the enquiry may change its lines (this route had no permission check at all)
        const enquiry = await findVisibleEnquiry(req.user, req.params.id);
        if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });
        if (CLOSED_ENQUIRY_STATUSES.includes(enquiry.status)) {
            return res.status(409).json({ error: `This enquiry is ${enquiry.status}; reopen it before changing items` });
        }

        const item = await loadItem(req, res);
        if (!item) return;

        if (deleted) {
            if (CLOSED_ITEM_STATUSES.includes(item.status)) {
                return res.status(409).json({ error: `This item is already ${item.status} and can't be deleted` });
            }
            const remaining = await EnquiryItem.countDocuments({ enquiryId: req.params.id, _id: { $ne: item._id } });
            if (remaining === 0) {
                return res.status(400).json({ error: 'An enquiry needs at least one item. Mark the enquiry unsuccessful instead.' });
            }
            const removedName = await itemName(item);
            await EnquiryItem.deleteOne({ _id: item._id });
            await audit(req, {
                action: 'item.deleted', entity: 'item', entityId: item._id, entityLabel: removedName, enquiryId: enquiry._id,
                summary: `Removed ${removedName} from ${enquiry.enquiryNumber}`,
            });
            // its vendor quotes are meaningless without the line
            await VendorQuotation.deleteMany({ enquiryItemId: item._id });
            // if every remaining item was already closed, the enquiry is now finished
            await syncEnquiryStatus(req.params.id);
            return res.json({ message: 'Item deleted' });
        }

        if (quantity !== undefined) {
            if (CLOSED_ITEM_STATUSES.includes(item.status)) {
                return res.status(409).json({ error: `This item is already ${item.status} and can't be changed` });
            }
            const qty = toPositive(quantity);
            if (Number.isNaN(qty)) return res.status(400).json({ error: 'Quantity must be a number greater than 0' });
            if (qty !== item.quantity) {
                await audit(req, {
                    action: 'item.quantity_changed', entity: 'item', entityId: item._id, entityLabel: await itemName(item), enquiryId: enquiry._id,
                    summary: `Changed the quantity of ${await itemName(item)} on ${enquiry.enquiryNumber} from ${item.quantity} to ${qty}`,
                    details: { from: item.quantity, to: qty },
                });
            }
            item.quantity = qty;
        }
        item.updatedAt = new Date();
        await item.save();

        const populated = await EnquiryItem.findById(item._id).populate('productId');
        res.json(populated);
    } catch (error) {
        handleRouteError(res, error, 'edit item');
    }
});

// PUT /api/enquiries/:id/items/:itemId/sales-price — set sales price
router.put('/:id/items/:itemId/sales-price', authenticateToken, requirePermission('sales_price.add'), async (req, res) => {
    try {
        const { selectedVendorQuoteId } = req.body;

        const salesPrice = toNonNegative(req.body.salesPrice);
        if (Number.isNaN(salesPrice)) return res.status(400).json({ error: 'Sales price must be a number (0 or more)' });

        const item = await loadItem(req, res);
        if (!item) return;

        // Pricing a finished item used to quietly pull it back to "priced"
        if (CLOSED_ITEM_STATUSES.includes(item.status)) {
            return res.status(409).json({ error: `This item is already ${item.status}; its price can't be changed` });
        }

        if (selectedVendorQuoteId) {
            if (!isValidId(selectedVendorQuoteId)) return res.status(400).json({ error: 'Invalid vendor quote' });
            const quote = await VendorQuotation.findOne({ _id: selectedVendorQuoteId, enquiryItemId: item._id });
            if (!quote) return res.status(400).json({ error: 'That vendor quote does not belong to this item' });
            item.selectedVendorQuoteId = selectedVendorQuoteId;
        }

        item.salesPrice = salesPrice;
        item.status = 'priced';
        item.pricedAt = new Date();
        item.updatedAt = new Date();
        await item.save();
        {
            const owner = await Enquiry.findById(item.enquiryId).select('enquiryNumber');
            await audit(req, {
                action: 'item.priced', entity: 'item', entityId: item._id, entityLabel: await itemName(item), enquiryId: item.enquiryId,
                summary: `Set the selling price of ${await itemName(item)} on ${owner?.enquiryNumber || 'an enquiry'} to ${inr(salesPrice)}`,
                details: { salesPrice },
            });
        }

        const populated = await EnquiryItem.findById(item._id)
            .populate('productId')
            .populate('selectedVendorQuoteId');
        res.json(populated);
    } catch (error) {
        handleRouteError(res, error, 'sales price');
    }
});

// PUT /api/enquiries/:id/items/:itemId/complete — mark item complete (quotation sent)
router.put('/:id/items/:itemId/complete', authenticateToken, requirePermission('quotation.send'), async (req, res) => {
    try {
        const item = await loadItem(req, res);
        if (!item) return;

        if (item.status === 'unsuccessful') {
            return res.status(409).json({ error: 'This item was marked unsuccessful; reopen the enquiry first' });
        }
        // A quotation can't have been sent for an item with no sales price (revenue figures rely on it)
        if (item.status !== 'completed' && (item.salesPrice === undefined || item.salesPrice === null)) {
            return res.status(400).json({ error: 'Set a sales price before marking the quotation as sent' });
        }

        const alreadyDone = item.status === 'completed';
        item.status = 'completed';
        if (!alreadyDone) item.completedAt = new Date();
        item.updatedAt = new Date();
        await item.save();
        if (!alreadyDone) {
            const owner = await Enquiry.findById(item.enquiryId).select('enquiryNumber');
            await audit(req, {
                action: 'item.completed', entity: 'item', entityId: item._id, entityLabel: await itemName(item), enquiryId: item.enquiryId,
                summary: `Marked ${await itemName(item)} on ${owner?.enquiryNumber || 'an enquiry'} as successful (quotation sent)`,
            });
        }

        await syncEnquiryStatus(item.enquiryId);

        const populated = await EnquiryItem.findById(item._id).populate('productId');
        res.json(populated);
    } catch (error) {
        handleRouteError(res, error, 'complete item');
    }
});

// PUT /api/enquiries/:id/unsuccessful — mark entire enquiry unsuccessful (requires close reason)
router.put('/:id/unsuccessful', authenticateToken, requirePermission('enquiry.mark_unsuccessful'), async (req, res) => {
    try {
        const closeReason = typeof req.body.closeReason === 'string' ? req.body.closeReason.trim() : '';
        if (!closeReason) {
            return res.status(400).json({ error: 'A reason for closing is required.' });
        }

        const enquiry = await Enquiry.findById(req.params.id);
        if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });
        if (CLOSED_ENQUIRY_STATUSES.includes(enquiry.status)) {
            return res.status(409).json({ error: `This enquiry is already ${enquiry.status}` });
        }

        await EnquiryItem.updateMany(
            { enquiryId: req.params.id, status: { $nin: CLOSED_ITEM_STATUSES } },
            { $set: { status: 'unsuccessful', updatedAt: new Date() } }
        );

        await Enquiry.findByIdAndUpdate(req.params.id, {
            status: 'unsuccessful',
            stage: 'completed',
            closedAt: new Date(),
            closeReason,
        });
        await audit(req, {
            action: 'enquiry.closed_unsuccessful', entity: 'enquiry', entityId: enquiry._id, entityLabel: enquiry.enquiryNumber, enquiryId: enquiry._id,
            summary: `Closed ${enquiry.enquiryNumber} as unsuccessful: ${closeReason}`, details: { reason: closeReason },
        });

        res.json({ message: 'Enquiry marked as unsuccessful' });
    } catch (error) {
        handleRouteError(res, error, 'mark enquiry unsuccessful');
    }
});

// PUT /api/enquiries/:id/items/:itemId/unsuccessful — mark single item unsuccessful
router.put('/:id/items/:itemId/unsuccessful', authenticateToken, requirePermission('enquiry.mark_unsuccessful'), async (req, res) => {
    try {
        const closeReason = typeof req.body.closeReason === 'string' ? req.body.closeReason.trim() : '';
        if (!closeReason) {
            return res.status(400).json({ error: 'A reason for closing is required.' });
        }

        const item = await loadItem(req, res);
        if (!item) return;

        if (item.status === 'completed') {
            return res.status(409).json({ error: 'This item is already completed and cannot be marked unsuccessful' });
        }

        item.status = 'unsuccessful';
        item.updatedAt = new Date();
        await item.save();

        // Store close reason on the enquiry
        await Enquiry.findByIdAndUpdate(item.enquiryId, { closeReason });
        {
            const owner = await Enquiry.findById(item.enquiryId).select('enquiryNumber');
            await audit(req, {
                action: 'item.closed_unsuccessful', entity: 'item', entityId: item._id, entityLabel: await itemName(item), enquiryId: item.enquiryId,
                summary: `Closed ${await itemName(item)} on ${owner?.enquiryNumber || 'an enquiry'} as unsuccessful: ${closeReason}`, details: { reason: closeReason },
            });
        }

        await syncEnquiryStatus(item.enquiryId);

        res.json(item);
    } catch (error) {
        handleRouteError(res, error, 'mark item unsuccessful');
    }
});

// PUT /api/enquiries/:id/items/:itemId/raise-query — raise sales query (changes item status)
router.put('/:id/items/:itemId/raise-query', authenticateToken, requirePermission('query.send'), async (req, res) => {
    try {
        const item = await loadItem(req, res);
        if (!item) return;

        const allowedStatuses = ['assigned', 'sales_query_resolved'];
        if (!allowedStatuses.includes(item.status)) {
            return res.status(400).json({ error: `Cannot raise query on item with status: ${item.status}` });
        }

        item.status = 'in_sales_query';
        item.updatedAt = new Date();
        await item.save();

        // Notify the enquiry creator (sales person)
        const enquiry = await Enquiry.findById(req.params.id);
        if (enquiry && enquiry.createdBy && enquiry.createdBy.toString() !== req.user.id) {
            const sender = await User.findById(req.user.id).select('name');
            await Notification.create({
                userId: enquiry.createdBy,
                message: `Sales query raised by ${sender?.name || 'Sourcing'} on ${enquiry.enquiryNumber}`,
                type: 'warning',
                link: `/sales.html?enquiryId=${req.params.id}`,
            });
        }

        await audit(req, {
            action: 'item.question_raised', entity: 'item', entityId: item._id, entityLabel: await itemName(item), enquiryId: item.enquiryId,
            summary: `Raised a question about ${await itemName(item)} on ${enquiry?.enquiryNumber || 'an enquiry'}`,
        });

        const populated = await EnquiryItem.findById(item._id).populate('productId').populate('assignedTo', 'name email');
        res.json(populated);
    } catch (error) {
        handleRouteError(res, error, 'raise query');
    }
});

// PUT /api/enquiries/:id/items/:itemId/resolve-query — resolve sales query
router.put('/:id/items/:itemId/resolve-query', authenticateToken, requirePermission('query.send'), async (req, res) => {
    try {
        const item = await loadItem(req, res);
        if (!item) return;

        if (item.status !== 'in_sales_query') {
            return res.status(400).json({ error: 'Item is not in sales query status' });
        }

        const perms = req.user.permissions || [];
        const isAssignee = item.assignedTo && item.assignedTo.toString() === req.user.id;
        const canForceResolve = perms.includes('enquiry.assign');

        if (!isAssignee && !canForceResolve) {
            return res.status(403).json({ error: 'Only the assigned sourcing person can resolve this query' });
        }

        item.status = 'sales_query_resolved';
        item.updatedAt = new Date();
        await item.save();

        // Notify enquiry creator that query is resolved
        const enquiry = await Enquiry.findById(req.params.id);
        if (enquiry) {
            const resolver = await User.findById(req.user.id).select('name');
            const recipients = new Set();
            if (enquiry.createdBy) recipients.add(enquiry.createdBy.toString());
            if (enquiry.assignedTo) recipients.add(enquiry.assignedTo.toString());
            for (const recipientId of recipients) {
                if (recipientId !== req.user.id) {
                    await Notification.create({
                        userId: recipientId,
                        message: `Query resolved by ${resolver?.name || 'Sourcing'} on ${enquiry.enquiryNumber}`,
                        type: 'success',
                        link: `/sales.html?enquiryId=${req.params.id}`,
                    });
                }
            }
        }

        await audit(req, {
            action: 'item.question_resolved', entity: 'item', entityId: item._id, entityLabel: await itemName(item), enquiryId: item.enquiryId,
            summary: `Marked the question about ${await itemName(item)} on ${enquiry?.enquiryNumber || 'an enquiry'} as resolved`,
        });

        const populated = await EnquiryItem.findById(item._id).populate('productId').populate('assignedTo', 'name email');
        res.json(populated);
    } catch (error) {
        handleRouteError(res, error, 'resolve query');
    }
});

// PUT /api/enquiries/:id/reopen — reopen a closed enquiry
router.put('/:id/reopen', authenticateToken, requirePermission('enquiry.reopen'), async (req, res) => {
    try {
        const enquiry = await Enquiry.findById(req.params.id);
        if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });

        if (!CLOSED_ENQUIRY_STATUSES.includes(enquiry.status)) {
            return res.status(400).json({ error: 'Only completed or unsuccessful enquiries can be reopened' });
        }

        // Reset unsuccessful items back to unassigned
        await EnquiryItem.updateMany(
            { enquiryId: req.params.id, status: 'unsuccessful' },
            { $set: { status: 'unassigned', assignedTo: null, updatedAt: new Date() } }
        );

        // Determine new stage: if any items now have assignedTo → open, else new
        const remainingItems = await EnquiryItem.find({ enquiryId: req.params.id });
        const anyAssigned = remainingItems.some(i => i.assignedTo);
        const newStage = anyAssigned ? 'open' : 'new';

        await Enquiry.findByIdAndUpdate(req.params.id, {
            status: 'active',
            stage: newStage,
            closeReason: null,
            closedAt: null,
            reopenedAt: new Date(),
            reopenedBy: req.user.id,
        });
        await audit(req, {
            action: 'enquiry.reopened', entity: 'enquiry', entityId: enquiry._id, entityLabel: enquiry.enquiryNumber, enquiryId: enquiry._id,
            summary: `Reopened ${enquiry.enquiryNumber}`,
        });

        // Notify original creator if someone else is reopening
        if (enquiry.createdBy && enquiry.createdBy.toString() !== req.user.id) {
            const reopener = await User.findById(req.user.id).select('name');
            await Notification.create({
                userId: enquiry.createdBy,
                message: `Enquiry ${enquiry.enquiryNumber} was reopened by ${reopener?.name || 'a manager'}`,
                type: 'info',
                link: `/sales.html?enquiryId=${req.params.id}`,
            });
        }

        res.json(await enquiryWithItems(req.params.id));
    } catch (error) {
        handleRouteError(res, error, 'reopen enquiry');
    }
});

// POST /api/enquiries/combine — merge items between enquiries
router.post('/combine', authenticateToken, requirePermission('enquiry.combine'), async (req, res) => {
    try {
        const { targetEnquiryId, sourceItemIds } = req.body;

        if (!targetEnquiryId || !Array.isArray(sourceItemIds) || sourceItemIds.length === 0) {
            return res.status(400).json({ error: 'targetEnquiryId and sourceItemIds are required' });
        }
        if (!isValidId(targetEnquiryId) || !sourceItemIds.every(isValidId)) {
            return res.status(400).json({ error: 'Invalid enquiry or item selection' });
        }

        const targetEnquiry = await Enquiry.findById(targetEnquiryId);
        if (!targetEnquiry) return res.status(404).json({ error: 'Target enquiry not found' });
        if (CLOSED_ENQUIRY_STATUSES.includes(targetEnquiry.status)) {
            return res.status(409).json({ error: `The target enquiry is ${targetEnquiry.status}; reopen it first` });
        }

        // Only open items from OTHER enquiries can be moved
        const sourceItems = (await EnquiryItem.find({ _id: { $in: sourceItemIds } }))
            .filter(i => i.enquiryId.toString() !== targetEnquiryId.toString() && !CLOSED_ITEM_STATUSES.includes(i.status));
        if (sourceItems.length === 0) {
            return res.status(400).json({ error: 'No movable items selected (items must be open and from a different enquiry)' });
        }

        const sourceEnquiryIds = [...new Set(sourceItems.map(i => i.enquiryId.toString()))];
        const sourceEnquiryDocs = await Enquiry.find({ _id: { $in: sourceEnquiryIds } }).select('_id enquiryNumber');
        const enquiryNumberMap = Object.fromEntries(sourceEnquiryDocs.map(e => [e._id.toString(), e.enquiryNumber]));

        // Group by source enquiry so combinedFromEnquiry can be recorded per group
        const bySource = {};
        for (const item of sourceItems) {
            const srcId = item.enquiryId.toString();
            (bySource[srcId] = bySource[srcId] || []).push(item._id);
        }

        for (const [srcId, itemIds] of Object.entries(bySource)) {
            await EnquiryItem.updateMany(
                { _id: { $in: itemIds } },
                {
                    $set: {
                        enquiryId: targetEnquiryId,
                        updatedAt: new Date(),
                        'combinedFromEnquiry.enquiryId': srcId,
                        'combinedFromEnquiry.enquiryNumber': enquiryNumberMap[srcId] || null,
                    }
                }
            );
            // Items that were still waiting join the target's assignee. Items further along (quoted, priced...)
            // keep their status — this used to reset every moved item to 'assigned'.
            if (targetEnquiry.assignedTo) {
                await EnquiryItem.updateMany(
                    { _id: { $in: itemIds }, status: { $in: UNCLAIMED } },
                    { $set: { status: 'assigned', assignedTo: targetEnquiry.assignedTo } }
                );
            }
        }

        // A source enquiry left with no items is removed; its query thread moves to the target so it isn't lost
        for (const srcId of sourceEnquiryIds) {
            const remaining = await EnquiryItem.countDocuments({ enquiryId: srcId });
            if (remaining === 0) {
                await Query.updateMany({ enquiryId: srcId }, { $set: { enquiryId: targetEnquiryId } });
                await Enquiry.findByIdAndDelete(srcId);
            } else {
                await syncEnquiryStatus(srcId);
            }
        }

        for (const [srcId, itemIds] of Object.entries(bySource)) {
            const fromNumber = enquiryNumberMap[srcId] || 'another enquiry';
            await audit(req, {
                action: 'items.combined', entity: 'enquiry', entityId: targetEnquiry._id, entityLabel: targetEnquiry.enquiryNumber, enquiryId: targetEnquiry._id,
                summary: `Moved ${plural(itemIds.length, 'item')} from ${fromNumber} into ${targetEnquiry.enquiryNumber}`,
            });
            await audit(req, {
                action: 'items.combined', entity: 'enquiry', entityId: srcId, entityLabel: fromNumber, enquiryId: srcId,
                summary: `Moved ${plural(itemIds.length, 'item')} into ${targetEnquiry.enquiryNumber}`,
            });
        }

        res.json({ message: 'Items combined successfully', moved: sourceItems.length });
    } catch (error) {
        handleRouteError(res, error, 'combine enquiries');
    }
});

// DELETE /api/enquiries/:id — remove an open enquiry together with its items, vendor quotes and chat.
// (Closed enquiries are the record of what was quoted and won, so they stay; the screen already hides the button for them.)
router.delete('/:id', authenticateToken, requirePermission('enquiry.mark_unsuccessful'), async (req, res) => {
    try {
        const enquiry = await findVisibleEnquiry(req.user, req.params.id);
        if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });
        if (CLOSED_ENQUIRY_STATUSES.includes(enquiry.status)) {
            return res.status(409).json({ error: `This enquiry is ${enquiry.status}. Closed enquiries are kept for the record and can't be deleted.` });
        }

        const itemIds = (await EnquiryItem.find({ enquiryId: enquiry._id }).select('_id')).map(i => i._id);
        await Promise.all([
            VendorQuotation.deleteMany({ enquiryItemId: { $in: itemIds } }),
            EnquiryItem.deleteMany({ enquiryId: enquiry._id }),
            Query.deleteMany({ enquiryId: enquiry._id }),
        ]);
        // the enquiry goes last: if anything above fails it is still there to try again, never half-deleted with orphans
        await Enquiry.deleteOne({ _id: enquiry._id });
        await audit(req, {
            action: 'enquiry.deleted', entity: 'enquiry', entityId: enquiry._id, entityLabel: enquiry.enquiryNumber, enquiryId: enquiry._id,
            summary: `Deleted ${enquiry.enquiryNumber} (${plural(itemIds.length, 'item')})`,
        });

        res.json({ message: 'Enquiry deleted successfully' });
    } catch (error) {
        handleRouteError(res, error, 'delete enquiry');
    }
});

// GET /api/enquiries/:id/history — everything that happened to this enquiry, newest first.
// Anyone who can see the enquiry can see its history (the full activity log is a separate permission).
router.get('/:id/history', authenticateToken, async (req, res) => {
    try {
        if (!hasViewPermission(req.user) || !(await findVisibleEnquiry(req.user, req.params.id))) {
            return res.status(404).json({ error: 'Enquiry not found' });
        }
        const events = await AuditLog.find({ enquiryId: req.params.id }).sort({ at: -1 }).limit(300)
            .select('at actor.name actor.role action summary').lean();
        res.json(events);
    } catch (error) {
        handleRouteError(res, error, 'enquiry history');
    }
});

// GET /api/enquiries/:id/queries — fetch query thread
router.get('/:id/queries', authenticateToken, async (req, res) => {
    try {
        if (!hasViewPermission(req.user) || !(await findVisibleEnquiry(req.user, req.params.id))) {
            return res.status(404).json({ error: 'Enquiry not found' });
        }
        const queries = await Query.find({ enquiryId: req.params.id })
            .populate('senderId', 'name')
            .sort({ createdAt: 1 });
        res.json(queries);
    } catch (error) {
        handleRouteError(res, error, 'list queries');
    }
});

// POST /api/enquiries/:id/queries — send a query message
router.post('/:id/queries', authenticateToken, requirePermission('query.send'), async (req, res) => {
    try {
        const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
        if (!message) return res.status(400).json({ error: 'Message is required' });
        if (message.length > 2000) return res.status(400).json({ error: 'Message is too long (2000 characters max)' });

        const enquiry = await findVisibleEnquiry(req.user, req.params.id);
        if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });

        const query = new Query({
            enquiryId: req.params.id,
            senderId: req.user.id,
            message,
        });
        await query.save();

        const sender = await User.findById(req.user.id).select('name');

        await notifyQueryRecipients({
            enquiryId: req.params.id,
            senderId: req.user.id,
            enquiryNumber: enquiry.enquiryNumber,
            senderName: sender ? sender.name : 'Someone',
        });

        const populated = await Query.findById(query._id).populate('senderId', 'name');
        res.status(201).json(populated);
    } catch (error) {
        handleRouteError(res, error, 'send query');
    }
});

module.exports = router;
