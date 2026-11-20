// Reports for the people who run the business: how much came in, how fast it moves, who is carrying the load, which customers,
// materials and vendors matter. Worked out on the server from what is stored, for enquiries RAISED inside the chosen dates.
//
// Times use the milestone stamps (assignedAt, quotedAt, pricedAt, completedAt). Older records don't have them, so every
// timing says how many items it is based on ("n"), and the funnel falls back to an item's status when a stamp is missing.
const express = require('express');
const { Enquiry, EnquiryItem, VendorQuotation, Customer, Product, Vendor, User } = require('../db');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { handleRouteError } = require('../middleware/errors');
const { asString } = require('../middleware/validate');

const router = express.Router();

const DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 366;
const CAP = 20000; // enquiries per report; more than this and the page says the report is partial

const REACHED = {
    // (an item closed as unsuccessful straight from the waiting list was never given to anyone, so only a stamp can prove it was)
    assigned: (i) => !!i.assignedAt || ['assigned', 'in_sales_query', 'sales_query_resolved', 'vendor_quoted', 'priced', 'sales_priced', 'completed'].includes(i.status),
    quoted: (i) => !!i.quotedAt || ['vendor_quoted', 'priced', 'sales_priced', 'completed'].includes(i.status),
    priced: (i) => !!i.pricedAt || ['priced', 'sales_priced', 'completed'].includes(i.status),
    completed: (i) => !!i.completedAt || i.status === 'completed',
};

const hours = (from, to) => (from && to && new Date(to) >= new Date(from) ? (new Date(to) - new Date(from)) / 3600000 : null);
const round = (n, places = 1) => (n === null || n === undefined ? null : Math.round(n * 10 ** places) / 10 ** places);
const median = (values) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const summarise = (values) => ({ n: values.length, avgHours: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null, medianHours: round(median(values)) });
// the calendar day in the server's own clock, the same one the period's start and end are cut on
const dayKey = (date) => { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const worth = (item) => (item.salesPrice > 0 ? item.salesPrice * (item.quantity || 1) : 0);
const top = (map, n, by) => [...map.values()].sort((a, b) => by(b) - by(a)).slice(0, n);

// GET /api/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD   (default: the last 30 days)
router.get('/', authenticateToken, requirePermission('analytics.view'), async (req, res) => {
    try {
        const parse = (value, name) => {
            const date = new Date(asString(value));
            if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`${name} is not a valid date`), { badRequest: true });
            return date;
        };
        let to, from;
        try {
            to = asString(req.query.to) ? parse(req.query.to, 'to') : new Date();
            to.setHours(23, 59, 59, 999);
            from = asString(req.query.from) ? parse(req.query.from, 'from') : new Date(to.getTime() - 29 * DAY);
            from.setHours(0, 0, 0, 0);
        } catch (error) {
            if (error.badRequest) return res.status(400).json({ error: error.message });
            throw error;
        }
        if (from > to) return res.status(400).json({ error: 'The start date is after the end date' });
        if ((to - from) / DAY > MAX_DAYS) return res.status(400).json({ error: `Choose a period of at most ${MAX_DAYS} days` });

        const enquiries = await Enquiry.find({ createdAt: { $gte: from, $lte: to } }).select('createdAt closedAt status customerId createdBy closeReason')
            .sort({ createdAt: -1 }).limit(CAP).lean();
        const enquiryOf = new Map(enquiries.map(e => [String(e._id), e]));
        const items = enquiries.length
            ? await EnquiryItem.find({ enquiryId: { $in: enquiries.map(e => e._id) } })
                .select('enquiryId productId status assignedTo assignedAt quotedAt pricedAt completedAt createdAt salesPrice quantity selectedVendorQuoteId').lean()
            : [];
        const quotes = items.length
            ? await VendorQuotation.find({ enquiryItemId: { $in: items.map(i => i._id) } }).select('vendorId vendorPrice freightPrice enteredAt').lean()
            : [];

        // ── totals and the funnel ────────────────────────────────────────────
        const completedItems = items.filter(i => i.status === 'completed');
        const lostItems = items.filter(i => i.status === 'unsuccessful');
        const decided = completedItems.length + lostItems.length;
        const wonValue = completedItems.reduce((n, i) => n + worth(i), 0);
        const quotedValue = items.reduce((n, i) => n + worth(i), 0);
        const totals = {
            enquiries: enquiries.length,
            items: items.length,
            openEnquiries: enquiries.filter(e => !['completed', 'unsuccessful', 'closed'].includes(e.status)).length,
            completedItems: completedItems.length,
            lostItems: lostItems.length,
            quotedValue: Math.round(quotedValue),
            wonValue: Math.round(wonValue),
            avgDealValue: completedItems.length ? Math.round(wonValue / completedItems.length) : 0,
            winRate: decided ? round((completedItems.length / decided) * 100) : null, // of the items that have been decided either way
        };
        const funnel = [
            { key: 'raised', label: 'Raised', count: items.length },
            { key: 'assigned', label: 'Given to purchase', count: items.filter(REACHED.assigned).length },
            { key: 'quoted', label: 'Vendor price in', count: items.filter(REACHED.quoted).length },
            { key: 'priced', label: 'Selling price set', count: items.filter(REACHED.priced).length },
            { key: 'completed', label: 'Quotation sent', count: items.filter(REACHED.completed).length },
        ];

        // ── how fast things move ─────────────────────────────────────────────
        const created = (i) => (enquiryOf.get(String(i.enquiryId)) || {}).createdAt || i.createdAt;
        const collect = (fn) => items.map(fn).filter(v => v !== null);
        const turnaround = {
            toAssign: summarise(collect(i => hours(created(i), i.assignedAt))),
            toQuote: summarise(collect(i => hours(i.assignedAt, i.quotedAt))),
            toPrice: summarise(collect(i => hours(i.quotedAt, i.pricedAt))),
            toSend: summarise(collect(i => hours(i.pricedAt, i.completedAt))),
            endToEnd: summarise(collect(i => hours(created(i), i.completedAt))),
        };

        // ── volume per day ───────────────────────────────────────────────────
        const byDay = new Map();
        for (const day = new Date(from); day <= to; day.setDate(day.getDate() + 1)) byDay.set(dayKey(day), { date: dayKey(day), enquiries: 0, items: 0, quotedValue: 0 }); // by calendar day, so a day with 23 or 25 hours is still one bar
        for (const e of enquiries) { const d = byDay.get(dayKey(e.createdAt)); if (d) d.enquiries++; }
        for (const i of items) { const d = byDay.get(dayKey(created(i))); if (d) { d.items++; d.quotedValue += worth(i); } }
        const series = [...byDay.values()].map(d => ({ ...d, quotedValue: Math.round(d.quotedValue) }));

        // ── people ───────────────────────────────────────────────────────────
        const purchase = new Map(), sales = new Map(), customers = new Map(), materials = new Map(), vendors = new Map();
        const bump = (map, id, make) => { const key = String(id); if (!map.has(key)) map.set(key, make(key)); return map.get(key); };
        for (const i of items) {
            if (i.assignedTo) {
                const p = bump(purchase, i.assignedTo, id => ({ id, assigned: 0, quoted: 0, times: [] }));
                p.assigned++;
                if (REACHED.quoted(i)) p.quoted++;
                const h = hours(i.assignedAt, i.quotedAt); if (h !== null) p.times.push(h);
            }
            const e = enquiryOf.get(String(i.enquiryId));
            if (e && e.createdBy) {
                const s = bump(sales, e.createdBy, id => ({ id, enquiries: new Set(), items: 0, priced: 0, value: 0 }));
                s.enquiries.add(String(e._id)); s.items++;
                if (REACHED.priced(i)) { s.priced++; s.value += worth(i); }
            }
            if (e && e.customerId) { const c = bump(customers, e.customerId, id => ({ id, enquiries: new Set(), value: 0 })); c.enquiries.add(String(e._id)); c.value += worth(i); }
            if (i.productId) { const m = bump(materials, i.productId, id => ({ id, requests: 0, quantity: 0 })); m.requests++; m.quantity += i.quantity || 0; }
        }
        const chosen = new Set(items.map(i => String(i.selectedVendorQuoteId)).filter(Boolean));
        for (const q of quotes) {
            const v = bump(vendors, q.vendorId, id => ({ id, quotes: 0, won: 0 }));
            v.quotes++;
            if (chosen.has(String(q._id))) v.won++;
        }

        // names for everything above in one lookup per kind
        const ids = (map) => [...map.keys()];
        const [people, customerDocs, productDocs, vendorDocs] = await Promise.all([
            User.find({ _id: { $in: [...ids(purchase), ...ids(sales)] } }).select('name').lean(),
            Customer.find({ _id: { $in: ids(customers) } }).select('name').lean(),
            Product.find({ _id: { $in: ids(materials) } }).select('materialName uom').lean(),
            Vendor.find({ _id: { $in: ids(vendors) } }).select('name').lean(),
        ]);
        const nameOf = (docs, field = 'name') => new Map(docs.map(d => [String(d._id), d[field]]));
        const personName = nameOf(people), customerName = nameOf(customerDocs), materialName = nameOf(productDocs, 'materialName'), vendorName = nameOf(vendorDocs);
        const unitOf = nameOf(productDocs, 'uom');

        const closeReasons = new Map();
        for (const e of enquiries) if (e.closeReason) { const r = e.closeReason.trim().slice(0, 80); closeReasons.set(r, (closeReasons.get(r) || { reason: r, count: 0 })); closeReasons.get(r).count++; }

        res.json({
            range: { from: from.toISOString(), to: to.toISOString(), days: Math.ceil((to - from) / DAY) },
            partial: enquiries.length >= CAP,
            totals, funnel, turnaround, series,
            purchasePeople: top(purchase, 10, p => p.quoted).map(p => ({ id: p.id, name: personName.get(p.id) || 'Unknown', assigned: p.assigned, quoted: p.quoted, avgHoursToQuote: p.times.length ? round(p.times.reduce((a, b) => a + b, 0) / p.times.length) : null })),
            salesPeople: top(sales, 10, s => s.value).map(s => ({ id: s.id, name: personName.get(s.id) || 'Unknown', enquiries: s.enquiries.size, items: s.items, priced: s.priced, value: Math.round(s.value) })),
            customers: top(customers, 8, c => c.enquiries.size).map(c => ({ id: c.id, name: customerName.get(c.id) || 'Unknown', enquiries: c.enquiries.size, value: Math.round(c.value) })),
            materials: top(materials, 8, m => m.requests).map(m => ({ id: m.id, name: materialName.get(m.id) || 'Unknown', unit: unitOf.get(m.id) || '', requests: m.requests, quantity: m.quantity })),
            vendors: top(vendors, 8, v => v.quotes).map(v => ({ id: v.id, name: vendorName.get(v.id) || 'Unknown', quotes: v.quotes, won: v.won, winRate: v.quotes ? round((v.won / v.quotes) * 100) : null })),
            closeReasons: top(closeReasons, 6, r => r.count),
        });
    } catch (error) {
        handleRouteError(res, error, 'analytics');
    }
});

module.exports = router;
