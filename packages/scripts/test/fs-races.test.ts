import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Script, ScriptStep } from '../../fmp12/src/index.ts';
import { createStore, Store, parseScriptText } from '../../store/src/index.ts';
import { num, type PluginFiles } from '../../calc/src/index.ts';
import { withFilesystemHook } from '../../store/src/fs-boundary.ts';
import { runScript } from '../src/index.ts';

function setup(t: import('node:test').TestContext) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-script-races-'));
  const docs = join(dir, 'Documents'), outside = join(dir, 'outside'); fs.mkdirSync(docs); fs.mkdirSync(outside);
  const secret = join(outside, 'secret.txt'); fs.writeFileSync(secret, 'outside');
  const db = join(dir, 'Synthetic.openhbam.sqlite'); createStore(db);
  const store = new Store(db, 'Synthetic');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Doc', type: 'container' }] }]);
  const recordId = Number(store.create('Items', { Name: 'inside' }).recordId);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const run = (steps: ScriptStep[]) => runScript(store, { id: 1, name: 'Synthetic', steps } as Script, { layout: 'Items', foundSet: [recordId], documents: docs });
  const text = (source: string) => run(parseScriptText(source, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params })));
  return { dir, docs, outside, secret, store, recordId, run, text };
}
const field = (name: string) => ({ tableOccurrence: { id: 0, name: 'Items' }, field: { id: 0, name }, repetition: 1 });

for (const operation of ['read', 'write', 'append'] as const) {
  test(`PluginFiles ${operation} refuses a swapped documents parent`, async (t) => {
    const s = setup(t), work = join(s.docs, 'work'); fs.mkdirSync(work);
    fs.writeFileSync(join(work, 'secret.txt'), 'inside');
    let hit = false, refused = false;
    s.store.plugin = () => ({ min: 0, call: (_args, env) => {
      const files: PluginFiles = env.ctx.files!;
      try {
        withFilesystemHook((e) => {
          if (e.phase !== 'checked' || !e.path.endsWith('secret.txt')) return;
          hit = true; fs.renameSync(work, work + '-old'); fs.symlinkSync(s.outside, work);
        }, () => operation === 'read' ? files.read('/Documents/work/secret.txt') : files.write('/Documents/work/secret.txt', 'clobber', operation === 'append'));
      } catch { refused = true; }
      return num(1);
    } });
    const result = await s.text('Exit Script [ Text Result: Probe () ]');
    assert.equal(result.result, '1'); assert.ok(hit); assert.ok(refused);
    assert.equal(fs.readFileSync(s.secret, 'utf8'), 'outside');
  });
}

test('Export Records refuses a replaced parent before creating its output', async (t) => {
  const s = setup(t), target = join(s.docs, 'exports'); fs.mkdirSync(target);
  let hit = false;
  const result = await withFilesystemHook((e) => {
    if (e.operation !== 'open' || e.phase !== 'checked' || !e.path.includes('records.csv.')) return;
    hit = true; fs.renameSync(target, target + '-old'); fs.symlinkSync(s.outside, target);
  }, () => s.run([{ stepId: 36, name: 'Export Records', enabled: true, params: { filePaths: ['file:/Documents/exports/records.csv'], exportFields: [field('Name')] } }]));
  assert.notEqual(result.error, 0);
  assert.ok(hit);
  assert.equal(fs.existsSync(join(s.outside, 'records.csv')), false);
});

test('Insert File refuses a leaf swap without changing its container field', async (t) => {
  const s = setup(t), file = join(s.docs, 'source.txt'); fs.writeFileSync(file, 'inside');
  let hit = false;
  await assert.rejects(withFilesystemHook((e) => {
    if (e.phase !== 'checked' || !e.path.endsWith('/source.txt')) return;
    hit = true; fs.unlinkSync(file); fs.symlinkSync(s.secret, file);
  }, () => s.text('Insert File [ Items::Doc ; “source.txt” ]')));
  assert.ok(hit);
  assert.equal(s.store.containerId('Items', s.recordId, 'Doc'), undefined);
});

test('documents-folder import refuses a swapped file before committing any rows', async (t) => {
  const s = setup(t), reports = join(s.docs, 'reports'); fs.mkdirSync(reports);
  fs.writeFileSync(join(reports, 'first.txt'), 'inside'); fs.writeFileSync(join(reports, 'second.txt'), 'inside');
  let hit = false;
  await assert.rejects(withFilesystemHook((e) => {
    if (e.phase !== 'checked' || !e.path.endsWith('second.txt')) return;
    hit = true; fs.unlinkSync(e.path); fs.symlinkSync(s.secret, e.path);
  }, () => s.text('Import Records [ With dialog: Off ; Table: Items ; Folder: “reports” ; File type: Text files ; Include enclosed folders: On ; Add ; Fields: Items::Name ]')));
  assert.ok(hit);
  assert.equal(s.store.findIds('Items').length, 1);
});

test('temporary script files have private directories and private mode bits', async (t) => {
  const s = setup(t); let checked = false;
  const result = await withFilesystemHook((e) => {
    if (e.phase !== 'opened' || !e.path.endsWith('scratch.txt')) return;
    checked = true;
    assert.equal(fs.statSync(e.path).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dirname(e.path)).mode & 0o777, 0o700);
  }, () => s.text('Create Data File [ “file:/Temporary/scratch.txt” ]'));
  assert.equal(result.error, 0); assert.ok(checked);
});


test('stable Documents aliases retain file and directory access within the sandbox', async (t) => {
  const s = setup(t), real = join(s.docs, 'real'); fs.mkdirSync(real);
  fs.writeFileSync(join(real, 'data.txt'), 'original');
  fs.symlinkSync(real, join(s.docs, 'folder-alias'));
  fs.symlinkSync(join(real, 'data.txt'), join(s.docs, 'file-alias.txt'));
  s.store.plugin = () => ({ min: 0, call: (_args, env) => {
    const f = env.ctx.files!;
    assert.equal(Buffer.from(f.read('/Documents/file-alias.txt')!).toString(), 'original');
    assert.equal(f.write('/Documents/folder-alias/data.txt', 'changed', false), true);
    assert.equal(Buffer.from(f.read('/Documents/file-alias.txt')!).toString(), 'changed');
    return num(1);
  } });
  assert.equal((await s.text('Exit Script [ Text Result: Probe () ]')).result, '1');
});

test('deleting and moving Documents aliases operates on the entry and preserves its target', async (t) => {
  const s = setup(t), real = join(s.docs, 'real'); fs.mkdirSync(real);
  fs.writeFileSync(join(real, 'data.txt'), 'original');
  fs.symlinkSync(real, join(s.docs, 'folder-alias'));
  fs.symlinkSync(join(real, 'data.txt'), join(s.docs, 'file-alias.txt'));
  s.store.plugin = () => ({ min: 0, call: (_args, env) => {
    const f = env.ctx.files!;
    assert.equal(f.remove!('/Documents/folder-alias'), 0);
    assert.equal(f.move!('/Documents/file-alias.txt', '/Documents/moved.txt', false), 0);
    return num(1);
  } });
  assert.equal((await s.text('Exit Script [ Text Result: Probe () ]')).result, '1');
  assert.equal(fs.lstatSync(join(s.docs, 'moved.txt')).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(join(real, 'data.txt'), 'utf8'), 'original');
  const result = await s.text('Delete File [ Target file: “moved.txt” ]');
  assert.equal(result.error, 0);
  assert.equal(fs.existsSync(join(s.docs, 'moved.txt')), false);
  assert.equal(fs.readFileSync(join(real, 'data.txt'), 'utf8'), 'original');
});

test('entry operations refuse an outside parent even when its alias points back inside Documents', async (t) => {
  const s = setup(t), real = join(s.docs, 'real.txt'), outsideAlias = join(s.outside, 'alias.txt');
  fs.writeFileSync(real, 'inside');
  fs.symlinkSync(s.outside, join(s.docs, 'bridge'));
  fs.symlinkSync(real, outsideAlias);
  s.store.plugin = () => ({ min: 0, call: (_args, env) => {
    const f = env.ctx.files!;
    assert.notEqual(f.remove!('/Documents/bridge/alias.txt'), 0);
    assert.notEqual(f.move!('/Documents/bridge/alias.txt', '/Documents/moved.txt', false), 0);
    return num(1);
  } });
  assert.equal((await s.text('Exit Script [ Text Result: Probe () ]')).result, '1');
  assert.equal(fs.lstatSync(outsideAlias).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(real, 'utf8'), 'inside');
});
