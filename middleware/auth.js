const jwt = require('jsonwebtoken');
require('dotenv').config();
const { legacyAccess, accessVersion } = require('../utils/session');
const { roleLeadsTeam } = require('../constants/permissions');

// Short-lived cache of role data, so a request costs one user lookup and usually no role lookup.
// Kept short on purpose: on serverless hosting each instance has its own cache, and an edit to a role
// can only clear the cache of the instance that handled the edit. Everything else catches up within this window.
const roleCache = {};
const roleLookups = new Map(); // role lookups in progress, shared by requests that arrive together
const CACHE_TTL_MS = 15 * 1000;

// The same idea for the person behind a token: one database round trip saved on most requests.
// It is cleared the moment someone is edited or deleted through the app (invalidateUserCache), so on one server
// a deleted account stops working at once; another server instance notices within USER_CACHE_TTL_MS.
const userCache = new Map();
const userLookups = new Map(); // lookups in progress: a page fires several requests at once, and they can share one
const userCacheTtl = () => Number(process.env.USER_CACHE_TTL_MS ?? 10 * 1000);
const USER_CACHE_MAX = 500;
const invalidateUserCache = (userId) => {
    if (userId === undefined || userId === null) return;
    userCache.delete(String(userId));
    userLookups.delete(String(userId)); // a lookup already under way may carry the old answer
};

const getRoleFromCache = (roleId) => {
    const cached = roleCache[roleId];
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return cached.data;
    }
    return null;
};

const setRoleCache = (roleId, data) => {
    roleCache[roleId] = { data, cachedAt: Date.now() };
};

const invalidateRoleCache = (roleId) => {
    if (roleId === undefined || roleId === null) return;
    delete roleCache[roleId.toString()];
    roleLookups.delete(roleId.toString()); // a lookup already under way may carry the old permissions
};

// The part of a role a request needs
const toAccess = (role) => ({
    _id: role._id,
    name: role.name,
    color: role.color,
    category: role.category,
    dashboardPage: role.dashboardPage,
    leadsTeam: role.leadsTeam,
    permissions: role.permissions || [],
    isSystem: role.isSystem,
});

// The person behind a token: from memory when it is fresh, otherwise from the database (one lookup shared by
// every request that asks while it is in progress).
const loadAccount = async (userId) => {
    const key = String(userId);
    const ttl = userCacheTtl();
    if (ttl <= 0) {
        const { User } = require('../db');
        return User.findById(userId).select('_id email name roleId role active passwordChangedAt').lean();
    }
    const hit = userCache.get(key);
    if (hit && Date.now() - hit.cachedAt < ttl) return hit.account;
    if (userLookups.has(key)) return userLookups.get(key);

    const lookup = (async () => {
        const { User } = require('../db');
        const account = await User.findById(userId).select('_id email name roleId role active passwordChangedAt').lean();
        if (account) {
            if (userCache.size >= USER_CACHE_MAX) userCache.clear(); // simple bound; it refills in seconds
            userCache.set(key, { account, cachedAt: Date.now() });
        }
        return account;
    })().finally(() => userLookups.delete(key));
    userLookups.set(key, lookup);
    return lookup;
};

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        // 401 (not 403): the client treats 401 as "session over" and sends the user to login,
        // whereas 403 means "logged in but not allowed" and leaves them on a broken page.
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // The token only says who the user was when it was issued. Read the user as they are now,
    // so a deleted account stops working immediately and a role change applies without re-login.
    let account;
    try {
        account = await loadAccount(decoded.id);
    } catch (err) {
        console.error('Auth middleware: failed to load user', err.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (!account) {
        return res.status(401).json({ error: 'This account no longer exists' });
    }
    // A password change ends every session that started before it (someone who learned the old password is signed out)
    if (account.passwordChangedAt && decoded.iat < Math.floor(new Date(account.passwordChangedAt).getTime() / 1000)) {
        return res.status(401).json({ error: 'Your password was changed. Please sign in again.' });
    }
    // Switching someone off ends their access at once (their name stays on past work)
    if (account.active === false) {
        return res.status(401).json({ error: 'This account has been deactivated. Ask an administrator if you need access.' });
    }

    const currentRoleId = account.roleId ? account.roleId.toString() : null;
    const legacyRole = account.role || null;

    // The person's access as it is right now: their role, or the built-in equivalent of a legacy word
    let access = null;
    if (currentRoleId) {
        access = getRoleFromCache(currentRoleId);
        if (!access) {
            try {
                if (!roleLookups.has(currentRoleId)) {
                    const lookup = (async () => {
                        const { Role } = require('../db');
                        const role = await Role.findById(currentRoleId);
                        if (!role) return null;
                        const data = toAccess(role);
                        setRoleCache(currentRoleId, data);
                        return data;
                    })().finally(() => roleLookups.delete(currentRoleId));
                    roleLookups.set(currentRoleId, lookup);
                }
                access = await roleLookups.get(currentRoleId);
            } catch (err) {
                console.error('Auth middleware: failed to fetch role permissions', err.message);
            }
        }
    } else {
        access = legacyAccess(legacyRole);
    }
    // A missing or unreadable role means no access, never "everything"
    if (!access) access = { name: legacyRole || 'No role', category: null, dashboardPage: null, permissions: [] };

    req.user = {
        id: account._id.toString(),
        email: account.email,
        name: account.name,
        roleId: currentRoleId,
        legacyRole,
        roleName: access.name,
        category: access.category,
        dashboardPage: access.dashboardPage,
        leadsTeam: roleLeadsTeam(access),
        permissions: access.permissions || [],
    };
    req.access = access;

    // Lets the browser notice that an administrator changed this person's role
    res.set('X-Access-Version', accessVersion(access));

    next();
};

const requirePermission = (permissionKey) => {
    return (req, res, next) => {
        if (!req.user || !Array.isArray(req.user.permissions)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        if (!req.user.permissions.includes(permissionKey)) {
            return res.status(403).json({ error: `Permission required: ${permissionKey}` });
        }
        next();
    };
};

const requireAnyPermission = (...permissionKeys) => {
    return (req, res, next) => {
        if (!req.user || !Array.isArray(req.user.permissions)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const hasAny = permissionKeys.some(key => req.user.permissions.includes(key));
        if (!hasAny) {
            return res.status(403).json({ error: `One of these permissions required: ${permissionKeys.join(', ')}` });
        }
        next();
    };
};

module.exports = { authenticateToken, requirePermission, requireAnyPermission, invalidateRoleCache, invalidateUserCache };
