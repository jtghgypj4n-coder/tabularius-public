// Unusual-access alerts: the analyzer reads the sign-in and security log over a
// recent window and surfaces failed-sign-in bursts, lockouts, sign-ins from a
// new place, one account from many places, a dormant account waking, and
// protections turned off — worst first, and nothing for ordinary activity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importFmp12, Store, type AccessAlert } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

const now = Date.now();
const H = 3_600_000, D = 86_400_000;
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

function seed(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-unusual-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  // The store's own setup creates the audit table; a first event makes sure of it.
  const store = new Store(path);
  store.auditSignIn('warmup', '127.0.0.1', false);
  // Write sign-in/security history with chosen timestamps straight into the log,
  // through a second connection (the audit table the store already created).
  const db = new DatabaseSync(path);
  const ins = db.prepare('INSERT INTO _fm_audit (at, account, kind, tbl, record_id, changes, security, agent) VALUES (?, ?, ?, ?, NULL, ?, 1, 0)');
  const ev = (at: string, account: string, kind: string, detail?: Record<string, unknown>) =>
    ins.run(at, account, kind, '', detail ? JSON.stringify(detail) : null);

  // bob: a burst of failed sign-ins inside the window → failed-burst.
  for (let i = 10; i >= 1; i--) ev(iso(i * 60_000), 'bob', 'sign-in-failed', { from: '9.9.9.9' });
  // carol: locked out inside the window → lockout.
  ev(iso(5 * 60_000), 'carol', 'locked-out', { from: '9.9.9.9', factor: 'two-factor' });
  // dave: a known place just before the window, then a new place inside it → new-place (not dormant: the gap is short).
  ev(iso(73 * H), 'dave', 'sign-in', { from: '1.1.1.1' });
  ev(iso(1 * H), 'dave', 'sign-in', { from: '2.2.2.2' });
  // erin: last seen 100 days ago, back today from the same place → dormant-return only.
  ev(iso(100 * D), 'erin', 'sign-in', { from: '5.5.5.5' });
  ev(iso(2 * H), 'erin', 'sign-in', { from: '5.5.5.5' });
  // frank: three different places inside the window, no prior history → many-places only.
  ev(iso(3 * H), 'frank', 'sign-in', { from: 'a' });
  ev(iso(2 * H), 'frank', 'sign-in', { from: 'b' });
  ev(iso(1 * H), 'frank', 'sign-in', { from: 'c' });
  // grace: a second factor turned off inside the window → protection-removed.
  ev(iso(1 * H), 'admin', 'two-factor-disabled', { target: 'grace' });
  // ordinary activity that must NOT alert: one failed sign-in, and an old burst wholly before the window.
  ev(iso(30 * 60_000), 'hank', 'sign-in-failed', { from: '8.8.8.8' });
  for (let i = 0; i < 8; i++) ev(iso(10 * D + i * 60_000), 'olive', 'sign-in-failed', { from: '7.7.7.7' });
  db.close();

  return { store, dir };
}

const by = (alerts: AccessAlert[], kind: string, account?: string) =>
  alerts.find((a) => a.kind === kind && (account === undefined || a.account === account));

test('surfaces each kind of unusual access, worst first', { skip }, () => {
  const { store, dir } = seed();
  try {
    const alerts = store.unusualAccess();

    const burst = by(alerts, 'failed-burst', 'bob');
    assert.ok(burst && burst.severity === 'alert' && burst.count === 10 && burst.from === '9.9.9.9');

    const lockout = by(alerts, 'lockout', 'carol');
    assert.ok(lockout && lockout.severity === 'alert');

    const newPlace = by(alerts, 'new-place', 'dave');
    assert.ok(newPlace && newPlace.severity === 'notice' && newPlace.from === '2.2.2.2');
    assert.ok(!by(alerts, 'dormant-return', 'dave'), 'dave is not dormant (short gap)');

    const dormant = by(alerts, 'dormant-return', 'erin');
    assert.ok(dormant && (dormant.count ?? 0) >= 60);
    assert.ok(!by(alerts, 'new-place', 'erin'), 'erin came from a known place');

    const many = by(alerts, 'many-places', 'frank');
    assert.ok(many && many.count === 3);
    assert.ok(!by(alerts, 'new-place', 'frank'), 'frank has no prior history, so no new-place');

    const removed = by(alerts, 'protection-removed');
    assert.ok(removed && /second factor/i.test(removed.description));

    // ordinary activity is quiet.
    assert.ok(!by(alerts, 'failed-burst', 'hank'), 'one failure is not a burst');
    assert.ok(!alerts.some((a) => a.account === 'olive'), 'a burst wholly before the window is not recent');

    // worst first: every alert comes before every notice.
    const firstNotice = alerts.findIndex((a) => a.severity === 'notice');
    const lastAlert = alerts.map((a) => a.severity).lastIndexOf('alert');
    if (firstNotice !== -1 && lastAlert !== -1) assert.ok(lastAlert < firstNotice, 'alerts sort before notices');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the window and thresholds are adjustable', { skip }, () => {
  const { store, dir } = seed();
  try {
    // A 1-hour window drops everything older than an hour (bob's burst spans 1–10 min, so it stays).
    const tight = store.unusualAccess({ windowHours: 1 });
    assert.ok(by(tight, 'failed-burst', 'bob'), 'bob burst is within the last hour');
    assert.ok(!by(tight, 'dormant-return', 'erin'), 'erin signed in 2h ago — outside a 1h window');

    // Raising the failure threshold above the burst size silences it.
    assert.ok(!by(store.unusualAccess({ failureThreshold: 20 }), 'failed-burst', 'bob'));

    // A short dormancy threshold flags more; a long one flags fewer.
    assert.ok(by(store.unusualAccess({ dormantDays: 1 }), 'dormant-return', 'erin'));
    assert.ok(!by(store.unusualAccess({ dormantDays: 3650 }), 'dormant-return', 'erin'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a quiet file yields no alerts', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-unusual-quiet-'));
  try {
    const path = join(dir, 'Charts.sqlite');
    importFmp12(fixture, path);
    assert.deepEqual(new Store(path).unusualAccess(), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
