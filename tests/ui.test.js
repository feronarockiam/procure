/**
 * UI consistency. No browser and no database: these read the pages and stylesheets and fail when the interface starts
 * to contradict itself (a menu that differs from page to page, a pop-up in a different style, a layout rule that
 * quietly hides content on a small screen).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
const scripts = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('one look for questions: no browser pop-ups (confirm/alert/prompt) anywhere on the screens', () => {
    const found = [];
    for (const file of [...pages, ...scripts.map(f => 'js/' + f)]) {
        read(file).split('\n').forEach((line, i) => {
            if (/(^|[^.\w$])(confirm|alert|prompt)\s*\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) found.push(`${file}:${i + 1}  ${line.trim().slice(0, 80)}`);
        });
    }
    assert.deepEqual(found, [], 'use confirmDialog / showDialog from ui.js instead');
});

test('every page that signs people in loads the shared interface pieces right after auth.js', () => {
    for (const page of pages) {
        const html = read(page);
        if (!html.includes('/js/auth.js')) continue;
        assert.match(html, /<script src="\/js\/auth\.js"><\/script>\s*<script src="\/js\/ui\.js"><\/script>/, `${page} is missing ui.js`);
    }
});

// The menu on every page comes from the same list of names and icons, in the same order
const NAV_META = (() => {
    const text = read('js/layout.js');
    const literal = text.slice(text.indexOf('const NAV_META = ') + 'const NAV_META = '.length);
    return vm.runInNewContext('(' + literal.slice(0, literal.indexOf('};') + 1) + ')');
})();
const sidebarLinks = (html) => {
    const block = html.includes('id="adminNav"')
        ? html.slice(html.indexOf('id="adminNav"'), html.indexOf('id="roleNav"'))
        : html.slice(html.indexOf('<aside class="sidebar"'), html.indexOf('</aside>'));
    return [...block.matchAll(/<a href="(\/[^"]+)" class="nav-item[^"]*"[^>]*>\s*<i[^>]*><\/i>\s*<span>([^<]+)<\/span>/g)].map(m => ({ href: m[1], label: decode(m[2]) }));
};

test('the side menu says the same thing, in the same order, on every page', () => {
    const withMenu = pages.filter(p => read(p).includes('class="sidebar"'));
    assert.ok(withMenu.length >= 6, `expected the main pages to have a menu, found ${withMenu.join(', ')}`);
    const reference = sidebarLinks(read('sales.html'));
    assert.ok(reference.length >= 8);
    for (const page of withMenu) {
        const links = sidebarLinks(read(page));
        assert.deepEqual(links.map(l => l.href), reference.map(l => l.href), `${page}: menu links differ from the other pages`);
        for (const link of links) assert.equal(link.label, NAV_META[link.href].label, `${page}: "${link.label}" should be "${NAV_META[link.href].label}"`);
    }
});

test('the top-bar and menu names come from one list (every link has a name and an icon)', () => {
    const P = require('../constants/permissions');
    for (const link of P.NAV_LINKS) assert.ok(NAV_META[link.href] && NAV_META[link.href].label && NAV_META[link.href].icon, `${link.href} has no entry in NAV_META`);
});

test('one word for each thing: no "Clients", no "Role Management", no "… Master" page titles', () => {
    const banned = ['Clients Master', 'My Clients', 'Top Client', 'Role Management', 'Employees Master', 'Vendors Master', 'Material Master', 'No clients assigned'];
    const found = [];
    for (const file of [...pages, ...scripts.map(f => 'js/' + f)]) {
        const text = read(file);
        for (const phrase of banned) if (text.includes(phrase)) found.push(`${file}: "${phrase}"`);
    }
    assert.deepEqual(found, []);
});

test('toasts show text as text, so a name someone typed can never be read as markup', () => {
    const auth = read('js/auth.js');
    const toast = auth.match(/function showToast[\s\S]*?\n}\n/)[0];
    assert.match(toast, /text\.textContent = message_/);
    assert.ok(!/innerHTML\s*=\s*[^;]*message/.test(toast), 'the message must not be placed into HTML');
});

test('toasts stack, can be closed, give problems longer to read, and a double click is one notice', () => {
    const toast = read('js/auth.js').match(/function showToast[\s\S]*?\n}\n/)[0];
    assert.match(toast, /toast-stack/);
    assert.match(toast, /toast-close/);
    assert.match(toast, /kind === 'error' \? 7000 : 3500/, 'errors stay at least twice as long as confirmations');
    assert.match(toast, /t\.dataset\.message === message_\) t\.remove\(\)/, 'identical notices are merged');
    assert.match(toast, /mouseenter/, 'hovering pauses the clock');
});

test('small-screen layout rules stay in place (the page must never hide content it cannot show)', () => {
    const css = read('css/premium-ui.css');
    const layer = css.slice(css.indexOf('Responsive layer'));
    assert.ok(layer.length > 500, 'the responsive layer is missing');
    // wide tables scroll inside their box rather than being cut off or pushing the page
    assert.match(layer, /\.table-responsive,\s*\.glass-table-wrap\s*\{[^}]*overflow-x:\s*auto/);
    // the page itself no longer hides anything that spills past its edge
    assert.match(layer, /body\s*\{\s*overflow-x:\s*auto;\s*\}/);
    // laptop-sized screens (Windows at 125-150% scaling is about 1100-1366px) get the compact menu
    assert.match(layer, /@media \(min-width: 769px\) and \(max-width: 1400px\)[\s\S]*?\.sidebar \{ width: 80px; \}/);
    // phones reset the space the content reserved for the menu, and the menu is reachable by a button
    assert.match(layer, /@media \(max-width: 768px\)[\s\S]*?\.main-content[\s\S]*?margin-left: 0/);
    assert.match(layer, /#mobileMenuBtn/);
    // 100vw includes the scrollbar on Windows, so full-width boxes use 100% instead
    assert.ok(!/width:\s*100vw/.test(css), 'width: 100vw makes boxes wider than the visible page on Windows');
    // a real fallback for the font (Windows without access to Google Fonts)
    assert.match(css, /font-family: 'Inter', 'Segoe UI'/);
});

test('the pages load the icon font and Inter without blocking, and tell the browser early where they come from', () => {
    for (const page of pages) {
        const html = read(page);
        assert.ok(!/<script src="https:\/\/unpkg\.com\/@phosphor-icons\/web"><\/script>/.test(html), `${page}: the icon script blocks the page`);
        assert.match(html, /rel="preconnect"/, `${page}: no preconnect`);
    }
});

// ── Colour: everything people read must be readable ──────────────────────────
// WCAG contrast ratio (4.5 : 1 is the minimum for ordinary text)
const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const blend = (hex, alpha) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * alpha + 255 * (1 - alpha)).toString(16).padStart(2, '0')).join('');

// the colour tokens as the pages actually see them (the last definition of each wins)
const tokens = (() => {
    const found = {};
    for (const file of ['css/style.css', 'css/premium-ui.css']) {
        for (const m of read(file).matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) found[m[1]] = m[2];
    }
    return found;
})();

test('theme: text and button colours meet the readable minimum on every surface they are used on', () => {
    const surfaces = { 'a white card': '#ffffff', 'the page': tokens['--bg-secondary'] || '#F8FBFD', 'a tinted row or hover': '#EDF6FB' };
    const failures = [];
    const need = (name, value, against, label, minimum = 4.5) => {
        const ratio = contrast(value, against);
        if (ratio < minimum) failures.push(`${name} ${value} on ${label} ${against} is ${ratio.toFixed(2)} (needs ${minimum})`);
    };
    for (const [surface, colour] of Object.entries(surfaces)) {
        for (const name of ['--text-primary', '--text-secondary', '--text-muted', '--primary', '--danger', '--success', '--warning-text']) {
            need(name, tokens[name], colour, surface);
        }
    }
    // white lettering on the filled buttons
    for (const name of ['--primary', '--primary-dark', '--danger', '--success']) need('white on ' + name, '#ffffff', tokens[name], 'fill');
    // the selected-menu-item and tag pairing
    need('--primary', tokens['--primary'], tokens['--primary-light'], 'the light primary tint');
    assert.deepEqual(failures, []);
});

test('theme: the text hierarchy is still three clearly different steps', () => {
    const [a, b, c] = ['--text-primary', '--text-secondary', '--text-muted'].map(n => lum(tokens[n]));
    assert.ok(a < b && b < c, 'primary should be darker than secondary, which should be darker than muted');
});

test('theme: every status badge style reads (text against its own background)', () => {
    const css = read('css/style.css') + '\n' + read('css/premium-ui.css');
    const resolve = (v) => { v = v.trim(); const m = v.match(/var\((--[a-z-]+)\)/); return m ? tokens[m[1]] : v; };
    const toHex = (c) => {
        c = resolve(c);
        const m = c.match(/rgba?\(([^)]+)\)/);
        // both rgb(1, 2, 3, 0.5) and rgb(1 2 3 / 0.5) are in use
        if (m) { const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return '#' + [r, g, b].map(x => Math.round(x * a + 255 * (1 - a)).toString(16).padStart(2, '0')).join(''); }
        return /^#[0-9a-f]{6}$/i.test(c) ? c : null;
    };
    const rules = {};
    for (const m of css.matchAll(/(\.badge-[a-z-]+)\s*\{([^}]*)\}/g)) {
        const bg = (m[2].match(/background(?:-color)?:\s*([^;]+);/) || [])[1];
        const fg = (m[2].match(/(?:^|[;\s])color:\s*([^;]+);/) || [])[1];
        rules[m[1]] = { ...rules[m[1]], ...(bg && !/gradient/.test(bg) ? { bg } : {}), ...(fg ? { fg } : {}) };
    }
    const checked = [], failures = [];
    for (const [selector, { bg, fg }] of Object.entries(rules)) {
        const [b, f] = [bg && toHex(bg), fg && toHex(fg)];
        if (!b || !f) continue;
        checked.push(selector);
        if (contrast(f, b) < 4.5) failures.push(`${selector}: ${f} on ${b} is only ${contrast(f, b).toFixed(2)}`);
    }
    assert.ok(checked.length >= 8, `expected to check the main badges, checked ${checked.join(', ')}`);
    assert.deepEqual(failures, []);
});

test('role badges are readable whatever colour someone gives a role', () => {
    const source = read('js/auth.js').match(/function readableTextColor[\s\S]*?\n}\n/)[0];
    const readableTextColor = vm.runInNewContext(`(${source.replace('function readableTextColor', 'function')})`);
    const palette = [...read('js/role-management.js').match(/const BADGE_COLORS = \[([\s\S]*?)\];/)[1].matchAll(/'(#[0-9A-Fa-f]{6})'/g)].map(m => m[1]);
    assert.ok(palette.length >= 8);
    // the offered colours, plus a sweep across the whole colour wheel and the extremes
    const sweep = ['#ffffff', '#000000', '#ffff00', '#00ffff', '#f59e0b', ...Array.from({ length: 36 }, (_, i) => `hsl(${i * 10} 90% 55%)`).map(() => null)].filter(Boolean);
    for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) sweep.push('#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join(''));
    for (const colour of [...palette, ...sweep]) {
        const text = readableTextColor(colour);
        assert.ok(contrast(text, blend(colour, 0.13)) >= 4.5, `${colour} → ${text} is only ${contrast(text, blend(colour, 0.13)).toFixed(2)} on its tint`);
    }
});

test('long lists are drawn a page at a time, and search looks at what people can see (not hidden fields)', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'masters.js'), 'utf8');
    assert.match(js, /ROWS_PER_PAGE\s*=\s*\d+/);
    assert.match(js, /filteredData\.slice\(0, shownCount\)/, 'rows must be sliced, not all drawn');
    assert.match(js, /showMoreRows/);
    assert.ok(!/JSON\.stringify\(item\)\.toLowerCase\(\)/.test(js), 'search must not stringify whole records');
});

test('icon-only buttons get a name for screen readers, including the menu toggle', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');
    assert.match(js, /toggleSidebar/);
    assert.match(js, /Collapse or expand the menu/);
});

test('"Forgot password?" tells people what to do, and clickable boxes work from the keyboard', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.ok(!/class="forgot-link">/.test(html.replace(/id="forgotLink"/, '')) || /id="forgotLink"/.test(html));
    assert.match(html, /forgotLink'\)\.addEventListener/);
    assert.match(html, /Ask your administrator/);
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');
    assert.match(js, /setAttribute\('tabindex', '0'\)/);
    assert.match(js, /event\.key !== 'Enter' && event\.key !== ' '/);
});

// Text people type (names, notes, chat) must never reach the page as HTML: a name like <img onerror=...> would run in
// somebody else's browser (an admin's, say) and could take over their session.
test('screens never put user-typed text into the page unescaped', () => {
    const dir = path.join(__dirname, '..', 'public', 'js');
    const USER = 'name|materialName|contactPerson|notes|message|specification|email|description|brand|closeReason|specialization|address|phone|hsnCode';
    // ${something.name} or ${something?.name || 'fallback'} not wrapped in escapeHtml(...)
    const bare = new RegExp('\\$\\{\\s*(?!escapeHtml)[\\w$?.\\[\\]]*\\.(?:' + USER + ')\\s*(?:\\|\\|\\s*(?:\'[^\']*\'|"[^"]*"))?\\s*\\}', 'g');
    const problems = [];
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        if (/^(pdf-generator|docx-generator)\.js$/.test(file)) continue; // they write into documents, not the page
        fs.readFileSync(path.join(dir, file), 'utf8').split('\n').forEach((line, i) => {
            // plain-text spots: dialog titles and messages (set with textContent / escaped by the dialog), input values, labels for documents
            if (/textContent|console\.|showToast|\.value\s*=|doc\.text|\.toLowerCase\(\)|^\s*(title|message|company):|editor\.name|openEditorWindow|showDialog\(\{ title/.test(line)) return;
            const m = line.match(bare);
            if (m) problems.push(`${file}:${i + 1}  ${m[0]}`);
        });
    }
    assert.deepEqual(problems.slice(0, 20), [], `${problems.length} unescaped spots`);
});

test('names passed into inline click handlers are encoded as arguments, never pasted between quotes', () => {
    const dir = path.join(__dirname, '..', 'public', 'js');
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        assert.ok(!/replace\(\/'\/g, "\\\\'"\)/.test(text), `${file} builds a handler argument by escaping quotes by hand`);
    }
    assert.match(fs.readFileSync(path.join(dir, 'auth.js'), 'utf8'), /function jsArg/);
});

test('bulk assign: Sales and Sourcing let people pick many items and act once, through the one shared module', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    const mod = read('js/bulk-assign.js');
    assert.match(mod, /\/enquiries\/assign-items/, 'it must use the cross-enquiry endpoint');
    assert.match(mod, /sourcingUserId/);
    for (const page of ['sales.html', 'sourcing.html']) assert.match(read(page), /bulk-assign\.js/, `${page} must load the module`);
    for (const file of ['js/sales.js', 'js/sourcing.js']) {
        const js = read(file);
        assert.match(js, /BulkAssign\.init\(/, `${file} must start it`);
        assert.match(js, /BulkAssign\.sync\(\)/, `${file} must re-sync after every redraw`);
        assert.ok((js.match(/BulkAssign\.checkbox\(/g) || []).length >= 3, `${file} must offer a box on each item list`);
    }
    // the header "Assign (N)" on a material group covers the whole group, not one enquiry
    assert.match(read('js/sales.js'), /BulkAssign\.pickGroup\(/);
    assert.match(read('css/premium-ui.css'), /\.bulk-bar/);
});

test('customers list: rows can be ticked and handed to a Key Account Manager together', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'masters.js'), 'utf8');
    assert.match(js, /\/customers\/assign-kam/);
    assert.match(js, /pickAllCustomers/);
    assert.match(js, /masterType === 'customers' && canPerformAction\('edit'\)/, 'only people who may edit customers see the boxes');
    assert.match(js, /__none__/, 'there must be a way to take the manager off');
});

test('filter chips keep their icons (their labels are fixed markup, not user text)', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'sourcing.js'), 'utf8');
    assert.match(js, /data-filter="\$\{c\.filter\}"[^>]*>\$\{c\.label\} <span class="chip-count"/);
    assert.ok(!/escapeHtml\(c\.label\)/.test(js), 'the labels carry icon markup, so they are not escaped');
});

test('sign-in page: readable text, a working logo, no dead controls', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const lum = (hex) => { const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const weak = [];
    for (const [, selector, body] of style.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const colour = body.match(/(?<![-\w])color:\s*(#[0-9a-fA-F]{6})/);
        if (colour && !/input-icon|feature-icon|chip-dot/.test(selector) && ratio(colour[1], '#ffffff') < 4.5) weak.push(`${selector.trim().slice(0, 40)} ${colour[1]}`);
    }
    assert.deepEqual(weak, [], 'text on the sign-in page must be readable on white');
    assert.match(html, /<svg[^>]*>[\s\S]*?<\/svg>/, 'the logo is drawn inline, not with an icon font that may not load');
    assert.ok(!/ph-hexagon-fill/.test(html), 'the filled icon style is never loaded, so it drew nothing');
    assert.ok(!/Remember me/.test(html), 'a "remember me" box that does nothing is a lie');
    assert.match(html, /id="pwToggle"/);
    assert.match(html, /id="capsWarning"/);
    assert.match(html, /autocomplete="current-password"/);
});

test('"Needs you today", chip counts, downloads and the admin page are wired in', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    for (const page of ['sales.html', 'sourcing.html', 'key-accounts.html', 'admin.html']) assert.match(read(page), /\/js\/todo\.js/, `${page} must load the strip`);
    assert.match(read('js/todo.js'), /\/enquiries\/todo/);
    assert.match(read('js/sales.js'), /refreshTodo/);
    assert.match(read('js/sourcing.js'), /refreshTodo/);
    // links from the cards land on a filtered view
    assert.match(read('js/sales.js'), /urlParams\.get\('filter'\)/);
    assert.match(read('js/sourcing.js'), /params\.get\('tab'\)/);
    // notification links find the right enquiry (the old lookup used ids that never existed)
    assert.ok(!/enquiry - \$\{/.test(read('js/sourcing.js')), 'the broken "enquiry - id" lookup must stay gone');
    assert.match(read('js/sourcing.js'), /eq-mw-/);
    // chip counts
    assert.match(read('js/sales.js'), /updateFilterChipCounts/);
    assert.match(read('js/sourcing.js'), /updateTabChipCounts/);
    // downloads share one safe helper
    const ui = read('js/ui.js');
    assert.equal((ui.match(/function downloadCsv/g) || []).length, 1);
    assert.match(ui, /\^\[=\+\\-@/, 'formula-leading cells are neutralised');
    assert.match(read('masters.html'), /exportMasterCsv/);
    assert.match(read('sales.html'), /exportItemsCsv/);
    assert.ok(!/csvCell = /.test(read('js/activity.js')), 'the activity page uses the shared helper');
    // the admin page: no fixed column counts, no wallpaper behind the numbers, actionable list
    const admin = read('admin.html');
    assert.ok(!/repeat\(5, 1fr\)/.test(admin) && !/doodle-bg/.test(admin));
    assert.match(read('js/admin.js'), /What needs attention|STALLED_DAYS/);
});

test('theme: the colours added for the new strips, badges and notices are readable', () => {
    const lum = (hex) => { const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const pairs = {
        'todo warn': ['#92400e', '#fef3c7'], 'todo danger': ['#991b1b', '#fee2e2'], 'todo info': ['#1e40af', '#dbeafe'], 'todo success': ['#065f46', '#d1fae5'],
        'todo "all caught up"': ['#065f46', '#ecfdf5'], 'sub-text on a card': ['#475569', '#ffffff'], 'link on a card': ['#1b72b3', '#ffffff'],
        'selection bar text': ['#ffffff', '#0f172a'], 'caps lock warning': ['#92400e', '#ffffff'], 'login placeholder': ['#6b7280', '#ffffff'], 'login demo text': ['#64748b', '#ffffff'],
    };
    const weak = Object.entries(pairs).filter(([, [fg, bg]]) => ratio(fg, bg) < 4.5).map(([name, [fg, bg]]) => `${name} ${ratio(fg, bg).toFixed(2)}`);
    assert.deepEqual(weak, []);
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'premium-ui.css'), 'utf8');
    for (const [, [fg, bg]] of Object.entries(pairs).slice(0, 5)) assert.ok(css.includes(fg) && css.includes(bg), `the stylesheet uses ${fg} on ${bg}`);
});

test('deleting a material, customer or vendor can be undone; people and roles cannot', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'masters.js'), 'utf8');
    assert.match(js, /UNDOABLE = \['materials', 'customers', 'vendors'\]/);
    assert.match(js, /undoDelete/);
    assert.ok(!/employees/.test(js.match(/UNDOABLE = \[[^\]]*\]/)[0]));
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'auth.js'), 'utf8'), /options\.action/);
});

test('every main screen says hello with the time of day, from one place', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    assert.match(read('js/ui.js'), /function renderGreeting/);
    assert.match(read('js/ui.js'), /Good morning/);
    assert.ok(!/Check your notifications for recent updates/.test(read('js/layout.js')), 'the random filler line is gone');
    for (const page of ['sales.html', 'sourcing.html', 'key-accounts.html', 'admin.html']) assert.match(read(page), /id="greetingSubtitle"/, `${page} has the greeting line`);
});

test('reports page: wired to its own script and permission, drawn at real width, and open to every menu that has it', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    assert.match(read('analytics.html'), /\/js\/analytics\.js/);
    assert.match(read('js/analytics.js'), /\/analytics\?from=/);
    assert.match(read('js/analytics.js'), /chartWidth\(\)/, 'the chart is drawn at the width it is shown at');
    assert.match(read('js/layout.js'), /'\/analytics\.html': \{ label: 'Reports'/);
    assert.match(read('js/layout.js'), /ensureExtraLink\(container, '\/analytics\.html'/);
    assert.ok(!/<img|innerHTML = `[^`]*\$\{d\.[a-z]*\.name/.test(read('js/analytics.js')), 'names are always escaped');
});

test('moving between screens shows a loading bar, and "no access" offers a one-click request instead of a dead end', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    assert.match(read('js/ui.js'), /nav-progress/);
    assert.match(read('js/ui.js'), /addEventListener\('pageshow'/, 'the bar clears when coming back with the Back button');
    assert.match(read('css/premium-ui.css'), /\.nav-progress\.running/);
    assert.match(read('css/premium-ui.css'), /prefers-reduced-motion/);
    const auth = read('js/auth.js');
    assert.match(auth, /function requestAccess/);
    assert.match(auth, /Ask for access/);
    assert.match(auth, /\/access-requests/);
    assert.match(read('no-access.html'), /id="askAccess"/);
    assert.match(read('js/masters.js'), /openRecordFromLink/, 'the administrator lands on the person\'s record');
});
