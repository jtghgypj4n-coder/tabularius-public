// Writes THIRD-PARTY-NOTICES.md: the licence text of every package under <folder>/node_modules and of the
// Node.js runtime the single-file build copies. MIT, ISC and BSD licences ask for their notice to travel with
// copies, so build-release.ts puts the file inside the program and beside it in dist/.
//
//   node --no-warnings scripts/third-party-notices.ts <folder holding node_modules> <out.md>

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const LICENCE_FILE = /^(licen[cs]e|copying|notice|unlicense)(\.(md|txt|markdown))?$/i;

export interface Notice { name: string; version: string; licence: string; texts: { file: string; text: string }[] }

/** Every package folder under <root>/node_modules, nested ones included, with its licence files. */
export function collectNotices(root: string): Notice[] {
  const found = new Map<string, Notice>();
  const visit = (nodeModules: string) => {
    if (!existsSync(nodeModules)) return;
    for (const entry of readdirSync(nodeModules)) {
      if (entry.startsWith('.')) continue;
      const dir = join(nodeModules, entry);
      if (entry.startsWith('@')) {
        for (const scoped of readdirSync(dir)) visitPackage(join(dir, scoped));
      } else visitPackage(dir);
    }
  };
  const visitPackage = (dir: string) => {
    const manifest = join(dir, 'package.json');
    // Workspace links (node_modules/@tabularius/*) point back at packages/, whose licence is LICENSE.
    if (lstatSync(dir).isSymbolicLink() || !existsSync(manifest) || !statSync(dir).isDirectory()) return;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; version?: string; license?: string | { type?: string }; licenses?: { type: string }[]; author?: string | { name?: string } };
    // An unnamed package is named by its place under the root, never by the absolute (temporary) folder.
    const name = pkg.name ?? relative(root, dir).split(sep).join('/');
    const version = pkg.version ?? '?';
    const key = `${name}@${version}`;
    if (!found.has(key)) {
      const texts = readdirSync(dir).filter((f) => LICENCE_FILE.test(f) && statSync(join(dir, f)).isFile())
        .sort().map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8').trim() }));
      found.set(key, { name, version, licence: (typeof pkg.license === 'string' ? pkg.license : pkg.license?.type) ?? pkg.licenses?.map((l) => l.type).join(' OR ') ?? '(none declared)', texts });
    }
    visit(join(dir, 'node_modules'));
  };
  visit(join(root, 'node_modules'));
  // Plain code-unit order, not localeCompare: the file must not change with the builder's language settings.
  const before = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...found.values()].sort((a, b) => before(a.name, b.name) || before(a.version, b.version));
}

/** The Node.js licence, from the official tarball layout (<prefix>/bin/node, <prefix>/LICENSE), when present. */
export function nodeLicence(execPath = process.execPath): string | undefined {
  for (const candidate of [join(dirname(execPath), '..', 'LICENSE'), join(dirname(execPath), 'LICENSE')]) {
    if (existsSync(candidate)) {
      const text = readFileSync(candidate, 'utf8');
      if (/Node\.js is licensed for use as follows/i.test(text)) return text.trim();
    }
  }
  return undefined;
}

export function renderNotices(notices: Notice[], node: string | undefined, nodeVersion = process.version): string {
  const out = [
    '# Third-party notices',
    '',
    "Tabularius is released under the licence in LICENSE; code derived from other projects is credited in NOTICE. This file holds the licence texts of the packages and the runtime that ship inside the program.",
    '',
    `## Node.js ${nodeVersion}`,
    '',
    'The single-file program embeds the Node.js runtime (https://nodejs.org), which is released under the licence below.',
    '',
    node ? '```\n' + node + '\n```' : 'This build could not find the Node.js licence file next to the runtime. The licence is at https://github.com/nodejs/node/blob/main/LICENSE.',
    '',
  ];
  for (const n of notices) {
    out.push(`## ${n.name} ${n.version}`, '', `Licence: ${n.licence}`, '');
    if (!n.texts.length) out.push('The package ships no licence file; it declares the licence above in its package.json.', '');
    for (const t of n.texts) out.push('```', t.text, '```', '');
  }
  return out.join('\n');
}

export function writeNotices(root: string, outFile: string): number {
  const notices = collectNotices(root);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, renderNotices(notices, nodeLicence()));
  return notices.length;
}

if (import.meta.main) {
  const [folder, out] = process.argv.slice(2);
  if (!folder || !out) {
    console.error('usage: node scripts/third-party-notices.ts <folder holding node_modules> <out.md>');
    process.exit(2);
  }
  console.log(`wrote ${resolve(out)} (${writeNotices(resolve(folder), resolve(out))} packages)`);
}
