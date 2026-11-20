const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { connectDB } = require('./db');
const path = require('path');
const config = require('./config');
const { syncAdminRole } = require('./utils/syncAdminRole');

const app = express();

// On shared hosting (cPanel) and on Vercel the app sits behind the host's web server: trust it for the visitor's real
// address (login limits count per address) and for whether the visit was over https.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Standard browser protections that cost nothing
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000'); // only meaningful (and only sent) over https
    next();
});

// Cross-site browser access: only the addresses listed in CORS_ORIGIN (plus localhost while developing).
// The pages and the API normally share one address, so most installs list nothing.
const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true); // same-origin and non-browser callers
        const allowed = config.corsOrigins().includes(origin) || (!config.isProduction() && localOrigin.test(origin));
        callback(null, allowed);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Access-Version', 'X-Total-Count', 'X-Returned-Count']
}));
// Bulk Excel upload posts every row as JSON; Express's default 100kb cap rejects large sheets
// (Vercel itself caps request bodies at ~4.5MB).
app.use(express.json({ limit: '4mb' }));
app.use('/api', require('./middleware/validate').limitBodySize);

// A general brake on one address hammering the API (a broken script, or someone probing). The default is far above what a
// busy office behind one shared address does (screens fire a handful of requests each); set API_MAX_PER_MINUTE to change it,
// or 0 to switch it off. Sign-in has its own, much tighter limit.
const apiLimiter = require('./middleware/rateLimit').createLimiter({ windowMs: 60 * 1000, max: () => Number(process.env.API_MAX_PER_MINUTE || 1500) });
app.use('/api', (req, res, next) => {
    const configured = process.env.API_MAX_PER_MINUTE;
    if (configured === '0' || (configured === undefined && process.env.NODE_ENV === 'test')) return next();
    if (req.path === '/health' || req.path === '/config') return next();
    const verdict = apiLimiter.hit(req.ip || 'unknown');
    if (verdict.allowed) return next();
    res.set('Retry-After', String(verdict.retryAfterSeconds));
    res.status(429).json({ error: 'Too many requests too quickly. Please wait a moment and try again.' });
});

// Compress responses. The enquiry list is the biggest (JSON shrinks about tenfold), and a hosted function's
// reply is size-limited, so this is what keeps a long list loading at all as enquiries pile up.
app.use(compression());

// The pages. Scripts and styles are re-checked on every visit (a quick "not modified" when unchanged) so an update
// reaches people at once; images and fonts can be kept for a week.
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', /\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf)$/i.test(filePath) ? 'public, max-age=604800' : 'no-cache');
    },
}));

// API answers depend on who is signed in, so no browser or proxy may keep them. Without this the host marks them
// cacheable, and after switching accounts the browser reuses a reply (with the previous person's X-Access-Version),
// which made pages reload over and over.
app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// What the pages need to know before anyone has signed in. Answered without the database.
app.get('/api/config', (req, res) => {
    res.json({ demoLogin: config.showDemoLogin() });
});

// Connect to MongoDB middleware
app.use('/api', async (req, res, next) => {
    try {
        await connectDB();
        await syncAdminRole();
        next();
    } catch (error) {
        console.error('Database connection failed:', error.message);
        res.status(503).json({ error: 'Database is unavailable, please try again in a moment' });
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
app.use('/api/roles', require('./routes/role.route.js'));
app.use('/api/audit', require('./routes/audit.route.js'));
app.use('/api/analytics', require('./routes/analytics.route.js'));
app.use('/api/access-requests', require('./routes/access-request.route.js'));
app.use('/api/notifications', require('./routes/notification.route.js'));

// Serve index.html for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Precise Procure API is running' });
});

// Unknown /api paths answer in JSON (the frontend can't parse the default HTML 404 page)
app.use('/api', (req, res) => {
    res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl.split('?')[0]}` });
});

// Last-resort error handler: malformed JSON, oversized bodies, and anything a route let escape.
// Always JSON, so apiCall() shows a real message instead of "Unexpected server response".
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Server error' });
});

process.on('unhandledRejection', (reason) => console.error('Unhandled promise rejection:', reason));

const PORT = process.env.PORT || 5000;

// (Start-up checks of the configuration live in config.js and run from app.js, the file hosts start.)

// Listen only when run directly (`node server.js` / nodemon). Vercel imports the app instead,
// and tests import it and listen on their own port.
if (require.main === module && process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
}

module.exports = app;
