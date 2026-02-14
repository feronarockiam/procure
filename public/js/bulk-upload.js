/**
 * Bulk Enquiry Upload Module
 * Handles Excel/Sheets upload, parsing, validation, and enquiry creation
 */

// State management
let bulkUploadState = {
    currentFile: null,
    parsedData: [],
    validatedData: [],
    currentTab: 'excel'
};

// Initialize bulk upload functionality
function initBulkUpload() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('excelFileInput');

    // Drag and drop handlers
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });
}

// Modal control functions
function showBulkUploadModal() {
    document.getElementById('bulkUploadModal').classList.add('active');
    // Reset state
    bulkUploadState = {
        currentFile: null,
        parsedData: [],
        validatedData: [],
        currentTab: 'excel'
    };
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('excelFileInput').value = '';
    document.getElementById('sheetsLinkInput').value = '';
}

function closeBulkUploadModal() {
    document.getElementById('bulkUploadModal').classList.remove('active');
}

function closeReviewModal() {
    document.getElementById('reviewBulkModal').classList.remove('active');
}

function switchBulkTab(tab) {
    bulkUploadState.currentTab = tab;

    // Update tab buttons
    document.querySelectorAll('.bulk-tab').forEach(btn => {
        if (btn.dataset.tab === tab) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update tab content
    document.querySelectorAll('.bulk-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tab + 'Tab').classList.add('active');
}

// File handling
function handleFileSelect(file) {
    const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'application/vnd.ms-excel', // .xls
        'text/csv'
    ];

    if (!validTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/i)) {
        showToast('Invalid file type. Please upload .xlsx, .xls, or .csv file', 'error');
        return;
    }

    bulkUploadState.currentFile = file;
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileInfo').style.display = 'block';
}

// Main processing flow
async function processBulkUpload() {
    if (bulkUploadState.currentTab === 'excel') {
        if (!bulkUploadState.currentFile) {
            showToast('Please select a file to upload', 'error');
            return;
        }
        await processExcelFile();
    } else {
        const sheetsLink = document.getElementById('sheetsLinkInput').value.trim();
        if (!sheetsLink) {
            showToast('Please enter a Google Sheets URL', 'error');
            return;
        }
        await processSheetsLink(sheetsLink);
    }
}

// Excel parsing
async function processExcelFile() {
    closeBulkUploadModal();
    showProcessingModal();

    try {
        updateProgress(20, 'Reading file...');

        const data = await readExcelFile(bulkUploadState.currentFile);

        updateProgress(40, 'Validating data...');
        await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for UX

        const validated = await validateBulkData(data);

        updateProgress(60, 'Matching products...');
        await new Promise(resolve => setTimeout(resolve, 500));

        const matched = await matchProducts(validated);

        updateProgress(80, 'Preparing preview...');
        bulkUploadState.validatedData = matched;

        await new Promise(resolve => setTimeout(resolve, 500));
        updateProgress(100, 'Complete!');

        await new Promise(resolve => setTimeout(resolve, 300));

        closeProcessingModal();
        showReviewModal(matched);

    } catch (error) {
        console.error('Error processing file:', error);
        closeProcessingModal();
        showToast('Error processing file: ' + error.message, 'error');
    }
}

// Read Excel file using SheetJS
function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(firstSheet);

                if (rows.length === 0) {
                    reject(new Error('Excel file is empty'));
                    return;
                }

                resolve(rows);
            } catch (error) {
                reject(new Error('Failed to parse Excel file'));
            }
        };

        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

// Validate bulk data
async function validateBulkData(rows) {
    const validated = [];
    const requiredFields = ['EnquiryCustomer', 'Material Name', 'Qty'];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const validatedRow = {
            rowIndex: i,
            customer: null,
            materialName: null,
            quantity: null,
            assignee: null,
            errors: []
        };

        // Check required fields
        if (!row['EnquiryCustomer'] || !row['EnquiryCustomer'].toString().trim()) {
            validatedRow.errors.push('Customer is required');
        } else {
            validatedRow.customer = row['EnquiryCustomer'].toString().trim();
        }

        if (!row['Material Name'] || !row['Material Name'].toString().trim()) {
            validatedRow.errors.push('Material Name is required');
        } else {
            validatedRow.materialName = row['Material Name'].toString().trim();
        }

        if (!row['Qty'] || isNaN(parseFloat(row['Qty'])) || parseFloat(row['Qty']) <= 0) {
            validatedRow.errors.push('Valid quantity is required');
        } else {
            validatedRow.quantity = parseFloat(row['Qty']);
        }

        // Optional assignee
        if (row['Sourcing Assignee'] && row['Sourcing Assignee'].toString().trim()) {
            validatedRow.assignee = row['Sourcing Assignee'].toString().trim();
        }

        validated.push(validatedRow);
    }

    return validated;
}

// Match products using fuzzy matching
async function matchProducts(validated) {
    try {
        // Fetch all products from backend
        const products = await apiCall('/products');

        const matched = validated.map(row => {
            if (row.errors.length > 0 || !row.materialName) {
                return { ...row, productMatch: null, matchType: 'none', suggestions: [] };
            }

            // If exact match found, we still want to find suggestions for the dropdown
            let exactMatch = products.find(p =>
                p.materialName.toLowerCase() === row.materialName.toLowerCase()
            );

            // Calculate fuzzy matches for everyone to populate suggestions
            const fuzzyMatches = products.map(p => ({
                product: p,
                similarity: calculateSimilarity(row.materialName.toLowerCase(), p.materialName.toLowerCase())
            })).sort((a, b) => b.similarity - a.similarity);

            const bestMatch = fuzzyMatches[0];
            const topSuggestions = fuzzyMatches.slice(0, 5); // Top 5 suggestions

            if (exactMatch) {
                return {
                    ...row,
                    productMatch: exactMatch,
                    matchType: 'exact',
                    confidence: 1.0,
                    suggestions: topSuggestions.filter(s => s.product._id !== exactMatch._id), // Exclude the exact match itself
                    allProducts: products
                };
            }

            if (bestMatch.similarity > 0.5) {  // Lowered from 0.7 to 0.5
                // Good fuzzy match
                return {
                    ...row,
                    productMatch: bestMatch.product,
                    matchType: 'fuzzy',
                    confidence: bestMatch.similarity,
                    suggestions: topSuggestions.slice(1), // Exclude the best match
                    allProducts: products
                };
            } else {
                // No good match, show all products in dropdown with + New option
                return {
                    ...row,
                    productMatch: null,
                    matchType: 'none',
                    confidence: 0,
                    suggestions: products.slice(0, 10), // Show first 10 products
                    allProducts: products // Pass all products for dropdown
                };
            }
        });

        return matched;
    } catch (error) {
        console.error('Error matching products:', error);
        throw new Error('Failed to match products');
    }
}

// Simple string similarity (Levenshtein-based approximation)
function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

// Processing modal functions
function showProcessingModal() {
    document.getElementById('processingModal').classList.add('active');
    updateProgress(0, 'Starting...');
}

function closeProcessingModal() {
    document.getElementById('processingModal').classList.remove('active');
}

function updateProgress(percent, stage) {
    document.getElementById('progressBar').style.width = percent + '%';
    document.getElementById('progressPercent').textContent = percent + '%';
    document.getElementById('processingStage').textContent = stage;
}

// Show review modal with validated data
function showReviewModal(data) {
    const modal = document.getElementById('reviewBulkModal');
    const reviewContent = document.getElementById('reviewContent');
    const enquiryCount = document.getElementById('enquiryCount');
    const createCount = document.getElementById('createCount');

    // Group by customer to create enquiries
    const enquiriesByCustomer = {};

    data.forEach(row => {
        if (row.errors.length === 0 && row.customer) {
            if (!enquiriesByCustomer[row.customer]) {
                enquiriesByCustomer[row.customer] = [];
            }
            enquiriesByCustomer[row.customer].push(row);
        }
    });

    const enquiryArray = Object.entries(enquiriesByCustomer).map(([customer, items]) => ({
        customer,
        items
    }));

    enquiryCount.textContent = enquiryArray.length;
    createCount.textContent = enquiryArray.length;

    // Build review HTML
    let html = '';

    if (enquiryArray.length === 0) {
        html = `
            <div class="alert alert-warning">
                <i class="ph ph-warning"></i>
                <span>No valid enquiries found. Please check your file and try again.</span>
            </div>
        `;
    } else {
        enquiryArray.forEach((enq, index) => {
            html += renderEnquiryCard(enq, index);
        });
    }

    reviewContent.innerHTML = html;
    modal.classList.add('active');
}

// Render single enquiry card for review
function renderEnquiryCard(enquiry, index) {
    return `
        <div class="review-enquiry-card" data-index="${index}">
            <div class="review-enquiry-header">
                <div>
                    <h4><i class="ph ph-file-text"></i> Enquiry Preview #${index + 1}</h4>
                    <p class="text-muted"><i class="ph ph-user"></i> Customer: <strong>${enquiry.customer}</strong></p>
                </div>
                <button class="btn btn-sm btn-secondary" onclick="removeEnquiry(${index})">
                    <i class="ph ph-trash"></i> Remove
                </button>
            </div>

            <table class="review-items-table">
                <thead>
                    <tr>
                        <th>Material Name</th>
                        <th>Matched Product</th>
                        <th>Quantity</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${enquiry.items.map((item, itemIndex) => renderItemRow(item, index, itemIndex)).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// Render individual item row
function renderItemRow(item, enqIndex, itemIndex) {
    let matchBadge = '';
    let matchedProductHtml = '';

    if (item.matchType === 'exact') {
        matchBadge = '<span class="match-status-badge match-exact"><i class="ph ph-check-circle"></i> Exact Match</span>';
    } else if (item.matchType === 'fuzzy') {
        matchBadge = `<span class="match-status-badge match-fuzzy"><i class="ph ph-warning"></i> Suggested (${Math.round(item.confidence * 100)}%)</span>`;
    } else {
        matchBadge = '<span class="match-status-badge match-none"><i class="ph ph-x-circle"></i> Not Found</span>';
    }

    // Always show dropdown for ALL match types
    // Get all products from the item (passed from matchProducts)
    const allProducts = item.allProducts || [];
    // If we have a match, put it first. If not, default select "Select Product"
    const selectedId = item.productMatch ? item.productMatch._id : "";

    matchedProductHtml = `
        <div class="product-suggestion">
            <select 
                class="form-select"
                style="width: 100%; max-width: 300px;"
                onchange="handleProductSelection(${enqIndex}, ${itemIndex}, this.value, this)" 
                data-uploaded-name="${item.materialName}"
                data-enq-index="${enqIndex}"
                data-item-index="${itemIndex}">
                
                <option value="" ${!selectedId ? 'selected' : ''}>-- Select Product --</option>
                <option value="__NEW_PRODUCT__" style="font-weight: bold; color: var(--primary);">+ New Product</option>
                
                <optgroup label="Best Matches">
                    ${item.productMatch ? `<option value="${item.productMatch._id}" selected>✓ ${item.productMatch.materialName} (${Math.round(item.confidence * 100)}% match)</option>` : ''}
                    ${(item.suggestions || []).map(s => `
                        <option value="${s.product._id}">${s.product.materialName} (${Math.round(s.similarity * 100)}% match)</option>
                    `).join('')}
                </optgroup>

                <optgroup label="Other Products">
                    ${allProducts.slice(0, 20).map(p => { // Limit to 20 to avoid huge DOM
        // Avoid duplicating what's already in suggestions or selected
        const isSelected = item.productMatch && item.productMatch._id === p._id;
        const isSuggested = (item.suggestions || []).some(s => s.product._id === p._id);
        if (isSelected || isSuggested) return '';

        return `<option value="${p._id}">${p.materialName}</option>`;
    }).join('')}
                </optgroup>
            </select>
            ${item.productMatch ? `<div class="text-muted mt-1" style="font-size: 0.75rem;">Selected: ${item.productMatch.materialName} (${item.productMatch.uom})</div>` : ''}
        </div>
    `;

    return `
        <tr>
            <td>${item.materialName}</td>
            <td>${matchedProductHtml}</td>
            <td>${item.quantity}</td>
            <td>${matchBadge}</td>
        </tr>
    `;
}


// Handle product selection from dropdown (including + New Product)
let currentSelectElement = null; // Store reference to current select element

function handleProductSelection(enqIndex, itemIndex, productId, selectElement) {
    currentSelectElement = selectElement; // Store for later use

    if (productId === '__NEW_PRODUCT__') {
        // Show inline product creation modal
        const uploadedName = selectElement.dataset.uploadedName || '';
        showNewProductModal(enqIndex, itemIndex, uploadedName);
    } else {
        // Regular product selection
        updateProductMatch(enqIndex, itemIndex, productId);
    }
}

// Show new product creation modal
function showNewProductModal(enqIndex, itemIndex, suggestedName) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'newProductModal';
    modal.style.zIndex = '10000'; // Above review modal

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
                <h3 class="modal-title"><i class="ph ph-plus-circle"></i> Create New Product</h3>
                <button class="close-btn" onclick="closeNewProductModal()">&times;</button>
            </div>
            
            <div style="padding: 1.5rem;">
                <div class="mb-3">
                    <label for="bulkNewProductName">Product Name *</label>
                    <input type="text" id="bulkNewProductName" value="${suggestedName}" placeholder="Enter product name" required autofocus>
                </div>
                
                <div class="mb-3">
                    <label for="bulkNewProductUOM">Unit of Measurement (UOM) *</label>
                    <select id="bulkNewProductUOM" required>
                        <option value="">-- Select UOM --</option>
                        <option value="Pieces">Pieces</option>
                        <option value="Kg">Kg</option>
                        <option value="Tons">Tons</option>
                        <option value="Meters">Meters</option>
                        <option value="Liters">Liters</option>
                        <option value="Bags">Bags</option>
                        <option value="Square Meters">Square Meters</option>
                        <option value="Cubic Feet">Cubic Feet</option>
                        <option value="Box">Box</option>
                    </select>
                </div>

                <div class="mb-3">
                    <label for="bulkNewProductBrand">Brand</label>
                    <input type="text" id="bulkNewProductBrand" value="Generic" placeholder="Enter brand">
                </div>

                <div class="mb-3">
                    <label for="bulkNewProductSpec">Specification</label>
                    <input type="text" id="bulkNewProductSpec" value="As required" placeholder="Enter specification">
                </div>
                
                <div class="alert alert-info">
                    <i class="ph ph-info"></i>
                    <span>This product will be created and automatically selected for this item.</span>
                </div>
            </div>
            
            <div class="flex gap-2" style="padding: 0 1.5rem 1.5rem;">
                <button class="btn btn-secondary" onclick="closeNewProductModal()">Cancel</button>
                <button class="btn btn-primary" onclick="createNewProduct(${enqIndex}, ${itemIndex})">
                    <i class="ph ph-check"></i> Create Product
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Focus on product name input
    setTimeout(() => {
        document.getElementById('bulkNewProductName').focus();
    }, 100);
}

// Close new product modal
function closeNewProductModal() {
    const modal = document.getElementById('newProductModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}

// Create new product via API
async function createNewProduct(enqIndex, itemIndex) {
    const productName = document.getElementById('bulkNewProductName').value.trim();
    const uom = document.getElementById('bulkNewProductUOM').value;
    const brand = document.getElementById('bulkNewProductBrand').value || 'Generic';
    const specification = document.getElementById('bulkNewProductSpec').value || 'As required';

    if (!productName) {
        showToast('Please enter product name', 'error');
        return;
    }

    if (!uom) {
        showToast('Please select UOM', 'error');
        return;
    }

    try {
        showToast('Creating product...', 'info');

        const response = await fetch('/api/products', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({
                materialName: productName,
                uom: uom,
                brand: brand,
                specification: specification,
                description: `Created via bulk upload`
            })
        });

        const newProduct = await response.json();

        if (response.ok) {
            showToast('✓ Product created successfully!', 'success');

            // Close the modal
            closeNewProductModal();

            // Use the stored select element reference
            if (currentSelectElement) {
                const newOption = document.createElement('option');
                newOption.value = newProduct._id;
                newOption.textContent = `${newProduct.materialName} (${newProduct.uom})`;
                newOption.selected = true;

                // Find the index of "+ New Product" option
                const options = Array.from(currentSelectElement.options);
                const newProductOptionIndex = options.findIndex(opt => opt.value === '__NEW_PRODUCT__');

                if (newProductOptionIndex !== -1) {
                    // Insert before "+ New Product" option
                    currentSelectElement.insertBefore(newOption, currentSelectElement.options[newProductOptionIndex]);
                } else {
                    // Just append if not found
                    currentSelectElement.appendChild(newOption);
                }

                // Trigger change event to update state
                currentSelectElement.dispatchEvent(new Event('change'));

                console.log('✓ Product added to dropdown and selected:', newProduct.materialName);
            }

            // Update the state
            updateProductMatch(enqIndex, itemIndex, newProduct._id);

        } else {
            throw new Error(newProduct.error || 'Failed to create product');
        }

    } catch (error) {
        console.error('Error creating product:', error);
        showToast('Failed to create product: ' + error.message, 'error');
    }
}

// Update product match when user selects alternative
function updateProductMatch(enqIndex, itemIndex, productId) {
    // Find the selected product and update the state
    // This would need to update bulkUploadState.validatedData
    console.log('Update product match:', enqIndex, itemIndex, productId);
    showToast('Product selection updated', 'success');
}

// Remove enquiry from review
function removeEnquiry(index) {
    const card = document.querySelector(`[data-index="${index}"]`);
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95)';

    setTimeout(() => {
        card.remove();
        updateEnquiryCount();
    }, 300);
}

function updateEnquiryCount() {
    const remaining = document.querySelectorAll('.review-enquiry-card').length;
    document.getElementById('enquiryCount').textContent = remaining;
    document.getElementById('createCount').textContent = remaining;
}

// Confirm and create bulk enquiries
async function confirmBulkCreate() {
    const cards = document.querySelectorAll('.review-enquiry-card');

    if (cards.length === 0) {
        showToast('No enquiries to create', 'error');
        return;
    }

    try {
        showToast('Creating enquiries...', 'info');

        // Build enquiry data from the validated state
        const enquiryData = [];

        // Group by customer from the review cards
        cards.forEach((card, index) => {
            const customerName = card.querySelector('h4 + p strong').textContent.trim();
            const rows = card.querySelectorAll('.review-items-table tbody tr');

            const items = [];
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                const materialName = cells[0].textContent.trim();
                const quantity = parseFloat(cells[2].textContent.trim());

                // Get selected product ID from dropdown
                const select = cells[1].querySelector('select');
                let productId = null;

                if (select) {
                    productId = select.value;
                } else {
                    // For exact matches, get the product ID from validated data
                    // Find the matching item in validatedData
                    const matchedItem = bulkUploadState.validatedData.find(
                        item => item.customer === customerName && item.materialName === materialName
                    );
                    if (matchedItem && matchedItem.productMatch) {
                        productId = matchedItem.productMatch._id;
                    }
                }

                if (productId && productId !== '__NEW_PRODUCT__' && productId !== '') {
                    items.push({
                        productId,
                        quantity
                    });
                }
            });

            if (items.length > 0) {
                enquiryData.push({
                    customerName,
                    items
                });
            }
        });

        if (enquiryData.length === 0) {
            showToast('No valid items to create', 'error');
            return;
        }

        // Call backend API
        const currentUser = getUser(); // Get logged-in user

        const response = await fetch('/api/enquiries/bulk/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({
                enquiries: enquiryData,
                userId: currentUser?._id || currentUser?.id // Send user ID
            })
        });

        const result = await response.json();

        if (response.ok) {
            closeReviewModal();

            const { created, failed, summary } = result;

            if (failed && failed.length > 0) {
                showToast(`Created ${summary.successful} enquiries. ${summary.failed} failed.`, 'warning');
                console.warn('Failed enquiries:', failed);
            } else {
                showToast(`✓ Successfully created ${summary.successful} enquiries!`, 'success');
            }

            // Refresh the sales dashboard
            if (typeof loadData === 'function') {
                loadData();
            } else {
                // Fallback: reload page
                setTimeout(() => location.reload(), 1000);
            }
        } else {
            throw new Error(result.error || 'Failed to create enquiries');
        }

    } catch (error) {
        console.error('Error creating enquiries:', error);
        showToast('Failed to create enquiries: ' + error.message, 'error');
    }
}

// Download template
function downloadTemplate() {
    const template = [
        ['EnquiryCustomer', 'Material Name', 'Qty', 'Sourcing Assignee'],
        ['ABC Corporation', 'Steel Rod 10mm', '100', 'John Doe'],
        ['XYZ Ltd', 'Cement Bag 50kg', '500', ''],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(template);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Bulk_Enquiry_Template.xlsx');
}

// Google Sheets processing
async function processSheetsLink(url) {
    try {
        // Convert Google Sheets URL to export format
        let exportUrl = url;

        // Handle different Google Sheets URL formats
        if (url.includes('/edit')) {
            // Format: https://docs.google.com/spreadsheets/d/{id}/edit#gid=0
            exportUrl = url.replace('/edit', '/export?format=xlsx').split('#')[0];
        } else if (url.includes('spreadsheets/d/')) {
            // Format: https://docs.google.com/spreadsheets/d/{id}
            exportUrl = url + '/export?format=xlsx';
        } else {
            throw new Error('Invalid Google Sheets URL format');
        }

        showToast('Fetching Google Sheet...', 'info');

        // Fetch the sheet as Excel (XLSX)
        const response = await fetch(exportUrl);

        if (!response.ok) {
            throw new Error('Failed to fetch Google Sheet. Make sure the sheet is shared publicly or via link.');
        }

        const blob = await response.blob();

        // Convert blob to file and process like Excel
        const file = new File([blob], 'google-sheet.xlsx', {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        bulkUploadState.currentFile = file;

        // Process as Excel file
        closeBulkUploadModal();
        showProcessingModal();

        try {
            updateProgress(20, 'Reading Google Sheet...');

            const data = await readExcelFile(bulkUploadState.currentFile);

            updateProgress(40, 'Validating data...');
            await new Promise(resolve => setTimeout(resolve, 500));

            const validated = await validateBulkData(data);

            updateProgress(60, 'Matching products...');
            await new Promise(resolve => setTimeout(resolve, 500));

            const matched = await matchProducts(validated);

            updateProgress(80, 'Preparing preview...');
            bulkUploadState.validatedData = matched;

            await new Promise(resolve => setTimeout(resolve, 500));
            updateProgress(100, 'Complete!');

            await new Promise(resolve => setTimeout(resolve, 300));

            closeProcessingModal();
            showReviewModal(matched);

        } catch (error) {
            console.error('Error processing Google Sheet:', error);
            closeProcessingModal();
            showToast('Error processing Google Sheet: ' + error.message, 'error');
        }

    } catch (error) {
        console.error('Error fetching Google Sheet:', error);
        showToast(error.message, 'error');
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    if (typeof XLSX !== 'undefined') {
        initBulkUpload();
    }
});
