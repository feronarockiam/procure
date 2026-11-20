const express = require('express');
const { Customer, Enquiry, User } = require('../db');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { audit } = require('../utils/audit');
const { isValidId, cleanString, escapeRegex } = require('../middleware/validate');

const router = express.Router();

// Email is optional, but if given it should look like one
const validEmail = (value) => value === undefined || value === null || value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// Case-insensitive "is there already a customer with this name?" (ignoring `exceptId` when renaming)
const nameTaken = async (name, exceptId) => {
    const query = { name: new RegExp(`^${escapeRegex(name)}$`, 'i') };
    if (exceptId) query._id = { $ne: exceptId };
    return Customer.exists(query);
};

// assignedKAM must be a real Key Accounts user. Returns an error string, or null when fine.
const checkKAM = async (assignedKAM) => {
    if (!assignedKAM) return null;
    if (!isValidId(assignedKAM)) return 'Assigned KAM is not a valid user';
    const kamUser = await User.findById(assignedKAM).populate('roleId', 'permissions');
    if (!kamUser) return 'Assigned KAM user not found';
    // Who can look after customers is decided by what their role allows, not by the team it sits in
    if (!kamUser.roleId || !(kamUser.roleId.permissions || []).includes('enquiry.view.assigned_customers')) {
        return `${kamUser.name} can't look after customers yet. Their role needs "Enquiries for the customers they look after" (set in Roles).`;
    }
    return null;
};

// GET /api/customers/my-team — clients assigned to me OR to my KAEs (supervisorId === me)
router.get('/my-team', authenticateToken, async (req, res) => {
    try {
        const myKAEs = await User.find({ supervisorId: req.user.id }).select('_id');
        const teamIds = [req.user.id, ...myKAEs.map(u => u._id)];
        const customers = await Customer.find({ assignedKAM: { $in: teamIds } })
            .populate('assignedKAM', 'name email roleId')
            .sort({ name: 1 });
        res.json(customers);
    } catch (error) {
        handleRouteError(res, error, 'customer');
    }
});

// GET /api/customers — list all customers
router.get('/', authenticateToken, requirePermission('customer.view'), async (req, res) => {
    try {
        const customers = await Customer.find()
            .populate('assignedKAM', 'name email')
            .sort({ name: 1 });
        res.json(customers);
    } catch (error) {
        handleRouteError(res, error, 'customer');
    }
});

// GET /api/customers/by-kam/:userId — customers assigned to a specific KAM
// Used by KAM Entry users to know which customers they own
router.get('/by-kam/:userId', authenticateToken, async (req, res) => {
    try {
        if (!isValidId(req.params.userId)) return res.status(400).json({ error: 'Invalid userId' });
        const customers = await Customer.find({ assignedKAM: req.params.userId })
            .populate('assignedKAM', 'name email roleId')
            .sort({ name: 1 });
        res.json(customers);
    } catch (error) {
        handleRouteError(res, error, 'customer');
    }
});

// POST /api/customers — create customer
router.post('/', authenticateToken, requirePermission('customer.create'), async (req, res) => {
    try {
        const { contactPerson, email, phone, address, assignedKAM } = req.body;
        const name = cleanString(req.body.name);

        if (!name) return res.status(400).json({ error: 'Customer name is required' });
        if (!validEmail(email)) return res.status(400).json({ error: 'Email address is not valid' });

        const kamError = await checkKAM(assignedKAM);
        if (kamError) return res.status(400).json({ error: kamError });

        // Stops the double-click / re-submit duplicates
        if (await nameTaken(name)) return res.status(409).json({ error: `A customer named "${name}" already exists` });

        const customer = new Customer({
            name,
            contactPerson,
            email,
            phone,
            address,
            assignedKAM: assignedKAM || null,
        });

        await customer.save();
        const populated = await Customer.findById(customer._id).populate('assignedKAM', 'name email');
        await audit(req, { action: 'customer.created', entity: 'customer', entityId: customer._id, entityLabel: customer.name, summary: `Added customer "${customer.name}"` });
        res.status(201).json(populated);
    } catch (error) {
        handleRouteError(res, error, 'customer');
    }
});

// PUT /api/customers/assign-kam — give several customers to one Key Account Manager (or take them off, with null)
router.put('/assign-kam', authenticateToken, requirePermission('customer.edit'), async (req, res) => {
    try {
        const { customerIds, assignedKAM } = req.body || {};
        if (!Array.isArray(customerIds) || customerIds.length === 0) return res.status(400).json({ error: 'No customers selected' });
        if (customerIds.length > 1000) return res.status(400).json({ error: 'Select up to 1000 customers at a time' });
        if (!customerIds.every(isValidId)) return res.status(400).json({ error: 'Invalid customer selection' });
        if (!('assignedKAM' in req.body)) return res.status(400).json({ error: 'Say who should look after them (or null to take the manager off)' });
        const problem = await checkKAM(assignedKAM);
        if (problem) return res.status(400).json({ error: problem });

        const kam = assignedKAM ? await User.findById(assignedKAM).select('name') : null;
        const result = await Customer.updateMany({ _id: { $in: customerIds } }, { $set: { assignedKAM: assignedKAM || null, updatedAt: new Date() } });
        await audit(req, {
            action: 'customer.kam_assigned', entity: 'customer', entityLabel: `${result.matchedCount} customer${result.matchedCount === 1 ? '' : 's'}`,
            summary: kam
                ? `Gave ${result.matchedCount} customer${result.matchedCount === 1 ? '' : 's'} to ${kam.name} as their Key Account Manager`
                : `Removed the Key Account Manager from ${result.matchedCount} customer${result.matchedCount === 1 ? '' : 's'}`,
        });
        res.json({ updated: result.matchedCount });
    } catch (error) {
        handleRouteError(res, error, 'customer');
    }
});

// PUT /api/customers/:id — update customer
router.put('/:id', authenticateToken, requirePermission('customer.edit'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid customer id' });
        const { contactPerson, email, phone, address, assignedKAM } = req.body;

        const updateData = { contactPerson, email, phone, address };
        if (req.body.name !== undefined) {
            const name = cleanString(req.body.name);
            if (!name) return res.status(400).json({ error: 'Customer name cannot be blank' });
            if (await nameTaken(name, req.params.id)) return res.status(409).json({ error: `A customer named "${name}" already exists` });
            updateData.name = name;
        }
        if (!validEmail(email)) return res.status(400).json({ error: 'Email address is not valid' });

        const kamError = await checkKAM(assignedKAM);
        if (kamError) return res.status(400).json({ error: kamError });
        // Allow explicitly unsetting KAM with null
        if (assignedKAM !== undefined) updateData.assignedKAM = assignedKAM || null;

        const customer = await Customer.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
            .populate('assignedKAM', 'name email');

        if (!customer) return res.status(404).json({ error: 'Customer not found' });
        await audit(req, { action: 'customer.updated', entity: 'customer', entityId: customer._id, entityLabel: customer.name, summary: `Updated customer "${customer.name}"` });
        res.json(customer);
    } catch (error) {
        handleRouteError(res, error, 'customer');
    }
});

// DELETE /api/customers/:id — delete customer
router.delete('/:id', authenticateToken, requirePermission('customer.delete'), async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid customer id' });

        // Enquiries (and every screen that lists them) assume their customer still exists
        const enquiryCount = await Enquiry.countDocuments({ customerId: req.params.id });
        if (enquiryCount > 0) {
            return res.status(409).json({
                error: `Cannot delete: this customer has ${enquiryCount} enquir${enquiryCount === 1 ? 'y' : 'ies'}. Close or reassign them first.`,
            });
        }

        const customer = await Customer.findByIdAndDelete(req.params.id);
        if (!customer) return res.status(404).json({ error: 'Customer not found' });
        await audit(req, { action: 'customer.deleted', entity: 'customer', entityId: customer._id, entityLabel: customer.name, summary: `Deleted customer "${customer.name}"` });
        res.json({ message: 'Customer deleted successfully' });
    } catch (error) {
        handleRouteError(res, error, 'customer');
    }
});

module.exports = router;
