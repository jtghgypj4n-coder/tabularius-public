// A file's design as a folder of small text files, one per table, script,
// layout, value list, custom function and privilege set, so it can be kept in
// git and each change shows as a readable diff. FileMaker has nothing like it:
// its Database Design Report and Save a Copy as XML are each one large file
// whose order and ids shift from save to save.
//
// The same design always gives the same text: objects are written by name,
// JSON keys are sorted, and values that change with the data (a serial
// number's next value) are left out. No record data and no secrets: accounts
// are listed by name, privilege set and how they sign in, never with a
// password or its verifier. Layout themes are left out (they are large and
// rarely edited by hand).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { LayoutDesign, Schema, Field, OrderedItem } from '../../fmp12/src/index.ts';
import { scriptText } from '../../fmp12/src/index.ts';

export interface DesignSource {
  schema: Schema;
  layouts: LayoutDesign[];
  /** The file's accounts: name, privilege set and whether an identity provider signs them in. */
  accounts: { name: string; privilegeSet?: string; external?: boolean; agent?: boolean }[];
  /** Privilege sets as the file holds them (the hosted file's own, with Tabularius's edits). */
  privilegeSets: { name: string }[];
}

/** JSON with keys in a fixed order, so the same object always reads the same. */
export function stableJson(v: unknown, indent = ''): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  const next = indent + '  ';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return '[\n' + v.map((x) => next + stableJson(x, next)).join(',\n') + '\n' + indent + ']';
  }
  const keys = Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort();
  if (!keys.length) return '{}';
  return '{\n' + keys.map((k) => `${next}${JSON.stringify(k)}: ${stableJson((v as Record<string, unknown>)[k], next)}`).join(',\n') + '\n' + indent + '}';
}

/** A name made safe as a file name on macOS, Windows and Linux. */
function safeName(name: string): string {
  let s = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').replace(/[. ]+$/, '').trim();
  if (!s || s === '.' || s === '..') s = '_';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = '_' + s;
  return s.slice(0, 120);
}

/** Paths for named objects, unique even where names differ only in case (macOS and Windows) or clash once made safe. */
function pathsFor<T extends { id: number; name: string }>(items: T[], folder: string, ext: string, folders?: Map<number, string>): Map<T, string> {
  const out = new Map<T, string>();
  const used = new Map<string, number>();
  const sorted = [...items].sort((a, b) => a.id - b.id);
  for (const it of sorted) {
    const dir = folders?.get(it.id) ? `${folder}/${folders.get(it.id)}` : folder;
    let p = `${dir}/${safeName(it.name)}${ext}`;
    if (used.has(p.toLowerCase())) p = `${dir}/${safeName(it.name)} (id ${it.id})${ext}`;
    used.set(p.toLowerCase(), it.id);
    out.set(it, p);
  }
  return out;
}

/** The folder each script or layout sits in, from the file's own ordering (Manage Scripts folders, layout folders). */
function folderPaths(order: OrderedItem[]): Map<number, string> {
  const out = new Map<number, string>();
  const stack: string[] = [];
  for (const o of order) {
    if (o.kind === 'folder') { stack.length = o.depth; stack.push(safeName(o.name)); }
    else if (o.kind === 'folder-end') stack.length = Math.max(0, o.depth);
    else if (o.kind === 'item') { stack.length = Math.min(stack.length, o.depth); if (stack.length) out.set(o.id, stack.join('/')); }
  }
  return out;
}

function fieldText(f: Field, schema: Schema): string {
  const occ = (id?: number) => schema.tableOccurrences.find((t) => t.id === id)?.name;
  const lines = [`${f.name}`, `  Type: ${f.type}, ${f.kind}`];
  if (f.comment) lines.push(`  Comment: ${f.comment.replace(/\r\n?|\n/g, '\n    ')}`);
  if (f.summary) lines.push(`  Summary: ${f.summary.type} of ${f.summary.field ?? `field ${f.summary.fieldId}`}`);
  if (f.calculation !== undefined) {
    const ctx = occ(f.calculationContextId);
    lines.push(`  Formula${ctx ? ` (from ${ctx})` : ''}:`, ...f.calculation.split(/\r\n?|\n/).map((l) => '    ' + l));
  }
  if (f.options) {
    // A serial number's next value moves with every new record: kept out, so adding data changes nothing here.
    const options = structuredClone(f.options);
    if (options.autoEnter?.serial) delete (options.autoEnter.serial as { next?: string }).next;
    // FileMaker's defaults say nothing: left out, so most fields need no options line at all.
    const o = options as Partial<typeof options>;
    if (o.global === false) delete o.global;
    if (o.unstored === false) delete o.unstored;
    if (o.repetitions === 1) delete o.repetitions;
    const json = stableJson(options, '  ');
    if (json !== '{}') lines.push(`  Options: ${json}`);
  }
  return lines.join('\n');
}

/** A native file's foreign key, under its relationship: `  Foreign key "Name": Child::Field references Parent::Field, on delete cascade`. */
function foreignKeyLine(r: Schema['relationships'][number], left: string, right: string): string {
  const fk = r.foreignKey!;
  const p = r.predicates[0];
  const ends = [`${left}::${p?.leftField ?? p?.leftFieldId}`, `${right}::${p?.rightField ?? p?.rightFieldId}`];
  const [child, parent] = fk.child === 'left' ? ends : [ends[1], ends[0]];
  return `  Foreign key ${JSON.stringify(fk.name)}: ${child} references ${parent}, on delete ${fk.onDelete}`;
}

/**
 * The design as files: a map from a relative path (with "/" separators) to
 * its text. Every file ends with a newline.
 */
export function designText(src: DesignSource): Map<string, string> {
  const { schema } = src;
  const files = new Map<string, string>();
  const put = (path: string, text: string) => files.set(path, text.endsWith('\n') ? text : text + '\n');

  for (const [t, path] of pathsFor(schema.tables, 'tables', '.txt')) {
    put(path, [`Table: ${t.name} (id ${t.id})`, '', ...[...t.fields].sort((a, b) => a.id - b.id).map((f) => fieldText(f, schema) + '\n')].join('\n'));
  }

  const tos = [...schema.tableOccurrences].sort((a, b) => a.id - b.id).map((o) => {
    const base = o.dataSourceId === undefined ? schema.tables.find((t) => t.id === o.baseTableId)?.name : undefined;
    const source = o.dataSourceId !== undefined ? `${schema.dataSources.find((d) => d.id === o.dataSourceId)?.name ?? `data source ${o.dataSourceId}`}, table ${o.baseTableId}` : undefined;
    return `${o.name} → ${base ?? source ?? `table ${o.baseTableId}`}`;
  });
  const rels = [...schema.relationships].sort((a, b) => a.id - b.id).map((r) => {
    const l = r.leftTableOccurrence ?? `occurrence ${r.leftTableOccurrenceId}`;
    const rt = r.rightTableOccurrence ?? `occurrence ${r.rightTableOccurrenceId}`;
    const preds = r.predicates.map((p) => `${l}::${p.leftField ?? p.leftFieldId} ${p.operator} ${rt}::${p.rightField ?? p.rightFieldId}`);
    const opts = [
      r.leftCreate && `create in ${l}`, r.rightCreate && `create in ${rt}`,
      r.leftDelete && `delete in ${l}`, r.rightDelete && `delete in ${rt}`, r.sorted && 'sorted',
    ].filter(Boolean);
    return `${l} ↔ ${rt}\n${preds.map((p) => '  ' + p).join('\n')}${opts.length ? `\n  Options: ${opts.join(', ')}` : ''}${r.foreignKey ? `\n${foreignKeyLine(r, l, rt)}` : ''}`;
  });
  put('relationships.txt', ['Table occurrences', '', ...tos, '', 'Relationships', '', ...rels.flatMap((r) => [r, ''])].join('\n'));

  const scriptFolders = folderPaths(schema.scriptOrder);
  for (const [s, path] of pathsFor(schema.scripts, 'scripts', '.txt', scriptFolders)) {
    const head = [`# Script: ${s.name} (id ${s.id})`];
    if (s.fullAccess) head.push('# Run script with full access privileges');
    if (s.limits) head.push(`# Limits: ${stableJson(s.limits).replace(/\s+/g, ' ')}`);
    put(path, head.join('\n') + '\n\n' + scriptText(s.steps));
  }

  const layoutFolders = folderPaths(schema.layoutOrder);
  const designs = new Map(src.layouts.map((d) => [d.id, d]));
  for (const [l, path] of pathsFor(schema.layouts, 'layouts', '.json', layoutFolders)) {
    put(path, stableJson(designs.get(l.id) ?? { id: l.id, name: l.name, tableOccurrenceId: l.tableOccurrenceId }));
  }

  for (const [v, path] of pathsFor(schema.valueLists, 'value-lists', '.txt')) {
    const lines = [`Value list: ${v.name} (id ${v.id})`, ''];
    if (v.values) lines.push(...v.values);
    if (v.field) {
      const f = v.field;
      const occ = schema.tableOccurrences.find((t) => t.id === f.occurrenceId);
      const table = schema.tables.find((t) => t.id === occ?.baseTableId);
      const name = (id?: number) => id === undefined ? undefined : table?.fields.find((x) => x.id === id)?.name ?? `field ${id}`;
      lines.push(`From field: ${occ?.name ?? `occurrence ${f.occurrenceId}`}::${name(f.fieldId)}`);
      if (f.secondFieldId !== undefined) lines.push(`Also show: ${name(f.secondFieldId)}${f.showSecondOnly ? ' (only)' : ''}`);
      if (f.relatedFromId !== undefined) lines.push(`Only related values, from: ${schema.tableOccurrences.find((t) => t.id === f.relatedFromId)?.name ?? f.relatedFromId}`);
      if (f.sortBySecond) lines.push('Sorted by the second field');
    }
    if (v.external) lines.push(`From another file: ${schema.dataSources.find((d) => d.id === v.external!.dataSourceId)?.name ?? v.external.dataSourceId}, value list ${v.external.valueListId}`);
    put(path, lines.join('\n'));
  }

  for (const [c, path] of pathsFor(schema.customFunctions, 'custom-functions', '.txt')) {
    const sig = c.parameters.length ? `${c.name} ( ${c.parameters.join(' ; ')} )` : c.name;
    put(path, `${sig}${c.language === 'javascript' ? '  [JavaScript]' : ''}\n\n${c.formula ?? ''}`);
  }

  const sets = src.privilegeSets.map((p, i) => ({ ...p, id: (p as { id?: number }).id ?? -1 - i }));
  for (const [p, path] of pathsFor(sets, 'privilege-sets', '.json')) {
    const { id, ...rest } = p;
    put(path, stableJson(id < 0 ? rest : { id, ...rest }));
  }

  // Who has which set, but never a password or anything that would check one.
  const accounts = [...src.accounts].sort((a, b) => a.name.localeCompare(b.name)).map((a) =>
    `${a.name}\t${a.privilegeSet ?? '(no privilege set)'}\t${a.agent ? 'AI agent' : a.external ? 'External' : 'Password'}`);
  put('accounts.txt', ['Account\tPrivilege set\tSigns in with', ...accounts].join('\n'));

  const file = {
    dataSources: [...schema.dataSources].sort((a, b) => a.id - b.id),
    fileOptions: schema.fileOptions,
    containerDirectories: schema.containerDirectories,
    customMenuSets: schema.customMenuSets.length ? schema.customMenuSets : undefined,
    customMenus: schema.customMenus.length ? schema.customMenus : undefined,
    defaultMenuSetId: schema.defaultMenuSetId,
  };
  put('file.json', stableJson(file));
  return files;
}

/** What each file of designText() is: the kind of object and its id (design-apply.ts reads edits back through it). */
export type DesignObjectKind = 'table' | 'script' | 'layout' | 'valueList' | 'customFunction';
export function designObjects(src: DesignSource): Map<string, { kind: DesignObjectKind; id: number; name: string }> {
  const { schema } = src;
  const out = new Map<string, { kind: DesignObjectKind; id: number; name: string }>();
  const add = (kind: DesignObjectKind, paths: Map<{ id: number; name: string }, string>) => {
    for (const [o, path] of paths) out.set(path, { kind, id: o.id, name: o.name });
  };
  add('table', pathsFor(schema.tables, 'tables', '.txt'));
  add('script', pathsFor(schema.scripts, 'scripts', '.txt', folderPaths(schema.scriptOrder)));
  add('layout', pathsFor(schema.layouts, 'layouts', '.json', folderPaths(schema.layoutOrder)));
  add('valueList', pathsFor(schema.valueLists, 'value-lists', '.txt'));
  add('customFunction', pathsFor(schema.customFunctions, 'custom-functions', '.txt'));
  return out;
}

/** The list of files a previous run wrote, kept in the folder so the next run can remove what no longer exists. */
export const DESIGN_MANIFEST = '.openhbam-design';

/**
 * Writes the design into a folder (made if needed). Files that an earlier run
 * wrote for objects since deleted or renamed are removed; nothing else in the
 * folder is touched, so it can sit inside a repository with other files.
 * Returns what changed.
 */
export function writeDesignText(dir: string, files: Map<string, string>): { written: string[]; unchanged: number; removed: string[] } {
  const root = resolve(dir);
  const inside = (p: string) => { const full = resolve(root, p); return full.startsWith(root + sep) ? full : undefined; };
  mkdirSync(root, { recursive: true });
  const manifest = join(root, DESIGN_MANIFEST);
  const before = existsSync(manifest) ? readFileSync(manifest, 'utf8').split('\n').filter(Boolean) : [];
  const written: string[] = [];
  let unchanged = 0;
  for (const [p, text] of files) {
    const full = inside(p);
    if (!full) throw new Error(`Not a path inside the folder: ${p}`);
    if (existsSync(full) && readFileSync(full, 'utf8') === text) { unchanged++; continue; }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    written.push(p);
  }
  const removed: string[] = [];
  const now = new Set([...files.keys()]);
  for (const p of before) {
    if (now.has(p)) continue;
    const full = inside(p);
    if (!full || !existsSync(full)) continue;
    rmSync(full);
    removed.push(p);
    // Folders a removed file leaves empty go too, up to the folder itself.
    for (let d = dirname(full); d.startsWith(root + sep); d = dirname(d)) {
      if (readdirSync(d).length) break;
      rmdirSync(d);
    }
  }
  writeFileSync(manifest, [...files.keys()].sort().join('\n') + '\n');
  return { written, unchanged, removed };
}
