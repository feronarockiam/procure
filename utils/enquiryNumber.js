const { Enquiry, Counter } = require('../db');

// ENQ-YYYYMMDD-NNN, numbered per day. Used by both single and bulk creation so the two can never hand out the same number.
const todayKey = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

// The highest sequence already used today (from enquiries made before the counter existed)
const highestUsedToday = async (dateStr) => {
    const prefix = `ENQ-${dateStr}-`;
    // numericOrdering: so "-1000" sorts after "-999" (plain string sort would not)
    const last = await Enquiry.findOne({ enquiryNumber: new RegExp(`^${prefix}`) })
        .sort({ enquiryNumber: -1 })
        .collation({ locale: 'en', numericOrdering: true });
    const seq = last ? parseInt(last.enquiryNumber.split('-')[2], 10) : 0;
    return Number.isFinite(seq) ? seq : 0;
};

// The next number: one atomic increment, so concurrent requests each get a different one.
// The first time the counter is used on a given day it starts after whatever was already numbered that day.
const generateEnquiryNumber = async () => {
    const dateStr = todayKey();
    const key = `enquiry:${dateStr}`;
    if (!(await Counter.exists({ _id: key }))) {
        // $max (not a plain set) so two requests starting the day together cannot move it backwards
        await Counter.updateOne({ _id: key }, { $max: { seq: await highestUsedToday(dateStr) } }, { upsert: true });
    }
    const counter = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true, upsert: true });
    return `ENQ-${dateStr}-${String(counter.seq).padStart(3, '0')}`;
};

// Create an Enquiry with the next number. A clash can now only come from a number used by hand or by an older
// version of the app; the counter has already moved past it, so asking again simply gives the next one.
const createEnquiryWithNumber = async (fields) => {
    for (let attempt = 0; attempt < 25; attempt++) {
        try {
            return await new Enquiry({ ...fields, enquiryNumber: await generateEnquiryNumber() }).save();
        } catch (err) {
            if (err.code !== 11000 || attempt === 24) throw err;
        }
    }
};

module.exports = { generateEnquiryNumber, createEnquiryWithNumber };
