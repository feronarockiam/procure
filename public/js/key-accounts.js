// Key Accounts Dashboard Logic

let allEnquiries = { new: [], open: [], updated: [], completed: [] };
let currentTab = 'new';
let currentQueryEnquiryId = null;
let currentDetailEnquiry = null;
let kamUsers = [];
let viewMode = localStorage.getItem('viewMode_kam') || 'enquiry'; // 'enquiry' | 'material' | 'items'
let currentMainTab = localStorage.getItem('kamMainTab') || 'clients';
let allClients = [];
let selectedClientId = null;
let selectedClientName = null;
let allTeamKAEs = [];
let kaeFilter = null; // { kaeId, kaeName } — filters Enquiries tab to a KAE's clients

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const user = checkAuth();
    if (!user) return;

    if (!hasAnyPermission(['enquiry.view.assigned_customers', 'enquiry.view.all'])) {
        showToast('You do not have permission to view this page', 'error');
        setTimeout(() => window.location.href = '/', 1500);
        return;
    }

    const navName = document.getElementById('navUserName');
    const navRole = document.getElementById('navUserRole');
    if (navName) navName.textContent = user.name || 'User';
    if (navRole) navRole.textContent = user.roleName || user.role || 'Key Accounts';

    const isKAMManager = hasPermission('filter.by_key_account_manager');

    if (isKAMManager) {
        await loadKamUsers();
        // Show My Team tab
        const teamBtn = document.getElementById('teamTabBtn');
        if (teamBtn) teamBtn.style.display = '';
    }

    const loaders = [loadClients(), loadAllTabs()];
    if (isKAMManager) loaders.push(loadTeamKAEs());
    await Promise.all(loaders);

    // Validate saved tab — KAE can't access 'team' tab
    if (currentMainTab === 'team' && !isKAMManager) currentMainTab = 'clients';
    switchMainTab(currentMainTab);
});

// ── Data Loading ─────────────────────────────────────────────────────────────

async function loadAllTabs() {
    try {
        const stages = ['new', 'open', 'updated', 'completed'];
        const results = await Promise.all(stages.map(s => fetchEnquiriesForStage(s)));
        stages.forEach((s, i) => { allEnquiries[s] = results[i]; });
        updateBadges();
        updateStats();
        const tog = document.getElementById('viewToggleContainer');
        if (tog) tog.innerHTML = getViewToggleHTML(viewMode);
        renderCurrentTab();
    } catch (err) {
        showToast('Failed to load enquiries: ' + err.message, 'error');
    }
}

async function fetchEnquiriesForStage(stage) {
    const kamFilter = document.getElementById('kamFilter');
    const kamId = kamFilter && kamFilter.style.display !== 'none' ? kamFilter.value : '';
    let url = `/enquiries?stage=${stage}`;
    if (kamId) url += `&kamUser=${kamId}`;
    try {
        return await apiCall(url);
    } catch {
        return [];
    }
}

async function loadKamUsers() {
    try {
        const users = await apiCall('/users/by-category?category=key_accounts');
        kamUsers = users || [];
        const sel = document.getElementById('kamFilter');
        if (!sel) return;
        sel.style.display = '';
        kamUsers.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u._id;
            opt.textContent = u.name;
            sel.appendChild(opt);
        });
    } catch { /* filter optional */ }
}

// ── Client Loading ────────────────────────────────────────────────────────────

async function loadClients() {
    try {
        const user = getUser();
        let clients;
        if (hasPermission('filter.by_key_account_manager')) {
            // KAM Manager — see only their team's clients (direct + KAEs')
            clients = await apiCall('/customers/my-team');
        } else {
            // KAM Entry — only their directly assigned clients
            clients = await apiCall(`/customers/by-kam/${user.id}`);
        }
        allClients = clients || [];
        const badge = document.getElementById('badge-clients');
        if (badge) badge.textContent = allClients.length;
    } catch (err) {
        allClients = [];
    }
}

async function loadTeamKAEs() {
    try {
        const team = await apiCall('/users/my-kae-team');
        allTeamKAEs = team || [];
        const badge = document.getElementById('badge-team');
        if (badge) badge.textContent = allTeamKAEs.length;
    } catch (err) {
        allTeamKAEs = [];
    }
}

// ── Main Section Tab Switching ────────────────────────────────────────────────

function switchMainTab(tab) {
    currentMainTab = tab;
    localStorage.setItem('kamMainTab', tab);

    document.querySelectorAll('.section-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    const clientsSection = document.getElementById('clientsSection');
    const enquiriesSection = document.getElementById('enquiriesSection');
    const teamSection = document.getElementById('teamSection');
    if (clientsSection) clientsSection.style.display = tab === 'clients' ? '' : 'none';
    if (enquiriesSection) enquiriesSection.style.display = tab === 'enquiries' ? '' : 'none';
    if (teamSection) teamSection.style.display = tab === 'team' ? '' : 'none';

    if (tab === 'clients') renderClientsTab();
    if (tab === 'team') renderTeamTab();
}

// ── Client Portfolio Rendering ────────────────────────────────────────────────

function renderClientsTab() {
    const grid = document.getElementById('clientsGrid');
    if (!grid) return;

    const search = (document.getElementById('clientSearch')?.value || '').toLowerCase();
    const isManager = hasPermission('filter.by_key_account_manager') || hasPermission('customer.view');

    let list = allClients;
    if (search) {
        list = list.filter(c =>
            (c.name || '').toLowerCase().includes(search) ||
            (c.contactPerson || '').toLowerCase().includes(search) ||
            (c.email || '').toLowerCase().includes(search)
        );
    }

    if (!list.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <i class="ph ph-buildings"></i>
            <p style="font-weight:600;margin-bottom:0.5rem">${search ? 'No matching clients' : 'No clients assigned'}</p>
            <p style="font-size:0.85rem">${search ? 'Try a different search term.' : 'Clients assigned to you will appear here.'}</p>
        </div>`;
        return;
    }

    grid.innerHTML = list.map(c => {
        const stats = getClientStats(c._id);
        const initial = (c.name || '?').charAt(0).toUpperCase();
        const kamBadge = isManager && c.assignedKAM
            ? `<span style="font-size:0.72rem;background:var(--primary-light);color:var(--primary-dark);padding:0.2rem 0.5rem;border-radius:999px;white-space:nowrap;border:1px solid var(--primary)">${c.assignedKAM.name}</span>`
            : '';

        const lastActivity = stats.lastDate
            ? (() => {
                const diff = Math.floor((Date.now() - new Date(stats.lastDate)) / 86400000);
                return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : `${diff} days ago`;
              })()
            : '—';

        return `
        <div class="client-card" onclick="viewClientEnquiries('${c._id}', '${c.name.replace(/'/g, "\\'")}')">
            <div class="client-card-header">
                <div class="client-avatar">${initial}</div>
                <div class="client-info">
                    <div class="client-name">${c.name}</div>
                    ${c.contactPerson ? `<div class="client-contact"><i class="ph ph-user" style="font-size:0.72rem"></i> ${c.contactPerson}</div>` : ''}
                    ${c.email ? `<div class="client-contact" style="color:var(--text-muted)"><i class="ph ph-envelope" style="font-size:0.72rem"></i> ${c.email}</div>` : ''}
                </div>
                ${kamBadge}
            </div>
            <div class="client-stats">
                <div class="client-stat">
                    <div class="client-stat-val" style="color:#C2410C">${stats.active}</div>
                    <div class="client-stat-lbl">Active</div>
                </div>
                <div class="client-stat">
                    <div class="client-stat-val" style="color:#15803D">${stats.completed}</div>
                    <div class="client-stat-lbl">Completed</div>
                </div>
                <div class="client-stat">
                    <div class="client-stat-val">${stats.total}</div>
                    <div class="client-stat-lbl">Total</div>
                </div>
                <div class="client-stat" style="border-left:1px solid var(--border);padding-left:1rem">
                    <div class="client-stat-val" style="font-size:0.8rem;color:var(--text-muted)">${lastActivity}</div>
                    <div class="client-stat-lbl">Last Activity</div>
                </div>
                <div style="margin-left:auto;align-self:center">
                    <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();viewClientEnquiries('${c._id}', '${c.name.replace(/'/g, "\\'")}')">
                        <i class="ph ph-arrow-right"></i> View
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function getClientStats(customerId) {
    const cid = String(customerId);
    const match = e => String(e.customerId?._id || e.customerId) === cid;
    const active = ['new','open','updated'].flatMap(s => allEnquiries[s] || []).filter(match).length;
    const completed = (allEnquiries.completed || []).filter(match).length;
    const all = Object.values(allEnquiries).flat().filter(match);
    const total = all.length;
    const lastDate = all.length
        ? all.reduce((max, e) => (e.createdAt > max ? e.createdAt : max), all[0].createdAt)
        : null;
    return { active, completed, total, lastDate };
}

function viewClientEnquiries(clientId, clientName) {
    selectedClientId = clientId;
    selectedClientName = clientName;
    // Clear KAE filter to avoid conflict
    kaeFilter = null;
    const kaeChip = document.getElementById('kaeFilterChip');
    if (kaeChip) kaeChip.style.display = 'none';
    switchMainTab('enquiries');
    const chip = document.getElementById('clientFilterChip');
    const nameEl = document.getElementById('clientFilterName');
    if (chip) chip.style.display = '';
    if (nameEl) nameEl.textContent = clientName;
    renderCurrentTab();
}

function clearClientFilter() {
    selectedClientId = null;
    selectedClientName = null;
    const chip = document.getElementById('clientFilterChip');
    if (chip) chip.style.display = 'none';
    renderCurrentTab();
}

// ── Team Tab ──────────────────────────────────────────────────────────────────

function renderTeamTab() {
    const grid = document.getElementById('teamGrid');
    if (!grid) return;

    if (!allTeamKAEs.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <i class="ph ph-users-three"></i>
            <p style="font-weight:600;margin-bottom:0.5rem">No team members yet</p>
            <p style="font-size:0.85rem">Assign KAE employees to yourself as their supervisor in the Employees master.</p>
        </div>`;
        return;
    }

    grid.innerHTML = allTeamKAEs.map(kae => {
        const stats = getKAEStats(kae._id);
        const initial = (kae.name || '?').charAt(0).toUpperCase();
        const roleColor = kae.roleId?.color || '#3B82F6';

        return `
        <div class="client-card" onclick="viewKAEEnquiries('${kae._id}', '${kae.name.replace(/'/g, "\\'")}')">
            <div class="client-card-header">
                <div class="client-avatar" style="background:linear-gradient(135deg,${roleColor},${roleColor}cc)">${initial}</div>
                <div class="client-info">
                    <div class="client-name">${kae.name}</div>
                    <div class="client-contact">
                        <i class="ph ph-envelope" style="font-size:0.72rem"></i> ${kae.email}
                    </div>
                    <div style="margin-top:0.3rem">
                        <span style="font-size:0.72rem;background:${roleColor}18;color:${roleColor};padding:0.15rem 0.5rem;border-radius:999px;border:1px solid ${roleColor}44;font-weight:600">
                            ${kae.roleId?.name || 'KA Entry'}
                        </span>
                    </div>
                </div>
            </div>
            <div class="client-stats">
                <div class="client-stat">
                    <div class="client-stat-val">${stats.clients}</div>
                    <div class="client-stat-lbl">Clients</div>
                </div>
                <div class="client-stat">
                    <div class="client-stat-val" style="color:#C2410C">${stats.active}</div>
                    <div class="client-stat-lbl">Active</div>
                </div>
                <div class="client-stat">
                    <div class="client-stat-val" style="color:#15803D">${stats.completed}</div>
                    <div class="client-stat-lbl">Completed</div>
                </div>
                <div class="client-stat">
                    <div class="client-stat-val">${stats.total}</div>
                    <div class="client-stat-lbl">Total</div>
                </div>
                <div style="margin-left:auto;align-self:center">
                    <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();viewKAEEnquiries('${kae._id}', '${kae.name.replace(/'/g, "\\'")}')">
                        <i class="ph ph-arrow-right"></i> View
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function getKAEClientIds(kaeId) {
    return allClients
        .filter(c => String(c.assignedKAM?._id || c.assignedKAM) === String(kaeId))
        .map(c => String(c._id));
}

function getKAEStats(kaeId) {
    const clientIds = getKAEClientIds(kaeId);
    const clients = clientIds.length;
    const match = e => clientIds.includes(String(e.customerId?._id || e.customerId));
    const active = ['new','open','updated'].flatMap(s => allEnquiries[s] || []).filter(match).length;
    const completed = (allEnquiries.completed || []).filter(match).length;
    const total = active + completed;
    return { clients, active, completed, total };
}

function viewKAEEnquiries(kaeId, kaeName) {
    kaeFilter = { kaeId, kaeName };
    // Clear any client-level filter to avoid conflict
    selectedClientId = null;
    selectedClientName = null;
    const clientChip = document.getElementById('clientFilterChip');
    if (clientChip) clientChip.style.display = 'none';
    // Show KAE chip
    const kaeChip = document.getElementById('kaeFilterChip');
    const kaeNameEl = document.getElementById('kaeFilterName');
    if (kaeChip) kaeChip.style.display = '';
    if (kaeNameEl) kaeNameEl.textContent = kaeName;
    switchMainTab('enquiries');
    renderCurrentTab();
}

function clearKAEFilter() {
    kaeFilter = null;
    const chip = document.getElementById('kaeFilterChip');
    if (chip) chip.style.display = 'none';
    renderCurrentTab();
}

// ── Render ────────────────────────────────────────────────────────────────────

function switchTab(tab) {
    currentTab = tab;

    document.querySelectorAll('.pipeline-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    renderCurrentTab();
}

function applyFilters() {
    renderCurrentTab();
}

function setViewMode(mode) {
    viewMode = mode;
    localStorage.setItem('viewMode_kam', mode);
    const tog = document.getElementById('viewToggleContainer');
    if (tog) tog.innerHTML = getViewToggleHTML(mode);
    renderCurrentTab();
}

function renderCurrentTab() {
    if (viewMode === 'material') { renderMaterialView(); return; }
    if (viewMode === 'items')    { renderItemsView();    return; }

    const container = document.getElementById('enquiriesList');
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const kaeClientIds = kaeFilter ? getKAEClientIds(kaeFilter.kaeId) : null;
    let list = (allEnquiries[currentTab] || []).filter(enq => {
        const custId = String(enq.customerId?._id || enq.customerId);
        if (selectedClientId && custId !== String(selectedClientId)) return false;
        if (kaeClientIds && !kaeClientIds.includes(custId)) return false;
        if (!search) return true;
        const num = (enq.enquiryNumber || '').toLowerCase();
        const cust = (enq.customerId?.name || '').toLowerCase();
        return num.includes(search) || cust.includes(search);
    });

    if (!list.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-inbox"></i>
                <p style="font-weight:600;margin-bottom:0.5rem">No ${currentTab} enquiries</p>
                <p style="font-size:0.85rem">Nothing to show in this stage yet.</p>
            </div>`;
        return;
    }

    container.innerHTML = list.map(enq => renderEnquiryCard(enq)).join('');
}

function renderMaterialView() {
    const container = document.getElementById('enquiriesList');
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const canDownload = hasPermission('quotation.download');
    const canQuery = hasPermission('query.send');

    // Gather items from all tabs (full pipeline visible in material view)
    const _matKaeClientIds = kaeFilter ? getKAEClientIds(kaeFilter.kaeId) : null;
    const allEnqFlat = Object.values(allEnquiries).flat();
    const entries = [];
    for (const enq of allEnqFlat) {
        const _custId = String(enq.customerId?._id || enq.customerId);
        if (selectedClientId && _custId !== String(selectedClientId)) continue;
        if (_matKaeClientIds && !_matKaeClientIds.includes(_custId)) continue;
        for (const item of (enq.items || [])) {
            if (search) {
                const mat = (item.productId?.materialName || '').toLowerCase();
                const brand = (item.productId?.brand || '').toLowerCase();
                const spec = (item.productId?.specification || '').toLowerCase();
                const enqNum = (enq.enquiryNumber || '').toLowerCase();
                const cust = (enq.customerId?.name || '').toLowerCase();
                if (!mat.includes(search) && !brand.includes(search) &&
                    !spec.includes(search) && !enqNum.includes(search) &&
                    !cust.includes(search)) continue;
            }
            entries.push({ item, enquiry: enq });
        }
    }

    const groups = groupByMaterial(entries);

    if (!groups.length) {
        container.innerHTML = `<div class="empty-state">
            <i class="ph ph-cube"></i>
            <p style="font-weight:600;margin-bottom:0.5rem">No materials found</p>
            <p style="font-size:0.85rem">Try adjusting your search.</p></div>`;
        return;
    }

    container.innerHTML = groups.map((group, idx) => {
        const prod = group.product;
        const name = prod?.materialName || 'Unknown';
        const brand = prod?.brand || '';
        const spec = prod?.specification || '';
        const uom = prod?.uom || '';
        const meta = [brand, spec].filter(Boolean).join(' · ');
        const id = `mat-kam-${idx}`;

        const stageLabel = { new: 'New', open: 'Open', updated: 'Updated', completed: 'Completed' };
        const rows = group.entries.map(({ item, enquiry }) => {
            return `<tr>
                <td><span style="font-weight:500;color:var(--primary)">${enquiry.enquiryNumber}</span></td>
                <td>${enquiry.customerId?.name || '—'}</td>
                <td>${item.quantity} ${uom}</td>
                <td><span class="stage-chip stage-${enquiry.stage}">${stageLabel[enquiry.stage] || enquiry.stage}</span></td>
                <td style="font-size:0.78rem;color:var(--text-muted)">${new Date(enquiry.createdAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td>
                <td>
                    <div class="flex gap-1">
                        <button class="btn btn-secondary btn-sm" onclick="openDetail('${enquiry._id}')"><i class="ph ph-eye"></i></button>
                        ${canDownload && enquiry.stage === 'completed' ? `<button class="btn btn-secondary btn-sm" onclick="downloadQuotation('${enquiry._id}','${enquiry.enquiryNumber}')"><i class="ph ph-file-pdf"></i></button>` : ''}
                        ${canQuery ? `<button class="btn btn-secondary btn-sm" onclick="openQueryModal('${enquiry._id}','${enquiry.enquiryNumber}')"><i class="ph ph-chat-dots"></i></button>` : ''}
                    </div>
                </td>
            </tr>`;
        }).join('');

        return `<div class="material-card" id="${id}">
            <div class="material-card-header" onclick="toggleMaterialCard('${id}')">
                <div class="material-icon"><i class="ph ph-cube"></i></div>
                <div>
                    <div class="material-name">${name}</div>
                    ${meta ? `<div class="material-meta-text">${meta}</div>` : ''}
                </div>
                <div class="material-stats">
                    <span class="material-stat-chip">${group.entries.length} enquir${group.entries.length === 1 ? 'y' : 'ies'}</span>
                    <span class="material-stat-chip">${group.totalQty} ${uom}</span>
                </div>
                <i class="ph ph-caret-down material-chevron"></i>
            </div>
            <div class="material-enquiries">
                <table class="items-table" style="width:100%">
                    <thead><tr><th>Enquiry #</th><th>Customer</th><th>Qty</th><th>Stage</th><th>Date</th><th>Actions</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
    }).join('');
}

function renderItemsView() {
    const container = document.getElementById('enquiriesList');
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const canDownload = hasPermission('quotation.download');
    const canQuery = hasPermission('query.send');
    const stageLabel = { new: 'New', open: 'Open', updated: 'Updated', completed: 'Completed' };

    const _itemsKaeClientIds = kaeFilter ? getKAEClientIds(kaeFilter.kaeId) : null;
    const rows = [];
    const allEnqFlat = Object.values(allEnquiries).flat();
    for (const enq of allEnqFlat) {
        const _custId2 = String(enq.customerId?._id || enq.customerId);
        if (selectedClientId && _custId2 !== String(selectedClientId)) continue;
        if (_itemsKaeClientIds && !_itemsKaeClientIds.includes(_custId2)) continue;
        for (const item of (enq.items || [])) {
            if (search) {
                const mat  = (item.productId?.materialName || '').toLowerCase();
                const brand = (item.productId?.brand || '').toLowerCase();
                const spec  = (item.productId?.specification || '').toLowerCase();
                const enqN  = (enq.enquiryNumber || '').toLowerCase();
                const cust  = (enq.customerId?.name || '').toLowerCase();
                if (!mat.includes(search) && !brand.includes(search) &&
                    !spec.includes(search) && !enqN.includes(search) &&
                    !cust.includes(search)) continue;
            }
            const prod = item.productId;
            const uom = prod?.uom || '';
            rows.push(`<tr>
                <td>
                    <div class="mat-primary">${prod?.materialName || '—'}</div>
                    ${(prod?.brand || prod?.specification) ? `<div class="mat-meta">${[prod.brand, prod.specification].filter(Boolean).join(' · ')}</div>` : ''}
                </td>
                <td><span class="enq-ref">${enq.enquiryNumber}</span></td>
                <td style="font-size:0.82rem">${enq.customerId?.name || '—'}</td>
                <td style="white-space:nowrap">${item.quantity} ${uom}</td>
                <td><span class="stage-chip stage-${enq.stage}">${stageLabel[enq.stage] || enq.stage}</span></td>
                <td style="font-size:0.78rem;color:var(--text-muted)">${new Date(enq.createdAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td>
                <td><div class="flex gap-1">
                    <button class="btn btn-secondary btn-sm" onclick="openDetail('${enq._id}')"><i class="ph ph-eye"></i></button>
                    ${canDownload && enq.stage === 'completed' ? `<button class="btn btn-secondary btn-sm" onclick="downloadQuotation('${enq._id}','${enq.enquiryNumber}')"><i class="ph ph-file-pdf"></i></button>` : ''}
                    ${canQuery ? `<button class="btn btn-secondary btn-sm" onclick="openQueryModal('${enq._id}','${enq.enquiryNumber}')"><i class="ph ph-chat-dots"></i></button>` : ''}
                </div></td>
            </tr>`);
        }
    }

    container.innerHTML = buildGlassTable(
        ['Material', 'Enquiry #', 'Customer', 'Qty', 'Stage', 'Date', 'Actions'],
        rows,
        `<strong>${rows.length}</strong> item${rows.length !== 1 ? 's' : ''} across all pipeline stages`
    );
}

function renderEnquiryCard(enq) {
    const customer = enq.customerId?.name || '—';
    const itemCount = enq.items?.length || 0;
    const createdAt = new Date(enq.createdAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    const createdBy = enq.createdBy?.name || '—';
    const stageLabels = { new: 'New', open: 'In Progress', updated: 'Quoted', completed: 'Completed' };
    const stageLabel = stageLabels[enq.stage] || enq.stage;

    const canDownload = hasPermission('quotation.download');
    const canQuery = hasPermission('query.send');

    const items = enq.items || [];
    const counts = {
        unassigned: items.filter(i => ['unassigned','pending'].includes(i.status)).length,
        assigned:   items.filter(i => i.status === 'assigned').length,
        query:      items.filter(i => ['in_sales_query','sales_query_resolved'].includes(i.status)).length,
        quoted:     items.filter(i => i.status === 'vendor_quoted').length,
        priced:     items.filter(i => ['priced','sales_priced'].includes(i.status)).length,
        done:       items.filter(i => ['completed','unsuccessful'].includes(i.status)).length,
    };
    const hasAlert = items.some(i => i.status === 'in_sales_query');

    const chips = [
        counts.unassigned ? `<span class="enq-chip chip-unassigned"><span class="enq-chip-count">${counts.unassigned}</span> Unassigned</span>` : '',
        counts.assigned   ? `<span class="enq-chip chip-assigned"><span class="enq-chip-count">${counts.assigned}</span> Assigned</span>` : '',
        counts.query      ? `<span class="enq-chip chip-query${hasAlert ? ' chip-alert' : ''}"><i class="ph ph-warning-circle"></i><span class="enq-chip-count">${counts.query}</span>${hasAlert ? ' Needs Action' : ' Query'}</span>` : '',
        counts.quoted     ? `<span class="enq-chip chip-quoted"><span class="enq-chip-count">${counts.quoted}</span> Quoted</span>` : '',
        counts.priced     ? `<span class="enq-chip chip-priced"><span class="enq-chip-count">${counts.priced}</span> Priced</span>` : '',
        counts.done       ? `<span class="enq-chip chip-done"><span class="enq-chip-count">${counts.done}</span> Done</span>` : '',
    ].filter(Boolean).join('');

    const cardClass = enq.status === 'completed' ? 'enq-card status-completed'
        : enq.status === 'unsuccessful' ? 'enq-card status-unsuccessful'
        : hasAlert ? 'enq-card has-query'
        : 'enq-card';

    return `
    <div class="${cardClass}">
        <div class="enq-card-head" onclick="openDetail('${enq._id}')">
            <div class="enq-head-left">
                <span class="enq-num-pill"><i class="ph ph-hash"></i>${enq.enquiryNumber}</span>
                <div class="enq-customer">${customer}</div>
                <div class="enq-meta">
                    <span><i class="ph ph-calendar-blank"></i>${createdAt}</span>
                    <span>·</span>
                    <span><i class="ph ph-user"></i>${createdBy}</span>
                    <span>·</span>
                    <span><i class="ph ph-cube"></i>${itemCount} item${itemCount !== 1 ? 's' : ''}</span>
                </div>
            </div>
            <div class="enq-pipeline">
                <span class="stage-chip stage-${enq.stage}">${stageLabel}</span>
                ${chips}
                ${enq.queryCount ? `<span class="enq-chip chip-query"><i class="ph ph-chat-dots"></i><span class="enq-chip-count">${enq.queryCount}</span></span>` : ''}
            </div>
            <div class="enq-head-right">
                ${canQuery ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openQueryModal('${enq._id}','${enq.enquiryNumber}')" title="Queries">
                    <i class="ph ph-chat-dots"></i>${enq.queryCount ? `<span style="font-size:0.7rem;margin-left:0.1rem">${enq.queryCount}</span>` : ''}
                </button>` : ''}
                ${canDownload && enq.stage === 'completed' ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();downloadQuotation('${enq._id}','${enq.enquiryNumber}')" title="Download PDF">
                    <i class="ph ph-file-pdf"></i>
                </button>` : ''}
                <div class="enq-chevron"><i class="ph ph-arrow-right"></i></div>
            </div>
        </div>
    </div>`;
}

function updateBadges() {
    ['new', 'open', 'updated', 'completed'].forEach(s => {
        const el = document.getElementById(`badge-${s}`);
        if (el) el.textContent = allEnquiries[s]?.length || 0;
    });
    const total = Object.values(allEnquiries).reduce((sum, arr) => sum + (arr?.length || 0), 0);
    const enqBadge = document.getElementById('badge-enquiries');
    if (enqBadge) enqBadge.textContent = total;
}

function updateStats() {
    const ids = { new: 'statsNew', open: 'statsOpen', updated: 'statsUpdated', completed: 'statsCompleted' };
    Object.entries(ids).forEach(([stage, id]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = allEnquiries[stage]?.length || 0;
    });
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

async function openDetail(enquiryId) {
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('detailBody');
    body.innerHTML = '<div class="spinner"></div>';
    modal.classList.add('active');

    try {
        const enq = await apiCall(`/enquiries/${enquiryId}`);
        currentDetailEnquiry = enq;
        renderDetailBody(enq);
        const dlBtn = document.getElementById('detailDownloadBtn');
        if (dlBtn) {
            dlBtn.style.display = hasPermission('quotation.download') && enq.stage === 'completed' ? '' : 'none';
        }
    } catch (err) {
        body.innerHTML = `<div class="alert alert-danger"><i class="ph ph-warning"></i> Failed to load: ${err.message}</div>`;
    }
}

function renderDetailBody(enq) {
    const title = document.getElementById('detailTitle');
    if (title) title.textContent = `${enq.enquiryNumber} — ${enq.customerId?.name || ''}`;

    const stageLabels = { new: 'New', open: 'In Progress', updated: 'Quoted', completed: 'Completed' };
    const stageColors = { new: '#1D4ED8', open: '#C2410C', updated: '#15803D', completed: '#6D28D9' };
    const color = stageColors[enq.stage] || '#64748b';
    const createdAt = new Date(enq.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    const cust = enq.customerId || {};

    const itemStatusMeta = {
        unassigned:          { label: 'Unassigned',     bg: '#f1f5f9', fg: '#475569' },
        pending:             { label: 'Pending',        bg: '#f1f5f9', fg: '#475569' },
        assigned:            { label: 'Assigned',       bg: '#ede9fe', fg: '#5b21b6' },
        in_sales_query:      { label: 'Query',          bg: '#fef3c7', fg: '#92400e' },
        sales_query_resolved:{ label: 'Resolved',       bg: '#ecfdf5', fg: '#065f46' },
        vendor_quoted:       { label: 'Quoted',         bg: '#ecfdf5', fg: '#065f46' },
        priced:              { label: 'Priced',         bg: '#eff6ff', fg: '#1e40af' },
        sales_priced:        { label: 'Priced',         bg: '#eff6ff', fg: '#1e40af' },
        completed:           { label: 'Completed',      bg: '#f0fdf4', fg: '#166534' },
        unsuccessful:        { label: 'Unsuccessful',   bg: '#fef2f2', fg: '#991b1b' },
    };

    const totalSales = (enq.items || []).reduce((s, i) => s + ((i.salesPrice || 0) * (i.quantity || 0)), 0);

    const itemRows = (enq.items || []).map(item => {
        const sm = itemStatusMeta[item.status] || { label: item.status, bg: '#f1f5f9', fg: '#475569' };
        const prod = item.productId || {};
        const uom = prod.uom || '';
        const vendorPrice = item.selectedVendorQuoteId?.vendorPrice;
        const salesPrice = item.salesPrice;
        const matMeta = [prod.brand, prod.specification].filter(Boolean).join(' · ');

        return `<tr>
            <td style="padding:0.75rem;border-bottom:1px solid var(--border)">
                <div style="font-weight:600;font-size:0.875rem">${prod.materialName || '—'}</div>
                ${matMeta ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.1rem">${matMeta}</div>` : ''}
            </td>
            <td style="padding:0.75rem;border-bottom:1px solid var(--border);white-space:nowrap">${item.quantity} <span style="color:var(--text-muted);font-size:0.78rem">${uom}</span></td>
            <td style="padding:0.75rem;border-bottom:1px solid var(--border);font-size:0.82rem">${item.assignedTo?.name || '<span style="color:var(--text-muted)">—</span>'}</td>
            <td style="padding:0.75rem;border-bottom:1px solid var(--border);text-align:right;font-size:0.85rem">${vendorPrice ? '₹' + vendorPrice.toLocaleString('en-IN') : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td style="padding:0.75rem;border-bottom:1px solid var(--border);text-align:right;font-weight:600;font-size:0.85rem">${salesPrice ? '₹' + salesPrice.toLocaleString('en-IN') : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td style="padding:0.75rem;border-bottom:1px solid var(--border)">
                <span style="font-size:0.7rem;font-weight:700;color:${sm.fg};background:${sm.bg};padding:0.2rem 0.5rem;border-radius:999px">${sm.label}</span>
            </td>
        </tr>`;
    }).join('');

    document.getElementById('detailBody').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.875rem;margin-bottom:1.5rem">
            <div style="background:var(--bg-secondary);border-radius:0.75rem;padding:1rem">
                <div style="font-size:0.7rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.5rem"><i class="ph ph-buildings"></i> Customer</div>
                <div style="font-weight:700;font-size:0.95rem">${cust.name || '—'}</div>
                ${cust.contactPerson ? `<div style="font-size:0.82rem;color:var(--text-secondary);margin-top:0.2rem"><i class="ph ph-user" style="font-size:0.75rem"></i> ${cust.contactPerson}</div>` : ''}
                ${cust.email ? `<div style="font-size:0.82rem;color:var(--text-secondary);margin-top:0.1rem"><i class="ph ph-envelope" style="font-size:0.75rem"></i> ${cust.email}</div>` : ''}
                ${cust.phone ? `<div style="font-size:0.82rem;color:var(--text-secondary);margin-top:0.1rem"><i class="ph ph-phone" style="font-size:0.75rem"></i> ${cust.phone}</div>` : ''}
            </div>
            <div style="background:var(--bg-secondary);border-radius:0.75rem;padding:1rem">
                <div style="font-size:0.7rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.5rem"><i class="ph ph-info"></i> Enquiry Info</div>
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem">
                    <span style="font-size:0.8rem;font-weight:700;color:${color};background:${color}18;padding:0.2rem 0.6rem;border-radius:999px">${stageLabels[enq.stage] || enq.stage}</span>
                    ${enq.status === 'unsuccessful' ? `<span style="font-size:0.8rem;font-weight:700;color:#991b1b;background:#fef2f2;padding:0.2rem 0.6rem;border-radius:999px">Unsuccessful</span>` : ''}
                </div>
                <div style="font-size:0.82rem;color:var(--text-secondary)"><i class="ph ph-calendar-blank" style="font-size:0.75rem"></i> ${createdAt}</div>
                <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:0.2rem"><i class="ph ph-user" style="font-size:0.75rem"></i> ${enq.createdBy?.name || '—'}</div>
                ${totalSales ? `<div style="font-size:0.9rem;font-weight:700;color:var(--primary);margin-top:0.5rem">Total: ₹${totalSales.toLocaleString('en-IN')}</div>` : ''}
            </div>
        </div>
        ${enq.closeReason ? `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:0.625rem;padding:0.75rem 1rem;margin-bottom:1.25rem;font-size:0.85rem;color:#92400e"><i class="ph ph-warning-circle"></i> <strong>Close Reason:</strong> ${enq.closeReason}</div>` : ''}
        <div style="font-weight:700;margin-bottom:0.75rem;font-size:0.9rem;display:flex;align-items:center;gap:0.5rem">
            <i class="ph ph-cube" style="color:var(--primary)"></i> Materials
            <span style="font-size:0.75rem;font-weight:600;color:var(--text-muted)">(${enq.items?.length || 0})</span>
        </div>
        <div style="overflow-x:auto;border-radius:0.625rem;border:1px solid var(--border)">
            <table style="width:100%;border-collapse:collapse;font-size:0.875rem">
                <thead>
                    <tr style="background:var(--bg-secondary)">
                        <th style="padding:0.625rem 0.75rem;text-align:left;font-weight:600;color:var(--text-secondary);font-size:0.78rem">Material</th>
                        <th style="padding:0.625rem 0.75rem;text-align:left;font-weight:600;color:var(--text-secondary);font-size:0.78rem">Qty</th>
                        <th style="padding:0.625rem 0.75rem;text-align:left;font-weight:600;color:var(--text-secondary);font-size:0.78rem">Sourcing PIC</th>
                        <th style="padding:0.625rem 0.75rem;text-align:right;font-weight:600;color:var(--text-secondary);font-size:0.78rem">Vendor Price</th>
                        <th style="padding:0.625rem 0.75rem;text-align:right;font-weight:600;color:var(--text-secondary);font-size:0.78rem">Sales Price</th>
                        <th style="padding:0.625rem 0.75rem;text-align:left;font-weight:600;color:var(--text-secondary);font-size:0.78rem">Status</th>
                    </tr>
                </thead>
                <tbody>${itemRows || '<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--text-muted)">No items</td></tr>'}</tbody>
            </table>
        </div>`;
}

function closeDetailModal() {
    document.getElementById('detailModal').classList.remove('active');
    currentDetailEnquiry = null;
}

async function downloadDetailQuotation() {
    if (!currentDetailEnquiry) return;
    await downloadQuotation(currentDetailEnquiry._id, currentDetailEnquiry.enquiryNumber);
}

// ── PDF Download ──────────────────────────────────────────────────────────────

async function downloadQuotation(enquiryId, enquiryNumber) {
    try {
        showToast('Generating PDF…', 'info');
        const enq = currentDetailEnquiry || await apiCall(`/enquiries/${enquiryId}`);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('QUOTATION', 105, 22, { align: 'center' });

        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.text(`Enquiry: ${enq.enquiryNumber}`, 14, 38);
        doc.text(`Customer: ${enq.customerId?.name || '—'}`, 14, 46);
        doc.text(`Date: ${new Date(enq.createdAt).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })}`, 14, 54);

        const tableData = (enq.items || []).map((item, idx) => [
            idx + 1,
            item.productId?.materialName || '—',
            item.productId?.specification || '—',
            `${item.quantity} ${item.productId?.uom || ''}`,
            item.salesPrice ? `₹ ${item.salesPrice.toLocaleString('en-IN')}` : '—',
            item.salesPrice ? `₹ ${(item.salesPrice * item.quantity).toLocaleString('en-IN')}` : '—',
        ]);

        doc.autoTable({
            startY: 64,
            head: [['#', 'Material', 'Specification', 'Quantity', 'Unit Price', 'Total']],
            body: tableData,
            styles: { fontSize: 9 },
            headStyles: { fillColor: [59, 159, 217] },
        });

        const total = (enq.items || []).reduce((sum, it) => sum + ((it.salesPrice || 0) * it.quantity), 0);
        const finalY = doc.lastAutoTable.finalY + 8;
        doc.setFont('helvetica', 'bold');
        doc.text(`Total: ₹ ${total.toLocaleString('en-IN')}`, 14, finalY);

        doc.save(`${enquiryNumber}-quotation.pdf`);
        showToast('PDF downloaded', 'success');
    } catch (err) {
        showToast('PDF generation failed: ' + err.message, 'error');
    }
}

// ── Query Modal ───────────────────────────────────────────────────────────────

async function openQueryModal(enquiryId, enquiryNumber) {
    currentQueryEnquiryId = enquiryId;
    document.getElementById('queryModalTitle').textContent = `Queries — ${enquiryNumber}`;

    const modal = document.getElementById('queryModal');
    modal.classList.add('active');

    const canSend = hasPermission('query.send');
    document.getElementById('queryInputRow').style.display = canSend ? '' : 'none';

    await loadQueryThread(enquiryId);
}

async function loadQueryThread(enquiryId) {
    const thread = document.getElementById('queryThread');
    thread.innerHTML = '<div class="spinner"></div>';

    try {
        const queries = await apiCall(`/enquiries/${enquiryId}/queries`);
        const user = getUser();
        if (!queries.length) {
            thread.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:2rem;font-size:0.875rem"><i class="ph ph-chat-centered-dots" style="font-size:2rem;display:block;margin:0 auto 0.5rem;opacity:0.4"></i>No queries yet.</div>';
            return;
        }
        thread.innerHTML = queries.map(q => {
            const mine = q.senderId?._id === user.id || q.senderId === user.id;
            const senderName = q.senderId?.name || 'Unknown';
            const time = new Date(q.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            const date = new Date(q.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
            return `
            <div style="display:flex;flex-direction:column;align-items:${mine ? 'flex-end' : 'flex-start'}">
                <div class="query-msg ${mine ? 'mine' : 'theirs'}">
                    ${!mine ? `<div style="font-size:0.7rem;font-weight:700;margin-bottom:0.25rem;opacity:0.75">${senderName}</div>` : ''}
                    ${q.message}
                    <div class="query-meta">${date}, ${time}</div>
                </div>
            </div>`;
        }).join('');
        thread.scrollTop = thread.scrollHeight;
    } catch (err) {
        thread.innerHTML = `<div style="color:var(--danger);padding:1rem;font-size:0.875rem">${err.message}</div>`;
    }
}

async function sendQuery() {
    const input = document.getElementById('queryInput');
    const message = input.value.trim();
    if (!message || !currentQueryEnquiryId) return;

    try {
        await apiCall(`/enquiries/${currentQueryEnquiryId}/queries`, {
            method: 'POST',
            body: JSON.stringify({ message }),
        });
        input.value = '';
        await loadQueryThread(currentQueryEnquiryId);
    } catch (err) {
        showToast('Failed to send: ' + err.message, 'error');
    }
}

function closeQueryModal() {
    document.getElementById('queryModal').classList.remove('active');
    currentQueryEnquiryId = null;
}

// ── Filter refresh on KAM change ──────────────────────────────────────────────

document.getElementById && document.addEventListener('DOMContentLoaded', () => {
    const kamSel = document.getElementById('kamFilter');
    if (kamSel) {
        kamSel.addEventListener('change', async () => {
            await loadAllTabs();
        });
    }
});
