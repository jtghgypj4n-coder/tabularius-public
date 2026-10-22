import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { claimFolder } from '../../server/src/backup.ts';
import { STORE_EXT, ENCRYPTED_EXT, encryptFileSync } from '../../server/src/index.ts';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '../src/main.ts');
const key = 'synthetic-encryption-key';
const cli = (...args: string[]) => runCli(main, args, { timeout: 60_000, env: { ...process.env, TABULARIUS_ENCRYPTION_KEY: key } });
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cli-security-'));
  const file = join(dir, 'Synthetic' + STORE_EXT);
  createStore(file);
  return { dir, file };
};

for (const command of ['encrypt', 'decrypt']) test(`AR-cli-plugins-tooling-01 ${command}`, async () => {
  const { dir, file } = setup();
  if (command === 'decrypt') encryptFileSync(file, file + ENCRYPTED_EXT, key);
  const store = new Store(file, 'Synthetic');
  writeFileSync(join(dir, '.openhbam.pid'), String(process.pid));
  const before = new Map(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name))]));
  try {
    const result = await cli(command, dir);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /hosted|running|in use/);
    for (const [name, bytes] of before) assert.deepEqual(readFileSync(join(dir, name)), bytes, name);
    assert.equal(existsSync(file + ENCRYPTED_EXT), command === 'decrypt');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-01 closed folder and release', async () => {
  const { dir, file } = setup();
  try {
    assert.equal((await cli('encrypt', dir)).status, 0);
    assert.equal(existsSync(file), false);
    const release = claimFolder(dir);
    try { assert.equal((await cli('decrypt', dir)).status, 1); } finally { release(); }
    const failed = await runCli(main, ['decrypt', dir], { timeout: 60_000, env: { ...process.env, TABULARIUS_ENCRYPTION_KEY: 'wrong-synthetic-key' } });
    assert.equal(failed.status, 1);
    assert.equal(existsSync(join(dir, '.openhbam.pid')), false);
    assert.equal((await cli('decrypt', dir)).status, 0);
    assert.equal(existsSync(file), true);
    assert.equal(existsSync(join(dir, '.openhbam.pid')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const option of ['--expires-days', '--surfaces', '--layouts']) test(`AR-cli-plugins-tooling-02 ${option}`, async () => {
  const { dir, file } = setup();
  const store = new Store(file, 'Synthetic');
  store.setPassword('Review', 'synthetic-password', '[Full Access]');
  try {
    for (const suffix of [[], [''], ['   '], ['--read-only'], ['--read-only', 'fmrest']]) {
      const result = await cli('token', dir, 'Synthetic', 'create', 'Review', option, ...suffix);
      assert.equal(result.status, 1, JSON.stringify({ option, suffix, ...result }));
      assert.equal(store.apiTokens().length, 0);
    }
    if (option !== '--expires-days') {
      assert.equal((await cli('token', dir, 'Synthetic', 'create', 'Review', option, ', ,')).status, 1);
      assert.equal(store.apiTokens().length, 0);
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-02 mcp', async () => {
  const { dir } = setup();
  try {
    for (const suffix of [[], [''], ['--ai-exclude']]) {
      const result = await cli('mcp', dir, '--account', ...suffix);
      assert.equal(result.status, 1, JSON.stringify(result));
      assert.match(result.stderr, /--account needs/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-02 explicit restrictions', async () => {
  const { dir, file } = setup();
  const store = new Store(file, 'Synthetic');
  store.setPassword('Review', 'synthetic-password', '[Full Access]');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  try {
    const result = await cli('token', dir, 'Synthetic', 'create', 'Review', '--expires-days', '2', '--surfaces', 'fmrest', '--layouts', 'Items', '--read-only');
    assert.equal(result.status, 0, result.stderr);
    const [token] = store.apiTokens();
    assert.equal(token.account, 'Review');
    assert.equal(token.readOnly, true);
    assert.deepEqual(token.surfaces, ['fmrest']);
    assert.deepEqual(token.layouts, ['Items']);
    assert.ok(token.expires);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-01 a decrypt with the wrong key leaves no working file, and the right key still works', async () => {
  const { dir, file } = setup();
  try {
    assert.equal((await cli('encrypt', dir)).status, 0);
    const wrong = await runCli(main, ['decrypt', dir], { timeout: 60_000, env: { ...process.env, TABULARIUS_ENCRYPTION_KEY: 'wrong-synthetic-key' } });
    assert.equal(wrong.status, 1);
    assert.equal(existsSync(file), false, 'a failed decrypt must not leave an empty or partial working file');
    assert.equal(existsSync(file + '.partial'), false);
    assert.equal(existsSync(file + ENCRYPTED_EXT), true);
    const right = await cli('decrypt', dir);
    assert.equal(right.status, 0, right.stderr);
    assert.ok(statSync(file).size > 0);
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o077, 0, 'the decrypted database is private to its owner');
    assert.equal(existsSync(file + ENCRYPTED_EXT), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-01 an encrypt that finds a plaintext database beside an encrypted copy removes nothing', async () => {
  const { dir, file } = setup();
  try {
    // What a server that unlocked the file and stopped without locking it again leaves, or an encrypt that stopped early: the plaintext may be the newer one.
    encryptFileSync(file, file + ENCRYPTED_EXT, key);
    const store = new Store(file, 'Synthetic');
    store.setPassword('Newer', 'synthetic-password', '[Full Access]');
    store.close();
    const before = readFileSync(file);
    const encrypted = readFileSync(file + ENCRYPTED_EXT);
    for (const k of [key, 'wrong-synthetic-key']) {
      const result = await runCli(main, ['encrypt', dir], { timeout: 60_000, env: { ...process.env, TABULARIUS_ENCRYPTION_KEY: k } });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /plaintext may be newer/);
      assert.match(result.stderr, /This database was not changed/);
      assert.match(result.stderr, /-wal, -shm and \.results files/);
    }
    assert.deepEqual(readFileSync(file), before, 'the plaintext is left as it was');
    assert.deepEqual(readFileSync(file + ENCRYPTED_EXT), encrypted);
    assert.deepEqual(readdirSync(dir).filter((name) => /\.(verify|partial)$/.test(name)), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-01 a stale partial file from an earlier encrypt does not stop a new one', async () => {
  const { dir, file } = setup();
  try {
    writeFileSync(file + ENCRYPTED_EXT + '.partial', 'left by a run that was killed');
    const result = await cli('encrypt', dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(file + ENCRYPTED_EXT + '.partial'), false);
    assert.equal((await cli('decrypt', dir)).status, 0);
    assert.ok(statSync(file).size > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-02 token restrictions written --name=value, or twice, are refused instead of ignored', async () => {
  const { dir, file } = setup();
  const store = new Store(file, 'Synthetic');
  store.setPassword('Review', 'synthetic-password', '[Full Access]');
  try {
    for (const extra of [['--surfaces=fmrest'], ['--layouts=Items'], ['--read-only=true'], ['--expires-days=2'], ['--surfaces', 'fmrest', '--surfaces', 'odata'], ['--bogus', 'x']]) {
      const result = await cli('token', dir, 'Synthetic', 'create', 'Review', ...extra);
      assert.equal(result.status, 1, JSON.stringify({ extra, ...result }));
      assert.equal(store.apiTokens().length, 0, JSON.stringify(extra));
    }
    // A label may be blank or begin with a dash: only restrictions need a firm value.
    for (const label of ['', '-x']) {
      const ok = await cli('token', dir, 'Synthetic', 'create', 'Review', '--label', label);
      assert.equal(ok.status, 0, JSON.stringify({ label, ...ok }));
    }
    assert.equal(store.apiTokens().length, 2);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-02 a leading-dash secret does not swallow the option after it', async () => {
  const { dir } = setup();
  try {
    const result = await cli('standby', dir, '--primary', 'https://primary.example.invalid', '--token', '--replace-everything', 'now');
    assert.equal(result.status, 1, JSON.stringify(result));
    assert.match(result.stderr, /--token needs a value, found the option --replace-everything/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-02 a secret that is one of the command\'s own options, or written --name=value, is refused', async () => {
  const { dir } = setup();
  try {
    for (const args of [['--mcp-token', '--allow-script-network'], ['--mcp-token', '--allow-script-network', '--port', '9000'], ['--mcp-token=abc'], ['--replication-token', '--no-backups']]) {
      const result = await cli('serve', dir, ...args);
      assert.equal(result.status, 1, JSON.stringify({ args, ...result }));
      assert.match(result.stderr, /needs a (non-empty )?value|is not read; write the option/, JSON.stringify(args));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-02 a label that is one of the command\'s own options is refused', async () => {
  const { dir, file } = setup();
  const store = new Store(file, 'Synthetic');
  store.setPassword('Review', 'synthetic-password', '[Full Access]');
  try {
    const result = await cli('token', dir, 'Synthetic', 'create', 'Review', '--label', '--surfaces');
    assert.equal(result.status, 1, JSON.stringify(result));
    assert.equal(store.apiTokens().length, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-02 a label cannot swallow --read-only and leave the token writable', async () => {
  const { dir, file } = setup();
  const store = new Store(file, 'Synthetic');
  store.setPassword('Review', 'synthetic-password', '[Full Access]');
  try {
    const result = await cli('token', dir, 'Synthetic', 'create', 'Review', '--label', '--read-only');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(store.apiTokens().length, 1);
    assert.equal(store.apiTokens()[0].readOnly, true);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-02 mcp refuses options it would otherwise ignore instead of starting as administrator', async () => {
  const { dir } = setup();
  try {
    for (const args of [['--account=Review'], ['--acount', 'Review'], ['--ai-exclude=Secret'], ['--ai-exclude'], ['--ai-exclude', '--account', 'Review'], ['--account', 'Review', '--ai-exclude'],
      // The bypasses that started the server as administrator: a misspelled option taken as the exclusion list, a stray word, an extra word.
      ['--ai-exclude', '--acount', 'Review'], ['--ai-exclude', '--account=Review'], ['Review'], ['--account', 'Review', 'extra']]) {
      const result = await runCli(main, ['mcp', dir, ...args], { timeout: 60_000, env: { ...process.env, TABULARIUS_PASSWORD: 'synthetic-password' } });
      assert.equal(result.status, 1, JSON.stringify({ args, ...result }));
      assert.match(result.stderr, /mcp:|--account needs|--ai-exclude needs/, JSON.stringify(args));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
