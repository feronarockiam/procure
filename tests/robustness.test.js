/**
 * Robustness: every route is hit with bad ids, hostile bodies, broken JSON and no sign-in.
 * Nothing may crash (HTTP 500), leak internals, or answer a signed-out visitor.
 * Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const start = require('./helpers');
const manifest = require('./route-manifest.json');

let t, admin;
test.before(async () => { t = await start(); admin = await t.makePerson('root', t.roles['Admin'], 'Root'); });
test.after(async () => { await t.stop(); });

const OPEN = new Set(['POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/health', 'GET /api/config']);
const MISSING = '64b7f0f0f0f0f0f0f0f0f0f0'; // a well-formed id nothing has
const fill = (route, id) => route.replace(/:[A-Za-z]+/g, id);

const BODIES = [
    undefined, null, [], 'text', 42, {},
    { name: { $ne: null }, email: { $gt: '' }, password: { $ne: 1 }, roleId: { $ne: null }, vendorId: { $ne: null } },
    { __proto__: { admin: true }, constructor: { prototype: { x: 1 } } },
    JSON.parse('{"__proto__":{"polluted":true},"permissions":["*"],"name":"x"}'),
    { name: 'x'.repeat(100000), items: Array(2000).fill({ productId: 'zzz', quantity: -1 }) },
    { items: [null, 1, 'a', { productId: { $ne: 1 }, quantity: 'NaN' }], customerId: ['a'], permissions: 'all' },
];

test('no route crashes on bad ids and hostile bodies', async () => {
    const problems = [];
    for (const entry of manifest) {
        if (OPEN.has(entry)) continue;
        const [method, route] = entry.split(' ');
        const route2 = route.replace(/^\/api/, '');
        for (const id of ['zzz', '%00', MISSING, '{"$ne":1}']) {
            for (const body of method === 'GET' || method === 'DELETE' ? [undefined] : BODIES) {
                const path = fill(route2, id);
                const res = await t.api(method, path, { token: admin.token, body });
                if (res.status >= 500) problems.push(`${entry} id=${id} body=${JSON.stringify(body)?.slice(0, 50)} -> ${res.status} ${JSON.stringify(res.data)?.slice(0, 120)}`);
                const text = JSON.stringify(res.data || {});
                if (/at .*\.js:\d+|node_modules|MongoServerError|CastError|ValidationError:/.test(text)) problems.push(`${entry} leaked internals: ${text.slice(0, 120)}`);
            }
        }
        // query strings with operators
        if (method === 'GET') {
            const res = await t.api('GET', `${fill(route2, MISSING)}?id[$ne]=1&q[$gt]=&vendorId[$ne]=1&productId[$ne]=1&limit=-5&before=zz&type[$ne]=x`, { token: admin.token });
            if (res.status >= 500) problems.push(`${entry} with operator query -> ${res.status} ${JSON.stringify(res.data)?.slice(0, 120)}`);
        }
    }
    assert.deepEqual(problems.slice(0, 20), [], `${problems.length} problems`);
});

test('broken JSON is a polite 400, not a crash', async () => {
    for (const path of ['/auth/login', '/customers', '/enquiries', '/roles']) {
        const res = await t.api('POST', path, { token: admin.token, raw: '{"a": ' });
        assert.equal(res.status, 400, `${path} -> ${res.status}`);
        assert.ok(res.data && res.data.error && !/SyntaxError|at /.test(res.data.error), `${path} leaked: ${JSON.stringify(res.data)}`);
    }
    const huge = await t.api('POST', '/customers', { token: admin.token, raw: JSON.stringify({ name: 'x'.repeat(5 * 1024 * 1024) }) });
    assert.ok([400, 413].includes(huge.status), `oversized body -> ${huge.status}`);
});

test('every protected route refuses a visitor who is not signed in, and a forged or expired token', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ id: MISSING }, 'not-the-real-secret');
    const expired = jwt.sign({ id: admin.user._id }, process.env.JWT_SECRET, { expiresIn: -10 });
    const alg = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ id: String(admin.user._id) })).toString('base64url') + '.';
    const wrong = [];
    for (const entry of manifest) {
        if (OPEN.has(entry)) continue;
        const [method, route] = entry.split(' ');
        const path = fill(route.replace(/^\/api/, ''), MISSING);
        for (const [label, token] of [['none', undefined], ['forged', forged], ['expired', expired], ['alg=none', alg]]) {
            const res = await t.api(method, path, { token, body: method === 'GET' || method === 'DELETE' ? undefined : {} });
            if (res.status !== 401) wrong.push(`${entry} with ${label} token -> ${res.status}`);
        }
    }
    assert.deepEqual(wrong.slice(0, 10), []);
});

test('a hostile body cannot change who someone is or what they can do', async () => {
    const seller = await t.makePerson('lowly', t.roles['Sales Operations – Entry'], 'Lowly');
    // mass assignment: extra fields on a profile or login are ignored
    await t.api('POST', '/auth/change-password', { token: seller.token, body: { currentPassword: t.PASSWORD, newPassword: 'another-pass-1', roleId: String(t.roles['Admin']._id), role: 'admin', permissions: ['user.edit'] } });
    const me = await t.api('GET', '/auth/me', { token: seller.token });
    assert.ok(!me.data.user.permissions.includes('user.edit'));
    assert.equal(me.data.user.roleName, 'Sales Operations – Entry');
    // pollution did not stick
    assert.equal({}.polluted, undefined);
    assert.equal({}.admin, undefined);
    // someone with no employee rights cannot create or edit employees or roles by any route
    for (const [method, path, body] of [['POST', '/users', { name: 'a', email: 'a@b.co', password: 'abcdef', roleId: String(t.roles['Admin']._id) }], ['PUT', `/users/${seller.user._id}`, { roleId: String(t.roles['Admin']._id) }], ['POST', '/roles', { name: 'z', permissions: ['user.edit'] }]]) {
        const res = await t.api(method, path, { token: seller.token, body });
        assert.equal(res.status, 403, `${method} ${path} -> ${res.status}`);
    }
});
