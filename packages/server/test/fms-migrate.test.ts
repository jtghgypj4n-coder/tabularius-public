// Switching from FileMaker Server: its files, schedules, backups and certificate
// brought into a Tabularius folder in one step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchFmsExport, migrateFms, nativePath, readSettings, serve, setAdminPassword, type FmsExport } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const openssl = spawnSync('openssl', ['version']).status === 0;

const at = (time: string) => `2024-01-01T${time}:00`;

/** What a FileMaker Server's Admin API answers, for a server hosting Charts in a subfolder. */
const exported: FmsExport = {
  metadata: { serverName: 'fms1', serverVersion: '21.0.1.53' },
  general: { maxFiles: 125, maxProConnections: 250 },
  security: { requireSecureDB: true },
  databases: [
    { filename: 'Charts.fmp12', folder: 'filemac:/Macintosh HD/Library/FileMaker Server/Data/Databases/Sales/', status: 'NORMAL' },
    { filename: 'Gone.fmp12', folder: 'filemac:/Macintosh HD/Library/FileMaker Server/Data/Databases/', status: 'CLOSED' },
  ],
  schedules: [
    {
      id: '2', name: 'Nightly import', enabled: true,
      filemakerScriptType: { resource: 'file:Charts.fmp12', fmScriptName: 'Import', fmScriptParam: 'all', fmScriptAccount: 'Admin', fmScriptPassword: '', timeout: 0 },
      everyndaysType: { startTimeStamp: at('02:00'), dailyDays: 1 },
    },
    {
      id: '3', name: 'Hourly sync', enabled: true, sendEmail: ['ops@example.com'],
      filemakerScriptType: { resource: 'file:Charts.fmp12', fmScriptName: 'Sync', fmScriptAccount: '' },
      everyndaysType: { startTimeStamp: at('08:00'), dailyDays: 1, repeatTask: { repeatFrequency: 1, repeatInterval: 'HOURS', endTime: '18:00:00' } },
    },
    {
      id: '4', name: 'Monday report', enabled: true,
      filemakerScriptType: { resource: 'file:Charts.fmp12', fmScriptName: 'Report', fmScriptAccount: 'Admin' },
      weeklyType: { startTimeStamp: at('07:30'), daysOfTheWeek: ['MON'] },
    },
    {
      id: '5', name: 'Daily backup', enabled: true,
      backupType: { resourceType: 'ALL_DB', backupTarget: 'filemac:/Macintosh HD/Library/FileMaker Server/Data/Backups/', maxBackups: 5, clone: false, verify: true },
      everyndaysType: { startTimeStamp: at('00:00'), dailyDays: 1 },
    },
    {
      id: '6', name: 'Hourly backup', enabled: true,
      backupType: { resourceType: 'ALL_DB', backupTarget: 'filemac:/Macintosh HD/Library/FileMaker Server/Data/Backups/', maxBackups: 12 },
      everyndaysType: { startTimeStamp: at('00:00'), dailyDays: 1, repeatTask: { repeatFrequency: 1, repeatInterval: 'HOURS', endTime: '23:59:00' } },
    },
    { id: '7', name: 'Clean temp', enabled: true, systemScriptType: { osScript: 'filemac:/Library/FileMaker Server/Data/Scripts/clean.sh' }, everyndaysType: { startTimeStamp: at('03:00'), dailyDays: 1 } },
    { id: '8', name: 'Goodbye', enabled: true, messageType: { resourceType: 'ALL_DB', messageText: 'Closing soon' }, onceType: { startTimeStamp: at('17:00') } },
  ],
};

/** A FileMaker Server folder: Charts under Data/Databases/Sales with its container folder, and a custom certificate. */
function fmsFolder(): string {
  const fms = mkdtempSync(join(tmpdir(), 'tabularius-fms-'));
  const sales = join(fms, 'Data', 'Databases', 'Sales');
  mkdirSync(join(sales, 'RC_Data_FMS', 'Charts', 'Files'), { recursive: true });
  copyFileSync(fixture, join(sales, 'Charts.fmp12'));
  writeFileSync(join(sales, 'RC_Data_FMS', 'Charts', 'Files', 'logo.png'), 'png');
  mkdirSync(join(fms, 'CStore'));
  if (openssl) {
    // As `fmsadmin certificate import` leaves them: the key encrypted with a passphrase.
    const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-passout', 'pass:fms-pass', '-keyout', 'serverKey.pem', '-out', 'serverCustom.pem', '-subj', '/CN=fms.example.com', '-days', '30'], { cwd: join(fms, 'CStore') });
    assert.equal(r.status, 0, r.stderr.toString());
  }
  return fms;
}

test('FileMaker paths become paths on this machine', () => {
  assert.equal(nativePath('filemac:/Macintosh HD/Library/FileMaker Server/Data/Backups/'), '/Library/FileMaker Server/Data/Backups/');
  assert.equal(nativePath('filewin:/C:/Program Files/FileMaker/FileMaker Server/Data/'), 'C:\\Program Files\\FileMaker\\FileMaker Server\\Data\\');
  assert.equal(nativePath('filelinux:/opt/FileMaker/FileMaker Server/Data/'), '/opt/FileMaker/FileMaker Server/Data/');
});

test('files, schedules, backups and the certificate come over in one step', { skip }, async () => {
  const fms = fmsFolder();
  const dest = join(mkdtempSync(join(tmpdir(), 'tabularius-migrated-')), 'hosted');
  const migration = structuredClone(exported);
  for (const schedule of migration.schedules!) {
    if (schedule.backupType) (schedule.backupType as Record<string, unknown>).backupTarget = `filelinux:${join(fms, 'Backups-not-on-this-machine')}`;
  }

  const dry = migrateFms(migration, dest, { fmsDir: fms, keyPassphrase: 'fms-pass', dryRun: true });
  assert.equal(existsSync(dest), false, 'a dry run changes nothing');
  assert.equal(dry.files.find((f) => f.name === 'Charts')!.done, true);

  const r = migrateFms(migration, dest, { fmsDir: fms, keyPassphrase: 'fms-pass' });
  const file = (n: string) => r.files.find((f) => f.name === n)!;
  const sched = (n: string) => r.schedules.find((s) => s.name === n)!;

  // The hosted file and its externally stored containers.
  assert.equal(file('Charts').done, true);
  assert.equal(statSync(join(dest, 'Charts.fmp12')).size, statSync(fixture).size);
  assert.equal(readFileSync(join(dest, 'RC_Data_FMS', 'Charts', 'Files', 'logo.png'), 'utf8'), 'png');
  assert.match(file('Charts').note!, /RC_Data_FMS/);
  assert.equal(file('Gone').done, false);
  assert.match(file('Gone').note!, /not found/);

  // Script schedules, offline in Tabularius's scheduler.
  const saved = JSON.parse(readFileSync(join(dest, '.openhbam-schedules.json'), 'utf8')).schedules;
  assert.deepEqual(saved.map((s: any) => [s.name, s.database, s.script, s.account, s.everyMinutes, s.at, s.enabled, s.parameter]), [
    ['Nightly import', 'Charts', 'Import', 'Admin', 1440, '02:00', true, 'all'],
    ['Hourly sync', 'Charts', 'Sync', 'Admin', 60, '08:00', true, undefined],
    ['Monday report', 'Charts', 'Report', 'Admin', 1440, '07:30', false, undefined],
  ]);
  assert.match(sched('Hourly sync').note!, /until 18:00:00/);
  assert.match(sched('Hourly sync').note!, /send no mail/);
  assert.match(sched('Monday report').note!, /turned off/);

  // The most frequent backup schedule becomes the server's; the others are listed.
  assert.equal(sched('Hourly backup').done, true);
  assert.equal(sched('Daily backup').done, false);
  assert.match(sched('Daily backup').note!, /Hourly backup/);
  for (const n of ['Clean temp', 'Goodbye']) assert.equal(sched(n).done, false);
  assert.match(sched('Clean temp').note!, /never brings these over/);
  assert.ok(r.notes.some((n) => /Backups went to/.test(n)), 'a backup folder not on this machine is said');

  const settings = readSettings(dest);
  assert.equal(settings.backupEvery, '1h');
  assert.equal(settings.keep, 12);
  assert.equal(settings.backupDir, undefined);

  if (openssl) {
    assert.equal(r.certificate?.done, true, r.certificate?.note);
    assert.match(r.certificate!.subject, /fms\.example\.com/);
    assert.equal(settings.tlsCert, join(dest, 'tls', 'cert.pem'));
    assert.equal(statSync(settings.tlsKey!).mode & 0o077, 0, 'the key is readable by its owner only');
    assert.doesNotMatch(readFileSync(settings.tlsKey!, 'utf8'), /ENCRYPTED/);

    // It serves HTTPS with that certificate, and runs the imported schedules.
    setAdminPassword(dest, 'secret');
    const s = await serve({ dir: dest, port: 0, tlsCert: settings.tlsCert, tlsKey: settings.tlsKey, log: () => {} });
    try {
      assert.match(s.url, /^https:/);
      assert.deepEqual(s.host.names(), ['Charts']);
    } finally {
      s.server.close();
    }

    // Without the passphrase the key stays where it is.
    const other = migrateFms({}, join(dest, '..', 'nokey'), { fmsDir: fms });
    assert.equal(other.certificate?.done, false);
    assert.match(other.certificate!.note!, /TABULARIUS_FMS_KEY_PASSPHRASE/);
  }

  // Running it again adds nothing twice.
  const again = migrateFms(migration, dest, { fmsDir: fms, keyPassphrase: 'fms-pass' });
  assert.match(again.files.find((f) => f.name === 'Charts')!.note!, /already/);
  assert.equal(JSON.parse(readFileSync(join(dest, '.openhbam-schedules.json'), 'utf8')).schedules.length, 3);
});

test('with only the folder, every file under Data/Databases comes over', { skip }, () => {
  const fms = fmsFolder();
  const dest = mkdtempSync(join(tmpdir(), 'tabularius-migrated-'));
  const r = migrateFms({}, dest, { fmsDir: fms });
  assert.deepEqual(r.files.map((f) => [f.name, f.done]), [['Charts', true]]);
  assert.ok(existsSync(join(dest, 'Charts.fmp12')));
});

test('reads a server through its Admin API (Tabularius answers it like FileMaker Server)', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-fms-live-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    const script = s.host.get('Charts')!.schema.scripts[0].name;
    const auth = await fetch(`${s.url}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret') } }).then((r) => r.json());
    const made = await fetch(`${s.url}/fmi/admin/api/v2/schedules/filemakerscript`, {
      method: 'POST', headers: { authorization: `Bearer ${auth.response.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Every 2 hours', enabled: true, filemakerScriptType: { resource: 'file:Charts.fmp12', fmScriptName: script, fmScriptAccount: 'Admin' }, everyndaysType: { startTimeStamp: at('06:00'), dailyDays: 1, repeatTask: { repeatFrequency: 2, repeatInterval: 'HOURS', endTime: '23:59:00' } } }),
    }).then((r) => r.json());
    assert.equal(made.messages[0].code, '0');

    await assert.rejects(fetchFmsExport(s.url, 'admin', 'wrong'), /couldn't sign in/);
    const exp = await fetchFmsExport(s.url, 'admin', 'secret');
    assert.deepEqual(exp.databases!.map((d) => d.filename), ['Charts.fmp12']);
    assert.ok(exp.metadata?.serverVersion);

    const dest = mkdtempSync(join(tmpdir(), 'tabularius-migrated-'));
    const r = migrateFms(exp, dest);
    assert.deepEqual(r.schedules.map((x) => [x.name, x.done]), [['Every 2 hours', true]]);
    const saved = JSON.parse(readFileSync(join(dest, '.openhbam-schedules.json'), 'utf8')).schedules[0];
    assert.deepEqual([saved.script, saved.everyMinutes, saved.at], [script, 120, '06:00']);
    // The file list came over; the file itself is on the old server's disk (it's found at its own path here).
    assert.equal(r.files[0].name, 'Charts');
  } finally {
    s.server.close();
  }
});
