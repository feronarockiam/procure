// The built-in Admin role means "everything". When the app gains a permission, the Admin role stored in the database
// (written by an older version) wouldn't have it, so administrators would be missing the new feature until someone ticked it.
// Once per start-up, add any permission the Admin role lacks. It only ever adds, never removes.
const { Role } = require('../db');
const { ALL_PERMISSIONS } = require('../constants/permissions');

let done = null;

function syncAdminRole({ force = false } = {}) {
    if (!done || force) {
        done = Role.updateMany(
            { isSystem: true, category: 'admin' },
            { $addToSet: { permissions: { $each: ALL_PERMISSIONS } } }
        ).catch(error => {
            done = null; // try again on the next request
            console.error('Could not bring the Admin role up to date:', error.message);
        });
    }
    return done;
}

module.exports = { syncAdminRole };
