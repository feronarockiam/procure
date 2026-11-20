// Questions about "who is allowed to do what", answered from permissions rather than from role names or
// categories. A role called "Regional Sales Lead" works exactly like one called "Sales Manager" as long as
// it carries the same permissions.
const { Role, User } = require('../db');
const { roleLeadsTeam } = require('../constants/permissions');

// ids of every role that includes `permission`
const roleIdsWithPermission = async (permission) =>
    (await Role.find({ permissions: permission }).select('_id')).map(r => r._id);

// People whose role includes `permission` (same shape the pickers have always had)
const usersWithPermission = async (permission, { select = '_id name email', populate = 'name color category' } = {}) => {
    const roleIds = await roleIdsWithPermission(permission);
    return User.find({ roleId: { $in: roleIds }, active: { $ne: false } }).select(select).populate('roleId', populate).sort({ name: 1 });
};

// Can this person do `permission`? (reads their role as it is now)
const userHasPermission = async (userId, permission) => {
    const user = await User.findById(userId).populate('roleId', 'permissions');
    return !!(user && user.roleId && (user.roleId.permissions || []).includes(permission));
};

// The people who can change roles and employees. If nobody is left who can, nobody can ever fix access again.
const MANAGE_ACCESS = ['role.edit', 'user.edit'];
const accessManagerRoleIds = async (overrides = new Map()) => {
    const roles = await Role.find({}).select('_id permissions');
    return roles
        .filter(role => {
            const permissions = overrides.has(String(role._id)) ? overrides.get(String(role._id)) : role.permissions;
            return MANAGE_ACCESS.every(k => (permissions || []).includes(k));
        })
        .map(role => role._id);
};
// How many people could still manage access, ignoring `exceptUserId` and applying `overrides` (roleId -> permissions)
const countAccessManagers = async ({ exceptUserId = null, overrides } = {}) => {
    const roleIds = await accessManagerRoleIds(overrides);
    const query = { roleId: { $in: roleIds }, active: { $ne: false } }; // a deactivated person can't manage anything
    if (exceptUserId) query._id = { $ne: exceptUserId };
    return User.countDocuments(query);
};
const isAccessManager = async (userId) => {
    const user = await User.findById(userId).select('roleId');
    if (!user || !user.roleId) return false;
    return (await accessManagerRoleIds()).some(id => id.equals(user.roleId));
};

module.exports = {
    roleIdsWithPermission, usersWithPermission, userHasPermission,
    countAccessManagers, isAccessManager, accessManagerRoleIds, roleLeadsTeam,
};
