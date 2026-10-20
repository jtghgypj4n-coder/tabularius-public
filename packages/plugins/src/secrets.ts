// Plug-in secrets: values only the server's admin sets (an API key, a licence), kept in
// <data folder>/plugins/secrets/<plug-in id>.json, readable by the server's user alone. A plug-in reads one with
// tabularius.secrets.get ( "NAME" ), and only names its plugin.json lists. Values are never logged or shown.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';

const secretsDir = (dataDir: string) => join(dataDir, 'plugins', 'secrets');
const secretsFile = (dataDir: string, id: string) => join(secretsDir(dataDir), `${id}.json`);

/** A plug-in's secrets, or none. Throws (without the values) when the file can be read by other users or is damaged. */
export function readPluginSecrets(dataDir: string, id: string): Record<string, string> {
  const file = secretsFile(dataDir, id);
  if (!existsSync(file)) return {};
  if (process.platform !== 'win32' && statSync(file).mode & 0o077) {
    throw new Error(`plugins/secrets/${id}.json can be read by other users (chmod 600)`);
  }
  let raw: unknown;
  try { raw = readJsonStateSync(file); }
  catch (e) {
    if (e instanceof Error && e.cause instanceof SyntaxError) throw new Error(`plugins/secrets/${id}.json isn't JSON (${file}): ${e.cause.message}`, { cause: e });
    throw e;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`plugins/secrets/${id}.json isn't an object`);
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
}

/** Sets a secret (or clears it, with undefined), writing the file readable by the server's user alone. */
export function writePluginSecret(dataDir: string, id: string, name: string, value: string | undefined): void {
  // Keep the file's permission and format checks on writes as well as reads.
  readPluginSecrets(dataDir, id);
  mkdirSync(secretsDir(dataDir), { recursive: true, mode: 0o700 });
  const file = secretsFile(dataDir, id);
  updateJsonStateSync<Record<string, string>>(file, {}, (latest) => {
    const secrets = { ...latest };
    if (value === undefined) delete secrets[name];
    else secrets[name] = value;
    return secrets;
  }, { mode: 0o600 });
}
