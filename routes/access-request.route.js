// "I can't open this": a person asks the people who manage roles and employees for access, with one click.
// It only sends a notification (with a link straight to that person's record); nothing changes until an administrator acts.
const express = require('express');
const { Notification, User } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { cleanString } = require('../middleware/validate');
const { accessManagerRoleIds } = require('../utils/access');
const { audit } = require('../utils/audit');

const router = express.Router();

// POST /api/access-requests   { wants: "Reports", note: "I need to check weekly volumes" }
router.post('/', authenticateToken, async (req, res) => {
    try {
        const wants = cleanString(req.body && req.body.wants);
        const note = cleanString(req.body && req.body.note);
        if (!wants) return res.status(400).json({ error: 'Say what you need access to' });
        if (wants.length > 120) return res.status(400).json({ error: 'Please keep "what you need" under 120 characters' });
        if (note && note.length > 400) return res.status(400).json({ error: 'Please keep the note under 400 characters' });

        const managers = await User.find({ roleId: { $in: await accessManagerRoleIds() }, active: { $ne: false }, _id: { $ne: req.user.id } }).select('_id').lean();
        if (managers.length === 0) return res.json({ sent: 0, already: false });

        // asking again for the same thing within a day doesn't pile up notifications
        const link = `/masters.html?type=employees&edit=${req.user.id}`;
        const message = `${req.user.name} (${req.user.roleName || 'no role'}) is asking for access to: ${wants}${note ? ` — "${note}"` : ''}`;
        const recent = await Notification.exists({ userId: managers[0]._id, link, message, createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } });
        if (recent) return res.json({ sent: managers.length, already: true });

        await Notification.insertMany(managers.map(m => ({ userId: m._id, message, type: 'warning', link })));
        await audit(req, { action: 'access.requested', entity: 'user', entityId: req.user.id, entityLabel: req.user.name, summary: `${req.user.name} asked for access to: ${wants}` });
        res.json({ sent: managers.length, already: false });
    } catch (error) {
        handleRouteError(res, error, 'access request');
    }
});

module.exports = router;
