// The assistant's modern layouts: a page it writes in HTML, CSS and JavaScript (a dashboard, a landing page, a
// screen FileMaker objects can't draw), turned into a design change the person sees and applies: a new layout that
// is one web viewer filling the window, or a new page for a modern layout that's already there.

import type { Store } from '../../store/src/index.ts';
import { FORMULA_LIMIT, PAGE_OPTIONS, modernDesign, modernPage, pageFormula } from '../../web/src/page-source.ts';
import type { LayoutObject } from '../../web/src/types.ts';

/** The most a page may be; past FileMaker Pro's formula limit it still works here, which the notes say. */
const MAX_PAGE = 200_000;

export interface PageDraft {
  changes: Record<string, unknown>[];
  notes: string[];
  layout: string;
}

export function draftPageChange(store: Store, input: Record<string, unknown>): PageDraft {
  const html = typeof input.html === 'string' ? input.html.trim() : '';
  if (!html) throw new Error('html is missing: the whole page, in one HTML document');
  if (html.length > MAX_PAGE) throw new Error(`The page is ${html.length} characters; keep it under ${MAX_PAGE}`);
  if (/<(script|link|img|iframe)\b[^>]*\b(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html)) {
    throw new Error('The page loads something from the network, which web viewers here never do: put scripts, styles, fonts and pictures in the page (inline SVG, data: addresses)');
  }
  const formula = pageFormula(html);
  const notes: string[] = [];
  if (formula.length > FORMULA_LIMIT) {
    notes.push(`The page is ${formula.length.toLocaleString()} characters as a formula; FileMaker Pro takes up to ${FORMULA_LIMIT.toLocaleString()}, so it shows only in Tabularius.`);
  }
  const existing = typeof input.layout === 'string' && input.layout ? input.layout : undefined;
  if (existing) {
    const info = store.schema.layouts.find((l) => l.name === existing);
    if (!info) throw new Error(`There is no layout "${existing}"`);
    const design = store.design(info.id);
    const page = design && modernPage(design.objects as unknown as LayoutObject[]);
    if (!design || !page) throw new Error(`"${existing}" is not a modern layout (one web viewer showing a page); make a new one instead`);
    const objects = design.objects.map((o) => o.id === page.viewer.id
      ? { ...o, webUrl: formula, webOptions: { ...(o.webOptions ?? PAGE_OPTIONS), jsBridge: true, encodeUrl: false } }
      : o);
    notes.push(`Replaces the page of "${existing}".`);
    return { changes: [{ op: 'updateLayout', layout: info.id, design: { objects } }], notes, layout: existing };
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new Error('name is missing: the new layout\'s name');
  if (store.schema.layouts.some((l) => l.name === name)) throw new Error(`There is already a layout "${name}": pick another name, or give layout to replace its page`);
  const occurrence = store.schema.tableOccurrences.find((t) => t.name === input.occurrence) ?? (input.occurrence === undefined ? store.schema.tableOccurrences[0] : undefined);
  if (!occurrence) throw new Error(`There is no table occurrence "${String(input.occurrence)}"`);
  notes.push(`A modern layout: one web viewer filling the window, its page kept in the address formula, so FileMaker Pro opens it too.`);
  return { changes: [{ op: 'createLayout', name, occurrence: occurrence.id, design: modernDesign(name, name, html) }], notes, layout: name };
}
