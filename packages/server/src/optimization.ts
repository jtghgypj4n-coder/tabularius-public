// The optimization report: what in a converted FileMaker file would make it smaller or faster, found by reading the
// file's design and sizing its data. Container files kept inside the file (the usual reason a database is huge),
// sorts and relationships on fields no index can serve, fields, scripts and table occurrences nothing uses, and
// a few shapes that cost time (wide tables, repeating fields, long value lists). Each finding says what it would
// save (exact bytes where they can be counted, a plain sentence where they can't) and what to do about it.
//
// The report changes nothing. A finding may offer an action (an index, moving container files out of the file);
// the action is only described here, with the request that carries it out, and a person approves it first.
// Made from the converted store, so it works for a file just converted, a file being hosted and the CLI alike
// (a .fmp12 is converted to a scratch store first).

import type { Field, Table } from '../../fmp12/src/index.ts';
import type { Store } from '../../store/src/index.ts';
import { q } from '../../store/src/import.ts';
import { EXTERNAL, VOLATILE } from '../../store/src/fidelity.ts';
import { FUNCTIONS } from '../../calc/src/functions.ts';
import { redactSecrets } from './ai-output.ts';
import { canVerifyUnused, solutionIndex } from './insight.ts';
import { imageInfo } from '../../calc/src/image-info.ts';
import { fixAction, fixChanges, type FixId } from './optimization-fix.ts';
import { dataFindings, layoutFindings } from './optimization-data.ts';

/** How much it matters: high is worth doing before people use the file. */
export type Impact = 'high' | 'medium' | 'low';
export const IMPACTS: Impact[] = ['high', 'medium', 'low'];

/** Something a person can choose to do about a finding. Nothing here runs until they approve it. */
export interface OptimizationAction {
  id: 'add-index' | 'container-to-s3' | 'container-to-managed-storage' | FixId;
  label: string;
  /** False when it can't be done yet (no S3 connection set up): `unavailable` says why. */
  available: boolean;
  unavailable?: string;
  /** The admin API request that does it, when there is one. */
  request?: { method: 'POST'; path: string; body: Record<string, unknown> };
  /** A fix to the file's design: it is one change, `request` with `preview: true` lists exactly what it would do, and Undo puts it back. */
  undoable?: true;
  /** What to say before asking the person to go ahead, when the default for the action doesn't fit. */
  confirm?: string;
}

export interface Finding {
  /** Stable: the kind of finding and what it is about ("embedded-container:Table::Field"). */
  id: string;
  impact: Impact;
  title: string;
  /** What is wrong, in a sentence or two. */
  what: string;
  /** What to do about it. */
  instead?: string;
  /** Bytes the file would shrink by at most, where they can be counted. */
  savesBytes?: number;
  /** savesBytes is a guess from the pictures' pixels, not a count. */
  estimated?: true;
  /** The speed win in a sentence, where there is one. */
  speed?: string;
  count: number;
  /** The first few places. */
  where: string[];
  actions?: OptimizationAction[];
}

export interface OptimizationReport {
  database: string;
  made: string;
  /** The converted file's size, and where its space goes. */
  storeBytes: number;
  spaceByTable: { name: string; bytes: number }[];
  /** Container files stored inside the file (the rest are already outside it). */
  containers: { files: number; bytes: number; images: number; imageBytes: number; outsideFiles: number };
  findings: Finding[];
  /** One line for a log or a progress message. */
  headline: string;
  /** The report as Markdown (the layout the admin console's guide view reads). */
  text: string;
  /** Fixes made from this report, newest first; an undone one can't be undone again. */
  changes?: { id: number; at: string; label: string; undone?: true }[];
}

const WHERE = 5;
/** Tables with fewer records than this cost nothing worth reporting for sorts and lookups. */
export const SLOW_RECORDS = 1_000;
const BIG_RECORDS = 10_000;
const HUGE_RECORDS = 50_000;
const WIDE_FIELDS = 100;
const LONG_VALUE_LIST = 1_000;

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
export function bytesText(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024).toLocaleString('en-US')} KB`;
  return `${n} bytes`;
}
const lower = (s: string) => s.toLowerCase();
const key = (t: Table, f: Field) => `${t.name}::${f.name}`;

// --- container files --------------------------------------------------------------

/** What one container field keeps inside the file. */
export interface ContainerUse {
  table: string;
  field: string;
  files: number;
  bytes: number;
  images: number;
  imageBytes: number;
  largest: number;
  /** Files FileMaker already keeps outside the file (Manage Containers): they cost the file nothing. */
  outsideFiles: number;
  /** The field is set to store its data outside the file in the original design. */
  designedExternal: boolean;
  /** Small files of no known type (vectors, tokens): data kept in a container, not files anyone opens. */
  smallBinary: number;
}

const SIZE = 'coalesce(length(c.data), 0) + coalesce((SELECT sum(length(k.data)) FROM _fm_container_chunks k WHERE k.id = c.id), 0)';

function hasTable(store: Store, name: string): boolean {
  return !!store.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

/**
 * Every container field's contents, from the records: the files each field points at (once each, repeating fields
 * included), with their sizes. Files not copied into the store (kept beside the original) count as outside.
 */
export function containerUse(store: Store): ContainerUse[] {
  if (!hasTable(store, '_fm_containers')) return [];
  const chunked = hasTable(store, '_fm_container_chunks');
  const size = chunked ? SIZE : 'coalesce(length(c.data), 0)';
  const out: ContainerUse[] = [];
  for (const t of store.schema.tables) {
    for (const f of t.fields) {
      if (f.type !== 'container' || f.kind === 'summary') continue;
      const col = q(f.name);
      // Repeating fields keep their file ids as a JSON array; the rest keep the one id.
      const ids = `SELECT ${col} AS id FROM ${q(t.name)} WHERE typeof(${col}) = 'integer'
        UNION SELECT j.value FROM ${q(t.name)} AS r, json_each(r.${col}) AS j WHERE typeof(r.${col}) = 'text' AND json_valid(r.${col}) AND typeof(j.value) = 'integer'`;
      let row: { files: number; bytes: number; images: number; imageBytes: number; largest: number; outsideFiles: number; smallBinary: number } | undefined;
      try {
        row = store.sql.prepare(`SELECT
            sum(c.external IS NULL) AS files,
            coalesce(sum(CASE WHEN c.external IS NULL THEN ${size} END), 0) AS bytes,
            sum(c.external IS NULL AND c.mime LIKE 'image/%') AS images,
            coalesce(sum(CASE WHEN c.external IS NULL AND c.mime LIKE 'image/%' THEN ${size} END), 0) AS imageBytes,
            coalesce(max(CASE WHEN c.external IS NULL THEN ${size} END), 0) AS largest,
            sum(c.external IS NOT NULL) AS outsideFiles,
            sum(c.external IS NULL AND c.mime = 'application/octet-stream' AND ${size} <= 65536) AS smallBinary
          FROM _fm_containers AS c WHERE c.id IN (${ids})`).get() as typeof row;
      } catch {
        continue;
      }
      if (!row || (!row.files && !row.outsideFiles)) continue;
      out.push({
        table: t.name, field: f.name, files: Number(row.files ?? 0), bytes: Number(row.bytes), images: Number(row.images ?? 0),
        imageBytes: Number(row.imageBytes), largest: Number(row.largest), outsideFiles: Number(row.outsideFiles ?? 0),
        designedExternal: !!f.options?.externalStorage, smallBinary: Number(row.smallBinary ?? 0),
      });
    }
  }
  return out;
}

/** Container fields the AI steps keep embedding vectors in (the target of Insert Embedding): read for semantic search, not opened as files. */
function embeddingFields(store: Store): Set<string> {
  const out = new Set<string>();
  for (const script of store.schema.scripts) {
    for (const step of script.steps) {
      if (!/^Insert Embedding/.test(step.name)) continue;
      const hit = resolveField(store, step.params?.field as never);
      if (hit) out.add(key(hit.table, hit.field));
    }
  }
  return out;
}

function containerFindings(use: ContainerUse[], storeBytes: number, skip: Set<string>, database: string): Finding[] {
  const out: Finding[] = [];
  for (const u of use) {
    if (!u.files || u.smallBinary === u.files || skip.has(`${u.table}::${u.field}`)) continue;
    const share = storeBytes ? u.bytes / storeBytes : 0;
    const impact: Impact = u.bytes >= 50 * 1024 ** 2 || share >= 0.25 ? 'high' : u.bytes >= 5 * 1024 ** 2 || share >= 0.05 ? 'medium' : 'low';
    // Below 1 MB there is nothing worth moving.
    if (u.bytes < 1024 ** 2 && impact === 'low') continue;
    const where = `${u.table}::${u.field}`;
    const pictures = u.images ? `${plural(u.images, 'picture')} (${bytesText(u.imageBytes)})` : undefined;
    out.push({
      id: `embedded-container:${where}`,
      impact,
      title: `Container files inside the file: ${where}`,
      what: `${plural(u.files, 'file')} totalling ${bytesText(u.bytes)} (${Math.round(share * 100)}% of the converted file) are stored in the database itself` +
        (pictures && u.images < u.files ? `, ${pictures} of them` : u.images ? ', all of them pictures' : '') + `; the largest is ${bytesText(u.largest)}. Every backup, copy and replica carries them.` +
        (u.designedExternal ? ' The field was set to store its data outside the file in FileMaker, but these files came in with the records.' : ''),
      instead: u.images
        ? 'Move them to S3-compatible storage and keep only a link in the record (the database shrinks by this much and pictures are served from storage), or to managed external storage next to the file. Pictures shown small can also be replaced by thumbnails.'
        : 'Move them to S3-compatible storage and keep only a link in the record, or to managed external storage next to the file.',
      savesBytes: u.bytes,
      count: u.files,
      where: [where],
      actions: [
        { id: 'container-to-s3', label: 'Move these files to S3 and keep a link', available: false, unavailable: 'Needs an S3 connection (admin console, Connections), which isn\'t set up yet.' },
        {
          id: 'container-to-managed-storage', label: `Move these files to managed external storage (${where})`, available: true,
          request: { method: 'POST', path: `/tabularius/admin/v1/optimization/${encodeURIComponent(database)}/containers`, body: { table: u.table, field: u.field, expect: u.files } },
          confirm: `Move the ${plural(u.files, 'file')} of ${where} out of the database into a folder beside the hosted file? Nothing is lost and the move can be undone, but from then on that folder has to be backed up with the file.`,
        },
      ],
    });
  }
  return out;
}


// --- pictures bigger than they are shown -----------------------------------------------

/** What a container field's pictures cost beyond what its layouts show of them. */
export interface OversizedPictures {
  /** Pictures looked at, and those with at least twice the pixels the biggest place showing them can use. */
  looked: number;
  oversized: number;
  /** About how many bytes shrinking those to the size shown (at twice the layout's pixels, for sharp screens) would save: an estimate, taking a file's bytes to follow its pixels. */
  savesBytes: number;
  /** The biggest the field is shown on any layout, in points. */
  shown: { width: number; height: number };
  /** The largest picture, in pixels. */
  largest: { width: number; height: number };
}

const SHOWN_MARGIN = 2;
const SHARP = 2;
const HEADER_BYTES = 65_536;
const LOOK_AT = 300;

/** The biggest each container field is drawn on any layout. */
function shownSizes(store: Store): Map<string, { width: number; height: number }> {
  const out = new Map<string, { width: number; height: number }>();
  for (const design of store.designs().layouts) {
    const walk = (objects: typeof design.objects) => {
      for (const o of objects) {
        const hit = o.field ? resolveField(store, o.field as never) : undefined;
        if (hit && hit.field.type === 'container' && o.bounds) {
          const k = key(hit.table, hit.field);
          const w = o.bounds.right - o.bounds.left;
          const h = o.bounds.bottom - o.bounds.top;
          const old = out.get(k);
          if (w > 0 && h > 0) out.set(k, { width: Math.max(old?.width ?? 0, w), height: Math.max(old?.height ?? 0, h) });
        }
        if (o.children?.length) walk(o.children);
      }
    };
    walk(design.objects);
  }
  return out;
}

/** Pictures with far more pixels than any layout draws, by field. Only fields that are on a layout can be judged. */
export function oversizedPictures(store: Store, use: ContainerUse[]): Map<string, OversizedPictures> {
  const out = new Map<string, OversizedPictures>();
  if (!use.some((u) => u.images)) return out;
  const shown = shownSizes(store);
  for (const u of use) {
    const box = shown.get(`${u.table}::${u.field}`);
    if (!u.images || !box) continue;
    const col = q(u.field);
    const ids = `SELECT ${col} AS id FROM ${q(u.table)} WHERE typeof(${col}) = 'integer'
      UNION SELECT j.value FROM ${q(u.table)} AS r, json_each(r.${col}) AS j WHERE typeof(r.${col}) = 'text' AND json_valid(r.${col}) AND typeof(j.value) = 'integer'`;
    let rows: { head: Uint8Array; size: number }[];
    try {
      rows = store.sql.prepare(`SELECT substr(c.data, 1, ${HEADER_BYTES}) AS head, length(c.data) AS size FROM _fm_containers AS c
        WHERE c.external IS NULL AND c.mime LIKE 'image/%' AND length(c.data) > 0 AND c.id IN (${ids}) ORDER BY length(c.data) DESC LIMIT ${LOOK_AT}`).all() as typeof rows;
    } catch {
      continue;
    }
    const needed = box.width * box.height * SHARP * SHARP;
    const r: OversizedPictures = { looked: 0, oversized: 0, savesBytes: 0, shown: box, largest: { width: 0, height: 0 } };
    for (const row of rows) {
      const info = imageInfo(row.head);
      if (!info) continue;
      r.looked++;
      const pixels = info.width * info.height;
      if (pixels > r.largest.width * r.largest.height) r.largest = { width: info.width, height: info.height };
      if (pixels >= SHOWN_MARGIN * needed) {
        r.oversized++;
        r.savesBytes += Math.round(Number(row.size) * (1 - needed / pixels));
      }
    }
    if (r.oversized) out.set(`${u.table}::${u.field}`, r);
  }
  return out;
}

function pictureFindings(store: Store, use: ContainerUse[], skip: Set<string>): Finding[] {
  const out: Finding[] = [];
  for (const [k, o] of oversizedPictures(store, use)) {
    if (skip.has(k) || o.savesBytes < 1024 ** 2) continue;
    out.push({
      id: `oversized-pictures:${k}`, impact: o.savesBytes >= 25 * 1024 ** 2 ? 'high' : 'medium',
      title: `Pictures far bigger than they are shown: ${k}`,
      what: `${plural(o.oversized, 'picture')} in ${k} have at least twice the pixels the biggest layout needs: it draws them at most ${o.shown.width} × ${o.shown.height} points, and the largest is ${o.largest.width} × ${o.largest.height} pixels.`,
      instead: 'Keep the original in S3 or external storage and store a picture sized for the screen, or have people add pictures already reduced.',
      savesBytes: o.savesBytes, estimated: true,
      count: o.oversized, where: [k],
    });
  }
  return out;
}

// --- where the space goes ---------------------------------------------------------

/** The file's size, and its tables by space (sorted, biggest first) where the database can tell. */
function sizes(store: Store): { storeBytes: number; spaceByTable: { name: string; bytes: number }[] } {
  const one = (sql: string) => Number((Object.values(store.sql.prepare(sql).get() as Record<string, number>)[0]) ?? 0);
  const storeBytes = one('PRAGMA page_count') * one('PRAGMA page_size');
  let spaceByTable: { name: string; bytes: number }[] = [];
  try {
    const rows = store.sql.prepare("SELECT name, sum(pgsize) AS bytes FROM dbstat WHERE name NOT LIKE 'sqlite_%' GROUP BY name ORDER BY bytes DESC LIMIT 10").all() as { name: string; bytes: number }[];
    spaceByTable = rows.map((r) => ({ name: r.name, bytes: Number(r.bytes) }));
  } catch {
    // dbstat isn't compiled into every SQLite: the report goes without it.
  }
  return { storeBytes, spaceByTable };
}

// --- uses of fields: sorts, finds, relationships ---------------------------------------

interface KeyUse {
  table: Table;
  field: Field;
  /** 'sort', 'find' or 'relationship'. */
  by: 'sort' | 'find' | 'relationship';
  where: string;
}

type Ref = { tableOccurrence?: { id?: number; name?: string } | string; tableOccurrenceId?: number; field?: { id?: number; name?: string } | string; fieldId?: number };

/** The field (of this file) a step, layout or relationship names, by occurrence and field ids. */
function resolveField(store: Store, ref: Ref | undefined): { table: Table; field: Field } | undefined {
  if (!ref) return undefined;
  const toId = typeof ref.tableOccurrence === 'object' ? ref.tableOccurrence?.id : ref.tableOccurrenceId;
  const home = toId !== undefined ? store.calc.occurrenceTable(toId) : undefined;
  const name = typeof ref.field === 'string' ? ref.field : ref.field?.name;
  const id = typeof ref.field === 'object' ? ref.field?.id : ref.fieldId;
  if (!home || home.store !== store) return undefined;
  const field = home.table.fields.find((f) => (id !== undefined && f.id === id) || (name !== undefined && lower(f.name) === lower(name)));
  return field ? { table: home.table, field } : undefined;
}

/** The fields sorted on, searched and matched on across the file's scripts, portals and relationships. */
function keyUses(store: Store): KeyUse[] {
  const s = store.schema;
  const uses: KeyUse[] = [];
  const resolve = (ref: Ref | undefined) => resolveField(store, ref);
  for (const script of s.scripts) {
    script.steps.forEach((step, i) => {
      if (!step.enabled) return;
      const where = `Script "${script.name}", line ${i + 1}`;
      for (const sort of step.params?.sort ?? []) {
        const hit = resolve(sort.field as never);
        if (hit) uses.push({ ...hit, by: 'sort', where });
      }
      for (const request of step.params?.requests ?? []) {
        for (const c of request.criteria) {
          const hit = resolve(c.field as never);
          if (hit) uses.push({ ...hit, by: 'find', where });
        }
      }
    });
  }
  for (const design of store.designs().layouts) {
    const walk = (objects: typeof design.objects) => {
      for (const o of objects) {
        for (const sort of o.portal?.sort ?? []) {
          const hit = resolve(sort.field as never);
          if (hit) uses.push({ ...hit, by: 'sort', where: `Layout "${design.name}", portal` });
        }
        if (o.children?.length) walk(o.children);
      }
    };
    walk(design.objects);
  }
  for (const r of s.relationships) {
    for (const p of r.predicates) {
      for (const [toId, fieldId] of [[r.leftTableOccurrenceId, p.leftFieldId], [r.rightTableOccurrenceId, p.rightFieldId]] as const) {
        const hit = resolve({ tableOccurrenceId: toId, fieldId });
        if (hit) uses.push({ ...hit, by: 'relationship', where: `Relationship ${r.leftTableOccurrence ?? '?'} → ${r.rightTableOccurrence ?? '?'}` });
      }
    }
  }
  return uses;
}

/** Functions whose result depends on more than the record's own fields. */
const RISKY = new Set(['evaluate', 'executesql', 'getsummary', 'getlayoutobjectattribute', 'getfield', 'lookup', 'lookupnext']);
const BY: Record<KeyUse['by'], string> = { sort: 'sorting on it', find: 'finding on it', relationship: 'matching records through it' };
const VERB: Record<KeyUse['by'], string> = { sort: 'sort', find: 'find', relationship: 'match records' };

/** Whether a calculation reads only its own table's fields and nothing that changes by itself: then it could be stored. */
export function storable(store: Store, t: Table, f: Field): boolean {
  const sites = solutionIndex(store).sites;
  const fields = new Map(t.fields.map((field) => [lower(field.name), field]));
  const custom = new Map(store.schema.customFunctions.map((fn) => [lower(fn.name), fn]));
  const visiting = new Set<string>();
  const checked = new Map<string, boolean>();
  const fieldSite = (field: Field) => sites.find((x) => x.kind === 'field' && x.where === `Field ${key(t, field)} (calculation)`);
  const safe = (id: string, site: typeof sites[number] | undefined): boolean => {
    if (!site || site.refs.unparsed || site.refs.unknownTokens?.length) return false;
    if (checked.has(id)) return checked.get(id)!;
    if (visiting.has(id)) return false;
    visiting.add(id);
    let ok = !VOLATILE.test(site.text) && !EXTERNAL.test(site.text);
    if (ok) for (const occurrence of site.refs.occurrences) {
      const to = store.schema.tableOccurrences.find((x) => lower(x.name) === occurrence);
      if (!to || to.dataSourceId || to.baseTableId !== t.id) { ok = false; break; }
    }
    if (ok) for (const name of site.refs.fields) {
      const prefix = `${t.name}::`;
      const dep = lower(name).startsWith(lower(prefix)) ? fields.get(lower(name.slice(prefix.length))) : undefined;
      if (!dep || dep.options?.global || dep.kind === 'summary' || (dep.kind === 'calculation' && !safe(`field:${dep.id}`, fieldSite(dep)))) { ok = false; break; }
    }
    if (ok) for (const name of site.refs.functions) {
      if (RISKY.has(name)) { ok = false; break; }
      const fn = custom.get(name);
      if (fn) {
        if (fn.language === 'javascript' || !safe(`function:${fn.id}`, sites.find((x) => x.kind === 'customFunction' && x.where.startsWith(`Custom function ${fn.name} (`)))) { ok = false; break; }
      } else if (!FUNCTIONS.has(name)) { ok = false; break; }
    }
    visiting.delete(id);
    checked.set(id, ok);
    return ok;
  };
  return safe(`field:${f.id}`, fieldSite(f));
}

function speedFindings(store: Store): Finding[] {
  const out: Finding[] = [];
  const uses = keyUses(store);
  const indexed = new Map<string, Set<string>>();
  const has = (t: string, f: string) => {
    if (!indexed.has(t)) indexed.set(t, store.indexedFields(t));
    return indexed.get(t)!.has(f);
  };
  const byField = new Map<string, { table: Table; field: Field; uses: KeyUse[] }>();
  for (const u of uses) {
    const k = key(u.table, u.field);
    if (!byField.has(k)) byField.set(k, { table: u.table, field: u.field, uses: [] });
    byField.get(k)!.uses.push(u);
  }
  for (const [k, { table, field, uses: us }] of byField) {
    const records = store.recordCount(table.name);
    if (records < SLOW_RECORDS) continue;
    const ways = [...new Set(us.map((u) => BY[u.by]))];
    const where = [...new Set(us.map((u) => u.where))];
    const impact: Impact = records >= BIG_RECORDS ? 'high' : 'medium';
    const unstored = (field.kind === 'calculation' && field.options?.unstored) || field.kind === 'summary';
    if (unstored) {
      const can = field.kind === 'calculation' && storable(store, table, field);
      out.push({
        id: `unstored-key:${k}`, impact,
        title: `${field.kind === 'summary' ? 'Summary' : 'Unstored calculation'} used as a key: ${k}`,
        what: `${k} is worked out each time it is read, so ${ways.join(' and ')} reads all ${plural(records, 'record')}; no index can help.`,
        instead: field.kind === 'summary' ? 'Sort and match on a stored field instead.'
          : can ? 'Its formula reads only this table\'s fields and nothing that changes by itself: make it a stored calculation (or an auto-enter calculation) and it can be indexed.'
            : 'It reads related records or something that changes by itself, so it can\'t simply be stored: copy its result into a normal field (an auto-enter calculation or a script that keeps it up to date) and use that field.',
        speed: `${ways.join(' and ')} on ${plural(records, 'record')} would stop reading every record once the field is stored and indexed.`,
        count: us.length, where: where.slice(0, WHERE),
        ...(can ? { actions: [fixAction(store, 'store-calculation', 1, [k])] } : {}),
      });
      continue;
    }
    if (field.options?.global || field.type === 'container') continue;
    const noAuto = !!field.options?.noAutoIndex;
    // Matching through a relationship builds its own lookup here; sorts and finds need the index.
    const needsIndex = us.some((u) => u.by !== 'relationship') || noAuto;
    if (!needsIndex || has(table.name, field.name)) continue;
    out.push({
      id: `unindexed-key:${k}`, impact,
      title: `Field used to ${[...new Set(us.map((u) => VERB[u.by]))].join(' and ')} but not indexed: ${k}`,
      what: `${plural(records, 'record')} in ${table.name}; ${ways.join(' and ')} reads them all` + (noAuto ? ' (the field has automatic indexing switched off in FileMaker).' : '.'),
      instead: 'Add an index. It is Tabularius\'s own index: the field\'s design doesn\'t change and the index can be removed again.',
      speed: `${ways.join(' and ')} would go straight to the matching records instead of reading ${plural(records, 'record')}.`,
      count: us.length, where: where.slice(0, WHERE),
      actions: [{
        id: 'add-index', label: `Add an index on ${k}`, available: true,
        request: { method: 'POST', path: '/tabularius/admin/v1/indexes', body: { database: store.name, table: table.name, field: field.name } },
      }],
    });
  }

  // Summary fields in very big tables: every one is worked out over the whole found set each time it is shown.
  for (const t of store.schema.tables) {
    const summaries = t.fields.filter((f) => f.kind === 'summary');
    const records = summaries.length ? store.recordCount(t.name) : 0;
    if (records >= HUGE_RECORDS) {
      out.push({
        id: `summary-big-table:${t.name}`, impact: 'low', title: `Summary fields in a big table: ${t.name}`,
        what: `${t.name} has ${plural(records, 'record')} and ${plural(summaries.length, 'summary field')}; each is worked out over the whole found set whenever it is shown or used.`,
        instead: 'Keep summary fields off layouts people open on the whole table, or keep the totals in a stored field that scripts update.',
        speed: 'Layouts showing them draw faster on a small found set.',
        count: summaries.length, where: summaries.slice(0, WHERE).map((f) => key(t, f)),
      });
    }
  }

  // Value lists taking their values from a big table.
  for (const vl of store.schema.valueLists) {
    if (vl.field) {
      const home = store.calc.occurrenceTable(vl.field.occurrenceId);
      const f = home?.table.fields.find((x) => x.id === vl.field!.fieldId);
      if (!home || !f || home.store !== store) continue;
      const records = store.recordCount(home.table.name);
      if (records >= BIG_RECORDS && !has(home.table.name, f.name) && f.kind !== 'summary' && !(f.kind === 'calculation' && f.options?.unstored)) {
        out.push({
          id: `value-list-unindexed:${vl.name}`, impact: 'medium', title: `Value list reads a big table without an index: ${vl.name}`,
          what: `"${vl.name}" collects the values of ${key(home.table, f)} over ${plural(records, 'record')} each time it is opened.`,
          instead: 'Add an index on the field.', speed: 'The list opens without reading every record.',
          count: records, where: [key(home.table, f)],
          actions: [{ id: 'add-index', label: `Add an index on ${key(home.table, f)}`, available: true, request: { method: 'POST', path: '/tabularius/admin/v1/indexes', body: { database: store.name, table: home.table.name, field: f.name } } }],
        });
      }
    } else if ((vl.values?.length ?? 0) >= LONG_VALUE_LIST) {
      out.push({
        id: `value-list-long:${vl.name}`, impact: 'low', title: `Very long fixed value list: ${vl.name}`,
        what: `"${vl.name}" has ${plural(vl.values!.length, 'value')} typed in, which are sent and searched each time it opens.`,
        instead: 'Keep the values in a table and use a value list from a field.', count: vl.values!.length, where: [vl.name],
      });
    }
  }
  return out;
}

// --- shape: wide tables, repeating fields ---------------------------------------------

function shapeFindings(store: Store): Finding[] {
  const out: Finding[] = [];
  for (const t of store.schema.tables) {
    if (t.fields.length >= WIDE_FIELDS) {
      out.push({
        id: `wide-table:${t.name}`, impact: 'low', title: `Wide table: ${t.name}`,
        what: `${t.name} has ${plural(t.fields.length, 'field')}. Every record carries them all, and layouts and finds slow down as the table grows wide.`,
        instead: 'Move groups of fields that belong together (an address, an audit trail, settings) to their own tables.',
        count: t.fields.length, where: [t.name],
      });
    }
    const repeating = t.fields.filter((f) => (f.options?.repetitions ?? 1) > 1);
    if (repeating.length) {
      out.push({
        id: `repeating-fields:${t.name}`, impact: 'low', title: `Repeating fields: ${t.name}`,
        what: `${plural(repeating.length, 'field')} in ${t.name} hold several values each. They can't be indexed, related or summarised well.`,
        instead: 'Use a related table with one record per value.',
        count: repeating.length, where: repeating.slice(0, WHERE).map((f) => `${key(t, f)} (${f.options!.repetitions})`),
      });
    }
  }
  return out;
}

// --- things nothing uses -----------------------------------------------------------

/** Bytes a field holds in its table (container files counted by size). */
function heldBytes(store: Store, t: Table, f: Field, containers: ContainerUse[]): number {
  if (f.type === 'container') return containers.find((c) => c.table === t.name && c.field === f.name)?.bytes ?? 0;
  if (f.kind === 'summary' || (f.kind === 'calculation' && f.options?.unstored) || f.options?.global) return 0;
  try {
    return Number((store.sql.prepare(`SELECT coalesce(sum(length(${q(f.name)})), 0) AS n FROM ${q(t.name)}`).get() as { n: number }).n);
  } catch {
    return 0;
  }
}

/** What nothing uses, by name: all of it, where the findings list only the first few. */
export interface UnusedNames { scripts: string[]; valueLists: string[]; occurrences: string[] }

export function unusedFindings(store: Store, containers: ContainerUse[], into?: UnusedNames): Finding[] {
  const out: Finding[] = [];
  const s = store.schema;
  const index = solutionIndex(store);
  if (!index.referenceComplete) {
    out.push({ id: 'unverified-references', impact: 'low', title: 'Cannot verify some unused objects', what: 'Some calculations could not be indexed. Objects they may name are excluded from removal advice.', count: 0, where: [] });
  }
  // Everything any formula, script step, layout object or relationship names. A name written inside a string counts too.
  const named = new Set<string>();
  const occurrences = new Set<string>();
  const valueLists = new Set<string>();
  for (const site of index.sites) {
    for (const k of site.refs.fields) {
      // A field's own definition naming itself isn't a use.
      if (site.kind === 'field' && site.where.startsWith(`Field ${k} (`)) continue;
      named.add(k);
    }
    for (const o of site.refs.occurrences) occurrences.add(o);
    for (const v of site.refs.valueLists) valueLists.add(v);
  }
  const texts = lower(index.sites.map((x) => x.text).join('\n'));
  for (const vl of s.valueLists) {
    if (vl.field) {
      const home = store.calc.occurrenceTable(vl.field.occurrenceId);
      for (const id of [vl.field.fieldId, vl.field.secondFieldId]) {
        const f = home?.table.fields.find((x) => x.id === id);
        if (home && f) named.add(key(home.table, f));
      }
    }
  }
  for (const t of s.tables) {
    for (const f of t.fields) {
      const l = f.options?.autoEnter?.lookup;
      const home = l && store.calc.occurrenceTable(l.occurrenceId);
      const src = home?.table.fields.find((x) => x.id === l!.fieldId);
      if (home && src) named.add(key(home.table, src));
    }
  }
  for (const design of store.designs().layouts) {
    const walk = (objects: typeof design.objects) => {
      for (const o of objects) {
        for (const sort of o.portal?.sort ?? []) {
          const to = (sort.field as { tableOccurrenceId?: number } | undefined)?.tableOccurrenceId;
          const fid = (sort.field as { fieldId?: number } | undefined)?.fieldId;
          const home = to !== undefined ? store.calc.occurrenceTable(to) : undefined;
          const f = home?.table.fields.find((x) => x.id === fid);
          if (home && f) named.add(key(home.table, f));
        }
        if (o.children?.length) walk(o.children);
      }
    };
    walk(design.objects);
  }

  // Fields.
  const unused: { t: Table; f: Field; bytes: number }[] = [];
  for (const t of s.tables) {
    for (const f of t.fields) {
      const k = key(t, f);
      if (named.has(k) || texts.includes(lower(k)) || !canVerifyUnused(index, k) || !canVerifyUnused(index, f.name)) continue;
      // Keys and bookkeeping fields (ids, serial numbers, creation stamps) are used by data outside the file.
      if (f.options?.autoEnter?.serial || /^(?:_?pk|_?fk|id|uuid|primarykey|foreignkey)\b/i.test(f.name) || f.options?.autoEnter?.value) continue;
      unused.push({ t, f, bytes: unused.length < 200 ? heldBytes(store, t, f, containers) : 0 });
    }
  }
  if (unused.length) {
    unused.sort((a, b) => b.bytes - a.bytes);
    const total = unused.reduce((n, u) => n + u.bytes, 0);
    out.push({
      id: 'unused-fields', impact: total >= 5 * 1024 ** 2 ? 'medium' : 'low', title: 'Fields nothing uses',
      what: `${plural(unused.length, 'field')} appear on no layout and in no script, formula, relationship, value list or sort` +
        (total >= 1024 ? `, and hold ${bytesText(total)} of data` : '') + '. They may still be read from outside the file (the Data API, ODBC, an import or an export), so check before removing any.',
      instead: 'Remove the ones nothing outside needs; export their data first if it matters.',
      ...(total >= 1024 ? { savesBytes: total } : {}),
      count: unused.length, where: unused.slice(0, WHERE).map((u) => key(u.t, u.f) + (u.bytes ? ` (${bytesText(u.bytes)})` : '')),
    });
  }

  // Table occurrences: none that are the only way into their table.
  const onLayout = new Set(store.designs().layouts.map((l) => l.tableOccurrenceId).filter((x): x is number => x !== undefined));
  const inRelationship = new Set(s.relationships.flatMap((r) => [r.leftTableOccurrenceId, r.rightTableOccurrenceId]));
  const idle = s.tableOccurrences.filter((to) => {
    if (to.dataSourceId || onLayout.has(to.id) || inRelationship.has(to.id)) return false;
    if (occurrences.has(lower(to.name)) || texts.includes(lower(to.name)) || !canVerifyUnused(index, to.name)) return false;
    return s.tableOccurrences.some((o) => o.id !== to.id && o.baseTableId === to.baseTableId && !o.dataSourceId);
  });
  if (into) into.occurrences = idle.map((to) => to.name);
  if (idle.length) {
    out.push({
      id: 'unused-table-occurrences', impact: 'low', title: 'Table occurrences nothing uses',
      what: `${plural(idle.length, 'table occurrence')} ${idle.length === 1 ? 'is' : 'are'} on no layout, in no relationship and named by no formula or script, and their tables have other occurrences.`,
      instead: 'Delete them from the relationships graph; they clutter it and slow down reading the file.',
      count: idle.length, where: idle.slice(0, WHERE).map((to) => to.name),
      actions: [fixAction(store, 'remove-table-occurrences', idle.length)],
    });
  }

  // Scripts: not called by a script, a button, a trigger, a menu or File Options. Skipped when a script is performed by a name worked out when it runs.
  const dynamic = index.sites.some((x) => x.kind === 'script' && /^(?:\/\/ )?Perform Script\b.*\bby name\b/i.test(x.text));
  if (!dynamic) {
    const stray = s.scripts.filter((sc) => {
      const n = lower(sc.name);
      return !index.callers.has(n) && !index.buttons.has(n) && !index.starters.has(n) && !texts.includes(`"${n}"`) && !texts.includes(`'${n}'`) && canVerifyUnused(index, sc.name);
    });
    if (into) into.scripts = stray.map((sc) => sc.name);
    const shown = stray.filter((sc) => !s.scriptOrder.find((o) => o.kind === 'item' && o.id === sc.id)?.hidden);
    if (stray.length) {
      out.push({
        id: 'unused-scripts', impact: 'low', title: 'Scripts nothing runs',
        what: `${plural(stray.length, 'script')} ${stray.length === 1 ? 'is' : 'are'} performed by no script, button, trigger or custom menu. People may still run them from the Scripts menu, a schedule or the Data API.`,
        instead: 'Remove the ones nobody runs, or keep them in a folder named for what they are (utilities, old).',
        count: stray.length, where: stray.slice(0, WHERE).map((sc) => sc.name),
        actions: [
          ...(shown.length ? [fixAction(store, 'hide-scripts', shown.length)] : []),
          fixAction(store, 'remove-scripts', stray.length),
        ],
      });
    }
  }

  // Value lists named nowhere.
  const lists = s.valueLists.filter((vl) => !valueLists.has(lower(vl.name)) && !texts.includes(lower(vl.name)) && canVerifyUnused(index, vl.name));
  if (into) into.valueLists = lists.map((vl) => vl.name);
  if (lists.length) {
    out.push({
      id: 'unused-value-lists', impact: 'low', title: 'Value lists nothing uses',
      what: `${plural(lists.length, 'value list')} ${lists.length === 1 ? 'is' : 'are'} on no field, layout object or validation.`,
      instead: 'Delete them.', count: lists.length, where: lists.slice(0, WHERE).map((v) => v.name),
      actions: [fixAction(store, 'remove-value-lists', lists.length)],
    });
  }
  return out;
}

// --- the report ---------------------------------------------------------------------

export function optimizationReport(store: Store): OptimizationReport {
  const { storeBytes, spaceByTable } = sizes(store);
  const use = containerUse(store);
  const embedded = use.reduce((n, u) => n + u.bytes, 0);
  const findings = [
    ...containerFindings(use, storeBytes, embeddingFields(store), store.name),
    ...pictureFindings(store, use, embeddingFields(store)),
    ...speedFindings(store),
    ...unusedFindings(store, use),
    ...shapeFindings(store),
    ...dataFindings(store),
    ...layoutFindings(store),
  ];
  const rank = (f: Finding) => IMPACTS.indexOf(f.impact);
  findings.sort((a, b) => rank(a) - rank(b) || (b.savesBytes ?? 0) - (a.savesBytes ?? 0) || b.count - a.count || a.id.localeCompare(b.id));
  const containers = {
    files: use.reduce((n, u) => n + u.files, 0), bytes: embedded, images: use.reduce((n, u) => n + u.images, 0),
    imageBytes: use.reduce((n, u) => n + u.imageBytes, 0), outsideFiles: use.reduce((n, u) => n + u.outsideFiles, 0),
  };
  const report: OptimizationReport = {
    database: store.name, made: new Date().toISOString(), storeBytes, spaceByTable, containers, findings, headline: '', text: '',
  };
  const changes = fixChanges(store);
  if (changes.length) report.changes = changes;
  report.headline = headline(report);
  report.text = optimizationText(report);
  return report;
}

function headline(r: OptimizationReport): string {
  if (!r.findings.length) return `${r.database}: nothing found to make smaller or faster`;
  const high = r.findings.filter((f) => f.impact === 'high').length;
  const movable = r.findings.filter((f) => f.id.startsWith('embedded-container:')).reduce((n, f) => n + (f.savesBytes ?? 0), 0);
  return `${r.database}: ${plural(r.findings.length, 'suggestion')}${high ? ` (${high} high impact)` : ''}` +
    (movable ? `, ${bytesText(movable)} of container files stored inside the file (${Math.round((movable / Math.max(r.storeBytes, 1)) * 100)}% of ${bytesText(r.storeBytes)})` : '');
}

/** The report as Markdown, in the layout the admin console's guide view reads. */
export function optimizationText(r: OptimizationReport): string {
  const out = [`# ${r.database}: ways to make it smaller and faster`, ''];
  out.push(`The converted file is ${bytesText(r.storeBytes)}.` + (r.containers.bytes
    ? ` ${bytesText(r.containers.bytes)} of that is ${plural(r.containers.files, 'container file')} stored inside it` +
      (r.containers.images && r.containers.images < r.containers.files ? `, ${plural(r.containers.images, 'picture')} among them (${bytesText(r.containers.imageBytes)})` : r.containers.images ? ', all of them pictures' : '') + '.'
    : ''), '');
  if (r.spaceByTable.length) out.push(`Most space: ${r.spaceByTable.slice(0, 3).map((t) => `${t.name} ${bytesText(t.bytes)}`).join(', ')}.`, '');
  if (!r.findings.length) out.push('Nothing found to make smaller or faster. Nothing here is changed without your approval.');
  const titles: Record<Impact, string> = { high: 'High impact', medium: 'Worth doing', low: 'Housekeeping' };
  for (const impact of IMPACTS) {
    const items = r.findings.filter((f) => f.impact === impact);
    if (!items.length) continue;
    out.push(`## ${titles[impact]}`);
    for (const f of items) {
      const facts = [f.savesBytes ? `saves ${f.estimated ? 'about' : 'up to'} ${bytesText(f.savesBytes)}` : '', f.count > 1 ? f.count.toLocaleString('en-US') : ''].filter(Boolean).join('; ');
      out.push(`- **${f.title}**${facts ? ` (${facts})` : ''}: ${f.what}`);
      if (f.speed) out.push(`  Faster: ${f.speed}`);
      if (f.instead) out.push(`  Instead: ${f.instead}`);
      const available = (f.actions ?? []).filter((a) => a.available);
      if (available.length) out.push(`  Action: ${available.map((a) => a.label).join('; ')} (only when you approve it)`);
      if (f.where.length) out.push(`  Where: ${f.where.join('; ')}${f.count > f.where.length && f.where.length >= WHERE ? '; …' : ''}`);
    }
    out.push('');
  }
  if (r.findings.some((f) => f.actions?.some((a) => !a.available))) out.push('Moving container files out of the file waits for an S3 connection to be set up.', '');
  return redactSecrets(out.join('\n').trimEnd());
}
