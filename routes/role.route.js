const express = require('express');
const router = express.Router();
const { Role, User } = require('../db');
const { authenticateToken, requirePermission, requireAnyPermission, invalidateRoleCache } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { audit } = require('../utils/audit');
const { isValidId, cleanString } = require('../middleware/validate');
const { countAccessManagers } = require('../utils/access');
const {
    DEFAULT_ROLES, TEAMS, PAGES,
    normalizePermissions, explainAdded, allowedPages, effectiveLanding, roleLeadsTeam,
    describeRole, roleWarnings, buildCatalogue, labelOf,
} = require('../constants/permissions');

const TEAM_VALUES = TEAMS.map(t => t.value);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const TEAM_PAGE_FALLBACK = { admin: 'admin.html', sales: 'sales.html', purchase: 'sourcing.html', key_accounts: 'key-accounts.html' };

// ── Presenting a role ────────────────────────────────────────────────────────

const countByRole = async () => {
    const rows = await User.aggregate([{ $group: { _id: '$roleId', count: { $sum: 1 } } }]);
    return new Map(rows.filter(r => r._id).map(r => [String(r._id), r.count]));
};

// A role plus everything the screens want to show about it, computed here so the pages never have to guess
const present = (role, userCount = 0) => {
    const plain = role.toObject ? role.toObject() : role;
    const permissions = plain.permissions || [];
    return {
        ...plain,
        leadsTeam: roleLeadsTeam(plain),
        landingPage: effectiveLanding(plain),
        userCount,
        summary: describeRole(permissions),
        warnings: roleWarnings(permissions),
    };
};

// ── What the actor may hand out ──────────────────────────────────────────────

// Nobody can give away access they don't have. Otherwise anyone who can edit roles could simply
// create a role with everything and give it to themselves.
const missingFrom = (actorPermissions, wanted) => (wanted || []).filter(k => !(actorPermissions || []).includes(k));
const cannotGrantMessage = (missing) =>
    `You can't give access you don't have yourself: ${missing.map(k => `"${labelOf(k)}"`).join(', ')}.`;

// ── Reading ──────────────────────────────────────────────────────────────────

// GET /api/roles/catalogue — everything the editor needs to draw itself, in plain language
router.get('/catalogue', authenticateToken, (req, res) => {
    res.json(buildCatalogue());
});

// GET /api/roles/assignable — the roles someone can choose from when adding or editing an employee.
// A lighter list than /roles, so people who manage employees don't also need to see role management.
router.get('/assignable', authenticateToken, requireAnyPermission('user.create', 'user.edit', 'role.view'), async (req, res) => {
    try {
        const [roles, counts] = await Promise.all([Role.find().sort({ isSystem: -1, name: 1 }), countByRole()]);
        const mine = req.user.permissions || [];
        res.json(roles.map(role => {
            const full = present(role, counts.get(String(role._id)) || 0);
            const missing = missingFrom(mine, full.permissions);
            return {
                _id: full._id, name: full.name, color: full.color, category: full.category,
                teamLabel: (TEAMS.find(t => t.value === full.category) || {}).label || full.category,
                description: full.description, leadsTeam: full.leadsTeam, landingPage: full.landingPage,
                userCount: full.userCount, summary: { lines: full.summary.lines },
                // roles with more access than the signed-in person has can't be handed out by them
                assignable: missing.length === 0,
                notAssignableReason: missing.length ? cannotGrantMessage(missing) : null,
            };
        }));
    } catch (err) {
        handleRouteError(res, err, 'role');
    }
});

// GET /api/roles — list all roles, with how many people hold each
router.get('/', authenticateToken, requirePermission('role.view'), async (req, res) => {
    try {
        const [roles, counts] = await Promise.all([Role.find().sort({ isSystem: -1, name: 1 }), countByRole()]);
        res.json(roles.map(role => present(role, counts.get(String(role._id)) || 0)));
    } catch (err) {
        handleRouteError(res, err, 'role');
    }
});

// POST /api/roles/preview — "what would this role mean?" for the editor's live summary.
// Nothing is saved. Tidies the choices (switches on what they need), then describes the result.
router.post('/preview', authenticateToken, requireAnyPermission('role.create', 'role.edit'), (req, res) => {
    const { category } = req.body || {};
    const normalized = normalizePermissions(req.body && req.body.permissions);
    const pages = allowedPages(normalized.permissions);
    res.json({
        permissions: normalized.permissions,
        added: normalized.added,
        notices: explainAdded(normalized.added),
        summary: describeRole(normalized.permissions),
        warnings: roleWarnings(normalized.permissions),
        pages: pages.map(({ file, label, help }) => ({ file, label, help })),
        landingPage: effectiveLanding({
            permissions: normalized.permissions,
            category: TEAM_VALUES.includes(category) ? category : null,
            dashboardPage: req.body && req.body.dashboardPage,
        }),
        // choices the signed-in person can't pass on (shown greyed out in the editor)
        notGrantable: missingFrom(req.user.permissions, normalized.permissions),
    });
});

// GET /api/roles/:id — one role
router.get('/:id', authenticateToken, requirePermission('role.view'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid role id' });
        const role = await Role.findById(req.params.id);
        if (!role) return res.status(404).json({ error: 'Role not found' });
        res.json(present(role, await User.countDocuments({ roleId: role._id })));
    } catch (err) {
        handleRouteError(res, err, 'role');
    }
});

// GET /api/roles/:id/members — who has this role
router.get('/:id/members', authenticateToken, requirePermission('role.view'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid role id' });
        const members = await User.find({ roleId: req.params.id }).select('_id name email').sort({ name: 1 });
        res.json(members);
    } catch (err) {
        handleRouteError(res, err, 'role');
    }
});

// ── Validating what the admin typed ──────────────────────────────────────────

// Returns { error } (a plain-language message) or { values } with tidied fields ready to save.
// `existing` is the role being edited (or null when creating).
const readRoleForm = (body, existing) => {
    const values = {};
    const creating = !existing;

    if (creating || body.name !== undefined) {
        const name = cleanString(body.name);
        if (!name) return { error: 'Give the role a name, for example "Sales Executive".' };
        if (name.length > 60) return { error: 'The role name is too long (60 characters at most).' };
        values.name = name;
    }

    if (creating || body.category !== undefined) {
        if (!TEAM_VALUES.includes(body.category)) {
            return { error: `Choose which team this role belongs to: ${TEAMS.map(t => t.label).join(', ')}.` };
        }
        values.category = body.category;
    }

    if (body.description !== undefined) {
        const description = typeof body.description === 'string' ? body.description.trim() : '';
        if (description.length > 200) return { error: 'The description is too long (200 characters at most).' };
        values.description = description;
    } else if (creating) {
        values.description = '';
    }

    if (body.color !== undefined && body.color !== null && body.color !== '') {
        if (!HEX_COLOR.test(body.color)) return { error: 'The badge colour is not valid.' };
        values.color = body.color;
    }

    if (body.leadsTeam !== undefined) {
        if (typeof body.leadsTeam !== 'boolean') return { error: '"Leads a team" must be yes or no.' };
        values.leadsTeam = body.leadsTeam;
    }

    let notices = [];
    if (creating || body.permissions !== undefined) {
        if (body.permissions !== undefined && (!Array.isArray(body.permissions) || !body.permissions.every(p => typeof p === 'string'))) {
            return { error: 'The permissions are not in a form we understand.' };
        }
        const normalized = normalizePermissions(body.permissions || []);
        // A permission the role already has but the app no longer knows is dropped quietly (otherwise an old role
        // could never be saved again). A new unknown one is a mistake worth reporting.
        const had = (existing && existing.permissions) || [];
        const obsolete = normalized.unknown.filter(k => had.includes(k));
        const unknownNew = normalized.unknown.filter(k => !had.includes(k));
        if (unknownNew.length > 0) {
            return { error: `These permissions are not recognised: ${unknownNew.join(', ')}.` };
        }
        values.permissions = normalized.permissions;
        notices = explainAdded(normalized.added);
        if (obsolete.length > 0) notices.push(`Removed ${obsolete.length === 1 ? 'a permission' : obsolete.length + ' permissions'} the app no longer has.`);
    }

    // The page they start on must be one they can open. Left out (or "automatic") = we choose.
    const permissions = values.permissions || (existing && existing.permissions) || [];
    const category = values.category || (existing && existing.category);
    // 'auto' = choose for them from scratch. Leaving the field out = keep the current screen while it is still valid.
    const chooseAuto = body.dashboardPage === 'auto';
    const wantedPage = chooseAuto ? undefined : body.dashboardPage;
    if (wantedPage !== undefined && wantedPage !== null && wantedPage !== '') {
        const page = PAGES.find(p => p.file === wantedPage);
        if (!page) return { error: `"${wantedPage}" is not a screen people can start on.` };
        if (!allowedPages(permissions).some(p => p.file === wantedPage)) {
            return { error: `People with this role can't open "${page.label}" yet. Choose another starting screen, or add what it needs.` };
        }
        values.dashboardPage = wantedPage;
    } else if (creating || body.permissions !== undefined || body.category !== undefined || body.dashboardPage !== undefined) {
        // keep the current starting screen when it is still valid, otherwise pick the best one automatically
        const current = existing && existing.dashboardPage;
        // Only one of the main screens is ever stored. A role that starts on a list instead (say Materials)
        // is worked out at login, so it follows the permissions if they change.
        const auto = effectiveLanding({ permissions, category, dashboardPage: chooseAuto || wantedPage !== undefined ? undefined : current });
        values.dashboardPage = PAGES.some(p => p.file === auto) ? auto : TEAM_PAGE_FALLBACK[category];
    }

    return { values, notices };
};

// ── Creating, changing, deleting ─────────────────────────────────────────────

// POST /api/roles — create role
router.post('/', authenticateToken, requirePermission('role.create'), async (req, res) => {
    try {
        const { values, notices, error } = readRoleForm(req.body || {}, null);
        if (error) return res.status(400).json({ error });

        const missing = missingFrom(req.user.permissions, values.permissions);
        if (missing.length) return res.status(403).json({ error: cannotGrantMessage(missing) });

        const role = await new Role({
            color: '#3B9FD9',
            ...values,
            isSystem: false,
            createdBy: req.user.id,
        }).save();

        await audit(req, { action: 'role.created', entity: 'role', entityId: role._id, entityLabel: role.name, summary: `Created the role "${role.name}"`, details: { permissions: role.permissions } });
        res.status(201).json({ ...present(role, 0), notices });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'A role with this name already exists. Choose a different name.' });
        handleRouteError(res, err, 'role');
    }
});

// PUT /api/roles/:id — update role
router.put('/:id', authenticateToken, requirePermission('role.edit'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid role id' });
        const role = await Role.findById(req.params.id);
        if (!role) return res.status(404).json({ error: 'Role not found' });

        const body = req.body || {};
        const { values, notices, error } = readRoleForm(body, role);
        if (error) return res.status(400).json({ error });

        const oldPermissions = role.permissions || [];
        const newPermissions = values.permissions || oldPermissions;

        // The built-in Admin role is what keeps the system manageable. Stripping its permissions or
        // renaming it could lock every administrator out, so only cosmetic changes (or extra access) are allowed.
        // (The editor resends every field on save, so compare values rather than just presence.)
        if (role.isSystem && role.category === 'admin') {
            const changed =
                !oldPermissions.every(p => newPermissions.includes(p)) ||
                (values.category !== undefined && values.category !== role.category) ||
                (values.name !== undefined && values.name !== role.name) ||
                (values.leadsTeam !== undefined && values.leadsTeam !== roleLeadsTeam(role));
            if (changed) {
                return res.status(403).json({ error: 'The built-in Admin role can only have its description and colour changed, or gain access.' });
            }
        }

        // You can add access you hold yourself, never more
        const missing = missingFrom(req.user.permissions, newPermissions.filter(p => !oldPermissions.includes(p)));
        if (missing.length) return res.status(403).json({ error: cannotGrantMessage(missing) });

        // Never leave nobody able to manage roles and employees, and never lock yourself out of this very page
        const lostManage = ['role.edit', 'user.edit'].some(k => oldPermissions.includes(k) && !newPermissions.includes(k));
        const lostRoleScreen = ['role.view', 'role.edit'].some(k => oldPermissions.includes(k) && !newPermissions.includes(k));
        if (lostRoleScreen && req.user.roleId && String(req.user.roleId) === String(role._id)) {
            return res.status(400).json({ error: 'You have this role yourself. Taking away access to Roles would lock you out of this page. Ask another administrator to make that change.' });
        }
        if (lostManage) {
            const left = await countAccessManagers({ overrides: new Map([[String(role._id), newPermissions]]) });
            if (left === 0) {
                return res.status(409).json({ error: 'That change would leave nobody able to manage roles and employees. Keep this access on at least one role that someone holds.' });
            }
        }

        // If the role stops leading a team, the people who reported to its members would report to a non-lead
        const wasLead = roleLeadsTeam(role);
        Object.assign(role, values);
        const nowLead = roleLeadsTeam(role);
        let cleared = 0;
        if (wasLead && !nowLead) {
            const memberIds = (await User.find({ roleId: role._id }).select('_id')).map(u => u._id);
            const result = await User.updateMany({ supervisorId: { $in: memberIds } }, { $set: { supervisorId: null } });
            cleared = result.modifiedCount || 0;
        }

        await role.save();
        invalidateRoleCache(role._id.toString()); // takes effect straight away on this server; others within seconds

        const resultNotices = [...notices];
        if (cleared > 0) resultNotices.push(`${cleared} ${cleared === 1 ? 'person' : 'people'} no longer ${cleared === 1 ? 'reports' : 'report'} to someone in this role, because it doesn't lead a team any more.`);
        {
            const added = newPermissions.filter(p => !oldPermissions.includes(p));
            const removed = oldPermissions.filter(p => !newPermissions.includes(p));
            await audit(req, {
                action: 'role.updated', entity: 'role', entityId: role._id, entityLabel: role.name,
                summary: added.length || removed.length
                    ? `Changed what the role \"${role.name}\" allows (${added.length} added, ${removed.length} removed)`
                    : `Updated the role \"${role.name}\"`,
                details: { added, removed },
            });
        }
        res.json({ ...present(role, await User.countDocuments({ roleId: role._id })), notices: resultNotices });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'A role with this name already exists. Choose a different name.' });
        handleRouteError(res, err, 'role');
    }
});

// DELETE /api/roles/:id — delete role (built-in roles are protected)
router.delete('/:id', authenticateToken, requirePermission('role.delete'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid role id' });
        const role = await Role.findById(req.params.id);
        if (!role) return res.status(404).json({ error: 'Role not found' });

        if (role.isSystem) {
            return res.status(403).json({ error: 'Built-in roles can be edited but not deleted.' });
        }

        // Check if any users are assigned this role
        const members = await User.find({ roleId: role._id }).select('name').sort({ name: 1 }).limit(4);
        const userCount = await User.countDocuments({ roleId: role._id });
        if (userCount > 0) {
            const names = members.slice(0, 3).map(m => m.name).join(', ');
            return res.status(409).json({
                error: `${userCount} ${userCount === 1 ? 'person still has' : 'people still have'} this role (${names}${userCount > 3 ? ' and others' : ''}). Give them a different role in Employees first.`,
            });
        }

        await Role.findByIdAndDelete(req.params.id);
        invalidateRoleCache(req.params.id);
        await audit(req, { action: 'role.deleted', entity: 'role', entityId: role._id, entityLabel: role.name, summary: `Deleted the role "${role.name}"` });
        res.json({ message: 'Role deleted successfully' });
    } catch (err) {
        handleRouteError(res, err, 'role');
    }
});

// POST /api/roles/seed — create any missing built-in roles (idempotent)
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
        handleRouteError(res, err, 'role');
    }
});

module.exports = router;
