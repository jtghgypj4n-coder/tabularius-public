// The sheets in files a person exports from another tool (Airtable, Notion, Google Sheets, Excel): a CSV or other
// text file is one sheet, a workbook has one for each of its sheets, Notion's Markdown pages are one table. Read the
// same way for `tabularius import-tables` and for the web client's Import Tables dialog (design.ts), which then plan
// and import them with the store's importTables.

import { notionMarkdownSheet, MAX_IMPORT_ROWS, type SheetInput } from '../../store/src/index.ts';
import { importFileRowIterator } from '../../scripts/src/index.ts';
import { xlsxSheetNames, zipReader } from '../../scripts/src/xlsx.ts';

/** A file that cannot be read as sheets: the message says why, without the file's name. */
export class ImportSheetsError extends Error {}

/** A sheet's name from its file's: without the extension, Airtable's view suffix and the page id Notion adds. */
export function sheetNameOf(file: string): string {
  return file.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]+$/, '').replace(/\s[0-9a-f]{32}$/, '').replace(/\s*-\s*Grid view$/i, '').trim() || 'Sheet';
}

/** The ZIPs of one request together unpack to at most the 50 MB a request body may carry, and hold at most this many CSV files and Markdown pages. */
export const MAX_ZIP_UNPACKED_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_SHEETS = 100;
export const MAX_ZIP_PAGES = 5000;

/** What is left of those limits; one is shared by every file of a request, so twenty ZIPs cannot each use all of it. */
export interface ZipAllowance { bytes: number; csvs: number; pages: number }
export const zipAllowance = (): ZipAllowance => ({ bytes: MAX_ZIP_UNPACKED_BYTES, csvs: MAX_ZIP_SHEETS, pages: MAX_ZIP_PAGES });

/** `base`, or `base 2`, `base 3`... when a table of that name (in any case) is already taken. */
function freeName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}

/**
 * The sheets in a Notion Markdown & CSV export: each CSV is a sheet and the Markdown pages are one more. Only those
 * files are unpacked (pictures and other assets are not), within the limits above. Two CSVs of one name in different
 * folders become `Name` and `Name 2`, and the page table is named after the ZIP unless a CSV has taken that name.
 */
function sheetsFromZip(name: string, data: Uint8Array, allowance: ZipAllowance): SheetInput[] {
  try {
    const archive = zipReader(data, allowance.bytes);
    const wanted: { path: string; kind: 'csv' | 'md' }[] = [];
    const left = { csv: allowance.csvs, md: allowance.pages };
    for (const path of archive.names()) {
      const base = path.split(/[\\/]/).pop()!;
      // macOS adds a __MACOSX folder of ._ resource-fork files to a ZIP; they are not exports.
      if (/(^|[\\/])__MACOSX[\\/]/.test(path) || base.startsWith('._')) continue;
      const kind = /\.csv$/i.test(base) ? 'csv' : /\.md$/i.test(base) ? 'md' : undefined;
      if (!kind) continue;
      if (--left[kind] < 0) {
        throw new ImportSheetsError(kind === 'csv' ? `the ZIPs of one import hold more than ${MAX_ZIP_SHEETS} CSV files` : `the ZIPs of one import hold more than ${MAX_ZIP_PAGES} Markdown pages`);
      }
      wanted.push({ path, kind });
    }
    if (!wanted.length) throw new ImportSheetsError('the ZIP has no CSV or Markdown exports');
    const files = archive.read(wanted.map((w) => w.path));
    allowance.csvs = left.csv;
    allowance.pages = left.md;
    for (const bytes of files.values()) allowance.bytes -= bytes.length;
    const taken = new Set<string>();
    const sheets: SheetInput[] = [];
    const pages: { file: string; text: string }[] = [];
    for (const { path, kind } of wanted) {
      const base = path.split(/[\\/]/).pop()!;
      if (kind === 'csv') {
        for (const sheet of sheetsFromFile(base, files.get(path)!)) sheets.push({ ...sheet, name: freeName(sheet.name, taken) });
      } else pages.push({ file: base, text: Buffer.from(files.get(path)!).toString('utf8') });
    }
    if (pages.length) sheets.push(notionMarkdownSheet(freeName(sheetNameOf(name), taken), pages));
    return sheets;
  } catch (e) {
    throw e instanceof ImportSheetsError ? e : new ImportSheetsError(e instanceof Error ? e.message : String(e));
  }
}

/** The sheets one file holds. `allowance` is shared by the files of one request (a fresh one is for a single file). `name` decides how it is read: .xlsx has several, .md is a Notion page, anything else is text rows. */
export function sheetsFromFile(name: string, data: Uint8Array, allowance: ZipAllowance = zipAllowance()): SheetInput[] {
  const rowsOf = (worksheet?: string) => {
    const rows: (string | number)[][] = [];
    try {
      for (const row of importFileRowIterator(name, data, undefined, undefined, { worksheet })) {
        if (rows.length > MAX_IMPORT_ROWS + 1) throw new ImportSheetsError(`more than ${MAX_IMPORT_ROWS} rows`);
        rows.push(row);
      }
    } catch (e) {
      throw e instanceof ImportSheetsError ? e : new ImportSheetsError(e instanceof Error ? e.message : String(e));
    }
    return rows;
  };
  if (/\.zip$/i.test(name)) return sheetsFromZip(name, data, allowance);
  if (/\.xlsx$/i.test(name)) {
    try {
      return xlsxSheetNames(data).map((sheet) => ({ name: sheet, rows: rowsOf(sheet) }));
    } catch (e) {
      throw e instanceof ImportSheetsError ? e : new ImportSheetsError(e instanceof Error ? e.message : String(e));
    }
  }
  if (/\.md$/i.test(name)) return [notionMarkdownSheet(sheetNameOf(name), [{ file: name.replace(/^.*[\\/]/, ''), text: Buffer.from(data).toString('utf8') }])];
  return [{ name: sheetNameOf(name), rows: rowsOf() }];
}

/** Two sheets cannot make two tables of one name. */
export function checkSheetNames(sheets: SheetInput[]): void {
  const seen = new Set<string>();
  for (const s of sheets) {
    if (seen.has(s.name.toLowerCase())) throw new ImportSheetsError(`two sheets are called "${s.name}"; rename one of the files`);
    seen.add(s.name.toLowerCase());
  }
}
