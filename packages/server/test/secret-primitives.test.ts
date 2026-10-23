import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSource, checkRepository, allowances } from '../../../scripts/check-secret-primitives.ts';
import { sameSecret } from '../src/secrets.ts';
import { sameSecret as fromStore } from '../../store/src/index.ts';

test('the repository compares no secret except through sameSecret; every other comparison has a reason, and none is stale', () => {
  const result = checkRepository();
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.stale, []);
  assert.ok(result.files > 400, 'the scan read the source tree');
  assert.equal(new Set(allowances.map((a) => `${a.file}:${a.expression}`)).size, allowances.length, 'no entry is listed twice');
  assert.ok(allowances.every((a) => a.reason.trim().length > 20), 'every entry says why it is safe');
});

// The comparisons that were written this way before they went through sameSecret.
const regressions = [
  ['PKCE', "createHash('sha256').update(verifier).digest('base64url') !== row.challenge"],
  ['consent challenge', 'row.challenge !== challenge'],
  ['OIDC nonce', 'claims.nonce !== nonce'],
  ['WebAuthn challenge', 'cd.challenge !== challenge'],
  ['sync review token', 'r.reviewToken !== d.plan.conflicts[i].reviewToken'],
  ['password reuse', 'newPassword === oldPassword'],
  ['admin password rotation', 'this.passwordHash() !== hash'],
  ['Admin API fingerprint', 'session.passwordFingerprint === passwordFingerprint'],
  ['script run ownership', 'run.token !== session.token'],
  ['debug run ownership', 'r.token === session.token'],
  ['lock ownership', 'v.owner === session.token'],
  ['session revocation', 's.token === except'],
  ['local admin file', 'access.token === stored.token'],
  ['import credential digest', 'binding.digest !== digest'],
  ['Buffer equals', 'given.equals(storedHash)'],
  ['Buffer compare', 'Buffer.compare(storedHash, given) === 0'],
] as const;
for (const [label, expression] of regressions) {
  test(`the guard catches the old ${label} comparison`, () => {
    assert.equal(scanSource('packages/server/src/example.ts', `if (${expression}) denied();`).length, 1);
  });
}

test('the guard reads both sides, the operators, wrapped values, method forms, multiline and bracket access', () => {
  for (const expression of ['token === input', 'input == apiKey', 'csrf != expected', 'recoveryCode !== supplied',
    'token.startsWith(value)', 'value.startsWith(token, offset)', "value['startsWith'](token, offset)", 'hash.endsWith(tail)',
    "obj['password_hash'] == value", '(token as string)! === value', 'token\n===\nvalue', "(token ?? '') === supplied", "(password || '') == guess",
    'String(secret) === supplied', "(token ?? '').startsWith(prefix)", '(condition ? token : other) === supplied']) {
    assert.equal(scanSource('packages/web/src/example.ts', expression).length, 1, expression);
  }
  // Said in a comment or a string, or a test of the kind of value rather than its content, is not a comparison of a secret.
  assert.deepEqual(scanSource('packages/server/src/example.ts', '// token === guess\nconst s = "token == guess"; typeof token === "string"; token !== undefined; token.length === 32; sameSecret(token, input);'), []);
  // An entry is tied to its exact file and expression text, never a folder or a name pattern.
  assert.equal(scanSource('packages/server/src/new-auth.ts', 'token.startsWith(PREFIX)').length, 1);
  assert.ok(!allowances.some((a) => a.file === 'packages/server/src/new-auth.ts'));
});

test('sameSecret compares exact strings, in either order, and nothing that is not a string', () => {
  assert.equal(fromStore, sameSecret, 'the server and the store use one helper');
  for (const value of ['', 'synthetic-secret', 'é', '🔒', '\ud800', '\u0000']) assert.equal(sameSecret(value, value), true);
  for (const [a, b] of [['a', 'é'], ['é', 'é'], ['secret', 'secret-more'], ['\ud800', '\ud801'], ['\ud800', '�'], ['a\0b', 'a'], ['secret', 'Secret']]) {
    assert.equal(sameSecret(a, b), false, JSON.stringify([a, b]));
    assert.equal(sameSecret(b, a), false);
  }
  // A lookup that found nothing is a refusal, not a match with another empty answer.
  for (const bad of [null, undefined, 1, {}, ['secret'], Buffer.from('secret')]) {
    assert.equal(sameSecret(bad, 'secret'), false);
    assert.equal(sameSecret('secret', bad), false);
    assert.equal(sameSecret(bad, bad), false);
  }
});
