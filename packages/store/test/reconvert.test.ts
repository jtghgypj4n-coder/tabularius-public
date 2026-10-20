// Converting a hosted file again from its .fmp12 once the converter is fixed,
// keeping what people did in Tabularius since.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CONVERTER_VERSION, importFmp12, reconvert, reconvertCheck, Store } from '../src/index.ts';
import { totpCode } from '../src/totp.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const LAYOUT = 'WV Framework - Sample Data';

/** A store as an older converter left it, with a value it got wrong. */
function oldStore(): { dir: string; path: string; ids: number[] } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-reconvert-'));
  const path = join(dir, 'Flicks.openhbam.sqlite');
  importFmp12(fixture, path);
  const sql = new DatabaseSync(path);
  const ids = (sql.prepare('SELECT _fm_record_id AS id FROM MOVIE ORDER BY 1 LIMIT 3').all() as { id: number }[]).map((r) => r.id);
  sql.prepare("DELETE FROM _fm_meta WHERE key = 'converterVersion'").run();
  sql.prepare("UPDATE MOVIE SET director = 'wrong' WHERE _fm_record_id = ?").run(ids[2]);
  sql.close();
  return { dir, path, ids };
}

const row = (path: string, id: number) => {
  const sql = new DatabaseSync(path, { readOnly: true });
  try {
    return sql.prepare('SELECT * FROM MOVIE WHERE _fm_record_id = ?').get(id) as Record<string, unknown> | undefined;
  } finally {
    sql.close();
  }
};

test('reconverting keeps records created, edited and deleted since, and settings', { skip }, async () => {
  const { dir, path, ids: [one, two, three] } = oldStore();
  try {
    const original = row(path, one)!;
    const store = new Store(path, 'Flicks');
    store.update(LAYOUT, one, { director: 'Edited Director' }, undefined, { account: 'Ann' });
    store.delete(LAYOUT, two, { account: 'Ann' });
    const { recordId } = store.create(LAYOUT, { title_sort: 'A New Film' }, { account: 'Ann' });
    store.setContainer(LAYOUT, recordId, 'poster', 1, { filename: 'poster.png', mime: 'image/png', data: Buffer.from('png bytes') });
    const set = store.privilegeSets()[0].name;
    store.setPassword('Admin', 'correct horse battery', set);
    assert.equal(store.sql.prepare("SELECT privilege_set FROM _fm_accounts WHERE name = 'Admin'").get()!.privilege_set, set, 'an explicit assignment is saved even when it matches the imported schema');
    const hash = (store as unknown as { sql: DatabaseSync }).sql.prepare("SELECT password_hash FROM _fm_accounts WHERE name = 'Admin'").get() as { password_hash: string };
    store.close();

    const check = reconvertCheck(path, fixture);
    assert.deepEqual(check, { version: 1, current: CONVERTER_VERSION, outdated: true });

    const result = await reconvert(path, fixture);
    assert.deepEqual([result.created, result.edited, result.deleted], [1, 1, 1]);
    assert.ok(existsSync(result.backup));
    assert.equal(reconvertCheck(path, fixture).outdated, false);

    const edited = row(path, one)!;
    assert.equal(edited.director, 'Edited Director', 'the edit is kept');
    assert.equal(edited.title_sort, original.title_sort, 'other fields come from the .fmp12');
    assert.equal(row(path, two), undefined, 'the delete is kept');
    assert.notEqual(row(path, three)!.director, 'wrong', 'the value the old converter got wrong is fixed');

    const after = new Store(path, 'Flicks');
    try {
      assert.equal(after.get(LAYOUT, recordId).fieldData.title_sort, 'A New Film');
      const id = after.containerId(LAYOUT, recordId, 'poster')!;
      assert.equal(Buffer.from(after.container(id)!.data).toString(), 'png bytes');
      const now = (after as unknown as { sql: DatabaseSync }).sql.prepare("SELECT password_hash, privilege_set FROM _fm_accounts WHERE name = 'Admin'").get() as { password_hash: string; privilege_set: string };
      assert.equal(now.password_hash, hash.password_hash);
      assert.equal(now.privilege_set, set);
      assert.deepEqual(after.auditLog({ recordId }).map((e) => e.kind), ['create', 'update']);
      // New records don't reuse the ids of ones created before.
      assert.ok(after.create(LAYOUT, { title_sort: 'Another' }).recordId > recordId);
    } finally {
      after.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("reconverting refuses to carry edits it can't place, unless forced", { skip }, async () => {
  const { dir, path, ids: [one, two, three] } = oldStore();
  try {
    const store = new Store(path, 'Flicks');
    store.update(LAYOUT, one, { director: 'Edited Director' });
    store.close();
    const sql = new DatabaseSync(path);
    sql.prepare("INSERT INTO _fm_design_log (op, at) VALUES ('{}', '2026-10-12')").run();
    sql.close();

    assert.match(reconvertCheck(path, fixture).unsafe ?? '', /design was changed/);
    await assert.rejects(reconvert(path, fixture), /can't carry edits over/);
    assert.equal(row(path, one)!.director, 'Edited Director', 'left as it was');

    const result = await reconvert(path, fixture, { force: true });
    assert.notEqual(row(path, one)!.director, 'Edited Director', 'converted afresh');
    assert.equal(row(result.backup, one)!.director, 'Edited Director', 'the old store is kept');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('reconverting keeps accounts, privilege sets, grants, API tokens and second factors made in Tabularius', { skip }, async () => {
  const { dir, path } = oldStore();
  try {
    const store = new Store(path, 'Flicks');
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
    const entry = store.privilegeSets().find((p) => p.id !== 1)!;
    store.savePrivilegeSet({ ...entry, id: undefined, name: 'QA testers' });
    store.setPassword('qa', 'qa password', 'QA testers');
    const { secret } = store.enrollTotp('qa');
    assert.ok(store.confirmTotp('qa', totpCode(secret)));
    const token = store.createApiToken('qa', { label: 'mini', readOnly: true });
    const before = { accounts: store.accounts(), sets: store.privilegeSets(), tokens: store.apiTokens() };
    store.close();

    await reconvert(path, fixture);

    const after = new Store(path, 'Flicks');
    try {
      assert.deepEqual(after.accounts(), before.accounts);
      assert.deepEqual(after.privilegeSets(), before.sets);
      assert.ok(after.privilegeSets().find((p) => p.id === 1)!.extendedPrivileges.includes('fmodata'), 'a grant made here');
      assert.deepEqual(after.apiTokens(), before.tokens);
      assert.ok(after.hasTotp('qa'));
      assert.equal(after.apiToken(token)?.account, 'qa');
      assert.ok(after.verify('qa', 'qa password'));
    } finally {
      after.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a dry run reports what converting again would change, and changes nothing', { skip }, async () => {
  const { dir, path, ids: [one] } = oldStore();
  try {
    const store = new Store(path, 'Flicks');
    store.update(LAYOUT, one, { director: 'Edited Director' }, undefined, { account: 'Ann' });
    store.setPassword('qa', 'qa password', store.privilegeSets()[0].name);
    const accounts = store.accounts().length;
    store.close();

    const r = await reconvert(path, fixture, { dryRun: true });
    const p = r.preview!;
    assert.deepEqual(p.accounts, { before: accounts, after: accounts });
    assert.equal(p.editsCarried, true);
    assert.equal(p.designChangesLost, 0);
    const movie = p.tables.find((t) => t.table === 'MOVIE')!;
    assert.equal(movie.changed, 1, 'the one value the old converter got wrong; the edit made here is carried, so not a change');
    assert.equal(movie.before, movie.after);

    assert.equal(reconvertCheck(path, fixture).outdated, true, 'the store is as it was');
    assert.equal(row(path, one)!.director, 'Edited Director');
    assert.equal(r.backup, '');
    assert.deepEqual(readdirSync(dir).filter((f) => /reconvert/.test(f)), [], 'nothing left beside it');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a copied .fmp12 (new modification time, same content) still carries edits over; a changed one does not', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-reconvert-copy-'));
  try {
    const fmp12 = join(dir, 'Flicks.fmp12');
    copyFileSync(fixture, fmp12);
    const path = join(dir, 'Flicks.openhbam.sqlite');
    importFmp12(fmp12, path);
    const later = new Date(Date.now() + 60_000);
    // Copied from another machine: same bytes, newer time.
    copyFileSync(fixture, fmp12);
    utimesSync(fmp12, later, later);
    assert.equal(reconvertCheck(path, fmp12).unsafe, undefined);
    // Changed in FileMaker: different bytes.
    const bytes = readFileSync(fixture);
    bytes[bytes.length - 100] ^= 0xff;
    writeFileSync(fmp12, bytes);
    utimesSync(fmp12, later, new Date(Date.now() + 120_000));
    assert.match(reconvertCheck(path, fmp12).unsafe ?? '', /changed since it was converted/);

    // A conversion from before checksums were kept can't tell: it asks, and --same-file answers.
    copyFileSync(fixture, fmp12);
    utimesSync(fmp12, later, later);
    const sql = new DatabaseSync(path);
    const source = JSON.parse((sql.prepare("SELECT json FROM _fm_meta WHERE key = 'source'").get() as { json: string }).json);
    delete source.sha256;
    delete source.size;
    sql.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'source'").run(JSON.stringify(source));
    sql.close();
    const legacy = reconvertCheck(path, fmp12);
    assert.equal(legacy.unverified, true);
    assert.match(legacy.unsafe ?? '', /same file \(copied\)/);
    assert.equal(reconvertCheck(path, fmp12, { sameFile: true }).unsafe, undefined);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
