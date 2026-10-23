#!/usr/bin/env node
import { checkSqlExportPath } from '../../store/src/portable-path.ts';
import { listenForStop } from './stop-request.ts';
import { auditJsonLine } from '../../store/src/audit-output.ts';
// tabularius: inspect and convert FileMaker .fmp12 files.

import '../../store/src/legacy-env.ts';
import { isLoopbackHost, plainHttpRefusal } from './loopback.ts';
import { availableParallelism, homedir, tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer as createNetServer } from 'node:net';
import { accessSync, closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, renameSync, rmSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { readSecret } from './prompt.ts';
import { askServer } from './ask-server.ts';
import { defaultBundleName, diagnostics, writeBundle } from './diagnostics.ts';
import { doctorText, runDoctor } from './doctor.ts';
import { runExposure } from './exposure.ts';
import { startDemo } from './demo.ts';
import { checkPort, defaults, installed, installService, serviceFile, uninstallService, servicePlainRefusal, defaultServiceHost, upgrade, validateServicePublicUrl, type Platform, type ServiceOptions } from './service.ts';
import { claimFolder } from '../../server/src/backup.ts';
import { FmpDatabase, fileSource, encryptionInfo, readLayoutDesigns, segmentOf, inspectText, type Schema } from '../../fmp12/src/index.ts';
import { BUILT_IN_EXTENDED_PRIVILEGES, addCensus, styleCensus, styleCensusText, calcFidelity, censusText, exportSql, exportSqlSummary, planImportTables, importTables, importTablesSummary, notionMarkdownSheet, MAX_IMPORT_ROWS, type SheetInput, type ColumnOverrides, type ColumnKind, findStaleCalcs, layoutCensus, type LayoutCensus, createStore, designReport, importFmp12, PASSWORD_POLICY, DEFAULT_MIN_PASSWORD_LENGTH, reconvert, reconvertCheck, verifySecurityAudit, verifyRecordAudit, anchorHead, checkAnchor, Store, syncPlan, openForPlanning, applySync, readSyncLog, releaseHeldTables, type ConflictPolicy, writeBackKit, designText, writeDesignText, diffDesigns, planDesignApply, readDesignFolder, type DesignOp, type ReconvertPreview, csvField, exitBundle, discardExitBundle } from '../../store/src/index.ts';
import { xlsxSheetNames } from '../../scripts/src/xlsx.ts';
import { importFileRowIterator, neverAllowed, parseAllowList, SCREEN_STEPS, SERVER_STEPS, testScripts, type ScriptTestResult } from '../../scripts/src/index.ts';
import { conversionReport, explainScriptFailure, type ScriptFailure, DEFAULT_MODEL, DEFAULT_RUN_TOKENS, MAX_RUN_TOKENS, parseRunTokens, Host, serve, serveCluster, serveStdio, aiStatus, STORE_EXT, ENCRYPTED_EXT, encryptFileSync, decryptFileSync, setAdminPassword, adminPasswordProblem, tokenExpiry, readLocalMcpToken, backupFolder, backupSets, defaultBackupDir, parseInterval, parseTime, restoreAt, restoreBackup, AccountChangesError, type AccountDifference, type ChangedSince, verifySet, describeCheck, resolveEmbedEndpoint, resolveImageEmbed, localCertificateFiles, Standby, S3, s3FromEnv, mirrorDown, fetchFmsExport, migrateFms, describeMigration, copySize, readSettings, runningServer, dataApiSource, dataApiClient, checkSyncAllowed, describeApply, describePlan, verifySync, describeSyncVerification, parseSyncConfig, CONTAINER_PULL_MAX_BYTES, type FmsExport } from '../../server/src/index.ts';
// optimize's report (kept apart from the busy import line above).
import { sheetsFromFile, checkSheetNames, sheetNameOf } from '../../server/src/import-sheets.ts';
import { optimizationReport, openApiDocument, typesFromOpenApi, checkSolution, checkSolutionText, createFeed, importIcs, listFeeds, revokeFeed } from '../../server/src/index.ts';
import { compactStore } from '../../server/src/compaction.ts';
import type { SmtpConfig, OidcProvider } from '../../server/src/index.ts';
import { forgetVault } from '../../server/src/pii.ts';
import { ServerConfig } from '../../server/src/server-config.ts';
import { parseStatsInterval } from '../../server/src/stats-log.ts';
import { parseLogLimit } from '../../server/src/server-logs.ts';
import { generateKey, installPackage, packPlugin, pluginStatus, readPackage, setPluginEnabled, setPluginSecret, uninstallPlugin } from '../../plugins/src/index.ts';
import { proxyHeader as checkedProxyHeader, trustedProxyAddresses } from '../../server/src/client-address.ts';
import { validatePublicUrl } from '../../server/src/public-origin.ts';
// test-scripts' outbound report and --skip checks (kept apart from the busy import lines above).
import { describeOutside, skipMatcher, unmatchedSkips } from '../../scripts/src/index.ts';
// test-scripts --show: script steps with what was typed into them masked.
import { maskFormula, maskStepText } from '../../scripts/src/index.ts';
// script-tests: saved test cases, run offline (CI fails on a failing case).
import { captureOnly, runScriptTests, setCaptureOnlyDefaults } from '../../scripts/src/index.ts';
import { scriptText } from '../../fmp12/src/index.ts';
// test-scripts --lint: loops that never end, found without running anything.
import { lintScript } from '../../store/src/index.ts';
import { applyStarter, STARTER_NAMES } from '../../store/src/index.ts';
import { NATIVE_REFUSAL } from '../../store/src/index.ts';
import { resolveAiKey } from './ai-key.ts';
import { readSecretFile } from './secret-file.ts';
import { corpusScan, scanFile } from './corpus-scan.ts';
import { pairTokenFile } from './pair-tokens.ts';
import { databaseNameProblem } from '../../server/src/solution-builder.ts';
import { SERVER_VERSION, versionText } from '../../server/src/version.ts';

const USAGE = `tabularius - read FileMaker .fmp12 files

Usage:
  tabularius version                        Print the version, commit and the Node it needs (also --version or -v)
  tabularius help [command]                 The commands, or one command's usage (also <command> --help)
  tabularius                                 Start here: hosts ~/tabularius on this computer and
                                             opens the browser, where you drop a .fmp12 to host
                                             and open it (folder: TABULARIUS_FOLDER)
  tabularius info <file.fmp12>               File header and object counts
  tabularius info <folder> <database>        Hosted file mode and object counts
  tabularius schema <file.fmp12|folder database> [--json]
                                             Tables, fields, layouts, scripts, ... (a hosted
                                             database too)
  tabularius records <file.fmp12|folder database> <table> [--limit N] [--format jsonl|csv]
  tabularius export <file.fmp12> <out.sqlite>  Convert every table to SQLite
  tabularius pair-tokens <file.fmp12> <clipboard.xml>
                                             Offline, read-only tree pairing; prints IDs,
                                             known names, anonymous IDs for other names,
                                             and agreement counts only. Clipboard
                                             fmxmlsnippet XML; no Save a Copy as XML yet.

Hosting (point it at a folder of .fmp12 files; each is converted once):
  tabularius serve <folder> [--port 8080] [--host 127.0.0.1] [--open] [--mcp-token T|--mcp-token-file F] [--allow-script-network] [--allow-script-network-to hosts] [--allow-app-connections] [--allow-webhooks] [--allow-inbound-hooks]
                [--list-files-publicly]
                [--tls-cert cert.pem --tls-key key.pem] [--allow-plain-http] [--public-url URL] [--mcp-origin URL]... [--proxy-header x-forwarded-for|forwarded|x-real-ip] [--trusted-proxies IP/CIDR,...] [--connections-per-address N]
                [--https name[,name]|local [--https-email E] [--http-port 80] [--acme-directory URL]] [--sql-port 5432 [--sql-writes]]
                [--backup-every 1d] [--keep 7] [--backup-dir DIR] [--no-backups]
                [--progressive 5m] [--stats-interval 1m|off] [--log-limit 100MB] [--backup-s3 s3://bucket/prefix [--s3-endpoint URL] [--s3-region REGION]] [--replication-token T|--replication-token-file F] [--keep-api-tokens-on-takeover] [--accept-partial-standby] [--ai] [--allow-blank-passwords]
                [--oidc-issuer URL --oidc-client-id ID [--oidc-name N] [--oidc-groups-claim C] [--oidc-trust-email] [--oidc-data-api-return-urls URL,...]] [--oidc-config providers.json]
                [--ldap-url ldaps://host [--ldap-user-attribute A] [--ldap-base-dn DN] [--ldap-bind-dn-template T] [--ldap-search-dn DN] [--ldap-name N] [--ldap-email-attribute A] [--ldap-group-attribute A]]
                [--workers N|auto] [--test-outbound [--mail-redirect ADDRESS] [--mail-copies 20] [--allow-host h[,h]] [--capture-only F[,F]] [--capture-only-copies-to-redirect]]
                [--send-mail --mail-from ADDRESS [--capture-only F[,F]]]
                                             Data API at /fmi/data/vLatest, MCP at /mcp,
                                             web client at /app/. Listens on this computer
                                             only. --host 0.0.0.0 lets others on the network
                                             connect, but needs HTTPS (--https, --tls-cert)
                                             or --allow-plain-http. Backs up
                                             daily to <folder>/Backups unless told not to;
                                             --backup-s3 copies them off-site (keys in
                                             TABULARIUS_S3_ACCESS_KEY / TABULARIUS_S3_SECRET_KEY).
                                             Import Records in scripts reads files from
                                             <folder>/Documents only.
                                             --open opens the admin welcome page in a browser
                                             after a single-process server starts.
                                             --allow-inbound-hooks answers calls to the
                                             inbound hooks set up in the admin console.
                                             --https gets and renews a certificate from Let's
                                             Encrypt (the name must point here and port 80
                                             reach it); serves on 443 unless --port.
                                             --https local: a certificate from this server's own
                                             authority, for a local network; devices trust it
                                             once from /tabularius/tls/. http:// to the port is
                                             sent on to https://.
                                             --sql-port lets BI tools and PostgreSQL ODBC/JDBC
                                             drivers query files (accounts need fmxdbc).
                                             --sql-writes (with --sql-port) also lets them
                                             INSERT, UPDATE and DELETE; off by default.
                                             --ai turns on the AI assistant in the web client
                                             (key in ANTHROPIC_API_KEY, else the file
                                             ~/.openhbam/anthropic-key, chmod 600, or --ai-key-file F
                                             (read again when it changes); a key not made inside
                                             a workspace needs --ai-workspace-id wrkspc_… or the
                                             file ~/.openhbam/anthropic-workspace-id; --ai-model M
                                             for design work, default claude-opus-5-5; --ai-embed-url U --ai-embed-model M
                                             (key in TABULARIUS_AI_EMBED_KEY) for script embeddings,
                                             RAG and semantic find; U can be ollama or lmstudio
                                             (the model is then optional), and with no --ai the
                                             embedding steps work without an Anthropic key;
                                             --ai-image-embed voyage|jina [--ai-image-embed-model M] (key in
                                             TABULARIUS_AI_IMAGE_EMBED_KEY) for Perform Semantic Find
                                             by image; --ai-fast-model M for simple
                                             questions, default claude-haiku-5-5, off for one model;
                                             --ai-daily-tokens N caps tokens per day,
                                             --ai-account-daily-tokens N per account,
                                             --ai-run-tokens N for one question (default 300000, strict),
                                             --ai-monthly-budget D stops at about D US dollars a month).
                                             --ai-exclude A,B keeps those files from AI apps
                                             and the assistant entirely (also: tabularius ai ... off).
                                             --workers runs N processes (auto: one per CPU
                                             core) behind the one port, sharing record locks
                                             and live updates; not yet with --progressive,
                                             --replication-token, --https name (automatic
                                             certificates) or encryption at rest.
                                             --stats-interval sets how often Stats.log and
                                             TopCallStats.log (FileMaker Server's layout) get a
                                             line in <folder>/Logs: 1m by default, off to stop.
                                             --log-limit is how big a log may get before it is
                                             kept as <name>-old.log and started again: 40MB by
                                             default (also logLimit in the folder's settings).
                                             --test-outbound lets scripts try mail and web
                                             calls safely: every message goes to <folder>/Outbox
                                             (shown in /admin) and never to its recipients; with
                                             --mail-redirect and an SMTP account of your own in
                                             TABULARIUS_TEST_SMTP or ~/.openhbam/test-smtp
                                             (smtps://user:pass@host:465), a
                                             copy goes to that one address. Requests reach only
                                             --allow-host hosts; others get an empty answer,
                                             and a run that calls one blocked host 100 times
                                             is stopped. test-scripts lists what each script
                                             tried to reach. Mail from capture-only files
                                             (named with --capture-only F[,F], or in
                                             TABULARIUS_CAPTURE_ONLY; each name matches any file
                                             starting with it) is only kept in the outbox, not
                                             even copied to the redirect address, unless
                                             --capture-only-copies-to-redirect; never
                                             sent to anyone else. No file is capture-only
                                             unless you name it.
                                             --send-mail lets Send Mail via SMTP really send,
                                             through the SMTP account in TABULARIUS_SMTP or
                                             ~/.openhbam/smtp (smtps://user:pass@host:465),
                                             from --mail-from (the script's From name is shown,
                                             its address gets replies). Off by default. Nothing is
                                             sent while a capture-only file (--capture-only or
                                             TABULARIUS_CAPTURE_ONLY) is in the folder. Not with
                                             --test-outbound.
  tabularius standby <folder> --primary URL [--token T|--token-file F] [--overwrite]
                                             Keep copies of another server's files a second
                                             or so behind it (it runs serve --replication-token
                                             T; token also in TABULARIUS_REPLICATION_TOKEN or
                                             TABULARIUS_REPLICATION_TOKEN_FILE). To
                                             take over, stop this and serve the folder (its API
                                             tokens are ended unless serve gets
                                             --keep-api-tokens-on-takeover). Copies that did not
                                             reach a whole state are refused unless serve gets
                                             --accept-partial-standby.
  tabularius migrate-fms <folder> [--fms-dir DIR] [--from URL|export.json] [--user admin] [--insecure]
                [--save export.json] [--dry-run]
                                             Switch from FileMaker Server in one step: its hosted
                                             files and their container folders (from --fms-dir,
                                             its install folder), script schedules, backup
                                             schedule and SSL certificate (CStore; key passphrase
                                             in TABULARIUS_FMS_KEY_PASSPHRASE) into <folder>.
                                             --from reads schedules and the file list from its
                                             Admin API (password in TABULARIUS_FMS_PASSWORD or
                                             stdin) or a file --save wrote; serve then picks up
                                             the backup and certificate settings
  tabularius write-back <folder> <db> <out-dir> [--fmp12 FILE]
                                             Design changes made here since <db> came from
                                             its .fmp12 (in <folder>, or --fmp12), ready to
                                             take back to FileMaker by hand: numbered
                                             clipboard XML files to paste in FileMaker Pro,
                                             and a README.md listing them and the changes to
                                             make by hand. Nothing in FileMaker is touched
  tabularius sync-plan <folder> <db> --config sync.json [--user NAME] [--insecure] [--capture-only F[,F]] [--json]
                                             Preview keeping a FileMaker Server copy of <db> in
                                             step: what would go to FileMaker, what would come
                                             here, and the conflicts held for review. Read only:
                                             nothing is written on either side. sync.json names
                                             the server, its file and each table's layout, UUID
                                             field and modification timestamp field (ADMIN.md);
                                             password in TABULARIUS_FMS_PASSWORD or typed
  tabularius sync-apply <folder> <db> --config sync.json [--write] [--pull] [--containers] [--resolve POLICY] [--allow-deletes]
                [--keep-related] [--user NAME] [--insecure] [--capture-only F[,F]] [--release] [--json]
                                             Send the records sync-plan says go to FileMaker
                                             Server (--write), and/or bring FileMaker's changes
                                             here (--pull). With neither it is a dry run. --write
                                             also needs "allowWrites": true in sync.json; both stop with
                                             nothing sent if the plan holds any conflict (settle
                                             them with a table's policy, or --resolve
                                             tabularius-wins|filemaker-wins|newer-wins for tables
                                             that hold them), and hold deletions unless
                                             --allow-deletes (a deletion brought here also deletes
                                             the records this file's relationships delete with it;
                                             --keep-related leaves them). Every write is logged; run it
                                             again to carry on after a stop. Never for
                                             capture-only files. --release lets a table an
                                             earlier run held back write again
  tabularius sync-log <folder> <db> [--run ID] [--limit 200] [--json]
                                             The log of what sync-apply sent to FileMaker
  tabularius service install <folder> [--port 8080] [--host 127.0.0.1] [--system] [-- serve options]
                                             Run it as a service that starts at login, or with
                                             --system at boot (launchd, systemd or Windows Task
                                             Scheduler), on this computer only unless --host
                                             says more; 'service print' shows the file,
                                             'service uninstall' removes it (files stay). Refuses
                                             a port another program holds, naming a free one
  tabularius design-diff <old> <new> [--exit-code]
                                             A readable difference between two designs, for a code
                                             review: scripts step by step, tables field by field,
                                             layouts object by object, relationships by name. Each
                                             side is a folder design-text wrote, a .fmp12 file or a
                                             hosted .openhbam.sqlite file. --exit-code: exit 1 when
                                             they differ. Changes nothing
  tabularius api-types
                                             Print TypeScript types for the Data API and OData (a .d.ts),
                                             written from the server's own OpenAPI description:
                                             tabularius api-types > tabularius-api.d.ts. The description
                                             itself is at /fmi/data/openapi.json on a running server.
                                             Needs no file; changes nothing
  tabularius demo [--starter crm|inventory|invoicing|tasks|booking] [--keep <folder>] [--port 8080] [--no-open]
                                             Try it: a starter app with sample records, hosted for this
                                             computer only on a free port, with an Admin account whose
                                             random password is printed once. Opens the browser if it can.
                                             Everything is deleted when you press Ctrl-C (--keep <folder>
                                             leaves the files there). Nothing goes off this computer
  tabularius doctor [<folder>] [--full] [--port 8080] [--url https://...] [--ai-embed-url ollama|lmstudio|URL [--ai-embed-model M]]
                                             Check the usual reasons a server won't start or can't
                                             be reached (Node version, folder, disk, port, certificate,
                                             backups, service, address), with one fix for each. Changes
                                             nothing; exits 1 if there is a problem
  tabularius doctor --exposure [--url https://...] [--port 8080] [--sql-port N]
                                             What a running server is open to, with what to change:
                                             the addresses it listens on, plain HTTP, HSTS and browser
                                             headers, the public URL, the admin console, the AI (MCP)
                                             connector, the SQL port and trusted proxies. Asks the
                                             server without a password and signs nothing in; reads the
                                             installed service's options. Changes nothing; exits 1 if
                                             there is a problem
  tabularius diagnostics [<folder>] [--out <file.zip|folder>] [--include-names] [--full]
                                             Collect what a bug report needs and nothing it must not
                                             carry: versions, system, settings that are switches or
                                             numbers, file sizes and design counts, the doctor checks,
                                             and the last 500 lines of the Event and ScriptEvent logs
                                             with names, addresses, secrets and anything quoted hidden.
                                             Never records, passwords, tokens or file names (unless
                                             --include-names). Writes a .zip of plain text to read
                                             before you send it; changes nothing else
  tabularius upgrade [--no-backup] [--wait 90] [--from <bundle|tarball|folder>]
                                             Update this install in place: new version, backup,
                                             restart, health check, and back to the old version
                                             if the new one doesn't start. --from takes the new
                                             version from a copy instead of GitHub
  tabularius admin-password <folder>         Set the admin console password (/admin/; asks for it
                                             twice, hidden, in a terminal; else read from
                                             TABULARIUS_PASSWORD or stdin). Without one the
                                             console only opens on this machine.
  tabularius mcp-token <folder>              Print the token an AI app presents at /mcp to work as
                                             the administrator (Authorization: Bearer ...). The server
                                             makes it on first start; it is kept in the folder in a
                                             file only your account can read. --mcp-token sets another
                                             token for a server instead.
  tabularius backup <folder> [--to DIR] [--keep 7]
                                             Back up every hosted file now (safe while serving);
                                             encrypted when TABULARIUS_BACKUP_KEY holds a passphrase
  tabularius verify-backup <folder> [backup-set] [--from DIR] [--sign]
                                             Read backup sets back and check them (all of them
                                             without a set); exits 1 when one is damaged
  tabularius restore <folder> <backup-set> [database] [--accept-account-changes]
                                             Put back files from a backup set (stop the server
                                             first; encrypted sets need TABULARIUS_BACKUP_KEY).
                                             Lists accounts that differ from the file it replaces
                                             and stops until you add --accept-account-changes.
                                             A set without a signature (encrypted before
                                             signatures, or one removed) needs
                                             --accept-unsigned-backup, or verify-backup --sign
  tabularius restore <folder> --at "2026-10-11 14:05" [database] [--from DIR | s3://bucket/prefix] [--accept-account-changes]
                                             Put back files as they were at a moment (with
                                             serve --progressive, to the minute it saves changes;
                                             --accept-unsigned-backup as for a set)
  tabularius encrypt <folder>                Encrypt the hosted stores at rest (server stopped;
  tabularius decrypt <folder>                key in TABULARIUS_ENCRYPTION_KEY). serve unlocks them
                                             with the same key and re-encrypts on clean shutdown
  tabularius mcp <folder> [--account A]      MCP over stdio, for desktop AI apps; with an
                                             account (password in TABULARIUS_PASSWORD), the
                                             AI works within its privilege set;
                                             --ai-exclude A,B keeps those files from it
  tabularius reconvert <folder> <database>|--all [--dry-run] [--same-file] [--force]
                                             Convert a file (or every outdated one) again from its
                                             .fmp12 after a fix to the converter, keeping records
                                             created, changed and deleted since, accounts and
                                             settings (the store as it was is kept beside it).
                                             While the server runs, it is asked to do it (run as
                                             the user it runs as; no sudo, other files stay up).
                                             --dry-run shows what would change; --same-file: the
                                             .fmp12 is a copy of the one converted; --force
                                             converts afresh when edits can't be carried over
  tabularius passwd <folder> <database> <account> [--privilege-set S] [--must-change]
                                             Set an account's password (read from
                                             TABULARIUS_PASSWORD or stdin; at least 12
                                             characters unless the file's policy says
                                             otherwise); new accounts need a privilege set. --must-change makes
                                             the person set a new one at next sign-in
  tabularius privileges <folder> <database> policy [minLength [maxAgeDays]]
                                             Show or set the file's password policy
                                             (0 turns a limit off; a file with no minimum
                                             of its own takes 12, TABULARIUS_MIN_PASSWORD_LENGTH)
  tabularius privileges <folder> <database> must-change <account> [off]
                                             Require (or clear) a password change at
                                             the account's next sign-in
  tabularius test-scripts <folder> [database] [--script NAME]... [--skip NAME]... [--timeout 10] [--loop-limit N] [--loop-records N] [--global '$$NAME=VALUE']... [--json] [--verbose] [--explain] [--show [--function NAME]...] [--lint]
                [--test-outbound [--mail-redirect ADDRESS] [--mail-copies 20] [--allow-host h[,h]] [--capture-only F[,F]] [--capture-only-copies-to-redirect]]
                                             Run each script offline (no network, mail or
                                             plug-ins) from the layout of a button that runs
                                             it, first record current, selection globals set;
                                             each script's changes are undone. Lists the
                                             scripts that stall, crash or end with an error
                                             (a script using over half the memory is stopped
                                             and counted as stalled; --verbose names each
                                             script as it starts). --skip takes names with *
                                             anywhere ("*Upload*"), lists what it
                                             matched first, and stops if a pattern matches
                                             nothing. Scripts with credentials written into
                                             them (AWS keys, a password in a variable) are
                                             never run and are listed as skipped.
                                             --explain: for each script that ends with an
                                             error, why: it runs again on a copy, offline, and
                                             shows the failing step, the steps before it, the
                                             variables and field values there, and hints
                                             --test-outbound: as for serve, mail is captured
                                             in <folder>/Outbox instead of failing
                                             --show: print the --script scripts' steps instead
                                             of running them, with literals, addresses and
                                             keys masked (names stay), to share why one stalls;
                                             --function NAME also prints that custom
                                             function, comments masked too
                                             --global '$$UserName=tester': set a $$variable
                                             before each script, as a login script would
                                             (a field that fills in from an unset one is
                                             reported as test setup, not a script fault)
                                             --lint: run nothing; list loops that never end
                                             and guards that catch nothing, with a fix each
                                             (a stalled script lists these too)
  tabularius script-tests <folder> [database] [--script NAME]... [--json]
                                             Run the script test cases saved with each file
                                             (the script editor's Tests) offline, each on a
                                             trial whose changes are undone, with the case's
                                             own AI answers instead of a model. Lists each
                                             case and what differs; exits 1 if any fails,
                                             for CI. A capture-only file is run only
                                             when named
  tabularius fidelity <folder> <database> [--sql] [--n 200] [--json]
                                             Recompute stored calculations and compare with
                                             what FileMaker stored; --sql only those using
                                             ExecuteSQL, by query shape. Counts only, never
                                             values; read-only; runs no scripts
  tabularius import-tables <folder> <database> <file|folder>... [--preview] [--json] [--no-links] [--set Sheet.Column=kind]
                                             Come in from Airtable, Notion, Google Sheets or
                                             Excel: each CSV file, Excel sheet or Notion ZIP
                                             (CSV tables and Markdown pages) becomes tables;
                                             extracted Markdown folders also become a table; column
                                             types are worked out (text, number, date, time,
                                             timestamp, checkbox, select, multi) and a column of
                                             linked records becomes a join table with
                                             relationships and a portal. --preview shows the
                                             plan and writes nothing; --set overrides a kind
                                             (or link:Sheet, or skip). Data only; counts only
  tabularius exit-bundle <folder> <database> --out <folder> --account A [--discard]
                                             Take a portable copy of the whole file: every table
                                             (SQLite and CSV), every container file, globals,
                                             serial counters, the design and the accounts without
                                             their secrets, with a manifest of SHA-256 hashes.
                                             A Full Access account; the password is asked for
                                             (or TABULARIUS_PASSWORD). PLAINTEXT, even when files
                                             are encrypted at rest. A stopped copy resumes when run
                                             again; --discard removes an unfinished one
  tabularius export-sql <folder> <database> --out file.sql [--dialect postgres|sqlite] [--account A]
                                             Leave with your data: tables, records, keys and
                                             value lists as a SQL script (container files go
                                             in file.files/ beside it). With --account only
                                             what that account may export. Prints counts only;
                                             refuses to overwrite file.sql
  tabularius check-solution <folder> <database> [--json] [--account A] [--fail-on error|warning]
                                             Look through a solution for what is wrong without
                                             running it: calculations that do not parse, scripts,
                                             layouts, fields and value lists that are not there,
                                             steps and plug-ins this build does not run, privilege
                                             sets and accounts that grant nothing. Each finding
                                             says where and how to fix it. Exit 0 clean, 2 when
                                             problems are found, 1 when it could not run. With
                                             --account, also what that account cannot reach
  tabularius stale-calcs <folder> <database> [--table T] [--n 10000] [--json]
                                             Count, per field, stored calculations whose saved
                                             value is no longer what the formula gives now.
                                             Counts only; changes nothing
  tabularius corpus-scan <folder> [--out DIR] [--convert] [--dedupe-only] [--all] [--list FILE] [--only ANON-ID] [--jobs N] [--timeout SECONDS]
                                             Count what a collection of .fmp12 files uses:
                                             plug-in calls, functions, Get ( ) options, script
                                             steps, layout objects, triggers; --convert also
                                             tries converting each. Duplicates (same content)
                                             are scanned once (--dedupe-only: just count them,
                                             comparing same-size files only; --all: also walk
                                             Library, System and Applications folders; --list: scan
                                             the .fmp12 paths in FILE, one per line, instead
                                             of walking a folder). Writes corpus-report.json and
                                             .md: counts and masked formula shapes only, no
                                             file names, record data or names
  tabularius layout-census <folder> [database] [--json] [--names]
                                             Per kind of layout object, how many there are and
                                             how many Tabularius can't draw or work out (missing
                                             fields, pictures, popovers, formulas that don't
                                             check). Counts only, no values; read-only.
                                             --names adds layout names to the per-layout lists
  tabularius report <folder> [database] [--json]
                                             What won't work yet after conversion: script
                                             steps, functions, plug-ins, other files, accounts
  tabularius optimize <folder|file.fmp12> [database] [--json]
                                             Ways to make a file smaller and faster: container
                                             files kept inside it (size by field, for S3 or
                                             external storage instead), sorts no index serves,
                                             fields, scripts and table occurrences nothing uses.
                                             Changes nothing; a .fmp12 is converted to a scratch
                                             copy first, so nothing is hosted
                                             --purge-orphans removes unreferenced container rows
                                             and their external files from a hosted folder
  tabularius compact <folder> [database] [--json]
                                             Reclaim database and WAL space beside a running server;
                                             SQLite arbitrates writes. The server's timer normally does this.
  tabularius privileges <folder> <database>  Accounts and privilege sets
      ... show <set>                         A privilege set as JSON
      ... save <set.json>                    Add or replace a privilege set
      ... account <account> <set>            Give an account a privilege set
      ... grant|revoke <set> <keyword>       Extended privileges: fmrest (Data API),
                                             fmapp / fmwebdirect (web client), fmmcp (AI),
                                             fmurlscript (run a script from a link),
                                             fmxdbc (SQL at /tabularius/sql/v1, like ODBC),
                                             fmodata (OData at /fmi/odata/v4: Excel, Power BI)
      ... external <group-or-email> <set>    An external account, for sign-in through
                                             the identity provider (serve --oidc-issuer)
  tabularius ai <folder> <database> on|off|status   whether AI apps (MCP) and the AI assistant may read the file
  tabularius ai <folder> <database> pii on|off|status   personal data isolation: AI gets stand-ins (<PERSON_3>) for personal data
  tabularius plugins <folder> [list]         Plug-ins in <folder>/plugins/ and the files each is on for
  tabularius plugins <folder> enable|disable <database> <plugin-id>
  tabularius ai-policy <folder> <name> on|off     Set the per-file AI-visible policy
  tabularius plugins <folder> secret <plugin-id> <NAME> [--clear]   Set a plug-in's secret from standard input
  tabularius plugins <folder> install <package.ohplugin> [--trust <fingerprint>] [--allow-unsigned] [--replace]
  tabularius plugins <folder> uninstall <plugin-id>
  tabularius plugins <folder> script-install on|off|status   whether the Install Plug-In File script step works (off unless turned on)
  tabularius plugins <folder> keygen <key.pem>                    A publisher's signing key (keep the file secret)
  tabularius plugins <folder> pack <plug-in folder> [--key key.pem] [-o file.ohplugin]
                                             Turn a plug-in on or off for one hosted file; the
                                             server applies it when it next starts
  tabularius token <folder> <database> create <account> [--label L] [--read-only] [--expires-days N|0] [--surfaces fmrest,fmodata,fmxdbc] [--layouts L1,L2,...]
                                             A revocable API token for an integration, acting as
                                             <account> (use it as a Bearer token on the Data API
                                             and SQL). Shown once. --read-only forbids writes. It stops
                                             working after 90 days unless --expires-days says otherwise
                                             (0 for none).
                                             --layouts limits it to those Data API layouts (and
                                             only the Data API; OData and SQL refuse it).
      ... list                               The file's tokens (never the secret)
      ... revoke <id>                        Revoke a token by its id
  tabularius calendar-feed <folder> <database> create --account A --layout L --start FIELD [--end F] [--title F] [--description F] [--location F]
                                             [--zone UTC|Europe/London] [--query '[{"Status":"open"}]'] [--limit N] [--label L]
                                             [--expires-days N|0] [--public-url https://host] [--json]
                                             A calendar link for a layout's date field: a read-only API token
                                             scoped to that layout, as <account>, and the address that carries
                                             the field choices. The address is shown once, as a token is.
      ... list [--json]                      The feeds in the file (never an address)
      ... revoke <id>                        End a feed's link
  tabularius import-ics <folder> <database> <file.ics> --account A --layout L --start FIELD [--end F] [--title F] [--description F] [--location F]
                                             [--uid F] [--zone UTC|Europe/London] [--json]
                                             Read an iCalendar file into a layout's records, one per event, all or none,
                                             with <account>'s privileges. Prints what it did.
  tabularius totp <folder> <database> enroll <account>
                                             Turn on two-factor sign-in: prints a secret and an
                                             otpauth:// URI for an authenticator app
      ... confirm <account> <code>           Confirm the first 6-digit code to switch it on
      ... status                             Accounts that have two-factor sign-in
      ... disable <account>                  Turn it off for an account
  tabularius audit <folder> <database> [--table T] [--record N] [--account A] [--since ISO] [--limit N]
                                             Who created, changed and deleted which records
  tabularius audit verify <folder> <database> [--chain security|records] [--sign-key FILE [--check ANCHOR.json]]
                                             Check history read-only; prints JSON. security (the
                                             default) is sign-ins and privilege changes, records
                                             is record changes. Exits 0 consistent, 1 broken,
                                             2 unprotected. Consistent means internal consistency,
                                             not authenticity or completeness. Recomputed history,
                                             a rewritten head or an older valid backup can pass.
                                             Stronger guarantees need independently protected
                                             checkpoints: with --sign-key (a secret of 16+ bytes
                                             you keep) the output carries an "anchor", the newest
                                             hash signed; store it somewhere the server can't
                                             reach. Later, --check ANCHOR.json with the same key
                                             fails (exit 1) if the log no longer holds that hash
                                             at that position. Access uses filesystem permissions,
                                             not console authentication.
  tabularius new <folder> <database> [--native] [--starter crm|inventory|invoicing|tasks|booking [--no-sample]]
                                     Start a database (no FileMaker file needed), empty or with a ready-to-use app
  tabularius design <folder> <database> <changes.json>
                                             Apply design changes (tables, fields, layouts,
                                             scripts; see docs/design-mode.md)
  tabularius design-text <folder> <database> <out-dir>
  tabularius design-text <file.fmp12> <out-dir>
                                             The design as small text files (tables, scripts,
                                             layouts, value lists, custom functions, privilege
                                             sets), one per object, to keep in git and diff. No
                                             record data or passwords. Run again to update
  tabularius design-apply <folder> <database> <in-dir> [--apply] [--remove]
                                             Read a folder design-text wrote back: the scripts,
                                             custom functions, value lists and layouts that differ
                                             from the file are listed as changes; --apply makes
                                             them. A file left out removes nothing unless --remove
  tabularius style-census <file.fmp12> [--json]
                                             FileMaker styling tabularius doesn't draw yet: style
                                             properties by id and theme rules for parts or states
                                             the web client has no place for. Counts only; read-only
  tabularius ddr <file.fmp12>                The file's Database Design Report as XML (FileMaker's
                                             FMPReport format, for analysis tools), to stdout
  tabularius dump <file.fmp12> [--prefix 4.5] [--text]
                                             Raw path tree, for format research
`;

/** Every option the usage text names: a value that is one of these in a secret's or label's place is a mistyped command line. */
const KNOWN_OPTIONS = new Set(USAGE.match(/--[a-z][a-z0-9-]*/g));

/** What design-text did, in a line. */
function designTextSummary(out: string, r: { written: string[]; unchanged: number; removed: string[] }, total: number): string {
  if (!r.written.length && !r.removed.length) return `${out}: ${total} files, nothing changed`;
  return `${out}: ${total} files; ${r.written.length} written, ${r.removed.length} removed, ${r.unchanged} unchanged`;
}

/** Files to keep from AI: --ai-exclude A,B, or TABULARIUS_AI_EXCLUDE. */
function aiExcludeFrom(args: string[]): string[] {
  const given = flag(args, '--ai-exclude');
  // A misspelled option written after --ai-exclude would become the list of names and leave the real option unread.
  if (given?.startsWith('-')) throw new Error(`--ai-exclude needs a list of names (or '' for none), found ${given}`);
  return (given ?? process.env.TABULARIUS_AI_EXCLUDE ?? '').split(',').map((n) => n.trim()).filter(Boolean);
}

/** Browser origins besides the server's own that may call /mcp: `--mcp-origin https://files.example.com` (repeatable) and TABULARIUS_MCP_ORIGINS (comma separated). */
function mcpOriginsFrom(args: string[]): string[] {
  const given: string[] = [];
  while (args.includes('--mcp-origin')) {
    const v = flag(args, '--mcp-origin');
    if (v === undefined) throw new Error('serve: --mcp-origin needs an address like https://files.example.com');
    given.push(v);
  }
  const all = [...given, ...(process.env.TABULARIUS_MCP_ORIGINS ?? '').split(',').map((v) => v.trim()).filter(Boolean)];
  const usable = (v: string) => { try { return /^https?:\/\/[^/\\?#@\s*]+$/i.test(v) && !!new URL(v).origin; } catch { return false; } };
  for (const v of all) if (!usable(v)) throw new Error(`serve: --mcp-origin "${v}" is not an origin like https://files.example.com (a scheme and host, no path)`);
  return all;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

/**
 * An option whose value must be there: for restrictions and secrets, where a blank, a missing value or a
 * neighbouring option taken as the value would quietly widen access. Other options keep `flag`'s lenient
 * reading, so a scripted empty value (`--prefix ''`, `--ai-exclude ''`) still works. A secret may begin with a dash,
 * but not look like the next option (`--mcp-token --port 9000`).
 */
function strictFlag(args: string[], name: string, allowLeadingDash = false): string | undefined {
  // `--name=value` is not read as the option: for a secret that would start the server without it.
  if (allowLeadingDash && args.some((a) => a.startsWith(`${name}=`))) throw new Error(`${name}=value is not read; write the option and its value as two words (${name} VALUE)`);
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || !v.trim() || (!allowLeadingDash && v.startsWith('-'))) throw new Error(`${name} needs a non-empty value`);
  // A secret may begin with a dash, but not be an option the usage names (--port, --allow-script-network) or look like one with a word after it.
  if (allowLeadingDash && (KNOWN_OPTIONS.has(v) || (/^--[a-z][a-z0-9-]*$/.test(v) && args[i + 2] !== undefined && !args[i + 2].startsWith('-')))) throw new Error(`${name} needs a value, found the option ${v}`);
  args.splice(i, 2);
  if (args.includes(name)) throw new Error(`${name} was given more than once`);
  return v;
}

/** Explicit flags take priority over environment values; two sources at the same level are ambiguous. */
function tokenOption(args: string[], inlineName: string, fileName: string, inlineEnv: string | undefined, fileEnv: string | undefined, command: string): { value: string | undefined; file: string | undefined } {
  const inline = strictFlag(args, inlineName, true);
  const file = strictFlag(args, fileName, true);
  if (inline !== undefined && file !== undefined) throw new Error(`${command}: give either ${inlineName} or ${fileName}, not both`);
  if (inline !== undefined) return { value: inline, file: undefined };
  if (file !== undefined) return { value: readSecretFile(file, fileName), file };
  if (inlineEnv !== undefined && fileEnv !== undefined) throw new Error(`${command}: give either ${inlineName} or ${fileName}, not both`);
  if (inlineEnv !== undefined) return { value: inlineEnv, file: undefined };
  return fileEnv === undefined ? { value: undefined, file: undefined } : { value: readSecretFile(fileEnv, fileName), file: fileEnv };
}

/** A script failure for the terminal: the step, what the error means, the steps before, the values there, and hints. */
function describeFailure(w: ScriptFailure): string {
  const out = [`why     ${w.script}: ${w.outcome === 'ok' ? 'no error when run again on a copy' : `error ${w.error}${w.meaning ? ` (${w.meaning})` : ''}`}`];
  if (w.step) out.push(`        at step ${w.step.number} of ${w.step.script}: ${w.step.line}${w.message ? `\n        ${w.message}` : ''}`);
  if (w.stack && w.stack.length > 1) out.push(`        called from ${w.stack.slice(0, -1).map((s) => `${s.script} step ${s.step}`).join(' > ')}`);
  for (const b of w.before ?? []) out.push(`          ${String(b.number).padStart(3)}. ${b.line}${b.error ? `  (error ${b.error})` : ''}`);
  if (w.layout) out.push(`        on ${w.layout}${w.recordId !== undefined ? `, record ${w.recordId}` : ''}, ${w.foundCount ?? 0} found, ${w.mode ?? 'browse'} mode`);
  const vars = { ...w.variables?.locals, ...w.variables?.globals };
  if (Object.keys(vars).length) out.push(`        variables: ${Object.entries(vars).slice(0, 10).map(([k, v]) => `${k} = ${JSON.stringify(v.slice(0, 60))}`).join(', ')}`);
  for (const f of w.fields ?? []) out.push(`        ${f.name} = ${JSON.stringify(f.value.slice(0, 80))}${f.formula ? ` (formula: ${f.formula.replace(/\s+/g, ' ').slice(0, 100)})` : ''}`);
  for (const h of w.hints) out.push(`        hint: ${h}`);
  return out.join('\n');
}

/**
 * Outbound test mode switches (serve and test-scripts): --test-outbound turns
 * it on; --mail-redirect A sends a copy of each message to A (and only A)
 * through the SMTP account in TABULARIUS_TEST_SMTP, at most --mail-copies N
 * (default 20) per run; --allow-host lists the hosts requests may reach.
 */
function outboundFlags(args: string[], command: string): { redirectTo?: string; allowHosts: string[]; smtp?: SmtpConfig; maxCopies?: number; captureOnly?: string[]; copyHeld?: boolean } | undefined {
  const on = bool(args, '--test-outbound');
  const redirectTo = flag(args, '--mail-redirect');
  const hosts = flag(args, '--allow-host');
  const copies = flag(args, '--mail-copies');
  const held = flag(args, '--capture-only');
  const copyHeld = bool(args, '--capture-only-copies-to-redirect');
  // Naming capture-only files is allowed on its own: it holds them back from AI, schedules and hooks too.
  if (held) setCaptureOnlyDefaults(held.split(',').map((x) => x.trim()).filter(Boolean));
  if (!on) {
    if (redirectTo || hosts || copies || copyHeld) throw new Error(`${command}: --mail-redirect, --allow-host, --mail-copies and --capture-only-copies-to-redirect need --test-outbound`);
    return undefined;
  }
  // The account can also live in a file only its owner reads, so the password needn't be typed into a command line.
  const smtpFile = process.env.TABULARIUS_TEST_SMTP_FILE ?? join(homedir(), '.openhbam', 'test-smtp');
  const smtpUrl = process.env.TABULARIUS_TEST_SMTP || (existsSync(smtpFile) ? readFileSync(smtpFile, 'utf8').trim() || undefined : undefined);
  if (copyHeld && !redirectTo) throw new Error(`${command}: --capture-only-copies-to-redirect needs --mail-redirect`);
  if (smtpUrl && !redirectTo && process.env.TABULARIUS_TEST_SMTP) throw new Error(`${command}: TABULARIUS_TEST_SMTP is set but no --mail-redirect address was given`);
  const maxCopies = copies === undefined ? undefined : Number(copies);
  if (maxCopies !== undefined && !(Number.isInteger(maxCopies) && maxCopies >= 0)) throw new Error(`${command}: --mail-copies takes a whole number`);
  const allowHosts = (hosts ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const refused = allowHosts.filter(neverAllowed);
  if (refused.length) throw new Error(`${command}: ${refused.join(', ')} can never be allowed in test mode (Amazon Web Services hosts are always blocked)`);
  return {
    allowHosts,
    ...(redirectTo ? { redirectTo } : {}),
    ...(smtpUrl ? { smtp: { url: smtpUrl } } : {}),
    ...(maxCopies !== undefined ? { maxCopies } : {}),
    ...(held ? { captureOnly: held.split(',').map((x) => x.trim()).filter(Boolean) } : {}),
    ...(copyHeld ? { copyHeld: true } : {}),
  };
}

/**
 * --send-mail: Send Mail via SMTP really sends, through the account in TABULARIUS_SMTP (or the file
 * TABULARIUS_SMTP_FILE, ~/.openhbam/smtp by default), from --mail-from.
 */
function mailFlags(args: string[], command: string): { smtp: SmtpConfig; from: string; captureOnly?: string[] } | undefined {
  const from = flag(args, '--mail-from');
  if (!bool(args, '--send-mail')) {
    if (from) throw new Error(`${command}: --mail-from needs --send-mail`);
    return undefined;
  }
  if (args.includes('--test-outbound')) throw new Error(`${command}: --send-mail and --test-outbound can't be used together (test mode never sends)`);
  if (!from) throw new Error(`${command}: --send-mail needs --mail-from, the address mail is sent from`);
  const file = process.env.TABULARIUS_SMTP_FILE ?? join(homedir(), '.openhbam', 'smtp');
  const url = process.env.TABULARIUS_SMTP || (existsSync(file) ? readFileSync(file, 'utf8').trim() || undefined : undefined);
  if (!url) throw new Error(`${command}: --send-mail needs an SMTP account in TABULARIUS_SMTP or ${file} (smtps://user:pass@host:465)`);
  const held = flag(args, '--capture-only');
  if (held) setCaptureOnlyDefaults(held.split(',').map((x) => x.trim()).filter(Boolean));
  return { smtp: { url }, from, ...(held ? { captureOnly: held.split(',').map((x) => x.trim()).filter(Boolean) } : {}) };
}

/** A hosted database's store, which must already be there: a mistyped name is an error, not an empty file made on the spot. */
/** Accounts of a hosted file whose password is switched off, by name: what a restore leaves when the file it replaced could not be read. */
function accountsWithPasswordOff(file: string): string[] {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    return (db.prepare("SELECT name FROM _fm_accounts WHERE password_disabled = 1 AND source = 'openhbam' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* nothing more to do */ }
  }
}

function openDatabase(folder: string, database: string): Store {
  const file = join(folder, database + STORE_EXT);
  if (!existsSync(file)) throw new Error(`no database named "${database}" in ${folder}`);
  return new Store(file, database);
}

/** `schema` and `records` on a hosted database. A field with no stored column (an unstored calculation or a summary) is left out; the server works those out when it serves the database. */
function hostedRead(cmd: 'schema' | 'records', store: Store, args: string[]): number {
  if (cmd === 'schema') {
    if (bool(args, '--json')) console.log(JSON.stringify(store.schema, null, 2));
    else printSchema(store.schema);
    return 0;
  }
  const limit = Number(flag(args, '--limit') ?? Infinity);
  const format = flag(args, '--format') ?? 'jsonl';
  if (format !== 'jsonl' && format !== 'csv') throw new Error('records: --format is jsonl or csv');
  const name = args.shift();
  if (!name) throw new Error(`records: which table? ${tableList(store.schema.tables)}`);
  const table = store.schema.tables.find((t) => t.name === name);
  if (!table) throw new Error(`records: no table named "${name}". ${tableList(store.schema.tables)}`);
  const q = (n: string) => '"' + n.replace(/"/g, '""') + '"';
  const have = new Set((store.sql.prepare(`PRAGMA table_info(${q(table.name)})`).all() as { name: string }[]).map((c) => c.name));
  const fields = table.fields.filter((f) => have.has(f.name));
  if (format === 'csv') console.log(['recordId', ...fields.map((f) => f.name)].map(csvCell).join(','));
  const rows = store.sql.prepare(`SELECT _fm_record_id AS _rid, ${fields.map((f) => q(f.name)).join(', ') || '1'} FROM ${q(table.name)} ORDER BY _fm_record_id${Number.isFinite(limit) ? ' LIMIT ' + Math.max(0, Math.floor(limit)) : ''}`).all() as Record<string, unknown>[];
  for (const r of rows) {
    if (format === 'csv') console.log([r._rid, ...fields.map((f) => r[f.name])].map(csvCell).join(','));
    else console.log(JSON.stringify({ recordId: r._rid, fields: Object.fromEntries(fields.map((f) => [f.name, r[f.name]])) }));
  }
  return 0;
}

function bool(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}

/** The value after an option that takes one, left in args; an option that ends the line or is followed by another option has none. */
function optionValue(args: string[], name: string, what: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('-')) throw new Error(`${name} needs ${what}`);
  return v;
}

function expiryDays(args: string[], command: string): string | undefined {
  const error = () => new Error(`${command}: --expires-days takes a number of days above zero, or 0 (or "never") for no expiry`);
  let days: string | undefined;
  try { days = strictFlag(args, '--expires-days'); } catch { throw error(); }
  if (days === 'never') return '0';
  if (days !== undefined && !/^\d+(\.\d+)?$/.test(days)) throw error();
  return days;
}

/** Commands that open a .fmp12 file: anything else with a file after it is a mistyped command, not a missing file. */
const FILE_COMMANDS = new Set(['info', 'design-text', 'ddr', 'style-census', 'schema', 'records', 'optimize', 'export', 'dump']);

/** The sheets of the files named: CSV files and Excel sheets as they are, and a folder of Notion Markdown pages as one sheet. */
function readImportSheets(files: string[]): SheetInput[] {
  const sheets: SheetInput[] = [];
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`import-tables: ${file} doesn't exist`);
    const info = statSync(file);
    if (info.isDirectory()) {
      const pages = readdirSync(file).filter((n) => /\.md$/i.test(n)).sort().map((n) => ({ file: n, text: readFileSync(join(file, n), 'utf8') }));
      if (!pages.length) throw new Error(`import-tables: ${file} holds no .md pages`);
      sheets.push(notionMarkdownSheet(sheetNameOf(file.replace(/[\\/]+$/, '')), pages));
      continue;
    }
    if (info.size > 256 * 1024 * 1024) throw new Error(`import-tables: ${file} is over 256 MB`);
    try {
      sheets.push(...sheetsFromFile(basename(file), readFileSync(file)));
    } catch (e) {
      throw new Error(`import-tables: ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    checkSheetNames(sheets);
  } catch (e) {
    throw new Error(`import-tables: ${(e as Error).message}`);
  }
  return sheets;
}

function counts(s: Schema): Record<string, number> {
  return {
    tables: s.tables.length,
    fields: s.tables.reduce((n, t) => n + t.fields.length, 0),
    tableOccurrences: s.tableOccurrences.length,
    layouts: s.layouts.length,
    scripts: s.scripts.length,
    valueLists: s.valueLists.length,
    customFunctions: s.customFunctions.length,
    accounts: s.accounts.length,
    privilegeSets: s.privilegeSets.length,
    dataSources: s.dataSources.length,
  };
}

function printSchema(s: Schema): void {
  const out: string[] = [];
  out.push(`Created by FileMaker ${s.header.creator} (${s.header.versionDate})`, '');
  for (const t of s.tables) {
    out.push(`Table ${t.name}  [id ${t.id}]`);
    for (const f of t.fields) {
      const kind = f.kind === 'normal' ? '' : ` ${f.kind}`;
      const note = f.comment ? `  // ${f.comment}` : '';
      out.push(`  ${f.name.padEnd(32)} ${f.type}${kind}${note}`);
    }
    out.push('');
  }
  const list = (title: string, names: string[]) => {
    if (!names.length) return;
    out.push(`${title} (${names.length})`);
    for (const n of names) out.push(`  ${n}`);
    out.push('');
  };
  list('Table occurrences', s.tableOccurrences.map((t) => {
    const base = s.tables.find((b) => b.id === t.baseTableId)?.name;
    return base && base !== t.name ? `${t.name} -> ${base}` : t.name;
  }));
  list('Layouts', s.layouts.map((l) => {
    const to = s.tableOccurrences.find((t) => t.id === l.tableOccurrenceId)?.name;
    return to ? `${l.name}  (${to})` : l.name;
  }));
  list('Scripts', s.scripts.map((sc) => `${sc.name}  (${sc.steps.length} steps)`));
  list('Value lists', s.valueLists.map((v) => (v.values ? `${v.name}: ${v.values.join(', ')}` : v.name)));
  list('Custom functions', s.customFunctions.map((c) => `${c.name} ( ${c.parameters.join(' ; ')} )`));
  list('Accounts', s.accounts.map((a) => a.name));
  list('Privilege sets', s.privilegeSets.map((p) => p.name));
  list('External data sources', s.dataSources.map((d) => `${d.name}: ${d.paths.join(', ')}`));
  console.log(out.join('\n'));
}

/** `tabularius privileges`: list, show, save, assign, grant and revoke. */
function privileges(store: Store, action?: string, a?: string, b?: string): void {
  const set = (name?: string) => {
    const s = name && store.privilegeSet(name);
    if (!s) throw new Error(`no privilege set "${name ?? ''}"; sets: ${store.privilegeSets().map((p) => p.name).join(', ')}`);
    return s;
  };
  switch (action) {
    case undefined: {
      const level = (l: string) => (l === 'viewOnly' ? 'view only' : l);
      const rule = (r: boolean | string) => (r === true ? 'yes' : r === false ? 'no' : `limited: ${r}`);
      console.log('Accounts');
      for (const acc of store.accounts()) console.log(`  ${acc.name.padEnd(24)} ${(acc.privilegeSet ?? '(no privilege set)').padEnd(24)} ${acc.external ? 'external (identity provider)' : acc.hasPassword ? '' : 'no password yet'}${acc.mustChange ? ' [must change password]' : ''}`);
      console.log('\nPrivilege sets');
      for (const p of store.privilegeSets()) {
        const r = p.records;
        console.log(`  ${p.name}${p.comment ? `  // ${p.comment}` : ''}`);
        console.log(`    records: view ${rule(r.view)}, edit ${rule(r.edit)}, create ${rule(r.create)}, delete ${rule(r.delete)}${p.tables ? ` (custom for ${Object.keys(p.tables).length} tables)` : ''}`);
        // Fields shown only as a stand-in are counted apart from hidden ones.
        const masked = [p.records, ...Object.values(p.tables ?? {})].reduce((n, t) => n + Object.values(t.fields ?? {}).filter((l) => l === 'masked').length, 0);
        if (masked) console.log(`    ${masked} masked ${masked === 1 ? 'field' : 'fields'} (shows a stand-in, never the value)`);
        console.log(`    layouts ${level(p.layouts)}, value lists ${level(p.valueLists)}, scripts ${p.scripts === 'viewOnly' ? 'executable only' : p.scripts}`);
        console.log(`    extended privileges: ${p.extendedPrivileges.join(', ') || '(none)'}`);
      }
      return;
    }
    case 'show':
      console.log(JSON.stringify(set(a), null, 2));
      return;
    case 'save': {
      if (!a) throw new Error('privileges save: give a JSON file');
      console.log(`saved ${store.savePrivilegeSet(JSON.parse(readFileSync(a, 'utf8'))).name}`);
      return;
    }
    case 'account':
      if (!a || !b) throw new Error('privileges account: give an account and a privilege set');
      store.setAccountPrivilegeSet(a, b);
      console.log(`${a} now uses ${set(b).name}`);
      return;
    case 'external':
      if (!a || !b) throw new Error('privileges external: give a group or email address and a privilege set');
      store.setExternalAccount(a, set(b).name);
      console.log(`people the identity provider signs in as ${a} now use ${set(b).name}`);
      return;
    case 'policy': {
      const describe = () => {
        const p = store.passwordPolicy();
        const min = store.minPasswordLength();
        console.log(`password policy: minimum length ${min || 'none'}${p.minLength === undefined && min ? ' (the server\'s default; set 0 for none)' : ''}, maximum age ${p.maxAgeDays ? p.maxAgeDays + ' days' : 'none'}`);
      };
      if (a === undefined && b === undefined) { describe(); return; }
      const num = (v?: string) => (v === undefined ? undefined : Number(v));
      store.setPasswordPolicy({ minLength: num(a), maxAgeDays: num(b) });
      describe();
      return;
    }
    case 'must-change': {
      if (!a) throw new Error('privileges must-change: give an account (and optionally "off")');
      const on = b === undefined || /^(on|true|yes)$/i.test(b);
      if (!store.setMustChangePassword(a, on)) throw new Error(`no account "${a}"`);
      console.log(`${a} ${on ? 'must change its password on next sign-in' : 'no longer needs to change its password'}`);
      return;
    }
    case 'grant':
    case 'revoke': {
      const s = set(a);
      if (!b) throw new Error(`privileges ${action}: give an extended privilege keyword (fmrest, fmapp, fmwebdirect, fmmcp, ...)`);
      const others = s.extendedPrivileges.filter((e) => e.toLowerCase() !== b.toLowerCase());
      if (action === 'revoke' && others.length === s.extendedPrivileges.length) throw new Error(`${s.name} had no extended privilege "${b}"`);
      // Custom keywords exist, so an unknown one is still granted: but a typo (fmrset) would otherwise pass without a word.
      if (action === 'grant') {
        const known = new Set<string>([...BUILT_IN_EXTENDED_PRIVILEGES, ...store.privilegeSets().flatMap((p) => p.extendedPrivileges)].map((e) => e.toLowerCase()));
        if (!known.has(b.toLowerCase())) console.error(`warning: "${b}" is not ${BUILT_IN_EXTENDED_PRIVILEGES.join(', ')} or a keyword another privilege set has; granted anyway; if that was a typo, take it back with: privileges revoke ${s.name} ${b}`);
      }
      store.savePrivilegeSet({ ...s, extendedPrivileges: action === 'grant' ? [...others, b] : others });
      console.log(`${action === 'grant' ? 'granted' : 'revoked'} ${b} ${action === 'grant' ? 'to' : 'from'} ${s.name}`);
      return;
    }
  }
  throw new Error(`privileges: unknown action "${action}"`);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('\x1d') : String(v);
  return csvField(s);
}

/** Finishes a command's work after main returns: an error is printed and fails the command. */
/** What went wrong in a sentence a person can act on: file system codes and a cut-short FileMaker file named, not left as raw text. */
function tableList(tables: readonly { name: string }[]): string {
  return tables.length ? `Tables: ${tables.map((t) => t.name).join(', ')}` : 'This file has no tables yet (tabularius design-apply adds them from a folder of text files)';
}

function plainError(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  const at = err.path ? ` ${err.path}` : '';
  if (err.code === 'ENOENT') return `no such file or folder:${at || ' (check the name and the folder)'}`;
  if (err.code === 'EACCES' || err.code === 'EPERM') return `this user isn't allowed to open${at || ' that'}. Check its permissions`;
  if (err.code === 'EISDIR') return `${err.path ?? 'that'} is a folder, not a file`;
  if (err.code === 'ENOTDIR') return `${err.path ?? 'that'} is not a folder`;
  if ((err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') && err.syscall === 'getaddrinfo') return `the address "${(err as { hostname?: string }).hostname ?? 'given'}" was not found. Use an IP address of this computer (127.0.0.1 for this computer only, 0.0.0.0 for every network) or a name that resolves`;
  if (err.code === 'EADDRNOTAVAIL') return `this computer has no network address ${(err as { address?: string }).address ?? 'like that'}. Use 127.0.0.1 for this computer only, 0.0.0.0 for every network, or one of this computer's own addresses`;
  if (/^block \d+ out of range$/.test(err.message ?? '')) return `${err.message}: the file looks damaged or cut short. Copy it again from where it came from`;
  return err.message ?? String(e);
}

function later(work: Promise<unknown>): void {
  work.catch((e) => {
    process.stderr.write(`error: ${plainError(e)}\n`);
    process.exitCode = 1;
  });
}

/** A design as text files: a folder design-text wrote, a FileMaker file (read into a scratch copy) or a hosted file. Nothing is changed. */
function designFilesOf(path: string): Map<string, string> {
  const at = resolve(path);
  if (!existsSync(at)) throw new Error(`design-diff: ${at} doesn't exist`);
  if (statSync(at).isDirectory()) return readDesignFolder(at);
  let scratch: string | undefined;
  try {
    let file = at;
    if (/\.fmp12$/i.test(at)) {
      scratch = mkdtempSync(join(tmpdir(), 'tabularius-design-diff-'));
      file = join(scratch, 'design.openhbam.sqlite');
      importFmp12(at, file);
    } else if (!/\.sqlite$/i.test(at)) throw new Error(`design-diff: ${at} is neither a folder, a .fmp12 file nor a hosted .openhbam.sqlite file`);
    const store = new Store(file, basename(at));
    try {
      return designText({ schema: store.schema, layouts: store.designs().layouts, accounts: store.accounts(), privilegeSets: store.privilegeSets() });
    } finally {
      store.close();
    }
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

/** `tabularius service ...` and `tabularius upgrade` (service.ts). */
/** Why a folder can't be hosted, in a sentence that says what to do; undefined when it can. */
function hostFolderProblem(folder: string): string | undefined {
  if (!existsSync(folder)) return `${folder} doesn't exist. Make the folder, or give the folder your files are in`;
  if (!statSync(folder).isDirectory()) return `${folder} is a file. Give the folder it is in`;
  try { accessSync(folder, constants.R_OK | constants.W_OK); } catch { return `${folder} can't be read and written by this user. Give this user permission to it, or choose another folder`; }
  return undefined;
}

function serviceCommand(cmd: string, args: string[]): number {
  const fail = (e: unknown) => {
    process.stderr.write(`error: ${plainError(e)}\n`);
    process.exitCode = 1;
  };
  if (cmd === 'upgrade') {
    const backup = !bool(args, '--no-backup');
    const wait = flag(args, '--wait');
    const from = flag(args, '--from');
    upgrade({
      ...(wait ? { waitMs: Number(wait) * 1000 } : {}),
      ...(from ? { from } : {}),
      backup: backup ? async (folder, extra) => {
        const i = extra.indexOf('--backup-dir');
        return (await backupFolder(folder, i >= 0 ? extra[i + 1] : defaultBackupDir(folder), 0)).dir;
      } : undefined,
    }).catch(fail);
    return 0;
  }
  const action = args.shift();
  const platform = (flag(args, '--platform') ?? process.platform) as Platform;
  if (!['darwin', 'linux', 'win32'].includes(platform)) throw new Error(`service: ${platform} has no service manager Tabularius knows`);
  const base = defaults(platform);
  if (action === 'uninstall') {
    uninstallService(base);
    return 0;
  }
  if (action !== 'install' && action !== 'print') {
    process.stderr.write(`service: ${action ? `"${action}" is not something service does` : 'say what to do'} (install, uninstall or print).\n\n${USAGE}`);
    return 1;
  }
  const dash = args.indexOf('--');
  const extra = dash >= 0 ? args.splice(dash).slice(1) : [];
  const o: ServiceOptions = {
    ...base,
    port: Number(flag(args, '--port') ?? 8080),
    // This computer only unless told otherwise: reaching it from the network is a choice made with --host (and HTTPS).
    host: flag(args, '--host') ?? defaultServiceHost(extra),
    system: bool(args, '--system'),
    folder: '',
    extra,
  };
  const folder = args.shift();
  if (!folder) throw new Error(`service ${action}: which folder should it host?`);
  o.folder = platform === process.platform ? resolve(folder) : folder;
  // An option that is none of the service's is for `serve`; dropping it silently would start a service that isn't what was asked for.
  const stray = args.find((a) => a.startsWith('--'));
  if (stray) throw new Error(`service ${action}: ${stray} is not an option of service ${action}. Options for serve go after "--", for example: tabularius service ${action} ${o.folder} -- ${stray} ...`);
  validateServicePublicUrl(o.extra);
  const plainProblem = servicePlainRefusal(o);
  if (plainProblem) throw new Error(`service ${action}: ${plainProblem}`);
  const folderProblem = action === 'install' ? hostFolderProblem(o.folder) : undefined;
  if (folderProblem) throw new Error(`service install: ${folderProblem}`);
  if (action === 'print') process.stdout.write(serviceFile(o, platform !== process.platform).text);
  else if (platform !== process.platform) installService(o);
  else later(checkPort(o).then(() => installService(o)));
  return 0;
}

/** The browser opened at a page, where the system has a way to. */
function openBrowser(url: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => console.log(`Open ${url} in your browser`));
  child.unref();
}

/** A free port on this machine, from `from` up. */
async function freePort(from: number): Promise<number> {
  for (let port = from; port < from + 50; port++) {
    const free = await new Promise<boolean>((done) => {
      const probe = createNetServer().once('error', () => done(false)).once('listening', () => probe.close(() => done(true)));
      probe.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error(`no free port from ${from}`);
}

/**
 * `tabularius` on its own: hosts a folder in your home folder (made if need
 * be) for this computer only, and opens the admin console in the browser at
 * its welcome, where a FileMaker file dropped on the page is converted,
 * hosted and opened in the web client.
 */
async function firstRun(): Promise<void> {
  const folder = process.env.TABULARIUS_FOLDER ?? join(homedir(), 'tabularius');
  mkdirSync(folder, { recursive: true });
  const port = await freePort(Number(process.env.PORT ?? 8080));
  console.log(`tabularius: hosting ${folder} on this computer. Drop .fmp12 files on the page that opens, or into that folder. Ctrl-C stops it.`);
  process.exitCode = main(['serve', folder, '--port', String(port), '--open']);
}

/** The usage lines of one command (every line naming it, with their notes), or all of them. */
export function commandUsage(cmd: string): string {
  const lines = USAGE.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp(`^  tabularius ${cmd.replace(/[^\w-]/g, '')}(\\s|$)`).test(lines[i])) continue;
    out.push(lines[i]);
    while (i + 1 < lines.length && /^ {4,}\S/.test(lines[i + 1])) out.push(lines[++i]);
  }
  return out.length ? `Usage:\n${out.join('\n')}\n` : USAGE;
}

function unknownCommand(cmd: string): string {
  return `unknown command ${cmd}\n\nRun tabularius --help for the commands.\n`;
}

/** `tabularius corpus-scan <folder>` (corpus-scan.ts); `--one <file>` is one file's scan, run in its own process. */
function corpusScanCommand(args: string[]): number {
  const convert = bool(args, '--convert');
  const dedupeOnly = bool(args, '--dedupe-only');
  const all = bool(args, '--all');
  if (bool(args, '--one')) {
    const [file] = args;
    if (!file) throw new Error('corpus-scan --one: give a file');
    process.stdout.write(JSON.stringify(scanFile(file, { convert, onProgress: (p) => process.stderr.write('tabularius-scan-progress ' + JSON.stringify(p) + '\n') })));
    return 0;
  }
  const out = resolve(flag(args, '--out') ?? 'corpus-report');
  const jobs = flag(args, '--jobs');
  const timeout = flag(args, '--timeout');
  const only = flag(args, '--only');
  const list = flag(args, '--list');
  const [dir] = args;
  if (!dir && !list) throw new Error('corpus-scan: give a folder of .fmp12 files, or --list FILE');
  later(corpusScan(resolve(dir ?? '.'), {
    out, convert, dedupeOnly, all, only, list: list && resolve(list), entry: process.argv[1],
    jobs: jobs ? Number(jobs) : undefined,
    timeoutSeconds: timeout ? Number(timeout) : undefined,
    log: (line) => process.stderr.write(line + '\n'),
  }).then((r) => {
    if (dedupeOnly) return;
    console.log(`${r.files.found} files, ${r.files.unique} unique: ${Object.entries(r.status).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    console.log(`wrote ${join(out, 'corpus-report.json')} and corpus-report.md`);
  }));
  return 0;
}

/** `tabularius demo` (demo.ts): serves a starter app for this computer only until stopped, then deletes it. */
function demoCommand(args: string[]): number {
  const starter = flag(args, '--starter');
  const keep = flag(args, '--keep');
  const host = flag(args, '--host');
  const portText = flag(args, '--port');
  const open = !bool(args, '--no-open');
  const extra = args.filter((a) => a.length);
  if (extra.length) throw new Error(`demo: ${extra[0].startsWith('-') ? `unknown option ${extra[0]}` : `takes no folder or file (found ${extra[0]}); it makes its own`}`);
  if ((starter !== undefined && starter.startsWith('-')) || (keep !== undefined && keep.startsWith('-')) || (host !== undefined && host.startsWith('-'))) throw new Error('demo: an option is missing its value');
  const port = portText === undefined ? undefined : Number(portText);
  if (portText !== undefined && !(Number.isInteger(port) && port! >= 0 && port! < 65536)) throw new Error(`demo: --port takes a port number, not "${portText}"`);
  later(startDemo({ starter, keep, host, port, log: (line) => console.log(line) }).then((demo) => {
    console.log(`tabularius demo: the ${demo.database} starter with sample records, on this computer only.`);
    console.log('');
    console.log(`  Open      ${demo.app}`);
    console.log(`  Sign in   ${demo.account}`);
    console.log(`  Password  ${demo.password}`);
    console.log('');
    console.log(demo.kept ? `The files are in ${demo.folder} and stay there. Press Ctrl-C to stop.` : 'Nothing is kept: the files are deleted when you press Ctrl-C. The password is shown only here.');
    if (open) openBrowser(demo.app);
    const stop = () => void demo.stop().finally(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }));
  return 0;
}

function main(argv: string[]): number {
  const args = argv.slice();
  const cmd = args.shift();
  if (!cmd) {
    firstRun().catch((e) => {
      process.stderr.write(`error: ${plainError(e)}\n`);
      process.exitCode = 1;
    });
    return 0;
  }
  if (cmd === '-h' || cmd === '--help') {
    process.stdout.write(USAGE);
    return 0;
  }
  // --help on a command prints its usage and does nothing else (options after -- belong to serve).
  const own = args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
  if (own.includes('--help') || own.includes('-h')) {
    process.stdout.write(commandUsage(cmd));
    return 0;
  }
  if (cmd === 'help') {
    const [topic] = args;
    if (topic && commandUsage(topic) === USAGE && !args.includes('--')) {
      process.stderr.write(unknownCommand(topic));
      return 1;
    }
    process.stdout.write(topic ? commandUsage(topic) : USAGE);
    return 0;
  }
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    process.stdout.write(versionText());
    return 0;
  }
  if (cmd === 'service' || cmd === 'upgrade') return serviceCommand(cmd, args);
  if (cmd === 'corpus-scan') return corpusScanCommand(args);
  if (cmd === 'pair-tokens') {
    if (args.length !== 2 || args.some((a) => a.startsWith('-'))) throw new Error('pair-tokens: give <file.fmp12> <clipboard.xml>');
    process.stdout.write(JSON.stringify(pairTokenFile(args[0], args[1]), null, 2) + '\n');
    return 0;
  }
  if (cmd === 'design-diff') {
    const [before, after] = args.filter((a) => !a.startsWith('--'));
    if (!before || !after) throw new Error('design-diff: give two designs to compare: each a folder design-text wrote, a .fmp12 file or a hosted .openhbam.sqlite file');
    const diff = diffDesigns(designFilesOf(before), designFilesOf(after));
    process.stdout.write(diff.lines.join('\n') + '\n');
    if (diff.changes) process.stdout.write(`\n${diff.changes === 1 ? '1 object differs' : `${diff.changes} objects differ`}\n`);
    return args.includes('--exit-code') && diff.changes ? 1 : 0;
  }
  if (cmd === 'api-types') {
    if (args.length) throw new Error('api-types: takes no arguments; redirect the output to a file: tabularius api-types > tabularius-api.d.ts');
    process.stdout.write(typesFromOpenApi(openApiDocument()));
    return 0;
  }
  if (cmd === 'demo') return demoCommand(args);
  if (cmd === 'doctor') {
    // flag() takes its pair out of args, so each is read once, before the folder is picked from what is left.
    const port = flag(args, '--port');
    const url = flag(args, '--url');
    if (args.includes('--exposure')) {
      // What a running server is open to; asks it like a stranger would (no password), and reads the installed service's options.
      const sqlPort = flag(args, '--sql-port');
      runExposure({ ...(url ? { url } : {}), ...(port ? { port: Number(port) } : {}), ...(sqlPort ? { sqlPort: Number(sqlPort) } : {}), service: installed() }).then((checks) => {
        process.stdout.write(doctorText(checks));
        if (checks.some((c) => c.level === 'problem')) process.exitCode = 1;
      }, (e) => { process.stderr.write(`error: ${plainError(e)}\n`); process.exitCode = 1; });
      return 0;
    }
    const embedUrl = flag(args, '--ai-embed-url');
    const embedModel = flag(args, '--ai-embed-model');
    const full = args.includes('--full');
    const folder = args.find((a) => !a.startsWith('--')) ?? '.';
    runDoctor(resolve(folder), { full, ...(port ? { port: Number(port) } : {}), url, embedUrl, embedModel }).then((checks) => {
      process.stdout.write(doctorText(checks));
      if (checks.some((c) => c.level === 'problem')) process.exitCode = 1;
    }, (e) => { process.stderr.write(`error: ${plainError(e)}\n`); process.exitCode = 1; });
    return 0;
  }
  if (cmd === 'diagnostics') {
    const out = flag(args, '--out');
    if (out?.startsWith('--')) { process.stderr.write(`diagnostics: --out needs a file name or folder, found ${out}\n`); return 1; }
    const includeNames = args.includes('--include-names');
    const full = args.includes('--full');
    const folder = args.find((a) => !a.startsWith('--')) ?? '.';
    const now = new Date();
    diagnostics(folder, { includeNames, full, now }).then((bundle) => {
      // Not into the hosted folder: a bundle left there would be served beside the files.
      const here = resolve(defaultBundleName(now));
      const target = out ?? (dirname(here) === resolve(folder) ? join(homedir(), defaultBundleName(now)) : defaultBundleName(now));
      const written = writeBundle(bundle, target, now);
      process.stdout.write(`wrote ${written}\n\nIt is plain text. Open it and read it before you send it: it holds no records, passwords, tokens, file names${includeNames ? ' (apart from the hosted file names you asked for)' : ''} or addresses, and says in README.txt what it does hold.\n`);
    }, (e) => { process.stderr.write(`error: ${plainError(e)}\n`); process.exitCode = 1; });
    return 0;
  }
  const path = args.shift();
  if (!path) {
    // A command with nothing to work on gets its own usage lines; a mistyped command, a hint, not the whole list.
    const own = commandUsage(cmd);
    process.stderr.write(own === USAGE ? unknownCommand(cmd) : `${cmd}: give a file or folder\n\n${own}`);
    return 1;
  }
  // An option where the folder or file goes means the folder was left out: say that, not "no such folder --port".
  if (path.startsWith('-') && commandUsage(cmd) !== USAGE) {
    process.stderr.write(`${cmd}: give a file or folder first, before the options (found ${path})\n\n${commandUsage(cmd)}`);
    return 1;
  }
  switch (cmd) {
    case 'serve': {
      const folderProblem = hostFolderProblem(path);
      if (folderProblem) throw new Error(`serve: ${folderProblem}`);
      const publicUrl = flag(args, '--public-url') ?? process.env.TABULARIUS_PUBLIC_URL;
      validatePublicUrl(publicUrl);
      // Opens the admin console's welcome in the browser once it is serving (what `tabularius` on its own does).
      const openPage = bool(args, '--open');
      // HTTPS with a certificate got automatically: public, so on 443 and every address unless told otherwise.
      const httpsFlag = flag(args, '--https') ?? process.env.TABULARIUS_HTTPS;
      // --https local: a certificate from the folder's own authority, for a local network (local-tls.ts).
      const localHttps = httpsFlag === 'local' || httpsFlag === 'lan';
      const https = localHttps ? undefined : httpsFlag;
      const acme = https ? {
        domains: https.split(',').map((d) => d.trim()).filter(Boolean),
        email: flag(args, '--https-email') ?? process.env.TABULARIUS_HTTPS_EMAIL,
        directory: flag(args, '--acme-directory') ?? process.env.TABULARIUS_ACME_DIRECTORY,
        httpPort: Number(flag(args, '--http-port') ?? process.env.TABULARIUS_HTTP_PORT ?? 80),
      } : undefined;
      const portFlag = flag(args, '--port');
      const portText = portFlag ?? process.env.PORT ?? (acme ? 443 : 8080);
      const port = Number(portText);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`serve: ${portFlag !== undefined ? '--port' : 'the PORT variable'} takes a port number from 1 to 65535, not "${portText}"`);
      const hostname = flag(args, '--host') ?? process.env.TABULARIUS_HOST ?? (acme ? '0.0.0.0' : '127.0.0.1');
      const mcpToken = tokenOption(args, '--mcp-token', '--mcp-token-file', process.env.TABULARIUS_MCP_TOKEN, process.env.TABULARIUS_MCP_TOKEN_FILE, 'serve').value;
      // Scripts stay offline unless asked: Insert from URL could reach mail, SMS or payment services.
      const scriptNetwork = bool(args, '--allow-script-network');
      // Scripts' requests never reach this machine's own network (loopback, 10/8, 192.168/16 and so on) unless listed here.
      optionValue(args, '--allow-script-network-to', 'hosts, addresses or ranges (intranet.example,*.corp.example,10.0.0.0/8)');
      const scriptNetworkAllow = (flag(args, '--allow-script-network-to') ?? '').split(',').map((h) => h.trim()).filter(Boolean);
      try {
        parseAllowList(scriptNetworkAllow);
      } catch (e) {
        throw new Error(`serve: --allow-script-network-to: ${(e as Error).message}`);
      }
      const listFilesPublicly = bool(args, '--list-files-publicly') || /^(1|true|yes|on)$/i.test(process.env.TABULARIUS_LIST_FILES_PUBLICLY ?? '');
      const appConnections = bool(args, '--allow-app-connections');
      // Webhooks set up in the admin console send nothing until this is given.
      const webhooks = bool(args, '--allow-webhooks');
      // Inbound hooks set up in the admin console answer calls only when this is given.
      const inboundHooks = bool(args, '--allow-inbound-hooks');
      // Before the test-mode flags: --capture-only is read here too.
      const sendMail = mailFlags(args, 'serve');
      const testOutbound = outboundFlags(args, 'serve');
      // Settings kept in the folder (migrate-fms writes them) apply when no flag or variable gives one.
      const settings = readSettings(path);
      let tlsCert = flag(args, '--tls-cert') ?? (https || localHttps ? undefined : settings.tlsCert);
      let tlsKey = flag(args, '--tls-key') ?? (https || localHttps ? undefined : settings.tlsKey);
      if (!tlsCert !== !tlsKey) throw new Error('serve: give both --tls-cert and --tls-key');
      if (localHttps) {
        if (tlsCert) throw new Error('serve: --https local makes its own certificate; leave out --tls-cert and --tls-key');
        const local = localCertificateFiles(path);
        tlsCert = local.certPath;
        tlsKey = local.keyPath;
        console.log(`HTTPS with this server's own certificate${local.tls.renewed ? ' (made now)' : ''}, for ${local.tls.names.join(', ')}`);
        console.log(`  each device trusts it once: open https://<this server>:<port>/tabularius/tls/ (fingerprint ${local.tls.fingerprint})`);
      }
      if (acme && tlsCert) throw new Error('serve: --https gets its own certificate; leave out --tls-cert and --tls-key');
      // Plain HTTP beyond this computer sends passwords and session tokens in the clear: refused unless said to be wanted.
      const allowPlainHttp = bool(args, '--allow-plain-http') || /^(1|true|yes|on)$/i.test(process.env.TABULARIUS_ALLOW_PLAIN_HTTP ?? '');
      const plainRefusal = plainHttpRefusal({ host: hostname, secure: !!tlsCert || !!acme, allowed: allowPlainHttp });
      if (plainRefusal) throw new Error(`serve: ${plainRefusal}`);
      const mcpAllowedOrigins = mcpOriginsFrom(args);
      const proxyHeaderName = flag(args, '--proxy-header') ?? process.env.TABULARIUS_PROXY_HEADER;
      const proxyHeader = proxyHeaderName ? checkedProxyHeader(proxyHeaderName) : undefined;
      const hasTrustedProxies = args.includes('--trusted-proxies');
      const trustedProxiesValue = flag(args, '--trusted-proxies') ?? process.env.TABULARIUS_TRUSTED_PROXIES;
      if (hasTrustedProxies && !trustedProxiesValue?.trim()) throw new Error('--trusted-proxies needs an IP address or CIDR list');
      const trustedProxies = trustedProxiesValue === undefined ? [] : trustedProxiesValue.split(',').map((v) => v.trim());
      trustedProxyAddresses(trustedProxies);
      const connectionCap = flag(args, '--connections-per-address') ?? process.env.TABULARIUS_CONNECTIONS_PER_ADDRESS;
      if ((args.includes('--connections-per-address') || connectionCap !== undefined)
        && (!connectionCap || !/^\d+$/.test(connectionCap) || !Number.isSafeInteger(Number(connectionCap)) || Number(connectionCap) < 1)) {
        throw new Error('--connections-per-address / TABULARIUS_CONNECTIONS_PER_ADDRESS must be a positive whole number');
      }
      const edgeLimits = connectionCap === undefined ? undefined : { connectionsPerAddress: Number(connectionCap) };
      const unrestrictedProxies = trustedProxies.filter((value) => Number(value.split('/')[1]) === 0);
      if (unrestrictedProxies.length) {
        console.warn(`Warning: --trusted-proxies includes ${unrestrictedProxies.join(', ')}; this trusts every address in those IP families to supply client addresses. Restrict it to your proxy IPs or networks.`);
      }
      const every = flag(args, '--backup-every') ?? process.env.TABULARIUS_BACKUP_EVERY ?? settings.backupEvery ?? '1d';
      const keepFlag = flag(args, '--keep');
      const keepText = keepFlag ?? process.env.TABULARIUS_BACKUP_KEEP ?? settings.keep ?? 7;
      const keep = Number(keepText);
      if (!Number.isFinite(keep) || keep < 1) {
        const from = keepFlag !== undefined ? '--keep' : process.env.TABULARIUS_BACKUP_KEEP !== undefined ? 'TABULARIUS_BACKUP_KEEP' : `"keep" in ${join(path, '.openhbam-settings.json')}`;
        throw new Error(`serve: ${from} is the number of backups to keep, a whole number of 1 or more, not "${keepText}"`);
      }
      const dest = flag(args, '--backup-dir') ?? process.env.TABULARIUS_BACKUP_DIR ?? settings.backupDir;
      const backups = bool(args, '--no-backups') || every === 'off' ? undefined : { every: parseInterval(every), keep, dest };
      // Off-site: the backups folder mirrored to S3-compatible storage.
      const s3Url = flag(args, '--backup-s3') ?? process.env.TABULARIUS_BACKUP_S3;
      const offsite = s3Url ? s3FromEnv(s3Url, flag(args, '--s3-endpoint'), flag(args, '--s3-region')) : undefined;
      // Point-in-time backups: the changes every few minutes, on top of a full backup at start.
      const statsFlag = flag(args, '--stats-interval') ?? process.env.TABULARIUS_STATS_INTERVAL;
      const statsInterval = statsFlag === undefined ? undefined : parseStatsInterval(statsFlag);
      const logLimitText = flag(args, '--log-limit') ?? process.env.TABULARIUS_LOG_LIMIT ?? settings.logLimit;
      const logLimit = logLimitText === undefined ? undefined : parseLogLimit(logLimitText);
      const progressiveEvery = flag(args, '--progressive') ?? process.env.TABULARIUS_PROGRESSIVE;
      const progressive = progressiveEvery && progressiveEvery !== 'off' ? { every: parseInterval(progressiveEvery) } : undefined;
      // PostgreSQL clients: BI tools and ODBC/JDBC drivers, read-only unless --sql-writes.
      const sqlPortText = flag(args, '--sql-port') ?? process.env.TABULARIUS_SQL_PORT;
      const sqlPort = sqlPortText ? Number(sqlPortText) : undefined;
      if (sqlPort !== undefined && !(Number.isInteger(sqlPort) && sqlPort >= 0 && sqlPort < 65536)) throw new Error('serve: --sql-port must be a port number');
      const sqlWrites = bool(args, '--sql-writes') || /^(1|true|yes|on)$/i.test(process.env.TABULARIUS_SQL_WRITES ?? '');
      if (sqlWrites && sqlPort === undefined) throw new Error('serve: --sql-writes lets the SQL port write, so it needs --sql-port (or TABULARIUS_SQL_PORT)');
      // Standby servers follow this one's changes, signing in with this token.
      const { value: replicationToken, file: replicationTokenFile } = tokenOption(args, '--replication-token', '--replication-token-file', process.env.TABULARIUS_REPLICATION_TOKEN, process.env.TABULARIUS_REPLICATION_TOKEN_FILE, 'serve');
      if (replicationToken !== undefined && replicationToken.length < 16) throw new Error('serve: --replication-token must be at least 16 characters');
      // A folder that was a standby's has its API tokens ended at takeover, as it may hold ones the main server had revoked.
      const keepApiTokensOnTakeover = bool(args, '--keep-api-tokens-on-takeover');
      const acceptPartialStandbyFiles = bool(args, '--accept-partial-standby');
      // Sign-in through an identity provider (OpenID Connect) for external accounts.
      const issuer = flag(args, '--oidc-issuer') ?? process.env.TABULARIUS_OIDC_ISSUER;
      const clientId = flag(args, '--oidc-client-id') ?? process.env.TABULARIUS_OIDC_CLIENT_ID;
      if (!issuer !== !clientId) throw new Error('serve: give both --oidc-issuer and --oidc-client-id');
      const single = issuer && clientId ? {
        issuer, clientId,
        name: flag(args, '--oidc-name') ?? process.env.TABULARIUS_OIDC_NAME ?? new URL(issuer).hostname,
        clientSecret: process.env.TABULARIUS_OIDC_CLIENT_SECRET,
        groupsClaim: flag(args, '--oidc-groups-claim') ?? process.env.TABULARIUS_OIDC_GROUPS_CLAIM,
        ...(args.includes('--oidc-trust-email') || /^(?:1|true|yes)$/i.test(process.env.TABULARIUS_OIDC_TRUST_EMAIL ?? '') ? { trustEmail: true } : {}),
        // Data API apps (getoauthurl) people may be sent back to after signing in, besides this server and this computer.
        ...((returns) => returns ? { dataApiReturnUrls: returns.split(',').map((u) => u.trim()).filter(Boolean) } : {})(flag(args, '--oidc-data-api-return-urls') ?? process.env.TABULARIUS_OIDC_DATA_API_RETURN_URLS),
      } : undefined;
      // Several providers at once (e.g. Google, Microsoft and Apple) come from a
      // JSON file: an array of { name, issuer, clientId, ... } (see OidcProvider).
      const oidcConfig = flag(args, '--oidc-config') ?? process.env.TABULARIUS_OIDC_CONFIG;
      let fromFile: OidcProvider[] = [];
      if (oidcConfig) {
        const parsed = JSON.parse(readFileSync(oidcConfig, 'utf8'));
        fromFile = Array.isArray(parsed) ? parsed : [parsed];
        for (const p of fromFile) if (!p || !p.name || !p.issuer || !p.clientId) throw new Error('serve: each --oidc-config provider needs name, issuer and clientId');
      }
      const all = [...(single ? [single] : []), ...fromFile];
      const oidc = all.length === 0 ? undefined : all.length === 1 ? all[0] : all;
      // Sign-in through an LDAP directory or Active Directory for external accounts.
      const ldapUrl = flag(args, '--ldap-url') ?? process.env.TABULARIUS_LDAP_URL;
      const ldap = ldapUrl ? {
        url: ldapUrl,
        name: flag(args, '--ldap-name') ?? process.env.TABULARIUS_LDAP_NAME ?? new URL(ldapUrl).hostname,
        bindDnTemplate: flag(args, '--ldap-bind-dn-template') ?? process.env.TABULARIUS_LDAP_BIND_DN_TEMPLATE,
        searchDn: flag(args, '--ldap-search-dn') ?? process.env.TABULARIUS_LDAP_SEARCH_DN,
        searchPassword: process.env.TABULARIUS_LDAP_SEARCH_PASSWORD,
        baseDn: flag(args, '--ldap-base-dn') ?? process.env.TABULARIUS_LDAP_BASE_DN,
        userAttribute: flag(args, '--ldap-user-attribute') ?? process.env.TABULARIUS_LDAP_USER_ATTRIBUTE,
        emailAttribute: flag(args, '--ldap-email-attribute') ?? process.env.TABULARIUS_LDAP_EMAIL_ATTRIBUTE,
        groupAttribute: flag(args, '--ldap-group-attribute') ?? process.env.TABULARIUS_LDAP_GROUP_ATTRIBUTE,
      } : undefined;
      if (ldap && !ldap.bindDnTemplate && !ldap.baseDn) throw new Error('serve: --ldap-url needs either --ldap-bind-dn-template or --ldap-base-dn');
      // The AI assistant sends questions and what its tools read to the model provider: only when asked.
      const embedOptions = (a: string[]): { embedUrl?: string; embedModel?: string; embedKey?: string; imageEmbed?: { provider: string; model: string; key: string } } => {
        const img = resolveImageEmbed(flag(a, '--ai-image-embed') ?? process.env.TABULARIUS_AI_IMAGE_EMBED, flag(a, '--ai-image-embed-model') ?? process.env.TABULARIUS_AI_IMAGE_EMBED_MODEL, process.env.TABULARIUS_AI_IMAGE_EMBED_KEY);
        const imageEmbed = img ? { imageEmbed: { provider: img.provider.id, model: img.model, key: img.key } } : {};
        const e = resolveEmbedEndpoint(flag(a, '--ai-embed-url') ?? process.env.TABULARIUS_AI_EMBED_URL, flag(a, '--ai-embed-model') ?? process.env.TABULARIUS_AI_EMBED_MODEL, process.env.TABULARIUS_AI_EMBED_KEY);
        return e ? { embedUrl: e.url, embedModel: e.model, ...(e.key ? { embedKey: e.key } : {}), ...imageEmbed } : imageEmbed;
      };
      let ai: { apiKey: string; keySource?: 'environment' | 'file'; keyFile?: string; workspaceId?: string; workspaceFile?: string; model?: string; fastModel?: string; embedUrl?: string; embedModel?: string; embedKey?: string; imageEmbed?: { provider: string; model: string; key: string }; dailyTokens?: number; accountDailyTokens?: number; runTokens?: number; monthlyBudgetUsd?: number } | undefined;
      if (bool(args, '--ai')) {
        const { apiKey, source: keySource, keyFile, workspaceId, workspaceFile } = resolveAiKey(process.env, flag(args, '--ai-key-file') ?? process.env.TABULARIUS_AI_KEY_FILE, flag(args, '--ai-workspace-id') ?? process.env.TABULARIUS_AI_WORKSPACE_ID);
        const daily = flag(args, '--ai-daily-tokens') ?? process.env.TABULARIUS_AI_DAILY_TOKENS;
        if (daily !== undefined && !(Number(daily) > 0)) throw new Error('serve: --ai-daily-tokens needs a number of tokens, like 2000000');
        const perAccount = flag(args, '--ai-account-daily-tokens') ?? process.env.TABULARIUS_AI_ACCOUNT_DAILY_TOKENS;
        if (perAccount !== undefined && !(Number(perAccount) > 0)) throw new Error('serve: --ai-account-daily-tokens needs a number of tokens, like 200000');
        const perRun = flag(args, '--ai-run-tokens') ?? process.env.TABULARIUS_AI_RUN_TOKENS;
        if (perRun !== undefined && parseRunTokens(perRun) === undefined) throw new Error(`serve: --ai-run-tokens needs a whole number of tokens from 1 to ${MAX_RUN_TOKENS.toLocaleString('en-US')}, like 300000`);
        const budget = flag(args, '--ai-monthly-budget') ?? process.env.TABULARIUS_AI_MONTHLY_BUDGET;
        if (budget !== undefined && !(Number(budget.replace(/^\$/, '')) > 0)) throw new Error('serve: --ai-monthly-budget needs US dollars, like 150');
        const fastModel = flag(args, '--ai-fast-model') ?? process.env.TABULARIUS_AI_FAST_MODEL;
        ai = {
          ...embedOptions(args),
          apiKey, keySource, keyFile, workspaceId, workspaceFile, model: flag(args, '--ai-model') ?? process.env.TABULARIUS_AI_MODEL,
          ...(fastModel ? { fastModel } : {}), ...(budget !== undefined ? { monthlyBudgetUsd: Number(budget.replace(/^\$/, '')) } : {}),
          ...(daily !== undefined ? { dailyTokens: Number(daily) } : {}), ...(perAccount !== undefined ? { accountDailyTokens: Number(perAccount) } : {}),
          ...(perRun !== undefined ? { runTokens: parseRunTokens(perRun) } : {}),
        };
      } else {
        // An embedding model on its own (a local Ollama or LM Studio) needs no Anthropic key: the embedding and RAG
        // steps and Perform Semantic Find work, and the steps that ask a model say it is off.
        const embed = embedOptions(args);
        if (embed.embedUrl || embed.imageEmbed) ai = { apiKey: '', ...embed };
      }
      // Files whose data never goes to AI, whatever their own setting.
      const aiExclude = aiExcludeFrom(args);
      // Accounts the file left without a password (FileMaker's default Admin) work from this computer only, unless allowed.
      if (bool(args, '--allow-blank-passwords')) PASSWORD_POLICY.blankFromNetwork = true;
      // Encryption at rest: stores kept encrypted on disk, unlocked with this key while running.
      const encryptionKey = process.env.TABULARIUS_ENCRYPTION_KEY || undefined;
      // Reachable from other computers without HTTPS: passwords and session tokens cross the network in the clear.
      const exposedPlain = !isLoopbackHost(hostname) && !tlsCert && !acme && !/^https:/i.test(publicUrl ?? '');
      // Several processes, so a busy server uses every core.
      const workersText = flag(args, '--workers') ?? process.env.TABULARIUS_WORKERS;
      const workers = workersText === 'auto' ? availableParallelism() : Number(workersText ?? 1);
      if (!(Number.isInteger(workers) && workers >= 1 && workers <= 64)) throw new Error('serve: --workers takes a number of processes (1 to 64) or auto');
      if (workers > 1) {
        serveCluster({ dir: path, port, hostname, mcpToken, scriptNetwork, scriptNetworkAllow, listFilesPublicly, appConnections, webhooks, inboundHooks, testOutbound, ...(sendMail ? { sendMail } : {}), tlsCert, tlsKey, publicUrl, mcpAllowedOrigins, proxyHeader, trustedProxies, edgeLimits, acme, backups, offsite, progressive, statsInterval, logLimit, replicationToken, acceptPartialStandbyFiles, sqlPort, sqlWrites, ai, aiExclude, oidc, ldap, encryptionKey, background: true }, workers, PASSWORD_POLICY.blankFromNetwork).then(({ url, close }) => {
          // Ready for a stop before anything is printed: whoever sees the first line may signal at once.
          let stopListening = () => {};
          const stop = () => { stopListening(); void close().finally(() => process.exit(0)); };
          stopListening = listenForStop(path, stop);
          process.once('SIGINT', stop);
          process.once('SIGTERM', stop);
          if (exposedPlain) console.warn(`Warning: this server listens on ${hostname} over plain HTTP, so passwords and sign-in tokens cross the network unencrypted. Add --https <your domain> (or --https local for a local network), or put it behind a proxy that does HTTPS and give --public-url https://...`);
          console.log(`hosting ${path} with ${workers} worker processes`);
          console.log(`Web client: ${url}/app/   Admin: ${url}/admin/   Data API: ${url}/fmi/data/vLatest   MCP: ${url}/mcp`);
          if (!mcpToken) console.log(`  AI apps need a token at /mcp: run  tabularius mcp-token ${path}  to print the administrator's, or make one for an account in the admin console (Connect an AI app)`);
          if (ai) console.log(`AI assistant on (${ai.model ?? DEFAULT_MODEL}): questions and what it reads go to Anthropic; one question may use up to ${(ai.runTokens ?? DEFAULT_RUN_TOKENS).toLocaleString('en-US')} tokens`);
          console.log(backups ? `backups every ${every} to ${dest ?? defaultBackupDir(path)}, keeping ${keep}${process.env.TABULARIUS_BACKUP_KEY ? ', encrypted' : ''}` : 'backups off');
        }, (e) => {
          process.stderr.write(`error: ${plainError(e)}\n`);
          process.exit(1);
        });
        return 0;
      }
      // Stopping lets requests that are running finish for this long, then closes them (a service manager's own stop timeout is 60 s).
      const graceText = process.env.TABULARIUS_DRAIN_SECONDS;
      const drainMs = graceText === undefined || graceText === '' ? undefined : Number(graceText) * 1000;
      if (drainMs !== undefined && !(Number.isFinite(drainMs) && drainMs >= 1000 && drainMs <= 86_400_000)) throw new Error('serve: TABULARIUS_DRAIN_SECONDS is a number of seconds (1 to 86400)');
      serve({ dir: path, drainMs, port, hostname, serviceInstalled: () => installed()?.folder === resolve(path), mcpToken, scriptNetwork, scriptNetworkAllow, listFilesPublicly, appConnections, webhooks, inboundHooks, testOutbound, ...(sendMail ? { sendMail } : {}), tlsCert, tlsKey, publicUrl, mcpAllowedOrigins, proxyHeader, trustedProxies, edgeLimits, acme, backups, offsite, progressive, statsInterval, logLimit, replicationToken, keepApiTokensOnTakeover, acceptPartialStandbyFiles, sqlPort, sqlWrites, ai, aiExclude, oidc, ldap, encryptionKey, background: true }).then(({ url, host, server, offsite: offsiteSchedule }) => {
        // Ready for a stop before anything is printed: whoever sees the first line may signal at once. The last changes go
        // off-site before the process ends. A first signal stops cleanly (running requests finish, the files are saved and
        // closed); a second one stops at once.
        let stopping = false;
        let filesClosed = false;
        let stopListening = () => {};
        const stop = () => {
          if (stopping) {
            console.error(filesClosed ? 'stopping now' : 'stopping now without closing the files; they recover when the server starts again');
            process.exit(1);
          }
          stopping = true;
          stopListening();
          console.log('stopping: finishing running requests and saving the files (press Ctrl-C again to stop at once)');
          server.close(() => {
            filesClosed = true;
            void (offsiteSchedule?.stop() ?? Promise.resolve()).finally(() => process.exit(0));
          });
        };
        stopListening = listenForStop(path, stop);
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
        // Told once it is listening, so a start that fails (a bad address, a port in use) gives only its own error.
        if (exposedPlain) console.warn(`Warning: this server listens on ${hostname} over plain HTTP, so passwords and sign-in tokens cross the network unencrypted. Add --https <your domain> (or --https local for a local network), or put it behind a proxy that does HTTPS and give --public-url https://...`);
        console.log(`hosting ${host.names().join(', ') || '(no databases)'}`);
        for (const name of host.names()) {
          const store = host.get(name);
          const blank = store?.blankPasswordAccounts() ?? [];
          if (blank.length) {
            console.log(`${name}: ${blank.join(', ')} ${blank.length > 1 ? 'have' : 'has'} no password${PASSWORD_POLICY.blankFromNetwork ? ', and anyone who can reach this server can sign in' : '; signing in works from this computer only'} (set one with: tabularius passwd ${path} ${name} ${blank[0]})`);
          }
          const blankSet = new Set(blank.map((n) => n.toLowerCase()));
          const stuck = (store?.unmigratedAccounts() ?? []).filter((n) => !blankSet.has(n.toLowerCase()));
          if (stuck.length) {
            console.log(`${name}: ${stuck.join(', ')} ${stuck.length > 1 ? 'had' : 'had a'} password in FileMaker that doesn't carry over, so ${stuck.length > 1 ? 'they' : 'it'} can't sign in at all yet (set one with: tabularius passwd ${path} ${name} ${stuck[0]} — or the admin console)`);
          }
        }
        console.log(`Web client: ${url}/app/   Admin: ${url}/admin/   Data API: ${url}/fmi/data/vLatest   MCP: ${url}/mcp`);
        if (!mcpToken) console.log(`  AI apps need a token at /mcp: run  tabularius mcp-token ${path}  to print the administrator's, or make one for an account in the admin console (Connect an AI app)`);
        if (ai) console.log(`AI assistant on (${ai.model ?? DEFAULT_MODEL}): questions and what it reads go to Anthropic; one question may use up to ${(ai.runTokens ?? DEFAULT_RUN_TOKENS).toLocaleString('en-US')} tokens`);
        console.log(backups ? `backups every ${every} to ${dest ?? defaultBackupDir(path)}, keeping ${keep}${process.env.TABULARIUS_BACKUP_KEY ? ', encrypted' : ''}` : 'backups off');
        if (openPage) openBrowser(`${url}/admin/#welcome`);
        if (offsite) console.log(`backups copied off-site to ${offsite.url}${process.env.TABULARIUS_BACKUP_KEY ? ' (encrypted)' : ''}`);
        if (replicationToken) console.log(`standby servers can follow this one: tabularius standby <folder> --primary ${url} ${replicationTokenFile ? `--token-file ${replicationTokenFile}` : '--token ...'}`);
        if (progressive) console.log(`changes saved every ${progressiveEvery}: restore to any of those moments with tabularius restore --at`);
        if (encryptionKey) console.log('encryption at rest on: stores are re-encrypted on a clean shutdown (Ctrl-C), not left as plaintext');
      }, (e) => {
        process.stderr.write(`error: ${plainError(e)}\n`);
        process.exit(1);
      });
      return 0;
    }
    case 'migrate-fms': {
      const from = flag(args, '--from');
      const fmsDir = flag(args, '--fms-dir');
      const save = flag(args, '--save');
      const dryRun = bool(args, '--dry-run');
      if (!from && !fmsDir) throw new Error('migrate-fms: give the FileMaker Server folder (--fms-dir) and/or its Admin API (--from URL)');
      if (fmsDir && !existsSync(fmsDir)) throw new Error(`migrate-fms: ${fmsDir} doesn't exist`);
      const user = flag(args, '--user') ?? 'admin';
      const read: Promise<FmsExport> = !from ? Promise.resolve({})
        : existsSync(from) ? Promise.resolve(JSON.parse(readFileSync(from, 'utf8')) as FmsExport)
        : (process.env.TABULARIUS_FMS_PASSWORD !== undefined ? Promise.resolve(process.env.TABULARIUS_FMS_PASSWORD) : readSecret(`FileMaker Server password for ${user}`))
          .then((password) => fetchFmsExport(from, user, password, bool(args, '--insecure')));
      read.then((exp) => {
        if (save) writeFileSync(save, JSON.stringify(exp, null, 2) + '\n', { mode: 0o600 });
        const report = migrateFms(exp, resolve(path), { fmsDir, keyPassphrase: process.env.TABULARIUS_FMS_KEY_PASSPHRASE, dryRun,
          onProgress: dryRun ? undefined : ({ completed, total, elapsedMs, etaMs }) => {
            process.stderr.write(`Migration: ${completed}/${total} files checked (${Math.round(elapsedMs / 1000)}s elapsed${etaMs === null ? '' : `, about ${Math.round(etaMs / 1000)}s remaining`})\n`);
          } });
        if (dryRun) console.log(`Dry run: nothing changed. ${copySize(report) >= 1e9 ? `${(copySize(report) / 1e9).toFixed(1)} GB` : `${Math.ceil(copySize(report) / 1e6)} MB`} of files would be copied into ${path}.`);
        for (const line of describeMigration(report, path, dryRun)) console.log(line);
      }).catch((e) => {
        process.stderr.write(`error: ${plainError(e)}\n`);
        process.exitCode = 1;
      });
      return 0;
    }
    case 'write-back': {
      const fmp12Flag = flag(args, '--fmp12');
      const [database, out] = args;
      if (!database || !out) throw new Error('write-back: give a database and an output folder');
      const file = join(path, database + STORE_EXT);
      if (!existsSync(file)) throw new Error(`write-back: ${file} doesn't exist`);
      const source = fmp12Flag ?? join(path, database + '.fmp12');
      if (!existsSync(source)) throw new Error(`write-back: ${source} doesn't exist; give the .fmp12 ${database} came from with --fmp12`);
      if (existsSync(out) && readdirSync(out).length) throw new Error(`write-back: ${out} isn't empty`);
      // Read only: the store's schema as it is now, and the .fmp12's as it came.
      const store = openForPlanning(file);
      let kit;
      try {
        kit = writeBackKit(FmpDatabase.open(source).schema, store.schema);
      } finally {
        store.close();
      }
      mkdirSync(out, { recursive: true });
      const lines = [`# Taking ${database}'s changes back to FileMaker`, '', `Made from ${basename(source)} and the changes made in Tabularius since.`, ''];
      if (!kit.paste.length && !kit.byHand.length) lines.push('Nothing has changed: there is nothing to do.');
      if (kit.paste.length) {
        lines.push('## Paste these, in order', '', 'Open each file, copy all of its text, and paste in FileMaker Pro where it says. FileMaker reads its own clipboard format, so a clipboard tool that converts XML text to it is needed.', '');
        kit.paste.forEach((p, i) => {
          const name = `${String(i + 1).padStart(2, '0')}.xml`;
          writeFileSync(join(out, name), p.xml);
          lines.push(`${i + 1}. \`${name}\` (${p.names.join(', ')}): ${p.where}`);
          for (const n of p.notes) lines.push(`   - ${n}`);
        });
        lines.push('');
      }
      if (kit.byHand.length) lines.push('## Then do these by hand', '', ...kit.byHand.map((b) => `- ${b}`), '');
      writeFileSync(join(out, 'README.md'), lines.join('\n'));
      console.log(`${kit.paste.length} files to paste and ${kit.byHand.length} changes to make by hand: ${join(out, 'README.md')}`);
      return 0;
    }
    case 'sync-plan': {
      const [database] = args;
      const configPath = flag(args, '--config');
      if (!database) throw new Error('sync-plan: give a database');
      if (!configPath) throw new Error('sync-plan: give --config sync.json (ADMIN.md shows what goes in it)');
      const file = join(path, database + STORE_EXT);
      if (!existsSync(file)) throw new Error(`sync-plan: ${file} doesn't exist`);
      const config = parseSyncConfig(JSON.parse(readFileSync(configPath, 'utf8')));
      const user = flag(args, '--user') ?? config.user;
      if (!user) throw new Error('sync-plan: give --user, or "user" in the configuration (an account in the FileMaker file with the fmrest privilege)');
      const insecure = bool(args, '--insecure');
      const json = bool(args, '--json');
      checkSyncAllowed([database], config, { write: false, captureOnly: (flag(args, '--capture-only') ?? '').split(',').map((x) => x.trim()).filter(Boolean) });
      // Opened read-only: a dry run doesn't even bring an older file's own tables up to date.
      const store = openForPlanning(file);
      (process.env.TABULARIUS_FMS_PASSWORD !== undefined ? Promise.resolve(process.env.TABULARIUS_FMS_PASSWORD) : readSecret(`FileMaker password for ${user} in ${config.database}`))
        .then(async (password) => {
          const remote = dataApiSource({ server: config.server, database: config.database, user, password, insecure, tables: config.tables });
          try {
            const plans = await syncPlan(store, database, config.tables, remote);
            if (json) console.log(JSON.stringify(plans, null, 2));
            else for (const line of describePlan(plans, new URL(/^https?:\/\//i.test(config.server) ? config.server : `https://${config.server}`).host)) console.log(line);
          } finally {
            await remote.close();
          }
        })
        .catch((e) => {
          process.stderr.write(`error: ${plainError(e)}\n`);
          process.exitCode = 1;
        })
        .finally(() => store.close());
      return 0;
    }
    case 'sync-apply': {
      const [database] = args;
      const configPath = flag(args, '--config');
      if (!database) throw new Error('sync-apply: give a database');
      if (!configPath) throw new Error('sync-apply: give --config sync.json (ADMIN.md shows what goes in it)');
      const file = join(path, database + STORE_EXT);
      if (!existsSync(file)) throw new Error(`sync-apply: ${file} doesn't exist`);
      const config = parseSyncConfig(JSON.parse(readFileSync(configPath, 'utf8')));
      const user = flag(args, '--user') ?? config.user;
      if (!user) throw new Error('sync-apply: give --user, or "user" in the configuration (an account in the FileMaker file with the fmrest privilege)');
      const write = bool(args, '--write');
      const pull = bool(args, '--pull');
      const containers = bool(args, '--containers');
      if (containers && !config.allowContainers) throw new Error('sync-apply: this configuration doesn\'t allow container files: add "allowContainers": true to it, then run again with --containers');
      const resolve = flag(args, '--resolve') as ConflictPolicy | undefined;
      if (resolve !== undefined && !['filemaker-wins', 'tabularius-wins', 'newer-wins'].includes(resolve)) throw new Error('sync-apply: --resolve is filemaker-wins, tabularius-wins or newer-wins');
      const held = (flag(args, '--capture-only') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      const insecure = bool(args, '--insecure');
      const allowDeletes = bool(args, '--allow-deletes');
      const keepRelated = bool(args, '--keep-related');
      const release = bool(args, '--release');
      const json = bool(args, '--json');
      checkSyncAllowed([database], config, { write, captureOnly: held });
      const server = new URL(/^https?:\/\//i.test(config.server) ? config.server : `https://${config.server}`).host;
      // A dry run opens the file read-only and signs in with a client that has no way to write; a pull alone writes only here.
      const store = write || pull ? new Store(file, database) : openForPlanning(file);
      (process.env.TABULARIUS_FMS_PASSWORD !== undefined ? Promise.resolve(process.env.TABULARIUS_FMS_PASSWORD) : readSecret(`FileMaker password for ${user} in ${config.database}`))
        .then(async (password) => {
          const options = { server: config.server, database: config.database, user, password, insecure, tables: config.tables };
          const client = write ? dataApiClient(options) : undefined;
          const source = client ?? dataApiSource(options);
          try {
            if (release && (write || pull)) console.log(`${releaseHeldTables(store as Store, database, config.tables)} held table(s) released`);
            let lastProgress = 0;
            const result = await applySync(store, database, config.tables, source, client ?? source, { write, pull, resolve, allowDeletes, keepRelated, ...(containers ? { containers: { maxBytes: CONTAINER_PULL_MAX_BYTES } } : {}), actor: `${user}@${server}`,
              onProgress: write || pull ? ({ completed, total, elapsedMs, etaMs }) => {
                if (completed !== total && elapsedMs - lastProgress < 2000) return;
                lastProgress = elapsedMs;
                process.stderr.write(`Sync: ${completed}/${total} planned record steps processed (${Math.round(elapsedMs / 1000)}s elapsed${etaMs === null ? '' : `, about ${Math.round(etaMs / 1000)}s remaining`})\n`);
              } : undefined });
            let verification;
            let verificationError: string | undefined;
            if (write || pull) {
              const fresh = dataApiSource(options);
              try { verification = await verifySync(store, config.tables, fresh); }
              catch (e) { verificationError = plainError(e); }
              finally { await fresh.close(); }
            }
            if (json) console.log(JSON.stringify({ ...result, ...(verification ? { verification } : {}), ...(verificationError ? { verificationError } : {}) }, null, 2));
            else {
              for (const line of describeApply(result, server)) console.log(line);
              if (verification) for (const line of describeSyncVerification(verification)) console.log(line);
              if (verificationError) console.log(`Verification unavailable: ${verificationError}`);
            }
            if (result.refused || result.stopped || result.tables.some((t) => t.failed.length)) process.exitCode = 1;
            if (write && pull && verification?.some((t) => t.differences.length)) process.exitCode = 1;
            if (verificationError) process.exitCode = 1;
          } finally {
            await source.close();
          }
        })
        .catch((e) => {
          process.stderr.write(`error: ${plainError(e)}\n`);
          process.exitCode = 1;
        })
        .finally(() => store.close());
      return 0;
    }
    case 'sync-log': {
      const [database] = args;
      if (!database) throw new Error('sync-log: give a database');
      const file = join(path, database + STORE_EXT);
      if (!existsSync(file)) throw new Error(`sync-log: ${file} doesn't exist`);
      const store = openForPlanning(file);
      try {
        const rows = readSyncLog(store, { runId: flag(args, '--run'), limit: Number(flag(args, '--limit') ?? 200) });
        if (bool(args, '--json')) console.log(JSON.stringify(rows, null, 2));
        else if (!rows.length) console.log('nothing has been sent to FileMaker yet');
        else for (const r of rows) console.log(`${r.at} ${r.runId.slice(0, 8)} ${r.op} ${r.status}${r.table ? ` ${r.table}` : ''}${r.uuid ? ` ${r.uuid}` : ''}${r.remoteRecordId ? ` (FileMaker record ${r.remoteRecordId}${r.modIdBefore ? `, modId ${r.modIdBefore}` : ''}${r.modIdAfter ? ` -> ${r.modIdAfter}` : ''})` : ''}${r.fields ? ` fields: ${r.fields.join(', ')}` : ''}${r.detail ? ` — ${r.detail}` : ''}`);
      } finally {
        store.close();
      }
      return 0;
    }
    case 'standby': {
      const primary = flag(args, '--primary') ?? process.env.TABULARIUS_PRIMARY;
      const token = tokenOption(args, '--token', '--token-file', process.env.TABULARIUS_REPLICATION_TOKEN, process.env.TABULARIUS_REPLICATION_TOKEN_FILE, 'standby').value;
      if (!primary || !token) throw new Error('standby: give --primary URL and --token or --token-file (the main server\'s replication token)');
      const standby = new Standby({ folder: path, primary, token, overwrite: bool(args, '--overwrite'), log: (m) => console.log(m) });
      standby.start();
      console.log(`standby of ${primary} in ${path}: to take over, stop this (Ctrl-C) and run tabularius serve ${path}`);
      const stop = () => {
        void standby.stop().then(() => {
          const behind = standby.status().filter((f) => !f.whole).map((f) => f.file);
          console.log(`stopped${behind.length ? `; not yet caught up: ${behind.join(', ')}` : ''}`);
          process.exit(0);
        });
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      return 0;
    }
    case 'encrypt':
    case 'decrypt': {
      // Encrypt or decrypt the hosted stores in a folder, at rest, while the
      // server is stopped. The key comes from TABULARIUS_ENCRYPTION_KEY — the
      // same one the server unlocks with.
      const key = process.env.TABULARIUS_ENCRYPTION_KEY;
      if (!key) throw new Error(`${cmd}: set TABULARIUS_ENCRYPTION_KEY to the passphrase`);
      if (!existsSync(path)) throw new Error(`${cmd}: ${path} does not exist`);
      const release = claimFolder(path, 'restore');
      try {
        let n = 0;
        if (cmd === 'encrypt') {
          for (const f of readdirSync(path)) {
            if (!f.endsWith(STORE_EXT)) continue;
            const working = join(path, f);
            const enc = working + ENCRYPTED_EXT;
            rmSync(enc + '.partial', { force: true });
            if (existsSync(enc)) {
              // Both a plaintext database and an encrypted copy: the plaintext may be the newer one (a server that unlocked the file and stopped without locking it again), or an earlier encrypt may have stopped before removing it. Nothing says which, so nothing is removed.
              if (existsSync(working)) throw new Error(`${f}: a plaintext database and an encrypted copy (${basename(enc)}) both exist, and the plaintext may be newer. This database was not changed. Keep the one you want and remove the other (and its -wal, -shm and .results files with it), then run encrypt again`);
              console.log(`${f} is already encrypted`);
              continue;
            }
            const store = new Store(working); // fold the WAL in so the file alone is complete
            try { store.checkpoint(); } finally { store.close(); }
            // The shared results beside it hold values worked out from the data: they go too.
            for (const side of ['-wal', '-shm', '.results', '.results-wal', '.results-shm']) rmSync(working + side, { force: true });
            encryptFileSync(working, enc + '.partial', key);
            renameSync(enc + '.partial', enc);
            rmSync(working, { force: true });
            console.log(`encrypted ${f}`);
            n++;
          }
        } else {
          for (const f of readdirSync(path)) {
            if (!f.endsWith(STORE_EXT + ENCRYPTED_EXT)) continue;
            const working = join(path, f.slice(0, -ENCRYPTED_EXT.length));
            if (existsSync(working)) { console.log(`${basename(working)} is already decrypted; remove it first if you mean to replace it`); continue; }
            // Into a partial file first: a wrong key or a damaged file leaves nothing behind that a later run would take for the decrypted database.
            const partial = working + '.partial';
            rmSync(partial, { force: true });
            try {
              decryptFileSync(join(path, f), partial, key);
              renameSync(partial, working);
            } catch (e) {
              rmSync(partial, { force: true });
              throw e;
            }
            rmSync(join(path, f));
            console.log(`decrypted ${f}`);
            n++;
          }
        }
        console.log(n ? `${cmd}ed ${n} database${n > 1 ? 's' : ''}` : 'nothing to do');
      } finally { release(); }
      return 0;
    }
    case 'admin-password': {
      later((async () => {
        const password = process.env.TABULARIUS_PASSWORD ?? await readSecret('New admin console password', { confirm: true });
        if (!password) throw new Error('admin-password: empty password');
        const problem = adminPasswordProblem(password);
        if (problem) throw new Error(`admin-password: ${problem}`);
        setAdminPassword(path, password);
        console.log(`admin password set for ${path}`);
      })());
      return 0;
    }
    case 'mcp-token': {
      const problem = hostFolderProblem(path);
      if (problem) throw new Error(`mcp-token: ${problem}`);
      const token = readLocalMcpToken(path);
      if (!token) throw new Error(`mcp-token: ${path} has no /mcp token yet. Start the server once (tabularius serve ${path}), which makes it, then run this again.`);
      if (process.env.TABULARIUS_MCP_TOKEN) console.error('note: this server is started with TABULARIUS_MCP_TOKEN, which it uses instead of this token');
      console.log(token);
      return 0;
    }
    case 'backup': {
      const dest = flag(args, '--to') ?? defaultBackupDir(path);
      const keep = Number(flag(args, '--keep') ?? 0);
      backupFolder(path, dest, keep).then((r) => {
        console.log(`backed up ${r.files.length} files to ${r.dir}${process.env.TABULARIUS_BACKUP_KEY ? ', encrypted' : ''}`);
        for (const old of r.removed) console.log(`removed old backup ${old}`);
      }, (e) => {
        process.stderr.write(`error: ${plainError(e)}\n`);
        process.exitCode = 1;
      });
      return 0;
    }
    case 'verify-backup': {
      const dest = flag(args, '--from') ?? defaultBackupDir(path);
      const sign = bool(args, '--sign');
      const sets = args[0] ? [args[0]] : backupSets(dest);
      if (!sets.length) throw new Error(`verify-backup: no backup sets in ${dest}`);
      // Signing says "I trust this set as it is": one set, named, never every set at once.
      if (sign && sets.length !== 1) throw new Error('verify-backup --sign: name the one backup set to sign');
      (async () => {
        for (const set of sets) {
          const check = await verifySet(existsSync(set) ? set : join(dest, set), undefined, { sign });
          console.log(describeCheck(basename(set), check));
          if (!check.ok) process.exitCode = 1;
        }
      })().catch((e) => {
        process.stderr.write(`error: ${plainError(e)}\n`);
        process.exitCode = 1;
      });
      return 0;
    }
    case 'restore': {
      const at = flag(args, '--at');
      const from = flag(args, '--from');
      const endpoint = flag(args, '--s3-endpoint');
      const region = flag(args, '--s3-region');
      const accept = bool(args, '--accept-account-changes');
      const options = { refuseAccountChanges: !accept, differences: [] as AccountDifference[], acceptUnsigned: bool(args, '--accept-unsigned-backup'), newerThanBackup: [] as ChangedSince[] };
      /** The accounts that are not the same in the backup as in the file it replaces, one per line. */
      const listChanges = (list: AccountDifference[]) => list.map((d) => `  ${d.file.replace(STORE_EXT, '')}: ${d.name} ${d.change}`).join('\n');
      const fail = (e: unknown) => {
        if (e instanceof AccountChangesError) {
          process.stderr.write(`The backup's accounts are not the same as the ones in place now:\n${listChanges(e.differences)}\nNothing was restored. Read the list, then run the same command again with --accept-account-changes to restore anyway.\n`);
        } else process.stderr.write(`error: ${plainError(e)}\n`);
        process.exitCode = 1;
      };
      /** After a restore that went ahead with differences: the same list, so what was accepted is on the screen. */
      const reportAccepted = () => {
        for (const n of options.newerThanBackup) process.stderr.write(`note: ${n.file.replace(STORE_EXT, '')} had changes after this backup was taken (last written ${new Date(n.changedAt).toLocaleString()}, backup from ${new Date(n.backupAt).toLocaleString()}); they are not in the restored file\n`);
        if (options.differences.length) console.log(`Accounts that are not as they were before this restore (check them with: tabularius privileges ${path}):\n${listChanges(options.differences)}`); };
      // Off-site backups: brought down into the folder's backups first.
      const local = from?.startsWith('s3://') ? defaultBackupDir(path) : from ?? defaultBackupDir(path);
      const fetched = from?.startsWith('s3://')
        ? mirrorDown(new S3(s3FromEnv(from, endpoint, region)), local).then((n) => console.log(`downloaded ${n} files from ${from}`))
        : Promise.resolve();
      if (at !== undefined) {
        fetched.then(() => restoreAt(path, local, parseTime(at), args[0], undefined, options)).then((done) => {
          for (const r of done) console.log(`restored ${r.file} as it was at ${new Date(r.time).toLocaleString()}`);
          reportAccepted();
        }, fail);
        return 0;
      }
      const [set, database] = args;
      fetched.then(() => {
        if (!set) {
          const sets = backupSets(local);
          throw new Error(`restore: which backup set? ${sets.length ? 'In ' + local + ': ' + sets.join(', ') : 'none found'}`);
        }
        return restoreBackup(path, existsSync(set) ? set : join(local, set), database, undefined, options);
      }).then((files) => {
        for (const f of files) console.log(`restored ${f}`);
        reportAccepted();
        for (const f of files) {
          const off = accountsWithPasswordOff(join(path, f));
          if (off.length) process.stderr.write(`note: ${f.replace(STORE_EXT, '')}: ${off.length === 1 ? `${off[0]} cannot` : `${off.length} accounts (${off.slice(0, 5).join(', ')}${off.length > 5 ? ', ...' : ''}) cannot`} sign in with a password until one is set: tabularius passwd ${path} ${f.replace(STORE_EXT, '')} <account>\n`);
        }
      }, fail);
      return 0;
    }
    case 'mcp': {
      const account = strictFlag(args, '--account');
      const password = process.env.TABULARIUS_PASSWORD;
      if (account && password === undefined) throw new Error('mcp: put the account\'s password in TABULARIUS_PASSWORD');
      const aiExcludeAt = args.indexOf('--ai-exclude');
      if (aiExcludeAt >= 0 && args[aiExcludeAt + 1] === undefined) throw new Error('mcp: --ai-exclude needs a list of names (or \'\' for none)');
      const aiExclude = aiExcludeFrom(args);
      // An option written --name=value or misspelled would otherwise be ignored, and the server would start as administrator or without the exclusion.
      const stray = args.find((a) => a.startsWith('-'));
      if (stray !== undefined) throw new Error(`mcp: ${stray} is not an option it knows; write an option and its value as two words (--account Review)`);
      // A word left over (mcp DIR Review) would be ignored and the server would start as administrator.
      if (args.length) throw new Error(`mcp: "${args[0]}" is not understood here; the account goes after --account, for example --account Review`);
      serveStdio(path, account ? { account, password: password! } : { admin: true }, { aiExclude });
      return 0;
    }
    case 'test-scripts': {
      const only: string[] = [];
      for (let v = flag(args, '--script'); v !== undefined; v = flag(args, '--script')) only.push(v);
      const skip: string[] = [];
      for (let v = flag(args, '--skip'); v !== undefined; v = flag(args, '--skip')) skip.push(v);
      const timeout = Number(flag(args, '--timeout') ?? 10);
      const loopLimit = Number(flag(args, '--loop-limit') ?? 0);
      const loopRecordLimit = Number(flag(args, '--loop-records') ?? 0);
      const json = bool(args, '--json');
      const verbose = bool(args, '--verbose');
      const explain = bool(args, '--explain');
      const show = bool(args, '--show');
      const lint = bool(args, '--lint');
      const functions: string[] = [];
      for (let v = flag(args, '--function'); v !== undefined; v = flag(args, '--function')) functions.push(v);
      // $$variables a login script would set: --global '$$UserName=tester' (repeatable).
      const globals: Record<string, string> = {};
      for (let v = flag(args, '--global'); v !== undefined; v = flag(args, '--global')) {
        const m = /^\s*(\$\$[^=\s[\]]+)\s*=(.*)$/s.exec(v);
        if (!m) throw new Error(`test-scripts --global: write it as '$$Name=value', not "${v}"`);
        globals[m[1]] = m[2];
      }
      const outbound = outboundFlags(args, 'test-scripts');
      const host = new Host(path);
      if (outbound) host.testOutbound(outbound);
      const names = args[0] && !args[0].startsWith('--') ? [args[0]] : host.names();
      const run = async () => {
        const all = host.names().map((n) => host.get(n)).filter((x): x is Store => !!x);
        let bad = 0;
        // A --skip that matches nothing is a typo on a safety switch: stop before anything runs.
        const scriptNames = names.flatMap((n) => host.get(n)?.schema.scripts.map((s) => s.name) ?? []);
        const unmatched = unmatchedSkips(scriptNames, skip);
        if (unmatched.length) throw new Error(`test-scripts: --skip ${unmatched.map((p) => `"${p}"`).join(', ')} matches no script, so nothing was run (use * anywhere, e.g. "*Upload*")`);
        if (show && !only.length && !functions.length) throw new Error('test-scripts --show: name the scripts with --script (or custom functions with --function)');
        for (const name of names) {
          const store = host.get(name);
          if (!store) throw new Error(`test-scripts: no database "${name}" in ${path}; hosted: ${host.names().join(', ')}`);
          if (lint) {
            // Nothing runs: loops that never end and guards that catch nothing, from the script linter.
            let found = 0;
            for (const sc of store.schema.scripts.filter((x) => !only.length || only.includes(x.name))) {
              for (const i of lintScript(sc, store.schema)) {
                found++;
                const text = maskStepText(`${i.message} ${i.fix}`);
                if (json) console.log(JSON.stringify({ database: name, script: sc.name, rule: i.rule, severity: i.severity, line: i.line, message: text }));
                else console.log(`${i.severity.padEnd(7)} ${sc.name}, line ${i.line}\n         ${text}`);
              }
            }
            if (!json) console.log(`${found} finding${found === 1 ? '' : 's'} in ${name}`);
            continue;
          }
          if (show) {
            // Nothing runs: the steps as the script workspace shows them, with typed-in text masked.
            for (const s of store.schema.scripts.filter((x) => only.includes(x.name))) {
              console.log(`== ${name}: ${s.name}`);
              // Comments can hold anything, over several lines: shown as "# …".
              const steps = (s.steps ?? []).map((x) => (x.stepId === 89 && (x.text || x.line) ? { ...x, line: '# …', text: undefined } : x));
              console.log(maskStepText(scriptText(steps))); // whole, so a literal over several lines is masked too
            }
            // --function: custom functions a script calls (for example the ones that read its parameter), masked the same way.
            for (const c of store.schema.customFunctions.filter((x) => functions.includes(x.name))) {
              console.log(`== ${name}: function ${c.name} ( ${c.parameters.join(' ; ')} )`);
              console.log(c.formula === undefined ? '(formula not read)' : maskFormula(c.formula));
            }
            continue;
          }
          if (skip.length) {
            // Before anything runs: exactly which scripts --skip keeps from running (with --json, a first line
            // in the output and the same list on stderr, so it shows on screen while the output goes to a file).
            const matches = store.schema.scripts.map((s) => s.name).filter(skipMatcher(skip));
            const text = matches.length ? `--skip matches ${matches.length} script${matches.length === 1 ? '' : 's'} in ${name}, not run:\n${matches.map((m) => `  ${m}`).join('\n')}` : `--skip matches no script in ${name}`;
            if (json) {
              console.log(JSON.stringify({ database: name, skip: { patterns: skip, matches } }));
              console.error(text);
            } else console.log(text);
          }
          const results = await testScripts(store, {
            ...(only.length ? { scripts: only } : {}),
            ...(skip.length ? { skip } : {}),
            timeoutMs: timeout * 1000,
            ...(loopLimit > 0 ? { loopLimit } : {}),
            ...(loopRecordLimit > 0 ? { loopRecordLimit } : {}),
            others: all.filter((x) => x !== store),
            ...(host.outbound ? { outbound: host.outbound } : {}),
            ...(Object.keys(globals).length ? { globals } : {}),
            // Which script was running, and how much memory was in use, if the process dies.
            ...(verbose ? { starting: (s: string) => process.stderr.write(`start   ${s} (${Math.round(process.memoryUsage().heapUsed / 1048576)} MB)\n`) } : {}),
            // --json: one line per script as it finishes (JSON Lines), so a run that dies keeps every result so far.
            ...(json ? { progress: (r: ScriptTestResult) => console.log(JSON.stringify({ database: name, ...r })) } : {
              progress: (r: ScriptTestResult) => {
                if (r.outcome === 'ok' && !r.skipped && !r.outside && !r.mail) return;
                console.log(`${r.outcome.padEnd(7)} ${String(r.error).padStart(4)}  ${r.script}${r.layout ? ` @ ${r.layout}` : ''}\n         ${r.step ?? ''}${r.message ? ` (${r.message})` : ''}${
                  r.skipped ? `\n         skipped, not run: ${r.skipped.join(', ')}` : ''}${
                  r.outside || r.mail ? `\n         ${describeOutside(r.outside ?? [], r.mail)}` : ''}${
                  r.lint ? r.lint.map((l) => `\n         why it may never end: ${l}`).join('') : ''}${
                  r.setup ? r.setup.map((l) => `\n         test setup, not the script: ${l}`).join('') : ''}`);
              },
            }),
          });
          bad += results.filter((r) => r.outcome === 'stalled' || r.outcome === 'crashed').length;
          // Why each failed: run again on a copy, offline (never with the outbound test settings).
          const why = new Map<ScriptTestResult, ScriptFailure>();
          if (explain) {
            for (const r of results.filter((x) => x.outcome === 'error')) {
              why.set(r, await explainScriptFailure(store, { script: r.script, ...(r.layout ? { layout: r.layout } : {}), ...(r.recordId !== undefined ? { recordId: r.recordId } : {}) }, { account: 'test-scripts', skip }));
            }
          }
          const count = (o: string) => results.filter((r) => r.outcome === o).length;
          if (json && why.size) console.log(JSON.stringify({ database: name, why: [...why.values()] }));
          if (json) console.log(JSON.stringify({ database: name, summary: { scripts: results.length, ok: count('ok'), error: count('error'), stalled: count('stalled'), crashed: count('crashed'), skipped: count('skipped') } }));
          else {
            for (const w of why.values()) console.log(`\n${describeFailure(w)}`);
            console.log(`${name}: ${results.length} scripts, ${count('ok')} ok, ${count('error')} ended with an error, ${count('stalled')} stalled, ${count('crashed')} crashed${count('skipped') ? `, ${count('skipped')} skipped (embedded credentials)` : ''}`);
            // Every outside service the file's scripts tried, busiest first.
            const hosts = new Map<string, { calls: number; sent: number; scripts: number }>();
            for (const r of results) for (const o of r.outside ?? []) {
              const h = hosts.get(o.host) ?? { calls: 0, sent: 0, scripts: 0 };
              hosts.set(o.host, { calls: h.calls + o.calls, sent: h.sent + o.sent, scripts: h.scripts + 1 });
            }
            const mail = results.reduce((n, r) => n + (r.mail ?? 0), 0);
            if (hosts.size || mail) {
              console.log('Outside services the scripts tried:');
              for (const [host, h] of [...hosts].sort((a, b) => b[1].calls - a[1].calls)) {
                console.log(`  ${(host || '(no host: a web address built from an empty field?)').padEnd(40)} ${h.calls.toLocaleString('en-US').padStart(9)} calls by ${h.scripts} script${h.scripts === 1 ? '' : 's'}, ${h.sent ? `${h.sent.toLocaleString('en-US')} sent` : 'all blocked'}`);
              }
              if (mail) console.log(`  ${'email'.padEnd(40)} ${String(mail).padStart(9)} written, captured in the outbox`);
            }
          }
        }
        return bad;
      };
      run().then((bad) => {
        if (bad) process.exitCode = 1;
      }, (e) => {
        process.stderr.write(`error: ${plainError(e)}\n`);
        process.exitCode = 1;
      }).finally(() => host.close());
      return 0;
    }
    case 'script-tests': {
      const only: string[] = [];
      for (let v = flag(args, '--script'); v !== undefined; v = flag(args, '--script')) only.push(v);
      const json = bool(args, '--json');
      const host = new Host(path);
      const named = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
      const names = named ? [named] : host.names().filter((n) => !captureOnly(n));
      const live = runningServer(path) !== undefined;
      const run = async () => {
        const all = host.names().map((n) => host.get(n)).filter((x): x is Store => !!x);
        let failed = 0;
        let ran = 0;
        for (const name of names) {
          const store = host.get(name);
          if (!store) throw new Error(`script-tests: no database "${name}" in ${path}; hosted: ${host.names().join(', ')}`);
          const ids = new Set(store.schema.scripts.filter((x) => !only.length || only.includes(x.name)).map((x) => x.id));
          const tests = store.scriptTests().filter((t) => ids.has(t.script));
          if (!tests.length) continue;
          // With a server running on this folder, cases run on a copy: a trial on the live file would hold its
          // write lock while each case runs. Scripts there can't open the folder's other files.
          let outcomes;
          if (live) {
            const tmp = mkdtempSync(join(tmpdir(), 'tabularius-script-tests-'));
            try {
              await store.backup(join(tmp, 'copy.sqlite'));
              const copy = new Store(join(tmp, 'copy.sqlite'), store.name);
              copy.readContainersLike(store);
              try {
                outcomes = await runScriptTests(copy, tests);
              } finally {
                copy.close();
              }
            } finally {
              rmSync(tmp, { recursive: true, force: true });
            }
          } else outcomes = await runScriptTests(store, tests, { others: all.filter((x) => x !== store) });
          for (const o of outcomes) {
            ran++;
            if (!o.passed) failed++;
            if (json) console.log(JSON.stringify({ database: name, ...o }));
            else {
              console.log(`${o.passed ? 'pass' : 'FAIL'}  ${name}: ${o.script}: ${o.name}`);
              for (const f of o.failures) console.log(`      ${f.what}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`);
              if (!o.passed && o.message) console.log(`      ${o.message}`);
            }
          }
        }
        if (!json) console.log(ran ? `${ran - failed} of ${ran} test cases pass` : 'No script test cases saved' + (only.length ? ' for those scripts' : ''));
        return failed;
      };
      run().then((bad) => {
        if (bad) process.exitCode = 1;
      }, (e) => {
        process.stderr.write(`error: ${plainError(e)}\n`);
        process.exitCode = 1;
      }).finally(() => host.close());
      return 0;
    }
    case 'fidelity': {
      const sqlOnly = bool(args, '--sql');
      const json = bool(args, '--json');
      const n = Number(flag(args, '--n') ?? 200);
      const [database] = args;
      if (!database) throw new Error('fidelity: give a database');
      const file = join(path, database + STORE_EXT);
      if (!existsSync(file)) throw new Error(`fidelity: ${file} doesn't exist`);
      const store = new Store(file, database);
      // ExecuteSQL on another file's tables reads that file's store in the same folder.
      const others = new Map<string, Store>();
      store.resolveFile = (name) => {
        if (!others.has(name) && existsSync(join(path, name + STORE_EXT))) others.set(name, new Store(join(path, name + STORE_EXT), name));
        return others.get(name);
      };
      try {
        const r = calcFidelity(store, { perField: n, sqlOnly });
        if (json) console.log(JSON.stringify(r, null, 2));
        else {
          const line = (t: { values: number; match: number; differ: number; missing: number; extra: number; error: number }) =>
            `${t.values} values, ${t.match} match (${t.values ? (100 * t.match / t.values).toFixed(2) : '0'}%), ${t.differ} differ, ${t.missing} missing, ${t.extra} extra, ${t.error} ?`;
          console.log(`${database}: ${r.fields} stored calculations${sqlOnly ? ' using ExecuteSQL' : ''} (${r.skipped.volatile} volatile and ${r.skipped.external} plug-in/design skipped)`);
          console.log(`  ${line(r.total)}`);
          if (Object.keys(r.kinds).length) console.log(`  differ: ${Object.entries(r.kinds).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} ${n}`).join(', ')}`);
          if (Object.keys(r.emptyRule).length) console.log(`  all referenced fields empty (option "do not evaluate" on): ${Object.entries(r.emptyRule).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} ${n}`).join('; ')}`);
          if (Object.keys(r.timing).length) console.log(`  ExecuteSQL values not matching: ${Object.entries(r.timing).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} ${n}`).join('; ')}`);
          if (r.queries.length) console.log('by query shape:');
          const timing = (k: Record<string, number>) => (Object.keys(k).length ? `\n    not matching: ${Object.entries(k).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} ${n}`).join('; ')}` : '');
          const kinds = (k: Record<string, number>) => (Object.keys(k).length ? `\n    differ: ${Object.entries(k).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} ${n}`).join(', ')}` : '');
          for (const x of r.queries.slice(0, 40)) console.log(`  [${x.fields} field${x.fields === 1 ? '' : 's'}${x.problem ? `, can't run here: ${x.problem}` : ''}] ${x.shape.slice(0, 200)}\n    ${line(x.tally)}${kinds(x.kinds)}${timing(x.timing)}`);
          const fns = Object.entries(r.functions).filter(([, t]) => t.match < t.values).sort((a, b) => (b[1].values - b[1].match) - (a[1].values - a[1].match));
          if (fns.length) console.log('by function (values of formulas using it):');
          for (const [fn, t] of fns.slice(0, 30)) console.log(`  ${fn}: ${line(t)}`);
        }
      } finally {
        store.close();
        for (const o of others.values()) o.close();
      }
      return 0;
    }
    case 'check-solution': {
      const json = bool(args, '--json');
      optionValue(args, '--account', 'an account name');
      const account = flag(args, '--account');
      optionValue(args, '--fail-on', 'error or warning');
      const failOn = flag(args, '--fail-on') ?? 'warning';
      if (failOn !== 'error' && failOn !== 'warning') throw new Error(`check-solution: --fail-on is error or warning, not "${failOn}"`);
      const [database] = args;
      if (!database) throw new Error('check-solution: give a database');
      const file = join(path, database + STORE_EXT);
      if (!existsSync(file)) throw new Error(`check-solution: ${file} doesn't exist`);
      const store = new Store(file, database);
      const others = new Map<string, Store>();
      store.resolveFile = (name) => {
        if (!others.has(name) && existsSync(join(path, name + STORE_EXT))) others.set(name, new Store(join(path, name + STORE_EXT), name));
        return others.get(name);
      };
      try {
        let result;
        try {
          result = checkSolution(store, { account });
        } catch (e) {
          throw new Error(`check-solution: ${(e as Error).message}`);
        }
        process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : checkSolutionText(result));
        return result.counts.error || (failOn === 'warning' && result.counts.warning) ? 2 : 0;
      } finally {
        store.close();
        for (const o of others.values()) o.close();
      }
    }
    case 'stale-calcs': {
      const json = bool(args, '--json');
      const limit = Number(flag(args, '--n') ?? 10_000);
      const table = flag(args, '--table');
      const [database] = args;
      if (!database) throw new Error('stale-calcs: give a database');
      const file = join(path, database + STORE_EXT);
      if (!existsSync(file)) throw new Error(`stale-calcs: ${file} doesn't exist`);
      const store = new Store(file, database);
      const others = new Map<string, Store>();
      store.resolveFile = (name) => {
        if (!others.has(name) && existsSync(join(path, name + STORE_EXT))) others.set(name, new Store(join(path, name + STORE_EXT), name));
        return others.get(name);
      };
      try {
        const r = findStaleCalcs(store, { table, limit, examples: false });
        // Counts only (it runs on files whose data mustn't be printed): no record ids, no values.
        const fields = r.fields.map(({ recordIds: _, examples: __, ...f }) => f);
        if (json) console.log(JSON.stringify({ ...r, fields }, null, 2));
        else {
          console.log(`${database}: ${r.stale} out-of-date stored values in ${r.looked} looked at (${r.skipped.length} stored calculations skipped)`);
          for (const f of fields) {
            console.log(`  ${f.table}::${f.field} [${f.cause}]: ${f.stale} of ${f.looked}${f.looked < f.records ? ` (of ${f.records} records)` : ''} out of date`
              + `${f.wasEmpty ? `, ${f.wasEmpty} stored empty` : ''}${f.nowEmpty ? `, ${f.nowEmpty} now empty` : ''}${f.failing ? `, formula fails on ${f.failing}` : ''}`);
          }
          console.log(r.note);
        }
      } finally {
        store.close();
        for (const o of others.values()) o.close();
      }
      return 0;
    }
    case 'import-tables': {
      const preview = bool(args, '--preview');
      const json = bool(args, '--json');
      const noLinks = bool(args, '--no-links');
      const sets: string[] = [];
      for (let i = args.indexOf('--set'); i >= 0; i = args.indexOf('--set')) {
        const v = args[i + 1];
        if (v === undefined || v.startsWith('-')) throw new Error('import-tables: --set needs Sheet.Column=kind');
        sets.push(v);
        args.splice(i, 2);
      }
      const [database, ...files] = args;
      if (!database || !files.length) throw new Error('import-tables: give a database and the files to import');
      const sheets = readImportSheets(files);
      const overrides: ColumnOverrides = {};
      for (const spec of sets) {
        const eq = spec.lastIndexOf('=');
        const sheet = sheets.map((x) => x.name).filter((n) => eq > 0 && spec.startsWith(`${n}.`)).sort((a, b) => b.length - a.length)[0];
        if (eq < 0 || !sheet) throw new Error(`import-tables: --set ${spec}: write Sheet.Column=kind with a sheet from ${sheets.map((x) => x.name).join(', ')}`);
        (overrides[sheet] ??= {})[spec.slice(sheet.length + 1, eq)] = spec.slice(eq + 1) as ColumnKind;
      }
      const store = openDatabase(path, database);
      try {
        const plan = planImportTables(sheets, { overrides, existing: store.schema.tables.map((t) => t.name), links: !noLinks });
        if (preview || json) {
          if (json) console.log(JSON.stringify(plan, null, 2));
          else {
            for (const sh of plan.sheets) {
              console.log(`${sh.sheet} -> table "${sh.table}": ${sh.rows} rows${sh.ragged ? `, ${sh.ragged} ragged` : ''}`);
              for (const c of sh.columns) console.log(`  ${c.name.padEnd(32)} ${c.kind}${c.target ? ` -> ${c.target}` : ''}${c.inferred ? '' : ' (chosen)'}${c.options ? ` [${c.options.slice(0, 6).join(', ')}${c.options.length > 6 ? ', ...' : ''}]` : ''}`);
              for (const n of sh.notes) console.log(`  note: ${n}`);
            }
            for (const n of plan.notes) console.log(n);
          }
          if (preview) return 0;
        }
        const report = importTables(store, sheets, plan);
        for (const line of importTablesSummary(report)) console.log(line);
      } finally {
        store.close();
      }
      return 0;
    }
    case 'export-sql': {
      const out = flag(args, '--out');
      const dialect = flag(args, '--dialect') ?? 'postgres';
      const account = flag(args, '--account');
      const [database] = args;
      if (!database) throw new Error('export-sql: give a database');
      if (!out) throw new Error('export-sql: give --out file.sql (the script is written there, with container files in a folder beside it)');
      if (dialect !== 'postgres' && dialect !== 'sqlite') throw new Error('export-sql: --dialect is postgres or sqlite');
      checkSqlExportPath(out);
      if (existsSync(out)) throw new Error(`export-sql: ${out} already exists; choose another name or remove it`);
      const store = openDatabase(path, database);
      let fd: number | undefined;
      try {
        const privileges = account ? store.privileges(account) : undefined;
        const filesFolder = `${basename(out).replace(/\.sql$/i, '')}.files`;
        fd = openSync(out, 'wx', 0o600);
        const report = exportSql(store, {
          write: (text) => { writeSync(fd!, text); },
          file: (rel, data) => {
            const target = join(dirname(out), rel);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, data, { mode: 0o600 });
          },
        }, { dialect, privileges, filesFolder });
        for (const line of exportSqlSummary(report)) console.log(line);
        console.log(`wrote ${out}`);
      } catch (e) {
        if (fd !== undefined) { closeSync(fd); fd = undefined; rmSync(out, { force: true }); }
        throw e;
      } finally {
        if (fd !== undefined) closeSync(fd);
        store.close();
      }
      return 0;
    }
    case 'exit-bundle': {
      const out = flag(args, '--out');
      const account = flag(args, '--account');
      const discard = bool(args, '--discard');
      const [database] = args;
      if (!database) throw new Error('exit-bundle: give a database');
      if (!out) throw new Error('exit-bundle: give --out <folder> (the copy is written there; it must not exist yet)');
      if (!account) throw new Error('exit-bundle: give --account <a Full Access account>; you are asked for its password');
      const store = openDatabase(path, database);
      later((async () => {
        try {
          const password = process.env.TABULARIUS_PASSWORD ?? await readSecret(`Password for ${account} in ${database}`);
          if (discard) {
            await discardExitBundle(store, out, { account, password });
            console.log(`removed the unfinished copy ${resolve(out)}.partial`);
            return;
          }
          const report = await exitBundle(store, out, { account, password });
          console.log(`${report.tables} table${report.tables === 1 ? '' : 's'}, ${report.rows} row${report.rows === 1 ? '' : 's'}, ${report.containers} container file${report.containers === 1 ? '' : 's'}`);
          console.log(`wrote ${report.folder}`);
          console.log('This folder holds the whole file in plaintext, even when the server encrypts files at rest: keep it private, and delete it when you are done.');
        } finally {
          store.close();
        }
      })());
      return 0;
    }
    case 'layout-census': {
      const json = bool(args, '--json');
      // Layout names are the file's own words: only when asked for.
      const withNames = bool(args, '--names');
      const named = args.find((a) => !a.startsWith('--'));
      const names = named ? [named] : readdirSync(path).filter((f) => f.endsWith(STORE_EXT)).map((f) => f.slice(0, -STORE_EXT.length)).sort();
      if (!names.length) throw new Error(`layout-census: no databases in ${path}`);
      const steps = new Set([...SERVER_STEPS, ...SCREEN_STEPS]);
      const opened = new Map<string, Store>();
      const open = (name: string) => {
        if (!opened.has(name) && existsSync(join(path, name + STORE_EXT))) {
          const s = new Store(join(path, name + STORE_EXT), name);
          s.resolveFile = open; // occurrences of another hosted file's tables
          opened.set(name, s);
        }
        return opened.get(name);
      };
      const total: LayoutCensus = { layouts: 0, objects: {}, parts: {}, formulas: {}, unknownFunctions: {}, layoutIssues: {}, printing: {}, slow: { layouts: 0, objects: {}, worst: 0 } };
      const each: Record<string, LayoutCensus> = {};
      try {
        for (const name of names) {
          const store = open(name);
          if (!store) throw new Error(`layout-census: ${join(path, name + STORE_EXT)} doesn't exist`);
          each[name] = layoutCensus(store, { steps, names: withNames });
          addCensus(total, each[name]);
          if (!json && names.length > 1) console.log(censusText(each[name], name) + '\n');
        }
        if (json) console.log(JSON.stringify(names.length > 1 ? { total, files: each } : each[names[0]], null, 2));
        else console.log(censusText(total, names.length > 1 ? `All ${names.length} files` : names[0]));
      } finally {
        for (const s of opened.values()) s.close();
      }
      return 0;
    }
    case 'report': {
      const host = new Host(path);
      try {
        const names = args[0] && !args[0].startsWith('--') ? [args[0]] : host.names();
        for (const name of names) {
          const store = host.get(name);
          if (!store) throw new Error(`report: no database "${name}" in ${path}; hosted: ${host.names().join(', ')}`);
          const report = conversionReport(store, host.names());
          console.log(bool(args, '--json') ? JSON.stringify(report, null, 2) : report.summary + '\n');
        }
      } finally {
        host.close();
      }
      return 0;
    }
    case 'compact': {
      const host = new Host(path);
      try {
        const names = args[0] && !args[0].startsWith('--') ? [args[0]] : host.names();
        if (!names.length) throw new Error(`compact: no hosted files in ${path}`);
        const reports = names.map((name) => {
          const store = host.get(name);
          if (!store) throw new Error(`compact: no database "${name}" in ${path}; hosted: ${host.names().join(', ')}`);
          return { name, report: compactStore(store.path) };
        });
        if (bool(args, '--json')) console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
        else for (const { name, report: r } of reports) console.log(`${name}: ${r.beforeBytes} -> ${r.afterBytes} bytes; WAL ${r.walBeforeBytes} -> ${r.walAfterBytes}; ${r.durationMs} ms (${r.writerWaitMs} ms waiting for a writer); free pages ${r.freePagesBefore} -> ${r.freePagesAfter}`);
      } finally { void host.close(); }
      return 0;
    }
    case 'optimize': {
      if (path.toLowerCase().endsWith('.fmp12')) break; // a FileMaker file: below
      const host = new Host(path);
      try {
        const names = args[0] && !args[0].startsWith('--') ? [args[0]] : host.names();
        const reports = names.map((name) => {
          const store = host.get(name);
          if (!store) throw new Error(`optimize: no database "${name}" in ${path}; hosted: ${host.names().join(', ')}`);
          const purge = bool(args, '--purge-orphans') ? store.purgeOrphanContainers() : undefined;
          return { ...optimizationReport(store), orphanContainers: { ...store.orphanContainerReport(), integrity: store.containerIntegrityReport(), ...(purge ? { purge } : {}) } };
        });
        if (bool(args, '--json')) console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
        else console.log(reports.map((r) => `${r.text}\n\nUnreferenced containers: ${r.orphanContainers.count}${r.orphanContainers.purge ? ` (purged ${r.orphanContainers.purge.removed}, ${r.orphanContainers.purge.bytes} bytes, ${r.orphanContainers.purge.externalFiles} external files)` : ''}`).join('\n\n'));
      } finally {
        host.close();
      }
      return 0;
    }
    case 'passwd': {
      const privilegeSet = flag(args, '--privilege-set');
      const mustChangeIdx = args.indexOf('--must-change');
      const mustChange = mustChangeIdx >= 0;
      if (mustChange) args.splice(mustChangeIdx, 1);
      const [database, account] = args;
      if (!database || !account) throw new Error('passwd: give a database and an account name');
      const store = openDatabase(path, database);
      try {
        if (!privilegeSet && !store.accountPrivilegeSet(account) && !store.accounts().some((a) => a.name.toLowerCase() === account.toLowerCase())) {
          throw new Error(`passwd: ${account} is a new account; give it a privilege set with --privilege-set (${store.privilegeSets().map((p) => p.name).join(', ')})`);
        }
        if (privilegeSet && !store.privilegeSet(privilegeSet)) {
          throw new Error(`passwd: no privilege set "${privilegeSet}"; sets: ${store.privilegeSets().map((p) => p.name).join(', ')}`);
        }
      } catch (e) {
        store.close();
        throw e;
      }
      later((async () => {
        try {
          const password = process.env.TABULARIUS_PASSWORD ?? await readSecret(`New password for ${account}`, { confirm: true });
          if (!password) throw new Error(`passwd: empty password. Type one at the prompt, or pipe it in: echo 'new-password' | tabularius passwd ${path} ${database} ${account}`);
          store.setPassword(account, password, privilegeSet, { mustChange });
          // Set anyway (the file's policy has already refused what it won't take), but said out loud.
          if (!password.trim()) console.error(`warning: the password for ${account} is only spaces; anyone can guess that`);
          else if (password.length < 12) console.error(`warning: the password for ${account} is only ${password.length} character${password.length === 1 ? '' : 's'}; 12 or more is safer (change it with: tabularius passwd ${path} ${database} ${account})`);
        } finally {
          store.close();
        }
        console.log(`password set for ${account} in ${database}${mustChange ? ' (must change on next sign-in)' : ''}`);
        // The running server keeps its sign-ins and lockouts in memory, where this command cannot reach.
        const hosting = runningServer(path);
        if (hosting !== undefined) console.error(`note: the server is running (process ${hosting}). Anyone already signed in as ${account} is signed out at their next call (service tokens, ohbt_..., stay valid), but a sign-in lockout on it stays until it ends. To lift the lockout now, use Unlock in the admin console (Security health, Account access).`);
      })());
      return 0;
    }
    case 'reconvert': {
      // Files converted by an older version, converted again from their .fmp12 with the edits made since.
      // With the server running, it is asked to do it (closing only that file); otherwise it's done here.
      const force = bool(args, '--force');
      const all = bool(args, '--all');
      const dryRun = bool(args, '--dry-run');
      const sameFile = bool(args, '--same-file');
      const [database] = args;
      if (!database && !all) throw new Error('reconvert: give a database, or --all');
      const summary = (name: string, p: ReconvertPreview, unsafe?: string) => {
        const fixed = p.tables.filter((t) => t.changed);
        console.log(`${name}: ${p.accounts.after} of ${p.accounts.before} accounts kept; ${p.editsCarried ? 'edits made since kept' : `edits made since NOT kept (${unsafe})`}; ` +
          `${fixed.reduce((n, t) => n + t.changed, 0)} records read differently${fixed.length ? ` (${fixed.map((t) => `${t.table} ${t.changed}`).join(', ')})` : ''}; ` +
          `container files ${p.containers.before} -> ${p.containers.after}`);
      };
      const done = (name: string, r: { created: number; edited: number; deleted: number; backup: string }, unsafe?: string) =>
        console.log(`converted ${name} again: ${unsafe ? `edits made since were not carried over (${unsafe})` : `${r.created} records created, ${r.edited} changed and ${r.deleted} deleted since were kept, with the accounts and settings`}; the store as it was: ${basename(r.backup)}`);
      if (runningServer(path) !== undefined) {
        later((async () => {
          if (all) {
            const preview = await askServer(path, 'POST', '/tabularius/admin/v1/reconvert-all', { preview: true, sameFile });
            if (preview.status !== 200) throw new Error(`reconvert: ${preview.body.error}`);
            const files = preview.body.files as { name: string; error?: string; check: { unsafe?: string }; preview: ReconvertPreview }[];
            if (!files.length) return console.log('no files need converting again');
            for (const f of files) f.error ? console.log(`${f.name}: ${f.error}`) : summary(f.name, f.preview, f.check.unsafe);
            const go = files.filter((f) => !f.error && (force || !f.check.unsafe));
            const held = files.filter((f) => !f.error && !force && f.check.unsafe);
            if (held.length) console.log(`not converting ${held.map((f) => f.name).join(', ')} without --force (${held[0].check.unsafe})`);
            if (dryRun || !go.length) return;
            const r = await askServer(path, 'POST', '/tabularius/admin/v1/reconvert-all', { files: go.map((f) => f.name), sameFile });
            for (const f of r.body.files as { name: string; error?: string; created: number; edited: number; deleted: number; backup: string }[]) {
              if (f.error) console.log(`${f.name}: ${f.error}`);
              else done(f.name, f, files.find((x) => x.name === f.name)?.check.unsafe);
            }
            return;
          }
          // An encrypted .fmp12's passphrase goes with these two requests only.
          const source = join(path, database + '.fmp12');
          const passphrase = existsSync(source) ? await sourcePassphrase(source) : undefined;
          const p = await askServer(path, 'POST', `/tabularius/admin/v1/files/${encodeURIComponent(database)}/reconvert-preview`, { sameFile, passphrase });
          if (p.status !== 200) throw new Error(`reconvert: ${p.body.error}`);
          const check = p.body.check as { unsafe?: string };
          summary(database, p.body.preview as ReconvertPreview, check.unsafe);
          if (dryRun) return;
          if (check.unsafe && !force) throw new Error(`reconvert: can't carry edits over: ${check.unsafe}; --force converts afresh without them${/copied/.test(check.unsafe) ? ', --same-file keeps them' : ''}`);
          const r = await askServer(path, 'POST', `/tabularius/admin/v1/files/${encodeURIComponent(database)}/reconvert`, { force, sameFile, passphrase });
          if (r.status !== 200) throw new Error(`reconvert: ${r.body.error}`);
          done(database, r.body as { created: number; edited: number; deleted: number; backup: string }, check.unsafe);
        })());
        return 0;
      }
      const names = all
        ? readdirSync(path).filter((f) => f.endsWith(STORE_EXT)).map((f) => f.slice(0, -STORE_EXT.length))
          .filter((n) => existsSync(join(path, n + '.fmp12')) && reconvertCheck(join(path, n + STORE_EXT), join(path, n + '.fmp12'), { sameFile }).outdated)
        : [database];
      if (all && !names.length) {
        console.log('no files need converting again');
        return 0;
      }
      later((async () => {
        for (const name of names) {
          const store = join(path, name + STORE_EXT);
          const fmp12 = join(path, name + '.fmp12');
          if (!existsSync(store)) throw new Error(`reconvert: ${store} doesn't exist`);
          const check = reconvertCheck(store, fmp12, { sameFile });
          if (check.native) throw new Error(NATIVE_REFUSAL);
          if (!check.outdated && !all) console.log(`${name} was converted by this version already; converting it again anyway`);
          const passphrase = existsSync(fmp12) ? await sourcePassphrase(fmp12) : undefined;
          if (dryRun) {
            summary(name, (await reconvert(store, fmp12, { force: !!check.unsafe, dryRun: true, sameFile, passphrase })).preview!, check.unsafe);
            continue;
          }
          if (check.unsafe && !force) {
            console.log(`${name}: can't carry edits over: ${check.unsafe}; --force converts afresh without them${check.unverified ? ', --same-file keeps them' : ''}`);
            continue;
          }
          done(name, await reconvert(store, fmp12, { force, sameFile, passphrase }), check.unsafe);
        }
      })());
      return 0;
    }
    case 'plugins': {
      const [action = 'list', database, id] = args;
      // keygen and pack don't use the folder; everything else would otherwise report an empty one that isn't there.
      if (action !== 'keygen' && action !== 'pack' && !existsSync(path)) throw new Error(`plugins: the folder ${path} isn't there`);
      if (action === 'enable' || action === 'disable') {
        if (!database || !id) throw new Error(`plugins ${action}: give a database and a plug-in id`);
        setPluginEnabled(path, database.replace(/\.fmp12$/i, ''), id, action === 'enable');
        console.log(`${id} is ${action === 'enable' ? 'on' : 'off'} for ${database} when the server next starts`);
        return 0;
      }
      if (action === 'script-install') {
        const config = new ServerConfig(path);
        if (database === 'on' || database === 'off') config.setScriptPluginInstall(database === 'on');
        else if (database !== undefined && database !== 'status') throw new Error('plugins script-install: on, off or status');
        console.log(`Install Plug-In File is ${config.scriptPluginInstall() ? 'on: scripts with full access may install packages signed by a trusted publisher' : 'off'}`);
        return 0;
      }
      if (action === 'keygen') {
        const file = database;
        if (!file) throw new Error('plugins keygen: give a file for the private key');
        if (existsSync(file)) throw new Error(`${file} is already there`);
        const key = generateKey();
        writeFileSync(file, key.privatePem, { mode: 0o600 });
        console.log(`Private key written to ${file} (keep it secret and backed up).\nPublisher fingerprint: ${key.fingerprint}`);
        return 0;
      }
      if (action === 'pack') {
        const dir = database;
        if (!dir) throw new Error('plugins pack: give the plug-in folder');
        const keyFile = optionValue(args, '--key', 'a file (the private key plugins keygen wrote)');
        const outFile = optionValue(args, '-o', 'a file name');
        const packed = packPlugin(dir, keyFile ? readFileSync(keyFile, 'utf8') : undefined);
        const out = outFile ?? packed.name;
        writeFileSync(out, packed.bytes);
        console.log(`${out}: ${packed.fingerprint ? `signed by ${packed.fingerprint}` : 'not signed'}`);
        return 0;
      }
      if (action === 'install') {
        const file = database;
        if (!file) throw new Error('plugins install: give a .ohplugin package');
        const trust = optionValue(args, '--trust', 'a publisher fingerprint');
        const bytes = readFileSync(file);
        // The permissions are shown first, so the admin sees what is being asked for.
        const info = readPackage(bytes);
        const perms = info.manifest.permissions;
        const asked = [...perms.files, ...perms.network.map((h) => `web: ${h}`), ...(perms.mail ? ['mail'] : []), ...perms.secrets.map((n) => `secret: ${n}`)];
        console.log(`${info.manifest.name} ${info.manifest.version} by ${info.manifest.publisher}: ${info.manifest.functions.length} function${info.manifest.functions.length === 1 ? '' : 's'}; asks for ${asked.length ? asked.join(', ') : 'nothing beyond calculating'}`);
        const done = installPackage(path, bytes, { allowUnsigned: args.includes('--allow-unsigned'), trust, replace: args.includes('--replace') });
        console.log(`Installed ${done.manifest.id} ${done.manifest.version}${done.signer ? `, signed by ${done.signer}` : ' (unsigned)'}${done.replaced ? `, replacing ${done.replaced}` : ''}. Turn it on for a file with: tabularius plugins ${path} enable <database> ${done.manifest.id}`);
        return 0;
      }
      if (action === 'uninstall') {
        if (!database) throw new Error('plugins uninstall: give a plug-in id');
        const enabledFor = Object.entries(pluginStatus(path).enabled).filter(([, ids]) => ids.includes(database)).map(([f]) => f);
        uninstallPlugin(path, database, enabledFor);
        console.log(`${database} is uninstalled`);
        return 0;
      }
      if (action === 'secret') {
        const name = id;
        const pluginId = database;
        if (!pluginId || !name) throw new Error('plugins secret: give a plug-in id and the secret\'s name');
        const clear = args.includes('--clear');
        // From standard input, so the value isn't left in the shell's history or the process list.
        const value = clear ? undefined : readFileSync(0, 'utf8').replace(/\r?\n$/, '');
        setPluginSecret(path, pluginId, name, value);
        console.log(`${pluginId}'s ${name} is ${clear ? 'cleared' : 'set'}`);
        return 0;
      }
      if (action !== 'list') throw new Error('plugins: give list, enable, disable, secret, install, uninstall, keygen or pack');
      const st = pluginStatus(path);
      if (!st.installed.length) console.log(`No plug-ins in ${join(path, 'plugins')}`);
      for (const m of st.installed) {
        const files = Object.entries(st.enabled).filter(([, ids]) => ids.includes(m.id)).map(([f]) => f);
        console.log(`${m.name} ${m.version} (${m.id}) by ${m.publisher}: ${m.functions.length} function${m.functions.length === 1 ? '' : 's'}, ${files.length ? 'on for ' + files.join(', ') : 'not on for any file'}`);
        const rec = st.installs[m.id];
        if (rec) console.log(`  installed from a package ${rec.signer ? `signed by ${rec.signer}` : 'without a signature'}`);
        const unset = m.permissions.secrets.filter((n) => !st.secrets[m.id]?.includes(n));
        if (m.permissions.secrets.length) console.log(`  secrets: ${m.permissions.secrets.map((n) => `${n} ${unset.includes(n) ? 'not set' : 'set'}`).join(', ')}`);
      }
      for (const b of st.builtins) console.log(`${b.name} (${b.id}) built in: ${b.offFor.length ? 'off for ' + b.offFor.join(', ') : 'on for every file'}`);
      for (const p of st.problems) console.log(p);
      return 0;
    }
    case 'privileges': {
      const [database, action, a, b] = args;
      if (!database) throw new Error('privileges: give a database');
      const store = openDatabase(path, database);
      try {
        privileges(store, action, a, b);
      } finally {
        store.close();
      }
      return 0;
    }
    case 'token': {
      const [database, action, rest] = args;
      if (!database || !action) throw new Error('token: give a database and an action (create, list, revoke)');
      const days = action === 'create' ? expiryDays(args, 'token create') : undefined;
      const surfaces = action === 'create' ? strictFlag(args, '--surfaces') : undefined;
      const layouts = action === 'create' ? strictFlag(args, '--layouts') : undefined;
      // --read-only is taken before --label, so a label can't swallow it and leave the token writable.
      const readOnly = action === 'create' && bool(args, '--read-only');
      const label = action === 'create' ? flag(args, '--label') : undefined;
      if (label !== undefined && KNOWN_OPTIONS.has(label)) throw new Error(`token create: --label needs a label, found the option ${label}`);
      const scope = (value: string | undefined, name: string) => {
        if (value === undefined) return undefined;
        const entries = value.split(',').map((s) => s.trim()).filter(Boolean);
        if (!entries.length) throw new Error(`${name} needs at least one value`);
        return entries;
      };
      const tokenSurfaces = scope(surfaces, '--surfaces');
      const tokenLayouts = scope(layouts, '--layouts');
      // An option written --name=value, or one this command doesn't know, would otherwise be ignored and the token made without the restriction.
      const stray = action === 'create' ? args.slice(3).find((a) => a.startsWith('-')) : undefined;
      if (stray !== undefined) throw new Error(`token create: ${stray} is not an option it knows; write an option and its value as two words (--surfaces fmrest)`);
      const store = openDatabase(path, database);
      try {
        if (action === 'create') {
          const account = rest;
          if (!account) throw new Error('token create: give the account the token acts as');
          const token = store.createApiToken(account, {
            label,
            readOnly,
            // Left out, the token lives the default (90 days, TABULARIUS_TOKEN_DEFAULT_DAYS); 0 or "never" asks for none.
            expires: tokenExpiry(days === undefined ? undefined : Number(days)),
            surfaces: tokenSurfaces,
            layouts: tokenLayouts,
            provenance: 'service',
          });
          console.log(token);
          process.stderr.write(`Created an API token for ${account}${readOnly ? ' (read-only)' : ''}. It is shown once above; store it now.\n`);
        } else if (action === 'list') {
          for (const t of store.apiTokens()) console.log(JSON.stringify(t));
        } else if (action === 'revoke') {
          if (!rest) throw new Error('token revoke: give the token id (from token list)');
          if (!store.revokeApiToken(rest)) throw new Error(`no token ${rest}`);
          console.log(`revoked ${rest}`);
        } else throw new Error(`token: unknown action "${action}" (create, list, revoke)`);
      } finally {
        store.close();
      }
      return 0;
    }
    case 'calendar-feed': {
      const [database, action, rest] = args;
      if (!database || !action) throw new Error('calendar-feed: give a database and an action (create, list, revoke)');
      const json = bool(args, '--json');
      const store = openDatabase(path, database);
      try {
        if (action === 'create') {
          const account = flag(args, '--account');
          if (!account) throw new Error('calendar-feed create: give --account, the account the feed shows records as');
          const layout = flag(args, '--layout');
          const start = flag(args, '--start');
          if (!layout || !start) throw new Error('calendar-feed create: give --layout and --start (a date or timestamp field)');
          const days = expiryDays(args, 'calendar-feed create');
          const limit = flag(args, '--limit');
          if (limit !== undefined && !/^\d+$/.test(limit)) throw new Error(`calendar-feed create: --limit takes a whole number, not "${limit}"`);
          const publicUrl = flag(args, '--public-url');
          if (publicUrl) validatePublicUrl(publicUrl);
          const known = store.accounts().find((a) => a.name.toLowerCase() === account.toLowerCase());
          if (!known) throw new Error(`calendar-feed create: no account named "${account}" (accounts: ${store.accounts().map((a) => a.name).join(', ') || 'none'})`);
          if (known.inactive) throw new Error(`calendar-feed create: account "${known.name}" is turned off; a link made for it would start working when it is turned on`);
          const made = createFeed(store, known.name, store.privileges(known.name), {
            layout, start, end: flag(args, '--end'), title: flag(args, '--title'), description: flag(args, '--description'), location: flag(args, '--location'),
            zone: flag(args, '--zone'), query: flag(args, '--query'), label: flag(args, '--label'),
            ...(limit !== undefined ? { limit: Number(limit) } : {}), ...(days !== undefined ? { expiresDays: Number(days) } : {}),
          });
          const url = publicUrl ? publicUrl.replace(/\/$/, '') + made.address : undefined;
          if (json) console.log(JSON.stringify({ id: made.id, layout: made.layout, address: made.address, ...(url ? { url } : {}) }));
          else console.log(url ?? made.address);
          process.stderr.write(`Created calendar feed ${made.id} for ${account}. The address is shown once above; store it now.${url ? '' : ' Put your server\'s address in front of it (or give --public-url).'}\n`);
        } else if (action === 'list') {
          const feeds = listFeeds(store);
          if (json) console.log(JSON.stringify(feeds));
          else for (const f of feeds) console.log(`${f.id}  ${f.layout}  as ${f.account}${f.label ? `  "${f.label.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')}"` : ''}  made ${f.created}${f.expires ? `  expires ${f.expires}` : ''}${f.lastUsed ? `  last used ${f.lastUsed}` : ''}`);
        } else if (action === 'revoke') {
          if (!rest) throw new Error('calendar-feed revoke: give the feed id (from calendar-feed list)');
          if (!revokeFeed(store, rest)) throw new Error(`no calendar feed ${rest}`);
          console.log(json ? JSON.stringify({ revoked: rest }) : `revoked ${rest}`);
        } else throw new Error(`calendar-feed: unknown action "${action}" (create, list, revoke)`);
      } finally {
        store.close();
      }
      return 0;
    }
    case 'import-ics': {
      const [database, file] = args;
      if (!database || !file) throw new Error('import-ics: give a database and an .ics file');
      const json = bool(args, '--json');
      const account = flag(args, '--account');
      const layout = flag(args, '--layout');
      const start = flag(args, '--start');
      if (!account || !layout || !start) throw new Error('import-ics: give --account, --layout and --start (a date or timestamp field)');
      if (!existsSync(file)) throw new Error(`import-ics: no file ${file}`);
      if (statSync(file).size > 8 * 1024 * 1024) throw new Error('import-ics: the file is over 8 MB, which is more than one import takes');
      const store = openDatabase(path, database);
      try {
        const done = importIcs(store, store.privileges(account), account, {
          layout, start, end: flag(args, '--end'), title: flag(args, '--title'), description: flag(args, '--description'), location: flag(args, '--location'),
          uid: flag(args, '--uid'), zone: flag(args, '--zone'),
        }, readFileSync(file, 'utf8'));
        if (json) console.log(JSON.stringify(done));
        else {
          console.log(`imported ${done.imported} event${done.imported === 1 ? '' : 's'}${done.skipped ? `, skipped ${done.skipped}` : ''}`);
          for (const n of done.notes) console.log(`note: ${n}`);
        }
      } finally {
        store.close();
      }
      return 0;
    }
    case 'ai-policy': {
      const [database, action] = args;
      if (!database || !['on', 'off'].includes(action)) throw new Error('ai-policy: give a database and on|off');
      const store = openDatabase(path, database);
      try { store.setAiPolicy(action === 'on'); console.log(`AI policy ${store.aiPolicy ? 'on' : 'off'} for ${store.name}`); }
      finally { store.close(); }
      return 0;
    }
    case 'ai': {
      const aiExclude = aiExcludeFrom(args);
      const [database, action, sub] = args;
      if (action === 'pii') {
        // Personal data isolation: names, emails, phones, addresses, ids and free text go to AI only as stand-ins.
        if (!['on', 'off', 'status'].includes(sub ?? '')) throw new Error('ai pii: give on, off or status');
        const file = readdirSync(path).find((f) => f.toLowerCase() === database.replace(/\.fmp12$/i, '').toLowerCase() + STORE_EXT.toLowerCase());
        if (!file) throw new Error(`ai: no converted database named "${database}" in ${path}`);
        const store = new Store(join(path, file), file.slice(0, -STORE_EXT.length));
        try {
          if (sub !== 'status') store.setPiiIsolation(sub === 'on', { account: 'command line' });
          // Off: the values kept for stand-ins go with it.
          if (sub === 'off') forgetVault(store);
          console.log(store.piiIsolation
            ? `Personal data isolation is on for ${database}: AI models get stand-ins like <PERSON_3> for personal data, and tools that can't be checked field by field are refused`
            : `Personal data isolation is off for ${database}: AI sees the values in every field an account can see`);
        } finally {
          store.close();
        }
        return 0;
      }
      if (!database || !['on', 'off', 'status'].includes(action ?? '')) throw new Error('ai: give a database and on, off, status or pii on|off|status');
      // As the server sees it: a file that uses one with AI off is kept from AI too, and so is one the server is told
      // to keep from AI (--ai-exclude, or TABULARIUS_AI_EXCLUDE). Only files already converted are opened, and only
      // the ones this file uses, so a status check never converts or touches anything else in the folder.
      const opened = new Map<string, Store>();
      const open = (name: string) => {
        const key = name.replace(/\.fmp12$/i, '').toLowerCase();
        if (!opened.has(key)) {
          const file = readdirSync(path).find((f) => f.toLowerCase() === key + STORE_EXT.toLowerCase());
          if (!file) return undefined;
          const s = new Store(join(path, file), file.slice(0, -STORE_EXT.length));
          s.resolveFile = open;
          if (aiExclude.some((n) => n.replace(/\.fmp12$/i, '').toLowerCase() === key)) s.aiExcludedByServer = true;
          opened.set(key, s);
        }
        return opened.get(key);
      };
      try {
        const store = open(database);
        if (!store) throw new Error(`ai: no converted database named "${database}" in ${path}`);
        if (action !== 'status') store.setAiAllowed(action === 'on', { account: 'command line' });
        const st = aiStatus(store);
        console.log(st.allowed
          ? `AI is on for ${database}: AI apps and the assistant can read it, within each account's privileges (fmmcp)`
          : `AI is off for ${database}: AI apps (MCP) and the AI assistant don't read it, for any account` +
            (st.turnedOff ? '' : st.through ? ` (it uses data from ${st.through}, which has AI turned off)` : ' (--ai-exclude keeps it from AI)'));
      } finally {
        for (const s of opened.values()) s.close();
      }
      return 0;
    }
    case 'totp': {
      const [database, action, account, code] = args;
      if (!database || !action) throw new Error('totp: give a database and an action (enroll, confirm, status, disable)');
      const store = openDatabase(path, database);
      try {
        if (action === 'enroll') {
          if (!account) throw new Error('totp enroll: give the account');
          const { secret, uri } = store.enrollTotp(account);
          console.log(`Secret: ${secret}`);
          console.log(`Add to an authenticator app: ${uri}`);
          process.stderr.write(`Then confirm with: tabularius totp ${path} ${database} confirm ${account} <code>\n`);
        } else if (action === 'confirm') {
          if (!account || !code) throw new Error('totp confirm: give the account and a 6-digit code');
          if (!store.confirmTotp(account, code)) throw new Error('that code did not match; try the current one');
          console.log(`two-factor sign-in is on for ${account}`);
        } else if (action === 'status') {
          const on = store.totpAccounts();
          console.log(on.length ? `two-factor on: ${on.join(', ')}` : 'no accounts have two-factor sign-in');
        } else if (action === 'disable') {
          if (!account) throw new Error('totp disable: give the account');
          if (!store.disableTotp(account)) throw new Error(`${account} had no two-factor sign-in`);
          console.log(`two-factor sign-in is off for ${account}`);
        } else throw new Error(`totp: unknown action "${action}" (enroll, confirm, status, disable)`);
      } finally {
        store.close();
      }
      return 0;
    }
    case 'audit': {
      if (path === 'verify') {
        const [folder, database] = args;
        if (!folder || !database) throw new Error('audit verify: give a folder and database');
        const file = join(folder, database + STORE_EXT);
        const chain = flag(args, '--chain') ?? 'security';
        if (chain !== 'security' && chain !== 'records') throw new Error(`audit verify: --chain takes security (sign-ins and privilege changes) or records (record changes), not "${chain}"`);
        const keyFile = flag(args, '--sign-key');
        const checkFile = flag(args, '--check');
        if (checkFile && !keyFile) throw new Error('audit verify: --check needs the --sign-key the anchor was signed with');
        const result = chain === 'records' ? verifyRecordAudit(file) : verifySecurityAudit(file);
        const out: Record<string, unknown> = { ...result };
        let anchored = true;
        if (keyFile) {
          const key = readFileSync(keyFile);
          if (checkFile) {
            const check = checkAnchor(file, JSON.parse(readFileSync(checkFile, 'utf8')), key);
            out.anchorCheck = check;
            anchored = check.ok;
          }
          // A chain that fails its own check is never signed: the anchor would vouch for it.
          if (result.ok) out.anchor = anchorHead(file, chain, key);
        }
        console.log(JSON.stringify(out));
        return result.ok && anchored ? 0 : result.status === 'unprotected' ? 2 : 1;
      }
      const [database] = args;
      if (!database) throw new Error('audit: give a database');
      const store = openDatabase(path, database);
      try {
        const n = flag(args, '--record');
        const limit = flag(args, '--limit');
        const since = flag(args, '--since');
        if (n !== undefined && !/^[1-9]\d*$/.test(n)) throw new Error(`audit: --record takes a record id (a whole number), not "${n}"`);
        if (since !== undefined && Number.isNaN(Date.parse(since))) throw new Error(`audit: --since takes a date or time such as 2026-10-01 or 2026-10-01T08:00:00Z, not "${since}"`);
        for (const e of store.auditLog({ table: flag(args, '--table'), recordId: n === undefined ? undefined : Number(n), account: flag(args, '--account'), since, limit: limit === undefined ? undefined : Number(limit) })) {
          console.log(auditJsonLine(e));
        }
      } finally {
        store.close();
      }
      return 0;
    }
    case 'new': {
      const [database] = args;
      if (!database) throw new Error('new: give the new database a name');
      const problem = databaseNameProblem(database);
      if (problem) throw new Error(`new: "${database}" is not a usable name. ${problem}`);
      const out = join(path, database + STORE_EXT);
      if (existsSync(out)) throw new Error(`${out} already exists`);
      const starterAt = args.indexOf('--starter');
      const starter = starterAt >= 0 ? args[starterAt + 1] : undefined;
      if (starterAt >= 0 && (!starter || !STARTER_NAMES.includes(starter))) {
        throw new Error(`new: --starter takes one of ${STARTER_NAMES.join(', ')}${starter ? ` (not "${starter}")` : ''}`);
      }
      if (args.includes('--no-sample') && !starter) throw new Error('new: --no-sample goes with --starter');
      if (existsSync(path) && !statSync(path).isDirectory()) throw new Error(`new: ${path} is a file; give the folder to put the new database in`);
      try { mkdirSync(path, { recursive: true }); } catch (e) { throw new Error(`new: ${path} can't be made (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}); choose a folder this user can write to`); }
      createStore(out, args.includes('--native') ? { mode: 'native' } : undefined);
      if (starter) {
        const store = new Store(out, database);
        try {
          const made = applyStarter(store, starter, { sample: !args.includes('--no-sample'), account: 'tabularius new' });
          console.log(`created ${database} from the ${starter} starter: ${made.tables} tables, ${made.layouts} layouts, ${made.scripts} scripts, ${made.privilegeSets.length} privilege sets (${made.privilegeSets.join(', ')})`);
          if (made.sampleRecords) console.log(`${made.sampleRecords} sample records were added; the ones with a Notes field say so there. Delete them when you are ready, or start again with --no-sample`);
        } catch (e) {
          store.close();
          rmSync(out, { force: true });
          throw e;
        }
        store.close();
      }
      console.log(`created ${database}; set a password with: tabularius passwd ${path} ${database} Admin`);
      return 0;
    }
    case 'design-text': {
      if (path.toLowerCase().endsWith('.fmp12')) break; // a FileMaker file: below
      const [database, out] = args;
      if (!database || !out) throw new Error('design-text: give a database and a folder to write to');
      const file = join(path, database + STORE_EXT);
      if (!existsSync(file)) throw new Error(`design-text: ${file} doesn't exist`);
      const store = new Store(file, database);
      try {
        const files = designText({ schema: store.schema, layouts: store.designs().layouts, accounts: store.accounts(), privilegeSets: store.privilegeSets() });
        console.log(designTextSummary(out, writeDesignText(out, files), files.size));
      } finally {
        store.close();
      }
      return 0;
    }
    case 'design-apply': {
      const [database, from] = args;
      if (!database || !from) throw new Error('design-apply: give a database and the folder design-text wrote');
      const file = join(path, database + STORE_EXT);
      if (!existsSync(file)) throw new Error(`design-apply: ${file} doesn't exist`);
      const store = new Store(file, database);
      try {
        const plan = planDesignApply(readDesignFolder(from), { schema: store.schema, layouts: store.designs().layouts, accounts: store.accounts(), privilegeSets: store.privilegeSets() }, { remove: args.includes('--remove') });
        for (const line of plan.lines) console.log(line);
        for (const note of plan.skipped) console.log(`skipped: ${note}`);
        if (!plan.ops.length) {
          console.log(`${database}: nothing to change (${plan.unchanged} files already match)`);
        } else if (args.includes('--apply')) {
          const { applied } = store.applyDesign(plan.ops, { account: 'tabularius design-apply' });
          console.log(`${database}: ${applied.length} changes made`);
        } else {
          console.log(`${plan.ops.length} changes; nothing was changed. Run again with --apply to make them`);
        }
      } finally {
        store.close();
      }
      return 0;
    }
    case 'design': {
      const [database, file] = args;
      if (!database || !file) throw new Error('design: give a database and a JSON file of changes');
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      const store = openDatabase(path, database);
      try {
        const { applied } = store.applyDesign(Array.isArray(parsed) ? parsed : parsed.changes as DesignOp[], { account: 'Tabularius design' });
        console.log(JSON.stringify(applied, null, 2));
      } finally {
        store.close();
      }
      return 0;
    }
  }

  if (!FILE_COMMANDS.has(cmd)) {
    process.stderr.write(unknownCommand(cmd));
    return 1;
  }
  // `info`, `schema` and `records` also read a hosted database.
  if ((cmd === 'info' || cmd === 'schema' || cmd === 'records') && existsSync(path) && (statSync(path).isDirectory() || path.endsWith(STORE_EXT))) {
    const hosted = path.endsWith(STORE_EXT) && !statSync(path).isDirectory();
    const folder = hosted ? dirname(path) : path;
    const database = hosted ? basename(path).slice(0, -STORE_EXT.length) : args.shift();
    if (!database) throw new Error(`${cmd}: give a database in ${path}`);
    const store = openDatabase(folder, database);
    try {
      if (cmd === 'info') {
        console.log(JSON.stringify({ tabularius: SERVER_VERSION, openhbam: SERVER_VERSION, file: basename(store.path), fileMode: store.fileMode, aiPolicy: store.aiPolicy, dateOrder: store.dateOrder, ...counts(store.schema) }, null, 2));
        return 0;
      }
      return hostedRead(cmd, store, args);
    } finally {
      store.close();
    }
  }

  // An Encryption at Rest file needs its passphrase: from the environment, or
  // asked for hidden in a terminal (never an argument, so it isn't in logs or
  // the process list), and not kept after.
  const encSource = fileSource(path);
  let enc: ReturnType<typeof encryptionInfo>;
  try {
    enc = encryptionInfo(encSource);
  } finally {
    encSource.close?.();
  }
  if (enc.encrypted && !process.env.TABULARIUS_SOURCE_PASSPHRASE && promptedPassphrase === undefined) {
    // Asked for once, then the command runs again with it.
    later(sourcePassphrase(path).then((p) => {
      promptedPassphrase = p;
      process.exitCode = main(argv);
    }));
    return 0;
  }
  const db = FmpDatabase.open(path, process.env.TABULARIUS_SOURCE_PASSPHRASE ?? promptedPassphrase);
  switch (cmd) {
    case 'info': {
      console.log(JSON.stringify({ tabularius: SERVER_VERSION, openhbam: SERVER_VERSION, file: basename(path), ...db.file.header, blocks: db.file.blockCount, ...counts(db.schema) }, null, 2));
      return 0;
    }
    case 'design-text': {
      const [out] = args;
      if (!out) throw new Error('design-text: give a folder to write to');
      const sets = db.schema.privilegeSets;
      const files = designText({
        schema: db.schema,
        layouts: readLayoutDesigns(db.file, db.schema).layouts,
        accounts: db.schema.accounts.map((a) => ({ name: a.name, privilegeSet: sets.find((p) => p.id === a.privilegeSetId)?.name, ...(a.external ? { external: true } : {}) })),
        privilegeSets: sets,
      });
      console.log(designTextSummary(out, writeDesignText(out, files), files.size));
      return 0;
    }
    case 'ddr': {
      process.stdout.write(designReport(db.schema, readLayoutDesigns(db.file, db.schema), { fileName: basename(path) }));
      return 0;
    }
    case 'style-census': {
      const c = styleCensus(db.file, db.schema);
      console.log(bool(args, '--json') ? JSON.stringify(c, null, 2) : styleCensusText(c, basename(path)));
      return 0;
    }
    case 'schema': {
      if (bool(args, '--json')) console.log(JSON.stringify(db.schema, null, 2));
      else printSchema(db.schema);
      return 0;
    }
    case 'records': {
      const limit = Number(flag(args, '--limit') ?? Infinity);
      const format = flag(args, '--format') ?? 'jsonl';
      const table = args.shift();
      if (!table) throw new Error(`records: which table? ${tableList(db.schema.tables)}`);
      const fields = db.table(table).fields;
      if (format === 'csv') console.log(['recordId', ...fields.map((f) => f.name)].map(csvCell).join(','));
      // Calculations and summaries the file keeps no value for come out empty here: say which, on stderr so the data stays clean.
      const computed = fields.filter((f) => f.kind === 'calculation' || f.kind === 'summary');
      const filled = new Set<string>();
      let n = 0;
      for (const r of db.records(table)) {
        if (n++ >= limit) break;
        for (const f of computed) if (r.fields[f.name] !== undefined && r.fields[f.name] !== '') filled.add(f.name);
        if (format === 'csv') console.log([r.recordId, ...fields.map((f) => r.fields[f.name])].map(csvCell).join(','));
        else console.log(JSON.stringify(r));
      }
      const empty = computed.filter((f) => !filled.has(f.name)).map((f) => f.name);
      if (n && empty.length) process.stderr.write(`note: ${empty.join(', ')} ${empty.length === 1 ? 'is a calculation or summary' : 'are calculations or summaries'} with no stored value in this file, so ${empty.length === 1 ? 'it is' : 'they are'} ${format === 'csv' ? 'empty' : 'left out'} above. Tabularius works ${empty.length === 1 ? 'it' : 'them'} out when it hosts the file (tabularius serve), and the Data API returns the result.\n`);
      return 0;
    }
    case 'optimize': {
      // Converted to a scratch store that goes again, so nothing is hosted or kept.
      const scratch = mkdtempSync(join(tmpdir(), 'tabularius-optimize-'));
      try {
        const file = join(scratch, 'scratch' + STORE_EXT);
        importFmp12(db, file);
        const store = new Store(file, basename(path).replace(/\.fmp12$/i, ''));
        try {
          const r = optimizationReport(store);
          console.log(bool(args, '--json') ? JSON.stringify(r, null, 2) : r.text);
        } finally {
          store.close();
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
      return 0;
    }
    case 'export': {
      const out = args.shift();
      if (!out) throw new Error('export: give an output .sqlite path');
      if (existsSync(out)) rmSync(out);
      const stats = importFmp12(db, out);
      for (const s of stats) console.log(`${s.table}: ${s.records} records`);
      console.log(`wrote ${out}`);
      // Calculation values the file does not keep are NULL in the copy, and summaries are not copied at all.
      const copy = new DatabaseSync(out, { readOnly: true });
      try {
        for (const t of db.schema.tables) {
          const left = t.fields.filter((f) => f.kind === 'summary' || (f.kind === 'calculation' && !(copy.prepare(`SELECT count(*) AS n FROM "${t.name.replace(/"/g, '""')}" WHERE "${f.name.replace(/"/g, '""')}" IS NOT NULL`).get() as { n: number }).n)).map((f) => f.name);
          if (left.length && stats.find((x) => x.table === t.name)?.records) console.log(`note: ${t.name}: ${left.join(', ')} ${left.length === 1 ? 'has' : 'have'} no stored value in the file, so ${left.length === 1 ? 'it is' : 'they are'} empty in ${basename(out)}. Tabularius works calculations and summaries out when it hosts the file (tabularius serve).`);
        }
      } finally {
        copy.close();
      }
      return 0;
    }
    case 'dump': {
      const prefix = (flag(args, '--prefix') ?? '').split('.').filter(Boolean);
      const text = bool(args, '--text');
      const hex = (d: Uint8Array) => Buffer.from(d).toString('hex');
      const lines: string[] = [];
      for (const { path: p, chunk } of db.file.chunks()) {
        const segs = p.map(segmentOf).map(String);
        if (prefix.some((s, i) => segs[i] !== s)) continue;
        let v = '';
        if (chunk.type === 'kv') v = `k${chunk.key}=${hex(chunk.data)}`;
        else if (chunk.type === 'kvlong') v = `K${hex(chunk.key)}=${hex(chunk.data)}`;
        else if (chunk.type === 'segment') v = `seg${chunk.index}=${hex(chunk.data)}`;
        else if (chunk.type === 'data') v = `d=${hex(chunk.data)}`;
        if (text && chunk.type !== 'kvlong' && chunk.type !== 'push' && chunk.type !== 'pop') {
          const shown = inspectText(chunk.data);
          v += `  ${'text' in shown ? JSON.stringify(shown.text) : `(not text: ${shown.note})`}`;
        }
        lines.push(`${segs.join('.')}\t${v}`);
        if (lines.length >= 5000) {
          process.stdout.write(lines.join('\n') + '\n');
          lines.length = 0;
        }
      }
      process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
      return 0;
    }
  }
  process.stderr.write(unknownCommand(cmd));
  return 1;
}

/** A passphrase asked for in the terminal, for the one command being run (never written anywhere). */
let promptedPassphrase: string | undefined;

try {
  // New passwords need DEFAULT_MIN_PASSWORD_LENGTH characters, in a file whose own policy names no minimum and for the admin
  // console, unless the operator sets another length (0 for none). Set here so a cluster's workers inherit it.
  const minimum = process.env.TABULARIUS_MIN_PASSWORD_LENGTH?.trim();
  if (!minimum) process.env.TABULARIUS_MIN_PASSWORD_LENGTH = String(DEFAULT_MIN_PASSWORD_LENGTH);
  else if (!/^\d{1,3}$/.test(minimum)) throw new Error(`TABULARIUS_MIN_PASSWORD_LENGTH is the fewest characters a new password may have, a whole number (0 for no minimum), not "${minimum}"`);
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`error: ${plainError(e)}\n`);
  process.exitCode = 1;
}

/**
 * The passphrase of a .fmp12 that uses Encryption at Rest (undefined for one
 * that doesn't): TABULARIUS_SOURCE_PASSPHRASE, or asked for hidden in a terminal.
 */
async function sourcePassphrase(fmp12: string): Promise<string | undefined> {
  const src = fileSource(fmp12);
  let enc: { encrypted: boolean; hint?: string };
  try {
    enc = encryptionInfo(src);
  } finally {
    src.close?.();
  }
  if (!enc.encrypted) return undefined;
  if (process.env.TABULARIUS_SOURCE_PASSPHRASE) return process.env.TABULARIUS_SOURCE_PASSPHRASE;
  const hint = enc.hint ? `\nPassword hint (set by the file's author): ${enc.hint}` : '';
  if (!process.stdin.isTTY) throw new Error(`${basename(fmp12)} uses Encryption at Rest. Run this in a terminal to be asked for its passphrase, or set TABULARIUS_SOURCE_PASSPHRASE.${hint}`);
  if (hint) process.stderr.write(`${hint.slice(1)}\n`);
  return readSecret(`Passphrase for ${basename(fmp12)} (Encryption at Rest)`);
}
