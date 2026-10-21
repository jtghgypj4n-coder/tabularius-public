import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, evaluateText } from '../../calc/src/index.ts';
import { stopJavaScript, javaScriptProcess, callJavaScriptModule, callJavaScript, JS_SANDBOX_IDLE_MS } from '../../store/src/javascript.ts';
import { PluginRegistry, readPlugin, setPluginSecret } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-plugin-'));
after(async () => {
  await stopJavaScript();
  rmSync(dir, { recursive: true });
});

function plugin(name: string, manifest: Record<string, unknown>, main: string): string {
  const d = join(dir, name);
  mkdirSync(d);
  writeFileSync(join(d, 'plugin.json'), JSON.stringify({ name, version: '1.0.0', api: '^1.0', publisher: 'Example', main: 'main.js', ...manifest }));
  writeFileSync(join(d, 'main.js'), main);
  return d;
}

test('declared-pure functions refuse every host operation even with matching permissions', () => {
  const operations = [
    'tabularius.files.read("x")', 'tabularius.files.readBase64("x")', 'tabularius.files.size("x")',
    'tabularius.files.write("x", "value")', 'tabularius.http.request({ url: "https://example.com" })',
    'tabularius.mail.send({ to: "example@example.com" })', 'tabularius.secrets.get("KEY")',
  ];
  const names = operations.map((_, i) => `Pure_Host${i}`);
  const d = plugin('pure-host', {
    id: 'org.example.pure-host',
    functions: names.map((name) => ({ name, min: 0, pure: true })),
    permissions: { files: ['documents:read', 'documents:write'], network: ['example.com'], mail: true, secrets: ['KEY'] },
  }, `const functions = { ${operations.map((op, i) => `${names[i]}: () => { try { return ${op}; } catch { return 'swallowed'; } }`).join(',')} };`);
  const { manifest, calls } = readPlugin(d);
  const reg = new PluginRegistry();
  reg.install(manifest, calls);
  reg.enable('Shop', manifest.id);
  let accessed = 0;
  const touch = () => { accessed++; };
  const ctx = {
    plugin: reg.lookup('Shop'),
    files: { read: () => { touch(); return new Uint8Array(); }, size: () => { touch(); return 1; }, write: () => { touch(); return true; } },
    outbound: { request: touch, mail: touch },
  };
  for (const name of names) assert.throws(() => evaluate(name, ctx), /is declared pure and may not call the host/, name);
  assert.equal(accessed, 0);
});

test('Hog retained heap and crash do not consume Victim budget or put Victim on cooldown', async () => {
  await stopJavaScript();
  const reg = new PluginRegistry();
  for (const name of ['Hog', 'Victim']) {
    const d = plugin(`isolated-${name}`, {
      id: `org.example.isolated-${name.toLowerCase()}`, permissions: { memoryMb: 32, timeoutMs: 5000 },
      functions: [{ name: `${name}_Keep`, min: 0 }, { name: `${name}_Crash`, min: 0 }],
    }, `let chunks = []; let n = 0; const functions = {
      ${name}_Keep: () => { if (!chunks.length) for (let i = 0; i < 18; i++) chunks.push(new Array(131072).fill(i)); return ++n; },
      ${name}_Crash: () => { for (;;) chunks.push(new Array(131072).fill(1)); },
    };`);
    const { manifest, calls } = readPlugin(d);
    reg.install(manifest, calls);
    reg.enable('Shop', manifest.id);
  }
  const ctx = { plugin: reg.lookup('Shop') };
  assert.equal(evaluateText('Hog_Keep', ctx), '1');
  const hog = javaScriptProcess();
  assert.equal(evaluateText('Victim_Keep', ctx), '1');
  const victim = javaScriptProcess();
  assert.notEqual(hog, victim);
  assert.throws(() => evaluate('Hog_Crash', ctx), /more than 32 MB/);
  assert.equal(evaluateText('Victim_Keep', ctx), '2');
  assert.equal(javaScriptProcess(), victim);
});

test('alternating plug-ins with different memory budgets reuse their sandbox processes', async () => {
  await stopJavaScript();
  const reg = new PluginRegistry();
  for (const memoryMb of [16, 64]) {
    const d = plugin(`resident-${memoryMb}`, {
      id: `org.example.resident-${memoryMb}`, permissions: { memoryMb }, functions: [{ name: `Resident_${memoryMb}`, min: 0 }],
    }, `let n = 0; const functions = { Resident_${memoryMb}: () => ++n };`);
    const { manifest, calls } = readPlugin(d);
    reg.install(manifest, calls);
    reg.enable('Shop', manifest.id);
  }
  const ctx = { plugin: reg.lookup('Shop') };
  const pids = new Map<number, number | undefined>();
  for (let round = 1; round <= 6; round++) for (const budget of [16, 64]) {
    assert.equal(evaluateText(`Resident_${budget}`, ctx), String(round));
    if (round === 1) pids.set(budget, javaScriptProcess());
    else assert.equal(javaScriptProcess(), pids.get(budget));
  }
  assert.notEqual(pids.get(16), pids.get(64));
});

for (const mode of ['modules', 'budgets', 'custom function'] as const) {
  test(`100 calls rotating over six ${mode} keys keep state and spawn only six sandboxes`, async (t) => {
    await stopJavaScript();
    const modules = Array.from({ length: 6 }, (_, i) => ({
      key: mode === 'budgets' ? 'pool-budgets' : `pool-${mode}-${i}`, name: `pool-${i}`,
      source: 'let n = 0; const functions = { Count: () => ++n };',
    }));
    const counts = Array(6).fill(0);
    const pids = new Set<number>();
    const count = (i: number) => {
      const value = mode === 'custom function' && i === 5
        ? callJavaScript({ name: 'PoolCustom', parameters: [], source: 'return 1' }, []).value
        : callJavaScriptModule(modules[i], 'Count', [], 30_000, undefined, mode === 'budgets' ? 16 + i * 8 : 64).value;
      counts[i]++;
      assert.equal(value, mode === 'custom function' && i === 5 ? 1 : counts[i]);
      const pid = javaScriptProcess();
      assert.ok(pid);
      pids.add(pid);
    };
    // A generous per-call limit, so a loaded machine can't time a call out (which respawns its sandbox).
    // Only spawns are asserted: the eviction regression respawned a sandbox on every call, and counts and
    // process ids show that without timing.
    const began = performance.now();
    for (let i = 0; i < 100; i++) count(i % 6);
    t.diagnostic(`${mode}: ${pids.size} sandbox spawns; ${(performance.now() - began).toFixed(2)} ms/100 calls including startup`);
    assert.equal(pids.size, 6);
    await stopJavaScript();
  });
}

test('only idle sandboxes expire; active modules keep their state', async (t) => {
  await stopJavaScript();
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const mod = (key: string) => ({ key, name: key, source: 'let n = 0; const functions = { Count: () => ++n };' });
  const active = mod('idle-active'), idle = mod('idle-expired');
  const count = (m: ReturnType<typeof mod>) => callJavaScriptModule(m, 'Count', []).value;
  assert.equal(count(idle), 1);
  const idlePid = javaScriptProcess();
  assert.equal(count(active), 1);
  const activePid = javaScriptProcess();
  now += JS_SANDBOX_IDLE_MS - 1;
  assert.equal(count(active), 2);
  now += 2;
  assert.equal(count(active), 3);
  assert.equal(javaScriptProcess(), activePid);
  assert.equal(count(idle), 1);
  assert.notEqual(javaScriptProcess(), idlePid);
  await stopJavaScript();
  assert.equal(javaScriptProcess(), undefined);
});

for (const mode of ['untouched', 'resident', 'running'] as const) {
  test(`a 16 MB plug-in retaining 512 MB of ${mode} ArrayBuffers stops with a memory error and cooldown`, async (t) => {
    await stopJavaScript();
    const mod = { key: `arraybuffers-${mode}`, name: 'ArrayBuffers', source: `
      let retained;
      const functions = { Allocate: () => {
        retained = new Uint8Array(512 * 1024 * 1024);
        ${mode === 'untouched' ? '' : 'retained.fill(1);'}
        ${mode === 'running' ? 'for (;;) {}' : 'return retained.length;'}
      } };
    ` };
    const victim = { key: `arraybuffers-victim-${mode}`, name: 'Victim', source: 'let n = 0; const functions = { Count: () => ++n };' };
    assert.equal(callJavaScriptModule(victim, 'Count', [], 1000, undefined, 16).value, 1);
    const victimPid = javaScriptProcess();
    const began = performance.now();
    assert.throws(() => callJavaScriptModule(mod, 'Allocate', [], 5000, undefined, 16), /more than 16 MB/);
    t.diagnostic(`${mode} 512 MiB allocation stopped after ${(performance.now() - began).toFixed(2)} ms`);
    assert.throws(() => callJavaScriptModule(mod, 'Allocate', [], 5000, undefined, 16), /ran out of time or memory recently/);
    assert.equal(callJavaScriptModule(victim, 'Count', [], 1000, undefined, 16).value, 2);
    assert.equal(javaScriptProcess(), victimPid);
    await stopJavaScript();
  });
}

test('a JavaScript plug-in runs in the sandbox and is bound to its FileMaker calls', () => {
  const d = plugin('text-tools', {
    id: 'org.example.text-tools', owners: ['TrTx'],
    functions: [{ name: 'TrText_Reverse', owner: 'TrTx', index: 3, min: 1, max: 1, pure: true }, { name: 'TrText_Sum', min: 0 }, { name: 'TrText_Leak', min: 0, max: 0 }],
  }, `const functions = {
    TrText_Reverse: (s) => [...s].reverse().join(''),
    TrText_Sum: (...n) => n.reduce((a, b) => a + b, 0),
    TrText_Leak: () => typeof process + typeof require + typeof fetch,
  };`);
  const reg = new PluginRegistry();
  const { manifest, calls } = readPlugin(d);
  reg.install(manifest, calls);
  reg.enable('Shop', manifest.id);
  const ctx = { plugin: reg.lookup('Shop') };
  assert.equal(evaluateText('TrText_Reverse ( "abc" )', ctx), 'cba');
  assert.equal(evaluateText('⟨TrTx:3⟩ ( "xy" )', ctx), 'yx');
  assert.equal(evaluateText('TrText_Sum ( 1 ; 2 ; 3.5 )', ctx), '6.5');
  // Nothing of the server is reachable from plug-in code.
  assert.equal(evaluateText('TrText_Leak', ctx), 'undefinedundefinedundefined');
});

test('plug-in code that throws or runs too long gives "?"', () => {
  const d = plugin('bad', {
    id: 'org.example.bad', functions: [{ name: 'Bad_Throw', min: 0 }, { name: 'Bad_Loop', min: 0 }], permissions: { timeoutMs: 500 },
  }, `const functions = { Bad_Throw: () => { throw new Error('no'); }, Bad_Loop: () => { for (;;) {} } };`);
  const reg = new PluginRegistry();
  const { manifest, calls } = readPlugin(d);
  reg.install(manifest, calls);
  reg.enable('Shop', manifest.id);
  const ctx = { plugin: reg.lookup('Shop') };
  assert.equal(evaluateText('Bad_Throw', ctx), '?');
  assert.throws(() => evaluate('Bad_Loop', ctx), /longer than 500 ms/);
});

test('the server installs plug-ins from its plugins folder and enables them per file as enabled.json says', async () => {
  const { loadPlugins } = await import('../src/index.ts');
  const data = join(dir, 'data');
  mkdirSync(join(data, 'plugins', 'shout'), { recursive: true });
  writeFileSync(join(data, 'plugins', 'shout', 'plugin.json'), JSON.stringify({ id: 'org.example.shout', name: 'Shout', version: '2.0.0', api: '^1.0', publisher: 'Example', main: 'main.js', functions: [{ name: 'Ex_Shout', min: 1, max: 1 }] }));
  writeFileSync(join(data, 'plugins', 'shout', 'main.js'), 'const functions = { Ex_Shout: (s) => s.toUpperCase() + "!" };');
  mkdirSync(join(data, 'plugins', 'broken'));
  writeFileSync(join(data, 'plugins', 'broken', 'plugin.json'), '{}');
  writeFileSync(join(data, 'plugins', 'enabled.json'), JSON.stringify({ Shop: ['org.example.shout', 'org.missing'] }));
  const logs: string[] = [];
  const reg = new PluginRegistry();
  loadPlugins(reg, data, (m) => logs.push(m));
  assert.equal(evaluateText('Ex_Shout ( "hi" )', { plugin: reg.lookup('shop') }), 'HI!');
  assert.equal(evaluate('Ex_Shout ( "hi" )', { plugin: reg.lookup('Other') }).value, '?');
  assert.ok(logs.some((l) => l.startsWith('Plug-in in broken not installed')));
  assert.ok(logs.some((l) => l.startsWith('Plug-in org.missing not enabled for Shop')));
});

test('a plug-in\'s code is loaded once and keeps its own state, dropped after a time-out or a restart', async () => {
  const d = plugin('counter', {
    id: 'org.example.counter', functions: [{ name: 'Ctr_Next', min: 0 }, { name: 'Ctr_Spin', min: 0 }], permissions: { timeoutMs: 500 },
  }, `let n = 0; const functions = { Ctr_Next: () => ++n, Ctr_Spin: () => { for (;;) {} } };`);
  const other = plugin('counter2', { id: 'org.example.counter2', functions: [{ name: 'Ctr2_Next', min: 0 }] },
    `let n = 100; const functions = { Ctr2_Next: () => ++n + (typeof functions.Ctr_Next) };`);
  const reg = new PluginRegistry();
  for (const p of [d, other]) {
    const { manifest, calls } = readPlugin(p);
    reg.install(manifest, calls);
    reg.enable('Shop', manifest.id);
  }
  const ctx = { plugin: reg.lookup('Shop') };
  assert.equal(evaluateText('Ctr_Next & Ctr_Next & Ctr_Next', ctx), '123');
  // Each plug-in has a realm of its own: the other's state and functions aren't there.
  assert.equal(evaluateText('Ctr2_Next', ctx), '101undefined');
  // A call that runs out of time leaves the plug-in loaded afresh.
  assert.throws(() => evaluate('Ctr_Spin', ctx), /longer than 500 ms/);
  assert.equal(evaluateText('Ctr_Next', ctx), '1');
  // So does the sandbox restarting: the code is sent again when it's missing.
  await stopJavaScript();
  assert.equal(evaluateText('Ctr_Next & Ctr2_Next', ctx), '1101undefined');
  // New code (another version) is loaded as new.
  writeFileSync(join(d, 'main.js'), 'let n = 41; const functions = { Ctr_Next: () => ++n, Ctr_Spin: () => 0 };');
  const { manifest, calls } = readPlugin(d);
  reg.install(manifest, calls);
  assert.equal(evaluateText('Ctr_Next', { plugin: reg.lookup('Shop') }), '42');
});

test('a plug-in reads and writes files through the host, only in the folders its manifest asks for', () => {
  const d = plugin('notes', {
    id: 'org.example.notes', permissions: { files: ['documents:read', 'documents:write'] },
    functions: [{ name: 'Nt_Append', min: 2, max: 2 }, { name: 'Nt_Read', min: 1, max: 1 }, { name: 'Nt_Temp', min: 0 }, { name: 'Nt_Swallow', min: 1 }],
  }, `let calls = 0;
  const functions = {
    Nt_Append: (path, line) => tabularius.files.write(path, (tabularius.files.read(path) ?? '') + line + '\\n') ? tabularius.files.size(path) : -1,
    Nt_Read: (path) => tabularius.files.read(path) ?? 'missing',
    Nt_Temp: () => tabularius.files.read('/x/Temporary/t.txt'),
    // A plug-in that catches the host's question still gets it answered.
    Nt_Swallow: (path) => { calls++; try { return tabularius.files.read(path); } catch { return 'caught'; } },
  };`);
  const store = new Map<string, Uint8Array>();
  const writes: string[] = [];
  const files = {
    read: (p: string) => store.get(p),
    write: (p: string, c: string | Uint8Array, append: boolean) => {
      writes.push(p);
      const bytes = typeof c === 'string' ? new TextEncoder().encode(c) : c;
      store.set(p, append && store.has(p) ? new Uint8Array([...store.get(p)!, ...bytes]) : bytes);
      return true;
    },
    size: (p: string) => store.get(p)?.length,
  };
  const reg = new PluginRegistry();
  const { manifest, calls } = readPlugin(d);
  reg.install(manifest, calls);
  reg.enable('Shop', manifest.id);
  const ctx = { plugin: reg.lookup('Shop'), files };
  assert.equal(evaluateText('Nt_Read ( "/Documents/n.txt" )', ctx), 'missing');
  assert.equal(evaluateText('Nt_Append ( "/Documents/n.txt" ; "one" )', ctx), '4');
  assert.equal(evaluateText('Nt_Append ( "/Documents/n.txt" ; "two" )', ctx), '8');
  // Each write happens once, though the call runs again after each answer.
  assert.equal(writes.length, 2);
  assert.equal(evaluateText('Nt_Read ( "/Documents/n.txt" )', ctx), 'one\ntwo\n');
  assert.equal(evaluateText('Nt_Swallow ( "/Documents/n.txt" )', ctx), 'one\ntwo\n');
  // The temporary folder wasn't asked for; nor is anything without a host's files.
  assert.throws(() => evaluate('Nt_Temp', ctx), /may not read files in the temporary folder/);
  assert.equal(evaluateText('Nt_Read ( "/Documents/n.txt" )', { plugin: reg.lookup('Shop') }), 'missing');
});

test('a plug-in\'s web requests and mail are recorded in outbound test mode, only for the hosts it asks for', () => {
  const d = plugin('web', {
    id: 'org.example.web', permissions: { network: ['api.example.com', '*.example.net'], mail: true, files: ['documents:read'] },
    functions: [{ name: 'Web_Post', min: 2, max: 2 }, { name: 'Web_Mail', min: 1, max: 1 }],
  }, `const functions = {
    Web_Post: (url, body) => { const r = tabularius.http.request({ method: 'post', url, body }); return r.status + ':' + r.recorded; },
    Web_Mail: (to) => tabularius.mail.send({ from: 'a@example.com', to, subject: 'Hi', body: 'Hello', attachments: ['x.pdf'] }),
  };`);
  const requests: string[] = [];
  const mails: { to: string; subject: string; attachments: string[] }[] = [];
  const outbound = {
    request: (via: string, method: string, url: string, bytes: number) => { requests.push(`${via} ${method} ${url} ${bytes}`); },
    mail: (_via: string, m: { to: string; subject: string; attachments: string[] }) => { mails.push(m); },
  };
  const reg = new PluginRegistry();
  const { manifest, calls } = readPlugin(d);
  reg.install(manifest, calls);
  reg.enable('Shop', manifest.id);
  const ctx = { plugin: reg.lookup('Shop'), outbound };
  assert.equal(evaluateText('Web_Post ( "https://api.example.com/v1" ; "abc" ) & Web_Post ( "https://eu.example.net/x" ; "" )', ctx), '0:true0:true');
  assert.deepEqual(requests, ['org.example.web:Web_Post POST https://api.example.com/v1 3', 'org.example.web:Web_Post POST https://eu.example.net/x 0']);
  assert.throws(() => evaluate('Web_Post ( "https://evil.example.org/" ; "" )', ctx), /may not reach evil\.example\.org/);
  assert.equal(evaluateText('Web_Mail ( "b@example.com" )', ctx), '1');
  assert.deepEqual(mails.map((m) => [m.to, m.subject, m.attachments]), [['b@example.com', 'Hi', ['x.pdf']]]);
  // Outside test mode nothing goes out.
  assert.throws(() => evaluate('Web_Post ( "https://api.example.com/v1" ; "" )', { plugin: reg.lookup('Shop') }), /network isn't available/);
  assert.equal(requests.length, 2);
});

test('a plug-in reads the secrets its plugin.json names, as the admin set them, and no others', () => {
  const data = join(dir, 'data');
  const root = join(data, 'plugins', 'key');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({
    id: 'org.example.key', name: 'Key', version: '1.0.0', api: '^1.0', publisher: 'Example', main: 'main.js',
    permissions: { secrets: ['API_KEY', 'LICENCE'] }, functions: [{ name: 'Key_Get', min: 1, max: 1 }],
  }));
  writeFileSync(join(root, 'main.js'), 'const functions = { Key_Get: (n) => tabularius.secrets.get(n) ?? "unset" };');
  const reg = new PluginRegistry();
  const { manifest, calls } = readPlugin(root, data);
  reg.install(manifest, calls);
  reg.enable('Shop', manifest.id);
  const ctx = { plugin: reg.lookup('Shop') };
  assert.equal(evaluateText('Key_Get ( "API_KEY" )', ctx), 'unset');
  setPluginSecret(data, 'org.example.key', 'API_KEY', 'sk-123');
  const file = join(data, 'plugins', 'secrets', 'org.example.key.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { API_KEY: 'sk-123' });
  // Set without a restart, and only for this plug-in's server user.
  assert.equal(evaluateText('Key_Get ( "API_KEY" )', ctx), 'sk-123');
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.throws(() => evaluate('Key_Get ( "AWS_KEY" )', ctx), /may not read the secret AWS_KEY/);
  assert.throws(() => setPluginSecret(data, 'org.example.key', 'AWS_KEY', 'x'), /doesn't ask for a secret called AWS_KEY \(it asks for API_KEY, LICENCE\)/);
  assert.throws(() => setPluginSecret(data, 'org.example.nope', 'API_KEY', 'x'), /isn't installed/);
  setPluginSecret(data, 'org.example.key', 'API_KEY', undefined);
  assert.equal(evaluateText('Key_Get ( "API_KEY" )', ctx), 'unset');
  // A secrets file others can read isn't used, and the error doesn't show what's in it.
  if (process.platform !== 'win32') {
    setPluginSecret(data, 'org.example.key', 'LICENCE', 'lic-456');
    chmodSync(file, 0o644);
    assert.throws(() => evaluate('Key_Get ( "LICENCE" )', ctx), (e: Error) => /chmod 600/.test(e.message) && !e.message.includes('lic-456'));
  }
});

for (const memoryMb of [8, 64, 1024]) test(`a ${memoryMb} MB request cannot allocate a 200 MB JavaScript heap and the sandbox recovers`, () => {
  const d = plugin(`memory-${memoryMb}`, {
    id: `org.example.memory-${memoryMb}`,
    permissions: { memoryMb, timeoutMs: 5000 },
    functions: [{ name: 'Mem_Allocate', min: 0 }, { name: 'Mem_OK', min: 0 }],
  }, `const functions = {
    Mem_Allocate: () => { const chunks = []; for (let i = 0; i < 200; i++) chunks.push(new Array(131072).fill(i)); return chunks.length; },
    Mem_OK: () => 42,
  };`);
  const reg = new PluginRegistry();
  const { manifest, calls } = readPlugin(d);
  reg.install(manifest, calls);
  reg.enable('Shop', manifest.id);
  const ctx = { plugin: reg.lookup('Shop') };
  assert.throws(() => evaluate('Mem_Allocate', ctx), new RegExp(`more than ${Math.min(memoryMb, 64)} MB`));
  assert.throws(() => evaluate('Mem_Allocate', ctx), /ran out of time or memory recently/);
  assert.equal(evaluateText('Mem_OK', ctx), '42');
});

test('a smaller plug-in heap budget takes effect after a larger budget was used', () => {
  const source = `const functions = { Mem_Use: () => { const chunks = []; for (let i = 0; i < 24; i++) chunks.push(new Array(131072).fill(i)); return chunks.length; } };`;
  for (const memoryMb of [64, 8, 64]) {
    const d = plugin(`switch-${memoryMb}-${Math.random()}`, {
      id: `org.example.switch-${memoryMb}`, permissions: { memoryMb, timeoutMs: 5000 }, functions: [{ name: 'Mem_Use', min: 0 }],
    }, source);
    const reg = new PluginRegistry();
    const { manifest, calls } = readPlugin(d);
    reg.install(manifest, calls);
    reg.enable('Shop', manifest.id);
    const ctx = { plugin: reg.lookup('Shop') };
    if (memoryMb === 64) assert.equal(evaluateText('Mem_Use', ctx), '24');
    else assert.throws(() => evaluate('Mem_Use', ctx), /more than 8 MB/);
  }
});
