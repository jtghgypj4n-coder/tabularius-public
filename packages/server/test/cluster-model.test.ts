// A model-based test of record locks, caches and live updates across the workers of a cluster. Seeded random operations
// (create, edit, delete, lock, unlock, read, find, sort, two people racing, a sign-out that drops locks) are sent to real
// worker processes through several people's sessions, and a plain model of the records, their modification ids and the locks
// is checked after every step: what each answer says, what every worker then serves for the record, and, at the end, what
// each live-update stream heard and in what order. A failure prints the seed and the smallest operation list that still fails
// (the shrinker drops operations and replays them on a cleaned file); TX seeds: CLUSTER_SEED=<n> replays one, CLUSTER_SEEDS=<n>
// widens the search. The windows where a worker may lag behind are in the table at the end, with the bound the test holds.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { clusterRoute, serveCluster } from '../src/index.ts';
import { createStore, Store } from '../../store/src/index.ts';

type Op =
  | { k: 'create'; s: number; name: string; qty: number }
  | { k: 'edit'; s: number; rec: number; name?: string; qty?: number; mod?: 'fresh' | 'stale' }
  | { k: 'delete'; s: number; rec: number }
  | { k: 'lock'; s: number; rec: number }
  | { k: 'unlock'; s: number; rec: number }
  | { k: 'read'; s: number; rec: number }
  | { k: 'find'; s: number; name: string }
  | { k: 'sort'; s: number; dir: 'ascend' | 'descend' }
  | { k: 'race'; a: number; b: number; rec: number }
  | { k: 'lockRace'; a: number; b: number; rec: number }
  | { k: 'script'; s: number }
  | { k: 'signout'; s: number };

const NAMES = ['alpha', 'beta', 'gamma'];
const QTYS = [1, 2, 3, 5, 8];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(random: () => number, sessions: number, size: number): Op[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const weighted = (table: [string, number][]) => {
    let n = random() * table.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of table) if ((n -= w) < 0) return k;
    return table[0]![0];
  };
  const ops: Op[] = [];
  let made = 0;
  const s = () => Math.floor(random() * sessions);
  const rec = () => Math.floor(random() * (made + 1)); // the ordinal of a record made so far, or one that never was
  for (let i = 0; i < size; i++) {
    const kind = made === 0 ? 'create' : weighted([['create', 14], ['edit', 22], ['delete', 8], ['lock', 14], ['unlock', 10], ['read', 8], ['find', 6], ['sort', 4], ['race', 5], ['lockRace', 5], ['script', 5], ['signout', 4]]);
    switch (kind) {
      case 'create': ops.push({ k: 'create', s: s(), name: pick(NAMES), qty: pick(QTYS) }); made++; break;
      case 'edit': {
        const op: Op = { k: 'edit', s: s(), rec: rec() };
        if (random() < 0.7) op.name = pick(NAMES);
        if (random() < 0.5 || op.name === undefined) op.qty = pick(QTYS);
        if (random() < 0.25) op.mod = random() < 0.5 ? 'fresh' : 'stale';
        ops.push(op);
        break;
      }
      case 'delete': ops.push({ k: 'delete', s: s(), rec: rec() }); break;
      case 'lock': ops.push({ k: 'lock', s: s(), rec: rec() }); break;
      case 'unlock': ops.push({ k: 'unlock', s: s(), rec: rec() }); break;
      case 'read': ops.push({ k: 'read', s: s(), rec: rec() }); break;
      case 'find': ops.push({ k: 'find', s: s(), name: pick(NAMES) }); break;
      case 'sort': ops.push({ k: 'sort', s: s(), dir: pick(['ascend', 'descend'] as const) }); break;
      case 'race': { const a = s(); ops.push({ k: 'race', a, b: (a + 1 + Math.floor(random() * (sessions - 1))) % sessions, rec: rec() }); break; }
      case 'lockRace': { const a = s(); ops.push({ k: 'lockRace', a, b: (a + 1 + Math.floor(random() * (sessions - 1))) % sessions, rec: rec() }); break; }
      case 'script': ops.push({ k: 'script', s: s() }); break;
      case 'signout': ops.push({ k: 'signout', s: s() }); break;
    }
  }
  return ops;
}

// ------------------------------------------------------------------------------------------------ the cluster

interface Session { account: string; token: string; worker: number }
interface Heard { kind: string; recordId: number; modId?: number; account: string }

const DB = 'Work';
const ACCOUNTS = Array.from({ length: 12 }, (_, i) => `person${i + 1}`);

async function startCluster(t: TestContext, workers: number) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cluster-model-'));
  createStore(join(dir, `${DB}.openhbam.sqlite`));
  const store = new Store(join(dir, `${DB}.openhbam.sqlite`), DB);
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }, { name: 'Qty', type: 'number' }] }]);
  store.applyDesign([{ op: 'createScript', name: 'Bump', text: 'Show All Records\nGo to Record/Request/Page [ First ]\nSet Field [ Items::Qty ; Items::Qty + 100 ]\nCommit Records/Requests [ With dialog: Off ]' }]);
  store.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmrest', 'fmapp'] });
  for (const a of ACCOUNTS) store.setPassword(a, 'pw', 'Staff');
  store.close();
  const cluster = await serveCluster({ dir, port: 0, log: () => {} }, workers);
  t.after(async () => {
    await cluster.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const base = cluster.url;
  const data = `${base}/fmi/data/vLatest/databases/${DB}`;
  const route = (account: string) => clusterRoute({ url: `/fmi/data/vLatest/databases/${DB}/sessions`, method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } } as unknown as IncomingMessage, workers);
  // One person on each worker first, then more, so a record is always reachable from every worker.
  const chosen: string[] = [];
  for (let w = 0; w < workers; w++) chosen.push(ACCOUNTS.find((a) => !chosen.includes(a) && route(a) === w)!);
  for (const a of ACCOUNTS) if (chosen.length < Math.max(workers + 1, 4) && !chosen.includes(a)) chosen.push(a);
  // Two more people only listen, on different workers, so a sign-out in the operations never ends a stream.
  const spare = ACCOUNTS.filter((a) => !chosen.includes(a));
  const first = spare.find((a) => route(a) === 0)!;
  const second = spare.find((a) => route(a) !== 0)!;
  return { base, data, accounts: chosen, listeners: [first, second], workers, cluster };
}
type Cluster = Awaited<ReturnType<typeof startCluster>>;

const authorized = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

async function signIn(c: Cluster, account: string): Promise<Session> {
  const r = await fetch(`${c.data}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), 'content-type': 'application/json' }, body: '{}' });
  const token = ((await r.json()) as { response: { token: string } }).response.token;
  return { account, token, worker: parseInt(token.slice(0, 2), 16) };
}

/** A live-updates stream, collecting the changes it hears. */
function listen(c: Cluster, token: string) {
  const heard: Heard[] = [];
  const abort = new AbortController();
  let buffer = '';
  let open!: () => void;
  const ready = new Promise<void>((resolve) => { open = resolve; });
  void fetch(`${c.base}/tabularius/live/v1/databases/${DB}/events`, { headers: authorized(token), signal: abort.signal }).then(async (r) => {
    open();
    const text = new TextDecoder();
    for await (const chunk of r.body!) {
      buffer += text.decode(chunk);
      let at: number;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const line = block.split('\n').find((l) => l.startsWith('data:'));
        const event = line ? (JSON.parse(line.slice(5)) as Heard) : undefined;
        if (event && typeof event.kind === 'string' && typeof event.recordId === 'number') heard.push(event);
      }
    }
  }).catch(() => open());
  return { heard, ready, stop: () => abort.abort() };
}

// ------------------------------------------------------------------------------------------------ the model

interface Rec { name: string; qty: number; mod: number }
type Expected = { kind: string; recordId: number; modId?: number };

class Model {
  recs = new Map<number, Rec>();
  locks = new Map<number, string>();
  /** Every change in the order it was made. */
  changes: (Expected & { account: string; group?: number })[] = [];
  groups = 0;
}

class Mismatch extends Error {}

interface Answer { status: number; code: string; body: any }

async function call(c: Cluster, s: Session, method: string, path: string, body?: unknown): Promise<Answer> {
  const r = await fetch(`${c.data}/${path}`, { method, headers: authorized(s.token), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: r.status, code: String(json?.messages?.[0]?.code ?? json?.error?.code ?? ''), body: json };
}
const lockCall = (c: Cluster, s: Session, rec: number, method: 'POST' | 'DELETE') =>
  fetch(`${c.base}/tabularius/live/v1/databases/${DB}/layouts/Items/records/${rec}/lock`, { method, headers: authorized(s.token) });

/** The records every worker serves, read through a session on each of them. */
async function readEverywhere(c: Cluster, sessions: Session[], rec: number): Promise<Answer[]> {
  const byWorker = new Map<number, Session>();
  for (const s of sessions) if (!byWorker.has(s.worker)) byWorker.set(s.worker, s);
  return Promise.all([...byWorker.values()].map((s) => call(c, s, 'GET', `layouts/Items/records/${rec}`)));
}

/** How long a worker took to serve what the model says, the longest of the run (ms). */
let worstLag = 0;

interface Run { c: Cluster; sessions: Session[]; model: Model; made: number[]; listeners: (ReturnType<typeof listen> & { session: Session })[] }

async function resetFile(c: Cluster) {
  const s = await signIn(c, c.accounts[0]!);
  const list = await call(c, s, 'GET', 'layouts/Items/records?_limit=1000');
  for (const r of list.body?.response?.data ?? []) await call(c, s, 'DELETE', `layouts/Items/records/${r.recordId}`);
  await fetch(`${c.data}/sessions/${s.token}`, { method: 'DELETE' });
}

async function begin(c: Cluster, sessionCount: number): Promise<Run> {
  await resetFile(c);
  const sessions: Session[] = [];
  for (let i = 0; i < sessionCount; i++) sessions.push(await signIn(c, c.accounts[i % c.accounts.length]!));
  // Two streams on different workers hear everything.
  const heardBy = await Promise.all(c.listeners.map((a) => signIn(c, a)));
  const listeners = heardBy.map((s) => ({ ...listen(c, s.token), session: s }));
  await Promise.all(listeners.map((l) => l.ready));
  return { c, sessions, model: new Model(), made: [], listeners };
}

async function finish(run: Run) {
  for (const l of run.listeners) l.stop();
  for (const s of [...run.sessions, ...run.listeners.map((l) => l.session)]) await fetch(`${run.c.data}/sessions/${s.token}`, { method: 'DELETE' }).catch(() => {});
}

const fail = (op: Op, why: string): never => { throw new Mismatch(`${JSON.stringify(op)}: ${why}`); };

async function expectEverywhere(run: Run, op: Op, rec: number) {
  const want = run.model.recs.get(rec);
  const started = Date.now();
  let last = '';
  while (true) {
    const answers = await readEverywhere(run.c, run.sessions, rec);
    last = '';
    for (const a of answers) {
      if (!want) { if (a.code !== '101') last = `a worker still serves record ${rec} (${a.code}) after it was deleted`; }
      else {
        const d = a.body?.response?.data?.[0];
        if (!d) last = `a worker does not serve record ${rec} (${a.code})`;
        else if (d.fieldData.Name !== want.name || d.fieldData.Qty !== want.qty || Number(d.modId) !== want.mod) last = `a worker serves ${d.fieldData.Name}/${d.fieldData.Qty}@${d.modId} for record ${rec}, the model says ${want.name}/${want.qty}@${want.mod}`;
      }
    }
    if (!last) break;
    if (Date.now() - started > LAG_BOUND_MS) return fail(op, `${last}, still after ${LAG_BOUND_MS} ms`);
    await sleep(10);
  }
  worstLag = Math.max(worstLag, Date.now() - started);
}

/** Runs one operation against the cluster and the model, and checks them against each other. */
async function step(run: Run, op: Op): Promise<void> {
  const { c, sessions, model, made } = run;
  const at = (n: number) => sessions[n]!;
  const idOf = (ordinal: number) => made[ordinal] ?? 900_000 + ordinal;
  const mine = (n: number) => at(n).account;
  const note = (change: Expected & { account: string; group?: number }) => model.changes.push(change);
  switch (op.k) {
    case 'create': {
      const a = await call(c, at(op.s), 'POST', 'layouts/Items/records', { fieldData: { Name: op.name, Qty: op.qty } });
      if (a.code !== '0') return fail(op, `create answered ${a.status} ${a.code}`);
      const id = Number(a.body.response.recordId);
      if (Number(a.body.response.modId) !== 0) fail(op, `a new record has modId ${a.body.response.modId}, not 0`);
      if (model.recs.has(id)) fail(op, `record id ${id} is already in use`);
      model.recs.set(id, { name: op.name, qty: op.qty, mod: 0 });
      made.push(id);
      note({ kind: 'create', recordId: id, modId: 0, account: mine(op.s) });
      return expectEverywhere(run, op, id);
    }
    case 'edit': {
      const id = idOf(op.rec);
      const rec = model.recs.get(id);
      const body: Record<string, unknown> = { fieldData: { ...(op.name !== undefined ? { Name: op.name } : {}), ...(op.qty !== undefined ? { Qty: op.qty } : {}) } };
      if (op.mod && rec) body.modId = String(op.mod === 'fresh' ? rec.mod : rec.mod + 5);
      else if (op.mod) body.modId = '0';
      const a = await call(c, at(op.s), 'PATCH', `layouts/Items/records/${id}`, body);
      const holder = model.locks.get(id);
      if (!rec) { if (a.code !== '101') fail(op, `editing a record that is not there answered ${a.code}`); return; }
      if (holder && holder !== mine(op.s)) {
        if (a.code !== '301') fail(op, `a record locked by ${holder} was edited by ${mine(op.s)}: ${a.status} ${a.code}`);
        return expectEverywhere(run, op, id);
      }
      if (op.mod === 'stale') {
        if (a.code !== '306') fail(op, `a stale modId answered ${a.code}`);
        return expectEverywhere(run, op, id);
      }
      if (a.code !== '0') return fail(op, `edit answered ${a.status} ${a.code}`);
      if (Number(a.body.response.modId) !== rec.mod + 1) fail(op, `modId went from ${rec.mod} to ${a.body.response.modId}, not by one`);
      if (op.name !== undefined) rec.name = op.name;
      if (op.qty !== undefined) rec.qty = op.qty;
      rec.mod++;
      note({ kind: 'update', recordId: id, modId: rec.mod, account: mine(op.s) });
      return expectEverywhere(run, op, id);
    }
    case 'delete': {
      const id = idOf(op.rec);
      const rec = model.recs.get(id);
      const a = await call(c, at(op.s), 'DELETE', `layouts/Items/records/${id}`);
      if (!rec) { if (a.code !== '101') fail(op, `deleting a record that is not there answered ${a.code}`); return; }
      const holder = model.locks.get(id);
      if (holder && holder !== mine(op.s)) {
        if (a.code !== '301') fail(op, `a record locked by ${holder} was deleted by ${mine(op.s)}: ${a.status} ${a.code}`);
        return expectEverywhere(run, op, id);
      }
      if (a.code !== '0') return fail(op, `delete answered ${a.status} ${a.code}`);
      model.recs.delete(id);
      if (holder) { model.locks.delete(id); note({ kind: 'unlock', recordId: id, account: holder }); }
      note({ kind: 'delete', recordId: id, account: mine(op.s) });
      return expectEverywhere(run, op, id);
    }
    case 'lock': {
      const id = idOf(op.rec);
      const r = await lockCall(c, at(op.s), id, 'POST');
      const holder = model.locks.get(id);
      if (!model.recs.has(id)) { if (r.status === 200) fail(op, 'locked a record that is not there'); return; }
      if (holder && holder !== mine(op.s)) { if (r.status !== 409) fail(op, `a record locked by ${holder} was locked by ${mine(op.s)}: ${r.status}`); return; }
      if (r.status !== 200) return fail(op, `lock answered ${r.status}`);
      if (!holder) { model.locks.set(id, mine(op.s)); note({ kind: 'lock', recordId: id, account: mine(op.s) }); }
      return;
    }
    case 'unlock': {
      const id = idOf(op.rec);
      const r = await lockCall(c, at(op.s), id, 'DELETE');
      if (r.status !== 200) return fail(op, `unlock answered ${r.status}`);
      const released = ((await r.json()) as { released?: boolean }).released;
      if (released !== (model.locks.get(id) === mine(op.s))) fail(op, `unlock said released: ${released} for a lock held by ${model.locks.get(id) ?? 'no one'}`);
      if (model.locks.get(id) === mine(op.s)) { model.locks.delete(id); note({ kind: 'unlock', recordId: id, account: mine(op.s) }); }
      return;
    }
    case 'read': {
      const id = idOf(op.rec);
      return expectEverywhere(run, op, id);
    }
    case 'find': {
      const a = await call(c, at(op.s), 'POST', 'layouts/Items/_find', { query: [{ Name: `==${op.name}` }] });
      const want = [...model.recs].filter(([, r]) => r.name === op.name).map(([id]) => id).sort((x, y) => x - y);
      if (!want.length) { if (a.code !== '401') fail(op, `a find with no match answered ${a.code}`); return; }
      if (a.code !== '0') return fail(op, `find answered ${a.status} ${a.code}`);
      const got = (a.body.response.data as { recordId: string }[]).map((r) => Number(r.recordId)).sort((x, y) => x - y);
      if (JSON.stringify(got) !== JSON.stringify(want)) fail(op, `found ${got} but the model has ${want}`);
      return;
    }
    case 'sort': {
      const a = await call(c, at(op.s), 'GET', `layouts/Items/records?_limit=1000&_sort=${encodeURIComponent(JSON.stringify([{ fieldName: 'Qty', sortOrder: op.dir }]))}`);
      if (!model.recs.size) { if (a.code !== '0' && a.code !== '401') fail(op, `sorting nothing answered ${a.code}`); return; }
      if (a.code !== '0') return fail(op, `sort answered ${a.status} ${a.code}`);
      const rows = a.body.response.data as { recordId: string; fieldData: { Qty: number } }[];
      const qtys = rows.map((r) => r.fieldData.Qty);
      const ordered = [...qtys].sort((x, y) => (op.dir === 'ascend' ? x - y : y - x));
      if (JSON.stringify(qtys) !== JSON.stringify(ordered)) fail(op, `not sorted ${op.dir}: ${qtys}`);
      const got = rows.map((r) => Number(r.recordId)).sort((x, y) => x - y);
      const want = [...model.recs.keys()].sort((x, y) => x - y);
      if (JSON.stringify(got) !== JSON.stringify(want)) fail(op, `lists ${got} but the model has ${want}`);
      return;
    }
    case 'race': {
      const id = idOf(op.rec);
      const rec = model.recs.get(id);
      const names = [`race-${op.a}`, `race-${op.b}`];
      const answers = await Promise.all([op.a, op.b].map((n, i) => call(c, at(n), 'PATCH', `layouts/Items/records/${id}`, { fieldData: { Name: names[i] } })));
      if (!rec) { for (const a of answers) if (a.code !== '101') fail(op, `racing to edit a record that is not there answered ${a.code}`); return; }
      const holder = model.locks.get(id);
      const allowed = [op.a, op.b].map((n) => !holder || holder === mine(n));
      const won: number[] = [];
      answers.forEach((a, i) => {
        if (allowed[i]) { if (a.code !== '0') fail(op, `a racing edit answered ${a.status} ${a.code}`); won.push(Number(a.body.response.modId)); }
        else if (a.code !== '301') fail(op, `a racing edit of a record locked by ${holder} answered ${a.code}`);
      });
      // No lost update: each edit that went through is one step on from the last.
      const expected = Array.from({ length: won.length }, (_, i) => rec.mod + 1 + i);
      if (JSON.stringify([...won].sort((x, y) => x - y)) !== JSON.stringify(expected)) fail(op, `racing edits got modIds ${won}, expected ${expected}`);
      const group = won.length > 1 ? ++model.groups : undefined;
      if (won.length) {
        // The one that went last left its name.
        const order = answers.map((a, i) => ({ i, mod: a.code === '0' ? Number(a.body.response.modId) : -1 })).sort((x, y) => y.mod - x.mod);
        rec.name = names[order[0]!.i]!;
        for (let m = 0; m < won.length; m++) {
          const who = answers.map((a, i) => ({ i, mod: a.code === '0' ? Number(a.body.response.modId) : -1 })).find((x) => x.mod === rec.mod + 1)!;
          rec.mod++;
          note({ kind: 'update', recordId: id, modId: rec.mod, account: mine([op.a, op.b][who.i]!), ...(group ? { group } : {}) });
        }
      }
      return expectEverywhere(run, op, id);
    }
    case 'lockRace': {
      const id = idOf(op.rec);
      const results = await Promise.all([op.a, op.b].map((n) => lockCall(c, at(n), id, 'POST')));
      const holder = model.locks.get(id);
      if (!model.recs.has(id)) { for (const r of results) if (r.status === 200) fail(op, 'locked a record that is not there'); return; }
      const statuses = results.map((r) => r.status);
      if (holder) {
        const want = [op.a, op.b].map((n) => (holder === mine(n) ? 200 : 409));
        if (JSON.stringify(statuses) !== JSON.stringify(want)) fail(op, `racing for a lock held by ${holder} answered ${statuses}, expected ${want}`);
        return;
      }
      if (mine(op.a) === mine(op.b)) { if (statuses.some((x) => x !== 200)) fail(op, `one person's two sessions raced for a lock: ${statuses}`); model.locks.set(id, mine(op.a)); note({ kind: 'lock', recordId: id, account: mine(op.a) }); return; }
      if (JSON.stringify([...statuses].sort()) !== JSON.stringify([200, 409])) fail(op, `racing for a free lock answered ${statuses}, expected one winner`);
      const winner = statuses.indexOf(200) === 0 ? op.a : op.b;
      model.locks.set(id, mine(winner));
      note({ kind: 'lock', recordId: id, account: mine(winner) });
      return;
    }
    case 'script': {
      // Raises the first record's Qty by 100, as a script that edits through the same lock a person's edit takes.
      const a = await call(c, at(op.s), 'GET', 'layouts/Items/script/Bump');
      const first = [...model.recs.keys()].sort((x, y) => x - y)[0];
      if (first === undefined) return;
      const rec = model.recs.get(first)!;
      const holder = model.locks.get(first);
      if (holder && holder !== mine(op.s)) {
        if (a.body?.scriptError === '0') fail(op, `a script edited record ${first}, locked by ${holder}`);
        return expectEverywhere(run, op, first);
      }
      if (String(a.body?.response?.scriptError) !== '0') return fail(op, `the script answered ${a.status} ${JSON.stringify(a.body).slice(0, 200)}`);
      rec.qty += 100;
      rec.mod++;
      // Its own lock around the edit, unless the person already holds one.
      if (!holder) note({ kind: 'lock', recordId: first, account: mine(op.s) });
      note({ kind: 'update', recordId: first, modId: rec.mod, account: mine(op.s) });
      if (!holder) note({ kind: 'unlock', recordId: first, account: mine(op.s) });
      return expectEverywhere(run, op, first);
    }
    case 'signout': {
      const s = at(op.s);
      await fetch(`${c.data}/sessions/${s.token}`, { method: 'DELETE' });
      // The locks go with the session; the person signs in again, on the same worker.
      for (const [id, who] of [...model.locks]) if (who === s.account && !sessions.some((o) => o !== s && o.account === s.account)) { model.locks.delete(id); note({ kind: 'unlock', recordId: id, account: who }); }
      sessions[op.s] = await signIn(c, s.account);
      return;
    }
  }
}

/** What the streams must have heard, once the operations have finished. */
async function checkStreams(run: Run) {
  const expected = run.model.changes;
  const key = (e: Expected) => `${e.kind}:${e.recordId}:${e.modId ?? '-'}`;
  const want = expected.map(key);
  const end = Date.now() + LAG_BOUND_MS;
  // Changes made at the same moment by different workers may be heard in either order (KNOWN below): each such group is compared as a set.
  const arranged = (keys: string[]) => {
    const out: string[] = [];
    let i = 0;
    while (i < expected.length) {
      const g = expected[i]!.group;
      if (g === undefined) { out.push(keys[i]!); i++; continue; }
      let j = i;
      while (j < expected.length && expected[j]!.group === g) j++;
      out.push(`{${keys.slice(i, j).sort().join(' ')}}`);
      i = j;
    }
    return out;
  };
  for (const l of run.listeners) {
    while (l.heard.length < want.length && Date.now() < end) await sleep(10);
    const got = l.heard.map(key);
    if (JSON.stringify(arranged(got)) !== JSON.stringify(arranged(want))) throw new Mismatch(`a live-update stream heard\n  ${got.join(' ')}\nbut the changes were\n  ${want.join(' ')}`);
  }
}

/** How long a worker may take to serve what another worker has just written, and a stream to hear it. */
const LAG_BOUND_MS = 2000;

async function replay(c: Cluster, sessions: number, ops: Op[]): Promise<string | undefined> {
  const run = await begin(c, sessions);
  try {
    for (const op of ops) await step(run, op);
    await checkStreams(run);
    return undefined;
  } catch (e) {
    if (e instanceof Mismatch) return e.message;
    throw e;
  } finally {
    await finish(run);
  }
}

async function shrink(c: Cluster, sessions: number, ops: Op[], why: string): Promise<{ ops: Op[]; why: string }> {
  let budget = 60;
  let progress = true;
  while (progress && budget > 0) {
    progress = false;
    for (let i = 0; i < ops.length && budget > 0; i++) {
      budget--;
      const smaller = [...ops.slice(0, i), ...ops.slice(i + 1)];
      const d = await replay(c, sessions, smaller);
      if (d) { ops = smaller; why = d; progress = true; break; }
    }
  }
  return { ops, why };
}

const SEEDS = process.env.CLUSTER_SEED ? [Number(process.env.CLUSTER_SEED)] : Array.from({ length: Number(process.env.CLUSTER_SEEDS ?? 6) }, (_, i) => i + 1);

for (const workers of [2, 3, 4]) {
  test(`record locks, caches and live updates agree with the model on ${workers} workers`, { timeout: 120_000 }, async (t) => {
    const c = await startCluster(t, workers);
    const sessions = Math.max(workers + 1, 4);
    for (const seed of SEEDS) {
      const ops = generate(rng(seed * 31 + workers), sessions, 40);
      const why = await replay(c, sessions, ops);
      if (why) {
        const small = await shrink(c, sessions, ops, why);
        assert.fail(`${workers} workers, seed ${seed}: ${small.why}\noperations:\n${small.ops.map((o) => '  ' + JSON.stringify(o)).join('\n')}`);
      }
    }
  });
}

test('unlocking a record someone else holds says nothing was released, and leaves it held', async (t) => {
  const c = await startCluster(t, 2);
  const [ann, bob] = await Promise.all(c.accounts.slice(0, 2).map((a) => signIn(c, a)));
  const made = await call(c, ann!, 'POST', 'layouts/Items/records', { fieldData: { Name: 'a', Qty: 1 } });
  const id = Number(made.body.response.recordId);
  assert.equal((await lockCall(c, ann!, id, 'POST')).status, 200);
  const other = await lockCall(c, bob!, id, 'DELETE');
  assert.deepEqual(await other.json(), { released: false });
  assert.equal((await lockCall(c, bob!, id, 'POST')).status, 409, 'still Ann\'s');
  assert.deepEqual(await (await lockCall(c, ann!, id, 'DELETE')).json(), { released: true });
  assert.deepEqual(await (await lockCall(c, ann!, id, 'DELETE')).json(), { released: false }, 'nothing left to release');
});

test('worker lag stayed inside its bound', () => {
  if (process.env.CLUSTER_LOG_LAG) console.log(`worst lag ${worstLag} ms`);
  assert.ok(worstLag <= LAG_BOUND_MS, `the slowest worker took ${worstLag} ms`);
});
