// PDF Quotation Generator for Precise Procure
// Template matching the company's official quotation format EXACTLY

class QuotationPDFGenerator {
    constructor() {
        this.companyDetails = {
            name: 'Precise Procure Private Limited',
            line1: 'Plot 4,5 Part, ICL Home town,',
            line2: 'Noombal,',
            line3: 'Chennai Tamil Nadu 600077',
            cin: 'CIN U47613TN2025PTC178631',
            pan: 'PAN AAPCP5955M',
            gstin: 'GSTIN 33AAPCP5955M1ZO',
            msme: 'MSME/Udyam No UDYAM-TN-24-0147341'
        };

        this.terms = [
            '1. Forwarding Charges - Including',
            '2. GST Charges - Extra at Actuals (18%)',
            '3. Terms of Payment - 30 days from the date of Invoice',
            '4. Validity - Valid for 7 days and thereafter subject to our confirmation'
        ];
    }

    async generateQuotation(enquiry, selectedQuotes) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const itemsData = this.prepareItemsData(enquiry, selectedQuotes);

        await this.addHeader(doc);
        this.addQuoteDetailsBar(doc, enquiry);
        const billToEndY = this.addBillingShippingSection(doc, enquiry);
        const itemsEndY = this.addItemsTable(doc, itemsData, billToEndY);
        await this.addFooter(doc, itemsData, itemsEndY);

        const filename = `Quotation_${enquiry.enquiryNumber}_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(filename);
    }

    // Generate PDF from edited quotation data (from quotation editor)
    async generateFromEditedData(editedData) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Temporarily override company details with edited values
        const originalCompany = { ...this.companyDetails };
        this.companyDetails = {
            name: editedData.company.name,
            line1: editedData.company.address1,
            line2: editedData.company.address2,
            line3: editedData.company.address3,
            cin: editedData.company.cin,
            pan: editedData.company.pan,
            gstin: editedData.company.gstin,
            msme: editedData.company.msme
        };

        // Override terms
        const originalTerms = [...this.terms];
        this.terms = editedData.terms;

        // Create mock enquiry object for compatibility
        const mockEnquiry = {
            enquiryNumber: editedData.quote.number,
            customerId: {
                name: editedData.customer.billToName,
                address: editedData.customer.billToAddress,
                state: editedData.quote.placeOfSupply
            }
        };

        // Prepare items data from edited format
        const itemsData = editedData.items.map(item => ({
            description: item.description,
            specification: item.specification,
            hsnCode: item.hsnCode,
            qty: item.quantity,
            unitPrice: item.rate,
            gstRate: item.gstRate,
            amount: item.quantity * item.rate
        }));

        // Generate PDF sections
        await this.addHeader(doc);
        this.addQuoteDetailsBarEdited(doc, editedData.quote);
        const billToEndY = this.addBillingShippingSectionEdited(doc, editedData.customer);
        const itemsEndY = this.addItemsTable(doc, itemsData, billToEndY);
        await this.addFooterEdited(doc, itemsData, itemsEndY, editedData);

        // Restore original values
        this.companyDetails = originalCompany;
        this.terms = originalTerms;

        const filename = `Quotation_${editedData.quote.number}_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(filename);
    }

    // Quote details bar for edited data
    addQuoteDetailsBarEdited(doc, quoteData) {
        const y = 40;
        const h = 14;

        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.3);
        doc.rect(10, y, 190, h);
        doc.line(105, y, 105, y + h);

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Quote#', 12, y + 4);
        doc.text('Quote Date', 12, y + 8);
        doc.text('Reference#', 12, y + 12);

        doc.setFont('helvetica', 'normal');
        doc.text(': PP/QT/' + quoteData.number, 32, y + 4);
        doc.text(': ' + new Date(quoteData.date).toLocaleDateString('en-GB'), 32, y + 8);
        doc.text(': ' + quoteData.reference, 32, y + 12);

        doc.setFont('helvetica', 'bold');
        doc.text('Place Of Supply', 110, y + 7);
        doc.setFont('helvetica', 'normal');
        doc.text(': ' + quoteData.placeOfSupply, 140, y + 7);
    }

    // Billing/shipping for edited data
    addBillingShippingSectionEdited(doc, customerData) {
        const y = 54;
        const halfW = 95;
        const headerH = 6;
        const contentH = 30;

        // Bill To - Left side
        doc.setFillColor(240, 240, 240);
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.3);
        doc.rect(10, y, halfW, headerH, 'FD');

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Bill To', 12, y + 4);

        doc.rect(10, y + headerH, halfW, contentH);
        doc.setFont('helvetica', 'bold');
        doc.text(customerData.billToName, 12, y + headerH + 5);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        const billAddrLines = customerData.billToAddress ? doc.splitTextToSize(customerData.billToAddress, halfW - 6) : [];
        let lineY = y + headerH + 9;
        billAddrLines.forEach(line => {
            doc.text(line, 12, lineY);
            lineY += 3.5;
        });

        // Ship To - Right side
        const rx = 10 + halfW;
        doc.setFillColor(240, 240, 240);
        doc.rect(rx, y, halfW, headerH, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('Ship To', rx + 2, y + 4);

        doc.rect(rx, y + headerH, halfW, contentH);
        doc.setFont('helvetica', 'bold');
        doc.text(customerData.shipToName, rx + 2, y + headerH + 5);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        const shipAddrLines = customerData.shipToAddress ? doc.splitTextToSize(customerData.shipToAddress, halfW - 6) : [];
        let shipY = y + headerH + 9;
        shipAddrLines.forEach(line => {
            doc.text(line, rx + 2, shipY);
            shipY += 3.5;
        });

        return y + headerH + contentH;
    }

    // Footer for edited data
    async addFooterEdited(doc, itemsData, startY, editedData) {
        const L = 10;
        const W = 190;
        const footerY = startY;

        const subTotal = itemsData.reduce((s, i) => s + i.amount, 0);
        const igstTotal = itemsData.reduce((s, i) => s + (i.amount * i.gstRate) / 100, 0);
        const grandTotal = subTotal + igstTotal;

        const leftW = 120;
        const summaryX = L + leftW;
        const summaryW = W - leftW;

        // Left side - Total in words, Notes, Terms
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('Total In Words', 12, footerY + 4);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        const wordsText = this.numberToWords(Math.round(grandTotal));
        const wordsLines = doc.splitTextToSize(wordsText, leftW - 8);
        let wordsY = footerY + 7;
        wordsLines.forEach(line => {
            doc.text(line, 12, wordsY);
            wordsY += 3;
        });

        // Notes
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('Notes', 12, wordsY + 5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        const notesLines = doc.splitTextToSize(editedData.notes || '', leftW - 8);
        let notesY = wordsY + 8;
        notesLines.forEach(line => {
            doc.text(line, 12, notesY);
            notesY += 3;
        });

        // Terms & Conditions
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('Terms & Conditions', 12, notesY + 5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        let termsY = notesY + 8;
        editedData.terms.forEach(term => {
            doc.text(term, 12, termsY);
            termsY += 3.5;
        });

        // Right side - Summary table
        const summaryRowH = 6;
        let summaryY = footerY;

        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.2);

        // Sub Total row
        doc.rect(summaryX, summaryY, summaryW, summaryRowH);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text('Sub Total', summaryX + 2, summaryY + 4);
        doc.text(this.fmtNum(subTotal), summaryX + summaryW - 2, summaryY + 4, { align: 'right' });

        // Total Taxable Amount row
        summaryY += summaryRowH;
        doc.rect(summaryX, summaryY, summaryW, summaryRowH);
        doc.text('Total Taxable Amount', summaryX + 2, summaryY + 4);
        doc.text(this.fmtNum(subTotal), summaryX + summaryW - 2, summaryY + 4, { align: 'right' });

        // IGST row
        summaryY += summaryRowH;
        doc.rect(summaryX, summaryY, summaryW, summaryRowH);
        doc.text('IGST18 (18%)', summaryX + 2, summaryY + 4);
        doc.text(this.fmtNum(igstTotal), summaryX + summaryW - 2, summaryY + 4, { align: 'right' });

        // Total row
        summaryY += summaryRowH;
        doc.rect(summaryX, summaryY, summaryW, summaryRowH);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('Total', summaryX + 2, summaryY + 4);
        doc.text('Rs.' + this.fmtNum(grandTotal), summaryX + summaryW - 2, summaryY + 4, { align: 'right' });

        // Company name for signature
        summaryY += summaryRowH + 3;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text(editedData.signature.company, summaryX + 2, summaryY);

        // Signature image or placeholder
        const sigY = summaryY + 2;
        try {
            const signatureImg = await this.loadImage('/images/signature.png');
            doc.addImage(signatureImg, 'PNG', summaryX + 8, sigY + 2, 35, 18);
        } catch (e) {
            console.warn('Signature image not found:', e);
            doc.line(summaryX + 8, sigY + 15, summaryX + 43, sigY + 15);
        }

        // Signature text
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text(editedData.signature.text, summaryX + summaryW / 2, sigY + 22, { align: 'center' });
    }

    // ================================================================
    // HEADER: Merged box with logo, company details, and "Quote"
    // ================================================================
    async addHeader(doc) {
        const L = 10;
        const W = 190;
        const H = 30;

        // Outer border
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.4);
        doc.rect(L, 10, W, H);

        // Company Logo on left
        try {
            const logoImg = await this.loadImage('/images/logo.png');
            doc.addImage(logoImg, 'PNG', 14, 15, 25, 20);
        } catch (e) {
            console.warn('Logo not found, using text:', e);
            doc.setFontSize(18);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 120, 170);
            doc.text('PRECISE', 14, 22);
            doc.setFontSize(9);
            doc.setTextColor(0, 90, 130);
            doc.text('PROCURE', 15, 27);
        }

        // Company details - center
        const cx = 110;
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(this.companyDetails.name, cx, 14, { align: 'center' });

        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text(this.companyDetails.line1, cx, 17.5, { align: 'center' });
        doc.text(this.companyDetails.line2, cx, 20, { align: 'center' });
        doc.text(this.companyDetails.line3, cx, 22.5, { align: 'center' });
        doc.text(this.companyDetails.cin, cx, 25, { align: 'center' });
        doc.text(this.companyDetails.pan, cx, 27.5, { align: 'center' });
        doc.text(this.companyDetails.gstin, cx, 30, { align: 'center' });
        doc.text(this.companyDetails.msme, cx, 32.5, { align: 'center' });

        // "Quote" title - right
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text('Quote', 196, 34, { align: 'right' });
    }

    // ================================================================
    // QUOTE DETAILS BAR - Connected to header
    // ================================================================
    addQuoteDetailsBar(doc, enquiry) {
        const y = 40;
        const h = 14;

        // Outer box
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.3);
        doc.rect(10, y, 190, h);

        // Vertical divider at center
        doc.line(105, y, 105, y + h);

        // Left side content
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Quote#', 12, y + 4);
        doc.text('Quote Date', 12, y + 8);
        doc.text('Reference#', 12, y + 12);

        doc.setFont('helvetica', 'normal');
        const quoteNum = enquiry.enquiryNumber || '';
        doc.text(': PP/QT/' + quoteNum, 32, y + 4);
        doc.text(': ' + new Date().toLocaleDateString('en-GB'), 32, y + 8);
        doc.text(': ' + quoteNum, 32, y + 12);

        // Right side content
        doc.setFont('helvetica', 'bold');
        doc.text('Place Of Supply', 110, y + 7);
        doc.setFont('helvetica', 'normal');
        const pos = enquiry.customerId?.state || 'Tamil Nadu';
        doc.text(': ' + pos, 142, y + 7);
    }

    // ================================================================
    // BILL TO / SHIP TO - Connected to quote details
    // ================================================================
    addBillingShippingSection(doc, enquiry) {
        const y = 54;
        const halfW = 95;
        const headerH = 6;
        const contentH = 30;

        const customerName = enquiry.customerId?.name || 'N/A';
        const address = enquiry.customerId?.address || '';

        // Split address into lines
        const addrLines = address ? doc.splitTextToSize(address, halfW - 6) : [];

        // ---- Left: Bill To ----
        // Header with grey background
        doc.setFillColor(240, 240, 240);
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.3);
        doc.rect(10, y, halfW, headerH, 'FD');

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Bill To', 12, y + 4);

        // Content box
        doc.rect(10, y + headerH, halfW, contentH);

        // Customer name
        doc.setFont('helvetica', 'bold');
        doc.text(customerName, 12, y + headerH + 5);

        // Address lines
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        let lineY = y + headerH + 9;
        addrLines.forEach(line => {
            doc.text(line, 12, lineY);
            lineY += 3.5;
        });

        // ---- Right: Ship To ----
        const rx = 10 + halfW;

        // Header with grey background
        doc.setFillColor(240, 240, 240);
        doc.rect(rx, y, halfW, headerH, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('Ship To', rx + 2, y + 4);

        // Content box
        doc.rect(rx, y + headerH, halfW, contentH);

        // Customer name
        doc.setFont('helvetica', 'bold');
        doc.text(customerName, rx + 2, y + headerH + 5);

        // Address lines
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        let shipY = y + headerH + 9;
        addrLines.forEach(line => {
            doc.text(line, rx + 2, shipY);
            shipY += 3.5;
        });

        return y + headerH + contentH; // Return the end Y position
    }

    // ================================================================
    // ITEMS TABLE - Manually drawn with merged IGST header
    // ================================================================
    addItemsTable(doc, itemsData, startY) {
        const L = 10;
        const W = 190;
        const rowH = 8;
        const headerH = 6;

        // Column widths - MUST total exactly 190 to fit within boundary
        const cols = [
            { x: L, w: 8 },           // # (8)
            { x: L + 8, w: 50 },      // Item & Description (50)
            { x: L + 58, w: 20 },     // HSN/SAC (20)
            { x: L + 78, w: 15 },     // Qty (15)
            { x: L + 93, w: 20 },     // Rate (20)
            { x: L + 113, w: 12 },    // IGST % (12)
            { x: L + 125, w: 20 },    // IGST Amt (20)
            { x: L + 145, w: 45 }     // Amount (45)
        ]; // Total: 8+50+20+15+20+12+20+45 = 190 ✓

        let y = startY;

        // Draw two-row header
        doc.setFillColor(240, 240, 240);
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.2);

        // First header row
        doc.rect(cols[0].x, y, cols[0].w, headerH * 2, 'FD'); // # (rowspan 2)
        doc.rect(cols[1].x, y, cols[1].w, headerH * 2, 'FD'); // Item (rowspan 2)
        doc.rect(cols[2].x, y, cols[2].w, headerH * 2, 'FD'); // HSN (rowspan 2)
        doc.rect(cols[3].x, y, cols[3].w, headerH * 2, 'FD'); // Qty (rowspan 2)
        doc.rect(cols[4].x, y, cols[4].w, headerH * 2, 'FD'); // Rate (rowspan 2)
        doc.rect(cols[5].x, y, cols[5].w + cols[6].w, headerH, 'FD'); // IGST (colspan 2)
        doc.rect(cols[7].x, y, cols[7].w, headerH * 2, 'FD'); // Amount (rowspan 2)

        // Second header row (IGST subdivisions)
        doc.rect(cols[5].x, y + headerH, cols[5].w, headerH, 'FD'); // %
        doc.rect(cols[6].x, y + headerH, cols[6].w, headerH, 'FD'); // Amt

        // Header text
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);

        doc.text('#', cols[0].x + cols[0].w / 2, y + 7, { align: 'center' });
        doc.text('Item & Description', cols[1].x + 2, y + 7);
        doc.text('HSN/SAC', cols[2].x + cols[2].w / 2, y + 7, { align: 'center' });
        doc.text('Qty', cols[3].x + cols[3].w / 2, y + 7, { align: 'center' });
        doc.text('Rate', cols[4].x + cols[4].w / 2, y + 7, { align: 'center' });
        doc.text('IGST', cols[5].x + (cols[5].w + cols[6].w) / 2, y + 4, { align: 'center' });
        doc.text('Amount', cols[7].x + cols[7].w / 2, y + 7, { align: 'center' });

        doc.text('%', cols[5].x + cols[5].w / 2, y + headerH + 4, { align: 'center' });
        doc.text('Amt', cols[6].x + cols[6].w / 2, y + headerH + 4, { align: 'center' });

        y += headerH * 2;

        // Data rows
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);

        itemsData.forEach((item, idx) => {
            const igstAmt = (item.amount * item.gstRate) / 100;
            const totalAmt = item.amount + igstAmt;

            // Draw row borders
            cols.forEach(col => {
                doc.rect(col.x, y, col.w, rowH);
            });

            // Content
            doc.text((idx + 1).toString(), cols[0].x + cols[0].w / 2, y + 5, { align: 'center' });

            const itemText = item.description + '\n' + (item.specification || '');
            const lines = doc.splitTextToSize(itemText, cols[1].w - 2);
            doc.text(lines, cols[1].x + 1, y + 4);

            doc.text(item.hsnCode || '-', cols[2].x + cols[2].w / 2, y + 5, { align: 'center' });
            doc.text(item.qty.toFixed(2), cols[3].x + cols[3].w / 2, y + 5, { align: 'center' });
            doc.text(item.unitPrice.toFixed(2), cols[4].x + cols[4].w - 2, y + 5, { align: 'right' });
            doc.text(item.gstRate + '%', cols[5].x + cols[5].w / 2, y + 5, { align: 'center' });
            doc.text(this.fmtNum(igstAmt), cols[6].x + cols[6].w - 2, y + 5, { align: 'right' });
            doc.text(this.fmtNum(totalAmt), cols[7].x + cols[7].w - 2, y + 5, { align: 'right' });

            y += rowH;
        });

        return y;
    }

    // ================================================================
    // FOOTER: Summary table, amount in words, notes, terms, signature
    // All in one merged bordered section
    // ================================================================
    async addFooter(doc, itemsData, startY) {
        const L = 10;
        const W = 190;
        const footerY = startY; // Start immediately after items table (no gap)

        // Calculate totals
        const subTotal = itemsData.reduce((s, i) => s + i.amount, 0);
        const igstTotal = itemsData.reduce((s, i) => s + (i.amount * i.gstRate) / 100, 0);
        const grandTotal = subTotal + igstTotal;

        // Create a large bordered box for the entire footer
        const footerHeight = 80;
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.3);

        // Main footer container (optional - uncomment if you want one outer box)
        // doc.rect(L, footerY, W, footerHeight);

        // ======== LEFT SIDE: Total in Words, Notes, Terms ========
        const leftW = 115;

        // Total In Words section
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Total In Words', 12, footerY + 5);

        doc.setFont('helvetica', 'bolditalic');
        doc.setFontSize(8);
        const words = this.numberToWords(Math.round(grandTotal));
        const wordLines = doc.splitTextToSize(words, leftW - 4);
        doc.text(wordLines, 12, footerY + 9);

        // Notes section
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('Notes', 12, footerY + 20);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        doc.text('Looking forward for your business.', 12, footerY + 24);

        // Terms & Conditions section
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('Terms & Conditions', 12, footerY + 32);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        this.terms.forEach((t, i) => {
            doc.text(t, 12, footerY + 36 + (i * 3.5));
        });

        // ======== RIGHT SIDE: Summary Box ========
        const summaryX = 125;
        const summaryW = 75;
        const summaryY = footerY;
        const labelW = 40;
        const valW = 35;
        const rowH = 6;

        const rows = [
            { label: 'Sub Total', value: this.fmtNum(subTotal) },
            { label: 'Total Taxable Amount', value: this.fmtNum(subTotal) },
            { label: 'IGST18 (18%)', value: this.fmtNum(igstTotal) },
            { label: 'Total', value: 'Rs.' + this.fmtNum(grandTotal), bold: true }
        ];

        // Draw summary table
        doc.setLineWidth(0.2);
        rows.forEach((row, i) => {
            const ry = summaryY + (i * rowH);

            // Draw cells
            doc.rect(summaryX, ry, labelW, rowH);
            doc.rect(summaryX + labelW, ry, valW, rowH);

            // Label
            doc.setFontSize(row.bold ? 9 : 8);
            doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
            doc.setTextColor(0, 0, 0);
            doc.text(row.label, summaryX + 2, ry + 4);

            // Value
            doc.setFont('helvetica', 'bold');
            doc.text(row.value, summaryX + labelW + valW - 2, ry + 4, { align: 'right' });
        });

        // ======== SIGNATURE SECTION (below summary) ========
        const sigY = summaryY + (rows.length * rowH) + 4;

        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        doc.text('For Precise Procure Private Limited', summaryX + 2, sigY);

        // Load and display signature image
        try {
            const signatureImg = await this.loadImage('/images/signature.png');
            doc.addImage(signatureImg, 'PNG', summaryX + 8, sigY + 2, 35, 18);
        } catch (e) {
            console.warn('Signature image not found:', e);
            // Draw a placeholder line for signature
            doc.setLineWidth(0.5);
            doc.line(summaryX + 8, sigY + 15, summaryX + 43, sigY + 15);
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text('Authorized Signature', summaryX + 15, sigY + 24);
    }

    // ================================================================
    // DATA PREPARATION
    // ================================================================
    prepareItemsData(enquiry, selectedQuotes) {
        const items = [];
        enquiry.items.forEach(item => {
            const sq = selectedQuotes[item._id];
            if (sq && item.salesPrice) {
                const qty = item.quantity || 1;
                const price = item.salesPrice;
                items.push({
                    description: item.productId?.materialName || 'N/A',
                    specification: item.productId?.specification || 'Standard',
                    hsnCode: item.productId?.hsnCode || '',
                    qty: qty,
                    uom: item.productId?.uom || 'PC',
                    unitPrice: price,
                    gstRate: item.productId?.gstRate || 18,
                    amount: price * qty
                });
            }
        });
        return items;
    }

    // ================================================================
    // HELPERS
    // ================================================================
    fmtNum(n) {
        return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    numberToWords(num) {
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

    loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }
}

window.QuotationPDFGenerator = QuotationPDFGenerator;
