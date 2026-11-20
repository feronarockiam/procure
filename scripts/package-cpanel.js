/**
 * Builds procure-cpanel.zip: the files to upload to cPanel. Not included on purpose:
 *   node_modules   cPanel installs them for you ("Run NPM Install"), built for the server's own system
 *   .env*          your secrets are typed into the cPanel Node.js App screen, never uploaded
 *   tests, git, Vercel files, one-off sample/seed files
 *
 * Usage: npm run package        (needs the `zip` command, which Mac and Linux have; on Windows use "Send to > Compressed folder"
 *                                on the files listed in DEPLOY-CPANEL.md)
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'procure-cpanel.zip');

const INCLUDE = ['app.js', 'server.js', 'config.js', 'db.js', 'package.json', 'package-lock.json',
    'constants', 'middleware', 'routes', 'utils', 'public', 'scripts/create-admin.js', 'scripts/generate-secret.js', 'scripts/smoke.js',
    'DEPLOY-CPANEL.md', 'DEPLOY-VERCEL.md', '.env.production.example'];
const EXCLUDE = ['*.DS_Store', '*.xlsx', '*.docx', '*.log'];

const missing = INCLUDE.filter(p => !fs.existsSync(path.join(root, p)));
if (missing.length) { console.error('Missing from the project:', missing.join(', ')); process.exit(1); }
if (fs.existsSync(out)) fs.unlinkSync(out);

try {
    execFileSync('zip', ['-r', '-q', out, ...INCLUDE, '-x', ...EXCLUDE], { cwd: root, stdio: 'inherit' });
} catch (error) {
    console.error('Could not run `zip` here. Zip these yourself (not node_modules, not .env):\n  ' + INCLUDE.join('\n  '));
    process.exit(1);
}
const listing = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' }).split('\n').filter(Boolean);
const leaked = listing.filter(f => /(^|\/)(\.env($|\.local)|node_modules\/)/.test(f));
if (leaked.length) { fs.unlinkSync(out); console.error('Refusing to build: secrets or node_modules ended up in the zip:', leaked.slice(0, 5)); process.exit(1); }
console.log(`Built ${path.basename(out)}: ${listing.length} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
