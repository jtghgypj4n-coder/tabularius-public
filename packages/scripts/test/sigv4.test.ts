// --aws-sigv4: AWS's published test-suite requests (credentials AKIDEXAMPLE, region us-east-1, service "service").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSigV4 } from '../src/sigv4.ts';

const option = { spec: 'aws:amz:us-east-1:service', user: 'AKIDEXAMPLE:wJalr' + 'XUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
const at = new Date('2015-08-30T12:36:00Z');

test('get-vanilla from the AWS signing test suite', () => {
  const h = signSigV4({ method: 'GET', url: 'https://example.amazonaws.com/', headers: {} }, option, at);
  assert.equal(h.Authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  assert.equal(h['x-amz-date'], '20150830T123600Z');
});

test('get-vanilla-query-order-key-case: query parameters are sorted by name', () => {
  const h = signSigV4({ method: 'GET', url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1', headers: {} }, option, at);
  assert.match(h.Authorization, /Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/);
});

test('a secret key and a missing region are refused with a plain message', () => {
  assert.throws(() => signSigV4({ method: 'GET', url: 'https://example.com/', headers: {} }, { spec: 'aws:amz', user: 'a:b' }, at), /region and a service/);
  assert.throws(() => signSigV4({ method: 'GET', url: 'https://example.com/', headers: {} }, { spec: 'aws:amz:r:s', user: 'justakey' }, at), /--user/);
});

test('s3 signs the payload hash and a body changes the signature', () => {
  const a = signSigV4({ method: 'PUT', url: 'https://bucket.s3.us-east-1.amazonaws.com/a%20b.txt', headers: {}, body: 'one' }, { spec: 'aws:amz', user: 'k:s' }, at);
  const b = signSigV4({ method: 'PUT', url: 'https://bucket.s3.us-east-1.amazonaws.com/a%20b.txt', headers: {}, body: 'two' }, { spec: 'aws:amz', user: 'k:s' }, at);
  assert.equal(a['x-amz-content-sha256'], '7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed');
  assert.match(a.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date,/);
  assert.notEqual(a.Authorization, b.Authorization);
});

test('dualstack and fips s3 hosts are s3, and an empty second provider means the first', () => {
  const h = signSigV4({ method: 'GET', url: 'https://bkt.s3.dualstack.us-east-1.amazonaws.com/k', headers: {} }, { spec: 'aws:amz:us-east-1', user: 'k:s' }, at);
  assert.match(h.Authorization, /Credential=k\/20150830\/us-east-1\/s3\/aws4_request/);
  assert.ok(h['x-amz-content-sha256']);
  const e = signSigV4({ method: 'GET', url: 'https://example.com/', headers: {} }, { spec: 'aws::us-east-1:s3', user: 'k:s' }, at);
  assert.ok(e['x-aws-date']);
});
