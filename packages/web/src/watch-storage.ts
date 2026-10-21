import { Api } from './api.ts';

export interface WatchSession { db: string; token: string }

/** Transport failures and unavailable endpoints do not revoke access. */
export function watchAccessDenied(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code, status } = error as Error & { code?: number; status?: number };
  return status === 401 || status === 403 || code === 9 || code === 952;
}

export function discardLegacyWatches(db: string): void {
  try {
    localStorage.removeItem(`tabularius.dataviewer.watch.${db}`);
    localStorage.removeItem(`tabularius.dataviewer.watch.${db}.tab`);
    sessionStorage.removeItem(`tabularius.debug.watch.${db}`);
  } catch { /* Storage may be unavailable. */ }
}

function watchKey(db: string, account: string): string {
  return `tabularius.dataviewer.watch.account.${JSON.stringify([db, account])}`;
}

export function clearWatches(db: string, account: string): void {
  discardLegacyWatches(db);
  try {
    localStorage.removeItem(watchKey(db, account));
    localStorage.removeItem(`${watchKey(db, account)}.tab`);
  } catch { /* Storage may be unavailable. */ }
}

/** Resolve the account without loading expressions; authorize before exposing the saved list. */
export async function openWatches(session: WatchSession, denied: (message: string) => void, authorize: () => Promise<unknown>): Promise<WatchStorage> {
  const { account } = await new Api(session.db, session.token).menu();
  if (!account) throw new Error('Unable to identify the signed-in account.');
  const storage = new WatchStorage(session, account, denied);
  try {
    if (!storage.active()) throw new Error('Your session changed.');
    await authorize();
  } catch (e) {
    if (storage.active() && watchAccessDenied(e)) storage.deny(e instanceof Error ? e.message : String(e));
    throw e;
  }
  if (!storage.active()) throw new Error('Your session changed. Open this tool again from the file.');
  return storage;
}

class WatchStorage {
  readonly key: string;
  private allowed = true;
  constructor(privateSession: WatchSession, account: string, denied: (message: string) => void) {
    this.session = privateSession;
    this.account = account;
    this.onDenied = denied;
    this.key = watchKey(privateSession.db, account);
  }
  private readonly session: WatchSession;
  private readonly account: string;
  private readonly onDenied: (message: string) => void;

  active(): boolean {
    if (!this.allowed) return false;
    try {
      const now = JSON.parse(sessionStorage.getItem('tabularius.session') ?? 'null') as WatchSession | null;
      if (now?.db === this.session.db && now.token === this.session.token) return true;
    } catch { /* No verifiable session. */ }
    this.deny('Your session changed. Open this tool again from the file.');
    return false;
  }

  deny(message: string): void {
    if (!this.allowed) return;
    this.allowed = false;
    clearWatches(this.session.db, this.account);
    this.onDenied(message);
  }

  get(): string[] {
    if (!this.active()) return [];
    try {
      const value: unknown = JSON.parse(localStorage.getItem(this.key) ?? '[]');
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    } catch { return []; }
  }

  set(value: string[]): void {
    if (!this.active()) return;
    try { localStorage.setItem(this.key, JSON.stringify(value)); } catch { /* Kept in memory. */ }
  }
}
