const express = require('express');
const cors = require('cors');
const { connectDB } = require('./db');
const path = require('path');

const app = express();

// Middleware
app.use(cors({
    origin: ['https://adriana-unconsignable-laryngoscopically.ngrok-free.dev', 'http://localhost:5000', 'http://localhost:7000', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));
app.use(express.json());

// Bypass ngrok browser warning for external users
app.use((req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB middleware
app.use('/api', async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (error) {
        res.status(500).json({ error: 'Database connection failed' });
    }
});

// Routes
app.use('/api/auth', require('./routes/auth.route'));
app.use('/api/customers', require('./routes/customer.route'));
app.use('/api/vendors', require('./routes/vendor.route'));
app.use('/api/products', require('./routes/product.route'));
app.use('/api/enquiries', require('./routes/enquiry.route'));
app.use('/api/enquiries', require('./routes/enquiry-bulk.route'));
app.use('/api/users', require('./routes/user.route.js'));
app.use('/api/notifications', require('./routes/notification.route.js'));

// Serve index.html for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Precise Procure API is running' });
});

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
}

module.exports = app;
