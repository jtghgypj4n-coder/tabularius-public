// Backups treated as hostile input. Each test damages or forges a backup set the way a bad disk, a bad sync or
// someone with write access to the backup folder could, and asserts that restoring it is refused with a message
// that names the problem and that the live files, their logs and the folder are left exactly as they were.
//
// What a backup can and cannot promise (see the README, "What a backup protects against"):
// - An unencrypted set carries SHA-256 checksums beside the files, so accidents are caught, but whoever can write
//   the set can also write matching checksums. It is not tamper-proof.
// - An encrypted set (TABULARIUS_BACKUP_KEY) authenticates each file with AES-GCM, and its manifest carries a
//   signature made with the same passphrase over the checksums, the times, the container files (checksum, size and
//   time) and, for point-in-time restores, how many logs were saved and a chain over them. Swapping, renaming,
//   mixing or rolling back files inside it, or removing or cutting a log, needs the passphrase. While the passphrase
//   is set a set with no signature is refused, so a set cannot be downgraded to a plain one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { backupFolder, restoreAt, restorePoint, restorePointTo, restoreBackup, scheduleProgressive, type ChangedSince } from '../src/backup.ts';
import { checksum, describeCheck, verifySet } from '../src/backup-verify.ts';

const KEY = 'correct horse battery staple';

interface World {
  root: string;
  folder: string;
  /** The set restored from. */
  set: string;
  names: string[];
  key: string;
  /** The live files as they are, to compare after a refused restore. */
  frozen(): Record<string, Buffer>;
  untouched(before: Record<string, Buffer>): void;
}

/** A folder of two files, a backup set of them (encrypted or not), then a change to each live file after the backup. */
async function world(t: { after(fn: () => void): void }, key: string, opts: { external?: boolean } = {}): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), 'backup-tamper-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'live');
  const dest = join(root, 'dest');
  mkdirSync(folder);
  const names = ['A.openhbam.sqlite', 'B.openhbam.sqlite'];
  for (const name of names) createStore(join(folder, name));
  if (opts.external) {
    mkdirSync(join(folder, 'Files', 'A', 'Docs'), { recursive: true });
    writeFileSync(join(folder, 'Files', 'A', 'Docs', 'one.txt'), 'external container file');
  }
  const set = (await backupFolder(folder, dest, 0, key || undefined)).dir;
  for (const name of names) {
    const db = new DatabaseSync(join(folder, name));
    try { db.exec('CREATE TABLE changed_after_backup (value TEXT)'); } finally { db.close(); }
  }
  const files = () => readdirSync(folder, { recursive: true }).map(String).filter((f) => !f.startsWith('.openhbam-claim.sqlite') && !statSync(join(folder, f)).isDirectory()).sort(); // the folder claim's own database is left by any restore attempt
  const frozen = () => Object.fromEntries(files().map((f) => [f, readFileSync(join(folder, f))]));
  return {
    root, folder, set, names, key, frozen,
    untouched(before) {
      const now = frozen();
      assert.deepEqual(Object.keys(now), Object.keys(before), 'the same files are in the folder, with no .restoring, journal or sidecar left over');
      for (const f of Object.keys(before)) assert.ok(now[f].equals(before[f]), `${f} is unchanged`);
    },
  };
}

const manifest = (set: string) => JSON.parse(readFileSync(join(set, 'backup.json'), 'utf8')) as Record<string, any>;
const writeManifest = (set: string, info: unknown) => writeFileSync(join(set, 'backup.json'), JSON.stringify(info));
const stored = (w: World, name: string) => join(w.set, name + (w.key ? '.enc' : ''));

/** Restoring is refused with a message that matches, and nothing in the live folder changed. */
async function refused(w: World, why: RegExp, message: string, set = w.set, only?: string): Promise<void> {
  const before = w.frozen();
  await assert.rejects(restoreBackup(w.folder, set, only, w.key || undefined), why, message);
  w.untouched(before);
}

const modes: [string, string][] = [['unencrypted', ''], ['encrypted', KEY]];

for (const [label, key] of modes) {
  test(`${label}: a set that has not been touched restores (the control for the tests below)`, async (t) => {
    const w = await world(t, key);
    assert.deepEqual((await restoreBackup(w.folder, w.set, undefined, key || undefined)).sort(), w.names);
    for (const name of w.names) {
      const db = new DatabaseSync(join(w.folder, name), { readOnly: true });
      try { assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'changed_after_backup'").get()!.n, 0, `${name} is as it was at the backup`); } finally { db.close(); }
    }
  });

  test(`${label}: a changed, cut short or emptied copy is refused`, async (t) => {
    const w = await world(t, key);
    const victim = stored(w, w.names[1]);
    const original = readFileSync(victim);
    const attempts: [string, Buffer][] = [
      ['one flipped byte at the end', Buffer.from(original.map((b, i) => (i === original.length - 1 ? b ^ 1 : b)))],
      ['one flipped byte at the start', Buffer.from(original.map((b, i) => (i === 0 ? b ^ 1 : b)))],
      ['cut short by a page', original.subarray(0, original.length - 4096)],
      ['cut short by one byte', original.subarray(0, original.length - 1)],
      ['emptied', Buffer.alloc(0)],
      ['a page of zeros appended', Buffer.concat([original, Buffer.alloc(4096)])],
    ];
    for (const [what, bytes] of attempts) {
      writeFileSync(victim, bytes);
      await refused(w, /changed on disk|checksum|damaged|cut off|decrypt|not a database|malformed/i, what);
    }
  });

  test(`${label}: weak or malformed checksums in the manifest are refused, not matched loosely`, async (t) => {
    const w = await world(t, key);
    const good = manifest(w.set);
    const sum: string = good.sha256[w.names[0]];
    const forged = (sha256: unknown) => ({ ...good, sha256 });
    const cases: [string, unknown][] = [
      ['first half of the hash', { ...good.sha256, [w.names[0]]: sum.slice(0, 32) }],
      ['upper-case hex', { ...good.sha256, [w.names[0]]: sum.toUpperCase() }],
      ['hash with a prefix', { ...good.sha256, [w.names[0]]: 'sha256:' + sum }],
      ['hash with trailing space', { ...good.sha256, [w.names[0]]: sum + ' ' }],
      ['empty hash', { ...good.sha256, [w.names[0]]: '' }],
      ['not hex', { ...good.sha256, [w.names[0]]: 'z'.repeat(64) }],
      ['a number', { ...good.sha256, [w.names[0]]: 12345 }],
      ['an array', { ...good.sha256, [w.names[0]]: [sum] }],
      ['an object', { ...good.sha256, [w.names[0]]: { sha256: sum } }],
      ['the other file\'s hash', { ...good.sha256, [w.names[0]]: good.sha256[w.names[1]] }],
      ['a file left out of the list', { [w.names[1]]: good.sha256[w.names[1]] }],
      ['the list as a string', sum],
      ['the list as an array', [sum]],
    ];
    for (const [what, sha256] of cases) {
      writeManifest(w.set, forged(sha256));
      await refused(w, /checksum|backup\.json|signature|manifest|changed on disk|unsafe/i, what);
    }
    for (const [what, text] of [['not JSON', '{'], ['null', 'null'], ['an array', '[]'], ['a string', '"x"'], ['empty', '']] as const) {
      writeFileSync(join(w.set, 'backup.json'), text);
      await refused(w, /backup\.json|manifest/i, what);
    }
  });

  test(`${label}: a file the manifest lists but the set no longer holds is refused (a set is restored whole or not at all)`, async (t) => {
    const w = await world(t, key);
    rmSync(stored(w, w.names[1]));
    await refused(w, /missing|not in|no longer|lists/i, 'whole-set restore with a file gone');
    // Asking for the file that is still there is a different request and works.
    assert.deepEqual(await restoreBackup(w.folder, w.set, 'A', key || undefined), [w.names[0]]);
  });

  test(`${label}: two copies of one file in a set (plain and encrypted, or twice) are ambiguous and refused`, async (t) => {
    const w = await world(t, key);
    const other = key ? w.names[0] : w.names[0] + '.enc';
    // The other form of the same file: a plain copy beside an encrypted one, or an .enc beside a plain one.
    copyFileSync(stored(w, w.names[0]), join(w.set, other));
    await refused(w, /two copies|both|ambiguous|more than one|multiple/i, 'two forms of one file');
  });

  test(`${label}: a copy that is a symlink is not followed`, async (t) => {
    const w = await world(t, key);
    // A valid copy of another file, kept outside the set. A symlink to it must not be restored in the set's name.
    const outside = join(w.root, 'elsewhere' + (key ? '.enc' : ''));
    copyFileSync(stored(w, w.names[1]), outside);
    rmSync(stored(w, w.names[0]));
    symlinkSync(outside, stored(w, w.names[0]));
    const info = manifest(w.set);
    info.sha256[w.names[0]] = await checksum(outside);
    writeManifest(w.set, info);
    await refused(w, /symlink|not a regular file|link/i, 'symlinked copy');
  });

  test(`${label}: restored files get the permissions of the files they replace, not those of the backup`, { skip: process.platform === 'win32' }, async (t) => {
    const w = await world(t, key);
    for (const name of w.names) chmodSync(join(w.folder, name), 0o600);
    // A set whose copies are world-writable.
    for (const name of w.names) chmodSync(stored(w, name), 0o666);
    await restoreBackup(w.folder, w.set, undefined, key || undefined);
    for (const name of w.names) assert.equal(statSync(join(w.folder, name)).mode & 0o777, 0o600, name);
  });
}

test('encrypted: a copy of another file, swapped in with a matching checksum, is refused (the manifest is signed)', async (t) => {
  const w = await world(t, KEY);
  const [a, b] = w.names;
  // Someone who cannot read the files but can write the set: A's ciphertext in B's place, and the manifest made to match.
  copyFileSync(stored(w, a), stored(w, b));
  const info = manifest(w.set);
  info.sha256[b] = await checksum(stored(w, b));
  writeManifest(w.set, info);
  await refused(w, /signature|doesn't match|does not match|altered/i, 'swapped ciphertext');
});

test('encrypted: an older set\'s copy placed in a newer set, with a matching checksum, is refused', async (t) => {
  const w = await world(t, KEY);
  const older = (await backupFolder(w.folder, join(w.root, 'dest'), 0, KEY)).dir;
  // Changes after the first set, so the second set differs; then roll one file back to the first set's copy.
  const newer = (await backupFolder(w.folder, join(w.root, 'dest'), 0, KEY)).dir;
  const target = join(newer, w.names[0] + '.enc');
  assert.notDeepEqual(readFileSync(join(w.set, w.names[0] + '.enc')), readFileSync(target));
  copyFileSync(join(w.set, w.names[0] + '.enc'), target);
  const info = manifest(newer);
  info.sha256[w.names[0]] = await checksum(target);
  writeManifest(newer, info);
  assert.ok(existsSync(older));
  await refused(w, /signature|doesn't match|does not match|altered/i, 'rolled-back file in a newer set', newer);
});

test('encrypted: the signature is part of the manifest, and a manifest edited in any signed part is refused', async (t) => {
  const w = await world(t, KEY, { external: true });
  const good = manifest(w.set);
  assert.ok(good.auth?.mac, 'a set made now carries a signature');
  const edits: [string, (i: any) => void][] = [
    ['a file\'s time', (i) => { i.finished[w.names[0]] = new Date(0).toISOString(); }],
    ['a container file\'s hash', (i) => { const k = Object.keys(i.external)[0]; i.external[k].sha256 = 'a'.repeat(64); }],
    ['a container file added', (i) => { i.external['Files/A/Docs/two.txt'] = { size: 1, mtimeMs: 1, sha256: 'b'.repeat(64) }; }],
    ['a container file removed', (i) => { delete i.external[Object.keys(i.external)[0]]; }],
    ['the signature itself', (i) => { i.auth.mac = i.auth.mac.replace(/^./, (c: string) => (c === 'a' ? 'b' : 'a')); }],
  ];
  for (const [what, edit] of edits) {
    const info = structuredClone(good);
    edit(info);
    writeManifest(w.set, info);
    await refused(w, /signature|doesn't match|does not match|altered/i, what);
  }
  // Parts that are not signed can change without harm: the check results the server writes back are not evidence.
  writeManifest(w.set, { ...good, verified: { at: 'x', ok: true, files: {}, ms: 1 } });
  assert.deepEqual((await restoreBackup(w.folder, w.set, undefined, KEY)).sort(), w.names);
});

test('encrypted: a signature that is removed is a set the restore does not trust, unless the person says to', async (t) => {
  const w = await world(t, KEY);
  const info = manifest(w.set);
  delete info.auth;
  writeManifest(w.set, info);
  await refused(w, /not signed|unsigned|no signature/i, 'signature stripped');
  const done = await restoreBackup(w.folder, w.set, undefined, KEY, { acceptUnsigned: true });
  assert.deepEqual(done.sort(), w.names, 'a set from before signatures existed can still be put back on request');
});

test('encrypted: the wrong passphrase is a wrong passphrase, not a damaged set', async (t) => {
  const w = await world(t, KEY);
  const before = w.frozen();
  await assert.rejects(restoreBackup(w.folder, w.set, undefined, 'a different passphrase'), /wrong (key|passphrase)|signature/i);
  w.untouched(before);
});

test('unencrypted: what a checksum cannot promise is stated, not hidden', async (t) => {
  const w = await world(t, '');
  // Whoever can write the set can write matching checksums: a swapped copy is accepted. This is the limit the docs name.
  const [a, b] = w.names;
  copyFileSync(join(w.set, a), join(w.set, b));
  const info = manifest(w.set);
  info.sha256[b] = await checksum(join(w.set, b));
  writeManifest(w.set, info);
  assert.ok(!info.auth, 'an unencrypted set has no key to sign with');
  assert.deepEqual((await restoreBackup(w.folder, w.set, undefined)).sort(), w.names);
  const check = await verifySet(w.set, undefined);
  assert.equal(check.ok, true, 'verification cannot tell either');
});

test('container files: a copy changed, swapped for another set\'s or listed from outside the set is refused, and nothing is replaced', async (t) => {
  for (const key of ['', KEY]) {
    const w = await world(t, key, { external: true });
    const info = manifest(w.set);
    const rel = Object.keys(info.external)[0];
    const copy = join(w.set, ...rel.split('/')) + (key ? '.enc' : '');
    const original = readFileSync(copy);
    writeFileSync(copy, Buffer.from(original.map((b, i) => (i === original.length - 1 ? b ^ 1 : b))));
    await refused(w, /changed on disk|checksum|damaged/i, 'a container file with a flipped byte');
    writeFileSync(copy, original);
    rmSync(copy);
    await refused(w, /ENOENT|missing|no such/i, 'a container file gone');
    writeFileSync(copy, original);
    for (const bad of ['../live/A.openhbam.sqlite', 'Files/A/../../A.openhbam.sqlite', '/etc/passwd', 'Files\\A\\x', 'Files/A/x\0y', 'RC_Data_FMS/A', 'Files/A/']) {
      writeManifest(w.set, { ...info, external: { [bad]: info.external[rel] } });
      await refused(w, /unsafe|signature|invalid|not allowed|nul/i, `container path ${JSON.stringify(bad)}`);
    }
    writeManifest(w.set, info);
    assert.deepEqual((await restoreBackup(w.folder, w.set, undefined, key || undefined)).sort(), w.names, 'untouched again, it restores');
    assert.equal(readFileSync(join(w.folder, 'Files', 'A', 'Docs', 'one.txt'), 'utf8'), 'external container file');
  }
});

test('sets: a stray set folder, a renamed one and a set restored from its renamed folder', async (t) => {
  const w = await world(t, KEY);
  const renamed = join(w.root, 'moved here');
  renameSync(w.set, renamed);
  // The signature does not depend on where or under what name the folder is, so a set copied to a USB drive or
  // fetched from storage under another name restores.
  assert.deepEqual((await restoreBackup(w.folder, renamed, undefined, KEY)).sort(), w.names);
});

// Point-in-time restores read the same sets, so they are held to the same rules: the set's signature, the base copy's
// checksum, and the saved logs laid over it (each authenticated when the set is encrypted).
interface Timeline { root: string; folder: string; dest: string; set: string; at: number; logs: string[]; key: string }

async function timeline(t: { after(fn: () => void): void }, key: string): Promise<Timeline> {
  const root = mkdtempSync(join(tmpdir(), 'backup-tamper-pit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'live');
  const dest = join(root, 'dest');
  mkdirSync(folder);
  createStore(join(folder, 'A.openhbam.sqlite'));
  if (key) process.env.TABULARIUS_BACKUP_KEY = key;
  t.after(() => { delete process.env.TABULARIUS_BACKUP_KEY; });
  const host = new Host(folder);
  const p = await scheduleProgressive(host, { every: 3_600_000, dest });
  await sleep(20);
  host.get('A')!.applyDesign([{ op: 'createTable', name: 'Notes' }]);
  await sleep(20);
  p.run();
  await sleep(20);
  const at = Date.now();
  p.stop();
  host.close();
  const set = join(dest, readdirSync(dest).filter((n) => /^\d{4}-/.test(n)).sort().at(-1)!);
  const logs = readdirSync(join(set, 'progressive'), { recursive: true }).map(String).filter((f) => /\.log/.test(f)).map((f) => join(set, 'progressive', f));
  return { root, folder, dest, set, at, logs, key };
}

for (const [label, key] of modes) {
  test(`${label}: a point-in-time restore refuses a base copy that was changed, and restores when it was not`, async (t) => {
    const w = await timeline(t, key);
    const copy = join(w.set, 'A.openhbam.sqlite' + (key ? '.enc' : ''));
    const original = readFileSync(copy);
    writeFileSync(copy, Buffer.from(original.map((b, i) => (i === original.length - 1 ? b ^ 1 : b))));
    const before = readFileSync(join(w.folder, 'A.openhbam.sqlite'));
    await assert.rejects(restoreAt(w.folder, w.dest, w.at, 'A', key || undefined), /changed on disk|checksum|decrypt|damaged/i);
    assert.ok(readFileSync(join(w.folder, 'A.openhbam.sqlite')).equals(before), 'the live file is untouched');
    assert.equal(existsSync(join(w.folder, 'A.openhbam.sqlite.restoring')), false);
    writeFileSync(copy, original);
    assert.equal((await restoreAt(w.folder, w.dest, w.at, 'A', key || undefined)).length, 1);
  });

  test(`${label}: a point-in-time restore refuses a base copy that is a symbolic link`, { skip: process.platform === 'win32' }, async (t) => {
    const w = await timeline(t, key);
    const copy = join(w.set, 'A.openhbam.sqlite' + (key ? '.enc' : ''));
    const real = join(w.root, 'elsewhere');
    renameSync(copy, real);
    symlinkSync(real, copy);
    await assert.rejects(restoreAt(w.folder, w.dest, w.at, 'A', key || undefined), /not an ordinary file/);
  });
}

test('encrypted: a point-in-time restore refuses a swapped base copy with a rewritten checksum, a stripped signature unless accepted, and the wrong passphrase', async (t) => {
  const w = await timeline(t, KEY);
  const copy = join(w.set, 'A.openhbam.sqlite.enc');
  const info = manifest(w.set);
  const other = join(w.root, 'other.enc');
  // A copy of a different file, made by someone without the passphrase, cannot be signed in.
  writeFileSync(other, readFileSync(copy).subarray(0, 5000));
  copyFileSync(other, copy);
  info.sha256['A.openhbam.sqlite'] = await checksum(copy);
  writeManifest(w.set, info);
  await assert.rejects(restoreAt(w.folder, w.dest, w.at, 'A', KEY), /signature/i);
  const fresh = await timeline(t, KEY);
  const stripped = manifest(fresh.set);
  delete stripped.auth;
  writeManifest(fresh.set, stripped);
  await assert.rejects(restoreAt(fresh.folder, fresh.dest, fresh.at, 'A', KEY), /no signature/i);
  assert.equal((await restoreAt(fresh.folder, fresh.dest, fresh.at, 'A', KEY, { acceptUnsigned: true })).length, 1);
  await assert.rejects(restoreAt(fresh.folder, fresh.dest, fresh.at, 'A', 'another passphrase', { acceptUnsigned: true }), /wrong passphrase|decrypt/i);
});

test('encrypted: a saved log that was flipped or cut short is refused by a point-in-time restore', async (t) => {
  const w = await timeline(t, KEY);
  assert.ok(w.logs.length, 'the timeline saved a log');
  const log = w.logs[0];
  const original = readFileSync(log);
  const before = readFileSync(join(w.folder, 'A.openhbam.sqlite'));
  for (const [what, bytes] of [
    ['flipped', Buffer.from(original.map((b, i) => (i === original.length - 1 ? b ^ 1 : b)))],
    ['cut short', original.subarray(0, original.length - 20)],
  ] as [string, Buffer][]) {
    writeFileSync(log, bytes);
    let restored = true;
    try { await restoreAt(w.folder, w.dest, w.at, 'A', KEY); } catch { restored = false; }
    // A cut-short log can end on a whole record, which then reads as a log that saved less; a restore that goes ahead
    // must then be of the base copy or an earlier point, never of changed bytes.
    if (restored) assert.equal(what, 'cut short', `${what} log: a restore that goes ahead is only possible when the cut falls on a record boundary`);
    else assert.ok(readFileSync(join(w.folder, 'A.openhbam.sqlite')).equals(before), 'the live file is untouched');
  }
});

test('restores report a live file that has changes after the backup, for both whole-set and point-in-time restores', async (t) => {
  const w = await timeline(t, '');
  const seen: ChangedSince[] = [];
  const bumped = new Date(Date.now() + 60_000);
  utimesSync(join(w.folder, 'A.openhbam.sqlite'), bumped, bumped);
  await restoreAt(w.folder, w.dest, w.at, 'A', undefined, { newerThanBackup: seen });
  assert.deepEqual(seen.map((s) => s.file), ['A.openhbam.sqlite']);
  assert.ok(seen[0].changedAt > seen[0].backupAt);
});

test('verify-backup: reports a manifest-listed file that is gone and an unsigned encrypted set, and signs only on request and only after the checks pass', async (t) => {
  const w = await world(t, KEY);
  const info = manifest(w.set);
  const stripped = { ...info };
  delete stripped.auth;
  writeManifest(w.set, stripped);
  const plainCheck = await verifySet(w.set, KEY);
  assert.equal(plainCheck.ok, true);
  assert.equal(plainCheck.unsigned, true);
  assert.match(describeCheck('set', plainCheck), /no signature.*--accept-unsigned-backup.*--sign/);
  assert.equal(manifest(w.set).auth, undefined, 'checking does not sign');
  // A missing file blocks signing.
  rmSync(stored(w, w.names[1]));
  const broken = await verifySet(w.set, KEY, { sign: true });
  assert.equal(broken.ok, false);
  assert.match(broken.files[w.names[1]], /missing/);
  assert.equal(manifest(w.set).auth, undefined, 'a set that fails its check is not signed');
  // Put back and sign.
  writeManifest(w.set, info);
  const fresh = await world(t, KEY);
  const strippedFresh = manifest(fresh.set);
  delete strippedFresh.auth;
  writeManifest(fresh.set, strippedFresh);
  const signed = await verifySet(fresh.set, KEY, { sign: true });
  assert.equal(signed.ok, true);
  assert.equal(signed.unsigned, undefined);
  assert.deepEqual((await restoreBackup(fresh.folder, fresh.set, undefined, KEY)).sort(), fresh.names, 'once signed, it restores without the flag');
  // A signature that does not match is a failed check.
  const forged = manifest(fresh.set);
  forged.finished[fresh.names[0]] = '2001-01-01T00:00:00.000Z';
  writeManifest(fresh.set, forged);
  const mismatch = await verifySet(fresh.set, KEY);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.files['backup.json'], /signature/);
});

// Found by a second reading of the signing change (see PR): ways round the signature that these tests keep shut.

test('downgrade: an encrypted set turned into a plain one (copies swapped for plain files, signature removed) is refused while a passphrase is set', async (t) => {
  const w = await world(t, KEY);
  const info = manifest(w.set);
  for (const name of w.names) {
    rmSync(join(w.set, name + '.enc'));
    const forged = join(w.root, 'forged-' + name);
    const db = new DatabaseSync(forged);
    db.exec('CREATE TABLE forged (v TEXT)');
    db.close();
    copyFileSync(forged, join(w.set, name));
    info.sha256[name] = await checksum(join(w.set, name));
  }
  delete info.auth;
  writeManifest(w.set, info);
  await refused(w, /no signature/i, 'plain copies and no signature, with the passphrase set');
});

test('downgrade: a set planted in the folder for a point-in-time restore is refused while a passphrase is set', async (t) => {
  const w = await timeline(t, KEY);
  const planted = join(w.dest, '2001-01-01_000000');
  mkdirSync(planted);
  const forged = join(planted, 'A.openhbam.sqlite');
  const db = new DatabaseSync(forged);
  db.exec('CREATE TABLE forged (v TEXT)');
  db.close();
  writeFileSync(join(planted, 'backup.json'), JSON.stringify({ finished: { 'A.openhbam.sqlite': new Date(w.at - 5).toISOString() }, sha256: { 'A.openhbam.sqlite': await checksum(forged) } }));
  // Newer than the real base copy would be if it were a day older: the planted one is the latest at or before `at`.
  const before = readFileSync(join(w.folder, 'A.openhbam.sqlite'));
  await assert.rejects(restoreAt(w.folder, w.dest, w.at, 'A', KEY), /no signature/i);
  assert.ok(readFileSync(join(w.folder, 'A.openhbam.sqlite')).equals(before), 'the live file is untouched');
});

test('signed set: a plain log put among the encrypted ones is not replayed, and a sealed log is bound to its time and its database', async (t) => {
  const w = await timeline(t, KEY);
  const dir = join(w.set, 'progressive', 'A');
  const forged = join(w.root, 'forged.sqlite');
  const db = new DatabaseSync(forged);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE forged (v TEXT); INSERT INTO forged VALUES (1)');
  const wal = readFileSync(forged + '-wal');
  db.close();
  // A plain log, newer than the real ones.
  const { encodeRecord, startLog, writeLog, logReader, logRecords } = await import('../src/logs.ts');
  const plain = join(dir, '9999-12-31_235959.000.log');
  const w1 = startLog(plain);
  writeLog(w1, { at: w.at - 1, seq: 0, data: wal });
  assert.ok(encodeRecord);
  await assert.rejects(restoreAt(w.folder, w.dest, w.at, 'A', KEY), /not encrypted/);
  rmSync(plain);
  // The record's time is authenticated: a sealed record with another time in its header does not open.
  const sealed = join(w.root, 'sealed.log.enc');
  const w2 = startLog(sealed, KEY, 'A');
  writeLog(w2, { at: 1000, seq: 0, data: Buffer.from('x') });
  const [rec] = logRecords(sealed);
  const read = await logReader(sealed, KEY, 'A');
  assert.equal(read(rec).toString(), 'x');
  assert.throws(() => read({ ...rec, at: 2000 }), /damaged|wrong passphrase/, 'a changed time');
  const other = await logReader(sealed, KEY, 'B');
  assert.throws(() => other(rec), /damaged|wrong passphrase/, 'the same log read as another database\'s');
});

test('a signature from another set does not stand in for a manifest with its checksums or times emptied', async (t) => {
  const w = await world(t, KEY);
  const info = manifest(w.set);
  for (const [what, change] of [
    ['no checksums', (i: Record<string, any>) => { i.sha256 = null; }],
    ['checksums missing', (i: Record<string, any>) => { delete i.sha256; }],
    ['an empty list', (i: Record<string, any>) => { i.sha256 = {}; }],
    ['times false', (i: Record<string, any>) => { i.finished = false; }],
    ['a container entry without a checksum', (i: Record<string, any>) => { i.external = { 'Files/A/x': {} }; }],
  ] as [string, (i: Record<string, any>) => void][]) {
    const forged = JSON.parse(JSON.stringify(info));
    change(forged);
    writeManifest(w.set, forged);
    await refused(w, /signature|checksum|list of|inventory/i, what);
  }
});

test('the next backup does not carry a tampered container-file entry into a freshly signed set', async (t) => {
  const w = await world(t, KEY, { external: true });
  const { encryptFile } = await import('../src/encrypt.ts');
  const rel = Object.keys(manifest(w.set).external)[0];
  const copy = join(w.set, ...rel.split('/')) + '.enc';
  // Someone replaces the copy with an encrypted one of other text (they know the passphrase here: the strongest case for the check
  // that matters, the signature on the set the next backup would reuse) and rewrites its checksum and the signature fields.
  const other = join(w.root, 'other.txt');
  writeFileSync(other, 'TWO');
  rmSync(copy);
  await encryptFile(other, copy, KEY);
  const info = manifest(w.set);
  info.external[rel].sha256 = await checksum(copy);
  writeManifest(w.set, info);
  const next = (await backupFolder(w.folder, join(w.root, 'dest'), 0, KEY)).dir;
  assert.notEqual(next, w.set);
  rmSync(join(w.folder, 'Files'), { recursive: true });
  await restoreBackup(w.folder, next, undefined, KEY);
  assert.equal(readFileSync(join(w.folder, 'Files', 'A', 'Docs', 'one.txt'), 'utf8'), 'external container file', 'restored from the live file as it was, not from the earlier set\'s swapped copy');
});

test('verify-backup --sign signs the one set named (or the only one), never several at once', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const main = join(import.meta.dirname, '..', '..', 'cli', 'src', 'main.ts');
  const w = await world(t, KEY);
  const info = manifest(w.set);
  delete info.auth;
  writeManifest(w.set, info);
  const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, 'verify-backup', w.folder, ...args], { env: { ...process.env, TABULARIUS_BACKUP_KEY: KEY }, encoding: 'utf8' });
  const dest = join(w.root, 'dest');
  const ok = run('--from', dest, '--sign');
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.ok(manifest(w.set).auth, 'the only set was signed');
  // Two sets, and no name: refused.
  await backupFolder(w.folder, dest, 0, KEY);
  const several = run('--from', dest, '--sign');
  assert.equal(several.status, 1);
  assert.match(several.stderr, /name the one backup set/);
});

// Found by the second security review of the signing change: four ways round it that these tests keep shut. Each of them
// fails when the fix it names is taken out.

test('container files: a recorded size and time that were edited to match a changed file do not make the next backup reuse the old copy', async (t) => {
  const w = await world(t, KEY, { external: true });
  const rel = Object.keys(manifest(w.set).external)[0];
  const live = join(w.folder, ...rel.split('/'));
  writeFileSync(live, 'a different container file, of another length');
  const now = statSync(live);
  // Whoever can write the set makes its record of the file say what the live file looks like now (checksum and copy untouched).
  const info = manifest(w.set);
  info.external[rel].size = now.size;
  info.external[rel].mtimeMs = now.mtimeMs;
  writeManifest(w.set, info);
  await refused(w, /signature|doesn't match|does not match|altered/i, 'size and time are signed');
  const next = (await backupFolder(w.folder, join(w.root, 'dest'), 0, KEY)).dir;
  rmSync(join(w.folder, 'Files'), { recursive: true });
  await restoreBackup(w.folder, next, undefined, KEY);
  assert.equal(readFileSync(live, 'utf8'), 'a different container file, of another length', 'the new set holds the file as it is, not the old copy linked in under its name');
});

test('encrypted: a file hosted while point-in-time backups run is not signed into a set whose manifest was edited', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'backup-tamper-add-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'live');
  const dest = join(root, 'dest');
  mkdirSync(folder);
  createStore(join(folder, 'A.openhbam.sqlite'));
  process.env.TABULARIUS_BACKUP_KEY = KEY;
  t.after(() => { delete process.env.TABULARIUS_BACKUP_KEY; });
  const host = new Host(folder);
  const messages: string[] = [];
  const p = await scheduleProgressive(host, { every: 3_600_000, dest, log: (m) => messages.push(m) });
  const set = p.set()!;
  // Someone with write access changes a signed part (when the copy was finished) without the passphrase.
  const info = manifest(set);
  info.finished['A.openhbam.sqlite'] = new Date(0).toISOString();
  writeManifest(set, info);
  // A second file is dropped into the folder; the server copies it into the set and would list it, and sign the manifest.
  createStore(join(folder, 'B.openhbam.sqlite'));
  host.add(join(folder, 'B.openhbam.sqlite'));
  p.run(); // starts following it
  host.get('B')!.applyDesign([{ op: 'createTable', name: 'Notes' }]); // a change to follow
  for (let i = 0; i < 20 && !messages.some((m) => /point-in-time backup of B failed/.test(m)); i++) {
    p.run();
    await sleep(100);
  }
  assert.ok(messages.some((m) => /point-in-time backup of B failed.*signature/.test(m)), messages.join('\n'));
  assert.equal(existsSync(join(set, 'B.openhbam.sqlite.enc')), false, 'the copy that could not be listed is not left in the set');
  assert.equal(manifest(set).sha256['B.openhbam.sqlite'], undefined, 'and is not listed');
  p.stop();
  host.close();
  mkdirSync(join(root, 'elsewhere'));
  await assert.rejects(restoreBackup(join(root, 'elsewhere'), set, undefined, KEY), /signature|does not match/i, 'the edited manifest was not signed over');
});

/** Point-in-time backups with a new log file at every round, so the set has several. */
async function manyLogs(t: { after(fn: () => void): void }): Promise<Timeline & { times: number[] }> {
  const root = mkdtempSync(join(tmpdir(), 'backup-tamper-logs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'live');
  const dest = join(root, 'dest');
  mkdirSync(folder);
  createStore(join(folder, 'A.openhbam.sqlite'));
  process.env.TABULARIUS_BACKUP_KEY = KEY;
  t.after(() => { delete process.env.TABULARIUS_BACKUP_KEY; });
  const host = new Host(folder);
  const p = await scheduleProgressive(host, { every: 1, dest });
  await sleep(20);
  const times: number[] = [];
  for (const table of ['First', 'Second', 'Third']) {
    host.get('A')!.applyDesign([{ op: 'createTable', name: table }]);
    await sleep(20);
    p.run();
    await sleep(20);
    times.push(Date.now());
    await sleep(20);
  }
  p.stop();
  host.close();
  const set = join(dest, readdirSync(dest).filter((n) => /^\d{4}-/.test(n)).sort().at(-1)!);
  const logs = readdirSync(join(set, 'progressive', 'A')).sort().map((f) => join(set, 'progressive', 'A', f));
  return { root, folder, dest, set, at: times.at(-1)!, logs, key: KEY, times };
}

const tablesAfter = (folder: string) => {
  const s = new Store(join(folder, 'A.openhbam.sqlite'), 'A');
  try { return s.schema.tables.map((x) => x.name).sort(); } finally { s.close(); }
};

test('encrypted: the saved logs are counted in the signature, so removing the last log or cutting a file at a record is refused, not restored to an earlier time', async (t) => {
  const w = await manyLogs(t);
  assert.ok(w.logs.length >= 3, `a log file for each round: ${w.logs.length}`);
  assert.ok(manifest(w.set).logs.A.n >= 3, 'the manifest says how many logs were saved');
  // The control: every log is there.
  await restoreAt(w.folder, w.dest, w.at, 'A', KEY);
  assert.deepEqual(tablesAfter(w.folder).filter((n) => ['First', 'Second', 'Third'].includes(n)), ['First', 'Second', 'Third']);
  const before = readFileSync(join(w.folder, 'A.openhbam.sqlite'));
  const last = w.logs.at(-1)!;
  const original = readFileSync(last);
  rmSync(last);
  await assert.rejects(restoreAt(w.folder, w.dest, w.at, 'A', KEY), /incomplete|recorded/i, 'the last log removed');
  assert.ok(readFileSync(join(w.folder, 'A.openhbam.sqlite')).equals(before), 'the live file is untouched');
  // A log file cut after a whole record is a valid file that saved less.
  const { logRecords } = await import('../src/logs.ts');
  const first = w.logs[0];
  const firstBytes = readFileSync(first);
  const records = logRecords(first);
  writeFileSync(last, original);
  if (records.length > 1) {
    writeFileSync(first, firstBytes.subarray(0, records[records.length - 1].offset - 16));
    await assert.rejects(restoreAt(w.folder, w.dest, w.at, 'A', KEY), /incomplete|recorded/i, 'a file cut at a record boundary');
    writeFileSync(first, firstBytes);
  }
  // One log file replaced by a copy of another: every record is genuine, and the set is not what was saved.
  writeFileSync(w.logs[1], firstBytes);
  await assert.rejects(restoreAt(w.folder, w.dest, w.at, 'A', KEY), /not the ones|recorded|damaged/i, 'a log file replaced by another');
  writeFileSync(w.logs[1], readFileSync(w.logs[1]));
});

test('encrypted: a genuine sealed log that the manifest does not list is not replayed (it may be left by a crash, or planted by someone who has the passphrase)', async (t) => {
  const w = await manyLogs(t);
  const { startLog, writeLog } = await import('../src/logs.ts');
  const forged = join(w.root, 'forged.sqlite');
  const db = new DatabaseSync(forged);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE forged (v TEXT); INSERT INTO forged VALUES (1)');
  const wal = readFileSync(forged + '-wal');
  db.close();
  const planted = join(w.set, 'progressive', 'A', '9999-12-31_235959.000.log.enc');
  const writer = startLog(planted, KEY, 'A');
  writeLog(writer, { at: w.at - 1, seq: 0, data: wal });
  // The planted file is the latest record there is, and would be the point restored to; it is neither replayed nor refused.
  const done = await restoreAt(w.folder, w.dest, w.at, 'A', KEY);
  assert.equal(done.length, 1);
  assert.ok(done[0].time < w.at, 'the restored point is the last logged change, not the planted record');
  const check = new DatabaseSync(join(w.folder, 'A.openhbam.sqlite'), { readOnly: true });
  try { assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'forged'").get()!.n, 0, 'the planted log was not replayed'); } finally { check.close(); }
});

test('verify-backup --sign counts the logs a set holds into the signature it makes, so a log removed afterwards is noticed', async (t) => {
  const w = await manyLogs(t);
  const info = manifest(w.set);
  const counted = info.logs;
  delete info.auth;
  delete info.logs;
  writeManifest(w.set, info);
  const signed = await verifySet(w.set, KEY, { sign: true });
  assert.equal(signed.ok, true);
  assert.deepEqual(manifest(w.set).logs, counted, 'the same count and chain as the server saved');
  await restoreAt(w.folder, w.dest, w.at, 'A', KEY);
  rmSync(w.logs.at(-1)!);
  await assert.rejects(restoreAt(w.folder, w.dest, w.at, 'A', KEY), /incomplete|recorded/i);
});

/** A container file nobody backed up, put in the set with the manifest made to list it: what someone with write access to the set would do between the check and the use. */
function plantContainerFile(set: string): void {
  const dir = join(set, 'Files', 'A', 'Docs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'planted.txt'), 'planted');
  const info = manifest(set);
  info.external = { ...info.external, 'Files/A/Docs/planted.txt': { size: 7, mtimeMs: 1, sha256: createHash('sha256').update('planted').digest('hex') } };
  writeManifest(set, info);
}

test('encrypted: a point-in-time restore uses the container files of the manifest it checked, not a second read of it', async (t) => {
  // The manifest is changed after the restore has checked it (the setter stands in for a second process).
  const w = await timeline(t, KEY);
  const point = restorePoint(w.dest, 'A.openhbam.sqlite', w.at)!;
  const target = join(w.folder, 'A.openhbam.sqlite');
  // The planted file is not in the manifest that was checked, so the restore refuses the set and puts nothing back.
  await assert.rejects(restorePointTo({ copy: point.copy, get logs() { plantContainerFile(w.set); return point.logs; } }, target, KEY), /absent from backup\.json external manifest/);
  assert.equal(existsSync(join(w.folder, 'Files', 'A', 'Docs', 'planted.txt')), false, 'restorePointTo');
  const again = await timeline(t, KEY);
  await assert.rejects(restoreAt(again.folder, again.dest, again.at, 'A', KEY, { get signal() { plantContainerFile(again.set); return undefined; } } as never), /absent from backup\.json external manifest/);
  assert.equal(existsSync(join(again.folder, 'Files', 'A', 'Docs', 'planted.txt')), false, 'restoreAt');
});

// Follow-ups from the second review of the signing change. As above, each of these fails when the check it names is taken out.

test('encrypted: every signed part is signed on its own (a log count or chain, a container size, a container time)', async (t) => {
  const w = await manyLogs(t);
  const good = manifest(w.set);
  const edits: [string, (i: any) => void][] = [
    ['the count of saved logs', (i) => { i.logs.A.n -= 1; }],
    ['the chain over the saved logs', (i) => { i.logs.A.head = '0'.repeat(64); }],
    ['a database\'s logs removed from the list', (i) => { delete i.logs.A; }],
  ];
  for (const [what, edit] of edits) {
    const info = structuredClone(good);
    edit(info);
    writeManifest(w.set, info);
    await assert.rejects(restoreAt(w.folder, w.dest, w.at, 'A', KEY), /signature|does not match/i, what);
  }
  const x = await world(t, KEY, { external: true });
  const rel = Object.keys(manifest(x.set).external)[0];
  const original = manifest(x.set);
  for (const [what, edit] of [
    ['only the size', (i: any) => { i.external[rel].size += 1; }],
    ['only the time', (i: any) => { i.external[rel].mtimeMs += 1000; }],
  ] as [string, (i: any) => void][]) {
    const info = structuredClone(original);
    edit(info);
    writeManifest(x.set, info);
    await refused(x, /signature|doesn't match|does not match|altered/i, what);
  }
});

test('encrypted: a set signed by the earlier form of signature counts as unsigned: said so, restorable on request, and replaced by signing again', async (t) => {
  const w = await world(t, KEY);
  const info = manifest(w.set);
  info.auth.v = 1;
  writeManifest(w.set, info);
  await refused(w, /earlier version/i, 'an older signature is not trusted');
  assert.deepEqual((await restoreBackup(w.folder, w.set, undefined, KEY, { acceptUnsigned: true })).sort(), w.names);
  const check = await verifySet(w.set, KEY);
  assert.equal(check.unsigned, true);
  const signed = await verifySet(w.set, KEY, { sign: true });
  assert.equal(signed.ok, true);
  assert.equal(manifest(w.set).auth.v, 2);
  assert.deepEqual((await restoreBackup(w.folder, w.set, undefined, KEY)).sort(), w.names);
});

/** Point-in-time backups following one set, with a second full backup of the same folder to switch to. */
async function twoSets(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'backup-tamper-follow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'live');
  const dest = join(root, 'dest');
  mkdirSync(folder);
  createStore(join(folder, 'A.openhbam.sqlite'));
  process.env.TABULARIUS_BACKUP_KEY = KEY;
  t.after(() => { delete process.env.TABULARIUS_BACKUP_KEY; });
  const host = new Host(folder);
  const messages: string[] = [];
  const p = await scheduleProgressive(host, { every: 3_600_000, dest, log: (m) => messages.push(m) });
  t.after(() => { p.stop(); host.close(); });
  const second = (await backupFolder(folder, dest, 0, KEY)).dir;
  const change = async (table: string) => {
    host.get('A')!.applyDesign([{ op: 'createTable', name: table }]);
    await sleep(20);
    p.run();
    await sleep(20);
  };
  return { root, folder, dest, host, p, second, messages, change };
}

test('encrypted: point-in-time backups do not start in a set whose manifest was edited, or that has copies but no signature', async (t) => {
  for (const [what, damage, why] of [
    ['edited', (i: any) => { i.finished['A.openhbam.sqlite'] = new Date(0).toISOString(); }, /signature|does not match/],
    ['unsigned', (i: any) => { delete i.auth; }, /no signature/],
  ] as [string, (i: any) => void, RegExp][]) {
    const w = await twoSets(t);
    const info = manifest(w.second);
    damage(info);
    writeManifest(w.second, info);
    w.p.follow(w.second);
    assert.ok(w.messages.some((m) => /not saved/.test(m) && why.test(m)), `${what}: ${w.messages.join('\n')}`);
    await w.change('Notes');
    assert.equal(existsSync(join(w.second, 'progressive')), false, `${what}: no log was written into a set that could not list it`);
  }
});

test('encrypted: a manifest that loses its signature while point-in-time backups follow its set is not signed again', async (t) => {
  const w = await world(t, KEY);
  const { openAmenderSync } = await import('../src/backup-auth.ts');
  const amender = openAmenderSync(w.set, KEY);
  amender.amend((i) => { i.finished = { ...i.finished }; });
  const info = manifest(w.set);
  delete info.auth;
  writeManifest(w.set, info);
  assert.throws(() => amender.amend(() => {}), /lost its signature/);
  assert.equal(manifest(w.set).auth, undefined, 'and was not signed over');
  // A manifest that never listed anything is the one case where a set starts its own signature, and it takes more than a missing signature to look like one.
  const empty = mkdtempSync(join(tmpdir(), 'backup-tamper-empty-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  writeFileSync(join(empty, 'backup.json'), JSON.stringify({ finished: { 'A.openhbam.sqlite': new Date(0).toISOString() } }));
  assert.throws(() => openAmenderSync(empty, KEY), /no signature/, 'a manifest that lists a time is not empty');
  const entry = { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) };
  for (const [what, list] of [['a container file', { external: { 'Files/A/x/y': entry } }], ['a saved log', { logs: { A: { n: 1, head: 'b'.repeat(64) } } }], ['a copy\'s checksum', { sha256: { 'A.openhbam.sqlite': 'c'.repeat(64) } }]] as [string, object][]) {
    writeFileSync(join(empty, 'backup.json'), JSON.stringify(list));
    assert.throws(() => openAmenderSync(empty, KEY), /no signature/, `a manifest that lists ${what} is not empty`);
  }
  writeFileSync(join(empty, 'backup.json'), JSON.stringify({}));
  openAmenderSync(empty, KEY).amend((i) => { i.sha256 = {}; i.finished = {}; });
  assert.ok(manifest(empty).auth.mac);
});

test('encrypted: the next backup copies a container file again when the set it would link it from does not check out', async (t) => {
  const w = await world(t, KEY, { external: true });
  const dest = join(w.root, 'dest');
  const rel = Object.keys(manifest(w.set).external)[0];
  const old = join(w.set, ...rel.split('/')) + '.enc';
  // The control: an untouched previous set is linked to.
  const linked = (await backupFolder(w.folder, dest, 0, KEY)).dir;
  assert.equal(statSync(join(linked, ...rel.split('/')) + '.enc').ino, statSync(old).ino, 'a container file that did not change is linked to the previous copy');
  // The previous set's manifest was edited (a part that has nothing to do with the container file): none of it is reused.
  const info = manifest(linked);
  info.finished[w.names[0]] = new Date(0).toISOString();
  writeManifest(linked, info);
  const next = (await backupFolder(w.folder, dest, 0, KEY)).dir;
  assert.notEqual(statSync(join(next, ...rel.split('/')) + '.enc').ino, statSync(join(linked, ...rel.split('/')) + '.enc').ino, 'copied again, not linked');
  // A previous set that has lost its signature is not reused either.
  const stripped = manifest(next);
  delete stripped.auth;
  writeManifest(next, stripped);
  const after = (await backupFolder(w.folder, dest, 0, KEY)).dir;
  assert.notEqual(statSync(join(after, ...rel.split('/')) + '.enc').ino, statSync(join(next, ...rel.split('/')) + '.enc').ino, 'a set with no signature is not linked from');
});

test('a manifest that was checked but has no checksum for a copy does not restore it', async (t) => {
  const { copyVerifiedDatabase } = await import('../src/backup-verify.ts');
  const w = await world(t, '');
  const target = join(w.root, 'out.sqlite');
  await assert.rejects(copyVerifiedDatabase(join(w.set, w.names[0]), target, undefined, undefined, {}), /missing checksum/);
  await copyVerifiedDatabase(join(w.set, w.names[0]), target, undefined, undefined, { [w.names[0]]: manifest(w.set).sha256[w.names[0]] });
  assert.ok(existsSync(target));
});

for (const [label, key] of modes) {
  test(`${label}: a point-in-time restore gives the file the permissions of the one it replaces, not those of the backup`, { skip: process.platform === 'win32' }, async (t) => {
    const w = await timeline(t, key);
    const live = join(w.folder, 'A.openhbam.sqlite');
    chmodSync(live, 0o600);
    chmodSync(join(w.set, 'A.openhbam.sqlite' + (key ? '.enc' : '')), 0o666);
    await restoreAt(w.folder, w.dest, w.at, 'A', key || undefined);
    assert.equal(statSync(live).mode & 0o777, 0o600);
  });
}
