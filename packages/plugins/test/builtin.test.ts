// The packs that ship inside Tabularius (BaseElements) are listed with the plug-ins, on for every file until the admin
// turns one off for a file, and then its functions give "?" there, as a plug-in that isn't installed does.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateText } from '../../calc/src/index.ts';
import { PluginRegistry, loadPlugins, pluginStatus, setPluginEnabled } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-builtin-'));
after(() => rmSync(dir, { recursive: true }));
const BE = 'com.openhbam.baseelements';

test('built-in packs are on until turned off for a file, and then their functions give ?', () => {
  const reg = new PluginRegistry();
  const ctx = (file: string) => ({ builtinOff: (n: string) => reg.builtinOff(file, n), installedPlugins: () => reg.installedFor(file) });
  assert.equal(evaluateText('BE_Version', ctx('Shop')), 'tabularius');
  assert.equal(evaluateText('TrText_GetLine ( 2 ; "a¶b" )', ctx('Shop')), 'b');
  assert.equal(evaluateText('Dial_CenterPointOfRect ( "-Unused" ; 0 ; 0 ; 10 ; 6 )', ctx('Shop')), '5\r3');
  assert.equal(evaluateText('Get ( InstalledFMPlugins )', ctx('Shop')), 'BaseElements;tabularius;Enabled\rTroi Text;tabularius;Enabled\rTroi Dialog;tabularius;Enabled');
  reg.setBuiltin('Shop', 'com.openhbam.troi-text', false);
  assert.equal(evaluateText('TrText_GetLine ( 2 ; "a¶b" )', ctx('Shop')), '?');
  reg.setBuiltin('Shop', 'com.openhbam.troi-text', true);
  reg.setBuiltin('Shop', 'com.openhbam.troi-dialog', false);
  assert.equal(evaluateText('Dial_CenterPointOfRect ( "-Unused" ; 0 ; 0 ; 10 ; 6 )', ctx('Shop')), '?');
  reg.setBuiltin('Shop', 'com.openhbam.troi-dialog', true);
  reg.setBuiltin('Shop', BE, false);
  assert.equal(evaluateText('BE_Version', ctx('shop')), '?');
  assert.equal(evaluateText('BE_JSONPath ( "{\\"a\\":1}" ; "$.a" )', ctx('SHOP')), '?');
  assert.equal(evaluateText('Get ( InstalledFMPlugins )', ctx('Shop')), 'BaseElements;tabularius;Disabled\rTroi Text;tabularius;Enabled\rTroi Dialog;tabularius;Enabled');
  // Other functions and other files are untouched.
  assert.equal(evaluateText('Upper ( "x" )', ctx('Shop')), 'X');
  assert.equal(evaluateText('BE_Version', ctx('Other')), 'tabularius');
  reg.setBuiltin('Shop', BE, true);
  assert.equal(evaluateText('BE_Version', ctx('Shop')), 'tabularius');
  assert.throws(() => reg.setBuiltin('Shop', 'com.example.nope', false), /isn't a built-in/);
});

test('turning built-in packs off is kept in builtin-off.json and read back at the next start', () => {
  setPluginEnabled(dir, 'Invoices', BE, false);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plugins', 'builtin-off.json'), 'utf8')), { Invoices: [BE] });
  assert.deepEqual(pluginStatus(dir).builtins.map((b) => [b.id, b.offFor]), [[BE, ['Invoices']], ['com.openhbam.troi-text', []], ['com.openhbam.troi-dialog', []]]);
  const reg = new PluginRegistry();
  loadPlugins(reg, dir);
  assert.equal(reg.builtinOff('invoices', 'BE_Zip'), true);
  assert.equal(reg.builtinOff('Other', 'BE_Zip'), false);
  setPluginEnabled(dir, 'invoices', BE, true);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plugins', 'builtin-off.json'), 'utf8')), {});
  assert.deepEqual(pluginStatus(dir).builtins[0].offFor, []);
});
