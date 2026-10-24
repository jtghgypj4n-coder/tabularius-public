// Settings that are SET to something unusable stop the program and say what to do; they never quietly mean something
// else. An unset setting takes its default. A set one is read strictly: an empty key is not "no key", `false` is not
// "on", `1e3` is not a whole number, and a misspelled name for a secret setting is not ignored.
//
// Used by `tabularius serve` at start (checkServeSettings) and by the code that reads the setting.

type Env = NodeJS.ProcessEnv;

const ON = ['1', 'true', 'yes', 'on'];
const OFF = ['0', 'false', 'no', 'off', ''];

/**
 * A switch: 1, true, yes or on is on; 0, false, no, off or empty is off (so is unset). Anything else is an error.
 * `words: 'strict'` is for a switch that is spelled `1`, `true` or `yes` only, where "on" is refused rather than read.
 */
export function boolean(name: string, options: { env?: Env; words?: 'strict' } = {}): boolean {
  const raw = (options.env ?? process.env)[name];
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  const strict = options.words === 'strict';
  if (strict && (value === 'on' || value === 'off')) throw badSwitch(name, raw, strict);
  if (ON.includes(value)) return true;
  if (OFF.includes(value)) return false;
  throw badSwitch(name, raw, strict);
}

function badSwitch(name: string, raw: string, strict: boolean): Error {
  const on = strict ? '1, true or yes' : '1, true, yes or on';
  const off = strict ? '0, false or no' : '0, false, no or off';
  return new Error(`${name} is set to "${raw}", which is not a switch: use ${on} to turn it on, ${off} to turn it off, or unset the variable for the default`);
}

/** A whole number written as digits only (no sign, decimal point or exponent), or undefined when unset. Empty is an error. */
export function wholeNumber(name: string, options: { min?: number; max?: number; env?: Env } = {}): number | undefined {
  const raw = (options.env ?? process.env)[name];
  if (raw === undefined) return undefined;
  const min = options.min ?? 0;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  const range = max === Number.MAX_SAFE_INTEGER ? `${min} or more` : min === 0 ? `${max} or less` : `${min} to ${max}`;
  const value = raw.trim();
  const given = value === '' ? 'is set but empty' : `is set to "${raw}"`;
  const fix = `${name} ${given}: give a whole number of ${range}, written in digits only (no 1e3, 2.5 or sign), or unset the variable for the default`;
  if (!/^\d{1,16}$/.test(value)) throw new Error(fix);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(fix);
  return n;
}

/** What to do about each key setting that is set but empty. */
const EMPTY_KEY: Record<string, string> = {
  TABULARIUS_ENCRYPTION_KEY: 'set a key, or unset the variable to run without encryption',
  TABULARIUS_SECRETS_KEY: 'set a passphrase, or unset the variable to keep the key file in the folder instead',
  TABULARIUS_BACKUP_KEY: 'set a passphrase, or unset the variable to make backups that are not encrypted',
};

/** A secret (a key or passphrase): undefined when unset, an error when set but empty, since empty must never mean "none". */
export function secret(name: string, env: Env = process.env): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  if (raw.trim() === '') throw new Error(`${name} is set but empty: ${EMPTY_KEY[name] ?? 'set a value, or unset the variable'}`);
  return raw;
}

/** Settings that hold a secret or point to one. A name near one of these that is not itself a setting stops the start. */
export const SECRET_SETTINGS: readonly string[] = [
  'TABULARIUS_AI_EMBED_KEY',
  'TABULARIUS_AI_IMAGE_EMBED_KEY',
  'TABULARIUS_AI_KEY_FILE',
  'TABULARIUS_BACKUP_KEY',
  'TABULARIUS_ENCRYPTION_KEY',
  'TABULARIUS_FMS_KEY_PASSPHRASE',
  'TABULARIUS_FMS_PASSWORD',
  'TABULARIUS_LDAP_SEARCH_PASSWORD',
  'TABULARIUS_MCP_TOKEN',
  'TABULARIUS_MCP_TOKEN_FILE',
  'TABULARIUS_OIDC_CLIENT_SECRET',
  'TABULARIUS_PASSWORD',
  'TABULARIUS_REPLICATION_TOKEN',
  'TABULARIUS_REPLICATION_TOKEN_FILE',
  'TABULARIUS_S3_ACCESS_KEY',
  'TABULARIUS_S3_SECRET_KEY',
  'TABULARIUS_SECRETS_KEY',
];

/** Settings whose names carry KEY, TOKEN, SECRET or PASSWORD but that hold a count, a length or a folder, not a secret. */
export const NOT_SECRET_SETTINGS: readonly string[] = [
  'TABULARIUS_AI_ACCOUNT_DAILY_TOKENS',
  'TABULARIUS_AI_DAILY_TOKENS',
  'TABULARIUS_AI_RUN_TOKENS',
  'TABULARIUS_MIN_PASSWORD_LENGTH',
  'TABULARIUS_SYNC_SECRETS',
  'TABULARIUS_TOKEN_DEFAULT_DAYS',
];

/** How many letters a misspelling of a secret setting's name may differ by and still be taken for it. */
const NEAR_MISS = 2;

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/**
 * A TABULARIUS_* variable whose name has KEY, TOKEN, SECRET or PASSWORD in it, is not a setting, and is within two
 * letters of one that holds a secret is a misspelling: the server would start without the secret. It is an error.
 */
export function checkSettingNames(env: Env = process.env): void {
  const known = new Set([...SECRET_SETTINGS, ...NOT_SECRET_SETTINGS]);
  const problems: string[] = [];
  for (const name of Object.keys(env)) {
    if (!name.startsWith('TABULARIUS_') || known.has(name) || !/KEY|TOKEN|SECRET|PASSWORD/.test(name)) continue;
    const near = SECRET_SETTINGS.find((s) => Math.abs(s.length - name.length) <= NEAR_MISS && editDistance(name, s) <= NEAR_MISS);
    if (near) problems.push(`${name} is not a setting, but it is a letter or two from ${near}, which holds a secret, so it is probably a misspelling and the server would start without it. Fix the spelling, or remove ${name}`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
}

/** The conversion limits for an uploaded file: the least memory the worker is given, in MB. */
export const CONVERT_MEMORY_MIN_MB = 64;

/**
 * Everything `tabularius serve` reads from the environment that has to be understood exactly, checked once before
 * anything starts. Every problem is listed, each naming its variable.
 */
export function checkServeSettings(env: Env = process.env): void {
  const problems: string[] = [];
  const check = (read: () => unknown): void => {
    try { read(); } catch (e) { problems.push((e as Error).message); }
  };
  for (const name of Object.keys(EMPTY_KEY)) check(() => secret(name, env));
  check(() => checkSettingNames(env));
  check(() => boolean('TABULARIUS_TRACE_SQL', { env }));
  check(() => wholeNumber('TABULARIUS_CONVERT_MEMORY', { min: CONVERT_MEMORY_MIN_MB, env }));
  check(() => wholeNumber('TABULARIUS_CONVERT_TIMEOUT', { env }));
  check(() => wholeNumber('TABULARIUS_SQL_PORT', { max: 65535, env }));
  check(() => wholeNumber('TABULARIUS_HTTP_PORT', { max: 65535, env }));
  if (env.TABULARIUS_WORKERS !== undefined && env.TABULARIUS_WORKERS.trim() !== 'auto') check(() => wholeNumber('TABULARIUS_WORKERS', { min: 1, max: 64, env }));
  check(() => wholeNumber('TABULARIUS_MAX_UPLOAD_IN_PROGRESS', { min: 1, env }));
  check(() => wholeNumber('TABULARIUS_REQUEST_LIMIT', { min: 4, env }));
  check(() => wholeNumber('TABULARIUS_WARM_HEAP_MB', { min: 1, env }));
  check(() => wholeNumber('TABULARIUS_PGWIRE_MAX_BUFFERED_ROWS', { min: 1, env }));
  check(() => wholeNumber('TABULARIUS_DRAIN_SECONDS', { min: 1, max: 86400, env }));
  for (const name of ['TABULARIUS_SQL_WRITES', 'TABULARIUS_LIST_FILES_PUBLICLY', 'TABULARIUS_ALLOW_PLAIN_HTTP']) check(() => boolean(name, { env }));
  check(() => boolean('TABULARIUS_OIDC_TRUST_EMAIL', { env, words: 'strict' }));
  if (problems.length) throw new Error(problems.join('\n'));
}
