/**
 * A copy of a lookup keyed by names read from a file (a table called constructor or __proto__ is a legal one): no
 * prototype, so such a key is plain data, on reading it back from JSON and on assigning it.
 */
export function ownKeyed<T>(raw: Record<string, T> | null | undefined): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, raw ?? {});
}

/**
 * The per-table lists of field names read from a file's metadata (the repeating fields): keyed without a prototype,
 * keeping only the entries that are lists, and in them only the names, so a damaged row reads as no list instead of
 * a number or text that is then used as one.
 */
export function nameLists(raw: unknown): Record<string, string[]> {
  const out = Object.create(null) as Record<string, string[]>;
  if (!raw || typeof raw !== 'object') return out;
  for (const [table, list] of Object.entries(raw)) {
    if (Array.isArray(list)) out[table] = list.filter((name): name is string => typeof name === 'string');
  }
  return out;
}
