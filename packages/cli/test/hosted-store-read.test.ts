// `tabularius schema` and `records` read a hosted database: by folder and name, or by the .openhbam.sqlite file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORE_EXT } from '../../server/src/index.ts';
import { createStore, Store } from '../../store/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });

test('schema and records read a hosted database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-hosted-read-'));
  try {
    const path = join(dir, 'Shop' + STORE_EXT);
    createStore(path);
    const s = new Store(path, 'Shop');
    s.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Note, with comma' }] }]);
    s.create('Items', { Name: 'Bolt', 'Note, with comma': 'a,b' });
    s.create('Items', { Name: 'Nut' });
    s.close();

    for (const args of [[dir, 'Shop'], [path]]) {
      const schema = cli('schema', args[0], ...args.slice(1), '--json');
      assert.equal(schema.status, 0, schema.stderr);
      assert.ok(JSON.parse(schema.stdout).tables.some((t: { name: string }) => t.name === 'Items'));

      const rows = cli('records', args[0], ...args.slice(1), 'Items');
      assert.equal(rows.status, 0, rows.stderr);
      const lines = rows.stdout.trim().split('\n').map((l) => JSON.parse(l));
      assert.deepEqual(lines.map((l) => l.fields.Name), ['Bolt', 'Nut']);

      const one = cli('records', args[0], ...args.slice(1), 'Items', '--limit', '1', '--format', 'csv');
      assert.equal(one.status, 0, one.stderr);
      assert.match(one.stdout, /^recordId,Name,"Note, with comma"\n\d+,Bolt,"a,b"\n$/);
    }
    const bad = cli('records', dir, 'Shop', 'Nope');
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /no table named "Nope"/);
    const missing = cli('records', dir, 'Nope', 'Items');
    assert.match(missing.stderr, /no database named "Nope"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
