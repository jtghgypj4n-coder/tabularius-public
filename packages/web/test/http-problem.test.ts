// The sentences for a failure the server gave no words for, and for a connection that never got there. The admin console's
// page carries its own copy of the functions (it is one file, with no build); the two must say the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BROWSER_NETWORK_WORDS, CANT_REACH, httpProblem, plainMessage } from '../src/http-problem.ts';
import { ApiError, unreachableRequest } from '../src/api.ts';
import { problems } from '../../../scripts/error-strings-lib.ts';

const STATUSES = [400, 401, 403, 404, 405, 408, 409, 413, 422, 429, 500, 501, 502, 503, 504, 507];

test('each status is a sentence that says what happened', () => {
  for (const status of STATUSES) {
    const text = httpProblem(status);
    assert.deepEqual(problems(text), [], text);
    assert.ok(text.split(' ').length >= 6, `${status}: ${text}`);
    assert.match(text, /[.]$/, text);
  }
  assert.match(httpProblem(502), /proxy/);
  assert.match(httpProblem(500), /log/);
  assert.match(httpProblem(401), /Sign in again/);
});

test('a lost connection is told as what to check, in every browser\'s words', () => {
  for (const words of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'Network request failed']) {
    assert.equal(plainMessage(new Error(words)), CANT_REACH, words);
    assert.ok(unreachableRequest(new Error(words)), words);
    assert.match(words, BROWSER_NETWORK_WORDS);
  }
  assert.equal(plainMessage(new TypeError('anything the browser says')), CANT_REACH);
  assert.equal(plainMessage(new Error('Layout "Nope" is missing')), 'Layout "Nope" is missing');
  assert.equal(plainMessage(new ApiError(105, 'Layout "Nope" is missing')), 'Layout "Nope" is missing');
  assert.equal(plainMessage('plain'), 'plain');
});

test('the admin console page carries the same functions', () => {
  const page = readFileSync(join(import.meta.dirname, '..', '..', 'server', 'admin', 'index.html'), 'utf8');
  const block = /\/\/ BEGIN http-problem[^\n]*\n([\s\S]*?)\/\/ END http-problem/.exec(page)?.[1];
  assert.ok(block, 'the page has the block');
  const copy = new Function(`${block}\nreturn { httpProblem, plainMessage, CANT_REACH, BROWSER_NETWORK_WORDS };`)() as {
    httpProblem: (n: number) => string; plainMessage: (e: unknown) => string; CANT_REACH: string; BROWSER_NETWORK_WORDS: RegExp;
  };
  assert.equal(copy.CANT_REACH, CANT_REACH);
  assert.equal(copy.BROWSER_NETWORK_WORDS.source, BROWSER_NETWORK_WORDS.source);
  for (let status = 400; status < 600; status++) assert.equal(copy.httpProblem(status), httpProblem(status), String(status));
  for (const e of [new Error('Failed to fetch'), new TypeError('x'), new Error('plain'), 'text']) assert.equal(copy.plainMessage(e), plainMessage(e));
});

test('no screen shows a bare "HTTP" status for a failure that had no words', () => {
  const files = [join(import.meta.dirname, '..', '..', 'server', 'admin', 'index.html')];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith('.ts') && e.name !== 'http-problem.ts') files.push(join(dir, e.name));
    }
  };
  walk(join(import.meta.dirname, '..', 'src'));
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /(\?\?|\|\|)\s*`HTTP \$\{/, `${file} falls back to the status alone`);
});
