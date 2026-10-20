import { clientAddress } from './client-address.ts';
import { auditCsvField } from '../../store/src/audit-output.ts';
// The admin console, like FileMaker Server's: who is connected, records
// being edited, hosted files, backups.
//
//   GET  /admin/                                   the console page
//   GET  /tabularius/admin/v1/status                 everything the page shows
//   GET  /tabularius/admin/v1/metrics                Prometheus metrics (metrics.ts)
//   POST /tabularius/admin/v1/backup                 back up now (409 if it was stopped)
//   POST /tabularius/admin/v1/backup-folder          {folder}: where backups go (saved; "" for the default)
//   POST /tabularius/admin/v1/backup/stop            stop the backups running or waiting; the set being made is removed
//   POST /tabularius/admin/v1/notifications         {to, level}: email errors (or warnings too) to one address as a digest; empty to turns it off
//   POST /tabularius/admin/v1/notifications/test    send a test message now
//   POST /tabularius/admin/v1/session-timeout        {minutes}: how long a Data API or web client session may sit idle (1 to 1440; 15 by default)
//   POST /tabularius/admin/v1/clients/{id}/disconnect   end a session (releases its locks)
//   POST /tabularius/admin/v1/clients/{id}/message      show a message to one connected web client { text }
//   POST /tabularius/admin/v1/message                   show a message to every connected web client { text }
//   GET  /tabularius/admin/v1/schedules              script schedules, with their next and last runs
//   POST /tabularius/admin/v1/schedules              add one: { name, database, script, parameter,
//                                                    account, everyMinutes, at, onOpen, enabled, network }
//   PATCH /tabularius/admin/v1/schedules/{id}        change some of those
//   DELETE /tabularius/admin/v1/schedules/{id}
//   POST /tabularius/admin/v1/schedules/{id}/run     run it now
//   GET  /tabularius/admin/v1/schedules/{id}/runs    its recent runs, newest first
//   GET  /tabularius/admin/v1/server-scripts          server-side scripts running and waiting (Perform Script on Server,
//                                                    schedules, automations, inbound hooks) and the last 100 runs
//   POST /tabularius/admin/v1/server-scripts/{id}/cancel   a waiting one never starts; a running one stops at its next step
//   .../uploads                                    host an .fmp12 sent from the browser (uploads.ts)
//   GET  /tabularius/admin/v1/audit                   the audit log of a file: ?database=&security=&account=&table=&kind=&since=&until=&limit=&format=csv
//   GET  /tabularius/admin/v1/security-events/verify local security-chain consistency: ?database=
//   POST /tabularius/admin/v1/records/restore         {database, table, recordId, seq}: a record put back as it was after that audit entry
//   GET  /tabularius/admin/v1/view-as                 preview a layout as a privilege set sees it: ?database=&privilegeSet=&layout=&limit=
//   GET  /tabularius/admin/v1/access                  what an account or set can open and change, with reasons: ?database=&account= or &privilegeSet=
//   GET  /tabularius/admin/v1/test-account             sign in as an account on paper: every layout/script it can use, and what a runnable script would hit: ?database=&account=
//   GET  /tabularius/admin/v1/access-review            "who can do what" audit export, one row per account per table: ?database=&unusedDays=&format=csv
//   GET  /tabularius/admin/v1/plugin-readiness        what a file's plug-in calls will do here, with counts and what to use instead: ?database=&format=csv
//   GET  /tabularius/admin/v1/compare                 plain-English diff of two privilege sets: ?database=&a=&b= (sets for the picker when no pair)
//   GET  /tabularius/admin/v1/sso-mapping             which privilege set an SSO group/email/domain gets: ?database=
//   POST /tabularius/admin/v1/sso-mapping             add or change one: { database, name, privilegeSet }
//   DELETE /tabularius/admin/v1/sso-mapping/{name}    remove one: ?database=
//   GET|POST|DELETE /tabularius/admin/v1/scim[/token|/settings]   provisioning from an identity provider (SCIM): see scim.ts
//   GET  /tabularius/admin/v1/sso-mapping/test        which mapping an email/groups would resolve to, and what it can do:
//                                                    ?database=&email=&groups=a,b,c
//   GET  /tabularius/admin/v1/field-access            a privilege set's per-field access on a table: ?database=&privilegeSet=&table=
//   POST /tabularius/admin/v1/field-access            change one: { database, privilegeSet, table, field, access }
//   GET  /tabularius/admin/v1/least-privilege          write grants and ways in (extended privileges) a set holds but hasn't used in ?unusedDays= days (default 30): ?database=
//   GET  /tabularius/admin/v1/who-can                 which accounts can see / change a table or field, in plain words: ?database=&table=[&field=]
//   GET  /tabularius/admin/v1/usage                   what each account has done: requests by surface, days active, sign-ins: ?database=&days=
//   GET  /tabularius/admin/v1/health                  security health report: ?database=&unusedDays= (every hosted file when no database)
//   POST /tabularius/admin/v1/health/revoke-token      one-click fix: { database, id } revokes an API token
//   POST /tabularius/admin/v1/health/fix-account       one-click fix for an empty-password account:
//                                                     { database, account, action: "set-temp-password" | "deactivate" }
//   POST /tabularius/admin/v1/accounts/set-password     { database, account, password, mustChange? }: a password for any account, no Terminal needed
//   POST /tabularius/admin/v1/accounts/unlock            { database, account } or { database, address }: lifts a sign-in lockout
//                                                     on an account, or on an address blocked for too many failures
//   POST /tabularius/admin/v1/accounts/migrate-all       { database }: a one-time temporary password (forced change) for
//                                                     every account still stuck on its FileMaker password — blank or not
//   GET|POST /tabularius/admin/v1/accounts/blank-password-lan   ?database= / { database, on }: per-file opt-in to let an
//                                                     empty-password account sign in from this LAN, not only this computer
//   GET  /tabularius/admin/v1/sessions                who is signed in (who, where, device, idle): ?database= to one file
//   POST /tabularius/admin/v1/sessions/end            sign out { id } one session, or every one for { database, account }
//   GET  /tabularius/admin/v1/profile                 the slowest scripts and their slowest steps (DELETE resets)
//   GET  /tabularius/admin/v1/optimization/{db}       ways to make a file smaller and faster (container files kept inside it,
//                                                   sorts no index serves, things nothing uses), changing nothing
//   POST /tabularius/admin/v1/optimization/{db}/fix   { fix, items?, count?, preview? }: one fix from the report (hide or remove what nothing
//                                                   uses, store a calculation); preview: true lists what it would do and changes nothing
//   POST /tabularius/admin/v1/optimization/{db}/undo  { id? }: puts the latest fix (or the one with that id) back
//   GET  /tabularius/admin/v1/profile/finds           slow finds (?database=), each with indexes to add and hints
//   GET  /tabularius/admin/v1/script-tests             each hosted file's saved script test cases, counted per script
//   POST /tabularius/admin/v1/script-tests/run         { database }: runs all of that file's cases offline on a throwaway
//                                                    copy (the hosted file never changes); pass or fail per script
//   POST /tabularius/admin/v1/indexes                 { database, table, field }: adds an index on a stored field
//   GET/POST /tabularius/admin/v1/optimization/{db}/containers[/undo]  the moves of container files out to managed external
//                                                    storage that can be undone; POST { table, field, preview?, expect? } makes one, { id } undoes one
//   GET  /tabularius/admin/v1/solution-map            the cross-file dependency graph across every hosted file
//   GET  /tabularius/admin/v1/restore                 how far back each file can be put back
//   POST /tabularius/admin/v1/restore                 { database, at, mode: "replace" | "copy", name }: put a file
//                                                    back as it was at a moment, in place or as a new file
//   POST /tabularius/admin/v1/backups/{set}/verify     check a backup set again now (backup-verify.ts)
//   POST /tabularius/admin/v1/files/{name}/reconvert-preview   what converting again would change (a dry run)
//   POST /tabularius/admin/v1/locked/{file}/unlock     {passphrase}: hosts a dropped-in .fmp12 that uses Encryption at
//                                                     Rest; the passphrase is used for that conversion only, never kept
//   (reconvert and reconvert-preview take {passphrase} too, for such a file)
//   GET|POST /tabularius/admin/v1/ai-access/{name}      whether AI may read the file; {"on": false} keeps it from AI
//   POST /tabularius/admin/v1/solutions/plan          {name, description}: the assistant plans a new file (solution-builder.ts; creates nothing)
//   POST /tabularius/admin/v1/solutions               {name, changes, password?}: create it from the plan, all or nothing
//   GET  /tabularius/admin/v1/ai-usage                 the assistant's tokens and approximate cost: today, this month against
//                                                    its budget, and the latest questions (model, time, tokens, cost)
//   POST /tabularius/admin/v1/reconvert-all            {"preview": true} dry-runs every outdated file; {"files": [...]} converts them
//   POST /tabularius/admin/v1/backups/{set}/test-restore   restore a set to a scratch folder and open it, as a test
//   GET  /tabularius/admin/v1/logs                    the server's logs and their sizes (server-logs.ts)
//   GET  /tabularius/admin/v1/logs/{name}?from=&to=&type=&q=&limit=
//                                                    a log's entries, newest first, filtered
//   GET  /tabularius/admin/v1/logs/{name}/download[?old=1]   the log file itself (or its older half)
//   GET  /tabularius/admin/v1/plugins                 the server's plug-ins: who made them, what they ask for, which files have them on,
//                                                    and which secrets are set (never the values)
//   POST /tabularius/admin/v1/plugins/{id}/enable     {file}: turn one on for a hosted file now (and for the next start); /disable the same.
//                                                    The packs inside Tabularius (BaseElements) are on until turned off, and give "?" for a file they are off for
//   PUT  /tabularius/admin/v1/plugins/{id}/secrets/{NAME}   {value}: set a secret the plug-in asked for; DELETE clears it
//   GET  /tabularius/admin/v1/connections             the outside services scripts and tools use by name (S3-compatible storage), and which
//                                                    of their secrets are set (never the values); POST makes one, PATCH/DELETE /{id} change it,
//                                                    PUT/DELETE /{id}/secrets/{field} set and clear a secret, POST /{id}/approve a draft, /{id}/test
//   GET  /tabularius/admin/v1/outbox                  outbound test mode: captured mail and web requests, newest first
//   GET  /tabularius/admin/v1/outbox/{id}             one of them, with its attachments (base64)
//   DELETE /tabularius/admin/v1/outbox                empty it
//   GET  /tabularius/admin/v1/mcp                     tokens for AI apps, and each file's accounts, privilege sets and layouts
//   POST /tabularius/admin/v1/mcp/tokens              { database, account | agent: {name, privilegeSet, needsApproval}, label, days,
//                                                     readOnly, layouts }: a new API token for AI apps (fmmcp), shown once
//   DELETE /tabularius/admin/v1/mcp/tokens/{id}       revoke one
//   GET  /tabularius/admin/v1/passkeys                 the console's registered passkeys (never the key material)
//   POST /tabularius/admin/v1/passkeys/register/options   a registration challenge
//   POST /tabularius/admin/v1/passkeys/register        { response, label? }: verify and store a new one
//   DELETE /tabularius/admin/v1/passkeys/{id}          remove one
//   POST /tabularius/admin/v1/passkey-sign-in           open to everyone (like /sign-in): with no body, a
//                                                     challenge and every registered credential id; with
//                                                     { response }, verify it and sign the console in
//
// Access: the admin password set with `tabularius admin-password <folder>`
// (HTTP Basic, any user name). Without one, only this machine (loopback) may
// use the console. POSTs, PATCHes and DELETEs need the header `x-tabularius-admin: 1`, which a page
// on another site can't send, so a browser's saved login can't be used
// against the console from elsewhere.

import { expiryClock } from '../../store/src/clock.ts';
import { AUTH_BODY_LIMIT } from './request-body.ts';
import { IdentityInFlight, busyHeaders } from './in-flight.ts';
import { directFromThisComputer, hasTrustedClientAddress, UNKNOWN_CLIENT } from './client-address.ts';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { hashPassword, checkPassword, addressBucket, StoreError, findStaleCalcs, refreshStaleCalcs, undoStaleRefresh, staleRefreshHistory, StaleCalcError, SECURITY_EVENT_CATEGORIES, isFullAccess, type AuditEntry, type FieldLevel, type SecurityEvent, type Store } from '../../store/src/index.ts';
import { loadAsset, sendAsset } from './static-cache.ts';
import type { DataApi } from './dataapi.ts';
import type { Live } from './live.ts';
import { accessReview, accessReviewCsv } from './access-review.ts';
import { pluginReadiness, pluginReadinessCsv } from './plugin-readiness.ts';
import { reviewPrivileges } from './privilege-review.ts';
import { findAdvice } from './find-advice.ts';
import { optimizationReport } from './optimization.ts';
import { applyFix, FIXES, FixError, previewFix, undoFix, type FixId } from './optimization-fix.ts';
import { containerMoves, moveContainersToManagedStorage, undoContainerMove } from './optimization-containers.ts';
import type { AiState } from './assistant.ts';
import { Digests, type DigestRunner } from './digests.ts';
import type { ConversionGuides } from './conversion-guide.ts';
import { forgetClasses, forgetVault, piiFile, piiPreview } from './pii.ts';
import { aiStatus } from './ai-access.ts';
import { solutionMap } from './solution-map.ts';
import { BUILTIN_PACKS, pluginStatus, setPluginEnabled, setPluginSecret } from '../../plugins/src/index.ts';
import type { Host } from './host.ts';
import { PassphraseNeeded, STORE_EXT } from './host.ts';
import { BackupStopped, backupFolder, backupKey, backupRunning, stopBackups, backupSets, defaultBackupDir, parseTime, restorePoint, restorePointTo, restoreRange, type BackupSchedule, type ProgressiveSchedule } from './backup.ts';
import { ENCRYPTED_EXT } from './encrypt.ts';
import { isLocalAdmin } from './local-admin.ts';
import { localAuthority } from './local-tls.ts';
import { describeCheck, describeRestore, lastCheck, lastRestore, testRestore, verifyAfterBackup, verifySet } from './backup-verify.ts';
import { LOGS, type LogName, type LogType, type ServerLogs } from './server-logs.ts';
import { hostedName } from './uploads.ts';
import { ApiError, lenient, readBoundedJson as readJson, webauthnEnv } from './dataapi.ts';
import { createSolution, solutionName, SolutionError } from './solution-builder.ts';
import type { Replication } from './replication.ts';
import type { CertificateState } from './acme.ts';
import type { OffsiteSchedule } from './s3.ts';
import { HookError, type InboundHooks } from './inbound-hooks.ts';
import { ScheduleError, type ScheduleInput, type Schedules } from './schedules.ts';
import { BackupFolderError, checkBackupFolder } from './backup-folder.ts';
import { SyncConsoleError, type ApplyRequest, type SyncConsole } from './sync-console.ts';
import type { Metrics } from './metrics.ts';
import { UploadError, type Uploads } from './uploads.ts';
import { WebhookError, type Webhooks } from './changes.ts';
import { ConnectionError, type Connections } from './connections.ts';
import type { Profiler } from './profiler.ts';
import type { McpTokens } from './mcp-tokens.ts';
import { whoCan } from './who-can.ts';
import { dropScratch, scratchCopy, SCRATCH_MAX_BYTES } from './debug.ts';
import { AdminPasskeyError, adminPasskeyIds, adminPasskeys, hasAdminPasskey, registerAdminPasskey, removeAdminPasskey, verifyAdminPasskeyAssertion } from './admin-passkey.ts';
import { runScriptTests } from '../../scripts/src/index.ts';
import { scimAdmin } from './scim.ts';
import { SecurityAuditVerifier, securityAuditVerifier } from './security-audit.ts';
import { csvField as safeCsvField } from '../../store/src/index.ts';
import { CertificateError } from './cert-import.ts';
import { FAULT_MESSAGE, logFaultFor } from './fault-log.ts';
import { SERVER_VERSION, serverCommit } from './version.ts';
import { said } from './said.ts';

const PASSWORD_FILE = '.openhbam-admin';

/** Only errors deliberately written for an administrator may cross this API boundary. */
function adminErrorText(e: unknown, scope: object): string {
  if (e instanceof StoreError || e instanceof ApiError || e instanceof RangeError || e instanceof SyntaxError || e instanceof URIError ||
      e instanceof CertificateError || e instanceof BackupFolderError || e instanceof BackupStopped || e instanceof PassphraseNeeded ||
      e instanceof StaleCalcError || e instanceof FixError || e instanceof RestoreError || e instanceof SolutionError ||
      e instanceof HookError || e instanceof ScheduleError || e instanceof SyncConsoleError || e instanceof UploadError ||
      e instanceof WebhookError || e instanceof ConnectionError || e instanceof AdminPasskeyError) return e.message;
  logFaultFor(scope)(e);
  return FAULT_MESSAGE;
}

/** Pending unauthenticated challenges. The global pool includes a reserve for known proxied IPv4 callers. */
export const ADMIN_LIMIT = { passkeyChallenges: 2000, passkeyChallengesProxyReserve: 100, passkeyChallengesPerAddress: 5, passkeyChallengesPer48: 50, passkeyChallengesUnknown: 100 };
/** Sent with every JSON answer, so a browser never reads one as anything else. */
const NOSNIFF = { 'x-content-type-options': 'nosniff' };
const PAGE = join(import.meta.dirname, '..', 'admin', 'index.html');

/** Canonical IPv4 or IPv6 /64, plus the IPv6 /48 that contains it. */
function passkeyChallengeBuckets(from: string): { address: string; prefix48?: string } {
  const ip = from.split('%')[0];
  if (isIP(ip) !== 6) return { address: addressBucket(ip) };
  // Normalize compressed/expanded spellings and mapped IPv4 before grouping a trusted proxy's address.
  const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return { address: [high >> 8, high & 255, low >> 8, low & 255].join('.') };
  }
  const address = addressBucket(canonical);
  return { address, prefix48: address.split(':').slice(0, 3).join(':') };
}

/** Known console paths have a stable method answer even when an optional service is disabled. */
function consoleMethods(path: string): string | undefined {
  const prefix = '/tabularius/admin/v1/';
  if (!path.startsWith(prefix)) return undefined;
  const name = path.slice(prefix.length);
  const get = new Set([
    'sign-in-info', 'status', 'metrics', 'backups', 'server-scripts', 'ai-usage', 'profile/finds',
    'script-tests', 'audit', 'audit/verify', 'security-events', 'security-events/verify',
    'view-as', 'access', 'test-account', 'compare', 'sso-mapping/test', 'access-review', 'plugin-readiness',
    'health', 'least-privilege', 'who-can', 'usage', 'unusual-access', 'solution-map', 'sessions',
    'passkeys', 'plugins',
  ]);
  const post = new Set([
    'sign-in', 'sign-out', 'passkey-sign-in', 'block-new-users', 'session-timeout', 'responsive',
    'notifications', 'notifications/test', 'passkeys/register/options', 'passkeys/register',
    'backup-folder', 'backup', 'backup/stop', 'relax-unverified', 'reconvert-all',
    'solutions/plan', 'solutions', 'indexes', 'script-tests/run', 'records/restore',
    'health/revoke-token', 'health/fix-account', 'accounts/set-password', 'accounts/unlock',
    'accounts/migrate-all', 'sessions/end', 'message',
  ]);
  if (get.has(name)) return 'GET';
  if (post.has(name)) return 'POST';
  const both: Record<string, string> = {
    'field-access': 'GET, POST', 'sso-mapping': 'GET, POST', 'accounts/blank-password-lan': 'GET, POST',
    'restore': 'GET, POST', 'profile': 'GET, DELETE', 'audit/settings': 'GET, PUT',
  };
  if (both[name]) return both[name];
  if (/^backups\/[^/]+\/(verify|test-restore)$/.test(name)) return 'POST';
  if (/^files\/[^/]+\/external-containers$/.test(name)) return 'GET';
  if (/^files\/[^/]+\/orphan-containers$/.test(name)) return 'GET, POST';
  if (/^files\/[^/]+\/reconvert(?:-preview)?$/.test(name) || /^locked\/[^/]+\/unlock$/.test(name)) return 'POST';
  if (/^server-scripts\/[\w-]+\/cancel$/.test(name)) return 'POST';
  if (name === 'schedules') return 'GET, POST';
  if (/^schedules\/[0-9a-f]+$/.test(name)) return 'PATCH, DELETE';
  if (/^schedules\/[0-9a-f]+\/run$/.test(name)) return 'POST';
  if (/^schedules\/[0-9a-f]+\/runs$/.test(name)) return 'GET';
  if (name === 'sync') return 'GET';
  if (/^sync\/[^/]+$/.test(name)) return 'GET, PUT, DELETE';
  if (/^sync\/[^/]+\/log$/.test(name)) return 'GET';
  if (/^sync\/[^/]+\/(check|apply)$/.test(name)) return 'POST';
  if (name === 'uploads' || name === 'webhooks' || name === 'inbound-hooks' || name === 'connections') return 'GET, POST';
  if (/^uploads\/[\w-]+\/finish$/.test(name)) return 'POST';
  if (/^uploads\/[\w-]+$/.test(name)) return 'PUT, GET, DELETE';
  if (/^webhooks\/[0-9a-f]+$/.test(name) || /^inbound-hooks\/[0-9a-f]+$/.test(name)) return 'PATCH, DELETE';
  if (/^inbound-hooks\/[0-9a-f]+\/secret$/.test(name)) return 'POST';
  if (/^connections\/[0-9a-f]+$/.test(name)) return 'GET, PATCH, DELETE';
  if (/^connections\/[0-9a-f]+\/(approve|test)$/.test(name)) return 'POST';
  if (/^connections\/[0-9a-f]+\/secrets\/[A-Za-z][A-Za-z0-9]*$/.test(name)) return 'PUT, DELETE';
  if (/^ai-access\/[^/]+$/.test(name) || /^pii\/[^/]+$/.test(name) || /^conversion-guide\/[^/]+$/.test(name)) return 'GET, POST';
  if (/^pii\/[^/]+\/field$/.test(name) || /^digests\/[^/]+\/[0-9a-f]{12}\/run$/.test(name)) return 'POST';
  if (name === 'digests') return 'GET';
  if (/^optimization\/[^/]+$/.test(name)) return 'GET';
  if (/^optimization\/[^/]+\/containers$/.test(name)) return 'GET, POST';
  if (/^optimization\/[^/]+\/(fix|undo|containers\/undo)$/.test(name)) return 'POST';
  if (/^sso-mapping\/[^/]+$/.test(name) || /^passkeys\/[^/]+$/.test(name) || /^mcp\/tokens\/[0-9a-f]+$/.test(name)) return 'DELETE';
  if (name === 'outbox') return 'GET, DELETE';
  if (/^outbox\/[0-9a-f]+$/.test(name)) return 'GET';
  if (name === 'mcp') return 'GET';
  if (name === 'mcp/tokens') return 'POST';
  if (/^plugins\/[^/]+\/(enable|disable)$/.test(name)) return 'POST';
  if (/^plugins\/[^/]+\/secrets\/[A-Z][A-Z0-9_]*$/.test(name)) return 'PUT, DELETE';
  if (/^clients\/[0-9a-f]+\/(disconnect|message)$/.test(name)) return 'POST';
  if (/^stale-calcs$/.test(name)) return 'GET';
  if (/^stale-calcs\/(refresh|undo)$/.test(name)) return 'POST';
  if (name === 'logs' || /^logs\/[^/]+(?:\/download)?$/.test(name)) return 'GET';
  return undefined;
}

/** A bounded whole-number query parameter; malformed values are never silently treated as defaults. */
function queryInteger(p: URLSearchParams, name: string, max: number, min = 1): number | undefined {
  const raw = p.get(name);
  if (raw === null || raw === '') return undefined;
  if (!/^\d+$/.test(raw)) throw new ApiError(960, `Parameter is invalid: ${name}`, 400);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new ApiError(960, `Parameter is invalid: ${name} is ${min} to ${max}`, 400);
  return value;
}

/** Sets the admin console password for a hosted folder. */
export function setAdminPassword(folder: string, password: string): void {
  writeFileSync(join(folder, PASSWORD_FILE), hashPassword(password) + '\n', { mode: 0o600 });
}

function size(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function dirSize(path: string): number {
  let n = 0;
  for (const f of readdirSync(path, { withFileTypes: true })) n += f.isDirectory() ? dirSize(join(path, f.name)) : size(join(path, f.name));
  return n;
}

/** One CSV field, quoted per RFC 4180 when it holds a comma, quote or newline. A leading =, +, - or @ is prefixed with ' so a spreadsheet won't run it as a formula. */
function csvField(value: unknown): string { return safeCsvField(value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)); }

/** The audit entries as CSV, one row per entry. Security events put their object in "target" and place in "from"; record changes put the table and record id. */
function auditCsv(entries: AuditEntry[]): string {
  const header = ['seq', 'at', 'account', 'kind', 'security', 'table', 'target', 'from', 'recordId', 'changes', 'surface', 'script', 'copyOf', 'revertOf'];
  const rows = entries.map((e) => [
    e.seq, e.at, e.account ?? '', e.kind, e.security ? 'yes' : '', e.table ?? '', e.target ?? '', e.from ?? '',
    e.recordId ?? '', e.changes ? JSON.stringify(e.changes) : '', e.surface ?? '', e.script ?? '', e.copyOf ?? '', e.revertOf ?? '',
  ].map(auditCsvField).join(','));
  return [[...header.map(auditCsvField)].join(','), ...rows].join('\r\n') + '\r\n';
}

/** The security events as CSV, one readable row per event. */
function securityEventsCsv(events: SecurityEvent[]): string {
  const header = ['seq', 'at', 'category', 'kind', 'severity', 'account', 'description', 'target', 'from', 'detail'];
  const rows = events.map((e) => [
    e.seq, e.at, e.category, e.kind, e.severity, e.account ?? '', e.description, e.target ?? '', e.from ?? '',
    e.changes ? JSON.stringify(e.changes) : '',
  ].map(auditCsvField).join(','));
  return [[...header.map(auditCsvField)].join(','), ...rows].join('\r\n') + '\r\n';
}

/** How long a console sign-in lasts without use. */
const SIGN_IN_MS = 12 * 60 * 60_000;

/** Whether the request came over HTTPS (directly, or through a proxy that says so). */
function isHttps(req: IncomingMessage): boolean {
  return !!(req.socket as { encrypted?: boolean }).encrypted || req.headers['x-forwarded-proto'] === 'https';
}

/** A path as a shell argument (zsh, bash). */
function shellQuote(p: string): string {
  return /^[\w@%+=:,./~-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}

class RestoreError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A body that is only {error: "..."}. */
function onlyError(body: unknown): boolean {
  return !!body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1 && typeof (body as { error?: unknown }).error === 'string';
}

export class Admin {
  private readonly inFlight = new IdentityInFlight();
  private readonly host: Host;
  private readonly api: DataApi;
  readonly securityAudit: SecurityAuditVerifier;
  private readonly started = Date.now();
  /** Basic credentials already checked (by hash), so each poll doesn't re-run scrypt. */
  private readonly verified = new Map<string, number>();
  // Brute-force guard: wrong passwords from one address lock it out for a
  // cooldown, so the single admin password cannot be guessed at speed. The
  // lockout is checked before scrypt runs, so repeated misses can't burn CPU.
  private readonly MAX_FAILS = 5;
  private readonly LOCK_MS = 15 * 60_000;
  private readonly failures = new Map<string, { count: number; first: number; until: number }>();
  /** Console sign-ins (the tabularius_admin cookie), until when; renewed as they are used. */
  private readonly signedIn = new Map<string, number>();
  /** A fingerprint of the password the sign-ins above were made with. */
  private signedInWith?: string;
  /** One-time passkey challenges issued to the console (registration and sign-in alike), until when. */
  private readonly passkeyChallenges = new Map<string, { expires: number; address?: string; prefix48?: string; pool?: 'general' | 'proxy' }>();
  private readonly passkeyAddressCounts = new Map<string, number>();
  private readonly passkeyPrefixCounts = new Map<string, number>();
  private passkeyPending = 0;
  private passkeyGeneralPending = 0;
  private passkeyNextExpiry = Infinity;
  backups?: BackupSchedule;
  progressive?: ProgressiveSchedule;
  replication?: Replication;
  tls?: CertificateState;
  offsite?: OffsiteSchedule;
  /** Sets kept by "back up now" without a schedule: 0 keeps them all. */
  backupKeep = 0;
  /** The server was started with a backup folder of its own (--backup-dir), which the console can't move. */
  backupDirFixed = false;
  /** The folder in use when backups follow no schedule here: the one point-in-time backups and the off-site copy were started on (the console may have saved another since). */
  backupDirInUse?: string;
  /** The folder backups go to: the schedule's, else the one saved in the console, else <folder>/Backups. */
  backupDest(): string {
    return this.backups?.dest ?? this.backupDirInUse ?? this.host.config.backupDir() ?? defaultBackupDir(this.host.dir);
  }
  schedules?: Schedules;
  sync?: SyncConsole;
  metrics?: Metrics;
  uploads?: Uploads;
  webhooks?: Webhooks;
  inboundHooks?: InboundHooks;
  /** The outside services scripts and tools use by name, with their secrets sealed. */
  connections?: Connections;
  /** Scheduled AI digests of the hosted files. */
  digests?: DigestRunner;
  /** The AI assistant, for the status line (never its key). */
  assistant?: { readonly state: AiState; usageReport?(): unknown; planSolution?(name: string, description: string): Promise<unknown> };
  /** Converted files' plain-English guides. */
  guides?: ConversionGuides;
  profiler?: Profiler;
  /** A file whose script test cases are running now: one run at a time, each on its own copy of the file. */
  private testing?: string;
  /** Tokens AI apps use to reach /mcp as one account of one file. */
  mcpTokens?: McpTokens;
  /** Whether this folder is installed as a service; unset where that doesn't apply. */
  serviceInstalled?: () => boolean;
  /** The live-update channel, so the console can send a message to connected web clients. */
  live?: Live;
  logs?: ServerLogs;
  /** Where the server reports things (its console and Event log). */
  log: (m: string) => void = () => {};
  /** Identity-provider sign-in storage health; contains only an administrator-facing error. */
  oidcStatus: { on: boolean; error?: string; warning?: string } = { on: false };

  constructor(host: Host, api: DataApi, securityAudit = securityAuditVerifier) {
    this.host = host;
    this.api = api;
    this.securityAudit = securityAudit;
  }

  /** Tokens AI apps sign in with: each file's API tokens that reach /mcp, and older admin console tokens. */
  private mcpTokenList(legacy: McpTokens): Record<string, unknown>[] {
    const files = this.host.openStores().flatMap((store) => store.apiTokens()
      .filter((x) => x.surfaces?.includes('fmmcp'))
      .map((x) => ({ ...x, database: store.name })));
    return [...files, ...legacy.list().map((x) => ({ ...x, older: true }))];
  }

  /** Each open file's active accounts (whether their privilege set has AI access, fmmcp), the sets an AI agent may hold, and its layouts. */
  private mcpAccounts(): { name: string; accounts: { name: string; privilegeSet?: string; ai: boolean; agent?: boolean }[]; agentSets: { name: string; ai: boolean }[]; layouts: string[]; aiOff?: boolean }[] {
    return this.host.names().flatMap((name) => {
      const store = this.host.get(name);
      if (!store) return [];
      const accounts = store.accounts().filter((a) => !a.inactive && !a.external).map((a) => {
        let ai = false;
        try {
          ai = store.privileges(a.name).has('fmmcp');
        } catch {
          // an account whose set is missing has no access at all
        }
        return { name: a.name, ...(a.privilegeSet ? { privilegeSet: a.privilegeSet } : {}), ai, ...(a.agent ? { agent: true } : {}) };
      });
      // An agent is never [Full Access].
      const agentSets = store.privilegeSets().filter((p) => !isFullAccess(p)).map((p) => ({ name: p.name, ai: p.extendedPrivileges.some((e) => e.toLowerCase() === 'fmmcp') }));
      return [{ name, accounts, agentSets, layouts: store.layouts().map((l) => l.name), ...(store.aiAllowed ? {} : { aiOff: true }) }];
    });
  }

  private passwordHash(): string | undefined {
    const f = join(this.host.dir, PASSWORD_FILE);
    return existsSync(f) ? readFileSync(f, 'utf8').trim() : undefined;
  }

  /** null when allowed, else the status and message to send. */
  check(req: IncomingMessage): { status: number; message: string; retryAfter?: number } | null {
    // Tabularius commands on this machine, through the folder's local channel (local-admin.ts).
    if (isLocalAdmin(this.host.dir, req.headers['x-tabularius-local'])) return null;
    const hash = this.passwordHash();
    if (!hash) {
      return directFromThisComputer(req) ? null : { status: 403, message: 'The admin console is only open on this machine until an admin password is set (tabularius admin-password <folder>).' };
    }
    // Signed in on the console's sign-in page. Looked at before the lockout: the cookie can't be guessed, and behind
    // a proxy every caller is one address, so a stranger's wrong passwords must not lock out who is signed in.
    const session = this.consoleSession(req);
    if (session) {
      this.signedIn.set(session, performance.now() + SIGN_IN_MS);
      return null;
    }
    return this.checkBasicCredentials(req, hash);
  }

  /** Admin API login uses Basic credentials only; console cookies and local channels do not authenticate it. */
  checkBasic(req: IncomingMessage): { status: number; message: string; retryAfter?: number } | null {
    const hash = this.passwordHash();
    if (!hash) return { status: 401, message: 'Admin password required' };
    return this.checkBasicCredentials(req, hash);
  }

  private checkBasicCredentials(req: IncomingMessage, hash: string): { status: number; message: string; retryAfter?: number } | null {
    const now = performance.now();
    const ip = clientAddress(req);
    const locked = this.failures.get(addressBucket(ip));
    if (locked && locked.until > now) {
      const secs = Math.ceil((locked.until - now) / 1000);
      return { status: 429, message: `Too many failed attempts. Try again in ${secs} seconds.`, retryAfter: secs };
    }
    const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!basic) return { status: 401, message: 'Admin password required' };
    const key = createHash('sha256').update(hash).update('\0').update(basic).digest('hex');
    const until = this.verified.get(key);
    if (until && until > now) return null;
    const password = Buffer.from(basic, 'base64').toString('utf8').replace(/^[^:]*:/, '');
    const denied = this.tryPassword(ip, password, hash);
    if (denied) return denied;
    this.verified.set(key, now + 5 * 60_000);
    return null;
  }

  /** Binds console and Admin API sign-ins to the current admin password without exposing its stored hash. */
  passwordFingerprint(): string {
    return createHash('sha256').update(this.passwordHash() ?? '').digest('hex');
  }

  /** A new or changed password ends every console sign-in made before it. */
  private endOldSignIns(): void {
    const fingerprint = this.passwordFingerprint();
    if (this.signedInWith !== undefined && this.signedInWith !== fingerprint) this.signedIn.clear();
    this.signedInWith = fingerprint;
  }

  /** The console sign-in a request carries (cookie), if it is current. */
  private consoleSession(req: IncomingMessage): string | undefined {
    const id = /(?:^|;\s*)(?:tabularius|openhbam)_admin=([0-9a-f]{64})/.exec(req.headers.cookie ?? '')?.[1];
    this.endOldSignIns();
    if (!id) return undefined;
    const until = this.signedIn.get(id);
    if (!until || until <= performance.now()) {
      this.signedIn.delete(id);
      return undefined;
    }
    return id;
  }

  /** Remembers an address's misses. Addresses are many (an IPv6 network has as many as it likes), so the oldest records go past a limit. */
  private noteMiss(ip: string, rec: { count: number; first: number; until: number }): void {
    this.failures.delete(ip);
    this.failures.set(ip, rec);
    if (this.failures.size <= 5000) return;
    // Only records that block nobody now are dropped, oldest first: a lock is never evicted to make room, so
    // flooding from many addresses can't reset one. (Locks last 15 minutes and each took five wrong passwords.)
    const now = performance.now();
    for (const [k, r] of this.failures) {
      if (this.failures.size <= 5000) break;
      if (r.until <= now) this.failures.delete(k);
    }
  }

  /** Checks the admin password, counting misses per address: null when right. */
  private tryPassword(from: string, password: string, hash: string): { status: number; message: string; retryAfter?: number } | null {
    const now = performance.now();
    const ip = addressBucket(from);
    const locked = this.failures.get(ip);
    if (locked && locked.until > now) {
      const secs = Math.ceil((locked.until - now) / 1000);
      return { status: 429, message: `Too many failed attempts. Try again in ${secs} seconds.`, retryAfter: secs };
    }
    if (!checkPassword(password, hash)) {
      // Count the miss; a burst of them within the window triggers the cooldown.
      const rec = locked && now - locked.first < this.LOCK_MS ? locked : { count: 0, first: now, until: 0 };
      rec.count++;
      if (rec.count >= this.MAX_FAILS) rec.until = now + this.LOCK_MS;
      this.noteMiss(ip, rec);
      if (rec.until > now) {
        const secs = Math.ceil((rec.until - now) / 1000);
        return { status: 429, message: `Too many failed attempts. Try again in ${secs} seconds.`, retryAfter: secs };
      }
      return { status: 401, message: 'Wrong admin password' };
    }
    this.failures.delete(ip);
    return null;
  }

  /** What the sign-in page says: whether a password is set, and how to set or reset one. */
  private signInInfo(req: IncomingMessage) {
    const loopback = directFromThisComputer(req);
    return {
      passwordSet: !!this.passwordHash(),
      // Only the state: the provider's own messages and the model are for the signed-in console (status).
      ai: { state: this.assistant?.state.state ?? ('no-key' as const) },
      local: loopback,
      // The same command sets a first password and replaces a forgotten one; run it on the server. Where the
      // folder is is for this computer's own browser, not for whoever asks over the network.
      command: loopback ? `tabularius admin-password ${shellQuote(this.host.dir)}` : 'tabularius admin-password <folder>',
      https: isHttps(req),
      hasPasskey: hasAdminPasskey(this.host.dir),
    };
  }

  /** Issues a one-time passkey challenge without evicting any live ceremony. */
  private issuePasskeyChallenge(from?: string, direct = false): string | undefined {
    const now = performance.now();
    // Scan for expiry only when an entry can have expired, including after a wall-clock edit.
    if (now >= this.passkeyNextExpiry) {
      this.passkeyNextExpiry = Infinity;
      for (const [challenge, entry] of this.passkeyChallenges) {
        if (entry.expires <= now) this.removePasskeyChallenge(challenge);
        else this.passkeyNextExpiry = Math.min(this.passkeyNextExpiry, entry.expires);
      }
    }
    // Authenticated callers do not consume unauthenticated allowances.
    const unknown = from !== undefined && !isIP(from);
    const bucket = from === undefined ? undefined : unknown ? { address: UNKNOWN_CLIENT } : passkeyChallengeBuckets(from);
    const loopback = direct && (from === '127.0.0.1' || from === '::1' || from === '::ffff:127.0.0.1');
    // An unauthenticated administrator cannot be identified yet. Reserve capacity for known proxied IPv4
    // callers: neither direct traffic nor one IPv6 visitor rotating /48s can consume this part of the pool.
    const pool = !bucket || loopback ? undefined : !direct && !unknown && !bucket.prefix48 ? 'proxy' : 'general';
    if (bucket) {
      const addressLimit = unknown ? ADMIN_LIMIT.passkeyChallengesUnknown : ADMIN_LIMIT.passkeyChallengesPerAddress;
      if ((this.passkeyAddressCounts.get(bucket.address) ?? 0) >= addressLimit ||
          (bucket.prefix48 !== undefined && (this.passkeyPrefixCounts.get(bucket.prefix48) ?? 0) >= ADMIN_LIMIT.passkeyChallengesPer48)) return undefined;
    }
    if (pool) {
      const reserve = Math.min(ADMIN_LIMIT.passkeyChallengesProxyReserve, Math.floor(ADMIN_LIMIT.passkeyChallenges / 2));
      if (this.passkeyPending >= ADMIN_LIMIT.passkeyChallenges ||
          (pool === 'general' && this.passkeyGeneralPending >= ADMIN_LIMIT.passkeyChallenges - reserve)) return undefined;
    }
    const challenge = randomBytes(32).toString('base64url');
    const expires = now + 300_000;
    this.passkeyChallenges.set(challenge, { expires, ...bucket, pool });
    this.passkeyNextExpiry = Math.min(this.passkeyNextExpiry, expires);
    if (bucket) {
      this.passkeyAddressCounts.set(bucket.address, (this.passkeyAddressCounts.get(bucket.address) ?? 0) + 1);
      if (bucket.prefix48 !== undefined) this.passkeyPrefixCounts.set(bucket.prefix48, (this.passkeyPrefixCounts.get(bucket.prefix48) ?? 0) + 1);
    }
    if (pool) this.passkeyPending++;
    if (pool === 'general') this.passkeyGeneralPending++;
    return challenge;
  }

  /** Every consumption, expiry, or abandoned response releases exactly the counts it acquired. */
  private removePasskeyChallenge(challenge: string): void {
    const entry = this.passkeyChallenges.get(challenge);
    if (!entry) return;
    this.passkeyChallenges.delete(challenge);
    const release = (counts: Map<string, number>, key: string) => {
      const remaining = (counts.get(key) ?? 0) - 1;
      if (remaining > 0) counts.set(key, remaining);
      else counts.delete(key);
    };
    if (entry.address !== undefined) release(this.passkeyAddressCounts, entry.address);
    if (entry.prefix48 !== undefined) release(this.passkeyPrefixCounts, entry.prefix48);
    if (entry.pool) this.passkeyPending--;
    if (entry.pool === 'general') this.passkeyGeneralPending--;
  }

  /** Consumes a console passkey challenge; true only if it was issued and is still fresh (under 5 minutes). */
  private takePasskeyChallenge(challenge: string): boolean {
    const entry = this.passkeyChallenges.get(challenge);
    this.removePasskeyChallenge(challenge);
    return !!entry && entry.expires > performance.now();
  }

  /** Called after request parsing; an abandoned response must not retain a challenge or its counts. */
  private deliverPasskeyChallenge(req: IncomingMessage, res: ServerResponse, from: string | undefined, direct: boolean,
    respond: (challenge: string | undefined) => void): void {
    if (req.socket.destroyed || res.destroyed) return;
    const challenge = this.issuePasskeyChallenge(from, direct);
    if (!challenge) { respond(undefined); return; }
    if (req.socket.destroyed || res.destroyed) { this.removePasskeyChallenge(challenge); return; }
    res.once('close', () => { if (!res.writableFinished) this.removePasskeyChallenge(challenge); });
    try { respond(challenge); }
    catch (error) { this.removePasskeyChallenge(challenge); throw error; }
  }

  /** Returns false when the request is not for the admin console. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    const page = path === '/admin' || path === '/admin/';
    if (!page && !path.startsWith('/tabularius/admin/')) return false;
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...NOSNIFF, ...headers }).end(JSON.stringify(body));
    const allow = consoleMethods(path);
    if (allow && !allow.split(', ').includes(req.method ?? 'GET')) {
      json(405, { error: 'method not allowed' }, { allow });
      return true;
    }
    // The sign-in page's own calls, open to everyone (the page is just the console's HTML; its data needs signing in).
    if (path === '/tabularius/admin/v1/sign-in-info' && req.method === 'GET') {
      json(200, this.signInInfo(req));
      return true;
    }
    if (path === '/tabularius/admin/v1/sign-in' && req.method === 'POST') {
      if (req.headers['x-tabularius-admin'] !== '1') return json(403, { error: 'missing x-tabularius-admin header' }), true;
      const hash = this.passwordHash();
      if (!hash) return json(403, { error: 'No admin password is set yet.', ...this.signInInfo(req) }), true;
      const body = await readJson(req, { bytes: AUTH_BODY_LIMIT }).catch(lenient({})) as { password?: unknown };
      const denied = this.tryPassword(clientAddress(req), said(body.password), hash);
      if (denied) return json(denied.status, { error: denied.message }, denied.retryAfter ? { 'retry-after': String(denied.retryAfter) } : {}), true;
      // The password may have been changed while this one was being checked: it was the old one that was right.
      if (this.passwordHash() !== hash) return json(401, { error: 'The admin password was just changed: sign in again' }), true;
      const id = randomBytes(32).toString('hex');
      this.endOldSignIns();
      this.signedIn.set(id, performance.now() + SIGN_IN_MS);
      json(200, { signedIn: true }, { 'set-cookie': `tabularius_admin=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SIGN_IN_MS / 1000}${isHttps(req) ? '; Secure' : ''}` });
      return true;
    }
    if (path === '/tabularius/admin/v1/sign-out' && req.method === 'POST') {
      const id = this.consoleSession(req);
      if (id) this.signedIn.delete(id);
      json(200, { signedIn: false }, { 'set-cookie': 'tabularius_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
      return true;
    }
    // Signing in with the console's passkey, open to everyone like /sign-in above (same CSRF guard: a page on
    // another site can't send the x-tabularius-admin header). With no body, issues a challenge and every registered
    // credential id; with an assertion, verifies it and signs the console in exactly like a correct password would.
    if (path === '/tabularius/admin/v1/passkey-sign-in' && req.method === 'POST') {
      if (req.headers['x-tabularius-admin'] !== '1') return json(403, { error: 'missing x-tabularius-admin header' }), true;
      if (!hasAdminPasskey(this.host.dir)) return json(403, { error: 'No passkey is registered for this console yet.' }), true;
      const env = webauthnEnv(req, this.host.publicUrl);
      const body = await readJson(req, { bytes: AUTH_BODY_LIMIT }).catch(lenient({} as Record<string, unknown>));
      if (!body || !body.response) {
        if (req.socket.destroyed || res.destroyed) return true;
        const from = clientAddress(req);
        // Only validated forwarding provenance can use the proxy reserve.
        const direct = !hasTrustedClientAddress(req);
        this.deliverPasskeyChallenge(req, res, this.check(req) === null ? undefined : from, direct, (challenge) => {
          if (!challenge) json(429, { error: 'Too many pending passkey requests; try again shortly' });
          else json(200, { challenge, rpId: env.rpId, allowCredentials: adminPasskeyIds(this.host.dir) });
        });
        return true;
      }
      const ip = addressBucket(clientAddress(req));
      const locked = this.failures.get(ip);
      if (locked && locked.until > performance.now()) {
        const secs = Math.ceil((locked.until - performance.now()) / 1000);
        return json(429, { error: `Too many failed attempts. Try again in ${secs} seconds.` }, { 'retry-after': String(secs) }), true;
      }
      const r = body.response as { credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string; challenge: string };
      if (!this.takePasskeyChallenge(r.challenge)) return json(401, { error: 'The sign-in has expired; try again' }), true;
      try {
        verifyAdminPasskeyAssertion(this.host.dir, r, { rpId: env.rpId, origin: env.origin, challenge: r.challenge });
      } catch (e) {
        const rec = locked && performance.now() - locked.first < this.LOCK_MS ? locked : { count: 0, first: performance.now(), until: 0 };
        rec.count++;
        if (rec.count >= this.MAX_FAILS) rec.until = performance.now() + this.LOCK_MS;
        this.noteMiss(ip, rec);
        return json(401, { error: e instanceof AdminPasskeyError ? e.message : 'The passkey did not verify' }), true;
      }
      this.failures.delete(ip);
      const id = randomBytes(32).toString('hex');
      this.endOldSignIns();
      this.signedIn.set(id, performance.now() + SIGN_IN_MS);
      json(200, { signedIn: true }, { 'set-cookie': `tabularius_admin=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SIGN_IN_MS / 1000}${isHttps(req) ? '; Secure' : ''}` });
      return true;
    }
    const denied = page ? null : this.check(req);
    if (denied) {
      // The console's page asks for the password on its own sign-in page, not the browser's box.
      const fromPage = req.headers['x-tabularius-console'] === '1';
      res.writeHead(denied.status, {
        'content-type': 'application/json; charset=utf-8', ...NOSNIFF,
        ...(denied.status === 401 && !fromPage ? { 'www-authenticate': 'Basic realm="Tabularius admin", charset="UTF-8"' } : {}),
        ...(denied.retryAfter ? { 'retry-after': String(denied.retryAfter) } : {}),
      }).end(JSON.stringify({ error: denied.message, signIn: denied.status === 401 || denied.status === 403 }));
      return true;
    }
    if (page) {
      if (path === '/admin') {
        res.writeHead(301, { location: '/admin/' }).end();
        return true;
      }
      await sendAsset(req, res, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      }, await loadAsset(PAGE));
      return true;
    }
    // ?db= means ?database= everywhere.
    if (url.searchParams.has('db') && !url.searchParams.has('database')) url.searchParams.set('database', url.searchParams.get('db')!);
    // A body that is only an error is never a 200: one rule for a missing or wrong parameter.
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      res.writeHead(status === 200 && onlyError(body) ? 400 : status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...NOSNIFF, ...headers }).end(JSON.stringify(body));
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-tabularius-admin'] !== '1') {
      send(403, { error: 'missing x-tabularius-admin header' });
      return true;
    }
    const done = this.inFlight.enter('admin', res);
    if (!done) {
      busyHeaders(res);
      return json(503, { error: 'Too many requests in flight for this identity' }), true;
    }
    try {
      if (path === '/tabularius/admin/v1/status' && req.method === 'GET') {
        send(200, this.status());
      } else if (await scimAdmin(this.host, req, url, send)) {
        // provisioning from an identity provider (scim.ts)
      } else if (path === '/tabularius/admin/v1/block-new-users' && req.method === 'POST') {
        const body = await readJson(req) as { on?: unknown };
        if (typeof body.on !== 'boolean') send(400, { error: 'on is true or false' });
        else {
          if (body.on !== this.host.config.blockNewUsers()) {
            this.host.config.setBlockNewUsers(body.on);
            this.log(body.on ? 'New users are blocked (admin console): only sessions already open carry on' : 'New users may sign in again (admin console)');
          }
          send(200, { blockNewUsers: body.on });
        }
      } else if (path === '/tabularius/admin/v1/session-timeout' && req.method === 'POST') {
        // Minutes a Data API session may sit idle before it ends (the Admin API's session timeouts), and, as webMinutes, the web client's
        // own (null: it follows the Data API's again). Without webMinutes the web client keeps whatever it had.
        const body = await readJson(req) as { minutes?: unknown; webMinutes?: unknown };
        try {
          if (body.minutes === undefined && body.webMinutes === undefined) throw new RangeError('minutes is a whole number');
          if (body.webMinutes !== undefined && body.webMinutes !== null && typeof body.webMinutes !== 'number') throw new RangeError('webMinutes is a whole number, or null');
          if (body.minutes !== undefined && typeof body.minutes !== 'number') throw new RangeError('minutes is a whole number');
          const config = this.host.config;
          const before = config.sessionIdleMinutes();
          const webBefore = config.webSessionIdleMinutes();
          // Both are checked before either is saved.
          if (body.minutes !== undefined) config.setSessionIdleMinutes(body.minutes as number);
          if (body.webMinutes !== undefined) {
            try { config.setWebSessionIdleMinutes(body.webMinutes as number | null); } catch (e) { if (body.minutes !== undefined) config.setSessionIdleMinutes(before); throw e; }
          }
          const now = config.sessionIdleMinutes();
          if (now !== before) this.log(`The Data API session timeout is ${now} ${now === 1 ? 'minute' : 'minutes'} (admin console), was ${before}`);
          const webNow = config.webSessionIdleMinutes();
          if (webNow !== webBefore && body.webMinutes !== undefined) this.log(`The web client session timeout is ${webNow} ${webNow === 1 ? 'minute' : 'minutes'} (admin console), was ${webBefore}`);
          send(200, { sessionIdleMinutes: now, ...(body.webMinutes !== undefined ? { webSessionIdleMinutes: webNow } : {}) });
        } catch (e) {
          send(400, { error: adminErrorText(e, this.host) });
        }
      } else if (path === '/tabularius/admin/v1/responsive' && req.method === 'POST') {
        // The width below which the web client stacks a layout in one column when the layout has no breakpoint of its own.
        const body = await readJson(req) as { stackBelow?: unknown };
        try {
          if (body.stackBelow !== null && typeof body.stackBelow !== 'number') throw new RangeError('stackBelow is a whole number of points, or null for the default');
          const before = this.host.config.responsiveStackBelow();
          this.host.config.setResponsiveStackBelow(body.stackBelow as number | null);
          const now = this.host.config.responsiveStackBelow();
          if (now !== before) this.log(`Layouts without a breakpoint of their own ${now ? `stack in one column in web client windows narrower than ${now} points` : 'no longer stack in narrow web client windows'} (admin console), was ${before || 'never'}`);
          send(200, { responsiveStackBelow: now });
        } catch (e) {
          send(400, { error: adminErrorText(e, this.host) });
        }
      } else if (path === '/tabularius/admin/v1/notifications' && req.method === 'POST') {
        // Email an address when the server logs an error (and, if asked, a warning), as a digest.
        const body = await readJson(req) as { to?: unknown; level?: unknown };
        try {
          if (body.to === '' || body.to === null) {
            this.host.config.setNotifications(undefined);
            this.log('Email notifications are off (admin console)');
          } else {
            if (typeof body.to !== 'string') throw new RangeError('to is an email address, or empty to turn notifications off');
            if (body.level !== undefined && body.level !== 'Error' && body.level !== 'Warning') throw new RangeError('level is Error or Warning');
            this.host.config.setNotifications({ to: body.to.trim(), level: body.level === 'Warning' ? 'Warning' : 'Error' });
            this.log(`Email notifications go to ${body.to.trim()} (admin console)`);
          }
          send(200, this.notificationStatus());
        } catch (e) {
          send(400, { error: adminErrorText(e, this.host) });
        }
      } else if (path === '/tabularius/admin/v1/notifications/test' && req.method === 'POST') {
        send(200, await this.host.notifier.test());
      } else if (path === '/tabularius/admin/v1/passkeys' && req.method === 'GET') {
        send(200, { passkeys: adminPasskeys(this.host.dir) });
      } else if (path === '/tabularius/admin/v1/passkeys/register/options' && req.method === 'POST') {
        this.deliverPasskeyChallenge(req, res, undefined, false, (challenge) => {
          if (!challenge) send(429, { error: 'Too many pending passkey requests; try again shortly' });
          else send(200, { challenge, rpId: webauthnEnv(req, this.host.publicUrl).rpId, excludeCredentials: adminPasskeyIds(this.host.dir) });
        });
      } else if (path === '/tabularius/admin/v1/passkeys/register' && req.method === 'POST') {
        const body = await readJson(req);
        const response = body.response as { attestationObject: string; clientDataJSON: string; challenge: string };
        if (!this.takePasskeyChallenge(response?.challenge ?? '')) { send(400, { error: 'The registration has expired; start again' }); return true; }
        const env = webauthnEnv(req, this.host.publicUrl);
        try {
          send(200, registerAdminPasskey(this.host.dir, response, { rpId: env.rpId, origin: env.origin, challenge: response.challenge }, typeof body.label === 'string' ? body.label : undefined));
        } catch (e) {
          send(400, { error: e instanceof AdminPasskeyError ? e.message : 'The passkey could not be registered' });
        }
      } else if (/^\/tabularius\/admin\/v1\/passkeys\/[^/]+$/.test(path) && req.method === 'DELETE') {
        const id = decodeURIComponent(path.split('/')[5]);
        send(200, { removed: removeAdminPasskey(this.host.dir, id) });
      } else if (path === '/tabularius/admin/v1/metrics' && req.method === 'GET' && this.metrics) {
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' }).end(this.metrics.render());
      } else if (path === '/tabularius/admin/v1/backups' && req.method === 'GET') {
        send(200, { backups: this.status().backups });
      } else if (path === '/tabularius/admin/v1/backup-folder' && req.method === 'POST') {
        // Where backups go. Saved in the folder's settings, so the next start keeps it; it applies at once when nothing else
        // (point-in-time backups, the off-site copy) is following the old folder.
        const body = await readJson(req) as { folder?: unknown };
        try {
          if (typeof body.folder !== 'string') throw new RangeError('folder is a full path, or empty for the default');
          if (this.backupDirFixed) throw new BackupFolderError(`the server was started with --backup-dir ${this.backupDest()}, which counts; change that and restart`, 409);
          if (backupRunning()) throw new BackupFolderError('a backup is running; wait for it or stop it, then change the folder', 409);
          const asked = body.folder.trim();
          const folder = asked ? checkBackupFolder(asked, this.host.dir) : '';
          this.host.config.setBackupDir(folder || undefined);
          const live = !this.progressive && !this.offsite;
          if (live) this.backupDirInUse = folder || defaultBackupDir(this.host.dir);
          if (live && this.backups) this.backups.dest = this.backupDirInUse!;
          const now = this.backupDest();
          this.log(`Backups go to ${folder || 'the default folder'} (admin console)${live ? '' : `; this server also keeps ${this.progressive ? 'point-in-time backups' : 'an off-site copy'} of the old folder, so it counts after a restart (now: ${now})`}`);
          send(200, { folder: folder || null, backupDir: now, appliesNow: live });
        } catch (e) {
          send(e instanceof BackupFolderError ? e.status : 400, { error: adminErrorText(e, this.host) });
        }
      } else if (path === '/tabularius/admin/v1/backup' && req.method === 'POST') {
        // A backup is a set of every hosted file (restores and point-in-time logs depend on that): never quietly more than asked for.
        const asked = (await readJson(req).catch(lenient({}))) as { database?: unknown };
        if (asked.database !== undefined && asked.database !== '') {
          send(400, { error: 'a backup covers every hosted file; leave out "database"' });
          return true;
        }
        const dest = this.backupDest();
        let r;
        try {
          r = await backupFolder(this.host.dir, dest, this.backups?.keep ?? this.backupKeep, undefined, { stoppable: true });
        } catch (e) {
          if (!(e instanceof BackupStopped)) throw e;
          send(409, { error: e.message });
          return true;
        }
        this.progressive?.follow(r.dir);
        void this.offsite?.run();
        // Checked in the background, as a large file takes a while to read back; the console shows the outcome.
        void verifyAfterBackup(dest, basename(r.dir), this.log).catch((e) => this.log(`backup check failed: ${(e as Error).message}`));
        send(200, { dir: r.dir, files: r.files, removed: r.removed });
      } else if (path === '/tabularius/admin/v1/backup/stop' && req.method === 'POST') {
        // Ends the backups running or waiting (each after the file it is copying); the set being made is removed and nothing old is pruned.
        const stopped = stopBackups();
        if (stopped) this.log(`backup: stopped by the administrator (${stopped})`);
        send(200, { stopped });
      } else if (/^\/tabularius\/admin\/v1\/backups\/[^/]+\/verify$/.test(path) && req.method === 'POST') {
        const set = decodeURIComponent(path.split('/')[5]);
        const dest = this.backupDest();
        if (!backupSets(dest).includes(set)) send(404, { error: 'no such backup' });
        else {
          const check = await verifySet(join(dest, set));
          this.log(describeCheck(set, check));
          send(200, check);
        }
      } else if (/^\/tabularius\/admin\/v1\/backups\/[^/]+\/test-restore$/.test(path) && req.method === 'POST') {
        const set = decodeURIComponent(path.split('/')[5]);
        const dest = this.backupDest();
        if (!backupSets(dest).includes(set)) send(404, { error: 'no such backup' });
        else {
          const restored = await testRestore(join(dest, set));
          this.log(describeRestore(set, restored));
          send(200, restored);
        }
      } else if (/^\/tabularius\/admin\/v1\/files\/[^/]+\/external-containers$/.test(path) && req.method === 'GET') {
        // Which container fields' files, stored outside the file, are missing: the folder to bring over from FileMaker Server.
        const name = decodeURIComponent(path.split('/')[5]);
        const store = this.host.storeOf(name);
        if (!store) send(404, { error: `${name} isn't hosted` });
        else send(200, { folder: `RC_Data_FMS/${store.name}/`, fields: store.externalContainerReport() });
      } else if (/^\/tabularius\/admin\/v1\/files\/[^/]+\/orphan-containers$/.test(path) && (req.method === 'GET' || req.method === 'POST')) {
        const name = decodeURIComponent(path.split('/')[5]);
        const store = this.host.storeOf(name);
        if (!store) send(404, { error: `${name} isn't hosted` });
        else if (req.method === 'GET') send(200, store.orphanContainerReport());
        else {
          const body = await readJson(req).catch(lenient({})) as { purge?: boolean };
          if (body.purge !== true) send(400, { error: 'purge must be true to remove unreferenced containers' });
          else send(200, { ...store.purgeOrphanContainers(), ...store.orphanContainerReport() });
        }
      } else if (/^\/tabularius\/admin\/v1\/files\/[^/]+\/reconvert-preview$/.test(path) && req.method === 'POST') {
        // A dry run: what converting again would change, in a scratch folder; nothing hosted is touched.
        const name = decodeURIComponent(path.split('/')[5]);
        const body = await readJson(req).catch(lenient({})) as { sameFile?: boolean; passphrase?: string };
        if (!this.host.storeOf(name)) send(404, { error: `${name} isn't hosted` });
        else await this.passphraseFor(send, async () => {
          send(200, { name, ...await this.host.previewReconvert(name, { sameFile: !!body.sameFile, passphrase: secret(body.passphrase) }) });
        });
      } else if (/^\/tabularius\/admin\/v1\/locked\/[^/]+\/unlock$/.test(path) && req.method === 'POST') {
        // A dropped-in file that uses Encryption at Rest: checked at once, then converted in the background.
        // The passphrase is never logged, stored or kept once the conversion is done.
        const file = decodeURIComponent(path.split('/')[5]);
        const body = await readJson(req).catch(lenient({})) as { passphrase?: string };
        if (!this.host.locked.has(file)) send(404, { error: `${file} isn't waiting for a passphrase` });
        else {
          try {
            this.host.checkPassphrase(file, secret(body.passphrase) ?? '');
          } catch (e) {
            send(400, { error: adminErrorText(e, this.host) });
            return true;
          }
          void this.host.unlock(file, secret(body.passphrase)!, this.log, { checked: true }).catch(() => {});
          send(202, { file, converting: true });
        }
      } else if (path === '/tabularius/admin/v1/relax-unverified' && req.method === 'POST') {
        // "Treat as read-only (unverified mapping)": fields the import hid because their access byte is only
        // inferred to mean view-only become view-only. An explicit admin choice, one set at a time.
        const body = await readJson(req).catch(lenient({})) as { database?: string; privilegeSet?: string };
        const store = this.host.get(said(body.database));
        if (!store) send(404, { error: 'name a hosted database in {"database": ...}' });
        else if (typeof body.privilegeSet !== 'string') send(400, { error: 'name the set in {"privilegeSet": ...}' });
        else {
          try {
            send(200, { database: store.name, privilegeSet: body.privilegeSet, relaxed: store.relaxUnverifiedAccess(body.privilegeSet) });
          } catch (e) {
            if (e instanceof StoreError) send(400, { error: e.message }); else throw e;
          }
        }
      } else if (path === '/tabularius/admin/v1/reconvert-all' && req.method === 'POST') {
        // Convert all again: {"preview": true} for each outdated file's dry run, or {"files": [...]} to convert them.
        // sameFile: the .fmp12 files are copies of the ones converted (see reconvertCheck's unverified).
        const body = await readJson(req).catch(lenient({})) as { preview?: boolean; files?: string[]; sameFile?: boolean };
        const sameFile = !!body.sameFile;
        const outdated = this.host.names().filter((n) => this.host.reconvertStatus(n)?.outdated);
        if (body.preview) {
          const files = [];
          for (const name of outdated) {
            try {
              files.push({ name, ...await this.host.previewReconvert(name, { sameFile }) });
            } catch (e) {
              files.push({ name, error: adminErrorText(e, this.host) });
            }
          }
          send(200, { files });
        } else {
          const names = Array.isArray(body.files) ? body.files.map(String).filter((n) => outdated.includes(n)) : [];
          const files = [];
          for (const name of names) {
            const check = this.host.reconvertStatus(name, { sameFile });
            try {
              this.log(`converting ${name} again from its .fmp12${check?.unsafe ? ', without carrying edits over' : ''}`);
              const r = await this.host.reconvertFile(name, { force: !!check?.unsafe, sameFile });
              this.log(`converted ${name} again: ${r.stats.records} records; ${r.created} created, ${r.edited} edited and ${r.deleted} deleted since were kept; the store as it was is ${basename(r.backup)}`);
              files.push({ name, ...r, backup: basename(r.backup) });
            } catch (e) {
              this.log(`converting ${name} again failed: ${(e as Error).message}`);
              files.push({ name, error: adminErrorText(e, this.host) });
            }
          }
          send(200, { files });
        }
      } else if (/^\/tabularius\/admin\/v1\/files\/[^/]+\/reconvert$/.test(path) && req.method === 'POST') {
        // Converting a file again from its .fmp12, keeping the edits made since.
        const name = decodeURIComponent(path.split('/')[5]);
        const body = await readJson(req).catch(lenient({})) as { force?: boolean; sameFile?: boolean; passphrase?: string };
        if (!this.host.storeOf(name)) send(404, { error: `${name} isn't hosted` });
        else {
          await this.passphraseFor(send, async () => {
            // The passphrase (when the .fmp12 needs one) is checked before anything is logged or closed.
            this.host.checkReconvertPassphrase(name, secret(body.passphrase));
            this.log(`converting ${name} again from its .fmp12${body.force ? ', without carrying edits over' : ''}`);
            const r = await this.host.reconvertFile(name, { force: !!body.force, sameFile: !!body.sameFile, passphrase: secret(body.passphrase) });
            this.log(`converted ${name} again: ${r.stats.records} records; ${r.created} created, ${r.edited} edited and ${r.deleted} deleted since were kept; the store as it was is ${basename(r.backup)}`);
            send(200, { ...r, backup: basename(r.backup) });
          });
        }
      } else if (path === '/tabularius/admin/v1/server-scripts' && req.method === 'GET') {
        send(200, this.host.serverScripts.overview());
      } else if (/^\/tabularius\/admin\/v1\/server-scripts\/[\w-]+\/cancel$/.test(path) && req.method === 'POST') {
        const id = path.split('/')[5];
        const q = this.host.serverScripts;
        const { running, queued } = q.overview();
        const job = [...running, ...queued].find((j) => j.id === id);
        if (!job || !q.cancelAnywhere(id, 'an administrator')) send(404, { error: 'That script has already ended' });
        else {
          this.log(`canceled ${job.state === 'queued' ? 'waiting' : 'running'} server-side script "${job.script}" in ${job.file}`);
          send(200, { canceled: true });
        }
      } else if (path.startsWith('/tabularius/admin/v1/schedules')) {
        await this.handleSchedules(req, path, send);
      } else if (path === '/tabularius/admin/v1/sync' || path.startsWith('/tabularius/admin/v1/sync/')) {
        await this.handleSync(req, path, url, send);
      } else if ((path === '/tabularius/admin/v1/uploads' || path.startsWith('/tabularius/admin/v1/uploads/')) && this.uploads) {
        const u = this.uploads;
        const m = /^\/tabularius\/admin\/v1\/uploads(?:\/([\w-]+)(\/finish)?)?$/.exec(path);
        if (!m) send(404, { error: 'not found' });
        else if (!m[1] && req.method === 'GET') send(200, { uploads: u.list() });
        else if (!m[1] && req.method === 'POST') send(201, u.start(await readJson(req)));
        else if (m[1] && m[2] && req.method === 'POST') send(200, u.finish(m[1]));
        else if (m[1] && !m[2] && req.method === 'PUT') send(200, await u.write(m[1], queryInteger(url.searchParams, 'offset', 1_000_000_000, 0) ?? 0, req));
        else if (m[1] && !m[2] && req.method === 'GET') send(200, u.get(m[1]));
        else if (m[1] && !m[2] && req.method === 'DELETE') {
          await u.remove(m[1]);
          send(200, {});
        } else send(405, { error: 'method not allowed' }, { allow: !m[1] ? 'GET, POST' : m[2] ? 'POST' : 'PUT, GET, DELETE' });
      } else if ((path === '/tabularius/admin/v1/webhooks' || path.startsWith('/tabularius/admin/v1/webhooks/')) && this.webhooks) {
        const w = this.webhooks;
        const m = /^\/tabularius\/admin\/v1\/webhooks(?:\/([0-9a-f]+))?$/.exec(path);
        if (!m) send(404, { error: 'not found' });
        else if (!m[1] && req.method === 'GET') send(200, { allowed: w.allowed, webhooks: w.list() });
        else if (!m[1] && req.method === 'POST') send(201, w.create(await readJson(req) as Record<string, unknown>));
        else if (m[1] && req.method === 'PATCH') send(200, w.update(m[1], await readJson(req) as Record<string, unknown>));
        else if (m[1] && req.method === 'DELETE') send(w.remove(m[1]) ? 200 : 404, {});
        else send(405, { error: 'method not allowed' });
      } else if ((path === '/tabularius/admin/v1/inbound-hooks' || path.startsWith('/tabularius/admin/v1/inbound-hooks/')) && this.inboundHooks) {
        const h = this.inboundHooks;
        const m = /^\/tabularius\/admin\/v1\/inbound-hooks(?:\/([0-9a-f]+)(\/secret)?)?$/.exec(path);
        if (!m) send(404, { error: 'not found' });
        else if (!m[1] && req.method === 'GET') send(200, { allowed: h.allowed, hooks: h.list() });
        else if (!m[1] && req.method === 'POST') send(201, h.create(await readJson(req) as Record<string, unknown>));
        else if (m[1] && m[2] && req.method === 'POST') send(200, h.newSecret(m[1]));
        else if (m[1] && !m[2] && req.method === 'PATCH') send(200, h.update(m[1], await readJson(req) as Record<string, unknown>));
        else if (m[1] && !m[2] && req.method === 'DELETE') send(h.remove(m[1]) ? 200 : 404, {});
        else send(405, { error: 'method not allowed' });
      } else if ((path === '/tabularius/admin/v1/connections' || path.startsWith('/tabularius/admin/v1/connections/')) && this.connections) {
        await this.handleConnections(req, path, send);
      } else if (path === '/tabularius/admin/v1/solutions/plan' && req.method === 'POST') {
        const body = await readJson(req).catch(lenient({})) as { name?: unknown; description?: unknown };
        const plan = this.assistant?.planSolution;
        if (!plan) send(503, { error: 'The AI assistant is off on this server (start it with --ai and an API key)' });
        else if (typeof body.description !== 'string' || !body.description.trim()) send(400, { error: 'Say what the solution is for' });
        else {
          try {
            send(200, await plan.call(this.assistant, solutionName(this.host, body.name), body.description));
          } catch (e) {
            if (!(e instanceof SolutionError)) console.error(e);
            send(e instanceof SolutionError ? 400 : 502, { error: e instanceof SolutionError ? e.message : 'Internal server error' });
          }
        }
      } else if (path === '/tabularius/admin/v1/solutions' && req.method === 'POST') {
        try {
          const made = await createSolution(this.host, await readJson(req).catch(lenient({})) as Record<string, unknown>);
          this.log(`New solution ${made.database} created from a plan (${made.changes} changes)`);
          send(201, made);
        } catch (e) {
          if (!(e instanceof SolutionError)) console.error(e);
          send(e instanceof SolutionError ? 400 : 500, { error: e instanceof SolutionError ? e.message : 'Internal server error' });
        }
      } else if (path === '/tabularius/admin/v1/ai-usage' && req.method === 'GET') {
        send(200, this.assistant?.usageReport?.() ?? { off: true });
      } else if (path.startsWith('/tabularius/admin/v1/ai-policy/')) {
        const store = this.host.get(decodeURIComponent(path.slice('/tabularius/admin/v1/ai-policy/'.length)));
        if (!store) send(404, { error: 'No such hosted file' });
        else if (req.method === 'GET') send(200, { on: store.aiPolicy });
        else if (req.method === 'POST') {
          const body = await readJson(req) as { on?: unknown };
          if (typeof body.on !== 'boolean') send(400, { error: 'Send {"on": true} or {"on": false}' });
          else { store.setAiPolicy(body.on); send(200, { on: store.aiPolicy }); }
        } else send(405, { error: 'method not allowed' });
      } else if (path.startsWith('/tabularius/admin/v1/ai-access/')) {
        // GET: whether AI may read the file; POST {"on": false}: keep its data from AI apps and the assistant.
        const store = this.host.get(decodeURIComponent(path.slice('/tabularius/admin/v1/ai-access/'.length)));
        if (!store) send(404, { error: 'No such hosted file' });
        else if (req.method === 'GET') send(200, aiStatus(store));
        else if (req.method === 'POST') {
          const body = await readJson(req) as { on?: unknown };
          if (typeof body.on !== 'boolean') send(400, { error: 'Send {"on": true} or {"on": false}' });
          else {
            store.setAiAllowed(body.on, { account: 'admin console' });
            this.log(`AI turned ${body.on ? 'on' : 'off'} for ${store.name}`);
            send(200, aiStatus(store));
          }
        } else send(405, { error: 'method not allowed' });
      } else if (path.startsWith('/tabularius/admin/v1/pii/')) {
        // Personal data isolation. GET: each field's treatment and a few records as an AI model gets them (?layout=);
        // POST {"on": true}: turn it on; POST …/field {"table", "field", "pii": true | false | null}: mark a field.
        const m = /^\/tabularius\/admin\/v1\/pii\/([^/]+)(\/field)?$/.exec(path);
        const store = m ? this.host.get(decodeURIComponent(m[1])) : undefined;
        if (!store) send(404, { error: 'No such hosted file' });
        else if (!m![2] && req.method === 'GET') send(200, piiPreview(store, url.searchParams.get('layout') ?? undefined));
        else if (req.method === 'POST') {
          const body = await readJson(req).catch(lenient({})) as { on?: unknown; table?: unknown; field?: unknown; pii?: unknown };
          if (m![2]) {
            if (typeof body.table !== 'string' || typeof body.field !== 'string' || (body.pii !== null && typeof body.pii !== 'boolean')) send(400, { error: 'Send {"table", "field", "pii": true, false or null}' });
            else {
              try {
                store.markPiiField(body.table, body.field, body.pii as boolean | null, { account: 'admin console' });
                forgetClasses(store);
                send(200, piiPreview(store));
              } catch (e) {
                send(400, { error: adminErrorText(e, this.host) });
              }
            }
          } else if (typeof body.on !== 'boolean') send(400, { error: 'Send {"on": true} or {"on": false}' });
          else {
            store.setPiiIsolation(body.on, { account: 'admin console' });
            // Off: the stand-ins aren't needed any more, so the values kept for them go.
            if (!body.on) forgetVault(store);
            this.log(`Personal data isolation turned ${body.on ? 'on' : 'off'} for ${store.name}`);
            send(200, piiPreview(store));
          }
        } else send(405, { error: 'method not allowed' });
      } else if (path.startsWith('/tabularius/admin/v1/conversion-guide/') && this.guides) {
        // GET: the file's guide (made now if there's none for its conversion yet); POST: made again.
        const store = this.host.get(decodeURIComponent(path.slice('/tabularius/admin/v1/conversion-guide/'.length)));
        if (!store) send(404, { error: 'No such hosted file' });
        else if (req.method === 'GET') send(200, await this.guides.get(store));
        else if (req.method === 'POST') send(200, await this.guides.make(store));
        else send(405, { error: 'method not allowed' });
      } else if ((path === '/tabularius/admin/v1/digests' || path.startsWith('/tabularius/admin/v1/digests/')) && this.digests) {
        const m = /^\/tabularius\/admin\/v1\/digests(?:\/([^/]+)\/([0-9a-f]{12})\/run)?$/.exec(path);
        const store = m?.[1] ? this.host.get(decodeURIComponent(m[1])) : undefined;
        const digest = store && m?.[2] ? new Digests(store).get(m[2]) : undefined;
        if (m && !m[1] && req.method === 'GET') send(200, { digests: this.digests.all() });
        else if (m?.[1] && req.method === 'POST') {
          if (!store || !digest) send(404, { error: 'No such digest' });
          else {
            const { data: _d, ...run } = await this.digests.run(store, digest);
            send(200, { run });
          }
        } else send(404, { error: 'not found' });
      } else if (path.startsWith('/tabularius/admin/v1/optimization/')) {
        // What would make the file smaller or faster. Asking changes nothing; a fix is made only by a POST that names it,
        // after a POST with preview: true has listed exactly what it does, and undo puts the latest back. Container files
        // are moved out to managed external storage by a POST to /containers, and back by /containers/undo.
        const rest = path.slice('/tabularius/admin/v1/optimization/'.length);
        const parts = rest.split('/');
        const verb = ['fix', 'undo', 'containers', 'containers/undo'].find((v) => parts.length > 1 && rest.endsWith(`/${v}`) && parts.length === v.split('/').length + 1);
        const store = this.host.get(decodeURIComponent(verb ? parts[0]! : rest));
        if (!store) send(404, { error: 'No such hosted file' });
        else if (!verb && req.method === 'GET') send(200, { ...optimizationReport(store), containerMoves: containerMoves(store) });
        else if (verb === 'containers' && req.method === 'GET') send(200, { moves: containerMoves(store) });
        else if (!verb || req.method !== 'POST') send(405, { error: 'method not allowed' });
        else if (verb.startsWith('containers')) {
          const body = await readJson(req);
          try {
            if (verb === 'containers/undo') {
              if (!Number.isInteger(body.id)) throw new Error('Send {id}: the number of a move in the report\'s list');
              const r = undoContainerMove(store, body.id as number, { account: 'admin console' });
              this.log(`${store.name}: ${r.moved} container file${r.moved === 1 ? '' : 's'} of ${r.move.table}::${r.move.field} put back in the database${r.missing ? ` (${r.missing} missing from the folder)` : ''}`);
              send(200, { moved: r.moved, bytes: r.bytes, missing: r.missing, undone: r.move.id });
            } else if (typeof body.table !== 'string' || typeof body.field !== 'string') send(400, { error: 'Send {table, field}' });
            else {
              const r = moveContainersToManagedStorage(store, body.table, body.field, {
                preview: body.preview === true, expect: Number.isInteger(body.expect) ? body.expect as number : undefined,
                compact: body.compact !== false, account: 'admin console',
              });
              if (r.move) this.log(`${store.name}: ${r.move.moved} container file${r.move.moved === 1 ? '' : 's'} of ${r.move.table}::${r.move.field} moved out to managed external storage`);
              send(200, r);
            }
          } catch (e) {
            send(400, { error: adminErrorText(e, this.host) });
          }
        } else {
          const body = await readJson(req);
          try {
            if (verb === 'undo') send(200, undoFix(store, typeof body.id === 'number' ? body.id : undefined));
            else if (!FIXES.includes(body.fix as FixId)) send(400, { error: `Send {fix}: one of ${FIXES.join(', ')}` });
            else {
              const items = Array.isArray(body.items) ? body.items.filter((x): x is string => typeof x === 'string') : undefined;
              send(200, body.preview === true ? previewFix(store, body.fix as FixId, items)
                : applyFix(store, body.fix as FixId, { items, count: typeof body.count === 'number' ? body.count : undefined }));
            }
          } catch (e) {
            if (e instanceof FixError) send(e.status, { error: e.message });
            else throw e;
          }
        }
      } else if (path === '/tabularius/admin/v1/profile/finds' && this.profiler && req.method === 'GET') {
        send(200, { finds: findAdvice((n) => this.host.get(n), this.profiler.findReport(200), { file: url.searchParams.get('database') ?? undefined }) });
      } else if (path === '/tabularius/admin/v1/indexes' && req.method === 'POST') {
        const body = await readJson(req);
        const store = typeof body.database === 'string' ? this.host.get(body.database) : undefined;
        if (!store) send(404, { error: 'No such hosted file' });
        else if (typeof body.table !== 'string' || typeof body.field !== 'string') send(400, { error: 'Send {database, table, field}' });
        else {
          try {
            send(200, store.addFieldIndex(body.table, body.field));
          } catch (e) {
            send(400, { error: adminErrorText(e, this.host) });
          }
        }
      } else if (path === '/tabularius/admin/v1/script-tests' && req.method === 'GET') {
        send(200, { files: this.scriptTestCounts(), ...(this.testing ? { running: this.testing } : {}) });
      } else if (path === '/tabularius/admin/v1/script-tests/run' && req.method === 'POST') {
        const body = await readJson(req) as { database?: unknown };
        const store = typeof body.database === 'string' ? this.host.get(body.database) : undefined;
        if (!store) send(404, { error: 'No such hosted file' });
        else if (this.testing) send(409, { error: `The script tests of ${this.testing} are running; try again when they finish` });
        else {
          const r = await this.runScriptTests(store) as { status?: number };
          send(r.status ?? 200, r);
        }
      } else if (path === '/tabularius/admin/v1/profile' && this.profiler && (req.method === 'GET' || req.method === 'DELETE')) {
        if (req.method === 'DELETE') this.profiler.reset();
        send(200, this.profiler.report(queryInteger(url.searchParams, 'limit', 200) ?? 50));
      } else if (path === '/tabularius/admin/v1/records/restore' && req.method === 'POST') {
        // A record put back as it was at a point in its audit history.
        const b = await readJson(req) as { database?: string; table?: string; recordId?: number; seq?: number };
        const store = b.database ? this.host.get(b.database) : undefined;
        if (!store || !b.table || !Number.isInteger(b.recordId) || !Number.isInteger(b.seq)) send(400, { error: 'give database, table, recordId and seq' });
        else {
          const r = store.restoreRecord(b.table, b.recordId!, b.seq!, { account: 'admin console' });
          this.log(`${store.name}: ${b.table} #${b.recordId} put back as it was after audit entry ${b.seq} (${r.action})`);
          send(200, r);
        }
      } else if (path === '/tabularius/admin/v1/audit' && req.method === 'GET') {
        this.audit(url, res, send);
      } else if (path === '/tabularius/admin/v1/audit/verify' && req.method === 'GET') {
        // Whether the record audit log still hangs together: no entry changed, removed from the middle or added behind its back.
        const wanted = url.searchParams.get('database') ?? '';
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        if (!store) send(400, { error: 'name a hosted database with ?database=' });
        else {
          const abort = new AbortController();
          const disconnected = () => abort.abort();
          res.once('close', disconnected);
          try {
            if (res.destroyed) abort.abort();
            const job = this.securityAudit.verify(store.path, abort.signal, 'records');
            if (!job) send(503, { error: 'audit verification is busy; try again' });
            else send(200, { database: name, ...await job });
          } catch (e) {
            if (!res.destroyed) throw e;
          } finally {
            res.removeListener('close', disconnected);
          }
        }
      } else if (path === '/tabularius/admin/v1/audit/settings' && (req.method === 'GET' || req.method === 'PUT')) {
        // What the record audit log never keeps values of: fields named like passwords and keys, and fields named here.
        const name = this.host.names().find((n) => n.toLowerCase() === (url.searchParams.get('database') ?? '').toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        if (!store) send(400, { error: 'name a hosted database with ?database=' });
        else if (req.method === 'GET') send(200, { database: name, ...store.auditSettings(), suggested: store.auditSuggestedExclusions() });
        else {
          const b = await readJson(req) as { redactSensitive?: unknown; excludeFields?: unknown; retentionDays?: unknown; logReads?: unknown };
          const ex = b.excludeFields;
          if ((b.retentionDays !== undefined && (typeof b.retentionDays !== 'number' || !Number.isInteger(b.retentionDays)))
            || (b.redactSensitive !== undefined && typeof b.redactSensitive !== 'boolean') || (b.logReads !== undefined && typeof b.logReads !== 'boolean')
            || (ex !== undefined && (typeof ex !== 'object' || ex === null || Array.isArray(ex) || Object.values(ex).some((v) => !Array.isArray(v) || v.some((x) => typeof x !== 'string'))))) {
            send(400, { error: 'give redactSensitive and/or logReads (true or false), excludeFields ({ "Table": ["Field"] }) and/or retentionDays (a whole number, 0 to keep every entry)' });
          } else {
            try {
              const next = store.setAuditSettings({ ...(b.redactSensitive !== undefined ? { redactSensitive: b.redactSensitive as boolean } : {}), ...(ex !== undefined ? { excludeFields: ex as Record<string, string[]> } : {}), ...(b.retentionDays !== undefined ? { retentionDays: b.retentionDays as number } : {}), ...(b.logReads !== undefined ? { logReads: b.logReads as boolean } : {}) });
              this.log(`${store.name}: audit log settings changed (${next.redactSensitive ? 'sensitive names redacted' : 'sensitive names logged'}; ${Object.values(next.excludeFields).flat().length} excluded fields; ${next.retentionDays ? `kept ${next.retentionDays} days` : 'kept forever'})`);
              send(200, { database: name, ...next });
            } catch (e) {
              send(400, { error: adminErrorText(e, this.host) });
            }
          }
        }
      } else if (path === '/tabularius/admin/v1/security-events' && req.method === 'GET') {
        this.securityEvents(url, res, send);
      } else if (path === '/tabularius/admin/v1/security-events/verify' && req.method === 'GET') {
        const wanted = url.searchParams.get('database') ?? '';
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        if (!store) send(400, { error: 'name a hosted database with ?database=' });
        else {
          const abort = new AbortController();
          const disconnected = () => abort.abort();
          res.once('close', disconnected);
          try {
            if (res.destroyed) abort.abort();
            const job = this.securityAudit.verify(store.path, abort.signal);
            if (!job) send(503, { error: 'security audit verification is busy; try again' });
            else send(200, { database: name, ...await job });
          } catch (e) {
            if (!res.destroyed) throw e;
          } finally {
            res.removeListener('close', disconnected);
          }
        }
      } else if (path === '/tabularius/admin/v1/view-as' && req.method === 'GET') {
        send(200, this.viewAs(url));
      } else if (path === '/tabularius/admin/v1/access' && req.method === 'GET') {
        send(200, this.accessExplained(url));
      } else if (path === '/tabularius/admin/v1/test-account' && req.method === 'GET') {
        send(200, this.testAccount(url));
      } else if (path === '/tabularius/admin/v1/compare' && req.method === 'GET') {
        send(200, this.compareSets(url));
      } else if (path === '/tabularius/admin/v1/sso-mapping/test' && req.method === 'GET') {
        send(200, this.ssoMappingTest(url));
      } else if (path === '/tabularius/admin/v1/field-access' && req.method === 'GET') {
        send(200, this.fieldAccess(url));
      } else if (path === '/tabularius/admin/v1/field-access' && req.method === 'POST') {
        const body = await readJson(req) as { database?: unknown; privilegeSet?: unknown; table?: unknown; field?: unknown; access?: unknown; mask?: unknown };
        const wanted = said(body.database);
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        const setName = said(body.privilegeSet);
        const table = said(body.table);
        const field = said(body.field);
        const access = said(body.access);
        if (!store) send(404, { error: `"${wanted}" is not hosted` });
        else if (!['modifiable', 'viewOnly', 'masked', 'none'].includes(access)) send(400, { error: 'access must be "modifiable", "viewOnly", "masked" or "none"' });
        else {
          const set = store.privilegeSet(setName);
          if (!set) send(400, { error: `No privilege set "${setName}"` });
          else if (isFullAccess(set)) send(400, { error: '[Full Access] always sees and can change every field' });
          else if (!store.schema.tables.some((t) => t.name === table && t.fields.some((f) => f.name === field))) {
            send(400, { error: `No field "${table}::${field}"` });
          } else {
            try {
              const tables = { ...(set.tables ?? {}) };
              const current = tables[table] ?? { ...set.records };
              const fields = { ...(current.fields ?? {}) };
              // Back to the table's own default (none listed) when that's exactly what's being set, so this
              // never grows the definition with entries that change nothing.
              const atDefault = access === 'modifiable' && current.fieldsDefault !== 'none';
              if (atDefault) delete fields[field]; else fields[field] = access as FieldLevel;
              // A mask belongs only to a masked field: setting any other level drops it. A masked field with
              // no mask shows its last four characters.
              const masks = { ...(current.masks ?? {}) };
              const before = masks[field];
              delete masks[field];
              if (access === 'masked' && (body.mask === undefined || body.mask === null) && before && current.fields?.[field] === 'masked') {
                // Re-saving as masked without naming a mask keeps the one the field has.
                masks[field] = before;
              } else if (access === 'masked') {
                const m = body.mask as { kind?: unknown; text?: unknown } | undefined;
                if (m !== undefined && m !== null && (typeof m !== 'object' || (m.kind !== 'last4' && m.kind !== 'placeholder'))) throw new Error('mask.kind must be "last4" or "placeholder"');
                if (m && typeof m === 'object') {
                  // Naming only the kind of the mask it already has keeps its text.
                  const text = typeof m.text === 'string' ? (m.text.trim() ? m.text : undefined) : m.text === undefined && before?.kind === m.kind ? before.text : undefined;
                  masks[field] = { kind: m.kind as 'last4' | 'placeholder', ...(text ? { text } : {}) };
                }
              }
              tables[table] = { ...current, fields: Object.keys(fields).length ? fields : undefined, masks: Object.keys(masks).length ? masks : undefined };
              const saved = store.savePrivilegeSet({ ...set, tables });
              this.log(`${store.name}: ${table}::${field} set to ${access} for the ${setName} privilege set from the admin console`);
              const pv = store.privilegesForSet(saved.name);
              send(200, { ok: true, access: pv.fieldAccess(table, field), mask: pv.mask(table, field) ?? null });
            } catch (e) { send(400, { error: adminErrorText(e, this.host) }); }
          }
        }
      } else if (path === '/tabularius/admin/v1/sso-mapping' && req.method === 'GET') {
        send(200, this.ssoMapping(url));
      } else if (path === '/tabularius/admin/v1/sso-mapping' && req.method === 'POST') {
        const body = await readJson(req) as { database?: unknown; name?: unknown; privilegeSet?: unknown };
        const wanted = said(body.database);
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        const group = said(body.name).trim();
        const privilegeSet = said(body.privilegeSet);
        if (!store) send(404, { error: `"${wanted}" is not hosted` });
        else if (!group) send(400, { error: 'name a group, an email address, or "@domain"' });
        else {
          try {
            store.setExternalAccount(group, privilegeSet);
            this.log(`${store.name}: SSO mapping "${group}" set to the ${privilegeSet} privilege set from the admin console`);
            send(200, { ok: true });
          } catch (e) { send(400, { error: adminErrorText(e, this.host) }); }
        }
      } else if (/^\/tabularius\/admin\/v1\/sso-mapping\/[^/]+$/.test(path) && req.method === 'DELETE') {
        const wanted = url.searchParams.get('database') ?? '';
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        const group = decodeURIComponent(path.split('/')[5]);
        if (!store) send(404, { error: `"${wanted}" is not hosted` });
        else if (!store.accounts().some((a) => a.name.toLowerCase() === group.toLowerCase() && a.external)) {
          // This route is "remove an SSO mapping", not "remove any account": a name that
          // isn't currently an external mapping (an unmapped name, or a real
          // password/agent account that merely happens to share it) is refused rather
          // than falling through to Store.deleteAccount, which makes no such distinction.
          send(400, { error: `"${group}" is not an SSO mapping in ${wanted}` });
        } else {
          try {
            this.log(`${store.name}: SSO mapping "${group}" removed from the admin console`);
            send(200, { removed: store.deleteAccount(group) });
          } catch (e) { send(400, { error: adminErrorText(e, this.host) }); }
        }
      } else if (path === '/tabularius/admin/v1/access-review' && req.method === 'GET') {
        this.accessReview(url, res, send);
      } else if (path === '/tabularius/admin/v1/plugin-readiness' && req.method === 'GET') {
        this.pluginReadiness(url, res, send);
      } else if (path === '/tabularius/admin/v1/health' && req.method === 'GET') {
        send(200, this.health(url));
      } else if (path === '/tabularius/admin/v1/least-privilege' && req.method === 'GET') {
        send(200, this.leastPrivilege(url));
      } else if (path === '/tabularius/admin/v1/who-can' && req.method === 'GET') {
        const wanted = url.searchParams.get('database') ?? '';
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        if (!store) send(200, { error: 'name a hosted database with ?database=' });
        else {
          try { send(200, whoCan(store, url.searchParams.get('table') ?? '', url.searchParams.get('field') ?? undefined)); } catch (e) { send(200, { error: adminErrorText(e, this.host) }); }
        }
      } else if (path === '/tabularius/admin/v1/usage' && req.method === 'GET') {
        send(200, this.usage(url));
      } else if (path === '/tabularius/admin/v1/unusual-access' && req.method === 'GET') {
        send(200, this.unusualAccess(url));
      } else if (path === '/tabularius/admin/v1/solution-map' && req.method === 'GET') {
        // The cross-file dependency graph across every hosted file. The console
        // is the administrator's own view, so it shows every file in full,
        // AI-off ones included (unlike the solution_map MCP tool).
        send(200, solutionMap(this.host.openStores()));
      } else if (path === '/tabularius/admin/v1/health/revoke-token' && req.method === 'POST') {
        const body = await readJson(req) as { database?: unknown; id?: unknown };
        const wanted = said(body.database);
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        if (!store) send(404, { error: `"${wanted}" is not hosted` });
        else send(200, { revoked: store.revokeApiToken(said(body.id)) });
      } else if (path === '/tabularius/admin/v1/health/fix-account' && req.method === 'POST') {
        // The safe one-click fixes for an empty-password account: give it a
        // temporary password (and force a change), or deactivate it.
        const body = await readJson(req) as { database?: unknown; account?: unknown; action?: unknown };
        const wanted = said(body.database);
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        const account = said(body.account);
        if (!store) send(404, { error: `"${wanted}" is not hosted` });
        else if (!account) send(400, { error: 'account is required' });
        else if (body.action === 'set-temp-password') {
          const [made] = store.migrateAccounts({ accounts: [account] });
          if (!made) send(400, { error: `"${account}" can't be given a temporary password (it may be external or already have one)` });
          else send(200, { account: made.account, password: made.password, health: store.securityHealth() });
        } else if (body.action === 'deactivate') {
          send(200, { deactivated: store.setAccountActive(account, false), health: store.securityHealth() });
        } else {
          send(400, { error: 'action must be "set-temp-password" or "deactivate"' });
        }
      } else if (path === '/tabularius/admin/v1/accounts/set-password' && req.method === 'POST') {
        // A password for any existing account, from the console — for when an account can't sign in to use Manage
        // Security itself (a converted file whose FileMaker password couldn't carry over; see checkFmp12Password),
        // so getting it a working password needs no Terminal access to the machine.
        const body = await readJson(req) as { database?: unknown; account?: unknown; password?: unknown; mustChange?: unknown };
        const wanted = said(body.database);
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        const account = said(body.account);
        // Resolve to the account's own stored casing before writing: setPassword's upsert matches by exact name
        // (the accounts table has no case-insensitive collation), so passing the admin-typed casing straight through
        // can insert a second, near-duplicate account instead of updating the one that's actually locked out.
        const accountName = store?.accounts().find((a) => a.name.toLowerCase() === account.toLowerCase())?.name;
        const password = said(body.password);
        if (!store) send(404, { error: `"${wanted}" is not hosted` });
        else if (!account || !accountName) send(400, { error: `No account "${account}" in ${wanted}` });
        else if (!password) send(400, { error: 'password is required' });
        else {
          try {
            store.setPassword(accountName, password, undefined, { mustChange: !!body.mustChange });
            // A new password from the console invalidates whatever sessions were signed in on the old one.
            this.api.endByAccount(store.name, accountName);
            this.log(`${store.name}: password set for ${accountName} from the admin console`);
            send(200, { ok: true });
          } catch (e) { send(400, { error: adminErrorText(e, this.host) }); }
        }
      } else if (path === '/tabularius/admin/v1/accounts/unlock' && req.method === 'POST') {
        // Lifts a sign-in lockout on an account, from every place it was blocked. A wrong password keeps retrying
        // this; it does not itself need a Terminal, but asking for a new password (set-password, above) already
        // does this too, so this is for when the password typed is right and only the lockout is in the way.
        const body = await readJson(req) as { database?: unknown; account?: unknown; address?: unknown };
        const wanted = said(body.database);
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        const account = said(body.account);
        const address = said(body.address).trim();
        if (!store) send(404, { error: `"${wanted}" is not hosted` });
        else if (address && account) send(400, { error: 'Give an account or an address, not both' });
        else if (address && !isIP(address)) send(400, { error: `"${address}" is not an IP address` });
        else if (address) {
          // An address blocked after too many failed sign-ins across names (see LOCKOUT.addressAttempts).
          const cleared = store.unlockAddress(address);
          if (cleared) store.auditLockoutCleared(address, 'address', clientAddress(req));
          this.log(`${store.name}: sign-in block ${cleared ? 'cleared' : 'not found'} for address ${address} from the admin console`);
          send(200, { ok: true, cleared });
        } else if (!account || !store.accounts().some((a) => a.name.toLowerCase() === account.toLowerCase())) send(400, { error: `No account "${account}" in ${wanted}` });
        else {
          const cleared = store.unlock(account);
          if (cleared) store.auditLockoutCleared(account, 'account', clientAddress(req));
          this.log(`${store.name}: lockout ${cleared ? 'cleared' : 'not found'} for ${account} from the admin console`);
          send(200, { ok: true, cleared });
        }
      } else if (path === '/tabularius/admin/v1/accounts/migrate-all' && req.method === 'POST') {
        // A temporary password, forced to change at next sign-in, for every account still stuck on its FileMaker
        // password (Store.unmigratedAccounts — blank ones and the non-blank, unverifiable ones alike), in one go.
        // The conversion report and security health page list who that is; this is what to do about all of them
        // without visiting each one. Each password is shown here once and never stored or logged in clear.
        const body = await readJson(req) as { database?: unknown };
        const wanted = said(body.database);
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        if (!store) send(404, { error: `"${wanted}" is not hosted` });
        else {
          const migrated = store.migrateAccounts();
          this.log(`${store.name}: ${migrated.length} account${migrated.length === 1 ? '' : 's'} given a temporary password from the admin console`);
          send(200, { migrated, health: store.securityHealth() });
        }
      } else if (path === '/tabularius/admin/v1/accounts/blank-password-lan' && req.method === 'GET') {
        const wanted = url.searchParams.get('database') ?? '';
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        if (!store) send(404, { error: `"${wanted}" is not hosted` });
        else send(200, { database: name, on: store.allowBlankPasswordFromLan() });
      } else if (path === '/tabularius/admin/v1/accounts/blank-password-lan' && req.method === 'POST') {
        const body = await readJson(req) as { database?: unknown; on?: unknown };
        const wanted = said(body.database);
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        if (!store) send(404, { error: `"${wanted}" is not hosted` });
        else {
          store.setAllowBlankPasswordFromLan(!!body.on);
          this.log(`${store.name}: empty-password accounts ${body.on ? 'allowed from the LAN' : 'limited to this computer again'} (admin console)`);
          send(200, { database: name, on: store.allowBlankPasswordFromLan() });
        }
      } else if (path.startsWith('/tabularius/admin/v1/stale-calcs')) {
        // Stored calculations behind their formula (store/src/stale-calcs.ts):
        // GET checks one file and changes nothing; refresh and undo are one
        // batch each, all or none, written to the file's audit log.
        const body = req.method === 'POST' ? await readJson(req) as { database?: unknown; fields?: unknown; id?: unknown } : {};
        const wanted = String((req.method === 'GET' ? url.searchParams.get('database') : body.database) ?? '');
        const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
        const store = name ? this.host.get(name) : undefined;
        const sub = path.slice('/tabularius/admin/v1/stale-calcs'.length);
        if (!store) send(404, { error: `"${wanted}" is not hosted` });
        else if (sub === '' && req.method === 'GET') {
          const limit = queryInteger(url.searchParams, 'limit', 1000);
          send(200, { ...findStaleCalcs(store, { limit, examples: true }), history: staleRefreshHistory(store) });
        } else if (sub === '/refresh' && req.method === 'POST') {
          const r = refreshStaleCalcs(store, { fields: body.fields as { table: string; field: string }[] }, { account: 'admin console' });
          this.log(`${store.name}: ${r.summary} (refresh ${r.id})`);
          send(200, { ...r, history: staleRefreshHistory(store) });
        } else if (sub === '/undo' && req.method === 'POST') {
          const r = undoStaleRefresh(store, said(body.id), { account: 'admin console' });
          this.log(`${store.name}: stale calculation refresh ${String(body.id)} undone (${r.undone} put back, ${r.skipped} changed since and left alone)`);
          send(200, { ...r, history: staleRefreshHistory(store) });
        } else send(404, { error: 'not found' });
      } else if (path === '/tabularius/admin/v1/sessions' && req.method === 'GET') {
        // Who is signed in (who, where, device, how long), for the security page.
        const wanted = url.searchParams.get('database');
        const sessions = this.api.list().filter((s) => !wanted || s.db.toLowerCase() === wanted.toLowerCase());
        send(200, { sessions });
      } else if (path === '/tabularius/admin/v1/sessions/end' && req.method === 'POST') {
        // Sign out one session (by id) or every session for one account on a file.
        const body = await readJson(req) as { id?: unknown; database?: unknown; account?: unknown };
        if (body.id !== undefined) {
          send(200, { ended: this.api.endById(String(body.id)) ? 1 : 0 });
        } else if (body.database !== undefined && body.account !== undefined) {
          const wanted = String(body.database);
          const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
          if (!name) send(404, { error: `"${wanted}" is not hosted` });
          else send(200, { ended: this.api.endByAccount(name, String(body.account)) });
        } else {
          send(400, { error: 'give an id, or a database and account' });
        }
      } else if (path === '/tabularius/admin/v1/restore' && req.method === 'GET') {
        send(200, this.restorePoints());
      } else if (path === '/tabularius/admin/v1/restore' && req.method === 'POST') {
        send(200, await this.restore(await readJson(req) as Record<string, unknown>));
      } else if (path.startsWith('/tabularius/admin/v1/logs') && req.method === 'GET' && this.logs) {
        await this.handleLogs(res, path, url, send);
      } else if (path === '/tabularius/admin/v1/plugins' || path.startsWith('/tabularius/admin/v1/plugins/')) {
        await this.handlePlugins(req, path, send);
      } else if (path === '/tabularius/admin/v1/outbox' || path.startsWith('/tabularius/admin/v1/outbox/')) {
        const box = this.host.outbox;
        const m = /^\/tabularius\/admin\/v1\/outbox(?:\/([0-9a-f]+))?$/.exec(path);
        if (!m) send(404, { error: 'not found' });
        else if (!box) send(404, { error: 'outbound test mode is off (serve --test-outbound)' });
        else if (!m[1] && req.method === 'GET') send(200, { ...this.outboundStatus(), entries: box.list(queryInteger(url.searchParams, 'limit', 1000) ?? 200) });
        else if (!m[1] && req.method === 'DELETE') {
          box.clear();
          send(200, {});
        } else if (m[1] && req.method === 'GET') {
          const e = box.get(m[1]);
          send(e ? 200 : 404, e ?? { error: 'not found' });
        } else send(405, { error: 'method not allowed' });
      } else if ((path === '/tabularius/admin/v1/mcp' || path.startsWith('/tabularius/admin/v1/mcp/')) && this.mcpTokens) {
        const t = this.mcpTokens;
        const m = /^\/tabularius\/admin\/v1\/mcp(?:\/tokens(?:\/([0-9a-f]+))?)?$/.exec(path);
        if (!m) send(404, { error: 'not found' });
        else if (path === '/tabularius/admin/v1/mcp' && req.method === 'GET') send(200, { tokens: this.mcpTokenList(t), files: this.mcpAccounts() });
        else if (path === '/tabularius/admin/v1/mcp/tokens' && req.method === 'POST') {
          const body = await readJson(req) as { database?: string; account?: string; agent?: { name?: string; privilegeSet?: string; needsApproval?: boolean }; label?: string; days?: number; readOnly?: boolean; layouts?: string[] };
          const store = this.host.get(said(body.database));
          if (!store) send(400, { error: `No hosted file is named ${JSON.stringify(body.database ?? '')}` });
          else {
            try {
              // A new AI agent account: no password, never [Full Access], and its writes optionally held for a person to approve.
              if (body.agent) {
                const name = said(body.agent.name).trim();
                if (!name) throw new StoreError(960, 'Give the AI agent a name');
                store.setAgentAccount(name, said(body.agent.privilegeSet), { createdBy: 'admin console', needsApproval: body.agent.needsApproval === true });
                this.log(`AI agent ${name} added to ${store.name} (${body.agent.privilegeSet}${body.agent.needsApproval ? ', changes need approval' : ''})`);
              }
              const wanted = String(body.agent ? body.agent.name : body.account ?? '').trim().toLowerCase();
              const account = store.accounts().find((a) => a.name.toLowerCase() === wanted && !a.inactive);
              if (!account) throw new StoreError(960, `${store.name} has no account named ${JSON.stringify(said(body.account))}`);
              const days = body.days === undefined || body.days === null ? undefined : body.days;
              if (days !== undefined && !(typeof days === 'number' && Number.isInteger(days) && days > 0 && days <= 3650)) throw new StoreError(960, 'Days should be from 1 to 3650, or empty for no expiry');
              const label = said(body.label).trim().slice(0, 200) || `AI app: ${account.name} in ${store.name}`;
              const token = store.createApiToken(account.name, {
                label, surfaces: ['fmmcp'], readOnly: body.readOnly === true, ...(days ? { expires: new Date(expiryClock.now() + days * 86_400_000) } : {}),
                ...(Array.isArray(body.layouts) && body.layouts.length ? { layouts: body.layouts.map(String) } : {}),
                provenance: 'service',
              });
              const made = store.apiTokens().find((x) => token.startsWith(`ohbt_${x.id}.`))!;
              const ai = store.privileges(account.name).has('fmmcp');
              this.log(`AI app token "${label}" made for ${account.name} in ${store.name}`);
              // Either way the token signs in, then every call on this file is refused: say so now, not at the first call.
              const warning = !ai ? `The "${account.privilegeSet}" privilege set doesn't have the fmmcp extended privilege (AI access), so this token can't be used until it does`
                : !store.aiAllowed ? `${store.aiOffMessage()}${store.aiExcludedByServer && !store.aiTurnedOff ? '' : ', so this token can\'t read it until it is turned on'}` : undefined;
              send(201, { ...made, database: store.name, token, ...(warning ? { warning } : {}) });
            } catch (e) {
              send(400, { error: adminErrorText(e, this.host) });
            }
          }
        } else if (m[1] && req.method === 'DELETE') {
          // An older admin console token, or a file's API token.
          let gone = t.revoke(m[1]);
          for (const store of this.host.openStores()) if (!gone && store.apiTokens().some((x) => x.id === m[1])) gone = store.revokeApiToken(m[1]);
          if (gone) this.log(`AI app token ${m[1]} revoked`);
          send(gone ? 200 : 404, {});
        } else send(405, { error: 'method not allowed' });
      } else if (path === '/tabularius/admin/v1/message' && req.method === 'POST') {
        // Broadcast a message to every connected web client.
        const raw = (await readJson(req)).text;
        const text = typeof raw === 'string' ? raw.trim() : '';
        if (!text) send(400, { error: 'a message is required' });
        else if (text.length > 200) send(400, { error: 'a message is at most 200 characters' });
        else send(200, { delivered: this.live?.message(text) ?? 0 });
      } else {
        const disconnect = /^\/tabularius\/admin\/v1\/clients\/([0-9a-f]+)\/disconnect$/.exec(path);
        const message = /^\/tabularius\/admin\/v1\/clients\/([0-9a-f]+)\/message$/.exec(path);
        if (disconnect && req.method === 'POST') send(this.api.endById(disconnect[1]) ? 200 : 404, {});
        else if (message && req.method === 'POST') {
          // Message one connected client; 404 if it is no longer connected.
          const raw = (await readJson(req)).text;
          const text = typeof raw === 'string' ? raw.trim() : '';
          const token = text ? this.api.tokenById(message[1]) : undefined;
          if (!text) send(400, { error: 'a message is required' });
          else if (text.length > 200) send(400, { error: 'a message is at most 200 characters' });
          else if (!token) send(404, {});
          else send(200, { delivered: this.live?.message(text, token) ?? 0 });
        } else send(404, { error: 'not found' });
      }
    } catch (e) {
      const status = e instanceof SyncConsoleError || e instanceof ApiError ? e.status : e instanceof URIError || e instanceof ScheduleError || e instanceof WebhookError || e instanceof HookError || e instanceof StaleCalcError ? 400 : e instanceof StoreError ? (e.code === 301 ? 409 : 400) : e instanceof UploadError || e instanceof RestoreError ? e.status : 500;
      if (status === 500) console.error(e);
      send(status, { error: status === 500 ? 'Internal server error' : adminErrorText(e, this.host) });
    } finally { done(); }
    return true;
  }

  /** The plug-ins page: what's installed (from the server's plugins folder), who signed it, and what it may do. */
  private plugins() {
    const st = pluginStatus(this.host.dir);
    return {
      plugins: st.installed.map((m) => ({
        id: m.id, name: m.name, version: m.version, publisher: m.publisher, runtime: m.runtime,
        functions: m.functions.map((f) => f.name),
        permissions: { files: m.permissions.files, network: m.permissions.network, mail: m.permissions.mail },
        // From a package (signer null when unsigned); null for a plug-in put in the folder by hand.
        package: st.installs[m.id] ? { signer: st.installs[m.id].signer ?? null, installedAt: st.installs[m.id].installedAt } : null,
        enabledFor: Object.entries(st.enabled).filter(([, ids]) => ids.includes(m.id)).map(([file]) => file),
        secrets: m.permissions.secrets.map((name) => ({ name, set: !!st.secrets[m.id]?.includes(name) })),
      })),
      // Packs that ship inside Tabularius: on for every file unless turned off.
      builtins: st.builtins.map((b) => ({
        id: b.id, name: b.name, publisher: b.publisher, description: b.description,
        enabledFor: this.host.names().filter((f) => !b.offFor.some((o) => o.toLowerCase() === f.toLowerCase())),
      })),
      files: this.host.names(),
      problems: st.problems,
    };
  }

  private async handlePlugins(req: IncomingMessage, path: string, send: (status: number, body: unknown) => void): Promise<void> {
    const m = /^\/tabularius\/admin\/v1\/plugins(?:\/([^/]+)\/(enable|disable|secrets\/([A-Z][A-Z0-9_]*)))?$/.exec(path);
    if (!m) return send(404, { error: 'not found' });
    if (!m[1]) return req.method === 'GET' ? send(200, this.plugins()) : send(405, { error: 'method not allowed' });
    const id = decodeURIComponent(m[1]);
    const builtin = BUILTIN_PACKS.some((p) => p.id === id);
    if (!builtin && !this.host.plugins.manifests().some((p) => p.id === id)) return send(404, { error: `${id} isn't installed` });
    try {
      if (m[2] === 'enable' || m[2] === 'disable') {
        if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
        const body = await readJson(req) as Record<string, unknown>;
        const file = this.host.names().find((n) => n.toLowerCase() === said(body.file).toLowerCase());
        if (!file) return send(404, { error: 'that file is not hosted here' });
        const on = m[2] === 'enable';
        // enabled.json first (it checks the plug-in the way the server will), then the running server.
        setPluginEnabled(this.host.dir, file, id, on);
        if (builtin) this.host.plugins.setBuiltin(file, id, on);
        else if (on) this.host.plugins.enable(file, id);
        else this.host.plugins.disable(file, id);
        this.log(`plug-in ${id} ${on ? 'enabled' : 'disabled'} for ${file} from the console`);
        return send(200, this.plugins());
      }
      const name = m[3];
      if (builtin) return send(400, { error: `${id} is built in and has no secrets` });
      if (req.method === 'PUT') {
        const value = (await readJson(req) as Record<string, unknown>).value;
        if (typeof value !== 'string' || !value) return send(400, { error: 'give the secret as {"value": "..."}' });
        setPluginSecret(this.host.dir, id, name, value);
      } else if (req.method === 'DELETE') {
        setPluginSecret(this.host.dir, id, name, undefined);
      } else return send(405, { error: 'method not allowed' });
      // The value is never logged.
      this.log(`plug-in ${id}: secret ${name} ${req.method === 'PUT' ? 'set' : 'cleared'} from the console`);
      return send(200, this.plugins());
    } catch (e) {
      return send(400, { error: adminErrorText(e, this.host) });
    }
  }

  private async handleConnections(req: IncomingMessage, path: string, send: (status: number, body: unknown) => void): Promise<void> {
    const c = this.connections!;
    const m = /^\/tabularius\/admin\/v1\/connections(?:\/([0-9a-f]+)(?:\/(approve|test)|\/secrets\/([A-Za-z][A-Za-z0-9]*))?)?$/.exec(path);
    if (!m) return send(404, { error: 'not found' });
    const all = () => ({ types: c.types(), connections: c.list(), ...(c.problem ? { problem: c.problem } : {}) });
    try {
      if (!m[1]) {
        if (req.method === 'GET') return send(200, all());
        if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
        const made = c.create(await readJson(req) as Record<string, unknown>);
        return send(201, c.get(made.id));
      }
      const id = m[1];
      if (m[2] === 'approve' || m[2] === 'test') {
        if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
        if (m[2] === 'approve') return send(200, c.get(c.approve(id).id));
        return send(200, { ...(await c.test(id)), connection: c.get(id) });
      }
      if (m[3]) {
        if (req.method === 'PUT') {
          const value = (await readJson(req) as Record<string, unknown>).value;
          if (typeof value !== 'string' || !value) return send(400, { error: 'give the secret as {"value": "..."}' });
          c.setSecret(id, m[3], value);
        } else if (req.method === 'DELETE') c.setSecret(id, m[3], undefined);
        else return send(405, { error: 'method not allowed' });
        return send(200, c.get(id));
      }
      if (req.method === 'GET') return send(200, c.get(id));
      if (req.method === 'PATCH') return send(200, c.get(c.update(id, await readJson(req) as Record<string, unknown>).id));
      if (req.method === 'DELETE') return send(c.remove(id) ? 200 : 404, {});
      return send(405, { error: 'method not allowed' });
    } catch (e) {
      if (!(e instanceof ConnectionError)) console.error(e);
      return send(e instanceof ConnectionError ? (/no connection/i.test(e.message) ? 404 : 400) : 500, { error: e instanceof ConnectionError ? e.message : 'Internal server error' });
    }
  }

  private async handleLogs(res: ServerResponse, path: string, url: URL, send: (status: number, body: unknown) => void): Promise<void> {
    const logs = this.logs!;
    if (path === '/tabularius/admin/v1/logs') return send(200, { logs: logs.list() });
    const m = /^\/tabularius\/admin\/v1\/logs\/([^/]+)(\/download)?$/.exec(path);
    const name = LOGS.find((n) => n === decodeURIComponent(m?.[1] ?? '')) as LogName | undefined;
    if (!m || !name) return send(404, { error: 'not found' });
    if (m[2]) {
      await logs.flush();
      const old = url.searchParams.get('old') === '1';
      const file = old ? logs.file(name).replace(/\.log$/, '-old.log') : logs.file(name);
      res.writeHead(200, {
        'content-type': 'text/tab-separated-values; charset=utf-8', 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="${name}${old ? '-old' : ''}.log"`,
      }).end(existsSync(file) ? readFileSync(file) : '');
      return;
    }
    const q = url.searchParams;
    const time = (k: string) => {
      const v = q.get(k);
      if (!v) return undefined;
      const t = /^\d+$/.test(v) ? queryInteger(q, k, 8_640_000_000_000_000, 0) : Date.parse(v);
      if (t === undefined || !Number.isFinite(t)) throw new ApiError(960, `Parameter is invalid: ${k}`, 400);
      return t;
    };
    const type = q.get('type');
    send(200, await logs.read(name, {
      from: time('from'), to: time('to'),
      type: type === 'Information' || type === 'Warning' || type === 'Error' ? type as LogType : undefined,
      q: q.get('q') || undefined, limit: queryInteger(q, 'limit', 1000),
    }));
  }

  private async handleSync(req: IncomingMessage, path: string, url: URL, send: (status: number, body: unknown) => void): Promise<void> {
    const sync = this.sync;
    if (!sync) return send(404, { error: 'sync is not running on this server' });
    const m = /^\/tabularius\/admin\/v1\/sync(?:\/([^/]+)(?:\/(check|apply|log))?)?$/.exec(path);
    if (!m) return send(404, { error: 'not found' });
    const database = m[1] ? decodeURIComponent(m[1]) : undefined;
    const action = m[2];
    if (!database) return req.method === 'GET' ? send(200, { sync: sync.list() }) : send(405, { error: 'method not allowed' });
    if (!action) {
      if (req.method === 'GET') return send(200, sync.get(database));
      if (req.method === 'PUT') return send(200, sync.put(database, await readJson(req)));
      if (req.method === 'DELETE') return send(sync.remove(database) ? 200 : 404, {});
      return send(405, { error: 'method not allowed' });
    }
    if (action === 'log' && req.method === 'GET') {
      return send(200, { log: sync.logOf(database, { run: url.searchParams.get('run') || undefined, limit: Number(url.searchParams.get('limit')) || undefined }) });
    }
    if (action === 'check' && req.method === 'POST') {
      const body = await readJson(req).catch(lenient({})) as { password?: unknown };
      this.log(`sync: checking ${database} against FileMaker`);
      return send(200, await sync.check(database, { password: secret(body.password) }));
    }
    if (action === 'apply' && req.method === 'POST') {
      // Conflict resolutions are capped at 100000 by sync.apply with its own message, so this route's structural bounds are wider.
      const body = await readJson(req, { array: 1_000_000, nodes: 1_000_000 }) as ApplyRequest & { password?: unknown };
      return send(200, await sync.apply(database, { ...body, password: secret(body.password) }));
    }
    send(405, { error: 'method not allowed' });
  }

  private async handleSchedules(req: IncomingMessage, path: string, send: (status: number, body: unknown) => void): Promise<void> {
    const schedules = this.schedules;
    if (!schedules) return send(404, { error: 'schedules are not running on this server' });
    const m = /^\/tabularius\/admin\/v1\/schedules(?:\/([0-9a-f]+)(?:\/(run|runs))?)?$/.exec(path);
    if (!m) return send(404, { error: 'not found' });
    const [, id, action] = m;
    const run = action === 'run';
    if (id && action === 'runs') {
      if (!schedules.get(id)) return send(404, { error: 'no such schedule' });
      return req.method === 'GET' ? send(200, { runs: schedules.runs(id) }) : send(405, { error: 'method not allowed' });
    }
    if (!id && req.method === 'GET') return send(200, { schedules: schedules.all() });
    if (!id && req.method === 'POST') return send(201, schedules.create(await readJson(req) as ScheduleInput));
    if (id && !schedules.get(id)) return send(404, { error: 'no such schedule' });
    if (id && run && req.method === 'POST') return send(200, await schedules.run(id));
    if (id && !run && req.method === 'PATCH') return send(200, schedules.update(id, await readJson(req) as ScheduleInput));
    if (id && !run && req.method === 'DELETE') return send(200, { deleted: schedules.remove(id) });
    send(405, { error: 'method not allowed' });
  }

  private restoring = false;

  /** For each hosted file, the span of time it can be put back to. */
  restorePoints() {
    const dest = this.backupDest();
    return {
      progressive: !!this.progressive,
      databases: this.host.files().map((f) => {
        const r = restoreRange(dest, f.name + STORE_EXT);
        return { name: f.name, status: f.status, ...(r ? { from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString(), sets: r.sets } : {}) };
      }),
    };
  }

  /**
   * Puts a hosted file back as it was at a moment, from the backups and
   * point-in-time logs, while the server keeps running. "replace" closes the
   * file (its users are disconnected), restores it in place and opens it again;
   * "copy" hosts the restored file under a new name next to the current one.
   */
  async restore(body: Record<string, unknown>): Promise<{ database: string; time: string; mode: string }> {
    if (this.restoring) throw new RestoreError(409, 'Another restore is under way');
    const name = said(body.database);
    const file = this.host.files().find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (!file) throw new RestoreError(404, `"${name}" is not hosted`);
    let at: number;
    if (typeof body.at === 'number') at = body.at;
    else {
      const text = said(body.at);
      at = /Z$|[+-]\d\d:\d\d$/.test(text) ? Date.parse(text) : (() => {
        try {
          // "14:05" or "14:05:30" means as it was by the end of that minute or second.
          const t = parseTime(text);
          return /\d:\d\d:\d\d$/.test(text.trim()) ? t + 999 : /\d:\d\d$/.test(text.trim()) ? t + 59_999 : t;
        } catch {
          return NaN;
        }
      })();
    }
    if (!Number.isFinite(at)) throw new RestoreError(400, 'Give the moment to go back to, like 2026-10-11 14:05');
    if (at > Date.now() + 60_000) throw new RestoreError(400, 'That moment hasn\'t happened yet');
    at = Math.min(at, Date.now());
    const mode = body.mode === 'copy' ? 'copy' : 'replace';
    this.restoring = true;
    try {
      // Save the latest changes, so moments up to now can be reached.
      this.progressive?.run();
      const dest = this.backupDest();
      const point = restorePoint(dest, file.name + STORE_EXT, at);
      if (!point) throw new RestoreError(400, `There is no backup of ${file.name} from before ${new Date(at).toLocaleString()}`);
      if (mode === 'copy') {
        const d = new Date(point.time);
        const p2 = (n: number) => String(n).padStart(2, '0');
        const stampText = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}${p2(d.getMinutes())}`;
        const wanted = body.name !== undefined && body.name !== '' ? String(body.name) : `${file.name} restored ${stampText}`;
        let copy: string;
        try {
          copy = hostedName(wanted + '.fmp12');
        } catch (e) {
          throw new RestoreError(400, (e as Error).message);
        }
        const target = join(this.host.dir, copy + STORE_EXT);
        if (this.host.files().some((f) => f.name.toLowerCase() === copy.toLowerCase()) || existsSync(target) || existsSync(target + ENCRYPTED_EXT) || existsSync(join(this.host.dir, copy + '.fmp12'))) {
          throw new RestoreError(409, `A file named ${copy} is already hosted`);
        }
        await restorePointTo(point, target, undefined, file.path);
        this.host.add(target);
        await this.host.openFileEverywhere(copy);
        return { database: copy, time: new Date(point.time).toISOString(), mode };
      }
      const securitySnapshot = file.path + '.security-snapshot';
      // Capture the live security database before closeFileEverywhere encrypts
      // it and removes its plaintext source.
      this.host.get(file.name)!.checkpoint();
      copyFileSync(file.path, securitySnapshot);
      this.api.endByDb(file.name);
      await this.host.closeFileEverywhere(file.name);
      try {
        await restorePointTo(point, file.path, undefined, securitySnapshot);
        // The encrypted copy closing made is older than what was just restored.
        if (this.host.encrypted) rmSync(file.path + ENCRYPTED_EXT, { force: true });
      } finally {
        rmSync(securitySnapshot, { force: true });
        if (file.status !== 'closed') await this.host.openFileEverywhere(file.name);
      }
      // Point-in-time logs from here on must follow the restored file, not the copy they followed before.
      if (this.progressive) {
        const r = await backupFolder(this.host.dir, dest, this.backups?.keep ?? this.backupKeep);
        this.progressive.follow(r.dir);
      }
      return { database: file.name, time: new Date(point.time).toISOString(), mode };
    } finally {
      this.restoring = false;
    }
  }

  /**
   * The audit log of one hosted file: record changes and security events, newest
   * last, as JSON or (with format=csv) a download. The console shows it so an
   * administrator can see who signed in, who was locked out, and every change to
   * accounts, privileges, passwords, second factors, tokens, schema and data.
   */
  /** Each hosted file with saved script test cases: how many, per script (nothing runs). */
  private scriptTestCounts(): { database: string; tests: number; scripts: { script: string; tests: number }[] }[] {
    return this.host.names().flatMap((name) => {
      const store = this.host.get(name);
      const tests = store?.scriptTests() ?? [];
      if (!store || !tests.length) return [];
      const per = new Map<number, number>();
      for (const t of tests) per.set(t.script, (per.get(t.script) ?? 0) + 1);
      const names = new Map(store.schema.scripts.map((x) => [x.id, x.name]));
      return [{ database: store.name, tests: tests.length, scripts: [...per].map(([id, n]) => ({ script: names.get(id) ?? `Script ${id} (deleted)`, tests: n })) }];
    });
  }

  /**
   * Every saved script test case of a file, run offline on a throwaway copy (as Script Workspace's Run tests does),
   * grouped by script: each case's pass or fail and what differed.
   */
  private async runScriptTests(store: Store): Promise<unknown> {
    this.testing = store.name;
    const started = Date.now();
    try {
      const tests = store.scriptTests();
      let copy;
      try {
        copy = await scratchCopy(store, SCRATCH_MAX_BYTES);
      } catch (e) {
        return { error: `${store.name} can't be copied to run its tests: ${adminErrorText(e, this.host).replace(/ Send "scratch".*$/, '')}`, status: 400 };
      }
      let outcomes;
      try {
        outcomes = await runScriptTests(copy.store, tests);
      } finally {
        dropScratch(copy);
      }
      const scripts = new Map<string, { script: string; passed: number; failed: number; cases: unknown[] }>();
      for (const o of outcomes) {
        const s = scripts.get(o.script) ?? { script: o.script, passed: 0, failed: 0, cases: [] };
        if (o.passed) s.passed++;
        else s.failed++;
        s.cases.push({ name: o.name, passed: o.passed, failures: o.failures, ...(o.message ? { message: o.message } : {}), ms: o.ms });
        scripts.set(o.script, s);
      }
      const failed = outcomes.filter((o) => !o.passed).length;
      this.log(`${store.name}: script tests run from the admin console, ${outcomes.length - failed} passed, ${failed} failed`);
      return { database: store.name, ran: outcomes.length, passed: outcomes.length - failed, failed, ms: Date.now() - started, scripts: [...scripts.values()] };
    } finally {
      this.testing = undefined;
    }
  }

  private audit(url: URL, res: ServerResponse, send: (status: number, body: unknown) => void): void {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return send(400, { error: 'name a hosted database with ?database=' });
    const num = (k: string) => queryInteger(p, k, k === 'limit' ? 1000 : 1_000_000_000, 0);
    const bool = (k: string) => { const v = p.get(k); return v === null || v === '' ? undefined : v === '1' || v.toLowerCase() === 'true'; };
    const entries = store.auditLog({
      table: p.get('table') ?? undefined,
      account: p.get('account') ?? undefined,
      kind: p.get('kind') ?? undefined,
      surface: p.get('surface') ?? undefined,
      script: p.get('script') ?? undefined,
      recordId: num('recordId'),
      security: bool('security'),
      since: p.get('since') ?? undefined,
      until: p.get('until') ?? undefined,
      limit: num('limit'),
    });
    if ((p.get('format') ?? '').toLowerCase() === 'csv') {
      const file = `audit-${name!.replace(/[^\w.-]+/g, '_')}.csv`;
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${file}"` }).end(auditCsv(entries));
      return;
    }
    send(200, { database: name, audit: entries });
  }

  /**
   * The security and authentication events of one hosted file — sign-ins,
   * lockouts, and every change to accounts, privilege sets, passwords, second
   * factors, tokens, AI agents and schema — grouped and said in plain English,
   * newest last. The dedicated security log, apart from the record-change audit.
   * Filters: ?account= (who acted), ?category= (a group) or ?kind= (one kind),
   * ?target= and ?from= (the object acted on, and the place), ?since=/&until=,
   * ?limit=, and ?format=csv for a download. Returns the group names so the
   * console can build its category picker from the same source.
   */
  private securityEvents(url: URL, res: ServerResponse, send: (status: number, body: unknown) => void): void {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return send(400, { error: 'name a hosted database with ?database=' });
    const num = (k: string) => queryInteger(p, k, k === 'limit' ? 1000 : 1_000_000_000, 0);
    const events = store.securityEvents({
      account: p.get('account') ?? undefined,
      category: p.get('category') ?? undefined,
      kind: p.get('kind') ?? undefined,
      target: p.get('target') ?? undefined,
      from: p.get('from') ?? undefined,
      since: p.get('since') ?? undefined,
      until: p.get('until') ?? undefined,
      limit: num('limit'),
    });
    if ((p.get('format') ?? '').toLowerCase() === 'csv') {
      const file = `security-events-${name!.replace(/[^\w.-]+/g, '_')}.csv`;
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${file}"` }).end(securityEventsCsv(events));
      return;
    }
    send(200, { database: name, categories: Object.keys(SECURITY_EVENT_CATEGORIES), events });
  }

  /**
   * "View as" preview: read a layout exactly as a chosen privilege set would see
   * it — the set's visible records, with fields it can't see masked out — without
   * assigning the set to a real account. Read-only (it calls `find`, which never
   * writes) and audited. With no privilegeSet/layout it returns the pickers'
   * lists (the file's privilege sets and layouts).
   */
  private viewAs(url: URL): unknown {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return { error: 'name a hosted database with ?database=' };
    const setName = p.get('privilegeSet') ?? '';
    const layout = p.get('layout') ?? '';
    if (!setName || !layout) {
      return {
        database: name,
        privilegeSets: store.privilegeSets().map((s) => s.name),
        layouts: store.schema.layouts.map((l) => l.name),
      };
    }
    if (!store.schema.layouts.some((l) => l.name === layout)) return { error: `No layout "${layout}"` };
    if (!store.privilegeSets().some((s) => s.name === setName)) return { error: `No privilege set "${setName}"` };
    const pv = store.privilegesForSet(setName);
    store.logViewedAs(setName, layout);
    const limit = queryInteger(p, 'limit', 200) ?? 50;
    try {
      const result = store.find(layout, { privileges: pv, limit });
      return {
        database: name, privilegeSet: setName, layout, layoutAccess: true,
        foundCount: result.foundCount, totalCount: result.totalCount, records: result.records,
      };
    } catch (e) {
      // The set can't reach this layout (105 = no layout access, 200 = view only,
      // 9 = insufficient privileges). The layout exists (checked above), so this
      // is the set's own access, not a missing layout.
      if (e instanceof StoreError && (e.code === 105 || e.code === 200 || e.code === 9)) {
        return { database: name, privilegeSet: setName, layout, layoutAccess: false, records: [] };
      }
      throw e;
    }
  }

  // "View as", explained: everything an account or privilege set can open and
  // change, with a plain reason for every denial. With no account or set, it
  // returns the pickers. Read-only.
  private accessExplained(url: URL): unknown {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return { error: 'name a hosted database with ?database=' };
    const account = p.get('account') ?? '';
    const privilegeSet = p.get('privilegeSet') ?? '';
    if (!account && !privilegeSet) {
      return {
        database: name,
        accounts: store.accounts().map((a) => a.name),
        privilegeSets: store.privilegeSets().map((s) => s.name),
      };
    }
    try {
      const explanation = store.accessExplained(account ? { account } : { privilegeSet });
      store.logViewedAs(explanation.privilegeSet || privilegeSet || account, account ? `account ${account}` : 'all layouts');
      // The key-10 "other options": shown so the console reflects a set that
      // forbids printing, exporting or self-password-change, or stays connected
      // when idle. Absent means allowed (FileMaker's default), as enforced.
      const setDef = store.privilegeSet(explanation.privilegeSet || privilegeSet);
      const options = setDef && {
        printing: setDef.printing !== false,
        exporting: setDef.exporting !== false,
        allowModifyPassword: setDef.allowModifyPassword !== false,
        idleDisconnect: setDef.idleDisconnect !== false,
        // Fields hidden only because their import byte (0x01) is unverified: the console offers to relax them.
        unverifiedFields: Object.entries(setDef.unverifiedReadOnly ?? {}).flatMap(([table, names]) => names.map((n) => `${table}::${n}`)),
      };
      return { database: name, explanation, ...(options ? { options } : {}) };
    } catch (e) {
      if (e instanceof StoreError) return { error: e.message };
      throw e;
    }
  }

  // "Test this account": every layout and script, as the account's own
  // privileges would actually meet them, including script steps that reach
  // for a layout or script it can't use. Builds on "view as"; unlike it,
  // walks the whole file at once rather than one layout. With no account it
  // returns the picker. Read-only, logged the same way "view as" is.
  private testAccount(url: URL): unknown {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return { error: 'name a hosted database with ?database=' };
    const account = p.get('account') ?? '';
    if (!account) {
      return { database: name, accounts: store.accounts().map((a) => a.name) };
    }
    try {
      const result = store.testAccount(account);
      store.logViewedAs(result.privilegeSet, `test account ${account}`);
      return { database: name, ...result };
    } catch (e) {
      if (e instanceof StoreError) return { error: e.message };
      throw e;
    }
  }

  // Compare two privilege sets, plain English: the changes that would turn set
  // `a` into set `b`. With no pair, it returns the file's sets for the pickers.
  // Read-only.
  private compareSets(url: URL): unknown {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return { error: 'name a hosted database with ?database=' };
    const a = p.get('a') ?? '';
    const b = p.get('b') ?? '';
    if (!a || !b) {
      return { database: name, privilegeSets: store.privilegeSets().map((s) => s.name) };
    }
    try {
      return { database: name, comparison: store.comparePrivilegeSets(a, b) };
    } catch (e) {
      if (e instanceof StoreError) return { error: e.message };
      throw e;
    }
  }

  // SSO group mapping: which privilege set a person gets when an identity
  // provider signs them in, by their email, their email's domain, or one of
  // their groups (Store.externalAccount/setExternalAccount) — this is an
  // admin-console face on a mechanism that otherwise only Terminal could set.
  // Read-only.
  private ssoMapping(url: URL): unknown {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return { error: 'name a hosted database with ?database=' };
    return {
      database: name,
      mappings: store.accounts().filter((a) => a.external && !a.inactive).map((a) => ({ name: a.name, privilegeSet: a.privilegeSet })),
      privilegeSets: store.privilegeSets().map((s) => s.name),
    };
  }

  // "Test with this user": which mapping a given email and/or groups would
  // resolve to, and (when one matches) the same per-table/layout/script
  // breakdown "What a set can do" shows — so an admin can check a mapping
  // before anyone signs in with it. With neither email nor groups, returns
  // nothing to try against yet. Read-only, logged the same way "view as" is.
  private ssoMappingTest(url: URL): unknown {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return { error: 'name a hosted database with ?database=' };
    const email = p.get('email')?.trim() || undefined;
    const groups = (p.get('groups') ?? '').split(',').map((g) => g.trim()).filter(Boolean);
    if (!email && !groups.length) return { database: name };
    if (!email) return { database: name, matched: false };
    const matched = store.externalAccount(email, groups);
    if (!matched) return { database: name, matched: false };
    const explanation = store.accessExplained({ account: matched });
    store.logViewedAs(explanation.privilegeSet, `SSO test (${[email, ...groups].filter(Boolean).join(', ')})`);
    return { database: name, matched: true, account: matched, explanation };
  }

  // Field access: which fields of a table a privilege set can modify, view
  // only, or not see at all — the one piece of "Edit Privilege Set" FileMaker
  // Pro itself edits that this console couldn't, until now. With no set or
  // table, returns the pickers. Read-only.
  private fieldAccess(url: URL): unknown {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return { error: 'name a hosted database with ?database=' };
    const setName = p.get('privilegeSet') ?? '';
    const table = p.get('table') ?? '';
    if (!setName || !table) {
      return {
        database: name,
        privilegeSets: store.privilegeSets().map((s) => s.name),
        tables: store.schema.tables.map((t) => t.name),
      };
    }
    const set = store.privilegeSet(setName);
    if (!set) return { error: `No privilege set "${setName}"` };
    const def = store.schema.tables.find((t) => t.name === table);
    if (!def) return { error: `No table "${table}"` };
    if (isFullAccess(set)) return { database: name, privilegeSet: setName, table, fullAccess: true, fields: [] };
    const pv = store.privilegesForSet(setName);
    return {
      database: name, privilegeSet: setName, table,
      canView: pv.table(table).view !== false,
      // fieldAccess, not field: a masked field is reported as masked (with its mask), not as hidden.
      fields: def.fields.map((f) => ({ name: f.name, access: pv.fieldAccess(table, f.name), ...(pv.mask(table, f.name) ? { mask: pv.mask(table, f.name) } : {}) })),
    };
  }

  /**
   * "Who can do what", for an audit: one row per account per table (one
   * summary row for a full-access account, or one for an account with no
   * privilege set at all), with its extended privileges, last sign-in and
   * two-factor status — everything Manage Security and the security health
   * page otherwise show separately. ?database= (required), ?unusedDays=, and
   * ?format=csv for a download. Read-only.
   */
  private accessReview(url: URL, res: ServerResponse, send: (status: number, body: unknown) => void): void {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return send(400, { error: 'name a hosted database with ?database=' });
    const unusedDays = queryInteger(p, 'unusedDays', 1_000_000);
    const review = accessReview(store, { unusedDays });
    if ((p.get('format') ?? '').toLowerCase() === 'csv') {
      const file = `access-review-${name!.replace(/[^\w.-]+/g, '_')}.csv`;
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${file}"` }).end(accessReviewCsv(review));
      return;
    }
    send(200, review);
  }

  /**
   * What a hosted file's plug-in calls will do here (run, give ?, give an MBS error text, or go to the Outbox), how many
   * scripts, calculations and layout objects use each, and what to use instead. It names functions and counts places and
   * reads no records. ?database= (required), ?format=csv for a download. Read-only, like the rest of the console, behind
   * the admin sign-in.
   */
  private pluginReadiness(url: URL, res: ServerResponse, send: (status: number, body: unknown) => void): void {
    const wanted = url.searchParams.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return send(400, { error: 'name a hosted database with ?database=' });
    const readiness = pluginReadiness(store, this.host.plugins);
    if ((url.searchParams.get('format') ?? '').toLowerCase() === 'csv') {
      const file = `plug-ins-${name!.replace(/[^\w.-]+/g, '_')}.csv`;
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${file}"` }).end(pluginReadinessCsv(readiness));
      return;
    }
    send(200, readiness);
  }

  /**
   * A security health report for one hosted file, or every hosted file when no
   * ?database= is given: accounts without a second factor, dormant accounts,
   * the full-access count, over-broad API tokens, and privilege sets that can
   * read tables no layout shows, and schedules whose latest run failed. Read-only; the console turns each finding into
   * a one-click fix only where one is safe (revoking a token).
   */
  private health(url: URL): unknown {
    const p = url.searchParams;
    const unusedDays = queryInteger(p, 'unusedDays', 1_000_000);
    const wanted = p.get('database');
    const names = this.host.names();
    const pick = wanted
      ? names.filter((n) => n.toLowerCase() === wanted.toLowerCase())
      : names;
    if (wanted && pick.length === 0) return { error: `"${wanted}" is not hosted` };
    return {
      databases: pick.map((name) => {
        const store = this.host.get(name)!;
        return {
          database: name, ...store.securityHealth({ unusedDays }), review: reviewPrivileges(store, { unusedDays }).findings,
          // Scheduled scripts whose latest run failed: they keep failing unattended until someone looks.
          scheduleFailures: this.schedules?.failing(name) ?? [],
          // Scheduled syncs with records changed on both sides, or that could not finish: nothing moves until someone looks.
          syncAlerts: this.schedules?.syncAlerts(name) ?? [],
        };
      }),
    };
  }

  /** Where server events are emailed (if anywhere), and whether this server can send mail at all. */
  private notificationStatus(): { to?: string; level?: string; canSend: boolean } {
    const n = this.host.config.notifications();
    return { ...(n ? { to: n.to, level: n.level } : {}), canSend: this.host.notifier.canSend };
  }

  /**
   * Unusual-access alerts for one hosted file: recent failed-sign-in bursts,
   * lockouts, sign-ins from a new place, one account in from many places, a
   * dormant account waking, and protections turned off — worst first. Read-only;
   * `?windowHours=` bounds "recent" (default 72), `?failureThreshold=` and
   * `?dormantDays=` tune the burst and dormancy thresholds.
   */
  private usage(url: URL): unknown {
    const wanted = url.searchParams.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return { error: 'name a hosted database with ?database=' };
    return { database: name, ...store.accountUsage(queryInteger(url.searchParams, 'days', 36500)) };
  }

  private unusualAccess(url: URL): unknown {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return { error: 'name a hosted database with ?database=' };
    const num = (k: string) => queryInteger(p, k, k === 'limit' ? 1000 : 36500);
    const alerts = store.unusualAccess({ windowHours: num('windowHours'), failureThreshold: num('failureThreshold'), dormantDays: num('dormantDays'), limit: num('limit') });
    return { database: name, windowHours: num('windowHours') ?? 72, alerts };
  }

  // Least-privilege suggestions: write grants a set holds but no account on it
  // has exercised in the window (default 30 days). Write access only. Read-only.
  private leastPrivilege(url: URL): unknown {
    const p = url.searchParams;
    const wanted = p.get('database') ?? '';
    const name = this.host.names().find((n) => n.toLowerCase() === wanted.toLowerCase());
    const store = name ? this.host.get(name) : undefined;
    if (!store) return { error: 'name a hosted database with ?database=' };
    const unusedDays = queryInteger(p, 'unusedDays', 1_000_000);
    return { database: name, ...store.leastPrivilege({ unusedDays }) };
  }

  /**
   * Runs a conversion that may need an encrypted .fmp12's passphrase: when it
   * does and none (or a wrong one) was given, answers so (the console then
   * asks for it) instead of failing.
   */
  private async passphraseFor(send: (status: number, body: unknown) => unknown, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (e) {
      if (e instanceof PassphraseNeeded) send(409, { error: e.message, needsPassphrase: true, ...(e.hint ? { hint: e.hint } : {}) });
      else if ((e as Error).message === 'wrong passphrase') send(400, { error: 'wrong passphrase', needsPassphrase: true });
      else if (e instanceof Error && /^a native file .* can't be converted again$/.test(e.message)) send(400, { error: e.message });
      else throw e;
    }
  }

  /** Outbound test mode's settings, for the console (never the SMTP account). */
  private outboundStatus() {
    const o = this.host.outbound;
    return o ? { on: true, redirectTo: o.redirectTo ?? null, copies: !!o.deliver, allowHosts: o.allowHosts } : { on: false };
  }

  /**
   * First-run steps with whether each is done, worked out from real state. `service` is left out where installing one
   * doesn't apply (a container). The console shows the list until every step is done.
   */
  setup(sets: unknown[]) {
    const stores = this.host.openStores();
    return {
      passwordSet: !!this.passwordHash(),
      // Every hosted file has a password on each of its accounts (a file from FileMaker often has Admin with none).
      accountsSecured: stores.length > 0 && stores.every((s) => s.blankPasswordAccounts().length === 0),
      backupMade: sets.length > 0,
      aiConnected: !!this.mcpTokens && this.mcpTokenList(this.mcpTokens).length > 0,
      ...(this.serviceInstalled ? { service: this.serviceInstalled() } : {}),
    };
  }

  status() {
    const dest = this.backupDest();
    const owners = new Map<string, string>();
    const clients = this.api.list();
    const databases = this.host.names().map((name) => {
      const store = this.host.get(name)!;
      const file = join(this.host.dir, name + STORE_EXT);
      return {
        name,
        bytes: size(file) + size(file + '-wal'),
        tables: store.schema.tables.length,
        layouts: store.schema.layouts.length,
        scripts: store.schema.scripts.length,
        clients: clients.filter((c) => c.db.toLowerCase() === name.toLowerCase()).length,
        requireTotpForFullAccess: store.requireTotpForFullAccess(),
        fullAccessWithout2fa: store.fullAccessAccountsWithoutTotp().length,
        externalContainers: store.externalContainerCount(),
        // Whether AI apps and the assistant may read the file, and why not.
        ai: aiStatus(store),
        aiPolicy: store.aiPolicy,
        // Whether personal data is swapped for stand-ins before anything goes to AI (here, or in a file it uses).
        pii: (() => {
          const f = piiFile(store);
          return { on: !!f, turnedOn: store.piiIsolation, ...(f && f !== store ? { through: f.name } : {}) };
        })(),
        // Converted by an older version that got some values wrong: convert again from the .fmp12.
        reconvert: (() => {
          const c = this.host.reconvertStatus(name);
          return c?.outdated ? { version: c.version, current: c.current, unsafe: c.unsafe, ...(c.unverified ? { unverified: true } : {}) } : undefined;
        })(),
      };
    });
    const locks = this.host.names().flatMap((name) => this.host.get(name)!.locks.all().map((l) => {
      const id = owners.get(l.owner) ?? this.api.idOf(l.owner);
      owners.set(l.owner, id);
      return { file: name, table: l.table, recordId: l.recordId, account: l.account, client: id, expires: new Date(l.expires).toISOString() };
    }));
    // Presence: who has which record on screen, beside who is editing it.
    const viewing = this.host.names().flatMap((name) => this.host.get(name)!.locks.viewers().map((v) => {
      const id = owners.get(v.owner) ?? this.api.idOf(v.owner);
      owners.set(v.owner, id);
      return { file: name, table: v.table, recordId: v.recordId, account: v.account, client: id };
    }));
    const sets = backupSets(dest).reverse().map((s) => ({ name: s, bytes: dirSize(join(dest, s)), check: lastCheck(join(dest, s)), restored: lastRestore(join(dest, s)) }));
    return {
      server: {
        version: SERVER_VERSION, ...(serverCommit() ? { commit: serverCommit() } : {}), started: new Date(this.started).toISOString(), folder: this.host.dir, scriptNetwork: this.host.scriptNetwork, outbound: this.outboundStatus(), mail: this.host.mail && !this.host.outbound ? { from: this.host.mailFrom, ...(this.host.mailConnection ? { connection: this.host.mailConnection } : {}) } : null, passwordSet: !!this.passwordHash(),
        // Sign-ins refused (the Admin API's blocknewusers): sessions already open carry on.
        blockNewUsers: this.host.config.blockNewUsers(),
        // Minutes a Data API session, and a web client session, may sit idle before it ends.
        sessionIdleMinutes: this.host.config.sessionIdleMinutes(),
        webSessionIdleMinutes: this.host.config.webSessionIdleMinutes(),
        // False while the web client's idle time follows the Data API's, so the console can show it empty.
        webSessionIdleOwn: this.host.config.webSessionIdleIsOwn(),
        // Below this width (points) the web client stacks a layout that has no breakpoint of its own; 0 is never.
        responsiveStackBelow: this.host.config.responsiveStackBelow(),
        notifications: this.notificationStatus(),
        // The AI status line: the assistant's state (and model, when connected), or no key when the assistant is off.
        ai: this.assistant?.state ?? { state: 'no-key' as const },
        oidc: this.oidcStatus,
        // --https local: the authority devices trust once (its fingerprint, to compare with what a device shows).
        localCa: localAuthority(this.host.dir),
      },
      databases,
      setup: this.setup(sets),
      // Files dropped into the folder that are being converted now.
      converting: [...this.host.converted].map(([name, p]) => ({ name, ...p })),
      // Files dropped in that could not be converted, and why: not ready is not the same as never loads.
      failed: [...this.host.failures].filter(([file]) => existsSync(join(this.host.dir, file))).map(([file, error]) => ({ file, error })),
      // Files dropped in that use Encryption at Rest, waiting for their passphrase.
      locked: [...this.host.locked].filter(([file]) => !this.host.converted.has(basename(file, extname(file)))).map(([file, i]) => ({ file, hint: i.hint, error: i.error })),
      clients: clients.map((c) => ({ ...c, locks: locks.filter((l) => l.client === c.id).length })),
      locks,
      viewing,
      schedules: this.schedules?.all() ?? [],
      serverScripts: this.host.serverScripts.overview(),
      certificate: this.tls?.current && {
        domains: this.tls.opts.domains,
        expires: new Date(this.tls.current.expires).toISOString(),
        problem: this.tls.problem,
      },
      standbys: this.replication && this.replication.standbys().map((c) => ({ ...c, at: new Date(c.at).toISOString() })),
      backups: {
        dest,
        defaultDest: defaultBackupDir(this.host.dir),
        saved: this.host.config.backupDir(),
        fixed: this.backupDirFixed,
        every: this.backups?.every,
        keep: this.backups?.keep ?? this.backupKeep,
        encrypted: !!backupKey(),
        running: backupRunning(),
        next: this.backups?.nextAt() ? new Date(this.backups.nextAt()!).toISOString() : undefined,
        last: this.backups?.last && { ...this.backups.last, at: new Date(this.backups.last.at).toISOString() },
        offsite: this.offsite && { last: this.offsite.last && { ...this.offsite.last, at: new Date(this.offsite.last.at).toISOString() } },
        progressive: this.progressive && {
          every: this.progressive.every,
          last: this.progressive.last && { ...this.progressive.last, at: new Date(this.progressive.last.at).toISOString() },
        },
        sets,
      },
    };
  }
}

/** A passphrase from a request body: a non-empty string, or undefined. */
function secret(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
