import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { createStore } from '../../store/src/index.ts';
import { RawClient, request, responseBody, stubCommands } from './edge-test-helpers.ts';

test('raw request-target validation precedes production routing and static-file URL normalization', async t => {
  stubCommands(t);
  const dir = mkdtempSync(join(tmpdir(), 'http-targets-'));
  createStore(join(dir, 'Generated.openhbam.sqlite'));
  const app = await serve({ dir, port: 0, hostname: '127.0.0.1', watch: false, checkFiles: false, statsInterval: 0, log: () => {} });
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise<void>(resolve => app.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  const port = Number(new URL(app.url).port);
  const call = async (target: string, pipeline = false) => {
    const c = await new RawClient(port).ready();
    return c.send(request(target, pipeline ? '' : 'Connection: close\r\n')
      + (pipeline ? request('/tabularius/health', 'Connection: close\r\n') : '')).end();
  };
  // Controls in the decoded path never reach a route: the edge refuses them, and the rest of the pipeline with them.
  for (const prefix of ['/app/', '/fmi/data/vLatest/databases/', '/tabularius/app/v1/databases/']) {
    for (const suffix of ['%00', '%01', '%7f']) {
      const text = await call(prefix + suffix, true);
      assert.match(text, /^HTTP\/1.1 400 /, prefix + suffix);
      assert.equal((text.match(/HTTP\/1.1 /g) ?? []).length, 1);
      assert.match(text, /connection: close/i);
    }
  }
  // A malformed % escape (incomplete, overlong or invalid UTF-8) is answered by the route that decodes it, in its own envelope:
  // a 400 for the API routes, a 404 for the static app. It never becomes a server fault and never serves another resource.
  for (const prefix of ['/app/', '/fmi/data/vLatest/databases/', '/tabularius/app/v1/databases/']) {
    for (const suffix of ['%', '%2', '%gg', '%c0%af', '%e0%80%af', '%ed%a0%80', '%f4%90%80%80', '%ff']) {
      const text = await call(prefix + suffix);
      assert.match(text, /^HTTP\/1.1 (?:400|404) /, prefix + suffix);
      assert.doesNotMatch(responseBody(text), /"status"\s*:\s*"ok"/, prefix + suffix);
    }
  }
  for (const target of [
    '/app/../tabularius/health', '/app/./index.html', '/app/..\\tabularius/health', '/app/%2e%2e/tabularius/health', '/app/.%2e/tabularius/health',
    '/app/%2E./tabularius/health', '/app/%2e/index.html',
    '//other.example/app/', '/app/#fragment', '/app/?x=%00',
    'http://other.example/app/../tabularius/health', 'http://user@host/app/', 'http://host#fragment/app/',
    'http:///app/', 'https://host:wrong/app/', 'ftp://host/app/', 'app/index.html', '*',
  ]) {
    const text = await call(target, true);
    assert.match(text, /^HTTP\/1.1 400 /, target);
    assert.equal((text.match(/HTTP\/1.1 /g) ?? []).length, 1);
  }
  // An encoded slash is literal data to the routes (the file routes refuse traversal): not served as another resource. An encoded
  // backslash decodes to a character no route should see, so the edge refuses it. A malformed query escape does not fail the request.
  assert.match(await call('/app/%5c..%5cindex.html', true), /^HTTP\/1.1 400 /);
  for (const target of ['/app/%2f..%2ftabularius/health']) {
    const text = await call(target);
    assert.match(text, /^HTTP\/1.1 (?:400|404) /, target);
    assert.doesNotMatch(responseBody(text), /"status"\s*:\s*"ok"/, target);
  }
  for (const target of ['/app/?x=%', '/app/?x=%c0%af']) assert.match(await call(target), /^HTTP\/1.1 200 /, target);
  // Double encoding is literal path text after one decode, never traversed or decoded again.
  for (const target of ['/app/%252e%252e/index.html', '/app/%2500', '/app/%252findex.html', '/app/%c3%a9.html']) {
    assert.match(await call(target), /^HTTP\/1.1 404 /, target);
  }
  for (const target of ['/app/', '/app/?q=%252e%252e&percent=%25&line=%0a', 'http://localhost/app/']) {
    const text = await call(target);
    assert.match(text, /^HTTP\/1.1 200 /, target);
    assert.match(responseBody(text), /src\/main\.ts/);
  }
  // A normal encoded name is decoded exactly once by the Data API.
  const route = await call('/fmi/data/vLatest/databases/%47enerated/layouts');
  assert.match(route, /^HTTP\/1.1 401 /);
  const health = await call('http://localhost/tabularius/health');
  assert.match(health, /^HTTP\/1.1 200 /);
});
