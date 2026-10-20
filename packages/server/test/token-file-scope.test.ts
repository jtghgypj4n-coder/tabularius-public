// File binding prevents direct entry into B; A's external occurrences and scripts
// may still reach B under that file's account privileges. No imported fixture,
// mocked authorization, or in-memory schema edits are needed for this graph.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import { createStore, DESIGN_TABLE, Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { narrowPrivileges } from '../src/token-scope.ts';
import { runScript } from '../../scripts/src/index.ts';
import { explainScriptFailure } from '../src/script-failure.ts';
import { Dashboards } from '../src/dashboards.ts';
import { DigestRunner, Digests } from '../src/digests.ts';
import type { Host } from '../src/host.ts';
import { Assistant } from '../src/assistant.ts';
import { DataApi } from '../src/dataapi.ts';

let dir = '';
let server: Server | undefined;
let model: Server | undefined;
let host: Host;
const modelRequests: any[] = [];
let beforeModelReply: (() => void) | undefined;
let base = '';
let a: Store;
let b: Store;
let parent: number;
let hiddenParent: number;
let item: number;
let bToken: string;
let vault: number;
const cases = [
  { name: 'layout scope, restricted A account', account: 'Reader', readOnly: false, layouts: ['Parents', 'AccountDenied'], token: '' },
  { name: 'read-only, restricted A account', account: 'Reader', readOnly: true, layouts: undefined, token: '' },
  { name: 'layout scope, full access in A only', account: 'Owner', readOnly: false, layouts: ['Parents'], token: '' },
  { name: 'read-only plus layout scope', account: 'Reader', readOnly: true, layouts: ['Parents'], token: '' },
];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-token-file-scope-'));
  const open = (name: string) => {
    const path = join(dir, `${name}.openhbam.sqlite`);
    createStore(path);
    const store = new Store(path, name);
    store.setAiPolicy(false); // these tests are about token ceilings; the AI policy has its own tests
    return store;
  };
  const data = open('B');
  const main = open('A');
  try {
    data.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'ParentId', type: 'number' }, { name: 'Visible', type: 'number' }, { name: 'Title' }, { name: 'Secret' }] },
      { op: 'createScript', name: 'ReadB', text: 'Go to Layout [ “Items” ]\nGo to Record/Request/Page [ First ]\nExit Script [ Text Result: Items::Title ]' },
      { op: 'createScript', name: 'InspectB', text: 'Go to Layout [ “Items” ]\nShow All Records\nGo to Record/Request/Page [ First ]\nExit Script [ Text Result: Get ( FoundCount ) & "|" & Items::Secret ]' },
      { op: 'createScript', name: 'ApiB', text: 'Execute FileMaker Data API [ Select ; Target: $data ; "{\\"layouts\\":\\"Items\\"}" ]\nExit Script [ Text Result: $data ]' },
      { op: 'createScript', name: 'ForbiddenB', text: 'Exit Script [ Text Result: "FORBIDDEN_SCRIPT_RAN" ]' },
      { op: 'createScript', name: 'WriteB', text: 'Go to Layout [ “Items” ]\nGo to Record/Request/Page [ First ]\nSet Field [ Items::Title ; "changed by script" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Get ( LastError ) ]' },
    ]);
    item = data.create('Items', { ParentId: 1, Visible: 1, Title: 'visible B row', Secret: 'B_FIELD_SECRET' }).recordId;
    data.create('Items', { ParentId: 1, Visible: 0, Title: 'B_HIDDEN_ROW', Secret: 'B_HIDDEN_SECRET' });
    data.savePrivilegeSet({
      name: 'B access', records: { view: false, edit: false, create: false, delete: false },
      tables: { Items: { view: 'Visible = 1', edit: true, create: false, delete: false, fields: { Secret: 'none' } } },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', scriptAccess: { ForbiddenB: 'none' },
      extendedPrivileges: ['fmrest', 'fmmcp'],
    });
    for (const account of ['Reader', 'Owner']) data.setPassword(account, 'different password in B', 'B access');
    main.resolveFile = (name) => name.toLowerCase() === 'b' ? data : undefined;
    const table = data.schema.tables.find((t) => t.name === 'Items')!;
    const field = (name: string) => table.fields.find((f) => f.name === name)!.id;
    main.applyDesign([
      { op: 'createTable', name: 'Parents', fields: [{ name: 'Id', type: 'number' }, { name: 'Visible', type: 'number' }] },
      { op: 'createDataSource', name: 'B', paths: ['file:B'] },
      { op: 'createOccurrence', name: 'BItems', file: 'B', externalTable: table.id },
      { op: 'createLayout', name: 'Outside', occurrence: 'Parents' },
      { op: 'createLayout', name: 'AccountDenied', occurrence: 'Parents' },
      { op: 'createLayout', name: 'ExternalItems', occurrence: 'BItems' },
    ]);
    const id = main.schema.tables.find((t) => t.name === 'Parents')!.fields.find((f) => f.name === 'Id')!.id;
    main.applyDesign([{ op: 'createRelationship', left: 'Parents', right: 'BItems', predicates: [{ left: id, right: field('ParentId') }] }]);
    const ext = main.schema.tableOccurrences.find((t) => t.name === 'BItems')!.id;
    const anchors = { left: true, top: true, right: false, bottom: false };
    const cell = (id: number, name: string): LayoutObject => ({
      id, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 182, left: 22, bottom: 204, right: 160 },
      field: { tableOccurrenceId: ext, fieldId: field(name), tableOccurrence: 'BItems', field: name, display: 'edit', repetitions: 1 },
    });
    const portal: LayoutObject = {
      id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 180, left: 20, bottom: 284, right: 300 },
      portal: { tableOccurrenceId: ext, tableOccurrence: 'BItems', rows: 4, initialRow: 1 },
      children: [cell(901, 'Title'), cell(902, 'Secret')],
    };
    main.applyDesign([{ op: 'updateLayout', layout: 'Parents', design: { objects: [...main.design('Parents')!.objects, cell(903, 'Title'), cell(904, 'Secret'), portal] } }]);
    for (const script of ['ReadB', 'InspectB', 'ForbiddenB', 'WriteB', 'ApiB']) {
      main.applyDesign([{ op: 'createScript', name: `Call${script}`, text: `Set Error Capture [ On ]\nPerform Script [ Specified: By name ; "B::${script}" ]\nIf [ Get ( LastError ) <> 0 ]\nExit Script [ Text Result: Get ( LastError ) ]\nEnd If\nExit Script [ Text Result: Get ( ScriptResult ) ]` }]);
    }
    main.applyDesign([
      { op: 'createScript', name: 'OutsideScript', text: 'Set Error Capture [ On ]\nGo to Layout [ “Outside” ]\nExit Script [ Text Result: Get ( LastError ) ]' },
      { op: 'createScript', name: 'OutsideApi', text: 'Set Error Capture [ On ]\nExecute FileMaker Data API [ Select ; Target: $data ; "{\\"layouts\\":\\"Outside\\"}" ]\nExit Script [ Text Result: Get ( LastError ) ]' },
      { op: 'createScript', name: 'ElevatedReadRelated', text: 'Exit Script [ Text Result: BItems::Secret ]' },
      { op: 'createScript', name: 'ElevatedWriteRelated', text: 'Set Error Capture [ On ]\nSet Field [ BItems::Secret ; "must not write" ]\nExit Script [ Text Result: Get ( LastError ) ]' },
      { op: 'createScript', name: 'ElevatedOutside', text: 'Set Error Capture [ On ]\nGo to Layout [ “Outside” ]\nExit Script [ Text Result: Get ( LastError ) ]' },
      { op: 'createScript', name: 'ElevatedApiOutside', text: 'Set Error Capture [ On ]\nExecute FileMaker Data API [ Select ; Target: $data ; "{\\"layouts\\":\\"Outside\\"}" ]\nExit Script [ Text Result: Get ( LastError ) ]' },
      { op: 'createScript', name: 'ElevatedApiRelated', text: 'Execute FileMaker Data API [ Select ; Target: $data ; "{\\"layouts\\":\\"Parents\\",\\"query\\":[{\\"Id\\":1}]}" ]\nExit Script [ Text Result: $data ]' },
      { op: 'createScript', name: 'ReloginOutside', text: 'Set Error Capture [ On ]\nRe-Login [ Account Name: "Owner" ; Password: "password in A" ; With dialog: Off ]\nSet Variable [ $login ; Value: Get ( LastError ) ]\nGo to Layout [ “Outside” ]\nExit Script [ Text Result: $login & "|" & Get ( LastError ) ]' },
      { op: 'createScript', name: 'ElevatedReloginOutside', text: 'Set Error Capture [ On ]\nRe-Login [ Account Name: "Owner" ; Password: "password in A" ; With dialog: Off ]\nSet Variable [ $login ; Value: Get ( LastError ) ]\nGo to Layout [ “Outside” ]\nExit Script [ Text Result: $login & "|" & Get ( LastError ) ]' },
      { op: 'createTable', name: 'Vault', fields: [{ name: 'Secret' }, { name: 'Title' }] },
      { op: 'createScript', name: 'EditVault', text: 'Set Error Capture [ On ]\nGo to Layout [ “Vault” ]\nIf [ Get ( LastError ) <> 0 ]\nExit Script [ Text Result: Get ( LastError ) ]\nEnd If\nSet Field [ Vault::Secret ; "changed on copy" ]\nCommit Records/Requests [ With dialog: Off ]' },
      { op: 'createScript', name: 'ElevatedEditVault', text: 'Set Error Capture [ On ]\nGo to Layout [ “Vault” ]\nIf [ Get ( LastError ) <> 0 ]\nExit Script [ Text Result: Get ( LastError ) ]\nEnd If\nSet Field [ Vault::Secret ; "changed on copy" ]\nCommit Records/Requests [ With dialog: Off ]' },
    ]);
    vault = main.create('Vault', { Secret: 'VAULT_SECRET', Title: 'EXCLUDED_PAYROLL_DATA' }).recordId;
    for (const name of main.schema.scripts.filter((s) => s.name.startsWith('Elevated')).map((s) => s.name)) {
      main.schema.scripts.find((s) => s.name === name)!.fullAccess = true;
      main.applyDesign([{ op: 'updateScript', script: name, includeInMenu: true }]);
    }
    main.applyDesign([{ op: 'updateLayout', layout: 'Parents', design: { triggers: [
      { event: 'OnModeEnter', scriptId: main.schema.scripts.find((s) => s.name === 'CallForbiddenB')!.id },
      { event: 'OnModeExit', scriptId: main.schema.scripts.find((s) => s.name === 'CallInspectB')!.id },
      { event: 'OnLayoutKeystroke', scriptId: main.schema.scripts.find((s) => s.name === 'ElevatedOutside')!.id },
    ] } }]);
    main.savePrivilegeSet({
      name: 'A access', records: { view: 'Visible = 1', edit: true, create: false, delete: false },
      layouts: 'viewOnly', layoutAccess: { AccountDenied: { layout: 'none', records: 'none' } },
      valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'],
    });
    main.setPassword('Reader', 'password in A', 'A access');
    const full = main.privilegeSets().find((p) => p.id === 1)!;
    main.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest', 'fmmcp', 'fmxdbc', 'fmodata'])] });
    main.setPassword('Owner', 'password in A', full.name);
    main.setPassword('Both', 'password in A', full.name);
    data.setPassword('Both', 'password in B', data.privilegeSets().find((p) => p.id === 1)!.name);
    parent = main.create('Parents', { Id: 1, Visible: 1 }).recordId;
    hiddenParent = main.create('Parents', { Id: 2, Visible: 0 }).recordId;
  } finally {
    main.close();
    data.close();
  }
  // Reopen through the real host: this also proves the external graph persisted.
  model = createServer((req, res) => {
    if (req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [] }));
      return;
    }
    let raw = '';
    req.on('data', (chunk) => raw += chunk);
    req.on('end', () => {
      const sent = JSON.parse(raw);
      const probe = sent.messages.some((m: any) => (typeof m.content === 'string' ? m.content : m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')).startsWith('TOKEN_SCOPE_PROBE'));
      if (probe) modelRequests.push(sent);
      const last = sent.messages.at(-1).content;
      const result = Array.isArray(last) ? last.find((b: any) => b.type === 'tool_result') : undefined;
      if (probe && !result) beforeModelReply?.();
      const answer = probe && !result
        ? { content: [{ type: 'tool_use', id: 'scope-read', name: 'get_record', input: { database: 'A', layout: 'Vault', recordId: vault } }], stop_reason: 'tool_use' }
        : { content: [{ type: 'text', text: result ? String(result.content) : 'No generated summary.' }], stop_reason: 'end_turn' };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...answer, usage: { input_tokens: 10, output_tokens: 5 } }));
    });
  });
  await new Promise<void>((resolve) => model!.listen(0, '127.0.0.1', resolve));
  const started = await serve({ dir, port: 0, watch: false, log: () => {}, ai: { apiKey: 'test-key', model: 'stub', fastModel: 'stub', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  host = started.host;
  server = started.server;
  base = started.url;
  a = started.host.get('A')!;
  b = started.host.get('B')!;
  for (const c of cases) c.token = a.createApiToken(c.account, { readOnly: c.readOnly, layouts: c.layouts });
  bToken = b.createApiToken('Reader');
});

after(async () => {
  await new Promise<void>((resolve, reject) => server ? server.close((e) => e ? reject(e) : resolve()) : resolve());
  await new Promise<void>((resolve, reject) => model ? model.close((e) => e ? reject(e) : resolve()) : resolve());
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function rest(token: string, database: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${base}/fmi/data/vLatest/databases/${database}/${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

async function tool(token: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json',
      accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  assert.equal(res.status, 200, 'MCP transport accepts the token');
  const envelope = await res.json();
  assert.ok(envelope.result, JSON.stringify(envelope));
  const text: string = envelope.result.content?.[0]?.text ?? '';
  let data: any;
  try { data = JSON.parse(text); } catch { /* Tool refusals can be plain text. */ }
  return { isError: !!envelope.result.isError, text, data };
}

function related(record: any) {
  assert.equal(record.fieldData['BItems::Title'], 'visible B row', 'related field resolves B');
  assert.deepEqual(record.portalData.BItems.map((r: any) => r['BItems::Title']), ['visible B row'], 'portal applies B record privileges');
  assert.doesNotMatch(JSON.stringify(record), /B_FIELD_SECRET|B_HIDDEN_ROW|B_HIDDEN_SECRET/, 'B field and record restrictions survive entry through A');
}

test('fixture controls: both files are real, related, and independently accessible', async () => {
  assert.equal(a.layout('Parents').owner, a);
  const raw = a.get('Parents', parent);
  assert.equal(raw.portalData!.BItems.length, 2);
  assert.match(JSON.stringify(raw), /B_FIELD_SECRET/);
  const direct = await rest(bToken, 'B', 'layouts/Items/records');
  assert.equal(direct.status, 200);
  assert.equal(direct.body.response.data[0].fieldData.Title, 'visible B row');
  assert.equal((await tool(bToken, 'get_record', { database: 'B', layout: 'Items', recordId: item })).isError, false);
});

for (const c of cases) {
  test(`${c.name}: Data API refuses B before and after using A`, async () => {
    for (const warm of [false, true]) {
      if (warm) assert.equal((await rest(c.token, 'A', `layouts/Parents/records/${parent}`)).status, 200);
      for (const path of ['layouts', 'layouts/Items/records', 'layouts/Items/script/ReadB']) {
        const r = await rest(c.token, 'B', path);
        assert.equal(r.status, 401, path);
        assert.equal(r.body.messages[0].code, '952', path);
      }
    }
  });

  test(`${c.name}: Data API related fields and portals obey B privileges`, async () => {
    const r = await rest(c.token, 'A', `layouts/Parents/records/${parent}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    related(r.body.response.data[0]);
  });

  test(`${c.name}: MCP lists only A and refuses tools naming B`, async () => {
    const listed = await tool(c.token, 'list_databases', {});
    assert.equal(listed.isError, false, listed.text);
    assert.deepEqual(listed.data, ['A']);
    for (const [name, args] of [
      ['find_records', { layout: 'Items' }],
      ['get_record', { layout: 'Items', recordId: item }],
      ['run_script', { script: 'ReadB' }],
      ['update_record', { layout: 'Items', recordId: item, fieldData: { Title: 'must not write' } }],
    ] as const) {
      const r = await tool(c.token, name, { database: 'B', ...args });
      assert.equal(r.isError, true, `${name}: ${r.text}`);
      assert.match(r.text, /signed in to A only/, name);
    }
    assert.equal(b.get('Items', item).fieldData.Title, 'visible B row');
  });

  test(`${c.name}: MCP related fields and portals obey B privileges`, async () => {
    const r = await tool(c.token, 'get_record', { database: 'A', layout: 'Parents', recordId: parent });
    assert.equal(r.isError, false, r.text);
    related(r.data);
  });

  if (c.layouts) test(`${c.name}: excluded A layout stays inaccessible on both surfaces`, async () => {
    const r = await rest(c.token, 'A', 'layouts/Outside/records');
    assert.equal(r.status, 500);
    assert.equal(r.body.messages[0].code, '105');
    const m = await tool(c.token, 'find_records', { database: 'A', layout: 'Outside' });
    assert.equal(m.isError, true, m.text);
    assert.match(m.text, /missing|privilege/i);
  });

  for (const surface of ['Data API', 'MCP']) {
    if (!c.readOnly) test(`${c.name}: ${surface} B script applies B record and field restrictions`, async () => {
      // B allows this script but hides its second row and Secret field. Full
      // access in A must not discard those restrictions when the script enters B.
      if (surface === 'Data API') {
        const r = await rest(c.token, 'A', 'layouts/Parents/script/CallInspectB');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.response.scriptError, '0');
        assert.equal(r.body.response.scriptResult, '1|');
      } else {
        const r = await tool(c.token, 'run_script', { database: 'A', layout: 'Parents', script: 'CallInspectB' });
        assert.equal(r.isError, false, r.text);
        assert.equal(r.data.error, 0, r.text);
        assert.equal(r.data.result, '1|');
      }
    });

    test(`${c.name}: ${surface} cross-file script respects B script access`, async () => {
      if (surface === 'Data API') {
        const r = await rest(c.token, 'A', 'layouts/Parents/script/CallForbiddenB');
        assert.equal(r.status, c.readOnly ? 403 : 200, JSON.stringify(r.body));
        if (c.readOnly) assert.equal(r.body.messages[0].code, '9');
        else assert.equal(r.body.response.scriptResult, '9', 'B denies ForbiddenB even when A grants full access');
      } else {
        const r = await tool(c.token, 'run_script', { database: 'A', layout: 'Parents', script: 'CallForbiddenB' });
        assert.equal(r.isError, c.readOnly, r.text);
        if (c.readOnly) assert.match(r.text, /privilege/i);
        else assert.equal(r.data.result, '9', 'B denies ForbiddenB');
      }
    });

    test(`${c.name}: ${surface} allows B script reads/writes only for writable tokens`, async () => {
      try {
        for (const script of ['ReadB', 'WriteB']) {
          if (surface === 'Data API') {
            const r = await rest(c.token, 'A', `layouts/Parents/script/Call${script}`);
            assert.equal(r.status, c.readOnly ? 403 : 200, JSON.stringify(r.body));
            if (c.readOnly) assert.equal(r.body.messages[0].code, '9');
            else {
              assert.equal(r.body.response.scriptError, '0');
              assert.equal(r.body.response.scriptResult, script === 'ReadB' ? 'visible B row' : '0');
            }
          } else {
            const r = await tool(c.token, 'run_script', { database: 'A', layout: 'Parents', script: `Call${script}` });
            assert.equal(r.isError, c.readOnly, r.text);
            if (c.readOnly) assert.match(r.text, /privilege/i);
            else {
              assert.equal(r.data.error, 0, r.text);
              assert.equal(r.data.result, script === 'ReadB' ? 'visible B row' : '0');
            }
          }
        }
        assert.equal(b.get('Items', item).fieldData.Title, c.readOnly ? 'visible B row' : 'changed by script');
      } finally {
        b.update('Items', item, { Title: 'visible B row' });
      }
    });
  }

  if (c.readOnly) test(`${c.name}: related writes cannot bypass read-only on either surface`, async () => {
    try {
      const portalData = { BItems: [{ recordId: String(item), 'BItems::Title': 'must not write' }] };
      const r = await rest(c.token, 'A', `layouts/Parents/records/${parent}`, 'PATCH', { portalData });
      assert.equal(r.status, 403);
      assert.equal(r.body.messages[0].code, '9');
      const m = await tool(c.token, 'update_record', { database: 'A', layout: 'Parents', recordId: parent, portalData });
      assert.equal(m.isError, true, m.text);
      assert.match(m.text, /Record access is denied/);
      assert.equal(b.get('Items', item).fieldData.Title, 'visible B row');
    } finally {
      b.update('Items', item, { Title: 'visible B row' });
    }
  });
}

test('A account restrictions still apply when the token includes a denied layout', async () => {
  const c = cases[0];
  const r = await rest(c.token, 'A', 'layouts/AccountDenied/records');
  assert.equal(r.body.messages[0].code, '105');
  const m = await tool(c.token, 'find_records', { database: 'A', layout: 'AccountDenied' });
  assert.equal(m.isError, true, m.text);
  const hidden = await rest(c.token, 'A', `layouts/Parents/records/${hiddenParent}`);
  assert.notEqual(hidden.body.messages[0].code, '0');
  const hiddenMcp = await tool(c.token, 'get_record', { database: 'A', layout: 'Parents', recordId: hiddenParent });
  assert.equal(hiddenMcp.isError, true, hiddenMcp.text);
});

for (const action of ['find', 'create', 'edit']) for (const phase of ['', '.prerequest', '.presort']) {
  test(`layout scope: ${action} script${phase} uses token and destination privileges`, async () => {
    const token = cases[2].token;
    for (const [script, expected] of [['CallForbiddenB', '9'], ['CallInspectB', '1|'], ['OutsideScript', '105']]) {
      const key = `script${phase}`;
      const path = action === 'find' ? 'layouts/Parents/_find' : action === 'create' ? 'layouts/Parents/records' : `layouts/Parents/records/${parent}`;
      const body = action === 'find' ? { query: [{ Id: '1' }], [key]: script } : { fieldData: { Id: 1, Visible: 1 }, [key]: script };
      const r = await rest(token, 'A', path, action === 'edit' ? 'PATCH' : 'POST', body);
      try {
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.response[`scriptError${phase}`], expected === '1|' ? '0' : expected);
        assert.equal(r.body.response[`scriptResult${phase}`], expected);
      } finally {
        if (action === 'create' && r.body.response.recordId) a.delete('Parents', Number(r.body.response.recordId));
      }
    }
  });
}

test('Execute FileMaker Data API keeps token layout scope and B record/field restrictions', async () => {
  const denied = await rest(cases[2].token, 'A', 'layouts/Parents/script/OutsideApi');
  assert.equal(denied.body.response.scriptResult, '105');
  for (const token of [cases[2].token, a.createApiToken('Owner')]) {
    const r = await rest(token, 'A', 'layouts/Parents/script/CallApiB');
    assert.equal(r.body.response.scriptError, '0');
    const data = JSON.parse(r.body.response.scriptResult);
    assert.equal(data.messages[0].code, '0');
    assert.equal(data.response.dataInfo.foundCount, 1);
    assert.equal(data.response.data.length, 1);
    assert.equal(data.response.data[0].fieldData.Title, 'visible B row');
    assert.equal(data.response.data[0].fieldData.Secret, undefined);
  }
});

test('unscoped full-access Data API account still obeys B privileges', async () => {
  const token = a.createApiToken('Owner');
  for (const [script, expected] of [['CallForbiddenB', '9'], ['CallInspectB', '1|'], ['OutsideScript', '0']]) {
    const r = await rest(token, 'A', `layouts/Parents/script/${script}`);
    assert.equal(r.body.response.scriptError, expected === '1|' ? '0' : expected);
    assert.equal(r.body.response.scriptResult, expected);
  }
});

test('schedules with full access in A obey B script and data privileges', async () => {
  for (const [script, expected] of [['CallForbiddenB', '9'], ['CallInspectB', '1|']]) {
    const add = await fetch(`${base}/tabularius/admin/v1/schedules`, {
      method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ name: script, database: 'A', script, account: 'Owner', everyMinutes: 60 }),
    });
    assert.equal(add.status, 201);
    const { id } = await add.json();
    try {
      const run = await fetch(`${base}/tabularius/admin/v1/schedules/${id}/run`, { method: 'POST', headers: { 'x-tabularius-admin': '1' } });
      assert.equal(run.status, 200);
      const r = await run.json();
      assert.equal(r.error, expected === '1|' ? 0 : Number(expected));
      assert.equal(r.result, expected);
    } finally {
      await fetch(`${base}/tabularius/admin/v1/schedules/${id}`, { method: 'DELETE', headers: { 'x-tabularius-admin': '1' } });
    }
  }
});

test('web client scripts keep token scope and destination privileges', async () => {
  for (const token of [cases[2].token, a.createApiToken('Owner')]) {
    for (const [script, expected] of [['CallForbiddenB', '9'], ['CallInspectB', '1|'], ['OutsideScript', token === cases[2].token ? '105' : '0']]) {
      const scriptId = a.schema.scripts.find((s) => s.name === script)!.id;
      const res = await fetch(`${base}/tabularius/app/v1/databases/A/layouts/Parents/button`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ scriptId, mode: 'browse' }),
      });
      const r = await res.json();
      assert.equal(res.status, 200, JSON.stringify(r));
      assert.equal(r.error, expected === '1|' ? 0 : Number(expected));
      assert.equal(r.result, expected);
    }
  }
  const scriptId = a.schema.scripts.find((s) => s.name === 'CallWriteB')!.id;
  const res = await fetch(`${base}/tabularius/app/v1/databases/A/layouts/Parents/button`, {
    method: 'POST', headers: { authorization: `Bearer ${cases[1].token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ scriptId, mode: 'browse' }),
  });
  assert.notEqual(res.status, 200);
  assert.equal((await res.json()).error.code, 3);
  assert.equal(b.get('Items', item).fieldData.Title, 'visible B row');
});

test('approved script steps keep a full account\'s destination privileges', async () => {
  const res = await fetch(`${base}/tabularius/agent/v1/databases/A/step`, {
    method: 'POST', headers: { authorization: `Bearer ${a.createApiToken('Owner')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ plan: { layout: 'Parents', steps: [{ kind: 'script', script: 'CallForbiddenB' }] }, step: 0 }),
  });
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.result.outcome, 'error');
  assert.match(r.result.message, /error 9/);
});

for (const surface of ['Data API', 'MCP']) {
  test(`${surface}: full-access scripts retain token scope and external field restrictions`, async () => {
    for (const [script, expected, error] of [
      ['ElevatedReadRelated', '', 0], ['ElevatedWriteRelated', '201', 201],
      ['ElevatedOutside', '105', 105], ['ElevatedApiOutside', '105', 105],
    ] as const) {
      assert.equal(a.schema.scripts.find((s) => s.name === script)!.fullAccess, true, 'elevation persisted through hosting');
      if (surface === 'Data API') {
        const r = await rest(cases[2].token, 'A', `layouts/Parents/script/${script}`);
        assert.equal(r.status, 200);
        assert.equal(r.body.response.scriptError, String(error));
        assert.equal(r.body.response.scriptResult, expected);
      } else {
        const r = await tool(cases[2].token, 'run_script', { database: 'A', layout: 'Parents', script });
        assert.equal(r.isError, false, r.text);
        assert.equal(r.data.error, error);
        assert.equal(r.data.result, expected);
      }
      assert.equal(b.get('Items', item).fieldData.Secret, 'B_FIELD_SECRET');
    }
  });

  test(`${surface}: elevated Execute FileMaker Data API retains external record and field restrictions`, async () => {
    let result: string;
    if (surface === 'Data API') {
      const r = await rest(cases[2].token, 'A', 'layouts/Parents/script/ElevatedApiRelated');
      assert.equal(r.body.response.scriptError, '0');
      result = r.body.response.scriptResult;
    } else {
      const r = await tool(cases[2].token, 'run_script', { database: 'A', layout: 'Parents', script: 'ElevatedApiRelated' });
      assert.equal(r.isError, false, r.text);
      assert.equal(r.data.error, 0);
      result = r.data.result;
    }
    const data = JSON.parse(result);
    assert.equal(data.messages[0].code, '0');
    assert.equal(data.response.data.length, 1);
    assert.equal(data.response.data[0].portalData.BItems.length, 1);
    assert.doesNotMatch(result, /B_FIELD_SECRET|B_HIDDEN_ROW|B_HIDDEN_SECRET/);
  });

  test(`${surface}: same-account Re-Login preserves the original token ceiling`, async () => {
    for (const script of ['ReloginOutside', 'ElevatedReloginOutside']) {
      if (surface === 'Data API') {
        const r = await rest(cases[2].token, 'A', `layouts/Parents/script/${script}`);
        assert.equal(r.body.response.scriptError, '105');
        assert.equal(r.body.response.scriptResult, '0|105');
      } else {
        const r = await tool(cases[2].token, 'run_script', { database: 'A', layout: 'Parents', script });
        assert.equal(r.isError, false, r.text);
        assert.equal(r.data.error, 105);
        assert.equal(r.data.result, '0|105');
      }
    }
  });

  test(`${surface}: legitimate full access in both files permits B scripts and data`, async () => {
    const token = a.createApiToken('Both', { layouts: ['Parents'] });
    for (const [script, expected] of [['CallForbiddenB', 'FORBIDDEN_SCRIPT_RAN'], ['CallInspectB', '2|B_FIELD_SECRET']]) {
      if (surface === 'Data API') {
        const r = await rest(token, 'A', `layouts/Parents/script/${script}`);
        assert.equal(r.body.response.scriptError, '0');
        assert.equal(r.body.response.scriptResult, expected);
      } else {
        const r = await tool(token, 'run_script', { database: 'A', layout: 'Parents', script });
        assert.equal(r.isError, false, r.text);
        assert.equal(r.data.error, 0);
        // The field is named Secret: an AI's run that reads it answers no output, the same as get_record hides its value.
        if (script === 'CallInspectB') assert.match(r.data.note, /read a secret field/);
        else assert.equal(r.data.result, expected);
      }
    }
  });
}

for (const phase of ['', '.prerequest', '.presort']) test(`DELETE script${phase} retains token scope and destination privileges`, async () => {
  for (const [script, expected, error] of [['CallForbiddenB', '9', '9'], ['CallInspectB', '1|', '0'], ['ElevatedOutside', '105', '105']]) {
    const record = a.create('Parents', { Id: 77, Visible: 1 }).recordId;
    try {
      const key = `script${phase}`;
      const r = await rest(cases[2].token, 'A', `layouts/Parents/records/${record}?${key}=${script}`, 'DELETE');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.response[`scriptError${phase}`], error);
      assert.equal(r.body.response[`scriptResult${phase}`], expected);
      assert.ok(!a.findIds('Parents').includes(record), 'DELETE still performs the authorized action');
    } finally {
      if (a.findIds('Parents').includes(record)) a.delete('Parents', record);
    }
  }
});

test('actual web-client layout triggers retain destination permissions and token scope', async () => {
  for (const [trigger, script, expected, error] of [
    ['OnModeEnter', 'CallForbiddenB', '9', 9], ['OnModeExit', 'CallInspectB', '1|', 0], ['OnLayoutKeystroke', 'ElevatedOutside', '105', 105],
  ] as const) {
    const res = await fetch(`${base}/tabularius/app/v1/databases/A/layouts/Parents/button`, {
      method: 'POST', headers: { authorization: `Bearer ${cases[2].token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ trigger, mode: 'browse', keystroke: 'x' }),
    });
    const r = await res.json();
    assert.equal(res.status, 200, JSON.stringify(r));
    assert.equal(r.script, script);
    assert.equal(r.error, error);
    assert.equal(r.result, expected);
  }
});

test('read-only ceiling survives elevation and Re-Login in every file', async () => {
  a.applyDesign([{ op: 'createScript', name: 'ReadOnlyWriteTitle', text: 'Set Error Capture [ On ]\nSet Field [ BItems::Title ; "must not write" ]\nExit Script [ Text Result: Get ( LastError ) ]' }]);
  const original = { ...a.schema.scripts.find((s) => s.name === 'ReadOnlyWriteTitle')!, fullAccess: true };
  const scripts = [original, { ...original, steps: [
    ...a.schema.scripts.find((s) => s.name === 'ReloginOutside')!.steps.slice(0, 2),
    ...original.steps,
  ] }];
  const scope = { readOnly: true, layouts: ['Parents'] };
  const privileges = narrowPrivileges(a, a.privileges('Owner'), scope);
  scope.readOnly = false;
  scope.layouts.push('Outside');
  // A read-only token runs no saved script at all (the entry check refuses it), so the ceiling is exercised
  // through unsaved scripts, which are governed by their own steps' checks, as a button's steps are.
  await assert.rejects(runScript(a, 'ReadOnlyWriteTitle', { layout: 'Parents', account: 'Owner', privileges }), { code: 9 });
  for (const saved of scripts) {
    const script = { ...saved, id: -1, name: 'Unsaved ReadOnlyWriteTitle' };
    const r = await runScript(a, script, { layout: 'Parents', account: 'Owner', privileges });
    assert.equal(r.error, 200);
    assert.equal(r.result, '200');
    assert.equal(b.get('Items', item).fieldData.Secret, 'B_FIELD_SECRET');
    assert.equal(b.get('Items', item).fieldData.Title, 'visible B row');
  }
  const outside = { ...a.schema.scripts.find((s) => s.name === 'ElevatedOutside')!, id: -1, name: 'Unsaved ElevatedOutside' };
  assert.equal((await runScript(a, outside, { layout: 'Parents', account: 'Owner', privileges })).result, '105');
});

async function request(token: string, path: string, method = 'GET', body?: unknown, header = 'authorization') {
  const res = await fetch(`${base}${path}`, {
    method, headers: { [header]: header === 'authorization' ? `Bearer ${token}` : token, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

test('debugger rejects excluded reads and read-only live writes from a scoped full-access account', async () => {
  const token = a.createApiToken('Owner', { layouts: ['Parents'], readOnly: true });
  const read = await request(token, `/tabularius/debug/v1/databases/A/current?layout=Vault&recordId=${vault}`);
  assert.equal(read.status, 403);
  assert.equal(read.body.error.code, 9);
  assert.doesNotMatch(JSON.stringify(read.body), /VAULT_SECRET/);
  const write = await request(token, '/tabularius/debug/v1/databases/A/runs', 'POST', { script: 'EditVault', layout: 'Parents', scratch: false, pauseAtStart: false });
  assert.equal(write.status, 403);
  assert.equal(write.body.error.code, 9);
  assert.equal(a.get('Vault', vault).fieldData.Secret, 'VAULT_SECRET');
  const allowed = await request(a.createApiToken('Owner'), `/tabularius/debug/v1/databases/A/current?layout=Vault&recordId=${vault}`);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.fields.Secret, '‹redacted›');
  assert.doesNotMatch(JSON.stringify(allowed.body), /VAULT_SECRET/);
  assert.equal(allowed.body.fields.Title, 'EXCLUDED_PAYROLL_DATA');
  assert.equal(a.get('Vault', vault).fieldData.Secret, 'VAULT_SECRET');
});

test('agent dry-run rebuilds the token ceiling on its copy and never previews excluded data', async () => {
  const token = a.createApiToken('Owner', { layouts: ['Parents'] });
  for (const script of ['EditVault', 'ElevatedEditVault']) {
    const r = await request(token, '/tabularius/agent/v1/databases/A/dry-run', 'POST', { plan: { layout: 'Parents', steps: [{ kind: 'script', script }] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.results[0].outcome, 'error');
    assert.match(r.body.results[0].message, /error 105/);
    assert.equal(r.body.results[0].changed, 0);
    assert.doesNotMatch(JSON.stringify(r.body), /VAULT_SECRET|changed on copy/);
    assert.equal(a.get('Vault', vault).fieldData.Secret, 'VAULT_SECRET');
  }
  const allowed = await request(a.createApiToken('Owner'), '/tabularius/agent/v1/databases/A/dry-run', 'POST', { plan: { layout: 'Parents', steps: [{ kind: 'script', script: 'EditVault' }] } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.results[0].outcome, 'ok');
  assert.equal(allowed.body.results[0].changed, 1);
  assert.match(JSON.stringify(allowed.body), /VAULT_SECRET/);
  assert.equal(a.get('Vault', vault).fieldData.Secret, 'VAULT_SECRET', 'a legitimate dry-run edits only its copy');
  const readOnly = await request(a.createApiToken('Owner', { readOnly: true }), '/tabularius/agent/v1/databases/A/dry-run', 'POST', { plan: { layout: 'Parents', steps: [{ kind: 'set', field: 'Id', value: '999' }] } });
  assert.equal(readOnly.status, 200);
  assert.equal(readOnly.body.results[0].outcome, 'error');
  assert.equal(readOnly.body.results[0].changed, 0);
  assert.equal(a.get('Parents', parent).fieldData.Id, 1);
});

for (const scope of [{ layouts: ['Parents'] }, { readOnly: true }, { layouts: ['Parents'], readOnly: true }]) {
  test(`scoped account cannot use full-access request surfaces: ${JSON.stringify(scope)}`, async () => {
    const token = a.createApiToken('Owner', scope);
    for (const path of [
      '/tabularius/design/v1/databases/A', '/tabularius/security/v1/databases/A',
      '/tabularius/automations/v1/databases/A', '/tabularius/live/v1/databases/A/design',
    ]) {
      const r = await request(token, path);
      assert.equal(r.status, 403, `${path}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error.code, 9);
      assert.doesNotMatch(JSON.stringify(r.body), /VAULT_SECRET/);
    }
  });
}

test('unscoped full access still opens design, security, automations and live design presence', async () => {
  const token = a.createApiToken('Owner');
  for (const path of [
    '/tabularius/design/v1/databases/A', '/tabularius/security/v1/databases/A',
    '/tabularius/automations/v1/databases/A', '/tabularius/live/v1/databases/A/design',
  ]) {
    const r = await request(token, path);
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`);
  }
});

test('SQL and OData reject layout-scoped tokens in either authorization header', async () => {
  const token = a.createApiToken('Owner', { layouts: ['Parents'] });
  for (const header of ['authorization', 'x-fm-data-access-token']) {
    for (const path of ['/tabularius/sql/v1/databases/A?q=SELECT%201', '/fmi/odata/v4/A']) {
      const r = await request(token, path, 'GET', undefined, header);
      assert.equal(r.status, 403, `${header}: ${JSON.stringify(r.body)}`);
      assert.equal(String(r.body.error.code), '9');
    }
  }
});

test('SQL and OData preserve read-only ceilings and surface gates', async () => {
  const token = a.createApiToken('Owner', { readOnly: true });
  const read = await request(token, '/tabularius/sql/v1/databases/A?q=SELECT%201%20AS%20n');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.rows, [[1]]);
  const write = await request(token, `/fmi/odata/v4/A/Vault(${vault})`, 'PATCH', { Secret: 'must not write' });
  assert.equal(write.status, 403);
  assert.equal(String(write.body.error.code), '9');
  const script = await request(token, '/fmi/odata/v4/A/Script.EditVault', 'POST', {});
  assert.equal(script.status, 403);
  assert.equal(a.get('Vault', vault).fieldData.Secret, 'VAULT_SECRET');
  const restOnly = a.createApiToken('Owner', { surfaces: ['fmrest'] });
  for (const header of ['authorization', 'x-fm-data-access-token']) {
    const refused = await request(restOnly, '/tabularius/sql/v1/databases/A?q=SELECT%201', 'GET', undefined, header);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, 9);
  }
});

test('scoped tokens cannot change account credentials or manage second factors', async () => {
  for (const token of [cases[2].token, a.createApiToken('Owner', { readOnly: true })]) {
    const password = await request(token, '/fmi/data/vLatest/databases/A/sessions', 'PATCH', { oldPassword: 'password in A', newPassword: 'blocked replacement' });
    assert.equal(password.status, 403);
    assert.equal(password.body.messages[0].code, '9');
    assert.equal(a.verify('Owner', 'password in A'), true);
    for (const path of ['recovery-codes', 'passkey/register/options']) {
      const r = await request(token, `/fmi/data/vLatest/databases/A/${path}`, 'POST', {});
      assert.equal(r.status, 403);
      assert.equal(r.body.messages[0].code, '9');
    }
  }
});

test('live events and changes feeds filter excluded tables and design events under token privileges', async () => {
  const token = cases[2].token;
  const start = await request(token, '/tabularius/changes/v1/databases/A');
  assert.equal(start.status, 200);
  const abort = new AbortController();
  const res = await fetch(`${base}/tabularius/live/v1/databases/A/events`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
  });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  try {
    assert.match(new TextDecoder().decode((await reader.read()).value), /retry:/);
    a.notify('design', DESIGN_TABLE, undefined, undefined, undefined, undefined, [a.schema.layouts.find((l) => l.name === 'Vault')!.id]);
    a.notify('update', 'Vault', vault, 0);
    a.notify('update', 'Parents', parent, 0);
    let events = '';
    while (!events.includes('"table":"Parents"')) {
      const r = await reader.read();
      assert.equal(r.done, false);
      events += new TextDecoder().decode(r.value);
    }
    assert.doesNotMatch(events, /Vault|_design/);
    const changes = await request(token, `/tabularius/changes/v1/databases/A?since=${start.body.next}`);
    assert.equal(changes.status, 200);
    assert.deepEqual(changes.body.changes.map((c: any) => c.table), ['Parents']);
  } finally {
    abort.abort();
    await reader.cancel().catch(() => {});
  }
});

test('MCP helpers retain B privileges when the originating account has full access in A', async () => {
  const token = a.createApiToken('Owner');
  const profile = await tool(token, 'describe_layout', { database: 'A', layout: 'Parents' });
  assert.equal(profile.isError, false, profile.text);
  assert.doesNotMatch(profile.text, /B_FIELD_SECRET|B_HIDDEN_ROW|B_HIDDEN_SECRET/);
  assert.ok(!profile.data.fields.some((f: any) => f.name === 'BItems::Secret'));
  for (const [name, args] of [
    ['summarize_records', { layout: 'ExternalItems', groupBy: ['Secret'] }],
    ['summarize_records', { layout: 'Parents', groupBy: ['BItems::Secret'] }],
    ['find_data_problems', { layout: 'ExternalItems', fields: ['Secret'] }],
  ] as const) {
    const r = await tool(token, name, { database: 'A', ...args });
    assert.equal(r.isError, true, r.text);
    assert.doesNotMatch(r.text, /B_FIELD_SECRET|B_HIDDEN_SECRET/);
  }
  const args = { database: 'A', layout: 'ExternalItems', data: 'Title\nB_HIDDEN_ROW', headerRow: true, columns: [{ column: 0, field: 'Title', transforms: [] }], keys: ['Title'] };
  const hidden = await tool(token, 'plan_import', args);
  assert.equal(hidden.isError, false, hidden.text);
  assert.equal(hidden.data.preview[0].duplicate, undefined, 'a hidden record cannot be detected through duplicate keys');
  const full = await tool(a.createApiToken('Both'), 'plan_import', args);
  assert.equal(full.isError, false, full.text);
  assert.equal(full.data.preview[0].duplicate.of, 'existing');
});

test('script-failure scratch copies rebuild the original token ceiling', async () => {
  const scope = { layouts: ['Parents'] };
  const r = await explainScriptFailure(a, { script: 'ElevatedEditVault', layout: 'Parents' }, { account: 'Owner', privileges: narrowPrivileges(a, a.privileges('Owner'), scope), scope });
  assert.equal(r.error, 105);
  assert.doesNotMatch(JSON.stringify(r), /VAULT_SECRET|changed on copy/);
  assert.equal(a.get('Vault', vault).fieldData.Secret, 'VAULT_SECRET');
});

for (const stream of [false, true]) test(`assistant internal MCP retains the token ceiling, streamed ${stream}`, async () => {
  const token = a.createApiToken('Owner', { readOnly: true, layouts: ['Parents'] });
  modelRequests.length = 0;
  const res = await fetch(`${base}/tabularius/assistant/v1/databases/A`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(stream ? { accept: 'application/x-ndjson' } : {}) },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'TOKEN_SCOPE_PROBE read the requested record' }], context: { layout: 'Parents', recordId: parent } }),
  });
  assert.equal(res.status, 200);
  const body = await res.text();
  const answer = stream ? body.trim().split('\n').map((line) => JSON.parse(line)).find((line) => line.done)?.done : JSON.parse(body);
  assert.deepEqual(answer.tools, ['get_record']);
  assert.equal(modelRequests.length, 2, 'the stub forces a real tool call followed by its result');
  const result = modelRequests[1].messages.at(-1).content.find((b: any) => b.type === 'tool_result');
  assert.equal(result.is_error, true, 'the account may read Vault, but its token cannot');
  assert.doesNotMatch(JSON.stringify(modelRequests), /EXCLUDED_PAYROLL_DATA|VAULT_SECRET/, 'excluded values never reach the model');
  assert.doesNotMatch(body, /EXCLUDED_PAYROLL_DATA|VAULT_SECRET/, 'excluded values never reach the response');
});

test('assistant internal MCP still permits an unscoped full-access read', async () => {
  modelRequests.length = 0;
  const r = await request(a.createApiToken('Owner'), '/tabularius/assistant/v1/databases/A', 'POST', { messages: [{ role: 'user', content: 'TOKEN_SCOPE_PROBE read the requested record' }], context: { layout: 'Parents' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.tools, ['get_record']);
  assert.equal(modelRequests.length, 2);
  const result = modelRequests[1].messages.at(-1).content.find((b: any) => b.type === 'tool_result');
  assert.equal(!!result.is_error, false);
  assert.match(String(result.content), /EXCLUDED_PAYROLL_DATA/);
  assert.match(r.body.reply, /EXCLUDED_PAYROLL_DATA/);
});

test('assistant snapshots its token ceiling before model calls', async () => {
  const api = new DataApi(host);
  const assistant = new Assistant(host, api, { apiKey: 'test-key', model: 'stub', fastModel: 'stub', baseUrl: `http://127.0.0.1:${(model!.address() as { port: number }).port}` });
  const scope = { readOnly: true, layouts: ['Parents'] };
  const privileges = narrowPrivileges(a, a.privileges('Owner'), scope);
  beforeModelReply = () => {
    scope.readOnly = false;
    scope.layouts.push('Vault');
  };
  modelRequests.length = 0;
  try {
    const r = await assistant.chat(a, 'Owner', [{ role: 'user', content: 'TOKEN_SCOPE_PROBE read the requested record' }], { layout: 'Parents' }, privileges, undefined, {}, scope);
    assert.deepEqual(r.tools, ['get_record']);
    assert.equal(modelRequests.length, 2);
    const result = modelRequests[1].messages.at(-1).content.find((b: any) => b.type === 'tool_result');
    assert.equal(result.is_error, true);
    assert.doesNotMatch(JSON.stringify(modelRequests), /EXCLUDED_PAYROLL_DATA|VAULT_SECRET/);
    assert.doesNotMatch(r.reply, /EXCLUDED_PAYROLL_DATA|VAULT_SECRET/);
  } finally {
    beforeModelReply = undefined;
  }
});

const parentWidgets = [{ title: 'Parents', kind: 'table', layout: 'Parents', groupBy: ['Id'] }];
const vaultWidgets = [{ title: 'Vault groups', kind: 'table', layout: 'Vault', groupBy: ['Secret'] }];

test('scoped dashboard mutations are refused while authorized reads and previews remain available', async () => {
  const boards = new Dashboards(a);
  const owner = a.createApiToken('Owner');
  const made = await request(owner, '/tabularius/dashboards/v1/databases/A', 'POST', { name: 'Dashboard write control', widgets: parentWidgets });
  assert.equal(made.status, 201);
  const id = made.body.dashboard.id;
  const before = boards.get(id)!;
  try {
    for (const scope of [{ readOnly: true }, { layouts: ['Parents'] }, { readOnly: true, layouts: ['Parents'] }]) {
      const token = a.createApiToken('Owner', scope);
      const count = boards.list().length;
      for (const [method, path, body] of [
        ['POST', '/tabularius/dashboards/v1/databases/A', { name: 'Forbidden dashboard', widgets: vaultWidgets }],
        ['PUT', `/tabularius/dashboards/v1/databases/A/${id}`, { name: 'Forbidden rename', widgets: vaultWidgets }],
        ['DELETE', `/tabularius/dashboards/v1/databases/A/${id}`, undefined],
      ] as const) {
        const r = await request(token, path, method, body);
        assert.equal(r.status, 403, JSON.stringify(r.body));
        assert.equal(r.body.error.code, 9);
        assert.equal(boards.list().length, count);
        assert.deepEqual(boards.get(id), before, 'saved dashboard content and ownership are unchanged');
      }
      const read = await request(token, `/tabularius/dashboards/v1/databases/A/${id}`);
      assert.equal(read.status, 200);
      assert.equal(read.body.canChange, false);
      assert.ok(read.body.data[0].foundCount > 0);
      const list = await request(token, '/tabularius/dashboards/v1/databases/A');
      assert.equal(list.status, 200);
      assert.equal(list.body.dashboards.find((d: any) => d.id === id).canChange, false);
      const preview = await request(token, '/tabularius/dashboards/v1/databases/A?preview=1', 'POST', { name: 'Allowed preview', widgets: parentWidgets });
      assert.equal(preview.status, 200);
      assert.ok(preview.body.data[0].foundCount > 0);
      assert.equal(boards.list().length, count, 'preview never persists a dashboard');
    }
    const renamed = await request(owner, `/tabularius/dashboards/v1/databases/A/${id}`, 'PUT', { name: 'Authorized rename' });
    assert.equal(renamed.status, 200);
    assert.equal(boards.get(id)!.name, 'Authorized rename');
    assert.equal((await request(owner, `/tabularius/dashboards/v1/databases/A/${id}`, 'DELETE')).status, 200);
    assert.equal(boards.get(id), undefined);
  } finally {
    boards.delete(id);
  }
});

test('MCP dashboard saves and replacements cannot bypass the token ceiling', async () => {
  const boards = new Dashboards(a);
  const existing = boards.create({ name: 'MCP dashboard write control', widgets: parentWidgets as never }, 'Owner');
  try {
    for (const token of [cases[2].token, a.createApiToken('Owner', { readOnly: true })]) {
      const preview = await tool(token, 'save_dashboard', { database: 'A', name: 'MCP allowed preview', widgets: parentWidgets, preview: true });
      assert.equal(preview.isError, false, preview.text);
      assert.equal(preview.data.preview, true);
      assert.equal(boards.find('MCP allowed preview'), undefined);
      const create = await tool(token, 'save_dashboard', { database: 'A', name: 'MCP forbidden save', widgets: parentWidgets });
      assert.equal(create.isError, true, create.text);
      assert.equal(boards.find('MCP forbidden save'), undefined);
      const replace = await tool(token, 'save_dashboard', { database: 'A', name: existing.name, widgets: vaultWidgets, replace: true });
      assert.equal(replace.isError, true, replace.text);
      assert.deepEqual(boards.get(existing.id), existing);
    }
  } finally {
    boards.delete(existing.id);
  }
});

test('scoped tokens cannot create, run, change, delete or retrieve account-level digests and saved results', async () => {
  const owner = a.createApiToken('Owner');
  const boards = new Dashboards(a);
  const digests = new Digests(a);
  const board = boards.create({ name: 'Digest excluded-data control', widgets: vaultWidgets as never }, 'Owner');
  const made = await request(owner, '/tabularius/digests/v1/databases/A', 'POST', { dashboard: board.id, name: 'Digest scope control', days: [1], at: '08:00', enabled: false });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const digest = made.body.digest;
  try {
    const run = await request(owner, `/tabularius/digests/v1/databases/A/${digest.id}/run`, 'POST', {});
    assert.equal(run.status, 200);
    assert.equal(run.body.run.outcome, 'ok');
    assert.match(JSON.stringify(run.body.run.data), /VAULT_SECRET/, 'the stored result exists and is legitimately readable without scope');
    const before = digests.get(digest.id)!;
    for (const scope of [{ readOnly: true }, { layouts: ['Parents'] }, { readOnly: true, layouts: ['Parents'] }]) {
      const token = a.createApiToken('Owner', scope);
      const count = digests.list().length;
      for (const [method, suffix, body] of [
        ['POST', '', { dashboard: board.id, name: 'Forbidden digest', days: [1], at: '08:00' }],
        ['POST', `/${digest.id}/run`, {}], ['PUT', `/${digest.id}`, { enabled: true, name: 'Forbidden change' }],
        ['DELETE', `/${digest.id}`, undefined], ['GET', '', undefined],
        ['GET', `/${digest.id}`, undefined], ['GET', `/${digest.id}/runs`, undefined],
      ] as const) {
        const r = await request(token, `/tabularius/digests/v1/databases/A${suffix}`, method, body);
        assert.equal(r.status, 403, `${method} ${suffix}: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.error.code, 9);
        assert.doesNotMatch(JSON.stringify(r.body), /VAULT_SECRET/);
        assert.equal(digests.list().length, count);
        assert.deepEqual(digests.get(digest.id), before);
        assert.equal(digests.runs(digest.id).length, 1, 'a denied run never executes or appends saved data');
      }
    }
    for (const suffix of ['', `/${digest.id}`, `/${digest.id}/runs`]) {
      const read = await request(owner, `/tabularius/digests/v1/databases/A${suffix}`);
      assert.equal(read.status, 200);
      assert.match(JSON.stringify(read.body), /VAULT_SECRET/);
    }
    assert.equal((await request(owner, `/tabularius/digests/v1/databases/A/${digest.id}`, 'PUT', { name: 'Authorized digest rename' })).status, 200);
    assert.equal((await request(owner, `/tabularius/digests/v1/databases/A/${digest.id}`, 'DELETE')).status, 200);
    assert.equal(digests.get(digest.id), undefined);
  } finally {
    digests.delete(digest.id);
    boards.delete(board.id);
  }
});

test('scoped dashboard edits cannot change the source of an unrestricted scheduled digest', async () => {
  const boards = new Dashboards(a);
  const digests = new Digests(a);
  const owner = a.createApiToken('Owner');
  const board = boards.create({ name: 'Scheduled digest source control', widgets: parentWidgets as never }, 'Owner');
  const made = await request(owner, '/tabularius/digests/v1/databases/A', 'POST', { dashboard: board.id, days: [1], at: '08:00', enabled: true });
  assert.equal(made.status, 201);
  const digest = made.body.digest;
  try {
    const edit = await request(cases[2].token, `/tabularius/dashboards/v1/databases/A/${board.id}`, 'PUT', { widgets: vaultWidgets });
    assert.equal(edit.status, 403);
    assert.deepEqual(boards.get(board.id)!.widgets, board.widgets);
    const runner = new DigestRunner(host);
    await runner.tick(new Date(digest.next));
    const runs = digests.runs(digest.id);
    assert.equal(runs.length, 1, 'the authorized schedule still runs');
    assert.equal(runs[0].outcome, 'ok');
    assert.equal(runs[0].data[0].layout, 'Parents');
    assert.doesNotMatch(JSON.stringify(runs), /VAULT_SECRET|EXCLUDED_PAYROLL_DATA/);
  } finally {
    digests.delete(digest.id);
    boards.delete(board.id);
  }
});
