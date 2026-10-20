// A theme made from a handful of design tokens (an accent colour, text and
// surface colours, a font, a corner radius), which FileMaker doesn't have:
// pick the brand colour and font once and every kind of object gets a look
// that goes with it. The defaults are Tabularius's own tokens
// (packages/web/tokens.css, docs/design-guide.md), so a file can look like
// the rest of the product.

import type { StyleRule, Theme } from '../../fmp12/src/index.ts';

export interface ThemeTokens {
  /** Buttons, focus rings, the header band. */
  accent: string;
  /** Text on the accent (a button's label). */
  accentText: string;
  /** Field contents and titles. */
  text: string;
  /** Labels. */
  muted: string;
  /** The window behind the layout. */
  background: string;
  /** Fields, the body, portals. */
  panel: string;
  /** Field and portal borders, lines. */
  line: string;
  font: string;
  /** Text size in points. */
  size: number;
  /** Corner radius of fields and buttons, in points. */
  radius: number;
}

/** Tabularius's light palette and type (packages/web/tokens.css). */
export const PRODUCT_TOKENS: ThemeTokens = {
  accent: '#0d6e7c', accentText: '#ffffff', text: '#1a2226', muted: '#5b676e', background: '#f3f5f6', panel: '#ffffff', line: '#c6cfd4',
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif', size: 13, radius: 6,
};

/** Looks to start a file from: a few palettes that read well (text on its surface and the button label on the accent both pass WCAG AA). */
export const STARTER_TOKENS: { id: string; name: string; tokens: ThemeTokens }[] = [
  { id: 'light', name: 'Light', tokens: PRODUCT_TOKENS },
  {
    id: 'dark', name: 'Dark',
    tokens: { ...PRODUCT_TOKENS, accent: '#4fc3d4', accentText: '#06181c', text: '#e8eef0', muted: '#9fb0b7', background: '#14191c', panel: '#1e2529', line: '#46555d' },
  },
  {
    id: 'plain', name: 'Plain',
    tokens: {
      ...PRODUCT_TOKENS, accent: '#1a1a1a', accentText: '#ffffff', text: '#111111', muted: '#555555', background: '#ffffff', panel: '#ffffff', line: '#8a8a8a',
      font: '"Helvetica Neue", Helvetica, Arial, sans-serif', radius: 2,
    },
  },
  {
    id: 'warm', name: 'Warm',
    tokens: { ...PRODUCT_TOKENS, accent: '#b4531f', accentText: '#ffffff', text: '#2b2118', muted: '#6e5d4e', background: '#f6f0e8', panel: '#fffdf9', line: '#d8c9b8', radius: 8 },
  },
];

const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

const border = (color: string, width = 1): Record<string, string> =>
  Object.fromEntries(SIDES.flatMap((s) => [[`border-${s}-color`, color], [`border-${s}-style`, 'solid'], [`border-${s}-width`, `${width}px`]]));
const noBorder = (): Record<string, string> => Object.fromEntries(SIDES.map((s) => [`border-${s}-style`, 'none']));
const round = (r: number): Record<string, string> => Object.fromEntries(CORNERS.map((c) => [`border-${c}-radius`, `${r}px`]));

/** Mixes a #rrggbb colour toward black (amount < 0) or white (amount > 0). */
function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Tokens as given, the product's for the rest; colours must be #rrggbb, sizes sensible. */
export function checkTokens(given: Partial<Record<keyof ThemeTokens, unknown>> = {}): ThemeTokens {
  const t = { ...PRODUCT_TOKENS };
  for (const k of Object.keys(PRODUCT_TOKENS) as (keyof ThemeTokens)[]) {
    const v = given[k];
    if (v === undefined) continue;
    if (k === 'size' || k === 'radius') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > (k === 'size' ? 72 : 40)) throw new Error(`${k} is a number of points (${k === 'size' ? '6 to 72' : '0 to 40'})`);
      t[k] = k === 'size' ? Math.max(6, v) : v;
    } else if (k === 'font') {
      if (typeof v !== 'string' || !v.trim() || /[;{}<>]/.test(v)) throw new Error('font is a font family list, like "Helvetica Neue", Arial, sans-serif');
      t.font = v.trim();
    } else {
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${k} is a colour like #0d6e7c`);
      t[k] = v.toLowerCase();
    }
  }
  return t;
}

/** The theme's element defaults (what createTheme's content takes), from the tokens. */
export function tokenTheme(tokens: ThemeTokens): Pick<Theme, 'defaults' | 'styles'> {
  const t = tokens;
  const type = { 'font-family': t.font, 'font-size': `${t.size}px`, 'font-style': 'normal', 'line-height': '1.3', 'text-align': 'left' };
  const rule = (css: Record<string, string>, state = 1, part = 1): StyleRule => ({ part, state, css });
  const fill = (color: string) => ({ 'background-image': 'none', 'background-color': color });
  const field = [
    rule({ ...fill(t.panel), ...border(t.line), ...round(t.radius), ...type, color: t.text, 'padding-top': '2px', 'padding-right': '4px', 'padding-bottom': '2px', 'padding-left': '4px' }),
    rule({ ...border(t.accent) }, 4),
  ];
  const button = [
    rule({ ...fill(t.accent), ...border(t.accent), ...round(t.radius), ...type, color: t.accentText, 'font-weight': 'bold', 'text-align': 'center' }),
    rule({ ...fill(shade(t.accent, -0.15)), ...border(shade(t.accent, -0.15)) }, 2),
    rule({ ...fill(shade(t.accent, -0.3)), ...border(shade(t.accent, -0.3)) }, 3),
  ];
  const shape = [rule({ ...fill('transparent'), ...border(t.line) })];
  const defaults: Theme['defaults'] = {
    20: [rule(fill(t.background))],
    // Header and footer bands; the body is the panel records sit on, alternate rows a touch darker.
    32: [rule({ ...fill(shade(t.accent, 0.88)), ...noBorder() })],
    33: [rule({ ...fill(shade(t.accent, 0.88)), ...noBorder() })],
    34: [rule({ ...fill(t.panel), ...noBorder() })],
    35: [rule({ ...fill(shade(t.background, -0.02)), ...noBorder() })],
    36: [rule({ ...fill(t.background), ...noBorder() })],
    37: [rule({ ...fill(t.background), ...noBorder() })],
    38: [rule({ ...fill(t.background), ...noBorder() })],
    39: [rule({ ...fill(t.background), ...noBorder() })],
    50: [rule({ ...border(t.line) })],
    51: shape, 52: [rule({ ...fill('transparent'), ...border(t.line), ...round(t.radius) })], 53: shape,
    61: field, 62: field, 63: field, 66: field,
    64: [rule({ ...type, color: t.text })], 65: [rule({ ...type, color: t.text })],
    67: [rule({ ...fill(t.panel), ...border(t.line), ...round(t.radius) })],
    70: [rule({ ...type, color: t.muted })],
    80: button,
    78: [rule({ ...border(t.accent), ...round(t.radius) })],
    79: button,
    81: [rule({ ...fill(t.panel), ...border(t.line) })],
    82: [rule({ ...fill(t.panel), ...border(t.line) })],
    83: [rule({ ...fill(t.panel), ...border(t.line), ...round(t.radius) })],
    85: [rule({ ...border(t.line) })],
    86: [rule({ ...fill(t.panel), ...border(t.line), ...round(t.radius) })],
    89: [rule({ ...fill(t.panel), ...border(t.line), ...round(t.radius) })],
    91: [rule({ ...fill(t.panel) })],
  };
  return { defaults, styles: [] };
}

/** A CSS colour as the reader writes it (rgb(r g b), rgb(r g b / a), #rrggbb) as #rrggbb; undefined when it's mostly see-through. */
function hexOf(css: string | undefined): string | undefined {
  if (!css) return undefined;
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) return `#${hex[1].toLowerCase()}`;
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+))?\s*\)$/.exec(css.trim());
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return undefined;
  return `#${[m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(Number(x)))).toString(16).padStart(2, '0')).join('')}`;
}

/** The first colour of a linear gradient: what the eye takes as a gradient button's colour. */
function gradientStart(css: string | undefined): string | undefined {
  // The direction ("to bottom", "180deg") is optional; the first colour follows it.
  const m = css && /linear-gradient\(\s*(?:[^,()]+,\s*)?(rgba?\([^)]*\)|#[0-9a-f]{6})/i.exec(css);
  return m ? hexOf(m[1]) : undefined;
}

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/**
 * The design tokens that describe a FileMaker theme: the colours, font, text
 * size and corner radius its buttons, fields, labels and layout background
 * use (normal state). `from` says, per token, which element it came from, or
 * that the theme doesn't set it and Tabularius's own is used instead; such
 * tokens are listed in `unmapped`.
 */
export function tokensFromTheme(theme: Pick<Theme, 'defaults'>): { tokens: ThemeTokens; from: Record<keyof ThemeTokens, string>; unmapped: (keyof ThemeTokens)[] } {
  const css = (element: number): Record<string, string> =>
    Object.assign({}, ...(theme.defaults[element] ?? []).filter((r) => r.state === 1 && (r.part === 1 || r.part === 2)).map((r) => r.css));
  const layout = css(20), body = css(34), field = { ...css(60), ...css(61) }, text = css(70), button = css(80);
  const colour = (c: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) {
      const v = k === 'background-image' ? gradientStart(c[k]) : hexOf(c[k]);
      if (v) return v;
    }
    return undefined;
  };
  const px = (v: string | undefined) => {
    const m = v && /^([\d.]+)px$/.exec(v.trim());
    return m ? Number(m[1]) : undefined;
  };
  const family = (v: string | undefined) => (v && !/[;{}<>]/.test(v) ? v : undefined);
  const found: Partial<Record<keyof ThemeTokens, [unknown, string]>> = {
    // An outlined button (no fill) shows its colour in its text and border.
    accent: colour(button, 'background-image', 'background-color') ? [colour(button, 'background-image', 'background-color'), 'button background'] : [colour(button, 'border-top-color', 'color'), 'button border (an outlined button)'],
    accentText: [colour(button, 'color'), 'button text'],
    text: [colour(field, 'color'), 'field text'],
    muted: [colour(text, 'color'), 'text object colour'],
    background: colour(layout, 'background-image', 'background-color') ? [colour(layout, 'background-image', 'background-color'), 'layout background'] : [colour(css(21), 'background-image', 'background-color'), 'layout inner background'],
    panel: [colour(body, 'background-image', 'background-color') ?? colour(field, 'background-color'), 'body part background'],
    line: [colour(field, 'border-top-color', 'border-bottom-color'), 'field border'],
    font: [family(field['font-family'] ?? text['font-family']), 'field font'],
    size: [px(field['font-size'] ?? text['font-size']), 'field text size'],
    radius: [px(button['border-top-left-radius']?.split(' ')[0]), 'button corners'],
  };
  const tokens = { ...PRODUCT_TOKENS };
  const from = {} as Record<keyof ThemeTokens, string>;
  const unmapped: (keyof ThemeTokens)[] = [];
  for (const k of Object.keys(PRODUCT_TOKENS) as (keyof ThemeTokens)[]) {
    const [v, where] = found[k] ?? [undefined, ''];
    if (v === undefined) {
      from[k] = 'Tabularius default (the theme doesn\'t set it)';
      unmapped.push(k);
    } else {
      (tokens as Record<string, unknown>)[k] = k === 'size' ? Math.max(6, Math.min(72, v as number)) : k === 'radius' ? Math.min(40, v as number) : v;
      from[k] = where;
    }
  }
  // Our buttons are filled with the accent: an outlined button's text colour is its
  // accent too, so its text becomes black or white, whichever reads on it.
  if (/^#[0-9a-f]{6}$/i.test(tokens.accent) && /^#[0-9a-f]{6}$/i.test(tokens.accentText) && contrast(tokens.accent, tokens.accentText) < 3) {
    tokens.accentText = contrast(tokens.accent, '#ffffff') >= contrast(tokens.accent, '#000000') ? '#ffffff' : '#000000';
    from.accentText = 'black or white, to read on the accent (the theme\'s button text doesn\'t)';
  }
  return { tokens, from, unmapped };
}
