const express = require('express');
const { AuditLog } = require('../db');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { isValidId, asString, escapeRegex } = require('../middleware/validate');

const router = express.Router();

// The kinds of activity a person can filter by, in their words
const TYPES = {
    enquiries: { entity: { $in: ['enquiry', 'item'] } },
    prices:    { entity: 'quotation' },
    people:    { entity: { $in: ['user', 'role'] }, action: { $not: /^auth\./ } },
    masters:   { entity: { $in: ['customer', 'vendor', 'material'] } },
    signins:   { action: /^auth\./ },
};

// GET /api/audit/people — everyone who appears in the log (for the "Person" filter)
router.get('/people', authenticateToken, requirePermission('audit.view'), async (req, res) => {
    try {
        const rows = await AuditLog.aggregate([
            { $match: { 'actor.id': { $ne: null } } },
            { $group: { _id: '$actor.id', name: { $last: '$actor.name' } } },
            { $sort: { name: 1 } },
            { $limit: 500 },
        ]);
        res.json(rows.map(r => ({ id: r._id, name: r.name || 'Unknown' })));
    } catch (error) {
        handleRouteError(res, error, 'activity log');
    }
});

// GET /api/audit — the activity log, newest first, a page at a time.
//   ?type=enquiries|prices|people|masters|signins   ?actor=<person id>   ?q=text   ?from=&to=  (dates)   ?before=<cursor>   ?limit=
router.get('/', authenticateToken, requirePermission('audit.view'), async (req, res) => {
    try {
        const filter = {};
        const type = asString(req.query.type);
        if (type) {
            if (!TYPES[type]) return res.status(400).json({ error: `type must be one of: ${Object.keys(TYPES).join(', ')}` });
            Object.assign(filter, TYPES[type]);
        }
        const actor = asString(req.query.actor);
        if (actor) {
            if (!isValidId(actor)) return res.status(400).json({ error: 'Invalid person' });
            filter['actor.id'] = actor;
        }
        const q = asString(req.query.q);
        if (q && q.trim()) {
            const pattern = new RegExp(escapeRegex(q.trim().slice(0, 60)), 'i');
            filter.$or = [{ summary: pattern }, { entityLabel: pattern }, { 'actor.name': pattern }];
        }

        const parseDate = (value, name) => {
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`${name} is not a valid date`), { badRequest: true });
            return date;
        };
        // "from" and "to" are whole days (to = the end of that day); "before" is where the previous page stopped
        const when = {};
        try {
            if (asString(req.query.from)) { const start = parseDate(req.query.from, 'from'); start.setHours(0, 0, 0, 0); when.$gte = start; }
            const to = asString(req.query.to) ? parseDate(req.query.to, 'to') : null;
            if (to) to.setHours(23, 59, 59, 999);
            const before = asString(req.query.before) ? parseDate(req.query.before, 'before') : null;
            if (before && (!to || before <= to)) when.$lt = before;
            else if (to) when.$lte = to;
        } catch (error) {
            if (error.badRequest) return res.status(400).json({ error: error.message });
            throw error;
        }
        if (Object.keys(when).length) filter.at = when;

        const limit = Math.min(200, Math.max(1, parseInt(asString(req.query.limit), 10) || 50));
        const rows = await AuditLog.find(filter).sort({ at: -1 }).limit(limit + 1).lean();
        const more = rows.length > limit;
        const events = rows.slice(0, limit);
        res.json({ events, nextBefore: more ? events[events.length - 1].at : null });
    } catch (error) {
        handleRouteError(res, error, 'activity log');
    }
});

module.exports = router;
