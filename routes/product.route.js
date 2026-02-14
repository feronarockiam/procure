const express = require('express');
const { Product } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all products
router.get('/', authenticateToken, async (req, res) => {
    try {
        const products = await Product.find().sort({ materialName: 1 });
        res.json(products);
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create product (admin only - for later)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { materialName, uom, description, hsnCode, brand, specification } = req.body;

        const product = new Product({
            materialName,
            uom,
            description,
            hsnCode, // Save HSN Code
            brand,
            specification
        });

        await product.save();
        res.status(201).json(product);
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update product
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { materialName, uom, description, hsnCode, brand, specification } = req.body;

        const product = await Product.findByIdAndUpdate(
            req.params.id,
            { materialName, uom, description, hsnCode, brand, specification },
            { new: true, runValidators: true }
        );

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json(product);
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete product
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
