import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Run the console's real table() helper without a browser: column labels can be field names from a file.
const page = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
const script = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const parsed = ts.createSourceFile('admin.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(['table', 'esc']);
const code = parsed.statements.filter(statement =>
  ts.isFunctionDeclaration(statement) ? !!statement.name && names.has(statement.name.text) :
  ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && names.has(d.name.text)))
  .map(statement => statement.getText(parsed)).join('\n');

test('a column label that is a field name cannot add markup to the table header', () => {
  const context = vm.createContext({});
  vm.runInContext(code, context);
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  const html: string = vm.runInContext(`table([{ n: 1 }], [
    { label: ${JSON.stringify(hostile)}, get: () => 'x' },
    { label: 'A & B', get: () => 'y' },
    { label: '', html: () => '' },
    { labelHtml: '<span class="sr-only">Select</span>', html: () => '' },
  ], 'none')`, context);
  const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
  assert.ok(!head.includes('<script'), 'the label is text, not markup');
  assert.ok(!head.includes('<img'), 'the label is text, not markup');
  assert.ok(head.includes('&lt;script&gt;'), 'the label is shown as text');
  assert.ok(head.includes('A &amp; B'));
  assert.ok(head.includes('<span class="sr-only">Actions</span>'), 'an empty label stays an Actions heading');
  assert.ok(head.includes('<span class="sr-only">Select</span>'), 'a column that asks for markup keeps it');
});
