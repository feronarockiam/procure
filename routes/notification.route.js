const express = require('express');
const { Notification } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get notifications for current user
router.get('/', authenticateToken, async (req, res) => {
    try {
        const notifications = await Notification.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .limit(20); // Limit to last 20
        res.json(notifications);
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Mark as read
router.put('/:id/read', authenticateToken, async (req, res) => {
    try {
        await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
        res.json({ message: 'Marked as read' });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Mark all as read
router.put('/read-all', authenticateToken, async (req, res) => {
    try {
        await Notification.updateMany({ userId: req.user.id, isRead: false }, { isRead: true });
        res.json({ message: 'All marked as read' });
    } catch (error) {
        console.error('Mark all read error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
