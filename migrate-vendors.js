const mongoose = require('mongoose');
require('dotenv').config();
const { Vendor } = require('./db');

const sampleAddresses = [
    "123 Industrial Estate, Guindy, Chennai, Tamil Nadu 600032",
    "Plot No. 45, Ambattur Industrial Estate, Chennai, Tamil Nadu 600058",
    "78, Nelson Manickam Road, Aminjikarai, Chennai, Tamil Nadu 600029",
    "No. 12, Developed Plot, Thiru-Vi-Ka Industrial Estate, Guindy, Chennai 600032",
    "234, Arcot Road, Vadapalani, Chennai, Tamil Nadu 600026"
];

const migrateVendors = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Connected to MongoDB');

        const vendors = await Vendor.find();
        console.log(`Found ${vendors.length} vendors to update.`);

        for (let i = 0; i < vendors.length; i++) {
            const vendor = vendors[i];
            if (!vendor.address) {
                const randomAddress = sampleAddresses[Math.floor(Math.random() * sampleAddresses.length)];
                vendor.address = randomAddress;
                await vendor.save();
                console.log(`Updated vendor ${vendor.name} with address: ${randomAddress}`);
            } else {
                console.log(`Vendor ${vendor.name} already has an address.`);
            }
        }

        console.log('✅ Vendor migration completed.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration error:', error);
        process.exit(1);
    }
};

migrateVendors();
