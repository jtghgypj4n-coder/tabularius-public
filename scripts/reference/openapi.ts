// Builds the OpenAPI 3.1 description of the Data API and OData from the route
// table in scripts/reference/rest/ (the same notes docs/reference/rest.md is
// built from, held against the server's route expressions by the reference
// test) and the response contract in packages/server/test/dataapi-response-contract.json.
// docs-reference.ts writes the result to packages/server/src/data-api.openapi.json.
//
// Nothing here is typed per route: a route's method, path, parameters, summary
// and permissions come from its entry in the table; a response schema is the
// contract's where the contract has one, else it is read off the route's
// documented example and marked x-tabularius-inferred.

import type { RestGroup, RestParam, RestRoute } from './types.ts';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = { [key: string]: Json };

/** The shape language of dataapi-response-contract.json (see the test that reads it). */
export interface Shape {
  $ref?: string;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Shape>;
  extensions?: Record<string, Shape>;
  dynamic?: 'field' | 'relatedField' | 'portal';
  values?: Shape;
  items?: Shape;
  minItems?: number;
  opaque?: boolean;
  scriptResults?: boolean;
}
export interface Contract {
  source: string;
  envelope: Shape;
  definitions: Record<string, Shape>;
  endpoints: Record<string, { method: string; path: string; response: Shape }>;
  errorStatuses: Record<string, number[]>;
  notVerified: Record<string, unknown>;
}

/** Groups whose routes the description covers. */
export const covered = (g: RestGroup): boolean => g.id.startsWith('data-api') || g.id === 'odata';

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${schemaName(name)}` });
/** Contract definitions whose capitalised name would be a TypeScript global (Record) or too bare to read in a .d.ts. */
const RENAMED: Record<string, string> = { record: 'DataRecord', records: 'DataRecords', empty: 'EmptyObject', message: 'Message' };
export const schemaName = (name: string): string => RENAMED[name] ?? name.charAt(0).toUpperCase() + name.slice(1);

/** One contract shape as JSON Schema (2020-12, as OpenAPI 3.1 uses). */
export function fromShape(shape: Shape, contract: Contract): Schema {
  if (shape.$ref) return ref(shape.$ref);
  const out: Schema = {};
  if (shape.type !== undefined) out.type = shape.type;
  if (shape.opaque) return { type: 'object' };
  const types = Array.isArray(shape.type) ? shape.type : [shape.type];
  if (types.includes('array')) {
    if (shape.items) out.items = fromShape(shape.items, contract);
    if (shape.minItems) out.minItems = shape.minItems;
  }
  if (types.includes('object')) {
    const properties: Schema = {};
    for (const [key, item] of Object.entries(shape.properties ?? {})) properties[key] = fromShape(item, contract);
    for (const [key, item] of Object.entries(shape.extensions ?? {})) properties[key] = { ...fromShape(item, contract), 'x-tabularius': true };
    if (shape.scriptResults) {
      for (const [key, item] of Object.entries(contract.definitions.scriptResults?.properties ?? {})) properties[key] ??= fromShape(item, contract);
    }
    out.properties = properties;
    if (shape.required?.length) out.required = shape.required;
    // An object the contract lists the keys of fails on any other key; one with a dynamic part takes that part's values.
    out.additionalProperties = shape.dynamic ? fromShape(shape.values!, contract) : false;
  }
  return out;
}

/** A schema read off one documented example value. Keys are not required: one example cannot say which are. */
export function inferSchema(value: Json): Schema {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    // Elements of different shapes (a batch's replies, say) give one alternative each.
    const shapes = [...new Map(value.map((v) => inferSchema(v)).map((s) => [JSON.stringify(s), s])).values()];
    return shapes.length === 0 ? { type: 'array' } : { type: 'array', items: shapes.length === 1 ? shapes[0]! : { anyOf: shapes } };
  }
  if (typeof value === 'object') {
    const properties: Schema = {};
    for (const [key, item] of Object.entries(value)) properties[key] = inferSchema(item);
    return Object.keys(properties).length ? { type: 'object', properties, additionalProperties: true } : { type: 'object' };
  }
  return { type: typeof value === 'number' ? 'number' : typeof value };
}

/** A route-table parameter type ("string", "array of object", "string, number or object", "file") as JSON Schema. */
export function typeSchema(type: string): Schema {
  const t = type.trim();
  if (t === 'file') return { type: 'string', format: 'binary' };
  if (['string', 'number', 'boolean', 'object', 'array'].includes(t)) return { type: t };
  const list = /^array of (string|number|boolean|object)$/.exec(t);
  if (list) return { type: 'array', items: { type: list[1]! } };
  if (/^[a-z]+(?:, [a-z]+)* or [a-z]+$/.test(t)) {
    const names = t.split(/, | or /);
    if (names.every((n) => ['string', 'number', 'boolean', 'object', 'array'].includes(n))) return { type: names };
  }
  return {};
}

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const IGNORED_HEADERS = new Set(['authorization', 'content-type', 'accept', 'content-disposition']);

/** `/fmi/data/{version}/databases/{database}/sessions` becomes `/databases/{}/sessions`, the contract's spelling. */
export function shortPath(path: string): string {
  return path.replace(/^\/fmi\/data(?:\/\{version\})?/, '').replace(/\{[^}]*\}/g, '{}');
}
const contractKey = (method: string, path: string) => `${method} ${shortPath(path)}`;

export function operationId(method: string, path: string): string {
  const odata = path.startsWith('/fmi/odata');
  const rest = path.replace(/^\/fmi\/data(?:\/\{version\})?/, '').replace(/^\/fmi\/odata\/v4/, '');
  // A segment that was a placeholder reads "By{Name}", so records and records/{recordId} differ.
  const parts: string[] = [];
  const re = /\{([^}]+)\}|([^{}/()]+)/g;
  for (const m of rest.matchAll(re)) {
    const word = (m[1] ?? m[2]!).replace(/[^A-Za-z0-9]+/g, ' ').trim();
    if (!word) continue;
    const pascal = word.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    parts.push(m[1] ? `By${pascal}` : pascal);
  }
  return method.toLowerCase() + (odata ? 'OData' : '') + parts.join('');
}

function parseExample(route: RestRoute): { json?: Json; contentType?: string } {
  const text = route.example.response.trim();
  const paren = /^\(([a-z]+\/[a-z0-9.+-]+):/.exec(text);
  if (paren) return { contentType: paren[1] };
  if (text.startsWith('(')) return {};
  try { return { json: JSON.parse(text) as Json, contentType: 'application/json' }; } catch { return {}; }
}

function requestExample(route: RestRoute): Json | undefined {
  const at = route.example.request.search(/\r?\n\r?\n/);
  if (at < 0) return undefined;
  try { return JSON.parse(route.example.request.slice(at).trim()) as Json; } catch { return undefined; }
}

function security(route: RestRoute): Json[] {
  if (/^None\b/.test(route.permissions)) return [];
  const header = route.params?.find((p) => p.name === 'Authorization');
  if (route.path.startsWith('/fmi/data') && header && /^Basic\b/.test(header.description)) return [{ basicAuth: [] }];
  if (route.path.startsWith('/fmi/odata')) return [{ basicAuth: [] }, { bearerAuth: [] }, { tokenHeader: [] }];
  return [{ bearerAuth: [] }, { tokenHeader: [] }];
}

function bodySchema(params: RestParam[]): { content: Schema } | undefined {
  const body = params.filter((p) => p.in === 'body');
  if (!body.length) return undefined;
  const file = body.some((p) => p.type === 'file');
  const properties: Schema = {};
  const patternProperties: Schema = {};
  const required: string[] = [];
  let free = false;
  for (const p of body) {
    if (p.name === '(properties)') { free = true; continue; }
    const schema = { ...typeSchema(p.type), description: p.description };
    const placeholder = /\{[^}]+\}/.test(p.name);
    if (placeholder) {
      patternProperties[`^${p.name.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '.+')}$`] = schema;
    } else {
      properties[p.name] = schema;
      if (p.required) required.push(p.name);
    }
  }
  const object: Schema = { type: 'object', properties };
  if (Object.keys(patternProperties).length) object.patternProperties = patternProperties;
  if (required.length) object.required = required;
  // An entity's own properties are whatever the entity set has, so the body is open.
  if (free) object.additionalProperties = true;
  return { content: { [file ? 'multipart/form-data' : 'application/json']: { schema: object } } };
}

/** The OpenAPI 3.1 document for the covered groups; the same input always gives the same text. */
export function buildOpenApi(groups: RestGroup[], contract: Contract): Schema {
  const byKey = new Map<string, Shape>();
  for (const e of Object.values(contract.endpoints)) byKey.set(contractKey(e.method, e.path), e.response);
  const extensionOnly = new Set(Object.keys(contract.notVerified).map((key) => {
    const [method, ...path] = key.split(' ');
    return path.length ? contractKey(method!, path.join(' ')) : key;
  }));
  const paths: Schema = {};
  const seen = new Set<string>();
  const tags: Schema[] = [];
  for (const group of groups.filter(covered)) {
    tags.push({ name: group.title, description: group.intro });
    for (const route of group.routes) {
      const methods = route.method.split(',').map((m) => m.trim()).filter((m) => METHODS.includes(m));
      for (const method of methods) {
        const id = operationId(method, route.path);
        if (seen.has(id)) throw new Error(`openapi: operationId ${id} is used twice (${method} ${route.path})`);
        seen.add(id);
        const params = route.params ?? [];
        const parameters: Json[] = [];
        const dynamicQuery: Json[] = [];
        for (const p of params) {
          if (p.in === 'body') continue;
          if (p.in === 'header' && IGNORED_HEADERS.has(p.name.toLowerCase())) continue;
          if (p.in === 'path' && p.name === 'version') { parameters.push({ $ref: '#/components/parameters/Version' }); continue; }
          if (p.in === 'query' && /\{[^}]+\}/.test(p.name)) { dynamicQuery.push({ name: p.name, schema: typeSchema(p.type), description: p.description }); continue; }
          parameters.push({ name: p.name, in: p.in, required: p.in === 'path' ? true : !!p.required, description: p.description, schema: typeSchema(p.type) });
        }
        const example = parseExample(route);
        const success = String(route.example.status);
        const responses: Schema = {};
        const key = contractKey(method, route.path);
        const contractShape = byKey.get(key);
        if (route.example.status === 204 || method === 'HEAD' || (!example.json && !example.contentType)) {
          responses[success] = { description: route.summary };
        } else if (example.json !== undefined) {
          const enveloped = typeof example.json === 'object' && example.json !== null && !Array.isArray(example.json) && 'response' in example.json && 'messages' in example.json;
          let schema: Schema;
          let inferred = false;
          if (enveloped) {
            const inner = contractShape ? fromShape(contractShape, contract) : inferSchema((example.json as { response: Json }).response);
            inferred = !contractShape;
            schema = {
              type: 'object', required: ['response', 'messages'], additionalProperties: false,
              properties: { response: inner, messages: { type: 'array', minItems: 1, items: ref('message') }, 'tabularius:denial': { ...ref('denial'), 'x-tabularius': true } },
            };
          } else {
            schema = inferSchema(example.json);
            inferred = true;
          }
          responses[success] = {
            description: route.summary,
            content: { 'application/json': { schema, example: example.json } },
            ...(inferred ? { 'x-tabularius-inferred': true } : {}),
          };
        } else {
          responses[success] = { description: route.summary, content: { [example.contentType!]: { schema: { type: 'string' } } } };
        }
        const enveloped = route.path.startsWith('/fmi/data/{version}');
        if (enveloped) responses.default = { $ref: '#/components/responses/FileMakerError' };
        else if (route.path.startsWith('/fmi/odata')) responses.default = { $ref: '#/components/responses/ODataError' };
        const operation: Schema = {
          operationId: id,
          tags: [group.title],
          summary: route.summary,
          description: `**Permissions:** ${route.permissions}${route.notes ? `\n\n${route.notes}` : ''}`,
          security: security(route),
          ...(parameters.length ? { parameters } : {}),
          ...(dynamicQuery.length ? { 'x-tabularius-query-patterns': dynamicQuery } : {}),
          responses,
        };
        const body = bodySchema(params);
        if (body) {
          const type = Object.keys(body.content)[0]!;
          const sample = requestExample(route);
          const media = body.content[type] as Schema;
          operation.requestBody = {
            required: params.some((p) => p.in === 'body' && p.required),
            content: { [type]: sample !== undefined && type === 'application/json' ? { ...media, example: sample } : media },
          };
        }
        if (extensionOnly.has(key)) operation['x-tabularius-only'] = true;
        const item = (paths[route.path] ??= {}) as Schema;
        item[method.toLowerCase()] = operation;
      }
    }
  }
  const schemas: Schema = {};
  for (const [name, shape] of Object.entries(contract.definitions)) schemas[schemaName(name)] = fromShape(shape, contract);
  const codes = Object.entries(contract.errorStatuses).map(([code, statuses]) => `${code}: HTTP ${statuses.join(' or ')}`).join('; ');
  return {
    openapi: '3.1.0',
    info: {
      title: 'tabularius Data API and OData',
      version: '1',
      description: 'The FileMaker Data API–compatible REST API and the OData v4 service of a Tabularius server, written from the server\'s route table (docs/reference/rest.md). Response schemas come from the response contract (packages/server/test/dataapi-response-contract.json), which a test holds the server to; where a route has none, the schema is read off the documented example and marked x-tabularius-inferred. Operations and fields that FileMaker\'s own API does not have are marked x-tabularius-only or x-tabularius. This describes what Tabularius does, not what FileMaker Server does.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    tags,
    paths,
    components: {
      securitySchemes: {
        basicAuth: { type: 'http', scheme: 'basic', description: 'An account name and password of the hosted file.' },
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'A Data API session token, or a scoped API token (ohbt_…).' },
        tokenHeader: { type: 'apiKey', in: 'header', name: 'X-FM-Data-Access-Token', description: 'The same token as bearerAuth, in the header FileMaker\'s Data API uses.' },
      },
      parameters: {
        Version: { name: 'version', in: 'path', required: true, description: 'vLatest, v1 or v2 (all answer the same)', schema: { type: 'string', enum: ['vLatest', 'v1', 'v2'] } },
      },
      responses: {
        FileMakerError: {
          description: `An error: HTTP status and FileMaker error code in messages[0].code (a string), response {}. Codes and the HTTP status each answers: ${codes}.`,
          content: { 'application/json': { schema: {
            type: 'object', required: ['response', 'messages'], additionalProperties: false,
            properties: { response: ref('empty'), messages: { type: 'array', minItems: 1, items: ref('message') }, 'tabularius:denial': { ...ref('denial'), 'x-tabularius': true } },
          } } },
        },
        ODataError: {
          description: 'An OData error: {"error": {"code", "message"}}.',
          content: { 'application/json': { schema: {
            type: 'object', required: ['error'], additionalProperties: true,
            properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } }, additionalProperties: true } },
          } } },
        },
      },
      schemas,
    },
  };
}

export function renderOpenApi(groups: RestGroup[], contract: Contract): string {
  return JSON.stringify(buildOpenApi(groups, contract), null, 2) + '\n';
}
