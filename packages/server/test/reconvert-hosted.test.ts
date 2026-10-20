// A hosted file converted by an older version: flagged at startup and in the
// admin console, and converted again from its .fmp12 with the edits kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importFmp12 } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const LAYOUT = 'WV Framework - Sample Data';

test('the admin console flags a file converted by an older version and converts it again, keeping edits', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-reconvert-hosted-'));
  // Copied, then converted: the store is newer than the .fmp12, as when a server converts a file.
  copyFileSync(fixture, join(dir, 'Flicks.fmp12'));
  const store = join(dir, 'Flicks.openhbam.sqlite');
  importFmp12(join(dir, 'Flicks.fmp12'), store);
  const sql = new DatabaseSync(store);
  sql.prepare("DELETE FROM _fm_meta WHERE key = 'converterVersion'").run();
  const id = (sql.prepare('SELECT min(_fm_record_id) AS id FROM MOVIE').get() as { id: number }).id;
  sql.close();

  const logs: string[] = [];
  const s = await serve({ dir, port: 0, log: (m) => logs.push(m) });
  try {
    assert.ok(logs.some((l) => /Flicks was converted by an older version.*Edits made since are kept/.test(l)), logs.join('\n'));
    s.host.get('Flicks')!.update(LAYOUT, id, { director: 'Edited Director' });

    const status = async () => (await (await fetch(`${s.url}/tabularius/admin/v1/status`, { headers: { 'x-tabularius-admin': '1' } })).json()).databases[0];
    assert.deepEqual((await status()).reconvert, { version: 1, current: 2 });

    const r = await fetch(`${s.url}/tabularius/admin/v1/files/Flicks/reconvert`, { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: '{}' });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.edited, 1);
    assert.match(body.backup, /^Flicks\.openhbam\.sqlite\.before-reconvert-/);
    assert.ok(readdirSync(dir).includes(body.backup));

    assert.equal((await status()).reconvert, undefined, 'up to date now');
    const reopened = s.host.get('Flicks')!;
    assert.equal(reopened.get(LAYOUT, id).fieldData.director, 'Edited Director');
  } finally {
    s.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Convert all again: a dry run of each outdated file first, then converting the ones chosen', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-reconvert-all-'));
  for (const name of ['Flicks', 'Flicks2']) {
    copyFileSync(fixture, join(dir, `${name}.fmp12`));
    const store = join(dir, `${name}.openhbam.sqlite`);
    importFmp12(join(dir, `${name}.fmp12`), store);
    const sql = new DatabaseSync(store);
    sql.prepare("DELETE FROM _fm_meta WHERE key = 'converterVersion'").run();
    sql.close();
  }
  const s = await serve({ dir, port: 0, log: () => {} });
  const post = (path: string, body: unknown) => fetch(`${s.url}/tabularius/admin/v1${path}`, {
    method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());
  try {
    const files = () => readdirSync(dir).filter((f) => /^Flicks/.test(f)).sort();
    const before = files();
    const preview = await post('/reconvert-all', { preview: true });
    assert.deepEqual(preview.files.map((f: { name: string }) => f.name).sort(), ['Flicks', 'Flicks2']);
    for (const f of preview.files) {
      assert.equal(f.preview.editsCarried, true);
      assert.equal(f.preview.accounts.before, f.preview.accounts.after);
    }
    assert.deepEqual(files(), before, 'a dry run leaves the hosted folder alone');

    const one = await post('/files/Flicks/reconvert-preview', {});
    assert.equal(one.name, 'Flicks');

    const done = await post('/reconvert-all', { files: ['Flicks2', 'not hosted'] });
    assert.deepEqual(done.files.map((f: { name: string; error?: string }) => [f.name, f.error]), [['Flicks2', undefined]]);
    assert.equal(s.host.reconvertStatus('Flicks2')?.outdated, false);
    assert.equal(s.host.reconvertStatus('Flicks')?.outdated, true);
  } finally {
    s.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
