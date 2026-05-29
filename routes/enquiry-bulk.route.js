const express = require('express');
const router = express.Router();
const { Enquiry, EnquiryItem, Product, Customer, User } = require('../db');
const { authenticateToken, requirePermission } = require('../middleware/auth');

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

        // Fetch all products, customers, and sourcing users
        const [products, customers, sourcingUsers] = await Promise.all([
            Product.find({}),
            Customer.find({}),
            User.find({ role: 'sourcing' })
        ]);

        const validated = [];

        for (const row of rows) {
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
            if (!row.customer || !row.customer.trim()) {
                validatedRow.errors.push('Customer name is required');
            } else {
                const customerName = row.customer.trim();
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
            if (!row.materialName || !row.materialName.trim()) {
                validatedRow.errors.push('Material name is required');
            } else {
                const materialName = row.materialName.trim();

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
            if (!row.quantity || isNaN(parseFloat(row.quantity)) || parseFloat(row.quantity) <= 0) {
                validatedRow.errors.push('Valid quantity is required');
            } else {
                validatedRow.quantity = parseFloat(row.quantity);
            }

            // Validate assignee (optional)
            if (row.assignee && row.assignee.trim()) {
                const assigneeName = row.assignee.trim();
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
        console.error('Bulk validate error:', error);
        res.status(500).json({ error: 'Server error during validation' });
    }
});

/**
 * POST /api/enquiries/bulk/create
 * Create multiple enquiries from validated data
 */
router.post('/bulk/create', authenticateToken, requirePermission('enquiry.bulk_create'), async (req, res) => {
    try {
        const { enquiries, userId } = req.body;

        if (!enquiries || !Array.isArray(enquiries)) {
            return res.status(400).json({ error: 'Invalid request format' });
        }

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const created = [];
        const failed = [];

        for (const enq of enquiries) {
            try {
                let customerId = enq.customerId;

                // Create customer if doesn't exist
                if (!customerId && enq.customerName) {
                    // Check if customer already exists (case-insensitive)
                    const existingCustomer = await Customer.findOne({
                        name: { $regex: new RegExp(`^${enq.customerName.trim()}$`, 'i') }
                    });

                    if (existingCustomer) {
                        customerId = existingCustomer._id;
                    } else {
                        const newCustomer = await Customer.create({
                            name: enq.customerName.trim(),
                            email: `${enq.customerName.toLowerCase().replace(/[^a-z0-9]/g, '')}@temp.com`,
                            phone: '0000000000',
                            address: 'To be updated'
                        });
                        customerId = newCustomer._id;
                    }
                }

                if (!customerId) {
                    failed.push({
                        customer: enq.customerName,
                        reason: 'Customer ID missing'
                    });
                    continue;
                }

                // Create enquiry with proper counter
                const counter = await Enquiry.countDocuments() + 1;
                const enquiryNumber = `ENQ-${String(counter).padStart(4, '0')}`;

                const enquiryData = {
                    enquiryNumber,
                    customerId,
                    createdBy: userId, // Use userId from request body
                    status: 'active'  // Changed from 'pending' to 'active'
                };

                if (enq.assignedTo) {
                    enquiryData.assignedTo = enq.assignedTo;
                }

                const newEnquiry = await Enquiry.create(enquiryData);

                // Create enquiry items
                const itemsToCreate = enq.items.map(item => ({
                    enquiryId: newEnquiry._id,
                    productId: item.productId,
                    quantity: item.quantity,
                    status: 'pending'
                }));

                await EnquiryItem.insertMany(itemsToCreate);

                created.push(newEnquiry.enquiryNumber);

            } catch (error) {
                console.error('Error creating enquiry:', error);
                failed.push({
                    customer: enq.customerName || 'Unknown',
                    reason: error.message
                });
            }
        }

        res.json({
            created,
            failed,
            summary: {
                total: enquiries.length,
                successful: created.length,
                failed: failed.length
            }
        });

    } catch (error) {
        console.error('Bulk create error:', error);
        res.status(500).json({ error: 'Server error during creation' });
    }
});

module.exports = router;
