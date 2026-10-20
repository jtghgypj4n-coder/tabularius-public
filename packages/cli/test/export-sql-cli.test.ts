// `tabularius export-sql` writes a loadable script and container files, prints counts only, and never overwrites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../../store/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });

test('export-sql writes the script and container files beside it, prints counts only, and refuses to overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-export-sql-cli-'));
  try {
    const path = join(dir, 'Shop.openhbam.sqlite');
    createStore(path);
    const s = new Store(path, 'Shop');
    s.applyDesign([{ op: 'createTable', name: 'Orders', fields: [{ name: 'Customer', type: 'text' }, { name: 'Photo', type: 'container' }] }] as never);
    const id = Number(s.create('Orders', { Customer: 'Zelda Secretname' }).recordId);
    s.setContainer('Orders', id, 'Photo', 1, { filename: 'p.png', mime: 'image/png', data: new Uint8Array([9, 8, 7]) });
    s.close();
    const out = join(dir, 'Shop.sql');
    const r = cli('export-sql', dir, 'Shop', '--out', out, '--dialect', 'sqlite');
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Zelda|Customer|Orders/);
    assert.match(r.stdout, /1 table, 2 fields, 1 row/);
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(out, 'utf8'));
    const row = db.prepare('SELECT "Customer", "Photo" FROM "Orders"').get() as { Customer: string; Photo: string };
    assert.equal(row.Customer, 'Zelda Secretname');
    assert.equal(row.Photo, `Shop.files/Orders/${id}-2-p.png`);
    assert.deepEqual([...readFileSync(join(dir, row.Photo))], [9, 8, 7]);
    db.close();
    writeFileSync(out, 'keep me');
    const again = cli('export-sql', dir, 'Shop', '--out', out);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/);
    assert.equal(readFileSync(out, 'utf8'), 'keep me');
    assert.equal(cli('export-sql', dir, 'Shop').status, 1);
    assert.equal(cli('export-sql', dir, 'Shop', '--out', join(dir, 'x.sql'), '--dialect', 'mysql').status, 1);
    assert.equal(existsSync(join(dir, 'x.sql')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
