// The product's name and mark, in one place for the web pages: the name isn't
// final, so renaming is this file plus docs/brand/ (docs/design-guide.md).

/** The wordmark (the visible name; the command is `tabularius`, and the old name `openhbam` still works). */
export const PRODUCT_NAME = 'Tabularius';

/** The mark (docs/brand/tabularius-mark.svg): slabs in the text colour, the lifted one in the accent. */
export function markSvg(size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="18.5" width="26" height="6.5" rx="2.4" fill="currentColor"/><rect x="3" y="10.5" width="26" height="6.5" rx="2.4" fill="currentColor" opacity=".72"/><rect x="7" y="2.5" width="22" height="6.5" rx="2.4" fill="var(--accent)" transform="rotate(-8 18 5.75)"/></svg>`;
}

/** The mark with the name beside it, for the top of a sign-in screen. */
export function lockup(tag: 'h1' | 'div' = 'h1'): HTMLElement {
  const el = document.createElement(tag);
  el.className = 'brand-lockup';
  el.innerHTML = markSvg(24);
  const name = document.createElement('span');
  name.textContent = PRODUCT_NAME;
  el.append(name);
  return el;
}
