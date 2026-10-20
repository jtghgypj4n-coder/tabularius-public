import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORE_EXT } from '../../server/src/index.ts';
import { createStore, Store, totpCode } from '../../store/src/index.ts';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (...args: string[]) => runCli(main, args);

function database(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-failed-actions-'));
  createStore(join(dir, 'Real' + STORE_EXT));
  const store = new Store(join(dir, 'Real' + STORE_EXT), 'Real');
  try {
    store.setPassword('Admin', 'pw-for-tests', '[Full Access]');
  } finally {
    store.close();
  }
  return dir;
}

describe('failed CLI actions', { concurrency: 4 }, () => {
test('token revoke fails on an unknown id and succeeds on an existing token', async () => {
  const dir = database();
  try {
    const bad = await cli('token', dir, 'Real', 'revoke', 'missing');
    assert.equal(bad.status, 1, bad.stderr);
    assert.equal(bad.stderr, 'error: no token missing\n');
    assert.equal(bad.stdout, '');

    const store = new Store(join(dir, 'Real' + STORE_EXT), 'Real');
    let id: string;
    try {
      store.createApiToken('Admin');
      id = store.apiTokens()[0]!.id;
    } finally {
      store.close();
    }
    const ok = await cli('token', dir, 'Real', 'revoke', id);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, `revoked ${id}\n`);
    assert.equal(ok.stderr, '');
    assert.equal((await cli('token', dir, 'Real', 'revoke', id)).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('totp confirm fails on a wrong code and succeeds on the current code', async () => {
  const dir = database();
  try {
    const store = new Store(join(dir, 'Real' + STORE_EXT), 'Real');
    let secret: string;
    try {
      secret = store.enrollTotp('Admin').secret;
    } finally {
      store.close();
    }
    const step = Math.floor(Date.now() / 30_000);
    // Exclude nearby codes too, so crossing a time step cannot make the wrong code valid.
    const codes = new Set(Array.from({ length: 5 }, (_, i) => totpCode(secret, step + i - 2)));
    let wrong = '000000';
    while (codes.has(wrong)) wrong = String(Number(wrong) + 1).padStart(6, '0');
    const bad = await cli('totp', dir, 'Real', 'confirm', 'Admin', wrong);
    assert.equal(bad.status, 1, bad.stderr);
    assert.equal(bad.stderr, 'error: that code did not match; try the current one\n');
    assert.equal(bad.stdout, '');

    const ok = await cli('totp', dir, 'Real', 'confirm', 'Admin', totpCode(secret));
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, 'two-factor sign-in is on for Admin\n');
    assert.equal(ok.stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('totp disable fails without two-factor sign-in and succeeds after enrollment', async () => {
  const dir = database();
  try {
    const bad = await cli('totp', dir, 'Real', 'disable', 'Admin');
    assert.equal(bad.status, 1, bad.stderr);
    assert.equal(bad.stderr, 'error: Admin had no two-factor sign-in\n');
    assert.equal(bad.stdout, '');

    const store = new Store(join(dir, 'Real' + STORE_EXT), 'Real');
    try {
      const { secret } = store.enrollTotp('Admin');
      assert.equal(store.confirmTotp('Admin', totpCode(secret)), true);
    } finally {
      store.close();
    }
    const ok = await cli('totp', dir, 'Real', 'disable', 'Admin');
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, 'two-factor sign-in is off for Admin\n');
    assert.equal(ok.stderr, '');
    assert.equal((await cli('totp', dir, 'Real', 'disable', 'Admin')).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('privileges revoke fails on an absent keyword and succeeds with a case-insensitive match', async () => {
  const dir = database();
  try {
    const bad = await cli('privileges', dir, 'Real', 'revoke', '[Full Access]', 'missing');
    assert.equal(bad.status, 1, bad.stderr);
    assert.equal(bad.stderr, 'error: [Full Access] had no extended privilege "missing"\n');
    assert.equal(bad.stdout, '');

    const grant = await cli('privileges', dir, 'Real', 'grant', '[Full Access]', 'fmmcp');
    assert.equal(grant.status, 0, grant.stderr);
    const ok = await cli('privileges', dir, 'Real', 'revoke', '[Full Access]', 'FMMCP');
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, 'revoked FMMCP from [Full Access]\n');
    assert.equal(ok.stderr, '');
    assert.equal((await cli('privileges', dir, 'Real', 'revoke', '[Full Access]', 'fmmcp')).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
});
