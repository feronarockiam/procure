const express = require('express');
const { Enquiry, EnquiryItem, Product, Customer, Notification, User, Query } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Generate enquiry number
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

// Get all enquiries for current user
router.get('/', authenticateToken, async (req, res) => {
    try {
        let query = {};

        if (req.user.role === 'sales') {
            query.createdBy = req.user.id;
        } else if (req.user.role === 'sourcing') {
            // Find enquiries assigned to user OR enquiries having items assigned to user
            const assignedItems = await EnquiryItem.find({ assignedTo: req.user.id }).select('enquiryId');
            const enquiryIds = assignedItems.map(item => item.enquiryId);

            query = {
                $or: [
                    { assignedTo: req.user.id },
                    { _id: { $in: enquiryIds } }
                ]
            };
        }

        const enquiries = await Enquiry.find(query)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone')
            .sort({ createdAt: -1 });

        // Get items and query count for each enquiry
        const enquiriesWithDetails = await Promise.all(
            enquiries.map(async (enquiry) => {
                const [items, queryCount] = await Promise.all([
                    EnquiryItem.find({ enquiryId: enquiry._id })
                        .populate('productId')
                        .populate('assignedTo', 'name email')
                        .populate('selectedVendorQuoteId'),
                    Query.countDocuments({ enquiryId: enquiry._id })
                ]);

                return {
                    ...enquiry.toObject(),
                    items,
                    queryCount
                };
            })
        );

        res.json(enquiriesWithDetails);
    } catch (error) {
        console.error('Get enquiries error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create new enquiry
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { customerId, items } = req.body; // items: [{ productId, quantity }]

        if (!customerId) {
            return res.status(400).json({ error: 'Customer ID is required' });
        }

        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'At least one item is required' });
        }

        const enquiryNumber = await generateEnquiryNumber();

        const enquiry = new Enquiry({
            enquiryNumber,
            customerId,
            createdBy: req.user.id
        });

        await enquiry.save();

        // Create enquiry items
        const enquiryItems = await Promise.all(
            items.map(item => {
                const enquiryItem = new EnquiryItem({
                    enquiryId: enquiry._id,
                    productId: item.productId,
                    quantity: item.quantity
                });
                return enquiryItem.save();
            })
        );

        // Populate and return
        const populatedEnquiry = await Enquiry.findById(enquiry._id)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone');

        const populatedItems = await EnquiryItem.find({ enquiryId: enquiry._id })
            .populate('productId')
            .populate('assignedTo', 'name email');

        res.status(201).json({
            ...populatedEnquiry.toObject(),
            items: populatedItems
        });
    } catch (error) {
        console.error('Create enquiry error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Assign enquiry to sourcing
router.put('/:id/assign', authenticateToken, async (req, res) => {
    try {
        const { sourcingUserId } = req.body;

        const enquiry = await Enquiry.findById(req.params.id);
        if (!enquiry) {
            return res.status(404).json({ error: 'Enquiry not found' });
        }

        enquiry.assignedTo = sourcingUserId;
        await enquiry.save();

        // Update all items status to 'assigned'
        await EnquiryItem.updateMany(
            { enquiryId: enquiry._id },
            {
                $set: {
                    status: 'assigned',
                    assignedTo: sourcingUserId,
                    updatedAt: new Date()
                }
            }
        );

        // Create Notification for Sourcing User
        const notification = new Notification({
            userId: sourcingUserId,
            message: `New Enquiry Assigned: ${enquiry.enquiryNumber}`,
            type: 'info',
            link: `/sourcing.html?enquiryId=${enquiry._id}`
        });
        await notification.save();

        const populatedEnquiry = await Enquiry.findById(enquiry._id)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone');

        res.json(populatedEnquiry);
    } catch (error) {
        console.error('Assign enquiry error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Assign individual items in an enquiry
router.post('/:id/assign-items', authenticateToken, async (req, res) => {
    try {
        const { itemIds, sourcingUserId } = req.body;

        if (!itemIds || itemIds.length === 0) {
            return res.status(400).json({ error: 'No items selected' });
        }

        // Update selected items
        await EnquiryItem.updateMany(
            { _id: { $in: itemIds }, enquiryId: req.params.id },
            {
                $set: {
                    status: 'assigned',
                    assignedTo: sourcingUserId,
                    updatedAt: new Date()
                }
            }
        );

        // Create Notification
        const notification = new Notification({
            userId: sourcingUserId,
            message: `New Items Assigned in Enquiry`, // Improved message
            type: 'info',
            link: `/sourcing.html?enquiryId=${req.params.id}`
        });
        await notification.save();

        // Check if ALL items in the enquiry are now assigned
        // If so, update the parent enquiry's assignedTo (optional logic, but good for tracking)
        // But per requirements, enquiry level assignment is separate or "all".
        // We probably don't need to auto-set enquiry level assignedTo unless we want to mark it "fully assigned".
        // Let's verify if all items are assigned.
        const allItems = await EnquiryItem.find({ enquiryId: req.params.id });
        const allAssigned = allItems.every(item => item.assignedTo);

        let enquiryUpdates = {};
        if (allAssigned) {
            // If all items assigned, maybe mark enquiry? 
            // But they might be assigned to DIFFERENT people.
            // So better to leave enquiry.assignedTo as the "primary" or "original" assignee, or null if mixed.
            // For now, leave enquiry alone unless explicitly assigned via the other route.
        }

        // Return updated enquiry with items
        const enquiry = await Enquiry.findById(req.params.id)
            .populate('createdBy', 'name email')
            .populate('assignedTo', 'name email')
            .populate('customerId', 'name contactPerson address email phone');

        const items = await EnquiryItem.find({ enquiryId: req.params.id })
            .populate('productId')
            .populate('assignedTo', 'name email');

        res.json({
            ...enquiry.toObject(),
            items
        });

    } catch (error) {
        console.error('Assign items error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update enquiry item (edit quantity, delete)
router.put('/:id/items/:itemId', authenticateToken, async (req, res) => {
    try {
        const { quantity, deleted } = req.body;

        if (deleted) {
            await EnquiryItem.findByIdAndDelete(req.params.itemId);
            return res.json({ message: 'Item deleted' });
        }

        const item = await EnquiryItem.findById(req.params.itemId);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        if (quantity) item.quantity = quantity;
        item.updatedAt = new Date();
        await item.save();

        const populatedItem = await EnquiryItem.findById(item._id).populate('productId');
        res.json(populatedItem);
    } catch (error) {
        console.error('Update item error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Enter sales price
router.put('/:id/items/:itemId/sales-price', authenticateToken, async (req, res) => {
    try {
        const { salesPrice, selectedVendorQuoteId } = req.body;

        const item = await EnquiryItem.findById(req.params.itemId);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        item.salesPrice = salesPrice;
        if (selectedVendorQuoteId) {
            item.selectedVendorQuoteId = selectedVendorQuoteId;
        }
        item.status = 'sales_priced';
        item.updatedAt = new Date();
        await item.save();

        const populatedItem = await EnquiryItem.findById(item._id)
            .populate('productId')
            .populate('selectedVendorQuoteId');
        res.json(populatedItem);
    } catch (error) {
        console.error('Enter sales price error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Mark item as completed
router.put('/:id/items/:itemId/complete', authenticateToken, async (req, res) => {
    try {
        const item = await EnquiryItem.findById(req.params.itemId);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        item.status = 'completed';
        item.updatedAt = new Date();
        await item.save();

        // Check if all items completed -> mark enquiry as completed
        const allItems = await EnquiryItem.find({ enquiryId: item.enquiryId });
        const allCompleted = allItems.every(i => i.status === 'completed');

        if (allCompleted) {
            await Enquiry.findByIdAndUpdate(item.enquiryId, { status: 'completed' });
        }

        const populatedItem = await EnquiryItem.findById(item._id).populate('productId');
        res.json(populatedItem);
    } catch (error) {
        console.error('Mark complete error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Combine enquiries (items from multiple enquiries)
router.post('/combine', authenticateToken, async (req, res) => {
    try {
        const { targetEnquiryId, sourceItemIds } = req.body;
        // sourceItemIds: array of item IDs to move to target enquiry

        const targetEnquiry = await Enquiry.findById(targetEnquiryId);
        if (!targetEnquiry) {
            return res.status(404).json({ error: 'Target enquiry not found' });
        }

        // Get source enquiry IDs before moving items
        const sourceItems = await EnquiryItem.find({ _id: { $in: sourceItemIds } });
        const sourceEnquiryIds = [...new Set(sourceItems.map(item => item.enquiryId.toString()))];

        // Prepare update data
        const updateData = {
            enquiryId: targetEnquiryId,
            updatedAt: new Date()
        };

        // Auto-assign if target enquiry is assigned
        if (targetEnquiry.assignedTo) {
            updateData.status = 'assigned';
        }

        // Move items to target enquiry
        await EnquiryItem.updateMany(
            { _id: { $in: sourceItemIds } },
            { $set: updateData }
        );

        // Delete empty source enquiries
        for (const enquiryId of sourceEnquiryIds) {
            if (enquiryId !== targetEnquiryId.toString()) {
                const remainingItems = await EnquiryItem.countDocuments({ enquiryId });
                if (remainingItems === 0) {
                    await Enquiry.findByIdAndDelete(enquiryId);
                }
            }
        }

        // Check if all items in target enquiry are assigned
        const allTargetItems = await EnquiryItem.find({ enquiryId: targetEnquiryId });
        const allAssigned = allTargetItems.every(item => item.status !== 'pending');

        // If all items are now assigned (or further), ensure enquiry is assigned
        // (This covers case where we might have auto-assigned above)
        if (allAssigned && !targetEnquiry.assignedTo) {
            // If we want to auto-assign the enquiry itself, we'd need a user. 
            // But here we only auto-assign items IF enquiry is already assigned.
            // So we just leave it.
        } else if (!allAssigned && targetEnquiry.assignedTo) {
            // If for some reason we have pending items in an assigned enquiry, 
            // we might want to keep it assigned or warn. 
            // The user's request was specifically to AUTO-ASSIGN new items.
            // So we shouldn't need to clear assignment anymore if we did our job right.
            // But let's keep it safe: if we didn't auto-assign (e.g. logic change), we might clear.
            // However, with the new logic, new items become 'assigned', so this shouldn't trigger.
        }

        res.json({ message: 'Items combined successfully' });
    } catch (error) {
        console.error('Combine enquiries error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get queries for an enquiry
router.get('/:id/queries', authenticateToken, async (req, res) => {
    try {
        const queries = await Query.find({ enquiryId: req.params.id })
            .populate('senderId', 'name role')
            .sort({ createdAt: 1 });
        res.json(queries);
    } catch (error) {
        console.error('Get queries error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Send a query
router.post('/:id/queries', authenticateToken, async (req, res) => {
    try {
        const { message } = req.body;
        const enquiry = await Enquiry.findById(req.params.id);

        if (!enquiry) {
            return res.status(404).json({ error: 'Enquiry not found' });
        }

        const query = new Query({
            enquiryId: req.params.id,
            senderId: req.user.id,
            message
        });

        await query.save();

        // Create Notification for the other party
        let targetUserId;
        if (req.user.role === 'sourcing') {
            targetUserId = enquiry.createdBy;
        } else if (req.user.role === 'sales') {
            targetUserId = enquiry.assignedTo;
        }

        if (targetUserId) {
            const sender = await User.findById(req.user.id);
            const notification = new Notification({
                userId: targetUserId,
                message: `New Sales Query from ${sender.name} (${enquiry.enquiryNumber})`,
                type: 'info',
                link: req.user.role === 'sourcing' ? `/sales.html?enquiryId=${enquiry._id}` : `/sourcing.html?enquiryId=${enquiry._id}`
            });
            await notification.save();
        }

        const populatedQuery = await Query.findById(query._id).populate('senderId', 'name role');
        res.status(201).json(populatedQuery);
    } catch (error) {
        console.error('Send query error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete enquiry
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const enquiryId = req.params.id;

        // Delete all items first
        await EnquiryItem.deleteMany({ enquiryId });
        // Delete all queries
        await Query.deleteMany({ enquiryId });
        // Delete the enquiry itself
        await Enquiry.findByIdAndDelete(enquiryId);

        res.json({ message: 'Enquiry and related items deleted successfully' });
    } catch (error) {
        console.error('Delete enquiry error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Close entire enquiry as unsuccessful
router.put('/:id/unsuccessful', authenticateToken, async (req, res) => {
    try {
        const enquiryId = req.params.id;

        // Update all items that are not already completed or unsuccessful
        await EnquiryItem.updateMany(
            { enquiryId, status: { $nin: ['completed', 'unsuccessful'] } },
            { $set: { status: 'unsuccessful', updatedAt: new Date() } }
        );

        // Mark enquiry as closed/unsuccessful (if we have an enquiry status)
        await Enquiry.findByIdAndUpdate(enquiryId, {
            status: 'unsuccessful',
            updatedAt: new Date()
        });

        res.json({ message: 'Enquiry marked as unsuccessful' });
    } catch (error) {
        console.error('Enquiry unsuccessful error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Mark single item as unsuccessful
router.put('/:id/items/:itemId/unsuccessful', authenticateToken, async (req, res) => {
    try {
        const { itemId } = req.params;

        const item = await EnquiryItem.findById(itemId);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        item.status = 'unsuccessful';
        item.updatedAt = new Date();
        await item.save();

        // Check if all items are now closed (completed or unsuccessful)
        const allItems = await EnquiryItem.find({ enquiryId: item.enquiryId });
        const allClosed = allItems.every(i => ['completed', 'unsuccessful'].includes(i.status));

        if (allClosed) {
            // Update enquiry status if needed
            const allCompleted = allItems.every(i => i.status === 'completed');
            const allUnsuccessful = allItems.every(i => i.status === 'unsuccessful');

            let finalStatus = 'closed';
            if (allCompleted) finalStatus = 'completed';
            if (allUnsuccessful) finalStatus = 'unsuccessful';

            await Enquiry.findByIdAndUpdate(item.enquiryId, { status: finalStatus });
        }

        res.json(item);
    } catch (error) {
        console.error('Item unsuccessful error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
