// Plug-in secrets: values only the server's admin sets (an API key, a licence), kept in
// <data folder>/plugins/secrets/<plug-in id>.json. POSIX modes restrict access; Windows requires operator-managed ACLs. A plug-in reads one with
// tabularius.secrets.get ( "NAME" ), and only names its plugin.json lists. Values are never logged or shown.

import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';

const secretsDir = (dataDir: string) => join(dataDir, 'plugins', 'secrets');
const secretsFile = (dataDir: string, id: string) => join(secretsDir(dataDir), `${id}.json`);

/** A plug-in's secrets, or none. Throws (without the values) when the file can be read by other users or is damaged. */
export function readPluginSecrets(dataDir: string, id: string, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const file = secretsFile(dataDir, id);
  // Tighten a folder an earlier version left open; one this account may not change (or a read-only disk) is left as it is, and the file's own mode check below still applies.
  if (existsSync(secretsDir(dataDir)) && platform !== 'win32') { try { chmodSync(secretsDir(dataDir), 0o700); } catch { /* not ours to change */ } }
  if (!existsSync(file)) return {};
  if (platform !== 'win32' && statSync(file).mode & 0o077) {
    throw new Error(`plugins/secrets/${id}.json can be read by other users (chmod 600)`);
  }
  let raw: unknown;
  try { raw = readJsonStateSync(file, { sensitive: true, platform }); }
  catch (e) {
    if (e instanceof Error && e.cause instanceof SyntaxError) throw new Error(`plugins/secrets/${id}.json isn't JSON; repair or replace the file`);
    throw e;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`plugins/secrets/${id}.json isn't an object`);
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
}

/** Sets or clears a secret. Windows ACL privacy is unverified here; chmod does not enforce it. */
export function writePluginSecret(dataDir: string, id: string, name: string, value: string | undefined, platform: NodeJS.Platform = process.platform): void {
  // Keep the file's permission and format checks on writes as well as reads.
  readPluginSecrets(dataDir, id, platform);
  mkdirSync(secretsDir(dataDir), { recursive: true, mode: 0o700 });
  const file = secretsFile(dataDir, id);
  updateJsonStateSync<Record<string, string>>(file, {}, (latest) => {
    const secrets = { ...latest };
    if (value === undefined) delete secrets[name];
    else secrets[name] = value;
    return secrets;
  }, { mode: 0o600, sensitive: true, platform });
}
