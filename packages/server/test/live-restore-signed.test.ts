// Putting a file back to a moment from the admin console when the backups are signed: a set that is going to be refused is
// found out before the live file is closed, and the answer does not carry the server's own folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { serve } from '../src/index.ts';
import { checksum } from '../src/backup-verify.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const KEY = 'correct horse battery staple';

test('console restore: a newer set with no signature is refused before the file is closed, in words that name no server folder', { skip }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-live-restore-signed-'));
  process.env.TABULARIUS_BACKUP_KEY = KEY;
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, progressive: { every: 3_600_000 } });
  t.after(async () => {
    delete process.env.TABULARIUS_BACKUP_KEY;
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });
  const dest = join(dir, 'Backups');
  for (let i = 0; i < 200 && !(existsSync(dest) && readdirSync(dest).some((n) => /^\d{4}-/.test(n))); i++) await sleep(50);
  // Someone puts a set in the folder that is newer than any real one, with a copy of their own and no signature.
  const planted = join(dest, '2999-01-01_000000');
  mkdirSync(planted);
  const forged = join(planted, 'Charts.openhbam.sqlite');
  const db = new DatabaseSync(forged);
  db.exec('CREATE TABLE forged (v TEXT)');
  db.close();
  writeFileSync(join(planted, 'backup.json'), JSON.stringify({ finished: { 'Charts.openhbam.sqlite': new Date(Date.now() - 1).toISOString() }, sha256: { 'Charts.openhbam.sqlite': await checksum(forged) } }));
  const before = s.host.get('Charts');
  const post = (body: object) => fetch(`${s.url}/tabularius/admin/v1/restore`, {
    method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
  await sleep(50);
  for (const body of [{ database: 'Charts', at: Date.now() }, { database: 'Charts', at: Date.now(), mode: 'copy', name: 'Charts copy' }]) {
    const answer = await post(body);
    assert.equal(answer.status, 409, answer.text);
    assert.match(answer.text, /no signature/);
    assert.equal(answer.text.includes(dir), false, 'the answer names no folder of the server');
  }
  assert.equal(s.host.get('Charts'), before, 'the file was not closed and opened again');
  assert.equal(readFileSync(join(dir, 'Charts.openhbam.sqlite')).length > 0, true);
});
