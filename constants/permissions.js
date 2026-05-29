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
};

// Grouped for UI rendering (role management permission checkboxes)
const PERMISSION_GROUPS = [
  {
    group: 'Enquiry Management',
    keys: [
      'enquiry.create',
      'enquiry.view.own',
      'enquiry.view.all',
      'enquiry.view.assigned',
      'enquiry.view.assigned_customers',
      'enquiry.self_assign',
      'enquiry.assign',
      'enquiry.mark_unsuccessful',
      'enquiry.combine',
      'enquiry.bulk_create',
      'enquiry.reopen',
    ],
  },
  {
    group: 'Sales Pricing & Quotation',
    keys: [
      'sales_price.add',
      'sales_price.approve',
      'quotation.download',
      'quotation.send',
    ],
  },
  {
    group: 'Purchase & Vendor Operations',
    keys: [
      'purchase_price.add',
      'query.send',
    ],
  },
  {
    group: 'Material Master',
    keys: ['material.view', 'material.create', 'material.edit', 'material.delete'],
  },
  {
    group: 'Customer Master',
    keys: ['customer.view', 'customer.create', 'customer.edit', 'customer.delete'],
  },
  {
    group: 'Vendor Master',
    keys: ['vendor.view', 'vendor.create', 'vendor.edit', 'vendor.delete'],
  },
  {
    group: 'User & Role Management',
    keys: ['user.view', 'user.create', 'user.edit', 'user.delete', 'role.view', 'role.create', 'role.edit', 'role.delete'],
  },
  {
    group: 'Dashboard & Filters',
    keys: ['dashboard.admin', 'dashboard.insights', 'filter.by_sourcing_user', 'filter.by_key_account_manager'],
  },
];

const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

const DEFAULT_ROLES = [
  {
    name: 'Admin',
    description: 'Full system access — can act across all departments',
    permissions: ALL_PERMISSIONS,
    category: 'admin',
    dashboardPage: 'admin.html',
    color: '#10B981',
    isSystem: true,
  },
  {
    name: 'Sales Operations – Entry',
    description: 'Can create enquiries, set sales prices and download quotations',
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
    dashboardPage: 'sales.html',
    color: '#8B5CF6',
    isSystem: true,
  },
  {
    name: 'Sales Operations – Manager',
    description: 'Full sales access — approves quotations, assigns sourcing, manages pipeline',
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
    dashboardPage: 'sales.html',
    color: '#6D28D9',
    isSystem: true,
  },
  {
    name: 'Purchase Operations – Entry',
    description: 'Can add vendor prices and send queries for assigned enquiry items',
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
    dashboardPage: 'sourcing.html',
    color: '#F59E0B',
    isSystem: true,
  },
  {
    name: 'Purchase Operations – Manager',
    description: 'Full purchase access — manages all items, creates materials and vendors',
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
    dashboardPage: 'sourcing.html',
    color: '#D97706',
    isSystem: true,
  },
  {
    name: 'Key Accounts – Entry',
    description: 'Sees enquiries for assigned customers — open, closed, unsuccessful',
    permissions: [
      'enquiry.view.assigned_customers',
      'customer.view',
      'quotation.download',
      'query.send',
    ],
    category: 'key_accounts',
    dashboardPage: 'key-accounts.html',
    color: '#3B82F6',
    isSystem: true,
  },
  {
    name: 'Key Accounts – Manager',
    description: 'Sees all customer enquiries with KAM filter; can manage customers',
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
    dashboardPage: 'key-accounts.html',
    color: '#1D4ED8',
    isSystem: true,
  },
];

module.exports = { PERMISSIONS, PERMISSION_GROUPS, ALL_PERMISSIONS, DEFAULT_ROLES };
