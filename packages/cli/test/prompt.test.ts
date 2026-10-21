// Passwords for commands: asked for hidden, twice, in a terminal; read from a pipe otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { readSecret, type SecretInput } from '../src/prompt.ts';

/** A stand-in terminal: keys are typed into it, and what is shown is kept. */
function terminal() {
  const input = new PassThrough() as PassThrough & SecretInput;
  input.isTTY = true;
  const raw: boolean[] = [];
  input.setRawMode = (on: boolean) => raw.push(on);
  let shown = '';
  const output = new PassThrough();
  output.on('data', (c) => (shown += c));
  // Each answer is typed once the question before it has been asked, in pieces as keys arrive.
  const type = (...answers: string[][]) => {
    let asked = 0;
    output.on('data', (c: Buffer) => {
      if (!/: $/.test(String(c)) || asked >= answers.length) return;
      const keys = answers[asked++];
      setImmediate(() => { for (const k of keys) input.write(k); });
    });
  };
  return { input, output, raw, type, shown: () => shown };
}

test('in a terminal: asked twice, nothing echoed, and asked again when the two differ', async () => {
  const t = terminal();
  // 'password' then 'wrong': no match, so asked again; backspace takes back the x.
  t.type(['pass', 'word\r'], ['wrong\r'], ['secrex', '\x7ft\r'], ['secret\r']);
  assert.equal(await readSecret('New PIN', { confirm: true, input: t.input, output: t.output }), 'secret');
  assert.doesNotMatch(t.shown(), /secret|word|wrong/, 'what is typed is not shown');
  assert.match(t.shown(), /New PIN again: /);
  assert.match(t.shown(), /They don't match/);
  assert.equal(t.raw[0], true, 'raw mode while reading');
  assert.equal(t.raw.at(-1), false, 'and off after');
});

test('in a terminal: Ctrl-C cancels', async () => {
  const t = terminal();
  t.type(['\x03']);
  await assert.rejects(readSecret('Password', { input: t.input, output: t.output }), /cancelled/);
  assert.equal(t.raw.at(-1), false);
});

test('from a pipe: the input, less its final line break', async () => {
  const input = new PassThrough() as PassThrough & SecretInput;
  input.end('piped secret\n');
  assert.equal(await readSecret('Password', { confirm: true, input, output: new PassThrough() }), 'piped secret');
});

test('tabularius admin-password reads a piped password', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-password-'));
  try {
    const main = join(import.meta.dirname, '..', 'src', 'main.ts');
    const env = { ...process.env };
    delete env.TABULARIUS_PASSWORD;
    const out = execFileSync(process.execPath, ['--no-warnings', main, 'admin-password', dir], { input: 'from a pipe, long enough\n', env }).toString();
    assert.match(out, /admin password set/);
    assert.match(readFileSync(join(dir, '.openhbam-admin'), 'utf8'), /\S/);
    const empty = spawnSync(process.execPath, ['--no-warnings', main, 'admin-password', dir], { input: '', env });
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr.toString(), /empty password/);
    // Shorter than the minimum for new passwords: refused, and the stored one is left as it was.
    const before = readFileSync(join(dir, '.openhbam-admin'), 'utf8');
    const short = spawnSync(process.execPath, ['--no-warnings', main, 'admin-password', dir], { input: 'too short\n', env });
    assert.equal(short.status, 1);
    assert.match(short.stderr.toString(), /admin-password: the admin console password needs at least 12 characters/);
    assert.equal(readFileSync(join(dir, '.openhbam-admin'), 'utf8'), before);
    // The operator can lower the minimum.
    const lowered = spawnSync(process.execPath, ['--no-warnings', main, 'admin-password', dir], { input: 'too short\n', env: { ...env, TABULARIUS_MIN_PASSWORD_LENGTH: '4' } });
    assert.equal(lowered.status, 0, lowered.stderr.toString());
    const bad = spawnSync(process.execPath, ['--no-warnings', main, 'admin-password', dir], { input: 'whatever long\n', env: { ...env, TABULARIUS_MIN_PASSWORD_LENGTH: 'many' } });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr.toString(), /TABULARIUS_MIN_PASSWORD_LENGTH is the fewest characters/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
