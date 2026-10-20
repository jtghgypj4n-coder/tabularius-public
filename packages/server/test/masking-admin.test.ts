// Masking in the admin and reporting surfaces: the field-access editor stores `masked` with its mask, and
// who-can, the access review (and its CSV), plain-words explanations and set diffs all tell masked from hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { whoCan } from '../src/who-can.ts';
import { accessReview, accessReviewCsv } from '../src/access-review.ts';
import { narrowPrivileges } from '../src/token-scope.ts';
import { accessReport, diffPrivilegeSet, explainAccess } from '../../store/src/access-report.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('masked fields are stored, reported and counted apart from hidden ones', { skip }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-masking-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  t.after(() => { s.server.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  const store = s.host.get('Charts')!;
  const table = [...store.schema.tables].sort((a, b) => b.fields.length - a.fields.length)[0];
  const [a, b, c] = table.fields.map((f) => f.name);
  const open = { view: true, edit: true, create: false, delete: false };
  store.savePrivilegeSet({ name: 'Clerks', records: open, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('cleo', 'cleo-pw-1234', 'Clerks');

  const post = (body: unknown) => fetch(`${s.url}/tabularius/admin/v1/field-access`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const get = () => fetch(`${s.url}/tabularius/admin/v1/field-access?database=Charts&privilegeSet=Clerks&table=${encodeURIComponent(table.name)}`).then((r) => r.json());
  const base = { database: 'Charts', privilegeSet: 'Clerks', table: table.name };

  // No mask given: last 4 characters.
  let r = await post({ ...base, field: a, access: 'masked' });
  assert.equal(r.status, 200);
  assert.equal(r.body.access, 'masked');
  assert.deepEqual(r.body.mask, { kind: 'last4' });
  r = await post({ ...base, field: b, access: 'masked', mask: { kind: 'placeholder', text: 'Private' } });
  assert.deepEqual(r.body.mask, { kind: 'placeholder', text: 'Private' });
  // Saving it again as masked, naming no mask, keeps the mask it has.
  r = await post({ ...base, field: b, access: 'masked' });
  assert.deepEqual(r.body.mask, { kind: 'placeholder', text: 'Private' });
  r = await post({ ...base, field: b, access: 'masked', mask: { kind: 'placeholder' } });
  assert.deepEqual(r.body.mask, { kind: 'placeholder', text: 'Private' }, 'the same kind keeps its text');
  r = await post({ ...base, field: c, access: 'none' });
  assert.equal(r.body.mask, null);
  assert.equal((await post({ ...base, field: a, access: 'masked', mask: { kind: 'bogus' } })).status, 400);
  assert.equal((await post({ ...base, field: a, access: 'secret' })).status, 400);

  const listed = await get();
  const by = (n: string) => listed.fields.find((f: { name: string }) => f.name === n);
  assert.equal(by(a).access, 'masked');
  assert.deepEqual(by(b).mask, { kind: 'placeholder', text: 'Private' });
  assert.equal(by(c).access, 'none');

  // Moving a masked field to another level drops its mask.
  await post({ ...base, field: b, access: 'viewOnly' });
  assert.equal(store.privilegeSet('Clerks')!.tables![table.name].masks?.[b], undefined);
  assert.equal(store.privilegeSet('Clerks')!.tables![table.name].masks, undefined, 'last 4 is the default, so it needs no entry');

  // Who can: masked is neither hidden nor readable.
  const w = whoCan(store, table.name);
  const set = w.sets.find((x) => x.privilegeSet === 'Clerks')!;
  assert.deepEqual(set.maskedFields, [a]);
  assert.deepEqual(set.hiddenFields, [c]);
  assert.match(set.says, /sees only a masked version of/);
  const one = whoCan(store, table.name, a);
  assert.ok(!one.canSee.includes('cleo'), 'a masked field is not seen');
  assert.deepEqual(one.canSeeMasked, ['cleo']);
  const cl = one.sets.find((x) => x.privilegeSet === 'Clerks')!;
  assert.match(cl.says, /only a masked version/);
  assert.equal(cl.edit, 'no');

  // Access review: its own column, hidden count unchanged.
  const review = accessReview(store);
  const row = review.rows.find((x) => x.account === 'cleo' && x.table === table.name)!;
  assert.equal(row.maskedFields, 1);
  assert.equal(row.hiddenFields, 1);
  assert.match(accessReviewCsv(review).split('\r\n')[0], /hiddenFields,viewOnlyFields,maskedFields,/);

  // Plain words and diffs.
  const report = accessReport(store.privilegesForSet('Clerks'), store.schema);
  const exp = explainAccess(report, { privilegeSet: 'Clerks' });
  const fact = exp.tables.find((x) => x.table === table.name)!.fields.find((f) => f.field === a)!;
  assert.equal(fact.access, 'masked');
  assert.match(fact.why, /masked version.*last 4 characters.*can't change, search, sort, total or export/);
  const before = store.privilegeSet('Clerks')!;
  const hidden = structuredClone(before);
  hidden.tables![table.name].fields![a] = 'none';
  assert.ok(diffPrivilegeSet(before, hidden).some((d) => d.detail.includes(`${a} field → masked`)));
  assert.ok(diffPrivilegeSet(hidden, before).some((d) => d.detail.includes(`${a} field → none`)));
  const placeholder = structuredClone(before);
  placeholder.tables![table.name].masks = { [a]: { kind: 'placeholder' } };
  assert.ok(diffPrivilegeSet(placeholder, before).some((d) => d.detail.includes('row of dots')), 'a changed mask is a change');

  // A read-only token never makes a masked field more readable.
  const narrowed = narrowPrivileges(store, store.privileges('cleo'), { readOnly: true });
  assert.equal(narrowed.fieldAccess(table.name, a), 'masked');
  assert.equal(narrowed.field(table.name, a), 'none');
});

test('the admin console offers Masked, so a masked field is not shown as Modifiable', () => {
  const html = readFileSync(join(import.meta.dirname, '..', 'admin', 'index.html'), 'utf8');
  assert.match(html, /value="masked:last4"/);
  assert.match(html, /value="masked:placeholder"/);
});
