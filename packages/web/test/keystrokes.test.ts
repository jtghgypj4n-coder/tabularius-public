import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYSTROKE_CODES, triggerKeystroke } from '../src/keystrokes.ts';

// Claris, Code function: the codes of the navigational keys.
test('keystrokes: the navigational keys report the Code function numbers', () => {
  const claris: Array<[string, string, number]> = [
    ['Backspace', 'Backspace', 8], ['Tab', 'Tab', 9], ['Enter', 'NumpadEnter', 10], ['Enter', 'Enter', 13], ['Escape', 'Escape', 27],
    ['ArrowLeft', 'ArrowLeft', 28], ['ArrowUp', 'ArrowUp', 29], ['ArrowRight', 'ArrowRight', 30], ['ArrowDown', 'ArrowDown', 31],
    ['Delete', 'Delete', 127],
  ];
  for (const [key, code, number] of claris) assert.equal(triggerKeystroke(key, code)?.charCodeAt(0), number, `${code} is ${number}`);
  assert.equal(Object.keys(KEYSTROKE_CODES).length, claris.length, 'no key beyond the page');
});

test('keystrokes: shift-tab reports a tab, a space and letters their own character', () => {
  assert.equal(triggerKeystroke('Tab', 'Tab'), '\t');
  assert.equal(triggerKeystroke(' ', 'Space')?.charCodeAt(0), 32);
  assert.equal(triggerKeystroke('é', 'KeyE'), 'é');
});

test('keystrokes: keys the Code page does not list fire no trigger', () => {
  for (const key of ['Home', 'End', 'PageUp', 'PageDown', 'Shift', 'F5', 'Insert']) assert.equal(triggerKeystroke(key, key), undefined, key);
});
