const express = require('express');
const bcrypt = require('bcryptjs');
const { User, Role } = require('../db');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/users — list all users (admin: user.view)
router.get('/', authenticateToken, requirePermission('user.view'), async (req, res) => {
    try {
        const users = await User.find()
            .select('-password')
            .populate('roleId', 'name color category dashboardPage')
            .populate('supervisorId', 'name email')
            .sort({ createdAt: -1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/users/sourcing — legacy endpoint kept for old frontend code
// Returns purchase-category users (replaces the old role:'sourcing' filter)
router.get('/sourcing', authenticateToken, async (req, res) => {
    try {
        const purchaseRoles = await Role.find({ category: 'purchase' }).select('_id');
        const roleIds = purchaseRoles.map(r => r._id);
        const users = await User.find({ roleId: { $in: roleIds } })
            .select('_id name email')
            .sort({ name: 1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/users/my-kae-team — KAE users supervised by the current KAM
router.get('/my-kae-team', authenticateToken, async (req, res) => {
    try {
        const team = await User.find({ supervisorId: req.user.id })
            .select('-password')
            .populate('roleId', 'name color category')
            .sort({ name: 1 });
        res.json(team);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/users/by-category?category=purchase|sales|key_accounts|admin
// Returns users whose role belongs to the given category
router.get('/by-category', authenticateToken, async (req, res) => {
    try {
        const { category } = req.query;
        if (!category) return res.status(400).json({ error: 'category query param required' });

        const roles = await Role.find({ category }).select('_id');
        const roleIds = roles.map(r => r._id);
        const users = await User.find({ roleId: { $in: roleIds } })
            .select('_id name email')
            .populate('roleId', 'name color category')
            .sort({ name: 1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/users/managers?category=X — manager-role users, optionally filtered by category
router.get('/managers', authenticateToken, async (req, res) => {
    try {
        const { category } = req.query;
        const roleQuery = category ? { category } : {};
        const roles = await Role.find(roleQuery).select('_id name');
        const managerRoleIds = roles.filter(r => r.name.includes('Manager')).map(r => r._id);
        const users = await User.find({ roleId: { $in: managerRoleIds } })
            .select('_id name email roleId')
            .populate('roleId', 'name color category')
            .sort({ name: 1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/users/entries?category=X — entry-role users, optionally filtered by category
router.get('/entries', authenticateToken, async (req, res) => {
    try {
        const { category } = req.query;
        const roleQuery = category ? { category } : {};
        const roles = await Role.find(roleQuery).select('_id name');
        const entryRoleIds = roles.filter(r => r.name.includes('Entry')).map(r => r._id);
        const users = await User.find({ roleId: { $in: entryRoleIds } })
            .select('_id name email roleId supervisorId')
            .populate('roleId', 'name color category')
            .populate('supervisorId', 'name')
            .sort({ name: 1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/users — create user
router.post('/', authenticateToken, requirePermission('user.create'), async (req, res) => {
    try {
        const { name, email, roleId, password, role, supervisorId, teamMemberIds } = req.body;

        if (!password) return res.status(400).json({ error: 'Password is required' });
        if (!roleId) return res.status(400).json({ error: 'roleId is required' });

        const roleDoc = await Role.findById(roleId);
        if (!roleDoc) return res.status(400).json({ error: 'Invalid roleId — role not found' });

        if (supervisorId) {
            const supervisor = await User.findById(supervisorId).populate('roleId', 'name');
            if (!supervisor) return res.status(400).json({ error: 'Supervisor not found' });
            if (!supervisor.roleId?.name?.includes('Manager')) {
                return res.status(400).json({ error: 'Supervisor must be a manager-level user' });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({
            name,
            email,
            roleId,
            role: roleDoc.category === 'admin' ? 'admin' : roleDoc.category === 'purchase' ? 'sourcing' : 'sales',
            password: hashedPassword,
            supervisorId: supervisorId || null,
        });

        await user.save();

        // If creating a manager with pre-assigned team members, update those entry users
        if (teamMemberIds && Array.isArray(teamMemberIds) && teamMemberIds.length > 0) {
            await User.updateMany(
                { _id: { $in: teamMemberIds } },
                { $set: { supervisorId: user._id } }
            );
        }

        const userResponse = await User.findById(user._id)
            .select('-password')
            .populate('roleId', 'name color category dashboardPage')
            .populate('supervisorId', 'name email');
        res.status(201).json(userResponse);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Email already in use' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/users/:id — update user
router.put('/:id', authenticateToken, requirePermission('user.edit'), async (req, res) => {
    try {
        const { name, email, roleId, password, supervisorId, teamMemberIds } = req.body;

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (email !== undefined) updateData.email = email;

        if (roleId !== undefined) {
            const roleDoc = await Role.findById(roleId);
            if (!roleDoc) return res.status(400).json({ error: 'Invalid roleId — role not found' });
            updateData.roleId = roleId;
            updateData.role = roleDoc.category === 'admin' ? 'admin' : roleDoc.category === 'purchase' ? 'sourcing' : 'sales';
        }

        if (password) {
            updateData.password = await bcrypt.hash(password, 10);
        }

        if (supervisorId !== undefined) {
            if (supervisorId) {
                const supervisor = await User.findById(supervisorId).populate('roleId', 'name');
                if (!supervisor) return res.status(400).json({ error: 'Supervisor not found' });
                if (!supervisor.roleId?.name?.includes('Manager')) {
                    return res.status(400).json({ error: 'Supervisor must be a manager-level user' });
                }
            }
            updateData.supervisorId = supervisorId || null;
        }

        const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true })
            .select('-password')
            .populate('roleId', 'name color category dashboardPage')
            .populate('supervisorId', 'name email');

        if (!user) return res.status(404).json({ error: 'User not found' });

        // Handle team assignment for manager role
        if (teamMemberIds !== undefined && Array.isArray(teamMemberIds)) {
            // Remove this manager from entry users no longer in the list
            await User.updateMany(
                { supervisorId: req.params.id, _id: { $nin: teamMemberIds } },
                { $set: { supervisorId: null } }
            );
            // Assign selected entry users to this manager
            if (teamMemberIds.length > 0) {
                await User.updateMany(
                    { _id: { $in: teamMemberIds } },
                    { $set: { supervisorId: req.params.id } }
                );
            }
        }

        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/users/:id — delete user
router.delete('/:id', authenticateToken, requirePermission('user.delete'), async (req, res) => {
    try {
        // Prevent self-deletion
        if (req.params.id === req.user.id) {
            return res.status(400).json({ error: 'You cannot delete your own account' });
        }

        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
