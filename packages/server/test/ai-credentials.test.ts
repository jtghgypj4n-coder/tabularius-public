import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiCredentials, isWorkspaceId } from '../src/ai-credentials.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'hbam-aicred-'));
  let t = 1_000_000;
  const clock = { now: () => t, tick: (ms = 1500) => (t += ms) };
  let mtime = 1_700_000_000;
  const write = (file: string, text: string, mode = 0o600) => {
    writeFileSync(file, text, { mode });
    chmodSync(file, mode);
    mtime += 10; // the stamp is mtime and size; make each write differ
    utimesSync(file, mtime, mtime);
  };
  return { dir, clock, write, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('isWorkspaceId accepts wrkspc_ ids only', () => {
  assert.ok(isWorkspaceId('wrkspc_01AbC-d_9'));
  for (const bad of ['', 'wrkspc_', 'workspace_1', 'wrkspc_a b', 'wrkspc_a\n', ' wrkspc_a']) assert.equal(isWorkspaceId(bad), false, JSON.stringify(bad));
});

test('options give the key and workspace without any file', () => {
  const c = new AiCredentials({ apiKey: 'k1', workspaceId: 'wrkspc_a' });
  assert.equal(c.apiKey, 'k1');
  assert.equal(c.workspaceId, 'wrkspc_a');
  assert.equal(c.problem, undefined);
});

test('a key file is read again when it changes, at most once a second, and bumps version', { skip: process.platform === 'win32' }, () => {
  const s = setup();
  try {
    const f = join(s.dir, 'key');
    s.write(f, 'sk-one\n');
    const c = new AiCredentials({ keyFile: f, apiKey: 'sk-one', now: s.clock.now });
    assert.equal(c.apiKey, 'sk-one', 'the first read is the apiKey option');
    const v = c.version;
    s.write(f, 'sk-two-longer\n');
    assert.equal(c.apiKey, 'sk-one', 'within a second the file is not looked at again');
    s.clock.tick();
    assert.equal(c.apiKey, 'sk-two-longer', 'trimmed');
    assert.equal(c.version, v + 1);
    s.clock.tick();
    assert.equal(c.apiKey, 'sk-two-longer');
    assert.equal(c.version, v + 1, 'unchanged file: no new version');
  } finally { s.done(); }
});

test('a key file readable by others is refused and the previous key stays; the message never holds the key', { skip: process.platform === 'win32' }, () => {
  const s = setup();
  try {
    const f = join(s.dir, 'key');
    s.write(f, 'sk-good');
    const c = new AiCredentials({ keyFile: f, apiKey: 'sk-good', now: s.clock.now });
    s.clock.tick();
    assert.equal(c.apiKey, 'sk-good');
    s.write(f, 'sk-leaky-key', 0o644);
    s.clock.tick();
    assert.equal(c.apiKey, 'sk-good');
    assert.match(c.problem!, /chmod 600/);
    assert.ok(!c.problem!.includes('sk-leaky-key'));
    s.write(f, 'sk-fixed', 0o600);
    s.clock.tick();
    assert.equal(c.apiKey, 'sk-fixed');
    assert.equal(c.problem, undefined, 'cleared once a good file is read');
  } finally { s.done(); }
});

test('an empty key file keeps the previous key and says why', { skip: process.platform === 'win32' }, () => {
  const s = setup();
  try {
    const f = join(s.dir, 'key');
    s.write(f, 'sk-good');
    const c = new AiCredentials({ keyFile: f, apiKey: 'sk-option', now: s.clock.now });
    s.write(f, '  \n');
    s.clock.tick();
    assert.equal(c.apiKey, 'sk-option');
    assert.match(c.problem!, /empty/);
  } finally { s.done(); }
});

test('the workspace file wins when valid; a bad or missing file falls back to the option', () => {
  const s = setup();
  try {
    const f = join(s.dir, 'ws');
    s.write(f, 'wrkspc_file\n');
    const c = new AiCredentials({ workspaceFile: f, workspaceId: 'wrkspc_opt', now: s.clock.now });
    assert.equal(c.workspaceId, 'wrkspc_file');
    const v = c.version;
    s.write(f, 'not a workspace id');
    s.clock.tick();
    assert.equal(c.workspaceId, 'wrkspc_opt');
    assert.equal(c.version, v + 1);
    rmSync(f);
    s.clock.tick();
    assert.equal(c.workspaceId, 'wrkspc_opt');
  } finally { s.done(); }
});
