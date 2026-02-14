const bcrypt = require('bcryptjs');
const { connectDB, User, Customer, Vendor, Product } = require('./db');

const seedData = async () => {
    try {
        await connectDB();

        console.log('🌱 Starting seed process...\n');

        // Hash password
        const hashedPassword = await bcrypt.hash('password123', 10);

        // Check if admin exists, if not create it
        const adminExists = await User.findOne({ email: 'admin@procure.com' });

        if (!adminExists) {
            const adminUser = new User({
                email: 'admin@procure.com',
                password: hashedPassword,
                role: 'admin',
                name: 'Admin User'
            });
            await adminUser.save();
            console.log('✅ Admin user created\n');
        } else {
            console.log('ℹ️  Admin user already exists\n');
        }

        // Only seed other data if database is empty
        const userCount = await User.countDocuments();
        const customerCount = await Customer.countDocuments();
        const vendorCount = await Vendor.countDocuments();
        const productCount = await Product.countDocuments();

        if (userCount === 1 && customerCount === 0 && vendorCount === 0 && productCount === 0) {
            console.log('📦 Database is empty, seeding initial data...\n');

            // Create users
            const users = [
                {
                    email: 'sales1@procure.com',
                    password: hashedPassword,
                    role: 'sales',
                    name: 'Rajesh Kumar'
                },
                {
                    email: 'sales2@procure.com',
                    password: hashedPassword,
                    role: 'sales',
                    name: 'Priya Sharma'
                },
                {
                    email: 'sourcing1@procure.com',
                    password: hashedPassword,
                    role: 'sourcing',
                    name: 'Amit Patel'
                },
                {
                    email: 'sourcing2@procure.com',
                    password: hashedPassword,
                    role: 'sourcing',
                    name: 'Sneha Reddy'
                }
            ];

            await User.insertMany(users);
            console.log('✅ Created users\n');

            // Create customers
            const customers = [
                {
                    name: 'Tata Steel Limited',
                    contactPerson: 'Mr. Ravi Shankar',
                    email: 'ravi.shankar@tatasteel.com',
                    phone: '+91-9876543210',
                    address: 'Jamshedpur, Jharkhand'
                },
                {
                    name: 'Larsen & Toubro',
                    contactPerson: 'Ms. Anita Desai',
                    email: 'anita.desai@larsentoubro.com',
                    phone: '+91-9876543211',
                    address: 'Mumbai, Maharashtra'
                },
                {
                    name: 'Reliance Industries',
                    contactPerson: 'Mr. Suresh Patel',
                    email: 'suresh.patel@ril.com',
                    phone: '+91-9876543212',
                    address: 'Mumbai, Maharashtra'
                },
                {
                    name: 'Mahindra & Mahindra',
                    contactPerson: 'Mr. Vijay Kumar',
                    email: 'vijay.kumar@mahindra.com',
                    phone: '+91-9876543213',
                    address: 'Mumbai, Maharashtra'
                },
                {
                    name: 'Adani Group',
                    contactPerson: 'Ms. Meera Shah',
                    email: 'meera.shah@adani.com',
                    phone: '+91-9876543214',
                    address: 'Ahmedabad, Gujarat'
                }
            ];

            await Customer.insertMany(customers);
            console.log('✅ Created customers\n');

            // Create vendors
            const vendors = [
                {
                    name: 'JSW Steel',
                    contactPerson: 'Mr. Karthik Menon',
                    email: 'karthik@jswsteel.in',
                    phone: '+91-9123456780',
                    specialization: 'Steel Products'
                },
                {
                    name: 'Bharat Heavy Electricals',
                    contactPerson: 'Mr. Rajiv Sharma',
                    email: 'rajiv@bhel.in',
                    phone: '+91-9123456781',
                    specialization: 'Heavy Machinery'
                },
                {
                    name: 'Godrej Industries',
                    contactPerson: 'Ms. Kavita Iyer',
                    email: 'kavita@godrej.com',
                    phone: '+91-9123456782',
                    specialization: 'Industrial Equipment'
                },
                {
                    name: 'Hindustan Zinc',
                    contactPerson: 'Mr. Anil Verma',
                    email: 'anil@hzl.com',
                    phone: '+91-9123456783',
                    specialization: 'Metal & Minerals'
                },
                {
                    name: 'Ambuja Cement',
                    contactPerson: 'Mr. Pradeep Singh',
                    email: 'pradeep@ambuja.com',
                    phone: '+91-9123456784',
                    specialization: 'Construction Materials'
                },
                {
                    name: 'Asian Paints',
                    contactPerson: 'Ms. Smita Rao',
                    email: 'smita@asianpaints.com',
                    phone: '+91-9123456785',
                    specialization: 'Paints & Coatings'
                }
            ];

            await Vendor.insertMany(vendors);
            console.log('✅ Created vendors\n');

            // Create products
            const products = [
                {
                    materialName: 'Steel Rods',
                    uom: 'Tons',
                    brand: 'Tata Steel',
                    specification: 'TMT Grade Fe-500',
                    description: 'High strength steel rods for construction'
                },
                {
                    materialName: 'Cement',
                    uom: 'Bags (50kg)',
                    brand: 'UltraTech',
                    specification: 'OPC 53 Grade',
                    description: 'Ordinary Portland Cement for general construction'
                },
                {
                    materialName: 'Electrical Cables',
                    uom: 'Meters',
                    brand: 'Havells',
                    specification: '2.5 sq mm FR',
                    description: 'Flame retardant electrical cables'
                },
                {
                    materialName: 'Paint',
                    uom: 'Liters',
                    brand: 'Asian Paints',
                    specification: 'Apex Exterior Emulsion',
                    description: 'Premium weather-proof exterior paint'
                },
                {
                    materialName: 'PVC Pipes',
                    uom: 'Meters',
                    brand: 'Supreme',
                    specification: '110mm Class 3',
                    description: 'Heavy duty PVC pipes for plumbing'
                },
                {
                    materialName: 'Aluminum Sheets',
                    uom: 'Square Meters',
                    brand: 'Hindalco',
                    specification: '1.2mm thickness',
                    description: 'Industrial grade aluminum sheets'
                },
                {
                    materialName: 'Hydraulic Oil',
                    uom: 'Liters',
                    brand: 'Castrol',
                    specification: 'ISO VG 68',
                    description: 'High performance hydraulic oil for machinery'
                },
                {
                    materialName: 'Bearings',
                    uom: 'Pieces',
                    brand: 'SKF',
                    specification: '6205-2RS',
                    description: 'Deep groove ball bearings with rubber seals'
                }
            ];

            await Product.insertMany(products);
            console.log('✅ Created products\n');
        } else {
            console.log('ℹ️  Existing data found, skipping seed data creation\n');
        }

        console.log('✨ Seed process completed successfully!\n');
        process.exit(0);
    } catch (error) {
        console.error('❌ Seed error:', error);
        process.exit(1);
    }
};

seedData();
