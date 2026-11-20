/**
 * Real screens, run for real: every page's own scripts execute in a headless browser (jsdom) against the test server,
 * signed in as each kind of person, with hostile text planted in every kind of name, note and chat message.
 * Fails on: a script error, any element built from user text that carries a live handler (injection), a page that shows
 * a load error, or stray markup / "undefined" in what people read.
 * Needs a local MongoDB (see tests/helpers.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');
const start = require('./helpers');

const HOSTILE = (tag) => `<img src=x onerror="window.__xss=1"> ${tag}`;
let t, people;

test.before(async () => {
    t = await start();
    people = {
        admin: await t.makePerson('p-admin', t.roles['Admin'], HOSTILE('admin-name')),
        sales: await t.makePerson('p-sales', t.roles['Sales Operations – Entry'], 'Sales Person'),
        salesMgr: await t.makePerson('p-smgr', t.roles['Sales Operations – Manager'], 'Sales Boss'),
        buyer: await t.makePerson('p-buy', t.roles['Purchase Operations – Entry'], 'Buy Person'),
        buyMgr: await t.makePerson('p-bmgr', t.roles['Purchase Operations – Manager'], 'Buy Boss'),
        kam: await t.makePerson('p-kam', t.roles['Key Accounts – Manager'], 'Kam Boss'),
    };
    const kamUser = people.kam.user;
    const customer = await t.db.Customer.create({ name: HOSTILE('customer'), contactPerson: HOSTILE('contact'), email: 'c@x.test', address: HOSTILE('address'), assignedKAM: kamUser._id });
    const vendor = await t.db.Vendor.create({ name: HOSTILE('vendor'), specialization: HOSTILE('spec'), contactPerson: HOSTILE('vcontact') });
    const product = await t.db.Product.create({ materialName: HOSTILE('material'), uom: 'Pcs', brand: HOSTILE('brand'), specification: HOSTILE('specification') });
    const plain = await t.db.Product.create({ materialName: 'Plain Cement', uom: 'Bag', brand: 'UltraTech' });
    for (let i = 0; i < 2; i++) {
        const made = await t.api('POST', '/enquiries', { token: people.sales.token, body: { customerId: String(customer._id), items: [{ productId: String(product._id), quantity: 3 }, { productId: String(plain._id), quantity: 5 }] } });
        assert.equal(made.status, 201, JSON.stringify(made.data));
    }
    const first = await t.db.Enquiry.findOne().lean();
    await t.api('POST', `/enquiries/${first._id}/queries`, { token: people.sales.token, body: { message: HOSTILE('chat') } });
    const item = await t.db.EnquiryItem.findOne({ enquiryId: first._id });
    await t.api('POST', '/enquiries/assign-items', { token: people.buyMgr.token, body: { itemIds: [String(item._id)], sourcingUserId: String(people.buyer.user._id) } });
    const another = await t.db.EnquiryItem.findOne({ _id: { $ne: item._id }, status: 'unassigned' });
    await t.api('POST', '/enquiries/assign-items', { token: people.buyMgr.token, body: { itemIds: [String(another._id)], sourcingUserId: String(people.buyer.user._id) } }); // stays with the buyer: open work
    await t.api('POST', '/vendors/quotations', { token: people.buyer.token, body: { enquiryItemId: String(item._id), vendorId: String(vendor._id), vendorPrice: 100, notes: HOSTILE('quote-note') } });
});
test.after(async () => { await t.stop(); });

const skipOutside = () => requestInterceptor((request) => request.url.startsWith(t.baseUrl) ? undefined : new Response('', { headers: { 'Content-Type': 'application/javascript' } }));

async function openAs(person, path, driver) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (e) => errors.push(`script error: ${e.message}`));
    virtualConsole.on('error', (...a) => { const m = a.join(' '); if (!/Not implemented/.test(m)) errors.push(`console.error: ${m.slice(0, 160)}`); });
    const login = await t.login(person.user.email);
    const dom = await JSDOM.fromURL(t.baseUrl + path, {
        runScripts: 'dangerously', resources: { interceptors: [skipOutside()] }, pretendToBeVisual: true, virtualConsole,
        beforeParse(window) {
            window.localStorage.setItem('auth_token', login.data.token);
            window.localStorage.setItem('user', JSON.stringify(login.data.user));
            window.fetch = (u, o) => fetch(new URL(u, t.baseUrl), o);
            window.scrollTo = () => {}; window.Element.prototype.scrollIntoView = () => {};
        },
    });
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const findings = [];
    const inspect = (label) => {
        const d = dom.window.document;
        if (d.querySelectorAll('img[onerror]').length) findings.push(`${label}: user text became a live element`);
        const text = d.body.textContent.replace(/\s+/g, ' ');
        const stray = text.match(/<i class|&lt;i |\[object Object\]|undefined|NaN(?!\w)/g);
        if (stray) findings.push(`${label}: stray text ${[...new Set(stray)].join(' | ')}`);
        if (/We couldn't load this/.test(text)) findings.push(`${label}: shows a load error`);
    };
    try {
        await wait(1300);
        await driver(dom.window, wait, inspect);
    } finally {
        dom.window.close(); // always, or a failed check would leave the headless page running and the test run would never end
    }
    return [...errors.map(e => `${path}: ${e}`), ...findings.map(f => `${path} ${f}`)];
}

const plainPage = (path) => (w, wait, inspect) => { inspect('loaded'); };
const enquiryPage = (tabs) => async (w, wait, inspect) => {
    for (const tab of tabs) for (const mode of ['enquiry', 'material', 'items']) {
        if (tab) w.switchTab(tab);
        w.setViewMode(mode);
        await wait(200);
        w.document.querySelectorAll('.enquiry-accordion-header, .material-card-header').forEach(h => h.click());
        inspect(`[${tab || ''} ${mode}]`);
    }
};

const reportsPage = () => async (w, wait, inspect) => {
    const d = w.document;
    for (let i = 0; i < 20 && !d.querySelector('svg.rp-chart'); i++) await wait(250); // the report is fetched after the page loads
    assert.equal(d.querySelectorAll('.rp-kpi').length, 6, 'six headline figures');
    assert.ok(d.querySelector('svg.rp-chart'), `the daily chart is drawn; the page shows: ${d.getElementById('reportBody').textContent.replace(/\s+/g, ' ').slice(0, 300)} | path ${w.location.pathname}`);
    assert.ok(d.querySelectorAll('.rp-funnel-row').length === 5, 'the funnel has five steps');
    assert.ok(d.querySelectorAll('.rp-table').length >= 4, 'the ranked tables are there');
    for (const metric of ['items', 'quotedValue', 'enquiries']) { d.querySelector(`[data-metric="${metric}"]`).click(); await wait(100); assert.ok(d.querySelector('svg.rp-chart') || d.querySelector('.rp-empty'), `chart for ${metric}`); }
    d.querySelector('.rp-presets button[data-days="7"]').click(); await wait(500);
    assert.equal(d.querySelectorAll('.rp-kpi').length, 6, 'a shorter period still draws everything');
    inspect('reports');
};
const dashboardPage = () => async (w, wait, inspect) => {
    for (let i = 0; i < 20 && !/open item/.test(w.document.getElementById('workloadList').textContent); i++) await wait(250);
    assert.match(w.document.getElementById('workloadList').textContent, /open item/, 'the workload card counts items');
    inspect('dashboard');
};

const SCREENS = [
    ['admin', '/admin.html', dashboardPage()], ['admin', '/analytics.html', reportsPage()], ['admin', '/sales.html', enquiryPage([null])], ['admin', '/sourcing.html', enquiryPage(['new_queue', 'my_work', 'done', 'team'])],
    ['admin', '/key-accounts.html', enquiryPage([null])], ['admin', '/masters.html?type=materials', plainPage()], ['admin', '/masters.html?type=customers', plainPage()],
    ['admin', '/masters.html?type=vendors', plainPage()], ['admin', '/masters.html?type=employees', plainPage()], ['admin', '/role-management.html', plainPage()], ['admin', '/activity.html', plainPage()],
    ['sales', '/sales.html', enquiryPage([null])], ['salesMgr', '/sales.html', enquiryPage([null])],
    ['buyer', '/sourcing.html', enquiryPage(['new_queue', 'my_work', 'done'])], ['buyMgr', '/sourcing.html', enquiryPage(['new_queue', 'my_work', 'done', 'team'])],
    ['kam', '/key-accounts.html', enquiryPage([null])],
];

for (const [who, path, driver] of SCREENS) {
    test(`screen: ${who} opens ${path} cleanly, and hostile text stays text`, async () => {
        const problems = await openAs(people[who], path, driver);
        assert.deepEqual(problems.slice(0, 8), [], `${problems.length} problem(s)`);
    });
}

test('screen: the sign-in page and the "needs you today" strip work', async () => {
    const problems = [];
    // sign-in page, signed out
    const out = new VirtualConsole(); out.on('jsdomError', e => problems.push(`login: ${e.message}`));
    const dom = await JSDOM.fromURL(t.baseUrl + '/', { runScripts: 'dangerously', resources: { interceptors: [skipOutside()] }, virtualConsole: out, beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, t.baseUrl), o); } });
    await new Promise(r => setTimeout(r, 800));
    const d = dom.window.document;
    d.getElementById('pwToggle').click();
    assert.equal(d.getElementById('password').type, 'text');
    d.getElementById('pwToggle').click();
    assert.equal(d.getElementById('password').type, 'password');
    dom.window.close();
    // the strip tells a purchaser what is theirs
    await openAs(people.buyer, '/sourcing.html', async (w, wait) => {
        await wait(500);
        const cards = [...w.document.querySelectorAll('#todoPanel .todo-card')].map(c => c.textContent.replace(/\s+/g, ' ').trim());
        assert.ok(cards.some(c => /waiting for your vendor price|pick up/i.test(c)), `cards: ${cards}`);
        assert.ok(cards.every(c => /^\d+ /.test(c)), 'each card leads with its number');
    }).then(p => problems.push(...p));
    // the hello: time of day + first name, plus what is waiting; a hostile name stays text
    await openAs(people.buyer, '/sourcing.html', async (w, wait) => {
        await wait(500);
        const hello = w.document.querySelector('.page-greeting');
        assert.ok(hello, 'the page has a greeting');
        assert.match(hello.textContent, /^(Good morning|Good afternoon|Good evening|Working late), Buy .*need/, hello.textContent);
    }).then(p => problems.push(...p));
    await openAs(people.admin, '/admin.html', async (w, wait) => {
        await wait(500);
        const hello = w.document.querySelector('.page-greeting');
        assert.ok(hello && /^(Good morning|Good afternoon|Good evening|Working late), /.test(hello.textContent));
        assert.equal(w.document.querySelectorAll('.page-greeting img').length, 0, 'a name with markup in it must stay text');
    }).then(p => problems.push(...p));
    assert.deepEqual(problems, []);
});
