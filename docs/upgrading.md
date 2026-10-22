# Upgrading, rolling back, and what is promised

This page is what you can count on when you change the tabularius version that serves your files, and what to do when you
want the old version back. The rehearsal that backs it is `npm run rehearse-upgrade` (below).

## What a hosted file records

Every hosted file (`<name>.openhbam.sqlite`) records the **file format** it is in, a whole number. This version writes
and reads format **1**; the number is kept in `docs/upgrading.md` and in `packages/store/src/store-format.ts`, and a test
fails if they disagree.

- A version opens a file in **its own format or an older one**, and brings an older file up to date in place when it opens
  it. Your records, accounts, privilege sets, value lists, scripts, backups, schedules and settings carry over.
- A version **refuses a file in a newer format** than it reads, and leaves it exactly as it was (no byte is written).
  The message names the file, the two numbers and the way out:
  `Shop was written by a newer Tabularius (file format 2; this version reads up to format 1), so it is not opened. Update tabularius to open it, or put back a backup made before the newer version first opened it`
  The server skips that one file, still serves the others, and lists it as closed in the admin console with that text.
  `tabularius doctor <folder>` names it too.
- The format number goes up only for a change an older version could not read or would damage (a column that changes
  meaning, a table an older version would write into wrongly). Adding a table, a column or a setting does not raise it:
  an older version that does not know the addition leaves it alone.

Current store format: **1**

Versions older than the one that introduced this number (the change that added `packages/store/src/store-format.ts`) do not check it. They open a file
a newer version wrote, whatever its format. Until the first public release the rule is therefore: go back by restoring
the backup the upgrade took, not by pointing an old version at files a newer one has opened.

## Upgrading

`tabularius upgrade` fetches the new version, **backs up the hosted folder**, restarts the service, waits for it to answer,
and puts the old version back if it does not start (ADMIN.md, "Upgrade"). Two things to know:

- When a service is installed (`tabularius service install`), the upgrade is **refused before anything restarts** if the
  version it would put in place reads an older file format than a file in the folder is in. This is what stops
  `tabularius upgrade --from <an older copy>` from taking a folder out of service: the old install stays, the service is
  not restarted, and the message names the files. With no service installed there is no folder to look in, so run
  `tabularius doctor <folder>` first.
- A service installed with `--host 0.0.0.0` and no HTTPS (what earlier builds installed by default) is **refused the same way**: the new version would not start it. The message says to install the service again with `--https local` (or a domain), or `--allow-plain-http` after `--` if a proxy you control does the HTTPS.
- **Browser-facing requests are checked against the server's own address.** A cookie or cached Basic credential is now accepted only on a same-origin request. Two things can change for existing setups: a script that calls the admin console API with a console cookie or Basic credentials must send the header `x-tabularius-admin: 1` (without it the request is refused with 403); and a server reached by a DNS name needs `--public-url https://that-name` (or `--https` for the name) before anything that carries a cookie or Basic credentials can use it by that name, browsers and scripts alike, because such a request for a name the server was not told is refused with 403 (the message names the setting, and the server logs each refused name once). Connecting by IP address or `localhost` needs no setting.
- The health check says the server is up, not that every file is open. After an upgrade, open the admin console's file
  list or run `tabularius doctor <folder>`: a file that failed to open is listed with the reason.

### Files the server writes are private to its account

Files the server writes or appends (the server logs, exported record files, encrypted files and backup copies, upload
spool files and service-install staging files) are now created and kept with mode `0600`: readable and writable by the account
the server runs as, and by no one else. Earlier versions left the mode to the umask, so a log could be group- or
world-readable.

- **Who is affected:** anything that reads those files as another user, such as a log shipper, a monitoring agent or a
  web server that serves exported files. After the upgrade it gets "permission denied".
- **What to do:** run the reader as the server's account, or give it access on purpose with the file system rather than
  with the mode: put the reader in a group and set an ACL on the log folder (for example
  `setfacl -m u:shipper:r <folder>/Logs/*`, and a default ACL `setfacl -d -m u:shipper:r <folder>/Logs` for new
  files), or copy the files out with a job that runs as the server's account. Changing a file's mode by hand does not
  last: the next write sets it back to `0600`.
- **A symbolic link or hard link in place of one of these files is refused.** A log (or another file in the list above)
  that is a symlink, or has more than one hard link, is no longer appended to or rotated through: the write fails with
  a refusal naming the path instead of following the link. If you pointed a log at another place with a symlink, point
  the log folder there instead (a symlinked folder is fine; a symlinked file is not), and remove extra hard links.
- A plug-in install that is interrupted can leave a staging folder named `.installing-<plug-in id>-<random>` in the
  plug-ins folder. It is not swept automatically; remove it by hand once no install is running.

## Stopping and restarting

A stop signal (Ctrl+C, `SIGTERM` from a service manager, `tabularius service stop`, an upgrade) ends the server in this order:

1. The server stops accepting connections. A request that arrives on a connection that was already open is answered `503` with `Retry-After`, and the health check (`/tabularius/health`) leaves with it, so a load balancer takes the server out.
2. Open live-update streams are sent an `event: shutdown` (`{"reason":"restart"}`) and closed. The web client reconnects by itself, with a growing pause, and refreshes when the server is back.
3. Requests that are running (a long find, a script, a container upload piece) get `TABULARIUS_DRAIN_SECONDS` (20 by default) to finish. A connection that goes idle meanwhile is closed rather than kept for the next request. Anything still busy after that is closed and written to the event log as a warning. A request that is cut may still finish the step it was in; a script's transaction that has not committed is not kept. The wait is for a single-process server; with `--workers` the front process closes its connections at once.
4. The backup that is running is stopped, the last changes are copied (progressive backups, off-site), every file is saved and closed, and the process exits with code 0.

A **second** signal while this is going on stops the process at once with exit code 1 and the message "stopping now without closing the files". SQLite recovers the files from their logs when the server starts again, so committed changes are kept. With encryption at rest the plain working copies stay on disk until the next clean stop, so avoid it there. The launchd definition waits 30 seconds (`ExitTimeOut`) and the systemd unit 60 (`TimeoutStopSec`), and `tabularius service stop` waits `TABULARIUS_STOP_GRACE_MS` (30 seconds): keep `TABULARIUS_DRAIN_SECONDS` under the one that applies, with room to save the files. `docker stop` waits 10 seconds unless the container is started with `--stop-timeout` (or `stop_grace_period` in Compose), so raise that to match when you raise the drain. On Windows, `tabularius service stop` ends the process outright and does not wait for the drain.

What a restart does not keep: Data API and web client sessions (people sign in again; API tokens last), and scripts that were running. While a single process starts nothing listens on the port, so a proxy in front sees a refused connection until the files are open; with `--workers` the front process answers `503` with `Retry-After` while a worker starts.

## Rolling back

1. Stop the server (Ctrl+C, or stop the service with your service manager).
2. Put the old version back: `tabularius upgrade --from <a copy of the old version>`, or check it out in the install's folder.
3. If the new version reads the same file format as the old one (the release notes say when the number goes up), the old
   version opens the files as they are. If the new version has a higher number, it recorded that number in each file the
   first time it opened it, so the old version refuses them (above): restore the backup taken before the upgrade,
   `tabularius restore <folder> <backup-set>`. Whatever was written after that backup is not in it.

`tabularius restore` over the folder keeps each account's current password, token, two-factor and passkey state, so a
restore cannot bring back a credential you had revoked. Restored into an **empty** folder (a lost server) it leaves
every account without a password until `tabularius passwd` sets one (ADMIN.md, "Backups and restore").

## The rehearsal

`npm run rehearse-upgrade` (Linux, full git history, a few minutes; not part of the test run) checks out five builds from
this project's own history (the oldest, three spread through it, and main when the rehearsal was written) and, for each:

| Direction | What is done | What must hold |
|---|---|---|
| Forward | The old build makes a folder: two files with tables, 80 records, a container, two accounts and a privilege set, a value list, a script, an API token, a backup, a schedule and settings. This build opens it. | Every table, field, record (id, modification id and values), account and privilege set, value list, script and container reads the same; SQLite's integrity check is clean; the schedule is read and runs; `tabularius doctor` reads the pages cleanly. |
| Forward | The old build's backup is restored with this build, over the folder (after this build changed it) and into an empty folder. | The data is identical; over the folder the passwords are kept; in an empty folder they are not (documented). |
| Backward | This build makes a folder. The old build opens it, adds a record, edits it and adds a field. This build reads it again. | Nothing this build wrote is changed or lost; the integrity check is clean. Old builds do not refuse (they predate the format number); the table says what they did. |
| Future | A build whose format number is one higher opens a format-1 folder, then this build opens the result. | This build refuses both files and does not change a byte of them. |

Run it before a release that raises the format number, and after any change to how a file is read or upgraded
(`packages/store/src/store.ts` opening path, `packages/server/src/backup.ts`).

Result on 2026-10-17: all five old builds' folders open with identical data, restore identically, and run their
schedule; the old builds open this build's files without damage (they have no refusal to give); the future build's files
are refused without being touched. `--report <file.md>` writes the full table. The script exits with an error when this
build reads an old build's folder differently or cannot read part of it, when an old build's write is not read back, when
a restore or the integrity check differs, or when the future build's files are not refused untouched.

What it does not cover, because it cannot be checked from here: macOS and Windows services, the program swap itself
(`packages/cli/test/service-upgrade.test.ts` covers it, including crashes in the middle), a cluster with two versions
running at once, plug-ins built for another version, and Encryption at Rest files. Nothing here says what
FileMaker Server does.

## Known limits

These are true today and are not papered over:

- **The format is checked when a file is opened, and again every few seconds while it is open.** A process that already
  has the file open (a second server on one folder during a rolling upgrade) can write for those few seconds after a
  newer version has recorded its number; then it takes the file offline, as it does a damaged one, and logs why. Do not
  run two versions of the server on one folder if you can avoid it.
- **A newer version records its number as soon as it opens a file, and a server opens every file when it starts.** If an
  upgrade to a higher format misses the health check (a slow start on a large folder), the automatic put-back installs
  the old version, which then refuses every file. The upgrade's error names the files and gives the exact
  `tabularius restore` command for the backup it took just before (the restore itself is yours to run, since it
  replaces whatever was written since).
- **`tabularius restore` across file formats.** The current credentials are copied into the restored file by column name.
  When the two files are in different formats, a column only the current file has is added to the restored table so its
  values are carried; a column only the backup has makes the restore stop (what it means is not known), and so does a backup
  in a format newer than the build running (it would be left closed). While the format is 1 neither case can arise.

## For contributors: changing the format number

Raise `STORE_FORMAT` in `packages/store/src/store-format.ts` only when an older version cannot read the change or would
damage it. In the same change: update "Current store format" above, run `npm run store:snapshot` so later versions are
tested against a file in the new format, and run `npm run rehearse-upgrade`. The tests in
`packages/store/test/store-format.test.ts` and `packages/server/test/newer-store.test.ts` hold the rules.

## If you used it as openhbam

Tabularius was called openhbam until October 2026. A setup made under the old name keeps running after an upgrade, with
nothing to change:

- **The command.** `openhbam` is the same program as `tabularius`; on a terminal it says once that the name is old.
- **Settings.** An `OPENHBAM_*` variable counts when the matching `TABULARIUS_*` one is not set (`OPENHBAM_PASSWORD` is
  read as `TABULARIUS_PASSWORD`). The same goes for the variables the installers read.
- **Addresses and headers.** `/openhbam/...` paths are answered as `/tabularius/...`, `x-openhbam-*` request headers are
  read as `x-tabularius-*`, and an `openhbam_admin` cookie still counts as a console sign-in. A webhook call carries both
  the `x-tabularius-signature` and the `x-openhbam-signature` header.
- **Pages and plug-ins.** `window.openhbam` in a layout's page, and `openhbam.files`, `openhbam.http`, `openhbam.mail`
  and `openhbam.secrets` in a JavaScript plug-in, are the same objects as `tabularius`.
- **Files and folders.** Hosted files (`<name>.openhbam.sqlite`), the settings files in the hosted folder
  (`.openhbam-*`), `~/.openhbam`, the service definition (`openhbam.service`, `org.openhbam.server`, the `openhbam`
  scheduled task) and the offline copies in a browser keep their names, so nothing is moved or re-made.

Three things are new names, not kept: the Prometheus metrics start `tabularius_` (`tabularius_up`, not `openhbam_up`;
update dashboards and alert rules), responses carry `X-Tabularius-*` headers, and the Docker Compose service and the
image tag in the examples are `tabularius`.

A standby and its primary should be upgraded together, the primary first: a standby on the new name asks for
`/tabularius/replication/...`, which a primary still on the old name does not answer (the standby says so, and names the
order). A primary on the new name still answers a standby on the old one, so the standby keeps following until it is
upgraded. See [standby servers](standby-guarantees.md).
