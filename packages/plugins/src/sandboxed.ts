// Third-party plug-in code runs in the sandbox JavaScript custom functions already use (store/src/javascript.ts): a
// separate Node process under the permission model, no network, no modules, a time limit and a memory cap. A
// plug-in's main.js defines `const functions = { Name ( a, b ) { ... }, ... }` and is loaded once into a realm of its
// own, kept for its later calls; each call gets the call's arguments (text, numbers, ISO dates) and its answer
// becomes the calculation's value. Beyond its arguments and what it kept itself, it has tabularius.files (read,
// readBase64, write, size) in the folders its manifest asks for, and tabularius.http.request and tabularius.mail.send
// for the hosts and mail it asks for, which only outbound test mode allows, recording them (never sending), and
// tabularius.secrets.get for the secrets it names, which the server's admin sets (secrets.ts). A call
// that asks the host for something runs again once the host has answered, so a function must give the same answer
// when it runs twice; the same request twice in one call is made once. The realm can be dropped
// at any time (a time-out, the sandbox restarting), so kept state is a cache, never a store.

import { existsSync, readdirSync } from 'node:fs';
import { readFileSync } from '../../store/src/fs-boundary.ts';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CalcError, ERR, type Env } from '../../calc/src/index.ts';
import { callJavaScriptModule, type PluginHost } from '../../store/src/javascript.ts';
import { parseManifest, type PluginManifest } from './manifest.ts';
import { readPluginSecrets } from './secrets.ts';
import { checkInstalled } from './package.ts';
import type { PluginCall, PluginRegistry } from './registry.ts';

/** The code for each of a plug-in's functions, run in the sandbox. */
export function sandboxedCalls(manifest: PluginManifest, source: string, secrets: () => Record<string, string> = () => ({})): Record<string, PluginCall> {
  // The key changes with the code, so an updated plug-in is loaded afresh.
  const mod = { key: `${manifest.id}@${manifest.version}#${createHash('sha256').update(source).digest('hex').slice(0, 16)}`, name: manifest.id, source, ...(manifest.runtime === 'wasm' ? { wasm: true } : {}) };
  const calls: Record<string, PluginCall> = {};
  for (const f of manifest.functions) {
    calls[f.name] = (args, env) => callJavaScriptModule(mod, f.name, args, manifest.permissions.timeoutMs, pluginHost(manifest, f.name, env, secrets), manifest.permissions.memoryMb);
    calls[f.name].cacheKey = mod.key;
  }
  return calls;
}

/** File operations require the manifest's permission for the folder scripts will resolve. */
function requirePluginFileAccess(manifest: PluginManifest, path: string, access: 'read' | 'write'): void {
  const folder = path.replace(/\\/g, '/').includes('/Temporary/') ? 'temporary' : 'documents';
  if (!manifest.permissions.files.includes(`${folder}:${access}`)) {
    throw new CalcError(ERR.calculation, `${manifest.id} may not ${access} files in the ${folder} folder (its plugin.json doesn't ask to)`);
  }
}

/** The manifest's host allowlist applies to the initial URL and to every redirect. */
function pluginAllowsUrl(manifest: PluginManifest, url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return /^https?:$/.test(parsed.protocol) && manifest.permissions.network.some((p) =>
      p.startsWith('*.') ? host.endsWith(p.slice(1).toLowerCase()) : host === p.toLowerCase());
  } catch { return false; }
}

/**
 * What a plug-in may ask the host for: tabularius.files in the folders its manifest names (documents:read and so on),
 * which are the same folders scripts' file steps use (a path with /Temporary/ in it is the run's temporary folder;
 * any other is the documents folder). Anywhere else, or a folder it didn't ask for, is an error: "?". A secret it
 * names and the admin hasn't set is null.
 */
function pluginHost(manifest: PluginManifest, fn: string, env: Env, secrets: () => Record<string, string>): PluginHost {
  const pure = manifest.functions.find((f) => f.name === fn)?.pure === true;
  const via = `${manifest.id}:${fn}`;
  return (op, args) => {
    if (pure) throw new CalcError(ERR.calculation, `${manifest.id}:${fn} is declared pure and may not call the host`);
    const files = env.ctx.files;
    const path = String(args[0] ?? '');
    switch (op) {
      case 'read': case 'readBase64': {
        requirePluginFileAccess(manifest, path, 'read');
        const bytes = files?.read(path);
        if (!bytes) return null;
        return op === 'read' ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString('base64');
      }
      case 'size':
        requirePluginFileAccess(manifest, path, 'read');
        return files?.size(path) ?? null;
      case 'write':
        requirePluginFileAccess(manifest, path, 'write');
        return files?.write(path, String(args[1] ?? ''), args[2] === true) ?? false;
      case 'request': {
        const [method, url, body] = args.slice(0, 3).map(String);
        const headers = Object.fromEntries(Object.entries((args[3] ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
        const allows = (url: string) => pluginAllowsUrl(manifest, url);
        let host: string;
        try { host = new URL(url).hostname.toLowerCase(); } catch { throw new CalcError(ERR.calculation, `${manifest.id}: "${url}" isn't a web address`); }
        if (!allows(url)) throw new CalcError(ERR.calculation, `${manifest.id} may not reach ${host} (its plugin.json doesn't ask to)`);
        // Where scripts may reach the network, the request is made (the host runs it and the call runs again).
        if (env.ctx.network) return env.ctx.network.fetch(via, { method, url, headers, body, allows });
        // Only outbound test mode lets a request through, and then it is recorded, never sent: an empty answer.
        if (!env.ctx.outbound) throw new CalcError(ERR.calculation, `${manifest.id}: the network isn't available to plug-ins here`);
        env.ctx.outbound.request(via, method, url, Buffer.byteLength(body));
        return { status: 0, body: '', recorded: true };
      }
      case 'mail': {
        if (!manifest.permissions.mail) throw new CalcError(ERR.calculation, `${manifest.id} may not send mail (its plugin.json doesn't ask to)`);
        const m = (args[0] ?? {}) as Record<string, unknown>;
        const s = (k: string) => String(m[k] ?? '');
        const mail = { from: s('from'), to: s('to'), cc: s('cc'), bcc: s('bcc'), subject: s('subject'), body: s('body'),
          attachments: Array.isArray(m.attachments) ? m.attachments.map(String) : [] };
        for (const attachment of mail.attachments) requirePluginFileAccess(manifest, attachment, 'read');
        // Where the operator switched sending on, the message is sent through their account (the host decides who it
        // comes from, and refuses capture-only files); otherwise only outbound test mode takes it, and records it.
        if (env.ctx.mailer) { env.ctx.mailer.send(via, mail); return true; }
        if (!env.ctx.outbound) throw new CalcError(ERR.calculation, `${manifest.id}: mail isn't available to plug-ins here`);
        env.ctx.outbound.mail(via, mail);
        return true;
      }
      case 'secret': {
        if (!manifest.permissions.secrets.includes(path)) throw new CalcError(ERR.calculation, `${manifest.id} may not read the secret ${path} (its plugin.json doesn't ask to)`);
        let all: Record<string, string>;
        try { all = secrets(); } catch (e) { throw new CalcError(ERR.calculation, `${manifest.id}: ${(e as Error).message}`); }
        return Object.hasOwn(all, path) ? all[path] : null;
      }
      default:
        throw new CalcError(ERR.calculation, `${manifest.id} asked the host for "${op}", which it doesn't do`);
    }
  };
}

/** Reads a plug-in folder (plugin.json and its main file), with its secrets from the data folder when given. Only
 * JavaScript plug-ins run so far. */
export function readPlugin(dir: string, dataDir?: string): { manifest: PluginManifest; calls: Record<string, PluginCall> } {
  const manifestBytes = readFileSync(join(dir, 'plugin.json'));
  const parsed = parseManifest(JSON.parse(manifestBytes.toString('utf8')));
  if (!parsed.ok) throw new Error(`${dir}/plugin.json: ${parsed.errors.join('; ')}`);
  const { manifest } = parsed;
  if (manifest.runtime === 'wasm' && !/\.wasm$/.test(manifest.main)) throw new Error(`${manifest.id}: a wasm plug-in's main is a .wasm file`);
  if (manifest.runtime === 'js' && /\.wasm$/.test(manifest.main)) throw new Error(`${manifest.id}: a .wasm main needs "runtime": "wasm"`);
  // Read at each use, so a secret the admin sets takes effect without a restart.
  const secrets = () => (dataDir ? readPluginSecrets(dataDir, manifest.id) : {});
  const source = readFileSync(join(dir, manifest.main));
  // Verify the exact buffers that will be executed, rather than reopening a
  // checked filename after integrity verification.
  checkInstalled(dir, new Map([['plugin.json', manifestBytes], [manifest.main, source]]));
  return { manifest, calls: sandboxedCalls(manifest, source.toString(manifest.runtime === 'wasm' ? 'base64' : 'utf8'), secrets) };
}

/**
 * Installs the plug-ins in <data folder>/plugins/<folder>/ and enables them as <data folder>/plugins/enabled.json says:
 * { "Invoices": ["org.example.troi-file"] }. Only the server's own folder can add plug-ins or enable them; a hosted
 * file can't. A plug-in that can't be read is skipped and logged.
 */
export function loadPlugins(registry: PluginRegistry, dataDir: string, log: (msg: string) => void = () => {}): void {
  const root = join(dataDir, 'plugins');
  if (!existsSync(root)) return;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !existsSync(join(root, e.name, 'plugin.json'))) continue;
    try {
      const { manifest, calls } = readPlugin(join(root, e.name), dataDir);
      registry.install(manifest, calls);
      log(`Plug-in ${manifest.name} ${manifest.version} (${manifest.id}) installed`);
    } catch (err) {
      log(`Plug-in in ${e.name} not installed: ${(err as Error).message}`);
    }
  }
  // Built-in packs turned off for a file (plugins/builtin-off.json: { "Invoices": ["com.openhbam.baseelements"] }).
  const offFile = join(root, 'builtin-off.json');
  if (existsSync(offFile)) {
    try {
      for (const [file, ids] of Object.entries(JSON.parse(readFileSync(offFile, 'utf8')) as Record<string, unknown>)) {
        for (const id of Array.isArray(ids) ? ids : []) {
          try {
            registry.setBuiltin(file, String(id), false);
            log(`Built-in plug-in ${id} turned off for ${file}`);
          } catch (err) {
            log(`Built-in plug-in ${id} not turned off for ${file}: ${(err as Error).message}`);
          }
        }
      }
    } catch (err) {
      log(`plugins/builtin-off.json not read: ${(err as Error).message}`);
    }
  }
  const enabledFile = join(root, 'enabled.json');
  if (!existsSync(enabledFile)) return;
  let enabled: Record<string, unknown>;
  try {
    enabled = JSON.parse(readFileSync(enabledFile, 'utf8'));
  } catch (err) {
    log(`plugins/enabled.json not read: ${(err as Error).message}`);
    return;
  }
  for (const [file, ids] of Object.entries(enabled)) {
    for (const id of Array.isArray(ids) ? ids : []) {
      try {
        registry.enable(file, String(id));
        log(`Plug-in ${id} enabled for ${file}`);
      } catch (err) {
        log(`Plug-in ${id} not enabled for ${file}: ${(err as Error).message}`);
      }
    }
  }
}
