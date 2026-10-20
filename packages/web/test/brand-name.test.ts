import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The product shows as "Tabularius": no page of the web client or the admin console names it "openhbam" where people
// read it. The old name stays only where changing it would lose something people already have: the browser storage
// keys (openhbam.db, openhbam-offline), the offline copy's key check (changing it would lock out copies people already
// keep), the exported theme format, and the openhbam page API alias that saved pages still call.

const root = join(import.meta.dirname, '..', '..', '..');
const CLI = ['admin-password', 'ai', 'audit', 'backup', 'ddr', 'decrypt', 'design', 'dump', 'encrypt', 'export', 'fidelity', 'info', 'layout-census', 'mcp',
  'migrate-fms', 'new', 'optimize', 'passwd', 'privileges', 'reconvert', 'records', 'report', 'restore', 'schema', 'script-tests', 'serve', 'service', 'stale-calcs',
  'standby', 'style-census', 'test-scripts', 'token', 'totp', 'upgrade', 'verify-backup'];
const visible = new RegExp(`(?<![\\w/.\\-@{$])openhbam(?![\\w/\\-:@]|\\.[\\w$]| (?:${CLI.join('|')})\\b)`);
// Lines that must keep the old name, by what they contain.
const ALLOWED = [`const CHECK = 'openhbam offline copy';`];

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(n) ? [p] : [];
  });
}

test('pages people read say Tabularius, not openhbam', () => {
  const web = join(root, 'packages', 'web');
  const list = [
    ...readdirSync(web).filter((n) => /\.(html|webmanifest)$/.test(n)).map((n) => join(web, n)),
    ...files(join(web, 'src'), /\.ts$/),
    join(root, 'packages', 'server', 'admin', 'index.html'),
    join(root, 'packages', 'server', 'src', 'pages.ts'),
  ];
  const hits: string[] = [];
  for (const f of list) {
    let block = false;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      const comment = block || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--');
      if (t.startsWith('/*') && !t.includes('*/')) block = true;
      else if (block && t.includes('*/')) block = false;
      if (comment || ALLOWED.some((a) => line.includes(a))) return;
      const code = line.replace(/\s\/\/\s.*$/, '');
      if (visible.test(code)) hits.push(`${f.slice(root.length + 1)}:${i + 1}: ${t.slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, []);
});
