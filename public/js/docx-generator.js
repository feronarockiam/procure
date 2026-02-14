// DOCX Quotation Generator for Precise Procure
// Simplified structure optimized for Word compatibility

class QuotationDocxGenerator {
    constructor() {
        this.companyDetails = {
            name: 'Precise Procure Private Limited',
            line1: 'Plot 4,5 Part, ICL Home town, Noombal,',
            line2: 'Chennai Tamil Nadu 600077',
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
        if (!window.docx) {
            throw new Error("Docx library not loaded. Please refresh the page and try again.");
        }

        const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, convertInchesToTwip } = window.docx;

        const itemsData = this.prepareItemsData(enquiry, selectedQuotes);
        const totals = this.calculateTotals(itemsData);

        const sections = [];

        // Header
        sections.push(new Paragraph({
            children: [new TextRun({ text: this.companyDetails.name, bold: true, size: 28 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 }
        }));

        sections.push(new Paragraph({
            children: [new TextRun({ text: this.companyDetails.line1, size: 18 })],
            alignment: AlignmentType.CENTER,
        }));

        sections.push(new Paragraph({
            children: [new TextRun({ text: this.companyDetails.line2, size: 18 })],
            alignment: AlignmentType.CENTER,
        }));

        sections.push(new Paragraph({
            children: [new TextRun({ text: this.companyDetails.cin + " | " + this.companyDetails.pan, size: 16 })],
            alignment: AlignmentType.CENTER,
        }));

        sections.push(new Paragraph({
            children: [new TextRun({ text: this.companyDetails.gstin + " | " + this.companyDetails.msme, size: 16 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 }
        }));

        sections.push(new Paragraph({
            children: [new TextRun({ text: "QUOTATION", bold: true, size: 32 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 }
        }));

        // Quote Details Table
        sections.push(this.createQuoteDetailsTable(enquiry));
        sections.push(new Paragraph({ text: "", spacing: { after: 200 } }));

        // Bill To / Ship To
        sections.push(this.createBillingShippingTable(enquiry));
        sections.push(new Paragraph({ text: "", spacing: { after: 200 } }));

        // Items Table
        sections.push(this.createItemsTable(itemsData));
        sections.push(new Paragraph({ text: "", spacing: { after: 200 } }));

        // Summary
        sections.push(this.createSummaryTable(totals));
        sections.push(new Paragraph({ text: "", spacing: { after: 200 } }));

        // Total in Words
        sections.push(new Paragraph({
            children: [new TextRun({ text: "Total In Words: ", bold: true, size: 20 })],
        }));
        sections.push(new Paragraph({
            children: [new TextRun({ text: this.numberToWords(Math.round(totals.grandTotal)), italics: true, size: 18 })],
            spacing: { after: 200 }
        }));

        // Notes
        sections.push(new Paragraph({
            children: [new TextRun({ text: "Notes:", bold: true, size: 18 })],
        }));
        sections.push(new Paragraph({
            children: [new TextRun({ text: "Looking forward for your business.", italics: true, size: 16 })],
            spacing: { after: 200 }
        }));

        // Terms
        sections.push(new Paragraph({
            children: [new TextRun({ text: "Terms & Conditions:", bold: true, size: 18 })],
        }));
        this.terms.forEach(term => {
            sections.push(new Paragraph({
                children: [new TextRun({ text: term, size: 16 })],
            }));
        });

        sections.push(new Paragraph({ text: "", spacing: { after: 300 } }));

        // Signature
        sections.push(new Paragraph({
            children: [new TextRun({ text: "For Precise Procure Private Limited", size: 16 })],
            alignment: AlignmentType.RIGHT,
        }));
        sections.push(new Paragraph({ text: "", spacing: { after: 400 } }));
        sections.push(new Paragraph({
            children: [new TextRun({ text: "Authorized Signature", size: 16 })],
            alignment: AlignmentType.RIGHT,
        }));

        // Create document
        const doc = new Document({
            sections: [{
                properties: {
                    page: {
                        margin: {
                            top: convertInchesToTwip(0.75),
                            right: convertInchesToTwip(0.75),
                            bottom: convertInchesToTwip(0.75),
                            left: convertInchesToTwip(0.75),
                        },
                    },
                },
                children: sections,
            }],
        });

        // Generate and download
        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Quotation_${enquiry.enquiryNumber}_${new Date().toISOString().split('T')[0]}.docx`;
        link.click();
        URL.revokeObjectURL(url);
    }

    createQuoteDetailsTable(enquiry) {
        const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, BorderStyle, ShadingType } = window.docx;

        const borderStyle = {
            top: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            left: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            right: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
        };

        const quoteNum = enquiry.enquiryNumber || '';

        return new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
                new TableRow({
                    children: [
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: borderStyle,
                            children: [
                                new Paragraph({ children: [new TextRun({ text: "Quote#: ", bold: true, size: 20 }), new TextRun({ text: "PP/QT/" + quoteNum, size: 20 })] }),
                                new Paragraph({ children: [new TextRun({ text: "Date: ", bold: true, size: 20 }), new TextRun({ text: new Date().toLocaleDateString('en-GB'), size: 20 })] }),
                                new Paragraph({ children: [new TextRun({ text: "Reference#: ", bold: true, size: 20 }), new TextRun({ text: quoteNum, size: 20 })] }),
                            ],
                        }),
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: borderStyle,
                            children: [
                                new Paragraph({
                                    children: [new TextRun({ text: "Place Of Supply: ", bold: true, size: 20 }), new TextRun({ text: enquiry.customerId?.state || 'Tamil Nadu', size: 20 })],
                                }),
                            ],
                        }),
                    ],
                }),
            ],
        });
    }

    createBillingShippingTable(enquiry) {
        const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, BorderStyle, ShadingType } = window.docx;

        const borderStyle = {
            top: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            left: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            right: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
        };

        const headerShading = { fill: "E0E0E0", type: ShadingType.CLEAR };

        const customerName = enquiry.customerId?.name || 'N/A';
        const address = enquiry.customerId?.address || '';

        return new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
                new TableRow({
                    children: [
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: borderStyle,
                            shading: headerShading,
                            children: [new Paragraph({ children: [new TextRun({ text: "Bill To", bold: true, size: 20 })] })],
                        }),
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: borderStyle,
                            shading: headerShading,
                            children: [new Paragraph({ children: [new TextRun({ text: "Ship To", bold: true, size: 20 })] })],
                        }),
                    ],
                }),
                new TableRow({
                    children: [
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: borderStyle,
                            children: [
                                new Paragraph({ children: [new TextRun({ text: customerName, bold: true, size: 18 })] }),
                                new Paragraph({ children: [new TextRun({ text: address, size: 16 })] }),
                            ],
                        }),
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: borderStyle,
                            children: [
                                new Paragraph({ children: [new TextRun({ text: customerName, bold: true, size: 18 })] }),
                                new Paragraph({ children: [new TextRun({ text: address, size: 16 })] }),
                            ],
                        }),
                    ],
                }),
            ],
        });
    }

    createItemsTable(itemsData) {
        const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, AlignmentType, BorderStyle, ShadingType } = window.docx;

        const borderStyle = {
            top: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            left: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            right: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
        };

        const headerShading = { fill: "E0E0E0", type: ShadingType.CLEAR };

        const rows = [];

        // Header row
        rows.push(
            new TableRow({
                children: [
                    new TableCell({ width: { size: 5, type: WidthType.PERCENTAGE }, borders: borderStyle, shading: headerShading, children: [new Paragraph({ children: [new TextRun({ text: "#", bold: true, size: 18 })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, borders: borderStyle, shading: headerShading, children: [new Paragraph({ children: [new TextRun({ text: "Item & Description", bold: true, size: 18 })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ width: { size: 12, type: WidthType.PERCENTAGE }, borders: borderStyle, shading: headerShading, children: [new Paragraph({ children: [new TextRun({ text: "HSN/SAC", bold: true, size: 18 })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ width: { size: 8, type: WidthType.PERCENTAGE }, borders: borderStyle, shading: headerShading, children: [new Paragraph({ children: [new TextRun({ text: "Qty", bold: true, size: 18 })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ width: { size: 12, type: WidthType.PERCENTAGE }, borders: borderStyle, shading: headerShading, children: [new Paragraph({ children: [new TextRun({ text: "Rate", bold: true, size: 18 })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ width: { size: 8, type: WidthType.PERCENTAGE }, borders: borderStyle, shading: headerShading, children: [new Paragraph({ children: [new TextRun({ text: "GST%", bold: true, size: 18 })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ width: { size: 12, type: WidthType.PERCENTAGE }, borders: borderStyle, shading: headerShading, children: [new Paragraph({ children: [new TextRun({ text: "GST Amt", bold: true, size: 18 })], alignment: AlignmentType.CENTER })] }),
                    new TableCell({ width: { size: 13, type: WidthType.PERCENTAGE }, borders: borderStyle, shading: headerShading, children: [new Paragraph({ children: [new TextRun({ text: "Amount", bold: true, size: 18 })], alignment: AlignmentType.CENTER })] }),
                ],
            })
        );

        // Data rows
        itemsData.forEach((item, idx) => {
            const gstAmt = (item.amount * item.gstRate) / 100;
            const totalAmt = item.amount + gstAmt;

            rows.push(
                new TableRow({
                    children: [
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: (idx + 1).toString(), size: 16 })], alignment: AlignmentType.CENTER })] }),
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: item.description + "\n" + (item.specification || ''), size: 16 })] })] }),
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: item.hsnCode || '-', size: 16 })], alignment: AlignmentType.CENTER })] }),
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: item.qty.toFixed(2), size: 16 })], alignment: AlignmentType.CENTER })] }),
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: "₹" + item.unitPrice.toFixed(2), size: 16 })], alignment: AlignmentType.RIGHT })] }),
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: item.gstRate + "%", size: 16 })], alignment: AlignmentType.CENTER })] }),
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: "₹" + this.fmtNum(gstAmt), size: 16 })], alignment: AlignmentType.RIGHT })] }),
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: "₹" + this.fmtNum(totalAmt), size: 16 })], alignment: AlignmentType.RIGHT })] }),
                    ],
                })
            );
        });

        return new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: rows,
        });
    }

    createSummaryTable(totals) {
        const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, AlignmentType, BorderStyle } = window.docx;

        const borderStyle = {
            top: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            left: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            right: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
        };

        return new Table({
            width: { size: 50, type: WidthType.PERCENTAGE },
            alignment: AlignmentType.RIGHT,
            rows: [
                new TableRow({
                    children: [
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: "Sub Total", bold: true, size: 18 })] })] }),
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: "₹" + this.fmtNum(totals.subTotal), size: 18 })], alignment: AlignmentType.RIGHT })] }),
                    ],
                }),
                new TableRow({
                    children: [
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: "Total Taxable Amount", bold: true, size: 18 })] })] }),
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: "₹" + this.fmtNum(totals.subTotal), size: 18 })], alignment: AlignmentType.RIGHT })] }),
                    ],
                }),
                new TableRow({
                    children: [
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: "IGST18 (18%)", bold: true, size: 18 })] })] }),
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: "₹" + this.fmtNum(totals.igstTotal), size: 18 })], alignment: AlignmentType.RIGHT })] }),
                    ],
                }),
                new TableRow({
                    children: [
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: "Total", bold: true, size: 20 })] })] }),
                        new TableCell({ borders: borderStyle, children: [new Paragraph({ children: [new TextRun({ text: "Rs." + this.fmtNum(totals.grandTotal), bold: true, size: 20 })], alignment: AlignmentType.RIGHT })] }),
                    ],
                }),
            ],
        });
    }

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

    calculateTotals(itemsData) {
        const subTotal = itemsData.reduce((s, i) => s + i.amount, 0);
        const igstTotal = itemsData.reduce((s, i) => s + (i.amount * i.gstRate) / 100, 0);
        const grandTotal = subTotal + igstTotal;

        return { subTotal, igstTotal, grandTotal };
    }

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
}

window.QuotationDocxGenerator = QuotationDocxGenerator;
