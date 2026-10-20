import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeOf, serve, setAdminPassword } from '../src/index.ts';

// Health checks and Prometheus metrics.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('requests are counted by a fixed few kinds, whatever the path', () => {
  assert.equal(routeOf('/fmi/data/vLatest/databases/Charts/layouts/x/records'), 'dataapi');
  assert.equal(routeOf('/fmi/odata/v4/Charts/Congress(1)'), 'odata');
  assert.equal(routeOf('/tabularius/live/v1/databases/Charts/events'), 'live');
  assert.equal(routeOf('/admin/'), 'admin');
  assert.equal(routeOf('/app/index.html'), 'app');
  assert.equal(routeOf('/tabularius/made-up-thing-123/x'), 'other');
  assert.equal(routeOf('/wp-login.php'), 'other');
});

test('health without sign-in; metrics in Prometheus format with the admin password', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-metrics-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const { server, url, host } = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const store = host.get('Charts')!;
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
    store.setPassword('Ann', 'pw', full.name);

    const health = await fetch(`${url}/tabularius/health`);
    assert.equal(health.status, 200);
    assert.equal(((await health.json()) as { status: string }).status, 'ok');

    // Some traffic: a session and a few requests (one not signed in).
    const login = await fetch(`${url}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Ann:pw') } });
    const token = ((await login.json()) as { response: { token: string } }).response.token;
    const auth = { authorization: `Bearer ${token}` };
    for (let i = 0; i < 3; i++) await (await fetch(`${url}/fmi/data/vLatest/databases/Charts/layouts`, { headers: auth })).arrayBuffer();
    assert.equal((await fetch(`${url}/fmi/data/vLatest/databases/Charts/layouts`)).status, 401);

    // On this machine without an admin password; with one, it is asked for.
    setAdminPassword(dir, 'secret');
    assert.equal((await fetch(`${url}/tabularius/admin/v1/metrics`)).status, 401);
    const res = await fetch(`${url}/tabularius/admin/v1/metrics`, { headers: { authorization: 'Basic ' + btoa('prometheus:secret') } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type')!, /^text\/plain; version=0\.0\.4/);
    const text = await res.text();

    // Every line is a comment or a sample: name{labels} value.
    for (const line of text.trim().split('\n')) {
      assert.match(line, /^(# (HELP|TYPE) \w+ .+|[a-z_][a-z0-9_]*(\{([a-z_]+="(?:[^"\\]|\\.)*",?)*\})? (-?[\d.e+-]+|\+Inf|NaN))$/, line);
    }
    const value = (sample: string) => Number(new RegExp(`^${sample.replace(/[{}"+.]/g, '\\$&')} (\\S+)$`, 'm').exec(text)?.[1]);
    assert.equal(value('tabularius_up'), 1);
    assert.equal(value('tabularius_files'), 1);
    assert.equal(value('tabularius_sessions{file="Charts"}'), 1);
    assert.equal(value('tabularius_http_requests_total{route="dataapi",method="GET",status="2xx"}'), 3);
    assert.equal(value('tabularius_http_requests_total{route="dataapi",method="GET",status="4xx"}'), 1);
    assert.equal(value('tabularius_http_requests_total{route="dataapi",method="POST",status="2xx"}'), 1);
    assert.equal(value('tabularius_http_request_duration_seconds_count{route="dataapi"}'), 5);
    assert.equal(value('tabularius_http_request_duration_seconds_bucket{route="dataapi",le="+Inf"}'), 5);
    assert.ok(value('tabularius_file_size_bytes{file="Charts"}') > 100_000);
    assert.ok(value('process_resident_memory_bytes') > 0);
    assert.match(text, /^# TYPE tabularius_http_request_duration_seconds histogram$/m);
  } finally {
    // Closed first (files closed, background writes done), so the folder is empty enough to remove; retried in
    // case a file is still being let go.
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
