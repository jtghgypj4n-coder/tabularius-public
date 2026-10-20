import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { Host } from '../src/host.ts';
import { conversionFor, conversionReport } from '../src/conversion.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const files = ['Standards.fmp12', 'PortableCode39-2.fmp12', 'Charts.fmp12'];
const skip = files.every((f) => existsSync(join(fixtures, f))) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let host: Host;
let server: Server;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-conversion-'));
  for (const f of files) copyFileSync(join(fixtures, f), join(dir, f));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  // Standards' own steps all run now; one that doesn't yet, for the report to list.
  host.get('Standards')!.applyDesign([{ op: 'createScript', name: 'Password', text: 'Check Record' }]);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

test('conversion report: steps the engine can\'t run, accounts without a password', { skip }, () => {
  const r = conversionReport(host.get('Standards')!, host.names());
  assert.deepEqual(r.steps.notYet.map((i) => i.name), ['Check Record']);
  assert.match(r.steps.notYet[0].where[0], /^Script ".+", line \d+$/);
  // Comments are not steps that fail; the guest account needs no password.
  assert.ok(!r.steps.notYet.some((i) => i.name.startsWith('#')));
  assert.deepEqual(r.accounts.withoutPassword, ['Admin']);
  assert.match(r.summary, /Script steps not available yet\*\*: Check Record \(1\)/);
  assert.match(r.summary, /Screen-only steps/);
});

test('conversion report: an account with a real (non-blank) FileMaker password that can\'t be verified is still reported', { skip }, () => {
  const store = host.get('Standards')!;
  // A genuine non-blank FileMaker password, reconstructed the way the fmp12 reader shapes one (see
  // fmp12/src/schema.ts): byte 0 is 0x01, then a 10-byte salt and a 20-byte PBKDF2 digest. With the digest left
  // as zeros, checkFmp12Password('', verifier) is false — it's "has a password" in FileMaker, just not one
  // Tabularius can verify. Before the fix, store.accounts()' hasPassword treated any account that ever had a
  // passwordVerifier as "has a password" regardless of whether it could be verified, so this exact shape went
  // unreported as fine — the gap found converting a real file.
  const verifier = `01${'00'.repeat(30)}`;
  store.sql.prepare(`INSERT INTO _fm_accounts (name, password_hash, source) VALUES ('realpw', NULL, 'fmp12')`).run();
  store.schema.accounts.push({ id: 9_999_001, name: 'realpw', passwordVerifier: verifier });
  try {
    const r = conversionReport(store, host.names());
    assert.ok(r.accounts.withoutPassword.includes('realpw'), 'reported alongside Admin, not silently treated as fine');
    assert.ok(!r.accounts.blankPassword.includes('realpw'), 'not the blank-password case: this verifier does not pass the empty-password check');
    assert.match(r.summary, /Accounts without a password\*\*: .*realpw/);
  } finally {
    store.sql.prepare(`DELETE FROM _fm_accounts WHERE name = 'realpw'`).run();
    store.schema.accounts.pop();
  }
});

test('conversion report: network steps, broken references', { skip }, () => {
  const store = host.get('PortableCode39-2')!;
  const r = conversionReport(store, host.names());
  assert.deepEqual(r.steps.network.map((i) => [i.name, i.count]), [['Insert from URL', 1]]);
  assert.ok(r.broken.length > 0 && r.broken.every((b) => /missing|unknown/i.test(b.text)));
  assert.match(r.summary, /Reach the network/);
});

test('MCP: conversion_report', { skip }, async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'conversion_report', arguments: { database: 'Standards' } } }),
  });
  const r = JSON.parse((await res.json()).result.content[0].text);
  assert.equal(r.database, 'Standards');
  assert.match(r.summary, /^# Conversion report: Standards/);
});

test('design API: the report, for [Full Access] only', { skip }, async () => {
  const store = host.get('Standards')!;
  store.setPassword('Admin', 'pw');
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Standards/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}',
  });
  const token = (await login.json()).response.token;
  const r = await fetch(`${base}/tabularius/design/v1/databases/Standards/report`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const { report } = await r.json();
  assert.deepEqual(report.steps.notYet.map((i: { name: string }) => i.name), ['Check Record']);
  assert.deepEqual(report.accounts.withoutPassword, []);
  const anon = await fetch(`${base}/tabularius/design/v1/databases/Standards/report`);
  assert.equal(anon.status, 401);
});

test('missing references inside calculation comments are not broken', async () => {
  const { withoutComments } = await import('../src/conversion.ts');
  assert.equal(withoutComments('/*Let ( t = <Field Missing> ; 1 )*/'), ' ');
  assert.equal(withoutComments('1 /* a /* nested */ <Field Missing> */ + 2'), '1   + 2');
  assert.equal(withoutComments('x // <Field Missing>\r+ <Table Missing>::y'), 'x \r+ <Table Missing>::y');
  assert.equal(withoutComments('"/* kept */ // kept" & "\\"//"'), '"/* kept */ // kept" & "\\"//"');
});

test('conversion report: custom function parameters with spaces parse', { skip }, () => {
  const store = host.get('Charts')!;
  store.applyDesign([{ op: 'createCustomFunction', name: 'Pressed', parameters: ['key code'], formula: 'Mod ( Div ( Get ( TriggerModifierKeys ) ; key code ) ; 2 )' }]);
  const report = conversionReport(store);
  assert.deepEqual(report.unparsed.filter((u) => u.where.includes('Pressed')), []);
});

test('conversion report: accounts and privilege sets imported, with the whole-file-level caveat', { skip }, () => {
  const r = conversionReport(host.get('Standards')!, host.names());
  // The file's standard sets came across, with their record-access summary.
  const full = r.privileges.sets.find((s) => s.name === '[Full Access]');
  assert.ok(full && full.records === 'full access', 'full access is summarised');
  assert.ok(r.privileges.sets.some((s) => s.records === 'view'), 'a view-only set is summarised');
  // Each account maps to a set; none is left without one here.
  assert.ok(r.privileges.assignments.some((a) => a.account === 'Admin' && a.privilegeSet === '[Full Access]'));
  assert.deepEqual(r.privileges.withoutSet, []);
  // Standards has only the three built-in sets, which carry no custom per-table
  // detail, so it is NOT reported as coarsened and gets no whole-file caveat —
  // the sets are still listed. (A file with its own set is covered in
  // conversion-coarsened.test.ts.)
  assert.equal(r.privileges.coarsened, false);
  assert.match(r.summary, /Privilege sets imported/);
  assert.doesNotMatch(r.summary, /whole-file level/);
});

test('conversion report: an account with no privilege set is flagged as unable to sign in', { skip }, () => {
  const store = host.get('Charts')!;
  store.setPassword('orphan', 'pw'); // a password but no privilege set
  try {
    const r = conversionReport(store, host.names());
    assert.ok(r.privileges.withoutSet.includes('orphan'), 'the account with no set is flagged');
    assert.match(r.summary, /Accounts with no privilege set.*orphan/);
  } finally {
    store.deleteAccount('orphan');
  }
});

test('why one thing doesn\'t work: every place in it, and the scripts it performs', { skip }, async () => {
  const store = host.get('Standards')!;
  store.applyDesign([
    { op: 'createScript', name: 'Mail out', text: 'Send Mail [ Send via E-mail Client ; With dialog: Off ; To: "a@example.com" ]\nSet Variable [ $x ; Value: Acme_Encode ( "x" ) ]\nPerform Script [ "Password" ]' },
  ]);
  const why = conversionFor(store, host.names(), 'Mail out');
  assert.match(why, /^# script Mail out/);
  assert.match(why, /Send Mail \(Sends only when switched on: Tabularius sends no email by default\): line 1/);
  assert.match(why, /Acme_Encode \(Plug-in functions[^)]*\): line 2/);
  assert.match(why, /performs scripts with problems of their own: Password/);
  assert.match(conversionFor(store, host.names(), 'Password'), /Check Record \(Script steps not available yet[^)]*\): line 1/);
  assert.throws(() => conversionFor(store, host.names(), 'No such thing'), /Nothing named "No such thing"/);

  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'conversion_report', arguments: { database: 'Standards', item: 'Mail out' } } }),
  });
  assert.match((await res.json()).result.content[0].text, /Sends only when switched on/);
});

test('conversion report: plug-in functions without parameters are counted', { skip }, () => {
  const store = host.get('Charts')!;
  store.applyDesign([{ op: 'createScript', name: 'Mail check', text: 'If [ GetAsNumber ( EmailVersion ) < 1.61 ]\nSet Variable [ $x ; Value: EmailReadMessageValue ( "from" ) ]\nEnd If' }]);
  const names = conversionReport(store).functions.plugIns.map((p) => p.name);
  assert.ok(names.includes('EmailVersion'), names.join());
  assert.ok(names.includes('EmailReadMessageValue'), names.join());
});
