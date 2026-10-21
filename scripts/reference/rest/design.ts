import type { RestGroup, RestParam } from '../types.ts';

// Design mode (design.ts), the script debugger (debug.ts) and Manage Security (security.ts) over HTTP.
// All three sign in with the Data API's tokens and need [Full Access] on the file.

const j = (x: unknown) => JSON.stringify(x, null, 2);

const SIGN_IN = 'A session token for this file (Authorization: Bearer …, or X-FM-Data-Access-Token), from a Data API sign-in (which needs fmrest) or the web client\'s ' +
  '(fmapp or fmwebdirect), or a scoped API token (ohbt_…) for this file; a token scoped to surfaces must include fmrest, and one for a local-only account works only from the server itself';
const FULL = (what: string) => `${SIGN_IN}. The account must have the [Full Access] privilege set; any other set gets 403, code 9 ("Account "…" doesn't have full access, which ${what} need${what.endsWith('debugger') ? 's' : ''}").`;
const DESIGN_PERM = FULL('design changes');
const DEBUG_PERM = FULL('the script debugger');
const SECURITY_PERM = FULL('security changes');

const DB: RestParam = { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name (URL-encoded).' };
const AUTH = 'Authorization: Bearer 3f1d0c6e8a…';
const ERR = (code: number, message: string) => j({ error: { code, message } });

const D = '/tabularius/design/v1/databases/{database}';
const DX = '/tabularius/design/v1/databases/Invoices';
const G = '/tabularius/debug/v1/databases/{database}';
const GX = '/tabularius/debug/v1/databases/Invoices';
const S = '/tabularius/security/v1/databases/{database}';
const SX = '/tabularius/security/v1/databases/Invoices';

// --- shapes, as the server returned them for a small file ------------------------------------------

const field = (id: number, name: string, type: string) => ({
  id, name, kind: 'normal', type, hasCalculation: false, options: { global: false, unstored: false, repetitions: 1 },
});
const SCRIPT_STEPS = [
  { stepId: 76, name: 'Set Field', enabled: true, params: { field: { tableOccurrence: { id: 129, name: 'Items' }, field: { id: 3, name: 'Status' } }, calculation: '"done"' }, calculations: ['"done"'], line: 'Set Field [ Items::Status ; "done" ]' },
  { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: '"ok"' }, calculations: ['"ok"'], line: 'Exit Script [ Result: "ok" ]' },
];
const SCRIPT_TEXT = 'Set Field [ Items::Status ; "done" ]\nExit Script [ Result: "ok" ]';
const design = (fields = [field(1, 'Name', 'text'), field(2, 'Price', 'number'), field(3, 'Status', 'text')]) => ({
  database: 'Invoices',
  tables: [{ id: 129, name: 'Items', fields, records: 3 }],
  tableOccurrences: [{ id: 129, name: 'Items', baseTableId: 129, table: 'Items' }],
  relationships: [],
  dataSources: [],
  containerDirectories: [{ id: 0, path: 'Files/Invoices/', fields: [] }],
  containerData: { files: 0, bytes: 0 },
  fileOptions: {},
  valueLists: [],
  customFunctions: [],
  deleted: [],
  customMenus: [],
  customMenuSets: [],
  defaultMenuSetId: null,
  menuCommands: [{ id: 57664, name: 'About FileMaker Pro' }, { id: 49155, name: 'Browse Mode' }],
  layouts: [{ id: 1, name: 'Items', tableOccurrenceId: 129, occurrence: 'Items' }],
  layoutOrder: [],
  scripts: [{ id: 1, name: 'Finish', steps: SCRIPT_STEPS, text: SCRIPT_TEXT }],
  scriptOrder: [],
  components: [],
  themes: [],
  privilegeSets: ['[Full Access]'],
  scriptSteps: ['# (comment)', 'Add Account', 'Adjust Window'],
});
const SHORT = 'menuCommands and scriptSteps are shortened here; the server sends every menu command it knows by name and every script step name.';

const ANCHORS = { left: true, top: true, right: false, bottom: false };
const LAYOUT = {
  id: 1, name: 'Items', tableOccurrenceId: 129, width: 560, style: {},
  parts: [
    { kind: 'header', kindId: 1, top: 0, height: 60, style: {} },
    { kind: 'body', kindId: 4, top: 60, height: 150, style: {} },
    { kind: 'footer', kindId: 7, top: 210, height: 40, style: {} },
  ],
  objects: [
    { id: 2, kind: 'text', type: 2, bounds: { top: 82, left: 20, bottom: 102, right: 150 }, anchors: ANCHORS, style: { element: 70, rules: [{ part: 1, state: 1, css: { 'font-size': '18px', 'font-weight': '600', color: '#1d1d1f' } }] }, text: 'Name' },
    { id: 3, kind: 'field', type: 1, bounds: { top: 80, left: 160, bottom: 102, right: 520 }, anchors: ANCHORS, style: { element: 61, rules: [{ part: 1, state: 1, css: { 'background-color': '#ffffff', border: '1px solid #b9bec7' } }] }, field: { tableOccurrenceId: 129, fieldId: 1, tableOccurrence: 'Items', field: 'Name', display: 'edit', repetitions: 1 } },
  ],
  tableView: [{ field: { tableOccurrenceId: 129, fieldId: 1, tableOccurrence: 'Items', field: 'Name' }, width: 120 }],
};
const OVERLAP = { rule: 'overlap', severity: 'warning', objectIds: [902, 901], message: 'button covers button: people may click the wrong one. Move one of them.', fixable: true };
const UNLABELED = { rule: 'unlabeled', severity: 'info', objectIds: [901], message: 'A button has no text, name or tooltip, so screen readers announce it as just "button". Give it a tooltip (Inspector) or a name.' };

const ENDED = { result: 'ok', error: 0, foundCount: 3, layout: 'Items' };
const TEST = { script: 1, name: 'finishes', given: {}, expect: { result: 'ok', error: 0 }, id: '87293af5-04f2-42c5-bb8c-cc9e04980fa2' };

const PAUSED = {
  script: 'Finish', index: 0, steps: 2, line: 'Set Field [ Items::Status ; "done" ]', stack: [{ script: 'Finish', index: 0 }],
  lastError: 0, layout: 'Items', foundCount: 3, recordId: 1, mode: 'browse', variables: { locals: {}, globals: {} },
};
const RUN = { id: '2adfd56e269493d4', script: 'Finish', scratch: true, breakpoints: [] as { script: string; index: number }[], pauseOnError: false };
const DONE = { result: 'ok', error: 0, halted: false, layout: 'Items', foundCount: 3, recordId: 1, foundSet: [1, 2, 3], mode: 'browse', steps: 1, actions: [] };

const SECURITY = {
  database: 'Invoices',
  accounts: [
    { name: 'Admin', hasPassword: true, privilegeSet: '[Full Access]', hasTotp: false, blankPassword: false, unmigrated: false },
    { name: 'rep', hasPassword: true, privilegeSet: 'Sales', hasTotp: false, blankPassword: false, unmigrated: false },
  ],
  privilegeSets: [
    { name: '[Full Access]', id: 1, records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmapp', 'fmwebdirect', 'fmrest'] },
    { name: 'Sales', records: { view: true, edit: true, create: true, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] },
  ],
  apiTokens: [] as unknown[],
  pendingChanges: [],
  passwordPolicy: {},
  requireTotpForFullAccess: false,
  fullAccessWithout2fa: ['Admin'],
  tables: [{ name: 'Items', fields: ['Name', 'Price', 'Status'] }],
  layouts: ['Items'],
  valueLists: [],
  scripts: ['Finish'],
  extendedPrivileges: ['fmapp', 'fmwebdirect', 'fmrest', 'fmxml', 'fmmcp'],
};
const TOKEN_ROW = { id: 'c8c2acd14cd4', account: 'rep', readOnly: true, created: '2026-10-13T00:09:08.706Z', label: 'Reporting', expires: '2026-11-12T00:09:08.705Z' };

const ERRORS = 'Errors come back as {"error": {"code", "message"}} with an HTTP status: a missing, expired or other file\'s token is 401 with code 952 ' +
  '(a session token sent for another file also ends that session), an account without [Full Access] is 403 with code 9, a file that is no longer open is 404 with code 802, ' +
  'a method a path does not answer is 405 with code 3 ("Command is unavailable"), a body that isn\'t JSON is 400 with code 960, and an error from the file itself ' +
  '(a bad change, a missing name) is 400 with its FileMaker error code.';

export const groups: RestGroup[] = [
  {
    id: 'design',
    title: 'Design mode',
    sources: ['design.ts'],
    intro: 'Reads a file\'s whole design and changes it, at /tabularius/design/v1/databases/{database}: tables, fields, occurrences, relationships, value lists, ' +
      'custom functions, layouts, scripts and themes, plus the tools design mode uses (formula checks, layout Check and Fix, restyling, clipboard XML, ' +
      'where-used, the Database Design Report, the layout speed-up check and the component library shared by every file on the server). It signs in with the Data API\'s session tokens and needs [Full Access] on the file, as FileMaker\'s Manage Database does. ' +
      'Replies are plain JSON (no Data API envelope), sent with Cache-Control: no-store. ' + ERRORS,
    anchors: [String.raw`/^\/tabularius\/design\/v1\/databases\/([^/]+)(?:\/(history|audit|report|ddr|docs|check|preview|restyle|modernize|import-tables|impact|pending(?:\/(?:apply|discard))?|suggest-rules|evaluate|snippet(?:\/copy)?|used|graph|scripts\/lint|scripts\/dry-run|layouts\/(\d+)|deleted(?:\/(\d+))?|themes\/(\d+)|images|layouts\/(\d+)\/(lint|fix|history|phone|speed)|script-tests(?:\/(run|record|[\w-]{1,64}))?|scripts\/(\d+)\/(history|profile|dry-run|refactor|compare|dependencies)|library(?:\/([0-9a-f]{12}))?))?$/.exec(`],
    routes: [
      {
        method: 'GET',
        path: D,
        summary: 'The file\'s whole design: tables with fields and record counts, occurrences, relationships, data sources, value lists, custom functions, menus, layouts, scripts and themes.',
        permissions: DESIGN_PERM,
        params: [DB],
        example: { request: `GET ${DX}\n${AUTH}`, status: 200, response: j(design()) },
        notes: `${SHORT} A data source whose file reference finds another hosted file names it in hosted, and lists that file's tables when this account has [Full Access] there too. ` +
          'Layouts made for phones carry phone: {of, following}. Each theme also carries tokens (accent, accentText, text, muted, background, panel, line, and the font, text size and corner radius the theme sets, read from its button, field, label and layout defaults) and unmapped, the tokens the theme does not set, for which Tabularius\'s own is used.',
      },
      {
        method: 'POST',
        path: D,
        summary: 'Applies a list of design changes, all or none, and returns them as applied with the new design; with ?preview=1 it describes them instead and saves nothing.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'preview', in: 'query', type: 'string', description: '1: describe the changes (lines, and each layout they touch before and after with its Check issues) without applying them.' },
          { name: 'changes', in: 'body', type: 'array of object', required: true, description: 'Design changes, each {"op": …}: createTable, createField, updateLayout, createScript, deleteField, restoreDeleted and the rest of the store\'s DesignOp list.' },
        ],
        example: {
          request: `POST ${DX}\n${AUTH}\nContent-Type: application/json\n\n${j({ changes: [{ op: 'createField', table: 'Items', name: 'Qty', type: 'number' }] })}`,
          status: 200,
          response: j({
            applied: [{ op: 'createField', table: 129, name: 'Qty', type: 'number', id: 4 }],
            undo: [{ op: 'deleteField', table: 129, field: 4 }],
            design: design([field(1, 'Name', 'text'), field(2, 'Price', 'number'), field(3, 'Status', 'text'), field(4, 'Qty', 'number')]),
          }),
        },
        notes: 'Without a changes list: 400, code 960. A change that fails rolls the whole list back and is 400 with its code (106 for a table that isn\'t there). ' +
          'undo is included when the changes can be undone (the changes that reverse them). The changes are logged under the signed-in account (see /history). ' +
          `With ?preview=1 the reply is {"lines": [...], "layouts": [{"id", "name", "design", "before", "issues"}]}. ${SHORT}`,
      },
      {
        method: 'GET',
        path: `${D}/history`,
        summary: 'The latest 200 design changes made in Tabularius, oldest first, with who made them and when.',
        permissions: DESIGN_PERM,
        params: [DB],
        example: {
          request: `GET ${DX}/history\n${AUTH}`,
          status: 200,
          response: j({ history: [{ seq: 3, at: '2026-10-13T00:09:08.356Z', account: null, op: { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'text' }] } }] }),
        },
      },
      {
        method: 'GET',
        path: `${D}/ddr`,
        summary: 'The Database Design Report as XML, in FileMaker\'s FMPReport format, as a download.',
        permissions: DESIGN_PERM,
        params: [DB],
        example: {
          request: `GET ${DX}/ddr\n${AUTH}`,
          status: 200,
          response: '(an XML file, Content-Type application/xml, sent as an attachment named Invoices_ddr.xml: <?xml version="1.0"?><FMPReport … type="Report" version="tabularius"><File name="Invoices.fmp12" …>…)',
        },
      },
      {
        method: 'GET',
        path: `${D}/docs`,
        summary: 'Documentation of the solution (tables, relationships, layouts, scripts and more) as Markdown, or as an HTML page with ?format=html, as a download.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'format', in: 'query', type: 'string', description: 'html for an HTML page; anything else (or none) for Markdown.' }],
        example: {
          request: `GET ${DX}/docs\n${AUTH}`,
          status: 200,
          response: '(a Markdown file, Content-Type text/markdown, sent as an attachment named Invoices_docs.md: "# Invoices\\n\\nCreated with FileMaker Tabularius. 1 tables, …")',
        },
        notes: 'The HTML page is sent with a Content-Security-Policy that lets nothing in it run (default-src \'none\'; style-src \'unsafe-inline\').',
      },
      {
        method: 'POST',
        path: `${D}/docs`,
        summary: 'The same documentation, with an introduction of your own put first.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'format', in: 'query', type: 'string', description: 'html for an HTML page; otherwise Markdown.' },
          { name: 'introduction', in: 'body', type: 'string', description: 'Text to put first (cut to 100,000 characters).' },
        ],
        example: {
          request: `POST ${DX}/docs?format=html\n${AUTH}\nContent-Type: application/json\n\n${j({ introduction: 'How the invoicing file is put together.' })}`,
          status: 200,
          response: '(an HTML page, Content-Type text/html, sent as an attachment named Invoices_docs.html, titled "Invoices: documentation")',
        },
      },
      {
        method: 'GET',
        path: `${D}/report`,
        summary: 'The conversion report: what in the file won\'t work yet, or works differently, with a Markdown summary.',
        permissions: DESIGN_PERM,
        params: [DB],
        example: {
          request: `GET ${DX}/report\n${AUTH}`,
          status: 200,
          response: j({
            report: {
              database: 'Invoices',
              summary: '# Conversion report: Invoices\n\nNothing found that won\'t work.\n\n## Good to know\n- **Privilege sets imported**: [Full Access] (full access; fmapp, fmwebdirect, fmrest).',
              functions: { notYet: [], undecoded: [], plugIns: [] },
              steps: { notYet: [], blocked: [], network: [], screenOnly: [], clientOnly: [] },
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
            },
          }),
        },
      },
      {
        method: 'GET',
        path: `${D}/audit`,
        summary: 'Record changes from the audit log: who created, changed or deleted which record and when, with the values.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'table', in: 'query', type: 'string', description: 'Only this table (any case).' },
          { name: 'recordId', in: 'query', type: 'number', description: 'Only this record.' },
          { name: 'account', in: 'query', type: 'string', description: 'Only changes by this account (any case).' },
          { name: 'since', in: 'query', type: 'string', description: 'Only entries at or after this ISO time.' },
          { name: 'limit', in: 'query', type: 'number', description: 'How many of the latest entries (default 200, at most 10,000).' },
        ],
        example: {
          request: `GET ${DX}/audit?table=Items&limit=2\n${AUTH}`,
          status: 200,
          response: j({
            audit: [
              { seq: 5, at: '2026-10-13T00:09:08.341Z', account: 'Admin', kind: 'create', table: 'Items', recordId: 2, changes: { Name: 'Desk', Price: 10, Status: 'open' } },
              { seq: 6, at: '2026-10-13T00:09:08.342Z', account: 'Admin', kind: 'update', table: 'Items', recordId: 2, changes: { Status: ['open', 'done'] } },
            ],
          }),
        },
        notes: 'The latest entries, oldest first. changes holds the values set for a create, [old, new] per field for an update, and the record as it was for a delete. ' +
          'Security events in the log come back with security: true, and target and from when known; entries made by an AI agent account have agent: true.',
      },
      {
        method: 'POST',
        path: `${D}/check`,
        summary: 'Checks a formula without running it and returns its first error, as the Specify Calculation dialog reports it.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'formula', in: 'body', type: 'string', required: true, description: 'The formula.' },
          { name: 'occurrence', in: 'body', type: 'string or number', description: 'The table occurrence it is evaluated from, by name or id.' },
          { name: 'table', in: 'body', type: 'string or number', description: 'A base table, by name or id, when no occurrence is given (its first occurrence).' },
          { name: 'customFunction', in: 'body', type: 'string or number', description: 'A custom function whose parameters the formula may use.' },
          { name: 'parameters', in: 'body', type: 'array of string', description: 'Parameter names the formula may use (instead of a custom function\'s).' },
        ],
        example: {
          request: `POST ${DX}/check\n${AUTH}\nContent-Type: application/json\n\n${j({ formula: 'Price * ', table: 'Items' })}`,
          status: 200,
          response: j({ ok: false, code: 1202, message: 'The calculation ends too soon' }),
        },
        notes: 'A good formula gives {"ok": true}. A failing one gives ok: false with the FileMaker error code and message, and at (the 0-based offset) when known. ' +
          'No formula: 400, code 960. An occurrence, table or custom function that isn\'t in the file: 400, code 100.',
      },
      {
        method: 'POST',
        path: `${D}/preview`,
        summary: 'A formula\'s results on the record the person was on and the first few others, for live preview while it is typed; nothing is stored.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'formula', in: 'body', type: 'string', required: true, description: 'The formula.' },
          { name: 'occurrence', in: 'body', type: 'string or number', description: 'The table occurrence it runs from, by name or id.' },
          { name: 'table', in: 'body', type: 'string or number', description: 'A base table, when no occurrence is given.' },
          { name: 'layout', in: 'body', type: 'string', description: 'The layout the person is on, used first when it shows that occurrence.' },
          { name: 'recordId', in: 'body', type: 'number', description: 'The record the person is on, shown first.' },
        ],
        example: {
          request: `POST ${DX}/preview\n${AUTH}\nContent-Type: application/json\n\n${j({ formula: 'Price * 2', table: 'Items' })}`,
          status: 200,
          response: j({ ok: true, layout: 'Items', results: [{ recordId: 1, value: '20' }, { recordId: 2, value: '20' }, { recordId: 3, value: '20' }] }),
        },
        notes: 'Up to 5 records; a record whose result is an error has error instead of value. A formula that doesn\'t check gives ok: false, its message, and results: []; ' +
          'so does one with no layout on its occurrence (ok: true, results: []).',
      },
      {
        method: 'POST',
        path: `${D}/restyle`,
        summary: 'Puts every layout (or the ones named) onto one theme, an existing one or a new one made from colour tokens, and returns each layout before and after and the changes that do it; nothing is saved.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'theme', in: 'body', type: 'string or number', description: 'An existing theme to restyle onto.' },
          { name: 'tokens', in: 'body', type: 'object', description: 'Colours for a new theme instead, e.g. {"accent": "#224488"}.' },
          { name: 'name', in: 'body', type: 'string', description: 'The new theme\'s name, with tokens.' },
          { name: 'consistent', in: 'body', type: 'boolean', description: 'Also make the layouts\' local styling consistent.' },
          { name: 'layouts', in: 'body', type: 'array of number', description: 'Only these layouts, by id.' },
        ],
        example: {
          request: `POST ${DX}/restyle\n${AUTH}\nContent-Type: application/json\n\n${j({ tokens: { accent: '#224488' }, name: 'Blue' })}`,
          status: 200,
          response: j({
            changes: [
              { op: 'createTheme', id: 1, name: 'Blue', content: { defaults: { 20: [{ part: 1, state: 1, css: { 'background-image': 'none', 'background-color': '#f3f5f6' } }] }, styles: [] } },
              { op: 'updateLayout', layout: 1, design: { style: {}, parts: LAYOUT.parts, objects: LAYOUT.objects, themeId: 1 } },
            ],
            layouts: [{ id: 1, name: 'Items', before: LAYOUT, after: LAYOUT, notes: ['Theme: none → Blue.'], changed: 0, issues: { before: 0, after: 0 } }],
            unchanged: [],
            theme: 'Blue',
            themeContent: { id: 1, name: 'Blue', defaults: { 20: [{ part: 1, state: 1, css: { 'background-image': 'none', 'background-color': '#f3f5f6' } }] }, styles: [] },
          }),
        },
        notes: 'Theme contents and layout designs are shortened here. Apply the changes with POST /tabularius/design/v1/databases/{database}. ' +
          'A bad request (a colour that isn\'t one, a theme that isn\'t there) is 400, code 960 or the file\'s own code.',
      },
      {
        method: 'POST',
        path: `${D}/modernize`,
        summary: 'Makes a list, a record form and a list with the form beside it (modern layouts, HTML, CSS and JavaScript), and a classic list and form, for each table from templates with no AI, beside the file\'s own layouts, which are never changed; returns the layouts, the tables skipped and the changes that make them. Nothing is saved.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'tables', in: 'body', type: 'array of string', description: 'Only these tables (default: every table that has a use for them; join tables of only keys get none).' },
          { name: 'styles', in: 'body', type: 'array of string', description: 'Any of modern-list, modern-detail, modern-split, classic-list, classic-form (default: all).' },
          { name: 'folder', in: 'body', type: 'boolean', description: 'Keep the new layouts together in a "Modernized interfaces" folder of the Layouts list (default true).' },
        ],
        example: {
          request: `POST ${DX}/modernize\n${AUTH}\nContent-Type: application/json\n\n${j({ tables: ['Items'], styles: ['modern-list'] })}`,
          status: 200,
          response: j({
            layouts: [{ name: 'Items - Modern list', table: 'Items', style: 'modern-list', notes: ['Columns: Name, Price.'] }],
            skipped: [],
            changes: [
              { op: 'createLayout', name: 'Items - Modern list', occurrence: 1, design: { width: 1000, parts: LAYOUT.parts, objects: [{ style: {} }] } },
              { op: 'setOrder', list: 'layouts', order: [{ item: 1 }, { folder: 'Modernized interfaces', children: [{ item: 'Items - Modern list' }] }] },
            ],
          }),
        },
        notes: 'Layout designs are shortened here. Apply the changes with POST /tabularius/design/v1/databases/{database}, which returns undo. ' +
          'A layout that is already there is skipped, so asking again only adds what is missing. A table or style that isn\'t there is 400, code 960.',
      },
      {
        method: 'POST',
        path: `${D}/snippet`,
        summary: 'Turns FileMaker\'s clipboard XML (tables, fields, scripts, steps, custom functions, value lists) into the changes that paste it into this file, with a summary and notes; layout objects come back as objects for the layout editor to place. Nothing is applied.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'xml', in: 'body', type: 'string', required: true, description: 'The clipboard XML (<fmxmlsnippet …>).' },
          { name: 'table', in: 'body', type: 'string or number', description: 'The table pasted fields go into.' },
          { name: 'script', in: 'body', type: 'string or number', description: 'The script pasted steps go into.' },
          { name: 'at', in: 'body', type: 'number', description: 'The step position they go in at.' },
          { name: 'layout', in: 'body', type: 'number', description: 'For layout objects: the layout they go onto (its theme and style names are used).' },
        ],
        example: {
          request: `POST ${DX}/snippet\n${AUTH}\nContent-Type: application/json\n\n${j({ table: 'Items', xml: '<fmxmlsnippet type="FMObjectList"><Field id="1" dataType="Number" fieldType="Normal" name="Stock"><Comment/></Field></fmxmlsnippet>' })}`,
          status: 200,
          response: j({ changes: [{ op: 'createField', table: 129, name: 'Stock', type: 'number', kind: 'normal' }], summary: ['1 field'], notes: [] }),
        },
        notes: 'Layout objects (type="LayoutObjectList") come back as {"objects", "summary", "notes"}. No xml: 400, code 960; XML that isn\'t a snippet is 400 too.',
      },
      {
        method: 'POST',
        path: `${D}/snippet/copy`,
        summary: 'FileMaker\'s clipboard XML for the tables, fields, scripts, steps, custom functions or value lists named by id; or, with objects, Layout mode\'s clipboard XML for layout objects.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'tables', in: 'body', type: 'array of number', description: 'Table ids.' },
          { name: 'fields', in: 'body', type: 'object', description: '{"table": id, "ids": [field ids]}.' },
          { name: 'scripts', in: 'body', type: 'array of number', description: 'Script ids.' },
          { name: 'steps', in: 'body', type: 'object', description: '{"script": id, "indexes": [step positions]}.' },
          { name: 'customFunctions', in: 'body', type: 'array of number', description: 'Custom function ids.' },
          { name: 'valueLists', in: 'body', type: 'array of number', description: 'Value list ids.' },
          { name: 'objects', in: 'body', type: 'array of object', description: 'Layout objects (each with kind and bounds) instead of the above.' },
          { name: 'layout', in: 'body', type: 'number', description: 'With objects: the layout they come from (for its theme).' },
        ],
        example: {
          request: `POST ${DX}/snippet/copy\n${AUTH}\nContent-Type: application/json\n\n${j({ scripts: [1] })}`,
          status: 200,
          response: j({
            xml: '<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="FMObjectList"><Script includeInMenu="True" runFullAccess="False" id="1" name="Finish"><Step enable="True" id="76" name="Set Field"><Calculation><![CDATA["done"]]></Calculation><Field table="Items" id="3" name="Status"/></Step><Step enable="True" id="103" name="Exit Script"><Calculation><![CDATA["ok"]]></Calculation></Step></Script></fmxmlsnippet>',
            notes: [],
          }),
        },
        notes: 'objects that aren\'t a list of layout objects: 400, code 960. A pick that isn\'t a list of ids (e.g. "tables": "all") is 400.',
      },
      {
        method: 'POST',
        path: `${D}/evaluate`,
        summary: 'A formula\'s result on no record, from a layout of the file (to try a custom function).',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'formula', in: 'body', type: 'string', required: true, description: 'The formula.' },
          { name: 'layout', in: 'body', type: 'string', description: 'The layout it runs from; by default the first layout whose occurrence works.' },
        ],
        example: {
          request: `POST ${DX}/evaluate\n${AUTH}\nContent-Type: application/json\n\n${j({ formula: '1 + 2' })}`,
          status: 200,
          response: j({ value: '3', type: 'number' }),
        },
        notes: 'No formula: 400, code 960. A file with no layout to run it from: 400, code 105. A formula that fails is 400 with its error code.',
      },
      {
        method: 'DELETE',
        path: `${D}/deleted`,
        summary: 'Lets go, for good, of the data kept for every deleted table and field, and returns how many went with the new design.',
        permissions: DESIGN_PERM,
        params: [DB],
        example: { request: `DELETE ${DX}/deleted\n${AUTH}`, status: 200, response: j({ emptied: 1, design: design() }) },
        notes: `A deleted table or field can be brought back with the restoreDeleted change until it is emptied here. ${SHORT}`,
      },
      {
        method: 'DELETE',
        path: `${D}/deleted/{id}`,
        summary: 'Lets go, for good, of one deleted table\'s or field\'s kept data.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'number', required: true, description: 'The id from the design\'s deleted list.' }],
        example: { request: `DELETE ${DX}/deleted/999\n${AUTH}`, status: 404, response: ERR(101, 'Nothing deleted has id 999') },
        notes: `When it is there: 200 with {"emptied": 1, "design": {…}}, as for /deleted.`,
      },
      {
        method: 'GET',
        path: `${D}/images`,
        summary: 'The file\'s image library (button icons, pictures), each with a signed URL to load it from.',
        permissions: DESIGN_PERM,
        params: [DB],
        example: {
          request: `GET ${DX}/images\n${AUTH}`,
          status: 200,
          response: j({ images: [{ id: 1, filename: 'dot.svg', mime: 'image/svg+xml', bytes: 93, url: '/tabularius/images/Invoices/1?sig=h4PfA7BZowjm_vhfInvtCpS8S4NbbgIcS3I9J3m6AkM&exp=1791853748' }] }),
        },
      },
      {
        method: 'POST',
        path: `${D}/images`,
        summary: 'Adds a PNG, JPEG, GIF, WebP or SVG image to the library.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'filename', in: 'body', type: 'string', description: 'Its file name (cut to 255 characters).' },
          { name: 'mime', in: 'body', type: 'string', required: true, description: 'image/png, image/jpeg, image/gif, image/webp or image/svg+xml.' },
          { name: 'data', in: 'body', type: 'string', required: true, description: 'The image, base64.' },
        ],
        example: {
          request: `POST ${DX}/images\n${AUTH}\nContent-Type: application/json\n\n${j({ filename: 'dot.svg', mime: 'image/svg+xml', data: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4IDgiPjxjaXJjbGUgY3g9IjQiIGN5PSI0IiByPSIzIi8+PC9zdmc+' })}`,
          status: 200,
          response: j({ id: 1, url: '/tabularius/images/Invoices/1?sig=h4PfA7BZowjm_vhfInvtCpS8S4NbbgIcS3I9J3m6AkM&exp=1791853748' }),
        },
        notes: 'Without data or mime: 400, code 960. Another type, an empty image or an SVG that isn\'t one: 400, code 960 ("Images must be PNG, JPEG, GIF, WebP or SVG, not …"). ' +
          'Other methods on /images are 405.',
      },
      {
        method: 'GET',
        path: `${D}/suggest-rules`,
        summary: 'Validations, value lists, serial numbers and defaults the data already follows, suggested as field options.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'table', in: 'query', type: 'string', description: 'Only this table.' }],
        example: {
          request: `GET ${DX}/suggest-rules?table=Items\n${AUTH}`,
          status: 200,
          response: j({ suggestions: [], alsoAlwaysFilled: [], tablesChecked: ['Items'] }),
        },
        notes: 'A table that isn\'t there: 404, code 5.',
      },
      {
        method: 'GET',
        path: `${D}/impact`,
        summary: 'What renaming or deleting a field, table, layout, script or value list would break, here, in the other hosted files and in clients seen in the logs, before it is done.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'kind', in: 'query', type: 'string', required: true, description: 'field, table, layout, script or valueList.' },
          { name: 'name', in: 'query', type: 'string', required: true, description: 'Its name (Table::Field for a field).' },
          { name: 'change', in: 'query', type: 'string', description: 'delete; anything else means rename.' },
        ],
        example: {
          request: `GET ${DX}/impact?kind=field&name=Items::Price&change=rename\n${AUTH}`,
          status: 200,
          response: j({
            target: { kind: 'field', name: 'Items::Price' },
            change: 'rename',
            uses: [{ where: 'Layout "Items"', text: 'field Items::Price', breaks: false, why: 'It refers to it by id and follows the rename.' }],
            useCount: 1,
            privileges: [],
            clients: [],
            crossFile: [],
            logDays: 30,
            logRead: true,
            summary: ['1 other use in the file follows the rename.', 'OData and ODBC clients are not logged, so they were not checked.'],
          }),
        },
        notes: 'Any other kind: 400, code 5 ("kind must be field, table, layout, script or valueList"). A name that isn\'t there: 404, code 5.',
      },
      {
        method: 'GET',
        path: `${D}/pending`,
        summary: 'Design changes staged for review, each described: what it does, a calculation, custom function or script before and after, what a rename or delete would break, who staged it, whether it would apply, and changes others made to the same thing since.',
        permissions: DESIGN_PERM,
        params: [DB],
        example: {
          request: `GET ${DX}/pending\n${AUTH}`,
          status: 200,
          response: j({
            changes: [{
              id: 1, op: { op: 'updateField', table: 'Items', field: 'Total', calculation: 'Qty * Price * 1.2' }, by: 'Sam', at: '2026-10-18T14:50:00.000Z',
              title: 'Change field Items::Total', object: { kind: 'field', label: 'field', name: 'Items::Total' }, lines: [],
              diffs: [{ label: 'Calculation', before: 'Qty * Price', after: 'Qty * Price * 1.2' }], status: 'ready', conflicts: [],
            }],
            seq: 12,
          }),
        },
        notes: 'Each change is checked in order against the ones before it. `status` is "ready" or "blocked" (`message` says why); `conflicts` lists changes in the design history after the change was staged that touch the same thing or its table. The staged list is kept in memory and a restart clears it.',
      },
      {
        method: 'POST',
        path: `${D}/pending`,
        summary: 'Stages design changes for review without making them.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'changes', in: 'body', type: 'array', required: true, description: 'Design changes (the same objects POST on the design resource takes).' }],
        example: {
          request: `POST ${DX}/pending\n${AUTH}\nContent-Type: application/json\n\n${j({ changes: [{ op: 'updateField', table: 'Items', field: 'Total', calculation: 'Qty * Price * 1.2' }] })}`,
          status: 200,
          response: j({ staged: [1], changes: [], seq: 12 }),
        },
        notes: 'The response is the review, as GET gives it, with the ids of what was staged. No list, an empty list or an entry that is not an object with an "op": 400, code 960. More than 100 waiting: 400, code 960.',
      },
      {
        method: 'POST',
        path: `${D}/pending/apply`,
        summary: 'Applies staged changes, all or the ones named, in the order they were staged.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'ids', in: 'body', type: 'array', description: 'Ids of the staged changes to apply; all when absent.' },
          { name: 'overrideConflicts', in: 'body', type: 'array', description: 'Ids of changes to apply although someone changed the same thing since they were staged.' },
        ],
        example: {
          request: `POST ${DX}/pending/apply\n${AUTH}\nContent-Type: application/json\n\n${j({ ids: [1] })}`,
          status: 200,
          response: j({ result: { applied: [{ id: 1, title: 'Change field Items::Total' }], blocked: [], conflicts: [], remaining: 0 }, changes: [], seq: 13, design: design() }),
        },
        notes: 'The ones that apply go in together, as one unit. One the design would refuse is listed in `blocked` with the reason, one in conflict (and not named in `overrideConflicts`) in `conflicts`; both stay staged. The response also has the review of what is left and the design as it now is.',
      },
      {
        method: 'POST',
        path: `${D}/pending/discard`,
        summary: 'Drops staged changes without applying them.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'ids', in: 'body', type: 'array', description: 'Ids to drop; all when absent.' }],
        example: {
          request: `POST ${DX}/pending/discard\n${AUTH}\nContent-Type: application/json\n\n${j({ ids: [1] })}`,
          status: 200,
          response: j({ discarded: 1, changes: [], seq: 12 }),
        },
      },
      {
        method: 'POST',
        path: `${D}/scripts/lint`,
        summary: 'The script editor\'s Check: loops that never end and guards that catch nothing, each with a fix, on a saved script or on script text.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'text', in: 'body', type: 'string', description: 'Script text, one step per line.' },
          { name: 'script', in: 'body', type: 'number', description: 'A saved script\'s id (checked as saved when no text is sent).' },
        ],
        example: {
          request: `POST ${DX}/scripts/lint\n${AUTH}\nContent-Type: application/json\n\n${j({ text: 'Loop\nEnd Loop' })}`,
          status: 200,
          response: j({
            issues: [{
              rule: 'loop-no-exit', severity: 'error', step: 0, line: 1,
              message: 'Nothing in this loop ends it: no Exit Loop If, no “Exit after last”, no Exit Script. It runs until someone stops it.',
              fix: 'Add Exit Loop If [ … ] with the condition that should end the loop.',
              detail: 'Only Exit Loop If, Go to Record or Go to Portal Row with “Exit after last”, Exit Script and Halt Script leave a loop, and this loop has none of them that runs.',
              stepName: 'Loop',
            }],
          }),
        },
        notes: 'Neither text nor the id of a saved script: 400, code 960.',
      },
      {
        method: 'GET',
        path: `${D}/used`,
        summary: 'Where a field, table, occurrence, script, layout, custom function or value list is used.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'name', in: 'query', type: 'string', required: true, description: 'Its name (Table::Field for a field).' },
          { name: 'kind', in: 'query', type: 'string', description: 'field, table, tableOccurrence, script, layout, customFunction or valueList; without it every kind with that name.' },
        ],
        example: {
          request: `GET ${DX}/used?name=Items::Price&kind=field\n${AUTH}`,
          status: 200,
          response: j({ used: [{ target: { kind: 'field', name: 'Items::Price' }, count: 1, usages: [{ kind: 'layout', where: 'Layout "Items"', text: 'field Items::Price' }] }] }),
        },
      },
      {
        method: 'POST',
        path: `${D}/import-tables`,
        summary: 'Reads the files another tool exported (CSV, Excel, Notion Markdown pages) and plans or makes whole tables from them: the web client\'s Import Tables dialog and `tabularius import-tables`.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'stage', in: 'query', type: 'string', description: '"preview" (the default) answers the plan with a few rows of each sheet and writes nothing; "import" makes the tables.' },
          { name: 'links', in: 'query', type: 'string', description: '0 keeps linked-record columns as plain columns instead of making relationships.' },
          { name: 'file', in: 'body', type: 'file', required: true, description: 'multipart/form-data parts named "file", one for each CSV, tab-separated text or Excel file (an Excel workbook makes a table for each sheet); at most 20.' },
          { name: 'pages', in: 'body', type: 'file', description: 'Parts named "pages": the .md pages of a Notion export, which make one table; other files are ignored.' },
          { name: 'folder', in: 'body', type: 'string', description: 'A part naming the table the pages make (the folder\'s name).' },
          { name: 'overrides', in: 'body', type: 'string', description: 'A part holding JSON {"Sheet": {"Column": "kind"}}: text, number, date, time, timestamp, checkbox, select, multi, skip, or link:<Sheet>.' },
        ],
        example: {
          request: `POST ${DX}/import-tables?stage=import\n${AUTH}\nContent-Type: multipart/form-data; boundary=X\n\n--X\nContent-Disposition: form-data; name="file"; filename="Clients-Grid view.csv"\nContent-Type: text/csv\n\nName,Notes\r\nAcme,first\r\n\n--X--`,
          status: 200,
          response: j({ report: { tables: 1, fields: 3, rows: 1, joinTables: 0, links: 0, valueLists: 0, portals: 0 }, summary: ['1 table, 3 fields, 1 row, 0 value lists, 0 join tables holding 0 links, 0 portals'] }),
          skipReason: 'A multipart body with files; the route is exercised by packages/server/test/import-tables-web.test.ts.',
        },
        notes: 'Counts and the plan only: no record value comes back except the first three rows of each sheet in a preview, cut to 80 characters each. A preview and an import both send the files, so nothing is kept between them. Refused with 403 (code 9) for a token that is read-only or limited to layouts; 400 (code 3) for a file that cannot be read, none chosen, more than 20 files or a bad column choice; 413 over 50 MB.',
      },
      {
        method: 'GET',
        path: `${D}/graph`,
        summary: 'The relationship graph in plain English, its problems, and the updateOccurrence changes that tidy it (anchor-buoy aware).',
        permissions: DESIGN_PERM,
        params: [DB],
        example: {
          request: `GET ${DX}/graph\n${AUTH}`,
          status: 200,
          response: j({
            summary: ['The graph has 1 table occurrence of 1 table and no relationships.', 'Nothing looks wrong.'],
            groups: [{ anchor: 129, occurrences: [129], anchorBuoy: false }],
            issues: [],
            arrange: [{ op: 'updateOccurrence', occurrence: 129, graph: { left: 40, top: 40, width: 180, height: 42 } }],
          }),
        },
      },
      {
        method: 'GET',
        path: `${D}/layouts/{id}`,
        summary: 'A layout\'s design as stored, for the layout editor; single-step buttons get their step as a script line.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'number', required: true, description: 'The layout\'s id.' }],
        example: { request: `GET ${DX}/layouts/1\n${AUTH}`, status: 200, response: j({ design: LAYOUT }) },
        notes: 'Objects are shortened here. A layout with no design: 404, code 105. Only GET; other methods are 405.',
      },
      {
        method: 'GET',
        path: `${D}/layouts/{id}/lint`,
        summary: 'Check layout: what will look or behave wrong on the saved layout.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'number', required: true, description: 'The layout\'s id.' }],
        example: { request: `GET ${DX}/layouts/1/lint\n${AUTH}`, status: 200, response: j({ issues: [OVERLAP, UNLABELED] }) },
        notes: 'fixable marks the issues /fix can mend. A layout with no design: 404, code 105.',
      },
      {
        method: 'POST',
        path: `${D}/layouts/{id}/lint`,
        summary: 'Check layout on an unsaved design: what the editor has open, laid over the saved layout.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'number', required: true, description: 'The layout\'s id.' },
          { name: 'design', in: 'body', type: 'object', description: 'The design as open (parts, objects, …); left out, the saved one is checked.' },
        ],
        example: {
          request: `POST ${DX}/layouts/1/lint\n${AUTH}\nContent-Type: application/json\n\n${j({ design: { objects: LAYOUT.objects } })}`,
          status: 200,
          response: j({ issues: [] }),
        },
        notes: 'A design that isn\'t an object, or whose parts or objects aren\'t lists: 400, code 960.',
      },
      {
        method: 'POST',
        path: `${D}/layouts/{id}/fix`,
        summary: 'Fix: Check\'s mechanical findings mended on the layout (all of them, or the ones named), with any field changes they need and what is left; nothing is saved.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'number', required: true, description: 'The layout\'s id.' },
          { name: 'design', in: 'body', type: 'object', description: 'The design as open; left out, the saved one.' },
          { name: 'only', in: 'body', type: 'array of object', description: 'Only these findings: [{"rule", "objectIds"}].' },
        ],
        example: {
          request: `POST ${DX}/layouts/1/fix\n${AUTH}\nContent-Type: application/json\n\n${j({ only: [{ rule: 'overlap', objectIds: [902, 901] }] })}`,
          status: 200,
          response: j({ design: { ...LAYOUT, objects: [] }, fixed: [OVERLAP], changes: [], issues: [UNLABELED] }),
        },
        notes: 'design is the mended layout (shortened here); changes are design changes outside the layout (a field\'s indexing) for the editor to apply, and issues ' +
          'are what Check still finds once they are. GET is 405.',
      },
      {
        method: 'GET',
        path: `${D}/layouts/{id}/history`,
        summary: 'Every save of one layout (its createLayout and updateLayout changes), oldest first, however long ago.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'number', required: true, description: 'The layout\'s id.' }],
        example: {
          request: `GET ${DX}/layouts/1/history\n${AUTH}`,
          status: 200,
          response: j({ history: [{ seq: 2, at: '2026-10-13T00:10:19.541Z', account: null, op: { op: 'updateLayout', layout: 1, design: { objects: LAYOUT.objects } } }] }),
        },
        notes: 'Other methods are 405.',
      },
      {
        method: 'POST',
        path: `${D}/layouts/{id}/speed`,
        summary: 'Make this layout faster: Check\'s speed findings on the saved layout, each with a redesign where there is a mechanical one, as changes to look over, and the cost before and after; nothing is saved.',
        permissions: DESIGN_PERM + ' With ai: true the account\'s privilege set also needs the fmmcp extended privilege (AI access) and AI must not be turned off for the file.',
        params: [
          DB,
          { name: 'id', in: 'path', type: 'number', required: true, description: 'The layout\'s id.' },
          { name: 'ai', in: 'body', type: 'boolean', description: 'true: the AI assistant also proposes redesigns for the findings that have no mechanical one, from the layout\'s design (never its records).' },
        ],
        example: {
          request: `POST ${DX}/layouts/1/speed\n${AUTH}\nContent-Type: application/json\n\n${j({})}`,
          status: 200,
          response: j({
            layout: { id: 1, name: 'Items' },
            before: 24000,
            moves: [{ kind: 'unstored calculation', objectIds: [3], title: 'Store the calculation so it is worked out once, not on every draw', changes: [{ op: 'updateField', table: 129, field: 3, storage: 'stored' }], after: 40 }],
            left: [],
          }),
        },
        notes: 'before and each move\'s after are estimated record reads to draw the layout once; moves are the redesigns (their changes can be sent to POST on the design path, which returns the undo), and left the findings with no redesign. ' +
          'A move the assistant proposed has ai: true and details, each change in plain words; ideas that do not apply to this file are named in ai.dropped. ' +
          'With ai: true the reply adds ai: {"ideas": number}, or ai: {"note"} saying why there were none (AI off for the file or the account, no fmmcp, the assistant not running on this server, or the model call failing). GET is 405.',
      },
      {
        method: 'GET, POST',
        path: `${D}/layouts/{id}/phone`,
        summary: 'What a phone layout made from this layout (or from the design sent with POST) would show, and the phone layout already made from it, if any.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'number', required: true, description: 'The layout\'s id.' },
          { name: 'design', in: 'body', type: 'object', description: 'POST: the design as open, laid over the saved one.' },
        ],
        example: {
          request: `POST ${DX}/layouts/1/phone\n${AUTH}\nContent-Type: application/json\n\n${j({})}`,
          status: 200,
          response: j({ phone: { ...LAYOUT, width: 390 } }),
        },
        notes: 'phone is the layout as a phone layout (objects shortened here), 390 points wide unless the existing phone layout has its own width. ' +
          'When a phone layout was already made from this one, existing: {id, name, following, design} is added (following: not edited by hand since it was last rebuilt).',
      },
      {
        method: 'GET',
        path: `${D}/library`,
        summary: 'The component library: layout components saved by any file on this server, with this file\'s copy of each, if it has one.',
        permissions: DESIGN_PERM + ' Anyone with [Full Access] to a file on this server can see the whole library.',
        params: [DB],
        example: {
          request: `GET ${DX}/library\n${AUTH}`,
          status: 200,
          response: j({ library: [{ id: 'a1b2c3d4e5f6', name: 'Page header', width: 800, height: 60, objects: [], version: 2, updated: '2026-10-13T00:12:00.000Z', from: 'Invoices', owner: 'Invoices', uses: ['Invoices', 'Contacts'], here: { component: 3, version: 2 } }] }),
        },
        notes: 'objects are shortened here, and carry no pictures (those stay with the file that saved them until the component is placed). here is left out when this file has no copy. Each file keeps its own copy of a component, linked to the library by id and version; a newer version is offered, not pushed.',
      },
      {
        method: 'POST',
        path: `${D}/library`,
        summary: 'Saves one of this file\'s components to the library: as a new entry, or as the next version when it is already a copy of one.',
        permissions: DESIGN_PERM + ' Only the file a component was first saved from may save new versions of it (else 403, code 9).',
        params: [DB, { name: 'component', in: 'body', type: 'number', required: true, description: 'The id of one of this file\'s components.' }],
        example: {
          request: `POST ${DX}/library\n${AUTH}\nContent-Type: application/json\n\n${j({ component: 3 })}`,
          status: 200,
          response: j({ entry: { id: 'a1b2c3d4e5f6', name: 'Page header', width: 800, height: 60, objects: [], version: 3, updated: '2026-10-13T00:14:00.000Z', from: 'Invoices', owner: 'Invoices', uses: ['Invoices'] }, design: design() }),
        },
        notes: 'The component\'s fields, value lists, scripts and layouts are saved by name, so another file can match them, and its pictures travel with it. The file\'s component is then linked to the entry. No component, or one that is not in this file: 400, code 960. ' +
          'A copy that is not based on the latest version: 409, code 960. A library or component over its limits (500 components, 2,000 objects in one, 8 MB of pictures in one): 400, code 960.',
      },
      {
        method: 'POST',
        path: `${D}/library/{id}`,
        summary: 'Places a library component in this file, or brings this file\'s copy of it up to the latest version; with preview: true, shows what that would change without doing it.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The library entry\'s id (12 hex digits).' },
          { name: 'preview', in: 'body', type: 'boolean', description: 'true: change nothing; say what would be left out, and each layout it would change, before and after.' },
        ],
        example: {
          request: `POST ${DX}/library/a1b2c3d4e5f6\n${AUTH}\nContent-Type: application/json\n\n${j({ preview: true })}`,
          status: 200,
          response: j({ version: 3, current: 2, missing: [], layouts: [{ id: 1, name: 'Items', before: LAYOUT, after: LAYOUT }] }),
        },
        notes: 'The preview has current (the version this file has) only when it has a copy, and shortens the layouts as above. Without preview the reply is {"applied": [...], "missing": [...], "design": {...}}: a new component (named with a number added if the name is taken) or the file\'s copy updated, with the layouts that place it brought up to date. ' +
          'missing names the fields, value lists, scripts, layouts and pictures the component uses that this file does not have, and which are left unset. Pictures the file already holds (same bytes) are reused, the rest added. An id not in the library: 404, code 960. Other methods than POST and DELETE: 405.',
      },
      {
        method: 'DELETE',
        path: `${D}/library/{id}`,
        summary: 'Takes a component out of the library. Files that placed it keep their own copies.',
        permissions: DESIGN_PERM + ' Only the file the component was first saved from may take it out (else 403, code 9).',
        params: [DB, { name: 'id', in: 'path', type: 'string', required: true, description: 'The library entry\'s id (12 hex digits).' }],
        example: { request: `DELETE ${DX}/library/a1b2c3d4e5f6\n${AUTH}`, status: 200, response: j({ removed: 'a1b2c3d4e5f6' }) },
        notes: 'An id not in the library: 404, code 960.',
      },
      {
        method: 'GET',
        path: `${D}/themes/{id}`,
        summary: 'A theme in full: its element defaults and every named style, with their rules.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'number', required: true, description: 'The theme\'s id.' }],
        example: {
          request: `GET ${DX}/themes/1\n${AUTH}`,
          status: 200,
          response: j({ theme: { id: 1, name: 'House', defaults: {}, styles: [{ name: 'Big', element: 70, rules: [{ part: 1, state: 1, css: { 'font-size': '18pt' } }] }] } }),
        },
        notes: 'A theme that isn\'t there: 404, code 960 ("Theme … is missing").',
      },
    ],
  },
  {
    id: 'design-scripts',
    title: 'Design mode: script tests, history, profile and dry run',
    sources: ['design.ts'],
    intro: 'The script editor\'s tools, under /tabularius/design/v1/databases/{database}: saved test cases, each save of a script, step timings and dry runs. ' +
      'Signing in, [Full Access] and errors are as for the rest of design mode. Test runs, profiled runs, dry runs, comparisons and AI-suggested test cases work on a throwaway copy of the file, ' +
      'offline, so the hosted data never changes; a file over 1 GB is not copied (400, code 960).',
    anchors: [`sub === 'run'`, `sub === 'record'`, `sub === 'suggest'`],
    routes: [
      {
        method: 'GET',
        path: `${D}/script-tests`,
        summary: 'The file\'s script test cases, or one script\'s.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'script', in: 'query', type: 'number', description: 'Only this script\'s cases, by id.' }],
        example: { request: `GET ${DX}/script-tests?script=1\n${AUTH}`, status: 200, response: j({ tests: [TEST] }) },
      },
      {
        method: 'POST',
        path: `${D}/script-tests`,
        summary: 'Saves a test case (new, or replacing the one with its id): a script\'s inputs and what it should end with.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          {
            name: 'test', in: 'body', type: 'object', required: true,
            description: '{"script": id, "name", "given"?: {parameter, layout, find, record, globals, ai}, "expect": {result, error, foundCount, layout, variables, fields}, "id"?}; at least one expectation.',
          },
        ],
        example: {
          request: `POST ${DX}/script-tests\n${AUTH}\nContent-Type: application/json\n\n${j({ test: { script: 1, name: 'finishes', expect: { result: 'ok', error: 0 } } })}`,
          status: 200,
          response: j({ test: TEST }),
        },
        notes: 'A case that doesn\'t check out (no script of this file, no name, no expectation, too large) is 400, code 960, with the reason.',
      },
      {
        method: 'DELETE',
        path: `${D}/script-tests/{id}`,
        summary: 'Deletes a test case.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'string', required: true, description: 'The case\'s id (letters, digits, - and _, up to 64).' }],
        example: { request: `DELETE ${DX}/script-tests/87293af5-04f2-42c5-bb8c-cc9e04980fa2\n${AUTH}`, status: 200, response: j({ deleted: '87293af5-04f2-42c5-bb8c-cc9e04980fa2' }) },
        notes: 'No such case: 404, code 5. Any other method on /script-tests/{id}, or a GET of /script-tests/run, /record or /suggest, is 400, code 960 ("Unknown script test request").',
      },
      {
        method: 'POST',
        path: `${D}/script-tests/run`,
        summary: 'Runs test cases, all of them, one script\'s or the ones named, on a throwaway copy of the file, and says which passed.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'ids', in: 'body', type: 'array of string', description: 'Only these cases.' },
          { name: 'script', in: 'body', type: 'number', description: 'Only this script\'s cases.' },
        ],
        example: {
          request: `POST ${DX}/script-tests/run\n${AUTH}\nContent-Type: application/json\n\n${j({ script: 1 })}`,
          status: 200,
          response: j({ outcomes: [{ id: TEST.id, name: 'finishes', script: 'Finish', passed: true, failures: [], steps: 2, ms: 4 }] }),
        },
        notes: 'A failing case lists failures [{what, expected, actual}], and message when the script stopped on an error.',
      },
      {
        method: 'POST',
        path: `${D}/script-tests/record`,
        summary: 'Runs a script once with the given inputs, on a throwaway copy, and returns how it ended, to save as a test case\'s expectations.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'script', in: 'body', type: 'number', required: true, description: 'The script\'s id.' },
          { name: 'given', in: 'body', type: 'object', description: 'The inputs, as a test case\'s given.' },
        ],
        example: {
          request: `POST ${DX}/script-tests/record\n${AUTH}\nContent-Type: application/json\n\n${j({ script: 1, given: {} })}`,
          status: 200,
          response: j({ expect: ENDED }),
        },
        notes: 'No script id: 400, code 960. Inputs that don\'t check out, or a run that can\'t be set up (a layout that isn\'t there), are 400, code 960, saying why.',
      },
      {
        method: 'POST',
        path: `${D}/script-tests/suggest`,
        summary: 'Has the AI assistant write test cases for a script, runs each on a throwaway copy, and returns them with whether the script did what each expects; nothing is saved.',
        permissions: DESIGN_PERM + ' The AI assistant must be running on the server (started with --ai), AI must not be turned off for the file, and the account needs AI access (the fmmcp extended privilege).',
        params: [DB, { name: 'script', in: 'body', type: 'number', required: true, description: 'The script\'s id.' }],
        example: {
          request: `POST ${DX}/script-tests/suggest\n${AUTH}\nContent-Type: application/json\n\n${j({ script: 1 })}`,
          status: 200,
          response: j({
            cases: [{
              name: 'finishes with ok', why: 'The script should end with the result ok.', given: {}, expect: { result: 'ok', error: 0 }, passed: true, failures: [],
              changes: { create: 0, update: 1, delete: 0 },
            }],
          }),
          skipReason: 'Requires an external AI provider API key and a model response.',
        },
        notes: 'The model sees the script (secrets hidden) and the file\'s outline (layouts, tables and fields, script names), never its records. Up to 6 cases come back; one that does not check out is named in skipped. ' +
          'A case that failed lists failures [{what, expected, actual}] and, when the script ran, asRuns: the same case with what the script did in place of each missed expectation, to keep it as it runs now. changes counts the records the run would create, update and delete; more and emptied are added when it changed more than is listed or emptied a table. ' +
          'No such script: 404, code 104. The assistant off: 503, code 960. A model limit reached: 429. Another request already running for this file: 409. Closing the connection stops the model call.',
      },
      {
        method: 'GET',
        path: `${D}/scripts/{id}/history`,
        summary: 'The script as each save in Tabularius left it, oldest first, as text, with who saved it and when.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'number', required: true, description: 'The script\'s id.' }],
        example: {
          request: `GET ${DX}/scripts/1/history\n${AUTH}`,
          status: 200,
          response: j({ versions: [{ seq: 2, at: '2026-10-13T00:09:08.329Z', account: null, text: SCRIPT_TEXT }] }),
        },
        notes: 'From the latest 5,000 design changes; saves made in FileMaker before the file came here are not in it, and a rename alone is no new version.',
      },
      {
        method: 'GET',
        path: `${D}/scripts/{id}/profile`,
        summary: 'Each step\'s time and run count from the script\'s runs on this server since it started, placed on the lines of the script\'s text.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'number', required: true, description: 'The script\'s id.' }],
        example: { request: `GET ${DX}/scripts/1/profile\n${AUTH}`, status: 200, response: j({ profile: null, recording: true }) },
        notes: 'profile is null until the script has run; then it is shaped as in the POST below. recording says whether the server is timing scripts. ' +
          'Steps changed or moved since they were timed are left out and counted in changed. No such script: 404, code 104.',
      },
      {
        method: 'POST',
        path: `${D}/scripts/{id}/profile`,
        summary: 'Profile a run: runs the script once with a test case\'s inputs, offline on a throwaway copy, and returns that run\'s step timings and how it ended.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'number', required: true, description: 'The script\'s id.' },
          { name: 'given', in: 'body', type: 'object', description: 'The inputs, as a test case\'s given (parameter, layout, find, record, globals, ai).' },
        ],
        example: {
          request: `POST ${DX}/scripts/1/profile\n${AUTH}\nContent-Type: application/json\n\n${j({ given: {} })}`,
          status: 200,
          response: j({
            profile: {
              since: '2026-10-13T00:09:08.564Z', runs: 1, totalMs: 1.23, averageMs: 1.23, maxMs: 1.23, errors: 0, lastRun: '2026-10-13T00:09:08.566Z',
              steps: [
                { index: 0, line: 'Set Field [ Items::Status ; "done" ]', count: 1, perRun: 1, totalMs: 0.26, averageMs: 0.26, maxMs: 0.26, errors: 0, at: 1 },
                { index: 1, line: 'Exit Script [ Result: "ok" ]', count: 1, perRun: 1, totalMs: 0.08, averageMs: 0.08, maxMs: 0.08, errors: 0, at: 2 },
              ],
              changed: 0,
            },
            ended: ENDED,
          }),
        },
        notes: 'at is the step\'s first line in the script text. Inputs that don\'t check out (a parameter over 20,000 characters, say) or a run that can\'t be set up: 400, code 960. ' +
          'No such script: 404, code 104. Methods other than GET and POST: 400, code 960.',
      },
      {
        method: 'POST',
        path: `${D}/scripts/dry-run`,
        summary: 'A dry run of a script that is not saved yet (a recorded macro): adds the steps to a throwaway copy as a new script, runs it once and returns what it would change.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'text', in: 'body', type: 'string', required: true, description: 'The script\'s steps as text (up to 200,000 characters).' },
          { name: 'given', in: 'body', type: 'object', description: 'The inputs, as a test case\'s given.' },
        ],
        example: {
          request: `POST ${DX}/scripts/dry-run\n${AUTH}\nContent-Type: application/json\n\n${j({ text: SCRIPT_TEXT, given: {} })}`,
          status: 200,
          response: j({
            ended: ENDED,
            changes: { records: [{ table: 'Items', recordId: 1, kind: 'update', fields: [{ field: 'Status', before: 'open', after: 'done' }] }], more: 0, truncated: [] },
          }),
        },
        notes: 'The reply is shaped as for …/scripts/{id}/dry-run. Nothing is saved: the file itself never gets the script. A text that is missing, not a string, over the limit, or that does not parse: 400, code 960, saying why; inputs that do not check out: 400, code 960. Only POST.',
      },
      {
        method: 'GET, POST',
        path: `${D}/scripts/{id}/refactor`,
        summary: 'Where a script could be simpler or faster: dead branches, steps that cannot run, repeated steps, loops that find or commit on every record, and slow steps.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'number', required: true, description: 'The script\'s id.' },
          { name: 'text', in: 'body', type: 'string', description: 'POST, required: the steps as the script editor has them open, as text.' },
        ],
        example: {
          request: `POST ${DX}/scripts/1/refactor\n${AUTH}\nContent-Type: application/json\n\n${j({ text: SCRIPT_TEXT })}`,
          status: 200,
          response: j({ hints: [{ kind: 'repeated', line: 1, endLine: 3, message: 'Three Set Field steps in a row set the same field.', fix: 'Keep the last one.' }], timed: false }),
        },
        notes: 'Each hint is {kind, line, endLine, message, fix}, with the lines counted in the script\'s text from 1; kind is dead-branch, unreachable, repeated, same-as-script, record-loop, find-in-loop, commit-in-loop, slow-step or disabled. ' +
          'timed says whether the server\'s own step timings were used (slow-step hints): GET uses them for the saved script, POST only while the text is still the saved script. A POST without text is 400, code 960; text that does not parse is 400, code 960. No such script: 404, code 104. Other methods are 405.',
      },
      {
        method: 'POST',
        path: `${D}/scripts/{id}/compare`,
        summary: 'Proves a drafted version of a script does what the script does: runs both, offline on a throwaway copy, from each saved test case\'s inputs and from where buttons start it, then runs the saved test cases against the draft.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'number', required: true, description: 'The script\'s id.' },
          { name: 'text', in: 'body', type: 'string', required: true, description: 'The drafted steps as text (up to 200,000 characters).' },
          { name: 'base', in: 'body', type: 'string', description: 'The steps the editor has open, when they are not saved yet: compared against instead of the saved script.' },
        ],
        example: {
          request: `POST ${DX}/scripts/1/compare\n${AUTH}\nContent-Type: application/json\n\n${j({ text: SCRIPT_TEXT })}`,
          status: 200,
          response: j({ cases: [{ name: 'finishes', same: true, differences: [] }, { name: 'a plain run', same: true, differences: [] }], tests: [{ id: TEST.id, name: 'finishes', script: 'Finish', passed: true, failures: [], steps: 2, ms: 4 }], equal: true }),
        },
        notes: 'Up to 10 cases are compared. A case is the same when the script and the draft end the same way (result, error, found count, layout, mode, variables, global fields, what they ask the client to do) and change the same records (fields the clock fills in are ignored); differences lists [{what, expected, actual}]. ' +
          'A case that cannot run, or changed more records than can be compared, proves nothing and counts as different. equal is true when every case is the same and every saved test case that passed before passes with the draft. Nothing on the real file changes. A missing or oversized text: 400, code 960. No such script: 404, code 104. Only POST.',
      },
      {
        method: 'GET',
        path: `${D}/scripts/{id}/dependencies`,
        summary: 'A script\'s dependency map: what its steps use, what starts it, and how it reaches outside the solution.',
        permissions: DESIGN_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'number', required: true, description: 'The script\'s id.' }],
        example: {
          request: `GET ${DX}/scripts/1/dependencies\n${AUTH}`,
          status: 200,
          response: j({
            script: 'Finish',
            uses: [{ kind: 'field', name: 'Items::Status', lines: [1] }],
            startedBy: [{ how: 'button', name: 'a button on layout "Items"' }],
            outbound: [],
          }),
        },
        notes: 'uses lists fields, layouts, scripts, value lists and custom functions, each with the script lines that use it; byName: true marks a use found in text (GetField, ExecuteSQL, Evaluate, "by name" steps) that a rename would not reach. ' +
          'startedBy is {how: script | button | trigger, name}. outbound names how it reaches outside (mail, network, other apps, plug-in functions). No such script: 404, code 104. Only GET.',
      },
      {
        method: 'POST',
        path: `${D}/scripts/{id}/dry-run`,
        summary: 'A dry run: runs the script once, offline on a throwaway copy, and returns exactly which records it would create, change or delete, each field before and after.',
        permissions: DESIGN_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'number', required: true, description: 'The script\'s id.' },
          { name: 'given', in: 'body', type: 'object', description: 'The inputs, as a test case\'s given.' },
          { name: 'text', in: 'body', type: 'string', description: 'The script\'s steps as text, run in place of the saved ones on the copy (a draft not saved yet).' },
        ],
        example: {
          request: `POST ${DX}/scripts/1/dry-run\n${AUTH}\nContent-Type: application/json\n\n${j({ given: {} })}`,
          status: 200,
          response: j({
            ended: ENDED,
            changes: { records: [{ table: 'Items', recordId: 1, kind: 'update', fields: [{ field: 'Status', before: 'open', after: 'done' }] }], more: 0, truncated: [] },
          }),
        },
        notes: 'Each record is listed once, from what it was to what it ends as; the first 200 are listed and more counts the rest. truncated lists tables Truncate Table emptied. ' +
          'incomplete: true means the run changed so much that only its earliest changes were read. message gives the line a script stopped on with an error. ' +
          'Values are cut at 2,000 characters. No such script: 404, code 104; bad inputs: 400, code 960. Only POST. With text (up to 200,000 characters) the copy\'s script is those steps first, to dry-run a draft that is not saved yet; text that is not a string is 400, code 960.',
      },
    ],
  },
  {
    id: 'debug',
    title: 'Script debugger and Data Viewer',
    sources: ['debug.ts'],
    intro: 'The web client\'s script debugger and Data Viewer, at /tabularius/debug/v1/databases/{database}. It signs in with the Data API\'s session tokens and, as in FileMaker, ' +
      'needs [Full Access]. A debugging run belongs to the session that started it (other sessions get 404) and works, unless sent "scratch": false, on a throwaway copy of ' +
      'the file, offline (no network, mail or plug-ins), with the session\'s account and globals; starting and stepping answer when the script next pauses or finishes. ' +
      'A run nobody touches for 10 minutes, or whose session has ended, is halted. ' + ERRORS,
    anchors: [String.raw`/^\/tabularius\/debug\/v1\/databases\/([^/]+)\/(scripts|runs|evaluate|current|recordings)(?:\/([0-9a-f]+)(?:\/(\w+))?)?$/.exec(`],
    routes: [
      {
        method: 'GET',
        path: `${G}/scripts`,
        summary: 'The file\'s scripts and their steps as text lines, with the Scripts menu\'s order (folders and separators).',
        permissions: DEBUG_PERM,
        params: [DB],
        example: {
          request: `GET ${GX}/scripts\n${AUTH}`,
          status: 200,
          response: j({
            scripts: [{ id: 1, name: 'Finish', steps: [{ line: 'Set Field [ Items::Status ; "done" ]', enabled: true }, { line: 'Exit Script [ Result: "ok" ]', enabled: true }] }],
            order: [],
          }),
        },
        notes: 'order is left out when the file has no script order. Other methods are 405.',
      },
      {
        method: 'POST',
        path: `${G}/runs`,
        summary: 'Starts a script in the debugger and answers when it first pauses (at its first step, by default) or finishes.',
        permissions: DEBUG_PERM,
        params: [
          DB,
          { name: 'script', in: 'body', type: 'string', required: true, description: 'The script\'s name.' },
          { name: 'parameter', in: 'body', type: 'string', description: 'The script parameter.' },
          { name: 'layout', in: 'body', type: 'string', description: 'The layout it starts on.' },
          { name: 'foundSet', in: 'body', type: 'array of number', description: 'Record ids of the starting found set.' },
          { name: 'recordId', in: 'body', type: 'number', description: 'The current record.' },
          { name: 'breakpoints', in: 'body', type: 'array of object', description: '[{"script": name, "index": step position}].' },
          { name: 'pauseAtStart', in: 'body', type: 'boolean', description: 'Pause at the first step (default true).' },
          { name: 'pauseOnError', in: 'body', type: 'boolean', description: 'Pause after a step that sets an error (default false).' },
          { name: 'scratch', in: 'body', type: 'boolean', description: 'false runs it on the hosted file, as the session\'s scripts otherwise run; default true (a throwaway copy, offline).' },
        ],
        example: {
          request: `POST ${GX}/runs\n${AUTH}\nContent-Type: application/json\n\n${j({ script: 'Finish', layout: 'Items', pauseAtStart: true })}`,
          status: 201,
          response: j({ ...RUN, paused: PAUSED }),
        },
        notes: 'Once it has finished the run has done (how it ended: result, error, halted, layout, found set …) instead of paused. A script that can\'t start ' +
          '(no such script) comes back as a run with error: {code: 104, message}. A file over 1 GB can\'t be copied for a scratch run: 400, code 960.',
      },
      {
        method: 'GET',
        path: `${G}/runs`,
        summary: 'This session\'s debugging runs on this file, each where it waits or how it ended (the Data Viewer follows a paused one).',
        permissions: DEBUG_PERM,
        params: [DB],
        example: { request: `GET ${GX}/runs\n${AUTH}`, status: 200, response: j({ runs: [{ ...RUN, paused: PAUSED }] }) },
      },
      {
        method: 'GET',
        path: `${G}/runs/{id}`,
        summary: 'One run: where it waits, with its variables, or how it ended.',
        permissions: DEBUG_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'string', required: true, description: 'The run\'s id (hex).' }],
        example: { request: `GET ${GX}/runs/2adfd56e269493d4\n${AUTH}`, status: 200, response: j({ ...RUN, paused: PAUSED }) },
        notes: 'A run that isn\'t there, or belongs to another session: 404, code 101 ("No such debugging run").',
      },
      {
        method: 'POST',
        path: `${G}/runs/{id}/{command}`,
        summary: 'Step Into, Step Over, Step Out, Continue or Halt, and answers when the script next pauses or finishes.',
        permissions: DEBUG_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The run\'s id.' },
          { name: 'command', in: 'path', type: 'string', required: true, description: 'into, over, out, continue or halt.' },
        ],
        example: {
          request: `POST ${GX}/runs/2adfd56e269493d4/continue\n${AUTH}`,
          status: 200,
          response: j({ ...RUN, done: DONE }),
        },
        notes: 'On a run that has finished it just returns the run. While the script is running and not paused: 409, code 3 ("The script is running; wait for it to pause").',
      },
      {
        method: 'POST',
        path: `${G}/runs/{id}/next`,
        summary: 'Set Next Step: moves the paused script to another step of the same script without running the ones between.',
        permissions: DEBUG_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The run\'s id.' },
          { name: 'index', in: 'body', type: 'number', required: true, description: 'The step position to run next.' },
        ],
        example: {
          request: `POST ${GX}/runs/2adfd56e269493d4/next\n${AUTH}\nContent-Type: application/json\n\n${j({ index: 0 })}`,
          status: 200,
          response: j({ ...RUN, paused: { ...PAUSED, index: 1, line: 'Exit Script [ Result: "ok" ]', stack: [{ script: 'Finish', index: 1 }] } }),
        },
        notes: 'Not paused: 409, code 3 ("The script is not paused"). A step that isn\'t there: 400, code 960.',
      },
      {
        method: 'PUT',
        path: `${G}/runs/{id}/breakpoints`,
        summary: 'Replaces the run\'s breakpoints.',
        permissions: DEBUG_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The run\'s id.' },
          { name: 'breakpoints', in: 'body', type: 'array of object', required: true, description: '[{"script": name, "index": step position}]; anything else in the list is dropped.' },
        ],
        example: {
          request: `PUT ${GX}/runs/2adfd56e269493d4/breakpoints\n${AUTH}\nContent-Type: application/json\n\n${j({ breakpoints: [{ script: 'Finish', index: 0 }] })}`,
          status: 200,
          response: j({ ...RUN, breakpoints: [{ script: 'Finish', index: 0 }], paused: PAUSED }),
        },
      },
      {
        method: 'PUT',
        path: `${G}/runs/{id}/options`,
        summary: 'Turns Pause on error on or off for the run.',
        permissions: DEBUG_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The run\'s id.' },
          { name: 'pauseOnError', in: 'body', type: 'boolean', description: 'Pause after a step that sets an error.' },
        ],
        example: {
          request: `PUT ${GX}/runs/2adfd56e269493d4/options\n${AUTH}\nContent-Type: application/json\n\n${j({ pauseOnError: true })}`,
          status: 200,
          response: j({ ...RUN, pauseOnError: true, paused: PAUSED }),
        },
      },
      {
        method: 'POST',
        path: `${G}/runs/{id}/evaluate`,
        summary: 'The Data Viewer while paused: a formula\'s value where the script waits, with its local and global variables.',
        permissions: DEBUG_PERM,
        params: [
          DB,
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The run\'s id.' },
          { name: 'formula', in: 'body', type: 'string', required: true, description: 'The formula.' },
        ],
        example: {
          request: `POST ${GX}/runs/2adfd56e269493d4/evaluate\n${AUTH}\nContent-Type: application/json\n\n${j({ formula: 'Get ( ScriptName )' })}`,
          status: 200,
          response: j({ value: 'Finish' }),
        },
        notes: 'A formula that fails gives error (its code) and message with the value. Not paused: 409, code 3.',
      },
      {
        method: 'POST',
        path: `${G}/evaluate`,
        summary: 'The Data Viewer without a script: each formula on the record the web client shows, with that window\'s Get ( ) values and the session\'s $$variables.',
        permissions: DEBUG_PERM,
        params: [
          DB,
          { name: 'formulas', in: 'body', type: 'array of string', required: true, description: 'The formulas.' },
          { name: 'layout', in: 'body', type: 'string', required: true, description: 'The layout they run from.' },
          { name: 'recordId', in: 'body', type: 'number', description: 'The record they run on.' },
          { name: 'window', in: 'body', type: 'object', description: 'What the window shows, for Get ( ): {mode, view, foundCount, totalCount, number}.' },
        ],
        example: {
          request: `POST ${GX}/evaluate\n${AUTH}\nContent-Type: application/json\n\n${j({ layout: 'Items', recordId: 1, formulas: ['Items::Name', 'Nonsense ( 1 )'] })}`,
          status: 200,
          response: j({ results: [{ value: 'Lamp', type: 'text' }, { value: '?', error: 1207, message: 'The function "Nonsense" cannot be found' }] }),
        },
        notes: 'Let ( $$name = … ) sets the session\'s variable, as FileMaker\'s Data Viewer does. No layout: 400, code 105; a layout that isn\'t there: code 105; ' +
          'a record id that isn\'t a whole number: 400, code 101, and a record that is gone: code 101. No formulas list: 400, code 960.',
      },
      {
        method: 'GET',
        path: `${G}/current`,
        summary: 'The Data Viewer\'s Current tab: the record\'s fields and the session\'s $$variables.',
        permissions: DEBUG_PERM,
        params: [
          DB,
          { name: 'layout', in: 'query', type: 'string', required: true, description: 'The layout the web client shows.' },
          { name: 'recordId', in: 'query', type: 'number', description: 'The record it shows.' },
        ],
        example: {
          request: `GET ${GX}/current?layout=Items&recordId=1\n${AUTH}`,
          status: 200,
          response: j({ layout: 'Items', occurrence: 'Items', table: 'Items', recordId: 1, fields: { Name: 'Lamp', Price: 10, Status: 'open' }, variables: {} }),
        },
        notes: 'Without recordId, fields is {}. Errors as for POST /evaluate.',
      },
      {
        method: 'POST',
        path: `${G}/recordings`,
        summary: 'Time travel: runs the script to the end on a throwaway copy, offline, recording each step (where it stood, its variables and found set, what it did to records) for stepping back and forth afterwards.',
        permissions: DEBUG_PERM,
        params: [
          DB,
          { name: 'script', in: 'body', type: 'string', required: true, description: 'The script\'s name.' },
          { name: 'parameter', in: 'body', type: 'string', description: 'The script parameter.' },
          { name: 'layout', in: 'body', type: 'string', description: 'The layout it starts on.' },
          { name: 'foundSet', in: 'body', type: 'array of number', description: 'Record ids of the starting found set.' },
          { name: 'recordId', in: 'body', type: 'number', description: 'The current record.' },
        ],
        example: {
          request: `POST ${GX}/recordings\n${AUTH}\nContent-Type: application/json\n\n${j({ script: 'Finish', layout: 'Items' })}`,
          status: 200,
          response: j({
            script: 'Finish',
            steps: [
              {
                script: 'Finish', index: 0, line: 'Exit Script [ Result: "ok" ]', stack: [{ script: 'Finish', index: 0 }], lastError: 0, layout: 'Items', mode: 'browse',
                foundCount: 1, foundSet: [1], recordId: 1, variables: { locals: {}, globals: {} },
              },
            ],
            done: { result: 'ok', error: 0, halted: false, layout: 'Items', foundCount: 3, recordId: 1, mode: 'browse', steps: 2, foundSet: [1, 2, 3] },
          }),
        },
        notes: 'The session\'s globals are copied for the run, not changed. A file over 1 GB: 400, code 960. Only POST.',
      },
    ],
  },
  {
    id: 'security',
    title: 'Manage Security',
    sources: ['security.ts', 'account-provisioning.ts'],
    intro: 'Accounts, privilege sets, extended privileges, API tokens, two-factor sign-in and approval of AI agents\' proposed changes, at /tabularius/security/v1/databases/{database}. ' +
      'Like design mode it is a GET for the whole picture and a POST of all-or-none changes, signs in with the Data API\'s session tokens, and needs [Full Access]. ' +
      'Most replies carry the whole security picture again (security). ' + ERRORS,
    anchors: [
      String.raw`/^\/tabularius\/security\/v1\/databases\/([^/]+)(?:\/(tokens|migrate|record-rule\/preview|totp\/([^/]+?)(\/confirm)?|pending\/(\d+)\/(approve|reject)))?$/.exec(`,
      String.raw`/^\/tabularius\/security\/v1\/databases\/([^/]+)\/accounts\/import\/(preview|apply)$/.exec(`,
      `sub === 'tokens'`,
      `sub === 'migrate'`,
      `sub === 'record-rule/preview'`,
    ],
    routes: [
      {
        method: 'POST',
        path: `${S}/accounts/import/preview`,
        summary: 'Preview desired local-account assignment and active state from CSV without account or audit writes.',
        permissions: 'An interactive session Authorization: Bearer token bound to this database, active and unexpired, with current Full Access and no owed password change. API tokens (ohbt_) and agent identities are refused. Authorization is checked again after reading the body.',
        params: [DB, { name: 'csv', in: 'body', type: 'string', required: true, description: 'UTF-8 CSV with exactly account,privilegeSet,active columns (any order), with explicit true/false active values. No credential columns.' }],
        example: { request: `POST ${SX}/accounts/import/preview\n${AUTH}\nContent-Type: application/json\n\n${j({ csv: 'account,privilegeSet,active\nClerk,Viewers,true' })}`, status: 200, response: j({ valid: true, rows: [{ row: 2, account: 'Clerk', actions: ['no-op'], before: { privilegeSet: 'Viewers', active: true }, after: { privilegeSet: 'Viewers', active: true }, credentialSetupRequired: false }], errors: [], previewToken: 'signed-preview-binding', expiresAt: '2026-10-14T12:05:00.000Z' }) },
        notes: 'New identities get source Tabularius, a null password hash and must-change enabled; they cannot password-sign-in until separate admin credential setup. Existing credentials and must-change flags are preserved. ' +
          'Rows are CSV record numbers including the header; quoted line breaks do not add record numbers. BOM, CRLF, commas and escaped quotes are supported; malformed quoting is refused. ' +
          'Account matching follows SQLite NOCASE (ASCII only), resolves stored spelling, and rejects duplicate keys, ambiguous existing names and Unicode case variants that JavaScript folds together but SQLite does not. ' +
          'External mappings, agents, bracketed built-in names, surrounding spaces, control characters, formula prefixes (=, +, -, @), unknown privilege sets, self changes (including a session mapping), and Full Access grants are refused. ' +
          'Missing rows have no effect. There is no delete, rename, type conversion or privilege-set creation. Row validation errors return valid:false and no previewToken; structural CSV errors are 400. ' +
          'The signed preview expires after five minutes and binds actor, mapping, database, parsed input digest and account/privilege snapshot. Account metadata only is returned; never credentials. ' +
          'The JSON body and decoded CSV are each limited to 1 MiB, with at most 1,000 rows (413 when exceeded). Names/sets over 256 characters produce row validation errors. Durable SQLite rate counters allow 20 previews and 5 applies per minute per actor/file, plus 60 requests per minute per IP/file before authentication. ' +
          'Four concurrent import requests per serving process are allowed. Throttling returns 429 with Retry-After:60. Rate counters are the only preview-side writes and are shared across processes.',
      },
      {
        method: 'POST',
        path: `${S}/accounts/import/apply`,
        summary: 'Revalidate and apply a previewed CSV in one transaction, with a durable sanitized idempotency receipt.',
        permissions: 'The same interactive Full Access session gate as preview, rechecked on apply and under the transaction. API tokens and owed password changes are refused, including on receipt replay.',
        params: [DB,
          { name: 'csv', in: 'body', type: 'string', required: true, description: 'The same parsed desired-state input used for preview.' },
          { name: 'previewToken', in: 'body', type: 'string', required: true, description: 'The short-lived signed preview binding.' },
          { name: 'idempotencyKey', in: 'body', type: 'string', required: true, description: '1–128 ASCII letters, digits, underscores or hyphens; use a new key for a new operation, retain it for retries.' },
        ],
        example: { request: `POST ${SX}/accounts/import/apply\n${AUTH}\nContent-Type: application/json\n\n${j({ csv: 'account,privilegeSet,active\nClerk,Viewers,true', previewToken: 'signed-preview-binding', idempotencyKey: 'import-20261014-1' })}`, status: 200, response: j({ valid: true, rows: [{ row: 2, account: 'Clerk', actions: ['no-op'], before: { privilegeSet: 'Viewers', active: true }, after: { privilegeSet: 'Viewers', active: true }, credentialSetupRequired: false }], errors: [], batchId: 'c844ae89-d5ab-4218-a421-97934fa5802c' }) },
        notes: 'BEGIN IMMEDIATE covers authorization, snapshot validation, planning, all account API mutations, successful account events, batch summary and receipt. Any failure rolls them back; a separate rejection event records only a reason code. ' +
          'Same key, actor and parsed input returns the original sanitized result after restart, even when the old preview expired. Changed input or actor under that key returns 409. A stale, altered or wrong-file preview returns 409 and requires another preview. ' +
          'Reimporting unchanged desired state with a new key yields no-op rows and no duplicate account-change events. Deactivation keeps the password and passkeys, ends sessions and deletes the API tokens of the account after commit; inactive accounts cannot authenticate by password, passkey or API token. Reactivation does not bring tokens or sessions back; the account signs in again and creates new tokens. ' +
          'Deletion, demotion and deactivation share a store guard under the write lock: keep an active local non-agent Full Access account with a working password credential or passkey. Imported verifiers that cannot authenticate do not qualify. Recovery administrators must have unambiguous sign-in names and all MFA required by account or file policy enrolled (confirmed TOTP or a registered passkey); pending enrollment is insufficient. These checks include accounts absent from the CSV. Inactive accounts, external mappings and credential-free placeholders do not count as alternatives. ' +
          'CSV account events record the actor, batch ID, source csv, target, row and before/after state. Responses and receipts contain no passwords, credential hashes or authentication tokens. Credential setup uses the separate admin password-reset flow with must-change enabled. Same limits as preview; unrecognized JSON fields are refused.',
      },
      {
        method: 'GET',
        path: S,
        summary: 'The whole security picture: accounts, privilege sets, API tokens, pending agent changes, the password policy and two-factor switch, and the lists the privilege pickers choose from.',
        permissions: SECURITY_PERM,
        params: [DB],
        example: { request: `GET ${SX}\n${AUTH}`, status: 200, response: j(SECURITY) },
        notes: 'API tokens are listed without their secrets. fullAccessWithout2fa lists the active full-access accounts with no second factor (what blocks requireTotpForFullAccess). ' +
          'extendedPrivileges always includes fmapp, fmwebdirect, fmrest, fmxml and fmmcp.',
      },
      {
        method: 'POST',
        path: S,
        summary: 'Applies a list of security changes, all or none, and returns the new picture.',
        permissions: SECURITY_PERM,
        params: [
          DB,
          {
            name: 'changes', in: 'body', type: 'array of object', required: true,
            description: 'Each one of: setAccount {name, password?, privilegeSet?, mustChange?, localOnly?, require2fa?}, setExternalAccount {name, privilegeSet}, ' +
              'setAgentAccount {name, privilegeSet, needsApproval?}, deleteAccount {name}, savePrivilegeSet {set}, deletePrivilegeSet {name}, setPasswordPolicy {policy}, ' +
              'setRequireTotpForFullAccess {on}, disableTotp {account}, revokeApiToken {id}.',
          },
        ],
        example: {
          request: `POST ${SX}\n${AUTH}\nContent-Type: application/json\n\n${j({ changes: [
            { op: 'savePrivilegeSet', set: { name: 'Sales', records: { view: true, edit: true, create: true, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] } },
            { op: 'setAccount', name: 'rep', password: 'secret', privilegeSet: 'Sales' },
          ] })}`,
          status: 200,
          response: j(SECURITY),
        },
        notes: 'No changes list: 400, code 960. A change that fails (a set still in use, the last full-access account, a set that doesn\'t exist) rolls back the whole list: 400 with its code and message. ' +
          'An agent account\'s createdBy is always the signed-in account, whatever is sent.',
      },
      {
        method: 'POST',
        path: `${S}/tokens`,
        summary: 'Mints a scoped API token for an account; the token is shown this once.',
        permissions: SECURITY_PERM,
        params: [
          DB,
          { name: 'account', in: 'body', type: 'string', required: true, description: 'The account the token acts as.' },
          { name: 'label', in: 'body', type: 'string', description: 'A label to know it by.' },
          { name: 'readOnly', in: 'body', type: 'boolean', description: 'Only reads: writes and scripts are refused.' },
          { name: 'expiresDays', in: 'body', type: 'number', description: 'Days until it expires; left out, 90 (TABULARIUS_TOKEN_DEFAULT_DAYS changes that); 0 for a token that never expires.' },
          { name: 'surfaces', in: 'body', type: 'array of string', description: 'Only these: fmrest, fmodata, fmxdbc, fmmcp.' },
          { name: 'layouts', in: 'body', type: 'array of string', description: 'Only through these layouts (needs fmrest or fmmcp among the surfaces).' },
        ],
        example: {
          request: `POST ${SX}/tokens\n${AUTH}\nContent-Type: application/json\n\n${j({ account: 'rep', label: 'Reporting', readOnly: true, expiresDays: 30 })}`,
          status: 200,
          response: j({ token: 'ohbt_c8c2acd14cd4.nW3V45n0O6qKp5C8D7ZOs6GHGPEjjz4z', security: { ...SECURITY, apiTokens: [TOKEN_ROW] } }),
        },
        notes: 'No account: 400, code 960 ("account is required"). An account, surface or layout that isn\'t there: 400, code 960.',
      },
      {
        method: 'POST',
        path: `${S}/migrate`,
        summary: 'First sign-in for a converted file: gives each account still on the file\'s own password (or the ones named) a temporary password it must change, and returns them this once.',
        permissions: SECURITY_PERM,
        params: [DB, { name: 'accounts', in: 'body', type: 'array of string', description: 'Only these accounts; the body may be left out.' }],
        example: {
          request: `POST ${SX}/migrate\n${AUTH}`,
          status: 200,
          response: j({ migrated: [{ account: 'Clerk', password: 'q3V9xM2bTn7LwR4kPz8sYcA1' }], security: SECURITY }),
        },
        notes: 'Names and privilege sets stay as they are. A named account that isn\'t waiting (it has a password, is external, or isn\'t there): 400, code 960.',
      },
      {
        method: 'POST',
        path: `${S}/record-rule/preview`,
        summary: 'Tries a limited-access record rule before saving it: whether it works, which sample records it allows, and how many of the table it allows.',
        permissions: SECURITY_PERM,
        params: [
          DB,
          { name: 'table', in: 'body', type: 'string', required: true, description: 'The base table.' },
          { name: 'rule', in: 'body', type: 'string', required: true, description: 'The rule\'s formula.' },
          { name: 'account', in: 'body', type: 'string', description: 'The account it is evaluated as (Get ( AccountName )).' },
          { name: 'limit', in: 'body', type: 'number', description: 'Sample records (default 10, at most 200).' },
        ],
        example: {
          request: `POST ${SX}/record-rule/preview\n${AUTH}\nContent-Type: application/json\n\n${j({ table: 'Items', rule: 'Status = "open"', limit: 2 })}`,
          status: 200,
          response: j({ table: 'Items', rule: 'Status = "open"', account: '', valid: true, total: 3, allowed: 3, samples: [{ recordId: 1, allowed: true, label: 'Lamp' }, { recordId: 2, allowed: true, label: 'Desk' }] }),
        },
        notes: 'A rule that fails on every sample (or doesn\'t compile, on an empty table) gives valid: false and error, and no allowed count; a row it fails on counts as not allowed. ' +
          'No table or rule: 400, code 960. A table that isn\'t there: 400, code 100.',
      },
      {
        method: 'POST',
        path: `${S}/totp/{account}`,
        summary: 'Starts a second factor for an account: a new secret and its otpauth:// URI to show as a QR code, pending until confirmed.',
        permissions: SECURITY_PERM,
        params: [DB, { name: 'account', in: 'path', type: 'string', required: true, description: 'The account (URL-encoded).' }],
        example: {
          request: `POST ${SX}/totp/rep\n${AUTH}`,
          status: 200,
          response: j({
            secret: 'D76QXXQHBJJAHQSE4RPZVGB5UEO3VWWB',
            uri: 'otpauth://totp/tabularius%3Arep?secret=D76QXXQHBJJAHQSE4RPZVGB5UEO3VWWB&issuer=tabularius&algorithm=SHA1&digits=6&period=30',
            security: SECURITY,
          }),
        },
        notes: 'The account\'s hasTotp stays false until a code is confirmed. An account that isn\'t there: 400, code 960.',
      },
      {
        method: 'POST',
        path: `${S}/totp/{account}/confirm`,
        summary: 'Confirms a pending second factor with a code from the authenticator app.',
        permissions: SECURITY_PERM,
        params: [
          DB,
          { name: 'account', in: 'path', type: 'string', required: true, description: 'The account.' },
          { name: 'code', in: 'body', type: 'string', required: true, description: 'The six-digit code.' },
        ],
        example: {
          request: `POST ${SX}/totp/rep/confirm\n${AUTH}\nContent-Type: application/json\n\n${j({ code: '123456' })}`,
          status: 200,
          response: j({
            confirmed: true,
            security: { ...SECURITY, accounts: [SECURITY.accounts[0], { ...SECURITY.accounts[1], hasTotp: true }] },
          }),
        },
        notes: 'A wrong code, or no pending factor: 400 with {"confirmed": false, "security": {…}}.',
      },
      {
        method: 'POST',
        path: `${S}/pending/{id}/approve`,
        summary: 'Approves an approval-gated AI agent\'s proposed record change: it is applied as the agent, with the agent\'s own privileges.',
        permissions: SECURITY_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'number', required: true, description: 'The pending change\'s id (from pendingChanges).' }],
        example: {
          request: `POST ${SX}/pending/1/approve\n${AUTH}`,
          status: 200,
          response: j({ recordId: 4, security: SECURITY }),
        },
        notes: 'recordId is the record made when the change was a create. The approval is logged against the signed-in account. ' +
          'No such pending change: 400, code 960 ("No pending change …"); a change the agent may not make fails with its own code.',
      },
      {
        method: 'POST',
        path: `${S}/pending/{id}/reject`,
        summary: 'Rejects an AI agent\'s proposed change: it is discarded without being applied.',
        permissions: SECURITY_PERM,
        params: [DB, { name: 'id', in: 'path', type: 'number', required: true, description: 'The pending change\'s id.' }],
        example: { request: `POST ${SX}/pending/1/reject\n${AUTH}`, status: 200, response: j({ rejected: true, security: SECURITY }) },
        notes: 'No such pending change: 404 with {"rejected": false, "security": {…}}.',
      },
    ],
  },
];
