const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Role } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { legacyAccess, sessionPayload } = require('../utils/session');
const { createLimiter, waitMessage } = require('../middleware/rateLimit');
const { invalidateUserCache } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const config = require('../config');

const router = express.Router();

// When the email isn't known we still do the same password work, so how long the answer takes doesn't reveal which emails exist
const DECOY_HASH = bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 10);

const signToken = (user, access) => jwt.sign(
    {
        id: user._id,
        email: user.email,
        roleId: access && access._id ? access._id : null,
        role: user.role || null, // legacy fallback
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
);

// Wrong passwords are counted per computer + email, so one person mistyping can't lock out everyone else,
// and a guessing script gets stopped. A correct sign-in clears the count.
const loginLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    max: () => Number(process.env.LOGIN_MAX_ATTEMPTS || 8),
});
const attemptKey = (req, email) => `${req.ip}|${String(email).trim().toLowerCase()}`;

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};

        // Strings only: an object here (e.g. {"$ne": null}) would be run as a Mongo query operator
        if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Case-insensitive match (accounts may have been stored with any casing)
        const key = attemptKey(req, email);
        const gate = loginLimiter.peek(key);
        if (!gate.allowed) {
            res.set('Retry-After', String(gate.retryAfterSeconds));
            return res.status(429).json({ error: waitMessage(gate.retryAfterSeconds) });
        }

        const user = await User.findOne({ email: email.trim() })
            .collation({ locale: 'en', strength: 2 });
        const validPassword = await bcrypt.compare(password, user ? user.password : DECOY_HASH) && !!user;
        if (!validPassword) {
            const result = loginLimiter.hit(key);
            await audit(req, {
                action: 'auth.login_failed', entity: 'user', entityId: user ? user._id : undefined,
                entityLabel: email.trim().slice(0, 120), summary: `Failed sign-in attempt for ${email.trim().slice(0, 120)}`,
                actor: { name: user ? user.name : 'Unknown', email: email.trim().slice(0, 120) }, ttlDays: 90,
            });
            if (!result.allowed) {
                res.set('Retry-After', String(result.retryAfterSeconds));
                return res.status(429).json({ error: waitMessage(result.retryAfterSeconds) });
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.active === false) {
            return res.status(403).json({ error: 'This account has been deactivated. Ask an administrator if you need access.' });
        }
        loginLimiter.reset(key);

        // Their role, or (only for accounts that predate roles) the built-in equivalent of the old word.
        // A role id that points at a role which no longer exists means no access: the same answer the
        // server gives on every other request, never a quiet upgrade to a built-in role.
        const access = user.roleId ? await Role.findById(user.roleId) : legacyAccess(user.role);

        const token = signToken(user, access);

        const previousLoginAt = user.lastLoginAt || null;
        await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
        invalidateUserCache(user._id);
        await audit(req, {
            action: 'auth.login', entity: 'user', entityId: user._id, entityLabel: user.email, summary: `${user.name} signed in`,
            actor: { id: user._id, name: user.name, email: user.email, role: access ? access.name : user.role }, ttlDays: 90,
        });

        res.json({ token, user: { ...sessionPayload(user, access), lastLoginAt: previousLoginAt } });
    } catch (error) {
        handleRouteError(res, error, 'login');
    }
});

// Who am I, and what can I do right now? The browser calls this when an administrator
// changes its role, so menus and buttons follow the change without logging in again.
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('email name role lastLoginAt');
        res.json({ user: sessionPayload(user, req.access) });
    } catch (error) {
        handleRouteError(res, error, 'me');
    }
});

// Change my own password
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Enter your current password and a new one' });
        }
        const min = config.minPasswordLength();
        if (newPassword.length < min) return res.status(400).json({ error: `The new password must be at least ${min} characters` });
        if (newPassword === currentPassword) return res.status(400).json({ error: 'The new password must be different from the current one' });

        const key = `pw|${req.user.id}`;
        const gate = loginLimiter.peek(key);
        if (!gate.allowed) return res.status(429).json({ error: waitMessage(gate.retryAfterSeconds) });

        const user = await User.findById(req.user.id);
        if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
            loginLimiter.hit(key);
            return res.status(400).json({ error: 'Your current password is not correct' });
        }
        loginLimiter.reset(key);
        await User.updateOne({ _id: user._id }, { $set: { password: await bcrypt.hash(newPassword, 10), passwordChangedAt: new Date() } });
        invalidateUserCache(user._id);
        await audit(req, { action: 'auth.password_changed', entity: 'user', entityId: user._id, entityLabel: user.email, summary: `${user.name} changed their own password` });
        // Every older session just ended, including this one, so hand back a fresh token and they stay signed in
        res.json({ message: 'Password changed', token: signToken(user, req.access) });
    } catch (error) {
        handleRouteError(res, error, 'change-password');
    }
});

// Logout (client-side token removal)
router.post('/logout', (req, res) => {
    res.json({ message: 'Logged out successfully' });
});

module.exports = router;
