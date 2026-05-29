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

    const isAdmin = typeof hasPermission === 'function' && hasPermission('dashboard.admin');

    const adminNav = document.getElementById('adminNav');
    const roleNav  = document.getElementById('roleNav');

    if (adminNav && roleNav) {
        // ── Dual-nav pages (sales, sourcing, key-accounts, masters) ─
        if (isAdmin) {
            _setNavDisplay(adminNav, true);
            _setNavDisplay(roleNav, false);
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
            // Non-admin: hide sidebar entirely, expand content, show compact top bar
            const sidebar = document.getElementById('sidebar');
            const mainContent = document.querySelector('.main-content');
            if (sidebar) sidebar.style.display = 'none';
            if (mainContent) { mainContent.style.marginLeft = '0'; mainContent.style.width = '100%'; }

            const topNav = document.getElementById('roleTopNav');
            if (topNav) {
                topNav.style.display = 'flex';
                const tnName = document.getElementById('topNavUserName');
                const tnRole = document.getElementById('topNavUserRole');
                if (tnName) tnName.textContent = user.name || '';
                if (tnRole) tnRole.textContent = user.roleName || user.role || '';
            }
        }
        return;
    }

    // ── Legacy single-nav fallback ───────────────────────────────────
    const setVisible = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? 'flex' : 'none'; };
    const setBlock   = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? 'block' : 'none'; };
    setVisible('sidebarAdminLink', isAdmin);
    setBlock('sidebarAdminDivider', isAdmin);
    const canSales    = hasAnyPermission(['enquiry.create', 'enquiry.view.own', 'sales_price.add', 'sales_price.approve', 'enquiry.assign', 'enquiry.combine', 'enquiry.bulk_create', 'enquiry.mark_unsuccessful', 'quotation.send', 'quotation.download']);
    const canSourcing = hasAnyPermission(['purchase_price.add', 'enquiry.view.assigned']);
    const canKam      = hasPermission('enquiry.view.assigned_customers');
    setVisible('sidebarSalesLink', canSales);
    setVisible('sidebarSourcingLink', canSourcing);
    setVisible('sidebarKamLink', canKam);
    setBlock('sidebarPipelineSection', canSales || canSourcing || canKam);
    const canMaterials = hasPermission('material.view');
    const canCustomers = hasPermission('customer.view');
    const canVendors   = hasPermission('vendor.view');
    const canEmployees = hasPermission('user.view');
    setVisible('sidebarMaterialsLink', canMaterials);
    setVisible('sidebarCustomersLink', canCustomers);
    setVisible('sidebarVendorsLink', canVendors);
    setVisible('sidebarEmployeesLink', canEmployees);
    setBlock('sidebarMasterSection', canMaterials || canCustomers || canVendors || canEmployees);
}

function _applyRoleNav() {
    const setVisible = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? 'flex' : 'none'; };
    const setBlock   = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? 'block' : 'none'; };

    // Strict page-specific conditions — enquiry.view.all does NOT grant sidebar links
    const canSales    = hasAnyPermission(['enquiry.create', 'enquiry.view.own', 'sales_price.add', 'sales_price.approve', 'enquiry.assign', 'enquiry.combine', 'enquiry.bulk_create', 'enquiry.mark_unsuccessful', 'quotation.send', 'quotation.download']);
    const canSourcing = hasAnyPermission(['purchase_price.add', 'enquiry.view.assigned']);
    const canKam      = hasPermission('enquiry.view.assigned_customers');

    setVisible('sidebarSalesLink', canSales);
    setVisible('sidebarSourcingLink', canSourcing);
    setVisible('sidebarKamLink', canKam);
    setBlock('sidebarPipelineSection', canSales || canSourcing || canKam);

    const canMaterials = hasPermission('material.view');
    const canCustomers = hasPermission('customer.view');
    const canVendors   = hasPermission('vendor.view');
    const canEmployees = hasPermission('user.view');
    setVisible('sidebarMaterialsLink', canMaterials);
    setVisible('sidebarCustomersLink', canCustomers);
    setVisible('sidebarVendorsLink', canVendors);
    setVisible('sidebarEmployeesLink', canEmployees);
    setBlock('sidebarMasterSection', canMaterials || canCustomers || canVendors || canEmployees);
}

function updateGreeting() {
    const user = getUser();
    if (!user) return;

    // Update Name
    const nameElements = document.querySelectorAll('#userName');
    nameElements.forEach(el => {
        el.textContent = user.name.split(' ')[0]; // First name only for friendlier look
    });

    // Determine Time of Day
    const hour = new Date().getHours();
    let timeGreeting = 'Good Morning';
    let icon = '☀️';

    if (hour >= 12 && hour < 17) {
        timeGreeting = 'Good Afternoon';
        icon = '🌤️';
    } else if (hour >= 17) {
        timeGreeting = 'Good Evening';
        icon = '🌙';
    }

    // Update Greeting Text
    const greetingTitle = document.getElementById('dynamicGreeting');
    if (greetingTitle) {
        greetingTitle.innerHTML = `${timeGreeting}, <span class="greeting-highlight">${user.name.split(' ')[0]}</span> ${icon}`;
    }

    // Contextual Subtitles (Randomized for freshness)
    const subtitles = [
        "Ready to make some progress today?",
        "Everything is looking good on the dashboard.",
        "Let's get productive!",
        "Check your notifications for recent updates.",
        "Your dashboard is up to date."
    ];

    // Different subtitles based on role could be added here
    const subtitleEl = document.getElementById('greetingSubtitle');
    if (subtitleEl) {
        // Pick a random subtitle for variety
        const randomSubtitle = subtitles[Math.floor(Math.random() * subtitles.length)];
        subtitleEl.textContent = randomSubtitle;
    }
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
