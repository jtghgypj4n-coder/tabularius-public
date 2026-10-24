// `tabularius serve` refuses a setting that is set to something unusable, and does not start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '../src/main.ts');
const cases: [string, Record<string, string>, RegExp, string[]?][] = [
  ['an empty encryption key', { TABULARIUS_ENCRYPTION_KEY: '' }, /TABULARIUS_ENCRYPTION_KEY is set but empty: set a key, or unset the variable to run without encryption/],
  ['an empty secrets key', { TABULARIUS_SECRETS_KEY: '' }, /TABULARIUS_SECRETS_KEY is set but empty/],
  ['CONVERT_MEMORY=0', { TABULARIUS_CONVERT_MEMORY: '0' }, /TABULARIUS_CONVERT_MEMORY.*64 or more/],
  ['a number in exponent form', { TABULARIUS_SQL_PORT: '1e3' }, /TABULARIUS_SQL_PORT.*whole number/],
  ['a backup count in exponent form', { TABULARIUS_BACKUP_KEEP: '1e1' }, /TABULARIUS_BACKUP_KEEP is the number of backups to keep, a whole number of 1 or more/],
  ['a worker count in exponent form', { TABULARIUS_WORKERS: '1e1' }, /TABULARIUS_WORKERS.*whole number/],
  ['an unreadable switch', { TABULARIUS_TRACE_SQL: 'sometimes' }, /TABULARIUS_TRACE_SQL.*"sometimes"/],
  ['an empty OIDC client secret', { TABULARIUS_OIDC_ISSUER: 'https://idp.example', TABULARIUS_OIDC_CLIENT_ID: 'app', TABULARIUS_OIDC_CLIENT_SECRET: '' }, /TABULARIUS_OIDC_CLIENT_SECRET is set but empty/],
  ['a blank OIDC client secret', { TABULARIUS_OIDC_ISSUER: 'https://idp.example', TABULARIUS_OIDC_CLIENT_ID: 'app', TABULARIUS_OIDC_CLIENT_SECRET: '   ' }, /TABULARIUS_OIDC_CLIENT_SECRET is set but empty/],
  ['an empty LDAP search password', { TABULARIUS_LDAP_URL: 'ldaps://ldap.example', TABULARIUS_LDAP_SEARCH_PASSWORD: '' }, /TABULARIUS_LDAP_SEARCH_PASSWORD is set but empty/],
  ['a blank LDAP search password', { TABULARIUS_LDAP_URL: 'ldaps://ldap.example', TABULARIUS_LDAP_SEARCH_PASSWORD: ' \t' }, /TABULARIUS_LDAP_SEARCH_PASSWORD is set but empty/],
  ['an empty S3 secret key', { TABULARIUS_BACKUP_S3: 's3://bucket/prefix', TABULARIUS_S3_ACCESS_KEY: 'id', TABULARIUS_S3_SECRET_KEY: '' }, /TABULARIUS_S3_SECRET_KEY is set but empty/],
  ['a blank MCP token', { TABULARIUS_MCP_TOKEN: '  ' }, /TABULARIUS_MCP_TOKEN is set but empty/],
  ['an empty replication token', { TABULARIUS_REPLICATION_TOKEN: '' }, /TABULARIUS_REPLICATION_TOKEN is set but empty/],
  ['an empty embedding key', { TABULARIUS_AI_EMBED_KEY: '', TABULARIUS_AI_EMBED_URL: 'ollama', ANTHROPIC_API_KEY: ['synthetic', 'test', 'key'].join('-') }, /TABULARIUS_AI_EMBED_KEY is set but empty/, ['--ai']],
  ['a misspelled key setting', { TABULARIUS_ENCRYPTON_KEY: 'k' }, /TABULARIUS_ENCRYPTON_KEY is not a setting.*TABULARIUS_ENCRYPTION_KEY/],
];

for (const [label, set, expected, extra = []] of cases) test(`serve refuses ${label}`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-serve-settings-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, TABULARIUS_ENCRYPTION_KEY: undefined, ...set };
    for (const name of Object.keys(env)) if (env[name] === undefined) delete env[name];
    const r = await runCli(main, ['serve', dir, '--port', '0', ...extra], { env, timeout: 30_000 });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, expected);
    assert.doesNotMatch(r.stdout, /hosting|Web client/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
