/**
 * Speed guards. They check things that make an app slow as data grows (round trips and payload size), not wall-clock
 * time, so they don't flicker on a busy machine:
 *   - a request makes the same number of database calls whether there are 5 enquiries or 150 (no per-row queries)
 *   - the enquiry list never sends an unbounded amount of history
 * Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const start = require('./helpers');
const P = require('../constants/permissions');

let t, calls = 0;
const people = {};
let customer, products, vendors;

test.before(async () => {
    process.env.CLOSED_LIST_CAP = '40';
    t = await start();
    t.mongoose.set('debug', () => { calls++; });
    const { roles, makePerson, db } = t;
    people.admin = await makePerson('admin', roles['Admin'], 'Admin');
    people.sales = await makePerson('sales', roles['Sales Operations – Entry'], 'Sara Sales');
    people.purchase = await makePerson('purchase', roles['Purchase Operations – Entry'], 'Pat Purchase');
    people.kam = await makePerson('kam', roles['Key Accounts – Entry'], 'Kim KAM');
    customer = await db.Customer.create({ name: 'Acme', assignedKAM: people.kam.user._id });
    products = await db.Product.insertMany(Array.from({ length: 5 }, (_, i) => ({ materialName: `Mat ${i}`, uom: 'Kg' })));
    vendors = await db.Vendor.insertMany([{ name: 'V1' }, { name: 'V2' }]);
});
test.after(async () => { if (t) await t.stop(); });

// Adds `count` enquiries (3 items each, one with a vendor quote and one with a chat message)
let serial = 0;
const addEnquiries = async (count, { status = 'active', assignTo = null } = {}) => {
    const { db } = t;
    const docs = Array.from({ length: count }, () => ({
        enquiryNumber: `ENQ-20260101-${String(++serial).padStart(5, '0')}`, customerId: customer._id, createdBy: people.sales.user._id,
        status, stage: status === 'active' ? 'new' : 'completed', createdAt: new Date(Date.now() - serial * 1000),
    }));
    const made = await db.Enquiry.insertMany(docs);
    const items = await db.EnquiryItem.insertMany(made.flatMap(e => products.slice(0, 3).map(p => ({
        enquiryId: e._id, productId: p._id, quantity: 1, status: status === 'active' ? (assignTo ? 'assigned' : 'unassigned') : 'completed', assignedTo: assignTo,
    }))));
    await db.VendorQuotation.insertMany(items.filter((_, i) => i % 3 === 0).map(it => ({ enquiryItemId: it._id, vendorId: vendors[0]._id, vendorPrice: 5, enteredBy: people.admin.user._id })));
    await db.Query.insertMany(made.map(e => ({ enquiryId: e._id, senderId: people.sales.user._id, message: 'hi' })));
    return made;
};

const measure = async (who, path) => {
    calls = 0;
    const res = await fetch(`${t.baseUrl}/api${path}`, { headers: { Authorization: `Bearer ${who.token}`, 'Accept-Encoding': 'identity' } });
    const body = await res.text();
    return { status: res.status, calls, bytes: body.length, headers: res.headers, json: res.status === 200 ? JSON.parse(body) : null };
};

const REQUESTS = [
    ['enquiry list (manager sees all)', () => people.admin, '/enquiries'],
    ['enquiry list (sales sees their own)', () => people.sales, '/enquiries'],
    ['enquiry list (purchase queue)', () => people.purchase, '/enquiries'],
    ['enquiry list (key account)', () => people.kam, '/enquiries'],
    ['customers', () => people.sales, '/customers'],
    ['materials', () => people.sales, '/products'],
    ['people who can take work', () => people.sales, '/users/sourcing'],
    ['employees', () => people.admin, '/users'],
    ['roles', () => people.admin, '/roles'],
    ['notifications', () => people.sales, '/notifications'],
];

test('no request makes more database calls as the data grows (no per-row queries)', async () => {
    await addEnquiries(5);
    await addEnquiries(5, { assignTo: people.purchase.user._id });
    const small = {};
    for (const [name, who, path] of REQUESTS) { await measure(who(), path); small[name] = (await measure(who(), path)).calls; }

    await addEnquiries(60);
    await addEnquiries(60, { assignTo: people.purchase.user._id });
    const large = {};
    for (const [name, who, path] of REQUESTS) { large[name] = (await measure(who(), path)).calls; }

    for (const [name] of REQUESTS) assert.equal(large[name], small[name], `${name}: ${small[name]} database calls with 10 enquiries but ${large[name]} with 130`);
    for (const [name] of REQUESTS) assert.ok(large[name] <= 12, `${name} makes ${large[name]} database calls`);
});

test('the enquiry list sends every open enquiry but only a capped amount of closed history, and says so', async () => {
    await addEnquiries(70, { status: 'completed' });          // more closed than the cap (40)
    const openCount = await t.db.Enquiry.countDocuments({ status: 'active' });
    const closedCount = await t.db.Enquiry.countDocuments({ status: 'completed' });
    assert.ok(closedCount > 40 && openCount > 100);

    const res = await measure(people.admin, '/enquiries');
    assert.equal(res.status, 200);
    const closedSent = res.json.filter(e => e.status === 'completed').length;
    const openSent = res.json.filter(e => e.status === 'active').length;
    assert.equal(openSent, openCount, 'open enquiries are the work in hand: all of them, always');
    assert.equal(closedSent, 40, 'closed history is capped');
    assert.equal(res.headers.get('x-total-count'), String(openCount + closedCount));
    assert.equal(res.headers.get('x-returned-count'), String(openCount + 40));
    // the closed ones that are sent are the newest, and the list is newest-first overall
    const newestClosed = (await t.db.Enquiry.find({ status: 'completed' }).sort({ createdAt: -1 }).limit(40)).map(e => String(e._id));
    assert.deepEqual(res.json.filter(e => e.status === 'completed').map(e => e._id).sort(), newestClosed.sort());
    const times = res.json.map(e => new Date(e.createdAt).getTime());
    assert.deepEqual([...times].sort((a, b) => b - a), times);

    // asking for completed work still honours the cap and reports the totals
    const completed = await measure(people.admin, '/enquiries?stage=completed');
    assert.equal(completed.json.length, 40);
    assert.equal(completed.headers.get('x-total-count'), String(closedCount));
});

test('responses are compressed when the browser can read them', async () => {
    // node:http hands over the bytes exactly as sent (fetch would silently decompress them)
    const raw = await new Promise((resolve, reject) => {
        require('node:http').get(`${t.baseUrl}/api/enquiries`, { headers: { Authorization: `Bearer ${people.admin.token}`, 'Accept-Encoding': 'gzip' } }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
        }).on('error', reject);
    });
    assert.equal(raw.headers['content-encoding'], 'gzip');
    const plain = zlib.gunzipSync(raw.body);
    assert.ok(raw.body.length < plain.length / 4, `expected at least 4x smaller, got ${plain.length} -> ${raw.body.length} bytes`);
    assert.ok(Array.isArray(JSON.parse(plain.toString())));
});

test('a page that fires several requests at once looks the person and their role up once, not once per request', async () => {
    const { roles, makePerson } = t;
    process.env.USER_CACHE_TTL_MS = '60000';
    try {
        // a role and a person nobody has used yet, so nothing about them is remembered
        const burstRole = await t.makeRole({ name: 'Burst Role', category: 'sales', dashboardPage: 'sales.html', permissions: roles['Sales Operations – Entry'].permissions });
        const fresh = await makePerson('burst', burstRole, 'Bea Burst');
        const lookups = { users: 0, roles: 0 };
        t.mongoose.set('debug', (collection, method) => {
            if (collection === 'users' && method === 'findOne') lookups.users++;
            if (collection === 'roles' && method === 'findOne') lookups.roles++;
        });
        const burst = await Promise.all(['/customers', '/products', '/users/sourcing', '/notifications', '/enquiries']
            .map(p => fetch(`${t.baseUrl}/api${p}`, { headers: { Authorization: `Bearer ${fresh.token}` } })));
        assert.ok(burst.every(r => r.status === 200), burst.map(r => r.status).join());
        assert.equal(lookups.users, 1, `five requests made ${lookups.users} user lookups`);
        assert.equal(lookups.roles, 1, `five requests made ${lookups.roles} role lookups`);
    } finally {
        process.env.USER_CACHE_TTL_MS = '0';
        t.mongoose.set('debug', () => { calls++; });
    }
});
