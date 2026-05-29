const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Role } = require('../db');

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email }).populate('roleId', 'permissions category dashboardPage name color');
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Resolve role info — prefer dynamic roleId, fall back to legacy role field
        let roleInfo = null;
        if (user.roleId) {
            roleInfo = user.roleId; // populated
        } else if (user.role) {
            // Legacy user not yet migrated — find the corresponding default role
            const legacyMap = {
                admin: 'Admin',
                sales: 'Sales Operations – Manager',
                sourcing: 'Purchase Operations – Manager',
            };
            const roleName = legacyMap[user.role];
            if (roleName) {
                roleInfo = await Role.findOne({ name: roleName }).select('permissions category dashboardPage name color _id');
            }
        }

        // Generate JWT with roleId (keep legacy role for backward compat)
        const token = jwt.sign(
            {
                id: user._id,
                email: user.email,
                roleId: roleInfo ? roleInfo._id : null,
                role: user.role || null, // legacy fallback
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                // Dynamic role info
                roleId: roleInfo ? roleInfo._id : null,
                roleName: roleInfo ? roleInfo.name : user.role,
                roleColor: roleInfo ? roleInfo.color : '#3B9FD9',
                category: roleInfo ? roleInfo.category : null,
                dashboardPage: roleInfo ? roleInfo.dashboardPage : (user.role === 'admin' ? 'admin.html' : user.role === 'sourcing' ? 'sourcing.html' : 'sales.html'),
                permissions: roleInfo ? roleInfo.permissions : [],
                // Legacy field — used by old JS code during migration
                role: user.role || null,
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Logout (client-side token removal)
router.post('/logout', (req, res) => {
    res.json({ message: 'Logged out successfully' });
});

module.exports = router;
