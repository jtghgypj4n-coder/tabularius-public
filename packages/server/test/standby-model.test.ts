// A model-based test of a primary and its standby: a seeded generator of edits (records, design, accounts, containers),
// standby restarts and crashes, lag, partitions, a primary restart, and failover drills (promotion of the standby while
// the primary may still be taking writes, then failback), run against a real `serve` with a replication token, a real
// `Standby` and a loopback proxy that cuts or truncates the link. A plain model of what the primary committed (one
// digest per committed edit) is the reference; the standby, whenever it is looked at, must hold exactly one of those
// states and never one the primary has not committed. What is promised, and what is not, is in
// docs/standby-guarantees.md; the three things found that the code did not do are in
// notes/audits/r24-02-standby-model.md; the first is fixed and the other two are the `todo` tests at the end.
//
// A failure prints the seed and the history of operations. SEED=<n> replays one seed; STANDBY_SEEDS=<n> runs n seeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http, { createServer } from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { STANDBY_STATE, STORE_EXT, Standby, serve } from '../src/index.ts';
import { createStore, Store } from '../../store/src/index.ts';

const TOKEN = 'a-replication-token-for-the-model';
const DB = 'Work';
const FILE = DB + STORE_EXT;

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

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------- the reference model

type Cells = Record<string, string>;
interface Model {
  fields: string[];
  rows: Map<number, Cells>;
  scripts: string[];
  /** The password hash of each account the test made. The salt makes it unpredictable, so it is read back from the primary after the edit. */
  accounts: Map<string, string>;
  /** The password each account had after that edit: for signing in over the Data API. */
  passwords: Map<string, string>;
  containers: { id: number; sha: string }[];
}

const newModel = (): Model => ({ fields: ['Name', 'Qty'], rows: new Map(), scripts: [], accounts: new Map(), passwords: new Map(), containers: [] });
const cloneModel = (m: Model): Model => ({
  fields: [...m.fields], rows: new Map([...m.rows].map(([k, v]) => [k, { ...v }])), scripts: [...m.scripts],
  accounts: new Map(m.accounts), passwords: new Map(m.passwords), containers: m.containers.map((c) => ({ ...c })),
});

/** What a state looks like to a comparison: the same shape from the model and from a file. */
function digestOf(parts: { fields: string[]; rows: [number, Cells][]; scripts: string[]; accounts: [string, string][]; containers: { id: number; sha: string }[] }): string {
  const fields = [...parts.fields].sort();
  return JSON.stringify({
    fields,
    rows: [...parts.rows].sort((a, b) => a[0] - b[0]).map(([id, c]) => [id, fields.map((f) => c[f] ?? '')]),
    scripts: [...parts.scripts].sort(),
    accounts: [...parts.accounts].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    containers: [...parts.containers].sort((a, b) => a.id - b.id),
  });
}
const modelDigest = (m: Model) => digestOf({ fields: m.fields, rows: [...m.rows], scripts: m.scripts, accounts: [...m.accounts], containers: m.containers });

/** The same digest read from a file (a copy of it, so nothing here touches the original). */
function fileDigest(path: string, accounts: string[]): string {
  const s = new Store(path, DB);
  try {
    const table = s.schema.tables.find((t) => t.name === 'Items')!;
    const fields = table.fields.map((f) => f.name);
    const rows: [number, Cells][] = s.find('Items', { limit: 1_000_000 }).records.map((r) => [r.recordId, Object.fromEntries(fields.map((f) => [f, String((r.fieldData as Record<string, unknown>)[f] ?? '')]))]);
    const hashes = new Map((s.sql.prepare('SELECT name, password_hash FROM _fm_accounts').all() as { name: string; password_hash: string | null }[]).map((a) => [a.name, a.password_hash ?? '']));
    const containers = (s.sql.prepare('SELECT id FROM _fm_containers ORDER BY id').all() as { id: number }[]).map((c) => ({ id: Number(c.id), sha: sha(s.container(Number(c.id))!.data) }));
    return digestOf({ fields, rows, scripts: (s.schema.scripts ?? []).map((x: { name: string }) => x.name), accounts: accounts.filter((a) => hashes.has(a)).map((a) => [a, hashes.get(a)!]), containers });
  } finally {
    s.close();
  }
}

// ---------------------------------------------------------------------------------------------------- the link

/** A loopback TCP proxy between a standby and its primary. `cut` refuses and drops everything; `truncate` sends half of each answer and drops the link. */
class Link {
  mode: 'open' | 'cut' | 'truncate' = 'open';
  target = 0;
  port = 0;
  private readonly sockets = new Set<net.Socket>();
  private readonly server = net.createServer((c) => {
    if (this.mode === 'cut' || !this.target) return void c.destroy();
    const up = net.connect(this.target, '127.0.0.1');
    this.sockets.add(c);
    this.sockets.add(up);
    const drop = () => { c.destroy(); up.destroy(); this.sockets.delete(c); this.sockets.delete(up); };
    // The primary finishing is not the standby leaving: what is still queued for the standby has to be written before its side closes
    // (`end` waits for that, `destroy` does not), so only an error or the standby's own close drops both sides at once.
    c.on('error', drop); up.on('error', drop); c.on('close', drop);
    up.on('end', () => { if (this.mode === 'truncate') drop(); else c.end(); });
    c.on('data', (d) => up.write(d));
    up.on('data', (d) => {
      if (this.mode === 'truncate') c.write(d.subarray(0, Math.max(1, d.length >> 1)), drop);
      else c.write(d);
    });
  });
  async listen(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as net.AddressInfo).port;
  }
  get url(): string { return `http://127.0.0.1:${this.port}`; }
  set(mode: 'open' | 'cut' | 'truncate'): void {
    this.mode = mode;
    if (mode !== 'open') for (const s of this.sockets) s.destroy();
  }
  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

// ---------------------------------------------------------------------------------------------------- the world

type Served = Awaited<ReturnType<typeof serve>>;

/** One machine's folder: whichever of primary and standby it is now. */
interface Node {
  name: string;
  dir: string;
  link: Link;
  server?: Served;
  log: string[];
  /** Committed states, oldest first: timeline[k] is the digest after k edits. Meaningful while this node is the primary. */
  timeline: { d: string; model: Model }[];
}

class Failure extends Error {}

class World {
  readonly root = mkdtempSync(join(tmpdir(), 'tabularius-standby-model-'));
  readonly nodes: Node[] = [];
  primary!: Node;
  standbyNode!: Node;
  standby?: Standby;
  standbyLog: string[] = [];
  history: string[] = [];
  /** Edits the standby has acknowledged: it held every one of them when it last caught up. */
  acked = 0;
  /** The smallest edit count the standby's state can be, so it never goes back. */
  lastK = 0;
  /** An older copy of the standby's state file, to put back as if the last saves never happened. */
  staleState?: string;
  accountsMade: string[] = ['ann', 'bob'];
  nextContainerBig = true;
  readonly random: () => number;
  constructor(random: () => number) { this.random = random; }

  note(s: string) { this.history.push(s); }
  get model(): Model { return this.primary.timeline.at(-1)!.model; }
  get committed(): number { return this.primary.timeline.length - 1; }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.random() * xs.length)]!; }

  async makeNode(name: string): Promise<Node> {
    const dir = join(this.root, name);
    mkdirSync(dir);
    const link = new Link();
    await link.listen();
    const n: Node = { name, dir, link, log: [], timeline: [] };
    this.nodes.push(n);
    return n;
  }

  async startServer(n: Node): Promise<void> {
    n.server = await serve({ dir: n.dir, port: 0, watch: false, replicationToken: TOKEN, log: (m) => void n.log.push(m) });
    n.link.target = Number(new URL(n.server.url).port);
  }

  async stopServer(n: Node): Promise<void> {
    const s = n.server;
    n.server = undefined;
    n.link.target = 0;
    if (s) await new Promise<void>((r) => s.server.close(() => r()));
  }

  store(n: Node = this.primary): Store {
    return n.server!.host.get(DB)!;
  }

  async closeAll(): Promise<void> {
    await this.standby?.stop().catch(() => {});
    for (const n of this.nodes) { await this.stopServer(n).catch(() => {}); await n.link.close().catch(() => {}); }
    rmSync(this.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }

  // ------------------------------------------------------------------------------------------------ the primary's edits

  /** Applies one edit to the primary's real store and to its model, and records the new committed state. */
  edit(): void {
    const r = this.random;
    const m = cloneModel(this.model);
    const s = this.store();
    const ids = [...m.rows.keys()];
    const kind = ids.length === 0 ? 'create' : this.pick(['create', 'create', 'update', 'update', 'update', 'delete', 'field', 'script', 'account', 'container']);
    const word = () => 'w' + Math.floor(r() * 1000);
    switch (kind) {
      case 'create': {
        const cells: Cells = { Name: word(), Qty: String(Math.floor(r() * 50)) };
        for (const f of m.fields.slice(2)) if (r() < 0.5) cells[f] = word();
        const expected = ids.length ? Math.max(...ids) + 1 : 1;
        const res = s.create('Items', { ...cells, Qty: Number(cells.Qty) });
        assert.equal(res.recordId, expected, 'the primary numbers a new record one above the highest');
        m.rows.set(res.recordId, cells);
        this.note(`create #${res.recordId} ${JSON.stringify(cells)}`);
        break;
      }
      case 'update': {
        const id = this.pick(ids);
        const f = this.pick(m.fields);
        const v = f === 'Qty' ? String(Math.floor(r() * 50)) : word();
        s.update('Items', id, { [f]: f === 'Qty' ? Number(v) : v });
        m.rows.get(id)![f] = v;
        this.note(`update #${id} ${f}=${v}`);
        break;
      }
      case 'delete': {
        const id = this.pick(ids);
        s.delete('Items', id);
        m.rows.delete(id);
        this.note(`delete #${id}`);
        break;
      }
      case 'field': {
        const name = `F${m.fields.length - 1}`;
        s.applyDesign([{ op: 'createField', table: 'Items', name, type: 'text' }]);
        m.fields.push(name);
        this.note(`createField ${name}`);
        break;
      }
      case 'script': {
        const name = `S${m.scripts.length + 1}`;
        s.applyDesign([{ op: 'createScript', name, text: 'Show All Records' }]);
        m.scripts.push(name);
        this.note(`createScript ${name}`);
        break;
      }
      case 'account': {
        const name = r() < 0.5 ? this.pick(this.accountsMade) : `user${this.accountsMade.length}`;
        if (!this.accountsMade.includes(name)) this.accountsMade.push(name);
        const pw = `pw-${name}-${Math.floor(r() * 1e6)}`;
        s.setPassword(name, pw, 'Staff');
        m.accounts.set(name, (s.sql.prepare('SELECT password_hash FROM _fm_accounts WHERE name = ?').get(name) as { password_hash: string }).password_hash);
        m.passwords.set(name, pw);
        this.note(`setPassword ${name}`);
        break;
      }
      case 'container': {
        const big = this.nextContainerBig && r() < 0.1;
        if (big) this.nextContainerBig = false;
        const bytes = Buffer.alloc(big ? 1_100_000 : 1 + Math.floor(r() * 3000));
        for (let i = 0; i < bytes.length; i += 97) bytes[i] = Math.floor(r() * 256);
        const id = s.addContainer({ filename: `f${m.containers.length}.bin`, mime: 'application/octet-stream', data: bytes });
        assert.equal(id, m.containers.length + 1);
        m.containers.push({ id, sha: sha(bytes) });
        this.note(`addContainer #${id} ${bytes.length} bytes`);
        break;
      }
    }
    this.primary.timeline.push({ d: modelDigest(m), model: m });
  }

  // ------------------------------------------------------------------------------------------------ the standby

  standbyFile(): string { return join(this.standbyNode.dir, FILE); }

  async startStandbyNow(): Promise<void> {
    const link = this.primary.link;
    const mode = link.mode;
    const sb = new Standby({ folder: this.standbyNode.dir, primary: link.url, token: TOKEN, wait: 1, log: (m) => void this.standbyLog.push(m) });
    if (mode !== 'open') link.set('open');
    sb.start();
    this.standby = sb;
    if (mode !== 'open') {
      const t0 = Date.now();
      while ((sb as unknown as { following: Map<string, unknown> }).following.size === 0 && Date.now() - t0 < 2000) await sleep(5);
      link.set(mode);
    }
  }

  async stopStandby(): Promise<void> {
    const sb = this.standby;
    this.standby = undefined;
    await sb?.stop();
  }

  /** The primary's own view of a file: run and change number, asked directly (not through the link). */
  async primaryPosition(): Promise<{ run: string; seq: number } | undefined> {
    if (!this.primary.server) return undefined;
    const res = await fetch(`${this.primary.server.url}/tabularius/replication/v1/files`, { headers: { authorization: `Bearer ${TOKEN}` } });
    return ((await res.json()) as { files: { name: string; run: string; seq: number }[] }).files.find((f) => f.name === DB);
  }

  /** Waits until everything committed has been shipped and the standby has applied all of it. */
  async settle(why: string): Promise<void> {
    const wal = this.store().path + '-wal';
    const end = Date.now() + 10_000;
    let stable = 0;
    while (stable < 3) {
      const pos = await this.primaryPosition();
      const mine = this.standby!.state.files[DB];
      const shipped = !existsSync(wal) || statSync(wal).size === 0;
      if (pos && mine && shipped && mine.run === pos.run && mine.seq === pos.seq && mine.seq >= mine.wholeAfter) stable++;
      else stable = 0;
      if (Date.now() > end) throw new Failure(`the standby did not catch up (${why}): primary ${JSON.stringify(pos)} wal ${existsSync(wal) ? statSync(wal).size : 0} bytes, standby ${JSON.stringify(mine)}; standby log: ${this.standbyLog.slice(-5).join(' | ')}`);
      await sleep(60);
    }
    this.acked = this.committed;
    this.staleState = this.stateText();
    this.note(`settled at ${this.committed} edits`);
  }

  stateText(): string | undefined {
    const p = join(this.standbyNode.dir, STANDBY_STATE);
    return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  }

  /** Looks inside the standby: stops it, reads a copy of its file, checks what it holds, starts it again. */
  async inspect(why: string, opts: { restart?: boolean; expectAll?: boolean } = {}): Promise<number> {
    const running = !!this.standby;
    await this.stopStandby();
    const k = this.checkStandbyFile(why, opts.expectAll);
    if (running && opts.restart !== false) await this.startStandbyNow();
    return k;
  }

  /** The standby's file must be exactly a state the primary has committed, no older than what it acknowledged and no older than it has been before. */
  checkStandbyFile(why: string, expectAll = false): number {
    const copy = join(this.root, `inspect-${this.history.length}.sqlite`);
    copyFileSync(this.standbyFile(), copy);
    let d: string;
    try { d = fileDigest(copy, this.accountsMade); } finally { rmSync(copy, { force: true }); }
    const matches = this.primary.timeline.flatMap((t, k) => (t.d === d ? [k] : []));
    if (!matches.length) throw new Failure(`${why}: the standby holds a state the primary never committed (never ahead of the primary's committed state)\n${this.describe(d)}`);
    const floor = expectAll ? this.committed : Math.max(this.acked, this.lastK);
    const ok = matches.filter((k) => k >= floor);
    if (!ok.length) throw new Failure(`${why}: the standby holds state ${matches.join('/')} but must hold at least ${floor} (${expectAll ? 'everything committed' : `acknowledged ${this.acked}, seen before ${this.lastK}`})`);
    this.lastK = ok[0]!;
    this.note(`inspect(${why}): standby holds ${ok[0]} of ${this.committed} edits`);
    return ok.at(-1)!;
  }

  describe(d: string): string {
    const last = this.primary.timeline.at(-1)!.d;
    return `standby: ${d.slice(0, 600)}\nprimary: ${last.slice(0, 600)}`;
  }
}

// ---------------------------------------------------------------------------------------------------- setup

async function build(seed: number): Promise<World> {
  const w = new World(rng(seed));
  const a = await w.makeNode('a');
  const b = await w.makeNode('b');
  w.primary = a;
  w.standbyNode = b;
  createStore(join(a.dir, FILE));
  const s = new Store(join(a.dir, FILE), DB);
  s.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }, { name: 'Qty', type: 'number' }] }]);
  s.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmrest', 'fmapp'] });
  const m = newModel();
  for (const name of ['ann', 'bob']) {
    s.setPassword(name, `pw-${name}-0`, 'Staff');
    m.accounts.set(name, (s.sql.prepare('SELECT password_hash FROM _fm_accounts WHERE name = ?').get(name) as { password_hash: string }).password_hash);
    m.passwords.set(name, `pw-${name}-0`);
  }
  s.close();
  a.timeline = [{ d: modelDigest(m), model: m }];
  await w.startServer(a);
  await w.startStandbyNow();
  await w.settle('start');
  return w;
}

// ---------------------------------------------------------------------------------------------------- operations

async function dataApi(url: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}/fmi/data/vLatest/databases/${DB}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

async function signIn(url: string, account: string, password: string): Promise<string | undefined> {
  const res = await dataApi(url, '/sessions', { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(`${account}:${password}`).toString('base64') }, body: '{}' });
  if (res.status !== 200) return undefined;
  return ((await res.json()) as { response: { token: string } }).response.token;
}

/**
 * Fails over: the standby's side is served on its own (a stopped standby, then `serve` on its folder), it takes writes,
 * and the old primary is made a standby of it. When `split`, the old primary kept taking writes meanwhile.
 */
async function failover(w: World, how: { settled: boolean; split: boolean; primaryStays: boolean }): Promise<void> {
  const old = w.primary;
  const next = w.standbyNode;
  w.note(`failover: ${JSON.stringify(how)}`);
  // A session on the old primary, to see what a promoted standby makes of it.
  const tokenOld = old.server && w.model.passwords.has('ann') ? await signIn(old.server.url, 'ann', w.model.passwords.get('ann')!) : undefined;
  if (how.settled) {
    // Nothing is lost: wait for the standby to have everything, as an operator would before a planned switch.
    if (old.link.mode !== 'open') old.link.set('open');
    await w.settle('before a planned failover');
  } else {
    // The primary is cut off from its standby, takes more writes that never reach it.
    old.link.set('cut');
    for (let i = 0, n = 1 + Math.floor(w.random() * 3); i < n; i++) w.edit();
  }
  const oldTimeline = old.timeline;
  await w.stopStandby();
  const k = w.checkStandbyFile('at promotion', how.settled);
  const keep = oldTimeline.slice(0, k + 1);
  w.note(`promote: the standby holds ${k} of ${oldTimeline.length - 1} committed edits; ${oldTimeline.length - 1 - k} are lost to it`);
  if (!how.split && !how.primaryStays) await w.stopServer(old);

  // The standby's folder served on its own.
  await w.startServer(next);
  assert.ok(next.log.some((m) => m.startsWith(`taking over from ${old.link.url}`)), `takeover is logged: ${next.log.join(' | ')}`);
  assert.ok(!existsSync(join(next.dir, STANDBY_STATE)), 'the standby state is removed once the folder is served');
  next.timeline = keep.map((t) => ({ d: t.d, model: cloneModel(t.model) }));
  // A folder that served never becomes a standby again by accident.
  assert.throws(() => new Standby({ folder: next.dir, primary: old.link.url, token: TOKEN }).start(), /didn't copy \(Work/, 'a folder that was served refuses to become a standby without --overwrite');
  // Accounts come with the file; sessions do not.
  const promotedModel = next.timeline.at(-1)!.model;
  for (const [name, pw] of promotedModel.passwords) {
    if (name !== 'ann' && name !== 'bob') continue;
    const token = await signIn(next.server!.url, name, pw);
    assert.ok(token, `${name} signs in on the promoted server with the password the standby holds (promoted state ${k})`);
    if (promotedModel.rows.size) {
      const list = await dataApi(next.server!.url, '/layouts/Items/records?_limit=1000', { headers: { authorization: `Bearer ${token}` } });
      assert.equal(list.status, 200, 'the promoted server answers the Data API');
      assert.equal(((await list.json()) as { response: { data: unknown[] } }).response.data.length, promotedModel.rows.size, "the promoted server serves the standby's records");
    }
  }
  if (tokenOld) {
    const res = await dataApi(next.server!.url, '/layouts/Items/records?_limit=1', { headers: { authorization: `Bearer ${tokenOld}` } });
    assert.equal(res.status, 401, 'a session on the old primary means nothing on the promoted server (sessions are kept in memory)');
  }

  // The promoted server takes writes; the old primary may too (split brain).
  w.primary = next;
  w.standbyNode = old;
  const writesNew = 1 + Math.floor(w.random() * 4);
  for (let i = 0; i < writesNew; i++) w.edit();
  if (how.split && old.server) {
    w.primary = old;
    old.timeline = oldTimeline;
    for (let i = 0, n = 1 + Math.floor(w.random() * 2); i < n; i++) w.edit();
    w.primary = next;
  }
  // Failback: the old primary's folder is not a standby of the promoted server unless asked, because it holds files no standby made.
  await w.stopServer(old);
  assert.throws(() => new Standby({ folder: old.dir, primary: next.link.url, token: TOKEN }).start(), /already has files this standby didn't copy \(Work/, 'failback is refused and reported when the old primary holds its own files');
  w.note(`failback: the old primary's folder is refused; replaced on purpose (--overwrite)`);
  w.note('failback: whatever the old primary held that the promoted server does not is discarded');
  // The promoted server's own history starts at the state it was promoted in; the standby (the old primary's folder) is replaced by a copy of it.
  w.acked = k;
  w.lastK = k;
  w.staleState = undefined;
  w.standby = new Standby({ folder: old.dir, primary: next.link.url, token: TOKEN, wait: 1, overwrite: true, log: (m) => void w.standbyLog.push(m) });
  w.standby.start();
  w.primary.link.set('open');
  await w.settle('after failback');
  await w.inspect('after failback', { expectAll: true });
}

async function run(seed: number): Promise<void> {
  const w = await build(seed);
  const r = w.random;
  let failovers = 0;
  let restarts = 0;
  try {
    for (let step = 0; step < 24; step++) {
      const x = r();
      const link = w.primary.link;
      const op =
        x < 0.34 ? 'edit' : x < 0.42 ? 'settle' : x < 0.50 ? 'inspect' : x < 0.57 ? 'standbyRestart' : x < 0.62 ? 'standbyCrash'
        : x < 0.70 ? 'partition' : x < 0.80 ? 'heal' : x < 0.84 ? 'primaryRestart' : x < 0.90 ? 'burst' : x < 0.93 ? 'failover' : 'edit';
      switch (op) {
        case 'edit': w.edit(); break;
        case 'burst': for (let i = 0, n = 3 + Math.floor(r() * 6); i < n; i++) w.edit(); break;
        case 'settle':
          if (link.mode === 'open') await w.settle('settle'); else w.note('settle skipped: partitioned');
          break;
        case 'inspect': await w.inspect('inspect'); break;
        case 'standbyRestart': await w.stopStandby(); w.note('standby restart'); await w.startStandbyNow(); break;
        case 'standbyCrash': {
          // The last saves of its state never happened: it comes back with an older note of what it had done.
          await w.stopStandby();
          const stale = w.staleState;
          if (stale !== undefined) writeFileSync(join(w.standbyNode.dir, STANDBY_STATE), stale);
          w.note(`standby crash (state put back to the last settled one: ${stale !== undefined})`);
          await w.startStandbyNow();
          break;
        }
        case 'partition': {
          const mode = r() < 0.5 ? 'cut' : 'truncate';
          link.set(mode);
          w.note(`partition: ${mode}`);
          break;
        }
        case 'heal': if (link.mode !== 'open') { link.set('open'); w.note('heal'); } break;
        case 'primaryRestart': {
          if (restarts++ >= 2) break;
          w.note('primary restart (clean)');
          await w.stopServer(w.primary);
          await w.startServer(w.primary);
          break;
        }
        case 'failover': {
          if (failovers++ >= 1) break;
          const settled = r() < 0.4;
          await failover(w, { settled, split: !settled && r() < 0.5, primaryStays: r() < 0.5 });
          break;
        }
      }
    }
    // The end: the link is healed, the standby catches up, holds all of it, and is then promoted.
    w.primary.link.set('open');
    if (!w.standby) await w.startStandbyNow();
    await w.settle('end');
    await w.inspect('end', { expectAll: true, restart: false });
    // The protocol's own guard: a standby can't claim a change the primary has not made.
    const pos = (await w.primaryPosition())!;
    for (const [q, why] of [[`run=${pos.run}&after=${pos.seq + 1}`, 'ahead'], [`run=${pos.run}&after=-1`, 'negative'], [`run=other&after=0`, 'other run']] as const) {
      const res = await fetch(`${w.primary.server!.url}/tabularius/replication/v1/files/${DB}/changes?${q}`, { headers: { authorization: `Bearer ${TOKEN}` } });
      assert.equal(res.status, 409, `the primary refuses a standby that is ${why}`);
    }
  } catch (e) {
    const err = e as Error;
    err.message = `${err.message}\n\nseed ${seed} (replay: STANDBY_SEED=${seed})\nhistory:\n${w.history.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}\nstandby log:\n  ${w.standbyLog.slice(-12).join('\n  ')}`;
    throw err;
  } finally {
    if (process.env.STANDBY_VERBOSE) console.log(`seed ${seed}\n` + w.history.map((h, i) => `  ${i + 1}. ${h}`).join('\n'));
    await w.closeAll();
  }
}

const only = process.env.STANDBY_SEED ? [Number(process.env.STANDBY_SEED)] : undefined;
// The first five were picked because between them they play a planned failover, a failover with the primary cut off and still
// writing (with and without writes on both sides), standby crashes and primary restarts; STANDBY_SEEDS=n adds more.
const chosen = [2402, 2436, 2487, 2589, 2674];
const seeds = only ?? Array.from({ length: Number(process.env.STANDBY_SEEDS ?? chosen.length) }, (_, i) => chosen[i] ?? 2402 + i * 17);

for (const seed of seeds) {
  test(`primary and standby model, seed ${seed}`, { timeout: 120_000 }, async () => {
    await run(seed);
  });
}

// ---------------------------------------------------------------------------------------------------- the pieces the model leans on

test('the loopback link hands over an answer bigger than the sockets can hold, whole, before it closes', async () => {
  // The primary closes its side as soon as it has written the answer. A link that closed the standby's side at the same
  // moment threw away what was still queued for it: nothing on Linux, where a loopback socket takes megabytes at once,
  // but on macOS an answer of some hundred kilobytes (a standby's first changes after a busy spell) never arrived whole,
  // and the standby saw "aborted" on every try.
  const total = 24 * 1024 * 1024;
  let originGone!: () => void;
  const originClosed = new Promise<void>((r) => (originGone = r));
  const origin = createServer((req, res) => {
    req.socket.once('close', originGone);
    res.writeHead(200, { 'content-length': total, connection: 'close' });
    res.end(Buffer.alloc(total, 7));
  });
  await new Promise<void>((r) => origin.listen(0, '127.0.0.1', r));
  const link = new Link();
  await link.listen();
  link.target = (origin.address() as net.AddressInfo).port;
  try {
    // The reader holds back until the primary has finished and gone, which is what a slow reader or a small socket buffer comes to.
    const got = await new Promise<number>((resolve, reject) => {
      http.get(link.url, { agent: false }, (res) => {
        let n = 0;
        res.pause();
        res.on('data', (d: Buffer) => (n += d.length));
        res.on('end', () => resolve(n));
        res.on('error', reject);
        void originClosed.then(async () => {
          for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
          res.resume();
        });
      }).on('error', reject);
    });
    assert.equal(got, total, 'every byte arrives');
  } finally {
    await link.close();
    await new Promise<void>((r) => origin.close(() => r()));
  }
});

test('changes taken from a file can be repeated, replayed from an earlier point or cut short, and the copy still ends up the same', async () => {
  const { applyLog } = await import('../src/logs.ts');
  for (const seed of [7, 8, 9]) {
    const random = rng(seed);
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-standby-replay-'));
    try {
      const path = join(dir, 'primary', FILE);
      mkdirSync(join(dir, 'primary'));
      createStore(path);
      const s = new Store(path, DB);
      s.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }, { name: 'Qty', type: 'number' }] }]);
      // As the log shipper follows a file: the log only empties when taken.
      s.sql.exec('PRAGMA wal_autocheckpoint = 0');
      s.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const replica = join(dir, 'replica.sqlite');
      await s.backup(replica);
      const digestOfCopy = (p: string) => {
        const c = join(dir, `digest-${Math.floor(random() * 1e9)}.sqlite`);
        copyFileSync(p, c);
        try { return fileDigest(c, []); } finally { rmSync(c, { force: true }); }
      };
      copyFileSync(replica, join(dir, 'primary-0.sqlite'));
      const states = [digestOfCopy(replica)];
      const logs: Buffer[] = [];
      let fields = 0;
      let lastDesign = 0;
      for (let i = 1; i <= 10; i++) {
        const ids = (s.find('Items', { limit: 1000 }).records as { recordId: number }[]).map((r) => r.recordId);
        const kind = ids.length < 2 ? 'create' : ['create', 'update', 'update', 'delete', 'field'][Math.floor(random() * 5)];
        if (kind === 'create') s.create('Items', { Name: `n${i}`, Qty: i });
        else if (kind === 'update') s.update('Items', ids[Math.floor(random() * ids.length)]!, { Name: `u${i}` });
        else if (kind === 'delete') s.delete('Items', ids[0]!);
        else { s.applyDesign([{ op: 'createField', table: 'Items', name: `F${++fields}`, type: 'text' }]); lastDesign = i - 1; }
        assert.ok(s.shipWal((log) => { logs.push(Buffer.from(log)); return true; }) > 0, 'an edit leaves a log');
        const copy = join(dir, `primary-${i}.sqlite`);
        copyFileSync(path, copy);
        states.push(fileDigest(copy, []));
        // Applied in order, as a standby does.
        applyLog(replica, logs[i - 1]!);
        const how = ['dup', 'replay', 'cut', 'plain'][Math.floor(random() * 4)];
        if (how === 'dup') applyLog(replica, logs[i - 1]!);
        // Replayed from some earlier change, but not from before a design change: that is the todo test below.
        if (how === 'replay') for (let j = Math.max(lastDesign, Math.floor(random() * i)); j < i; j++) applyLog(replica, logs[j]!);
        if (how === 'cut') {
          // A copy of the file as it was one change ago, then this change's log cut anywhere: whole transactions or none.
          const cutAt = Math.floor(random() * logs[i - 1]!.length);
          const earlier = join(dir, 'earlier.sqlite');
          copyFileSync(join(dir, `primary-${i - 1}.sqlite`), earlier);
          applyLog(earlier, logs[i - 1]!.subarray(0, cutAt));
          const d = digestOfCopy(earlier);
          assert.ok(d === states[i - 1] || d === states[i], `a log cut at ${cutAt} of ${logs[i - 1]!.length} bytes leaves the file in the state before or after it`);
          applyLog(earlier, logs[i - 1]!);
          assert.equal(digestOfCopy(earlier), states[i], 'and the whole log then brings it to the same state');
          rmSync(earlier, { force: true });
        }
        assert.equal(digestOfCopy(replica), states[i], `after change ${i} (${kind}, ${how}) the copy is the primary's state`);
        const check = new DatabaseSync(replica, { readOnly: true });
        try { assert.equal((check.prepare('PRAGMA quick_check').get() as Record<string, string>).quick_check, 'ok'); } finally { check.close(); }
      }
      s.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('a standby on the old product name keeps following a primary that was upgraded first', async () => {
  // The old standby asks for /openhbam/replication/... and reads x-openhbam-run/-seq/-whole-after from the answers.
  const w = await build(31);
  try {
    const base = w.primary.server!.url;
    const headers = { authorization: `Bearer ${TOKEN}` };
    const files = await fetch(`${base}/openhbam/replication/v1/files`, { headers });
    assert.equal(files.status, 200, 'the old path is answered');
    const copy = await fetch(`${base}/openhbam/replication/v1/files/${DB}/copy`, { headers });
    assert.equal(copy.status, 200);
    await copy.arrayBuffer();
    const run = copy.headers.get('x-openhbam-run');
    const seq = copy.headers.get('x-openhbam-seq');
    assert.match(run ?? '', /^[0-9a-f]{16}$/, 'a copy carries the run under the old header name');
    assert.match(seq ?? '', /^\d+$/);
    assert.match(copy.headers.get('x-openhbam-whole-after') ?? '', /^\d+$/);
    assert.equal(copy.headers.get('x-tabularius-run'), run, 'and under the new one');
    w.edit();
    const changes = await fetch(`${base}/openhbam/replication/v1/files/${DB}/changes?run=${run}&after=${seq}&wait=5`, { headers });
    assert.equal(changes.status, 200);
    const body = Buffer.from(await changes.arrayBuffer());
    assert.ok(body.length > 16, 'changes come across');
    assert.equal(changes.headers.get('x-openhbam-run'), run);
    assert.ok(Number(changes.headers.get('x-openhbam-seq')) > Number(seq));
    assert.equal(changes.headers.get('x-openhbam-seq'), changes.headers.get('x-tabularius-seq'));
  } finally {
    await w.closeAll();
  }
});

test('a standby says what is wrong when the main server has no replication routes, or refuses its token', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-skew-'));
  const servers: Served[] = [];
  const standbys: Standby[] = [];
  try {
    const follow = async (token: string | undefined, use: string): Promise<string> => {
      const dir = join(root, `main-${servers.length}`);
      mkdirSync(dir);
      createStore(join(dir, FILE));
      const s = await serve({ dir, port: 0, watch: false, ...(token ? { replicationToken: token } : {}), log: () => {} });
      servers.push(s);
      const folder = join(root, `standby-${servers.length}`);
      mkdirSync(folder);
      const sb = new Standby({ folder, primary: s.url, token: use, wait: 1, log: () => {} });
      standbys.push(sb);
      sb.start();
      const end = Date.now() + 5000;
      while (!sb.problem && Date.now() < end) await sleep(20);
      return sb.problem ?? '';
    };
    // An older primary, or one started without --replication-token, answers 404 for the routes.
    assert.match(await follow(undefined, 'a-token-that-is-long-enough'), /answered 404: it has no replication routes.*--replication-token.*older version.*upgrade the main server first/);
    assert.match(await follow(TOKEN, 'another-token-of-enough-length'), /refused the replication token/);
  } finally {
    for (const sb of standbys) await sb.stop();
    for (const s of servers) await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('while a standby runs its folder cannot be served, so nothing writes to it until it is promoted', async () => {
  const { spawnSync } = await import('node:child_process');
  const w = await build(41);
  try {
    const cli = join(import.meta.dirname, '..', '..', 'cli', 'src', 'main.ts');
    const r = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', cli, 'serve', w.standbyNode.dir, '--port', '0'], { encoding: 'utf8', timeout: 60_000 });
    assert.notEqual(r.status, 0, 'serve refuses the standby folder while the standby runs');
    assert.match(r.stderr, /already hosted by process \d+/);
    // Once the standby stops, the folder is an ordinary hosted folder.
    await w.stopStandby();
    await w.startServer(w.standbyNode);
    assert.ok(w.standbyNode.log.some((m) => m.startsWith('taking over from ')));
  } finally {
    await w.closeAll();
  }
});

test('the file format of a newer primary is noticed when its standby is promoted, with a clear message', async () => {
  const w = await build(51);
  try {
    w.edit();
    await w.settle('format');
    await w.stopStandby();
    // As if the copy came from a primary one file-format version ahead of this build.
    const db = new DatabaseSync(w.standbyFile());
    db.prepare("INSERT INTO _fm_meta VALUES ('storeFormat', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run('99');
    db.close();
    await w.startServer(w.standbyNode);
    assert.equal(w.standbyNode.server!.host.get(DB), undefined, 'the newer file is not opened by an older build');
    assert.ok(w.standbyNode.log.some((m) => /written by a newer Tabularius.*Update Tabularius/.test(m)), w.standbyNode.log.join(' | '));
  } finally {
    await w.closeAll();
  }
});

test('accounts and API tokens come with the file when a standby is promoted; sessions do not', async () => {
  const w = await build(61);
  try {
    w.edit(); // a first record
    const primaryUrl = w.primary.server!.url;
    const apiToken = w.store().createApiToken('ann', { label: 'model' });
    const session = await signIn(primaryUrl, 'ann', w.model.passwords.get('ann')!);
    assert.ok(session, 'ann signs in on the primary');
    await w.settle('tokens');
    await w.stopStandby();
    w.checkStandbyFile('before promotion', true);
    await w.stopServer(w.primary);
    await w.startServer(w.standbyNode);
    const url = w.standbyNode.server!.url;
    const records = (token: string) => dataApi(url, '/layouts/Items/records?_limit=5', { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await records(apiToken)).status, 200, 'an API token made on the primary works on the promoted server');
    assert.equal((await records(session!)).status, 401, 'a session made on the primary does not (sessions live in the memory of one server process)');
    assert.ok(await signIn(url, 'ann', w.model.passwords.get('ann')!), 'ann signs in again with the same password');
    assert.equal(await signIn(url, 'ann', 'not-the-password'), undefined);
  } finally {
    await w.closeAll();
  }
});

test('a standby that crashed right after its first copy starts again instead of calling its own file foreign', async () => {
  const w = await build(71);
  try {
    // A fresh copy, to catch the moment after the file appears and before the debounced save of the standby's notes.
    await w.stopStandby();
    rmSync(w.standbyFile(), { force: true });
    rmSync(join(w.standbyNode.dir, STANDBY_STATE), { force: true });
    const sb = new Standby({ folder: w.standbyNode.dir, primary: w.primary.link.url, token: TOKEN, wait: 1, log: () => {} });
    sb.start();
    const end = Date.now() + 10_000;
    while (!sb.state.files[DB] && Date.now() < end) await sleep(2);
    assert.ok(sb.state.files[DB], 'the first copy arrived');
    const notes = readFileSync(join(w.standbyNode.dir, STANDBY_STATE), 'utf8');
    assert.ok(existsSync(w.standbyFile()));
    // Killed here: the notes on disk are what they were just after the copy appeared.
    await sb.stop();
    writeFileSync(join(w.standbyNode.dir, STANDBY_STATE), notes);
    await w.startStandbyNow();
    w.edit();
    await w.settle('after a crash right after the first copy');
    await w.inspect('after the crash', { expectAll: true });
  } finally {
    await w.closeAll();
  }
});

test('a primary killed without warning: its acknowledged edits are all there when it comes back and its standby follows it exactly', async () => {
  const { spawn } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'tabularius-standby-kill-'));
  const dir = join(root, 'primary');
  const sdir = join(root, 'standby');
  mkdirSync(dir);
  mkdirSync(sdir);
  createStore(join(dir, FILE));
  const s0 = new Store(join(dir, FILE), DB);
  s0.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }, { name: 'Qty', type: 'number' }] }]);
  s0.close();
  const link = new Link();
  await link.listen();
  const here = new URL('../src/index.ts', import.meta.url).href;
  const script = `
    import { serve } from ${JSON.stringify(here)};
    const s = await serve({ dir: ${JSON.stringify(dir)}, port: 0, watch: false, replicationToken: ${JSON.stringify(TOKEN)}, log: () => {} });
    console.log('PORT ' + new URL(s.url).port);
    process.stdin.once('data', async () => {
      const st = s.host.get(${JSON.stringify(DB)});
      for (let i = 0; i < 5; i++) st.create('Items', { Name: 'shipped ' + i, Qty: i });
      await new Promise((r) => setTimeout(r, 2500));
      for (let i = 0; i < 7; i++) st.create('Items', { Name: 'unshipped ' + i, Qty: i });
      console.log('ABOUT TO DIE');
      process.kill(process.pid, 'SIGKILL');
    });
  `;
  const child = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => void (out += d));
  const exited = new Promise<string | null>((r) => child.on('exit', (_c, sig) => r(sig)));
  let standby: Standby | undefined;
  let server: Served | undefined;
  try {
    const until = async (ok: () => boolean, what: string) => { const end = Date.now() + 20_000; while (!ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${out}`); await sleep(20); } };
    await until(() => /PORT \d+/.test(out), 'the child to listen');
    link.target = Number(/PORT (\d+)/.exec(out)![1]);
    standby = new Standby({ folder: sdir, primary: link.url, token: TOKEN, wait: 1, log: () => {} });
    standby.start();
    await until(() => !!standby!.state.files[DB], 'the first copy');
    child.stdin.write('go\n');
    await until(() => out.includes('ABOUT TO DIE'), 'the child to finish its edits');
    assert.equal(await exited, 'SIGKILL');
    await standby.stop();
    // The standby is a state the primary committed: five edits or all twelve, never in between.
    const seen = (p: string) => { const c = join(root, `seen-${Math.random()}.sqlite`); copyFileSync(p, c); try { return fileDigest(c, []); } finally { rmSync(c, { force: true }); } };
    const rowsIn = (d: string) => (JSON.parse(d) as { rows: unknown[] }).rows.length;
    const held = rowsIn(seen(join(sdir, FILE)));
    assert.ok(held === 5 || held === 12, `the standby holds ${held} records: the five shipped ones, or all twelve`);
    // The primary comes back from its write-ahead log with everything it had committed.
    link.target = 0;
    server = await serve({ dir, port: 0, watch: false, replicationToken: TOKEN, log: () => {} });
    link.target = Number(new URL(server.url).port);
    assert.equal(server.host.get(DB)!.find('Items', { limit: 100 }).records.length, 12, 'every committed edit survived the kill');
    standby = new Standby({ folder: sdir, primary: link.url, token: TOKEN, wait: 1, log: () => {} });
    standby.start();
    const end = Date.now() + 20_000;
    const wal = join(dir, FILE + '-wal');
    for (;;) {
      const pos = (await (await fetch(`${server.url}/tabularius/replication/v1/files`, { headers: { authorization: `Bearer ${TOKEN}` } })).json() as { files: { run: string; seq: number }[] }).files[0]!;
      const mine = standby.state.files[DB];
      if (mine && mine.run === pos.run && mine.seq === pos.seq && mine.seq >= mine.wholeAfter && (!existsSync(wal) || statSync(wal).size === 0)) break;
      if (Date.now() > end) throw new Error('the standby did not follow the restarted primary');
      await sleep(50);
    }
    await standby.stop();
    standby = undefined;
    await new Promise<void>((r) => server!.server.close(() => r()));
    server = undefined;
    assert.equal(seen(join(sdir, FILE)), seen(join(dir, FILE)), 'the standby is the recovered primary');
  } finally {
    child.kill('SIGKILL');
    await standby?.stop();
    if (server) await new Promise<void>((r) => server!.server.close(() => r()));
    await link.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('a standby does not silently discard writes made on its own folder (it refuses and reports)', async () => {
  const w = await build(81);
  try {
    w.edit();
    await w.settle('before the local edit');
    await w.stopStandby();
    const local = new Store(w.standbyFile(), DB);
    local.update('Items', [...w.model.rows.keys()][0]!, { Name: 'written on the standby' });
    local.close();
    // The standby refuses to start, naming the file and the way past it, and the file is left as it was.
    await assert.rejects(w.startStandbyNow(), /changed here since it was last updated: use --overwrite/);
    const copy = join(w.root, 'local.sqlite');
    copyFileSync(w.standbyFile(), copy);
    assert.ok(fileDigest(copy, []).includes('written on the standby'), 'the write made on the standby survives');
    // --overwrite is the way past it, and replaces the file with the primary's copy.
    w.standby = new Standby({ folder: w.standbyNode.dir, primary: w.primary.link.url, token: TOKEN, wait: 1, overwrite: true, log: (m) => void w.standbyLog.push(m) });
    w.standby.start();
    await w.settle('after --overwrite');
    await w.stopStandby();
    copyFileSync(w.standbyFile(), copy);
    assert.ok(!fileDigest(copy, []).includes('written on the standby'), 'the primary copy replaced it');
  } finally {
    await w.closeAll();
  }
});

// ---------------------------------------------------------------------------------------------------- what the code does not do yet
// Each of these states a rule the design asks for and fails today. They are `todo`: they run, their failure is reported
// as expected, and they turn into ordinary tests the day they pass. The reproductions and the reasons are in
// notes/audits/r24-02-standby-model.md.

const AUDIT = 'notes/audits/r24-02-standby-model.md';

test('a container stored outside the file (open external storage) reaches the standby, by hash', { todo: `${AUDIT}, finding 2` }, async () => {
  const w = await build(82);
  try {
    const s = w.store();
    s.applyDesign([{ op: 'createTable', name: 'Docs', fields: [{ name: 'Title' }, { name: 'File', type: 'container' }] }]);
    s.applyDesign([{ op: 'updateField', table: 'Docs', field: 'File', options: { externalStorage: { directory: 0, path: '"Docs/" & Title & "/"' } } }]);
    const rec = s.create('Docs', { Title: 'a' });
    const bytes = Buffer.from('a container file kept beside the database, not in it');
    s.setContainer('Docs', rec.recordId, 'File', 1, { filename: 'a.txt', mime: 'text/plain', data: bytes });
    assert.ok(existsSync(join(w.primary.dir, 'RC_Data_FMS', DB, 'Docs', 'a', 'a.txt')), 'the primary keeps the file beside the database');
    await w.settle('external container');
    const there = join(w.standbyNode.dir, 'RC_Data_FMS', DB, 'Docs', 'a', 'a.txt');
    assert.ok(existsSync(there), 'the standby has the container file');
    assert.equal(sha(readFileSync(there)), sha(bytes));
  } finally {
    await w.closeAll();
  }
});

test('changes replayed over a copy that already holds a later design change are harmless', { todo: `${AUDIT}, finding 3` }, async () => {
  // replication.ts: "the copy may already hold some changes after seq; applying those again is harmless".
  const { applyLog } = await import('../src/logs.ts');
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-standby-design-'));
  try {
    const path = join(dir, FILE);
    createStore(path);
    const s = new Store(path, DB);
    s.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }, { name: 'Qty', type: 'number' }] }]);
    s.sql.exec('PRAGMA wal_autocheckpoint = 0');
    s.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const replica = join(dir, 'replica.sqlite');
    await s.backup(replica);
    const logs: Buffer[] = [];
    const ship = () => void s.shipWal((l) => { logs.push(Buffer.from(l)); return true; });
    s.create('Items', { Name: 'one', Qty: 1 }); ship();
    s.create('Items', { Name: 'two', Qty: 2 }); ship();
    s.applyDesign([{ op: 'createField', table: 'Items', name: 'Extra', type: 'text' }]); ship();
    s.create('Items', { Name: 'three', Qty: 3 }); ship();
    // The copy was taken after all four changes; the standby is told it holds the first and applies the rest, then the repeats.
    for (const l of logs) applyLog(replica, l);
    for (const l of logs.slice(1)) applyLog(replica, l);
    const db = new DatabaseSync(replica, { readOnly: true });
    try { assert.equal((db.prepare('PRAGMA quick_check').get() as Record<string, string>).quick_check, 'ok'); } finally { db.close(); }
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
