// Admin Dashboard Logic
let enquiries = [];
let products = [];
let customers = [];
let vendors = [];
let users = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const user = checkAuth();
    if (!user || user.role !== 'admin') {
        window.location.href = '/';
        return;
    }

    const userNameEl = document.getElementById('navUserName');
    if (userNameEl) {
        userNameEl.textContent = user.name;
    }

    await loadDashboardData();
});

async function loadDashboardData() {
    try {
        // Load all data
        [enquiries, products, customers, vendors, users] = await Promise.all([
            apiCall('/enquiries'),
            apiCall('/products'),
            apiCall('/customers'),
            apiCall('/vendors'),
            apiCall('/users')
        ]);

        renderStats();
        renderAIInsights();
        renderProfitability();
        renderWorkload();
        renderEnquiriesTable(enquiries); // New Action Center
        renderPipelineVisualizer();
        renderTopProducts();
        renderEnquiriesTable();

        showToast('Dashboard updated with latest insights', 'success');
    } catch (error) {
        console.error('Load dashboard error:', error);
        showToast('Failed to load dashboard data', 'error');
    }
}

// --- Strategic Insights Logic ---
function renderAIInsights() {
    const container = document.getElementById('aiInsightsList');
    if (!container) return;

    const insights = [];

    // 1. Bottleneck Analysis
    const stalledEnquiries = enquiries.filter(e => {
        const daysOpen = (new Date() - new Date(e.createdAt)) / (1000 * 60 * 60 * 24);
        return e.status === 'active' && daysOpen > 5;
    });

    if (stalledEnquiries.length > 0) {
        insights.push({
            type: 'warning',
            icon: 'warning-circle',
            title: 'Attention Needed',
            message: `${stalledEnquiries.length} enquiries have been active for >5 days.`
        });
    }

    // 2. Revenue Opportunity
    const topCustomer = getTopCustomer();
    if (topCustomer) {
        insights.push({
            type: 'success',
            icon: 'trend-up',
            title: 'Top Client',
            message: `${topCustomer.name} leads with ${topCustomer.count} active deals.`
        });
    }

    // 3. Communication High-Traffic
    const highCommEnquiries = enquiries.filter(e => (e.queryCount || 0) > 8);
    if (highCommEnquiries.length > 0) {
        insights.push({
            type: 'info',
            icon: 'chat-text',
            title: 'High Communication',
            message: `${highCommEnquiries.length} enquiries have intensive discussion (>8 messages).`
        });
    }

    // 4. Efficiency Metric
    const completionRate = Math.round((enquiries.filter(e => e.status === 'completed').length / (enquiries.length || 1)) * 100);
    if (completionRate > 50) {
        insights.push({
            type: 'info',
            icon: 'lightning',
            title: 'High Performance',
            message: `Team efficiency is strong at ${completionRate}% completion.`
        });
    } else {
        insights.push({
            type: 'info',
            icon: 'chart-bar',
            title: 'Pipeline Status',
            message: `Current completion rate is ${completionRate}%.`
        });
    }

    // Render Insights (No "View All" button)
    if (insights.length === 0) {
        container.innerHTML = '<p class="text-muted">No critical insights at this moment.</p>';
        return;
    }

    container.innerHTML = insights.map(insight => `
        <div style="display: flex; gap: 1rem; margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-light);">
            <div style="width: 40px; height: 40px; border-radius: 8px; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; color: var(--${insight.type === 'warning' ? 'danger' : insight.type === 'success' ? 'success' : 'primary'}); font-size: 1.25rem;">
                <i class="ph ph-${insight.icon}"></i>
            </div>
            <div>
                <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem;">${insight.title}</div>
                <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4;">${insight.message}</div>
            </div>
        </div>
    `).join('');
}

// --- Profitability Logic ---
function renderProfitability() {
    let totalRevenue = 0;
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
                    }
                }
            });
        }
    });

    const netProfit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : 0;

    document.getElementById('totalRevenue').textContent = formatCurrency(totalRevenue);
    document.getElementById('totalCost').textContent = formatCurrency(totalCost);
    document.getElementById('netProfit').textContent = formatCurrency(netProfit);
    document.getElementById('profitMarginBadge').textContent = `${margin}% Margin`;
}

// --- Workload Logic ---
function renderWorkload() {
    const container = document.getElementById('workloadList');
    if (!container) return;

    // Group by Assigned To (Sourcing)
    const workload = {};

    enquiries.forEach(enq => {
        if (enq.status === 'active' && enq.assignedTo) {
            const name = enq.assignedTo.name;
            workload[name] = (workload[name] || 0) + 1;
        }
    });

    // Convert to array and sort
    const sortedWorkload = Object.entries(workload)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5); // Top 5

    if (sortedWorkload.length === 0) {
        container.innerHTML = '<p class="text-muted">No active assignments.</p>';
        return;
    }

    // Find max for progress bar
    const maxCount = Math.max(...sortedWorkload.map(w => w.count));

    container.innerHTML = sortedWorkload.map(user => `
        <div>
            <div class="flex-between mb-1">
                <span style="font-size: 0.85rem; font-weight: 500;">${user.name}</span>
                <span class="text-muted text-xs">${user.count} Active</span>
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
            counts[e.customerId.name] = (counts[e.customerId.name] || 0) + 1;
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
        { icon: 'file-text', label: 'Total Enquiries', value: totalEnquiries, color: 'var(--primary)' },
        { icon: 'chat-text', label: 'Total Queries', value: totalQueries, color: 'var(--info)' },
        { icon: 'check-circle', label: 'Completed', value: completedEnquiries, color: 'var(--success)' },
        { icon: 'storefront', label: 'Vendors', value: vendors.length, color: 'var(--warning)' },
        { icon: 'currency-dollar', label: 'Revenue', value: formatCurrency(totalSalesValue), color: 'var(--accent)' }
    ];

    container.innerHTML = stats.map(stat => `
        <div class="stat-card" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem;">
            <div class="flex-between">
                <div class="stat-label" style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;">${stat.label}</div>
                <i class="ph ph-${stat.icon}" style="color: ${stat.color}; font-size: 1.25rem;"></i>
            </div>
            <div class="stat-value" style="font-size: 1.75rem;">${stat.value}</div>
        </div>
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
        <div style="display: flex; gap: 0.5rem; height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 1.5rem;">
            <div style="flex: ${statusCounts.Active || 1}; background: var(--primary);" title="Active"></div>
            <div style="flex: ${statusCounts.Completed || 1}; background: var(--success);" title="Completed"></div>
            <div style="flex: ${statusCounts.Draft || 1}; background: var(--warning);" title="Draft"></div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
            ${Object.entries(statusCounts).map(([status, count]) => `
                <div class="flex-between" style="padding: 0.5rem; border-bottom: 1px solid var(--border-light);">
                    <span style="font-size: 0.9rem;">${status}</span>
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
            let name = item.materialName || item.description || 'Unspecified Product';
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
                        <span style="font-size: 0.875rem; font-weight: 500;">${name}</span>
                    </div>
                    <span class="badge badge-primary">${count} reqs</span>
                </div>
            `).join('')}
        </div>
    `;
}

function renderEnquiriesTable(filteredData = null) {
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
                <div style="font-weight: 500;">${enq.customerId?.name || 'Unknown'}</div>
                <div class="text-muted" style="font-size: 0.75rem;">${enq.customerId?.contactPerson || ''}</div>
            </td>
            <td>${enq.items?.length || 0} items</td>
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

function getEnquiryDisplayStatus(enq) {
    if (enq.status === 'completed') return 'completed';
    if (!enq.items || enq.items.length === 0) return 'pending';

    const statuses = enq.items.map(i => i.status);
    
    // If all items are completed, the enquiry is completed (already handled above but for safety)
    if (statuses.every(s => s === 'completed')) return 'completed';
    
    // If any item is pending or assigned (not yet quoted), it's pending
    if (statuses.some(s => s === 'pending' || s === 'assigned')) return 'pending';
    
    // If all items are at least vendor_quoted, but some are not yet sales_priced
    if (statuses.every(s => ['vendor_quoted', 'sales_priced', 'completed'].includes(s))) {
        if (statuses.some(s => s === 'vendor_quoted')) return 'vendor_quoted';
        return 'sales_priced';
    }
    
    return 'pending';
}

function filterEnquiries(status = null) {
    const searchTerm = document.getElementById('enquirySearch').value.toLowerCase();
    const statusFilter = status || document.getElementById('statusFilter').value;

    // Update select if status passed programmatically
    if (status) document.getElementById('statusFilter').value = status;

    const filtered = enquiries.filter(enq => {
        const matchesSearch =
            enq.enquiryNumber.toLowerCase().includes(searchTerm) ||
            (enq.customerId?.name || '').toLowerCase().includes(searchTerm);
        
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
                <div style="font-weight: 600;">${enq.customerId?.name}</div>
            </div>
            <div>
                <div class="text-muted text-xs">Created By</div>
                <div style="font-weight: 600;">${enq.createdBy?.name}</div>
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
                                <div style="font-weight: 500;">${item.productId?.materialName || 'Custom Item'}</div>
                                <div class="text-muted" style="font-size: 0.7rem;">${item.productId?.description || ''}</div>
                            </td>
                            <td>${item.quantity} ${item.productId?.uom || 'Unit'}</td>
                            <td>
                                <div style="font-size: 0.85rem;">${item.assignedTo?.name || '<span class="text-danger">Unassigned</span>'}</div>
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
    chatInterval = setInterval(() => loadMessages(enquiryId), 5000); // Admin can have slower polling
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
            const isSourcing = m.senderId.role === 'sourcing';
            return `
                <div class="chat-message ${isSourcing ? 'received' : 'sent'}" style="margin-bottom: 0.5rem;">
                    <div style="font-weight: 600; font-size: 0.7rem; margin-bottom: 0.2rem; opacity: 0.9;">
                        ${m.senderId.name} (${m.senderId.role})
                    </div>
                    <div>${m.message}</div>
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
