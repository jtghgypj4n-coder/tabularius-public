// Small DOM helpers for the design pages.

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | false | undefined> = {}, ...kids: (Node | string | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === undefined) continue;
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid !== false && kid !== undefined) el.append(kid);
  return el;
}

export function button(label: string, onClick: () => void, attrs: Record<string, string | false | undefined> = {}): HTMLButtonElement {
  const hasLabel = Object.keys(attrs).some((key) => key.toLowerCase() === 'aria-label');
  const accessibleAttrs = !hasLabel && !/[\p{L}\p{N}]/u.test(label) ? { 'aria-label': attrs.title || label, ...attrs } : attrs;
  const b = h('button', { type: 'button', ...accessibleAttrs }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function select(options: (string | [value: string, label: string])[], value: string, attrs: Record<string, string | false | undefined> = {}): HTMLSelectElement {
  const s = h('select', attrs);
  for (const o of options) {
    const [v, l] = typeof o === 'string' ? [o, o] : o;
    s.append(h('option', { value: v }, l));
  }
  s.value = value;
  return s;
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  return h('label', { class: 'd-field' }, h('span', { class: 'd-label' }, label), control, hint ? h('span', { class: 'd-hint' }, hint) : undefined);
}

export function check(label: string, checked: boolean): { el: HTMLLabelElement; input: HTMLInputElement } {
  const input = h('input', { type: 'checkbox' });
  input.checked = checked;
  return { el: h('label', { class: 'd-check' }, input, label), input };
}

// One toast for every page: see ../toast.ts.
export { toast } from '../toast.ts';
