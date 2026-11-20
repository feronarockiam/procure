const express = require('express');
const { Notification } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { isValidId } = require('../middleware/validate');

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
        handleRouteError(res, error, 'notification');
    }
});

// Mark as read
router.put('/:id/read', authenticateToken, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid notification id' });
        // Scoped to the caller: anyone could previously mark anyone else's notification as read
        const result = await Notification.updateOne({ _id: req.params.id, userId: req.user.id }, { isRead: true });
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Notification not found' });
        res.json({ message: 'Marked as read' });
    } catch (error) {
        console.error('Mark read error:', error);
        handleRouteError(res, error, 'notification');
    }
});

// Mark all as read
router.put('/read-all', authenticateToken, async (req, res) => {
    try {
        await Notification.updateMany({ userId: req.user.id, isRead: false }, { isRead: true });
        res.json({ message: 'All marked as read' });
    } catch (error) {
        console.error('Mark all read error:', error);
        handleRouteError(res, error, 'notification');
    }
});

module.exports = router;
