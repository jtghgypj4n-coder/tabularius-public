// Soak test: people coming and going on one hosted file for a long time, to
// catch what a short load test can't: memory that only grows, and sessions,
// record locks, live-update streams or timers left behind.
//
//   node scripts/soak.ts <file.fmp12> [--minutes 10] [--users 20] [--wave 20] [--script NAME]
//                        [--max-growth 24] [--warmup 2]
//
// Copies the file to a temporary folder and hosts it in a separate process.
// Users arrive in waves of --wave seconds. In each wave:
// - web client users keep a live-updates stream open while browsing and
//   editing (lock, save, unlock);
// - Data API users list, open and find records, add 1 to a number field
//   without locking (retrying when someone got there first) and, with
//   --script, run that script;
// - some users drop mid-edit: their stream is cut while they hold a lock,
//   and they sign out without unlocking.
// Everyone has signed out by the end of a wave. The server then collects
// garbage and reports, from its metrics, its memory and what it still holds.
//
// Checks: after every wave nothing is left (sessions, locks, live streams),
// active timers and sockets don't trend upward, and the JavaScript heap
// after the first --warmup waves grows by no more than --max-growth MB over
// the rest of the run (its trend, so one noisy sample doesn't decide). Exits
// with 1 when a check fails or a request failed unexpectedly. Nothing outside
// the temporary copy is touched. Scripts run only when named with --script,
// and run with the server's defaults: no network, no email.

import { fork, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PASSWORD = 'soak-test';
const MB = 1024 * 1024;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
}

interface Target { db: string; layout: string; field: string; counter?: string; ids: number[]; words: string[] }

/** Converts the file, adds the soak-test accounts and picks a layout with records and a text field to edit. */
async function prepare(dir: string, users: number): Promise<Target> {
  const { Host } = await import('../packages/server/src/index.ts');
  const host = new Host(dir, () => {});
  try {
    const db = host.names()[0];
    const store = host.get(db)!;
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    if (!full.extendedPrivileges.includes('fmrest')) store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
    for (let i = 1; i <= users; i++) store.setPassword(`soak${i}`, PASSWORD, full.name);
    let best: Target | undefined;
    for (const l of store.layouts()) {
      if (!l.table || l.file) continue;
      let info;
      try {
        info = store.layout(l.name);
      } catch {
        continue;
      }
      const options = (name: string) => store.schema.tables.find((t) => t.name === info.table)?.fields.find((f) => f.name === name)?.options;
      const plain = (name: string) => {
        const o = options(name);
        return !o?.global && (o?.repetitions ?? 1) === 1 && !o?.autoEnter && !o?.validation;
      };
      const field = info.fields.find((f) => f.type === 'text' && !f.calculated && !f.summary && plain(f.name))?.name;
      if (!field) continue;
      const ids = store.findIds(info);
      if (ids.length < 5 || (best && best.ids.length >= ids.length)) continue;
      const counter = info.fields.find((f) => f.type === 'number' && !f.calculated && !f.summary && plain(f.name))?.name;
      const words = ids.slice(0, 100).flatMap((id) => String(store.row(info, id)[field] ?? '').match(/\w{3,}/g) ?? []);
      best = { db, layout: l.name, field, counter, ids, words };
    }
    if (!best) throw new Error('no layout with records and an editable text field');
    return best;
  } finally {
    host.close();
  }
}

interface Sample { wave: number; heapMB: number; rssMB: number; resources: number; sessions: number; held: number; locks: number; streams: number; requests: number }

/** The server's metrics, as name → summed value. */
function parseMetrics(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split('\n')) {
    const m = /^([a-z_]+)(?:\{[^}]*\})? (\S+)$/.exec(line);
    if (m) out.set(m[1], (out.get(m[1]) ?? 0) + Number(m[2]));
  }
  return out;
}

/** Least-squares slope of y over x. */
function slope(points: [number, number][]): number {
  const n = points.length;
  const mx = points.reduce((a, [x]) => a + x, 0) / n;
  const my = points.reduce((a, [, y]) => a + y, 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den ? num / den : 0;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('usage: node scripts/soak.ts <file.fmp12> [--minutes 10] [--users 20] [--wave 20] [--script NAME] [--max-growth 24] [--warmup 2]');
    process.exit(2);
  }
  const users = Number(arg('--users', '20'));
  const minutes = Number(arg('--minutes', '10'));
  const waveSeconds = Number(arg('--wave', '20'));
  const script = process.argv.includes('--script') ? arg('--script', '') : undefined;
  const maxGrowth = Number(arg('--max-growth', '24'));
  const warmup = Number(arg('--warmup', '2'));
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-soak-'));
  let server: ChildProcess | undefined;
  try {
    copyFileSync(file, join(dir, basename(file)));
    const t = await prepare(dir, users);
    console.log(`${users} users in waves of ${waveSeconds}s for ${minutes} min on ${t.db} / layout "${t.layout}" (${t.ids.length} records), editing "${t.field}"${t.counter ? `, adding to "${t.counter}"` : ''}${script ? `, running "${script}"` : ''}`);

    server = fork(import.meta.filename, ['--server', dir], { execArgv: ['--no-warnings', '--expose-gc'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const child = server;
    const base = await new Promise<string>((ok, fail) => {
      child.once('message', (m) => ok((m as { url: string }).url));
      child.once('exit', (code) => fail(new Error(`server exited (${code})`)));
    });
    const gc = () => new Promise<void>((ok) => {
      child.once('message', () => ok());
      child.send('gc');
    });
    const metrics = async () => parseMetrics(await (await fetch(`${base}/tabularius/admin/v1/metrics`, { headers: { 'x-tabularius-admin': '1' } })).text());

    const db = encodeURIComponent(t.db);
    const layoutUrl = `${base}/fmi/data/vLatest/databases/${db}/layouts/${encodeURIComponent(t.layout)}`;
    const lockUrl = (id: number) => `${base}/tabularius/live/v1/databases/${db}/layouts/${encodeURIComponent(t.layout)}/records/${id}/lock`;
    const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const hot = t.ids.slice(0, 5);
    const errors = new Map<string, number>();
    const error = (what: string) => errors.set(what, (errors.get(what) ?? 0) + 1);
    let requests = 0;

    /** A request; answers outside `ok` are errors unless their FileMaker code is in `expected`. */
    async function call(kind: string, url: string, init: RequestInit = {}, ok = [200], expected: string[] = []): Promise<Response | undefined> {
      requests++;
      try {
        const r = await fetch(url, init);
        const body = await r.text();
        if (ok.includes(r.status)) return new Response(body, { status: r.status });
        let code = '';
        try {
          code = JSON.parse(body).messages?.[0]?.code ?? '';
        } catch {}
        if (!expected.includes(String(code))) error(`${kind}: HTTP ${r.status}${code ? ` code ${code}` : ''}`);
      } catch (e) {
        error(`${kind}: ${(e as Error).message}`);
      }
      return undefined;
    }

    async function user(n: number, end: number): Promise<void> {
      const login = await call('login', `${base}/fmi/data/vLatest/databases/${db}/sessions`, {
        method: 'POST', headers: { authorization: 'Basic ' + btoa(`soak${n}:${PASSWORD}`), 'content-type': 'application/json' }, body: '{}',
      });
      if (!login) return;
      const token = (await login.json()).response.token as string;
      const auth = { authorization: `Bearer ${token}` };
      const json = { ...auth, 'content-type': 'application/json' };
      const kind = n % 3; // 0: web client, 1: Data API, 2: drops mid-edit
      const live = new AbortController();
      if (kind !== 1) {
        // Read the stream to its end, as the web client does.
        fetch(`${base}/tabularius/live/v1/databases/${db}/events`, { headers: auth, signal: live.signal })
          .then(async (r) => {
            for await (const _ of r.body!) { /* events */ }
          })
          .catch(() => {});
      }
      while (Date.now() < end) {
        const roll = Math.random();
        if (roll < 0.25) {
          await call('list', `${layoutUrl}/records?_offset=${1 + Math.floor(Math.random() * Math.max(1, t.ids.length - 20))}&_limit=20`, { headers: auth });
        } else if (roll < 0.45) {
          await call('get', `${layoutUrl}/records/${pick(t.ids)}`, { headers: auth });
        } else if (roll < 0.6 && t.words.length) {
          await call('find', `${layoutUrl}/_find`, { method: 'POST', headers: json, body: JSON.stringify({ query: [{ [t.field]: pick(t.words) }], limit: 20 }) }, [200], ['401']);
        } else if (kind === 1) {
          if (script && roll < 0.75) {
            await call('script', `${layoutUrl}/script/${encodeURIComponent(script)}`, { headers: auth });
          } else if (t.counter) {
            const id = pick(hot);
            const read = await call('get', `${layoutUrl}/records/${id}`, { headers: auth });
            if (!read) continue;
            const rec = (await read.json()).response.data[0];
            // 301: someone has it locked; 306: someone saved it since we read it.
            await call('increment', `${layoutUrl}/records/${id}`, {
              method: 'PATCH', headers: json, body: JSON.stringify({ fieldData: { [t.counter]: (Number(rec.fieldData[t.counter]) || 0) + 1 }, modId: rec.modId }),
            }, [200], ['301', '306']);
          }
        } else {
          const id = pick(hot);
          const lock = await call('lock', lockUrl(id), { method: 'POST', headers: auth }, [200, 409]);
          if (lock?.status !== 200) continue;
          await call('save', `${layoutUrl}/records/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ fieldData: { [t.field]: `soak${n} ${Date.now()}` } }) }, [200], ['301']);
          // Someone who drops mid-edit: the connection goes, the lock stays until they're signed out.
          if (kind === 2 && Math.random() < 0.3) break;
          await call('unlock', lockUrl(id), { method: 'DELETE', headers: auth });
        }
      }
      live.abort();
      await call('logout', `${base}/fmi/data/vLatest/databases/${db}/sessions/${token}`, { method: 'DELETE' });
    }

    const samples: Sample[] = [];
    const failures: string[] = [];
    const deadline = Date.now() + minutes * 60_000;
    for (let wave = 1; wave === 1 || Date.now() < deadline; wave++) {
      const end = Date.now() + waveSeconds * 1000;
      await Promise.all(Array.from({ length: users }, (_, i) => user(i + 1, end)));
      // Streams close as their connections do; give them a moment.
      let m = await metrics();
      for (let i = 0; i < 40 && (m.get('tabularius_live_streams') || m.get('tabularius_sessions') || m.get('tabularius_record_locks')); i++) {
        await sleep(50);
        m = await metrics();
      }
      await gc();
      m = await metrics();
      const s: Sample = {
        wave,
        heapMB: (m.get('nodejs_heap_used_bytes') ?? 0) / MB,
        rssMB: (m.get('process_resident_memory_bytes') ?? 0) / MB,
        resources: m.get('nodejs_active_resources') ?? 0,
        sessions: m.get('tabularius_sessions') ?? 0,
        held: m.get('tabularius_sessions_held') ?? 0,
        locks: m.get('tabularius_record_locks') ?? 0,
        streams: m.get('tabularius_live_streams') ?? 0,
        requests,
      };
      samples.push(s);
      console.log(`wave ${String(wave).padStart(3)}: heap ${s.heapMB.toFixed(1)} MB, rss ${s.rssMB.toFixed(0)} MB, handles ${s.resources}, requests ${requests}; left: ${s.sessions} sessions (${s.held} held), ${s.locks} locks, ${s.streams} streams`);
      if (s.sessions || s.held || s.locks || s.streams) failures.push(`wave ${wave} left ${s.sessions} sessions (${s.held} held), ${s.locks} locks, ${s.streams} live streams behind`);
    }

    // After warm-up (caches filling, code compiled), memory should level off.
    const steady = samples.slice(Math.min(warmup, samples.length - 2));
    if (steady.length >= 3) {
      const perWave = slope(steady.map((s) => [s.wave, s.heapMB]));
      const growth = perWave * (steady.at(-1)!.wave - steady[0].wave);
      console.log(`heap trend after warm-up: ${perWave >= 0 ? '+' : ''}${(perWave * 1024).toFixed(0)} KB per wave, ${growth.toFixed(1)} MB over ${steady.length} waves (limit ${maxGrowth} MB)`);
      if (growth > maxGrowth) failures.push(`the heap grew ${growth.toFixed(1)} MB after warm-up: memory is leaking`);
      // Sockets come and go between waves, so this is a trend too.
      const handles = slope(steady.map((s) => [s.wave, s.resources])) * (steady.at(-1)!.wave - steady[0].wave);
      console.log(`timers and sockets trend after warm-up: ${handles >= 0 ? '+' : ''}${handles.toFixed(1)} over ${steady.length} waves`);
      if (handles > 10) failures.push(`timers or sockets grew by ${handles.toFixed(0)} after warm-up: something isn't being cleaned up`);
    } else console.log('too few waves to judge memory: run longer, or with a shorter --wave');

    if (errors.size) {
      console.log('errors:');
      for (const [what, n] of errors) console.log(`  ${n} × ${what}`);
    } else console.log('no errors');
    for (const f of failures) console.log(`FAILED: ${f}`);
    if (!failures.length) console.log('checks passed: nothing left behind, memory levels off');
    if (errors.size || failures.length) process.exitCode = 1;
  } finally {
    if (server && server.exitCode === null) {
      const exited = new Promise((ok) => server!.once('exit', ok));
      server.send('stop');
      await Promise.race([exited, sleep(5000)]);
      server.kill();
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--server') {
  // The server process: host the folder, print the URL; collect garbage when asked.
  const { serve } = await import('../packages/server/src/index.ts');
  const { url } = await serve({ dir: process.argv[3], port: 0, watch: false, log: () => {} });
  process.send!({ url });
  process.on('message', (m) => {
    if (m !== 'gc') process.exit(0);
    globalThis.gc!();
    globalThis.gc!();
    process.send!('gc-done');
  });
} else {
  await main();
}
