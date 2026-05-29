/**
 * Migration: Add customer.create / vendor.create to existing roles
 *
 * Safe to run multiple times (idempotent — addToSet never duplicates).
 *
 * Changes:
 *   Sales Operations – Entry    → + customer.create
 *   Sales Operations – Manager  → + customer.create
 *   Purchase Operations – Entry → + vendor.create
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { connectDB, Role } = require('../db');
const { invalidateRoleCache } = require('../middleware/auth');

const PATCHES = [
    { name: 'Sales Operations – Entry',   add: ['customer.create', 'enquiry.combine'] },
    { name: 'Sales Operations – Manager', add: ['customer.create'] },
    { name: 'Purchase Operations – Entry', add: ['vendor.create'] },
];

async function run() {
    await connectDB();
    console.log('\n🔧 Patching role permissions...\n');

    for (const patch of PATCHES) {
        const role = await Role.findOne({ name: patch.name });
        if (!role) {
            console.log(`  ⚠️  Role not found: "${patch.name}" — skipping`);
            continue;
        }

        const before = role.permissions.length;
        patch.add.forEach(p => {
            if (!role.permissions.includes(p)) role.permissions.push(p);
        });
        const added = role.permissions.length - before;

        await role.save();
        try { invalidateRoleCache(role._id.toString()); } catch (_) {}

        if (added > 0) {
            console.log(`  ✅  "${patch.name}" — added: ${patch.add.join(', ')}`);
        } else {
            console.log(`  ℹ️   "${patch.name}" — already had: ${patch.add.join(', ')}`);
        }
    }

    console.log('\n✅ Done.\n');
    process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
