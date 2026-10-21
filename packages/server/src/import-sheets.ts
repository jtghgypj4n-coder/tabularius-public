// The sheets in files a person exports from another tool (Airtable, Notion, Google Sheets, Excel): a CSV or other
// text file is one sheet, a workbook has one for each of its sheets, Notion's Markdown pages are one table. Read the
// same way for `tabularius import-tables` and for the web client's Import Tables dialog (design.ts), which then plan
// and import them with the store's importTables.

import { notionMarkdownSheet, MAX_IMPORT_ROWS, type SheetInput } from '../../store/src/index.ts';
import { importFileRowIterator } from '../../scripts/src/index.ts';
import { unzip, xlsxSheetNames } from '../../scripts/src/xlsx.ts';

/** A file that cannot be read as sheets: the message says why, without the file's name. */
export class ImportSheetsError extends Error {}

/** A sheet's name from its file's: without the extension, Airtable's view suffix and the page id Notion adds. */
export function sheetNameOf(file: string): string {
  return file.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]+$/, '').replace(/\s[0-9a-f]{32}$/, '').replace(/\s*-\s*Grid view$/i, '').trim() || 'Sheet';
}

/** The sheets one file holds. `name` decides how it is read: .xlsx has several, .md is a Notion page, anything else is text rows. */
export function sheetsFromFile(name: string, data: Uint8Array): SheetInput[] {
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
  if (/\.zip$/i.test(name)) {
    try {
      const files = unzip(data);
      const sheets: SheetInput[] = [];
      const pages: { file: string; text: string }[] = [];
      for (const [path, bytes] of files) {
        // Notion's Markdown & CSV export is a ZIP. Ignore its asset files; only
        // the textual table and page exports become imported tables.
        if (/\.csv$/i.test(path)) sheets.push(...sheetsFromFile(path.split(/[\\/]/).pop()!, bytes));
        else if (/\.md$/i.test(path)) pages.push({ file: path.split(/[\\/]/).pop()!, text: Buffer.from(bytes).toString('utf8') });
      }
      if (pages.length) sheets.push(notionMarkdownSheet(sheetNameOf(name), pages));
      if (!sheets.length) throw new ImportSheetsError('the ZIP has no CSV or Markdown exports');
      return sheets;
    } catch (e) {
      throw e instanceof ImportSheetsError ? e : new ImportSheetsError(e instanceof Error ? e.message : String(e));
    }
  }
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
