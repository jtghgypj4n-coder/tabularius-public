// A software bill of materials for a release: CycloneDX 1.5 JSON naming the program, the Node.js runtime the
// single-file build embeds, every npm package that ships inside it (read from the same node_modules the licence
// notices are, so the two lists cannot differ), and the projects some source files were written from.
//
//   node --no-warnings scripts/sbom.ts <folder holding node_modules> <out.json> [--version V]
//
// The file holds no date and no random serial number, so building the same commit twice gives the same bytes
// (scripts/verify-repro.ts checks that).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BUNDLED_SOURCES } from './bundled-sources.ts';
import { collectNotices } from './third-party-notices.ts';

interface License { license?: { id?: string; name?: string }; expression?: string }
export interface SbomComponent {
  type: 'library' | 'application' | 'data';
  'bom-ref': string;
  name: string;
  version?: string;
  purl?: string;
  licenses?: License[];
  hashes?: { alg: 'SHA-512'; content: string }[];
  externalReferences?: { type: 'website'; url: string }[];
  description?: string;
}

/** SPDX identifiers common in npm packages; anything else is given as a free name, which the schema accepts. */
const SPDX = new Set(['MIT', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'CC-BY-4.0', 'Zlib', 'Python-2.0', 'BlueOak-1.0.0', 'Apache-2.0', 'Apache-1.1',
  'BSD-2-Clause', 'BSD-3-Clause', 'BSD-3-Clause-Clear', 'BSD-4-Clause', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'MPL-2.0', 'EPL-2.0', 'CDDL-1.0']);

/** Removes one pair of brackets only when they enclose the whole expression: "(A OR B)" but not "(A OR B) AND (C OR D)". */
function unwrap(t: string): string {
  if (!t.startsWith('(') || !t.endsWith(')')) return t;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '(') depth++;
    else if (t[i] === ')' && --depth === 0 && i < t.length - 1) return t;
  }
  return t.slice(1, -1).trim();
}

/** How CycloneDX wants a licence: an SPDX identifier, an SPDX expression, or a free name. */
export function licenseOf(text: string): License[] {
  const t = String(text ?? '').trim();
  if (!t || t === '(none declared)') return [];
  if (/\s(?:OR|AND|WITH)\s/.test(t)) return [{ expression: unwrap(t) }];
  if (SPDX.has(t)) return [{ license: { id: t } }];
  return [{ license: { name: t } }];
}

/** The package URL of an npm package: scoped names keep the @ as %40, and a version is escaped (a + becomes %2B). */
export const npmPurl = (name: string, version?: string) =>
  `pkg:npm/${name.replace(/^@/, '%40').split('/').map((p) => (p.startsWith('%40') ? p : encodeURIComponent(p))).join('/')}${version && version !== '?' ? `@${encodeURIComponent(version)}` : ''}`;

/** name@version → the SHA-512 integrity of the tarball, from package-lock.json. */
function lockIntegrity(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const file = join(root, 'package-lock.json');
  if (!existsSync(file)) return out;
  const lock = JSON.parse(readFileSync(file, 'utf8')) as { packages?: Record<string, { version?: string; integrity?: string }> };
  for (const [path, p] of Object.entries(lock.packages ?? {})) {
    const name = path.split('node_modules/').pop();
    if (path.startsWith('node_modules/') && name && p.version && p.integrity?.startsWith('sha512-')) out.set(`${name}@${p.version}`, p.integrity);
  }
  return out;
}

const hex = (integrity: string) => Buffer.from(integrity.slice('sha512-'.length), 'base64').toString('hex');
const byRef = (a: SbomComponent, b: SbomComponent) => (a['bom-ref'] < b['bom-ref'] ? -1 : a['bom-ref'] > b['bom-ref'] ? 1 : 0);

export function buildSbom(root: string, options: { version: string; nodeVersion?: string }): object {
  const integrity = lockIntegrity(root);
  const components: SbomComponent[] = collectNotices(root).map((n) => {
    const hash = integrity.get(`${n.name}@${n.version}`);
    return {
      type: 'library', 'bom-ref': npmPurl(n.name, n.version), name: n.name, version: n.version, purl: npmPurl(n.name, n.version),
      ...(licenseOf(n.licence).length ? { licenses: licenseOf(n.licence) } : {}),
      ...(hash ? { hashes: [{ alg: 'SHA-512' as const, content: hex(hash) }] } : {}),
    };
  });
  const node = options.nodeVersion ?? process.version;
  components.push({
    type: 'library', 'bom-ref': `pkg:generic/nodejs@${node}`, name: 'Node.js', version: node, purl: `pkg:generic/nodejs@${node}`,
    licenses: [{ license: { id: 'MIT' } }], externalReferences: [{ type: 'website', url: 'https://nodejs.org' }],
    description: 'The runtime the single-file program embeds',
  });
  for (const s of BUNDLED_SOURCES) {
    components.push({
      type: s.kind === 'code' ? 'library' : 'data', 'bom-ref': `pkg:github/${s.repo.toLowerCase()}`, name: s.name, purl: `pkg:github/${s.repo.toLowerCase()}`,
      licenses: licenseOf(s.licence), externalReferences: [{ type: 'website', url: s.url }],
      description: `${s.kind === 'code' ? 'Code ported or derived from this project' : 'Specification this code follows'}: ${s.files.join(', ')}`,
    });
  }
  components.sort(byRef);
  const app = { type: 'application', 'bom-ref': `pkg:generic/tabularius@${options.version}`, name: 'tabularius', version: options.version, licenses: [{ license: { id: 'MIT' } }] };
  return {
    bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    metadata: { component: app, tools: { components: [{ type: 'application', name: 'Tabularius scripts/sbom.ts' }] } },
    components,
    dependencies: [{ ref: app['bom-ref'], dependsOn: components.map((c) => c['bom-ref']) }],
  };
}

export function writeSbom(root: string, outFile: string, version: string): number {
  const bom = buildSbom(root, { version }) as { components: unknown[] };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(bom, null, 2) + '\n');
  return bom.components.length;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--version');
  const version = at >= 0 ? args.splice(at, 2)[1] : 'unknown';
  const [folder, out] = args;
  if (!folder || !out) {
    console.error('usage: node scripts/sbom.ts <folder holding node_modules> <out.json> [--version V]');
    process.exit(2);
  }
  console.log(`wrote ${resolve(out)} (${writeSbom(resolve(folder), resolve(out), version)} components)`);
}
