/** Shareable web-client screen state. Find criteria and record values never enter the address. */
export interface UrlState {
  db?: string;
  layout?: string;
  record?: string;
  mode?: 'browse' | 'find' | 'preview' | 'layout';
  view?: 'form' | 'list' | 'table';
  found?: number;
  total?: number;
  find?: boolean;
  dialog?: string;
}

const KEYS = ['db', 'layout', 'record', 'mode', 'view', 'found', 'total', 'find', 'dialog'] as const satisfies readonly (keyof UrlState)[];

const safeRecordId = (s: string | null): string | undefined => s && /^\d{1,20}$/.test(s) ? s : undefined;
const count = (s: string | null): number | undefined => s && /^\d{1,12}$/.test(s) ? Number(s) : undefined;

export function readUrlState(search: string): UrlState {
  const q = new URLSearchParams(search);
  const mode = q.get('mode');
  const view = q.get('view');
  const dialog = q.get('dialog');
  return {
    ...(q.get('db') ? { db: q.get('db')! } : {}),
    ...(q.get('layout') ? { layout: q.get('layout')! } : {}),
    ...(safeRecordId(q.get('record')) ? { record: safeRecordId(q.get('record'))! } : {}),
    ...(mode === 'browse' || mode === 'find' || mode === 'preview' || mode === 'layout' ? { mode } : {}),
    ...(view === 'form' || view === 'list' || view === 'table' ? { view } : {}),
    ...(count(q.get('found')) !== undefined ? { found: count(q.get('found')) } : {}),
    ...(count(q.get('total')) !== undefined ? { total: count(q.get('total')) } : {}),
    ...(q.get('find') === '1' ? { find: true } : {}),
    ...(dialog && /^[a-z][a-z0-9-]{0,39}$/i.test(dialog) ? { dialog } : {}),
  };
}

export function writeUrlState(pathname: string, currentSearch: string, hash: string, state: UrlState): string {
  const q = new URLSearchParams(currentSearch);
  // Keep unrelated entry points such as script links and modernize; state keys are replaced atomically.
  for (const key of KEYS) q.delete(key);
  for (const key of KEYS) {
    const value = state[key];
    if (value !== undefined && value !== false) q.set(key, value === true ? '1' : String(value));
  }
  return pathname + (q.size ? `?${q}` : '') + hash;
}

/** Whether a screen change adds a history entry: not while the file opens (the first Back must leave the app) and not while a script runs (it would flood the history). */
export function addsHistoryEntry(when: { push: boolean; ready: boolean; scripting: boolean }): boolean {
  return when.push && when.ready && !when.scripting;
}

/** Writes the address; where the browser refuses a new entry (its history limit), the current one is replaced so the address stays right. */
export function writeAddress(h: Pick<History, 'pushState' | 'replaceState'>, next: string, add: boolean): void {
  try {
    if (add) h.pushState(null, '', next);
    else h.replaceState(null, '', next);
  } catch {
    try { h.replaceState(null, '', next); } catch { /* the address stays as it was */ }
  }
}

/** The tab title from the person's pattern (`{file}`, `{layout}`, `{record}`); empty parts leave no stray dashes. */
export function pageTitle(pattern: string | null | undefined, parts: { file: string; layout?: string; record?: number }): string {
  const record = parts.record === undefined ? '' : `Record ${parts.record}`;
  const values = { file: parts.file, layout: parts.layout ?? '', record };
  const filled = (pattern ?? '{file} - {layout} - {record}')
    .replace(/\{(file|layout|record)\}/g, (_, key: 'file' | 'layout' | 'record') => values[key])
    .replace(/\s+-\s+-\s+/g, ' - ')
    .replace(/^\s*-\s*|\s*-\s*$/g, '');
  return filled || [parts.file, parts.layout, record].filter(Boolean).join(' - ');
}
