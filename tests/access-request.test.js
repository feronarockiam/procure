/**
 * Asking for access in one click, and "needs you today" cards that never lead to a page the person can't open.
 * Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const start = require('./helpers');
const P = require('../constants/permissions');

let t, admin, seller;
test.before(async () => {
    t = await start();
    admin = await t.makePerson('ar-admin', t.roles['Admin'], 'Head Admin');
    seller = await t.makePerson('ar-sell', t.roles['Sales Operations – Entry'], 'Sally Seller');
});
test.after(async () => { await t.stop(); });

const ask = (token, body) => t.api('POST', '/access-requests', { token, body });

test('access request: administrators are told, with a link to the person, and asking twice does not pile up', async () => {
    const first = await ask(seller.token, { wants: 'Reports', note: 'I check weekly volumes' });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.deepEqual([first.data.sent >= 1, first.data.already], [true, false]);
    const notes = await t.db.Notification.find({ userId: admin.user._id, message: /Sally Seller/ }).lean();
    assert.equal(notes.length, 1);
    assert.match(notes[0].message, /Reports/);
    assert.match(notes[0].message, /weekly volumes/);
    assert.equal(notes[0].link, `/masters.html?type=employees&edit=${seller.user._id}`);
    assert.equal(notes[0].type, 'warning');

    const again = await ask(seller.token, { wants: 'Reports', note: 'I check weekly volumes' });
    assert.equal(again.data.already, true);
    assert.equal((await t.db.Notification.find({ userId: admin.user._id, message: /Sally Seller/ })).length, 1, 'no second notification');
    const log = await t.api('GET', '/audit?type=people', { token: admin.token });
    assert.ok(log.data.events.some(e => e.action === 'access.requested' && /Sally Seller/.test(e.summary)));
});

test('access request: bad input is refused, nobody to ask is said plainly, and you must be signed in', async () => {
    assert.equal((await ask(seller.token, {})).status, 400);
    assert.equal((await ask(seller.token, { wants: 'x'.repeat(121) })).status, 400);
    assert.equal((await ask(seller.token, { wants: 'Reports', note: 'n'.repeat(401) })).status, 400);
    assert.equal((await ask(seller.token, { wants: { $ne: 1 } })).status, 400);
    assert.equal((await t.api('POST', '/access-requests', { body: { wants: 'Reports' } })).status, 401);
    // the only administrator asking has nobody else to ask
    const lone = await t.api('POST', '/access-requests', { token: admin.token, body: { wants: 'More' } });
    assert.equal(lone.data.sent, 0);
});

test('needs you today: a card only links to a page this person can open, for every built-in role', async () => {
    const customer = await t.db.Customer.create({ name: 'Link Customer' });
    const product = await t.db.Product.create({ materialName: 'Link Material', uom: 'Pcs' });
    const made = await t.api('POST', '/enquiries', { token: seller.token, body: { customerId: String(customer._id), items: [{ productId: String(product._id), quantity: 1 }] } });
    await t.db.Enquiry.collection.updateOne({ _id: new t.mongoose.Types.ObjectId(made.data._id) }, { $set: { createdAt: new Date(Date.now() - 6 * 86400000) } });
    for (const name of Object.keys(t.roles)) {
        const who = await t.makePerson(`ar-${name.replace(/\W+/g, '')}`, t.roles[name], name);
        const links = P.allowedLinks(t.roles[name].permissions).map(h => h.split('?')[0]);
        const res = await t.api('GET', '/enquiries/todo', { token: who.token });
        assert.equal(res.status, 200);
        for (const task of res.data.tasks) {
            assert.ok(task.href === null || links.includes(task.href.split('?')[0]), `${name}: "${task.label}" links to ${task.href}, which this role cannot open`);
        }
    }
});
