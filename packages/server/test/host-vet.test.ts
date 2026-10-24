import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { Admin } from '../src/admin.ts';
import type { DataApi } from '../src/dataapi.ts';
import { Host, STORE_EXT } from '../src/host.ts';
import { HOSTED_RECORD_FILE, loadHostedRecord } from '../src/hosted-record.ts';

function folder(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'host-vet-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('first start approves existing files, later discoveries and renamed copies are held', async (t) => {
  const dir = folder(t);
  createStore(join(dir, 'A' + STORE_EXT));
  let host = new Host(dir);
  assert.equal(host.isHeld('A'), false);
  assert.equal(loadHostedRecord(dir)?.files.a.how, 'first-start');
  const id = host.get('A')!.fileId;
  await host.close();
  createStore(join(dir, 'B' + STORE_EXT));
  copyFileSync(join(dir, 'A' + STORE_EXT), join(dir, 'Copy' + STORE_EXT));
  host = new Host(dir);
  assert.equal(host.isHeld('A'), false);
  assert.equal(host.get('A')!.fileId, id);
  assert.equal(host.get('Copy')!.fileId, id);
  assert.equal(host.isHeld('B'), true);
  assert.equal(host.isHeld('Copy'), true);
  assert.equal(host.heldFiles().length, 2);
  assert.equal(host.files().find((f) => f.name === 'B')?.held?.reason, 'not seen before');
  const status = new Admin(host, { list: () => [] } as unknown as DataApi).status();
  assert.equal(status.databases.find((f) => f.name === 'B')?.held?.reason, 'not seen before');
  await host.close();
});

test('swapped identity is held; reopen and approval use the saved record', async (t) => {
  const dir = folder(t);
  createStore(join(dir, 'A' + STORE_EXT));
  let host = new Host(dir);
  const old = host.get('A')!.fileId;
  await host.close();
  rmSync(join(dir, 'A' + STORE_EXT));
  createStore(join(dir, 'A' + STORE_EXT));
  host = new Host(dir);
  assert.notEqual(host.get('A')!.fileId, old);
  assert.equal(host.get('A')!.held?.reason, 'a different file than the one approved');
  let calls = 0;
  host.onApprove.add(() => { calls++; });
  host.approve('A', 'operator');
  assert.equal(host.isHeld('A'), false);
  assert.equal(calls, 1);
  assert.equal(loadHostedRecord(dir)?.files.a.how, 'admin');
  assert.equal(host.closeFile('A'), true);
  assert.equal(host.openFile('A'), true);
  assert.equal(host.isHeld('A'), false);
  await host.close();
});

test('damaged record stays untouched, including after a trusted create', async (t) => {
  const dir = folder(t);
  createStore(join(dir, 'A' + STORE_EXT));
  const path = join(dir, HOSTED_RECORD_FILE);
  writeFileSync(path, '{');
  const log: string[] = [];
  const host = new Host(dir, (line) => log.push(line));
  assert.equal(host.get('A')!.held?.reason, 'the approval record is damaged');
  const made = host.create('B');
  assert.equal(made.held?.reason, 'the approval record is damaged');
  assert.throws(() => host.approve('A', 'operator'), /damaged/);
  assert.equal(readFileSync(path, 'utf8'), '{');
  assert.ok(log.some((line) => line.includes('move it aside to start fresh')));
  await host.close();
});

test('a failed approval write leaves trusted files held; a follower never writes', async (t) => {
  const dir = folder(t);
  let host = new Host(dir);
  await host.close();
  mkdirSync(join(dir, HOSTED_RECORD_FILE + '.tmp'));
  host = new Host(dir);
  const made = host.create('Created');
  assert.equal(made.held?.reason, 'not seen before');
  assert.throws(() => host.approve('Created', 'operator'));
  assert.equal(host.isHeld('Created'), true);
  await host.close();
  const before = readFileSync(join(dir, HOSTED_RECORD_FILE));
  const follower = new Host(dir, () => {}, { follower: true });
  assert.equal(follower.isHeld('Created'), true);
  assert.equal(readFileSync(join(dir, HOSTED_RECORD_FILE)).equals(before), true);
  await follower.close();
});

test('trusted upload and restore-copy origins are saved with their source', async (t) => {
  const dir = folder(t);
  const host = new Host(dir);
  for (const [name, how] of [['Upload', 'upload'], ['Restored', 'restore']] as const) {
    const path = join(dir, name + STORE_EXT);
    createStore(path);
    const store = host.add(path, 'trusted', how);
    assert.equal(store.held, undefined);
    assert.equal(loadHostedRecord(dir)?.files[name.toLowerCase()].how, how);
  }
  await host.close();
});
