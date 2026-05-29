// Role Management — client-side logic

let allRoles = [];
let permissionGroups = [];
let editingRoleId = null;

const BADGE_COLORS = [
    '#3B9FD9', // Blue (primary)
    '#10B981', // Emerald
    '#8B5CF6', // Violet
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#EC4899', // Pink
    '#14B8A6', // Teal
    '#6366F1', // Indigo
    '#D97706', // Orange
    '#64748B', // Slate
];

const CATEGORY_DASHBOARD_MAP = {
    admin:        'admin.html',
    sales:        'sales.html',
    purchase:     'sourcing.html',
    key_accounts: 'key-accounts.html',
};

const CATEGORY_ICONS = {
    admin:        'ph-shield-star',
    sales:        'ph-shopping-cart-simple',
    purchase:     'ph-package',
    key_accounts: 'ph-handshake',
};

// ── Initialize ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const user = checkAuth();
    if (!user) return;

    if (!hasPermission('role.view')) {
        showToast('You do not have permission to view roles', 'error');
        setTimeout(() => window.location.href = '/admin.html', 1500);
        return;
    }

    const navName = document.getElementById('navUserName');
    const navRole = document.getElementById('navUserRole');
    if (navName) navName.textContent = user.name || 'User';
    if (navRole) navRole.textContent = user.roleName || user.role || '';

    document.getElementById('infoBanner').style.display = 'flex';

    // Build colour swatches
    buildColorSwatches();

    await Promise.all([loadRoles(), loadPermissions()]);
});

// ── Data Loading ─────────────────────────────────────────────────────────────

async function loadRoles() {
    try {
        allRoles = await apiCall('/roles');
        renderRolesGrid();
    } catch (err) {
        showToast('Failed to load roles: ' + err.message, 'error');
    }
}

async function loadPermissions() {
    try {
        const data = await apiCall('/roles/permissions');
        permissionGroups = data.groups || [];
    } catch (err) {
        permissionGroups = [];
    }
}

// ── Render Cards ─────────────────────────────────────────────────────────────

function renderRolesGrid() {
    const grid = document.getElementById('rolesGrid');

    if (!allRoles || allRoles.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <i class="ph ph-shield-slash"></i>
                <p style="font-weight:600;margin-bottom:0.5rem">No roles yet</p>
                <p style="font-size:0.85rem">Create your first role to get started.</p>
            </div>`;
        return;
    }

    grid.innerHTML = allRoles.map(role => {
        const icon = CATEGORY_ICONS[role.category] || 'ph-circle';
        const canEdit = hasPermission('role.edit');
        const canDelete = hasPermission('role.delete') && !role.isSystem;

        return `
        <div class="role-card">
            <div class="role-card-accent" style="background:${role.color}"></div>
            <div class="role-card-header">
                <div>
                    <div class="role-name" style="display:flex;align-items:center;gap:0.5rem">
                        <i class="ph ${icon}" style="color:${role.color};font-size:1rem"></i>
                        ${role.name}
                    </div>
                    ${role.isSystem ? `<span class="system-badge"><i class="ph ph-lock-simple" style="font-size:0.7rem"></i> System</span>` : ''}
                </div>
                <span class="badge" style="background:${role.color}22;color:${role.color};border:1px solid ${role.color}44;font-size:0.7rem;white-space:nowrap">
                    ${formatCategory(role.category)}
                </span>
            </div>

            ${role.description ? `<div class="role-description">${role.description}</div>` : ''}

            <div class="role-meta">
                <span class="role-perm-count">
                    <i class="ph ph-check-circle" style="color:var(--success)"></i>
                    ${role.permissions ? role.permissions.length : 0} permissions
                </span>
                <span class="role-perm-count" style="margin-left:auto">
                    <i class="ph ph-arrow-square-out" style="color:var(--text-muted)"></i>
                    <span style="color:var(--text-muted)">${role.dashboardPage}</span>
                </span>
            </div>

            <div class="role-card-actions">
                ${canEdit ? `
                <button class="btn btn-secondary btn-sm" style="flex:1" onclick="openEditModal('${role._id}')">
                    <i class="ph ph-pencil-simple"></i> Edit
                </button>` : ''}
                ${canDelete ? `
                <button class="btn btn-danger btn-sm" onclick="deleteRole('${role._id}', '${role.name}')">
                    <i class="ph ph-trash"></i>
                </button>` : ''}
                ${!canEdit && !canDelete ? `<span class="text-muted" style="font-size:0.8rem">View only</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

function formatCategory(cat) {
    const map = { admin: 'Admin', sales: 'Sales', purchase: 'Purchase', key_accounts: 'Key Accounts' };
    return map[cat] || cat;
}

// ── Colour Swatches ──────────────────────────────────────────────────────────

function buildColorSwatches() {
    const container = document.getElementById('colorSwatches');
    container.innerHTML = BADGE_COLORS.map(color => `
        <div class="color-swatch ${color === '#3B9FD9' ? 'selected' : ''}"
             style="background:${color}"
             onclick="selectColor('${color}', this)"
             title="${color}">
        </div>
    `).join('');
}

function selectColor(color, el) {
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('roleColor').value = color;
}

// ── Modal: Open / Close ───────────────────────────────────────────────────────

function openCreateModal() {
    if (!hasPermission('role.create')) {
        showToast('You do not have permission to create roles', 'error');
        return;
    }
    editingRoleId = null;
    document.getElementById('modalTitle').textContent = 'Create New Role';
    resetForm();
    buildPermissionGroups([]);
    document.getElementById('roleModal').classList.add('active');
}

function openEditModal(roleId) {
    if (!hasPermission('role.edit')) {
        showToast('You do not have permission to edit roles', 'error');
        return;
    }
    const role = allRoles.find(r => r._id === roleId);
    if (!role) return;

    editingRoleId = roleId;
    document.getElementById('modalTitle').textContent = `Edit Role — ${role.name}`;

    document.getElementById('roleName').value = role.name;
    document.getElementById('roleDescription').value = role.description || '';
    document.getElementById('roleCategory').value = role.category;
    document.getElementById('roleDashboard').value = role.dashboardPage;
    document.getElementById('roleColor').value = role.color;

    // Highlight selected colour swatch
    document.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('selected', s.style.background === role.color ||
            s.getAttribute('onclick').includes(role.color));
    });

    buildPermissionGroups(role.permissions || []);
    document.getElementById('roleModal').classList.add('active');
}

function closeModal() {
    document.getElementById('roleModal').classList.remove('active');
    editingRoleId = null;
}

function resetForm() {
    document.getElementById('roleForm').reset();
    document.getElementById('roleColor').value = '#3B9FD9';
    buildColorSwatches(); // reset swatches
}

// ── Permission Groups UI ──────────────────────────────────────────────────────

function buildPermissionGroups(selectedPermissions) {
    const container = document.getElementById('permissionGroups');
    if (!permissionGroups.length) {
        container.innerHTML = '<p class="text-muted" style="font-size:0.85rem">Loading permissions…</p>';
        return;
    }

    container.innerHTML = permissionGroups.map((group, gi) => {
        const checkboxes = group.keys.map(key => {
            const checked = selectedPermissions.includes(key) ? 'checked' : '';
            const desc = window._permDescriptions && window._permDescriptions[key] ? window._permDescriptions[key] : '';
            const id = `perm_${key.replace(/\./g,'_')}`;
            return `
                <div class="perm-check">
                    <label for="${id}" style="display:flex;align-items:flex-start;gap:0.6rem;width:100%;cursor:pointer;margin:0">
                        <input type="checkbox" id="${id}" name="permissions" value="${key}" ${checked}
                            style="margin-top:2px;accent-color:var(--primary);width:15px;height:15px;flex-shrink:0;cursor:pointer">
                        <div>
                            <div class="perm-key">${key}</div>
                            ${desc ? `<div class="perm-desc">${desc}</div>` : ''}
                        </div>
                    </label>
                </div>`;
        }).join('');

        const checkedCount = group.keys.filter(k => selectedPermissions.includes(k)).length;

        return `
        <div class="permission-group">
            <div class="permission-group-header" onclick="toggleGroup('pgroup_${gi}')">
                <div class="group-title">
                    <i class="ph ph-folder" style="color:var(--primary)"></i>
                    ${group.group}
                    <span class="badge" style="background:var(--primary-light);color:var(--primary);font-size:0.7rem;padding:0.1rem 0.5rem">
                        ${checkedCount}/${group.keys.length}
                    </span>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem">
                    <button type="button" class="select-all-btn" onclick="event.stopPropagation();selectGroup('pgroup_${gi}', true)">All</button>
                    <button type="button" class="select-all-btn" onclick="event.stopPropagation();selectGroup('pgroup_${gi}', false)">None</button>
                    <i class="ph ph-caret-down" style="transition:transform 0.2s" id="caret_${gi}"></i>
                </div>
            </div>
            <div class="permission-group-body" id="pgroup_${gi}">
                ${checkboxes}
            </div>
        </div>`;
    }).join('');

    // Store descriptions for rendering
    apiCall('/roles/permissions').then(data => {
        window._permDescriptions = data.permissions || {};
        // Re-render descriptions inline
        Object.entries(window._permDescriptions).forEach(([key, desc]) => {
            const descEl = document.querySelector(`#perm_${key.replace(/\./g,'_')} + label .perm-desc`);
            if (descEl) descEl.textContent = desc;
        });
    }).catch(() => {});
}

function toggleGroup(groupId) {
    const body = document.getElementById(groupId);
    if (!body) return;
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'grid' : 'none';
}


function selectGroup(groupId, checked) {
    const body = document.getElementById(groupId);
    if (!body) return;
    body.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = checked);
}

function selectAllPermissions(checked) {
    document.querySelectorAll('#permissionGroups input[type="checkbox"]').forEach(cb => cb.checked = checked);
}

// ── Dashboard Auto-Suggest ────────────────────────────────────────────────────

function updateDashboardSuggestion() {
    const cat = document.getElementById('roleCategory').value;
    const dash = document.getElementById('roleDashboard');
    if (cat && CATEGORY_DASHBOARD_MAP[cat]) {
        dash.value = CATEGORY_DASHBOARD_MAP[cat];
    }
}

// ── Save Role ─────────────────────────────────────────────────────────────────

async function handleSaveRole(e) {
    e.preventDefault();

    const name = document.getElementById('roleName').value.trim();
    const description = document.getElementById('roleDescription').value.trim();
    const category = document.getElementById('roleCategory').value;
    const dashboardPage = document.getElementById('roleDashboard').value;
    const color = document.getElementById('roleColor').value;

    const permissions = Array.from(
        document.querySelectorAll('#permissionGroups input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    if (!name || !category || !dashboardPage) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    const payload = { name, description, category, dashboardPage, color, permissions };

    const btn = document.getElementById('saveRoleBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner"></i> Saving…';

    try {
        if (editingRoleId) {
            await apiCall(`/roles/${editingRoleId}`, { method: 'PUT', body: JSON.stringify(payload) });
            showToast(`Role "${name}" updated successfully`, 'success');
        } else {
            await apiCall('/roles', { method: 'POST', body: JSON.stringify(payload) });
            showToast(`Role "${name}" created successfully`, 'success');
        }
        closeModal();
        await loadRoles();
    } catch (err) {
        showToast('Failed to save role: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="ph ph-floppy-disk"></i> Save Role';
    }
}

// ── Delete Role ───────────────────────────────────────────────────────────────

async function deleteRole(roleId, roleName) {
    if (!hasPermission('role.delete')) {
        showToast('You do not have permission to delete roles', 'error');
        return;
    }

    if (!confirm(`Delete role "${roleName}"?\n\nThis cannot be undone. Ensure no employees are using this role.`)) return;

    try {
        await apiCall(`/roles/${roleId}`, { method: 'DELETE' });
        showToast(`Role "${roleName}" deleted`, 'success');
        await loadRoles();
    } catch (err) {
        showToast('Cannot delete: ' + err.message, 'error');
    }
}

// ── Seed Default Roles ────────────────────────────────────────────────────────

async function seedDefaultRoles() {
    if (!hasPermission('role.create')) return;
    try {
        const result = await apiCall('/roles/seed', { method: 'POST' });
        const created = result.results.filter(r => r.status === 'created').length;
        const skipped = result.results.filter(r => r.status === 'already exists').length;
        showToast(`Seeded ${created} roles (${skipped} already existed)`, 'success');
        await loadRoles();
    } catch (err) {
        showToast('Seed failed: ' + err.message, 'error');
    }
}
