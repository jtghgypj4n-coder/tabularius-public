// `sync-apply --containers` moves container files with a pull or a write, and only when the configuration says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORE_EXT } from '../../server/src/index.ts';
import { createStore } from '../../store/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8', env: { ...process.env, TABULARIUS_FMS_PASSWORD: 'unused' } });

test('--containers is refused unless the configuration allows it, with --pull or --write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sync-containers-cli-'));
  try {
    createStore(join(dir, 'Shop' + STORE_EXT));
    const tables = [{ localTable: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' }];
    const closed = join(dir, 'closed.json');
        writeFileSync(closed, JSON.stringify({ server: 'https://fms.invalid', database: 'Shop', user: 'sync', allowWrites: true, tables }));
    let r = cli('sync-apply', dir, 'Shop', '--config', closed, '--pull', '--containers');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /doesn't allow container files: add "allowContainers": true/);
    // A write with the option is refused too when the configuration doesn't allow files (the check comes before any connection).
    r = cli('sync-apply', dir, 'Shop', '--config', closed, '--write', '--containers');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /doesn't allow container files/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
