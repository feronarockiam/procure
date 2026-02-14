const bcrypt = require('bcryptjs');
const { connectDB, User, Customer, Vendor, Product, Enquiry, EnquiryItem, VendorQuotation, Notification } = require('./db');

/**
 * Clean Database Script
 * Removes all data and reseeds with realistic procurement data
 */

const cleanAndSeed = async () => {
    try {
        await connectDB();


        // Delete all existing data
        await User.deleteMany({});
        await Customer.deleteMany({});
        await Vendor.deleteMany({});
        await Product.deleteMany({});
        await Enquiry.deleteMany({});
        await EnquiryItem.deleteMany({});
        await VendorQuotation.deleteMany({});
        await Notification.deleteMany({});

        console.log('✅ All collections cleared\n');

        console.log('🌱 Seeding realistic data...\n');

        // Hash password
        const hashedPassword = await bcrypt.hash('password123', 10);

        // Create users
        const users = [
            {
                email: 'admin@procure.com',
                password: hashedPassword,
                role: 'admin',
                name: 'Admin User'
            },
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
        console.log('✅ Created 5 users (1 admin, 2 sales, 2 sourcing)\n');

        // Create realistic customers
        const customers = [
            {
                name: 'ABC Corporation',
                contactPerson: 'Mr. Ravi Shankar',
                email: 'ravi@abccorp.com',
                phone: '+91-9876543210',
                address: 'Chennai, Tamil Nadu'
            },
            {
                name: 'XYZ Industries',
                contactPerson: 'Ms. Anita Desai',
                email: 'anita@xyzind.com',
                phone: '+91-9876543211',
                address: 'Mumbai, Maharashtra'
            },
            {
                name: 'Tech Solutions Ltd',
                contactPerson: 'Mr. Suresh Patel',
                email: 'suresh@techsol.com',
                phone: '+91-9876543212',
                address: 'Bangalore, Karnataka'
            },
            {
                name: 'Global Traders',
                contactPerson: 'Mr. Vijay Kumar',
                email: 'vijay@globaltraders.com',
                phone: '+91-9876543213',
                address: 'Delhi, NCR'
            },
            {
                name: 'Manufacturing Co',
                contactPerson: 'Ms. Meera Shah',
                email: 'meera@mfgco.com',
                phone: '+91-9876543214',
                address: 'Pune, Maharashtra'
            },
            {
                name: 'BuildWell Constructions',
                contactPerson: 'Mr. Rajesh Gupta',
                email: 'rajesh@buildwell.com',
                phone: '+91-9876543215',
                address: 'Hyderabad, Telangana'
            },
            {
                name: 'Sunrise Infra',
                contactPerson: 'Ms. Priya Singh',
                email: 'priya@sunriseinfra.com',
                phone: '+91-9876543216',
                address: 'Kolkata, West Bengal'
            },
            {
                name: 'Metro Developers',
                contactPerson: 'Mr. Arjun Reddy',
                email: 'arjun@metrodev.com',
                phone: '+91-9876543217',
                address: 'Bangalore, Karnataka'
            },
            {
                name: 'Urban Spaces',
                contactPerson: 'Ms. Neha Kapoor',
                email: 'neha@urbanspaces.com',
                phone: '+91-9876543218',
                address: 'Gurgaon, Haryana'
            },
            {
                name: 'Green Valley Projects',
                contactPerson: 'Mr. Vikram Malhotra',
                email: 'vikram@greenvalley.com',
                phone: '+91-9876543219',
                address: 'Chandigarh, Punjab'
            }
        ];

        await Customer.insertMany(customers);
        console.log(`✅ Created ${customers.length} customers\n`);

        // Create realistic vendors
        const vendors = [
            {
                name: 'JSW Steel',
                contactPerson: 'Mr. Karthik Menon',
                email: 'karthik@jswsteel.in',
                phone: '+91-9123456780',
                specialization: 'Steel Products'
            },
            {
                name: 'UltraTech Cement',
                contactPerson: 'Mr. Rajiv Sharma',
                email: 'rajiv@ultratech.in',
                phone: '+91-9123456781',
                specialization: 'Construction Materials'
            },
            {
                name: 'Havells India',
                contactPerson: 'Ms. Kavita Iyer',
                email: 'kavita@havells.com',
                phone: '+91-9123456782',
                specialization: 'Electrical Goods'
            },
            {
                name: 'Supreme Industries',
                contactPerson: 'Mr. Anil Verma',
                email: 'anil@supreme.in',
                phone: '+91-9123456783',
                specialization: 'Plastic Products'
            },
            {
                name: 'Asian Paints',
                contactPerson: 'Ms. Smita Rao',
                email: 'smita@asianpaints.com',
                phone: '+91-9123456785',
                specialization: 'Paints & Coatings'
            },
            {
                name: 'Tata Steel',
                contactPerson: 'Mr. Ratan Singh',
                email: 'ratan@tatasteel.com',
                phone: '+91-9123456786',
                specialization: 'Steel Products'
            },
            {
                name: 'ACC Cement',
                contactPerson: 'Ms. Sunita Mehta',
                email: 'sunita@acccement.com',
                phone: '+91-9123456787',
                specialization: 'Construction Materials'
            },
            {
                name: 'Polycab Wires',
                contactPerson: 'Mr. Rahul Jain',
                email: 'rahul@polycab.com',
                phone: '+91-9123456788',
                specialization: 'Electrical Goods'
            },
            {
                name: 'Astral Pipes',
                contactPerson: 'Ms. Divya Agarwal',
                email: 'divya@astralpipes.com',
                phone: '+91-9123456789',
                specialization: 'Plumbing Materials'
            },
            {
                name: 'Berger Paints',
                contactPerson: 'Mr. Sanjay Dutt',
                email: 'sanjay@bergerpaints.com',
                phone: '+91-9123456790',
                specialization: 'Paints & Coatings'
            }
        ];

        await Vendor.insertMany(vendors);
        console.log(`✅ Created ${vendors.length} vendors\n`);

        // Create comprehensive product list (procurement materials)
        const products = [
            // Construction Materials
            {
                materialName: 'Steel Rod 10mm',
                uom: 'Tons',
                brand: 'Tata Steel',
                specification: 'TMT Grade Fe-500',
                description: 'High strength steel rods for construction'
            },
            {
                materialName: 'Steel Rod 12mm',
                uom: 'Tons',
                brand: 'JSW Steel',
                specification: 'TMT Grade Fe-500D',
                description: 'Earthquake resistant steel rods'
            },
            {
                materialName: 'Cement Bag 50kg',
                uom: 'Bags',
                brand: 'UltraTech',
                specification: 'OPC 53 Grade',
                description: 'Premium quality ordinary portland cement'
            },
            {
                materialName: 'Cement Bag 25kg',
                uom: 'Bags',
                brand: 'ACC',
                specification: 'PPC Grade',
                description: 'Portland pozzolana cement for general construction'
            },

            // Electrical Materials
            {
                materialName: 'Copper Wire',
                uom: 'Meters',
                brand: 'Polycab',
                specification: '2.5 sq mm',
                description: 'Pure copper electrical wire for house wiring'
            },
            {
                materialName: 'Electrical Cable',
                uom: 'Meters',
                brand: 'Havells',
                specification: '4 sq mm FR',
                description: 'Flame retardant multi-core cable'
            },
            {
                materialName: 'LED Bulb',
                uom: 'Pieces',
                brand: 'Philips',
                specification: '9W Cool White',
                description: 'Energy efficient LED bulbs'
            },

            // Plumbing & Pipes
            {
                materialName: 'PVC Pipe',
                uom: 'Meters',
                brand: 'Supreme',
                specification: '110mm Class 3',
                description: 'Heavy duty PVC sewage pipes'
            },
            {
                materialName: 'PVC Pipe 2 inch',
                uom: 'Meters',
                brand: 'Astral',
                specification: 'SCH 40',
                description: 'Pressure rated PVC pipe for water supply'
            },

            // Paints & Finishes
            {
                materialName: 'Paint Bucket',
                uom: 'Liters',
                brand: 'Asian Paints',
                specification: 'Apex Exterior Emulsion',
                description: 'Premium weather-proof exterior paint'
            },
            {
                materialName: 'Wall Putty',
                uom: 'Kg',
                brand: 'Birla White',
                specification: 'Acrylic Wall Putty',
                description: 'Smooth finish wall putty for interiors'
            },

            // Wood & Timber
            {
                materialName: 'Wood Plank',
                uom: 'Cubic Feet',
                brand: 'Greenply',
                specification: 'Teak Wood - Grade A',
                description: 'Premium quality teak wood planks'
            },
            {
                materialName: 'Plywood Sheet',
                uom: 'Pieces',
                brand: 'CenturyPly',
                specification: '8mm BWP Grade',
                description: 'Boiling water proof plywood sheets'
            },

            // Metals & Sheets
            {
                materialName: 'Aluminum Sheet',
                uom: 'Square Meters',
                brand: 'Hindalco',
                specification: '1.2mm thickness',
                description: 'Industrial grade aluminum sheets'
            },
            {
                materialName: 'Aluminium Sheet',
                uom: 'Square Meters',
                brand: 'Hindalco',
                specification: '1.5mm thickness',
                description: 'Heavy duty aluminium sheets (UK spelling)'
            },
            {
                materialName: 'GI Sheet',
                uom: 'Square Meters',
                brand: 'Tata Steel',
                specification: '0.5mm galvanized',
                description: 'Galvanized iron sheets for roofing'
            },

            // Hardware & Fasteners
            {
                materialName: 'Heavy Duty Bolt',
                uom: 'Pieces',
                brand: 'L&T',
                specification: 'M12x50mm Grade 8.8',
                description: 'High tensile steel bolts with nuts'
            },
            {
                materialName: 'Screws Set',
                uom: 'Box',
                brand: 'Fischer',
                specification: 'Assorted sizes',
                description: 'Wood and metal screws combo pack'
            },

            // Machinery Parts
            {
                materialName: 'Bearings',
                uom: 'Pieces',
                brand: 'SKF',
                specification: '6205-2RS',
                description: 'Deep groove ball bearings with rubber seals'
            },
            {
                materialName: 'Hydraulic Oil',
                uom: 'Liters',
                brand: 'Castrol',
                specification: 'ISO VG 68',
                description: 'High performance hydraulic oil for machinery'
            },
            {
                materialName: 'Industrial Belt',
                uom: 'Meters',
                brand: 'Gates',
                specification: 'V-Belt A32',
                description: 'Power transmission V-belt for machinery'
            }
        ];

        await Product.insertMany(products);
        console.log(`✅ Created ${products.length} products\n`);

        console.log('📊 Database Statistics:');
        console.log(`   Users: ${await User.countDocuments()}`);
        console.log(`   Customers: ${await Customer.countDocuments()}`);
        console.log(`   Vendors: ${await Vendor.countDocuments()}`);
        console.log(`   Products: ${await Product.countDocuments()}\n`);

        console.log('✨ Database cleaned and seeded successfully!\n');

        console.log('🔑 Login Credentials:');
        console.log('   Admin:    admin@procure.com / password123');
        console.log('   Sales:    sales1@procure.com / password123');
        console.log('   Sourcing: sourcing1@procure.com / password123\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

cleanAndSeed();
