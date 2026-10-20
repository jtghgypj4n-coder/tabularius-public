import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findInScripts, replaceInScripts, stepStarts, toggleSteps } from '../src/design/script-find.ts';

const scripts = [
  { id: 1, name: 'Open Invoice', text: 'Go to Layout [ “Invoices” ]\nSet Variable [ $id ; Value: Invoices::Id ]' },
  { id: 2, name: 'Totals', text: 'Set Variable [ $total ; Value: Sum ( Invoices::Amount ) ]\n# invoices are summed here' },
];

test('find in scripts: every line that holds the text, by script and line', () => {
  assert.deepEqual(findInScripts(scripts, 'invoices').map((m) => [m.name, m.line]), [['Open Invoice', 1], ['Open Invoice', 2], ['Totals', 1], ['Totals', 2]]);
  assert.deepEqual(findInScripts(scripts, 'invoices', { matchCase: true }).map((m) => [m.script, m.line]), [[2, 2]]);
  assert.deepEqual(findInScripts(scripts, 'Invoice', { wholeWord: true }), []);
  assert.deepEqual(findInScripts(scripts, ''), []);
});

test('replace in scripts: only the scripts that change, with how many replacements; the replacement is literal', () => {
  const out = replaceInScripts(scripts, 'Invoices::', 'Bills::', { matchCase: true });
  assert.deepEqual(out.map((o) => [o.script, o.count]), [[1, 1], [2, 1]]);
  assert.equal(out[0].text, 'Go to Layout [ “Invoices” ]\nSet Variable [ $id ; Value: Bills::Id ]');
  assert.equal(replaceInScripts(scripts, '$id', '$$ID')[0].text.split('\n')[1], 'Set Variable [ $$ID ; Value: Invoices::Id ]');
});

test('disable, enable and comment steps, keeping the indent and continuation lines', () => {
  const text = 'If [ $x ]\n\tSet Variable [ $a ; Value: List (\n\t\t"[not a bracket" ;\n\t\t2 ) ]\n\tBeep\nEnd If';
  assert.deepEqual(stepStarts(text), [true, true, false, false, true, true]);
  const off = toggleSteps(text, 1, 4, '// ');
  assert.equal(off, 'If [ $x ]\n\t// Set Variable [ $a ; Value: List (\n\t\t"[not a bracket" ;\n\t\t2 ) ]\n\t// Beep\nEnd If');
  assert.equal(toggleSteps(off, 1, 4, '// '), text);
  // From inside a step's continuation lines: that step.
  assert.equal(toggleSteps(text, 2, 2, '# ').split('\n')[1], '\t# Set Variable [ $a ; Value: List (');
  // Mixed: everything goes off first.
  assert.equal(toggleSteps('// Beep\nBeep', 0, 1, '// '), '// Beep\n// Beep');
});
