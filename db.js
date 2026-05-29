const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    if (mongoose.connection.readyState >= 1) return mongoose.connection;

    if (!process.env.MONGODB_URI) {
        console.error('❌ MONGODB_URI is not defined in environment variables');
        throw new Error('MONGODB_URI environment variable is required');
    }

    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 30000,
            maxPoolSize: 10,
            minPoolSize: 2,
        });
        console.log(`✅ MongoDB connected: ${conn.connection.host}`);
        return conn;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        throw error;
    }
};

// Mongoose Schemas
const roleSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    description: { type: String },
    permissions: [{ type: String }],
    category: { type: String, enum: ['admin', 'sales', 'purchase', 'key_accounts'], required: true },
    dashboardPage: { type: String, required: true },
    color: { type: String, default: '#3B9FD9' },
    isSystem: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    // Legacy field kept for backward compatibility during migration
    role: { type: String, enum: ['admin', 'sales', 'sourcing'] },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },
    name: { type: String, required: true },
    supervisorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now }
});

const customerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    contactPerson: { type: String },
    email: { type: String },
    phone: { type: String },
    address: { type: String },
    assignedKAM: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now }
});

const vendorSchema = new mongoose.Schema({
    name: { type: String, required: true },
    contactPerson: { type: String },
    email: { type: String },
    phone: { type: String },
    specialization: { type: String },
    address: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
    materialName: { type: String, required: true },
    uom: { type: String, required: true },
    description: { type: String },
    hsnCode: { type: String },
    brand: { type: String },
    specification: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const enquirySchema = new mongoose.Schema({
    enquiryNumber: { type: String, required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['active', 'completed', 'unsuccessful', 'closed'], default: 'active' },
    stage: { type: String, enum: ['new', 'open', 'updated', 'completed'], default: 'new' },
    closeReason: { type: String, default: null },
    reopenedAt:  { type: Date, default: null },
    reopenedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now }
});

const enquiryItemSchema = new mongoose.Schema({
    enquiryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true },
    status: {
        type: String,
        enum: [
            'unassigned', 'assigned', 'in_sales_query', 'sales_query_resolved',
            'vendor_quoted', 'priced', 'completed', 'unsuccessful',
            'pending', 'sales_priced', // backward compat
        ],
        default: 'unassigned'
    },
    salesPrice: { type: Number },
    selectedVendorQuoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorQuotation' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    combinedFromEnquiry: {
        enquiryId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', default: null },
        enquiryNumber: { type: String, default: null }
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const vendorQuotationSchema = new mongoose.Schema({
    enquiryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'EnquiryItem', required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorPrice: { type: Number, required: true },
    freightPrice: { type: Number, default: 0 },
    enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    enteredAt: { type: Date, default: Date.now },
    notes: { type: String },
    isCheapest: { type: Boolean, default: false }
});

const notificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ['info', 'success', 'warning', 'error'], default: 'info' },
    isRead: { type: Boolean, default: false },
    link: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const querySchema = new mongoose.Schema({
    enquiryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

// Models
const Role = mongoose.model('Role', roleSchema);
const User = mongoose.model('User', userSchema);
const Customer = mongoose.model('Customer', customerSchema);
const Vendor = mongoose.model('Vendor', vendorSchema);
const Product = mongoose.model('Product', productSchema);
const Enquiry = mongoose.model('Enquiry', enquirySchema);
const EnquiryItem = mongoose.model('EnquiryItem', enquiryItemSchema);
const VendorQuotation = mongoose.model('VendorQuotation', vendorQuotationSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const Query = mongoose.model('Query', querySchema);

module.exports = {
    connectDB,
    Role,
    User,
    Customer,
    Vendor,
    Product,
    Enquiry,
    EnquiryItem,
    VendorQuotation,
    Notification,
    Query
};
