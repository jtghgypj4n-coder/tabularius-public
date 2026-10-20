// A signed copy of an audit chain's newest hash, for an operator to keep somewhere the server can't reach. The chains
// (security-chain.ts, record-chain.ts) prove the log is consistent with itself; someone who can rewrite the whole
// file can recompute every link. An anchor taken earlier and held elsewhere catches that: the log must still hold the
// same hash at the same position. The signature is an HMAC with a key only the operator has, so a copy of the anchor
// can't be forged or edited either.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { verifyRecordAudit } from './record-chain.ts';
import { verifySecurityAudit } from './security-chain.ts';

export type AuditChain = 'security' | 'records';

export interface AuditAnchor {
  version: 1;
  chain: AuditChain;
  /** Position in the chain, and the audit seq of the entry there; text keeps 64-bit ids exact. */
  chainSeq: string;
  auditSeq: string;
  hash: string;
  /** When the anchor was taken. */
  at: string;
  signature: string;
}

export type AnchorCheck =
  | { ok: true; status: 'matches' }
  | { ok: false; status: 'bad-signature' | 'log-broken' | 'missing' | 'mismatch' | 'older-than-log'; reason: string };

export const MIN_ANCHOR_KEY_BYTES = 16;

const sign = (key: Buffer, a: Omit<AuditAnchor, 'signature'>) =>
  createHmac('sha256', key).update(JSON.stringify(['openhbam/audit-anchor/v1', a.chain, a.chainSeq, a.auditSeq, a.hash, a.at]), 'utf8').digest('hex');

function checkKey(key: Buffer): void {
  if (key.length < MIN_ANCHOR_KEY_BYTES) throw new Error(`the signing key needs at least ${MIN_ANCHOR_KEY_BYTES} bytes`);
}

/** The chain's head as of now, signed. `null` when the chain has no head (not set up in this file). */
export function anchorHead(path: string, chain: AuditChain, key: Buffer, at = new Date().toISOString()): AuditAnchor | null {
  checkKey(key);
  const head = (chain === 'records' ? verifyRecordAudit(path) : verifySecurityAudit(path)).head;
  if (!head) return null;
  const body = { version: 1 as const, chain, chainSeq: String(head.chainSeq), auditSeq: String(head.auditSeq), hash: head.hash, at };
  return { ...body, signature: sign(key, body) };
}

/** Whether the log at `path` still holds what a signed anchor recorded: the same hash at the same position. */
export function checkAnchor(path: string, anchor: unknown, key: Buffer): AnchorCheck {
  checkKey(key);
  const a = anchor as Partial<AuditAnchor> | null;
  const text = (v: unknown) => typeof v === 'string' && v.length > 0;
  if (!a || a.version !== 1 || (a.chain !== 'security' && a.chain !== 'records') || ![a.chainSeq, a.auditSeq, a.hash, a.at, a.signature].every(text) || !/^\d+$/.test(a.chainSeq!)) {
    return { ok: false, status: 'bad-signature', reason: 'this is not an anchor written by audit verify --sign-key' };
  }
  const want = Buffer.from(sign(key, a as Omit<AuditAnchor, 'signature'>), 'hex');
  const got = Buffer.from(/^[0-9a-f]{64}$/.test(a.signature!) ? a.signature! : '', 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return { ok: false, status: 'bad-signature', reason: 'the signature does not match: a different key, or the anchor was changed' };
  }
  const now = a.chain === 'records' ? verifyRecordAudit(path) : verifySecurityAudit(path);
  if (!now.ok) return { ok: false, status: 'log-broken', reason: `the log fails its own check (${now.reason ?? now.status})` };
  const sql = new DatabaseSync(path, { readOnly: true });
  try {
    sql.exec('PRAGMA busy_timeout = 5000');
    const at = BigInt(a.chainSeq!);
    if (a.chain === 'records') {
      const state = sql.prepare('SELECT pruned_seq, pruned_hash FROM _fm_record_chain_state').get() as { pruned_seq: number; pruned_hash: string | null };
      if (at < BigInt(state.pruned_seq)) return { ok: false, status: 'older-than-log', reason: 'retention has removed the log up to past the anchor, so it can no longer be compared' };
      const stored = at === BigInt(state.pruned_seq) ? state.pruned_hash : (sql.prepare('SELECT rhash FROM _fm_audit WHERE rchain_seq = ?').get(Number(at)) as { rhash: string } | undefined)?.rhash;
      return compare(stored, a.hash!);
    }
    const row = sql.prepare('SELECT event_hash FROM _fm_audit WHERE chain_seq = ?').get(Number(at)) as { event_hash: unknown } | undefined;
    const stored = row && (row.event_hash instanceof Uint8Array ? Buffer.from(row.event_hash).toString('utf8') : String(row.event_hash));
    return compare(stored, a.hash!);
  } finally {
    sql.close();
  }
}

function compare(stored: string | null | undefined, hash: string): AnchorCheck {
  if (!stored) return { ok: false, status: 'missing', reason: 'the log has no entry at the anchored position: it is shorter than when the anchor was taken (truncated or rolled back)' };
  if (stored !== hash) return { ok: false, status: 'mismatch', reason: 'the entry at the anchored position is not the one the anchor recorded: the log was rewritten' };
  return { ok: true, status: 'matches' };
}
