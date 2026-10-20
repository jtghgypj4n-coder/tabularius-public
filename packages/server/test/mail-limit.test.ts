// The send limit for mail through email connections: server-wide and per file, kept across restarts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MailLimit, MAIL_LIMIT_FILE } from '../src/mail-limit.ts';

const folder = () => mkdtempSync(join(tmpdir(), 'tabularius-mail-limit-'));

test('the server-wide and per-file allowances each stop a loop, and free up as the hour passes', () => {
  const dir = folder();
  try {
    const l = new MailLimit(join(dir, MAIL_LIMIT_FILE));
    l.perHour = 3;
    l.perFile = 2;
    let now = 1_000_000;
    l.clock = () => now;
    assert.equal(l.take(['A']), undefined);
    assert.equal(l.take(['A']), undefined);
    assert.match(l.take(['A'])!, /mail from A through connections is limited to 2 messages an hour/);
    assert.equal(l.take(['B']), undefined);
    // The server's three are used: any file is refused now, with the server-wide reason.
    assert.match(l.take(['C'])!, /^mail through connections is limited to 3 messages an hour/);
    // No files named (a connection for every file): only the server-wide allowance applies.
    assert.match(l.take([])!, /limited to 3/);
    now += 30 * 60_000;
    assert.match(l.take(['B'])!, /limited to 3/, 'half an hour on, nothing has aged out');
    now += 31 * 60_000;
    assert.equal(l.take(['A']), undefined);
    assert.equal(l.take(['A']), undefined);
    assert.match(l.take(['A'])!, /mail from A/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the count survives a restart, is private to the server, and a bad file does not stop mail', () => {
  const dir = folder();
  const path = join(dir, MAIL_LIMIT_FILE);
  const problems: string[] = [];
  try {
    const first = new MailLimit(path);
    first.perFile = 2;
    assert.equal(first.take(['Invoices']), undefined);
    assert.equal(first.take(['Invoices']), undefined);
    assert.equal(statSync(path).mode & 0o077, 0, 'only the server can read it');
    // The server restarts: a new object over the same file still knows.
    const second = new MailLimit(path);
    second.perFile = 2;
    assert.match(second.take(['invoices'])!, /limited to 2/);
    assert.equal(second.take(['Orders']), undefined);
    // Times older than the hour that were saved are forgotten on load.
    writeFileSync(path, JSON.stringify({ all: [1, 2, 3], files: { invoices: [1, 2] } }));
    const third = new MailLimit(path);
    third.perFile = 2;
    assert.equal(third.take(['Invoices']), undefined);
    // A file that is not readable is reported, and counting starts again instead of refusing everything.
    writeFileSync(path, '{not json');
    const fourth = new MailLimit(path, (m) => problems.push(m));
    assert.equal(fourth.take(['Invoices']), undefined);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /could not be read/);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, 'utf8'))).sort(), ['all', 'files']);
    // A folder it cannot write in: every attempt is refused and reported.
    const unwritable = new MailLimit(join(dir, 'missing', MAIL_LIMIT_FILE), (m) => problems.push(m));
    unwritable.perFile = 1;
    assert.match(unwritable.take(['X'])!, /could not be saved; nothing was sent/);
    assert.match(unwritable.take(['X'])!, /could not be saved; nothing was sent/);
    assert.ok(problems.some((m) => /could not be saved/.test(m)));
    assert.ok(!existsSync(join(dir, 'missing')));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('same-millisecond sends keep their multiplicity across restart and expired counts leave the file', () => {
  const dir = folder();
  const path = join(dir, MAIL_LIMIT_FILE);
  try {
    const first = new MailLimit(path);
    first.perHour = 5;
    first.clock = () => 1_000_000;
    for (let i = 0; i < 5; i++) assert.equal(first.take(['A']), undefined);
    const saved = JSON.parse(readFileSync(path, 'utf8')) as { all: number[] };
    assert.equal(saved.all.length, 5);

    const restarted = new MailLimit(path);
    restarted.perHour = 5;
    restarted.clock = () => 1_000_001;
    assert.match(restarted.take(['A'])!, /limited to 5/);

    restarted.clock = () => 4_700_001;
    assert.equal(restarted.take(['A']), undefined);
    const pruned = JSON.parse(readFileSync(path, 'utf8')) as { all: number[] };
    assert.deepEqual(pruned.all, [4_700_001]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('AR-server-edge-08', async () => {
  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const dir = folder();
  const path = join(dir, MAIL_LIMIT_FILE);
  const rename = fs.renameSync;
  writeFileSync(path, JSON.stringify({ all: [], files: {} }));
  fs.renameSync = (from, to) => {
    if (String(to) === path) throw Object.assign(new Error('test write failure'), { code: 'ENOSPC' });
    return rename(from, to);
  };
  syncBuiltinESMExports();
  try {
    const first = new MailLimit(path);
    first.perHour = 1;
    for (const limit of [first, first, new MailLimit(path)]) {
      assert.match(limit.take(['Review']) ?? '', /could not be saved.*nothing was sent/);
    }
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { all: [], files: {} });
    fs.renameSync = rename;
    syncBuiltinESMExports();
    assert.equal(first.take(['Review']), undefined);
    assert.match(first.take(['Review'])!, /limited to 1/);
  } finally {
    fs.renameSync = rename;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});
