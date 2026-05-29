/**
 * Migration: Static roles → Dynamic RBAC
 *
 * Safe to run multiple times (idempotent).
 * 1. Seeds the 7 default roles if they don't exist.
 * 2. Maps existing users (role:'admin'/'sales'/'sourcing') to their new roleId.
 * 3. Reports a summary at the end.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { connectDB, Role, User } = require('../db');
const { DEFAULT_ROLES } = require('../constants/permissions');

const LEGACY_ROLE_MAP = {
    admin: 'Admin',
    sales: 'Sales Operations – Manager',
    sourcing: 'Purchase Operations – Manager',
};

async function run() {
    await connectDB();
    console.log('\n🚀 Starting dynamic roles migration...\n');

    // ── Step 1: Seed default roles ──────────────────────────────────────────
    console.log('── Step 1: Seeding default roles');
    const roleIdMap = {}; // roleName → _id

    for (const roleData of DEFAULT_ROLES) {
        let role = await Role.findOne({ name: roleData.name });
        if (role) {
            console.log(`  ⏭  "${roleData.name}" already exists — skipping`);
        } else {
            role = await Role.create(roleData);
            console.log(`  ✅ Created "${roleData.name}"`);
        }
        roleIdMap[roleData.name] = role._id;
    }

    // ── Step 2: Map existing users ──────────────────────────────────────────
    console.log('\n── Step 2: Mapping existing users to dynamic roles');

    const users = await User.find({});
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const user of users) {
        if (user.roleId) {
            // Already migrated
            skipped++;
            continue;
        }

        const targetRoleName = LEGACY_ROLE_MAP[user.role];
        if (!targetRoleName) {
            console.warn(`  ⚠️  User "${user.email}" has unknown legacy role "${user.role}" — skipping`);
            failed++;
            continue;
        }

        const roleId = roleIdMap[targetRoleName];
        if (!roleId) {
            console.warn(`  ⚠️  Role "${targetRoleName}" not found in DB — skipping user "${user.email}"`);
            failed++;
            continue;
        }

        await User.updateOne({ _id: user._id }, { $set: { roleId } });
        console.log(`  ✅ ${user.email} (${user.role}) → "${targetRoleName}"`);
        updated++;
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log('\n── Summary');
    console.log(`  Users updated  : ${updated}`);
    console.log(`  Users skipped  : ${skipped} (already had roleId)`);
    console.log(`  Users failed   : ${failed}`);
    console.log(`  Roles in DB    : ${await Role.countDocuments()}`);
    console.log('\n✅ Migration complete.\n');

    await mongoose.connection.close();
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
