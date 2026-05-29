const express = require('express');
const { Customer, Role, User } = require('../db');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/customers/my-team — clients assigned to me OR to my KAEs (supervisorId === me)
router.get('/my-team', authenticateToken, async (req, res) => {
    try {
        const myKAEs = await User.find({ supervisorId: req.user.id }).select('_id');
        const teamIds = [req.user.id, ...myKAEs.map(u => u._id)];
        const customers = await Customer.find({ assignedKAM: { $in: teamIds } })
            .populate('assignedKAM', 'name email roleId')
            .sort({ name: 1 });
        res.json(customers);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/customers — list all customers
router.get('/', authenticateToken, requirePermission('customer.view'), async (req, res) => {
    try {
        const customers = await Customer.find()
            .populate('assignedKAM', 'name email')
            .sort({ name: 1 });
        res.json(customers);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/customers/by-kam/:userId — customers assigned to a specific KAM
// Used by KAM Entry users to know which customers they own
router.get('/by-kam/:userId', authenticateToken, async (req, res) => {
    try {
        const customers = await Customer.find({ assignedKAM: req.params.userId })
            .populate('assignedKAM', 'name email roleId')
            .sort({ name: 1 });
        res.json(customers);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/customers — create customer
router.post('/', authenticateToken, requirePermission('customer.create'), async (req, res) => {
    try {
        const { name, contactPerson, email, phone, address, assignedKAM } = req.body;

        if (!name) return res.status(400).json({ error: 'Customer name is required' });

        // Validate assignedKAM if provided
        if (assignedKAM) {
            const kamUser = await User.findById(assignedKAM).populate('roleId', 'category');
            if (!kamUser) return res.status(400).json({ error: 'Assigned KAM user not found' });
            if (!kamUser.roleId || kamUser.roleId.category !== 'key_accounts') {
                return res.status(400).json({ error: 'Assigned KAM must be a Key Accounts user' });
            }
        }

        const customer = new Customer({
            name,
            contactPerson,
            email,
            phone,
            address,
            assignedKAM: assignedKAM || null,
        });

        await customer.save();
        const populated = await Customer.findById(customer._id).populate('assignedKAM', 'name email');
        res.status(201).json(populated);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/customers/:id — update customer
router.put('/:id', authenticateToken, requirePermission('customer.edit'), async (req, res) => {
    try {
        const { name, contactPerson, email, phone, address, assignedKAM } = req.body;

        // Validate assignedKAM if provided
        if (assignedKAM) {
            const kamUser = await User.findById(assignedKAM).populate('roleId', 'category');
            if (!kamUser) return res.status(400).json({ error: 'Assigned KAM user not found' });
            if (!kamUser.roleId || kamUser.roleId.category !== 'key_accounts') {
                return res.status(400).json({ error: 'Assigned KAM must be a Key Accounts user' });
            }
        }

        const updateData = { name, contactPerson, email, phone, address };
        // Allow explicitly unsetting KAM with null
        if (assignedKAM !== undefined) updateData.assignedKAM = assignedKAM || null;

        const customer = await Customer.findByIdAndUpdate(req.params.id, updateData, { new: true })
            .populate('assignedKAM', 'name email');

        if (!customer) return res.status(404).json({ error: 'Customer not found' });
        res.json(customer);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/customers/:id — delete customer
router.delete('/:id', authenticateToken, requirePermission('customer.delete'), async (req, res) => {
    try {
        const customer = await Customer.findByIdAndDelete(req.params.id);
        if (!customer) return res.status(404).json({ error: 'Customer not found' });
        res.json({ message: 'Customer deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
