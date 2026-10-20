// Text contrast for the layout linter: WCAG's contrast ratio between an
// object's text colour and what is behind it, measured on the rendered layout.

/** [r, g, b, a] from a computed colour ("rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)", "rgb(1 2 3 / 50%)"), or undefined. */
export function parseColor(css: string): [number, number, number, number] | undefined {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(css.trim());
  if (!m) return undefined;
  const a = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  return [Number(m[1]), Number(m[2]), Number(m[3]), a];
}

/** `top` drawn over the opaque `bottom`. */
export function over(top: [number, number, number, number], bottom: [number, number, number]): [number, number, number] {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

/** WCAG contrast ratio, 1 (none) to 21 (black on white). */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The ratio WCAG AA asks for: 3 for large text (24px, or 18.66px bold), else 4.5. */
export function requiredRatio(fontPx: number, weight: number): number {
  return fontPx >= 24 || (fontPx >= 18.66 && weight >= 700) ? 3 : 4.5;
}

/**
 * An element's text colour and the colour behind it, from computed styles:
 * backgrounds are stacked from the element up to `root` (white below them all,
 * as a layout's stage is). Undefined when the text is fully transparent.
 */
export function measured(el: Element, root: Element): { ratio: number; required: number; behind: [number, number, number] } | undefined {
  const style = getComputedStyle(el);
  const text = parseColor(style.color);
  if (!text || text[3] === 0) return undefined;
  const layers: [number, number, number, number][] = [];
  for (let at: Element | null = el; at; at = at === root ? null : at.parentElement) {
    const bg = parseColor(getComputedStyle(at).backgroundColor);
    if (bg && bg[3] > 0) layers.push(bg);
    if (bg && bg[3] >= 1) break;
  }
  let behind: [number, number, number] = [255, 255, 255];
  for (const layer of layers.reverse()) behind = over(layer, behind);
  return { ratio: contrastRatio(over(text, behind), behind), required: requiredRatio(parseFloat(style.fontSize), Number(style.fontWeight) || 400), behind };
}

/** The text colour that reads best on a background: near-black or white, whichever has more contrast with it. */
export function readableOn(behind: [number, number, number]): string {
  return contrastRatio([29, 29, 31], behind) >= contrastRatio([255, 255, 255], behind) ? '#1d1d1f' : '#ffffff';
}
