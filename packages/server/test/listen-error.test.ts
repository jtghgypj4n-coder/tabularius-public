// The messages for a port that cannot be opened are the ones people search for, so they name the port and the way out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listenError } from '../src/listen-error.ts';

const failure = (code: string) => Object.assign(new Error(`listen ${code}`), { code });

test('a port in use says which port and how to find and avoid the other program', () => {
  const e = listenError(failure('EADDRINUSE'), 8080, '0.0.0.0');
  assert.match(e.message, /port 8080 is in use/);
  assert.match(e.message, /0\.0\.0\.0:8080/);
  assert.match(e.message, /--port/);
  assert.match(e.message, /lsof -nP -iTCP:8080 -sTCP:LISTEN/);
});

test('a port that needs administrator rights says so and offers a way out', () => {
  const e = listenError(failure('EACCES'), 443, '::');
  assert.match(e.message, /port 443 needs administrator rights/);
  assert.match(e.message, /above 1024/);
});

test('any other error comes back unchanged', () => {
  const original = failure('EINVAL');
  assert.equal(listenError(original, 1, 'x'), original);
});
