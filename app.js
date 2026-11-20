// The file a Node host starts (cPanel "Setup Node.js App" → Application startup file: app.js).
// server.js builds the application; this file checks the settings, connects to the database and starts listening.
// (On Vercel the platform imports server.js directly and never runs this file.)
require('dotenv').config();
const { validateConfig } = require('./config');

const { fatal, warnings } = validateConfig();
warnings.forEach(w => console.warn('⚠️  ' + w));
if (fatal.length) {
    console.error('\n❌ Precise Procure cannot start. Fix these settings first:\n');
    fatal.forEach(f => console.error('   • ' + f));
    console.error('\nIn cPanel: Setup Node.js App → your app → Environment variables, then Restart.\n');
    if (process.env.NODE_ENV === 'production') process.exit(1);
}

const app = require('./server');
const { connectDB } = require('./db');

// cPanel/Passenger supplies the port (or socket) through PORT; locally 3000 is used when nothing is set
const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
    console.log(`🚀 Precise Procure is running (${process.env.NODE_ENV || 'development'}) on ${port}`);
});

// Connect right away so the first visitor doesn't wait, and a wrong connection string shows up in the log immediately
connectDB().catch(err => console.error('❌ Could not reach the database at start-up:', err.message, '\n   (Check MONGODB_URI, and that this server is allowed in MongoDB Atlas → Network Access.)'));

// Let a restart finish current requests instead of cutting them off
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
