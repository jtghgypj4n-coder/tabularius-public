import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECRET_SEEDS } from '../../scripts/test/secret-seeds.ts';
import { connectionCard } from '../src/connection-card.ts';

// Only the DOM operations used by the card. Event callbacks are awaited, so failures cannot escape the test.
class Element {
  children: (Element | string)[] = [];
  attrs: Record<string, string> = {};
  listeners = new Map<string, () => Promise<void>>();
  value = '';
  disabled = false;
  className = '';
  readonly tag: string;
  constructor(tag: string) { this.tag = tag; }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  toggleAttribute(name: string, value: boolean) { if (value) this.attrs[name] = ''; else delete this.attrs[name]; }
  append(...children: (Element | string)[]) { this.children.push(...children); }
  replaceChildren(...children: (Element | string)[]) { this.children = children; }
  addEventListener(name: string, callback: () => Promise<void>) { this.listeners.set(name, callback); }
  set textContent(value: string) { this.children = [value]; }
  get textContent(): string { return this.children.map((c) => typeof c === 'string' ? c : c.textContent).join(''); }
  all(): Element[] { return [this, ...this.children.flatMap((c) => typeof c === 'string' ? [] : c.all())]; }
}

for (const [name, secret] of SECRET_SEEDS) for (const ok of [true, false]) {
  test(`connection input and page state after ${ok ? 'success' : 'failure'}: ${name}`, async (t) => {
    const before = { document: globalThis.document, fetch: globalThis.fetch };
    t.after(() => Object.assign(globalThis, before));
    globalThis.document = { createElement: (tag: string) => new Element(tag) } as unknown as Document;
    const view = { name: 'probe', type: 'rest', status: 'draft', settings: [], secrets: [{ name: 'token', label: name, required: true, set: false }], ready: false };
    let finish!: (value: Response) => void;
    let sent: unknown;
    globalThis.fetch = async (_input, options) => {
      if (options?.method === 'PUT') {
        sent = JSON.parse(String(options.body));
        return new Promise<Response>((resolve) => { finish = resolve; });
      }
      return Response.json({ allowed: true, connection: view });
    };
    const card = connectionCard({ name: 'probe' }, 'Example', 'session-only') as unknown as Element;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const input = card.all().find((e) => e.tag === 'input')!;
    const button = card.all().find((e) => e.tag === 'button' && e.textContent === 'Set')!;
    assert.ok(input && button, 'credential control rendered');
    input.value = secret;
    const pending = button.listeners.get('click')!();
    assert.deepEqual(sent, { value: secret }, 'credential reaches only its intended submission');
    assert.equal(input.value, '', 'cleared while the request is still in flight');
    finish(Response.json(ok ? { allowed: true, connection: { ...view, secrets: [{ ...view.secrets[0], set: true }], ready: true } }
      : { error: { message: `upstream echoed ${secret}` } }, { status: ok ? 200 : 400 }));
    await pending;
    for (const element of card.all()) {
      assert.ok(!element.value.includes(secret));
      assert.ok(!element.textContent.includes(secret));
      assert.ok(!JSON.stringify(element.attrs).includes(secret));
    }
    assert.equal(input.value, '', 'even the detached old input stays empty');
    if (!ok) assert.match(card.textContent, /Enter it again to retry/);
  });
}
