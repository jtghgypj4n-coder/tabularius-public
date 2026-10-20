// Deleting an account also deletes the stand-ins kept for it while AI isolation was on (_fm_pii_vault), and only its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('deleting an account forgets its personal-data stand-ins and leaves the others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-delete-pii-'));
  try {
    const path = join(dir, 'Scratch.sqlite');
    createStore(path);
    const store = new Store(path, 'Scratch');
    try {
      store.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
      store.createAccount('leaver', 'a-long-enough-password', 'Staff');
      store.createAccount('stayer', 'another-long-password', 'Staff');
      store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_pii_vault (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL COLLATE NOCASE,
        kind TEXT NOT NULL, value TEXT NOT NULL, UNIQUE (account, value))`);
      const put = store.sql.prepare('INSERT INTO _fm_pii_vault (account, kind, value) VALUES (?, ?, ?)');
      put.run('leaver', 'name', 'Ada Example');
      put.run('LEAVER', 'email', 'ada@example.test');
      put.run('leaver\u0001{"layouts":["A"]}', 'name', 'Ada Scoped');
      put.run('leaverage', 'name', 'Not Leaver');
      put.run('stayer', 'name', 'Bo Example');
      assert.equal(store.deleteAccount('leaver'), true);
      const left = store.sql.prepare('SELECT account, value FROM _fm_pii_vault ORDER BY id').all() as { account: string; value: string }[];
      assert.deepEqual(left.map((r) => `${r.account}:${r.value}`), ['leaverage:Not Leaver', 'stayer:Bo Example']);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('stand-ins kept in a hosted file that holds the isolation switch go too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-delete-pii-host-'));
  try {
    const mk = (name: string) => { const p = join(dir, `${name}.sqlite`); createStore(p); return new Store(p, name); };
    const main = mk('Main');
    const host = mk('Host');
    try {
      main.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
      main.createAccount('leaver', 'a-long-enough-password', 'Staff');
      main.schema.dataSources.push({ id: 1, name: 'Host', paths: ['Host'] } as never);
      main.resolveFile = (n) => (n === 'Host' ? host : undefined);
      host.resolveFile = (n) => (n === 'Main' ? main : undefined); // a loop must not hang
      host.schema.dataSources.push({ id: 1, name: 'Main', paths: ['Main'] } as never);
      host.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_pii_vault (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL COLLATE NOCASE,
        kind TEXT NOT NULL, value TEXT NOT NULL, UNIQUE (account, value))`);
      const put = host.sql.prepare('INSERT INTO _fm_pii_vault (account, kind, value) VALUES (?, ?, ?)');
      put.run('leaver', 'name', 'Ada Example');
      put.run('stayer', 'name', 'Bo Example');
      put.run('leaver\u0001{"layouts":["A"]}', 'name', 'Ada Scoped');
      put.run('leaver2', 'name', 'Not Leaver');
      assert.equal(main.deleteAccount('leaver'), true);
      const left = host.sql.prepare('SELECT account FROM _fm_pii_vault').all() as { account: string }[];
      assert.deepEqual(left.map((r) => r.account), ['leaver2', 'stayer']);
    } finally {
      main.close();
      host.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});
