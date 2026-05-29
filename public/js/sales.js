// Sales Dashboard Logic
let enquiries = [];
let products = [];
let customers = [];
let sourcingUsers = [];
let cart = [];
let currentEnquiryId = null;
let currentItemId = null;
let newlyCreatedEnquiry = null;
let selectedForQuote = {}; // Map of enquiryId -> Set(itemIds)
let activeFilters = new Set();
let viewMode = localStorage.getItem('viewMode_sales') || 'enquiry'; // 'enquiry' | 'material' | 'items'


// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const user = checkAuth();
    if (!user) return;
    if (!hasAnyPermission(['enquiry.create', 'enquiry.view.own', 'enquiry.view.all', 'sales_price.add', 'sales_price.approve'])) {
        showToast('You do not have permission to access the Sales dashboard', 'error');
        setTimeout(() => window.location.href = '/', 1500);
        return;
    }

    // Show permission-gated action buttons
    if (hasPermission('enquiry.create')) {
        const btn = document.getElementById('newEnquiryBtn');
        if (btn) btn.style.display = '';
    }
    if (hasPermission('enquiry.bulk_create')) {
        const btn = document.getElementById('bulkUploadBtn');
        if (btn) btn.style.display = '';
    }

    await loadData();

    // Close autocomplete when clicking outside
    document.addEventListener('click', (e) => {
        const results = document.getElementById('productSearchResults');
        const searchInput = document.getElementById('productSearch');
        if (results && !results.contains(e.target) && e.target !== searchInput) {
            results.classList.remove('active');
        }
    });
});

async function loadData() {
    try {
        // Load enquiries, products, customers, and sourcing users
        [enquiries, products, customers, sourcingUsers] = await Promise.all([
            apiCall('/enquiries'),
            apiCall('/products'),
            apiCall('/customers'),
            apiCall('/users/sourcing')
        ]);

        renderInsights();
        const tog = document.getElementById('viewToggleContainer');
        if (tog) tog.innerHTML = getViewToggleHTML(viewMode);
        renderEnquiries();
        populateProductSelect();
        populateCustomerSelect();
        populateSourcingSelect();
        handleUrlParameters();
        // Show inline customer create button if permitted
        if (hasPermission('customer.create')) {
            const btn = document.getElementById('addCustomerInlineBtn');
            if (btn) btn.style.display = '';
        }
    } catch (error) {
        console.error('Load data error:', error);
        showToast('Failed to load data', 'error');
    }
}

// Render insights card
function renderInsights() {
    const user = getUser();
    if (!user) return;

    // Filter enquiries created by this user
    const personalEnquiries = enquiries.filter(e => e.createdBy?._id === user.id || e.createdBy === user.id);

    // 1. Urgent Attention: personal active > 2 days and not fully quoted
    const now = new Date();
    const urgentCount = personalEnquiries.filter(e => {
        const isOld = (now - new Date(e.createdAt)) > (48 * 60 * 60 * 1000);
        const notCompleted = e.status === 'active';
        const notFullyQuoted = e.items && e.items.some(i => ['unassigned', 'pending', 'assigned', 'in_sales_query', 'sales_query_resolved'].includes(i.status));
        return isOld && notCompleted && notFullyQuoted;
    }).length;

    // 2. Waiting on Vendor: Items in personal enquiries still 'assigned'
    let waitingOnVendor = 0;
    personalEnquiries.forEach(e => {
        if (e.items) {
            waitingOnVendor += e.items.filter(item => item.status === 'assigned').length;
        }
    });

    // 3. Ready for Customer: Personal enquiries where ALL items are 'sales_priced' or 'completed'
    const readyForCustomer = personalEnquiries.filter(e => {
        if (!e.items || e.items.length === 0) return false;
        const allPriced = e.items.every(item => ['priced', 'sales_priced', 'completed'].includes(item.status));
        return e.status === 'active' && allPriced;
    }).length;

    // 4. Monthly Volume (Revenue): Sum of sales price for personal enquiries created this month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    let monthlyVolume = 0;
    personalEnquiries.forEach(e => {
        if (new Date(e.createdAt) >= startOfMonth && e.items) {
            e.items.forEach(item => {
                if (item.salesPrice > 0) {
                    monthlyVolume += (item.salesPrice * (item.quantity || 1));
                }
            });
        }
    });

    // Populate the new IDs in sales.html
    const urgentEl = document.getElementById('insightUrgentCount');
    const waitingEl = document.getElementById('insightWaitingVendor');
    const readyEl = document.getElementById('insightReadyCustomer');
    const revenueEl = document.getElementById('insightRevenue');

    if (urgentEl) urgentEl.textContent = urgentCount;
    if (waitingEl) waitingEl.textContent = waitingOnVendor;
    if (readyEl) readyEl.textContent = readyForCustomer;
    if (revenueEl) revenueEl.textContent = '₹' + Math.round(monthlyVolume).toLocaleString('en-IN');
}

// ── View Mode ────────────────────────────────────────────────────────────────

function setViewMode(mode) {
    viewMode = mode;
    localStorage.setItem('viewMode_sales', mode);
    const tog = document.getElementById('viewToggleContainer');
    if (tog) tog.innerHTML = getViewToggleHTML(mode);
    renderEnquiries();
}

// Item-level status filter (mirrors matchesFilter but at item granularity)
function itemMatchesStatusFilter(item) {
    if (activeFilters.size === 0) return true;
    return Array.from(activeFilters).some(f => {
        if (f === 'successful') return item.status === 'completed';
        if (f === 'unsuccessful') return item.status === 'unsuccessful';
        if (f === 'pending') return ['unassigned', 'pending', 'assigned', 'in_sales_query', 'sales_query_resolved'].includes(item.status);
        if (f === 'needs_response') return item.status === 'in_sales_query';
        if (f === 'quoted') return ['vendor_quoted', 'priced', 'sales_priced'].includes(item.status);
        return false;
    });
}

function renderMaterialView() {
    const container = document.getElementById('enquiriesList');
    const searchTerm = (document.getElementById('searchEnquiries')?.value || '').toLowerCase();

    const entries = [];
    for (const enq of enquiries) {
        for (const item of (enq.items || [])) {
            if (!itemMatchesStatusFilter(item)) continue;
            if (searchTerm) {
                const mat = (item.productId?.materialName || '').toLowerCase();
                const brand = (item.productId?.brand || '').toLowerCase();
                const spec = (item.productId?.specification || '').toLowerCase();
                const enqNum = (enq.enquiryNumber || '').toLowerCase();
                const cust = (enq.customerId?.name || '').toLowerCase();
                if (!mat.includes(searchTerm) && !brand.includes(searchTerm) &&
                    !spec.includes(searchTerm) && !enqNum.includes(searchTerm) &&
                    !cust.includes(searchTerm)) continue;
            }
            entries.push({ item, enquiry: enq });
        }
    }

    const groups = groupByMaterial(entries);

    if (groups.length === 0) {
        container.innerHTML = `<div class="card text-center" style="padding:2rem">
            <i class="ph ph-cube" style="font-size:2rem;color:var(--text-muted);display:block;margin-bottom:0.75rem;opacity:0.4"></i>
            <h3 class="mb-2">No Materials Found</h3>
            <p class="text-muted">Try adjusting your filters or search term.</p>
        </div>`;
        return;
    }

    container.innerHTML = groups.map((group, idx) => {
        const prod = group.product;
        const name = prod?.materialName || 'Unknown Material';
        const uom  = prod?.uom || '';
        const meta = [prod?.brand, prod?.specification].filter(Boolean).join(' · ');
        const id   = `mat-${idx}`;

        // Pipeline chips aggregated across all entries for this material
        const counts = {
            unassigned: group.entries.filter(e => ['unassigned','pending'].includes(e.item.status)).length,
            assigned:   group.entries.filter(e => e.item.status === 'assigned').length,
            query:      group.entries.filter(e => ['in_sales_query','sales_query_resolved'].includes(e.item.status)).length,
            quoted:     group.entries.filter(e => e.item.status === 'vendor_quoted').length,
            priced:     group.entries.filter(e => ['priced','sales_priced'].includes(e.item.status)).length,
            done:       group.entries.filter(e => ['completed','unsuccessful'].includes(e.item.status)).length,
        };
        const hasAlert = group.entries.some(e => e.item.status === 'in_sales_query');

        const chips = [
            counts.unassigned ? `<span class="enq-chip chip-unassigned"><span class="enq-chip-count">${counts.unassigned}</span> Unassigned</span>` : '',
            counts.assigned   ? `<span class="enq-chip chip-assigned"><span class="enq-chip-count">${counts.assigned}</span> Assigned</span>` : '',
            counts.query      ? `<span class="enq-chip chip-query${hasAlert ? ' chip-alert' : ''}"><i class="ph ph-warning-circle"></i><span class="enq-chip-count">${counts.query}</span> ${hasAlert ? 'Needs Response' : 'Query'}</span>` : '',
            counts.quoted     ? `<span class="enq-chip chip-quoted"><span class="enq-chip-count">${counts.quoted}</span> Quoted</span>` : '',
            counts.priced     ? `<span class="enq-chip chip-priced"><span class="enq-chip-count">${counts.priced}</span> Priced</span>` : '',
            counts.done       ? `<span class="enq-chip chip-done"><span class="enq-chip-count">${counts.done}</span> Done</span>` : '',
        ].filter(Boolean).join('');

        const cardBorder = counts.done === group.entries.length
            ? 'border-left:4px solid #10b981'
            : hasAlert ? 'border-left:4px solid #f59e0b'
            : counts.unassigned > 0 ? 'border-left:4px solid #a78bfa' : '';

        // Auto-expand cards that need immediate action
        const autoOpen = (counts.unassigned > 0 || hasAlert) ? ' open' : '';

        // Header-level assign button: find first enquiry with unassigned items in this group
        const firstUnassignedEntry = group.entries.find(e => ['unassigned','pending'].includes(e.item.status));
        const headerAssignBtn = counts.unassigned > 0 && hasPermission('enquiry.assign') && firstUnassignedEntry ? `
            <button class="btn btn-primary btn-sm" style="flex-shrink:0"
              onclick="event.stopPropagation(); showAssignModal('${firstUnassignedEntry.enquiry._id}')"
              title="Assign unassigned items to sourcing">
              <i class="ph ph-user-plus"></i> Assign${counts.unassigned > 1 ? ' (' + counts.unassigned + ')' : ''}
            </button>` : '';

        const rows = group.entries.map(({ item, enquiry }) => {
            const isQuery   = item.status === 'in_sales_query';
            const isReady   = ['priced','sales_priced','completed'].includes(item.status);
            const isSelected = selectedForQuote[enquiry._id]?.has(item._id);
            const rowBg     = isQuery ? 'background:rgba(245,158,11,0.04);' : '';
            const rowBorder = isQuery ? 'border-left:3px solid #f59e0b;' : '';

            const assignBtn = ['unassigned','pending'].includes(item.status) && hasPermission('enquiry.assign') ? `
                <button class="btn btn-primary btn-sm" onclick="showAssignModal('${enquiry._id}', false, '${item._id}')" title="Assign to sourcing">
                  <i class="ph ph-user-plus"></i> Assign
                </button>` : '';

            const chatBtn = `<button class="btn btn-secondary btn-sm" onclick="openChat('${enquiry._id}','${enquiry.enquiryNumber}')" title="Open chat">
                <i class="ph ph-chat-text"></i>
              </button>`;

            return `<tr style="${rowBg}${rowBorder}">
              <td>
                <span class="enq-ref">${enquiry.enquiryNumber}</span>
                ${item.combinedFromEnquiry?.enquiryNumber ? `<br><span class="combined-from-badge"><i class="ph ph-link"></i> from ${item.combinedFromEnquiry.enquiryNumber}</span>` : ''}
              </td>
              <td style="font-size:0.82rem">${enquiry.customerId?.name || '—'}</td>
              <td>${item.quantity} <span style="color:var(--text-muted);font-size:0.78rem">${uom}</span></td>
              <td>
                ${item.assignedTo
                  ? `<span class="badge badge-info" style="font-weight:500">${item.assignedTo.name}</span>`
                  : `<span style="color:var(--text-muted);font-size:0.8rem">Unassigned</span>`}
              </td>
              <td>
                ${['vendor_quoted','priced','sales_priced','completed'].includes(item.status) ? `
                  <button class="btn btn-secondary btn-sm" onclick="viewItemQuotes('${item._id}')">
                    <i class="ph ph-list-checks"></i> View
                  </button>` : '<span style="color:var(--text-muted);font-size:0.8rem">—</span>'}
              </td>
              <td>${item.salesPrice ? formatCurrency(item.salesPrice) : '<span style="color:var(--text-muted);font-size:0.8rem">—</span>'}</td>
              <td>
                ${getStatusBadge(item.status)}
                ${isQuery ? `<div style="font-size:0.68rem;color:#92400e;background:#fef3c7;padding:0.1rem 0.35rem;border-radius:0.2rem;font-weight:600;margin-top:0.2rem;display:inline-flex;align-items:center;gap:0.2rem"><i class="ph ph-warning-circle"></i> Response needed</div>` : ''}
              </td>
              <td>
                <div style="display:flex;gap:0.3rem;flex-wrap:wrap;align-items:center">
                  ${assignBtn}
                  ${renderActionButtons(enquiry, item)}
                  ${chatBtn}
                </div>
              </td>
            </tr>`;
        }).join('');

        return `<div class="material-card${autoOpen}" id="${id}" style="${cardBorder}">
            <div class="material-card-header" onclick="toggleMaterialCard('${id}')">
                <div class="material-icon"><i class="ph ph-cube"></i></div>
                <div style="flex:1;min-width:0">
                    <div class="material-name">${name}</div>
                    ${meta ? `<div class="material-meta-text">${meta}</div>` : ''}
                </div>
                <div class="enq-pipeline" style="flex:0 1 auto;justify-content:flex-end">
                    ${chips}
                </div>
                <div class="material-stats" style="flex-shrink:0">
                    <span class="material-stat-chip"><i class="ph ph-stack" style="font-size:0.7rem"></i> ${group.entries.length} enq</span>
                    <span class="material-stat-chip"><i class="ph ph-scales" style="font-size:0.7rem"></i> ${group.totalQty} ${uom}</span>
                </div>
                ${headerAssignBtn}
                <i class="ph ph-caret-down material-chevron"></i>
            </div>
            <div class="material-enquiries">
                <div class="glass-table-wrap" style="margin:0;border-radius:0;border:none">
                  <table class="glass-table" style="border-radius:0">
                    <thead><tr>
                      <th>Enquiry #</th><th>Customer</th><th>Qty</th>
                      <th>Assigned To</th><th>Vendor Quote</th><th>Sales Price</th><th>Status</th><th>Actions</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                  </table>
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderItemsView() {
    const container = document.getElementById('enquiriesList');
    const searchTerm = (document.getElementById('searchEnquiries')?.value || '').toLowerCase();

    // Sort order for status — action-needed statuses first
    const statusOrder = ['in_sales_query','unassigned','pending','assigned','sales_query_resolved','vendor_quoted','priced','sales_priced','completed','unsuccessful'];

    const allEntries = [];
    for (const enq of enquiries) {
        for (const item of (enq.items || [])) {
            if (!itemMatchesStatusFilter(item)) continue;
            if (searchTerm) {
                const mat   = (item.productId?.materialName || '').toLowerCase();
                const brand = (item.productId?.brand || '').toLowerCase();
                const spec  = (item.productId?.specification || '').toLowerCase();
                const enqN  = (enq.enquiryNumber || '').toLowerCase();
                const cust  = (enq.customerId?.name || '').toLowerCase();
                if (!mat.includes(searchTerm) && !brand.includes(searchTerm) &&
                    !spec.includes(searchTerm) && !enqN.includes(searchTerm) &&
                    !cust.includes(searchTerm)) continue;
            }
            allEntries.push({ item, enquiry: enq });
        }
    }

    // Sort: needs-response first, then unassigned, then by status order
    allEntries.sort((a, b) => {
        const ai = statusOrder.indexOf(a.item.status);
        const bi = statusOrder.indexOf(b.item.status);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    if (allEntries.length === 0) {
        container.innerHTML = `<div class="glass-table-wrap"><div style="padding:3rem;text-align:center;color:var(--text-muted)">
            <i class="ph ph-rows" style="font-size:2rem;display:block;margin-bottom:0.5rem;opacity:0.4"></i>
            No items match the current filters.</div></div>`;
        return;
    }

    // Summary counts across all visible items
    const summary = {
        unassigned: allEntries.filter(e => ['unassigned','pending'].includes(e.item.status)).length,
        query:      allEntries.filter(e => e.item.status === 'in_sales_query').length,
        assigned:   allEntries.filter(e => e.item.status === 'assigned').length,
        quoted:     allEntries.filter(e => e.item.status === 'vendor_quoted').length,
        priced:     allEntries.filter(e => ['priced','sales_priced'].includes(e.item.status)).length,
        done:       allEntries.filter(e => ['completed','unsuccessful'].includes(e.item.status)).length,
    };

    const summaryChips = [
        summary.query      ? `<span class="enq-chip chip-query chip-alert"><i class="ph ph-warning-circle"></i> ${summary.query} Needs Response</span>` : '',
        summary.unassigned ? `<span class="enq-chip chip-unassigned">${summary.unassigned} Unassigned</span>` : '',
        summary.assigned   ? `<span class="enq-chip chip-assigned">${summary.assigned} Assigned</span>` : '',
        summary.quoted     ? `<span class="enq-chip chip-quoted">${summary.quoted} Quoted</span>` : '',
        summary.priced     ? `<span class="enq-chip chip-priced">${summary.priced} Priced</span>` : '',
        summary.done       ? `<span class="enq-chip chip-done">${summary.done} Done</span>` : '',
    ].filter(Boolean).join('');

    const rows = allEntries.map(({ item, enquiry }) => {
        const prod     = item.productId;
        const uom      = prod?.uom || '';
        const isQuery  = item.status === 'in_sales_query';
        const rowBg    = isQuery ? 'background:rgba(245,158,11,0.035);' : '';
        const rowBorder = isQuery ? 'border-left:3px solid #f59e0b;' : '';

        const assignBtn = ['unassigned','pending'].includes(item.status) && hasPermission('enquiry.assign') ? `
            <button class="btn btn-primary btn-sm" onclick="showAssignModal('${enquiry._id}', false, '${item._id}')" title="Assign">
              <i class="ph ph-user-plus"></i> Assign
            </button>` : '';

        const chatBtn = `<button class="btn btn-secondary btn-sm" onclick="openChat('${enquiry._id}','${enquiry.enquiryNumber}')" title="Open chat">
            <i class="ph ph-chat-text"></i>
          </button>`;

        return `<tr style="${rowBg}${rowBorder}">
          <td>
            <div class="mat-primary">${prod?.materialName || '—'}</div>
            ${(prod?.brand || prod?.specification) ? `<div class="mat-meta">${[prod.brand, prod.specification].filter(Boolean).join(' · ')}</div>` : ''}
            ${item.combinedFromEnquiry?.enquiryNumber ? `<span class="combined-from-badge"><i class="ph ph-link"></i> from ${item.combinedFromEnquiry.enquiryNumber}</span>` : ''}
            ${isQuery ? `<div style="font-size:0.68rem;color:#92400e;background:#fef3c7;padding:0.1rem 0.35rem;border-radius:0.2rem;font-weight:600;margin-top:0.25rem;display:inline-flex;align-items:center;gap:0.2rem"><i class="ph ph-warning-circle"></i> Sales response needed</div>` : ''}
          </td>
          <td><span class="enq-ref">${enquiry.enquiryNumber}</span></td>
          <td style="font-size:0.82rem">${enquiry.customerId?.name || '—'}</td>
          <td style="white-space:nowrap">${item.quantity} <span style="color:var(--text-muted);font-size:0.78rem">${uom}</span></td>
          <td>
            ${item.assignedTo
              ? `<span class="badge badge-info" style="font-weight:500">${item.assignedTo.name}</span>`
              : `<span style="color:var(--text-muted);font-size:0.8rem">Unassigned</span>`}
          </td>
          <td>
            ${['vendor_quoted','priced','sales_priced','completed'].includes(item.status) ? `
              <button class="btn btn-secondary btn-sm" onclick="viewItemQuotes('${item._id}')">
                <i class="ph ph-list-checks"></i> View
              </button>` : '<span style="color:var(--text-muted);font-size:0.8rem">—</span>'}
          </td>
          <td>${item.salesPrice ? formatCurrency(item.salesPrice) : '<span style="color:var(--text-muted);font-size:0.8rem">—</span>'}</td>
          <td>${getStatusBadge(item.status)}</td>
          <td>
            <div style="display:flex;gap:0.3rem;flex-wrap:wrap;align-items:center">
              ${assignBtn}
              ${renderActionButtons(enquiry, item)}
              ${chatBtn}
            </div>
          </td>
        </tr>`;
    });

    const metaHtml = `<span style="font-size:0.82rem;color:var(--text-secondary)"><strong>${allEntries.length}</strong> item${allEntries.length !== 1 ? 's' : ''}</span>
        <div style="display:flex;gap:0.35rem;flex-wrap:wrap;align-items:center">${summaryChips}</div>`;

    const ths = ['Material','Enquiry #','Customer','Qty','Assigned To','Vendor Quote','Sales Price','Status','Actions'].map(h => `<th>${h}</th>`).join('');
    container.innerHTML = `<div class="glass-table-wrap">
        <div class="glass-table-meta" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">${metaHtml}</div>
        <div style="overflow-x:auto">
          <table class="glass-table">
            <thead><tr>${ths}</tr></thead>
            <tbody>${rows.join('')}</tbody>
          </table>
        </div>
    </div>`;
}

// Search functionality
function handleSearch() {
    const searchTerm = document.getElementById('searchEnquiries').value.toLowerCase();

    if (!searchTerm) {
        renderEnquiries();
        return;
    }

    const filtered = enquiries.filter(enq => {
        // Search by enquiry number
        if (enq.enquiryNumber.toLowerCase().includes(searchTerm)) return true;

        // Search by customer name
        if (enq.customerId?.name?.toLowerCase().includes(searchTerm)) return true;

        // Search by product/material name
        if (enq.items) {
            return enq.items.some(item =>
                item.productId?.materialName?.toLowerCase().includes(searchTerm) ||
                item.productId?.description?.toLowerCase().includes(searchTerm)
            );
        }

        return false;
    });

    renderEnquiries(filtered);
}

// Filter functionality
function toggleFilter(filterName) {
    if (activeFilters.has(filterName)) {
        activeFilters.delete(filterName);
    } else {
        activeFilters.add(filterName);
    }

    // Update UI
    const filterChip = document.querySelector(`[data-filter="${filterName}"]`);
    if (filterChip) {
        filterChip.classList.toggle('active');
    }

    // Re-render with filters
    renderEnquiries();
}

function matchesFilter(enquiry) {
    // If no filters selected, show all
    if (activeFilters.size === 0) return true;

    // Check if enquiry matches any of the selected filters
    return Array.from(activeFilters).some(filter => {
        if (filter === 'successful') {
            return enquiry.status === 'completed' ||
                (enquiry.items && enquiry.items.some(i => i.status === 'completed'));
        }
        if (filter === 'unsuccessful') {
            return enquiry.status === 'unsuccessful' ||
                (enquiry.items && enquiry.items.some(i => i.status === 'unsuccessful'));
        }
        if (filter === 'pending') {
            return enquiry.items && enquiry.items.some(i => ['unassigned', 'pending', 'assigned', 'in_sales_query', 'sales_query_resolved'].includes(i.status));
        }
        if (filter === 'needs_response') {
            return enquiry.items && enquiry.items.some(i => i.status === 'in_sales_query');
        }
        if (filter === 'quoted') {
            return enquiry.items && enquiry.items.some(i => ['vendor_quoted', 'priced', 'sales_priced'].includes(i.status));
        }
        return false;
    });
}

function renderEnquiries(filteredEnquiries = null) {
    if (viewMode === 'material') { renderMaterialView(); return; }
    if (viewMode === 'items')    { renderItemsView();    return; }

    const container = document.getElementById('enquiriesList');
    let enquiriesToRender = filteredEnquiries || enquiries;

    // Apply status filters if no explicit filtered list provided
    if (!filteredEnquiries) {
        enquiriesToRender = enquiries.filter(matchesFilter);
    }

    if (enquiriesToRender.length === 0) {
        container.innerHTML = `
      <div class="card text-center">
        <h3 class="mb-2">No Enquiries Found</h3>
        <p class="text-muted mb-3">${filteredEnquiries ? 'Try a different search term' : 'Create your first enquiry to get started'}</p>
        <button class="btn btn-primary" onclick="showNewEnquiryModal()">✨ Create Enquiry</button>
      </div>
    `;
        return;
    }

    container.innerHTML = enquiriesToRender.map(enquiry => {
        const enquiryStatus = enquiry.items && enquiry.items.length > 0 && enquiry.items.every(item => item.status === 'completed') ? 'completed' :
            enquiry.items && enquiry.items.every(item => item.status === 'unsuccessful') ? 'unsuccessful' : 'pending';

        return `
    <div class="enquiry-row status-${enquiryStatus}" id="enquiry-${enquiry._id}" style="position: relative;">
      ${enquiryStatus === 'completed' ? '<div class="item-completed-tag">COMPLETED</div>' : ''}
      ${enquiryStatus === 'unsuccessful' ? '<div class="item-unsuccessful-tag">UNSUCCESSFUL</div>' : ''}
      <div class="enquiry-header" onclick="toggleEnquiry('${enquiry._id}')">
        <div class="enquiry-info">
          <div class="enquiry-detail">
            <span class="detail-label">Enquiry #</span>
            <span class="detail-value">${enquiry.enquiryNumber}</span>
          </div>
          <div class="enquiry-detail">
            <span class="detail-label">Customer</span>
            <span class="detail-value">${enquiry.customerId?.name || 'Unknown'}</span>
          </div>
          <div class="enquiry-detail">
            <span class="detail-label">Items</span>
            <span class="detail-value">${enquiry.items?.length || 0}</span>
          </div>
          <div class="enquiry-detail">
            <span class="detail-label">Created</span>
            <span class="detail-value">${formatDate(enquiry.createdAt)}</span>
          </div>
        </div>
        <div class="flex gap-4" style="align-items: center;">
          <div class="toggle-icon" id="icon-${enquiry._id}">▼</div>
        </div>
      </div>

      <div class="enquiry-items" id="items-${enquiry._id}">
        ${renderEnquiryActions(enquiry)}
        ${renderItems(enquiry)}
      </div>
    </div>
        `;
    }).join('');
}

function renderEnquiryActions(enquiry) {
    const allItemsPriced = enquiry.items && enquiry.items.length > 0 &&
        enquiry.items.every(item => ['priced', 'sales_priced', 'completed', 'unsuccessful'].includes(item.status) && (item.salesPrice > 0 || item.status === 'unsuccessful'));

    const isClosed = ['completed', 'unsuccessful', 'closed'].includes(enquiry.status);
    const hasUnassigned = enquiry.items && enquiry.items.some(i => ['unassigned', 'pending'].includes(i.status));
    const hasInQuery = enquiry.items && enquiry.items.some(i => i.status === 'in_sales_query');

    return `
      <div class="item-card" style="background: rgba(79, 70, 229, 0.05); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${hasUnassigned && hasPermission('enquiry.assign') ? `
            <button class="btn btn-primary btn-sm" onclick="showAssignModal('${enquiry._id}')">
              <i class="ph ph-user-plus"></i> Assign to Sourcing
            </button>
          ` : ''}
          ${hasInQuery ? `
            <span style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.78rem;background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:0.4rem;padding:0.25rem 0.6rem;font-weight:600">
              <i class="ph ph-warning-circle"></i> Query needs response
            </span>
          ` : ''}
          ${!isClosed && hasPermission('enquiry.mark_unsuccessful') ? `
            <button class="btn btn-unsuccessful btn-sm" onclick="closeEnquiryUnsuccessful('${enquiry._id}')" title="Close Enquiry Unsuccessful">
              <i class="ph ph-x-circle"></i> Close Unsuccessful
            </button>
          ` : ''}
          ${isClosed && hasPermission('enquiry.reopen') ? `
            <button class="btn btn-secondary btn-sm" onclick="reopenEnquiry('${enquiry._id}')">
              <i class="ph ph-arrow-counter-clockwise"></i> Reopen
            </button>
          ` : ''}
          ${enquiry.closeReason ? `
            <span style="font-size:0.75rem;color:var(--text-muted);align-self:center"><i class="ph ph-info"></i> Closed: ${enquiry.closeReason}</span>
          ` : ''}
          ${!isClosed && hasPermission('enquiry.combine') && enquiry.items?.length > 0 ? `
            <button class="btn btn-secondary btn-sm" onclick="showCombineModalForItem('${enquiry._id}', null)" title="Combine items into another enquiry">
              <i class="ph ph-link"></i> Combine
            </button>
          ` : ''}
          ${!isClosed ? `
            <button class="btn btn-danger btn-sm" onclick="deleteEnquiry('${enquiry._id}')" title="Delete Enquiry">
              <i class="ph ph-trash"></i>
            </button>
          ` : ''}
        </div>
        <div>
            <button class="btn btn-secondary btn-sm" onclick="openChat('${enquiry._id}', '${enquiry.enquiryNumber}')" style="margin-right: 0.5rem;">
                <i class="ph ph-chat-text"></i> Sales Query
            </button>
            ${renderQuotationButton(enquiry, allItemsPriced)}
        </div>
      </div>
    `;
}

function renderQuotationButton(enquiry, allItemsPriced) {
    const selectedCount = selectedForQuote[enquiry._id]?.size || 0;

    if (selectedCount > 0) {
        return `
            <button 
              class="btn btn-primary" 
              onclick="downloadEnquiryQuotation('${enquiry._id}', true)"
              title="Download partial quotation for selected items">
              <i class="ph ph-download-simple"></i> Download Selected (${selectedCount})
            </button>
        `;
    }

    return `
        <button 
          class="btn ${allItemsPriced ? 'btn-success' : 'btn-secondary'}" 
          onclick="downloadEnquiryQuotation('${enquiry._id}')"
          ${!allItemsPriced ? 'disabled' : ''}
          title="${allItemsPriced ? 'Download Quotation' : 'Complete all sales prices first'}">
          <i class="ph ph-download-simple"></i> Download Quotation
        </button>
    `;
}

function renderItems(enquiry) {
    if (!enquiry.items || enquiry.items.length === 0) {
        return '<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.875rem"><i class="ph ph-package" style="font-size:1.5rem;display:block;margin-bottom:0.4rem;opacity:0.4"></i>No items in this enquiry</div>';
    }

    const rows = enquiry.items.map((item, index) => {
        const isReady = ['priced', 'sales_priced', 'completed'].includes(item.status);
        const isSelected = selectedForQuote[enquiry._id]?.has(item._id);
        const isQuery = item.status === 'in_sales_query';
        const rowBg = isQuery ? 'background:rgba(245,158,11,0.04);' : '';
        const rowBorder = isQuery ? 'border-left:3px solid #f59e0b;' : '';

        const assignBtn = ['unassigned', 'pending'].includes(item.status) && hasPermission('enquiry.assign') ? `
          <button class="btn btn-primary btn-sm" onclick="showAssignModal('${enquiry._id}', false, '${item._id}')" title="Assign this item">
            <i class="ph ph-user-plus"></i> Assign
          </button>` : '';

        return `
        <tr style="${rowBg}${rowBorder}">
          <td style="width:40px;padding-left:1rem">
            ${isReady ? `
              <label class="premium-checkbox-container" style="gap:0">
                <input type="checkbox"
                  class="quote-item-checkbox-${enquiry._id}"
                  value="${item._id}"
                  ${isSelected ? 'checked' : ''}
                  onchange="toggleItemQuoteSelection('${enquiry._id}', '${item._id}')">
                <span class="premium-checkbox"></span>
              </label>` : '<span style="color:var(--text-muted);font-size:0.8rem">—</span>'}
          </td>
          <td>
            <div class="mat-primary">${item.productId.materialName}</div>
            <div class="mat-meta">${[item.productId.brand, item.productId.specification].filter(Boolean).join(' · ')}</div>
            <div class="enq-ref">#${enquiry.enquiryNumber}.${index + 1}</div>
            ${item.combinedFromEnquiry?.enquiryNumber ? `<span class="combined-from-badge"><i class="ph ph-link"></i> from ${item.combinedFromEnquiry.enquiryNumber}</span>` : ''}
            ${isQuery ? `<span style="font-size:0.7rem;color:#92400e;background:#fef3c7;padding:0.1rem 0.4rem;border-radius:0.25rem;font-weight:600;display:inline-flex;align-items:center;gap:0.2rem;margin-top:0.2rem"><i class="ph ph-warning-circle"></i> Sales response needed</span>` : ''}
          </td>
          <td>
            ${item.assignedTo
              ? `<span class="badge badge-info" style="font-weight:500">${item.assignedTo.name}</span>`
              : `<span style="color:var(--text-muted);font-size:0.8rem">Unassigned</span>`}
          </td>
          <td>${item.quantity} <span style="color:var(--text-muted);font-size:0.78rem">${item.productId.uom}</span></td>
          <td>
            ${['vendor_quoted', 'priced', 'sales_priced', 'completed'].includes(item.status) ? `
              <button class="btn btn-secondary btn-sm" onclick="viewItemQuotes('${item._id}')">
                <i class="ph ph-list-checks"></i> View
              </button>` : '<span style="color:var(--text-muted);font-size:0.8rem">—</span>'}
          </td>
          <td>${item.salesPrice ? formatCurrency(item.salesPrice) : '<span style="color:var(--text-muted);font-size:0.8rem">—</span>'}</td>
          <td>${getStatusBadge(item.status)}</td>
          <td>
            <div style="display:flex;gap:0.3rem;flex-wrap:wrap;align-items:center">
              ${assignBtn}
              ${renderActionButtons(enquiry, item)}
            </div>
          </td>
        </tr>`;
    }).join('');

    return `
    <div class="glass-table-wrap" style="margin:0;border-radius:0;border:none;background:rgba(248,250,252,0.7)">
      <table class="glass-table" style="border-radius:0">
        <thead>
          <tr>
            <th style="width:40px">
              <label class="premium-checkbox-container" style="gap:0">
                <input type="checkbox" onchange="toggleSelectAllQuote('${enquiry._id}', this)" title="Select All Ready Items">
                <span class="premium-checkbox"></span>
              </label>
            </th>
            <th>Material</th>
            <th>Assigned To</th>
            <th>Qty</th>
            <th>Vendor Quote</th>
            <th>Sales Price</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="items-table-body-${enquiry._id}">${rows}</tbody>
      </table>
    </div>`;
}

function renderActionButtons(enquiry, item) {
    let buttons = '';

    if (item.status !== 'completed' && item.status !== 'unsuccessful') {
        buttons += `
          ${hasPermission('enquiry.combine') ? `<button class="btn btn-secondary btn-sm" onclick="showCombineModalForItem('${enquiry._id}', '${item._id}')" title="Combine into another enquiry"><i class="ph ph-link"></i></button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="showEditItemModal('${enquiry._id}', '${item._id}')" title="Edit">
            <i class="ph ph-pencil-simple"></i>
          </button>
          <button class="btn btn-unsuccessful btn-sm" onclick="openItemCloseModal('${enquiry._id}', '${item._id}')" title="Mark Unsuccessful">
            <i class="ph ph-x-circle"></i>
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteItem('${enquiry._id}', '${item._id}')" title="Delete">
            <i class="ph ph-trash"></i>
          </button>
        `;
    }

    if (item.status === 'vendor_quoted') {
        buttons += `
          <button class="btn btn-success btn-sm" onclick="showSalesPriceModal('${enquiry._id}', '${item._id}')" title="Set Sales Price">
            <i class="ph ph-currency-dollar"></i> Set Price
          </button>
        `;
    }

    if (item.status === 'priced' || item.status === 'sales_priced') {
        buttons += `
          <button class="btn btn-primary btn-sm" onclick="markComplete('${enquiry._id}', '${item._id}')" title="Mark Successful">
            <i class="ph ph-check-circle"></i> Mark Successful
          </button>
        `;
    }

    if (['completed', 'priced', 'sales_priced'].includes(item.status)) {
        buttons += `
          <button class="btn btn-sm" style="background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border);"
            onclick="downloadEnquiryQuotation('${enquiry._id}', false, ['${item._id}'])" title="Download Single Quote">
            <i class="ph ph-file-pdf"></i>
          </button>
        `;
    }

    return buttons;
}

function toggleEnquiry(enquiryId) {
    const itemsDiv = document.getElementById(`items-${enquiryId}`);
    const icon = document.getElementById(`icon-${enquiryId}`);

    if (itemsDiv.classList.contains('expanded')) {
        itemsDiv.classList.remove('expanded');
        icon.classList.remove('expanded');
    } else {
        itemsDiv.classList.add('expanded');
        icon.classList.add('expanded');
    }
}

function refreshEnquiryCard(enquiry) {
    const itemsDiv = document.getElementById(`items-${enquiry._id}`);
    if (!itemsDiv) return;
    itemsDiv.innerHTML = renderEnquiryActions(enquiry) + renderItems(enquiry);
}

// New Enquiry Modal
function showNewEnquiryModal() {
    document.getElementById('newEnquiryModal').classList.add('active');
    document.getElementById('customerName').value = '';
    cart = [];
    renderCart();
    showToast('Add items to your enquiry', 'info');
}

function closeNewEnquiryModal() {
    document.getElementById('newEnquiryModal').classList.remove('active');
}

function populateCustomerSelect() {
    const select = document.getElementById('customerSelect');
    select.innerHTML = '<option value="">Select customer...</option>' +
        customers.map(c => `<option value="${c._id}">${c.name}</option>`).join('');
}

function populateProductSelect() {
    // This function is no longer used but we'll keep it as a no-op or remove it
    // The search functionality is handled by handleProductSearch
}

// Product Search & Autocomplete
function handleProductSearch(query) {
    const resultsContainer = document.getElementById('productSearchResults');
    const hiddenInput = document.getElementById('selectedProductId');

    // Clear selection if input is changed
    hiddenInput.value = '';

    if (!query || query.length < 1) {
        resultsContainer.classList.remove('active');
        resultsContainer.innerHTML = '';
        return;
    }

    const searchTerm = query.toLowerCase();
    const filteredProducts = products.filter(p =>
        p.materialName.toLowerCase().includes(searchTerm) ||
        (p.brand && p.brand.toLowerCase().includes(searchTerm))
    ).slice(0, 10);

    if (filteredProducts.length === 0) {
        resultsContainer.innerHTML = `
            <div class="autocomplete-item add-new" onclick="showAddProductModal('${query}')">
                <i class="ph ph-plus-circle"></i> No product found. Add "${query}"?
            </div>
        `;
    } else {
        resultsContainer.innerHTML = filteredProducts.map(p => `
            <div class="autocomplete-item" onclick="selectProduct('${p._id}', '${p.materialName}')">
                <span class="material-name">${p.materialName}</span>
                <span class="material-details">${p.brand || 'Generic'} • ${p.uom}</span>
            </div>
        `).join('') + `
            <div class="autocomplete-item add-new" onclick="showAddProductModal('${query}')">
                <i class="ph ph-plus-circle"></i> Add "${query}" as new product...
            </div>
        `;
    }

    resultsContainer.classList.add('active');
}

function selectProduct(id, name) {
    document.getElementById('productSearch').value = name;
    document.getElementById('selectedProductId').value = id;
    document.getElementById('productSearchResults').classList.remove('active');
}

// Add Product Lifecycle
function showAddProductModal(suggestedName = '') {
    const modal = document.getElementById('addProductModal');
    modal.classList.add('active');

    if (suggestedName) {
        document.getElementById('newProductName').value = suggestedName;
    }

    document.getElementById('newProductUOM').value = '';
    document.getElementById('newProductBrand').value = 'Generic';
    document.getElementById('newProductSpec').value = 'As required';
}

function closeAddProductModal() {
    document.getElementById('addProductModal').classList.remove('active');
}

// ── Inline Customer Creation ──────────────────────────────────────────────────

async function showAddCustomerModal() {
    ['newCustomerName', 'newCustomerContact', 'newCustomerPhone', 'newCustomerEmail', 'newCustomerAddress']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const kamSelect = document.getElementById('newCustomerKAM');
    if (kamSelect) kamSelect.value = '';
    document.getElementById('addCustomerModal').classList.add('active');
    setTimeout(() => document.getElementById('newCustomerName')?.focus(), 100);
    await loadKAMOptions();
}

async function loadKAMOptions() {
    const kamSelect = document.getElementById('newCustomerKAM');
    const hint = document.getElementById('kamLoadingHint');
    if (!kamSelect) return;
    hint?.style && (hint.style.display = '');
    try {
        const kamUsers = await apiCall('/users/by-category?category=key_accounts');
        kamSelect.innerHTML = '<option value="">— No KAM assigned —</option>' +
            kamUsers.map(u => `<option value="${u._id}">${u.name}</option>`).join('');
    } catch (_) {
        kamSelect.innerHTML = '<option value="">— No KAM assigned —</option>';
    } finally {
        if (hint) hint.style.display = 'none';
    }
}

function closeAddCustomerModal() {
    document.getElementById('addCustomerModal').classList.remove('active');
}

async function handleCustomerCreation() {
    const name = document.getElementById('newCustomerName').value.trim();
    if (!name) { showToast('Customer name is required', 'error'); return; }

    const btn = document.querySelector('#addCustomerModal .btn-primary');
    const origText = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Creating...'; }

    try {
        const kamId = document.getElementById('newCustomerKAM')?.value || '';
        const customer = await apiCall('/customers', {
            method: 'POST',
            body: JSON.stringify({
                name,
                contactPerson: document.getElementById('newCustomerContact').value.trim() || undefined,
                phone: document.getElementById('newCustomerPhone').value.trim() || undefined,
                email: document.getElementById('newCustomerEmail').value.trim() || undefined,
                address: document.getElementById('newCustomerAddress').value.trim() || undefined,
                assignedKAM: kamId || undefined,
            })
        });
        customers.push(customer);
        populateCustomerSelect();
        document.getElementById('customerSelect').value = customer._id;
        closeAddCustomerModal();
        showToast(`"${name}" created and selected`, 'success');
    } catch (error) {
        showToast(error.message || 'Failed to create customer', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    }
}

async function handleProductCreation() {
    const materialName = document.getElementById('newProductName').value.trim();
    const uom = document.getElementById('newProductUOM').value;
    const brand = document.getElementById('newProductBrand').value || 'Generic';
    const specification = document.getElementById('newProductSpec').value || 'As required';

    if (!materialName || !uom) {
        showToast('Please fill in material name and UOM', 'error');
        return;
    }

    try {
        const product = await apiCall('/products', {
            method: 'POST',
            body: JSON.stringify({ materialName, uom, brand, specification })
        });

        // Add to local products list
        products.push(product);

        // Select it
        selectProduct(product._id, product.materialName);

        closeAddProductModal();
        showToast('Product created and selected!', 'success');
    } catch (error) {
        console.error('Create product error:', error);
        showToast('Failed to create product', 'error');
    }
}

function addToCart() {
    const productId = document.getElementById('selectedProductId').value;
    const quantity = parseFloat(document.getElementById('quantity').value);

    if (!productId || !quantity || quantity <= 0) {
        showToast('Please search and select a product and enter quantity', 'error');
        return;
    }

    const product = products.find(p => p._id === productId);
    cart.push({ productId, quantity, product });

    document.getElementById('productSearch').value = '';
    document.getElementById('selectedProductId').value = '';
    document.getElementById('quantity').value = '';

    renderCart();
    showToast('Item added to cart', 'success');
}

function renderCart() {
    const container = document.getElementById('cartItems');

    if (cart.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">Your cart is empty. Add materials above.</p>';
        return;
    }

    container.innerHTML = `
    <div class="card" style="padding: 1rem;">
      <h4 class="mb-2">Cart (${cart.length} items)</h4>
      ${cart.map((item, index) => `
        <div class="flex-between mb-2" style="padding: 0.5rem; background: var(--bg-tertiary); border-radius: 0.375rem;">
          <div>
            <strong>${item.product.materialName}</strong>
            <span class="text-muted"> - ${item.quantity} ${item.product.uom}</span>
          </div>
          <button class="btn btn-danger btn-sm" onclick="removeFromCart(${index})" style="padding: 0.25rem 0.5rem;">✕</button>
        </div>
      `).join('')}
    </div>
  `;
}

function removeFromCart(index) {
    cart.splice(index, 1);
    renderCart();
    showToast('Item removed from cart', 'info');
}

async function createEnquiry() {
    const customerId = document.getElementById('customerSelect').value;

    if (!customerId) {
        showToast('Please select a customer', 'error');
        return;
    }

    if (cart.length === 0) {
        showToast('Please add at least one item to cart', 'error');
        return;
    }

    try {
        const items = cart.map(item => ({
            productId: item.productId,
            quantity: item.quantity
        }));

        const enquiry = await apiCall('/enquiries', {
            method: 'POST',
            body: JSON.stringify({ customerId, items })
        });

        newlyCreatedEnquiry = enquiry;
        enquiries.unshift(enquiry);
        closeNewEnquiryModal();
        renderEnquiries();

        if (hasPermission('enquiry.assign')) {
            showToast('Enquiry created! Assign to sourcing below.', 'success');
            showAssignModal(enquiry._id, true);
        } else {
            showToast('Enquiry created! Managers and sourcing team have been notified.', 'success');
        }
    } catch (error) {
        console.error('Create enquiry error:', error);
        showToast('Failed to create enquiry', 'error');
    }
}

// Assign Modal
function showAssignModal(enquiryId, isNew = false, preSelectItemId = null) {
    currentEnquiryId = enquiryId;
    const enquiry = enquiries.find(e => e._id === enquiryId);

    // Populate items list with better styling
    const container = document.getElementById('assignModalItems');
    if (enquiry && enquiry.items) {
        if (enquiry.items.length === 0) {
            container.innerHTML = '<div class="text-muted text-center p-4">No items in this enquiry</div>';
        } else {
            container.innerHTML = enquiry.items.map(item => {
                const isAssigned = !!item.assignedTo;
                const isDisabled = isAssigned;
                const isChecked = preSelectItemId ? item._id === preSelectItemId : !isAssigned;

                return `
                <label class="assign-item-card ${isDisabled ? 'disabled' : ''} ${isChecked ? 'selected' : ''}" onclick="this.classList.toggle('selected', !this.querySelector('input').checked)">
                    <div class="assign-item-checkbox-wrapper">
                        <div class="premium-checkbox-container" style="gap: 0;">
                            <input type="checkbox" class="assign-item-checkbox" value="${item._id}" 
                                ${isChecked ? 'checked' : ''} 
                                ${isDisabled ? 'disabled' : ''}
                                style="display: none;"
                                onchange="this.closest('.assign-item-card').classList.toggle('selected', this.checked)">
                            <span class="premium-checkbox"></span>
                        </div>
                    </div>
                    
                    <div class="assign-item-content">
                        <div class="assign-item-header">
                            <span class="assign-item-title">${item.productId?.materialName}</span>
                            ${isAssigned ?
                        `<span class="badge badge-success"><i class="ph ph-check"></i> Assigned</span>` :
                        ``}
                        </div>
                        
                        <div class="assign-item-details">
                                <span>${item.quantity} ${item.productId?.uom}</span>
                                ${item.productId?.brand && item.productId?.brand !== 'Generic' ?
                        `<span>•</span><span class="badge" style="background: var(--bg-tertiary); font-weight: normal;">${item.productId?.brand}</span>` : ''}
                                ${item.productId?.specification ?
                        `<span>•</span><span class="text-muted">${item.productId.specification}</span>` : ''}
                        </div>

                        ${isAssigned ?
                        `<div class="assign-assigned-info">
                                <i class="ph ph-user-circle" style="font-size: 1.1rem;"></i>
                                <span>Assigned to <strong>${item.assignedTo.name}</strong></span>
                            </div>` : ''}
                    </div>
                </label>
            `;
            }).join('');
        }
    } else {
        container.innerHTML = '<div class="text-muted text-center p-4">No items found</div>';
    }

    document.getElementById('assignModal').classList.add('active');

    // If new, also prepare for combine modal after
    if (isNew) {
        newlyCreatedEnquiry = enquiries.find(e => e._id === enquiryId);
    }
}

function toggleSelectAllAssign() {
    const checkboxes = document.querySelectorAll('.assign-item-checkbox:not(:disabled)');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
}

function closeAssignModal() {
    document.getElementById('assignModal').classList.remove('active');

    // If this was a new enquiry, show combine modal
    if (newlyCreatedEnquiry) {
        const customerId = newlyCreatedEnquiry.customerId?._id;
        const ongoingEnquiries = enquiries.filter(e =>
            e._id !== newlyCreatedEnquiry._id &&
            e.customerId?._id === customerId &&
            e.status === 'active'
        );

        if (ongoingEnquiries.length > 0) {
            setTimeout(() => showCombineModalAfterCreate(), 300);
        } else {
            newlyCreatedEnquiry = null;
        }
    }
}

function populateSourcingSelect() {
    const select = document.getElementById('sourcingUserSelect');
    select.innerHTML = '<option value="">Select...</option>' +
        sourcingUsers.map(u => `<option value="${u._id}">${u.name}</option>`).join('');
}

async function assignEnquiry() {
    const sourcingUserId = document.getElementById('sourcingUserSelect').value;
    const checkboxes = document.querySelectorAll('.assign-item-checkbox:checked');
    const selectedItemIds = Array.from(checkboxes).map(cb => cb.value);

    if (!sourcingUserId) {
        showToast('Please select a sourcing person', 'error');
        return;
    }

    if (selectedItemIds.length === 0) {
        showToast('Please select at least one item to assign', 'error');
        return;
    }

    try {
        // Use the new item assignment endpoint
        await apiCall(`/enquiries/${currentEnquiryId}/assign-items`, {
            method: 'POST',
            body: JSON.stringify({
                itemIds: selectedItemIds,
                sourcingUserId
            })
        });

        showToast(`Assigned ${selectedItemIds.length} items successfully!`);

        // Refresh local data
        await loadData();

        // Remove assigned items from the modal list visually (or just refresh modal if keeping open)
        // Here we choose to refresh the modal so user can do next batch
        showAssignModal(currentEnquiryId, newlyCreatedEnquiry !== null);

        // Check if all items are assigned to decide if we close or show combine
        const updatedEnquiry = enquiries.find(e => e._id === currentEnquiryId);
        const allAssigned = updatedEnquiry.items.every(i => i.assignedTo);

        if (allAssigned) {
            closeAssignModal();
        }

    } catch (error) {
        console.error('Assign error:', error);
        showToast('Failed to assign items', 'error');
    }
}

// Combine Modal
function showCombineModalForItem(enquiryId, itemId) {
    const enquiry = enquiries.find(e => e._id === enquiryId);
    if (!enquiry) return;

    const customerId = enquiry.customerId?._id;
    const ongoingEnquiries = enquiries.filter(e =>
        e._id !== enquiryId &&
        e.customerId?._id === customerId &&
        e.status === 'active'
    );

    if (ongoingEnquiries.length === 0) {
        showToast('No other active enquiries found for this customer to combine with.', 'info');
        return;
    }

    // Populate target enquiry select
    const select = document.getElementById('targetEnquirySelect');
    select.innerHTML = '<option value="">Select enquiry...</option>' +
        ongoingEnquiries.map(e => `<option value="${e._id}">${e.enquiryNumber} - ${e.customerId?.name}</option>`).join('');

    // Show ALL items from the source enquiry (not just the clicked one)
    const items = enquiry.items || [];
    const itemsList = document.getElementById('combineItemsList');
    itemsList.innerHTML = `
    <div class="card" style="padding:1.25rem;border:1px solid var(--border);box-shadow:none">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
        <h4 style="color:var(--text-primary);font-size:1rem;margin:0"><i class="ph ph-package"></i> Items from ${enquiry.enquiryNumber}</h4>
        <span style="font-size:0.8rem;color:var(--text-muted)">All items will be moved to the target enquiry</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem">
        ${items.map(item => `
          <label style="display:flex;align-items:center;gap:0.85rem;padding:0.75rem 1rem;border:1px solid var(--border);border-radius:0.6rem;background:var(--bg-card);cursor:pointer">
            <input type="checkbox" value="${item._id}" checked
              style="width:1.25rem;height:1.25rem;margin:0;accent-color:var(--primary);flex-shrink:0">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:0.95rem;color:var(--text-primary)">${item.productId?.materialName || '—'}</div>
              <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.15rem">
                ${item.quantity} ${item.productId?.uom || ''}${item.productId?.brand ? ' · ' + item.productId.brand : ''}
              </div>
            </div>
            <span style="font-size:0.75rem;flex-shrink:0">${getStatusBadge(item.status)}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `;

    document.getElementById('combineModal').classList.add('active');
}

function showCombineModalAfterCreate() {
    if (!newlyCreatedEnquiry) return;

    const customerId = newlyCreatedEnquiry.customerId?._id;
    const ongoingEnquiries = enquiries.filter(e =>
        e._id !== newlyCreatedEnquiry._id &&
        e.customerId?._id === customerId &&
        e.status === 'active'
    );

    if (ongoingEnquiries.length === 0) {
        newlyCreatedEnquiry = null;
        return;
    }

    // Populate target enquiry select
    const select = document.getElementById('targetEnquirySelect');
    select.innerHTML = '<option value="">Select enquiry...</option>' +
        ongoingEnquiries.map(e => `<option value="${e._id}">${e.enquiryNumber} - ${e.customerId?.name}</option>`).join('');

    // Show items to combine
    const itemsList = document.getElementById('combineItemsList');
    itemsList.innerHTML = `
    <div class="card" style="padding: 1.5rem;">
      <h4 class="mb-3"><i class="ph ph-package"></i> Select Items to Combine:</h4>
      ${newlyCreatedEnquiry.items.map(item => `
        <label class="combine-item-card">
          <input type="checkbox" value="${item._id}" checked>
          <div class="combine-item-info">
            <h5>${item.productId.materialName}</h5>
            <p><i class="ph ph-cube"></i> ${item.quantity} ${item.productId.uom} ${item.productId.brand ? '• ' + item.productId.brand : ''}</p>
          </div>
        </label>
      `).join('')}
    </div>
  `;

    document.getElementById('combineModal').classList.add('active');
}

function closeCombineModal() {
    document.getElementById('combineModal').classList.remove('active');
    newlyCreatedEnquiry = null;
}

async function combineEnquiries() {
    const targetEnquiryId = document.getElementById('targetEnquirySelect').value;
    const checkboxes = document.querySelectorAll('#combineItemsList input[type="checkbox"]:checked');
    const sourceItemIds = Array.from(checkboxes).map(cb => cb.value);

    if (!targetEnquiryId) {
        showToast('Please select target enquiry', 'error');
        return;
    }

    if (sourceItemIds.length === 0) {
        showToast('Please select at least one item', 'error');
        return;
    }

    try {
        await apiCall('/enquiries/combine', {
            method: 'POST',
            body: JSON.stringify({ targetEnquiryId, sourceItemIds })
        });

        showToast('Enquiries combined successfully!');
        closeCombineModal();
        await loadData();
    } catch (error) {
        console.error('Combine error:', error);
        showToast('Failed to combine enquiries', 'error');
    }
}

// Edit Item Modal
function showEditItemModal(enquiryId, itemId) {
    const enquiry = enquiries.find(e => e._id === enquiryId);
    const item = enquiry.items.find(i => i._id === itemId);

    currentEnquiryId = enquiryId;
    currentItemId = itemId;

    document.getElementById('editQuantity').value = item.quantity;
    document.getElementById('editItemModal').classList.add('active');
}

function closeEditItemModal() {
    document.getElementById('editItemModal').classList.remove('active');
}

async function saveItemEdit() {
    const quantity = parseFloat(document.getElementById('editQuantity').value);

    if (!quantity || quantity <= 0) {
        showToast('Please enter valid quantity', 'error');
        return;
    }

    try {
        await apiCall(`/enquiries/${currentEnquiryId}/items/${currentItemId}`, {
            method: 'PUT',
            body: JSON.stringify({ quantity })
        });

        showToast('Item updated successfully!');
        await loadData();
        closeEditItemModal();
    } catch (error) {
        console.error('Update item error:', error);
        showToast('Failed to update item', 'error');
    }
}

async function deleteItem(enquiryId, itemId) {
    if (!confirm('Are you sure you want to delete this item?')) {
        showToast('Delete cancelled', 'info');
        return;
    }

    try {
        showToast('Deleting item...', 'info');
        const response = await apiCall(`/enquiries/${enquiryId}/items/${itemId}`, {
            method: 'PUT',
            body: JSON.stringify({ deleted: true })
        });

        showToast('Item deleted successfully!', 'success');
        await loadData();
    } catch (error) {
        console.error('Delete item error:', error);
        showToast('Failed to delete item: ' + (error.message || 'Unknown error'), 'error');
    }
}

// Sales Price Modal
let currentSalesItemQuantity = 0;

async function showSalesPriceModal(enquiryId, itemId) {
    currentEnquiryId = enquiryId;
    currentItemId = itemId;

    // Find the item
    const enquiry = enquiries.find(e => e._id === enquiryId);
    const item = enquiry?.items?.find(i => i._id === itemId);

    if (!item) return;

    // Store quantity for calculation
    currentSalesItemQuantity = item.quantity;

    // Show quotations
    try {
        const quotations = await apiCall(`/vendors/quotations/item/${itemId}`);

        let quotationsHTML = '';
        if (quotations.length > 0) {
            quotationsHTML = `
        <div class="mb-3">
          <h5 class="mb-3"><i class="ph ph-buildings"></i> Select Vendor Quotation</h5>
          <div style="max-height: 300px; overflow-y: auto;">
            ${quotations.map(q => {
                const total = (q.vendorPrice * item.quantity) + q.freightPrice;
                return `
              <label class="radio-option ${item.selectedVendorQuoteId?._id === q._id ? 'selected' : ''}">
                <div class="flex gap-3" style="align-items: flex-start;">
                  <input type="radio" name="selectedQuote" value="${q._id}" 
                    data-price="${q.vendorPrice}"
                    ${item.selectedVendorQuoteId?._id === q._id ? 'checked' : ''}
                    onchange="updateCostPrice(this.getAttribute('data-price')); this.closest('.radio-option').classList.add('selected'); document.querySelectorAll('.radio-option').forEach(r => { if (r !== this.closest('.radio-option')) r.classList.remove('selected'); });">
                  <div class="radio-content" style="flex: 1;">
                    <div class="flex-between mb-2">
                      <strong style="font-size: 1rem;"><i class="ph ph-storefront"></i> ${q.vendorId?.name || 'Unknown Vendor'}</strong>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; font-size: 0.875rem; color: var(--text-muted);">
                      <div>
                        <i class="ph ph-currency-inr"></i> Unit: <strong>${formatCurrency(q.vendorPrice)}</strong>
                      </div>
                      <div>
                        <i class="ph ph-package"></i> Qty: <strong>${item.quantity}</strong>
                      </div>
                      <div>
                        <i class="ph ph-truck"></i> Freight: <strong>${formatCurrency(q.freightPrice)}</strong>
                      </div>
                      <div>
                        <i class="ph ph-calculator"></i> Total: <strong class="text-success">${formatCurrency(total)}</strong>
                      </div>
                    </div>
                    ${q.notes ? `<div class="mt-2" style="padding: 0.5rem; background: var(--bg-secondary); border-radius: 0.5rem; font-size: 0.8rem;"><i class="ph ph-note"></i> ${q.notes}</div>` : ''}
                  </div>
                </div>
              </label>
            `}).join('')}
          </div>
        </div>
      `;
        } else {
            quotationsHTML = '<div class="alert alert-warning mb-3">No vendor quotes received yet.</div>';
        }

        document.getElementById('salesPriceItemInfo').innerHTML = `
        <div style="margin-bottom: 0;">
          <h4 style="font-size: 1.1rem; margin-bottom: 0.5rem;">${item.productId?.materialName || 'Unknown'}</h4>
          <p class="text-muted mb-3" style="font-size: 0.9rem;">Quantity: ${item.quantity} ${item.productId?.uom || ''}</p>
          ${quotationsHTML}
        </div>
    `;

        document.getElementById('salesPriceInput').value = item.salesPrice || '';
        calculateSalesTotal();
        document.getElementById('salesPriceModal').classList.add('active');
    } catch (error) {
        console.error('Load quotations error:', error);
        showToast('Failed to load quotations', 'error');
    }
}

// Calculate total sales amount
function calculateSalesTotal() {
    const salesPrice = parseFloat(document.getElementById('salesPriceInput').value) || 0;
    const quantity = currentSalesItemQuantity;

    const total = salesPrice * quantity;

    document.getElementById('salesTotalPrice').textContent = formatCurrency(total);
    document.getElementById('salesTotalBreakdown').textContent =
        `₹${salesPrice.toFixed(2)} × ${quantity} = ₹${total.toFixed(2)}`;
}

function closeSalesPriceModal() {
    document.getElementById('salesPriceModal').classList.remove('active');
}

async function saveSalesPrice() {
    const salesPrice = parseFloat(document.getElementById('salesPriceInput').value);
    const selectedQuote = document.querySelector('input[name="selectedQuote"]:checked');
    const selectedVendorQuoteId = selectedQuote ? selectedQuote.value : null;

    if (!salesPrice || salesPrice <= 0) {
        showToast('Please enter valid sales price', 'error');
        return;
    }

    try {
        await apiCall(`/enquiries/${currentEnquiryId}/items/${currentItemId}/sales-price`, {
            method: 'PUT',
            body: JSON.stringify({ salesPrice, selectedVendorQuoteId })
        });

        showToast('Sales price saved successfully!');
        await loadData();
        closeSalesPriceModal();
    } catch (error) {
        console.error('Save sales price error:', error);
        showToast('Failed to save sales price', 'error');
    }
}

async function markComplete(enquiryId, itemId) {
    if (!confirm('Mark this item as completed?')) return;

    try {
        await apiCall(`/enquiries/${enquiryId}/items/${itemId}/complete`, {
            method: 'PUT'
        });

        showToast('Item marked as completed!');
        await loadData();
    } catch (error) {
        console.error('Mark complete error:', error);
        showToast('Failed to mark as complete', 'error');
    }
}

// Close reason modal state
let _closeTarget = null; // { enquiryId, itemId? }

function openItemCloseModal(enquiryId, itemId) {
    _closeTarget = { enquiryId, itemId, type: 'item' };
    _openCloseModal('Mark Item Unsuccessful', 'Why is this item being marked unsuccessful?');
}

function closeEnquiryUnsuccessful(enquiryId) {
    _closeTarget = { enquiryId, type: 'enquiry' };
    _openCloseModal('Close Enquiry', 'Why is this enquiry being closed as unsuccessful?');
}

function _openCloseModal(title, placeholder) {
    document.getElementById('closeReasonModalTitle').textContent = title;
    document.getElementById('closeReasonInput').value = '';
    document.getElementById('closeReasonInput').placeholder = placeholder || 'e.g. Customer cancelled, no suitable vendor...';
    document.getElementById('closeReasonError').style.display = 'none';
    document.getElementById('closeReasonModal').classList.add('active');
}

async function confirmCloseWithReason() {
    const reason = document.getElementById('closeReasonInput').value.trim();
    if (!reason) {
        document.getElementById('closeReasonError').style.display = '';
        return;
    }

    try {
        if (_closeTarget.type === 'enquiry') {
            await apiCall(`/enquiries/${_closeTarget.enquiryId}/unsuccessful`, {
                method: 'PUT',
                body: JSON.stringify({ closeReason: reason })
            });
            showToast('Enquiry closed', 'warning');
        } else {
            await apiCall(`/enquiries/${_closeTarget.enquiryId}/items/${_closeTarget.itemId}/unsuccessful`, {
                method: 'PUT',
                body: JSON.stringify({ closeReason: reason })
            });
            showToast('Item marked unsuccessful', 'warning');
        }
        document.getElementById('closeReasonModal').classList.remove('active');
        _closeTarget = null;
        await loadData();
    } catch (error) {
        showToast(error.message || 'Failed to close', 'error');
    }
}

async function reopenEnquiry(enquiryId) {
    if (!confirm('Reopen this enquiry? Unsuccessful items will move back to Unassigned.')) return;
    try {
        await apiCall(`/enquiries/${enquiryId}/reopen`, { method: 'PUT' });
        showToast('Enquiry reopened', 'success');
        await loadData();
    } catch (error) {
        showToast(error.message || 'Failed to reopen', 'error');
    }
}

async function deleteEnquiry(enquiryId) {
    if (!confirm('Are you sure you want to PERMANENTLY delete this enquiry? This action cannot be undone.')) return;

    try {
        showToast('Deleting enquiry...', 'info');
        await apiCall(`/enquiries/${enquiryId}`, {
            method: 'DELETE'
        });

        showToast('Enquiry deleted successfully', 'success');
        await loadData();
    } catch (error) {
        console.error('Delete enquiry error:', error);
        showToast('Failed to delete enquiry: ' + (error.message || 'Unknown error'), 'error');
    }
}

// View All Vendor Quotes for Item
async function viewItemQuotes(itemId) {
    try {
        const quotes = await apiCall(`/vendors/quotations/item/${itemId}`);
        const item = enquiries.flatMap(e => e.items).find(i => i._id === itemId);

        if (!item) return;

        let quotesHtml = '';
        if (quotes.length > 0) {
            quotesHtml = quotes.map((q, idx) => {
                const total = (q.vendorPrice * item.quantity) + q.freightPrice;
                return `
                <div class="card mb-2" style="padding: 1rem;">
                    <div class="flex-between mb-2">
                        <h5><i class="ph ph-building"></i> ${q.vendorId?.name || 'Unknown Vendor'}</h5>
                        <span class="badge badge-pending">Quote ${idx + 1}</span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem;">
                        <div>
                            <span class="detail-label">Unit Price</span>
                            <div class="detail-value text-primary">${formatCurrency(q.vendorPrice)}</div>
                        </div>
                        <div>
                            <span class="detail-label">Quantity</span>
                            <div class="detail-value">${item.quantity}</div>
                        </div>
                        <div>
                            <span class="detail-label">Freight</span>
                            <div class="detail-value">${formatCurrency(q.freightPrice)}</div>
                        </div>
                        <div>
                            <span class="detail-label">Total Price</span>
                            <div class="detail-value text-success" style="font-weight: 700;">${formatCurrency(total)}</div>
                        </div>
                    </div>
                    ${q.notes ? `<div class="mt-2 text-muted" style="font-size: 0.875rem;"><strong>Notes:</strong> ${q.notes}</div>` : ''}
                </div>
            `}).join('');
        } else {
            quotesHtml = '<div class="alert alert-warning">No vendor quotes available yet.</div>';
        }

        document.getElementById('viewQuotesContent').innerHTML = `
            <h4 class="mb-3"><i class="ph ph-package"></i> ${item.productId?.materialName || 'Unknown'}</h4>
            <p class="text-muted mb-3">Quantity: ${item.quantity} ${item.productId?.uom || ''}</p>
            ${quotesHtml}
        `;

        document.getElementById('viewQuotesModal').classList.add('active');
    } catch (error) {
        console.error('Error loading quotes:', error);
        showToast('Failed to load quotes', 'error');
    }
}

function closeViewQuotesModal() {
    document.getElementById('viewQuotesModal').classList.remove('active');
}

function updateCostPrice(price) {
    document.getElementById('costPriceDisplay').value = price;
    // Auto-recalculate if margin or sales price exists
    if (document.getElementById('salesMarginInput').value) {
        calculateSalesPriceFromMargin();
    } else {
        calculateMarginFromSalesPrice();
    }
}

function calculateSalesPriceFromMargin() {
    const cost = parseFloat(document.getElementById('costPriceDisplay').value) || 0;
    const marginPercent = parseFloat(document.getElementById('salesMarginInput').value) || 0;

    if (cost > 0) {
        // Formula: Sales = Cost / (1 - Margin/100)  -- Gross Margin
        // If margin is 100%, avoid div by zero
        if (marginPercent >= 100) {
            // Edge case
            return;
        }
        const salesPrice = cost / (1 - (marginPercent / 100));
        document.getElementById('salesPriceInput').value = salesPrice.toFixed(2);
        calculateSalesTotal();
    }
}

function calculateMarginFromSalesPrice() {
    const cost = parseFloat(document.getElementById('costPriceDisplay').value) || 0;
    const salesPrice = parseFloat(document.getElementById('salesPriceInput').value) || 0;

    if (cost > 0 && salesPrice > 0) {
        // Margin = (Sales - Cost) / Sales * 100
        const margin = ((salesPrice - cost) / salesPrice) * 100;
        document.getElementById('salesMarginInput').value = margin.toFixed(1);
    }
    calculateSalesTotal();
}

// Download Enquiry Quotation
async function downloadEnquiryQuotation(enquiryId) {
    // Open the new editable quotation template
    openQuotationEditor(enquiryId, null);
}

function closeDownloadQuotationModal() {
    document.getElementById('downloadQuotationModal').classList.remove('active');
}

async function confirmDownloadQuotation(enquiryId) {
    try {
        const enquiry = enquiries.find(e => e._id === enquiryId);
        if (!enquiry) {
            showToast('Enquiry not found', 'error');
            return;
        }

        // Get selected format
        const formatRadio = document.querySelector('input[name="quoteFormat"]:checked');
        const format = formatRadio ? formatRadio.value : 'pdf';

        // Get target items to process
        const targetIdsInput = document.getElementById('downloadQuoteTargetItemIds');
        const targetIds = targetIdsInput ? JSON.parse(targetIdsInput.value) : null;

        let itemsToProcess = enquiry.items;
        if (targetIds && targetIds.length > 0) {
            itemsToProcess = enquiry.items.filter(item => targetIds.includes(item._id));
        }

        // Collect selected vendor quotes from radio buttons
        const selectedQuotes = {};
        let allItemsHaveSelection = true;
        let allItemsHaveSalesPrice = true;

        itemsToProcess.forEach(item => {
            // Check if item has sales price
            if (!item.salesPrice) {
                allItemsHaveSalesPrice = false;
                return;
            }

            // Get selected vendor quote
            const selectedRadio = document.querySelector(`input[name="vendor_${item._id}"]:checked`);
            if (!selectedRadio) {
                allItemsHaveSelection = false;
                return;
            }

            // Find the selected quote from the fetched quotations
            const quoteId = selectedRadio.value;
            selectedQuotes[item._id] = { _id: quoteId };
        });

        if (!allItemsHaveSalesPrice) {
            showToast(`Please enter sales price for all items before generating ${format.toUpperCase()}`, 'error');
            return;
        }

        if (!allItemsHaveSelection) {
            showToast('Please select vendor quote for all items', 'error');
            return;
        }

        // Fetch all vendor quotations for selected items
        const quotationsPromises = itemsToProcess.map(item =>
            apiCall(`/vendors/quotations/item/${item._id}`)
        );
        const allQuotations = await Promise.all(quotationsPromises);

        // Map selected quotes to full quote objects
        itemsToProcess.forEach((item, index) => {
            const quotes = allQuotations[index];
            const selectedQuoteId = selectedQuotes[item._id]._id;
            const fullQuote = quotes.find(q => q._id === selectedQuoteId);
            if (fullQuote) {
                selectedQuotes[item._id] = fullQuote;
            }
        });

        // Create a temporary enquiry object with only the selected items
        const filteredEnquiry = {
            ...enquiry,
            items: itemsToProcess
        };

        if (format === 'pdf') {
            showToast('Generating PDF...', 'info');
            const pdfGenerator = new QuotationPDFGenerator();
            await pdfGenerator.generateQuotation(filteredEnquiry, selectedQuotes);
            showToast('PDF generated successfully!', 'success');
        } else {
            showToast('Generating Word Document...', 'info');
            const docxGenerator = new QuotationDocxGenerator();
            await docxGenerator.generateQuotation(filteredEnquiry, selectedQuotes);
            showToast('Word Document generated successfully!', 'success');
        }

        closeDownloadQuotationModal();
    } catch (error) {
        console.error('Quotation generation error:', error);
        showToast('Failed to generate quotation: ' + error.message, 'error');
    }
}

// Selection Logic
function toggleItemQuoteSelection(enquiryId, itemId) {
    if (!selectedForQuote[enquiryId]) {
        selectedForQuote[enquiryId] = new Set();
    }

    const set = selectedForQuote[enquiryId];
    if (set.has(itemId)) {
        set.delete(itemId);
    } else {
        set.add(itemId);
    }

    // Refresh UI to update button count
    const enquiry = enquiries.find(e => e._id === enquiryId);
    if (enquiry) refreshEnquiryCard(enquiry);
}

function toggleSelectAllQuote(enquiryId, checkbox) {
    const enquiry = enquiries.find(e => e._id === enquiryId);
    if (!enquiry) return;

    if (!selectedForQuote[enquiryId]) {
        selectedForQuote[enquiryId] = new Set();
    }
    const set = selectedForQuote[enquiryId];

    if (checkbox.checked) {
        // Select all ready items
        enquiry.items.forEach(item => {
            if (['priced', 'sales_priced', 'completed'].includes(item.status)) {
                set.add(item._id);
            }
        });
    } else {
        // Deselect all
        set.clear();
    }

    // Refresh UI
    if (enquiry) refreshEnquiryCard(enquiry);
}

// Updated Quotation Logic
function downloadEnquiryQuotation(enquiryId, isPartial = false, specificItemIds = null) {
    const enquiry = enquiries.find(e => e._id === enquiryId);
    if (!enquiry) return;

    let itemsInfo = [];
    let itemsToProcess = [];

    if (specificItemIds) {
        // Direct single item download
        itemsToProcess = enquiry.items.filter(i => specificItemIds.includes(i._id));
    } else if (isPartial) {
        // Selected items download
        const selectedIds = selectedForQuote[enquiryId];
        if (!selectedIds || selectedIds.size === 0) {
            showToast('No items selected', 'error');
            return;
        }
        itemsToProcess = enquiry.items.filter(i => selectedIds.has(i._id));
    } else {
        // Fallback: All ready items (legacy behavior but stricter)
        itemsToProcess = enquiry.items.filter(i => ['priced', 'sales_priced', 'completed'].includes(i.status));
    }

    if (itemsToProcess.length === 0) {
        showToast('No ready items found to quote', 'error');
        return;
    }

    // Render modal content for these items
    let content = `
        <div class="alert alert-info mb-3">
            <i class="ph ph-info"></i>
            Generating quotation for <strong>${itemsToProcess.length}</strong> item(s).
        </div>
        
        <input type="hidden" id="downloadQuoteEnquiryId" value="${enquiryId}">
        <input type="hidden" id="downloadQuoteItemIds" value='${JSON.stringify(itemsToProcess.map(i => i._id))}'>
        
        <div class="mb-3">
             <div class="enquiry-info-grid mb-3">
                <div>
                    <span class="detail-label">Enquiry #</span>
                    <div class="detail-value">${enquiry.enquiryNumber}</div>
                </div>
                <div>
                   <span class="detail-label">Customer</span>
                   <div class="detail-value">${enquiry.customerId?.name || ''}</div>
                </div>
            </div>
        </div>
    `;

    // This old implementation is replaced - now use quotation editor
    // Simply call the new quotation editor instead
    openQuotationEditor(enquiryId, itemsToProcess.map(i => i._id));
}

function handleUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const enquiryId = urlParams.get('enquiryId');
    if (enquiryId) {
        console.log('🔄 Notification Navigation: Target Enquiry ID', enquiryId);
        let retries = 0;
        const maxRetries = 8; // Increased retries

        const attemptNavigation = () => {
            const row = document.getElementById(`enquiry-${enquiryId}`);
            if (row) {
                console.log('✅ Notification Navigation: Row found');
                const itemsDiv = document.getElementById(`items-${enquiryId}`);
                if (itemsDiv && !itemsDiv.classList.contains('expanded')) {
                    toggleEnquiry(enquiryId);
                }

                // Smooth scroll to row
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Highlight with pulse animation
                row.classList.add('highlight-enquiry');

                // Clear the URL parameter so it doesn't re-trigger on re-renders
                const cleanUrl = window.location.pathname;
                history.replaceState(null, '', cleanUrl);

                // Remove highlight class after animation finishes
                setTimeout(() => {
                    row.classList.remove('highlight-enquiry');
                }, 4000);
            } else if (retries < maxRetries) {
                retries++;
                console.log(`⚠️ Notification Navigation: Row not found, retrying (${retries}/${maxRetries})...`);
                setTimeout(attemptNavigation, 500);
            } else {
                console.error('❌ Notification Navigation: Failed to find row after retries');
            }
        };

        // Use a smaller initial delay if data is already present
        const initialDelay = enquiries.length > 0 ? 100 : 800;
        setTimeout(attemptNavigation, initialDelay);
    }
}
function handleVendorSelection(input, itemId) {
    const isCheapest = input.getAttribute('data-is-cheapest') === 'true';
    const container = input.closest('.radio-option');
    const name = input.name;

    // Remove selected and warning-active class from all options in this group
    document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
        const option = r.closest('.radio-option');
        option.classList.remove('selected', 'warning-active');
        // Clear warning messages
        const warningArea = option.querySelector('.vendor-warning-area');
        if (warningArea) warningArea.innerHTML = '';
    });

    // Add selected class to the current one
    container.classList.add('selected');

    // If not cheapest, show warning
    if (!isCheapest) {
        container.classList.add('warning-active');
        const warningArea = container.querySelector('.vendor-warning-area');
        if (warningArea) {
            warningArea.innerHTML = `
                <div class="vendor-warning-alert mt-2" style="background: rgba(231, 76, 60, 0.1); color: #e74c3c; padding: 0.5rem; border-radius: 0.5rem; font-size: 0.8rem; border: 1px solid rgba(231, 76, 60, 0.2);">
                    <i class="ph ph-warning-circle"></i>
                    <span>This is not the cheapest option.</span>
                </div>
            `;
        }
    }

    // Update global summary
    updateQuotationSummaryValue();
}

function handleFormatChange(input) {
    // Remove active class from all format cards
    document.querySelectorAll('.format-card').forEach(card => {
        card.classList.remove('active');
    });
    // Add active class to the selected one
    if (input.checked) {
        input.closest('.format-card').classList.add('active');
    }
}

function updateQuotationSummaryValue() {
    const summaryEl = document.getElementById('summaryTotalValue');
    if (!summaryEl) return;

    let total = 0;
    const itemIds = JSON.parse(document.getElementById('downloadQuoteTargetItemIds').value || '[]');

    itemIds.forEach(itemId => {
        const selectedRadio = document.querySelector(`input[name="vendor_${itemId}"]:checked`);
        if (selectedRadio) {
            // We need to get the total from the data or DOM
            const card = selectedRadio.closest('.vendor-glass-card');
            const totalStr = card.querySelector('.text-primary').innerText;
            const value = parseFloat(totalStr.replace(/[^\d.]/g, ''));
            total += value;
        }
    });

    summaryEl.innerText = formatCurrency(total);
}

// --- Sales Query Chat Logic ---
let chatInterval = null;
let currentChatEnquiryId = null;

async function openChat(enquiryId, enquiryNumber) {
    currentChatEnquiryId = enquiryId;

    // Find the enquiry object to get its items
    const enquiry = enquiries.find(e => e._id === enquiryId);
    if (!enquiry) {
        console.error('Enquiry not found for chat:', enquiryId);
        showToast('Enquiry not found', 'error');
        return;
    }
    const items = enquiry.items;

    const allItemsQuoted = items.length > 0 && items.every(i => ['vendor_quoted', 'sales_priced', 'completed'].includes(i.status));
    const isReadOnly = allItemsQuoted;

    // Create modal if it doesn't exist
    let modal = document.getElementById('chatModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'chatModal';
        modal.className = 'modal';
        modal.style.zIndex = '2000'; // Ensure it's above other modals
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px; width: 95%;">
                <div class="modal-header">
                    <h3 class="modal-title"><i class="ph ph-chat-text"></i> Sales Query: ${enquiryNumber}</h3>
                    <button class="close-btn" onclick="closeChat()">&times;</button>
                </div>
                <div class="chat-container">
                    <div class="chat-messages" id="chatMessages">
                        <div class="text-center p-4 text-muted">Loading messages...</div>
                    </div>
                    ${isReadOnly ?
                `<div class="p-3 text-center text-muted border-t" style="font-size: 0.9rem; background: var(--bg-hover);">
                            <i class="ph ph-lock-key"></i> Conversation closed. Enquiry is fully quoted.
                         </div>` :
                `<div class="chat-input-area">
                            <input type="text" id="chatInput" class="chat-input" placeholder="Type your message..." onkeypress="if(event.key === 'Enter') sendChatMessage()">
                            <button class="btn btn-primary" onclick="sendChatMessage()" style="border-radius: 50%; width: 40px; height: 40px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                <i class="ph ph-paper-plane-right" style="font-size: 1.25rem;"></i>
                            </button>
                        </div>`
            }
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    } else {
        modal.querySelector('.modal-title').innerHTML = `<i class="ph ph-chat-text"></i> Sales Query: ${enquiryNumber}`;
        const container = modal.querySelector('.chat-container');
        // Remove existing input area if it exists to refresh logic
        const existingInput = container.querySelector('.chat-input-area');
        const existingLock = container.querySelector('.text-center.text-muted.border-t'); // simple check
        if (existingInput) existingInput.remove();
        if (existingLock) existingLock.remove();

        if (isReadOnly) {
            container.insertAdjacentHTML('beforeend', `
                <div class="p-3 text-center text-muted border-t" style="font-size: 0.9rem; background: var(--bg-hover);">
                   <i class="ph ph-lock-key"></i> Conversation closed. Enquiry is fully quoted.
                </div>
            `);
        } else {
            container.insertAdjacentHTML('beforeend', `
                <div class="chat-input-area">
                    <input type="text" id="chatInput" class="chat-input" placeholder="Type your message..." onkeypress="if(event.key === 'Enter') sendChatMessage()">
                    <button class="btn btn-primary" onclick="sendChatMessage()" style="border-radius: 50%; width: 40px; height: 40px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="ph ph-paper-plane-right" style="font-size: 1.25rem;"></i>
                    </button>
                </div>
            `);
        }
    }

    modal.classList.add('active');
    loadMessages(enquiryId);

    // Start polling
    if (chatInterval) clearInterval(chatInterval);
    chatInterval = setInterval(() => loadMessages(enquiryId), 3000);
}

function closeChat() {
    const modal = document.getElementById('chatModal');
    if (modal) modal.classList.remove('active');
    if (chatInterval) clearInterval(chatInterval);
    chatInterval = null;
    currentChatEnquiryId = null;
}

async function loadMessages(enquiryId) {
    if (currentChatEnquiryId !== enquiryId) return;

    try {
        const messages = await apiCall(`/enquiries/${enquiryId}/queries`);
        const container = document.getElementById('chatMessages');
        if (!container) return;

        if (messages.length === 0) {
            container.innerHTML = '<div class="text-center p-8 text-muted" style="font-size: 0.85rem;">No messages yet. Waiting for sourcing team.</div>';
            return;
        }

        const currentUser = JSON.parse(localStorage.getItem('user'));

        const html = messages.map(m => {
            const isMe = m.senderId._id === (currentUser.id || currentUser._id);
            return `
                <div class="chat-message ${isMe ? 'sent' : 'received'}">
                    <div style="font-weight: 600; font-size: 0.7rem; margin-bottom: 0.2rem; opacity: 0.9;">
                        ${isMe ? 'Me' : m.senderId.name} (${m.senderId.role})
                    </div>
                    <div>${m.message}</div>
                    <div class="message-info">${new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
            `;
        }).join('');

        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
        const oldHtml = container.innerHTML;
        container.innerHTML = html;

        if (isAtBottom || oldHtml.includes('Loading messages...')) {
            container.scrollTop = container.scrollHeight;
        }
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message || !currentChatEnquiryId) return;

    try {
        input.value = '';
        await apiCall(`/enquiries/${currentChatEnquiryId}/queries`, {
            method: 'POST',
            body: JSON.stringify({ message })
        });
        loadMessages(currentChatEnquiryId);
    } catch (error) {
        showToast('Failed to send message', 'error');
    }
}
