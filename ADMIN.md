# Running a Tabularius server

This guide is for whoever looks after the server: installing it, keeping it
up to date, backing up and restoring, certificates, using every CPU core, and
scripting it through its APIs. To try Tabularius on your own computer first,
see [QUICKSTART.md](QUICKSTART.md). The [README](README.md) describes each
feature in more depth.

A server hosts one **folder**. Every `.fmp12` file in it is converted once
into Tabularius's own store (`<name>.openhbam.sqlite`, next to it) and hosted.

Identity-provider sign-in keeps short-lived OAuth state in
`.openhbam-oidc/pending.sqlite` in the hosted folder. Treat this file and its `-wal`
and `-shm` sidecars as sensitive: they contain temporary PKCE verifiers and
nonces. Keep them private, and exclude `.openhbam-oidc/` from folder
copies, snapshots, and support bundles. The file preserves pending web sign-ins
across restarts and is shared when processes serve the same folder. Cluster
routing sends every `/tabularius/auth/` start and callback to the leader; AI-app
resume handlers are leader-only process memory and do not survive a restart,
so an interrupted AI-app sign-in must be started again.

Session idle time, in-memory token lifetimes, authentication caches, lockouts,
and rate limits use a monotonic clock, so adjusting the host clock does not
shorten or extend them. Persisted credential expiries remain absolute dates.
If the wall clock falls more than five minutes behind a startup monotonic
reference (also advanced by observed forward jumps), the server warns on
stderr and continues checking expiry against the projected time. A backward
jump cannot revive an expired credential during that process's lifetime.
New credentials issued while the clock is behind may already be expired;
correct the clock. Restarts establish a new reference and cannot detect
changes made while the server was stopped. See the [clock audit](docs/clock-audit.md)
for the complete changed/retained checks and limitations.

Older versions used `.openhbam-oidc.sqlite` and its `-wal` and `-shm` sidecars
in the hosted folder. Exclude these legacy files from copies too. Once no old
server process uses them, they are safe to delete; current versions leave them
untouched. SQLite lock contention currently uses a 100 ms busy timeout and may
briefly block the server event loop; asynchronous lock-wait handling remains a
known gap.
Startup checks that the database pathname still names the validated file after
SQLite opens it. Node's SQLite API does not report the inode/device SQLite
actually opened, so a hostile swap to another file only during the open and a
restore before that pathname check remains a residual race.
The folder also holds the server's settings, schedules, logs and, unless you
send them elsewhere, backups:

| In the folder | What it is |
| --- | --- |
| `<name>.fmp12` | The FileMaker file you dropped in. Left as it is. |
| `<name>.openhbam.sqlite` | The hosted file. Everything people change is here. |
| `.openhbam.pid` | PID of the process currently hosting this folder. |
| `.openhbam-pid-<uuid>.tmp` | Temporary complete PID file used while claiming the folder. |
| `.openhbam-claim.sqlite` | SQLite lock that serializes folder claims. |
| `Backups/` | Backup sets, one folder per backup (`--backup-dir` or the console's Backups folder box moves them) |
| `RC_Data_FMS/<name>/`, `Files/<name>/` | Container files FileMaker stored outside the file, as FileMaker Server and FileMaker Pro keep them |
| `Logs/` | Event, Access, ScriptEvent, fmdapi and Admin logs |
| `Documents/` | The only place Import Records in scripts reads from |
| `.openhbam-schedules.json` | Script schedules |
| `.openhbam-schedule-runs.json` | Last run of each scheduled script |
| `.openhbam-settings.json` | Backup, log size and certificate settings (written by `migrate-fms`; flags win over it) |
| `.openhbam-tls/` | Certificates got with `--https` |
| `.openhbam-admin` | Shared admin-console password hash; keep private |
| `.openhbam-admin-passkeys` | Admin-console passkeys; keep private |
| `.openhbam-mcp-tokens.json` | MCP access tokens; keep private |
| `.openhbam-mcp-token` | The administrator's token for `/mcp`, made on first start (`tabularius mcp-token <folder>` prints it); readable only by the account that runs the server; keep private |
| `.openhbam-connections.json` | Configured external-service connections (no secrets) |
| `.openhbam-connection-secrets.json` | Encrypted external-service credentials; keep private |
| `.openhbam-connections.key` | Key for those credentials when no key is supplied by the environment; keep private |
| `.openhbam-mail-sent.json` | Mail rate-limit state |
| `.openhbam-webhooks.json` | Webhook configuration |
| `.openhbam-standby.json` | Standby server state |
| `.openhbam-sync.json` | Sync configuration (may name a password file outside this folder) |
| `.openhbam-sync-last.json` | Last sync run per file |
| `.openhbam-secrets/` | Password files used by sync configurations; keep private |
| `.openhbam-ai-usage.sqlite` | AI usage accounting |
| `.openhbam-ai-usage.json` | Legacy AI usage accounting file, read if present |
| `.openhbam-oauth.sqlite` | OAuth application credentials and state; keep private |
| `.openhbam-rag.sqlite` | Search index data |
| `.openhbam-component-library.json` | Component-library entries |
| `.openhbam-uploads/` | In-progress uploads |
| `.openhbam-oidc/` | Temporary identity-provider sign-in state; keep private (see above) |
| `.openhbam-design` | Design manifest used by the design-text tooling |

Backups copy only the hosted stores and external container files. For disaster
recovery, also copy the server's configuration and state files listed above by
hand, keeping the secret and credential files private.

## Request and upload limits

MCP POST bodies, OData JSON `$batch` envelopes, and the web client's dedicated
JSON readers (preferences, import options and script-dialog answers) accept at
most **64 nested object/array levels**, including the root container. Brackets
inside strings do not count. Deeper bodies use the surface's normal invalid-JSON
response (HTTP 400; MCP JSON-RPC code -32700). These checks retain each reader's
existing byte-size limit. The shared `readJson` reader is not yet covered. <!-- known-difference: Server operation ;; The limit on how deeply a request body may nest does not yet cover the shared readJson reader ;; A very deeply nested body sent to a route that uses that reader is not refused by this check ;; An owner decision, or moving that reader onto the check -->

OData, MCP, the admin console JSON API and the FileMaker-compatible Admin API
accept at most **32 in-flight requests per identity per surface**, per server
process. Excess requests receive **503** and **`Retry-After: 1`**; MCP uses a
JSON-RPC error and the Admin API uses its normal `messages` envelope. Clients
should wait before retrying. Static asset reads (including `/admin/`) are exempt.
OData groups requests by hosted file and account, regardless of session or API
token. MCP groups by account across files and credential types. Each admin
surface has one administrator identity shared by all its sign-ins and tokens.
Each surface tracks at most 4096 active identities and removes idle entries;
a new identity also receives 503 while that table is full. Slots remain held
until the operation and its response finish, including work whose client disconnects.

Browser uploads reserve their **declared source size** before creating a partial
file. `TABULARIUS_MAX_UPLOAD_IN_PROGRESS` sets the aggregate reservation quota in
bytes (default **21474836480**, 20 GiB) for the server's hosted folder. Uploads
receiving pieces, waiting for conversion, or converting all count. A request
that would exceed the quota receives **413**, before any file is created.
Reservations are released on deletion, idle expiry, conversion failure, successful
hosting, or parking an encrypted file. An active piece must finish or abort before
its upload can be deleted or swept. Restart discards partial uploads and their
reservations. Hosted/parked files and conversion output are outside this quota;
it is not a total disk-usage limit.

`TABULARIUS_MAX_UPLOAD` remains the per-file byte limit (default **10737418240**,
10 GiB); **0 disables only that per-file limit**, not the aggregate quota.
The aggregate setting must be a positive safe integer; zero, negative, fractional,
non-finite and invalid values use the 20 GiB default. Set environment variables
before starting the server. `TABULARIUS_UPLOAD_IDLE_HOURS` defaults to 24; 0 disables
idle expiry but does not disable either byte limit.

## Install

You need one of:

- **The single-file program** for macOS or Linux, from the latest release:
  `curl -fsSL https://github.com/sitotisai/tabularius/releases/latest/download/get.sh | sh`
  (it checks the download against the release's `SHA256SUMS`; see [QUICKSTART.md](QUICKSTART.md)).
  Windows has a program on the release page when that release's Windows build passed its check.
  Nothing else to install.
- **Node 22.20 or newer** and this repository: `./scripts/install.sh`
  (macOS, Linux) or `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`
  (Windows). Each puts a `tabularius` command on your PATH and fetches Node
  if yours is too old.
- **Docker**: `docker compose up -d` hosts `./Databases` on port 8080 (the README's Docker steps make the folder writable for the container and set the passwords).

Then, on the server machine:

<!-- docs-example: illustrative -->
```sh
tabularius admin-password /srv/Databases          # the admin console's password
tabularius service install /srv/Databases --system --port 8080 --host 0.0.0.0 -- --https local
```

`--https local` serves over HTTPS with the server's own certificate (see
[Certificates](#certificates-tls)), so no password crosses the network in the
clear; leave it out for plain http.

The admin console (`/admin/`) has its own sign-in page: there is no user name,
only the password set with `admin-password`, which is not a FileMaker
account. Running `admin-password` again sets a new one if it's forgotten; the
sign-in page shows the exact command for the server's folder, but only to a
browser on the server itself (anyone else is told to give the folder). Setting
a new password ends every console sign-in made with the old one. Until a
password is set, the console opens only to a request from this computer
itself: not one a proxy on it passed on (a `x-forwarded-for`, `forwarded` or
`x-real-ip` header), and not one addressed to any name but `localhost`,
`127.0.0.1` or `[::1]`. A signed-in console is not locked out by other
people's wrong passwords from the same address.
Admin password lockouts are recorded as warnings in the event log, along with
the third wrong attempt per address bucket in a window and lock-table overflow.

`admin-password` (and `passwd`) asks for the password twice in a terminal,
without showing it. In a script, pipe it in
(`printf '%s\n' "$PW" | tabularius admin-password ...`) or set `TABULARIUS_PASSWORD`.

**The port.** `service install` first checks that nothing else is listening
on the port. If something is (nginx or another web server often holds 8080),
it stops and names a free port to use instead, so the service manager isn't
left restarting a server that can't start. `lsof -nP -iTCP:8080 -sTCP:LISTEN`
shows which program holds it. If the port is taken later, the server's log
says `port 8080 is in use` each time it tries to start (macOS:
`~/.openhbam/logs/server.log`; Linux: `journalctl -u openhbam`).

`service install` makes it start at boot (`--system`) or at sign-in: a
LaunchDaemon or LaunchAgent on macOS, a systemd unit on Linux, a Task
Scheduler task on Windows, restarted if it stops. Anything after `--` is
passed to `tabularius serve`, for example
`-- --https files.example.com --workers auto`. `tabularius service print ...`
shows the service file without installing it, and `tabularius service uninstall`
removes it; the folder is never touched.

Check it's up: `GET /tabularius/health` answers `{"status":"ok"}`, with its uptime and server time, without
signing in. The admin console is at `/admin/`, the web client at `/app/`.

**Large files.** A file is converted on a worker thread, a few rows at a
time, so memory stays flat whatever its size: a 7.9 GB file converts in a
little over two minutes using under 300 MB. The admin console shows how far
each conversion has got. If the server stops part way, the conversion carries
on where it was when the server starts again. The converted store is about
the size of the `.fmp12`, so leave that much free disk.

### Files that use Encryption at Rest

A .fmp12 encrypted in FileMaker (Encryption at Rest) can't be read without
its passphrase. Dropped into the folder or uploaded, it shows under Hosted
files as **Needs passphrase**, with the hint its author set. Enter the
passphrase there and it is converted and hosted. The passphrase is used for
that one conversion: it is never stored, logged or sent to AI, so converting
the file again asks for it again. On the command line, the commands that
read a `.fmp12` (`info`, `schema`, `records`, `export`, `ddr`) and
`reconvert` ask for it hidden in a terminal (or read
`TABULARIUS_SOURCE_PASSPHRASE`). The converted store isn't encrypted by this;
see encryption at rest for that.

## Moving from FileMaker Server

For a repeatable stop, resume and verification procedure, see the
[migration and sync runbook](docs/fms-migration-runbook.md).

On the FileMaker Server machine (or with its folder copied over), one command
brings its hosted files, their externally stored container folders, its
script schedules, its backup schedule and its SSL certificate into a Tabularius
folder:

<!-- docs-example: illustrative -->
```sh
export TABULARIUS_FMS_KEY_PASSPHRASE='...'      # the passphrase the certificate was imported with
tabularius migrate-fms /srv/Databases --fms-dir "/Library/FileMaker Server" --from https://localhost --insecure --dry-run
tabularius migrate-fms /srv/Databases --fms-dir "/Library/FileMaker Server" --from https://localhost --insecure
tabularius serve /srv/Databases --https files.example.com --port 443
```

- `--fms-dir` is FileMaker Server's own folder:
  `/Library/FileMaker Server` on macOS,
  `C:\Program Files\FileMaker\FileMaker Server` on Windows,
  `/opt/FileMaker/FileMaker Server` on Linux. Files are copied from its
  `Data/Databases` (the originals stay), and the certificate from `CStore`.
- `--from` reads the schedules and the list of hosted files through
  FileMaker Server's Admin API, signing in as its Admin Console account
  (`--user`, default `admin`; password in `TABULARIUS_FMS_PASSWORD` or typed).
  `--insecure` accepts the self-signed certificate a new FileMaker Server
  has. `--save fms.json` keeps what it read, and `--from fms.json` reads that
  file instead, so you can read the old server once and migrate on another
  machine.
- `--dry-run` says what it would do and how much it would copy, and changes
  nothing.

Stop Tabularius in the destination folder before migrating, and use stopped
source files or a stable source copy. Each database and its container folder
are staged, checked against the source bytes, and published together using
the restore recovery journal. A failed transfer preserves the originals;
retry after resolving the reported disk, source-change, or destination
conflict. Unencrypted files also receive the reader's header and block-count
checks; this is not a full FileMaker consistency check. Encrypted source
contents are not validated without their passphrase.

It prints what came over and what didn't, and why:

- **Files** are copied in whole, so the server never converts half a file.
  Container files stored outside the file (open storage) are copied too, to
  `RC_Data_FMS/<file>/`, where the server reads them. Secure storage and
  files FileMaker encrypted at rest can't be read yet. In the admin console,
  **Hosted files** shows how many container files each file keeps outside
  it; **Check** lists, for each container field, how many are found and
  missing and the folder under `RC_Data_FMS/<file>/` they belong in, so you
  know what to bring over when the old server's folder wasn't reachable.
- **FileMaker script schedules** become Tabularius schedules with the same
  file, script, parameter, account and timing. Like all schedules here they
  run offline until the schedule's network option and the file's Script
  network switch are both on. Weekly schedules that skip days come over turned off, since
  Tabularius schedules repeat every day or every few days; one that stopped at
  a time of day repeats around the clock. Schedule emails aren't sent.
- **Backup schedules**: Tabularius has one backup schedule, so the most
  frequent one that backs up every file sets `backupEvery` and `keep`.
- **Message, system-script and script-sequence schedules** don't come over.
  System scripts in particular are left for you to move to cron or Task
  Scheduler yourself, if they're still wanted.
- **The certificate** (`CStore/serverCustom.pem` and its key) is written to
  `tls/` in the folder, the key decrypted and readable by its owner only, and
  `serve` uses it from then on.

Running it again only adds what's new: files already in the folder and
schedules with a name already used are left alone.

## Keeping a FileMaker Server copy in step

If you're trying Tabularius while the file still runs on FileMaker Server, a
sync can keep the two copies' records in step, so leaving is easy.
`sync-plan` **previews** it: it reads both sides and says what a sync would
move, and writes nothing to either. `sync-apply --write` then **sends** the
records that go to FileMaker, and `sync-apply --pull` **brings** FileMaker's
changes here (see below). The admin console does the same from a page, and a
server schedule can run it on a timer (see **From the admin console** below).

Both copies need, in each table you sync:

- **a UUID field** with the same value on both sides (in FileMaker, a text
  field that auto-enters `Get ( UUID )`), filled in on every record;
- **a modification timestamp field** (auto-enter, modification timestamp).

Sync never adds them for you: a table without them, here or on the layout
you name on FileMaker Server, is reported as paused, with the missing fields
named. On FileMaker Server, the account you sign in with needs the
**fmrest** extended privilege and must be able to see every record in the
table (a record it can't see would look deleted).

Write the setup to a file, for example `sync.json`:

```json
{
  "server": "https://fms.example.com",
  "database": "Invoices",
  "user": "sync",
  "tables": [
    { "localTable": "Invoices", "remoteLayout": "Invoices", "uuidField": "uuid", "modTimestampField": "modified" }
  ]
}
```

`remoteLayout` defaults to the table's name. Then:

<!-- docs-example: illustrative -->
```sh
tabularius sync-plan ~/Databases Invoices --config sync.json
```

The password is read from `TABULARIUS_FMS_PASSWORD` or typed, and is only
sent over https. `--insecure` accepts a new FileMaker Server's self-signed
certificate; `--json` prints the
whole plan. For each table it lists the records that would go to FileMaker,
the ones that would come here, and **conflicts**: records changed on both
sides since they last matched. By default a conflict is held for you to
decide and never overwritten. A table's `policy` can say otherwise:
`filemaker-wins`, `tabularius-wins`, or `newer-wins` (the later modification
timestamp wins; equal or unreadable timestamps are held for review). Each
server stamps in its own time zone, so use `newer-wins` only when this server
and FileMaker Server are set to the same one.

Good to know:

- Only records move. Fields, layouts, scripts, value lists, accounts and
  privileges never do. Container files move only with `--containers`
  (see below).
- Until a sync has run once, every record that differs between the two
  copies is a conflict (held for review, unless the table's policy picks a
  side), since there's no earlier match to tell which side changed.
- If records are added or deleted on FileMaker while a table is being read,
  that table is paused for this run; run it again.
- Records with an empty UUID field are left out and counted.
- Each run reads every record of each table through FileMaker's Data API, so
  a large table takes a while.
- A capture-only file (one named with `--capture-only`, or in
  `TABULARIUS_CAPTURE_ONLY`) never syncs, planning included.

### Sending records to FileMaker Server, and bringing them here

`sync-apply` is `sync-plan`'s next step. It is off by default, three ways:

- Without `--write` or `--pull` it is a dry run, like `sync-plan`, that also
  says what would move. Its connection to FileMaker has no way to write.
- Writing to FileMaker needs `"allowWrites": true` in `sync.json`, so a file is
  only ever written to a server its own configuration names.
- Writing to FileMaker needs `--write` on the command.

<!-- docs-example: illustrative -->
```sh
tabularius sync-apply ~/Databases Invoices --config sync.json            # dry run
tabularius sync-apply ~/Databases Invoices --config sync.json --write    # send
tabularius sync-apply ~/Databases Invoices --config sync.json --pull     # bring here
tabularius sync-log ~/Databases Invoices                                 # what was sent
```

It plans first, from one reading of both sides, then sends from that same
reading:

- **Conflicts stop it.** If the plan holds any conflict, nothing at all is
  sent, and it says which records. Settle them with a table's `policy`, or
  `--resolve tabularius-wins|filemaker-wins|newer-wins` (which fills in only
  tables left on the default `flag`; a table's own policy is kept). A record
  deleted on one side and changed on the other is always held.
- **Only new and changed records go to FileMaker**, by UUID. An update sends
  just the fields that differ, with the record's modification ID, so
  FileMaker itself refuses it (error 306) if someone has edited the record
  since it was read; that record is reported and the rest go on. Fields that
  aren't stored fields on the layout (calculations, summaries, globals,
  repeating fields, related fields), containers (unless `--containers`, below)
  and the modification timestamp are never sent; each run lists what it left out.
- **Deletions are held** until you add `--allow-deletes`, and are checked
  against the record's modification ID before they go.
- **Records FileMaker has that you don't** aren't brought here unless you
  add `--pull` (below); without it they are counted.
- **Everything sent is logged** (`sync-log`, or the `_fm_sync_log` table in the
  file): each write is recorded before it goes out and finished after, with the
  FileMaker record, its modification ID before and after, and the field names
  (not their values). A run that died mid-write leaves a `attempt` row, which
  the next run marks `interrupted`.
- **Run it again to resume.** Each record sent is noted in the file as it
  goes, so a rerun sends only what's left, and a record that reached
  FileMaker but wasn't noted (a dropped connection, say) is recognized by its
  UUID and noted, not made twice. A failure that isn't one record's (the
  account, the layout, the network) stops the run, as do 20 refused records.
- **The UUID field has to keep the value it's given.** After making a record
  it reads it back; if FileMaker changed the UUID (for instance the field
  prohibits modification of its auto-entered value) it stops, holds that
  table, and tells you to fix the field and remove the stray record, then
  run with `--release`.
- **A session that ends mid-run is replaced.** FileMaker ends a Data API
  session after 15 idle minutes (a long local pull between the reads and the
  first write can do it) and answers error 952 without doing anything. The
  connection signs in again and sends that one request again, once; a second
  952 stops the run as any other refusal does. Container files are fetched
  with the session's cookie, so one that comes right after such a gap can
  still be refused and is listed as left out.
- Dates go to FileMaker in the Data API's `MM/DD/YYYY` form. The account needs
  the same fmrest privilege plus rights to create, edit and delete those
  records.

**`--pull`** is the other direction, and a separate opt-in (it changes this
file, not the server, so it doesn't need `allowWrites`): records new or
changed on FileMaker are created or updated here, and records deleted on
FileMaker are deleted here only with `--allow-deletes`; as a delete here does,
that also deletes the records this file's relationships say go with it ("Delete
related records in this table when a record is deleted in the other table"), and
the report counts them. `--keep-related` (the Sync page's "leaves the records
related to it") deletes only the record FileMaker deleted. `--write` and
`--pull` can be given together; each alone leaves the other direction
counted and untouched. The same rules hold: conflicts stop the run, every
change is logged (`pull-create`, `pull-update`, `pull-delete`), and a rerun
resumes. Specifics:

- Values are written as an import would, with auto-enter options off, but
  with this file's validation and calculations on; a value this file refuses
  fails that record only.
- An update carries the record's modification ID, so a record edited here
  since the plan was read is refused (not overwritten) and shows up as a
  conflict on the next run. A delete is checked the same way.
- A deletion made here follows the file's relationships, as any delete here
  does, so related records are deleted with it.
- Calculations, summaries and the modification timestamp are never brought
  over. Container files are not either, unless you ask for them (next).

**Container files** (photos, documents) move only with `--containers`, and
only when `sync.json` has `"allowContainers": true`, so a run is as before
unless both are there. With `--pull` they come here; with `--write` they go to
FileMaker; with both, both ways. Either way a file is up to 50 MB, and one
that is over, missing, or refused is left out and listed (`file left out:` in
the output) while the record still moves; a file left out is tried again only
when the record next changes.

- **Coming here.** For each record being pulled, and each record that changed
  on FileMaker only in a container, the file is fetched, compared with the one
  here, and stored only if it differs; a container FileMaker emptied is
  emptied here. A record and its files go in together, so a file that can't be
  stored leaves no half-made record. Files are fetched only from the server the
  sync signed in to (the same scheme, host and port): an address on any other
  host is skipped and listed, never fetched.
- **Going to FileMaker.** For each record being sent, and each record that
  changed here only in a container, the file is put in the record's container
  (the first repetition) after the record is made or updated, and only if
  FileMaker's differs from this file's (it is fetched to compare). A record
  changed only in its files is checked against the version that was read, as
  an update's modification ID would, and left alone if it has changed since. A
  container emptied here is not emptied on FileMaker: the file there is left
  as it is, and the record is listed as `file left out` (the Sync page lists it
  too) so the difference is not silent. A file FileMaker refuses
  is listed, and the record is still recorded as sent.
- **Both sides changed a file.** A record changed on both sides whose other
  fields agree is compared by its container files when `--containers` is
  given; if they differ (or one side's is empty), it is a conflict like any
  other, with the container field named: settled by the table's `policy`, or
  held for review with a choice per record. The command line's read-only dry
  run can't read this file's containers, so it doesn't show these (its output
  says so when `--containers` is given); a real run (or the console's check)
  does.
- The log names the container field of each record changed, never its
  contents. With neither `--pull` nor `--write`, `--containers` only counts
  the files that would be fetched or sent. Repeating containers don't move.
  Scheduled syncs don't move files.

### From the admin console

The console's **Sync with FileMaker Server** section does the same without the
command line. Pick a hosted file and fill in its setup (the server, the file's
name there, the account, the tables and their UUID and modification fields, a
conflict policy per table). The setup is saved next to the hosted files in
`.openhbam-sync.json`, readable by its owner only. It never holds the
FileMaker password: that comes from a file in the secrets folder (named by
`passwordFile`), from `TABULARIUS_FMS_PASSWORD`, or is typed for one check or run
and forgotten. The page's "last run" (what the latest check or sync found,
including the records waiting for a choice) is kept in
`.openhbam-sync-last.json` beside it, so a restart doesn't blank it; saving
the setup again with another server, file or table mapping starts it empty.

Because whoever can save a setup chooses where the password goes, the server
holds that to what you say: a password file has to be inside
`<hosted folder>/.openhbam-secrets` (or the folder in `TABULARIUS_SYNC_SECRETS`;
links out of it are not followed), `TABULARIUS_FMS_PASSWORD` is only sent to a
server you list in `TABULARIUS_SYNC_HOSTS` (host or host:port, comma separated),
and once that list is set no other server is reached. Without it, this machine,
link-local and cloud-metadata addresses are refused, and private network
addresses (where a FileMaker Server usually is) are allowed. FileMaker's
refusals appear in FileMaker's words for the error code, not the other
server's text, and a failed connection says only that it failed.

- **Check now** is a dry run.
- **Records changed on both sides** are listed with both values. Pick, per
  record, this file's version (sent to FileMaker) or FileMaker's (brought
  here); a record deleted on one side and changed on the other has its own
  pair of choices. Nothing is written while any record is undecided, and a
  pick is checked against both sides again when the sync runs; if either record
  changed since, the run is refused.
- **Run the sync** needs two opt-ins for each direction: "May send to
  FileMaker" / "May be changed from FileMaker" in the setup (both off), and
  the matching box ticked for that run. Deletions and releasing a held table
  are their own boxes. A pick of this file's version needs the send box, and a
  pick of FileMaker's needs the bring-in box. Container files are a third
  opt-in on top of those: "May also move container files" in the setup (off)
  and "Include container files" for that run, sent with the send box and
  brought with the bring-in box. A check counts the files a run would fetch or send.
- **Scheduled syncs** use the same schedules as scripts (they also show in
  Script schedules). A scheduled sync is a **check** by default: it reads both
  sides and writes neither. A schedule can be set to also send, bring in
  changes, or both, but only where the setup allows it, and a scheduled run
  never includes deletions. It needs the password from a file or
  `TABULARIUS_FMS_PASSWORD`, since nobody is there to type it. Records changed on
  both sides stop a send or bring-in before anything moves. They raise an alert:
  the schedule's run lists them, **Scheduled syncs that need a decision** shows
  on Security health, and the server's Event log says so (once, then again when
  the count changes or clears). Settle them in the review above and the next
  run goes through. A schedule through the REST API is
  `{"database": "Invoices", "everyMinutes": 60, "sync": {}}`, or with
  `"sync": {"write": true}` / `{"pull": true}`.
- **Sync log** is the same log as `sync-log`.
- **AI apps** connected as the administrator (this computer, or the server's
  MCP token) can ask `sync_status` where syncing stands: the setup, what the
  latest check found, the scheduled syncs and which are waiting on a decision.
  It is read-only, never shows record values, passwords or password file
  paths, and conflicts are still settled in this page.

`npm run smoke:sync` drives this page in a real browser against a stand-in
Data API, for developers.

## Taking design changes back to FileMaker

Sync moves records only. For changes to the design (new tables, fields,
scripts, value lists and custom functions, and renames and deletions),
`write-back` lists what changed since the file came from its .fmp12 and
gets it ready to apply in FileMaker Pro by hand:

<!-- docs-example: illustrative -->
```sh
tabularius write-back ~/Databases Invoices ~/Desktop/invoices-changes
```

It compares the file with the `Invoices.fmp12` next to it (or the one given
with `--fmp12`) and writes numbered `.xml` files, plus a `README.md` saying
where in FileMaker to paste each one, in order, and what to do by hand:
renames, deletions, edits to existing fields and value lists, the
relationships graph, and layouts. It only reads: nothing changes here or in
the .fmp12. The output folder must be empty or new.

FileMaker Pro reads its clipboard in its own format, so the XML text goes
through a clipboard tool that converts it, as for **Copy for FileMaker** in
Design mode. FileMaker never pastes over an existing object, which is why
an edited script comes as all of its steps, to paste in place of the old
ones.

## Upgrade

<!-- docs-example: illustrative -->
```sh
tabularius upgrade
```

It fetches the newest version into the install, backs up the hosted folder,
restarts the service and waits up to 90 seconds (`--wait`) for its health
check. If the new version doesn't come up, it puts the old one back and starts
that. It doesn't wait out the 90 seconds when the new server has plainly
failed (no server process for 20 seconds, or the service manager restarting
it again and again). `--no-backup` skips the backup. It refuses an install with local changes,
so nothing of yours is overwritten. Hosted files are brought up to date by the
new version as it opens them. [Upgrading](docs/upgrading.md) says what is promised across versions,
how to roll back, and why an upgrade to a version that cannot read your files' format is refused.

Accounts switched off in FileMaker (the **Active** box unticked in Manage
Security) stay switched off here. Files converted before this was read had
every account switched on; the first time a newer version opens such a file it
switches off the ones FileMaker has off, once, and logs their names. It needs
the `.fmp12` beside the store to read them from; a `.fmp12` that uses
Encryption at Rest is read when it is converted again. After that, accounts
are switched on and off here: an account you turn back on stays on, and
unticking **Active** in FileMaker later isn't picked up, not even by
converting again, so switch the account off here too.

### Converting a file again

Some fixes change what conversion reads from a `.fmp12`. Container files are
an example: they were linked to the wrong file in files converted before
0.1.0. A file converted by an older version is flagged in the server's log at
startup and in the admin console's **Hosted files**, with a **Convert again**
button. From a terminal on the server, `tabularius reconvert <folder> <file>`
(or `--all`, with `--dry-run` to see what would change first) does the same.
While the server runs, the command asks it to, so it needs no sudo and no
admin password, and the other files stay up. Run it as the user the server
runs as: the server leaves a token for that user in `<folder>/.openhbam.local`.

It converts the `.fmp12` beside the store afresh and carries over what
happened since the first conversion:

- records created, changed and deleted (changed records keep the fields
  their audit log names, or all fields when it names none)
- accounts, passwords, privilege sets, API tokens, two-factor secrets, the
  audit log and other settings

The file is closed while it converts. The store as it was is kept beside it
as `<file>.openhbam.sqlite.before-reconvert-<time>`.

Before anything changes, **Convert again** does a dry run in a scratch folder
and asks with what it found: accounts kept, edits carried over (or, for a file
whose design was changed here, not), record values the fixed converter reads
differently, and container files. With several files to do, **Convert all
again…** shows that for every file at once, then converts the ones listed. If
an account would ever be missing afterwards, converting refuses and changes
nothing.

A `.fmp12` copied to another machine has a new modification time but the same
content, and converting again carries edits over as usual: it is compared by
checksum. Files converted before 0.1.0 have no checksum to compare, so for a
`.fmp12` newer than its conversion, Tabularius asks whether it is the same file
(the console asks; `--same-file` answers yes from a terminal).

Carrying edits over isn't safe in two cases: the file's design was changed
here, or the `.fmp12` changed after it was converted. In either case the
console says so, and converting again starts afresh from the `.fmp12`
(`--force` on the command line). The old store is still kept beside it.
This isn't available yet with encryption at rest.

With Docker: `git pull && docker compose up -d --build`.

### Without a GitHub sign-in

The repository is private, so a server that can't sign in to GitHub can't
clone or pull it. Bring the new version over as a file instead, and install
or upgrade from it with `--from`. Nothing on the server needs your GitHub
login.

On a computer that can reach GitHub, make a git bundle (one file holding the
repository):

```sh
git -C ~/tabularius pull
git -C ~/tabularius bundle create ~/tabularius.bundle HEAD main
scp ~/tabularius.bundle server.local:   # or AirDrop, a USB stick, a shared folder
```

On the server, the first time:

```sh
git clone ~/tabularius.bundle ~/tabularius && ~/tabularius/scripts/install.sh --service /srv/Databases --system
# or, without cloning first:
./install.sh --from ~/tabularius.bundle --service /srv/Databases --system
```

And for each new version:

<!-- docs-example: illustrative -->
```sh
tabularius upgrade --from ~/tabularius.bundle
```

An install from before `--from` existed ignores it. Upgrade that one once by
hand, from the install's folder (`~/.openhbam/app`, or your checkout):
`git pull --ff-only ~/tabularius.bundle main && npm ci --omit=dev`, then restart
the service (macOS: `sudo launchctl kickstart -k system/org.openhbam.server`).
After that, `--from` works.

`--from` also takes a tarball (`.tar.gz`, such as a release asset you
downloaded) or a folder of the new version's files. A bundle upgrades a git
install in place. A tarball or folder is unpacked beside the install and
swapped in, and the version before is kept as `<install>.previous`. Either
way the upgrade does what `tabularius upgrade` always does: back up, restart,
wait for the health check, and put the previous version back if the new one
doesn't start, or if the service can't be restarted. A macOS LaunchDaemon
(`--system`) is restarted by stopping its server, which launchd starts again,
so an upgrade needs no sudo password and can run from a script or over SSH.

## The audit trail

Every record created, changed, deleted or duplicated is logged automatically in
every file, with the account, the time, where it came from (web client, Data
API, OData, an AI app, the admin console, an automation, an import, a sync, a script) and each
field's old and new value. Container files are logged by name, size and hash,
never their contents. Nothing needs setting up. Reads aren't logged unless you turn that on (one entry per request through the Data API, OData, the web client or the AI tools that read records, with the table and record ids, never the values; a SQL query, over HTTP, Postgres clients or the sql_query AI tool, gets one entry for each table it names, with the number of rows it returned and never the query text; the AI tools that read the design (tables, scripts, layouts, formulas, privilege sets) get one entry naming the tool, and reading a container's file one entry with its name and size, never what was returned; a formula's ExecuteSQL is not logged, as it can run for every record a layout shows).

In the admin console's **Audit log**: filter by **Source**, account, a **From** and **To** date or security
events only (the list shows the newest entries up to **Show**, and says when older ones are left out); **Verify record log** checks that no entry was edited, removed or
slipped in afterwards (entries are linked by hashes; note the newest entry's
hash somewhere else to notice a rewritten tail). Under **What the log keeps, and
for how long** you can name fields whose values are never logged, switch on
leaving out fields named like passwords, keys and card numbers, and set how
long entries are kept (older ones are removed hourly; the removal is recorded in
the chain and the security events). A value that isn't logged can't be put back.

The hashes show the log is consistent with itself, not that it is the log you
had. Someone who can rewrite the whole file can recompute every link. To catch
that, keep a signed copy of the newest hash somewhere the server can't reach:

    tabularius audit verify <folder> <database> --chain records --sign-key my.key > anchor.json

(`--chain security` for sign-ins and privilege changes; `my.key` is a secret of
at least 16 bytes that you keep off the server.) Later, check the log against
it:

    tabularius audit verify <folder> <database> --chain records --sign-key my.key --check anchor.json

It exits 1 if the log no longer holds that hash at that position (rewritten, cut
short or rolled back to an older backup), or if the anchor was edited or the
key is a different one. Entries added since are fine. If retention has removed
the log up to past the anchor, it says so, and a newer anchor is needed.

Anyone with access to a record can open **Records > Record History** in the web
client to see its changes and put one back (limited to what their account could
change by hand). The same history is available to AI tools (`audit_log`,
`explain_record_history`) and over the API (`GET /tabularius/admin/v1/audit`).

## Putting a record back

In the admin console's **Audit log**, **History** on any record change lists
that record's changes. **Put back as it was after this** sets the record back
to that point: changed fields are set back, a record deleted since is made
again with its id, and one made since is deleted. Putting back is logged as a
change of its own, so it can be undone the same way. It is refused while
someone is editing the record, and when the table was emptied (Truncate
Table) since that point. Records a cascading delete removed with it each have
their own history.

## Backups and restore

By default the server backs up every hosted file once a day into
`<folder>/Backups/<date_time>/` and keeps the last 7, while people keep
working. Each set is read back and checked before it's kept, and one older
set is checked again each time, so damage on disk is found while there are
good sets to fall back on.

Once a day, a good set is also **restored as a test**: copied to a scratch
folder, each file opened as the server opens a hosted file, and its tables,
records and accounts counted, then the scratch copy is deleted. The admin
console's **Backups** shows each set's last check and test restore, with
**Check now** and **Test restore** buttons.

| To | Use |
| --- | --- |
| Back up more or less often | `--backup-every 6h` (`30m`, `1d`, ... or `off`), `--keep 30` |
| Back up elsewhere | `--backup-dir /mnt/backups`, or the admin console's Backups section (saved in `.openhbam-settings.json`) |
| Keep changes between backups | `--progressive 5m`: restore to any of those moments |
| Copy backups off the machine | `--backup-s3 s3://bucket/prefix` (`--s3-endpoint` for R2, B2, MinIO, Wasabi; keys in `TABULARIUS_S3_ACCESS_KEY`/`TABULARIUS_S3_SECRET_KEY`) |
| Encrypt backups | `TABULARIUS_BACKUP_KEY` set to a passphrase (keep it somewhere else) |
| Encrypt the hosted files on disk | `TABULARIUS_ENCRYPTION_KEY`, then `tabularius encrypt <folder>` with the server stopped |
| Back up now | `tabularius backup <folder>`, or **Back up now** in the admin console |
| Check backups | `tabularius verify-backup <folder> [set]` (exits 1 if one is damaged) |

Restoring:

<!-- docs-example: illustrative -->
```sh
tabularius restore /srv/Databases 2026-10-11_020000            # a whole set (stop the server first)
tabularius restore /srv/Databases 2026-10-11_020000 Contacts   # one file
tabularius restore /srv/Databases --at "2026-10-11 14:05" Contacts   # a moment (with --progressive)
tabularius restore /srv/Databases --at "2026-10-11 14:05" --from s3://bucket/prefix   # from off-site, on any machine
```

Container files stored outside a hosted file (in `RC_Data_FMS/<name>/` or
`Files/<name>/`) go into each set beside it. Files unchanged since the last
set are hard links to its copy, so they take no more room. A restore of a set
puts that folder back too; a restore to a moment leaves it as it is.

Restoring a database carries forward its current credential state. Revoked
`ohbt_` and `ohm_` tokens, OAuth grants, TOTP credentials, passkeys and recovery
codes stay revoked. For every account present in both files, the current
password hash is retained; accounts absent from the current file do not regain
credentials, so restoring into a folder that has lost the file leaves every
account without a password until `tabularius passwd` sets one. In-memory sessions
are not restored. The account active flag is
point-in-time data: restoring an older active flag can reactivate the
account. Review account status after a restore and deactivate it again if
needed.

While the server runs, the admin console's **Restore a file to a moment**
puts one file back, by default as a copy hosted next to the current one (the
current file is not touched), or, when you choose **Replace the file as it is
now**, in place (that file's users are disconnected and it reopens). The Admin
API's `POST /restore` does the same: with no `mode` it makes a copy, and only
`"mode": "replace"` replaces the live file. `tabularius restore` on the
command line is a different, offline command and still puts the files back
over the folder.

For a machine to take over if the server fails, run a **standby**:
`tabularius serve <folder> --replication-token T` on the main server and
`tabularius standby <folder> --primary URL --token T` on the second. To take
over, stop the standby and `tabularius serve` its folder. What it keeps, what a
takeover gives you and what it does not copy (sessions, externally stored
containers, the settings files above) is in
[docs/standby-guarantees.md](docs/standby-guarantees.md).

## Certificates (TLS)

A server that would listen beyond this computer (`--host 0.0.0.0` or an address) over plain HTTP **refuses to start**, because passwords and sign-in tokens would cross the network unencrypted. HTTPS (`--https`, `--https local`, `--tls-cert` with `--tls-key`) lifts the refusal. So does `--allow-plain-http` (or `TABULARIUS_ALLOW_PLAIN_HTTP=1`), for a server behind a proxy or network you control that does the HTTPS; it still prints a warning unless the proxy is named with `--public-url https://...`. `service install` listens on this computer only unless `--host` says otherwise, and applies the same rule. [Security defaults](docs/security-defaults.md) lists this and every other default.

Pick one:

- **On a local network, with no name to buy**: `--https local`. Tabularius
  makes its own small certificate authority in `<folder>/.openhbam-tls/local`
  and a certificate from it for the machine's names (`myserver`,
  `myserver.local`) and private addresses (`192.168.1.20`). Each Mac, iPhone,
  iPad or PC trusts the authority once: open `https://<server>:<port>/tabularius/tls/`
  there for the steps (a profile for Apple devices, a certificate for Windows
  and Android), and check the fingerprint it shows against the admin console's.
  The authority can only vouch for private names and addresses, so trusting it
  doesn't let it stand in for other websites. The server certificate is made
  again on start when it nears its end (Apple devices accept 13 months at
  most) or the machine's addresses change; restart the server about once a
  year if nothing else does.
- **Let's Encrypt, automatically**:
  `tabularius serve <folder> --https files.example.com --https-email you@example.com`.
  The name must point at the machine and port 80 must reach it. It serves on
  443 and renews a month before expiry. On Linux, let Node use low ports with
  `sudo setcap cap_net_bind_service=+ep $(which node)`.
- **Your own certificate**: `--tls-cert cert.pem --tls-key key.pem` (the cert
  file may carry the intermediate certificates after it). `migrate-fms`
  sets these from FileMaker Server's certificate.
- **Behind a proxy** such as Caddy, nginx or a load balancer that handles TLS:
  give `--public-url https://files.example.com` so links and redirects use it.
  Without it, any request that carries a cookie or Basic credentials and is
  addressed to that name is refused with 403 (`Cross-origin request denied:
  ... set --public-url or --https`) and the server logs the name once. This
  holds for scripts and database drivers too, not only browsers: a page whose
  name points at this computer can send a request with no browser headers.
  Connect by an IP address or `localhost`, or give the name with
  `--public-url` or `--https`.
  Also give `--proxy-header` with
  the header it writes the visitor's address into: `x-forwarded-for` (Caddy,
  Tailscale, cloudflared, nginx with `$proxy_add_x_forwarded_for`),
  `x-real-ip` (nginx with `$remote_addr`) or `forwarded`. Lockouts, "local
  only" accounts and the logs then see each visitor. Loopback peers are trusted;
  for a proxy on another machine or in another container, also give
  `--trusted-proxies 172.30.0.0/24` (or `TABULARIUS_TRUSTED_PROXIES`), a comma-separated
  list of proxy IP addresses or CIDRs. Trust only addresses controlled by your
  proxy, and name only a header it sets itself; a header passed on unchanged
  can be written by the visitor. Untrusted or unreadable forwarding headers
  identify one unknown visitor: never this computer and
  never the local network, so the admin console before its password is set,
  "local only" accounts and blank passwords stay closed to them, but one
  stranger's wrong console passwords can lock out everyone behind the proxy.
  Unauthenticated console passkey challenges from unknown visitors share a
  larger bucket of 100, within the global limit of 2,000; known addresses have
  a limit of 5 (IPv6 uses a /64, plus 50 per /48). Authenticated callers are
  exempt from these caller limits and still share the global limit. The proxy
  must write the configured visitor header. In particular, nginx's plain
  `proxy_pass` adds none; a default loopback connection without headers looks
  like this computer itself, so set
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` there.

  `compose.https.yaml` configures Caddy's header and trusts its dedicated
  Compose network (`172.30.0.0/24` by default). If that overlaps an existing
  network, set `TABULARIUS_PROXY_SUBNET` in the shell or Compose `.env` file;
  it updates both the network subnet and `TABULARIUS_TRUSTED_PROXIES`. Keep
  untrusted containers off this network and leave the backend's port 8080
  unpublished. The file's `TABULARIUS_PUBLIC_URL` must match your public name.

HTTP listeners allow **64 simultaneous connections per client address** and
1,024 connections in total. Set `--connections-per-address 128` or
`TABULARIUS_CONNECTIONS_PER_ADDRESS=128` to change the per-address limit (a positive
whole number; the flag takes precedence). These transport budgets apply to all
connections, independently of authentication. With `--proxy-header` and a trusted
proxy (`--trusted-proxies`, or loopback), the limit counts the forwarded visitor
while its response is outstanding, rather than grouping visitors under the proxy's
address. Idle proxy connections and visitors with an unusable forwarded address
still count toward the total. A proxy visitor above its cap receives `429`;
excess direct connections close before HTTP processing. Untrusted peers cannot
use forwarded headers to evade the direct connection cap. In `--workers` mode,
per-address limits apply at the front; private Unix connections to workers are
exempt from the per-address cap.

Headers must finish within 10 seconds. Bodies have a **300-second idle timeout**;
progressing uploads can take longer than 300 seconds. Connections close after
their 100th complete response; keep-alive clients reconnect normally. Pipelined
requests execute in order up to that budget, so a completed write's response is
sent before closing.

With any of the first three, `http://` to the same port is sent on to
`https://`, so old bookmarks keep working.

`/tabularius/admin/v1/metrics` reports the certificate's expiry, so you can
alert on it. Clients of the PostgreSQL port (`--sql-port`) use the same
certificate.

## Using every CPU core

<!-- docs-example: illustrative -->
```sh
tabularius serve <folder> --workers auto      # one process per core; or --workers 4
```

Node runs a process's JavaScript on one core, so a busy server runs several
behind its one port. Sessions stay on the process they signed in to; record
locks, live updates, and closing, pausing and opening files work across all of
them, and the admin console lists everyone on every process. Schedules,
backups, webhooks, the PostgreSQL port and the folder watcher run in one of
them.

Record leases expire after 60 seconds without renewal. An open script
transaction renews every lock it uses every 30 seconds, including during waits
and bulk steps. After commit or rollback it releases the locks it acquired;
locks held before the transaction remain the session's responsibility.
If a lease is lost, the transaction cannot commit. A dead worker stops renewing,
so its leases still expire.

To bound runaway lock growth, each session may hold 100,000 record locks per
file by default. This is a host resource guard, not a FileMaker limit. Sessions
using the same service or schedule account have separate allowances; cluster
workers share the count for a given session. Set `TABULARIUS_MAX_SESSION_LOCKS`
to a positive integer before starting the server to raise or lower the guard.
Reaching it returns error 812 and rolls back the entire open transaction,
including when error capture or Set Revert Transaction on Error is off.
Renewals remain allowed at the limit. Counts are maintained as leases change;
expired entries are swept at most once per five seconds during normal
acquisition, and also when capacity is exhausted or locks are listed.

Email notifications for server events are sent by that one process too. The
others pass their error and warning lines to it, so they arrive in the same
digest, marked `[worker N]`.

HTTPS works with `--workers` whichever way the certificate comes: the
server's own (`--https local`), given with `--tls-cert` and `--tls-key`, or
got automatically (`--https name`). The front process holds it, and for an
automatic one also answers the authority's checks on port 80 and renews it;
the workers behind it serve the pages. The PostgreSQL port uses the same
certificate, and the admin console shows when it runs out and any renewal
problem, as with one process.

Encryption at rest (`TABULARIUS_ENCRYPTION_KEY`) works with `--workers`: the
first process unlocks the files before the others start, and encrypts each
one again once the others have let go of it, when a file is closed from the
admin console and when the server stops.

Not yet together with `--workers`: `--progressive` and <!-- known-difference: Server operation ;; --progressive and --replication-token do not work together with --workers ;; Run one process, the default, to use them ;; An owner decision -->
`--replication-token`. For those, run one process (the default).

Whole-table summaries, ExecuteSQL results and unstored calculations that
depend only on the data are worked out once per server and kept beside each
file (`<file>.results`), shared by every process. Right after a file opens,
and a couple of seconds after changes settle, a background thread works out
what each layout shows, so people don't wait for it; while it runs, a layout
shows the last value it had, faded in the web client (and listed under
`updating` in the record's JSON) until the new one is in. Whoever made the
change never sees an older value: their next read works it out. Totals, counts,
averages, minimums and maximums of a record's own values are brought up to date
as each record is edited, added or deleted, without reading the others. Only
one process works out each result at a time; the others wait for it. The
background thread has its own memory cap, `TABULARIUS_WARM_HEAP_MB` (default
1536). Set `TABULARIUS_SHARE_RESULTS=0` to turn all this off. It is off for files
encrypted at rest and with `--progressive` or `--replication-token`.

To size a server, `node scripts/loadtest.ts <file.fmp12> --users 50 [--workers 2]`
has simulated people browse, find and edit nonstop and reports response times.

## Provisioning accounts from an identity provider (SCIM)

An identity provider such as Okta or Microsoft Entra ID can add, deactivate
and remove a hosted file's people on its own, and move them between privilege
sets, over SCIM 2.0. Each file is provisioned separately.

1. In the admin console, open **Provisioning (SCIM)**, pick the file and
   choose what people get when no group covers them (no access, or a set).
2. Click **Turn on**. The console shows the base URL
   (`https://files.example.com/tabularius/scim/v2/databases/<file>`) and a token
   starting `ohsc_`. The token is shown once; only its hash is kept in the file.
3. In the provider's app for Tabularius, turn on provisioning: in Okta, SCIM 2.0
   with "HTTP Header" authentication; in Entra ID, "Tenant URL" and
   "Secret Token". Paste the two values there.

What the provider can do, and what it can't:

- **People** become external accounts named by their email address (the SCIM
  `userName`), the same accounts single sign-on matches them to. They have no
  password. Deactivating someone in the provider deactivates the account and
  signs it out; Tabularius also revokes that person's API tokens, including
  tokens delegated through a shared mapping. Reactivating the account does
  not restore those tokens. Their email domain or a group can't let them back
  in. Removing them leaves the account off and without a set; an
  admin can delete it. A person's email can't change over SCIM, since it names
  the account: the provider gets an error, and the person has to be removed and
  added again under the new address.
- **Groups** are the file's privilege sets. Push a group under the name of an
  existing set (the set must exist first; it can't be made, renamed or deleted
  from the provider). Adding someone to it gives them that set; an account has
  one set, so the group they were added to last wins. Taking them out gives
  them the set of another group they're still in, else the default from step 1. Unlinking or deleting the group in the
  provider takes the set away from the people it gave it to.
- It can't hand out **[Full Access]**, or any set with its powers, or take it
  away: an account an admin gave full access can't be taken over, deactivated,
  removed or moved by the provider. It never touches an account with a
  password, an AI agent, or an account from the `.fmp12`. Any other external
  account an admin already made for that exact email is taken over.

Every change is in the file's security log, made by "SCIM". **Turn off** stops
the token; the accounts it made stay. The requests the endpoint takes follow
the SCIM RFCs and the request shapes Okta and Entra document; neither provider
has been connected to it yet.

## The Admin APIs

Two APIs drive the server from scripts. Both sign in with the admin console
password.

Every route of both, with its parameters and an example, is in
[docs/reference/rest.md](docs/reference/rest.md).

**Tabularius's own**, under `/tabularius/admin/v1`, with HTTP Basic (any user
name) or, without a password set, from the server machine only:

Calls that need a database take `?database=` (or `?db=`); leaving it out, or naming one that isn't hosted, is a 400.

| Call | What it does |
| --- | --- |
| `GET /status` | Hosted files, sessions, who is editing or looking at which record, backups, conversions in progress |
| `GET /metrics` | Prometheus metrics |
| `GET /backups` | The backup settings and the sets there are (the same as `status.backups`) |
| `POST /backup` | Back up now: every hosted file (naming a `database` is a 400) |
| `POST /backup/stop` | Stop the backups running or waiting; each ends after the file it is copying, its half-made set is removed and no old set is pruned (the stopped `POST /backup` answers 409) |
| `POST /backups/{set}/verify` | Check a backup set |
| `POST /backups/{set}/test-restore` | Restore a set to a scratch folder, open each file and count its records |
| `POST /files/{name}/reconvert`, `/files/{name}/reconvert-preview` | Convert a file again from its `.fmp12`, or dry-run it |
| `POST /reconvert-all` | `{"preview": true}` dry-runs every outdated file; `{"files": [...]}` converts them |
| `POST /records/restore` | `{database, table, recordId, seq}`: put a record back as it was after an audit entry |
| `POST /restore` | `{database, at, mode: "copy" \| "replace", name}`: `copy` is the default and leaves the live file alone; `replace` has to be asked for; any other `mode` is a 400 |
| `POST /uploads`, `PUT /uploads/{id}?offset=N`, `POST /uploads/{id}/finish` | Upload and host a `.fmp12` in pieces |
| `GET/POST /schedules`, `/schedules/{id}`, `/schedules/{id}/run`, `/schedules/{id}/runs` | Script schedules and their last runs |
| `POST /message`, `POST /clients/{id}/message`, `POST /clients/{id}/disconnect` | Message or disconnect people |
| `GET/POST /webhooks`, `PATCH/DELETE /webhooks/{id}` | Webhooks for record changes (sent only with `--allow-webhooks`) |
| `GET /logs`, `/logs/{name}?type=&from=&to=&q=`, `/logs/{name}/download` | The server's logs. The Access log has a line for each failed sign-in, and one for a sign-in, on the Data API, OData, the XML interface, SQL over HTTP and the PostgreSQL protocol (a minute keeps 30 failures; a success is written once in 10 minutes for each account and way in) |
| `GET /profile`, `DELETE /profile` | Slowest scripts, and starting the count again |
| `GET /audit?database=D` | Who created, changed and deleted which records (`&table=`, `&account=`, `&recordId=`) |

```sh
curl -u admin:"$PASSWORD" -H 'x-tabularius-admin: 1' https://files.example.com/tabularius/admin/v1/status
```

A call with the console password (or the console's cookie) that carries no browser headers, which is what a script sends, needs `x-tabularius-admin: 1`; without it the server answers 403, because a page on another site could otherwise have a browser replay a saved login.

**FileMaker Server's Admin API (v2)**, at `/fmi/admin/api/v2`, for tools
written for FileMaker Server such as fmcsadmin or Claris Connect: sign in with
`POST /user/auth` (Basic, any user name) and send the token as `Bearer`. Files
(list, open, close, pause, resume), clients (list, message, disconnect), the
server's status, and FileMaker script and backup schedules work (`POST
/schedules/backup` with `backupType: {resourceType: "ALL_DB", backupTarget,
retainBackups}` backs up every hosted file into a new set under the target and
keeps the newest `retainBackups`; some-of-the-files, clone and verify options
answer code 21). A message schedule (`POST /schedules/message`, `messageType:
{resourceType: "ALL_CLIENTS", text}`) sends its text to every connected client
at its times. Verify and system-script schedules answer code 21 (not
supported). The console's own backup settings (`--backup-every`) still
apply alongside. **Block new users** (the Admin API's
`/server/config/blocknewusers`, or the button under Connected in the console)
refuses every new sign-in while sessions already open carry on, as before
maintenance; it is kept in the folder's `.openhbam-settings.json`. The same
page has the width below which the web client stacks a layout in one column
when the layout has no breakpoint of its own (640 points; 0 stacks only layouts
that ask to; `POST /tabularius/admin/v1/responsive`, kept as
`responsiveStackBelow` in the settings file). The other
`/server/config/...` settings fmcsadmin reads answer with values that describe
Tabularius, and changing them answers code 21; `/plugins` lists installed
plug-ins. `fmcsadmin certificate create "/CN=files.example.com"`, then
`certificate import` with the authority's certificate (and `--intermediateCA`),
installs a certificate from your own authority without touching files on the
server; it is checked against the key and the chain first. This works when the
folder's settings give the certificate (not with `--https` or `--tls-cert`).

[fmcsadmin and the Admin API](docs/fmcsadmin-parity.md) lists each fmcsadmin command and what it does here; [which Admin API calls Tabularius answers](docs/admin-api-coverage.md) lists Claris's calls by name against the routes here.

## Monitoring

A backup that would not fit in the free space of its folder (the files' size plus a tenth) is refused before anything is written, with how much it needs and how much is free, so it cannot fill the disk the files are on.

- `GET /tabularius/health` for load balancers and uptime checks.
- `GET /tabularius/admin/v1/metrics` for Prometheus: requests, sessions, locks,
  file sizes, free disk space (`tabularius_disk_free_bytes`, for the data and the
  backups), backups, schedules, the certificate's expiry, memory and CPU.
- `<folder>/Logs`, rotated at 40 MB (`serve --log-limit 100MB`, `TABULARIUS_LOG_LIMIT`, or `logLimit` in `.openhbam-settings.json`; at least 64 KB), also in the admin console's **Logs**. Lines that cannot be written (a full disk) are kept in memory, up to 8 MB per log, and tried again every few seconds.

[Monitoring](docs/monitoring.md) lists every metric, the health response,
Prometheus authentication and scrape configuration, and example alerting rules.

### Import local accounts from CSV

Manage Security → Accounts → **Import local accounts** uploads a UTF-8 CSV,
previews every desired-state row, then applies explicitly. The format is exactly
these three columns (any order), with explicit `true` or `false`:

```csv
account,privilegeSet,active
alice,Staff,true
bob,Read Only,false
```

Only local accounts, including imported FileMaker local accounts, are supported.
Missing rows have no effect. Imports create identities, update existing privilege
assignments, and deactivate/reactivate accounts; they never delete or rename them.
External mappings, agents, built-in bracketed names, unknown privilege sets,
Full Access grants, and changes to the importing account or its session mapping
are refused. Account names use SQLite's ASCII-only `NOCASE` comparison, resolve to
stored spelling, and refuse ambiguous case variants, including Unicode names
that JavaScript folds together differently. Names must be nonempty, at most 256
characters, without surrounding spaces, control characters or spreadsheet formula
prefixes (`=`, `+`, `-`, `@`). Commas and quotes can be quoted using normal CSV rules;
malformed quoting fails. Row numbers count CSV records, including the header.

**No credentials belong in the CSV.** New accounts have a null password hash and
must-change enabled; they cannot password-sign-in yet. Use the separate admin
console password-reset flow to set a temporary password with **must change** on,
and deliver it separately. Existing credentials and must-change flags stay intact.
Deactivation keeps the password, ends existing sessions and deletes the account's API tokens after commit.
Reactivation brings neither back: sign in again and create new tokens.

The REST endpoints are `POST /tabularius/security/v1/databases/{db}/accounts/import/preview`
with `{"csv":"…"}` and `/apply` with `{"csv":"…","previewToken":"…","idempotencyKey":"…"}`.
They require an active, unexpired interactive session bearer token for that file
with current Full Access and no owed password change. `ohbt_` API tokens are
refused. Preview returns decisions, before/after assignment and state, credential
setup guidance, and validation reason codes. Any validation error blocks apply.
A five-minute signed preview binds actor, file, parsed input and account/privilege
snapshot. Stale or changed state returns `409`: preview again. Apply recomputes
inside one `BEGIN IMMEDIATE` transaction with all changes, successful audit events,
batch summary and receipt. A failed mutation rolls everything back and logs only
a sanitized rejection reason separately.

Use a fresh idempotency key (1–128 ASCII letters, digits, `_` or `-`) for each new
operation and retain it for retries. Same actor/key/input returns the original
sanitized result, including after restart or preview expiry. Changed input under
the same key returns `409`. Reimporting unchanged desired state with a new key
creates no duplicate account-change events. The shared store safeguard for deletion,
demotion and deactivation requires an alternative active local non-agent Full Access
account with a working password credential or passkey. Imported verifiers that
cannot authenticate do not qualify. Its sign-in name must resolve unambiguously,
and any MFA required by the account or file must be enrolled (confirmed TOTP or
a registered passkey); a pending enrollment does not count. These checks also
cover administrators absent from the CSV. Inactive accounts, external mappings
and credential-free placeholders do not qualify as alternatives.

The JSON request body and CSV are each limited to 1 MiB, with 1,000 rows and
256 characters per account/privilege-set name (row validation rejects longer names;
body/row-count limits return `413`). SQLite counters
shared across server processes allow 20 previews and 5 applies per minute per
actor/file, plus 60 requests per minute per IP/file before authentication. Four
import requests may run concurrently per serving process. Throttling returns `429`
with `Retry-After: 60`. Preview does not write accounts or audit events; HTTP rate
counters are updated. See the [REST reference](docs/reference/rest.md) for examples.
