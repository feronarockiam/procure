/**
 * Roles & access: the catalogue, the rules built on it, and how the app behaves for custom roles.
 * Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const start = require('./helpers');
const P = require('../constants/permissions');

// ── The catalogue and its rules (no database needed) ─────────────────────────

test('catalogue: every permission is either in the editor or deliberately hidden', () => {
    const cat = P.buildCatalogue();
    const shown = cat.sections.flatMap(s => s.items ? s.items.map(i => i.key) : s.rows.flatMap(r => Object.values(r.keys)));
    for (const key of P.ALL_PERMISSIONS) {
        assert.ok(shown.includes(key) || cat.hiddenKeys.includes(key), `${key} is not in the editor, so an admin could never grant it`);
    }
    for (const key of shown) assert.ok(P.ALL_PERMISSIONS.includes(key), `${key} is shown but is not a real permission`);
    assert.equal(new Set(shown).size, shown.length, 'a permission appears twice in the editor');
});

test('catalogue: every permission the routes enforce is a real permission', () => {
    const routesDir = path.join(__dirname, '..', 'routes');
    const used = new Set();
    for (const file of fs.readdirSync(routesDir)) {
        const text = fs.readFileSync(path.join(routesDir, file), 'utf8');
        for (const m of text.matchAll(/require(?:Any)?Permission\(([^)]*)\)/g)) {
            for (const k of m[1].matchAll(/'([a-z_.]+)'/g)) used.add(k[1]);
        }
        for (const m of text.matchAll(/perms\.includes\('([a-z_.]+)'\)/g)) used.add(m[1]);
    }
    assert.ok(used.size > 20, 'the scan should have found the route guards');
    for (const key of used) assert.ok(P.ALL_PERMISSIONS.includes(key), `routes use "${key}", which does not exist`);
});

test('catalogue: nothing offered in the editor is a dead switch', () => {
    // A permission an admin can tick must DO something: the server enforces it, or a screen reads it.
    const root = path.join(__dirname, '..');
    const code = ['routes', 'public/js'].flatMap(dir =>
        fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(root, dir, f), 'utf8'))
    ).join('\n')
      // screens and menu links that open because of a permission count as using it, as do the dependency rules
      + P.PAGES.map(p => p.needsAny.join(' ')).join(' ') + P.NAV_LINKS.map(l => l.needsAny.join(' ')).join(' ')
      + Object.values(P.ITEMS).flatMap(i => [...(i.needs || []), i.needsView]).filter(Boolean).join(' ');
    const cat = P.buildCatalogue();
    const offered = cat.sections.flatMap(s => s.items ? s.items.map(i => i.key) : s.rows.flatMap(r => Object.values(r.keys)));
    for (const key of offered) assert.ok(code.includes(key), `"${key}" is offered but nothing in the app uses it`);
});

test('rules: the built-in roles are already complete and each has somewhere to start', () => {
    for (const role of P.DEFAULT_ROLES) {
        const n = P.normalizePermissions(role.permissions);
        assert.deepEqual(n.added, [], `${role.name} would have needed: ${n.added.map(a => a.key)}`);
        assert.equal(n.unknown.length, 0);
        assert.ok(P.effectiveLanding(role), `${role.name} cannot open any screen`);
        assert.equal(typeof role.leadsTeam, 'boolean');
    }
});

test('rules: choosing a permission switches on what it cannot work without, and never removes anything', () => {
    const create = P.normalizePermissions(['enquiry.create']);
    assert.deepEqual(create.permissions.sort(), ['customer.view', 'enquiry.create', 'enquiry.view.own', 'material.view']);
    assert.equal(P.explainAdded(create.added).length, 3);
    assert.match(P.explainAdded(create.added)[0], /We also turned on ".+" because "Create new enquiries" needs it\./);

    assert.ok(P.normalizePermissions(['customer.delete']).permissions.includes('customer.view'));
    assert.ok(P.normalizePermissions(['enquiry.bulk_create']).permissions.includes('enquiry.create'));
    const buy = P.normalizePermissions(['purchase_price.add']).permissions;
    assert.ok(buy.includes('vendor.view') && buy.includes('enquiry.view.assigned'), 'a vendor-price role needs the vendor list and a work queue');
    assert.ok(P.normalizePermissions(['dashboard.admin']).permissions.includes('enquiry.view.all'));
    assert.ok(P.normalizePermissions(['enquiry.assign']).permissions.includes('enquiry.view.all'));

    // an existing choice of "see" is respected: no extra view is bolted on
    const own = P.normalizePermissions(['enquiry.create', 'enquiry.view.all']).permissions;
    assert.ok(!own.includes('enquiry.view.own'));
    // hidden, unused permissions on old roles are preserved rather than dropped
    assert.ok(P.normalizePermissions(['sales_price.approve', 'enquiry.view.own']).permissions.includes('sales_price.approve'));
    // unknown keys are reported, not kept
    assert.deepEqual(P.normalizePermissions(['made.up']).unknown, ['made.up']);
});

test('rules: where someone starts is always a screen they can open', () => {
    const base = { category: 'sales', permissions: ['enquiry.view.own', 'enquiry.create', 'customer.view', 'material.view'] };
    assert.equal(P.effectiveLanding({ ...base, dashboardPage: 'sales.html' }), 'sales.html');
    assert.equal(P.effectiveLanding({ ...base, dashboardPage: 'admin.html' }), 'sales.html', 'a screen they cannot open is replaced');
    assert.equal(P.effectiveLanding({ category: 'purchase', permissions: ['enquiry.view.own'], dashboardPage: 'sourcing.html' }), 'sales.html', 'the team page needs to be openable too');
    assert.equal(P.effectiveLanding({ category: 'sales', permissions: ['customer.view'], dashboardPage: 'sales.html' }), 'masters.html?type=customers', 'a role that only manages a list starts on that list');
    assert.equal(P.effectiveLanding({ category: 'sales', permissions: [], dashboardPage: 'sales.html' }), null, 'no screen at all');
    assert.deepEqual(P.allowedPages(['dashboard.admin']).map(p => p.file), ['admin.html']);
});

test('rules: team leads follow the setting, and older roles follow their name', () => {
    assert.equal(P.roleLeadsTeam({ name: 'Regional Sales Lead', leadsTeam: true }), true);
    assert.equal(P.roleLeadsTeam({ name: 'Sales Manager', leadsTeam: false }), false, 'the setting wins over the name');
    assert.equal(P.roleLeadsTeam({ name: 'Purchase Operations – Manager' }), true, 'roles made before the setting existed');
    assert.equal(P.roleLeadsTeam({ name: 'Regional Sales Lead' }), false);
});

test('rules: a role is described in plain words, and menus only list what the role can open', () => {
    const entry = P.describeRole(P.DEFAULT_ROLES.find(r => r.name === 'Sales Operations – Entry').permissions);
    assert.deepEqual(entry.sees, ['the enquiries they created']);
    assert.ok(entry.can.includes('create enquiries') && entry.can.includes('set selling prices'));
    assert.deepEqual(entry.manages.find(m => m.label === 'Customers').verbs, ['see', 'add']);
    assert.match(entry.lines.map(l => `${l.title}: ${l.text}`).join(' | '), /Sees: the enquiries they created \| Can: create enquiries/);
    assert.match(P.describeRole([]).lines[0].text, /Nothing yet/);

    const links = P.allowedLinks(P.DEFAULT_ROLES.find(r => r.name === 'Sales Operations – Entry').permissions);
    assert.ok(links.includes('/sales.html') && links.includes('/masters.html?type=customers'));
    assert.ok(!links.includes('/role-management.html') && !links.includes('/masters.html?type=employees') && !links.includes('/sourcing.html'));
    assert.equal(P.allowedLinks(P.ALL_PERMISSIONS).length, P.NAV_LINKS.length);
    assert.ok(P.roleWarnings([]).some(w => /cannot do anything/.test(w.text)));
    assert.ok(P.roleWarnings(['role.edit']).some(w => /change what other people/.test(w.text)));
});

// ── The app, with custom roles ───────────────────────────────────────────────

let t;
const people = {};
let customer, product, vendor;

test.before(async () => {
    t = await start();
    const { roles, makePerson, db } = t;
    people.admin = await makePerson('admin', roles['Admin'], 'Admin');
    people.salesEntry = await makePerson('salesEntry', roles['Sales Operations – Entry'], 'Sara Sales');
    people.purchMgr = await makePerson('purchMgr', roles['Purchase Operations – Manager'], 'Pia Purchase');
    people.purchEntry = await makePerson('purchEntry', roles['Purchase Operations – Entry'], 'Pat Purchase');
    customer = await db.Customer.create({ name: 'Acme' });
    product = await db.Product.create({ materialName: 'Cement', uom: 'Bags' });
    vendor = await db.Vendor.create({ name: 'Steel Co' });
});
test.after(async () => { if (t) await t.stop(); });

const newEnquiry = (token) => t.api('POST', '/enquiries', { token, body: { customerId: String(customer._id), items: [{ productId: String(product._id), quantity: 2 }] } });

test('visibility adds up: seeing your own enquiries and the waiting list together', async () => {
    const role = await t.makeRole({
        name: 'Sales + Purchase – Entry',
        permissions: P.normalizePermissions(['enquiry.create', 'enquiry.self_assign', 'purchase_price.add', 'sales_price.add', 'quotation.send', 'quotation.download']).permissions,
    });
    const me = await t.makePerson('combo', role, 'Cleo Combo');

    const mine = (await newEnquiry(me.token)).data;                       // created by Cleo
    const theirs = (await newEnquiry(people.salesEntry.token)).data;      // created by Sara, still unclaimed
    // Pat (purchase) claims every item of Cleo's own enquiry, so nobody is waiting on it any more
    await t.api('POST', `/enquiries/${mine._id}/assign-items`, { token: people.purchEntry.token, body: { itemIds: mine.items.map(i => i._id), sourcingUserId: String(people.purchEntry.user._id) } });

    const list = (await t.api('GET', '/enquiries', { token: me.token })).data.map(e => e._id);
    assert.ok(list.includes(mine._id), 'their own enquiry must stay visible even though purchase has taken every item');
    assert.ok(list.includes(theirs._id), 'and so must the waiting list');
    // a person with only the purchase permissions still does not see other people's already-assigned enquiries
    const patList = (await t.api('GET', '/enquiries', { token: people.purchEntry.token })).data.map(e => e._id);
    assert.ok(patList.includes(mine._id), 'Pat has items on it');
    assert.equal((await t.api('GET', `/enquiries/${mine._id}`, { token: people.salesEntry.token })).status, 404, "Sara only sees her own enquiries");
});

test('a person with a combined Sales + Purchase role can do the whole job alone', async () => {
    const { api, roles, db } = t;
    // an administrator builds the role through the API exactly as the editor would
    const preview = await api('POST', '/roles/preview', {
        token: people.admin.token,
        body: { category: 'sales', permissions: ['enquiry.create', 'enquiry.self_assign', 'purchase_price.add', 'sales_price.add', 'quotation.send', 'quotation.download'] },
    });
    assert.equal(preview.status, 200);
    assert.ok(preview.data.permissions.includes('customer.view'), 'preview shows what gets switched on');
    assert.ok(preview.data.notices.length >= 3);
    assert.deepEqual(preview.data.pages.map(p => p.file), ['sales.html', 'sourcing.html'], 'they may start on either screen');

    const created = await api('POST', '/roles', {
        token: people.admin.token,
        body: { name: 'All-rounder', description: 'Raises the enquiry, gets the vendor price, quotes the customer.', category: 'sales', color: '#8B5CF6', permissions: preview.data.permissions, dashboardPage: 'auto' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.landingPage, 'sales.html');
    const person = await api('POST', '/users', { token: people.admin.token, body: { name: 'Alex All', email: 'alex@test.com', password: 'secret1', roleId: created.data._id } });
    assert.equal(person.status, 201);

    const session = await t.login('alex@test.com', 'secret1');
    assert.equal(session.status, 200);
    const alex = session.data.token;
    assert.equal(session.data.user.landingPage, 'sales.html');
    assert.ok(session.data.user.links.includes('/sourcing.html') && session.data.user.links.includes('/sales.html'));
    assert.ok(!session.data.user.links.includes('/role-management.html'));

    const enquiry = (await newEnquiry(alex)).data;
    const item = enquiry.items[0];
    // claim → vendor price → selling price → mark sent
    assert.equal((await api('POST', `/enquiries/${enquiry._id}/assign-items`, { token: alex, body: { itemIds: [item._id], sourcingUserId: String(person.data._id) } })).status, 200);
    const quote = await api('POST', '/vendors/quotations', { token: alex, body: { enquiryItemId: item._id, vendorId: String(vendor._id), vendorPrice: 100, freightPrice: 10 } });
    assert.equal(quote.status, 201);
    const priced = await api('PUT', `/enquiries/${enquiry._id}/items/${item._id}/sales-price`, { token: alex, body: { salesPrice: 150, selectedVendorQuoteId: quote.data._id } });
    assert.equal(priced.status, 200);
    assert.equal((await api('PUT', `/enquiries/${enquiry._id}/items/${item._id}/complete`, { token: alex })).status, 200);
    assert.equal((await db.Enquiry.findById(enquiry._id)).status, 'completed');

    // and nothing beyond what the role says
    assert.equal((await api('GET', '/users', { token: alex })).status, 403);
    assert.equal((await api('GET', '/roles', { token: alex })).status, 403);
    assert.equal((await api('POST', '/products', { token: alex, body: { materialName: 'X', uom: 'Kg' } })).status, 403);
});

test('who can take purchase work, and who can look after customers, depends on what the role allows', async () => {
    const { api, makeRole, makePerson } = t;
    // a role in the SALES team that can enter vendor prices: assignable work
    const analyst = await makeRole({ name: 'Procurement Analyst', category: 'sales', permissions: P.normalizePermissions(['purchase_price.add']).permissions });
    const analystPerson = await makePerson('analyst', analyst, 'Anna Analyst');
    // a role in the PURCHASE team that cannot enter vendor prices: not assignable
    const viewer = await makeRole({ name: 'Purchase Observer', category: 'purchase', dashboardPage: 'sourcing.html', permissions: ['enquiry.view.assigned', 'material.view'] });
    const viewerPerson = await makePerson('observer', viewer, 'Omar Observer');

    const enquiry = (await newEnquiry(people.salesEntry.token)).data;
    const assign = (userId) => api('PUT', `/enquiries/${enquiry._id}/assign`, { token: people.purchMgr.token, body: { sourcingUserId: String(userId) } });
    const refused = await assign(viewerPerson.user._id);
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /can't enter vendor prices|can't be given purchase work/);
    assert.equal((await assign(analystPerson.user._id)).status, 200);

    const sourcing = (await api('GET', '/users/sourcing', { token: people.salesEntry.token })).data.map(u => u.name);
    assert.ok(sourcing.includes('Anna Analyst') && sourcing.includes('Pat Purchase') && !sourcing.includes('Omar Observer'));

    // customers: a key account manager is anyone whose role can see "their customers' enquiries"
    const lead = await makeRole({ name: 'Account Lead', category: 'sales', permissions: P.normalizePermissions(['enquiry.view.assigned_customers']).permissions });
    const leadPerson = await makePerson('accountlead', lead, 'Lena Lead');
    const made = await api('POST', '/customers', { token: people.admin.token, body: { name: 'Looked-after Ltd', assignedKAM: String(leadPerson.user._id) } });
    assert.equal(made.status, 201);
    const byPermission = (await api('GET', '/users/by-permission?permission=enquiry.view.assigned_customers', { token: people.admin.token })).data.map(u => u.name);
    assert.ok(byPermission.includes('Lena Lead') && !byPermission.includes('Sara Sales'));
    assert.equal((await api('GET', '/users/by-permission', { token: people.admin.token })).status, 400);
    // and they see exactly the customers they look after
    const seen = (await api('GET', '/enquiries', { token: leadPerson.token })).data;
    assert.equal(seen.length, 0);
    const forLena = (await api('POST', '/enquiries', { token: people.admin.token, body: { customerId: String(made.data._id), items: [{ productId: String(product._id), quantity: 1 }] } })).data;
    assert.deepEqual((await api('GET', '/enquiries', { token: leadPerson.token })).data.map(e => e._id), [forLena._id]);
});

test('team leads: a custom role can lead a team, and changing that is handled safely', async () => {
    const { api, makeRole, makePerson, db } = t;
    const leadRole = await makeRole({ name: 'Regional Sales Lead', category: 'sales', leadsTeam: true, permissions: P.normalizePermissions(['enquiry.create']).permissions });
    const lead = await makePerson('regionlead', leadRole, 'Rita Region');
    const member = await makePerson('rep', t.roles['Sales Operations – Entry'], 'Rob Rep');

    // appears among team leads, not among the people who can be put on a team
    const leads = (await api('GET', '/users/managers?category=sales', { token: people.admin.token })).data.map(u => u.name);
    const members = (await api('GET', '/users/entries?category=sales', { token: people.admin.token })).data.map(u => u.name);
    assert.ok(leads.includes('Rita Region') && !members.includes('Rita Region'));
    assert.ok(members.includes('Rob Rep') && !leads.includes('Rob Rep'));

    assert.equal((await api('PUT', `/users/${member.user._id}`, { token: people.admin.token, body: { supervisorId: String(lead.user._id) } })).status, 200);
    // someone whose role doesn't lead a team can't be named as a team lead
    const bad = await api('PUT', `/users/${member.user._id}`, { token: people.admin.token, body: { supervisorId: String(people.salesEntry.user._id) } });
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /isn't set up to lead a team/);

    // an older role (setting never chosen) leads a team if it is called "Manager"
    const legacy = await db.Role.create({ name: 'Old Style Manager', category: 'sales', dashboardPage: 'sales.html', permissions: ['enquiry.view.own'] });
    const legacyPerson = await makePerson('oldmgr', legacy, 'Olly Old');
    assert.equal((await api('PUT', `/users/${member.user._id}`, { token: people.admin.token, body: { supervisorId: String(legacyPerson.user._id) } })).status, 200);
    assert.equal((await api('PUT', `/users/${member.user._id}`, { token: people.admin.token, body: { supervisorId: String(lead.user._id) } })).status, 200);

    // switching "leads a team" off tidies the people who reported to them, and says so
    const off = await api('PUT', `/roles/${leadRole._id}`, { token: people.admin.token, body: { leadsTeam: false } });
    assert.equal(off.status, 200);
    assert.equal(off.data.leadsTeam, false);
    assert.match(off.data.notices.join(' '), /1 person no longer reports/);
    assert.equal((await db.User.findById(member.user._id)).supervisorId, null);
});

test('roles API: the list, members and employee-form list tell the story in plain words', async () => {
    const { api, makeRole, makePerson } = t;
    const list = await api('GET', '/roles', { token: people.admin.token });
    assert.equal(list.status, 200);
    const sales = list.data.find(r => r.name === 'Sales Operations – Entry');
    assert.equal(sales.userCount >= 1, true);
    assert.equal(sales.landingPage, 'sales.html');
    assert.equal(sales.leadsTeam, false);
    assert.ok(sales.summary.lines.some(l => l.title === 'Sees'));
    assert.equal(list.data.find(r => r.name === 'Sales Operations – Manager').leadsTeam, true);

    const members = await api('GET', `/roles/${sales._id}/members`, { token: people.admin.token });
    assert.ok(members.data.some(m => m.name === 'Sara Sales'));
    assert.equal((await api('GET', '/roles/bad/members', { token: people.admin.token })).status, 400);

    // someone who may add employees but not manage roles still gets the role choices (a lighter list)
    const hrRole = await makeRole({
        name: 'Front Desk', category: 'sales', permissions: ['user.view', 'user.create', ...t.roles['Key Accounts – Entry'].permissions],
    });
    const hr = await makePerson('frontdesk', hrRole, 'Fay Front');
    assert.equal((await api('GET', '/roles', { token: hr.token })).status, 403);
    const assignable = await api('GET', '/roles/assignable', { token: hr.token });
    assert.equal(assignable.status, 200);
    const byName = Object.fromEntries(assignable.data.map(r => [r.name, r]));
    assert.equal(byName['Key Accounts – Entry'].assignable, true);
    assert.equal(byName['Admin'].assignable, false, "a role with more access than they have can't be handed out");
    assert.match(byName['Admin'].notAssignableReason, /You can't give access you don't have yourself/);
    assert.equal(byName['Admin'].permissions, undefined, 'the light list does not expose the raw permission list');
    assert.equal((await api('GET', '/roles/assignable', { token: people.salesEntry.token })).status, 403);
});

test('roles API: friendly, specific errors and automatic starting screen', async () => {
    const { api } = t;
    const make = (body) => api('POST', '/roles', { token: people.admin.token, body: { name: 'Checker', category: 'sales', permissions: ['enquiry.view.own'], ...body } });

    const noName = await make({ name: '  ' });
    assert.equal(noName.status, 400);
    assert.match(noName.data.error, /Give the role a name/);
    assert.match((await make({ category: 'wizards' })).data.error, /Choose which team/);
    assert.match((await make({ name: 'x'.repeat(61) })).data.error, /too long/);
    assert.match((await make({ permissions: ['made.up'] })).data.error, /not recognised/);

    // a starting screen the role can't open is refused, in words
    const wrongPage = await make({ dashboardPage: 'key-accounts.html' });
    assert.equal(wrongPage.status, 400);
    assert.match(wrongPage.data.error, /can't open "Key Accounts" yet/);
    assert.match((await make({ dashboardPage: 'https://evil.example' })).data.error, /not a screen/);

    // left out or "auto": chosen for them
    const auto = await make({ name: 'Auto Role' });
    assert.equal(auto.status, 201);
    assert.equal(auto.data.dashboardPage, 'sales.html');
    // a role with nothing in it is allowed, with a warning and nowhere to start
    const empty = await make({ name: 'Empty Role', permissions: [] });
    assert.equal(empty.status, 201);
    assert.equal(empty.data.landingPage, null);
    assert.ok(empty.data.warnings.some(w => /cannot do anything/.test(w.text)));
    // choices that need others get them, and the response says so
    const needy = await make({ name: 'Needy Role', permissions: ['enquiry.create'] });
    assert.ok(needy.data.permissions.includes('customer.view'));
    assert.ok(needy.data.notices.length === 3);
    // changing permissions re-picks a starting screen that no longer fits
    const moved = await api('PUT', `/roles/${auto.data._id}`, { token: people.admin.token, body: { permissions: ['enquiry.view.assigned_customers'] } });
    assert.equal(moved.data.dashboardPage, 'key-accounts.html');
    assert.equal((await make({ name: 'Auto Role' })).status, 409);
});

test('nobody can hand out access they do not have', async () => {
    const { api, makeRole, makePerson } = t;
    const delegateRole = await makeRole({
        name: 'Delegate', category: 'sales',
        permissions: P.normalizePermissions(['enquiry.create', 'role.view', 'role.create', 'role.edit', 'user.view', 'user.create', 'user.edit']).permissions,
    });
    const delegate = await makePerson('delegate', delegateRole, 'Dee Delegate');

    // creating a role: a subset of what they hold is fine, anything more is not
    const fine = await api('POST', '/roles', { token: delegate.token, body: { name: 'Small Role', category: 'sales', permissions: ['enquiry.create'] } });
    assert.equal(fine.status, 201);
    const tooMuch = await api('POST', '/roles', { token: delegate.token, body: { name: 'Big Role', category: 'sales', permissions: ['enquiry.create', 'customer.delete', 'user.delete'] } });
    assert.equal(tooMuch.status, 403);
    assert.match(tooMuch.data.error, /You can't give access you don't have yourself: "Delete from Customers"/);
    // editing a role to add something they don't hold
    assert.equal((await api('PUT', `/roles/${fine.data._id}`, { token: delegate.token, body: { permissions: ['enquiry.create', 'vendor.delete'] } })).status, 403);

    // giving a person a role with more access
    const toAdmin = await api('POST', '/users', { token: delegate.token, body: { name: 'Sneaky', email: 'sneaky@test.com', password: 'secret1', roleId: String(t.roles['Admin']._id) } });
    assert.equal(toAdmin.status, 403);
    assert.match(toAdmin.data.error, /You can't give someone the "Admin" role/);
    const ok = await api('POST', '/users', { token: delegate.token, body: { name: 'Fine Person', email: 'fine@test.com', password: 'secret1', roleId: fine.data._id } });
    assert.equal(ok.status, 201);
    const sneak = await api('PUT', `/users/${ok.data._id}`, { token: delegate.token, body: { roleId: String(t.roles['Admin']._id) } });
    assert.equal(sneak.status, 403);
});

test('guard rails: access to manage roles cannot be removed from everyone, or from yourself', async () => {
    const { api, makeRole, makePerson, db } = t;
    // a second route to managing access exists (so removing it from the Admin role is not the only thing that matters)
    const only = await makeRole({ name: 'Keeper', category: 'admin', dashboardPage: 'admin.html', permissions: P.normalizePermissions(['dashboard.admin', 'role.view', 'role.edit', 'user.view', 'user.edit', 'user.create', 'role.create']).permissions });
    const keeper = await makePerson('keeper', only, 'Kay Keeper');

    // removing role editing from the role you hold yourself would lock you out of this very screen
    const self = await api('PUT', `/roles/${only._id}`, { token: keeper.token, body: { permissions: only.permissions.filter(p => p !== 'role.edit') } });
    assert.equal(self.status, 400);
    assert.match(self.data.error, /lock you out/);

    // taking it from a role is fine while somebody else can still manage access (the built-in Admin role)
    const fromKeeper = await api('PUT', `/roles/${only._id}`, { token: people.admin.token, body: { permissions: only.permissions.filter(p => p !== 'role.edit') } });
    assert.equal(fromKeeper.status, 200);

    // but not from the last role that gives it
    await db.User.deleteMany({ _id: { $ne: people.admin.user._id }, roleId: t.roles['Admin']._id });
    const adminRole = t.roles['Admin'];
    const stripped = await api('PUT', `/roles/${adminRole._id}`, { token: people.admin.token, body: { permissions: adminRole.permissions.filter(p => p !== 'user.edit') } });
    assert.equal(stripped.status, 403, 'the built-in Admin role cannot lose access');
});

test('the browser is told when an administrator changes its role', async () => {
    const { api, makeRole, makePerson } = t;
    const role = await makeRole({ name: 'Live Edit Role', category: 'sales', permissions: P.normalizePermissions(['enquiry.create']).permissions });
    const person = await makePerson('liveedit', role, 'Lee Live');

    const before = await api('GET', '/auth/me', { token: person.token });
    assert.equal(before.status, 200);
    const versionBefore = before.headers.get('x-access-version');
    assert.ok(versionBefore && versionBefore === before.data.user.accessVersion, 'the header matches the profile');
    assert.ok(!before.data.user.links.includes('/masters.html?type=vendors'));

    const edit = await api('PUT', `/roles/${role._id}`, { token: people.admin.token, body: { permissions: [...role.permissions, 'vendor.view'] } });
    assert.equal(edit.status, 200);

    // very next request: new version header, and /auth/me already reflects it. No new login.
    const after = await api('GET', '/auth/me', { token: person.token });
    assert.notEqual(after.headers.get('x-access-version'), versionBefore);
    assert.ok(after.data.user.permissions.includes('vendor.view'));
    assert.ok(after.data.user.links.includes('/masters.html?type=vendors'));
    assert.equal((await api('GET', '/vendors', { token: person.token })).status, 200);

    // renaming or recolouring the role also changes the version (the name is shown on every page)
    await api('PUT', `/roles/${role._id}`, { token: people.admin.token, body: { name: 'Renamed Role' } });
    assert.notEqual((await api('GET', '/auth/me', { token: person.token })).headers.get('x-access-version'), after.headers.get('x-access-version'));
});

test('deleting a role explains who still has it', async () => {
    const { api, makeRole, makePerson } = t;
    const role = await makeRole({ name: 'Temp Role', permissions: ['enquiry.view.own'] });
    await makePerson('temp1', role, 'Tina Temp');
    await makePerson('temp2', role, 'Tom Temp');
    const refused = await api('DELETE', `/roles/${role._id}`, { token: people.admin.token });
    assert.equal(refused.status, 409);
    assert.match(refused.data.error, /2 people still have this role \(Tina Temp, Tom Temp\)\. Give them a different role in Employees first\./);
    assert.match((await api('DELETE', `/roles/${t.roles['Admin']._id}`, { token: people.admin.token })).data.error, /Built-in roles can be edited but not deleted/);
});

test('catalogue endpoint: everything the editor draws comes from the server', async () => {
    const res = await t.api('GET', '/roles/catalogue', { token: people.salesEntry.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.sections.map(s => s.id), ['see', 'work', 'prices', 'records', 'company']);
    assert.ok(res.data.sections.find(s => s.id === 'records').rows.length === 5);
    assert.deepEqual(res.data.teams.map(x => x.value), ['sales', 'purchase', 'key_accounts', 'admin']);
    assert.ok(res.data.hiddenKeys.includes('sales_price.approve'));
    assert.equal((await t.api('GET', '/roles/catalogue')).status, 401);
});

// ── Consistency between login, the server guard and the role editor ──────────

test('a role that no longer exists means no access, at login and everywhere else (never a quiet upgrade)', async () => {
    const { api, db, mongoose } = t;
    const hash = await require('bcryptjs').hash('password123', 4);
    // an account whose role was removed behind the app's back, still carrying the legacy word "sales"
    const orphan = await db.User.create({ email: 'orphan@test.com', name: 'Olive Orphan', password: hash, role: 'sales', roleId: new mongoose.Types.ObjectId() });

    const session = await api('POST', '/auth/login', { body: { email: 'orphan@test.com', password: 'password123' } });
    assert.equal(session.status, 200);
    assert.deepEqual(session.data.user.permissions, [], 'login must not fall back to the built-in role for the legacy word');
    assert.equal(session.data.user.landingPage, null);
    assert.deepEqual(session.data.user.links, []);

    const token = session.data.token;
    const me = await api('GET', '/auth/me', { token });
    assert.deepEqual(me.data.user.permissions, []);                       // /me agrees with login
    assert.equal((await api('GET', '/enquiries', { token })).status, 403); // and so does every other request
    assert.equal((await api('GET', '/customers', { token })).status, 403);

    // an old account with only the legacy word (no role id at all) still works as before
    await db.User.create({ email: 'legacy@test.com', name: 'Lee Legacy', password: hash, role: 'sales' });
    const legacy = await api('POST', '/auth/login', { body: { email: 'legacy@test.com', password: 'password123' } });
    assert.ok(legacy.data.user.permissions.includes('enquiry.create'));
    assert.equal((await api('GET', '/enquiries', { token: legacy.data.token })).status, 200);
    assert.equal(legacy.data.user.landingPage, (await api('GET', '/auth/me', { token: legacy.data.token })).data.user.landingPage);
});

test('starting screen: "automatic" really picks for you, and leaving it out changes nothing', async () => {
    const { api, makeRole } = t;
    const perms = P.normalizePermissions(['enquiry.create', 'purchase_price.add', 'enquiry.self_assign']).permissions; // can open Sales and Sourcing
    const role = await makeRole({ name: 'Two Screens', category: 'sales', dashboardPage: 'sourcing.html', permissions: perms });

    // saving something else leaves the chosen start screen alone
    const keep = await api('PUT', `/roles/${role._id}`, { token: people.admin.token, body: { description: 'edited' } });
    assert.equal(keep.data.dashboardPage, 'sourcing.html');
    // the same when permissions change but the screen is still valid
    const keep2 = await api('PUT', `/roles/${role._id}`, { token: people.admin.token, body: { permissions: [...perms, 'query.send'] } });
    assert.equal(keep2.data.dashboardPage, 'sourcing.html');
    // an explicit "auto" is chosen from scratch: the team's natural screen (Sales), exactly what the editor's preview shows
    const preview = await api('POST', '/roles/preview', { token: people.admin.token, body: { permissions: perms, category: 'sales' } });
    const auto = await api('PUT', `/roles/${role._id}`, { token: people.admin.token, body: { dashboardPage: 'auto' } });
    assert.equal(auto.data.dashboardPage, 'sales.html');
    assert.equal(auto.data.dashboardPage, preview.data.landingPage, 'the editor promised this screen');
});

test('an old role holding a permission the app no longer has can still be saved', async () => {
    const { api, makeRole } = t;
    const role = await makeRole({ name: 'Aged Role', category: 'sales', permissions: ['enquiry.view.own', 'legacy.removed'] });
    const saved = await api('PUT', `/roles/${role._id}`, { token: people.admin.token, body: { permissions: ['enquiry.view.own', 'legacy.removed'], description: 'tidied' } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data.permissions, ['enquiry.view.own']);
    assert.match(saved.data.notices.join(' '), /Removed a permission the app no longer has/);
    // a brand-new unknown permission is still a mistake worth reporting
    const typo = await api('PUT', `/roles/${role._id}`, { token: people.admin.token, body: { permissions: ['enquiry.view.own', 'made.up'] } });
    assert.equal(typo.status, 400);
    assert.match(typo.data.error, /not recognised: made\.up/);
});

// ── Speed without losing control ─────────────────────────────────────────────

test('the short-lived memory of who a token belongs to never outlives an edit made through the app', async () => {
    const { api, makeRole, makePerson, db } = t;
    process.env.USER_CACHE_TTL_MS = '60000';
    try {
        const role = await makeRole({ name: 'Cache Role', category: 'sales', permissions: P.normalizePermissions(['enquiry.create']).permissions });
        const person = await makePerson('cachey', role, 'Cass Cache');
        const other = await makePerson('cachey2', role, 'Cal Cache');

        assert.equal((await api('GET', '/customers', { token: person.token })).status, 200); // warm: their account is now remembered

        // changing the person through the app takes effect on the very next request
        const keeper = t.roles['Key Accounts – Entry'];
        const changed = await api('PUT', `/users/${person.user._id}`, { token: people.admin.token, body: { roleId: String(keeper._id) } });
        assert.equal(changed.status, 200);
        assert.equal((await api('GET', '/customers', { token: person.token })).status, 200, 'Key Accounts – Entry may see customers');
        assert.equal((await api('POST', '/customers', { token: person.token, body: { name: 'Should Fail Ltd' } })).status, 403, 'and no longer create them');

        // deleting through the app ends access immediately
        assert.equal((await api('GET', '/customers', { token: other.token })).status, 200);
        assert.equal((await api('DELETE', `/users/${other.user._id}`, { token: people.admin.token })).status, 200);
        assert.equal((await api('GET', '/customers', { token: other.token })).status, 401);

        // while a change made behind the app's back is only noticed when the memory expires (that is the trade for one
        // less database round trip on every request)
        const third = await makePerson('cachey3', role, 'Cy Cache');
        assert.equal((await api('GET', '/customers', { token: third.token })).status, 200);
        await db.User.deleteOne({ _id: third.user._id });
        assert.equal((await api('GET', '/customers', { token: third.token })).status, 200, 'still remembered');
        process.env.USER_CACHE_TTL_MS = '0';
        assert.equal((await api('GET', '/customers', { token: third.token })).status, 401, 'noticed as soon as it is not remembered');
    } finally {
        process.env.USER_CACHE_TTL_MS = '0';
    }
});

// ── Ready-made roles ─────────────────────────────────────────────────────────

test('ready-made roles: every one is valid, complete (nothing silently added), and offered by the server', async () => {
    const admin = await t.makePerson('tpl-admin', t.roles['Admin']);
    const cat = await t.api('GET', '/roles/catalogue', { token: admin.token });
    assert.equal(cat.status, 200);
    assert.ok(cat.data.templates.length >= 3);
    for (const template of cat.data.templates) {
        const normalized = P.normalizePermissions(template.permissions);
        assert.deepEqual(normalized.unknown || [], [], `${template.id} has unknown permissions`);
        assert.deepEqual([...normalized.permissions].sort(), [...template.permissions].sort(), `${template.id} would have things added by the dependency rules: list them in the template`);
        assert.ok(template.name && template.description);
        // a role built from it can really be created
        const made = await t.api('POST', '/roles', { token: admin.token, body: { name: `From ${template.id}`, description: template.description, category: template.category, permissions: template.permissions } });
        assert.ok([200, 201].includes(made.status), `${template.id}: ${JSON.stringify(made.data)}`);
    }
    // the all-rounder really can do the whole job
    const all = cat.data.templates.find(x => x.id === 'all-rounder').permissions;
    for (const key of ['enquiry.create', 'purchase_price.add', 'sales_price.add', 'quotation.download', 'quotation.send']) assert.ok(all.includes(key), key);
});
