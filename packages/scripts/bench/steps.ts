// Script speed per step: 10,000-iteration loops on a scratch file, offline. Prints the median of 10 timed runs after 5
// warm-ups for each. Run: node packages/scripts/bench/steps.ts (bench/loop.ts walks records)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-loop-bench-'));
createStore(join(dir, 'B.sqlite'));
const store = new Store(join(dir, 'B.sqlite'), 'B');
store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }, { name: 'Qty', type: 'number' }] }] as never);
store.create('Items', { Name: 'a', Qty: '1' });

const script = (text: string): Script => ({
  id: 1, name: 'bench',
  steps: parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
} as unknown as Script);

const BENCHES: [string, string][] = [
  ['Variables, If and text (5 steps a pass)', 'Loop\nSet Variable [ $i ; Value: $i + 1 ]\nSet Variable [ $s ; Value: Right ( $s & $i ; 20 ) ]\nIf [ Mod ( $i ; 2 ) = 0 ]\nSet Variable [ $even ; Value: $even + 1 ]\nEnd If\nExit Loop If [ $i ≥ 10000 ]\nEnd Loop\nExit Script [ Result: $even ]'],
  ['Set Field on one record (3 steps a pass)', 'Loop\nSet Variable [ $i ; Value: $i + 1 ]\nSet Field [ Items::Qty ; Items::Qty + 1 ]\nExit Loop If [ $i ≥ 10000 ]\nEnd Loop\nCommit Records/Requests [ With dialog: Off ]'],
  ['JSON built a key at a time (3 steps a pass)', 'Loop\nSet Variable [ $i ; Value: $i + 1 ]\nSet Variable [ $json ; Value: JSONSetElement ( $json ; "k" & Mod ( $i ; 500 ) ; $i ; JSONNumber ) ]\nExit Loop If [ $i ≥ 10000 ]\nEnd Loop\nExit Script [ Result: Length ( $json ) ]'],
];

for (const [name, text] of BENCHES) {
  const s = script(text);
  const times: number[] = [];
  for (let round = 0; round < 15; round++) {
    const began = performance.now();
    const r = await runScript(store, s, { layout: 'Items' });
    if (r.error) throw new Error(`${name}: error ${r.error}`);
    if (round >= 5) times.push(performance.now() - began);
  }
  times.sort((a, b) => a - b);
  console.log(`${name}: ${times[5].toFixed(0)} ms (median of 10)`);
}
store.close();
rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
