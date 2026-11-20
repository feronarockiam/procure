/**
 * Adding things "on the fly": a material that is not in the master yet while raising an enquiry, and a new vendor
 * while entering a vendor quote. Every edge case a person can hit from those two shortcuts.
 * Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const start = require('./helpers');

let t, admin, salesEntry, salesMgr, buyEntry, buyMgr, kam, customer;
test.before(async () => {
    t = await start();
    admin = await t.makePerson('adm', t.roles['Admin'], 'Adm');
    salesEntry = await t.makePerson('se', t.roles['Sales Operations – Entry'], 'Sales Entry');
    salesMgr = await t.makePerson('sm', t.roles['Sales Operations – Manager'], 'Sales Mgr');
    buyEntry = await t.makePerson('pe', t.roles['Purchase Operations – Entry'], 'Buy Entry');
    buyMgr = await t.makePerson('pm', t.roles['Purchase Operations – Manager'], 'Buy Mgr');
    kam = await t.makePerson('ka', t.roles['Key Accounts – Entry'], 'Kam');
    customer = await t.db.Customer.create({ name: 'Adhoc Customer' });
});
test.after(async () => { await t.stop(); });

const addProduct = (who, body) => t.api('POST', '/products', { token: who.token, body });
const addVendor = (who, body) => t.api('POST', '/vendors', { token: who.token, body });
const raise = (who, items) => t.api('POST', '/enquiries', { token: who.token, body: { customerId: String(customer._id), items } });

// ── New material while raising an enquiry ────────────────────────────────────

test('adhoc material: both sales roles (who raise enquiries) can add a material, and use it straight away', async () => {
    for (const [who, name] of [[salesEntry, 'Adhoc Valve SE'], [salesMgr, 'Adhoc Valve SM'], [admin, 'Adhoc Valve AD']]) {
        const created = await addProduct(who, { materialName: name, uom: 'Nos', brand: 'Generic', specification: 'As required' });
        assert.equal(created.status, 201, `${name}: ${JSON.stringify(created.data)}`);
        const enquiry = await raise(who, [{ productId: String(created.data._id), quantity: 3 }]);
        assert.equal(enquiry.status, 201, JSON.stringify(enquiry.data));
        assert.equal(enquiry.data.items.length, 1);
        assert.equal(enquiry.data.items[0].productId.materialName, name);
        assert.equal(enquiry.data.items[0].status, 'unassigned');
    }
    // and the new material shows in everyone's list
    const list = await t.api('GET', '/products', { token: buyEntry.token });
    assert.ok(list.data.some(p => p.materialName === 'Adhoc Valve SE'));
});

test('adhoc material: roles that may not add materials are refused, and nothing is created', async () => {
    for (const who of [buyEntry, kam]) {
        const r = await addProduct(who, { materialName: 'Should Not Exist', uom: 'Nos' });
        assert.equal(r.status, 403);
    }
    assert.equal(await t.db.Product.countDocuments({ materialName: 'Should Not Exist' }), 0);
    assert.equal((await addProduct({ token: undefined }, { materialName: 'Anon', uom: 'Nos' })).status, 401);
});

test('adhoc material: a name or unit that is missing, blank or not text is refused clearly', async () => {
    for (const body of [
        {}, { materialName: 'Only Name' }, { uom: 'Nos' },
        { materialName: '   ', uom: 'Nos' }, { materialName: 'X', uom: '  ' },
        { materialName: ['array'], uom: 'Nos' }, { materialName: { $ne: '' }, uom: 'Nos' },
    ]) {
        const r = await addProduct(salesEntry, body);
        assert.equal(r.status, 400, `${JSON.stringify(body)} -> ${r.status}`);
        assert.ok(r.data.error);
    }
    const huge = await addProduct(salesEntry, { materialName: 'x'.repeat(6000), uom: 'Nos' });
    assert.equal(huge.status, 400);
});

test('adhoc material: the same material again (any capitals or spacing) is not duplicated, and the existing one is handed back', async () => {
    const first = await addProduct(salesEntry, { materialName: 'Gate Valve 2 Inch', uom: 'Nos', brand: 'Kirloskar' });
    assert.equal(first.status, 201);
    for (const variant of ['gate valve 2 inch', '  Gate Valve 2 Inch  ', 'GATE   VALVE 2 INCH']) {
        const again = await addProduct(salesMgr, { materialName: variant, uom: 'nos', brand: 'kirloskar' });
        assert.equal(again.status, 409, variant);
        assert.equal(String(again.data.existing._id), String(first.data._id), 'the existing material comes back so the screen can pick it');
        assert.match(again.data.error, /already exists/);
    }
    assert.equal(await t.db.Product.countDocuments({ materialName: /^gate valve 2 inch$/i }), 1);
});

test('adhoc material: a different brand or unit of the same material is a different material', async () => {
    assert.equal((await addProduct(salesEntry, { materialName: 'Ball Valve', uom: 'Nos', brand: 'Audco' })).status, 201);
    assert.equal((await addProduct(salesEntry, { materialName: 'Ball Valve', uom: 'Nos', brand: 'L&T' })).status, 201);
    assert.equal((await addProduct(salesEntry, { materialName: 'Ball Valve', uom: 'Set', brand: 'Audco' })).status, 201);
    // no brand and "Generic" are the same thing
    assert.equal((await addProduct(salesEntry, { materialName: 'Plain Washer', uom: 'Kg' })).status, 201);
    const generic = await addProduct(salesEntry, { materialName: 'Plain Washer', uom: 'Kg', brand: 'Generic' });
    assert.equal(generic.status, 409);
    assert.ok(generic.data.existing);
});

test('adhoc material: names with symbols are stored as typed and never break the duplicate check', async () => {
    for (const name of ['Pipe 1/2" (GI) [Class-B]', 'Bolt M10*50 + Nut', 'Cable 4.0 sq.mm $special^', 'Tape | 3M? x2', 'Ãœber Kleber – 500g']) {
        const r = await addProduct(salesEntry, { materialName: name, uom: 'Nos' });
        assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.data)}`);
        assert.equal(r.data.materialName, name);
        assert.equal((await addProduct(salesEntry, { materialName: name, uom: 'Nos' })).status, 409, `${name} twice`);
    }
});

test('adhoc material: an enquiry mixing existing and just-added materials works, and bad lines are refused before anything is saved', async () => {
    const old = await t.db.Product.create({ materialName: 'Existing Flange', uom: 'Nos' });
    const fresh = (await addProduct(salesEntry, { materialName: 'Brand New Gasket', uom: 'Nos' })).data;
    const ok = await raise(salesEntry, [{ productId: String(old._id), quantity: 2 }, { productId: String(fresh._id), quantity: 0.5 }]);
    assert.equal(ok.status, 201);
    assert.equal(ok.data.items.length, 2);

    const before = await t.db.Enquiry.countDocuments();
    const ghost = '0123456789abcdef01234567';
    for (const items of [
        [], [{ productId: String(fresh._id), quantity: 0 }], [{ productId: String(fresh._id), quantity: -1 }],
        [{ productId: String(fresh._id), quantity: 'two' }], [{ productId: 'not-an-id', quantity: 1 }],
        [{ productId: String(fresh._id), quantity: 1 }, { productId: ghost, quantity: 1 }],
    ]) {
        const r = await raise(salesEntry, items);
        assert.equal(r.status, 400, `${JSON.stringify(items)} -> ${r.status}`);
    }
    assert.equal(await t.db.Enquiry.countDocuments(), before, 'a refused enquiry leaves nothing behind');
});

test('adhoc material: one deleted after it was picked (but before the enquiry was saved) is caught', async () => {
    const temp = (await addProduct(admin, { materialName: 'Short Lived Item', uom: 'Nos' })).data;
    await t.db.Product.deleteOne({ _id: temp._id });
    const r = await raise(salesEntry, [{ productId: String(temp._id), quantity: 1 }]);
    assert.equal(r.status, 400);
    assert.match(r.data.error, /no longer exist/);
});

// ── New vendor while entering a quote ───────────────────────────────────────

test('new vendor: purchase roles can add one with just a name, then quote with it at once', async () => {
    const product = (await addProduct(salesEntry, { materialName: 'Vendor Flow Pipe', uom: 'Mtr' })).data;
    const enquiry = (await raise(salesEntry, [{ productId: String(product._id), quantity: 10 }])).data;
    const itemId = String(enquiry.items[0]._id);

    for (const [who, name] of [[buyEntry, 'Fresh Vendor PE'], [buyMgr, 'Fresh Vendor PM']]) {
        const v = await addVendor(who, { name });
        assert.equal(v.status, 201, JSON.stringify(v.data));
        assert.equal(v.data.name, name);
        const q = await t.api('POST', '/vendors/quotations', { token: who.token, body: { enquiryItemId: itemId, vendorId: String(v.data._id), vendorPrice: 100, freightPrice: 5 } });
        assert.equal(q.status, 201, JSON.stringify(q.data));
        assert.equal(q.data.vendorId.name, name);
    }
    const item = await t.db.EnquiryItem.findById(itemId);
    assert.equal(item.status, 'vendor_quoted');
    // both quotes cost the same (105), so both are marked cheapest
    const quotes = await t.db.VendorQuotation.find({ enquiryItemId: itemId });
    assert.equal(quotes.length, 2);
    assert.ok(quotes.every(q => q.isCheapest));
});

test('new vendor: every optional detail is kept, and blank optional details are fine', async () => {
    const full = await addVendor(buyEntry, { name: 'Full Details Pvt Ltd', contactPerson: 'Ravi', phone: '+91 98765 43210', email: 'ravi@full.in', specialization: 'Pipes', address: 'Pune' });
    assert.equal(full.status, 201);
    for (const k of ['contactPerson', 'phone', 'email', 'specialization', 'address']) assert.ok(full.data[k], k);
    const sparse = await addVendor(buyEntry, { name: 'Sparse Vendor', contactPerson: '', phone: '', email: '' });
    assert.equal(sparse.status, 201, JSON.stringify(sparse.data));
});

test('new vendor: missing, blank or non-text names and bad emails are refused', async () => {
    for (const body of [{}, { name: '' }, { name: '    ' }, { name: ['x'] }, { name: { $gt: '' } }, { name: 42 }]) {
        const r = await addVendor(buyEntry, body);
        assert.equal(r.status, 400, `${JSON.stringify(body)} -> ${r.status}`);
    }
    for (const email of ['not-an-email', 'a@b', '@x.com', 'two words@x.com']) {
        const r = await addVendor(buyEntry, { name: `Email Test ${email}`, email });
        assert.equal(r.status, 400, email);
        assert.match(r.data.error, /email/i);
    }
    assert.equal(await t.db.Vendor.countDocuments({ name: /^Email Test/ }), 0);
});

test('new vendor: the same name again (any capitals or spacing) is not duplicated, and the existing one is handed back', async () => {
    const first = await addVendor(buyEntry, { name: 'Shree Ganesh Traders' });
    assert.equal(first.status, 201);
    for (const variant of ['shree ganesh traders', '  Shree Ganesh Traders ', 'SHREE  GANESH   TRADERS']) {
        const again = await addVendor(buyMgr, { name: variant });
        assert.equal(again.status, 409, variant);
        assert.equal(String(again.data.existing._id), String(first.data._id));
    }
    assert.equal(await t.db.Vendor.countDocuments({ name: /^shree ganesh traders$/i }), 1);
    // renaming another vendor onto that name is refused too
    const other = (await addVendor(buyEntry, { name: 'Other Traders' })).data;
    const clash = await t.api('PUT', `/vendors/${other._id}`, { token: buyMgr.token, body: { name: 'shree ganesh traders' } });
    assert.equal(clash.status, 409);
});

test('new vendor: names with symbols are stored as typed and never break the duplicate check', async () => {
    for (const name of ['A.B.C. (India) Pvt. Ltd.', 'M/s Patel & Sons', 'Star* Supplies [Pune]', 'Kumar+Kumar $Co', 'Vendor | ?']) {
        const r = await addVendor(buyEntry, { name });
        assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.data)}`);
        assert.equal((await addVendor(buyEntry, { name })).status, 409, `${name} twice`);
    }
    // "A.B.C." must not match "AxBxCx" (the dot is not a wildcard)
    assert.equal((await addVendor(buyEntry, { name: 'AxBxCx (India) Pvt. Ltd.' })).status, 201);
});

test('new vendor: sales and key-account roles cannot add vendors', async () => {
    for (const who of [salesEntry, salesMgr, kam]) {
        assert.equal((await addVendor(who, { name: `Nope ${who.user.name}` })).status, 403);
    }
    assert.equal(await t.db.Vendor.countDocuments({ name: /^Nope / }), 0);
});

test('new vendor: quotes need a real vendor, a real item and sensible prices', async () => {
    const product = (await addProduct(salesEntry, { materialName: 'Quote Edge Item', uom: 'Nos' })).data;
    const enquiry = (await raise(salesEntry, [{ productId: String(product._id), quantity: 1 }])).data;
    const itemId = String(enquiry.items[0]._id);
    const vendor = (await addVendor(buyEntry, { name: 'Quote Edge Vendor' })).data;
    const quote = (body) => t.api('POST', '/vendors/quotations', { token: buyEntry.token, body: { enquiryItemId: itemId, vendorId: String(vendor._id), ...body } });

    assert.equal((await quote({ vendorPrice: -1 })).status, 400);
    assert.equal((await quote({ vendorPrice: 'abc' })).status, 400);
    assert.equal((await quote({ vendorPrice: 10, freightPrice: -5 })).status, 400);
    assert.equal((await quote({ vendorPrice: 10, vendorId: '0123456789abcdef01234567' })).status, 404);
    assert.equal((await quote({ vendorPrice: 10, enquiryItemId: '0123456789abcdef01234567' })).status, 404);
    assert.equal((await quote({ vendorPrice: 10, vendorId: 'bad' })).status, 400);
    // freight left empty counts as 0; a price of 0 is allowed (free sample)
    const ok = await quote({ vendorPrice: 0, freightPrice: '' });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal(ok.data.freightPrice, 0);
    // sales cannot enter vendor prices
    assert.equal((await t.api('POST', '/vendors/quotations', { token: salesEntry.token, body: { enquiryItemId: itemId, vendorId: String(vendor._id), vendorPrice: 1 } })).status, 403);
});

test('new vendor: one with quotes on record cannot be deleted; an unused one can', async () => {
    const used = await t.db.Vendor.findOne({ name: 'Quote Edge Vendor' });
    assert.equal((await t.api('DELETE', `/vendors/${used._id}`, { token: admin.token })).status, 409);
    const unused = (await addVendor(buyEntry, { name: 'Never Used Vendor' })).data;
    assert.equal((await t.api('DELETE', `/vendors/${unused._id}`, { token: admin.token })).status, 200);
});

// ── The whole journey with things added on the fly ───────────────────────────

test('end to end: new material -> enquiry -> new vendor -> quote -> sales price -> quotation sent', async () => {
    const product = (await addProduct(salesEntry, { materialName: 'E2E Special Bearing', uom: 'Nos', brand: 'SKF' })).data;
    const enquiry = (await raise(salesEntry, [{ productId: String(product._id), quantity: 4 }])).data;
    const itemId = String(enquiry.items[0]._id);
    const base = `/enquiries/${enquiry._id}/items/${itemId}`;

    const vendor = (await addVendor(buyEntry, { name: 'E2E Bearing House' })).data;
    const cheap = (await t.api('POST', '/vendors/quotations', { token: buyEntry.token, body: { enquiryItemId: itemId, vendorId: String(vendor._id), vendorPrice: 250, freightPrice: 10 } })).data;
    const vendor2 = (await addVendor(buyMgr, { name: 'E2E Costly Bearings' })).data;
    await t.api('POST', '/vendors/quotations', { token: buyMgr.token, body: { enquiryItemId: itemId, vendorId: String(vendor2._id), vendorPrice: 400 } });
    const quotes = await t.db.VendorQuotation.find({ enquiryItemId: itemId });
    assert.deepEqual(quotes.filter(q => q.isCheapest).map(q => String(q._id)), [String(cheap._id)]);

    // marking it sent before it has a price is refused
    assert.equal((await t.api('PUT', `${base}/complete`, { token: salesMgr.token })).status, 400);
    const priced = await t.api('PUT', `${base}/sales-price`, { token: salesEntry.token, body: { salesPrice: 320, selectedVendorQuoteId: String(cheap._id) } });
    assert.equal(priced.status, 200, JSON.stringify(priced.data));
    assert.equal(priced.data.status, 'priced');

    // Sales Entry cannot mark it sent (no quotation.send); the manager can
    assert.equal((await t.api('PUT', `${base}/complete`, { token: salesEntry.token })).status, 403);
    const done = await t.api('PUT', `${base}/complete`, { token: salesMgr.token });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    const item = await t.db.EnquiryItem.findById(itemId);
    assert.equal(item.status, 'completed');
    assert.ok(item.quotedAt && item.pricedAt && item.completedAt);
    // a closed item takes no new quotes and no price change
    assert.equal((await t.api('POST', '/vendors/quotations', { token: buyEntry.token, body: { enquiryItemId: itemId, vendorId: String(vendor._id), vendorPrice: 1 } })).status, 409);
    assert.equal((await t.api('PUT', `${base}/sales-price`, { token: salesMgr.token, body: { salesPrice: 1 } })).status, 409);
});

test('end to end: one salesperson whose role also allows vendor prices does the whole job alone', async () => {
    const role = await t.makeRole({
        name: 'Sales All-Rounder', category: 'sales',
        permissions: ['enquiry.create', 'enquiry.view.own', 'enquiry.self_assign', 'customer.view', 'material.view', 'material.create',
            'vendor.view', 'vendor.create', 'purchase_price.add', 'sales_price.add', 'quotation.download', 'quotation.send'],
    });
    const ravi = await t.makePerson('allrounder', role, 'Ravi');
    const product = (await addProduct(ravi, { materialName: 'Solo Job Coupling', uom: 'Nos' })).data;
    const enquiry = (await raise(ravi, [{ productId: String(product._id), quantity: 8 }])).data;
    const itemId = String(enquiry.items[0]._id);
    const base = `/enquiries/${enquiry._id}/items/${itemId}`;

    // claims it for themselves, but cannot hand it to someone else
    assert.equal((await t.api('POST', `/enquiries/${enquiry._id}/assign-items`, { token: ravi.token, body: { itemIds: [itemId], sourcingUserId: String(buyEntry.user._id) } })).status, 403);
    assert.equal((await t.api('POST', `/enquiries/${enquiry._id}/assign-items`, { token: ravi.token, body: { itemIds: [itemId], sourcingUserId: String(ravi.user._id) } })).status, 200);

    const vendor = (await addVendor(ravi, { name: 'Solo Job Supplies' })).data;
    const quote = await t.api('POST', '/vendors/quotations', { token: ravi.token, body: { enquiryItemId: itemId, vendorId: String(vendor._id), vendorPrice: 90, freightPrice: 40 } });
    assert.equal(quote.status, 201, JSON.stringify(quote.data));
    assert.equal((await t.api('PUT', `${base}/sales-price`, { token: ravi.token, body: { salesPrice: 110, selectedVendorQuoteId: String(quote.data._id) } })).status, 200);
    assert.equal((await t.api('PUT', `${base}/complete`, { token: ravi.token })).status, 200);
    assert.equal((await t.db.EnquiryItem.findById(itemId)).status, 'completed');

    // and their screens: both Sales and Sourcing
    const me = await t.api('GET', '/auth/me', { token: ravi.token });
    assert.ok(me.data.user.links.includes('/sales.html') && me.data.user.links.includes('/sourcing.html'));
});
