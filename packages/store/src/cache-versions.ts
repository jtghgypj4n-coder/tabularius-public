import type { DatabaseSync } from 'node:sqlite';

/** Transactional metadata counters, independent of audit traffic and record writes.
 * Persistent triggers also cover imports and raw writes from other connections.
 */
export function ensureCacheVersions(sql: DatabaseSync): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS _fm_metadata_versions (
    id INTEGER PRIMARY KEY CHECK (id = 1), design INTEGER NOT NULL, privileges INTEGER NOT NULL);
    INSERT OR IGNORE INTO _fm_metadata_versions VALUES (1, 0, 0)`);
  for (const table of ['_fm_meta', '_fm_accounts', '_fm_privileges']) {
    if (!sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) continue;
    for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = op === 'DELETE' ? 'OLD' : 'NEW';
      const design = table === '_fm_meta';
      const keys = "('schema', 'designs', 'repeating')";
      const when = design ? `WHEN ${row}.key IN ${keys}${op === 'UPDATE' ? ` OR OLD.key IN ${keys}` : ''}` : '';
      sql.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_version_${op.toLowerCase()}
        AFTER ${op} ON ${table} ${when} BEGIN
          UPDATE _fm_metadata_versions SET ${design ? 'design = design + 1' : 'privileges = privileges + 1'} WHERE id = 1;
        END`);
    }
  }
}

/** Container ids can be reused after orphan cleanup; retain a content identity per id. */
export function ensureContainerVersions(sql: DatabaseSync): void {
  sql.exec('CREATE TABLE IF NOT EXISTS _fm_container_versions (id INTEGER PRIMARY KEY, token TEXT NOT NULL)');
  for (const table of ['_fm_containers', '_fm_container_chunks']) {
    for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = op === 'DELETE' ? 'OLD' : 'NEW';
      sql.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_identity_${op.toLowerCase()}
        AFTER ${op} ON ${table} BEGIN
          INSERT INTO _fm_container_versions VALUES (${row}.id, lower(hex(randomblob(16))))
            ON CONFLICT(id) DO UPDATE SET token = excluded.token;
        END`);
    }
  }
}
