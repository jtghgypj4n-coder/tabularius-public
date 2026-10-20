// Modernize interfaces: new layouts for every table from ready-made templates (no AI, no tokens), beside the file's
// own. Pick tables and kinds, preview each (the modern pages run on made-up records, so searching, editing and adding
// all work without touching the file), then make them all as one change that Undo takes back.

import type { Change } from './client.ts';
import { h, button, check, toast } from './dom.ts';
import { errorText, type Studio } from './main.ts';
import { proposalPicture } from './layout-editor.ts';
import { estimatePolish, previewPage } from '../modernize.ts';
import { pageSource } from '../page-source.ts';
import type { LayoutDesign, LayoutObject } from '../types.ts';

/** The kinds of layout, as the server names them. */
const STYLES: [string, string, string, boolean?][] = [
  ['modern-list', 'Modern list', 'Search, sortable columns and paging; a row opens its record in a side panel'],
  ['modern-detail', 'Modern detail', 'One record at a time with Previous and Next, and its related records'],
  ['modern-split', 'Modern list and detail', 'The list with the record beside it'],
  ['classic-list', 'Classic list', 'A FileMaker list layout, styled like the file\'s own'],
  ['classic-form', 'Classic form', 'A FileMaker form with portals of related records'],
  ['modern-board', 'Modern board', 'Cards in columns by a status or stage field, moved by dragging or a menu (tables that have one)', false],
  ['modern-calendar', 'Modern calendar', 'Records on the days of a month by a date field (tables that have one)', false],
];

type Result = Awaited<ReturnType<Studio['client']['modernize']>>;

/** The panel: pick tables and kinds, preview, make. `done` runs once the layouts are made. */
function modernizePanel(studio: Studio, done: () => void): HTMLElement {
  const tables = studio.design.tables.filter((t) => studio.design.tableOccurrences.some((o) => o.baseTableId === t.id && !o.dataSourceId));
  const tableBoxes = tables.map((t) => ({ t, box: check(t.name, true) }));
  const styleBoxes = STYLES.map(([id, label, hint, on]) => ({ id, box: check(label, on ?? true), hint }));
  const fromLayouts = check('Also one for each of your own layouts', false);
  const results = h('div', { class: 'd-restyle-results', 'aria-live': 'polite' });
  const previewButton = button('Preview', () => void preview(), { class: 'primary' });

  const preview = async () => {
    const chosen = tableBoxes.filter((x) => x.box.input.checked).map((x) => x.t.name);
    const styles = styleBoxes.filter((x) => x.box.input.checked).map((x) => x.id);
    if (!chosen.length || (!styles.length && !fromLayouts.input.checked)) return toast('Pick at least one table and one kind of layout');
    previewButton.disabled = true;
    results.replaceChildren(h('p', { class: 'd-muted' }, 'Working out the layouts…'));
    try {
      draw(await studio.client.modernize({ tables: chosen, styles, ...(fromLayouts.input.checked ? { fromLayouts: true } : {}) }));
    } catch (e) {
      results.replaceChildren(h('p', { class: 'd-error' }, errorText(e)));
    } finally {
      previewButton.disabled = false;
    }
  };

  const draw = (r: Result) => {
    const designOf = (name: string): LayoutDesign | undefined => (r.changes.find((c) => c.op === 'createLayout' && c.name === name) as { design?: LayoutDesign } | undefined)?.design;
    const rows = r.layouts.map((l) => {
      const design = designOf(l.name);
      const pictures = h('div', { class: 'd-restyle-pictures' });
      const row = h('details', { class: 'd-restyle-row' },
        h('summary', {}, h('span', { class: 'd-restyle-name' }, l.name), h('span', { class: 'd-muted' }, l.notes[0] ?? '')),
        pictures,
        ...(l.notes.length > 1 ? [h('ul', { class: 'd-hint' }, ...l.notes.slice(1).map((n) => h('li', {}, n)))] : []));
      // Drawn when a row is opened, so a file with dozens of tables stays quick.
      row.addEventListener('toggle', async () => {
        if (!row.open || pictures.childElementCount || !design) return;
        const html = design.objects ? pageSource((design.objects as unknown as LayoutObject[]).find((o) => o.kind === 'web-viewer')?.webUrl) : undefined;
        if (html !== undefined && l.samples) {
          const frame = h('iframe', { class: 'd-modernize-frame', sandbox: 'allow-scripts', title: `Preview of ${l.name}`, srcdoc: previewPage(html, l.samples) });
          pictures.append(h('p', { class: 'd-hint' }, 'Made-up records, so you can try it: nothing here reaches the file.'), frame);
        } else pictures.append(await proposalPicture(studio, { id: 0, name: l.name, design: design as LayoutDesign, issues: [] }, { max: { width: 520, height: 420 } }));
      });
      return { row, l };
    });
    const apply = button(`Make ${r.layouts.length} layout${r.layouts.length === 1 ? '' : 's'}`, () => void make(), { class: 'primary', disabled: r.layouts.length ? false : 'true' });
    const make = async () => {
      apply.disabled = true;
      try {
        if (await studio.apply(r.changes)) {
          const undo = studio.lastUndo;
          toast(`Made ${r.layouts.length} layout${r.layouts.length === 1 ? '' : 's'} in the "Modernized interfaces" folder`, 'info');
          studio.render();
          // The assistant, when it's on, can rewrite the pages that were just made; that is for the person to choose and see the cost of.
          const polish = await polishSection(studio, done);
          results.replaceChildren(h('h3', {}, `Made ${r.layouts.length} layout${r.layouts.length === 1 ? '' : 's'}`),
            h('p', { class: 'd-muted' }, 'They are in the "Modernized interfaces" folder of the Layouts list.'),
            ...(polish ? [polish] : []),
            h('div', { class: 'd-actions' }, button('Done', done, { class: 'primary' }),
              ...(undo ? [button('Undo', async () => { if (await studio.apply(undo, 'Undone')) { done(); studio.render(); } }, { title: 'Take the new layouts and their folder back' })] : [])));
        }
      } finally {
        apply.disabled = false;
      }
    };
    const byTable = new Map<string, typeof rows>();
    for (const x of rows) byTable.set(x.l.table, [...(byTable.get(x.l.table) ?? []), x]);
    results.replaceChildren(
      h('h3', {}, r.layouts.length ? `${r.layouts.length} new layout${r.layouts.length === 1 ? '' : 's'} for ${byTable.size} table${byTable.size === 1 ? '' : 's'}` : 'Nothing new to make'),
      ...(r.layouts.length ? [h('p', { class: 'd-muted' }, 'Open one to see it. Your own layouts are not changed; these go in a "Modernized interfaces" folder, and Undo takes them back.'), h('div', { class: 'd-actions' }, apply)] : []),
      ...[...byTable].map(([table, list]) => h('section', {}, h('h4', {}, table), ...list.map((x) => x.row))),
      ...(r.skipped.length ? [h('details', { class: 'd-report' }, h('summary', {}, `${r.skipped.length} left out`),
        h('ul', {}, ...r.skipped.map((s) => h('li', {}, `${s.table}${s.style ? ` (${s.style})` : ''}: ${s.why}`))))] : []));
  };

  return h('div', { class: 'd-restyle' },
    h('h2', {}, 'Modernize interfaces'),
    h('p', { class: 'd-muted' }, 'Make a list, a record form and a list with the form beside it for each table, in modern HTML, CSS and JavaScript or in classic FileMaker style, from ready-made templates worked out from the fields. No AI and no tokens are used. Your own layouts stay as they are.'),
    h('fieldset', { class: 'd-group' }, h('legend', {}, 'Kinds of layout'), ...styleBoxes.map((x) => h('div', {}, x.box.el, h('span', { class: 'd-hint' }, ` ${x.hint}`)))),
    h('div', {}, fromLayouts.el, h('span', { class: 'd-hint' }, ' A modern list and detail for each layout the file already has, showing the fields that layout shows, in its order')),
    h('fieldset', { class: 'd-group' }, h('legend', {}, 'Tables'),
      h('div', { class: 'd-actions' }, button('All', () => tableBoxes.forEach((x) => { x.box.input.checked = true; })), button('None', () => tableBoxes.forEach((x) => { x.box.input.checked = false; }))),
      h('div', { class: 'd-token-grid' }, ...tableBoxes.map((x) => x.box.el))),
    h('div', { class: 'd-actions' }, previewButton),
    results);
}

/** Opens Modernize interfaces in a dialog wide enough to try the pages in. */
export function openModernize(studio: Studio): void {
  const dialog = h('dialog', { class: 'd-dialog le-modernize', 'aria-label': 'Modernize interfaces' }) as HTMLDialogElement;
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.append(modernizePanel(studio, close), h('div', { class: 'd-row' }, h('span', { class: 'd-spacer' }), button('Close', close)));
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  document.body.append(dialog);
  dialog.showModal();
}

/**
 * Polish with AI: the assistant rewrites the modern pages picked, to a request. Optional and never automatic, because it
 * uses the AI credits of whoever asks, so it says roughly what that is first. Nothing is sent until the button is pressed,
 * and what comes back is shown in the assistant's panel to apply or leave, like any change it proposes.
 */
async function polishSection(studio: Studio, done: () => void): Promise<HTMLElement | undefined> {
  if (!studio.ask) return undefined;
  const model = await studio.client.assistantModel();
  const pages = studio.design.layouts.filter((l) => / - Modern (list|detail|list and detail)$/.test(l.name));
  if (!model || !pages.length) return undefined;
  const boxes = pages.map((l) => ({ l, box: check(l.name, false) }));
  const want = h('input', { class: 'd-ai-want', placeholder: 'What should change? For example: make it feel like a CRM, add a status filter', 'aria-label': 'What should the assistant change' }) as HTMLInputElement;
  const cost = h('p', { class: 'd-muted', 'aria-live': 'polite' });
  const ask = button('Ask the assistant', () => {
    const chosen = boxes.filter((x) => x.box.input.checked).map((x) => x.l.name);
    if (!chosen.length) return;
    done();
    void studio.ask!(`Redevelop these modern layouts, which were made from templates: ${chosen.map((n) => `"${n}"`).join(', ')}. ${want.value.trim() ? `What I want: ${want.value.trim()}. ` : 'Make them look and work better for this file\'s data. '}` +
      'Read each saved page with get_layout_design and keep what works, in particular the window.tabularius calls, the layout names it reads related records through, and that the page loads nothing from the network. ' +
      'Propose each whole new page with propose_page (layout: its name), using the file\'s real field names, one layout at a time.');
  }, { class: 'primary' });
  ask.disabled = true;
  const update = () => {
    const n = boxes.filter((x) => x.box.input.checked).length;
    ask.disabled = n === 0;
    const e = estimatePolish(n, model.price);
    cost.textContent = n
      ? `Roughly ${e.input.toLocaleString()} tokens in and ${e.output.toLocaleString()} out${e.usd !== undefined ? `, about $${e.usd < 0.1 ? e.usd.toFixed(3) : e.usd.toFixed(2)}` : ''} with ${model.model}. A guess from the usual size of these pages; the assistant's usage line has the real figure.`
      : `Pick the pages to polish. ${model.model} writes them, and the tokens count against this file's AI limits.`;
  };
  boxes.forEach((x) => x.box.input.addEventListener('change', update));
  update();
  return h('section', { class: 'd-group' }, h('h3', {}, 'Polish with AI (optional)'),
    h('p', { class: 'd-muted' }, 'The templates are finished and work as they are. If you want the assistant to rework some of them, pick them and say what you want. It costs tokens, so nothing is sent until you press the button.'),
    h('div', { class: 'd-token-grid' }, ...boxes.map((x) => x.box.el)), want, cost, h('div', { class: 'd-actions' }, ask));
}
