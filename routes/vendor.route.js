const express = require('express');
const { Vendor, VendorQuotation, EnquiryItem, Product, Enquiry, Customer, Notification } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all vendors
router.get('/', authenticateToken, async (req, res) => {
    try {
        const vendors = await Vendor.find().sort({ name: 1 });
        res.json(vendors);
    } catch (error) {
        console.error('Get vendors error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add vendor quotation
router.post('/quotations', authenticateToken, async (req, res) => {
    try {
        const { enquiryItemId, vendorId, vendorPrice, freightPrice, notes } = req.body;

        // Calculate total price
        const totalPrice = Number(vendorPrice) + (Number(freightPrice) || 0);

        // Check if this is the cheapest quote for this item
        const existingQuotes = await VendorQuotation.find({ enquiryItemId });

        let isCheapest = true;
        if (existingQuotes.length > 0) {
            const minPrice = Math.min(...existingQuotes.map(q => q.vendorPrice + q.freightPrice));
            if (totalPrice >= minPrice) {
                isCheapest = false;
            } else {
                // If this is new cheapest, update others to false (though they should already be false if they were higher than previous min, but good to ensure uniqueness if we enforce single cheapest)
                // actually, multiple could be cheapest if equal price.
                // But if this is strictly lower, then others are not cheapest.
                await VendorQuotation.updateMany(
                    { enquiryItemId },
                    { isCheapest: false }
                );
            }
        }

        const quotation = new VendorQuotation({
            enquiryItemId,
            vendorId,
            vendorPrice,
            freightPrice: freightPrice || 0,
            enteredBy: req.user.id,
            notes,
            isCheapest
        });

        await quotation.save();

        // Update item status to vendor_quoted
        await EnquiryItem.findByIdAndUpdate(enquiryItemId, {
            status: 'vendor_quoted',
            updatedAt: new Date()
        });

        // Notify Sales User (Creator of the Enquiry)
        const item = await EnquiryItem.findById(enquiryItemId).populate('enquiryId');
        if (item && item.enquiryId) {
            const enquiry = await Enquiry.findById(item.enquiryId._id);
            if (enquiry) {
                const notification = new Notification({
                    userId: enquiry.createdBy,
                    message: `New Vendor Quote for ${item.enquiryId.enquiryNumber}`,
                    type: 'success',
                    link: `/sales.html?enquiryId=${item.enquiryId._id}`
                });
                await notification.save();
            }
        }

        const populatedQuotation = await VendorQuotation.findById(quotation._id)
            .populate('enteredBy', 'name email')
            .populate('vendorId', 'name');

        res.status(201).json(populatedQuotation);
    } catch (error) {
        console.error('Add vendor quotation error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get last price for a product from a vendor
router.get('/last-price', authenticateToken, async (req, res) => {
    try {
        const { vendorId, productId } = req.query;

        // Find all enquiry items for this product
        const productItems = await EnquiryItem.find({ productId }, '_id');
        const itemIds = productItems.map(i => i._id);

        // Find the latest quotation for this vendor on any of these items
        const lastQuote = await VendorQuotation.findOne({
            vendorId,
            enquiryItemId: { $in: itemIds }
        })
            .sort({ enteredAt: -1 })
            .populate('enquiryItemId'); // optional, if we want to show which enquiry it was

        if (!lastQuote) {
            return res.json(null);
        }

        res.json({
            price: lastQuote.vendorPrice,
            freight: lastQuote.freightPrice,
            date: lastQuote.enteredAt,
            isCheapest: lastQuote.isCheapest
        });

    } catch (error) {
        console.error('Get last price error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get bulk price history for all vendors for a specific product
router.get('/bulk-price-history', authenticateToken, async (req, res) => {
    try {
        const { productId } = req.query;

        if (!productId) {
            return res.status(400).json({ error: 'Product ID is required' });
        }

        // Find all enquiry items for this product
        const productItems = await EnquiryItem.find({ productId }, '_id');
        const itemIds = productItems.map(i => i._id);

        // Find all vendors
        const vendors = await Vendor.find({}, '_id name');

        // For each vendor, find their latest quotation for this product
        const priceHistory = await Promise.all(
            vendors.map(async (vendor) => {
                const lastQuote = await VendorQuotation.findOne({
                    vendorId: vendor._id,
                    enquiryItemId: { $in: itemIds }
                })
                    .sort({ enteredAt: -1 });

                return {
                    vendorId: vendor._id,
                    vendorName: vendor.name,
                    price: lastQuote ? lastQuote.vendorPrice : null,
                    freight: lastQuote ? lastQuote.freightPrice : null,
                    totalPrice: lastQuote ? lastQuote.vendorPrice + lastQuote.freightPrice : null,
                    date: lastQuote ? lastQuote.enteredAt : null,
                    isCheapest: lastQuote ? lastQuote.isCheapest : false,
                    hasHistory: !!lastQuote
                };
            })
        );

        res.json(priceHistory);

    } catch (error) {
        console.error('Get bulk price history error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get vendor quotations for an item
router.get('/quotations/item/:itemId', authenticateToken, async (req, res) => {
    try {
        const quotations = await VendorQuotation.find({ enquiryItemId: req.params.itemId })
            .populate('enteredBy', 'name email')
            .populate('vendorId', 'name specialization')
            .sort({ enteredAt: -1 });

        res.json(quotations);
    } catch (error) {
        console.error('Get quotations error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update vendor quotation
router.put('/quotations/:id', authenticateToken, async (req, res) => {
    try {
        const { vendorId, vendorPrice, freightPrice, notes } = req.body;

        const quotation = await VendorQuotation.findByIdAndUpdate(
            req.params.id,
            {
                vendorId,
                vendorPrice,
                freightPrice: freightPrice || 0,
                notes,
                enteredBy: req.user.id, // Track who updated it
                enteredAt: new Date() // Update timestamp
            },
            { new: true }
        ).populate('enteredBy', 'name email').populate('vendorId', 'name');

        if (!quotation) {
            return res.status(404).json({ error: 'Quotation not found' });
        }

        res.json(quotation);
    } catch (error) {
        console.error('Update quotation error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Generate WhatsApp message for selected items
router.post('/whatsapp-message', authenticateToken, async (req, res) => {
    try {
        const { itemIds } = req.body;

        const items = await EnquiryItem.find({ _id: { $in: itemIds } })
            .populate('productId')
            .populate({
                path: 'enquiryId',
                populate: { path: 'customerId', select: 'name contactPerson' }
            });

        if (items.length === 0) {
            return res.status(404).json({ error: 'No items found' });
        }

        // Group items by enquiry
        const enquiryMap = {};
        for (const item of items) {
            const enquiryId = item.enquiryId._id.toString();
            if (!enquiryMap[enquiryId]) {
                enquiryMap[enquiryId] = {
                    enquiryNumber: item.enquiryId.enquiryNumber,
                    customerName: item.enquiryId.customerId.name,
                    items: []
                };
            }
            enquiryMap[enquiryId].items.push(item);
        }

        // Generate message
        let message = '';

        for (const [enquiryId, data] of Object.entries(enquiryMap)) {
            // message += `*Enquiry Reference:* ${data.enquiryNumber}\n\n`; // Optional to show enquiry number
            message += `Hi,\n\nWe have a requirement for the following materials:\n\n`;

            data.items.forEach((item, index) => {
                const spec = item.productId.specification ? ` (${item.productId.specification})` : '';
                const brand = item.productId.brand ? ` - ${item.productId.brand}` : '';
                message += `${index + 1}. *${item.productId.materialName}*${spec}${brand}\n`;
                message += `   Quantity: ${item.quantity} ${item.productId.uom}\n`;
            });

            message += `\nPlease provide your best rates and availability at the earliest.\n\n`;
            message += `Thanks,\nProcurement Team`;
        }


        res.json({ message });
    } catch (error) {
        console.error('Generate WhatsApp message error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name, contactPerson, email, phone, specialization, address } = req.body;

        const vendor = new Vendor({
            name,
            contactPerson,
            email,
            phone,
            specialization,
            address // Save address
        });

        await vendor.save();
        res.status(201).json(vendor);
    } catch (error) {
        console.error('Add vendor error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update vendor
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { name, contactPerson, email, phone, specialization, address } = req.body;

        const vendor = await Vendor.findByIdAndUpdate(
            req.params.id,
            { name, contactPerson, email, phone, specialization, address },
            { new: true, runValidators: true }
        );

        if (!vendor) {
            return res.status(404).json({ error: 'Vendor not found' });
        }

        res.json(vendor);
    } catch (error) {
        console.error('Update vendor error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete vendor
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const vendor = await Vendor.findByIdAndDelete(req.params.id);

        if (!vendor) {
            return res.status(404).json({ error: 'Vendor not found' });
        }

        res.json({ message: 'Vendor deleted successfully' });
    } catch (error) {
        console.error('Delete vendor error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
