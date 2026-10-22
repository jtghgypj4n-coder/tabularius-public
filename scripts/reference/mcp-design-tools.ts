// Hand-checked notes for the design-mode MCP tools (packages/server/src/mcp-design.ts, registerDesignTools).
// Every tool there runs through its `guard`, which mcp.ts passes as: the caller's privilege set in the file must be
// [Full Access] (the server administrator has no set and passes). A scoped API token's set is narrowed and renamed
// "<set> (token)", so it is never [Full Access] and every tool here is refused to it. create_database names no file
// and is for the server administrator only.

import type { McpToolNotes } from './types.ts';

const FULL = '[Full Access] in the file, or the server administrator; any other privilege set (even one that can modify scripts) is refused, and so is a scoped API token.';

export const tools: Record<string, McpToolNotes> = {
  get_design: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', sections: ['layouts', 'scripts'] },
      response: JSON.stringify({
        database: 'Invoices',
        layouts: [
          { id: 1, name: 'Customers', tableOccurrenceId: 129, occurrence: 'Customers' },
          { id: 2, name: 'Invoices', tableOccurrenceId: 130, occurrence: 'Invoices' },
        ],
        scripts: [
          { id: 1, name: 'Mark paid', text: 'Set Field [ Invoices::Status ; "Paid" ]\nCommit Records/Requests [ With dialog: Off ]' },
        ],
      }, null, 2),
    },
    notes: 'Without sections the whole design comes back when it is 25,000 characters or less; above that the result is ' +
      '{database, note, sections: {section: size in characters}} so the client can ask for sections. Scripts named in `scripts` ' +
      'also carry their steps with decoded options. Secrets in script text and custom function formulas are redacted.',
  },

  get_theme: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', theme: 'House' },
      response: JSON.stringify({
        id: 1,
        name: 'House',
        defaults: {},
        styles: [{ name: 'Big', element: 70, rules: [{ part: 1, state: 1, css: { 'font-size': '18pt' } }] }],
      }, null, 2),
    },
  },

  get_layout_design: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', layout: 'Customers', compact: true },
      response: JSON.stringify({
        id: 1,
        name: 'Customers',
        tableOccurrenceId: 129,
        width: 560,
        style: {},
        parts: [
          { kind: 'header', kindId: 1, top: 0, height: 60, style: {} },
          { kind: 'body', kindId: 4, top: 60, height: 120, style: {} },
          { kind: 'footer', kindId: 7, top: 180, height: 40, style: {} },
        ],
        objects: [
          { id: 1, kind: 'text', type: 2, bounds: { top: 18, left: 20, bottom: 42, right: 520 }, text: 'Customers' },
          { id: 2, kind: 'text', type: 2, bounds: { top: 82, left: 20, bottom: 102, right: 150 }, text: 'Name' },
          {
            id: 3, kind: 'field', type: 1, bounds: { top: 80, left: 160, bottom: 102, right: 520 },
            field: { tableOccurrenceId: 129, fieldId: 1, tableOccurrence: 'Customers', field: 'Name', display: 'edit', repetitions: 1 },
          },
        ],
        generated: true,
        tableView: [{ field: { tableOccurrenceId: 129, fieldId: 1, tableOccurrence: 'Customers', field: 'Name' }, width: 120 }],
      }, null, 2),
    },
    notes: 'compact: true leaves out each object\'s style and anchors; without it the design is returned as stored, ready to edit and send back with change_design updateLayout.',
  },

  lint_script: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices' },
      response: JSON.stringify({
        scripts: [{
          script: 'Loop invoices',
          issues: [{
            rule: 'loop-no-exit',
            severity: 'error',
            step: 3,
            line: 4,
            message: 'Go to Record/Request/Page [ Next ] stays on the last record when there is no other one, and nothing else ends this loop, so it never stops.',
            fix: 'Turn on “Exit after last”: Go to Record/Request/Page [ Next ; Exit after last: On ]',
            detail: 'FileMaker gives error 101 on the last record and stays there; without “Exit after last” the loop goes on with that record forever.',
          }],
        }],
      }, null, 2),
    },
    notes: 'Without script, only scripts with issues are listed; with script, that script is listed even when it has none.',
  },

  check_solution: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices' },
      response: JSON.stringify({
        database: 'Invoices',
        counts: { error: 1, warning: 0, info: 1 },
        findings: [
          {
            kind: 'missing-script',
            severity: 'error',
            where: 'Script "New invoice", line 3',
            message: 'There is no script named "helper" (did you mean "Helper"?).',
            hint: 'Point the step at a script that exists, or add the script.',
          },
          {
            kind: 'unused-value-list',
            severity: 'info',
            where: 'Value list "Cities"',
            message: 'No field or layout object uses it.',
            hint: 'Delete it if it is not needed.',
          },
        ],
      }, null, 2),
    },
    notes: 'Nothing runs and nothing changes. Errors come first. With account, findings also say what that account cannot reach. The same check as `tabularius check-solution` (see docs/check-solution.md).',
  },

  lint_layout: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices' },
      response: JSON.stringify({
        layout: 'Invoices',
        issues: [
          {
            rule: 'overlap', severity: 'warning', objectIds: [10, 7],
            message: 'Invoices::Status covers Invoices::CustomerId: people may click the wrong one. Move one of them.', fixable: true,
          },
          {
            rule: 'no-action', severity: 'warning', objectIds: [11],
            message: '"Pay" does nothing when clicked: give it a script or a step in Button Setup.',
          },
        ],
      }, null, 2),
    },
    notes: 'Rule "slow" is what makes the layout slow to draw (unstored related totals, summaries on every row, portal filters); its issues carry cost, the estimated record reads per draw from the file\'s record counts. speed_up_layout redesigns those where there is a mechanical way.',
  },

  fix_layout: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices' },
      response: JSON.stringify({
        layout: 'Invoices',
        fixed: [
          'Invoices::Status covers Invoices::CustomerId: people may click the wrong one. Move one of them.',
          '"Wide" runs past the layout\'s right edge, so part of it is cut off.',
        ],
        saved: true,
        remaining: [],
      }, null, 2),
    },
    notes: 'Saved changes are recorded in the design history under the account "AI". remaining is what lint_layout still finds on the result. Besides the other fixes, a summary field on every row of a list moves into a trailing grand summary.',
  },

  speed_up_layout: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', layout: 'Customers' },
      response: JSON.stringify({
        layout: 'Customers',
        before: 2000,
        moves: [{
          index: 0,
          kind: 'unstored calculation',
          objectIds: [901],
          title: 'Show Customers::Billed from a new stored calculation, Customers::Billed stored',
          caveat: 'Billed stored is worked out when its own record changes, not when the related records change, so it can fall behind them; Stale stored values in the admin console brings it up to date.',
          after: 1000,
        }],
        left: [{
          kind: 'portal filter',
          objectIds: [902],
          message: 'The portal\'s filter is worked out for every related Invoices record (about 100), on every row (about 1,000 record reads each time the layout draws). Match the records in the relationship instead (another match field, or a global key), so the index does the filtering.',
          cost: 1000,
        }],
        saved: false,
      }, null, 2),
    },
    notes: 'before and each move\'s after are the layout\'s estimated record reads per draw. Without apply nothing is saved. With apply: [indexes into moves] each chosen move is worked out again on the layout as the earlier ones left it and saved (recorded in the design history under the account "AI"), ' +
      'and the result also has saved, applied (the indexes saved), skipped (moves an earlier one made unnecessary), error (a move that could not be saved, which stops the rest; those already saved stay), after (the reads per draw now) and undo (the changes that take the saved moves back, last first, left out when one of them can\'t be undone). ' +
      'An index outside moves is an error and nothing is saved.',
  },

  review_graph: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices' },
      response: JSON.stringify({
        summary: [
          'The graph has 2 table occurrences of 2 tables, joined by 1 relationship into 1 group.',
          'Customers (1 layout) reaches Invoices; Invoices also has layouts.',
          'Nothing looks wrong.',
        ],
        groups: [{ anchor: 129, occurrences: [129, 130], anchorBuoy: false }],
        issues: [],
        boxesToTidy: 2,
      }, null, 2),
    },
  },

  arrange_graph: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices' },
      response: JSON.stringify({ moved: 2, saved: true }, null, 2),
    },
    notes: 'Saved changes are recorded in the design history under the account "AI".',
  },

  restyle_layout: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', theme: 'House' },
      response: JSON.stringify({ layout: 'Invoices', notes: ['Theme: none → House.'], check: [], saved: false }, null, 2),
    },
    notes: 'preview defaults to true. With preview: false the result also has undo: updateLayout changes that put the layouts back as they were.',
  },

  restyle_file: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', tokens: { accent: '#224488' }, name: 'Blue' },
      response: JSON.stringify({
        theme: 'Blue',
        layouts: [
          { name: 'Customers', notes: ['Theme: none → Blue.'], check: { before: 0, after: 0 } },
          { name: 'Invoices', notes: ['Theme: none → Blue.'], check: { before: 0, after: 0 } },
        ],
        unchanged: [],
        saved: false,
      }, null, 2),
    },
    notes: 'preview defaults to true. With preview: false the result also has undo.',
  },

  modernize_interfaces: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', tables: ['Invoices'], styles: ['modern-list', 'classic-form'] },
      response: JSON.stringify({
        layouts: [
          { name: 'Invoices - Modern list', table: 'Invoices', style: 'modern-list', notes: ['Columns: Number, Status, Due, Amount.'] },
          { name: 'Invoices - Classic form', table: 'Invoices', style: 'classic-form', notes: ['Theme House, the one 1 layout in the file uses.'] },
        ],
        skipped: [{ table: 'InvoiceTags', why: 'only keys and stamps, which looks like a join table' }],
        saved: false,
      }, null, 2),
    },
    notes: 'preview defaults to true. With preview: false the layouts are made in a "Modernized interfaces" folder and the result also has undo. Nothing the file already has is changed.',
  },

  draft_layout: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', name: 'Invoice list draft', occurrence: 'Invoices', fields: ['Number', 'Total'], preview: false },
      response: JSON.stringify({
        layout: 'Invoice list draft',
        notes: [
          'Theme House, the one 1 layout in the file uses.',
          'Fields, labels, title and parts styled as they most often are on the file\'s 1 layout with that theme.',
        ],
        check: [],
        saved: true,
        undo: [{ op: 'deleteLayout', layout: 3 }],
      }, null, 2),
    },
    notes: 'preview defaults to true; a preview returns the changes (createLayout with its full design, and any script or fields it adds) instead of undo, with saved: false. ' +
      'For a report, groups (sub-summaries; a date by month, quarter or year), summaryOnly and chart (one point per group) are also taken, and the script sorts by the groups. arrangement copies a picture of a layout: where each thing is, in points from its part\'s top left, using the file\'s real fields; it replaces fields, totals and portals.',
  },

  change_design: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', changes: [{ op: 'createField', table: 'Invoices', name: 'DueDate', type: 'date' }] },
      response: JSON.stringify({
        applied: [{ op: 'createField', table: 130, name: 'DueDate', type: 'date', id: 5 }],
        undo: [{ op: 'deleteField', table: 130, field: 5 }],
      }, null, 2),
    },
    notes: 'With preview: true nothing changes and the result is {lines, layouts?: [{name, issues}]}. Applied changes are recorded in the design history under the account "AI".',
  },

  check_formula: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', formula: 'Totl * 1.2', table: 'Invoices' },
      response: JSON.stringify({ ok: false, code: 102, message: 'The field "Totl" cannot be found', at: 0 }, null, 2),
    },
    notes: 'A formula that checks out returns {"ok": true}.',
  },

  design_history: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', limit: 1 },
      response: JSON.stringify([
        { seq: 5, at: '2026-10-13T00:07:21.417Z', account: 'AI', op: { op: 'createTheme', name: 'House' } },
      ], null, 2),
    },
  },

  audit_log: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', table: 'Invoices', recordId: 12 },
      response: JSON.stringify([
        { seq: 9, at: '2026-10-13T00:09:01.953Z', account: 'Admin', kind: 'create', table: 'Invoices', recordId: 12, changes: { Number: 'A-12', Total: 250 } },
        { seq: 10, at: '2026-10-13T00:09:01.969Z', account: 'Admin', kind: 'update', table: 'Invoices', recordId: 12, changes: { Total: [250, 275] } },
      ], null, 2),
    },
    notes: 'Values of fields named like secrets are shown as "‹hidden from AI tools›".',
  },

  explain_record_history: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', layout: 'Invoices', recordId: 12 },
      response: JSON.stringify({
        table: 'Invoices',
        recordId: 12,
        events: [
          { at: '2026-10-13T00:09:01.969Z', account: 'Admin', kind: 'changed', changes: [{ field: 'Total', from: 250, to: 275 }] },
          { at: '2026-10-13T00:09:01.953Z', account: 'Admin', kind: 'created', changes: [{ field: 'Number', to: 'A-12' }, { field: 'Total', to: 250 }] },
        ],
        note: 'Newest first. "how" says what the file\'s design shows about a change (auto-enter calculations, stamps, lookups); "by" names an automation or data cleanup that ran at that moment. A change with neither was typed, imported or set by a script or API call. The audit log reaches back only as far as it is kept.',
      }, null, 2),
    },
    notes: 'Name the table, or a layout on it.',
  },

  suggest_indexes: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices' },
      response: JSON.stringify({
        finds: [{
          file: 'Invoices',
          table: 'Invoices',
          layout: 'Invoices',
          fields: ['Status'],
          sort: ['Number'],
          count: 14,
          averageMs: 90,
          maxMs: 210,
          totalMs: 1260,
          records: 24,
          summary: 'Finds in Invoices by Status, sorted by Number took 90 ms on average (longest 210 ms) over 14 finds, on 24 records.',
          suggestions: [
            { kind: 'index', table: 'Invoices', field: 'Status', why: 'An index on Invoices::Status lets finds on it skip reading all 24 records (it helps exact matches (==), ranges and "begins with"; word finds already use the word index).' },
            { kind: 'index', table: 'Invoices', field: 'Number', why: 'An index on Invoices::Number lets sorts on it skip reading all 24 records.' },
          ],
        }],
        note: 'Slowest in total first.',
      }, null, 2),
    },
    notes: 'Read-only: nothing is indexed. With no slow finds the result is {"finds": [], "note": "No slow finds since the server started."}.',
  },

  get_security: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices' },
      response: JSON.stringify({
        database: 'Invoices',
        accounts: [
          { name: 'Admin', hasPassword: true, privilegeSet: '[Full Access]', hasTotp: false, blankPassword: false, unmigrated: false },
          { name: 'Clerk', hasPassword: true, privilegeSet: 'Clerks', hasTotp: false, blankPassword: false, unmigrated: false },
        ],
        privilegeSets: [
          {
            name: '[Full Access]', id: 1, records: { view: true, edit: true, create: true, delete: true },
            layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmapp', 'fmwebdirect', 'fmrest'],
          },
          {
            name: 'Clerks', records: { view: true, edit: true, create: true, delete: false },
            layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
          },
        ],
        passwordPolicy: {},
        minPasswordLength: 12,
        apiTokens: [],
      }, null, 2),
    },
    notes: 'API tokens are listed without their ids or secrets.',
  },

  review_privileges: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices' },
      response: JSON.stringify({
        database: 'Invoices',
        findings: [
          {
            severity: 'medium', kind: 'full-access-no-2fa', account: 'Admin', privilegeSet: '[Full Access]',
            title: '"Admin" has full access with only a password.',
            detail: 'A guessed or leaked password is enough to take over the file. Set up two-factor sign-in for it in Manage Security, or turn on "require two-factor" for full-access accounts.',
          },
          {
            severity: 'medium', kind: 'unused-extended', privilegeSet: 'Clerks',
            title: '"Clerks" opens FileMaker-style app sign-in, but none of its 1 account (Clerk) has signed in for 90 days.',
            detail: 'Each surface switched on is a way in. Turn these extended privileges off in Manage Security until someone needs them.',
          },
        ],
        counts: { high: 0, medium: 2, low: 0 },
        unusedDays: 90,
        health: {
          fullAccessAccounts: ['Admin'],
          without2fa: ['Admin', 'Clerk'],
          dormant: ['Admin', 'Clerk'],
          broadTokens: [],
          oversharingSets: [],
          orphanedAccessKeys: [],
        },
      }, null, 2),
    },
  },

  check_change_impact: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', kind: 'field', name: 'Invoices::Status', change: 'rename' },
      response: JSON.stringify({
        target: { kind: 'field', name: 'Invoices::Status' },
        change: 'rename',
        uses: [
          { where: 'Script "Mark paid", line 1', text: 'Set Field [ Invoices::Status ; "Paid" ]', breaks: false, why: 'It refers to it by id and follows the rename.' },
          { where: 'Layout "Invoices"', text: 'field Invoices::Status', breaks: false, why: 'It refers to it by id and follows the rename.' },
        ],
        useCount: 2,
        privileges: [],
        clients: [],
        crossFile: [],
        logDays: 30,
        logRead: true,
        summary: [
          '2 other uses in the file follow the rename.',
          'OData and ODBC clients are not logged, so they were not checked.',
        ],
      }, null, 2),
    },
    notes: 'Other hosted files are checked too; one with AI turned off (or that uses such a file) is only counted, never named.',
  },

  suggest_rules: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', table: 'Invoices' },
      response: JSON.stringify({
        suggestions: [{
          table: 'Invoices',
          field: 'Number',
          kind: 'unique',
          title: 'Invoices::Number is different on every record: require a value, and unique values.',
          evidence: '24 different values in all 24 records.',
          changes: [{ op: 'updateField', table: 'Invoices', field: 'Number', options: { validation: { unique: true, notEmpty: true } } }],
        }],
        alsoAlwaysFilled: [{ table: 'Invoices', fields: ['Total', 'CustomerId', 'Status'] }],
        tablesChecked: ['Invoices'],
      }, null, 2),
    },
    notes: 'Read-only. A table needs at least 20 records before anything is suggested for it.',
  },

  edit_layout_objects: {
    permissions: FULL,
    example: {
      arguments: {
        database: 'Invoices', layout: 'Invoices',
        set: [{ object: 1, changes: { text: 'Invoice' } }],
        triggers: [{ event: 'OnRecordLoad', script: 'Mark paid' }],
      },
      response: JSON.stringify({ layout: 'Invoices', objects: 9, triggers: [{ event: 'OnRecordLoad', scriptId: 1, script: 'Mark paid' }] }, null, 2),
    },
    notes: 'objects is the number of top-level objects on the layout afterwards. The change is recorded in the design history under the account "AI".',
  },

  try_design_change: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', changes: [{ op: 'updateScript', script: 'Mark paid', text: 'Set Field [ Invoices::Status ; "Paid" ]' }] },
      response: JSON.stringify({
        applies: true,
        runs: [{ script: 'Mark paid', run: { outcome: 'ok', error: 0, steps: 1, layout: 'Invoices' } }],
      }, null, 2),
    },
    notes: 'Changes that would not apply are refused with the error before anything runs. The real file is not changed.',
  },

  paste_from_filemaker: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', table: 'Invoices', xml: '<fmxmlsnippet type="FMObjectList"><Field id="7" dataType="Text" fieldType="Normal" name="Notes"/></fmxmlsnippet>' },
      response: JSON.stringify({
        changes: [{ op: 'createField', table: 130, name: 'Notes', type: 'text', kind: 'normal' }],
        summary: ['1 field'],
        notes: [],
      }, null, 2),
    },
    notes: 'Nothing is applied: design changes go to change_design. A snippet of layout objects returns objects for edit_layout_objects add instead.',
  },

  copy_for_filemaker: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', scripts: [1] },
      response: JSON.stringify({
        xml: '<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="FMObjectList"><Script includeInMenu="True" runFullAccess="False" id="1" name="Mark paid"><Step enable="True" id="76" name="Set Field"><Calculation><![CDATA["Paid"]]></Calculation><Field table="Invoices" id="4" name="Status"/></Step><Step enable="True" id="75" name="Commit Records/Requests"><NoInteract state="True"/></Step></Script></fmxmlsnippet>',
        notes: [],
      }, null, 2),
    },
    notes: 'objects needs layout, the layout the objects are on.',
  },

  list_images: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices' },
      response: JSON.stringify([{ id: 1, filename: 'dot.svg', mime: 'image/svg+xml', bytes: 41 }], null, 2),
    },
  },

  add_image: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', filename: 'dot.svg', mime: 'image/svg+xml', data: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=' },
      response: JSON.stringify({ id: 1 }, null, 2),
    },
    notes: 'Images are limited to 20 MB.',
  },

  change_security: {
    permissions: FULL,
    example: {
      arguments: { database: 'Invoices', changes: [{ op: 'setAccount', name: 'Clerk', privilegeSet: 'Viewers' }] },
      response: JSON.stringify({
        database: 'Invoices',
        accounts: [
          { name: 'Admin', hasPassword: true, privilegeSet: '[Full Access]', hasTotp: false, blankPassword: false, unmigrated: false },
          { name: 'Clerk', hasPassword: true, privilegeSet: 'Viewers', hasTotp: false, blankPassword: false, unmigrated: false },
        ],
        privilegeSets: [
          {
            name: '[Full Access]', id: 1, records: { view: true, edit: true, create: true, delete: true },
            layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmapp', 'fmwebdirect', 'fmrest'],
          },
          {
            name: 'Viewers', records: { view: true, edit: false, create: false, delete: false },
            layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
          },
        ],
        passwordPolicy: {},
        minPasswordLength: 12,
        apiTokens: [],
      }, null, 2),
    },
    notes: 'A privilege set\'s table entry can mark a field masked (fields: {Field: "masked"}, with masks: {Field: {kind: "last4" | "placeholder", text?}}); a mask is accepted only for a masked field. Also takes createExtendedPrivilege, updateExtendedPrivilege and deleteExtendedPrivilege (a custom "way in" a privilege set can grant); those are applied first, as design changes recorded under the account "AI". Any change carrying a password, and revokeApiToken, is refused. Since no password can be given, setAccount only changes an ' +
      'existing account: a new name fails with \'No account "…" (give it a password to create it)\'.',
  },

  create_database: {
    permissions: 'The server administrator only (the --mcp-token bearer, the server\'s MCP token, or stdio); every account and API token is refused.',
    example: {
      arguments: { name: 'ReferenceScratch' },
      response: JSON.stringify({ database: 'ReferenceScratch' }, null, 2),
    },
    notes: 'The new file starts with no accounts: give its first account a password with `tabularius passwd` before people sign in.',
  },
};
