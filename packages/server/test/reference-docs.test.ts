import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeRoutes } from '../../../scripts/reference/code-routes.ts';
import { MCP_NOTES, REFERENCE_DIR, REST_GROUPS, mcpListing, renderMcp, renderRest, routeHeading } from '../../../scripts/reference/render.ts';

// docs/reference/rest.md and mcp.md document every route and MCP tool in the
// code (scripts/docs-reference.ts builds them; npm run docs:reference).

const read = (name: string) => readFileSync(join(REFERENCE_DIR, name), 'utf8');
const REGENERATE = 'run npm run docs:reference';

test('reference: every MCP tool has notes and a section in mcp.md', async () => {
  const listing = await mcpListing();
  const names = listing.tools.map((t) => t.name);
  const doc = read('mcp.md');
  const undocumented = names.filter((n) => !MCP_NOTES[n]);
  assert.deepEqual(undocumented, [], `MCP tools with no permissions or example in scripts/reference/mcp-tools.ts or mcp-design-tools.ts: ${undocumented.join(', ')}`);
  const gone = Object.keys(MCP_NOTES).filter((n) => !names.includes(n));
  assert.deepEqual(gone, [], `notes for MCP tools the server no longer has: ${gone.join(', ')}`);
  const missing = names.filter((n) => !doc.includes(`### \`${n}\`\n`));
  assert.deepEqual(missing, [], `MCP tools missing from docs/reference/mcp.md (${REGENERATE}): ${missing.join(', ')}`);
  for (const [name, n] of Object.entries(MCP_NOTES)) {
    assert.ok(n.permissions.trim(), `${name}: permissions`);
    // An example only passes arguments the tool takes.
    const schema = listing.tools.find((t) => t.name === name)!.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    const unknown = Object.keys(n.example.arguments).filter((a) => !(a in (schema.properties ?? {})));
    assert.deepEqual(unknown, [], `${name}: example passes arguments the tool doesn't take`);
    const absent = (schema.required ?? []).filter((a) => !(a in n.example.arguments));
    assert.deepEqual(absent, [], `${name}: example leaves out required arguments`);
  }
});

test('reference: every route the server matches is documented, and nothing that isn\'t in the code', () => {
  const code = codeRoutes();
  const missing: string[] = [];
  const stale: string[] = [];
  for (const [file, expressions] of code) {
    const anchored = new Set(REST_GROUPS.filter((g) => g.sources.includes(file)).flatMap((g) => g.anchors));
    for (const e of expressions) if (!anchored.has(e)) missing.push(`${file}: ${e}`);
  }
  for (const g of REST_GROUPS) {
    const inCode = new Set(g.sources.flatMap((s) => code.get(s) ?? []));
    for (const a of g.anchors) if (!inCode.has(a)) stale.push(`${g.id}: ${a}`);
  }
  assert.deepEqual(missing, [], `routes in the code that no group in scripts/reference/rest/ documents (add the route, and the expression to that group's anchors):\n${missing.join('\n')}`);
  assert.deepEqual(stale, [], `anchors no longer in the code (the route changed: update its docs):\n${stale.join('\n')}`);
});

test('reference: every documented route is well formed and in rest.md', () => {
  const doc = read('rest.md');
  const seen = new Set<string>();
  for (const g of REST_GROUPS) {
    for (const r of g.routes) {
      const heading = routeHeading(r);
      assert.match(r.method, /^(GET|HEAD|POST|PUT|PATCH|DELETE)(, (GET|HEAD|POST|PUT|PATCH|DELETE))*$/, heading);
      assert.ok(r.path.startsWith('/'), heading);
      assert.ok(r.summary.trim() && r.permissions.trim(), `${heading}: summary and permissions`);
      assert.ok(!seen.has(heading), `${heading}: documented twice`);
      seen.add(heading);
      // The example calls this route.
      const [line] = r.example.request.split('\n');
      const [method, target] = line.split(' ');
      assert.ok(r.method.split(', ').includes(method), `${heading}: example uses ${method}`);
      // {name} is one path segment; {name...} is the rest of the path.
      const pattern = new RegExp('^' + r.path.split(/(\{[^}]+\})/).map((part) => (part.endsWith('...}') ? '.+' : part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))).join('') + '$');
      assert.match(target.split('?')[0], pattern, `${heading}: example path`);
      assert.ok(r.example.status >= 100 && r.example.status < 600, `${heading}: example status`);
      for (const p of r.params ?? []) {
        if (p.in === 'path') assert.ok(r.path.includes(`{${p.name}}`) || r.path.includes(`{${p.name}...}`), `${heading}: path parameter ${p.name} is not in the path`);
      }
      assert.ok(doc.includes(`### \`${heading}\`\n`), `${heading}: missing from docs/reference/rest.md (${REGENERATE})`);
    }
  }
});

test('reference: rest.md and mcp.md are up to date', async () => {
  assert.equal(read('rest.md'), renderRest(), `docs/reference/rest.md is out of date: ${REGENERATE}`);
  assert.equal(read('mcp.md'), renderMcp(await mcpListing()), `docs/reference/mcp.md is out of date: ${REGENERATE}`);
});
