// The five starter solutions as data. Every name and every record here is invented.

import type { FieldSpec } from './design.ts';
import type { Starter } from './starters.ts';

const serial: FieldSpec = { name: 'ID', type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1 } }, validation: { notEmpty: true, unique: true } } };
const text = (name: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type: 'text', ...extra });
const required = (name: string): FieldSpec => text(name, { options: { validation: { notEmpty: true } } });
const num = (name: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type: 'number', ...extra });
const date = (name: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type: 'date', ...extra });
const today = (name: string): FieldSpec => date(name, { options: { autoEnter: { value: 'creationDate' } } });
const initial = (name: string, value: string): FieldSpec => text(name, { options: { autoEnter: { data: value } } });
const key = (name: string): FieldSpec => num(name, { options: { validation: { notEmpty: true } } });
const calc = (name: string, calculation: string, type: 'text' | 'number' | 'date' = 'number', unstored = false): FieldSpec =>
  ({ name, type, kind: 'calculation', calculation, ...(unstored ? { options: { unstored: true } } : {}) });
const summary = (name: string, type: 'total' | 'count', field: string): FieldSpec => ({ name, summary: { type, field } });
const note = (): FieldSpec => text('Notes');

const staff = (what: string) => ({ name: 'Staff', comment: `Can look at, add and change ${what}, but not delete. Cannot change the design.`, records: { view: true, create: true, edit: true, delete: false } });
const readOnly = () => ({ name: 'Read only', comment: 'Can look, search and print. Cannot add, change or delete.', records: { view: true, create: false, edit: false, delete: false } });

const crm: Starter = {
  name: 'crm', title: 'Contacts and deals', summary: 'Companies, the people who work there and the deals you are trying to win, with a report of deals by stage.',
  tables: [
    { name: 'Companies', fields: [serial, required('Name'), text('Industry'), text('Website'), note(),
      calc('Contacts Count', 'Count ( Contacts::ID )', 'number', true),
      calc('Open Pipeline', 'Sum ( Deals::Open Amount )', 'number', true),
      calc('Won Total', 'Sum ( Deals::Won Amount )', 'number', true)] },
    { name: 'Contacts', fields: [serial, key('Company ID'), calc('Company Name', 'Companies::Name', 'text', true), required('Name'), text('Role'), text('Email'), text('Phone'), note()] },
    { name: 'Deals', fields: [serial, key('Company ID'), calc('Company Name', 'Companies::Name', 'text', true), required('Title'), num('Amount'), initial('Stage', 'Lead'),
      today('Opened'), date('Closed'), note(),
      calc('Open Amount', 'Case ( Stage = "Won" or Stage = "Lost" ; 0 ; Amount )'), calc('Won Amount', 'Case ( Stage = "Won" ; Amount ; 0 )'),
      summary('Total Amount', 'total', 'Amount')] },
  ],
  relationships: [
    { left: 'Companies::ID', right: 'Contacts::Company ID', createRight: true, deleteRight: true },
    { left: 'Companies::ID', right: 'Deals::Company ID', createRight: true, deleteRight: true },
  ],
  valueLists: [
    { name: 'Industry', values: ['Food and drink', 'Manufacturing', 'Services', 'Retail', 'Technology', 'Other'] },
    { name: 'Deal stage', values: ['Lead', 'Proposal', 'Won', 'Lost'] },
  ],
  popups: { 'Companies::Industry': 'Industry', 'Deals::Stage': 'Deal stage' },
  scripts: [
    { name: 'Close deal', text: `# Closes the deal you are on. The parameter is Won or Lost. A deal that is already closed is left alone.
If [ Get ( ScriptParameter ) ≠ "Won" and Get ( ScriptParameter ) ≠ "Lost" ]
	Exit Script [ Result: "say Won or Lost" ]
End If
If [ Deals::Stage = "Won" or Deals::Stage = "Lost" ]
	Exit Script [ Result: "already closed" ]
End If
Set Field [ Deals::Stage ; Get ( ScriptParameter ) ]
Set Field [ Deals::Closed ; Get ( CurrentDate ) ]
Exit Script [ Result: "closed" ]` },
    { name: 'Duplicate deal', text: `# Copies the deal you are on as a new lead, for the next order from the same company.
Duplicate Record/Request
Set Field [ Deals::Stage ; "Lead" ]
Set Field [ Deals::Closed ; "" ]
Set Field [ Deals::Opened ; Get ( CurrentDate ) ]
Exit Script [ Result: "duplicated" ]` },
  ],
  layouts: [
    { table: 'Companies', form: { fields: ['Name', 'Industry', 'Website', 'Notes', 'Contacts Count', 'Open Pipeline', 'Won Total'],
      portals: [{ table: 'Contacts', fields: ['Name', 'Role', 'Email'] }, { table: 'Deals', fields: ['Title', 'Stage', 'Amount'] }] }, list: { fields: ['Name', 'Industry', 'Contacts Count', 'Open Pipeline', 'Won Total'] } },
    { table: 'Contacts', form: { fields: ['Company Name', 'Name', 'Role', 'Email', 'Phone', 'Notes'] }, list: { fields: ['Name', 'Company Name', 'Role', 'Email', 'Phone'] } },
    { table: 'Deals', form: { fields: ['Company Name', 'Title', 'Amount', 'Stage', 'Opened', 'Closed', 'Notes'],
      buttons: [{ text: 'Mark won', script: 'Close deal', parameter: '"Won"' }, { text: 'Mark lost', script: 'Close deal', parameter: '"Lost"' }, { text: 'Duplicate', script: 'Duplicate deal' }] },
      list: { fields: ['Company Name', 'Title', 'Amount', 'Stage', 'Opened'] } },
  ],
  reports: [{ name: 'Deals by stage', table: 'Deals', fields: ['Company Name', 'Title', 'Amount', 'Opened'], groups: ['Stage'], totals: ['Total Amount'] }],
  privilegeSets: [staff('companies, contacts and deals'), readOnly()],
  sample: [
    { table: 'Companies', rows: [
      { Name: 'Harbour Bakery', Industry: 'Food and drink', Website: 'harbour-bakery.example', Notes: 'Sample record. Delete me.' },
      { Name: 'Larkspur Studio', Industry: 'Services', Website: 'larkspur-studio.example', Notes: 'Sample record. Delete me.' },
      { Name: 'Redfern Tools', Industry: 'Manufacturing', Website: 'redfern-tools.example', Notes: 'Sample record. Delete me.' },
    ] },
    { table: 'Contacts', rows: [
      { 'Company ID': 1, Name: 'Maya Okafor', Role: 'Owner', Email: 'maya@harbour-bakery.example', Phone: '555-0101', Notes: 'Sample record. Delete me.' },
      { 'Company ID': 2, Name: 'Tomas Berg', Role: 'Director', Email: 'tomas@larkspur-studio.example', Phone: '555-0102', Notes: 'Sample record. Delete me.' },
      { 'Company ID': 2, Name: 'Ines Duarte', Role: 'Office manager', Email: 'ines@larkspur-studio.example', Phone: '555-0103', Notes: 'Sample record. Delete me.' },
      { 'Company ID': 3, Name: 'Paul Reyes', Role: 'Buyer', Email: 'paul@redfern-tools.example', Phone: '555-0104', Notes: 'Sample record. Delete me.' },
    ] },
    { table: 'Deals', rows: [
      { 'Company ID': 1, Title: 'Weekly bread order', Amount: 1800, Stage: 'Won', Closed: '2026-09-02', Notes: 'Sample record. Delete me.' },
      { 'Company ID': 2, Title: 'Studio refit', Amount: 9500, Stage: 'Proposal', Notes: 'Sample record. Delete me.' },
      { 'Company ID': 2, Title: 'Service plan', Amount: 1200, Notes: 'Sample record. Delete me.' },
      { 'Company ID': 3, Title: 'Workshop tools', Amount: 4300, Stage: 'Lead', Notes: 'Sample record. Delete me.' },
      { 'Company ID': 3, Title: 'Sharpening contract', Amount: 600, Stage: 'Lost', Closed: '2026-08-14', Notes: 'Sample record. Delete me.' },
    ] },
  ],
};

const inventory: Starter = {
  name: 'inventory', title: 'Stock and reordering', summary: 'Products, a ledger of stock movements, what is on hand and what needs reordering.',
  tables: [
    { name: 'Products', fields: [serial, required('SKU'), required('Name'), text('Supplier'), text('Supplier Email'), num('Reorder Level'), num('Unit Cost'), note(),
      calc('On Hand', 'Sum ( Movements::Change )', 'number', true),
      calc('Status', 'Case ( On Hand ≤ Reorder Level ; "Reorder" ; "OK" )', 'text', true),
      calc('Stock Value', 'On Hand * Unit Cost', 'number', true),
      summary('Total Value', 'total', 'Stock Value')] },
    { name: 'Movements', fields: [serial, key('Product ID'), calc('Product Name', 'Products::Name', 'text', true), today('Moved'), key('Change'), text('Note')] },
  ],
  relationships: [{ left: 'Products::ID', right: 'Movements::Product ID', createRight: true, deleteRight: true }],
  valueLists: [],
  popups: {},
  scripts: [
    { name: 'Receive stock', text: `# Adds stock. The parameter is "product id | quantity | note", for example "1|24|Delivery 7".
Set Variable [ $product ; Value: GetValue ( Substitute ( Get ( ScriptParameter ) ; "|" ; ¶ ) ; 1 ) ]
Set Variable [ $quantity ; Value: GetAsNumber ( GetValue ( Substitute ( Get ( ScriptParameter ) ; "|" ; ¶ ) ; 2 ) ) ]
Set Variable [ $note ; Value: GetValue ( Substitute ( Get ( ScriptParameter ) ; "|" ; ¶ ) ; 3 ) ]
If [ IsEmpty ( $product ) or $quantity ≤ 0 ]
	Exit Script [ Result: "need a product and a quantity above 0" ]
End If
Go to Layout [ “Movements” ]
New Record/Request
Set Field [ Movements::Product ID ; $product ]
Set Field [ Movements::Change ; $quantity ]
Set Field [ Movements::Note ; $note ]
Exit Script [ Result: "received" ]` },
    { name: 'Sell stock', text: `# Takes stock out. The parameter is "product id | quantity | note". Refuses to go below zero.
Set Variable [ $product ; Value: GetValue ( Substitute ( Get ( ScriptParameter ) ; "|" ; ¶ ) ; 1 ) ]
Set Variable [ $quantity ; Value: GetAsNumber ( GetValue ( Substitute ( Get ( ScriptParameter ) ; "|" ; ¶ ) ; 2 ) ) ]
Set Variable [ $note ; Value: GetValue ( Substitute ( Get ( ScriptParameter ) ; "|" ; ¶ ) ; 3 ) ]
If [ IsEmpty ( $product ) or $quantity ≤ 0 ]
	Exit Script [ Result: "need a product and a quantity above 0" ]
End If
Go to Layout [ “Products” ]
Enter Find Mode
Set Field [ Products::ID ; $product ]
Perform Find
If [ Get ( LastError ) ≠ 0 ]
	Exit Script [ Result: "no such product" ]
End If
If [ Products::On Hand < $quantity ]
	Exit Script [ Result: "only " & Products::On Hand & " on hand" ]
End If
Go to Layout [ “Movements” ]
New Record/Request
Set Field [ Movements::Product ID ; $product ]
Set Field [ Movements::Change ; 0 - $quantity ]
Set Field [ Movements::Note ; $note ]
Exit Script [ Result: "sold" ]` },
  ],
  layouts: [
    { table: 'Products', form: { fields: ['SKU', 'Name', 'Supplier', 'Supplier Email', 'Reorder Level', 'Unit Cost', 'On Hand', 'Status', 'Stock Value', 'Notes'],
      portals: [{ table: 'Movements', fields: ['Moved', 'Change', 'Note'], rows: 6 }] }, list: { fields: ['SKU', 'Name', 'On Hand', 'Reorder Level', 'Status'] } },
    { table: 'Movements', form: { fields: ['Product Name', 'Moved', 'Change', 'Note'] }, list: { fields: ['Moved', 'Product Name', 'Change', 'Note'] } },
  ],
  reports: [{ name: 'Stock value by supplier', table: 'Products', fields: ['SKU', 'Name', 'On Hand', 'Stock Value'], groups: ['Supplier'], totals: ['Total Value'] }],
  privilegeSets: [staff('products and stock movements'), readOnly()],
  sample: [
    { table: 'Products', rows: [
      { SKU: 'MUG-01', Name: 'Stoneware mug', Supplier: 'Calder Pottery', 'Supplier Email': 'orders@calder-pottery.example', 'Reorder Level': 10, 'Unit Cost': 4.5, Notes: 'Sample record. Delete me.' },
      { SKU: 'TEA-02', Name: 'Loose leaf tea, 100g', Supplier: 'Hillside Tea', 'Supplier Email': 'orders@hillside-tea.example', 'Reorder Level': 20, 'Unit Cost': 3.2, Notes: 'Sample record. Delete me.' },
      { SKU: 'KET-03', Name: 'Enamel kettle', Supplier: 'Calder Pottery', 'Supplier Email': 'orders@calder-pottery.example', 'Reorder Level': 5, 'Unit Cost': 18, Notes: 'Sample record. Delete me.' },
    ] },
    { table: 'Movements', rows: [
      { 'Product ID': 1, Change: 40, Note: 'Opening stock (sample)' },
      { 'Product ID': 2, Change: 60, Note: 'Opening stock (sample)' },
      { 'Product ID': 3, Change: 12, Note: 'Opening stock (sample)' },
      { 'Product ID': 1, Change: -33, Note: 'Sold at the market (sample)' },
      { 'Product ID': 3, Change: -4, Note: 'Sold at the market (sample)' },
    ] },
  ],
};

const invoicing: Starter = {
  name: 'invoicing', title: 'Customers and invoices', summary: 'Customers, products, invoices with line items, and a report of what is billed and what is still owed.',
  tables: [
    { name: 'Customers', fields: [serial, required('Name'), text('Email'), text('Address'), note(), calc('Owing', 'Sum ( Invoices::Unpaid )', 'number', true)] },
    { name: 'Products', fields: [serial, required('Name'), num('Price'), note()] },
    { name: 'Invoices', fields: [serial, key('Customer ID'), calc('Customer Name', 'Customers::Name', 'text', true), today('Issued'), calc('Due', 'Issued + 30', 'date'), initial('Status', 'Draft'), note(),
      calc('Total', 'Sum ( Lines::Line Total )', 'number', true),
      calc('Unpaid', 'Case ( Status = "Paid" or Status = "Void" ; 0 ; Total )', 'number', true),
      calc('Overdue', 'Case ( Status = "Sent" and Get ( CurrentDate ) > Due ; 1 ; 0 )', 'number', true),
      summary('Total Billed', 'total', 'Total')] },
    { name: 'Lines', fields: [serial, key('Invoice ID'), num('Product ID'), calc('Description', 'Products::Name', 'text', true),
      num('Quantity', { options: { autoEnter: { data: '1' }, validation: { notEmpty: true } } }), num('Unit Price'), calc('Line Total', 'Quantity * Unit Price')] },
  ],
  relationships: [
    { left: 'Customers::ID', right: 'Invoices::Customer ID', createRight: true },
    { left: 'Invoices::ID', right: 'Lines::Invoice ID', createRight: true, deleteRight: true },
    { left: 'Lines::Product ID', right: 'Products::ID' },
  ],
  valueLists: [{ name: 'Invoice status', values: ['Draft', 'Sent', 'Paid', 'Void'] }],
  popups: { 'Invoices::Status': 'Invoice status' },
  scripts: [
    { name: 'New invoice', text: `# Starts a draft invoice. The parameter is the customer's ID.
If [ IsEmpty ( Get ( ScriptParameter ) ) ]
	Exit Script [ Result: "give a customer id" ]
End If
Go to Layout [ “Invoices” ]
New Record/Request
Set Field [ Invoices::Customer ID ; Get ( ScriptParameter ) ]
Exit Script [ Result: "started" ]` },
    { name: 'Send invoice', text: `# Moves a draft to Sent, but only once it has something to bill.
If [ Invoices::Status ≠ "Draft" ]
	Exit Script [ Result: "not a draft" ]
End If
If [ IsEmpty ( Invoices::Total ) or Invoices::Total = 0 ]
	Exit Script [ Result: "empty" ]
End If
Set Field [ Invoices::Status ; "Sent" ]
Exit Script [ Result: "sent" ]` },
    { name: 'Mark as paid', text: `# Marks the invoice you are on as paid, unless it is void or already paid.
If [ Invoices::Status = "Void" or Invoices::Status = "Paid" ]
	Exit Script [ Result: "no change" ]
End If
Set Field [ Invoices::Status ; "Paid" ]
Exit Script [ Result: "paid" ]` },
  ],
  layouts: [
    { table: 'Customers', form: { fields: ['Name', 'Email', 'Address', 'Owing', 'Notes'], portals: [{ table: 'Invoices', fields: ['ID', 'Issued', 'Status', 'Total'] }] }, list: { fields: ['Name', 'Email', 'Owing'] } },
    { table: 'Products', form: { fields: ['Name', 'Price', 'Notes'] }, list: { fields: ['Name', 'Price'] } },
    { table: 'Invoices', form: { fields: ['Customer Name', 'Issued', 'Due', 'Status', 'Total', 'Unpaid', 'Notes'],
      portals: [{ table: 'Lines', fields: ['Product ID', 'Description', 'Quantity', 'Unit Price', 'Line Total'], rows: 8 }],
      buttons: [{ text: 'Send invoice', script: 'Send invoice' }, { text: 'Mark as paid', script: 'Mark as paid' }] },
      list: { fields: ['ID', 'Customer Name', 'Issued', 'Status', 'Total'] } },
    { table: 'Lines', form: { fields: ['Invoice ID', 'Product ID', 'Description', 'Quantity', 'Unit Price', 'Line Total'] }, list: { fields: ['Invoice ID', 'Description', 'Quantity', 'Unit Price', 'Line Total'] } },
  ],
  reports: [{ name: 'Invoices by status', table: 'Invoices', fields: ['ID', 'Customer Name', 'Issued', 'Total'], groups: ['Status'], totals: ['Total Billed'] }],
  privilegeSets: [staff('customers, products and invoices'), readOnly()],
  sample: [
    { table: 'Customers', rows: [
      { Name: 'Alder & Finch Architects', Email: 'accounts@alder-finch.example', Address: '12 Mill Lane', Notes: 'Sample record. Delete me.' },
      { Name: 'Quill Print Shop', Email: 'office@quill-print.example', Address: '3 Dock Road', Notes: 'Sample record. Delete me.' },
    ] },
    { table: 'Products', rows: [
      { Name: 'Site survey', Price: 450, Notes: 'Sample record. Delete me.' },
      { Name: 'Drawing set', Price: 120, Notes: 'Sample record. Delete me.' },
      { Name: 'Print run, 500 leaflets', Price: 85, Notes: 'Sample record. Delete me.' },
    ] },
    { table: 'Invoices', rows: [
      { 'Customer ID': 1, Issued: '2026-09-01', Status: 'Paid', Notes: 'Sample record. Delete me.' },
      { 'Customer ID': 1, Issued: '2026-10-01', Status: 'Sent', Notes: 'Sample record. Delete me.' },
      { 'Customer ID': 2, Issued: '2026-10-10', Status: 'Draft', Notes: 'Sample record. Delete me.' },
    ] },
    { table: 'Lines', rows: [
      { 'Invoice ID': 1, 'Product ID': 1, Quantity: 1, 'Unit Price': 450 },
      { 'Invoice ID': 2, 'Product ID': 2, Quantity: 3, 'Unit Price': 120 },
      { 'Invoice ID': 3, 'Product ID': 3, Quantity: 2, 'Unit Price': 85 },
    ] },
  ],
};

const tasks: Starter = {
  name: 'tasks', title: 'Projects and tasks', summary: 'Projects with tasks, who is doing what by when, and a report of tasks by status.',
  tables: [
    { name: 'Projects', fields: [serial, required('Name'), text('Owner'), note(),
      calc('Task Count', 'Count ( Tasks::ID )', 'number', true),
      calc('Done Count', 'Sum ( Tasks::Is Done )', 'number', true),
      calc('Percent Done', 'Case ( Task Count = 0 ; 0 ; Round ( Done Count / Task Count * 100 ; 0 ) )', 'number', true)] },
    { name: 'Tasks', fields: [serial, key('Project ID'), calc('Project Name', 'Projects::Name', 'text', true), required('Title'), text('Assignee'), initial('Priority', 'Normal'), initial('Status', 'To do'),
      date('Due'), date('Done On'), note(),
      calc('Is Done', 'Case ( Status = "Done" ; 1 ; 0 )'),
      calc('Overdue', 'Case ( Status ≠ "Done" and not IsEmpty ( Due ) and Due < Get ( CurrentDate ) ; 1 ; 0 )', 'number', true),
      summary('Tasks Counted', 'count', 'ID')] },
  ],
  relationships: [{ left: 'Projects::ID', right: 'Tasks::Project ID', createRight: true, deleteRight: true }],
  valueLists: [
    { name: 'Priority', values: ['Low', 'Normal', 'High'] },
    { name: 'Task status', values: ['To do', 'Doing', 'Done'] },
  ],
  popups: { 'Tasks::Priority': 'Priority', 'Tasks::Status': 'Task status' },
  scripts: [
    { name: 'Mark done', text: `# Marks the task you are on as done and records the day. A task that is already done is left alone.
If [ Tasks::Status = "Done" ]
	Exit Script [ Result: "already done" ]
End If
Set Field [ Tasks::Status ; "Done" ]
Set Field [ Tasks::Done On ; Get ( CurrentDate ) ]
Exit Script [ Result: "done" ]` },
    { name: 'Reopen', text: `# Puts a done task back to To do.
If [ Tasks::Status ≠ "Done" ]
	Exit Script [ Result: "not done" ]
End If
Set Field [ Tasks::Status ; "To do" ]
Set Field [ Tasks::Done On ; "" ]
Exit Script [ Result: "reopened" ]` },
    { name: 'Duplicate task', text: `# Copies the task you are on as a new To do, for work that repeats.
Duplicate Record/Request
Set Field [ Tasks::Status ; "To do" ]
Set Field [ Tasks::Done On ; "" ]
Exit Script [ Result: "duplicated" ]` },
  ],
  layouts: [
    { table: 'Projects', form: { fields: ['Name', 'Owner', 'Task Count', 'Done Count', 'Percent Done', 'Notes'], portals: [{ table: 'Tasks', fields: ['Title', 'Assignee', 'Status', 'Due'], rows: 8 }] }, list: { fields: ['Name', 'Owner', 'Task Count', 'Percent Done'] } },
    { table: 'Tasks', form: { fields: ['Project Name', 'Title', 'Assignee', 'Priority', 'Status', 'Due', 'Done On', 'Notes'],
      buttons: [{ text: 'Mark done', script: 'Mark done' }, { text: 'Reopen', script: 'Reopen' }, { text: 'Duplicate', script: 'Duplicate task' }] },
      list: { fields: ['Project Name', 'Title', 'Assignee', 'Priority', 'Status', 'Due'] } },
  ],
  reports: [{ name: 'Tasks by status', table: 'Tasks', fields: ['Project Name', 'Title', 'Assignee', 'Due'], groups: ['Status'], totals: ['Tasks Counted'] }],
  privilegeSets: [staff('projects and tasks'), readOnly()],
  sample: [
    { table: 'Projects', rows: [
      { Name: 'Garden shed', Owner: 'Sam', Notes: 'Sample record. Delete me.' },
      { Name: 'Autumn newsletter', Owner: 'Priya', Notes: 'Sample record. Delete me.' },
    ] },
    { table: 'Tasks', rows: [
      { 'Project ID': 1, Title: 'Order timber', Assignee: 'Sam', Priority: 'High', Status: 'Done', Due: '2026-09-20', 'Done On': '2026-09-18', Notes: 'Sample record. Delete me.' },
      { 'Project ID': 1, Title: 'Lay the base', Assignee: 'Sam', Priority: 'High', Status: 'Doing', Due: '2026-10-05', Notes: 'Sample record. Delete me.' },
      { 'Project ID': 1, Title: 'Paint', Assignee: 'Lee', Priority: 'Low', Due: '2027-03-01', Notes: 'Sample record. Delete me.' },
      { 'Project ID': 2, Title: 'Draft the lead story', Assignee: 'Priya', Status: 'Doing', Due: '2027-02-01', Notes: 'Sample record. Delete me.' },
      { 'Project ID': 2, Title: 'Collect photos', Assignee: 'Lee', Due: '2027-02-10', Notes: 'Sample record. Delete me.' },
    ] },
  ],
};

const booking: Starter = {
  name: 'booking', title: 'Bookings', summary: 'Rooms or people you book by the hour, a booking list that refuses double bookings, and hours booked by status.',
  tables: [
    { name: 'Resources', fields: [serial, required('Name'), text('Kind'), num('Capacity'), note(), calc('Booking Count', 'Count ( Bookings::ID )', 'number', true)] },
    { name: 'Bookings', fields: [serial, key('Resource ID'), calc('Resource Name', 'Resources::Name', 'text', true), required('Customer'), text('Email'),
      date('Day'), { name: 'Start', type: 'time' }, { name: 'End', type: 'time' }, initial('Status', 'Requested'), note(),
      calc('Hours', 'Case ( IsEmpty ( Start ) or IsEmpty ( End ) ; 0 ; Round ( ( End - Start ) / 3600 ; 2 ) )'),
      summary('Total Hours', 'total', 'Hours')] },
  ],
  relationships: [{ left: 'Resources::ID', right: 'Bookings::Resource ID', createRight: true, deleteRight: true }],
  valueLists: [{ name: 'Booking status', values: ['Requested', 'Confirmed', 'Cancelled'] }],
  popups: { 'Bookings::Status': 'Booking status' },
  scripts: [
    { name: 'Book', text: `# Adds a booking unless it overlaps one that is not cancelled. The parameter is
# "resource id | customer | day | start | end", for example "1|Ana Ruiz|2026-11-02|09:00:00|11:00:00" (day as year-month-day).
Set Variable [ $resource ; Value: GetValue ( Substitute ( Get ( ScriptParameter ) ; "|" ; ¶ ) ; 1 ) ]
Set Variable [ $customer ; Value: GetValue ( Substitute ( Get ( ScriptParameter ) ; "|" ; ¶ ) ; 2 ) ]
Set Variable [ $day ; Value: GetValue ( Substitute ( Get ( ScriptParameter ) ; "|" ; ¶ ) ; 3 ) ]
Set Variable [ $start ; Value: GetValue ( Substitute ( Get ( ScriptParameter ) ; "|" ; ¶ ) ; 4 ) ]
Set Variable [ $end ; Value: GetValue ( Substitute ( Get ( ScriptParameter ) ; "|" ; ¶ ) ; 5 ) ]
If [ IsEmpty ( $resource ) or IsEmpty ( $customer ) or IsEmpty ( $day ) or IsEmpty ( $start ) or IsEmpty ( $end ) ]
	Exit Script [ Result: "need resource, customer, day, start and end" ]
End If
If [ GetAsTime ( $end ) ≤ GetAsTime ( $start ) ]
	Exit Script [ Result: "the end must be after the start" ]
End If
Set Error Capture [ On ]
Go to Layout [ “Bookings” ]
Show All Records
Set Variable [ $clash ; Value: 0 ]
Go to Record/Request/Page [ First ]
Loop
	Exit Loop If [ IsEmpty ( Bookings::ID ) ]
	If [ Bookings::Resource ID = $resource and Bookings::Day = GetAsDate ( $day ) and Bookings::Status ≠ "Cancelled" and Bookings::Start < GetAsTime ( $end ) and Bookings::End > GetAsTime ( $start ) ]
		Set Variable [ $clash ; Value: 1 ]
	End If
	Go to Record/Request/Page [ Next ; Exit after last: On ]
End Loop
If [ $clash ]
	Exit Script [ Result: "that time is already booked" ]
End If
New Record/Request
Set Field [ Bookings::Resource ID ; $resource ]
Set Field [ Bookings::Customer ; $customer ]
Set Field [ Bookings::Day ; $day ]
Set Field [ Bookings::Start ; $start ]
Set Field [ Bookings::End ; $end ]
Exit Script [ Result: "booked" ]` },
    { name: 'Confirm booking', text: `# Confirms the booking you are on. A cancelled booking stays cancelled.
If [ Bookings::Status = "Cancelled" ]
	Exit Script [ Result: "cancelled" ]
End If
Set Field [ Bookings::Status ; "Confirmed" ]
Exit Script [ Result: "confirmed" ]` },
    { name: 'Cancel booking', text: `# Cancels the booking you are on, which frees the time for the next one.
If [ Bookings::Status = "Cancelled" ]
	Exit Script [ Result: "already cancelled" ]
End If
Set Field [ Bookings::Status ; "Cancelled" ]
Exit Script [ Result: "cancelled" ]` },
  ],
  layouts: [
    { table: 'Resources', form: { fields: ['Name', 'Kind', 'Capacity', 'Booking Count', 'Notes'], portals: [{ table: 'Bookings', fields: ['Day', 'Start', 'End', 'Customer', 'Status'], rows: 8 }] }, list: { fields: ['Name', 'Kind', 'Capacity', 'Booking Count'] } },
    { table: 'Bookings', form: { fields: ['Resource Name', 'Customer', 'Email', 'Day', 'Start', 'End', 'Hours', 'Status', 'Notes'],
      buttons: [{ text: 'Confirm', script: 'Confirm booking' }, { text: 'Cancel', script: 'Cancel booking' }] },
      list: { fields: ['Day', 'Start', 'End', 'Resource Name', 'Customer', 'Status'] } },
  ],
  reports: [{ name: 'Hours by status', table: 'Bookings', fields: ['Day', 'Resource Name', 'Customer', 'Hours'], groups: ['Status'], totals: ['Total Hours'] }],
  privilegeSets: [staff('resources and bookings'), readOnly()],
  sample: [
    { table: 'Resources', rows: [
      { Name: 'Meeting room', Kind: 'Room', Capacity: 8, Notes: 'Sample record. Delete me.' },
      { Name: 'Studio', Kind: 'Room', Capacity: 3, Notes: 'Sample record. Delete me.' },
    ] },
    { table: 'Bookings', rows: [
      { 'Resource ID': 1, Customer: 'Ana Ruiz', Email: 'ana@example.test', Day: '2026-11-02', Start: '09:00:00', End: '11:00:00', Status: 'Confirmed', Notes: 'Sample record. Delete me.' },
      { 'Resource ID': 1, Customer: 'Ben Cole', Email: 'ben@example.test', Day: '2026-11-02', Start: '13:00:00', End: '14:30:00', Notes: 'Sample record. Delete me.' },
      { 'Resource ID': 2, Customer: 'Chloe Wen', Email: 'chloe@example.test', Day: '2026-11-03', Start: '10:00:00', End: '12:00:00', Status: 'Cancelled', Notes: 'Sample record. Delete me.' },
    ] },
  ],
};

export const STARTER_SOLUTIONS: Record<string, Starter> = { crm, inventory, invoicing, tasks, booking };
