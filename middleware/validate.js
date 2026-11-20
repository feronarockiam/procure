const mongoose = require('mongoose');

const isValidId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id);

// Express's query parser turns ?stage[$ne]=x into an object. Anything that goes into a
// Mongo filter has to be a plain string first, or it becomes a query operator.
const asString = (value) => (typeof value === 'string' ? value : undefined);

// Escape user text before building a RegExp from it
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A trimmed, non-empty string or undefined
const cleanString = (value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
};

// Positive finite number (quantity) / non-negative finite number (prices); NaN if invalid
const toPositive = (value) => {
    if (value === '' || value === null || value === undefined || typeof value === 'boolean') return NaN;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : NaN;
};
const toNonNegative = (value) => {
    if (value === '' || value === null || value === undefined || typeof value === 'boolean') return NaN;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
};

// Router-level guard: reject malformed :id style params with a 400 instead of a CastError 500
const validateIdParams = (...names) => (req, res, next) => {
    for (const name of names) {
        if (req.params[name] !== undefined && !isValidId(req.params[name])) {
            return res.status(400).json({ error: `Invalid ${name}` });
        }
    }
    next();
};

// Nothing a person types is legitimately thousands of characters long. Refusing absurd sizes up front keeps huge text out of
// database queries (a 100,000-character name used to crash the duplicate-name search) and gives a clear message.
const MAX_TEXT = 5000;
const MAX_LIST = 5000;
const tooBig = (value, depth = 0) => {
    if (typeof value === 'string') return value.length > MAX_TEXT;
    if (depth > 8 || value === null || typeof value !== 'object') return depth > 8;
    if (Array.isArray(value)) return value.length > MAX_LIST || value.some(v => tooBig(v, depth + 1));
    return Object.values(value).some(v => tooBig(v, depth + 1));
};
const limitBodySize = (req, res, next) => {
    if (req.body && typeof req.body === 'object' && tooBig(req.body)) {
        return res.status(400).json({ error: `Something you entered is too long (text can be up to ${MAX_TEXT} characters).` });
    }
    next();
};

module.exports = {
    limitBodySize, isValidId, asString, escapeRegex, cleanString, toPositive, toNonNegative, validateIdParams };
