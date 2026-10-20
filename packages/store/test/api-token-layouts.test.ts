// An API token can be scoped to a subset of the file's Data API layouts; the
// scope is validated against the schema, canonicalised, stored, listed and
// round-tripped for enforcement, and an older file with no `layouts` column
// migrates in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importFmp12, Store } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('a layout scope is validated, canonicalised and deduped; an unknown layout is refused', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tok-lay-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const store = new Store(path);
  try {
    store.setPassword('clerk', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);

    // Names are matched case-insensitively, stored in the schema's casing, deduped.
    const scoped = store.createApiToken('clerk', { label: 'reporting', layouts: ['nw customers', 'NW Customers', 'NW Line Items'] });
    const id = /^ohbt_([0-9a-f]+)\./.exec(scoped)![1];
    assert.deepEqual(store.apiTokens().find((token) => token.id === id)!.layouts, ['NW Customers', 'NW Line Items']);

    // An unknown layout is refused at creation.
    assert.throws(() => store.createApiToken('clerk', { layouts: ['NW Customers', 'Nope'] }), /No layout/);

    // No layouts given → unrestricted (the field is omitted, not an empty array).
    const open = store.createApiToken('clerk');
    const openId = /^ohbt_([0-9a-f]+)\./.exec(open)![1];
    assert.equal(store.apiTokens().find((token) => token.id === openId)!.layouts, undefined);
    const empty = store.createApiToken('clerk', { layouts: [] });
    const emptyId = /^ohbt_([0-9a-f]+)\./.exec(empty)![1];
    assert.equal(store.apiTokens().find((token) => token.id === emptyId)!.layouts, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a layout scope requires the Data API surface when surfaces are also chosen', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tok-lay2-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const store = new Store(path);
  try {
    store.setPassword('clerk', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
    // The table-oriented surfaces can't honour a layout scope, so pairing a
    // layout scope with only those is refused rather than silently unscoped.
    assert.throws(() => store.createApiToken('clerk', { surfaces: ['fmxdbc'], layouts: ['NW Customers'] }), /must allow the Data API/);
    assert.throws(() => store.createApiToken('clerk', { surfaces: ['fmodata'], layouts: ['NW Customers'] }), /must allow the Data API/);
    // With fmrest present it is allowed.
    const token = store.createApiToken('clerk', { surfaces: ['fmrest', 'fmxdbc'], layouts: ['NW Customers'] });
    assert.deepEqual(store.apiToken(token)!.layouts, ['NW Customers']);
    assert.deepEqual(store.apiToken(token)!.surfaces, ['fmrest', 'fmxdbc']);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('the scope round-trips through apiToken() for enforcement', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tok-lay3-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const store = new Store(path);
  try {
    store.setPassword('clerk', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
    const scoped = store.createApiToken('clerk', { layouts: ['NW Customers', 'Home'] });
    const open = store.createApiToken('clerk');
    assert.deepEqual(store.apiToken(scoped)!.layouts, ['NW Customers', 'Home']);
    assert.equal(store.apiToken(open)!.layouts, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a file written before the layouts column gains it and keeps its tokens', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tok-lay4-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  {
    const store = new Store(path);
    store.setPassword('clerk', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
    store.createApiToken('clerk', { label: 'legacy' });
    store.close();
  }
  const raw = new DatabaseSync(path);
  raw.exec('ALTER TABLE _fm_api_tokens DROP COLUMN layouts');
  assert.ok(!(raw.prepare('PRAGMA table_info(_fm_api_tokens)').all() as { name: string }[]).some((c) => c.name === 'layouts'), 'column is gone');
  raw.close();

  const store = new Store(path);
  try {
    const tokens = store.apiTokens();
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].label, 'legacy');
    assert.equal(tokens[0].layouts, undefined, 'the migrated token is unrestricted');
    // And a layout-scoped token can now be minted on the migrated file.
    const scoped = store.createApiToken('clerk', { layouts: ['NW Customers'] });
    const id = /^ohbt_([0-9a-f]+)\./.exec(scoped)![1];
    assert.deepEqual(store.apiTokens().find((token) => token.id === id)!.layouts, ['NW Customers']);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
