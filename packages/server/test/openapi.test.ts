import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { openApiDocument, typesFromOpenApi, type JsonSchema, type OpenApiDocument, type Operation } from '../src/openapi.ts';
import { createStore } from '../../store/src/index.ts';
import { REST_GROUPS } from '../../../scripts/reference/render.ts';
import { OPENAPI_FILE, CONTRACT_FILE, openApiText } from '../../../scripts/reference/openapi-file.ts';
import { buildOpenApi, covered, operationId, type Contract } from '../../../scripts/reference/openapi.ts';

// The OpenAPI 3.1 description of the Data API and OData is generated from the
// route table (scripts/reference/rest/) and the response contract; this holds
// it to both and to the server (npm run docs:reference regenerates it).

const doc = openApiDocument();
const contract = JSON.parse(readFileSync(CONTRACT_FILE, 'utf8')) as Contract;
const METHODS = ['get', 'head', 'post', 'put', 'patch', 'delete'];
const operations: { id: string; method: string; path: string; op: Operation }[] = [];
for (const [path, item] of Object.entries(doc.paths)) for (const [method, op] of Object.entries(item)) operations.push({ id: op.operationId, method, path, op });

// A small validator for the JSON Schema keywords the description uses.
function resolve(schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const m = /^#\/components\/schemas\/(.+)$/.exec(schema.$ref);
  assert.ok(m && doc.components.schemas[m[1]!], `unresolvable $ref ${schema.$ref}`);
  return doc.components.schemas[m[1]!]!;
}
function validate(value: unknown, schema: JsonSchema, at = '$'): void {
  const s = resolve(schema);
  if (s.oneOf || s.anyOf) {
    const failures: string[] = [];
    for (const choice of s.oneOf ?? s.anyOf!) { try { validate(value, choice, at); return; } catch (e) { failures.push((e as Error).message); } }
    assert.fail(`${at}: no alternative matched: ${failures.join(' | ')}`);
  }
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    assert.ok(types.includes(actual) || (actual === 'number' && types.includes('integer')), `${at}: expected ${types.join('|')}, got ${actual}`);
  }
  if (s.enum) assert.ok(s.enum.includes(value as never), `${at}: ${String(value)} is not one of ${s.enum.join(', ')}`);
  if (Array.isArray(value)) {
    if (s.items) value.forEach((item, i) => validate(item, s.items!, `${at}[${i}]`));
    const min = (s as { minItems?: number }).minItems;
    if (min !== undefined) assert.ok(value.length >= min, `${at}: needs ${min} items`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  for (const key of s.required ?? []) assert.ok(Object.hasOwn(object, key), `${at}: missing ${key}`);
  for (const [key, item] of Object.entries(object)) {
    const declared = s.properties?.[key];
    if (declared) { validate(item, declared, `${at}.${key}`); continue; }
    const pattern = Object.entries(s.patternProperties ?? {}).find(([re]) => new RegExp(re).test(key));
    if (pattern) { validate(item, pattern[1], `${at}.${key}`); continue; }
    const extra = s.additionalProperties;
    if (extra === undefined || extra === true) continue;
    assert.ok(extra !== false, `${at}: unlisted key ${key}`);
    validate(item, extra, `${at}.${key}`);
  }
}

function refs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => refs(n, found));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { if (k === '$ref' && typeof v === 'string') found.push(v); else refs(v, found); }
  }
  return found;
}
const pointer = (ref: string): unknown => ref.slice(2).split('/').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], doc);

test('openapi: the committed description is the one the route table and contract generate', () => {
  assert.equal(readFileSync(OPENAPI_FILE, 'utf8'), openApiText(), 'out of date; run npm run docs:reference');
});

test('openapi: structure: required keys, resolvable $refs, declared parameters, known security schemes', () => {
  assert.equal(doc.openapi, '3.1.0');
  assert.ok(doc.info.title && doc.info.version, 'info.title and info.version');
  for (const ref of refs(doc)) assert.notEqual(pointer(ref), undefined, `${ref} does not resolve`);
  const schemes = Object.keys((doc.components['securitySchemes'] ?? {}) as object);
  assert.ok(schemes.length >= 3);
  const ids = new Set<string>();
  for (const { id, method, path, op } of operations) {
    const label = `${method.toUpperCase()} ${path}`;
    assert.ok(METHODS.includes(method), `${label}: method`);
    assert.match(id, /^[a-z][A-Za-z0-9]*$/, `${label}: operationId`);
    assert.ok(!ids.has(id), `${label}: operationId ${id} used twice`);
    ids.add(id);
    assert.ok(op.summary?.trim(), `${label}: summary`);
    assert.match(String((op as { description?: string }).description), /^\*\*Permissions:\*\* \S/, `${label}: permissions text`);
    const security = (op as { security?: Record<string, unknown>[] }).security;
    assert.ok(Array.isArray(security), `${label}: security`);
    for (const requirement of security!) for (const name of Object.keys(requirement)) assert.ok(schemes.includes(name), `${label}: security scheme ${name}`);
    const declared = (op.parameters ?? []).map((p) => (p.$ref ? pointer(p.$ref) as { name: string; in: string; required?: boolean } : p as { name: string; in: string; required?: boolean }));
    const inPath = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!).sort();
    const pathParams = declared.filter((p) => p.in === 'path');
    assert.deepEqual(pathParams.map((p) => p.name).sort(), inPath, `${label}: path parameters`);
    for (const p of pathParams) assert.equal(p.required, true, `${label}: ${p.name} is required`);
    assert.ok(Object.keys(op.responses).some((code) => /^[1-5]\d\d$/.test(code)), `${label}: a status response`);
    for (const response of Object.values(op.responses)) for (const media of Object.values(response.content ?? {})) assert.ok(media.schema, `${label}: response schema`);
    for (const media of Object.values(op.requestBody?.content ?? {})) assert.ok(media.schema, `${label}: body schema`);
  }
});

test('openapi: every route in the route table has an operation, and every operation a route', () => {
  const expected = new Set<string>();
  for (const group of REST_GROUPS.filter(covered)) {
    for (const route of group.routes) {
      for (const method of route.method.split(',').map((m) => m.trim())) {
        const id = operationId(method, route.path);
        expected.add(id);
        const found = operations.find((o) => o.id === id);
        assert.ok(found, `${method} ${route.path} has no operation; run npm run docs:reference`);
        assert.equal(found.path, route.path);
        assert.equal(found.method, method.toLowerCase());
        assert.equal(found.op.summary, route.summary);
      }
    }
  }
  assert.deepEqual(operations.map((o) => o.id).filter((id) => !expected.has(id)), [], 'operations whose route is no longer in the route table');
  // Every Data API route of the code is in the table (reference-docs.test.ts), so the description is complete for the Data API and OData.
  assert.ok(operations.length > 50);
});

test('openapi: every contract endpoint lands on one operation, and its schema is the contract\'s', () => {
  for (const [name, endpoint] of Object.entries(contract.endpoints)) {
    const matches = operations.filter((o) => o.method === endpoint.method.toLowerCase()
      && o.path.replace(/^\/fmi\/data\/\{version\}/, '').replace(/\{[^}]*\}/g, '{}') === endpoint.path.replace(/\{[^}]*\}/g, '{}'));
    assert.equal(matches.length, 1, `contract endpoint ${name} (${endpoint.method} ${endpoint.path}) matches ${matches.length} operations`);
    const ok = Object.entries(matches[0]!.op.responses).find(([code]) => /^2/.test(code))![1] as { 'x-tabularius-inferred'?: boolean; content: Record<string, { schema: JsonSchema }> };
    assert.equal(ok['x-tabularius-inferred'], undefined, `${name} is from the contract, not inferred`);
    const envelope = ok.content['application/json']!.schema;
    assert.deepEqual(envelope.required, ['response', 'messages']);
  }
});

test('openapi: each route\'s documented example response validates against its schema', () => {
  let checked = 0;
  for (const group of REST_GROUPS.filter(covered)) {
    for (const route of group.routes) {
      let json: unknown;
      try { json = JSON.parse(route.example.response); } catch { continue; }
      for (const method of route.method.split(',').map((m) => m.trim()).filter((m) => m !== 'HEAD')) {
        const { op } = operations.find((o) => o.id === operationId(method, route.path))!;
        const response = op.responses[String(route.example.status)];
        assert.ok(response?.content, `${method} ${route.path}: no ${route.example.status} response with content`);
        validate(json, response.content['application/json']!.schema, `${method} ${route.path}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 40, `only ${checked} examples validated`);
});

test('openapi: the validator rejects what the schemas forbid', () => {
  const find = operations.find((o) => o.id === 'postDatabasesByDatabaseLayoutsByLayoutFind')!.op.responses['200']!.content!['application/json']!.schema;
  const good = { response: { data: [], dataInfo: { database: 'a', layout: 'a', table: 'a', totalRecordCount: 0, foundCount: 0, returnedCount: 0 } }, messages: [{ code: '0', message: 'OK' }] };
  validate(good, find);
  assert.throws(() => validate({ ...good, invented: 1 }, find), /unlisted key invented/);
  assert.throws(() => validate({ ...good, messages: [] }, find), /needs 1 items/);
  assert.throws(() => validate({ ...good, response: { ...good.response, dataInfo: { ...good.response.dataInfo, foundCount: '0' } } }, find), /expected number/);
  assert.throws(() => validate({ ...good, response: { data: [] } }, find), /missing dataInfo/);
});

test('openapi: a route dropped from the table drops its operation, and a clash of names is refused', () => {
  const trimmed = REST_GROUPS.map((g) => ({ ...g, routes: g.routes.filter((r) => r.path !== '/fmi/data/{version}/productInfo') }));
  const paths = (buildOpenApi(trimmed, contract) as { paths: Record<string, unknown> }).paths;
  assert.equal(paths['/fmi/data/{version}/productInfo'], undefined);
  assert.notDeepEqual(Object.keys(paths), Object.keys(doc.paths));
  const first = REST_GROUPS.find(covered)!;
  const clash = [{ ...first, routes: [...first.routes, first.routes[0]!] }];
  assert.throws(() => buildOpenApi(clash, contract), /operationId \w+ is used twice/);
});

let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-openapi-'));
  createStore(join(dir, 'Pairs' + STORE_EXT));
  const app = await serve({ dir, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
  server = app.server;
  base = app.url;
  const store = app.host.get('Pairs')!;
  store.applyDesign([{ op: 'createTable', name: 'Contacts', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }]);
  store.create('Contacts', { Id: 1, Name: 'Existing' });
  store.setPassword('Admin', 'pw', '[Full Access]');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function call(path: string, method = 'GET', auth?: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, {
    method, headers: { ...(auth ? { authorization: auth } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('openapi: live replies match the description, success and error, request and response', async () => {
  const schemaOf = (id: string, code: string): JsonSchema => {
    const response = operations.find((o) => o.id === id)!.op.responses[code]!;
    if (response.$ref) return (pointer(response.$ref) as { content: Record<string, { schema: JsonSchema }> }).content['application/json']!.schema;
    return response.content!['application/json']!.schema;
  };
  const pair = async (id: string, code: string, path: string, method: string, auth?: string, body?: unknown) => {
    const reply = await call(path, method, auth, body);
    assert.equal(reply.status, Number(code) === 200 ? 200 : reply.status, id);
    validate(reply.body, schemaOf(id, code), id);
    return reply.body as { response: Record<string, any> };
  };
  const login = await pair('postDatabasesByDatabaseSessions', '200', '/fmi/data/vLatest/databases/Pairs/sessions', 'POST', 'Basic ' + btoa('Admin:pw'), {});
  const auth = `Bearer ${login.response.token}`;
  const layout = '/fmi/data/vLatest/databases/Pairs/layouts/Contacts';
  await pair('getProductInfo', '200', '/fmi/data/vLatest/productInfo', 'GET');
  await pair('getDatabases', '200', '/fmi/data/vLatest/databases', 'GET');
  await pair('getValidateSession', '200', '/fmi/data/vLatest/validateSession', 'GET', auth);
  await pair('getDatabasesByDatabaseLayouts', '200', '/fmi/data/vLatest/databases/Pairs/layouts', 'GET', auth);
  await pair('getDatabasesByDatabaseLayoutsByLayout', '200', layout, 'GET', auth);
  const range = await pair('getDatabasesByDatabaseLayoutsByLayoutRecords', '200', `${layout}/records`, 'GET', auth);
  const created = await pair('postDatabasesByDatabaseLayoutsByLayoutRecords', '200', `${layout}/records`, 'POST', auth, { fieldData: { Id: 2, Name: 'New' } });
  await pair('getDatabasesByDatabaseLayoutsByLayoutRecordsByRecordId', '200', `${layout}/records/${range.response.data[0].recordId}`, 'GET', auth);
  await pair('patchDatabasesByDatabaseLayoutsByLayoutRecordsByRecordId', '200', `${layout}/records/${created.response.recordId}`, 'PATCH', auth, { fieldData: { Name: 'Edited' } });
  await pair('postDatabasesByDatabaseLayoutsByLayoutFind', '200', `${layout}/_find`, 'POST', auth, { query: [{ Name: 'Existing' }] });
  await pair('deleteDatabasesByDatabaseLayoutsByLayoutRecordsByRecordId', '200', `${layout}/records/${created.response.recordId}`, 'DELETE', auth);
  // The error envelope every Data API operation names as its default.
  const errors = [
    ['/fmi/data/vLatest/databases/Pairs/layouts/NoSuchLayout', 105],
    ['/fmi/data/vLatest/databases/Pairs/layouts', 952],
  ] as const;
  for (const [path, code] of errors) {
    const reply = await call(path, 'GET', code === 952 ? 'Bearer invalid' : auth);
    assert.equal((reply.body as { messages: { code: string }[] }).messages[0]!.code, String(code));
    validate(reply.body, schemaOf('getDatabasesByDatabaseLayouts', 'default'), String(code));
  }
});

test('openapi: GET /fmi/data/openapi.json serves the description with this server as its server', async () => {
  const got = await fetch(`${base}/fmi/data/openapi.json`);
  assert.equal(got.status, 200);
  assert.match(got.headers.get('content-type') ?? '', /^application\/json/);
  const served = await got.json() as OpenApiDocument;
  assert.deepEqual(served.servers, [{ url: base }]);
  assert.deepEqual({ ...served, servers: undefined }, { ...doc, servers: undefined });
  const head = await fetch(`${base}/fmi/data/openapi.json`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await fetch(`${base}/fmi/data/openapi.json`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal(((await post.json()) as { messages: { code: string }[] }).messages[0]!.code, '3');
});

test('openapi: api-types writes a .d.ts that compiles under strict and names every operation', () => {
  const text = typesFromOpenApi(doc);
  const out = mkdtempSync(join(tmpdir(), 'tabularius-api-types-'));
  try {
    writeFileSync(join(out, 'tabularius-api.d.ts'), text);
    const tsc = join(import.meta.dirname, '..', '..', '..', 'node_modules', 'typescript', 'bin', 'tsc');
    const compiled = spawnSync(process.execPath, [tsc, '--noEmit', '--strict', '--skipLibCheck', 'false', join(out, 'tabularius-api.d.ts')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    for (const { id } of operations) assert.ok(text.includes(`  ${id}: {`), `${id} missing from the types`);
    assert.match(text, /export type DataRecord = \{/);
    assert.match(text, /getDatabasesByDatabaseLayoutsByLayoutRecords: \{\n    method: "GET";\n    route: "\/fmi\/data\/\{version\}\/databases\/\{database\}\/layouts\/\{layout\}\/records";/);
    // Checks the typed shape of a real reply: assigning it to the generated type compiles.
    writeFileSync(join(out, 'use.ts'), `import type { Operations } from './tabularius-api.d.ts';\nconst reply: Operations['getProductInfo']['response'] = { response: { productInfo: { name: 'x', dateFormat: 'a', timeFormat: 'b', timeStampFormat: 'c' } }, messages: [{ code: '0', message: 'OK' }] };\nvoid reply;\n// @ts-expect-error the response has a messages array\nconst bad: Operations['getProductInfo']['response'] = { response: { productInfo: {} } };\nvoid bad;\n`);
    const used = spawnSync(process.execPath, [tsc, '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--allowImportingTsExtensions', join(out, 'use.ts')], { encoding: 'utf8' });
    assert.equal(used.status, 0, used.stdout + used.stderr);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('openapi: the CLI prints the same types', () => {
  const main = join(import.meta.dirname, '..', '..', 'cli', 'src', 'main.ts');
  const r = spawnSync(process.execPath, ['--no-warnings', main, 'api-types'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, typesFromOpenApi(doc));
  const extra = spawnSync(process.execPath, ['--no-warnings', main, 'api-types', 'Contacts'], { encoding: 'utf8' });
  assert.equal(extra.status, 1);
  assert.match(extra.stderr, /api-types: takes no arguments/);
});
