import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { Readable, PassThrough } from 'node:stream';
import { guardedFetch, guardedFetcher, outboundContext, OutboundRefused } from '../src/net-guard.ts';

type Sent = { url: URL; method: string; headers: Record<string, string>; body?: Buffer };
// No sockets or DNS: capture outgoing requests and answer with generated streams.
function transport(t: TestContext, answer: (sent: Sent, index: number) => { status: number; location?: string; stream?: PassThrough }) {
  const sent: Sent[] = [];
  const request = ((url: URL, options: http.RequestOptions, receive: (res: http.IncomingMessage) => void) => {
    const req = new EventEmitter();
    Object.assign(req, { end(body?: Buffer) {
      const item = { url, method: String(options.method), headers: options.headers as Record<string, string>, body };
      sent.push(item);
      const result = answer(item, sent.length - 1);
      const res = Object.assign(result.stream ?? Readable.from([]), { statusCode: result.status, statusMessage: '', headers: result.location ? { location: result.location } : {} });
      queueMicrotask(() => receive(res as unknown as http.IncomingMessage));
    } });
    return req;
  }) as unknown as typeof http.request;
  const h = t.mock.method(http, 'request', request);
  const s = t.mock.method(https, 'request', request);
  syncBuiltinESMExports();
  t.after(() => { h.mock.restore(); s.mock.restore(); syncBuiltinESMExports(); });
  return sent;
}

const credential = ['synthetic', 'credential'].join('-');
test('cross-origin redirects strip credentials; same-origin redirects retain them', async (t) => {
  const sent = transport(t, (_item, index) => index === 0 ? { status: 307, location: '/same' } : index === 1 ? { status: 308, location: 'https://other.test/final' } : { status: 200 });
  const res = await guardedFetch('https://start.test/', { method: 'PUT', body: 'data', headers: {
    authorization: credential, cookie: credential, 'x-private': credential, accept: 'text/plain', 'accept-language': 'en',
  } });
  assert.equal(await res.text(), '');
  assert.equal(res.url, 'https://other.test/final');
  assert.equal(sent.length, 3);
  assert.equal(sent[1].headers.authorization, credential);
  assert.equal(sent[1].headers.cookie, credential);
  assert.equal(sent[2].headers.authorization, undefined);
  assert.equal(sent[2].headers.cookie, undefined);
  assert.equal(sent[2].headers['x-private'], undefined);
  assert.equal(sent[2].headers.accept, 'text/plain');
  assert.equal(sent[2].headers['accept-language'], 'en');
  for (const item of sent) { assert.equal(item.method, 'PUT'); assert.equal(item.body?.toString(), 'data'); }
});

test('redirect status and method determine whether the body and content headers follow', async (t) => {
  let status = 301;
  const sent = transport(t, (item) => item.url.pathname === '/start' ? { status, location: '/end' } : { status: 200 });
  for (status of [301, 302, 303, 307, 308]) for (const method of ['GET', 'HEAD', 'POST', 'PUT']) {
    const body = method === 'GET' || method === 'HEAD' ? undefined : 'payload';
    const offset = sent.length;
    const res = await guardedFetch('http://start.test/start', { method, body, headers: { 'content-type': 'text/custom', ...(body ? { 'content-length': '7' } : {}) } });
    await res.text();
    assert.equal(sent.length, offset + 2);
    const rewrite = status === 303 ? method !== 'GET' && method !== 'HEAD' : (status === 301 || status === 302) && method === 'POST';
    const next = sent[offset + 1];
    assert.equal(next.method, rewrite ? 'GET' : method, `${status} ${method}`);
    assert.equal(next.body?.toString(), rewrite ? undefined : body);
    assert.equal(next.headers['content-type'], rewrite ? undefined : 'text/custom');
    assert.equal(next.headers['content-length'], rewrite || !body ? undefined : '7');
  }
});

test('manual, error, missing-location and ordinary responses obey the redirect policy', async (t) => {
  let result: { status: number; location?: string } = { status: 302, location: '/end' };
  const sent = transport(t, () => result);
  const manual = await guardedFetch(new Request('https://start.test/'), { redirect: 'manual' });
  assert.equal(manual.status, 302); await manual.text();
  assert.equal(sent.length, 1);
  await assert.rejects(guardedFetch('https://start.test/', { redirect: 'error' }), (error: unknown) => error instanceof TypeError && error.cause instanceof Error && error.cause.message === 'unexpected redirect');
  assert.equal(sent.length, 2);
  result = { status: 302 };
  assert.equal((await guardedFetch('https://start.test/')).status, 302);
  result = { status: 200, location: '/ignored' };
  assert.equal((await guardedFetch('https://start.test/')).status, 200);
  assert.equal(sent.length, 4);
});

test('redirect budgets admit the exact number of hops and refuse the next', async (t) => {
  const sent = transport(t, () => {
    assert.ok(sent.length - before <= budget + 1, 'the redirect budget must stop the next request');
    return { status: 302, location: '/again' };
  });
  let before = 0, budget = 0;
  for (const maxRedirects of [0, 1, 5]) {
    before = sent.length; budget = maxRedirects;
    await assert.rejects(guardedFetch('https://start.test/', {}, { maxRedirects }), (error: unknown) => error instanceof TypeError && error.cause instanceof Error && error.cause.message === 'too many redirects');
    assert.equal(sent.length - before, maxRedirects + 1);
  }
});

test('every redirect rechecks scheme, URL credentials and literal address policy', async (t) => {
  let destination = '';
  const sent = transport(t, () => ({ status: 302, location: destination }));
  for (destination of ['file:///synthetic', 'ftp://other.test/', 'https://user@other.test/', 'https://:password@other.test/', 'http://169.254.169.254/', 'http://127.0.0.1/']) {
    const before = sent.length;
    await assert.rejects(guardedFetch('https://start.test/'), OutboundRefused);
    assert.equal(sent.length, before + 1, destination);
  }
  for (const input of ['file:///synthetic', 'https://user@start.test/', 'https://:password@start.test/']) {
    const before = sent.length;
    await assert.rejects(guardedFetch(input), OutboundRefused);
    assert.equal(sent.length, before);
  }
  await assert.rejects(guardedFetch('not a URL'), /The request address is not a valid URL/);
});

test('caller cancellation and configured fetchers preserve the refusal decision', async (t) => {
  const sent = transport(t, () => ({ status: 200 }));
  const controller = new AbortController();
  const reason = new Error('synthetic cancellation');
  controller.abort(reason);
  await assert.rejects(guardedFetch('https://start.test/', { signal: controller.signal }), (error) => error === reason);
  await assert.rejects(guardedFetch(new Request('https://start.test/', { signal: controller.signal })), (error) => error === reason);
  assert.equal(sent.length, 0);
  const response = await guardedFetch(new Request('https://start.test/', { signal: controller.signal }), { signal: null });
  await response.text();
  assert.equal(sent.length, 1);
  const fetcher = guardedFetcher({ policy: { private: true } });
  assert.equal(await (await fetcher('http://127.0.0.1/')).text(), '');
});

test('script transfers have a minimum rate while operator transfers do not', async (t) => {
  let stream = new PassThrough();
  transport(t, () => ({ status: 200, stream }));
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.timers.enable({ apis: ['setInterval'] });
  const script = await outboundContext.run({ file: 'synthetic', account: 'test' }, () => guardedFetch('https://start.test/', {}, { timeoutMs: Infinity }));
  const refused = assert.rejects(script.text(), /transfer rate/);
  now += 15_000; t.mock.timers.tick(15_000);
  await refused;
  stream = new PassThrough();
  const operator = await guardedFetch('https://start.test/', {}, { timeoutMs: Infinity });
  now += 15_000; t.mock.timers.tick(15_000);
  stream.end('ok');
  assert.equal(await operator.text(), 'ok');
});
