const express = require('express');
const { Vendor, VendorQuotation, EnquiryItem, Product, Enquiry, Customer, Notification } = require('../db');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/vendors
router.get('/', authenticateToken, requirePermission('vendor.view'), async (req, res) => {
    try {
        const vendors = await Vendor.find().sort({ name: 1 });
        res.json(vendors);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/vendors/quotations — add vendor quotation (purchase team only)
router.post('/quotations', authenticateToken, requirePermission('purchase_price.add'), async (req, res) => {
    try {
        const { enquiryItemId, vendorId, vendorPrice, freightPrice, notes } = req.body;

        const totalPrice = Number(vendorPrice) + (Number(freightPrice) || 0);

        // Recalculate cheapest: mark all existing quotes for this item as not cheapest,
        // then set cheapest = quote with strictly lowest total
        const existingQuotes = await VendorQuotation.find({ enquiryItemId });

        let isCheapest = true;
        if (existingQuotes.length > 0) {
            const minExisting = Math.min(...existingQuotes.map(q => q.vendorPrice + q.freightPrice));
            if (totalPrice > minExisting) {
                isCheapest = false;
            } else if (totalPrice < minExisting) {
                // New cheapest — demote all existing
                await VendorQuotation.updateMany({ enquiryItemId }, { isCheapest: false });
            } else {
                // Equal to existing cheapest — keep isCheapest: true for both (tie)
                isCheapest = true;
            }
        }

        const quotation = new VendorQuotation({
            enquiryItemId,
            vendorId,
            vendorPrice,
            freightPrice: freightPrice || 0,
            enteredBy: req.user.id,
            notes,
            isCheapest,
        });

        await quotation.save();

        // Update item status → vendor_quoted
        await EnquiryItem.findByIdAndUpdate(enquiryItemId, {
            status: 'vendor_quoted',
            updatedAt: new Date(),
        });

        // Advance enquiry stage to 'updated' (sourcing has provided prices)
        const item = await EnquiryItem.findById(enquiryItemId).populate('enquiryId');
        if (item && item.enquiryId) {
            const enquiry = item.enquiryId;
            if (enquiry.stage === 'new' || enquiry.stage === 'open') {
                await Enquiry.findByIdAndUpdate(enquiry._id, { stage: 'updated' });
            }

            // Notify the sales user who created the enquiry
            const fullEnquiry = await Enquiry.findById(enquiry._id);
            if (fullEnquiry) {
                await Notification.create({
                    userId: fullEnquiry.createdBy,
                    message: `Vendor quote added for ${enquiry.enquiryNumber}`,
                    type: 'success',
                    link: `/sales.html?enquiryId=${enquiry._id}`,
                });
            }
        }

        const populated = await VendorQuotation.findById(quotation._id)
            .populate('enteredBy', 'name email')
            .populate('vendorId', 'name');

        res.status(201).json(populated);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/vendors/last-price?vendorId=...&productId=...
router.get('/last-price', authenticateToken, async (req, res) => {
    try {
        const { vendorId, productId } = req.query;
        const productItems = await EnquiryItem.find({ productId }, '_id');
        const itemIds = productItems.map(i => i._id);

        const lastQuote = await VendorQuotation.findOne({
            vendorId,
            enquiryItemId: { $in: itemIds },
        }).sort({ enteredAt: -1 });

        if (!lastQuote) return res.json(null);

        res.json({
            price: lastQuote.vendorPrice,
            freight: lastQuote.freightPrice,
            date: lastQuote.enteredAt,
            isCheapest: lastQuote.isCheapest,
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/vendors/bulk-price-history?productId=...
router.get('/bulk-price-history', authenticateToken, async (req, res) => {
    try {
        const { productId } = req.query;
        if (!productId) return res.status(400).json({ error: 'Product ID is required' });

        const productItems = await EnquiryItem.find({ productId }, '_id');
        const itemIds = productItems.map(i => i._id);
        const vendors = await Vendor.find({}, '_id name');

        const priceHistory = await Promise.all(
            vendors.map(async (vendor) => {
                const lastQuote = await VendorQuotation.findOne({
                    vendorId: vendor._id,
                    enquiryItemId: { $in: itemIds },
                }).sort({ enteredAt: -1 });

                return {
                    vendorId: vendor._id,
                    vendorName: vendor.name,
                    price: lastQuote ? lastQuote.vendorPrice : null,
                    freight: lastQuote ? lastQuote.freightPrice : null,
                    totalPrice: lastQuote ? lastQuote.vendorPrice + lastQuote.freightPrice : null,
                    date: lastQuote ? lastQuote.enteredAt : null,
                    isCheapest: lastQuote ? lastQuote.isCheapest : false,
                    hasHistory: !!lastQuote,
                };
            })
        );

        res.json(priceHistory);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/vendors/quotations/item/:itemId
router.get('/quotations/item/:itemId', authenticateToken, async (req, res) => {
    try {
        const quotations = await VendorQuotation.find({ enquiryItemId: req.params.itemId })
            .populate('enteredBy', 'name email')
            .populate('vendorId', 'name specialization')
            .sort({ enteredAt: -1 });
        res.json(quotations);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/vendors/quotations/:id — update quotation (purchase team only)
router.put('/quotations/:id', authenticateToken, requirePermission('purchase_price.add'), async (req, res) => {
    try {
        const { vendorId, vendorPrice, freightPrice, notes } = req.body;

        const quotation = await VendorQuotation.findByIdAndUpdate(
            req.params.id,
            { vendorId, vendorPrice, freightPrice: freightPrice || 0, notes, enteredBy: req.user.id, enteredAt: new Date() },
            { new: true }
        ).populate('enteredBy', 'name email').populate('vendorId', 'name');

        if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
        res.json(quotation);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/vendors/whatsapp-message
router.post('/whatsapp-message', authenticateToken, async (req, res) => {
    try {
        const { itemIds } = req.body;

        const items = await EnquiryItem.find({ _id: { $in: itemIds } })
            .populate('productId')
            .populate({
                path: 'enquiryId',
                populate: { path: 'customerId', select: 'name contactPerson' },
            });

        if (items.length === 0) return res.status(404).json({ error: 'No items found' });

        const enquiryMap = {};
        for (const item of items) {
            const enquiryId = item.enquiryId._id.toString();
            if (!enquiryMap[enquiryId]) {
                enquiryMap[enquiryId] = {
                    enquiryNumber: item.enquiryId.enquiryNumber,
                    customerName: item.enquiryId.customerId.name,
                    items: [],
                };
            }
            enquiryMap[enquiryId].items.push(item);
        }

        let message = '';
        for (const data of Object.values(enquiryMap)) {
            message += `Hi,\n\nWe have a requirement for the following materials:\n\n`;
            data.items.forEach((item, index) => {
                const spec = item.productId.specification ? ` (${item.productId.specification})` : '';
                const brand = item.productId.brand ? ` - ${item.productId.brand}` : '';
                message += `${index + 1}. *${item.productId.materialName}*${spec}${brand}\n`;
                message += `   Quantity: ${item.quantity} ${item.productId.uom}\n`;
            });
            message += `\nPlease provide your best rates and availability at the earliest.\n\nThanks,\nProcurement Team`;
        }

        res.json({ message });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/vendors — create vendor
router.post('/', authenticateToken, requirePermission('vendor.create'), async (req, res) => {
    try {
        const { name, contactPerson, email, phone, specialization, address } = req.body;
        if (!name) return res.status(400).json({ error: 'Vendor name is required' });
        const vendor = new Vendor({ name, contactPerson, email, phone, specialization, address });
        await vendor.save();
        res.status(201).json(vendor);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/vendors/:id
router.put('/:id', authenticateToken, requirePermission('vendor.edit'), async (req, res) => {
    try {
        const { name, contactPerson, email, phone, specialization, address } = req.body;
        const vendor = await Vendor.findByIdAndUpdate(
            req.params.id,
            { name, contactPerson, email, phone, specialization, address },
            { new: true, runValidators: true }
        );
        if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
        res.json(vendor);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/vendors/:id
router.delete('/:id', authenticateToken, requirePermission('vendor.delete'), async (req, res) => {
    try {
        const vendor = await Vendor.findByIdAndDelete(req.params.id);
        if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
        res.json({ message: 'Vendor deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
