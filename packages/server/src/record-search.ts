// Search across every record's text, ranked, the way a site search works:
// "acme invoice march" finds the records whose text fields hold those words,
// whatever table or field they are in. Words match by prefix, ignoring case and
// accents. It runs on the server with no outside service, on the same word
// indexes finds use (SQLite FTS5 per table, see store/src/words.ts), which
// are kept current as records change.

import type { Table } from '../../fmp12/src/index.ts';
import { q } from '../../store/src/import.ts';
import { StoreError, type Privileges, type Store } from '../../store/src/index.ts';
import { wordIndexName } from '../../store/src/words.ts';
import { containsSecret, secretName, secretValues } from './ai-output.ts';

export interface RecordHit {
  table: string;
  /** A layout on the record's table that the account can open, for get_record. */
  layout?: string;
  recordId: number;
  /** Relevance from 0 to 100: share of the words found, words found together in one field, then BM25. */
  score: number;
  /** The fields that matched, with the matching words in [brackets]. */
  matches: { field: string; text: string }[];
}

/** The words of a search, each to be matched as a prefix. */
export function wordsOf(text: string): string[] {
  return [...new Set(text.normalize('NFKC').match(/[\p{L}\p{N}][\p{L}\p{N}'’._@-]*/gu)?.map((w) => w.toLowerCase()) ?? [])];
}
const term = (w: string) => `"${w.replace(/"/g, '')}"*`;

/**
 * Records whose text matches the words, best first. Every word must appear
 * somewhere in the record (in any of its fields); when no record has them
 * all, records with any of them are returned instead. With privileges: only
 * tables, fields and records the account can see.
 */
export function searchRecords(store: Store, text: string, opts: { privileges?: Privileges; limit?: number; tables?: string[] } = {}): { query: string; matchedAll: boolean; hits: RecordHit[] } {
  const pv = opts.privileges;
  const words = wordsOf(text);
  if (!words.length) return { query: text, matchedAll: false, hits: [] };
  const wanted = opts.tables?.map((t) => t.toLowerCase());
  const layout = layoutFor(store, pv);
  const tables = store.schema.tables.filter((t) => {
    if (wanted && !wanted.includes(t.name.toLowerCase()) || pv?.table(t.name).view === false) return false;
    if (!pv || layout(t.name)) return true;
    // A broad search omits tables with no readable layout. An explicit table
    // request reports the same denial as reading through its layout.
    if (!wanted) return false;
    const visible = store.layouts().some((l) => !l.file && l.table === t.name && pv.layout(l.name).layout !== 'none');
    throw new StoreError(visible ? 200 : 105, visible ? 'Record access is denied through this layout' : `No accessible layout for table "${t.name}"`);
  });
  const indexed = new Map<string, { table: Table; fields: string[] }>();
  for (const t of tables) indexed.set(t.name, { table: t, fields: [...store.words.ensure(t)] });
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);

  // Per table: which fields and records the account may see.
  const visible = new Map<string, { fields: string[]; ids?: Set<number> }>();
  for (const t of tables) {
    // A password or key field is not searched at all: a hit there would show the secret one prefix at a time.
    const fields = indexed.get(t.name)!.fields.filter((f) => !secretName(f) && (!pv || pv.field(t.name, f) !== 'none'));
    const ids = store.viewableIds(t.name, pv);
    visible.set(t.name, { fields, ...(ids ? { ids: new Set(ids) } : {}) });
  }
  // For each word, the matching fields the account can see.
  const hits = new Map<string, RecordHit & { found: Set<string>; rows: Map<string, number> }>();
  for (const t of tables) {
    const v = visible.get(t.name)!;
    const fts = q(wordIndexName(t));
    for (const field of v.fields) {
      const sql = `SELECT rowid AS rid, bm25(${fts}) AS rank FROM ${fts} WHERE ${q(field)} MATCH ?`;
      for (const w of words) {
        // Read whole inside the retry: "database schema has changed" can come while the rows are read, not only when
        // the statement is prepared.
        const rows = store.words.retry(() => store.sql.prepare(sql).all(term(w)) as { rid: number; rank: number }[]);
        for (const r of rows) {
          if (v.ids && !v.ids.has(Number(r.rid))) continue;
          const key = `${t.name}\0${r.rid}`;
          let hit = hits.get(key);
          if (!hit) hits.set(key, (hit = { table: t.name, recordId: Number(r.rid), score: 0, matches: [], found: new Set(), rows: new Map() }));
          hit.score += -r.rank;
          hit.found.add(w);
          hit.rows.set(field, (hit.rows.get(field) ?? 0) + 1);
        }
      }
    }
  }
  let list = [...hits.values()];
  const all = list.filter((h) => h.found.size === words.length);
  const matchedAll = all.length > 0;
  if (matchedAll) list = all;
  // Most words first, then most words together in one field (a name, an address), then relevance.
  const together = (h: { rows: Map<string, number> }) => Math.max(...h.rows.values());
  list.sort((a, b) => b.found.size - a.found.size || together(b) - together(a) || b.score - a.score);
  // A score from 0 to 100: words found, then words together in one field, then BM25 relative to the best hit
  // (BM25 alone is near 0 for words that are in most records, so it can't stand on its own).
  const best = Math.max(0, ...list.map((h) => h.score));
  const relevance = (h: { found: Set<string>; rows: Map<string, number>; score: number }) =>
    Math.round(70 * h.found.size / words.length + 20 * Math.min(1, together(h) / words.length) + (best > 0 ? 10 * Math.max(0, h.score) / best : 0));
  // The fields that matched, best first, with every search word marked.
  const any = words.map(term).join(' OR ');
  const snippet = (table: string, field: string, recordId: number) => {
    const { table: t, fields } = indexed.get(table)!;
    const fts = q(wordIndexName(t));
    const r = store.words.retry(() => store.sql.prepare(`SELECT snippet(${fts}, ${fields.indexOf(field)}, '[', ']', '…', 12) AS text FROM ${fts} WHERE ${q(field)} MATCH ? AND rowid = ?`)
      .get(any, recordId)) as { text: string } | undefined;
    return { field, text: r?.text ?? '' };
  };
  const source = (table: string, recordId: number) => store.words.retry(() =>
    store.sql.prepare(`SELECT * FROM ${q(table)} WHERE _fm_record_id = ?`).get(recordId)) as Record<string, unknown> | undefined;
  const out: RecordHit[] = [];
  for (const hit of list) {
    if (out.length >= limit) break;
    const { found: _, rows, ...h } = hit;
    const data = source(h.table, h.recordId) ?? {};
    const secrets = secretValues(data);
    // A field that holds a copy of a secret is no match: the hit stands only on its other fields.
    const shown = [...rows].filter(([field]) => !containsSecret(data[field], secrets));
    if (!shown.length) continue;
    const l = layout(h.table);
    const matches = shown.sort((x, y) => y[1] - x[1]).slice(0, 4).map(([field]) => snippet(h.table, field, h.recordId));
    out.push({ ...h, matches, score: relevance(hit), ...(l ? { layout: l } : {}) });
  }
  return {
    query: text,
    matchedAll,
    hits: out,
  };
}

/** The first layout (in layout order) on a table through which the account can read records. */
function layoutFor(store: Store, pv: Privileges | undefined): (table: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (table) => {
    if (!cache.has(table)) {
      const l = store.layouts().find((x) => !x.file && x.table === table && (!pv || pv.layout(x.name).layout !== 'none' && pv.layout(x.name).records !== 'none'));
      cache.set(table, l?.name);
    }
    return cache.get(table);
  };
}
