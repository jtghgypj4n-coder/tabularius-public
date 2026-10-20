import { assertAiPolicy } from './ai-policy.ts';
// The MCP tool semantic_find: records ranked by how close their stored embedding is to a question's, as the script
// step Perform Semantic Find does (the vectors Insert Embedding put in a field). Everything it reads goes through the
// caller's privileges: the layout, the records the account may view, and the vector field itself.

import { cosineSimilarity, embeddingOf, text } from '../../calc/src/index.ts';
import { StoreError, type Privileges, type Store } from '../../store/src/index.ts';

/** Records scored at most, as a RAG space holds at most; a larger table says so rather than scanning on. */
export const SEMANTIC_MAX_RECORDS = 50_000;
/** Seconds a scan may take before it answers with what it has. */
export const SEMANTIC_SCAN_MS = 10_000;
/** The longest file read as a vector (8 bytes of header and 8 per number): 8,192 numbers. A larger file is not an embedding. */
const MAX_VECTOR_BYTES = 8 + 8 * 8192;
/** The longest question sent to the embedding model. */
export const SEMANTIC_MAX_TEXT = 8000;

export interface SemanticMatch {
  recordId: number;
  similarity: number;
}

export interface SemanticFindResult {
  layout: string;
  field: string;
  matches: SemanticMatch[];
  /** Records whose vector was compared. */
  scored: number;
  /** Records the account can view that hold no vector (an empty field, or text that is not one). */
  noEmbedding: number;
  /** Records with a vector of another length, which cannot be compared with this one. */
  differentLength: number;
  /** Set when the table or the time ran out before every record was looked at. */
  incomplete?: string;
}

/** What the tool needs of the server's AI: the embedding model, and the usage limits scripts are held to before every call. */
export interface SemanticAi {
  embed: (request: { file: string; account?: string; model: string; texts: string[]; signal?: AbortSignal }) => Promise<number[][]>;
  /** Why the file or account can't use AI now (a daily or monthly limit, the file's switch), or undefined. */
  refusal: (file: string, account?: string) => string | undefined;
}

const yieldToServer = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function semanticFind(store: Store, ai: SemanticAi, request: {
  layout: string; field: string; text: string; limit: number; threshold?: number; privileges?: Privileges; account?: string;
}): Promise<SemanticFindResult> {
  // Access first, so nothing about a layout or field the account can't see is told, and nothing is sent to the model for it.
  assertAiPolicy(store, request.privileges ?? request.account, 'semantic find');
  const info = store.layout(request.layout);
  const all = store.findIds(info, { ...(request.privileges ? { privileges: request.privileges } : {}) });
  if (info.owner !== store) throw new Error(`Layout ${request.layout} shows a table of ${info.owner.name}: search that database`);
  const seen = info.fields.filter((f) => request.privileges?.fieldAccess(info.table, f.name) !== 'none');
  const def = seen.find((f) => f.name.toLowerCase() === request.field.toLowerCase());
  if (!def) throw new StoreError(102, `Field "${request.field}" is missing. Fields of layout ${request.layout}: ${seen.map((f) => f.name).join(', ')}`);
  if (request.privileges?.fieldAccess(info.table, def.name) === 'masked') throw new StoreError(9, `Insufficient privileges: this account can't read ${def.name}`);
  if (def.type !== 'container' && def.type !== 'text') {
    throw new Error(`${def.name} is a ${def.type} field: semantic_find reads vectors from a container field (Insert Embedding's target) or a text field holding one`);
  }
  if (!request.text.trim()) throw new Error('Ask in words: the text is empty');
  if (request.text.length > SEMANTIC_MAX_TEXT) throw new Error(`The text is ${request.text.length} characters; ask in at most ${SEMANTIC_MAX_TEXT}`);

  // The usage limits scripts are held to, then the question: an unreachable model fails before any record is read.
  const refused = ai.refusal(store.name, request.account);
  if (refused) throw new StoreError(9, refused);
  const [query] = await ai.embed({ file: store.name, ...(request.account ? { account: request.account } : {}), model: '', texts: [request.text], signal: AbortSignal.timeout(60_000) });
  if (!query?.length || !query.every(Number.isFinite)) throw new Error('The embedding model gave no usable vector for this text');

  const ids = all.length > SEMANTIC_MAX_RECORDS ? all.slice(0, SEMANTIC_MAX_RECORDS) : all;
  const stop = performance.now() + SEMANTIC_SCAN_MS;
  const matches: SemanticMatch[] = [];
  let scored = 0, noEmbedding = 0, differentLength = 0, looked = 0;
  let incomplete = all.length > ids.length ? `Only the first ${SEMANTIC_MAX_RECORDS} of ${all.length} records were compared` : undefined;
  for (const id of ids) {
    if (performance.now() > stop) {
      incomplete = `Stopped after ${SEMANTIC_SCAN_MS / 1000} seconds with ${all.length - looked} of ${all.length} records not compared`;
      break;
    }
    // The scan is synchronous work: let the server answer others between batches.
    if (looked++ % 100 === 99) await yieldToServer();
    const vector = vectorOf(store, info, def.type, def.name, id, request.privileges);
    if (!vector) { noEmbedding++; continue; }
    const similarity = cosineSimilarity(query, vector);
    if (similarity === undefined || !Number.isFinite(similarity)) {
      if (vector.length !== query.length) differentLength++; else noEmbedding++;
      continue;
    }
    scored++;
    if (request.threshold === undefined || similarity >= request.threshold) matches.push({ recordId: id, similarity });
  }
  // Vectors made by another embedding model than this server's differ in length; say so rather than answer "no matches".
  if (!scored && differentLength) {
    throw new Error(`The vectors in ${def.name} have a different length than this server's embedding model gives (${query.length} numbers). Embed them again with the same model`);
  }
  matches.sort((a, b) => b.similarity - a.similarity);
  return {
    layout: request.layout, field: def.name,
    matches: matches.slice(0, request.limit).map((m) => ({ recordId: m.recordId, similarity: Math.round(m.similarity * 1e6) / 1e6 })),
    scored, noEmbedding, differentLength, ...(incomplete ? { incomplete } : {}),
  };
}

/** A record's vector, or undefined when it holds none: an empty field, text that isn't one, a number that isn't finite, a file too big to be one. */
function vectorOf(store: Store, info: ReturnType<Store['layout']>, type: string, field: string, id: number, privileges?: Privileges): number[] | undefined {
  let vector: number[] | undefined;
  if (type === 'container') {
    const cid = store.containerId(info, id, field);
    // The size first: a video or a document is not read whole to find out it isn't an embedding.
    const size = cid === undefined ? undefined : store.containerInfo(cid)?.size;
    if (cid === undefined || size === undefined || size < 16 || size > MAX_VECTOR_BYTES || (size - 8) % 8) return undefined;
    const file = store.container(cid);
    vector = file ? embeddingOf({ type: 'container', value: file.filename ?? '', data: file.data }) : undefined;
  } else {
    let value: unknown;
    try {
      value = store.get(info, id, 'iso', undefined, privileges, { summaries: false, layoutOnly: true, fields: [field] }).fieldData[field];
    } catch {
      return undefined; // deleted since the find
    }
    vector = typeof value === 'string' && value ? embeddingOf(text(value)) : undefined;
  }
  return vector?.every(Number.isFinite) ? vector : undefined;
}
