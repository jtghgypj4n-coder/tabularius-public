// SCIM 2.0 provisioning (RFC 7643/7644): an identity provider such as Okta or
// Microsoft Entra ID adds, changes, deactivates and removes a hosted file's
// people on its own, and moves them between privilege sets, instead of an
// admin doing it account by account in Manage Security.
//
//   /tabularius/scim/v2/databases/{db}/Users[/{id}]     GET (filter userName/externalId/id eq "..."), POST, PUT, PATCH, DELETE
//   /tabularius/scim/v2/databases/{db}/Groups[/{id}]    GET (filter displayName eq "..."), POST, PUT, PATCH, DELETE
//   /tabularius/scim/v2/databases/{db}/ServiceProviderConfig, /ResourceTypes, /Schemas
//
// What the provider sees, and how it maps onto the file:
// - A User is one external account named by the person's email address (the
//   SCIM userName), the same account single sign-on matches them to. It has no
//   password. active=false deactivates it (Enable Account [Deactivate]) and
//   signs it out and revokes its API tokens; DELETE leaves it deactivated with no set, so their domain or a
//   group can't sign them in again. Accounts SCIM didn't make are left alone,
//   except an external account already named by that email, which is taken over.
//   An account with a password, an AI agent, a file account, or one an admin
//   gave full access is never touched.
// - A Group is a privilege set; adding a person to it gives their account that
//   set. An account has one set, so the group they were added to last wins.
//   Removing them gives them another group's set, else the file's default
//   provisioning set, else none (they open nothing). [Full Access] (and any set with its powers) is never a group:
//   an identity provider can't hand out full access. Groups can't be created,
//   renamed or deleted here: POST links to an existing set of that name, and
//   DELETE only takes the set away from the people SCIM gave it to.
//
// Sign in with the file's provisioning token (Authorization: Bearer ohsc_...),
// issued from the admin console (or POST /tabularius/admin/v1/scim/token) and
// shown once; only its hash is kept, in the file. It always expires (90 days
// unless 1 to 3650 is asked for) and is refused afterwards like a wrong token. Every change is in the
// file's security log, made by "SCIM".

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { StoreError, isFullAccess, type Store } from '../../store/src/index.ts';
import { expiryClock } from '../../store/src/clock.ts';
import { DEFAULT_TOKEN_DAYS, tokenExpiry } from './token-expiry.ts';
import { ApiError, readJson, type DataApi } from './dataapi.ts';
import type { Host } from './host.ts';

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const PATCH_OP = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const SPC = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
const RESOURCE_TYPE = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType';
const SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema';
/** Who the security log says made a change. */
export const SCIM_ACTOR = 'SCIM';
const TOKEN_PREFIX = 'ohsc_';
const MAX_COUNT = 200;

/** A SCIM protocol error, sent as the RFC 7644 error body. */
class ScimError extends Error {
  readonly status: number;
  readonly scimType?: string;
  constructor(status: number, detail: string, scimType?: string) {
    super(detail);
    this.status = status;
    this.scimType = scimType;
  }
}

interface Settings {
  tokenHash?: string;
  issued?: string;
  /** When the token stops working (ISO). A token stored without one predates expiry and is refused. */
  expires?: string;
  defaultPrivilegeSet?: string;
}

interface Attrs {
  displayName?: string;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails?: { value: string; type?: string; primary?: boolean }[];
}

type Account = ReturnType<Store['accounts']>[number];

interface UserRow { id: string; account: string; external_id: string | null; attrs: string | null; groups: string | null; created: string; modified: string }

/** What a PUT or PATCH works on: the user as the provider can change it. */
interface UserModel extends Attrs {
  userName: string;
  externalId?: string;
  active: boolean;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function isBusy(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const error = e as { code?: unknown; errcode?: unknown };
  return String(error.code ?? '').includes('SQLITE_BUSY') || error.errcode === 5;
}

/** A privilege set's group id: its name, URL-safe and reversible. */
const groupId = (set: string) => Buffer.from(set, 'utf8').toString('base64url');

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Entra sends booleans as "True"/"False". */
function bool(v: unknown, what: string): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  throw new ScimError(400, `${what} must be true or false`, 'invalidValue');
}

/**
 * A file's SCIM directory: its provisioning token and settings (in _fm_meta),
 * and which accounts SCIM manages, with the provider's ids and the person's
 * details (in _fm_scim_users). The accounts themselves stay in _fm_accounts.
 */
export class ScimDirectory {
  readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  private table(): void {
    this.store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_scim_users (id TEXT PRIMARY KEY, account TEXT NOT NULL UNIQUE COLLATE NOCASE,
      external_id TEXT, attrs TEXT, groups TEXT, created TEXT NOT NULL, modified TEXT NOT NULL)`);
  }

  settings(): Settings {
    try {
      const row = this.store.sql.prepare(`SELECT json FROM _fm_meta WHERE key = 'scim'`).get() as { json: string } | undefined;
      return row ? JSON.parse(row.json) as Settings : {};
    } catch {
      return {};
    }
  }

  private save(s: Settings): void {
    this.store.sql.prepare(`INSERT INTO _fm_meta VALUES ('scim', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(s));
  }

  /** Privilege sets a provider may hand out: every one but full access. */
  groupSets(): string[] {
    return this.store.privilegeSets().filter((p) => !isFullAccess(p)).map((p) => p.name);
  }

  private checkSet(name: string): string {
    const set = this.store.privilegeSet(name);
    if (!set) throw new StoreError(960, `No privilege set "${name}"`);
    if (isFullAccess(set)) throw new StoreError(960, 'An identity provider cannot be given [Full Access] to hand out; pick a narrower set');
    return set.name;
  }

  /**
   * A new provisioning token (the old one stops working). Shown once; only its hash is kept. It always expires: after
   * `days` (1 to 3650), 90 when none is asked for. Refused, with the current token left as it was, when the days are not valid.
   */
  issueToken(opts: { defaultPrivilegeSet?: string | null; days?: unknown } = {}): string {
    const expires = tokenExpiry(opts.days ?? DEFAULT_TOKEN_DAYS);
    if (!expires) throw new StoreError(960, 'A provisioning token always expires. Days should be from 1 to 3650');
    const s = this.settings();
    if (opts.defaultPrivilegeSet !== undefined) s.defaultPrivilegeSet = opts.defaultPrivilegeSet === null ? undefined : this.checkSet(opts.defaultPrivilegeSet);
    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    this.save({ ...s, tokenHash: hash(token), issued: new Date().toISOString(), expires: expires.toISOString() });
    this.store.logProvisioningToken(true, undefined, expires.toISOString());
    return token;
  }

  /** Turns provisioning off: the token stops working. The accounts it made stay. Returns whether one was on. */
  revokeToken(): boolean {
    const s = this.settings();
    if (!s.tokenHash) return false;
    this.save({ ...s, tokenHash: undefined, issued: undefined, expires: undefined });
    this.store.logProvisioningToken(false);
    return true;
  }

  setDefaultPrivilegeSet(name: string | null): void {
    const s = this.settings();
    this.save({ ...s, defaultPrivilegeSet: name === null ? undefined : this.checkSet(name) });
  }

  /** Whether the token is the file's current one and still within its life. */
  tokenValid(token: string): boolean {
    const { tokenHash: want, expires } = this.settings();
    if (!want || !token.startsWith(TOKEN_PREFIX)) return false;
    const a = Buffer.from(hash(token), 'hex');
    const b = Buffer.from(want, 'hex');
    return a.length === b.length && timingSafeEqual(a, b) && this.live(expires);
  }

  /** Whether an expiry date is still ahead. No date (a token made before they existed) or one that does not read is not. */
  private live(expires: string | undefined): boolean {
    return !!expires && Date.parse(expires) > expiryClock.now();
  }

  /** What the console shows of the token: whether provisioning is set up, until when, and whether the token is still accepted. */
  tokenStatus(): { on: boolean; active: boolean; expires?: string; expired?: true; needsReissue?: true } {
    const { tokenHash, expires } = this.settings();
    if (!tokenHash) return { on: false, active: false };
    const active = this.live(expires);
    return {
      on: true, active, ...(expires ? { expires } : {}),
      // A date that has passed: say so. No date at all: made before tokens expired, so a new one is needed.
      ...(!active && expires ? { expired: true as const } : {}), ...(!expires ? { needsReissue: true as const } : {}),
    };
  }

  /** The file's accounts by lower-case name, read once per request rather than once per user. */
  accounts(): Map<string, Account> {
    return new Map(this.store.accounts().map((a) => [a.name.toLowerCase(), a]));
  }

  /** The accounts SCIM manages, dropping any an admin has since removed. */
  rows(accounts = this.accounts()): UserRow[] {
    this.table();
    const rows = this.store.sql.prepare('SELECT * FROM _fm_scim_users ORDER BY created, id').all() as unknown as UserRow[];
    const names = accounts;
    const gone = rows.filter((r) => !names.has(r.account.toLowerCase()));
    for (const r of gone) this.store.sql.prepare('DELETE FROM _fm_scim_users WHERE id = ?').run(r.id);
    return gone.length ? rows.filter((r) => names.has(r.account.toLowerCase())) : rows;
  }

  row(id: string): UserRow | undefined {
    return this.rows().find((r) => r.id === id);
  }

  userCount(): number {
    return this.rows().length;
  }

  /** The groups (privilege sets) the provider put a user in, oldest first. */
  memberships(r: UserRow): string[] {
    try {
      const list = r.groups ? JSON.parse(r.groups) as unknown : [];
      return Array.isArray(list) ? list.filter((g): g is string => typeof g === 'string') : [];
    } catch {
      return [];
    }
  }

  private setMemberships(r: UserRow, list: string[]): void {
    r.groups = JSON.stringify(list);
    this.store.sql.prepare('UPDATE _fm_scim_users SET groups = ? WHERE id = ?').run(r.groups, r.id);
  }

  /** The SCIM User for a row. */
  user(r: UserRow, location: string, accounts = this.accounts(), groups = this.groupSets()): Record<string, unknown> {
    const acct = accounts.get(r.account.toLowerCase());
    const attrs = r.attrs ? JSON.parse(r.attrs) as Attrs : {};
    return {
      schemas: [USER],
      id: r.id,
      ...(r.external_id !== null ? { externalId: r.external_id } : {}),
      userName: r.account,
      ...attrs,
      active: !acct?.inactive,
      groups: this.memberships(r).filter((g) => groups.includes(g)).map((g) => ({ value: groupId(g), display: g, $ref: `${location}/Groups/${groupId(g)}` })),
      meta: { resourceType: 'User', created: r.created, lastModified: r.modified, location: `${location}/Users/${r.id}` },
    };
  }

  model(r: UserRow, accounts = this.accounts()): UserModel {
    const acct = accounts.get(r.account.toLowerCase());
    return { userName: r.account, ...(r.external_id !== null ? { externalId: r.external_id } : {}), ...(r.attrs ? JSON.parse(r.attrs) as Attrs : {}), active: !acct?.inactive };
  }

  /** The default provisioning set, when it still exists and still isn't full access. */
  private defaultSet(): string | undefined {
    const def = this.settings().defaultPrivilegeSet;
    const set = def ? this.store.privilegeSet(def) : undefined;
    return set && !isFullAccess(set) ? set.name : undefined;
  }

  /**
   * Runs a group of writes all-or-nothing. Outside a transaction the file's write lock is taken first: a bare
   * savepoint starts a deferred transaction whose first write fails at once with "database is locked" when another
   * connection (the warm-up worker, a cluster peer) wrote in between.
   */
  private atomically<T>(name: string, run: () => T): T {
    const sql = this.store.sql;
    const began = !sql.isTransaction;
    if (began) sql.exec('BEGIN IMMEDIATE');
    let savepoint = false;
    try {
      sql.exec(`SAVEPOINT ${name}`);
      savepoint = true;
      const result = run();
      sql.exec(`RELEASE ${name}`);
      if (began) sql.exec('COMMIT');
      return result;
    } catch (error) {
      // SQLite may already have rolled everything back (a full disk); the original error is the one to report.
      if (sql.isTransaction) {
        if (savepoint) sql.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        if (began) sql.exec('ROLLBACK');
      }
      throw error;
    }
  }

  /**
   * An account whose set a provider may not change: one an admin gave full
   * access (or a set no longer offered as a group). The token is weaker than a
   * full-access admin, so it can't take that access away either.
   */
  private canTouch(account: string): boolean {
    try { this.guard(account); return true; } catch (e) { if (e instanceof ScimError) return false; throw e; }
  }

  private guard(account: string): void {
    const name = this.store.accountPrivilegeSet(account);
    const set = name ? this.store.privilegeSet(name) : undefined;
    if (set && isFullAccess(set)) {
      throw new ScimError(403, `"${account}" has full access, which only an admin can change; provisioning won't touch it`);
    }
  }

  /** Remove credentials owned by this person or delegated to them through a shared mapping. */
  private revokePersonTokens(account: string): void {
    const rows = this.store.sql.prepare('SELECT id, account, identity FROM _fm_api_tokens').all() as
      { id: string; account: string; identity: string | null }[];
    for (const row of rows) {
      if (row.account.toLowerCase() === account.toLowerCase()) {
        this.store.revokeApiToken(row.id);
        continue;
      }
      if (!row.identity) continue;
      // A malformed unrelated identity cannot hold this person's deprovisioning hostage.
      let identity: { person?: unknown };
      try { identity = JSON.parse(row.identity) as { person?: unknown }; }
      catch { continue; }
      if (typeof identity?.person === 'string' && identity.person.toLowerCase() === account.toLowerCase()) {
        this.store.revokeApiToken(row.id);
      }
    }
  }

  /**
   * Adds a person: a new external account named by their email, or an
   * existing external account of that exact name taken over. Anything else
   * already using the name (a password account, an agent, a file account, or
   * an account an admin gave full access) is a conflict, so provisioning never
   * takes over a sign-in someone already has.
   */
  create(m: UserModel): UserRow {
    const name = m.userName;
    const at = name.indexOf('@');
    if (at <= 0 || at === name.length - 1 || /\s/.test(name)) {
      throw new ScimError(400, 'userName must be the person\'s email address (name@domain)', 'invalidValue');
    }
    this.table();
    if (this.rows().some((r) => r.account.toLowerCase() === name.toLowerCase())) throw new ScimError(409, `A user named "${name}" already exists`, 'uniqueness');
    const existing = this.store.accounts().find((a) => a.name.toLowerCase() === name.toLowerCase());
    const fromFile = this.store.schema.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase());
    if (existing && (!existing.external || existing.hasPassword || existing.agent || fromFile)) {
      throw new ScimError(409, `"${existing.name}" is already an account with its own sign-in in this file; provisioning won't take it over`, 'uniqueness');
    }
    const existingSet = existing?.privilegeSet ? this.store.privilegeSet(existing.privilegeSet) : undefined;
    if (existingSet && isFullAccess(existingSet)) {
      throw new ScimError(409, `"${existing!.name}" has full access, which only an admin can change; provisioning won't take it over`, 'uniqueness');
    }
    const id = randomUUID();
    this.atomically('scim_user_create', () => {
      if (!existing) {
        this.store.addProvisionedAccount(name, SCIM_ACTOR);
        const def = this.defaultSet();
        if (def) this.store.setAccountPrivilegeSet(name, def, { by: SCIM_ACTOR });
      }
      const account = existing?.name ?? name;
      const now = new Date().toISOString();
      this.store.sql.prepare('INSERT INTO _fm_scim_users (id, account, external_id, attrs, groups, created, modified) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, account, m.externalId ?? null, JSON.stringify(attrsOf(m)), '[]', now, now);
      if (!m.active) {
        this.store.setAccountActive(account, false, { by: SCIM_ACTOR });
        this.revokePersonTokens(account);
      }
      else if (existing?.inactive) this.store.setAccountActive(account, true, { by: SCIM_ACTOR });
    });
    return this.row(id)!;
  }

  /** Saves a changed user; returns whether the account was just deactivated (its sessions should end). */
  update(r: UserRow, m: UserModel): boolean {
    if (m.userName.toLowerCase() !== r.account.toLowerCase()) {
      throw new ScimError(400, 'userName can\'t change: the account is named by it. Remove the user and add them again under the new name', 'mutability');
    }
    const wasActive = !this.store.accountInactive(r.account);
    if (wasActive !== m.active) this.guard(r.account);
    // A full-access account's tokens are not provisioning's to revoke either, even when an inactive one is merely edited.
    const revoke = !m.active && (wasActive || this.canTouch(r.account));
    this.atomically('scim_user_update', () => {
      this.store.sql.prepare('UPDATE _fm_scim_users SET external_id = ?, attrs = ?, modified = ? WHERE id = ?')
        .run(m.externalId ?? null, JSON.stringify(attrsOf(m)), new Date().toISOString(), r.id);
      if (wasActive !== m.active) this.store.setAccountActive(r.account, m.active, { by: SCIM_ACTOR });
      if (revoke) this.revokePersonTokens(r.account);
    });
    return wasActive && !m.active;
  }

  /**
   * Removes a person: their account is deactivated and loses its set, rather
   * than deleted, so their email domain or a group can't sign them in again
   * (an account named by their email that is off keeps them out). It is no
   * longer SCIM's; an admin can delete it, and adding them again takes it back.
   * The AI stand-ins kept for the account go too: they hold the real details its AI use touched, and a person
   * who is back only gets fresh ones.
   */
  remove(r: UserRow): void {
    this.guard(r.account);
    this.atomically('scim_user_remove', () => {
      if (!this.store.accountInactive(r.account)) this.store.setAccountActive(r.account, false, { by: SCIM_ACTOR });
      if (this.store.accountPrivilegeSet(r.account)) this.store.clearAccountPrivilegeSet(r.account, { by: SCIM_ACTOR });
      this.revokePersonTokens(r.account);
      this.store.forgetStandIns(r.account);
      this.store.sql.prepare('DELETE FROM _fm_scim_users WHERE id = ?').run(r.id);
    });
  }

  /** The set a group id names, when it's one a provider may use. */
  groupSet(id: string): string | undefined {
    let name: string;
    try {
      name = Buffer.from(id, 'base64url').toString('utf8');
    } catch {
      return undefined;
    }
    return groupId(name) === id ? this.groupSets().find((s) => s === name) : undefined;
  }

  group(set: string, location: string, withMembers = true, accounts?: Map<string, Account>): Record<string, unknown> {
    return {
      schemas: [GROUP],
      id: groupId(set),
      displayName: set,
      ...(withMembers ? { members: this.members(set, accounts).map((r) => ({ value: r.id, display: r.account, $ref: `${location}/Users/${r.id}` })) } : {}),
      meta: { resourceType: 'Group', location: `${location}/Groups/${groupId(set)}` },
    };
  }

  /** The users the provider put in this group. */
  members(set: string, accounts = this.accounts()): UserRow[] {
    return this.rows(accounts).filter((r) => this.memberships(r).includes(set));
  }

  /** The set a user's memberships give: the group added last that is still a group, else the default, else none. */
  private apply(r: UserRow): void {
    const groups = this.groupSets();
    const want = [...this.memberships(r)].reverse().find((g) => groups.includes(g)) ?? this.defaultSet();
    const has = this.store.accountPrivilegeSet(r.account);
    if (want === has) return;
    this.guard(r.account);
    if (want) this.store.setAccountPrivilegeSet(r.account, want, { by: SCIM_ACTOR });
    else this.store.clearAccountPrivilegeSet(r.account, { by: SCIM_ACTOR });
  }

  addMember(set: string, userId: string): void {
    const r = this.row(userId);
    if (!r) throw new ScimError(400, `No user with id "${userId}"`, 'invalidValue');
    this.guard(r.account);
    this.setMemberships(r, [...this.memberships(r).filter((g) => g !== set), set]);
    this.apply(r);
  }

  /** Takes the user out of the group: they get the set of another group they're in, else the default, else none. */
  removeMember(set: string, userId: string): void {
    const r = this.row(userId);
    if (!r || !this.memberships(r).includes(set)) return;
    this.guard(r.account);
    this.setMemberships(r, this.memberships(r).filter((g) => g !== set));
    this.apply(r);
  }

  /** Validates a member change without applying it. */
  checkMember(userId: string): void {
    const r = this.row(userId);
    if (!r) throw new ScimError(400, `No user with id "${userId}"`, 'invalidValue');
    this.guard(r.account);
  }

  /** Makes exactly these users the group's members. PATCH additions can also move an existing group to the end. */
  setMembers(set: string, userIds: string[], promoteIds: string[] = []): void {
    const rows = this.rows();
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of userIds) if (!byId.has(id)) throw new ScimError(400, `No user with id "${id}"`, 'invalidValue');
    const want = new Set(userIds);
    const promote = new Set(promoteIds);
    const current = rows.filter((r) => this.memberships(r).includes(set));
    // Check the entire replacement before the first grant or removal, including accounts
    // an administrator protected after SCIM created them.
    for (const id of want) if (!this.memberships(byId.get(id)!).includes(set) || promote.has(id)) this.guard(byId.get(id)!.account);
    for (const r of current) if (!want.has(r.id)) this.guard(r.account);

    try {
      this.atomically('scim_members', () => {
        for (const r of current) if (!want.has(r.id)) this.removeMember(set, r.id);
        for (const id of want) if (!this.memberships(byId.get(id)!).includes(set) || promote.has(id)) this.addMember(set, id);
      });
    } catch (e) {
      if (isBusy(e)) throw new ApiError(301, 'Record is in use by another user', 409);
      throw e;
    }
  }
}

function attrsOf(m: UserModel): Attrs {
  return {
    ...(m.displayName !== undefined ? { displayName: m.displayName } : {}),
    ...(m.name && Object.keys(m.name).length ? { name: m.name } : {}),
    ...(m.emails?.length ? { emails: m.emails } : {}),
  };
}

/** A user as a POST or PUT body describes it. */
function userFrom(body: Record<string, unknown>, keep?: UserModel): UserModel {
  const userName = str(body.userName) ?? keep?.userName;
  if (!userName) throw new ScimError(400, 'userName is required', 'invalidValue');
  const m: UserModel = { userName: userName.trim(), active: body.active === undefined ? keep?.active ?? true : bool(body.active, 'active') };
  if (body.externalId !== undefined && body.externalId !== null) m.externalId = String(body.externalId);
  if (typeof body.displayName === 'string') m.displayName = body.displayName;
  if (body.name && typeof body.name === 'object') m.name = cleanName(body.name as Record<string, unknown>);
  if (Array.isArray(body.emails)) m.emails = cleanEmails(body.emails);
  return m;
}

function cleanName(n: Record<string, unknown>): UserModel['name'] {
  const out: NonNullable<UserModel['name']> = {};
  for (const k of ['givenName', 'familyName', 'formatted'] as const) if (typeof n[k] === 'string') out[k] = n[k] as string;
  return out;
}

function cleanEmails(list: unknown[]): NonNullable<UserModel['emails']> {
  return list.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as Record<string, unknown>).value === 'string')
    .map((e) => ({ value: String(e.value), ...(typeof e.type === 'string' ? { type: e.type } : {}), ...(e.primary !== undefined ? { primary: bool(e.primary, 'primary') } : {}) }));
}

/** Applies a PatchOp's operations to a user (RFC 7644 3.5.2), Okta's and Entra's spellings alike. */
function patchUser(m: UserModel, ops: PatchOperation[]): UserModel {
  const out: UserModel = structuredClone(m);
  for (const op of ops) {
    const kind = op.op;
    const path = op.path;
    if (!path) {
      if (kind === 'remove') throw new ScimError(400, 'remove needs a path', 'noTarget');
      if (!op.value || typeof op.value !== 'object' || Array.isArray(op.value)) throw new ScimError(400, 'An operation without a path needs an object value', 'invalidValue');
      for (const [k, v] of Object.entries(op.value as Record<string, unknown>)) setUserAttr(out, k, v, kind);
      continue;
    }
    if (kind === 'remove') removeUserAttr(out, path);
    else setUserAttr(out, path, op.value, kind);
  }
  return out;
}

function setUserAttr(m: UserModel, path: string, v: unknown, kind: 'add' | 'replace'): void {
  const emailFilter = /^emails\[type eq "([^"]*)"\]\.value$/i.exec(path);
  if (emailFilter) {
    const type = emailFilter[1];
    const emails = m.emails ?? [];
    const hit = emails.find((e) => (e.type ?? '').toLowerCase() === type.toLowerCase());
    if (hit) hit.value = String(v);
    else emails.push({ value: String(v), type });
    m.emails = emails;
    return;
  }
  const key = path.replace(/^urn:ietf:params:scim:schemas:core:2\.0:User:/i, '');
  switch (key.toLowerCase()) {
    case 'username': if (typeof v !== 'string') throw new ScimError(400, 'userName must be a string', 'invalidValue'); m.userName = v.trim(); return;
    case 'active': m.active = bool(v, 'active'); return;
    case 'externalid': m.externalId = v === null ? undefined : String(v); return;
    case 'displayname': m.displayName = v === null ? undefined : String(v); return;
    case 'name':
      if (!v || typeof v !== 'object') throw new ScimError(400, 'name must be an object', 'invalidValue');
      m.name = kind === 'add' ? { ...m.name, ...cleanName(v as Record<string, unknown>) } : cleanName(v as Record<string, unknown>);
      return;
    case 'name.givenname': case 'name.familyname': case 'name.formatted': {
      const field = ({ 'name.givenname': 'givenName', 'name.familyname': 'familyName', 'name.formatted': 'formatted' } as const)[key.toLowerCase() as 'name.givenname'];
      m.name = { ...m.name, [field]: String(v) };
      return;
    }
    case 'emails': {
      const list = cleanEmails(Array.isArray(v) ? v : [v]);
      m.emails = kind === 'add' ? [...(m.emails ?? []).filter((e) => !list.some((n) => n.value.toLowerCase() === e.value.toLowerCase())), ...list] : list;
      return;
    }
    // Attributes the file doesn't keep (phone numbers, titles, the enterprise extension) are accepted and dropped,
    // as providers send them whether or not they are mapped.
    default: return;
  }
}

function removeUserAttr(m: UserModel, path: string): void {
  const key = path.replace(/^urn:ietf:params:scim:schemas:core:2\.0:User:/i, '').toLowerCase();
  if (key === 'username') throw new ScimError(400, 'userName is required', 'mutability');
  if (key === 'active') m.active = false;
  else if (key === 'externalid') m.externalId = undefined;
  else if (key === 'displayname') m.displayName = undefined;
  else if (key === 'name') m.name = undefined;
  else if (key.startsWith('name.') && m.name) {
    const sub = key.slice(5);
    m.name = Object.fromEntries(Object.entries(m.name).filter(([k]) => k.toLowerCase() !== sub));
  } else if (key === 'emails') m.emails = undefined;
}

interface PatchOperation { op: 'add' | 'replace' | 'remove'; path?: string; value?: unknown }

function patchOps(body: Record<string, unknown>): PatchOperation[] {
  const ops = body.Operations ?? body.operations;
  if (!Array.isArray(ops) || !ops.length) throw new ScimError(400, 'A PATCH needs Operations', 'invalidSyntax');
  return ops.map((o: Record<string, unknown>) => {
    const op = String(o?.op ?? '').toLowerCase();
    if (op !== 'add' && op !== 'replace' && op !== 'remove') throw new ScimError(400, `Unknown operation "${o?.op}"`, 'invalidSyntax');
    return { op, ...(typeof o['path'] === 'string' && o['path'] ? { path: o['path'] } : {}), ...('value' in o ? { value: o.value } : {}) };
  });
}

/** A request body that must be a JSON object. */
async function objectBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readJson(req) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ScimError(400, 'The body must be a JSON object', 'invalidSyntax');
  return body as Record<string, unknown>;
}

/** `attr eq "value"`: the filters providers send to look someone up before adding them. */
function parseFilter(filter: string | null): { attr: string; value: string } | undefined {
  if (!filter) return undefined;
  const m = /^\s*([\w.:]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!m) throw new ScimError(400, `Unsupported filter "${filter}": only attribute eq "value"`, 'invalidFilter');
  return { attr: m[1].replace(/^urn:ietf:params:scim:schemas:core:2\.0:(User|Group):/i, '').toLowerCase(), value: m[2].replace(/\\(.)/g, '$1') };
}

/** The member ids in a group operation's value: [{value}] or {members: [{value}]}. */
function memberIds(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as Record<string, unknown>).members) ? (v as Record<string, unknown>).members as unknown[] : v === undefined || v === null ? [] : [v];
  return list.map((x) => (x && typeof x === 'object' ? String((x as Record<string, unknown>).value ?? '') : String(x))).filter(Boolean);
}

/** Answers the SCIM protocol for hosted files. */
export class ScimEndpoint {
  private readonly host: Host;
  private readonly api: DataApi;

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
  }

  /** Returns false when the request is not for SCIM. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/scim\/v2\/databases\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/.exec(url.pathname);
    if (!m) return false;
    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'cache-control': 'no-store', ...(body === undefined ? {} : { 'content-type': 'application/scim+json; charset=utf-8' }), ...headers });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    try {
      const wanted = decodeURIComponent(m[1]);
      const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
      const store = name ? this.host.get(name) : undefined;
      // The same answer for an unknown file as for a bad token, so the endpoint doesn't say which files are hosted.
      const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
      const dir = store ? new ScimDirectory(store) : undefined;
      if (!store || !dir || !token || !dir.tokenValid(token)) {
        throw new ScimError(401, 'Sign in with this file\'s provisioning token (Authorization: Bearer ...)');
      }
      const location = `${origin(req)}/tabularius/scim/v2/databases/${encodeURIComponent(store.name)}`;
      const resource = m[2] ?? '';
      const id = m[3] === undefined ? undefined : decodeURIComponent(m[3]);
      if (resource === 'ServiceProviderConfig' && req.method === 'GET' && !id) return send(200, serviceProviderConfig(location)), true;
      if (resource === 'ResourceTypes' && req.method === 'GET') return send(200, resourceTypes(location, id)), true;
      if (resource === 'Schemas' && req.method === 'GET') return send(200, schemas(id)), true;
      if (resource === 'Users') await this.users(req, url, dir, location, id, send);
      else if (resource === 'Groups') await this.groups(req, url, dir, location, id, send);
      else throw new ScimError(404, `No resource "${resource}"`);
    } catch (e) {
      const status = e instanceof ScimError ? e.status : e instanceof ApiError ? e.status : e instanceof StoreError || e instanceof URIError ? 400 : 500;
      send(status, { schemas: [ERROR], status: String(status), ...(e instanceof ScimError && e.scimType ? { scimType: e.scimType } : {}), detail: (e as Error).message },
        status === 401 ? { 'www-authenticate': 'Bearer realm="tabularius SCIM"' } : {});
    }
    return true;
  }

  private async users(req: IncomingMessage, url: URL, dir: ScimDirectory, location: string, id: string | undefined, send: (s: number, b?: unknown, h?: Record<string, string>) => void): Promise<void> {
    if (id === undefined) {
      if (req.method === 'GET') {
        const f = parseFilter(url.searchParams.get('filter'));
        const accounts = dir.accounts();
        let rows = dir.rows(accounts);
        if (f) {
          if (f.attr === 'username') rows = rows.filter((r) => r.account.toLowerCase() === f.value.toLowerCase());
          else if (f.attr === 'externalid') rows = rows.filter((r) => r.external_id === f.value);
          else if (f.attr === 'id') rows = rows.filter((r) => r.id === f.value);
          else if (f.attr === 'emails.value' || f.attr === 'emails') rows = rows.filter((r) => dir.model(r, accounts).emails?.some((e) => e.value.toLowerCase() === f.value.toLowerCase()));
          else throw new ScimError(400, `Can't filter users by "${f.attr}"`, 'invalidFilter');
        }
        const groups = dir.groupSets();
        return send(200, page(url, rows.map((r) => dir.user(r, location, accounts, groups))));
      }
      if (req.method === 'POST') {
        const model = userFrom(await objectBody(req));
        const r = dir.create(model);
        if (!model.active) this.api.endByAccount(dir.store.name, r.account);
        const body = dir.user(r, location);
        return send(201, body, { location: (body.meta as { location: string }).location });
      }
      throw new ScimError(405, 'Use GET or POST on Users');
    }
    const r = dir.row(id);
    if (!r) throw new ScimError(404, `No user with id "${id}"`);
    if (req.method === 'GET') return send(200, dir.user(r, location));
    if (req.method === 'PUT' || req.method === 'PATCH') {
      const body = await objectBody(req);
      const now = dir.model(r);
      const next = req.method === 'PUT' ? userFrom(body, { ...now, displayName: undefined, name: undefined, emails: undefined, externalId: undefined }) : patchUser(now, patchOps(body));
      if (dir.update(r, next)) this.api.endByAccount(dir.store.name, r.account);
      return send(200, dir.user(dir.row(id)!, location));
    }
    if (req.method === 'DELETE') {
      dir.remove(r);
      this.api.endByAccount(dir.store.name, r.account);
      return send(204);
    }
    throw new ScimError(405, 'Use GET, PUT, PATCH or DELETE on a user');
  }

  private async groups(req: IncomingMessage, url: URL, dir: ScimDirectory, location: string, id: string | undefined, send: (s: number, b?: unknown, h?: Record<string, string>) => void): Promise<void> {
    const withMembers = !/\bmembers\b/i.test(url.searchParams.get('excludedAttributes') ?? '');
    if (id === undefined) {
      if (req.method === 'GET') {
        const f = parseFilter(url.searchParams.get('filter'));
        let sets = dir.groupSets();
        if (f) {
          if (f.attr === 'displayname') sets = sets.filter((s) => s.toLowerCase() === f.value.toLowerCase());
          else if (f.attr === 'id') sets = sets.filter((s) => groupId(s) === f.value);
          else throw new ScimError(400, `Can't filter groups by "${f.attr}"`, 'invalidFilter');
        }
        const accounts = withMembers ? dir.accounts() : undefined;
        return send(200, page(url, sets.map((s) => dir.group(s, location, withMembers, accounts))));
      }
      if (req.method === 'POST') {
        // Groups are the file's privilege sets: "creating" one links to the set of that name.
        const body = await objectBody(req);
        const wanted = str(body.displayName) ?? '';
        const set = dir.groupSets().find((s) => s.toLowerCase() === wanted.toLowerCase());
        if (!set) {
          const full = dir.store.privilegeSets().find((p) => p.name.toLowerCase() === wanted.toLowerCase());
          throw new ScimError(400, full
            ? `"${full.name}" has full access, which an identity provider can't hand out`
            : `This file has no privilege set named "${wanted}". Groups are privilege sets: make the set in Manage Security first, or push the group under a set's name`, 'invalidValue');
        }
        if (body.members !== undefined) dir.setMembers(set, memberIds(body.members));
        const g = dir.group(set, location);
        return send(201, g, { location: (g.meta as { location: string }).location });
      }
      throw new ScimError(405, 'Use GET or POST on Groups');
    }
    const set = dir.groupSet(id);
    if (!set) throw new ScimError(404, `No group with id "${id}"`);
    if (req.method === 'GET') return send(200, dir.group(set, location, withMembers));
    if (req.method === 'PUT') {
      const body = await objectBody(req);
      if (typeof body.displayName === 'string' && body.displayName.toLowerCase() !== set.toLowerCase()) {
        throw new ScimError(400, 'A group is a privilege set and can\'t be renamed here; rename the set in Manage Security', 'mutability');
      }
      dir.setMembers(set, memberIds(body.members));
      return send(200, dir.group(set, location));
    }
    if (req.method === 'PATCH') {
      let ids = dir.members(set).map((r) => r.id);
      const promote = new Set<string>();
      const touched = new Set<string>();
      let changeMembers = false;
      for (const op of patchOps(await objectBody(req))) {
        const path = op.path ?? '';
        const one = /^members\[value eq "([^"]+)"\]$/i.exec(path);
        if (one && op.op === 'remove') {
          if (ids.includes(one[1])) touched.add(one[1]);
          ids = ids.filter((id) => id !== one[1]);
          promote.delete(one[1]);
          changeMembers = true;
        }
        else if (/^members$/i.test(path)) {
          const members = memberIds(op.value);
          if (op.op === 'add') for (const u of members) {
            touched.add(u);
            if (!ids.includes(u)) ids.push(u);
            promote.add(u);
          }
          else if (op.op === 'remove') {
            // No value removes everyone (RFC 7644 3.5.2.2); Entra names whom in the value.
            for (const id of ids) if (op.value === undefined || members.includes(id)) touched.add(id);
            ids = op.value === undefined ? [] : ids.filter((id) => !members.includes(id));
            for (const u of members) promote.delete(u);
            if (op.value === undefined) promote.clear();
          } else {
            for (const id of ids) if (!members.includes(id)) touched.add(id);
            for (const id of members) if (!ids.includes(id)) touched.add(id);
            ids = members;
            promote.clear();
          }
          changeMembers = true;
        } else if (!path && op.value && typeof op.value === 'object') {
          const v = op.value as Record<string, unknown>;
          if (typeof v.displayName === 'string' && v.displayName.toLowerCase() !== set.toLowerCase()) {
            throw new ScimError(400, 'A group is a privilege set and can\'t be renamed here', 'mutability');
          }
          if (v.members !== undefined) {
            const members = memberIds(v.members);
            if (op.op === 'add') for (const u of members) {
              touched.add(u);
              if (!ids.includes(u)) ids.push(u);
              promote.add(u);
            }
            else {
              for (const id of ids) if (!members.includes(id)) touched.add(id);
              for (const id of members) if (!ids.includes(id)) touched.add(id);
              ids = members;
              promote.clear();
            }
            changeMembers = true;
          }
        } else if (/^displayName$/i.test(path)) {
          if (String(op.value ?? '').toLowerCase() !== set.toLowerCase()) throw new ScimError(400, 'A group is a privilege set and can\'t be renamed here', 'mutability');
        } else if (/^externalId$/i.test(path)) {
          // Providers set their own id on a group; nothing in the file keeps it.
        } else throw new ScimError(400, `Can't change "${path}" on a group`, 'invalidPath');
      }
      for (const id of touched) dir.checkMember(id);
      if (changeMembers) dir.setMembers(set, ids, [...promote]);
      return send(200, dir.group(set, location, withMembers));
    }
    if (req.method === 'DELETE') {
      // The privilege set stays; the people SCIM gave it to lose it.
      for (const r of dir.members(set)) dir.removeMember(set, r.id);
      return send(204);
    }
    throw new ScimError(405, 'Use GET, PUT, PATCH or DELETE on a group');
  }
}

function origin(req: IncomingMessage): string {
  const secure = !!(req.socket as { encrypted?: boolean }).encrypted;
  return `${secure ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`;
}

function page(url: URL, all: Record<string, unknown>[]): Record<string, unknown> {
  const start = Math.max(1, Number(url.searchParams.get('startIndex')) || 1);
  const countParam = url.searchParams.get('count');
  const count = countParam === null ? MAX_COUNT : Math.min(MAX_COUNT, Math.max(0, Number(countParam) || 0));
  const items = all.slice(start - 1, start - 1 + count);
  return { schemas: [LIST], totalResults: all.length, startIndex: start, itemsPerPage: items.length, Resources: items };
}

function serviceProviderConfig(location: string): Record<string, unknown> {
  return {
    schemas: [SPC],
    documentationUri: 'https://github.com/sitotisai/tabularius/blob/main/ADMIN.md#provisioning-accounts-from-an-identity-provider-scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: MAX_COUNT },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Provisioning token', description: 'The file\'s provisioning token, from the admin console', primary: true }],
    meta: { resourceType: 'ServiceProviderConfig', location: `${location}/ServiceProviderConfig` },
  };
}

function resourceTypes(location: string, id?: string): Record<string, unknown> {
  const types = [
    { schemas: [RESOURCE_TYPE], id: 'User', name: 'User', endpoint: '/Users', schema: USER, meta: { resourceType: 'ResourceType', location: `${location}/ResourceTypes/User` } },
    { schemas: [RESOURCE_TYPE], id: 'Group', name: 'Group', endpoint: '/Groups', schema: GROUP, meta: { resourceType: 'ResourceType', location: `${location}/ResourceTypes/Group` } },
  ];
  if (id) {
    const t = types.find((x) => x.id === id);
    if (!t) throw new ScimError(404, `No resource type "${id}"`);
    return t;
  }
  return { schemas: [LIST], totalResults: types.length, startIndex: 1, itemsPerPage: types.length, Resources: types };
}

function attr(name: string, type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, type, multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', ...extra };
}

function schemas(id?: string): Record<string, unknown> {
  const all = [
    {
      schemas: [SCHEMA], id: USER, name: 'User', description: 'One person: an external account in the file, named by their email',
      attributes: [
        attr('userName', 'string', { required: true, uniqueness: 'server', mutability: 'immutable' }),
        attr('displayName', 'string'),
        attr('name', 'complex', { subAttributes: [attr('givenName', 'string'), attr('familyName', 'string'), attr('formatted', 'string')] }),
        attr('emails', 'complex', { multiValued: true, subAttributes: [attr('value', 'string'), attr('type', 'string'), attr('primary', 'boolean')] }),
        attr('active', 'boolean'),
        attr('groups', 'complex', { multiValued: true, mutability: 'readOnly', subAttributes: [attr('value', 'string'), attr('display', 'string')] }),
      ],
    },
    {
      schemas: [SCHEMA], id: GROUP, name: 'Group', description: 'A privilege set of the file (never full access)',
      attributes: [
        attr('displayName', 'string', { required: true, uniqueness: 'server', mutability: 'immutable' }),
        attr('members', 'complex', { multiValued: true, subAttributes: [attr('value', 'string', { mutability: 'immutable' }), attr('display', 'string', { mutability: 'readOnly' })] }),
      ],
    },
  ];
  if (id) {
    const s = all.find((x) => x.id === id);
    if (!s) throw new ScimError(404, `No schema "${id}"`);
    return s;
  }
  return { schemas: [LIST], totalResults: all.length, startIndex: 1, itemsPerPage: all.length, Resources: all };
}

/**
 * The admin side: turning provisioning on for a file (a token, shown once),
 * off, and the set new people get. Called from the admin console's handler,
 * which has already checked the admin is signed in.
 *
 *   GET    /tabularius/admin/v1/scim?database=           whether it's on, since when, the default set, users, the URL to give the provider
 *   POST   /tabularius/admin/v1/scim/token               { database, defaultPrivilegeSet? }: a new token (the old one stops working)
 *   DELETE /tabularius/admin/v1/scim/token?database=     turn provisioning off (accounts it made stay)
 *   POST   /tabularius/admin/v1/scim/settings            { database, defaultPrivilegeSet: name | null }
 */
export async function scimAdmin(host: Host, req: IncomingMessage, url: URL, send: (status: number, body: unknown) => void): Promise<boolean> {
  const path = url.pathname;
  if (path !== '/tabularius/admin/v1/scim' && !path.startsWith('/tabularius/admin/v1/scim/')) return false;
  const body = req.method === 'POST' ? (await readJson(req) ?? {}) as Record<string, unknown> : {};
  const wanted = String(body.database ?? url.searchParams.get('database') ?? '');
  const name = host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
  const store = name ? host.get(name) : undefined;
  if (!store) return send(404, { error: `"${wanted}" is not hosted` }), true;
  const dir = new ScimDirectory(store);
  const status = () => {
    const s = dir.settings();
    return {
      database: store.name, ...dir.tokenStatus(), ...(s.issued ? { issued: s.issued } : {}),
      ...(s.defaultPrivilegeSet ? { defaultPrivilegeSet: s.defaultPrivilegeSet } : {}),
      path: `/tabularius/scim/v2/databases/${encodeURIComponent(store.name)}`,
      users: dir.userCount(), privilegeSets: dir.groupSets(),
    };
  };
  try {
    if (path === '/tabularius/admin/v1/scim' && req.method === 'GET') send(200, status());
    else if (path === '/tabularius/admin/v1/scim/token' && req.method === 'POST') {
      const def = body.defaultPrivilegeSet;
      const token = dir.issueToken({ ...(def === undefined || def === '' ? {} : { defaultPrivilegeSet: def === null ? null : String(def) }), days: body.days === '' ? undefined : body.days });
      send(200, { ...status(), token });
    } else if (path === '/tabularius/admin/v1/scim/token' && req.method === 'DELETE') {
      const revoked = dir.revokeToken();
      send(200, { ...status(), revoked });
    }
    else if (path === '/tabularius/admin/v1/scim/settings' && req.method === 'POST') {
      const def = body.defaultPrivilegeSet;
      dir.setDefaultPrivilegeSet(def === null || def === '' || def === undefined ? null : String(def));
      send(200, status());
    } else return false;
  } catch (e) {
    send(400, { error: (e as Error).message });
  }
  return true;
}
