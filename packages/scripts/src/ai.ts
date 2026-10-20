import type { Script } from '../../fmp12/src/index.ts';
// FileMaker's AI script steps (Configure AI Account, Generate Response from Model, Insert Embedding,
// Perform Semantic Find, Perform Find and SQL Query by Natural Language) on Tabularius's own AI. Scripts never call a
// model themselves: the server hands the engine a ScriptAi only when it runs with --ai, and asks it
// for every file on the call stack before each call, so a file with AI turned off (or one the server
// keeps from AI) is refused. A capture-only file is refused here too, whatever the server says.
// Without a ScriptAi (test-scripts, the CLI, scripts run by AI apps) the steps stop with error 3 and
// say why. The account a script configures names Tabularius's AI, never the provider: the API key and
// endpoint in Configure AI Account are never read, as SMTP passwords never come from a file's steps.

/** One message of a conversation, as Generate Response from Model keeps it (role and text). */
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ScriptAi {
  /** Why this file's data can't go to AI, or undefined when it can. Called for every file on the call stack. */
  refusal(file: string, account?: string, scripts?: readonly Script[]): string | undefined;
  /**
   * A model's answer. `model` is what the script named (another provider's model, usually): the server
   * decides which model really answers. `system` is the step's instructions.
   */
  generate(request: { file: string; account?: string; model: string; system?: string; messages: AiMessage[]; signal?: AbortSignal }): Promise<string>;
  /** Embeddings for each text, when the server has an embedding model; without it the embedding steps stop. */
  embed?(request: { file: string; account?: string; model: string; texts: string[]; signal?: AbortSignal }): Promise<number[][]>;
  /** Embeddings for each image (Perform Semantic Find by image), when the server has an image embedding model. */
  embedImage?(request: { file: string; account?: string; model: string; images: { mime: string; data: Uint8Array }[]; signal?: AbortSignal }): Promise<number[][]>;
  /** Where Perform RAG Action keeps its spaces, when the server has one (without it the RAG steps stop). */
  rag?: RagBackend;
}

/**
 * RAG spaces: documents cut into chunks with their embeddings, searched by cosine similarity. A space belongs to
 * one file (two files using the same Space ID don't see each other's documents).
 */
export interface RagBackend {
  /** Adds a document; one of the same name in the space is replaced (and gets a new id). */
  add(request: { file: string; account?: string; space: string; name?: string; chunks: string[]; vectors: number[][]; model?: string }): string;
  /** The space's closest chunks to the vector, best first: at most `top`, none below `threshold`. */
  search(request: { file: string; account?: string; space: string; vector: number[]; top: number; threshold: number; query?: string; keywordWeight?: number }): { text: string; score: number; document: string }[];
  /** Removes the documents with these ids, or every document in the space; the number removed. */
  remove(request: { file: string; account?: string; space: string; ids?: string[] }): number;
  /** The file's spaces with the embedding model each was made with ('' when not known). */
  spaces(request: { file: string; account?: string }): { space: string; model: string }[];
  /** One space's documents (a file name, or the text added), or undefined when the file has no such space. */
  info(request: { file: string; account?: string; space: string }): { model: string; entries: { id: string; filename?: string; text?: string }[] } | undefined;
}

/** Text cut into pieces of about `tokens` tokens (four characters each), on word edges; JSONL goes line by line and a line past one piece is cut like other text. */
export function chunkText(input: string, tokens: number, jsonl = false): string[] {
  const limit = Math.max(1, tokens) * 4;
  if (jsonl) return input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).flatMap((l) => (l.length <= limit ? [l] : chunkText(l, tokens)));
  const out: string[] = [];
  let current = '';
  for (const word of input.split(/\s+/).filter(Boolean)) {
    // One word longer than a chunk is cut where the chunk ends, never between the two halves of a character.
    for (let w = word; w; ) {
      const room = limit - current.length - (current ? 1 : 0);
      if (w.length <= room) { current += (current ? ' ' : '') + w; break; }
      if (current) { out.push(current); current = ''; continue; }
      let end = limit;
      if (isHigh(w.charCodeAt(end - 1)) && isLow(w.charCodeAt(end))) end = end > 1 ? end - 1 : end + 1;
      out.push(w.slice(0, end));
      w = w.slice(end);
    }
  }
  if (current) out.push(current);
  return out;
}
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** What a script set up with Configure AI Account and Configure Prompt Template in this session. */
export interface AiSessionState {
  /** Account names (lower-cased) configured so far. */
  accounts: Set<string>;
  /** RAG account names (lower-cased) set up with Configure RAG Account; `ragConfigured` once any such step has run (a file's step may not show its name). */
  ragAccounts: Set<string>;
  ragConfigured: boolean;
  /** Prompt templates by name (lower-cased). */
  templates: Map<string, { sql?: string; naturalLanguage?: string }>;
}

/**
 * The instructions for Perform Find by Natural Language: the model sees the layout's field names and
 * types (never any record data) and answers with find requests as JSON.
 */
export function findPrompt(fields: { name: string; type: string }[], extra?: string): string {
  return 'You turn a request in plain words into FileMaker find requests. The layout has these fields:\n' +
    fields.map((f) => `- ${f.name} (${f.type})`).join('\n') +
    '\n\nAnswer with JSON only, no prose: {"requests":[{"criteria":{"<field>":"<FileMaker find criterion>"},"omit":false}],"sort":[{"fieldName":"<field>","sortOrder":"ascend"}]}. ' +
    'Use only the field names above, exactly as written. Criteria use FileMaker\'s find syntax: "=" for an exact match, ' +
    '"<", ">", "<=", ">=", "a...b" for ranges, "*" for any text, dates as M/D/YYYY. Several requests are OR; ' +
    'criteria within one request are AND; "omit": true leaves matching records out.' +
    (extra ? `\n\n${extra}` : '');
}

/** The find requests in a model's answer, keeping only fields the layout has (names matched without case). */
export function parseFindAnswer(answer: string, fields: string[]): {
  requests: { criteria: Record<string, string>; omit: boolean }[];
  sort: { fieldName: string; sortOrder: 'ascend' | 'descend' }[];
} {
  const json = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1);
  let parsed: { requests?: unknown };
  try {
    parsed = JSON.parse(json) as { requests?: unknown };
  } catch {
    return { requests: [], sort: [] };
  }
  const byName = new Map(fields.map((f) => [f.toLowerCase(), f]));
  const out: { criteria: Record<string, string>; omit: boolean }[] = [];
  for (const r of Array.isArray(parsed.requests) ? parsed.requests : []) {
    const c = (r as { criteria?: unknown })?.criteria;
    if (!c || typeof c !== 'object') continue;
    const criteria: Record<string, string> = {};
    for (const [k, v] of Object.entries(c)) {
      const name = byName.get(k.toLowerCase());
      if (name && (typeof v === 'string' || typeof v === 'number') && String(v) !== '') criteria[name] = String(v);
    }
    if (Object.keys(criteria).length) out.push({ criteria, omit: (r as { omit?: unknown }).omit === true });
  }
  const sort: { fieldName: string; sortOrder: 'ascend' | 'descend' }[] = [];
  const rawSort = (parsed as { sort?: unknown }).sort;
  for (const item of Array.isArray(rawSort) ? rawSort : []) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as { fieldName?: unknown; sortOrder?: unknown };
    if (typeof entry.fieldName !== 'string') continue;
    const fieldName = byName.get(entry.fieldName.toLowerCase());
    const sortOrder = typeof entry.sortOrder === 'string' ? entry.sortOrder.toLowerCase() : '';
    if (fieldName && (sortOrder === 'ascend' || sortOrder === 'descend')) sort.push({ fieldName, sortOrder });
  }
  return { requests: out, sort };
}

/** A conversation kept in a variable: a JSON array of {role, content}; anything else starts afresh. */
export function readMessages(text: string): AiMessage[] {
  if (!text.trim().startsWith('[')) return [];
  try {
    const list = JSON.parse(text) as unknown[];
    return list.flatMap((m) => {
      const x = m as { role?: unknown; content?: unknown };
      return (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string' ? [{ role: x.role, content: x.content }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * The instructions for Perform SQL Query by Natural Language: the model sees the tables as DDL (the ones the
 * account can see, never any record data) and answers with one SELECT for ExecuteSQL. A prompt template's SQL
 * prompt replaces them, with :schema: and :question: filled in.
 */
export function sqlPrompt(ddl: string, question: string, template?: string): string {
  if (template) return template.replace(/:schema:/g, () => ddl).replace(/:question:/g, () => question);
  return 'You answer questions about a FileMaker database by writing SQL for its ExecuteSQL function. The tables:\n\n' + ddl +
    '\n\nAnswer with one SELECT statement only, in a ```sql block, no prose. Use only the tables and fields above, ' +
    'with names in double quotes. ExecuteSQL reads data only: no INSERT, UPDATE, DELETE or schema changes. ' +
    'If these tables can\'t answer the question, answer NO_SQL: and one sentence saying why.';
}

/** The instructions for answering in plain words from a query's results (Action: Query); a template's natural-language prompt replaces them. */
export function sqlAnswerPrompt(question: string, sql: string, results: string, template?: string): string {
  if (template) return template.replace(/:question:/g, () => question).replace(/:sql_query:/g, () => sql).replace(/:sql_results:/g, () => results);
  return 'Answer the question in plain words from the result of this SQL query. Use only what the result shows; if it ' +
    `doesn't answer the question, say so.\n\nSQL:\n${sql}\n\nResult (fields separated by tabs, one record per line):\n${results || '(no records)'}`;
}

/** The SQL in a model's answer (a fenced block, or the answer itself), or why there is none. */
export function parseSqlAnswer(answer: string): { sql: string } | { none: string } {
  const none = /^\s*NO_SQL\s*:\s*([\s\S]*)$/i.exec(answer);
  if (none) return { none: none[1].trim() || 'Nothing in these tables answers that.' };
  const fenced = /```(?:sql)?\s*\n?([\s\S]*?)```/i.exec(answer);
  const sql = (fenced ? fenced[1] : answer).trim().replace(/;\s*$/, '');
  if (!/^(?:SELECT|WITH)\b/i.test(sql)) return { none: answer.trim() || 'Nothing in these tables answers that.' };
  return { sql };
}
