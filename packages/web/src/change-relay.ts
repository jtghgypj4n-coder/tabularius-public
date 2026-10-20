// A person's other windows share one session, so the server calls every change they make "self" and the live
// stream never shows a window the edits made in its sibling. The window that makes a change tells its siblings
// over a BroadcastChannel instead; they treat it as someone else's change.

import type { Change } from './live.ts';

/** What a request changed, as far as another window needs to know. */
export interface Write {
  kind: 'update' | 'create' | 'delete' | 'reload';
  layout?: string;
  recordId?: string;
}

/** What one window tells the others after it changed something. */
export interface Relayed extends Write {
  token: string;
  file: string;
  table: string;
}

const RECORDS = /^\/fmi\/data\/vLatest\/databases\/[^/]+\/layouts\/([^/]+)\/records(?:\/([^/?]+))?(\/containers\/[^?]*)?(?:\?.*)?$/;
const APP = /^\/tabularius\/app\/v1\/databases\/[^/]+\/(?:layouts\/[^/]+\/(button|ai-replace|undo-import|revert|import)|runs\/[^/]+\/file)(?:\?(.*))?$/;
const UNDO = /^\/tabularius\/cleanup\/v1\/databases\/[^/]+\/history\/[^/]+\/undo$/;

/** The change a request makes to the file's data, if it makes one. Reads, previews and plans make none. */
export function classifyWrite(method: string, path: string): Write | undefined {
  if (method === 'GET') return undefined;
  const rec = RECORDS.exec(path);
  if (rec) {
    const layout = decodeURIComponent(rec[1]);
    const recordId = rec[2] === undefined ? undefined : decodeURIComponent(rec[2]);
    if (recordId === undefined) return method === 'POST' ? { kind: 'create', layout } : undefined;
    if (rec[3]) return { kind: 'update', layout, recordId };
    if (method === 'PATCH') return { kind: 'update', layout, recordId };
    if (method === 'DELETE') return { kind: 'delete', layout, recordId };
    return undefined;
  }
  if (method !== 'POST') return undefined;
  if (UNDO.test(path)) return { kind: 'reload' };
  const app = APP.exec(path);
  if (!app) return undefined;
  // An import's preview and plan only read; applying it (columns and skipDuplicates, or the older mapping) writes.
  if (app[1] === 'import' && !/(^|&)(skipDuplicates|mapping)=/.test(app[2] ?? '')) return undefined;
  return { kind: 'reload' };
}

/** What a window that hears of a sibling's change does with it: the same as for anyone else's. */
export function relayedChange(r: Relayed): Change {
  const kind = r.kind === 'update' || r.kind === 'create' || r.kind === 'delete' ? r.kind : 'truncate';
  return { kind, file: r.file, table: r.table, ...(r.recordId !== undefined ? { recordId: Number(r.recordId) } : {}), self: false };
}

/** Whether a BroadcastChannel message is a change relayed within this session. */
export function relayedFrom(data: unknown, token: string): Relayed | undefined {
  const m = data as Partial<Relayed> | null;
  if (!m || typeof m !== 'object' || m.token !== token || typeof m.file !== 'string' || typeof m.table !== 'string') return undefined;
  if (m.kind !== 'update' && m.kind !== 'create' && m.kind !== 'delete' && m.kind !== 'reload') return undefined;
  return m as Relayed;
}
