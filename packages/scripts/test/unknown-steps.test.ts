import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { runScript } from '../src/index.ts';
import { APPLICATION_VERSION } from '../../calc/src/get.ts';

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

test('script Get options use the shared version and supplied user count and language', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'get-options-'));
  createStore(join(dir, 'test.sqlite'));
  const store = new Store(join(dir, 'test.sqlite'));
  try {
    const script: Script = { id: 1, name: 'test', steps: [
      { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( ApplicationVersion ) & "|" & Get ( HostApplicationVersion ) & "|" & Get ( UserCount ) & "|" & Get ( SystemLanguage ) & "|" & Get ( ApplicationLanguage )' } },
    ] };
    const supplied = await runScript(store, script, { userCount: () => 3, language: 'French' });
    assert.equal(supplied.result, `${APPLICATION_VERSION}|${APPLICATION_VERSION}|3|French|French`);
    const defaults = await runScript(store, script);
    assert.equal(defaults.result, `${APPLICATION_VERSION}|${APPLICATION_VERSION}|1|English|English`);
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
