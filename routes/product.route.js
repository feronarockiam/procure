const express = require('express');
const { Product, EnquiryItem, Vendor } = require('../db');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { audit } = require('../utils/audit');
const { isValidId, cleanString, escapeRegex, toPositive, toNonNegative } = require('../middleware/validate');
const { inr } = require('../utils/audit');

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
        const products = await Product.find().sort({ materialName: 1 }).populate('defaultVendorId', 'name');
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

// PUT /api/products/:id/default-price — set the default vendor + price (rate contract) for a material.
// Enquiries for it then get this vendor quote automatically and skip the purchase queue.
router.put('/:id/default-price', authenticateToken, requirePermission('material.edit'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
        const { vendorId } = req.body || {};
        if (!isValidId(vendorId)) return res.status(400).json({ error: 'Choose the vendor this price is from' });
        const price = toPositive(req.body.price);
        if (Number.isNaN(price)) return res.status(400).json({ error: 'Enter a price greater than 0' });
        const freight = req.body.freight === undefined || req.body.freight === null || req.body.freight === '' ? 0 : toNonNegative(req.body.freight);
        if (Number.isNaN(freight)) return res.status(400).json({ error: 'Freight must be a number (0 or more)' });

        let validUntil = null;
        if (req.body.validUntil) {
            if (typeof req.body.validUntil !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(req.body.validUntil) || Number.isNaN(Date.parse(req.body.validUntil))) {
                return res.status(400).json({ error: 'The end date is not a valid date' });
            }
            validUntil = new Date(req.body.validUntil);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            if (validUntil < today) return res.status(400).json({ error: 'The end date has already passed' });
        }

        const [product, vendor] = await Promise.all([Product.findById(req.params.id), Vendor.findById(vendorId).select('name')]);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

        Object.assign(product, {
            defaultVendorId: vendor._id, defaultPrice: price, defaultFreight: freight, defaultPriceValidUntil: validUntil,
            defaultPriceSetBy: req.user.id, defaultPriceSetAt: new Date(),
        });
        await product.save();
        await audit(req, {
            action: 'material.default_price_set', entity: 'material', entityId: product._id, entityLabel: product.materialName,
            summary: `Set the default price of "${product.materialName}" to ${inr(price)} per ${product.uom}${freight ? ` (+${inr(freight)} freight)` : ''} from ${vendor.name}${validUntil ? ` until ${validUntil.toISOString().slice(0, 10)}` : ''}`,
            details: { vendorId: String(vendor._id), price, freight, validUntil },
        });
        res.json(await Product.findById(product._id).populate('defaultVendorId', 'name'));
    } catch (error) {
        handleRouteError(res, error, 'default price');
    }
});

// DELETE /api/products/:id/default-price — stop using a default price (enquiries go to purchase again)
router.delete('/:id/default-price', authenticateToken, requirePermission('material.edit'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        if (product.defaultVendorId) {
            product.set({ defaultVendorId: null, defaultPrice: undefined, defaultFreight: 0, defaultPriceValidUntil: null, defaultPriceSetBy: req.user.id, defaultPriceSetAt: new Date() });
            await product.save();
            await audit(req, { action: 'material.default_price_removed', entity: 'material', entityId: product._id, entityLabel: product.materialName, summary: `Removed the default price of "${product.materialName}"` });
        }
        res.json(product);
    } catch (error) {
        handleRouteError(res, error, 'default price');
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
