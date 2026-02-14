// Masters Data Management Logic
let masterType = '';
let allData = [];
let filteredData = [];
let currentEditId = null;

// Master configuration
const masterConfigs = {
    materials: {
        title: 'Material Master',
        apiEndpoint: '/products',
        fields: [
            { name: 'materialName', label: 'Material Name', type: 'text', required: true },
            { name: 'uom', label: 'Unit of Measure', type: 'text', required: true },
            { name: 'hsnCode', label: 'HSN/SAC Code', type: 'text', required: false }, // Added HSN field
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
            { name: 'role', label: 'Role', type: 'select', required: true, options: ['admin', 'sales', 'sourcing'] }
        ],
        columns: ['Name', 'Email', 'Role', 'Created', 'Actions'],
        renderRow: (item) => [
            item.name,
            item.email,
            `<span class="badge badge-${item.role === 'admin' ? 'completed' : item.role === 'sales' ? 'sales-priced' : 'vendor-quoted'}">${item.role}</span>`,
            formatDate(item.createdAt)
        ]
    },
    customers: {
        title: 'Clients Master',
        apiEndpoint: '/customers',
        fields: [
            { name: 'name', label: 'Company Name', type: 'text', required: true },
            { name: 'contactPerson', label: 'Contact Person', type: 'text', required: false },
            { name: 'email', label: 'Email', type: 'email', required: false },
            { name: 'phone', label: 'Phone', type: 'tel', required: false },
            { name: 'address', label: 'Address', type: 'textarea', required: false }
        ],
        columns: ['Company Name', 'Contact Person', 'Email', 'Phone', 'Actions'],
        renderRow: (item) => [
            item.name,
            item.contactPerson || '-',
            item.email || '-',
            item.phone || '-'
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
            { name: 'address', label: 'Address', type: 'textarea', required: false }, // Added Address field
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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const user = checkAuth();
    if (!user || user.role !== 'admin') {
        window.location.href = '/';
        return;
    }

    // Get master type from URL
    const params = new URLSearchParams(window.location.search);
    masterType = params.get('type') || 'materials';

    const config = masterConfigs[masterType];
    if (!config) {
        showToast('Invalid master type', 'error');
        window.location.href = '/admin.html';
        return;
    }

    document.getElementById('pageTitle').innerHTML = `<i class="ph ph-database"></i> ${config.title}`;
    document.getElementById('masterType').textContent = config.title.toLowerCase();

    await loadData();
});

async function loadData() {
    const config = masterConfigs[masterType];

    try {
        showToast('Loading data...', 'info');
        allData = await apiCall(config.apiEndpoint);
        filteredData = [...allData];
        renderTable();
        showToast('Data loaded successfully', 'success');
    } catch (error) {
        console.error('Load data error:', error);
        showToast('Failed to load data', 'error');
    }
}

function renderTable() {
    const config = masterConfigs[masterType];
    const headerContainer = document.getElementById('tableHeader');
    const bodyContainer = document.getElementById('tableBody');

    // Render header
    headerContainer.innerHTML = `
        <tr>
            ${config.columns.map(col => `<th>${col}</th>`).join('')}
        </tr>
    `;

    // Render body
    if (filteredData.length === 0) {
        bodyContainer.innerHTML = `
            <tr>
                <td colspan="${config.columns.length}" class="text-center text-muted">
                    No data available
                </td>
            </tr>
        `;
        return;
    }

    bodyContainer.innerHTML = filteredData.map(item => {
        const rowData = config.renderRow(item);
        return `
            <tr>
                ${rowData.map(cell => `<td>${cell}</td>`).join('')}
                <td>
                    <div class="flex gap-2">
                        <button class="btn btn-secondary btn-sm" onclick='editItem(${JSON.stringify(item)})'>
                            <i class="ph ph-pencil-simple"></i> Edit
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="deleteItem('${item._id}')">
                            <i class="ph ph-trash"></i> Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function filterData() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();

    if (!searchTerm) {
        filteredData = [...allData];
    } else {
        filteredData = allData.filter(item => {
            return Object.values(item).some(value =>
                String(value).toLowerCase().includes(searchTerm)
            );
        });
    }

    renderTable();
}

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

        if (field.type === 'select') {
            inputHtml = `
                <select id="${field.name}" ${field.required ? 'required' : ''}>
                    <option value="">Select...</option>
                    ${field.options.map(opt => `
                        <option value="${opt}" ${data[field.name] === opt ? 'selected' : ''}>${opt}</option>
                    `).join('')}
                </select>
            `;
        } else if (field.type === 'textarea') {
            inputHtml = `
                <textarea id="${field.name}" rows="3" ${field.required ? 'required' : ''}>${data[field.name] || ''}</textarea>
            `;
        } else {
            inputHtml = `
                <input type="${field.type}" id="${field.name}" 
                    value="${data[field.name] || ''}" 
                    ${field.required ? 'required' : ''}
                    ${field.name === 'password' && currentEditId ? 'placeholder="Leave blank to keep current password"' : ''}>
            `;
        }

        return `
            <div class="form-group">
                <label>${field.label}${field.required ? ' *' : ''}</label>
                ${inputHtml}
            </div>
        `;
    }).join('');

    // Setup form submission
    document.getElementById('dataForm').onsubmit = handleFormSubmit;
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const config = masterConfigs[masterType];
    const formData = {};

    config.fields.forEach(field => {
        const value = document.getElementById(field.name).value;
        if (field.name === 'password' && currentEditId && !value) {
            // Skip password if editing and field is empty
            return;
        }
        formData[field.name] = value;
    });

    try {
        showToast(currentEditId ? 'Updating...' : 'Adding...', 'info');

        if (currentEditId) {
            await apiCall(`${config.apiEndpoint}/${currentEditId}`, {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            showToast('Updated successfully!', 'success');
        } else {
            await apiCall(config.apiEndpoint, {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            showToast('Added successfully!', 'success');
        }

        closeFormModal();
        await loadData();
    } catch (error) {
        console.error('Save error:', error);
        showToast(`Failed to ${currentEditId ? 'update' : 'add'}: ${error.message || 'Unknown error'}`, 'error');
    }
}

async function deleteItem(id) {
    if (!confirm('Are you sure you want to delete this item?')) {
        showToast('Delete cancelled', 'info');
        return;
    }

    const config = masterConfigs[masterType];

    try {
        showToast('Deleting...', 'info');
        await apiCall(`${config.apiEndpoint}/${id}`, {
            method: 'DELETE'
        });
        showToast('Deleted successfully!', 'success');
        await loadData();
    } catch (error) {
        console.error('Delete error:', error);
        showToast('Failed to delete: ' + (error.message || 'Unknown error'), 'error');
    }
}

function closeFormModal() {
    document.getElementById('formModal').classList.remove('active');
    document.getElementById('dataForm').reset();
}
