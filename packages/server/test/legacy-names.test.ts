// Tabularius was called openhbam: a setup made under the old name keeps working. The /openhbam/... paths and the
// x-openhbam-* headers are read under the new names, an OPENHBAM_* variable counts when its TABULARIUS_* one is not
// set, and a webhook call carries both header spellings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyLegacyEnv } from '../../store/src/legacy-env.ts';
import { legacyRequest } from '../src/legacy-request.ts';
import { serve } from '../src/index.ts';

const request = (url: string, headers: Record<string, string>) => ({ url, headers: { ...headers } }) as unknown as IncomingMessage;

test('legacy request: /openhbam paths are read as /tabularius, the query is kept', () => {
  for (const [from, to] of [['/openhbam/health', '/tabularius/health'], ['/openhbam/admin/v1/status?x=1', '/tabularius/admin/v1/status?x=1'], ['/openhbam', '/tabularius'], ['/openhbam?a=1', '/tabularius?a=1']]) {
    const req = request(from, {});
    legacyRequest(req);
    assert.equal(req.url, to);
  }
  for (const same of ['/tabularius/health', '/openhbamx/health', '/fmi/data/vLatest/databases', '/other/openhbam/health']) {
    const req = request(same, {});
    legacyRequest(req);
    assert.equal(req.url, same);
  }
});

test('legacy request: x-openhbam-* headers are read as x-tabularius-*, and the new header wins', () => {
  const req = request('/', { 'x-openhbam-local': 'old', 'x-openhbam-client': 'cli', 'x-tabularius-client': 'web', 'accept': '*/*' });
  legacyRequest(req);
  assert.equal(req.headers['x-tabularius-local'], 'old');
  assert.equal(req.headers['x-tabularius-client'], 'web');
  assert.equal(req.headers['accept'], '*/*');
});

test('legacy request: the cluster front\'s own headers are never taken from a client', () => {
  const req = request('/', { 'x-openhbam-peer': '10.0.0.9', 'x-openhbam-tls': '1' });
  legacyRequest(req);
  assert.equal(req.headers['x-tabularius-peer'], undefined);
  assert.equal(req.headers['x-tabularius-tls'], undefined);
});

test('legacy environment: OPENHBAM_* fills in TABULARIUS_* only where that one is not set', () => {
  const env: NodeJS.ProcessEnv = { OPENHBAM_PASSWORD: 'old', OPENHBAM_PUBLIC_URL: 'https://old.example', TABULARIUS_PUBLIC_URL: 'https://new.example', OPENHBAM_EMPTY: '', PATH: '/bin' };
  applyLegacyEnv(env);
  assert.equal(env.TABULARIUS_PASSWORD, 'old');
  assert.equal(env.TABULARIUS_PUBLIC_URL, 'https://new.example');
  assert.equal(env.TABULARIUS_EMPTY, '');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.OPENHBAM_PASSWORD, 'old');
});

test('a server answers both /tabularius/health and the old /openhbam/health', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-legacy-'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const now = await fetch(`${s.url}/tabularius/health`);
    const old = await fetch(`${s.url}/openhbam/health`);
    assert.equal(now.status, 200);
    assert.equal(old.status, 200);
    // The two answers come a few milliseconds apart, so the clock reading and the uptime (whole seconds, which can tick over between them) differ; everything else is the same.
    const withoutTime = ({ serverTime: _time, uptimeSeconds: _up, ...rest }: Record<string, unknown>) => rest;
    assert.deepEqual(withoutTime(await old.json() as Record<string, unknown>), withoutTime(await now.json() as Record<string, unknown>));
  } finally {
    await new Promise<void>((done) => s.server.close(() => done()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
