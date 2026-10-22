// Import Records with matching: the file's columns matched to the layout's fields (by the assistant when it is on),
// each with the fixes its values need, a preview of what rows become, and the rows that repeat records already in
// the file. The person checks and changes it, picks FileMaker's import action (add new records, update matching
// records in the found set, or replace the found set's data), then imports as one step that Undo takes back, which
// FileMaker can't do for Update and Replace. A column can go into several fields, each taking one part of it (a
// full name into first and last, "Springfield, IL 62704" into city, state and ZIP).

import { h, button } from './design/dom.ts';

/** The most the server takes in one import request, file and form fields together (webclient.ts MAX_FILE), less room for the form around the file. */
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024 - 64 * 1024;

/** Why a file is too big to import, in words the person can act on; undefined when it fits. */
export function importTooLarge(name: string, bytes: number): string | undefined {
  if (bytes <= IMPORT_MAX_BYTES) return undefined;
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0);
  return `${name} is ${mb(bytes)} MB, more than the 50 MB one import takes. Split it into smaller files (repeat the header row in each) and import them one after another.`;
}

export const TRANSFORM_LABELS: Record<string, string> = {
  trim: 'Trim spaces',
  number: 'Read as a number ($1,200.00)',
  'date-mdy': 'Dates are month/day/year',
  'date-dmy': 'Dates are day/month/year',
  'date-ymd': 'Dates are year/month/day',
  'excel-date': 'Excel date numbers',
  time: 'Read as a time (2:30 pm)',
  'yes-no': 'Yes/no as 1/0',
  'value-list': 'Match the value list',
  upper: 'UPPER CASE',
  lower: 'lower case',
  'title-case': 'Title Case',
  digits: 'Digits only',
  phone: 'Phone as (555) 123-4567',
};

/** The parts a column can be split into; '' is the whole value. */
export const PART_LABELS: Record<string, string> = {
  '': 'Whole value',
  'name-first': 'First name',
  'name-middle': 'Middle name',
  'name-last': 'Last name',
  city: 'City',
  state: 'State',
  postcode: 'ZIP / postcode',
};
const partOf = (c: { transforms: string[] }) => c.transforms.find((t) => t in PART_LABELS) ?? '';

export interface ImportColumn { column: number; header: string; field: string | null; transforms: string[]; why?: string; by?: string; sample: string[] }
export interface ImportPreviewRow { row: number; values: Record<string, string | number>; issues: string[]; duplicate?: { of: 'existing'; recordId: number } | { of: 'file'; row: number } }
export interface ImportPlan {
  layout: string;
  table: string;
  rows: number;
  headerRow: boolean;
  fields: { name: string; type: string; valueList?: string; global?: true }[];
  columns: ImportColumn[];
  keys: string[];
  preview: ImportPreviewRow[];
  summary: { ready: number; withIssues: number; duplicatesInFile: number; duplicatesExisting: number };
  ai?: { used: boolean; note?: string };
  /** An Excel workbook's sheets and the one being read; text that opens a quote it never closes says so in `notices`. */
  sheets?: string[];
  sheet?: string;
  notices?: string[];
}
export interface ImportChoice { headerRow: boolean; columns: { column: number; field: string | null; transforms: string[] }[]; keys: string[] }
export interface ImportResult { id: string; foundSet: number[]; imported: number; updated?: number; skipped: { row: number; why: string }[]; blankRows?: number; headerRows?: number; pendingApproval?: number; undoable?: false }
/** FileMaker's import actions. */
export type ImportAction = 'add' | 'update' | 'replace';
/** The found set Update and Replace work on: its record ids, or the find that made it, and its sort. */
export interface ImportFound { ids?: number[]; query?: unknown; sort?: unknown }

export interface ImportDialogApi {
  plan(opts: { ai?: boolean; plan?: ImportChoice; action?: ImportAction; sheet?: string }): Promise<ImportPlan>;
  /** `sheet` is the worksheet the confirmed preview read, so the import reads the same one. */
  apply(plan: ImportChoice, opts: { skipDuplicates: boolean; skipIssues: boolean; action: ImportAction; addRemaining: boolean; sheet?: string }): Promise<ImportResult>;
}

const fixesFor = (type: string, valueList: boolean) => ['trim', ...(type === 'number' ? ['number', 'yes-no', 'digits'] : type === 'date' || type === 'timestamp' ? ['date-mdy', 'date-dmy', 'date-ymd', 'excel-date'] : type === 'time' ? ['time', 'excel-date'] : [...(valueList ? ['value-list'] : []), 'upper', 'lower', 'title-case', 'phone', 'digits'])];

/** The dialog; resolves with the import's result, or undefined when cancelled. */
export function importDialog(fileName: string, first: ImportPlan, api: ImportDialogApi, opts: { ai: boolean; foundCount: number }): Promise<ImportResult | undefined> {
  return new Promise((done) => {
    // `plan` is the last preview the server confirmed; `planAction` is the action it was made for. What the controls show
    // meanwhile (`action`, a select just changed) is only a request, and Import applies the confirmed plan alone.
    let plan = first;
    let action: ImportAction = 'add';
    let planAction: ImportAction = 'add';
    let busy = false;
    /** Set for the whole of an import: nothing may change the preview, enable Import or start a second import until it ends. */
    let applying = false;
    const addRemaining = h('input', { type: 'checkbox', 'data-fk': 'add-remaining' }) as HTMLInputElement;
    let result: ImportResult | undefined;
    const dialog = h('dialog', { class: 'replace-dialog export-dialog import-dialog', 'aria-label': 'Import Records' }) as HTMLDialogElement;
    const status = h('span', { class: 'g-status', 'aria-live': 'polite' });
    const body = h('div', { class: 'import-body' });
    const skipDuplicates = h('input', { type: 'checkbox', 'data-fk': 'skip-duplicates' }) as HTMLInputElement;
    const skipIssues = h('input', { type: 'checkbox', 'data-fk': 'skip-issues' }) as HTMLInputElement;
    const choice = (): ImportChoice => ({ headerRow: plan.headerRow, columns: plan.columns.map((c) => ({ column: c.column, field: c.field, transforms: c.transforms })), keys: plan.keys });
    let pending = 0;
    let opened = false;
    const refresh = async (next: ImportChoice | { ai: true } | { sheet: string }) => {
      if (applying) return;
      const mine = ++pending;
      const asked = action;
      // Until this preview is back, the controls are ahead of the plan: nothing may be imported from it.
      busy = true;
      importButton.disabled = true;
      status.textContent = 'ai' in next ? 'Matching with AI…' : 'sheet' in next ? `Reading ${next.sheet}…` : 'Updating the preview…';
      const sheet = 'sheet' in next ? next.sheet : plan.sheet;
      try {
        // Another sheet has other columns, so its fields are matched afresh.
        const got = await api.plan('ai' in next ? { ai: true, action: asked, sheet } : 'sheet' in next ? { sheet: next.sheet, action: asked } : { plan: next, action: asked, sheet });
        if (mine !== pending) return;
        plan = got;
        planAction = asked;
        status.textContent = plan.ai?.note ?? '';
        busy = false;
        importButton.disabled = false;
        show();
      } catch (e) {
        if (mine !== pending) return;
        // The controls go back to the last preview that worked, so what is shown is what Import applies.
        action = planAction;
        busy = false;
        importButton.disabled = false;
        show();
        status.textContent = (e as Error).message;
      }
    };

    function show(): void {
      const fieldOf = (name: string | null) => plan.fields.find((f) => f.name === name);
      const rows = plan.columns.map((c, i) => {
        const sel = h('select', { 'aria-label': `Field for ${c.header}`, 'data-fk': `field-${i}` },
          h('option', { value: '' }, '(don’t import)'), ...plan.fields.map((f) => h('option', { value: f.name }, `${f.name} (${f.type})`))) as HTMLSelectElement;
        sel.value = c.field ?? '';
        // The first choice gets the focus when the dialog opens, not the scrolling table around it.
        if (i === 0 && !opened) sel.autofocus = true;
        sel.addEventListener('change', () => {
          const next = choice();
          next.columns[i] = { column: c.column, field: sel.value || null, transforms: partOf(c) ? [partOf(c)] : [] };
          void refresh(next);
        });
        // Which part of the column goes into the field, and another field for another part, or this one taken away.
        const extra = plan.columns.findIndex((x) => x.column === c.column) !== i;
        const part = h('select', { 'aria-label': `Part of ${c.header}`, 'data-fk': `part-${i}` }, ...Object.entries(PART_LABELS).map(([v, label]) => h('option', { value: v }, label))) as HTMLSelectElement;
        part.value = partOf(c);
        part.addEventListener('change', () => {
          const next = choice();
          next.columns[i].transforms = [...(part.value ? [part.value] : []), ...next.columns[i].transforms.filter((t) => !(t in PART_LABELS))];
          void refresh(next);
        });
        const split = button(extra ? 'Remove' : 'Split', () => {
          const next = choice();
          if (extra) next.columns.splice(i, 1);
          else {
            // Names or a place, by what the column holds; then the next part along (last name after first).
            const place = partOf(c) ? !partOf(c).startsWith('name-') : c.sample.some((v) => /,\s*[^,\d]*\s\d{5}\b|,\s*[A-Z]{2}\b/.test(v));
            const group = place ? ['city', 'state', 'postcode'] : ['name-first', 'name-last', 'name-middle'];
            const mine = next.columns.filter((x) => x.column === c.column);
            if (!partOf(c)) mine[0].transforms = [group[0], ...mine[0].transforms];
            const used = new Set(mine.map(partOf));
            const take = group.find((t) => !used.has(t));
            if (!take) return;
            next.columns.splice(next.columns.indexOf(mine[mine.length - 1]) + 1, 0, { column: c.column, field: null, transforms: [take] });
          }
          void refresh(next);
        }, { class: 'import-split', 'data-fk': `split-${i}`, title: extra ? 'Stop importing this part of the column' : 'Put parts of this column in different fields' });
        const fixes = h('div', { class: 'import-fixes' }, ...(c.field ? fixesFor(fieldOf(c.field)?.type ?? 'text', !!fieldOf(c.field)?.valueList).map((t) => {
          const box = h('input', { type: 'checkbox', 'data-fk': `fix-${i}-${t}`, ...(c.transforms.includes(t) ? { checked: '' } : {}) }) as HTMLInputElement;
          box.addEventListener('change', () => {
            const next = choice();
            const own = next.columns[i].transforms.filter((x) => x !== t && !(t.startsWith('date-') && box.checked && x.startsWith('date-')));
            next.columns[i].transforms = box.checked ? [...own, t] : own;
            void refresh(next);
          });
          return h('label', { class: 'import-fix' }, box, TRANSFORM_LABELS[t] ?? t);
        }) : []));
        return h('tr', {},
          h('th', { scope: 'row' }, h('div', {}, c.header),
            extra ? '' : h('div', { class: 'import-sample', title: c.sample.join('\n') }, c.sample.slice(0, 3).join(' · ')),
            partOf(c) || extra ? part : '', split),
          h('td', {}, sel, c.why ? h('div', { class: 'import-why' }, `${c.by === 'ai' ? 'AI: ' : ''}${c.why}`) : ''),
          h('td', {}, fixes));
      });
      const mappedFields = plan.columns.filter((c) => c.field).map((c) => c.field!);
      // Update matches on fields that hold one value per record: not globals.
      const matchable = action === 'update' ? mappedFields.filter((f) => !fieldOf(f)?.global) : mappedFields;
      const keys = h('select', { 'data-fk': 'keys', multiple: '', size: String(Math.min(4, Math.max(2, matchable.length))), 'aria-label': action === 'update' ? 'Match records on' : 'Fields that tell records apart' },
        ...matchable.map((f) => h('option', { value: f, ...(plan.keys.includes(f) ? { selected: '' } : {}) }, f))) as HTMLSelectElement;
      keys.addEventListener('change', () => void refresh({ ...choice(), keys: [...keys.selectedOptions].map((o) => o.value) }));
      const header = h('input', { type: 'checkbox', 'data-fk': 'header', ...(plan.headerRow ? { checked: '' } : {}) }) as HTMLInputElement;
      header.addEventListener('change', () => void refresh({ ...choice(), headerRow: header.checked }));
      const s = plan.summary;
      const duplicateNote = plan.keys.length
        ? `${s.duplicatesExisting} ${s.duplicatesExisting === 1 ? 'row has' : 'rows have'} the same ${plan.keys.join(', ')} as ${s.duplicatesExisting === 1 ? 'a record' : 'records'} already in the file; ${s.duplicatesInFile} ${s.duplicatesInFile === 1 ? 'repeats' : 'repeat'} an earlier row of this file. ${skipDuplicates.checked ? 'They will be left out.' : 'They will be added unless you tick the box below.'}`
        : '';
      skipDuplicates.onchange = () => {
        const line = body.querySelector<HTMLElement>('[data-fk="duplicate-summary"]');
        if (line) line.textContent = duplicateNote.replace(/They will be (?:added unless you tick the box below|left out)\.$/, skipDuplicates.checked ? 'They will be left out.' : 'They will be added unless you tick the box below.');
      };
      const cols = mappedFields;
      const found = `${opts.foundCount} record${opts.foundCount === 1 ? '' : 's'}`;
      const radio = (value: ImportAction, label: string, note: string) => {
        const r = h('input', { type: 'radio', name: 'import-action', 'data-fk': `action-${value}`, value, ...(action === value ? { checked: '' } : {}), ...(value !== 'add' && !opts.foundCount ? { disabled: '' } : {}) }) as HTMLInputElement;
        r.addEventListener('change', () => {
          action = value;
          void refresh(choice());
        });
        return h('label', { class: 'row' }, r, ` ${label}`, h('span', { class: 'import-why' }, ` ${note}`));
      };
      const actions = h('fieldset', { class: 'import-action' },
        h('legend', {}, 'Import action'),
        radio('add', 'Add new records', ''),
        radio('update', 'Update matching records in the found set', `(${found}; rows whose match fields hold the same values overwrite them)`),
        radio('replace', 'Replace data in the found set', `(${found}, in order, one row each)`),
        action !== 'add' ? h('label', { class: 'row' }, addRemaining, ' Add remaining data as new records') : '',
        action !== 'add' ? h('p', { class: 'import-why' }, 'Each field imported is overwritten, even with a blank. Undo takes it back afterwards.') : '');
      const note = (r: ImportPreviewRow) => [...r.issues, ...(r.duplicate
        ? [action === 'update'
          ? (r.duplicate.of === 'existing' ? `Updates record ${r.duplicate.recordId}` : `Same as row ${r.duplicate.row}`)
          : action === 'replace' ? '' : r.duplicate.of === 'existing' ? `Already in the file (record ${r.duplicate.recordId})` : `Same as row ${r.duplicate.row}`]
        : [])].filter(Boolean).join('; ');
      const outcome = action === 'replace'
        ? `Replaces ${Math.min(plan.rows - (plan.headerRow ? 1 : 0), opts.foundCount)} of the ${found} in the found set.`
        : action === 'update' ? (plan.keys.length ? `${s.duplicatesExisting} row(s) match a record in the found set.` : 'Choose the fields to match records on.') : '';
      const preview = plan.preview.length ? h('div', { class: 'import-preview', role: 'region', tabindex: '0', 'aria-label': 'Preview' },
        h('table', { class: 'import-map' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Row'), ...cols.map((f) => h('th', {}, f)), h('th', {}, h('span', { class: 'sr-only' }, 'Notes')))),
          h('tbody', {}, ...plan.preview.map((r) => h('tr', { class: r.issues.length ? 'has-issue' : r.duplicate && action === 'add' ? 'is-duplicate' : '' },
            h('td', {}, String(r.row)),
            ...cols.map((f) => h('td', { title: String(r.values[f] ?? '') }, String(r.values[f] ?? ''))),
            h('td', { class: 'import-note' }, note(r))))))) : h('p', {}, 'Nothing to import with these choices.');
      const sheetPick = plan.sheets && plan.sheets.length > 1 ? (() => {
        const pick = h('select', { 'aria-label': 'Worksheet' }, ...plan.sheets.map((n) => h('option', { value: n }, n))) as HTMLSelectElement;
        pick.value = plan.sheet ?? plan.sheets[0];
        pick.addEventListener('change', () => void refresh({ sheet: pick.value }));
        return h('label', { class: 'row' }, 'Worksheet ', pick);
      })() : '';
      // The body is drawn again after every choice; the control being used keeps the focus (or its row's field, if it went).
      const focused = document.activeElement instanceof HTMLElement && body.contains(document.activeElement) ? document.activeElement.dataset.fk : undefined;
      body.replaceChildren(
        sheetPick,
        ...(plan.notices ?? []).map((n) => h('p', { class: 'import-why', role: 'status' }, n)),
        h('p', {}, action === 'add'
          ? `${fileName}: ${plan.rows} row(s) into ${plan.table}. ${s.ready} ready${s.withIssues ? `, ${s.withIssues} with a value that couldn't be fixed` : ''}.${plan.keys.length ? '' : ' No repeat check applies.'}`
          : `${fileName}: ${plan.rows} row(s) into ${plan.table}. ${outcome}${s.withIssues ? ` ${s.withIssues} with a value that couldn't be fixed.` : ''}`),
        action === 'add' && duplicateNote ? h('p', { class: 'import-why', 'data-fk': 'duplicate-summary' }, duplicateNote) : '',
        h('table', { class: 'import-map import-columns' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Column'), h('th', {}, 'Into field'), h('th', {}, 'Fixes'))),
          h('tbody', {}, ...rows)),
        h('label', { class: 'row' }, header, ' The first row holds column names'),
        actions,
        matchable.length && action !== 'replace' ? h('label', { class: 'row' }, action === 'update' ? 'Match records on ' : 'Same record when these match ', keys) : '',
        h('h3', {}, 'Preview'), preview,
        action === 'add' && plan.keys.length ? h('div', {},
          h('label', { class: 'row' }, skipDuplicates, ` Leave out rows that repeat an earlier row or a record already in the file, judged on: ${plan.keys.join(', ')}`),
          h('p', { class: 'import-why' }, 'Tick to leave those rows out; the result will list their row numbers and reasons.')) : '',
        s.withIssues ? h('label', { class: 'row' }, skipIssues, ' Leave out rows with a value that couldn’t be fixed') : '');
      if (focused) {
        const at = (key: string) => body.querySelector<HTMLElement>(`[data-fk="${key}"]`);
        (at(focused) ?? at(`field-${/-(\d+)/.exec(focused)?.[1]}`))?.focus();
      }
    }

    const run = async () => {
      if (applying) return;
      if (busy) {
        status.textContent = 'Wait for the preview to update.';
        return;
      }
      if (!plan.columns.some((c) => c.field)) {
        status.textContent = 'Choose at least one field to import into.';
        return;
      }
      if (planAction === 'update' && !plan.keys.length) {
        status.textContent = 'Choose the fields to match records on.';
        return;
      }
      applying = true;
      body.inert = true;
      importButton.disabled = true;
      status.textContent = 'Importing…';
      try {
        result = await api.apply(choice(), { skipDuplicates: planAction === 'add' && skipDuplicates.checked, skipIssues: skipIssues.checked, action: planAction, addRemaining: planAction !== 'add' && addRemaining.checked, sheet: plan.sheet });
        dialog.close();
      } catch (e) {
        status.textContent = (e as Error).message;
        applying = false;
        body.inert = false;
        importButton.disabled = false;
      }
    };
    const importButton = button('Import', () => void run(), { class: 'primary' });
    dialog.append(
      h('h2', {}, 'Import Records'),
      body,
      h('div', { class: 'actions' },
        opts.ai ? button(plan.ai?.used ? 'Match again with AI' : 'Match with AI', () => void refresh({ ai: true }), { title: 'The assistant matches columns to fields by their names and values, and picks fixes' }) : '',
        status,
        h('a', { href: '/docs/troubleshooting-web-client#an-import-fails-or-its-preview-will-not-load' }, 'Import help'),
        h('span', { class: 'spacer' }),
        button('Cancel', () => dialog.close()),
        importButton,
      ),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      done(result);
    });
    show();
    document.body.append(dialog);
    dialog.showModal();
    opened = true;
  });
}
