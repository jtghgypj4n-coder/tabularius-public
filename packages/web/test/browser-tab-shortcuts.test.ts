// ⌘/Ctrl+N, T and W belong to the browser while the page is a tab, so the menus show (and the keyboard answers) the
// same key with Alt added there; in an installed app window nothing changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_RESERVED_KEYS, shortcutText, standardMenus, tabShortcut, withoutTabAlt } from '../src/menubar.ts';
import type { CustomMenuItem } from '../src/types.ts';

const all = (items: CustomMenuItem[]): CustomMenuItem[] => items.flatMap((it) => [it, ...(it.items ? all(it.items) : [])]);
const advertised = (mode: 'browse' | 'find') => all(standardMenus(mode).flatMap((m) => m.items)).filter((it) => it.shortcut);

test('in a tab, a reserved key is shown with Alt added; elsewhere it is shown as FileMaker has it', () => {
  assert.equal(shortcutText({ key: 'N', modifiers: 4 }, true, true), '⌥⌘N');
  assert.equal(shortcutText({ key: 'T', modifiers: 5 }, true, true), '⌥⇧⌘T');
  assert.equal(shortcutText({ key: 'W', modifiers: 4 }, false, true), 'Alt+Ctrl+W');
  assert.equal(shortcutText({ key: 'N', modifiers: 4 }, true, false), '⌘N');
  assert.equal(shortcutText({ key: 'N', modifiers: 4 }, false, false), 'Ctrl+N');
  // Other keys, and shortcuts that already have Alt, are left alone.
  assert.equal(shortcutText({ key: 'F', modifiers: 4 }, true, true), '⌘F');
  assert.deepEqual(tabShortcut({ key: 'n', modifiers: 12 }, true), { key: 'n', modifiers: 12 });
  assert.deepEqual(tabShortcut({ key: 'n', modifiers: 0 }, true), { key: 'n', modifiers: 0 });
});

test('the standard menus advertise only these browser-reserved keys, so each is covered', () => {
  const reserved = new Set<string>();
  for (const mode of ['browse', 'find'] as const) {
    for (const it of advertised(mode)) {
      const s = it.shortcut!;
      if (s.modifiers & 4 && BROWSER_RESERVED_KEYS.includes(s.key.toLowerCase())) reserved.add(`${it.command ?? it.title}:${shortcutText(s, true, false)}`);
    }
  }
  // If a new menu item takes N, T or W, it shows up here and gets its Alt variant in a tab automatically.
  assert.deepEqual([...reserved].sort(), ['Close Window:⌘W', 'Current User Name:⇧⌘N', 'New Record:⌘N', 'Omit Multiple:⇧⌘T', 'Omit Record:⌘T', 'Omit Request:⌘T']);
  for (const mode of ['browse', 'find'] as const) {
    for (const it of advertised(mode)) {
      const text = shortcutText(it.shortcut!, true, true);
      if (BROWSER_RESERVED_KEYS.includes(it.shortcut!.key.toLowerCase())) assert.match(text, /^⌥/, `${it.command}: ${text}`);
    }
  }
});

test('Alt plus a reserved key is read as the plain key in a tab only', () => {
  // Node has no KeyboardEvent; a stand-in with the fields the function reads and sets.
  class Press {
    key = ''; code = ''; metaKey = false; ctrlKey = false; shiftKey = false; altKey = false; defaultPrevented = false;
    type: string;
    constructor(type: string, init: Record<string, unknown>) { this.type = type; Object.assign(this, init); }
    getModifierState(): boolean { return false; }
  }
  (globalThis as { KeyboardEvent?: unknown }).KeyboardEvent = Press;
  const press = (init: KeyboardEventInit) => new Press('keydown', init as Record<string, unknown>) as unknown as KeyboardEvent;
  const alt = press({ key: 'Dead', code: 'KeyN', metaKey: true, altKey: true });
  const plain = withoutTabAlt(alt, true);
  assert.ok(plain);
  assert.equal(plain.key, 'n');
  assert.equal(plain.altKey, false);
  assert.equal(plain.metaKey, true);
  assert.equal(withoutTabAlt(alt, false), undefined, 'an installed app gets the plain key itself');
  assert.equal(withoutTabAlt(press({ key: 'f', code: 'KeyF', metaKey: true, altKey: true }), true), undefined, 'only N, T and W');
  assert.equal(withoutTabAlt(press({ key: 'n', code: 'KeyN', altKey: true }), true), undefined, 'needs ⌘ or Ctrl');
  assert.equal(withoutTabAlt(press({ key: 'n', code: 'KeyN', metaKey: true }), true), undefined, 'the plain key is left to the page');
  assert.equal(withoutTabAlt(press({ key: 'T', code: 'KeyT', ctrlKey: true, altKey: true, shiftKey: true }), true)?.shiftKey, true);
});
