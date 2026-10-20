// Tamper evidence for the record audit log: every record change entry is linked to the one before it by a SHA-256
// hash, so an entry that is edited, deleted from the middle or added behind the log's back shows up when the chain is
// checked. Like the security events' chain (security-chain.ts), hashes establish that the log is consistent, not who
// wrote it: someone who can rewrite the whole file can recompute every link, so keep a copy of the head hash elsewhere
// when that matters. Entries from before the chain existed are not covered. Pruning old entries (retention) moves the
// chain's start to a recorded anchor, so what was dropped is visible, never a silent gap.

import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

type Row = Record<string, unknown>;

export interface RecordAuditVerification {
  ok: boolean;
  status: 'consistent' | 'broken' | 'unprotected';
  /** The first entry that fails, or the one a missing tail should have followed. */
  firstBrokenSeq: number | null;
  reason: string | null;
  /** Chained entries checked. */
  checked: number;
  /** Entries from before the chain started (not covered). */
  legacyThroughSeq: number | null;
  /** Newest entry's position, audit seq and hash: keep a copy elsewhere to detect a rewritten tail. */
  head: { chainSeq: number; auditSeq: number; hash: string } | null;
  /** Older entries removed by retention, and when. */
  pruned: { throughSeq: number; at: string } | null;
}

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v), 'utf8').digest('hex');
const COLUMNS = 'seq, at, account, kind, tbl, record_id, changes, agent, surface, script, copy_of, revert_of';

function genesis(chainId: string, createdAt: string, legacyThrough: number): string {
  return hash(['openhbam/record-genesis/v1', chainId, createdAt, legacyThrough]);
}

function entryHash(chainId: string, position: number, prev: string, r: Row): string {
  return hash(['openhbam/record-entry/v1', chainId, position, prev, r.seq, r.at, r.account ?? null, r.kind, r.tbl,
    r.record_id ?? null, r.changes ?? null, r.agent ?? 0, r.surface ?? null, r.script ?? null, r.copy_of ?? null, r.revert_of ?? null]);
}

/** Runs `run` as one unit: its own transaction, or a savepoint inside the caller's. */
function atomically<T>(sql: DatabaseSync, run: () => T): T {
  const nested = sql.isTransaction;
  sql.exec(nested ? 'SAVEPOINT record_chain_write' : 'BEGIN IMMEDIATE');
  try {
    const out = run();
    sql.exec(nested ? 'RELEASE record_chain_write' : 'COMMIT');
    return out;
  } catch (e) {
    if (sql.isTransaction) sql.exec(nested ? 'ROLLBACK TO record_chain_write; RELEASE record_chain_write' : 'ROLLBACK');
    throw e;
  }
}

/** Adds the chain's columns and state; entries already in the log are the uncovered baseline. */
export function ensureRecordChain(sql: DatabaseSync): void {
  atomically(sql, () => {
    const columns = sql.prepare('PRAGMA table_info(_fm_audit)').all() as { name: string }[];
    for (const [name, type] of [['rchain_seq', 'INTEGER'], ['rprev_hash', 'TEXT'], ['rhash', 'TEXT']]) {
      if (!columns.some((c) => c.name === name)) sql.exec(`ALTER TABLE _fm_audit ADD COLUMN ${name} ${type}`);
    }
    sql.exec(`CREATE TABLE IF NOT EXISTS _fm_record_chain_state (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL,
      chain_id TEXT NOT NULL, created_at TEXT NOT NULL, legacy_through INTEGER NOT NULL, genesis_hash TEXT NOT NULL,
      head_seq INTEGER NOT NULL, head_audit_seq INTEGER NOT NULL, head_hash TEXT NOT NULL,
      pruned_seq INTEGER NOT NULL DEFAULT 0, pruned_audit_seq INTEGER NOT NULL DEFAULT 0, pruned_hash TEXT, pruned_at TEXT)`);
    sql.exec('CREATE INDEX IF NOT EXISTS _fm_record_audit_chain ON _fm_audit(rchain_seq) WHERE rchain_seq IS NOT NULL');
    if (sql.prepare('SELECT 1 FROM _fm_record_chain_state').get()) return;
    const legacy = Number((sql.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM _fm_audit').get() as { n: number }).n);
    const chainId = randomUUID(), at = new Date().toISOString();
    const g = genesis(chainId, at, legacy);
    sql.prepare('INSERT INTO _fm_record_chain_state (id, version, chain_id, created_at, legacy_through, genesis_hash, head_seq, head_audit_seq, head_hash) VALUES (1, 1, ?, ?, ?, ?, 0, 0, ?)')
      .run(chainId, at, legacy, g, g);
  });
}

/** Links the record entry `seq` (just inserted) to the chain, in the same transaction as the entry. */
export function linkRecordEntry(sql: DatabaseSync, seq: number): void {
  atomically(sql, () => {
    // Take the write lock before reading the head, so two writers cannot both extend the same link.
    sql.prepare('UPDATE _fm_record_chain_state SET head_seq = head_seq WHERE id = 1').run();
    const s = sql.prepare('SELECT chain_id, head_seq, head_hash FROM _fm_record_chain_state WHERE id = 1').get() as { chain_id: string; head_seq: number; head_hash: string };
    const row = sql.prepare(`SELECT ${COLUMNS} FROM _fm_audit WHERE seq = ?`).get(seq) as Row;
    const position = Number(s.head_seq) + 1;
    const next = entryHash(s.chain_id, position, s.head_hash, row);
    sql.prepare('UPDATE _fm_audit SET rchain_seq = ?, rprev_hash = ?, rhash = ? WHERE seq = ?').run(position, s.head_hash, next, seq);
    sql.prepare('UPDATE _fm_record_chain_state SET head_seq = ?, head_audit_seq = ?, head_hash = ? WHERE id = 1').run(position, seq, next);
  });
}

/** Removes record entries up to audit `seq` (and none of the security events), recording where the chain now starts. Returns how many went. */
export function pruneRecordEntries(sql: DatabaseSync, throughSeq: number, now = new Date().toISOString()): number {
  return atomically(sql, () => {
    sql.prepare('UPDATE _fm_record_chain_state SET head_seq = head_seq WHERE id = 1').run();
    const last = sql.prepare('SELECT seq, rchain_seq, rhash FROM _fm_audit WHERE security = 0 AND rchain_seq IS NOT NULL AND seq <= ? ORDER BY rchain_seq DESC LIMIT 1').get(throughSeq) as { seq: number; rchain_seq: number; rhash: string } | undefined;
    const removed = sql.prepare('DELETE FROM _fm_audit WHERE security = 0 AND seq <= ?').run(throughSeq);
    if (last) {
      sql.prepare('UPDATE _fm_record_chain_state SET pruned_seq = ?, pruned_audit_seq = ?, pruned_hash = ?, pruned_at = ? WHERE id = 1').run(last.rchain_seq, last.seq, last.rhash, now);
    }
    return Number(removed.changes);
  });
}

/** A separate read-only snapshot of the file: checks every link from the chain's start (or its pruned anchor) to its head. */
export function verifyRecordAudit(path: string): RecordAuditVerification {
  const sql = new DatabaseSync(path, { readOnly: true });
  const result: RecordAuditVerification = { ok: false, status: 'unprotected', firstBrokenSeq: null, reason: null, checked: 0, legacyThroughSeq: null, head: null, pruned: null };
  const broken = (seq: number | null, reason: string): RecordAuditVerification => {
    result.status = 'broken';
    result.firstBrokenSeq = seq;
    result.reason = reason;
    return result;
  };
  try {
    sql.exec('PRAGMA busy_timeout = 5000; BEGIN');
    if (!sql.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_fm_record_chain_state'").get()) {
      result.reason = 'the record audit chain is not set up in this file';
      return result;
    }
    const s = sql.prepare('SELECT * FROM _fm_record_chain_state').all() as Row[];
    if (s.length !== 1 || s[0].version !== 1) return broken(null, 'missing or invalid chain state');
    const st = s[0];
    const chainId = String(st.chain_id);
    result.legacyThroughSeq = Number(st.legacy_through);
    result.head = { chainSeq: Number(st.head_seq), auditSeq: Number(st.head_audit_seq), hash: String(st.head_hash) };
    if (st.genesis_hash !== genesis(chainId, String(st.created_at), Number(st.legacy_through))) return broken(null, 'genesis hash mismatch');
    let position = Number(st.pruned_seq), prev = position > 0 ? String(st.pruned_hash) : String(st.genesis_hash);
    if (position > 0) result.pruned = { throughSeq: Number(st.pruned_audit_seq), at: String(st.pruned_at) };
    // An entry slipped in behind the chain's back: record changes after the chain began that were never linked.
    const loose = sql.prepare('SELECT seq FROM _fm_audit WHERE security = 0 AND rchain_seq IS NULL AND seq > ? ORDER BY seq LIMIT 1').get(Number(st.legacy_through)) as { seq: number } | undefined;
    if (loose) return broken(Number(loose.seq), 'a record change entry is not part of the chain');
    let auditSeq = Number(st.pruned_audit_seq);
    for (const row of sql.prepare(`SELECT ${COLUMNS}, rchain_seq, rprev_hash, rhash, security FROM _fm_audit WHERE rchain_seq IS NOT NULL ORDER BY rchain_seq`).iterate() as Iterable<Row>) {
      const seq = Number(row.seq);
      if (row.security !== 0) return broken(seq, 'a linked entry is not a record change');
      if (Number(row.rchain_seq) !== position + 1) return broken(seq, 'an entry is missing or out of order');
      if (row.rprev_hash !== prev) return broken(seq, 'previous hash mismatch');
      if (entryHash(chainId, position + 1, prev, row) !== row.rhash) return broken(seq, 'the entry was changed');
      prev = String(row.rhash);
      position++;
      auditSeq = seq;
      result.checked++;
    }
    if (position !== Number(st.head_seq) || auditSeq !== Number(st.head_audit_seq) || prev !== st.head_hash) {
      return broken(Number(st.head_audit_seq), 'the newest entries are missing (possible truncation)');
    }
    result.ok = true;
    result.status = 'consistent';
    return result;
  } catch (e) {
    return broken(result.firstBrokenSeq, (e as Error).message);
  } finally {
    if (sql.isTransaction) sql.exec('ROLLBACK');
    sql.close();
  }
}
