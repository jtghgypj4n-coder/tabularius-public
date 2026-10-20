// A file written before the lookalike refusal can hold two accounts that share one sign-in lockout bucket; opening it says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';

test('opening a file whose accounts share a lockout bucket logs the pair, once per pair', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lockout-pairs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const seed = new Store(path, 'Shop');
  for (const name of ['Jos\u00e9', 'Jose\u0301', 'Other']) seed.sql.prepare("INSERT INTO _fm_accounts (name, source, privilege_set) VALUES (?, 'openhbam', 'Staff')").run(name);
  seed.close();
  const logs: string[] = [];
  const host = new Host(dir, (line) => logs.push(line));
  t.after(() => { for (const s of host.openStores()) s.close(); });
  const warned = logs.filter((l) => /share one sign-in lockout/.test(l));
  assert.equal(warned.length, 1);
  assert.match(warned[0], /^Shop: the accounts "Jose\u0301" and "Jos\u00e9" share one sign-in lockout/);
  assert.match(warned[0], /tabularius doctor/);
});
