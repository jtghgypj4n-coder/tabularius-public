// Manage Security over HTTP: accounts, privilege sets, extended privileges,
// API tokens and two-factor sign-in, from the browser. Mirrors design mode's
// shape (a GET for the whole picture, a POST of all-or-none changes), but for
// a file's security rather than its schema.
//
//   GET  /tabularius/security/v1/databases/{db}                      the whole security picture
//   POST /tabularius/security/v1/databases/{db}                      {"changes": [SecurityOp, ...]}: all apply, or none
//        (a change may also be createExtendedPrivilege/updateExtendedPrivilege/deleteExtendedPrivilege, for the
//        Extended Privileges tab's own catalog of custom "ways in" — see EXTENDED_PRIVILEGE_OPS below)
//   POST /tabularius/security/v1/databases/{db}/tokens               mint an API token (returns it once)
//   POST /tabularius/security/v1/databases/{db}/record-rule/preview  try a limited-access rule before saving:
//        {"table","rule","account?","limit?"} -> which sample records it allows, and how many of the table match
//   POST /tabularius/security/v1/databases/{db}/migrate              first-login flow for a converted file:
//                                                                  give each account still on the file's own
//                                                                  password a temporary one + forced change
//                                                                  (optional {"accounts": [...]}); returns them once
//   POST /tabularius/security/v1/databases/{db}/totp/{account}       start a second factor (returns secret + otpauth URI)
//   POST /tabularius/security/v1/databases/{db}/totp/{account}/confirm   {"code": "123456"}
//
// Same session tokens as the Data API, and, like design mode, only an account
// with [Full Access] may use it.

import { defaultTokenDays, tokenExpiry } from './token-expiry.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BUILT_IN_EXTENDED_PRIVILEGES, StoreError, customAccess, isFullAccess, type DesignOp, type SecurityOp, type Store } from '../../store/src/index.ts';
import { ApiError, badPathError, lenient, readJson, sessionPrivileges, type DataApi } from './dataapi.ts';
import { AccountProvisioningApi } from './account-provisioning.ts';
import type { Host } from './host.ts';
import { assertAiSecurityChanges } from './ai-security.ts';
import { said } from './said.ts';

/** The three extended-privilege-catalog ops a Manage Security change batch may also carry (see applySecurityChanges). */
type ExtendedPrivilegeOp = Extract<DesignOp, { op: 'createExtendedPrivilege' | 'updateExtendedPrivilege' | 'deleteExtendedPrivilege' }>;
const EXTENDED_PRIVILEGE_OPS = new Set<string>(['createExtendedPrivilege', 'updateExtendedPrivilege', 'deleteExtendedPrivilege']);

/**
 * Applies a Manage Security change batch: mostly SecurityOp (applySecurity), but
 * extended privileges are a schema catalog (Manage Security's own tab in
 * FileMaker, but kept with the design log here, like scripts or value lists),
 * so those three ops go through applyDesign first. Mixed batches share one
 * transaction, including schema/cache rollback. Shared by the HTTP endpoint
 * below and the change_security MCP tool.
 */
export function applySecurityChanges(store: Store, changes: (SecurityOp | ExtendedPrivilegeOp)[], account?: string): void {
  if (account === 'AI' || (account && store.isAgent(account))) assertAiSecurityChanges(store, changes as unknown as Record<string, unknown>[]);
  const designOps: ExtendedPrivilegeOp[] = [];
  const securityOps: SecurityOp[] = [];
  for (const op of changes) {
    if (EXTENDED_PRIVILEGE_OPS.has(op.op)) designOps.push(op as ExtendedPrivilegeOp);
    else securityOps.push(op as SecurityOp);
  }
  store.securityChangeBatch(() => {
    if (designOps.length && securityOps.length) store.applySecurityWithCatalog(designOps, securityOps, { account });
  else if (designOps.length) store.applyDesign(designOps, { account });
    else if (securityOps.length) store.applySecurity(securityOps);
  });
}

/** The whole security picture, plus the schema lists the pickers need. */
/** One privilege set imported from the .fmp12 whose access here is only an approximation of FileMaker's. */
export interface ImportApproximation {
  set: string;
  /** What came across only roughly, in plain sentences, each saying whether it can give more or less access than FileMaker. */
  notes: string[];
  /** The set was changed here since (in Manage Security): the notes describe it as imported, and may no longer hold. */
  editedSince?: true;
}

/**
 * Privilege sets from the file whose access couldn't be imported exactly, and how (conversion_report says the same
 * per file). The three built-in sets are uniform and lose nothing. A set's per-layout, per-value-list and per-script
 * custom privileges aren't decoded yet, so it gets one overall access to each kind, which can be more or less than in
 * FileMaker. Custom per-table record access is imported failing closed (less), except that a limit by calculation
 * can't be told apart yet. A set changed in Manage Security since is marked `editedSince`.
 */
export function importApproximations(store: Store): ImportApproximation[] {
  const s = store.schema;
  const out: ImportApproximation[] = [];
  // Sets saved in Manage Security keep their new definition beside the file's.
  const edited = new Set((store.sql.prepare('SELECT name FROM _fm_privileges').all() as { name: string }[]).map((r) => r.name.toLowerCase()));
  for (const p of s.privilegeSets) {
    const builtIn = (p.id >= 1 && p.id <= 3) || ['[full access]', '[data entry only]', '[read-only access]'].includes(p.name.toLowerCase());
    if (builtIn) continue;
    const notes = ['Layout, value-list and script access is one overall setting for each: per-item custom privileges aren\'t decoded yet, so where FileMaker set them item by item this set can reach more or less here.'];
    if (p.customRecordAccess) {
      const m = customAccess(p, s);
      const count = (by: Record<string, string[]>) => Object.values(by).reduce((n, f) => n + f.length, 0);
      notes.push('Record access per table was imported, and a table the set doesn\'t list has no access. Record access FileMaker limits by a calculation can\'t be told apart yet, so such a table may come across as fully granted (more) or as no access (less).');
      const hidden = count(m.hiddenFields);
      if (hidden) notes.push(`${hidden} field${hidden === 1 ? '' : 's'} came across with no access (only fields the file marks read/write keep access), which can be less than in FileMaker.`);
      if (m.unresolvedTables.length) notes.push(`${m.unresolvedTables.length} listed table${m.unresolvedTables.length === 1 ? '' : 's'} couldn't be matched to a table in this file and got no access.`);
    }
    out.push({ set: p.name, notes, ...(edited.has(p.name.toLowerCase()) ? { editedSince: true as const } : {}) });
  }
  return out;
}

export function securityOf(store: Store) {
  const s = store.schema;
  const blank = new Set(store.blankPasswordAccounts().map((n) => n.toLowerCase()));
  const totp = new Set(store.totpAccounts().map((n) => n.toLowerCase()));
  const unmigrated = new Set(store.unmigratedAccounts().map((n) => n.toLowerCase()));
  return {
    database: store.name,
    accounts: store.accounts().map((a) => ({
      ...a,
      hasTotp: totp.has(a.name.toLowerCase()),
      blankPassword: blank.has(a.name.toLowerCase()),
      unmigrated: unmigrated.has(a.name.toLowerCase()),
    })),
    privilegeSets: store.privilegeSets(),
    // Sets whose imported access only approximates FileMaker's, so an answer about who can see what can say so.
    importApproximations: importApproximations(store),
    apiTokens: store.apiTokens(),
    // Changes proposed by approval-gated AI agents, waiting for a human to approve or reject.
    pendingChanges: store.pendingChanges(),
    passwordPolicy: store.passwordPolicy(),
    // The minimum in force, which is the server's default when the policy above names none.
    minPasswordLength: store.minPasswordLength(),
    // Days a new token lives when the form leaves it blank (0: none).
    tokenDefaultDays: defaultTokenDays(),
    requireTotpForFullAccess: store.requireTotpForFullAccess(),
    // Full-access accounts without a second factor: what blocks the switch, and
    // what it would lock out, shown so an admin can fix them before turning it on.
    fullAccessWithout2fa: store.fullAccessAccountsWithoutTotp(),
    // What the per-item privilege pickers choose from.
    tables: s.tables.map((t) => ({ name: t.name, fields: t.fields.map((f) => f.name) })),
    layouts: s.layouts.map((l) => l.name),
    valueLists: s.valueLists.map((v) => v.name),
    scripts: s.scripts.map((x) => x.name),
    extendedPrivileges: [...new Set([...s.extendedPrivileges.map((e) => e.name), ...BUILT_IN_EXTENDED_PRIVILEGES])],
    // The catalog entries alone, minus any that happen to be named like one of Tabularius's own built-ins (a brand new
    // file's starting catalog, or a real .fmp12's own Extended Privileges table, can carry one; it isn't really
    // custom and design.ts refuses to rename or delete it, so it's left off this list rather than shown with
    // buttons that would just fail). For the Extended Privileges tab's own list: each entry says which non-full
    // sets currently grant it.
    customExtendedPrivileges: s.extendedPrivileges
      .filter((e) => !(BUILT_IN_EXTENDED_PRIVILEGES as readonly string[]).some((b) => b.toLowerCase() === e.name.toLowerCase()))
      .map((e) => ({
        id: e.id, name: e.name,
        grantedBy: store.privilegeSets().filter((p) => !isFullAccess(p) && p.extendedPrivileges.includes(e.name)).map((p) => p.name),
      })),
  };
}

export class SecurityApi {
  private readonly provisioning: AccountProvisioningApi;
  private readonly host: Host;
  private readonly api: DataApi;

  constructor(host: Host, api: DataApi) {
    this.provisioning = new AccountProvisioningApi(host, api);
    this.host = host;
    this.api = api;
  }

  /** Returns false when the request is not for the security area. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (await this.provisioning.handle(req, res, url)) return true;
    const m = /^\/tabularius\/security\/v1\/databases\/([^/]+)(?:\/(tokens|migrate|record-rule\/preview|totp\/([^/]+?)(\/confirm)?|pending\/(\d+)\/(approve|reject)))?$/.exec(url.pathname);
    if (!m) return false;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const db = decodeURIComponent(m[1]);
      let session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      if (!sessionPrivileges(store, session).full) throw new ApiError(9, `Account "${session.account}" doesn't have full access, which security changes need`, 403);

      const authorize = () => {
        session = this.api.authorize(req, db);
        if (this.host.get(db) !== store) throw new ApiError(802, 'Unable to open file', 404);
        if (!sessionPrivileges(store, session).full) throw new ApiError(9, 'Security changes require full access', 403);
      };
      const sub = m[2];
      const account = m[3] ? decodeURIComponent(m[3]) : undefined;
      const needsBody = req.method === 'POST' && (!sub || ['tokens', 'migrate', 'record-rule/preview'].includes(sub) || !!(account && m[4]));
      const body = needsBody ? await (sub === 'migrate'
        ? readJson(req).catch(lenient({} as Record<string, unknown>)) : readJson(req)) : {};
      if (needsBody) authorize();
      if (req.method === 'GET' && !sub) {
        send(200, securityOf(store));
      } else if (req.method === 'POST' && !sub) {
        if (!Array.isArray(body.changes)) throw new ApiError(960, 'Send {"changes": [...]}', 400);
        // An agent's creator is the signed-in full-access account, stamped by the
        // server — the client can't claim a different one.
        const changes: (SecurityOp | ExtendedPrivilegeOp)[] = (body.changes as (SecurityOp | ExtendedPrivilegeOp)[]).map((op) =>
          op && (op.op === 'setAgentAccount' || (op.op === 'createAccount' && op.kind === 'agent')) ? { ...op, createdBy: session.account } : op);
        applySecurityChanges(store, changes, session.account);
        // A password set through Manage Security is a new secret: whoever was signed in on the old one is signed out.
        for (const op of changes) {
          if ((op.op === 'setAccount' || (op.op === 'createAccount' && op.kind === 'password')) && op.password !== undefined) this.api.endByAccount(store.name, op.name, session.token);
        }
        send(200, securityOf(store));
      } else if (req.method === 'POST' && sub === 'tokens') {
        if (typeof body.account !== 'string') throw new ApiError(960, 'account is required', 400);
        // Left out, the token takes the default lifetime; every token expires.
        const expires = tokenExpiry(body.expiresDays);
        const token = store.createApiToken(body.account, {
          label: typeof body.label === 'string' ? body.label : undefined,
          readOnly: !!body.readOnly,
          expires,
          surfaces: Array.isArray(body.surfaces) ? body.surfaces.map(String) : undefined,
          layouts: Array.isArray(body.layouts) ? body.layouts.map(String) : undefined,
          provenance: 'service',
        });
        send(200, { token, security: securityOf(store) });
      } else if (req.method === 'POST' && sub === 'migrate') {
        const accounts = Array.isArray(body.accounts) ? body.accounts.map(String) : undefined;
        const migrated = store.migrateAccounts({ accounts });
        send(200, { migrated, security: securityOf(store) });
      } else if (req.method === 'POST' && sub === 'record-rule/preview') {
        if (typeof body.table !== 'string' || typeof body.rule !== 'string') throw new ApiError(960, 'Send {"table": "...", "rule": "..."}', 400);
        send(200, store.previewRecordRule(body.table, body.rule, {
          account: typeof body.account === 'string' ? body.account : undefined,
          limit: body.limit !== undefined && body.limit !== null ? Number(body.limit) : undefined,
        }));
      } else if (req.method === 'POST' && account && !m[4]) {
        send(200, { ...store.enrollTotp(account), security: securityOf(store) });
      } else if (req.method === 'POST' && account && m[4]) {
        const confirmed = store.confirmTotp(account, said(body.code));
        send(confirmed ? 200 : 400, { confirmed, security: securityOf(store) });
      } else if (req.method === 'POST' && m[5]) {
        // Approve or reject an approval-gated agent's proposed change. Approval
        // replays it as the agent, with the agent's own privileges.
        const id = Number(m[5]);
        if (m[6] === 'approve') {
          send(200, { ...store.approvePending(id, session.account), security: securityOf(store) });
        } else {
          const rejected = store.rejectPending(id, session.account);
          send(rejected ? 200 : 404, { rejected, security: securityOf(store) });
        }
      } else {
        throw new ApiError(3, 'Command is unavailable', 405);
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof StoreError ? new ApiError(e.code, e.message, 400) : new ApiError(-1, 'Unknown error');
      if (!(e instanceof URIError) && !(e instanceof ApiError) && !(e instanceof StoreError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message } });
    }
    return true;
  }
}
