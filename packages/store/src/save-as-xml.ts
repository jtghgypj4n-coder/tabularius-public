// Serialising a Schema as FileMaker's "Save a Copy as XML" (FMSaveAsXML) — the
// form File ▸ Save a Copy As… ▸ XML writes. FileMaker Pro can't import it, but
// FileMaker 26's FMUpgradeTool builds a new .fmp12 from it (--generateDBFile)
// and takes its element shapes in patch files (docs/research/write-back.md).
// Unlike the Database Design Report (ddr.ts, <FMPReport>, a one-way analysis
// report), it mirrors FileMaker's create-then-modify ordering: every
// object is created in an <AddAction> pass, and field calculations — which
// reference table occurrences that must exist first — are attached in a later
// <ModifyAction> pass.
//
// Emitted so far: the envelope, the BaseDirectory, BaseTable and TableOccurrence
// catalogs, custom functions (signatures + their calculations), FieldsForTables
// (fields created plain in the AddAction pass), value lists, relationships, the
// ModifyAction pass that attaches each field's calculation as <Text>, the
// security catalogs (privilege-set stubs, extended privileges, and accounts
// with no credentials), and the Metadata tail. Scripts (catalog + steps),
// layouts/themes, external data sources, the full privilege <access> element
// and custom menus are later stages. See
// /mnt/project-files/research/export/save-as-xml.md for the full format map and
// build plan. Secrets rule (same as the DDR): schema only — no password
// verifier, no data-source credentials, no record data.

import { createHash } from 'node:crypto';
import type {
  Account,
  CatalogItem,
  CustomFunction,
  Field,
  JoinOperator,
  PrivilegeSet,
  Relationship,
  Schema,
  Table,
  TableOccurrence,
  ValueList,
} from '../../fmp12/src/index.ts';
import { cdata, el, esc } from './snippet-xml.ts';
import { parseXml, type XmlElement } from './snippet.ts';

export interface SaveAsXmlOptions {
  /** File name recorded in the envelope (default "export.fmp12"). */
  fileName?: string;
  /** Source FileMaker version string for the envelope (default "12.0.0"). */
  source?: string;
  /**
   * The FileMaker file's own object UUIDs, from `uuidsFromSaveAsXml` on that
   * file's Save as XML. Objects found here are written with their real UUID, so
   * the output can address them in an FMUpgradeTool patch; the rest keep the
   * stand-in GUIDs below.
   */
  uuids?: Map<string, string>;
}

// Deterministic v5-style UUID from a stable seed, so re-exporting the same
// schema yields the same GUIDs. FileMaker writes uppercase GUIDs and import
// tolerates fresh ones. The reader does not decode each object's original UUID
// yet, so the `uuids` option takes them from the file's own Save as XML
// (uuidsFromSaveAsXml at the end of this file). The namespace is a fixed
// 16 bytes so output is reproducible and collision-free across object kinds.
const UUID_NS = Buffer.from('6f70656e6862616d2d73617665617378', 'hex'); // "tabularius-saveasx"
// The real UUIDs for the saveAsXml call in progress (it is synchronous, so a
// module-level slot is safe and spares threading them through every helper).
let realUuids: Map<string, string> | undefined;
function guid(seed: string): string {
  const real = realUuids?.get(seed);
  if (real) return real;
  const h = createHash('sha1').update(UUID_NS).update(seed).digest();
  h[6] = (h[6] & 0x0f) | 0x50; // version 5
  h[8] = (h[8] & 0x3f) | 0x80; // RFC 4122 variant
  const x = h.subarray(0, 16).toString('hex').toUpperCase();
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
const uuidEl = (seed: string) => `<UUID>${guid(seed)}</UUID>`;

// FileMaker's XML datatype / fieldtype vocabularies. An unknown reader value
// falls back to the least surprising shape (Text / Normal).
const DATATYPE: Record<Field['type'], string> = {
  text: 'Text', number: 'Number', date: 'Date', time: 'Time', timestamp: 'Timestamp', container: 'Container', unknown: 'Text',
  boolean: 'Number', integer: 'Number', decimal: 'Number', json: 'Text', uuid: 'Text',
};
const FIELDTYPE: Record<Field['kind'], string> = {
  normal: 'Normal', calculation: 'Calculated', summary: 'Summary', unknown: 'Normal',
};

/** <BaseTable id= name=> with its UUID. Fields live in FieldsForTables. */
function baseTable(t: Table): string {
  return `<BaseTable id="${t.id}" name="${esc(t.name)}">${uuidEl(`basetable:${t.id}`)}<TagList></TagList></BaseTable>`;
}

/** The BaseTableCatalog: one <BaseTable> per base table. */
function baseTableCatalog(tables: Table[]): string {
  return `<BaseTableCatalog membercount="${tables.length}">${uuidEl('basetablecatalog')}${tables.map(baseTable).join('')}</BaseTableCatalog>`;
}

/**
 * <TableOccurrence> for a local base table. The relationship-graph geometry
 * (CoordRect, Color) is emitted from what the reader recovered, defaulting to a
 * zero rect when unknown. Occurrences that point at an external data source are
 * skipped for now (type would be "External" with a source reference) — a
 * follow-up alongside ExternalDataSourceCatalog.
 */
function tableOccurrence(occ: TableOccurrence, byId: Map<number, Table>): string | undefined {
  if (occ.baseTableId === undefined || occ.dataSourceId !== undefined) return undefined;
  const base = byId.get(occ.baseTableId);
  const g = occ.graph;
  const rect = g
    ? `<CoordRect top="${g.top}" left="${g.left}" bottom="${g.top + g.height}" right="${g.left + g.width}"></CoordRect>`
    : `<CoordRect top="0" left="0" bottom="0" right="0"></CoordRect>`;
  const source =
    `<BaseTableSourceReference type="BaseTableReference">` +
    `<BaseTableReference id="${occ.baseTableId}" name="${esc(base?.name ?? '')}" UUID="${guid(`basetable:${occ.baseTableId}`)}"></BaseTableReference>` +
    `</BaseTableSourceReference>`;
  return (
    `<TableOccurrence viewState="Full" id="${occ.id}" name="${esc(occ.name)}" type="Local">` +
    uuidEl(`occurrence:${occ.id}`) + source + rect + `<TagList></TagList></TableOccurrence>`
  );
}

/** The TableOccurrenceCatalog: one <TableOccurrence> per local occurrence. */
function tableOccurrenceCatalog(occ: TableOccurrence[], byId: Map<number, Table>): string {
  const items = occ.map((o) => tableOccurrence(o, byId)).filter((s): s is string => s !== undefined);
  return `<TableOccurrenceCatalog membercount="${items.length}">${uuidEl('occurrencecatalog')}<TagList></TagList>${items.join('')}</TableOccurrenceCatalog>`;
}

/**
 * A plain <Field>: type, datatype and comment only. Auto-enter, validation and
 * storage options, and the calculation body of a Calculated field, are later
 * stages — a Calculated/Summary field is created here with its type but not yet
 * its formula.
 */
function field(f: Field, tableId: number): string {
  return (
    `<Field DefaultStyle="" id="${f.id}" name="${esc(f.name)}" fieldtype="${FIELDTYPE[f.kind]}" datatype="${DATATYPE[f.type]}" comment="${esc(f.comment ?? '')}">` +
    uuidEl(`field:${tableId}:${f.id}`) + `<TagList></TagList></Field>`
  );
}

/** FieldsForTables: a <FieldCatalog> per base table, each listing its fields. */
function fieldsForTables(tables: Table[]): string {
  const catalogs = tables
    .map((t) => {
      const fields = t.fields.map((f) => field(f, t.id)).join('');
      return (
        `<FieldCatalog>${uuidEl(`fieldcatalog:${t.id}`)}<TagList></TagList>` +
        `<BaseTableReference id="${t.id}" name="${esc(t.name)}" UUID="${guid(`basetable:${t.id}`)}"></BaseTableReference>` +
        `<ObjectList membercount="${t.fields.length}">${fields}</ObjectList></FieldCatalog>`
      );
    })
    .join('');
  return `<FieldsForTables membercount="${tables.length}">${catalogs}</FieldsForTables>`;
}

/**
 * The ModifyAction pass: attaches each field's calculation after the occurrences
 * it references exist. A field with a calculation (a Calculated field, or a
 * normal field with an auto-enter calculation) is re-listed by reference, with
 * its formula as <Text> only — FileMaker rebuilds the <ChunkList> token cache on
 * import, so we omit it (see research/export/save-as-xml.md). Fields are grouped
 * per table into a FieldCatalog, mirroring the AddAction pass. Calculations that
 * still carry an unresolved external-file reference (a ⟨field:…⟩ marker) are
 * emitted as-is — the same limit as elsewhere, pending the other file.
 */
function modifyAction(tables: Table[], occById: Map<number, TableOccurrence>, occByBase: Map<number, TableOccurrence>): string {
  const catalogs = tables
    .map((t) => {
      const calcFields = t.fields.filter((f) => f.calculation !== undefined);
      if (!calcFields.length) return '';
      const items = calcFields
        .map((f) => {
          const ctx = (f.calculationContextId !== undefined ? occById.get(f.calculationContextId) : undefined) ?? occByBase.get(t.id);
          const toRef = ctx
            ? `<TableOccurrenceReference id="${ctx.id}" name="${esc(ctx.name)}" UUID="${guid(`occurrence:${ctx.id}`)}"></TableOccurrenceReference>`
            : '';
          const calc = `<Calculation>${toRef}<Text>${cdata(f.calculation!)}</Text></Calculation>`;
          return `<Field><FieldReference id="${f.id}" name="${esc(f.name)}" repetition="1" UUID="${guid(`field:${t.id}:${f.id}`)}">${calc}</FieldReference></Field>`;
        })
        .join('');
      return (
        `<FieldCatalog><BaseTableReference id="${t.id}" name="${esc(t.name)}" UUID="${guid(`basetable:${t.id}`)}"></BaseTableReference>` +
        `<ObjectList membercount="${calcFields.length}">${items}</ObjectList></FieldCatalog>`
      );
    })
    .filter((s) => s !== '');
  if (!catalogs.length) return '';
  return `<ModifyAction membercount="1"><FieldsForTables membercount="${catalogs.length}">${catalogs.join('')}</FieldsForTables></ModifyAction>`;
}

/** ExtendedPrivilegesCatalog: the keyword privileges (fmapp, fmrest, …). */
function extendedPrivilegesCatalog(exts: CatalogItem[]): string {
  if (!exts.length) return '';
  // FileMaker's built-in descriptions (e.g. "Access via ODBC/JDBC") are not
  // stored in the file, so the description is left empty.
  const items = exts
    .map((e) => `<ExtendedPrivilege id="${e.id}" name="${esc(e.name)}"><Description></Description>${uuidEl(`ext:${e.id}`)}<TagList></TagList></ExtendedPrivilege>`)
    .join('');
  return `<ExtendedPrivilegesCatalog membercount="${exts.length}">${uuidEl('extendedprivilegescatalog')}<ObjectList membercount="${exts.length}">${items}</ObjectList></ExtendedPrivilegesCatalog>`;
}

/**
 * PrivilegeSetsCatalog. For now each set is a stub — id, name and description —
 * so an Account's PrivilegeSetReference resolves. The full <access> element
 * (per-table and per-field record access, layout/value-list/script access, the
 * key-10 options) is the next stage; FileMaker's own export carries it here.
 */
function privilegeSetsCatalog(sets: PrivilegeSet[]): string {
  if (!sets.length) return '';
  const items = sets
    .map((p) => `<PrivilegeSet id="${p.id}" name="${esc(p.name)}">${uuidEl(`privset:${p.id}`)}<Description>${esc(p.comment ?? '')}</Description></PrivilegeSet>`)
    .join('');
  return `<PrivilegeSetsCatalog membercount="${sets.length}">${uuidEl('privilegesetscatalog')}<TagList></TagList><ObjectList membercount="${sets.length}">${items}</ObjectList></PrivilegeSetsCatalog>`;
}

/**
 * AccountsCatalog — names and privilege-set references only. SECRETS RULE: no
 * credential material is ever written. FileMaker's own export carries an
 * <INSECURE_PASSWORD> block (a password <Context> token) inside <Authentication>;
 * we emit the <AccountName> and never that block, and never the reader's
 * password verifier. The reader marks external-server accounts (Account.external),
 * but the type value FileMaker writes for them here isn't known from a sample, and
 * the enabled state isn't decoded yet, so accounts are emitted as enabled
 * FileMaker accounts.
 */
function accountsCatalog(accounts: Account[], setById: Map<number, PrivilegeSet>): string {
  if (!accounts.length) return '';
  const items = accounts
    .map((a) => {
      const set = a.privilegeSetId !== undefined ? setById.get(a.privilegeSetId) : undefined;
      const ref = set ? `<PrivilegeSetReference id="${set.id}" name="${esc(set.name)}"></PrivilegeSetReference>` : '';
      const auth = `<Authentication><AccountName><INSECURE_TEXT>${esc(a.name)}</INSECURE_TEXT></AccountName></Authentication>`;
      return `<Account id="${a.id}" kind="0" type="FileMaker" enable="True">${uuidEl(`account:${a.id}`)}<TagList></TagList><Description></Description>${auth}${ref}</Account>`;
    })
    .join('');
  return `<AccountsCatalog membercount="${accounts.length}">${uuidEl('accountscatalog')}<Options>1</Options><ObjectList membercount="${accounts.length}">${items}</ObjectList></AccountsCatalog>`;
}

// Resolving a field reference (name + its base table) through an occurrence, so
// value lists and relationship predicates can name the field and reuse the same
// `field:<tableId>:<fieldId>` UUID seed the FieldsForTables pass emitted.
interface Refs {
  byId: Map<number, Table>;
  occById: Map<number, TableOccurrence>;
}
function occRefEl(occId: number, refs: Refs): string {
  const occ = refs.occById.get(occId);
  return occ
    ? `<TableOccurrenceReference id="${occ.id}" name="${esc(occ.name)}" UUID="${guid(`occurrence:${occ.id}`)}"></TableOccurrenceReference>`
    : `<TableOccurrenceReference id="${occId}"></TableOccurrenceReference>`;
}
function fieldRef(occId: number, fieldId: number, refs: Refs): string {
  const occ = refs.occById.get(occId);
  const table = occ?.baseTableId !== undefined ? refs.byId.get(occ.baseTableId) : undefined;
  const f = table?.fields.find((x) => x.id === fieldId);
  const tableId = table?.id ?? occ?.baseTableId ?? 0;
  return `<FieldReference id="${fieldId}" name="${esc(f?.name ?? '')}" UUID="${guid(`field:${tableId}:${fieldId}`)}">${occRefEl(occId, refs)}</FieldReference>`;
}

/**
 * CustomFunctionsCatalog — the signature and parameters of each custom function.
 * `access` isn't decoded, so it defaults to "All" (FileMaker's default). The
 * calculation body is attached later, in CalcsForCustomFunctions, mirroring how
 * field calculations are deferred to the ModifyAction pass.
 */
function customFunctionsCatalog(fns: CustomFunction[]): string {
  if (!fns.length) return '';
  const items = fns
    .map((fn) => {
      const sig = fn.parameters.length ? `${fn.name} ( ${fn.parameters.join(' ; ')} )` : `${fn.name} ( )`;
      const params = fn.parameters.map((p) => `<Parameter name="${esc(p)}"></Parameter>`).join('');
      return (
        `<CustomFunction id="${fn.id}" name="${esc(fn.name)}" access="All">` +
        uuidEl(`customfunction:${fn.id}`) + `<TagList></TagList><Display>${esc(sig)}</Display>` +
        `<ObjectList membercount="${fn.parameters.length}">${params}</ObjectList></CustomFunction>`
      );
    })
    .join('');
  return `<CustomFunctionsCatalog membercount="${fns.length}">${uuidEl('customfunctionscatalog')}<TagList></TagList><ObjectList membercount="${fns.length}">${items}</ObjectList></CustomFunctionsCatalog>`;
}

/**
 * CalcsForCustomFunctions — each function's formula, as <Text> only (ChunkList
 * omitted, rebuilt on import, same gate as field calculations). Tabularius's own
 * JavaScript custom functions have no FileMaker-calculation equivalent, so their
 * body is not emitted here (the signature is still created above); a round-trip
 * back into Tabularius keeps the JavaScript from the stored schema.
 */
function calcsForCustomFunctions(fns: CustomFunction[]): string {
  const withCalc = fns.filter((fn) => fn.formula !== undefined && fn.language !== 'javascript');
  if (!withCalc.length) return '';
  const items = withCalc
    .map(
      (fn) =>
        `<CustomFunctionCalc><CustomFunctionReference id="${fn.id}" name="${esc(fn.name)}" UUID="${guid(`customfunction:${fn.id}`)}"></CustomFunctionReference>` +
        `<Calculation><Text>${cdata(fn.formula!)}</Text></Calculation></CustomFunctionCalc>`,
    )
    .join('');
  return `<CalcsForCustomFunctions membercount="${withCalc.length}"><ObjectList membercount="${withCalc.length}">${items}</ObjectList></CalcsForCustomFunctions>`;
}

/**
 * A <ValueList>: custom values (CR-separated, as FileMaker stores them) or a
 * field source (PrimaryField, an optional SecondaryField, and whether to show
 * only related values). External value lists — values from another file — need
 * the data-source machinery and are skipped for now, like external occurrences.
 */
function valueList(vl: ValueList, refs: Refs): string | undefined {
  let source: string;
  let body: string;
  if (vl.field) {
    source = 'FromField';
    const primary =
      `<PrimaryField show="${vl.field.showSecondOnly ? 'False' : 'True'}" sort="${vl.field.sortBySecond ? 'False' : 'True'}">` +
      fieldRef(vl.field.occurrenceId, vl.field.fieldId, refs) +
      `</PrimaryField>`;
    const secondary =
      vl.field.secondFieldId !== undefined
        ? `<SecondaryField show="True" sort="${vl.field.sortBySecond ? 'True' : 'False'}">${fieldRef(vl.field.occurrenceId, vl.field.secondFieldId, refs)}</SecondaryField>`
        : '';
    // The "True" shape (include only related values, from a starting occurrence)
    // is inferred — the public sample only carries value="False".
    const showRelated =
      vl.field.relatedFromId !== undefined
        ? `<ShowRelated value="True">${occRefEl(vl.field.relatedFromId, refs)}</ShowRelated>`
        : `<ShowRelated value="False"></ShowRelated>`;
    body = `<Field>${primary}${secondary}${showRelated}</Field>`;
  } else if (vl.external && !vl.values) {
    return undefined; // external value list — deferred with ExternalDataSourceCatalog
  } else {
    source = 'Custom';
    body = `<CustomValues><Text>${cdata((vl.values ?? []).join('\r'))}</Text></CustomValues>`;
  }
  return `<ValueList id="${vl.id}" name="${esc(vl.name)}"><Source value="${source}"></Source>${body}${uuidEl(`valuelist:${vl.id}`)}<TagList></TagList></ValueList>`;
}

/** The ValueListCatalog: one <ValueList> per list (external-source lists skipped). */
function valueListCatalog(vls: ValueList[], refs: Refs): string {
  const items = vls.map((v) => valueList(v, refs)).filter((s): s is string => s !== undefined);
  if (!items.length) return '';
  return `<ValueListCatalog membercount="${items.length}">${uuidEl('valuelistcatalog')}<TagList></TagList>${items.join('')}</ValueListCatalog>`;
}

// FileMaker's relationship-dialog operator names. Equal/NotEqual/LessOrEqual/
// GreaterOrEqual are pinned by the public sample; LessThan/GreaterThan/Cartesian
// are inferred (they don't appear in it).
const JOIN_TYPE: Record<JoinOperator, string> = {
  '=': 'Equal',
  '≠': 'NotEqual',
  '<': 'LessThan',
  '≤': 'LessOrEqual',
  '>': 'GreaterThan',
  '≥': 'GreaterOrEqual',
  '×': 'Cartesian',
};

/**
 * A <Relationship>: the two occurrences, each side's allow-create / cascade-delete,
 * and the join predicates. The reader exposes a single `sorted` flag (not a
 * per-side sort), so both sides' SortSpecification carry it.
 */
function relationship(rel: Relationship, refs: Refs): string {
  const side = (occId: number, create: boolean | undefined, del: boolean | undefined) =>
    `cascadeCreate="${create ? 'True' : 'False'}" cascadeDelete="${del ? 'True' : 'False'}" type="Local">` +
    occRefEl(occId, refs) +
    `<SortSpecification value="${rel.sorted ? 'True' : 'False'}" maintain="True"></SortSpecification>`;
  const preds = rel.predicates
    .map(
      (p) =>
        `<JoinPredicate type="${JOIN_TYPE[p.operator]}">` +
        `<LeftField>${fieldRef(rel.leftTableOccurrenceId, p.leftFieldId, refs)}</LeftField>` +
        `<RightField>${fieldRef(rel.rightTableOccurrenceId, p.rightFieldId, refs)}</RightField>` +
        `</JoinPredicate>`,
    )
    .join('');
  return (
    `<Relationship id="${rel.id}">${uuidEl(`relationship:${rel.id}`)}` +
    `<LeftTable ${side(rel.leftTableOccurrenceId, rel.leftCreate, rel.leftDelete)}</LeftTable>` +
    `<RightTable ${side(rel.rightTableOccurrenceId, rel.rightCreate, rel.rightDelete)}</RightTable>` +
    `<JoinPredicateList membercount="${rel.predicates.length}">${preds}</JoinPredicateList><TagList></TagList></Relationship>`
  );
}

/** The RelationshipCatalog: one <Relationship> per relationship. */
function relationshipCatalog(rels: Relationship[], refs: Refs): string {
  if (!rels.length) return '';
  const items = rels.map((r) => relationship(r, refs)).join('');
  return `<RelationshipCatalog membercount="${rels.length}">${uuidEl('relationshipcatalog')}${items}</RelationshipCatalog>`;
}

/** An empty BaseDirectoryCatalog (external-file base directories are a follow-up). */
function baseDirectoryCatalog(): string {
  return `<BaseDirectoryCatalog membercount="0" generate="True" temporary="True">${uuidEl('basedirectorycatalog')}<TagList></TagList></BaseDirectoryCatalog>`;
}

/**
 * The Metadata tail: encryption off, a minimum-version stamp, and an empty
 * (INSECURE_TEXT) login — never a password verifier. Defaults (the file's
 * default layout) are omitted until layouts are emitted.
 */
function metadata(): string {
  const login = `<Login type="1"><UserName><INSECURE_TEXT/></UserName><INSECURE_PASSWORD><INSECURE_TEXT/></INSECURE_PASSWORD></Login>`;
  return (
    `<Metadata><AddAction membercount="3">` +
    `<Encryption type="0"/>` +
    `<Minimum version="12.0" value="1208"/>` +
    login +
    `</AddAction></Metadata>`
  );
}

/**
 * Serialise `schema` as an FMSaveAsXML document (skeleton — see the module
 * header for what is and isn't emitted yet). The result is valid, well-formed
 * XML in the FMSaveAsXML shape; it is not yet a complete, importable solution.
 */
export function saveAsXml(schema: Schema, opts: SaveAsXmlOptions = {}): string {
  realUuids = opts.uuids;
  try {
    return saveAsXmlWith(schema, opts);
  } finally {
    realUuids = undefined;
  }
}

function saveAsXmlWith(schema: Schema, opts: SaveAsXmlOptions): string {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const occById = new Map(schema.tableOccurrences.map((o) => [o.id, o]));
  // First local occurrence of each base table, as a fallback calculation context.
  const occByBase = new Map<number, TableOccurrence>();
  for (const o of schema.tableOccurrences) {
    if (o.baseTableId !== undefined && o.dataSourceId === undefined && !occByBase.has(o.baseTableId)) occByBase.set(o.baseTableId, o);
  }
  const setById = new Map(schema.privilegeSets.map((p) => [p.id, p]));
  const refs: Refs = { byId, occById };
  // Canonical AddAction order (from the public FMSaveAsXML sample): directories,
  // external sources, base tables, occurrences, custom-function signatures,
  // fields, value lists, relationships, custom-function calcs, scripts, themes,
  // layouts, then the security catalogs, then script steps. The still-TODO
  // members (external sources, scripts/steps, themes, layouts) are simply absent.
  const catalogs = [
    baseDirectoryCatalog(),
    baseTableCatalog(schema.tables),
    tableOccurrenceCatalog(schema.tableOccurrences, byId),
    customFunctionsCatalog(schema.customFunctions),
    fieldsForTables(schema.tables),
    valueListCatalog(schema.valueLists, refs),
    relationshipCatalog(schema.relationships, refs),
    calcsForCustomFunctions(schema.customFunctions),
    // Security (canonical order: privilege sets, then extended privileges, then accounts).
    privilegeSetsCatalog(schema.privilegeSets),
    extendedPrivilegesCatalog(schema.extendedPrivileges),
    accountsCatalog(schema.accounts, setById),
  ].filter((c) => c !== '');
  const add = `<AddAction membercount="${catalogs.length}">${catalogs.join('')}</AddAction>`;
  const modify = modifyAction(schema.tables, occById, occByBase);
  const members = modify ? 2 : 1;
  const structure = `<Structure membercount="${members}">${add}${modify}</Structure>`;
  const root = el(
    'FMSaveAsXML',
    {
      version: '2.2.0.0',
      Source: opts.source ?? '12.0.0',
      File: opts.fileName ?? 'export.fmp12',
      UUID: guid(`file:${opts.fileName ?? 'export.fmp12'}`),
      locale: 'English',
    },
    structure + metadata(),
  );
  return `<?xml version="1.0"?>${root}`;
}

// What each FMSaveAsXML definition element is called in our UUID seeds above.
// Scripts and layouts are not emitted yet, but a patch will need their UUIDs.
const SEED: Record<string, string> = {
  BaseTable: 'basetable',
  TableOccurrence: 'occurrence',
  CustomFunction: 'customfunction',
  ValueList: 'valuelist',
  Relationship: 'relationship',
  PrivilegeSet: 'privset',
  ExtendedPrivilege: 'ext',
  Account: 'account',
  Script: 'script',
  Layout: 'layout',
};

/**
 * The object UUIDs in a FileMaker file's own Save as XML, keyed by the same
 * seeds `saveAsXml` uses (`basetable:129`, `field:129:3`, ...), so passing the
 * map as `uuids` makes our export name the objects in that file. Our ids are
 * FileMaker's ids, which is what lines the two up. Our reader does not decode
 * UUIDs from the .fmp12 itself yet; this is the way to get them meanwhile, and
 * an FMUpgradeTool patch can't replace or delete an object without one.
 *
 * Definitions are elements with an `id` and a <UUID> child (references carry
 * the UUID as an attribute and are skipped). A field's table comes from the
 * BaseTableReference of the FieldCatalog it is listed in. Accepts the XML as
 * text or as the file's bytes (FileMaker 2025 and earlier write UTF-16).
 */
export function uuidsFromSaveAsXml(xml: string | Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const doc = parseXml(typeof xml === 'string' ? xml.replace(/^\uFEFF/, '') : decodeXmlBytes(xml));
  const elements = (e: XmlElement) => e.children.filter((c): c is XmlElement => typeof c !== 'string');
  const uuidOf = (e: XmlElement): string | undefined => {
    const u = elements(e).find((c) => c.name === 'UUID');
    const text = u?.children.filter((c): c is string => typeof c === 'string').join('').trim();
    return text || undefined;
  };
  const walk = (e: XmlElement, tableId: string | undefined): void => {
    if (e.name === 'FMSaveAsXML' && e.attrs.UUID) out.set('file', e.attrs.UUID);
    if (e.name === 'FieldCatalog') tableId = elements(e).find((c) => c.name === 'BaseTableReference')?.attrs.id;
    const id = e.attrs.id;
    if (id !== undefined) {
      const seed = e.name === 'Field' ? (tableId !== undefined ? `field:${tableId}:${id}` : undefined) : SEED[e.name] && `${SEED[e.name]}:${id}`;
      const uuid = seed ? uuidOf(e) : undefined;
      if (seed && uuid && !out.has(seed)) out.set(seed, uuid);
    }
    for (const c of elements(e)) walk(c, tableId);
  };
  walk(doc, undefined);
  return out;
}

function decodeXmlBytes(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  // No BOM: UTF-16 still shows as a zero byte beside the opening '<'.
  if (b[0] === 0x3c && b[1] === 0x00) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0x00 && b[1] === 0x3c) return new TextDecoder('utf-16be').decode(b);
  return new TextDecoder('utf-8').decode(b).replace(/^\uFEFF/, '');
}
