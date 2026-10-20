// Performance benchmark: how long a large hosted file takes to open, find,
// sort (also on an unstored calculation), work out summary fields, run ExecuteSQL, import, export, back up and
// restore, and how much memory the run reached.
//
//   npm run bench -- [--records 200000] [--customers 5000] [--runs 5] [--import 100000] [--markdown] [--json] [--keep]
//
// The file is synthetic, made here from nothing: a Customers table and an
// Invoices table filled with generated names, regions, dates and amounts from
// a fixed seed, so every run measures the same data. No .fmp12 and no real
// file is used or written; the database lives in a temporary folder that is
// removed afterwards (--keep leaves it, and says where). Nothing reaches the
// network, and no scripts run.
//
// Each operation runs --runs times on one open file. "First" is the first run;
// "median" and "min" are over the rest. Where Tabularius keeps a result while
// the data is unchanged (summaries, ExecuteSQL), "after a change" edits one
// invoice before each run, so the work is done again, and "unchanged" repeats
// it with no edit in between. Import, export, backup and restore are each done once (they change or copy the file),
// and the export is of every invoice.
//
// This is not part of `npm test` or CI: timings depend on the machine. Record a
// baseline in docs/performance.md with --markdown.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { createStore, csvField, Store, type DesignOp, type FindOptions } from '../packages/store/src/index.ts';
import { applyImport, planImport, type Cell } from '../packages/server/src/import-mapping.ts';
import { backupFolder, restoreBackup } from '../packages/server/src/backup.ts';

const args = process.argv.slice(2);
const opt = (name: string, def: number): number => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = Number(args[i + 1]);
  if (!Number.isInteger(v) || v < 1) throw new Error(`${name} needs a whole number above 0`);
  return v;
};
const RECORDS = opt('--records', 200_000);
const CUSTOMERS = opt('--customers', 5_000);
const IMPORT_ROWS = opt('--import', 100_000);
const RUNS = Math.max(2, opt('--runs', 5));
const MARKDOWN = args.includes('--markdown');
const JSON_OUT = args.includes('--json');
const KEEP = args.includes('--keep');

/** A small fast PRNG (mulberry32), so the data is the same on every run. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ada', 'Grace', 'Alan', 'Edsger', 'Barbara', 'Donald', 'Frances', 'John', 'Katherine', 'Linus', 'Margaret', 'Niklaus', 'Radia', 'Tim', 'Sophie', 'Ken'];
const LAST = ['Lovelace', 'Hopper', 'Turing', 'Dijkstra', 'Liskov', 'Knuth', 'Allen', 'Backus', 'Johnson', 'Torvalds', 'Hamilton', 'Wirth', 'Perlman', 'Berners', 'Wilson', 'Thompson'];
const CITIES = ['Leeds', 'York', 'Bristol', 'Glasgow', 'Cardiff', 'Belfast', 'Norwich', 'Exeter', 'Dundee', 'Bath', 'Derby', 'Hull'];
const REGIONS = ['North', 'South', 'East', 'West', 'Midlands'];
const STATUSES = ['Paid', 'Paid', 'Paid', 'Open', 'Overdue'];
const WORDS = ['urgent', 'repeat', 'discount', 'export', 'warranty', 'sample', 'trade', 'online', 'phone', 'counter'];

/**
 * Builds the synthetic database: its design through the store, then the records straight into SQLite in one
 * transaction. Returns one customer's name, for a find that matches that customer's invoices.
 */
function build(path: string): string {
  createStore(path);
  const store = new Store(path, 'Bench');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] },
    { op: 'createTable', name: 'Invoices', fields: [
      { name: 'Id', type: 'number' }, { name: 'CustomerId', type: 'number' }, { name: 'Customer' }, { name: 'Region' },
      { name: 'Date', type: 'date' }, { name: 'Amount', type: 'number' }, { name: 'Status' }, { name: 'Notes' },
    ] },
    // Where the import goes, and an unstored calculation to find and sort by.
    { op: 'createTable', name: 'Imported', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerId', right: 'Id' }] },
    { op: 'createField', table: 'Invoices', name: 'Tax', type: 'number', kind: 'calculation', calculation: 'Amount * 0.2', options: { unstored: true } },
    { op: 'createField', table: 'Invoices', name: 'Total Amount', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
    { op: 'createField', table: 'Invoices', name: 'Average Amount', kind: 'summary', summary: { type: 'average', field: 'Amount' } },
    { op: 'createField', table: 'Invoices', name: 'Invoice Count', kind: 'summary', summary: { type: 'count', field: 'Id' } },
    // The same fields without the summaries, for finds and sorts that don't ask for them.
    { op: 'createLayout', name: 'Invoice List', occurrence: 'Invoices' },
  ] as DesignOp[]);
  const list = store.design('Invoice List')!;
  const summaries = new Set(['Total Amount', 'Average Amount', 'Invoice Count']);
  // Its form leaves out their fields and labels (a layout uses every field it names), and so do its Table View columns.
  store.applyDesign([{ op: 'updateLayout', layout: 'Invoice List', design: {
    objects: list.objects.filter((o) => !summaries.has(o.field?.field ?? '') && !summaries.has(o.text ?? '')),
    tableView: list.tableView?.filter((c) => !summaries.has(c.field.field ?? '')),
  } }] as DesignOp[]);
  store.close();

  const rnd = random(20261012);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const sql = new DatabaseSync(path);
  sql.exec('BEGIN');
  const names: string[] = [];
  const customer = sql.prepare('INSERT INTO Customers (Id, Name, City) VALUES (?, ?, ?)');
  for (let i = 1; i <= CUSTOMERS; i++) {
    names[i] = `${pick(FIRST)} ${pick(LAST)} ${i}`;
    customer.run(i, names[i], pick(CITIES));
  }
  const invoice = sql.prepare('INSERT INTO Invoices (Id, CustomerId, Customer, Region, Date, Amount, Status, Notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const start = Date.UTC(2022, 0, 1);
  for (let i = 1; i <= RECORDS; i++) {
    const c = 1 + Math.floor(rnd() * CUSTOMERS);
    const date = new Date(start + Math.floor(rnd() * 4 * 365) * 86_400_000).toISOString().slice(0, 10);
    const amount = Math.round(rnd() * 100_000) / 100;
    invoice.run(i, c, names[c], pick(REGIONS), date, amount, pick(STATUSES), `${pick(WORDS)} ${pick(WORDS)} order ${i}`);
  }
  sql.exec('COMMIT');
  sql.close();
  return names[Math.ceil(CUSTOMERS / 2)];
}

interface Row { group: string; operation: string; found?: number; first: number; median: number; min: number }
const rows: Row[] = [];

const now = () => performance.now();
// A fixed amount of CPU work measured on the same machine as the operations.
// Keep the result observable so the loop cannot be removed by an optimizer.
function calibrate(): number {
  let value = 0;
  const start = now();
  for (let i = 0; i < 30_000_000; i++) value = (Math.imul(value ^ i, 1664525) + 1013904223) | 0;
  if (!Number.isInteger(value)) throw new Error('calibration failed');
  return now() - start;
}
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Records one run of something that changes or copies the file, so it can't be repeated: first, median and min are the one time. */
async function once(group: string, operation: string, run: () => number | void | Promise<number | void>): Promise<void> {
  const t = now();
  const n = await run();
  const ms = now() - t;
  rows.push({ group, operation, found: typeof n === 'number' ? n : undefined, first: ms, median: ms, min: ms });
  if (!JSON_OUT && !MARKDOWN) process.stderr.write(`  ${operation}: ${ms.toFixed(1)} ms\n`);
}

/** Times `run` RUNS times (calling `before` untimed ahead of each), and records it. */
function time(group: string, operation: string, run: () => number | void, before?: () => void): void {
  const times: number[] = [];
  let found: number | undefined;
  for (let i = 0; i < RUNS; i++) {
    before?.();
    const t = now();
    const n = run();
    times.push(now() - t);
    if (typeof n === 'number') found = n;
  }
  const rest = times.slice(1);
  rows.push({ group, operation, found, first: times[0], median: median(rest), min: Math.min(...rest) });
  if (!JSON_OUT && !MARKDOWN) process.stderr.write(`  ${operation}: ${times[0].toFixed(1)} ms first, ${median(rest).toFixed(1)} ms median\n`);
}

const dir = mkdtempSync(join(tmpdir(), 'tabularius-bench-'));
const path = join(dir, 'Bench.openhbam.sqlite');
try {
  calibrate(); // Warm the calibration loop before timing it.
  const calibrationBefore = calibrate();
  if (!JSON_OUT && !MARKDOWN) process.stderr.write(`Making ${RECORDS.toLocaleString('en')} invoices for ${CUSTOMERS.toLocaleString('en')} customers in ${dir}\n`);
  const made = now();
  const someone = build(path);
  const buildMs = now() - made;

  // Open: a fresh Store on the file, through to its first page of records, as a server does when it hosts it.
  time('Open', 'Open the file and read the first 50 records', () => {
    const s = new Store(path, 'Bench');
    const n = s.find('Invoice List', { limit: 50, layoutOnly: true }).foundCount;
    s.close();
    return n;
  });

  const store = new Store(path, 'Bench');
  // One page of 50, as the web client and most Data API calls ask for.
  const page = (layout: string, opts: FindOptions) => store.find(layout, { limit: 50, layoutOnly: true, ...opts }).foundCount;
  let edits = 0;
  // An edit to one invoice: Tabularius drops what it kept for the data, so the next run works it out again.
  const change = () => {
    store.update('Invoice List', 1 + (edits++ % RECORDS), { Amount: 100 + (edits % 7) });
  };

  time('Find', 'Text, one word (first run builds the word index)', () => page('Invoice List', { query: [{ Notes: 'warranty' }] }));
  time('Find', 'Text, one customer\'s name (three words)', () => page('Invoice List', { query: [{ Customer: someone }] }));
  time('Find', 'Number range (Amount 900...1000)', () => page('Invoice List', { query: [{ Amount: '900...1000' }] }));
  time('Find', 'Date range (one month)', () => page('Invoice List', { query: [{ Date: '3/1/2024...3/31/2024' }] }));
  time('Find', 'Two fields (Region and Status)', () => page('Invoice List', { query: [{ Region: 'North', Status: 'Overdue' }] }));
  time('Find', 'Two requests, with an omit', () => page('Invoice List', { query: [{ Status: 'Open' }, { Region: 'West', omit: 'true' }] as never }));

  time('Find', 'Unstored calculation (Tax 100...200)', () => page('Invoice List', { query: [{ Tax: '100...200' }] }));

  time('Sort', 'All records by Customer', () => page('Invoice List', { sort: [{ fieldName: 'Customer', sortOrder: 'ascend' }] }));
  time('Sort', 'All records by Amount, descending', () => page('Invoice List', { sort: [{ fieldName: 'Amount', sortOrder: 'descend' }] }));
  time('Sort', 'All records by Region, then Date', () => page('Invoice List', { sort: [{ fieldName: 'Region', sortOrder: 'ascend' }, { fieldName: 'Date', sortOrder: 'descend' }] }));
  time('Sort', 'All records by an unstored calculation (Tax)', () => page('Invoice List', { sort: [{ fieldName: 'Tax', sortOrder: 'descend' }] }));
  time('Sort', 'A found set (Status Open) by Customer', () => page('Invoice List', { query: [{ Status: 'Open' }], sort: [{ fieldName: 'Customer', sortOrder: 'ascend' }] }));

  // Summary fields over the found set (total, average and count), read with the first page.
  time('Summary fields', 'All records, after a change', () => page('Invoices', {}), change);
  time('Summary fields', 'All records, unchanged', () => page('Invoices', {}));
  time('Summary fields', 'A found set (Region North), after a change', () => page('Invoices', { query: [{ Region: 'North' }] }), change);
  time('Summary fields', 'A found set (Region North), unchanged', () => page('Invoices', { query: [{ Region: 'North' }] }));

  const sqlCalc = (q: string, ...params: string[]) => `ExecuteSQL ( "${q}" ; "" ; "" ${params.map((p) => `; "${p}"`).join(' ')} )`;
  const evaluate = (formula: string) => () => {
    const r = store.evaluate('Invoices', formula);
    if (r.value === '?') throw new Error(`${formula} gave ?`);
  };
  const queries: [string, string][] = [
    ['SUM with a WHERE', sqlCalc('SELECT SUM(Amount) FROM Invoices WHERE Region = ?', 'North')],
    ['COUNT with GROUP BY', sqlCalc('SELECT Status, COUNT(*) FROM Invoices GROUP BY Status')],
    ['JOIN to Customers, GROUP BY city', sqlCalc('SELECT c.City, SUM(i.Amount) FROM Invoices i JOIN Customers c ON i.CustomerId = c.Id GROUP BY c.City')],
    ['ORDER BY with FETCH FIRST 10', sqlCalc('SELECT Customer, Amount FROM Invoices ORDER BY Amount DESC FETCH FIRST 10 ROWS ONLY')],
  ];
  for (const [name, formula] of queries) {
    time('ExecuteSQL', `${name}, after a change`, evaluate(formula), change);
    time('ExecuteSQL', `${name}, unchanged`, evaluate(formula));
  }

  // Import: a text table of IMPORT_ROWS rows (a header row, then the fields as text, as a CSV file reads) into an empty table.
  const text: Cell[][] = [['Id', 'Name', 'City', 'Amount']];
  for (let i = 1; i <= IMPORT_ROWS; i++) text.push([String(i), `${FIRST[i % FIRST.length]} ${LAST[(i >> 4) % LAST.length]} ${i}`, CITIES[i % CITIES.length], String((i * 37) % 10_000 / 100)]);
  await once('Import', `Plan and import ${IMPORT_ROWS.toLocaleString('en')} rows of four fields`, async () => {
    const plan = await planImport(store, 'Imported', text);
    return applyImport(store, 'Imported', text, { headerRow: plan.headerRow, columns: plan.columns, keys: [] }, { account: 'Admin' }).imported;
  });
  // Export: every invoice's stored fields as comma-separated text, in pages of 500 as the web client's export does.
  await once('Export', `Every invoice (${RECORDS.toLocaleString('en')}) as comma-separated text, built in memory`, () => {
    const fields = ['Id', 'CustomerId', 'Customer', 'Region', 'Date', 'Amount', 'Status', 'Notes'];
    const ids = store.findIds('Invoice List', {});
    const lines = [fields.map((f) => csvField(f, { quoteAll: true })).join(',')];
    for (let i = 0; i < ids.length; i += 500) {
      for (const r of store.getMany('Invoice List', ids.slice(i, i + 500), ids, { fields })) lines.push(fields.map((f) => csvField(String(r.fieldData[f] ?? ''), { quoteAll: true })).join(','));
    }
    if (Buffer.byteLength(lines.join('\r\n')) < RECORDS) throw new Error('the export is empty');
  });
  store.close();

  // Backup and restore of the hosted folder: the file copied into a new set, and back into an empty folder.
  const backups = join(dir, 'backups');
  const restored = join(dir, 'restored');
  mkdirSync(restored);
  let set = '';
  await once('Backup', 'Back up the file to a new set', async () => {
    set = (await backupFolder(dir, backups, 7, undefined)).dir;
  });
  await once('Restore', 'Restore the set into an empty folder', async () => {
    if (!(await restoreBackup(restored, set, undefined, undefined)).length) throw new Error('nothing was restored');
  });

  const size = statSync(path).size;
  // Peak resident memory of the whole run, which includes making the data (ru_maxrss: kilobytes on Linux, bytes on macOS).
  const peak = process.resourceUsage().maxRSS * (process.platform === 'darwin' ? 1 : 1024);
  const calibrationMs = (calibrationBefore + calibrate()) / 2;
  if (JSON_OUT) {
    console.log(JSON.stringify({ records: RECORDS, customers: CUSTOMERS, runs: RUNS, buildMs, bytes: size, peakRssBytes: peak, calibrationMs, rows }, null, 2));
  } else {
    const ms = (v: number) => v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString('en');
    const header = ['Area', 'Operation', 'Found', 'First (ms)', 'Median (ms)', 'Min (ms)'];
    const body = rows.map((r) => [r.group, r.operation, r.found === undefined ? '' : r.found.toLocaleString('en'), ms(r.first), ms(r.median), ms(r.min)]);
    const about = [
      `${RECORDS.toLocaleString('en')} invoices, ${CUSTOMERS.toLocaleString('en')} customers, ${(size / 1024 / 1024).toFixed(0)} MB on disk (made in ${(buildMs / 1000).toFixed(1)} s)`,
      `Node ${process.version}, ${cpus()[0]?.model ?? 'unknown CPU'} × ${cpus().length}, ${(totalmem() / 1024 ** 3).toFixed(0)} GB memory, ${process.platform}`,
      `${RUNS} runs each; median and min leave out the first (import, export, backup and restore once)`,
      `Peak memory of the whole run: ${(peak / 1024 / 1024).toFixed(0)} MB (includes making the data)`,
    ];
    if (MARKDOWN) {
      console.log(about.map((a) => `- ${a}`).join('\n') + '\n');
      console.log(`| ${header.join(' | ')} |`);
      console.log(`| ${header.map((h, i) => (i >= 2 ? '---:' : '---')).join(' | ')} |`);
      for (const b of body) console.log(`| ${b.join(' | ')} |`);
    } else {
      console.log('\n' + about.join('\n') + '\n');
      const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
      const line = (cells: string[]) => cells.map((c, i) => (i >= 2 ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ');
      console.log(line(header));
      console.log(widths.map((w) => '-'.repeat(w)).join('  '));
      for (const b of body) console.log(line(b));
    }
  }
} finally {
  if (KEEP) process.stderr.write(`Kept ${path}\n`);
  else rmSync(dir, { recursive: true, force: true });
}
