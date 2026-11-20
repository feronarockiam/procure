// The list of real permission keys, in a stable order. (The wording people read lives in the catalogue below;
// the text here is only a note for developers.)
const PERMISSIONS = {
  // Enquiry Management
  'enquiry.view.all':                 'View all enquiries across all users and customers',
  'enquiry.view.own':                 'View only enquiries created by me',
  'enquiry.view.assigned':            'View only enquiries/items assigned to me (purchase PIC)',
  'enquiry.view.assigned_customers':  'View only enquiries for customers assigned to me (KAM)',
  'enquiry.create':                   'Create a new enquiry',
  'enquiry.assign':                   'Assign enquiry or items to a purchase team member',
  'enquiry.self_assign':              'Pick a case from the New queue and self-assign',
  'enquiry.mark_unsuccessful':        'Mark an enquiry item as unsuccessful',
  'enquiry.combine':                  'Merge or combine enquiries',
  'enquiry.bulk_create':              'Create enquiries in bulk via Excel upload',
  'enquiry.reopen':                   'Reopen a completed or unsuccessful enquiry',

  // Sales Pricing & Quotation
  'sales_price.add':                  'Set sales price on enquiry items',
  'sales_price.approve':              'Approve and finalise a sales quotation',
  'quotation.download':               'Download quotation as PDF or DOCX',
  'quotation.send':                   'Mark quotation as sent to customer (completes enquiry)',

  // Purchase / Vendor Operations
  'purchase_price.add':               'Enter vendor quotation / purchase price on items',
  'query.send':                       'Send and respond to enquiry queries',

  // Material Master
  'material.view':                    'View materials list',
  'material.create':                  'Create a new material',
  'material.edit':                    'Edit material details',
  'material.delete':                  'Delete a material',

  // Customer Master
  'customer.view':                    'View customer list',
  'customer.create':                  'Create a new customer',
  'customer.edit':                    'Edit customer details',
  'customer.delete':                  'Delete a customer',

  // Vendor Master
  'vendor.view':                      'View vendor list',
  'vendor.create':                    'Create a new vendor',
  'vendor.edit':                      'Edit vendor details',
  'vendor.delete':                    'Delete a vendor',

  // User & Role Management
  'user.view':                        'View employee list',
  'user.create':                      'Create a new employee',
  'user.edit':                        'Edit employee details',
  'user.delete':                      'Delete an employee',
  'role.view':                        'View roles and permissions',
  'role.create':                      'Create a new role',
  'role.edit':                        'Edit role permissions',
  'role.delete':                      'Delete a role',

  // Dashboard & Filtering
  'dashboard.admin':                  'Access admin analytics dashboard',
  'dashboard.insights':               'View team performance and insights',
  'filter.by_sourcing_user':          'Filter enquiries by assigned purchase team member',
  'filter.by_key_account_manager':    'Filter enquiries by Key Account Manager',

  // Activity log
  'audit.view':                       'See the activity log: who did what, and when',
  'analytics.view':                   'See reports: volumes, speed, people, customers, vendors',
};

const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

const DEFAULT_ROLES = [
  {
    name: 'Admin',
    description: 'Everything: every enquiry, prices, all lists, employees and roles.',
    permissions: ALL_PERMISSIONS,
    category: 'admin',
    leadsTeam: true,
    dashboardPage: 'admin.html',
    color: '#10B981',
    isSystem: true,
  },
  {
    name: 'Sales Operations – Entry',
    description: 'Raises enquiries for customers, sets the selling price and downloads quotations.',
    permissions: [
      'enquiry.create',
      'enquiry.view.own',
      'enquiry.combine',
      'sales_price.add',
      'quotation.download',
      'query.send',
      'customer.view',
      'customer.create',
      'material.view',
      'vendor.view',
    ],
    category: 'sales',
    leadsTeam: false,
    dashboardPage: 'sales.html',
    color: '#8B5CF6',
    isSystem: true,
  },
  {
    name: 'Sales Operations – Manager',
    description: 'Runs the sales pipeline: sees every enquiry, hands work to purchase, closes and reopens enquiries.',
    permissions: [
      'enquiry.create',
      'enquiry.view.all',
      'enquiry.view.own',
      'enquiry.self_assign',
      'enquiry.assign',
      'enquiry.combine',
      'enquiry.bulk_create',
      'enquiry.mark_unsuccessful',
      'enquiry.reopen',
      'sales_price.add',
      'sales_price.approve',
      'quotation.download',
      'quotation.send',
      'query.send',
      'filter.by_sourcing_user',
      'customer.view',
      'customer.create',
      'material.view',
      'vendor.view',
      'dashboard.insights',
    ],
    category: 'sales',
    leadsTeam: true,
    dashboardPage: 'sales.html',
    color: '#6D28D9',
    isSystem: true,
  },
  {
    name: 'Purchase Operations – Entry',
    description: 'Picks up items, enters vendor prices and asks sales questions.',
    permissions: [
      'enquiry.view.assigned',
      'enquiry.self_assign',
      'purchase_price.add',
      'query.send',
      'material.view',
      'customer.view',
      'vendor.view',
      'vendor.create',
    ],
    category: 'purchase',
    leadsTeam: false,
    dashboardPage: 'sourcing.html',
    color: '#F59E0B',
    isSystem: true,
  },
  {
    name: 'Purchase Operations – Manager',
    description: 'Runs purchasing: sees every enquiry, assigns work, manages materials and vendors.',
    permissions: [
      'enquiry.view.all',
      'enquiry.view.assigned',
      'enquiry.self_assign',
      'enquiry.assign',
      'enquiry.reopen',
      'purchase_price.add',
      'query.send',
      'filter.by_sourcing_user',
      'material.view',
      'material.create',
      'material.edit',
      'customer.view',
      'vendor.view',
      'vendor.create',
      'vendor.edit',
      'dashboard.insights',
    ],
    category: 'purchase',
    leadsTeam: true,
    dashboardPage: 'sourcing.html',
    color: '#D97706',
    isSystem: true,
  },
  {
    name: 'Key Accounts – Entry',
    description: 'Follows the enquiries of the customers they look after and downloads quotations.',
    permissions: [
      'enquiry.view.assigned_customers',
      'customer.view',
      'quotation.download',
      'query.send',
    ],
    category: 'key_accounts',
    leadsTeam: false,
    dashboardPage: 'key-accounts.html',
    color: '#3B82F6',
    isSystem: true,
  },
  {
    name: 'Key Accounts – Manager',
    description: 'Oversees every customer enquiry and manages the key account team and their customers.',
    permissions: [
      'enquiry.view.all',
      'enquiry.view.assigned_customers',
      'filter.by_key_account_manager',
      'customer.view',
      'customer.create',
      'customer.edit',
      'quotation.download',
      'query.send',
      'dashboard.insights',
    ],
    category: 'key_accounts',
    leadsTeam: true,
    dashboardPage: 'key-accounts.html',
    color: '#1D4ED8',
    isSystem: true,
  },
];


// ═════════════════════════════════════════════════════════════════════════════
// Plain-language catalogue
//
// One place that says, in words an office administrator understands, what each
// permission means, which ones depend on others, which screens they open, and how
// to describe a role in a sentence. The server builds every answer from here and the
// pages only display it, so the editor, the employee form and the API can't disagree.
// The permission KEYS above never change (existing roles and the route guards use them).
// ═════════════════════════════════════════════════════════════════════════════

const VIEW_KEYS = [
  'enquiry.view.own',
  'enquiry.view.assigned',
  'enquiry.view.assigned_customers',
  'enquiry.view.all',
];

// label  — what the checkbox says
// short  — how it reads inside a sentence ("Can …")
// needs  — other permissions this one cannot work without (switched on automatically)
// needsView — which "see enquiries" choice to switch on if the role has none yet
// hidden — kept valid on existing roles but not offered (the app does nothing with it yet)
const ITEMS = {
  'enquiry.view.own': {
    label: 'Enquiries they created themselves',
    short: 'the enquiries they created',
    help: 'The usual choice for people who raise enquiries.',
  },
  'enquiry.view.assigned': {
    label: 'Enquiries with items assigned to them, plus new items waiting to be picked up',
    short: 'enquiries assigned to them and the waiting list of new items',
    help: 'The working list for the purchase team.',
  },
  'enquiry.view.assigned_customers': {
    label: 'Enquiries for the customers they look after',
    short: 'the enquiries of customers they look after',
    help: 'For key account managers. A customer is given to a person in the Customers list (the "Key Account Manager" field).',
  },
  'enquiry.view.all': {
    label: 'Every enquiry in the company',
    short: 'every enquiry in the company',
    help: 'For managers. This includes all the choices above.',
  },

  'enquiry.create': {
    label: 'Create new enquiries',
    short: 'create enquiries',
    help: 'Choose a customer and materials, then send the enquiry to the purchase team.',
    needs: ['customer.view', 'material.view'],
    needsView: 'enquiry.view.own',
  },
  'enquiry.bulk_create': {
    label: 'Create many enquiries at once from an Excel sheet',
    short: 'upload enquiries from Excel',
    needs: ['enquiry.create'],
  },
  'enquiry.combine': {
    label: 'Merge enquiries (move items from one enquiry into another)',
    short: 'merge enquiries',
    needsView: 'enquiry.view.own',
  },
  'enquiry.assign': {
    label: 'Choose which purchase person works on an item',
    short: 'hand out work to the purchase team',
    help: 'For managers. Without this, people can only pick items up for themselves.',
    needsView: 'enquiry.view.all',
  },
  'enquiry.self_assign': {
    label: 'Pick up new items from the waiting list for themselves',
    short: 'pick up new items for themselves',
    help: 'This also lets them see the waiting list of new items.',
  },
  'enquiry.mark_unsuccessful': {
    label: 'Close an enquiry or an item as lost (unsuccessful)',
    short: 'close enquiries as lost',
    needsView: 'enquiry.view.own',
  },
  'enquiry.reopen': {
    label: 'Reopen enquiries that were closed',
    short: 'reopen closed enquiries',
    needsView: 'enquiry.view.all',
  },
  'query.send': {
    label: 'Chat about an enquiry (ask and answer questions)',
    short: 'chat about enquiries',
    needsView: 'enquiry.view.own',
  },

  'purchase_price.add': {
    label: 'Enter vendor prices (what we pay our suppliers)',
    short: 'enter vendor prices',
    needs: ['vendor.view'],
    needsView: 'enquiry.view.assigned',
  },
  'sales_price.add': {
    label: 'Set the selling price (what the customer pays)',
    short: 'set selling prices',
    needsView: 'enquiry.view.own',
  },
  'quotation.download': {
    label: 'Download quotations as PDF or Word',
    short: 'download quotations',
    needsView: 'enquiry.view.own',
  },
  'quotation.send': {
    label: 'Mark a quotation as sent (this marks the item successful)',
    short: 'mark quotations as sent',
    help: 'The selling price has to be set first.',
    needsView: 'enquiry.view.own',
  },
  'sales_price.approve': { hidden: true, label: 'Approve selling prices', short: 'approve selling prices' },

  'dashboard.admin': {
    label: 'Open the Admin dashboard (company-wide numbers and charts)',
    short: 'open the admin dashboard',
    needs: ['enquiry.view.all'],
  },
  // The server supports it, but no screen has this filter yet, so it isn't offered (existing roles keep it)
  'filter.by_sourcing_user': { hidden: true, label: 'Filter enquiries by purchase person', short: 'filter enquiries by purchase person' },
  'filter.by_key_account_manager': {
    label: 'Filter by key account manager, and see the "My Team" tab',
    short: 'filter by key account manager',
    needsView: 'enquiry.view.all',
  },
  'dashboard.insights': { hidden: true, label: 'See team insights', short: 'see team insights' },

  'analytics.view': {
    label: 'See reports and trends (company-wide figures)',
    short: 'see reports and trends',
    help: 'How many enquiries came in, how fast they move, who is carrying the work, and which customers, materials and vendors matter most. It shows company-wide figures.',
  },

  'audit.view': {
    label: 'See the activity log (who did what, and when)',
    short: 'see the activity log',
    help: 'Every change to enquiries, prices, people and roles, with the person and the time. The history of a single enquiry is visible to anyone who can see that enquiry.',
  },
};

// Lists the app keeps: each has See / Add / Edit / Delete. Anything beyond "See" needs "See".
const RECORDS = [
  { id: 'materials', label: 'Materials', short: 'materials', help: 'The list of materials and their units.',
    keys: { view: 'material.view', create: 'material.create', edit: 'material.edit', delete: 'material.delete' } },
  { id: 'customers', label: 'Customers', short: 'customers', help: 'The companies you sell to.',
    keys: { view: 'customer.view', create: 'customer.create', edit: 'customer.edit', delete: 'customer.delete' } },
  { id: 'vendors', label: 'Vendors', short: 'vendors', help: 'The suppliers who give you prices.',
    keys: { view: 'vendor.view', create: 'vendor.create', edit: 'vendor.edit', delete: 'vendor.delete' } },
  { id: 'employees', label: 'Employees', short: 'employees', sensitive: true,
    help: 'The people who can log in. "Add new" and "Edit" also let them give someone a role.',
    keys: { view: 'user.view', create: 'user.create', edit: 'user.edit', delete: 'user.delete' } },
  { id: 'roles', label: 'Roles & access', short: 'roles and access', sensitive: true,
    help: 'Lets them change what everybody in the company can see and do.',
    keys: { view: 'role.view', create: 'role.create', edit: 'role.edit', delete: 'role.delete' } },
];
const RECORD_COLUMNS = [
  { id: 'view', label: 'See the list', verb: 'see' },
  { id: 'create', label: 'Add new', verb: 'add' },
  { id: 'edit', label: 'Edit', verb: 'edit' },
  { id: 'delete', label: 'Delete', verb: 'delete', sensitive: true },
];

const SECTIONS = [
  { id: 'see', title: 'Which enquiries can they see?', type: 'checklist',
    intro: 'Tick everything that applies. The choices add together.',
    keys: VIEW_KEYS },
  { id: 'work', title: 'What can they do with enquiries?', type: 'checklist',
    keys: ['enquiry.create', 'enquiry.bulk_create', 'enquiry.combine', 'enquiry.assign', 'enquiry.self_assign',
           'enquiry.mark_unsuccessful', 'enquiry.reopen', 'query.send'] },
  { id: 'prices', title: 'Prices and quotations', type: 'checklist',
    keys: ['purchase_price.add', 'sales_price.add', 'quotation.download', 'quotation.send'] },
  { id: 'records', title: 'Lists they can manage', type: 'matrix',
    intro: 'For each list, choose what they may do. Adding, editing or deleting always includes seeing the list.' },
  { id: 'company', title: 'Company-wide screens and filters', type: 'checklist',
    keys: ['dashboard.admin', 'filter.by_key_account_manager', 'analytics.view', 'audit.view'] },
];

const TEAMS = [
  { value: 'sales', label: 'Sales team', help: 'People who raise enquiries and set selling prices.' },
  { value: 'purchase', label: 'Purchase team', help: 'People who get prices from vendors.' },
  { value: 'key_accounts', label: 'Key Accounts team', help: 'People who look after important customers.' },
  { value: 'admin', label: 'Administration', help: 'People who run the system.' },
];

// The screens people can start on. A role may start on a screen only if it can open it.
const PAGES = [
  { file: 'admin.html', label: 'Admin dashboard', help: 'Company-wide numbers and charts.',
    needsAny: ['dashboard.admin'] },
  { file: 'sales.html', label: 'Sales & Enquiries', help: 'Create enquiries, set selling prices, download quotations.',
    needsAny: ['enquiry.create', 'enquiry.view.own', 'enquiry.view.all', 'sales_price.add', 'enquiry.combine', 'enquiry.bulk_create', 'quotation.send'] },
  { file: 'sourcing.html', label: 'Sourcing / Purchase', help: 'Pick up items and enter vendor prices.',
    needsAny: ['purchase_price.add', 'enquiry.view.assigned', 'enquiry.self_assign'] },
  { file: 'key-accounts.html', label: 'Key Accounts', help: 'Enquiries of the customers you look after.',
    needsAny: ['enquiry.view.assigned_customers'] },
];
const TEAM_PAGE = { admin: 'admin.html', sales: 'sales.html', purchase: 'sourcing.html', key_accounts: 'key-accounts.html' };

// Every link the menus may show, with what each one needs. The browser never decides this itself.
const NAV_LINKS = [
  ...PAGES.map(p => ({ href: '/' + p.file, needsAny: p.needsAny })),
  { href: '/masters.html?type=materials', needsAny: ['material.view'] },
  { href: '/masters.html?type=customers', needsAny: ['customer.view'] },
  { href: '/masters.html?type=vendors', needsAny: ['vendor.view'] },
  { href: '/masters.html?type=employees', needsAny: ['user.view'] },
  { href: '/role-management.html', needsAny: ['role.view'] },
  { href: '/analytics.html', needsAny: ['analytics.view'] },
  { href: '/activity.html', needsAny: ['audit.view'] },
];

const labelOf = (key) => (ITEMS[key] && ITEMS[key].label) || recordLabel(key) || key;
// "See the Customers list", "Add to Materials", "Edit Vendors", "Delete from Customers"
const RECORD_PHRASES = {
  view: (name) => `See the ${name} list`,
  create: (name) => `Add to ${name}`,
  edit: (name) => `Edit ${name}`,
  delete: (name) => `Delete from ${name}`,
};
function recordLabel(key) {
  for (const r of RECORDS) {
    for (const col of RECORD_COLUMNS) {
      if (r.keys[col.id] === key) return RECORD_PHRASES[col.id](r.label);
    }
  }
  return null;
}

const ACTION_KEYS = SECTIONS.filter(s => s.id === 'work' || s.id === 'prices' || s.id === 'company').flatMap(s => s.keys);

/**
 * Tidy a list of permissions:
 *  - drops anything that isn't a real permission (reported in `unknown`)
 *  - switches on what the chosen permissions cannot work without (reported in `added`)
 * It never removes anything the admin chose.
 */
function normalizePermissions(input) {
  const unknown = [];
  const set = new Set();
  for (const key of Array.isArray(input) ? input : []) {
    if (ALL_PERMISSIONS.includes(key)) set.add(key); else unknown.push(key);
  }

  const added = [];
  const turnOn = (key, because) => { if (!set.has(key)) { set.add(key); added.push({ key, because }); } };

  let size;
  do {
    size = set.size;
    for (const key of [...set]) {
      const item = ITEMS[key] || {};
      (item.needs || []).forEach(need => turnOn(need, key));
      if (item.needsView && !VIEW_KEYS.some(v => set.has(v))) turnOn(item.needsView, key);
    }
    for (const rec of RECORDS) {
      const beyondView = ['create', 'edit', 'delete'].find(v => set.has(rec.keys[v]));
      if (beyondView) turnOn(rec.keys.view, rec.keys[beyondView]);
    }
  } while (set.size !== size);

  return { permissions: ALL_PERMISSIONS.filter(k => set.has(k)), added, unknown };
}

const explainAdded = (added) => added.map(a => `We also turned on "${labelOf(a.key)}" because "${labelOf(a.because)}" needs it.`);

const allowedPages = (permissions) => {
  const set = new Set(permissions || []);
  return PAGES.filter(page => page.needsAny.some(k => set.has(k)));
};

const allowedLinks = (permissions) => {
  const set = new Set(permissions || []);
  return NAV_LINKS.filter(link => link.needsAny.some(k => set.has(k))).map(link => link.href);
};

// Where a person lands after logging in: the role's chosen page if they can open it, otherwise the natural
// page for their team, otherwise the first main page they can open. A role that only manages a list
// (say Materials) starts on that list. Null means they can open nothing at all.
function effectiveLanding({ permissions, category, dashboardPage }) {
  const files = allowedPages(permissions).map(p => p.file);
  if (files.includes(dashboardPage)) return dashboardPage;
  if (files.includes(TEAM_PAGE[category])) return TEAM_PAGE[category];
  if (files.length) return files[0];
  const firstLink = allowedLinks(permissions)[0];
  return firstLink ? firstLink.replace(/^\//, '') : null;
}

// "Leads a team" is a setting on the role. Roles made before the setting existed
// follow the old naming convention until an administrator sets it.
const roleLeadsTeam = (role) => (typeof role.leadsTeam === 'boolean' ? role.leadsTeam : /manager/i.test(role.name || ''));

/** A role in plain words, for cards, the employee form and the editor's live preview. */
function describeRole(permissions) {
  const set = new Set(permissions || []);
  const sees = set.has('enquiry.view.all')
    ? [ITEMS['enquiry.view.all'].short]
    : VIEW_KEYS.filter(k => set.has(k)).map(k => ITEMS[k].short);
  const can = ACTION_KEYS.filter(k => set.has(k)).map(k => ITEMS[k].short);
  const manages = RECORDS
    .map(rec => ({
      label: rec.label,
      verbs: RECORD_COLUMNS.filter(col => set.has(rec.keys[col.id])).map(col => col.verb),
      sensitive: !!rec.sensitive,
    }))
    .filter(m => m.verbs.length);

  const lines = [];
  if (sees.length) lines.push({ icon: 'eye', title: 'Sees', text: sees.join('; ') });
  if (can.length) lines.push({ icon: 'check-circle', title: 'Can', text: can.join(', ') });
  if (manages.length) {
    lines.push({
      icon: 'database', title: 'Lists',
      text: manages.map(m => `${m.label} (${m.verbs.join(', ')})`).join('; '),
    });
  }
  if (!lines.length) lines.push({ icon: 'prohibit', title: 'Access', text: 'Nothing yet. Tick what this role should be able to do.' });
  return { sees, can, manages, lines };
}

// Things worth telling the admin about (not errors)
function roleWarnings(permissions) {
  const set = new Set(permissions || []);
  const warnings = [];
  if (set.size === 0) {
    warnings.push({ level: 'warning', text: 'This role cannot do anything yet, so people with it will see an empty screen.' });
  } else if (allowedLinks(permissions).length === 0) {
    warnings.push({ level: 'warning', text: 'People with this role will not be able to open any screen. Add something under "Which enquiries can they see?" or "Lists they can manage".' });
  }
  if (['user.create', 'user.edit', 'role.create', 'role.edit'].some(k => set.has(k))) {
    warnings.push({ level: 'info', text: 'People with this role can change what other people are allowed to do. Give it only to people you trust with that.' });
  }
  return warnings;
}

// What the editor needs to draw itself — nothing is hard-coded in the browser.
// Ready-made starting points offered when creating a role (the built-in roles can already be copied; these are the
// combinations people ask for that no built-in covers). Each is checked against the real permission list at start-up.
const ROLE_TEMPLATES = [
  {
    id: 'all-rounder',
    name: 'All-rounder (sales and purchase)',
    description: 'One person runs an enquiry from start to finish: raises it, enters vendor prices, sets the selling price and sends the quotation.',
    category: 'sales',
    leadsTeam: false,
    permissions: ['enquiry.create', 'enquiry.view.own', 'enquiry.self_assign', 'enquiry.combine', 'purchase_price.add', 'sales_price.add',
      'quotation.send', 'quotation.download', 'query.send', 'material.view', 'customer.view', 'customer.create', 'vendor.view', 'vendor.create'],
  },
  {
    id: 'quotation-desk',
    name: 'Quotation desk',
    description: 'Sees every enquiry and downloads quotations. Cannot change anything.',
    category: 'sales',
    leadsTeam: false,
    permissions: ['enquiry.view.all', 'quotation.download', 'customer.view', 'material.view'],
  },
  {
    id: 'view-only',
    name: 'View only',
    description: 'Can look at every enquiry and list, but cannot add or change anything.',
    category: 'sales',
    leadsTeam: false,
    permissions: ['enquiry.view.all', 'material.view', 'customer.view', 'vendor.view'],
  },
];
for (const template of ROLE_TEMPLATES) {
  const unknown = template.permissions.filter(k => !ALL_PERMISSIONS.includes(k));
  if (unknown.length) throw new Error(`Role template "${template.id}" uses permissions that do not exist: ${unknown.join(', ')}`);
}

function buildCatalogue() {
  const itemFor = (key) => ({
    key,
    label: ITEMS[key].label,
    help: ITEMS[key].help || '',
  });
  return {
    sections: SECTIONS.map(section => section.type === 'matrix'
      ? { id: section.id, title: section.title, intro: section.intro, type: 'matrix',
          columns: RECORD_COLUMNS.map(({ id, label, sensitive }) => ({ id, label, sensitive: !!sensitive })),
          rows: RECORDS.map(({ id, label, help, sensitive, keys }) => ({ id, label, help, sensitive: !!sensitive, keys })) }
      : { id: section.id, title: section.title, intro: section.intro || '', type: 'checklist',
          items: section.keys.filter(k => !ITEMS[k].hidden).map(itemFor) }),
    hiddenKeys: Object.keys(ITEMS).filter(k => ITEMS[k].hidden),
    teams: TEAMS,
    templates: ROLE_TEMPLATES.map(t => ({ ...t, permissions: normalizePermissions(t.permissions).permissions })),
    pages: PAGES.map(({ file, label, help, needsAny }) => ({ file, label, help, needsAny })),
  };
}

module.exports = {
  PERMISSIONS, ALL_PERMISSIONS, DEFAULT_ROLES, ROLE_TEMPLATES,
  VIEW_KEYS, ITEMS, RECORDS, TEAMS, PAGES, NAV_LINKS,
  normalizePermissions, explainAdded, allowedPages, effectiveLanding, allowedLinks,
  roleLeadsTeam, describeRole, roleWarnings, buildCatalogue, labelOf,
};
