// test-scripts reports the line a script stopped on; what was typed into the
// script (addresses, names, keys) is masked so the report can be shared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { maskFormula, maskSensitive, maskStepText, testScripts } from '../src/index.ts';

// Built from parts so no address- or key-shaped literal sits in this file.
const EMAIL = ['someone', 'client.example'].join('@');
const AWS = 'AKIA' + 'Q'.repeat(16);

test('step text: literals, addresses and keys are masked; names stay', () => {
  assert.equal(maskStepText(`Send Mail [ Send via SMTP Server ; No dialog ; To: "${EMAIL}" ; Subject: "Your invoice" ]`),
    'Send Mail [ Send via SMTP Server ; No dialog ; To: "…" ; Subject: "…" ]');
  assert.equal(maskStepText(`Set Field [ Customer::Email ; "Contact: ${EMAIL}" & ¶ & Customer::Name ]`),
    'Set Field [ Customer::Email ; "…" & ¶ & Customer::Name ]');
  assert.equal(maskStepText(`Perform Script [ “Notify ${EMAIL}” ; Parameter: "x" ]`), 'Perform Script [ “Notify ‹email›” ; Parameter: "x" ]');
  assert.equal(maskStepText('Insert from URL [ $r ; https://api.example.com/v1?key=1 ]'), 'Insert from URL [ $r ; ‹url› ]');
  assert.equal(maskStepText(`Set Variable [ $k ; Value: ${AWS} ]`), 'Set Variable [ $k ; Value: ‹secret› ]');
  // A quote written "" inside a literal doesn't end it early.
  assert.equal(maskStepText('Set Variable [ $q ; Value: "say ""hi"" to Ann" ]'), 'Set Variable [ $q ; Value: "…" ]');
  // Short literals ("", " ", "¶") and names stay readable.
  assert.equal(maskStepText('Set Field [ T::A ; "" ] Go to Layout [ “Customer Detail” ]'), 'Set Field [ T::A ; "" ] Go to Layout [ “Customer Detail” ]');
  // Messages keep their quoted design names; only addresses and keys are masked.
  assert.equal(maskSensitive(`Field "CreatedBy" requires a value (${EMAIL})`), 'Field "CreatedBy" requires a value (‹email›)');
});

test('step text: stored find criteria, long numbers and comments are masked too', () => {
  // Criteria print in “…” like names do; a quote number found a private sample's mask.
  assert.equal(maskStepText('// Perform Find [ Restore; Find: QUOTES::AutoEnterNumber: “10288” AND QUOTES::Status: “Open” ]'),
    '// Perform Find [ Restore; Find: QUOTES::AutoEnterNumber: “…” AND QUOTES::Status: “…” ]');
  // A layout name after a colon stays.
  assert.equal(maskStepText('Go to Related Record [ From table: “Quotes” ; Using layout: “Quote [list]” ]'), 'Go to Related Record [ From table: “Quotes” ; Using layout: “Quote [list]” ]');
  assert.equal(maskStepText('If [ QUOTES::pkQuoteID = 4412345 and $n < 100 ]'), 'If [ QUOTES::pkQuoteID = ‹number› and $n < 100 ]');
  assert.equal(maskStepText('Set Variable [ $$Issue9Array ; Value: 3 ]'), 'Set Variable [ $$Issue9Array ; Value: 3 ]');
  assert.equal(maskStepText('\t# call the client back on 555 0100\n\t// # old note\nExit Script [ ]'), '\t# …\n\t// # …\nExit Script [ ]');
});

test('step text: calculation comments are masked; disabled steps and short symbols stay', () => {
  assert.equal(maskStepText('Set Variable [ $x ; Value: 1 // ring the client\n\t/* old: Let ( [ a = 2 ] ; a ) */ ]'), 'Set Variable [ $x ; Value: 1 // …\n\t/* … */ ]');
  assert.equal(maskStepText('\t// Set Variable [ $ObjectName ; Value: "-5" ]\n\t//ExecuteSQL ( "…" )'), '\t// Set Variable [ $ObjectName ; Value: "-5" ]\n\t// …');
  assert.equal(maskStepText('If [ $$UserIntials = "AB" or $s = "¶" or $t = "<:" ]'), 'If [ $$UserIntials = "…" or $s = "¶" or $t = "<:" ]');
});

test('custom function formulas: literals and every comment are masked', () => {
  assert.equal(maskFormula('#Value ( "<:CITY:=Oakland:>" ; name ) // see client 4412345\n/* EXAMPLE: #P ( "CITY" ) = "Oakland" */'),
    '#Value ( "…" ; name ) // …\n/* … */');
  // A # function call on its own line is code, not a comment step.
  assert.equal(maskFormula('Let ( x = 1 ;\n# ( "name" ; x ) )'), 'Let ( x = 1 ;\n# ( "…" ; x ) )');
});

test('step text: file references and absolute paths are masked; $variables stay', () => {
  // As an Import Records step in a private sample printed one: the path names the Mac's home folder.
  const home = ['Macintosh HD', 'Users', 'someone', 'Desktop', 'Quotes 2024.fmp12'].join('/');
  assert.equal(maskStepText(`Import Records [ With dialog: Off ; Source: “filemac:/${home}” ; FileMaker Pro ]`),
    'Import Records [ With dialog: Off ; Source: “filemac:‹path›” ; FileMaker Pro ]');
  assert.equal(maskStepText('Insert File [ Target: T::Doc ; “imagewin:/C:/Users/someone/scan.png¶file:Data/scan.png” ]'),
    'Insert File [ Target: T::Doc ; “imagewin:‹path›¶file:‹path›” ]');
  assert.equal(maskStepText('Export Records [ With dialog: Off ; “$fullpath” ; FileMaker Pro ]'), 'Export Records [ With dialog: Off ; “$fullpath” ; FileMaker Pro ]');
  assert.equal(maskStepText('Save Records as PDF [ “filemac:$path” ; Records being browsed ]'), 'Save Records as PDF [ “filemac:$path” ; Records being browsed ]');
  assert.equal(maskSensitive('The file /Users/someone/Library/Exports/out.csv could not be created'), 'The file ‹path›');
  assert.equal(maskSensitive('Cannot open C:\\Users\\someone\\a.xlsx; \\\\server\\share\\b.xlsx and ~/c.xlsx'), 'Cannot open ‹path›; ‹path›');
  // Arithmetic and ratios are not paths.
  assert.equal(maskStepText('Set Variable [ $r ; Value: $a / $b / 2 ]'), 'Set Variable [ $r ; Value: $a / $b / 2 ]');
  assert.equal(maskStepText('Set Field [ T::Profile ; "x" ]'), 'Set Field [ T::Profile ; "x" ]');
});

test('test-scripts masks the step and message it reports', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mask-step-'));
  createStore(join(dir, 'M.sqlite'));
  const store = new Store(join(dir, 'M.sqlite'), 'M');
  try {
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Email', type: 'text' }] }]);
    store.applyDesign([{ op: 'createScript', name: 'Find a client', text: `Enter Find Mode [ Pause: Off ]\nSet Field [ T::Email ; "${EMAIL}" ]\nPerform Find [ ]` }]);
    const [r] = await testScripts(store, { scripts: ['Find a client'] });
    assert.equal(r.error, 401);
    assert.ok(r.step?.includes('"…"') || r.step?.includes('Perform Find'), r.step);
    assert.ok(!JSON.stringify(r).includes(EMAIL), JSON.stringify(r));
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a stalled script says why it may never end, from the script linter', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-stall-lint-'));
  createStore(join(dir, 'M.sqlite'));
  const store = new Store(join(dir, 'M.sqlite'), 'M');
  try {
    store.applyDesign([{ op: 'createScript', name: 'Spin', text: 'Set Variable [ $n ; Value: ValueCount ( "" ) ]\nSet Variable [ $i ; Value: 1 ]\nLoop\n\tExit Loop If [ $n = $i ]\n\tSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop' }]);
    const [r] = await testScripts(store, { scripts: ['Spin'], maxSteps: 500 });
    assert.equal(r.outcome, 'stalled');
    assert.equal(r.lint?.length, 1);
    assert.ok(r.lint[0].startsWith('Spin, line 4: $n comes from ValueCount, which is 0'), r.lint[0]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
