// Default vendor + price for a material (a "rate contract"). When an enquiry includes a material that has one, the
// vendor quote is entered for it straight away: the item goes to "vendor quoted" and never waits in the purchase queue.
// Sales then sets the selling price as for any other quote. Purchase can still add more quotes if they want to.
const { Product, Vendor, EnquiryItem, Enquiry, VendorQuotation } = require('../db');

// Is a material's default price usable today? (no end date = no expiry; the end date itself still counts)
const defaultPriceActive = (product, now = new Date()) => {
    if (!product || !product.defaultVendorId || typeof product.defaultPrice !== 'number') return false;
    if (!product.defaultPriceValidUntil) return true;
    const lastDay = new Date(product.defaultPriceValidUntil);
    lastDay.setHours(23, 59, 59, 999);
    return lastDay >= now;
};

// For freshly created items: enter the default quote where the material has a usable one.
// Returns the ids of the items it priced (so callers can, e.g., skip telling purchase about them).
async function applyDefaultPrices(enquiryId, { userId }) {
    const items = await EnquiryItem.find({ enquiryId, status: { $in: ['unassigned', 'assigned', 'pending'] } }).select('_id productId');
    if (!items.length) return [];

    const productIds = [...new Set(items.map(i => String(i.productId)))];
    const products = await Product.find({ _id: { $in: productIds }, defaultVendorId: { $ne: null } })
        .select('defaultVendorId defaultPrice defaultFreight defaultPriceValidUntil').lean();
    const usable = new Map(products.filter(p => defaultPriceActive(p)).map(p => [String(p._id), p]));
    if (!usable.size) return [];

    // a vendor removed since the default was set is simply skipped (the item then goes to purchase as usual)
    const vendorIds = [...new Set([...usable.values()].map(p => String(p.defaultVendorId)))];
    const liveVendors = new Set((await Vendor.find({ _id: { $in: vendorIds } }).select('_id').lean()).map(v => String(v._id)));

    const now = new Date();
    const priced = [];
    const quotes = [];
    for (const item of items) {
        const product = usable.get(String(item.productId));
        if (!product || !liveVendors.has(String(product.defaultVendorId))) continue;
        quotes.push({
            enquiryItemId: item._id,
            vendorId: product.defaultVendorId,
            vendorPrice: product.defaultPrice,
            freightPrice: product.defaultFreight || 0,
            enteredBy: userId,
            enteredAt: now,
            notes: 'Default price from the material master',
            isCheapest: true, // the only quote so far
            isDefaultPrice: true,
        });
        priced.push(item._id);
    }
    if (!priced.length) return [];

    await VendorQuotation.insertMany(quotes);
    await EnquiryItem.updateMany(
        { _id: { $in: priced } },
        { $set: { status: 'vendor_quoted', quotedAt: now, updatedAt: now }, $unset: { assignedTo: '', assignedAt: '' } }
    );
    await Enquiry.updateOne({ _id: enquiryId, stage: { $in: ['new', 'open'] } }, { $set: { stage: 'updated' } });
    return priced;
}

module.exports = { applyDefaultPrices, defaultPriceActive };
