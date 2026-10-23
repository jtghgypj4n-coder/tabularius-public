// File > Import Tables…: the pure half. What the server's plan says, the choices a person makes on it, and the request
// that sends the files again. No DOM here, so node tests cover it (the dialog is import-tables-dialog.ts).

import { importTooLarge } from './import-dialog.ts';

export type ColumnKind = 'text' | 'number' | 'date' | 'time' | 'timestamp' | 'checkbox' | 'select' | 'multi' | 'link' | 'skip';

export interface PlannedColumn { column: number; header: string; name: string; kind: ColumnKind; inferred: boolean; target?: string; options?: string[]; dayFirst?: boolean }
export interface PlannedSheet { sheet: string; table: string; idField: string; columns: PlannedColumn[]; rows: number; ragged: number; notes: string[] }
export interface ImportTablesPlan { sheets: PlannedSheet[]; notes: string[] }
export interface ImportTablesPreview { plan: ImportTablesPlan; samples: Record<string, string[][]> }
export interface ImportTablesDone { report: { tables: number; rows: number }; summary: string[] }

/** The names a person picks from, in the order the dialog lists them. `link` is offered once for each other sheet. */
export const KIND_LABELS: Record<Exclude<ColumnKind, 'link'>, string> = {
  text: 'Text', number: 'Number', date: 'Date', time: 'Time', timestamp: 'Timestamp', checkbox: 'Checkbox',
  select: 'Pick one (value list)', multi: 'Pick several (value list)', skip: 'Leave out',
};

/** The most files one import takes: the server's limit, said before anything is sent. */
export const MAX_FILES = 20;

/** What a column's pick box holds now: the choice if one was made, else the plan's own kind. */
export function currentChoice(col: PlannedColumn, chosen: string | undefined): string {
  return chosen ?? (col.kind === 'link' ? `link:${col.target ?? ''}` : col.kind);
}

/** The picks for one column: every kind, then a link to each of the other sheets. */
export function choicesFor(plan: ImportTablesPlan, sheet: string): { value: string; label: string }[] {
  return [
    ...(Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map((value) => ({ value, label: KIND_LABELS[value] })),
    ...plan.sheets.filter((s) => s.sheet !== sheet).map((s) => ({ value: `link:${s.sheet}`, label: `Link to ${s.sheet}` })),
  ];
}

/** Choices by sheet, then by the column's name in the sheet. */
export type Choices = Record<string, Record<string, string>>;

/** A sheet or column can be named anything, "__proto__" and "constructor" included: choices are read and written as own properties only. */
const own = <T>(o: Record<string, T> | undefined, key: string): T | undefined => (o && Object.hasOwn(o, key) ? o[key] : undefined);
const put = <T>(o: Record<string, T>, key: string, value: T): void => {
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
};

/** The choice made for a column, if any. */
export const chosen = (choices: Choices, sheet: string, header: string): string | undefined => own(own(choices, sheet), header);

export function choose(choices: Choices, sheet: string, header: string, value: string): Choices {
  const columns: Record<string, string> = Object.assign(Object.create(null), own(choices, sheet));
  put(columns, header, value);
  const out: Choices = Object.assign(Object.create(null), choices);
  put(out, sheet, columns);
  return out;
}

/** A choice that no longer fits the plan (its sheet or column went, or it links to a sheet no longer there) is dropped. */
export function keepValid(choices: Choices, plan: ImportTablesPlan): Choices {
  const out: Choices = Object.create(null);
  for (const [sheet, columns] of Object.entries(choices)) {
    const planned = plan.sheets.find((s) => s.sheet === sheet);
    if (!planned) continue;
    for (const [header, value] of Object.entries(columns)) {
      const link = /^link:(.*)$/.exec(value);
      if (!planned.columns.some((c) => c.header === header)) continue;
      if (link && !plan.sheets.some((s) => s.sheet === link[1] && s.sheet !== sheet)) continue;
      let kept = own(out, sheet);
      if (!kept) {
        kept = Object.create(null) as Record<string, string>;
        put(out, sheet, kept);
      }
      put(kept, header, value);
    }
  }
  return out;
}

/** What the files are, in a sentence, before anything is sent. A problem is the sentence to show; none is the empty string. */
export function filesProblem(files: { name: string; size: number }[], pages: { name: string; size: number }[]): string {
  if (!files.length && !pages.length) return 'Choose the files to import: CSV, Excel or Markdown exports.';
  if (files.length > MAX_FILES) return `Choose at most ${MAX_FILES} files at once.`;
  return importTooLarge('Those files', [...files, ...pages].reduce((n, f) => n + f.size, 0)) ?? '';
}

/** The request body: the files, the pages of a Notion folder, and the column choices. */
export function importTablesForm(files: File[], pages: File[], folder: string, choices: Choices): FormData {
  const form = new FormData();
  for (const f of files) form.append('file', f, f.name);
  for (const p of pages) form.append('pages', p, p.name);
  if (pages.length && folder) form.append('folder', folder);
  if (Object.keys(choices).length) form.append('overrides', JSON.stringify(choices));
  return form;
}

export const importTablesQuery = (stage: 'preview' | 'import', links: boolean): string => `?stage=${stage}${links ? '' : '&links=0'}`;

/** One line for a sheet: "Orders → table Orders, 3 rows, 2 links". */
export function sheetLine(s: PlannedSheet): string {
  const links = s.columns.filter((c) => c.kind === 'link').length;
  const skipped = s.columns.filter((c) => c.kind === 'skip').length;
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return `${s.sheet}: table ${s.table}, ${n(s.rows, 'row')}, ${n(s.columns.length - skipped, 'field')}${links ? `, ${n(links, 'link')}` : ''}`;
}
