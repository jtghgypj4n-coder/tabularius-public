// The set of hosted solutions. Point it at a folder: every .fmp12 file in it
// is converted once (to <name>.openhbam.sqlite next to it) and hosted under
// its file name, the way FileMaker Server hosts its Databases folder. The
// converted store is the live database from then on; the .fmp12 is never
// written to, and is not re-imported over a store that may have edits.

import { cancellationScope } from '../../scripts/src/cancellation.ts';
import { setTimeout as cancellationDelay } from 'node:timers/promises';
import { workerResult } from './worker-result.ts';
import { expiryClock } from '../../store/src/clock.ts';
import { crashPoint } from '../../store/src/crash-point.ts';
import { ConnectionError, mailFailure, mailRecipientLimit, smtpAccount, type Connections } from './connections.ts';
import { Outbox } from './outbox.ts';
import { MailLimit, MAIL_LIMIT_FILE } from './mail-limit.ts';
import { mailTransport, redirectTransport, type SmtpConfig } from './smtp.ts';
import { captureOnly, neverAllowed, type OutboundTest, type OutgoingMail, type ScriptConnections, type RedirectedMessage, type ScriptAi } from '../../scripts/src/index.ts';
import { accessSync, constants, readdirSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { completeConversionSource, conversionTemp, finishConversion, publishConversion, stageConversionSource, sweepConversionTemps } from './conversion-files.ts';
import { Worker } from 'node:worker_threads';
import { Warmer } from './warmer.ts';
import { pageCheck, type PageCheck } from './backup-verify.ts';
import { encryptionInfo, fileSource, FmpFile } from '../../fmp12/src/index.ts';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join, basename, extname } from 'node:path';
import { hostname } from 'node:os';
import { FileDamaged, STORE_FORMAT, createStore, importFmp12, needsDesigns, NATIVE_REFUSAL, reconvert, reconvertCheck, upgradeDesigns, Store, type ReconvertCheck, type ReconvertPreview, type ReconvertResult, type ImportProgress, type RecordLocks, webViewerEntryCovers } from '../../store/src/index.ts';
import { decryptFileSync, encryptFileSync, ENCRYPTED_EXT } from './encrypt.ts';
import type { ScriptProfile } from '../../scripts/src/index.ts';
import { ScriptQueue } from './server-queue.ts';
import type { ServerLogs } from './server-logs.ts';
import type { ConversionGuide } from './conversion-guide.ts';
import { loadPlugins, PluginRegistry } from '../../plugins/src/index.ts';
import { installPackage, readPackage, trustedPublishers } from '../../plugins/src/package.ts';
import { ServerConfig } from './server-config.ts';
import { Notifier } from './notifications.ts';
import { compactInWorker, compactionDue, fileBytes, type CompactionReport } from './compaction.ts';
import { BoundedMap } from './bounded-map.ts';

export const STORE_EXT = '.openhbam.sqlite';

/**
 * Guards for converting an untrusted upload (not a file the operator dropped
 * into the folder): the worker's heap is capped so a file that expands to huge
 * memory out-of-memories the worker rather than the server, and the conversion
 * is stopped after a time budget so a file that makes the reader loop can't
 * block the single conversion slot for good. Generous defaults; raise them with
 * TABULARIUS_CONVERT_MEMORY (MB) and TABULARIUS_CONVERT_TIMEOUT (seconds, 0 = none)
 * for an environment that hosts genuinely large uploads.
 */
const UPLOAD_CONVERT_LIMITS = {
  memoryMb: Math.max(0, Math.trunc(Number(process.env.TABULARIUS_CONVERT_MEMORY ?? 2048)) || 0),
  timeoutMs: Math.max(0, Math.trunc(Number(process.env.TABULARIUS_CONVERT_TIMEOUT ?? 900)) || 0) * 1000,
};

/** The account row a container link is tied to. */
export interface LinkAccount { name: string; identity: string }

/** The most web hosts the app page's frame policy names, across all files. */
export const WEB_VIEWER_HOSTS_ALL_MAX = 200;
/** And the most the names take in the header, with their `https://` and space. */
export const WEB_VIEWER_HOSTS_ALL_BYTES = 8000;

export class Host {
  readonly dir: string;
  private readonly stores = new Map<string, Store>();
  // Container URLs are signed so they work in <img src> without a token,
  // like FileMaker's streaming URLs. The key lasts as long as the process.
  // Processes of one server share it (see cluster.ts), so a URL works whichever of them answers.
  private readonly urlKey: Buffer;
  // Signed container/image URLs carry an expiry, so one that leaks (a browser
  // history, a proxy log, a copied link) stops working. Default one hour; set
  // TABULARIUS_CONTAINER_TTL to the number of seconds, or 0 to never expire.
  private readonly urlTtlMs = Math.max(0, Number(process.env.TABULARIUS_CONTAINER_TTL ?? 3600)) * 1000;
  private baseUrl?: string;
  /** The address clients reach the server at, when it was given (--public-url): links and passkeys use it, never a request's headers. */
  publicUrl?: string;
  /** Operator-configured HTTPS origins for browser requests when no public URL is set. */
  browserOrigins: readonly string[] = [];
  /** The domains `--https` gets a certificate for, once the server has them: names this server answers to. */
  acmeDomains: string[] = [];
  /** The origins that may call /mcp from a browser (--mcp-origin), plus the `--https` ones: names this server answers to. */
  mcpAllowedOrigins: string[] = [];
  /** Other names this computer is known by (its own host name). A request's Host header is counted only where the request is in hand. */
  ownAliases: string[] = [hostname()];
  /** Whether the file lists (the Data API's, OData's and the root's) show every hosted file to callers who haven't signed in (file-list.ts). */
  listFilesPublicly = false;
  /** Whether scripts may reach the network (Insert from URL) in every hosted file (--allow-script-network). Otherwise each file has its own switch (Store.scriptNetwork), off until an administrator turns it on. */
  scriptNetwork = false;
  /** Hosts, addresses and ranges on the machine's own network that scripts' web requests may reach (--allow-script-network-to). */
  scriptNetworkAllow: string[] = [];
  /**
   * Whether a [Full Access] person may finish an AI-drafted connection for their own file from the web app's assistant
   * (type the keys, test, approve) instead of the admin console. Off unless the server is started with it: a connection
   * lets a file's scripts reach outside, which is otherwise for whoever holds the console password.
   */
  appConnections = false;
  /** Installed plug-ins and the ones enabled for each hosted file (none unless an admin adds them). */
  readonly plugins = new PluginRegistry();
  /** Settings every process follows as they change, such as blocking new users. */
  readonly config: ServerConfig;
  /** Emails server events to the address the console sets (notifications.ts). */
  readonly notifier = new Notifier(this);
  /** Outbound test mode (outbound.ts), when the server is started with it: mail and requests go to the outbox. */
  outbound?: OutboundTest;
  /** That mode's outbox, which the admin console shows. */
  outbox?: Outbox;

  /**
   * Turns on outbound test mode. Messages are captured in <folder>/Outbox and,
   * with an SMTP account and a redirect address, copied to that one address;
   * requests reach only `allowHosts`.
   */
  testOutbound(o: { redirectTo?: string; allowHosts?: string[]; smtp?: SmtpConfig; maxCopies?: number; captureOnly?: string[]; copyHeld?: boolean }): void {
    const refused = (o.allowHosts ?? []).filter(neverAllowed);
    if (refused.length) throw new Error(`${refused.join(', ')} can never be allowed in test mode`);
    const outbox = new Outbox(this.dir);
    const transport = o.smtp && o.redirectTo ? redirectTransport(o.smtp, o.redirectTo) : undefined;
    // A run of many scripts must not flood the redirect address: past the limit, messages are only captured.
    let copies = 0;
    const max = o.maxCopies ?? 20;
    const extra = o.captureOnly ?? [];
    this.captureOnlyExtra = [...new Set([...this.captureOnlyExtra, ...extra])];
    const deliver = transport && (async (m: RedirectedMessage) => {
      // A second check, apart from the engine's: nothing is delivered while a capture-only file
      // (a capture-only) is hosted here at all, whichever file's script sent it.
      // Hosted files, and any file in the folder at all (an .fmp12 not converted yet counts too).
      const present = (() => {
        try {
          return readdirSync(this.dir);
        } catch {
          return [];
        }
      })();
      const held = [...m.files, ...this.names(), ...present].find((x) => captureOnly(x, extra));
      if (held !== undefined && o.copyHeld !== true) return `kept in the outbox only: "${held}" is capture-only`;
      if (copies >= max) return false;
      copies++;
      await transport(m);
      return true;
    });
    this.outbox = outbox;
    this.outbound = {
      allowHosts: o.allowHosts ?? [], record: (e) => void outbox.record(e), captureOnly: extra, ...(o.copyHeld === true ? { copyHeld: true } : {}),
      ...(o.redirectTo ? { redirectTo: o.redirectTo } : {}), ...(deliver ? { deliver } : {}),
    };
  }

  /** Send Mail via SMTP's transport when the operator switched sending on with a flag (sendMail). */
  private flagMail?: (m: OutgoingMail) => Promise<void | string>;
  private flagMailFrom?: string;

  /**
   * Send Mail via SMTP's transport, when mail can really be sent: the operator's flag (sendMail), or else an
   * email connection (connections.ts) that is turned on and marked for Send Mail steps. Looked up each time, so
   * the console's changes apply at once.
   */
  get mail(): ((m: OutgoingMail) => Promise<void | string>) | undefined {
    return this.flagMail ?? this.connectionMail();
  }
  /** Whether mail goes out on the operator's own flag (--send-mail) rather than through an email connection. */
  get mailIsFlag(): boolean {
    return this.flagMail !== undefined;
  }
  /** The address that mail comes from, for the admin console. */
  get mailFrom(): string | undefined {
    return this.flagMail ? this.flagMailFrom : this.connections?.mailAccount()?.config.from;
  }
  /** The email connection mail goes through, when it is not the operator's flag. */
  get mailConnection(): string | undefined {
    return this.flagMail ? undefined : this.connections?.mailAccount()?.name;
  }

  /** The first capture-only file a message involves: one it names, one hosted here, or one sitting in the folder. */
  private heldFile(m: OutgoingMail, extra: readonly string[]): string | undefined {
    const present = (() => {
      try {
        return readdirSync(this.dir);
      } catch {
        return [];
      }
    })();
    return [...m.files, ...this.names(), ...present].find((x) => captureOnly(x, extra));
  }

  private limiter?: MailLimit;
  /**
   * How much mail may go through an email connection in an hour, for the server and for each file (a runaway script
   * or loop stops here, and one file cannot use up everyone's); kept in the hosted folder across restarts.
   */
  get mailLimit(): MailLimit {
    return this.limiter ??= new MailLimit(join(this.dir, MAIL_LIMIT_FILE), (m) => this.logs?.write('ScriptEvent', 'Warning', '', m));
  }

  private connectionMail(): ((m: OutgoingMail) => Promise<void | string>) | undefined {
    const connections = this.connections;
    if (!connections?.mailAccount()) return undefined;
    return async (m) => {
      const held = this.heldFile(m, this.captureOnlyExtra);
      if (held !== undefined) return `"${held}" is capture-only, and nothing is sent while it is here`;
      const c = connections.mailAccount(m.files);
      if (!c) return 'no email connection is turned on for this file';
      let account;
      try {
        account = connections.use(c.id, m.files);
      } catch (e) {
        if (e instanceof ConnectionError) return e.message;
        throw e;
      }
      // Still the connection that was picked: marked for mail and turned on.
      if (account.connection.type !== 'smtp' || account.connection.config.mail !== 'yes') return 'the email connection was turned off';
      let transport;
      try {
        transport = mailTransport(smtpAccount(account.connection, account.secrets), account.connection.config.from, mailRecipientLimit(account.connection));
      } catch (e) {
        if (e instanceof ConnectionError) return e.message;
        throw e;
      }
      const secrets = Object.values(account.secrets);
      // Too many recipients is refused before it counts: a loop over a found set stops here, and the limit is the connection's to change.
      const named = m.to.length + m.cc.length + m.bcc.length;
      const most = mailRecipientLimit(account.connection);
      if (named > most) throw new Error(`the message names ${named} recipients, more than ${most}`);
      // A message counts when it is tried, sent or not, so a loop against a failing server stops too.
      const over = this.mailLimit.take(m.files);
      if (over) {
        this.logs?.write('ScriptEvent', 'Warning', m.files[0] ?? '', over);
        return over;
      }
      try {
        await transport(m);
      } catch (e) {
        // What the script, and the person running it, are told never includes what the server echoed of the sign-in.
        throw new Error(mailFailure((e as Error).message, secrets));
      }
    };
  }

  /**
   * Lets Send Mail via SMTP really send, through the operator's account and from `from`. Mail is never
   * sent while a capture-only file (a capture-only, or one named in `captureOnly`) is hosted here or
   * sits in the folder, whichever file's script sends it.
   */
  sendMail(o: { smtp: SmtpConfig; from: string; captureOnly?: string[] }): void {
    const transport = mailTransport(o.smtp, o.from);
    const extra = o.captureOnly ?? [];
    this.captureOnlyExtra = [...new Set([...this.captureOnlyExtra, ...extra])];
    this.flagMailFrom = o.from;
    this.flagMail = async (m) => {
      const held = this.heldFile(m, extra);
      if (held !== undefined) return `"${held}" is capture-only, and nothing is sent while it is here`;
      await transport(m);
    };
  }

  /** Gets the timings of every script run (the admin console's profiler). */
  profiler?: ScriptProfile;

  /** The server's logs (server-logs.ts), when it is serving. */
  get logs(): ServerLogs | undefined {
    return this.serverScripts.logs;
  }
  set logs(logs: ServerLogs | undefined) {
    this.serverScripts.logs = logs;
  }

  /** The server's connections (connections.ts), for the console and the AI tools that draft them; never their secrets. */
  connections?: Connections;
  /** The connections scripts use by name (Insert from URL with connection://name/…), once the server has them. Never given to a run that is offline. */
  scriptConnections?: ScriptConnections;
  /** Files whose scripts never reach outside, besides those the process names: what the operator named for test mode and mail. */
  captureOnlyExtra: string[] = [];

  /** Tabularius's AI for FileMaker's AI script steps, set when the server runs with --ai (scripts/src/ai.ts). */
  scriptAi?: ScriptAi;

  /**
   * The host names this server answers to: the public address, the `--https` domains, the /mcp and browser origins and the
   * computer's own name, plus any the caller has in hand (the Host header of the request being answered). A web viewer on one of them
   * would run beside the app with scripts and same-origin together, so no file's list may allow them.
   */
  ownHostNames(extra: readonly string[] = []): string[] {
    const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return ''; } };
    const raw = [this.publicUrl ? hostOf(this.publicUrl) : '', ...this.acmeDomains, ...this.mcpAllowedOrigins.map(hostOf), ...this.browserOrigins.map(hostOf), ...this.ownAliases, ...extra];
    return [...new Set(raw.map((n) => n.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()).filter(Boolean))];
  }

  /** A file's web viewer hosts as they can be trusted now: the stored list (which a restored backup brings back unchecked against this server's names) less any entry that would allow one of this server's own names. */
  webViewerHostsOf(store: Store, extra: readonly string[] = []): { hosts: string[]; ignored: string[] } {
    const own = this.ownHostNames(extra);
    const hosts: string[] = [];
    const ignored: string[] = [...store.webViewerHostsDropped];
    for (const h of store.webViewerHosts) (own.some((n) => webViewerEntryCovers(h, n)) ? ignored : hosts).push(h);
    return { hosts, ignored };
  }

  /** Every web host any hosted file lets its web viewers load, for the web app's frame policy (each file's own list still decides what its viewers load). `extra` are names to leave out besides the server's own, such as the one the page was asked for by. */
  webViewerHostsAll(extra: readonly string[] = []): string[] {
    // Bounded by count and by size, so the policy header stays well under what proxies accept; a host past the bound is simply not framed.
    const out: string[] = [];
    let bytes = 0;
    for (const h of [...new Set([...this.stores.values()].flatMap((s) => this.webViewerHostsOf(s, extra).hosts))].sort()) {
      bytes += h.length + 10;
      if (out.length >= WEB_VIEWER_HOSTS_ALL_MAX || bytes > WEB_VIEWER_HOSTS_ALL_BYTES) break;
      out.push(h);
    }
    return out;
  }

  /** Whether scripts may reach the network in a hosted file: the server's flag allows every file, else the file's own switch. */
  scriptNetworkOn(file: string): boolean {
    return this.scriptNetwork || this.get(file)?.scriptNetwork === true;
  }

  private networkRefused = new Map<string, number>();

  /** What a script is told, and the server log says once in a while, when its file's network access is off: where to turn it on. */
  private networkOffNotice(file: string): string {
    const message = `Network access is off for "${file}". Turn it on in the admin console (Files, "Script network", Turn on), or start the server with --allow-script-network to allow it for every file.`;
    const last = this.networkRefused.get(file.toLowerCase());
    const now = Date.now();
    if (last === undefined || now - last > 10 * 60_000) {
      this.networkRefused.set(file.toLowerCase(), now);
      this.logs?.write('ScriptEvent', 'Warning', file, `A script was refused network access. ${message}`);
    }
    return message;
  }

  /**
   * Run options every script gets: network access (for `solution`'s scripts, when the run is in one), the Documents folder
   * Import Records reads from, the profiler, and AI. Without a solution only the server-wide flag can allow the network.
   */
  scriptOptions(solution?: string): { network: boolean; networkAllow?: readonly string[]; networkFiles: (file: string) => boolean; networkOff: (file: string) => string; outbound?: OutboundTest; connections?: ScriptConnections; mail?: (m: OutgoingMail) => Promise<void | string>; installPlugin?: (bytes: Uint8Array) => { id: string; version: string; signer: string }; documents: string; profile?: ScriptProfile; serverQueue: ScriptQueue; ai?: ScriptAi } {
    return {
      ...(this.config.scriptPluginInstall() ? { installPlugin: (bytes: Uint8Array) => this.installScriptPlugin(bytes) } : {}),
      network: solution !== undefined ? this.scriptNetworkOn(solution) : this.scriptNetwork,
      networkFiles: (file) => this.scriptNetworkOn(file), networkOff: (file) => this.networkOffNotice(file),
      ...(this.scriptNetworkAllow.length ? { networkAllow: this.scriptNetworkAllow } : {}), ...(this.outbound ? { outbound: this.outbound } : {}), ...(this.scriptConnections ? { connections: this.scriptConnections } : {}), ...(this.mail && !this.outbound ? { mail: this.mail } : {}), ...(this.scriptAi ? { ai: this.scriptAi } : {}),
      documents: join(this.dir, 'Documents'), ...(this.profiler ? { profile: this.profiler } : {}), serverQueue: this.serverScripts,
    };
  }

  /**
   * Install Plug-In File, once an administrator has turned it on: the package must be signed by a publisher already
   * trusted (plugins/trusted-publishers.json), is never unsigned, never replaces another publisher's plug-in, and is
   * not turned on for any file (that stays the administrator's, in enabled.json).
   */
  private installScriptPlugin(bytes: Uint8Array): { id: string; version: string; signer: string } {
    const info = readPackage(bytes);
    if (!info.signer) throw new Error('the package is not signed; scripts install only packages signed by a publisher the administrator trusts');
    if (!trustedPublishers(this.dir)[info.signer]) throw new Error(`the package is signed by ${info.signer}, whom the administrator hasn't trusted (tabularius plugins install --trust)`);
    const done = installPackage(this.dir, bytes, {});
    return { id: done.manifest.id, version: done.manifest.version, signer: info.signer };
  }

  /** Server-side scripts (Perform Script on Server, schedules) take turns here. */
  readonly serverScripts = new ScriptQueue();

  /**
   * With `background`, files not converted yet are left to watch(), which
   * converts them on a worker thread, so the server starts at once even when
   * a large file is waiting; otherwise they are converted here, before
   * anything is hosted.
   */
  /**
   * Encryption at rest: with a key set (TABULARIUS_ENCRYPTION_KEY), each store is
   * kept as <name>.openhbam.sqlite.enc on disk (AES-256-GCM) and only decrypted
   * into its working file while the server runs, so a stolen disk or backup
   * folder holds no readable data. The live file is plaintext while running, as
   * node:sqlite has no page-level encryption; this guards data at rest, not a
   * running server. The key never touches the folder.
   */
  private readonly encryptionKey?: string;

  /**
   * When the server runs as several processes (cluster.ts): record locks they
   * share, and the other processes, told when a file is closed, paused or
   * opened so they let go of it or pick it up.
   */
  private readonly sharedLocks?: (store: Store) => RecordLocks;
  peers?: { sync(name: string, action: 'close' | 'pause' | 'open' | 'offline', detail?: string): Promise<void> };

  /**
   * Works out layout results (whole-table summaries, ExecuteSQL) in the
   * background, shared with every process through each store's results file
   * (warmer.ts). The one process that converts files (not a cluster follower)
   * runs it; a store encrypted at rest keeps its results in memory only.
   */
  private readonly warmer?: Warmer;
  private readonly share: boolean;

  constructor(dir: string, log: (msg: string) => void = () => {}, opts: { background?: boolean; encryptionKey?: string; urlKey?: Buffer; locks?: (store: Store) => RecordLocks; follower?: boolean; shareResults?: boolean; warmSettleMs?: number; compactionWorker?: (path: string, convert?: boolean) => Promise<CompactionReport> } = {}) {
    this.dir = dir;
    this.log = log;
    this.compactionWorker = opts.compactionWorker ?? compactInWorker;
    this.mayCompact = !opts.follower;
    this.config = new ServerConfig(dir);
    // Plug-ins the server's own folder installs and enables (plugins/), before any file is hosted.
    loadPlugins(this.plugins, dir, log);
    this.urlKey = opts.urlKey ?? randomBytes(32);
    this.sharedLocks = opts.locks;
    this.share = !!opts.shareResults && !opts.encryptionKey && process.env.TABULARIUS_SHARE_RESULTS !== '0';
    if (this.share && !opts.follower) {
      const warmer = new Warmer(log, opts.warmSettleMs);
      this.warmer = warmer;
      this.beforeClose.push((store) => warmer.cancel(store));
    }
    // A follower process of a cluster hosts the stores already there; the leader converts new files and says so.
    if (opts.follower) {
      for (const f of readdirSync(dir)) if (f.endsWith(STORE_EXT)) this.addIfOpens(join(dir, f), log);
      return;
    }
    this.encryptionKey = opts.encryptionKey || undefined;
    sweepConversionTemps(dir, log);
    // Unlock encrypted stores first, so the conversion and hosting below see a
    // working file and don't re-import the .fmp12 over it.
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(STORE_EXT + ENCRYPTED_EXT)) continue;
      const working = join(dir, f.slice(0, -ENCRYPTED_EXT.length));
      if (!this.encryptionKey) {
        if (!existsSync(working)) log(`${f} is encrypted; set TABULARIUS_ENCRYPTION_KEY to host it`);
        continue;
      }
      if (!existsSync(working)) {
        log(`unlocking ${basename(working).slice(0, -STORE_EXT.length)}`);
        // Decrypt to a temp file and rename, so a wrong key or a damaged file
        // never leaves a half-written working store behind.
        const partial = working + '.partial';
        try {
          decryptFileSync(join(dir, f), partial, this.encryptionKey);
          renameSync(partial, working);
        } catch (e) {
          rmSync(partial, { force: true });
          throw e;
        }
      }
    }
    for (const f of readdirSync(dir)) {
      if (extname(f).toLowerCase() !== '.fmp12') continue;
      const store = join(dir, basename(f, extname(f)) + STORE_EXT);
      // An encrypted store already holds this file's data: never re-import the
      // .fmp12 over it (that would write an unencrypted copy), even with no key.
      if (existsSync(store + ENCRYPTED_EXT)) {
        // Unlocked above: brought up to date like any other store.
        if (existsSync(store) && needsDesigns(store) && !sourceEncryption(join(dir, f)).encrypted) {
          log(`reading layouts of ${f}`);
          upgradeDesigns(store, join(dir, f), log);
        }
        continue;
      }
      if (opts.background && !existsSync(store)) {
        // Already in place: the first scan converts it without waiting for its size to settle.
        this.arriving.set(f, statSync(join(dir, f)).size);
        continue;
      }
      // Encryption at Rest: converted once someone enters its passphrase in the admin console (never kept).
      const locked = !existsSync(store) && sourceEncryption(join(dir, f));
      if (locked && locked.encrypted) {
        this.locked.set(f, { size: statSync(join(dir, f)).size, hint: locked.hint });
        log(`${f} uses Encryption at Rest: enter its passphrase in the admin console to host it`);
        continue;
      }
      if (existsSync(store)) {
        // Stores converted by an older version get layout designs added; records are untouched.
        if (needsDesigns(store) && !sourceEncryption(join(dir, f)).encrypted) {
          log(`reading layouts of ${f}`);
          upgradeDesigns(store, join(dir, f), log);
        }
        let check: ReconvertCheck | undefined;
        try {
          check = reconvertCheck(store, join(dir, f));
        } catch {
          // opened below, where a damaged store is reported
        }
        if (check?.outdated) log(`${basename(f, extname(f))} was converted by an older version that got some values wrong (such as container files): convert it again from ${f} in the admin console, or with tabularius reconvert. ${check.unsafe ? `Edits made since can't all be carried over (${check.unsafe}); the store as it is is kept beside it.` : 'Edits made since are kept.'}`);
        continue;
      }
      log(`converting ${f}`);
      const temp = conversionTemp(store, join(dir, f));
      crashPoint('host-conversion:after-workspace');
      try {
        const stats = importFmp12(join(dir, f), temp, undefined, { resume: true });
        crashPoint('host-conversion:after-convert');
        if (publishConversion(temp, store)) {
          crashPoint('host-conversion:after-publish');
          log(`converted ${f}: ${stats.length} tables, ${stats.reduce((n, s) => n + s.records, 0)} records`);
        } else log(`${f} was converted by another host`);
      } finally {
        finishConversion(temp);
        crashPoint('host-conversion:after-cleanup');
      }
    }
    for (const f of readdirSync(dir)) {
      if (f.endsWith(STORE_EXT)) this.addIfOpens(join(dir, f), log);
    }
  }

  /** At startup, one store that won't open is left out and named; the rest are still hosted. */
  private addIfOpens(path: string, log: (line: string) => void): void {
    try {
      this.add(path);
    } catch (e) {
      const name = basename(path).slice(0, -STORE_EXT.length);
      log(`can't open ${basename(path)}, so it is not hosted: ${(e as Error).message}`);
      // Listed with the reason, where the admin console shows it, rather than left out as if it were not there.
      this.closed.set(name, { path, fileMode: 'compat', damaged: (e as Error).message });
    }
  }

  /** Files seen but not hosted yet, by name: size last seen, so a file still being copied waits. */
  private readonly arriving = new BoundedMap<string, number>(1024);
  /** Files dropped into the folder being converted now, and how far each has got. */
  readonly converted = new Map<string, ImportProgress>();
  /**
   * Files dropped into the folder that use Encryption at Rest, by file name:
   * shown as "Needs passphrase" until someone enters it (see unlock).
   */
  readonly locked = new BoundedMap<string, { size: number; hint?: string; error?: string; uploaded?: boolean }>(1024);
  /** Files whose conversion failed, by name and size; tried again only when the file changes. */
  private readonly failed = new BoundedMap<string, number>(1024);
  /** Why each failed file failed, for the admin status. */
  readonly failures = new BoundedMap<string, string>(1024);
  private converting = false;
  private readonly shutdown = new AbortController();
  private readonly conversionTasks = new Set<Promise<unknown>>();
  readonly compactionReports = new Map<string, { at: string; report: CompactionReport }>();
  readonly compactionLast = new Map<string, number>();
  private readonly compactionJobs = new Map<string, Promise<CompactionReport>>();
  private readonly compactionClosing = new Set<string>();
  private readonly compactionWorker: (path: string, convert?: boolean) => Promise<CompactionReport>;
  private readonly mayCompact: boolean;

  private assertOpen(): void {
    this.shutdown.signal.throwIfAborted();
  }

  private async conversionTask<T>(run: () => Promise<T>): Promise<T> {
    this.assertOpen();
    let done!: () => void;
    const task = new Promise<void>((resolve) => { done = resolve; });
    this.conversionTasks.add(task);
    try { return await run(); }
    finally { this.conversionTasks.delete(task); done(); }
  }

  private async conversionDelay(signal?: AbortSignal): Promise<void> {
    const scope = cancellationScope([signal, this.shutdown.signal]);
    try { await cancellationDelay(200, undefined, { signal: scope.signal }); }
    finally { scope.dispose(); }
  }

  /**
   * Hosts .fmp12 files dropped into the folder while the server runs, as
   * FileMaker Server opens new files in its Databases folder. A file is
   * converted once its size has stopped changing, on a worker thread.
   * Returns a function that stops watching.
   */
  watch(log: (msg: string) => void = () => {}, every = 3000): () => void {
    const timer = setInterval(() => { this.checkFormats(); void this.scan(log); }, every);
    timer.unref();
    return () => clearInterval(timer);
  }

  /** One pass of watch(): converts at most one new file. */
  async scan(log: (msg: string) => void = () => {}): Promise<string | undefined> {
    if (this.shutdown.signal.aborted) return undefined;
    return this.conversionTask(async () => {
      if (this.converting) return undefined;
      let files: string[];
      try {
        files = readdirSync(this.dir);
      } catch {
        return undefined;
      }
      const present = new Set(files);
      for (const map of [this.arriving, this.failed, this.failures]) {
        for (const name of map.keys()) if (!present.has(name)) map.delete(name);
      }
      // A waiting encrypted file that was removed, or replaced by a readable one, waits no longer.
      for (const f of [...this.locked.keys()]) {
        if (!files.includes(f) || !sourceEncryption(join(this.dir, f)).encrypted) this.locked.delete(f);
      }
      for (const f of files) {
        if (this.shutdown.signal.aborted) return undefined;
        if (extname(f).toLowerCase() !== '.fmp12' || f.startsWith('.')) continue;
        const name = basename(f, extname(f));
        const store = join(this.dir, name + STORE_EXT);
        if (this.get(name) || existsSync(store) || existsSync(store + ENCRYPTED_EXT)) continue;
        let size: number;
        try {
          size = statSync(join(this.dir, f)).size;
        } catch {
          continue;
        }
        if (this.failed.get(f) === size || this.locked.has(f)) continue;
        if (this.arriving.get(f) !== size) {
          // Keep admitted arrivals across scans: cycling through more than the cap must not starve every conversion.
          if (!this.arriving.has(f) && this.arriving.size >= this.arriving.limit) continue;
          this.arriving.set(f, size); // still copying, or just seen: look again next pass
          continue;
        }
        this.arriving.delete(f);
        const enc = sourceEncryption(join(this.dir, f));
        if (enc.encrypted) {
          this.locked.set(f, { size, hint: enc.hint });
          log(`${f} uses Encryption at Rest: enter its passphrase in the admin console to host it`);
          continue;
        }
        this.locked.delete(f);
        this.failures.delete(f);
        this.converting = true;
        let temp: string | undefined;
        try {
          log(`converting ${f}`);
          temp = conversionTemp(store, join(this.dir, f));
          crashPoint('host-conversion:after-workspace');
          const r = await this.convert(join(this.dir, f), temp, (p) => this.converted.set(name, p));
          this.assertOpen();
          crashPoint('host-conversion:after-convert');
          const published = publishConversion(temp, store);
          crashPoint('host-conversion:after-publish');
          this.add(store);
          await this.peers?.sync(name, 'open');
          if (published) log(`converted ${f}: ${r.tables} tables, ${r.records} records; now hosting ${name}`);
          else log(`${f} was converted by another host; now hosting ${name}`);
          return name;
        } catch (e) {
          this.failed.set(f, size);
          this.failures.set(f, (e as Error).message);
          log(`couldn't convert ${f}: ${(e as Error).message}`);
        } finally {
          this.converting = false;
          this.converted.delete(name);
          if (temp) finishConversion(temp);
          crashPoint('host-conversion:after-cleanup');
        }
      }
      return undefined;
    });
  }

  /**
   * Converts a .fmp12 on a worker thread. `limits` guards the conversion of an
   * untrusted upload: the worker's heap is capped (a file that expands to huge
   * memory out-of-memories the worker, not the server) and it is stopped after
   * a time budget (a file that makes the reader loop can't block conversions
   * for good). A file dropped into the folder by the operator is trusted and
   * runs without these.
   */
  private async convert(src: string, dest: string, onProgress?: (p: ImportProgress) => void, limits?: { timeoutMs: number; memoryMb: number }, passphrase?: string, signal?: AbortSignal): Promise<{ tables: number; records: number }> {
    signal?.throwIfAborted();
    let ms = Infinity;
    if (limits?.timeoutMs) {
      let size = 0;
      try { size = statSync(src).size; } catch { /* the worker reports a missing source */ }
      ms = Math.max(limits.timeoutMs, Math.ceil(size / (4 * 1024 * 1024)) * 1000);
    }
    this.assertOpen();
    const scope = cancellationScope([signal, this.shutdown.signal], ms);
    try {
      const worker = new Worker(new URL('./convert-worker.ts', import.meta.url), {
        workerData: { src, dest, resume: true, ...(passphrase === undefined ? {} : { passphrase }) },
        ...(limits?.memoryMb ? { resourceLimits: { maxOldGenerationSizeMb: limits.memoryMb } } : {}),
      });
      return await workerResult(worker, (value) => {
        scope.signal.throwIfAborted();
        const m = value as { progress?: ImportProgress; done?: { tables: number; records: number } };
        if (m.progress) onProgress?.(m.progress);
        return m.done;
      }, scope.signal);
    } catch (e) {
      if (scope.signal.aborted && e === scope.signal.reason && e !== signal?.reason && e instanceof DOMException && e.name === 'TimeoutError') {
        throw new Error(`conversion took longer than ${Math.round(ms / 1000)}s and was stopped`);
      }
      throw e;
    } finally { scope.dispose(); }
  }

  /**
   * An uploaded .fmp12 (at `src`) that uses Encryption at Rest: moved into the
   * folder as `<name>.fmp12`, to wait there for its passphrase like a file
   * dropped in (see unlock).
   */
  parkLocked(src: string, name: string, hint?: string, uploaded = false): void {
    this.assertOpen();
    const store = join(this.dir, name + STORE_EXT);
    const dest = join(this.dir, name + '.fmp12');
    if (this.get(name) || existsSync(store) || existsSync(store + ENCRYPTED_EXT) || existsSync(dest)) throw new Error(`A file named ${name} is already hosted`);
    renameSync(src, dest);
    this.locked.set(name + '.fmp12', { size: statSync(dest).size, hint, uploaded });
  }

  /**
   * Converts and hosts a file dropped into the folder that uses Encryption at
   * Rest, with its passphrase. The passphrase is used for this conversion
   * only: it is never stored, logged, or kept after. A wrong one throws and
   * the file stays waiting for it.
   */
  async unlock(file: string, passphrase: string, log: (msg: string) => void = () => {}, opts: { checked?: boolean } = {}): Promise<{ name: string; tables: number; records: number }> {
    return this.conversionTask(async () => {
      const info = this.locked.get(file);
      if (!info) throw new Error(`${file} isn't waiting for a passphrase`);
      if (!opts.checked) this.checkPassphrase(file, passphrase);
      info.error = undefined;
      const name = basename(file, extname(file));
      const store = join(this.dir, name + STORE_EXT);
      while (this.converting) await this.conversionDelay();
      this.assertOpen();
      if (this.get(name) || existsSync(store)) throw new Error(`A file named ${name} is already hosted`);
      const temp = conversionTemp(store, join(this.dir, file));
      crashPoint('host-conversion:after-workspace');
      this.converting = true;
      try {
        log(`converting ${file} with the passphrase entered`);
        // An uploaded file is converted within the limits any upload is (it may have been made to be hostile).
        const r = await this.convert(join(this.dir, file), temp, (p) => this.converted.set(name, p), info.uploaded ? UPLOAD_CONVERT_LIMITS : undefined, passphrase);
        this.assertOpen();
        crashPoint('host-conversion:after-convert');
        if (!publishConversion(temp, store)) throw new Error(`A file named ${name} is already hosted`);
        crashPoint('host-conversion:after-publish');
        this.locked.delete(file);
        this.add(store);
        await this.peers?.sync(name, 'open');
        log(`converted ${file}: ${r.tables} tables, ${r.records} records; now hosting ${name}`);
        return { name, ...r };
      } catch (e) {
        const err = wrongPassphrase(e);
        const still = this.locked.get(file);
        if (still) still.error = err.message;
        log(`couldn't convert ${file}: ${err.message}`);
        throw err;
      } finally {
        this.converting = false;
        this.converted.delete(name);
        finishConversion(temp);
        crashPoint('host-conversion:after-cleanup');
      }
    });
  }

  /** Throws "wrong passphrase" unless `passphrase` opens a waiting encrypted file: quick, before converting it. */
  checkPassphrase(file: string, passphrase: string): void {
    if (!this.locked.has(file)) throw new Error(`${file} isn't waiting for a passphrase`);
    if (!passphrase) throw new Error('enter the passphrase');
    openCheck(join(this.dir, file), passphrase);
  }

  /**
   * Before converting a hosted file again from its .fmp12: throws
   * PassphraseNeeded when the .fmp12 is encrypted and no passphrase was given,
   * and "wrong passphrase" for a wrong one, so nobody is disconnected for it.
   */
  checkReconvertPassphrase(name: string, passphrase: string | undefined): void {
    const store = this.storeOf(name);
    if (!store) return;
    const fmp12 = join(this.dir, store.name + '.fmp12');
    if (!existsSync(fmp12)) return;
    needsPassphrase(fmp12, passphrase);
    if (passphrase && sourceEncryption(fmp12).encrypted) openCheck(fmp12, passphrase);
  }

  /**
   * Converts an uploaded .fmp12 (at `src`, anywhere) and hosts it as `name`,
   * keeping the file next to its store as `<name>.fmp12`, as if it had been
   * dropped into the folder. One conversion runs at a time.
   */
  async hostUpload(src: string, name: string, onProgress?: (p: ImportProgress) => void, signal?: AbortSignal): Promise<{ tables: number; records: number }> {
    return this.conversionTask(async () => {
      const store = join(this.dir, name + STORE_EXT);
      signal?.throwIfAborted();
      while (this.converting) await this.conversionDelay(signal);
      this.assertOpen();
      signal?.throwIfAborted();
      if (this.get(name) || existsSync(store) || existsSync(store + ENCRYPTED_EXT) || existsSync(join(this.dir, name + '.fmp12'))) throw new Error(`A file named ${name} is already hosted`);
      const temp = conversionTemp(store, src);
      this.converting = true;
      try {
        const r = await this.convert(src, temp, onProgress, UPLOAD_CONVERT_LIMITS, undefined, signal);
        signal?.throwIfAborted();
        this.assertOpen();
        crashPoint('host-upload:after-convert');
        stageConversionSource(temp, src);
        crashPoint('host-upload:after-source-stage');
        // The store first: once it exists, the folder watcher leaves the .fmp12 alone.
        if (!publishConversion(temp, store)) throw new Error(`A file named ${name} is already hosted`);
        crashPoint('host-upload:after-store-publish');
        completeConversionSource(temp, store);
        rmSync(src);
        crashPoint('host-upload:after-source-rename');
        this.add(store);
        return r;
      } finally {
        this.converting = false;
        finishConversion(temp);
        crashPoint('host-upload:after-cleanup');
      }
    });
  }

  /** Whether a hosted file was converted by an older version and can be converted again from its .fmp12. */
  reconvertStatus(name: string, opts: { sameFile?: boolean } = {}): ReconvertCheck | undefined {
    const store = this.storeOf(name);
    const fmp12 = store && join(this.dir, store.name + '.fmp12');
    if (!store || !fmp12 || !existsSync(fmp12)) return undefined;
    try {
      return reconvertCheck(store.path, fmp12, opts);
    } catch {
      return undefined;
    }
  }

  /**
   * Converts a hosted file again from its .fmp12, keeping what changed since
   * (see reconvert): it is closed meanwhile, then opened again. The store as
   * it was is kept beside it.
   */
  async reconvertFile(name: string, opts: { force?: boolean; sameFile?: boolean; passphrase?: string } = {}): Promise<ReconvertResult> {
    return this.conversionTask(async () => {
      const store = this.storeOf(name);
      if (!store) throw new Error(`${name} isn't hosted`);
      if (store.fileMode === 'native') throw new Error(NATIVE_REFUSAL);
      if (this.encryptionKey) throw new Error('converting again is not available with encryption at rest yet: stop the server, decrypt the folder, then use tabularius reconvert');
      const shown = store.name;
      const path = store.path;
      const fmp12 = join(this.dir, shown + '.fmp12');
      const check = reconvertCheck(path, fmp12, { sameFile: opts.sameFile });
      if (check.unsafe && !opts.force) throw new Error(`can't carry edits over: ${check.unsafe}`);
      this.checkReconvertPassphrase(shown, opts.passphrase);
      while (this.converting) await this.conversionDelay();
      this.assertOpen();
      this.converting = true;
      try {
        await this.closeFileEverywhere(shown);
        this.assertOpen();
        return await reconvert(path, fmp12, { force: opts.force, sameFile: opts.sameFile, convert: (src, dest) => this.convert(src, dest, (p) => this.converted.set(shown, p), undefined, opts.passphrase) });
      } catch (e) {
        throw wrongPassphrase(e);
      } finally {
        this.converted.delete(shown);
        this.converting = false;
        if (!this.shutdown.signal.aborted) await this.openFileEverywhere(shown);
      }
    });
  }

  /**
   * What converting a hosted file again would change, worked out in a scratch
   * folder while the file stays open (see reconvert). Unsafe files are
   * previewed as a forced convert, as that is what converting them does.
   */
  async previewReconvert(name: string, opts: { sameFile?: boolean; passphrase?: string } = {}): Promise<{ check: ReconvertCheck; preview: ReconvertPreview }> {
    return this.conversionTask(async () => {
      const store = this.storeOf(name);
      if (!store) throw new Error(`${name} isn't hosted`);
      if (store.fileMode === 'native') throw new Error(NATIVE_REFUSAL);
      if (this.encryptionKey) throw new Error('converting again is not available with encryption at rest yet');
      const fmp12 = join(this.dir, store.name + '.fmp12');
      const check = reconvertCheck(store.path, fmp12, opts);
      this.checkReconvertPassphrase(store.name, opts.passphrase);
      while (this.converting) await this.conversionDelay();
      this.assertOpen();
      this.converting = true;
      try {
        const r = await reconvert(store.path, fmp12, { force: !!check.unsafe, dryRun: true, sameFile: opts.sameFile, convert: (src, dest) => this.convert(src, dest, undefined, undefined, opts.passphrase) });
        return { check, preview: r.preview! };
      } catch (e) {
        throw wrongPassphrase(e);
      } finally {
        this.converting = false;
      }
    });
  }

  /** Files closed by an administrator: still in the folder, not served until opened again. */
  private readonly closed = new Map<string, { path: string; fileMode: Store['fileMode']; damaged?: string }>();
  /** Paused files: open, but no requests reach them, so the files on disk can be copied as they are. */
  private readonly paused = new Map<string, Store>();
  private readonly fileGenerations = new WeakMap<Store, number>();

  /** Invalidates work that waited across a pause, even if the same connection has resumed. */
  fileGeneration(store: Store): number { return this.fileGenerations.get(store) ?? 0; }

  /** Every file in the folder that can be hosted, with whether it's open, paused or closed. */
  files(): { name: string; status: 'open' | 'paused' | 'closed'; path: string; fileMode: Store['fileMode']; damaged?: string }[] {
    return [
      ...[...this.stores.values()].map((s) => ({ name: s.name, status: 'open' as const, path: s.path, fileMode: s.fileMode })),
      ...[...this.paused.values()].map((s) => ({ name: s.name, status: 'paused' as const, path: s.path, fileMode: s.fileMode })),
      ...[...this.closed.entries()].map(([name, { path, fileMode, damaged }]) => ({ name, status: 'closed' as const, path, fileMode, ...(damaged ? { damaged } : {}) })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** An open or paused file's store (get() leaves out paused ones). */
  storeOf(name: string): Store | undefined {
    return this.stores.get(name.toLowerCase()) ?? this.paused.get(name.toLowerCase());
  }

  /** Whether stores are kept encrypted at rest. */
  get encrypted(): boolean {
    return !!this.encryptionKey;
  }

  /** Called before a file is closed or paused, while it's still hosted (point-in-time backups save its last changes). */
  readonly beforeClose: ((store: Store) => void)[] = [];

  /** Ends clients before closing the connection, including a file that was already paused. */
  readonly beforeFileClose: ((store: Store) => void)[] = [];

  /**
   * One worker per hosted file. A second caller shares its result. `convert: false` (the timer) leaves a file that is not
   * yet in incremental vacuum mode alone instead of rewriting it, which locks writers out for the whole rewrite.
   */
  compact(name: string, opts: { convert?: boolean } = {}): Promise<CompactionReport> {
    const key = name.toLowerCase();
    if (this.shutdown.signal.aborted) return Promise.reject(new Error('host is closing'));
    const existing = this.compactionJobs.get(key);
    if (existing) return existing;
    const store = this.stores.get(key);
    if (!this.mayCompact) return Promise.reject(new Error('compaction is unavailable on a follower process'));
    if (this.compactionClosing.has(key)) return Promise.reject(new Error(`${name} is closing`));
    if (!store) return Promise.reject(new Error(`${name} is not hosted or is paused`));
    try { accessSync(store.path, constants.W_OK); accessSync(this.dir, constants.W_OK); }
    catch { return Promise.reject(new Error(`${name} is on a read-only file or mount; compaction requires write access`)); }
    this.compactionLast.set(key, Date.now());
    const job = this.compactionWorker(store.path, opts.convert ?? true).then((report) => {
      if (this.stores.get(key) === store) this.compactionReports.set(key, { at: new Date().toISOString(), report });
      return report;
    }).finally(() => { this.compactionJobs.delete(key); });
    this.compactionJobs.set(key, job);
    return job;
  }

  compactionTick(now = Date.now()): void {
    if (this.shutdown.signal.aborted || !this.mayCompact) return;
    for (const store of this.stores.values()) {
      const key = store.name.toLowerCase();
      if (this.compactionClosing.has(key) || this.compactionJobs.has(key)) continue;
      if (compactionDue(now, this.compactionLast.get(key), undefined, fileBytes(store.path + '-wal'))) {
        void this.compact(store.name, { convert: false }).catch((e) => this.log(`${store.name}: compaction failed: ${(e as Error).message}`));
        this.compactionLast.set(key, now);
      }
    }
  }

  async waitForCompaction(name: string): Promise<void> {
    const key = name.toLowerCase();
    if (!this.storeOf(name) && !this.compactionJobs.has(key)) return;
    this.compactionClosing.add(key);
    await this.compactionJobs.get(key)?.then(() => {}, () => {});
  }
  /** Actual file/session teardown, including paused files and shutdown; pausing alone preserves session state. */
  readonly onClose: ((store: Store) => void)[] = [];

  /** Stops serving a file, like closing it in FileMaker Server's console. Its sessions end with it. */
  closeFile(name: string): boolean {
    const key = name.toLowerCase();
    if (this.compactionJobs.has(key)) throw new Error(`${name} is being compacted; wait for compaction before closing`);
    const store = this.stores.get(key) ?? this.paused.get(key);
    if (!store) return false;
    if (this.stores.has(key)) for (const f of this.beforeClose) f(store);
    store.checkpoint();
    crashPoint('host-close:after-checkpoint');
    for (const f of this.beforeFileClose) f(store);
    for (const f of this.onClose) f(store);
    store.close();
    this.stores.delete(key);
    this.paused.delete(key);
    this.compactionReports.delete(key);
    this.compactionLast.delete(key);
    this.compactionClosing.delete(key);
    const path = store.path;
    this.closed.set(store.name, { path, fileMode: store.fileMode });
    for (const s of this.stores.values()) s.resetCaches();
    crashPoint('host-close:after-close');
    if (this.encryptionKey) this.lock(path);
    return true;
  }

  /**
   * Stops serving a file found damaged (a query hit a bad page, or the startup check did). Unlike closeFile nothing is
   * written to it: no checkpoint, no last-changes backup, no encrypting it over its good copy. Its sessions end with it.
   * The file stays where it is, listed as closed with the reason, for a backup to be restored over.
   */
  takeOffline(store: Store, damage: FileDamaged, announce = true, log = `${store.name} is damaged (${damage.detail}) and is no longer served. Restore it from a backup (tabularius doctor names the damage); the other files are unaffected.`): void {
    const key = store.name.toLowerCase();
    if (this.stores.get(key) !== store && this.paused.get(key) !== store) return;
    this.stores.delete(key);
    this.paused.delete(key);
    this.compactionReports.delete(key);
    this.compactionLast.delete(key);
    this.compactionClosing.delete(key);
    this.closed.set(store.name, { path: store.path, fileMode: store.fileMode, damaged: damage.detail });
    try { store.close(); } catch { /* a damaged file may not close cleanly */ }
    for (const s of this.stores.values()) s.resetCaches();
    // The cluster's other processes have the same file open: they stop serving it too.
    if (announce) void this.peers?.sync(store.name, 'offline', damage.detail).catch(() => {});
    this.log(log);
  }

  /**
   * The format check runs when a file is opened, so a process that already has it open keeps writing after a newer version
   * (a second server on the folder during a rolling upgrade) has recorded its number. This finds that: a file now in a
   * format above this build's is taken offline and left as it is, as a damaged one is. Run by watch().
   */
  checkFormats(): void {
    for (const store of this.openStores()) {
      let found: number | 'unreadable';
      try { found = store.recordedFormat(); } catch { continue; /* damage says so itself */ }
      if (found !== 'unreadable' && found <= STORE_FORMAT) continue;
      const detail = `${store.name} was written by a newer Tabularius (${found === 'unreadable' ? 'a file format number this version cannot read' : `file format ${found}`}; this version reads up to format ${STORE_FORMAT})`;
      this.takeOffline(store, new FileDamaged(store.name, detail), true,
        `${detail} while it was open, so it is no longer served here and nothing more is written to it. Run the newer version, or put back a backup made before it opened the file (tabularius restore); the other files are unaffected.`);
    }
  }

  /** A cluster peer found the file damaged: stop serving it here as well. */
  takeOfflineByName(name: string, detail: string): void {
    const store = this.storeOf(name);
    if (store) this.takeOffline(store, new FileDamaged(store.name, detail), false);
  }

  private readonly log: (msg: string) => void;
  private readonly integrityWorkers = new Set<Worker>();
  private integrityStopped = false;

  /**
   * Checks the pages of every hosted file, one at a time and off the request path, and takes a damaged one offline. A
   * file is also taken offline the first time a query hits a bad page, so this finds damage before anyone asks.
   * Resolves once every file has been checked.
   */
  async scanIntegrity(): Promise<void> {
    for (const store of this.openStores()) {
      if (this.integrityStopped) return;
      let result: PageCheck;
      try { result = await this.checkPages(store.path); } catch (e) {
        this.log(`could not check ${store.name} for damage: ${(e as Error).message}`);
        continue;
      }
      if (result.state === 'damaged') this.takeOffline(store, new FileDamaged(store.name, result.detail));
      else if (result.state === 'unreadable') this.log(`could not check ${store.name} for damage: ${result.detail}`);
    }
  }

  /** Reads every page of a hosted file in a worker (SQLite's full integrity check unless `quick`), as a verify schedule does. */
  verifyHosted(name: string, quick = false): Promise<PageCheck> {
    const store = this.get(name);
    if (!store) return Promise.reject(new Error(`"${name}" is not hosted`));
    return this.checkPages(store.path, quick);
  }

  private checkPages(path: string, quick = true): Promise<PageCheck> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./integrity-worker.ts', import.meta.url), { workerData: { path, quick } });
      this.integrityWorkers.add(w);
      let answered = false;
      w.once('message', (m: PageCheck) => { answered = true; resolve(m); });
      w.once('error', reject);
      w.once('exit', () => {
        this.integrityWorkers.delete(w);
        if (!answered) reject(new Error('the check stopped before it finished'));
      });
    });
  }

  /** Serves a closed or paused file again. */
  openFile(name: string): boolean {
    this.assertOpen();
    const key = name.toLowerCase();
    const paused = this.paused.get(key);
    if (paused) {
      this.paused.delete(key);
      this.stores.set(key, paused);
      this.compactionClosing.delete(key);
      return true;
    }
    const entry = [...this.closed.entries()].find(([n]) => n.toLowerCase() === key);
    if (!entry) return false;
    const [shown, { path, damaged }] = entry;
    if (damaged !== undefined) {
      // Restored or repaired since? Only a file that passes its check is served again.
      const now = pageCheck(path, true);
      if (now.state === 'damaged') throw new Error(`${shown} is still damaged (${now.detail}); restore it from a backup`);
      if (now.state === 'unreadable') throw new Error(`${shown} could not be checked (${now.detail}); try again`);
      this.closed.set(shown, { path, fileMode: entry[1].fileMode });
    }
    // Locked, and this process has no key (a cluster's other workers): opening would make an empty store beside it.
    if (!this.encryptionKey && !existsSync(path) && existsSync(path + ENCRYPTED_EXT)) return false;
    if (this.encryptionKey && !existsSync(path)) {
      const partial = path + '.partial';
      try {
        decryptFileSync(path + ENCRYPTED_EXT, partial, this.encryptionKey);
        renameSync(partial, path);
      } catch (e) {
        rmSync(partial, { force: true });
        throw e;
      }
    }
    // A removed or renamed file must not become a new, empty SQLite database.
    if (!existsSync(path)) return false;
    crashPoint('host-open:before-add');
    const entryNow = this.closed.get(shown);
    this.closed.delete(shown);
    try {
      this.add(path);
    } catch (e) {
      // An onAdd callback can fail after publishing the connection.
      const failed = this.stores.get(key);
      this.stores.delete(key);
      failed?.close();
      // Still not openable (a newer file format, for one): it stays listed, with the reason.
      this.closed.set(shown, { ...(entryNow ?? { path, fileMode: 'compat' as const }), damaged: (e as Error).message });
      throw e;
    }
    for (const s of this.stores.values()) s.resetCaches();
    crashPoint('host-open:after-add');
    return true;
  }

  /** Holds a file open but out of reach, with everything written to its file, so it can be copied safely. */
  pauseFile(name: string): boolean {
    const key = name.toLowerCase();
    if (this.compactionJobs.has(key)) throw new Error(`${name} is being compacted; wait for compaction before pausing`);
    const store = this.stores.get(key);
    if (!store) return this.paused.has(key);
    for (const f of this.beforeClose) f(store);
    store.checkpoint();
    this.stores.delete(key);
    this.paused.set(key, store);
    this.compactionReports.delete(key);
    this.compactionLast.delete(key);
    this.compactionClosing.delete(key);
    this.fileGenerations.set(store, this.fileGeneration(store) + 1);
    return true;
  }

  /** closeFile, after the server's other processes have closed it too. */
  async closeFileEverywhere(name: string): Promise<boolean> {
    if (!this.storeOf(name)) return false;
    await this.waitForCompaction(name);
    try {
      await this.peers?.sync(name, 'close');
      return this.closeFile(name);
    } catch (e) {
      if (this.storeOf(name)) this.compactionClosing.delete(name.toLowerCase());
      throw e;
    }
  }

  /** pauseFile, in the server's other processes too. */
  async pauseFileEverywhere(name: string): Promise<boolean> {
    await this.waitForCompaction(name);
    try {
      if (this.storeOf(name)) await this.peers?.sync(name, 'pause');
      return this.pauseFile(name);
    } catch (e) {
      if (this.get(name)) this.compactionClosing.delete(name.toLowerCase());
      throw e;
    }
  }

  /** openFile (or a file newly hosted here), then in the server's other processes too. */
  async openFileEverywhere(name: string): Promise<boolean> {
    this.assertOpen();
    const opened = this.get(name) ? true : this.openFile(name);
    if (opened) this.compactionClosing.delete(name.toLowerCase());
    if (opened) await this.peers?.sync(name, 'open');
    return opened;
  }

  /** Called with each store as it starts being hosted (at startup, when converted, opened again or created). */
  readonly onAdd: ((store: Store) => void)[] = [];
  /** Automations (automations.ts): idle resolves once the runs a file's changes set off have finished. */
  automations?: { idle(store: Store): Promise<void> };
  /** Each hosted file's conversion guide (conversion-guide.ts): what won't work here and what to use instead. */
  guides?: { get(store: Store): Promise<ConversionGuide>; make(store: Store): Promise<ConversionGuide> };

  /** Every store open now, paused ones included. */
  openStores(): Store[] {
    return [...this.stores.values(), ...this.paused.values()];
  }

  add(path: string): Store {
    this.assertOpen();
    const store = new Store(path, basename(path).slice(0, -STORE_EXT.length));
    // A copy made before migrating the file is as sensitive as the file: with encryption at rest it is kept encrypted too.
    for (const backup of store.migrationBackups) this.lock(backup);
    this.stores.set(store.name.toLowerCase(), store);
    this.compactionClosing.delete(store.name.toLowerCase());
    // Multi-file solutions: layouts can use tables in other files hosted here.
    store.resolveFile = (name) => this.get(name);
    try {
      for (const g of store.accountsSharingLockout()) this.log(`${store.name}: the accounts ${g.map((n) => `"${n}"`).join(' and ')} share one sign-in lockout (their names read as one name to a directory), so guesses against one lock the other. Rename or delete one; tabularius doctor lists them.`);
    } catch { /* a damaged file says so itself */ }
    store.onDamage = (damage) => this.takeOffline(store, damage);
    // One line a minute per file: a full disk makes every write fail, and the log must not fill the disk further.
    let lastDiskLog = 0;
    store.onDiskTrouble = (trouble) => {
      const now = Date.now();
      if (now - lastDiskLog < 60_000) return;
      lastDiskLog = now;
      this.log(`${store.name}: ${trouble.message}`);
    };
    store.plugin = this.plugins.lookup(store.name);
    store.pluginsKey = () => this.plugins.cacheSignature(store.name);
    store.installedPlugins = () => this.plugins.installedFor(store.name);
    store.pluginsUseNetwork = () => this.plugins.usesNetwork(store.name);
    store.pluginsUseMail = () => this.plugins.usesMail(store.name);
    store.builtinOff = (name) => this.plugins.builtinOff(store.name, name);
    if (this.sharedLocks) store.locks = this.sharedLocks(store);
    if (this.share) store.shareResults();
    const warmer = this.warmer;
    if (warmer) {
      // Once at opening, and again when changes settle (from any process: a cluster tells every process of every change).
      store.warmSoon = () => warmer.request(store);
      store.listeners.add(() => warmer.request(store));
      warmer.request(store, 0);
    }
    // A design change can affect any file whose layouts or relationships use this one.
    store.onDesignChange = () => {
      for (const s of this.stores.values()) if (s !== store) s.resetCaches();
    };
    this.applyContainerUrls(store);
    for (const f of this.onAdd) f(store);
    return store;
  }

  /** A new, empty database in the hosted folder, built from scratch with design mode. */
  create(name: string): Store {
    this.assertOpen();
    const clean = name.trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,99}$/u.test(clean)) throw new Error('Database names use letters, digits, spaces, - and _');
    if (this.get(clean)) throw new Error(`A database named "${clean}" is already hosted`);
    const path = join(this.dir, clean + STORE_EXT);
    if (existsSync(path)) throw new Error(`${path} already exists`);
    createStore(path);
    return this.add(path);
  }

  /** Base URL the server is reachable at; container fields become download URLs under it. */
  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
    for (const s of this.stores.values()) this.applyContainerUrls(s);
  }

  private applyContainerUrls(store: Store): void {
    if (!this.baseUrl) return;
    const base = this.baseUrl;
    store.containerUrl = (id, filename, principal) =>
      `${base}/tabularius/containers/${encodeURIComponent(store.name)}/${id}/${encodeURIComponent(filename ?? 'file')}?${this.signed(store.name, id, '', principal ? store.linkPrincipal(principal) : undefined)}`;
  }

  /** Signature for a container (kind "") or image library (kind "image") URL, bound to an expiry and, when given, an account row. */
  sign(db: string, id: number, kind = '', exp = 0, who?: LinkAccount): string {
    return createHmac('sha256', this.urlKey).update(`${kind}${kind ? ':' : ''}${db.toLowerCase()}/${id}@${exp}${who ? `#${who.name}#${who.identity}` : ''}`).digest('base64url');
  }

  /** The `sig`/`exp`/`as` query string for a fresh, expiring container or image URL. */
  signed(db: string, id: number, kind = '', who?: LinkAccount): string {
    const exp = this.urlTtlMs ? Math.floor((expiryClock.now() + this.urlTtlMs) / 1000) : 0;
    return `sig=${this.sign(db, id, kind, exp, who)}${exp ? `&exp=${exp}` : ''}${who ? `&as=${encodeURIComponent(who.name)}` : ''}`;
  }

  checkSignature(db: string, id: number, sig: string, kind = '', exp = 0, who?: LinkAccount): boolean {
    // An expiry in the past fails before any signature comparison.
    if (exp && exp * 1000 <= expiryClock.now()) return false;
    const want = Buffer.from(this.sign(db, id, kind, exp, who));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /**
   * Verify the `sig`/`exp`/`as` params of a signed container or image URL. A link made for an account is signed with that
   * account row's name and identity, and counts only while the row is there, is the same one and is not blocked: blocking
   * or removing the account ends the links made for it (also when a new account takes its name), and no one else's.
   */
  checkUrl(db: string, id: number, params: URLSearchParams, kind = ''): boolean {
    const name = params.get('as') ?? '';
    let who: LinkAccount | undefined;
    let blocked = false;
    if (name) {
      const row = this.get(db)?.linkIdentity(name);
      if (!row) return false;
      who = { name, identity: row.identity };
      blocked = row.inactive;
    }
    return this.checkSignature(db, id, params.get('sig') ?? '', kind, Number(params.get('exp') ?? 0), who) && !blocked;
  }

  names(): string[] {
    return [...this.stores.values()].map((s) => s.name);
  }

  get(name: string): Store | undefined {
    return this.stores.get(name.toLowerCase());
  }

  /** Resolves once the background warmer has nothing left to do (for tests). */
  warmed(): Promise<void> {
    return this.warmer?.idle() ?? Promise.resolve();
  }

  /**
   * Closes every file. Background warming stops first: when its thread is at
   * work, the files close once it has stopped (the promise says when), so
   * nothing is written into the folder after close, nor while a file is
   * encrypted again. `unlocked`: closed without encrypting them again (other
   * processes of a cluster still have them open).
   */
  close(opts: { unlocked?: boolean } = {}): Promise<void> {
    if (this.closing) return this.closing;
    this.shutdown.abort(new Error('Host is closing'));
    this.integrityStopped = true;
    // A check holds a read of its file until it ends: the files close after the checks have stopped, or a file could not
    // be folded into one piece (with encryption at rest, the piece that is encrypted).
    const checks = [...this.integrityWorkers].map((w) => w.terminate());
    const warming = this.warmer?.busy || this.warmStop !== undefined || checks.length > 0 || this.conversionTasks.size > 0;
    const stopped = Promise.all([this.stopWarming(), ...checks, Promise.allSettled([...this.conversionTasks]), Promise.allSettled([...this.compactionJobs.values()])]).then(() => {});
    const lock = !opts.unlocked;
    if (!warming && this.compactionJobs.size === 0) {
      this.closeStores(lock);
      return (this.closing = Promise.resolve());
    }
    return (this.closing = stopped.then(() => this.closeStores(lock)));
  }

  /** Stops background warming (at once, as a server starts shutting down); resolves once its thread has stopped. */
  stopWarming(): Promise<void> {
    return (this.warmStop ??= this.warmer?.close() ?? Promise.resolve());
  }

  private closing?: Promise<void>;
  private warmStop?: Promise<void>;

  private closeStores(lock: boolean): void {
    const stores = [...this.stores.values(), ...this.paused.values()];
    // Session cleanup may inspect every store; finish it while all connections are still open.
    // A cleanup that fails (a shared lock table already closed under it) must not keep the files from being closed.
    for (const s of stores) for (const f of this.onClose) {
      try { f(s); } catch (e) { this.log(`closing ${s.name}: session cleanup failed: ${(e as Error).message}`); }
    }
    for (const s of stores) {
      const path = s.path;
      let whole = true;
      if (this.encryptionKey) {
        // Fold the WAL in, so the file alone is complete. When that cannot be done the file is closed as it is and not
        // encrypted over: its log still holds the last changes.
        try { s.checkpoint(); } catch (e) { whole = false; this.log(`${s.name} was closed without being encrypted: ${(e as Error).message}`); }
      }
      s.close();
      if (this.encryptionKey && lock && whole) this.lock(path);
    }
    this.compactionReports.clear();
    this.compactionLast.clear();
    // A file that was unlocked but not opened (written by a newer version, or damaged) has no store to lock it above, and
    // would stay on disk as plaintext. A log with changes in it is left alone: removing it would lose them.
    if (this.encryptionKey && lock) {
      for (const [name, { path }] of this.closed) {
        try {
          if (!existsSync(path) || !existsSync(path + ENCRYPTED_EXT)) continue;
          if (existsSync(path + '-wal') && statSync(path + '-wal').size > 0) { this.log(`${name} was left unencrypted because its log still holds changes`); continue; }
          this.lock(path);
        } catch (e) { this.log(`${name} was left unencrypted: ${(e as Error).message}`); }
      }
    }
    this.stores.clear();
    this.paused.clear();
    this.closed.clear();
  }

  /** Encrypts a store's working file back to <path>.enc and removes the plaintext (and its WAL sidecars). */
  private lock(working: string): void {
    if (!this.encryptionKey) return;
    // Shared results (left from before the folder was encrypted) hold values worked out from the data: they go too.
    for (const side of ['-wal', '-shm', '.results', '.results-wal', '.results-shm']) rmSync(working + side, { force: true });
    const enc = working + ENCRYPTED_EXT;
    encryptFileSync(working, enc + '.partial', this.encryptionKey);
    renameSync(enc + '.partial', enc);
    rmSync(working, { force: true });
  }
}

/** Whether a .fmp12 uses Encryption at Rest, and its password hint (not encrypted when it can't be read). */
export function sourceEncryption(path: string): { encrypted: boolean; hint?: string } {
  let src: ReturnType<typeof fileSource> | undefined;
  try {
    src = fileSource(path);
    return encryptionInfo(src);
  } catch {
    return { encrypted: false };
  } finally {
    src?.close?.();
  }
}

/** Thrown before converting an encrypted .fmp12 again without its passphrase (the admin console then asks for it). */
export class PassphraseNeeded extends Error {
  readonly hint?: string;
  constructor(hint?: string) {
    super('this file uses Encryption at Rest: enter its passphrase');
    this.hint = hint;
  }
}

function needsPassphrase(fmp12: string, passphrase: string | undefined): void {
  if (passphrase) return;
  const enc = sourceEncryption(fmp12);
  if (enc.encrypted) throw new PassphraseNeeded(enc.hint);
}

/** A wrong passphrase said plainly; any other error as it was (the passphrase itself never appears in one). */
function wrongPassphrase(e: unknown): Error {
  if (e instanceof Error && /wrong passphrase/i.test(e.message)) return new Error('wrong passphrase');
  return e instanceof Error ? e : new Error(String(e));
}

/** Throws "wrong passphrase" unless `passphrase` opens the encrypted .fmp12 at `path` (quick: its first blocks only). */
function openCheck(path: string, passphrase: string): void {
  const src = fileSource(path);
  try {
    new FmpFile(src, passphrase);
  } catch (e) {
    throw wrongPassphrase(e);
  } finally {
    src.close?.();
  }
}
