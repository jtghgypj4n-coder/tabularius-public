/**
 * A copy of a lookup keyed by names read from a file (a table called constructor or __proto__ is a legal one): no
 * prototype, so such a key is plain data, on reading it back from JSON and on assigning it.
 */
export function ownKeyed<T>(raw: Record<string, T> | null | undefined): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, raw ?? {});
}
