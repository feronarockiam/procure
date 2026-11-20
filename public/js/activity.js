// Activity log: who did what, and when. The server decides who may open it (audit.view) and writes every sentence;
// this file only filters, draws and downloads.

const PAGE_SIZE = 50;
let nextBefore = null;
let loadSeq = 0;

const el = (id) => document.getElementById(id);

// A small icon per kind of event
function iconFor(action) {
    if (action.startsWith('auth.login_failed')) return { icon: 'ph-warning', warn: true };
    if (action.startsWith('auth.')) return { icon: 'ph-key', warn: false };
    if (action.startsWith('quotation.')) return { icon: 'ph-currency-inr', warn: false };
    if (action.startsWith('enquiry.') || action.startsWith('item') || action.startsWith('items.')) {
        return { icon: /deleted|unsuccessful/.test(action) ? 'ph-x-circle' : 'ph-clipboard-text', warn: /deleted|unsuccessful/.test(action) };
    }
    if (action.startsWith('user.') || action.startsWith('role.')) return { icon: 'ph-shield-check', warn: /deleted|deactivated/.test(action) };
    if (action.startsWith('customer.') || action.startsWith('vendor.') || action.startsWith('material.')) {
        return { icon: 'ph-database', warn: /deleted/.test(action) };
    }
    return { icon: 'ph-circle', warn: false };
}

function dayHeading(value) {
    const date = new Date(value);
    const today = new Date();
    const same = (a, b) => a.toDateString() === b.toDateString();
    const yesterday = new Date(today.getTime() - 86400000);
    if (same(date, today)) return 'Today';
    if (same(date, yesterday)) return 'Yesterday';
    return date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function query(extra = {}) {
    const params = new URLSearchParams();
    const set = (key, value) => { if (value) params.set(key, value); };
    set('q', el('fQ').value.trim());
    set('type', el('fType').value);
    set('actor', el('fActor').value);
    set('from', el('fFrom').value);
    set('to', el('fTo').value);
    for (const [k, v] of Object.entries(extra)) set(k, v);
    return params.toString();
}

function rowHtml(event) {
    const { icon, warn } = iconFor(event.action || '');
    const who = event.actor && event.actor.name ? event.actor.name : 'Someone';
    const role = event.actor && event.actor.role ? ` · ${escapeHtml(event.actor.role)}` : '';
    return `
        <li class="act-row">
            <span class="act-icon ${warn ? 'warn' : ''}" aria-hidden="true"><i class="ph ${icon}"></i></span>
            <div class="act-text">${escapeHtml(event.summary || event.action)}<small>${escapeHtml(who)}${role}</small></div>
            <time class="act-time" datetime="${new Date(event.at).toISOString()}" title="${escapeHtml(fullDateTime(event.at))}">${escapeHtml(relativeTime(event.at))}</time>
        </li>`;
}

function draw(events, append) {
    const body = el('actBody');
    if (!append) body.innerHTML = '';
    if (!events.length && !append) {
        const filtered = !!query();
        body.innerHTML = `<div class="empty-state"><i class="ph ph-clock-counter-clockwise"></i>
            <b>${filtered ? 'Nothing matches those filters' : 'No activity yet'}</b>
            <p>${filtered ? 'Try a wider date range or clear the search.' : 'As people work in the app, what they do will appear here.'}</p></div>`;
        return;
    }
    // group by day; keep appending to the last day's list when a page continues it
    let lastDay = append ? body.dataset.lastDay : null;
    let list = append ? body.querySelector('ul.act-list:last-of-type') : null;
    for (const event of events) {
        const day = dayHeading(event.at);
        if (day !== lastDay) {
            const heading = document.createElement('div');
            heading.className = 'act-day';
            heading.textContent = day;
            list = document.createElement('ul');
            list.className = 'act-list';
            body.append(heading, list);
            lastDay = day;
        }
        list.insertAdjacentHTML('beforeend', rowHtml(event));
    }
    body.dataset.lastDay = lastDay || '';
}

async function load(append = false) {
    const seq = ++loadSeq;
    if (!append) { nextBefore = null; el('actBody').innerHTML = skeletonHtml(6); }
    el('moreBtn').disabled = true;
    try {
        const data = await apiCall(`/audit?${query({ limit: PAGE_SIZE, before: append ? nextBefore : '' })}`, { silent: true });
        if (seq !== loadSeq || !data) return; // a newer search has already replaced this one
        draw(data.events, append);
        nextBefore = data.nextBefore;
        el('actMore').style.display = nextBefore ? '' : 'none';
    } catch (error) {
        if (seq !== loadSeq) return;
        showLoadError(el('actBody'), error.message, () => load(false));
        el('actMore').style.display = 'none';
    } finally {
        el('moreBtn').disabled = false;
    }
}

// ── Download ─────────────────────────────────────────────────────────────────

async function exportCsv() {
    const button = el('exportBtn');
    button.disabled = true;
    try {
        const rows = [];
        let before = '';
        for (let page = 0; page < 25; page++) { // up to 5,000 rows
            const data = await apiCall(`/audit?${query({ limit: 200, before })}`, { silent: true });
            rows.push(...data.events);
            if (!data.nextBefore) break;
            before = data.nextBefore;
        }
        downloadCsv('activity-log', ['When', 'Who', 'Role', 'What happened'], rows.map(e => [fullDateTime(e.at), e.actor && e.actor.name, e.actor && e.actor.role, e.summary]));
        showToast(rows.length ? `Downloaded ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}` : 'Nothing to download for these filters', rows.length ? 'success' : 'error');
    } catch (error) {
        showToast(error.message || 'Could not download the log', 'error');
    } finally {
        button.disabled = false;
    }
}

// ── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    if (!checkAuth()) return;
    if (!requirePageAccess('/activity.html')) return;
    initSidebar();

    try {
        const people = await apiCall('/audit/people', { silent: true });
        el('fActor').insertAdjacentHTML('beforeend', people.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join(''));
    } catch (_) { /* the filter just stays on "Anyone" */ }

    const reload = debounce(() => load(false), 250);
    ['fQ'].forEach(id => el(id).addEventListener('input', reload));
    ['fType', 'fActor', 'fFrom', 'fTo'].forEach(id => el(id).addEventListener('change', () => load(false)));
    el('clearBtn').addEventListener('click', () => { el('filters').reset(); load(false); });
    el('moreBtn').addEventListener('click', () => load(true));
    el('exportBtn').addEventListener('click', exportCsv);
    load(false);
});
