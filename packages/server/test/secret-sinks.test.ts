import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, fmExport, saveAsXml } from '../../store/src/index.ts';
import { CredentialRedactor, REDACTED } from '../../scripts/src/redaction.ts';
import { readPluginSecrets } from '../../plugins/src/secrets.ts';
import { errorClass, buildReport, reportMarkdown } from '../../cli/src/corpus-scan.ts';
import { ServerLogs, LOGS, redactPath, serverLog } from '../src/server-logs.ts';
import { faultLog, callerText } from '../src/fault-log.ts';
import { recordForModel, rowsForModel, redactStep, auditForModel } from '../src/ai-output.ts';
import { conversionReport } from '../src/conversion.ts';
import { backupFolder } from '../src/backup.ts';
import { decryptFile } from '../src/encrypt.ts';
import { readBackupInfo } from '../src/backup-info.ts';
import { Connections } from '../src/connections.ts';
import { ChangeFeed, Webhooks } from '../src/changes.ts';
import type { Host } from '../src/host.ts';
import type { DataApi } from '../src/dataapi.ts';
import { S3, scheduleOffsite } from '../src/s3.ts';
import { SECRET_SEEDS } from '../../scripts/test/secret-seeds.ts';

const absent = (output: unknown, secret: string) => {
  const text = typeof output === 'string' ? output : inspect(output, { depth: null });
  assert.ok(!text.includes(secret), 'seeded credential reached the sink');
};
function scratch(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'secret-sinks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function database(t: { after(fn: () => void): void }, dir: string): Store {
  const path = join(dir, 'Example.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => store.close());
  return store;
}

for (const [name, secret] of SECRET_SEEDS) {
  test(`webhook delivery failure logs only its id and endpoint host: ${name}`, async (t) => {
    const dir = scratch(t);
    const store = database(t, dir);
    store.applyDesign([{ op: 'createTable', name: 'Public', fields: [{ name: 'Note', type: 'text' }] }]);
    const host = { dir, get: () => store, openStores: () => [store], onAdd: [] } as unknown as Host;
    const feed = new ChangeFeed(host, {} as DataApi);
    const logs = new ServerLogs(dir);
    t.after(() => logs.close());
    const printed: string[] = [];
    const raw: string[] = [];
    const notify: unknown[] = [];
    logs.onEntry = (...args) => { notify.push(args); };
    const output = serverLog(logs, (line) => printed.push(line));
    const hooks = new Webhooks(host, feed, true, (line) => { raw.push(line); output(line); });
    t.after(() => hooks.stop());
    const url = `https://hooks.example.test:8443/${secret}?unlabelled=${secret}#${secret}`;
    const hook = hooks.create({ database: store.name, url });
    hooks.fetch = async (input) => {
      assert.equal(input, url, 'delivery still receives the configured URL');
      hooks.stop(); // Exercise the terminal failure without waiting through retry backoff.
      throw new Error(`request failed at ${url}`);
    };
    store.create('Public', { Note: 'visible' });
    await hooks.flush();
    logs.close();
    assert.equal(raw.length, 1);
    assert.ok(raw[0].includes(`webhook ${hook.id} (https://hooks.example.test:8443): dropped 1 changes`));
    assert.ok(printed[0].includes(`webhook ${hook.id} (https://hooks.example.test:8443): dropped 1 changes`));
    for (const sink of [raw, printed, notify, readFileSync(join(logs.dir, 'Event.log'), 'utf8')]) absent(sink, secret);
  });

  test(`configured endpoint URLs in diagnostics expose only scheme and host: ${name}`, (t) => {
    const logs = new ServerLogs(scratch(t));
    const printed: string[] = [];
    const notify: unknown[] = [];
    logs.onEntry = (...args) => { notify.push(args); };
    const log = serverLog(logs, (line) => printed.push(line));
    for (const scheme of ['https', 'http', 's3', 'smtp', 'smtps', 'ldap', 'ldaps', 'postgresql', 'mysql']) {
      log(`endpoint ${scheme}://${secret}:${secret}@service.example.test/pre)'${secret}?plain=${secret}#${secret} failed`);
      assert.equal(printed.at(-1), `endpoint ${scheme}://service.example.test failed`);
    }
    logs.close();
    for (const sink of [printed, notify, readFileSync(join(logs.dir, 'Event.log'), 'utf8')]) absent(sink, secret);
  });

  test(`S3 failure callback removes endpoint URL secrets: ${name}`, async (t) => {
    const dir = scratch(t);
    const lines: string[] = [];
    const s3 = new S3({ url: 's3://test-bucket', accessKey: 'synthetic-access', secretKey: secret });
    s3.list = async () => { throw new Error(`failed https://s3.example.test/${secret}?plain=${secret}`); };
    const schedule = scheduleOffsite(dir, s3, { every: 60_000, log: (line) => lines.push(line) });
    await schedule.stop();
    assert.deepEqual(lines, ['off-site backup failed: failed https://s3.example.test']);
    absent(lines, secret);
  });

  test(`request paths redact conventional secret parameters without hiding secretary: ${name}`, () => {
    for (const key of [name, 'sig', 'signature', 'key', 'token', 'code', 'X-Amz-Signature', 'X-Amz-Credential']) {
      for (const encoded of [key, key.toUpperCase(), [...key].map((c) => '%' + c.charCodeAt(0).toString(16)).join('')]) {
        const path = `/request?${encoded}=${secret}&secretary=bob&monkey=banana`;
        assert.equal(redactPath(path), `/request?${encoded}=…&secretary=bob&monkey=banana`);
      }
    }
    assert.equal(redactPath(`/request?api+key=${secret}&secretary=bob`), '/request?api+key=…&secretary=bob');
  });

  test(`validation diagnostics retain the field and expected type: ${name}`, (t) => {
    const logs = new ServerLogs(scratch(t));
    const printed: string[] = [];
    const log = serverLog(logs, (line) => printed.push(line));
    const explanation = 'Invalid value for field Token: expected number';
    log(explanation);
    log(`${explanation}; ${name}=${secret}`);
    logs.close();
    assert.equal(printed[0], explanation);
    assert.equal(printed[1], `${explanation}; ${name}=${REDACTED}`);
    const persisted = readFileSync(join(logs.dir, 'Event.log'), 'utf8');
    assert.ok(persisted.includes(explanation));
    absent(persisted, secret);
  });

  test(`logs and notification callback: ${name}`, (t) => {
    const dir = scratch(t);
    const logs = new ServerLogs(dir);
    const notifications: unknown[] = [];
    logs.onEntry = (...args) => { notifications.push(args); };
    for (const log of LOGS) logs.write(log, 'Error', 'test', `${name}=${secret}`);
    const printed: string[] = [];
    serverLog(logs, (message) => printed.push(message))(`${name}=${secret}`);
    absent(printed, secret);
    logs.event('Information', 'ordinary diagnostic');
    logs.close();
    for (const log of LOGS) absent(readFileSync(join(logs.dir, `${log}.log`), 'utf8'), secret);
    absent(notifications, secret);
    assert.match(readFileSync(join(logs.dir, 'Event.log'), 'utf8'), /ordinary diagnostic/);
    absent(redactPath(`/fmi/data/vLatest/databases/App/sessions/${secret}`), secret);
    absent(redactPath(`/request?${name}=${secret}`), secret);
    absent(redactPath(`/request?${[...name].map((c) => '%' + c.charCodeAt(0).toString(16)).join('')}=${secret}`), secret);
    const faults: unknown[] = [];
    const error = Object.assign(new Error(`${name}=${secret}`, { cause: new Error(secret) }), { privateValue: secret });
    faultLog((value) => faults.push(value))(error);
    absent(faults, secret);
  });

  test(`error text and malformed credential/backup files: ${name}`, (t) => {
    absent(callerText(new Error(`${name}=${secret}`)), secret);
    const dir = scratch(t);
    mkdirSync(join(dir, 'plugins', 'secrets'), { recursive: true });
    writeFileSync(join(dir, 'plugins', 'secrets', 'test.json'), `{"key":"${secret}" INVALID`, { mode: 0o600 });
    assert.throws(() => readPluginSecrets(dir, 'test'), (error) => {
      absent(inspect(error, { depth: null }), secret);
      assert.match(String(error), /isn't JSON/);
      return true;
    });
    writeFileSync(join(dir, 'backup.json'), `{"key":"${secret}" INVALID`);
    assert.throws(() => readBackupInfo(dir), (error) => { absent(inspect(error), secret); return true; });
  });

  test(`persisted record and security audit rows: ${name}`, (t) => {
    const store = database(t, scratch(t));
    store.applyDesign([{ op: 'createTable', name: 'Secrets', fields: [{ name, type: 'text' }, { name: 'Public', type: 'text' }] }]);
    store.setAuditSettings({ redactSensitive: true });
    const { recordId } = store.create('Secrets', { [name]: secret, Public: 'visible' });
    store.update('Secrets', recordId, { [name]: `${secret}-changed` });
    store.delete('Secrets', recordId);
    store.setPassword('operator', secret, '[Full Access]');
    const audit = store.auditLog({ table: 'Secrets' });
    assert.equal(audit.length, 3);
    assert.equal(audit[0].changes?.Public, 'visible');
    absent(audit, secret);
    absent(store.securityEvents(), secret);
    // Inspect the persisted JSON too, not just the reader's projection.
    absent(store.sql.prepare('SELECT changes FROM _fm_audit').all(), secret);
  });

  test(`exports: authentication material excluded from owner bundle and XML: ${name}`, (t) => {
    const store = database(t, scratch(t));
    store.setPassword('operator', secret, '[Full Access]');
    const schema = structuredClone(store.schema);
    schema.accounts = [{ id: 42, name: 'operator', passwordVerifier: secret } as never];
    absent(saveAsXml(schema), secret);
    const bundle = fmExport(store);
    absent(bundle, secret);
    assert.ok(bundle.files.some((f) => f.path === 'manifest.json'));
  });

  test(`conversion JSON and summary: ${name}`, (t) => {
    const store = database(t, scratch(t));
    store.applyDesign([{ op: 'createScript', name: 'Probe', text:
      `Set Variable [ $${name} ; Value: "${secret}" ]\nSet Variable [ $public ; Value: <Field Missing> & "${secret}" ]` }]);
    const result = conversionReport(store);
    assert.ok(result.broken.length > 0 || result.unparsed.length > 0, 'exercised a formula diagnostic');
    absent(result, secret);
    assert.match(result.summary, /Conversion report/);
  });

  test(`corpus JSON and Markdown, including unlabelled decoder echoes: ${name}`, () => {
    const error = errorClass(new Error(secret));
    const report = buildReport(1, 100, [{ id: 'content-hash', sizeMB: 0, copies: 1, scan: { status: 'failed', error } }]);
    absent(report, secret);
    absent(reportMarkdown(report), secret);
    assert.equal(report.files.unique, 1);
  });

  for (const [sink, output] of [
    ['record', () => recordForModel({ fieldData: { Copy: secret, [name]: secret, Public: 'visible' } })],
    ['step', () => redactStep({ params: { Copy: secret, [name]: [secret] }, publicNumber: 42 })],
    ['audit', () => auditForModel([{ seq: 1, at: '', account: null, kind: 'update', table: 'T', changes: { Copy: secret, [name]: [secret, `${secret}-changed`], Public: 'visible' } }])],
    ['SQL', () => rowsForModel([{ alias: secret }], { columns: [{ name: 'alias', origin: name }], tables: [] } as never, `SELECT "${name}" AS alias FROM T`)],
  ] as const) test(`AI tool ${sink} output: ${name}`, () => absent(output(), secret));

  test(`web client connection state and saved test results: ${name}`, async (t) => {
    const dir = scratch(t);
    const logs: string[] = [];
    const connections = new Connections(dir, (line) => logs.push(line));
    const c = connections.create({ name: 'test', type: 'rest', config: { baseUrl: 'https://example.com', auth: 'bearer' } });
    connections.setSecret(c.id, 'token', secret);
    connections.io = { fetch: async () => { throw new Error(`upstream echoed ${secret}`); } };
    const result = await connections.test(c.id);
    assert.equal(result.ok, false);
    absent(result, secret);
    absent(connections.list(), secret);
    absent(logs, secret);
    absent(readFileSync(join(dir, '.openhbam-connections.json'), 'utf8'), secret);
    absent(readFileSync(join(dir, '.openhbam-connection-secrets.json'), 'utf8'), secret);
  });
}

test('encrypted backups and external containers: every seeded credential stays out of bytes and metadata', async (t) => {
  const dir = scratch(t);
  const store = database(t, dir);
  store.applyDesign([{ op: 'createTable', name: 'Secrets', fields: SECRET_SEEDS.map(([name]) => ({ name, type: 'text' })) }]);
  store.create('Secrets', Object.fromEntries(SECRET_SEEDS));
  const containers = join(dir, 'Files', 'Example');
  mkdirSync(containers, { recursive: true });
  writeFileSync(join(containers, 'example.txt'), JSON.stringify(Object.fromEntries(SECRET_SEEDS)));
  const passphrase = SECRET_SEEDS[3][1];
  const backup = await backupFolder(dir, join(dir, 'Backups'), 7, passphrase);
  const files = readdirSync(backup.dir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
  for (const file of files) {
    const bytes = readFileSync(join(file.parentPath, file.name));
    for (const [, secret] of SECRET_SEEDS) assert.equal(bytes.includes(Buffer.from(secret)), false, file.name);
    assert.equal(bytes.includes(Buffer.from(passphrase)), false);
  }
  const restored = join(dir, 'restored.sqlite');
  await decryptFile(join(backup.dir, 'Example.openhbam.sqlite.enc'), restored, passphrase);
  const opened = new Store(restored);
  try {
    const row = opened.sql.prepare('SELECT * FROM Secrets').get();
    assert.ok(row);
    for (const [, secret] of SECRET_SEEDS) assert.ok(Object.values(row).includes(secret), 'backup still restores credential data');
  } finally { opened.close(); }
});

test('shared PR #1207 redactor discovers aliases before emitting and preserves public types', () => {
  const redactor = new CredentialRedactor();
  const out = redactor.data({ Copy: SECRET_SEEDS[0][1], Password: SECRET_SEEDS[0][1], Count: 42, Blank: null });
  assert.deepEqual(out, { Copy: REDACTED, Password: REDACTED, Count: 42, Blank: null });
  const short = new CredentialRedactor();
  for (const value of ['a', 'e', 'x.*']) short.remember(value);
  assert.equal(short.text('a e x.*'), `${REDACTED} ${REDACTED} ${REDACTED}`, 'replacement markers are never reprocessed as secrets');
});
