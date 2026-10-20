// A solution map across every hosted file: which files' table occurrences,
// value lists and scripts reach into which other files. FileMaker's own
// tooling shows external references one file at a time (External Data Sources,
// and a reference turning red when its file is missing); hosting the whole
// solution together lets us read every file and draw the dependency graph in
// one view, and warn before a change in one file breaks another (see
// crossFileImpact). Only names are read here (files, occurrences, value lists,
// scripts, tables) — never record data.

import { dataSourceFile } from '../../store/src/import.ts';
import type { Store } from '../../store/src/index.ts';
import { aiBlocker } from './ai-access.ts';

const lower = (s: string) => s.toLowerCase();

/** One cross-file reference: a thing in `from` that reaches into another file. */
export interface Reach {
  via: 'occurrence' | 'valueList' | 'script';
  /** The occurrence, value list or script in `from` that reaches out. */
  item: string;
  /** The referenced file, named as the data source writes it. */
  file: string;
  /** Whether that file is hosted alongside `from`. */
  hosted: boolean;
  /** Specifics, e.g. the base table or value list reached. */
  detail?: string;
}

/** A hosted file and its cross-file ties, both directions. */
export interface FileNode {
  name: string;
  /** Files this one reaches into. */
  reaches: string[];
  /** Files that reach into this one. */
  referencedBy: string[];
  /** Named files it references that are not hosted (a red reference in FileMaker). */
  unresolved: string[];
}

export interface SolutionMap {
  files: FileNode[];
  /** Every cross-file reference, so a reader can list exactly what ties two files. */
  references: ({ from: string } & Reach)[];
  /** Named files referenced by some hosted file but not hosted themselves. */
  unresolved: string[];
}

/** The file a data source names, as written (its path's file name, else the source's own name). */
function dataSourceName(store: Store, id: number | undefined): string | undefined {
  const d = store.schema.dataSources.find((x) => x.id === id);
  return d ? dataSourceFile(d.paths) ?? d.name : undefined;
}

/** Every cross-file reference out of one file. */
function reachesOf(store: Store, hosted: Set<string>): Reach[] {
  const s = store.schema;
  const out: Reach[] = [];
  const add = (via: Reach['via'], item: string, file: string, detail?: string) =>
    out.push({ via, item, file, hosted: hosted.has(lower(file)), detail });

  // Table occurrences whose base table lives in another file.
  for (const to of s.tableOccurrences) {
    if (!to.dataSourceId) continue;
    const file = dataSourceName(store, to.dataSourceId);
    if (file && lower(file) !== lower(store.name)) {
      const other = hosted.has(lower(file)) && store.resolveFile(file);
      const base = other ? other.schema.tables.find((t) => t.id === to.baseTableId)?.name : undefined;
      add('occurrence', to.name, file, base ? `base table ${base}` : undefined);
    }
  }
  // Value lists taken from a list in another file, or from a field of a cross-file occurrence.
  for (const vl of s.valueLists) {
    if (vl.external) {
      const file = dataSourceName(store, vl.external.dataSourceId);
      if (file && lower(file) !== lower(store.name)) add('valueList', vl.name, file, 'external value list');
    } else if (vl.field) {
      const to = s.tableOccurrences.find((t) => t.id === vl.field!.occurrenceId);
      if (to?.dataSourceId) {
        const file = dataSourceName(store, to.dataSourceId);
        if (file && lower(file) !== lower(store.name)) add('valueList', vl.name, file, `values from ${to.name}`);
      }
    }
  }
  // Scripts that open or call another file.
  for (const script of s.scripts) {
    const files = new Map<string, string>(); // file (lower) -> name as written
    for (const step of script.steps) {
      const ref = step.params?.script?.file ?? step.params?.dataSource;
      const file = ref && dataSourceName(store, ref.id);
      if (file && lower(file) !== lower(store.name)) files.set(lower(file), file);
    }
    for (const file of files.values()) add('script', script.name, file, undefined);
  }
  return out;
}

/** Reads every hosted file and draws the cross-file dependency graph. */
export function solutionMap(stores: Store[]): SolutionMap {
  const hosted = new Set(stores.map((s) => lower(s.name)));
  const references: ({ from: string } & Reach)[] = [];
  const nodes = new Map<string, FileNode>();
  for (const s of stores) nodes.set(lower(s.name), { name: s.name, reaches: [], referencedBy: [], unresolved: [] });

  for (const store of stores) {
    const node = nodes.get(lower(store.name))!;
    const reaches = new Set<string>();
    const unresolved = new Set<string>();
    for (const r of reachesOf(store, hosted)) {
      references.push({ from: store.name, ...r });
      if (r.hosted) reaches.add(lower(r.file));
      else unresolved.add(r.file);
    }
    for (const key of reaches) {
      const target = nodes.get(key)!;
      node.reaches.push(target.name);
      target.referencedBy.push(store.name);
    }
    node.unresolved = [...unresolved].sort();
  }

  const files = [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const f of files) {
    f.reaches.sort((a, b) => a.localeCompare(b));
    f.referencedBy.sort((a, b) => a.localeCompare(b));
  }
  const unresolved = [...new Set(files.flatMap((f) => f.unresolved))].sort();
  return { files, references, unresolved };
}

/** A file whose names are kept from AI: it appears in the map, but opaque. */
export interface OpaqueNode {
  name: string;
  aiOff: true;
}

export interface AiSolutionMap extends Omit<SolutionMap, 'files'> {
  files: (FileNode | OpaqueNode)[];
}

/**
 * The solution map for an AI client: a file with AI turned off (or one that
 * uses such a file) is read for none of its names — it shows only as an opaque
 * "AI off" node. Because any file that reaches into an AI-off file is itself
 * AI-off, the readable files only ever reference other readable files, so the
 * map stays self-contained and leaks nothing of the closed files.
 */
export function aiSolutionMap(designable: Store[]): AiSolutionMap {
  const open = designable.filter((s) => !aiBlocker(s));
  const off = designable.filter((s) => aiBlocker(s)).map((s) => s.name).sort((a, b) => a.localeCompare(b));
  const map = solutionMap(open);
  return { ...map, files: [...map.files, ...off.map((name): OpaqueNode => ({ name, aiOff: true }))] };
}
