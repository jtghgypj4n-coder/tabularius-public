// Password verification may be cached; account eligibility never is.
import type { Store } from '../../store/src/index.ts';

const tokens = new WeakMap<Map<string, number>, WeakMap<Store, string>>();

/** Evict cached passwords after any security change, also across workers. */
export function refreshAuthCache(store: Store, cache: Map<string, number>): void {
  let seen = tokens.get(cache);
  if (!seen) tokens.set(cache, seen = new WeakMap());
  const token = store.securityToken();
  if (seen.get(store) !== token) cache.clear();
  seen.set(store, token);
}
