// Shared test setup: a throwaway database on a LOCAL MongoDB, the app on a random port, and small helpers.
// Refuses to run against anything but localhost.
const crypto = require('node:crypto');

module.exports = async function start() {
    const uri = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27018';
    if (!/^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(uri)) {
        throw new Error(`Refusing to run tests against ${uri.replace(/\/\/.*@/, '//***@')}: only a local MongoDB is allowed`);
    }
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DB_NAME = `procure_test_${crypto.randomBytes(4).toString('hex')}`;
    process.env.JWT_SECRET = 'test-secret-not-for-production';
    process.env.NODE_ENV = 'test';
    // Tests edit the database directly, behind the app's back, so the short-lived user memory is off unless a test turns it on
    process.env.USER_CACHE_TTL_MS = '0';

    const bcrypt = require('bcryptjs');
    const mongoose = require('mongoose');
    const app = require('../server');
    const db = require('../db');
    const { DEFAULT_ROLES } = require('../constants/permissions');
    await db.connectDB();
    await Promise.all(Object.values(mongoose.models).map(m => m.init()));

    const server = app.listen(0);
    const baseUrl = `http://localhost:${server.address().port}`;
    const PASSWORD = 'password123';
    const hash = await bcrypt.hash(PASSWORD, 4);

    const api = async (method, path, { token, body, raw, headers: extra } = {}) => {
        const res = await fetch(`${baseUrl}/api${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
            body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
        });
        let data = null;
        try { data = await res.json(); } catch (_) { /* not JSON */ }
        return { status: res.status, data, headers: res.headers };
    };
    const login = (email, password = PASSWORD) => api('POST', '/auth/login', { body: { email, password } });

    // roles by name (built-ins created up front); makeRole adds custom ones straight into the database
    const roles = {};
    for (const def of DEFAULT_ROLES) roles[def.name] = await db.Role.create(def);
    const makeRole = async (fields) => {
        const role = await db.Role.create({ category: 'sales', dashboardPage: 'sales.html', color: '#3B9FD9', ...fields });
        roles[role.name] = role;
        return role;
    };
    // a person with a role, and their token
    const makePerson = async (key, role, name = key) => {
        const user = await db.User.create({
            email: `${key}@test.com`, name, password: hash, roleId: role._id,
            role: role.category === 'purchase' ? 'sourcing' : role.category === 'admin' ? 'admin' : 'sales',
        });
        const res = await login(user.email);
        return { user, token: res.data && res.data.token };
    };

    const stop = async () => {
        server.close();
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    };
    return { api, login, db, mongoose, roles, makeRole, makePerson, stop, PASSWORD, baseUrl };
};
