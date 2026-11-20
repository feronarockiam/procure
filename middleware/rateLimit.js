// A small in-memory limiter (no extra package, nothing to install on shared hosting).
// Counts attempts per key inside a time window. It lives in the memory of one running copy of the app, which is the
// right size for one cPanel app; behind several copies each keeps its own count (still a useful brake).

function createLimiter({ windowMs, max }) {
    const hits = new Map(); // key -> { count, resetAt }
    const sweep = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    }, 60 * 1000);
    if (sweep.unref) sweep.unref(); // never keeps the process alive on its own

    const limit = () => (typeof max === 'function' ? max() : max);
    return {
        // Records an attempt. Returns { allowed, retryAfterSeconds }.
        hit(key) {
            const now = Date.now();
            let entry = hits.get(key);
            if (!entry || entry.resetAt <= now) { entry = { count: 0, resetAt: now + windowMs }; hits.set(key, entry); }
            entry.count += 1;
            return { allowed: entry.count <= limit(), retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
        },
        // Look without counting
        peek(key) {
            const entry = hits.get(key);
            if (!entry || entry.resetAt <= Date.now()) return { allowed: true, retryAfterSeconds: 0 };
            return { allowed: entry.count < limit(), retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000)) };
        },
        reset(key) { hits.delete(key); },
        clear() { hits.clear(); },
    };
}

const minutes = (seconds) => Math.max(1, Math.ceil(seconds / 60));
const waitMessage = (seconds) => `Too many sign-in attempts. Please wait ${minutes(seconds)} minute${minutes(seconds) === 1 ? '' : 's'} and try again.`;

module.exports = { createLimiter, waitMessage };
