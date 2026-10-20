// Records shown with values the server was still working out ("updating")
// are fetched again a page at a time: these are the pages that hold them.

/** The first index of each page (of `size` records) of the found set that holds one of `ids`. */
export function pagesHolding(cache: ReadonlyMap<number, { recordId: string }>, ids: Iterable<string>, size: number): Set<number> {
  const wanted = new Set(ids);
  const out = new Set<number>();
  for (const [at, r] of cache) if (wanted.has(r.recordId)) out.add(at - (at % size));
  return out;
}

/** The record ids at each index of the page from `start`, to tell whether fetching it again moved records about. */
export function idsAt(cache: ReadonlyMap<number, { recordId: string }>, start: number, size: number): (string | undefined)[] {
  return Array.from({ length: size }, (_, i) => cache.get(start + i)?.recordId);
}
