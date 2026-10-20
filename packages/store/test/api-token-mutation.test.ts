import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, Store } from '../src/index.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'mutation-api-token-'));
  const path = join(dir, 'A.sqlite'); createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.setPassword('Admin', 'backup');
  store.setPassword('Person', 'secret');
  return store;
}
const idOf = (token: string) => /^ohbt_([a-f0-9]+)\./.exec(token)![1];

test('bearer verification rejects malformed tokens, unknown IDs, wrong secrets and malformed stored hashes', (t) => {
  const store = setup(t);
  const token = store.createApiToken('Person');
  assert.deepEqual(store.apiToken(token), { account: 'Person', readOnly: false, provenance: 'service' });
  for (const invalid of ['', 'garbage', 'ohbt_', 'ohbt_deadbeef.no-such-token', `${token}x`]) assert.equal(store.apiToken(invalid), undefined, invalid);
  store.sql.prepare('UPDATE _fm_api_tokens SET token_hash = ? WHERE id = ?').run('00', idOf(token));
  assert.equal(store.apiToken(token), undefined, 'a damaged hash refuses authentication without throwing a length error');
});

test('expiry edits and account deactivation take effect on the next token verification', (t) => {
  const store = setup(t), now = Date.now();
  const token = store.createApiToken('Person', { readOnly: true, surfaces: ['fmrest'], expires: new Date(now + 60_000) });
  assert.deepEqual(store.apiToken(token), { account: 'Person', readOnly: true, surfaces: ['fmrest'], provenance: 'service' });
  store.sql.prepare('UPDATE _fm_api_tokens SET expires = ? WHERE id = ?').run(new Date(now - 60_000).toISOString(), idOf(token));
  assert.equal(store.apiToken(token), undefined);
  store.sql.prepare('UPDATE _fm_api_tokens SET expires = NULL WHERE id = ?').run(idOf(token));
  assert.ok(store.apiToken(token));
  store.setAccountActive('Person', false); assert.equal(store.apiToken(token), undefined);
  // Turning the account back on does not bring back what was issued before it was turned off.
  store.setAccountActive('Person', true); assert.equal(store.apiToken(token), undefined);
  assert.ok(store.apiToken(store.createApiToken('Person')), 'a token made after it is on works');
});

test('external delegated tokens require their own live mapping and live person; service tokens are distinct', (t) => {
  const store = setup(t), full = store.privileges('Admin').name;
  store.setExternalAccount('Group', full); store.setExternalAccount('OtherGroup', full);
  const identity = { issuer: 'https://id.example', sub: 'person-subject', person: 'Person', mapping: 'Group' };
  const delegated = store.createApiToken('Group', { identity });
  assert.deepEqual(store.apiToken(delegated), { account: 'Group', readOnly: false, identity, provenance: 'delegated' });
  const service = store.createApiToken('Group', { provenance: 'service' });
  assert.equal(store.apiToken(service)?.provenance, 'service');
  assert.equal(store.apiToken(store.createApiToken('Group', { provenance: 'delegated' })), undefined, 'a delegated external token needs an identity');
  assert.equal(store.apiToken(store.createApiToken('Group', { identity: { ...identity, mapping: 'OtherGroup' } })), undefined, 'an identity for another group cannot borrow this group');
  store.setAccountActive('Person', false);
  assert.equal(store.apiToken(delegated), undefined); assert.ok(store.apiToken(service));
  store.setAccountActive('Person', true);
  assert.equal(store.apiToken(delegated), undefined, 'turning the person back on does not bring back a token made before');
  store.setAccountActive('Group', false);
  assert.equal(store.apiToken(delegated), undefined); assert.equal(store.apiToken(service), undefined);
});

test('an identity mapping is checked independently of the token account and survives neither removal nor deactivation', (t) => {
  const store = setup(t), full = store.privileges('Admin').name;
  store.setExternalAccount('Group', full);
  const identity = { issuer: 'https://id.example', sub: 'person-subject', mapping: 'Group' };
  const token = store.createApiToken('Person', { identity });
  assert.ok(store.apiToken(token));
  store.setAccountActive('Group', false); assert.equal(store.apiToken(token), undefined);
  store.setAccountActive('Group', true); assert.equal(store.apiToken(token), undefined, 'nor does turning the mapping back on bring the token back');
  assert.ok(store.apiToken(store.createApiToken('Person', { identity })), 'a token made after it is on works');
  const nativeMapping = store.createApiToken('Person', { identity: { ...identity, mapping: 'Person' } });
  assert.equal(store.apiToken(nativeMapping), undefined, 'a native account is not an external identity mapping');
  // Model legacy schema metadata remaining after its account row has gone.
  // This is synthetic account metadata, not guessed Claris verifier bytes.
  store.schema.accounts.push({ ...store.schema.accounts[0], name: 'Orphan', external: true });
  const orphan = store.createApiToken('Person', { identity: { ...identity, mapping: 'Orphan' } });
  assert.equal(store.apiToken(orphan), undefined, 'legacy external metadata cannot stand in for an existing account');
});
