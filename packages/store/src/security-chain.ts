// Per-file security history: hashes establish local consistency, not authenticity.
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

type Row = Record<string, unknown>;
const INCLUDED = 'security = 1 OR chain_seq IS NOT NULL OR prev_hash IS NOT NULL OR event_hash IS NOT NULL';
// Node 22's TEXT decoding can truncate at NUL or replace malformed UTF-8.
// CAST preserves the complete bytes; reject other storage classes rather than coerce them.
const storedText = (name: string) => `CASE WHEN typeof(${name}) IN ('text', 'null') THEN CAST(${name} AS BLOB) ELSE 0 END AS ${name}`;
const FIELDS = ['seq', storedText('at'), storedText('account'), storedText('kind'), storedText('tbl'),
  'record_id', storedText('changes'), 'security', 'agent'].join(', ');
const LINKS = ['chain_seq', storedText('prev_hash'), storedText('event_hash')].join(', ');
const STATE = ['id', 'version', storedText('chain_id'), storedText('created_at'), 'legacy_through', 'legacy_count',
  storedText('genesis_hash'), 'head_seq', 'head_audit_seq', storedText('head_hash')].join(', ');
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export interface SecurityAuditVerification {
  ok: boolean;
  status: 'consistent' | 'broken' | 'unprotected';
  /** First failing retained row, or expected head for a missing tail; decimal text keeps 64-bit ids exact. */
  firstBrokenSeq: string | null;
  reason: string | null;
  checked: number;
  legacyThroughSeq: string | null;
  head: { chainSeq: string; auditSeq: string; hash: string } | null;
}

function integers(st: StatementSync): StatementSync {
  st.setReadBigInts(true);
  return st;
}

function decimal(v: unknown): string {
  if (typeof v !== 'bigint' || v < 0n) throw new Error('invalid integer');
  return v.toString();
}

function text(v: unknown, nullable = false): string | null {
  if (nullable && v === null) return null;
  if (v instanceof Uint8Array) {
    try { return utf8.decode(v); } catch { throw new Error('invalid UTF-8 text'); }
  }
  if (typeof v !== 'string') throw new Error('invalid text');
  return v;
}

function flag(v: unknown): number {
  if (v !== 0n && v !== 1n) throw new Error('invalid flag');
  return Number(v);
}

function hash(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(v), 'utf8').digest('hex');
}

function hashText(v: unknown): string {
  const value = text(v);
  if (value === null || !/^[0-9a-f]{64}$/.test(value)) throw new Error('invalid hash');
  return value;
}

function genesis(state: Row): string {
  return hash(['openhbam/security-genesis/v1', text(state.chain_id), text(state.created_at),
    decimal(state.legacy_through), decimal(state.legacy_count)]);
}

/** Fixed arrays and decimal ids; stored text is strictly decoded from complete UTF-8 bytes, including NUL and BOM. */
export function securityEventHash(chainId: string, row: Row): string {
  // Valid v1 hashes stay compatible. History hashed through a lossy reader is
  // reported as broken, never silently rehashed to hide missing bytes.
  return hash(['openhbam/security-event/v1', chainId, decimal(row.chain_seq), hashText(row.prev_hash),
    decimal(row.seq), text(row.at), text(row.account, true), text(row.kind), text(row.tbl),
    row.record_id === null ? null : decimal(row.record_id), text(row.changes, true), flag(row.security), flag(row.agent)]);
}

export function securityWrite<T>(sql: DatabaseSync, run: () => T): T {
  const nested = sql.isTransaction;
  sql.exec(nested ? 'SAVEPOINT security_chain_write' : 'BEGIN IMMEDIATE');
  try {
    const out = run();
    sql.exec(nested ? 'RELEASE security_chain_write' : 'COMMIT');
    return out;
  } catch (e) {
    if (sql.isTransaction) sql.exec(nested ? 'ROLLBACK TO security_chain_write; RELEASE security_chain_write' : 'ROLLBACK');
    throw e;
  }
}

/** The migration and legacy baseline are published together under SQLite's writer lock. */
export function ensureSecurityChain(sql: DatabaseSync): void {
  securityWrite(sql, () => {
    if (sql.prepare('PRAGMA encoding').get()?.encoding !== 'UTF-8') throw new Error('unsupported security chain database encoding');
    const columns = sql.prepare('PRAGMA table_info(_fm_audit)').all() as { name: string }[];
    for (const [name, type] of [['chain_seq', 'INTEGER'], ['prev_hash', 'TEXT'], ['event_hash', 'TEXT']]) {
      if (!columns.some((c) => c.name === name)) sql.exec(`ALTER TABLE _fm_audit ADD COLUMN ${name} ${type}`);
    }
    sql.exec(`CREATE TABLE IF NOT EXISTS _fm_security_chain_state (id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL, chain_id TEXT NOT NULL, created_at TEXT NOT NULL,
      legacy_through INTEGER NOT NULL, legacy_count INTEGER NOT NULL, genesis_hash TEXT NOT NULL,
      head_seq INTEGER NOT NULL, head_audit_seq INTEGER NOT NULL, head_hash TEXT NOT NULL)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS _fm_security_audit_chain ON _fm_audit(seq) WHERE ${INCLUDED}`);
    if (sql.prepare('SELECT 1 FROM _fm_security_chain_state').get()) return;
    if (sql.prepare(`SELECT 1 FROM _fm_audit WHERE chain_seq IS NOT NULL OR prev_hash IS NOT NULL OR event_hash IS NOT NULL LIMIT 1`).get()) {
      throw new Error('security chain metadata is missing');
    }
    const boundary = integers(sql.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM _fm_audit')).get() as Row;
    const count = integers(sql.prepare('SELECT COUNT(*) AS n FROM _fm_audit WHERE security = 1')).get() as Row;
    const state: Row = { chain_id: randomUUID(), created_at: new Date().toISOString(), legacy_through: boundary.seq, legacy_count: count.n };
    let prev = genesis(state), position = 0n, auditSeq = 0n;
    const start = prev;
    const link = sql.prepare('UPDATE _fm_audit SET chain_seq = ?, prev_hash = ?, event_hash = ? WHERE seq = ?');
    // Old rows are a legacy baseline, hashed as stored without changing timestamps.
    // This protects their consistency from migration onward, not their earlier authenticity.
    for (const row of integers(sql.prepare(`SELECT ${FIELDS} FROM _fm_audit WHERE security = 1 ORDER BY seq`)).iterate() as Iterable<Row>) {
      row.chain_seq = ++position;
      row.prev_hash = prev;
      const next = securityEventHash(String(state.chain_id), row);
      link.run(position, prev, next, row.seq as bigint);
      prev = next;
      auditSeq = row.seq as bigint;
    }
    sql.prepare('INSERT INTO _fm_security_chain_state VALUES (1, 1, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(state.chain_id as string, state.created_at as string, boundary.seq as bigint, count.n as bigint, start, position, auditSeq, prev);
  });
}

/** Insert, link and head advance commit together, including inside a caller's transaction. */
export function appendSecurityEvent(sql: DatabaseSync, at: string, account: string | null, kind: string, changes: string | null, agent: number): void {
  securityWrite(sql, () => {
    // A nested savepoint may still be deferred: take the write lock before reading the head.
    // Stale snapshots fail here and propagate to the enclosing transaction; no partial retry.
    const locked = sql.prepare('UPDATE _fm_security_chain_state SET head_seq = head_seq WHERE id = 1').run();
    if (locked.changes !== 1) throw new Error('security chain metadata is missing');
    const state = integers(sql.prepare(`SELECT ${STATE} FROM _fm_security_chain_state WHERE id = 1`)).get() as Row;
    if (state.version !== 1n) throw new Error('unsupported security chain version');
    const inserted = integers(sql.prepare(`INSERT INTO _fm_audit (at, account, kind, tbl, record_id, changes, security, agent)
      VALUES (?, ?, ?, '', NULL, ?, 1, ?)`)).run(at, account, kind, changes, agent);
    const row = integers(sql.prepare(`SELECT ${FIELDS} FROM _fm_audit WHERE seq = ?`)).get(inserted.lastInsertRowid) as Row;
    row.chain_seq = BigInt(decimal(state.head_seq)) + 1n;
    row.prev_hash = hashText(state.head_hash);
    const next = securityEventHash(text(state.chain_id)!, row);
    sql.prepare('UPDATE _fm_audit SET chain_seq = ?, prev_hash = ?, event_hash = ? WHERE seq = ?')
      .run(row.chain_seq as bigint, row.prev_hash as string, next, row.seq as bigint);
    sql.prepare('UPDATE _fm_security_chain_state SET head_seq = ?, head_audit_seq = ?, head_hash = ? WHERE id = 1')
      .run(row.chain_seq as bigint, row.seq as bigint, next);
  });
}

/** A separate read-only snapshot, with no Store construction, migration, filtering or result cap. */
export function verifySecurityAudit(path: string): SecurityAuditVerification {
  const sql = new DatabaseSync(path, { readOnly: true });
  const result: SecurityAuditVerification = { ok: false, status: 'unprotected', firstBrokenSeq: null, reason: null,
    checked: 0, legacyThroughSeq: null, head: null };
  const broken = (seq: string | null, reason: string): SecurityAuditVerification => {
    result.status = 'broken';
    result.firstBrokenSeq = seq;
    result.reason = reason;
    return result;
  };
  try {
    sql.exec('PRAGMA busy_timeout = 5000; BEGIN');
    if (sql.prepare('PRAGMA encoding').get()?.encoding !== 'UTF-8') return broken(null, 'unsupported security chain database encoding');
    if (!sql.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_fm_security_chain_state'").get()) {
      result.reason = 'security chain is not initialized';
      return result;
    }
    const state = integers(sql.prepare(`SELECT ${STATE} FROM _fm_security_chain_state`)).all() as Row[];
    if (state.length !== 1 || state[0].id !== 1n) return broken(null, 'missing or invalid chain state');
    const s = state[0];
    if (s.version !== 1n) return broken(null, 'unsupported security chain version');
    result.legacyThroughSeq = decimal(s.legacy_through);
    result.head = { chainSeq: decimal(s.head_seq), auditSeq: decimal(s.head_audit_seq), hash: hashText(s.head_hash) };
    let prev = genesis(s), position = 0n, auditSeq = 0n, legacyCount = 0n;
    if (prev !== text(s.genesis_hash)) return broken(null, 'genesis hash mismatch');
    // Include linked rows whose security flag was altered, as well as unlinked security rows.
    const rows = integers(sql.prepare(`SELECT ${FIELDS}, ${LINKS} FROM _fm_audit
      WHERE ${INCLUDED} ORDER BY seq`));
    for (const row of rows.iterate() as Iterable<Row>) {
      const seq = decimal(row.seq);
      result.firstBrokenSeq = seq;
      if (row.security !== 1n) return broken(seq, 'linked row is not a security event');
      if (row.chain_seq !== position + 1n) return broken(seq, 'missing or out-of-order chain position');
      if (hashText(row.prev_hash) !== prev) return broken(seq, 'previous hash mismatch');
      if (securityEventHash(text(s.chain_id)!, row) !== hashText(row.event_hash)) return broken(seq, 'event hash mismatch');
      if ((row.seq as bigint) <= BigInt(result.legacyThroughSeq)) legacyCount++;
      prev = hashText(row.event_hash);
      position++;
      auditSeq = row.seq as bigint;
      result.checked++;
    }
    if (position !== s.head_seq || auditSeq !== s.head_audit_seq || prev !== hashText(s.head_hash)) {
      return broken(result.head.auditSeq, 'stored head mismatch (possible tail truncation)');
    }
    if (legacyCount !== s.legacy_count) return broken(null, 'legacy baseline count mismatch');
    // Tail deletion with a rewritten head, a fully recomputed history or an older valid
    // backup can pass: a local chain has no independently retained checkpoint.
    result.ok = true;
    result.status = 'consistent';
    result.firstBrokenSeq = null;
    return result;
  } catch (e) {
    return broken(result.firstBrokenSeq, (e as Error).message);
  } finally {
    if (sql.isTransaction) sql.exec('ROLLBACK');
    sql.close();
  }
}
