// Putting a file back to a moment from the admin console when the backups are signed: a set that is going to be refused is
// found out before the live file is closed, and the answer does not carry the server's own folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { serve } from '../src/index.ts';
import { checksum } from '../src/backup-verify.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const KEY = 'correct horse battery staple';

/** A server with signed point-in-time backups, its data folder spelled as given, then `damage` done to its backups; both kinds of console restore are asked for. */
async function refusedRestores(t: { after(fn: (() => void | Promise<void>)): void }, spell: (dir: string) => string, spellDest: ((dest: string) => string) | undefined, damage: (dest: string, base: string) => Promise<void> | void, why: RegExp, status = 409): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-live-restore-signed-'));
  process.env.TABULARIUS_BACKUP_KEY = KEY;
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({
    dir: spell(dir), port: 0, log: () => {}, progressive: { every: 3_600_000 },
    ...(spellDest ? { backups: { every: 86_400_000, dest: spellDest(join(dir, 'Backups')) } } : {}),
  });
  t.after(async () => {
    delete process.env.TABULARIUS_BACKUP_KEY;
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });
  const dest = join(dir, 'Backups');
  for (let i = 0; i < 200 && !(existsSync(dest) && readdirSync(dest).some((n) => /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(n))); i++) await sleep(50);
  await sleep(50);
  await damage(dest, join(dest, readdirSync(dest).filter((n) => /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(n)).sort()[0]));
  const before = s.host.get('Charts');
  const post = (body: object) => fetch(`${s.url}/tabularius/admin/v1/restore`, {
    method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
  for (const body of [{ database: 'Charts', at: Date.now() }, { database: 'Charts', at: Date.now(), mode: 'copy', name: 'Charts copy' }]) {
    const answer = await post(body);
    assert.equal(answer.status, status, answer.text);
    assert.match(answer.text, why);
    assert.equal(answer.text.includes(basename(dir)), false, `the answer names no folder of the server: ${answer.text}`);
  }
  assert.equal(s.host.get('Charts'), before, 'the file was not closed and opened again');
}

/** A set the server did not make: newer than any real one, with a copy of its own and no signature. */
async function plantUnsignedSet(dest: string): Promise<void> {
  const planted = join(dest, '2999-01-01_000000');
  mkdirSync(planted);
  const forged = join(planted, 'Charts.openhbam.sqlite');
  const db = new DatabaseSync(forged);
  db.exec('CREATE TABLE forged (v TEXT)');
  db.close();
  writeFileSync(join(planted, 'backup.json'), JSON.stringify({ finished: { 'Charts.openhbam.sqlite': new Date(Date.now() - 1).toISOString() }, sha256: { 'Charts.openhbam.sqlite': await checksum(forged) } }));
}

const plain = (dir: string) => dir;
// A folder spelled with // and /./ in it: the messages name it in its plain form.
const crooked = (dir: string) => dir.replace(/\/([^/]+)$/, '//$1/./');

test('console restore: a newer set with no signature is refused before the file is closed, in words that name no server folder', { skip }, async (t) => {
  await refusedRestores(t, plain, undefined, (dest) => plantUnsignedSet(dest), /no signature/);
});

test('console restore: the same when the data folder and the backup folder are spelled with // and /./ in them', { skip }, async (t) => {
  await refusedRestores(t, crooked, (dest) => dest.replace(/\/Backups$/, '//Backups/./'), (dest) => plantUnsignedSet(dest), /no signature/);
});

test('console restore: a copy that changed on disk, or a manifest that is not JSON, is refused before the file is closed', { skip }, async (t) => {
  await refusedRestores(t, plain, undefined, (_dest, base) => {
    const copy = join(base, 'Charts.openhbam.sqlite.enc');
    const bytes = readFileSync(copy);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(copy, bytes);
  }, /changed on disk|checksum/);
  await refusedRestores(t, plain, undefined, (_dest, base) => writeFileSync(join(base, 'backup.json'), '{'), /backup\.json|manifest/);
});
