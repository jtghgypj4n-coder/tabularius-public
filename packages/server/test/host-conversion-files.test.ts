import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { conversionTemp, stageConversionSource, completeConversionSource, finishConversion, publishConversion, sweepConversionTemps } from '../src/conversion-files.ts';
import { Host, STORE_EXT } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';
import { DatabaseSync } from 'node:sqlite';

const error = (code: string) => Object.assign(new Error(code), { code });

for (const code of ['EPERM', 'EOPNOTSUPP', 'ENOTSUP', 'ENOSYS', 'EXDEV']) {
  test(`conversion publication falls back on ${code} without clobbering another store`, (t) => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-publish-'));
    try {
      const temp = join(dir, 'temp');
      const store = join(dir, 'result');
      fs.writeFileSync(temp, 'complete store');
      t.mock.method(fs, 'linkSync', () => { throw error(code); });
      const rename = t.mock.method(fs, 'renameSync');
      assert.equal(publishConversion(temp, store), true);
      assert.equal(rename.mock.callCount(), 1);
      assert.equal(fs.readFileSync(store, 'utf8'), 'complete store');
      assert.equal(fs.existsSync(temp), false);
      fs.writeFileSync(temp, 'losing conversion');
      assert.equal(publishConversion(temp, store), false);
      assert.equal(rename.mock.callCount(), 1);
      assert.equal(fs.readFileSync(store, 'utf8'), 'complete store');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('a failed fallback rename removes its reservation, and unrelated link failures propagate', (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-publish-fail-'));
  try {
    const temp = join(dir, 'temp');
    const store = join(dir, 'result');
    fs.writeFileSync(temp, 'complete store');
    const link = t.mock.method(fs, 'linkSync', () => { throw error('EIO'); });
    assert.throws(() => publishConversion(temp, store), { code: 'EIO' });
    link.mock.mockImplementation(() => { throw error('EPERM'); });
    t.mock.method(fs, 'renameSync', () => { throw error('EACCES'); });
    assert.throws(() => publishConversion(temp, store), { code: 'EACCES' });
    assert.equal(fs.existsSync(store), false);
    assert.equal(fs.readFileSync(temp, 'utf8'), 'complete store');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an interrupted workspace is rediscovered with all SQLite sidecars; live converters stay isolated', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-resume-workspace-'));
  try {
    const src = join(dir, 'upload.part');
    const store = join(dir, 'Resumed' + STORE_EXT);
    fs.writeFileSync(src, 'source');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      import { conversionTemp } from ${JSON.stringify(new URL('../src/conversion-files.ts', import.meta.url).href)};
      const temp = conversionTemp(${JSON.stringify(store)}, ${JSON.stringify(src)});
      for (const suffix of ['', '-wal', '-shm', '-journal']) fs.writeFileSync(temp + suffix, 'checkpoint' + suffix);
      console.log(temp);
    `], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const abandoned = child.stdout.trim();
    const expired = dirname(abandoned).slice(0, -16) + '0000000000000000';
    fs.cpSync(dirname(abandoned), expired, { recursive: true });
    fs.utimesSync(expired, 0, 0);
    sweepConversionTemps(dir);
    assert.equal(fs.existsSync(expired), false, 'expired workspaces and their sidecars are swept');
    assert.ok(fs.existsSync(abandoned), 'a recent interrupted conversion is retained');
    const resumed = conversionTemp(store, src);
    assert.notEqual(resumed, abandoned);
    assert.equal(fs.existsSync(dirname(abandoned)), false);
    for (const suffix of ['', '-wal', '-shm', '-journal']) assert.equal(fs.readFileSync(resumed + suffix, 'utf8'), 'checkpoint' + suffix);
    const concurrent = conversionTemp(store, src);
    assert.notEqual(concurrent, resumed);
    fs.utimesSync(dirname(resumed), 0, 0);
    sweepConversionTemps(dir);
    assert.ok(fs.existsSync(resumed), 'even old work belonging to a live converter is preserved');
    finishConversion(concurrent);
    assert.ok(fs.existsSync(resumed), 'another operation cannot remove this operation’s workspace');
    finishConversion(resumed);
    assert.deepEqual(fs.readdirSync(dir), ['upload.part']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('host startup and conversion completion sweep stale temps, including legacy SQLite sidecars', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-temp-sweep-'));
  const stale = join(dir, 'Old' + STORE_EXT + '.tmp');
  const seed = () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      fs.writeFileSync(stale + suffix, 'old partial');
      fs.utimesSync(stale + suffix, 0, 0);
    }
  };
  let host: Host | undefined;
  try {
    seed();
    host = new Host(dir);
    assert.equal(fs.readdirSync(dir).some((x) => x.includes('.tmp')), false);
    seed();
    const src = join(dir, 'source.part');
    fs.writeFileSync(src, 'source');
    finishConversion(conversionTemp(join(dir, 'New' + STORE_EXT), src));
    assert.equal(fs.readdirSync(dir).some((x) => x.includes('.tmp')), false);
  } finally {
    await host?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const operation of ['upload', 'unlock']) {
  test(`concurrent ${operation} operations use isolated temps and cannot overwrite the winner`, async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-operation-race-'));
    const first = new Host(dir);
    const second = new Host(dir);
    const destinations: string[] = [];
    const release: (() => void)[] = [];
    const pending: Promise<unknown>[] = [];
    try {
      const sources = operation === 'unlock' ? [join(dir, 'Same.fmp12'), join(dir, 'Same.fmp12')] : [join(dir, 'one.part'), join(dir, 'two.part')];
      for (const src of sources) fs.writeFileSync(src, 'source');
      for (const [index, host] of [first, second].entries()) {
        (host as unknown as { convert: (src: string, dest: string) => Promise<{ tables: number; records: number }> }).convert = async (_src, dest) => {
          destinations.push(dest);
          createStore(dest);
          const db = new DatabaseSync(dest);
          db.exec(`CREATE TABLE winner (id INTEGER); INSERT INTO winner VALUES (${index})`);
          db.close();
          await new Promise<void>((resolve) => { release[index] = resolve; });
          return { tables: 1, records: 1 };
        };
        if (operation === 'unlock') host.locked.set('Same.fmp12', { size: 6 });
        const result = operation === 'unlock'
          ? host.unlock('Same.fmp12', 'secret', () => {}, { checked: true })
          : host.hostUpload(sources[index], 'Same');
        // Attach the rejection handler before releasing either conversion.
        pending.push(result.then((value) => value, (error: unknown) => error));
      }
      assert.equal(destinations.length, 2);
      assert.notEqual(destinations[0], destinations[1]);
      assert.ok(destinations.every((dest) => dest !== join(dir, 'Same' + STORE_EXT + '.tmp')));
      release[0]();
      assert.ok(!((await pending[0]) instanceof Error));
      assert.ok(fs.existsSync(destinations[1]), 'winner cleanup leaves the active competitor alone');
      release[1]();
      assert.match(String(await pending[1]), /already hosted/);
      const db = new DatabaseSync(join(dir, 'Same' + STORE_EXT), { readOnly: true });
      assert.equal(db.prepare('SELECT id FROM winner').get()!.id, 0);
      db.close();
      assert.equal(fs.readdirSync(dir).some((entry) => entry.includes('.tmp')), false);
      if (operation === 'upload') assert.ok(fs.existsSync(sources[1]), 'losing upload keeps its source');
    } finally {
      for (const done of release) done?.();
      await Promise.allSettled(pending);
      await first.close();
      await second.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
for (const background of [false, true]) {
  test(`${background ? 'folder worker' : 'startup'} resumes an interrupted import checkpoint`, { skip: !fs.existsSync(fixture), timeout: 120_000 }, async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-host-resume-'));
    let host: Host | undefined;
    try {
      const src = join(dir, 'Charts.fmp12');
      const store = join(dir, 'Charts' + STORE_EXT);
      fs.copyFileSync(fixture, src);
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { DatabaseSync } from 'node:sqlite';
        import { conversionTemp } from ${JSON.stringify(new URL('../src/conversion-files.ts', import.meta.url).href)};
        import { importFmp12 } from ${JSON.stringify(new URL('../../store/src/index.ts', import.meta.url).href)};
        const temp = conversionTemp(${JSON.stringify(store)}, ${JSON.stringify(src)});
        let calls = 0;
        try { importFmp12(${JSON.stringify(src)}, temp, () => { if (++calls === 2) throw new Error('interrupted'); }); }
        catch (e) { if (e.message !== 'interrupted') throw e; }
        if (calls !== 2) throw new Error('did not interrupt conversion');
        const db = new DatabaseSync(temp);
        db.exec('CREATE TABLE resume_marker (id INTEGER); INSERT INTO resume_marker VALUES (42)');
        db.close();
      `], { encoding: 'utf8', timeout: 60_000 });
      assert.equal(child.status, 0, child.stderr);
      host = new Host(dir, () => {}, { background });
      if (background) assert.equal(await host.scan(), 'Charts');
      const hosted = host.get('Charts')!;
      assert.ok(hosted);
      assert.equal(hosted.sql.prepare('SELECT id FROM resume_marker').get()!.id, 42, 'restarting the import would discard the checkpoint marker');
      assert.equal(fs.readdirSync(dir).some((entry) => entry.includes('.tmp')), false);
    } finally {
      await host?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

const identityOf = (src: string) => {
  const stat = fs.statSync(src);
  return createHash('sha256').update(JSON.stringify([resolve(src), stat.size, stat.mtimeMs])).digest('hex').slice(0, 24);
};

test('a workspace named with this PID that this process did not create is abandoned, as after a PID 1 restart', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-own-pid-'));
  try {
    const src = join(dir, 'upload.part');
    const store = join(dir, 'Restarted' + STORE_EXT);
    fs.writeFileSync(src, 'source');
    const predecessor = `${store}.tmp-${identityOf(src)}-${process.pid}-${'a'.repeat(16)}`;
    fs.mkdirSync(predecessor);
    fs.writeFileSync(join(predecessor, 'store.sqlite'), 'checkpoint');
    const resumed = conversionTemp(store, src);
    assert.equal(fs.existsSync(predecessor), false, 'the crashed predecessor’s workspace is claimed');
    assert.equal(fs.readFileSync(resumed, 'utf8'), 'checkpoint');
    const concurrent = conversionTemp(store, src);
    assert.notEqual(dirname(concurrent), dirname(resumed), 'a workspace this process created is still its own');
    finishConversion(concurrent);
    finishConversion(resumed);
    const expired = `${store}.tmp-${identityOf(src)}-${process.pid}-${'b'.repeat(16)}`;
    fs.mkdirSync(expired);
    fs.utimesSync(expired, 0, 0);
    sweepConversionTemps(dir);
    assert.equal(fs.existsSync(expired), false, 'an expired own-PID workspace this process did not create is swept');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a workspace owned by another live process is neither resumed nor swept', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-other-pid-'));
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'ignore', 'ignore'] });
  try {
    const src = join(dir, 'upload.part');
    const store = join(dir, 'Shared' + STORE_EXT);
    fs.writeFileSync(src, 'source');
    const theirs = `${store}.tmp-${identityOf(src)}-${child.pid}-${'c'.repeat(16)}`;
    fs.mkdirSync(theirs);
    fs.utimesSync(theirs, 0, 0);
    sweepConversionTemps(dir);
    assert.ok(fs.existsSync(theirs), 'old work of a live converter is kept');
    const mine = conversionTemp(store, src);
    assert.ok(fs.existsSync(theirs), 'a live converter’s workspace is not claimed');
    finishConversion(mine);
    assert.ok(fs.existsSync(theirs));
    const exited = new Promise((done) => child.once('exit', done));
    child.kill();
    await exited;
    sweepConversionTemps(dir);
    assert.equal(fs.existsSync(theirs), false, 'once its owner has gone, the expired workspace is swept');
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a 0-byte store left by a crashed fallback publisher is removed, never while a converter for it lives', (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-reservation-'));
  try {
    const src = join(dir, 'Stranded.fmp12');
    const store = join(dir, 'Stranded' + STORE_EXT);
    fs.writeFileSync(src, 'source');
    fs.writeFileSync(store, '');
    const live = conversionTemp(store, src);
    sweepConversionTemps(dir);
    assert.ok(fs.existsSync(store), 'a live publisher’s reservation is kept');
    finishConversion(live);
    assert.equal(fs.existsSync(store), false, 'with no converter left, the reservation is stranded');

    // The crashed publisher's finished workspace survives the sweep, so the next conversion resumes it.
    fs.writeFileSync(store, '');
    const crashed = `${store}.tmp-${identityOf(src)}-${process.pid}-${'d'.repeat(16)}`;
    fs.mkdirSync(crashed);
    fs.writeFileSync(join(crashed, 'store.sqlite'), 'complete store');
    sweepConversionTemps(dir);
    assert.equal(fs.existsSync(store), false);
    assert.ok(fs.existsSync(crashed), 'the interrupted workspace is kept to resume');
    const resumed = conversionTemp(store, src);
    assert.equal(fs.readFileSync(resumed, 'utf8'), 'complete store');

    // A publisher that finds a stranded reservation takes it; one held by a live competitor it leaves alone.
    t.mock.method(fs, 'linkSync', () => { throw error('EPERM'); });
    fs.writeFileSync(store, '');
    const competitor = conversionTemp(store, join(dir, 'Stranded.fmp12'));
    fs.writeFileSync(competitor, 'competitor');
    assert.equal(publishConversion(resumed, store), false);
    assert.equal(fs.statSync(store).size, 0, 'a live competitor’s reservation is not removed');
    finishConversion(competitor);
    fs.writeFileSync(store, '');
    assert.equal(publishConversion(resumed, store), true);
    assert.equal(fs.readFileSync(store, 'utf8'), 'complete store');
    finishConversion(resumed);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an entry the startup sweep cannot remove is logged and skipped', async (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-sweep-error-'));
  let host: Host | undefined;
  try {
    const stuck = join(dir, 'Stuck' + STORE_EXT + '.tmp');
    const stale = join(dir, 'Stale' + STORE_EXT + '.tmp');
    for (const path of [stuck, stale]) {
      fs.writeFileSync(path, 'old partial');
      fs.utimesSync(path, 0, 0);
    }
    const rm = fs.rmSync;
    t.mock.method(fs, 'rmSync', (path: fs.PathLike, options?: fs.RmOptions) => {
      if (path === stuck) throw error('EACCES');
      rm(path, options);
    });
    const lines: string[] = [];
    host = new Host(dir, (line) => lines.push(line));
    assert.ok(lines.some((line) => line.includes(`couldn't clean up ${basename(stuck)}`)), lines.join('\n'));
    assert.equal(fs.existsSync(stale), false, 'the other entries are still swept');
  } finally {
    t.mock.restoreAll();
    await host?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('startup reconverts a store left as an empty reservation', { skip: !fs.existsSync(fixture), timeout: 120_000 }, async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-host-reservation-'));
  let host: Host | undefined;
  try {
    fs.copyFileSync(fixture, join(dir, 'Charts.fmp12'));
    fs.writeFileSync(join(dir, 'Charts' + STORE_EXT), '');
    host = new Host(dir, () => {});
    assert.ok(host.get('Charts'), 'an empty reservation would fail with "no such table: _fm_meta"');
    assert.ok(fs.statSync(join(dir, 'Charts' + STORE_EXT)).size > 0);
  } finally {
    await host?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const phase of ['stage', 'complete']) test(`conversion source ${phase} repairs an existing short copy without hard links`, (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-source-repair-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const upload = join(dir, 'upload.part');
  const bytes = Buffer.from('the entire uploaded source');
  fs.writeFileSync(upload, bytes);
  const store = join(dir, 'A' + STORE_EXT);
  const temp = conversionTemp(store, upload);
  fs.writeFileSync(temp, 'complete store');
  t.mock.method(fs, 'linkSync', () => { throw error('EPERM'); });
  const staged = join(dirname(temp), 'source.fmp12');
  if (phase === 'stage') fs.writeFileSync(staged, bytes.subarray(0, 5));
  stageConversionSource(temp, upload);
  assert.equal(fs.statSync(staged).size, bytes.length);
  assert.deepEqual(fs.readFileSync(staged), bytes);
  assert.ok(publishConversion(temp, store));
  const target = join(dir, 'A.fmp12');
  if (phase === 'complete') fs.writeFileSync(target, bytes.subarray(0, 5));
  completeConversionSource(temp, store);
  assert.equal(fs.statSync(target).size, bytes.length);
  assert.deepEqual(fs.readFileSync(target), bytes);
  finishConversion(temp);
});
