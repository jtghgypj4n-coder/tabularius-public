import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Host, STORE_EXT, backupFolder, parseTime, restoreAt, restoreBackup, restorePoint, scheduleProgressive } from '../src/index.ts';
import { Store } from '../../store/src/index.ts';

// Point-in-time backups: put a file back as it was at a moment, design changes included.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

async function pointInTime(passphrase?: string): Promise<void> {
  if (passphrase) process.env.TABULARIUS_BACKUP_KEY = passphrase;
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pitr-'));
  const dest = join(dir, 'Backups');
  try {
    copyFileSync(fixture, join(dir, 'Charts.fmp12'));
    let host = new Host(dir);
    const store = () => host.get('Charts')!;
    const name = (s: Store) => String(s.get('Congress', 1).fieldData.Name);
    const before = name(store());
    const p = await scheduleProgressive(host, { every: 3_600_000, dest });
    await sleep(20);
    const t0 = Date.now(); // after the first full backup, before any change
    await sleep(20);
    const moment = async (what: () => void) => {
      what();
      await sleep(20);
      p.run();
      const at = Date.now();
      await sleep(20);
      return at;
    };
    const t1 = await moment(() => store().update('Congress', 1, { Name: 'First change' }));
    const t2 = await moment(() => {
      store().update('Congress', 1, { Name: 'Second change' });
      store().applyDesign([{ op: 'createField', table: 'Congress', name: 'Nickname' }]);
      store().update('Congress', 2, { Nickname: 'Slim' });
    });
    for (let i = 0; i < 300; i++) store().create('Congress', { Name: `Added ${i}` });
    // A full backup this server makes is followed from then on.
    const full = await backupFolder(dir, dest);
    p.follow(full.dir);
    const t3 = await moment(() => store().update('Congress', 1, { Name: 'Third change' }));
    store().update('Congress', 1, { Name: 'Last change' });
    p.stop(); // copies the last changes
    const total = store().find('Congress', { limit: 0 }).totalCount;
    host.close();

    if (passphrase) {
      // Every copy and log is encrypted; nothing readable is left in the backups.
      const files = readdirSync(dest, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
      assert.ok(files.some((f) => f.endsWith('.log.enc')), files.join());
      // backup.json.lock.db is the manifest's cross-process lock: a sidecar that is never written, so it holds no data.
      assert.deepEqual(files.filter((f) => !f.endsWith('.enc') && f !== 'backup.json' && f !== 'backup.json.lock.db'), []);
      delete process.env.TABULARIUS_BACKUP_KEY;
      await assert.rejects(restoreAt(dir, dest, Date.now(), 'Charts'), /encrypted: set TABULARIUS_BACKUP_KEY/);
      await assert.rejects(restoreAt(dir, dest, Date.now(), 'Charts', 'wrong'), /wrong passphrase/);
      process.env.TABULARIUS_BACKUP_KEY = passphrase;
    }

    const check = async (at: number, want: string, extra?: (s: Store) => void) => {
      const r = await restoreAt(dir, dest, at, 'Charts');
      assert.equal(r.length, 1);
      const s = new Store(join(dir, 'Charts' + STORE_EXT), 'Charts');
      try {
        assert.equal(name(s), want);
        extra?.(s);
        assert.equal(Object.values(s.sql.prepare('PRAGMA integrity_check').get() as object)[0], 'ok');
      } finally {
        s.close();
      }
    };
    await check(t1, 'First change', (s) => assert.ok(!s.schema.tables.find((t) => t.name === 'Congress')!.fields.some((f) => f.name === 'Nickname')));
    await check(t2, 'Second change', (s) => assert.equal(s.get('Congress', 2).fieldData.Nickname, 'Slim'));
    await check(t3, 'Third change', (s) => assert.equal(s.find('Congress', { limit: 0 }).totalCount, total));
    await check(Date.now(), 'Last change');
    // The moment before anything changed: the first full backup, as the file was.
    const start = restorePoint(dest, 'Charts' + STORE_EXT, t0);
    assert.ok(start && start.logs.length === 0);
    await check(t0, before);
    await assert.rejects(restoreAt(dir, dest, Date.now() - 3_600_000, 'Charts'), /no backup of Charts from before/);

    // Back to hosting: the restored file opens and finds work.
    host = new Host(dir);
    assert.equal(name(host.get('Charts')!), before);
    host.close();
  } finally {
    delete process.env.TABULARIUS_BACKUP_KEY;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('point-in-time backups restore records and design as they were', { skip }, () => pointInTime());
test('point-in-time backups, encrypted', { skip }, () => pointInTime('correct horse'));

test('point-in-time restore keeps post-backup token revocations and restores the historical active flag', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pitr-credentials-'));
  const dest = join(dir, 'Backups');
  try {
    copyFileSync(fixture, join(dir, 'Charts.fmp12'));
    const host = new Host(dir);
    const store = host.get('Charts')!;
    const full = store.privilegeSets().find((set) => set.name === '[Full Access]')!;
    const limited = store.privilegeSets().find((set) => set.name !== full.name)!;
    store.createLocalAccount('RestoreUser', limited.name, true);
    const token = store.createApiToken('Admin');
    const fullBackup = await backupFolder(dir, dest);
    store.revokeApiToken(/^ohbt_([0-9a-f]+)\./.exec(token)![1]);
    store.setAccountActive('RestoreUser', false);
    host.close();

    await restoreAt(dir, dest, Date.now(), 'Charts');
    const restored = new Store(join(dir, 'Charts' + STORE_EXT), 'Charts');
    try {
      assert.equal(restored.accountInactive('RestoreUser'), false, 'active flag is restored as point-in-time data');
      assert.equal(restored.apiToken(token), undefined, 'a token revoked after the backup stays revoked');
      assert.equal(restored.apiTokens().length, 0);
    } finally {
      restored.close();
    }
    await restoreBackup(dir, fullBackup.dir, 'Charts');
    const restoredSet = new Store(join(dir, 'Charts' + STORE_EXT), 'Charts');
    try {
      assert.equal(restoredSet.apiToken(token), undefined, 'a set restore keeps the token revoked too');
    } finally {
      restoredSet.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('times people type', () => {
  assert.equal(new Date(parseTime('2026-10-11 14:05')).toString(), new Date(2026, 9, 11, 14, 5, 0).toString());
  assert.equal(new Date(parseTime('2026-10-11T14:05:30')).getSeconds(), 30);
  assert.equal(new Date(parseTime('09:30')).getHours(), 9);
  assert.equal(new Date(parseTime('2026-10-11')).getHours(), 23);
  assert.throws(() => parseTime('yesterday'), /can't read time/);
});
