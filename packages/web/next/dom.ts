// Small DOM helpers for the alternative client: no framework, as with the rest of packages/web.

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;
type Child = Node | string | false | null | undefined;

/** An element with attributes (on* keys become listeners; false and undefined are left out) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== false && c !== null && c !== undefined) el.append(c);
  return el;
}

const ICONS: Record<string, string> = {
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  more: '<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>',
  up: '<path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/>',
  down: '<path d="M8 3.5v9M4.5 9 8 12.5 11.5 9"/>',
  back: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
  go: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  file: '<path d="M9 2.5H4.5v11h7V5L9 2.5Z"/><path d="M9 2.5V5h2.5"/>',
  image: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.1"/><path d="m3 12 3.5-3.5 2.5 2.5 1.5-1.5L13 12"/>',
  spark: '<path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3M4.2 4.2l1.6 1.6M10.2 10.2l1.6 1.6M4.2 11.8l1.6-1.6M10.2 5.8l1.6-1.6"/>',
};

/** A 16-unit line icon, drawn in the text color. Decorative: the control carrying it has its own label. */
export function icon(name: keyof typeof ICONS | string, size = 16): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}

/** Whether the key event is the platform's command key (⌘ on Apple devices, Ctrl elsewhere). */
export function mod(e: KeyboardEvent): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
}

export const MOD_LABEL = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl ';

/** Whether typing is going into a field (so single-key shortcuts should stand back). */
export function typing(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}
