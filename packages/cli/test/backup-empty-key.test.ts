// An empty TABULARIUS_BACKUP_KEY must not make an unencrypted backup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './cli-run.ts';
import { backupKey } from '../../server/src/backup.ts';

const main = join(import.meta.dirname, '../src/main.ts');

test('backup refuses an empty TABULARIUS_BACKUP_KEY and writes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-backup-key-'));
  try {
    writeFileSync(join(dir, 'Note.txt'), 'x');
    const to = join(dir, 'out');
    const r = await runCli(main, ['backup', dir, '--to', to], { env: { ...process.env, TABULARIUS_BACKUP_KEY: '' }, timeout: 60_000 });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /TABULARIUS_BACKUP_KEY is set but empty: set a passphrase, or unset the variable to make backups that are not encrypted/);
    assert.equal(existsSync(to), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backupKey: unset is no key, a value is the key, empty is an error', () => {
  const was = process.env.TABULARIUS_BACKUP_KEY;
  try {
    delete process.env.TABULARIUS_BACKUP_KEY;
    assert.equal(backupKey(), undefined);
    process.env.TABULARIUS_BACKUP_KEY = 'a passphrase';
    assert.equal(backupKey(), 'a passphrase');
    process.env.TABULARIUS_BACKUP_KEY = '';
    assert.throws(() => backupKey(), /TABULARIUS_BACKUP_KEY is set but empty/);
  } finally {
    if (was === undefined) delete process.env.TABULARIUS_BACKUP_KEY; else process.env.TABULARIUS_BACKUP_KEY = was;
  }
});
