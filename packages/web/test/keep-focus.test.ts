// Clicking Log Out while typing in a field must log you out: the press may not move focus off the field, because
// that saves it, redraws the toolbar and loses the click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keepFocusOnPress } from '../src/keep-focus.ts';

test('pressing the button is cancelled so focus stays in the field, and the click is untouched', () => {
  const target = new EventTarget();
  keepFocusOnPress({ addEventListener: (t: 'mousedown', fn: (e: { preventDefault(): void }) => void) => target.addEventListener(t, fn as EventListener) });
  const press = new Event('mousedown', { cancelable: true });
  target.dispatchEvent(press);
  assert.equal(press.defaultPrevented, true);
  const click = new Event('click', { cancelable: true });
  target.dispatchEvent(click);
  assert.equal(click.defaultPrevented, false);
});

test('the Log Out button in the status toolbar uses it', () => {
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(src, /keepFocusOnPress\(button\('Log Out'/);
});
