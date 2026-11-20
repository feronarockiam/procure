// Roles & Access — what an administrator sees.
//
// Nothing here knows what a permission means. The server sends the wording (the catalogue), the rules
// (what each choice needs), and a plain-language summary of any combination of choices (/roles/preview).
// This file only draws them, so the page can never disagree with what the server will enforce.

let catalogue = null;     // sections, teams, screens: from GET /roles/catalogue
let allRoles = [];        // from GET /roles
let editor = null;        // the role being created or edited
let previewTimer = null;
let previewSeq = 0;

const BADGE_COLORS = ['#3B9FD9', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#6366F1', '#D97706', '#64748B'];
const TEAM_ICONS = { admin: 'ph-shield-star', sales: 'ph-shopping-cart-simple', purchase: 'ph-package', key_accounts: 'ph-handshake' };
const ALL_VIEW = 'enquiry.view.all';
const OTHER_VIEWS = ['enquiry.view.own', 'enquiry.view.assigned', 'enquiry.view.assigned_customers'];

// ── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const user = checkAuth();
    if (!user) return;
    if (!requirePageAccess('/role-management.html')) return;

    if (hasPermission('role.create')) document.getElementById('createRoleBtn').style.display = '';
    if (!canOpenHref('/masters.html?type=employees')) {
        // the third step still reads fine without a link
        const link = document.getElementById('employeesLink');
        if (link) link.replaceWith(document.createTextNode('Employees'));
    }

    wireEditor();
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        // the shared Escape handler (ui.js) closes the top-most window through its own close button, so nothing to do here
    });

    await Promise.all([loadCatalogue(), loadRoles()]);
});

async function loadCatalogue() {
    try {
        catalogue = await apiCall('/roles/catalogue');
    } catch (err) {
        showToast("Couldn't load the list of things a role can allow: " + err.message, 'error');
    }
}

async function loadRoles() {
    try {
        allRoles = await apiCall('/roles');
        renderRoles();
    } catch (err) {
        if (!err.handled) showToast("Couldn't load roles: " + err.message, 'error');
    }
}

// ── The role cards ───────────────────────────────────────────────────────────

function startsOnLabel(role) {
    if (!role.landingPage) return null;
    const meta = NAV_META['/' + role.landingPage];
    return meta ? meta.label : role.landingPage;
}

function peopleLabel(count) {
    if (count === 0) return 'No one has this role yet';
    return `${count} ${count === 1 ? 'person has' : 'people have'} this role`;
}

function renderRoles() {
    const grid = document.getElementById('rolesGrid');
    if (!allRoles.length) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <i class="ph ph-shield-slash"></i>
                <p style="font-weight:600;margin-bottom:0.5rem">No roles yet</p>
                <p style="font-size:0.85rem">Create your first role to get started.</p>
            </div>`;
        return;
    }

    const canEdit = hasPermission('role.edit');
    const canCreate = hasPermission('role.create');
    const canDelete = hasPermission('role.delete');
    const teams = Object.fromEntries((catalogue ? catalogue.teams : []).map(t => [t.value, t.label]));

    grid.innerHTML = allRoles.map(role => {
        const color = /^#[0-9a-fA-F]{6}$/.test(role.color) ? role.color : '#3B9FD9';
        const lines = role.summary.lines.map(line => `
            <div class="rm-line"><i class="ph ph-${escapeHtml(line.icon)}"></i>
                <div><b>${escapeHtml(line.title)}:</b> <span class="rm-text">${escapeHtml(line.text)}</span></div>
            </div>`).join('');
        const start = startsOnLabel(role);
        const warn = role.warnings.find(w => w.level === 'warning');
        const deleteTip = role.isSystem ? 'Built-in roles can be edited but not deleted' : 'Delete this role';

        return `
        <div class="role-card" data-role="${escapeHtml(role._id)}">
            <div class="role-card-accent" style="background:${color}"></div>
            <div class="role-card-head">
                <div class="role-name"><i class="ph ${TEAM_ICONS[role.category] || 'ph-circle'}" style="color:${color}"></i>${escapeHtml(role.name)}</div>
            </div>
            <div class="role-desc">${role.description ? escapeHtml(role.description) : '<i>No description yet</i>'}</div>
            <div class="rm-chips">
                ${role.isSystem ? '<span class="rm-chip" title="Built-in roles come with the app. You can change what they allow, but not delete them."><i class="ph ph-lock-simple"></i> Built-in</span>' : ''}
                <span class="rm-chip">${escapeHtml(teams[role.category] || role.category)}</span>
                ${role.leadsTeam ? '<span class="rm-chip lead" title="Other people can be set to report to someone in this role"><i class="ph ph-users-three"></i> Leads a team</span>' : ''}
                ${warn ? `<span class="rm-chip warn" title="${escapeHtml(warn.text)}"><i class="ph ph-warning"></i> Needs attention</span>` : ''}
            </div>
            <div class="rm-lines" onclick="this.classList.toggle('open')" title="Click to show everything">${lines}</div>
            <div class="role-foot">
                <span><i class="ph ph-arrow-square-out"></i> Starts on: <b>${start ? escapeHtml(start) : 'nothing yet'}</b></span>
                <button type="button" onclick="showPeople('${escapeHtml(role._id)}')">${role.userCount === 0 ? 'No one yet' : role.userCount + (role.userCount === 1 ? ' person' : ' people')}</button>
            </div>
            <div class="role-actions">
                ${canEdit ? `<button class="btn btn-secondary btn-sm" style="flex:1" onclick="openEdit('${escapeHtml(role._id)}')"><i class="ph ph-pencil-simple"></i> Edit</button>` : ''}
                ${canCreate ? `<button class="btn btn-secondary btn-sm" onclick="openCopy('${escapeHtml(role._id)}')" title="Start a new role from this one"><i class="ph ph-copy"></i> Copy</button>` : ''}
                ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="askDelete('${escapeHtml(role._id)}')" title="${deleteTip}" ${role.isSystem ? 'disabled style="opacity:0.45;cursor:not-allowed"' : ''}><i class="ph ph-trash"></i></button>` : ''}
                ${!canEdit && !canCreate && !canDelete ? '<span class="text-muted" style="font-size:0.8rem">View only</span>' : ''}
            </div>
        </div>`;
    }).join('');
}

// ── Small windows ────────────────────────────────────────────────────────────
// (showDialog / closeDialog / confirmDialog come from ui.js, shared by every screen)

async function showPeople(roleId) {
    const role = allRoles.find(r => r._id === roleId);
    if (!role) return;
    try {
        const people = await apiCall(`/roles/${roleId}/members`);
        const list = people.length
            ? `<ul class="rm-people">${people.map(p => `<li>${escapeHtml(p.name)}<small>${escapeHtml(p.email)}</small></li>`).join('')}</ul>`
            : '<p class="text-muted">Nobody has this role yet. Choose it for someone in Employees.</p>';
        const buttons = [{ label: 'Close' }];
        if (canOpenHref('/masters.html?type=employees')) {
            buttons.push({ label: 'Go to Employees', kind: 'primary', onClick: () => { window.location.href = '/masters.html?type=employees'; } });
        }
        showDialog({ title: `Who has "${role.name}"`, bodyHtml: list, buttons });
    } catch (err) {
        if (!err.handled) showToast(err.message, 'error');
    }
}

// ── Deleting ─────────────────────────────────────────────────────────────────

async function askDelete(roleId) {
    const role = allRoles.find(r => r._id === roleId);
    if (!role) return;
    if (role.isSystem) {
        showDialog({ title: 'Built-in role', bodyHtml: '<p>Built-in roles come with the app, so they can be edited but not deleted.</p>', buttons: [{ label: 'OK', kind: 'primary' }] });
        return;
    }
    if (role.userCount > 0) {
        const buttons = [{ label: 'Close' }];
        if (canOpenHref('/masters.html?type=employees')) buttons.push({ label: 'Go to Employees', kind: 'primary', onClick: () => { window.location.href = '/masters.html?type=employees'; } });
        showDialog({
            title: `Can't delete "${role.name}" yet`,
            bodyHtml: `<p>${peopleLabel(role.userCount)}. Give ${role.userCount === 1 ? 'them' : 'each of them'} a different role in Employees first, then come back to delete this one.</p>`,
            buttons,
        });
        return;
    }
    showDialog({
        title: `Delete "${role.name}"?`,
        bodyHtml: '<p>Nobody has this role, so no one will notice. This can\'t be undone.</p>',
        buttons: [
            { label: 'Keep it' },
            { label: 'Delete role', kind: 'danger', onClick: () => doDelete(role) },
        ],
    });
}

async function doDelete(role) {
    try {
        await apiCall(`/roles/${role._id}`, { method: 'DELETE' });
        showToast(`"${role.name}" was deleted`, 'success');
        await loadRoles();
    } catch (err) {
        if (!err.handled) showToast(err.message, 'error');
        await loadRoles();
    }
}

// ── The editor: opening ──────────────────────────────────────────────────────

function blankEditor() {
    return {
        id: null, isSystem: false, isAdminRole: false, userCount: 0,
        name: '', description: '', category: 'sales', leadsTeam: false, color: BADGE_COLORS[0],
        permissions: new Set(), dashboardPage: 'auto',
        preview: null, autoAdded: new Map(), startFrom: 'blank', dirty: false,
    };
}

function applyRoleToEditor(role, { copy }) {
    editor.category = role.category;
    editor.leadsTeam = !!role.leadsTeam;
    editor.permissions = new Set(role.permissions || []);
    if (copy) {
        editor.name = `Copy of ${role.name}`;
        editor.description = role.description || '';
        editor.color = role.color;
        editor.dashboardPage = 'auto';
    }
}

function openCreate() {
    if (!hasPermission('role.create')) { showToast("You don't have permission to create roles", 'error'); return; }
    if (!catalogue) { showToast("The list of things a role can allow hasn't loaded. Reload the page and try again.", 'error'); return; }
    editor = blankEditor();
    openEditorWindow('Create a role', 'Create role');
}

function openCopy(roleId) {
    const role = allRoles.find(r => r._id === roleId);
    if (!role) return;
    if (!catalogue) { showToast("The list of things a role can allow hasn't loaded. Reload the page and try again.", 'error'); return; }
    editor = blankEditor();
    applyRoleToEditor(role, { copy: true });
    editor.startFrom = roleId;
    editor.dirty = true;
    openEditorWindow(`Create a role (copy of ${role.name})`, 'Create role');
}

function openEdit(roleId) {
    if (!hasPermission('role.edit')) { showToast("You don't have permission to edit roles", 'error'); return; }
    const role = allRoles.find(r => r._id === roleId);
    if (!role) return;
    if (!catalogue) { showToast("The list of things a role can allow hasn't loaded. Reload the page and try again.", 'error'); return; }
    editor = blankEditor();
    editor.id = role._id;
    editor.isSystem = !!role.isSystem;
    editor.isAdminRole = !!role.isSystem && role.category === 'admin';
    editor.userCount = role.userCount;
    editor.name = role.name;
    editor.description = role.description || '';
    editor.color = role.color;
    editor.dashboardPage = role.dashboardPage;
    applyRoleToEditor(role, { copy: false });
    openEditorWindow(`Edit role: ${role.name}`, 'Save changes');
}

function openEditorWindow(title, saveLabel) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('saveLabel').textContent = saveLabel;
    showFormError('');
    renderEditor();
    document.getElementById('roleModal').classList.add('active');
    syncEditor();
    refreshPreview(true);
    const nameField = document.getElementById('f_name');
    if (nameField && !editor.name) setTimeout(() => nameField.focus(), 60);
}

function requestClose() {
    if (!editor || !editor.dirty) { closeEditor(); return; }
    showDialog({
        title: 'Close without saving?',
        bodyHtml: '<p>Your changes to this role haven\'t been saved.</p>',
        buttons: [{ label: 'Keep editing' }, { label: 'Close without saving', kind: 'danger', onClick: closeEditor }],
    });
}
function closeEditor() {
    document.getElementById('roleModal').classList.remove('active');
    editor = null;
}

function showFormError(message) {
    const box = document.getElementById('formError');
    document.getElementById('formErrorText').textContent = message;
    box.classList.toggle('show', !!message);
    if (message) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── The editor: drawing ──────────────────────────────────────────────────────

const permId = (key) => 'p_' + key.replace(/\./g, '_');

function checklistHtml(section) {
    return `
        <div class="rm-section">
            <div class="rm-section-head"><b>${escapeHtml(section.title)}</b>${section.intro ? `<span>${escapeHtml(section.intro)}</span>` : ''}</div>
            ${section.items.map(item => `
                <label class="rm-check" data-key="${escapeHtml(item.key)}" for="${permId(item.key)}">
                    <input type="checkbox" id="${permId(item.key)}" data-perm="${escapeHtml(item.key)}">
                    <span>
                        <span class="rm-check-label">${escapeHtml(item.label)}</span>
                        ${item.help ? `<span class="rm-check-help">${escapeHtml(item.help)}</span>` : ''}
                    </span>
                </label>`).join('')}
        </div>`;
}

function matrixHtml(section) {
    return `
        <div class="rm-section">
            <div class="rm-section-head"><b>${escapeHtml(section.title)}</b>${section.intro ? `<span>${escapeHtml(section.intro)}</span>` : ''}</div>
            <table class="rm-matrix">
                <thead><tr><th>List</th>${section.columns.map(c => `<th class="${c.sensitive ? 'sens' : ''}">${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
                <tbody>
                    ${section.rows.map(row => `
                        <tr>
                            <th scope="row">${escapeHtml(row.label)}${row.sensitive ? '<span class="rm-tag" title="Lets them change what other people can do">Sensitive</span>' : ''}
                                <small>${escapeHtml(row.help)}</small></th>
                            ${section.columns.map(col => `
                                <td><input type="checkbox" data-perm="${escapeHtml(row.keys[col.id])}" data-row="${escapeHtml(row.id)}" data-col="${escapeHtml(col.id)}"
                                    aria-label="${escapeHtml(col.label)}: ${escapeHtml(row.label)}"></td>`).join('')}
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}

function renderEditor() {
    const teams = catalogue.teams;
    const copyChoices = allRoles.map(r => `<option value="${escapeHtml(r._id)}" ${editor.startFrom === r._id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
    const banner = editor.isAdminRole
        ? '<div class="rm-banner"><i class="ph ph-lock-simple"></i><div><b>This is the built-in Admin role.</b> It keeps everything so the system can always be managed. You can change its description and colour.</div></div>'
        : editor.isSystem
            ? '<div class="rm-banner"><i class="ph ph-info"></i><div><b>This is a built-in role.</b> You can change what it allows, but it can\'t be deleted.</div></div>'
            : '';

    document.getElementById('editorBody').innerHTML = `
        ${banner}
        <div class="rm-editor">
          <div>
            <div class="rm-block">
                <div class="rm-block-title"><span class="rm-num">1</span> About this role</div>
                <div class="rm-grid2" style="margin-top:0.75rem">
                    <div class="rm-field form-group">
                        <label for="f_name">Role name <span style="color:var(--danger)">*</span></label>
                        <input type="text" id="f_name" maxlength="60" placeholder="e.g. Sales Executive" ${editor.isAdminRole ? 'disabled' : ''}>
                        <div class="rm-hint">This is what people see next to their name.</div>
                    </div>
                    <div class="rm-field form-group">
                        <label for="f_team">Which team is this for?</label>
                        <select id="f_team" ${editor.isAdminRole ? 'disabled' : ''}>
                            ${teams.map(t => `<option value="${escapeHtml(t.value)}">${escapeHtml(t.label)}</option>`).join('')}
                        </select>
                        <div class="rm-hint" id="teamHint"></div>
                    </div>
                </div>
                <div class="rm-field form-group">
                    <label for="f_desc">What is this role for? <span class="text-muted" style="font-weight:400">(optional)</span></label>
                    <input type="text" id="f_desc" maxlength="200" placeholder="e.g. Raises enquiries, gets vendor prices and sends quotations">
                </div>
                <div class="rm-field form-group">
                    <label>Badge colour</label>
                    <div class="color-swatches" id="colorSwatches">
                        ${BADGE_COLORS.map(c => `<div class="color-swatch" data-color="${c}" style="background:${c}" role="button" aria-label="Colour ${c}"></div>`).join('')}
                    </div>
                </div>
                <label class="rm-inline-check" for="f_leads">
                    <input type="checkbox" id="f_leads" ${editor.isAdminRole ? 'disabled' : ''}>
                    <div><b>People in this role lead a team</b>
                    <span>Tick this for managers and team leads. In Employees, other people can then be set to report to someone with this role.</span></div>
                </label>
            </div>

            ${editor.id ? '' : `
            <div class="rm-block">
                <div class="rm-block-title"><span class="rm-num">2</span> Start from</div>
                <div class="rm-block-help">Copy an existing role as a starting point, or begin with a blank one.</div>
                <select id="f_start">
                    <option value="blank">A blank role</option>
                    ${(catalogue.templates || []).length ? `<optgroup label="Ready-made roles">${catalogue.templates.map(t => `<option value="tpl:${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('')}</optgroup>` : ''}
                    <optgroup label="Copy what an existing role allows">${copyChoices}</optgroup>
                </select>
            </div>`}

            <div class="rm-block">
                <div class="rm-block-title"><span class="rm-num">${editor.id ? 2 : 3}</span> What can this role do?</div>
                <div class="rm-block-help">Tick what people in this role should be able to do. If something needs something else to work, we'll switch it on for you and tell you.</div>
                ${catalogue.sections.map(s => s.type === 'matrix' ? matrixHtml(s) : checklistHtml(s)).join('')}
            </div>

            <div class="rm-block">
                <div class="rm-block-title"><span class="rm-num">${editor.id ? 3 : 4}</span> Which screen do they see first?</div>
                <div class="rm-block-help">The first screen after they log in. Only screens this role can open are listed.</div>
                <select id="f_page"></select>
            </div>
          </div>

          <aside class="rm-preview"><div id="previewPanel"></div></aside>
        </div>`;

    // fill in what was typed / chosen
    document.getElementById('f_name').value = editor.name;
    document.getElementById('f_desc').value = editor.description;
    document.getElementById('f_team').value = editor.category;
    document.getElementById('f_leads').checked = editor.leadsTeam;
    updateTeamHint();
    document.querySelectorAll('#colorSwatches .color-swatch').forEach(el => el.classList.toggle('selected', el.dataset.color === editor.color));
}

function updateTeamHint() {
    const team = catalogue.teams.find(t => t.value === editor.category);
    document.getElementById('teamHint').textContent = (team ? team.help + ' ' : '') + 'This groups people. It does not limit what the role can do.';
}

// Listens once, for every editor that is opened afterwards (the form's contents are replaced each time)
function wireEditor() {
    const body = document.getElementById('editorBody');
    body.addEventListener('input', (event) => {
        if (!editor) return;
        if (event.target.id === 'f_name') editor.name = event.target.value;
        else if (event.target.id === 'f_desc') editor.description = event.target.value;
        else return;
        editor.dirty = true;
        renderPreviewPanel();
    });
    body.addEventListener('change', (event) => {
        if (!editor) return;
        const target = event.target;
        if (target.id === 'f_team') { editor.category = target.value; updateTeamHint(); refreshPreview(); }
        else if (target.id === 'f_leads') { editor.leadsTeam = target.checked; }
        else if (target.id === 'f_page') { editor.dashboardPage = target.value; }
        else if (target.id === 'f_start') { startFrom(target.value); return; }
        else if (target.dataset && target.dataset.perm) { togglePermission(target.dataset.perm, target.checked, target); return; }
        editor.dirty = true;
        syncEditor();
    });
    body.addEventListener('click', (event) => {
        const swatch = event.target.closest('.color-swatch');
        if (!swatch || !editor) return;
        editor.color = swatch.dataset.color;
        editor.dirty = true;
        syncEditor();
    });
}

function startFrom(value) {
    editor.startFrom = value;
    editor.autoAdded = new Map();
    if (value === 'blank') {
        editor.permissions = new Set();
        editor.leadsTeam = false;
    } else if (value.startsWith('tpl:')) {
        const template = (catalogue.templates || []).find(t => t.id === value.slice(4));
        if (template) {
            editor.permissions = new Set(template.permissions);
            editor.category = template.category;
            editor.leadsTeam = !!template.leadsTeam;
            if (!editor.name.trim()) editor.name = template.name;
            if (!editor.description.trim()) editor.description = template.description;
            document.getElementById('f_desc').value = editor.description;
        }
    } else {
        const role = allRoles.find(r => r._id === value);
        if (role) {
            editor.permissions = new Set(role.permissions || []);
            editor.category = role.category;
            editor.leadsTeam = !!role.leadsTeam;
            if (!editor.name.trim()) editor.name = `Copy of ${role.name}`;
        }
    }
    editor.dashboardPage = 'auto';
    editor.dirty = true;
    document.getElementById('f_name').value = editor.name;
    document.getElementById('f_team').value = editor.category;
    document.getElementById('f_leads').checked = editor.leadsTeam;
    updateTeamHint();
    syncEditor();
    refreshPreview();
}

// ── The editor: ticking things ───────────────────────────────────────────────

function rowKeys(rowId) {
    const row = catalogue.sections.find(s => s.type === 'matrix').rows.find(r => r.id === rowId);
    return row ? row.keys : null;
}

function togglePermission(key, on, input) {
    if (on) editor.permissions.add(key); else editor.permissions.delete(key);

    // In a list row, "See the list" is the base: taking it away takes the rest away too
    if (input && input.dataset.row && input.dataset.col === 'view' && !on) {
        const keys = rowKeys(input.dataset.row);
        if (keys) ['create', 'edit', 'delete'].forEach(c => editor.permissions.delete(keys[c]));
    }
    // A choice the person just un-ticked is no longer something we added for them
    if (!on) editor.autoAdded.delete(key);

    editor.dirty = true;
    syncEditor();
    refreshPreview();
}

// Re-draw every checkbox from the editor's state
function syncEditor() {
    if (!editor) return;
    const viewAll = editor.permissions.has(ALL_VIEW);
    const mine = new Set(getUser().permissions || []);

    document.querySelectorAll('#editorBody input[data-perm]').forEach(input => {
        const key = input.dataset.perm;
        const includedByAll = viewAll && OTHER_VIEWS.includes(key);
        const has = editor.permissions.has(key);
        // you can't switch on access you don't have yourself (you may still switch it off)
        const notYours = !has && !mine.has(key) && !includedByAll;
        input.checked = has || includedByAll;
        input.disabled = editor.isAdminRole || includedByAll || notYours;
        input.title = notYours ? "You can't give access you don't have yourself" : '';
        const label = input.closest('label.rm-check');
        if (label) {
            label.classList.toggle('disabled', input.disabled);
            label.classList.toggle('included', includedByAll);
            label.title = input.title;
        }
    });

    document.querySelectorAll('#colorSwatches .color-swatch').forEach(el => el.classList.toggle('selected', el.dataset.color === editor.color));
    renderPreviewPanel();
}

// ── The editor: the live "what this means" panel ─────────────────────────────

function refreshPreview(immediate) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, immediate ? 0 : 140);
}

async function runPreview() {
    if (!editor) return;
    const seq = ++previewSeq;
    try {
        const result = await apiCall('/roles/preview', {
            method: 'POST',
            body: JSON.stringify({
                permissions: [...editor.permissions],
                category: editor.category,
                dashboardPage: editor.dashboardPage === 'auto' ? undefined : editor.dashboardPage,
            }),
        });
        if (!editor || seq !== previewSeq) return; // a newer answer is on its way
        // Anything the server switched on becomes ticked, and we keep telling the person why
        for (const added of result.added) {
            editor.permissions.add(added.key);
            editor.autoAdded.set(added.key, added.because);
        }
        editor.preview = result;
        // the chosen starting screen has to be one this role can open
        if (editor.dashboardPage !== 'auto' && !result.pages.some(p => p.file === editor.dashboardPage)) editor.dashboardPage = 'auto';
        syncEditor();
        renderStartSelect();
    } catch (err) {
        if (err.handled) return;
        // the panel simply stays as it was; saving still works and the server will explain anything wrong
    }
}

function renderStartSelect() {
    const select = document.getElementById('f_page');
    if (!select || !editor.preview) return;
    const pages = editor.preview.pages;
    const auto = editor.preview.landingPage;
    const autoLabel = auto && NAV_META['/' + auto] ? NAV_META['/' + auto].label : null;
    select.innerHTML =
        `<option value="auto">Automatic${autoLabel ? ` (${escapeHtml(autoLabel)})` : ''}: recommended</option>` +
        pages.map(p => `<option value="${escapeHtml(p.file)}">${escapeHtml(p.label)}</option>`).join('');
    select.value = editor.dashboardPage;
    select.disabled = editor.isAdminRole;
}

function renderPreviewPanel() {
    const panel = document.getElementById('previewPanel');
    if (!panel || !editor) return;
    const p = editor.preview;
    const color = editor.color;
    const label = (editor.name || '').trim() || 'New role';

    const lines = p ? p.summary.lines : [];
    const linesHtml = lines.map(line => `
        <div class="rm-line"><i class="ph ph-${escapeHtml(line.icon)}"></i>
            <div><b>${escapeHtml(line.title)}:</b> <span class="rm-text">${escapeHtml(line.text)}</span></div></div>`).join('');

    // explanations for choices we switched on, for as long as they are still ticked
    const notes = [];
    for (const [key, because] of editor.autoAdded) {
        if (!editor.permissions.has(key)) continue;
        notes.push(`<div class="rm-note info"><i class="ph ph-info"></i><span>We also turned on <b>${escapeHtml(labelFor(key))}</b> because <b>${escapeHtml(labelFor(because))}</b> needs it.</span></div>`);
    }
    for (const w of (p ? p.warnings : [])) {
        notes.push(`<div class="rm-note ${w.level === 'warning' ? 'warning' : 'info'}"><i class="ph ph-${w.level === 'warning' ? 'warning' : 'info'}"></i><span>${escapeHtml(w.text)}</span></div>`);
    }
    if (editor.id && editor.userCount > 0) {
        notes.push(`<div class="rm-note warning"><i class="ph ph-users"></i><span>${escapeHtml(peopleLabel(editor.userCount))}. Changes apply to ${editor.userCount === 1 ? 'them' : 'them'} straight away.</span></div>`);
    }

    const landing = p && p.landingPage ? (NAV_META['/' + p.landingPage] ? NAV_META['/' + p.landingPage].label : p.landingPage) : null;
    panel.innerHTML = `
        <div class="rm-preview-card">
            <div class="rm-preview-title">What this role means</div>
            <span class="rm-badge" style="background:${color}22;color:${readableTextColor(color)};border-color:${color}66">${escapeHtml(label)}</span>
            <div class="rm-lines">${linesHtml || '<div class="text-muted" style="font-size:0.8rem">Loading…</div>'}</div>
            <div class="rm-start"><i class="ph ph-arrow-square-out"></i> Starts on: <b>${landing ? escapeHtml(landing) : 'nothing yet'}</b></div>
            ${notes.join('')}
        </div>`;
}

// How a list permission reads in a sentence (mirrors the server's wording)
const RECORD_PHRASES = {
    view: (name) => `See the ${name} list`,
    create: (name) => `Add to ${name}`,
    edit: (name) => `Edit ${name}`,
    delete: (name) => `Delete from ${name}`,
};

// Plain wording for a permission key, from the catalogue
function labelFor(key) {
    for (const section of catalogue.sections) {
        if (section.items) {
            const item = section.items.find(i => i.key === key);
            if (item) return item.label;
        } else {
            for (const row of section.rows) {
                const col = section.columns.find(c => row.keys[c.id] === key);
                if (col) return RECORD_PHRASES[col.id](row.label);
            }
        }
    }
    return key;
}

// ── Saving ───────────────────────────────────────────────────────────────────

async function saveRole() {
    if (!editor) return;
    showFormError('');

    const name = editor.name.trim();
    if (!name) {
        showFormError('Give the role a name, for example "Sales Executive".');
        document.getElementById('f_name').focus();
        return;
    }

    const payload = {
        name,
        description: editor.description.trim(),
        category: editor.category,
        leadsTeam: editor.leadsTeam,
        color: editor.color,
        permissions: [...editor.permissions],
        dashboardPage: editor.dashboardPage === 'auto' ? 'auto' : editor.dashboardPage,
    };
    // the built-in Admin role only accepts description and colour
    if (editor.isAdminRole) {
        delete payload.name; delete payload.category; delete payload.leadsTeam; delete payload.permissions; delete payload.dashboardPage;
    }

    const button = document.getElementById('saveRoleBtn');
    button.disabled = true;
    try {
        const saved = editor.id
            ? await apiCall(`/roles/${editor.id}`, { method: 'PUT', body: JSON.stringify(payload) })
            : await apiCall('/roles', { method: 'POST', body: JSON.stringify(payload) });

        const extra = (saved.notices || []).filter(n => !/^We also turned on/.test(n));
        showToast(`"${saved.name}" ${editor.id ? 'was updated' : 'was created'}${extra.length ? '. ' + extra.join(' ') : ''}`, 'success');
        const wasNew = !editor.id;
        closeEditor();
        await loadRoles();
        if (wasNew && canOpenHref('/masters.html?type=employees')) {
            showDialog({
                title: 'Role created',
                bodyHtml: `<p><b>${escapeHtml(saved.name)}</b> is ready. To use it, choose it for a person in Employees.</p>`,
                buttons: [{ label: 'Later' }, { label: 'Go to Employees', kind: 'primary', onClick: () => { window.location.href = '/masters.html?type=employees'; } }],
            });
        }
    } catch (err) {
        if (!err.handled) showFormError(err.message);
    } finally {
        button.disabled = false;
    }
}
