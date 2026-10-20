// "Who can do what": a one-click access review for audits. Row per account per
// table (for a non-full-access account) or one summary row (for full access),
// with the account's extended privileges, last sign-in and two-factor status
// alongside — everything an auditor would otherwise have to open Manage
// Security and the security health page to piece together. Read-only.

import { accessReport, isFullAccess, type Store } from '../../store/src/index.ts';
import { csvField as safeCsvField } from '../../store/src/index.ts';

export type Access = 'yes' | 'limited' | 'no';

export interface AccessReviewRow {
  account: string;
  privilegeSet: string;
  fullAccess: boolean;
  /** "*" for a full-access account's one summary row. */
  table: string;
  view: Access;
  edit: Access;
  create: Access;
  delete: Access;
  /** Fields this table has of its own that are hidden or view-only for this account; 0 when the table has no entry of its own, or the account has full access. */
  hiddenFields: number;
  viewOnlyFields: number;
  /** Fields it sees only a stand-in for (last four characters, or a fixed text). Not counted in hiddenFields. */
  maskedFields: number;
  extendedPrivileges: string[];
  lastSignIn?: string;
  daysSinceSignIn?: number;
  /** No sign-in within the review's `unusedDays`, or never. */
  stale: boolean;
  has2fa: boolean;
}

export interface AccessReview {
  database: string;
  unusedDays: number;
  rows: AccessReviewRow[];
  /** Plain-English headline findings, worst first — the same facts the rows carry, said as sentences. */
  summary: string[];
}

const access = (allowed: boolean | 'limited'): Access => allowed === true ? 'yes' : allowed === 'limited' ? 'limited' : 'no';
const list = (xs: string[], max = 8) => xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function accessReview(store: Store, opts: { unusedDays?: number } = {}): AccessReview {
  const unusedDays = Number.isFinite(opts.unusedDays) && opts.unusedDays! > 0 ? Math.trunc(opts.unusedDays!) : 90;
  const now = Date.now();
  const days = (iso: string) => Math.floor((now - Date.parse(iso)) / 86_400_000);
  const lastSignIn = store.lastSignIns();
  const totp = new Set(store.totpAccounts().map((n) => n.toLowerCase()));
  const accounts = store.accounts().filter((a) => !a.inactive);
  const cache = new Map<string, ReturnType<typeof accessReport>>();

  const rows: AccessReviewRow[] = [];
  const fullAccess: string[] = [];
  for (const a of accounts) {
    const set = a.privilegeSet ? store.privilegeSet(a.privilegeSet) : undefined;
    const full = (set && isFullAccess(set)) || store.privileges(a.name).full;
    const at = lastSignIn.get(a.name.toLowerCase());
    const daysSince = at ? days(at) : undefined;
    const common = {
      account: a.name, privilegeSet: a.privilegeSet ?? '', fullAccess: full,
      extendedPrivileges: set?.extendedPrivileges ?? [],
      lastSignIn: at, daysSinceSignIn: daysSince,
      stale: daysSince === undefined || daysSince >= unusedDays,
      has2fa: totp.has(a.name.toLowerCase()),
    };
    if (full) fullAccess.push(a.name);
    if (full) {
      rows.push({ ...common, table: '*', view: 'yes', edit: 'yes', create: 'yes', delete: 'yes', hiddenFields: 0, viewOnlyFields: 0, maskedFields: 0 });
      continue;
    }
    // No privilege set assigned: the account can't sign in to anything, the same as the file's own default (no access) — not full access.
    if (!set) {
      rows.push({ ...common, table: '*', view: 'no', edit: 'no', create: 'no', delete: 'no', hiddenFields: 0, viewOnlyFields: 0, maskedFields: 0 });
      continue;
    }
    let report = cache.get(set.name);
    if (!report) {
      report = accessReport(store.privilegesForSet(set.name), store.schema);
      cache.set(set.name, report);
    }
    for (const t of report.tables) {
      rows.push({
        ...common, table: t.table,
        view: access(t.view.allowed), edit: access(t.edit.allowed), create: t.create ? 'yes' : 'no', delete: access(t.delete.allowed),
        hiddenFields: t.fields?.filter((f) => f.access === 'none').length ?? 0,
        viewOnlyFields: t.fields?.filter((f) => f.access === 'viewOnly').length ?? 0,
        maskedFields: t.fields?.filter((f) => f.access === 'masked').length ?? 0,
      });
    }
  }

  const summary: string[] = [];
  if (fullAccess.length) summary.push(`${plural(fullAccess.length, 'account has', 'accounts have')} full access: ${list(fullAccess)}.`);
  const withoutTotp = [...new Set(rows.filter((r) => !r.has2fa).map((r) => r.account))];
  if (withoutTotp.length) summary.push(`${plural(withoutTotp.length, 'account')} with no two-factor sign-in: ${list(withoutTotp)}.`);
  const stale = [...new Set(rows.filter((r) => r.stale).map((r) => r.account))];
  if (stale.length) summary.push(`${plural(stale.length, 'account')} ${stale.length === 1 ? 'has' : 'have'} not signed in for ${unusedDays}+ days (or never): ${list(stale)}.`);
  const sets = [...new Set(accounts.map((a) => a.privilegeSet).filter((s): s is string => !!s))];
  summary.unshift(`${plural(accounts.length, 'active account')} across ${plural(sets.length, 'privilege set')}.`);
  if (!summary.length) summary.push('Nothing stands out.');

  return { database: store.name, unusedDays, rows, summary };
}

/** One CSV field, quoted per RFC 4180 when it holds a comma, quote or newline. A leading =, +, - or @ is prefixed with ' so a spreadsheet won't run it as a formula. */
function csvField(value: unknown): string { return safeCsvField(value === null || value === undefined ? '' : Array.isArray(value) ? value.join('; ') : String(value)); }

/** The access review as CSV, one row per account per table (or one row for a full-access account). */
export function accessReviewCsv(review: AccessReview): string {
  const header = ['account', 'privilegeSet', 'fullAccess', 'table', 'view', 'edit', 'create', 'delete',
    'hiddenFields', 'viewOnlyFields', 'maskedFields', 'extendedPrivileges', 'lastSignIn', 'daysSinceSignIn', 'stale', 'has2fa'];
  const rows = review.rows.map((r) => [
    r.account, r.privilegeSet, r.fullAccess ? 'yes' : 'no', r.table, r.view, r.edit, r.create, r.delete,
    r.hiddenFields, r.viewOnlyFields, r.maskedFields, r.extendedPrivileges, r.lastSignIn ?? '', r.daysSinceSignIn ?? '',
    r.stale ? 'yes' : 'no', r.has2fa ? 'yes' : 'no',
  ].map(csvField).join(','));
  return [header.map((v) => safeCsvField(v)).join(','), ...rows].join('\r\n') + '\r\n';
}
