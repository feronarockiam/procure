// Masters Data Management Logic
let masterType = '';
let allData = [];
let filteredData = [];
let currentEditId = null;
let editingItem = null; // the record open in the form (null when adding)
let availableRoles = []; // populated dynamically from /api/roles
const pickedCustomers = new Set(); // customers ticked for "give to a Key Account Manager"
let kamUsers = [];       // all key_accounts users (for customer KAM dropdown)

// Master configuration — role field handled dynamically, not hardcoded
const masterConfigs = {
    materials: {
        title: 'Materials', singular: 'Material', subtitle: 'The materials you buy and sell, and the unit each is counted in.',
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
            escapeHtml(item.materialName),
            escapeHtml(item.uom),
            escapeHtml(item.brand || '-'),
            escapeHtml(item.hsnCode || '-'),
            escapeHtml(item.specification || '-')
        ]
    },
    employees: {
        title: 'Employees', singular: 'Employee', subtitle: 'The people who can sign in, and the role each of them has.',
        apiEndpoint: '/users',
        fields: [
            { name: 'name', label: 'Full Name', type: 'text', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'password', label: 'Password', type: 'password', required: true },
            { name: 'roleId', label: 'Role', type: 'role-select', required: true }
        ],
        columns: ['Name', 'Email', 'Role', 'Manager / Team', 'Last sign-in', 'Actions'],
        renderRow: (item) => {
            const roleDoc = item.roleId;
            const roleName = roleDoc ? roleDoc.name : (item.role || 'Unknown');
            const roleColor = roleDoc ? roleDoc.color : '#94a3b8';
            const isManager = !!(roleDoc && roleDoc.leadsTeam);
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
                    ? `<span style="font-size:0.8rem;color:var(--primary);font-weight:500">${escapeHtml(item.supervisorId.name)}</span>`
                    : '<span class="text-muted">—</span>';
            }
            const off = item.active === false;
            return [
                escapeHtml(item.name) + (off ? ' <span class="badge" style="background:#f1f5f9;color:#475569">Turned off</span>' : ''),
                escapeHtml(item.email),
                getRoleBadge(roleName, roleColor),
                managerTeamCell,
                item.lastLoginAt
                    ? `<span title="${escapeHtml(fullDateTime(item.lastLoginAt))}">${escapeHtml(relativeTime(item.lastLoginAt))}</span>`
                    : '<span class="text-muted">Never</span>'
            ];
        }
    },
    customers: {
        title: 'Customers', singular: 'Customer', subtitle: 'The companies you sell to, and who looks after each one.',
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
            escapeHtml(item.name),
            escapeHtml(item.contactPerson || '-'),
            escapeHtml(item.email || '-'),
            item.assignedKAM ? `<span class="badge badge-assigned">${escapeHtml(item.assignedKAM.name)}</span>` : '<span class="text-muted">Unassigned</span>'
        ]
    },
    vendors: {
        title: 'Vendors', singular: 'Vendor', subtitle: 'The suppliers who give you prices.',
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
            escapeHtml(item.name),
            escapeHtml(item.contactPerson || '-'),
            escapeHtml(item.email || '-'),
            escapeHtml(item.specialization || '-')
        ]
    }
};

// ── Initialize ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const user = checkAuth();
    if (!user) return;

    const params = new URLSearchParams(window.location.search);
    masterType = params.get('type') || 'materials';

    const config = masterConfigs[masterType];
    if (!config) {
        showToast("That list doesn't exist.", 'error');
        setTimeout(() => { window.location.href = user.landingPage ? '/' + user.landingPage : '/no-access.html'; }, 1200);
        return;
    }
    // Each list needs its own "see the list" permission, not just any list permission
    if (!requirePageAccess(`/masters.html?type=${masterType}`)) return;

    document.getElementById('pageTitle').innerHTML = `<i class="ph ph-database" style="color:var(--primary)"></i> ${escapeHtml(config.title)}`;

    // Show Add New button only if user has create permission for this type
    const createPermMap = { materials: 'material.create', employees: 'user.create', customers: 'customer.create', vendors: 'vendor.create' };
    const createPerm = createPermMap[masterType];
    const addBtn = document.getElementById('addNewBtn');
    if (addBtn && createPerm) addBtn.style.display = hasPermission(createPerm) ? '' : 'none';
    if (addBtn) addBtn.innerHTML = `<i class="ph ph-plus-circle"></i> Add ${escapeHtml(config.singular.toLowerCase())}`;
    // Someone who can only look at a list is told so, rather than left wondering where the buttons are
    const canChange = canPerformAction('edit') || canPerformAction('delete') || (createPerm && hasPermission(createPerm));
    document.getElementById('pageSubtitle').textContent = config.subtitle + (canChange ? '' : ' You can view this list, but your role does not include changing it.');
    document.title = `${config.title} – Precise Procure`;
    const search = document.getElementById('searchInput');
    if (search) search.placeholder = `Search ${config.title.toLowerCase()}…`;

    // Pre-load roles and KAM users in parallel (needed for form dropdowns)
    try {
        const [rolesData, kamData] = await Promise.all([
            apiCall('/roles/assignable', { silent: true }).catch(() => []),
            apiCall('/users/by-permission?permission=enquiry.view.assigned_customers', { silent: true }).catch(() => [])
        ]);
        availableRoles = Array.isArray(rolesData) ? rolesData : [];
        kamUsers = Array.isArray(kamData) ? kamData : [];
    } catch (_) {}

    await loadData();
});

// ── Data Loading ─────────────────────────────────────────────────────────────

// ?edit=<id> (from an access request notification): open that person's record once
function openRecordFromLink() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('edit');
    if (!id) return;
    params.delete('edit');
    history.replaceState(null, '', window.location.pathname + (params.toString() ? '?' + params : ''));
    if (allData.some(row => String(row._id) === id) && canPerformAction('edit')) editItem(id);
    else showToast('That record is not on this list, or you cannot change it', 'info');
}

async function loadData() {
    const config = masterConfigs[masterType];
    try {
        allData = await apiCall(config.apiEndpoint);
        filteredData = [...allData];
        shownCount = ROWS_PER_PAGE;
        renderTable();
        openRecordFromLink();
    } catch (error) {
        showToast('Failed to load data: ' + error.message, 'error');
        const body = document.getElementById('tableBody');
        if (body) {
            body.innerHTML = '<tr><td colspan="10" id="loadErrorCell"></td></tr>';
            showLoadError(document.getElementById('loadErrorCell'), error.message, loadData);
        }
    }
}

// ── Table Rendering ───────────────────────────────────────────────────────────

// Long lists are drawn a page at a time so the screen stays quick however many records there are
const ROWS_PER_PAGE = 200;
let shownCount = ROWS_PER_PAGE;

function renderTable() {
    const config = masterConfigs[masterType];
    const headerContainer = document.getElementById('tableHeader');
    const bodyContainer = document.getElementById('tableBody');

    // No Edit/Delete/Turn-off buttons for this person: no empty "Actions" column either
    const showActions = canPerformAction('edit') || canPerformAction('delete');
    const columns = showActions ? config.columns : config.columns.filter(col => col !== 'Actions');
    // customers can be ticked and handed to a Key Account Manager together
    const selectable = masterType === 'customers' && canPerformAction('edit');
    const span = columns.length + (selectable ? 1 : 0);
    headerContainer.innerHTML = `<tr>${selectable ? '<th style="width:2.2rem"><input type="checkbox" id="pickAllCustomers" class="bulk-pick-all" aria-label="Select every customer in this list" onchange="pickAllCustomers(this.checked)"></th>' : ''}${columns.map(col => `<th>${col}</th>`).join('')}</tr>`;

    if (filteredData.length === 0) {
        const searching = !!(document.getElementById('searchInput') && document.getElementById('searchInput').value.trim());
        bodyContainer.innerHTML = `<tr><td colspan="${span}" class="text-center text-muted" style="padding:2.5rem">${searching ? 'Nothing matches your search' : `No ${config.title.toLowerCase()} yet${hasPermission(({ materials: 'material.create', employees: 'user.create', customers: 'customer.create', vendors: 'vendor.create' })[masterType]) ? ' — use the button above to add the first one' : ''}`}</td></tr>`;
        return;
    }

    const visible = filteredData.slice(0, shownCount);
    bodyContainer.innerHTML = visible.map(item => {
        const rowData = config.renderRow(item);
        const canEdit = canPerformAction('edit');
        const canDelete = canPerformAction('delete');
        return `
            <tr>
                ${selectable ? `<td><input type="checkbox" class="bulk-pick" aria-label="Select ${escapeHtml(item.name)}" ${pickedCustomers.has(String(item._id)) ? 'checked' : ''} onchange="pickCustomer('${escapeHtml(item._id)}', this.checked)"></td>` : ''}
                ${rowData.map(cell => `<td>${cell}</td>`).join('')}
                ${showActions ? `<td>
                    <div class="flex gap-2">
                        ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="editItem('${escapeHtml(item._id)}')">
                            <i class="ph ph-pencil-simple"></i> Edit
                        </button>` : ''}
                        ${canEdit && masterType === 'employees' ? `<button class="btn btn-secondary btn-sm" onclick="toggleEmployeeAccess('${escapeHtml(item._id)}')" title="${item.active === false ? 'Let this person sign in again' : 'Stop this person signing in, but keep their history'}">
                            <i class="ph ${item.active === false ? 'ph-play-circle' : 'ph-pause-circle'}"></i> ${item.active === false ? 'Turn on' : 'Turn off'}
                        </button>` : ''}
                        ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="deleteItem('${escapeHtml(item._id)}')">
                            <i class="ph ph-trash"></i> Delete
                        </button>` : ''}
                    </div>
                </td>` : ''}
            </tr>
        `;
    }).join('') + (filteredData.length > visible.length ? `
        <tr><td colspan="${span}" class="text-center" style="padding:1rem">
            <span class="text-muted" style="margin-right:0.75rem">Showing ${visible.length} of ${filteredData.length}. Search to narrow the list.</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="showMoreRows()">Show ${Math.min(ROWS_PER_PAGE, filteredData.length - visible.length)} more</button>
        </td></tr>` : '');
}

// ── Download what the list shows (every row the search leaves, not only the ones drawn so far) ──
const csvDefinitions = {
    materials: { headers: ['Material', 'Unit', 'Brand', 'HSN/SAC', 'Specification'], row: m => [m.materialName, m.uom, m.brand, m.hsnCode, m.specification] },
    customers: { headers: ['Company', 'Contact person', 'Email', 'Phone', 'Address', 'Key Account Manager'], row: c => [c.name, c.contactPerson, c.email, c.phone, c.address, c.assignedKAM && c.assignedKAM.name] },
    vendors: { headers: ['Company', 'Contact person', 'Email', 'Phone', 'Address', 'Specialization'], row: v => [v.name, v.contactPerson, v.email, v.phone, v.address, v.specialization] },
    employees: {
        headers: ['Name', 'Email', 'Role', 'Manager', 'Last sign-in', 'Access'],
        row: u => [u.name, u.email, (u.roleId && u.roleId.name) || u.role, u.supervisorId && u.supervisorId.name, u.lastLoginAt ? fullDateTime(u.lastLoginAt) : 'Never', u.active === false ? 'Turned off' : 'On'],
    },
};

function exportMasterCsv() {
    const definition = csvDefinitions[masterType];
    if (!definition || filteredData.length === 0) { showToast('There is nothing in this list to download', 'error'); return; }
    downloadCsv(masterType, definition.headers, filteredData.map(definition.row));
    showToast(`Downloaded ${filteredData.length} row${filteredData.length === 1 ? '' : 's'}`);
}

// ── Give several customers to one Key Account Manager ────────────────────────

function pickCustomer(id, on) {
    if (on) pickedCustomers.add(String(id)); else pickedCustomers.delete(String(id));
    renderKamBar();
}

function pickAllCustomers(on) {
    // everything the search currently shows, not only the rows drawn so far
    filteredData.forEach(c => { if (on) pickedCustomers.add(String(c._id)); else pickedCustomers.delete(String(c._id)); });
    document.querySelectorAll('#tableBody .bulk-pick').forEach(box => { box.checked = on; });
    renderKamBar();
}

function clearPickedCustomers() {
    pickedCustomers.clear();
    document.querySelectorAll('#tableBody .bulk-pick, #pickAllCustomers').forEach(box => { box.checked = false; });
    renderKamBar();
}

function renderKamBar() {
    let bar = document.getElementById('kamBar');
    const n = pickedCustomers.size;
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'kamBar';
        bar.className = 'bulk-bar';
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', 'Selected customers');
        document.body.appendChild(bar);
    }
    bar.hidden = n === 0;
    document.body.classList.toggle('has-bulk-bar', n > 0);
    if (n === 0) return;
    const keep = document.getElementById('kamBarPerson') ? document.getElementById('kamBarPerson').value : '';
    bar.innerHTML = `
        <span class="bulk-count" aria-live="polite"><b>${n}</b> customer${n === 1 ? '' : 's'} selected</span>
        <span class="bulk-assign">
            <select id="kamBarPerson" aria-label="Key Account Manager for the selected customers">
                <option value="">Choose a manager…</option>
                <option value="__none__">— No manager —</option>
                ${kamUsers.map(u => `<option value="${escapeHtml(u._id)}">${escapeHtml(u.name)}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-primary btn-sm" onclick="applyKamToPicked()"><i class="ph ph-user-plus"></i> Apply</button>
        </span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="clearPickedCustomers()">Clear</button>`;
    document.getElementById('kamBarPerson').value = keep;
}

async function applyKamToPicked() {
    const choice = document.getElementById('kamBarPerson').value;
    if (!choice) { showToast('Choose a Key Account Manager first', 'error'); document.getElementById('kamBarPerson').focus(); return; }
    try {
        const result = await apiCall('/customers/assign-kam', {
            method: 'PUT',
            body: JSON.stringify({ customerIds: [...pickedCustomers], assignedKAM: choice === '__none__' ? null : choice }),
        });
        showToast(`Updated ${result.updated} customer${result.updated === 1 ? '' : 's'}`);
        pickedCustomers.clear();
        renderKamBar();
        await loadData();
    } catch (error) {
        showToast(error.message || 'Could not update the customers', 'error');
    }
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

// Search matches what a person can see in the row (names, emails, roles...), not hidden ids or field names.
// The text for each record is worked out once and remembered.
const searchIndex = new WeakMap();
function searchTextOf(item) {
    let text = searchIndex.get(item);
    if (text === undefined) {
        const cells = masterConfigs[masterType].renderRow(item).join(' ').replace(/<[^>]*>/g, ' ');
        const textarea = document.createElement('textarea'); // turns &amp; etc. back into characters
        textarea.innerHTML = cells;
        text = `${textarea.value} ${item.materialName || ''} ${item.hsnCode || ''}`.toLowerCase();
        searchIndex.set(item, text);
    }
    return text;
}

const filterDataDebounced = debounce(() => filterData());
function filterData() {
    const searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
    filteredData = searchTerm ? allData.filter(item => searchTextOf(item).includes(searchTerm)) : [...allData];
    shownCount = ROWS_PER_PAGE;
    renderTable();
}

function showMoreRows() {
    shownCount += ROWS_PER_PAGE;
    renderTable();
}

// ── Form Modal ────────────────────────────────────────────────────────────────

function showAddModal() {
    currentEditId = null;
    editingItem = null;
    document.getElementById('modalTitle').textContent = `Add ${masterConfigs[masterType].singular}`;
    renderFormFields();
    document.getElementById('formModal').classList.add('active');
}

function editItem(id) {
    // Looked up by id: the record used to be serialised into the button's onclick attribute, which broke on
    // apostrophes and turned "&amp;" into "&" (and then saved the altered text back over the original).
    const item = allData.find(row => String(row._id) === String(id));
    if (!item) { showToast('That record is no longer in the list. Refresh and try again.', 'error'); return; }
    currentEditId = item._id;
    editingItem = item;
    document.getElementById('modalTitle').textContent = `Edit ${masterConfigs[masterType].singular}`;
    renderFormFields(item);
    document.getElementById('formModal').classList.add('active');
}

function renderFormFields(data = {}) {
    const config = masterConfigs[masterType];
    const container = document.getElementById('formFields');

    container.innerHTML = config.fields.map(field => {
        let inputHtml = '';

        if (field.type === 'role-select') {
            // The roles this person may hand out, grouped by team. A role with more access than the
            // signed-in person has is shown but can't be picked (the server would refuse it anyway).
            const currentRoleId = data.roleId && (data.roleId._id || data.roleId);
            const teams = [];
            for (const r of availableRoles) if (!teams.includes(r.teamLabel)) teams.push(r.teamLabel);
            const roleOptions = teams.map(team => `
                <optgroup label="${escapeHtml(team)}">
                    ${availableRoles.filter(r => r.teamLabel === team).map(r => {
                        const selected = String(currentRoleId) === String(r._id) ? 'selected' : '';
                        const blocked = !r.assignable && !selected;
                        return `<option value="${escapeHtml(r._id)}" ${selected} ${blocked ? 'disabled' : ''}>${escapeHtml(r.name)}${blocked ? ' (more access than you have)' : ''}</option>`;
                    }).join('')}
                </optgroup>`).join('');

            inputHtml = `
                <div style="display:flex;flex-direction:column;gap:0.5rem">
                    <select id="${escapeHtml(field.name)}" ${field.required ? 'required' : ''} onchange="onRoleChosen(this)">
                        <option value="">Choose a role…</option>
                        ${roleOptions}
                    </select>
                    <div id="roleSummary"></div>
                    ${canOpenHref('/role-management.html') ? `<a href="/role-management.html" target="_blank"
                       style="font-size:0.8rem;color:var(--primary);display:inline-flex;align-items:center;gap:0.3rem;text-decoration:none;opacity:0.85">
                        <i class="ph ph-shield-check"></i> Create or change roles</a>` : ''}
                </div>
            `;
        } else if (field.type === 'kam-select') {
            // KAM user dropdown
            const currentKAMId = data.assignedKAM ? (data.assignedKAM._id || data.assignedKAM) : '';
            const kamOptions = kamUsers.map(u => {
                const selected = currentKAMId === u._id ? 'selected' : '';
                return `<option value="${escapeHtml(u._id)}" ${selected}>${escapeHtml(u.name)}${u.roleId ? ' · ' + escapeHtml(u.roleId.name) : ''}</option>`;
            }).join('');

            inputHtml = `
                <select id="${escapeHtml(field.name)}">
                    <option value="">— Unassigned —</option>
                    ${kamOptions}
                </select>
                ${kamUsers.length === 0 ? `<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.25rem">Nobody can look after customers yet. Give someone a role that includes "Enquiries for the customers they look after" (in Roles &amp; Access).</p>` : ''}
            `;
        } else if (field.type === 'textarea') {
            inputHtml = `<textarea id="${escapeHtml(field.name)}" rows="3" ${field.required ? 'required' : ''}>${escapeHtml(data[field.name] || '')}</textarea>`;
        } else {
            const val = field.name === 'password' ? '' : (data[field.name] || '');
            const placeholder = field.name === 'password' && currentEditId ? 'Leave blank to keep current password' : '';
            inputHtml = `<input type="${field.type}" id="${escapeHtml(field.name)}" value="${escapeHtml(val)}" ${field.required && !(field.name === 'password' && currentEditId) ? 'required' : ''} placeholder="${placeholder}">`;
        }

        return `
            <div class="form-group">
                <label>${escapeHtml(field.label)}${field.required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>
                ${inputHtml}
            </div>
        `;
    }).join('');

    // Inject contextual manager/team assignment section for employees
    if (masterType === 'employees') {
        container.insertAdjacentHTML('beforeend', '<div id="contextualAssignment"></div>');
        const chosen = document.getElementById('roleId');
        if (chosen && chosen.value) onRoleChosen(chosen);
        else checkManagerAssignmentFields(data);
    }

    document.getElementById('dataForm').onsubmit = handleFormSubmit;
}

async function checkManagerAssignmentFields(data = {}) {
    const roleSelect = document.getElementById('roleId');
    const section = document.getElementById('contextualAssignment');
    if (!roleSelect || !section) return;

    const role = availableRoles.find(r => String(r._id) === String(roleSelect.value));
    if (!role) {
        section.innerHTML = '';
        return;
    }
    // Whether this person leads a team is a setting on their role (not something read from its name)
    const roleCategory = role.category;
    const isManager    = !!role.leadsTeam;
    const isEntry      = !isManager;
    if (!Object.keys(data).length && editingItem) data = editingItem;

    section.innerHTML = `<p style="font-size:0.82rem;color:var(--text-muted);padding:0.5rem 0">Loading…</p>`;

    try {
        if (isEntry) {
            // Fetch managers of the same category
            const managers = await apiCall(`/users/managers?category=${roleCategory}`);
            const currentSupervisorId = data.supervisorId?._id || data.supervisorId || '';
            const options = managers.map(m => {
                const sel = String(m._id) === String(currentSupervisorId) ? 'selected' : '';
                return `<option value="${escapeHtml(m._id)}" ${sel}>${escapeHtml(m.name)}</option>`;
            }).join('');

            section.innerHTML = `
                <div class="form-group">
                    <label style="font-weight:600;font-size:0.875rem">
                        <i class="ph ph-user-circle" style="color:var(--primary);margin-right:0.3rem"></i>
                        Reports to
                        <span style="font-weight:400;font-size:0.78rem;color:var(--text-muted);margin-left:0.25rem">(optional)</span>
                    </label>
                    <select id="contextSupervisorId">
                        <option value="">— Nobody —</option>
                        ${options}
                    </select>
                    ${managers.length === 0 ? `<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.3rem">Nobody in this team leads a team yet. Tick "People in this role lead a team" on a role (in Roles &amp; Access) and give it to someone.</p>` : ''}
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
                    ? ` · <em style="color:var(--warning)">currently under ${escapeHtml(currentMgr)}</em>` : '';
                return `
                    <label style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.5rem 0.75rem;cursor:pointer;border-bottom:1px solid var(--border-light);transition:background 0.15s" onmouseover="this.style.background='rgba(59,159,217,0.04)'" onmouseout="this.style.background=''">
                        <input type="checkbox" class="team-member-cb" value="${escapeHtml(e._id)}" ${isChecked}
                            style="margin-top:2px;accent-color:var(--primary);width:14px;height:14px;flex-shrink:0;cursor:pointer">
                        <div>
                            <div style="font-size:0.85rem;font-weight:500;color:var(--text-primary)">${escapeHtml(e.name)}</div>
                            <div style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(e.email)}${hint}</div>
                        </div>
                    </label>`;
            }).join('');

            section.innerHTML = `
                <div class="form-group">
                    <label style="font-weight:600;font-size:0.875rem;display:flex;align-items:center;justify-content:space-between">
                        <span><i class="ph ph-users" style="color:var(--primary);margin-right:0.3rem"></i>Their team</span>
                        <span id="teamCountBadge" style="font-size:0.75rem;font-weight:500;color:var(--primary);background:var(--primary-light);padding:0.15rem 0.5rem;border-radius:999px">${currentTeamIds.length} selected</span>
                    </label>
                    ${entries.length === 0
                        ? `<p style="font-size:0.82rem;color:var(--text-muted);padding:0.6rem 0.75rem;background:var(--bg-secondary);border-radius:0.5rem;border:1px solid var(--border)">Nobody else in this team can join a team yet.</p>`
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

// When a role is chosen: outline the dropdown in its colour, say in plain words what the role allows,
// and show the team choices that fit it
function onRoleChosen(selectEl) {
    const role = availableRoles.find(r => String(r._id) === String(selectEl.value));
    if (role) {
        selectEl.style.borderColor = role.color;
        selectEl.style.boxShadow = `0 0 0 3px ${role.color}22`;
    } else {
        selectEl.style.borderColor = '';
        selectEl.style.boxShadow = '';
    }
    renderRoleSummary(role);
    checkManagerAssignmentFields();
}

function renderRoleSummary(role) {
    const box = document.getElementById('roleSummary');
    if (!box) return;
    if (!role) { box.innerHTML = ''; return; }
    const start = role.landingPage && NAV_META['/' + role.landingPage] ? NAV_META['/' + role.landingPage].label : null;
    box.innerHTML = `
        <div style="border:1px solid var(--border);border-left:3px solid ${escapeHtml(role.color)};border-radius:0.6rem;background:var(--bg-secondary);padding:0.65rem 0.85rem;font-size:0.8rem;line-height:1.45">
            ${role.description ? `<div style="color:var(--text-secondary);margin-bottom:0.4rem">${escapeHtml(role.description)}</div>` : ''}
            ${role.summary.lines.map(l => `<div style="display:flex;gap:0.45rem;margin-top:0.25rem"><i class="ph ph-${escapeHtml(l.icon)}" style="color:var(--primary);margin-top:0.15rem"></i><div><b>${escapeHtml(l.title)}:</b> ${escapeHtml(l.text)}</div></div>`).join('')}
            <div style="margin-top:0.45rem;padding-top:0.45rem;border-top:1px dashed var(--border);color:var(--text-muted)">
                Starts on: <b>${start ? escapeHtml(start) : 'nothing yet'}</b>${role.leadsTeam ? ' · leads a team' : ''} · ${role.userCount} ${role.userCount === 1 ? 'person has' : 'people have'} this role
            </div>
        </div>`;
}

// ── Form Submit ──────────────────────────────────────────────────────────────

async function handleFormSubmit(e) {
    e.preventDefault();
    const config = masterConfigs[masterType];
    const formData = {};

    config.fields.forEach(field => {
        const el = document.getElementById(field.name);
        if (!el) return;
        // Passwords are taken exactly as typed; everything else is trimmed so "  Acme " and "Acme" are one record
        const value = field.name === 'password' ? el.value : el.value.trim();
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
        if (!error.handled) showToast(`Failed: ${error.message || 'Unknown error'}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
}

// Turning someone off stops them signing in but keeps their name on everything they did (deleting removes them)
async function toggleEmployeeAccess(id) {
    const record = allData.find(row => String(row._id) === String(id));
    if (!record) return;
    const turnOff = record.active !== false;
    if (turnOff) {
        const sure = await confirmDialog({
            title: `Turn off ${record.name}?`,
            message: `${record.name} will be signed out and won't be able to sign in until you turn them back on. Their history stays.`,
            confirmLabel: 'Turn off', danger: true,
        });
        if (!sure) return;
    }
    try {
        await apiCall(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ active: !turnOff }) });
        showToast(turnOff ? `${record.name} has been turned off` : `${record.name} can sign in again`);
        await loadData();
    } catch (error) {
        showToast(error.message || 'Could not change access', 'error');
    }
}

// Materials, customers and vendors can be put back for a few seconds after deleting: the server refuses to delete one that is in use,
// so a deleted one has nothing attached to it and can simply be created again from what was on screen.
// (People and roles are not offered this: turning someone off is the safe way to take access away.)
const UNDOABLE = ['materials', 'customers', 'vendors'];

function snapshotForUndo(record) {
    const body = {};
    for (const field of masterConfigs[masterType].fields) {
        let value = record[field.name];
        if (value && typeof value === 'object') value = value._id; // e.g. the Key Account Manager
        if (value !== undefined && value !== null && value !== '') body[field.name] = value;
    }
    return body;
}

async function undoDelete(body, label, type) {
    try {
        await apiCall(masterConfigs[type].apiEndpoint, { method: 'POST', body: JSON.stringify(body) });
        showToast(`${label ? `"${label}"` : 'It'} is back`);
        if (masterType === type) await loadData();
    } catch (error) {
        showToast(`Could not bring it back: ${error.message || 'unknown error'}`, 'error');
    }
}

async function deleteItem(id) {
    const config = masterConfigs[masterType];
    const record = allData.find(row => String(row._id) === String(id));
    const label = record ? (record.materialName || record.name || '') : '';
    const undoable = UNDOABLE.includes(masterType);
    const sure = await confirmDialog({
        title: `Delete this ${config.singular.toLowerCase()}?`,
        message: `${label ? `"${label}" will be removed for everyone.` : 'It will be removed for everyone.'} ${undoable ? "You'll have a few seconds to undo it." : "This can't be undone" + (masterType === 'employees' ? ' — to just stop someone signing in, use "Turn off" instead.' : '.')}`,
        confirmLabel: 'Delete', danger: true,
    });
    if (!sure) return;
    try {
        await apiCall(`${config.apiEndpoint}/${id}`, { method: 'DELETE' });
        if (undoable && record) {
            const snapshot = snapshotForUndo(record);
            showToast(`${label ? `"${label}"` : config.singular} deleted`, 'success', { action: { label: 'Undo', onClick: () => undoDelete(snapshot, label, masterType) } });
        } else {
            showToast('Deleted successfully!', 'success');
        }
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
