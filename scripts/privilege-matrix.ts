// Regenerate the reviewed policy tables, without running servers or touching fixtures.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SHAPES, expected, type Expected, type Operation } from '../packages/server/test/privilege-matrix.ts';

const path = fileURLToPath(new URL('../docs/audit-privilege-matrix.md', import.meta.url));
const table = (headers: string[], rows: (string | number)[][]) => [
  '| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |',
  ...rows.map((r) => '| ' + r.join(' | ') + ' |'),
].join('\n');
const raw = (e: Expected) => e.view && e.field !== 'none' && !e.limited;
const signIn = (e: Expected, surface: 'rest' | 'web' | 'odata' | 'mcp' | 'sql') =>
  e.account === 'locked' || e.account === 'inactive' ? 212
    : e.account === 'expired' && surface !== 'rest' && surface !== 'web' ? 212 : !e[surface] ? 9 : 0;
const pg = (e: Expected) => ['locked', 'inactive'].includes(e.account) ? '28P01' : e.account === 'expired' ? '28000' : !e.sql || !raw(e) ? '42501' : '00000';
const ops: Operation[] = ['read', 'find', 'create', 'emptyCreate', 'edit', 'delete', 'upload'];
const generated = [
  '### Sign-in and raw SQL',
  '',
  'REST/web columns are session creation codes. Expired passwords receive a repair-only token; every data operation is 212. A rejected login yields no session, so subsequent session-only route probes are 952. OData/MCP/SQL columns are credential/extended-privilege gates, before record rules. SQL JSON and CSV columns apply after that gate. PostgreSQL reports SQLSTATE.',
  '',
  table(['Shape', 'REST login', 'Web login', 'OData gate', 'MCP gate', 'SQL gate', 'SQL JSON', 'SQL CSV', 'pgwire login'], SHAPES.map(({ name, expected: e }) => [
    name, signIn(e, 'rest'), signIn(e, 'web'), signIn(e, 'odata'), signIn(e, 'mcp'), signIn(e, 'sql'), raw(e) ? 0 : 9,
    raw(e) && e.export ? 0 : 9, pg(e),
  ])),
  '',
  '### API-token record reads',
  '',
  'These rows use an ohbt_ token issued before account restrictions are applied. Every HTTP data entry point revalidates the account on each request. Expired or must-change passwords invalidate API tokens: REST/web report 952, OData/SQL/XML report 212, and MCP reports HTTP 401 invalid_token. Password lockout does not revoke bearer credentials. Web routes use the API token’s fmrest authority. Admin routes never accept file tokens; pgwire does not accept API tokens as passwords. The in-process script engine has no bearer-token entry point; scripts entered through HTTP inherit that entry point’s authorization.',
  '',
  table(['Shape', 'REST', 'Web', 'OData', 'SQL', 'XML', 'MCP', 'Admin', 'pgwire'], SHAPES.map(({ name, definition, expected: e }) => {
    const invalid = e.account === 'expired' || e.account === 'inactive';
    const rest = invalid ? 952 : !e.rest ? 9 : expected(e, 'read');
    return [name, rest, rest, invalid ? 212 : !e.odata ? 9 : !e.view ? 102 : 0,
      invalid ? 212 : !e.sql || !raw(e) ? 9 : 0,
      invalid ? 212 : !definition.extendedPrivileges.includes('fmxml') ? 9 : expected(e, 'read'),
      invalid ? 'HTTP 401 invalid_token' : !e.mcp ? 9 : expected(e, 'read'), 9, '28P01'];
  })),
  '',
  '### MCP search and XML script refusal',
  '',
  'MCP columns apply after authentication. Explicit Items searches require a layout permitting record reads (105 for no accessible layout, 200 for visible layouts denying records); broad searches omit those tables. Table and field restrictions filter search hits, with no-access tables returning no hits. A permitted alternative layout on the same table remains usable. XML columns include password authentication and fmxml gates: XML never executes scripts, returning 9 for a forbidden named script and 960 otherwise. The same rule covers -script.prefind and -script.presort.',
  '',
  table(['Shape', 'MCP search Items', 'MCP search all tables', 'MCP summarize', 'XML -findall', 'XML -script'], SHAPES.map(({ name, definition, expected: e }) => {
    const xmlGate = e.account !== 'active' ? 212 : !definition.extendedPrivileges.includes('fmxml') ? 9 : 0;
    return [name, !e.view ? 0 : e.layout === 'none' ? 105 : e.layout === 'noRecords' ? 200 : 0, 0,
      expected(e, 'read'), xmlGate || expected(e, 'read'), xmlGate || (!e.script ? 9 : 960)];
  })),
  '',
  '### Record operations through a layout',
  '',
  'These are post-authentication codes for Data API/MCP record operations. A field-bearing create or edit supplies Name; upload targets Blob. The empty create supplies no fields. The calculation rows use the caller-owned record here; the other record is denied with 200 for reads, edits, uploads and deletes. Entry-point adaptations are listed below.',
  '',
  table(['Shape', 'Get/list', 'Find Name', 'Create Name', 'Create empty', 'Edit Name', 'Delete', 'Upload Blob'], SHAPES.map(({ name, expected: e }) => [name, ...ops.map((op) => expected(e, op))])),
  '',
  '### Layout, script and output permissions',
  '',
  'Metadata means the layout can be described; hidden fields are omitted. Execute tests use a caller-run Read script, so its record context must also be readable. Export tests use the web exporter or an anonymous Export Records step. Printing uses a named Print script. Account expiry/inactivity still takes precedence. The script engine receives an authenticated identity: extended privileges and password lockout are sign-in gates, not revocation of an already-running caller.',
  '',
  table(['Shape', 'Layout metadata', 'Read script', 'MCP script source', 'Web export', 'Print script', 'Admin file credential'], SHAPES.map(({ name, expected: e }) => [
    name, expected(e, 'metadata'), expected(e, 'script') || expected(e, 'read'), !e.script ? 104 : e.scriptSource ? 0 : 9, expected(e, 'export'),
    expected(e, 'script') || expected(e, 'read') || expected(e, 'print'), 9,
  ])),
].join('\n');
const start = '<!-- generated privilege tables -->';
const end = '<!-- end generated privilege tables -->';
const original = readFileSync(path, 'utf8');
const next = original.slice(0, original.indexOf(start) + start.length) + '\n\n' + generated + '\n\n' + original.slice(original.indexOf(end));
if (!original.includes(start) || !original.includes(end)) throw new Error('Privilege matrix documentation markers are missing');
if (process.argv.includes('--check')) {
  if (original !== next) throw new Error('Privilege tables are stale: run node scripts/privilege-matrix.ts');
} else writeFileSync(path, next);
