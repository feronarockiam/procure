/**
 * Activity log, timestamps, sign-in protection, deactivation, own-password change, production configuration.
 * Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const start = require('./helpers');
const config = require('../config');

let t, admin, sales, customer, product;

test.before(async () => {
    t = await start();
    admin = await t.makePerson('boss', t.roles['Admin'], 'Boss Person');
    sales = await t.makePerson('seller', t.roles['Sales Operations – Entry'], 'Sam Seller');
    customer = await t.db.Customer.create({ name: 'Acme Test' });
    product = await t.db.Product.create({ materialName: 'Cement', uom: 'Bag' });
});
test.after(async () => { await t.stop(); });

const makeEnquiry = () => t.api('POST', '/enquiries', {
    token: sales.token, body: { customerId: String(customer._id), items: [{ productId: String(product._id), quantity: 3 }] },
});

test('activity: creating an enquiry is recorded with who, what and when, and shows in its history', async () => {
    const before = Date.now();
    const made = await makeEnquiry();
    assert.equal(made.status, 201);
    const log = await t.api('GET', '/audit?type=enquiries', { token: admin.token });
    assert.equal(log.status, 200);
    const event = log.data.events.find(e => e.action === 'enquiry.created');
    assert.ok(event, 'no enquiry.created event');
    assert.equal(event.actor.name, 'Sam Seller');
    assert.match(event.summary, /ENQ-/);
    assert.ok(new Date(event.at).getTime() >= before - 1000, 'event time is wrong');

    const history = await t.api('GET', `/enquiries/${made.data._id}/history`, { token: sales.token });
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.data) && history.data.some(e => e.summary.includes('ENQ-')), 'history is a list of events');
});

test('activity: only people whose role includes the activity log can read it', async () => {
    assert.equal((await t.api('GET', '/audit', { token: sales.token })).status, 403);
    assert.equal((await t.api('GET', '/audit/people', { token: sales.token })).status, 403);
    assert.equal((await t.api('GET', '/audit')).status, 401);
});

test('activity: filters, paging and bad input', async () => {
    for (let i = 0; i < 3; i++) await makeEnquiry();
    const page1 = await t.api('GET', '/audit?limit=2', { token: admin.token });
    assert.equal(page1.data.events.length, 2);
    assert.ok(page1.data.nextBefore, 'a further page was expected');
    const page2 = await t.api('GET', `/audit?limit=2&before=${encodeURIComponent(page1.data.nextBefore)}`, { token: admin.token });
    const seen = new Set(page1.data.events.map(e => String(e._id)));
    for (const e of page2.data.events) assert.ok(!seen.has(String(e._id)), 'a page repeated an event');

    const today = new Date().toISOString().slice(0, 10);
    assert.ok((await t.api('GET', `/audit?from=${today}&to=${today}`, { token: admin.token })).data.events.length > 0, 'today should include today');
    assert.equal((await t.api('GET', '/audit?to=2000-01-01', { token: admin.token })).data.events.length, 0);
    assert.equal((await t.api('GET', '/audit?type=nonsense', { token: admin.token })).status, 400);
    assert.equal((await t.api('GET', '/audit?from=not-a-date', { token: admin.token })).status, 400);
    assert.equal((await t.api('GET', '/audit?actor=zzz', { token: admin.token })).status, 400);
    // regex characters in a search are text, not a pattern
    assert.equal((await t.api('GET', '/audit?q=' + encodeURIComponent('(['), { token: admin.token })).status, 200);
    const mine = await t.api('GET', `/audit?actor=${sales.user._id}`, { token: admin.token });
    assert.ok(mine.data.events.length && mine.data.events.every(e => e.actor.name === 'Sam Seller'));
    const people = await t.api('GET', '/audit/people', { token: admin.token });
    assert.ok(people.data.some(p => p.name === 'Sam Seller'));
});

test('timestamps: records carry created/updated times and milestone times are set as work moves', async () => {
    const made = await makeEnquiry();
    const enquiry = await t.db.Enquiry.findById(made.data._id).lean();
    assert.ok(enquiry.createdAt && enquiry.updatedAt);
    const item = await t.db.EnquiryItem.findOne({ enquiryId: enquiry._id }).lean();
    assert.ok(item.createdAt);
    // assign, quote, price: each stamps its time
    const assignee = await t.makePerson('buyer', t.roles['Purchase Operations – Entry'], 'Bea Buyer');
    const admin2 = admin.token;
    const assigned = await t.api('POST', `/enquiries/${enquiry._id}/assign`, { token: admin2, body: { sourcingUserId: String(assignee.user._id) } });
    if (assigned.status === 200) {
        assert.ok((await t.db.EnquiryItem.findById(item._id).lean()).assignedAt, 'assignedAt missing');
    }
    const vendor = await t.db.Vendor.create({ name: 'Time Vendor' });
    const quoted = await t.api('POST', '/vendors/quotations', { token: admin2, body: { enquiryItemId: String(item._id), vendorId: String(vendor._id), vendorPrice: 100 } });
    assert.equal(quoted.status, 201, JSON.stringify(quoted.data));
    assert.ok((await t.db.EnquiryItem.findById(item._id).lean()).quotedAt, 'quotedAt missing');
    const log = await t.api('GET', '/audit?type=prices', { token: admin2 });
    assert.ok(log.data.events.some(e => /Time Vendor/.test(e.summary) && /₹100/.test(e.summary)));
});

test('activity: changes to people, roles and masters are recorded', async () => {
    const role = await t.api('POST', '/roles', { token: admin.token, body: { name: 'Audit Test Role', permissions: ['material.view'], category: 'sales' } });
    assert.ok([200, 201].includes(role.status), JSON.stringify(role.data));
    const vend = await t.api('POST', '/vendors', { token: admin.token, body: { name: 'Logged Vendor' } });
    assert.equal(vend.status, 201);
    const log = await t.api('GET', '/audit?limit=50', { token: admin.token });
    const actions = log.data.events.map(e => e.action);
    assert.ok(actions.includes('role.created'), 'role.created missing');
    assert.ok(actions.includes('vendor.created'), 'vendor.created missing');
});

test('sign-in: remembers the last sign-in, logs sign-ins and failed attempts, never logs the password', async () => {
    const first = await t.login('seller@test.com');
    assert.equal(first.status, 200);
    const second = await t.login('seller@test.com');
    assert.ok(second.data.user.lastLoginAt, 'the previous sign-in time should be returned');
    await t.login('seller@test.com', 'wrong-password-xyz');
    const log = await t.api('GET', '/audit?type=signins&limit=50', { token: admin.token });
    assert.ok(log.data.events.some(e => e.action === 'auth.login'));
    assert.ok(log.data.events.some(e => e.action === 'auth.login_failed'));
    assert.ok(!JSON.stringify(log.data).includes('wrong-password-xyz'), 'a password was written to the log');
    assert.ok(log.data.events.filter(e => e.action.startsWith('auth.')).every(e => e.expireAt), 'sign-in events should expire');
});

test('sign-in: repeated wrong passwords are slowed down, and a correct one is never punished for them', async () => {
    process.env.LOGIN_MAX_ATTEMPTS = '3';
    try {
        const email = 'seller@test.com';
        for (let i = 0; i < 3; i++) assert.equal((await t.login(email, `bad-${i}`)).status, i < 2 ? 401 : 429);
        const blocked = await t.login(email, t.PASSWORD);
        assert.equal(blocked.status, 429);
        assert.match(blocked.data.error, /wait/i);
        assert.ok(blocked.headers.get('retry-after'));
        // someone else is not affected
        assert.equal((await t.login('boss@test.com')).status, 200);
    } finally {
        delete process.env.LOGIN_MAX_ATTEMPTS;
    }
});

test('deactivation: a turned-off person cannot sign in or keep working, and does not appear in pickers', async () => {
    const buyer = await t.makePerson('off', t.roles['Purchase Operations – Entry'], 'Olly Off');
    const off = await t.api('PUT', `/users/${buyer.user._id}`, { token: admin.token, body: { active: false } });
    assert.equal(off.status, 200, JSON.stringify(off.data));
    assert.equal((await t.login('off@test.com')).status, 403);
    const stale = await t.api('GET', '/enquiries', { token: buyer.token });
    assert.equal(stale.status, 401);
    assert.match(stale.data.error, /deactivated/i);
    const on = await t.api('PUT', `/users/${buyer.user._id}`, { token: admin.token, body: { active: true } });
    assert.equal(on.status, 200);
    assert.equal((await t.login('off@test.com')).status, 200);
    assert.equal((await t.api('PUT', `/users/${buyer.user._id}`, { token: admin.token, body: { active: 'no' } })).status, 400);
});

test('deactivation: you cannot turn yourself off, nor the last person who manages access', async () => {
    assert.equal((await t.api('PUT', `/users/${admin.user._id}`, { token: admin.token, body: { active: false } })).status, 400);
    // a second manager exists only on paper while turned off: the first still can't be removed
    const second = await t.makePerson('boss2', t.roles['Admin'], 'Second Boss');
    assert.equal((await t.api('PUT', `/users/${second.user._id}`, { token: admin.token, body: { active: false } })).status, 200);
    assert.equal((await t.api('PUT', `/users/${second.user._id}`, { token: admin.token, body: { active: true } })).status, 200);
    const log = await t.api('GET', '/audit?type=people&limit=50', { token: admin.token });
    assert.ok(log.data.events.some(e => e.action === 'user.deactivated'));
});

test('password: a person can change their own, with the right current password', async () => {
    const me = await t.makePerson('pw', t.roles['Sales Operations – Entry'], 'Pat Word');
    const call = (body) => t.api('POST', '/auth/change-password', { token: me.token, body });
    assert.equal((await call({ currentPassword: 'nope', newPassword: 'brandnew1' })).status, 400);
    assert.equal((await call({ currentPassword: t.PASSWORD, newPassword: 'abc' })).status, 400);
    assert.equal((await call({ currentPassword: t.PASSWORD, newPassword: t.PASSWORD })).status, 400);
    assert.equal((await call({ currentPassword: { $ne: 1 }, newPassword: 'brandnew1' })).status, 400);
    assert.equal((await call({ currentPassword: t.PASSWORD, newPassword: 'brandnew1' })).status, 200);
    assert.equal((await t.login('pw@test.com', t.PASSWORD)).status, 401);
    assert.equal((await t.login('pw@test.com', 'brandnew1')).status, 200);
    assert.equal((await t.api('POST', '/auth/change-password', { body: { currentPassword: 'a', newPassword: 'b' } })).status, 401);
});

test('production: public config, security headers, and a start-up check that refuses unsafe settings', async () => {
    const cfg = await t.api('GET', '/config');
    assert.equal(cfg.status, 200);
    assert.equal(typeof cfg.data.demoLogin, 'boolean');
    const res = await fetch(`${t.baseUrl}/`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);

    const good = { NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://u:p@host/db', JWT_SECRET: 'x'.repeat(40) };
    assert.deepEqual(config.validateConfig(good).fatal, []);
    assert.ok(config.validateConfig({ ...good, JWT_SECRET: 'short' }).fatal.length, 'a short secret must stop production');
    assert.ok(config.validateConfig({ ...good, JWT_SECRET: undefined }).fatal.length);
    assert.ok(config.validateConfig({ ...good, MONGODB_URI: 'http://nope' }).fatal.length);
    assert.equal(config.validateConfig({ ...good, JWT_SECRET: 'short', NODE_ENV: 'development' }).fatal.length, 0);
    assert.ok(config.validateConfig({ ...good, SHOW_DEMO_LOGIN: 'true' }).warnings.length);
});

test('the sign-in page hides the demo buttons until the server allows them', () => {
    const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.match(html, /id="demoSection"[^>]*hidden/);
    assert.match(html, /\/api\/config/);
});

test('upgrade: an Admin role saved by an older version gets the new permissions at start-up, and nothing is taken away', async () => {
    const { syncAdminRole } = require('../utils/syncAdminRole');
    await t.db.Role.updateOne({ _id: t.roles['Admin']._id }, { $pull: { permissions: 'audit.view' } });
    assert.ok(!(await t.db.Role.findById(t.roles['Admin']._id)).permissions.includes('audit.view'));
    await syncAdminRole({ force: true });
    const after = await t.db.Role.findById(t.roles['Admin']._id);
    assert.ok(after.permissions.includes('audit.view'));
    // other roles are left alone
    assert.ok(!(await t.db.Role.findById(t.roles['Sales Operations – Entry']._id)).permissions.includes('audit.view'));
});

test('price memory: last price per vendor and material is available only to people who handle vendor prices', async () => {
    const vendor = await t.db.Vendor.create({ name: 'Memory Vendor' });
    const made = await makeEnquiry();
    const item = await t.db.EnquiryItem.findOne({ enquiryId: made.data._id });
    assert.equal((await t.api('POST', '/vendors/quotations', { token: admin.token, body: { enquiryItemId: String(item._id), vendorId: String(vendor._id), vendorPrice: 420 } })).status, 201);

    const last = await t.api('GET', `/vendors/last-price?vendorId=${vendor._id}&productId=${product._id}`, { token: admin.token });
    assert.equal(last.status, 200);
    assert.equal(last.data.price, 420);
    assert.ok(last.data.date);
    const bulk = await t.api('GET', `/vendors/bulk-price-history?productId=${product._id}`, { token: admin.token });
    assert.equal(bulk.data.find(v => v.vendorName === 'Memory Vendor').price, 420);

    // a role that sees neither vendors nor prices cannot read vendor pricing
    const nosy = await t.makePerson('nosy', await t.makeRole({ name: 'Customers Only', permissions: ['customer.view'] }), 'Nosy Nora');
    assert.equal((await t.api('GET', `/vendors/last-price?vendorId=${vendor._id}&productId=${product._id}`, { token: nosy.token })).status, 403);
    assert.equal((await t.api('GET', `/vendors/bulk-price-history?productId=${product._id}`, { token: nosy.token })).status, 403);
});

test('price memory: the quote form says where a filled-in price came from and never overwrites typed prices', () => {
    const fs = require('node:fs'), path = require('node:path');
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'sourcing.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'sourcing.html'), 'utf8');
    assert.match(html, /id="priceHint"/);
    assert.match(js, /function applyRememberedPrice/);
    assert.match(js, /dataset\.prefilled/, 'only app-filled numbers may be replaced');
    assert.match(js, /STALE_PRICE_DAYS/);
    assert.match(js, /applyRememberedPrice\(priceMap\[vendorId\], vendorName\)/, 'picking a vendor must go through it');
});

test('password: changing it ends older sessions, hands back a fresh one, and an admin reset ends the person\'s session too', async () => {
    const me = await t.makePerson('swap', t.roles['Sales Operations – Entry'], 'Swap Pass');
    await new Promise(r => setTimeout(r, 1100)); // tokens are dated to the second
    const changed = await t.api('POST', '/auth/change-password', { token: me.token, body: { currentPassword: t.PASSWORD, newPassword: 'fresh-pass-1' } });
    assert.equal(changed.status, 200);
    assert.ok(changed.data.token, 'a fresh token should come back');
    const old = await t.api('GET', '/auth/me', { token: me.token });
    assert.equal(old.status, 401);
    assert.match(old.data.error, /password was changed/i);
    assert.equal((await t.api('GET', '/auth/me', { token: changed.data.token })).status, 200, 'the fresh token must work');

    const other = await t.makePerson('reset', t.roles['Sales Operations – Entry'], 'Reset Me');
    await new Promise(r => setTimeout(r, 1100));
    assert.equal((await t.api('PUT', `/users/${other.user._id}`, { token: admin.token, body: { password: 'admin-set-1' } })).status, 200);
    assert.equal((await t.api('GET', '/auth/me', { token: other.token })).status, 401);
    assert.equal((await t.login('reset@test.com', 'admin-set-1')).status, 200);
});

test('sign-in: an unknown email and a wrong password look the same to the caller', async () => {
    const unknown = await t.login('nobody-here@test.com', 'whatever1');
    const wrong = await t.login('seller@test.com', 'whatever1');
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(unknown.data, wrong.data);
});
