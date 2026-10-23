// What `tabularius plugins` shows and changes: the plug-ins in <data folder>/plugins/, which hosted files have
// each one on (plugins/enabled.json), which the server reads when it starts, and their secrets (plugins/secrets/),
// read when a plug-in asks for one.

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';
import type { PluginManifest } from './manifest.ts';
import { BUILTIN_PACKS, PluginRegistry } from './registry.ts';
import { loadPlugins } from './sandboxed.ts';
import { readJsonFile, type InstallRecord } from './package.ts';
import { readPluginSecrets, writePluginSecret } from './secrets.ts';

export interface PluginStatus {
  installed: PluginManifest[];
  /** File name → enabled plug-in ids, as enabled.json has them. */
  enabled: Record<string, string[]>;
  /** Plug-ins that couldn't be installed or enabled, as the server would log them. */
  problems: string[];
  /** Plug-in id → the names of the secrets set for it (never the values). */
  secrets: Record<string, string[]>;
  /** Plug-in id → how a package installed it (who signed it), for those installed from one. */
  installs: Record<string, InstallRecord>;
  /** The packs that ship inside Tabularius, with the files each is turned off for (it is on everywhere else). */
  builtins: { id: string; name: string; owner: string; publisher: string; description: string; offFor: string[] }[];
}

const offPath = (dataDir: string) => join(dataDir, 'plugins', 'builtin-off.json');

function readOff(dataDir: string): Record<string, string[]> {
  if (!existsSync(offPath(dataDir))) return {};
  const raw = readJsonStateSync<unknown>(offPath(dataDir));
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('plugins/builtin-off.json is not a list of file names to plug-in ids');
  return Object.fromEntries(Object.entries(raw).map(([file, ids]) => [file, Array.isArray(ids) ? ids.map(String) : []]));
}

const enabledPath = (dataDir: string) => join(dataDir, 'plugins', 'enabled.json');

function readEnabled(dataDir: string): Record<string, string[]> {
  const path = enabledPath(dataDir);
  if (!existsSync(path)) return {};
  const raw = readJsonStateSync<unknown>(path);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('plugins/enabled.json is not a list of file names to plug-in ids');
  return Object.fromEntries(Object.entries(raw).map(([file, ids]) => [file, Array.isArray(ids) ? ids.map(String) : []]));
}

function load(dataDir: string): { registry: PluginRegistry; problems: string[] } {
  const registry = new PluginRegistry();
  const problems: string[] = [];
  loadPlugins(registry, dataDir, (msg) => { if (/ not (installed|enabled|read|turned off)| is not a list of file names to plug-in ids/.test(msg)) problems.push(msg); });
  return { registry, problems };
}

export function pluginStatus(dataDir: string): PluginStatus {
  const { registry, problems } = load(dataDir);
  const installed = registry.manifests();
  const secrets: Record<string, string[]> = {};
  for (const m of installed) {
    if (!m.permissions.secrets.length) continue;
    try {
      secrets[m.id] = Object.keys(readPluginSecrets(dataDir, m.id)).filter((n) => m.permissions.secrets.includes(n));
    } catch (err) {
      problems.push(`Secrets for ${m.id} not read: ${(err as Error).message}`);
    }
  }
  const installs: Record<string, InstallRecord> = {};
  const root = join(dataDir, 'plugins');
  if (existsSync(root)) {
    for (const e of readdirSync(root, { withFileTypes: true })) {
      const file = join(root, e.name, 'install.json');
      if (!e.isDirectory() || !existsSync(file)) continue;
      try { const r = readJsonFile(file) as InstallRecord; installs[r.id] = r; } catch (err) { problems.push((err as Error).message); }
    }
  }
  // A torn or hand-edited file is reported by name and treated as empty, so the list still shows.
  const read = <T>(fn: () => T, empty: T): T => { try { return fn(); } catch (err) { problems.push((err as Error).message); return empty; } };
  const off = read(() => readOff(dataDir), {} as Record<string, string[]>);
  const builtins = BUILTIN_PACKS.map((p) => ({
    id: p.id, name: p.name, owner: p.owner, publisher: p.publisher, description: p.description,
    offFor: Object.entries(off).filter(([, ids]) => ids.includes(p.id)).map(([file]) => file),
  }));
  return { installed, enabled: read(() => readEnabled(dataDir), {} as Record<string, string[]>), problems, secrets, installs, builtins };
}

/** Sets or (with undefined) clears a secret for an installed plug-in whose plugin.json names it. */
export function setPluginSecret(dataDir: string, id: string, name: string, value: string | undefined): void {
  const m = load(dataDir).registry.manifests().find((p) => p.id === id);
  if (!m) throw new Error(`${id} isn't installed in ${join(dataDir, 'plugins')}`);
  if (!m.permissions.secrets.includes(name)) {
    throw new Error(`${id} doesn't ask for a secret called ${name}${m.permissions.secrets.length ? ` (it asks for ${m.permissions.secrets.join(', ')})` : ''}`);
  }
  if (value === '') throw new Error('the secret is empty');
  writePluginSecret(dataDir, id, name, value);
}

/**
 * Turns a plug-in on or off for a hosted file in enabled.json. Turning on checks it the way the server will: the
 * plug-in must be installed and its functions mustn't clash with another plug-in on for that file.
 */
export function setPluginEnabled(dataDir: string, file: string, id: string, on: boolean): void {
  if (BUILTIN_PACKS.some((p) => p.id === id)) return setBuiltinEnabled(dataDir, file, id, on);
  const enabled = readEnabled(dataDir);
  const key = Object.keys(enabled).find((f) => f.toLowerCase() === file.toLowerCase()) ?? file;
  const ids = new Set(enabled[key] ?? []);
  if (on) {
    const { registry } = load(dataDir);
    if (!registry.manifests().some((m) => m.id === id)) throw new Error(`${id} isn't installed in ${join(dataDir, 'plugins')}`);
    for (const other of ids) if (other !== id) try { registry.enable(key, other); } catch { /* already reported by the server */ }
    registry.enable(key, id);
    ids.add(id);
  } else ids.delete(id);
  mkdirSync(join(dataDir, 'plugins'), { recursive: true });
  updateJsonStateSync<Record<string, string[]>>(enabledPath(dataDir), {}, (latest) => {
    const next = { ...latest };
    const latestKey = Object.keys(next).find((f) => f.toLowerCase() === file.toLowerCase()) ?? key;
    const current = new Set(next[latestKey] ?? []);
    if (on) current.add(id);
    else current.delete(id);
    if (current.size) next[latestKey] = [...current];
    else delete next[latestKey];
    return next;
  });
}

/** Turns a built-in pack on or off for a hosted file in builtin-off.json (a pack is on for every file until turned off). */
function setBuiltinEnabled(dataDir: string, file: string, id: string, on: boolean): void {
  const off = readOff(dataDir);
  const key = Object.keys(off).find((f) => f.toLowerCase() === file.toLowerCase()) ?? file;
  mkdirSync(join(dataDir, 'plugins'), { recursive: true });
  updateJsonStateSync<Record<string, string[]>>(offPath(dataDir), {}, (latest) => {
    const next = { ...latest };
    const latestKey = Object.keys(next).find((f) => f.toLowerCase() === file.toLowerCase()) ?? key;
    const ids = new Set(next[latestKey] ?? []);
    if (on) ids.delete(id);
    else ids.add(id);
    if (ids.size) next[latestKey] = [...ids];
    else delete next[latestKey];
    return next;
  });
}
