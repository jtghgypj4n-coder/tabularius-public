import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateText, NameTable, text, type CalcContext, type Value } from '../src/index.ts';

const ctx: CalcContext = {
  names: new NameTable({ fields: ['Name'] }),
  occurrence: 'People',
  field: (r) => (r.field === 'Name' ? text('Frank') : undefined),
  related: () => [],
  now: () => new Date(2026, 9, 12),
};
const runs = (f: string) => {
  const v = evaluate(f, ctx) as Value & { runs?: unknown };
  return v.type === 'text' ? v.runs : undefined;
};

test('TextColor, TextFont, TextSize and TextStyleAdd add runs; the text is unchanged', () => {
  assert.equal(evaluateText('TextColor ( "Due" ; RGB ( 255 ; 0 ; 0 ) )', ctx), 'Due');
  assert.deepEqual(runs('TextColor ( "Due" ; RGB ( 255 ; 0 ; 0 ) )'), [{ start: 0, end: 3, color: '#FF0000' }]);
  assert.deepEqual(runs('TextSize ( TextFont ( Name ; "Helvetica" ) ; 12 )'), [{ start: 0, end: 5, font: 'Helvetica', size: 12 }]);
  assert.deepEqual(runs('TextStyleAdd ( "x" ; Bold + Italic )'), [{ start: 0, end: 1, style: 256 + 512 }]);
  assert.equal(runs('"plain"'), undefined);
});

test('& and Left/Right/Middle keep the runs where the characters go', () => {
  assert.deepEqual(runs('"Status: " & TextColor ( "Due" ; RGB ( 255 ; 0 ; 0 ) ) & "!"'), [{ start: 8, end: 11, color: '#FF0000' }]);
  assert.deepEqual(runs('Left ( TextStyleAdd ( "abc" ; Bold ) & "def" ; 4 )'), [{ start: 0, end: 3, style: 256 }]);
  assert.deepEqual(runs('Right ( "ab" & TextStyleAdd ( "cd" ; Bold ) ; 3 )'), [{ start: 1, end: 3, style: 256 }]);
  assert.deepEqual(runs('Middle ( TextColor ( "abcdef" ; 255 ) ; 3 ; 2 )'), [{ start: 0, end: 2, color: '#0000FF' }]);
});

test('TextStyleRemove, TextColorRemove and TextFormatRemove take formatting off', () => {
  assert.deepEqual(runs('TextStyleRemove ( TextStyleAdd ( "x" ; Bold + Italic ) ; Bold )'), [{ start: 0, end: 1, style: 512 }]);
  assert.deepEqual(runs('TextStyleAdd ( TextStyleAdd ( "x" ; Bold ) ; Plain )'), undefined);
  assert.deepEqual(runs('TextColorRemove ( TextColor ( "ab" ; 255 ) & TextColor ( "cd" ; 65280 ) ; 255 )'), [{ start: 2, end: 4, color: '#00FF00' }]);
  assert.deepEqual(runs('TextColorRemove ( TextColor ( "ab" ; 255 ) )'), undefined);
  assert.deepEqual(runs('TextFormatRemove ( TextSize ( TextColor ( "ab" ; 255 ) ; 20 ) )'), undefined);
});

test('GetAsCSS writes spans as FileMaker does, escaping the text', () => {
  assert.equal(
    evaluateText('GetAsCSS ( TextStyleAdd ( TextColor ( TextSize ( TextFont ( Name ; "Helvetica" ) ; 12 ) ; RGB ( 255 ; 0 ; 0 ) ) ; Bold ) )', ctx),
    `<span style = "font-family: 'Helvetica';font-size: 12px;color: #FF0000;font-weight: bold;">Frank</span>`,
  );
  assert.equal(evaluateText('GetAsCSS ( "a<b" & ¶ & TextStyleAdd ( "i" ; Italic ) )', ctx), 'a&lt;b<br><span style = "font-style: italic;">i</span>');
});

test('editRuns moves formatting with an edit, typed text taking the formatting before it', async () => {
  const { editRuns, cleanRuns } = await import('../src/index.ts');
  const bold = [{ start: 0, end: 5, style: 256 }];
  assert.deepEqual(editRuns(bold, 'Hello world', 'Hello there world'), [{ start: 0, end: 5, style: 256 }]);
  assert.deepEqual(editRuns(bold, 'Hello world', 'Hellooo world'), [{ start: 0, end: 7, style: 256 }]);
  assert.deepEqual(editRuns(bold, 'Hello world', 'Oh, Hello world'), [{ start: 4, end: 9, style: 256 }]);
  assert.deepEqual(editRuns([{ start: 6, end: 11, color: '#FF0000' }], 'Hello world', 'Hi world'), [{ start: 3, end: 8, color: '#FF0000' }]);
  assert.deepEqual(editRuns([{ start: 2, end: 4, style: 512 }], 'abcdef', 'af'), []);
  assert.deepEqual(editRuns(bold, 'Hello', 'Hello'), bold);

  assert.deepEqual(cleanRuns([{ start: 0, end: 99, style: 256 | (1 << 30), color: '#ff0000', font: 'Georgia', size: 12 }], 4), [{ start: 0, end: 4, style: 256, color: '#FF0000', font: 'Georgia', size: 12 }]);
  assert.equal(cleanRuns([{ start: 0, end: 1, color: 'red' }], 4), undefined);
  assert.equal(cleanRuns([{ start: 0, end: 1, size: 0 }], 4), undefined);
  assert.equal(cleanRuns([{ start: '0', end: 1 }], 4), undefined);
  assert.equal(cleanRuns({ start: 0 }, 4), undefined);
  assert.equal(cleanRuns([{ start: 0, end: 1, font: 'x'.repeat(101) }], 4), undefined);
});

test('a font name can\'t break out of GetAsCSS\'s HTML', () => {
  assert.equal(evaluateText('GetAsCSS ( TextFont ( "x" ; "Ari\\"al\\"><script>" ) )', ctx), `<span style = "font-family: 'Arialscript';">x</span>`);
});
