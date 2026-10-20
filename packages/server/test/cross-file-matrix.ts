import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, setAdminPassword } from '../src/index.ts';
import { createStore } from '../../store/src/index.ts';

export const names = ['Aé', 'Bé'] as const;
export const keys = ['fmrest', 'fmodata', 'fmxdbc', 'fmmcp', 'fmapp', 'fmwebdirect'];
export const basic = (account: string, password: string) => 'Basic ' + Buffer.from(`${account}:${password}`).toString('base64');
export const rest = (db: string) => `/fmi/data/vLatest/databases/${db}`;
export function variants(name: string) {
  return [...new Set([name, name.toLowerCase(), name.toUpperCase(), name.normalize('NFD'), name + '.', '..', '../' + name, encodeURIComponent(name), '%2e%2e', name + '%2e'])];
}

/** Only generated stores; children inherit a PATH containing marker-writing stubs. */
export async function openIsolation() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cross-file-'));
  const bin = join(dir, 'bin'), marker = join(dir, 'unexpected-child');
  mkdirSync(bin);
  for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(bin, command), '#!/bin/sh\nprintf forbidden > "$TABULARIUS_TEST_CHILD_MARKER"\nexit 99\n', { mode: 0o755 });
  }
  const oldPath = process.env.PATH, oldMarker = process.env.TABULARIUS_TEST_CHILD_MARKER;
  process.env.PATH = bin;
  process.env.TABULARIUS_TEST_CHILD_MARKER = marker;
  for (const name of names) createStore(join(dir, `${name}.openhbam.sqlite`));
  setAdminPassword(dir, 'isolation-server-password');
  let sqlPort = 0;
  const served = await serve({ dir, port: 0, hostname: '127.0.0.1', sqlPort: 0, watch: false, log: (line) => {
    const match = /PostgreSQL clients: port (\d+)/.exec(line);
    if (match) sqlPort = Number(match[1]);
  } });
  const stores = names.map((name) => served.host.get(name)!);
  for (const [i, store] of stores.entries()) {
    store.setAiPolicy(false);
    store.savePrivilegeSet({ ...store.privilegeSet('[Full Access]')!, extendedPrivileges: keys });
    store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: keys });
    store.setPassword('Shared', `password-${i}`, i === 0 ? '[Full Access]' : 'Reader');
    store.setPassword(`Only${i}`, `only-${i}`, '[Full Access]');
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Key', type: 'number' }, { name: 'Value' }, { name: 'Blob', type: 'container' }] },
      { op: 'createScript', name: 'Read', text: 'Go to Layout [ “Items” ]\nGo to Record/Request/Page [ First ]\nExit Script [ Text Result: Items::Value ]' },
      { op: 'createScript', name: 'Write', text: 'Set Error Capture [ On ]\nGo to Layout [ “Items” ]\nGo to Record/Request/Page [ First ]\nSet Field [ Items::Value ; "changed" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Get ( LastError ) ]' },
      { op: 'createScript', name: 'State', text: 'If [ not IsEmpty ( Get ( ScriptParameter ) ) ]\nSet Variable [ $$isolation ; Value: Get ( ScriptParameter ) ]\nEnd If\nExit Script [ Text Result: $$isolation ]' },
    ]);
    store.create('Items', { Key: 1, Value: `SENTINEL_${i}` });
    store.setContainer('Items', 1, 'Blob', 1, { filename: 'data.txt', mime: 'text/plain', data: Buffer.from(`CONTAINER_${i}`) });
  }
  const [a, b] = stores;
  a.applyDesign([
    { op: 'createDataSource', name: 'Destination', paths: [`file:${b.name}`] },
    { op: 'createOccurrence', name: 'ExternalItems', file: 'Destination', externalTable: b.schema.tables[0].id },
    { op: 'createLayout', name: 'External', occurrence: 'ExternalItems' },
    { op: 'createRelationship', left: 'Items', right: 'ExternalItems', predicates: [{ left: a.schema.tables[0].fields[0].id, right: b.schema.tables[0].fields[0].id }] },
  ]);
  const occurrence = a.schema.tableOccurrences.find((o) => o.name === 'ExternalItems')!;
  const externalObjects = b.design('Items')!.objects.map((o) => o.field ? { ...o, field: { ...o.field, tableOccurrenceId: occurrence.id, tableOccurrence: occurrence.name } } : o);
  a.applyDesign([{ op: 'updateLayout', layout: 'External', design: { objects: externalObjects } }]);
  const related = externalObjects.find((o) => o.field?.field === 'Value')!;
  a.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects: [...a.design('Items')!.objects, { ...related, id: 900 }] } }]);
  // Parameterised existing syntax, not a new text parser rule.
  for (const store of stores) store.applyDesign([{ op: 'createScript', name: 'Call', text: 'Set Error Capture [ On ]\nPerform Script [ Specified: By name ; Get ( ScriptParameter ) ]\nIf [ Get ( LastError ) <> 0 ]\nExit Script [ Text Result: Get ( LastError ) ]\nEnd If\nExit Script [ Text Result: Get ( ScriptResult ) ]' }]);
  async function request(path: string, auth: string, method = 'GET', body?: unknown) {
    const r = await fetch(served.url + path, { method, headers: { authorization: auth, 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    const text = await r.text();
    let data: any;
    try { data = JSON.parse(text); } catch { /* Some authorized surfaces return text. */ }
    return { status: r.status, text, data };
  }
  async function login(i: number, account = 'Shared', password = `password-${i}`, extra = {}) {
    const r = await request(rest(encodeURIComponent(stores[i].name)) + '/sessions', basic(account, password), 'POST', extra);
    assert.equal(r.status, 200, r.text);
    return 'Bearer ' + r.data.response.token;
  }
  const tokens = stores.map((s) => 'Bearer ' + s.createApiToken('Shared'));
  const sessions = await Promise.all(stores.map((_, i) => login(i)));
  return { ...served, stores, tokens, sessions, sqlPort, dir, request, login, async close() {
    try {
      await new Promise<void>((resolve, reject) => served.server.close((e) => e ? reject(e) : resolve()));
      assert.equal(existsSync(marker), false, 'no forbidden child command ran');
    } finally {
      if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
      if (oldMarker === undefined) delete process.env.TABULARIUS_TEST_CHILD_MARKER; else process.env.TABULARIUS_TEST_CHILD_MARKER = oldMarker;
      rmSync(dir, { recursive: true, force: true });
    }
  } };
}
export type Isolation = Awaited<ReturnType<typeof openIsolation>>;
export function denied(r: { status: number; text: string }, label: string) {
  assert.ok([400, 401, 403, 404].includes(r.status), `${label}: ${r.status} ${r.text.slice(0, 250)}`);
  assert.doesNotMatch(r.text, /SENTINEL_|CONTAINER_/, label);
}
