// Installed plug-ins and which are enabled for each hosted file. A file sees only the functions of the plug-ins
// enabled for it; nothing a .fmp12 contains can enable one. Calculations reach them through CalcContext.plugin.

import { text, type Env, type InstalledPlugin, type PluginFunction, type Value } from '../../calc/src/index.ts';
import { FUNCTIONS } from '../../calc/src/functions.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { PluginManifest } from './manifest.ts';

/** A plug-in function's code: evaluated arguments in, a value out. */
export type PluginCall = ((args: Value[], env: Env) => Value) & { cacheKey?: string };

interface Installed {
  manifest: PluginManifest;
  /** By lowercase function name. */
  calls: Map<string, PluginCall>;
  cacheKey: string;
}

const NOT_ENABLED: PluginFunction = { min: 0, call: () => text('?') };

/**
 * A pack of functions that ships inside Tabularius (it runs in the server itself, so it needs no sandbox). It is on for
 * every file unless the admin turns it off for one, and then its functions give "?" there, as a plug-in that isn't
 * installed does. It is listed with the others (Get ( InstalledFMPlugins ), the console and the command line).
 */
export interface BuiltinPack {
  id: string;
  name: string;
  /** FileMaker's 4-character plug-in id. */
  owner: string;
  publisher: string;
  description: string;
  /** Whether a function (lowercase) is one of the pack's. */
  owns(fn: string): boolean;
}

export const BUILTIN_PACKS: readonly BuiltinPack[] = [
  {
    id: 'com.openhbam.baseelements', name: 'BaseElements', owner: 'GyBE', publisher: 'Goya',
    description: 'JSON, XML, XSLT, zip, file, text and container functions of the BaseElements plug-in, reimplemented in Tabularius',
    owns: (fn) => fn.startsWith('be_'),
  },
  {
    id: 'com.openhbam.troi-text', name: 'Troi Text', owner: '', publisher: 'Troi Automatisering',
    description: 'Documented pure text functions reimplemented in Tabularius',
    owns: (fn) => fn.startsWith('trtext_'),
  },
  {
    id: 'com.openhbam.troi-dialog', name: 'Troi Dialog', owner: '', publisher: 'Troi Automatisering',
    description: 'Documented pure geometry functions reimplemented in Tabularius',
    owns: (fn) => fn.startsWith('dial_'),
  },
];

/** The names a function answers to: its name and, with an owner, the reader's marker for undecoded calls. */
function keys(f: PluginManifest['functions'][number]): string[] {
  return [f.name.toLowerCase(), ...(f.owner ? [`⟨${f.owner}:${f.index}⟩`.toLowerCase()] : [])];
}

export class PluginRegistry {
  private installed = new Map<string, Installed>();
  /** File name (lowercase) → enabled plug-in ids. */
  private enabled = new Map<string, Set<string>>();
  /** File name (lowercase) → built-in pack ids turned off for it. */
  private builtinsOff = new Map<string, Set<string>>();
  /** Each file's functions by name and marker, built on first use after a change. */
  private tables = new Map<string, Map<string, PluginFunction>>();

  /** Adds a plug-in; every function in its manifest needs code. Replaces an installed copy with the same id. */
  install(manifest: PluginManifest, code: Record<string, PluginCall>): void {
    const calls = new Map(Object.entries(code).map(([k, v]) => [k.toLowerCase(), v]));
    const missing = manifest.functions.filter((f) => !calls.has(f.name.toLowerCase())).map((f) => f.name);
    if (missing.length) throw new Error(`${manifest.id}: no code for ${missing.join(', ')}`);
    const builtIn = manifest.functions.filter((f) => FUNCTIONS.has(f.name.toLowerCase())).map((f) => f.name);
    if (builtIn.length) throw new Error(`${manifest.id}: ${builtIn.join(', ')} ${builtIn.length === 1 ? 'is' : 'are'} already a function here`);
    // Function source cannot identify captured values (or bound/native code). Without an explicit
    // cacheKey, keep installations isolated rather than sharing potentially different results.
    const cacheKey = createHash('sha256').update(JSON.stringify([manifest,
      [...calls].map(([name, call]) => [name, call.cacheKey ?? randomUUID()]),
    ])).digest('hex');
    this.installed.set(manifest.id, { manifest, calls, cacheKey });
    this.tables.clear();
  }

  /** Removes a plug-in; refused while a file has it enabled. */
  uninstall(id: string): void {
    const using = [...this.enabled].filter(([, ids]) => ids.has(id)).map(([file]) => file);
    if (using.length) throw new Error(`${id} is enabled for ${using.join(', ')}`);
    this.installed.delete(id);
    this.tables.clear();
  }

  /** Turns a plug-in on for one hosted file. Two plug-ins can't provide the same name or call for the same file. */
  enable(file: string, id: string): void {
    const p = this.installed.get(id);
    if (!p) throw new Error(`${id} isn't installed`);
    const ids = this.enabled.get(file.toLowerCase()) ?? new Set<string>();
    const taken = new Map<string, string>();
    for (const other of ids) {
      if (other === id) continue;
      for (const f of this.installed.get(other)!.manifest.functions) for (const k of keys(f)) taken.set(k, other);
    }
    const clashes = p.manifest.functions.flatMap((f) => keys(f).filter((k) => taken.has(k)).map((k) => `${k} (${taken.get(k)})`));
    if (clashes.length) throw new Error(`${id} clashes with plug-ins already enabled for ${file}: ${clashes.join(', ')}`);
    this.enabled.set(file.toLowerCase(), ids.add(id));
    this.tables.delete(file.toLowerCase());
  }

  disable(file: string, id: string): void {
    this.enabled.get(file.toLowerCase())?.delete(id);
    this.tables.delete(file.toLowerCase());
  }

  /** The plug-ins enabled for a file, for Get ( InstalledFMPlugins ). */
  plugins(file: string): PluginManifest[] {
    return [...this.enabled.get(file.toLowerCase()) ?? []].map((id) => this.installed.get(id)!.manifest);
  }

  /** Turns a built-in pack on or off for one hosted file. Every pack is on until turned off. */
  setBuiltin(file: string, id: string, on: boolean): void {
    if (!BUILTIN_PACKS.some((p) => p.id === id)) throw new Error(`${id} isn't a built-in plug-in`);
    const key = file.toLowerCase();
    const off = this.builtinsOff.get(key) ?? new Set<string>();
    if (on) off.delete(id);
    else off.add(id);
    if (off.size) this.builtinsOff.set(key, off);
    else this.builtinsOff.delete(key);
  }

  /** Whether a function belongs to a built-in pack that is off for a file. */
  builtinOff(file: string, fn: string): boolean {
    const off = this.builtinsOff.get(file.toLowerCase());
    if (!off) return false;
    const lower = fn.toLowerCase();
    return BUILTIN_PACKS.some((p) => off.has(p.id) && p.owns(lower));
  }

  /** The built-in packs turned off for a file. */
  builtinsOffFor(file: string): string[] {
    return [...this.builtinsOff.get(file.toLowerCase()) ?? []];
  }

  /** Whether any plug-in enabled for a file asks to reach web hosts. */
  usesNetwork(file: string): boolean {
    return this.plugins(file).some((m) => m.permissions.network.length > 0);
  }

  /** Whether any plug-in enabled for a file asks to send mail. */
  usesMail(file: string): boolean {
    return this.plugins(file).some((m) => m.permissions.mail);
  }

  /** Every installed plug-in's manifest. */
  manifests(): PluginManifest[] {
    return [...this.installed.values()].map((p) => p.manifest);
  }

  /** Every installed plug-in, Enabled where this file has it on: Get ( InstalledFMPlugins ). Its id is its first
   * four-character owner, as FileMaker shows a plug-in's id. */
  installedFor(file: string): InstalledPlugin[] {
    const on = this.enabled.get(file.toLowerCase());
    const off = this.builtinsOff.get(file.toLowerCase());
    return [
      ...BUILTIN_PACKS.map((p): InstalledPlugin => ({ name: p.name, id: p.owner, version: 'tabularius', state: off?.has(p.id) ? 'Disabled' : 'Enabled', description: p.description })),
      ...[...this.installed.values()].map(({ manifest: m }): InstalledPlugin => ({
        name: m.name, id: m.owners[0] ?? '', version: m.version, state: on?.has(m.id) ? 'Enabled' : 'Disabled',
      })),
    ];
  }

  /** A CalcContext.plugin for one file: its enabled functions by name or marker, following later changes. */
  lookup(file: string): (name: string) => PluginFunction | undefined {
    const key = file.toLowerCase();
    return (name) => {
      let table = this.tables.get(key);
      if (!table) this.tables.set(key, (table = this.table(file)));
      return table.get(name.toLowerCase());
    };
  }

  private table(file: string): Map<string, PluginFunction> {
    const table = new Map<string, PluginFunction>();
    // A function of a plug-in the server has but this file hasn't enabled is a plug-in that isn't installed for it:
    // "?", as in FileMaker.
    for (const { manifest } of this.installed.values()) for (const f of manifest.functions) for (const k of keys(f)) table.set(k, NOT_ENABLED);
    for (const m of this.plugins(file)) {
      const calls = this.installed.get(m.id)!.calls;
      for (const f of m.functions) {
        const call = calls.get(f.name.toLowerCase())!;
        const p = m.permissions;
        const pure = f.pure && !p.files.length && !p.network.length && !p.mail && !p.secrets.length;
        const fn: PluginFunction = { cacheKey: this.installed.get(m.id)!.cacheKey, pure, min: f.min, ...(f.max !== undefined ? { max: f.max } : {}), call };
        for (const k of keys(f)) table.set(k, fn);
      }
    }
    return table;
  }

  /** Identifies a file's enabled plug-ins by their code and manifests, for the keys of shared calculation results. */
  cacheSignature(file: string): string {
    return createHash('sha256').update(JSON.stringify(this.plugins(file).map((m) => [m.id, this.installed.get(m.id)!.cacheKey]).sort())).digest('hex').slice(0, 16);
  }

  /** What checkFormula needs to know about a file's enabled functions. */
  signatures(file: string): [string, number, number | undefined][] {
    return this.plugins(file).flatMap((m) => m.functions.flatMap((f) => keys(f).map((k): [string, number, number | undefined] => [k, f.min, f.max])));
  }
}
