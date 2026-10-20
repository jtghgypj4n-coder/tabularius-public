// RAG spaces for Perform RAG Action: documents cut into chunks with their embeddings, kept in one small SQLite
// file in the server's folder (shared by every worker process) and searched by cosine similarity. A space belongs
// to the file whose script made it. There is no index: a search compares the query with every chunk of the space,
// which is fast up to tens of thousands of chunks and is why a space is capped. The vectors of a space that is
// searched are kept in memory (up to CACHE_BYTES in all, dropped when anything changes the file), so a search is
// a pass over one array instead of a read of every row.

import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { RagBackend } from '../../scripts/src/ai.ts';

export const RAG_DB = '.openhbam-rag.sqlite';
/** Chunks one space may hold (about 200 tokens each). Past this a search would be slow without an index. */
export const RAG_CHUNK_LIMIT = 50_000;

/** Memory the searched spaces' vectors may take in all, per process; a space too big for it is read from disk each time. */
const CACHE_BYTES = 256 * 1024 * 1024;

interface Cached {
  version: string;
  dims: number;
  /** Which chunk each row of `matrix` is, and its length (norm). */
  refs: { doc: string; n: number }[];
  matrix: Float32Array;
  norms: Float32Array;
}

const toBlob = (v: number[]) => new Uint8Array(new Float32Array(v).buffer);

export class RagStore implements RagBackend {
  private readonly db: DatabaseSync;
  /** Bumped by this process's own changes; other processes' changes show in the file's data_version. */
  private changes = 0;
  private readonly cache = new Map<string, Cached>();
  private cached = 0;

  constructor(dir: string) {
    const path = join(dir, RAG_DB);
    this.db = new DatabaseSync(path);
    try { chmodSync(path, 0o600); } catch { /* not every filesystem has modes */ }
    this.db.exec('PRAGMA busy_timeout = 5000');
    try { this.db.exec('PRAGMA journal_mode = WAL'); } catch { /* another worker holds it */ }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, file TEXT NOT NULL, space TEXT NOT NULL, name TEXT, added TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS docs_space ON docs (file, space);
      CREATE TABLE IF NOT EXISTS chunks (doc TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE, n INTEGER NOT NULL, text TEXT NOT NULL, dims INTEGER NOT NULL, vec BLOB NOT NULL, norm REAL NOT NULL, PRIMARY KEY (doc, n));
    `);
    // The model a document was embedded with (spaces made before this was kept have none).
    try { this.db.exec('ALTER TABLE docs ADD COLUMN model TEXT'); } catch { /* already there */ }
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  spaces({ file }: { file: string }): { space: string; model: string }[] {
    const rows = this.db.prepare('SELECT space, MAX(model) AS model FROM docs WHERE file = ? GROUP BY space ORDER BY MIN(added), space LIMIT 1000').all(file) as { space: string; model: string | null }[];
    return rows.map((r) => ({ space: r.space, model: r.model ?? '' }));
  }

  info({ file, space }: { file: string; space: string }): { model: string; entries: { id: string; filename?: string; text?: string }[] } | undefined {
    const docs = this.db.prepare('SELECT id, name, model FROM docs WHERE file = ? AND space = ? ORDER BY added, rowid LIMIT 1000').all(file, space) as { id: string; name: string | null; model: string | null }[];
    if (!docs.length) return undefined;
    const chunks = this.db.prepare('SELECT text FROM chunks WHERE doc = ? ORDER BY n LIMIT 5');
    return {
      model: docs.map((d) => d.model).find(Boolean) ?? '',
      entries: docs.map((d) => d.name ? { id: d.id, filename: d.name } : { id: d.id, text: (chunks.all(d.id) as { text: string }[]).map((c) => c.text).join(' ').slice(0, 1000) }),
    };
  }

  add({ file, space, name, chunks, vectors, model }: { file: string; space: string; name?: string; chunks: string[]; vectors: number[][]; model?: string }): string {
    if (chunks.length !== vectors.length) throw new Error('every chunk needs a vector');
    // Nothing to keep: no empty document, and a named document already there is left alone.
    if (!chunks.length) throw new Error('there is no text to add');
    const id = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (name) {
        // The same file name in the space replaces the old document.
        this.db.prepare('DELETE FROM docs WHERE file = ? AND space = ? AND name = ?').run(file, space, name);
      }
      const dims = vectors[0]?.length;
      if (dims) {
        const { others } = this.sizes(file, space, dims);
        if (others.length) throw RagStore.otherModel(space, others, dims);
      }
      const held = (this.db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE doc IN (SELECT id FROM docs WHERE file = ? AND space = ?)').get(file, space) as { n: number }).n;
      if (held + chunks.length > RAG_CHUNK_LIMIT) throw new Error(`the space would hold more than ${RAG_CHUNK_LIMIT} chunks (this server searches spaces without an index); remove documents first`);
      this.db.prepare('INSERT INTO docs (id, file, space, name, added, model) VALUES (?, ?, ?, ?, ?, ?)').run(id, file, space, name ?? null, new Date().toISOString(), model ?? null);
      const insert = this.db.prepare('INSERT INTO chunks (doc, n, text, dims, vec, norm) VALUES (?, ?, ?, ?, ?, ?)');
      chunks.forEach((text, n) => {
        const v = vectors[n];
        insert.run(id, n, text, v.length, toBlob(v), Math.sqrt(v.reduce((s, x) => s + x * x, 0)));
      });
      this.db.exec('COMMIT');
      this.changes++;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return id;
  }

  /** Vector sizes in a space other than `dims`, and how many chunks have `dims`: a space made with another embedding model can't be searched or added to. */
  private sizes(file: string, space: string, dims: number): { others: number[]; same: number } {
    const rows = this.db.prepare(
      'SELECT c.dims AS dims, COUNT(*) AS n FROM chunks c JOIN docs d ON d.id = c.doc WHERE d.file = ? AND d.space = ? GROUP BY c.dims',
    ).all(file, space) as { dims: number; n: number }[];
    return { others: rows.filter((r) => r.dims !== dims).map((r) => r.dims), same: rows.find((r) => r.dims === dims)?.n ?? 0 };
  }

  private static otherModel(space: string, others: number[], dims: number): Error {
    return new Error(`space "${space}" holds ${others.join(' and ')}-number vectors from another embedding model, and the model now gives ${dims}: remove its data (Remove Data without an id) and add it again`);
  }

  search(request: { file: string; space: string; vector: number[]; top: number; threshold: number; query?: string; keywordWeight?: number }): { text: string; score: number; document: string }[] {
    const weight = request.query && request.keywordWeight ? Math.max(0, Math.min(1, request.keywordWeight)) : 0;
    const found = weight > 0 ? this.hybridSearch(request, request.query!, weight) : this.searchSpace(request);
    if (!found.length && request.vector.length) {
      const { others, same } = this.sizes(request.file, request.space, request.vector.length);
      if (others.length && !same) throw RagStore.otherModel(request.space, others, request.vector.length);
    }
    return found;
  }

  /**
   * Vector similarity blended with how many of the query's words a chunk holds: the closest chunks by vector, plus chunks
   * holding a rare query word (an id, a part number, a name) however far their vector is. The score is
   * (1 - weight) x cosine + weight x the share of the query's words found, rarer words counting more.
   */
  private hybridSearch(request: { file: string; space: string; vector: number[]; top: number; threshold: number }, query: string, weight: number): { text: string; score: number; document: string }[] {
    const { file, space, vector, top, threshold } = request;
    const qNorm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0));
    if (!qNorm || !(top >= 1)) return [];
    const terms = queryTerms(query);
    const key = (doc: string, text: string) => `${doc}\u0000${text}`;
    const pool = new Map<string, { text: string; document: string; cosine: number }>();
    for (const r of this.searchSpace({ file, space, vector, top: Math.max(top * 10, 50), threshold: -1 })) pool.set(key(r.document, r.text), { text: r.text, document: r.document, cosine: r.score });
    const hits = this.db.prepare(
      'SELECT c.doc AS doc, c.text AS text, c.dims AS dims, c.vec AS vec, c.norm AS norm FROM chunks c JOIN docs d ON d.id = c.doc WHERE d.file = ? AND d.space = ? AND c.dims = ? AND instr(lower(c.text), ?) > 0 LIMIT 50',
    );
    // SQLite's lower() folds ASCII only, while the terms are folded by JavaScript: a term with other letters ("müller")
    // is looked for in JavaScript, in the same folding, so "MÜLLER" in a chunk is found.
    const scan = this.db.prepare(
      'SELECT c.doc AS doc, c.text AS text, c.dims AS dims, c.vec AS vec, c.norm AS norm FROM chunks c JOIN docs d ON d.id = c.doc WHERE d.file = ? AND d.space = ? AND c.dims = ?',
    );
    type Row = { doc: string; text: string; dims: number; vec: Uint8Array; norm: number };
    const candidates = (term: string): Row[] => {
      if (!/[^\u0000-\u007f]/.test(term)) return hits.all(file, space, vector.length, term) as Row[];
      const found: Row[] = [];
      for (const r of scan.iterate(file, space, vector.length) as Iterable<Row>) {
        if (r.text.toLowerCase().includes(term)) found.push(r);
        if (found.length >= 50) break;
      }
      return found;
    };
    for (const term of terms) {
      for (const r of candidates(term)) {
        const k = key(r.doc, r.text);
        if (pool.has(k) || !r.norm) continue;
        const v = new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength));
        let dot = 0;
        for (let i = 0; i < v.length; i++) dot += v[i] * vector[i];
        pool.set(k, { text: r.text, document: r.doc, cosine: dot / (r.norm * qNorm) });
      }
    }
    // A word held by few of the candidates says more than one held by all of them.
    const lower = [...pool.values()].map((c) => c.text.toLowerCase());
    const idf = terms.map((t) => {
      const df = lower.filter((x) => x.includes(t)).length;
      return df ? Math.log(1 + pool.size / df) : 0;
    });
    const total = idf.reduce((s, x) => s + x, 0);
    const scored = [...pool.values()].map((c, i) => {
      const found = terms.reduce((s, t, j) => s + (lower[i].includes(t) ? idf[j] : 0), 0);
      return { text: c.text, document: c.document, score: (1 - weight) * c.cosine + weight * (total ? found / total : 0) };
    });
    return scored.filter((c) => c.score >= threshold).sort((a, b) => b.score - a.score).slice(0, top);
  }

  private searchSpace({ file, space, vector, top, threshold }: { file: string; space: string; vector: number[]; top: number; threshold: number }): { text: string; score: number; document: string }[] {
    if (!(top >= 1)) return [];
    const qNorm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0));
    if (!qNorm) return [];
    const entry = this.load(file, space, vector.length);
    if (entry) return this.searchCached(entry, vector, qNorm, top, threshold);
    const rows = this.db.prepare(
      'SELECT c.doc AS doc, c.text AS text, c.dims AS dims, c.vec AS vec, c.norm AS norm FROM chunks c JOIN docs d ON d.id = c.doc WHERE d.file = ? AND d.space = ?',
    ).iterate(file, space) as Iterable<{ doc: string; text: string; dims: number; vec: Uint8Array; norm: number }>;
    const best: { text: string; score: number; document: string }[] = [];
    for (const r of rows) {
      // A vector of another size (a changed embedding model) can't be compared.
      if (r.dims !== vector.length || !r.norm) continue;
      const v = new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength));
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i] * vector[i];
      const score = dot / (r.norm * qNorm);
      if (score < threshold) continue;
      if (best.length < top || score > best[best.length - 1].score) {
        best.push({ text: r.text, score, document: r.doc });
        best.sort((a, b) => b.score - a.score);
        if (best.length > top) best.pop();
      }
    }
    return best;
  }

  private version(): string {
    const row = this.db.prepare('PRAGMA data_version').get() as { data_version: number };
    return `${this.changes}:${row.data_version}`;
  }

  /** The space's vectors of this size in memory, read again when the file has changed; undefined when they would not fit. */
  private load(file: string, space: string, dims: number): Cached | undefined {
    const key = `${file}\u0000${space}\u0000${dims}`;
    const version = this.version();
    const have = this.cache.get(key);
    if (have?.version === version) {
      // Most recently used last.
      this.cache.delete(key);
      this.cache.set(key, have);
      return have;
    }
    if (have) this.drop(key);
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM chunks c JOIN docs d ON d.id = c.doc WHERE d.file = ? AND d.space = ? AND c.dims = ?').get(file, space, dims) as { n: number }).n;
    const bytes = count * (dims + 1) * 4;
    if (!count || bytes > CACHE_BYTES) return undefined;
    while (this.cached + bytes > CACHE_BYTES && this.cache.size) this.drop(this.cache.keys().next().value!);
    const matrix = new Float32Array(count * dims);
    const norms = new Float32Array(count);
    const refs: { doc: string; n: number }[] = [];
    const rows = this.db.prepare(
      'SELECT c.doc AS doc, c.n AS n, c.vec AS vec, c.norm AS norm FROM chunks c JOIN docs d ON d.id = c.doc WHERE d.file = ? AND d.space = ? AND c.dims = ?',
    ).iterate(file, space, dims) as Iterable<{ doc: string; n: number; vec: Uint8Array; norm: number }>;
    for (const r of rows) {
      if (refs.length >= count) break;
      matrix.set(new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength)), refs.length * dims);
      norms[refs.length] = r.norm;
      refs.push({ doc: r.doc, n: r.n });
    }
    const entry: Cached = { version, dims, refs, matrix, norms };
    this.cache.set(key, entry);
    this.cached += bytes;
    return entry;
  }

  private drop(key: string): void {
    const e = this.cache.get(key);
    if (!e) return;
    this.cached -= e.refs.length * (e.dims + 1) * 4;
    this.cache.delete(key);
  }

  private searchCached(e: Cached, vector: number[], qNorm: number, top: number, threshold: number): { text: string; score: number; document: string }[] {
    const q = Float32Array.from(vector);
    const best: { i: number; score: number }[] = [];
    for (let i = 0; i < e.refs.length; i++) {
      if (!e.norms[i]) continue;
      const base = i * e.dims;
      let dot = 0;
      for (let k = 0; k < e.dims; k++) dot += e.matrix[base + k] * q[k];
      const score = dot / (e.norms[i] * qNorm);
      if (score < threshold) continue;
      if (best.length < top || score > best[best.length - 1].score) {
        best.push({ i, score });
        best.sort((a, b) => b.score - a.score);
        if (best.length > top) best.pop();
      }
    }
    // Only the winners' text is read.
    const text = this.db.prepare('SELECT text FROM chunks WHERE doc = ? AND n = ?');
    return best.map(({ i, score }) => ({ text: (text.get(e.refs[i].doc, e.refs[i].n) as { text: string }).text, score, document: e.refs[i].doc }));
  }

  remove({ file, space, ids }: { file: string; space: string; ids?: string[] }): number {
    this.changes++;
    if (!ids) return Number(this.db.prepare('DELETE FROM docs WHERE file = ? AND space = ?').run(file, space).changes);
    let n = 0;
    const del = this.db.prepare('DELETE FROM docs WHERE file = ? AND space = ? AND id = ?');
    for (const id of ids) n += Number(del.run(file, space, id).changes);
    return n;
  }

  close(): void {
    this.cache.clear();
    this.db.close();
  }
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'was', 'were', 'what', 'which', 'who', 'whom', 'how', 'why', 'when', 'where', 'does', 'did', 'has', 'have', 'had', 'with', 'from', 'that', 'this', 'these', 'those', 'about', 'into', 'than', 'then', 'can', 'could', 'should', 'would', 'will', 'you', 'your', 'our', 'not', 'but', 'any', 'all']);

/** The words of a question worth looking for in text: lower case, three characters or more, no filler words, at most eight. */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= 3 && !STOP_WORDS.has(w)))].slice(0, 8);
}
