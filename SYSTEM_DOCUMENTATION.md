# Precise Procure — Manual Testing Guide

> **Server**: `http://localhost:5000`  
> **Stack**: Node.js + Express + MongoDB Atlas  
> **Auth**: JWT (stored in `localStorage`)

---

## 1. System Overview

Precise Procure is a B2B procurement workflow tool. It manages the full lifecycle of a customer enquiry — from the moment a salesperson receives a customer request, through vendor quotation sourcing, to the final quotation sent back to the customer.

Three departments collaborate on each enquiry:

| Department | Their job |
|---|---|
| **Sales** | Creates enquiries, sets selling price, sends quotation to customer |
| **Purchase / Sourcing** | Gets vendor prices for each item in the enquiry |
| **Key Accounts (KAM)** | Monitors enquiries for their assigned customers |

---

## 2. Test Accounts

| Email | Password | Role | Dashboard |
|---|---|---|---|
| `admin@procure.com` | `Admin@123` | Admin | `/admin.html` |
| `sales.entry@procure.com` | `Sales@123` | Sales Operations – Entry | `/sales.html` |
| `sales.manager@procure.com` | `Sales@123` | Sales Operations – Manager | `/sales.html` |
| `purchase.entry@procure.com` | `Purchase@123` | Purchase Operations – Entry | `/sourcing.html` |
| `purchase.manager@procure.com` | `Purchase@123` | Purchase Operations – Manager | `/sourcing.html` |
| `kam.entry@procure.com` | `KAM@123` | Key Accounts – Entry | `/key-accounts.html` |
| `kam.manager@procure.com` | `KAM@123` | Key Accounts – Manager | `/key-accounts.html` |

> **Note**: If any login fails, reset the password via Admin → Employees → Edit, or use the `/api/auth/login` endpoint directly.

---

## 3. Role & Permission Matrix

### What each role can do

| Permission | Sales Entry | Sales Manager | Purchase Entry | Purchase Manager | KAM Entry | KAM Manager | Admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Create enquiry | ✓ | ✓ | | | | | ✓ |
| View own enquiries | ✓ | | | | | | |
| View all enquiries | | ✓ | | ✓ | | ✓ | ✓ |
| View assigned items | | | ✓ | ✓ | | | |
| View assigned customers' enquiries | | | | | ✓ | ✓ | |
| Assign to sourcing | | ✓ | | | | | ✓ |
| Self-assign from New queue | ✓ | ✓ | ✓ | ✓ | | | |
| Set sales price | ✓ | ✓ | | | | | ✓ |
| Approve quotation | | ✓ | | | | | ✓ |
| Download quotation | ✓ | ✓ | | | ✓ | ✓ | ✓ |
| Send quotation (complete) | | ✓ | | | | | ✓ |
| Enter vendor/purchase price | | | ✓ | ✓ | | | ✓ |
| Mark unsuccessful | | ✓ | | | | | ✓ |
| Bulk upload from Excel | | ✓ | | | | | ✓ |
| Filter by sourcing user | | ✓ | | ✓ | | | ✓ |
| Filter by KAM | | | | | | ✓ | ✓ |
| View materials/customers/vendors | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit materials | | | | ✓ | | | ✓ |
| Create/edit customers | | | | | | ✓ | ✓ |
| Create/edit vendors | | | | ✓ | | | ✓ |
| Manage users | | | | | | | ✓ |
| Manage roles | | | | | | | ✓ |
| View admin dashboard | | | | | | | ✓ |
| View team insights | | ✓ | | ✓ | | ✓ | ✓ |

---

## 4. Enquiry Lifecycle — The 4 Stages

Every enquiry moves through exactly 4 stages. Each stage has its own tab on the enquiry pages.

```
[Customer calls Sales]
        │
        ▼
  ┌─────────────┐
  │   NEW       │  stage = 'new'
  │             │  Enquiry just created.
  │             │  No sourcing assigned yet.
  └──────┬──────┘
         │  Sales Manager assigns items to Sourcing person
         ▼
  ┌─────────────┐
  │   OPEN      │  stage = 'open'
  │             │  At least one item assigned to a sourcing PIC.
  │             │  Sourcing is getting vendor prices.
  └──────┬──────┘
         │  Sourcing enters first vendor quotation
         ▼
  ┌─────────────┐
  │  UPDATED    │  stage = 'updated'
  │             │  Vendor prices entered.
  │             │  Sales can now set selling price.
  └──────┬──────┘
         │  Sales Manager approves + sends quotation to customer
         ▼
  ┌─────────────┐
  │  COMPLETED  │  stage = 'completed'
  │             │  Quotation sent. Read-only for everyone.
  └─────────────┘
```

### Stage transition rules

| Event | Trigger | Stage changes from → to |
|---|---|---|
| Enquiry created | POST `/api/enquiries` | — → `new` |
| First item assigned to sourcing | PUT `/api/enquiries/:id/assign` | `new` → `open` |
| First vendor quotation entered | POST `/api/enquiries/:id/vendor-quote` | `open` → `updated` |
| Quotation sent to customer | PUT `/api/enquiries/:id/complete` | `updated` → `completed` |

---

## 5. Data Flow — Step by Step

### Step 1: Enquiry Creation (Sales)

**Who**: Sales Entry or Sales Manager  
**Where**: Sales page → "New Enquiry" button  
**What happens**:
1. Sales fills in: Customer name, contact details, list of materials + quantities required
2. POST `/api/enquiries` creates the enquiry with `stage: 'new'`, `createdBy: salesUserId`
3. Enquiry appears in the **New Enquiries** tab for all Sales users (and all-view users)

**Visibility after creation**:
- Sales Entry: sees it because they created it (`enquiry.view.own`)
- Sales Manager: sees it because they have `enquiry.view.all`
- Purchase users: see it in New tab (they can self-assign)
- KAM: sees it only if the customer is assigned to them

---

### Step 2: Assignment to Sourcing (Sales Manager)

**Who**: Sales Manager (needs `enquiry.assign`)  
**Where**: Sales page → New tab → open enquiry → "Assign to Sourcing" button  
**What happens**:
1. Manager selects a sourcing person from the dropdown (populated from `/api/users/by-category?category=purchase`)
2. PUT `/api/enquiries/:id/assign` sets `items[n].assignedTo = sourcingUserId`
3. Stage auto-updates from `new` → `open`
4. Enquiry moves from **New** tab to **Open** tab

**Alternative — Self Assign**:  
Purchase user sees enquiry in New tab → clicks "Self-Assign" → assigns themselves (`enquiry.self_assign`)

---

### Step 3: Vendor Quotation (Purchase / Sourcing)

**Who**: Purchase Operations Entry or Manager (needs `purchase_price.add`)  
**Where**: Sourcing page → Open tab → open enquiry → "Add Vendor Quote" button  
**What happens**:
1. Purchase person contacts vendors, gets prices
2. Fills in: Vendor name, unit price, lead time, notes
3. POST `/api/enquiries/:id/vendor-quote`
4. Stage auto-updates from `open` → `updated`
5. Enquiry moves to **Updated** tab — visible to Sales

---

### Step 4: Sales Price Setting (Sales)

**Who**: Sales Entry or Manager (needs `sales_price.add`)  
**Where**: Sales page → Updated tab → open enquiry → "Set Sales Price" button  
**What happens**:
1. Sales reviews vendor prices entered by sourcing
2. Sets the customer-facing price (markup applied)
3. PUT `/api/enquiries/:id/sales-price`

---

### Step 5: Quotation Approval & Send (Sales Manager)

**Who**: Sales Manager (needs `sales_price.approve` + `quotation.send`)  
**Where**: Sales page → Updated tab → "Approve & Send" button  
**What happens**:
1. Manager reviews the full quotation
2. Approves the pricing
3. Marks quotation as sent (via PUT `/api/enquiries/:id/complete`)
4. Stage moves from `updated` → `completed`
5. Enquiry moves to **Completed** tab — read-only for all

---

### Step 6: KAM Monitoring (Key Accounts)

**Who**: KAM Entry or Manager  
**Where**: Key Accounts page  
**What they see**:
- Only enquiries where the customer's `assignedKAM` = their user ID (KAM Entry)
- All enquiries across all customers (KAM Manager with `enquiry.view.all`)
- 4 tabs same as Sales/Sourcing — can track where each customer's enquiry stands
- Can download quotation PDF (`quotation.download`)
- Can send queries/messages (`query.send`)
- Cannot create enquiries or set prices

---

## 6. Admin Functions

### Master Data Management (`/masters.html`)

Accessible by Admin (full CRUD) and role users (view only, based on permissions).

| Entity | URL | Key fields |
|---|---|---|
| Materials | `/masters.html?type=materials` | Name, code, unit, HSN code, description |
| Customers | `/masters.html?type=customers` | Company, contact, email, phone, assigned KAM |
| Vendors | `/masters.html?type=vendors` | Company, contact, email, phone, categories |
| Employees | `/masters.html?type=employees` | Name, email, password, assigned role |

**Customer → KAM assignment**: When creating/editing a customer, the admin can assign a Key Accounts user. This determines which KAM Entry user can see that customer's enquiries.

### Role Management (`/role-management.html`)

Admin only. Create custom roles with any combination of permissions.

1. Go to Role Management in admin sidebar
2. Click "Add Role"
3. Fill: Name, Description, Category (sales/purchase/key_accounts/admin), Dashboard redirect page, Color
4. Check required permissions from the grouped checklist
5. Save — role immediately available when creating employees

### User Management (Masters → Employees)

1. Create employee with name, email, password
2. Select role from dropdown (fetches all roles dynamically)
3. Employee can log in immediately — redirect goes to the `dashboardPage` configured on their role

---

## 7. API Reference

### Authentication
```
POST /api/auth/login
Body: { email, password }
Response: { token, user: { id, name, email, roleId, roleName, permissions, category, dashboardPage } }
```

### Enquiries
```
GET    /api/enquiries                     — List enquiries (filtered by permission)
GET    /api/enquiries?stage=new           — Filter by stage (new/open/updated/completed)
GET    /api/enquiries?sourcingUser=id     — Filter by sourcing PIC (needs filter.by_sourcing_user)
GET    /api/enquiries?kamUser=id          — Filter by KAM (needs filter.by_key_account_manager)
POST   /api/enquiries                     — Create enquiry (needs enquiry.create)
GET    /api/enquiries/:id                 — Get single enquiry detail
PUT    /api/enquiries/:id/assign          — Assign items to sourcing (needs enquiry.assign)
PUT    /api/enquiries/:id/sales-price     — Set sales price (needs sales_price.add)
PUT    /api/enquiries/:id/complete        — Send quotation (needs quotation.send)
PUT    /api/enquiries/:id/unsuccessful    — Mark unsuccessful (needs enquiry.mark_unsuccessful)
POST   /api/enquiries/:id/vendor-quote    — Add vendor quote (needs purchase_price.add)
```

### Roles
```
GET    /api/roles                         — List all roles
GET    /api/roles/permissions             — List all available permissions with descriptions
POST   /api/roles                         — Create role (needs role.create)
PUT    /api/roles/:id                     — Update role (needs role.edit)
DELETE /api/roles/:id                     — Delete role; fails if isSystem=true (needs role.delete)
```

### Masters
```
GET    /api/materials                     — List materials
POST   /api/materials                     — Create (needs material.create)
PUT    /api/materials/:id                 — Update (needs material.edit)
DELETE /api/materials/:id                 — Delete (needs material.delete)

GET    /api/customers                     — List customers
POST   /api/customers                     — Create (needs customer.create)
PUT    /api/customers/:id                 — Update (needs customer.edit)

GET    /api/vendors                       — List vendors
POST   /api/vendors                       — Create (needs vendor.create)
PUT    /api/vendors/:id                   — Update (needs vendor.edit)

GET    /api/users                         — List users
GET    /api/users/by-category?category=purchase  — Users in a role category (for dropdowns)
POST   /api/users                         — Create user (needs user.create)
PUT    /api/users/:id                     — Update user (needs user.edit)
```

---

## 8. Manual Test Checklist

### A. Admin Basic Functions

- [ ] Login as `admin@procure.com` / `Admin@123` → lands on `/admin.html`
- [ ] Sidebar shows: Dashboard, Master Data (4 items), Enquiry Management (3 items), Access Control → Role Management
- [ ] Navigate to each sidebar link — sidebar stays consistent (no style change, no items disappearing)
- [ ] Navigate to Masters → Materials — data table loads
- [ ] Navigate to Masters → Customers — data table loads
- [ ] Navigate to Masters → Employees — "Add New" button visible
- [ ] Create a test material: click Add New, fill form, save → row appears
- [ ] Edit the test material → changes save
- [ ] Navigate to Role Management → page loads with role list
- [ ] Click "Add Role" → modal opens with permissions checklist
- [ ] Create a new role "Test Role – Sales" in `sales` category → role saved, appears in list
- [ ] Delete the test role → disappears; system roles (isSystem=true) cannot be deleted

### B. Enquiry Workflow (Happy Path)

**Setup**: You need a customer and at least one material in Masters first.

1. **Create Enquiry (Sales Entry)**
   - [ ] Login as `sales.entry@procure.com`
   - [ ] Floating glass top bar visible (no left sidebar)
   - [ ] "New Enquiry" button visible
   - [ ] Click → fill: Customer, 2-3 materials with quantities
   - [ ] Save → enquiry appears in **New Enquiries** tab

2. **Assign to Sourcing (Sales Manager)**
   - [ ] Login as `sales.manager@procure.com`
   - [ ] New tab shows the enquiry just created
   - [ ] Open enquiry → "Assign to Sourcing" button visible
   - [ ] Select a purchase user from dropdown → save
   - [ ] Enquiry moves to **Open** tab

3. **Enter Vendor Quote (Purchase Entry)**
   - [ ] Login as `purchase.entry@procure.com`
   - [ ] Open tab shows the assigned enquiry
   - [ ] "Add Vendor Quote" button visible
   - [ ] Fill: Vendor, price, lead time → save
   - [ ] Enquiry moves to **Updated** tab

4. **Set Sales Price (Sales Entry or Manager)**
   - [ ] Login as `sales.entry@procure.com`
   - [ ] Updated tab shows the enquiry
   - [ ] "Set Sales Price" button visible → set price → save

5. **Approve & Send (Sales Manager)**
   - [ ] Login as `sales.manager@procure.com`
   - [ ] "Approve & Send Quotation" button visible
   - [ ] Click → confirm → enquiry moves to **Completed** tab
   - [ ] All users see it in Completed tab as read-only

### C. KAM Flow

- [ ] Admin: Assign a customer to `kam.entry@procure.com` (Masters → Customers → Edit → KAM dropdown)
- [ ] Create an enquiry for that customer (as Sales Entry)
- [ ] Login as `kam.entry@procure.com` → can see the enquiry in Key Accounts page
- [ ] KAM does NOT see enquiries for other customers
- [ ] Login as `kam.manager@procure.com` → sees ALL enquiries across all customers

### D. Permission Enforcement

- [ ] Sales Entry: "Approve Quotation" / "Assign to Sourcing" buttons NOT visible
- [ ] Purchase Entry: "Create Enquiry" button NOT visible
- [ ] KAM Entry: no Create, no Set Price, no Assign buttons visible
- [ ] Sales Entry: Master Data links — can VIEW but no "Add New" button for materials/vendors
- [ ] Direct API call without token → `401 Unauthorized`
- [ ] Direct API call with Sales Entry token to approve quotation → `403 Forbidden`

### E. Bulk Upload (Sales Manager)

- [ ] Login as `sales.manager@procure.com` → "Bulk Upload" button visible
- [ ] Login as `sales.entry@procure.com` → "Bulk Upload" button NOT visible
- [ ] Download the sample Excel template → fill 3 rows → upload → enquiries created in New tab

### F. Role-Based UI

- [ ] Non-admin users (sales/purchase/kam) → NO left sidebar, floating glass top bar only
- [ ] Admin navigating to sales.html/sourcing.html/key-accounts.html → KEEPS full left sidebar
- [ ] Admin active nav link highlights correctly for each page visited

---

## 9. Known Constraints

- **System roles cannot be deleted** — Admin, and all 6 default roles have `isSystem: true`. Create custom roles to test deletion.
- **Stage transitions are one-way** — An enquiry cannot go back from `completed` to `updated`. If you need to re-test, create a fresh enquiry.
- **KAM assignment is per-customer** — A KAM Entry user only sees enquiries if the customer's `assignedKAM` field is set to their user ID. If an enquiry's customer has no KAM assigned, KAM Entry users see nothing.
- **JWT expiry** — Tokens expire after 7 days. Re-login if you get a 401 after an extended test session.
- **MongoDB Atlas** — Data persists across server restarts. To start fresh, use the Admin bulk-delete or drop collections directly in Atlas.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login succeeds but wrong page shown | `dashboardPage` not set on role | Edit role in Role Management, set correct redirect page |
| "Add New" button missing | User lacks `*.create` permission | Check role permissions in Role Management |
| Enquiry not visible in a tab | Stage not matching, or view permission too narrow | Check `stage` field in DB; check role permissions |
| Blank dropdown for sourcing assignment | No users with `purchase` category roles | Create a Purchase user in Employees |
| KAM sees 0 enquiries | Customer's `assignedKAM` not set | Admin → Customers → Edit → assign KAM user |
| 403 on API call | Missing permission in role | Admin → Role Management → add required permission |
| Role modal not opening | JS error in console | Open browser DevTools → Console tab for error details |
