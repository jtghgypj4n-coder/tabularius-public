// Local-account CSV desired state. Errors are reason codes, never source text.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { parseDelimited } from './delimited.ts';
import { isFullAccess, type PrivilegeDefinition } from './privileges.ts';
import { StoreError } from './errors.ts';
import { lockoutName } from './sign-in-failures.ts';
import { validAccountImportName, validPrivilegeSetName } from './security-names.ts';

export class AccountImportError extends StoreError {
  readonly status: number;
  constructor(reason: string, status = 400) {
    super(960, reason);
    this.status = status;
  }
}

/** SQLite NOCASE folds ASCII only; don't use Unicode lowercasing as a mutation key. */
export function accountKey(name: string): string {
  return name.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export function accountCollisionKey(name: string): string {
  return name.normalize('NFC').toLowerCase().normalize('NFC');
}

export interface AccountImportRow { row: number; account: string; privilegeSet: string; active: boolean }
export interface AccountImportIssue { row: number; code: string }
export interface AccountImportState { privilegeSet: string | null; active: boolean }
export interface AccountImportDecision {
  row: number;
  account: string;
  actions: ('create' | 'update' | 'deactivate' | 'reactivate' | 'no-op')[];
  before: AccountImportState | null;
  after: { privilegeSet: string; active: boolean };
  credentialSetupRequired: boolean;
}
export interface AccountImportPlan { valid: boolean; rows: AccountImportDecision[]; errors: AccountImportIssue[] }
export interface AccountImportPreview extends AccountImportPlan { previewToken?: string; expiresAt?: string }
export interface AccountImportResult extends AccountImportPlan { batchId: string }
export interface ImportAccount {
  name: string; privilegeSet?: string; inactive?: boolean; external?: boolean; agent?: boolean;
  hasPassword: boolean; recoverable: boolean; local: boolean;
  require2fa?: boolean; hasSecondFactor?: boolean;
}

/** A remaining administrator must have an unambiguous, usable local sign-in path. */
export function isRecoveryAdministrator(account: ImportAccount, accounts: ImportAccount[], sets: PrivilegeDefinition[], fileRequires2fa: boolean,
  state: AccountImportState = { privilegeSet: account.privilegeSet ?? null, active: !account.inactive }): boolean {
  if (!state.active || !account.local || account.external || account.agent || !account.recoverable) return false;
  const name = state.privilegeSet;
  const set = name ? sets.find((p) => accountKey(p.name) === accountKey(name)) : undefined;
  if (!set || !isFullAccess(set)) return false;
  const key = accountKey(account.name);
  if (accounts.filter((a) => accountKey(a.name) === key).length !== 1 ||
    accounts.some((a) => accountCollisionKey(a.name) === accountCollisionKey(account.name) && accountKey(a.name) !== key)) return false;
  return !(account.require2fa || fileRequires2fa) || account.hasSecondFactor === true;
}

export const ACCOUNT_IMPORT_MAX_BYTES = 1024 * 1024;
export function parseAccountCsv(csv: string): AccountImportRow[] {
  if (Buffer.byteLength(csv) > ACCOUNT_IMPORT_MAX_BYTES) throw new AccountImportError('upload-too-large', 413);
  let records: string[][];
  try { records = parseDelimited(csv, ',', true); }
  catch { throw new AccountImportError('invalid-csv-quoting'); }
  const headers = records.shift();
  if (!headers || headers.length !== 3 || new Set(headers).size !== 3 || !['account', 'privilegeSet', 'active'].every((h) => headers.includes(h))) {
    throw new AccountImportError('expected-account-privilegeSet-active-columns');
  }
  if (records.length > 1000) throw new AccountImportError('too-many-rows', 413);
  if (!records.length) throw new AccountImportError('empty-import');
  return records.map((r, i) => {
    if (r.length !== 3) throw new AccountImportError(`row-${i + 2}-column-count`);
    const active = r[headers.indexOf('active')];
    if (active !== 'true' && active !== 'false') throw new AccountImportError(`row-${i + 2}-invalid-active`);
    return { row: i + 2, account: r[headers.indexOf('account')], privilegeSet: r[headers.indexOf('privilegeSet')], active: active === 'true' };
  });
}

export const importDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function planAccountImport(input: AccountImportRow[], accounts: ImportAccount[], sets: PrivilegeDefinition[], actor: string, via?: string, externalNames: string[] = [], fileRequires2fa = false): AccountImportPlan {
  const errors: AccountImportIssue[] = [];
  const rows: AccountImportDecision[] = [];
  const seen = new Set<string>();
  const allNames = [...externalNames, ...accounts.map((a) => a.name), ...input.map((r) => r.account)];
  const collisionKeys = new Map<string, Set<string>>();
  for (const name of allNames) {
    const key = accountCollisionKey(name);
    const values = collisionKeys.get(key) ?? new Set<string>();
    values.add(accountKey(name));
    collisionKeys.set(key, values);
  }
  // Names that share a lockout bucket are as ambiguous as names that look alike: see lockoutName.
  const bucketKeys = new Map<string, Set<string>>();
  for (const name of allNames) {
    const bucket = lockoutName(name);
    bucketKeys.set(bucket, (bucketKeys.get(bucket) ?? new Set<string>()).add(accountKey(name)));
  }
  const ambiguousBuckets = new Set([...bucketKeys].filter(([, values]) => values.size > 1).map(([key]) => key));
  const ambiguousNames = new Set([...collisionKeys].filter(([, values]) => values.size > 1).map(([key]) => key));
  for (const r of input) {
    const issue = (code: string) => errors.push({ row: r.row, code });
    const key = accountKey(r.account);
    if (!validAccountImportName(r.account)) issue('invalid-account-name');
    if (/^\[.*\]$/.test(r.account)) issue('reserved-account');
    if (!validPrivilegeSetName(r.privilegeSet)) issue('invalid-privilege-set');
    if (seen.has(key)) issue('duplicate-account');
    seen.add(key);
    if (ambiguousNames.has(accountCollisionKey(r.account)) || ambiguousBuckets.has(lockoutName(r.account))) issue('ambiguous-unicode-account');
    const matches = accounts.filter((a) => accountKey(a.name) === key);
    if (matches.length > 1) issue('ambiguous-existing-account');
    const a = matches[0];
    if (key === accountKey(actor) || (via && key === accountKey(via))) issue('self-account');
    if ((a && (!a.local || a.external || a.agent)) || externalNames.some((name) => accountKey(name) === key)) issue('non-local-account');
    const set = sets.find((p) => accountKey(p.name) === accountKey(r.privilegeSet));
    if (!set) issue('unknown-privilege-set');
    if (set && isFullAccess(set) && a?.privilegeSet !== set.name) issue('full-access-grant');
    const before = a ? { privilegeSet: a.privilegeSet ?? null, active: !a.inactive } : null;
    const after = { privilegeSet: set?.name ?? r.privilegeSet, active: r.active };
    const actions: AccountImportDecision['actions'] = [];
    if (!a) actions.push('create');
    else {
      if (before!.privilegeSet !== after.privilegeSet) actions.push('update');
      if (before!.active !== after.active) actions.push(after.active ? 'reactivate' : 'deactivate');
    }
    if (!actions.length) actions.push('no-op');
    rows.push({ row: r.row, account: a?.name ?? r.account, actions, before, after, credentialSetupRequired: !a || !a.hasPassword });
  }
  const removesFull = rows.some((r) => {
    const old = sets.find((s) => s.name === r.before?.privilegeSet);
    return r.before?.active && old && isFullAccess(old) && (!r.after.active || r.after.privilegeSet !== old.name);
  });
  const remaining = accounts.some((a) => {
    const desired = rows.find((r) => accountKey(r.account) === accountKey(a.name))?.after;
    return isRecoveryAdministrator(a, accounts, sets, fileRequires2fa, desired);
  });
  if (removesFull && !remaining) errors.push({ row: 0, code: 'last-full-access' });
  return { valid: !errors.length, rows, errors };
}

export function ensureAccountImportTables(sql: DatabaseSync): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS _fm_account_import_receipts (
    key TEXT PRIMARY KEY, actor TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _fm_account_import_limits (
    actor TEXT NOT NULL, kind TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY (actor, kind));`);
}
