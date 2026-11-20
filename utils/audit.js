// The activity log. Call after something has actually happened:
//   await audit(req, { action: 'item.priced', entity: 'item', entityId, entityLabel, enquiryId, summary: 'Set the selling price…' });
//
// It must never get in the way of the work itself, so a failure to write is logged and swallowed.
const { AuditLog } = require('../db');

const DAY = 24 * 60 * 60 * 1000;

async function audit(req, { action, entity, entityId, entityLabel, enquiryId, summary, details, actor, ttlDays }) {
    try {
        const who = actor || (req && req.user
            ? { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.roleName }
            : {});
        await AuditLog.create({
            at: new Date(),
            actor: who,
            action, entity, entityId, entityLabel, enquiryId, summary, details,
            ip: req && req.ip,
            // sign-in noise is only worth keeping for a while; real changes are kept
            expireAt: ttlDays ? new Date(Date.now() + ttlDays * DAY) : undefined,
        });
    } catch (error) {
        console.error('Could not write to the activity log:', error.message);
    }
}

const inr = (value) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

module.exports = { audit, inr };
