const express = require('express');
const router = express.Router();
const { Role } = require('../db');
const { authenticateToken, requirePermission, invalidateRoleCache } = require('../middleware/auth');
const { PERMISSIONS, PERMISSION_GROUPS, ALL_PERMISSIONS, DEFAULT_ROLES } = require('../constants/permissions');

// GET /api/roles/permissions — full permission catalogue (any authenticated user)
router.get('/permissions', authenticateToken, (req, res) => {
    res.json({ permissions: PERMISSIONS, groups: PERMISSION_GROUPS });
});

// GET /api/roles — list all roles
router.get('/', authenticateToken, requirePermission('role.view'), async (req, res) => {
    try {
        const roles = await Role.find().sort({ isSystem: -1, name: 1 });
        res.json(roles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/roles/:id — single role detail
router.get('/:id', authenticateToken, requirePermission('role.view'), async (req, res) => {
    try {
        const role = await Role.findById(req.params.id);
        if (!role) return res.status(404).json({ error: 'Role not found' });
        res.json(role);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/roles — create role
router.post('/', authenticateToken, requirePermission('role.create'), async (req, res) => {
    try {
        const { name, description, permissions, category, dashboardPage, color } = req.body;

        if (!name || !category || !dashboardPage) {
            return res.status(400).json({ error: 'name, category, and dashboardPage are required' });
        }

        // Validate permissions against known keys
        const invalidPerms = (permissions || []).filter(p => !ALL_PERMISSIONS.includes(p));
        if (invalidPerms.length > 0) {
            return res.status(400).json({ error: `Unknown permissions: ${invalidPerms.join(', ')}` });
        }

        const role = new Role({
            name: name.trim(),
            description: description || '',
            permissions: permissions || [],
            category,
            dashboardPage,
            color: color || '#3B9FD9',
            isSystem: false,
            createdBy: req.user.id,
        });

        await role.save();
        res.status(201).json(role);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ error: 'A role with this name already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/roles/:id — update role
router.put('/:id', authenticateToken, requirePermission('role.edit'), async (req, res) => {
    try {
        const role = await Role.findById(req.params.id);
        if (!role) return res.status(404).json({ error: 'Role not found' });

        const { name, description, permissions, category, dashboardPage, color } = req.body;

        // Validate permissions
        if (permissions) {
            const invalidPerms = permissions.filter(p => !ALL_PERMISSIONS.includes(p));
            if (invalidPerms.length > 0) {
                return res.status(400).json({ error: `Unknown permissions: ${invalidPerms.join(', ')}` });
            }
            role.permissions = permissions;
        }

        if (name !== undefined) role.name = name.trim();
        if (description !== undefined) role.description = description;
        if (category !== undefined) role.category = category;
        if (dashboardPage !== undefined) role.dashboardPage = dashboardPage;
        if (color !== undefined) role.color = color;

        await role.save();

        // Bust the permission cache for this role so changes take effect immediately
        invalidateRoleCache(role._id.toString());

        res.json(role);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ error: 'A role with this name already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/roles/:id — delete role (system roles are protected)
router.delete('/:id', authenticateToken, requirePermission('role.delete'), async (req, res) => {
    try {
        const role = await Role.findById(req.params.id);
        if (!role) return res.status(404).json({ error: 'Role not found' });

        if (role.isSystem) {
            return res.status(403).json({ error: 'System roles cannot be deleted' });
        }

        // Check if any users are assigned this role
        const { User } = require('../db');
        const userCount = await User.countDocuments({ roleId: role._id });
        if (userCount > 0) {
            return res.status(409).json({
                error: `Cannot delete: ${userCount} employee(s) are assigned this role. Reassign them first.`,
            });
        }

        await Role.findByIdAndDelete(req.params.id);
        invalidateRoleCache(req.params.id);
        res.json({ message: 'Role deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/roles/seed — seed default roles (admin only, idempotent)
router.post('/seed', authenticateToken, requirePermission('role.create'), async (req, res) => {
    try {
        const results = [];
        for (const roleData of DEFAULT_ROLES) {
            const existing = await Role.findOne({ name: roleData.name });
            if (existing) {
                results.push({ name: roleData.name, status: 'already exists' });
                continue;
            }
            const role = new Role({ ...roleData, createdBy: req.user.id });
            await role.save();
            results.push({ name: roleData.name, status: 'created' });
        }
        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
