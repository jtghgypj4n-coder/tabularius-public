import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript } from '../../scripts/src/index.ts';
import { evaluate, evaluateText, num, type PluginFiles } from '../../calc/src/index.ts';
import { PluginManifest } from '../src/manifest.ts';
import { sandboxedCalls } from '../src/sandboxed.ts';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { body, calls, grep, nodes, parse, source, ts } from '../../scripts/test/sandbox-support.ts';

let dir: string;
let docs: string;
let outside: string;
let store: Store;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'sandbox-files-'));
  docs = join(dir, 'Documents'); outside = join(dir, 'Documents-other');
  mkdirSync(docs); mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside sentinel');
  symlinkSync(outside, join(docs, 'escape'), 'dir');
  symlinkSync(join(outside, 'missing'), join(docs, 'dangling'));
  createStore(join(dir, 'Files.sqlite'));
  store = new Store(join(dir, 'Files.sqlite'), 'Files');
});
after(async () => { await stopJavaScript(); store?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

async function files<T>(action: (files: PluginFiles) => T, documents: string | undefined = docs): Promise<T> {
  let answer: T;
  store.plugin = () => ({ min: 0, call: (_args, env) => { answer = action(env.ctx.files!); return num(1); } });
  const run = await runScript(store, { id: 1, name: 'File probe', steps: [{ stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Probe ()' } }] }, { documents });
  assert.equal(run.result, '1', JSON.stringify(run));
  return answer!;
}

test('every plug-in file operation refuses traversal, symlinks and dangling links', async () => {
  for (const path of ['/Documents/../Documents-other/secret.txt', '/Documents/escape/secret.txt', '/Documents/dangling/child',
    '/Documents/.hidden', '/Documents//secret.txt', '/Temporary/../secret.txt', 'filewin:\\Documents\\..\\Documents-other\\secret.txt']) {
    writeFileSync(join(docs, 'local.txt'), 'local sentinel');
    const got = await files((f) => ({ read: f.read(path), size: f.size(path), modified: f.modified!(path), list: f.list!(path, true),
      write: f.write(path, 'clobbered', false), append: f.write(path, 'clobbered', true), makeFolder: f.makeFolder!(path), remove: f.remove!(path),
      copyFrom: f.copy!(path, '/Documents/copy.txt', true), copyTo: f.copy!('/Documents/local.txt', path, true),
      moveFrom: f.move!(path, '/Documents/move.txt', true), moveTo: f.move!('/Documents/local.txt', path, true) }));
    assert.deepEqual(got, { read: undefined, size: undefined, modified: undefined, list: undefined, write: false, append: false,
      makeFolder: 2, remove: 2, copyFrom: 2, copyTo: 2, moveFrom: 2, moveTo: 2 }, path);
    assert.equal(readFileSync(join(outside, 'secret.txt'), 'utf8'), 'outside sentinel');
    assert.equal(readFileSync(join(docs, 'local.txt'), 'utf8'), 'local sentinel');
    assert.equal(existsSync(join(docs, 'copy.txt')), false);
    assert.equal(existsSync(join(outside, 'missing')), false);
  }
  await allowedFileOperations();
});

test('Documents and temporary paths work; arbitrary absolute paths are reduced to a Documents filename', async () => {
  const absolute = join(outside, 'secret.txt');
  assert.equal(await files((f) => f.read(absolute)), undefined, 'the outside file is not read');
  assert.equal(await files((f) => f.write(absolute, 'inside', false)), true);
  assert.equal(readFileSync(join(docs, 'secret.txt'), 'utf8'), 'inside');
  assert.equal(readFileSync(absolute, 'utf8'), 'outside sentinel');
  assert.deepEqual(await files((f) => {
    const written = f.write('/Temporary/note.txt', 'temporary', false);
    return [written, new TextDecoder().decode(f.read('/Temporary/note.txt')), f.size('/Temporary/note.txt')];
  }), [true, 'temporary', 9]);
  assert.equal(await files((f) => f.read('/Temporary/note.txt')), undefined, 'temporary files do not survive a run');
  assert.equal(await files((f) => f.read('/Documents/secret.txt'), ''), undefined, 'no configured Documents means no access');
});

// Positive controls for the refusal matrix, including both paths of copy and move.
async function allowedFileOperations(): Promise<void> {
  const got = await files((f) => {
    const folder = f.makeFolder!('/Documents/work/nested');
    const write = f.write('/Documents/work/nested/a.txt', 'inside', false);
    const copy = f.copy!('/Documents/work/nested/a.txt', '/Documents/work/b.txt', false);
    const move = f.move!('/Documents/work/b.txt', '/Documents/work/c.txt', false);
    const list = f.list!('/Documents/work', true);
    const modified = f.modified!('/Documents/work/c.txt') instanceof Date;
    const read = new TextDecoder().decode(f.read('/Documents/work/c.txt'));
    const remove = f.remove!('/Documents/work');
    return { folder, write, copy, move, list, modified, read, remove };
  });
  assert.deepEqual(got, { folder: 0, write: true, copy: 0, move: 0,
    list: [{ path: 'c.txt', folder: false }, { path: 'nested', folder: true }, { path: 'nested/a.txt', folder: false }],
    modified: true, read: 'inside', remove: 0 });
  assert.equal(existsSync(join(docs, 'work')), false);
}

test('third-party read, readBase64, size and write each require the matching manifest permission', () => {
  for (const op of ['read', 'readBase64', 'size', 'write']) for (const folder of ['documents', 'temporary']) {
    const access = op === 'write' ? 'write' : 'read';
    const path = folder === 'temporary' ? '/Temporary/note.txt' : '/Documents/note.txt';
    const asked: string[] = [];
    const hostFiles = { read: () => { asked.push('read'); return new TextEncoder().encode('ok'); },
      size: () => { asked.push('size'); return 2; }, write: () => { asked.push('write'); return true; } };
    const make = (permissions: string[]) => {
      const manifest = PluginManifest.parse({ id: `org.test.${folder}-${op.toLowerCase()}`, name: 'Probe', version: '1.0.0', api: '^1.0', publisher: 'Test', main: 'main.js',
        functions: [{ name: 'Probe', min: 0 }], permissions: { files: permissions } });
      const code = `const functions = { Probe: () => tabularius.files.${op}(${JSON.stringify(path)}, 'data') };`;
      const call = sandboxedCalls(manifest, code).Probe;
      return { files: hostFiles, plugin: () => ({ min: 0, call }) };
    };
    assert.throws(() => evaluate('Probe ()', make([])), new RegExp(`may not ${access} files in the ${folder}`));
    assert.deepEqual(asked, []);
    const opposite = folder === 'documents' ? 'temporary' : 'documents';
    assert.throws(() => evaluate('Probe ()', make([`${opposite}:${access}`])), /may not/);
    assert.deepEqual(asked, []);
    assert.notEqual(evaluateText('Probe ()', make([`${folder}:${access}`])), '?');
    assert.deepEqual(asked, [op === 'readBase64' ? 'read' : op]);
  }
});

test('a pure plug-in cannot use host files even with matching manifest permission', () => {
  const manifest = PluginManifest.parse({ id: 'org.test.pure', name: 'Pure', version: '1.0.0', api: '^1.0', publisher: 'Test', main: 'main.js',
    functions: [{ name: 'Probe', min: 0, pure: true }], permissions: { files: ['documents:read'] } });
  const call = sandboxedCalls(manifest, 'const functions = { Probe: () => tabularius.files.read("/Documents/note.txt") };').Probe;
  let reads = 0;
  assert.throws(() => evaluate('Probe ()', { plugin: () => ({ min: 0, call }), files: {
    read: () => { reads++; return new Uint8Array(); }, size: () => 0, write: () => false,
  } }), /declared pure and may not call the host/);
  assert.equal(reads, 0);
});

test('source grep lists every plug-in file entry point and checks both layers of guards', (t) => {
  const tree = parse(source('packages/scripts/src/engine.ts'));
  const property = nodes(tree, ts.isPropertyDeclaration).find((n) => n.name.getText() === 'pluginFiles')!;
  const members = nodes(property, ts.isPropertyAssignment).filter((n) => n.parent === property.initializer);
  t.diagnostic(`pluginFiles: ${members.map((n) => n.name.getText()).join(', ')}`);
  assert.deepEqual(members.map((n) => n.name.getText()).sort(), ['read', 'write', 'size', 'makeFolder', 'remove', 'move', 'copy', 'list', 'modified'].sort());
  for (const member of members) assert.ok(calls(member, /^this\.(sandboxPath|sandboxed)$/).length >= (['move', 'copy'].includes(member.name.getText()) ? 2 : 1), member.name.getText());
  assert.equal(calls(body(tree, 'sandboxed'), /^this\.sandboxPath$/).length, 1);
  const entries = grep('packages/plugins/src', /files\?\.(?:\w+)\(/g);
  t.diagnostic(JSON.stringify(entries));
  assert.deepEqual(entries.map((e) => e.match).sort(), ['files?.read(', 'files?.size(', 'files?.write(']);
  const host = body(parse(source('packages/plugins/src/sandboxed.ts')), 'pluginHost');
  const cases = nodes(host, ts.isCaseClause);
  for (const name of ['readBase64', 'size', 'write']) {
    const clause = cases.find((n) => n.expression.getText() === `'${name}'`)!;
    assert.equal(calls(clause, /^requirePluginFileAccess$/).length, 1, name);
  }
  // read shares the readBase64 branch; a new statement there would need its own guard.
  assert.equal(cases.find((n) => n.expression.getText() === "'read'")!.statements.length, 0);
});
