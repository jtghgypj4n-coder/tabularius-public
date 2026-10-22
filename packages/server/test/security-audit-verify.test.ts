import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, Worker } from 'node:worker_threads';
import { createStore, Store } from '../../store/src/index.ts';
import { serve, setAdminPassword, Host } from '../src/index.ts';
import { Admin } from '../src/admin.ts';
import { DataApi } from '../src/dataapi.ts';
import { SecurityAuditVerifier } from '../src/security-audit.ts';

test('security verification inherits admin authorization and reports raw history without event filters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-verify-admin-'));
  createStore(join(dir, 'Test.openhbam.sqlite'));
  setAdminPassword(dir, 'console secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    const headers = { authorization: 'Basic ' + btoa('admin:console secret'), 'x-tabularius-admin': '1' };
    const route = '/tabularius/admin/v1/security-events/verify';
    const get = (query = '?database=Test', auth?: Record<string, string>) => fetch(s.url + route + query, { headers: auth });
    for (const path of [route, '/tabularius/admin/v1/security-events']) {
      assert.equal((await fetch(`${s.url}${path}?database=Test`)).status, 401);
      assert.equal((await fetch(`${s.url}${path}?database=Test`, {
        headers: { authorization: 'Basic ' + btoa('admin:wrong'), 'x-tabularius-admin': '1' },
      })).status, 401);
    }
    const store = s.host.get('Test')!;
    store.auditSignIn('Ann', 'local', true);
    store.auditSignIn('Ben', 'local', false);
    const before = store.sql.prepare('SELECT * FROM _fm_security_chain_state').get();
    const ok = await get('?database=test&limit=1&kind=sign-in&account=Ann', headers);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { database: 'Test', ...store.verifySecurityAudit() });
    assert.equal(store.verifySecurityAudit().checked, 2, 'no presentation filters or limits');
    assert.deepEqual(store.sql.prepare('SELECT * FROM _fm_security_chain_state').get(), before);
    store.setPassword('reader', 'file secret');
    assert.equal((await get('?database=Test', { authorization: 'Basic ' + btoa('reader:file secret'), 'x-tabularius-admin': '1' })).status, 401,
      'a file account is not an admin console identity');
    store.sql.exec("UPDATE _fm_audit SET changes = '{}' WHERE seq = 2");
    const bad = await get('?database=Test', headers);
    assert.equal(bad.status, 200);
    const result = await bad.json();
    assert.equal(result.ok, false);
    assert.equal(result.firstBrokenSeq, '2');
    assert.match(result.reason, /event hash mismatch/);
    assert.equal((await get('', headers)).status, 400);
    assert.equal((await get('?database=Missing', headers)).status, 400);
    assert.equal((await fetch(s.url + route + '?database=Test', {
      method: 'POST', headers: { ...headers, 'x-tabularius-admin': '1' },
    })).status, 405);
  } finally {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('security verification is available to local admins without a console password', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-verify-local-'));
  createStore(join(dir, 'Test.openhbam.sqlite'));
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    const result = await fetch(s.url + '/tabularius/admin/v1/security-events/verify?database=Test');
    assert.equal(result.status, 200);
    assert.equal((await result.json()).ok, true);
  } finally {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

function gatedWorker(dir: string): { gate: Int32Array; started: Promise<void>; createWorker(path: string): Worker } {
  const gate = new Int32Array(new SharedArrayBuffer(4));
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const script = join(dir, 'verification-barrier.mjs');
  writeFileSync(script, `import { workerData } from 'node:worker_threads';
    const gate = new Int32Array(workerData.gate);
    Atomics.wait(gate, 0, 0);
    await import(${JSON.stringify(new URL('../src/security-audit-worker.ts', import.meta.url).href)});
  `);
  return { gate, started, createWorker: (path) => {
    const worker = new Worker(script, { workerData: { path, gate: gate.buffer } });
    worker.once('online', ready);
    return worker;
  } };
}

test('verification leaves HTTP requests responsive, bounds jobs and returns a consistent snapshot', { timeout: 30000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-verify-large-'));
  const path = join(dir, 'Test.openhbam.sqlite');
  let verifier: SecurityAuditVerifier | undefined;
  let host: Host | undefined;
  let server: Server | undefined;
  const abort = new AbortController();
  const requests: Promise<Response>[] = [];
  t.after(async () => {
    abort.abort();
    await verifier?.stop();
    server?.closeAllConnections();
    await Promise.allSettled(requests);
    if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await host?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  createStore(path);
  const seeded = new Store(path);
  try {
    seeded.auditSignIn('member', 'local', true);
    seeded.sql.exec("INSERT INTO _fm_audit (at, kind, tbl) VALUES ('now', 'create', 'Records')");
  } finally { seeded.close(); }
  const { gate, started, createWorker } = gatedWorker(dir);
  let created: ((worker: Worker) => void) | undefined;
  verifier = new SecurityAuditVerifier({ createWorker: (path) => {
    const worker = createWorker(path);
    created?.(worker);
    return worker;
  } });
  host = new Host(dir, () => {});
  const admin = new Admin(host, new DataApi(host), verifier);
  const http = createServer((req, res) => {
    void admin.handle(req, res, new URL(req.url!, 'http://localhost')).catch(() => res.destroy());
  });
  server = http;
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const signal = AbortSignal.any([abort.signal, t.signal]);
  const get = (route: string, requestSignal = signal) => {
    const request = fetch(base + route, { signal: requestSignal });
    void request.catch(() => {});
    requests.push(request);
    return request;
  };
  const route = '/tabularius/admin/v1/security-events/verify?database=Test';
  let completed = false;
  const verification = get(route).then((response) => { completed = true; return response; });
  void verification.catch(() => {});
  // Synchronize with a real worker, then run the actual verifier after releasing it.
  // This needs one event, rather than a large scan whose duration races HTTP requests.
  await Promise.race([started, verification.then(() => { throw new Error('verification ended before worker readiness'); })]);
  t.signal.throwIfAborted();
  assert.equal((await get(route)).status, 503);
  assert.equal((await get('/tabularius/admin/v1/status')).status, 200);
  assert.equal(completed, false, 'HTTP requests completed while the worker remained occupied');
  host.get('Test')!.auditSignIn('later', 'local', true);
  Atomics.store(gate, 0, 1);
  Atomics.notify(gate, 0);
  const response = await verification;
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result, { database: 'Test', ...host.get('Test')!.verifySecurityAudit() });
  assert.equal(result.checked, 2);
  assert.ok(result.head);
  assert.equal(result.head.chainSeq, '2');
  assert.equal(result.head.auditSeq, '3');
  const next = await get(route);
  assert.equal(next.status, 200, 'the worker slot is released after completion');
  assert.equal((await next.json()).checked, 2);

  Atomics.store(gate, 0, 0);
  const client = new AbortController();
  const workerCreated = new Promise<Worker>((resolve) => { created = resolve; });
  const disconnected = get(route, AbortSignal.any([signal, client.signal]));
  const rejected = assert.rejects(disconnected, { name: 'AbortError' });
  const worker = await workerCreated;
  const exited = new Promise<void>((resolve) => worker.once('exit', () => resolve()));
  client.abort();
  await rejected;
  await exited;
  assert.equal(worker.threadId, -1, 'a disconnected HTTP client terminates its worker');
  Atomics.store(gate, 0, 1);
  Atomics.notify(gate, 0);
  const recovered = await get(route);
  assert.equal(recovered.status, 200, 'client disconnect releases the production handler job slot');
  assert.equal((await recovered.json()).ok, true);
});

test('verification retains its pre-append snapshot when another connection appends after the head is read', { timeout: 30000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-verify-snapshot-'));
  const path = join(dir, 'Test.openhbam.sqlite');
  const gate = new Int32Array(new SharedArrayBuffer(4));
  const channel = new MessageChannel();
  const script = join(dir, 'verification-snapshot.mjs');
  const verifier = new SecurityAuditVerifier({ createWorker: (path) => new Worker(script, {
    workerData: { path, gate: gate.buffer, snapshot: channel.port2 }, transferList: [channel.port2],
  }) });
  let store: Store | undefined;
  t.after(async () => {
    await verifier.stop();
    channel.port1.close();
    channel.port2.close();
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  // Pause only after the real state query finishes, inside the verifier's read transaction.
  // The native rows and subsequent verification are unchanged; the hook stays in this worker.
  writeFileSync(script, `import { DatabaseSync } from 'node:sqlite';
    import { workerData } from 'node:worker_threads';
    const prepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function(query) {
      const statement = prepare.call(this, query);
      if (query.includes('FROM _fm_security_chain_state')) {
        const sql = this;
        const all = statement.all;
        statement.all = function(...args) {
          const rows = all.apply(this, args);
          workerData.snapshot.postMessage({ transaction: sql.isTransaction,
            headSeq: rows[0].head_seq, headAuditSeq: rows[0].head_audit_seq,
            headHash: Buffer.from(rows[0].head_hash).toString('utf8') });
          Atomics.wait(new Int32Array(workerData.gate), 0, 0);
          return rows;
        };
      }
      return statement;
    };
    await import(${JSON.stringify(new URL('../src/security-audit-worker.ts', import.meta.url).href)});
  `);
  createStore(path);
  store = new Store(path);
  store.auditSignIn('before', 'local', true);
  store.sql.exec("INSERT INTO _fm_audit (at, kind, tbl) VALUES ('now', 'create', 'Records')");
  const before = store.verifySecurityAudit();
  assert.equal(before.ok, true);
  assert.equal(before.checked, 1);
  assert.ok(before.head);
  const snapshot = new Promise<{ transaction: boolean; headSeq: bigint; headAuditSeq: bigint; headHash: string }>((resolve) => {
    channel.port1.once('message', resolve);
  });
  const verification = verifier.verify(path, t.signal);
  assert.ok(verification);
  const established = await Promise.race([snapshot, verification.then(() => { throw new Error('verification ended before the snapshot pause'); })]);
  t.signal.throwIfAborted();
  assert.equal(established.transaction, true);
  assert.equal(established.headSeq.toString(), before.head.chainSeq);
  assert.equal(established.headAuditSeq.toString(), before.head.auditSeq);
  assert.equal(established.headHash, before.head.hash);

  // This writer uses another connection and commits while the worker's snapshot is held.
  store.auditSignIn('after', 'local', true);
  assert.equal(store.sql.isTransaction, false);
  const current = store.verifySecurityAudit();
  assert.equal(current.ok, true);
  assert.equal(current.checked, 2);
  assert.ok(current.head);
  assert.equal(current.head.chainSeq, '2');
  assert.equal(current.head.auditSeq, '3');
  assert.notEqual(current.head.hash, before.head.hash);

  Atomics.store(gate, 0, 1);
  Atomics.notify(gate, 0);
  const result = await verification;
  assert.deepEqual(result, before, 'both the scanned history and reported head belong to the pre-append snapshot');
  assert.deepEqual(store.verifySecurityAudit(), current, 'the committed append remains visible to a fresh verifier');
});

test('a verification worker error releases its job slot', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-verify-error-'));
  const verifier = new SecurityAuditVerifier();
  t.after(async () => { await verifier.stop(); rmSync(dir, { recursive: true, force: true }); });
  const failed = verifier.verify(join(dir, 'Missing.sqlite'), t.signal);
  assert.ok(failed);
  assert.equal(verifier.verify(join(dir, 'Missing.sqlite')), undefined);
  await assert.rejects(failed);
  const path = join(dir, 'Test.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  store.close();
  const next = verifier.verify(path, t.signal);
  assert.ok(next);
  assert.equal((await next).ok, true);
});

for (const cancelled of ['timeout', 'abort', 'stop'] as const) {
  test(`a verification worker ${cancelled} terminates it and releases its slot`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-verify-cancel-'));
    const { createWorker } = gatedWorker(dir);
    let worker: Worker;
    let bounded = true;
    const verifier = new SecurityAuditVerifier({
      // Long enough for the real verification that follows on a busy machine; the gated worker never answers, so it still times out.
      timeoutMs: cancelled === 'timeout' ? 2000 : undefined,
      createWorker: (path) => (worker = bounded ? createWorker(path) : new Worker(new URL('../src/security-audit-worker.ts', import.meta.url), { workerData: { path } })),
    });
    t.after(async () => { await verifier.stop(); rmSync(dir, { recursive: true, force: true }); });
    const path = join(dir, 'Test.openhbam.sqlite');
    createStore(path);
    const store = new Store(path);
    store.close();
    const abort = new AbortController();
    const failed = verifier.verify(path, AbortSignal.any([abort.signal, t.signal]));
    assert.ok(failed);
    const rejected = assert.rejects(failed, cancelled === 'timeout' ? /timed out/ : /cancelled/);
    assert.equal(verifier.verify(path), undefined);
    if (cancelled === 'abort') abort.abort();
    if (cancelled === 'stop') await verifier.stop();
    await rejected;
    assert.equal(worker!.threadId, -1, 'the worker exited before its slot became available');
    bounded = false;
    const next = verifier.verify(path, t.signal);
    assert.ok(next);
    assert.equal((await next).ok, true);
  });
}
