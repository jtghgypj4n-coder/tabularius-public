// docs/admin-api-coverage.md names Claris's Admin API calls and the Tabularius route that answers each. It stays true:
// every route it names exists, and every Admin API route the REST reference lists is named in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const coverage = readFileSync(join(root, 'docs', 'admin-api-coverage.md'), 'utf8');
const reference = readFileSync(join(root, 'docs', 'reference', 'rest.md'), 'utf8');
const source = readFileSync(join(root, 'packages', 'server', 'src', 'adminapi.ts'), 'utf8');

const listed = new Set([...reference.matchAll(/^### `((?:GET|POST|PATCH|PUT|DELETE) \/fmi\/admin\/api\/v2[^`]*)`/gm)].map((m) => m[1]));
const named = [...coverage.matchAll(/`((?:GET|POST|PATCH|PUT|DELETE) \/fmi\/admin\/api\/v2[^`]*)`/g)].map((m) => m[1]);
const pathsOnly = [...coverage.matchAll(/`(\/fmi\/admin\/api\/v2[^`]*)`/g)].map((m) => m[1]);

test('every route the coverage page names with a method is in the REST reference', () => {
  assert.ok(named.length > 20);
  for (const route of named) assert.ok(listed.has(route), `${route} is named in docs/admin-api-coverage.md but is not in the REST reference`);
});

test('every Admin API route the REST reference lists is named in the coverage page', () => {
  assert.ok(listed.size > 20);
  for (const route of listed) assert.ok(named.includes(route), `${route} is in the REST reference but not in docs/admin-api-coverage.md`);
});

test('a route named without a method is one adminapi.ts answers', () => {
  assert.deepEqual(pathsOnly.filter((p) => /^(GET|POST|PATCH|PUT|DELETE) /.test(p)), []);
  for (const route of pathsOnly) {
    const path = route.replace('/fmi/admin/api/v2', '');
    assert.ok(source.includes(`'${path}'`), `${path} is named in docs/admin-api-coverage.md but adminapi.ts has no such route`);
  }
});
