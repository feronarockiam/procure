/**
 * Default vendor + price on a material ("rate contract"): who may set it, what is checked, and that enquiries for the
 * material are quoted at once and skip the purchase queue.
 * Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const start = require('./helpers');

let t, admin, salesEntry, salesMgr, buyEntry, buyMgr, customer, vendor, vendor2;
test.before(async () => {
    t = await start();
    admin = await t.makePerson('adm', t.roles['Admin'], 'Adm');
    salesEntry = await t.makePerson('se', t.roles['Sales Operations – Entry'], 'Sales Entry');
    salesMgr = await t.makePerson('sm', t.roles['Sales Operations – Manager'], 'Sales Mgr');
    buyEntry = await t.makePerson('pe', t.roles['Purchase Operations – Entry'], 'Buy Entry');
    buyMgr = await t.makePerson('pm', t.roles['Purchase Operations – Manager'], 'Buy Mgr');
    customer = await t.db.Customer.create({ name: 'Rate Contract Customer' });
    vendor = await t.db.Vendor.create({ name: 'Contract Cement Co' });
    vendor2 = await t.db.Vendor.create({ name: 'Spot Market Traders' });
});
test.after(async () => { await t.stop(); });

const material = (name, extra = {}) => t.db.Product.create({ materialName: name, uom: 'Bags', ...extra });
const setDefault = (who, productId, body) => t.api('PUT', `/products/${productId}/default-price`, { token: who.token, body });
const raise = (who, items) => t.api('POST', '/enquiries', { token: who.token, body: { customerId: String(customer._id), items } });
const isoDay = (offsetDays) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10); };

test('default price: Admin and Purchase Manager (who edit materials) can set it; others cannot', async () => {
    const m = await material('Permission Cement');
    for (const who of [salesEntry, salesMgr, buyEntry]) {
        assert.equal((await setDefault(who, m._id, { vendorId: String(vendor._id), price: 380 })).status, 403);
    }
    assert.equal((await t.api('PUT', `/products/${m._id}/default-price`, { body: { vendorId: String(vendor._id), price: 380 } })).status, 401);
    for (const who of [admin, buyMgr]) {
        const r = await setDefault(who, m._id, { vendorId: String(vendor._id), price: 380 });
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal(r.data.defaultPrice, 380);
        assert.equal(r.data.defaultVendorId.name, 'Contract Cement Co', 'the list shows the vendor by name');
    }
    // and it is in the activity log
    assert.ok(await t.db.AuditLog.exists({ action: 'material.default_price_set', entityId: m._id }));
});

test('default price: vendor, price, freight and end date are checked', async () => {
    const m = await material('Validated Cement');
    const ok = { vendorId: String(vendor._id), price: 100 };
    for (const [body, status] of [
        [{ price: 100 }, 400], [{ ...ok, vendorId: 'nope' }, 400], [{ ...ok, vendorId: '0123456789abcdef01234567' }, 404],
        [{ ...ok, price: 0 }, 400], [{ ...ok, price: -5 }, 400], [{ ...ok, price: 'abc' }, 400], [{ vendorId: ok.vendorId }, 400],
        [{ ...ok, freight: -1 }, 400], [{ ...ok, freight: 'x' }, 400],
        [{ ...ok, validUntil: isoDay(-1) }, 400], [{ ...ok, validUntil: 'next week' }, 400], [{ ...ok, validUntil: { $gt: '' } }, 400],
    ]) {
        const r = await setDefault(admin, m._id, body);
        assert.equal(r.status, status, `${JSON.stringify(body)} -> ${r.status} ${JSON.stringify(r.data)}`);
    }
    assert.equal((await setDefault(admin, '0123456789abcdef01234567', ok)).status, 404);
    assert.equal((await setDefault(admin, 'bad-id', ok)).status, 400);
    // freight empty = 0; today as the last day is fine
    const r = await setDefault(admin, m._id, { ...ok, freight: '', validUntil: isoDay(0) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.defaultFreight, 0);
});

test('default price: an enquiry for the material is quoted at once and skips the purchase queue', async () => {
    const m = await material('Auto Priced Cement', { brand: 'UltraTech' });
    await setDefault(buyMgr, m._id, { vendorId: String(vendor._id), price: 365.5, freight: 500 });
    const before = await t.db.Notification.countDocuments({ message: /available to claim/ });

    const r = await raise(salesEntry, [{ productId: String(m._id), quantity: 40 }]);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.autoPriced, 1);
    const item = r.data.items[0];
    assert.equal(item.status, 'vendor_quoted');
    assert.ok(!item.assignedTo, 'nobody in purchase has to pick it up');
    assert.ok(item.quotedAt);
    assert.equal(r.data.stage, 'updated');

    const quotes = await t.db.VendorQuotation.find({ enquiryItemId: item._id });
    assert.equal(quotes.length, 1);
    assert.equal(String(quotes[0].vendorId), String(vendor._id));
    assert.equal(quotes[0].vendorPrice, 365.5);
    assert.equal(quotes[0].freightPrice, 500);
    assert.ok(quotes[0].isDefaultPrice && quotes[0].isCheapest);
    assert.equal(String(quotes[0].enteredBy), String(salesEntry.user._id));
    // purchase is not told about an enquiry with nothing left for them
    assert.equal(await t.db.Notification.countDocuments({ message: /available to claim/ }), before);

    // sales goes straight on: selling price, then the quotation is sent
    const base = `/enquiries/${r.data._id}/items/${item._id}`;
    const priced = await t.api('PUT', `${base}/sales-price`, { token: salesEntry.token, body: { salesPrice: 420, selectedVendorQuoteId: String(quotes[0]._id) } });
    assert.equal(priced.status, 200, JSON.stringify(priced.data));
    assert.equal((await t.api('PUT', `${base}/complete`, { token: salesMgr.token })).status, 200);
});

test('default price: in a mixed enquiry only those materials are priced; the rest go to purchase as usual', async () => {
    const fixed = await material('Mixed Fixed Cement');
    const open = await material('Mixed Open Sand');
    await setDefault(admin, fixed._id, { vendorId: String(vendor._id), price: 300 });
    const before = await t.db.Notification.countDocuments({ message: /available to claim/ });

    const r = await raise(salesEntry, [{ productId: String(fixed._id), quantity: 10 }, { productId: String(open._id), quantity: 5 }]);
    assert.equal(r.status, 201);
    assert.equal(r.data.autoPriced, 1);
    const byName = Object.fromEntries(r.data.items.map(i => [i.productId.materialName, i]));
    assert.equal(byName['Mixed Fixed Cement'].status, 'vendor_quoted');
    assert.equal(byName['Mixed Open Sand'].status, 'unassigned');
    assert.ok(await t.db.Notification.countDocuments({ message: /available to claim/ }) > before, 'purchase hears about the open item');

    // purchase can still add a cheaper quote to the default-priced item, and it becomes the cheapest
    const itemId = String(byName['Mixed Fixed Cement']._id);
    const q = await t.api('POST', '/vendors/quotations', { token: buyEntry.token, body: { enquiryItemId: itemId, vendorId: String(vendor2._id), vendorPrice: 290 } });
    assert.equal(q.status, 201);
    const cheapest = await t.db.VendorQuotation.find({ enquiryItemId: itemId, isCheapest: true });
    assert.deepEqual(cheapest.map(c => String(c.vendorId)), [String(vendor2._id)]);
});

test('default price: an ended, removed or never-set default leaves the item for purchase', async () => {
    const ended = await material('Ended Contract Cement', { defaultVendorId: vendor._id, defaultPrice: 350, defaultPriceValidUntil: new Date(Date.now() - 3 * 86400000) });
    const removed = await material('Removed Contract Cement');
    await setDefault(admin, removed._id, { vendorId: String(vendor._id), price: 350 });
    const del = await t.api('DELETE', `/products/${removed._id}/default-price`, { token: admin.token });
    assert.equal(del.status, 200);
    assert.ok(await t.db.AuditLog.exists({ action: 'material.default_price_removed', entityId: removed._id }));
    const plain = await material('Never Contracted Cement');

    const r = await raise(salesEntry, [ended, removed, plain].map(m => ({ productId: String(m._id), quantity: 1 })));
    assert.equal(r.status, 201);
    assert.equal(r.data.autoPriced, 0);
    assert.ok(r.data.items.every(i => i.status === 'unassigned'));
    // removing it is refused to those who may not edit materials
    assert.equal((await t.api('DELETE', `/products/${plain._id}/default-price`, { token: salesEntry.token })).status, 403);
});

test('default price: Excel bulk upload prices those materials too', async () => {
    const m = await material('Bulk Contract Cement');
    await setDefault(admin, m._id, { vendorId: String(vendor._id), price: 333 });
    const r = await t.api('POST', '/enquiries/bulk/create', { token: salesMgr.token, body: { enquiries: [
        { customerId: String(customer._id), customerName: customer.name, items: [{ productId: String(m._id), quantity: 7 }] },
    ] } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.summary.successful, 1);
    assert.equal(r.data.summary.autoPriced, 1);
    const enquiry = await t.db.Enquiry.findOne({ enquiryNumber: r.data.created[0] });
    const item = await t.db.EnquiryItem.findOne({ enquiryId: enquiry._id });
    assert.equal(item.status, 'vendor_quoted');
});

test('default price: a vendor used as a default cannot be deleted until the default is changed', async () => {
    const lonely = await t.db.Vendor.create({ name: 'Default Only Vendor' });
    const m = await material('Guarded Cement');
    await setDefault(admin, m._id, { vendorId: String(lonely._id), price: 10 });
    const refused = await t.api('DELETE', `/vendors/${lonely._id}`, { token: admin.token });
    assert.equal(refused.status, 409);
    assert.match(refused.data.error, /Guarded Cement/);
    await t.api('DELETE', `/products/${m._id}/default-price`, { token: admin.token });
    assert.equal((await t.api('DELETE', `/vendors/${lonely._id}`, { token: admin.token })).status, 200);
});
