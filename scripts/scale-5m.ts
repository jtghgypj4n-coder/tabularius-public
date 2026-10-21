// Synthetic scale probe. Run separately from the test suite:
//   node --max-old-space-size=2048 scripts/scale-5m.ts
//   node --max-old-space-size=2048 scripts/scale-5m.ts --records 200000
// It creates only disposable files. A 5M run requires 20 GiB free and a 1-minute load average below 20.
import assert from 'node:assert/strict';
import { createWriteStream, mkdtempSync, rmSync, statfsSync, statSync } from 'node:fs';
import { once as eventOnce } from 'node:events';
import { connect, type Socket } from 'node:net';
import { cpus, loadavg, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store, type DesignOp } from '../packages/store/src/index.ts';
import { backupFolder } from '../packages/server/src/backup.ts';
import { serve } from '../packages/server/src/index.ts';

const at = process.argv.indexOf('--records');
const records = at < 0 ? 5_000_000 : Number(process.argv[at + 1]);
if (!Number.isSafeInteger(records) || records < 1_000 || records > 5_000_000) throw new Error('--records must be 1000..5000000');
const free = (() => { const s = statfsSync(tmpdir()); return s.bavail * s.bsize; })();
if (records === 5_000_000 && free < 20 * 1024 ** 3) throw new Error('Stop: less than 20 GiB free on the temporary volume');
if (loadavg()[0] >= 20) throw new Error(`Stop: one-minute load average ${loadavg()[0].toFixed(1)} is at least 20`);

const dir = mkdtempSync(join(tmpdir(), 'openhbam-scale-5m-'));
const path = join(dir, 'Scale.openhbam.sqlite');
const timings: Record<string, number> = {};
const memory: Record<string, { rss: number; heapUsed: number }> = {};
let exportBytes = 0;
const sample = (name: string) => {
  const m = process.memoryUsage();
  memory[name] = { rss: m.rss, heapUsed: m.heapUsed };
};
async function measure<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await run();
  timings[name] = Math.round(performance.now() - start);
  sample(name);
  process.stderr.write(`${name}: ${timings[name]} ms\n`);
  return result;
}

// Simple protocol client for one bounded pgwire query; no external client process is needed.
class PgClient {
  private buffer = Buffer.alloc(0);
  private wake?: () => void;
  readonly socket: Socket;
  constructor(socket: Socket) {
    this.socket = socket;
    socket.on('data', (b: Buffer) => { this.buffer = Buffer.concat([this.buffer, b]); this.wake?.(); });
    socket.on('close', () => this.wake?.());
  }
  private async message(): Promise<{ type: string; body: Buffer }> {
    while (this.buffer.length < 5 || this.buffer.length < this.buffer.readInt32BE(1) + 1) {
      if (this.socket.destroyed) throw new Error('pgwire socket closed');
      await new Promise<void>((resolve) => { this.wake = resolve; });
      this.wake = undefined;
    }
    const end = this.buffer.readInt32BE(1) + 1;
    const out = { type: String.fromCharCode(this.buffer[0]), body: this.buffer.subarray(5, end) };
    this.buffer = this.buffer.subarray(end);
    return out;
  }
  private send(type: string, body: Buffer): void {
    const head = Buffer.alloc(5);
    head.write(type);
    head.writeInt32BE(body.length + 4, 1);
    this.socket.write(Buffer.concat([head, body]));
  }
  private async until(type: string): Promise<{ type: string; body: Buffer }[]> {
    const messages = [];
    for (;;) {
      const m = await this.message();
      if (m.type === 'E') throw new Error(`pgwire: ${m.body.toString('utf8')}`);
      messages.push(m);
      if (m.type === type) return messages;
    }
  }
  static async open(port: number): Promise<PgClient> {
    const socket = connect(port, '127.0.0.1');
    await eventOnce(socket, 'connect');
    const client = new PgClient(socket);
    const fields = Buffer.from('user\0Admin\0database\0Scale\0\0');
    const head = Buffer.alloc(8);
    head.writeInt32BE(8 + fields.length);
    head.writeInt32BE(196608, 4);
    socket.write(Buffer.concat([head, fields]));
    const auth = await client.message();
    assert.equal(auth.type, 'R');
    assert.equal(auth.body.readInt32BE(0), 3);
    client.send('p', Buffer.from('scale-test\0'));
    await client.until('Z');
    return client;
  }
  async query(sql: string): Promise<number> {
    this.send('Q', Buffer.from(sql + '\0'));
    return (await this.until('Z')).filter((m) => m.type === 'D').length;
  }
  close(): void { this.socket.destroy(); }
}

let server: Awaited<ReturnType<typeof serve>> | undefined;
try {
  createStore(path, { mode: 'native' });
  const design = new Store(path, 'Scale');
  try {
    design.applyDesign([
      { op: 'createTable', name: 'Invoices', fields: [
        { name: 'Id', type: 'number' }, { name: 'Customer' }, { name: 'Region' },
        { name: 'Amount', type: 'number' }, { name: 'Notes' },
      ] },
      { op: 'createField', table: 'Invoices', name: 'Total Amount', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
      { op: 'createLayout', name: 'Invoice List', occurrence: 'Invoices' },
    ] as DesignOp[]);
    const list = design.design('Invoice List')!;
    design.applyDesign([{ op: 'updateLayout', layout: 'Invoice List', design: {
      objects: list.objects.filter((o) => o.field?.field !== 'Total Amount' && o.text !== 'Total Amount'),
      tableView: list.tableView?.filter((c) => c.field.field !== 'Total Amount'),
    } }] as DesignOp[]);
    const full = design.privilegeSets().find((p) => p.id === 1)!;
    design.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest', 'fmodata', 'fmxdbc'])] });
    design.setPassword('Admin', 'scale-test', full.name);
  } finally { design.close(); }

  // Generated rows are imported into the native store in one SQLite transaction.
  // This measures native bulk loading, not conversion of a Claris .fmp12 file.
  await measure('synthetic_import', () => {
    const db = new DatabaseSync(path);
    let inTransaction = false;
    try {
      db.exec('BEGIN');
      inTransaction = true;
      const insert = db.prepare('INSERT INTO Invoices (Id, Customer, Region, Amount, Notes) VALUES (?, ?, ?, ?, ?)');
      const regions = ['North', 'South', 'East', 'West', 'Midlands'];
      for (let i = 1; i <= records; i++) {
        insert.run(i, `Customer ${i % 5000}`, regions[i % 5], (i * 37) % 100000 / 100, `order ${i} warranty`);
      }
      db.exec('COMMIT');
      inTransaction = false;
      db.exec('CREATE INDEX scale_invoice_id ON Invoices (Id)');
      db.exec('ANALYZE');
    } catch (e) { if (inTransaction) db.exec('ROLLBACK'); throw e; }
    finally { db.close(); }
  });
  const bytes = statSync(path).size;
  const store = new Store(path, 'Scale');
  try {
    await measure('indexed_find', () => {
      const result = store.find('Invoice List', { query: [{ Id: String(records - 1) }], limit: 50, layoutOnly: true });
      assert.equal(result.foundCount, 1);
    });
    await measure('unindexed_find', () => {
      // A leading wildcard forces a scan; the query plan is checked so the label stays honest.
      const plan = store.sql.prepare("EXPLAIN QUERY PLAN SELECT count(*) FROM Invoices WHERE Notes LIKE '%warranty%'").all() as { detail: string }[];
      assert.ok(plan.some((r) => /SCAN Invoices/i.test(r.detail)), JSON.stringify(plan));
      const n = (store.sql.prepare("SELECT count(*) AS n FROM Invoices WHERE Notes LIKE '%warranty%'").get() as { n: number }).n;
      assert.equal(n, records);
    });
    await measure('sort_first_page', () => {
      assert.equal(store.find('Invoice List', { sort: [{ fieldName: 'Customer', sortOrder: 'ascend' }], limit: 50, layoutOnly: true }).records.length, Math.min(50, records));
    });
    await measure('list_first_page', () => {
      assert.equal(store.find('Invoice List', { limit: 50, layoutOnly: true }).records.length, Math.min(50, records));
    });
    await measure('summary', () => {
      assert.equal(store.find('Invoices', { limit: 1, layoutOnly: true }).foundCount, records);
    });
    await measure('subsummary', () => {
      const ids = store.findIds('Invoice List', { sort: [{ fieldName: 'Region', sortOrder: 'ascend' }] });
      assert.equal(ids.length, records);
      const groups = store.groupSummaries('Invoices', ids, ['Region']);
      assert.equal(groups[0].reduce((n, r) => n + r.count, 0), records);
    });
  } finally { store.close(); }

  await measure('backup', async () => {
    const result = await backupFolder(dir, join(dir, 'backups'), 1, undefined);
    assert.ok(result.files.length > 0);
  });
  const logs: string[] = [];
  server = await serve({ dir, port: 0, sqlPort: 0, hostname: '127.0.0.1', watch: false, log: (s) => { logs.push(s); } });
  const api = `${server.url}/fmi/data/vLatest/databases/Scale`;
  const login = await fetch(`${api}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:scale-test') } });
  assert.equal(login.status, 200);
  const token = (await login.json() as { response: { token: string } }).response.token;
  await measure('export_csv_http', async () => {
    const res = await fetch(`${server!.url}/openhbam/app/v1/databases/Scale/layouts/Invoice%20List/export`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: ['Id', 'Customer', 'Region', 'Amount', 'Notes'], format: 'csv', fieldNames: true }),
    });
    assert.equal(res.status, 200);
    const output = createWriteStream(join(dir, 'invoices.csv'));
    try {
      const reader = res.body!.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        exportBytes += value.byteLength;
        if (!output.write(value)) await eventOnce(output, 'drain');
      }
      output.end();
      await eventOnce(output, 'finish');
    } catch (e) { output.destroy(); throw e; }
    assert.ok(exportBytes > records, 'the CSV export was too small');
  });
  await measure('data_api_find_page', async () => {
    const res = await fetch(`${api}/layouts/Invoice%20List/_find`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: [{ Amount: '0...500' }], limit: '50', offset: '101' }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { response: { data: unknown[] } }).response.data.length, Math.max(0, Math.min(50, Math.floor(records / 2) - 100)));
  });
  await measure('odata_top_skip', async () => {
    const res = await fetch(`${server!.url}/fmi/odata/v4/Scale/Invoices?$top=50&$skip=100`, { headers: { authorization: 'Basic ' + btoa('Admin:scale-test') } });
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { value: unknown[] }).value.length, Math.max(0, Math.min(50, records - 100)));
  });
  let port = Number(/port (\d+)/.exec(logs.find((s) => s.startsWith('PostgreSQL clients: port')) ?? '')?.[1]);
  for (let i = 0; !port && i < 100; i++) {
    await new Promise((r) => setTimeout(r, 20));
    port = Number(/port (\d+)/.exec(logs.find((s) => s.startsWith('PostgreSQL clients: port')) ?? '')?.[1]);
  }
  assert.ok(port, 'pgwire did not start');
  const pg = await PgClient.open(port);
  try {
    await measure('pgwire_select_limit', async () => {
      assert.equal(await pg.query('SELECT Id FROM Invoices LIMIT 50'), Math.min(50, records));
    });
  } finally { pg.close(); }

  console.log(JSON.stringify({ records, machine: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model, cpuCount: cpus().length, memoryBytes: totalmem(), load1: loadavg()[0] }, fileBytes: bytes, exportBytes, peakRssBytes: process.resourceUsage().maxRSS * (process.platform === 'darwin' ? 1 : 1024), memory, timings }, null, 2));
} catch (e) {
  // Preserve completed measurements if a later operation exposes a scale failure.
  process.stderr.write(JSON.stringify({ records, timings, memory, error: e instanceof Error ? e.message : String(e) }) + '\n');
  throw e;
} finally {
  if (server) await new Promise<void>((resolve) => server!.server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}
