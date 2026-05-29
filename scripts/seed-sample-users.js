/**
 * Seed one sample user per role for demo/testing.
 * Safe to run multiple times (idempotent — skips existing emails).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { connectDB, User, Role } = require('../db');

const SAMPLE_USERS = [
    { name: 'Alex Admin',          email: 'admin@procure.com',          roleName: 'Admin' },
    { name: 'Sara Sales (Entry)',   email: 'sales.entry@procure.com',    roleName: 'Sales Operations – Entry' },
    { name: 'Sam Sales (Manager)',  email: 'sales.mgr@procure.com',      roleName: 'Sales Operations – Manager' },
    { name: 'Paul Purchase (Entry)',email: 'purchase.entry@procure.com', roleName: 'Purchase Operations – Entry' },
    { name: 'Mary Purchase (Mgr)', email: 'purchase.mgr@procure.com',   roleName: 'Purchase Operations – Manager' },
    { name: 'Kate KAM (Entry)',     email: 'kam.entry@procure.com',      roleName: 'Key Accounts – Entry' },
    { name: 'Kevin KAM (Manager)', email: 'kam.mgr@procure.com',        roleName: 'Key Accounts – Manager' },
];

const PASSWORD = 'password123';

async function run() {
    await connectDB();
    console.log('\n👤 Seeding sample users...\n');

    const hashedPassword = await bcrypt.hash(PASSWORD, 10);

    for (const u of SAMPLE_USERS) {
        // Find the role
        const role = await Role.findOne({ name: u.roleName });
        if (!role) {
            console.warn(`  ⚠️  Role "${u.roleName}" not found — run migrate-to-dynamic-roles.js first`);
            continue;
        }

        // Check if user already exists
        const existing = await User.findOne({ email: u.email });
        if (existing) {
            // Ensure roleId is set correctly even if user pre-existed
            if (!existing.roleId || existing.roleId.toString() !== role._id.toString()) {
                await User.updateOne({ _id: existing._id }, { $set: { roleId: role._id } });
                console.log(`  🔄 Updated "${u.email}" → "${u.roleName}"`);
            } else {
                console.log(`  ⏭  "${u.email}" already exists — skipping`);
            }
            continue;
        }

        // Map legacy role field
        const legacyRole = role.category === 'admin' ? 'admin'
                         : role.category === 'purchase' ? 'sourcing'
                         : 'sales';

        await User.create({
            name: u.name,
            email: u.email,
            password: hashedPassword,
            roleId: role._id,
            role: legacyRole,
        });

        console.log(`  ✅ Created "${u.email}" → "${u.roleName}"`);
    }

    console.log('\n── All users use password:', PASSWORD);
    console.log('✅ Done.\n');
    await mongoose.connection.close();
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
});
