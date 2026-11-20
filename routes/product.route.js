const express = require('express');
const { Product, EnquiryItem } = require('../db');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { audit } = require('../utils/audit');
const { isValidId, cleanString, escapeRegex } = require('../middleware/validate');

// "Acme  Traders" and "Acme Traders" are one name
const cleanName = (value) => { const text = cleanString(value); return text && text.replace(/\s+/g, ' '); };

const router = express.Router();

// Same material = same name + UOM + brand (case-insensitive). Different brands of one material are legitimate.
const duplicateProduct = async ({ materialName, uom, brand }, exceptId) => {
    const ci = (v) => new RegExp(`^${escapeRegex(v)}$`, 'i');
    const query = {
        materialName: ci(materialName),
        uom: ci(uom),
        // an unset brand and "Generic" are the same thing to users
        brand: brand && brand.toLowerCase() !== 'generic'
            ? ci(brand)
            : { $in: [null, '', 'Generic', 'generic'] },
    };
    if (exceptId) query._id = { $ne: exceptId };
    return Product.findOne(query);
};

// GET /api/products
router.get('/', authenticateToken, requirePermission('material.view'), async (req, res) => {
    try {
        const products = await Product.find().sort({ materialName: 1 });
        res.json(products);
    } catch (error) {
        handleRouteError(res, error, 'product');
    }
});

// POST /api/products
router.post('/', authenticateToken, requirePermission('material.create'), async (req, res) => {
    try {
        const { description, hsnCode, brand, specification } = req.body;
        const materialName = cleanName(req.body.materialName);
        const uom = cleanString(req.body.uom);
        if (!materialName || !uom) return res.status(400).json({ error: 'materialName and uom are required' });

        const existing = await duplicateProduct({ materialName, uom, brand: cleanString(brand) });
        if (existing) {
            // Hand back the one that exists, so a screen adding it "on the fly" can simply pick it
            return res.status(409).json({ error: `"${existing.materialName}" (${existing.uom}) already exists in the material master`, existing });
        }

        const product = new Product({ materialName, uom, description, hsnCode, brand, specification });
        await product.save();
        await audit(req, { action: 'material.created', entity: 'material', entityId: product._id, entityLabel: product.materialName, summary: `Added material "${product.materialName}" (${product.uom})` });
        res.status(201).json(product);
    } catch (error) {
        handleRouteError(res, error, 'product');
    }
});

// PUT /api/products/:id
router.put('/:id', authenticateToken, requirePermission('material.edit'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
        const { description, hsnCode, brand, specification } = req.body;

        const updateData = { description, hsnCode, brand, specification };
        if (req.body.materialName !== undefined) {
            updateData.materialName = cleanName(req.body.materialName);
            if (!updateData.materialName) return res.status(400).json({ error: 'materialName cannot be blank' });
        }
        if (req.body.uom !== undefined) {
            updateData.uom = cleanString(req.body.uom);
            if (!updateData.uom) return res.status(400).json({ error: 'uom cannot be blank' });
        }

        const current = await Product.findById(req.params.id);
        if (!current) return res.status(404).json({ error: 'Product not found' });
        const next = {
            materialName: updateData.materialName ?? current.materialName,
            uom: updateData.uom ?? current.uom,
            brand: cleanString(brand !== undefined ? brand : current.brand),
        };
        if (await duplicateProduct(next, req.params.id)) {
            return res.status(409).json({ error: `"${next.materialName}" (${next.uom}) already exists in the material master` });
        }

        const product = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
        await audit(req, { action: 'material.updated', entity: 'material', entityId: product._id, entityLabel: product.materialName, summary: `Updated material "${product.materialName}"` });
        res.json(product);
    } catch (error) {
        handleRouteError(res, error, 'product');
    }
});

// DELETE /api/products/:id
router.delete('/:id', authenticateToken, requirePermission('material.delete'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });

        // Enquiry lines point at the product; deleting it would leave them blank and crash the pages
        const lineCount = await EnquiryItem.countDocuments({ productId: req.params.id });
        if (lineCount > 0) {
            return res.status(409).json({
                error: `Cannot delete: this material is used on ${lineCount} enquiry item${lineCount === 1 ? '' : 's'}.`,
            });
        }

        const product = await Product.findByIdAndDelete(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        await audit(req, { action: 'material.deleted', entity: 'material', entityId: product._id, entityLabel: product.materialName, summary: `Deleted material "${product.materialName}"` });
        res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        handleRouteError(res, error, 'product');
    }
});

module.exports = router;
