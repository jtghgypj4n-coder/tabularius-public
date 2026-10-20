// The MCP server against the Model Context Protocol specification, over both of its transports (Streamable HTTP at /mcp
// and stdio). The wire cases are data (data/mcp-conformance.json): each cites the revision and section it follows, or says
// it is a choice the specification leaves open. On top of those: every tool's schemas are valid JSON Schema and the
// reference examples fit them, and docs/mcp-conformance.md lists exactly the cases there are.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { MCP_NOTES, mcpListing, type McpListing } from '../../../scripts/reference/render.ts';
import { instanceProblems, schemaProblems } from './json-schema-lite.ts';

type Expect = {
  none?: boolean; status?: number; statusAnyOf?: number[]; contentType?: string; noHeader?: string; stream?: boolean; nullId?: boolean;
  error?: number; errorData?: Record<string, unknown>; errorMessageNot?: string;
  result?: { equals?: unknown; has?: string[]; absent?: string[]; at?: Record<string, unknown> };
};
type Case = {
  id: string; spec: string; kind: 'spec' | 'choice'; rule: string; transports: ('http' | 'stdio')[];
  message?: unknown; body?: string; line?: string; method?: string; headers?: Record<string, string | null>; expect: Expect;
};
const cases: Case[] = JSON.parse(readFileSync(join(import.meta.dirname, 'data', 'mcp-conformance.json'), 'utf8')).cases;
const ROOT = join(import.meta.dirname, '..', '..', '..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What came back for one thing sent: an HTTP status, and the JSON-RPC messages (none for a notification). */
type Seen = { status?: number; headers?: Headers; messages: Record<string, any>[] };

const dig = (value: unknown, path: string): unknown => path.split('.').reduce<any>((at, part) => (at === null || typeof at !== 'object' ? undefined : at[part]), value);
const subset = (got: any, want: any): boolean => want !== null && typeof want === 'object'
  ? got !== null && typeof got === 'object' && Object.entries(want).every(([k, v]) => subset(got[k], v))
  : got === want;

let dir: string;
let server: Server;
let base: string;
let child: ChildProcessWithoutNullStreams;
let stdout = '';
let stderr = '';

// A CLI regression must never start a machine-management or network command from this test.
// The executable itself is launched by absolute path; every child inherits only these stubs on PATH.
function guardedEnv(folder: string): NodeJS.ProcessEnv {
  const bin = join(folder, 'stub-bin');
  mkdirSync(bin, { recursive: true });
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(bin, name), '#!/bin/sh\nprintf "%s\\n" "$0" >> "$TABULARIUS_CONFORMANCE_STUB_MARKER"\nexit 99\n', { mode: 0o755 });
  }
  return { ...process.env, PATH: bin, TABULARIUS_HOME: join(folder, '.home'), TABULARIUS_CONFORMANCE_STUB_MARKER: join(folder, 'stub-invoked') };
}

function assertNoStubInvoked(folder: string): void {
  const marker = join(folder, 'stub-invoked');
  assert.equal(existsSync(marker), false, `a guarded command ran: ${existsSync(marker) ? readFileSync(marker, 'utf8') : ''}`);
}

async function stopChild(p: ChildProcessWithoutNullStreams): Promise<void> {
  if (p.exitCode !== null || p.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => p.once('exit', () => resolve()));
  p.kill();
  await exited;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-conformance-'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  child = spawn(process.execPath, ['--no-warnings', join(ROOT, 'packages/cli/src/main.ts'), 'mcp', dir], {
    env: guardedEnv(dir), stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const initialize = await stdio(JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'conformance', version: '1' } } }), 'init');
  assert.equal(initialize.messages[0]?.result?.protocolVersion, '2025-06-18', 'the stdio server starts');
  await stdio(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
});
after(async () => {
  child?.stdin.end();
  if (child) await stopChild(child);
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) {
    try { assertNoStubInvoked(dir); }
    finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
  }
});

/** Writes one line and returns what the server wrote back: up to the answer with `id`, or what arrives in a short quiet. */
async function stdio(line: string, id?: string | number): Promise<Seen> {
  const start = stdout.length;
  child.stdin.write(line + '\n');
  // Only whole lines: a long answer arrives in pieces (a pipe hands over 64 KiB at a time), and the last piece may stop mid-line.
  const messages = () => {
    const seen = stdout.slice(start);
    return seen.slice(0, seen.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
  };
  const deadline = Date.now() + 15_000;
  if (id === undefined) await sleep(400);
  else while (!messages().some((m) => m.id === id) && Date.now() < deadline) await sleep(10);
  return { messages: messages() };
}

async function http(c: Case): Promise<Seen> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' };
  for (const [k, v] of Object.entries(c.headers ?? {})) { if (v === null) delete headers[k]; else headers[k] = v; }
  const method = c.method ?? 'POST';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const res = await fetch(`${base}/mcp`, { method, headers, signal: ac.signal, body: method === 'POST' ? (c.body ?? JSON.stringify(c.message)) : undefined });
    // A GET may hold its event stream open; its status is the answer.
    if (c.expect.stream) { ac.abort(); return { status: res.status, headers: res.headers, messages: [] }; }
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    return { status: res.status, headers: res.headers, messages: parsed === undefined ? [] : [parsed].flat() };
  } finally { clearTimeout(timer); }
}

function check(c: Case, seen: Seen, transport: string): void {
  const where = `${c.id} [${transport}] (${c.spec}): ${c.rule}`;
  const e = c.expect;
  const [m] = seen.messages;
  if (seen.status !== undefined) {
    if (e.statusAnyOf) assert.ok(e.statusAnyOf.includes(seen.status), `${where}\nstatus ${seen.status}, wanted one of ${e.statusAnyOf}`);
    else if (e.status !== undefined) assert.equal(seen.status, e.status, where);
    else if (!e.none) assert.equal(seen.status, 200, where);
  }
  if (e.contentType) assert.match(seen.headers?.get('content-type') ?? '', new RegExp('^' + e.contentType.replace('/', '\\/')), where);
  if (e.noHeader) assert.equal(seen.headers?.get(e.noHeader), null, `${where}\nsent ${e.noHeader}`);
  if (e.none) return assert.deepEqual(seen.messages, [], `${where}\nanswered`);
  if (!e.error && !e.result) return;
  assert.equal(seen.messages.length, 1, `${where}\n${seen.messages.length} messages: ${JSON.stringify(seen.messages)}`);
  assert.equal(m!.jsonrpc, '2.0', where);
  assert.ok(('result' in m!) !== ('error' in m!), `${where}\nexactly one of result and error: ${JSON.stringify(m)}`);
  const sent = c.message as { id?: unknown } | undefined;
  if (e.nullId) assert.equal(m!.id, null, where);
  else if (sent && 'id' in sent) assert.equal(m!.id, sent.id, `${where}\nthe id is echoed`);
  if (e.error !== undefined) {
    assert.equal(m!.error?.code, e.error, `${where}\n${JSON.stringify(m)}`);
    assert.equal(typeof m!.error.message, 'string', where);
    if (e.errorData) assert.ok(subset(m!.error.data, e.errorData), `${where}\nerror.data ${JSON.stringify(m!.error.data)}`);
    if (e.errorMessageNot) assert.doesNotMatch(m!.error.message, new RegExp(e.errorMessageNot), `${where}\nthe message dumps a schema check`);
  }
  if (e.result) {
    assert.ok('result' in m!, `${where}\n${JSON.stringify(m)}`);
    const r = e.result;
    if (r.equals !== undefined) assert.deepEqual(m!.result, r.equals, where);
    for (const p of r.has ?? []) assert.notEqual(dig(m!.result, p), undefined, `${where}\nresult.${p} is missing`);
    for (const p of r.absent ?? []) assert.equal(dig(m!.result, p), undefined, `${where}\nresult.${p} is present`);
    for (const [p, v] of Object.entries(r.at ?? {})) assert.deepEqual(dig(m!.result, p), v, `${where}\nresult.${p}`);
  }
}

for (const transport of ['http', 'stdio'] as const) {
  test(`wire cases over ${transport}`, async (t) => {
    for (const c of cases.filter((x) => x.transports.includes(transport))) {
      await t.test(c.id, async () => {
        if (transport === 'http') return check(c, await http(c), 'http');
        const id = (c.message as { id?: string | number } | undefined)?.id;
        check(c, await stdio(c.line ?? JSON.stringify(c.message), id), 'stdio');
      });
    }
  });
}

test('every case cites a revision and section, and says whether the specification or a choice fixes it', () => {
  const ids = new Set<string>();
  for (const c of cases) {
    assert.ok(!ids.has(c.id), `${c.id} twice`);
    ids.add(c.id);
    assert.match(c.spec, /^(20\d\d-\d\d-\d\d|JSON-RPC 2\.0) /, `${c.id}: start the citation with a revision`);
    assert.ok(c.spec.length > 12 && c.rule.length > 20, `${c.id}: cite a section and say the rule`);
    assert.ok(c.kind === 'spec' || c.kind === 'choice', c.id);
    assert.ok(c.transports.length && c.transports.every((x) => x === 'http' || x === 'stdio'), c.id);
  }
  assert.ok(cases.length >= 60, `${cases.length} cases`);
});

test('stdout carries only JSON-RPC messages, one per line, and the server logs nothing to a client', async () => {
  const lines = stdout.split('\n');
  assert.equal(lines.at(-1), '', 'the last message ends in a newline');
  for (const line of lines.filter(Boolean)) {
    const m = JSON.parse(line);
    assert.equal(m.jsonrpc, '2.0', line.slice(0, 120));
  }
  assert.equal(stderr, '', 'a quiet server');
});

test('stdio: closing stdin ends the server (clean exit)', async () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'tabularius-mcp-conformance-exit-'));
  const p = spawn(process.execPath, ['--no-warnings', join(ROOT, 'packages/cli/src/main.ts'), 'mcp', dir2], { env: guardedEnv(dir2), stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
    while (!out.includes('\n')) await sleep(20);
    const exited = new Promise<number | null>((r) => p.on('exit', (code) => r(code)));
    p.stdin.end();
    const code = await Promise.race([exited, sleep(10_000).then(() => 'still running')]);
    assert.equal(code, 0, 'the server leaves when the client closes its input (2025-06-18 Base › Transports › stdio › Shutdown)');
  } finally {
    await stopChild(p);
    try { assertNoStubInvoked(dir2); }
    finally { rmSync(dir2, { recursive: true, force: true, maxRetries: 5 }); }
  }
});

let listing: McpListing;
const tools = async () => (listing ??= await mcpListing()).tools;

test('every tool, resource template and prompt is well formed and named uniquely', async () => {
  const l = (listing ??= await mcpListing());
  assert.ok(l.tools.length > 80);
  const names = new Set<string>();
  for (const t of l.tools) {
    // 2025-11-25 Server › Tools › Tool names: 1 to 128 of letters, digits, underscore, hyphen and dot; unique.
    assert.match(t.name, /^[A-Za-z0-9_.-]{1,128}$/, t.name);
    assert.ok(!names.has(t.name), `${t.name} twice`);
    names.add(t.name);
    assert.equal(typeof (t as { description?: unknown }).description, 'string', t.name);
  }
  for (const r of l.resourceTemplates) {
    assert.ok(r.name && r.uriTemplate, JSON.stringify(r));
    assert.match(r.uriTemplate, /^[a-z][a-z0-9+.-]*:\/\//, `${r.name}: an RFC 6570 template that starts with a scheme`);
    assert.equal(r.uriTemplate.split('{').length, r.uriTemplate.split('}').length, `${r.name}: braces pair up`);
  }
  for (const p of l.prompts) {
    assert.ok(p.name, JSON.stringify(p));
    for (const a of p.arguments ?? []) assert.ok(a.name, p.name);
  }
});

test('every tool schema is valid JSON Schema, an object at the top, and tool hints are true or false', async () => {
  const problems: string[] = [];
  for (const t of await tools()) {
    const tool = t as unknown as { name: string; inputSchema: any; outputSchema?: any; annotations?: Record<string, unknown> };
    // 2025-06-18 Server › Tools › Tool: inputSchema is a JSON Schema describing the arguments, an object (never null).
    if (tool.inputSchema?.type !== 'object') problems.push(`${tool.name}: inputSchema is not an object schema`);
    for (const p of schemaProblems(tool.inputSchema)) problems.push(`${tool.name} input ${p}`);
    if (tool.outputSchema) {
      if (tool.outputSchema.type !== 'object') problems.push(`${tool.name}: outputSchema is not an object schema`);
      for (const p of schemaProblems(tool.outputSchema)) problems.push(`${tool.name} output ${p}`);
    }
    for (const [hint, v] of Object.entries(tool.annotations ?? {})) {
      if (hint.endsWith('Hint') && typeof v !== 'boolean') problems.push(`${tool.name}: ${hint} is not true or false`);
    }
    for (const r of (tool.inputSchema?.required ?? []) as string[]) if (!(r in (tool.inputSchema.properties ?? {}))) problems.push(`${tool.name}: "${r}" is required but not described`);
  }
  assert.deepEqual(problems, []);
});

test('the schema checker itself catches what it should', () => {
  assert.deepEqual(schemaProblems({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }), []);
  for (const bad of [{ type: 'strng' }, { type: 'object', required: 'a' }, { enum: [] }, { minimum: 'x' }, { pattern: '(' }, { $ref: '#/nope' }, { frobnicate: 1 }, { minLength: 3, maxLength: 1 }, { type: 'object', properties: { a: { type: 'x' } } }]) {
    assert.notDeepEqual(schemaProblems(bad as never), [], JSON.stringify(bad));
  }
  const s = { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 5 }, s: { enum: ['a', 'b'] }, l: { type: 'array', items: { type: 'string' }, maxItems: 2 }, u: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['n'], additionalProperties: false };
  assert.deepEqual(instanceProblems(s, { n: 2, s: 'a', l: ['x'], u: null }), []);
  for (const bad of [{}, { n: 0 }, { n: 1.5 }, { n: 6 }, { n: 1, s: 'c' }, { n: 1, l: [1] }, { n: 1, l: ['a', 'b', 'c'] }, { n: 1, u: 3 }, { n: 1, extra: true }, []]) {
    assert.notDeepEqual(instanceProblems(s, bad), [], JSON.stringify(bad));
  }
});

test('the reference examples fit the schemas they document', async () => {
  const problems: string[] = [];
  let checked = 0;
  for (const t of await tools()) {
    const tool = t as unknown as { name: string; inputSchema: any; outputSchema?: any };
    const note = MCP_NOTES[tool.name];
    if (!note) continue;
    for (const p of instanceProblems(tool.inputSchema, note.example.arguments)) problems.push(`${tool.name} example arguments ${p}`);
    checked++;
    if (tool.outputSchema && !note.example.skipReason) {
      let response: unknown;
      try { response = JSON.parse(note.example.response); } catch { problems.push(`${tool.name}: the example response is not JSON, but the tool declares an outputSchema`); continue; }
      for (const p of instanceProblems(tool.outputSchema, response)) problems.push(`${tool.name} example response ${p}`);
    }
  }
  assert.ok(checked > 80, `${checked} examples checked`);
  assert.deepEqual(problems, []);
});

test('docs/mcp-conformance.md lists every case, and only cases there are', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'mcp-conformance.md'), 'utf8');
  const listed = [...doc.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]!);
  const ids = cases.map((c) => c.id);
  assert.deepEqual(ids.filter((id) => !listed.includes(id)), [], 'cases the guide does not list');
  const table = doc.split('\n').filter((l) => /^\| `/.test(l));
  const rows = table.map((l) => /^\| `([a-z0-9-]+)`/.exec(l)![1]!);
  assert.deepEqual(rows.filter((id) => !ids.includes(id)), [], 'rows of the guide that are not cases');
});
