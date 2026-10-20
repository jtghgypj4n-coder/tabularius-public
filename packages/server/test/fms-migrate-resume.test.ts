import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchFmsExport, FmsMigrationError, migrateFms, type FmsExport } from '../src/fms-migrate.ts';

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('migration resumes after every completed file and a second run changes no bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-migrate-resume-'));
  try {
    const fms = join(root, 'fms');
    const dest = join(root, 'dest');
    const source = join(fms, 'Data', 'Databases');
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      mkdirSync(join(source, 'RC_Data_FMS', name, 'Files'), { recursive: true });
      writeFileSync(join(source, `${name}.fmp12`), `generated-${name}`);
      writeFileSync(join(source, 'RC_Data_FMS', name, 'Files', 'data.bin'), `generated-container-${name}`);
    }
    const exp: FmsExport = {
      databases: ['Alpha', 'Beta', 'Gamma'].map((name) => ({ filename: `${name}.fmp12` })),
      schedules: [{ name: 'Generated nightly', enabled: true, filemakerScriptType: { resource: 'file:Alpha.fmp12', fmScriptName: 'Generated' }, everyndaysType: { startTimeStamp: '2026-01-01T02:00:00', dailyDays: 1 } }],
    };
    const steps: number[] = [];
    assert.throws(() => migrateFms(exp, dest, { fmsDir: fms, onProgress: (p) => {
      steps.push(p.completed);
      assert.equal(p.total, 3);
      assert.ok(p.etaMs === null || p.etaMs >= 0);
      if (p.completed === 1) throw new Error('injected stop');
    } }), /injected stop/);
    assert.deepEqual(steps, [1]);
    // An abandoned staging folder never counts as a completed destination.
    const abandoned = join(dest, '.tabularius-migrate-abandoned');
    mkdirSync(abandoned);
    writeFileSync(join(abandoned, 'Beta.fmp12'), 'partial');
    const resumed = migrateFms(exp, dest, { fmsDir: fms });
    assert.equal(resumed.files.filter((f) => f.done).length, 3);
    const before = ['Alpha', 'Beta', 'Gamma'].map((name) => [digest(join(dest, `${name}.fmp12`)), digest(join(dest, 'RC_Data_FMS', name, 'Files', 'data.bin'))]);
    const again = migrateFms(exp, dest, { fmsDir: fms });
    assert.equal(again.files.filter((f) => f.done).length, 3);
    assert.deepEqual(['Alpha', 'Beta', 'Gamma'].map((name) => [digest(join(dest, `${name}.fmp12`)), digest(join(dest, 'RC_Data_FMS', name, 'Files', 'data.bin'))]), before);
    assert.equal(JSON.parse(readFileSync(join(dest, '.openhbam-schedules.json'), 'utf8')).schedules.length, 1, 'a resumed schedule is written once');
    assert.equal(readdirSync(dest).filter((name) => name.startsWith('.tabularius-migrate-')).length, 1, 'new staging folders were cleaned');
    for (const stopAfter of [2, 3]) {
      const next = join(root, `stopped-${stopAfter}`);
      assert.throws(() => migrateFms(exp, next, { fmsDir: fms, onProgress: ({ completed }) => {
        if (completed === stopAfter) throw new Error('injected stop');
      } }), /injected stop/);
      assert.equal(migrateFms(exp, next, { fmsDir: fms }).files.filter((f) => f.done).length, 3);
      assert.equal(JSON.parse(readFileSync(join(next, '.openhbam-schedules.json'), 'utf8')).schedules.length, 1);
    }
    writeFileSync(join(dest, 'Beta.fmp12'), 'different');
    assert.throws(() => migrateFms(exp, dest, { fmsDir: fms }), FmsMigrationError);
    writeFileSync(join(source, 'Delta.fmp12'), 'generated-Delta');
    writeFileSync(join(dest, 'Delta.openhbam.sqlite'), 'existing-converted-store');
    const converted = migrateFms({ databases: [{ filename: 'Delta.fmp12' }] }, dest, { fmsDir: fms });
    assert.equal(converted.files[0].done, true);
    assert.equal(existsSync(join(dest, 'Delta.fmp12')), false, 'the data-at-rest store name is recognized');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a failed live schedule list stops the export and signs out', async () => {
  let signedOut = 0;
  const fake = createServer((req, res) => {
    const ok = (response: unknown) => res.end(JSON.stringify({ response, messages: [{ code: '0' }] }));
    if (req.method === 'POST') return ok({ token: 'synthetic-token' });
    if (req.method === 'DELETE') { signedOut++; return ok({}); }
    if (req.url?.endsWith('/databases')) return ok({ databases: [] });
    if (req.url?.endsWith('/schedules')) return res.writeHead(503).end('temporarily unavailable');
    return ok({});
  });
  await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
  try {
    await assert.rejects(fetchFmsExport(`http://127.0.0.1:${(fake.address() as AddressInfo).port}`, 'admin', 'synthetic-password'),
      /couldn't read schedules.*live export is incomplete/);
    assert.equal(signedOut, 1);
  } finally { await new Promise<void>((done) => fake.close(() => done())); }
});
