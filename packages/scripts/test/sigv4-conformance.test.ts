import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import vectors from './crypto-aws-vectors.json' with { type: 'json' };
import { signSigV4 } from '../src/sigv4.ts';

// Independent oracle for the two header-free GET vectors whose raw request targets
// contain characters fetch must escape. Check the published raw-target signature
// first, then the canonical path produced after the engine's URL parsing.
function rawTargetSignature(path: string, host: string, c: typeof vectors.cases[number]['context']): string {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();
  const stamp = new Date(c.timestamp).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const scope = `${day}/${c.region}/${c.service}/aws4_request`;
  const canonical = `GET\n${path}\n\nhost:${host}\nx-amz-date:${stamp}\n\nhost;x-amz-date\n${sha('')}`;
  const key = hmac(hmac(hmac(hmac('AWS4' + c.credentials.secret_access_key, day), c.region), c.service), 'aws4_request');
  return createHmac('sha256', key).update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha(canonical)}`).digest('hex');
}

for (const v of vectors.cases) test(`AWS SigV4 ${v.name}`, { skip: !v.context.normalize ? 'not covered: generic signer has no unnormalized mode' : false }, () => {
  const [head, ...bodyParts] = v.request.split('\n\n');
  const lines = head.split('\n');
  const [, method, path] = /^(\S+) (.*) HTTP\/1.1$/.exec(lines.shift()!)!;
  const headers: Record<string, string> = {};
  let last = '';
  for (const line of lines) {
    if (!line) continue;
    if (/^[ \t]/.test(line)) { headers[last] += ' ' + line.trim(); continue; }
    const colon = line.indexOf(':');
    last = line.slice(0, colon).toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers[last] = headers[last] === undefined ? value : headers[last] + ',' + value;
  }
  const body = bodyParts.join('\n\n');
  const c = v.context;
  if (c.credentials.token && !('omit_session_token' in c && c.omit_session_token)) headers['x-amz-security-token'] = c.credentials.token;
  if (c.sign_body) headers['x-amz-content-sha256'] = createHash('sha256').update(body).digest('hex');
  // The engine/fetch parse URLs before sending: raw spaces and Unicode become
  // escaped wire bytes, which generic SigV4 must encode a second time.
  const url = new URL(`https://${headers.host}${path}`);
  let expected = v.signature;
  if (v.name === 'get-space-normalized' || v.name === 'get-utf8') {
    assert.equal(rawTargetSignature(path.split('/').map(encodeURIComponent).join('/'), headers.host, c), v.signature);
    expected = rawTargetSignature(url.pathname.split('/').map(encodeURIComponent).join('/'), headers.host, c);
  }
  const signed = signSigV4({ method, url: url.href, headers, body }, {
    spec: `aws:amz:${c.region}:${c.service}`, user: `${c.credentials.access_key_id}:${c.credentials.secret_access_key}`,
  }, new Date(c.timestamp));
  assert.equal(signed.Authorization.split('Signature=')[1], expected);
});

for (const service of ['execute-api', 's3']) test(`SigV4 ${service} signs the escaped path and query fetch sends`, () => {
  const sign = (path: string) => signSigV4({ method: 'GET', url: 'https://s.com' + path, headers: {} },
    { spec: `aws:amz:us-east-1:${service}`, user: 'generated:secret' }, new Date('2015-08-30T12:36:00Z')).Authorization;
  for (const [raw, escaped] of [['/a b/', '/a%20b/'], ['/café', '/caf%C3%A9']]) {
    assert.equal(sign(raw), sign(escaped));
    assert.equal(sign(raw + '?q=café + x'), sign(escaped + '?q=caf%C3%A9%20+%20x'));
    assert.notEqual(sign(escaped), sign(escaped.replaceAll('%', '%25')), 'existing escapes retain their service-specific encoding');
  }
});

for (const service of ['execute-api', 's3']) test(`SigV4 ${service} signs a literal percent sign instead of refusing the request`, () => {
  const sign = (url: string) => signSigV4({ method: 'GET', url, headers: {} }, { spec: `aws:amz:us-east-1:${service}`, user: 'generated:secret' }, new Date('2015-08-30T12:36:00Z')).Authorization;
  assert.match(sign('https://s.com/50%off'), /Signature=[0-9a-f]{64}/);
  assert.match(sign('https://s.com/?d=50%off'), /Signature=[0-9a-f]{64}/);
  assert.notEqual(sign('https://s.com/50%off'), sign('https://s.com/50off'));
  if (service === 's3') assert.equal(sign('https://s.com/?d=50%off'), sign('https://s.com/?d=50%25off'));
});

test('SigV4 treats a literal query plus as a plus, not form-encoded space', () => {
  const sign = (query: string) => signSigV4({ method: 'GET', url: 'http://127.0.0.1/?q=' + query, headers: {} }, { spec: 'aws:amz:us-east-1:service', user: 'generated:secret' }, new Date('2015-08-30T12:36:00Z')).Authorization;
  assert.equal(sign('+'), sign('%2B'));
  assert.notEqual(sign('+'), sign('%20'));
});

test('SigV4 excludes hop-by-hop, proxy and Connection-nominated headers from the signature', () => {
  const sign = (headers: Record<string, string>) => signSigV4({ method: 'GET', url: 'http://127.0.0.1/', headers },
    { spec: 'aws:amz:us-east-1:s3', user: 'generated:secret' }, new Date('2015-08-30T12:36:00Z'));
  const expected = sign({ 'x-end-to-end': 'signed' });
  const transport = { Connection: 'keep-alive, X-Connection-Only', 'Keep-Alive': 'timeout=5', TE: 'trailers', Trailer: 'Digest', Upgrade: 'websocket',
    'Proxy-Authorization': 'Basic generated', 'Proxy-Authenticate': 'generated', 'Proxy-Connection': 'keep-alive', 'Proxy-Custom': 'generated',
    'X-Connection-Only': 'transport', 'Transfer-Encoding': 'chunked' };
  const signed = sign({ ...transport, 'x-end-to-end': 'signed' });
  assert.equal(signed.Authorization, expected.Authorization);
  for (const name of Object.keys(transport)) assert.ok(signed[name.toLowerCase()], 'excluded headers remain available to the transport');
  assert.notEqual(sign({ 'x-end-to-end': 'changed' }).Authorization, expected.Authorization);
});

test('SigV4 canonicalizes percent-encoded octets without a UTF-8 decoding error', () => {
  const sign = (path: string, service = 's3') => signSigV4({ method: 'GET', url: 'http://127.0.0.1' + path, headers: {} },
    { spec: `aws:amz:us-east-1:${service}`, user: 'generated:secret' }, new Date('2015-08-30T12:36:00Z')).Authorization;
  assert.equal(sign('/%ff/%80/%c0%af'), sign('/%FF/%80/%C0%AF'));
  assert.notEqual(sign('/%FF'), sign('/%EF%BF%BD'), 'invalid UTF-8 bytes must not turn into replacement characters');
  assert.notEqual(sign('/%FF'), sign('/%25FF'), 'existing escapes must not be double encoded for S3');
  assert.equal(sign('/%7e/%61/%e2%82%ac'), sign('/~/a/€'));
  assert.notEqual(sign('/a%2fb'), sign('/a/b'), 'an escaped slash stays part of its segment');
  for (const service of ['s3', 'service']) {
    assert.equal(sign('/?%ff=%80&x=%c0%af', service), sign('/?x=%C0%AF&%FF=%80', service));
    assert.notEqual(sign('/?q=%FF', service), sign('/?q=%EF%BF%BD', service));
    assert.notEqual(sign('/?q=%FF', service), sign('/?q=%25FF', service));
  }
});

test('SigV4 rejects header injection, dates and credential inputs', () => {
  const req = { method: 'GET', url: 'http://127.0.0.1/', headers: {} };
  const option = { spec: 'aws:amz:us-east-1:service', user: 'generated:secret' };
  const at = new Date('2015-08-30T12:36:00Z');
  assert.throws(() => signSigV4({ ...req, headers: { 'x-header': 'x\r\ninjected: yes' } }, option, at));
  assert.throws(() => signSigV4(req, option, new Date(NaN)));
  assert.throws(() => signSigV4(req, { ...option, user: 'no-secret' }, at));
});
