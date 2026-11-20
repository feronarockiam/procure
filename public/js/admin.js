// Admin Dashboard Logic
let enquiries = [];
let products = [];
let customers = [];
let vendors = [];
let users = [];
let viewMode = localStorage.getItem('viewMode_admin') || 'enquiry'; // 'enquiry' | 'material' | 'items'

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const user = checkAuth();
    if (!user) return;
    if (!requirePageAccess('/admin.html')) return;

    const userNameEl = document.getElementById('navUserName');
    if (userNameEl) userNameEl.textContent = user.name;
    const roleEl = document.getElementById('navUserRole');
    if (roleEl) roleEl.textContent = user.roleName || 'Administrator';

    await loadDashboardData();
});

async function loadDashboardData() {
    try {
        // Load all data
        // The enquiry list drives the dashboard. The four lists only add counts, so a role that can open the
        // dashboard but not (say) the employee list still gets everything else.
        [enquiries, products, customers, vendors, users] = await Promise.all([
            apiCall('/enquiries'),
            apiCall('/products', { silent: true }).catch(() => []),
            apiCall('/customers', { silent: true }).catch(() => []),
            apiCall('/vendors', { silent: true }).catch(() => []),
            apiCall('/users', { silent: true }).catch(() => [])
        ]);

        renderStats();
        renderAIInsights();
        renderProfitability();
        renderWorkload();
        const tog = document.getElementById('viewToggleContainer');
        if (tog) tog.innerHTML = getViewToggleHTML(viewMode);
        renderEnquiriesTable(enquiries); // New Action Center
        renderPipelineVisualizer();
        renderTopProducts();

        if (loadDashboardData.loadedOnce) showToast('Dashboard updated with latest insights', 'success');
        loadDashboardData.loadedOnce = true;
    } catch (error) {
        console.error('Load dashboard error:', error);
        showToast('Failed to load dashboard data', 'error');
    }
}

// --- What needs attention ---------------------------------------------------
// Things that are slowing work down, each with a link to the enquiry. Everything here comes from the enquiry list already loaded.
const STALLED_DAYS = 3; // the same number the "Needs you today" cards use

const ageInDays = (value) => (Date.now() - new Date(value).getTime()) / 86400000;
const daysText = (days) => (days < 1 ? 'less than a day' : `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'}`);

function renderAIInsights() {
    const container = document.getElementById('aiInsightsList');
    if (!container) return;

    const open = enquiries.filter(e => e.status === 'active');
    const lines = [];
    const enquiryLink = (e) => `<a class="attention-link" href="/sales.html?enquiryId=${escapeHtml(e._id)}">${escapeHtml(e.enquiryNumber)}${e.customerId?.name ? ' · ' + escapeHtml(e.customerId.name) : ''}</a>`;

    // 1. Enquiries that have been open too long
    const stalled = open.filter(e => ageInDays(e.createdAt) > STALLED_DAYS).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (stalled.length) {
        lines.push({
            tone: 'danger', icon: 'hourglass-medium',
            title: `${stalled.length} enquir${stalled.length === 1 ? 'y has' : 'ies have'} been open for more than ${STALLED_DAYS} days`,
            detail: stalled.slice(0, 3).map(e => `${enquiryLink(e)} <span class="text-muted">(${daysText(ageInDays(e.createdAt))})</span>`).join('<br>') + (stalled.length > 3 ? `<br><span class="text-muted">and ${stalled.length - 3} more</span>` : ''),
        });
    }

    // 2. Items nobody has been given
    const itemsOf = (test) => open.flatMap(e => (e.items || []).filter(test).map(item => ({ item, enquiry: e })));
    const unassigned = itemsOf(i => ['unassigned', 'pending'].includes(i.status));
    if (unassigned.length) {
        const oldest = Math.max(...unassigned.map(({ enquiry }) => ageInDays(enquiry.createdAt)));
        lines.push({
            tone: oldest > 1 ? 'danger' : 'warn', icon: 'user-plus',
            title: `${unassigned.length} item${unassigned.length === 1 ? ' is' : 's are'} waiting to be given to someone`,
            detail: `The longest has waited ${daysText(oldest)}. <a class="attention-link" href="/sales.html?filter=pending">Assign them</a>`,
        });
    }

    // 3. Purchase people who have not answered
    const slow = itemsOf(i => i.status === 'assigned' && ageInDays(i.assignedAt || i.updatedAt || i.createdAt) > 2);
    if (slow.length) {
        const who = {};
        slow.forEach(({ item }) => { const n = item.assignedTo?.name || 'Someone'; who[n] = (who[n] || 0) + 1; });
        lines.push({
            tone: 'warn', icon: 'clock-countdown',
            title: `${slow.length} item${slow.length === 1 ? ' has' : 's have'} waited over 2 days for a vendor price`,
            detail: Object.entries(who).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${escapeHtml(n)}: ${c}`).join(' · '),
        });
    }

    // 4. Questions sales has not answered
    const questions = itemsOf(i => i.status === 'in_sales_query');
    if (questions.length) {
        lines.push({
            tone: 'danger', icon: 'chat-circle-dots',
            title: `${questions.length} question${questions.length === 1 ? ' is' : 's are'} waiting for a reply from sales`,
            detail: `<a class="attention-link" href="/sales.html?filter=needs_response">See them</a>`,
        });
    }

    // 5. Good news: ready to go out
    const ready = open.filter(e => (e.items || []).length && e.items.every(i => ['priced', 'sales_priced', 'completed', 'unsuccessful'].includes(i.status)) && e.items.some(i => ['priced', 'sales_priced'].includes(i.status)));
    if (ready.length) {
        lines.push({
            tone: 'success', icon: 'paper-plane-tilt',
            title: `${ready.length} quotation${ready.length === 1 ? ' is' : 's are'} ready to send`,
            detail: ready.slice(0, 3).map(enquiryLink).join('<br>'),
        });
    }

    const topCustomer = getTopCustomer();
    const completionRate = Math.round((enquiries.filter(e => e.status === 'completed').length / (enquiries.length || 1)) * 100);
    const snapshot = enquiries.length
        ? `<div class="attention-snapshot">${topCustomer ? `Most enquiries: <b>${escapeHtml(topCustomer.name)}</b> (${topCustomer.count}) · ` : ''}${completionRate}% of enquiries completed</div>`
        : '';

    container.innerHTML = (lines.length
        ? lines.map(line => `
            <div class="attention-row tone-${line.tone}">
                <div class="attention-icon"><i class="ph ph-${line.icon}" aria-hidden="true"></i></div>
                <div class="attention-text">
                    <div class="attention-title">${escapeHtml(line.title)}</div>
                    ${line.detail ? `<div class="attention-detail">${line.detail}</div>` : ''}
                </div>
            </div>`).join('')
        : `<div class="attention-row tone-success"><div class="attention-icon"><i class="ph ph-check-circle" aria-hidden="true"></i></div>
            <div class="attention-text"><div class="attention-title">${enquiries.length ? 'Nothing is stuck right now' : 'No enquiries yet'}</div>
            <div class="attention-detail">${enquiries.length ? 'Every open enquiry is moving.' : 'They will show up here as soon as the first one is raised.'}</div></div></div>`) + snapshot;
}

// --- Profitability Logic ---
function renderProfitability() {
    let totalRevenue = 0;
    let uncosted = 0; // priced items with no vendor quote chosen: their cost is unknown, not zero
    let totalCost = 0;

    enquiries.forEach(enq => {
        if (enq.items) {
            enq.items.forEach(item => {
                // Only count if sales priced
                if (item.salesPrice) {
                    totalRevenue += item.salesPrice * item.quantity;

                    // Calculate Cost (Vendor Price + Freight)
                    if (item.selectedVendorQuoteId) {
                        const quote = item.selectedVendorQuoteId;
                        const itemCost = (quote.vendorPrice * item.quantity) + (quote.freightPrice || 0);
                        totalCost += itemCost;
                    } else {
                        uncosted++;
                    }
                }
            });
        }
    });

    const netProfit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : 0;

    document.getElementById('totalRevenue').textContent = formatCurrency(totalRevenue);
    // With any priced item missing its vendor cost, the profit would be a guess (and read as 100% margin): show it as unknown
    const costEl = document.getElementById('totalCost'), profitEl = document.getElementById('netProfit');
    costEl.textContent = uncosted > 0 ? (totalCost > 0 ? `${formatCurrency(totalCost)} (partial)` : '—') : formatCurrency(totalCost);
    profitEl.textContent = uncosted > 0 ? '—' : formatCurrency(netProfit);
    costEl.title = profitEl.title = uncosted > 0 ? 'Choose the vendor quote on each priced item to see cost and profit' : '';
    const badge = document.getElementById('profitMarginBadge');
    if (uncosted > 0) {
        // a margin worked out from missing costs would read as an impressive 100%
        badge.textContent = `Cost missing on ${uncosted} priced item${uncosted === 1 ? '' : 's'}`;
        badge.title = 'Margin is shown only when every priced item has a vendor quote chosen for it';
        badge.style.background = '#fffbeb'; badge.style.color = '#92400e'; badge.style.textTransform = 'none';
    } else {
        badge.textContent = totalRevenue > 0 ? `${margin}% Margin` : 'No priced items yet';
        badge.title = ''; badge.style.background = ''; badge.style.color = ''; badge.style.textTransform = '';
    }
}

// --- Workload Logic ---
function renderWorkload() {
    const container = document.getElementById('workloadList');
    if (!container) return;

    // Work is handed out per item, so count each person's items that are still with them (not yet priced or finished)
    const WITH_THEM = ['assigned', 'in_sales_query', 'sales_query_resolved'];
    const workload = {};
    enquiries.forEach(enq => {
        if (enq.status !== 'active') return;
        (enq.items || []).forEach(item => {
            if (!item.assignedTo || !WITH_THEM.includes(item.status)) return;
            const name = item.assignedTo.name || 'Someone';
            workload[name] = (workload[name] || 0) + 1;
        });
    });

    const sortedWorkload = Object.entries(workload)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

    if (sortedWorkload.length === 0) {
        container.innerHTML = '<p class="text-muted">Nobody has open work right now.</p>';
        return;
    }

    // Find max for progress bar
    const maxCount = Math.max(...sortedWorkload.map(w => w.count));

    container.innerHTML = sortedWorkload.map(user => `
        <div>
            <div class="flex-between mb-1">
                <span style="font-size: 0.85rem; font-weight: 500;">${escapeHtml(user.name)}</span>
                <span class="text-muted text-xs">${user.count} open item${user.count === 1 ? '' : 's'}</span>
            </div>
            <div style="height: 6px; background: var(--bg-hover); border-radius: 3px; overflow: hidden;">
                <div style="height: 100%; width: ${(user.count / maxCount) * 100}%; background: var(--primary); border-radius: 3px;"></div>
            </div>
        </div>
    `).join('');
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
}

function getTopCustomer() {
    const counts = {};
    enquiries.forEach(e => {
        if (e.customerId) {
            const customerName = e.customerId?.name || 'Unknown';
            counts[customerName] = (counts[customerName] || 0) + 1;
        }
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted.length > 0 ? { name: sorted[0][0], count: sorted[0][1] } : null;
}

// --- Standard Render Functions ---

function renderStats() {
    const container = document.getElementById('statsGrid');
    if (!container) return;

    const totalEnquiries = enquiries.length;
    const activeEnquiries = enquiries.filter(e => e.status === 'active').length;
    const completedEnquiries = enquiries.filter(e => e.status === 'completed').length;

    const allItems = enquiries.flatMap(e => e.items || []);
    const totalSalesValue = allItems
        .filter(i => i.salesPrice)
        .reduce((sum, i) => sum + (i.salesPrice * i.quantity), 0);
    
    const totalQueries = enquiries.reduce((sum, e) => sum + (e.queryCount || 0), 0);

    const stats = [
        { icon: 'file-text', label: 'Total Enquiries', value: totalEnquiries, color: 'var(--primary)', href: '/sales.html' },
        { icon: 'chat-text', label: 'Chat Messages', value: totalQueries, color: 'var(--info)' },
        { icon: 'check-circle', label: 'Completed', value: completedEnquiries, color: 'var(--success)', href: '/sales.html?filter=successful' },
        { icon: 'storefront', label: 'Vendors', value: vendors.length, color: 'var(--warning)', href: '/masters.html?type=vendors' },
        { icon: 'currency-dollar', label: 'Quoted Value', value: formatCurrency(totalSalesValue), color: 'var(--accent)', href: '/sales.html?filter=quoted' }
    ];

    container.innerHTML = stats.map(stat => `
        <${stat.href ? `a href="${stat.href}"` : 'div'} class="stat-card${stat.href ? ' stat-link' : ''}" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; text-decoration: none; color: inherit;">
            <div class="flex-between">
                <div class="stat-label" style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;">${escapeHtml(stat.label)}</div>
                <i class="ph ph-${stat.icon}" style="color: ${stat.color}; font-size: 1.25rem;"></i>
            </div>
            <div class="stat-value" style="font-size: 1.75rem;">${stat.value}</div>
        </${stat.href ? 'a' : 'div'}>
    `).join('');
}

function renderPipelineVisualizer() {
    const container = document.getElementById('insightsBreakdown');
    if (!container) return;

    const statusCounts = {
        'Draft': enquiries.filter(e => e.status === 'draft').length,
        'Active': enquiries.filter(e => e.status === 'active').length,
        'Completed': enquiries.filter(e => e.status === 'completed').length,
        'Cancelled': enquiries.filter(e => e.status === 'cancelled').length
    };

    container.innerHTML = `
        <h4 class="mb-4">Pipeline Health</h4>
        <div role="img" aria-label="${escapeHtml(Object.entries(statusCounts).map(([k, v]) => `${k} ${v}`).join(', '))}" style="display: flex; gap: 2px; height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 1.5rem; background: var(--border-light);">
            ${[['Active', 'var(--primary)'], ['Completed', 'var(--success)'], ['Draft', 'var(--warning)'], ['Cancelled', 'var(--danger)']]
                .filter(([name]) => statusCounts[name] > 0)
                .map(([name, color]) => `<div style="flex: ${statusCounts[name]}; background: ${color};" title="${escapeHtml(name)}: ${statusCounts[name]}"></div>`).join('')}
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
            ${Object.entries(statusCounts).map(([status, count]) => `
                <div class="flex-between" style="padding: 0.5rem; border-bottom: 1px solid var(--border-light);">
                    <span style="font-size: 0.9rem; display:flex; align-items:center; gap:0.45rem;"><span aria-hidden="true" style="width:9px;height:9px;border-radius:50%;background:${({ Active: 'var(--primary)', Completed: 'var(--success)', Draft: 'var(--warning)', Cancelled: 'var(--danger)' })[status]}"></span>${status}</span>
                    <span style="font-weight: 600;">${count}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function renderTopProducts() {
    const container = document.getElementById('topProductsList');
    if (!container) return;

    const productCounts = {};
    enquiries.forEach(e => {
        e.items?.forEach(item => {
            let name = (item.productId && item.productId.materialName) || item.materialName || item.description || 'Unnamed material';
            if (name.length > 20) name = name.substring(0, 20) + '...';
            productCounts[name] = (productCounts[name] || 0) + 1;
        });
    });

    const topProducts = Object.entries(productCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    if (topProducts.length === 0) {
        container.innerHTML = '<p class="text-muted text-sm">No product data available</p>';
        return;
    }

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            ${topProducts.map(([name, count], idx) => `
                <div class="flex-between" style="padding: 0.5rem; background: var(--bg-hover); border-radius: 0.375rem;">
                    <div class="flex items-center gap-2">
                        <span style="width: 20px; height: 20px; background: var(--bg-card); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);">${idx + 1}</span>
                        <span style="font-size: 0.875rem; font-weight: 500;">${escapeHtml(name)}</span>
                    </div>
                    <span class="badge badge-primary">${count} request${count === 1 ? '' : 's'}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function setViewMode(mode) {
    viewMode = mode;
    localStorage.setItem('viewMode_admin', mode);
    const tog = document.getElementById('viewToggleContainer');
    if (tog) tog.innerHTML = getViewToggleHTML(mode);
    // Swap table header
    const materialHead = document.getElementById('enquiriesTableHeadMaterial');
    const enquiryHead  = document.getElementById('enquiriesTableHeadEnquiry');
    const itemsHead    = document.getElementById('enquiriesTableHeadItems');
    if (materialHead) materialHead.style.display = mode === 'material' ? '' : 'none';
    if (enquiryHead)  enquiryHead.style.display  = mode === 'enquiry'  ? '' : 'none';
    if (itemsHead)    itemsHead.style.display     = mode === 'items'    ? '' : 'none';
    filterEnquiries();
}

function renderMaterialsTable(filteredData = null) {
    const container = document.getElementById('enquiriesTableBody');
    if (!container) return;
    const data = filteredData || enquiries;
    const entries = [];
    for (const enq of data) {
        for (const item of (enq.items || [])) {
            entries.push({ item, enquiry: enq });
        }
    }
    const groups = groupByMaterial(entries);
    if (!groups.length) {
        container.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No materials found</td></tr>';
        return;
    }
    container.innerHTML = groups.map((group, idx) => {
        const prod = group.product;
        const name = prod?.materialName || 'Unknown';
        const brand = prod?.brand || '';
        const spec = prod?.specification || '';
        const uom = prod?.uom || '';
        const meta = [brand, spec].filter(Boolean).map(escapeHtml).join(' · ');
        const id = `mat-admin-${idx}`;
        const subRows = group.entries.map(({ item, enquiry }) => {
            const displayStatus = getEnquiryDisplayStatus({ items: [item], status: item.status });
            return `<tr style="background:var(--bg-secondary)">
                <td style="padding-left:2.5rem;font-size:0.8rem;color:var(--primary);font-weight:500">${enquiry.enquiryNumber}</td>
                <td style="font-size:0.8rem">${escapeHtml(enquiry.customerId?.name) || '—'}<br><span class="text-muted" style="font-size:0.72rem">${escapeHtml(enquiry.customerId?.contactPerson) || ''}</span></td>
                <td style="font-size:0.8rem">${item.quantity} ${escapeHtml(uom)}</td>
                <td style="font-size:0.8rem">${formatDate(enquiry.createdAt)}</td>
                <td>${getStatusBadge(item.status)}</td>
                <td></td>
                <td><button class="btn btn-sm btn-secondary" onclick="viewEnquiryDetails('${enquiry._id}')">View</button></td>
            </tr>`;
        }).join('');
        return `<tr id="${id}-row" onclick="toggleAdminMaterialRow('${id}')" style="cursor:pointer">
            <td><div style="display:flex;align-items:center;gap:0.5rem">
                <i class="ph ph-caret-right" id="chevron-${id}" style="font-size:0.85rem;color:var(--text-muted);transition:transform 0.2s"></i>
                <span style="font-weight:600">${escapeHtml(name)}</span>
            </div>
            ${meta ? `<div style="font-size:0.75rem;color:var(--text-muted);padding-left:1.5rem">${meta}</div>` : ''}</td>
            <td colspan="2" style="color:var(--text-muted);font-size:0.82rem">${group.entries.map(e => e.enquiry.customerId?.name).filter((v,i,a)=>a.indexOf(v)===i).slice(0,2).join(', ')}${group.entries.length > 2 ? '…' : ''}</td>
            <td style="font-size:0.82rem">${group.entries.length} enquir${group.entries.length===1?'y':'ies'}</td>
            <td><span class="material-stat-chip">${group.totalQty} ${escapeHtml(uom)}</span></td>
            <td></td>
            <td></td>
        </tr>
        <tr id="${id}-sub" style="display:none"><td colspan="7" style="padding:0">
            <table style="width:100%;border-collapse:collapse">${subRows}</table>
        </td></tr>`;
    }).join('');
}

function toggleAdminMaterialRow(id) {
    const sub = document.getElementById(`${id}-sub`);
    const chev = document.getElementById(`chevron-${id}`);
    if (!sub) return;
    const open = sub.style.display !== 'none';
    sub.style.display = open ? 'none' : '';
    if (chev) chev.style.transform = open ? '' : 'rotate(90deg)';
}

function renderItemsTableView(filteredData = null) {
    const container = document.getElementById('enquiriesTableBody');
    if (!container) return;
    const data = filteredData || enquiries;
    const rows = [];
    for (const enq of data) {
        for (const item of (enq.items || [])) {
            const prod = item.productId;
            const uom = prod?.uom || '';
            rows.push(`<tr>
                <td>
                    <div style="font-weight:600;font-size:0.82rem">${escapeHtml(prod?.materialName) || '—'}</div>
                    ${(prod?.brand || prod?.specification) ? `<div style="font-size:0.72rem;color:var(--text-muted)">${[prod.brand, prod.specification].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
                </td>
                <td style="font-family:monospace;font-size:0.78rem;color:var(--primary);font-weight:600">${enq.enquiryNumber}</td>
                <td><div style="font-size:0.82rem;font-weight:500">${escapeHtml(enq.customerId?.name) || '—'}</div>
                    <div style="font-size:0.72rem;color:var(--text-muted)">${escapeHtml(enq.customerId?.contactPerson) || ''}</div></td>
                <td style="white-space:nowrap;font-size:0.82rem">${item.quantity} ${escapeHtml(uom)}</td>
                <td style="font-size:0.8rem">${item.assignedTo?.name ? `<span class="badge badge-info">${escapeHtml(item.assignedTo.name)}</span>` : '<span class="text-muted">—</span>'}</td>
                <td>${getStatusBadge(item.status)}</td>
                <td style="font-size:0.78rem;color:var(--text-muted)">${formatDate(enq.createdAt)}</td>
                <td><button class="btn btn-sm btn-secondary" onclick="viewEnquiryDetails('${enq._id}')">View</button></td>
            </tr>`);
        }
    }
    // Inject into the tbody directly (admin uses a regular table, not glass-table-wrap)
    if (!rows.length) {
        container.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No items found</td></tr>';
        return;
    }
    container.innerHTML = rows.join('');
}

function renderEnquiriesTable(filteredData = null) {
    if (viewMode === 'material') { renderMaterialsTable(filteredData); return; }
    if (viewMode === 'items')    { renderItemsTableView(filteredData); return; }
    const container = document.getElementById('enquiriesTableBody');
    if (!container) return;

    const data = filteredData || enquiries;
    const sortedData = [...data].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (sortedData.length === 0) {
        container.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No enquiries found</td></tr>';
        return;
    }

    container.innerHTML = sortedData.map(enq => {
        const displayStatus = getEnquiryDisplayStatus(enq);
        return `
        <tr>
            <td><span style="font-weight: 500; color: var(--primary);">${enq.enquiryNumber}</span></td>
            <td>
                <div style="font-weight: 500;">${escapeHtml(enq.customerId?.name) || 'Unknown'}</div>
                <div class="text-muted" style="font-size: 0.75rem;">${escapeHtml(enq.customerId?.contactPerson) || ''}</div>
            </td>
            <td>${enq.items?.length || 0} item${(enq.items?.length || 0) === 1 ? '' : 's'}</td>
            <td>${formatDate(enq.createdAt)}</td>
            <td>${getStatusBadge(displayStatus)}</td>
            <td>
                <div class="flex items-center gap-2">
                    <span class="badge ${enq.queryCount > 0 ? 'badge-primary' : 'badge-light'}" style="min-width: 24px; text-align: center;">${enq.queryCount || 0}</span>
                    <button class="toggle-btn" onclick="openAdminChat('${enq._id}', '${enq.enquiryNumber}')" title="View Chat History">
                        <i class="ph ph-chat-circle-dots" style="font-size: 1.1rem; color: ${enq.queryCount > 0 ? 'var(--primary)' : 'var(--text-muted)'};"></i>
                    </button>
                </div>
            </td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick="viewEnquiryDetails('${enq._id}')">View</button>
            </td>
        </tr>
    `}).join('');
}

// Where an enquiry really is, from its items (the badge names are the same ones every other screen uses)
function getEnquiryDisplayStatus(enq) {
    if (enq.status === 'completed') return 'completed';
    if (enq.status === 'unsuccessful' || enq.status === 'closed') return 'unsuccessful';
    const statuses = (enq.items || []).map(i => i.status);
    if (statuses.length === 0) return 'unassigned';
    const open = statuses.filter(s => !['completed', 'unsuccessful'].includes(s));
    if (open.length === 0) return statuses.every(s => s === 'unsuccessful') ? 'unsuccessful' : 'completed';
    if (open.some(s => s === 'in_sales_query')) return 'in_sales_query';                                   // a question is waiting for sales
    if (open.every(s => ['unassigned', 'pending'].includes(s))) return 'unassigned';                        // nobody has started
    if (open.some(s => ['unassigned', 'pending', 'assigned', 'sales_query_resolved'].includes(s))) return 'assigned'; // work in hand
    if (open.some(s => s === 'vendor_quoted')) return 'vendor_quoted';                                      // prices in, selling price to set
    return 'priced';
}

const filterEnquiriesTypingDebounced = debounce(() => filterEnquiries());
function filterEnquiries(status = null) {
    const searchTerm = document.getElementById('enquirySearch').value.toLowerCase();
    const statusFilter = status || document.getElementById('statusFilter').value;

    if (status) document.getElementById('statusFilter').value = status;

    const filtered = enquiries.filter(enq => {
        const matchesEnqNum = enq.enquiryNumber.toLowerCase().includes(searchTerm);
        const matchesCust = (enq.customerId?.name || '').toLowerCase().includes(searchTerm);
        const matchesMat = viewMode === 'material' && enq.items?.some(i =>
            (i.productId?.materialName || '').toLowerCase().includes(searchTerm) ||
            (i.productId?.brand || '').toLowerCase().includes(searchTerm) ||
            (i.productId?.specification || '').toLowerCase().includes(searchTerm)
        );
        const matchesSearch = !searchTerm || matchesEnqNum || matchesCust || matchesMat;

        const displayStatus = getEnquiryDisplayStatus(enq);
        const matchesStatus = statusFilter === 'all' || displayStatus === statusFilter;
        return matchesSearch && matchesStatus;
    });

    renderEnquiriesTable(filtered);
}

function viewEnquiryDetails(id) {
    const enq = enquiries.find(e => e._id === id);
    if (!enq) return;

    const modal = document.getElementById('detailsModal');
    const body = document.getElementById('detailsModalBody');
    document.getElementById('detailsModalTitle').textContent = `Enquiry Detail: ${enq.enquiryNumber}`;

    modal.classList.add('active');

    const html = `
        <div class="flex-between mb-4" style="padding: 1rem; background: var(--bg-hover); border-radius: 8px;">
            <div>
                <div class="text-muted text-xs">Customer</div>
                <div style="font-weight: 600;">${escapeHtml(enq.customerId?.name)}</div>
            </div>
            <div>
                <div class="text-muted text-xs">Created By</div>
                <div style="font-weight: 600;">${escapeHtml(enq.createdBy?.name)}</div>
            </div>
            <div>
                <div class="text-muted text-xs">Current Status</div>
                <div>${getStatusBadge(getEnquiryDisplayStatus(enq))}</div>
            </div>
        </div>

        <h4 class="mb-3">Item Breakdown</h4>
        <div class="table-responsive">
            <table class="table">
                <thead>
                    <tr>
                        <th style="font-size: 0.75rem;">Material</th>
                        <th style="font-size: 0.75rem;">Qty</th>
                        <th style="font-size: 0.75rem;">Sourcing</th>
                        <th style="font-size: 0.75rem;">Vendor Price</th>
                        <th style="font-size: 0.75rem;">Sales Price</th>
                        <th style="font-size: 0.75rem;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${enq.items?.map(item => `
                        <tr>
                            <td>
                                <div style="font-weight: 500;">${escapeHtml(item.productId?.materialName) || 'Custom Item'}</div>
                                <div class="text-muted" style="font-size: 0.7rem;">${escapeHtml(item.productId?.description) || ''}</div>
                            </td>
                            <td>${item.quantity} ${escapeHtml(item.productId?.uom) || 'Unit'}</td>
                            <td>
                                <div style="font-size: 0.85rem;">${escapeHtml(item.assignedTo?.name) || '<span class="text-danger">Unassigned</span>'}</div>
                            </td>
                            <td>
                                ${item.selectedVendorQuoteId ? 
                                    `₹${item.selectedVendorQuoteId.vendorPrice} <span class="text-muted" style="font-size: 0.7rem;">+₹${item.selectedVendorQuoteId.freightPrice} fr</span>` : 
                                    '<span class="text-muted">-</span>'}
                            </td>
                            <td>
                                ${item.salesPrice ? `<span class="text-success font-bold">₹${item.salesPrice}</span>` : '<span class="text-muted">-</span>'}
                            </td>
                            <td>${getStatusBadge(item.status)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="mt-4 flex justify-end">
            <button class="btn btn-secondary" onclick="closeDetailsModal()">Close</button>
        </div>
    `;

    body.innerHTML = html;
}

function closeDetailsModal() {
    const modal = document.getElementById('detailsModal');
    if (modal) modal.classList.remove('active');
}

// --- Admin Chat History Logic ---
let chatInterval = null;
let currentChatEnquiryId = null;

async function openAdminChat(enquiryId, enquiryNumber) {
    currentChatEnquiryId = enquiryId;
    
    let modal = document.getElementById('chatModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'chatModal';
        modal.className = 'modal';
        modal.style.zIndex = '2000';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px; width: 95%;">
                <div class="modal-header">
                    <h3 class="modal-title"><i class="ph ph-chat-text"></i> Sales Query Audit: ${enquiryNumber}</h3>
                    <button class="close-btn" onclick="closeChat()">&times;</button>
                </div>
                <div class="chat-container">
                    <div class="chat-messages" id="chatMessages">
                        <div class="text-center p-4 text-muted">Loading history...</div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    } else {
        modal.querySelector('.modal-title').innerHTML = `<i class="ph ph-chat-text"></i> Sales Query Audit: ${enquiryNumber}`;
    }

    modal.classList.add('active');
    loadMessages(enquiryId);
    
    if (chatInterval) clearInterval(chatInterval);
    chatInterval = setInterval(() => { if (!document.hidden) loadMessages(enquiryId); }, 5000); // Admin can have slower polling
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
            container.innerHTML = '<div class="text-center p-8 text-muted" style="font-size: 0.85rem;">No conversation history for this enquiry.</div>';
            return;
        }

        const html = messages.map(m => {
            const senderRole = m.senderId.roleName || m.senderId.role || '';
            const isSourcing = senderRole.toLowerCase().includes('purchase') || senderRole === 'sourcing';
            return `
                <div class="chat-message ${isSourcing ? 'received' : 'sent'}" style="margin-bottom: 0.5rem;">
                    <div style="font-weight: 600; font-size: 0.7rem; margin-bottom: 0.2rem; opacity: 0.9;">
                        ${escapeHtml(m.senderId.name)} (${escapeHtml(senderRole)})
                    </div>
                    <div>${escapeHtml(m.message)}</div>
                    <div class="message-info">${formatDate(m.createdAt)} ${new Date(m.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                </div>
            `;
        }).join('');

        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
        const oldHtml = container.innerHTML;
        container.innerHTML = html;
        
        if (isAtBottom || oldHtml.includes('Loading history...')) {
            container.scrollTop = container.scrollHeight;
        }
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}
