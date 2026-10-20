// The OpenAPI 3.1 description of the Data API and OData, and the TypeScript
// types written from it. The description itself is generated from the route
// table (npm run docs:reference writes data-api.openapi.json); this file only
// serves it and turns it into types, with no dependency.

import { readFileSync } from 'node:fs';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface OpenApiDocument { openapi: string; info: Record<string, Json>; servers?: { url: string }[]; paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, JsonSchema>; [key: string]: Json | Record<string, JsonSchema> } }
interface Parameter { name?: string; in?: string; required?: boolean; schema?: JsonSchema; $ref?: string }
export interface Operation {
  operationId: string;
  summary?: string;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content: Record<string, { schema: JsonSchema }> };
  responses: Record<string, { content?: Record<string, { schema: JsonSchema }>; $ref?: string }>;
}
export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: Json[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  patternProperties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  description?: string;
}

let cached: OpenApiDocument | undefined;

/** The description as generated; `address` (this server's origin) becomes its one server. */
export function openApiDocument(address?: string): OpenApiDocument {
  cached ??= JSON.parse(readFileSync(new URL('./data-api.openapi.json', import.meta.url), 'utf8')) as OpenApiDocument;
  return address ? { ...cached, servers: [{ url: address }] } : cached;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (name: string): string => (IDENT.test(name) ? name : JSON.stringify(name));
const TYPES: Record<string, string> = { string: 'string', number: 'number', integer: 'number', boolean: 'boolean', null: 'null', array: 'unknown[]' };

/** One JSON Schema as a TypeScript type. */
function tsType(schema: JsonSchema | undefined, indent: string): string {
  if (!schema || Object.keys(schema).length === 0) return 'unknown';
  if (schema.$ref) return schema.$ref.replace(/^#\/components\/schemas\//, '');
  const choices = schema.oneOf ?? schema.anyOf;
  if (choices) return choices.map((c) => tsType(c, indent)).join(' | ');
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length === 0) return 'unknown';
  return types.map((t) => {
    if (t === 'string' && schema.format === 'binary') return 'Blob';
    if (t === 'array') return schema.items ? `${wrap(tsType(schema.items, indent))}[]` : 'unknown[]';
    if (t === 'object') return objectType(schema, indent);
    return TYPES[t] ?? 'unknown';
  }).join(' | ');
}

const wrap = (type: string): string => (/[|&]/.test(type) ? `(${type})` : type);

function objectType(schema: JsonSchema, indent: string): string {
  const props = schema.properties ?? {};
  const inner = `${indent}  `;
  const lines: string[] = [];
  const required = new Set(schema.required ?? []);
  for (const [name, value] of Object.entries(props)) lines.push(`${inner}${key(name)}${required.has(name) ? '' : '?'}: ${tsType(value, inner)};`);
  // Dynamic keys (a layout's own field names, say) take an index signature that every named property must also fit.
  const more: JsonSchema[] = [];
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') more.push(schema.additionalProperties);
  if (schema.patternProperties) more.push(...Object.values(schema.patternProperties));
  if (schema.additionalProperties === true) {
    lines.push(`${inner}[key: string]: unknown;`);
  } else if (more.length) {
    const parts = [...more, ...Object.values(props)].map((m) => tsType(m, inner));
    if (Object.keys(props).some((name) => !required.has(name))) parts.push('undefined');
    lines.push(`${inner}[key: string]: ${[...new Set(parts)].join(' | ')};`);
  }
  if (lines.length === 0) return schema.additionalProperties === false ? '{ [key: string]: never }' : '{ [key: string]: unknown }';
  return `{\n${lines.join('\n')}\n${indent}}`;
}

const lower = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

/**
 * A .d.ts for the description: one type for each named schema, and `Operations`,
 * which gives each operation its method, route, parameters, request body and
 * success response by operationId.
 */
export function typesFromOpenApi(doc: OpenApiDocument): string {
  const out: string[] = [
    '// Tabularius API types, written from the server\'s own OpenAPI description:',
    '//   tabularius api-types > tabularius-api.d.ts',
    '// Do not edit; regenerate after upgrading the server.',
    '',
  ];
  for (const [name, schema] of Object.entries(doc.components.schemas)) {
    if (schema.description) out.push(`/** ${schema.description.replace(/\*\//g, '* /')} */`);
    out.push(`export type ${name} = ${tsType(schema, '')};`, '');
  }
  const shared = (doc.components['parameters'] ?? {}) as Record<string, Parameter>;
  out.push('export interface Operations {');
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const params = (op.parameters ?? []).map((p) => (p.$ref ? shared[p.$ref.replace(/^#\/components\/parameters\//, '')]! : p));
      const group = (where: string) => {
        const list = params.filter((p) => p.in === where);
        if (!list.length) return undefined;
        return `{ ${list.map((p) => `${key(p.name!)}${p.required ? '' : '?'}: ${tsType(p.schema, '    ')}`).join('; ')} }`;
      };
      const success = Object.entries(op.responses).find(([code]) => /^2\d\d$/.test(code))?.[1];
      const media = success?.content ? Object.values(success.content)[0] : undefined;
      const body = op.requestBody ? Object.values(op.requestBody.content)[0] : undefined;
      const fields = [
        `method: ${JSON.stringify(method.toUpperCase())}`,
        `route: ${JSON.stringify(path)}`,
        ...([['path', 'params'], ['query', 'query'], ['header', 'headers']] as const).flatMap(([where, name]) => { const g = group(where); return g ? [`${name}${params.some((p) => p.in === where && p.required) ? '' : '?'}: ${g}`] : []; }),
        ...(body ? [`body${op.requestBody!.required ? '' : '?'}: ${tsType(body.schema, '    ')}`] : []),
        `response: ${media ? tsType(media.schema, '    ') : 'void'}`,
      ];
      if (op.summary) out.push(`  /** ${op.summary.replace(/\*\//g, '* /')} */`);
      out.push(`  ${key(lower(op.operationId))}: {`, ...fields.map((f) => `    ${f};`), '  };');
    }
  }
  out.push('}', '');
  return out.join('\n');
}
