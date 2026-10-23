// `tabularius token <folder> <database> create <account> --expires-days N` takes a number of days above zero, up to
// 3650: there is no way to ask for none. Left out, the token lives 90 days (TABULARIUS_TOKEN_DEFAULT_DAYS changes that).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, STORE_EXT } from '../../server/src/index.ts';
import { createStore } from '../../store/src/index.ts';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (...args: string[]) => runCli(main, args);

test('CLI relative token expiry uses the guarded epoch after rollback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-token-clock-'));
  createStore(join(dir, 'Real' + STORE_EXT));
  const host = new Host(dir, () => {});
  try {
    const store = host.get('Real')!;
    store.setPassword('Admin', 'pw-for-tests', '[Full Access]');
    const clockUrl = new URL('../../store/src/clock.ts', import.meta.url).href;
    const preload = `import ${JSON.stringify(clockUrl)}; const wall = Date.now() - 3600_000; Date.now = () => wall;`;
    const result = spawnSync(process.execPath, ['--no-warnings', '--import', `data:text/javascript,${encodeURIComponent(preload)}`, main,
      'token', dir, 'Real', 'create', 'Admin', '--expires-days', String(1 / 48)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(store.apiToken(result.stdout.trim()), 'the new 30-minute token must work immediately');
  } finally {
    host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--expires-days that is not a number of days (above zero, up to 3650) is refused, a good one is accepted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-token-'));
  try {
    createStore(join(dir, 'Real' + STORE_EXT));
    const host = new Host(dir, () => {});
    host.get('Real')!.setPassword('Admin', 'pw-for-tests', '[Full Access]');
    await host.close();
    // Invalid values are rejected before any token is written, so each check is independent.
    const badValues = ['soon', '-3', 'NaN', 'Infinity', '', '0', '0.0', 'never', '3651'];
    const refused = await Promise.all(badValues.map((bad) => cli('token', dir, 'Real', 'create', 'Admin', '--expires-days', bad)));
    for (const [index, bad] of badValues.entries()) {
      const r = refused[index];
      assert.notEqual(r.status, 0, `"${bad}"`);
      assert.match(r.stderr, /--expires-days takes a number of days above zero/, `"${bad}"`);
      assert.equal(r.stdout, '', `no token for "${bad}"`);
    }
    const ok = await cli('token', dir, 'Real', 'create', 'Admin', '--expires-days', '30', '--read-only');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout.trim(), /\S+/);
    assert.match(ok.stderr, /\(read-only\)/, 'the read-only note now shows');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a token made with no --expires-days lives 90 days; the variable changes the default and 0 is not a default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-token-default-'));
  try {
    createStore(join(dir, 'Real' + STORE_EXT));
    const host = new Host(dir, () => {});
    host.get('Real')!.setPassword('Admin', 'pw-for-tests', '[Full Access]');
    await host.close();
    const made = async (extra: string[], env?: NodeJS.ProcessEnv) => {
      const r = await runCli(main, ['token', dir, 'Real', 'create', 'Admin', ...extra], { env: { ...process.env, ...env } });
      assert.equal(r.status, 0, r.stderr);
      const list = await cli('token', dir, 'Real', 'list');
      const token = r.stdout.trim();
      const entry = list.stdout.trim().split('\n').map((l) => JSON.parse(l) as { id: string; expires?: string }).find((t) => token.startsWith(`ohbt_${t.id}.`))!;
      return entry.expires ? (Date.parse(entry.expires) - Date.now()) / 86_400_000 : undefined;
    };
    const days = (await made([]))!;
    assert.ok(Math.abs(days - 90) < 0.1, `${days} days`);
    const thirty = (await made([], { TABULARIUS_TOKEN_DEFAULT_DAYS: '30' }))!;
    assert.ok(Math.abs(thirty - 30) < 0.1, `${thirty} days`);
    const zero = (await made([], { TABULARIUS_TOKEN_DEFAULT_DAYS: '0' }))!;
    assert.ok(Math.abs(zero - 90) < 0.1, `a default of 0 is not a default: ${zero} days`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
