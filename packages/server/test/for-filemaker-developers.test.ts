// docs/for-filemaker-developers.md says where each FileMaker menu path, tool and habit lives here. Every screen, command,
// route, tool and extended privilege the page names has to exist, so a rename in the program fails here until the page
// follows. (That its links and #anchors resolve is docs-links.test.ts's job.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const page = read('docs/for-filemaker-developers.md');

/** The rows of the table under a "## heading", as cells. */
function table(heading: string): string[][] {
  const start = page.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `the page has no "${heading}" section`);
  const rest = page.slice(start + 1);
  const end = rest.indexOf('\n## ', 3);
  return (end < 0 ? rest : rest.slice(0, end)).split('\n')
    .filter((l) => l.startsWith('| ') && !/^\| ---/.test(l))
    .slice(1) // the header
    .map((l) => l.slice(2, -2).split(' | '));
}

const rows = table('Where is each thing?');
const words = table('Words that mean something else here');

const menubar = read('packages/web/src/menubar.ts');
const designTabs = [...read('packages/web/src/design/main.ts').matchAll(/^\s*\['\w+', '([^']+)', \w+\],?$/gm)].map((m) => m[1]);
const adminSections = [...read('packages/server/admin/index.html').matchAll(/<h2[^>]*>([^<]*)</g)].map((m) => m[1].trim());
const main = read('packages/cli/src/main.ts');
const usage = main.slice(main.indexOf('const USAGE'), main.indexOf('\n`;', main.indexOf('const USAGE')));
const commands = new Set([...usage.matchAll(/^ {2}tabularius ([a-z][a-z-]+)/gm)].map((m) => m[1]));
const rest = read('docs/reference/rest.md');
const routes = [...rest.matchAll(/^### `([A-Z, ]+) (\/[^`]+)`$/gm)].map((m) => ({ methods: m[1].split(', '), path: m[2] }));
const mcp = new Set([...read('docs/reference/mcp.md').matchAll(/^### `([a-z_]+)`$/gm)].map((m) => m[1]));
const privileges = read('docs/moving-a-solution.md');

test('the page has the three statuses and every row has four cells', () => {
  assert.ok(rows.length >= 25, `only ${rows.length} rows`);
  for (const r of rows) assert.equal(r.length, 4, `row "${r[0]}" has ${r.length} cells`);
  const statuses = new Set(rows.map((r) => r[2]));
  assert.deepEqual([...statuses].filter((s) => !['Same', 'Different', 'Missing'].includes(s)), [], 'a status that is not Same, Different or Missing');
  for (const s of ['Same', 'Different', 'Missing']) assert.ok(statuses.has(s), `no row is ${s}`);
});

test('every thing the backlog asked about has a row', () => {
  const first = rows.map((r) => r[0].toLowerCase()).join('\n');
  for (const want of [
    'manage database', 'manage layouts', 'script workspace', 'manage security', 'data sources', 'manage value lists',
    'manage containers', 'layout setup', 'script debugger', 'data viewer', 'perform script on server',
    'schedules in the admin console', 'fmsadmin', 'data api', 'executesql', 'webdirect', 'claris connect', 'plug-ins',
    'container storage', 'save a copy as', 'recover',
  ]) assert.ok(first.includes(want), `no row for ${want}`);
});

test('a row that is different or missing links to where it is explained', () => {
  for (const r of rows.filter((x) => x[2] !== 'Same')) assert.match(r[3], /\]\([^)]+\)/, `"${r[0]}" is ${r[2]} but its details link nowhere`);
  assert.match(page, /\]\(known-differences\.md\)/, 'the page does not link the known-differences register');
});

test('every screen, command, route, tool and privilege in the Here column exists', () => {
  const missing: string[] = [];
  for (const r of rows) {
    const here = r[1];
    for (const [, path] of here.matchAll(/\*\*([^*]+)\*\*/g)) {
      const [area, ...segments] = path.split(' › ');
      for (const seg of segments) {
        if (area === 'Web client') { if (!menubar.includes(`'${seg}'`)) missing.push(`${r[0]}: the web client has no "${seg}" in its menus`); }
        else if (area === 'Design') { if (!designTabs.includes(seg)) missing.push(`${r[0]}: design mode has no "${seg}" tab`); }
        else if (area === 'Console') { if (!adminSections.some((h) => h.startsWith(seg))) missing.push(`${r[0]}: the admin console has no "${seg}" section`); }
        else missing.push(`${r[0]}: "${path}" starts with an area that is not Web client, Design or Console`);
      }
      if (segments.length === 0 && !/^Web client$/.test(path)) missing.push(`${r[0]}: "${path}" names no screen`);
    }
    for (const [, code] of here.matchAll(/`([^`]+)`/g)) {
      const command = /^tabularius ([a-z][a-z-]*)/.exec(code);
      const route = /^([A-Z]+) (\/\S*)$/.exec(code);
      if (command) {
        if (!commands.has(command[1])) missing.push(`${r[0]}: tabularius has no "${command[1]}" command`);
        for (const flag of code.match(/--[a-z][a-z0-9-]+/g) ?? []) if (!main.includes(`'${flag}'`) && !usage.includes(flag)) missing.push(`${r[0]}: no ${flag} option`);
      } else if (route) {
        if (!routes.some((x) => x.path === route[2] && x.methods.includes(route[1]))) missing.push(`${r[0]}: rest.md has no ${code}`);
      } else if (/^fm[a-z]+$/.test(code) && code !== 'fmcsadmin') {
        if (!privileges.includes(`\`${code}\``)) missing.push(`${r[0]}: ${code} is not an extended privilege`);
      }
    }
    for (const [, tool] of here.matchAll(/MCP tool `([a-z_]+)`/g)) if (!mcp.has(tool)) missing.push(`${r[0]}: mcp.md has no tool ${tool}`);
  }
  assert.deepEqual(missing, [], 'named on the page but not in the program or its reference');
});

test('the rows that say something is missing are true to the step list', () => {
  const steps = read('docs/script-steps-support.md');
  assert.match(steps, /Trigger Claris Connect Flow \| No dispatch handler/, 'Trigger Claris Connect Flow now has a handler; update the Claris Connect row');
  assert.match(steps, /Recover File[^|]*\| No dispatch handlers|\| 95 \| Recover File \| fallback \| unsupported/, 'Recover File now has a handler; update the Recover row');
  assert.ok(!commands.has('recover'), 'there is now a recover command; update the Recover row');
});

test('the glossary covers the words that differ', () => {
  const terms = words.map((w) => w[0].replace(/\*/g, '').toLowerCase());
  for (const t of ['database', 'hosting', 'privilege set', 'extended privilege']) assert.ok(terms.includes(t), `no glossary entry for ${t}`);
  for (const w of words) assert.equal(w.length, 3, `glossary row "${w[0]}" has ${w.length} cells`);
});
