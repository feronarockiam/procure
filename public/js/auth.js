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
    return getUser();
}

// Redirect to the user's assigned dashboard page after login
function redirectToDashboard(dashboardPage) {
    if (dashboardPage) {
        window.location.href = '/' + dashboardPage;
        return;
    }
    // Legacy fallback for tokens issued before dynamic roles
    const user = getUser();
    const legacyRole = user && user.role;
    if (legacyRole === 'admin') window.location.href = '/admin.html';
    else if (legacyRole === 'sourcing') window.location.href = '/sourcing.html';
    else window.location.href = '/sales.html';
}

// ── API Helper ───────────────────────────────────────────────────────────────

async function apiCall(endpoint, options = {}) {
    const token = getToken();

    const mergedOptions = {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
            ...options.headers,
        },
    };

    try {
        const response = await fetch(`${API_URL}${endpoint}`, mergedOptions);

        if (response.status === 401) {
            showToast('Session expired — please log in again', 'error');
            setTimeout(() => { removeToken(); window.location.href = '/'; }, 1500);
            return null;
        }

        if (response.status === 403) {
            showToast('You do not have permission to perform this action', 'error');
            return null;
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
            throw new Error(data.error || 'Request failed');
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
function getRoleBadge(roleName, roleColor) {
    const color = roleColor || '#3B9FD9';
    const bg = color + '22'; // 13% opacity hex
    return `<span class="badge" style="background:${bg};color:${color};border:1px solid ${color}44">${roleName}</span>`;
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
            <i class="ph ${m.icon}"></i> ${m.label}
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

function showToast(message, type = 'success') {
    const existing = document.querySelectorAll('.toast-notification');
    existing.forEach(t => t.remove());

    const icons = { success: 'ph-check-circle', error: 'ph-x-circle', info: 'ph-info', warning: 'ph-warning' };
    const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--primary)', warning: 'var(--warning)' };

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = `<i class="ph ${icons[type] || icons.info}" style="font-size:1.1rem;color:${colors[type] || colors.info};flex-shrink:0"></i><span>${message}</span>`;
    toast.style.cssText = `
        position:fixed;top:1.5rem;right:1.5rem;
        display:flex;align-items:center;gap:0.6rem;
        background:rgba(255,255,255,0.95);
        backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
        border:1px solid rgba(255,255,255,0.6);
        color:var(--text-primary);padding:0.85rem 1.25rem;
        border-radius:0.75rem;box-shadow:0 8px 32px rgba(0,0,0,0.12),0 2px 8px rgba(0,0,0,0.06);
        z-index:10000;font-size:0.875rem;font-weight:500;
        max-width:360px;animation:toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
        border-left:3px solid ${colors[type] || colors.info};
    `;
    document.body.appendChild(toast);

    // Inject keyframes once
    if (!document.getElementById('toast-keyframes')) {
        const style = document.createElement('style');
        style.id = 'toast-keyframes';
        style.textContent = `
            @keyframes toastIn{from{opacity:0;transform:translateX(1rem) scale(0.95)}to{opacity:1;transform:translateX(0) scale(1)}}
            @keyframes toastOut{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(1rem)}}
        `;
        document.head.appendChild(style);
    }

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.25s ease-in forwards';
        setTimeout(() => toast.remove(), 250);
    }, 3500);
}
