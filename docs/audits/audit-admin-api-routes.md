# Admin API route review and the SQL time limit

Audit date: 2026-10-22. Runtime exercised: Node 22.22. Scope: the Admin API (`packages/server/src/adminapi.ts`, under `/fmi/admin/api/v2`), the admin console routes (`packages/server/src/admin.ts`, under `/tabularius/admin/v1` and the `/admin/` page), HTTP SQL (`sql.ts`) and the PostgreSQL wire connection (`pgwire.ts`). All data was generated. No `.fmp12` file was opened.

How far the reading went: `adminapi.ts` was read in full, and `admin.ts` from the route dispatcher (`Admin.handle`) through every route it dispatches, with the sign-in, lockout, passkey, plug-in, connection, sync, schedule, log, restore, audit and CSV handlers. The stores those handlers call (uploads, webhooks, inbound hooks, SCIM, schedules, sync and the privilege reports) were checked for their size caps, type checks and error classes at the route boundary only; their inner logic was not re-audited here.

## Summary

The first HTTP edge hardening and the Data API items had already fixed most of this surface, and this review kept that work. On main already: JSON type and size bounds on Admin API bodies (`adminapi-json-types.test.ts`), 405 answers with `Allow` for known paths, bounded numeric ids, a fixed `500` text with the cause logged (`adminapi-errors.test.ts`, `admin-hardening.test.ts`), `nosniff` and `no-store` on every JSON answer, a cross-site guard on Admin API sign-in, a per-address lockout, and the `X-Tabularius-Admin` header on every console call that changes something.

Fixed in this change, each with a test that failed first (`packages/server/test/admin-route-review.test.ts`):

| Finding | Where | Fix |
| --- | --- | --- |
| The console metrics page, the audit, security-event, access-review and plug-in-readiness CSV downloads, the server log download and the `/admin` redirect carried no `X-Content-Type-Options: nosniff`. A download of text that mixes in account and field names should not be sniffed as HTML. | `admin.ts` | `nosniff` added to all seven. |
| An anonymous caller could tell a real console route from a missing one: a known path with a wrong method answered `405` with an `Allow` header before sign-in, a missing path answered `401`. | `admin.ts` | The method check now follows sign-in, except for the four open sign-in calls. |
| The same route oracle on the Admin API: `405` and `Allow` before the token check, and a `400` for an id of more than nine digits before it. | `adminapi.ts` | The token check now comes first. Only `/user/auth`, which is open, answers `405` to anyone. |
| A certificate import answered with the parser's or the file system's own message when the folder settings file could not be read. That message quotes the start of the file and can name its folder. | `cert-import.ts` | A fixed message that says what to check. |

Not fixed, because it needs a design decision or is larger than a small fix: see [Open findings](#open-findings), including the per-statement SQL time limit.

## Common rules

These hold for every route below unless its row says otherwise.

**Console (`/tabularius/admin/v1/*`)**

- Who may call: four calls are open to anyone: `sign-in-info`, `sign-in`, `sign-out`, `passkey-sign-in`. Every other call needs one of: the local administrator token header `X-Tabularius-Local` (a 64-character token from the data folder, for the command line on this computer), the `tabularius_admin` cookie from a sign-in (64 hex characters, `HttpOnly`, `SameSite=Strict`, `Secure` on https, 12 hours), or HTTP Basic with the admin password. Until an admin password is set, only a direct connection from this computer is let in; anyone else gets `403` with a message that says how to set one. Data API session tokens, Bearer tokens and API tokens (`ohbt_...`) open nothing here, whatever their scope.
- Order of checks: path and method (the four open calls only), sign-in, then for anything but `GET` and `HEAD` the `X-Tabularius-Admin: 1` header (`403` without it, so a page on another site cannot send a call even with a saved login), then the per-identity in-flight limit (`503` with `Retry-After`), then the route.
- Body: the JSON helper reads at most 10 MiB, then bounds the shape: 100,000 values, depth 20, arrays of 1,000 (the sync apply call allows 1,000,000), 1,000 keys per object, keys of 255 characters, strings of 1,000,000 characters. The open sign-in calls read at most 64 KiB and treat an unreadable body as empty. Uploads read their pieces in bounded sizes under a quota of their own (`uploads.ts`).
- Errors: a `500` always says `Internal server error`; the cause goes to the server's console. Every other failure goes through `adminErrorText`, which lets only errors written for an administrator through (store, API, range, certificate, backup, schedule, sync, upload, webhook, connection and passkey errors) and hides all others behind the fixed fault message.
- Headers: JSON answers carry `Content-Type`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The CSV and log downloads and the metrics page now do too. The `/admin/` page is `no-cache` with a content security policy, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`.
- Secrets in answers (a new temporary password, an AI app token, a SCIM token, a webhook or hook secret) are only ever in a `no-store` answer.
- Existence answers: every file-scoped call answers `404` with the message `"<name>" is not hosted` (or `No such hosted file`) for a name that is not hosted, `400` for a missing name on read calls. These are for the signed-in administrator, who may list every hosted file anyway, so they are not an oracle. For an anonymous caller every closed route answers alike (see the fix above).
- Lockout: the admin password is one secret for the server, with no account name to probe. Five wrong passwords from one address (grouped by IPv4 address or IPv6 /64) lock that address for 15 minutes, for the console and the Admin API alike. The locked answer (`429`, `Retry-After`) is the same whatever the password, and is given before the password is checked, so a locked address cannot find out whether a guess was right.

**Admin API (`/fmi/admin/api/v2/*`)**

- Who may call: `POST /user/auth` is open (it checks the admin password, any user name). Every other call needs `Authorization: Bearer <token>` from it. Tokens live in memory, last 15 minutes idle and eight hours in all, are cleared when the admin password changes, and at most 100 exist. Cookies, the local token and Basic credentials open nothing but the login.
- Body: `readBoundedJson` (as above) for `POST` and `PATCH`; `DELETE` bodies are not read. Request paths longer than 2,048 characters answer `400` before sign-in.
- Answers: `{response, messages: [{code, text}]}`. A `500` is `Internal server error`, code `-1`; the cause goes to the server console. A bad `%` escape is `400`. A wrong method on a known path is `405` with `Allow` (to a signed-in caller). An unknown path is `404`, code 3.
- Headers: every answer carries `Cache-Control: no-store` and `nosniff`; `401` adds `WWW-Authenticate: Bearer`.
- Token in the path: removed. `DELETE /user/auth/{token}` carried the token in the URL, where a reverse proxy may log it; it now answers `404`. Sign out with `DELETE /user/auth` and the session token in the `Authorization` header. See [Open findings](#open-findings).

## Admin API routes

| Method and path | Parameters and bounds | Notes |
| --- | --- | --- |
| `POST /user/auth` | Basic header; body drained (small). `Sec-Fetch-Site` must be absent, `same-origin` or `none`; an `Origin` must be this server's. | Open. Wrong password `401` code 212 (the same text whatever the user name); locked `429` code 214 with `Retry-After`; no password set `401` with the command to set one (the console's open `sign-in-info` says the same); token table full `401` code 956. A password changed while the check ran gives `401`. |
| `DELETE /user/auth` | The session token in the `Authorization` header; no path token (`DELETE /user/auth/{token}` is removed and answers `404`). | Signed in. Ends that session; `200`. |
| `GET /server/metadata` | none | Signed in. Shows the host name, an id derived from the folder path and the first non-internal IPv4 address. |
| `GET`, `PATCH /server/status` | PATCH: `status` string `RUNNING` or `STOPPED`, `messageText` string of at most 200 characters. | Wrong type `960`; wrong value `960`. |
| `GET`, `PATCH /databases` | PATCH: `status` `OPENED`, `CLOSED`, `PAUSED` or `RESUMED` (missing `958`, other `960`), `messageText` as above. | Acts on every hosted file. |
| `PATCH`, `DELETE /databases/{id}` | id: digits, at most nine. | Unknown id `404` code 1700. `DELETE` is `21` Not Supported. |
| `GET /clients` | none | Lists sessions with the account name; no tokens (the ids are hashes). |
| `DELETE /clients/{id}`, `POST /clients/{id}/message` | id digits, at most nine; `messageText` at most 200 characters (required on `POST`). | Unknown id `404`. |
| `GET /schedules`, `POST /schedules?source={id}` | source: 1 to 9 digits. | Copy keeps the held-for-approval state of the source's scripts. |
| `POST /schedules/{filemakerscript, backup, message}` | Typed body (`scheduleTypes`): strings at most 255 (script parameter 10,000, backup target 1,024), `retainBackups` 1 to 1,000, `dailyDays` 1 to 3,650, repeat 1 to 10,080 minutes or 168 hours, at most seven weekdays. Other kinds `21`. | A body that names a different kind than the path `958`. |
| `GET`, `PATCH`, `DELETE /schedules/{id}` | id digits. `PATCH` `status` may only be `RUNNING`. | Running one already running `409`. A run's failure is not reported to this caller. |
| `GET`, `PATCH /server/config/{general, authenticatedstream, parallelbackup, persistentcache}`, `/php/config`, `/xml/config`, `/fmclients/httpstunneling`, `/server/config/security` | PATCH: only known keys (`960` otherwise), and only the value already shown (`21` Not Supported otherwise). | Answers fixed values that describe this server. |
| `GET`, `PATCH /server/config/blocknewusers` | `blockNewUsers` boolean (missing `958`, wrong type `960`). | Written to the event log. |
| `GET /plugins` | none | Lists plug-in ids, names and versions. |
| `PATCH /server/certificate/csr`, `PATCH /server/certificate/import`, `DELETE /server/certificate/delete` | strings only: certificate, key and intermediates at most 1,000,000 characters, other fields at most 1,024. | Errors are `CertificateError` text; the settings-file case is fixed (above). |

## Console routes

`Open` means anyone; every other row needs the sign-in described above. Bodies are JSON and `POST` unless noted.

| Method and path | Parameters and bounds | Notes |
| --- | --- | --- |
| `GET /admin/`, `/admin` | none | Open. The page is static HTML; its data needs sign-in. `/admin` redirects to `/admin/`. |
| `GET sign-in-info` | none | Open. Says whether a password is set, whether a passkey exists, whether the caller is on this computer, the command to set a password, and the AI assistant's state. |
| `POST sign-in` | `password` string, body at most 64 KiB. Needs `X-Tabularius-Admin`. | Open. `403` without a password set; wrong password `401` `Wrong admin password`; locked `429`. Sets the session cookie. |
| `POST sign-out` | none | Open. Always `200`. |
| `POST passkey-sign-in` | No body: issues a challenge. With `response`: an assertion. Needs `X-Tabularius-Admin`. | Open. Pending challenges are capped (2,000 overall, 5 per address, 50 per IPv6 /48, with a reserve for known proxies) and live five minutes; a challenge works once. A failed assertion counts toward the lockout. The credential ids it returns are public by design. |
| `GET status`, `metrics`, `backups`, `server-scripts`, `ai-usage`, `profile`, `profile/finds`, `script-tests`, `restore`, `sessions`, `solution-map`, `logs`, `logs/{name}` | `limit` through `queryInteger`: digits, 1 to a stated maximum, otherwise `400`. | `logs/{name}`: `name` must be one of the known log names, otherwise `404`. |
| `GET logs/{name}/download` | `old=1` for the previous file. | A tab-separated download; now `nosniff`. |
| `DELETE profile` | none | Clears the profile. |
| `POST block-new-users`, `session-timeout`, `responsive`, `notifications`, `notifications/test`, `message`, `backup-folder`, `backup`, `backup/stop`, `indexes`, `relax-unverified` | Typed: booleans, whole numbers, an email address, a folder path; `message` at most 200 characters. | Wrong types answer `400` with the field's name. `backup-folder` refuses a folder it cannot use and, while a backup runs or `--backup-dir` fixed it, `409`. `backup` refuses a `database` field, because a backup is of every file. | <!-- known-difference-ok: relax-unverified is the name of a route -->
| `POST backups/{set}/verify`, `backups/{set}/test-restore` | set: one segment that must be an existing backup set. | Unknown set `404`; the name is never joined to a path before it matched the list. |
| `POST restore`, `POST records/restore` | `database`, `at` (a moment not in the future), `mode` `replace` or `copy`; `table`, `recordId`, `seq` whole numbers. | One restore at a time (`409`). Refused sets say why. |
| `GET files/{name}/external-containers`, `GET`, `POST files/{name}/orphan-containers`, `POST files/{name}/reconvert-preview`, `POST files/{name}/reconvert`, `POST reconvert-all`, `POST locked/{file}/unlock` | name: one segment, decoded, must be hosted (`404`). `POST orphan-containers` needs `purge: true`. The passphrase is read once, never logged, and not stored. | Failures of a conversion are logged and shown with the safe error text. |
| `GET`, `POST conversion-guide/{database}`; `GET`, `POST optimization/{database}[...]`; `POST stale-calcs/...`; `POST accounts/...`; `GET`, `POST ai-policy`, `script-network`, `web-viewer-hosts`, `ai-access`, `pii` | `{database}` decoded and hosted (`404`). Typed bodies (booleans, string lists, field names). Optimization takes `fix` from a fixed list. | `web-viewer-hosts` refuses this server's own host name. |
| `GET view-as`, `access`, `test-account`, `compare`, `sso-mapping`, `sso-mapping/test`, `field-access`, `access-review`, `plugin-readiness`, `health`, `least-privilege`, `who-can`, `usage`, `unusual-access`, `audit`, `audit/verify`, `audit/settings`, `security-events`, `security-events/verify` | `database` required for most (`400` otherwise); numbers through `queryInteger`; `format=csv` where listed. | CSV downloads now `nosniff`. Cell text is made safe against formula and control-character injection (`audit-output.test.ts`). `audit/verify` stops when the caller disconnects; at most one verification runs (`503` when busy). |
| `POST field-access`, `sso-mapping`, `health/revoke-token`, `health/fix-account`, `accounts/set-password`, `accounts/unlock`, `accounts/migrate-all`, `accounts/blank-password-lan`, `sessions/end`; `DELETE sso-mapping/{name}` | Account, set and field names are strings (`said` turns anything else into empty). `accounts/unlock` takes an account or an address, not both, and an address must be an IP address. | `set-password` and `fix-account` return a password once, in a `no-store` answer, and write only that it was set to the log. `sso-mapping/{name}` refuses a name that is not an external mapping. |
| `GET`, `POST passkeys...`; `DELETE passkeys/{id}` | Registration needs a challenge from `register/options`. | A challenge works once and expires in five minutes. |
| `GET`, `POST`, `PATCH`, `DELETE schedules[/{id}[/run, /runs]]` | id: hex digits. Unknown id `404`. Bodies go to `Schedules`, which checks every field and raises `ScheduleError` (`400`). | `run` waits for the run to end. |
| `GET`, `PUT`, `DELETE sync/{database}`; `POST sync/{database}/check`, `/apply`; `GET sync/{database}/log` | `log`: `limit` is clamped to 1 to 10,000 and a bad value falls back to 200, on purpose (`resource-limits.test.ts`). | The sync password is read from the body, never logged. |
| `GET`, `POST uploads`; `GET`, `PUT`, `DELETE uploads/{id}`; `POST uploads/{id}/finish` | id: word characters. `offset` through `queryInteger` (0 to 1,000,000,000). Pieces and total are bounded and under a quota (`413`). | Missing service `404`. |
| `GET`, `POST webhooks`; `PATCH`, `DELETE webhooks/{id}`; `GET`, `POST inbound-hooks`; `PATCH`, `DELETE inbound-hooks/{id}`; `POST inbound-hooks/{id}/secret` | id: lowercase hex. | Bodies are checked by `Webhooks` and `InboundHooks` (`WebhookError`, `HookError` give `400`). Secrets are returned once. |
| `GET outbox[/{id}]`, `DELETE outbox` | `limit` through `queryInteger`. | `404` when test mode is off. |
| `GET`, `POST connections`; `GET`, `PATCH`, `DELETE connections/{id}`; `PUT`, `DELETE connections/{id}/secrets/{field}`; `POST connections/{id}/approve`, `/test` | id: lowercase hex; secret value a non-empty string. | A connection error is `400`, or `404` when the message says there is no such connection. A failure that is not a `ConnectionError` is a plain `500`. |
| `GET`, `POST plugins...`; `PUT`, `DELETE plugins/{id}/secrets/{NAME}` | `NAME` matches `[A-Z][A-Z0-9_]*`; `file` must be hosted. | Built-in packs have no secrets (`400`). The value is never logged. |
| `GET`, `POST mcp...`; `DELETE mcp/tokens/{id}` | `days` 0 to 3,650, label cut at 200 characters, `layouts` list of strings. | A new token is shown once. A token for an account whose privilege set has no AI access is made with a warning that says so. |
| `POST solutions/plan`, `solutions`; `GET digests`; `POST digests/{database}/{id}/run` | `description` non-empty string. | `plan` answers `503` with the AI assistant off; a failure other than a solution error is `502` or `500` with the fixed text. |
| `GET`, `POST scim...` | `database` hosted. | The SCIM token is returned once. |
| `POST clients/{id}/disconnect`, `POST clients/{id}/message` | id: lowercase hex; `text` at most 200 characters. | An unknown client is `404`. |

## Per-statement SQL time limit

Finding: **HTTP SQL and the PostgreSQL wire connection have no per-statement time limit, and none can be added reliably on the SQLite binding this server runs on.** Nothing was added, as a limit that only reads the clock after the statement returns would not limit anything.

Evidence, Node 22.22.0:

- The store opens its files with the built-in `node:sqlite` `DatabaseSync` (`packages/store/src/store.ts` and the other readers). `SqlEndpoint` runs `Store.select`, which prepares the statement and iterates it on the main thread. `DatabaseSync` offers `open`, `close`, `prepare`, `exec`, `function`, `aggregate`, `location`, `createSession`, `applyChangeset`, `enableLoadExtension` and `loadExtension`; a statement offers `iterate`, `all`, `get`, `run`, `columns` and a few option setters. There is no interrupt, no progress handler and no busy or time option that applies to a running statement. `sql-statement-limit.test.ts` checks this list, and fails when a Node release adds a name that matches interrupt, progress, timeout, abort or cancel, as the cue to build the limit.
- A worker thread does not help. A worker was started that ran a recursive query of about 3.2 seconds on a `:memory:` database; `worker.terminate()` was called at 201 ms. The promise returned at about 3.27 seconds, when the statement ended on its own, and with a longer query (60 million rows) it was still pending after 7.8 seconds. Terminating a thread stops JavaScript, not a call that is inside SQLite. The main thread kept running throughout (159 timer ticks in 8 seconds), so a worker would keep the server responsive but would not free the statement or the CPU.
- A function registered with `db.function` could throw once a deadline passed, but SQLite calls it only where the statement does, so a query that never calls it (a recursive count, a large join) is not stopped. Wrapping every statement to call one would change what the SQL means.
- The only reliable way to stop a statement is to run it in a separate process on its own connection and kill the process. That is a design change: the query functions that `calc` and the PostgreSQL catalog register on the connection (`registerFindFunctions`, `defineQueryFunction`) would have to be rebuilt in the child, and the privilege and design-read wrappers (`withDesignRead`) with them.

What does bound a statement today: the row limit on HTTP SQL (`limit`, 1 to 1,000,000, default 10,000, stops the read after that many rows), the per-identity in-flight limit, the edge timeouts for a client that goes away, and read-only connections. They do not bound a single expensive statement before its first row.

`pgwire.ts` already says so plainly: `SET statement_timeout` is accepted with a `01000` warning that it is not enforced, and `SHOW statement_timeout` answers `0` (`docs/pgwire-session.md`).

Suggested fix, if a limit is wanted before Node adds an interrupt: run HTTP SQL and pgwire reads in a child process per hosted file (a long-lived pool, one connection each), pass the SQL and parameters in, and kill and replace the child when a configurable limit (a documented default such as 60 seconds, and a way to turn it off) passes, answering `57014` (`query_canceled`) over the wire and `504` with a clear message over HTTP. Until then, put a limit on the reverse proxy and keep the account's `fmxdbc` extended privilege to those who need it.

## Open findings

| # | Finding | Severity | Suggested fix |
| --- | --- | --- | --- |
| 1 | No per-statement SQL time limit (above). | Medium: an account with SQL access can hold the main thread with one statement. | A child-process pool as described above, or wait for an interrupt in `node:sqlite`. |
| 2 | Five `console.error(e)` calls (`admin.ts`, `adminapi.ts`) write the raw error to the server console on a `500`, where other routes go through `logFaultFor`, which redacts credential-shaped text. Nothing reaches the caller. `adminapi-errors.test.ts` asserts the raw call today. | Low | Move the five to `logFaultFor` and update that test to expect the redacted entry. |
| 3 | `DELETE /user/auth/{token}` put the token in the URL. The metrics label hid it, but a reverse proxy in front may log the path. | Low | Resolved: the path route is removed; `DELETE /user/auth` with the `Authorization` header signs out. |
| 4 | The Admin API login answers `Set an admin password before using the Admin API` when none is set, while the open `sign-in-info` says the same, so this is not new information; it is listed because it is an anonymous state answer. | Informational | None; it is deliberate (the message tells the owner what to do). |
| 5 | `GET sync/{database}/log` treats a malformed `limit` as the default instead of refusing it, unlike every other console `limit`. `resource-limits.test.ts` asserts it. | Informational | Decide whether to keep the lenient reading; if not, use `queryInteger` and change that test. |
| 6 | A wrong admin password (console or Admin API) counts toward the lockout, but neither the failure nor the lockout is written to the server log or the event log; the Data API records both for file accounts. An owner cannot see a guessing attempt on the admin password. | Low | Write an event log line for a lockout, and a count for failures, without the address of a trusted proxy's clients being exposed. |
