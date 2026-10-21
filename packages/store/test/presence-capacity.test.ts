import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const shared of [false, true]) {
  for (const scenario of ['expiry', 'capacity', 'clock', 'workers']) {
    test(`AR-store-security-05: ${shared ? 'shared' : 'memory'} ${scenario}`, () => {
      const source = `
        import assert from 'node:assert/strict';
        import { DatabaseSync } from 'node:sqlite';
        import { RecordLocks, SharedRecordLocks, VIEW_TTL_MS } from ${JSON.stringify(new URL('../src/activity.ts', import.meta.url).href)};
        import { monotonicClock } from ${JSON.stringify(new URL('../src/monotonic.ts', import.meta.url).href)};
        const shared = ${shared};
        const sql = new DatabaseSync(':memory:');
        const locks = shared ? new SharedRecordLocks(sql, 'File', 1) : new RecordLocks(1);
        const retained = () => shared ? sql.prepare('SELECT count(*) AS n FROM viewing').get().n : locks.viewing.size;
        const scenario = ${JSON.stringify(scenario)};
        if (scenario === 'expiry') {
          for (let i = 0; i < 200; i++) locks.view('T', i, 'owner', 'Member', i * VIEW_TTL_MS);
          assert.equal(retained(), 1);
          assert.equal(locks.view('T', 199, 'owner', 'Member', 200 * VIEW_TTL_MS), true);
          assert.equal(retained(), 1);
        } else if (scenario === 'capacity') {
          let refused = false;
          for (let i = 0; i < 512; i++) {
            try { locks.view('T', i, 'owner', 'Member', 100); }
            catch (e) { assert.equal(e.code, 812); refused = true; break; }
          }
          assert.equal(refused, true);
          const before = locks.viewers(100);
          assert.equal(before.length, 128);
          assert.throws(() => locks.view('Other', 1000, 'owner', 'Member', 100), { code: 812 });
          assert.deepEqual(locks.viewers(100), before);
          assert.equal(locks.view('T', 0, 'owner', 'Member', 101), false);
          assert.equal(locks.view('T', 1000, 'second', 'Member', 100), true);
          assert.equal(locks.leave('T', 0, 'owner'), true);
          assert.equal(locks.view('T', 1000, 'owner', 'Member', 100), true);
          locks.leaveOwner('owner');
          assert.equal(locks.view('T', 1001, 'owner', 'Member', 100), true);
          assert.equal(locks.acquire('T', 1, 'owner', 'Member', 100).ok, true);
          if (shared) {
            sql.exec("CREATE TRIGGER refuse_view BEFORE INSERT ON viewing WHEN new.record_id = 9000 BEGIN SELECT RAISE(ABORT, 'test refusal'); END");
            const rows = sql.prepare('SELECT * FROM viewing').all();
            assert.throws(() => locks.view('T', 9000, 'owner', 'Member', 100 + VIEW_TTL_MS), /test refusal/);
            assert.deepEqual(sql.prepare('SELECT * FROM viewing').all(), rows);
          }
        } else if (scenario === 'clock') {
          let now = 100;
          const wall = Date.now;
          Date.now = () => now;
          monotonicClock.now = () => 100;
          locks.view('T', 1, 'owner', 'Member');
          now = -1000000;
          assert.equal(locks.view('T', 1, 'owner', 'Member'), false);
          now = 1000000;
          assert.equal(locks.view('T', 1, 'owner', 'Member'), shared);
          Date.now = wall;
        } else {
          locks.view('T', 1, 'departed', 'Member', 100);
          const next = shared ? new SharedRecordLocks(sql, 'FILE', 1) : locks;
          next.view('T', 2, 'new', 'Member', 100 + VIEW_TTL_MS);
          assert.equal(retained(), 1);
        }
        sql.close();
      `;
      const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', source], { timeout: 15_000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
      assert.equal(child.error, undefined, String(child.error));
      assert.equal(child.status, 0, child.stderr);
    });
  }
}

test('AR-store-security-05: concurrent connections', () => {
  const moduleUrl = new URL('../src/activity.ts', import.meta.url).href;
  const worker = `
    import { DatabaseSync } from 'node:sqlite';
    import { SharedRecordLocks } from ${JSON.stringify(moduleUrl)};
    const sql = new DatabaseSync(process.argv[1]);
    sql.exec('PRAGMA busy_timeout = 5000');
    const locks = new SharedRecordLocks(sql, 'FILE');
    let admitted = 0;
    process.stdout.write('ready\\n');
    process.stdin.once('data', () => {
      for (let i = 0; i < 128; i++) {
        try { locks.view('T', Number(process.argv[2]) + i, 'owner', 'Member', 100); admitted++; }
        catch (e) { if (e.code !== 812) throw e; }
      }
      sql.close();
      process.stdout.write(String(admitted));
    });
  `;
  const source = `
    import assert from 'node:assert/strict';
    import { mkdtempSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { spawn } from 'node:child_process';
    import { DatabaseSync } from 'node:sqlite';
    import { SharedRecordLocks } from ${JSON.stringify(moduleUrl)};
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-presence-workers-'));
    const path = join(dir, 'presence.sqlite');
    const sql = new DatabaseSync(path);
    new SharedRecordLocks(sql, 'File');
    const workers = [0, 1000].map((offset) => {
      const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', ${JSON.stringify(worker)}, path, String(offset)], { timeout: 5000, killSignal: 'SIGKILL' });
      let output = '', errors = '';
      child.stdout.on('data', (data) => { output += data; });
      child.stderr.on('data', (data) => { errors += data; });
      const ready = new Promise((resolve) => child.stdout.once('data', resolve));
      const done = new Promise((resolve, reject) => child.once('exit', (code) => code === 0 ? resolve(Number(output.split('\\n')[1])) : reject(new Error(errors))));
      return { child, ready, done };
    });
    try {
      const completion = Promise.all(workers.map((w) => w.done));
      const start = Promise.all(workers.map((w) => w.ready)).then(() => { for (const w of workers) w.child.stdin.end('go'); });
      const [counts] = await Promise.all([completion, start]);
      assert.equal(counts.reduce((sum, n) => sum + n, 0), 128);
      assert.equal(sql.prepare('SELECT count(*) AS n FROM viewing').get().n, 128);
    } finally {
      for (const w of workers) if (w.child.exitCode === null) w.child.kill('SIGKILL');
      sql.close(); rmSync(dir, { recursive: true, force: true });
    }
  `;
  const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', source], { timeout: 15_000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr);
});
