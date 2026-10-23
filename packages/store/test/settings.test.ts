// Settings that are SET to something unusable stop the program and say what to do; they never quietly mean something else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { boolean, wholeNumber, secret, checkSettingNames, checkServeSettings, NOT_SECRET_SETTINGS, SECRET_SETTINGS } from '../src/settings.ts';
import { tracing } from '../src/trace.ts';

const root = join(import.meta.dirname, '../../..');
const N = 'TABULARIUS_EXAMPLE';

test('boolean: on and off words, unset and empty are off, anything else is an error naming the setting and the allowed words', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' On ']) assert.equal(boolean(N, { env: { [N]: v } }), true, v);
  for (const v of ['0', 'false', 'no', 'off', 'Off', '']) assert.equal(boolean(N, { env: { [N]: v } }), false, v);
  assert.equal(boolean(N, { env: {} }), false);
  assert.throws(() => boolean(N, { env: { [N]: 'maybe' } }), (e: Error) => e.message.includes(N) && e.message.includes('"maybe"') && /1, true, yes or on/.test(e.message) && /0, false, no or off/.test(e.message) && /unset/.test(e.message));
});

test('boolean: a switch that must be spelled out refuses "on"', () => {
  assert.equal(boolean(N, { env: { [N]: 'yes' }, words: 'strict' }), true);
  assert.equal(boolean(N, { env: { [N]: 'no' }, words: 'strict' }), false);
  assert.throws(() => boolean(N, { env: { [N]: 'on' }, words: 'strict' }), /TABULARIUS_EXAMPLE.*"on"/);
});

test('wholeNumber: digits only, within the limits, unset is undefined', () => {
  assert.equal(wholeNumber(N, { env: {} }), undefined);
  assert.equal(wholeNumber(N, { env: { [N]: '2048' } }), 2048);
  assert.equal(wholeNumber(N, { env: { [N]: ' 7 ' } }), 7);
  assert.equal(wholeNumber(N, { env: { [N]: '0' } }), 0);
  for (const v of ['', '  ', '1e3', '2.5', '-1', '+5', '0x10', 'ten', '1_000', '99999999999999999999']) {
    assert.throws(() => wholeNumber(N, { env: { [N]: v } }), (e: Error) => e.message.includes(N) && /whole number/.test(e.message) && /unset/.test(e.message), JSON.stringify(v));
  }
  assert.throws(() => wholeNumber(N, { min: 64, env: { [N]: '0' } }), /64 or more/);
  assert.throws(() => wholeNumber(N, { max: 10, env: { [N]: '11' } }), /10 or less/);
  assert.equal(wholeNumber(N, { min: 64, max: 99, env: { [N]: '64' } }), 64);
});

test('secret: unset is no secret, empty is an error that says what to do', () => {
  assert.equal(secret('TABULARIUS_ENCRYPTION_KEY', {}), undefined);
  assert.equal(secret('TABULARIUS_ENCRYPTION_KEY', { TABULARIUS_ENCRYPTION_KEY: 'pass phrase' }), 'pass phrase');
  for (const v of ['', '   ']) {
    assert.throws(() => secret('TABULARIUS_ENCRYPTION_KEY', { TABULARIUS_ENCRYPTION_KEY: v }),
      /TABULARIUS_ENCRYPTION_KEY is set but empty: set a key, or unset the variable to run without encryption/);
  }
  assert.throws(() => secret('TABULARIUS_BACKUP_KEY', { TABULARIUS_BACKUP_KEY: '' }), /TABULARIUS_BACKUP_KEY is set but empty: set a passphrase, or unset the variable/);
});

test('a name one or two edits from a secret setting stops the start; other names do not', () => {
  const near = (name: string) => checkSettingNames({ [name]: 'x' });
  for (const name of ['TABULARIUS_ENCRYPTION_KEYS', 'TABULARIUS_ENCRYPTON_KEY', 'TABULARIUS_SECRET_KEY', 'TABULARIUS_BACKUP_KEYS', 'TABULARIUS_MCP_TOKENS']) {
    assert.throws(() => near(name), (e: Error) => e.message.includes(name) && /not a setting/.test(e.message) && /TABULARIUS_[A-Z_]+/.test(e.message) && /Fix the spelling|remove/i.test(e.message), name);
  }
  // Known settings, other prefixes, names without a secret word and far-off names are left alone.
  for (const name of [...SECRET_SETTINGS, ...NOT_SECRET_SETTINGS, 'TABULARIUS_BACKUP_KEEP', 'TABULARIUS_PORT', 'TABULARIUS_TRACE_SQL', 'OTHER_ENCRYPTON_KEY', 'TABULARIUS_MY_OWN_KEY_FOR_SOMETHING_ELSE']) {
    assert.doesNotThrow(() => near(name), name);
  }
});

test('every secret-bearing setting in the documented list is known here, and no setting the code reads trips the check', () => {
  const metadata = JSON.parse(readFileSync(join(root, 'scripts/reference/settings-cli-metadata.json'), 'utf8')).environment as Record<string, unknown>;
  const withWord = Object.keys(metadata).filter((n) => /KEY|TOKEN|SECRET|PASSWORD/.test(n)).sort();
  assert.deepEqual([...SECRET_SETTINGS, ...NOT_SECRET_SETTINGS].sort(), withWord, 'update SECRET_SETTINGS / NOT_SECRET_SETTINGS in packages/store/src/settings.ts');
  const used = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(?:ts|js|cjs|mjs)$/.test(e.name) && /\/src\//.test(p)) for (const m of readFileSync(p, 'utf8').matchAll(/\bTABULARIUS_[A-Z0-9_]*[A-Z0-9]\b/g)) used.add(m[0]);
    }
  };
  walk(join(root, 'packages'));
  for (const name of used) assert.doesNotThrow(() => checkSettingNames({ [name]: 'x' }), name);
});

test('TABULARIUS_TRACE_SQL: false, off, no and 0 turn tracing off; true turns it on; nonsense is an error', () => {
  const was = process.env.TABULARIUS_TRACE_SQL;
  try {
    for (const v of ['false', 'off', 'no', '0', '']) { process.env.TABULARIUS_TRACE_SQL = v; assert.equal(tracing(), false, v); }
    for (const v of ['1', 'true', 'yes', 'on']) { process.env.TABULARIUS_TRACE_SQL = v; assert.equal(tracing(), true, v); }
    delete process.env.TABULARIUS_TRACE_SQL;
    assert.equal(tracing(), false);
    process.env.TABULARIUS_TRACE_SQL = 'sometimes';
    assert.throws(() => tracing(), /TABULARIUS_TRACE_SQL.*"sometimes"/);
  } finally {
    if (was === undefined) delete process.env.TABULARIUS_TRACE_SQL; else process.env.TABULARIUS_TRACE_SQL = was;
  }
});

test('checkServeSettings refuses an empty key, a bad number or switch, and a near-miss name, all at once with each named', () => {
  assert.doesNotThrow(() => checkServeSettings({}));
  assert.doesNotThrow(() => checkServeSettings({ TABULARIUS_ENCRYPTION_KEY: 'k', TABULARIUS_CONVERT_MEMORY: '2048', TABULARIUS_CONVERT_TIMEOUT: '0', TABULARIUS_TRACE_SQL: 'off', TABULARIUS_WORKERS: 'auto' }));
  const message = (env: NodeJS.ProcessEnv): string => { try { checkServeSettings(env); } catch (e) { return (e as Error).message; } return ''; };
  assert.match(message({ TABULARIUS_ENCRYPTION_KEY: '' }), /TABULARIUS_ENCRYPTION_KEY is set but empty/);
  assert.match(message({ TABULARIUS_SECRETS_KEY: '' }), /TABULARIUS_SECRETS_KEY is set but empty/);
  assert.match(message({ TABULARIUS_BACKUP_KEY: '' }), /TABULARIUS_BACKUP_KEY is set but empty/);
  assert.match(message({ TABULARIUS_CONVERT_MEMORY: '0' }), /TABULARIUS_CONVERT_MEMORY.*64 or more/);
  assert.match(message({ TABULARIUS_CONVERT_MEMORY: '1e3' }), /TABULARIUS_CONVERT_MEMORY.*whole number/);
  assert.match(message({ TABULARIUS_CONVERT_TIMEOUT: '' }), /TABULARIUS_CONVERT_TIMEOUT.*whole number/);
  assert.match(message({ TABULARIUS_SQL_PORT: '1e3' }), /TABULARIUS_SQL_PORT/);
  assert.match(message({ TABULARIUS_TRACE_SQL: 'sometimes' }), /TABULARIUS_TRACE_SQL/);
  assert.match(message({ TABULARIUS_OIDC_TRUST_EMAIL: 'on' }), /TABULARIUS_OIDC_TRUST_EMAIL.*"on"/);
  assert.match(message({ TABULARIUS_ENCRYPTON_KEY: 'x' }), /TABULARIUS_ENCRYPTON_KEY is not a setting/);
  const both = message({ TABULARIUS_ENCRYPTION_KEY: '', TABULARIUS_SQL_PORT: 'x' });
  assert.match(both, /TABULARIUS_ENCRYPTION_KEY/);
  assert.match(both, /TABULARIUS_SQL_PORT/);
});
