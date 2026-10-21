// A privilege audit in plain English: the accounts and privilege sets of a file read the way a careful FileMaker
// developer would read them, and each risky setup said in a sentence, with where it is and what to do about it.
// Security health (Store.securityHealth) counts hygiene (dormant accounts, broad tokens, sets that over-share);
// this reads the setups themselves: full-access accounts left weak, the guest account, extended privileges switched
// on that nothing uses, record limits that limit nothing, and calculations that total records the set can't view.
// Read-only: it changes nothing, and it never shows a password, a token or a record's values.

import { isFullAccess, Privileges, type PrivilegeDefinition, type Store } from '../../store/src/index.ts';

export type Severity = 'high' | 'medium' | 'low';

export interface PrivilegeFinding {
  severity: Severity;
  /** A stable kind, for tools and tests. */
  kind: 'full-access-no-password' | 'full-access-no-2fa' | 'guest' | 'unused-extended' | 'rarely-needed-extended' | 'always-true-rule' | 'calc-reads-hidden';
  /** One sentence: what is set up, said plainly. */
  title: string;
  /** Why it matters and what to do about it. */
  detail: string;
  /** Where it is: an account, a privilege set, a table or a field. */
  account?: string;
  privilegeSet?: string;
  table?: string;
  field?: string;
}

export interface PrivilegeReview {
  database: string;
  findings: PrivilegeFinding[];
  counts: Record<Severity, number>;
  /** How far back sign-ins were read to tell what is used. */
  unusedDays: number;
}

/** Surfaces that let an account in from outside the web client, and what each is in plain words. */
const SURFACES: Record<string, string> = {
  fmrest: 'the Data API', fmodata: 'OData', fmxdbc: 'ODBC/JDBC and SQL', fmxml: 'XML publishing', fmphp: 'PHP publishing',
  fmwebdirect: 'WebDirect', fmapp: 'FileMaker-style app sign-in', fmmcp: 'AI tools (MCP)',
};
/** Surfaces few solutions use; on for a set, they are worth a second look even when its accounts sign in. */
const RARE = new Set(['fmodata', 'fmxdbc', 'fmxml', 'fmphp']);
const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const list = (xs: string[], max = 6) => xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** A formula with its string literals and comments taken out, so names inside them don't count. */
function code(formula: string): string {
  return formula.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n\r]*/g, ' ');
}

/** Does a record-level rule read anything that can differ between records or accounts? */
function readsSomething(formula: string, fields: string[]): boolean {
  const c = code(formula);
  if (/::|\$|\bGet\s*\(|\bEvaluate\s*\(|\bExecuteSQL\s*\(|\bSelf\b/i.test(c)) return true;
  return fields.some((f) => new RegExp(`(^|[^\\w])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`, 'i').test(c));
}

/** Table occurrences a formula names (TO::Field), other than `own`. */
function occurrencesRead(formula: string, own: string): string[] {
  const c = code(formula);
  const out = new Set<string>();
  for (const m of c.matchAll(/([^\s;()[\]"&+\-*/=<>≠≤≥,¶]+(?: [^\s;()[\]"&+\-*/=<>≠≤≥,¶]+)*)\s*::/g)) {
    if (m[1].toLowerCase() !== own.toLowerCase()) out.add(m[1]);
  }
  return [...out];
}

export function reviewPrivileges(store: Store, opts: { unusedDays?: number } = {}): PrivilegeReview {
  const health = store.securityHealth({ unusedDays: opts.unusedDays });
  const unusedDays = health.unusedDays;
  const findings: PrivilegeFinding[] = [];
  const sets = store.privilegeSets();
  const active = store.accounts().filter((a) => !a.inactive);
  const blank = new Set(store.blankPasswordAccounts().map((n) => n.toLowerCase()));
  const totp = new Set(store.totpAccounts().map((n) => n.toLowerCase()));
  const dormant = new Set(health.unused.map((u) => u.account.toLowerCase()));
  const membersOf = (set: string) => active.filter((a) => a.privilegeSet === set && !/^\[.*\]$/.test(a.name));

  // Full access: the keys to everything, so a weak sign-in there matters most.
  for (const a of active) {
    if (a.external || !store.privileges(a.name).full || /^\[.*\]$/.test(a.name)) continue;
    if (blank.has(a.name.toLowerCase()) || !a.hasPassword) {
      findings.push({
        severity: 'high', kind: 'full-access-no-password', account: a.name, privilegeSet: a.privilegeSet,
        title: `"${a.name}" has full access and no password.`,
        detail: 'Anyone who can reach the server can sign in as it and change everything, the design and the security included. ' +
          'Give it a password (the Security health list has a one-click temporary password), or deactivate it.',
      });
    } else if (!totp.has(a.name.toLowerCase())) {
      findings.push({
        severity: 'medium', kind: 'full-access-no-2fa', account: a.name, privilegeSet: a.privilegeSet,
        title: `"${a.name}" has full access with only a password.`,
        detail: 'A guessed or leaked password is enough to take over the file. Set up two-factor sign-in for it in Manage Security, ' +
          'or turn on "require two-factor" for full-access accounts.',
      });
    }
  }

  // The guest account: FileMaker's "sign in as guest". It comes across switched off. Switched on here, it still opens nothing by
  // itself, since every route needs an account name and a password it can't match; it matters when someone gives it a password.
  for (const a of active.filter((x) => /^\[guest\]$/i.test(x.name))) {
    const p = store.privileges(a.name);
    const reads = store.schema.tables.filter((t) => p.table(t.name).view !== false).map((t) => t.name);
    if (!reads.length && !p.full) continue;
    const surfaces = Object.keys(SURFACES).filter((e) => p.has(e));
    findings.push({
      severity: p.full || surfaces.length ? 'medium' : 'low', kind: 'guest', account: a.name, privilegeSet: a.privilegeSet,
      title: p.full ? 'The [Guest] account is on, with full access.' : `The [Guest] account is on, with a set that reads ${plural(reads.length, 'table')}${reads.length <= 6 ? ` (${list(reads)})` : ''}.`,
      detail: 'This server never lets anyone in without an account name and a password, so [Guest] opens nothing until someone gives it a password, and then it is a shared account. ' +
        (surfaces.length ? `Its set also opens ${list(surfaces.map((s) => SURFACES[s]))}, so that would reach past the web client. ` : '') +
        'Turn the [Guest] account off in Manage Security unless you use it, or give its set read-only access to just what it needs.',
    });
  }

  for (const set of sets) {
    if (isFullAccess(set)) continue;
    const members = membersOf(set.name);
    const ext = set.extendedPrivileges.filter((e) => SURFACES[e.toLowerCase()]).map((e) => e.toLowerCase());

    // Extended privileges nobody uses: a set no active account has, or whose accounts haven't signed in lately.
    if (ext.length) {
      const idle = members.every((m) => dormant.has(m.name.toLowerCase()));
      if (!members.length || idle) {
        findings.push({
          severity: 'medium', kind: 'unused-extended', privilegeSet: set.name,
          title: `"${set.name}" opens ${list(ext.map((e) => SURFACES[e]))}, but ${members.length ? `none of its ${plural(members.length, 'account')} (${list(members.map((m) => m.name))}) has signed in for ${unusedDays} days` : 'no active account uses the set'}.`,
          detail: 'Each surface switched on is a way in. Turn these extended privileges off in Manage Security until someone needs them.',
        });
      } else {
        const rare = ext.filter((e) => RARE.has(e));
        if (rare.length) {
          findings.push({
            severity: 'low', kind: 'rarely-needed-extended', privilegeSet: set.name,
            title: `"${set.name}" opens ${list(rare.map((e) => SURFACES[e]))} for ${plural(members.length, 'account')} (${list(members.map((m) => m.name))}).`,
            detail: 'Few solutions need these; they let reporting tools read every record the set may see. Turn them off unless something connects that way.',
          });
        }
      }
    }

    // Record limits that limit nothing: a formula reading no field, account or variable gives every record the same answer.
    const rules: { table: string; action: 'view' | 'edit' | 'delete'; rule: string }[] = [];
    for (const t of store.schema.tables) {
      const tp = set.tables?.[t.name] ?? set.records;
      for (const action of ['view', 'edit', 'delete'] as const) {
        const r = tp[action];
        if (typeof r === 'string' && r.trim()) rules.push({ table: t.name, action, rule: r });
      }
    }
    for (const r of rules) {
      const t = store.schema.tables.find((x) => x.name === r.table)!;
      if (readsSomething(r.rule, t.fields.map((f) => f.name))) continue;
      let all = false;
      try {
        const p = store.previewRecordRule(r.table, r.rule, { limit: 1 });
        all = p.valid && p.allowed === p.total;
      } catch {
        continue;
      }
      if (!all) continue;
      findings.push({
        severity: r.action === 'view' ? 'medium' : 'low', kind: 'always-true-rule', privilegeSet: set.name, table: r.table,
        title: `"${set.name}" limits which ${r.table} records it can ${r.action} with "${r.rule.slice(0, 80)}", which is true for every record.`,
        detail: `The limit reads no field and no account, so it allows them all, the same as "yes". Write the rule you meant (for example ` +
          `${r.table}::Owner = Get ( AccountName )) and preview it in Manage Security, or set it to "yes" so it says what it does.`,
      });
    }

    // Calculations that read what the set can't: an unstored total over related records it may not view shows their sum anyway.
    const p: Privileges = new Privileges('', set as PrivilegeDefinition, store, (): Privileges => p);
    if (p.readsEverything) continue;
    for (const t of store.schema.tables) {
      if (p.table(t.name).view === false) continue;
      const own = store.schema.tableOccurrences.find((o) => o.baseTableId === t.id && !o.dataSourceId)?.name ?? t.name;
      for (const f of t.fields) {
        if (f.kind !== 'calculation' || !f.options?.unstored || !f.calculation || p.fieldAccess(t.name, f.name) === 'none') continue;
        // A masked field still shows a stand-in of its value (its last four characters), so it is checked too.
        const masked = p.fieldAccess(t.name, f.name) === 'masked';
        const hidden = occurrencesRead(f.calculation, own).flatMap((name) => {
          const to = store.schema.tableOccurrences.find((o) => o.name.toLowerCase() === name.toLowerCase());
          const bt = to && !to.dataSourceId ? store.schema.tables.find((x) => x.id === to.baseTableId) : undefined;
          if (!bt) return [];
          const view = p.table(bt.name).view;
          return view === true ? [] : [`${bt.name}${view === false ? '' : ' (some records)'}`];
        });
        if (!hidden.length) continue;
        findings.push({
          severity: 'high', kind: 'calc-reads-hidden', privilegeSet: set.name, table: t.name, field: f.name,
          title: `"${set.name}" can see ${masked ? 'a masked version of ' : ''}${t.name}::${f.name}, which is worked out from ${list([...new Set(hidden)])} that the set can't view.`,
          detail: `Its value (${f.calculation.length > 60 ? f.calculation.slice(0, 60) + '…' : f.calculation}) can reveal totals or ` +
            'values of records the set is kept from. Set the field to "no access" for this set, or change the set\'s record access, ' +
            'until calculations follow the account\'s record access (the Accounts and privilege sets work).',
        });
      }
    }
  }

  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  return { database: store.name, findings, counts, unusedDays };
}
