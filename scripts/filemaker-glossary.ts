// Maintained vocabulary for people moving from FileMaker to Tabularius. The generated page also includes the
// menu map from docs/for-filemaker-developers.md, so the existing search index can find menu paths and terms.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
export const TERMS = [
  ['Account', 'Account', '[Manage Security](for-filemaker-developers.md#where-is-each-thing)'],
  ['Calculation', 'Calculation', '[Calculations](design-mode.md)'],
  ['Client', 'Client', '[Web client](web-client.md)'],
  ['Container field', 'Container field', '[Containers](design-mode.md#containers)'],
  ['Custom function', 'Custom function', '[Custom functions](design-mode.md)'],
  ['Database', 'Hosted file (database in routes)', '[For FileMaker developers](for-filemaker-developers.md#words-that-mean-something-else-here)'],
  ['Data API', 'Data API', '[Data API compatibility](data-api-compatibility.md)'],
  ['Extended privilege', 'Extended privilege', '[Extended privileges](moving-a-solution.md#extended-privileges)'],
  ['File', 'Source file or hosted file, as specified', '[Moving a solution](moving-a-solution.md)'],
  ['Hosting', '`tabularius serve <folder>`', '[For FileMaker developers](for-filemaker-developers.md#words-that-mean-something-else-here)'],
  ['Layout', 'Layout', '[Design mode](design-mode.md)'],
  ['Layout Setup', 'Layout settings in the layout editor', '[Web client](web-client.md#preview-mode-and-printing)'],
  ['Manage Database', 'Design › Tables & fields and Design › Relationships', '[Design mode](design-mode.md)'],
  ['Privilege set', 'Privilege set', '[Security defaults](security-defaults.md)'],
  ['Script Debugger', 'Script Debugger', '[Design mode](design-mode.md)'],
  ['Script Workspace', 'Design › Scripts', '[Script steps support](script-steps-support.md)'],
  ['Server script', 'Server script', '[Moving a solution](moving-a-solution.md#scripts-run-on-the-server-network-access-is-a-switch-you-turn-on)'],
  ['Table occurrence', 'Table occurrence', '[Design mode](design-mode.md)'],
  ['Value list', 'Value list', '[Design mode](design-mode.md)'],
  ['WebDirect', 'Web client', '[Web client](web-client.md#links-from-other-pages-and-systems)'],
] as const;

export function missingTerms(markdown: string, terms: readonly (readonly [string, string, string])[] = TERMS): string[] {
  const known = new Set(terms.map(([filemaker]) => filemaker.toLocaleLowerCase()));
  return [...new Set([...markdown.matchAll(/\{@fm-term\s+([^}]+)\}/g)].map((m) => m[1].trim()).filter((term) => !known.has(term.toLocaleLowerCase())))].sort();
}

const source = readFileSync(join(root, 'docs/for-filemaker-developers.md'), 'utf8');
const guideFiles: string[] = [];
const walk = (dir: string): void => {
  for (const name of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${dir}/${name.name}`;
    if (name.isDirectory()) walk(path);
    else if (name.name.endsWith('.md')) guideFiles.push(readFileSync(join(root, path), 'utf8'));
  }
};
walk('docs');
const missing = guideFiles.flatMap((markdown) => missingTerms(markdown));
if (process.argv.includes('--check') && missing.length) {
  console.error(`FileMaker glossary terms missing from scripts/filemaker-glossary.ts: ${[...new Set(missing)].join(', ')}`);
  process.exitCode = 1;
}
const start = source.indexOf('\n## Where is each thing?\n');
const end = source.indexOf('\n## Words that mean something else here\n');
if (start < 0 || end < 0) throw new Error('for-filemaker-developers.md is missing the menu map sections');
const map = source.slice(start + 1, end).trim();
const glossary = `# FileMaker glossary and menu map\n\n` +
  `This page explains FileMaker terms as Tabularius uses them and maps FileMaker menu paths, tools and habits to their Tabularius locations. Search this page for a term or menu name. The FileMaker-side menu names and behavior comparisons below are inferred unless a row links to a Claris source; Tabularius interface names are checked by the linked repository test. Unsettled behavior is listed in [known differences](known-differences.md). <!-- known-difference: Scripts and script steps ;; The FileMaker-side menu names and behaviour comparisons in the glossary are inferred unless a row links to a Claris source ;; A menu path or behaviour named in the glossary may differ from the FileMaker version in use ;; A FileMaker run or a Claris page for each row -->\n\n` +
  `## Glossary\n\n| FileMaker term | Tabularius word | More information |\n| --- | --- | --- |\n` +
  TERMS.map(([fm, tab, link]) => `| ${fm} | ${tab} | ${link} |`).join('\n') + '\n\n' +
  map + '\n\n' +
  `## Behavior and compatibility\n\n` +
  `The menu map reports how the existing interface and commands are implemented. Where behavior has not been compared with a FileMaker run, consult [known differences](known-differences.md), which records the unsettled behavior and what would settle it.\n`;

const out = join(root, 'docs/filemaker-glossary.md');
const check = process.argv.includes('--check');
const existing = existsSync(out) ? readFileSync(out, 'utf8') : '';
if (existing === glossary) console.log('docs/filemaker-glossary.md: up to date');
else if (check) { console.error('docs/filemaker-glossary.md: out of date; run npm run docs:glossary'); process.exitCode = 1; }
else { writeFileSync(out, glossary); console.log('docs/filemaker-glossary.md: written'); }
