// A request that could not be made is told to a person as a sentence about what to check, not as the system's error code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkProblem } from '../src/net-guard.ts';
import { problems } from '../../../scripts/error-strings-lib.ts';

const failure = (code: string, message = `connect ${code} 127.0.0.1:80`) => new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });

test('each cause a request can have is a sentence with something to check', () => {
  const sentences = new Map([
    ['ENOTFOUND', /not found.*spelling/],
    ['EAI_AGAIN', /not found/],
    ['ECONNREFUSED', /refused the connection.*running/],
    ['ECONNRESET', /cut off.*try again/],
    ['ETIMEDOUT', /did not answer in time/],
    ['UND_ERR_CONNECT_TIMEOUT', /did not answer in time/],
    ['EHOSTUNREACH', /cannot be reached/],
    ['CERT_HAS_EXPIRED', /certificate was not accepted/],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', /certificate was not accepted/],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', /certificate was not accepted/],
  ]);
  for (const [code, expected] of sentences) {
    const text = networkProblem(failure(code));
    assert.match(text, expected, code);
    assert.deepEqual(problems(text), [], code);
  }
});

test('a fetch with no recognised cause says the server could not be reached, and its own words are kept otherwise', () => {
  assert.equal(networkProblem(new TypeError('fetch failed')), 'the server could not be reached');
  assert.match(networkProblem(new TypeError('fetch failed', { cause: new Error('unexpected redirect') })), /redirected the request, and this request does not follow/);
  assert.match(networkProblem(new TypeError('fetch failed', { cause: new Error('too many redirects') })), /too many times/);
  assert.equal(networkProblem(new Error('the request took longer than the time limit')), 'the request took longer than the time limit');
  assert.equal(networkProblem('plain text'), 'plain text');
});
