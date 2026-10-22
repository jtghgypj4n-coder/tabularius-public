import { createHash } from 'node:crypto';
import { addressBucket, canonicalIP } from './client-ip.ts';
export { addressBucket } from './client-ip.ts';

/** Failed sign-in limits. Change them before serving to tune them. */
export const LOCKOUT = {
  attempts: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000, addressAttempts: 30,
  maxFailures: 40_000, sharedFailures: 1_000, directoryAccounts: 4_096, addressLocks: 6,
};

/** The first failed sign-in rows in a file's security audit are always written, however few other rows it holds. */
export const SIGN_IN_FAILURE_AUDIT_FLOOR = 1000;
/**
 * The most of a file's security audit that failed sign-in rows may be, once past the floor:
 * TABULARIUS_SIGN_IN_FAILURE_AUDIT_SHARE, a plain decimal number from 0 to 1 (1 for no limit), 0.8 when it is not set. Anything
 * else (hex, an exponent, a sign, text, a number outside the range) keeps the limit rather than lifting it. Lockout rows are not
 * held to it.
 */
export function signInFailureAuditShare(): number {
  const text = process.env.TABULARIUS_SIGN_IN_FAILURE_AUDIT_SHARE?.trim();
  if (!text) return 0.8;
  return /^(?:0(?:\.\d+)?|\.\d+|1(?:\.0+)?)$/.test(text) ? Number(text) : 0.8;
}
const LOCAL = new Set(['', 'mcp', '127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const NO_ADDRESS_BUDGET = new Set([...LOCAL, 'unknown']);
/** One spelling per address: `::ffff:7f00:1`, `0:0:0:0:0:0:0:1` and a scope suffix name the same place as their short forms. */
const spelling = (from: string) => canonicalIP(from.split('%')[0]) ?? from;
/** True for this computer and for visitors who can't be told apart: they have no shared address budget. */
export const noAddressBudget = (from: string) => NO_ADDRESS_BUDGET.has(spelling(from));
export const sharedSource = (from: string) => noAddressBudget(from) && !LOCAL.has(spelling(from));

/** Elapsed time only: a wall-clock edit must neither shorten a lockout nor refill an attempt budget. */
const elapsed = () => performance.now();

type Failure = { count: number; first: number; until?: number; shared?: boolean; knownAccount?: boolean; network?: string; address?: string };

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/**
 * What a directory's name matching (RFC 4518) maps to nothing: control and format characters (soft hyphen, zero-width and
 * direction marks, joiners, the byte order mark, tag characters), the combining grapheme joiner, Mongolian soft hyphen,
 * variation selectors and the object replacement character.
 */
const MAPPED_TO_NOTHING = /[\p{Cf}\u034F\u1806\u180B-\u180D\uFE00-\uFE0F\uFFFC\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F]/gu;
/** Space and the ignorable characters at the start of a name: dropped before the name is cut, so padding cannot push the name out. */
const LEADING_BLANK = /^[\s\p{Cf}\u034F\u1806\u180B-\u180D\uFE00-\uFE0F\uFFFC\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F]+/u;

/**
 * The name a lockout counts failures under. A directory (LDAP) may take names that are written differently as one
 * person (RFC 4518 matching folds case, compatibility forms such as full-width letters, accents written either way and
 * stray spaces), and the name is typed by whoever is guessing, so every such spelling counts in one bucket. It is wider
 * than the account lookup on purpose. Never empty for a name that was typed: a name of nothing but ignorable characters
 * is one bucket of its own, so it cannot stand for every bucket.
 */
export function lockoutName(name: string): string {
  const folded = name.replace(LEADING_BLANK, '').slice(0, 4096).replace(LONE_SURROGATE, '\uFFFD').normalize('NFKC').replace(MAPPED_TO_NOTHING, '')
    .toLowerCase().toUpperCase().toLowerCase().normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return folded || '\uFFFD';
}

/** Groups of two or more account names that count their failed sign-ins in one lockout bucket (a pair written before they were refused). */
export function accountsSharingLockout(names: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const n of names) groups.set(lockoutName(n), [...(groups.get(lockoutName(n)) ?? []), n]);
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort());
}

/** Shared hosted/unhosted accounting. Capacity never evicts live locks or open address budgets. */
export class SignInFailures extends Map<string, Failure> {
  private nextExpiry = Infinity;
  private windowMs = LOCKOUT.windowMs;
  private readonly onLock?: (key: string, address?: string) => void;
  private readonly onExpire?: (key: string, endedAt: number) => void;
  private readonly sharedKeys = new Set<string>();
  // Real accounts have at most three anonymous counters (password, TOTP, recovery).
  // Only Store can identify these: attacker-chosen names cannot spend this reserve.
  private readonly knownSharedKeys = new Set<string>();
  // Only successful directory sign-ins can populate this memory-only identity cache.
  // Active failure counters pin their identity until cleared/expired, preserving locks.
  private readonly confirmedDirectoryKeys = new Set<string>();
  // At most one anonymous password counter per cached directory identity.
  private readonly directorySharedKeys = new Set<string>();
  private readonly networkLocks = new Map<string, Set<string>>();
  // Only unlocked ordinary account counters may yield capacity, in least-recently-updated
  // order. Their failures remain charged to an address counter until its window expires.
  private readonly evictable = new Set<string>();

  constructor(onLock?: (key: string, address?: string) => void, onExpire?: (key: string, endedAt: number) => void) {
    super();
    this.onLock = onLock;
    this.onExpire = onExpire;
  }

  override set(key: string, value: Failure): this {
    const now = elapsed();
    this.sweep(now);
    if (!this.has(key)) {
      if (!this.canRecord(key, !!value.shared, !!value.knownAccount)) return this;
      if (!value.shared && this.ordinaryCapacityFull()) this.delete(this.evictable.values().next().value!);
    }
    this.delete(key);
    if (value.shared) (value.knownAccount ? this.knownSharedKeys : this.confirmedDirectoryKeys.has(key) ? this.directorySharedKeys : this.sharedKeys).add(key);
    else if (!key.startsWith('\0address\0') && (value.until === undefined || value.until <= now)) this.evictable.add(key);
    if (value.network !== undefined && value.until !== undefined && value.until > now) {
      const keys = this.networkLocks.get(value.network) ?? new Set<string>();
      keys.add(key);
      this.networkLocks.set(value.network, keys);
    }
    this.nextExpiry = Math.min(this.nextExpiry, value.until ?? value.first + LOCKOUT.windowMs);
    return super.set(key, value);
  }

  override delete(key: string): boolean {
    const network = this.get(key)?.network;
    if (network !== undefined) {
      const keys = this.networkLocks.get(network);
      keys?.delete(key);
      if (!keys?.size) this.networkLocks.delete(network);
    }
    this.sharedKeys.delete(key);
    this.knownSharedKeys.delete(key);
    this.directorySharedKeys.delete(key);
    this.evictable.delete(key);
    return super.delete(key);
  }

  override clear(): void {
    super.clear();
    this.sharedKeys.clear();
    this.knownSharedKeys.clear();
    this.directorySharedKeys.clear();
    this.networkLocks.clear();
    this.evictable.clear();
    this.nextExpiry = Infinity;
  }

  private sweep(now: number): void {
    if (now < this.nextExpiry && this.windowMs === LOCKOUT.windowMs) return;
    this.windowMs = LOCKOUT.windowMs;
    this.nextExpiry = Infinity;
    for (const [key, value] of this) {
      const expires = value.until ?? value.first + LOCKOUT.windowMs;
      if (expires <= now) {
        this.delete(key);
        // Only an issued lock that ran out is reported; a counter whose window passed was never a block.
        // The callback may write to a busy or closed file: whatever it throws, the sweep still finishes and a sign-in check never fails on it.
        if (value.until !== undefined) try { this.onExpire?.(key, Date.now() - (now - value.until)); } catch { /* the owner keeps what it could not record */ }
      } else this.nextExpiry = Math.min(this.nextExpiry, expires);
    }
  }

  /** Remember a successful directory identity independently of its failure counter. */
  confirmDirectory(key: string): void {
    this.sweep(elapsed());
    if (!this.confirmedDirectoryKeys.delete(key) && this.confirmedDirectoryKeys.size >= LOCKOUT.directoryAccounts) {
      // Least recently successful identity without an active failure counter.
      const oldest = [...this.confirmedDirectoryKeys].find((candidate) => !this.has(candidate));
      // Successful authentication still works when all cached identities are pinned.
      if (oldest === undefined) return;
      this.confirmedDirectoryKeys.delete(oldest);
    }
    this.confirmedDirectoryKeys.add(key);
  }

  private ordinaryCapacityFull(): boolean {
    return this.size - this.knownSharedKeys.size - this.directorySharedKeys.size >= LOCKOUT.maxFailures;
  }

  private canRecord(key: string, shared: boolean, knownAccount = false): boolean {
    if (this.has(key) || (shared && knownAccount)) return true;
    if (shared && this.confirmedDirectoryKeys.has(key)) return true;
    if (shared) return this.sharedKeys.size < LOCKOUT.sharedFailures && !this.ordinaryCapacityFull();
    return !this.ordinaryCapacityFull() || this.evictable.size > 0;
  }

  private capacityUntil(): number {
    return Date.now() + Math.max(1, this.nextExpiry - elapsed());
  }

  /** Monotonic time a bucket stays blocked until, based only on its own failures. */
  private blockedUntil(key: string, now: number): number | undefined {
    this.sweep(now);
    const entry = this.get(key);
    if (entry?.until !== undefined && now < entry.until) return entry.until;
    return undefined;
  }

  /** When a bucket is blocked until (epoch ms): only this presentation boundary uses wall-clock time. */
  blocked(key: string): number | undefined {
    const now = elapsed(), until = this.blockedUntil(key, now);
    return until === undefined ? undefined : Date.now() + (until - now);
  }

  attempt(key: string, ok: boolean, limit = LOCKOUT.attempts, scope: Pick<Failure, 'shared' | 'knownAccount' | 'network' | 'address'> = {}): boolean {
    const now = elapsed();
    if (this.blockedUntil(key, now) !== undefined) return false;
    if (ok) { this.delete(key); return true; }
    const previous = this.get(key);
    const next: Failure = previous ? { count: previous.count + 1, first: previous.first } : { count: 1, first: now };
    Object.assign(next, scope);
    if (previous?.knownAccount) next.knownAccount = true;
    if (next.count >= limit) next.until = now + LOCKOUT.lockMs;
    this.set(key, next);
    if (this.get(key) === next && next.until !== undefined) this.onLock?.(key, next.address);
    return false;
  }

  accountKey(account: string, from: string, database?: string): string {
    if (sharedSource(from)) from = 'unknown';
    const name = lockoutName(account).replace(/\u0000/g, '');
    // Keep keys bounded without merging distinct names that share a long prefix.
    // The suffix makes long keys longer than any short name, so the namespaces cannot collide.
    const bounded = name.length <= 128 ? name : `${name.slice(0, 96)}:${createHash('sha256').update(name).digest('hex')}`;
    const key = `${bounded}\0${addressBucket(from)}`;
    return database === undefined ? key : `${database.toLowerCase()}\0${key}`;
  }

  record(key: string, from: string, ok: boolean, knownAccount = false): boolean {
    // Check before admitting an attacker-chosen name, including after an async password
    // check: attempts already in flight must not grow a newly locked address's entries.
    if (this.addressLockedOut(from) !== undefined) return false;
    if (noAddressBudget(from) && this.lockedOut(key, from, knownAccount) !== undefined) return false;
    // Success clears only the account counter: it cannot refill a password-spraying budget.
    // Anonymous sources have per-account limits, never an address-wide lock.
    if (!ok) {
      // Charge the protected address budget before admitting an evictable account counter.
      // The failure that reaches the address limit admits no name.
      this.countAddressFailure(from);
      if (this.addressLockedOut(from) !== undefined) return false;
    }
    return this.attempt(key, ok, LOCKOUT.attempts, sharedSource(from)
      ? { shared: true, knownAccount }
      // The key holds the /64 bucket; the audit trail keeps the whole canonical address.
      : { ...(LOCAL.has(spelling(from)) ? {} : { network: addressBucket(from) }), address: canonicalIP(from.split('%')[0]) ?? from }) && ok;
  }

  lockedOut(key: string, from: string, knownAccount = false): number | undefined {
    const account = this.blocked(key), address = this.addressLockedOut(from);
    const until = account !== undefined && address !== undefined ? Math.max(account, address) : account ?? address;
    if (until !== undefined) return until;
    // With a usable address, its counter can account for a failure even when no
    // account slot is free. Anonymous/local sources must have their own slot.
    if (noAddressBudget(from) && !this.canRecord(key, sharedSource(from), knownAccount)) return this.capacityUntil();
    return undefined;
  }

  addressLockedOut(from: string): number | undefined {
    if (noAddressBudget(from)) return undefined;
    const network = addressBucket(from), key = `\0address\0${network}`;
    const blocked = this.blocked(key);
    if (blocked !== undefined) return blocked;
    const locks = this.networkLocks.get(network);
    if (locks && locks.size >= LOCKOUT.addressLocks) {
      return Date.now() + Math.max(1, Math.min(...[...locks].map((k) => this.get(k)!.until!)) - elapsed());
    }
    // Refuse a new source before credential work when its failures cannot be
    // counted. Existing address counters keep working; capacity is not a lock.
    if (!this.canRecord(key, false)) return this.capacityUntil();
    return undefined;
  }

  countAddressFailure(from: string): void {
    if (noAddressBudget(from) || this.addressLockedOut(from) !== undefined) return;
    const network = addressBucket(from);
    this.attempt(`\0address\0${network}`, false, LOCKOUT.addressAttempts, { network });
  }
}
