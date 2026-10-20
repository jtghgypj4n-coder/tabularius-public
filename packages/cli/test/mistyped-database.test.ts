// A mistyped database name is an error naming it, not an empty store file left in the folder, and a store that
// won't open at startup is named and left out while the others are still hosted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORE_EXT, Host } from '../../server/src/index.ts';
import { createStore } from '../../store/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8', input: 'secret-1\n', env: { ...process.env, TABULARIUS_PASSWORD: 'secret-1' } });

test('commands that take a database name refuse one that is not there and create nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-typo-'));
  try {
    createStore(join(dir, 'Real' + STORE_EXT));
    const before = readdirSync(dir).sort();
    for (const args of [['passwd', dir, 'Nope', 'Ben'], ['privileges', dir, 'Nope', 'list'], ['token', dir, 'Nope', 'create', 'Admin'], ['totp', dir, 'Nope', 'enroll', 'Admin'], ['audit', dir, 'Nope']]) {
      const r = cli(...args);
      assert.notEqual(r.status, 0, args.join(' '));
      assert.match(r.stderr, /no database named "Nope"/, args.join(' '));
    }
    assert.deepEqual(readdirSync(dir).sort(), before, 'no file was made');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a store that will not open is named in the log and the others are still hosted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-broken-'));
  try {
    createStore(join(dir, 'Good' + STORE_EXT));
    writeFileSync(join(dir, 'Broken' + STORE_EXT), 'x');
    const lines: string[] = [];
    const host = new Host(dir, (l) => lines.push(l));
    try {
      assert.ok(host.get('Good'), 'the good file is hosted');
      assert.equal(host.get('Broken'), undefined);
      assert.ok(lines.some((l) => l.includes(`Broken${STORE_EXT}`) && /not hosted/.test(l)), lines.join('\n'));
    } finally {
      for (const s of host.openStores()) s.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
