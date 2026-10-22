import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createStore, Store, LOCKOUT } from '../../store/src/index.ts';
import { serveCluster } from '../src/cluster.ts';

test('two real workers share HTTP Basic account failures; restart drops sessions and volatile counters', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-auth-cluster-review-'));
  const traps = mkdtempSync(join(tmpdir(), 'tabularius-auth-traps-'));
  const marker = join(traps, 'attempted');
  const oldPath = process.env.PATH, oldMarker = process.env.TABULARIUS_TEST_COMMAND_MARKER;
  for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(traps, command), '#!/bin/sh\nprintf "%s\\n" forbidden >> "$TABULARIUS_TEST_COMMAND_MARKER"\nexit 99\n', { mode: 0o755 });
    writeFileSync(join(traps, `${command}.cmd`), '@echo off\r\necho forbidden>>"%TABULARIUS_TEST_COMMAND_MARKER%"\r\nexit /b 99\r\n');
  }
  process.env.PATH = traps;
  process.env.TABULARIUS_TEST_COMMAND_MARKER = marker;
  let cluster: Awaited<ReturnType<typeof serveCluster>> | undefined;
  try {
    const path = join(dir, 'Review.openhbam.sqlite');
    createStore(path);
    const seed = new Store(path);
    seed.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest', 'fmapp', 'fmmcp'] });
    seed.setPassword('person', 'right', 'Reader');
    seed.close();
    cluster = await serveCluster({ dir, port: 0, hostname: '127.0.0.1', watch: false, proxyHeader: 'x-forwarded-for', trustedProxies: ['127.0.0.1'], log: () => {} }, 2);
    const base = cluster.url;
    const headers = (password: string) => ({ authorization: `Basic ${Buffer.from(`person:${password}`).toString('base64')}`, 'x-forwarded-for': '198.51.100.22' });
    const login = () => fetch(`${base}/fmi/data/vLatest/databases/Review/sessions`, { method: 'POST', headers: headers('right'), body: '{}' });
    const signed = await login();
    assert.equal(signed.status, 200);
    let session = (await signed.json()).response.token as string;
    const other = session.startsWith('00') ? '01' : '00';
    const logout = await fetch(`${base}/fmi/data/vLatest/databases/Review/%73essions/${session}/`, { method: 'DELETE', headers: { 'x-forwarded-for': '198.51.100.22', authorization: `Bearer ${other}${'a'.repeat(46)}` } });
    assert.equal(logout.status, 200);
    await logout.arrayBuffer();
    const ended = await fetch(`${base}/fmi/data/vLatest/databases/Review/layouts`, { headers: { 'x-forwarded-for': '198.51.100.22', authorization: `Bearer ${session}` } });
    assert.equal(ended.status, 401, 'logout reaches the owner despite a mismatched header');
    await ended.arrayBuffer();
    const again = await login();
    assert.equal(again.status, 200);
    session = (await again.json()).response.token;
    for (let i = 0; i < LOCKOUT.attempts; i++) {
      const response = i % 2
        ? await fetch(`${base}/fmi/odata/v4/Review`, { headers: headers(`wrong-${i}`) })
        : await fetch(`${base}/fmi/data/vLatest/databases/Review/sessions`, { method: 'POST', headers: headers(`wrong-${i}`), body: '{}' });
      assert.equal(response.status, 401);
      await response.arrayBuffer();
    }
    const blocked = await login();
    assert.equal(blocked.status, 401);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    await blocked.arrayBuffer();

    const owner = parseInt(session.slice(0, 2), 16), oldPid = cluster.pids()[owner]!;
    process.kill(oldPid, 'SIGKILL');
    let replacement: Response | undefined;
    for (const deadline = performance.now() + 20_000; performance.now() < deadline; await sleep(50)) {
      if (!cluster.pids()[owner] || cluster.pids()[owner] === oldPid) continue;
      const response = await login();
      if (response.status === 200) { replacement = response; break; }
      await response.arrayBuffer();
    }
    assert.ok(replacement, 'worker replacement restores password login; process-local counters reset');
    await replacement.arrayBuffer();
    const stale = await fetch(`${base}/fmi/data/vLatest/databases/Review/layouts`, { headers: { 'x-forwarded-for': '198.51.100.22', authorization: `Bearer ${session}` } });
    assert.equal(stale.status, 401, 'a replacement worker cannot recover an old in-memory session');
    await stale.arrayBuffer();
  } finally {
    await cluster?.close();
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldMarker === undefined) delete process.env.TABULARIUS_TEST_COMMAND_MARKER; else process.env.TABULARIUS_TEST_COMMAND_MARKER = oldMarker;
    const attempted = existsSync(marker);
    rmSync(dir, { recursive: true, force: true });
    rmSync(traps, { recursive: true, force: true });
    assert.equal(attempted, false, 'no forbidden commands may be attempted by a child');
  }
});
