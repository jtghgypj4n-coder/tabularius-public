// POST /tabularius/design/v1/databases/{db}/import-tables: the web client's Import Tables dialog. The files a person
// exported from another tool arrive as a multipart/form-data body and are read, planned and imported by the same code
// as `tabularius import-tables` (import-sheets.ts, and planImportTables and importTables in the store). Nothing is kept
// between the two stages: both send the files again, so a preview never leaves anything behind.

import type { IncomingMessage } from 'node:http';
import { MAX_IMPORT_COLUMNS, importTables, importTablesSummary, notionMarkdownSheet, planImportTables, type ColumnOverrides, type SheetInput, type Store } from '../../store/src/index.ts';
import type { Privileges } from '../../store/src/index.ts';
import { ApiError, multipartParts, readBody } from './dataapi.ts';
import { ImportSheetsError, checkSheetNames, sheetsFromFile } from './import-sheets.ts';
import { parseRequestJson } from './request-json.ts';

/** The body cap: the same 50 MB a record import takes, plus the form's own bytes. */
const MAX_BODY = 50 * 1024 * 1024 + 256 * 1024;
const MAX_FILES = 20;
const MAX_PAGES = 5000;
/** Rows of each sheet shown beside its plan, cut so a preview of a wide file stays small. */
const SAMPLE_ROWS = 3;
const SAMPLE_CHARS = 80;

export interface ImportTablesFiles { sheets: SheetInput[]; overrides: ColumnOverrides }

/** The sheets and column choices in a request body. */
export function readImportTablesRequest(contentType: string, body: Buffer): ImportTablesFiles {
  const sheets: SheetInput[] = [];
  const pages: { file: string; text: string }[] = [];
  let folder = '';
  let overrides: ColumnOverrides = {};
  let files = 0;
  for (const part of multipartParts(contentType, body)) {
    if (part.name === 'file' && part.filename) {
      if (!part.data.length) throw new ApiError(3, `${part.filename} is empty`, 400);
      if (++files > MAX_FILES) throw new ApiError(3, `Choose at most ${MAX_FILES} files at once`, 400);
      try {
        sheets.push(...sheetsFromFile(part.filename, part.data));
      } catch (e) {
        if (e instanceof ImportSheetsError) throw new ApiError(3, `${part.filename}: ${e.message}`, 400);
        throw e;
      }
    } else if (part.name === 'pages' && part.filename) {
      if (/\.md$/i.test(part.filename)) {
        if (pages.length >= MAX_PAGES) throw new ApiError(3, `A folder of at most ${MAX_PAGES} pages is imported at once`, 400);
        pages.push({ file: part.filename, text: part.data.toString('utf8') });
      }
    } else if (part.name === 'folder') folder = part.data.toString('utf8').trim().slice(0, 100);
    else if (part.name === 'overrides') overrides = overridesOf(part.data.toString('utf8'));
  }
  if (pages.length) sheets.push(notionMarkdownSheet(folder || 'Pages', pages.sort((a, b) => a.file.localeCompare(b.file))));
  if (!sheets.length) throw new ApiError(3, 'Choose the files to import: CSV, Excel, a Notion Markdown & CSV ZIP, or Markdown exports', 400);
  try {
    checkSheetNames(sheets);
  } catch (e) {
    throw new ApiError(3, (e as Error).message, 400);
  }
  return { sheets, overrides };
}

/** {sheet: {column: kind}}, each a text. */
function overridesOf(text: string): ColumnOverrides {
  let parsed: unknown;
  try {
    parsed = parseRequestJson(text || '{}');
  } catch {
    throw new ApiError(3, 'The column choices should be JSON: {"Sheet": {"Column": "kind"}}', 400);
  }
  const bad = () => new ApiError(3, 'The column choices should be JSON: {"Sheet": {"Column": "kind"}}', 400);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw bad();
  const out: ColumnOverrides = Object.create(null);
  for (const [sheet, columns] of Object.entries(parsed)) {
    if (columns === null || typeof columns !== 'object' || Array.isArray(columns)) throw bad();
    const kinds: Record<string, string> = Object.create(null);
    for (const [column, kind] of Object.entries(columns)) {
      if (typeof kind !== 'string') throw bad();
      kinds[column] = kind;
    }
    out[sheet] = kinds as ColumnOverrides[string];
  }
  return out;
}

/**
 * `stage=preview` (the default): the plan, with the first rows of each sheet; nothing is written. `stage=import`: makes the
 * tables and says what it made, in counts. `links=0` leaves linked-record columns as plain columns.
 */
export async function importTablesRoute(req: IncomingMessage, params: URLSearchParams, store: Store, privileges: Privileges, session: { account: string; readOnly?: boolean; layoutScope?: unknown }): Promise<unknown> {
  if (req.method !== 'POST') throw new ApiError(3, 'Command is unavailable', 405);
  // It makes tables: a token limited to reading, or to some layouts, is not for that, whoever's account it is.
  if (session.readOnly || session.layoutScope) throw new ApiError(9, 'This token cannot import tables', 403);
  const type = req.headers['content-type'] ?? '';
  const body = await readBody(req, MAX_BODY);
  const { sheets, overrides } = readImportTablesRequest(type, body);
  const plan = planImportTables(sheets, { overrides, existing: store.schema.tables.map((t) => t.name), links: params.get('links') !== '0' });
  if (params.get('stage') !== 'import') {
    const cut = (c: string | number | undefined) => String(c ?? '').slice(0, SAMPLE_CHARS);
    const samples = Object.fromEntries(sheets.map((s) => [s.name, s.rows.slice(1, 1 + SAMPLE_ROWS).map((r) => r.slice(0, MAX_IMPORT_COLUMNS).map(cut))]));
    return { plan, samples };
  }
  const report = importTables(store, sheets, plan, { privileges, account: session.account });
  return { report, summary: importTablesSummary(report) };
}
