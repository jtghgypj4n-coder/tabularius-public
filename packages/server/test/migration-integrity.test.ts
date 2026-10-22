import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateFms } from '../src/fms-migrate.ts';
import { claimFolder, sweepCrashLeftovers } from '../src/backup.ts';

const fixture = join(import.meta.dirname, '../../../fixtures/fmp12/Charts.fmp12');
const migrationUrl = new URL('../src/fms-migrate.ts', import.meta.url).href;
const crashUrl = new URL('../../store/src/crash-point.ts', import.meta.url).href;

function setup(t: TestContext, needsFixture = true) {
  const root = fs.mkdtempSync(join(tmpdir(), 'migration-integrity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const dest = join(root, 'dest');
  fs.mkdirSync(join(source, 'RC_Data_FMS/Charts'), { recursive: true });
  fs.mkdirSync(dest);
  if (needsFixture) fs.copyFileSync(fixture, join(source, 'Charts.fmp12'));
  else fs.writeFileSync(join(source, 'Charts.fmp12'), 'invalid source for refusal tests');
  fs.writeFileSync(join(source, 'RC_Data_FMS/Charts/data'), 'complete external data');
  fs.writeFileSync(join(dest, 'keep'), 'unrelated');
  const exp = { databases: [{ filename: 'Charts.fmp12', folder: `filelinux:${source}/` }] };
  const migrate = () => migrateFms(exp, dest);
  const original = fs.readFileSync(join(source, 'Charts.fmp12'));
  const assertUnpublished = () => {
    assert.equal(fs.existsSync(join(dest, 'Charts.fmp12')), false);
    assert.equal(fs.existsSync(join(dest, 'RC_Data_FMS/Charts')), false);
    assert.equal(fs.readFileSync(join(dest, 'keep'), 'utf8'), 'unrelated');
  };
  const assertPublished = () => {
    assert.deepEqual(fs.readFileSync(join(dest, 'Charts.fmp12')), original);
    assert.equal(fs.readFileSync(join(dest, 'RC_Data_FMS/Charts/data'), 'utf8'), 'complete external data');
    assert.equal(fs.readFileSync(join(dest, 'keep'), 'utf8'), 'unrelated');
  };
  return { source, dest, exp, migrate, original, assertUnpublished, assertPublished };
}

for (const fault of ['ENOSPC', 'truncated copy', 'corrupted copy', 'source writer'] as const) {
  test(`file migration rejects ${fault}, publishes nothing, and can be retried`, { skip: !fs.existsSync(fixture) }, (t) => {
    const s = setup(t);
    const copy = fs.copyFileSync;
    t.mock.method(fs, 'copyFileSync', (from: fs.PathLike, to: fs.PathLike, flags?: number) => {
      copy(from, to, flags);
      if (!String(from).endsWith('Charts.fmp12')) return;
      if (fault === 'source writer') {
        const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
          import { writeFileSync } from 'node:fs';
          writeFileSync(${JSON.stringify(join(s.source, 'RC_Data_FMS/Charts/data'))}, 'writer update');
        `], { encoding: 'utf8', timeout: 15_000 });
        assert.equal(child.status, 0, child.stderr || String(child.error));
      }
      else if (fault === 'corrupted copy') {
        const bytes = fs.readFileSync(to); bytes[0] ^= 1; fs.writeFileSync(to, bytes);
      } else fs.truncateSync(to, 8192);
      if (fault === 'ENOSPC') throw Object.assign(new Error('ENOSPC: no space left copying Charts.fmp12'), { code: 'ENOSPC' });
    });
    syncBuiltinESMExports();
    try {
      assert.throws(s.migrate, /Migration.*(ENOSPC|checksum|changed)/);
      s.assertUnpublished();
      assert.equal(fs.existsSync(join(s.dest, 'RC_Data_FMS')), false, 'refused migration removes its empty parent');
      assert.deepEqual(fs.readFileSync(join(s.source, 'Charts.fmp12')), s.original);
      assert.equal(fs.readFileSync(join(s.source, 'RC_Data_FMS/Charts/data'), 'utf8'), fault === 'source writer' ? 'writer update' : 'complete external data');
      assert.ok(!fs.readdirSync(s.dest, { recursive: true }).some((n) => String(n).includes('.restoring')));
      claimFolder(s.dest)();
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    fs.writeFileSync(join(s.source, 'RC_Data_FMS/Charts/data'), 'complete external data');
    assert.equal(s.migrate().files[0].done, true);
    s.assertPublished();
  });
}

for (const fault of ['truncated', 'corrupted']) {
  test(`migration refuses a ${fault} source file with a useful error`, { skip: !fs.existsSync(fixture) }, (t) => {
    const s = setup(t);
    const path = join(s.source, 'Charts.fmp12');
    if (fault === 'truncated') fs.truncateSync(path, 8192);
    else { const bytes = fs.readFileSync(path); bytes[0] ^= 1; fs.writeFileSync(path, bytes); }
    const damaged = fs.readFileSync(path);
    assert.throws(s.migrate, /Migration.*(block count|magic number)/);
    s.assertUnpublished();
    assert.deepEqual(fs.readFileSync(path), damaged);
  });
}

test('migration preserves an existing container folder and reports the conflict', { skip: !fs.existsSync(fixture) }, (t) => {
  const s = setup(t);
  fs.mkdirSync(join(s.dest, 'RC_Data_FMS/Charts'), { recursive: true });
  fs.writeFileSync(join(s.dest, 'RC_Data_FMS/Charts/data'), 'existing data');
  assert.throws(s.migrate, /container folder already exists/);
  assert.equal(fs.readFileSync(join(s.dest, 'RC_Data_FMS/Charts/data'), 'utf8'), 'existing data');
  assert.equal(fs.existsSync(join(s.dest, 'Charts.fmp12')), false);
});

test('another migration process is refused while the first is copying', { skip: !fs.existsSync(fixture) }, (t) => {
  const s = setup(t);
  const copy = fs.copyFileSync;
  let attempted = false;
  t.mock.method(fs, 'copyFileSync', (from: fs.PathLike, to: fs.PathLike, flags?: number) => {
    if (!attempted) {
      attempted = true;
      const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '--eval', `
        import { migrateFms } from ${JSON.stringify(migrationUrl)};
        try { migrateFms(${JSON.stringify(s.exp)}, ${JSON.stringify(s.dest)}); process.exit(1); }
        catch (error) { if (!/already hosted/.test(error.message)) throw error; }
      `], { encoding: 'utf8', timeout: 15_000 });
      assert.equal(child.status, 0, child.stderr || String(child.error));
    }
    return copy(from, to, flags);
  });
  syncBuiltinESMExports();
  try { s.migrate(); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.ok(attempted);
  s.assertPublished();
  claimFolder(s.dest)();
});

for (const checkpoint of ['mid-write', 'restore:after-journal', 'restore:after-publish', 'restore:after-commit']) {
  test(`migration recovers ${checkpoint} using the existing restore transaction`, { skip: !fs.existsSync(fixture) }, (t) => {
    const s = setup(t);
    const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '--eval', `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { migrateFms } from ${JSON.stringify(migrationUrl)};
      import { armCrashPointForTest } from ${JSON.stringify(crashUrl)};
      if (${JSON.stringify(checkpoint)} === 'mid-write') {
        const copy = fs.copyFileSync;
        fs.copyFileSync = (from, to, flags) => {
          if (String(from).endsWith('Charts.fmp12')) {
            fs.writeFileSync(to, fs.readFileSync(from).subarray(0, 8192));
            process.exit(73);
          }
          return copy(from, to, flags);
        };
        syncBuiltinESMExports();
      } else armCrashPointForTest(${JSON.stringify(checkpoint)});
      migrateFms(${JSON.stringify(s.exp)}, ${JSON.stringify(s.dest)});
    `], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(child.status, 73, child.stderr || String(child.error));
    claimFolder(s.dest)();
    if (checkpoint === 'restore:after-commit') s.assertPublished();
    else s.assertUnpublished();
    s.migrate(); s.assertPublished();
    sweepCrashLeftovers(s.dest, undefined, Date.now() + 2 * 86_400_000);
    assert.ok(!fs.readdirSync(s.dest, { recursive: true }).some((n) => /\.restoring|restore-journal|restore-previous/.test(String(n))));
  });
}

test('migration refuses a symlinked container parent before touching outside staging files', (t) => {
  const s = setup(t, false);
  const outside = join(s.source, 'outside');
  fs.mkdirSync(join(outside, 'Charts.restoring'), { recursive: true });
  fs.writeFileSync(join(outside, 'Charts.restoring/keep'), 'outside staging');
  fs.writeFileSync(join(outside, 'keep'), 'outside live');
  fs.symlinkSync(outside, join(s.dest, 'RC_Data_FMS'));
  assert.throws(s.migrate, /symlink/);
  assert.equal(fs.readFileSync(join(outside, 'Charts.restoring/keep'), 'utf8'), 'outside staging');
  assert.equal(fs.readFileSync(join(outside, 'keep'), 'utf8'), 'outside live');
  assert.deepEqual(fs.readdirSync(outside).sort(), ['Charts.restoring', 'keep']);
  assert.equal(fs.existsSync(join(s.dest, 'Charts.fmp12')), false);
});

test('refused migration removes only the empty parent it created', (t) => {
  const s = setup(t, false);
  assert.throws(s.migrate, /Migration.*failed/);
  s.assertUnpublished();
  assert.equal(fs.existsSync(join(s.dest, 'RC_Data_FMS')), false);
  fs.mkdirSync(join(s.dest, 'RC_Data_FMS'));
  assert.throws(s.migrate, /Migration.*failed/);
  assert.equal(fs.existsSync(join(s.dest, 'RC_Data_FMS')), true, 'preexisting parent is preserved');
});
