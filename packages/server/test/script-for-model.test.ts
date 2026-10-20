// A script's text is shown to a model (test cases, documentation): secrets never go with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptForModel } from '../src/script-for-model.ts';
import { embeddedCredential, isCredentialName } from '../../scripts/src/credentials.ts';

const step = (stepId: number, name: string, line: string) => ({ stepId, name, enabled: true, line });
const text = (...lines: ReturnType<typeof step>[]) => scriptForModel(lines);

test('a literal in a step that names a password is hidden, and the step stays readable', () => {
  const out = text(step(141, 'Set Variable', 'Set Variable [ $password ; Value: "hunter2-secret" ]'));
  assert.doesNotMatch(out, /hunter2-secret/);
  assert.match(out, /Set Variable/);
  assert.match(out, /\$password/);
});

test('a key with a well-known prefix is hidden even in an ordinary step', () => {
  const key = 'sk-ant-api03-' + 'a1b2c3d4'.repeat(6);
  const out = text(step(141, 'Set Variable', `Set Variable [ $x ; Value: "${key}" ]`));
  assert.doesNotMatch(out, /sk-ant-api03/);
});

test('credentials in a URL and a Bearer header are hidden', () => {
  const out = text(
    step(141, 'Set Variable', 'Set Variable [ $u ; Value: "https://admin:p4ssw0rd-x@example.com/hook" ]'),
    step(141, 'Set Variable', 'Set Variable [ $h ; Value: "Authorization: Bearer abcdef0123456789abcdef" ]'),
  );
  assert.doesNotMatch(out, /p4ssw0rd-x/);
  assert.doesNotMatch(out, /abcdef0123456789abcdef/);
});

test('Insert from URL has its URL and cURL options hidden whatever they say', () => {
  const out = text(step(160, 'Insert from URL', 'Insert from URL [ Select ; With dialog: Off ; Target: $r ; "https://api.example.com/v1/items?id=9" ; cURL options: "--header \\"X-Thing: zzz-visible\\"" ]'));
  assert.doesNotMatch(out, /api\.example\.com/);
  assert.doesNotMatch(out, /zzz-visible/);
  assert.match(out, /Insert from URL/);
});

test('an ordinary step is left as written', () => {
  const line = 'Go to Layout [ "Invoices" ]';
  assert.equal(text(step(6, 'Go to Layout', line)), line);
});

for (const name of ['ssn', 'iban', 'cvv', 'otp', 'jwt', 'session_token', 'private_key', 'passcode', 'contraseña', 'contrasena', 'senha', "parola d'ordine", 'parola d’ordine', 'parola_d_ordine', 'parola-d-ordine', 'mot de passe', 'mot_de_passe', 'mot-de-passe', 'passwort', 'kennwort']) {
  test(`model script text uses the shared credential policy for ${name} across lines`, () => {
    const literal = 'Q7v9z2Lm4N8k6R1x';
    const line = `Set Variable [ $${name} ; Value:\n"${literal}" ]`;
    assert.ok(!text(step(141, 'Set Variable', line)).includes(literal));
    assert.equal(isCredentialName(name), true);
    assert.ok(embeddedCredential({ steps: [{ ...step(141, 'Set Variable', line), params: { variable: `$${name}`, value: `"${literal}"` } }] }));
  });
}
