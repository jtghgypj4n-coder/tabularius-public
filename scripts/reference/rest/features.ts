import type { RestGroup } from '../types.ts';

// Shared wording: every route here signs in the way the Data API does.
const SIGN_IN = 'A Data API session token (Authorization: Bearer, or X-FM-Data-Access-Token) for this file, from a Data API or web client sign-in, ' +
  'or a scoped API token (ohbt_…) for this file allowed Data API access (fmrest). The account\'s privilege set needs fmrest (fmapp or fmwebdirect for a web client session)';

const TOTAL = { title: 'Revenue this year', kind: 'number', layout: 'Invoices', query: [{ Date: 'this year' }], measure: { field: 'Amount', fn: 'sum' } };
const TOTAL_DATA = {
  title: 'Revenue this year', kind: 'number', layout: 'Invoices', find: ['Find Date this year (2026-01-01...2026-12-31)'], grouping: 'Sum of Amount',
  foundCount: 42, value: 7800,
};
const AUTOMATION = {
  name: 'Invoice paid', enabled: true, layout: 'Invoices', on: 'update', fields: ['Status'], condition: 'Status = "Paid"', script: 'Mark invoice paid',
  account: 'Admin', id: '3f9a1c0b7d2e', created: '2026-10-12T09:15:02.114Z', updated: '2026-10-12T09:15:02.114Z', createdBy: 'Admin',
  trigger: 'When a record in Invoices is changed, and the change is to Status, if Status = "Paid": run "Mark invoice paid" on that record (from layout Invoices) as Admin',
};
const DIGEST = {
  id: '8c41d07e2a95', name: 'Weekly revenue', dashboard: '5be0a7c3d11f', days: [1], at: '08:00', prompt: 'new and overdue invoices', enabled: true,
  account: 'Admin', created: '2026-10-12T09:20:00.000Z', updated: '2026-10-12T09:20:00.000Z',
  schedule: 'Mondays at 08:00', dashboardName: 'Sales', next: '2026-10-19T08:00:00.000Z', canChange: true,
};
const RUN = {
  id: 'a1b2c3d4e5f6', digest: '8c41d07e2a95', at: '2026-10-13T10:02:11.402Z', outcome: 'ok',
  highlights: ['Revenue this year: 7,800'], data: [TOTAL_DATA], ms: 2140,
  summaryNote: 'No AI summary: the assistant is off on this server (start it with --ai)',
};

export const groups: RestGroup[] = [
  {
    id: 'assistant',
    title: 'AI assistant',
    sources: ['assistant.ts'],
    intro: 'The web client\'s and design mode\'s AI assistant, at /tabularius/assistant/v1/databases/{database}. It signs in with the same session tokens as the Data API, ' +
      'and answers as the signed-in account: the model reads the file only through the MCP tools, run in-process with that account\'s privileges. ' +
      'It is off unless the server was started with an API key (tabularius serve --ai, key in ANTHROPIC_API_KEY). Errors come back as {"error": {"code", "message"}}; ' +
      'a missing or expired token is 401 with code 952, and a file that isn\'t hosted is 404 with code 802.',
    anchors: [String.raw`/^\/tabularius\/assistant\/v1\/databases\/([^/]+)(\/handover|\/connections(?:\/([A-Za-z][A-Za-z0-9_-]*)(?:\/(test|approve|secrets\/[A-Za-z][A-Za-z0-9]*))?)?)?$/.exec(`],
    routes: [
      {
        method: 'GET',
        path: '/tabularius/assistant/v1/databases/{database}',
        summary: 'Whether the assistant can be used on this file by this account, which models answer, and what it may do.',
        permissions: `${SIGN_IN}. Nothing else is checked: an account without fmmcp, or a file with AI turned off, gets available: false.`,
        params: [{ name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' }],
        example: {
          request: 'GET /tabularius/assistant/v1/databases/Invoices\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ available: true, model: 'claude-opus-5-5', price: { input: 4, output: 20 }, fastModel: 'claude-haiku-5-5', canDesign: false, canExplainScripts: false }, null, 2),
        },
        notes: 'available is true only when the server has an API key, the privilege set has fmmcp and AI is not turned off for the file (or for a file it uses); ' +
          'aiOff: true is added when AI is turned off. price is the model\'s list price in US dollars per million tokens, left out for a model without one. fastModel is left out when the fast model is set to off. canDesign is [Full Access]; ' +
          'canExplainScripts is [Full Access], or a set that can modify scripts and reads everything. [Full Access] also gets usageToday {tokens, limit?} for the server ' +
          'and usageMonth {month, tokens, costUsd, questions, unpriced, budgetUsd?} for the month so far (UTC), ' +
          'and when the server has a per-account daily token limit, an account that can use the assistant gets accountUsageToday {tokens, limit}.',
      },
      {
        method: 'POST',
        path: '/tabularius/assistant/v1/databases/{database}',
        summary: 'Asks the assistant a question about the file; the answer comes back whole, or streamed as JSON lines.',
        permissions: `${SIGN_IN}, and the fmmcp extended privilege (AI access). Refused with 503 (code 3) when the server has no API key, 403 (code 9) when AI is turned off for the file ` +
          'or a file it uses, 401 (code 9) without fmmcp, and 429 (code 3) once the server\'s or the account\'s daily token limit, or the monthly budget, is used. ' +
          'The assistant only reads: design tools are offered to [Full Access] only, and design changes come back as proposals, never applied. The model is given a masked field\'s stand-in, never its value, and a chart by a masked field is refused.',
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'Accept', in: 'header', type: 'string', description: 'application/x-ndjson streams the answer as one JSON object per line; anything else gets one JSON reply.' },
          { name: 'messages', in: 'body', type: 'array of object', required: true, description: 'The conversation so far, [{role: "user" | "assistant", content}], ending with the user\'s question. Other roles and empty messages are dropped; long histories are cut to the latest messages.' },
          { name: 'context', in: 'body', type: 'object', description: 'What the window is looking at: layout, recordId, field, mode (browse, find, design, debug, security, viewer), foundSet, design, security, debug, draft, failure.' },
          { name: 'image', in: 'body', type: 'object', description: '{mediaType, data}: a picture to design a layout from. mediaType is image/png, image/jpeg, image/gif or image/webp; data is the picture in base64, up to about 3.7 MB. Only accounts with [Full Access] may send one (401, code 9, otherwise); a bad type or data is 400 (code 5), a picture too big 413.' },
        ],
        example: {
          request: 'POST /tabularius/assistant/v1/databases/Invoices\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' +
            JSON.stringify({ messages: [{ role: 'user', content: 'How many invoices are open?' }], context: { layout: 'Invoices', recordId: 3, mode: 'browse' } }, null, 2),
          status: 200,
          response: JSON.stringify({
            reply: 'There are 12 open invoices.', proposals: [], foundSets: [], drafts: [], charts: [], dashboards: [], cleanups: [], automations: [],
            tools: ['summarize_records'], usage: { inputTokens: 5120, cachedTokens: 4800, cacheWriteTokens: 0, outputTokens: 42, costUsd: 0.0021 },
            model: 'claude-haiku-5-5', ms: 1830,
          }, null, 2),
          skipReason: 'Requires an external AI provider API key and a model response.',
        },
        notes: 'With Accept: application/x-ndjson the reply is a stream (content-type application/x-ndjson), one JSON object per line: {"step": "Looking at layout \\"Invoices\\""} ' +
          'for each tool used, {"tool": {"id", "name", "label", "args", "result", "resultLength", "error"?}} once the tool has answered (its arguments with secrets hidden and long values cut, the start of the result on one line with secrets hidden; both for the person to read, not for scripts to rely on), ' +
          '{"text": "…"} for pieces of the reply as the model writes them, then {"done": <the object above>}, or {"error": {"code", "message", "status"}} if it fails after the stream started (status is the HTTP status the failure would have had). ' +
          'Closing the connection stops the work. Messages not ending with a user question are 400 (code 5, "Send messages ending with the user\'s question"); ' +
          'a failure reaching the model is 502 (code -1). usage.costUsd is there only when every model used has a known price. ' +
          'plans is there when the assistant planned a task of several steps: [{plan, lines}], each plan to be run with the agent routes (see Agent mode). ' +
          'connections is there when the assistant drafted a connection to an outside service: [{name}], one per draft, for the web client to show a card (see the connection routes below); the draft\'s settings and secrets are not in the answer.',
      },
      {
        method: 'POST',
        path: '/tabularius/assistant/v1/databases/{database}/handover',
        summary: 'A handover memo for whoever takes the solution over, written from the file\'s design alone, as a Markdown or HTML download. Given a memo in the body, it only packages that text for download.',
        permissions: `${SIGN_IN}, and [Full Access], because the design is read in full: any other account gets 403 (code 9). Any method but POST is 405 (code 3). ` +
          'Writing the memo needs the same as a question to the assistant: 503 (code 3) when the server has no API key, 403 (code 9) when AI is turned off for the file, ' +
          '401 (code 9) without fmmcp, and 429 (code 3) once a daily limit or the monthly budget is used. None of that applies when the body brings its own memo.',
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'format', in: 'query', type: 'string', description: 'html for a self-contained page; anything else gives Markdown.' },
          { name: 'memo', in: 'body', type: 'string', description: 'A memo already written (up to 200,000 characters): it is given back as the download, and no model is called. Without it, the model writes one from the design.' },
          { name: 'scripts', in: 'body', type: 'boolean', description: 'true to add plain-words documentation of every script (what starts it and what it does), written by the model from the script steps with secrets hidden. Takes more model calls.' },
        ],
        example: {
          request: 'POST /tabularius/assistant/v1/databases/Invoices/handover?format=html\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' + JSON.stringify({ scripts: false }, null, 2),
          status: 200,
          response: '(text/html, Content-Disposition: attachment; filename="Invoices_handover.html": the memo as a page, sent with a Content-Security-Policy that allows no scripts. With Markdown it is text/markdown and Invoices_handover.md, starting "# Invoices: handover")',
          skipReason: 'Requires an external AI provider API key and a model response.',
        },
        notes: 'The memo is built from the design only (tables, fields, relationships, scripts, layouts, privilege sets), never from record data, and secrets are hidden before the model sees it. ' +
          'Closing the connection stops the work. Errors, unlike the download, are JSON {"error": {"code", "message"}}.',
      },
      {
        method: 'GET',
        path: '/tabularius/assistant/v1/databases/{database}/connections/{name}',
        summary: 'An AI-drafted connection for this file, as the card under the assistant\'s answer shows it: its settings, every place the keys would go (scheme, host and port: an OAuth 2 token address counts), which secrets are set (never their values) and the last test.',
        permissions: `${SIGN_IN} as a person at the web client (sent with X-Tabularius-Client: web) and [Full Access]: a Data API sign-in, an API token (ohbt_…), an AI agent account or an account owing a password change gets 403 (code 9), as does a non-Full-Access account. Only a connection the AI drafted for this very file is reachable: any other name, a connection a person made in the console or one for other files is 404 (code 3), as is any connection of a capture-only file. ` +
          'allowed says whether this server lets the person finish the draft here: it is true only on a server started with --allow-app-connections.',
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'name', in: 'path', type: 'string', required: true, description: 'The connection\'s name, as the assistant\'s answer gave it.' },
        ],
        example: {
          request: 'GET /tabularius/assistant/v1/databases/Invoices/connections/invoices-bucket\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({
            allowed: true,
            connection: {
              name: 'invoices-bucket', type: 'S3-compatible storage', status: 'draft', note: 'Scanned invoices',
              settings: [{ label: 'Bucket', value: 'acme-invoices' }, { label: 'Region', value: 'us-east-1' }], reaches: ['https://s3.us-east-1.amazonaws.com'],
              secrets: [{ name: 'accessKey', label: 'Access key ID', required: true, set: false }, { name: 'secretKey', label: 'Secret access key', required: true, set: false }, { name: 'sessionToken', label: 'Session token', required: false, set: false }],
              ready: false,
            },
          }, null, 2),
          skipReason: 'Requires an AI-drafted connection and a signed-in web client.',
        },
        notes: 'status is draft, active or disabled; lastTest {ok, message} is there once it was tested. The steps below are refused with 403 (code 9) when allowed is false, and with 409 (code 3) once the connection is approved: later changes are the console\'s.',
      },
      {
        method: 'PUT',
        path: '/tabularius/assistant/v1/databases/{database}/connections/{name}/secrets/{field}',
        summary: 'Types one secret of the draft (an access key, say). It goes straight into the server\'s sealed store; DELETE on the same path clears it.',
        permissions: `${SIGN_IN}, [Full Access], an AI draft for this file, and a server started with --allow-app-connections. The same checks as the admin console: the field must be one the connection\'s type uses with its settings, one line of at most 4096 characters.`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'name', in: 'path', type: 'string', required: true, description: 'The connection\'s name.' },
          { name: 'field', in: 'path', type: 'string', required: true, description: 'The secret\'s name from the connection\'s secrets (accessKey, secretKey, …).' },
          { name: 'value', in: 'body', type: 'string', required: true, description: 'The secret, typed by the person. It is never returned, shown again or logged; the server log says only that it was set, by which account.' },
        ],
        example: {
          request: 'PUT /tabularius/assistant/v1/databases/Invoices/connections/invoices-bucket/secrets/accessKey\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' + JSON.stringify({ value: '(typed by the person)' }, null, 2),
          status: 200,
          response: '{"allowed": true, "connection": {…as above, with that secret set: true…}}',
          skipReason: 'Requires an AI-drafted connection and a signed-in web client.',
        },
        notes: 'A bad field or value is 400 (code 3) with the console\'s message.',
      },
      {
        method: 'POST',
        path: '/tabularius/assistant/v1/databases/{database}/connections/{name}/test',
        summary: 'Signs in to the service with the draft\'s secrets and asks something harmless (for S3, a one-object listing), without changing anything.',
        permissions: `${SIGN_IN}, [Full Access], an AI draft for this file, and a server started with --allow-app-connections.`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'name', in: 'path', type: 'string', required: true, description: 'The connection\'s name.' },
        ],
        example: {
          request: 'POST /tabularius/assistant/v1/databases/Invoices/connections/invoices-bucket/test\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: '{"allowed": true, "result": {"ok": true, "message": "Reached bucket acme-invoices; it is empty there. (210 ms)"}, "connection": {…}}',
          skipReason: 'Requires a live S3-compatible service and a signed-in web client.',
        },
        notes: 'A failed test is still 200 with result.ok false and the reason; secrets are masked out of the message. Refused with 403 (code 9) when AI is turned off for the file.',
      },
      {
        method: 'POST',
        path: '/tabularius/assistant/v1/databases/{database}/connections/{name}/approve',
        summary: 'A person\'s go-ahead: the draft becomes usable by scripts of this file, by name.',
        permissions: `${SIGN_IN}, [Full Access], an AI draft for this file, and a server started with --allow-app-connections. Refused with 400 (code 3) until every required secret is set (the console\'s check).`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'name', in: 'path', type: 'string', required: true, description: 'The connection\'s name.' },
        ],
        example: {
          request: 'POST /tabularius/assistant/v1/databases/Invoices/connections/invoices-bucket/approve\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: '{"allowed": true, "connection": {…, "status": "active"}}',
          skipReason: 'Requires an AI-drafted connection and a signed-in web client.',
        },
        notes: 'The server log records the approval with the account. The connection stays limited to this file; turning it off, changing it or widening its files is the admin console\'s.',
      },
      {
        method: 'DELETE',
        path: '/tabularius/assistant/v1/databases/{database}/connections/{name}',
        summary: 'Discards the draft.',
        permissions: `${SIGN_IN}, [Full Access], an AI draft for this file that is not approved yet, and a server started with --allow-app-connections.`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'name', in: 'path', type: 'string', required: true, description: 'The connection\'s name.' },
        ],
        example: {
          request: 'DELETE /tabularius/assistant/v1/databases/Invoices/connections/invoices-bucket\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: '{}',
          skipReason: 'Requires an AI-drafted connection and a signed-in web client.',
        },
      },
    ],
  },
  {
    id: 'automations',
    title: 'Automations',
    sources: ['automations.ts'],
    intro: 'Automations run a script on the server when a table\'s records are created, changed or deleted, whoever made the change. ' +
      'The routes are under /tabularius/automations/v1/databases/{database}, sign in with Data API session tokens, and are for [Full Access] only. ' +
      'Errors come back as {"error": {"code", "message"}}: 401 (code 952) without a valid token, 403 (code 9) without [Full Access], 404 (code 401) for an unknown automation id, ' +
      'and 400 (code 960) for an automation that doesn\'t check out (no such layout, field, script or account, a formula with a problem).',
    anchors: [String.raw`/^\/tabularius\/automations\/v1\/databases\/([^/]+)(?:\/([0-9a-f]{12}))?$/.exec(`],
    routes: [
      {
        method: 'GET',
        path: '/tabularius/automations/v1/databases/{database}',
        summary: 'Lists the file\'s automations, each with its trigger in words and its last 10 runs.',
        permissions: `${SIGN_IN}, and [Full Access].`,
        params: [{ name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' }],
        example: {
          request: 'GET /tabularius/automations/v1/databases/Invoices\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({
            automations: [{ ...AUTOMATION, runs: [{ at: '2026-10-13T08:41:20.031Z', recordId: 17, outcome: 'ok', steps: 4 }] }],
            network: false, outbound: false,
          }, null, 2),
        },
        notes: 'network says whether the server lets scripts reach the network; outbound whether it has outbound mail settings. A run is {at, recordId, outcome (ok, error or skipped), error?, steps?, ms?, message?}.',
      },
      {
        method: 'POST',
        path: '/tabularius/automations/v1/databases/{database}',
        summary: 'Saves a new automation (and writes its script, when one comes with it), or with ?dryRun=1 tries it once on a copy of the file instead.',
        permissions: `${SIGN_IN}, and [Full Access]. A capture-only file (outbound captureOnly) never has automations.`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'dryRun', in: 'query', type: 'string', description: '1 tries the automation once on a throwaway copy of the file, offline, and saves nothing.' },
          { name: 'automation', in: 'body', type: 'object', required: true, description: '{name, description?, enabled? (default true), layout, on (create, update, createOrUpdate or delete; default update), fields?, condition?, script, parameter?, account? (default the signed-in account), network?, replace?}. replace: true overwrites an automation of the same name.' },
          { name: 'script', in: 'body', type: 'object', description: '{name, text}: a script to create (or replace) with the automation; its steps are checked first.' },
          { name: 'test', in: 'body', type: 'object', description: 'Dry run only: field values to set on a record to set it off, e.g. {"Status": "Paid"}.' },
        ],
        example: {
          request: 'POST /tabularius/automations/v1/databases/Invoices\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' +
            JSON.stringify({ automation: { name: 'Invoice paid', layout: 'Invoices', on: 'update', fields: ['Status'], condition: 'Status = "Paid"', script: 'Mark invoice paid' } }, null, 2),
          status: 201,
          response: JSON.stringify({ automation: { ...AUTOMATION, runs: [] }, scriptChanged: false }, null, 2),
        },
        notes: 'With ?dryRun=1 the reply is 200 {automation, trigger, dryRun}, where dryRun is {recordId?, setOff?, conditionTrue?, outcome (ok, error, stalled or skipped), error?, message?, steps?, changes, outbound}: ' +
          'changes lists what the script changed in the copy, outbound the mail and web requests it would have made (none are sent). A file too large to copy is skipped. ' +
          'A name already used, without replace: true, is 400 (code 960).',
      },
      {
        method: 'GET',
        path: '/tabularius/automations/v1/databases/{database}/{id}',
        summary: 'One automation, with its trigger in words and its last 50 runs.',
        permissions: `${SIGN_IN}, and [Full Access].`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The automation\'s id, 12 hex characters.' },
        ],
        example: {
          request: 'GET /tabularius/automations/v1/databases/Invoices/3f9a1c0b7d2e\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ automation: { ...AUTOMATION, runs: [{ at: '2026-10-13T08:41:20.031Z', recordId: 17, outcome: 'ok', steps: 4 }] } }, null, 2),
        },
      },
      {
        method: 'PUT',
        path: '/tabularius/automations/v1/databases/{database}/{id}',
        summary: 'Changes an automation: the fields sent replace its own, and the whole is checked again.',
        permissions: `${SIGN_IN}, and [Full Access].`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The automation\'s id, 12 hex characters.' },
          { name: 'enabled, name, layout, on, fields, condition, script, parameter, account, network, description', in: 'body', type: 'various', description: 'Any of the automation\'s fields; those left out keep their values. The script\'s text can\'t be changed here.' },
        ],
        example: {
          request: 'PUT /tabularius/automations/v1/databases/Invoices/3f9a1c0b7d2e\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' + JSON.stringify({ enabled: false }, null, 2),
          status: 200,
          response: JSON.stringify({ automation: { ...AUTOMATION, enabled: false, updated: '2026-10-13T10:00:00.000Z', runs: [] } }, null, 2),
        },
      },
      {
        method: 'DELETE',
        path: '/tabularius/automations/v1/databases/{database}/{id}',
        summary: 'Deletes an automation and its runs (its script stays).',
        permissions: `${SIGN_IN}, and [Full Access].`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The automation\'s id, 12 hex characters.' },
        ],
        example: {
          request: 'DELETE /tabularius/automations/v1/databases/Invoices/3f9a1c0b7d2e\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ deleted: '3f9a1c0b7d2e' }, null, 2),
        },
      },
    ],
  },
  {
    id: 'cleanup',
    title: 'Data cleanup',
    sources: ['cleanup.ts'],
    intro: 'Finds likely duplicate records, values not in a field\'s value list, and malformed phone numbers and email addresses on a layout, and applies the fixes and merges picked, ' +
      'all or none. The routes are under /tabularius/cleanup/v1/databases/{database} and sign in with Data API session tokens; everything runs as the signed-in account, so its privileges apply ' +
      'and every change goes in the audit log. Errors come back as {"error": {"code", "message"}}: 401 (code 952) without a valid token, 400 (code 960) for a request that can\'t be applied, ' +
      'and 403 when the account may not make a change (store error 200 or 201).',
    anchors: [String.raw`/^\/tabularius\/cleanup\/v1\/databases\/([^/]+)\/(scan|apply|history)(?:\/([0-9a-f]{12})\/undo)?$/.exec(`],
    routes: [
      {
        method: 'POST',
        path: '/tabularius/cleanup/v1/databases/{database}/scan',
        summary: 'Scans a layout\'s records for what looks wrong, with a suggested fix for each; changes nothing.',
        permissions: `${SIGN_IN}. Only records and fields the account can see are scanned: a masked field is not compared or fixed, and an account can\'t merge related records through a key field it cannot read (hidden or masked).`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'layout', in: 'body', type: 'string', required: true, description: 'The layout whose table is scanned.' },
          { name: 'checks', in: 'body', type: 'array of string', description: 'Any of duplicates, valueLists, phones, emails (default all).' },
          { name: 'fields', in: 'body', type: 'array of string', description: 'Text or number fields to check (default every one the account can see).' },
        ],
        example: {
          request: 'POST /tabularius/cleanup/v1/databases/Contacts/scan\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' + JSON.stringify({ layout: 'Customers' }, null, 2),
          status: 200,
          response: JSON.stringify({
            layout: 'Customers', table: 'Customers', scanned: 6, compared: ['Name', 'Email', 'Phone'],
            duplicates: [{
              reason: 'same phone (5552013344); names nearly alike', score: 92,
              records: [{ recordId: 1, values: { Name: 'Acme Corp', Email: 'sales@acme.example', Phone: '(555) 201-3344' } }, { recordId: 2, values: { Name: 'ACME Corp.', Email: null, Phone: '555.201.3344' } }],
              keep: 1, fill: {}, related: [{ table: 'Orders', via: 'CustomerID = Customers::CustomerID', records: 2 }],
            }],
            fixes: [
              { check: 'valueLists', field: 'Status', from: 'actve', to: 'Active', reason: 'not in the value list Statuses; looks like a typo for "Active"', count: 1, recordIds: [2] },
              { check: 'phones', field: 'Phone', from: '555.201.3344', to: '(555) 201-3344', reason: 'written differently from most numbers here, which look like (000) 000-0000', count: 1, recordIds: [2] },
            ],
          }, null, 2),
        },
        notes: 'At most 20,000 records are scanned; notScanned counts the rest. A fix without to needs a person to decide. A field named in fields that isn\'t a text or number field the account can see is 400 (code 102).',
      },
      {
        method: 'POST',
        path: '/tabularius/cleanup/v1/databases/{database}/apply',
        summary: 'Applies fixes and merges as one batch, all or none, and journals it so it can be undone.',
        permissions: `${SIGN_IN}. Changes are made with the account's privileges: an account that can't edit or delete the records gets 403 and nothing is applied.`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'layout', in: 'body', type: 'string', required: true, description: 'The layout the scan was on.' },
          { name: 'fixes', in: 'body', type: 'array of object', description: '[{field, from, to, recordIds?}]: sets from to to in the records that still have it (only those ids, when given).' },
          { name: 'merges', in: 'body', type: 'array of object', description: '[{keep, remove, fill?}]: moves related records to keep, fills its empty fields from fill, then deletes remove.' },
        ],
        example: {
          request: 'POST /tabularius/cleanup/v1/databases/Contacts/apply\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' + JSON.stringify({
            layout: 'Customers', fixes: [{ field: 'Status', from: 'actve', to: 'Active' }], merges: [{ keep: 1, remove: [2], fill: { Notes: 'Prefers phone' } }],
          }, null, 2),
          status: 200,
          response: JSON.stringify({ id: '0d4e9b2a71c3', at: '2026-10-13T10:12:44.507Z', account: 'Admin', layout: 'Customers', summary: '1 value fixed, 1 set of duplicates merged', changes: 6, fixed: 1, merged: 1 }, null, 2),
        },
        notes: 'At most 500 fixes and 200 merges at once. Nothing to apply, a record that is missing, or a merge that would lose related records is 400 (code 960), and nothing is changed.',
      },
      {
        method: 'GET',
        path: '/tabularius/cleanup/v1/databases/{database}/history',
        summary: 'The batches applied to the file, newest first (up to 50).',
        permissions: `${SIGN_IN}.`,
        params: [{ name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' }],
        example: {
          request: 'GET /tabularius/cleanup/v1/databases/Contacts/history\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ history: [{ id: '0d4e9b2a71c3', at: '2026-10-13T10:12:44.507Z', account: 'Admin', layout: 'Customers', summary: '1 value fixed, 1 set of duplicates merged', changes: 6 }] }, null, 2),
        },
        notes: 'A batch that has been undone has undone, the time it was. The history also holds bulk changes journalled elsewhere (Replace Field Contents, Replace All, Delete All Records).',
      },
      {
        method: 'POST',
        path: '/tabularius/cleanup/v1/databases/{database}/history/{id}/undo',
        summary: 'Takes a batch back, all or none; fields changed again since are left alone and listed.',
        permissions: `${SIGN_IN}. The undo is made with the account's privileges.`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The batch\'s id, 12 hex characters.' },
        ],
        example: {
          request: 'POST /tabularius/cleanup/v1/databases/Contacts/history/0d4e9b2a71c3/undo\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ undone: 6, skipped: [] }, null, 2),
        },
        notes: 'An unknown batch ("No such cleanup") or one already undone ("Already undone") is 400 (code 960). A skipped field reads like "Customers::Status of record 4 (changed since)".',
      },
    ],
  },
  {
    id: 'dashboards',
    title: 'Dashboards',
    sources: ['dashboards.ts'],
    intro: 'Dashboards are charts, summary tables and single numbers, each a find on a layout broken down by fields, saved in the file and worked out again each time they are read. ' +
      'The routes are under /tabularius/dashboards/v1/databases/{database} and sign in with Data API session tokens. Numbers are worked out as the signed-in account: records it can\'t view are left out, ' +
      'and a widget that can\'t be worked out carries an error. Errors come back as {"error": {"code", "message"}}: 401 (code 952) without a valid token, 404 (code 401) for an unknown id, ' +
      '400 (code 960) for a dashboard that doesn\'t check out.',
    anchors: [String.raw`/^\/tabularius\/dashboards\/v1\/databases\/([^/]+)(?:\/([0-9a-f]{12}))?$/.exec(`],
    routes: [
      {
        method: 'GET',
        path: '/tabularius/dashboards/v1/databases/{database}',
        summary: 'Lists the file\'s dashboards, by name, without their numbers.',
        permissions: `${SIGN_IN}. Every signed-in account sees every dashboard; canChange says whether it may change one.`,
        params: [{ name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' }],
        example: {
          request: 'GET /tabularius/dashboards/v1/databases/Invoices\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ dashboards: [{ id: '5be0a7c3d11f', name: 'Sales', widgets: 1, account: 'Admin', updated: '2026-10-12T09:10:00.000Z', canChange: true }] }, null, 2),
        },
        notes: 'widgets is the number of widgets. description is there when the dashboard has one.',
      },
      {
        method: 'POST',
        path: '/tabularius/dashboards/v1/databases/{database}',
        summary: 'Saves a new dashboard and returns it worked out, or with ?preview=1 works it out without saving.',
        permissions: `${SIGN_IN}. Any signed-in account may make dashboards; the account is recorded as the dashboard's.`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'preview', in: 'query', type: 'string', description: '1 works the widgets out and saves nothing.' },
          { name: 'name', in: 'body', type: 'string', required: true, description: 'Up to 120 characters, unique in the file.' },
          { name: 'description', in: 'body', type: 'string', description: 'Up to 1,000 characters.' },
          { name: 'widgets', in: 'body', type: 'array of object', required: true, description: '1 to 24 widgets: {title, kind (chart, table or number), chart? (column, bar, line, pie), layout, query? (find requests; dates may be relative, e.g. "this year"), groupBy? (a chart needs 1 or 2), by? (day, week, month, quarter, year), measure? {field, fn: count, sum, average, min, max or distinct}, top? {field, n}, limit?}.' },
        ],
        example: {
          request: 'POST /tabularius/dashboards/v1/databases/Invoices\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' + JSON.stringify({ name: 'Sales', widgets: [TOTAL] }, null, 2),
          status: 201,
          response: JSON.stringify({
            dashboard: { id: '5be0a7c3d11f', name: 'Sales', widgets: [TOTAL], account: 'Admin', created: '2026-10-12T09:10:00.000Z', updated: '2026-10-12T09:10:00.000Z' },
            canChange: true, data: [TOTAL_DATA],
          }, null, 2),
        },
        notes: 'With ?preview=1 the reply is 200 {name, widgets, data}. data has one entry per widget: {title, kind, chart?, layout, find, grouping, foundCount?, value? (number), categories?, series?, xTitle?, yTitle? (chart), ' +
          'columns?, rows? (table), top?, groupCount?, error?}. A name already used, no widgets or a chart without groupBy is 400 (code 960).',
      },
      {
        method: 'GET',
        path: '/tabularius/dashboards/v1/databases/{database}/{id}',
        summary: 'One dashboard, with each widget worked out now as the signed-in account.',
        permissions: `${SIGN_IN}.`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The dashboard\'s id, 12 hex characters.' },
        ],
        example: {
          request: 'GET /tabularius/dashboards/v1/databases/Invoices/5be0a7c3d11f\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({
            dashboard: { id: '5be0a7c3d11f', name: 'Sales', widgets: [TOTAL], account: 'Admin', created: '2026-10-12T09:10:00.000Z', updated: '2026-10-12T09:10:00.000Z' },
            canChange: false, data: [{ ...TOTAL_DATA, foundCount: 23, value: 4200 }],
          }, null, 2),
        },
      },
      {
        method: 'PUT',
        path: '/tabularius/dashboards/v1/databases/{database}/{id}',
        summary: 'Changes a dashboard\'s name, description or widgets and returns it worked out.',
        permissions: `${SIGN_IN}, and either the account that made the dashboard or [Full Access]; others get 403 (code 9).`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The dashboard\'s id, 12 hex characters.' },
          { name: 'name', in: 'body', type: 'string', description: 'A new name.' },
          { name: 'description', in: 'body', type: 'string', description: 'A new description; empty removes it.' },
          { name: 'widgets', in: 'body', type: 'array of object', description: 'The new widgets, as for POST.' },
        ],
        example: {
          request: 'PUT /tabularius/dashboards/v1/databases/Invoices/5be0a7c3d11f\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' + JSON.stringify({ name: 'Sales 2026' }, null, 2),
          status: 200,
          response: JSON.stringify({
            dashboard: { id: '5be0a7c3d11f', name: 'Sales 2026', widgets: [TOTAL], account: 'Admin', created: '2026-10-12T09:10:00.000Z', updated: '2026-10-13T10:20:00.000Z' },
            canChange: true, data: [TOTAL_DATA],
          }, null, 2),
        },
      },
      {
        method: 'DELETE',
        path: '/tabularius/dashboards/v1/databases/{database}/{id}',
        summary: 'Deletes a dashboard.',
        permissions: `${SIGN_IN}, and either the account that made the dashboard or [Full Access]; others get 403 (code 9).`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The dashboard\'s id, 12 hex characters.' },
        ],
        example: {
          request: 'DELETE /tabularius/dashboards/v1/databases/Invoices/5be0a7c3d11f\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ deleted: '5be0a7c3d11f' }, null, 2),
        },
      },
    ],
  },
  {
    id: 'digests',
    title: 'Scheduled digests',
    sources: ['digests.ts'],
    intro: 'A digest works a dashboard out on a schedule, as the account that set it up, and (when the server has the AI assistant) adds a short summary written by it. Runs are kept in the file; nothing is emailed. ' +
      'The routes are under /tabularius/digests/v1/databases/{database} and sign in with Data API session tokens. A digest and its runs are for the account that set it up, or [Full Access]. ' +
      'Errors come back as {"error": {"code", "message"}}: 401 (code 952) without a valid token, 403 (code 9) for someone else\'s digest, 404 (code 401) for an unknown id, 400 (code 960) for a digest that doesn\'t check out.',
    anchors: [String.raw`/^\/tabularius\/digests\/v1\/databases\/([^/]+)(?:\/([0-9a-f]{12})(?:\/(run|runs))?)?$/.exec(`, `sub === 'runs'`, `sub === 'run'`],
    routes: [
      {
        method: 'GET',
        path: '/tabularius/digests/v1/databases/{database}',
        summary: 'Lists the file\'s digests with their schedule in words, next run and (for those the account may read) latest run.',
        permissions: `${SIGN_IN}. Every digest is listed; last is included only on the account's own digests, or all of them for [Full Access]. Only [Full Access] sees webhook and the webhooks list.`,
        params: [{ name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' }],
        example: {
          request: 'GET /tabularius/digests/v1/databases/Invoices\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ digests: [{ ...DIGEST, last: RUN }], webhooks: [{ id: 'wh_1', url: 'https://hooks.example.com/digest', enabled: true }] }, null, 2),
        },
        notes: 'webhooks are the admin console\'s webhooks for this file (never their secrets), for [Full Access] to pick one. next is left out for a digest that is turned off.',
      },
      {
        method: 'POST',
        path: '/tabularius/digests/v1/databases/{database}',
        summary: 'Sets up a digest of a dashboard, run as the signed-in account.',
        permissions: `${SIGN_IN}, and either the account that made the dashboard or [Full Access] (403, code 9, otherwise). A webhook takes [Full Access].`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'dashboard', in: 'body', type: 'string', required: true, description: 'The dashboard\'s id or name.' },
          { name: 'name', in: 'body', type: 'string', description: 'Up to 100 characters (default the dashboard\'s name).' },
          { name: 'days', in: 'body', type: 'array of number', required: true, description: 'Days of the week it runs, 0 for Sunday to 6 for Saturday.' },
          { name: 'at', in: 'body', type: 'string', required: true, description: 'Time of day, HH:MM, in the server\'s local time.' },
          { name: 'prompt', in: 'body', type: 'string', description: 'What the summary should cover (under 2,000 characters).' },
          { name: 'webhook', in: 'body', type: 'string', description: 'An admin console webhook for this file to post each run to (sent only on a server started with --allow-webhooks).' },
          { name: 'enabled', in: 'body', type: 'boolean', description: 'Default true.' },
        ],
        example: {
          request: 'POST /tabularius/digests/v1/databases/Invoices\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' +
            JSON.stringify({ dashboard: 'Z Reference digest', name: 'Weekly revenue', days: [1], at: '23:59', prompt: 'new and overdue invoices' }, null, 2),
          status: 201,
          response: JSON.stringify({ digest: DIGEST }, null, 2),
        },
        notes: 'A time that has just passed doesn\'t count: the first run is the next one. Bad days or at, or an unknown dashboard or webhook, is 400 (code 960).',
      },
      {
        method: 'GET',
        path: '/tabularius/digests/v1/databases/{database}/{id}',
        summary: 'One digest with its runs, newest first (the last 20 are kept).',
        permissions: `${SIGN_IN}, and either the digest's account or [Full Access].`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The digest\'s id, 12 hex characters.' },
        ],
        example: {
          request: 'GET /tabularius/digests/v1/databases/Invoices/8c41d07e2a95\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ digest: { ...DIGEST, last: RUN }, runs: [RUN] }, null, 2),
        },
      },
      {
        method: 'PUT',
        path: '/tabularius/digests/v1/databases/{database}/{id}',
        summary: 'Changes a digest\'s name, schedule, prompt, webhook or whether it is on.',
        permissions: `${SIGN_IN}, and either the digest's account or [Full Access]. Setting a webhook takes [Full Access].`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The digest\'s id, 12 hex characters.' },
          { name: 'name, days, at, prompt, webhook, enabled', in: 'body', type: 'various', description: 'As for POST; those left out keep their values. An empty prompt or webhook removes it. The dashboard can\'t be changed.' },
        ],
        example: {
          request: 'PUT /tabularius/digests/v1/databases/Invoices/8c41d07e2a95\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' + JSON.stringify({ at: '06:00' }, null, 2),
          status: 200,
          response: JSON.stringify({ digest: { ...DIGEST, at: '06:00', updated: '2026-10-13T10:30:00.000Z', schedule: 'Mondays at 06:00', next: '2026-10-19T06:00:00.000Z', last: RUN } }, null, 2),
        },
      },
      {
        method: 'DELETE',
        path: '/tabularius/digests/v1/databases/{database}/{id}',
        summary: 'Deletes a digest and its runs.',
        permissions: `${SIGN_IN}, and either the digest's account or [Full Access].`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The digest\'s id, 12 hex characters.' },
        ],
        example: {
          request: 'DELETE /tabularius/digests/v1/databases/Invoices/8c41d07e2a95\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ deleted: '8c41d07e2a95' }, null, 2),
        },
      },
      {
        method: 'POST',
        path: '/tabularius/digests/v1/databases/{database}/{id}/run',
        summary: 'Runs a digest now and returns the run, which is kept with the others.',
        permissions: `${SIGN_IN}, and either the digest's account or [Full Access]. The dashboard is worked out as the digest's account, and the AI summary needs that account's privilege set to have fmmcp.`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The digest\'s id, 12 hex characters.' },
        ],
        example: {
          request: 'POST /tabularius/digests/v1/databases/Invoices/8c41d07e2a95/run\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ run: RUN }, null, 2),
        },
        notes: 'A run is {id, digest, at, scheduled? (left out when run by hand), outcome (ok or error), highlights, data, ms, summary?, summaryNote?, webhook? {sent, error?}, error?}. ' +
          'Without the assistant there is no summary, and summaryNote says why (e.g. "No AI summary: the assistant is off on this server (start it with --ai)"). ' +
          'A run that fails (the account inactive or gone, the dashboard deleted) is still 200, with outcome error.',
      },
      {
        method: 'GET',
        path: '/tabularius/digests/v1/databases/{database}/{id}/runs',
        summary: 'A digest\'s recent runs, newest first.',
        permissions: `${SIGN_IN}, and either the digest's account or [Full Access].`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The digest\'s id, 12 hex characters.' },
        ],
        example: {
          request: 'GET /tabularius/digests/v1/databases/Invoices/8c41d07e2a95/runs\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ runs: [RUN] }, null, 2),
        },
      },
    ],
  },
  {
    id: 'agent',
    title: 'Agent mode',
    sources: ['agent.ts'],
    intro: 'The assistant can plan a task of several steps (find records, set a field in them, make or delete records, run a script); the plan comes back from the assistant routes in plans. ' +
      'These routes under /tabularius/agent/v1/databases/{database} check a plan, try it, run it and take it back. A plan is {summary, layout, steps}; each step is one of ' +
      '{kind: "find", layout, query?}, {kind: "set", field, value}, {kind: "create", fieldData}, {kind: "delete"} or {kind: "script", script, parameter?}, each with an optional why. ' +
      'A plan has 1 to 20 steps and every layout, field and script in it must exist and be allowed to the signed-in account. Every route is a POST and signs in with Data API session tokens; ' +
      'steps run as the signed-in account, so its privileges apply to each one, offline (no network, mail or plug-ins), and every change goes in the audit log. ' +
      'The routes are refused with 403 (code 960) when AI is turned off for the file or a file it uses. Errors come back as {"error": {"code", "message"}}: 401 (code 952) without a valid token, ' +
      '400 (code 960) for a plan or step that can\'t be applied (the message says why), 403 when the account may not make a change (store error 200 or 201), and 405 (code 3) for any method but POST.',
    anchors: [String.raw`/^\/tabularius\/agent\/v1\/databases\/([^/]+)\/(dry-run|step|runs\/([0-9a-f]{12})\/undo)$/.exec(`],
    routes: [
      {
        method: 'POST',
        path: '/tabularius/agent/v1/databases/{database}/dry-run',
        summary: 'Runs every step of a plan on a throwaway copy of the file, as the signed-in account, and says what each would do; nothing is kept.',
        permissions: `${SIGN_IN}. The plan is checked against the account's privileges, and the copy is worked on as that account. What a delete step reports leaves out the fields the account can\'t read (hidden or masked).`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'plan', in: 'body', type: 'object', required: true, description: '{summary, layout, steps}, as described above.' },
        ],
        example: {
          request: 'POST /tabularius/agent/v1/databases/Invoices/dry-run\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' + JSON.stringify({
            plan: {
              summary: 'Mark overdue invoices late', layout: 'Invoices',
              steps: [{ kind: 'find', layout: 'Invoices', query: [{ Status: 'Overdue' }], why: 'Only the overdue ones' }, { kind: 'set', field: 'Status', value: 'Late' }],
            },
          }, null, 2),
          status: 200,
          response: JSON.stringify({
            results: [
              { step: 0, outcome: 'ok', found: 7, created: 0, changed: 0, deleted: 0 },
              { step: 1, outcome: 'ok', found: 7, created: 0, changed: 7, deleted: 0, records: { records: [{ table: 'Invoices', recordId: 1042, kind: 'update', fields: [{ field: 'Status', before: 'Overdue', after: 'Late' }] }], more: 6, truncated: [] } },
            ],
          }, null, 2),
        },
        notes: 'results has one entry per step, in order, and stops after the first step that fails (outcome "error", with a message). records lists what the step made, changed or deleted, field by field ' +
          '(the first 50 records; more counts the rest; truncated lists tables emptied at once), and is left out when nothing changed. A file larger than 200 MB is too large to copy: the answer is ' +
          '{"results": [], "skipped": "The file is larger than 200 MB, too large to copy for a dry run"}.',
      },
      {
        method: 'POST',
        path: '/tabularius/agent/v1/databases/{database}/step',
        summary: 'Runs one approved step of a plan for real, as the signed-in account, and says where the run is afterwards.',
        permissions: `${SIGN_IN}. The step is made with the account's privileges; it only reaches records and fields the account can see.`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'plan', in: 'body', type: 'object', required: true, description: 'The whole plan, as for the dry run.' },
          { name: 'step', in: 'body', type: 'number', required: true, description: 'Which step to run, counting from 0 ("No such step" otherwise).' },
          { name: 'state', in: 'body', type: 'object', description: 'Where the run is after the step before: the {layout, foundSet} that step answered with. Needed for every step after the first; the first starts on the plan\'s layout with all its records.' },
          { name: 'run', in: 'body', type: 'string', description: 'The run id (12 hex characters) the first step answered with, so this step\'s changes join that run. Leave it out on the first step.' },
        ],
        example: {
          request: 'POST /tabularius/agent/v1/databases/Invoices/step\nAuthorization: Bearer 3f1d0c6e8a…\nContent-Type: application/json\n\n' + JSON.stringify({
            plan: {
              summary: 'Mark invoices paid', layout: 'Invoices',
              steps: [{ kind: 'set', field: 'Status', value: 'Paid' }],
            },
            step: 0,
          }, null, 2),
          status: 200,
          response: JSON.stringify({
            result: { step: 0, outcome: 'ok', found: 8, created: 0, changed: 8, deleted: 0 },
            state: { layout: 'Invoices', foundSet: [1, 2, 3] }, run: '7e1d4a09c3b2',
          }, null, 2),
        },
        notes: 'result is the same as a dry run\'s entry for the step. A step that fails part way still keeps what it did, so Undo takes it back (outcome "error", with a message). ' +
          'run is there once any step has changed something; the changes of all the steps of a run are one batch. At most 5,000 records are changed by a set step and 500 deleted by a delete step; ' +
          'deleting records that take related records with them is refused, as Undo could not bring those back. Script steps run offline, for at most 60 seconds. ' +
          'A run to add to that isn\'t yours, was undone, or doesn\'t match the plan is 400 "No such run to add to".',
      },
      {
        method: 'POST',
        path: '/tabularius/agent/v1/databases/{database}/runs/{id}/undo',
        summary: 'Takes a whole run back, all or none: made records removed, changed fields set back, deleted records put back.',
        permissions: `${SIGN_IN}. Only the account that made the run, or a [Full Access] account, can undo it; the undo is made with the account's privileges. It needs no body.`,
        params: [
          { name: 'database', in: 'path', type: 'string', required: true, description: 'The hosted file\'s name.' },
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The run id the step answered with, 12 hex characters.' },
        ],
        example: {
          request: 'POST /tabularius/agent/v1/databases/Invoices/runs/7e1d4a09c3b2/undo\nAuthorization: Bearer 3f1d0c6e8a…',
          status: 200,
          response: JSON.stringify({ undone: 3, skipped: [] }, null, 2),
        },
        notes: 'Fields changed again since are left alone and listed in skipped. An unknown run ("No such cleanup"), one already undone ("Already undone") and one made by another account are 400 (code 960). ' +
          'The run is the same kind of batch as a data cleanup\'s, so it also shows in that history.',
      },
    ],
  },
  {
    id: 'inbound-hooks',
    title: 'Inbound hooks',
    sources: ['inbound-hooks.ts'],
    intro: 'Another service (a payment provider, a form, a CI job) calls the server and a chosen script runs with the JSON it sent as Get ( ScriptParameter ). ' +
      'Each hook has its own address, /tabularius/hooks/v1/{id}, and its own secret; nothing else is reachable with it. Hooks are set up in the admin console (see Admin console: webhooks, inbound hooks and the outbox), ' +
      'which shows each one\'s recent calls. Calls are answered only on a server started with --allow-inbound-hooks. ' +
      'Every call is signed: X-Tabularius-Timestamp is the time in Unix seconds, and X-Tabularius-Signature is "sha256=" and the hex HMAC-SHA256, with the hook\'s secret, of the timestamp, a ".", and the body exactly as sent. ' +
      'A call whose time is more than five minutes from the server\'s clock, or one already seen, is refused, so a captured call can\'t be sent again. ' +
      'The script runs as the hook\'s account, within its privileges, as an automation does: offline unless the server and the hook both allow the network, no AI steps, and for at most 30 seconds. ' +
      'A hook that doesn\'t exist, is turned off, or a server with hooks off all answer the same 404 {"error": "No such hook"}.',
    anchors: [String.raw`/^\/tabularius\/hooks\/v1\/([^/]+)$/.exec(`],
    routes: [
      {
        method: 'POST',
        path: '/tabularius/hooks/v1/{id}',
        summary: 'Calls a hook: runs its script with the body as the script parameter and answers with the script\'s result.',
        permissions: 'No sign-in: the signature made with the hook\'s secret is the credential (headers X-Tabularius-Timestamp and X-Tabularius-Signature). The script then runs as the hook\'s account.',
        params: [
          { name: 'id', in: 'path', type: 'string', required: true, description: 'The hook\'s id, as the admin console shows it.' },
          { name: 'X-Tabularius-Timestamp', in: 'header', type: 'string', required: true, description: 'The current time in Unix seconds.' },
          { name: 'X-Tabularius-Signature', in: 'header', type: 'string', required: true, description: '"sha256=" and the hex HMAC-SHA256 of "<timestamp>.<body>" with the hook\'s secret.' },
          { name: 'body', in: 'body', type: 'object', required: true, description: 'JSON of up to 256 KB. It is passed to the script, re-written without extra white space, as Get ( ScriptParameter ).' },
        ],
        example: {
          request: 'POST /tabularius/hooks/v1/9c2e5b7a1f40d3e816\nX-Tabularius-Timestamp: 1791886800\nX-Tabularius-Signature: sha256=5d41402abc4b2a76b9719d911017c592ae2f6b5c0d1e8d3a4f7b9c2e6a10d8f3\nContent-Type: application/json\n\n' +
            JSON.stringify({ event: 'payment.succeeded', invoice: 'INV-1042' }),
          status: 200,
          response: JSON.stringify({ ok: true, result: 'Invoice INV-1042 marked paid' }, null, 2),
        },
        notes: 'result is the script\'s result, cut to 10,000 characters. A script that ends with an error is still 200, with {"ok": false, "error": <error code>, "result": …}; a script that can\'t start or crashes is 500 {"ok": false, "error": <code>}. ' +
          'Refused calls: 404 (see above), 405 "Send a POST" for another method, 401 for a missing or old timestamp or a wrong signature, 409 "This call was already received", 413 over 256 KB, ' +
          '400 for a body that isn\'t JSON, 403 for a capture-only file, 503 when the file isn\'t open, and 429 over the hook\'s calls a minute (60 unless changed, up to 6000) ' +
          'or for an address that sends 20 bad calls in a minute. The last 20 calls of each hook (time, status, outcome, size, sender; never the body) are in the admin console.',
      },
    ],
  },
];
