// API Base URL
const API_URL = '/api';

// ── Token & User Storage ─────────────────────────────────────────────────────

function saveToken(token) {
    localStorage.setItem('auth_token', token);
}

function getToken() {
    return localStorage.getItem('auth_token');
}

function removeToken() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
}

function saveUser(user) {
    localStorage.setItem('user', JSON.stringify(user));
}

function getUser() {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
}

// ── Permission Helpers ───────────────────────────────────────────────────────

function hasPermission(key) {
    const user = getUser();
    if (!user) return false;
    if (Array.isArray(user.permissions) && user.permissions.includes(key)) return true;
    return false;
}

// Run `fn` once the caller has stopped for `wait` ms (typing in a search box redraws a long list; once per pause is plenty)
function debounce(fn, wait = 200) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

// A value passed as an argument inside an inline click handler in markup: JS-quote it first, then HTML-escape the result,
// so a name containing quotes, brackets or markup stays plain text instead of becoming code.
function jsArg(value) {
    return escapeHtml(JSON.stringify(String(value ?? '')));
}

// Escape user-supplied text before putting it into innerHTML / inline attributes
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

function hasAnyPermission(keys) {
    const user = getUser();
    if (!user || !Array.isArray(user.permissions)) return false;
    return keys.some(k => user.permissions.includes(k));
}

function hasAllPermissions(keys) {
    const user = getUser();
    if (!user || !Array.isArray(user.permissions)) return false;
    return keys.every(k => user.permissions.includes(k));
}

// ── Auth Checks ──────────────────────────────────────────────────────────────

function checkAuth() {
    const token = getToken();
    if (!token) {
        window.location.href = '/';
        return null;
    }
    const user = getUser();
    // A session saved before the server started sending the list of screens this person may open:
    // fetch it once and reload, instead of guessing from permissions here.
    if (user && !Array.isArray(user.links)) {
        refreshSession().then(ok => {
            if (ok) { window.location.reload(); return; }
            // Only a refused session is a reason to sign out. If the server just couldn't be reached, say so and stay put.
            if (refreshSession.lastStatus === 401 || refreshSession.lastStatus === 403) { removeToken(); window.location.href = '/'; }
            else showToast("Couldn't reach the server. Check your connection and reload the page.", 'error');
        });
        return null;
    }
    return user;
}

// ── What this person may open ────────────────────────────────────────────────
// The server decides (from the role) and sends the list at login. The browser only checks it.

function canOpenHref(href) {
    const user = getUser();
    return !!(user && Array.isArray(user.links) && user.links.includes(href));
}

function currentHref() {
    // '/masters.html?type=customers' keeps its type; other pages are just the path
    const { pathname, search } = window.location;
    if (pathname === '/masters.html') {
        const type = new URLSearchParams(search).get('type') || 'materials';
        return `/masters.html?type=${type}`;
    }
    return pathname;
}

// Tell the administrators someone needs access (a notification with a link to that person's record; nothing changes until they act)
async function requestAccess(wants, note) {
    try {
        const result = await apiCall('/access-requests', { method: 'POST', body: JSON.stringify({ wants, note: note || undefined }) });
        showToast(result.sent > 0
            ? (result.already ? 'You already asked. The administrators have been told.' : `Request sent to ${result.sent} administrator${result.sent === 1 ? '' : 's'}.`)
            : 'There is no administrator to send this to. Please contact your manager directly.', result.sent > 0 ? 'success' : 'error');
        return result.sent > 0;
    } catch (error) {
        showToast(error.message || 'Could not send the request', 'error');
        return false;
    }
}

// Not allowed here: say so, and let them ask for access in one click (instead of a dead end)
function denyAccess(message, wanted) {
    const user = getUser();
    const start = user && user.landingPage ? '/' + user.landingPage : '/no-access.html';
    const leave = () => { window.location.href = start === window.location.pathname ? '/no-access.html' : start; };
    const what = wanted || 'this screen';
    document.body.classList.add('access-denied'); // the screen behind the question stays out of sight
    if (typeof showDialog !== 'function') { showToast(message || "Your role doesn't include this screen.", 'error'); setTimeout(leave, 1500); return; }
    showDialog({
        title: "This screen isn't part of your role",
        bodyHtml: `<p style="margin:0 0 0.8rem;line-height:1.55">Your role${user && user.roleName ? ` (<b>${escapeHtml(user.roleName)}</b>)` : ''} doesn't include <b>${escapeHtml(what)}</b>. If you need it for your work, you can ask an administrator, who can give you access in a click.</p>
            <label for="accessNote" style="font-size:0.8rem;font-weight:600">Why do you need it? <span class="text-muted" style="font-weight:400">(optional)</span></label>
            <textarea id="accessNote" rows="2" maxlength="400" placeholder="e.g. I check the weekly volumes" style="width:100%;margin-top:0.25rem"></textarea>`,
        buttons: [
            { label: 'Go back', kind: 'secondary', onClick: leave },
            { label: 'Ask for access', kind: 'primary', onClick: async () => { await requestAccess(what, (document.getElementById('accessNote') || {}).value || ''); leave(); } },
        ],
        onDismiss: leave,
    });
}

// Call at the top of a page: true when this person's role includes the page
function requirePageAccess(href) {
    if (canOpenHref(href || currentHref())) return true;
    const known = typeof NAV_META !== 'undefined' ? NAV_META[href || currentHref()] : null;
    denyAccess("Your role doesn't include this screen.", known ? known.label : null);
    return false;
}

// Ask the server what this person can do right now, and keep it. Resolves true when it worked.
async function refreshSession() {
    const token = getToken();
    refreshSession.lastStatus = 0;
    if (!token) return false;
    try {
        const response = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        refreshSession.lastStatus = response.status;
        if (!response.ok) return false;
        const data = await response.json();
        const before = getUser();
        // /auth/me doesn't know which sign-in was the previous one, so keep what the login gave us
        saveUser({ ...data.user, lastLoginAt: before ? before.lastLoginAt : null });
        return true;
    } catch (_) {
        return false; // lastStatus stays 0: the server couldn't be reached
    }
}

// Every response carries a fingerprint of the person's role. When it differs from the one we hold, an
// administrator changed the role: pick up the new access and reload so menus and buttons match.
let accessRefreshInFlight = false;
function noticeAccessVersion(version) {
    const user = getUser();
    if (!version || !user || !user.accessVersion || user.accessVersion === version || accessRefreshInFlight) return;
    accessRefreshInFlight = true;
    refreshSession().then(ok => {
        if (!ok) return;
        // Never reload twice in a row for the same change: if the fresh session still disagrees, a reload won't help
        const after = getUser();
        let lastReload = null;
        try { lastReload = sessionStorage.getItem('access_reload'); } catch (_) {}
        if (after && after.accessVersion === lastReload) return;
        try { sessionStorage.setItem('access_reload', after ? after.accessVersion : ''); } catch (_) {}
        showToast('Your access was just updated by an administrator. Refreshing…', 'info');
        setTimeout(() => window.location.reload(), 1500);
    }).finally(() => { accessRefreshInFlight = false; });
}

// The enquiry list sends every open enquiry but only the newest closed ones. Say so once, so nobody wonders
// where an old closed enquiry went.
let shortListNoticeShown = false;
function noticeShortList(response) {
    const total = Number(response.headers.get('X-Total-Count'));
    const returned = Number(response.headers.get('X-Returned-Count'));
    if (shortListNoticeShown || !total || !returned || returned >= total) return;
    shortListNoticeShown = true;
    showToast(`Showing ${returned} of ${total} enquiries: every open one, and the newest closed ones. Older closed enquiries are left out to keep things quick.`, 'info');
}

// Redirect to the screen this person's role starts on
function redirectToDashboard(landingPage) {
    window.location.href = landingPage ? '/' + landingPage : '/no-access.html';
}

// ── API Helper ───────────────────────────────────────────────────────────────

// options.silent: for loads a page can do without (say a pick-list this role isn't allowed to see). A refusal
// is then reported to the caller only, with no "no permission" message on screen.
async function apiCall(endpoint, options = {}) {
    const token = getToken();
    const { silent, ...fetchOptions } = options;

    const mergedOptions = {
        ...fetchOptions,
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
            ...options.headers,
        },
    };

    try {
        const response = await fetch(`${API_URL}${endpoint}`, mergedOptions);
        noticeAccessVersion(response.headers.get('X-Access-Version'));
        noticeShortList(response);

        if (response.status === 401) {
            showToast('Session expired — please log in again', 'error');
            setTimeout(() => { removeToken(); window.location.href = '/'; }, 1500);
            return null;
        }

        if (response.status === 403) {
            // Throw (instead of returning null) so callers don't carry on as if the request worked
            let detail = 'You do not have permission to perform this action';
            try { detail = (await response.json()).error || detail; } catch (_) { /* non-JSON body */ }
            if (!silent) showToast('You do not have permission to perform this action', 'error');
            const err = new Error(detail);
            err.status = 403;
            err.handled = !silent; // a message was already shown, unless it was a silent load
            throw err;
        }

        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            throw new Error(`Unexpected server response: ${text.substring(0, 100)}`);
        }

        if (!response.ok) {
            const err = new Error(data.error || 'Request failed');
            err.status = response.status;
            err.data = data; // e.g. a 409 "already exists" carries the existing record
            throw err;
        }

        return data;
    } catch (error) {
        console.error('API call error:', error);
        throw error;
    }
}

// ── Logout ───────────────────────────────────────────────────────────────────

async function logout() {
    try {
        await apiCall('/auth/logout', { method: 'POST' });
    } catch (_) {
        // ignore
    } finally {
        removeToken();
        window.location.href = '/';
    }
}

// ── Formatters ───────────────────────────────────────────────────────────────

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function formatCurrency(amount) {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency', currency: 'INR', maximumFractionDigits: 0,
    }).format(amount);
}

function getStatusBadge(status) {
    const badges = {
        unassigned:             '<span class="badge badge-unassigned">Unassigned</span>',
        assigned:               '<span class="badge badge-assigned">Assigned</span>',
        in_sales_query:         '<span class="badge badge-in-query">In Query</span>',
        sales_query_resolved:   '<span class="badge badge-query-resolved">Query Resolved</span>',
        vendor_quoted:          '<span class="badge badge-vendor-quoted">Vendor Quoted</span>',
        priced:                 '<span class="badge badge-priced">Priced</span>',
        completed:              '<span class="badge badge-completed">Completed</span>',
        unsuccessful:           '<span class="badge badge-unsuccessful">Unsuccessful</span>',
        // backward-compat aliases
        pending:                '<span class="badge badge-unassigned">Unassigned</span>',
        sales_priced:           '<span class="badge badge-priced">Priced</span>',
    };
    return badges[status] || `<span class="badge">${status}</span>`;
}

// Render a role badge using the role's own color
// A colour's text shade for use on a light tint of itself. Role colours are chosen by people (sky blue, amber, green...)
// and most of them are too light to read as text on their own pale background, so darken until they can be read.
function readableTextColor(hex, tintAlpha = 0.13, minRatio = 4.5) {
    const toRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const channel = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const base = toRgb(hex);
    const tint = base.map(c => Math.round(c * tintAlpha + 255 * (1 - tintAlpha)));
    let rgb = base;
    for (let step = 0; step < 24 && contrast(rgb, tint) < minRatio; step++) rgb = rgb.map(c => Math.round(c * 0.92));
    return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
}

function getRoleBadge(roleName, roleColor) {
    // Only accept a real hex colour into the style attribute; the name is user text
    const color = /^#[0-9a-fA-F]{6}$/.test(roleColor || '') ? roleColor : '#1b72b3';
    const bg = color + '22'; // 13% opacity hex
    return `<span class="badge" style="background:${bg};color:${readableTextColor(color)};border:1px solid ${color}66">${escapeHtml(roleName)}</span>`;
}

// ── Material-first view helper ───────────────────────────────────────────────
// Takes an array of {item, enquiry} pairs and groups them by product ID.
function groupByMaterial(entries) {
    const map = new Map();
    for (const { item, enquiry } of entries) {
        const pid = item.productId?._id || item.productId || '__unknown__';
        if (!map.has(pid)) {
            map.set(pid, { product: item.productId, totalQty: 0, entries: [] });
        }
        const g = map.get(pid);
        g.totalQty += (item.quantity || 0);
        g.entries.push({ item, enquiry });
    }
    return [...map.values()].sort((a, b) =>
        (a.product?.materialName || '').localeCompare(b.product?.materialName || '')
    );
}

// Toggle open/close a material card (used from onclick in generated HTML)
function toggleMaterialCard(id) {
    const card = document.getElementById(id);
    if (card) card.classList.toggle('open');
}

// Shared toggle HTML — call setViewMode(mode) must exist on the page
function getViewToggleHTML(activeMode) {
    const modes = [
        { key: 'enquiry',  icon: 'ph-list-dashes', label: 'Enquiry' },
        { key: 'material', icon: 'ph-cube',         label: 'Material' },
        { key: 'items',    icon: 'ph-rows',         label: 'Items' },
    ];
    return `<div class="view-toggle">
        ${modes.map(m => `<button class="view-toggle-btn${activeMode === m.key ? ' active' : ''}" onclick="setViewMode('${m.key}')">
            <i class="ph ${m.icon}"></i> ${escapeHtml(m.label)}
        </button>`).join('')}
    </div>`;
}

// Build a glassmorphic flat table from headers + row HTML strings.
// metaText is shown in the top bar (e.g. "42 items").
function buildGlassTable(headers, rows, metaText = '') {
    if (!rows.length) return `<div class="card text-center" style="padding:2rem">
        <i class="ph ph-magnifying-glass" style="font-size:2rem;color:var(--text-muted);margin-bottom:0.75rem"></i>
        <p class="text-muted">No items match the current filters.</p></div>`;
    const ths = headers.map(h => `<th>${h}</th>`).join('');
    return `<div class="glass-table-wrap">
        ${metaText ? `<div class="glass-table-meta"><span>${metaText}</span></div>` : ''}
        <div style="overflow-x:auto">
        <table class="glass-table">
            <thead><tr>${ths}</tr></thead>
            <tbody>${rows.join('')}</tbody>
        </table>
        </div>
    </div>`;
}

// ── Toast ────────────────────────────────────────────────────────────────────

// options.action = { label, onClick } adds a button to the notice (used for "Undo"); the notice then stays a little longer
function showToast(message, type = 'success', options = {}) {
    const icons = { success: 'ph-check-circle', error: 'ph-x-circle', info: 'ph-info', warning: 'ph-warning' };
    const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--primary)', warning: 'var(--warning-text)' };
    const kind = icons[type] ? type : 'info';
    // The message is plain text. It often contains something a person typed (a customer's name, a server message
    // quoting it), which must never be read as markup.
    const message_ = String(message);

    let stack = document.getElementById('toastStack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toastStack';
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
    }
    // the same notice twice in a row (a double click) is one notice
    Array.from(stack.children).forEach(t => { if (t.dataset.message === message_) t.remove(); });
    // never more than four at once: the oldest goes
    while (stack.children.length >= 4) stack.firstElementChild.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.dataset.message = message_;
    toast.style.setProperty('--toast-color', colors[kind]);
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');

    const icon = document.createElement('i');
    icon.className = `ph ${icons[kind]} toast-icon`;
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message_;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '<i class="ph ph-x"></i>';
    toast.append(icon, text);
    if (options.action) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'toast-action';
        action.textContent = options.action.label;
        action.addEventListener('click', () => { dismiss(); options.action.onClick(); });
        toast.append(action);
    }
    toast.append(close);
    stack.appendChild(toast);

    const dismiss = () => {
        clearTimeout(timer);
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 250);
    };
    // long messages get longer to read; problems stay longer than confirmations; hovering pauses the clock
    const readingTime = Math.min(12000, Math.max(options.action ? 9000 : kind === 'error' ? 7000 : 3500, 2500 + message_.length * 45));
    let timer = setTimeout(dismiss, readingTime);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 2500); });
    close.addEventListener('click', dismiss);
}
