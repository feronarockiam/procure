/**
 * Fix Admin Script — safe to run at any time without wiping data.
 * 1. Ensures the 'Admin' Role document exists with all permissions.
 * 2. Ensures admin@procure.com exists with password 'password123' and roleId set.
 *
 * Usage: node scripts/fix-admin.js
 */

const bcrypt = require('bcryptjs');
const { connectDB, User, Role } = require('../db');
const { ALL_PERMISSIONS } = require('../constants/permissions');

const run = async () => {
    await connectDB();

    // ── 1. Upsert Admin role ─────────────────────────────────────────────────
    let adminRole = await Role.findOne({ name: 'Admin' });
    if (!adminRole) {
        adminRole = await Role.create({
            name: 'Admin',
            description: 'Full system access — can act across all departments',
            permissions: ALL_PERMISSIONS,
            category: 'admin',
            dashboardPage: 'admin.html',
            color: '#10B981',
            isSystem: true,
        });
        console.log('✅ Created Admin role');
    } else {
        adminRole.permissions = ALL_PERMISSIONS;
        await adminRole.save();
        console.log('✅ Admin role found — permissions refreshed');
    }

    // ── 2. Upsert admin user ─────────────────────────────────────────────────
    const hashedPassword = await bcrypt.hash('password123', 10);
    let adminUser = await User.findOne({ email: 'admin@procure.com' });

    if (!adminUser) {
        await User.create({
            email: 'admin@procure.com',
            password: hashedPassword,
            name: 'Admin User',
            role: 'admin',
            roleId: adminRole._id,
        });
        console.log('✅ Created admin user');
    } else {
        adminUser.password = hashedPassword;
        adminUser.roleId = adminRole._id;
        adminUser.role = 'admin';
        await adminUser.save();
        console.log('✅ Admin user updated — password reset, roleId assigned');
    }

    console.log('\n🎉 Done! Login with: admin@procure.com / password123\n');
    process.exit(0);
};

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
