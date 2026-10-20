import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { button } from '../src/design/dom.ts';
import { DEFAULT_LAYOUT_VIEW_OPTIONS, layoutViewClasses, loadLayoutViewOptions, saveLayoutViewOptions } from '../src/design/layout-view.ts';
import type { LayoutObject } from '../src/types.ts';

function makeButton(label: string, attrs: Record<string, string | false | undefined> = {}): HTMLButtonElement {
  const attributes = new Map<string, string>();
  const el = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    addEventListener: () => undefined,
    append: () => undefined,
    set className(_value: string) {},
    getAttribute: (name: string) => attributes.get(name) ?? null,
  };
  const previous = globalThis.document;
  globalThis.document = { createElement: () => el } as unknown as Document;
  try {
    return button(label, () => undefined, attrs);
  } finally {
    globalThis.document = previous;
  }
}

test('glyph buttons use their title as an accessible name', () => {
  assert.equal(makeButton('×', { title: 'Close dialog' }).getAttribute('aria-label'), 'Close dialog');
});

test('text buttons do not get an inferred accessible name', () => {
  assert.equal(makeButton('Close', { title: 'Close dialog' }).getAttribute('aria-label'), null);
});

test('an explicit accessible name takes precedence over the title', () => {
  assert.equal(makeButton('×', { title: 'Close dialog', 'aria-label': 'Dismiss' }).getAttribute('aria-label'), 'Dismiss');
});

test('glyph-only button calls in design pages have a title or aria-label', () => {
  const dir = new URL('../src/design/', import.meta.url);
  const files = readdirSync(dir).filter((file) => file.endsWith('.ts'));
  const missing: string[] = [];
  for (const file of files) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    const calls = /\bbutton\(\s*(['"])([^'"]*)\1\s*,/gu;
    for (const match of source.matchAll(calls)) {
      if (/[\p{L}\p{N}]/u.test(match[2])) continue;
      let depth = 1;
      let quote = '';
      let escaped = false;
      let end = match.index! + match[0].length;
      for (; end < source.length && depth; end++) {
        const char = source[end];
        if (quote) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === quote) quote = '';
        } else if (char === '"' || char === "'" || char === '`') quote = char;
        else if (char === '(') depth++;
        else if (char === ')') depth--;
      }
      const args = source.slice(match.index! + match[0].length, end - 1);
      if (!/\b(?:title|aria-label)\s*:/u.test(args)) {
        const line = source.slice(0, match.index!).split('\n').length;
        missing.push(`${file}:${line}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('View > Show preferences use FileMaker-like initial states and survive storage round trips', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  assert.deepEqual(loadLayoutViewOptions('view', storage), DEFAULT_LAYOUT_VIEW_OPTIONS);
  const changed = { ...DEFAULT_LAYOUT_VIEW_OPTIONS, pageMargins: true, textBoundaries: false };
  saveLayoutViewOptions('view', changed, storage);
  assert.deepEqual(loadLayoutViewOptions('view', storage), changed);
});

test('View > Show storage failures fall back safely', () => {
  assert.deepEqual(loadLayoutViewOptions('view', { getItem: () => { throw new Error('blocked'); } }), DEFAULT_LAYOUT_VIEW_OPTIONS);
  assert.doesNotThrow(() => saveLayoutViewOptions('view', DEFAULT_LAYOUT_VIEW_OPTIONS, { setItem: () => { throw new Error('blocked'); } }));
});

test('each View > Show option controls its canvas or object decoration', () => {
  const base = { ...DEFAULT_LAYOUT_VIEW_OPTIONS };
  const object = (kind: string, changes: Partial<LayoutObject> = {}) => ({ id: 1, kind, type: 0, bounds: { top: 0, left: 0, bottom: 20, right: 40 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, ...changes }) as LayoutObject;
  assert.ok(layoutViewClasses({ ...base, pageMargins: true }).includes('le-show-margins'));
  assert.ok(layoutViewClasses({ ...base, textBoundaries: true }, object('text')).includes('le-text-boundary'));
  assert.ok(layoutViewClasses({ ...base, fieldBoundaries: true }, object('field')).includes('le-field-boundary'));
  assert.ok(layoutViewClasses({ ...base, buttonOutlines: true }, object('button')).includes('le-button-outline'));
  assert.ok(layoutViewClasses({ ...base, slidingObjects: true }, object('rectangle', { sliding: { up: true } })).includes('le-sliding'));
  assert.ok(layoutViewClasses({ ...base, hideCondition: true }, object('text', { hide: { formula: '1', inFind: false } })).includes('le-hide-condition'));
  assert.deepEqual(layoutViewClasses({ pageMargins: false, textBoundaries: false, fieldBoundaries: false, buttonOutlines: false, slidingObjects: false, hideCondition: false }, object('button', { sliding: { up: true }, hide: { formula: '1', inFind: false } })), []);
});
