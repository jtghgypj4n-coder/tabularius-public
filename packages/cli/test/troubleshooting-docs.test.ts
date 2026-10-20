// docs/troubleshooting.md is organized by the message people see; each heading must still be a message the
// program shows, so a reworded message fails here instead of leaving the page unsearchable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const page = readFileSync(join(root, 'docs', 'troubleshooting.md'), 'utf8');

function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const full = join(dir, n);
    if (statSync(full).isDirectory()) { if (n !== 'node_modules') sources(full, out); } else if (/\.ts$/.test(n)) out.push(full);
  }
  return out;
}

test('every heading in the troubleshooting page is a message the code still shows', () => {
  const code = ['cli', 'fmp12', 'server', 'scripts', 'store', 'web'].flatMap((p) => sources(join(root, 'packages', p, 'src'))).concat(join(root, 'packages', 'server', 'admin', 'index.html')).map((f) => readFileSync(f, 'utf8')).join('\n');
  const headings = [...page.matchAll(/^## `(.+)`$/gm)].map((m) => m[1]);
  assert.ok(headings.length >= 6, 'the page has its headings');
  for (const h of headings) {
    // {} is a name or number that changes; what is left on either side must appear as written.
    for (const part of h.split('{}').map((x) => x.trim()).filter((x) => x.length >= 8)) {
      assert.ok(code.includes(part), `"${part}" (from the heading "${h}") isn't in the code any more: reword the page or the message`);
    }
  }
});

test('the commands the page names exist', () => {
  const main = readFileSync(join(root, 'packages', 'cli', 'src', 'main.ts'), 'utf8');
  for (const cmd of ['doctor', 'passwd', 'admin-password', 'migrate-fms', 'serve']) assert.ok(main.includes(`tabularius ${cmd}`), cmd);
});
