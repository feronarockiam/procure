const express = require('express');
const { Product } = require('../db');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/products
router.get('/', authenticateToken, requirePermission('material.view'), async (req, res) => {
    try {
        const products = await Product.find().sort({ materialName: 1 });
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/products
router.post('/', authenticateToken, requirePermission('material.create'), async (req, res) => {
    try {
        const { materialName, uom, description, hsnCode, brand, specification } = req.body;
        if (!materialName || !uom) return res.status(400).json({ error: 'materialName and uom are required' });

        const product = new Product({ materialName, uom, description, hsnCode, brand, specification });
        await product.save();
        res.status(201).json(product);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/products/:id
router.put('/:id', authenticateToken, requirePermission('material.edit'), async (req, res) => {
    try {
        const { materialName, uom, description, hsnCode, brand, specification } = req.body;
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            { materialName, uom, description, hsnCode, brand, specification },
            { new: true, runValidators: true }
        );
        if (!product) return res.status(404).json({ error: 'Product not found' });
        res.json(product);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/products/:id
router.delete('/:id', authenticateToken, requirePermission('material.delete'), async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
