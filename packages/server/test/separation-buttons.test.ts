// A button that runs a script in another hosted file (the data separation model: an interface file whose buttons
// call scripts in the data file). The button keeps the script's id and the data source naming its file; the web
// client runs it there, the solution map and change impact count it, and renaming the script here leaves it alone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, Store } from '../../store/src/index.ts';
import { solutionMap } from '../src/solution-map.ts';
import { crossFileImpact } from '../src/change-impact.ts';
import { resolveTargets } from '../src/insight.ts';

let dir: string;
let server: Server;
let base: string;
let button: number;
const stores: Store[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-button-file-'));
  const byName = new Map<string, Store>();
  const open = (name: string) => {
    createStore(join(dir, name + STORE_EXT));
    const s = new Store(join(dir, name + STORE_EXT), name);
    stores.push(s);
    byName.set(name.toLowerCase(), s);
    return s;
  };
  const b = open('Data');
  b.applyDesign([{ op: 'createScript', name: 'Tick', text: 'Exit Script [ Text Result: Get ( ScriptParameter ) & "@" & Get ( FileName ) ]' }]);
  b.setPassword('Admin', 'pw', '[Full Access]');
  const tick = b.schema.scripts.find((s) => s.name === 'Tick')!.id;
  const a = open('UI');
  a.applyDesign([
    { op: 'createTable', name: 'Home', fields: [{ name: 'Name' }] },
    { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
  ]);
  const source = a.schema.dataSources.find((d) => d.name === 'Data')!;
  // A script here that performs Data's Tick makes it one the button's text can name.
  a.applyDesign([{ op: 'createScript', name: 'Via', steps: [{ stepId: 1, name: 'Perform Script', enabled: true, params: { script: { id: tick, name: 'Tick', file: { id: source.id, name: 'Data' } } } }] }] as never);
  a.applyDesign([{ op: 'createLayout', name: 'Panel', occurrence: 'Home' }]);
  a.applyDesign([{ op: 'updateLayout', layout: 'Panel', design: { objects: [
    { id: 1, kind: 'button', bounds: { top: 0, left: 0, width: 100, height: 20 }, text: 'Tick', action: { text: 'Perform Script [ From file: "Data" ; "Tick" ; Parameter: "from " & Home::Name ]' } } as never,
  ] } }] as never);
  a.create('Home', { Name: 'x' });
  a.setPassword('Admin', 'pw', '[Full Access]');
  button = a.designs().layouts.find((l) => l.name === 'Panel')!.objects[0].id;
  for (const s of stores) s.resolveFile = (n) => byName.get(n.toLowerCase());
  for (const s of stores) s.close();
  const sv = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = sv.server;
  base = sv.url;
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test('a button on another file\'s script is kept with its data source, and the script keeps its name there', () => {
  const [d, ui] = stores;
  const data = new Store(d.path, d.name);
  const u = new Store(ui.path, ui.name);
  try {
    const action = u.designs().layouts.find((l) => l.name === 'Panel')!.objects[0].action!;
    assert.equal(action.stepId, 1);
    assert.equal(action.scriptId, data.schema.scripts.find((s) => s.name === 'Tick')!.id);
    assert.deepEqual(action.file, { id: u.schema.dataSources[0].id, name: 'Data' });
    assert.equal(action.script, undefined);
    assert.equal(action.parameter, '"from " & Home::Name');
    // Renaming a script of this file that happens to share the id (both files number their scripts from 1) leaves the button's other-file script alone.
    assert.equal(u.schema.scripts.find((s) => s.name === 'Via')!.id, action.scriptId, 'the ids collide on purpose');
    u.applyDesign([{ op: 'updateScript', script: 'Via', name: 'Via2' }] as never);
    assert.equal(u.designs().layouts.find((l) => l.name === 'Panel')!.objects[0].action!.script, undefined);
  } finally { u.close(); data.close(); }
});

test('the web client runs the button\'s script in the other file, with the parameter worked out here', async () => {
  const login = await fetch(`${base}/fmi/data/vLatest/databases/UI/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${(await login.json()).response.token}` };
  const r = await fetch(`${base}/tabularius/app/v1/databases/UI/layouts/Panel/button`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ objectId: button, mode: 'browse', recordId: 1 }) });
  const body = await r.json();
  assert.equal(body.error, 0, JSON.stringify(body));
  assert.equal(body.result, 'from x@Data');
});

test('the solution map and change impact count the button as a cross-file reference', () => {
  const [data, ui] = stores.map((s) => new Store(s.path, s.name));
  try {
    const byName = new Map([data, ui].map((s) => [s.name.toLowerCase(), s]));
    for (const s of [data, ui]) s.resolveFile = (n) => byName.get(n.toLowerCase());
    const map = solutionMap([data, ui]);
    const reach = map.references.find((r) => r.via === 'button')!;
    assert.deepEqual([reach.from, reach.item, reach.file, reach.hosted], ['UI', 'Panel', 'Data', true]);
    assert.deepEqual(map.files.find((f) => f.name === 'UI')!.reaches, ['Data']);
    const target = resolveTargets(data, 'Tick', 'script')[0];
    const hits = crossFileImpact(data, [ui], target, 'delete');
    assert.ok(hits.some((h) => /button on layout "Panel"/.test(h.where) && h.breaks), JSON.stringify(hits));
  } finally { data.close(); ui.close(); }
});
