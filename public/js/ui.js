// Shared interface pieces, so every screen asks, warns and fails in the same way.
//   showDialog / confirmDialog  one in-app window instead of the browser's own pop-ups (which look different on every
//                               computer, can't be styled, and block the whole tab)
//   showLoadError               "couldn't load this" with a Try again button, instead of a spinner that never stops
//   Escape closes the top-most window; icon-only buttons and windows get names for screen readers

// ── Dialogs ──────────────────────────────────────────────────────────────────

let dialogState = null; // { onDismiss, opener }

function ensureDialogElement() {
    let modal = document.getElementById('dialogModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'dialogModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'dialogTitle');
    modal.innerHTML = `
        <div class="modal-content" style="max-width:30rem">
            <div class="modal-header">
                <h3 class="modal-title" id="dialogTitle"></h3>
                <button type="button" class="modal-close" id="dialogCloseBtn" aria-label="Close"><i class="ph ph-x"></i></button>
            </div>
            <div class="modal-body" id="dialogBody"></div>
            <div class="modal-footer" id="dialogButtons"></div>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#dialogCloseBtn').addEventListener('click', () => closeDialog());
    return modal;
}

// buttons: [{ label, kind: 'primary' | 'secondary' | 'danger', onClick, focus }]. A button closes the window, then runs onClick.
// onDismiss runs when the window is closed some other way (Escape, the X).
function showDialog({ title, bodyHtml, buttons = [{ label: 'OK', kind: 'primary' }], onDismiss = null }) {
    const modal = ensureDialogElement();
    modal.querySelector('#dialogTitle').textContent = title;
    modal.querySelector('#dialogBody').innerHTML = bodyHtml;
    const bar = modal.querySelector('#dialogButtons');
    bar.innerHTML = '';
    let toFocus = null;
    for (const b of buttons) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `btn btn-${b.kind || 'secondary'}`;
        el.textContent = b.label;
        el.addEventListener('click', () => { closeDialog(true); if (b.onClick) b.onClick(); });
        bar.appendChild(el);
        if (b.focus || (!toFocus && b.kind === 'primary')) toFocus = el;
    }
    dialogState = { onDismiss, opener: document.activeElement };
    modal.classList.add('active');
    setTimeout(() => (toFocus || bar.lastElementChild || modal.querySelector('#dialogCloseBtn')).focus(), 30);
}

function closeDialog(byButton = false) {
    const modal = document.getElementById('dialogModal');
    if (!modal || !modal.classList.contains('active')) return;
    modal.classList.remove('active');
    const state = dialogState;
    dialogState = null;
    if (state && state.opener && typeof state.opener.focus === 'function' && document.body.contains(state.opener)) state.opener.focus();
    if (!byButton && state && state.onDismiss) state.onDismiss();
}

// Asks a yes/no question. Resolves true on the confirm button, false on Cancel, Escape or the X.
// For something that can't be undone, pass danger: true (the safe button gets the keyboard focus).
function confirmDialog({ title, message = '', messageHtml = null, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
    return new Promise(resolve => {
        showDialog({
            title,
            bodyHtml: messageHtml || `<p style="line-height:1.55;margin:0">${escapeHtml(message)}</p>`,
            buttons: [
                { label: cancelLabel, kind: 'secondary', onClick: () => resolve(false), focus: danger },
                { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => resolve(true), focus: !danger },
            ],
            onDismiss: () => resolve(false),
        });
    });
}

// ── Loading ──────────────────────────────────────────────────────────────────

// The outline of a few list rows, shown while the real ones load
function skeletonHtml(rows = 5) {
    const row = `
        <div class="skeleton-card" aria-hidden="true">
            <div><div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-line tall"></div></div>
            <div><div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-line tall"></div></div>
            <div><div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-line tall"></div></div>
            <div><div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-line tall"></div></div>
        </div>`;
    return `<div role="status" aria-label="Loading">${row.repeat(rows)}</div>`;
}
// containers marked data-skeleton="N" start out showing N placeholder rows (the page's own code replaces them with the data)
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-skeleton]').forEach(el => { el.innerHTML = skeletonHtml(Number(el.dataset.skeleton) || 5); });
});

// ── A list that could not be loaded ──────────────────────────────────────────

function showLoadError(container, message, retry) {
    if (!container) return;
    container.innerHTML = `
        <div class="load-error" role="alert">
            <i class="ph ph-cloud-slash"></i>
            <b>We couldn't load this</b>
            <p>${escapeHtml(message || 'Something went wrong while loading. Check your connection and try again.')}</p>
            <button type="button" class="btn btn-primary btn-sm"><i class="ph ph-arrows-clockwise"></i> Try again</button>
        </div>`;
    container.querySelector('button').addEventListener('click', () => {
        container.innerHTML = skeletonHtml(4);
        retry();
    });
}

// ── Keyboard and screen readers ──────────────────────────────────────────────

// Escape closes the top-most open window using that window's own close button, so any clean-up it does still happens
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const dialog = document.getElementById('dialogModal');
    if (dialog && dialog.classList.contains('active')) { closeDialog(); return; }
    const open = Array.from(document.querySelectorAll('.modal.active')).pop();
    if (!open) return;
    const closer = open.querySelector('.modal-close, [data-close-modal]')
        || Array.from(open.querySelectorAll('button')).find(b => /close|cancel/i.test(b.getAttribute('onclick') || ''));
    if (closer) closer.click(); else open.classList.remove('active');
});

// Enter or Space presses a box made keyboard-usable above
document.addEventListener('keydown', (event) => {
    if ((event.key !== 'Enter' && event.key !== ' ') || event.defaultPrevented) return;
    const box = event.target;
    if (box && box.getAttribute && box.getAttribute('role') === 'button' && box.hasAttribute('onclick') && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(box.tagName)) {
        event.preventDefault();
        box.click();
    }
});

let labelTimer = null;
function labelForAssistiveTech() {
    // buttons that show only an icon are named from their tooltip
    document.querySelectorAll('button:not([aria-label])').forEach(button => {
        if (!button.textContent.trim() && button.title) button.setAttribute('aria-label', button.title);
    });
    document.querySelectorAll('button.toggle-btn[onclick*="toggleSidebar"]:not([aria-label])').forEach(button => {
        button.setAttribute('aria-label', 'Collapse or expand the menu');
        button.title = 'Collapse or expand the menu';
    });
    // clickable boxes that aren't buttons (filter chips, option rows) become reachable and usable from the keyboard
    document.querySelectorAll('[onclick]:not(button):not(a):not(input):not(select):not([role]):not([tabindex])').forEach(box => {
        if (box.querySelector('button, a, input, select, textarea')) return; // a container with real controls inside stays as it is
        box.setAttribute('role', 'button');
        box.setAttribute('tabindex', '0');
    });
    // a small button that shows words gets them as its tooltip too (when the screen is narrow the words give way to the icon)
    document.querySelectorAll('.btn-sm:not([title])').forEach(button => {
        const words = button.textContent.trim();
        if (words) button.title = words;
    });
    // every window announces itself as one, named by its title
    document.querySelectorAll('.modal').forEach(modal => {
        if (modal.hasAttribute('role')) return;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        const title = modal.querySelector('.modal-title');
        if (title) {
            if (!title.id) title.id = `mt_${Math.random().toString(36).slice(2, 9)}`;
            modal.setAttribute('aria-labelledby', title.id);
        }
    });
}
document.addEventListener('DOMContentLoaded', () => {
    labelForAssistiveTech();
    // lists are redrawn all the time; label whatever appears (once per burst of changes)
    new MutationObserver(() => { clearTimeout(labelTimer); labelTimer = setTimeout(labelForAssistiveTech, 150); })
        .observe(document.body, { childList: true, subtree: true });
});

// ── Times ────────────────────────────────────────────────────────────────────

// "just now", "5 min ago", "yesterday"… older than a week shows the date. The full date and time is the tooltip.
function relativeTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    const seconds = Math.round((Date.now() - date.getTime()) / 1000);
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
function fullDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// What has happened on one enquiry, newest first (GET /enquiries/:id/history)
async function showEnquiryHistory(enquiryId, enquiryNumber) {
    showDialog({ title: `History · ${enquiryNumber || 'Enquiry'}`, bodyHtml: skeletonHtml(3), buttons: [{ label: 'Close', kind: 'primary' }] });
    const body = document.getElementById('dialogBody');
    try {
        const data = await apiCall(`/enquiries/${enquiryId}/history`, { silent: true });
        const events = Array.isArray(data) ? data : [];
        body.innerHTML = events.length
            ? `<ul style="list-style:none;margin:0;padding:0;max-height:60vh;overflow-y:auto">${events.map(e => `
                <li style="padding:0.6rem 0;border-bottom:1px solid var(--border-light);font-size:0.88rem;line-height:1.45">
                    ${escapeHtml(e.summary)}
                    <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.15rem">
                        ${escapeHtml((e.actor && e.actor.name) || 'Someone')} · <time title="${escapeHtml(fullDateTime(e.at))}">${escapeHtml(relativeTime(e.at))}</time>
                    </div>
                </li>`).join('')}</ul>`
            : '<p class="text-muted" style="margin:0">Nothing has been recorded for this enquiry yet.</p>';
    } catch (error) {
        body.innerHTML = `<p style="margin:0;color:var(--danger)">${escapeHtml(error.message || "Couldn't load the history")}</p>`;
    }
}

// ── Download a list as a spreadsheet file ────────────────────────────────────

// A cell that starts with = + - @ would be run as a formula by Excel, so it gets a leading apostrophe
function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

// headers: ['Name', ...]; rows: [[...], ...]. The file opens in Excel with accents and rupee signs intact (UTF-8 with a BOM).
function downloadCsv(filename, headers, rows) {
    const lines = [headers.map(csvCell).join(','), ...rows.map(row => row.map(csvCell).join(','))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ── A friendly hello at the top of the main screens ──────────────────────────

// "Good morning, Sara" with the time of day on the person's own clock. `summary` is the second half (what is waiting for them).
// Drawn with text nodes only: a name is whatever someone typed.
function renderGreeting(summary = '') {
    const host = document.getElementById('greetingSubtitle');
    const user = typeof getUser === 'function' ? getUser() : null;
    if (!host || !user) return;
    const hour = new Date().getHours();
    const [hello, icon] = hour < 5 ? ['Working late', '🌙'] : hour < 12 ? ['Good morning', '☀️'] : hour < 17 ? ['Good afternoon', '🌤️'] : hour < 22 ? ['Good evening', '🌆'] : ['Good evening', '🌙'];
    const first = String(user.name || '').trim().split(/\s+/)[0] || 'there';
    host.className = 'page-greeting';
    host.textContent = '';
    const hi = document.createElement('span');
    hi.className = 'hello';
    hi.textContent = `${hello}, ${first} ${icon}`;
    host.append(hi);
    if (summary) {
        const rest = document.createElement('span');
        rest.className = 'hello-sub';
        rest.textContent = summary;
        host.append(rest);
    }
}

document.addEventListener('DOMContentLoaded', () => renderGreeting());

// ── "Something is happening": a thin bar across the top as soon as a link is followed ──
// Moving between screens loads a whole page, which looks like nothing happened for a moment. The bar (and a gentle fade) says it did.
(function () {
    let bar = null;
    const start = () => {
        if (!bar) { bar = document.createElement('div'); bar.className = 'nav-progress'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Loading'); document.body.appendChild(bar); }
        bar.classList.remove('done'); void bar.offsetWidth; bar.classList.add('running');
        document.body.classList.add('is-leaving');
    };
    const stop = () => { document.body.classList.remove('is-leaving'); if (bar) { bar.classList.remove('running'); bar.classList.add('done'); } };
    document.addEventListener('click', (event) => {
        const link = event.target.closest && event.target.closest('a[href]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (link.target && link.target !== '_self') return;
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search) || link.hasAttribute('download')) return;
        start();
    });
    window.addEventListener('pageshow', stop); // coming back with the Back button shows the page from memory
})();


// ── Units of measure ─────────────────────────────────────────────────────────

// Fill a <datalist> with the units people already use (first, so "Mtr" is picked again rather than a new "Meters"),
// then the common ones. The box stays free text, so an unusual unit can still be typed.
const COMMON_UOMS = ['Nos', 'Pcs', 'Set', 'Pair', 'Kg', 'Tons', 'Mtr', 'Ft', 'Ltr', 'Bags', 'Box', 'Roll', 'Coil', 'Sq.Mtr', 'Cu.Mtr', 'Lot'];
function fillUomSuggestions(datalistId, products) {
    const list = document.getElementById(datalistId);
    if (!list) return;
    const seen = new Map();
    for (const p of products || []) {
        const uom = (p && p.uom || '').trim();
        if (uom) seen.set(uom.toLowerCase(), uom);
    }
    const inUse = [...seen.values()].sort((a, b) => a.localeCompare(b));
    const extra = COMMON_UOMS.filter(u => !seen.has(u.toLowerCase()));
    list.innerHTML = [...inUse, ...extra].map(u => `<option value="${escapeHtml(u)}"></option>`).join('');
}

// ── Tables on phones ─────────────────────────────────────────────────────────

// On a phone each table row becomes a small card, and every value is labelled with its column heading (CSS reads it
// from data-label). Screens draw their rows in many places, so the labels are added here, whenever rows appear.
(function labelResponsiveTables() {
    const label = () => {
        document.querySelectorAll('.table-responsive table').forEach(table => {
            const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
            if (!heads.length) return;
            table.querySelectorAll('tbody tr').forEach(row => {
                const cells = row.children;
                if (cells.length !== heads.length) return; // "nothing found" rows span the whole table
                for (let i = 0; i < cells.length; i++) {
                    if (!cells[i].hasAttribute('data-label')) cells[i].setAttribute('data-label', heads[i]);
                }
            });
        });
    };
    let queued = false;
    const schedule = () => { if (!queued) { queued = true; setTimeout(() => { queued = false; label(); }, 50); } };
    document.addEventListener('DOMContentLoaded', () => {
        label();
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    });
})();
