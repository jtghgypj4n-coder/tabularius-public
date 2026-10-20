// Themes and styles: FileMaker's Manage Themes plus the Styles inspector.
// A theme gives each kind of object (its element) a default look and holds
// named styles objects can use; the look is CSS, kept as rules per part
// (the object, its text, its icon) and state (normal, hover, ...).

import type { StyleRule, Theme } from '../types.ts';
import { h, button, select, field, check, toast } from './dom.ts';
import { createForm, renameRow } from './catalog.ts';
import { STARTER_LOOKS } from './starter-looks.ts';
import { errorText, type Studio } from './main.ts';
import type { FileRestyle, ThemeTokens } from './client.ts';
import { proposalPicture } from './layout-editor.ts';

/** Elements people style most, by their theme element type. */
export const ELEMENTS: [number, string][] = [
  [20, 'Layout background'], [32, 'Header'], [34, 'Body'], [35, 'Body (alternate rows)'], [36, 'Sub-summary'], [38, 'Footer'],
  [61, 'Edit box'], [62, 'Pop-up menu'], [63, 'Drop-down list'], [64, 'Checkbox set'], [65, 'Radio button set'], [66, 'Drop-down calendar'], [67, 'Container'],
  [70, 'Text'], [80, 'Button'], [78, 'Button bar'], [79, 'Button bar segment'], [83, 'Portal'], [81, 'Tab control'], [82, 'Tab panel'],
  [91, 'Slide control'], [89, 'Popover'], [50, 'Line'], [51, 'Rectangle'], [52, 'Rounded rectangle'], [53, 'Oval'], [54, 'Shape'], [85, 'Web viewer'], [86, 'Chart'],
];
export const elementName = (el: number | undefined) => ELEMENTS.find(([id]) => id === el)?.[1] ?? (el === undefined ? 'Any object' : `Element ${el}`);

const PARTS: [string, string][] = [['1', 'Object'], ['2', 'Text'], ['4', 'Icon']];
const STATES: [string, string][] = [['1', 'Normal'], ['2', 'Hover'], ['3', 'Pressed'], ['4', 'Focus']];
const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const FONTS = ['Helvetica Neue', 'Helvetica', 'Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Menlo', 'system-ui'];

/** A CSS color as #rrggbb for a color picker, when it is one we can read. */
export function toHex(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('').toLowerCase();
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  return m ? '#' + m.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('') : undefined;
}

const parseCss = (text: string): Record<string, string> => {
  const css: Record<string, string> = {};
  for (const line of text.split(/[;\n]/)) {
    const i = line.indexOf(':');
    if (i > 0 && line.slice(i + 1).trim()) css[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return css;
};
const cssText = (css: Record<string, string>) => Object.entries(css).map(([k, v]) => `${k}: ${v}`).join('\n');

/**
 * Edits style rules in place: pick the part and state, then fill, text, font,
 * border, corners and padding, or any CSS. Calls `changed` after each edit.
 */
export function ruleEditor(rules: StyleRule[], changed: () => void, opts: { compact?: boolean; view?: { part: number; state: number } } = {}): HTMLElement {
  const view = opts.view ?? { part: 1, state: 1 };
  let part = view.part;
  let state = view.state;
  const box = h('div', { class: 'd-style-editor' });
  const ruleFor = (create: boolean) => {
    let r = rules.find((x) => x.part === part && x.state === state);
    if (!r && create) rules.push((r = { part, state, css: {} }));
    return r;
  };
  // Redrawing removes the focused input, whose blur can fire another change: draw once at a time.
  let drawing = false;
  const draw = () => {
    if (drawing) return;
    drawing = true;
    try {
      drawNow();
    } finally {
      drawing = false;
    }
  };
  const drawNow = () => {
    const css = ruleFor(false)?.css ?? {};
    const set = (values: Record<string, string | undefined>) => {
      const r = ruleFor(true)!;
      for (const [k, v] of Object.entries(values)) {
        if (v) r.css[k] = v;
        else delete r.css[k];
      }
      if (!Object.keys(r.css).length) rules.splice(rules.indexOf(r), 1);
      changed();
      draw();
    };
    const color = (k: string, title: string) => {
      const on = check(title, !!css[k]);
      const pick = h('input', { type: 'color', value: toHex(css[k]) ?? (k === 'color' ? '#000000' : '#ffffff'), 'aria-label': `${title} color` });
      on.input.addEventListener('change', () => set({ [k]: on.input.checked ? pick.value : undefined }));
      pick.addEventListener('change', () => set({ [k]: pick.value }));
      return h('span', { class: 'd-row' }, on.el, pick);
    };
    const pt = (v: string | undefined) => (v ? String(parseFloat(v)) : '');
    const num = (value: string, label: string, apply: (v: string) => void) => {
      const input = h('input', { type: 'number', min: '0', step: '0.5', value, class: 'd-narrow', 'aria-label': label });
      input.addEventListener('change', () => apply(input.value));
      return input;
    };
    const font = h('input', { value: (css['font-family'] ?? '').replace(/"/g, ''), list: 'd-fonts', placeholder: 'Theme font', 'aria-label': 'Font' });
    font.addEventListener('change', () => set({ 'font-family': font.value.trim() ? font.value.split(',').map((f) => (/\s/.test(f.trim()) && !/^["']/.test(f.trim()) ? `"${f.trim()}"` : f.trim())).join(', ') : undefined }));
    const size = num(pt(css['font-size']), 'Font size', (v) => set({ 'font-size': v ? `${v}pt` : undefined }));
    const bold = check('Bold', css['font-weight'] === 'bold' || Number(css['font-weight']) >= 600);
    bold.input.addEventListener('change', () => set({ 'font-weight': bold.input.checked ? 'bold' : css['font-weight'] ? 'normal' : undefined }));
    const italic = check('Italic', css['font-style'] === 'italic');
    italic.input.addEventListener('change', () => set({ 'font-style': italic.input.checked ? 'italic' : css['font-style'] ? 'normal' : undefined }));
    const underline = check('Underline', /underline/.test(css['text-decoration-line'] ?? ''));
    underline.input.addEventListener('change', () => set({ 'text-decoration-line': underline.input.checked ? 'underline' : css['text-decoration-line'] ? 'none' : undefined }));
    const align = select([['', 'Theme'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['justify', 'Justify']], css['text-align'] ?? '', { 'aria-label': 'Align' });
    align.addEventListener('change', () => set({ 'text-align': align.value || undefined }));
    const sides = (prop: string, value: string | undefined) => Object.fromEntries(SIDES.map((s) => [`border-${s}-${prop}`, value]));
    const bWidth = num(pt(css['border-top-width']), 'Border width', (v) => set({ ...sides('width', v ? `${v}pt` : undefined), ...(v && !css['border-top-style'] ? sides('style', 'solid') : {}) }));
    const bStyle = select([['', 'Theme'], ['none', 'None'], ['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double']], css['border-top-style'] ?? '', { 'aria-label': 'Border style' });
    bStyle.addEventListener('change', () => set(sides('style', bStyle.value || undefined)));
    const bColorOn = check('Color', !!css['border-top-color']);
    const bColor = h('input', { type: 'color', value: toHex(css['border-top-color']) ?? '#c8c8c8', 'aria-label': 'Border color' });
    bColorOn.input.addEventListener('change', () => set(sides('color', bColorOn.input.checked ? bColor.value : undefined)));
    bColor.addEventListener('change', () => set(sides('color', bColor.value)));
    const radius = num(pt(css['border-top-left-radius']), 'Corner radius', (v) => set(Object.fromEntries(CORNERS.map((c) => [`border-${c}-radius`, v ? `${v}pt` : undefined]))));
    const padding = num(pt(css['padding-top']), 'Padding', (v) => set(Object.fromEntries(SIDES.map((s) => [`padding-${s}`, v ? `${v}pt` : undefined]))));
    const raw = h('textarea', { rows: opts.compact ? '3' : '5', class: 'd-code', spellcheck: 'false', 'aria-label': 'CSS' }, cssText(css));
    raw.addEventListener('change', () => {
      const r = ruleFor(true)!;
      r.css = parseCss(raw.value);
      if (!Object.keys(r.css).length) rules.splice(rules.indexOf(r), 1);
      changed();
      draw();
    });
    const preview = h('div', { class: 'd-style-preview' }, h('span', {}, 'Sample text'));
    const normal = { ...(rules.find((x) => x.part === 1 && x.state === 1)?.css ?? {}), ...(rules.find((x) => x.part === 2 && x.state === 1)?.css ?? {}), ...(state !== 1 ? css : {}) };
    for (const [k, v] of Object.entries(normal)) preview.style.setProperty(k, v);

    const partPick = select(PARTS, String(part), { 'aria-label': 'Part' });
    partPick.addEventListener('change', () => { part = view.part = Number(partPick.value); draw(); });
    const statePick = select(STATES, String(state), { 'aria-label': 'State' });
    statePick.addEventListener('change', () => { state = view.state = Number(statePick.value); draw(); });
    const used = (p: number, s: number) => rules.some((r) => r.part === p && r.state === s && Object.keys(r.css).length);
    for (const o of partPick.options) if ([1, 2, 3, 4].some((s) => used(Number(o.value), s))) o.textContent += ' •';
    for (const o of statePick.options) if (used(part, Number(o.value))) o.textContent += ' •';

    box.replaceChildren(
      h('div', { class: 'd-row' }, partPick, statePick, opts.compact ? undefined : preview),
      h('div', { class: 'd-style-grid' },
        field('Fill', color('background-color', 'Fill')),
        field('Text color', color('color', 'Text')),
        field('Font', font), field('Size (pt)', size),
        h('div', { class: 'd-row d-span' }, bold.el, italic.el, underline.el, field('Align', align)),
        h('div', { class: 'd-span' }, field('Border (pt)', h('span', { class: 'd-row' }, bWidth, bStyle, bColorOn.el, bColor))),
        field('Corner radius (pt)', radius), field('Padding (pt)', padding),
      ),
      field('CSS', raw, 'One property per line. What the controls above don\'t cover goes here.'),
      h('datalist', { id: 'd-fonts' }, ...FONTS.map((f) => h('option', { value: f }))),
    );
  };
  draw();
  return box;
}

// ---------------------------------------------------------------- Themes tab

export async function themesTab(studio: Studio): Promise<HTMLElement> {
  const d = studio.design;
  const summary = d.themes.find((t) => t.id === studio.selected.theme) ?? d.themes[0];
  studio.selected.theme = summary?.id;
  const list = h('ul', { class: 'd-list' }, ...d.themes.map((t) => {
    const li = h('li', { class: t === summary ? 'selected' : '' }, h('button', { type: 'button' }, h('span', {}, t.name), h('span', { class: 'd-count' }, `${t.styles?.length ?? 0} styles`)));
    li.querySelector('button')!.addEventListener('click', () => {
      studio.selected.theme = t.id;
      studio.selected.style = undefined;
      studio.selected.restyle = undefined;
      studio.render();
    });
    return li;
  }));
  const from = select([['', 'Blank'], ...d.themes.map((t) => [String(t.id), `Copy of ${t.name}`] as [string, string])], summary ? String(summary.id) : '', { 'aria-label': 'Start from' });
  const create = createForm(studio, 'theme', 'New theme name', [from], (name) => ({ op: 'createTheme', name, ...(from.value ? { from: Number(from.value) } : {}) }),
    (n) => studio.design.themes.find((t) => t.name === n)?.id);
  const restyling = studio.selected.restyle === 1;
  const restyleButton = button('Restyle every layout…', () => {
    studio.selected.restyle = restyling ? undefined : 1;
    studio.render();
  }, { class: restyling ? 'primary' : '', 'aria-pressed': String(restyling), title: 'Put every layout in the file on one theme, made from a few colours and a font' });
  if (restyling) list.querySelector('.selected')?.classList.remove('selected');
  const side = h('aside', { class: 'd-side' }, h('h2', {}, 'Themes'), list, h('div', { class: 'd-actions' }, restyleButton), create, importTheme(studio));
  const main = h('section', { class: 'd-main' });
  if (restyling) main.append(restyleFile(studio));
  else if (!summary) main.append(h('p', { class: 'd-muted' }, 'No themes yet. "Restyle every layout…" starts from Light, Dark, Plain or Warm; or create one and pick it in a layout\'s settings.'));
  else {
    try {
      main.append(...themeDetail(studio, await studio.client.theme(summary.id)));
    } catch (e) {
      main.append(h('p', {}, errorText(e)));
    }
  }
  return h('div', { class: 'd-split' }, side, main);
}

/** What Export theme writes and Import theme reads: the theme's styles, as JSON. */
const THEME_FORMAT = 'openhbam-theme';

/** Manage Themes' Import: a theme exported from another file. */
function importTheme(studio: Studio): HTMLElement {
  const file = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Import a theme' }) as HTMLInputElement;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const t = JSON.parse(await f.text()) as Partial<Theme> & { format?: string };
      if (t.format !== THEME_FORMAT) throw new Error('This isn\'t a theme exported from Tabularius');
      const taken = new Set(studio.design.themes.map((x) => x.name));
      let name = String(t.name || 'Imported theme');
      for (let n = 2; taken.has(name); n++) name = `${t.name} ${n}`;
      await studio.apply([{ op: 'createTheme', name, content: { defaults: t.defaults, styles: t.styles, ...(t.contextual ? { contextual: t.contextual } : {}) } }], `Imported ${name}`);
      const made = studio.design.themes.find((x) => x.name === name);
      if (made) {
        studio.selected.theme = made.id;
        studio.render();
      }
    } catch (e) {
      toast(errorText(e));
    }
  });
  return h('details', { class: 'd-report' }, h('summary', {}, 'Import a theme'),
    h('p', { class: 'd-hint' }, 'A theme file from Export theme in another database.'), file);
}

function exportTheme(theme: Theme): void {
  const json = JSON.stringify({ format: THEME_FORMAT, name: theme.name, defaults: theme.defaults, styles: theme.styles, ...(theme.contextual ? { contextual: theme.contextual } : {}) }, null, 1);
  const a = h('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: `${theme.name.replace(/[\\/:*?"<>|]/g, '_')}.json` }) as HTMLAnchorElement;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function themeDetail(studio: Studio, theme: Theme): HTMLElement[] {
  const heading = renameRow(studio, theme.name, (name) => ({ op: 'updateTheme', theme: theme.id, name }), () => {
    if (confirm(`Delete theme "${theme.name}"?`)) void studio.apply([{ op: 'deleteTheme', theme: theme.id }], `Deleted ${theme.name}`);
  }, 'Theme');

  // Element defaults.
  const elements = new Map(ELEMENTS);
  for (const el of Object.keys(theme.defaults).map(Number)) if (!elements.has(el)) elements.set(el, elementName(el));
  const elKey = 'themeElement';
  const shownEl = studio.selected[elKey] ?? 61;
  const elPick = select([...elements].map(([id, name]) => [String(id), `${name}${theme.defaults[id]?.length ? ' •' : ''}`] as [string, string]), String(shownEl), { 'aria-label': 'Element' });
  elPick.addEventListener('change', () => {
    studio.selected[elKey] = Number(elPick.value);
    studio.render();
  });
  const defaults = structuredClone(theme.defaults[shownEl] ?? []);
  const saveDefaults = button('Save', () => void studio.apply([{ op: 'updateTheme', theme: theme.id, defaults: { [shownEl]: defaults.length ? defaults : null } }], `${elementName(shownEl)} saved`), { class: 'primary' });

  // Named styles.
  const styles = [...theme.styles.entries()].sort(([, a], [, b]) => (a.element ?? 0) - (b.element ?? 0) || a.name.localeCompare(b.name));
  const styleIndex = studio.selected.style;
  const style = styleIndex !== undefined ? theme.styles[styleIndex] : undefined;
  const styleList = h('ul', { class: 'd-list d-style-list' }, ...styles.map(([i, s]) => {
    const li = h('li', { class: i === styleIndex ? 'selected' : '' }, h('button', { type: 'button' }, h('span', {}, s.name), h('span', { class: 'd-count' }, elementName(s.element))));
    li.querySelector('button')!.addEventListener('click', () => {
      studio.selected.style = i;
      studio.render();
    });
    return li;
  }));
  const newName = h('input', { placeholder: 'New style name', 'aria-label': 'New style name' });
  const newEl = select(ELEMENTS.map(([id, n]) => [String(id), n] as [string, string]), String(shownEl), { 'aria-label': 'For' });
  const newForm = h('form', { class: 'd-inline-form' }, newName, newEl, h('button', { type: 'submit' }, 'Add style'));
  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newName.value.trim();
    if (!name) return;
    if (await studio.apply([{ op: 'createStyle', theme: theme.id, name, element: Number(newEl.value), rules: [] }], `Added style ${name}`)) {
      studio.selected.style = theme.styles.length;
      studio.render();
    }
  });

  const out: HTMLElement[] = [heading,
    h('div', { class: 'd-actions' }, button('Export theme', () => exportTheme(theme), { title: 'Save the theme as a file to import into another database' })),
    h('h3', {}, 'Element defaults'),
    h('p', { class: 'd-muted' }, 'How each kind of object looks on layouts with this theme, unless it uses a named style or has its own formatting.'),
    h('div', { class: 'd-row' }, field('Element', elPick)),
    ruleEditor(defaults, () => undefined),
    h('div', { class: 'd-actions' }, saveDefaults),
    h('h3', {}, `Styles (${theme.styles.length})`),
    styleList, newForm,
  ];
  if (style) {
    const rules = structuredClone(style.rules);
    const name = h('input', { value: style.name, 'aria-label': 'Style name' });
    const save = button('Save style', () => void studio.apply([{ op: 'updateStyle', theme: theme.id, style: style.name, ...(style.element !== undefined ? { element: style.element } : {}), rules, ...(name.value.trim() && name.value.trim() !== style.name ? { name: name.value.trim() } : {}) }], 'Style saved'), { class: 'primary' });
    const del = button('Delete style…', () => {
      if (!confirm(`Delete style "${style.name}"? Objects using it get the ${elementName(style.element).toLowerCase()} default look.`)) return;
      studio.selected.style = undefined;
      void studio.apply([{ op: 'deleteStyle', theme: theme.id, style: style.name, ...(style.element !== undefined ? { element: style.element } : {}) }], 'Style deleted');
    }, { class: 'danger' });
    out.push(h('div', { class: 'd-panel d-style-detail' },
      h('div', { class: 'd-row' }, field('Name', name), h('span', { class: 'd-muted' }, `For: ${elementName(style.element)}`)),
      ruleEditor(rules, () => undefined),
      h('div', { class: 'd-actions' }, save, del)));
  }
  return out;
}

// ---------------------------------------------------------------- Restyle every layout

/** Tabularius's own look (packages/web/tokens.css), the starting point; the server fills in any left out the same way. */
const PRODUCT: ThemeTokens = {
  accent: '#0d6e7c', accentText: '#ffffff', text: '#1a2226', muted: '#5b676e', background: '#f3f5f6', panel: '#ffffff', line: '#c6cfd4',
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif', size: 13, radius: 6,
};

const COLOURS: [keyof ThemeTokens, string][] = [
  ['accent', 'Accent'], ['accentText', 'Text on accent'], ['text', 'Text'], ['muted', 'Labels'],
  ['background', 'Background'], ['panel', 'Fields and body'], ['line', 'Borders'],
];

const TOKEN_FONTS: [string, string][] = [
  [PRODUCT.font, 'System (Tabularius)'], ['"Helvetica Neue", Helvetica, Arial, sans-serif', 'Helvetica'],
  ['Georgia, "Times New Roman", serif', 'Georgia'], ['Verdana, Geneva, sans-serif', 'Verdana'], ['"Courier New", monospace', 'Courier'],
];

/**
 * One theme for every layout in the file (FileMaker changes themes a layout at a time): pick a few colours and a
 * font, or an existing theme, see each layout before and after, leave any out, and apply it all as one change.
 */
function restyleFile(studio: Studio): HTMLElement {
  const tokens: ThemeTokens = { ...PRODUCT };
  const source = select([['', 'New theme from these colours'], ...studio.design.themes.map((t) => [String(t.id), t.name] as [string, string])], '', { 'aria-label': 'Theme' });
  const name = h('input', { value: 'House', 'aria-label': 'New theme name' });
  const colourInputs = COLOURS.map(([k, label]) => {
    const input = h('input', { type: 'color', value: String(tokens[k]), 'aria-label': label }) as HTMLInputElement;
    input.addEventListener('input', () => { (tokens[k] as string) = input.value; });
    return field(label, input);
  });
  const font = select(TOKEN_FONTS, tokens.font, { 'aria-label': 'Font' });
  font.addEventListener('change', () => { tokens.font = font.value; });
  const size = h('input', { type: 'number', min: '6', max: '72', value: String(tokens.size), 'aria-label': 'Text size' }) as HTMLInputElement;
  const radius = h('input', { type: 'number', min: '0', max: '40', value: String(tokens.radius), 'aria-label': 'Corner radius' }) as HTMLInputElement;
  const consistent = check('Drop local formatting, so every object shows the theme', false);
  // Start from one of the file's own themes: its colours, font and corners read from the FileMaker theme.
  const startFrom = select([['', 'Tabularius\'s look'], ...STARTER_LOOKS.map((l) => [`starter:${l.id}`, `Starter: ${l.name}`] as [string, string]), ...studio.design.themes.filter((t) => t.tokens).map((t) => [String(t.id), t.name] as [string, string])], '', { 'aria-label': 'Start from' });
  const startNote = h('p', { class: 'd-muted d-token-note' });
  startFrom.addEventListener('change', () => {
    const starter = STARTER_LOOKS.find((l) => `starter:${l.id}` === startFrom.value);
    const t = starter ? undefined : studio.design.themes.find((x) => String(x.id) === startFrom.value);
    Object.assign(tokens, starter?.tokens ?? t?.tokens ?? PRODUCT);
    colourInputs.forEach((f, i) => { (f.querySelector('input') as HTMLInputElement).value = String(tokens[COLOURS[i][0]]); });
    if (![...font.options].some((o) => o.value === tokens.font)) font.append(h('option', { value: tokens.font }, tokens.font.split(',')[0].replace(/"/g, '')));
    font.value = tokens.font;
    size.value = String(tokens.size);
    radius.value = String(tokens.radius);
    if (t) name.value = `${t.name} (tokens)`;
    else if (starter) name.value = starter.name;
    const names = Object.fromEntries([...COLOURS, ['font', 'Font'], ['size', 'Text size'], ['radius', 'Corners']]);
    startNote.textContent = t?.unmapped?.length ? `${t.name} doesn't set ${t.unmapped.map((k) => names[k] ?? k).join(', ').toLowerCase()}, so Tabularius's are used.` : '';
  });
  const fromTokens = h('div', { class: 'd-token-grid' }, field('Start from', startFrom), field('Name', name), ...colourInputs, field('Font', font), field('Text size (pt)', size), field('Corners (pt)', radius), startNote);
  source.addEventListener('change', () => { fromTokens.hidden = source.value !== ''; });
  const results = h('div', { class: 'd-restyle-results', 'aria-live': 'polite' });
  const previewButton = button('Preview', () => void preview(), { class: 'primary' });

  const preview = async () => {
    previewButton.disabled = true;
    results.replaceChildren(h('p', { class: 'd-muted' }, 'Working out each layout…'));
    try {
      tokens.size = Number(size.value);
      tokens.radius = Number(radius.value);
      // Kept as sent, so applying some of the layouts applies what was previewed, whatever the form says since.
      const asked = {
        ...(source.value ? { theme: Number(source.value) } : { tokens: { ...tokens }, name: name.value.trim() || 'House' }),
        consistent: consistent.input.checked,
      };
      draw(await studio.client.restyle(asked), asked);
    } catch (e) {
      results.replaceChildren(h('p', { class: 'd-error' }, errorText(e)));
    } finally {
      previewButton.disabled = false;
    }
  };

  const draw = (r: FileRestyle, asked: Parameters<Studio['client']['restyle']>[0]) => {
    const themes = new Map<number, Theme>();
    if (r.themeContent) themes.set(r.themeContent.id, r.themeContent);
    const picks = new Map<number, HTMLInputElement>();
    const rows = r.layouts.map((l) => {
      const pick = h('input', { type: 'checkbox', checked: '', 'aria-label': `Restyle ${l.name}` }) as HTMLInputElement;
      picks.set(l.id, pick);
      const pictures = h('div', { class: 'd-restyle-pictures' });
      const row = h('details', { class: 'd-restyle-row' },
        h('summary', {}, pick, h('span', { class: 'd-restyle-name' }, l.name),
          h('span', { class: 'd-muted' }, l.changed ? `${l.changed} object${l.changed === 1 ? '' : 's'} restyled` : l.notes[0] ?? 'Theme changed'),
          ...(l.issues && l.issues.after !== l.issues.before ? [h('span', { class: l.issues.after > l.issues.before ? 'd-warn' : 'd-ok' }, ` Check: ${l.issues.before} → ${l.issues.after}`)] : [])),
        pictures,
        ...(l.notes.length > (l.changed ? 0 : 1) ? [h('ul', { class: 'd-hint' }, ...l.notes.slice(l.changed ? 0 : 1).map((n) => h('li', {}, n)))] : []));
      // Pictures are drawn when a row is opened, so a file with hundreds of layouts stays quick.
      row.addEventListener('toggle', async () => {
        if (!row.open || pictures.childElementCount) return;
        pictures.append(await proposalPicture(studio, { id: l.id, name: l.name, design: l.after, before: l.before, issues: [] }, { themes, max: { width: 360, height: 320 } }));
      });
      pick.addEventListener('click', (e) => e.stopPropagation());
      return row;
    });
    const all = button('All', () => picks.forEach((p) => { p.checked = true; }));
    const none = button('None', () => picks.forEach((p) => { p.checked = false; }));
    const apply = button(`Apply to the chosen layouts`, () => void applyChosen(), { class: 'primary' });
    const applyChosen = async () => {
      const chosen = [...picks].filter(([, p]) => p.checked).map(([id]) => id);
      if (!chosen.length) return toast('Choose at least one layout');
      apply.disabled = true;
      try {
        // Worked out again for just the chosen layouts (a new theme comes first), then applied as one change.
        const fresh = chosen.length === picks.size ? r : await studio.client.restyle({ ...asked, layouts: chosen });
        if (await studio.apply(fresh.changes)) {
          const undo = studio.lastUndo;
          toast(`${fresh.layouts.length} layout${fresh.layouts.length === 1 ? '' : 's'} now on ${fresh.theme}`, 'info', undo ? { label: 'Undo', run: () => void studio.apply(undo, 'Undone') } : undefined);
        }
      } catch (e) {
        toast(errorText(e));
      } finally {
        apply.disabled = false;
      }
    };
    results.replaceChildren(
      h('h3', {}, `${r.layouts.length} layout${r.layouts.length === 1 ? '' : 's'} change onto ${r.theme}`),
      h('p', { class: 'd-muted' }, 'Open a layout to see it before and after. Untick any to leave as they are.'),
      h('div', { class: 'd-actions' }, all, none, apply),
      ...rows,
      ...(r.unchanged.length ? [h('details', { class: 'd-report' }, h('summary', {}, `${r.unchanged.length} left as they are`),
        h('ul', {}, ...r.unchanged.map((u) => h('li', {}, `${u.name}: ${u.why}`))))] : []));
  };

  return h('div', { class: 'd-restyle' },
    h('h2', {}, 'Restyle every layout'),
    h('p', { class: 'd-muted' }, 'Put every layout in this file on one theme. Pick an accent colour and a font for a new theme (Tabularius\'s own look to start with), or an existing theme. Nothing moves; only looks change.'),
    h('div', { class: 'd-row' }, field('Theme', source)),
    fromTokens,
    consistent.el,
    h('div', { class: 'd-actions' }, previewButton),
    results);
}
