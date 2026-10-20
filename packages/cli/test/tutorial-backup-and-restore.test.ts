// docs/tutorials/backup-and-restore.md is run: its `sh run` blocks are executed in order against a throwaway
// folder. The page's server command runs on a free port and stops before the offline steps. No sample file needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../store/src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const main = join(root, 'packages', 'cli', 'src', 'main.ts');
const page = readFileSync(join(root, 'docs', 'tutorials', 'backup-and-restore.md'), 'utf8');

const freePort = () => new Promise<number>((ok, no) => {
  const s = createServer();
  s.on('error', no);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
});

test('the backup-and-restore tutorial works as written', { timeout: 120_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), 'tabularius-tutorial-backup-'));
  const folder = join(work, 'tabularius-backup-tutorial');
  const file = join(folder, 'Contacts.openhbam.sqlite');
  let server: ReturnType<typeof spawn> | undefined;
  const stop = async () => {
    if (!server || server.exitCode !== null) return;
    const gone = new Promise((ok) => server!.once('exit', ok));
    server.kill('SIGINT');
    const timer = setTimeout(() => server!.kill('SIGKILL'), 10_000);
    try { await gone; } finally { clearTimeout(timer); }
    assert.equal(server.exitCode, 0, 'the tutorial server stopped cleanly');
  };
  try {
    const port = await freePort();
    const adapt = (s: string) => s.replaceAll('~/tabularius-backup-tutorial', '"$HOME/tabularius-backup-tutorial"').replace(/\b8080\b/g, String(port));
    const blocks = [...page.matchAll(/^```(\w+)( run)?\n([\s\S]*?)^```$/gm)]
      .map((m) => ({ lang: m[1], run: !!m[2], code: m[3] }));
    const shell = blocks.filter((b) => b.lang === 'sh' && b.run).map((b) => adapt(b.code));
    const serve = blocks.find((b) => b.lang === 'sh' && !b.run && /tabularius serve/.test(b.code));
    assert.equal(shell.length, 11, 'all eleven runnable steps are checked');
    assert.ok(serve, 'the page shows how to start the server');
    const env = { ...process.env, HOME: work, TABULARIUS_PASSWORD: undefined, TABULARIUS_BACKUP_KEY: undefined,
      TABULARIUS_TUTORIAL_NODE: process.execPath, TABULARIUS_TUTORIAL_CLI: main };
    const command = '"$TABULARIUS_TUTORIAL_NODE" --no-warnings "$TABULARIUS_TUTORIAL_CLI" "$@"';
    const run = (step: number) => {
      const r = spawnSync('bash', ['-ec', `tabularius() { ${command}; }\n${shell[step]}`], {
        cwd: work, encoding: 'utf8', env, timeout: 30_000,
      });
      assert.equal(r.status, 0, `step ${step + 1}: ${r.error ?? ''}\n${r.stdout}${r.stderr}`);
      return r.stdout;
    };
    const passwordWorks = () => {
      const store = new Store(file, 'Contacts');
      try { assert.equal(store.verify('Admin', 'a long enough password', ''), true); }
      finally { store.close(); }
    };

    assert.match(run(0), /created Contacts; set a password with:/);
    assert.ok(existsSync(file), 'new made the hosted store');
    assert.match(run(1), /password set for Admin in Contacts/);
    passwordWorks();
    assert.match(run(2), /"op": "createTable"/);
    const store = new Store(file, 'Contacts');
    try {
      assert.deepEqual(store.schema.tables.map((t) => t.name), ['Contacts']);
      assert.deepEqual(store.schema.tables[0].fields.map((f) => f.name), ['Name']);
    } finally { store.close(); }

    server = spawn('bash', ['-ec', `tabularius() { exec ${command}; }\n${adapt(serve.code)}`], { cwd: work, env, stdio: 'ignore' });
    for (const end = Date.now() + 60_000; ; await new Promise((ok) => setTimeout(ok, 100))) {
      assert.equal(server.exitCode, null, 'the tutorial server is running');
      if (await fetch(`http://127.0.0.1:${port}/fmi/data/vLatest/databases`).then((r) => r.status < 500, () => false)) break;
      assert.ok(Date.now() < end, 'the tutorial server came up');
    }
    assert.equal(run(3), 'made record 1 Ada Lovelace\nmade record 2 Grace Hopper\n');
    await stop();
    const before = run(4);
    assert.deepEqual(before.trim().split('\n').map((line) => JSON.parse(line)), [
      { recordId: 1, fields: { Name: 'Ada Lovelace' } },
      { recordId: 2, fields: { Name: 'Grace Hopper' } },
    ]);

    assert.match(run(5), /backed up 1 files to /);
    const sets = readdirSync(join(folder, 'Backups'));
    assert.equal(sets.length, 1, 'only the manual backup was taken');
    assert.match(sets[0], /^\d{4}-\d{2}-\d{2}_\d{6}$/);
    const backup = join(folder, 'Backups', sets[0], 'Contacts.openhbam.sqlite');
    assert.ok(existsSync(backup), 'the set contains the store');
    assert.match(run(6), /checked: 1 file ok/);
    assert.equal(run(7), 'the hosted store is gone\n');
    assert.equal(existsSync(file), false, 'the damage step deleted the hosted store');
    assert.ok(existsSync(backup), 'the damage step kept the backup');
    assert.equal(run(8), 'restored Contacts.openhbam.sqlite\n');
    assert.ok(existsSync(file), 'restore put the store back');
    // With no current file to carry sign-in state from, the restored accounts have no password until one is set.
    const bare = new Store(file, 'Contacts');
    try { assert.equal(bare.verify('Admin', 'a long enough password', ''), false); } finally { bare.close(); }
    assert.match(run(9), /password set for Admin in Contacts/);
    assert.equal(run(10), before, 'both records and their IDs are back');
    passwordWorks();
  } finally {
    try { await stop(); }
    finally { rmSync(work, { recursive: true, force: true, maxRetries: 5 }); }
  }
});
