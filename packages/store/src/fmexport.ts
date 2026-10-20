// "Leave anytime" export (tier 1 of the way-back-to-FileMaker plan, see
// research/export/way-back-to-filemaker.md). Writes a solution's records in a
// form any FileMaker Pro can ingest — one FMPXMLRESULT XML file per table (the
// grammar FileMaker's own Import Records and "Convert to new file" read), with
// container fields written out as loose files alongside — plus a manifest and a
// plain-language README of exactly what does and doesn't carry over. The
// structural side (schema, layouts, scripts) is shipped as the Save-as-XML
// export, clearly labelled REFERENCE: FileMaker's Save-a-Copy-as-XML form is
// export/compare-only (Claris documents no way to re-import it to rebuild a
// file), so it is a faithful spec to rebuild from by hand, not an auto-import.
//
// This is data + structure-as-reference only. Ongoing sync against a live
// FileMaker Server (tier 2) and true .fmp12 write-back (tier 3) are separate,
// later work and are deliberately not here.
import type { Field, Table } from '../../fmp12/src/index.ts';
import type { Store } from './store.ts';
import { saveAsXml } from './save-as-xml.ts';
import { esc } from './snippet-xml.ts';

/** FileMaker's FMPXMLRESULT field-type vocabulary (TYPE attribute). */
const FIELD_TYPE: Record<Field['type'], string> = {
  text: 'TEXT',
  number: 'NUMBER',
  date: 'DATE',
  time: 'TIME',
  timestamp: 'TIMESTAMP',
  container: 'CONTAINER',
  unknown: 'TEXT',
  boolean: 'NUMBER', integer: 'NUMBER', decimal: 'NUMBER', json: 'TEXT', uuid: 'TEXT',
};

/** One field in the METADATA header. */
export interface ExportField {
  name: string;
  type: Field['type'];
  /** Repetition count declared for the field (1 for an ordinary field). */
  maxRepeat?: number;
}

/**
 * One row of a table for FMPXMLRESULT. `cells` is parallel to the field list;
 * each cell is the field's repetition values as already-stringified DATA text
 * (a plain field is a single-element array). Dates/times/timestamps are the
 * stored ISO-8601 text; a container cell is the relative path of its exported
 * file.
 */
export interface ExportRow {
  recordId: number;
  modId: number;
  cells: string[][];
}

/**
 * Serialise one table's records as an FMPXMLRESULT document — the XML grammar
 * (namespace http://www.filemaker.com/fmpxmlresult) FileMaker Pro reads with
 * Import Records and "Convert a data file to a new file". Pure and
 * side-effect-free so it is unit-testable without a Store.
 */
export function fmpXmlResult(databaseName: string, fields: ExportField[], rows: ExportRow[]): string {
  const meta = fields
    .map((f) => `<FIELD EMPTYOK="YES" MAXREPEAT="${Math.max(1, f.maxRepeat ?? 1)}" NAME="${esc(f.name)}" TYPE="${FIELD_TYPE[f.type]}"/>`)
    .join('');
  const rowsXml = rows
    .map((r) => {
      const cols = r.cells
        .map((cell) => `<COL>${(cell.length ? cell : ['']).map((v) => `<DATA>${esc(v)}</DATA>`).join('')}</COL>`)
        .join('');
      return `<ROW MODID="${r.modId}" RECORDID="${r.recordId}">${cols}</ROW>`;
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<FMPXMLRESULT xmlns="http://www.filemaker.com/fmpxmlresult">` +
    `<ERRORCODE>0</ERRORCODE>` +
    `<PRODUCT BUILD="" NAME="tabularius" VERSION=""/>` +
    `<DATABASE DATEFORMAT="yyyy-MM-dd" LAYOUT="" NAME="${esc(databaseName)}" RECORDS="${rows.length}" TIMEFORMAT="HH:mm:ss"/>` +
    `<METADATA>${meta}</METADATA>` +
    `<RESULTSET FOUND="${rows.length}">${rowsXml}</RESULTSET>` +
    `</FMPXMLRESULT>`
  );
}

/** One field of an FMPDSORESULT export: its name as the layout shows it, and whether it exports a DATA per repetition. */
export interface DsoField {
  name: string;
  repeating?: boolean;
}

/**
 * The element name FMPDSORESULT gives a field (Claris, "XML FMPDSORESULT grammar"): spaces and single colons
 * become underscores and the double colon of a related field becomes a period. A name that is still not an XML
 * name (it starts with a digit, or holds other punctuation) has no element and returns undefined.
 */
export function dsoElementName(field: string): string | undefined {
  const name = field.replace(/::/g, '\u0000').replace(/[ :]/g, '_').replace(/\u0000/g, '.');
  return /^[A-Za-z_\u00C0-\uFFFF][\w.\u00B7\u00C0-\uFFFF-]*$/.test(name) ? name : undefined;
}

/**
 * Serialise records as an FMPDSORESULT document (namespace http://www.filemaker.com/fmpdsoresult), the grammar
 * Claris offers for formatting exported data with a style sheet: ERRORCODE, DATABASE and LAYOUT, then a ROW with
 * MODID and RECORDID per record holding an element per field, named for it, with a DATA per repetition for a
 * repeating field. `cells` is parallel to `fields`, as for fmpXmlResult. The caller has checked every name with
 * dsoElementName.
 */
export function fmpDsoResult(databaseName: string, layout: string, fields: DsoField[], rows: ExportRow[]): string {
  const tags = fields.map((f) => dsoElementName(f.name)!);
  const rowsXml = rows
    .map((r) => {
      const cols = r.cells
        .map((cell, i) => fields[i].repeating
          ? `<${tags[i]}>${(cell.length ? cell : ['']).map((v) => `<DATA>${esc(v)}</DATA>`).join('')}</${tags[i]}>`
          : `<${tags[i]}>${esc(cell[0] ?? '')}</${tags[i]}>`)
        .join('');
      return `<ROW MODID="${r.modId}" RECORDID="${r.recordId}">${cols}</ROW>`;
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<FMPDSORESULT xmlns="http://www.filemaker.com/fmpdsoresult">` +
    `<ERRORCODE>0</ERRORCODE>` +
    `<DATABASE>${esc(databaseName)}</DATABASE>` +
    `<LAYOUT>${esc(layout)}</LAYOUT>` +
    rowsXml +
    `</FMPDSORESULT>`
  );
}

/** A file in the export bundle: text (XML/markdown/manifest) or binary (a container). */
export interface FmExportFile {
  path: string;
  text?: string;
  bytes?: Uint8Array;
}

export interface FmExportOptions {
  /** File name recorded in the exports and the structure file (default the store's name + .fmp12). */
  fileName?: string;
}

/** Make an arbitrary name safe for a path segment. Exported so tests use the same rule. */
export const sanitize = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';

/**
 * Stringify one stored value as FMPXMLRESULT DATA text. Timestamps are stored
 * ISO-8601 with a `T` separator (`yyyy-MM-ddTHH:mm:ss`), but FMPXMLRESULT's
 * TIMESTAMP form is the DATEFORMAT and TIMEFORMAT joined by a space, so the
 * separator is swapped for the date-time shape only.
 */
const formatValue = (v: unknown, type: Field['type']): string => {
  const s = String(v);
  if (type === 'timestamp') return s.replace(/^(\d{4}-\d{2}-\d{2})T/, '$1 ');
  return s;
};

/**
 * The repetition values of one stored cell. A repeating field keeps its
 * repetitions as a JSON-array string (the same encoding the Store reads back);
 * everything else is a single value.
 */
const repetitionValues = (raw: unknown, repeating: boolean): unknown[] => {
  if (repeating && typeof raw === 'string' && raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through: treat as a single opaque value */
    }
  }
  return [raw];
};

/** Reserve a unique path, appending -2, -3… when a sanitised name collides. */
const uniquePath = (used: Set<string>, path: string): string => {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const dot = path.lastIndexOf('.');
  const stem = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
  const ext = dot > path.lastIndexOf('/') ? path.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
};

const extFor = (filename: string | null, mime: string): string => {
  const fromName = filename && /\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1];
  if (fromName) return `.${fromName.toLowerCase()}`;
  const m = /\/(?:x-)?([A-Za-z0-9]+)/.exec(mime)?.[1];
  return m ? `.${m.toLowerCase()}` : '.bin';
};

/**
 * Export the whole hosted solution as a "leave anytime" bundle. This is a
 * full export — the file owner taking all of their data back — so it takes no
 * account and applies no per-account record- or field-level scoping; every
 * row and column of every base table is written. (It still goes through the
 * Store's read-only `query`, whose guard refuses the internal `_fm_` tables,
 * so account credentials and the password verifier — which live only in those
 * tables and in the schema, never in a base-table column — are never emitted;
 * the structure file drops them too.) Writes:
 *   data/<Table>.xml        — FMPXMLRESULT records, one file per base table
 *   containers/<Table>/...  — each container field's file, referenced by path
 *   structure/<file>.xml    — the Save-as-XML structural spec (REFERENCE only)
 *   manifest.json           — tables, counts and file list
 *   README-leaving.md       — what carries over and what doesn't
 */
export function fmExport(store: Store, opts: FmExportOptions = {}): { files: FmExportFile[] } {
  const fileName = opts.fileName ?? `${store.name}.fmp12`;
  const files: FmExportFile[] = [];
  const usedPaths = new Set<string>();
  const manifestTables: { name: string; records: number; fields: number; dataFile: string; containers: number; missingContainers?: number }[] = [];

  for (const table of store.schema.tables) {
    // Only stored columns export: summary fields and unstored calculations are
    // recomputed by FileMaker and have no stored value, so they are left out.
    const exported = table.fields.filter((f) => f.kind !== 'summary' && !f.options?.unstored);
    const fields: ExportField[] = exported.map((f) => ({ name: f.name, type: f.type, maxRepeat: f.options?.repetitions ?? 1 }));
    const repeatingFields = new Set(exported.filter((f) => (f.options?.repetitions ?? 1) > 1).map((f) => f.name));
    const containerFields = new Set(fields.filter((f) => f.type === 'container').map((f) => f.name));
    const count = store.recordCount(table.name);
    const raw = count > 0 ? store.query(`SELECT * FROM "${table.name.replace(/"/g, '""')}"`, count) : [];

    let containers = 0;
    let missingContainers = 0;
    const rows: ExportRow[] = raw.map((row) => {
      const recordId = Number(row._fm_record_id ?? 0);
      const modId = Number(row._fm_mod_id ?? 0);
      const cells = fields.map((f) => {
        // Each repetition of the field becomes one DATA element.
        const reps = repetitionValues(row[f.name], repeatingFields.has(f.name));
        const out = reps.map((v, rep) => {
          if (v === null || v === undefined || v === '') return '';
          if (!containerFields.has(f.name)) return formatValue(v, f.type);
          const id = Number(v);
          if (!Number.isInteger(id)) return '';
          const info = store.containerInfo(id);
          // A container stored outside the file whose source is gone exports as
          // an empty cell, not a referenced 0-byte file that reads as present.
          if (!info || info.external?.missing) {
            if (info) missingContainers++;
            return '';
          }
          const file = store.container(id);
          if (!file || file.data.length === 0) {
            missingContainers++;
            return '';
          }
          const repSuffix = reps.length > 1 ? `-r${rep + 1}` : '';
          const base = `rec${recordId}-${sanitize(f.name)}${repSuffix}-${sanitize(info.filename ?? String(id))}${info.filename ? '' : extFor(null, info.mime)}`;
          const path = uniquePath(usedPaths, `containers/${sanitize(table.name)}/${base}`);
          files.push({ path, bytes: file.data });
          containers++;
          return path;
        });
        return out.length ? out : [''];
      });
      return { recordId, modId, cells };
    });

    const dataFile = uniquePath(usedPaths, `data/${sanitize(table.name)}.xml`);
    files.push({ path: dataFile, text: fmpXmlResult(fileName, fields, rows) });
    manifestTables.push({ name: table.name, records: rows.length, fields: fields.length, dataFile, containers, ...(missingContainers ? { missingContainers } : {}) });
  }

  // The structural spec — REFERENCE only (FileMaker can't re-import it).
  const structureFile = `structure/${sanitize(fileName)}.save-as-xml.xml`;
  files.push({ path: structureFile, text: saveAsXml(store.schema, { fileName }) });

  const manifest = {
    file: fileName,
    exportedAt: new Date().toISOString(),
    tables: manifestTables,
    structureFile,
    structureNote: 'Reference only. FileMaker Pro cannot re-import this; use it to rebuild structure by hand or to diff. See README-leaving.md.',
  };
  files.push({ path: 'manifest.json', text: JSON.stringify(manifest, null, 2) });
  files.push({ path: 'README-leaving.md', text: readme(fileName, manifestTables) });

  return { files };
}

function readme(fileName: string, tables: { name: string; records: number; containers: number }[]): string {
  const totalRecords = tables.reduce((n, t) => n + t.records, 0);
  const totalContainers = tables.reduce((n, t) => n + t.containers, 0);
  return `# Leaving: your data back in FileMaker

This folder is a complete export of **${fileName}** so you can return to FileMaker
at any time. It was made from your current data in Tabularius.

## What's here

- \`data/\` — one \`.xml\` file per table, ${totalRecords} record(s) in all, in
  FileMaker's own FMPXMLRESULT format. In FileMaker Pro, use **File ▸ Import
  Records ▸ File…** to bring a table's records into a matching table, or **File ▸
  Convert a data file to a new file** (older: "Open" the XML) to make a fresh
  table from one. FileMaker maps columns by the field names in the file.
- \`containers/\` — ${totalContainers} container file(s), written out as ordinary
  files. Each container field in the data refers to its file by path.
- \`structure/\` — a Save-as-XML description of your schema, layouts, scripts,
  value lists, relationships and custom functions, **for reference only**.
- \`manifest.json\` — the table list, record counts and file names.

## What carries over cleanly

- Every table's records: text, number, date, time and timestamp values. Dates
  are written \`yyyy-MM-dd\`, times \`HH:mm:ss\`, and timestamps
  \`yyyy-MM-dd HH:mm:ss\`; pick the matching format in FileMaker's import dialog
  if it asks.
- Repeating fields carry every repetition.
- Container files, as the loose files in \`containers/\`.

## What does NOT carry over automatically (do these by hand)

- **Structure.** FileMaker's own Save-as-XML (what \`structure/\` contains) is a
  format FileMaker can only *read for comparison* — it cannot rebuild a file from
  it. So schema, layouts, scripts, value lists, relationships and calculations do
  not re-import on their own. If you kept your original FileMaker file, you don't
  need them — your structure is already there, and you only need the data above.
  If you built new structure in Tabularius, use \`structure/\` as the spec to
  recreate it in FileMaker.
- **Container contents on import.** FileMaker's record import never loads
  container data itself; after importing records, re-insert the files from
  \`containers/\` (or set the fields to reference them). A container whose file
  was stored outside the database and is no longer there exports as an empty
  cell; \`manifest.json\` counts any such gaps per table.
- **Accounts and passwords.** Account credentials and password data are never
  exported, by design.
- **Summary fields** are recomputed by FileMaker, so they aren't exported.

Your original FileMaker file is never touched by Tabularius.
`;
}
