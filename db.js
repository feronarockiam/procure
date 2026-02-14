const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        if (mongoose.connection.readyState >= 1) return;

        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ MongoDB connected successfully');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        // Don't exit process in serverless environment
    }
};

// Mongoose Schemas
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'sales', 'sourcing'], required: true },
    name: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const customerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    contactPerson: { type: String },
    email: { type: String },
    phone: { type: String },
    address: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const vendorSchema = new mongoose.Schema({
    name: { type: String, required: true },
    contactPerson: { type: String },
    email: { type: String },
    phone: { type: String },
    specialization: { type: String },
    address: { type: String }, // Added address field
    createdAt: { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
    materialName: { type: String, required: true },
    uom: { type: String, required: true },
    description: { type: String },
    hsnCode: { type: String }, // Added HSN Code field
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
    createdAt: { type: Date, default: Date.now }
});

const enquiryItemSchema = new mongoose.Schema({
    enquiryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true },
    status: {
        type: String,
        enum: ['pending', 'assigned', 'vendor_quoted', 'sales_priced', 'completed', 'unsuccessful'],
        default: 'pending'
    },
    salesPrice: { type: Number },
    selectedVendorQuoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorQuotation' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

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
