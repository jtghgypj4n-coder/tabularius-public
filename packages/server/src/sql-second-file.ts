// SQL reaches the tables of a second hosted file (a user-interface file over a data file) with the account's
// privileges there. That file can also ask for the SQL extended privilege (fmxdbc) in its own sets (Store.sqlRequiresFmxdbc,
// off unless an administrator turned it on); both the HTTP SQL endpoint and the PostgreSQL port ask here.
import type { Privileges, Store } from '../../store/src/index.ts';

/** Why a query that runs in `target` for a connection to `connected` is refused for lack of the SQL privilege in `target`, if it is. */
export function secondFileSqlRefusal(p: Privileges, target: Store, connected: Store): string | undefined {
  if (target === connected || !target.sqlRequiresFmxdbc) return undefined;
  const there = p.in(target);
  return there.has('fmxdbc') ? undefined
    : `Insufficient privileges: SQL access needs the fmxdbc extended privilege in ${target.name}, and the "${there.name}" privilege set there doesn't have it`;
}
