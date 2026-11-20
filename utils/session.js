const crypto = require('crypto');
const {
    DEFAULT_ROLES, effectiveLanding, allowedLinks, roleLeadsTeam,
} = require('../constants/permissions');

// Users made before roles existed only have a legacy word ('admin' | 'sales' | 'sourcing');
// they get the matching built-in role's access.
const LEGACY_ROLE_NAMES = {
    admin: 'Admin',
    sales: 'Sales Operations – Manager',
    sourcing: 'Purchase Operations – Manager',
};
const legacyAccess = (legacyRole) => {
    const def = DEFAULT_ROLES.find(r => r.name === LEGACY_ROLE_NAMES[legacyRole]);
    return def ? { ...def, _id: null } : null;
};

// A short fingerprint of everything about a role that changes what the screen should show.
// Sent with every response; when it changes, the browser fetches /auth/me and refreshes itself.
const accessVersion = (access) => crypto
    .createHash('sha1')
    .update([
        access.name, access.color, access.category, access.dashboardPage, String(roleLeadsTeam(access)),
        [...(access.permissions || [])].sort().join(','),
    ].join('|'))
    .digest('hex')
    .slice(0, 12);

// What the browser stores about the signed-in person. `access` is the role (or legacy equivalent).
const sessionPayload = (user, access) => {
    const permissions = (access && access.permissions) || [];
    const landingPage = access ? effectiveLanding({ permissions, category: access.category, dashboardPage: access.dashboardPage }) : null;
    return {
        id: user._id,
        email: user.email,
        name: user.name,
        roleId: access && access._id ? access._id : null,
        roleName: access ? access.name : user.role,
        roleColor: access ? access.color : '#3B9FD9',
        category: access ? access.category : null,
        leadsTeam: access ? roleLeadsTeam(access) : false,
        permissions,
        // Where to go after login, and which menu links to show. Both come from the server so the
        // browser can't disagree with it. Null landing page = this role can't open any screen yet.
        landingPage,
        dashboardPage: landingPage,
        links: allowedLinks(permissions),
        accessVersion: access ? accessVersion(access) : null,
        role: user.role || null, // legacy field some older code still reads
    };
};

module.exports = { legacyAccess, accessVersion, sessionPayload, LEGACY_ROLE_NAMES };
