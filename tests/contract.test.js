/**
 * Frontend <-> backend contract. No database needed: these read the source of both sides and fail when they drift.
 *
 *   - the set of API routes only changes on purpose (a dropped route would silently break a button)
 *   - every request a screen makes goes to a route that exists, with the right method
 *   - every permission a screen mentions is a real one, and every action the server guards has a matching gate in the UI
 *   - every handler wired in markup is actually defined
 *
 * After adding or removing a route on purpose:  UPDATE_ROUTES=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../constants/permissions');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const list = (dir, ext) => fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith(ext)).map(f => [`${dir}/${f}`, read(`${dir}/${f}`)]);
const screens = list('public/js', '.js');
const pages = list('public', '.html');

// ── Routes ───────────────────────────────────────────────────────────────────

const mounts = {};
for (const m of read('server.js').matchAll(/app\.use\('(\/api\/[a-z-]+)', require\('\.\/routes\/([a-z.-]+?)(?:\.js)?'\)\)/g)) mounts[m[2]] = m[1];
const routes = [];
for (const [file, base] of Object.entries(mounts)) {
    const text = read(`routes/${file.endsWith('.js') ? file : file + '.js'}`);
    for (const m of text.matchAll(/router\.(get|post|put|delete)\(\s*'([^']+)'/g)) {
        const full = base + (m[2] === '/' ? '' : m[2]);
        routes.push({ method: m[1].toUpperCase(), path: full, matcher: new RegExp('^' + full.replace(/:[a-zA-Z]+/g, '[^/]+') + '$') });
    }
}
// server.js's own routes
for (const m of read('server.js').matchAll(/app\.(get|post|put|delete)\('(\/api\/[^']+)'/g)) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], matcher: new RegExp('^' + m[2] + '$') });
}

test('routes: the API only gains or loses routes on purpose', () => {
    const current = routes.map(r => `${r.method} ${r.path}`).sort();
    const manifestPath = path.join(__dirname, 'route-manifest.json');
    if (process.env.UPDATE_ROUTES || !fs.existsSync(manifestPath)) {
        fs.writeFileSync(manifestPath, JSON.stringify(current, null, 2) + '\n');
        return;
    }
    const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(expected.filter(r => !current.includes(r)), [], 'routes that used to exist are gone (a screen may still call them). If intended: UPDATE_ROUTES=1 npm test');
    assert.deepEqual(current.filter(r => !expected.includes(r)), [], 'new routes that are not in the manifest. If intended: UPDATE_ROUTES=1 npm test');
});

// ── What the screens call ────────────────────────────────────────────────────

const calls = [];
for (const [file, text] of screens) {
    for (const m of text.matchAll(/apiCall\(\s*([`'"])(\/[^`'"]*)\1\s*(?:,\s*\{([^}]*)\})?/g)) {
        calls.push({ file, method: ((m[3] || '').match(/method:\s*'([A-Z]+)'/) || [, 'GET'])[1], url: '/api' + m[2].split('?')[0].replace(/\$\{[^}]*\}/g, 'X') });
    }
}
for (const [file, text] of pages) {
    for (const m of text.matchAll(/fetch\(\s*([`'"])(\/api[^`'"]*)\1\s*(?:,\s*\{([^}]*)\})?/g)) {
        calls.push({ file, method: ((m[3] || '').match(/method:\s*'([A-Z]+)'/) || [, 'GET'])[1], url: m[2].split('?')[0].replace(/\$\{[^}]*\}/g, 'X') });
    }
}

test('screens: every request a screen makes goes to a route that exists', () => {
    assert.ok(calls.length > 60, `the scan should find the screens' requests (found ${calls.length})`);
    const missing = calls.filter(c => !routes.some(r => r.method === c.method && r.matcher.test(c.url)));
    assert.deepEqual(missing.map(c => `${c.file}: ${c.method} ${c.url}`), []);
});

// ── Permissions on screen ────────────────────────────────────────────────────

test('screens: every permission a screen checks is a real permission, and every page guard is a real menu link', () => {
    const mentioned = new Set();
    for (const [, text] of screens) {
        for (const m of text.matchAll(/has(?:Any|All)?Permissions?\((\[?[^)]*)\)/g)) for (const k of m[1].matchAll(/'([a-z_.]+)'/g)) mentioned.add(k[1]);
    }
    assert.ok(mentioned.size > 10);
    assert.deepEqual([...mentioned].filter(k => !P.ALL_PERMISSIONS.includes(k)), []);

    const links = P.NAV_LINKS.map(l => l.href);
    for (const [file, text] of screens) {
        for (const m of text.matchAll(/(?:requirePageAccess|canOpenHref)\('([^']+)'/g)) assert.ok(links.includes(m[1]), `${file} guards "${m[1]}", which is not a menu link the server knows`);
    }
    for (const [file, text] of pages) {
        for (const m of text.matchAll(/<a href="(\/[a-z-]+\.html[^"]*)" class="nav-item/g)) assert.ok(links.includes(m[1]), `${file} has a menu link to "${m[1]}" that the server does not govern`);
    }
});

test('screens: every action the server guards has a matching gate in the UI', () => {
    // Actions a person triggers from a button. If the screen does not check the permission, it shows the button to
    // people the server will refuse, and they get an error instead of not seeing the button.
    // (List permissions like material.view / vendor.view / user.view / role.view decide which screens open: see NAV_LINKS.)
    const actionPermissions = [
        'enquiry.create', 'enquiry.bulk_create', 'enquiry.combine', 'enquiry.assign', 'enquiry.self_assign',
        'enquiry.mark_unsuccessful', 'enquiry.reopen', 'query.send',
        'purchase_price.add', 'sales_price.add', 'quotation.send', 'quotation.download',
        'customer.create', 'material.create', 'vendor.create',
        'filter.by_key_account_manager',
    ];
    const gated = (key) => screens.some(([, text]) => new RegExp(`has(?:Any|All)?Permissions?\\([^)]*'${key.replace(/\./g, '\\.')}'`).test(text));
    assert.deepEqual(actionPermissions.filter(k => !gated(k)), [], 'the server enforces these, but no screen checks them before offering the action');
});

// ── Handlers ─────────────────────────────────────────────────────────────────

test('screens: every handler wired in markup is defined somewhere', () => {
    const defined = new Set();
    const code = [...screens, ...pages];
    for (const [, text] of code) {
        for (const m of text.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) defined.add(m[1]);
        for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\(|function|debounce\(|[A-Za-z_$][\w$]*\s*=>)/g)) defined.add(m[1]);
        for (const m of text.matchAll(/window\.([A-Za-z0-9_$]+)\s*=/g)) defined.add(m[1]);
    }
    const ignore = new Set(['alert', 'confirm', 'event', 'this', 'window', 'document', 'if', 'return', 'history', 'location', 'setTimeout', 'JSON', 'Math', 'String', 'Number', 'Array']);
    const missing = new Map();
    for (const [file, text] of code) {
        for (const m of text.matchAll(/on(?:click|change|input|submit|keyup|keydown|blur|focus)\s*=\s*"([^"]*)"/g)) {
            for (const c of m[1].matchAll(/(?:^|[;\s(!&|])([A-Za-z_$][\w$]*)\s*\(/g)) {
                if (!ignore.has(c[1]) && !defined.has(c[1])) missing.set(c[1], file);
            }
        }
    }
    assert.deepEqual([...missing].map(([n, f]) => `${n} (${f})`), []);
});
