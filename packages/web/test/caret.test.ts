import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveCaret } from '../src/caret.ts';

/** A field box's text and selection, as moveCaret sees them. */
function box(value: string, start: number, end = start, direction: 'forward' | 'backward' = 'forward') {
  const el = {
    value, selectionStart: start, selectionEnd: end, selectionDirection: direction as string,
    setSelectionRange(s: number, e: number, d: 'forward' | 'backward' = 'forward') {
      el.selectionStart = s;
      el.selectionEnd = e;
      el.selectionDirection = d;
    },
  };
  return el;
}

test('arrow keys move the cursor by characters and lines', () => {
  const el = box('abc\nde\nfghij', 2);
  moveCaret(el, 'ArrowRight', false);
  assert.equal(el.selectionStart, 3);
  moveCaret(el, 'ArrowDown', false); // column 3, but the next line is only 2 long
  assert.equal(el.selectionStart, 6);
  moveCaret(el, 'ArrowDown', false);
  assert.equal(el.selectionStart, 9);
  moveCaret(el, 'ArrowUp', false);
  assert.equal(el.selectionStart, 6);
  moveCaret(el, 'ArrowUp', false);
  assert.equal(el.selectionStart, 2);
  moveCaret(el, 'ArrowUp', false); // first line: to the start
  assert.equal(el.selectionStart, 0);
  moveCaret(el, 'ArrowLeft', false);
  assert.equal(el.selectionStart, 0);
  el.setSelectionRange(10, 10);
  moveCaret(el, 'ArrowDown', false); // last line: to the end
  assert.equal(el.selectionStart, 12);
});

test('Shift extends the selection; an arrow without it collapses one', () => {
  const el = box('hello', 2);
  moveCaret(el, 'ArrowRight', true);
  moveCaret(el, 'ArrowRight', true);
  assert.deepEqual([el.selectionStart, el.selectionEnd, el.selectionDirection], [2, 4, 'forward']);
  moveCaret(el, 'ArrowLeft', true);
  moveCaret(el, 'ArrowLeft', true);
  moveCaret(el, 'ArrowLeft', true);
  assert.deepEqual([el.selectionStart, el.selectionEnd, el.selectionDirection], [1, 2, 'backward']);
  moveCaret(el, 'ArrowRight', false);
  assert.deepEqual([el.selectionStart, el.selectionEnd], [2, 2]);
});
