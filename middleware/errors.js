// Shared route error handler: log the real error, and answer with a status the
// client can act on instead of a blanket "Server error".
const handleRouteError = (res, error, context = '') => {
    const where = context ? ` (${context})` : '';

    // Mistakes in the request are the caller's to fix: a one-line log, no stack trace
    if (error && error.name === 'ValidationError') {
        const message = Object.values(error.errors || {}).map(e => e.message).join('; ');
        console.warn(`Rejected${where}: ${message}`);
        return res.status(400).json({ error: message || 'Validation failed' });
    }
    if (error && error.name === 'CastError') {
        console.warn(`Rejected${where}: invalid ${error.path}`);
        return res.status(400).json({ error: `Invalid ${error.path || 'value'}` });
    }
    if (error && error.code === 11000) {
        const field = Object.keys(error.keyPattern || {})[0] || 'value';
        console.warn(`Rejected${where}: duplicate ${field}`);
        return res.status(409).json({ error: `Duplicate ${field}` });
    }

    // Anything else is ours: keep the full error for the logs
    console.error(`Route error${where}:`, error);
    return res.status(500).json({ error: 'Server error' });
};

module.exports = { handleRouteError };
