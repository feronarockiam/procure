/**
 * "Any custom role works": generate many roles (every single permission, every pair of features, random mixes,
 * and a list of realistic job roles) and check the same guarantees on each one:
 *
 *   - choosing permissions is stable (tidying twice changes nothing)
 *   - the person starts on a screen their role can open, and the menu only lists screens they can open
 *   - every screen their role can open actually loads (none of its essential requests are refused)
 *   - each list/page is allowed exactly when the role includes the matching permission, never more, never less
 *
 * Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const start = require('./helpers');
const P = require('../constants/permissions');

// What each screen asks the server for as it opens: the requests it cannot do without.
// (Optional extras, like pick-lists, are loaded in a way that tolerates being refused.)
const ESSENTIAL_CALLS = {
    '/admin.html': ['/enquiries'],
    '/sales.html': ['/enquiries'],
    '/sourcing.html': ['/enquiries'],
    '/key-accounts.html': ['/enquiries'],
    '/masters.html?type=materials': ['/products'],
    '/masters.html?type=customers': ['/customers'],
    '/masters.html?type=vendors': ['/vendors'],
    '/masters.html?type=employees': ['/users'],
    '/role-management.html': ['/roles', '/roles/catalogue'],
    '/activity.html': ['/audit', '/audit/people'],
    '/analytics.html': ['/analytics'],
};
// The list endpoints, and the one permission each needs
const GUARDED_LISTS = { '/products': 'material.view', '/customers': 'customer.view', '/vendors': 'vendor.view', '/users': 'user.view', '/roles': 'role.view', '/audit': 'audit.view', '/analytics': 'analytics.view' };

// A small seeded generator so a failure can be reproduced exactly
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

const FEATURE_KEYS = [...P.VIEW_KEYS, 'enquiry.create', 'enquiry.bulk_create', 'enquiry.combine', 'enquiry.assign', 'enquiry.self_assign',
    'enquiry.mark_unsuccessful', 'enquiry.reopen', 'query.send', 'purchase_price.add', 'sales_price.add', 'quotation.download',
    'quotation.send', 'dashboard.admin', 'filter.by_sourcing_user', 'filter.by_key_account_manager'];

const combos = [];
for (const key of P.ALL_PERMISSIONS) combos.push({ name: `only ${key}`, permissions: [key] });
for (let i = 0; i < FEATURE_KEYS.length; i++) {
    for (let j = i + 1; j < FEATURE_KEYS.length; j++) combos.push({ name: `${FEATURE_KEYS[i]} + ${FEATURE_KEYS[j]}`, permissions: [FEATURE_KEYS[i], FEATURE_KEYS[j]] });
}
const random = seeded(20260101);
for (let n = 0; n < 150; n++) {
    const size = 1 + Math.floor(random() * 14);
    const picked = new Set();
    while (picked.size < size) picked.add(P.ALL_PERMISSIONS[Math.floor(random() * P.ALL_PERMISSIONS.length)]);
    combos.push({ name: `random #${n}`, permissions: [...picked] });
}
// Realistic jobs an administrator might create
const JOBS = {
    'Auditor (sees everything, changes nothing)': ['enquiry.view.all', 'quotation.download', 'customer.view', 'vendor.view', 'material.view'],
    'Data entry – materials only': ['material.view', 'material.create', 'material.edit'],
    'Front desk (adds employees)': ['user.view', 'user.create'],
    'Access manager (roles and employees only)': ['role.view', 'role.create', 'role.edit', 'user.view', 'user.create', 'user.edit'],
    'Purchase person who can also add vendors': ['enquiry.view.assigned', 'enquiry.self_assign', 'purchase_price.add', 'vendor.create', 'query.send'],
    'Sales + Purchase – Entry': ['enquiry.create', 'enquiry.self_assign', 'purchase_price.add', 'sales_price.add', 'quotation.send', 'quotation.download'],
    'Key account manager who can also quote': ['enquiry.view.assigned_customers', 'quotation.download', 'sales_price.add', 'customer.edit'],
    'Regional lead (sees all, hands out work, no prices)': ['enquiry.view.all', 'enquiry.assign', 'enquiry.reopen', 'filter.by_sourcing_user'],
    'Reporting (admin dashboard only)': ['dashboard.admin'],
    'Everything': P.ALL_PERMISSIONS,
};
for (const [name, permissions] of Object.entries(JOBS)) combos.push({ name, permissions, job: true });

let t;
test.before(async () => { t = await start(); });
test.after(async () => { if (t) await t.stop(); });

test(`any role works: ${combos.length} generated roles, same guarantees on each`, async () => {
    const { db } = t;
    const failures = [];
    const check = (condition, combo, message) => { if (!condition) failures.push(`[${combo.name}] ${message}`); };
    let opened = 0;

    for (const [index, combo] of combos.entries()) {
        const tidy = P.normalizePermissions(combo.permissions);

        // 1. tidying is stable, and never takes anything away
        const again = P.normalizePermissions(tidy.permissions);
        check(again.added.length === 0 && again.permissions.join() === tidy.permissions.join(), combo, 'normalizing twice changed the permissions');
        check(combo.permissions.every(k => tidy.permissions.includes(k)), combo, 'normalizing removed a chosen permission');

        // 2. it can always be described, without errors
        const described = P.describeRole(tidy.permissions);
        check(described.lines.length >= 1 && described.lines.every(l => l.text), combo, 'description is empty');
        P.roleWarnings(tidy.permissions);

        // a real role and person
        const role = await db.Role.create({
            name: `combo-${index}`, category: ['sales', 'purchase', 'key_accounts', 'admin'][index % 4],
            dashboardPage: 'sales.html', permissions: tidy.permissions, color: '#3B9FD9',
        });
        const user = await db.User.create({ email: `c${index}@test.com`, name: `Combo ${index}`, password: 'x', roleId: role._id, role: 'sales' });
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // 3. where they start, and what the menu lists
        const me = await t.api('GET', '/auth/me', { token });
        check(me.status === 200, combo, `/auth/me returned ${me.status}`);
        const { links, landingPage } = me.data.user;
        const permissionSet = new Set(tidy.permissions);
        const expectedLinks = P.NAV_LINKS.filter(l => l.needsAny.some(k => permissionSet.has(k))).map(l => l.href);
        check(links.join() === expectedLinks.join(), combo, 'the menu does not match the role');
        check((landingPage === null) === (links.length === 0), combo, `starts on ${landingPage} but can open ${links.length} screens`);
        if (landingPage) check(links.includes('/' + landingPage), combo, `starts on ${landingPage}, which the role cannot open`);

        // 4. every screen they can open loads
        for (const href of links) {
            for (const call of ESSENTIAL_CALLS[href] || []) {
                const res = await t.api('GET', call, { token });
                opened++;
                check(res.status === 200, combo, `${href} asks for ${call} and was refused (${res.status})`);
            }
        }

        // 5. lists open exactly when the role says so
        for (const [endpoint, key] of Object.entries(GUARDED_LISTS)) {
            const res = await t.api('GET', endpoint, { token });
            check((res.status === 200) === permissionSet.has(key), combo, `GET ${endpoint} returned ${res.status} but the role ${permissionSet.has(key) ? 'has' : 'lacks'} ${key}`);
        }
        const enquiries = await t.api('GET', '/enquiries', { token });
        const mayList = P.VIEW_KEYS.some(k => permissionSet.has(k)) || permissionSet.has('enquiry.self_assign');
        check((enquiries.status === 200) === mayList, combo, `GET /enquiries returned ${enquiries.status}`);
    }

    assert.ok(opened > 500, `expected to exercise hundreds of screen loads, saw ${opened}`);
    assert.deepEqual(failures.slice(0, 15), [], `${failures.length} problems across ${combos.length} roles`);
});

test('realistic job roles do what their name says, and nothing more', async () => {
    const { db } = t;
    const person = async (name, category = 'sales', dashboardPage = 'sales.html') => {
        const role = await db.Role.create({ name: `job-${name}`, category, dashboardPage, permissions: P.normalizePermissions(JOBS[name]).permissions });
        const user = await db.User.create({ email: `${name.replace(/\W+/g, '').toLowerCase()}@jobs.test`, name, password: 'x', roleId: role._id, role: 'sales' });
        return { token: jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' }), user };
    };
    const me = async (p) => (await t.api('GET', '/auth/me', { token: p.token })).data.user;

    // a role that only manages a list starts on that list, not on a dead end
    const materials = await person('Data entry – materials only');
    assert.equal((await me(materials)).landingPage, 'masters.html?type=materials');
    assert.equal((await t.api('POST', '/products', { token: materials.token, body: { materialName: 'Rebar', uom: 'Kg' } })).status, 201);
    assert.equal((await t.api('DELETE', '/products/000000000000000000000000', { token: materials.token })).status, 403);
    assert.equal((await t.api('GET', '/enquiries', { token: materials.token })).status, 403);

    // the auditor sees everything and cannot change anything
    const auditor = await person('Auditor (sees everything, changes nothing)');
    assert.equal((await me(auditor)).landingPage, 'sales.html');
    assert.equal((await t.api('GET', '/enquiries', { token: auditor.token })).status, 200);
    assert.equal((await t.api('POST', '/customers', { token: auditor.token, body: { name: 'Nope' } })).status, 403);
    assert.equal((await t.api('POST', '/enquiries', { token: auditor.token, body: {} })).status, 403);
    assert.equal((await t.api('POST', '/vendors/quotations', { token: auditor.token, body: {} })).status, 403);

    // the front desk adds people but cannot touch roles or hand out roles beyond their own access
    const desk = await person('Front desk (adds employees)');
    assert.equal((await t.api('GET', '/roles', { token: desk.token })).status, 403);
    assert.equal((await t.api('GET', '/roles/assignable', { token: desk.token })).status, 200);
    assert.equal((await t.api('PUT', `/roles/${(await db.Role.findOne({ name: 'job-' + 'Front desk (adds employees)' }))._id}`, { token: desk.token, body: { description: 'x' } })).status, 403);

    // reporting-only role: the dashboard (it needs to see all enquiries, which the rules switch on)
    const reporting = await person('Reporting (admin dashboard only)', 'admin', 'admin.html');
    const reportingMe = await me(reporting);
    assert.equal(reportingMe.landingPage, 'admin.html');
    assert.ok(reportingMe.permissions.includes('enquiry.view.all'));
    assert.equal((await t.api('GET', '/users', { token: reporting.token })).status, 403, 'the dashboard must not expose the employee list');
});
