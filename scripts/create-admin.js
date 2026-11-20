/**
 * Create (or reset) an Admin user, making sure the default roles exist first.
 * Idempotent. Uses whatever database .env points at (MONGODB_URI + MONGODB_DB_NAME).
 *
 * Usage:  node scripts/create-admin.js <email> <password> ["Full Name"]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { connectDB, Role, User } = require('../db');
const { DEFAULT_ROLES } = require('../constants/permissions');

async function run() {
    const [email, password, name = 'Admin'] = process.argv.slice(2);
    if (!email || !password) {
        console.error('Usage: node scripts/create-admin.js <email> <password> ["Full Name"]');
        process.exit(1);
    }

    await connectDB();
    console.log(`Database: ${mongoose.connection.name}`);

    // Default roles (Admin, Sales/Purchase/Key Accounts Entry + Manager)
    let adminRole;
    for (const roleData of DEFAULT_ROLES) {
        let role = await Role.findOne({ name: roleData.name });
        if (!role) {
            role = await Role.create(roleData);
            console.log(`  created role "${roleData.name}"`);
        } else if (role.isSystem && roleData.name === 'Admin') {
            // keep Admin in sync with the current permission list
            role.permissions = roleData.permissions;
            await role.save();
        }
        if (roleData.name === 'Admin') adminRole = role;
    }

    const hashed = await bcrypt.hash(password, 10);
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
        existing.password = hashed;
        existing.roleId = adminRole._id;
        existing.role = 'admin';
        await existing.save();
        console.log(`Updated existing user ${normalizedEmail} (password reset, Admin role)`);
    } else {
        await User.create({ email: normalizedEmail, password: hashed, name, role: 'admin', roleId: adminRole._id });
        console.log(`Created Admin user ${normalizedEmail}`);
    }

    await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
