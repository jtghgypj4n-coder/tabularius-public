// Load test: many people using one hosted file at once.
//
//   node scripts/loadtest.ts <file.fmp12>|--synthetic [--users 50] [--seconds 30] [--layout L] [--field F] [--records N]
//                            [--hot N] [--counter F] [--profile] [--workers N] [--rate finds-per-second]
//
// Copies the file to a temporary folder, hosts it in a separate process (so
// the clients here don't slow the server down), and has each simulated user
// keep a live-updates stream open while browsing pages of records, opening
// single records, finding, and editing (lock, save, unlock). Prints latency
// per kind of request and every error. Nothing outside the temporary copy is
// touched, and scripts never run.
//
// With --hot N, edits go to the first N records only, so people keep running
// into each other. Then it also checks that nothing went wrong under that:
// - no lost updates: Data API clients that don't lock add 1 to a number field
//   (--counter, or the layout's first one) with the record's modId, retrying
//   when someone else got there first; each record's final value must equal
//   its start plus the increments that were accepted;
// - every person's live-update stream heard about every save made after it opened;
// - no record is left locked once everyone has signed out.
// It exits with 1 when any check fails or a request failed unexpectedly.

import { fork, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const PASSWORD = 'load-test';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
}

interface Target { db: string; layout: string; field: string; ids: number[]; values: string[]; counter?: string; start: Record<number, number> }

/** Converts the file, adds the load-test accounts and picks a layout with many records and a text field to edit. */
async function prepare(dir: string, users: number): Promise<Target> {
  const { Host } = await import('../packages/server/src/index.ts');
  const host = new Host(dir, (m) => console.log(m));
  try {
    const db = host.names()[0];
    const store = host.get(db)!;
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    if (!full.extendedPrivileges.includes('fmrest')) store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
    for (let i = 1; i <= users; i++) store.setPassword(`load${i}`, PASSWORD, full.name);

    const wanted = arg('--layout');
    let best: Target | undefined;
    for (const l of store.layouts()) {
      if (!l.table || l.file || (wanted && l.name !== wanted)) continue;
      let info;
      try {
        info = store.layout(l.name);
      } catch {
        continue;
      }
      // The text field with the most words in it, so finds have something to look for.
      const fields = info.fields.filter((f) => (arg('--field') ? f.name === arg('--field') : f.type === 'text' && !f.calculated && !f.summary));
      if (!fields.length) continue;
      const ids = store.findIds(info);
      const sample = ids.slice(0, 200).map((id) => store.row(info, id));
      const candidates = fields.map((f) => ({ field: f.name, values: sample.map((r) => String(r[f.name] ?? '')).filter((v) => /\w{3}/.test(v)) }))
        .sort((a, b) => b.values.length - a.values.length);
      const { field, values } = candidates[0];
      // Prefer layouts whose records have words to find, then the most records.
      const score = (t: Target) => [t.values.length ? 1 : 0, t.ids.length];
      // A number field each record keeps its own value in: not global, not repeating, auto-entered or validated.
      const plain = (name: string) => {
        const o = store.schema.tables.find((t) => t.name === info.table)?.fields.find((f) => f.name === name)?.options;
        return !o?.global && (o?.repetitions ?? 1) === 1 && !o?.autoEnter && !o?.validation;
      };
      const counter = info.fields.find((f) => (arg('--counter') ? f.name === arg('--counter') : f.type === 'number' && !f.calculated && !f.summary && plain(f.name)))?.name;
      const mine: Target = { db, layout: l.name, field, ids, values, counter, start: {} };
      if (best) {
        const [a, b] = [score(mine), score(best)];
        if (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])) continue;
      }
      best = mine;
    }
    if (!best) throw new Error('no layout with records and an editable text field' + (wanted ? ` named ${wanted}` : ''));
    // A large file: copy existing records until the table has --records of them,
    // with the edited field made of made-up words, so finds match a few records, as on real data.
    const want = Number(arg('--records', '0'));
    if (best.ids.length < want) {
      const info = store.layout(best.layout);
      const editable = info.fields.filter((f) => !f.calculated && !f.summary && f.type !== 'container').map((f) => f.name);
      const rows = best.ids.slice(0, 500).map((id) => {
        const r = store.row(info, id);
        return Object.fromEntries(editable.filter((f) => r[f] !== null && r[f] !== undefined).map((f) => [f, String(r[f])]));
      });
      const syllables = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'ti', 'vo', 'zen', 'dar', 'bel', 'cor', 'fin', 'gus', 'hal', 'jor'];
      const word = () => Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => syllables[Math.floor(Math.random() * syllables.length)]).join('');
      const words = Array.from({ length: 5000 }, word);
      const pick = () => words[Math.floor(Math.random() * words.length)];
      const start = Date.now();
      for (let i = best.ids.length; i < want; i++) store.create(info, { ...rows[i % rows.length], [best.field]: `${pick()} ${pick()} ${pick()}` });
      console.log(`added ${want - best.ids.length} records in ${((Date.now() - start) / 1000).toFixed(1)}s`);
      best.ids = store.findIds(info);
      best.values = best.ids.slice(-200).map((id) => String(store.row(info, id)[best!.field]));
    }
    if (best.counter) {
      const info = store.layout(best.layout);
      for (const id of best.ids.slice(0, Number(arg('--hot', '0')))) best.start[id] = Number(store.row(info, id)[best.counter]) || 0;
    }
    return best;
  } finally {
    host.close();
  }
}

class Stats {
  private readonly times = new Map<string, number[]>();
  readonly errors = new Map<string, number>();

  add(kind: string, ms: number): void {
    let t = this.times.get(kind);
    if (!t) this.times.set(kind, (t = []));
    t.push(ms);
  }

  error(what: string): void {
    this.errors.set(what, (this.errors.get(what) ?? 0) + 1);
  }

  report(seconds: number): string {
    const pct = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
    const rows = [['request', 'count', 'per s', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms']];
    let total = 0;
    for (const [kind, t] of [...this.times].sort()) {
      const s = [...t].sort((a, b) => a - b);
      total += s.length;
      rows.push([kind, String(s.length), (s.length / seconds).toFixed(1), pct(s, 0.5), pct(s, 0.95), pct(s, 0.99), s.at(-1)!.toFixed(1)]);
    }
    rows.push(['all', String(total), (total / seconds).toFixed(1), '', '', '', '']);
    const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
    return rows.map((r) => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ')).join('\n');
  }
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || (file.startsWith('--') && file !== '--synthetic')) {
    console.error('usage: node scripts/loadtest.ts <file.fmp12>|--synthetic [--users 50] [--seconds 30] [--layout L] [--field F] [--records N] [--hot N] [--counter F] [--profile] [--workers N] [--rate finds-per-second]');
    process.exit(2);
  }
  const users = Number(arg('--users', '50'));
  const seconds = Number(arg('--seconds', '30'));
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-load-'));
  let server: ChildProcess | undefined;
  try {
    if (file === '--synthetic') {
      const { createStore, Store } = await import('../packages/store/src/index.ts');
      const { STORE_EXT } = await import('../packages/server/src/host.ts');
      const path = join(dir, 'Synthetic' + STORE_EXT);
      createStore(path);
      const synthetic = new Store(path, 'Synthetic');
      try {
        synthetic.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Counter', type: 'number' }] }]);
        const records = Math.max(100, Number(arg('--records', '2000')));
        for (let i = 0; i < records; i++) synthetic.create('Items', { Name: `synthetic item ${i % 100} search`, Counter: 0 });
      } finally { synthetic.close(); }
    } else copyFileSync(file, join(dir, basename(file)));
    const t = await prepare(dir, users);
    console.log(`${users} users for ${seconds}s on ${t.db} / layout "${t.layout}" (${t.ids.length} records), editing "${t.field}"`);

    const execArgv = ['--no-warnings', ...(process.argv.includes('--profile') ? ['--cpu-prof', `--cpu-prof-dir=${process.cwd()}`] : [])];
    server = fork(import.meta.filename, ['--server', dir, arg('--workers', '1')!], { execArgv, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const base = await new Promise<string>((ok, fail) => {
      server!.once('message', (m) => ok((m as { url: string }).url));
      server!.once('exit', (code) => fail(new Error(`server exited (${code})`)));
    });
    const stats = new Stats();
    const memory: number[] = [];
    const sampleMemory = async () => {
      try {
        const report = await (await fetch(`${base}/tabularius/admin/v1/metrics`)).text();
        const match = /^process_resident_memory_bytes (\d+)/m.exec(report);
        if (match) memory.push(Number(match[1]));
      } catch { /* The load still runs if metrics are unavailable. */ }
    };
    await sampleMemory();
    const memoryTimer = setInterval(() => void sampleMemory(), 500);
    const end = Date.now() + seconds * 1000;
    let events = 0;
    const aborts: AbortController[] = [];
    const db = encodeURIComponent(t.db);
    const layoutUrl = `${base}/fmi/data/vLatest/databases/${db}/layouts/${encodeURIComponent(t.layout)}`;
    const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const hot = Number(arg('--hot', '0'));
    const editIds = hot ? t.ids.slice(0, hot) : t.ids;
    const counter = hot ? t.counter : undefined;
    if (hot) console.log(`edits go to ${editIds.length} records${counter ? `; Data API clients add 1 to "${counter}" without locking` : ''}`);
    // For the checks: every save (record, its new modId, when it was asked for), what each stream heard, increments accepted.
    const saves: { id: number; modId: string; at: number }[] = [];
    const listeners: { from: number; until: number; heard: Set<string> }[] = [];
    const increments = new Map<number, number>();
    let conflicts = 0;

    /** A request, timed; answers outside `ok` are errors unless their FileMaker code is in `expected`. */
    async function timed(kind: string, url: string, init: RequestInit, ok = [200], expected: string[] = []): Promise<Response | undefined> {
      const start = performance.now();
      try {
        const r = await fetch(url, init);
        const body = await r.text();
        stats.add(kind, performance.now() - start);
        if (!ok.includes(r.status)) {
          let code = '';
          try {
            code = JSON.parse(body).messages?.[0]?.code ?? '';
          } catch {}
          if (expected.includes(String(code))) {
            conflicts++;
            return undefined;
          }
          stats.error(`${kind}: HTTP ${r.status}${code ? ` code ${code}` : ''}`);
          return undefined;
        }
        return new Response(body, { status: r.status });
      } catch (e) {
        stats.error(`${kind}: ${(e as Error).message}`);
        return undefined;
      }
    }

    // A fixed offered rate, independent of completion time. This avoids
    // mistaking closed-loop throughput collapse for a safe arrival rate.
    const rate = Number(arg('--rate', '0'));
    if (rate) {
      if (!Number.isInteger(rate) || rate < 1 || rate > 5000) throw new Error('--rate must be an integer from 1 to 5000');
      const tokens = await Promise.all(Array.from({ length: users }, async (_, i) => {
        const response = await fetch(`${base}/fmi/data/vLatest/databases/${db}/sessions`, {
          method: 'POST', headers: { authorization: 'Basic ' + btoa(`load${i + 1}:${PASSWORD}`), 'content-type': 'application/json' }, body: '{}',
        });
        if (!response.ok) throw new Error(`load account ${i + 1} could not sign in: HTTP ${response.status}`);
        return ((await response.json()) as { response: { token: string } }).response.token;
      }));
      let sent = 0;
      const pending: Promise<unknown>[] = [];
      const started = performance.now();
      while (performance.now() < started + seconds * 1000) {
        const due = started + sent * 1000 / rate;
        if (due > performance.now()) await new Promise((resolve) => setTimeout(resolve, due - performance.now()));
        if (performance.now() >= started + seconds * 1000) break;
        const v = pick(t.values).match(/\w{3,}/)?.[0] ?? 'synthetic';
        const token = tokens[sent % tokens.length];
        pending.push(timed('find', `${layoutUrl}/_find`, {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ query: [{ [t.field]: v }], limit: 20 }),
        }));
        sent++;
      }
      await Promise.all(pending);
      clearInterval(memoryTimer);
      await sampleMemory();
      console.log(`offered finds: ${sent} in ${seconds}s (${(sent / seconds).toFixed(1)}/s); ${users} signed-in sessions`);
      console.log(stats.report(seconds));
      if (memory.length) console.log(`server RSS MiB: first ${(memory[0] / 1048576).toFixed(1)}, peak ${(Math.max(...memory) / 1048576).toFixed(1)}, last ${(memory.at(-1)! / 1048576).toFixed(1)}`);
      if (stats.errors.size) {
        for (const [what, n] of stats.errors) console.log(`  ${n} × ${what}`);
        process.exitCode = 1;
      }
      await Promise.all(tokens.map((token) => fetch(`${base}/fmi/data/vLatest/databases/${db}/sessions/${token}`, { method: 'DELETE' }).catch(() => {})));
      return;
    }

    async function user(n: number): Promise<void> {
      const login = await timed('login', `${base}/fmi/data/vLatest/databases/${db}/sessions`, {
        method: 'POST', headers: { authorization: 'Basic ' + btoa(`load${n}:${PASSWORD}`), 'content-type': 'application/json' }, body: '{}',
      });
      if (!login) return;
      const token = (await login.json()).response.token as string;
      const auth = { authorization: `Bearer ${token}` };
      const json = { ...auth, 'content-type': 'application/json' };

      // Live updates, as the web client keeps open.
      const live = new AbortController();
      aborts.push(live);
      const listener = { from: Infinity, until: Infinity, heard: new Set<string>() };
      listeners.push(listener);
      fetch(`${base}/tabularius/live/v1/databases/${db}/events`, { headers: auth, signal: live.signal }).then(async (r) => {
        listener.from = performance.now();
        const reader = r.body!.getReader();
        const text = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += text.decode(value, { stream: true });
          const messages = buf.split('\n\n');
          buf = messages.pop()!;
          for (const m of messages) {
            const data = /^event: change\ndata: (.*)$/m.exec(m)?.[1];
            if (!data) continue;
            events++;
            const e = JSON.parse(data) as { kind: string; recordId: number; modId: number };
            listener.heard.add(`${e.recordId}:${e.modId}`);
          }
        }
      }).catch(() => {});

      while (Date.now() < end) {
        const roll = Math.random();
        const [list, get, find, edit] = hot ? [0.3, 0.4, 0.5, counter ? 0.75 : 1] : [0.4, 0.6, 0.8, 1];
        if (roll < list) {
          const offset = 1 + Math.floor(Math.random() * Math.max(1, t.ids.length - 20));
          await timed('list 20', `${layoutUrl}/records?_offset=${offset}&_limit=20`, { headers: auth });
        } else if (roll < get) {
          await timed('get record', `${layoutUrl}/records/${pick(t.ids)}`, { headers: auth });
        } else if (roll < find && t.values.length) {
          const v = pick(t.values).match(/\w{3,}/)![0];
          await timed('find', `${layoutUrl}/_find`, { method: 'POST', headers: json, body: JSON.stringify({ query: [{ [t.field]: v }], limit: 20 }) }, [200, 401]);
        } else if (roll < edit) {
          // Edit a record the way the web client does: lock, save, unlock.
          const id = pick(editIds);
          const lock = `${base}/tabularius/live/v1/databases/${db}/layouts/${encodeURIComponent(t.layout)}/records/${id}/lock`;
          const got = await timed('lock', lock, { method: 'POST', headers: auth }, [200, 409]);
          if (got?.status !== 200) continue; // someone else is editing it
          const at = performance.now();
          const saved = await timed('save', `${layoutUrl}/records/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ fieldData: { [t.field]: `edited by load${n} ${Date.now()}` } }) });
          if (!saved) stats.error('save failed while holding the lock');
          else saves.push({ id, modId: (await saved.json()).response.modId, at });
          await timed('unlock', lock, { method: 'DELETE', headers: auth });
        } else if (counter) {
          // A Data API client that doesn't lock: read, add 1, save with the modId it read.
          const id = pick(editIds);
          const read = await timed('get record', `${layoutUrl}/records/${id}`, { headers: auth });
          if (!read) continue;
          const rec = (await read.json()).response.data[0];
          const at = performance.now();
          // 301: someone has it locked; 306: someone saved it since we read it.
          const saved = await timed('increment', `${layoutUrl}/records/${id}`, {
            method: 'PATCH', headers: json, body: JSON.stringify({ fieldData: { [counter]: (Number(rec.fieldData[counter]) || 0) + 1 }, modId: rec.modId }),
          }, [200], ['301', '306']);
          if (saved) {
            increments.set(id, (increments.get(id) ?? 0) + 1);
            saves.push({ id, modId: (await saved.json()).response.modId, at });
          }
        }
      }
      listener.until = performance.now();
      logouts.push(() => timed('logout', `${base}/fmi/data/vLatest/databases/${db}/sessions/${token}`, { method: 'DELETE' }));
    }

    const started = performance.now();
    const logouts: Array<() => Promise<Response | undefined>> = [];
    await Promise.all(Array.from({ length: users }, (_, i) => user(i + 1)));
    clearInterval(memoryTimer);
    await sampleMemory();
    const elapsed = (performance.now() - started) / 1000;
    // Live updates for the last saves may still be on their way (from the other
    // worker, in a cluster): give them up to 2 s before closing the streams.
    const missing = () => listeners.some((l) => saves.some((s) => s.at > l.from && s.at < l.until && !l.heard.has(`${s.id}:${s.modId}`)));
    for (let waited = 0; hot && waited < 2000 && missing(); waited += 50) await new Promise((r) => setTimeout(r, 50));
    await Promise.all(logouts.map((logout) => logout()));
    for (const a of aborts) a.abort();
    console.log(stats.report(elapsed));
    if (memory.length) console.log(`server RSS MiB: first ${(memory[0] / 1048576).toFixed(1)}, peak ${(Math.max(...memory) / 1048576).toFixed(1)}, last ${(memory.at(-1)! / 1048576).toFixed(1)}`);
    console.log(`live update events received: ${events}`);

    const failures: string[] = [];
    if (hot) {
      console.log(`saves: ${saves.length}, turned away because someone else got there first: ${conflicts}`);
      // Every save made while a stream was open reached it.
      let missed = 0;
      let expected = 0;
      for (const l of listeners) {
        for (const s of saves) {
          if (s.at <= l.from || s.at >= l.until) continue;
          expected++;
          if (!l.heard.has(`${s.id}:${s.modId}`)) missed++;
        }
      }
      console.log(`live updates: ${expected - missed} of ${expected} saves heard by every open stream`);
      if (missed) failures.push(`${missed} live updates never arrived`);
      // No lost updates: final counter = start + accepted increments.
      if (counter) {
        const login = await fetch(`${base}/fmi/data/vLatest/databases/${db}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`load1:${PASSWORD}`), 'content-type': 'application/json' }, body: '{}' });
        const token = (await login.json()).response.token as string;
        for (const id of editIds) {
          const r = await (await fetch(`${layoutUrl}/records/${id}`, { headers: { authorization: `Bearer ${token}` } })).json();
          const got = Number(r.response.data[0].fieldData[counter]) || 0;
          const want = (t.start[id] ?? 0) + (increments.get(id) ?? 0);
          if (Math.abs(got - want) > 1e-6) failures.push(`record ${id}: "${counter}" is ${got}, expected ${want} (${increments.get(id) ?? 0} increments accepted): an update was lost`);
        }
        console.log(`increments accepted: ${[...increments.values()].reduce((a, b) => a + b, 0)} on ${editIds.length} records`);
        await fetch(`${base}/fmi/data/vLatest/databases/${db}/sessions/${token}`, { method: 'DELETE' });
      }
      // Everyone signed out, so nothing is locked.
      const status = await (await fetch(`${base}/tabularius/admin/v1/status`)).json() as { locks: unknown[] };
      if (status.locks.length) failures.push(`${status.locks.length} records still locked after everyone signed out`);
    }
    if (stats.errors.size) {
      console.log('errors:');
      for (const [what, n] of stats.errors) console.log(`  ${n} × ${what}`);
    } else console.log('no errors');
    for (const f of failures) console.log(`FAILED: ${f}`);
    if (hot && !failures.length) console.log('checks passed: no lost updates, every live update arrived, no locks left');
    if (stats.errors.size || failures.length) process.exitCode = 1;
  } finally {
    if (server && server.exitCode === null) {
      // Asked to stop (rather than killed), so a --profile is written.
      const exited = new Promise((ok) => server!.once('exit', ok));
      server.send('stop');
      let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([exited, new Promise((ok) => { shutdownTimer = setTimeout(ok, 5000); })]);
      } finally {
        if (shutdownTimer) clearTimeout(shutdownTimer);
      }
      server.kill();
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--server') {
  // The server process: host the folder, print the URL.
  const { serve, serveCluster } = await import('../packages/server/src/index.ts');
  // --workers N: the server as N processes (see packages/server/src/cluster.ts).
  const workers = Number(process.argv[4] ?? 1);
  const cluster = workers > 1 ? await serveCluster({ dir: process.argv[3], port: 0, log: () => {} }, workers) : undefined;
  const { url } = cluster ?? await serve({ dir: process.argv[3], port: 0, watch: false, log: () => {} });
  process.send!({ url });
  process.on('message', () => void (cluster?.close() ?? Promise.resolve()).finally(() => process.exit(0)));
} else if (process.env.NODE_TEST_CONTEXT && !process.argv[2]) {
  const { test } = await import('node:test');
  const assert: typeof import('node:assert').strict = (await import('node:assert')).strict;
  test('the load test CLI requires an input file', () => {
    const child = spawnSync(process.execPath, [import.meta.filename], {
      encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    assert.equal(child.status, 2, child.stderr);
    assert.match(child.stderr, /usage: node scripts\/loadtest\.ts <file\.fmp12>/);
  });
} else {
  await main();
}
