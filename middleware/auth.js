const jwt = require('jsonwebtoken');
require('dotenv').config();

// In-memory role permission cache (avoids DB hit on every request)
// Structure: { roleId: { permissions, category, dashboardPage, name, cachedAt } }
const roleCache = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const getRoleFromCache = (roleId) => {
    const cached = roleCache[roleId];
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return cached;
    }
    return null;
};

const setRoleCache = (roleId, roleData) => {
    roleCache[roleId] = { ...roleData, cachedAt: Date.now() };
};

const invalidateRoleCache = (roleId) => {
    delete roleCache[roleId ? roleId.toString() : roleId];
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
        return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.user = {
        id: decoded.id,
        email: decoded.email,
        roleId: decoded.roleId,
        legacyRole: decoded.role || null,
    };

    if (decoded.roleId) {
        const cacheKey = decoded.roleId.toString();
        const cached = getRoleFromCache(cacheKey);

        if (cached) {
            req.user.permissions = cached.permissions;
            req.user.category = cached.category;
            req.user.dashboardPage = cached.dashboardPage;
            req.user.roleName = cached.name;
        } else {
            try {
                const { Role } = require('../db');
                const role = await Role.findById(decoded.roleId).select('permissions category dashboardPage name isSystem');
                if (role) {
                    setRoleCache(cacheKey, {
                        permissions: role.permissions,
                        category: role.category,
                        dashboardPage: role.dashboardPage,
                        name: role.name,
                        isSystem: role.isSystem,
                    });
                    req.user.permissions = role.permissions;
                    req.user.category = role.category;
                    req.user.dashboardPage = role.dashboardPage;
                    req.user.roleName = role.name;
                } else {
                    req.user.permissions = [];
                }
            } catch (err) {
                console.error('Auth middleware: failed to fetch role permissions', err.message);
                req.user.permissions = [];
            }
        }
    } else {
        req.user.permissions = getLegacyPermissions(decoded.role);
        req.user.category = decoded.role === 'admin' ? 'admin' : decoded.role === 'sourcing' ? 'purchase' : 'sales';
        req.user.dashboardPage = decoded.role === 'admin' ? 'admin.html' : decoded.role === 'sourcing' ? 'sourcing.html' : 'sales.html';
    }

    next();
};

const getLegacyPermissions = (role) => {
    const { DEFAULT_ROLES } = require('../constants/permissions');
    const mapping = {
        admin: 'Admin',
        sales: 'Sales Operations – Manager',
        sourcing: 'Purchase Operations – Manager',
    };
    const roleName = mapping[role];
    if (!roleName) return [];
    const found = DEFAULT_ROLES.find(r => r.name === roleName);
    return found ? found.permissions : [];
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

const requireRole = (...roles) => {
    return (req, res, next) => {
        const userRole = req.user.legacyRole || req.user.category;
        if (!roles.includes(userRole)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
};

module.exports = { authenticateToken, requirePermission, requireAnyPermission, requireRole, invalidateRoleCache };
