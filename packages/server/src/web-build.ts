// Cacheable delivery for the web client's files. The client is served as separate modules, straight from
// packages/web (there is no build step), and each used to be revalidated with a request of its own on every visit.
// Here every file of the client gets the same "build id", a hash of the content of all of them, and the server writes
// that id into the references between them: `import './layout.ts'` is sent as `import './layout.ts?v=<id>'`, and
// so are the scripts and styles a page names. A file asked for with the current id is sent with
// `cache-control: immutable`, so a second visit makes no request for it; when any file changes, the id changes, the
// pages (always revalidated) name new URLs, and the browser fetches them once. A page also gets a
// `<link rel="modulepreload">` for each module of its entry's static imports, so the browser asks for all of them
// at once instead of finding each one only after the module that imports it has arrived.

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, posix, relative, sep } from 'node:path';
import { Asset } from './static-cache.ts';

/** Folders of packages/web that are tests or tooling, not part of the client. */
const SKIP = new Set(['e2e', 'test', 'node_modules']);
/** The files the build id covers. */
const SERVED = new Set(['.html', '.css', '.js', '.ts', '.svg', '.png', '.webmanifest']);
/** How long a build id stays trusted before the folder is looked at again. */
const RECHECK_MS = 1000;

/** The id of the files under `root`: a hash of their content, looked at again at most once a second. */
export class WebBuild {
  private readonly files = new Map<string, { stamp: string; hash: string }>();
  private current: { id: string; at: number } | undefined;
  private pending: Promise<string> | undefined;

  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  id(): Promise<string> {
    if (this.current && Date.now() - this.current.at < RECHECK_MS) return Promise.resolve(this.current.id);
    this.pending ??= this.compute().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async compute(): Promise<string> {
    const found = new Map<string, string>();
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP.has(entry.name)) await walk(path);
        } else if (entry.isFile() && SERVED.has(extname(entry.name))) {
          const st = await stat(path);
          const stamp = `${st.mtimeMs}:${st.size}:${st.ino}`;
          let held = this.files.get(path);
          // Hashed again only when the file's stamp changed.
          if (held?.stamp !== stamp) {
            held = { stamp, hash: createHash('sha1').update(await readFile(path)).digest('hex') };
            this.files.set(path, held);
          }
          found.set(relative(this.root, path).split(sep).join('/'), held.hash);
        }
      }
    };
    await walk(this.root);
    for (const path of this.files.keys()) if (!found.has(relative(this.root, path).split(sep).join('/'))) this.files.delete(path);
    const hash = createHash('sha1');
    for (const path of [...found.keys()].sort()) hash.update(`${path}\0${found.get(path)}\n`);
    const id = hash.digest('hex').slice(0, 16);
    this.current = { id, at: Date.now() };
    return id;
  }
}

// A static import, a re-export, a side-effect import or a dynamic import of a relative script. Types are already
// gone (the source is type-stripped first), so what is left are the ones the browser follows.
const REFERENCE = /(\b(?:from|import)\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"?#\s]+\.(?:ts|js))\2/g;
const STATIC_REFERENCE = /(?:^|[\n;}])\s*(?:import|export)\b[^;'"()]*?\bfrom\s*(['"])(\.{1,2}\/[^'"?#\s]+\.ts)\1|(?:^|[\n;}])\s*import\s*(['"])(\.{1,2}\/[^'"?#\s]+\.ts)\3/g;

/** The script with the build id on each relative script it imports. */
export function versionScript(source: string, id: string): string {
  return source.replace(REFERENCE, (_all, lead: string, quote: string, path: string) => `${lead}${quote}${path}?v=${id}${quote}`);
}

/** The scripts a script imports statically (not through import()), as paths relative to it. */
export function staticImports(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(STATIC_REFERENCE)) found.push((m[2] ?? m[4])!);
  return found;
}

const TAG = /(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"?#:]+\.(?:ts|js|css|svg))(")/g;
const MODULE_TAG = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"?#:]+\.ts)"[^>]*>/g;

/**
 * A page with the build id on the scripts and styles it names, and a modulepreload link for each module its module
 * entries import statically. `imports` gives a module's static imports (file paths, absolute); `file` is the page.
 */
export async function versionPage(html: string, id: string, file: string, root: string, imports: (module: string) => Promise<string[]>): Promise<string> {
  const absolute = (src: string) => (src.startsWith('/app/') ? join(root, src.slice('/app/'.length)) : join(dirname(file), src));
  const href = (module: string, like: string) => {
    const path = relative(root, module).split(sep).join('/');
    return like.startsWith('/') ? `/app/${path}?v=${id}` : `${posix.relative(posix.dirname(relative(root, file).split(sep).join('/')), path)}?v=${id}`;
  };
  const links: string[] = [];
  const seen = new Set<string>();
  let entryTag: string | undefined;
  for (const m of html.matchAll(MODULE_TAG)) {
    entryTag ??= m[0];
    const queue = [absolute(m[1]!)];
    while (queue.length) {
      const module = queue.shift()!;
      if (seen.has(module)) continue;
      seen.add(module);
      links.push(`<link rel="modulepreload" href="${href(module, m[1]!)}">`);
      queue.push(...await imports(module));
    }
  }
  let out = html.replace(TAG, (_all, lead: string, src: string, tail: string) => `${lead}${src}?v=${id}${tail}`);
  if (entryTag) {
    const tag = entryTag.replace(TAG, (_all, lead: string, src: string, tail: string) => `${lead}${src}?v=${id}${tail}`);
    out = out.replace(tag, `${links.join('\n  ')}\n  ${tag}`);
  }
  return out;
}

/** A derived file made from `base` for one build id, made again only when either changes. */
export class Derived {
  private readonly held = new Map<string, { id: string; base: Asset; asset: Asset }>();

  async get(file: string, id: string, base: Asset, make: () => Promise<string> | string): Promise<Asset> {
    const held = this.held.get(file);
    if (held && held.id === id && held.base === base) return held.asset;
    const asset = new Asset(Buffer.from(await make()));
    this.held.set(file, { id, base, asset });
    return asset;
  }
}
