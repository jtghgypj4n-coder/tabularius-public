// A weak password and an unknown extended-privilege keyword are said out loud, and still go through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORE_EXT } from '../../server/src/index.ts';
import { createStore, Store } from '../../store/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (password: string, ...args: string[]) =>
  spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8', env: { ...process.env, TABULARIUS_PASSWORD: password } });

test('passwd warns about a short or blank-looking password and sets it anyway', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-weak-pw-'));
  try {
    createStore(join(dir, 'Real' + STORE_EXT));
    const set = new Store(join(dir, 'Real' + STORE_EXT), 'Real').privilegeSets()[0]!.name;
    const short = cli('a', 'passwd', dir, 'Real', 'Ben', '--privilege-set', set);
    assert.equal(short.status, 0, short.stderr);
    assert.match(short.stderr, /only 1 character; 8 or more is safer/);
    assert.match(short.stdout, /password set for Ben/);

    const spaces = cli('   ', 'passwd', dir, 'Real', 'Ben');
    assert.equal(spaces.status, 0, spaces.stderr);
    assert.match(spaces.stderr, /only spaces/);

    const fine = cli('a-long-enough-one', 'passwd', dir, 'Real', 'Ben');
    assert.equal(fine.status, 0, fine.stderr);
    assert.doesNotMatch(fine.stderr, /warning/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('privileges grant warns about a keyword it does not know, and still grants it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-grant-'));
  try {
    createStore(join(dir, 'Real' + STORE_EXT));
    const store = new Store(join(dir, 'Real' + STORE_EXT), 'Real');
    const set = store.privilegeSets()[0]!.name;
    store.close();
    const typo = cli('x', 'privileges', dir, 'Real', 'grant', set, 'fmrset');
    assert.equal(typo.status, 0, typo.stderr);
    assert.match(typo.stderr, /"fmrset" is not fmapp, fmwebdirect, fmrest, fmxml, fmmcp, fmurlscript/);
    assert.match(typo.stdout, /granted fmrset to/);

    const known = cli('x', 'privileges', dir, 'Real', 'grant', set, 'FMMCP');
    assert.equal(known.status, 0, known.stderr);
    assert.doesNotMatch(known.stderr, /warning/);
    // fmurlscript (running a script from a link) is one of Tabularius's own, so granting it is no typo.
    const link = cli('x', 'privileges', dir, 'Real', 'grant', set, 'fmurlscript');
    assert.equal(link.status, 0, link.stderr);
    assert.doesNotMatch(link.stderr, /warning/);
    // A keyword another set already holds is not a surprise.
    const again = cli('x', 'privileges', dir, 'Real', 'grant', set, 'fmrset');
    assert.doesNotMatch(again.stderr, /warning/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
