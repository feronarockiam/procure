/**
 * layout.js - Shared layout functions: sidebar, greeting, header scroll.
 */

document.addEventListener('DOMContentLoaded', () => {
    updateGreeting();
    setupHeaderScroll();
    initSidebar();
});

// ── Sidebar ───────────────────────────────────────────────────────────────────

function _setNavDisplay(el, visible) {
    if (!el) return;
    if (visible) {
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.gap = '0.5rem';
    } else {
        el.style.display = 'none';
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
}

// Names and icons for the menu. WHICH links a person gets comes from the server (user.links), never from here.
const NAV_META = {
    '/admin.html': { label: 'Dashboard', icon: 'ph-house' },
    '/sales.html': { label: 'Sales & Enquiries', icon: 'ph-shopping-cart-simple' },
    '/sourcing.html': { label: 'Sourcing / Purchase', icon: 'ph-package' },
    '/key-accounts.html': { label: 'Key Accounts', icon: 'ph-handshake' },
    '/masters.html?type=materials': { label: 'Materials', icon: 'ph-cube' },
    '/masters.html?type=customers': { label: 'Customers', icon: 'ph-user-circle' },
    '/masters.html?type=vendors': { label: 'Vendors', icon: 'ph-storefront' },
    '/masters.html?type=employees': { label: 'Employees', icon: 'ph-users' },
    '/role-management.html': { label: 'Roles & Access', icon: 'ph-shield-check' },
    '/activity.html': { label: 'Activity log', icon: 'ph-clock-counter-clockwise' },
    '/analytics.html': { label: 'Reports', icon: 'ph-chart-line-up' },
};

// Some links aren't written into every page: they are added to whichever menu someone has, if their role includes them
function ensureExtraLink(container, href, label, icon, placeAfter) {
    if (!container || container.querySelector(`a[href="${href}"]`) || !canOpenHref(href)) return;
    const anchor = container.querySelector(`a[href="${placeAfter}"]`);
    const link = document.createElement('a');
    link.href = href;
    link.className = 'nav-item' + (window.location.pathname === href ? ' active' : '');
    link.innerHTML = `<i class="ph ${icon}"></i><span>${label}</span>`;
    if (anchor) anchor.after(link); else container.appendChild(link);
}
function ensureActivityLink(container) {
    ensureExtraLink(container, '/analytics.html', 'Reports', 'ph-chart-line-up', '/admin.html');
    ensureExtraLink(container, '/activity.html', 'Activity log', 'ph-clock-counter-clockwise', '/role-management.html');
}

// ── My account: who I am, when I last signed in, change my password ─────────
function openAccountDialog(error = '') {
    const user = getUser();
    if (!user) return;
    const last = user.lastLoginAt ? `${escapeHtml(fullDateTime(user.lastLoginAt))} (${escapeHtml(relativeTime(user.lastLoginAt))})` : 'This is your first time signing in';
    showDialog({
        title: 'My account',
        bodyHtml: `
            <p style="margin:0 0 0.9rem;line-height:1.6">
                <b>${escapeHtml(user.name || '')}</b><br>
                <span class="text-muted">${escapeHtml(user.email || '')}</span><br>
                <span class="text-muted">${escapeHtml(user.roleName || user.role || '')}</span>
            </p>
            <p style="margin:0;font-size:0.8rem" class="text-muted">Previous sign-in: ${last}</p>`,
        buttons: [
            { label: 'Change my password', kind: 'secondary', onClick: () => openPasswordDialog() },
            { label: 'Sign out', kind: 'danger', onClick: () => logout() },
            { label: 'Close', kind: 'primary' },
        ],
    });
}

function openPasswordDialog(error = '') {
    showDialog({
        title: 'Change my password',
        bodyHtml: `
            ${error ? `<div role="alert" style="background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:0.5rem;padding:0.6rem 0.8rem;font-size:0.85rem;margin-bottom:0.8rem">${escapeHtml(error)}</div>` : ''}
            <div class="form-group"><label for="pwCurrent">Current password</label><input type="password" id="pwCurrent" class="form-control" autocomplete="current-password"></div>
            <div class="form-group"><label for="pwNew">New password</label><input type="password" id="pwNew" class="form-control" autocomplete="new-password"></div>
            <div class="form-group" style="margin-bottom:0"><label for="pwNew2">New password again</label><input type="password" id="pwNew2" class="form-control" autocomplete="new-password"></div>`,
        buttons: [
            { label: 'Cancel', kind: 'secondary' },
            {
                label: 'Save new password', kind: 'primary',
                onClick: async () => {
                    const current = document.getElementById('pwCurrent').value;
                    const next = document.getElementById('pwNew').value;
                    const again = document.getElementById('pwNew2').value;
                    if (next !== again) return openPasswordDialog('The two new passwords are not the same');
                    try {
                        const done = await apiCall('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
                        if (done && done.token) saveToken(done.token); // the old one stopped working when the password changed
                        showToast('Your password has been changed');
                    } catch (err) {
                        openPasswordDialog(err.message || 'Could not change the password');
                    }
                },
            },
        ],
    });
    setTimeout(() => { const input = document.getElementById('pwCurrent'); if (input) input.focus(); }, 60);
}

// the name block in the menu footer / top bar opens "My account"
function wireAccountMenu() {
    for (const id of ['navUserName', 'topNavUserName']) {
        const name = document.getElementById(id);
        const block = name && name.parentElement;
        if (!block || block.dataset.account) continue;
        block.dataset.account = '1';
        block.style.cursor = 'pointer';
        block.setAttribute('role', 'button');
        block.setAttribute('tabindex', '0');
        block.setAttribute('aria-label', 'My account');
        block.title = 'My account';
        block.addEventListener('click', () => openAccountDialog());
        block.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAccountDialog(); } });
    }
}

// Hide the menu links this person's role doesn't include, then hide any heading or divider left with nothing under it.
function pruneNav(container) {
    if (!container) return;
    const allowed = (link) => canOpenHref(link.getAttribute('href'));
    const linksIn = (el) => (el.matches('a.nav-item') ? [el] : Array.from(el.querySelectorAll('a.nav-item')));

    // 1. each link is shown or hidden on its own
    container.querySelectorAll('a.nav-item[href]').forEach(link => { link.style.display = allowed(link) ? '' : 'none'; });

    // 2. the menu is made of groups separated by thin divider lines. A group with no visible link goes away,
    //    heading and divider included, and the first visible group never starts with a divider.
    const isDivider = (el) => el.tagName === 'DIV' && el.style.height === '1px';
    const groups = [{ divider: null, items: [] }];
    for (const el of Array.from(container.children)) {
        if (isDivider(el)) groups.push({ divider: el, items: [] });
        else groups[groups.length - 1].items.push(el);
    }
    let shownBefore = false;
    for (const group of groups) {
        const hasVisibleLink = group.items.some(el => linksIn(el).some(allowed));
        for (const el of group.items) {
            if (!el.matches('a.nav-item')) el.style.display = hasVisibleLink ? '' : 'none'; // headings and wrappers
        }
        if (group.divider) group.divider.style.display = hasVisibleLink && shownBefore ? '' : 'none';
        if (hasVisibleLink) shownBefore = true;
    }
}

// People who aren't admins get a slim top bar instead of the sidebar. With more than one screen they
// need a way to move between them, so the bar lists the screens their role includes.
function renderTopNavLinks(user) {
    const bar = document.getElementById('roleTopNav');
    if (!bar || document.getElementById('topNavLinks')) return;
    const links = (user.links || []).filter(href => NAV_META[href]);
    if (links.length < 2) return;

    if (!document.getElementById('topNavLinksStyle')) {
        const style = document.createElement('style');
        style.id = 'topNavLinksStyle';
        style.textContent = `
            #topNavLinks { display:flex; flex-wrap:wrap; gap:0.35rem; align-items:center; }
            #topNavLinks a { display:inline-flex; align-items:center; gap:0.4rem; padding:0.4rem 0.75rem; border-radius:999px;
                font-size:0.8rem; font-weight:500; color:var(--text-secondary); text-decoration:none; border:1px solid transparent; }
            #topNavLinks a:hover { background:rgba(59,159,217,0.08); color:var(--primary); }
            #topNavLinks a.active { background:var(--primary-light, rgba(59,159,217,0.12)); color:var(--primary); border-color:rgba(59,159,217,0.3); font-weight:600; }
            /* Phones: brand and person on one line, the screens in one row underneath that scrolls sideways */
            @media (max-width: 900px) {
                #roleTopNav { flex-wrap:wrap; row-gap:0.5rem; padding:0.6rem 0.9rem !important; top:0.5rem !important; }
                #topNavLinks { order:3; width:100%; flex-wrap:nowrap; overflow-x:auto; scrollbar-width:none; -webkit-overflow-scrolling:touch; }
                #topNavLinks::-webkit-scrollbar { display:none; }
                #topNavLinks a { white-space:nowrap; flex-shrink:0; }
                #topNavUserRole { display:none; }
            }`;
        document.head.appendChild(style);
    }
    const here = currentHref();
    const nav = document.createElement('nav');
    nav.id = 'topNavLinks';
    nav.setAttribute('aria-label', 'Screens');
    nav.innerHTML = links.map(href => {
        const meta = NAV_META[href];
        return `<a href="${href}" class="${href === here ? 'active' : ''}"><i class="ph ${meta.icon}"></i><span>${escapeHtml(meta.label)}</span></a>`;
    }).join('');
    // between the brand (first child) and the user block (last child)
    bar.insertBefore(nav, bar.lastElementChild);
}

// Small screens: a button opens the side menu as a slide-out panel (people without the sidebar use the top bar)
function ensureMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || sidebar.style.display === 'none' || document.getElementById('mobileMenuBtn')) return;
    document.body.classList.add('has-mobile-menu');

    const overlay = document.createElement('div');
    overlay.className = 'mobile-nav-overlay';
    overlay.addEventListener('click', () => setMobileMenu(false));
    document.body.appendChild(overlay);

    const button = document.createElement('button');
    button.id = 'mobileMenuBtn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Open menu');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<i class="ph ph-list"></i>';
    button.addEventListener('click', () => setMobileMenu(!sidebar.classList.contains('mobile-open')));
    document.body.appendChild(button);

    // choosing a screen closes the menu; so does Escape
    sidebar.addEventListener('click', (event) => { if (event.target.closest('a.nav-item')) setMobileMenu(false); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setMobileMenu(false); });
}

function setMobileMenu(open) {
    const sidebar = document.getElementById('sidebar');
    const button = document.getElementById('mobileMenuBtn');
    const overlay = document.querySelector('.mobile-nav-overlay');
    if (!sidebar || !button) return;
    sidebar.classList.toggle('mobile-open', open);
    if (overlay) overlay.classList.toggle('active', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    button.innerHTML = `<i class="ph ${open ? 'ph-x' : 'ph-list'}"></i>`;
}

function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }

    const user = getUser();
    if (!user) return;

    const nameEl = document.getElementById('navUserName');
    if (nameEl) nameEl.textContent = user.name || 'User';
    const roleEl = document.getElementById('navUserRole');
    if (roleEl) roleEl.textContent = user.roleName || user.role || '';

    const adminNav = document.getElementById('adminNav');
    const roleNav  = document.getElementById('roleNav');
    wireAccountMenu();

    if (adminNav && roleNav) {
        // ── Pages with both menus (sales, sourcing, key-accounts, masters) ─
        const isAdmin = hasPermission('dashboard.admin');
        if (isAdmin) {
            _setNavDisplay(adminNav, true);
            _setNavDisplay(roleNav, false);
            ensureActivityLink(adminNav);
            pruneNav(adminNav);
            ensureMobileMenu();
            // Set active link for current page
            adminNav.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));
            const path   = window.location.pathname;
            const search = window.location.search;
            if (path === '/sales.html')         adminNav.querySelector('#adminNavSalesLink')?.classList.add('active');
            else if (path === '/sourcing.html')     adminNav.querySelector('#adminNavSourcingLink')?.classList.add('active');
            else if (path === '/key-accounts.html') adminNav.querySelector('#adminNavKamLink')?.classList.add('active');
            else if (path === '/masters.html') {
                const type = new URLSearchParams(search).get('type');
                if (type) adminNav.querySelector(`#adminNavMaster_${type}`)?.classList.add('active');
            }
        } else {
            // Everyone else: hide the sidebar, expand the content, show the slim top bar (with screen links if they have several)
            _setNavDisplay(adminNav, false);
            _setNavDisplay(roleNav, false);
            sidebar.style.display = 'none';
            const mainContent = document.querySelector('.main-content');
            if (mainContent) { mainContent.style.marginLeft = '0'; mainContent.style.width = '100%'; }

            const topNav = document.getElementById('roleTopNav');
            if (topNav) {
                topNav.style.display = 'flex';
                topNav.style.gap = '1rem';
                const tnName = document.getElementById('topNavUserName');
                const tnRole = document.getElementById('topNavUserRole');
                if (tnName) tnName.textContent = user.name || '';
                if (tnRole) tnRole.textContent = user.roleName || user.role || '';
                renderTopNavLinks(user);
            }
        }
        return;
    }

    // ── Pages with one fixed sidebar (admin dashboard, role management): show only what this role includes ─
    ensureActivityLink(sidebar.querySelector('.sidebar-nav'));
    pruneNav(sidebar.querySelector('.sidebar-nav'));
    ensureMobileMenu();
}

// The hello at the top of a screen is drawn by renderGreeting() (ui.js), and gets its second half from todo.js
function updateGreeting() {
    const user = getUser();
    if (!user) return;
    document.querySelectorAll('#userName').forEach(el => { el.textContent = String(user.name || '').split(' ')[0]; });
    if (typeof renderGreeting === 'function') renderGreeting();
}

function setupHeaderScroll() {
    const header = document.querySelector('.glass-header');
    if (!header) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 10) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });
}

/**
 * Mobile Navigation Functions
 */
function toggleMobileMenu() {
    const drawer = document.getElementById('mobileNavDrawer');
    const overlay = document.getElementById('mobileNavOverlay');

    if (!drawer || !overlay) return;

    const isActive = drawer.classList.contains('active');

    if (isActive) {
        // Close menu
        drawer.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    } else {
        // Open menu
        drawer.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scroll
    }
}

/**
 * Utility function to check if viewport is mobile
 */
function isMobile() {
    return window.innerWidth <= 768;
}

/**
 * Utility function to check if viewport is tablet
 */
function isTablet() {
    return window.innerWidth > 768 && window.innerWidth <= 1024;
}

// Close mobile menu on Esc key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const drawer = document.getElementById('mobileNavDrawer');
        if (drawer && drawer.classList.contains('active')) {
            toggleMobileMenu();
        }
    }
});

// Close mobile menu when resizing to desktop
window.addEventListener('resize', () => {
    const drawer = document.getElementById('mobileNavDrawer');
    if (drawer && drawer.classList.contains('active') && !isMobile()) {
        toggleMobileMenu();
    }
});
