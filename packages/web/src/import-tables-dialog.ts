// File > Import Tables…: tables from the files another tool exported (CSV, Excel, a Notion ZIP or folder of pages) made into
// whole tables of this file, with the type of each column worked out and open to change, links between sheets made into
// relationships, and what will be made shown before anything is. Full Access only; the server refuses anyone else, the
// menu just leaves the entry out. The files are sent again for the import, so a preview keeps nothing on the server.

import type { Api } from './api.ts';
import { h, button } from './design/dom.ts';
import { choicesFor, choose, currentChoice, filesProblem, importTablesForm, importTablesQuery, keepValid, sheetLine, type Choices, type ImportTablesDone, type ImportTablesPreview } from './import-tables-model.ts';

export async function importTablesDialog(api: Api, onImported: () => void): Promise<void> {
  if (document.querySelector('dialog.import-tables-dialog')) return;
  const dialog = h('dialog', { class: 'replace-dialog export-dialog import-tables-dialog', 'aria-labelledby': 'import-tables-title' }) as HTMLDialogElement;
  const status = h('p', { class: 'import-tables-status', role: 'status', 'aria-live': 'polite' });
  const planBox = h('div', { class: 'import-tables-plan' });
  const files = h('input', { id: 'import-tables-files', type: 'file', multiple: '', accept: '.csv,.tsv,.txt,.xlsx,.md,.zip,text/csv,application/zip' }) as HTMLInputElement;
  const folder = h('input', { id: 'import-tables-folder', type: 'file', multiple: '', webkitdirectory: '' }) as HTMLInputElement;
  const links = h('input', { id: 'import-tables-links', type: 'checkbox' }) as HTMLInputElement;
  links.checked = true;
  const row = (id: string, label: string, control: HTMLElement) => h('div', { class: 'import-tables-row' }, h('label', { for: id }, label), control);

  let preview: ImportTablesPreview | undefined;
  let choices: Choices = {};
  let busy = 0;
  let imported = false;

  const pagesOf = () => [...(folder.files ?? [])].filter((f) => /\.md$/i.test(f.name));
  const folderName = () => ((folder.files?.[0] as File & { webkitRelativePath?: string } | undefined)?.webkitRelativePath ?? '').split('/')[0] ?? '';
  const form = () => importTablesForm([...(files.files ?? [])], pagesOf(), folderName(), choices);

  const importButton = button('Import', () => void run('import'), { class: 'primary', disabled: '' }) as HTMLButtonElement;
  const previewButton = button('Preview', () => void run('preview'), { class: 'primary' }) as HTMLButtonElement;
  const closeButton = button('Cancel', () => dialog.close());
  const settle = () => {
    previewButton.disabled = !!busy || imported;
    importButton.disabled = !!busy || imported || !preview;
    for (const c of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.import-tables-plan select, #import-tables-links')) c.disabled = !!busy || imported;
  };

  const draw = (focus?: string) => {
    planBox.replaceChildren();
    if (!preview) return;
    const { plan, samples } = preview;
    planBox.append(h('p', { class: 'import-tables-total' }, `${plan.sheets.length} table${plan.sheets.length === 1 ? '' : 's'} to make. Nothing is made until you press Import.`));
    plan.sheets.forEach((s, si) => {
      const body = h('tbody', {});
      s.columns.forEach((c, ci) => {
        const id = `import-tables-kind-${si}-${ci}`;
        const pick = h('select', { id, 'aria-label': `Type of ${c.header || '(no name)'} in ${s.sheet}` }, ...choicesFor(plan, s.sheet).map((o) => h('option', { value: o.value }, o.label))) as HTMLSelectElement;
        pick.value = currentChoice(c, choices[s.sheet]?.[c.header]);
        pick.addEventListener('change', () => {
          choices = choose(choices, s.sheet, c.header, pick.value);
          void run('preview', id);
        });
        const examples = (samples[s.sheet] ?? []).map((r) => r[c.column]).filter(Boolean).join(' · ');
        body.append(h('tr', {}, h('td', {}, c.header || '(no name)'), h('td', {}, c.kind === 'skip' ? '' : c.name), h('td', {}, pick), h('td', { class: 'import-tables-examples' }, examples)));
      });
      planBox.append(h('section', { class: 'import-tables-sheet' },
        h('h3', {}, `${s.sheet} → table ${s.table}`),
        h('p', { class: 'import-tables-line' }, sheetLine(s)),
        ...s.notes.map((n) => h('p', { class: 'import-tables-note' }, n)),
        h('table', {},
          h('thead', {}, h('tr', {}, ...['Column', 'Field', 'Type', 'First rows'].map((t) => h('th', { scope: 'col' }, t)))),
          body)));
    });
    if (plan.notes.length) planBox.append(h('ul', { class: 'import-tables-notes' }, ...plan.notes.map((n) => h('li', {}, n))));
    if (focus) planBox.querySelector<HTMLElement>(`#${focus}`)?.focus();
  };

  const run = async (stage: 'preview' | 'import', focus?: string) => {
    const problem = filesProblem([...(files.files ?? [])], pagesOf());
    if (problem) {
      status.textContent = problem;
      files.focus();
      return;
    }
    busy++;
    settle();
    status.textContent = stage === 'import' ? 'Importing…' : 'Reading the files…';
    try {
      const answer = await api.importTables(form(), importTablesQuery(stage, links.checked));
      if (stage === 'import') {
        const done = answer as ImportTablesDone;
        imported = true;
        status.textContent = `Imported. ${done.summary.join('. ')}.`;
        closeButton.textContent = 'Done';
        closeButton.classList.add('primary');
        onImported();
      } else {
        preview = answer as ImportTablesPreview;
        choices = keepValid(choices, preview.plan);
        status.textContent = '';
        draw(focus);
      }
    } catch (e) {
      status.textContent = (e as Error).message;
    } finally {
      busy--;
      settle();
      if (imported) closeButton.focus();
    }
  };

  const forget = () => {
    preview = undefined;
    choices = {};
    planBox.replaceChildren();
    status.textContent = '';
    settle();
  };
  files.addEventListener('change', forget);
  folder.addEventListener('change', forget);
  links.addEventListener('change', () => { if (preview) void run('preview', 'import-tables-links'); });

  dialog.append(
    h('h2', { id: 'import-tables-title' }, 'Import Tables'),
    h('p', { class: 'import-tables-intro' }, 'Makes whole tables from files another tool exported: CSV or Excel files (a sheet for each table), a Notion Markdown & CSV ZIP, or a folder of Notion pages. Each column gets a field of the right type, and a column naming rows of another sheet becomes a relationship with a portal. Formulas are not translated; they arrive as the values the export holds.'),
    row('import-tables-files', 'Files', files),
    row('import-tables-folder', 'Notion folder', folder),
    h('div', { class: 'import-tables-row' }, h('span', {}), h('label', { class: 'import-tables-check' }, links, ' Make linked-record columns into relationships')),
    planBox,
    h('div', { class: 'actions' }, status, h('span', { class: 'spacer' }), closeButton, previewButton, importButton));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  files.focus();
}
