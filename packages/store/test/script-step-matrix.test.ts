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
