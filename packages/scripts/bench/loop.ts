// Benchmark: scripts that walk every record (10,000 by default), setting and
// committing a field on each, only reading them, counting, and adding records.
// Run: node packages/scripts/bench/loop.ts [records]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const n = Number(process.argv[2] ?? 10_000);
const dir = mkdtempSync(join(tmpdir(), 'tabularius-bench-'));
createStore(join(dir, 'Bench.sqlite'));
const store = new Store(join(dir, 'Bench.sqlite'), 'Bench');
store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Id', type: 'number' }, { name: 'Name', type: 'text' }, { name: 'Count', type: 'number' }] }]);
store.sql.exec('BEGIN');
for (let i = 1; i <= n; i++) store.create('Items', { Id: String(i), Name: `item ${i}`, Count: '0' });
store.sql.exec('COMMIT');

const script = (text: string) => ({ id: 1, name: 'bench', steps: parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params })) }) as never;
const cases: [string, string][] = [
  ['set and commit each record', `Show All Records
Go to Record/Request/Page [ First ]
Loop
Set Field [ Items::Count ; Items::Count + 1 ]
Commit Records/Requests [ With dialog: Off ]
Go to Record/Request/Page [ Next ; Exit after last: On ]
End Loop`],
  ['read each record into a variable', `Show All Records
Go to Record/Request/Page [ First ]
Loop
Set Variable [ $sum ; Value: $sum + Items::Id ]
Go to Record/Request/Page [ Next ; Exit after last: On ]
End Loop
Exit Script [ Result: $sum ]`],
  ['count to n in a variable loop', `Loop
Set Variable [ $i ; Value: $i + 1 ]
Exit Loop If [ $i ≥ ${n} ]
End Loop`],
  ['new record for each', `Set Variable [ $i ; Value: 0 ]
Loop
New Record/Request
Set Field [ Items::Name ; "new " & $i ]
Commit Records/Requests [ With dialog: Off ]
Set Variable [ $i ; Value: $i + 1 ]
Exit Loop If [ $i ≥ ${Math.min(n, 2000)} ]
End Loop`],
];
for (const [name, text] of cases) {
  const t = store.trial();
  const began = performance.now();
  const r = await runScript(store, script(text), { layout: 'Items', timeoutMs: 600_000, maxSteps: 10_000_000 } as never);
  const ms = performance.now() - began;
  t.undo();
  console.log(`${name.padEnd(36)} ${ms.toFixed(0).padStart(7)} ms  ${r.steps} steps  ${(r.steps / ms * 1000).toFixed(0)} steps/s  error ${r.error}`);
}
store.close();
rmSync(dir, { recursive: true });
