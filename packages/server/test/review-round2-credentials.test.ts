import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { summarizeRecords } from '../src/summarize.ts';
import { recordForModel, HIDDEN_VALUE, secretName, storedSecretValues, containsSecret } from '../src/ai-output.ts';
import { ScimDirectory } from '../src/scim.ts';
import { Connections } from '../src/connections.ts';
import { encryptFileSync, decryptFileSync } from '../src/encrypt.ts';
import { hashPassword, checkPassword, checkPasswordAsync } from '../../store/src/index.ts';

test('round2: stored and unstored summaries use the same Unicode secret-copy policy as records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-review-summary-'));
  const host = new Host(dir, () => {}, { background: false });
  try {
    const store = host.create('Review');
    store.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'Password' }, { name: 'Copy' }] },
      { op: 'createField', table: 'T', name: 'Live', kind: 'calculation', type: 'text', calculation: 'Copy', options: { unstored: true } },
    ]);
    // Non-ASCII case, JS whitespace, UTF-16 threshold and embedded copies.
    const pairs = [['ÉlanQ7x9', 'ÉLANQ7X9'], ['ЖукQ7x94', 'ЖУКQ7X94'], ['\tQ7x94v2z\n', 'Q7x94v2z'], ['😀🦊', '😀🦊'], ['😀🦊🦉🐟', 'prefix 😀🦊🦉🐟 suffix']];
    for (const [secret, copy] of pairs) {
      const row = store.create('T', { Password: secret, Copy: copy });
      assert.equal(recordForModel(store.get('T', row.recordId)).fieldData.Copy, HIDDEN_VALUE);
    }
    for (const field of ['Copy', 'Live']) {
      const summary = summarizeRecords(store, { layout: 'T', groupBy: [field], measures: [{ field, fn: 'max' }, { field, fn: 'count' }] }, undefined, undefined, true);
      assert.equal(summary.foundCount, pairs.length);
      assert.ok(summary.groups!.every((group) => group.values[field] === HIDDEN_VALUE), field);
      assert.equal(summary.totals[`max(${field})`], null, field);
      assert.equal(summary.totals[`count(${field})`], pairs.length);
    }
    assert.ok(summarizeRecords(store, { layout: 'T', groupBy: ['Copy'] }).groups!.every((group) => group.values.Copy !== HIDDEN_VALUE));
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('round2: SCIM rotation is file-scoped and persists across reopening', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-review-scim-'));
  let host = new Host(dir, () => {}, { background: false });
  try {
    const a = new ScimDirectory(host.create('A'));
    const b = new ScimDirectory(host.create('B'));
    const old = a.issueToken({}), other = b.issueToken({}), fresh = a.issueToken({});
    assert.equal(a.tokenValid(old), false);
    assert.equal(b.tokenValid(fresh), false);
    await host.close();
    host = new Host(dir, () => {}, { background: false });
    const reopened = new ScimDirectory(host.get('A')!);
    assert.equal(reopened.tokenValid(old), false);
    assert.equal(reopened.tokenValid(fresh), true);
    assert.equal(reopened.tokenValid(fresh + '\u200b'), false);
    assert.equal(new ScimDirectory(host.get('B')!).tokenValid(other), true);
    reopened.revokeToken();
    assert.equal(reopened.tokenValid(fresh), false);
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('round2: compatibility and decomposed credential names remain masked without hiding ordinary names', () => {
  for (const name of ['Ｐａｓｓｗｏｒｄ', 'contrasen\u0303a', 'API\u200d Key', 'Mot—de—passe']) {
    assert.equal(secretName(name), true);
    assert.equal(recordForModel({ fieldData: { [name]: 'synthetic-value' } }).fieldData[name], HIDDEN_VALUE);
  }
  for (const name of ['Épinard', 'Okapi Key', 'Secretary']) assert.equal(secretName(name), false);
});

test('round2: model preview discovery learns Unicode credentials across tables and globals', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-review-preview-'));
  const host = new Host(dir, () => {}, { background: false });
  try {
    const store = host.create('Preview');
    store.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'Password' }, { name: 'Note' }] },
      { op: 'createTable', name: 'Other', fields: [{ name: 'Contraseña' }] },
      { op: 'createField', table: 'T', name: 'ApiKey', type: 'text', options: { global: true } },
    ]);
    store.create('T', { Password: 'Élan-47🦊Qx', Note: 'ordinary-note', ApiKey: 'Жук-91🐟Qx' });
    store.create('Other', { Contraseña: 'Café-93🦉Qx' });
    const secrets = storedSecretValues(store);
    for (const value of ['Élan-47🦊Qx', 'Café-93🦉Qx', 'Жук-91🐟Qx']) assert.equal(containsSecret(value.toUpperCase(), secrets), true);
    assert.equal(containsSecret('ordinary-note', secrets), false);
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('round2: interleaved vault writers preserve secret rotation and deletion after reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-review-vault-'));
  const logs: string[] = [];
  try {
    const first = new Connections(dir, (message) => { logs.push(message); });
    const second = new Connections(dir, (message) => { logs.push(message); });
    first.create({ name: 'A', type: 'rest', config: { baseUrl: 'https://example.test', auth: 'bearer' } });
    second.create({ name: 'B', type: 'rest', config: { baseUrl: 'https://example.test', auth: 'bearer' } });
    first.setSecret('A', 'token', 'synthetic-before');
    second.setSecret('B', 'token', 'synthetic-independent');
    second.setSecret('A', 'token', 'synthetic-after');
    first.approve('A'); second.approve('B');
    const reopened = new Connections(dir);
    assert.equal(reopened.use('A').secrets.token, 'synthetic-after');
    assert.equal(reopened.use('B').secrets.token, 'synthetic-independent');
    first.remove('A');
    assert.throws(() => reopened.use('A'));
    assert.equal(new Connections(dir).use('B').secrets.token, 'synthetic-independent');
    assert.ok(!logs.join('\n').includes('synthetic-'));
    assert.ok(!readFileSync(join(dir, '.openhbam-connection-secrets.json'), 'utf8').includes('synthetic-'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('round2 baseline: password hashes salt independently and preserve Unicode and NUL boundaries', async () => {
  const password = 'é\u0000🦊synthetic';
  const a = hashPassword(password), b = hashPassword(password);
  assert.notEqual(a, b);
  for (const hash of [a, b]) {
    assert.equal(checkPassword(password, hash), true);
    assert.equal(await checkPasswordAsync(password, hash), true);
    for (const wrong of ['é', 'e\u0301\u0000🦊synthetic', password + 'x']) assert.equal(checkPassword(wrong, hash), false);
  }
});

test('round2 baseline: authenticated encryption refuses a changed ciphertext and wrong key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-review-crypto-'));
  try {
    const plain = join(dir, 'plain'), encrypted = join(dir, 'sealed'), output = join(dir, 'opened');
    const value = Buffer.from('synthetic\u0000🦊'.repeat(40));
    writeFileSync(plain, value);
    encryptFileSync(plain, encrypted, 'synthetic-key');
    decryptFileSync(encrypted, output, 'synthetic-key');
    assert.deepEqual(readFileSync(output), value);
    assert.throws(() => decryptFileSync(encrypted, output, 'other-key'));
    const bytes = readFileSync(encrypted);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(encrypted, bytes);
    assert.throws(() => decryptFileSync(encrypted, output, 'synthetic-key'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
