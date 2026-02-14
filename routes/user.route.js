const express = require('express');
const { User } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all users (admin only)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get sourcing users (for assignment dropdown)
router.get('/sourcing', authenticateToken, async (req, res) => {
    try {
        const sourcingUsers = await User.find({ role: 'sourcing' })
            .select('_id name email')
            .sort({ name: 1 });
        res.json(sourcingUsers);
    } catch (error) {
        console.error('Get sourcing users error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create user (admin only)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const bcrypt = require('bcryptjs');
        const { name, email, role, password } = req.body;

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({
            name,
            email,
            role,
            password: hashedPassword
        });

        await user.save();

        const userResponse = user.toObject();
        delete userResponse.password;

        res.status(201).json(userResponse);
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update user
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { name, email, role, password } = req.body;

        const updateData = { name, email, role };

        // Only update password if provided
        if (password) {
            const bcrypt = require('bcryptjs');
            updateData.password = await bcrypt.hash(password, 10);
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete user
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
