// Connected-client coverage of #1206's crash-point mechanism. Backup/restore
// fault cases belong to r17j-03; this file exercises only hosted lifecycle edges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createServer, request } from 'node:http';
import { writer } from '../../store/src/index.ts';
import { armCrashPointForTest } from '../../store/src/crash-point.ts';
import { Host } from '../src/host.ts';
import { DataApi } from '../src/dataapi.ts';

async function child(dir: string, point: string) {
  const host = new Host(dir);
  const store = host.create('A');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Value' }] }]);
  const api = new DataApi(host);
  const tokens = [api.open(store, 'Admin', 'web'), api.open(store, 'Admin', 'web')];
  let reading!: () => void;
  const waiting = new Promise<void>((r) => { reading = r; });
  const server = createServer((req, res) => {
    if (req.headers['x-held']) req.on('newListener', (event) => {
      if (event === 'data') queueMicrotask(reading);
    });
    void writer.run({}, () => api.handle(req, res, new URL(req.url!, 'http://localhost')));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/fmi/data/vLatest/databases/A/layouts/Items/records`;
  const acknowledged = await Promise.all(tokens.map(async (token, client) => {
    const values: string[] = [];
    for (let n = 0; n < 3; n++) {
      const value = `client-${client}-write-${n}`;
      const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Value: value } }) });
      assert.equal(res.status, 200, await res.text());
      values.push(value);
    }
    return values;
  }));
  // A third write has authenticated and is waiting for its body as the file changes.
  const held = request(url, { method: 'POST', headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json', 'x-held': '1' } });
  held.on('error', () => {});
  held.write('{"fieldData":');
  await waiting;
  store.locks.acquire('Items', 1, tokens[1], 'Admin');
  // Persist only the HTTP acknowledgements, not speculative in-flight changes.
  writeFileSync(join(dir, 'acknowledged.json'), JSON.stringify(acknowledged.flat().sort()));
  if (point.startsWith('host-open:')) host.closeFile('A');
  armCrashPointForTest(point);
  if (point.startsWith('host-open:')) host.openFile('A');
  else if (point.startsWith('host-close:')) host.closeFile('A');
  else store.applyDesign([{ op: 'createField', table: 'Items', name: 'Added' }]);
  throw new Error(`crash point not reached: ${point}`);
}

if (process.argv[2] === 'lifecycle-child') {
  await child(process.argv[3], process.argv[4]);
} else {
  for (const point of [
    'host-close:after-checkpoint', 'host-close:after-close',
    'host-open:before-add', 'host-open:after-add',
    'design-apply:before-commit', 'design-apply:after-commit',
  ]) test(`${point}: connected clients lose no acknowledged writes after process exit`, { timeout: 15_000 }, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'lifecycle-crash-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const dir = join(root, 'live');
    const bin = join(root, 'bin');
    const marker = join(root, 'forbidden-command');
    mkdirSync(dir); mkdirSync(bin);
    for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
      writeFileSync(join(bin, command), '#!/bin/sh\nprintf "%s\\n" "$0" >> "$LIFECYCLE_COMMAND_MARKER"\nexit 99\n', { mode: 0o700 });
    }
    const result = spawnSync(process.execPath, ['--no-warnings', import.meta.filename, 'lifecycle-child', dir, point], {
      encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: bin + delimiter + (process.env.PATH ?? ''), LIFECYCLE_COMMAND_MARKER: marker },
    });
    assert.equal(existsSync(marker), false, existsSync(marker) ? readFileSync(marker, 'utf8') : 'no forbidden commands');
    assert.equal(result.status, 73, result.stderr || result.stdout || String(result.error));
    const expected = JSON.parse(readFileSync(join(dir, 'acknowledged.json'), 'utf8'));
    const host = new Host(dir);
    try {
      const store = host.get('A')!;
      assert.deepEqual(store.find('Items').records.map((r) => r.fieldData.Value).sort(), expected);
      assert.equal(store.sql.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
      if (point.startsWith('design-apply:')) assert.equal(store.schema.tables[0].fields.some((f) => f.name === 'Added'), point.endsWith('after-commit'));
      const api = new DataApi(host);
      assert.equal(api.sessionCount, 0);
      const token = api.open(store, 'Admin', 'web');
      store.locks.acquire('Items', 1, token, 'Admin');
      assert.equal(store.locks.holder('Items', 1)?.owner, token);
      writer.run({ owner: token, account: 'Admin' }, () => store.update('Items', 1, { Value: 'recovered' }));
      api.end(token);
      assert.equal(store.locks.holder('Items', 1), undefined);
      assert.equal(host.closeFile('A'), true);
      assert.equal(host.openFile('A'), true);
      assert.equal(host.get('A')!.get('Items', 1).fieldData.Value, 'recovered');
    } finally { await host.close(); }
  });
}
