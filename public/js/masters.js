// Masters Data Management Logic
let masterType = '';
let allData = [];
let filteredData = [];
let currentEditId = null;
let availableRoles = []; // populated dynamically from /api/roles
let kamUsers = [];       // all key_accounts users (for customer KAM dropdown)
let kamManagers = [];    // key_accounts Manager users (for employee supervisor dropdown)

// Master configuration — role field handled dynamically, not hardcoded
const masterConfigs = {
    materials: {
        title: 'Material Master',
        apiEndpoint: '/products',
        fields: [
            { name: 'materialName', label: 'Material Name', type: 'text', required: true },
            { name: 'uom', label: 'Unit of Measure', type: 'text', required: true },
            { name: 'hsnCode', label: 'HSN/SAC Code', type: 'text', required: false },
            { name: 'brand', label: 'Brand', type: 'text', required: false },
            { name: 'specification', label: 'Specification', type: 'text', required: false },
            { name: 'description', label: 'Description', type: 'textarea', required: false }
        ],
        columns: ['Material Name', 'UOM', 'Brand', 'HSN/SAC', 'Specification', 'Actions'],
        renderRow: (item) => [
            item.materialName,
            item.uom,
            item.brand || '-',
            item.hsnCode || '-',
            item.specification || '-'
        ]
    },
    employees: {
        title: 'Employees Master',
        apiEndpoint: '/users',
        fields: [
            { name: 'name', label: 'Full Name', type: 'text', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'password', label: 'Password', type: 'password', required: true },
            { name: 'roleId', label: 'Role', type: 'role-select', required: true }
        ],
        columns: ['Name', 'Email', 'Role', 'Manager / Team', 'Created', 'Actions'],
        renderRow: (item) => {
            const roleDoc = item.roleId;
            const roleName = roleDoc ? roleDoc.name : (item.role || 'Unknown');
            const roleColor = roleDoc ? roleDoc.color : '#94a3b8';
            const isManager = roleName.includes('Manager');
            let managerTeamCell;
            if (isManager) {
                // Count how many employees report to this manager
                const teamSize = allData.filter(u => {
                    const sid = u.supervisorId?._id || u.supervisorId;
                    return sid && String(sid) === String(item._id);
                }).length;
                managerTeamCell = teamSize > 0
                    ? `<span style="font-size:0.8rem;color:var(--success);font-weight:500"><i class="ph ph-users" style="font-size:0.75rem"></i> ${teamSize} member${teamSize !== 1 ? 's' : ''}</span>`
                    : '<span class="text-muted" style="font-size:0.8rem">No team</span>';
            } else {
                managerTeamCell = item.supervisorId
                    ? `<span style="font-size:0.8rem;color:var(--primary);font-weight:500">${item.supervisorId.name}</span>`
                    : '<span class="text-muted">—</span>';
            }
            return [
                item.name,
                item.email,
                getRoleBadge(roleName, roleColor),
                managerTeamCell,
                formatDate(item.createdAt)
            ];
        }
    },
    customers: {
        title: 'Clients Master',
        apiEndpoint: '/customers',
        fields: [
            { name: 'name', label: 'Company Name', type: 'text', required: true },
            { name: 'contactPerson', label: 'Contact Person', type: 'text', required: false },
            { name: 'email', label: 'Email', type: 'email', required: false },
            { name: 'phone', label: 'Phone', type: 'tel', required: false },
            { name: 'address', label: 'Address', type: 'textarea', required: false },
            { name: 'assignedKAM', label: 'Key Account Manager', type: 'kam-select', required: false }
        ],
        columns: ['Company Name', 'Contact Person', 'Email', 'Key Account Manager', 'Actions'],
        renderRow: (item) => [
            item.name,
            item.contactPerson || '-',
            item.email || '-',
            item.assignedKAM ? `<span class="badge badge-assigned">${item.assignedKAM.name}</span>` : '<span class="text-muted">Unassigned</span>'
        ]
    },
    vendors: {
        title: 'Vendors Master',
        apiEndpoint: '/vendors',
        fields: [
            { name: 'name', label: 'Company Name', type: 'text', required: true },
            { name: 'contactPerson', label: 'Contact Person', type: 'text', required: false },
            { name: 'email', label: 'Email', type: 'email', required: false },
            { name: 'phone', label: 'Phone', type: 'tel', required: false },
            { name: 'address', label: 'Address', type: 'textarea', required: false },
            { name: 'specialization', label: 'Specialization', type: 'text', required: false }
        ],
        columns: ['Company Name', 'Contact Person', 'Email', 'Specialization', 'Actions'],
        renderRow: (item) => [
            item.name,
            item.contactPerson || '-',
            item.email || '-',
            item.specialization || '-'
        ]
    }
};

// ── Initialize ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const user = checkAuth();
    if (!user) return;

    // Permission check — must have at least user.view or material.view etc.
    if (!hasAnyPermission(['user.view', 'user.create', 'material.view', 'material.create',
                           'customer.view', 'customer.create', 'vendor.view', 'vendor.create'])) {
        window.location.href = '/';
        return;
    }

    const params = new URLSearchParams(window.location.search);
    masterType = params.get('type') || 'materials';

    const config = masterConfigs[masterType];
    if (!config) {
        showToast('Invalid master type', 'error');
        window.location.href = '/admin.html';
        return;
    }

    document.getElementById('pageTitle').innerHTML = `<i class="ph ph-database" style="color:var(--primary)"></i> ${config.title}`;

    // Show Add New button only if user has create permission for this type
    const createPermMap = { materials: 'material.create', employees: 'user.create', customers: 'customer.create', vendors: 'vendor.create' };
    const createPerm = createPermMap[masterType];
    const addBtn = document.getElementById('addNewBtn');
    if (addBtn && createPerm) addBtn.style.display = hasPermission(createPerm) ? '' : 'none';
    document.getElementById('masterType').textContent = config.title.toLowerCase();

    // Pre-load roles and KAM users in parallel (needed for form dropdowns)
    try {
        const [rolesData, kamData] = await Promise.all([
            apiCall('/roles').catch(() => []),
            apiCall('/users/by-category?category=key_accounts').catch(() => [])
        ]);
        availableRoles = Array.isArray(rolesData) ? rolesData : [];
        kamUsers = Array.isArray(kamData) ? kamData : [];
        kamManagers = kamUsers.filter(u => u.roleId?.name?.includes('Manager'));
    } catch (_) {}

    await loadData();
});

// ── Data Loading ─────────────────────────────────────────────────────────────

async function loadData() {
    const config = masterConfigs[masterType];
    try {
        allData = await apiCall(config.apiEndpoint);
        filteredData = [...allData];
        renderTable();
    } catch (error) {
        showToast('Failed to load data: ' + error.message, 'error');
    }
}

// ── Table Rendering ───────────────────────────────────────────────────────────

function renderTable() {
    const config = masterConfigs[masterType];
    const headerContainer = document.getElementById('tableHeader');
    const bodyContainer = document.getElementById('tableBody');

    headerContainer.innerHTML = `<tr>${config.columns.map(col => `<th>${col}</th>`).join('')}</tr>`;

    if (filteredData.length === 0) {
        bodyContainer.innerHTML = `<tr><td colspan="${config.columns.length}" class="text-center text-muted" style="padding:2rem">No records found</td></tr>`;
        return;
    }

    bodyContainer.innerHTML = filteredData.map(item => {
        const rowData = config.renderRow(item);
        const canEdit = canPerformAction('edit');
        const canDelete = canPerformAction('delete');
        return `
            <tr>
                ${rowData.map(cell => `<td>${cell}</td>`).join('')}
                <td>
                    <div class="flex gap-2">
                        ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick='editItem(${JSON.stringify(item).replace(/'/g, "&#39;")})'>
                            <i class="ph ph-pencil-simple"></i> Edit
                        </button>` : ''}
                        ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="deleteItem('${item._id}')">
                            <i class="ph ph-trash"></i> Delete
                        </button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function canPerformAction(action) {
    const permMap = {
        materials: { edit: 'material.edit', delete: 'material.delete' },
        employees:  { edit: 'user.edit',     delete: 'user.delete'     },
        customers:  { edit: 'customer.edit', delete: 'customer.delete' },
        vendors:    { edit: 'vendor.edit',   delete: 'vendor.delete'   },
    };
    const perm = permMap[masterType] && permMap[masterType][action];
    return perm ? hasPermission(perm) : false;
}

function filterData() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    filteredData = searchTerm
        ? allData.filter(item => Object.values(item).some(v => String(v).toLowerCase().includes(searchTerm)))
        : [...allData];
    renderTable();
}

// ── Form Modal ────────────────────────────────────────────────────────────────

function showAddModal() {
    currentEditId = null;
    document.getElementById('modalTitle').textContent = `Add ${masterConfigs[masterType].title.replace(' Master', '')}`;
    renderFormFields();
    document.getElementById('formModal').classList.add('active');
}

function editItem(item) {
    currentEditId = item._id;
    document.getElementById('modalTitle').textContent = `Edit ${masterConfigs[masterType].title.replace(' Master', '')}`;
    renderFormFields(item);
    document.getElementById('formModal').classList.add('active');
}

function renderFormFields(data = {}) {
    const config = masterConfigs[masterType];
    const container = document.getElementById('formFields');

    container.innerHTML = config.fields.map(field => {
        let inputHtml = '';

        if (field.type === 'role-select') {
            // Dynamic role dropdown fetched from API
            const roleOptions = availableRoles.map(r => {
                const selected = data.roleId && (data.roleId._id === r._id || data.roleId === r._id) ? 'selected' : '';
                return `<option value="${r._id}" ${selected} data-color="${r.color}" data-name="${r.name}" data-category="${r.category}">${r.name} (${r.category})</option>`;
            }).join('');

            inputHtml = `
                <div style="display:flex;flex-direction:column;gap:0.5rem">
                    <select id="${field.name}" ${field.required ? 'required' : ''} onchange="updateRolePreview(this); checkManagerAssignmentFields()">
                        <option value="">Select a role...</option>
                        ${roleOptions}
                    </select>
                    <a href="/role-management.html" target="_blank"
                       style="font-size:0.8rem;color:var(--primary);display:inline-flex;align-items:center;gap:0.3rem;text-decoration:none;opacity:0.85">
                        <i class="ph ph-plus-circle"></i> Create a new role
                    </a>
                </div>
            `;
        } else if (field.type === 'kam-select') {
            // KAM user dropdown
            const currentKAMId = data.assignedKAM ? (data.assignedKAM._id || data.assignedKAM) : '';
            const kamOptions = kamUsers.map(u => {
                const selected = currentKAMId === u._id ? 'selected' : '';
                const roleLabel = u.roleId?.name?.includes('Entry') ? 'Entry' : 'Manager';
                return `<option value="${u._id}" ${selected}>${u.name} · ${roleLabel}</option>`;
            }).join('');

            inputHtml = `
                <select id="${field.name}">
                    <option value="">— Unassigned —</option>
                    ${kamOptions}
                </select>
                ${kamUsers.length === 0 ? `<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.25rem">No Key Accounts users found. Create one in Employees first.</p>` : ''}
            `;
        } else if (field.type === 'textarea') {
            inputHtml = `<textarea id="${field.name}" rows="3" ${field.required ? 'required' : ''}>${data[field.name] || ''}</textarea>`;
        } else {
            const val = field.name === 'password' ? '' : (data[field.name] || '');
            const placeholder = field.name === 'password' && currentEditId ? 'Leave blank to keep current password' : '';
            inputHtml = `<input type="${field.type}" id="${field.name}" value="${val}" ${field.required && !(field.name === 'password' && currentEditId) ? 'required' : ''} placeholder="${placeholder}">`;
        }

        return `
            <div class="form-group">
                <label>${field.label}${field.required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>
                ${inputHtml}
            </div>
        `;
    }).join('');

    // Inject contextual manager/team assignment section for employees
    if (masterType === 'employees') {
        container.insertAdjacentHTML('beforeend', '<div id="contextualAssignment"></div>');
        checkManagerAssignmentFields(data);
    }

    document.getElementById('dataForm').onsubmit = handleFormSubmit;
}

async function checkManagerAssignmentFields(data = {}) {
    const roleSelect = document.getElementById('roleId');
    const section = document.getElementById('contextualAssignment');
    if (!roleSelect || !section) return;

    const selectedOption = roleSelect.options[roleSelect.selectedIndex];
    if (!selectedOption || !selectedOption.value) {
        section.innerHTML = '';
        return;
    }

    const roleName     = selectedOption.getAttribute('data-name') || '';
    const roleCategory = selectedOption.getAttribute('data-category') || '';
    const isManager    = roleName.includes('Manager');
    const isEntry      = roleName.includes('Entry');

    if (!isManager && !isEntry) {
        section.innerHTML = '';
        return;
    }

    section.innerHTML = `<p style="font-size:0.82rem;color:var(--text-muted);padding:0.5rem 0">Loading…</p>`;

    try {
        if (isEntry) {
            // Fetch managers of the same category
            const managers = await apiCall(`/users/managers?category=${roleCategory}`);
            const currentSupervisorId = data.supervisorId?._id || data.supervisorId || '';
            const options = managers.map(m => {
                const sel = String(m._id) === String(currentSupervisorId) ? 'selected' : '';
                return `<option value="${m._id}" ${sel}>${m.name}</option>`;
            }).join('');

            section.innerHTML = `
                <div class="form-group">
                    <label style="font-weight:600;font-size:0.875rem">
                        <i class="ph ph-user-circle" style="color:var(--primary);margin-right:0.3rem"></i>
                        Assign to Manager
                        <span style="font-weight:400;font-size:0.78rem;color:var(--text-muted);margin-left:0.25rem">(optional)</span>
                    </label>
                    <select id="contextSupervisorId">
                        <option value="">— No manager assigned —</option>
                        ${options}
                    </select>
                    ${managers.length === 0 ? `<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.3rem">No ${roleCategory} managers found. Create one first.</p>` : ''}
                </div>`;

        } else if (isManager) {
            // Fetch entry users of the same category
            const entries = await apiCall(`/users/entries?category=${roleCategory}`);
            const currentTeamIds = currentEditId
                ? entries.filter(e => {
                    const sid = e.supervisorId?._id || e.supervisorId;
                    return sid && String(sid) === String(currentEditId);
                  }).map(e => String(e._id))
                : [];

            const checkboxItems = entries.map(e => {
                const isChecked = currentTeamIds.includes(String(e._id)) ? 'checked' : '';
                const currentMgr = e.supervisorId?.name;
                const hint = currentMgr && String(e.supervisorId?._id || e.supervisorId) !== String(currentEditId)
                    ? ` · <em style="color:var(--warning)">currently under ${currentMgr}</em>` : '';
                return `
                    <label style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.5rem 0.75rem;cursor:pointer;border-bottom:1px solid var(--border-light);transition:background 0.15s" onmouseover="this.style.background='rgba(59,159,217,0.04)'" onmouseout="this.style.background=''">
                        <input type="checkbox" class="team-member-cb" value="${e._id}" ${isChecked}
                            style="margin-top:2px;accent-color:var(--primary);width:14px;height:14px;flex-shrink:0;cursor:pointer">
                        <div>
                            <div style="font-size:0.85rem;font-weight:500;color:var(--text-primary)">${e.name}</div>
                            <div style="font-size:0.75rem;color:var(--text-muted)">${e.email}${hint}</div>
                        </div>
                    </label>`;
            }).join('');

            section.innerHTML = `
                <div class="form-group">
                    <label style="font-weight:600;font-size:0.875rem;display:flex;align-items:center;justify-content:space-between">
                        <span><i class="ph ph-users" style="color:var(--primary);margin-right:0.3rem"></i>Assign Team Members</span>
                        <span id="teamCountBadge" style="font-size:0.75rem;font-weight:500;color:var(--primary);background:var(--primary-light);padding:0.15rem 0.5rem;border-radius:999px">${currentTeamIds.length} selected</span>
                    </label>
                    ${entries.length === 0
                        ? `<p style="font-size:0.82rem;color:var(--text-muted);padding:0.6rem 0.75rem;background:var(--bg-secondary);border-radius:0.5rem;border:1px solid var(--border)">No entry-level ${roleCategory} employees found. Create some first.</p>`
                        : `<div style="border:1.5px solid var(--border);border-radius:0.5rem;max-height:210px;overflow-y:auto">${checkboxItems}</div>`
                    }
                </div>`;

            // Live count update
            section.querySelectorAll('.team-member-cb').forEach(cb => {
                cb.addEventListener('change', () => {
                    const count = section.querySelectorAll('.team-member-cb:checked').length;
                    const badge = document.getElementById('teamCountBadge');
                    if (badge) badge.textContent = count + ' selected';
                });
            });
        }
    } catch (err) {
        section.innerHTML = `<p style="font-size:0.8rem;color:var(--danger)">Failed to load assignment options.</p>`;
    }
}

function updateRolePreview(selectEl) {
    const selected = selectEl.options[selectEl.selectedIndex];
    const color = selected ? selected.getAttribute('data-color') : null;
    if (color && selected.value) {
        selectEl.style.borderColor = color;
        selectEl.style.boxShadow = `0 0 0 3px ${color}22`;
    } else {
        selectEl.style.borderColor = '';
        selectEl.style.boxShadow = '';
    }
}

// ── Form Submit ──────────────────────────────────────────────────────────────

async function handleFormSubmit(e) {
    e.preventDefault();
    const config = masterConfigs[masterType];
    const formData = {};

    config.fields.forEach(field => {
        const el = document.getElementById(field.name);
        if (!el) return;
        const value = el.value;
        if (field.name === 'password' && currentEditId && !value) return;
        formData[field.name] = value || null;
    });

    // Clean up null assignedKAM
    if (formData.assignedKAM === null || formData.assignedKAM === '') {
        formData.assignedKAM = null;
    }

    // Contextual manager/team assignment for employees
    if (masterType === 'employees') {
        const section = document.getElementById('contextualAssignment');
        if (section) {
            const supervisorSelect = document.getElementById('contextSupervisorId');
            const teamCbs = section.querySelectorAll('.team-member-cb');
            if (supervisorSelect) {
                // Entry role — assign to a manager
                formData.supervisorId = supervisorSelect.value || null;
            } else if (teamCbs.length > 0) {
                // Manager role — assign team members
                formData.teamMemberIds = Array.from(section.querySelectorAll('.team-member-cb:checked')).map(cb => cb.value);
                formData.supervisorId = null;
            } else {
                formData.supervisorId = null;
            }
        }
    }

    const btn = document.querySelector('#dataForm button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        if (currentEditId) {
            await apiCall(`${config.apiEndpoint}/${currentEditId}`, {
                method: 'PUT', body: JSON.stringify(formData)
            });
            showToast('Updated successfully!', 'success');
        } else {
            await apiCall(config.apiEndpoint, {
                method: 'POST', body: JSON.stringify(formData)
            });
            showToast('Added successfully!', 'success');
        }
        closeFormModal();
        await loadData();
    } catch (error) {
        showToast(`Failed: ${error.message || 'Unknown error'}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
}

async function deleteItem(id) {
    if (!confirm('Are you sure you want to delete this record? This cannot be undone.')) return;
    const config = masterConfigs[masterType];
    try {
        await apiCall(`${config.apiEndpoint}/${id}`, { method: 'DELETE' });
        showToast('Deleted successfully!', 'success');
        await loadData();
    } catch (error) {
        showToast('Failed to delete: ' + (error.message || 'Unknown error'), 'error');
    }
}

function closeFormModal() {
    document.getElementById('formModal').classList.remove('active');
    document.getElementById('dataForm').reset();
    currentEditId = null;
}
