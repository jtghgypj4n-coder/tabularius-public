// Moving off plug-ins: migration_plan finds every plug-in call with its native replacement, and a rewritten
// script is tried offline on a copy, so its Send Mail reaches no one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-migration-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ mcpToken: 'test-admin-token', dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

let id = 0;
async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; value: any }> {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Bearer test-admin-token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: { database: 'Charts', ...args } } }),
  });
  const result = (await r.json()).result;
  const text = result.content[0].text as string;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  return { isError: !!result.isError, text, value };
}

const SEND = [
  'Set Variable [ $ok ; Value: EmailRegister ( "licence" ; "Company" ) ]',
  'Set Variable [ $m ; Value: EmailCreate ( "office@example.com" ; "client@example.com" ; "Your invoice" ) ]',
  'Set Variable [ $b ; Value: EmailSetBody ( "Please find it attached." ; "plain" ) ]',
  'Set Variable [ $sent ; Value: EmailSend ( "" ) ]',
  'If [ $sent = "ERROR" ]',
  'Show Custom Dialog [ "Mail failed" ; EmailLastError ( "" ) ]',
  'End If',
].join('\n');

test('migration_plan: every plug-in call, grouped, with its native replacement and the scripts to rewrite', { skip }, async () => {
  const c = await call('change_design', { changes: [
    { op: 'createScript', name: 'Send invoice', text: SEND },
    { op: 'createScript', name: 'Read inbox', text: 'Set Variable [ $n ; Value: EmailReadMessages ( "mailbox=INBOX" ; "max=10" ) ]' },
    { op: 'createScript', name: 'Fetch rates', text: 'Set Variable [ $r ; Value: MBS ( "CURL.Perform" ; $curl ) ]\nSet Variable [ $j ; Value: MBS ( "JSON.Format" ; $r ) ]' },
    { op: 'createField', table: 'Congress', name: 'Party JSON', kind: 'calculation', type: 'text', calculation: 'BE_JSONPath ( "{\\"p\\":1}" ; "$.p" )' },
  ] });
  assert.ok(!c.isError, c.text);
  const plan = (await call('migration_plan', {})).value;
  const mail = plan.plugIns.find((p: { plugIn: string }) => p.plugIn === '360Works Email');
  const by = (name: string) => mail.calls.find((x: { call: string }) => x.call === name);
  assert.match(by('EmailSend').native, /^Send Mail \[ Send via SMTP Server/);
  assert.match(by('EmailSend').native, /sends no mail/);
  assert.deepEqual(by('EmailSend').where, ['Script "Send invoice", line 4']);
  assert.match(by('EmailRegister').native, /needs no registration/);
  assert.match(by('EmailLastError').native, /Get \( LastError \)/);
  assert.equal(by('EmailReadMessages').noNative, true);
  const mbs = plan.plugIns.find((p: { plugIn: string }) => p.plugIn.startsWith('MBS'));
  assert.match(mbs.calls.find((x: { call: string }) => x.call === 'MBS ( "CURL.Perform" )').native, /^Insert from URL/);
  assert.match(mbs.calls.find((x: { call: string }) => x.call === 'MBS ( "JSON.Format" )').native, /JSONFormatElements/);
  const be = plan.plugIns.find((p: { plugIn: string }) => p.plugIn === 'BaseElements').calls[0];
  assert.equal(be.worksHere, true, JSON.stringify(be));
  assert.deepEqual(plan.scripts[0], { script: 'Send invoice', calls: 5, plugIns: ['360Works Email'] });
  assert.ok(plan.formulas.some((f: { where: string }) => /Party JSON/.test(f.where)), JSON.stringify(plan.formulas));
  assert.match(plan.summary, /No native replacement: EmailReadMessages/);
  // One plug-in only.
  assert.deepEqual((await call('migration_plan', { plugIn: 'mbs' })).value.plugIns.map((p: { plugIn: string }) => p.plugIn), ['MBS (MonkeyBread)']);
});

test('a script rewritten with native Send Mail is tried offline on a copy: nothing is sent and the file is unchanged', { skip }, async () => {
  const native = 'Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "client@example.com" ; Subject: "Your invoice" ; Message: "Please find it attached." ]';
  const tried = await call('try_design_change', { changes: [{ op: 'updateScript', script: 'Send invoice', text: native }] });
  assert.ok(!tried.isError, tried.text);
  assert.match(tried.text, /Send invoice/);
  const run = tried.value.runs[0].run;
  assert.equal(run.error, 3);
  assert.match(run.message, /never sends email/);
  // The real file still has the plug-in version.
  assert.match((await call('get_script', { script: 'Send invoice' })).text, /EmailSend/);
});
