import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decodeStepParams, scriptText } from '../../fmp12/src/script-params.ts';
import { SCRIPT_STEP_NAMES, scriptStepId, scriptStepName } from '../../fmp12/src/script-steps.ts';
import type { Schema } from '../../fmp12/src/schema.ts';
import { parseScriptText } from '../src/script-text.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = (path: string) => readFileSync(root + path, 'utf8');
const docs = source('docs/script-steps-support.md');
const decoderSource = source('packages/fmp12/src/script-params.ts');
const decoder = decoderSource.slice(decoderSource.indexOf('export function decodeStepParams'), decoderSource.indexOf('export function exportFields'));
const engine = source('packages/scripts/src/engine.ts');
const rows = [...docs.matchAll(/^\| (\d+) \| ([^|]+) \| (case|fallback) \| (case|unsupported|no-op) \| (bare|Select option) round trip \|$/gm)]
  .map((m) => ({ id: Number(m[1]), name: m[2].trim(), decoder: m[3], engine: m[4], text: m[5] }));
const selectOptionSteps = new Set(['Check Selection', 'Clear', 'Copy', 'Cut', 'Execute FileMaker Data API',
  'Insert Calculated Result', 'Insert Current Date', 'Insert Current Time', 'Insert Current User Name',
  'Insert from Index', 'Insert from Last Visited', 'Insert from URL', 'Insert Text', 'Paste']);
const ids = SCRIPT_STEP_NAMES.map((name) => scriptStepId(name)!);
const schema = { tables: [], tableOccurrences: [], relationships: [], layouts: [], layoutOrder: [], scripts: [], scriptOrder: [], valueLists: [], customFunctions: [], accounts: [], privilegeSets: [], extendedPrivileges: [], dataSources: [], themes: [], fonts: [], customMenus: [], customMenuSets: [] } as unknown as Schema;
const ctx = { formula: () => undefined, layoutName: () => undefined, scriptName: () => undefined, tableOccurrenceName: () => undefined, fieldName: () => undefined, dataSourceName: () => undefined };

test('every script step ID has decoder, engine and text coverage in the support matrix', () => {
  assert.deepEqual(rows.map((r) => r.id).sort((a, b) => a - b), [...ids].sort((a, b) => a - b));
  for (const row of rows) {
    assert.equal(row.name, scriptStepName(row.id), `name for ${row.id}`);
    const decodedCase = new RegExp(`\\bcase ${row.id}:`).test(decoder);
    assert.equal(row.decoder, decodedCase ? 'case' : 'fallback', `decoder for ${row.id}`);
    assert.doesNotThrow(() => decodeStepParams(row.id, new Uint8Array(128), undefined, ctx), `decode ${row.id}`);
    const engineCase = new RegExp(`\\bcase ${row.id}:`).test(engine);
    assert.equal(row.engine, row.id === 89 ? 'no-op' : engineCase ? 'case' : 'unsupported', `engine for ${row.id}`);
    assert.equal(row.text, selectOptionSteps.has(row.name) ? 'Select option' : 'bare', `text coverage for ${row.id}`);
    const original = row.id === 89 ? '# matrix' : row.id === 223 ? 'Set Revert Transaction on Error [ On ]' : row.name;
    const parsed = parseScriptText(original, schema);
    assert.equal(parsed.length, 1, `parse ${row.id}`);
    const printed = scriptText(parsed.map((s) => ({ ...s, stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled ?? true })));
    const expected = ['Insert from URL', 'Execute FileMaker Data API'].includes(row.name)
      ? parsed.map((s) => ({ ...s, params: { ...s.params, selectEntireContents: true } })) : parsed;
    assert.deepEqual(parseScriptText(printed, schema), expected, `print/parse ${row.id}: ${printed}`);
    if (selectOptionSteps.has(row.name)) {
      const option = parseScriptText(`${row.name} [ Select ]`, schema);
      assert.equal(option[0].params?.selectEntireContents, true, `Select for ${row.id}`);
      const optionPrinted = scriptText(option.map((s) => ({ ...s, stepId: s.stepId!, name: row.name, enabled: true })));
      assert.deepEqual(parseScriptText(optionPrinted, schema), option, `option print/parse ${row.id}: ${optionPrinted}`);
    }
  }
});

test('seeded parameter probes never accept a step that loses options on save', () => {
  const probes = [
    'With dialog: Off', 'With dialog: On', 'Select', 'On', 'Off', 'Toggle', '1', '"matrix"',
    'Lock', 'Next', 'Start Position: 1', 'File ID: 1', 'Create folders: On', 'Restore',
    'Skip data entry validation', 'Write as: UTF-8', 'Wait for completion: Off',
    'Parameter: "matrix"', 'Account Name: "matrix"', 'Input: "matrix"',
    'Amount: 1', 'Name: "matrix"', 'Pause: Off', 'Currently open PDF', 'Unknown option: 1',
  ];
  let seed = 0x5eed;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % probes.length);
  let accepted = 0;
  for (const row of rows) {
    if (row.id !== 89) {
      const generated = scriptText([{ stepId: row.id, name: row.name, enabled: true, params: {} }]);
      let parsed: ReturnType<typeof parseScriptText>[number] | undefined;
      try { parsed = parseScriptText(generated, schema)[0]; }
      catch (error) { assert.match(String(error), /Line 1:/, `generated parameter set for ${row.id} ${row.name}`); }
      if (parsed) assert.equal(scriptText([{ ...parsed, stepId: row.id, name: row.name, enabled: true }]), generated,
        `generated parameter set for ${row.id} ${row.name}`);
    }
    const start = next();
    for (let i = 0; i < probes.length; i++) {
      const line = `${row.name} [ ${probes[(start + i) % probes.length]} ]`;
      let parsed: ReturnType<typeof parseScriptText>;
      try { parsed = parseScriptText(line, schema); }
      catch (error) {
        assert.match(String(error), /Line 1:/, `${row.name}: ${line}`);
        continue;
      }
      accepted++;
      const step = parsed[0];
      const printed = scriptText([{ ...step, stepId: row.id, name: row.name, enabled: true }]);
      const reparsed = parseScriptText(printed, schema);
      for (const [key, value] of Object.entries(step.params ?? {})) {
        if (value === false && (key === 'noDialog' || key === 'exitAfterLast')) continue;
        assert.deepEqual(reparsed[0].params?.[key as keyof NonNullable<typeof step.params>], value,
          `${row.name}: ${line} lost ${key}`);
      }
      const reprinted = scriptText([{ ...reparsed[0], stepId: row.id, name: row.name, enabled: true }]);
      assert.equal(reprinted, printed, `${row.name}: ${line}`);
    }
  }
  assert.ok(accepted > rows.length, `only ${accepted} parameter probes were accepted`);
});
