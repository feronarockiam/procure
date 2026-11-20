const express = require('express');
const bcrypt = require('bcryptjs');
const { User, Role, Customer, Enquiry, EnquiryItem, Notification } = require('../db');
const { authenticateToken, requirePermission, invalidateUserCache } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { isValidId, asString, cleanString } = require('../middleware/validate');
const { usersWithPermission, countAccessManagers } = require('../utils/access');
const { roleLeadsTeam, labelOf } = require('../constants/permissions');

const config = require('../config');
const { audit } = require('../utils/audit');
const MIN_PASSWORD_LENGTH = config.minPasswordLength();
const validEmail = (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// Emails are stored lower-cased and trimmed; older accounts may have any casing, so look up without case
const findByEmail = (email, exceptId) => {
    const query = { email };
    if (exceptId) query._id = { $ne: exceptId };
    return User.findOne(query).collation({ locale: 'en', strength: 2 }).select('_id');
};

const legacyRoleFor = (roleDoc) => roleDoc.category === 'admin' ? 'admin' : roleDoc.category === 'purchase' ? 'sourcing' : 'sales';

// Would taking `userId` out of the people who can manage roles and employees leave nobody?
// (Looks at what the roles allow, not at a role's name or category.)
const wouldLeaveNoAccessManager = async (userId) => (await countAccessManagers({ exceptUserId: userId })) === 0;

// teamMemberIds must be a list of valid ids (and never the manager themself)
const cleanTeamIds = (ids, selfId) => {
    if (!Array.isArray(ids) || !ids.every(isValidId)) return null;
    return ids.filter(id => id !== String(selfId));
};

// Nobody can give someone a role with more access than they hold themselves
const roleTooPowerful = (actorPermissions, roleDoc) => {
    const missing = (roleDoc.permissions || []).filter(k => !(actorPermissions || []).includes(k));
    return missing.length
        ? `You can't give someone the "${roleDoc.name}" role, because it allows things you can't do yourself: ${missing.slice(0, 3).map(k => `"${labelOf(k)}"`).join(', ')}${missing.length > 3 ? ' and more' : ''}.`
        : null;
};

// A supervisor has to be in a role that leads a team
const checkSupervisor = async (supervisorId) => {
    if (!isValidId(supervisorId)) return 'The team lead you chose is not a valid person.';
    const supervisor = await User.findById(supervisorId).populate('roleId');
    if (!supervisor) return 'The team lead you chose could not be found.';
    if (!supervisor.roleId || !roleLeadsTeam(supervisor.roleId)) {
        return `${supervisor.name} can't be a team lead, because their role (${supervisor.roleId ? supervisor.roleId.name : 'none'}) isn't set up to lead a team. You can change that in Roles.`;
    }
    return null;
};

const router = express.Router();

// GET /api/users — list all users (admin: user.view)
router.get('/', authenticateToken, requirePermission('user.view'), async (req, res) => {
    try {
        const users = await User.find()
            .select('-password')
            .populate('roleId', 'name color category dashboardPage leadsTeam')
            .populate('supervisorId', 'name email')
            .sort({ createdAt: -1 })
            .lean();
        // Tell the screen whether each person's role leads a team (older roles follow their name), so it never has to guess
        res.json(users.map(u => (u.roleId ? { ...u, roleId: { ...u.roleId, leadsTeam: roleLeadsTeam(u.roleId) } } : u)));
    } catch (error) {
        handleRouteError(res, error, 'user');
    }
});

// GET /api/users/sourcing — people work can be assigned to: everyone whose role can enter vendor prices
// (not "everyone in a role categorised as purchase", so a custom role with that ability appears too)
router.get('/sourcing', authenticateToken, async (req, res) => {
    try {
        res.json(await usersWithPermission('purchase_price.add', { select: '_id name email', populate: 'name color' }));
    } catch (error) {
        handleRouteError(res, error, 'user');
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
        handleRouteError(res, error, 'user');
    }
});

// GET /api/users/by-permission?permission=KEY — everyone whose role includes the permission.
// e.g. who can be a key account manager (enquiry.view.assigned_customers), who can enter vendor prices.
router.get('/by-permission', authenticateToken, async (req, res) => {
    try {
        const permission = asString(req.query.permission);
        if (!permission) return res.status(400).json({ error: 'permission query param required' });
        res.json(await usersWithPermission(permission));
    } catch (error) {
        handleRouteError(res, error, 'user');
    }
});

// GET /api/users/by-category?category=purchase|sales|key_accounts|admin
// Kept for older callers: users whose role belongs to that team.
router.get('/by-category', authenticateToken, async (req, res) => {
    try {
        const category = asString(req.query.category);
        if (!category) return res.status(400).json({ error: 'category query param required' });

        const roles = await Role.find({ category }).select('_id');
        const roleIds = roles.map(r => r._id);
        const users = await User.find({ roleId: { $in: roleIds }, active: { $ne: false } })
            .select('_id name email')
            .populate('roleId', 'name color category')
            .sort({ name: 1 });
        res.json(users);
    } catch (error) {
        handleRouteError(res, error, 'user');
    }
});

// GET /api/users/managers?category=X — people in roles that lead a team, optionally within one team
router.get('/managers', authenticateToken, async (req, res) => {
    try {
        const category = asString(req.query.category);
        const roles = await Role.find(category ? { category } : {});
        const leaderRoleIds = roles.filter(roleLeadsTeam).map(r => r._id);
        const users = await User.find({ roleId: { $in: leaderRoleIds }, active: { $ne: false } })
            .select('_id name email roleId')
            .populate('roleId', 'name color category')
            .sort({ name: 1 });
        res.json(users);
    } catch (error) {
        handleRouteError(res, error, 'user');
    }
});

// GET /api/users/entries?category=X — people in roles that do NOT lead a team (the ones who can be put on a team)
router.get('/entries', authenticateToken, async (req, res) => {
    try {
        const category = asString(req.query.category);
        const roles = await Role.find(category ? { category } : {});
        const memberRoleIds = roles.filter(r => !roleLeadsTeam(r)).map(r => r._id);
        const users = await User.find({ roleId: { $in: memberRoleIds }, active: { $ne: false } })
            .select('_id name email roleId supervisorId')
            .populate('roleId', 'name color category')
            .populate('supervisorId', 'name')
            .sort({ name: 1 });
        res.json(users);
    } catch (error) {
        handleRouteError(res, error, 'user');
    }
});

// POST /api/users — create user
router.post('/', authenticateToken, requirePermission('user.create'), async (req, res) => {
    try {
        const { roleId, password, supervisorId, teamMemberIds } = req.body;
        const name = cleanString(req.body.name);
        const email = cleanString(req.body.email)?.toLowerCase();

        if (!name) return res.status(400).json({ error: 'Name is required' });
        if (!validEmail(email)) return res.status(400).json({ error: 'A valid email address is required' });
        if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        }
        if (!isValidId(roleId)) return res.status(400).json({ error: 'Choose a role for this person' });

        const roleDoc = await Role.findById(roleId);
        if (!roleDoc) return res.status(400).json({ error: 'That role no longer exists. Choose another.' });
        const tooPowerful = roleTooPowerful(req.user.permissions, roleDoc);
        if (tooPowerful) return res.status(403).json({ error: tooPowerful });

        if (await findByEmail(email)) return res.status(409).json({ error: 'Email already in use' });

        if (supervisorId) {
            const problem = await checkSupervisor(supervisorId);
            if (problem) return res.status(400).json({ error: problem });
        }
        if (teamMemberIds !== undefined && teamMemberIds !== null && cleanTeamIds(teamMemberIds) === null) {
            return res.status(400).json({ error: 'teamMemberIds must be a list of valid user ids' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({
            name,
            email,
            roleId,
            role: legacyRoleFor(roleDoc),
            password: hashedPassword,
            supervisorId: supervisorId || null,
        });

        await user.save();

        // If creating a team lead with team members chosen, point those people at them
        const teamIds = roleLeadsTeam(roleDoc) ? cleanTeamIds(teamMemberIds, user._id) : [];
        if (teamIds && teamIds.length > 0) {
            await User.updateMany(
                { _id: { $in: teamIds } },
                { $set: { supervisorId: user._id } }
            );
        }

        const userResponse = await User.findById(user._id)
            .select('-password')
            .populate('roleId', 'name color category dashboardPage leadsTeam')
            .populate('supervisorId', 'name email');
        await audit(req, { action: 'user.created', entity: 'user', entityId: user._id, entityLabel: user.name, summary: `Added ${user.name} (${user.email}) as ${roleDoc.name}` });
        res.status(201).json(userResponse);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Email already in use' });
        }
        handleRouteError(res, error, 'user');
    }
});

// PUT /api/users/:id — update user
router.put('/:id', authenticateToken, requirePermission('user.edit'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
        const { roleId, password, supervisorId, teamMemberIds } = req.body;

        const existing = await User.findById(req.params.id).select('_id roleId');
        if (!existing) return res.status(404).json({ error: 'User not found' });

        const updateData = {};
        if (req.body.name !== undefined) {
            const name = cleanString(req.body.name);
            if (!name) return res.status(400).json({ error: 'Name cannot be blank' });
            updateData.name = name;
        }
        if (req.body.email !== undefined) {
            const email = cleanString(req.body.email)?.toLowerCase();
            if (!validEmail(email)) return res.status(400).json({ error: 'A valid email address is required' });
            if (await findByEmail(email, req.params.id)) return res.status(409).json({ error: 'Email already in use' });
            updateData.email = email;
        }

        let newRole = null;
        if (roleId !== undefined) {
            if (!isValidId(roleId)) return res.status(400).json({ error: 'That role no longer exists. Choose another.' });
            newRole = await Role.findById(roleId);
            if (!newRole) return res.status(400).json({ error: 'That role no longer exists. Choose another.' });

            const changingRole = !existing.roleId || existing.roleId.toString() !== roleId;
            if (changingRole) {
                if (req.params.id === req.user.id) {
                    return res.status(400).json({ error: 'You cannot change your own role' });
                }
                const tooPowerful = roleTooPowerful(req.user.permissions, newRole);
                if (tooPowerful) return res.status(403).json({ error: tooPowerful });

                // Don't strip the last person who can manage access
                const losesAccessControl = !['role.edit', 'user.edit'].every(k => (newRole.permissions || []).includes(k));
                if (losesAccessControl && await wouldLeaveNoAccessManager(req.params.id)) {
                    const current = existing.roleId ? await Role.findById(existing.roleId) : null;
                    const wasManager = current && ['role.edit', 'user.edit'].every(k => (current.permissions || []).includes(k));
                    if (wasManager) {
                        return res.status(400).json({ error: 'This is the only person who can manage roles and employees. Give someone else that access first.' });
                    }
                }
            }
            updateData.roleId = roleId;
            updateData.role = legacyRoleFor(newRole);
        }

        if (password) {
            if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
                return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
            }
            updateData.password = await bcrypt.hash(password, 10);
            updateData.passwordChangedAt = new Date();
        }

        // Turning someone off keeps their history but stops them signing in (use this instead of deleting)
        let activeChange = null;
        if (req.body.active !== undefined) {
            if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'active must be true or false' });
            if (!req.body.active) {
                if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account' });
                const current = existing.roleId ? await Role.findById(existing.roleId).select('permissions') : null;
                const managesAccess = current && ['role.edit', 'user.edit'].every(k => (current.permissions || []).includes(k));
                if (managesAccess && await wouldLeaveNoAccessManager(req.params.id)) {
                    return res.status(400).json({ error: 'This is the only person who can manage roles and employees, so they cannot be deactivated.' });
                }
            }
            updateData.active = req.body.active;
            activeChange = req.body.active;
        }

        if (supervisorId !== undefined) {
            if (supervisorId) {
                if (supervisorId === req.params.id) return res.status(400).json({ error: 'A person cannot be their own team lead' });
                const problem = await checkSupervisor(supervisorId);
                if (problem) return res.status(400).json({ error: problem });
            }
            updateData.supervisorId = supervisorId || null;
        }

        let teamIds;
        if (teamMemberIds !== undefined) {
            teamIds = cleanTeamIds(teamMemberIds, req.params.id);
            if (teamIds === null) return res.status(400).json({ error: 'teamMemberIds must be a list of valid user ids' });
        }

        invalidateUserCache(req.params.id); // before and after: no request can slip in with the old role in between
        const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
            .select('-password')
            .populate('roleId', 'name color category dashboardPage leadsTeam')
            .populate('supervisorId', 'name email');

        invalidateUserCache(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Someone moved out of a team-lead role no longer has a team
        if (newRole && !roleLeadsTeam(newRole)) {
            await User.updateMany({ supervisorId: user._id }, { $set: { supervisorId: null } });
            teamIds = undefined;
        }

        // Handle team assignment for a team lead
        if (teamIds !== undefined) {
            // Remove this person as team lead from people no longer in the list
            await User.updateMany(
                { supervisorId: req.params.id, _id: { $nin: teamIds } },
                { $set: { supervisorId: null } }
            );
            // Put the selected people on their team
            if (teamIds.length > 0) {
                await User.updateMany(
                    { _id: { $in: teamIds } },
                    { $set: { supervisorId: req.params.id } }
                );
            }
        }

        await audit(req, {
            action: activeChange === null ? 'user.updated' : (activeChange ? 'user.activated' : 'user.deactivated'),
            entity: 'user', entityId: user._id, entityLabel: user.name,
            summary: activeChange === null
                ? `Updated ${user.name}${updateData.roleId ? ` (role is now ${user.roleId ? user.roleId.name : 'changed'})` : ''}${password ? ' and set a new password' : ''}`
                : `${activeChange ? 'Turned access back on for' : 'Turned off access for'} ${user.name}`,
        });
        res.json(user);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Email already in use' });
        }
        handleRouteError(res, error, 'user');
    }
});

// DELETE /api/users/:id — delete user
router.delete('/:id', authenticateToken, requirePermission('user.delete'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });

        // Prevent self-deletion
        if (req.params.id === req.user.id) {
            return res.status(400).json({ error: 'You cannot delete your own account' });
        }

        const target = await User.findById(req.params.id).populate('roleId', 'permissions');
        if (!target) return res.status(404).json({ error: 'User not found' });
        const managesAccess = target.roleId && ['role.edit', 'user.edit'].every(k => (target.roleId.permissions || []).includes(k));
        if (managesAccess && await wouldLeaveNoAccessManager(req.params.id)) {
            return res.status(400).json({ error: 'This is the only person who can manage roles and employees, so they cannot be deleted.' });
        }

        const user = await User.findByIdAndDelete(req.params.id);
        invalidateUserCache(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Tidy everything that pointed at this person so nothing is left dangling:
        await Promise.all([
            // their reports lose a manager
            User.updateMany({ supervisorId: user._id }, { $set: { supervisorId: null } }),
            // their clients become unassigned
            Customer.updateMany({ assignedKAM: user._id }, { $set: { assignedKAM: null } }),
            // work that was waiting on them goes back to the queue
            EnquiryItem.updateMany(
                { assignedTo: user._id, status: 'assigned' },
                { $set: { assignedTo: null, status: 'unassigned', updatedAt: new Date() } }
            ),
            // already-progressed items keep their status but lose the dead assignee
            EnquiryItem.updateMany(
                { assignedTo: user._id, status: { $nin: ['assigned', 'completed', 'unsuccessful'] } },
                { $set: { assignedTo: null, updatedAt: new Date() } }
            ),
            Enquiry.updateMany({ assignedTo: user._id }, { $set: { assignedTo: null } }),
            Notification.deleteMany({ userId: user._id }),
        ]);

        await audit(req, { action: 'user.deleted', entity: 'user', entityId: user._id, entityLabel: user.name, summary: `Deleted ${user.name} (${user.email})` });
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        handleRouteError(res, error, 'user');
    }
});

module.exports = router;
