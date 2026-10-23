// `tabularius exit-bundle` writes the portable copy, asks for the password on stdin, prints counts and the path only,
// refuses a Reader and an existing folder, and --discard removes an unfinished copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { commandStubEnv } from '../../../scripts/test-command-stubs.ts';
import { createStore, Store } from '../../store/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');

test('exit-bundle writes the copy, prints counts only, asks for the password on stdin and refuses what it should', (t) => {
  const env = commandStubEnv(t);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-exit-bundle-cli-'));
  const run = (password: string, ...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8', env, input: `${password}\n` });
  try {
    const path = join(dir, 'Shop.openhbam.sqlite');
    createStore(path);
    const s = new Store(path, 'Shop');
    s.applyDesign([{ op: 'createTable', name: 'Orders', fields: [{ name: 'Customer', type: 'text' }] }] as never);
    s.create('Orders', { Customer: 'Zelda Secretname' });
    s.setPassword('Admin', PASSWORD);
    s.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
    s.createAccount('reader', 'another long enough phrase', 'Reader');
    s.close();

    const out = join(dir, 'Exports', 'copy');
    mkdirSync(join(dir, 'Exports'));
    assert.equal(run(PASSWORD, 'exit-bundle', dir, 'Shop').status, 1); // no --out

    const refused = run('another long enough phrase', 'exit-bundle', dir, 'Shop', '--out', out, '--account', 'reader');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Full Access/);
    assert.equal(existsSync(out), false);

    const ok = run(PASSWORD, 'exit-bundle', dir, 'Shop', '--out', out, '--account', 'Admin');
    assert.equal(ok.status, 0, ok.stderr);
    assert.doesNotMatch(ok.stdout + ok.stderr, /Zelda|Customer|Orders/);
    assert.match(ok.stdout, /1 table, 1 row, 0 container files/);
    assert.match(ok.stdout, /plaintext/);
    const db = new DatabaseSync(join(out, 'data.sqlite'));
    assert.equal((db.prepare('SELECT Customer FROM Orders').get() as { Customer: string }).Customer, 'Zelda Secretname');
    db.close();
    assert.match(readFileSync(join(out, 'NOTES.txt'), 'utf8'), /PLAINTEXT/);

    const again = run(PASSWORD, 'exit-bundle', dir, 'Shop', '--out', out, '--account', 'Admin');
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/);

    mkdirSync(`${out}-2.partial`, { mode: 0o700 });
    const discarded = run(PASSWORD, 'exit-bundle', dir, 'Shop', '--out', `${out}-2`, '--account', 'Admin', '--discard');
    assert.equal(discarded.status, 0, discarded.stderr);
    assert.equal(existsSync(`${out}-2.partial`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
