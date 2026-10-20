// Digest authentication against the worked examples in RFC 2617 and RFC 7616, and the challenge reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestAuthorization, parseDigestChallenge } from '../src/digest-auth.ts';

const response = (header: string) => /response="([0-9a-f]+)"/.exec(header)![1];

test('RFC 2617: the MD5 example gives the published response', () => {
  const challenge = parseDigestChallenge('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"')!;
  assert.equal(challenge.algorithm, 'MD5');
  assert.equal(challenge.qop, 'auth');
  const h = digestAuthorization(challenge, { method: 'GET', uri: '/dir/index.html', user: 'Mufasa', password: 'Circle Of Life', cnonce: '0a4f113b' });
  assert.equal(response(h), '6629fae49393a05397450978507c4ef1');
  assert.match(h, /^Digest username="Mufasa", realm="testrealm@host.com", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", uri="\/dir\/index.html", algorithm=MD5, qop=auth, nc=00000001, cnonce="0a4f113b"/);
  assert.match(h, /opaque="5ccc069c403ebaf9f0171e9517f40e41"$/);
});

test('RFC 7616: the MD5 and SHA-256 examples give the published responses', () => {
  const base = 'realm="http-auth@example.org", qop="auth, auth-int", nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"';
  const o = { method: 'GET', uri: '/dir/index.html', user: 'Mufasa', password: 'Circle of Life', cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ' };
  assert.equal(response(digestAuthorization(parseDigestChallenge(`Digest ${base}, algorithm=MD5`)!, o)), '8ca523f5e9506fed4657c9700eebdbec');
  assert.equal(response(digestAuthorization(parseDigestChallenge(`Digest ${base}, algorithm=SHA-256`)!, o)), '753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1');
});

test('no qop gives the RFC 2069 form, with no nc or cnonce; the count is written in hex', () => {
  const c = parseDigestChallenge('Digest realm="r", nonce="n"')!;
  assert.equal(c.qop, undefined);
  const old = digestAuthorization(c, { method: 'get', uri: '/x', user: 'u', password: 'p' });
  assert.doesNotMatch(old, /nc=|cnonce=|qop=/);
  const q = parseDigestChallenge('Digest realm="r", nonce="n", qop=auth')!;
  assert.match(digestAuthorization(q, { method: 'GET', uri: '/x', user: 'u', password: 'p', nc: 26, cnonce: 'c' }), /nc=0000001a/);
});

test('the challenge reader picks the Digest one among several, and refuses what it cannot answer', () => {
  assert.equal(parseDigestChallenge('Basic realm="x"'), undefined);
  assert.equal(parseDigestChallenge(null), undefined);
  assert.equal(parseDigestChallenge('Digest realm="x", nonce="n", qop="auth-int"'), undefined, 'auth-int only');
  assert.equal(parseDigestChallenge('Digest realm="x", nonce="n", algorithm=SHA-512-256'), undefined, 'an algorithm not supported');
  assert.equal(parseDigestChallenge('Digest realm="x"'), undefined, 'no nonce');
  const both = parseDigestChallenge('Basic realm="b", Digest realm="d", nonce="n1", algorithm=sha-256, qop="auth", Basic realm="c"')!;
  assert.deepEqual([both.realm, both.nonce, both.algorithm], ['d', 'n1', 'SHA-256']);
  assert.equal(parseDigestChallenge('Digest realm="a\\"b", nonce="n"')!.realm, 'a"b');
  // Digest first, then a weaker one: the second challenge's parameters don't leak into it.
  assert.equal(parseDigestChallenge('Digest realm="d", nonce="n", Basic realm="other"')!.realm, 'd');
});
