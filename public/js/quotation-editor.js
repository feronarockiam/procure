// ========================================
// WYSIWYG Quotation Editor
// Visual PDF-like template with inline editing
// ========================================

let currentQuotationData = null;

// Company defaults
const companyDefaults = {
    name: 'Precise Procure Private Limited',
    address1: 'Plot 4,5 Part, ICL Home town,',
    address2: 'Noombal,',
    address3: 'Chennai, Tamil Nadu 600077',
    cin: 'CIN U47613TN2025PTC178631',
    pan: 'PAN AAPCP5955M',
    gstin: 'GSTIN 33AAPCP5955M1ZO',
    msme: 'MSME/Udyam No UDYAM-TN-24-0147341'
};

// Default terms & conditions
const defaultTerms = [
    '1. Forwarding Charges - Including',
    '2. GST Charges - Extra at Actuals (18%)',
    '3. Terms of Payment - 30 days from the date of Invoice',
    '4. Validity - Valid for 7 days and thereafter subject to our confirmation'
];

// Open WYSIWYG quotation editor
async function openQuotationEditor(enquiryId, targetItemIds = null) {
    try {
        const enquiry = enquiries.find(e => e._id === enquiryId);
        if (!enquiry) {
            showToast('Enquiry not found', 'error');
            return;
        }

        // Determine which items to process
        let itemsToProcess = enquiry.items;
        if (targetItemIds && targetItemIds.length > 0) {
            itemsToProcess = enquiry.items.filter(item => targetItemIds.includes(item._id));
        }

        // Check all items have sales price
        const itemsWithoutPrice = itemsToProcess.filter(item => !item.salesPrice);
        if (itemsWithoutPrice.length > 0) {
            showToast('Please set sales price for all items before generating quotation', 'error');
            return;
        }

        // Prepare quotation data
        currentQuotationData = {
            enquiry: enquiry,
            items: itemsToProcess.map(item => ({
                description: item.productId?.materialName || '',
                specification: item.productId?.specification || 'Standard',
                hsnCode: item.productId?.hsnCode || '',
                quantity: item.quantity || 1,
                rate: item.salesPrice || 0,
                gstRate: item.productId?.gstRate || 18
            })),
            company: { ...companyDefaults },
            quote: {
                number: enquiry.enquiryNumber,
                date: new Date().toISOString().split('T')[0],
                reference: enquiry.enquiryNumber,
                placeOfSupply: enquiry.customerId?.state || 'Tamil Nadu'
            },
            customer: {
                billToName: enquiry.customerId?.name || '',
                billToAddress: enquiry.customerId?.address || '',
                shipToName: enquiry.customerId?.name || '',
                shipToAddress: enquiry.customerId?.address || ''
            },
            notes: 'Looking forward for your business.',
            terms: defaultTerms.join('\n')
        };

        // Render the WYSIWYG editor
        renderWYSIWYGEditor();

        // Show modal
        document.getElementById('downloadQuotationModal').classList.add('active');
    } catch (error) {
        console.error('Error opening quotation editor:', error);
        showToast('Failed to open quotation editor', 'error');
    }
}

// Render the WYSIWYG PDF-like template
function renderWYSIWYGEditor() {
    const data = currentQuotationData;

    // Calculate totals
    const calculations = calculateTotals(data.items);

    const html = `
        <div class="pdf-preview-container">
            <!-- Header Section -->
            <div class="pdf-header">
                <div class="pdf-header-left">
                    <div class="company-logo">
                        <img src="/images/logo.png" alt="Logo" onerror="this.style.display='none'">
                    </div>
                    <div class="company-details">
                        <div class="company-name">${data.company.name}</div>
                        <div class="company-info">${data.company.address1}</div>
                        <div class="company-info">${data.company.address2}</div>
                        <div class="company-info">${data.company.address3}</div>
                        <div class="company-info">${data.company.cin}</div>
                        <div class="company-info">${data.company.pan}</div>
                        <div class="company-info">${data.company.gstin}</div>
                        <div class="company-info">${data.company.msme}</div>
                    </div>
                </div>
                <div class="pdf-header-right">
                    <div class="quotation-title">QUOTATION</div>
                </div>
            </div>

            <!-- Quote Details Bar -->
            <div class="pdf-quote-bar">
                <div class="quote-bar-left">
                    <div class="quote-field">
                        <span class="quote-label">Quote#:</span>
                        <span class="quote-value">PP/QT/${data.quote.number}</span>
                    </div>
                    <div class="quote-field">
                        <span class="quote-label">Quote Date:</span>
                        <input type="date" class="quote-date-input" value="${data.quote.date}" onchange="updateQuoteDate(this.value)">
                    </div>
                    <div class="quote-field">
                        <span class="quote-label">Reference#:</span>
                        <span class="quote-value editable" contenteditable="true" data-field="reference">${data.quote.reference}</span>
                    </div>
                </div>
                <div class="quote-bar-right">
                    <div class="quote-field">
                        <span class="quote-label">Place Of Supply:</span>
                        <span class="quote-value editable" contenteditable="true" data-field="placeOfSupply">${data.quote.placeOfSupply}</span>
                    </div>
                </div>
            </div>

            <!-- Customer Section -->
            <div class="pdf-customer-section">
                <div class="customer-column">
                    <div class="customer-header">Bill To</div>
                    <div class="customer-content">
                        <div class="customer-name editable" contenteditable="true" data-field="billToName">${data.customer.billToName}</div>
                        <textarea class="customer-address" data-field="billToAddress" rows="3">${data.customer.billToAddress}</textarea>
                    </div>
                </div>
                <div class="customer-column">
                    <div class="customer-header">Ship To</div>
                    <div class="customer-content">
                        <div class="customer-name editable" contenteditable="true" data-field="shipToName">${data.customer.shipToName}</div>
                        <textarea class="customer-address" data-field="shipToAddress" rows="3">${data.customer.shipToAddress}</textarea>
                    </div>
                </div>
            </div>

            <!-- Items Table -->
            <div class="pdf-items-table">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 30px;">#</th>
                            <th style="width: 200px;">Description of Goods</th>
                            <th style="width: 120px;">Specification</th>
                            <th style="width: 80px;">HSN/SAC</th>
                            <th style="width: 60px;">Qty</th>
                            <th style="width: 80px;">Rate</th>
                            <th style="width: 60px;">GST%</th>
                            <th style="width: 100px;">Amount</th>
                            <th style="width: 40px;"></th>
                        </tr>
                    </thead>
                    <tbody id="wysiwyg-items-body">
                        ${renderItemRows(data.items)}
                    </tbody>
                </table>
                <button class="add-item-btn" onclick="addNewItemRow()">
                    <i class="ph ph-plus"></i> Add Item
                </button>
            </div>

            <!-- Footer Section -->
            <div class="pdf-footer">
                <div class="footer-left">
                    <div class="footer-section">
                        <div class="footer-title">Total In Words</div>
                        <div class="footer-value" id="amountInWords">${numberToWords(Math.round(calculations.grandTotal))}</div>
                    </div>
                    <div class="footer-section">
                        <div class="footer-title">Notes</div>
                        <textarea class="footer-textarea" data-field="notes" rows="2">${data.notes}</textarea>
                    </div>
                    <div class="footer-section">
                        <div class="footer-title">Terms & Conditions</div>
                        <textarea class="footer-textarea" data-field="terms" rows="4">${data.terms}</textarea>
                    </div>
                </div>
                <div class="footer-right">
                    <div class="summary-table">
                        <div class="summary-row">
                            <span>Sub Total</span>
                            <span id="summary-subtotal">${formatCurrency(calculations.subTotal)}</span>
                        </div>
                        <div class="summary-row">
                            <span>Total Taxable Amount</span>
                            <span id="summary-taxable">${formatCurrency(calculations.subTotal)}</span>
                        </div>
                        <div class="summary-row">
                            <span>IGST (18%)</span>
                            <span id="summary-gst">${formatCurrency(calculations.totalGST)}</span>
                        </div>
                        <div class="summary-row summary-total">
                            <span>Total</span>
                            <span id="summary-grand">Rs.${formatCurrency(calculations.grandTotal)}</span>
                        </div>
                    </div>
                    <div class="signature-section">
                        <div class="signature-company">For ${data.company.name}</div>
                        <div class="signature-image">
                            <img src="/images/signature.png" alt="Signature" onerror="this.style.display='none'">
                        </div>
                        <div class="signature-text">Authorized Signature</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.querySelector('#downloadQuotationModal .modal-body').innerHTML = html;

    // Attach event listeners
    attachEventListeners();
}

// Render item rows
function renderItemRows(items) {
    return items.map((item, index) => `
        <tr data-index="${index}">
            <td>${index + 1}</td>
            <td>
                <div class="editable" contenteditable="true" data-field="description" data-index="${index}">${item.description}</div>
            </td>
            <td>
                <div class="editable" contenteditable="true" data-field="specification" data-index="${index}">${item.specification}</div>
            </td>
            <td>
                <div class="editable" contenteditable="true" data-field="hsnCode" data-index="${index}">${item.hsnCode}</div>
            </td>
            <td>
                <input type="number" class="item-input" data-field="quantity" data-index="${index}" value="${item.quantity}" min="0" step="0.01">
            </td>
            <td>
                <input type="number" class="item-input" data-field="rate" data-index="${index}" value="${item.rate}" min="0" step="0.01">
            </td>
            <td>
                <input type="number" class="item-input" data-field="gstRate" data-index="${index}" value="${item.gstRate}" min="0" max="100" step="0.01">
            </td>
            <td class="item-amount" data-index="${index}">
                ${formatCurrency((item.quantity * item.rate) + (item.quantity * item.rate * item.gstRate / 100))}
            </td>
            <td>
                <button class="delete-item-btn" onclick="deleteItemRow(${index})" title="Delete">
                    <i class="ph ph-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// Attach event listeners
function attachEventListeners() {
    // Item inputs - recalculate on change
    document.querySelectorAll('.item-input').forEach(input => {
        input.addEventListener('input', () => {
            updateItemFromInput(input);
            recalculateTotals();
        });
    });

    // Contenteditable fields - update data on blur
    document.querySelectorAll('[contenteditable="true"]').forEach(el => {
        el.addEventListener('blur', () => {
            updateDataFromContentEditable(el);
        });
    });

    // Textareas - update data on input
    document.querySelectorAll('textarea').forEach(textarea => {
        textarea.addEventListener('input', () => {
            updateDataFromTextarea(textarea);
        });
    });
}

// Update item from input
function updateItemFromInput(input) {
    const index = parseInt(input.dataset.index);
    const field = input.dataset.field;
    const value = parseFloat(input.value) || 0;

    currentQuotationData.items[index][field] = value;
}

// Update data from contenteditable
function updateDataFromContentEditable(el) {
    const field = el.dataset.field;
    const value = el.textContent.trim();

    if (field === 'reference') {
        currentQuotationData.quote.reference = value;
    } else if (field === 'placeOfSupply') {
        currentQuotationData.quote.placeOfSupply = value;
    } else if (field === 'billToName') {
        currentQuotationData.customer.billToName = value;
    } else if (field === 'shipToName') {
        currentQuotationData.customer.shipToName = value;
    } else if (field === 'description' || field === 'specification' || field === 'hsnCode') {
        const index = parseInt(el.dataset.index);
        currentQuotationData.items[index][field] = value;
    }
}

// Update data from textarea
function updateDataFromTextarea(textarea) {
    const field = textarea.dataset.field;
    const value = textarea.value;

    if (field === 'billToAddress') {
        currentQuotationData.customer.billToAddress = value;
    } else if (field === 'shipToAddress') {
        currentQuotationData.customer.shipToAddress = value;
    } else if (field === 'notes') {
        currentQuotationData.notes = value;
    } else if (field === 'terms') {
        currentQuotationData.terms = value;
    }
}

// Update quote date
function updateQuoteDate(value) {
    currentQuotationData.quote.date = value;
}

// Calculate totals
function calculateTotals(items) {
    let subTotal = 0;
    let totalGST = 0;

    items.forEach(item => {
        const itemAmount = item.quantity * item.rate;
        const itemGST = itemAmount * (item.gstRate / 100);
        subTotal += itemAmount;
        totalGST += itemGST;
    });

    return {
        subTotal,
        totalGST,
        grandTotal: subTotal + totalGST
    };
}

// Recalculate and update totals
function recalculateTotals() {
    const calculations = calculateTotals(currentQuotationData.items);

    // Update item amounts
    currentQuotationData.items.forEach((item, index) => {
        const itemTotal = (item.quantity * item.rate) + (item.quantity * item.rate * item.gstRate / 100);
        const amountCell = document.querySelector(`.item-amount[data-index="${index}"]`);
        if (amountCell) {
            amountCell.textContent = formatCurrency(itemTotal);
        }
    });

    // Update summary
    document.getElementById('summary-subtotal').textContent = formatCurrency(calculations.subTotal);
    document.getElementById('summary-taxable').textContent = formatCurrency(calculations.subTotal);
    document.getElementById('summary-gst').textContent = formatCurrency(calculations.totalGST);
    document.getElementById('summary-grand').textContent = 'Rs.' + formatCurrency(calculations.grandTotal);
    document.getElementById('amountInWords').textContent = numberToWords(Math.round(calculations.grandTotal));
}

// Add new item row
function addNewItemRow() {
    const newItem = {
        description: 'New Item',
        specification: 'Standard',
        hsnCode: '',
        quantity: 1,
        rate: 0,
        gstRate: 18
    };

    currentQuotationData.items.push(newItem);

    // Re-render items
    document.getElementById('wysiwyg-items-body').innerHTML = renderItemRows(currentQuotationData.items);
    attachEventListeners();
    recalculateTotals();
}

// Delete item row
function deleteItemRow(index) {
    if (currentQuotationData.items.length === 1) {
        showToast('Cannot delete the last item', 'error');
        return;
    }

    currentQuotationData.items.splice(index, 1);

    // Re-render items
    document.getElementById('wysiwyg-items-body').innerHTML = renderItemRows(currentQuotationData.items);
    attachEventListeners();
    recalculateTotals();
}

// Number to words converter
function numberToWords(num) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    if (num === 0) return 'Zero Only';
    num = Math.floor(Math.abs(num));

    let words = 'Indian Rupee ';

    const twoDigit = (n) => {
        if (n === 0) return '';
        if (n < 10) return ones[n];
        if (n < 20) return teens[n - 10];
        const t = tens[Math.floor(n / 10)];
        const o = n % 10 > 0 ? ' ' + ones[n % 10] : '';
        return t + o;
    };

    const crores = Math.floor(num / 10000000);
    const lakhs = Math.floor((num % 10000000) / 100000);
    const thousands = Math.floor((num % 100000) / 1000);
    const hundreds = Math.floor((num % 1000) / 100);
    const rem = num % 100;

    if (crores > 0) words += twoDigit(crores) + ' Crore ';
    if (lakhs > 0) words += twoDigit(lakhs) + ' Lakh ';
    if (thousands > 0) words += twoDigit(thousands) + ' Thousand ';
    if (hundreds > 0) words += ones[hundreds] + ' Hundred ';
    if (rem > 0) words += twoDigit(rem) + ' ';

    return words.trim() + ' Only';
}

// Generate PDF from WYSIWYG editor
async function generateEditedPDF() {
    try {
        // Parse terms back to array
        const termsArray = currentQuotationData.terms.split('\n').filter(t => t.trim());

        const editedData = {
            company: currentQuotationData.company,
            quote: currentQuotationData.quote,
            customer: currentQuotationData.customer,
            items: currentQuotationData.items,
            notes: currentQuotationData.notes,
            terms: termsArray,
            signature: {
                company: `For ${currentQuotationData.company.name}`,
                text: 'Authorized Signature'
            }
        };

        if (editedData.items.length === 0) {
            showToast('Please add at least one item', 'error');
            return;
        }

        showToast('Generating PDF...', 'info');
        const pdfGenerator = new QuotationPDFGenerator();
        await pdfGenerator.generateFromEditedData(editedData);
        showToast('PDF generated successfully!', 'success');

        closeDownloadQuotationModal();
    } catch (error) {
        console.error('Error generating PDF:', error);
        showToast('Failed to generate PDF: ' + error.message, 'error');
    }
}

// Close modal
function closeDownloadQuotationModal() {
    document.getElementById('downloadQuotationModal').classList.remove('active');
    currentQuotationData = null;
}
