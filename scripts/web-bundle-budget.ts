import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const budgetPath = join(root, 'scripts/web-bundle-budget.json');
type Asset = { path: string; raw: number; gzip: number };
type Budget = { generatedFrom: string; assets: Record<string, { raw: number; gzip: number }>; largest: string[] };

function asset(path: string): Asset {
  const bytes = readFileSync(path);
  return { path: path.slice(root.length + 1), raw: bytes.byteLength, gzip: gzipSync(bytes, { level: 9 }).byteLength };
}

function imports(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const found: string[] = [];
  // Only static imports are in the initial module graph. Dynamic imports are intentional deferred chunks.
  for (const match of text.matchAll(/(?:^|\n)\s*import\s+(?!type\b)(?!\s*\()(?:(?:[^'";]*?\s+from\s+)?)(['"])(\.{1,2}\/[^'"]+)\1/g)) {
    const candidate = resolve(dirname(path), match[2]!);
    if (extname(candidate) === '.ts') found.push(candidate);
  }
  return found;
}

function graph(entry: string): Asset[] {
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const dependency of imports(path)) visit(dependency);
  };
  visit(entry);
  return [...seen].map(asset).sort((a, b) => b.raw - a.raw);
}

export function measure(): { assets: Asset[]; totals: { raw: number; gzip: number }; largest: string[] } {
  const modules = graph(join(root, 'packages/web/src/main.ts'));
  const styles = ['tokens.css', 'app.css'].map((name) => asset(join(root, 'packages/web', name)));
  const assets = [...modules, ...styles];
  return {
    assets,
    totals: assets.reduce((sum, a) => ({ raw: sum.raw + a.raw, gzip: sum.gzip + a.gzip }), { raw: 0, gzip: 0 }),
    largest: modules.slice(0, 8).map((a) => a.path),
  };
}

function checkOrWrite(): void {
  const measured = measure();
  const budget = JSON.parse(readFileSync(budgetPath, 'utf8')) as Budget;
  const failures: string[] = [];
  for (const item of measured.assets) {
    const cap = budget.assets[item.path];
    if (!cap) failures.push(`${item.path}: missing from scripts/web-bundle-budget.json`);
    else {
      if (item.raw > cap.raw) failures.push(`${item.path}: raw ${item.raw} B exceeds ${cap.raw} B`);
      if (item.gzip > cap.gzip) failures.push(`${item.path}: gzip ${item.gzip} B exceeds ${cap.gzip} B`);
    }
  }
  for (const path of Object.keys(budget.assets)) if (!measured.assets.some((a) => a.path === path)) failures.push(`${path}: stale budget entry`);
  console.log(`Browse entry assets: ${measured.totals.raw} raw bytes, ${measured.totals.gzip} gzip bytes`);
  console.log('Largest modules:');
  for (const item of measured.assets.slice(0, 8)) console.log(`  ${item.path}: ${item.raw} raw, ${item.gzip} gzip bytes`);
  if (failures.length) throw new Error(`Web bundle budget exceeded:\n${failures.map((f) => `- ${f}`).join('\n')}`);
}

if (process.argv.includes('--write')) {
  const measured = measure();
  const assets = Object.fromEntries(measured.assets.map((a) => [a.path, { raw: Math.ceil(a.raw * 1.2), gzip: Math.ceil(a.gzip * 1.2) }]));
  writeFileSync(budgetPath, `${JSON.stringify({ generatedFrom: 'measured source bytes + 20%', assets, largest: measured.largest }, null, 2)}\n`);
  console.log(`Wrote ${budgetPath}`);
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkOrWrite();
