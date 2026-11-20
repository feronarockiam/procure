/** The general request limiter. Runs in its own process so the limit it sets doesn't touch other tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.API_MAX_PER_MINUTE = '6';
const start = require('./helpers');

let t;
test.before(async () => { t = await start(); });
test.after(async () => { await t.stop(); });

test('a client that fires too many requests is slowed down with a clear message, and health checks are never blocked', async () => {
    const statuses = [];
    for (let i = 0; i < 9; i++) statuses.push((await t.api('GET', '/auth/me')).status); // 401 until the limit, then 429
    assert.deepEqual(statuses.slice(0, 6), Array(6).fill(401));
    assert.ok(statuses.slice(6).every(s => s === 429), `expected 429 after the limit, got ${statuses}`);
    const blocked = await t.api('GET', '/auth/me');
    assert.equal(blocked.status, 429);
    assert.match(blocked.data.error, /too many requests/i);
    assert.ok(blocked.headers.get('retry-after'));
    assert.equal((await t.api('GET', '/health')).status, 200);
    assert.equal((await t.api('GET', '/config')).status, 200);
});
