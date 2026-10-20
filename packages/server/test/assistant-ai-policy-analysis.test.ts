import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import type { ScriptStep } from '../../fmp12/src/index.ts';
import { assertAiPolicy, type AiPolicyRequest } from '../src/ai-policy.ts';

type Scenario = { name: string; request?: AiPolicyRequest; formula?: string; step?: Partial<ScriptStep>; setup?: (s: Store) => void };
const scenarios: Scenario[] = [
  { name: 'unparseable calculation', formula: 'Upper (' },
  { name: 'cross-run Get state', formula: 'Get ( ScriptResult )' },
  { name: 'custom function recursion', formula: 'Recursive ()', setup: (s) => { s.applyDesign([{ op: 'createCustomFunction', name: 'Recursive', parameters: [], formula: 'Recursive ()' }]); } },
  { name: 'JavaScript function', formula: 'Custom ()', setup: (s) => { s.applyDesign([{ op: 'createCustomFunction', name: 'Custom', parameters: [], formula: 'return 1;', language: 'javascript' }]); } },
  { name: 'nested serial calculation', step: { stepId: 91, params: { serial: { initial: 'Evaluate ( \"1\" )' } } } },
  { name: 'undecoded script options', step: { stepId: 76, params: { undecodedOptions: ['unknown'] } } },
  { name: 'dynamic field target', step: { stepId: 147, params: { fieldName: 'Name', calculation: '1' } } },
  { name: 'dynamic layout target', step: { stepId: 6, params: { layoutCalculation: 'Name' } } },
  { name: 'dynamic script target', step: { stepId: 1, params: { scriptCalculation: 'Name' } } },
  { name: 'missing subscript', step: { stepId: 1, params: { script: { id: 998, name: 'Missing' } } } },
  { name: 'AI history from a previous run', step: { stepId: 220, params: { ai: { messagesVariable: '$$history' } } } },
  { name: 'RAG external file input', step: { stepId: 219, params: { ai: { dataSource: 'from file' } } } },
  { name: 'unknown caller program', request: { programs: [] } },
  { name: 'unproved trial program', request: { uncertain: true } },
  { name: 'invalid SQL', request: { sql: 'SELECT missing FROM unknown_table' } },
  { name: 'unattributed container SQL', request: { sql: 'SELECT filename FROM _fm_containers' } },
  { name: 'unresolved external source', setup: (s) => { s.applyDesign([{ op: 'createDataSource', name: 'Missing', paths: ['file:Missing'] }]); } },
];
for (const scenario of scenarios) test(`AI static analysis refuses ${scenario.name}; absent metadata preserves legacy access`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-static-'));
  const path = join(dir, 'file.sqlite'); createStore(path); const store = new Store(path, 'File');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
  scenario.setup?.(store);
  if (scenario.step) store.schema.scripts.push({ id: 999, name: 'Uncertain', steps: [{ enabled: true, stepId: 99999, name: scenario.name, ...scenario.step }] });
  const request = { scripts: true, ...(scenario.formula ? { formula: scenario.formula } : {}), ...scenario.request };
  assert.throws(() => assertAiPolicy(store, 'Admin', scenario.name, request), /AI policy refused.*turn the AI policy off for this file/);
  store.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  assert.doesNotThrow(() => assertAiPolicy(store, 'Admin', scenario.name, request));
});
