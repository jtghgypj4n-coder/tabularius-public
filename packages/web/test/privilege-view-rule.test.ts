import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sec } from '../src/security/main.ts';
import type { TablePrivileges } from '../src/security/client.ts';

class ElementDouble {
  tagName: string;
  className = '';
  style: Record<string, string> = {};
  value = '';
  checked = false;
  children: (ElementDouble | string)[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, ((event?: unknown) => unknown)[]>();
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  append(...children: (ElementDouble | string)[]) { this.children.push(...children); }
  addEventListener(type: string, listener: (event?: unknown) => unknown) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  async fire(type: string) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener())); }
  replaceChildren(...children: (ElementDouble | string)[]) { this.children = children; }
  get textContent(): string { return this.children.map((c) => typeof c === 'string' ? c : c.textContent).join(''); }
  querySelectorAll(selector: string): ElementDouble[] {
    const matches = (el: ElementDouble) => selector.startsWith('[aria-label="')
      ? el.attrs.get('aria-label') === selector.slice(13, -2)
      : selector.startsWith('.') ? el.className.split(/\s+/).includes(selector.slice(1))
      : el.tagName.toLowerCase() === selector.toLowerCase();
    return this.children.flatMap((child) => typeof child === 'string' ? [] : [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string): ElementDouble | null { return this.querySelectorAll(selector)[0] ?? null; }
}

test('Use as the View rule syncs the main select, calculation box, and draft rule', async () => {
  const prior = globalThis.document;
  const app = new ElementDouble('div');
  globalThis.document = { createElement: (tag: string) => new ElementDouble(tag), getElementById: () => app } as unknown as Document;
  const priorSessionStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: () => null } as unknown as Storage;
  try {
    const { tableEditor } = await import('../src/security/privilege-sets.ts');
    const table: TablePrivileges = { view: true, edit: false, create: false, delete: false, fields: {} };
    const sec = { client: { previewRecordRule: async () => ({ valid: true, samples: [], allowed: 1, total: 1 }) } } as unknown as Sec;
    const editor = tableEditor(table, [], { table: 'Items', sec });
    const preview = Array.from(editor.querySelectorAll('button')).find((b) => b.textContent === 'Preview') as unknown as ElementDouble;
    const draftCalc = editor.querySelector('[aria-label="Items view rule"]') as HTMLInputElement;
    draftCalc.value = 'Owner = Get ( AccountName )';
    await preview.fire('click');
    const use = Array.from(editor.querySelectorAll('button')).find((b) => b.textContent === 'Use as the View rule') as unknown as ElementDouble;
    await use.fire('click');

    const mainSelect = editor.querySelector('[aria-label="View"]') as HTMLSelectElement;
    const mainCalc = editor.querySelector('[aria-label="View calculation"]') as HTMLInputElement;
    assert.equal(mainSelect.value, 'limited');
    assert.equal(mainCalc.value, 'Owner = Get ( AccountName )');
    assert.equal(mainCalc.style.display, '');
    assert.equal(table.view, 'Owner = Get ( AccountName )');
  } finally { globalThis.document = prior; globalThis.sessionStorage = priorSessionStorage; }
});
