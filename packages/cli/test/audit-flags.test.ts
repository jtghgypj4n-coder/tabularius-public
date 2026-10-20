import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

test('audit refuses a --since that is not a date and a --record that is not an id, instead of printing nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-flags-'));
  try {
    createStore(join(dir, 'Test.openhbam.sqlite'));
    const store = new Store(join(dir, 'Test.openhbam.sqlite'));
    store.auditSignIn('Ann', 'local', true);
    store.close();
    const audit = (...flags: string[]) => runCli(main, ['audit', dir, 'Test', ...flags]);

    const [bad, badRecord, validDate, validDateTime] = await Promise.all([
      audit('--since', 'notadate'),
      audit('--record', 'abc'),
      audit('--since', '2020-01-01'),
      audit('--since', '2020-01-01T08:00:00Z', '--record', '3'),
    ]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /--since takes a date or time.*"notadate"/);
    assert.equal(bad.stdout, '');

    assert.notEqual(badRecord.status, 0);
    assert.match(badRecord.stderr, /--record takes a record id/);

    assert.equal(validDate.status, 0);
    assert.equal(validDateTime.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
