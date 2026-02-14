const XLSX = require('xlsx');

/**
 * Generate Test Excel File for Bulk Upload
 * Includes various test scenarios: exact matches, typos, missing data, etc.
 */

const testData = [
    // Row 1: Perfect exact match with assignee
    {
        'EnquiryCustomer': 'ABC Corporation',
        'Material Name': 'Steel Rod 10mm',
        'Qty': 100,
        'Sourcing Assignee': 'Amit Patel'
    },

    // Row 2: Typo in material name (should fuzzy match to "Cement Bag 50kg")
    {
        'EnquiryCustomer': 'XYZ Industries',
        'Material Name': 'cament bag 50kg',  // Typo: cement -> cament
        'Qty': 500,
        'Sourcing Assignee': 'Sneha Reddy'
    },

    // Row 3: Missing assignee (should work, unassigned)
    {
        'EnquiryCustomer': 'ABC Corporation',
        'Material Name': 'Copper Wire',
        'Qty': 250,
        'Sourcing Assignee': ''
    },

    // Row 4: Same customer, different product (should group into same enquiry)
    {
        'EnquiryCustomer': 'ABC Corporation',
        'Material Name': 'Electrical Cable',
        'Qty': 150,
        'Sourcing Assignee': 'Amit Patel'
    },

    // Row 5: Typo in customer name and product (test both fuzzy matches)
    {
        'EnquiryCustomer': 'XYz industrys',  // Typo: Industries -> industrys
        'Material Name': 'steal rod 12mm',   // Typo: steel -> steal
        'Qty': 75,
        'Sourcing Assignee': ''
    },

    // Row 6: Product with US vs UK spelling (should match either Aluminum or Aluminium)
    {
        'EnquiryCustomer': 'Tech Solutions Ltd',
        'Material Name': 'aluminum sheet',  // US spelling
        'Qty': 300,
        'Sourcing Assignee': 'Amit Patel'
    },

    // Row 7: Invalid assignee name (should warn)
    {
        'EnquiryCustomer': 'Global Traders',
        'Material Name': 'PVC Pipe',
        'Qty': 200,
        'Sourcing Assignee': 'Unknown Person'
    },

    // Row 8: Product that might not exist exactly (test suggestions)
    {
        'EnquiryCustomer': 'Manufacturing Co',
        'Material Name': 'bolt heavy duty',  // Different order
        'Qty': 1000,
        'Sourcing Assignee': ''
    },

    // Row 9: Same customer as row 1 (should group)
    {
        'EnquiryCustomer': 'ABC Corporation',
        'Material Name': 'Paint Bucket',
        'Qty': 50,
        'Sourcing Assignee': 'Amit Patel'
    },

    // Row 10: Decimal quantity (should work)
    {
        'EnquiryCustomer': 'Manufacturing Co',
        'Material Name': 'Wood Plank',
        'Qty': 125.5,
        'Sourcing Assignee': ''
    },

    // Row 11: Another typo test
    {
        'EnquiryCustomer': 'Global Traders',
        'Material Name': 'led bulbs',  // Missing capital
        'Qty': 100,
        'Sourcing Assignee': 'Sneha Reddy'
    },

    // Row 12: Product that doesn't exist at all (should show dropdown with + New Product)
    {
        'EnquiryCustomer': 'Tech Solutions Ltd',
        'Material Name': 'Carbon Fiber Sheet',  // Doesn't exist
        'Qty': 25,
        'Sourcing Assignee': ''
    }
];

// Create workbook and worksheet
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(testData);

// Set column widths
ws['!cols'] = [
    { wch: 25 },  // EnquiryCustomer
    { wch: 30 },  // Material Name
    { wch: 10 },  // Qty
    { wch: 25 }   // Sourcing Assignee
];

// Add worksheet to workbook
XLSX.utils.book_append_sheet(wb, ws, 'Bulk Upload Test');

// Write file
XLSX.writeFile(wb, 'Bulk_Enquiry_Test.xlsx');


console.log('✅ Test file created: Bulk_Enquiry_Test.xlsx');
console.log('\nTest Scenarios Included:');
console.log('1. Exact product matches with valid assignee');
console.log('2. Typos in material names: "camentbag" → "Cement Bag 50kg"');
console.log('3. Missing sourcing assignee (should create unassigned)');
console.log('4. Multiple items for same customer (ABC Corporation x3 - should group)');
console.log('5. Typos in customer names: "XYz industrys"');
console.log('6. Product name variations: "steal rod" → "Steel Rod"');
console.log('7. US vs UK spelling: "aluminum" → "Aluminum/Aluminium"');
console.log('8. Invalid assignee name (should warn)');
console.log('9. Product with different word order: "bolt heavy duty"');
console.log('10. Decimal quantities: 125.5');
console.log('11. Case variations: "led bulbs" → "LED Bulb"');
console.log('12. Product that doesn\'t exist: "Carbon Fiber Sheet" (should show + New Product)');
