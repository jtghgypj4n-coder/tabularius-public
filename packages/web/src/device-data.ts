// What the web client leaves in this browser besides an offline copy (offline.ts), and when it goes. The records
// themselves are never stored here; what is: saved finds (their criteria are typed values), saved sorts and recent
// records, which live on the server with the account and are kept in this browser only for an offline copy to use,
// and the watch lists and session state of the tab. Signing out, a session ending and 30 days all remove them.

import { KEEP_DAYS } from './offline.ts';
import { clearWatches } from './watch-storage.ts';

const DAY_MS = 86_400_000;
/** The times the pref copies were last written, by key (JSON), so ones nobody signs out of still go after KEEP_DAYS. */
const STAMPS = 'tabularius.deviceKept';
const PREF_KEY = /^tabularius\.(?:finds|sorts|recent)\./;
export const PREF_NAMES = ['finds', 'sorts', 'recent'] as const;
export type PrefName = typeof PREF_NAMES[number];

/** Where a pref of one account in one file is kept in this browser. */
export const prefStorageKey = (name: PrefName | string, db: string, account: string): string => `tabularius.${name}.${db}.${account}`;

function stamps(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(STAMPS) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function saveStamps(map: Record<string, number>): void {
  try {
    if (Object.keys(map).length) localStorage.setItem(STAMPS, JSON.stringify(map));
    else localStorage.removeItem(STAMPS);
  } catch { /* Storage may be unavailable. */ }
}

/** Keeps a pref copy in this browser, noting when. */
export function keptSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    saveStamps({ ...stamps(), [key]: Date.now() });
  } catch { /* Storage may be unavailable or full: the pref stays on the server only. */ }
}

/** Removes a pref copy from this browser. */
export function keptRemove(key: string): void {
  try {
    localStorage.removeItem(key);
    const map = stamps();
    if (key in map) {
      delete map[key];
      saveStamps(map);
    }
  } catch { /* Storage may be unavailable. */ }
}

/**
 * Removes the pref copies not written for KEEP_DAYS. One an earlier version kept has no time and gets its days from
 * the first time it is seen here. Run when the client starts.
 */
export function purgeExpiredKept(): void {
  try {
    const now = Date.now();
    const map = stamps();
    const present: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && PREF_KEY.test(k)) present.push(k);
    }
    const next: Record<string, number> = {};
    for (const k of present) {
      const at = map[k];
      if (typeof at === 'number' && now - at > KEEP_DAYS * DAY_MS) localStorage.removeItem(k);
      else next[k] = typeof at === 'number' ? at : now;
    }
    saveStamps(next);
  } catch { /* Storage may be unavailable. */ }
}

/** The account's saved finds, sorts, recent records and watch lists. `keep` names prefs that never reached the server and that an offline copy holds, so they are not lost. */
export function forgetPrefs(db: string, account: string, keep: readonly string[] = []): void {
  for (const name of PREF_NAMES) if (!keep.includes(name)) keptRemove(prefStorageKey(name, db, account));
  clearWatches(db, account);
}

/** Everything this browser tab kept for the session: the layout, the window's place, the assistant's conversation. */
export function forgetTabState(): void {
  try {
    const mine: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith('tabularius.')) mine.push(k);
    }
    for (const k of mine) sessionStorage.removeItem(k);
  } catch { /* Storage may be unavailable. */ }
}

/**
 * Signing out, or a session ending: both of the above. Not removed: an offline copy (encrypted; it opens only with the
 * account's password), column widths and other screen settings, and the last file and account name typed at sign-in.
 */
export function forgetOnSignOut(db: string, account: string, keep: readonly string[] = []): void {
  forgetPrefs(db, account, keep);
  forgetTabState();
}
