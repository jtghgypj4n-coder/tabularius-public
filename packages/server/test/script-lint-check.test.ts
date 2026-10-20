// Checking a script (check_script, the assistant's drafts, automations) and the
// script editor's Check both report loops that never end, on the line of the text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { checkScript, lintScriptText } from '../src/script-check.ts';

test('check_script warns about a loop that never ends, on its line in the text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-lint-check-'));
  createStore(join(dir, 'C.sqlite'));
  const store = new Store(join(dir, 'C.sqlite'), 'C');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Lines', fields: [{ name: 'id', type: 'number' }] }]);
    // Blank lines and a comment, so the step's index and its line differ.
    const text = 'Go to Layout [ "Lines" ]\n\n# every line\nLoop\n\tSet Field [ Lines::id ; 1 ]\n\n\tGo to Record/Request/Page [ Next ]\nEnd Loop';
    const check = checkScript(store, text);
    assert.equal(check.ok, true, JSON.stringify(check.problems));
    const w = check.warnings.find((x) => /never stops/.test(x.message));
    assert.ok(w, JSON.stringify(check.warnings));
    assert.equal(w.line, 7);
    assert.equal(w.step, 'Go to Record/Request/Page');
    assert.match(w.message, /Exit after last: On/);
    assert.deepEqual(lintScriptText(store, text).map((i) => [i.rule, i.line]), [['loop-no-exit', 7]]);
    // A text the design parser can't read has nothing to check.
    assert.deepEqual(lintScriptText(store, 'Loop\nNo Such Step [ ]\nEnd Loop'), []);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
