const express = require('express');
const mongoose = require('mongoose');
const { Vendor, VendorQuotation, EnquiryItem, Enquiry, Notification, Product } = require('../db');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { audit, inr } = require('../utils/audit');
const { isValidId, asString, cleanString, escapeRegex, toNonNegative } = require('../middleware/validate');

// "Acme  Traders" and "Acme Traders" are one name
const cleanName = (value) => { const text = cleanString(value); return text && text.replace(/\s+/g, ' '); };

const router = express.Router();

// Statuses an item can still take a (new) vendor quote in. A priced item keeps its status when
// another quote arrives, and a query-in-progress / closed item is left alone.
const QUOTABLE_STATUSES = ['unassigned', 'pending', 'assigned', 'sales_query_resolved', 'vendor_quoted'];
const CLOSED_STATUSES = ['completed', 'unsuccessful'];

const total = (q) => q.vendorPrice + (q.freightPrice || 0);

// Re-mark which quotation(s) for an item are cheapest (vendor price + freight). Ties are all cheapest.
// Done from scratch every time so adding OR editing a quote can never leave a stale flag behind.
const recomputeCheapest = async (enquiryItemId) => {
    const quotes = await VendorQuotation.find({ enquiryItemId });
    if (quotes.length === 0) return;
    const min = Math.min(...quotes.map(total));
    await Promise.all(quotes.map(q => {
        const shouldBe = total(q) === min;
        return q.isCheapest === shouldBe ? null : VendorQuotation.updateOne({ _id: q._id }, { isCheapest: shouldBe });
    }));
};

const vendorNameTaken = async (name, exceptId) => {
    const query = { name: new RegExp(`^${escapeRegex(name)}$`, 'i') };
    if (exceptId) query._id = { $ne: exceptId };
    return Vendor.findOne(query);
};

const validEmail = (value) => value === undefined || value === null || value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// GET /api/vendors
router.get('/', authenticateToken, requirePermission('vendor.view'), async (req, res) => {
    try {
        const vendors = await Vendor.find().sort({ name: 1 });
        res.json(vendors);
    } catch (error) {
        handleRouteError(res, error, 'vendor');
    }
});

// POST /api/vendors/quotations — add vendor quotation (purchase team only)
router.post('/quotations', authenticateToken, requirePermission('purchase_price.add'), async (req, res) => {
    try {
        const { enquiryItemId, vendorId, notes } = req.body;

        if (!isValidId(enquiryItemId)) return res.status(400).json({ error: 'A valid enquiry item is required' });
        if (!isValidId(vendorId)) return res.status(400).json({ error: 'A valid vendor is required' });

        const vendorPrice = toNonNegative(req.body.vendorPrice);
        if (Number.isNaN(vendorPrice)) return res.status(400).json({ error: 'Vendor price must be a number (0 or more)' });
        const freightPrice = req.body.freightPrice === undefined || req.body.freightPrice === null || req.body.freightPrice === ''
            ? 0
            : toNonNegative(req.body.freightPrice);
        if (Number.isNaN(freightPrice)) return res.status(400).json({ error: 'Freight must be a number (0 or more)' });

        const [item, vendor] = await Promise.all([
            EnquiryItem.findById(enquiryItemId).populate('enquiryId'),
            Vendor.findById(vendorId).select('name'),
        ]);
        if (!item) return res.status(404).json({ error: 'Enquiry item not found' });
        if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
        if (CLOSED_STATUSES.includes(item.status)) {
            return res.status(409).json({ error: `This item is already ${item.status}; it can't take new quotes` });
        }

        const quotation = await new VendorQuotation({
            enquiryItemId,
            vendorId,
            vendorPrice,
            freightPrice,
            enteredBy: req.user.id,
            notes,
        }).save();

        await recomputeCheapest(enquiryItemId);

        // Item moves to vendor_quoted — but never backwards from priced or a sales query
        if (QUOTABLE_STATUSES.includes(item.status)) {
            await EnquiryItem.updateOne({ _id: item._id }, { status: 'vendor_quoted', updatedAt: new Date() });
        }

        const enquiry = item.enquiryId;
        if (enquiry) {
            // Sourcing has now provided prices → stage 'updated'
            if (enquiry.stage === 'new' || enquiry.stage === 'open') {
                await Enquiry.updateOne({ _id: enquiry._id }, { stage: 'updated' });
            }
            // Tell the sales user who created the enquiry
            if (enquiry.createdBy) {
                await Notification.create({
                    userId: enquiry.createdBy,
                    message: `Vendor quote added for ${enquiry.enquiryNumber}`,
                    type: 'success',
                    link: `/sales.html?enquiryId=${enquiry._id}`,
                });
            }
        }

        await EnquiryItem.updateOne({ _id: item._id }, { $set: { quotedAt: new Date() } });
        {
            const material = await Product.findById(item.productId).select('materialName');
            await audit(req, {
                action: 'quotation.added', entity: 'quotation', entityId: quotation._id, entityLabel: vendor.name, enquiryId: enquiry ? enquiry._id : undefined,
                summary: `Entered a vendor price of ${inr(vendorPrice)}${freightPrice ? ` (+${inr(freightPrice)} freight)` : ''} from ${vendor.name} for ${material ? material.materialName : 'an item'} on ${enquiry ? enquiry.enquiryNumber : 'an enquiry'}`,
                details: { vendorPrice, freightPrice },
            });
        }

        const populated = await VendorQuotation.findById(quotation._id)
            .populate('enteredBy', 'name email')
            .populate('vendorId', 'name');

        res.status(201).json(populated);
    } catch (error) {
        handleRouteError(res, error, 'vendor quotation');
    }
});

// The newest quote each vendor has given for a material, as a Map of vendorId -> quote.
// One database-side pass (not "fetch every item that ever used this material, then every quote on them"), so it stays
// quick however many enquiries a popular material has been on. Pass vendorId to look at one vendor only.
async function latestQuotesForProduct(productId, vendorId) {
    const pipeline = [
        { $match: { productId: new mongoose.Types.ObjectId(productId) } },
        { $lookup: { from: VendorQuotation.collection.name, localField: '_id', foreignField: 'enquiryItemId', as: 'quote' } },
        { $unwind: '$quote' },
    ];
    if (vendorId) pipeline.push({ $match: { 'quote.vendorId': new mongoose.Types.ObjectId(vendorId) } });
    pipeline.push(
        { $sort: { 'quote.enteredAt': -1 } },
        { $group: { _id: '$quote.vendorId', quote: { $first: '$quote' } } },
    );
    const rows = await EnquiryItem.aggregate(pipeline);
    return new Map(rows.map(row => [String(row._id), row.quote]));
}

// GET /api/vendors/last-price?vendorId=...&productId=...
router.get('/last-price', authenticateToken, requireAnyPermission('purchase_price.add', 'vendor.view'), async (req, res) => {
    try {
        const vendorId = asString(req.query.vendorId);
        const productId = asString(req.query.productId);
        if (!isValidId(vendorId) || !isValidId(productId)) {
            return res.status(400).json({ error: 'vendorId and productId are required' });
        }

        const lastQuote = (await latestQuotesForProduct(productId, vendorId)).get(vendorId);
        if (!lastQuote) return res.json(null);

        res.json({
            price: lastQuote.vendorPrice,
            freight: lastQuote.freightPrice,
            date: lastQuote.enteredAt,
            isCheapest: lastQuote.isCheapest,
        });
    } catch (error) {
        handleRouteError(res, error, 'vendor last-price');
    }
});

// GET /api/vendors/bulk-price-history?productId=...
router.get('/bulk-price-history', authenticateToken, requireAnyPermission('purchase_price.add', 'vendor.view'), async (req, res) => {
    try {
        const productId = asString(req.query.productId);
        if (!productId) return res.status(400).json({ error: 'Product ID is required' });
        if (!isValidId(productId)) return res.status(400).json({ error: 'Invalid product ID' });

        // Two queries total: all vendors, and each vendor's latest quote for this material
        const [vendors, latestByVendor] = await Promise.all([
            Vendor.find({}, '_id name').sort({ name: 1 }),
            latestQuotesForProduct(productId),
        ]);

        res.json(vendors.map(vendor => {
            const lastQuote = latestByVendor.get(vendor._id.toString());
            return {
                vendorId: vendor._id,
                vendorName: vendor.name,
                price: lastQuote ? lastQuote.vendorPrice : null,
                freight: lastQuote ? lastQuote.freightPrice : null,
                totalPrice: lastQuote ? total(lastQuote) : null,
                date: lastQuote ? lastQuote.enteredAt : null,
                isCheapest: lastQuote ? lastQuote.isCheapest : false,
                hasHistory: !!lastQuote,
            };
        }));
    } catch (error) {
        handleRouteError(res, error, 'vendor price history');
    }
});

// GET /api/vendors/quotations/item/:itemId
router.get('/quotations/item/:itemId', authenticateToken, async (req, res) => {
    try {
        if (!isValidId(req.params.itemId)) return res.status(400).json({ error: 'Invalid item id' });
        const quotations = await VendorQuotation.find({ enquiryItemId: req.params.itemId })
            .populate('enteredBy', 'name email')
            .populate('vendorId', 'name specialization')
            .sort({ enteredAt: -1 });
        res.json(quotations);
    } catch (error) {
        handleRouteError(res, error, 'vendor quotations');
    }
});

// PUT /api/vendors/quotations/:id — update quotation (purchase team only)
router.put('/quotations/:id', authenticateToken, requirePermission('purchase_price.add'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid quotation id' });
        const { vendorId, notes } = req.body;

        if (!isValidId(vendorId)) return res.status(400).json({ error: 'A valid vendor is required' });
        const vendorPrice = toNonNegative(req.body.vendorPrice);
        if (Number.isNaN(vendorPrice)) return res.status(400).json({ error: 'Vendor price must be a number (0 or more)' });
        const freightPrice = req.body.freightPrice === undefined || req.body.freightPrice === null || req.body.freightPrice === ''
            ? 0
            : toNonNegative(req.body.freightPrice);
        if (Number.isNaN(freightPrice)) return res.status(400).json({ error: 'Freight must be a number (0 or more)' });

        if (!(await Vendor.exists({ _id: vendorId }))) return res.status(404).json({ error: 'Vendor not found' });

        const existing = await VendorQuotation.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Quotation not found' });

        // A quote the sales team has already selected for a closed item is part of the record
        const item = await EnquiryItem.findById(existing.enquiryItemId).select('status');
        if (item && CLOSED_STATUSES.includes(item.status)) {
            return res.status(409).json({ error: `This item is already ${item.status}; its quotes can't be edited` });
        }

        await VendorQuotation.updateOne(
            { _id: existing._id },
            { vendorId, vendorPrice, freightPrice, notes, enteredBy: req.user.id, enteredAt: new Date() },
            { runValidators: true }
        );
        // The edit may change which quote is cheapest (it never used to)
        await recomputeCheapest(existing.enquiryItemId);

        const quotation = await VendorQuotation.findById(existing._id)
            .populate('enteredBy', 'name email')
            .populate('vendorId', 'name');
        {
            const owner = await EnquiryItem.findById(existing.enquiryItemId).select('productId enquiryId');
            const [material, enquiryDoc] = owner ? await Promise.all([Product.findById(owner.productId).select('materialName'), Enquiry.findById(owner.enquiryId).select('enquiryNumber')]) : [];
            await audit(req, {
                action: 'quotation.changed', entity: 'quotation', entityId: existing._id, entityLabel: quotation.vendorId ? quotation.vendorId.name : '', enquiryId: owner ? owner.enquiryId : undefined,
                summary: `Changed the vendor price for ${material ? material.materialName : 'an item'} on ${enquiryDoc ? enquiryDoc.enquiryNumber : 'an enquiry'} to ${inr(vendorPrice)}${freightPrice ? ` (+${inr(freightPrice)} freight)` : ''}${quotation.vendorId ? ' from ' + quotation.vendorId.name : ''}`,
                details: { vendorPrice, freightPrice },
            });
        }
        res.json(quotation);
    } catch (error) {
        handleRouteError(res, error, 'vendor quotation');
    }
});

// POST /api/vendors/whatsapp-message
router.post('/whatsapp-message', authenticateToken, async (req, res) => {
    try {
        const { itemIds } = req.body;
        if (!Array.isArray(itemIds) || itemIds.length === 0 || !itemIds.every(isValidId)) {
            return res.status(400).json({ error: 'itemIds must be a list of valid item ids' });
        }

        const items = await EnquiryItem.find({ _id: { $in: itemIds } })
            .populate('productId')
            .populate({
                path: 'enquiryId',
                populate: { path: 'customerId', select: 'name contactPerson' },
            });

        // Skip lines whose product or enquiry has been removed rather than crashing the whole message
        const usable = items.filter(item => item.productId && item.enquiryId);
        if (usable.length === 0) return res.status(404).json({ error: 'No items found' });

        const enquiryMap = new Map();
        for (const item of usable) {
            const key = item.enquiryId._id.toString();
            if (!enquiryMap.has(key)) enquiryMap.set(key, { items: [] });
            enquiryMap.get(key).items.push(item);
        }

        const blocks = [];
        for (const data of enquiryMap.values()) {
            let block = `Hi,\n\nWe have a requirement for the following materials:\n\n`;
            data.items.forEach((item, index) => {
                const spec = item.productId.specification ? ` (${item.productId.specification})` : '';
                const brand = item.productId.brand ? ` - ${item.productId.brand}` : '';
                block += `${index + 1}. *${item.productId.materialName}*${spec}${brand}\n`;
                block += `   Quantity: ${item.quantity} ${item.productId.uom}\n`;
            });
            block += `\nPlease provide your best rates and availability at the earliest.\n\nThanks,\nProcurement Team`;
            blocks.push(block);
        }

        // Several enquiries used to run together into one block with no separator
        res.json({ message: blocks.join('\n\n----------\n\n') });
    } catch (error) {
        handleRouteError(res, error, 'vendor whatsapp-message');
    }
});

// POST /api/vendors — create vendor
router.post('/', authenticateToken, requirePermission('vendor.create'), async (req, res) => {
    try {
        const { contactPerson, email, phone, specialization, address } = req.body;
        const name = cleanName(req.body.name);
        if (!name) return res.status(400).json({ error: 'Vendor name is required' });
        if (!validEmail(email)) return res.status(400).json({ error: 'Email address is not valid' });
        const existing = await vendorNameTaken(name);
        // Hand back the one that exists, so the quote screen can simply pick it
        if (existing) return res.status(409).json({ error: `A vendor named "${existing.name}" already exists`, existing });

        const vendor = new Vendor({ name, contactPerson, email, phone, specialization, address });
        await vendor.save();
        await audit(req, { action: 'vendor.created', entity: 'vendor', entityId: vendor._id, entityLabel: vendor.name, summary: `Added vendor "${vendor.name}"` });
        res.status(201).json(vendor);
    } catch (error) {
        handleRouteError(res, error, 'vendor');
    }
});

// PUT /api/vendors/:id
router.put('/:id', authenticateToken, requirePermission('vendor.edit'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid vendor id' });
        const { contactPerson, email, phone, specialization, address } = req.body;

        const updateData = { contactPerson, email, phone, specialization, address };
        if (req.body.name !== undefined) {
            const name = cleanName(req.body.name);
            if (!name) return res.status(400).json({ error: 'Vendor name cannot be blank' });
            if (await vendorNameTaken(name, req.params.id)) return res.status(409).json({ error: `A vendor named "${name}" already exists` });
            updateData.name = name;
        }
        if (!validEmail(email)) return res.status(400).json({ error: 'Email address is not valid' });

        const vendor = await Vendor.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
        if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
        await audit(req, { action: 'vendor.updated', entity: 'vendor', entityId: vendor._id, entityLabel: vendor.name, summary: `Updated vendor "${vendor.name}"` });
        res.json(vendor);
    } catch (error) {
        handleRouteError(res, error, 'vendor');
    }
});

// DELETE /api/vendors/:id
router.delete('/:id', authenticateToken, requirePermission('vendor.delete'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid vendor id' });

        // Quotations (and the prices sales built on them) reference the vendor
        const quoteCount = await VendorQuotation.countDocuments({ vendorId: req.params.id });
        if (quoteCount > 0) {
            return res.status(409).json({
                error: `Cannot delete: this vendor has ${quoteCount} quotation${quoteCount === 1 ? '' : 's'} on record.`,
            });
        }
        // Materials that use this vendor for their default price would quietly stop being priced automatically
        const defaultFor = await Product.find({ defaultVendorId: req.params.id }).select('materialName').limit(3).lean();
        if (defaultFor.length) {
            return res.status(409).json({
                error: `Cannot delete: this vendor is the default price for ${defaultFor.map(p => `"${p.materialName}"`).join(', ')}${defaultFor.length === 3 ? ' and maybe more' : ''}. Remove or change those default prices first.`,
            });
        }

        const vendor = await Vendor.findByIdAndDelete(req.params.id);
        if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
        await audit(req, { action: 'vendor.deleted', entity: 'vendor', entityId: vendor._id, entityLabel: vendor.name, summary: `Deleted vendor "${vendor.name}"` });
        res.json({ message: 'Vendor deleted successfully' });
    } catch (error) {
        handleRouteError(res, error, 'vendor');
    }
});

module.exports = router;
