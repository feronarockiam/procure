const express = require('express');
const { applyDefaultPrices } = require('../utils/defaultPrice');
const router = express.Router();
const { Enquiry, EnquiryItem, Product, Customer, User } = require('../db');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { isValidId, escapeRegex, toPositive } = require('../middleware/validate');
const { createEnquiryWithNumber } = require('../utils/enquiryNumber');
const { usersWithPermission } = require('../utils/access');

const MAX_ROWS = 2000;
// Excel cells can arrive as numbers/booleans/null; treat everything as trimmed text
const str = (value) => (value === undefined || value === null ? '' : String(value).trim());

/**
 * Bulk Enquiry Routes
 * Handles validation and creation of multiple enquiries from Excel/Sheets
 */

// Helper: Calculate string similarity (Levenshtein distance)
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

/**
 * POST /api/enquiries/bulk/validate
 * Validate bulk enquiry data with product matching
 */
router.post('/bulk/validate', authenticateToken, requirePermission('enquiry.bulk_create'), async (req, res) => {
    try {
        const { rows } = req.body;

        if (!rows || !Array.isArray(rows)) {
            return res.status(400).json({ error: 'Invalid request format' });
        }
        if (rows.length > MAX_ROWS) {
            return res.status(400).json({ error: `Too many rows (max ${MAX_ROWS} per upload)` });
        }

        // Fetch all products, customers, and sourcing users
        const [products, customers, sourcingUsers] = await Promise.all([
            Product.find({}),
            Customer.find({}),
            // everyone whose role can enter vendor prices (the old check looked at a legacy word on the user)
            usersWithPermission('purchase_price.add', { select: '_id name', populate: 'name' })
        ]);

        const validated = [];

        for (const rawRow of rows) {
            const row = rawRow && typeof rawRow === 'object' ? rawRow : {};
            const validatedRow = {
                originalRow: row,
                customer: null,
                product: null,
                quantity: null,
                assignee: null,
                errors: [],
                warnings: []
            };

            // Validate customer
            if (!str(row.customer)) {
                validatedRow.errors.push('Customer name is required');
            } else {
                const customerName = str(row.customer);
                const matchedCustomer = customers.find(c =>
                    c.name.toLowerCase() === customerName.toLowerCase()
                );

                if (matchedCustomer) {
                    validatedRow.customer = {
                        id: matchedCustomer._id,
                        name: matchedCustomer.name,
                        matched: true
                    };
                } else {
                    // Customer not found, but we can create on-the-fly
                    validatedRow.customer = {
                        name: customerName,
                        matched: false
                    };
                    validatedRow.warnings.push(`Customer "${customerName}" not found. Will be created.`);
                }
            }

            // Validate and match product
            if (!str(row.materialName)) {
                validatedRow.errors.push('Material name is required');
            } else {
                const materialName = str(row.materialName);

                // Try exact match first
                let matchedProduct = products.find(p =>
                    p.materialName.toLowerCase() === materialName.toLowerCase()
                );

                if (matchedProduct) {
                    validatedRow.product = {
                        id: matchedProduct._id,
                        name: matchedProduct.materialName,
                        uom: matchedProduct.uom,
                        uploadedName: materialName,
                        matchType: 'exact',
                        confidence: 1.0,
                        suggestions: []
                    };
                } else {
                    // Fuzzy matching
                    const fuzzyMatches = products.map(p => ({
                        product: p,
                        similarity: calculateSimilarity(
                            materialName.toLowerCase(),
                            p.materialName.toLowerCase()
                        )
                    })).sort((a, b) => b.similarity - a.similarity);

                    const bestMatch = fuzzyMatches[0];
                    const topSuggestions = fuzzyMatches.slice(0, 5)
                        .filter(m => m.similarity > 0.4)
                        .map(m => ({
                            id: m.product._id,
                            name: m.product.materialName,
                            uom: m.product.uom,
                            similarity: m.similarity
                        }));

                    if (bestMatch.similarity > 0.7) {
                        // Good fuzzy match
                        validatedRow.product = {
                            id: bestMatch.product._id,
                            name: bestMatch.product.materialName,
                            uom: bestMatch.product.uom,
                            uploadedName: materialName,
                            matchType: 'fuzzy',
                            confidence: bestMatch.similarity,
                            suggestions: topSuggestions.slice(1)
                        };
                        validatedRow.warnings.push(`Product "${materialName}" matched to "${bestMatch.product.materialName}" with ${Math.round(bestMatch.similarity * 100)}% confidence`);
                    } else {
                        // No good match
                        validatedRow.product = {
                            uploadedName: materialName,
                            matchType: 'none',
                            confidence: 0,
                            suggestions: topSuggestions
                        };
                        validatedRow.errors.push(`No matching product found for "${materialName}". Please select from suggestions.`);
                    }
                }
            }

            // Validate quantity
            const quantity = toPositive(row.quantity);
            if (Number.isNaN(quantity)) {
                validatedRow.errors.push('Valid quantity is required');
            } else {
                validatedRow.quantity = quantity;
            }

            // Validate assignee (optional)
            if (str(row.assignee)) {
                const assigneeName = str(row.assignee);
                const matchedUser = sourcingUsers.find(u =>
                    u.name.toLowerCase() === assigneeName.toLowerCase()
                );

                if (matchedUser) {
                    validatedRow.assignee = {
                        id: matchedUser._id,
                        name: matchedUser.name,
                        matched: true
                    };
                } else {
                    validatedRow.assignee = {
                        name: assigneeName,
                        matched: false
                    };
                    validatedRow.warnings.push(`Sourcing user "${assigneeName}" not found. Will be unassigned.`);
                }
            }

            validated.push(validatedRow);
        }

        res.json({ validated });

    } catch (error) {
        handleRouteError(res, error, 'bulk validate');
    }
});

/**
 * POST /api/enquiries/bulk/create
 * Create multiple enquiries from validated data
 */
router.post('/bulk/create', authenticateToken, requirePermission('enquiry.bulk_create'), async (req, res) => {
    try {
        const { enquiries } = req.body;

        if (!enquiries || !Array.isArray(enquiries)) {
            return res.status(400).json({ error: 'Invalid request format' });
        }
        if (enquiries.length > MAX_ROWS) {
            return res.status(400).json({ error: `Too many enquiries (max ${MAX_ROWS} per upload)` });
        }

        // The creator is always the logged-in user. This used to trust a userId from the request body,
        // so any bulk-upload user could create enquiries in someone else's name.
        const createdBy = req.user.id;

        const created = [];
        const failed = [];
        let autoPriced = 0; // items quoted straight away from a material's default price
        const purchaseIds = new Set((await usersWithPermission('purchase_price.add', { select: '_id', populate: 'name' })).map(u => String(u._id)));

        for (const enq of enquiries) {
            const label = str(enq && enq.customerName) || 'Unknown';
            try {
                if (!enq || !Array.isArray(enq.items) || enq.items.length === 0) {
                    failed.push({ customer: label, reason: 'No items' });
                    continue;
                }

                const items = [];
                let badItem = null;
                for (const item of enq.items) {
                    const quantity = toPositive(item && item.quantity);
                    if (!item || !isValidId(String(item.productId)) || Number.isNaN(quantity)) { badItem = item; break; }
                    items.push({ productId: String(item.productId), quantity });
                }
                if (badItem !== null) {
                    failed.push({ customer: label, reason: 'Every item needs a valid product and a quantity above 0' });
                    continue;
                }

                let customerId = enq.customerId;
                if (customerId && !isValidId(String(customerId))) {
                    failed.push({ customer: label, reason: 'Invalid customer' });
                    continue;
                }

                // Create customer if doesn't exist
                if (!customerId && str(enq.customerName)) {
                    const customerName = str(enq.customerName);
                    // Case-insensitive exact match. The name is escaped: a name like "A (B)" used to break the regex.
                    const existingCustomer = await Customer.findOne({
                        name: new RegExp(`^${escapeRegex(customerName)}$`, 'i')
                    });

                    if (existingCustomer) {
                        customerId = existingCustomer._id;
                    } else {
                        const newCustomer = await Customer.create({
                            name: customerName,
                            email: `${customerName.toLowerCase().replace(/[^a-z0-9]/g, '')}@temp.com`,
                            phone: '0000000000',
                            address: 'To be updated'
                        });
                        customerId = newCustomer._id;
                    }
                }

                if (!customerId) {
                    failed.push({ customer: label, reason: 'Customer ID missing' });
                    continue;
                }

                const assignedTo = enq.assignedTo && isValidId(String(enq.assignedTo)) && purchaseIds.has(String(enq.assignedTo))
                    ? String(enq.assignedTo)
                    : null;

                // Same numbering as single creation (ENQ-YYYYMMDD-NNN); the old count-based number
                // collided with existing enquiries as soon as one had been deleted.
                const newEnquiry = await createEnquiryWithNumber({
                    customerId,
                    createdBy,
                    status: 'active',
                    stage: assignedTo ? 'open' : 'new',
                    ...(assignedTo ? { assignedTo } : {}),
                });

                try {
                    await EnquiryItem.insertMany(items.map(item => ({
                        enquiryId: newEnquiry._id,
                        productId: item.productId,
                        quantity: item.quantity,
                        // An enquiry given an assignee used to leave its items unassigned
                        status: assignedTo ? 'assigned' : 'unassigned',
                        ...(assignedTo ? { assignedTo } : {}),
                    })));
                } catch (err) {
                    await Enquiry.findByIdAndDelete(newEnquiry._id).catch(() => {});
                    throw err;
                }

                // Same as single creation: materials with a default vendor + price are quoted at once
                autoPriced += (await applyDefaultPrices(newEnquiry._id, { userId: req.user.id })).length;

                created.push(newEnquiry.enquiryNumber);

            } catch (error) {
                console.error('Error creating enquiry:', error);
                failed.push({ customer: label, reason: error.message });
            }
        }

        res.json({
            created,
            failed,
            summary: {
                total: enquiries.length,
                successful: created.length,
                failed: failed.length,
                autoPriced,
            }
        });

    } catch (error) {
        handleRouteError(res, error, 'bulk create');
    }
});

module.exports = router;
