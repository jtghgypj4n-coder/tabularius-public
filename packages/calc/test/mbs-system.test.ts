import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText, type CalcContext } from '../src/index.ts';

const call = (name: string, args = '', ctx: CalcContext = {}) =>
  evaluateText(`MBS ( "${name}"${args ? ` ; ${args}` : ''} )`, ctx);

test('MBS platform checks use the server process platform', () => {
  for (const [name, platform] of [['IsLinux', 'linux'], ['IsWindows', 'win32'], ['IsMac', 'darwin']])
    assert.equal(call(name), process.platform === platform ? '1' : '0');
});

test('MBS IsServer follows the calculation host headless flag', () => {
  assert.equal(call('IsServer'), '0');
  assert.equal(call('IsServer', '', { headless: false }), '0');
  assert.equal(call('IsServer', '', { headless: true }), '1');
});

test('MBS Trace answers OK without logging and clears the MBS error', (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  const warned = t.mock.method(console, 'warn', () => {});
  const errored = t.mock.method(console, 'error', () => {});
  const ctx: CalcContext = {};
  assert.match(call('Folders.UserDesktop', '', ctx), /^\[MBS\] ERROR:/);
  assert.equal(call('IsError', '', ctx), '1');
  assert.equal(call('Trace', '"test message"', ctx), 'OK');
  assert.equal(call('IsError', '', ctx), '0');
  assert.equal(logged.mock.callCount() + warned.mock.callCount() + errored.mock.callCount(), 0);
});

test('MBS Path.AddPathComponent uses one separator of the existing path style', () => {
  assert.equal(call('Path.AddPathComponent', '"/tmp/base" ; "child"'), '/tmp/base/child');
  assert.equal(call('Path.AddPathComponent', '"/tmp/base/" ; "child"'), '/tmp/base/child');
  assert.equal(call('Path.AddPathComponent', '"/tmp/base/" ; "/child"'), '/tmp/base/child');
  assert.equal(call('Path.AddPathComponent', '"/tmp/base/" ; ""'), '/tmp/base/');
  assert.equal(call('Path.AddPathComponent', '"" ; "child"'), '\\child');
  assert.equal(call('Path.AddPathComponent', '"C:" & Char ( 92 ) & "base" ; "child"'), 'C:\\base\\child');
  assert.equal(call('Path.AddPathComponent', '"C:" & Char ( 92 ) & "base" & Char ( 92 ) ; "child"'), 'C:\\base\\child');
});

test('MBS client-only progress helpers answer without a dialog', () => {
  assert.equal(call('CURL.SetUpdateProgressDialog', '123 ; 1'), 'OK');
  assert.equal(call('ProgressDialog.GetCancel'), '0');
  assert.equal(call('ProgressDialog.Show'), 'OK');
});

test('MBS Folders.UserDesktop remains unavailable', () => {
  const ctx: CalcContext = {};
  assert.match(call('Folders.UserDesktop', '', ctx), /^\[MBS\] ERROR: Folders\.UserDesktop is not available in Tabularius$/);
  assert.equal(call('IsError', '', ctx), '1');
});
