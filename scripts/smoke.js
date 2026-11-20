/**
 * After deploying: a quick check that the live site is up and set up sensibly. Changes nothing, signs nobody in.
 *   npm run smoke -- https://procure.yourcompany.com
 */
const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
    console.error('Usage: npm run smoke -- https://your-site-address');
    process.exit(2);
}

const results = [];
const check = async (name, fn) => {
    try {
        const detail = await fn();
        results.push({ name, ok: true, detail });
    } catch (error) {
        results.push({ name, ok: false, detail: error.message });
    }
};
const get = (path, options) => fetch(base + path, { redirect: 'manual', ...options });
const expect = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
    await check('the site answers with the sign-in page', async () => {
        const res = await get('/');
        expect(res.status === 200, `GET / returned ${res.status}`);
        expect((await res.text()).includes('Precise Procure'), 'the page does not look like Precise Procure');
        return 'ok';
    });
    await check('the application can reach its database', async () => {
        const res = await get('/api/health');
        expect(res.status === 200, `/api/health returned ${res.status}${res.status === 503 ? ' (the database is unreachable: check MONGODB_URI and the Atlas allow-list)' : ''}`);
        expect((await res.json()).status === 'OK', 'unexpected health answer');
        return 'database connected';
    });
    await check('private data needs a sign-in', async () => {
        for (const path of ['/api/enquiries', '/api/customers', '/api/users', '/api/roles']) {
            const res = await get(path);
            expect(res.status === 401, `${path} returned ${res.status} without signing in (expected 401)`);
        }
        return '401 on enquiries, customers, users, roles';
    });
    await check('the demo accounts are not advertised', async () => {
        const config = await (await get('/api/config')).json();
        expect(config.demoLogin === false, 'SHOW_DEMO_LOGIN is on: the sign-in page shows demo accounts and their shared password');
        return 'demo sign-in is off';
    });
    await check('security headers are present', async () => {
        const res = await get('/');
        for (const header of ['x-content-type-options', 'x-frame-options', 'referrer-policy']) expect(res.headers.get(header), `missing ${header}`);
        expect(!res.headers.get('x-powered-by'), 'x-powered-by is exposed');
        return 'ok';
    });
    await check('the site is on https', async () => {
        expect(base.startsWith('https://'), 'this address is not https (turn on AutoSSL in cPanel)');
        return 'https';
    });
    await check('pages and scripts load', async () => {
        for (const path of ['/js/auth.js', '/js/ui.js', '/css/style.css', '/css/premium-ui.css', '/sales.html', '/no-access.html']) {
            const res = await get(path);
            expect(res.status === 200, `${path} returned ${res.status}`);
        }
        return 'ok';
    });
    await check('responses are compressed', async () => {
        const res = await get('/js/sales.js', { headers: { 'Accept-Encoding': 'gzip' } });
        expect(/gzip|br/.test(res.headers.get('content-encoding') || ''), 'no compression');
        return 'ok';
    });

    const width = Math.max(...results.map(r => r.name.length));
    for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(width)}  ${r.ok ? r.detail : r.detail}`);
    const failed = results.filter(r => !r.ok).length;
    console.log(failed ? `\n${failed} of ${results.length} checks need attention.` : `\nAll ${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
})();
