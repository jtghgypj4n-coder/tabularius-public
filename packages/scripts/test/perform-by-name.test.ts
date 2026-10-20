// Perform Script "Specified: By name" (FileMaker 18+): the step names its script with a calculation. The Beezwax
// samples' "configure ai account" performs itself by name ("::" & Get ( ScriptName )); Tabularius used to stop
// there with error 104, Script is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FmpFile, fileSource, readSchema, scriptText } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'BeezwaxUnifiedSearchActions.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('Perform Script by name is read from the file: its calculation, in FileMaker\'s words', { skip }, () => {
  const s = readSchema(new FmpFile(fileSource(fixture)));
  const sc = s.scripts.find((x) => x.name === 'configure ai account')!;
  const steps = sc.steps.filter((st) => st.name === 'Perform Script');
  assert.ok(steps.length >= 2);
  for (const st of steps) {
    assert.equal(st.params?.script, undefined);
    assert.equal(st.params?.scriptCalculation, '"::" & Get ( ScriptName )');
  }
  assert.match(scriptText(sc.steps), /Perform Script \[ Specified: By name ; "::" & Get \( ScriptName \) ; Parameter: JSONSetElement/);
});

test('Perform Script by name runs the script its calculation names, in this file, ignoring case; a name that matches none is error 104', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-byname-'));
  createStore(join(dir, 'Jobs.sqlite'));
  const store = new Store(join(dir, 'Jobs.sqlite'), 'Jobs');
  try {
    store.applyDesign([
      { op: 'createScript', name: 'Sub', text: 'Exit Script [ Text Result: "sub:" & Get ( ScriptParameter ) ]' },
      { op: 'createScript', name: 'Self', text: [
        'If [ Get ( ScriptParameter ) = "inner" ]',
        '  Exit Script [ Text Result: "inner ran" ]',
        'End If',
        'Perform Script [ Specified: By name ; "::" & Get ( ScriptName ) ; Parameter: "inner" ]',
        'Exit Script [ Text Result: Get ( ScriptResult ) ]',
      ].join('\n') },
      { op: 'createScript', name: 'Plain', text: 'Perform Script [ Specified: By name ; "SUB" ; Parameter: 7 ]\nExit Script [ Text Result: Get ( ScriptResult ) ]' },
      { op: 'createScript', name: 'Missing', text: 'Set Error Capture [ On ]\nPerform Script [ Specified: By name ; "Nope" ]\nExit Script [ Text Result: Get ( LastError ) ]' },
    ] as never);
    // The text form reads back the same.
    const parsed = parseScriptText('Perform Script [ Specified: By name ; "Sub" ; Parameter: 1 ]', store.schema)[0];
    assert.deepEqual([parsed.params?.scriptCalculation, parsed.params?.parameter, parsed.params?.script], ['"Sub"', '1', undefined]);
    assert.match(scriptText(store.schema.scripts.find((x) => x.name === 'Plain')!.steps), /^Perform Script \[ Specified: By name ; "SUB" ; Parameter: 7 \]/);

    assert.equal((await runScript(store, 'Self')).result, 'inner ran');
    assert.equal((await runScript(store, 'Plain')).result, 'sub:7');
    assert.equal((await runScript(store, 'Missing')).result, '104');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
