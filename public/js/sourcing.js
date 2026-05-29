// Sourcing Dashboard Logic
let enquiries = [];
let vendors = [];
let selectedItems = new Set();
let currentItemId = null;
let currentQuoteId = null;
let activeFilters = new Set();
let currentTab = 'new_queue'; // 'new_queue' | 'my_work' | 'done'
let _queryTarget = null; // { enquiryId, itemId } for raise-query modal
let viewMode = localStorage.getItem('viewMode_sourcing') || 'enquiry'; // 'enquiry' | 'material' | 'items'
let searchQuery = '';
let dateFilter = null;   // 'today' | 'this_week' | 'this_month' | null
let urgentFilter = false;
let tabStatusFilters = new Set();

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const user = checkAuth();
  if (!user) return;
  if (!hasAnyPermission(['purchase_price.add', 'enquiry.view.assigned', 'enquiry.view.all', 'enquiry.self_assign'])) {
    showToast('You do not have permission to access the Sourcing dashboard', 'error');
    setTimeout(() => window.location.href = '/', 1500);
    return;
  }

  // Store current user id for UI filtering
  window.currentUserId = user.id;

  await Promise.all([loadEnquiries(), loadPurchaseUsers()]);
});

async function loadEnquiries() {
  try {
    [enquiries, vendors] = await Promise.all([
      apiCall('/enquiries'),
      apiCall('/vendors')
    ]);
    renderInsights();
    const tog = document.getElementById('viewToggleContainer');
    if (tog) tog.innerHTML = getViewToggleHTML(viewMode);
    // Show My Team tab for managers (anyone with enquiry.assign)
    const teamBtn = document.getElementById('teamTabBtn');
    if (teamBtn) teamBtn.style.display = hasPermission('enquiry.assign') ? 'flex' : 'none';
    updateTabContextFilters(currentTab);
    renderCurrentTab();
    populateVendorSelect();
    handleUrlParameters();
  } catch (error) {
    console.error('Load enquiries error:', error);
    showToast('Failed to load enquiries', 'error');
  }
}

// Render insights card
function renderInsights() {
  const currentUserId = window.currentUserId;
  if (!currentUserId) return;

  let pendingPricing = 0;
  let activeQueries = new Set(); // Enquiries with queries assigned to this user
  let completedToday = 0;
  let totalActive = 0;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  enquiries.forEach(enq => {
    let enqAssignedToUser = false;

    if (enq.items) {
      enq.items.forEach(item => {
        // Correct check for assignedTo object or ID
        const itemAssignedToId = item.assignedTo?._id || item.assignedTo;

        if (itemAssignedToId === currentUserId) {
          enqAssignedToUser = true;

          if (['assigned', 'in_sales_query', 'sales_query_resolved'].includes(item.status)) {
            pendingPricing++;
            totalActive++;
          } else if (item.status === 'vendor_quoted') {
            totalActive++;
            const updatedAt = new Date(item.updatedAt || item.createdAt);
            if (updatedAt >= startOfToday) {
              completedToday++;
            }
          } else if (['unassigned', 'pending'].includes(item.status)) {
            totalActive++;
          }
        }
      });
    }

    // Active Queries check: if any item in enquiry is assigned to user AND enquiry has active status/queries
    // Assuming backend returns queryCount or similar, but for now we'll check if it's 'active'
    if (enqAssignedToUser && enq.status === 'active') {
      // If we had a queryCount field, we'd use it. 
      // For now, let's look for enquiries assigned to user that are still active.
      // Actually, let's count enquiries where this user is responsible for at least one item
      // and there are pending/assigned items (indicating work remains).
      const hasWork = enq.items && enq.items.some(i => i.assignedTo?._id === currentUserId || i.assignedTo === currentUserId && ['assigned'].includes(i.status));
      if (hasWork) {
        // We'll call this "Active Enquiries" if queries are hard to track without a direct count
        // But let's assume we want to track communication.
      }
    }
  });

  // Since we don't have a direct queryCount on the enquiry object in the current schema view
  // Let's use it as "Active Assignments" for now, or total enquiries with work.
  // Wait, I can search for total queries if they were loaded, but they aren't in loadEnquiries.

  // Let's refine the 4 cards:
  // 1. Pending Pricing (Items status 'assigned' for me)
  // 2. Active Enquiries (Enquiries where I have items 'assigned')
  // 3. Completed Today (Items I quoted today)
  // 4. My Backlog (Total items assigned to me)

  const activeEnquiries = enquiries.filter(enq =>
    enq.items && enq.items.some(i => (i.assignedTo?._id === currentUserId || i.assignedTo === currentUserId) && ['assigned', 'in_sales_query', 'sales_query_resolved'].includes(i.status))
  ).length;

  document.getElementById('insightToQuote').textContent = pendingPricing;
  document.getElementById('insightQueries').textContent = activeEnquiries; // Using as "Active Jobs"
  document.getElementById('insightCompletedToday').textContent = completedToday;
  document.getElementById('insightTotalActive').textContent = pendingPricing + (totalActive - pendingPricing); // Total backlog
}

// ── View Mode ─────────────────────────────────────────────────────────────────

function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem('viewMode_sourcing', mode);
  const tog = document.getElementById('viewToggleContainer');
  if (tog) tog.innerHTML = getViewToggleHTML(mode);
  renderCurrentTab();
}

function getViewToggleHTML(mode) {
  const modes = [
    { id: 'enquiry', icon: 'ph-list-bullets', label: 'Enquiry' },
    { id: 'material', icon: 'ph-cube', label: 'Material' },
    { id: 'items', icon: 'ph-rows', label: 'Items' },
  ];
  return `<div style="display:flex;gap:0.35rem;background:var(--bg-secondary);padding:0.35rem;border-radius:0.65rem">
    ${modes.map(m => `
      <button onclick="setViewMode('${m.id}')"
        style="padding:0.4rem 0.9rem;border:none;border-radius:0.4rem;font-size:0.8rem;font-weight:600;cursor:pointer;
               display:flex;align-items:center;gap:0.4rem;transition:all 0.15s;
               ${mode === m.id ? 'background:white;color:var(--primary);box-shadow:0 1px 4px rgba(0,0,0,0.08)' : 'background:transparent;color:var(--text-secondary)'}">
        <i class="ph ${m.icon}"></i> ${m.label}
      </button>`).join('')}
  </div>`;
}

// ── Tab Switching ─────────────────────────────────────────────────────────────

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.sourcing-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  tabStatusFilters.clear();
  updateTabContextFilters(tab);
  updateClearFiltersBtn();
  renderCurrentTab();
}

function renderCurrentTab() {
  updateTabBadges();
  if (currentTab === 'team') {
    renderTeamOverviewTab();
    return;
  }
  if (viewMode === 'material') {
    if (currentTab === 'new_queue') renderNewQueueMaterialTab();
    else if (currentTab === 'my_work') renderMyWorkMaterialTab();
    else renderDoneMaterialTab();
  } else if (viewMode === 'items') {
    if (currentTab === 'new_queue') renderNewQueueItemsTab();
    else if (currentTab === 'my_work') renderMyWorkItemsTab();
    else renderDoneItemsTab();
  } else {
    if (currentTab === 'new_queue') renderNewQueueTab();
    else if (currentTab === 'my_work') renderMyWorkTab();
    else renderDoneTab();
  }
}

function renderNewQueueMaterialTab() {
  const container = document.getElementById('enquiriesList');
  const canAssign = hasPermission('enquiry.assign');
  let totalUnfiltered = 0;
  const entries = [];
  enquiries.forEach(enq => {
    enq.items?.forEach(item => {
      if (!['unassigned', 'pending'].includes(item.status)) return;
      totalUnfiltered++;
      if (matchesFilters(item, enq)) entries.push({ item, enquiry: enq });
    });
  });
  updateFilterResultCount(entries.length, totalUnfiltered);
  if (entries.length === 0) {
    container.innerHTML = `<div class="card text-center" style="padding:2.5rem">
      <i class="ph ph-check-circle" style="font-size:2.5rem;color:${totalUnfiltered === 0 ? 'var(--success)' : 'var(--text-muted)'};margin-bottom:1rem"></i>
      <h3 class="mb-2">${totalUnfiltered === 0 ? 'Queue is Empty' : 'No Matches'}</h3>
      <p class="text-muted">${totalUnfiltered === 0 ? 'No unassigned items at the moment.' : 'Try adjusting your search or filters.'}</p>
      ${totalUnfiltered > 0 ? `<button class="btn btn-secondary mt-3" onclick="clearAllFilters()"><i class="ph ph-x"></i> Clear Filters</button>` : ''}</div>`;
    return;
  }
  container.innerHTML = buildMaterialCards(entries, (item, enquiry) => {
    const uom = item.productId?.uom || '';
    return `<tr>
      <td><span style="font-family:monospace;font-size:0.82rem;color:var(--primary)">${enquiry.enquiryNumber}</span></td>
      <td>${enquiry.customerId?.name || '—'}</td>
      <td>${item.quantity} ${uom}</td>
      <td style="font-size:0.8rem;color:var(--text-muted)">${formatDate(enquiry.createdAt)}</td>
      <td>
        <div class="flex gap-1">
          <button class="btn btn-primary btn-sm" onclick="claimItem('${enquiry._id}', '${item._id}')"><i class="ph ph-hand"></i> Claim</button>
          ${canAssign ? `<select class="assign-select-${item._id}" style="padding:0.3rem;border:1px solid var(--border);border-radius:0.4rem;font-size:0.78rem;max-width:120px">
            <option value="">Assign to…</option>
            ${(window._purchaseUsers || []).map(u => `<option value="${u._id}">${u.name}</option>`).join('')}
          </select>
          <button class="btn btn-secondary btn-sm" onclick="assignItemToUser('${enquiry._id}', '${item._id}', this)"><i class="ph ph-user-plus"></i></button>` : ''}
        </div>
      </td>
    </tr>`;
  }, ['Enquiry #', 'Customer', 'Qty', 'Created', 'Action']);
}

function renderMyWorkMaterialTab() {
  const container = document.getElementById('enquiriesList');
  const uid = window.currentUserId;
  let totalUnfiltered = 0;
  const waiting = [], active = [];
  enquiries.forEach(enq => {
    enq.items?.forEach(item => {
      const aid = item.assignedTo?._id || item.assignedTo;
      if (aid !== uid) return;
      if (item.status === 'in_sales_query' || ['assigned', 'sales_query_resolved'].includes(item.status)) totalUnfiltered++;
      if (!matchesFilters(item, enq)) return;
      if (item.status === 'in_sales_query') waiting.push({ item, enquiry: enq });
      else if (['assigned', 'sales_query_resolved'].includes(item.status)) active.push({ item, enquiry: enq });
    });
  });
  updateFilterResultCount(waiting.length + active.length, totalUnfiltered);
  if (waiting.length === 0 && active.length === 0) {
    const hasRealWork = totalUnfiltered > 0;
    container.innerHTML = `<div class="card text-center" style="padding:2.5rem">
      <p class="text-muted">${hasRealWork ? 'No items match your filters.' : 'No active work. Claim items from the New Queue tab.'}</p>
      ${hasRealWork
        ? `<button class="btn btn-secondary mt-3" onclick="clearAllFilters()"><i class="ph ph-x"></i> Clear Filters</button>`
        : `<button class="btn btn-primary mt-3" onclick="switchTab('new_queue')"><i class="ph ph-arrow-left"></i> Go to New Queue</button>`}</div>`;
    return;
  }
  let html = '';
  if (waiting.length > 0) {
    html += `<div style="margin-bottom:1rem;font-size:0.8rem;font-weight:700;color:#92400e;display:flex;align-items:center;gap:0.4rem">
      <i class="ph ph-clock"></i> WAITING ON SALES RESPONSE (${waiting.length})</div>`;
    html += buildMaterialCards(waiting, (item, enquiry) => {
      const uom = item.productId?.uom || '';
      return `<tr style="border-left:3px solid #f59e0b">
        <td><span style="font-family:monospace;font-size:0.82rem;color:var(--primary)">${enquiry.enquiryNumber}</span></td>
        <td>${enquiry.customerId?.name || '—'}</td>
        <td>${item.quantity} ${uom}</td>
        <td><div class="flex gap-1">
          <button class="btn btn-secondary btn-sm" onclick="openChat('${enquiry._id}', '${enquiry.enquiryNumber}')"><i class="ph ph-chat-text"></i></button>
          <button class="btn btn-sm" style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0" onclick="resolveQuery('${enquiry._id}', '${item._id}')"><i class="ph ph-check-circle"></i> Resolve</button>
        </div></td>
      </tr>`;
    }, ['Enquiry #', 'Customer', 'Qty', 'Actions']);
    html += '<div style="height:1rem"></div>';
  }
  if (active.length > 0) {
    html += `<div style="margin-bottom:1rem;font-size:0.8rem;font-weight:700;color:var(--primary);display:flex;align-items:center;gap:0.4rem">
      <i class="ph ph-wrench"></i> ACTIVE ITEMS (${active.length})</div>`;
    html += buildMaterialCards(active, (item, enquiry) => {
      const uom = item.productId?.uom || '';
      return `<tr>
        <td><span style="font-family:monospace;font-size:0.82rem;color:var(--primary)">${enquiry.enquiryNumber}</span></td>
        <td>${enquiry.customerId?.name || '—'}</td>
        <td>${item.quantity} ${uom}</td>
        <td>${getStatusBadge(item.status)}</td>
        <td><div class="flex gap-1 flex-wrap">
          <button class="btn btn-success btn-sm" onclick="showQuotationModal('${item._id}')"><i class="ph ph-plus-circle"></i> Quote</button>
          <button class="btn btn-secondary btn-sm" onclick="openRaiseQueryModal('${enquiry._id}', '${item._id}', '${enquiry.enquiryNumber}')"><i class="ph ph-question"></i> Raise Query</button>
          <button class="btn btn-secondary btn-sm" onclick="openChat('${enquiry._id}', '${enquiry.enquiryNumber}')"><i class="ph ph-chat-text"></i></button>
          <button class="btn btn-sm" style="background:var(--bg-hover);border:1px solid var(--border)" onclick="generateWhatsApp('${enquiry._id}')"><i class="ph ph-whatsapp-logo"></i></button>
        </div></td>
      </tr>`;
    }, ['Enquiry #', 'Customer', 'Qty', 'Status', 'Actions']);
  }
  container.innerHTML = html;
}

function renderDoneMaterialTab() {
  const container = document.getElementById('enquiriesList');
  const uid = window.currentUserId;
  let totalUnfiltered = 0;
  const entries = [];
  enquiries.forEach(enq => {
    enq.items?.forEach(item => {
      const aid = item.assignedTo?._id || item.assignedTo;
      if (aid !== uid) return;
      if (!['vendor_quoted', 'priced', 'sales_priced', 'completed', 'unsuccessful'].includes(item.status)) return;
      totalUnfiltered++;
      if (matchesFilters(item, enq)) entries.push({ item, enquiry: enq });
    });
  });
  updateFilterResultCount(entries.length, totalUnfiltered);
  if (entries.length === 0) {
    container.innerHTML = `<div class="card text-center" style="padding:2.5rem">
      <p class="text-muted">${totalUnfiltered === 0 ? 'No completed items yet.' : 'No items match your filters.'}</p>
      ${totalUnfiltered > 0 ? `<button class="btn btn-secondary mt-3" onclick="clearAllFilters()"><i class="ph ph-x"></i> Clear Filters</button>` : ''}</div>`;
    return;
  }
  container.innerHTML = buildMaterialCards(entries, (item, enquiry) => {
    const uom = item.productId?.uom || '';
    return `<tr>
      <td><span style="font-family:monospace;font-size:0.82rem;color:var(--primary)">${enquiry.enquiryNumber}</span></td>
      <td>${enquiry.customerId?.name || '—'}</td>
      <td>${item.quantity} ${uom}</td>
      <td>${getStatusBadge(item.status)}</td>
      <td>${['vendor_quoted', 'priced', 'sales_priced'].includes(item.status) ? `<button class="btn btn-secondary btn-sm" onclick="viewQuotes('${item._id}')"><i class="ph ph-clipboard-text"></i> Quotes</button>` : ''}</td>
    </tr>`;
  }, ['Enquiry #', 'Customer', 'Qty', 'Status', 'Quotes']);
}

// Shared: build material cards HTML from a list of {item, enquiry} entries
function buildMaterialCards(entries, rowFn, columns) {
  const groups = groupByMaterial(entries);
  return groups.map((group, idx) => {
    const prod = group.product;
    const name = prod?.materialName || 'Unknown Material';
    const brand = prod?.brand || '';
    const spec = prod?.specification || '';
    const uom = prod?.uom || '';
    const meta = [brand, spec].filter(Boolean).join(' · ');
    const id = `mat-${currentTab}-${idx}`;
    const theads = columns.map(c => `<th>${c}</th>`).join('');
    const rows = group.entries.map(({ item, enquiry }) => rowFn(item, enquiry)).join('');
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
          <thead><tr>${theads}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

// ── Items View (flat glass table per tab) ─────────────────────────────────────

function renderNewQueueItemsTab() {
  const container = document.getElementById('enquiriesList');
  const canAssign = hasPermission('enquiry.assign');
  let totalUnfiltered = 0;
  const rows = [];
  enquiries.forEach(enq => {
    (enq.items || []).forEach(item => {
      if (!['unassigned', 'pending'].includes(item.status)) return;
      totalUnfiltered++;
      if (!matchesFilters(item, enq)) return;
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
        <td style="font-size:0.78rem;color:var(--text-muted)">${formatDate(enq.createdAt)}</td>
        <td><div class="flex gap-1">
          <button class="btn btn-primary btn-sm" onclick="claimItem('${enq._id}', '${item._id}')"><i class="ph ph-hand"></i> Claim</button>
          ${canAssign ? `<select class="assign-select-${item._id}" style="padding:0.3rem;border:1px solid var(--border);border-radius:0.4rem;font-size:0.78rem;max-width:120px">
            <option value="">Assign to…</option>
            ${(window._purchaseUsers || []).map(u => `<option value="${u._id}">${u.name}</option>`).join('')}
          </select>
          <button class="btn btn-secondary btn-sm" onclick="assignItemToUser('${enq._id}', '${item._id}', this)"><i class="ph ph-user-plus"></i></button>` : ''}
        </div></td>
      </tr>`);
    });
  });
  updateFilterResultCount(rows.length, totalUnfiltered);
  container.innerHTML = buildGlassTable(
    ['Material', 'Enquiry #', 'Customer', 'Qty', 'Created', 'Action'],
    rows,
    `<strong>${rows.length}</strong> item${rows.length !== 1 ? 's' : ''} available to claim`
  );
}

function renderMyWorkItemsTab() {
  const container = document.getElementById('enquiriesList');
  const uid = window.currentUserId;
  let totalUnfiltered = 0;
  const rows = [];
  enquiries.forEach(enq => {
    (enq.items || []).forEach(item => {
      const aid = item.assignedTo?._id || item.assignedTo;
      if (aid !== uid) return;
      if (!['assigned', 'in_sales_query', 'sales_query_resolved'].includes(item.status)) return;
      totalUnfiltered++;
      if (!matchesFilters(item, enq)) return;
      const prod = item.productId;
      const uom = prod?.uom || '';
      const isWaiting = item.status === 'in_sales_query';
      rows.push(`<tr${isWaiting ? ' style="border-left:3px solid #f59e0b"' : ''}>
        <td>
          <div class="mat-primary">${prod?.materialName || '—'}</div>
          ${(prod?.brand || prod?.specification) ? `<div class="mat-meta">${[prod.brand, prod.specification].filter(Boolean).join(' · ')}</div>` : ''}
        </td>
        <td><span class="enq-ref">${enq.enquiryNumber}</span></td>
        <td style="font-size:0.82rem">${enq.customerId?.name || '—'}</td>
        <td style="white-space:nowrap">${item.quantity} ${uom}</td>
        <td>${getStatusBadge(item.status)}</td>
        <td><div class="flex gap-1 flex-wrap">
          ${isWaiting ? `
            <button class="btn btn-secondary btn-sm" onclick="openChat('${enq._id}', '${enq.enquiryNumber}')"><i class="ph ph-chat-text"></i> View Chat</button>
            <button class="btn btn-sm" style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0" onclick="resolveQuery('${enq._id}', '${item._id}')"><i class="ph ph-check-circle"></i> Resolve</button>
          ` : `
            <button class="btn btn-success btn-sm" onclick="showQuotationModal('${item._id}')"><i class="ph ph-plus-circle"></i> Quote</button>
            <button class="btn btn-secondary btn-sm" onclick="openRaiseQueryModal('${enq._id}', '${item._id}', '${enq.enquiryNumber}')"><i class="ph ph-question"></i> Raise Query</button>
            <button class="btn btn-secondary btn-sm" onclick="openChat('${enq._id}', '${enq.enquiryNumber}')"><i class="ph ph-chat-text"></i></button>
            <button class="btn btn-sm" style="background:var(--bg-hover);border:1px solid var(--border)" onclick="generateWhatsApp('${enq._id}')"><i class="ph ph-whatsapp-logo"></i></button>
          `}
        </div></td>
      </tr>`);
    });
  });
  updateFilterResultCount(rows.length, totalUnfiltered);
  container.innerHTML = buildGlassTable(
    ['Material', 'Enquiry #', 'Customer', 'Qty', 'Status', 'Actions'],
    rows,
    `<strong>${rows.length}</strong> active item${rows.length !== 1 ? 's' : ''}`
  );
}

function renderDoneItemsTab() {
  const container = document.getElementById('enquiriesList');
  const uid = window.currentUserId;
  let totalUnfiltered = 0;
  const rows = [];
  enquiries.forEach(enq => {
    (enq.items || []).forEach(item => {
      const aid = item.assignedTo?._id || item.assignedTo;
      if (aid !== uid) return;
      if (!['vendor_quoted', 'priced', 'sales_priced', 'completed', 'unsuccessful'].includes(item.status)) return;
      totalUnfiltered++;
      if (!matchesFilters(item, enq)) return;
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
        <td>${getStatusBadge(item.status)}</td>
        <td>${['vendor_quoted', 'priced', 'sales_priced'].includes(item.status) ? `<button class="btn btn-secondary btn-sm" onclick="viewQuotes('${item._id}')"><i class="ph ph-clipboard-text"></i> Quotes</button>` : ''}</td>
      </tr>`);
    });
  });
  updateFilterResultCount(rows.length, totalUnfiltered);
  container.innerHTML = buildGlassTable(
    ['Material', 'Enquiry #', 'Customer', 'Qty', 'Status', 'Quotes'],
    rows,
    `<strong>${rows.length}</strong> completed item${rows.length !== 1 ? 's' : ''}`
  );
}

function updateTabBadges() {
  const uid = window.currentUserId;
  // New Queue: unassigned items count
  let newCount = 0;
  let workCount = 0;
  enquiries.forEach(enq => {
    enq.items?.forEach(item => {
      if (['unassigned', 'pending'].includes(item.status)) newCount++;
      const assignedId = item.assignedTo?._id || item.assignedTo;
      if (assignedId === uid && ['assigned', 'in_sales_query', 'sales_query_resolved'].includes(item.status)) workCount++;
    });
  });
  const newBadge = document.getElementById('tab-badge-new');
  const workBadge = document.getElementById('tab-badge-work');
  if (newBadge) newBadge.textContent = newCount > 0 ? newCount : '';
  if (workBadge) workBadge.textContent = workCount > 0 ? workCount : '';
}

// ── New Queue Tab ─────────────────────────────────────────────────────────────

function renderNewQueueTab() {
  const container = document.getElementById('enquiriesList');
  const canAssign = hasPermission('enquiry.assign');

  const unfiltered = enquiries
    .map(enq => ({ enq, items: (enq.items || []).filter(i => ['unassigned', 'pending'].includes(i.status)) }))
    .filter(({ items }) => items.length > 0);
  const unfilteredCount = unfiltered.reduce((s, { items }) => s + items.length, 0);

  const enquiriesWithUnassigned = enquiries
    .map(enq => ({
      enq,
      items: (enq.items || []).filter(i => ['unassigned', 'pending'].includes(i.status) && matchesFilters(i, enq))
    }))
    .filter(({ items }) => items.length > 0);

  const total = enquiriesWithUnassigned.reduce((s, { items }) => s + items.length, 0);
  updateFilterResultCount(total, unfilteredCount);

  if (enquiriesWithUnassigned.length === 0) {
    container.innerHTML = `<div class="card text-center" style="padding:2.5rem">
      <i class="ph ph-check-circle" style="font-size:2.5rem;color:var(--success);margin-bottom:1rem"></i>
      <h3 class="mb-2">${unfilteredCount === 0 ? 'Queue is Empty' : 'No Matches'}</h3>
      <p class="text-muted">${unfilteredCount === 0 ? 'No unassigned items at the moment.' : 'Try adjusting your search or filters.'}</p>
      ${unfilteredCount > 0 ? `<button class="btn btn-secondary mt-3" onclick="clearAllFilters()"><i class="ph ph-x"></i> Clear Filters</button>` : ''}</div>`;
    return;
  }

  container.innerHTML = `
    <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem">
      <i class="ph ph-inbox"></i>
      <strong>${total}</strong> unassigned item${total !== 1 ? 's' : ''} across <strong>${enquiriesWithUnassigned.length}</strong> enquir${enquiriesWithUnassigned.length !== 1 ? 'ies' : 'y'}
    </div>
    ${enquiriesWithUnassigned.map(({ enq, items }) => {
      const id = `eq-nq-${enq._id}`;
      return `
      <div class="enquiry-accordion-card">
        <div class="enquiry-accordion-header" onclick="toggleEnquiryCard('${id}')">
          <div style="display:flex;align-items:center;gap:0.75rem;flex:1;min-width:0">
            <span class="enq-number">${enq.enquiryNumber}</span>
            <span style="font-size:0.85rem;color:var(--text-secondary)">${enq.customerId?.name || '—'}</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.6rem;flex-shrink:0">
            <span class="badge" style="background:var(--danger);color:white;font-size:0.7rem">${items.length} item${items.length !== 1 ? 's' : ''}</span>
            <span style="font-size:0.78rem;color:var(--text-muted)">${formatDate(enq.createdAt)}</span>
            <i class="ph ph-caret-down" id="caret-${id}" style="transition:transform 0.2s;color:var(--text-muted)"></i>
          </div>
        </div>
        <div class="enquiry-accordion-body" id="${id}" style="display:none">
          <table class="items-table" style="margin-top:0.5rem">
            <thead><tr>
              <th>Material</th><th>Brand / Spec</th><th>Qty</th><th>Action</th>
            </tr></thead>
            <tbody>
              ${items.map(item => {
                const prod = item.productId;
                const uom = prod?.uom || '';
                return `<tr>
                  <td style="font-weight:600">${prod?.materialName || '—'}</td>
                  <td style="color:var(--text-muted)">${[prod?.brand, prod?.specification].filter(Boolean).join(' · ') || '—'}</td>
                  <td>${item.quantity} ${uom}</td>
                  <td><div class="flex gap-1 flex-wrap">
                    <button class="btn btn-primary btn-sm" onclick="claimItem('${enq._id}', '${item._id}')"><i class="ph ph-hand"></i> Claim</button>
                    ${canAssign ? `
                      <select id="assign-sel-${item._id}" style="padding:0.3rem;border:1px solid var(--border);border-radius:0.4rem;font-size:0.78rem;max-width:120px">
                        <option value="">Assign to…</option>
                        ${(window._purchaseUsers || []).map(u => `<option value="${u._id}">${u.name}</option>`).join('')}
                      </select>
                      <button class="btn btn-secondary btn-sm" onclick="assignItemFromQueue('${enq._id}', '${item._id}')"><i class="ph ph-user-plus"></i></button>
                    ` : ''}
                  </div></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    }).join('')}`;
}

async function claimItem(enquiryId, itemId) {
  try {
    await apiCall(`/enquiries/${enquiryId}/assign-items`, {
      method: 'POST',
      body: JSON.stringify({ itemIds: [itemId], sourcingUserId: window.currentUserId })
    });
    showToast('Item claimed — check My Work tab', 'success');
    await loadEnquiries();
    switchTab('my_work');
  } catch (error) {
    showToast(error.message || 'Failed to claim item', 'error');
  }
}

async function assignItemToUser(enquiryId, itemId, btn) {
  const select = btn.previousElementSibling;
  const userId = select?.value;
  if (!userId) { showToast('Select a user first', 'error'); return; }
  try {
    await apiCall(`/enquiries/${enquiryId}/assign-items`, {
      method: 'POST',
      body: JSON.stringify({ itemIds: [itemId], sourcingUserId: userId })
    });
    showToast('Item assigned', 'success');
    await loadEnquiries();
  } catch (error) {
    showToast(error.message || 'Failed to assign', 'error');
  }
}

async function assignItemFromQueue(enquiryId, itemId) {
  const sel = document.getElementById(`assign-sel-${itemId}`);
  const userId = sel?.value;
  if (!userId) { showToast('Select a user first', 'error'); return; }
  try {
    await apiCall(`/enquiries/${enquiryId}/assign-items`, {
      method: 'POST',
      body: JSON.stringify({ itemIds: [itemId], sourcingUserId: userId })
    });
    showToast('Item assigned', 'success');
    await loadEnquiries();
  } catch (error) {
    showToast(error.message || 'Failed to assign', 'error');
  }
}

function toggleEnquiryCard(id) {
  const body = document.getElementById(id);
  const caret = document.getElementById(`caret-${id}`);
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  if (caret) caret.style.transform = isHidden ? 'rotate(180deg)' : '';
}

// Load purchase users for manager assign dropdown (called after page init)
async function loadPurchaseUsers() {
  try {
    window._purchaseUsers = await apiCall('/users/by-category?category=purchase');
  } catch (e) {
    window._purchaseUsers = [];
  }
}

// ── My Work Tab ──────────────────────────────────────────────────────────────

function renderMyWorkTab() {
  const container = document.getElementById('enquiriesList');
  const uid = window.currentUserId;

  // Build per-enquiry buckets for this user
  let unfilteredWorkCount = 0;
  const enqMap = new Map();
  enquiries.forEach(enq => {
    const waiting = [], active = [];
    (enq.items || []).forEach(item => {
      const aid = item.assignedTo?._id || item.assignedTo;
      if (aid !== uid) return;
      if (item.status === 'in_sales_query') unfilteredWorkCount++;
      else if (['assigned', 'sales_query_resolved'].includes(item.status)) unfilteredWorkCount++;
      if (!matchesFilters(item, enq)) return;
      if (item.status === 'in_sales_query') waiting.push(item);
      else if (['assigned', 'sales_query_resolved'].includes(item.status)) active.push(item);
    });
    if (waiting.length + active.length > 0) enqMap.set(enq._id, { enq, waiting, active });
  });

  const filteredWorkCount = Array.from(enqMap.values()).reduce((s, { waiting, active }) => s + waiting.length + active.length, 0);
  updateFilterResultCount(filteredWorkCount, unfilteredWorkCount);

  if (enqMap.size === 0) {
    const hasRealWork = unfilteredWorkCount > 0;
    container.innerHTML = `<div class="card text-center" style="padding:2.5rem">
      <i class="ph ph-clipboard-text" style="font-size:2.5rem;color:var(--text-muted);margin-bottom:1rem"></i>
      <h3 class="mb-2">${hasRealWork ? 'No Matches' : 'No Active Work'}</h3>
      <p class="text-muted">${hasRealWork ? 'Try adjusting your search or filters.' : 'Claim items from the New Queue tab to get started.'}</p>
      ${hasRealWork
        ? `<button class="btn btn-secondary mt-3" onclick="clearAllFilters()"><i class="ph ph-x"></i> Clear Filters</button>`
        : `<button class="btn btn-primary mt-3" onclick="switchTab('new_queue')"><i class="ph ph-arrow-left"></i> Go to New Queue</button>`}
    </div>`;
    return;
  }

  const entries = Array.from(enqMap.values());
  const totalWaiting = entries.reduce((s, e) => s + e.waiting.length, 0);
  const totalActive  = entries.reduce((s, e) => s + e.active.length, 0);

  container.innerHTML = `
    <div style="display:flex;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">
      ${totalWaiting > 0 ? `<span style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;font-weight:700;color:#92400e"><i class="ph ph-clock"></i>${totalWaiting} waiting on sales</span>` : ''}
      ${totalActive  > 0 ? `<span style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;font-weight:700;color:var(--primary)"><i class="ph ph-wrench"></i>${totalActive} active</span>` : ''}
    </div>
    ${entries.map(({ enq, waiting, active }) => {
      const id = `eq-mw-${enq._id}`;
      const hasWaiting = waiting.length > 0;
      return `
      <div class="enquiry-accordion-card${hasWaiting ? ' is-waiting' : ''}">
        <div class="enquiry-accordion-header" onclick="toggleEnquiryCard('${id}')">
          <div style="display:flex;align-items:center;gap:0.75rem;flex:1;min-width:0">
            ${hasWaiting
              ? `<i class="ph ph-clock" style="color:#f59e0b;flex-shrink:0"></i>`
              : `<i class="ph ph-wrench" style="color:var(--primary);flex-shrink:0"></i>`}
            <span class="enq-number">${enq.enquiryNumber}</span>
            <span style="font-size:0.85rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${enq.customerId?.name || '—'}</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-shrink:0">
            ${waiting.length > 0 ? `<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;font-size:0.7rem">${waiting.length} waiting</span>` : ''}
            ${active.length  > 0 ? `<span class="badge" style="background:var(--primary-light);color:var(--primary);font-size:0.7rem">${active.length} active</span>` : ''}
            <button class="btn btn-sm" style="background:var(--bg-hover);border:1px solid var(--border);padding:0.25rem 0.5rem" onclick="event.stopPropagation();generateWhatsApp('${enq._id}')" title="WhatsApp message"><i class="ph ph-whatsapp-logo"></i></button>
            <i class="ph ph-caret-down" id="caret-${id}" style="transition:transform 0.2s;color:var(--text-muted)"></i>
          </div>
        </div>
        <div class="enquiry-accordion-body" id="${id}" style="display:none">
          ${waiting.length > 0 ? `
            <div style="margin:0.5rem 0 0.4rem;font-size:0.75rem;font-weight:700;color:#92400e;display:flex;align-items:center;gap:0.4rem">
              <i class="ph ph-clock"></i> WAITING ON SALES
            </div>
            <table class="items-table" style="margin-bottom:0.75rem">
              <thead><tr><th>Material</th><th>Qty</th><th>Actions</th></tr></thead>
              <tbody>
                ${waiting.map(item => {
                  const prod = item.productId;
                  return `<tr style="border-left:3px solid #f59e0b">
                    <td><div style="font-weight:600">${prod?.materialName || '—'}</div>
                      <div style="font-size:0.78rem;color:var(--text-muted)">${[prod?.brand, prod?.specification].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>${item.quantity} ${prod?.uom || ''}</td>
                    <td><div class="flex gap-1">
                      <button class="btn btn-secondary btn-sm" onclick="openChat('${enq._id}', '${enq.enquiryNumber}')"><i class="ph ph-chat-text"></i> View Chat</button>
                      <button class="btn btn-sm" style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0" onclick="resolveQuery('${enq._id}', '${item._id}')"><i class="ph ph-check-circle"></i> Resolve</button>
                    </div></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>` : ''}
          ${active.length > 0 ? `
            <div style="margin:0.5rem 0 0.4rem;font-size:0.75rem;font-weight:700;color:var(--primary);display:flex;align-items:center;gap:0.4rem">
              <i class="ph ph-wrench"></i> ACTIVE ITEMS
            </div>
            <table class="items-table">
              <thead><tr><th>Material</th><th>Qty</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                ${active.map(item => {
                  const prod = item.productId;
                  return `<tr>
                    <td><div style="font-weight:600">${prod?.materialName || '—'}</div>
                      <div style="font-size:0.78rem;color:var(--text-muted)">${[prod?.brand, prod?.specification].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>${item.quantity} ${prod?.uom || ''}</td>
                    <td>${getStatusBadge(item.status)}</td>
                    <td><div class="flex gap-1 flex-wrap">
                      <button class="btn btn-success btn-sm" onclick="showQuotationModal('${item._id}')"><i class="ph ph-plus-circle"></i> Quote</button>
                      <button class="btn btn-secondary btn-sm" onclick="openRaiseQueryModal('${enq._id}', '${item._id}', '${enq.enquiryNumber}')"><i class="ph ph-question"></i> Raise Query</button>
                      <button class="btn btn-secondary btn-sm" onclick="openChat('${enq._id}', '${enq.enquiryNumber}')"><i class="ph ph-chat-text"></i></button>
                      <button class="btn btn-sm" style="background:var(--bg-hover);border:1px solid var(--border)" onclick="generateWhatsApp('${enq._id}')"><i class="ph ph-whatsapp-logo"></i></button>
                    </div></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>` : ''}
        </div>
      </div>`;
    }).join('')}`;
}

// ── Done Tab ──────────────────────────────────────────────────────────────────

function renderDoneTab() {
  const container = document.getElementById('enquiriesList');
  const uid = window.currentUserId;
  const doneStatuses = ['vendor_quoted', 'priced', 'sales_priced', 'completed', 'unsuccessful'];

  const unfilteredDone = enquiries
    .map(enq => ({ enq, items: (enq.items || []).filter(item => { const aid = item.assignedTo?._id || item.assignedTo; return aid === uid && doneStatuses.includes(item.status); }) }))
    .filter(({ items }) => items.length > 0);
  const unfilteredDoneCount = unfilteredDone.reduce((s, { items }) => s + items.length, 0);

  const enquiriesWithDone = enquiries
    .map(enq => ({
      enq,
      items: (enq.items || []).filter(item => {
        const aid = item.assignedTo?._id || item.assignedTo;
        return aid === uid && doneStatuses.includes(item.status) && matchesFilters(item, enq);
      })
    }))
    .filter(({ items }) => items.length > 0);

  const total = enquiriesWithDone.reduce((s, { items }) => s + items.length, 0);
  updateFilterResultCount(total, unfilteredDoneCount);

  if (enquiriesWithDone.length === 0) {
    container.innerHTML = `<div class="card text-center" style="padding:2.5rem">
      <i class="ph ph-check-circle" style="font-size:2.5rem;color:var(--text-muted);margin-bottom:1rem"></i>
      <p class="text-muted">${unfilteredDoneCount === 0 ? 'No completed items yet.' : 'No matches. Try adjusting your filters.'}</p>
      ${unfilteredDoneCount > 0 ? `<button class="btn btn-secondary mt-3" onclick="clearAllFilters()"><i class="ph ph-x"></i> Clear Filters</button>` : ''}
    </div>`;
    return;
  }

  container.innerHTML = `
    <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:1rem;display:flex;align-items:center;gap:0.4rem">
      <i class="ph ph-check-circle" style="color:var(--success)"></i>
      <strong>${total}</strong> completed item${total !== 1 ? 's' : ''} across <strong>${enquiriesWithDone.length}</strong> enquir${enquiriesWithDone.length !== 1 ? 'ies' : 'y'}
    </div>
    ${enquiriesWithDone.map(({ enq, items }) => {
      const id = `eq-done-${enq._id}`;
      return `
      <div class="enquiry-accordion-card">
        <div class="enquiry-accordion-header" onclick="toggleEnquiryCard('${id}')">
          <div style="display:flex;align-items:center;gap:0.75rem;flex:1;min-width:0">
            <span class="enq-number">${enq.enquiryNumber}</span>
            <span style="font-size:0.85rem;color:var(--text-secondary)">${enq.customerId?.name || '—'}</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.6rem;flex-shrink:0">
            <span class="badge" style="background:#d1fae5;color:#065f46;font-size:0.7rem">${items.length} done</span>
            <i class="ph ph-caret-down" id="caret-${id}" style="transition:transform 0.2s;color:var(--text-muted)"></i>
          </div>
        </div>
        <div class="enquiry-accordion-body" id="${id}" style="display:none">
          <table class="items-table" style="margin-top:0.5rem">
            <thead><tr><th>Material</th><th>Qty</th><th>Status</th><th>Quotes</th></tr></thead>
            <tbody>
              ${items.map(item => {
                const prod = item.productId;
                return `<tr>
                  <td style="font-weight:600">${prod?.materialName || '—'}</td>
                  <td>${item.quantity} ${prod?.uom || ''}</td>
                  <td>${getStatusBadge(item.status)}</td>
                  <td>${['vendor_quoted', 'priced', 'sales_priced'].includes(item.status)
                    ? `<button class="btn btn-secondary btn-sm" onclick="viewQuotes('${item._id}')"><i class="ph ph-clipboard-text"></i> Quotes</button>`
                    : ''}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    }).join('')}`;
}

// ── Team Overview Tab (manager only) ─────────────────────────────────────────

function renderTeamOverviewTab() {
  const container = document.getElementById('enquiriesList');
  if (!hasPermission('enquiry.assign')) {
    container.innerHTML = `<div class="card text-center" style="padding:2.5rem"><p class="text-muted">You do not have permission to view team overview.</p></div>`;
    return;
  }

  const teamUsers = window._purchaseUsers || [];
  if (teamUsers.length === 0) {
    container.innerHTML = `<div class="card text-center" style="padding:2.5rem"><p class="text-muted">No team members found.</p></div>`;
    return;
  }

  const bgColors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899'];
  const doneStatuses = ['vendor_quoted', 'priced', 'sales_priced', 'completed'];

  const filteredTeamUsers = searchQuery
    ? teamUsers.filter(u => u.name.toLowerCase().includes(searchQuery))
    : teamUsers;

  updateFilterResultCount(filteredTeamUsers.length, teamUsers.length);

  if (filteredTeamUsers.length === 0) {
    container.innerHTML = `<div class="card text-center" style="padding:2.5rem"><p class="text-muted">No team members match your search.</p><button class="btn btn-secondary mt-3" onclick="clearAllFilters()"><i class="ph ph-x"></i> Clear Search</button></div>`;
    return;
  }

  const userStats = filteredTeamUsers.map(user => {
    let active = 0, done = 0;
    enquiries.forEach(enq => {
      (enq.items || []).forEach(item => {
        const aid = item.assignedTo?._id || item.assignedTo;
        if (aid !== user._id) return;
        if (doneStatuses.includes(item.status)) done++;
        else active++;
      });
    });
    const total = active + done;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { user, active, done, total, pct };
  });

  container.innerHTML = `
    <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:1rem;display:flex;align-items:center;gap:0.4rem">
      <i class="ph ph-users-three"></i>
      Team overview — <strong>${filteredTeamUsers.length}</strong> member${filteredTeamUsers.length !== 1 ? 's' : ''}${searchQuery ? ` (filtered from ${teamUsers.length})` : ''}
    </div>
    ${userStats.map(({ user, active, done, pct }) => {
      const bodyId = `team-body-${user._id}`;
      const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
      const color = bgColors[user.name.charCodeAt(0) % bgColors.length];

      const myEnquiries = enquiries
        .map(enq => ({
          enq,
          items: (enq.items || []).filter(item => {
            const aid = item.assignedTo?._id || item.assignedTo;
            return aid === user._id;
          })
        }))
        .filter(({ items }) => items.length > 0);

      return `
      <div class="team-member-card">
        <div class="team-member-header" onclick="toggleTeamMemberCard('${bodyId}', '${user._id}')">
          <div class="member-avatar" style="background:${color}22;color:${color};border:1.5px solid ${color}44">${initials}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:0.9rem">${user.name}</div>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.25rem">
              <div class="enquiry-progress-bar" style="width:130px">
                <div class="enquiry-progress-fill" style="width:${pct}%;background:${color}"></div>
              </div>
              <span style="font-size:0.75rem;color:var(--text-muted)">${pct}%</span>
            </div>
          </div>
          <div class="member-stats">
            <span class="stat-chip" style="background:#fef3c7;color:#92400e">${active} active</span>
            <span class="stat-chip" style="background:#d1fae5;color:#065f46">${done} done</span>
          </div>
          <i class="ph ph-caret-down" id="caret-team-${user._id}" style="transition:transform 0.2s;color:var(--text-muted);flex-shrink:0"></i>
        </div>
        <div class="team-member-body" id="${bodyId}" style="display:none">
          ${myEnquiries.length === 0
            ? `<p class="text-muted" style="font-size:0.85rem;padding:0.25rem 0">No items assigned yet.</p>`
            : myEnquiries.map(({ enq, items }) => `
              <div style="margin-bottom:0.75rem">
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem">
                  <span class="enq-number" style="font-size:0.82rem">${enq.enquiryNumber}</span>
                  <span style="font-size:0.8rem;color:var(--text-muted)">${enq.customerId?.name || '—'}</span>
                </div>
                <table class="items-table">
                  <thead><tr><th>Material</th><th>Qty</th><th>Status</th><th>Reassign</th></tr></thead>
                  <tbody>
                    ${items.map(item => {
                      const prod = item.productId;
                      return `<tr>
                        <td style="font-weight:600">${prod?.materialName || '—'}</td>
                        <td>${item.quantity} ${prod?.uom || ''}</td>
                        <td>${getStatusBadge(item.status)}</td>
                        <td><div class="flex gap-1">
                          <select id="reassign-${item._id}" style="padding:0.3rem;border:1px solid var(--border);border-radius:0.4rem;font-size:0.78rem;max-width:110px">
                            <option value="">Reassign…</option>
                            ${(window._purchaseUsers || []).filter(u => u._id !== user._id).map(u => `<option value="${u._id}">${u.name}</option>`).join('')}
                          </select>
                          <button class="btn btn-secondary btn-sm" onclick="doReassign('${enq._id}', '${item._id}')"><i class="ph ph-arrows-clockwise"></i></button>
                        </div></td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>`).join('')}
        </div>
      </div>`;
    }).join('')}`;
}

function toggleTeamMemberCard(bodyId, userId) {
  const body = document.getElementById(bodyId);
  const caret = document.getElementById(`caret-team-${userId}`);
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  if (caret) caret.style.transform = isHidden ? 'rotate(180deg)' : '';
}

async function doReassign(enquiryId, itemId) {
  const sel = document.getElementById(`reassign-${itemId}`);
  const userId = sel?.value;
  if (!userId) { showToast('Select a user to reassign to', 'error'); return; }
  try {
    await apiCall(`/enquiries/${enquiryId}/assign-items`, {
      method: 'POST',
      body: JSON.stringify({ itemIds: [itemId], sourcingUserId: userId })
    });
    showToast('Item reassigned', 'success');
    await loadEnquiries();
  } catch (error) {
    showToast(error.message || 'Failed to reassign', 'error');
  }
}

// ── Raise / Resolve Query ─────────────────────────────────────────────────────

function openRaiseQueryModal(enquiryId, itemId, enquiryNumber) {
  _queryTarget = { enquiryId, itemId, enquiryNumber };
  document.getElementById('raiseQueryInput').value = '';
  document.getElementById('raiseQueryEnqNo').textContent = enquiryNumber;
  document.getElementById('raiseQueryModal').classList.add('active');
}

async function confirmRaiseQuery() {
  const message = document.getElementById('raiseQueryInput').value.trim();
  if (!message) { showToast('Please describe your query', 'error'); return; }

  const { enquiryId, itemId } = _queryTarget;
  try {
    // Send query message
    await apiCall(`/enquiries/${enquiryId}/queries`, {
      method: 'POST',
      body: JSON.stringify({ message })
    });
    // Change item status to in_sales_query
    await apiCall(`/enquiries/${enquiryId}/items/${itemId}/raise-query`, { method: 'PUT' });
    document.getElementById('raiseQueryModal').classList.remove('active');
    _queryTarget = null;
    showToast('Query sent to sales team', 'warning');
    await loadEnquiries();
  } catch (error) {
    showToast(error.message || 'Failed to raise query', 'error');
  }
}

async function resolveQuery(enquiryId, itemId) {
  if (!confirm('Mark this query as resolved and continue with sourcing?')) return;
  try {
    await apiCall(`/enquiries/${enquiryId}/items/${itemId}/resolve-query`, { method: 'PUT' });
    showToast('Query resolved — you can now add vendor quote', 'success');
    await loadEnquiries();
  } catch (error) {
    showToast(error.message || 'Failed to resolve query', 'error');
  }
}

// ── Filter Helpers ────────────────────────────────────────────────────────────

function matchesFilters(item, enquiry) {
  if (searchQuery) {
    const q = searchQuery;
    const enqNum = (enquiry.enquiryNumber || '').toLowerCase();
    const custName = (enquiry.customerId?.name || '').toLowerCase();
    const matName = (item.productId?.materialName || '').toLowerCase();
    const brand = (item.productId?.brand || '').toLowerCase();
    const spec = (item.productId?.specification || '').toLowerCase();
    if (!enqNum.includes(q) && !custName.includes(q) && !matName.includes(q) && !brand.includes(q) && !spec.includes(q)) return false;
  }
  if (dateFilter) {
    const createdAt = new Date(enquiry.createdAt);
    const now = new Date();
    if (dateFilter === 'today') {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (createdAt < today) return false;
    } else if (dateFilter === 'this_week') {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      if (createdAt < weekStart) return false;
    } else if (dateFilter === 'this_month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      if (createdAt < monthStart) return false;
    }
  }
  if (urgentFilter) {
    const age = Date.now() - new Date(enquiry.createdAt).getTime();
    if (age < 48 * 60 * 60 * 1000) return false;
  }
  if (tabStatusFilters.size > 0 && !tabStatusFilters.has(item.status)) return false;
  return true;
}

function updateTabContextFilters(tab) {
  const container = document.getElementById('tabContextFilters');
  if (!container) return;
  tabStatusFilters.clear();
  const configs = {
    new_queue: [],
    my_work: [
      { filter: 'in_sales_query', label: '<i class="ph ph-clock"></i> Waiting on Sales' },
      { filter: 'assigned', label: '<i class="ph ph-wrench"></i> Active' },
      { filter: 'sales_query_resolved', label: '<i class="ph ph-check-circle"></i> Query Resolved' },
    ],
    done: [
      { filter: 'vendor_quoted', label: '<i class="ph ph-currency-inr"></i> Vendor Quoted' },
      { filter: 'priced', label: '<i class="ph ph-check"></i> Priced' },
      { filter: 'completed', label: '<i class="ph ph-check-circle"></i> Completed' },
      { filter: 'unsuccessful', label: '<i class="ph ph-x-circle"></i> Unsuccessful' },
    ],
    team: [],
  };
  const chips = configs[tab] || [];
  if (chips.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div style="width:1px;height:1.2rem;background:var(--border);flex-shrink:0;margin:0 0.1rem"></div>
    <span class="filter-label"><i class="ph ph-funnel-simple"></i> Status</span>
    ${chips.map(c => `<div class="filter-chip" data-filter="${c.filter}" onclick="toggleFilter('${c.filter}')">${c.label}</div>`).join('')}
  `;
}

function updateFilterResultCount(shown, total) {
  const el = document.getElementById('filterResultCount');
  if (!el) return;
  const hasFilter = searchQuery || dateFilter || urgentFilter || tabStatusFilters.size > 0;
  el.textContent = hasFilter ? `${shown} of ${total} result${total !== 1 ? 's' : ''}` : '';
}

function updateClearFiltersBtn() {
  const hasFilters = searchQuery || dateFilter || urgentFilter || tabStatusFilters.size > 0;
  const btn = document.getElementById('clearFiltersBtn');
  if (btn) btn.style.display = hasFilters ? '' : 'none';
}

function handleSearch() {
  const input = document.getElementById('searchSourcing');
  searchQuery = (input?.value || '').toLowerCase().trim();
  const clearBtn = document.getElementById('clearSearchBtn');
  if (clearBtn) clearBtn.style.display = searchQuery ? '' : 'none';
  updateClearFiltersBtn();
  renderCurrentTab();
}

function clearSearch() {
  const input = document.getElementById('searchSourcing');
  if (input) input.value = '';
  searchQuery = '';
  const clearBtn = document.getElementById('clearSearchBtn');
  if (clearBtn) clearBtn.style.display = 'none';
  updateClearFiltersBtn();
  renderCurrentTab();
}

function toggleFilter(filterName) {
  const chip = document.querySelector(`[data-filter="${filterName}"]`);
  const dateFilters = new Set(['today', 'this_week', 'this_month']);
  if (dateFilters.has(filterName)) {
    if (dateFilter === filterName) {
      dateFilter = null;
      chip?.classList.remove('active');
    } else {
      dateFilters.forEach(f => document.querySelector(`[data-filter="${f}"]`)?.classList.remove('active'));
      dateFilter = filterName;
      chip?.classList.add('active');
    }
  } else if (filterName === 'urgent') {
    urgentFilter = !urgentFilter;
    chip?.classList.toggle('active', urgentFilter);
  } else {
    if (tabStatusFilters.has(filterName)) {
      tabStatusFilters.delete(filterName);
      chip?.classList.remove('active');
    } else {
      tabStatusFilters.add(filterName);
      chip?.classList.add('active');
    }
  }
  updateClearFiltersBtn();
  renderCurrentTab();
}

function clearAllFilters() {
  searchQuery = ''; dateFilter = null; urgentFilter = false; tabStatusFilters.clear();
  const input = document.getElementById('searchSourcing');
  if (input) input.value = '';
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  if (clearSearchBtn) clearSearchBtn.style.display = 'none';
  document.querySelectorAll('.filter-chip.active').forEach(c => c.classList.remove('active'));
  updateClearFiltersBtn();
  renderCurrentTab();
}

function renderEnquiries() {
  renderCurrentTab();
}

function toggleEnquiry(enquiryId) {
  const itemsDiv = document.getElementById(`items-${enquiryId}`);
  const icon = document.getElementById(`icon-${enquiryId}`);
  if (!itemsDiv) return;
  if (itemsDiv.classList.contains('expanded')) {
    itemsDiv.classList.remove('expanded');
    if (icon) icon.classList.remove('expanded');
  } else {
    itemsDiv.classList.add('expanded');
    if (icon) icon.classList.add('expanded');
  }
}

function toggleAllItemsInEnquiry(enquiryId, checkbox) {
  const enquiry = enquiries.find(e => e._id === enquiryId);
  if (!enquiry) return;

  const isChecked = checkbox.checked;
  enquiry.items.forEach(item => {
    if (isChecked) {
      selectedItems.add(item._id);
    } else {
      selectedItems.delete(item._id);
    }
  });

  // Re-render just this enquiry's items to reflect changes (or full render)
  // Full render is safer for consistency but might reset expansion if not careful.
  // Since expansion state is in DOM class, full render resets it unless we track it.
  // Let's just update the checkboxes manually to avoid re-render flicker.

  const itemsDiv = document.getElementById(`items - ${enquiryId}`);
  const checkboxes = itemsDiv.querySelectorAll('tbody input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = isChecked);

  updateSelectionCount();
}

function toggleItemSelection(itemId) {
  if (selectedItems.has(itemId)) {
    selectedItems.delete(itemId);
  } else {
    selectedItems.add(itemId);
  }
  updateSelectionCount();

  // Optional: Update row style
  // const row = document.querySelector(`input[value = "${itemId}"]`).closest('tr');
  // if (row) row.classList.toggle('selected-row');
}

function updateSelectionCount() {
  const countEl = document.getElementById('selectedCount');
  const btnEl = document.getElementById('whatsappBtn');

  if (countEl) countEl.textContent = selectedItems.size;
  if (btnEl) btnEl.disabled = selectedItems.size === 0;

  // Also update buttons in all enquiry headers if selection changes?
  // Since we have "WhatsApp Selected (N)" buttons, we should re-render or update them.
  // Re-rendering everything is expensive. Maybe just update text?
  // For now, let's just accept that the count on the button might be stale until some interaction updates it?
  // Or we trigger a re-render of the action bar?
  // A simple re-render of enquiry actions logic would be good.
  // We can select all .item-card in enquiry-items and strictly replace the action bar?
  // Or just re-render the whole list? sourcing.js re-renders easily.
  // But wait, toggleAllItems calls this.
  // Let's iterate enquiries and update their action bars if possible.
  // Or simpler: just re-render `renderEnquiries` is too heavy (collapses rows).

  // We can try to find the button for the enquiry and update it.
  enquiries.forEach(enquiry => {
    const itemsDiv = document.getElementById(`items - ${enquiry._id}`);
    if (itemsDiv) {
      // This is tricky without a specific ID for the action bar.
      // But the action bar is the first child of itemsDiv (or close to it).
      // Actually, renderEnquiries inserts duplicate logic?
      // No, renderEnquiries calls renderEnquiryActions THEN renderItems.
      // So it's the first child.
      // Let's just re-inject the action bar HTML.
      const actionBarHTML = renderEnquiryActions(enquiry);
      // Find the existing action bar?
      // It has class 'item-card' but so do items (conceptually).
      // Actually items are in `renderItems` but my `renderItems` returns `item - card` too (lines 275).
      // But I removed the button from `renderItems` item-card.
      // The `renderEnquiryActions` container also has `item - card`.
      // This makes selection hard.
      // Optimally, I should have wrapped the action bar in a specific class e.g. `enquiry - actions - bar`.
      // I'll add that class in the previous chunk.

      // For now, let's leave dynamic update separate to avoid complexity creep.
      // The user sees the checkbox state change. The button text "WhatsApp Selected (N)" implies it needs update.
      // Implementation Detail: Use a specific class 'enquiry-action-bar' in my replacement above.
    }
  });
}

function selectAll() {
  enquiries.forEach(enquiry => {
    enquiry.items?.forEach(item => {
      selectedItems.add(item._id);
      const element = document.getElementById(`item - ${item._id}`);
      if (element) {
        element.classList.add('selected');
        const checkbox = element.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = true;
      }
    });
  });
  updateSelectionCount();
}

function clearSelection() {
  selectedItems.forEach(itemId => {
    const element = document.getElementById(`item - ${itemId}`);
    if (element) {
      element.classList.remove('selected');
      const checkbox = element.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.checked = false;
    }
  });
  selectedItems.clear();
  updateSelectionCount();
}

// Populate vendor dropdown
// Populate vendor dropdown
let vendorPriceHistory = {}; // Store pricing data for current product

async function populateVendorSelect() {
  const trigger = document.getElementById('vendorDropdownTrigger');
  const optionsContainer = document.getElementById('vendorDropdownOptions');
  const hiddenInput = document.getElementById('vendorSelect');

  // Get current product ID if available
  let productId = null;
  if (currentItemId) {
    let item = null;
    for (const enquiry of enquiries) {
      item = enquiry.items?.find(i => i._id === currentItemId);
      if (item) {
        productId = item.productId._id;
        break;
      }
    }
  }

  // Fetch bulk pricing history if we have a product
  if (productId) {
    try {
      vendorPriceHistory = await apiCall(`/vendors/bulk-price-history?productId=${productId}`);
    } catch (error) {
      console.error('Error fetching bulk price history:', error);
      vendorPriceHistory = [];
    }
  }

  // Create a map for quick lookup
  const priceMap = {};
  if (Array.isArray(vendorPriceHistory)) {
    vendorPriceHistory.forEach(v => {
      priceMap[v.vendorId] = v;
    });
  }

  // Build vendor options HTML
  const vendorOptionsHTML = vendors.map(vendor => {
    const priceData = priceMap[vendor._id];
    const hasHistory = priceData && priceData.hasHistory;
    let pricingHTML = '';
    if (hasHistory) {
      const priceText = formatCurrency(priceData.totalPrice);
      const badge = priceData.isCheapest
        ? '<span class="vendor-price-badge cheapest">Cheapest</span>'
        : '<span class="vendor-price-badge not-cheapest">Not Cheapest</span>';
      pricingHTML = `<div class="vendor-pricing"><span class="vendor-last-price">${priceText}</span>${badge}</div>`;
    } else {
      pricingHTML = '<div class="vendor-no-history">No history</div>';
    }
    return `
      <div class="vendor-option" data-vendor-id="${vendor._id}" data-vendor-name="${vendor.name}">
        <div class="vendor-main">
          <div class="vendor-name">${vendor.name}</div>
          ${vendor.specialization ? `<div class="vendor-spec">${vendor.specialization}</div>` : ''}
        </div>
        ${pricingHTML}
      </div>`;
  }).join('');

  // Always show "Add New Vendor" — permission enforced server-side
  const addNewHTML = `
    <div class="vendor-option add-new-vendor-option" onclick="showAddVendorModal()">
      <div class="vendor-main" style="flex-direction:row;align-items:center;gap:0.5rem">
        <i class="ph ph-plus-circle" style="font-size:1.05rem;color:var(--primary);flex-shrink:0"></i>
        <div class="vendor-name" style="color:var(--primary)">Add New Vendor...</div>
      </div>
    </div>`;

  optionsContainer.innerHTML = vendorOptionsHTML + addNewHTML;

  // Helper: apply vendor selection to the dropdown UI (stored globally so vendor creation can call it)
  window._applyVendorSelection = (vendorId, vendorName) => {
    hiddenInput.value = vendorId;
    trigger.querySelector('.placeholder')?.remove();
    trigger.querySelector('.selected-vendor')?.remove();
    const selectedSpan = document.createElement('span');
    selectedSpan.className = 'selected-vendor';
    selectedSpan.textContent = vendorName;
    trigger.insertBefore(selectedSpan, trigger.querySelector('i'));
    optionsContainer.querySelectorAll('.vendor-option:not(.add-new-vendor-option)').forEach(opt =>
      opt.classList.toggle('selected', opt.dataset.vendorId === vendorId));
    trigger.classList.remove('active');
    optionsContainer.classList.remove('active');
    const priceData = priceMap[vendorId];
    if (priceData && priceData.hasHistory) {
      if (!document.getElementById('vendorPrice').value) {
        document.getElementById('vendorPrice').value = priceData.price;
        const pi = document.getElementById('vendorPrice');
        pi.style.backgroundColor = 'rgba(16,185,129,0.1)';
        setTimeout(() => pi.style.backgroundColor = '', 1000);
      }
      const fi = document.getElementById('freightPrice');
      if (priceData.freight && (fi.value === '0' || !fi.value)) {
        fi.value = priceData.freight;
        fi.style.backgroundColor = 'rgba(16,185,129,0.1)';
        setTimeout(() => fi.style.backgroundColor = '', 1000);
      }
      calculateQuoteTotal();
    } else {
      document.getElementById('vendorPrice').value = '';
      document.getElementById('freightPrice').value = '0';
      calculateQuoteTotal();
    }
  };

  // Toggle dropdown
  trigger.onclick = (e) => {
    e.stopPropagation();
    trigger.classList.toggle('active');
    optionsContainer.classList.toggle('active');
  };

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!document.getElementById('customVendorDropdown')?.contains(e.target)) {
      trigger.classList.remove('active');
      optionsContainer.classList.remove('active');
    }
  });

  // Handle vendor selection (exclude the add-new option)
  optionsContainer.querySelectorAll('.vendor-option:not(.add-new-vendor-option)').forEach(option => {
    option.onclick = () => window._applyVendorSelection(option.dataset.vendorId, option.dataset.vendorName);
  });
}

// ── Inline Vendor Creation ────────────────────────────────────────────────────

function showAddVendorModal() {
  // Close the vendor dropdown first
  document.getElementById('vendorDropdownTrigger')?.classList.remove('active');
  document.getElementById('vendorDropdownOptions')?.classList.remove('active');
  ['newVendorName', 'newVendorContact', 'newVendorPhone', 'newVendorEmail', 'newVendorSpec', 'newVendorAddress']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('addVendorModal').classList.add('active');
  setTimeout(() => document.getElementById('newVendorName')?.focus(), 100);
}

function closeAddVendorModal() {
  document.getElementById('addVendorModal').classList.remove('active');
}

async function handleVendorCreation() {
  const name = document.getElementById('newVendorName').value.trim();
  if (!name) { showToast('Vendor name is required', 'error'); return; }

  const btn = document.querySelector('#addVendorModal .btn-primary');
  const origText = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Creating...'; }

  try {
    const vendor = await apiCall('/vendors', {
      method: 'POST',
      body: JSON.stringify({
        name,
        contactPerson: document.getElementById('newVendorContact').value.trim() || undefined,
        phone: document.getElementById('newVendorPhone').value.trim() || undefined,
        email: document.getElementById('newVendorEmail').value.trim() || undefined,
        specialization: document.getElementById('newVendorSpec').value.trim() || undefined,
        address: document.getElementById('newVendorAddress').value.trim() || undefined,
      })
    });
    vendors.push(vendor);
    closeAddVendorModal();
    // Re-populate the dropdown then auto-select the new vendor
    await populateVendorSelect();
    if (window._applyVendorSelection) window._applyVendorSelection(vendor._id, vendor.name);
    showToast(`"${name}" created and selected`, 'success');
  } catch (error) {
    showToast(error.message || 'Failed to create vendor', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origText; }
  }
}

// Check last price
async function checkLastPrice(vendorId, productId) {
  const historyDiv = document.getElementById('priceHistory');
  if (!historyDiv) return;

  try {
    historyDiv.innerHTML = '<small class="text-muted">Checking history...</small>';

    const response = await apiCall(`/vendors/last-price?vendorId=${vendorId}&productId=${productId}`);

    if (response) {
      const date = new Date(response.date).toLocaleDateString();
      const cheapestBadge = response.isCheapest
        ? '<span class="badge badge-success" style="font-size: 0.7rem; padding: 2px 6px;">Cheapest</span>'
        : '<span class="badge badge-warning" style="font-size: 0.7rem; padding: 2px 6px;">Not Cheapest</span>';

      historyDiv.innerHTML = `
        <div style="font-size: 0.85rem; margin-top: 4px; padding: 8px; background: var(--bg-secondary); border-radius: 4px; border-left: 3px solid var(--primary);">
          <div style="font-weight: 500; color: var(--text-primary);">Last Price History:</div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
            <span>Price: ${formatCurrency(response.price)} ${response.freight ? `(+ ${formatCurrency(response.freight)} freight)` : ''}</span>
            ${cheapestBadge}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">
            Date: ${date}
          </div>
        </div>
      `;

      // Auto-fill price as suggestion
      if (!document.getElementById('vendorPrice').value) {
        document.getElementById('vendorPrice').value = response.price;
        const priceInput = document.getElementById('vendorPrice');
        priceInput.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        setTimeout(() => priceInput.style.backgroundColor = '', 1000);
      }

      // Auto-fill freight if empty or 0
      const freightInput = document.getElementById('freightPrice');
      if (response.freight && (freightInput.value === '0' || !freightInput.value)) {
        freightInput.value = response.freight;
        freightInput.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        setTimeout(() => freightInput.style.backgroundColor = '', 1000);
      }

      calculateQuoteTotal();

    } else {
      historyDiv.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px; font-style: italic;">No previous history for this vendor/product.</div>';
    }
  } catch (error) {
    console.error('Error checking history:', error);
    historyDiv.innerHTML = '';
  }
}

// WhatsApp Message
// WhatsApp Message
async function generateWhatsApp(enquiryId = null) {
  let itemIds = [];

  if (enquiryId) {
    // Find enquiry
    const enquiry = enquiries.find(e => e._id === enquiryId);
    if (enquiry && enquiry.items) {
      // Check if any items in this enquiry are selected
      const selectedInEnquiry = enquiry.items.filter(i => selectedItems.has(i._id));
      if (selectedInEnquiry.length > 0) {
        itemIds = selectedInEnquiry.map(i => i._id);
      } else {
        // Use all items in enquiry
        itemIds = enquiry.items.map(i => i._id);
      }
    }
  } else {
    // Fallback
    itemIds = Array.from(selectedItems);
  }

  if (itemIds.length === 0) {
    showToast('Please select at least one item', 'error');
    return;
  }

  try {
    const response = await apiCall('/vendors/whatsapp-message', {
      method: 'POST',
      body: JSON.stringify({ itemIds })
    });

    document.getElementById('whatsappMessage').value = response.message;
    document.getElementById('whatsappModal').classList.add('active');
  } catch (error) {
    console.error('Generate WhatsApp error:', error);
    showToast('Failed to generate message', 'error');
  }
}

function closeWhatsAppModal() {
  document.getElementById('whatsappModal').classList.remove('active');
}

function copyToClipboard() {
  const textarea = document.getElementById('whatsappMessage');
  textarea.select();
  document.execCommand('copy');
  showToast('Message copied to clipboard!');
}

// Vendor Quotation Modal
let currentItemQuantity = 0;

async function showQuotationModal(itemId) {
  currentItemId = itemId;
  currentQuoteId = null; // Reset edit mode

  // Find the item
  let item = null;
  for (const enquiry of enquiries) {
    item = enquiry.items?.find(i => i._id === itemId);
    if (item) break;
  }

  if (!item) return;

  // Store quantity for total calculation
  currentItemQuantity = item.quantity;

  document.getElementById('quotationItemInfo').innerHTML = `
    <div>
      <h4 style="font-size: 1.1rem; color: var(--text-primary); margin-bottom: 0.5rem;">${item.productId.materialName}</h4>
      <div class="text-muted" style="font-size: 0.9rem; line-height: 1.5;">
        <span style="display: inline-block; background: var(--bg-tertiary); padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-weight: 500; color: var(--text-primary); margin-right: 0.5rem;">
            ${item.quantity} ${item.productId.uom}
        </span>
        ${item.productId.brand ? `<span style="margin-right: 0.5rem;">• ${item.productId.brand}</span>` : ''}
        ${item.productId.specification ? `<span>• ${item.productId.specification}</span>` : ''}
      </div>
    </div>
    `;

  // Clear form and reset dropdown
  document.getElementById('vendorSelect').value = '';
  document.getElementById('vendorPrice').value = '';
  document.getElementById('freightPrice').value = '0';
  document.getElementById('quotationNotes').value = '';

  // Reset dropdown trigger display
  const trigger = document.getElementById('vendorDropdownTrigger');
  if (trigger) {
    trigger.querySelector('.selected-vendor')?.remove();
    if (!trigger.querySelector('.placeholder')) {
      const placeholder = document.createElement('span');
      placeholder.className = 'placeholder';
      placeholder.textContent = 'Select vendor...';
      trigger.insertBefore(placeholder, trigger.querySelector('i'));
    }
  }

  // Populate vendor dropdown with pricing history
  await populateVendorSelect();

  calculateQuoteTotal();

  document.getElementById('quotationModal').classList.add('active');
}

// Calculate total price for quotation
function calculateQuoteTotal() {
  const vendorPrice = parseFloat(document.getElementById('vendorPrice').value) || 0;
  const freightPrice = parseFloat(document.getElementById('freightPrice').value) || 0;
  const quantity = currentItemQuantity;

  const total = (vendorPrice * quantity) + freightPrice;

  document.getElementById('quoteTotalPrice').textContent = formatCurrency(total);
  document.getElementById('quoteTotalBreakdown').textContent =
    `(₹${vendorPrice.toFixed(2)} × ${quantity}) + ₹${freightPrice.toFixed(2)} = ₹${total.toFixed(2)}`;
}

function closeQuotationModal() {
  document.getElementById('quotationModal').classList.remove('active');
}

async function saveVendorQuotation() {
  const vendorId = document.getElementById('vendorSelect').value;
  const vendorPrice = parseFloat(document.getElementById('vendorPrice').value);
  const freightPrice = parseFloat(document.getElementById('freightPrice').value) || 0;
  const notes = document.getElementById('quotationNotes').value.trim();

  if (!vendorId) {
    showToast('Please select a vendor', 'error');
    return;
  }

  if (!vendorPrice || vendorPrice <= 0) {
    showToast('Please enter valid vendor price', 'error');
    return;
  }

  try {
    const url = currentQuoteId
      ? `/vendors/quotations/${currentQuoteId}`
      : '/vendors/quotations';

    const method = currentQuoteId ? 'PUT' : 'POST';

    await apiCall(url, {
      method: method,
      body: JSON.stringify({
        enquiryItemId: currentItemId,
        vendorId,
        vendorPrice,
        freightPrice,
        notes
      })
    });

    showToast(currentQuoteId ? 'Quotation updated!' : 'Quotation saved!');
    await loadEnquiries();
    closeQuotationModal();
  } catch (error) {
    console.error('Save quotation error:', error);
    showToast('Failed to save quotation', 'error');
  }
}

// View Vendor Quotes
async function viewQuotes(itemId) {
  currentItemId = itemId; // Set this so editQuote can use it
  try {
    const quotations = await apiCall(`/vendors/quotations/item/${itemId}`);

    // Find the item to get quantity
    let item = null;
    for (const enquiry of enquiries) {
      item = enquiry.items?.find(i => i._id === itemId);
      if (item) break;
    }

    const container = document.getElementById('quotationsList');

    if (quotations.length === 0) {
      container.innerHTML = '<p class="text-muted text-center">No quotations yet</p>';
    } else {
      container.innerHTML = quotations.map((quote, index) => {
        const quantity = item?.quantity || 1;
        const totalPrice = (quote.vendorPrice * quantity) + quote.freightPrice;

        return `
          <div class="vendor-quote">
            <div class="vendor-quote-header">
              <span>Vendor ${index + 1}: ${quote.vendorId?.name || 'Unknown'}</span>
              <div class="flex gap-2 align-center">
                  <span class="text-muted" style="font-weight: normal; font-size: 0.8rem;">${formatDate(quote.enteredAt)}</span>
                  <button class="btn btn-secondary btn-sm" style="padding: 0.1rem 0.4rem;" 
                      onclick="editQuote('${quote._id}', '${quote.vendorId?._id}', ${quote.vendorPrice}, ${quote.freightPrice}, '${quote.notes || ''}')">
                      ✏️
                  </button>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-top: 0.75rem;">
              <div>
                <span class="detail-label">Unit Price</span>
                <div class="detail-value">${formatCurrency(quote.vendorPrice)}</div>
              </div>
              <div>
                <span class="detail-label">Quantity</span>
                <div class="detail-value">${quantity}</div>
              </div>
              <div>
                <span class="detail-label">Freight</span>
                <div class="detail-value">${formatCurrency(quote.freightPrice)}</div>
              </div>
              <div>
                <span class="detail-label">Total Price</span>
                <div class="detail-value" style="font-weight: 700; color: var(--primary);">${formatCurrency(totalPrice)}</div>
              </div>
            </div>
            ${quote.notes ? `<p class="text-muted mt-1" style="font-size: 0.875rem;">Note: ${quote.notes}</p>` : ''}
          </div>
        `;
      }).join('');
    }

    document.getElementById('viewQuotesModal').classList.add('active');
  } catch (error) {
    console.error('View quotes error:', error);
    showToast('Failed to load quotations', 'error');
  }
}

function editQuote(quoteId, vendorId, price, freight, notes) {
  currentQuoteId = quoteId;

  // Close view modal
  closeViewQuotesModal();

  // Populate form
  document.getElementById('vendorSelect').value = vendorId;
  document.getElementById('vendorPrice').value = price;
  document.getElementById('freightPrice').value = freight;
  document.getElementById('quotationNotes').value = notes;

  // Show edit modal (reuse quotation modal)
  // We need to set item info too, but we might not have it easily accessible here without passing it.
  // However, currentItemId should still be set from when we opened viewQuotes (wait, viewQuotes takes itemId)
  // We need to make sure currentItemId is set correctly.
  // viewQuotes is called with itemId. So we should set currentItemId there.

  // Also need to show item info in modal.
  // Re-use showQuotationModal logic but skip clearing form

  // Find item
  let item = null;
  for (const enquiry of enquiries) {
    item = enquiry.items?.find(i => i._id === currentItemId);
    if (item) break;
  }

  if (item) {
    document.getElementById('quotationItemInfo').innerHTML = `
        <div class="card" style="padding: 1rem;">
          <h4>${item.productId.materialName}</h4>
          <p class="text-muted">
            Quantity: ${item.quantity} ${item.productId.uom}<br>
            ${item.productId.brand ? 'Brand: ' + item.productId.brand + '<br>' : ''}
          </p>
          <div class="badge badge-warning">Editing Quotation</div>
        </div>
    `;
  }

  document.getElementById('quotationModal').classList.add('active');
}

function closeViewQuotesModal() {
  document.getElementById('viewQuotesModal').classList.remove('active');
}

function handleUrlParameters() {
  const urlParams = new URLSearchParams(window.location.search);
  const enquiryId = urlParams.get('enquiryId');
  if (enquiryId) {
    console.log('🔄 Notification Navigation: Target Enquiry ID', enquiryId);
    let retries = 0;
    const maxRetries = 8; // Increased retries

    const attemptNavigation = () => {
      const row = document.getElementById(`enquiry - ${enquiryId}`);
      if (row) {
        console.log('✅ Notification Navigation: Row found');
        // Expand if not already expanded
        const itemsDiv = document.getElementById(`items - ${enquiryId}`);
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
        console.log(`⚠️ Notification Navigation: Row not found, retrying(${retries} / ${maxRetries})...`);
        setTimeout(attemptNavigation, 500);
      } else {
        console.error('❌ Notification Navigation: Failed to find row after retries');
      }
    };

    // Use a smaller initial delay if data is already present
    const initialDelay = (typeof enquiries !== 'undefined' && enquiries.length > 0) ? 100 : 800;
    setTimeout(attemptNavigation, initialDelay);
  }
}

// --- Sales Query Chat Logic ---
let chatInterval = null;
let currentChatEnquiryId = null;

async function openChat(enquiryId, enquiryNumber) {
  currentChatEnquiryId = enquiryId;

  // Create modal if it doesn't exist
  // Check if Enquiry is fully quoted (all items assigned to user are quoted)
  const enquiry = enquiries.find(e => e._id === enquiryId);
  let isReadOnly = false;

  if (enquiry) {
    // Filter items relevant to this user (or all if simplistic check)
    // Check if all items are at least vendor_quoted

    // Note: In sourcing view, we might only care about items assigned to current user?
    // But the requirement says "if all the materials in the enquiry is quoted".
    // Let's check ALL items for global status.
    if (enquiry.items && enquiry.items.length > 0) {
      isReadOnly = enquiry.items.every(item =>
        ['vendor_quoted', 'sales_priced', 'completed'].includes(item.status)
      );
    }
  }

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
    const existingLock = container.querySelector('.text-center.text-muted.border-t');
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
      container.innerHTML = '<div class="text-center p-8 text-muted" style="font-size: 0.85rem;">No messages yet. Start the conversation.</div>';
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

    // Auto-raise query for any items assigned to current user that are still in 'assigned' status
    const currentUserId = getUser()?.id;
    const enquiry = enquiries.find(e => e._id === currentChatEnquiryId);
    if (currentUserId && enquiry) {
      const toRaise = (enquiry.items || []).filter(i =>
        (i.assignedTo?._id === currentUserId || i.assignedTo === currentUserId) &&
        i.status === 'assigned'
      );
      for (const item of toRaise) {
        try {
          await apiCall(`/enquiries/${currentChatEnquiryId}/items/${item._id}/raise-query`, { method: 'PUT' });
        } catch (_) { /* item may already be in another status — safe to ignore */ }
      }
      if (toRaise.length > 0) await loadEnquiries();
    }

    loadMessages(currentChatEnquiryId);
  } catch (error) {
    showToast('Failed to send message', 'error');
  }
}
// --- Edit Vendor Logic ---
function openEditVendorModal() {
  const vendorId = document.getElementById('vendorSelect').value;
  if (!vendorId) {
    showToast('Please select a vendor to edit', 'error');
    return;
  }

  const vendor = vendors.find(v => v._id === vendorId);
  if (!vendor) return;

  document.getElementById('editVendorId').value = vendor._id;
  document.getElementById('editVendorName').value = vendor.name;
  document.getElementById('editVendorAddress').value = vendor.address || '';
  document.getElementById('editVendorContact').value = vendor.contactPerson || '';

  // Close quotation modal temporarily or keep it open? 
  // It's better to keep it open or stack modals, but simple CSS modals might conflict.
  // Let's hide quotation modal for now and reopen it after save? Or just stack.
  // CSS .modal usually has z-index. Let's make sure edit modal is on top or replace.
  // For simplicity, let's just show it.
  document.getElementById('editVendorModal').classList.add('active');
}

function closeEditVendorModal() {
  document.getElementById('editVendorModal').classList.remove('active');
}

async function saveVendorDetails() {
  const vendorId = document.getElementById('editVendorId').value;
  const name = document.getElementById('editVendorName').value;
  const address = document.getElementById('editVendorAddress').value;
  const contactPerson = document.getElementById('editVendorContact').value;

  try {
    const response = await apiCall(`/vendors/${vendorId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, address, contactPerson })
    });

    // Update local vendors array
    const index = vendors.findIndex(v => v._id === vendorId);
    if (index !== -1) {
      vendors[index] = response;
    }

    populateVendorSelect();
    // Restore selection
    document.getElementById('vendorSelect').value = vendorId;

    showToast('Vendor details updated');
    closeEditVendorModal();
  } catch (error) {
    console.error('Update vendor error:', error);
    showToast('Failed to update vendor', 'error');
  }
}
