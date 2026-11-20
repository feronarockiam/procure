/**
 * API tests: login, masters CRUD, enquiry workflow, permissions.
 *
 * Runs against a THROWAWAY database on a LOCAL MongoDB and refuses to run against anything else:
 *
 *   docker run -d --name procure-test-mongo -p 27018:27017 mongo:7
 *   npm test
 *
 * (override the server with TEST_MONGODB_URI=mongodb://localhost:PORT)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const TEST_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27018';
if (!/^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(TEST_URI)) {
    throw new Error(`Refusing to run tests against ${TEST_URI.replace(/\/\/.*@/, '//***@')}: only a local MongoDB is allowed`);
}

// Must be set before the app (and db.js) are loaded
process.env.MONGODB_URI = TEST_URI;
process.env.MONGODB_DB_NAME = `procure_test_${crypto.randomBytes(4).toString('hex')}`;
process.env.JWT_SECRET = 'test-secret-not-for-production';
process.env.NODE_ENV = 'test';
process.env.USER_CACHE_TTL_MS = '0'; // these tests edit the database directly, behind the app's back

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const app = require('../server');
const { connectDB, Role, User, Customer, Product, Vendor, Enquiry, EnquiryItem, VendorQuotation, Notification } = require('../db');
const { DEFAULT_ROLES } = require('../constants/permissions');

const PASSWORD = 'password123';
let server;
let baseUrl;
const tokens = {};
const users = {};
const roles = {};

const api = async (method, path, { token, body, raw } = {}) => {
    const res = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* not JSON */ }
    return { status: res.status, data };
};

const login = async (email, password = PASSWORD) => api('POST', '/auth/login', { body: { email, password } });

test.before(async () => {
    await connectDB();
    await Promise.all(Object.values(mongoose.models).map(m => m.init())); // build the unique indexes

    for (const def of DEFAULT_ROLES) roles[def.name] = await Role.create(def);
    const hash = await bcrypt.hash(PASSWORD, 4);
    const make = async (key, roleName, name) => {
        users[key] = await User.create({
            email: `${key}@test.com`, name, password: hash,
            roleId: roles[roleName]._id, role: roles[roleName].category === 'purchase' ? 'sourcing' : roles[roleName].category === 'admin' ? 'admin' : 'sales',
        });
        const res = await login(`${key}@test.com`);
        tokens[key] = res.data && res.data.token;
    };

    server = app.listen(0);
    baseUrl = `http://localhost:${server.address().port}`;

    await make('admin', 'Admin', 'Admin');
    await make('salesEntry', 'Sales Operations – Entry', 'Sara Sales');
    await make('salesEntry2', 'Sales Operations – Entry', 'Sam Sales');
    await make('salesMgr', 'Sales Operations – Manager', 'Mia Manager');
    await make('purchEntry', 'Purchase Operations – Entry', 'Pat Purchase');
    await make('purchEntry2', 'Purchase Operations – Entry', 'Paul Purchase');
    await make('purchMgr', 'Purchase Operations – Manager', 'Pia Purchase Mgr');
    await make('kamMgr', 'Key Accounts – Manager', 'Kim KAM');
});

test.after(async () => {
    if (server) server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});

// ── Auth ─────────────────────────────────────────────────────────────────────

test('login: bad input is rejected, not crashed on', async () => {
    assert.equal((await api('POST', '/auth/login', { body: {} })).status, 400);
    // an object where a string belongs would otherwise be run as a Mongo operator
    assert.equal((await api('POST', '/auth/login', { body: { email: { $ne: null }, password: 'x' } })).status, 400);
    assert.equal((await api('POST', '/auth/login', { body: { email: 'admin@test.com' } })).status, 400); // used to be a 500
    assert.equal((await login('admin@test.com', 'wrong')).status, 401);
    assert.equal((await login('nobody@test.com')).status, 401);
});

test('login: works, case-insensitively, and returns permissions', async () => {
    const res = await login('  ADMIN@Test.com'.trim());
    assert.equal(res.status, 200);
    assert.ok(res.data.token);
    assert.ok(res.data.user.permissions.includes('user.create'));
});

test('auth: a bad/expired token is 401 (so the UI returns to login), not 403', async () => {
    assert.equal((await api('GET', '/customers', { token: 'garbage' })).status, 401);
    assert.equal((await api('GET', '/customers')).status, 401);
});

test('auth: a deleted user\'s token stops working immediately', async () => {
    const ghost = await User.create({ email: 'ghost@test.com', name: 'Ghost', password: await bcrypt.hash(PASSWORD, 4), roleId: roles['Admin']._id, role: 'admin' });
    const { data } = await login('ghost@test.com');
    assert.equal((await api('GET', '/customers', { token: data.token })).status, 200);
    await User.deleteOne({ _id: ghost._id });
    assert.equal((await api('GET', '/customers', { token: data.token })).status, 401);
});

test('auth: a role change applies without logging in again', async () => {
    const u = await User.create({ email: 'shifty@test.com', name: 'Shifty', password: await bcrypt.hash(PASSWORD, 4), roleId: roles['Admin']._id, role: 'admin' });
    const { data } = await login('shifty@test.com');
    assert.equal((await api('GET', '/users', { token: data.token })).status, 200);
    await User.updateOne({ _id: u._id }, { roleId: roles['Key Accounts – Entry']._id });
    assert.equal((await api('GET', '/users', { token: data.token })).status, 403);
});

test('api: unknown paths and malformed JSON answer in JSON', async () => {
    const missing = await api('GET', '/does-not-exist', { token: tokens.admin });
    assert.equal(missing.status, 404);
    assert.ok(missing.data.error);
    const bad = await api('POST', '/customers', { token: tokens.admin, raw: '{not json' });
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /JSON/);
});

// ── Masters: customers / products / vendors ─────────────────────────────────

test('customers: create, validation, duplicates, delete guard', async () => {
    const ok = await api('POST', '/customers', { token: tokens.salesEntry, body: { name: '  Acme Pvt Ltd ', email: 'a@acme.com' } });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.name, 'Acme Pvt Ltd'); // trimmed

    assert.equal((await api('POST', '/customers', { token: tokens.salesEntry, body: { name: 'ACME pvt ltd' } })).status, 409); // double-click / re-submit
    assert.equal((await api('POST', '/customers', { token: tokens.salesEntry, body: { name: '   ' } })).status, 400);
    assert.equal((await api('POST', '/customers', { token: tokens.salesEntry, body: { name: 'X', email: 'nope' } })).status, 400);
    assert.equal((await api('POST', '/customers', { token: tokens.salesEntry, body: { name: 'Y', assignedKAM: 'xyz' } })).status, 400);
    // who can look after customers is decided by their role's permissions: Sales Entry can't, so they are refused
    const notKam = await api('POST', '/customers', { token: tokens.salesEntry, body: { name: 'Y', assignedKAM: String(users.salesEntry2._id) } });
    assert.equal(notKam.status, 400);
    assert.match(notKam.data.error, /look after customers/);

    const upd = await api('PUT', `/customers/${ok.data._id}`, { token: tokens.kamMgr, body: { name: 'Acme Industries' } });
    assert.equal(upd.status, 200);
    assert.equal((await api('PUT', `/customers/${ok.data._id}`, { token: tokens.kamMgr, body: { name: '' } })).status, 400);
    assert.equal((await api('PUT', '/customers/not-an-id', { token: tokens.kamMgr, body: { name: 'z' } })).status, 400);
    assert.equal((await api('GET', '/customers/by-kam/not-an-id', { token: tokens.admin })).status, 400);
});

test('products: permission message, validation, duplicates', async () => {
    // Sales can't add materials: the server says so (the UI no longer offers the button)
    const denied = await api('POST', '/products', { token: tokens.salesEntry, body: { materialName: 'Cement', uom: 'Bags' } });
    assert.equal(denied.status, 403);
    assert.match(denied.data.error, /material\.create/);

    const ok = await api('POST', '/products', { token: tokens.purchMgr, body: { materialName: 'Cement', uom: 'Bags', brand: 'UltraTech' } });
    assert.equal(ok.status, 201);
    assert.equal((await api('POST', '/products', { token: tokens.purchMgr, body: { materialName: 'cement', uom: 'bags', brand: 'ultratech' } })).status, 409);
    // a different brand of the same material is a different product
    assert.equal((await api('POST', '/products', { token: tokens.purchMgr, body: { materialName: 'Cement', uom: 'Bags', brand: 'ACC' } })).status, 201);
    assert.equal((await api('POST', '/products', { token: tokens.purchMgr, body: { materialName: 'Sand' } })).status, 400);
    // names with quotes and apostrophes are stored exactly
    const odd = await api('POST', '/products', { token: tokens.purchMgr, body: { materialName: `1/2" pipe — Johnson's`, uom: 'Meters' } });
    assert.equal(odd.status, 201);
    assert.equal(odd.data.materialName, `1/2" pipe — Johnson's`);

    assert.equal((await api('PUT', `/products/${ok.data._id}`, { token: tokens.purchMgr, body: { materialName: '' } })).status, 400);
    assert.equal((await api('PUT', '/products/bad-id', { token: tokens.purchMgr, body: { materialName: 'x' } })).status, 400);
});

test('vendors: create, duplicate, validation', async () => {
    assert.equal((await api('POST', '/vendors', { token: tokens.purchEntry, body: { name: 'Steel Co', email: 'bad' } })).status, 400);
    const ok = await api('POST', '/vendors', { token: tokens.purchEntry, body: { name: 'Steel Co' } });
    assert.equal(ok.status, 201);
    assert.equal((await api('POST', '/vendors', { token: tokens.purchEntry, body: { name: 'steel co' } })).status, 409);
    assert.equal((await api('POST', '/vendors', { token: tokens.purchEntry, body: {} })).status, 400);
});

// ── Enquiry workflow ─────────────────────────────────────────────────────────

let customer, product, product2, vendorA, vendorB;
test('enquiry: setup masters', async () => {
    customer = await Customer.findOne({ name: 'Acme Industries' });
    product = await Product.findOne({ materialName: 'Cement', brand: 'UltraTech' });
    product2 = await Product.findOne({ materialName: 'Cement', brand: 'ACC' });
    vendorA = await Vendor.findOne({ name: 'Steel Co' });
    vendorB = await Vendor.create({ name: 'Iron Works' });
    assert.ok(customer && product && product2 && vendorA && vendorB);
});

const newEnquiry = (token, items) => api('POST', '/enquiries', { token, body: { customerId: String(customer._id), items } });

test('enquiry: create validates everything and numbers sequentially', async () => {
    const pid = String(product._id);
    assert.equal((await api('POST', '/enquiries', { token: tokens.salesEntry, body: { items: [{ productId: pid, quantity: 1 }] } })).status, 400);
    assert.equal((await newEnquiry(tokens.salesEntry, [])).status, 400);
    assert.equal((await newEnquiry(tokens.salesEntry, [{ productId: pid, quantity: 0 }])).status, 400);
    assert.equal((await newEnquiry(tokens.salesEntry, [{ productId: pid, quantity: -5 }])).status, 400);
    assert.equal((await newEnquiry(tokens.salesEntry, [{ productId: pid, quantity: 'abc' }])).status, 400);
    assert.equal((await newEnquiry(tokens.salesEntry, [{ productId: 'nope', quantity: 1 }])).status, 400);
    assert.equal((await newEnquiry(tokens.salesEntry, [{ productId: String(new mongoose.Types.ObjectId()), quantity: 1 }])).status, 400);
    assert.equal(await Enquiry.countDocuments(), 0, 'a rejected request must leave nothing behind');

    const a = await newEnquiry(tokens.salesEntry, [{ productId: pid, quantity: 10 }, { productId: String(product2._id), quantity: 2.5 }]);
    assert.equal(a.status, 201);
    assert.match(a.data.enquiryNumber, /^ENQ-\d{8}-001$/);
    assert.equal(a.data.items.length, 2);
    const b = await newEnquiry(tokens.salesEntry, [{ productId: pid, quantity: 1 }]);
    assert.match(b.data.enquiryNumber, /-002$/);
});

test('enquiry: simultaneous creates never share a number or fail', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => newEnquiry(tokens.salesEntry2, [{ productId: String(product._id), quantity: 1 }])));
    assert.ok(results.every(r => r.status === 201), JSON.stringify(results.map(r => r.status)));
    const numbers = results.map(r => r.data.enquiryNumber);
    assert.equal(new Set(numbers).size, numbers.length, `duplicate numbers: ${numbers}`);
});

test('enquiry: new-enquiry notifications are created before the response returns', async () => {
    const before = await Notification.countDocuments({ userId: users.salesMgr._id });
    await newEnquiry(tokens.salesEntry, [{ productId: String(product._id), quantity: 1 }]);
    assert.equal(await Notification.countDocuments({ userId: users.salesMgr._id }), before + 1);
});

test('enquiry: visibility applies to fetch-by-id and the query thread, not just the list', async () => {
    const mine = await Enquiry.findOne({ createdBy: users.salesEntry._id });
    assert.equal((await api('GET', `/enquiries/${mine._id}`, { token: tokens.salesEntry })).status, 200);
    assert.equal((await api('GET', `/enquiries/${mine._id}`, { token: tokens.salesEntry2 })).status, 404); // someone else's
    assert.equal((await api('GET', `/enquiries/${mine._id}/queries`, { token: tokens.salesEntry2 })).status, 404);
    assert.equal((await api('POST', `/enquiries/${mine._id}/queries`, { token: tokens.salesEntry2, body: { message: 'hi' } })).status, 404);
    assert.equal((await api('GET', `/enquiries/${mine._id}`, { token: tokens.salesMgr })).status, 200); // view.all
    assert.equal((await api('GET', '/enquiries/not-an-id', { token: tokens.admin })).status, 400);
    assert.equal((await api('GET', `/enquiries/${new mongoose.Types.ObjectId()}`, { token: tokens.admin })).status, 404);
});

test('enquiry list: filters are validated and can only narrow visibility', async () => {
    assert.equal((await api('GET', '/enquiries?stage[$ne]=x', { token: tokens.admin })).status, 400); // operator injection
    assert.equal((await api('GET', '/enquiries?stage=bogus', { token: tokens.admin })).status, 400);
    assert.equal((await api('GET', '/enquiries?sourcingUser=bogus', { token: tokens.admin })).status, 400);

    const own = await api('GET', '/enquiries', { token: tokens.salesEntry });
    assert.equal(own.status, 200);
    assert.ok(own.data.length >= 3 && own.data.every(e => e.createdBy._id === String(users.salesEntry._id)));
    assert.ok(own.data.every(e => Array.isArray(e.items) && typeof e.queryCount === 'number'));

    const open = await api('GET', '/enquiries?stage=new', { token: tokens.admin });
    assert.equal(open.status, 200);
    assert.ok(open.data.length >= 9);
});

test('enquiry: assigning', async () => {
    const e = await Enquiry.findOne({ createdBy: users.salesEntry._id }).sort({ createdAt: 1 });
    const items = await EnquiryItem.find({ enquiryId: e._id });
    const itemIds = items.map(i => String(i._id));

    // purchase users can self-assign unclaimed items...
    const claim = await api('POST', `/enquiries/${e._id}/assign-items`, { token: tokens.purchEntry, body: { itemIds: [itemIds[0]], sourcingUserId: String(users.purchEntry._id) } });
    assert.equal(claim.status, 200);
    // ...but cannot take an item someone else already has
    const steal = await api('POST', `/enquiries/${e._id}/assign-items`, { token: tokens.purchEntry2, body: { itemIds: [itemIds[0]], sourcingUserId: String(users.purchEntry2._id) } });
    assert.equal(steal.status, 409);
    assert.equal(String((await EnquiryItem.findById(itemIds[0])).assignedTo), String(users.purchEntry._id));
    // nor assign to someone else without the manager permission
    assert.equal((await api('POST', `/enquiries/${e._id}/assign-items`, { token: tokens.purchEntry2, body: { itemIds: [itemIds[1]], sourcingUserId: String(users.purchEntry._id) } })).status, 403);

    // manager: bad input, non-purchase assignee, then a proper assignment
    assert.equal((await api('POST', `/enquiries/${e._id}/assign-items`, { token: tokens.purchMgr, body: { itemIds: [], sourcingUserId: String(users.purchEntry._id) } })).status, 400);
    assert.equal((await api('POST', `/enquiries/${e._id}/assign-items`, { token: tokens.purchMgr, body: { itemIds: [itemIds[1]] } })).status, 400);
    assert.equal((await api('POST', `/enquiries/${e._id}/assign-items`, { token: tokens.purchMgr, body: { itemIds: [itemIds[1]], sourcingUserId: String(users.salesEntry._id) } })).status, 400);
    assert.equal((await api('PUT', `/enquiries/${e._id}/assign`, { token: tokens.purchMgr, body: {} })).status, 400);
    const all = await api('PUT', `/enquiries/${e._id}/assign`, { token: tokens.purchMgr, body: { sourcingUserId: String(users.purchEntry._id) } });
    assert.equal(all.status, 200);
    assert.equal((await EnquiryItem.find({ enquiryId: e._id })).every(i => i.status === 'assigned'), true);
});

let flowEnquiry, flowItem;
test('enquiry: quote → price → complete, with guards at every step', async () => {
    const res = await newEnquiry(tokens.salesEntry, [{ productId: String(product._id), quantity: 4 }, { productId: String(product2._id), quantity: 1 }]);
    flowEnquiry = res.data;
    flowItem = res.data.items[0];
    const other = res.data.items[1];
    const base = `/enquiries/${flowEnquiry._id}/items`;

    await api('PUT', `/enquiries/${flowEnquiry._id}/assign`, { token: tokens.purchMgr, body: { sourcingUserId: String(users.purchEntry._id) } });

    // vendor quotes
    const quote = (vendorId, vendorPrice, freightPrice) => api('POST', '/vendors/quotations', { token: tokens.purchEntry, body: { enquiryItemId: flowItem._id, vendorId: String(vendorId), vendorPrice, freightPrice } });
    assert.equal((await quote(vendorA._id, -5, 0)).status, 400);
    assert.equal((await quote(vendorA._id, 'abc', 0)).status, 400);
    assert.equal((await quote(vendorA._id, 100, -1)).status, 400);
    assert.equal((await quote('bad', 100, 0)).status, 400);
    assert.equal((await quote(new mongoose.Types.ObjectId(), 100, 0)).status, 404);
    const q1 = await quote(vendorA._id, 100, 10);   // total 110
    assert.equal(q1.status, 201);
    assert.equal((await EnquiryItem.findById(flowItem._id)).status, 'vendor_quoted');
    const q2 = await quote(vendorB._id, 90, 30);    // total 120 — dearer
    assert.equal((await VendorQuotation.findById(q1.data._id)).isCheapest, true);
    assert.equal((await VendorQuotation.findById(q2.data._id)).isCheapest, false);

    // editing a quote must re-evaluate "cheapest" (it used to leave the flag stale)
    const edit = await api('PUT', `/vendors/quotations/${q2.data._id}`, { token: tokens.purchEntry, body: { vendorId: String(vendorB._id), vendorPrice: 50, freightPrice: 10 } }); // 60
    assert.equal(edit.status, 200);
    assert.equal((await VendorQuotation.findById(q2.data._id)).isCheapest, true);
    assert.equal((await VendorQuotation.findById(q1.data._id)).isCheapest, false);

    // sales price: validated, and the chosen quote must belong to this item
    assert.equal((await api('PUT', `${base}/${flowItem._id}/sales-price`, { token: tokens.salesMgr, body: { salesPrice: -1 } })).status, 400);
    assert.equal((await api('PUT', `${base}/${flowItem._id}/sales-price`, { token: tokens.salesMgr, body: { salesPrice: 'x' } })).status, 400);
    assert.equal((await api('PUT', `${base}/${flowItem._id}/sales-price`, { token: tokens.salesMgr, body: { salesPrice: 80, selectedVendorQuoteId: 'bad' } })).status, 400);
    assert.equal((await api('PUT', `${base}/${flowItem._id}/sales-price`, { token: tokens.salesMgr, body: { salesPrice: 80, selectedVendorQuoteId: String(new mongoose.Types.ObjectId()) } })).status, 400);
    // an item from ANOTHER enquiry in the URL is not found
    assert.equal((await api('PUT', `/enquiries/${(await Enquiry.findOne({ _id: { $ne: flowEnquiry._id } }))._id}/items/${flowItem._id}/sales-price`, { token: tokens.salesMgr, body: { salesPrice: 80 } })).status, 404);
    const priced = await api('PUT', `${base}/${flowItem._id}/sales-price`, { token: tokens.salesMgr, body: { salesPrice: 80, selectedVendorQuoteId: q2.data._id } });
    assert.equal(priced.status, 200);
    assert.equal(priced.data.status, 'priced');

    // a late extra quote must not drag a priced item back to vendor_quoted
    assert.equal((await quote(vendorA._id, 200, 0)).status, 201);
    assert.equal((await EnquiryItem.findById(flowItem._id)).status, 'priced');

    // can't complete an item that has no price yet
    assert.equal((await api('PUT', `${base}/${other._id}/complete`, { token: tokens.salesMgr })).status, 400);

    // complete → enquiry still open (other item pending), then everything is frozen for this item
    assert.equal((await api('PUT', `${base}/${flowItem._id}/complete`, { token: tokens.salesMgr })).status, 200);
    assert.equal((await Enquiry.findById(flowEnquiry._id)).status, 'active');
    assert.equal((await api('PUT', `${base}/${flowItem._id}/sales-price`, { token: tokens.salesMgr, body: { salesPrice: 1 } })).status, 409);
    assert.equal((await api('PUT', `${base}/${flowItem._id}/unsuccessful`, { token: tokens.salesMgr, body: { closeReason: 'x' } })).status, 409);
    assert.equal((await quote(vendorA._id, 1, 0)).status, 409);
    assert.equal((await api('PUT', `/vendors/quotations/${q1.data._id}`, { token: tokens.purchEntry, body: { vendorId: String(vendorA._id), vendorPrice: 1 } })).status, 409);
    // a completed item can't be re-assigned (that used to reset it to 'assigned')
    assert.equal((await api('POST', `/enquiries/${flowEnquiry._id}/assign-items`, { token: tokens.purchMgr, body: { itemIds: [flowItem._id], sourcingUserId: String(users.purchEntry2._id) } })).status, 409);
    assert.equal((await EnquiryItem.findById(flowItem._id)).status, 'completed');

    // closing the last item completes the enquiry
    await api('PUT', `${base}/${other._id}/sales-price`, { token: tokens.salesMgr, body: { salesPrice: 5 } });
    assert.equal((await api('PUT', `${base}/${other._id}/complete`, { token: tokens.salesMgr })).status, 200);
    assert.equal((await Enquiry.findById(flowEnquiry._id)).status, 'completed');
    // closed enquiries can't be (re)assigned or edited...
    assert.equal((await api('PUT', `/enquiries/${flowEnquiry._id}/assign`, { token: tokens.purchMgr, body: { sourcingUserId: String(users.purchEntry._id) } })).status, 409);
    assert.equal((await api('PUT', `${base}/${other._id}`, { token: tokens.salesEntry, body: { quantity: 3 } })).status, 409);
    assert.equal((await api('PUT', `/enquiries/${flowEnquiry._id}/unsuccessful`, { token: tokens.salesMgr, body: { closeReason: 'x' } })).status, 409);
    // ...but can be reopened
    assert.equal((await api('PUT', `/enquiries/${flowEnquiry._id}/reopen`, { token: tokens.salesMgr })).status, 200);
});

test('enquiry: editing and deleting items', async () => {
    const res = await newEnquiry(tokens.salesEntry, [{ productId: String(product._id), quantity: 4 }, { productId: String(product2._id), quantity: 1 }]);
    const [first, second] = res.data.items;
    const base = `/enquiries/${res.data._id}/items`;

    assert.equal((await api('PUT', `${base}/${first._id}`, { token: tokens.salesEntry, body: { quantity: 0 } })).status, 400);
    assert.equal((await api('PUT', `${base}/${first._id}`, { token: tokens.salesEntry, body: { quantity: -2 } })).status, 400);
    assert.equal((await api('PUT', `${base}/${first._id}`, { token: tokens.salesEntry, body: { quantity: 'many' } })).status, 400);
    const ok = await api('PUT', `${base}/${first._id}`, { token: tokens.salesEntry, body: { quantity: 7.5 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.quantity, 7.5);

    // other users can't touch it: no permission at all, or no visibility
    assert.equal((await api('PUT', `${base}/${first._id}`, { token: tokens.purchEntry, body: { quantity: 1 } })).status, 403);
    assert.equal((await api('PUT', `${base}/${first._id}`, { token: tokens.salesEntry2, body: { quantity: 1 } })).status, 404);

    // delete one, but never the last (that left empty enquiries behind)
    await VendorQuotation.create({ enquiryItemId: first._id, vendorId: vendorA._id, vendorPrice: 1, enteredBy: users.purchEntry._id });
    assert.equal((await api('PUT', `${base}/${first._id}`, { token: tokens.salesEntry, body: { deleted: true } })).status, 200);
    assert.equal(await VendorQuotation.countDocuments({ enquiryItemId: first._id }), 0, 'the deleted line\'s quotes go with it');
    const last = await api('PUT', `${base}/${second._id}`, { token: tokens.salesEntry, body: { deleted: true } });
    assert.equal(last.status, 400);
    assert.equal(await EnquiryItem.countDocuments({ enquiryId: res.data._id }), 1);
});

test('enquiry: queries and unsuccessful', async () => {
    const res = await newEnquiry(tokens.salesEntry, [{ productId: String(product._id), quantity: 1 }]);
    const e = res.data;
    const item = e.items[0];
    await api('PUT', `/enquiries/${e._id}/assign`, { token: tokens.purchMgr, body: { sourcingUserId: String(users.purchEntry._id) } });

    assert.equal((await api('POST', `/enquiries/${e._id}/queries`, { token: tokens.purchEntry, body: { message: '   ' } })).status, 400);
    assert.equal((await api('POST', `/enquiries/${e._id}/queries`, { token: tokens.purchEntry, body: { message: 'x'.repeat(2001) } })).status, 400);
    assert.equal((await api('POST', `/enquiries/${e._id}/queries`, { token: tokens.purchEntry, body: { message: 'Which grade?' } })).status, 201);
    assert.equal((await api('PUT', `/enquiries/${e._id}/items/${item._id}/raise-query`, { token: tokens.purchEntry })).status, 200);
    assert.equal((await api('PUT', `/enquiries/${e._id}/items/${item._id}/raise-query`, { token: tokens.purchEntry })).status, 400); // already in query
    assert.equal((await api('PUT', `/enquiries/${e._id}/items/${item._id}/resolve-query`, { token: tokens.purchEntry2 })).status, 403);
    assert.equal((await api('PUT', `/enquiries/${e._id}/items/${item._id}/resolve-query`, { token: tokens.purchEntry })).status, 200);

    assert.equal((await api('PUT', `/enquiries/${e._id}/unsuccessful`, { token: tokens.salesMgr, body: {} })).status, 400);
    assert.equal((await api('PUT', `/enquiries/${new mongoose.Types.ObjectId()}/unsuccessful`, { token: tokens.salesMgr, body: { closeReason: 'x' } })).status, 404);
    assert.equal((await api('PUT', `/enquiries/${e._id}/unsuccessful`, { token: tokens.salesMgr, body: { closeReason: 'Customer cancelled' } })).status, 200);
    assert.equal((await Enquiry.findById(e._id)).status, 'unsuccessful');
});

test('enquiry: deleting an open enquiry removes everything attached; closed ones are kept', async () => {
    const res = await newEnquiry(tokens.salesEntry, [{ productId: String(product._id), quantity: 1 }, { productId: String(product2._id), quantity: 2 }]);
    const e = res.data;
    await api('POST', `/enquiries/${e._id}/queries`, { token: tokens.salesEntry, body: { message: 'hello' } });
    await VendorQuotation.create({ enquiryItemId: e.items[0]._id, vendorId: vendorA._id, vendorPrice: 5, enteredBy: users.purchEntry._id });

    // needs the "close as lost" permission, which Sales Entry does not have; and you can only delete what you can see
    assert.equal((await api('DELETE', `/enquiries/${e._id}`, { token: tokens.salesEntry })).status, 403);
    assert.equal((await api('DELETE', `/enquiries/${new mongoose.Types.ObjectId()}`, { token: tokens.salesMgr })).status, 404);
    assert.equal((await api('DELETE', '/enquiries/not-an-id', { token: tokens.salesMgr })).status, 400);

    const ok = await api('DELETE', `/enquiries/${e._id}`, { token: tokens.salesMgr });
    assert.equal(ok.status, 200);
    assert.equal(await Enquiry.countDocuments({ _id: e._id }), 0);
    assert.equal(await EnquiryItem.countDocuments({ enquiryId: e._id }), 0);
    assert.equal(await VendorQuotation.countDocuments({ enquiryItemId: { $in: e.items.map(i => i._id) } }), 0, 'its vendor quotes go with it');
    assert.equal(await mongoose.model('Query').countDocuments({ enquiryId: e._id }), 0, 'and its chat');

    // a closed enquiry is the record of what was quoted: refused
    const closed = (await newEnquiry(tokens.salesEntry, [{ productId: String(product._id), quantity: 1 }])).data;
    await Enquiry.updateOne({ _id: closed._id }, { status: 'completed', stage: 'completed' });
    const refused = await api('DELETE', `/enquiries/${closed._id}`, { token: tokens.salesMgr });
    assert.equal(refused.status, 409);
    assert.match(refused.data.error, /kept for the record/);
    assert.equal(await Enquiry.countDocuments({ _id: closed._id }), 1);
});

test('enquiry: combine keeps item progress and moves the query thread', async () => {
    const a = (await newEnquiry(tokens.salesEntry, [{ productId: String(product._id), quantity: 1 }])).data;
    const b = (await newEnquiry(tokens.salesEntry, [{ productId: String(product2._id), quantity: 2 }])).data;
    await api('POST', `/enquiries/${b._id}/queries`, { token: tokens.salesEntry, body: { message: 'thread to keep' } });
    await EnquiryItem.updateOne({ _id: b.items[0]._id }, { status: 'priced', salesPrice: 9 });
    await api('PUT', `/enquiries/${a._id}/assign`, { token: tokens.purchMgr, body: { sourcingUserId: String(users.purchEntry._id) } });

    assert.equal((await api('POST', '/enquiries/combine', { token: tokens.salesEntry, body: { targetEnquiryId: String(a._id), sourceItemIds: [a.items[0]._id] } })).status, 400); // already there
    assert.equal((await api('POST', '/enquiries/combine', { token: tokens.salesEntry, body: { targetEnquiryId: 'bad', sourceItemIds: [b.items[0]._id] } })).status, 400);
    const merged = await api('POST', '/enquiries/combine', { token: tokens.salesEntry, body: { targetEnquiryId: String(a._id), sourceItemIds: [b.items[0]._id] } });
    assert.equal(merged.status, 200);

    const moved = await EnquiryItem.findById(b.items[0]._id);
    assert.equal(String(moved.enquiryId), String(a._id));
    assert.equal(moved.status, 'priced', 'combining used to reset every moved item to "assigned"');
    assert.equal(await Enquiry.countDocuments({ _id: b._id }), 0, 'emptied source enquiry is removed');
    const thread = await api('GET', `/enquiries/${a._id}/queries`, { token: tokens.salesEntry });
    assert.equal(thread.data.length, 1);
});

test('deleting masters that are in use is refused with a clear message', async () => {
    const cust = await api('DELETE', `/customers/${customer._id}`, { token: tokens.admin });
    assert.equal(cust.status, 409);
    assert.match(cust.data.error, /enquir/);
    assert.equal((await api('DELETE', `/products/${product._id}`, { token: tokens.admin })).status, 409);
    assert.equal((await api('DELETE', `/vendors/${vendorA._id}`, { token: tokens.admin })).status, 409);
    assert.equal((await api('DELETE', `/vendors/${new mongoose.Types.ObjectId()}`, { token: tokens.admin })).status, 404);

    // unused ones delete fine
    const c = (await api('POST', '/customers', { token: tokens.admin, body: { name: 'Disposable Co' } })).data;
    assert.equal((await api('DELETE', `/customers/${c._id}`, { token: tokens.admin })).status, 200);
    const p = (await api('POST', '/products', { token: tokens.admin, body: { materialName: 'Disposable', uom: 'Kg' } })).data;
    assert.equal((await api('DELETE', `/products/${p._id}`, { token: tokens.admin })).status, 200);
    const v = (await api('POST', '/vendors', { token: tokens.admin, body: { name: 'Disposable Vendor' } })).data;
    assert.equal((await api('DELETE', `/vendors/${v._id}`, { token: tokens.admin })).status, 200);
});

test('vendor helpers: price history, last price and the WhatsApp message tolerate gaps', async () => {
    const hist = await api('GET', `/vendors/bulk-price-history?productId=${product._id}`, { token: tokens.purchEntry });
    assert.equal(hist.status, 200);
    assert.ok(hist.data.find(v => v.vendorName === 'Steel Co').hasHistory);
    assert.equal((await api('GET', '/vendors/bulk-price-history', { token: tokens.purchEntry })).status, 400);
    assert.equal((await api('GET', '/vendors/bulk-price-history?productId=zzz', { token: tokens.purchEntry })).status, 400);
    assert.equal((await api('GET', '/vendors/last-price', { token: tokens.purchEntry })).status, 400);

    const items = await EnquiryItem.find().limit(2);
    const msg = await api('POST', '/vendors/whatsapp-message', { token: tokens.purchEntry, body: { itemIds: items.map(i => String(i._id)) } });
    assert.equal(msg.status, 200);
    assert.match(msg.data.message, /requirement for the following materials/);
    assert.equal((await api('POST', '/vendors/whatsapp-message', { token: tokens.purchEntry, body: { itemIds: [] } })).status, 400);

    // an item whose product was removed out from under it no longer takes the whole request down
    const orphan = await EnquiryItem.collection.insertOne({ enquiryId: items[0].enquiryId, productId: new mongoose.Types.ObjectId(), quantity: 1, status: 'assigned' });
    const withOrphan = await api('POST', '/vendors/whatsapp-message', { token: tokens.purchEntry, body: { itemIds: [String(orphan.insertedId), String(items[0]._id)] } });
    assert.equal(withOrphan.status, 200);
    await EnquiryItem.collection.deleteOne({ _id: orphan.insertedId });
});

// ── Employees & roles ────────────────────────────────────────────────────────

test('users: validation, duplicates and referential cleanup on delete', async () => {
    const role = String(roles['Sales Operations – Entry']._id);
    const mk = (body) => api('POST', '/users', { token: tokens.admin, body: { name: 'New Person', email: 'new@test.com', password: 'secret1', roleId: role, ...body } });

    assert.equal((await mk({ email: 'not-an-email' })).status, 400);
    assert.equal((await mk({ password: '123' })).status, 400);
    assert.equal((await mk({ name: '  ' })).status, 400);
    assert.equal((await mk({ roleId: 'bad' })).status, 400);
    assert.equal((await mk({ supervisorId: String(users.salesEntry._id) })).status, 400); // not a manager
    const created = await mk({ email: 'New@Test.com' });
    assert.equal(created.status, 201);
    assert.equal(created.data.email, 'new@test.com'); // stored lower-case
    assert.equal((await mk({ email: 'NEW@test.com' })).status, 409); // duplicate ignoring case
    assert.equal((await login('new@test.com', 'secret1')).status, 200);

    // email clash on edit is a 409 (it used to be a 500), self-supervision is refused
    assert.equal((await api('PUT', `/users/${created.data._id}`, { token: tokens.admin, body: { email: 'admin@test.com' } })).status, 409);
    assert.equal((await api('PUT', `/users/${users.salesMgr._id}`, { token: tokens.admin, body: { supervisorId: String(users.salesMgr._id) } })).status, 400);
    assert.equal((await api('PUT', `/users/${created.data._id}`, { token: tokens.admin, body: { password: 'ab' } })).status, 400);

    // deleting a person tidies what pointed at them
    const kam = await User.create({ email: 'kamdel@test.com', name: 'KAM Del', password: 'x', roleId: roles['Key Accounts – Manager']._id });
    const cust = await Customer.create({ name: 'KAM Owned', assignedKAM: kam._id });
    const report = await User.create({ email: 'rep@test.com', name: 'Report', password: 'x', roleId: roles['Key Accounts – Entry']._id, supervisorId: kam._id });
    assert.equal((await api('DELETE', `/users/${kam._id}`, { token: tokens.admin })).status, 200);
    assert.equal((await Customer.findById(cust._id)).assignedKAM, null);
    assert.equal((await User.findById(report._id)).supervisorId, null);
    assert.equal((await api('DELETE', `/users/${users.admin._id}`, { token: tokens.admin })).status, 400); // not yourself
    assert.equal((await api('DELETE', '/users/bad', { token: tokens.admin })).status, 400);
});

test('users: the last person who can manage access cannot be deleted or demoted', async () => {
    // a custom role that can edit and delete employees but cannot manage roles, and holds everything the role it hands out does
    const hrRole = await Role.create({
        name: 'HR', category: 'sales', dashboardPage: 'sales.html',
        permissions: ['user.view', 'user.edit', 'user.delete', 'enquiry.view.assigned_customers', 'customer.view', 'quotation.download', 'query.send'],
    });
    const hr = await User.create({ email: 'hr@test.com', name: 'HR', password: await bcrypt.hash(PASSWORD, 4), roleId: hrRole._id, role: 'sales' });
    const hrToken = (await login('hr@test.com')).data.token;
    const kaEntry = String(roles['Key Accounts – Entry']._id);

    const demote = await api('PUT', `/users/${users.admin._id}`, { token: hrToken, body: { roleId: kaEntry } });
    assert.equal(demote.status, 400);
    assert.match(demote.data.error, /only person who can manage/);
    const del = await api('DELETE', `/users/${users.admin._id}`, { token: hrToken });
    assert.equal(del.status, 400);
    assert.match(del.data.error, /only person who can manage/);

    // you can't change your own role either
    assert.equal((await api('PUT', `/users/${hr._id}`, { token: hrToken, body: { roleId: String(roles['Admin']._id) } })).status, 400);

    // with a second person who can manage access, the first can go
    const admin2 = await User.create({ email: 'admin2@test.com', name: 'Admin 2', password: 'x', roleId: roles['Admin']._id, role: 'admin' });
    assert.equal((await api('DELETE', `/users/${admin2._id}`, { token: hrToken })).status, 200);
});

test('roles: validation and protection of the built-in Admin role', async () => {
    const adminRole = roles['Admin'];
    const full = { name: 'Admin', description: 'x', category: 'admin', dashboardPage: 'admin.html', color: '#10B981', permissions: adminRole.permissions };

    // the editor resends the whole role on save: harmless changes go through...
    assert.equal((await api('PUT', `/roles/${adminRole._id}`, { token: tokens.admin, body: { ...full, description: 'Full access', color: '#112233' } })).status, 200);
    // ...removing a permission, renaming, or re-categorising would risk locking everyone out
    assert.equal((await api('PUT', `/roles/${adminRole._id}`, { token: tokens.admin, body: { ...full, permissions: adminRole.permissions.filter(p => p !== 'role.edit') } })).status, 403);
    assert.equal((await api('PUT', `/roles/${adminRole._id}`, { token: tokens.admin, body: { ...full, name: 'Superuser' } })).status, 403);
    assert.equal((await api('PUT', `/roles/${adminRole._id}`, { token: tokens.admin, body: { ...full, category: 'sales' } })).status, 403);

    const create = (body) => api('POST', '/roles', { token: tokens.admin, body: { name: 'Auditor', category: 'sales', dashboardPage: 'sales.html', permissions: ['enquiry.view.all'], ...body } });
    assert.equal((await create({ dashboardPage: 'https://evil.example' })).status, 400); // redirect target after login
    assert.equal((await create({ dashboardPage: 'javascript:alert(1)' })).status, 400);
    assert.equal((await create({ permissions: 'enquiry.view.all' })).status, 400);
    assert.equal((await create({ permissions: ['made.up'] })).status, 400);
    assert.equal((await create({ color: 'red' })).status, 400);
    assert.equal((await create({ category: 'nonsense' })).status, 400);
    const ok = await create({});
    assert.equal(ok.status, 201);
    assert.equal((await create({})).status, 409);
    assert.equal((await api('PUT', `/roles/${ok.data._id}`, { token: tokens.admin, body: { name: 123 } })).status, 400);
    assert.equal((await api('GET', '/roles/bad', { token: tokens.admin })).status, 400);
    assert.equal((await api('DELETE', `/roles/${adminRole._id}`, { token: tokens.admin })).status, 403); // system role
});

test('notifications: you can only mark your own as read', async () => {
    const n = await Notification.create({ userId: users.salesMgr._id, message: 'hello' });
    assert.equal((await api('PUT', `/notifications/${n._id}/read`, { token: tokens.salesEntry })).status, 404);
    assert.equal((await Notification.findById(n._id)).isRead, false);
    assert.equal((await api('PUT', `/notifications/${n._id}/read`, { token: tokens.salesMgr })).status, 200);
    assert.equal((await Notification.findById(n._id)).isRead, true);
    assert.equal((await api('PUT', '/notifications/bad/read', { token: tokens.salesMgr })).status, 400);
});

// ── Bulk upload ──────────────────────────────────────────────────────────────

test('bulk upload: validates odd cells, ignores a spoofed creator, numbers like single create', async () => {
    const validate = await api('POST', '/enquiries/bulk/validate', {
        token: tokens.salesMgr,
        body: { rows: [{ customer: 12345, materialName: 'Cement', quantity: '5' }, { customer: null, materialName: '', quantity: 'x' }, null] },
    });
    assert.equal(validate.status, 200); // numeric/null cells used to crash on .trim()
    assert.equal(validate.data.validated[0].errors.length, 0);
    assert.ok(validate.data.validated[1].errors.length >= 3);
    assert.equal((await api('POST', '/enquiries/bulk/validate', { token: tokens.salesMgr, body: { rows: new Array(2001).fill({}) } })).status, 400);

    const res = await api('POST', '/enquiries/bulk/create', {
        token: tokens.salesMgr,
        body: {
            userId: String(users.admin._id), // spoof attempt
            enquiries: [
                { customerName: 'Brand New (Holdings) Ltd', items: [{ productId: String(product._id), quantity: 3 }] }, // regex-special characters
                { customerName: 'Brand New (Holdings) Ltd', items: [{ productId: String(product._id), quantity: 1 }], assignedTo: String(users.purchEntry._id) },
                { customerName: 'Broken', items: [] },
                { customerName: 'Broken 2', items: [{ productId: 'nope', quantity: 1 }] },
            ],
        },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.summary.successful, 2);
    assert.equal(res.data.summary.failed, 2);
    assert.ok(res.data.created.every(n => /^ENQ-\d{8}-\d{3}$/.test(n)), res.data.created.join());
    assert.equal(await Customer.countDocuments({ name: 'Brand New (Holdings) Ltd' }), 1, 'the second row reuses the customer');

    const made = await Enquiry.findOne({ enquiryNumber: res.data.created[0] });
    assert.equal(String(made.createdBy), String(users.salesMgr._id), 'creator must be the logged-in user');
    const assigned = await Enquiry.findOne({ enquiryNumber: res.data.created[1] });
    assert.equal(assigned.stage, 'open');
    assert.equal((await EnquiryItem.find({ enquiryId: assigned._id })).every(i => i.status === 'assigned' && String(i.assignedTo) === String(users.purchEntry._id)), true);
});

test('enquiry list: the batched version returns exactly what populating each field would (including odd data)', async () => {
    const Query = mongoose.model('Query');
    // ordinary rows
    const a = (await newEnquiry(tokens.salesEntry, [{ productId: String(product._id), quantity: 2 }, { productId: String(product2._id), quantity: 1 }])).data;
    await api('PUT', `/enquiries/${a._id}/assign`, { token: tokens.purchMgr, body: { sourcingUserId: String(users.purchEntry._id) } });
    const quote = await VendorQuotation.create({ enquiryItemId: a.items[0]._id, vendorId: vendorA._id, vendorPrice: 10, enteredBy: users.purchEntry._id });
    await EnquiryItem.updateOne({ _id: a.items[0]._id }, { selectedVendorQuoteId: quote._id });
    await Query.create({ enquiryId: a._id, senderId: users.salesEntry._id, message: 'hi' });
    // odd rows: a creator who was deleted, a material that was deleted, an enquiry nobody has been assigned to
    const ghost = await User.create({ email: 'gone@test.com', name: 'Gone', password: 'x', roleId: roles['Sales Operations – Entry']._id, role: 'sales' });
    const odd = await Enquiry.create({ enquiryNumber: 'ENQ-ODD-001', customerId: customer._id, createdBy: ghost._id, status: 'active', stage: 'new' });
    const lostProduct = await Product.create({ materialName: 'Lost', uom: 'Kg' });
    await EnquiryItem.create({ enquiryId: odd._id, productId: lostProduct._id, quantity: 1, status: 'unassigned' });
    await User.deleteOne({ _id: ghost._id });
    await Product.deleteOne({ _id: lostProduct._id });

    // what the old code produced: populate each field per query
    const expectedEnquiries = await Enquiry.find({ status: { $nin: ['completed', 'unsuccessful', 'closed'] } })
        .populate('createdBy', 'name email').populate('assignedTo', 'name email')
        .populate('customerId', 'name contactPerson address email phone assignedKAM');
    const result = await api('GET', '/enquiries', { token: tokens.admin });
    assert.equal(result.status, 200);

    for (const expected of expectedEnquiries) {
        const items = await EnquiryItem.find({ enquiryId: expected._id }).populate('productId').populate('assignedTo', 'name email').populate('selectedVendorQuoteId');
        const queryCount = await Query.countDocuments({ enquiryId: expected._id });
        const want = JSON.parse(JSON.stringify({ ...expected.toObject(), items, queryCount }));
        const got = result.data.find(e => e._id === String(expected._id));
        assert.ok(got, `${expected.enquiryNumber} is missing from the list`);
        // item order within an enquiry is not promised, so compare items by id
        const key = (o) => ({ ...o, items: [...o.items].sort((x, y) => x._id.localeCompare(y._id)) });
        assert.deepEqual(key(got), key(want), `${expected.enquiryNumber} differs from the populated version`);
    }
    const oddRow = result.data.find(e => e.enquiryNumber === 'ENQ-ODD-001');
    assert.equal(oddRow.createdBy, null, 'a deleted creator reads as null, as populate does');
    assert.equal(oddRow.items[0].productId, null, 'a deleted material reads as null');
});

test('enquiry numbers carry on from enquiries numbered before the counter existed, and never repeat', async () => {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const before = (await Enquiry.find({ enquiryNumber: new RegExp(`^ENQ-${day}-`) })).map(e => parseInt(e.enquiryNumber.split('-')[2], 10));
    const highest = Math.max(0, ...before);
    // as if an older version of the app had numbered a few more today, and the counter row had never been made
    await mongoose.model('Counter').deleteMany({});
    await Enquiry.create({ enquiryNumber: `ENQ-${day}-${String(highest + 3).padStart(3, '0')}`, customerId: customer._id, createdBy: users.salesEntry._id });
    const next = await newEnquiry(tokens.salesEntry, [{ productId: String(product._id), quantity: 1 }]);
    assert.equal(next.status, 201);
    assert.equal(next.data.enquiryNumber, `ENQ-${day}-${String(highest + 4).padStart(3, '0')}`, 'continues after the highest number already used');
    const again = await newEnquiry(tokens.salesEntry, [{ productId: String(product._id), quantity: 1 }]);
    assert.equal(again.data.enquiryNumber, `ENQ-${day}-${String(highest + 5).padStart(3, '0')}`);
});
