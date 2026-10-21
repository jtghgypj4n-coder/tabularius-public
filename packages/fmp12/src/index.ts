// Public API of the fmp12 reader.

import { FmpFile, fileSource, type BlockSource } from './file.ts';
import { readSchema, type Schema, type Table } from './schema.ts';
import { readRecords, type RawRecord } from './records.ts';
import { readContainers, type ContainerBlob } from './containers.ts';
import { typedValue, inferDateOrder, inferDatePadding, DateOrderConflict, type DateStyle, type DateOrder, type Value } from './values.ts';

export { FmpFile, FmpError, BLOCK_SIZE, bufferSource, fileSource, type Header, type Block, type BlockSource, encryptionInfo } from './file.ts';
export { decodePayload, pathValue, pathInt, type Chunk } from './chunks.ts';
export { decodeScsu, decodeText, inspectText } from './scsu.ts';
export { buildTree, Node, segmentOf, type Segment } from './tree.ts';
export { readRecords, decodeFieldKey, type RawRecord } from './records.ts';
export { typedValue, parseDate, parseTime, parseTimestamp, inferDateOrder, inferDatePadding, dateOrderOf, type DateStyle, type DateOrder, type Value } from './values.ts';
export { scriptStepName, scriptStepId, SCRIPT_STEP_NAMES } from './script-steps.ts';
export * from './script-params.ts';
export { decodeCalc, observeCalcs, type CalcObserver, FILEMAKER_FUNCTIONS, PLUGIN_FUNCTIONS, getParameterName, calcTokens, schemaFieldNamer, externalFieldNames, type FieldNamer, type CalcDecodeResult } from './calc.ts';
export { readContainers, containerBlobs, readBlob as readContainerBlob, readImageLibrary, containerRefId, mimeOf as containerMime, type ContainerBlob } from './containers.ts';
export * from './schema.ts';
export { menuItems, MENU_COMMANDS, type CustomMenu, type CustomMenuItem, type CustomMenuSet } from './menus.ts';

export interface RecordRow {
  /** FileMaker's internal record id. */
  recordId: number;
  /** Field name -> value; repeating fields give an array of repetitions. */
  fields: Record<string, Value | Value[]>;
}

/** An opened FileMaker file: schema plus record access by table name. */
export class FmpDatabase {
  readonly file: FmpFile;
  private schemaCache?: Schema;
  private dateOrderCache?: DateOrder;
  private dateSamples?: string[];

  constructor(src: Uint8Array | BlockSource, passphrase?: string) {
    this.file = new FmpFile(src, passphrase);
  }

  /**
   * Opens a file on disk; blocks are read as needed, so any size works. An
   * Encryption at Rest file needs its passphrase (the one set in FileMaker).
   */
  static open(path: string, passphrase?: string): FmpDatabase {
    const source = fileSource(path);
    try {
      return new FmpDatabase(source, passphrase);
    } catch (error) {
      source.close?.();
      throw error;
    }
  }

  close(): void {
    this.file.close();
  }

  get schema(): Schema {
    return (this.schemaCache ??= readSchema(this.file));
  }

  table(nameOrId: string | number): Table {
    const t = this.schema.tables.find((t) => t.id === nameOrId || t.name === nameOrId);
    if (!t) throw new Error(`no table ${JSON.stringify(nameOrId)}`);
    return t;
  }

  /** Raw stored text, keyed by field id. */
  *rawRecords(table: string | number): Generator<RawRecord> {
    const t = this.table(table);
    yield* readRecords(this.file, t.id, new Set(t.fields.map((f) => f.id)));
  }

  /** Container data (images, PDFs, files) stored for a table, by blob id. */
  containers(table: string | number): Map<number, ContainerBlob> {
    return readContainers(this.file, this.table(table).id);
  }

  /** Date order used by the file, inferred from stored date values. */
  get dateOrder(): DateOrder {
    if (this.dateOrderCache) return this.dateOrderCache;
    const samples: string[] = (this.dateSamples = []);
    const where = new Map<string, string>();
    for (const t of this.schema.tables) {
      const dateFields = t.fields.filter((f) => f.type === 'date' || f.type === 'timestamp');
      if (!dateFields.length) continue;
      let n = 0;
      for (const r of this.rawRecords(t.id)) {
        for (const f of dateFields) for (const value of r.values.get(f.id) ?? []) {
          samples.push(value);
          if (!where.has(value.trim())) where.set(value.trim(), `${t.name}::${f.name}, record ${r.id}`);
        }
        if (++n >= 200) break;
      }
    }
    try {
      return (this.dateOrderCache = inferDateOrder(samples));
    } catch (e) {
      if (!(e instanceof DateOrderConflict)) throw e;
      const at = (v: string) => `"${v}" (${where.get(v) ?? 'a sampled record'})`;
      throw new Error(`conflicting date order in stored dates: ${at(e.first)} reads as ${e.firstOrder} but ${at(e.second)} reads as ${e.secondOrder}. Correct the date that is wrong in the source file, then open it again`, { cause: e });
    }
  }

  /** Date format for writing dates as text: the order, and whether months and days get two digits. */
  get dateStyle(): DateStyle {
    const order = this.dateOrder;
    return inferDatePadding(this.dateSamples ?? []) ? { order, padded: true } : order;
  }

  /** Records with typed values keyed by field name. */
  *records(table: string | number): Generator<RecordRow> {
    const t = this.table(table);
    const byId = new Map(t.fields.map((f) => [f.id, f]));
    const order = t.fields.some((f) => f.type === 'date' || f.type === 'timestamp') ? this.dateOrder : 'MDY';
    for (const r of this.rawRecords(t.id)) {
      const fields: RecordRow['fields'] = {};
      for (const [id, reps] of r.values) {
        const f = byId.get(id)!;
        const vals = reps.map((v) => typedValue(v, f.type, order));
        fields[f.name] = vals.length === 1 ? vals[0] : vals;
      }
      yield { recordId: r.id, fields };
    }
  }
}
export { readLayoutDesigns, decodeMergeFields, readThemes, readFonts, type LayoutDesign, type LayoutDesigns, type LayoutComponent, type LayoutView, readLayoutView, readViewsAllowed, readTabOrder, type LayoutObject, type LayoutPart, type PartOptions, type ObjectKind, type ObjectStyle, type FieldRef as LayoutFieldRef, type Condition, type DataFormat, type ContainerFormat, CONTAINER_FORMAT_CODES, type NumberFormat, type DateFormat, type TimeFormat, type FieldDisplay, type FieldBehavior, type FieldEntry, readFieldBehavior, type PartKind, type Bounds, type ButtonAction, type IconDisplay, type ScriptTrigger, type TriggerMode, type WebViewerOptions, webViewerOptions, webViewerFlags, WEB_VIEWER_DEFAULTS, ROTATABLE_KINDS, quarterTurn } from './layouts.ts';
export { readTheme, readRules, withStyleGaps, withStyleProbe, type StyleGap, fontStack, cssText, STYLE_ELEMENTS, STYLE_PARTS, STYLE_STATES, type Theme, type ThemeStyle, type StyleRule, type FontTable } from './styles.ts';
export { Pb, pbParse, type PbField } from './proto.ts';
