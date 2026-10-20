import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { runScript } from '../src/index.ts';

test('unknown step IDs are skipped with notices and error 3; their calculations never run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'unknown-steps-'));
  createStore(join(dir, 'test.sqlite'));
  const store = new Store(join(dir, 'test.sqlite'));
  try {
    for (const id of [0, 513]) {
      const script: Script = { id: 1, name: 'test', steps: [
        { stepId: id, name: scriptStepName(id), enabled: true, params: { calculation: 'Let ( $$touched = 1 ; 1 )' } },
        { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastError ) & "/" & IsEmpty ( $$touched )' } },
      ] };
      const result = await runScript(store, script, { trace: true });
      assert.equal(result.result, '3/1');
      assert.ok(result.warnings?.some((w) => w.includes(`Unknown step ${id}`) && /skipped/i.test(w)));
    }
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('unknown calculations and Get options log notices without calculation text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'unknown-calc-'));
  createStore(join(dir, 'test.sqlite'));
  const store = new Store(join(dir, 'test.sqlite'));
  try {
    const result = await runScript(store, { id: 1, name: 'test', steps: [
      { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: '⟨fn:39⟩ ( "private-value" ) & Get ( ⟨get:73⟩ )' } },
    ] });
    assert.equal(result.result, '??');
    assert.equal(result.error, 0);
    assert.ok(result.warnings?.some((w) => w.includes('⟨fn:39⟩')));
    assert.ok(result.warnings?.some((w) => w.includes('⟨get:73⟩')));
    assert.doesNotMatch(JSON.stringify(result.warnings), /private-value/);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
