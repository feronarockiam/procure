const express = require('express');
const { Customer } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all customers
router.get('/', authenticateToken, async (req, res) => {
    try {
        const customers = await Customer.find().sort({ name: 1 });
        res.json(customers);
    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create customer (admin only - for later)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name, contactPerson, email, phone, address } = req.body;

        const customer = new Customer({
            name,
            contactPerson,
            email,
            phone,
            address
        });

        await customer.save();
        res.status(201).json(customer);
    } catch (error) {
        console.error('Create customer error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update customer
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { name, contactPerson, email, phone, address } = req.body;

        const customer = await Customer.findByIdAndUpdate(
            req.params.id,
            { name, contactPerson, email, phone, address },
            { new: true, runValidators: true }
        );

        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        res.json(customer);
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete customer
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const customer = await Customer.findByIdAndDelete(req.params.id);

        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        res.json({ message: 'Customer deleted successfully' });
    } catch (error) {
        console.error('Delete customer error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
