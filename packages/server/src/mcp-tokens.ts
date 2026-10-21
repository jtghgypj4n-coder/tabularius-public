// Tokens for AI apps (Claude Desktop, Claude Code, ...) to reach /mcp as one account of one file, with that
// account's privilege set: what it may see and change, and only when the set has the fmmcp extended
// privilege. Made and revoked in the admin console; the token itself is shown once and only its hash is
// kept, in a file in the hosted folder (so every worker of a cluster reads the same list).

import { expiryClock } from '../../store/src/clock.ts';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BoundedMap } from './bounded-map.ts';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';

export const MCP_TOKENS_FILE = '.openhbam-mcp-tokens.json';
/** Tokens start with this, so a leaked one is easy to recognise (and to scan for). */
const PREFIX = 'ohm_';

export interface McpToken {
  id: string;
  database: string;
  account: string;
  /** What it's for ("Claude Desktop on the office Mac"). */
  label: string;
  created: string;
  /** ISO time it stops working; none when it doesn't expire. */
  expires?: string;
  lastUsed?: string;
}

interface Stored extends McpToken {
  hash: string;
}

export class McpTokenError extends Error {}

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

export class McpTokens {
  private readonly file: string;
  private cache?: { mtime: number; tokens: Stored[] };
  /** Last-used times not yet written: written at most once a minute per token, not on every call. */
  private readonly touched = new BoundedMap<string, number>(1024);

  constructor(dir: string, onLastUsedWriteAttempt?: () => void) {
    this.file = join(dir, MCP_TOKENS_FILE);
    this.onLastUsedWriteAttempt = onLastUsedWriteAttempt;
  }

  private readonly onLastUsedWriteAttempt?: () => void;

  private read(): Stored[] {
    if (!existsSync(this.file)) return [];
    const mtime = statSync(this.file).mtimeMs;
    if (this.cache?.mtime === mtime) return this.cache.tokens;
    const tokens = readJsonStateSync<Stored[]>(this.file);
    this.cache = { mtime, tokens };
    const live = new Set(tokens.map((t) => t.id));
    for (const id of this.touched.keys()) if (!live.has(id)) this.touched.delete(id);
    return tokens;
  }

  list(): McpToken[] {
    return this.read().map(({ hash: _, ...t }) => t);
  }

  /** A new token for the account in the file; the token is in the result only. */
  create(input: { database: string; account: string; label?: string; days?: number }): McpToken & { token: string } {
    const database = String(input.database ?? '').trim();
    const account = String(input.account ?? '').trim();
    if (!database || !account) throw new McpTokenError('Pick a file and an account');
    const days = input.days === undefined || input.days === null ? undefined : Number(input.days);
    if (days !== undefined && !(Number.isFinite(days) && days > 0 && days <= 3650)) throw new McpTokenError('Days should be from 1 to 3650, or empty for no expiry');
    const token = PREFIX + randomBytes(32).toString('base64url');
    const now = new Date();
    const t: Stored = {
      id: randomBytes(6).toString('hex'), database, account, label: String(input.label ?? '').trim().slice(0, 200) || `${account} in ${database}`,
      created: now.toISOString(), ...(days ? { expires: new Date(expiryClock.now() + days * 86_400_000).toISOString() } : {}), hash: hashOf(token),
    };
    updateJsonStateSync<Stored[]>(this.file, [], (tokens) => [...tokens, t], { mode: 0o600 });
    this.cache = undefined;
    const { hash: _, ...shown } = t;
    return { ...shown, token };
  }

  revoke(id: string): boolean {
    let removed = false;
    updateJsonStateSync<Stored[]>(this.file, [], (tokens) => {
      const kept = tokens.filter((t) => t.id !== id);
      removed = kept.length !== tokens.length;
      return kept;
    }, { mode: 0o600 });
    this.cache = undefined;
    this.touched.delete(id);
    return removed;
  }

  /** The account and file a bearer token signs in as, or undefined when it isn't one of these tokens (or has expired). */
  check(token: string): { account: string; database: string } | undefined {
    if (!token.startsWith(PREFIX)) return undefined;
    const want = Buffer.from(hashOf(token), 'hex');
    const t = this.read().find((x) => timingSafeEqual(Buffer.from(x.hash, 'hex'), want));
    if (!t || (t.expires && !(Date.parse(t.expires) > expiryClock.now()))) return undefined;
    const now = performance.now();
    if (now - (this.touched.get(t.id) ?? -Infinity) > 60_000) {
      this.touched.set(t.id, now);
      try {
        this.onLastUsedWriteAttempt?.();
        updateJsonStateSync<Stored[]>(this.file, [], (latest) => latest.map((x) => (x.id === t.id ? { ...x, lastUsed: new Date().toISOString() } : x)), { mode: 0o600, lockWaitMs: 50 });
        this.cache = undefined;
      } catch {
        // Last used is a convenience; a read-only folder still signs in.
      }
    }
    return { account: t.account, database: t.database };
  }
}
