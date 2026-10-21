// The account's saved finds, saved sorts and recent records are kept on the server and shared by all its windows
// and browsers. Each window sends its whole list, so two windows that each added something would overwrite one
// another. Before sending, a window merges its list with what the server holds, three ways: what this window
// has now, what it last saw on the server (the base), and what the server holds now.

import type { SavedFind } from './finds.ts';

export type PrefName = 'finds' | 'sorts' | 'recent';
interface FindsPref { saved?: SavedFind[]; recent?: SavedFind[] }

/** How many recent finds and recent records are kept (the lists are cut to these in the client too). */
export const RECENT_FINDS = 10;
export const RECENT_RECORDS = 15;

/** Record text is not retained in navigation preferences, including entries from older clients. */
export function recentRecords(value: unknown): { layout: string; recordId: string; title: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r) => r && typeof r.layout === 'string' && typeof r.recordId === 'string' && /^\d+$/.test(r.recordId))
    .slice(0, RECENT_RECORDS).map(({ layout, recordId }) => ({ layout, recordId, title: `Record ${recordId}` }));
}

/**
 * This window's list, plus whatever another window added since the base (items the server has that neither the
 * base nor this list has). An item this window removed is in the base but not in mine, so it stays removed.
 */
export function mergeList<T>(server: readonly T[] | undefined, base: readonly T[] | undefined, mine: readonly T[], key: (item: T) => string): T[] {
  const mineKeys = new Set(mine.map(key));
  const baseKeys = new Set((base ?? []).map(key));
  const added = (server ?? []).filter((x) => !mineKeys.has(key(x)) && !baseKeys.has(key(x)));
  return [...mine, ...added];
}

const findKey = (f: SavedFind) => `${f.layout}\u0000${f.name}`;
const sortKey = (s: { layout: string; name: string }) => `${s.layout}\u0000${s.name}`;
const recentKey = (r: { layout: string; recordId: string }) => `${r.layout}\u0000${r.recordId}`;

const list = <T>(v: unknown): T[] | undefined => (Array.isArray(v) ? v as T[] : undefined);

/** The value to send for one pref: this window's, with what other windows added to the server's meanwhile. */
export function mergePrefs(name: PrefName, server: unknown, base: unknown, mine: unknown): unknown {
  if (name === 'finds') {
    const s = server as FindsPref | undefined, b = base as FindsPref | undefined, m = mine as FindsPref | undefined;
    return {
      saved: mergeList(list<SavedFind>(s?.saved), list<SavedFind>(b?.saved), list<SavedFind>(m?.saved) ?? [], findKey),
      // Recent finds are newest first and capped: another window's newer ones sit behind this window's.
      recent: mergeList(list<SavedFind>(s?.recent), list<SavedFind>(b?.recent), list<SavedFind>(m?.recent) ?? [], findKey).slice(0, RECENT_FINDS),
    };
  }
  if (name === 'sorts') return mergeList(list<{ layout: string; name: string }>(server), list<{ layout: string; name: string }>(base), list<{ layout: string; name: string }>(mine) ?? [], sortKey);
  return recentRecords(mergeList(recentRecords(server), recentRecords(base), recentRecords(mine), recentKey));
}
