// Turns a layout's theme and the objects' local styles into CSS.
//
// Each object gets class "e<element>" (the theme's default for its kind) and,
// when it uses a named theme style, "s<n>". Local styles in the normal state
// become inline styles; other states become rules on the object's own class.

import type { LayoutObject, ObjectStyle, StyleRule, Theme } from './types.ts';

/** Theme element ids by object kind, for objects that don't name one (older files). */
const KIND_ELEMENTS: Record<string, number> = {
  field: 61, text: 70, line: 50, rectangle: 51, 'rounded-rectangle': 52, oval: 53, button: 80, portal: 83,
  'tab-control': 81, 'tab-panel': 82, graphic: 84, 'web-viewer': 85, chart: 86, 'popover-button': 80, popover: 89,
  'slide-control': 91, 'slide-panel': 92, 'button-bar': 78,
};

/** Theme element parents; their rules come first in the sheet (lower ids), so children override them. */
const PARENTS: Record<number, number> = {
  31: 30, 32: 30, 33: 30, 34: 30, 35: 30, 36: 30, 37: 30, 38: 30, 39: 30, 40: 30, 41: 30,
  61: 60, 62: 60, 63: 60, 64: 60, 65: 60, 66: 60, 67: 60, 68: 60,
};

const FIELD_ELEMENTS: Record<string, number> = { edit: 61, popup: 63, dropdown: 62, checkbox: 64, radio: 65, calendar: 66 };

export function elementOf(o: LayoutObject): number | undefined {
  if (o.style.element !== undefined) return o.style.element;
  if (o.field) return FIELD_ELEMENTS[o.field.display] ?? 61;
  return KIND_ELEMENTS[o.kind];
}

/** Selector suffix for a rule's part and state. */
function suffix(rule: StyleRule): string | undefined {
  const state = ({ 1: '', 2: ':hover', 3: ':active', 4: ':focus-within', 7: '.fm-checked' } as Record<number, string>)[rule.state];
  if (rule.state === 18) return rule.part === 1 || rule.part === 2 ? ' .fm-input::placeholder' : undefined;
  if (state === undefined) return undefined;
  switch (rule.part) {
    case 1: return state;
    case 2: return `${state} > .fm-content`;
    case 4: return `${state} .fm-icon`;
    // The text box (FileMaker's .text): its margins and padding inset the object's text (textInset).
    case 3: return state;
    // Tab panels: 9 the panel's tab, 10 the tab's label (its padding).
    case 9: case 10: return `.fm-tab${state}`;
    // A portal's rows, its alternate rows and the current row (the one being edited).
    case 12: return `${state} > .fm-portal-rows > .fm-portal-row`;
    case 13: return `${state} > .fm-portal-rows > .fm-portal-row.fm-alt`;
    case 28: return `${state} > .fm-portal-rows > .fm-portal-row:is(:focus-within, .fm-portal-current)`;
    default: return undefined;
  }
}

/**
 * The layout background (20) and layout parts (30-41) have no hover, pressed or
 * focus state in FileMaker, though a theme can still carry them (one theme's
 * layout background has a green hover). Only their normal and active states draw.
 */
const STATIC_ELEMENTS = new Set([20, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41]);
const statesFor = (element: number | undefined, rules: StyleRule[]) =>
  element !== undefined && STATIC_ELEMENTS.has(element) ? rules.filter((r) => r.state === 1 || r.state === 7) : rules;

const decls = (css: Record<string, string>) => Object.entries(css).map(([k, v]) => `${k}:${v}`).join(';');

/**
 * A text box rule's margins and padding as custom properties on the object,
 * which its field, text or label adds up into its own padding (app.css): the
 * text sits where FileMaker puts it. app.css resets them on every object, so
 * a portal's don't reach the fields in its rows.
 */
function textInset(css: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(css)) {
    const m = /^(margin|padding)-(top|right|bottom|left)$/.exec(k);
    if (m) out[`--fm-text-${m[1]}-${m[2]}`] = v;
  }
  return out;
}

function rulesCss(selector: string, rules: StyleRule[]): string {
  let out = '';
  for (const r of rules) {
    const sfx = suffix(r);
    const css = r.part === 3 ? textInset(r.css) : r.css;
    if (sfx !== undefined && Object.keys(css).length) out += `${selector}${sfx}{${decls(css)}}\n`;
  }
  return out;
}

export class StyleSheet {
  private readonly named = new Map<string, number>();
  private baseCss = '';
  private readonly objectCss = new Map<string, string>();
  private readonly scope: string;

  constructor(scope: string, theme: Theme | undefined) {
    this.scope = scope;
    if (!theme) return;
    for (const [el, rules] of Object.entries(theme.defaults)) this.baseCss += rulesCss(`${scope} .e${el}`, statesFor(Number(el), rules));
    for (const c of theme.contextual ?? []) this.baseCss += rulesCss(`${scope} ${c.path.map((e) => `.e${e}`).join(' ')}`, c.rules);
    theme.styles.forEach((s, i) => {
      this.named.set(`${s.name}|${s.element ?? ''}`, i);
      if (!this.named.has(s.name)) this.named.set(s.name, i);
      // Named styles override the element defaults: one more class in the selector.
      this.baseCss += rulesCss(`${scope} .fm.s${i}`, statesFor(s.element, s.rules));
    });
  }

  /** Classes for an object or part, and its inline style. */
  apply(el: HTMLElement, style: ObjectStyle, element: number | undefined, id: string): void {
    if (element !== undefined) {
      // Theme elements inherit: every field kind from "field", every part from "part".
      const parent = PARENTS[element];
      if (parent !== undefined) el.classList.add(`e${parent}`);
      el.classList.add(`e${element}`);
    }
    if (style.name) {
      const n = this.named.get(`${style.name}|${element ?? ''}`) ?? this.named.get(style.name);
      if (n !== undefined) el.classList.add(`s${n}`);
    }
    const local = statesFor(element, style.rules ?? []);
    const normal = local.filter((r) => r.state === 1 && (r.part === 1 || r.part === 2));
    for (const r of normal) for (const [k, v] of Object.entries(r.css)) el.style.setProperty(k, v);
    const other = local.filter((r) => !(r.state === 1 && (r.part === 1 || r.part === 2)));
    if (other.length) {
      el.classList.add(id);
      this.objectCss.set(id, rulesCss(`${this.scope} .fm.${id}`, other));
    } else {
      el.classList.remove(id);
      this.objectCss.delete(id);
    }
  }

  text(): string {
    return this.baseCss + [...this.objectCss.values()].join('');
  }
}
