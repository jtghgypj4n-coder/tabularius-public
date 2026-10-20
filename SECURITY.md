# Security

Tabularius hosts FileMaker solutions — other people's real data and real
automations — so it is built to be safe by default: a converted solution does
nothing to the outside world and exposes nothing to a caller that the caller's
account isn't allowed to see, until someone deliberately opens it up.

This document describes the security model, the offline-by-default policy, the
threat model surface by surface, and the hardening already in place. It
describes the project as it stands; it is not a warranty.

## Reporting a vulnerability

Please report suspected vulnerabilities privately rather than in a public
issue, using GitHub's private vulnerability reporting: on the repository open
**Security**, then **Report a vulnerability**. Include what you did, what
happened, and what you expected. We'll work a fix before any public disclosure.

Please don't run denial-of-service or data-destruction tests against a server
you don't own, and don't access data that isn't yours.

### What to expect

Tabularius is looked after by a small group of volunteers. There is no paid
support team and no service-level agreement, so nothing here is a promise and
there is no response time we commit to. We answer reports on a best-effort
basis; a fix is released as soon as it is tested, and we credit the reporter in
the release notes if they want that. If you have heard nothing for a while, add
a comment to your advisory; it has not been ignored on purpose. We ask for time
to fix before anything is made public, and we will tell you if we think it
should be published sooner.

### Supported versions

Only the latest release is supported. Fixes are made on `main` and go out in the
next release; older releases do not get fixes of their own, so the answer to a
vulnerability in an older release is to upgrade (`tabularius upgrade`, which takes
a backup first and goes back to the old version if the new one does not start).
Say which release or commit you tested.

### In scope

The server and its tools as shipped in this repository: the Data API, OData,
SQL, the Postgres wire, MCP, the web client, the admin console, the command
line, the installers and the release builds, and the way they enforce accounts,
privileges, the offline-by-default policy and the limits described below.

### Out of scope

- Weaknesses in FileMaker itself, in FileMaker Pro or Server, or in a
  third-party plug-in or service a hosted solution uses.
- A hosted solution's own mistakes: a privilege set that grants too much, a
  script that does something unsafe, credentials written into a file by its
  authors. (A way around a privilege set that is set up correctly *is* in scope.)
- Things this document already lists under [Known limitations](#known-limitations)
  or as deliberate, such as `[Full Access]` being able to read everything, or the
  live working database being plaintext while it is served.
- Denial of service by sending a very large amount of traffic, and tests against
  servers you do not own. A request that makes one request cost far more than the
  [documented limits](ADMIN.md#request-and-upload-limits) allow *is* in scope.
- Findings from an automated scanner with no demonstration of what an attacker
  gains, and missing headers or settings on a server an administrator has
  deliberately configured that way.
- Social engineering of maintainers or users, and physical access to a
  computer that holds the data.

If you are not sure whether something is in scope, report it anyway.

## Security model

Every hosted file carries FileMaker's own security objects — **accounts** and
**privilege sets** — and **every way into the file enforces them**. There is no
privileged side door: the Data API, OData, the SQL endpoint, the Postgres wire,
the MCP/AI server, the web client and server-side scripts all resolve a request
to an account and check that account's privileges before doing anything.

- **Record-level access** is enforced, including FileMaker's "limited"
  view/edit/delete calculation rules: records an account can't see are left out
  of found sets, counts and exports, not merely hidden in the client.
- **Field-level access** is enforced: a field an account can't see reads blank,
  and a field it can't modify can't be written.
- **Masked fields** show a stand-in instead of the value (see below).
- **Layout, value-list and script access** follow the set's levels.

- **Extended privileges** gate the surfaces, as on FileMaker Server: the Data
  API needs `fmrest`, the web client `fmapp`/`fmwebdirect`, OData `fmodata`, the
  SQL/xDBC surfaces `fmxdbc`, and the MCP/AI server `fmmcp`.
- `[Full Access]` is the only set that can manage security or change the design.

Server-side scripts (schedules, Perform Script on Server, record automations and
signed inbound hooks) require an existing, active execution account when work
is accepted and when it starts. A running job stops at the next script step
boundary after that account is disabled or removed, including scripts running
with Full Access. Completed writes and external effects remain; an open script
transaction rolls back as the run unwinds. The original execution account stays
bound to the job through Re-Login.

### Full Access diagnostics

Credential-step parameters are redacted from runtime traces, profiles, debugger
listings and errors, including failed steps. This is defense in depth for values
shown to Full Access accounts, which can already read those fields. Diagnostic
redaction is not an access-control boundary.

Redaction is deliberately conservative: a field or variable whose name looks
like a credential (for example `Secret`, `Password` or `$pwd`) shows as
`‹redacted›` in the debugger, profiles and recordings even to Full Access
accounts; the stored value is unchanged. Remembered URL and authentication
values contribute only their password or token components, not the URL,
username or host. Matching is case-insensitive. Complete remembered secrets of
at least four characters are also hidden inside messages; shorter secrets match
only whole values. Partial matching applies only when the whole displayed value
is a fragment of at least four characters from a secret at least eight characters
long. Letter-only fragments of four characters or fewer are excluded to avoid
hiding ordinary words. Proven non-secret script literals skip partial matching.

Value matching cannot prevent stitching three-character parts across calculations,
interleaving, reversing or encoding secrets through innocently named calculations.
These are known limits, as are partial overlaps inside otherwise ordinary messages.

`remember()` examines and hashes only the first 4 KiB (4,096 UTF-8 bytes) of
any single input value. Remembered-value state has a 1 MB (1,000,000-byte)
per-run budget, charging retained text plus conservative collection-entry
overhead. SQL results learn into their own 64 KiB budget, so a wide result set
cannot use up what field reads learn. When either budget is full, learning stops
and the run fails closed: every later value shown in a diagnostic or trace is
redacted, because a value derived from an unlearned secret cannot be told apart
from an ordinary one. Suffixes beyond the 4 KiB prefix limit may still appear in
diagnostics. Name-based and credential-syntax redaction continue to apply, and
script execution and stored values are unaffected by either limit.

Within a script run, redaction follows variable and field assignments and
concatenations, including `Let` bindings and `$$` globals, into URL userinfo,
authentication headers, cURL `--user`/`-u` arguments and credential parameters
in forms, query strings and JSON bodies. It hides the contributing inputs and their
copies before emitting diagnostics, including earlier assignments such as
`"https://user:" & $input & $host`. Analysis is conservative across branches and
reassignments; values whose credential flow is too complex to expand are hidden.
The tracking is discarded when the run ends and does not change script results.

### Masked fields

A privilege set can *mask* a field instead of hiding it. The account still sees
the field on its layouts, but reads a stand-in in place of the value: either the
**last 4 characters** (`•••-••-6789`; a short value never shows more than half of
itself) or a **fixed text** such as "Private". An empty field stays empty.

Masking is a read-only view. A masked field is **never writable, searchable,
sortable, summarizable or exportable**, and it can't be reached through SQL,
OData, a calculation, a find request or a report. Every surface that was not
written to show the stand-in treats the field as hidden, so a mistake leaves it
hidden, never exposed. The AI/MCP server sees the masked version or nothing.
The admin console lists masked fields apart from hidden ones in "Who can see
this?", the access review (its CSV has a `maskedFields` column) and set
comparisons, so masking is never mistaken for full access. A token scope can
narrow a masked field further but never makes it more readable.

### Authentication

- **Passwords** are checked against the verifier stored in the file
  (PBKDF2-HMAC-SHA1, as FileMaker stores them) in constant time. An empty
  password from the network is refused by default.
- **Two-factor (TOTP)** can be turned on per account; it's off by default and,
  once enrolled, must be confirmed with a live code before it takes effect, so a
  mistyped secret can't lock anyone out.
- **Lockout**: 5 wrong passwords in 15 minutes for one account from one address
  lock that account out from that address for 15 minutes; repeated wrong
  one-time codes (a separate bucket) do the same, so neither a password nor a
  six-digit code can be brute-forced.
- **Password spraying**: each client address also has its own budget across all
  accounts. 30 wrong passwords in 15 minutes from one address, whatever the
  account names, block that address from every account for 15 minutes, with a
  `Retry-After`. Passkey and recovery-code failures count too. Everyone behind
  one address (an office NAT) shares the budget, so an administrator can lift a
  block; this computer's own addresses, and visitors a proxy doesn't identify, are exempt.
  PostgreSQL attempts against unhosted database names are tracked separately in
  `PgServer` memory (at most 5,000 address buckets), not in a hosted file's Store
  address budget. This tracking resets on server restart. Every such password
  attempt still spends a dummy password hash, even when its address is locked
  or the tracking table is full, so these cases do not expose a fast refusal.
- **Admin passkey challenges**: pending console challenges expire after five
  minutes and share a 2,000-entry ceiling. Unauthenticated requests are also
  limited to five pending challenges per IPv4 address or IPv6 /64, and fifty
  per IPv6 /48. Authenticated requests, including passkey registration, are
  exempt from these address caps. A full allowance returns HTTP 429 without
  evicting any live challenge; consuming or expiring a challenge frees capacity.
- **Account names can't be guessed from the answer**: an unknown account name
  takes as long to refuse as a wrong password on the Data API, the web client and the other sign-ins that use the same check, and passkey sign-in fails the
  same way for an account with no passkey as for one with a wrong one. Passkey
  and recovery sign-in are throttled by address.
- **Sessions per account**: one account holds at most 100 Data API sessions in a
  file at once (`TABULARIUS_MAX_SESSIONS_PER_ACCOUNT`, `0` for no limit); signing
  in past the cap ends the one used longest ago.
- **External identity providers** (OIDC and LDAP/AD) can vouch for an account,
  which then takes the privilege set of the external account named by the user's
  email or one of their groups.
- **API tokens** are long-lived, revocable bearer credentials for integrations
  (see below).
- **Password policy**: a minimum length and a maximum age can be required, and
  an account can be forced to change its password at next sign-in.

### API tokens

An integration should use a scoped API token rather than an embedded password.
A token:

- acts as **one account**, so it carries that account's privilege set — never
  more;
- is **per-file** — it opens only the file it was minted in;
- can be **read-only**, refusing every write and script;
- can **expire** on a date;
- can be **scoped to a subset of surfaces** (`fmrest`, `fmodata`, `fmxdbc`), so a
  token minted for one integration can't be replayed on another; the scope only
  narrows and is intersected with the account's extended privileges;
- is **revocable on its own**, without touching the account's password;
- is stored only as a hash — the secret is shown once, at creation, and never
  again.

### Audit log

Each file keeps an audit log of record changes (create, edit, delete, duplicate,
truncate), each naming where it came from (web client, Data API, OData, an AI
app, the admin console, an automation, an import, a sync, a script), and of
security events — sign-ins and failures, lockouts, and changes to accounts,
privilege sets, passwords, policy, second factors, API tokens and schema, each
with the object it acted on. Record entries are linked by hashes, and the
console's **Verify record log** finds an entry that was edited, removed or
slipped in; it cannot prove who an account really was, and the newest entry's
hash has to be kept elsewhere to notice a rewritten tail. Fields can be named
whose values are never logged, and entries can be kept for a set time. Reads
are logged only if an administrator turns that on. An administrator can read
and filter the log in the console and export it as CSV.

## Offline by default

**A converted solution does nothing to the outside world unless someone
explicitly allows it.** FileMaker solutions routinely send mail, call web
services and run plug-ins; a solution you host may have been written for an
environment you are not in, with credentials you should not use. So the script
engine runs in a **no-network, no-mail sandbox** by default:

- Steps that reach outside — Insert from URL, Open URL, mail, plug-in calls that
  would make network or mail requests, external SQL/ODBC sources, Perform Script
  on Server to another host — do nothing (or report that they're offline)
  instead of reaching the network.
- The server only lets ordinary interactive scripts reach the network when it is
  started with `--allow-script-network` (off by default), and even then:
  - **scheduled scripts stay offline** unless the schedule itself opts in, and
  - **scripts an AI runs** (the `run_script` MCP tool, and the test-run tooling)
    are **always offline**, with no way to opt in.
- `Import Records` in a server-side script reads only from the hosting folder's
  `Documents`, never an arbitrary path.

This means an administrator must make a conscious, server-level choice before
any hosted automation can touch the outside world, and the two most autonomous
callers — the scheduler and the AI — never can by that choice alone.

Caller-supplied script fetch callbacks (`RunOptions.network` and
`outbound.fetch`) require the internal symbol-based test-only option
`[TEST_ONLY_CUSTOM_FETCH]: true` on that run. The symbol lives in the scripts
package's internal `test-only.ts` module and is not exported by its public index.
Without it, callbacks are refused before a request is sent, including plug-in
requests. Node's test runner and outbound test mode do not grant this permission;
production scripts use the built-in fetch transport.

Connections (S3 storage, web APIs, mail accounts) follow the same rule: the AI can only
draft one, with no keys, and a person finishes it. By default that person is whoever holds
the admin console password. A server started with `--allow-app-connections` also lets a
[Full Access] person signed in to the web client (never an API token or a Data API sign-in, which
an AI app can hold) finish a draft the AI made for the file they are in, from the card
under the assistant's answer (they type the keys, press Test and approve; the card lists every
place the keys will go, including an OAuth token address, and an AI draft can only read). That person is then deciding that this file's scripts may reach that
service, so leave the flag off on a server where file owners should not make that choice.

A scheduled script gets connections (and mail through an email connection) only while everything in
the hosted files that can run or steer code is as a person last approved it for that schedule: scripts,
custom functions, field formulas, layouts, custom menus, file options, data sources and table
occurrences, in every hosted file. The console records it when the schedule's network switch goes on,
and again on "Approve scripts", which lists what changed. An AI that edits any of that cannot make a
nightly run call a connection by the edit alone: the run goes ahead without connections, and the check
is repeated at every request, so an edit during a run counts. Not covered: the network switch itself
(Insert from URL to any web address, which the schedule's switch already allows), mail on the
operator's own `--send-mail` flag, and scripts a person runs from the web app, the Data API or OData,
which use connections like any network script. One message through a mail connection names at most
20 recipients unless the connection sets more (up to 100), and an AI draft starts at 20.

### The AI, specifically

The built-in MCP/AI server acts as an account (it needs `fmmcp`), within that
account's privileges; it reads and writes records within those privileges,
runs read-only SQL, and **runs scripts only offline**. The raw-data SQL and
record tools that can read across a file are gated to full-read accounts, and
the SQL path refuses any reference to the internal security tables, so an AI
session can't read password hashes, token hashes or second-factor secrets.

## Threat model, surface by surface

| Surface | Auth | Gated by | Notes |
| --- | --- | --- | --- |
| Data API (REST) | account password, session token, or API token (Bearer) | `fmrest` | record/field privileges applied to every response |
| OData v4 | password, session token, or API token (Bearer) | `fmodata` | `$filter` parameterised against a property allowlist |
| SQL endpoint (HTTP) | password or API token (Bearer) | `fmxdbc` | read-only SQL; internal `_fm_` tables refused |
| Postgres wire | username + password | `fmxdbc` | read-only SQL; same internal-table screen |
| MCP / AI | account password (Basic), scoped Bearer token, server MCP token, or direct local access when no server token is set | `fmmcp` for account access | scripts offline; raw-data tools full-read only |
| Web client | account password | `fmapp`/`fmwebdirect` | Manage Security is `[Full Access]` only |
| Admin console | admin password, signed-in cookie, or local admin channel; direct loopback before a password is set | — | mutations require `x-tabularius-admin: 1` |
| FileMaker Admin API | admin password (Basic) | — | login issues a Bearer token; needs an admin password set; the console cookie, the local admin channel and loopback do not sign in to it |
| Change feed / webhooks | admin | — | a webhook can't target link-local/metadata hosts |
| Replication | shared replication token (Bearer) | — | absent without a configured token; cluster workers communicate over internal sockets |

Password sign-in to OData, SQL over HTTP, and the XML API accepts the same
`X-Tabularius-OTP` header as the Data API when an authenticator app is enrolled.
The account and file second-factor requirements are checked on each password
sign-in. Accounts marked to change their password are refused by these three
surfaces until the password is changed through a supported client. PostgreSQL
wire has no OTP field or established password-plus-OTP convention in this
server, so it refuses accounts that need a second factor with an explanatory
error; use SQL over HTTP with `X-Tabularius-OTP` instead. PostgreSQL wire also
refuses accounts that owe a password change. These rules apply to password
sign-in; bearer token authentication is unchanged.

General properties:

- **Admin console cookie and OAuth CORS**: the admin console issues one cookie,
  `tabularius_admin`. Password sign-in (`POST /tabularius/admin/v1/sign-in`) and
  passkey sign-in (`POST /tabularius/admin/v1/passkey-sign-in`) set it with
  `Path=/; HttpOnly; SameSite=Strict; Max-Age=43200` (12 hours); `Secure` is
  added when the request uses HTTPS. Sign-out (`POST
  /tabularius/admin/v1/sign-out`) clears it with `Path=/; HttpOnly;
  SameSite=Strict; Max-Age=0` (and does not add `Secure`). The cookie has no
  `Domain` or `Expires` attribute. Admin POST requests, including sign-in,
  passkey sign-in and sign-out, require `x-tabularius-admin: 1`; browsers cannot
  send this non-simple header cross-origin without a successful preflight.
  `SameSite=Strict` also keeps the session cookie off cross-site requests.
  The FileMaker-compatible Admin API login (`POST /fmi/admin/api/v2/user/auth`)
  authenticates only the admin password in its Basic authorization header; it
  does not accept this console cookie. It also refuses, with 403 code 9, any
  request whose `Sec-Fetch-Site` is not `same-origin` or `none`, or whose
  `Origin` is not this server's public origin, before checking the password or
  allocating a token, so a browser that has cached the Basic credentials cannot
  be used cross-site to fill the token slots.
  General admin routes do not check the `Origin` header; passkey assertions
  validate the WebAuthn origin against the request or configured public URL.
  OAuth routes under
  `/.well-known/oauth-*` and `/oauth/*` answer `OPTIONS` with
  `Access-Control-Allow-Origin: *`, methods `GET, POST`, headers
  `content-type, authorization`, and max age 600 seconds. OAuth JSON responses
  and `POST /oauth/revoke` also send `Access-Control-Allow-Origin: *`.
  `Access-Control-Allow-Credentials` is never sent; OAuth uses bearer tokens,
  not cookies.
- **Forwarded headers**: `X-Forwarded-Host` and `X-Forwarded-Proto` are believed
  only from a proxy on this computer, and `--public-url` is used when given, so
  a caller can't choose the address a server puts in links and sign-in origins.
  A proxy that doesn't overwrite `X-Forwarded-Host` should be told the public
  address with `--public-url`.
- **Framing**: the web app and the documentation pages can't be framed by other
  sites, as the admin console already couldn't.
- **Constant-time** comparison of password verifiers and token hashes.
- **Path safety**: an uploaded file's hosted name is stripped of path
  separators and control characters and must end in `.fmp12`.
- **SSRF**: a webhook URL can't point at a link-local or unspecified address
  (for example a cloud metadata endpoint); loopback and private-LAN collectors
  are still allowed.
- **Concurrent requests**: OData, MCP and both admin APIs cap each identity at
  32 in flight per surface and process (503 with `Retry-After: 1`); static reads
  are exempt. Identity tracking is bounded and completed entries are removed.
  See [request and upload limits](ADMIN.md#request-and-upload-limits).
- **Hostile uploads**: an upload's declared size is capped (default 10 GB,
  `TABULARIUS_MAX_UPLOAD`; 0 disables only this per-file cap). In-progress uploads
  reserve declared sizes against `TABULARIUS_MAX_UPLOAD_IN_PROGRESS` (20 GiB by
  default, always finite), including queued conversions; over-quota starts
  receive 413. Conversion runs on a worker with a heap cap
  (`TABULARIUS_CONVERT_MEMORY`) and a time budget (`TABULARIUS_CONVERT_TIMEOUT`), so
  a malformed, truncated, oversized or expanding file out-of-memories or times
  out the worker rather than taking the server down or jamming the conversion
  slot. The reader itself refuses malformed input fast and cleanly. An upload
  that has received nothing for 24 hours (`TABULARIUS_UPLOAD_IDLE_HOURS`, 0 to
  keep them) is removed with its pieces, so abandoned uploads can't fill the disk.
- **Privilege checks are central**, in the store, so a new surface can't forget
  them; a standing bypass test suite runs in CI to keep every surface honest.

### MBS text and QuickList limits

MBS text concatenation, encoding, dictionary JSON/serialization and checked list
output have an 8,000,000-character result cap, measured in UTF-16 code units.
Escaping, delimiters and base64 expansion count toward that result limit.

Each QuickList also holds at most 8,000,000 characters across all its values
(excluding list separators), in addition to its 5,000,000-item limit. Creating
or editing a list beyond the character cap returns the MBS “the result is too
large” error; a refused edit preserves the previous list. Formatting a list for
output counts separators and escaping separately against the result cap, so a
list that fits in memory can still be too large to format. These are Tabularius
implementation limits, not FileMaker or MonkeyBread compatibility guarantees.

## Encryption at rest

A hosted file's SQLite database can be encrypted at rest with
`TABULARIUS_ENCRYPTION_KEY` (AES-256-GCM with a scrypt-derived key); backups can
be encrypted too.

`TABULARIUS_ENCRYPTION_KEY` covers only the database, not externally stored
container files in `RC_Data_FMS/` or `Files/`. Those files remain plaintext even
when the hosted database is locked or the server is stopped. Moving embedded
containers to external storage therefore removes their database encryption
coverage; the move preview warns when this key is set. Backup encryption uses
`TABULARIUS_BACKUP_KEY` separately and covers external files copied into a backup
set, not the originals. Thumbnail conversion (`withTool`) also writes plaintext
temporary copies of container data to the operating system's temporary folder;
normal cleanup removes them, but a crash can leave them behind.

**Caveat:** while a file is open and being served, its working database is
plaintext on disk — `node:sqlite` has no page-level encryption, so the
encrypted form protects a file at rest (copied, backed up, or on a stopped
server), not the live working file. True FileMaker-style encryption of the
running file would need a page-encrypting SQLite build (e.g. SQLCipher) and is
a deliberate, separate decision.

## Secrets

- The server's own secrets (encryption key, admin token, any configured
  outbound credentials) come from the environment or configuration, never from
  source.
- Never commit real credentials, and never put them in test fixtures, logs or
  reports. A `.fmp12` solution may contain credentials written for its original
  environment; treat those as the original owner's secrets — do not use, copy or
  log them, and tell the owner so they can rotate them.

## Known limitations

- The live working database is plaintext while a file is served (see above).
- Setting a non-empty FileMaker password in the file's own format needs a
  constant Tabularius doesn't yet derive; Tabularius manages its own password
  verifiers instead.
- A record-access rule that hides a volatile function (clock- or random-based)
  inside a custom function may have its cached allowed-set lag the clock until
  the next write to the file. This is a correctness, not an access, matter — the
  cache is keyed per account and never crosses accounts.
- Some FileMaker account option flags (print, export, menu level) are not yet <!-- known-difference: Reading .fmp12 files ;; Some account option flags (print, export, menu level) are not decoded from a converted file ;; Those flags are not carried into the converted account ;; Sample files that set them, and a Design Report of the same file -->
  decoded from a converted file.
