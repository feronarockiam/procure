const express = require('express');
const { Enquiry, EnquiryItem, Product, Customer, Notification, User, Query } = require('../db');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../middleware/auth');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

const generateEnquiryNumber = async () => {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `ENQ-${dateStr}-`;

    const lastEnquiry = await Enquiry.findOne({
        enquiryNumber: new RegExp(`^${prefix}`)
    }).sort({ enquiryNumber: -1 });

    let sequence = 1;
    if (lastEnquiry) {
        const lastSeq = parseInt(lastEnquiry.enquiryNumber.split('-')[2]);
        sequence = lastSeq + 1;
    }

    return `${prefix}${String(sequence).padStart(3, '0')}`;
};

// Build base visibility query from the user's permissions
const buildVisibilityQuery = async (user) => {
    const perms = user.permissions || [];

    if (perms.includes('enquiry.view.all')) {
        return {}; // sees everything
    }

    if (perms.includes('enquiry.view.assigned_customers')) {
        const kamCustomers = await Customer.find({ assignedKAM: user.id }).select('_id');
        const customerIds = kamCustomers.map(c => c._id);
        return { customerId: { $in: customerIds } };
    }

    if (perms.includes('enquiry.view.assigned') || perms.includes('enquiry.self_assign')) {
        // Purchase users: see their own assigned items OR any enquiry with unassigned items
        const assignedItems = await EnquiryItem.find({ assignedTo: user.id }).select('enquiryId');
        const assignedEnquiryIds = assignedItems.map(i => i.enquiryId);

        // Enquiries with at least one unassigned item (claimable queue)
        const unassignedItems = await EnquiryItem.find({
            status: { $in: ['unassigned', 'pending'] }
        }).select('enquiryId');
        const unassignedEnquiryIds = unassignedItems.map(i => i.enquiryId);

        const allIds = [...new Set([
            ...assignedEnquiryIds.map(id => id.toString()),
            ...unassignedEnquiryIds.map(id => id.toString()),
        ])];

        return { _id: { $in: allIds } };
    }

    if (perms.includes('enquiry.view.own')) {
        return { createdBy: user.id };
    }

    return { _id: null };
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

    // Look up each recipient's role category to route them to the right dashboard
    const recipientUsers = await User.find({ _id: { $in: [...recipients] } })
        .populate('roleId', 'category dashboardPage');

    for (const u of recipientUsers) {
        const category = u.roleId?.category;
        const page = category === 'purchase' ? 'sourcing.html'
                   : category === 'key_accounts' ? 'key-accounts.html'
                   : 'sales.html';
        await Notification.create({
            userId: u._id,
            message: `New query from ${senderName} on ${enquiryNumber}`,
            type: 'info',
            link: `/${page}?enquiryId=${enquiryId}`,
        });
    }
};

// Recompute and save enquiry status based on current item statuses
const syncEnquiryStatus = async (enquiryId) => {
    const allItems = await EnquiryItem.find({ enquiryId });
    if (!allItems.length) return;

    const allClosed = allItems.every(i => ['completed', 'unsuccessful'].includes(i.status));
    if (!allClosed) return;

    const allCompleted    = allItems.every(i => i.status === 'completed');
    const allUnsuccessful = allItems.every(i => i.status === 'unsuccessful');
    const finalStatus = allCompleted ? 'completed' : allUnsuccessful ? 'unsuccessful' : 'closed';
    await Enquiry.findByIdAndUpdate(enquiryId, { status: finalStatus, stage: 'completed' });
};

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/enquiries — list enquiries (filtered by permissions + optional stage/user filters)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const perms = req.user.permissions || [];

        const hasViewPerm = perms.some(p => p.startsWith('enquiry.view')) || perms.includes('enquiry.self_assign');
        if (!hasViewPerm) return res.status(403).json({ error: 'Permission required: enquiry.view.*' });

        let query = await buildVisibilityQuery(req.user);

        if (req.query.stage) {
            query.stage = req.query.stage;
        }

        if (req.query.stage === 'completed') {
            query.status = { $in: ['completed', 'unsuccessful', 'closed'] };
        } else if (req.query.stage) {
            query.status = 'active';
        }

        if (req.query.sourcingUser && perms.includes('filter.by_sourcing_user')) {
            const assignedItems = await EnquiryItem.find({ assignedTo: req.query.sourcingUser }).select('enquiryId');
            const ids = assignedItems.map(i => i.enquiryId);
            const sourcingFilter = { $or: [{ assignedTo: req.query.sourcingUser }, { _id: { $in: ids } }] };
            query = query.$or ? { $and: [query, sourcingFilter] } : { ...query, ...sourcingFilter };
        }

        if (req.query.kamUser && perms.includes('filter.by_key_account_manager')) {
            const kamCustomers = await Customer.find({ assignedKAM: req.query.kamUser }).select('_id');
            const customerIds = kamCustomers.map(c => c._id);
            query.customerId = { $in: customerIds };
        }

        const enquiries = await Enquiry.find(query)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone assignedKAM')
            .sort({ createdAt: -1 });

        const enquiriesWithDetails = await Promise.all(
            enquiries.map(async (enquiry) => {
                const [items, queryCount] = await Promise.all([
                    EnquiryItem.find({ enquiryId: enquiry._id })
                        .populate('productId')
                        .populate('assignedTo', 'name email')
                        .populate('selectedVendorQuoteId'),
                    Query.countDocuments({ enquiryId: enquiry._id }),
                ]);
                return { ...enquiry.toObject(), items, queryCount };
            })
        );

        res.json(enquiriesWithDetails);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/enquiries/:id — fetch single enquiry with items
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const perms = req.user.permissions || [];
        const hasViewPerm = perms.some(p => p.startsWith('enquiry.view')) || perms.includes('enquiry.self_assign');
        if (!hasViewPerm) return res.status(403).json({ error: 'Permission required: enquiry.view.*' });

        const enquiry = await Enquiry.findById(req.params.id)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone assignedKAM');

        if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });

        const [items, queryCount] = await Promise.all([
            EnquiryItem.find({ enquiryId: enquiry._id })
                .populate('productId')
                .populate('assignedTo', 'name email')
                .populate('selectedVendorQuoteId'),
            Query.countDocuments({ enquiryId: enquiry._id }),
        ]);

        res.json({ ...enquiry.toObject(), items, queryCount });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/enquiries — create enquiry
router.post('/', authenticateToken, requirePermission('enquiry.create'), async (req, res) => {
    try {
        const { customerId, items } = req.body;

        if (!customerId) return res.status(400).json({ error: 'Customer ID is required' });
        if (!items || items.length === 0) return res.status(400).json({ error: 'At least one item is required' });

        const enquiryNumber = await generateEnquiryNumber();

        const enquiry = new Enquiry({
            enquiryNumber,
            customerId,
            createdBy: req.user.id,
            stage: 'new',
        });

        await enquiry.save();

        await Promise.all(items.map(item =>
            new EnquiryItem({
                enquiryId: enquiry._id,
                productId: item.productId,
                quantity: item.quantity,
                status: 'unassigned',
            }).save()
        ));

        const populated = await Enquiry.findById(enquiry._id)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone');

        const populatedItems = await EnquiryItem.find({ enquiryId: enquiry._id })
            .populate('productId')
            .populate('assignedTo', 'name email');

        // Notify all managers (enquiry.assign) and purchase team (enquiry.self_assign + purchase category)
        // Run async so it doesn't delay the response
        (async () => {
            try {
                const { Role } = require('../db');
                const allUsers = await User.find({ _id: { $ne: req.user.id } }).select('_id').populate({
                    path: 'roleId',
                    select: 'permissions category',
                });
                const customerName = populated.customerId?.name || 'Unknown customer';
                const creatorName  = populated.createdBy?.name  || 'Someone';
                const notifs = [];
                for (const u of allUsers) {
                    const perms    = u.roleId?.permissions || [];
                    const category = u.roleId?.category || '';
                    const isManager  = perms.includes('enquiry.assign');
                    const isPurchase = category === 'purchase' && perms.includes('enquiry.self_assign');
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
                console.error('Enquiry notification error:', e.message);
            }
        })();

        res.status(201).json({ ...populated.toObject(), items: populatedItems });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/enquiries/:id/assign — assign entire enquiry to a purchase user
router.put('/:id/assign', authenticateToken, requirePermission('enquiry.assign'), async (req, res) => {
    try {
        const { sourcingUserId } = req.body;

        const enquiry = await Enquiry.findById(req.params.id);
        if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });

        enquiry.assignedTo = sourcingUserId;
        if (enquiry.stage === 'new') enquiry.stage = 'open';
        await enquiry.save();

        await EnquiryItem.updateMany(
            { enquiryId: enquiry._id, status: { $in: ['unassigned', 'pending'] } },
            { $set: { status: 'assigned', assignedTo: sourcingUserId, updatedAt: new Date() } }
        );

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
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/enquiries/:id/assign-items — assign selected items to a purchase user
router.post('/:id/assign-items', authenticateToken,
    requireAnyPermission('enquiry.assign', 'enquiry.self_assign'),
    async (req, res) => {
        try {
            const { itemIds, sourcingUserId } = req.body;

            if (!itemIds || itemIds.length === 0) return res.status(400).json({ error: 'No items selected' });

            const perms = req.user.permissions || [];

            if (!perms.includes('enquiry.assign') && sourcingUserId !== req.user.id) {
                return res.status(403).json({ error: 'You can only self-assign items' });
            }

            await EnquiryItem.updateMany(
                { _id: { $in: itemIds }, enquiryId: req.params.id },
                { $set: { status: 'assigned', assignedTo: sourcingUserId, updatedAt: new Date() } }
            );

            const enquiry = await Enquiry.findById(req.params.id);
            if (enquiry && enquiry.stage === 'new') {
                await Enquiry.findByIdAndUpdate(req.params.id, { stage: 'open' });
            }

            if (sourcingUserId !== req.user.id) {
                await Notification.create({
                    userId: sourcingUserId,
                    message: `${itemIds.length} item(s) assigned to you`,
                    type: 'info',
                    link: `/sourcing.html?enquiryId=${req.params.id}`,
                });
            }

            const updatedEnquiry = await Enquiry.findById(req.params.id)
                .populate('createdBy', 'name email')
                .populate('assignedTo', 'name email')
                .populate('customerId', 'name contactPerson address email phone');

            const items = await EnquiryItem.find({ enquiryId: req.params.id })
                .populate('productId')
                .populate('assignedTo', 'name email');

            res.json({ ...updatedEnquiry.toObject(), items });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// PUT /api/enquiries/:id/items/:itemId — edit quantity or soft-delete item
router.put('/:id/items/:itemId', authenticateToken, async (req, res) => {
    try {
        const { quantity, deleted } = req.body;

        if (deleted) {
            await EnquiryItem.findByIdAndDelete(req.params.itemId);
            return res.json({ message: 'Item deleted' });
        }

        const item = await EnquiryItem.findById(req.params.itemId);
        if (!item) return res.status(404).json({ error: 'Item not found' });

        if (quantity) item.quantity = quantity;
        item.updatedAt = new Date();
        await item.save();

        const populated = await EnquiryItem.findById(item._id).populate('productId');
        res.json(populated);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/enquiries/:id/items/:itemId/sales-price — set sales price
router.put('/:id/items/:itemId/sales-price', authenticateToken, requirePermission('sales_price.add'), async (req, res) => {
    try {
        const { salesPrice, selectedVendorQuoteId } = req.body;

        const item = await EnquiryItem.findById(req.params.itemId);
        if (!item) return res.status(404).json({ error: 'Item not found' });

        item.salesPrice = salesPrice;
        if (selectedVendorQuoteId) item.selectedVendorQuoteId = selectedVendorQuoteId;
        item.status = 'priced';
        item.updatedAt = new Date();
        await item.save();

        const populated = await EnquiryItem.findById(item._id)
            .populate('productId')
            .populate('selectedVendorQuoteId');
        res.json(populated);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/enquiries/:id/items/:itemId/complete — mark item complete (quotation sent)
router.put('/:id/items/:itemId/complete', authenticateToken, requirePermission('quotation.send'), async (req, res) => {
    try {
        const item = await EnquiryItem.findById(req.params.itemId);
        if (!item) return res.status(404).json({ error: 'Item not found' });

        item.status = 'completed';
        item.updatedAt = new Date();
        await item.save();

        await syncEnquiryStatus(item.enquiryId);

        const populated = await EnquiryItem.findById(item._id).populate('productId');
        res.json(populated);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/enquiries/:id/unsuccessful — mark entire enquiry unsuccessful (requires close reason)
router.put('/:id/unsuccessful', authenticateToken, requirePermission('enquiry.mark_unsuccessful'), async (req, res) => {
    try {
        const { closeReason } = req.body;
        if (!closeReason || !closeReason.trim()) {
            return res.status(400).json({ error: 'A reason for closing is required.' });
        }

        await EnquiryItem.updateMany(
            { enquiryId: req.params.id, status: { $nin: ['completed', 'unsuccessful'] } },
            { $set: { status: 'unsuccessful', updatedAt: new Date() } }
        );

        await Enquiry.findByIdAndUpdate(req.params.id, {
            status: 'unsuccessful',
            stage: 'completed',
            closeReason: closeReason.trim(),
        });

        res.json({ message: 'Enquiry marked as unsuccessful' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/enquiries/:id/items/:itemId/unsuccessful — mark single item unsuccessful
router.put('/:id/items/:itemId/unsuccessful', authenticateToken, requirePermission('enquiry.mark_unsuccessful'), async (req, res) => {
    try {
        const { closeReason } = req.body;
        if (!closeReason || !closeReason.trim()) {
            return res.status(400).json({ error: 'A reason for closing is required.' });
        }

        const item = await EnquiryItem.findById(req.params.itemId);
        if (!item) return res.status(404).json({ error: 'Item not found' });

        item.status = 'unsuccessful';
        item.updatedAt = new Date();
        await item.save();

        // Store close reason on the enquiry
        await Enquiry.findByIdAndUpdate(item.enquiryId, { closeReason: closeReason.trim() });

        await syncEnquiryStatus(item.enquiryId);

        res.json(item);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/enquiries/:id/items/:itemId/raise-query — raise sales query (changes item status)
router.put('/:id/items/:itemId/raise-query', authenticateToken, requirePermission('query.send'), async (req, res) => {
    try {
        const item = await EnquiryItem.findById(req.params.itemId);
        if (!item) return res.status(404).json({ error: 'Item not found' });

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

        const populated = await EnquiryItem.findById(item._id).populate('productId').populate('assignedTo', 'name email');
        res.json(populated);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/enquiries/:id/items/:itemId/resolve-query — resolve sales query
router.put('/:id/items/:itemId/resolve-query', authenticateToken, requirePermission('query.send'), async (req, res) => {
    try {
        const item = await EnquiryItem.findById(req.params.itemId);
        if (!item) return res.status(404).json({ error: 'Item not found' });

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

        const populated = await EnquiryItem.findById(item._id).populate('productId').populate('assignedTo', 'name email');
        res.json(populated);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/enquiries/:id/reopen — reopen a closed enquiry
router.put('/:id/reopen', authenticateToken, requirePermission('enquiry.reopen'), async (req, res) => {
    try {
        const enquiry = await Enquiry.findById(req.params.id);
        if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });

        const closedStatuses = ['completed', 'unsuccessful', 'closed'];
        if (!closedStatuses.includes(enquiry.status)) {
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
            reopenedAt: new Date(),
            reopenedBy: req.user.id,
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

        const populated = await Enquiry.findById(req.params.id)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone');

        const items = await EnquiryItem.find({ enquiryId: req.params.id })
            .populate('productId')
            .populate('assignedTo', 'name email');

        res.json({ ...populated.toObject(), items });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/enquiries/combine — merge items between enquiries
router.post('/combine', authenticateToken, requirePermission('enquiry.combine'), async (req, res) => {
    try {
        const { targetEnquiryId, sourceItemIds } = req.body;

        if (!targetEnquiryId || !sourceItemIds?.length) {
            return res.status(400).json({ error: 'targetEnquiryId and sourceItemIds are required' });
        }

        const targetEnquiry = await Enquiry.findById(targetEnquiryId);
        if (!targetEnquiry) return res.status(404).json({ error: 'Target enquiry not found' });

        const sourceItems = await EnquiryItem.find({ _id: { $in: sourceItemIds } });
        const sourceEnquiryIds = [...new Set(
            sourceItems.map(i => i.enquiryId.toString()).filter(id => id !== targetEnquiryId.toString())
        )];

        // Fetch source enquiry numbers for badge tracking
        const sourceEnquiryDocs = await Enquiry.find({ _id: { $in: sourceEnquiryIds } }).select('_id enquiryNumber');
        const enquiryNumberMap = Object.fromEntries(sourceEnquiryDocs.map(e => [e._id.toString(), e.enquiryNumber]));

        // Group source items by their source enquiryId so we can set combinedFromEnquiry per group
        const bySource = {};
        for (const item of sourceItems) {
            const srcId = item.enquiryId.toString();
            if (srcId === targetEnquiryId.toString()) continue;
            if (!bySource[srcId]) bySource[srcId] = [];
            bySource[srcId].push(item._id);
        }

        const baseUpdate = { enquiryId: targetEnquiryId, updatedAt: new Date() };
        if (targetEnquiry.assignedTo) baseUpdate.status = 'assigned';

        for (const [srcId, itemIds] of Object.entries(bySource)) {
            await EnquiryItem.updateMany(
                { _id: { $in: itemIds } },
                {
                    $set: {
                        ...baseUpdate,
                        'combinedFromEnquiry.enquiryId': srcId,
                        'combinedFromEnquiry.enquiryNumber': enquiryNumberMap[srcId] || null,
                    }
                }
            );
        }

        // Delete source enquiries that have no remaining items
        for (const srcId of sourceEnquiryIds) {
            const remaining = await EnquiryItem.countDocuments({ enquiryId: srcId });
            if (remaining === 0) await Enquiry.findByIdAndDelete(srcId);
        }

        res.json({ message: 'Items combined successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/enquiries/:id/queries — fetch query thread
router.get('/:id/queries', authenticateToken, async (req, res) => {
    try {
        const queries = await Query.find({ enquiryId: req.params.id })
            .populate('senderId', 'name')
            .sort({ createdAt: 1 });
        res.json(queries);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/enquiries/:id/queries — send a query message
router.post('/:id/queries', authenticateToken, requirePermission('query.send'), async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });

        const enquiry = await Enquiry.findById(req.params.id);
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
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/enquiries/:id — delete enquiry and all its items/queries
router.delete('/:id', authenticateToken, requirePermission('enquiry.mark_unsuccessful'), async (req, res) => {
    try {
        await EnquiryItem.deleteMany({ enquiryId: req.params.id });
        await Query.deleteMany({ enquiryId: req.params.id });
        await Enquiry.findByIdAndDelete(req.params.id);
        res.json({ message: 'Enquiry deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
