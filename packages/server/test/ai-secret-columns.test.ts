// What a model reads from SQL: a secret is hidden by the table column a result column comes from, not by the name the
// query gave it, and the secret-name list covers the common names without hiding look-alikes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore, Store } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import { rowsForModel, secretName } from '../src/ai-output.ts';

const HIDDEN = '‹hidden from AI tools›';

function withStore(fn: (s: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-secret-columns-'));
  try {
    const path = join(dir, 'Shop.openhbam.sqlite');
    createStore(path);
    const s = new Store(path, 'Shop');
    s.applyDesign([
      { op: 'createTable', name: 'Users', fields: [{ name: 'Name', type: 'text' }, { name: 'Password', type: 'text' }, { name: 'Owner', type: 'text' }] },
      { op: 'createTable', name: 'Notes', fields: [{ name: 'Owner', type: 'text' }, { name: 'Body', type: 'text' }] },
    ]);
    s.create('Users', { Name: 'Ann', Password: 'hunter2-secret', Owner: 'Ann' });
    s.create('Notes', { Owner: 'Ann', Body: 'hello' });
    try {
      fn(s);
    } finally {
      s.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ask = (s: Store, sql: string) => {
  const result = s.queryWithOrigins(sql, 50);
  return rowsForModel(result.rows, result, sql);
};

test('a secret column is hidden whatever the query calls it or wraps it in', () => {
  withStore((s) => {
    for (const sql of [
      'SELECT "Password" FROM Users',
      'SELECT "Password" AS x FROM Users',
      'SELECT substr("Password", 1, 50) AS x FROM Users',
      'SELECT upper(u."Password") AS x FROM Users u',
      'SELECT max("Password") AS x FROM Users',
      'SELECT n.Body, u."Password" AS pw FROM Notes n JOIN Users u ON u.Owner = n.Owner',
      'WITH a AS (SELECT "Password" AS p FROM Users) SELECT p FROM a',
      'SELECT * FROM (SELECT "Password" AS p FROM Users)',
      'SELECT "Name" FROM Users UNION ALL SELECT "Password" FROM Users',
      'SELECT "Name" FROM Users UNION SELECT "Password" FROM Users',
      'SELECT value FROM json_each((SELECT json_group_array("Password") FROM Users))',
      'SELECT value FROM Users, json_each(json_array("Password"))',
      'WITH t(a, b, c, d, e) AS (SELECT * FROM Users) SELECT upper(a) || upper(b) || upper(c) || upper(d) || upper(e) AS x FROM t',
      `WITH t(a, b, c, d, e) AS (SELECT * FROM Users) SELECT d || e || '' AS x FROM t`,
      'SELECT u.* FROM Users u',
      'SELECT * FROM Users',
    ]) {
      const out = JSON.stringify(ask(s, sql));
      assert.doesNotMatch(out, /hunter2/, sql);
      assert.match(out, /hidden from AI tools/, sql);
    }
  });
});

test('an ordinary column is not hidden, even beside a secret one', () => {
  withStore((s) => {
    assert.deepEqual(ask(s, 'SELECT "Name" AS who FROM Users'), [{ who: 'Ann' }]);
    assert.deepEqual(ask(s, 'SELECT "Name" AS who, "Password" AS x FROM Users'), [{ who: 'Ann', x: HIDDEN }]);
    assert.deepEqual(ask(s, 'SELECT n.Body FROM Notes n JOIN Users u ON u.Owner = n.Owner'), [{ Body: 'hello' }]);
    assert.deepEqual(ask(s, 'SELECT COUNT(*) AS n FROM Users'), [{ n: 1 }]);
    assert.deepEqual(ask(s, 'SELECT upper("Name") AS who FROM Users'), [{ who: 'ANN' }]);
    assert.deepEqual(ask(s, 'SELECT count(*) AS n FROM Users'), [{ n: 1 }]);
    assert.deepEqual(ask(s, 'SELECT "Name" FROM Users UNION ALL SELECT "Body" FROM Notes').map((r) => r.Name), ['Ann', 'hello']);
    assert.deepEqual(ask(s, 'SELECT value FROM json_each(json_array(1, 2))').map((r) => r.value), [1, 2]);
  });
});

test('an expression is hidden when its query names a secret field, because its inputs cannot be known', () => {
  withStore((s) => {
    assert.deepEqual(ask(s, `SELECT upper("Name") AS who FROM Users WHERE "Password" <> ''`), [{ who: HIDDEN }]);
  });
});

test('secret names: common ones hidden, look-alikes not', () => {
  for (const name of ['PIN', 'Pin Code', 'user_pin', 'UserPIN', 'SSN', 'ssn_last4', 'Social Security Number', 'CVV', 'cvc2', 'IBAN', 'Card Number', 'CardNo', 'credit_card', 'Security Answer', 'One-Time Code', 'OTP', 'TOTP secret', 'Verification Code', 'Recovery Codes', 'Passcode', 'Users::Pin', 'Pass_word', 'Pincode', 'UserPwd', 'user_pwd', 'Mail User', 'Token', 'Refresh Token', 'ApiToken', 'API Token', 'AccessKey', 'Access Key', 'JWT', 'CardNum', 'CC Number', 'Recovery Phrase', 'MFA Code', 'Reset Code', 'License Key', 'SSH Key', 'Access Code', 'Pass-Code', 'Passwort', 'Routing Number']) {
    assert.ok(secretName(name), name);
  }
  for (const name of ['Spinner', 'Business', 'Business Number', 'Mapping', 'Pinned', 'Opinion', 'Hotpot', 'Okapi Key', 'Libanus', 'Zip Code', 'Product Code', 'Verification Passed', 'Description', 'Name', 'Cardinal', 'Secretary', 'Passport', 'Passenger', 'Compass', 'Bypass', 'Tokenizer', 'Monkey', 'Keyboard', 'Accessory']) {
    assert.ok(!secretName(name), name);
  }
});

test('the sql_query tool hides a renamed, wrapped or united secret', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-secret-tool-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  const host = new Host(dir);
  const store = host.get('Shop')!;
  // Exercise the existing-file redaction behavior; policy-ON refusal has separate regressions.
  store.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  store.applyDesign([{ op: 'createTable', name: 'Users', fields: [{ name: 'Name', type: 'text' }, { name: 'Password', type: 'text' }] }]);
  store.create('Users', { Name: 'Ann', Password: 'hunter2-secret' });
  const server = createMcpServer(host, { admin: true });
  const client = new Client({ name: 'secret-columns-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await server.close();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  for (const sql of ['SELECT "Password" AS x FROM Users', 'SELECT substr("Password", 1, 50) AS x FROM Users', 'SELECT "Name" FROM Users UNION ALL SELECT "Password" FROM Users']) {
    const r = await client.callTool({ name: 'sql_query', arguments: { database: 'Shop', sql } }) as { content: { text: string }[] };
    assert.doesNotMatch(r.content[0].text, /hunter2/, sql);
  }
  const ok = await client.callTool({ name: 'sql_query', arguments: { database: 'Shop', sql: 'SELECT "Name" FROM Users' } }) as { content: { text: string }[] };
  assert.match(ok.content[0].text, /Ann/);
});
