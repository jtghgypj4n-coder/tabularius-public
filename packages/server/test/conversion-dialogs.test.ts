import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { conversionGuide } from '../src/conversion-guide.ts';
import { conversionReport } from '../src/conversion.ts';

function withDialogs(check: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-dialog-report-'));
  const path = join(dir, 'Converted.sqlite');
  createStore(path);
  const store = new Store(path, 'Converted');
  try {
    const dialog = { stepId: 87, name: 'Show Custom Dialog', enabled: true, params: { buttons: ['"OK"'] } };
    store.schema.scripts.push(
      { id: 1, name: 'Ask', steps: [dialog, { stepId: 89, name: '# (comment)', enabled: true }, dialog] },
      { id: 2, name: 'Nightly', steps: [dialog] },
    );
    check(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
}

test('conversion guide counts Show Custom Dialog steps and says they stop with error 3 when no person answers', () => {
  withDialogs((store) => {
    const item = conversionGuide(store).differs.find((i) => i.title === 'Dialogs in scripts that run without a person');
    assert.ok(item);
    assert.equal(item.severity, 'medium');
    assert.equal(item.count, 3);
    assert.deepEqual(item.where, ['Script "Ask", line 1', 'Script "Ask", line 3', 'Script "Nightly", line 1']);
    assert.match(item.what, /no person to answer.*error 3.*presses no button/);
    assert.match(item.instead ?? '', /script parameter/);
  });
});

test('conversion report lists them and the summary mentions them', () => {
  withDialogs((store) => {
    const report = conversionReport(store);
    assert.deepEqual(report.steps.dialogs, [{
      name: 'Show Custom Dialog', count: 3,
      where: ['Script "Ask", line 1', 'Script "Ask", line 3', 'Script "Nightly", line 1'],
    }]);
    assert.match(report.summary, /Dialogs in scripts that run without a person\*\*: 3 Show Custom Dialog steps/);
  });
});
