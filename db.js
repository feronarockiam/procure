const mongoose = require('mongoose');
require('dotenv').config();

let connectPromise = null;

const connectDB = async () => {
    // Already connected
    if (mongoose.connection.readyState === 1) return mongoose.connection;
    // A connect is in flight (e.g. several requests hit a cold start together): share it
    if (connectPromise) return connectPromise;

    if (!process.env.MONGODB_URI) {
        console.error('❌ MONGODB_URI is not defined in environment variables');
        throw new Error('MONGODB_URI environment variable is required');
    }

    connectPromise = mongoose.connect(process.env.MONGODB_URI, {
        // Optional override so local dev can use its own database on a shared cluster
        ...(process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {}),
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 30000,
        maxPoolSize: 10,
        minPoolSize: 2,
    }).then(conn => {
        console.log(`✅ MongoDB connected: ${conn.connection.host}`);
        return conn;
    }).catch(error => {
        console.error('❌ MongoDB connection error:', error.message);
        throw error;
    }).finally(() => {
        // Clear either way: success is tracked by readyState, failure must be retryable
        connectPromise = null;
    });

    return connectPromise;
};

// Mongoose Schemas
const roleSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    description: { type: String },
    permissions: [{ type: String }],
    category: { type: String, enum: ['admin', 'sales', 'purchase', 'key_accounts'], required: true },
    dashboardPage: { type: String, required: true },
    // true: people can be set to report to someone with this role (a team lead / manager).
    // Left unset on roles made before this field existed; those follow their name until an admin sets it.
    leadsTeam: { type: Boolean },
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
    // false: kept on record (their name stays on past work) but they can no longer sign in
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

const customerSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    email: { type: String, trim: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    assignedKAM: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now }
});

const vendorSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    email: { type: String, trim: true },
    phone: { type: String, trim: true },
    specialization: { type: String, trim: true },
    address: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
    materialName: { type: String, required: true, trim: true },
    uom: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    hsnCode: { type: String, trim: true },
    brand: { type: String, trim: true },
    specification: { type: String, trim: true },
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
    closedAt:    { type: Date, default: null },   // when the last item was closed (cleared if it is reopened)
    reopenedAt:  { type: Date, default: null },
    reopenedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now }
});

const enquiryItemSchema = new mongoose.Schema({
    enquiryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: [0.000001, 'Quantity must be greater than 0'] },
    status: {
        type: String,
        enum: [
            'unassigned', 'assigned', 'in_sales_query', 'sales_query_resolved',
            'vendor_quoted', 'priced', 'completed', 'unsuccessful',
            'pending', 'sales_priced', // backward compat
        ],
        default: 'unassigned'
    },
    salesPrice: { type: Number, min: [0, 'Sales price cannot be negative'] },
    selectedVendorQuoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorQuotation' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    combinedFromEnquiry: {
        enquiryId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', default: null },
        enquiryNumber: { type: String, default: null }
    },

    // when each step happened (turnaround = the gaps between them)
    assignedAt:  { type: Date },
    quotedAt:    { type: Date },
    pricedAt:    { type: Date },
    completedAt: { type: Date },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const vendorQuotationSchema = new mongoose.Schema({
    enquiryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'EnquiryItem', required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorPrice: { type: Number, required: true, min: [0, 'Vendor price cannot be negative'] },
    freightPrice: { type: Number, default: 0, min: [0, 'Freight cannot be negative'] },
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

// Indexes for the lookups the routes do on every page load
enquirySchema.index({ createdAt: -1 });
enquirySchema.index({ status: 1, createdAt: -1 });
enquirySchema.index({ customerId: 1 });
enquirySchema.index({ createdBy: 1, createdAt: -1 });
enquirySchema.index({ stage: 1, status: 1 });
enquiryItemSchema.index({ enquiryId: 1 });
enquiryItemSchema.index({ assignedTo: 1 });
enquiryItemSchema.index({ productId: 1 });
enquiryItemSchema.index({ status: 1 });
vendorQuotationSchema.index({ enquiryItemId: 1 });
vendorQuotationSchema.index({ vendorId: 1, enteredAt: -1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
querySchema.index({ enquiryId: 1, createdAt: 1 });
userSchema.index({ supervisorId: 1 });
userSchema.index({ roleId: 1 });
customerSchema.index({ assignedKAM: 1 });

// Every record keeps when it was created AND when it was last changed (some had only the first, or neither).
[userSchema, customerSchema, vendorSchema, productSchema, enquirySchema, enquiryItemSchema,
 vendorQuotationSchema, notificationSchema, querySchema].forEach(schema => schema.set('timestamps', true));

// The activity log: who did what, to what, and when. The person's name is copied in (not just their id), so the
// history still reads correctly after someone has been renamed, deactivated or deleted.
const auditLogSchema = new mongoose.Schema({
    at: { type: Date, default: Date.now },
    actor: {
        id: { type: mongoose.Schema.Types.ObjectId },
        name: { type: String },
        email: { type: String },
        role: { type: String },
    },
    action: { type: String, required: true },          // e.g. 'enquiry.created', 'item.priced', 'user.deactivated'
    entity: { type: String, required: true },          // enquiry | item | quotation | customer | vendor | material | user | role | session
    entityId: { type: mongoose.Schema.Types.ObjectId },
    entityLabel: { type: String },                     // what a person would call it: "ENQ-20261019-003", "Acme Ltd"
    enquiryId: { type: mongoose.Schema.Types.ObjectId }, // set on everything that belongs to an enquiry: its timeline
    summary: { type: String, required: true },         // one plain sentence
    details: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
    expireAt: { type: Date },                          // only sign-in noise expires (see the index below)
});
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ enquiryId: 1, at: -1 });
auditLogSchema.index({ entity: 1, entityId: 1, at: -1 });
auditLogSchema.index({ 'actor.id': 1, at: -1 });
auditLogSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

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
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// One row per thing that needs a never-repeating number (here: enquiries, per day). Incremented in a single
// atomic database step, so two people saving at the same moment can never be given the same number.
const Counter = mongoose.model('Counter', new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }));

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
    Query,
    AuditLog,
    Counter
};
