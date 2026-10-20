import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { importFmp12, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-jp-'));
  importFmp12(fixture, join(dir, 'Flicks.sqlite'));
  store = new Store(join(dir, 'Flicks.sqlite'));
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

function script(text: string): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name: 'test', steps } as Script;
}

test('Set Variable keeps the parsed copy JSONParse made, so JSONParsedState sees it in later steps', { skip }, async () => {
  const r = await runScript(store, script(`
    Set Variable [ $json ; Value: JSONParse ( "{\\"a\\":[1,2]}" ) ]
    Set Variable [ $text ; Value: "{\\"a\\":[1,2]}" ]
    Set Variable [ $bad ; Value: JSONParse ( "{\\"a\\":" ) ]
    Set Variable [ $$built ; Value: JSONSetElement ( "[]" ; "[0]" ; 1 ; JSONNumber ) ]
    Exit Script [ Text Result: JSONParsedState ( $json ) & JSONParsedState ( $text ) & JSONParsedState ( $bad ) & JSONParsedState ( $$built ) ]
  `), {});
  assert.equal(r.result, '30-14');
});
