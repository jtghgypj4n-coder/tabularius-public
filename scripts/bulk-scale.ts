// Synthetic bulk-operation profile. Run `node scripts/bulk-scale.ts --rows 1000000` for the full profile,
// or `--rows 20000` to compare with the CI-sized tests. It never reads an existing file.
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store, type DesignOp } from '../packages/store/src/index.ts';
import * as trace from '../packages/store/src/trace.ts';
import { scriptStepName, type Script } from '../packages/fmp12/src/index.ts';
import { runScript } from '../packages/scripts/src/index.ts';
import { importMappedRows } from '../packages/server/src/import-mapping.ts';

const arg = process.argv.indexOf('--rows');
const ROWS = arg < 0 ? 1_000_000 : Number(process.argv[arg + 1]);
if (!Number.isSafeInteger(ROWS) || ROWS < 1 || ROWS > 1_000_000) throw new Error('--rows needs 1 through 1000000');
process.env.TABULARIUS_COUNT_SQL = '1';
const dir = mkdtempSync(join(tmpdir(), 'tabularius-bulk-scale-'));
const path = join(dir, 'Scale.openhbam.sqlite');
createStore(path);
const store = new Store(path, 'Scale');
const wal = () => existsSync(path + '-wal') ? statSync(path + '-wal').size : 0;
const report: { operation: string; rows: number; ms: number; rssMiB: number; statements: number; rowsWritten: number; walPeakMiB: number; pass: boolean }[] = [];
const script = (source: string): Script => ({ id: 9999, name: 'Synthetic bulk profile', steps: parseScriptText(source, store.schema).map((s) => ({
  stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params,
})) });
const run = (source: string, ids: number[]) => runScript(store, script(source), { layout: 'Items', foundSet: ids, documents: dir });

async function measure(operation: string, rows: number, statementBudget: number, writtenBudget: number, work: () => Promise<void> | void): Promise<void> {
  store.checkpoint();
  const before = { statements: trace.statements, written: trace.rowsWritten, rss: process.memoryUsage().rss };
  let peakRss = before.rss, peakWal = wal();
  const sample = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); peakWal = Math.max(peakWal, wal()); };
  const timer = setInterval(sample, 50);
  const start = performance.now();
  try { await work(); } finally { clearInterval(timer); sample(); }
  const ms = Math.round(performance.now() - start);
  const statements = trace.statements - before.statements;
  const rowsWritten = trace.rowsWritten - before.written;
  const rssMiB = Math.ceil(peakRss / 1024 / 1024);
  const walPeakMiB = Math.ceil(peakWal / 1024 / 1024);
  const rssBudget = ROWS <= 20_000 ? 512 : 1536;
  const walBudget = ROWS <= 20_000 ? 32 : 256;
  const pass = statements <= statementBudget && rowsWritten <= writtenBudget && rssMiB <= rssBudget && walPeakMiB <= walBudget;
  report.push({ operation, rows, ms, rssMiB, statements, rowsWritten, walPeakMiB, pass });
  if (!pass) process.exitCode = 1;
}

try {
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Score', type: 'number' }] },
    { op: 'createField', table: 'Items', name: 'Twice', type: 'number', kind: 'calculation', calculation: 'Score * 2', options: { unstored: true } },
    { op: 'createTable', name: 'Imported', fields: [{ name: 'Name' }] },
  ] as DesignOp[]);
  store.sql.exec('BEGIN');
  const insert = store.sql.prepare('INSERT INTO Items (Name, Score) VALUES (?, ?)');
  for (let i = 0; i < ROWS; i++) insert.run('old', ROWS - i);
  store.sql.exec('COMMIT');
  const ids = store.findIds('Items');
  const loopRows = Math.min(100_000, ROWS);
  const loopIds = ids.slice(0, loopRows);

  await measure('Omit Multiple', ROWS, 100, 0, async () => {
    const r = await run(`Omit Multiple Records [ ${Math.max(1, Math.floor(ROWS / 2))} ]`, ids);
    if (r.foundSet?.length !== ROWS - Math.max(1, Math.floor(ROWS / 2))) throw new Error('Omit count');
  });
  await measure('Sort Records', ROWS, 200, 0, async () => {
    const r = await run('Sort Records [ Restore ; Items::Score ; ascending ; With dialog: Off ]', ids);
    if (r.foundSet?.length !== ROWS) throw new Error('Sort count');
    if (r.foundSet[0] !== ids[ROWS - 1]) throw new Error('Stored sort order');
  });
  await measure('Sort calculated field', ROWS, ROWS * 3, 0, async () => {
    const r = await run('Sort Records [ Restore ; Items::Twice ; ascending ; With dialog: Off ]', ids);
    if (r.foundSet?.length !== ROWS) throw new Error('Calculated sort count');
    if (r.foundSet[0] !== ids[ROWS - 1]) throw new Error('Calculated sort order');
  });
  await measure('Replace Field Contents', ROWS, ROWS * 25, ROWS * 8, async () => {
    const r = await run('Replace Field Contents [ With dialog: Off ; Items::Name ; "copy" ]', ids);
    if (r.error) throw new Error(`Replace error ${r.error}`);
  });
  await measure('Find/Replace across file', ROWS, ROWS * 30, ROWS * 8, async () => {
    const r = await run('Perform Find/Replace [ With dialog: Off ; "copy" ; "done" ; Replace All ; Within: All fields ]', ids);
    if (r.error) throw new Error(`Find/Replace error ${r.error}`);
  });
  await measure('Export Records', ROWS, ROWS * 20, 0, async () => {
    const r = await run('Export Records [ With dialog: Off ; "out.csv" ; Unicode (UTF-8) ; Fields: Items::Name, Items::Score ]', ids);
    if (r.error) throw new Error(`Export error ${r.error}`);
  });
  await measure('Script loop with commits', loopRows, loopRows * 30, loopRows * 8, async () => {
    const r = await run('Go to Record/Request/Page [ First ]\nLoop\nSet Field [ Items::Name ; "loop" ]\nCommit Records/Requests [ With dialog: Off ]\nGo to Record/Request/Page [ Next ; Exit after last: On ]\nEnd Loop', loopIds);
    if (r.error) throw new Error(`Loop error ${r.error}`);
  });
  await measure('Duplicate Record loop', loopRows, loopRows * 40, loopRows * 8, async () => {
    const r = await run(`Set Variable [ $n ; Value: 0 ]\nLoop\nDuplicate Record/Request\nCommit Records/Requests [ With dialog: Off ]\nSet Variable [ $n ; Value: $n + 1 ]\nExit Loop If [ $n >= ${loopRows} ]\nEnd Loop`, [ids[0]]);
    if (r.error) throw new Error(`Duplicate error ${r.error}`);
  });
  await measure('Delete All Records', ROWS, ROWS * 30, ROWS * 8, async () => {
    const r = await run('Delete All Records [ With dialog: Off ]', ids);
    if (r.error) throw new Error(`Delete error ${r.error}`);
  });
  await measure('Import Records', ROWS, ROWS * 15, ROWS * 8, async () => {
    function* rows() { for (let i = 0; i < ROWS; i++) yield [`Synthetic ${i}`]; }
    const r = await importMappedRows(store, 'Imported', rows(), ['Name'], {});
    if (r.imported !== ROWS) throw new Error('Import count');
  });
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify({ rows: ROWS, report }, null, 2));
}
