// Passwords for commands: asked for hidden, twice, in a terminal; read from a pipe otherwise.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { readSecret, type SecretInput } from '../src/prompt.ts';

const stubRoot = mkdtempSync(join(tmpdir(), 'tabularius-prompt-stubs-'));
const commandMarker = join(stubRoot, 'unexpected-command');
const stubPath = join(stubRoot, 'bin');
mkdirSync(stubPath);
for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
  writeFileSync(join(stubPath, name), '#!/bin/sh\nprintf x >> "$TABULARIUS_TEST_COMMAND_MARKER"\nexit 99\n', { mode: 0o755 });
}
process.env.PATH = stubPath;
process.env.TABULARIUS_TEST_COMMAND_MARKER = commandMarker;
after(() => {
  try {
    assert.equal(existsSync(commandMarker), false, 'a service, upgrade, install or network command was run');
  } finally {
    rmSync(stubRoot, { recursive: true, force: true });
  }
});

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

test('in a terminal: navigation and Delete sequences never enter the password, even across writes', async () => {
  const keys = ['\x1b[D', '\x1b[3~', '\x1b[H', '\x1b[F', '\x1b[A', '\x1bOA', '\x1b[1;', '5D', '\x1b[1;5$D'];
  const t = terminal();
  t.type(['abc', ...keys, 'X\r'], ['abc', ...keys, 'X\r']);
  assert.equal(await readSecret('Password', { confirm: true, input: t.input, output: t.output }), 'abcX');
  assert.doesNotMatch(t.shown(), /abcX/);
});

test('in a terminal: Backspace still removes the previous character after an arrow key', async () => {
  const t = terminal();
  t.type(['abc', '\x1b[D', '\x7f', 'X\r']);
  assert.equal(await readSecret('Password', { input: t.input, output: t.output }), 'abX');
});

test('in a terminal: Ctrl-U clears the entry and Ctrl-D still cancels an empty one', async () => {
  const cleared = terminal();
  cleared.type(['abc', '\x1b[D', '\x15', 'xyz\r']);
  assert.equal(await readSecret('Password', { input: cleared.input, output: cleared.output }), 'xyz');
  const cancelled = terminal();
  cancelled.type(['\x1b[D', '\x04']);
  await assert.rejects(readSecret('Password', { input: cancelled.input, output: cancelled.output }), /cancelled/);
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
