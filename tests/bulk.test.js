/**
 * Assigning many items at once, across enquiries. Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const start = require('./helpers');

let t, admin, seller, buyer, buyer2, customer, products;
test.before(async () => {
    t = await start();
    admin = await t.makePerson('chief', t.roles['Admin'], 'Chief');
    seller = await t.makePerson('vend', t.roles['Sales Operations – Entry'], 'Vera Vend');
    buyer = await t.makePerson('buy1', t.roles['Purchase Operations – Entry'], 'Bo Buyer');
    buyer2 = await t.makePerson('buy2', t.roles['Purchase Operations – Entry'], 'Bea Buyer');
    customer = await t.db.Customer.create({ name: 'Bulk Customer' });
    products = await Promise.all(['Cement', 'Steel', 'Pipe', 'Wire'].map(n => t.db.Product.create({ materialName: n, uom: 'Pcs' })));
});
test.after(async () => { await t.stop(); });

const makeEnquiry = async (idx) => {
    const res = await t.api('POST', '/enquiries', { token: seller.token, body: { customerId: String(customer._id), items: idx.map(i => ({ productId: String(products[i]._id), quantity: 2 })) } });
    assert.equal(res.status, 201);
    const items = await t.db.EnquiryItem.find({ enquiryId: res.data._id }).lean();
    return { id: res.data._id, number: res.data.enquiryNumber, itemIds: items.map(i => String(i._id)) };
};
const bulk = (token, itemIds, sourcingUserId) => t.api('POST', '/enquiries/assign-items', { token, body: { itemIds, sourcingUserId } });

test('bulk assign: a manager hands items from several enquiries to one person in one go', async () => {
    const a = await makeEnquiry([0, 1]), b = await makeEnquiry([2, 3]);
    const picked = [a.itemIds[0], a.itemIds[1], b.itemIds[0]];
    const res = await bulk(admin.token, picked, String(buyer.user._id));
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data, { assigned: 3, skipped: 0, enquiries: 2 });

    const items = await t.db.EnquiryItem.find({ _id: { $in: picked } }).lean();
    assert.ok(items.every(i => i.status === 'assigned' && String(i.assignedTo) === String(buyer.user._id) && i.assignedAt));
    const untouched = await t.db.EnquiryItem.findById(b.itemIds[1]).lean();
    assert.equal(untouched.status, 'unassigned');
    assert.equal((await t.db.Enquiry.findById(a.id)).stage, 'open');
    // one history line in each enquiry, and one notification for the person
    for (const e of [a, b]) {
        const hist = await t.api('GET', `/enquiries/${e.id}/history`, { token: admin.token });
        assert.ok(hist.data.some(h => /Assigned \d+ item/.test(h.summary) && h.summary.includes('Bo Buyer')), `history of ${e.number}`);
    }
    const notes = await t.db.Notification.find({ userId: buyer.user._id, message: /3 item/ });
    assert.equal(notes.length, 1);
});

test('bulk assign: a purchaser can claim many items for themselves, but cannot give or take work they may not', async () => {
    const a = await makeEnquiry([0, 1]), b = await makeEnquiry([1, 2]);
    const mine = [a.itemIds[0], a.itemIds[1], b.itemIds[0], b.itemIds[1]];
    const claimed = await bulk(buyer2.token, mine, String(buyer2.user._id));
    assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
    assert.equal(claimed.data.assigned, 4);
    // nobody else can grab what is now taken
    const grab = await bulk(buyer.token, mine, String(buyer.user._id));
    assert.equal(grab.status, 409);
    // a purchaser cannot hand work to somebody else
    const c = await makeEnquiry([3]);
    assert.equal((await bulk(buyer.token, c.itemIds, String(buyer2.user._id))).status, 403);
    // a manager can move it
    assert.equal((await bulk(admin.token, mine, String(buyer.user._id))).data.assigned, 4);
});

test('bulk assign: items in closed enquiries and items already further along are skipped, and counted', async () => {
    const open = await makeEnquiry([0]), closed = await makeEnquiry([1]), moving = await makeEnquiry([2]);
    assert.equal((await t.api('PUT', `/enquiries/${closed.id}/unsuccessful`, { token: admin.token, body: { closeReason: 'lost' } })).status, 200);
    await t.db.EnquiryItem.updateOne({ _id: moving.itemIds[0] }, { status: 'vendor_quoted' });
    const res = await bulk(admin.token, [open.itemIds[0], ...closed.itemIds, ...moving.itemIds], String(buyer.user._id));
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data, { assigned: 1, skipped: 2, enquiries: 1 });
    assert.equal((await t.db.EnquiryItem.findById(moving.itemIds[0])).status, 'vendor_quoted', 'quoted work must not be reset');
    // nothing assignable at all is a clear refusal
    assert.equal((await bulk(admin.token, [...closed.itemIds, ...moving.itemIds], String(buyer.user._id))).status, 409);
});

test('bulk assign: bad input, people who cannot take work, turned-off people, and who may use it at all', async () => {
    const e = await makeEnquiry([0]);
    assert.equal((await bulk(admin.token, [], String(buyer.user._id))).status, 400);
    assert.equal((await bulk(admin.token, ['zzz'], String(buyer.user._id))).status, 400);
    assert.equal((await bulk(admin.token, e.itemIds, 'nope')).status, 400);
    assert.equal((await bulk(admin.token, Array(501).fill('64b7f0f0f0f0f0f0f0f0f0f0'), String(buyer.user._id))).status, 400);
    assert.equal((await bulk(admin.token, e.itemIds, String(seller.user._id))).status, 400, 'a sales role cannot be given purchase work');
    assert.equal((await t.api('POST', '/enquiries/assign-items', { token: admin.token, raw: '{"itemIds": 5, "sourcingUserId": null}' })).status, 400);
    await t.db.User.updateOne({ _id: buyer2.user._id }, { active: false });
    assert.equal((await bulk(admin.token, e.itemIds, String(buyer2.user._id))).status, 400, 'a turned-off person cannot be given work');
    await t.db.User.updateOne({ _id: buyer2.user._id }, { active: true });
    assert.equal((await bulk(seller.token, e.itemIds, String(buyer.user._id))).status, 403, 'sales entry has no assign rights');
    assert.equal((await t.api('POST', '/enquiries/assign-items', { body: { itemIds: e.itemIds, sourcingUserId: String(buyer.user._id) } })).status, 401);
});

test('customers: many can be given to one Key Account Manager (or taken off) in one request', async () => {
    const kam = await t.makePerson('kam1', t.roles['Key Accounts – Entry'], 'Kay Manager');
    const cs = await Promise.all(['A', 'B', 'C'].map(n => t.db.Customer.create({ name: `Bulk KAM ${n}` })));
    const ids = cs.map(c => String(c._id));
    const put = (token, body) => t.api('PUT', '/customers/assign-kam', { token, body });

    const ok = await put(admin.token, { customerIds: ids, assignedKAM: String(kam.user._id) });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.updated, 3);
    assert.ok((await t.db.Customer.find({ _id: { $in: ids } })).every(c => String(c.assignedKAM) === String(kam.user._id)));
    const log = await t.api('GET', '/audit?type=masters', { token: admin.token });
    assert.ok(log.data.events.some(e => e.action === 'customer.kam_assigned' && /Kay Manager/.test(e.summary)));

    // take them off again
    assert.equal((await put(admin.token, { customerIds: ids, assignedKAM: null })).data.updated, 3);
    assert.ok((await t.db.Customer.find({ _id: { $in: ids } })).every(c => !c.assignedKAM));

    // refusals: leaving the field out must not quietly clear everyone, someone who cannot look after customers, bad input, no right to edit
    assert.equal((await put(admin.token, { customerIds: ids })).status, 400);
    assert.equal((await put(admin.token, { customerIds: ids, assignedKAM: String(seller.user._id) })).status, 400);
    assert.equal((await put(admin.token, { customerIds: [], assignedKAM: null })).status, 400);
    assert.equal((await put(admin.token, { customerIds: ['zzz'], assignedKAM: null })).status, 400);
    assert.equal((await put(seller.token, { customerIds: ids, assignedKAM: String(kam.user._id) })).status, 403);
    assert.equal((await t.api('PUT', '/customers/assign-kam', { body: { customerIds: ids, assignedKAM: null } })).status, 401);
    // and "assign-kam" is never mistaken for a customer id
    assert.equal((await t.api('PUT', '/customers/assign-kam', { token: admin.token, body: {} })).status, 400);
});

test('bulk assign: two people claiming the same items at the same moment never both get them', async () => {
    const e = await makeEnquiry([0, 1, 2, 3]);
    const [a, b] = await Promise.all([
        bulk(buyer.token, e.itemIds, String(buyer.user._id)),
        bulk(buyer2.token, e.itemIds, String(buyer2.user._id)),
    ]);
    const won = [a, b].filter(r => r.status === 200).reduce((n, r) => n + r.data.assigned, 0);
    assert.equal(won, 4, `every item is claimed exactly once, got ${JSON.stringify([a.data, b.data])}`);
    const items = await t.db.EnquiryItem.find({ _id: { $in: e.itemIds } }).lean();
    assert.equal(items.filter(i => i.assignedTo).length, 4);
    const byBuyer = items.filter(i => String(i.assignedTo) === String(buyer.user._id)).length;
    const byBuyer2 = items.filter(i => String(i.assignedTo) === String(buyer2.user._id)).length;
    assert.equal(byBuyer + byBuyer2, 4);
    // the one that lost the whole race was told so clearly
    for (const r of [a, b]) assert.ok(r.status === 200 || (r.status === 409 && /already taken/.test(r.data.error)));
});
