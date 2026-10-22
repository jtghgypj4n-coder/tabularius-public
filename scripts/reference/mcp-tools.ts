// Hand-checked notes for the MCP tools registered in packages/server/src/mcp.ts:
// who may call each one, and an example call with the text it returns.
// Names, descriptions and parameters come from the code itself.

import type { McpToolNotes } from './types.ts';

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/** What a create, update or delete returns when an approval-gated AI agent account makes it. */
const PENDING = 'For an approval-gated AI agent account the write is not made: it is recorded for a person to approve, and the tool returns ' +
  '{"status": "pending_approval", "pendingId": …, "summary": …, "message": …} instead.';

const findSyntax = 'Each find request is {field: criteria}; fields in one request are ANDed, requests are ORed, {"omit": true} in a request excludes its matches. ' +
  'Criteria: "abc" finds a word starting abc; "=abc" a whole word; "==abc" the whole field; "=" empty; "*" any value; "<100", ">=5", "1...10" ranges; ' +
  'dates as 2026-01-31 or in the file\'s own format, "2026-01-01...2026-03-31" for a range; * (any text) and @ (one character) wildcards; "quoted phrase". ' +
  'Related fields are searched as "Occurrence::Field": a record matches when one of its related records matches all the criteria on that occurrence ' +
  '("customers with an unpaid invoice over 500").';

export const tools: Record<string, McpToolNotes> = {
  list_databases: {
    permissions: 'Any identity. Lists only the hosted files it can use (its account signs in and has fmmcp there); files with AI turned off are never listed.',
    example: {
      arguments: {},
      response: pretty(['Invoices', 'Contacts']),
    },
  },

  sync_status: {
    permissions: 'Only the administrator\'s own client (the server\'s MCP token); never an account. Read-only: an administrator settles conflicts and starts writes in the admin console\'s Sync page. Shows only files with AI turned on. Record values, passwords and password file paths are never shown.',
    example: {
      arguments: { database: 'Shop' },
      response: pretty({
        files: [{
          database: 'Shop', server: 'fms.example.com', remoteDatabase: 'Shop', tables: ['Contacts'], allowWrites: true, allowPulls: false, allowContainers: false, running: false, passwordSaved: true,
          last: {
            at: '2026-10-15T08:00:00.000Z', trigger: 'scheduled',
            tables: [{ table: 'Contacts', toSend: 2, toBringIn: 1, sent: 0, broughtIn: 0, failed: 0 }],
            conflicts: 1, conflictsListed: [{ table: 'Contacts', uuid: '7c1f…', kind: 'both-changed', fields: ['Phone'] }],
          },
          schedules: [{ name: 'Sync Shop', enabled: true, mode: 'check only', everyMinutes: 60, lastRun: { at: '2026-10-15T08:00:00.000Z', result: '1 to send, 1 to bring in, 1 conflict', conflicts: 1 } }],
        }],
        waitingOnADecision: [{ schedule: 'Sync Shop', database: 'Shop', at: '2026-10-15T08:00:00.000Z', conflicts: 1 }],
      }),
      skipReason: 'Needs a configured external FileMaker Server sync connection.',
    },
  },

  describe_database: {
    permissions: 'Any identity that can use the file. Tables, fields, layouts, scripts and value lists are filtered by the privilege set; formulas and custom functions only for sets that can modify scripts; a set other than [Full Access] sees only its own privilege set\'s name.',
    example: {
      arguments: { database: 'Invoices' },
      response: pretty({
        database: 'Invoices',
        createdWith: 'FileMaker Tabularius',
        tables: [
          {
            name: 'Customers',
            fields: [{ name: 'Id', type: 'text', kind: 'normal' }, { name: 'Name', type: 'text', kind: 'normal' }, { name: 'Email', type: 'text', kind: 'normal' }],
          },
          {
            name: 'Invoices',
            fields: [
              { name: 'CustomerId', type: 'text', kind: 'normal' }, { name: 'Customer', type: 'text', kind: 'normal' },
              { name: 'Amount', type: 'number', kind: 'normal' }, { name: 'Status', type: 'text', kind: 'normal' },
              { name: 'Date', type: 'date', kind: 'normal' }, { name: 'Attachment', type: 'container', kind: 'normal' },
              { name: 'Total', type: 'number', kind: 'calculation' },
            ],
          },
        ],
        tableOccurrences: [{ name: 'Customers', baseTable: 'Customers' }, { name: 'Invoices', baseTable: 'Invoices' }],
        layouts: [{ name: 'Customers', table: 'Customers' }, { name: 'Invoices', table: 'Invoices' }],
        scripts: [{ name: 'Mark Paid', steps: 2 }],
        valueLists: [{ id: 1, name: 'Status', values: ['Open', 'Paid'] }],
        customFunctions: [],
        privilegeSets: ['[Full Access]'],
        note: 'Formulas, auto-enter calculations and custom function bodies are left out: pass detail with table or custom function names to see them.',
      }),
    },
    notes: 'A masked field is listed with masked: true and readOnly: true (a hidden one is left out). An account signed in with a password also gets "account" and "privilegeSet" fields. A large file\'s outline is shortened to one line per field, then to field names only, and the note says so.',
  },

  explain_access: {
    permissions: 'Any identity that can use the file. A set other than [Full Access] can explain only its own privilege set; [Full Access] and the server administrator can name any set (the administrator must name one).',
    example: {
      arguments: { database: 'Invoices', privilegeSet: '[Full Access]' },
      response: pretty({
        privilegeSet: '[Full Access]',
        fullAccess: true,
        extendedPrivileges: ['(all)'],
        menuCommands: 'all',
        defaultRecords: { table: '(every other table)', view: { allowed: true }, edit: { allowed: true }, create: true, delete: { allowed: true } },
        tables: [
          { table: 'Customers', view: { allowed: true }, edit: { allowed: true }, create: true, delete: { allowed: true } },
          { table: 'Invoices', view: { allowed: true }, edit: { allowed: true }, create: true, delete: { allowed: true } },
        ],
        layouts: { default: 'modifiable', exceptions: [] },
        scripts: { default: 'modifiable', exceptions: [] },
        valueLists: { default: 'modifiable', exceptions: [] },
      }),
    },
  },

  who_can_access: {
    permissions: '[Full Access] or the server administrator only (it lists every account); any other privilege set is refused, and so is a scoped API token. Names accounts, privilege sets and fields, never record values.',
    example: {
      arguments: { database: 'Invoices', table: 'Invoices' },
      response: pretty({
        database: 'Invoices',
        table: 'Invoices',
        sets: [
          {
            privilegeSet: 'Sales', accounts: ['ann', 'bob'], view: 'all records', edit: 'all records', create: 'yes', delete: 'no',
            hiddenFields: ['Salary'], readOnlyFields: [], maskedFields: [],
            says: 'Sales (ann, bob) can see all records, change all records, add new ones and not delete; cannot see Salary.',
          },
          {
            privilegeSet: 'Viewers', accounts: ['carol'], view: 'some records', edit: 'no', create: 'no', delete: 'no',
            hiddenFields: [], readOnlyFields: [], maskedFields: [],
            says: 'Viewers (carol) can see some records, not change any, not add and not delete.',
          },
        ],
        canSee: ['ann', 'bob', 'carol'],
        summary: '3 of 3 active accounts can see Invoices. Sales (ann, bob) can see all records, change all records, add new ones and not delete; cannot see Salary. Viewers (carol) can see some records, not change any, not add and not delete.',
      }),
    },
    notes: 'Only accounts that are turned on and have a privilege set count. A record rule on the set ("only its own records") reads as "some records". ' +
      'With field, the answer is about that field alone: sets that can\'t see it say "cannot see Invoices::Salary", a view-only field can be seen but not changed, a set that sees only a masked version of it is marked masked: true (its accounts are listed in canSeeMasked, not canSee), and hiddenFields, readOnlyFields and create are empty. maskedFields lists the fields a set sees only a stand-in for. ' +
      'An unknown table or field is an error.',
  },

  preview_privilege_set: {
    permissions: '[Full Access] or the server administrator. Read-only: it never saves the set.',
    example: {
      arguments: {
        database: 'Invoices',
        proposed: { name: 'Sales', records: { view: true, edit: 'Status = "Open"', create: true, delete: false }, layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmrest'] },
      },
      response: pretty({
        valid: true,
        changes: [
          { area: 'records', detail: 'default record access → view yes, edit limited (Status = "Open"), create yes, delete no' },
          { area: 'layouts', detail: 'default layouts access → viewOnly' },
          { area: 'scripts', detail: 'default scripts access → viewOnly' },
          { area: 'valueLists', detail: 'default valueLists access → viewOnly' },
          { area: 'extendedPrivileges', detail: 'grant fmrest' },
        ],
      }),
    },
  },

  get_script: {
    permissions: 'Any identity that can use the file, for a script its privilege set can modify; a script it can only run is refused, and one it has no access to reads as missing. Secrets in the script text are hidden.',
    example: {
      arguments: { database: 'Invoices', script: 'Mark Paid' },
      response: pretty({ name: 'Mark Paid', id: 1, text: 'Set Field [ Invoices::Status ; "Paid" ]\nExit Script [ Result: "done" ]' }),
    },
    notes: 'With detail: true the result also has "steps": each step\'s name, enabled flag and decoded params. A Perform Script step that picks its script by name shows as Perform Script [ Specified: By name ; calculation ] (the calculation gives the name, "File::Script" for another file).',
  },

  run_script: {
    permissions: 'Any identity that can use the file, for a script (and starting layout) its privilege set can use; the script runs as that account with its privileges. Scripts run offline: no network, mail or AI steps, whatever the server allows people.',
    example: {
      arguments: { database: 'Invoices', script: 'Mark Paid', layout: 'Invoices' },
      response: pretty({ result: 'done', error: 0, halted: false, layout: 'Invoices', foundCount: 3, recordId: 1, foundSet: [1, 2, 3], mode: 'browse', steps: 2, actions: [] }),
    },
    notes: 'With trace: true the result also has "trace": each step that ran ({script, index, line}). $$variables and global fields last between calls for each file while the server runs. ' +
      'A Perform Script step that picks its script by name (Specified: By name) runs the script its calculation names, matched ignoring case; a name that matches none stops with error 104, and the privilege set must be able to run that script too.',
  },

  debug_script: {
    permissions: '[Full Access] or the server administrator.',
    example: {
      arguments: { database: 'Invoices', script: 'Mark Paid', layout: 'Invoices', breakpoints: [{ step: 2 }], watch: ['Invoices::Status'] },
      response: pretty({
        stops: [{
          script: 'Mark Paid', step: 2, line: 'Exit Script [ Result: "done" ]', lastError: 0, layout: 'Invoices', foundCount: 3, recordId: 1,
          variables: { locals: {}, globals: {} },
          watch: [{ formula: 'Invoices::Status', value: 'Paid' }],
        }],
        scratch: true,
        result: { result: 'done', error: 0, halted: false, layout: 'Invoices', foundCount: 3, recordId: 1, foundSet: [1, 2, 3], mode: 'browse', steps: 2, actions: [] },
      }),
    },
  },

  explain_script_failure: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess), and that may run the script; not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices', script: 'Mark Paid', layout: 'Invoices', recordId: 1 },
      response: pretty({
        script: 'Mark Paid',
        outcome: 'ok',
        error: 0,
        layout: 'Invoices',
        hints: ['It ran to the end with no error here. If it failed for someone, try their layout, record and account: the found set, the record and privileges change what a script does.'],
        ranOn: 'a throwaway copy of the file, offline (nothing was sent or changed)',
      }),
    },
    notes: 'Where the step names a calculation field, its inputs come from the same explanation as explain_value: an input the privilege set can\'t see shows as "‹no access›" instead of its value.',
  },

  find_records: {
    permissions: 'Any identity that can use the file. Layouts, records and fields are filtered by the privilege set; values of password, key and token fields are hidden and long values cut. A masked field comes back as its stand-in (its last four characters, or a fixed text), never its value.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', query: [{ Status: 'Open' }], limit: 2, fields: ['Customer', 'Amount', 'Status'] },
      response: pretty({
        records: [{ recordId: 1, modId: 0, fieldData: { Customer: 'Acme Corp', Amount: 1200, Status: 'Open' } }],
        foundCount: 1,
        totalCount: 3,
      }),
    },
    notes: 'A masked field can\'t be searched or sorted by (an error). A portal on the layout comes back in each record\'s "portalData". A portal on the layout\'s own table occurrence (it shows the found set) reads only Portal Setup\'s number of rows plus five (10 plus five when none is set), not 50.',
  },

  get_record: {
    permissions: 'Any identity that can use the file, for a record its privilege set can view; fields it can\'t see are left out, a masked field comes back as its stand-in, and values of password, key and token fields are hidden.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', recordId: 1 },
      response: pretty({
        recordId: 1,
        modId: 0,
        fieldData: { CustomerId: 'C1', Customer: 'Acme Corp', Amount: 1200, Status: 'Open', Date: '2026-09-01', Attachment: '', Total: 1320 },
      }),
    },
    notes: 'A portal on the layout comes back in "portalData"; one on the layout\'s own table occurrence (it shows the found set) reads only Portal Setup\'s number of rows plus five (10 plus five when none is set), not 50.',
  },

  describe_record: {
    permissions: 'Any identity that can use the file. The record, its fields and its related records are only those the privilege set can see (in each file). A masked field shows its stand-in, and "masked" lists those fields.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', recordId: 1 },
      response: pretty({
        layout: 'Invoices',
        occurrence: 'Invoices',
        table: 'Invoices',
        recordId: 1,
        fields: { CustomerId: 'C1', Customer: 'Acme Corp', Amount: 1200, Status: 'Open', Date: '2026-09-01', Total: 1320 },
        empty: ['Attachment'],
        related: [{
          occurrence: 'Customers',
          table: 'Customers',
          match: 'Invoices::CustomerId = Customers::Id',
          count: 1,
          records: [{ recordId: 1, fields: { Id: 'C1', Name: 'Acme Corp', Email: 'billing@acme.example' } }],
        }],
        note: 'Cite each fact as [Occurrence::Field] for this record, or [Occurrence::Field #recordId] for a related record. Only records and fields this account can see are here; secret-looking values are hidden. Related records list stored fields only.',
      }),
    },
  },

  create_record: {
    permissions: 'Any identity that can use the file whose privilege set may create records in the layout\'s table; a read-only API token can\'t.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', fieldData: { Customer: 'Initech', Amount: 99 } },
      response: pretty({ recordId: 4, modId: 0 }),
    },
    notes: PENDING + ' Naming a masked field is refused ("cannot be modified"), whatever value is sent, the stand-in echoed back included.',
  },

  update_record: {
    permissions: 'Any identity that can use the file whose privilege set may edit the record (and its portal rows); a read-only API token can\'t.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', recordId: 1, fieldData: { Status: 'Paid' } },
      response: pretty({ modId: 1 }),
    },
    notes: `${PENDING} Portal edits are refused outright for such an agent. A masked field can\'t be changed: naming one is refused ("cannot be modified"), the stand-in echoed back included.`,
  },

  update_records: {
    permissions: 'Any identity that can use the file; every change is made as this account, so its privilege set\'s edit rules apply, and only records it can view are touched. A read-only API token can\'t, and an approval-gated AI agent is refused.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', query: [{ Status: 'Open', Customer: 'Initech' }], fieldData: { Status: 'Paid' }, expectCount: 2 },
      response: pretty({
        id: 'c21451e52878',
        at: '2026-10-13T09:20:48.464Z',
        layout: 'Invoices',
        summary: '2 of 2 records changed',
        changes: 2,
        matched: 2,
        records: 2,
      }),
    },
    notes: 'With dryRun: true nothing is changed and the result is {dryRun: true, summary, matched, records, changes, total}: each value that would change (the first 200 in changes; total counts them all). Records that already have the value are matched but not counted in records. At most 1,000 records; a find that gives more, or not expectCount, changes nothing. A record that refuses the value (a validation rule, a lock, a privilege) stops the whole change.',
  },

  upload_container: {
    permissions: 'Any identity that can use the file whose privilege set may edit the record and field; a read-only API token can\'t, and an approval-gated AI agent is refused. Files are limited to 100 MB.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', recordId: 1, field: 'Attachment', filename: 'note.txt', mime: 'text/plain', data: 'aGVsbG8=' },
      response: pretty({ modId: 1 }),
    },
  },

  evaluate_calculation: {
    permissions: 'Any identity whose privilege set can read every table and field (readsEverything), and the record if one is named; not available to scoped API tokens, so refused for an account with a masked field. Results that read a password, key or token field are hidden.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', formula: 'Amount * 2', recordId: 1 },
      response: pretty({ value: '2400', type: 'number' }),
    },
    notes: 'Without recordId, a formula that reads fields also gets a "note" that they read as empty.',
  },

  delete_record: {
    permissions: 'Any identity that can use the file whose privilege set may delete the record; a read-only API token can\'t.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', recordId: 4 },
      response: pretty({ deleted: 4 }),
    },
    notes: PENDING,
  },

  revert_change: {
    permissions: 'Any identity that can use the file whose privilege set may make the change by hand (edit the fields, create or delete the record); a read-only API token can\'t. Refused while PII isolation is on.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', recordId: 1, seq: 812, fields: ['Status'] },
      response: pretty({ action: 'updated', fields: ['Status'], skipped: [] }),
    },
    notes: 'seq is the audit entry to put back (explain_record_history shows it on each change). action is updated, deleted (a created record is removed) or created (a deleted record is made again under its id). skipped lists fields left as they are: values that were not logged, containers, repetitions, and fields the account cannot see. The put-back is logged as a change of its own that names the entry it reverts. ' + PENDING,
  },

  get_container: {
    permissions: 'Any identity that can use the file. A privilege set that can\'t read every table and field must pass the signed container URL from a record it can see; a bare container id is refused.',
    example: {
      arguments: { database: 'Invoices', container: 1 },
      response: '{"id":1,"filename":"note.txt","mime":"text/plain","bytes":5}\n\nhello',
    },
    notes: 'Text files (up to 5 MB) come back as the JSON summary, a blank line and the text, as here. PNG, JPEG, GIF and WebP images (up to 5 MB) come back as the JSON summary plus an image content item; anything else as JSON {id, filename, mime, bytes, note}.',
  },

  sql_query: {
    permissions: 'Any identity whose privilege set can read every table and field (readsEverything); not available to scoped API tokens. Values of password, key and token columns are hidden. An account with a masked field is refused, as it cannot read every field.',
    example: {
      arguments: { database: 'Invoices', sql: 'SELECT "Customer", SUM("Amount") AS total FROM "Invoices" GROUP BY "Customer"' },
      response: pretty([{ Customer: 'Acme Corp', total: 1500 }, { Customer: 'Globex', total: 450 }]),
    },
  },

  explain_solution: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices' },
      response: [
        '# Invoices',
        'Created with FileMaker Tabularius. 2 tables, 2 table occurrences, 1 relationships, 2 layouts, 1 scripts, 1 value lists, 0 custom functions, 1 accounts.',
        '',
        '## Tables',
        '- **Customers**: 2 records; 3 data, 0 calculation, 0 summary, 0 global fields; layouts: Customers',
        '- **Invoices**: 3 records; 6 data, 1 calculation, 0 summary, 0 global fields; layouts: Invoices',
        '',
        '## Relationships',
        '- Invoices::CustomerId = Customers::Id',
        '',
        '## Scripts',
        'Not called by other scripts, buttons, triggers, custom menus or File Options (run from the Scripts menu, by URL or another file, or unused): Mark Paid.',
        '',
        '## Value lists',
        '- Status: Open, Paid',
        '',
        '## Security',
        'Privilege sets: [Full Access]. Accounts: Admin.',
      ].join('\n'),
    },
    notes: 'Markdown. With item, the text describes that one table, layout, script, field, custom function or value list.',
  },

  solution_map: {
    permissions: 'Any identity. Covers only the hosted files it may see the design of (designAccess in each); a file with AI turned off appears only as an opaque node.',
    example: {
      arguments: {},
      response: pretty({
        files: [
          { name: 'Invoices', reaches: [], referencedBy: ['Invoices Staging'], unresolved: [] },
          { name: 'Invoices Staging', reaches: ['Invoices'], referencedBy: [], unresolved: [] },
        ],
        references: [
          { from: 'Invoices Staging', via: 'occurrence', item: 'Live Customers', file: 'Invoices', hosted: true, detail: 'base table Customers' },
        ],
        unresolved: [],
      }),
    },
  },

  document_solution: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices', section: 'scripts' },
      response: [
        '## Scripts',
        '',
        '### Mark Paid',
        '',
        '<a id="script-mark-paid"></a>',
        '',
        '2 steps.',
        '',
        '- Not started by any button, trigger or script (a menu, a schedule, or unused)',
        '',
      ].join('\n'),
    },
    notes: 'Markdown.',
  },

  where_used: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices', name: 'Invoices::Status' },
      response: pretty([{
        target: { kind: 'field', name: 'Invoices::Status' },
        count: 2,
        usages: [
          { kind: 'script', where: 'Script "Mark Paid", line 1', text: 'Set Field [ Invoices::Status ; "Paid" ]' },
          { kind: 'layout', where: 'Layout "Invoices"', text: 'field Invoices::Status' },
        ],
      }]),
    },
  },

  search_solution: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices', text: 'paid' },
      response: pretty({
        count: 3,
        byKind: { script: 2, valueList: 1 },
        hits: [
          { kind: 'script', where: 'Script "Mark Paid"', text: '2 steps' },
          { kind: 'script', where: 'Script "Mark Paid", line 1', text: 'Set Field [ Invoices::Status ; "Paid" ]' },
          { kind: 'valueList', where: 'Value list "Status"', text: 'Open, Paid' },
        ],
      }),
    },
  },

  describe_layout: {
    permissions: 'Any identity that can use the file and the layout. A restricted set sees only its fields, and counts and values from the records it can view. A masked field is listed as {name, type, kind, masked: true} with no counts, ranges or values.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices' },
      response: pretty({
        layout: 'Invoices',
        table: 'Invoices',
        occurrence: 'Invoices',
        records: 3,
        fields: [
          { name: 'Number', type: 'number', kind: 'data', filled: 3, distinct: 3, min: 300, max: 1200, examples: [1200, 300, 450] },
          { name: 'Customer', type: 'text', kind: 'data', filled: 3, distinct: 2, values: ['Acme Corp', 'Globex'] },
          { name: 'Amount', type: 'number', kind: 'data', filled: 3, distinct: 3, min: 300, max: 1200, examples: [1200, 300, 450] },
          { name: 'Status', type: 'text', kind: 'data', filled: 3, distinct: 3, values: ['Paid', 'Open', 'Actve'] },
          { name: 'Date', type: 'date', kind: 'data', filled: 3, distinct: 3, min: '2026-08-15', max: '2026-09-20', examples: ['2026-09-01', '2026-08-15', '2026-09-20'] },
          { name: 'Attachment', type: 'container', kind: 'data' },
          { name: 'Total', type: 'number', kind: 'calculation', filled: 3, distinct: 3, min: 330, max: 1320, examples: [1320, 330, 495] },
        ],
        portals: [],
        findSyntax,
      }),
    },
  },

  check_calculation: {
    permissions: 'Any identity that can use the layout and whose privilege set can read every table and field (readsEverything); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', formula: 'Amout * 1.2', sampleRecords: 2 },
      response: pretty({
        ok: false,
        fields: [{ name: 'Amout', found: false }],
        functions: [],
        problems: ['"Amout" is not a field of Invoices, a Let variable or a function (did you mean "Amount"?)'],
        variables: [],
        results: [
          { recordId: 1, error: 'The field "Amout" cannot be found' },
          { recordId: 2, error: 'The field "Amout" cannot be found' },
        ],
      }),
    },
    notes: 'A formula that checks out has ok: true and results like {"recordId": 1, "value": "1440", "type": "number"}.',
  },

  explain_value: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens. Values of password, key and token fields are hidden. The function checks the privilege set itself: a field the set can\'t see is refused (the error says the privilege set can\'t see Table::Field), and a field the formula reads that the set can\'t see comes back as {field, type, kind, hidden: true} with no value, its dependencies shown without formulas.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', field: 'Total', recordId: 1 },
      response: pretty({
        table: 'Invoices',
        field: 'Total',
        type: 'number',
        kind: 'calculation',
        storage: 'stored',
        value: '1320',
        formula: 'Amount * 1.1',
        context: 'Invoices',
        doNotEvaluateIfEmpty: true,
        warnings: [],
        references: [{ field: 'Amount', type: 'number', kind: 'normal', value: '1200', empty: false }],
        result: '1320',
        steps: { expr: 'Amount * 1.1', value: '1320', type: 'number', steps: [{ expr: 'Amount', value: '1200', type: 'number' }] },
        matchesStored: true,
      }),
    },
  },

  check_record: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess), and that may view the record; not available to scoped API tokens. Values of password, key and token fields are hidden. A calculation the privilege set can\'t see is skipped (not counted in checked), and an input it reads that the set can\'t see has hidden: true and no value.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', recordId: 1 },
      response: pretty({
        table: 'Invoices',
        checked: 2,
        problems: [
          {
            field: 'Amount',
            kind: 'validation',
            value: '150000',
            message: 'Amount wouldn\'t pass its validation now: Field "Amount" must be between 0 and 100000.',
          },
          {
            field: 'Total',
            value: '999',
            formula: 'Amount * 1.1',
            inputs: [{ field: 'Amount', value: '150000' }],
            now: '165000',
            kind: 'stale',
            message: 'Total shows a value its formula no longer gives: the stored value was worked out when the record last changed, and something it reads has changed since.',
            causedBy: ['Amount'],
          },
        ],
      }),
    },
    notes: 'checked counts the calculations and validated fields looked at. Problems come root causes first: a problem\'s causedBy names fields on the record that have problems of their own, so start there. ' +
      'kind is one of error, missing-reference, validation, stale, empty-input, not-evaluated or warning.',
  },

  explain_related: {
    permissions: 'Any identity whose privilege set can read every table and field (readsEverything) and view the record; not available to scoped API tokens. Values of password, key and token fields are hidden.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', recordId: 1, field: 'Customers::Name' },
      response: pretty({
        kind: 'related field',
        from: { occurrence: 'Invoices', table: 'Invoices', recordId: 1 },
        to: { occurrence: 'Customers', table: 'Customers' },
        path: [{
          relationship: 'Invoices::CustomerId = Customers::Id',
          from: 'Invoices',
          to: 'Customers',
          match: [{ match: 'Invoices::CustomerId = Customers::Id', values: ['C1'], matches: 1 }],
          records: 1,
        }],
        related: 1,
        rows: [{ recordId: 1, shown: true, keys: { 'Customers::Id': 'C1' }, reason: 'Shown: its match fields match this record' }],
        verdict: 'Customers::Name shows record 1, the first of 1 related record: "Acme Corp"',
        notes: [],
        field: { name: 'Customers::Name', recordId: 1, value: 'Acme Corp' },
      }),
    },
  },

  lint_formulas: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices', table: 'Invoices' },
      response: pretty({
        fieldsWithWarnings: 1,
        fields: [{
          field: 'Invoices::Label',
          warnings: [
            'type-mix: Customer + 1 does arithmetic on the text field Customer: FileMaker uses only the digits in it, so "12 boxes" counts as 12 and "N/A" as nothing.',
            'empty-rule: When every field it reads is empty, the formula gives "1", but "Do not evaluate if all referenced fields are empty" is on, so the field stays empty instead. Turn the option off if that value is wanted (typical for IsEmpty, flags and defaults).',
          ],
        }],
      }),
    },
    notes: 'At most 200 fields are listed; a "note" says how many more there are.',
  },

  check_script: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices', script: 'Set Field [ Invoices::Stauts ; "Paid" ]', layout: 'Invoices' },
      response: pretty({
        ok: false,
        steps: 1,
        problems: [{ line: 1, step: 'Set Field', message: '"Invoices" has no field named "Stauts"' }],
        warnings: [],
        layouts: [],
        scripts: [],
        fields: [],
      }),
    },
  },

  search_records: {
    permissions: 'Any identity that can use the file. Only records and fields its privilege set can see are searched; a masked field is not.',
    example: {
      arguments: { database: 'Invoices', text: 'acme', limit: 2 },
      response: pretty({
        query: 'acme',
        matchedAll: true,
        hits: [
          {
            table: 'Customers', recordId: 1, score: 100,
            matches: [{ field: 'Name', text: '[Acme] Corp' }, { field: 'Email', text: 'billing@[acme].example' }],
            layout: 'Customers',
          },
          { table: 'Invoices', recordId: 1, score: 95, matches: [{ field: 'Customer', text: '[Acme] Corp' }], layout: 'Invoices' },
        ],
      }),
    },
    notes: 'When the file uses tables of files that aren\'t hosted (and tables isn\'t given), the result also has "notSearched" naming them.',
  },

  semantic_find: {
    permissions: 'Any identity that can use the file, on a server started with an embedding model (--ai-embed-url): without one the tool is not offered. Only records its privilege set can view are compared, and the vector field must be readable (not hidden or masked). Refused while personal data isolation is on. Not available if the file\'s AI switch is off.',
    example: {
      arguments: { database: 'Support', layout: 'Tickets', field: 'Embedding', text: 'delivery was late', limit: 2 },
      response: pretty({
        layout: 'Tickets', field: 'Embedding',
        matches: [{ recordId: 14, similarity: 0.912345 }, { recordId: 3, similarity: 0.87021 }],
        scored: 120, noEmbedding: 2, differentLength: 0,
      }),
      skipReason: 'Offered only on a server started with an embedding model (--ai-embed-url).',
    },
    notes: 'The question is sent to the server\'s embedding model (a hosted endpoint, if that is what --ai-embed-url names). The field holds vectors Insert Embedding made (a container) or text holding a vector as a JSON array, from the same model. At most 50,000 records are compared and a scan stops after 10 seconds: "incomplete" says so. Vectors of another length than the model\'s are an error when none can be compared, otherwise counted in "differentLength". Read the records with get_record on the same layout. A vector reveals some of its source field\'s meaning: give the embedding field the access of the field it was made from. The question counts against the daily and monthly AI limits (at most 8,000 characters).',
  },

  summarize_records: {
    permissions: 'Any identity that can use the file. The find and the totals cover only the records and fields its privilege set can see; grouping or measuring a masked field is an error.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', groupBy: ['Customer'], measures: [{ field: 'Amount', fn: 'sum' }] },
      response: pretty({
        layout: 'Invoices',
        foundCount: 3,
        totals: { 'sum(Amount)': 1950 },
        groups: [
          { values: { Customer: 'Acme Corp' }, count: 2, measures: { 'sum(Amount)': 1500 } },
          { values: { Customer: 'Globex' }, count: 1, measures: { 'sum(Amount)': 450 } },
        ],
      }),
    },
  },

  list_dashboards: {
    permissions: 'Any identity that can use the file. Every dashboard saved in the file is listed.',
    example: {
      arguments: { database: 'Invoices' },
      response: pretty({
        dashboards: [{ id: '75b887eb757a', name: 'Sales', description: 'Invoice totals', widgets: 1, account: 'Admin', updated: '2026-10-13T09:15:02.450Z' }],
      }),
    },
  },

  get_dashboard: {
    permissions: 'Any identity that can use the file. Each widget is worked out as this account, from the records and fields its privilege set can see.',
    example: {
      arguments: { database: 'Invoices', dashboard: 'Sales' },
      response: pretty({
        dashboard: {
          id: '75b887eb757a',
          name: 'Sales',
          description: 'Invoice totals',
          widgets: [{ title: 'Revenue by customer', kind: 'chart', chart: 'bar', layout: 'Invoices', groupBy: ['Customer'], measure: { field: 'Amount', fn: 'sum' } }],
          account: 'Admin',
          created: '2026-10-13T09:15:02.450Z',
          updated: '2026-10-13T09:15:02.450Z',
        },
        data: [{
          title: 'Revenue by customer',
          kind: 'chart',
          chart: 'bar',
          layout: 'Invoices',
          find: ['All records'],
          grouping: 'Sum of Amount by Customer',
          foundCount: 3,
          xTitle: 'Customer',
          yTitle: 'sum(Amount)',
          categories: ['Acme Corp', 'Globex'],
          series: [{ name: 'sum(Amount)', values: [1500, 450] }],
        }],
      }),
    },
  },

  save_dashboard: {
    permissions: 'Any identity that can use the file; numbers are worked out as this account. Replacing an existing dashboard needs the account that made it, [Full Access], or the server administrator.',
    example: {
      arguments: {
        database: 'Invoices',
        name: 'Sales',
        widgets: [{ title: 'Revenue by customer', kind: 'table', layout: 'Invoices', groupBy: ['Customer'], measure: { field: 'Amount', fn: 'sum' } }],
        preview: true,
      },
      response: pretty({
        preview: true,
        name: 'Sales',
        widgets: [{ title: 'Revenue by customer', kind: 'table', layout: 'Invoices', groupBy: ['Customer'], measure: { field: 'Amount', fn: 'sum' } }],
        data: [{
          title: 'Revenue by customer',
          kind: 'table',
          layout: 'Invoices',
          find: ['All records'],
          grouping: 'Sum of Amount by Customer',
          foundCount: 3,
          columns: ['Customer', 'sum(Amount)', 'Records'],
          rows: [['Acme Corp', 1500, 2], ['Globex', 450, 1]],
        }],
      }),
    },
    notes: 'Without preview the dashboard is saved and the result is {"saved": true, "dashboard": {…}, "url": "/app/dashboard.html?db=…&id=…", "data": […]}.',
  },

  find_data_problems: {
    permissions: 'Any identity that can use the file. Only the records it can view and the text and number fields it can see are scanned. Changes nothing.',
    example: {
      arguments: { database: 'Invoices', layout: 'Customers', checks: ['emails'] },
      response: pretty({
        layout: 'Customers',
        table: 'Customers',
        scanned: 2,
        compared: [],
        duplicates: [],
        fixes: [{ check: 'emails', field: 'Email', from: 'ap@globex', reason: 'not a valid email address', count: 1, recordIds: [2] }],
      }),
    },
  },

  fix_data_problems: {
    permissions: 'Any identity that can use the file; every change is made as this account, so its privilege set\'s edit and delete rules apply, and only records it can view are touched.',
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', fixes: [{ field: 'Status', from: 'Actve', to: 'Active' }] },
      response: pretty({
        id: 'c21451e52878',
        at: '2026-10-13T09:20:48.464Z',
        layout: 'Invoices',
        summary: '1 value fixed',
        changes: 1,
        fixed: 1,
        merged: 0,
      }),
    },
    notes: 'With dryRun: true nothing is changed and the result is {dryRun: true, summary, fixed, merged, changes, total}: each value that would change and each record that would be deleted (the first 200 in changes; total counts them all).',
  },

  plan_import: {
    permissions: 'Any identity that can use the file. Only fields on the layout its privilege set can modify are offered (no calculations, summaries or containers). Changes nothing.',
    example: {
      arguments: { database: 'Invoices', layout: 'Customers', data: 'Name,Email\nInitech,info@initech.example\nAcme Corp,billing@acme.example\n' },
      response: pretty({
        layout: 'Customers',
        table: 'Customers',
        rows: 2,
        headerRow: true,
        fields: [{ name: 'Id', type: 'text' }, { name: 'Name', type: 'text' }, { name: 'Email', type: 'text' }],
        columns: [
          { column: 0, header: 'Name', field: 'Name', transforms: [], sample: ['Initech', 'Acme Corp'], by: 'name', why: 'same name' },
          { column: 1, header: 'Email', field: 'Email', transforms: [], sample: ['info@initech.example', 'billing@acme.example'], by: 'name', why: 'same name' },
        ],
        keys: ['Email'],
        preview: [
          { row: 2, values: { Name: 'Initech', Email: 'info@initech.example' }, issues: [] },
          { row: 3, values: { Name: 'Acme Corp', Email: 'billing@acme.example' }, issues: [], duplicate: { of: 'existing', recordId: 1 } },
        ],
        summary: { ready: 1, withIssues: 0, duplicatesInFile: 0, duplicatesExisting: 1 },
      }),
    },
  },

  import_records: {
    permissions: 'Any identity that can use the file; records are created as this account, so its privilege set must allow creating records in the layout\'s table, and only fields it can modify are filled.',
    example: {
      arguments: {
        database: 'Invoices',
        layout: 'Customers',
        data: 'Name,Email\nInitech,info@initech.example\nAcme Corp,billing@acme.example\n',
        headerRow: true,
        columns: [{ column: 0, field: 'Name' }, { column: 1, field: 'Email' }],
        keys: ['Email'],
        skipDuplicates: true,
      },
      response: pretty({ id: '1267b43bbfc1', foundSet: [3], imported: 1, skipped: [{ row: 3, why: 'same as record 1' }] }),
    },
  },

  undo_import: {
    permissions: 'Any identity that can use the file can list the recent imports. Undoing one needs the account that made it, [Full Access], or the server administrator; records are deleted as this account.',
    example: {
      arguments: { database: 'Invoices', id: '1267b43bbfc1' },
      response: pretty({ deleted: 1, kept: [] }),
    },
    notes: 'Without id the result is the recent imports: [{"id", "at", "account", "layout", "file", "imported"}, …].',
  },

  undo_data_fix: {
    permissions: 'Any identity that can use the file; values are set back and records restored as this account, with its privileges.',
    example: {
      arguments: { database: 'Invoices', id: 'c21451e52878' },
      response: pretty({ undone: 1, skipped: [] }),
    },
    notes: 'Without id the result is {"history": [{"id", "at", "account", "layout", "summary", "changes"}, …]}.',
  },

  find_stale_calcs: {
    permissions: 'Any identity whose privilege set can read every table and field (readsEverything); not available to scoped API tokens. Changes nothing.',
    example: {
      arguments: { database: 'Invoices' },
      response: pretty({
        fields: [{
          table: 'Invoices', field: 'Total', cause: 'this record only', records: 3, looked: 3, stale: 1,
          wasEmpty: 0, nowEmpty: 0, failing: 0, recordIds: [2], examples: [{ recordId: 2, stored: 999, now: 330 }],
        }],
        skipped: [],
        looked: 3,
        stale: 1,
        note: 'Nothing was changed. "other records" and "fields named at run time" are expected to drift in FileMaker too; refresh_stale_calcs brings chosen ones up to date and can be undone. "this record only" fields FileMaker keeps current, so a difference there more likely means Tabularius works the formula out differently: check before refreshing.',
      }),
    },
  },

  refresh_stale_calcs: {
    permissions: '[Full Access] or the server administrator.',
    example: {
      arguments: { database: 'Invoices', fields: [{ table: 'Invoices', field: 'Total' }] },
      response: pretty({
        id: '2ae18f09ced7',
        at: '2026-10-13T09:30:00.078Z',
        summary: '1 stored value brought up to date in Invoices::Total',
        changes: 1,
        perField: [{ table: 'Invoices', field: 'Total', refreshed: 1, failing: 0, skipped: 0 }],
      }),
    },
  },

  undo_stale_refresh: {
    permissions: '[Full Access] or the server administrator, also to list the refreshes.',
    example: {
      arguments: { database: 'Invoices', id: '2ae18f09ced7' },
      response: pretty({ undone: 1, skipped: 0 }),
    },
    notes: 'Without id the result is {"history": [{"id", "at", "account", "summary", "changes"}, …]}.',
  },

  list_connections: {
    permissions: '[Full Access] or the server administrator; not a limited token. Never returns a secret, only whether each is set.',
    example: {
      arguments: { database: 'Invoices' },
      response: pretty({
        types: [{ id: 's3', label: 'S3-compatible storage', description: 'Amazon S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi or anything that speaks the S3 protocol', settings: [{ name: 'bucket', label: 'Bucket', required: true }], secrets: [{ name: 'accessKey', label: 'Access key ID', required: true }, { name: 'secretKey', label: 'Secret access key', required: true }] }],
        connections: [{
          name: 'invoices-bucket', type: 's3', status: 'active', settings: { bucket: 'acme-invoices', region: 'us-east-1', prefix: 'tabularius' }, files: ['Invoices'], draftedByAi: true,
          secrets: [{ name: 'accessKey', set: true }, { name: 'secretKey', set: true }, { name: 'sessionToken', set: false }], ready: true,
        }],
      }),
    },
    notes: 'status is draft (waiting for a person to add the keys and approve it in the admin console), active or disabled. Scripts use an active connection with Insert from URL and an address like connection://invoices-bucket/2026/scan.pdf.',
  },

  draft_connection: {
    permissions: '[Full Access] or the server administrator; not a limited token, and never for a capture-only file. Makes a draft only: it can\'t set a key, approve, turn on, change or remove a connection, and at most 10 AI drafts wait at once.',
    example: {
      arguments: { database: 'Invoices', name: 'invoices-bucket', type: 's3', config: { bucket: 'acme-invoices', region: 'us-east-1', prefix: 'tabularius' }, note: 'Scanned invoices' },
      response: pretty({
        drafted: true, name: 'invoices-bucket', type: 's3', status: 'draft', settings: { bucket: 'acme-invoices', region: 'us-east-1', prefix: 'tabularius' }, forFile: 'Invoices',
        next: 'Nothing is connected yet. A person has to open the admin console > Connections, check these settings, type the access key and secret key into the secret boxes (they never go through chat or this tool), press Test, and approve it.',
      }),
    },
    notes: 'The AI never sees, asks for or invents a key: a setting that looks like one (an AWS access key, a private key, a token) is refused, and keys can only be set by a person in the console. The draft is limited to the file it was made from until a person changes that.',
  },

  list_automations: {
    permissions: '[Full Access] or the server administrator.',
    example: {
      arguments: { database: 'Invoices' },
      response: pretty({
        automations: [{
          name: 'Paid date',
          enabled: true,
          layout: 'Invoices',
          on: 'update',
          fields: ['Status'],
          condition: 'Status = "Paid"',
          script: 'Mark Paid',
          account: 'Admin',
          id: '841a547c2332',
          created: '2026-10-13T09:40:13.859Z',
          updated: '2026-10-13T09:40:13.859Z',
          createdBy: 'Admin',
          trigger: 'When a record in Invoices is changed, and the change is to Status, if Status = "Paid": run "Mark Paid" on that record (from layout Invoices) as Admin',
          runs: [],
        }],
      }),
    },
  },

  try_automation: {
    permissions: '[Full Access] or the server administrator. Runs once on a throwaway copy of the file, offline; nothing changes in the file.',
    example: {
      arguments: {
        database: 'Invoices',
        name: 'Paid date',
        layout: 'Invoices',
        on: 'update',
        fields: ['Status'],
        condition: 'Status = "Paid"',
        scriptText: { name: 'Stamp paid', text: 'Set Field [ Invoices::Customer ; Upper ( Invoices::Customer ) ]' },
        test: { Status: 'Paid' },
      },
      response: pretty({
        trigger: 'When a record in Invoices is changed, and the change is to Status, if Status = "Paid": run "Stamp paid" on that record (from layout Invoices) as Admin',
        dryRun: {
          recordId: 1,
          setOff: ['Status: "Open" → "Paid" on record 1'],
          conditionTrue: true,
          outcome: 'ok',
          steps: 1,
          changes: ['Sets Invoices::Customer to "ACME CORP" on record 1'],
          outbound: [],
        },
      }),
    },
  },

  save_automation: {
    permissions: '[Full Access] or the server administrator. The automation runs as the account named, by default the one saving it.',
    example: {
      arguments: { database: 'Invoices', name: 'Paid date', layout: 'Invoices', on: 'update', fields: ['Status'], condition: 'Status = "Paid"', script: 'Mark Paid' },
      response: pretty({
        saved: true,
        automation: {
          name: 'Paid date',
          enabled: true,
          layout: 'Invoices',
          on: 'update',
          fields: ['Status'],
          condition: 'Status = "Paid"',
          script: 'Mark Paid',
          account: 'Admin',
          id: '841a547c2332',
          created: '2026-10-13T09:40:13.859Z',
          updated: '2026-10-13T09:40:13.859Z',
          createdBy: 'Admin',
        },
        trigger: 'When a record in Invoices is changed, and the change is to Status, if Status = "Paid": run "Mark Paid" on that record (from layout Invoices) as Admin',
      }),
    },
  },

  delete_automation: {
    permissions: '[Full Access] or the server administrator.',
    example: {
      arguments: { database: 'Invoices', automation: 'Paid date' },
      response: pretty({ deleted: 'Paid date' }),
    },
  },

  conversion_report: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices' },
      response: pretty({
        database: 'Invoices',
        summary: '# Conversion report: Invoices\n\nNothing found that won\'t work.\n\n## Good to know\n- **Never run**: Send Mail (1). Tabularius doesn\'t send email.\n- **Privilege sets imported**: [Full Access] (full access; fmapp, fmwebdirect, fmrest).\n- **Record access is imported at the whole-file level.** FileMaker\'s per-table, per-layout, per-value-list and per-script "Custom privileges" aren\'t decoded yet, so a set that used them is approximated by its overall access — review those sets in Manage Security.',
        functions: { notYet: [], undecoded: [], plugIns: [] },
        steps: {
          notYet: [],
          blocked: [{ name: 'Send Mail', count: 1, where: ['Script "Email Invoice", line 2'] }],
          network: [],
          screenOnly: [],
          clientOnly: [],
        },
        unparsed: [],
        broken: [],
        commentedOut: [],
        dataSources: [],
        accounts: { withoutPassword: [], blankPassword: [] },
        externalContainers: { files: 0, missing: 0, examples: [] },
        privileges: {
          assignments: [{ account: 'Admin', privilegeSet: '[Full Access]' }],
          withoutSet: [],
          sets: [{ name: '[Full Access]', records: 'full access', extended: ['fmapp', 'fmwebdirect', 'fmrest'] }],
          coarsened: true,
        },
      }),
    },
    notes: 'With item the result is Markdown about that one item, e.g. "# script Email Invoice\\nWhat won\'t work as it did in FileMaker:\\n- Send Mail (Never runs here: Tabularius doesn\'t send email): line 2".',
  },

  conversion_guide: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices' },
      response: [
        '# Invoices: what to know after converting',
        '',
        '## Won\'t work until changed',
        '- **MBS (MonkeyBread) plug-in** (1): 1 call in 1 script. No plug-ins run here, so each call gives an error.',
        '  Instead: Send Mail [ Send via SMTP Server ; … ] (Tabularius sends no mail unless the server is set up to).',
        '  Where: Script "Email Invoice", line 1',
        '',
        '## Works differently',
        '- **Send Mail** (1): Sends nothing: the step ends with error 3 and the script carries on. A server set up for test mode keeps each message in the admin console\'s outbox instead.',
        '  Instead: Keep the step as it is (Send via SMTP Server) for when the server is set up to send mail.',
        '  Where: Script "Email Invoice", line 2',
        '',
        '## Before people use it',
        '- Move off plug-ins one script at a time: ask the assistant ("replace the MBS (MonkeyBread) plug-in") or an MCP client (migration_plan); each rewritten script is tried offline on a copy first.',
      ].join('\n'),
    },
    notes: 'Markdown. Only what the design shows: items found by reading the records (such as the names of container files) are left out.',
  },

  optimization_report: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices' },
      response: [
        '# Invoices: ways to make it smaller and faster',
        '',
        'The converted file is 26.0 MB. 24.8 MB of that is 405 container files stored inside it, 151 pictures among them (6.7 MB).',
        '',
        '## High impact',
        '- **Container files inside the file: Assets::Photo** (saves up to 21.1 MB; 8): 8 files totalling 21.1 MB (81% of the converted file) are stored in the database itself, 5 pictures (6.1 MB) of them; the largest is 12.9 MB. Every backup, copy and replica carries them.',
        '  Instead: Move them to S3-compatible storage and keep only a link in the record (the database shrinks by this much and pictures are served from storage), or to managed external storage next to the file.',
        '  Where: Assets::Photo',
        '',
        '## Housekeeping',
        '- **Scripts nothing runs** (2): 2 scripts are performed by no script, button, trigger or custom menu. People may still run them from the Scripts menu, a schedule or the Data API.',
        '  Instead: Remove the ones nobody runs, or keep them in a folder named for what they are (utilities, old).',
        '  Where: Old import; Test',
      ].join('\n'),
    },
    notes: 'Changes nothing. Markdown, or the findings as JSON with json: true: each has an impact (high, medium, low), the bytes it would save, and any action with the admin API request that carries it out (an index is added with POST /tabularius/admin/v1/indexes); moving container files to S3 is described and marked unavailable until an S3 connection is set up.',
  },

  optimization_fix: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices', fix: 'remove-value-lists' },
      response: JSON.stringify({ fix: 'remove-value-lists', label: 'Remove 1 value list', will: ['Remove the value list "Colours".'], count: 1, undoable: true, note: 'Nothing was changed. Send confirm: true once a person has approved this.' }, null, 2),
    },
    notes: 'Makes one of the fixes optimization_report offers: hide-scripts, remove-scripts, remove-value-lists, remove-table-occurrences, or store-calculation (items: ["Table::Field"]). Without confirm: true it only lists what it would do. Each fix is one change; undo: true (or the number of an earlier fix) puts it back. Removing is a decision for a person: scripts and value lists may be used from outside the file.',
  },

  optimization_move_containers: {
    permissions: '[Full Access] only (it changes the file and writes files beside it); not available to scoped API tokens. The assistant does not get this tool.',
    example: {
      arguments: { database: 'Invoices', table: 'Assets', field: 'Photo', expect: 8 },
      response: pretty({
        plan: {
          table: 'Assets', field: 'Photo', files: 8, bytes: 22_100_000, folder: 'RC_Data_FMS/Invoices/Assets/Photo/', setsStorage: true,
          preview: ['Move 8 files (21 MB) of Assets::Photo out of the database into the folder RC_Data_FMS/Invoices/Assets/Photo/ beside the hosted file.', '…'],
        },
        message: 'Nothing was changed. Call again with confirm: true to make this move.',
      }),
    },
    notes: 'Without confirm: true it only describes the move. With it, the files move out (all or nothing), the field is set to store its files outside the file if it wasn\'t, and the file is rewritten so it shrinks; the result has the move (move.id). Pass undo with that number (and confirm: true) to put the files back; call with no table and field to list the moves that can be undone. Files the folder has lost since are left as they are and counted in missing.',
  },

  migration_plan: {
    permissions: '[Full Access], or a set that can modify scripts and read everything (designAccess); not available to scoped API tokens.',
    example: {
      arguments: { database: 'Invoices' },
      response: pretty({
        database: 'Invoices',
        summary: 'Plug-in calls: MBS (MonkeyBread) (1), in 1 script and 0 formulas. Rewrite one script at a time: each rewritten script is dry-run offline on a copy of the file before anyone applies it.',
        plugIns: [{
          plugIn: 'MBS (MonkeyBread)',
          calls: [{
            call: 'MBS ( "SMTP.Send" )',
            count: 1,
            worksHere: false,
            native: 'Send Mail [ Send via SMTP Server ; … ] (Tabularius sends no mail unless the server is set up to).',
            where: ['Script "Email Invoice", line 1'],
          }],
        }],
        scripts: [{ script: 'Email Invoice', calls: 1, plugIns: ['MBS (MonkeyBread)'] }],
        formulas: [],
      }),
    },
  },

  compare_solutions: {
    permissions: 'Design access (designAccess) in both files: [Full Access], or a set that can modify scripts and read everything; not available to scoped API tokens. Accounts and privilege sets are compared only with [Full Access] (or as the administrator) in both.',
    example: {
      arguments: { from: 'Invoices', to: 'Invoices Staging' },
      response: pretty({
        from: 'Invoices',
        to: 'Invoices Staging',
        matchedBy: 'id',
        summary: 'fields: 1 added; layouts: 1 changed.',
        fields: { added: ['Invoices::Notes'] },
        layouts: { changed: [{ name: 'Invoices', details: ['fields added: Invoices::Notes'] }] },
      }),
    },
  },
};
