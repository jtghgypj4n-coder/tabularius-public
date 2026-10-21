import { clientAddress, refuseForwarding } from './client-address.ts';
// HTTP server: Data API–compatible REST plus MCP.

import '../../store/src/legacy-env.ts';
import { legacyRequest } from './legacy-request.ts';
import { AUTH_BODY_LIMIT } from './request-body.ts';
import { parseRequestJson } from './request-json.ts';
import { IdentityInFlight, busyHeaders } from './in-flight.ts';
import { RequestGate, requestClass, isDataApiPath, isEventStream } from './request-gate.ts';
import { StreamSlots } from './stream-slots.ts';
import type { SmtpConfig } from './smtp.ts';
import type { Server } from 'node:http';
import { createEdgeServer, type EdgeLimits } from './edge-limits.ts';
import { parseAllowList } from '../../scripts/src/net-guard.ts';
import { directFromThisComputer, trustedProxyAddresses, useForwardedFor, type ProxyHeader } from './client-address.ts';
import { acmeOrigins, mcpOriginAllowed, onForwardedWithoutPublicUrl, validatePublicUrl, urlHostname } from './public-origin.ts';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { certificateManaged, ImportedCertificates } from './cert-import.ts';
import { guideIndex, guidePage } from './docs.ts';
import { sendConditional } from './conditional.ts';
import { timingSafeEqual } from 'node:crypto';
import { isJsonContentType } from '@modelcontextprotocol/sdk/shared/mediaType.js';
import { DEFAULT_MAX_REQUEST_BODY_SIZE, requestBodyTooLargeMessage } from '@modelcontextprotocol/sdk/server/requestBody.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Host } from './host.ts';
import { ApiError, DataApi, readBody } from './dataapi.ts';
import { createMcpServer, type McpIdentity } from './mcp.ts';
import { invalidMessage } from './mcp-conformance.ts';
export { aiStatus, excludeFromAi } from './ai-access.ts';
export { IMAGE_EMBED_PROVIDERS, resolveImageEmbed, type ImageEmbedProvider, type ImageEmbedEndpoint } from './image-embed.ts';
export { EMBED_PRESETS, probeEmbedding, resolveEmbedEndpoint, type EmbedEndpoint } from './embed-endpoint.ts';
import { excludeFromAi } from './ai-access.ts';
import { McpTokens } from './mcp-tokens.ts';
import { OAuthServer } from './oauth.ts';
import { Oidc, type OidcProvider } from './oidc.ts';
import { ldapAuthenticator, type LdapProvider } from './ldap.ts';
import { WebClient } from './webclient.ts';
import { Live } from './live.ts';
import { SqlEndpoint } from './sql.ts';
import { ODataEndpoint } from './odata.ts';
import { CwpXmlEndpoint } from './cwp-xml.ts';
import { ScimEndpoint } from './scim.ts';
import { ContainerFiles } from './containers.ts';
import { Uploads } from './uploads.ts';
import { localUrl, openLocalAccess } from './local-admin.ts';
import { compressResponse } from './compression.ts';
import { redirectPlainHttp } from './plain-redirect.ts';
import { handleTrust } from './local-tls.ts';
import { claimFolder, sweepCrashLeftovers, defaultBackupDir, scheduleBackups, scheduleProgressive } from './backup.ts';
import type { ProgressiveSchedule } from './backup.ts';
import { Connections, scriptConnections } from './connections.ts';
import { S3, scheduleOffsite, type OffsiteSchedule, type S3Options } from './s3.ts';
import { Admin } from './admin.ts';
import { AdminApi } from './adminapi.ts';
import { CalendarFeeds } from './calendar.ts';
import { ChangeFeed, Webhooks } from './changes.ts';
import { Profiler } from './profiler.ts';
import type { ClusterLink } from './cluster.ts';
import { listenError } from './listen-error.ts';
import { Metrics } from './metrics.ts';
import { SERVER_VERSION } from './version.ts';
import { StatsLog } from './stats-log.ts';
import { ServerLogs, redactPath } from './server-logs.ts';
import { PgServer } from './pgwire.ts';
import { auditSurface } from './audit-surface.ts';
import { AutoTls, type AcmeOptions } from './acme.ts';
import { LogShipper } from './logs.ts';
import { Replication } from './replication.ts';
import { STANDBY_STATE, standbyState, unfinishedStandbyFiles } from './standby.ts';
import { Schedules } from './schedules.ts';
import { SyncConsole } from './sync-console.ts';
import { watchEventLoop, writer, type Store } from '../../store/src/index.ts';
import { Assistant, type AssistantOptions } from './assistant.ts';
import { DesignApi } from './design.ts';
import { DashboardApi } from './dashboards.ts';
import { CleanupApi } from './cleanup.ts';
import { AgentApi } from './agent.ts';
import { AutomationApi, AutomationRunner } from './automations.ts';
import { InboundHooks } from './inbound-hooks.ts';
import { DigestApi, DigestRunner } from './digests.ts';
import { ConversionGuides } from './conversion-guide.ts';
import { SecurityApi } from './security.ts';
import { DebugApi } from './debug.ts';
import { sendError, wantsPage } from './pages.ts';

export { Host, STORE_EXT } from './host.ts';
export { DataApi } from './dataapi.ts';
export { openApiDocument, typesFromOpenApi } from './openapi.ts';
export { createFeed, importIcs, listFeeds, revokeFeed } from './calendar.ts';
export { createMcpServer, type McpIdentity } from './mcp.ts';
export { Oidc, type OidcProvider } from './oidc.ts';
export { ldapAuthenticate, ldapAuthenticator, LdapError, type LdapProvider, type DirectoryIdentity } from './ldap.ts';
export { encryptFileSync, decryptFileSync, ENCRYPTED_EXT } from './encrypt.ts';
export { WebClient } from './webclient.ts';
export { Live } from './live.ts';
export { SqlEndpoint } from './sql.ts';
export { ODataEndpoint, filterSql } from './odata.ts';
export { ContainerFiles, parseRange } from './containers.ts';
export { Uploads, hostedName, MAX_PIECE } from './uploads.ts';
export { Admin, setAdminPassword } from './admin.ts';
export { tokenExpiry, defaultTokenDays, DEFAULT_TOKEN_DAYS, DEFAULT_FEED_DAYS } from './token-expiry.ts';
export { AdminApi, ADMIN_API_VERSION } from './adminapi.ts';
export { ChangeFeed, Webhooks, type Webhook, type FeedEntry } from './changes.ts';
export { Profiler } from './profiler.ts';
export { listenError } from './listen-error.ts';
export { serveCluster, clusterProblems, route as clusterRoute, ClusterLink, forwardLogs, logFromFollower, type ClusterRole } from './cluster.ts';
export { Outbox, type StoredEntry } from './outbox.ts';
export { redirectTransport, type SmtpConfig } from './smtp.ts';
export { Metrics, routeOf } from './metrics.ts';
export { SyncConsole, SyncConsoleError, type SyncSetup, type SyncStatus, type ConflictView } from './sync-console.ts';
export { Schedules, ScheduleError, nextRun, type Schedule, type ScheduleRun, type SyncJobs, type SyncRunSummary, type SyncScheduleOptions } from './schedules.ts';
export { verifySet, describeCheck, lastCheck, type SetCheck } from './backup-verify.ts';
export { BackupStopped, backupFolder, backupRunning, stopBackups, backupKey, backupSets, defaultBackupDir, parseInterval, parseTime, restoreAt, restoreBackup, AccountChangesError, type AccountDifference, type ChangedSince, restorePoint, restorePointTo, restoreRange, runningServer, scheduleBackups, scheduleProgressive } from './backup.ts';
export { localCertificate, localCertificateFiles, localNames } from './local-tls.ts';
export { AcmeClient, AutoTls, LETS_ENCRYPT, LETS_ENCRYPT_STAGING, certificateRequest, type AcmeOptions } from './acme.ts';
export { Connections, ConnectionError, scriptConnections, CONNECTION_TYPES, looksLikeCredential, type Connection } from './connections.ts';
export { S3, mirrorDown, mirrorUp, s3FromEnv, scheduleOffsite, signV4, type OffsiteSchedule, type S3Options } from './s3.ts';
export { PgServer, type PgServerOptions } from './pgwire.ts';
export { LogShipper, type LogFollower } from './logs.ts';
export { Replication, type StandbyClient } from './replication.ts';
export { Standby, STANDBY_STATE, standbyState, type StandbyOptions, type StandbyState } from './standby.ts';
export { DesignApi, canDesign, designOf } from './design.ts';
export { SecurityApi, securityOf } from './security.ts';
export { DebugApi } from './debug.ts';
export { conversionReport, type ConversionReport } from './conversion.ts';
export { checkSolution, checkSolutionText, type SolutionCheck, type Finding as SolutionFinding, type FindingKind as SolutionFindingKind, type Severity as SolutionSeverity } from './check-solution.ts';
export { optimizationReport, optimizationText, type OptimizationReport, type Finding as OptimizationFinding, type OptimizationAction } from './optimization.ts';
export { applyFix as applyOptimizationFix, previewFix as previewOptimizationFix, undoFix as undoOptimizationFix, FixError as OptimizationFixError, type FixId as OptimizationFixId } from './optimization-fix.ts';
export { explainScriptFailure, type ScriptFailure } from './script-failure.ts';
export { fetchFmsExport, migrateFms, describeMigration, copySize, nativePath, readSettings, SETTINGS_FILE, FmsMigrationError, type FmsExport, type FolderSettings, type MigrationReport } from './fms-migrate.ts';
export { dataApiSource, dataApiClient, checkSyncAllowed, describeApply, describePlan, verifySync, describeSyncVerification, parseSyncConfig, remoteRecord, CONTAINER_PULL_MAX_BYTES, FmsSyncError, type DataApiSource, type DataApiClient, type DataApiSourceOptions, type SyncConfigFile, type SyncVerificationTable } from './fms-sync.ts';
export { Assistant, DEFAULT_MODEL, type AssistantOptions, type AiState } from './assistant.ts';
export { DigestRunner, Digests, type Digest, type DigestRun } from './digests.ts';

export interface ServeOptions {
  /** HTTP transport limits; omitted values use EDGE_LIMITS. */
  edgeLimits?: Partial<EdgeLimits>;
  /** How long closing the server lets requests already running finish before cutting them off (ms; default 20 s, under launchd's 30 s and systemd's 60 s stop timeouts). */
  drainMs?: number;
  dir: string;
  /** Check the pages of every hosted file once the server has started (default true; a damaged file is taken offline). */
  checkFiles?: boolean;
  port?: number;
  hostname?: string;
  /**
   * Bearer token for /mcp, acting as the server administrator. Without one, only
   * direct requests from this computer (loopback, not passed on by a proxy, addressed to localhost) get administrator access. Any client can instead sign in
   * with an account (HTTP Basic auth) and work within its privilege set.
   */
  mcpToken?: string;
  /** Additional browser origins allowed at /mcp (scheme, host and optional port). Authentication still applies. */
  mcpAllowedOrigins?: string[];
  /** HTTP(S) address clients reach the server at, without credentials, path, query or fragment; a trailing slash is allowed. */
  publicUrl?: string;
  /** List every hosted file to anyone who asks, as FileMaker Server's own lists do; off, a list answers only a caller who signs in, with the files that account can open. */
  listFilesPublicly?: boolean;
  /** Set by a cluster's front process when it filled in publicUrl with its own listen address: workers use it for what needs a base URL, but links and passkeys still follow the request. */
  publicUrlIsDefault?: boolean;
  /**
   * The header a trusted proxy writes the visitor's address into. Without it, attribution uses the socket address (see client-address.ts).
   */
  proxyHeader?: ProxyHeader;
  /** Explicitly trusted proxy IP addresses or CIDRs, including loopback if needed; pair with proxyHeader. */
  trustedProxies?: string[];
  /** Let scripts reach the network (Insert from URL). Off by default: scripts can call mail and SMS services. */
  scriptNetwork?: boolean;
  /** Hosts, addresses and ranges on the machine's own network that scripts may reach too ("intranet.example", "10.0.0.0/8"): without them a script's request to loopback or a private address is refused. */
  scriptNetworkAllow?: string[];
  /** Let [Full Access] people finish AI-drafted connections for their own file in the web app (see Host.appConnections). */
  appConnections?: boolean;
  /**
   * Outbound test mode: Send Mail and mail plug-ins write to <folder>/Outbox and
   * never reach the recipients a script names; with `smtp` and `redirectTo` a
   * copy goes to that one address. Web requests reach only `allowHosts`.
   */
  testOutbound?: { redirectTo?: string; allowHosts?: string[]; smtp?: SmtpConfig; maxCopies?: number; captureOnly?: string[]; copyHeld?: boolean };
  /**
   * Let Send Mail via SMTP really send, through this SMTP account and from this address (never while a
   * capture-only file is hosted). Off by default; outbound test mode, when on, takes its place.
   */
  sendMail?: { smtp: SmtpConfig; from: string; captureOnly?: string[] };
  /** Send record changes to the webhooks set up in the admin console. Off by default, like scripts' network access. */
  webhooks?: boolean;
  /** Answer calls to the inbound hooks set up in the admin console, each running a script. Off by default. */
  inboundHooks?: boolean;
  /** Set by the front process for a cluster's workers (started without the certificate options): why certificates can't be imported. */
  certificateManaged?: string;
  /** HTTPS: PEM certificate and key files. Without them the server speaks plain HTTP (put it behind a TLS proxy). */
  tlsCert?: string;
  tlsKey?: string;
  /** Host .fmp12 files dropped into the folder while running (default on). */
  watch?: boolean;
  /** Start serving at once and convert files not converted yet in the background (needs watch). */
  background?: boolean;
  /** Sign-in through one or more identity providers (OpenID Connect) for external accounts. */
  oidc?: OidcProvider | OidcProvider[];
  /** Sign-in through an LDAP directory or Active Directory for external accounts. */
  ldap?: LdapProvider;
  /** Encryption at rest: stores are kept encrypted on disk and unlocked with this key while running. */
  encryptionKey?: string;
  /** Whether this folder is installed as a service (the first-run checklist asks); left out where that doesn't apply (a container). */
  serviceInstalled?: () => boolean;
  /** Scheduled backups of the folder; off when omitted. */
  backups?: { every: number; dest?: string; keep?: number };
  /** Point-in-time backups: the changes to each file every `every` ms, after a full backup made at start. */
  progressive?: { every: number };
  /** How often Stats.log and TopCallStats.log get a line, in ms (60000 by default; 0 turns them off). */
  statsInterval?: number;
  /** Size in bytes at which each log under Logs/ is renamed to <name>-old.log and started again (40 MB by default; `serve --log-limit`). */
  logLimit?: number;
  /** Copy the backups folder to S3-compatible storage after each backup and every few minutes. */
  offsite?: S3Options & { every?: number };
  /** Port for PostgreSQL clients (BI tools, ODBC/JDBC drivers): read-only FileMaker SQL. Off when omitted. */
  sqlPort?: number;
  /** HTTPS with certificates got and renewed automatically (Let's Encrypt), instead of tlsCert/tlsKey. */
  acme?: Omit<AcmeOptions, 'httpsPort' | 'log'>;
  /** Let standby servers follow this one (tabularius standby), signing in with this token. */
  replicationToken?: string;
  /** The AI assistant in the web client; off without an API key. */
  ai?: AssistantOptions;
  /** Files (names, with or without .fmp12) whose data is never sent to AI, whatever each file's own setting says. */
  aiExclude?: string[];
  log?: (msg: string) => void;
  /** Set when this server is one worker process of several (see cluster.ts). */
  cluster?: ClusterLink;
  /** Short HTTP requests admitted per process (default 32). */
  requestLimit?: number;
  /** Short HTTP requests waiting for a slot per process (default 64). */
  requestQueue?: number;
}

const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The account and file an API token stands for at /mcp, with its scope; undefined when no hosted file knows it or it isn't for AI apps. */
function apiTokenIdentity(host: Host, token: string, from: string): McpIdentity | undefined {
  for (const store of host.openStores()) {
    const bound = store.apiToken(token);
    if (!bound) continue;
    if (bound.surfaces && !bound.surfaces.includes('fmmcp')) return undefined;
    if (!store.signInLocationAllowed(bound.account, from)) return undefined;
    return { account: bound.account, database: store.name, ...(bound.readOnly || bound.layouts ? { scope: { readOnly: bound.readOnly, ...(bound.layouts ? { layouts: bound.layouts } : {}) } } : {}) };
  }
  return undefined;
}

export async function serve(opts: ServeOptions): Promise<{ server: Server; host: Host; url: string; tls?: AutoTls; offsite?: OffsiteSchedule; readonly progressive?: ProgressiveSchedule }> {
  validatePublicUrl(opts.publicUrl);
  const trustedProxies = trustedProxyAddresses(opts.trustedProxies);
  // One request can't hold the server's thread for more than a minute (TABULARIUS_REQUEST_BUDGET_MS; 0 for no limit).
  const budget = process.env.TABULARIUS_REQUEST_BUDGET_MS;
  const disposers: (() => void | Promise<void>)[] = [];
  let disposed: Promise<void> | undefined;
  let closed = false;
  let started = false;
  let releaseFolder: (() => void) | undefined;
  const dispose = () => disposed ??= (async () => {
    closed = true;
    const errors: unknown[] = [];
    for (const stop of disposers.reverse()) {
      try { await stop(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'The server did not shut down cleanly; see the errors listed with this one');
    releaseFolder?.();
  })();
  try {
    disposers.push(watchEventLoop(budget === undefined || budget === '' ? 60_000 : Number(budget)));
    // What the server reports also goes to its Event log.
    const logs = new ServerLogs(opts.dir, { limit: opts.logLimit, rotate: !opts.cluster || opts.cluster.role.leader });
    disposers.push(async () => {
      if (started) logs.event('Information', 'Server stopped', source);
      logs.close();
      await logs.flush();
    });
    const source = opts.cluster ? `server ${opts.cluster.role.id}` : 'server';
    const print = opts.log ?? ((m: string) => console.log(m));
    const log = (m: string) => {
      print(m);
      logs.event(/\b(error|failed|could not|can't|cannot)\b/i.test(m) ? 'Error' : 'Information', m, source);
    };
    // A certificate first: without one there is nothing to serve https with.
    const auto = opts.acme ? new AutoTls(opts.dir, { ...opts.acme, httpsPort: opts.port ?? 443, log }) : undefined;
    if (auto) disposers.push(() => auto.stop());
    const mcpOrigins = [...(opts.mcpAllowedOrigins ?? []), ...(opts.acme ? acmeOrigins(opts.acme.domains, opts.port ?? 443) : [])];
    let certificate: { cert: string | Buffer; key: string | Buffer } | undefined;
    if (auto) {
      const c = await auto.start();
      certificate = { cert: c.cert, key: c.key };
    }
    const link = opts.cluster;
    // Recover restores before opening stores; the cluster front already owns its folder.
    releaseFolder = link ? undefined : claimFolder(opts.dir);
    // Shared results keep a reader open, so exclude encryption, backups and standbys.
    const share = !opts.encryptionKey && !opts.progressive && !opts.replicationToken;
    const host = new Host(opts.dir, log, { background: opts.background && opts.watch !== false, encryptionKey: opts.encryptionKey, shareResults: share, ...link?.hostOptions() });
    if (link) disposers.push(() => link.close());
    disposers.push(() => host.notifier.stop());
    disposers.push(() => host.close({ unlocked: !started && !!link?.role.restart }));
    host.scriptNetwork = opts.scriptNetwork === true;
    host.scriptNetworkAllow = parseAllowList(opts.scriptNetworkAllow ?? []).length ? [...opts.scriptNetworkAllow!] : [];
    host.appConnections = opts.appConnections === true;
    if (opts.testOutbound) {
      host.testOutbound(opts.testOutbound);
      const t = opts.testOutbound;
      log(`outbound test mode: mail goes to the outbox${t.smtp && t.redirectTo ? `, with a copy to ${t.redirectTo}` : ''}; requests reach ${t.allowHosts?.length ? t.allowHosts.join(', ') : 'no host'}`);
    } else if (opts.sendMail) {
      host.sendMail(opts.sendMail);
      log(`Send Mail via SMTP sends from ${opts.sendMail.from}`);
    }
    host.logs = logs;
    // Only the leader of a cluster mails, so one event is one message.
    if (logs.rotate) logs.onEntry = (type, src, message) => host.notifier.note(type, src, message);
    host.publicUrl = opts.publicUrlIsDefault ? undefined : opts.publicUrl;
    host.listFilesPublicly = !!opts.listFilesPublicly;
    const api = new DataApi(host);
    const web = new WebClient(host, api);
    disposers.push(() => web.stop());
    const live = new Live(host, api);
    disposers.push(() => live.closeAll());
    const sql = new SqlEndpoint(host, api);
    const files = new ContainerFiles();
    disposers.push(() => files.stop());
    host.beforeClose.push((store) => files.clear(store.path));
    host.onAdd.push((store) => files.clear(store.path));
    const odata = new ODataEndpoint(host, api);
    const cwpXml = new CwpXmlEndpoint(host, api);
    const scim = new ScimEndpoint(host, api);
    odata.files = files;
    let closeLocal = () => {};
    disposers.push(() => closeLocal());
    const admin = new Admin(host, api);
    disposers.push(() => admin.securityAudit.stop());
    admin.logs = logs;
    admin.log = log;
    const metrics = new Metrics();
    disposers.push(() => metrics.stop());
    const requestGate = new RequestGate(opts.requestLimit ?? Number(process.env.TABULARIUS_REQUEST_LIMIT ?? 32), opts.requestQueue ?? Number(process.env.TABULARIUS_REQUEST_QUEUE ?? 64));
    metrics.requestGate = requestGate;
    admin.metrics = metrics;
    admin.uploads = new Uploads(host, log);
    disposers.push(() => admin.uploads!.stop());
    admin.live = live;
    const stopWatching = opts.watch === false ? () => {} : host.watch(log);
    disposers.push(stopWatching);
    if (opts.background && opts.watch !== false) void host.scan(log);
    // Damaged pages are found now, off the request path, not by the first person whose query lands on one. A cluster's
    // other processes host the same files, so only the leader checks and tells the others what it finds.
    if ((!link || link.role.leader) && opts.checkFiles !== false) void host.scanIntegrity();
    // A --backup-dir wins; otherwise the folder set in the admin console; otherwise <folder>/Backups.
    const savedBackupDir = host.config.backupDir();
    const configuredBackupDir = opts.backups?.dest ?? savedBackupDir;
    const backupDir = configuredBackupDir ?? defaultBackupDir(opts.dir);
    if (!link) sweepCrashLeftovers(opts.dir, backupDir);
    const offsite = opts.offsite ? scheduleOffsite(backupDir, new S3(opts.offsite), { every: opts.offsite.every ?? 5 * 60_000, log }) : undefined;
    if (offsite) disposers.push(() => offsite.stop());
    admin.offsite = offsite;
    admin.backupDirInUse = backupDir;
    admin.serviceInstalled = opts.serviceInstalled;
    // Given at start and not the one saved in the console: the console can save one, but it only counts after a start without.
    admin.backupDirFixed = opts.backups?.dest !== undefined && resolve(opts.backups.dest) !== savedBackupDir;
    admin.backups = opts.backups ? scheduleBackups(opts.dir, {
      ...opts.backups, dest: configuredBackupDir, log,
      onSet: (dir) => {
        admin.progressive?.follow(dir);
        void offsite?.run();
      },
    }) : undefined;
    disposers.push(() => admin.backups?.stop());
    // A standby's folder served on its own: it takes over from the server it followed.
    const was = standbyState(opts.dir, log);
    if (was) {
      const unfinished = unfinishedStandbyFiles(was);
      log(`taking over from ${was.primary}: this folder was its standby${unfinished.length ? `; ${unfinished.join(', ')} had not caught up to a whole state and may need restoring from a backup` : ''}`);
      rmSync(join(opts.dir, STANDBY_STATE), { force: true });
    }
    // Each file's changes, taken for point-in-time backups and standbys.
    const shipper = new LogShipper(host, log);
    let replication: Replication | undefined;
    disposers.push(() => shipper.stop());
    // Closing or pausing a file folds its log into it: save its last changes first, when anything follows them.
    host.beforeClose.push(() => {
      if (admin.progressive || replication) shipper.ship();
    });
    // Files the server keeps from AI (--ai-exclude), from when they open.
    excludeFromAi(host, opts.aiExclude ?? []);
    // A file hosted (or opened again) from now on keeps its changes for them from its first write.
    host.onAdd.push((store) => {
      if (admin.progressive || replication) shipper.follow(store);
    });
    replication = opts.replicationToken ? new Replication(host, shipper, opts.replicationToken) : undefined;
    if (replication) {
      const acquired = replication;
      disposers.push(() => acquired.close());
    }
    admin.replication = replication;
    if (opts.progressive) {
      const progressiveStarting = scheduleProgressive(host, { ...opts.progressive, dest: configuredBackupDir, keep: opts.backups?.keep, log, shipper }).then((p) => {
        if (closed) p.stop();
        else admin.progressive = p;
      }, (e) => log(`point-in-time backups could not start: ${(e as Error).message}`));
      disposers.push(async () => { await progressiveStarting; admin.progressive?.stop(); });
    }
    const schedules = new Schedules(host, log);
    disposers.push(() => schedules.stop());
    schedules.broadcast = (text) => live.message(text);
    // In a cluster only the leader runs schedules.
    if (link && !link.role.leader) schedules.stop();
    admin.schedules = schedules;
    const syncConsole = new SyncConsole(host, log);
    admin.sync = syncConsole;
    schedules.syncJobs = syncConsole.jobs();
    const changes = new ChangeFeed(host, api);
    const calendar = new CalendarFeeds(host, api);
    const webhooks = new Webhooks(host, changes, opts.webhooks === true, log);
    disposers.push(() => webhooks.stop());
    admin.webhooks = webhooks;
    const inboundHooks = new InboundHooks(host, opts.inboundHooks === true, log);
    admin.inboundHooks = inboundHooks;
    const connections = new Connections(host.dir, log);
    admin.connections = connections;
    host.connections = connections;
    host.scriptConnections = scriptConnections(connections, { captureOnly: () => host.captureOnlyExtra });
    const profiler = new Profiler();
    host.profiler = profiler;
    admin.profiler = profiler;
    // Finds are timed too, for the slow-finds list and its index suggestions.
    const timeFinds = (s: Store) => { s.findListener = (t) => profiler.find(s.name, t); };
    for (const s of host.openStores()) timeFinds(s);
    host.onAdd.push(timeFinds);
    const mcpTokens = new McpTokens(opts.dir);
    const mcpInFlight = new IdentityInFlight();
    const mcpStreams = new StreamSlots();
    disposers.push(() => mcpStreams.closeAll());
    // Sign-in for remote AI apps (claude.ai and Claude Desktop connectors) at /mcp, with the files' own accounts.
    const oauth = new OAuthServer(host, opts.dir, { publicUrl: opts.publicUrl });
    disposers.push(() => oauth.close());
    admin.mcpTokens = mcpTokens;
    const adminApi = new AdminApi(admin, host, api);
    adminApi.schedules = schedules;
    adminApi.live = live;
    const design = new DesignApi(host, api);
    const dashboards = new DashboardApi(host, api);
    const cleanup = new CleanupApi(host, api);
    const agent = new AgentApi(host, api);
    const automations = new AutomationApi(host, api);
    host.automations = new AutomationRunner(host);
    const security = new SecurityApi(host, api);
    let oidc: Oidc | undefined;
    if (opts.oidc && (!Array.isArray(opts.oidc) || opts.oidc.length)) {
      try { oidc = new Oidc(host, api, opts.oidc, opts.publicUrl); }
      catch (e) {
        const error = (e as Error).message;
        admin.oidcStatus = { on: false, error };
        (opts.log ?? console.log)(`OIDC sign-in disabled: ${error}`);
      }
      if (oidc) admin.oidcStatus = { on: true, ...(oidc.storageWarning ? { warning: oidc.storageWarning } : {}) };
    }
    oauth.useOidc(oidc);
    if (oidc) disposers.push(() => oidc.close());
    if (oidc) api.oauth = { take: (requestId, identifier) => oidc.takeGrant(requestId, identifier) };
    if (opts.ldap) api.directory = ldapAuthenticator(opts.ldap);
    const debug = new DebugApi(host, api);
    disposers.push(() => debug.stop());
    const assistant = new Assistant(host, api, opts.ai ? { ...opts.ai, log } : opts.ai);
    admin.assistant = assistant;
    // An older server's count is read into the shared file at startup, so the console shows today's use straight away.
    assistant.readOldUsage();
    // FileMaker's AI script steps answer with the same model, under the same daily limits and per-file AI switch.
    host.scriptAi = assistant.scriptAi();
    // Scheduled digests: dashboards worked out and summarised on a schedule. In a cluster only the leader runs them.
    const digestRunner = new DigestRunner(host, log);
    disposers.push(() => digestRunner.stop());
    if (assistant.available) digestRunner.writer = assistant;
    if (assistant.available) web.importMapper = (store, account) => (input, signal) => assistant.mapImport(store, account, input, signal);
    if (assistant.available) web.aiFiller = (store, account) => (input, signal) => assistant.fillField(store, account, input, signal);
    if (assistant.available) design.speedAi = (store, account, context, signal) => assistant.speedIdeas(store, account, context, signal);
    // The script editor's "Suggest test cases": written by the model, run offline on a copy before anyone keeps one.
    if (assistant.available) design.testWriter = (store, account) => (input, signal) => assistant.suggestScriptTests(store, account, input, signal);
    digestRunner.poster = webhooks;
    if (!link || link.role.leader) digestRunner.start();
    admin.digests = digestRunner;
    // A plain-English guide to each converted file: what won't work, what works differently, what to use instead.
    const guides = new ConversionGuides(() => host.names(), log);
    disposers.push(() => guides.stop());
    if (assistant.available) guides.overview = (s, text) => assistant.conversionOverview(s, text, AbortSignal.timeout(120_000));
    host.guides = guides;
    admin.guides = guides;
    if (!link || link.role.leader) {
      for (const s of host.openStores()) guides.hosting(s);
      host.onAdd.push((s) => guides.hosting(s));
    }
    const digests = new DigestApi(host, api, digestRunner);
    digests.webhooks = () => webhooks.list();

    let tls: { cert: string | Buffer; key: string | Buffer } | undefined = certificate ?? (opts.tlsCert && opts.tlsKey ? { cert: readFileSync(opts.tlsCert), key: readFileSync(opts.tlsKey) } : undefined);
    // In a cluster's worker, the front process holds the certificate and tells this one about it.
    const certState = auto ?? link?.certificate();
    admin.tls = certState;
    link?.attach(host, api, live, { profiler, metrics });
    // Once the server is closing, requests already running finish and new ones are told to come back (see server.close below).
    let draining = false;
    // setTimeout takes at most 2^31 - 1 ms; anything else (0, negative, NaN) would cut connections at once.
    const drainMs = Number.isFinite(opts.drainMs) && opts.drainMs! >= 1000 ? Math.min(opts.drainMs!, 2 ** 31 - 1) : 20_000;
    const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => writer.run({}, async () => {
      if (draining) {
        // Plain text, not the error page: that one tells a browser the server is starting and to try again by itself.
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '5', connection: 'close' }).end('The server is restarting. Try again in a minute.\n');
        return;
      }
      legacyRequest(req);
      // A worker gets the client's address from the front process, which already looked past any proxy.
      if (link) link.peer(req);
      else if (!useForwardedFor(req, opts.proxyHeader, trustedProxies)) {
        refuseForwarding(res, (text) => logs.write('Event', 'Warning', '', text));
        return;
      }
      let url: URL;
      try { url = new URL(req.url ?? '/', 'http://localhost'); }
      catch {
        res.writeHead(400, { connection: 'close', 'content-length': '0' }).end();
        return;
      }
      metrics.track(req, res, url.pathname);
      compressResponse(req, res, url.pathname);
      // Health always answers. An event stream is long-lived and has a separate
      // stream limit; holding a short-request slot for its lifetime would starve
      // ordinary calls at normal session counts.
      const stream = isEventStream(req.method, url.pathname);
      const release = url.pathname === '/tabularius/health' || stream ? undefined : await requestGate.enter(req, res, requestClass(req.method, url.pathname));
      if (req.socket.destroyed || res.destroyed || res.writableEnded) {
        release?.();
        return;
      }
      if (!release && url.pathname !== '/tabularius/health' && !stream) {
        if (!res.destroyed && !res.writableEnded) {
          busyHeaders(res);
          if (isDataApiPath(url.pathname)) res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ messages: [{ code: '301', message: 'Server busy. Try again shortly.' }], response: {} }));
          else if (wantsPage(req)) sendError(req, res, 503);
          else res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 503, message: 'Server busy. Try again shortly.' } }));
        }
        return;
      }
      try {
      // What the audit log says a record change came from (the Data API's sign-in refines "rest" to "web" for the web client).
      const via = auditSurface(url.pathname);
      const context = writer.getStore();
      if (via && context) context.surface = via;
      // Changes made through the admin console and the Admin API: who, what, and how it went (never a body, which may hold a password).
      // An upload's pieces are left out: one file is hundreds of them.
      if (req.method !== 'GET' && req.method !== 'HEAD' && (url.pathname.startsWith('/tabularius/admin/') || url.pathname.startsWith('/fmi/admin/')) && req.method !== 'PUT') {
        res.on('finish', () => logs.write('Admin', res.statusCode >= 400 ? 'Warning' : 'Information', clientAddress(req), `${req.method} ${redactPath(url.pathname)} ${res.statusCode}`));
      }
      try {
        if (url.pathname === '/tabularius/health') return metrics.health(res);
        // How to trust the server's own certificate authority (--https local): open to all, as devices need it first.
        if (url.pathname.startsWith('/tabularius/tls') && handleTrust(opts.dir, req, res, url.pathname)) return;
        if (await api.handle(req, res, url)) return;
        if (await live.handle(req, res, url)) return;
        if (await sql.handle(req, res, url)) return;
        if (await odata.handle(req, res, url)) return;
        if (await cwpXml.handle(req, res, url)) return;
        if (await scim.handle(req, res, url)) return;
        if (replication && await replication.handle(req, res, url)) return;
        if (await changes.handle(req, res, url)) return;
        if (await calendar.handle(req, res, url)) return;
        if (await adminApi.handle(req, res, url)) return;
        if (await admin.handle(req, res, url)) return;
        if (await web.handle(req, res, url)) return;
        if (await design.handle(req, res, url)) return;
        if (await dashboards.handle(req, res, url)) return;
        if (await cleanup.handle(req, res, url)) return;
        if (await agent.handle(req, res, url)) return;
        if (await automations.handle(req, res, url)) return;
        if (await inboundHooks.handle(req, res, url)) return;
        if (await digests.handle(req, res, url)) return;
        if (await security.handle(req, res, url)) return;
        if (oidc && await oidc.handle(req, res, url)) return;
        if (await oauth.handle(req, res, url)) return;
        if (url.pathname === '/tabularius/auth/v1/providers') {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end('{"providers":[]}');
          return;
        }
        if (await debug.handle(req, res, url)) return;
        if (await assistant.handle(req, res, url)) return;
        const c = /^\/tabularius\/containers\/([^/]+)\/(\d+)(?:\/[^/]*)?$/.exec(url.pathname);
        if (c && (req.method === 'GET' || req.method === 'HEAD')) {
          const [db, id] = [decodeURIComponent(c[1]), Number(c[2])];
          const store = host.checkUrl(db, id, url.searchParams) ? host.get(db) : undefined;
          if (!store) {
            res.writeHead(404).end();
            return;
          }
          const thumb = url.searchParams.get('thumb');
          await files.send(req, res, store, id, { thumb: thumb === null ? undefined : Number(thumb) || 256 });
          return;
        }
        if (url.pathname === '/mcp') {
          if (!mcpOriginAllowed(req, host.publicUrl, mcpOrigins)) {
            res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid Origin header' }, id: null }));
            return;
          }
          const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
          const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
          // A request a proxy on this computer passed on (it says whom for), or that a page addressed to another name
          // (DNS rebinding), is not this computer asking.
          const loopback = directFromThisComputer(req);
          let who: McpIdentity | undefined;
          let expired = false;
          if (basic) {
            // An account: its password and privileges are checked in each file it touches.
            const [account, ...rest] = Buffer.from(basic, 'base64').toString('utf8').split(':');
            if (account) who = { account, password: rest.join(':'), from: clientAddress(req), otp: String(req.headers['x-tabularius-otp'] ?? '') };
          } else {
            // An API token of a file (Manage Security, or the admin console's Connect an AI app): one account of that file, its
            // privilege set narrowed to the token's scope. Older admin console tokens (ohm_) sign in as their account.
            const api = bearer?.startsWith('ohbt_') ? apiTokenIdentity(host, bearer, clientAddress(req)) : undefined;
            const scoped = api ?? (bearer ? mcpTokens.check(bearer) : undefined);
            if (scoped) who = scoped;
            else if (opts.mcpToken && bearer && sameToken(bearer, opts.mcpToken)) who = { admin: true };
            // A file's token that has expired or was revoked is refused, even from this computer, so the app signs in
            // again (or refreshes it) rather than quietly working as the administrator.
            else if (bearer?.startsWith('ohbt_') || bearer?.startsWith('ohm_')) expired = true;
            // Local administrator access is credential-free. An unsupported credential
            // (including a Data API session token) must never gain server authority.
            else if (!req.headers.authorization && !opts.mcpToken && loopback) who = { admin: true };
          }
          if (!who) {
            // Apps that sign in with OAuth (claude.ai and Claude Desktop connectors) find the sign-in from the Bearer challenge.
            const challenge = `${oauth.challenge(req, expired ? 'invalid_token' : undefined)}, Basic realm="tabularius"`;
            if (!req.headers.authorization && wantsPage(req)) sendError(req, res, 401, { 'www-authenticate': challenge });
            else res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': challenge }).end(JSON.stringify({ error: expired ? 'invalid_token' : 'unauthorized' }));
            return;
          }
          // GET may keep an SSE response open, so it does not use a short-request slot.
          if (req.socket.destroyed || res.destroyed || res.writableEnded) return;
          const identity = 'admin' in who ? 'admin' : JSON.stringify(['account', who.account.toLowerCase()]);
          const streamDone = req.method === 'GET' ? mcpStreams.enter(identity, res) : undefined;
          if (req.method === 'GET' && !streamDone) {
            busyHeaders(res);
            res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Too many MCP event streams' }));
            return;
          }
          const done = req.method === 'GET' ? undefined : mcpInFlight.enter(identity, res);
          if (req.method !== 'GET' && !done) {
            busyHeaders(res);
            res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests in flight for this identity' }, id: null }));
            return;
          }
          try {
            // Basic credentials need a payload-selected file before they can be verified. Verified
            // account/API/OAuth tokens retain the SDK limit, independently of their privileges.
            const maxRequestBodySize = 'password' in who ? AUTH_BODY_LIMIT : DEFAULT_MAX_REQUEST_BODY_SIZE;
            let parsedBody: unknown;
            // Preserve the transport's early header errors; only valid JSON requests reach its body reader.
            const accept = req.headers.accept ?? '';
            if (req.method === 'POST' && accept.includes('application/json') && accept.includes('text/event-stream') && isJsonContentType(req.headers['content-type'])) {
              try {
                if (Number(req.headers['content-length']) > maxRequestBodySize) {
                  res.setHeader('connection', 'close');
                  throw new ApiError(960, 'Request body too large', 413);
                }
                parsedBody = parseRequestJson((await readBody(req, maxRequestBodySize)).toString('utf8'));
                const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
                const wrong = messages.length ? messages.map(invalidMessage).find(Boolean) : 'a batch needs at least one message';
                if (wrong) {
                  res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: `Invalid Request: ${wrong}` }, id: null }));
                  return;
                }
              } catch (e) {
                const tooLarge = e instanceof ApiError && e.status === 413;
                res.writeHead(tooLarge ? 413 : 400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: tooLarge ? -32000 : -32700, message: tooLarge ? requestBodyTooLargeMessage(maxRequestBodySize) : 'Parse error: Invalid JSON' }, id: null }));
                return;
              }
            }
            // Stateless: a fresh MCP server per request.
            const mcp = createMcpServer(host, who, { sync: syncConsole, schedules });
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize });
            res.on('close', () => {
              transport.close();
              mcp.close();
            });
            await mcp.connect(transport);
            // A disconnect during setup must not attach a transport after its close callback already ran.
            if (req.socket.destroyed || res.destroyed || res.writableEnded) {
              await transport.close();
              await mcp.close();
              streamDone?.();
              return;
            }
            await transport.handleRequest(req, res, parsedBody);
          } catch (e) { streamDone?.(); throw e; }
          finally { done?.(); }
          return;
        }
        if (url.pathname === '/docs' || url.pathname === '/docs/' || url.pathname.startsWith('/docs/')) {
          // The guides (docs/*.md and docs/reference/*.md) as pages, one per file, with an index.
          if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(req, res, 405, { allow: 'GET, HEAD' });
          const name = url.pathname.replace(/^\/docs\/?/, '').replace(/\/$/, '');
          const page = name ? guidePage(name) : guideIndex();
          if (page) sendConditional(req, res, {
            'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'",
          }, page);
          else sendError(req, res, 404);
          return;
        }
        if (url.pathname === '/') {
          if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(req, res, 405, { allow: 'GET, HEAD' });
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'tabularius', ...(host.listFilesPublicly ? { databases: host.names() } : {}) }));
          return;
        }
        sendError(req, res, 404);
      } catch (e) {
        // A request the caller got wrong (a body that is too large, or not JSON) is theirs to hear about, not a server error to log.
        if (e instanceof ApiError && e.status < 500) {
          if (!res.headersSent) res.writeHead(e.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message }));
          return;
        }
        // A malformed % escape in the path (/databases/%zz/...) is the caller's mistake, whichever route decoded it.
        if (e instanceof URIError) {
          if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'The request path has an invalid % escape.' }));
          return;
        }
        console.error(e);
        if (!res.headersSent) sendError(req, res, 500);
      }
      } finally { release?.(); }
    });
    const server = createEdgeServer(handler, opts.edgeLimits, tls, link ? {} : { proxyHeader: opts.proxyHeader, trustedProxies });
    const close = server.close.bind(server);
    disposers.push(async () => {
      if (!server.listening) return;
      server.closeAllConnections();
      await new Promise<void>((resolve) => close(() => resolve()));
    });
    // http:// to the same port is sent on to https://.
    if (tls && !link) redirectPlainHttp(server as unknown as import('node:tls').Server, opts.edgeLimits, { proxyHeader: opts.proxyHeader, trustedProxies });
    // PostgreSQL clients, with the same certificate (renewals included).
    const pg = opts.sqlPort === undefined ? undefined : new PgServer(host, {
      port: opts.sqlPort, hostname: opts.hostname, log,
      tls: () => auto?.current ? { cert: auto.current.cert, key: auto.current.key } : tls ?? (link?.tls && { cert: link.tls.cert, key: link.tls.key }),
    });
    if (pg) disposers.push(() => pg.close());
    metrics.sources = {
      host,
      clients: () => api.list(),
      liveStreams: () => live.streamCount,
      sessionsHeld: () => api.sessionCount,
      pgConnections: pg && (() => pg.connections),
      get backups() { return admin.backups; },
      get progressive() { return admin.progressive; },
      offsite,
      schedules: () => schedules?.all() ?? [],
      certificateExpires: () => certState?.current?.expires,
      diskFree: () => [{ area: 'data', path: opts.dir }, { area: 'backups', path: admin.backupDest() }],
      standbys: replication && (() => replication.standbys()),
    };
    const statsLog = new StatsLog(opts.dir, metrics, {
      clients: () => api.list().length,
      openFiles: () => host.names().length,
      sessions: () => api.sessionCount,
    }, { intervalMs: opts.statsInterval ?? 60_000, limit: opts.logLimit, stats: !opts.cluster || opts.cluster.role.leader });
    statsLog.start();
    disposers.push(() => statsLog.stop());
    // Renewed certificates are used for new connections at once.
    if (auto) auto.onRenew = (c) => (server as import('node:https').Server).setSecureContext({ cert: c.cert, key: c.key });
    // A certificate put in place through the Admin API (fmcsadmin certificate import): only where the folder's settings
    // give the certificate, since --https and --tls-cert would replace it at the next start.
    adminApi.certificates = {
      store: new ImportedCertificates(opts.dir),
      // A cluster's worker is started without the certificate options: the front process works it out for it.
      managed: opts.certificateManaged ?? certificateManaged(opts),
      // In a cluster the front process serves https: it takes the new certificate at the next start.
      use: tls && !link ? (cert, key) => {
        (server as import('node:https').Server).setSecureContext({ cert, key });
        tls = { cert, key };
      } : undefined,
    };
    // Entries older than a file's retention setting are removed once an hour (the chain records that they were).
    const auditPruning = setInterval(() => {
      for (const name of host.names()) {
        try { host.get(name)?.pruneAudit(); } catch (e) { logs.write('Event', 'Warning', '', `${name}: audit retention failed: ${(e as Error).message}`); }
      }
    }, 3_600_000);
    auditPruning.unref();
    disposers.push(() => clearInterval(auditPruning));
    // Live event streams stay open; closing the server ends them.
    let finishedClosing!: () => void;
    const closing = new Promise<void>((resolve) => { finishedClosing = resolve; });
    server.close = (cb?: (err?: Error) => void) => {
      // Closing twice (a second Ctrl-C, a test's cleanup) waits for the first to finish rather than starting again.
      if (draining) {
        void closing.then(() => cb?.());
        return server;
      }
      draining = true;
      clearInterval(auditPruning);
      const auditsStopped = admin.securityAudit.stop();
      void auditsStopped.catch(() => {});
      live.closeAll();
      mcpStreams.closeAll();
      webhooks.stop();
      digestRunner.stop();
      guides.stop();
      replication?.close();
      void host.stopWarming();
      // Done once the files are closed too: background warming may still be stopping when the server's sockets are.
      // Requests already running get `drainMs` to finish; a connection that goes idle meanwhile is closed rather than reused.
      const idle = setInterval(() => server.closeIdleConnections(), 200);
      const cut = setTimeout(() => {
        server.getConnections((_, n) => {
          logs.event('Warning', `Stopping: ${n} ${n === 1 ? 'connection was' : 'connections were'} still busy after ${Math.round(drainMs / 1000)} s and ${n === 1 ? 'was' : 'were'} closed`, source);
          server.closeAllConnections();
        });
      }, drainMs);
      close((err) => {
        clearInterval(idle);
        clearTimeout(cut);
        void Promise.all([dispose(), auditsStopped]).then(
          () => { finishedClosing(); cb?.(err); },
          (error) => { finishedClosing(); cb?.(error); },
        );
      });
      server.closeIdleConnections();
      return server;
    };

    return await new Promise((resolve, reject) => {
      // Another program on the port: say so plainly (a service manager's log shows it) rather than crash with a stack.
      const failed = (e: Error) => {
        reject(link ? e : listenError(e, opts.port ?? 8080, opts.hostname ?? '127.0.0.1'));
      };
      server.once('error', failed);
      const listening = () => {
        server.off('error', failed);
        try {
          const addr = server.address();
          const port = typeof addr === 'object' && addr ? addr.port : opts.port;
          if (auto && port) auto.httpsPort = port;
          if (pg) {
            pg.listen().then((p) => log(`PostgreSQL clients: port ${p}`), (e) => log(`SQL port ${opts.sqlPort} could not open: ${(e as Error).message}`));
          }
          const url = auto
            ? `https://${urlHostname(opts.acme!.domains[0])}${port === 443 ? '' : ':' + port}`
            : `${tls ? 'https' : 'http'}://${urlHostname(opts.hostname ?? '127.0.0.1')}:${port}`;
          host.setBaseUrl(opts.publicUrl ?? url);
          // Commands on this machine reach the admin console without a password (local-admin.ts); a cluster's front process does this.
          if (!link && port) closeLocal = openLocalAccess(opts.dir, localUrl(opts.hostname, port, !!(tls || auto)));
          if (!opts.publicUrl) onForwardedWithoutPublicUrl((m) => logs.event('Warning', m, source));
          logs.event('Information', `Server started at ${opts.publicUrl ?? url}, hosting ${host.names().length} ${host.names().length === 1 ? 'file' : 'files'} (version ${SERVER_VERSION})`, source);
          // Warn about any hosted file with an account that still has the file's
          // empty password and can sign in over the network — a FileMaker-era
          // exposure the admin console also flags. Best-effort; never blocks start.
          for (const name of host.names()) {
            try {
              const risky = host.get(name)!.securityHealth().emptyPassword.filter((e) => e.networkLogin).map((e) => e.account);
              if (risky.length) logs.event('Warning', `${name}: ${risky.length === 1 ? 'account' : 'accounts'} ${risky.join(', ')} still ${risky.length === 1 ? 'has' : 'have'} the file's empty password and can sign in over the network — set a password, require a second factor, or deactivate ${risky.length === 1 ? 'it' : 'them'} (Security health in the admin console)`, source);
            } catch { /* a report failure must not stop the server */ }
          }
          started = true;
          server.on('close', () => { void dispose().catch(() => {}); });
          resolve({ server, host, url, tls: auto, offsite, get progressive() { return admin.progressive; } });
        } catch (error) { failed(error as Error); }
      };
      // A cluster worker listens on its socket; clients reach it through the front process (opts.publicUrl).
      if (link) {
        // A worker that was killed leaves its socket file behind; the one replacing it takes the same path.
        if (process.platform !== 'win32') rmSync(link.role.socket, { force: true });
        server.listen(link.role.socket, listening);
      }
      else server.listen(opts.port ?? 8080, opts.hostname ?? '127.0.0.1', listening);
    });
  } catch (error) {
    try { await dispose(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'The server did not start, and its cleanup afterwards did not finish either; see the errors listed with this one'); }
    throw error;
  }
}

/** MCP over stdio, for desktop AI apps that launch the server themselves; with an account, within its privileges. */
export async function serveStdio(dir: string, who: McpIdentity = { admin: true }, opts: { aiExclude?: string[] } = {}): Promise<void> {
  const host = new Host(dir, (m) => process.stderr.write(m + '\n'));
  excludeFromAi(host, opts.aiExclude ?? []);
  await createMcpServer(host, who).connect(new StdioServerTransport());
}
