// externalAccount() maps an identity-provider sign-in to one of the file's
// external accounts: by exact email, then the email's domain, then a group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function open(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ext-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  return { store, dir };
}

test('external account mapping: exact email beats domain beats group', { skip }, () => {
  const { store, dir } = open();
  try {
    const full = store.privilegeSets().find((p) => p.id === 1)!.name;
    const ro = '[Read-Only Access]';
    store.setExternalAccount('pat@example.com', ro);
    store.setExternalAccount('@example.com', full);
    store.setExternalAccount('Staff', ro);

    // Exact email wins even when the domain and a group also match.
    assert.equal(store.externalAccount('pat@example.com', ['Staff']), 'pat@example.com');
    // No exact account, but the domain does: the whole org maps to one account.
    assert.equal(store.externalAccount('sam@example.com', ['Nobody']), '@example.com');
    // Domain is case-insensitive.
    assert.equal(store.externalAccount('Sam@Example.COM'), '@example.com');
    // No email account or domain match: fall back to a group.
    assert.equal(store.externalAccount('sam@other.org', ['Staff']), 'Staff');
    // Nothing matches.
    assert.equal(store.externalAccount('sam@other.org', ['Nobody']), undefined);
    // An email with no domain part never matches a domain account.
    assert.equal(store.externalAccount('weird', []), undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a deactivated external account is never chosen', { skip }, () => {
  const { store, dir } = open();
  try {
    const ro = '[Read-Only Access]';
    store.setExternalAccount('@example.com', ro);
    assert.equal(store.externalAccount('sam@example.com'), '@example.com');
    store.setAccountActive('@example.com', false);
    assert.equal(store.externalAccount('sam@example.com'), undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a person whose own account is deactivated is not let back in by their domain or a group', { skip }, () => {
  const { store, dir } = open();
  try {
    const ro = '[Read-Only Access]';
    store.setExternalAccount('@example.com', ro);
    store.setExternalAccount('Staff', ro);
    store.setExternalAccount('pat@example.com', ro);
    store.setAccountActive('pat@example.com', false);
    assert.equal(store.externalAccount('pat@example.com', ['Staff']), undefined);
    assert.equal(store.externalAccount('PAT@example.com'), undefined);
    // Others in the domain still sign in through it.
    assert.equal(store.externalAccount('sam@example.com'), '@example.com');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('live identity requires the same persisted principal and active external mapping generation', { skip }, () => {
  const { store, dir } = open();
  try {
    const ro = '[Read-Only Access]';
    store.setExternalAccount('Staff', ro);
    const mappingId = store.externalIdentityId('Staff')!;
    const principalId = store.accountIdentityId('Staff')!;
    assert.equal(store.identityAllowed('Staff', 'Staff', mappingId, undefined, principalId), true);
    store.deleteAccount('Staff');
    assert.equal(store.identityAllowed('Staff', 'Staff', mappingId, undefined, principalId), false);
    store.setExternalAccount('Staff', ro);
    assert.equal(store.identityAllowed('Staff', 'Staff', mappingId, undefined, principalId), false, 'a recreated same-name mapping has a new identity');
    assert.equal(store.identityAllowed('missing-local-account'), false, 'a schema-only or absent local principal is not a live identity');
    store.setPassword('alice', 'first-password');
    const aliceGeneration = store.accountIdentityId('alice')!;
    store.deleteAccount('alice');
    store.setPassword('alice', 'second-password');
    assert.equal(store.identityAllowed('alice', undefined, undefined, undefined, aliceGeneration), false, 'a recreated local account cannot inherit a session');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('inactive local email blocks exact domain and group external mappings', { skip }, () => {
  const { store, dir } = open();
  try {
    const ro = '[Read-Only Access]';
    store.setExternalAccount('@example.com', ro);
    store.setExternalAccount('Staff', ro);
    store.setPassword('pat@example.com', 'local-secret', ro);
    store.setAccountActive('pat@example.com', false);
    assert.equal(store.externalAccount('pat@example.com', ['Staff']), undefined);
    assert.equal(store.externalAccount('sam@example.com', ['Staff']), '@example.com');
    assert.equal(store.externalAccount('sam@other.org', ['Staff']), 'Staff');
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
