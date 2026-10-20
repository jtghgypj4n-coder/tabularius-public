// `tabularius calendar-feed` and `tabularius import-ics`: a link made at the command line opens in a calendar app, is shown
// once, and stops working when it is revoked; an .ics file lands in the layout as the account's own records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, serve, STORE_EXT } from '../../server/src/index.ts';
import { createStore } from '../../store/src/index.ts';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (...args: string[]) => runCli(main, args);
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VEVENT\r\nUID:a@test\r\nDTSTART;VALUE=DATE:20261105\r\nSUMMARY:Imported meeting\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

test('CLI: make a feed, import an .ics file, open the link, list without the address, revoke', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-calfeed-cli-'));
  try {
    createStore(join(dir, 'Planner' + STORE_EXT), { mode: 'native' });
    const host = new Host(dir, () => {});
    const store = host.get('Planner')!;
    store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Title' }, { name: 'Day', type: 'date' }] }]);
    store.savePrivilegeSet({ name: 'Planner', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
    store.setPassword('ann', 'pw', 'Planner');
    store.setPassword('off', 'pw', 'Planner');
    store.setAccountActive('off', false);
    store.create('Events', { Title: 'Existing', Day: '2026-10-19' });
    await host.close();

    // A bad request makes no token.
    const bad = await cli('calendar-feed', dir, 'Planner', 'create', '--account', 'ann', '--layout', 'Events', '--start', 'Title');
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /start must be a date or timestamp field|Parameter is invalid/);
    assert.equal(bad.stdout, '');
    // A bad --public-url, a turned-off account and an unknown account make no token either.
    for (const [args, message] of [
      [['--account', 'ann', '--public-url', 'ftp://example.test'], /public-url|http/i],
      [['--account', 'off'], /turned off/],
      [['--account', 'nobody'], /no account named "nobody"/],
    ] as const) {
      const r = await cli('calendar-feed', dir, 'Planner', 'create', ...args, '--layout', 'Events', '--start', 'Day');
      assert.notEqual(r.status, 0, args.join(' '));
      assert.match(r.stderr, message);
      assert.equal(r.stdout, '');
    }
    assert.equal((await cli('calendar-feed', dir, 'Planner', 'list', '--json')).stdout.trim(), '[]', 'no token was made');
    const missing = await cli('calendar-feed', dir, 'Planner', 'create', '--layout', 'Events', '--start', 'Day');
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /--account/);

    const imported = await cli('import-ics', dir, 'Planner', writeIcs(dir), '--account', 'ann', '--layout', 'Events', '--start', 'Day', '--title', 'Title', '--json');
    assert.equal(imported.status, 0, imported.stderr);
    assert.deepEqual(JSON.parse(imported.stdout), { imported: 1, skipped: 0, notes: [] });

    const made = await cli('calendar-feed', dir, 'Planner', 'create', '--account', 'ann', '--layout', 'Events', '--start', 'Day', '--title', 'Title', '--label', 'Team', '--public-url', 'http://localhost', '--json');
    assert.equal(made.status, 0, made.stderr);
    const feed = JSON.parse(made.stdout) as { id: string; address: string; url: string };
    assert.match(feed.url, /^http:\/\/localhost\/tabularius\/calendar\/v1\/databases\/Planner\/layouts\/Events\/calendar\.ics\?start=Day&title=Title&token=ohbt_/);
    assert.match(made.stderr, /shown once/);

    const list = await cli('calendar-feed', dir, 'Planner', 'list');
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, new RegExp(`${feed.id}\\s+Events\\s+as ann\\s+"Team"`));
    assert.ok(!list.stdout.includes('ohbt_'), 'the list never shows the address');
    assert.ok(!JSON.parse((await cli('calendar-feed', dir, 'Planner', 'list', '--json')).stdout).some((f: object) => 'address' in f || 'token' in f));

    const running = await serve({ dir, port: 0, log: () => {} });
    try {
      const opened = await fetch(running.url + feed.address);
      assert.equal(opened.status, 200);
      const text = await opened.text();
      assert.match(text, /SUMMARY:Existing/);
      assert.match(text, /SUMMARY:Imported meeting/);
      const revoked = await cli('calendar-feed', dir, 'Planner', 'revoke', feed.id);
      assert.equal(revoked.status, 0, revoked.stderr);
      assert.equal((await fetch(running.url + feed.address)).status, 401, 'a revoked feed answers like any other dead token');
      const again = await cli('calendar-feed', dir, 'Planner', 'revoke', feed.id);
      assert.notEqual(again.status, 0);
      assert.match(again.stderr, /no calendar feed/);
    } finally {
      await new Promise<void>((resolve) => running.server.close(() => resolve()));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('CLI: import-ics refuses an account that may not create records, and a file that is not a calendar; nothing is half imported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-calfeed-cli-'));
  try {
    createStore(join(dir, 'Planner' + STORE_EXT), { mode: 'native' });
    const host = new Host(dir, () => {});
    const store = host.get('Planner')!;
    store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Title' }, { name: 'Day', type: 'date' }] }]);
    store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
    store.setPassword('rae', 'pw', 'Reader');
    await host.close();
    const denied = await cli('import-ics', dir, 'Planner', writeIcs(dir), '--account', 'rae', '--layout', 'Events', '--start', 'Day');
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /may not create records/);
    const notIcs = join(dir, 'x.ics');
    writeFileSync(notIcs, 'hello');
    const junk = await cli('import-ics', dir, 'Planner', notIcs, '--account', 'rae', '--layout', 'Events', '--start', 'Day');
    assert.notEqual(junk.status, 0);
    const reopened = new Host(dir, () => {});
    try {
      assert.equal(Number((reopened.get('Planner')!.query('SELECT COUNT(*) AS n FROM Events')[0] as { n: number }).n), 0);
    } finally {
      await reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function writeIcs(dir: string): string {
  const file = join(dir, 'in.ics');
  writeFileSync(file, ICS);
  return file;
}
