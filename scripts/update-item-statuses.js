/**
 * One-time migration: rename item statuses to new canonical values
 * and grant Purchase Operations – Manager the assign + reopen permissions.
 *
 * Usage: node scripts/update-item-statuses.js
 */

require('dotenv').config();
const { connectDB, EnquiryItem, Role } = require('../db');

(async () => {
    await connectDB();
    console.log('Running status migration...');

    const pendingResult = await EnquiryItem.updateMany(
        { status: 'pending' },
        { $set: { status: 'unassigned' } }
    );
    console.log(`  pending → unassigned: ${pendingResult.modifiedCount} items`);

    const pricedResult = await EnquiryItem.updateMany(
        { status: 'sales_priced' },
        { $set: { status: 'priced' } }
    );
    console.log(`  sales_priced → priced: ${pricedResult.modifiedCount} items`);

    const purchaseMgrResult = await Role.updateOne(
        { name: 'Purchase Operations – Manager' },
        { $addToSet: { permissions: { $each: ['enquiry.assign', 'enquiry.reopen'] } } }
    );
    console.log(`  Purchase Operations – Manager updated: ${purchaseMgrResult.modifiedCount} role`);

    const salesMgrResult = await Role.updateOne(
        { name: 'Sales Operations – Manager' },
        { $addToSet: { permissions: { $each: ['enquiry.reopen'] } } }
    );
    console.log(`  Sales Operations – Manager updated: ${salesMgrResult.modifiedCount} role`);

    console.log('Migration complete.');
    process.exit(0);
})();
