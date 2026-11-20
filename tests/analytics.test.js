/**
 * Analytics: the figures are worked out on the server, so they are checked against numbers computed by hand.
 * Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const start = require('./helpers');

let t, admin, seller, buyer, ids;
const HOUR = 3600 * 1000, DAY = 24 * HOUR;

test.before(async () => {
    t = await start();
    admin = await t.makePerson('an-admin', t.roles['Admin'], 'Analyst');
    seller = await t.makePerson('an-sell', t.roles['Sales Operations – Entry'], 'Sally Seller');
    buyer = await t.makePerson('an-buy', t.roles['Purchase Operations – Entry'], 'Bob Buyer');
    const { Customer, Product, Vendor, Enquiry, EnquiryItem, VendorQuotation } = t.db;
    const [c1, c2] = await Promise.all([Customer.create({ name: 'Alpha Co' }), Customer.create({ name: 'Beta Co' })]);
    const [p1, p2] = await Promise.all([Product.create({ materialName: 'Cement', uom: 'Bag' }), Product.create({ materialName: 'Steel', uom: 'Kg' })]);
    const [v1, v2] = await Promise.all([Vendor.create({ name: 'Vendor One' }), Vendor.create({ name: 'Vendor Two' })]);
    const backdate = (model, id, createdAt) => model.collection.updateOne({ _id: id }, { $set: { createdAt } }); // createdAt is write-protected in the models

    const t1 = Date.now() - 3 * DAY, t2 = Date.now() - 2 * DAY;
    const e1 = await Enquiry.create({ enquiryNumber: 'AN-1', customerId: c1._id, createdBy: seller.user._id, status: 'completed' });
    const e2 = await Enquiry.create({ enquiryNumber: 'AN-2', customerId: c2._id, createdBy: seller.user._id, status: 'active' });
    const e3 = await Enquiry.create({ enquiryNumber: 'AN-3', customerId: c1._id, createdBy: seller.user._id, status: 'active', closeReason: 'too old to count' });
    await backdate(Enquiry, e1._id, new Date(t1)); await backdate(Enquiry, e2._id, new Date(t2)); await backdate(Enquiry, e3._id, new Date(Date.now() - 60 * DAY));
    const i1 = await EnquiryItem.create({ enquiryId: e1._id, productId: p1._id, quantity: 2, status: 'completed', salesPrice: 100, assignedTo: buyer.user._id,
        assignedAt: new Date(t1 + 2 * HOUR), quotedAt: new Date(t1 + 6 * HOUR), pricedAt: new Date(t1 + 8 * HOUR), completedAt: new Date(t1 + 10 * HOUR) });
    const i2 = await EnquiryItem.create({ enquiryId: e1._id, productId: p2._id, quantity: 1, status: 'unsuccessful' });
    const i3 = await EnquiryItem.create({ enquiryId: e2._id, productId: p1._id, quantity: 5, status: 'assigned', assignedTo: buyer.user._id, assignedAt: new Date(t2 + HOUR) });
    await EnquiryItem.create({ enquiryId: e3._id, productId: p1._id, quantity: 99, status: 'unassigned' });
    const q1 = await VendorQuotation.create({ enquiryItemId: i1._id, vendorId: v1._id, vendorPrice: 50, enteredBy: buyer.user._id });
    await VendorQuotation.create({ enquiryItemId: i1._id, vendorId: v2._id, vendorPrice: 60, enteredBy: buyer.user._id });
    await VendorQuotation.create({ enquiryItemId: i3._id, vendorId: v1._id, vendorPrice: 55, enteredBy: buyer.user._id });
    await EnquiryItem.updateOne({ _id: i1._id }, { selectedVendorQuoteId: q1._id });
    ids = { c1, c2, p1, v1, v2 };
});
test.after(async () => { await t.stop(); });

const report = async (query = '', who = admin) => { const r = await t.api('GET', `/analytics${query}`, { token: who.token }); return r; };

test('analytics: totals, win rate and value match the hand-computed numbers (old enquiries are left out of the period)', async () => {
    const r = await report();
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const x = r.data.totals;
    assert.equal(x.enquiries, 2);
    assert.equal(x.items, 3);
    assert.equal(x.openEnquiries, 1);
    assert.equal(x.completedItems, 1);
    assert.equal(x.lostItems, 1);
    assert.equal(x.wonValue, 200);         // 100 x 2
    assert.equal(x.quotedValue, 200);
    assert.equal(x.avgDealValue, 200);
    assert.equal(x.winRate, 50);           // 1 won of 2 decided
    assert.equal(r.data.range.days, 30);
});

test('analytics: the funnel counts what each item reached (an item closed from the waiting list was never assigned)', async () => {
    const funnel = Object.fromEntries((await report()).data.funnel.map(f => [f.key, f.count]));
    assert.deepEqual(funnel, { raised: 3, assigned: 2, quoted: 1, priced: 1, completed: 1 });
});

test('analytics: turnaround times come from the milestone stamps, and say how many items they rest on', async () => {
    const x = (await report()).data.turnaround;
    assert.deepEqual([x.toAssign.n, x.toAssign.avgHours], [2, 1.5]);   // 2h and 1h
    assert.deepEqual([x.toQuote.n, x.toQuote.avgHours], [1, 4]);
    assert.deepEqual([x.toPrice.n, x.toPrice.avgHours], [1, 2]);
    assert.deepEqual([x.toSend.n, x.toSend.avgHours], [1, 2]);
    assert.deepEqual([x.endToEnd.n, x.endToEnd.avgHours], [1, 10]);
});

test('analytics: people, customers, materials and vendors are ranked with the right figures', async () => {
    const d = (await report()).data;
    assert.deepEqual(d.purchasePeople.map(p => [p.name, p.assigned, p.quoted, p.avgHoursToQuote]), [['Bob Buyer', 2, 1, 4]]);
    assert.deepEqual(d.salesPeople.map(p => [p.name, p.enquiries, p.items, p.priced, p.value]), [['Sally Seller', 2, 3, 1, 200]]);
    assert.deepEqual(d.customers.map(c => [c.name, c.enquiries, c.value]).sort(), [['Alpha Co', 1, 200], ['Beta Co', 1, 0]]);
    assert.deepEqual(d.materials[0], { id: String(ids.p1._id), name: 'Cement', unit: 'Bag', requests: 2, quantity: 7 });
    const v = Object.fromEntries(d.vendors.map(x => [x.name, [x.quotes, x.won, x.winRate]]));
    assert.deepEqual(v, { 'Vendor One': [2, 1, 50], 'Vendor Two': [1, 0, 0] });
});

test('analytics: the daily series covers every day in the period and adds up to the totals', async () => {
    const d = (await report()).data;
    assert.equal(d.series.length, 30);
    assert.equal(d.series.reduce((n, day) => n + day.enquiries, 0), 2);
    assert.equal(d.series.reduce((n, day) => n + day.items, 0), 3);
    assert.equal(d.series.reduce((n, day) => n + day.quotedValue, 0), 200);
    // a wider period brings in the old enquiry
    const wide = (await report(`?from=${new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10)}`)).data;
    assert.equal(wide.totals.enquiries, 3);
    assert.ok(wide.closeReasons.some(r => r.reason === 'too old to count'));
});

test('analytics: an empty period is zeros, not an error; bad dates and huge periods are refused politely', async () => {
    const empty = await report('?from=2000-01-01&to=2000-01-31');
    assert.equal(empty.status, 200);
    assert.equal(empty.data.totals.enquiries, 0);
    assert.equal(empty.data.totals.winRate, null);
    assert.equal(empty.data.series.length, 31);
    assert.equal((await report('?from=banana')).status, 400);
    assert.equal((await report('?from=2026-02-01&to=2026-01-01')).status, 400);
    assert.equal((await report('?from=2020-01-01&to=2026-01-01')).status, 400);
    assert.equal((await report('?from[$ne]=1')).status, 200, 'an operator in the query is just ignored');
});

test('analytics: only people whose role includes reports can open them', async () => {
    assert.equal((await report('', seller)).status, 403);
    assert.equal((await report('', buyer)).status, 403);
    assert.equal((await t.api('GET', '/analytics')).status, 401);
});
