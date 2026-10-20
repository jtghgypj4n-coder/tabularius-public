// docs/writing-a-plugin.md, followed as an author would: the manifest and code in the guide are written out as they stand,
// installed, enabled, called from a calculation and a script, packed, signed, installed in another folder, updated and removed;
// a plug-in that loops, throws, eats memory or returns too much is contained; and the Rust example is built when a Rust
// toolchain with the WebAssembly target is there (and skipped, saying why, when it is not).
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store } from '../../store/src/index.ts';
import { serve } from '../../server/src/index.ts';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { evaluate } from '../../calc/src/index.ts';
import { runScript } from '../../scripts/src/index.ts';
import { parseManifest, readPlugin, PluginRegistry } from '../../plugins/src/index.ts';
import { runCli } from './cli-run.ts';
import { root } from './docs-examples.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const guide = readFileSync(join(root, 'docs', 'writing-a-plugin.md'), 'utf8');
const plugins = (dir: string, ...args: string[]) => runCli(main, ['plugins', dir, ...args], { env: { ...process.env, TABULARIUS_HOME: join(tmpdir(), 'tabularius-plugin-tutorial-home') }, timeout: 120_000 });

/** The code block the guide marks `<!-- plugin-file: NAME -->`, exactly as written. */
function fromGuide(name: string): string {
  const m = new RegExp(`<!-- plugin-file: ${name.replace('.', '\\.')} -->\\n\`\`\`\\w*\\n([\\s\\S]*?)\\n\`\`\``).exec(guide);
  assert.ok(m, `the guide has a block marked plugin-file: ${name}`);
  return m[1] + '\n';
}

function folder(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-plugin-tutorial-'));
  t.after(async () => { await stopJavaScript(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  const s = new Store(join(dir, 'Shop.openhbam.sqlite'), 'Shop');
  s.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }]);
  s.close();
  return dir;
}

/** Hosts the folder, adds a calculation field per call and one record, and answers with what each gives. */
async function serveWith(t: TestContext, dir: string, calls: Record<string, string>) {
  const s = new Store(join(dir, 'Shop.openhbam.sqlite'), 'Shop');
  for (const [field, calc] of Object.entries(calls)) s.applyDesign([{ op: 'createField', table: 'People', name: field, kind: 'calculation', calculation: calc, options: { unstored: true } }] as never);
  const id = s.create('People', { Name: 'Ann' }).recordId;
  s.close();
  const running = await serve({ dir, port: 0, log: () => {}, checkFiles: false, watch: false });
  t.after(async () => { await new Promise<void>((r) => { running.server.close(() => r()); running.server.closeAllConnections?.(); }); await running.host.close(); });
  const store = running.host.get('Shop')!;
  return { store, running, id, field: (name: string) => String(store.get('People', id).fieldData[name]) };
}

test('the guide\'s plug-in, written out as printed, installs, is enabled and answers from a calculation and a script', async (t) => {
  const dir = folder(t);
  const where = join(dir, 'plugins', 'my-plugin');
  mkdirSync(where, { recursive: true });
  writeFileSync(join(where, 'plugin.json'), fromGuide('plugin.json'));
  writeFileSync(join(where, 'main.js'), fromGuide('main.js'));

  const listed = await plugins(dir, 'list');
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /My plug-in 1\.0\.0 \(org\.example\.my-plugin\) by Example Ltd: 1 function, not on for any file/);
  const on = await plugins(dir, 'enable', 'Shop', 'org.example.my-plugin');
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /on for Shop when the server next starts/);

  const s = await serveWith(t, dir, { Greeting: 'My_Greet ( Name )' });
  assert.equal(s.field('Greeting'), 'Hello, Ann!');
  const steps = parseScriptText('Exit Script [ Text Result: my_greet ( "script" ) ]', s.store.schema).map((x) => ({ stepId: x.stepId!, name: x.name!, enabled: x.enabled !== false, params: x.params }));
  const result = (await runScript(s.store, { id: 9999, name: 'try', steps } as never, { layout: 'People' })).result;
  assert.equal(result, 'Hello, script!', 'a script calls it too, and the name\'s case does not matter');
  // Turned off, the function is not there and the calculation gives ? (what the guide says a missing function does).
  assert.match((await plugins(dir, 'disable', 'Shop', 'org.example.my-plugin')).stdout, /off for Shop/);
});

test('the api range the guide describes: which forms fit this Tabularius and which are refused', () => {
  const manifest = (api: string) => parseManifest({ id: 'org.example.x', name: 'X', version: '1.0.0', api, publisher: 'Example', main: 'main.js', functions: [{ name: 'X_Fn', min: 0 }] });
  for (const api of ['^1.0', '~1.0', '>=1.0', '1.x', '1.0']) assert.equal(manifest(api).ok, true, api);
  for (const api of ['^2.0', '^1.1', 'latest']) assert.equal(manifest(api).ok, false, api);
  assert.match(guide, /`\^1\.0`, `~1\.0`, `>=1\.0`,\s+`1\.x` and `1\.0` all fit/);
});

test('a plug-in that loops, throws, eats memory or returns far too much is contained, and the server and its other functions carry on', async (t) => {
  const dir = folder(t);
  const where = join(dir, 'plugins', 'misbehaving');
  mkdirSync(where, { recursive: true });
  const names = ['Bad_Loop', 'Bad_Throw', 'Bad_Memory', 'Bad_Huge', 'Good_Echo'];
  writeFileSync(join(where, 'plugin.json'), JSON.stringify({ id: 'org.example.misbehaving', name: 'Misbehaving', version: '1.0.0', api: '^1.0', publisher: 'Example', main: 'main.js',
    permissions: { memoryMb: 16 }, functions: names.map((name) => ({ name, min: 1, max: 1 })) }));
  writeFileSync(join(where, 'main.js'), `const functions = {
  Bad_Loop() { while (true) {} },
  Bad_Throw() { throw new Error('boom'); },
  Bad_Memory() { const keep = []; for (;;) keep.push(new Array(1e6).fill(1)); },
  Bad_Huge() { return 'x'.repeat(200 * 1024 * 1024); },
  Good_Echo(s) { return 'echo ' + s; },
};`);
  writeFileSync(join(dir, 'plugins', 'enabled.json'), JSON.stringify({ Shop: ['org.example.misbehaving'] }));
  const s = await serveWith(t, dir, Object.fromEntries(names.map((n) => [n.replace('_', ''), `${n} ( Name )`])));
  const store = s.store as unknown as { plugin: never };
  const why = (fn: string) => { try { evaluate(`${fn} ( "a" )`, { plugin: store.plugin } as never); return 'no error'; } catch (e) { return (e as Error).message; } };
  assert.equal(why('Bad_Loop'), 'org.example.misbehaving/Bad_Loop took longer than 250 ms');
  assert.equal(why('Bad_Throw'), 'org.example.misbehaving/Bad_Throw: boom');
  assert.match(why('Bad_Memory'), /^org\.example\.misbehaving\/Bad_Memory used more than 16 MB of memory or stopped$/);
  assert.match(why('Bad_Huge'), /^org\.example\.misbehaving\/Bad_Huge used more than 16 MB of memory or stopped$/);
  // As a person's calculation: ?, and the plug-in's well-behaved function still answers.
  for (const field of ['BadLoop', 'BadThrow', 'BadMemory', 'BadHuge']) assert.equal(s.field(field), '?', field);
  assert.equal(s.field('GoodEcho'), 'echo Ann');
  assert.equal((await fetch(`${s.running.url}/`)).status, 200, 'the server still answers');
});

test('packing, signing, installing in another folder, updating and removing a plug-in, as the guide\'s Sharing section says', async (t) => {
  const author = folder(t);
  const source = join(author, 'my-plugin');
  mkdirSync(source);
  writeFileSync(join(source, 'plugin.json'), fromGuide('plugin.json'));
  writeFileSync(join(source, 'main.js'), fromGuide('main.js'));
  const key = join(author, 'key.pem');
  const gen = await plugins(author, 'keygen', key);
  assert.equal(gen.status, 0, gen.stderr);
  const fingerprint = /fingerprint: ([0-9a-f:]+)/.exec(gen.stdout)![1];
  const pack = async (version: string, out: string) => {
    const manifest = JSON.parse(fromGuide('plugin.json'));
    writeFileSync(join(source, 'plugin.json'), JSON.stringify({ ...manifest, version }));
    const r = await plugins(author, 'pack', source, '--key', key, '-o', out);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`signed by ${fingerprint}`));
  };
  await pack('1.0.0', join(author, 'my-plugin-1.0.0.ohplugin'));
  await pack('1.1.0', join(author, 'my-plugin-1.1.0.ohplugin'));

  const user = folder(t);
  const refused = await plugins(user, 'install', join(author, 'my-plugin-1.0.0.ohplugin'));
  assert.notEqual(refused.status, 0, 'a publisher nobody has trusted is refused');
  assert.match(refused.stderr, /--trust /);
  const installed = await plugins(user, 'install', join(author, 'my-plugin-1.0.0.ohplugin'), '--trust', fingerprint);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match((await plugins(user)).stdout, /My plug-in 1\.0\.0 \(org\.example\.my-plugin\)/);
  assert.equal((await plugins(user, 'enable', 'Shop', 'org.example.my-plugin')).status, 0);

  // The same publisher's newer package replaces the old one directly. A package signed by someone else, or a folder put there by
  // hand, is only replaced with --replace (the guide says so).
  const otherKey = join(author, 'other.pem');
  assert.equal((await plugins(author, 'keygen', otherKey)).status, 0);
  const strangers = join(author, 'my-plugin-stranger.ohplugin');
  assert.equal((await plugins(author, 'pack', source, '--key', otherKey, '-o', strangers)).status, 0);
  const otherFingerprint = /signed by ([0-9a-f:]+)/.exec((await plugins(author, 'pack', source, '--key', otherKey, '-o', strangers)).stdout)![1];
  const clash = await plugins(user, 'install', strangers, '--trust', otherFingerprint);
  assert.notEqual(clash.status, 0);
  assert.match(clash.stderr, /Install again with --replace to replace it/);
  const updated = await plugins(user, 'install', join(author, 'my-plugin-1.1.0.ohplugin'), '--trust', fingerprint);
  assert.equal(updated.status, 0, updated.stderr);
  assert.match((await plugins(user)).stdout, /My plug-in 1\.1\.0 \(org\.example\.my-plugin\)/);
  const s = await serveWith(t, user, { Greeting: 'My_Greet ( Name )' });
  assert.equal(s.field('Greeting'), 'Hello, Ann!', 'the installed copy runs');

  // Removing needs it turned off first, as for any plug-in.
  assert.match((await plugins(user, 'uninstall', 'org.example.my-plugin')).stderr, /enabled for Shop/);
  assert.equal((await plugins(user, 'disable', 'Shop', 'org.example.my-plugin')).status, 0);
  assert.equal((await plugins(user, 'uninstall', 'org.example.my-plugin')).status, 0);
  assert.doesNotMatch((await plugins(user)).stdout, /org\.example\.my-plugin/);
});

const wasmTarget = (() => {
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (cargo.status !== 0) return 'no Rust toolchain (cargo not found): install Rust from https://rustup.rs to build the example';
  const installed = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
  if (installed.status !== 0 || !installed.stdout.includes('wasm32-unknown-unknown')) return 'the Rust WebAssembly target is missing: run `rustup target add wasm32-unknown-unknown`';
  return false;
})();

test('the Rust example builds with the steps its README gives and behaves like the main.wasm kept in the repository', { skip: wasmTarget, timeout: 600_000 }, async (t) => {
  const copy = mkdtempSync(join(tmpdir(), 'tabularius-rust-example-'));
  t.after(async () => { await stopJavaScript(); rmSync(copy, { recursive: true, force: true }); });
  const example = join(root, 'examples', 'plugins', 'rust-text-tools');
  cpSync(example, join(copy, 'rust-text-tools'), { recursive: true, filter: (src) => !/[\\/]target([\\/]|$)/.test(src) });
  const built = spawnSync('sh', [join(copy, 'rust-text-tools', 'build.sh')], { encoding: 'utf8', timeout: 540_000 });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const answers = (folder: string) => {
    const reg = new PluginRegistry();
    const { manifest, calls } = readPlugin(folder);
    reg.install(manifest, calls);
    reg.enable('Shop', manifest.id);
    const ctx = { plugin: reg.lookup('Shop') } as never;
    return [evaluate('Ex_Slug ( "Hello, World!" )', ctx).value, evaluate('Ex_WordCount ( "one two  three" )', ctx).value, evaluate('Ex_Add ( 2 ; 3 )', ctx).value];
  };
  assert.deepEqual(answers(join(copy, 'rust-text-tools')), ['hello-world', 3, 5]);
  assert.deepEqual(answers(example), ['hello-world', 3, 5]);
  assert.ok(existsSync(join(example, 'README.md')), 'the example says what it needs to build');
  assert.match(readFileSync(join(example, 'README.md'), 'utf8'), /rustup target add wasm32-unknown-unknown/);
});
