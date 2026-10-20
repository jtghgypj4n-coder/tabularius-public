// MBS ( "IsError" ) says whether the last MBS call gave an error. MBS keeps that state per script
// (https://www.mbsplugins.de/archive/2021-03-18/Watching_for_Errors_with_MBS_P/monkeybreadsoftware_blog_archive);
// here it is kept for one script run, subscripts included. Generated database and scripts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript } from '../src/index.ts';

test('IsError follows the last MBS call within a script run, and starts at 0 in the next run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mbs-iserror-'));
  const path = join(dir, 'Generated.sqlite');
  createStore(path);
  const store = new Store(path, 'Generated');
  try {
    store.applyDesign([
      { op: 'createScript', name: 'Failing', text: 'Exit Script [ Text Result: MBS ( "Nope.Nothing" ) ]' },
      { op: 'createScript', name: 'Ask', text: 'Exit Script [ Text Result: MBS ( "IsError" ) ]' },
      { op: 'createScript', name: 'AcrossSteps', text: ['Set Variable [ $a ; Value: MBS ( "Nope.Nothing" ) ]', 'Set Variable [ $b ; Value: MBS ( "IsError" ) ]', 'Exit Script [ Text Result: $b ]'].join('\n') },
      { op: 'createScript', name: 'ThenFine', text: ['Set Variable [ $a ; Value: MBS ( "Nope.Nothing" ) ]', 'Set Variable [ $b ; Value: MBS ( "Version" ) ]', 'Exit Script [ Text Result: MBS ( "IsError" ) ]'].join('\n') },
      { op: 'createScript', name: 'Subscript', text: ['Perform Script [ "Failing" ]', 'Exit Script [ Text Result: MBS ( "IsError" ) ]'].join('\n') },
    ]);
    const answer = async (name: string) => (await runScript(store, name, { account: 'Admin' })).result;
    assert.equal(await answer('AcrossSteps'), '1', 'the step after a failing MBS call sees the error');
    assert.equal(await answer('ThenFine'), '0', 'a later MBS call that works clears it');
    assert.equal(await answer('Subscript'), '1', 'a subscript is part of the same run');
    await answer('Failing');
    assert.equal(await answer('Ask'), '0', 'another run starts clean');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
