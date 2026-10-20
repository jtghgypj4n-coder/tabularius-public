// Account cleanup follows the retained person and mapping, locally and across workers.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataApi, Host } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const mapping = '@example.test';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-account-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true }));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  copyFileSync(fixture, join(dir, 'Other.fmp12'));
  const host = new Host(dir, () => {});
  t.after(() => host.close());
  for (const name of ['Charts', 'Other']) {
    const store = host.get(name)!;
    store.savePrivilegeSet({ name: 'Web', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmapp'] });
    for (const account of ['Pat@example.test', 'Sam@example.test', 'pat-alias', 'sam-alias']) store.setPassword(account, 'person-password-123', 'Web');
    store.setExternalAccount(mapping, 'Web');
    store.setExternalAccount('legacy-staff', 'Web');
  }
  const api = new DataApi(host);
  const open = (owner: DataApi, person: string, db = 'Charts') => owner.open(host.get(db)!, person.startsWith('Pat') ? 'pat-alias' : 'sam-alias', 'web', 'legacy-staff', '', undefined, undefined, { person, mapping });
  return { host, api, open };
}

const own = (api: DataApi) => api.own(() => 0);
function removed(api: DataApi, token: string) {
  assert.equal(api.alive(token), false);
  assert.equal(own(api).some((s) => s.token === token), false);
  assert.equal(api.list().some((s) => s.id === api.idOf(token)), false);
}

test('person cleanup matches retained identity case-insensitively and leaves another person alive', { skip }, (t) => {
  const { api, open } = setup(t);
  const pat = open(api, 'Pat@example.test');
  const sam = open(api, 'Sam@example.test');
  assert.ok(api.alive(pat) && api.alive(sam));
  assert.equal(api.endByAccount('cHaRtS', 'pAT@EXAMPLE.TEST'), 1);
  removed(api, pat);
  assert.ok(api.alive(sam));
});

test('mapping cleanup ends both alias sessions using the structured mapping', { skip }, (t) => {
  const { api, open } = setup(t);
  const pat = open(api, 'Pat@example.test');
  const sam = open(api, 'Sam@example.test');
  assert.equal(api.endByAccount('Charts', '@EXAMPLE.TEST'), 2);
  removed(api, pat);
  removed(api, sam);
});

test('legacy sessions without structured identity still match via', { skip }, (t) => {
  const { host, api } = setup(t);
  const token = api.open(host.get('Charts')!, 'pat-alias', 'web', 'legacy-staff');
  assert.equal(api.endByAccount('Charts', 'LEGACY-STAFF'), 1);
  removed(api, token);
});

test('cleanup preserves except and database scope, matches local accounts, and counts a session once', { skip }, (t) => {
  const { host, api, open } = setup(t);
  const kept = open(api, 'Pat@example.test');
  const ended = open(api, 'Pat@example.test');
  const other = open(api, 'Pat@example.test', 'Other');
  assert.equal(api.endByAccount('Charts', 'Pat@example.test', kept), 1);
  removed(api, ended);
  assert.ok(api.alive(kept) && api.alive(other));
  const local = api.open(host.get('Charts')!, 'Sam@example.test', 'web');
  assert.equal(api.endByAccount('Charts', 'SAM@EXAMPLE.TEST'), 1);
  removed(api, local);
  const multiple = api.open(host.get('Charts')!, mapping, 'web', mapping, '', undefined, undefined, { person: mapping, mapping });
  assert.equal(api.endByAccount('Charts', mapping, kept), 1);
  removed(api, multiple);
  assert.ok(api.alive(kept) && api.alive(other));
});

test('cleanup matches retained identities after the person and mapping accounts are deleted', { skip }, (t) => {
  const { host, api, open } = setup(t);
  const pat = open(api, 'Pat@example.test');
  const sam = open(api, 'Sam@example.test');
  host.get('Charts')!.deleteAccount('Pat@example.test');
  host.get('Charts')!.deleteAccount(mapping);
  assert.equal(api.endByAccount('Charts', 'Pat@example.test'), 1);
  removed(api, pat);
  assert.equal(api.endByAccount('Charts', mapping), 1);
  removed(api, sam);
});

for (const account of ['pAT@EXAMPLE.TEST', '@EXAMPLE.TEST']) {
  test(`remote cleanup by ${account} uses serialized owner reports and dispatches the actual session IDs`, { skip }, (t) => {
    const { host, api: owner, open } = setup(t);
    const caller = new DataApi(host);
    const pat = open(owner, 'Pat@example.test');
    const sam = open(owner, 'Sam@example.test');
    const other = open(owner, 'Pat@example.test', 'Other');
    caller.others = () => JSON.parse(JSON.stringify(own(owner)));
    const report = caller.others()!.find((s) => s.token === pat)!;
    assert.deepEqual(report.externalIdentity, { person: 'Pat@example.test', mapping });
    assert.equal(report.via, 'legacy-staff');
    assert.equal('externalIdentity' in caller.list()[0], false, 'public session lists keep their explicit projection');
    assert.equal('token' in caller.list()[0], false);
    const dispatched: string[] = [];
    caller.endElsewhere = (id) => { dispatched.push(id); assert.equal(owner.endById(id), true); };
    const expected = account.startsWith('@') ? [pat, sam] : [pat];
    assert.equal(caller.endByAccount('cHARTS', account), expected.length);
    assert.deepEqual(dispatched.sort(), expected.map((token) => owner.idOf(token)).sort());
    for (const token of expected) removed(owner, token);
    if (!account.startsWith('@')) assert.ok(owner.alive(sam));
    assert.ok(owner.alive(other));
    assert.equal(caller.list().some((s) => expected.some((token) => s.id === owner.idOf(token))), false);
  });
}

test('remote cleanup preserves the exception token and dispatches each matching session only once', { skip }, (t) => {
  const { host, api: owner, open } = setup(t);
  const caller = new DataApi(host);
  const kept = open(owner, 'Pat@example.test');
  const ended = open(owner, 'Sam@example.test');
  const multiple = owner.open(host.get('Charts')!, mapping, 'web', mapping, '', undefined, undefined, { person: mapping, mapping });
  caller.others = () => JSON.parse(JSON.stringify(own(owner)));
  const dispatched: string[] = [];
  caller.endElsewhere = (id) => { dispatched.push(id); assert.equal(owner.endById(id), true); };
  assert.equal(caller.endByAccount('Charts', mapping, kept), 2);
  assert.deepEqual(dispatched.sort(), [ended, multiple].map((token) => owner.idOf(token)).sort());
  removed(owner, ended);
  removed(owner, multiple);
  assert.ok(owner.alive(kept));
});
