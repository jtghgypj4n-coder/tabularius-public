// Talks to the security endpoints (/tabularius/security/v1), with the web client's session.
import { httpProblem } from '../http-problem.ts';

export class SecurityError extends Error {
  readonly code: number;
  readonly status?: number;
  constructor(code: number, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** true / false / a calculation ("limited"), matching the store's Rule. */
export type Rule = boolean | string;
export type Level = 'modifiable' | 'viewOnly' | 'none';

/** A field's access: masked shows a stand-in (last 4 characters, or a fixed text) instead of the value. */
export type FieldLevel = Level | 'masked';
export interface FieldMask { kind: 'last4' | 'placeholder'; text?: string }

export interface TablePrivileges {
  view: Rule;
  edit: Rule;
  create: boolean;
  delete: Rule;
  fields?: Record<string, FieldLevel>;
  /** How each masked field shows. Only masked fields have an entry. */
  masks?: Record<string, FieldMask>;
}

export interface PrivilegeSet {
  /** Explicit AI exceptions, by base table: true for the table or a list of field names. Does not grant data access. */
  aiVisible?: Record<string, true | string[]>;
  name: string;
  id?: number;
  comment?: string;
  records: TablePrivileges;
  tables?: Record<string, TablePrivileges>;
  layouts: Level;
  layoutAccess?: Record<string, { layout: Level; records: Level }>;
  valueLists: Level;
  valueListAccess?: Record<string, Level>;
  scripts: Level;
  scriptAccess?: Record<string, Level>;
  /** Available menu commands: all, editing (record data only) or minimum (navigation only). Absent = all. */
  menuCommands?: 'all' | 'editing' | 'minimum';
  extendedPrivileges: string[];
}

export interface Account {
  name: string;
  hasPassword: boolean;
  inactive?: boolean;
  privilegeSet?: string;
  external?: boolean;
  /** An AI agent identity (an MCP/AI client acts as this account); never [Full Access]. */
  agent?: boolean;
  /** For an agent account, the human account that created it. */
  createdBy?: string;
  /** For an agent account, its record changes are held as proposals for a human to approve. */
  needsApproval?: boolean;
  hasTotp: boolean;
  blankPassword: boolean;
  /** The account came from a converted file and still signs in with the file's own password. */
  unmigrated?: boolean;
  /** The account must set a new password on next sign-in (Account Options). */
  mustChange?: boolean;
  /** Opt-in: the account may sign in only from the server itself (a loopback address). */
  localOnly?: boolean;
  /** Opt-in: the account must have a confirmed second factor to sign in. */
  require2fa?: boolean;
}

/** The file's password policy (FileMaker's file-wide account options). */
export interface PasswordPolicy {
  minLength?: number;
  maxAgeDays?: number;
}

export interface ApiToken {
  id: string;
  label?: string;
  account: string;
  readOnly: boolean;
  created: string;
  expires?: string;
  lastUsed?: string;
  surfaces?: string[];
  /** When set, the token may only read/write through these Data API layouts (and only the Data API). */
  layouts?: string[];
}

/** A record change an approval-gated agent proposed, waiting for a human decision. */
export interface PendingChange {
  id: number;
  at: string;
  agent: string;
  kind: string;
  layout: string;
  table: string;
  recordId?: number;
  summary: string;
  data?: Record<string, unknown>;
}

export interface Security {
  database: string;
  accounts: Account[];
  privilegeSets: PrivilegeSet[];
  apiTokens: ApiToken[];
  /** Changes proposed by approval-gated AI agents, oldest first. */
  pendingChanges: PendingChange[];
  passwordPolicy: PasswordPolicy;
  /** Days a new API token lives when the form leaves the lifetime blank (0: no expiry). */
  tokenDefaultDays?: number;
  /** The file requires a confirmed second factor on every full-access account. */
  requireTotpForFullAccess: boolean;
  /** Full-access accounts with no second factor yet (what the switch would lock out). */
  fullAccessWithout2fa: string[];
  tables: { name: string; fields: string[] }[];
  layouts: string[];
  valueLists: string[];
  scripts: string[];
  extendedPrivileges: string[];
  /** The catalog entries alone (not Tabularius's built-in fmapp/fmwebdirect/fmrest/fmxml/fmmcp): what the Extended Privileges tab lists, renames and deletes. */
  customExtendedPrivileges: { id: number; name: string; grantedBy: string[] }[];
}

export interface AccountImportPlan {
  valid: boolean;
  rows: { row: number; account: string; actions: string[]; before: { privilegeSet: string | null; active: boolean } | null; after: { privilegeSet: string; active: boolean }; credentialSetupRequired: boolean }[];
  errors: { row: number; code: string }[];
  previewToken?: string;
  expiresAt?: string;
  batchId?: string;
}

export type Change = { op: string } & Record<string, unknown>;

/** The effect of a limited record-access rule, tried out before it is saved. */
export interface RecordRulePreview {
  table: string;
  rule: string;
  account: string;
  valid: boolean;
  error?: string;
  total: number;
  allowed?: number;
  samples: { recordId: number; allowed?: boolean; error?: string; label?: string }[];
}

const enc = encodeURIComponent;

export class SecurityClient {
  readonly db: string;
  readonly token: string;

  constructor(db: string, token: string) {
    this.db = db;
    this.token = token;
  }

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const r = await fetch(`/tabularius/security/v1/databases/${enc(this.db)}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new SecurityError(json.error?.code ?? -1, json.error?.message ?? httpProblem(r.status), r.status);
    return json;
  }

  security(): Promise<Security> {
    return this.call('GET', '');
  }

  change(changes: Change[]): Promise<Security> {
    return this.call('POST', '', { changes });
  }

  previewAccounts(csv: string): Promise<AccountImportPlan> {
    return this.call('POST', '/accounts/import/preview', { csv });
  }

  importAccounts(csv: string, previewToken: string, idempotencyKey: string): Promise<AccountImportPlan> {
    return this.call('POST', '/accounts/import/apply', { csv, previewToken, idempotencyKey });
  }

  createToken(account: string, opts: { label?: string; readOnly?: boolean; expiresDays?: number; surfaces?: string[]; layouts?: string[] }): Promise<{ token: string; security: Security }> {
    return this.call('POST', '/tokens', { account, ...opts });
  }

  /**
   * First-login flow for a converted file: gives each account still on the
   * file's own password (or just the named ones) a temporary password and
   * forces a change on next sign-in. Returns each account's one-time password.
   */
  migrate(accounts?: string[]): Promise<{ migrated: { account: string; password: string }[]; security: Security }> {
    return this.call('POST', '/migrate', accounts ? { accounts } : {});
  }

  /**
   * Try out a limited record-access rule before saving it: which of a table's
   * sample records it would allow (as a chosen account), and how many of the
   * whole table match. Nothing is stored.
   */
  previewRecordRule(table: string, rule: string, opts: { account?: string; limit?: number } = {}): Promise<RecordRulePreview> {
    return this.call('POST', '/record-rule/preview', { table, rule, ...opts });
  }

  enrollTotp(account: string): Promise<{ secret: string; uri: string; security: Security }> {
    return this.call('POST', `/totp/${enc(account)}`);
  }

  confirmTotp(account: string, code: string): Promise<{ confirmed: boolean; security: Security }> {
    return this.call('POST', `/totp/${enc(account)}/confirm`, { code });
  }

  /** Approve a pending agent change; it is applied as the agent, with the agent's own privileges. */
  approvePending(id: number): Promise<{ recordId?: number; security: Security }> {
    return this.call('POST', `/pending/${id}/approve`);
  }

  /** Reject (discard) a pending agent change without applying it. */
  rejectPending(id: number): Promise<{ rejected: boolean; security: Security }> {
    return this.call('POST', `/pending/${id}/reject`);
  }
}
