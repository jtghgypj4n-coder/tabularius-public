// An API token can be scoped to a subset of the surfaces that accept a bearer
// token (fmrest/fmodata/fmxdbc); the scope is stored, listed and validated, and
// an older file with no `surfaces` column migrates in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importFmp12, Store } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('a token carries its surface scope, deduped and lowercased; an unknown one is refused', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tok-surf-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const store = new Store(path);
  try {
    store.setPassword('clerk', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);

    const scoped = store.createApiToken('clerk', { label: 'reporting', surfaces: ['FmRest', 'fmrest', 'fmodata'] });
    const id = /^ohbt_([0-9a-f]+)\./.exec(scoped)![1];
    const t = store.apiTokens().find((token) => token.id === id)!;
    assert.deepEqual(t.surfaces, ['fmrest', 'fmodata'], 'stored lowercased and deduped');

    // An unknown surface is refused at creation.
    assert.throws(() => store.createApiToken('clerk', { surfaces: ['fmrest', 'ftp'] }), /not a surface/);
    // The web client isn't a token surface.
    assert.throws(() => store.createApiToken('clerk', { surfaces: ['fmapp'] }), /not a surface/);

    // No surfaces given → unrestricted (the field is omitted, not an empty array).
    const open = store.createApiToken('clerk');
    const openId = /^ohbt_([0-9a-f]+)\./.exec(open)![1];
    assert.equal(store.apiTokens().find((token) => token.id === openId)!.surfaces, undefined);
    // An empty array is also unrestricted.
    const empty = store.createApiToken('clerk', { surfaces: [] });
    const emptyId = /^ohbt_([0-9a-f]+)\./.exec(empty)![1];
    assert.equal(store.apiTokens().find((token) => token.id === emptyId)!.surfaces, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('API tokens with the same creation time list newest insertion first', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tok-order-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const store = new Store(path);
  try {
    store.setPassword('clerk', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
    const first = store.createApiToken('clerk');
    const second = store.createApiToken('clerk');
    const firstId = /^ohbt_([0-9a-f]+)\./.exec(first)![1];
    const secondId = /^ohbt_([0-9a-f]+)\./.exec(second)![1];
    const raw = new DatabaseSync(path);
    try {
      raw.prepare('UPDATE _fm_api_tokens SET created = ? WHERE id IN (?, ?)').run('2026-01-01T00:00:00.000Z', firstId, secondId);
    } finally {
      raw.close();
    }

    assert.deepEqual(store.apiTokens().map((token) => token.id), [secondId, firstId]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('the scope round-trips through apiToken() for enforcement', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tok-surf2-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const store = new Store(path);
  try {
    store.setPassword('clerk', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
    const scoped = store.createApiToken('clerk', { surfaces: ['fmxdbc'] });
    const open = store.createApiToken('clerk');
    assert.deepEqual(store.apiToken(scoped)!.surfaces, ['fmxdbc']);
    assert.equal(store.apiToken(open)!.surfaces, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a file written before the surfaces column gains it and keeps its tokens', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tok-surf3-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  // Mint a token, then drop the surfaces column to look like an older file.
  {
    const store = new Store(path);
    store.setPassword('clerk', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
    store.createApiToken('clerk', { label: 'legacy' });
    store.close();
  }
  const raw = new DatabaseSync(path);
  raw.exec('ALTER TABLE _fm_api_tokens DROP COLUMN surfaces');
  assert.ok(!(raw.prepare('PRAGMA table_info(_fm_api_tokens)').all() as { name: string }[]).some((c) => c.name === 'surfaces'), 'column is gone');
  raw.close();

  // Re-opening migrates the column back without losing the existing token.
  const store = new Store(path);
  try {
    const tokens = store.apiTokens();
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].label, 'legacy');
    assert.equal(tokens[0].surfaces, undefined, 'the migrated token is unrestricted');
    // And a scoped token can now be minted on the migrated file.
    const scoped = store.createApiToken('clerk', { surfaces: ['fmrest'] });
    const id = /^ohbt_([0-9a-f]+)\./.exec(scoped)![1];
    assert.deepEqual(store.apiTokens().find((token) => token.id === id)!.surfaces, ['fmrest']);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
