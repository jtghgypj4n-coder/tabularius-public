// Signed container/image URLs expire, so a leaked link stops working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/index.ts';
import { expiryClock, ExpiryClock } from '../../store/src/clock.ts';

test('an expired signed URL remains expired after a backward clock jump', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-url-clock-'));
  const host = new Host(dir);
  t.after(() => { host.close(); rmSync(dir, { recursive: true }); });
  let wall = Date.now(), mono = performance.now();
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => mono);
  const clock = new ExpiryClock();
  t.mock.method(expiryClock, 'now', () => clock.now());
  const exp = Math.floor(wall / 1000) + 60;
  const sig = host.sign('Sales', 7, '', exp);
  assert.equal(host.checkSignature('Sales', 7, sig, '', exp), true);
  wall += 120_000;
  mono += 120_000;
  assert.equal(host.checkSignature('Sales', 7, sig, '', exp), false);
  wall -= 3600_000;
  assert.equal(host.checkSignature('Sales', 7, sig, '', exp), false);
});

test('a signed URL verifies, a forged or expired one does not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-urls-'));
  try {
    const host = new Host(dir);

    // A fresh signature, with its expiry, verifies.
    const params = new URLSearchParams(host.signed('Sales', 7));
    assert.ok(host.checkUrl('Sales', 7, params));
    assert.ok(Number(params.get('exp')) > Date.now() / 1000, 'carries a future expiry');

    // Tampering with the id, the database, or the kind breaks it.
    assert.equal(host.checkUrl('Sales', 8, params), false);
    assert.equal(host.checkUrl('Other', 7, params), false);
    assert.equal(host.checkUrl('Sales', 7, params, 'image'), false);

    // A past expiry is refused even with a signature valid for that expiry,
    // so an attacker cannot forge a never-expiring link out of a real one.
    const past = Math.floor(Date.now() / 1000) - 60;
    assert.equal(host.checkSignature('Sales', 7, host.sign('Sales', 7, '', past), '', past), false);

    // A missing signature is refused.
    assert.equal(host.checkUrl('Sales', 7, new URLSearchParams()), false);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
