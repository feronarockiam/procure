// Everything that depends on WHERE the app is running, in one place. Read at the moment of use (not at load) so the
// tests can change the environment, and so a value set in cPanel's "Setup Node.js App" screen is always honoured.

const truthy = (value) => /^(1|true|yes|on)$/i.test(String(value || ''));
const isProduction = () => process.env.NODE_ENV === 'production';

// Other websites allowed to call this API from a browser. Leave empty when the pages and the API share one address
// (the normal case: nothing else needs to be allowed). Comma separated, e.g. https://procure.example.com
const corsOrigins = () => (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);

// The one-click demo sign-in chips (and the shared demo password they print) are for demos and development only.
// Off by default in production; set SHOW_DEMO_LOGIN=true to show them on purpose.
const showDemoLogin = () => (process.env.SHOW_DEMO_LOGIN !== undefined ? truthy(process.env.SHOW_DEMO_LOGIN) : !isProduction());

const minPasswordLength = () => Math.max(6, Number(process.env.MIN_PASSWORD_LENGTH || 6));

const WEAK_SECRETS = ['secret', 'changeme', 'change-me', 'your_jwt_secret_key_here', 'jwt_secret', 'password', 'test-secret-not-for-production'];

// Checked when the app starts. `fatal` problems stop a production start (a half-configured production app that
// "works" is worse than one that says what is missing); in development they are only warnings.
function validateConfig(env = process.env) {
    const fatal = [];
    const warnings = [];
    const production = env.NODE_ENV === 'production';
    const problem = (list, text) => list.push(text);

    if (!env.MONGODB_URI) problem(fatal, 'MONGODB_URI is not set (the MongoDB connection string).');
    else if (!/^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI)) problem(fatal, 'MONGODB_URI does not look like a MongoDB connection string (it should start with mongodb:// or mongodb+srv://).');

    if (!env.JWT_SECRET) problem(fatal, 'JWT_SECRET is not set. It signs every login; generate one with: npm run generate-secret');
    else if (env.JWT_SECRET.length < 32 || WEAK_SECRETS.includes(env.JWT_SECRET.toLowerCase())) {
        problem(production ? fatal : warnings, 'JWT_SECRET is too short or too guessable (use 32+ random characters: npm run generate-secret).');
    }

    if (production && !env.MONGODB_DB_NAME && env.MONGODB_URI && !/mongodb(\+srv)?:\/\/[^/]+\/[^/?]+/.test(env.MONGODB_URI)) {
        problem(warnings, 'No database name: the connection string ends at the host and MONGODB_DB_NAME is not set, so MongoDB will use a database called "test".');
    }
    if (production && String(env.SHOW_DEMO_LOGIN || '').match(/^(1|true|yes|on)$/i)) {
        problem(warnings, 'SHOW_DEMO_LOGIN is on: the sign-in page lists demo accounts and the shared demo password. Turn it off for real use.');
    }
    return { fatal, warnings };
}

module.exports = { isProduction, corsOrigins, showDemoLogin, minPasswordLength, validateConfig, truthy };
