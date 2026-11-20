/**
 * "What needs me today": counts worked out on the server from the person's role and what they may see.
 * Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const start = require('./helpers');

let t, admin, seller, buyer, customer, products;
test.before(async () => {
    t = await start();
    admin = await t.makePerson('boss', t.roles['Admin'], 'Boss');
    seller = await t.makePerson('sell', t.roles['Sales Operations – Entry'], 'Sell Er');
    buyer = await t.makePerson('buy', t.roles['Purchase Operations – Entry'], 'Buy Er');
    customer = await t.db.Customer.create({ name: 'Todo Customer' });
    products = await Promise.all(['A', 'B', 'C'].map(n => t.db.Product.create({ materialName: `Todo ${n}`, uom: 'Pcs' })));
});
test.after(async () => { await t.stop(); });

const todo = async (who) => { const r = await t.api('GET', '/enquiries/todo', { token: who.token }); assert.equal(r.status, 200, JSON.stringify(r.data)); return Object.fromEntries(r.data.tasks.map(x => [x.key, x])); };
const newEnquiry = async (n) => (await t.api('POST', '/enquiries', { token: seller.token, body: { customerId: String(customer._id), items: products.slice(0, n).map(p => ({ productId: String(p._id), quantity: 1 })) } })).data;

test('todo: an empty system is "all clear", and nobody is told about work they cannot do', async () => {
    const r = await t.api('GET', '/enquiries/todo', { token: seller.token });
    assert.deepEqual(r.data, { applicable: true, tasks: [], allClear: true });
    assert.equal((await t.api('GET', '/enquiries/todo')).status, 401);
    const nobody = await t.makePerson('nope', await t.makeRole({ name: 'Customers Only 2', permissions: ['customer.view'] }), 'Nope');
    assert.deepEqual((await t.api('GET', '/enquiries/todo', { token: nobody.token })).data, { applicable: false, tasks: [], allClear: true });
});

test('todo: each role is told about its own next steps, with a place to click', async () => {
    const e = await newEnquiry(3);
    const ids = (await t.db.EnquiryItem.find({ enquiryId: e._id })).map(i => String(i._id));

    // new unassigned work: the manager is told to hand it out, the purchaser that they can pick it up, the seller nothing
    const adminT = await todo(admin), buyerT = await todo(buyer), sellerT = await todo(seller);
    assert.equal(adminT.assign.count, 3);
    assert.match(adminT.assign.href, /^\/sales\.html/);
    assert.equal(buyerT.pickup.count, 3);
    assert.match(buyerT.pickup.href, /^\/sourcing\.html/);
    assert.equal(sellerT.assign, undefined);
    assert.equal(sellerT.pickup, undefined);
    assert.equal(buyerT.assign, undefined, 'a purchaser cannot hand work out');

    // the purchaser claims two: those become "waiting for your price", the pick-up count drops
    assert.equal((await t.api('POST', '/enquiries/assign-items', { token: buyer.token, body: { itemIds: ids.slice(0, 2), sourcingUserId: String(buyer.user._id) } })).status, 200);
    const b2 = await todo(buyer);
    assert.equal(b2.quote.count, 2);
    assert.equal(b2.pickup.count, 1);

    // a vendor price comes in: the seller is told to set a selling price
    const vendor = await t.db.Vendor.create({ name: 'Todo Vendor' });
    assert.equal((await t.api('POST', '/vendors/quotations', { token: buyer.token, body: { enquiryItemId: ids[0], vendorId: String(vendor._id), vendorPrice: 10 } })).status, 201);
    assert.equal((await todo(seller)).price.count, 1);
    assert.equal((await todo(buyer)).quote.count, 1, 'the quoted item is no longer waiting for a price');

    // a question from purchase: the seller must reply, the purchaser is only waiting
    assert.equal((await t.api('PUT', `/enquiries/${e._id}/items/${ids[1]}/raise-query`, { token: buyer.token, body: { message: 'Which brand?' } })).status, 200);
    assert.equal((await todo(seller)).reply.count, 1);
    assert.equal((await todo(buyer))['waiting-sales'].count, 1);
});

test('todo: sellers only count their own enquiries, and "ready to send" needs every item priced', async () => {
    const mine = await newEnquiry(1);
    const other = await t.makePerson('sell2', t.roles['Sales Operations – Entry'], 'Other Seller');
    const theirs = (await t.api('POST', '/enquiries', { token: other.token, body: { customerId: String(customer._id), items: [{ productId: String(products[0]._id), quantity: 1 }] } })).data;
    await t.db.EnquiryItem.updateMany({ enquiryId: theirs._id }, { status: 'vendor_quoted' });
    assert.equal((await todo(seller)).price?.count ?? 0, 1, 'another seller\'s quoted item must not be counted (only the one from the earlier test)');
    assert.equal((await todo(other)).price.count, 1);

    const manager = await t.makePerson('mgr', t.roles['Sales Operations – Manager'], 'Sales Mgr');
    await t.db.EnquiryItem.updateMany({ enquiryId: mine._id }, { status: 'priced', salesPrice: 5 });
    assert.equal((await todo(manager)).send?.count ?? 0, 1, 'one enquiry has every item priced');
    await t.db.EnquiryItem.create({ enquiryId: mine._id, productId: products[1]._id, quantity: 1, status: 'assigned' });
    assert.equal((await todo(manager)).send?.count ?? 0, 0, 'an item still open means it is not ready');
});

test('todo: people who see everything are told about enquiries left open too long', async () => {
    const e = await newEnquiry(1);
    await t.db.Enquiry.collection.updateOne({ _id: new t.mongoose.Types.ObjectId(e._id) }, { $set: { createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) } }); // createdAt is write-protected in the model
    assert.ok((await todo(admin)).stalled.count >= 1);
    assert.equal((await todo(seller)).stalled, undefined);
});
