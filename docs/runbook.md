# Runbook: when something goes wrong

Fifteen things that go wrong with a hosted folder, each written the same way: what you see, why, what to do, how to check it worked, and what is lost. Every `tabularius` command and every admin call on this page is run by `packages/cli/test/runbook.test.ts`, against a throwaway folder (and a real server where the problem needs one); the messages quoted are the program's own words. [Troubleshooting](troubleshooting.md) is the other way in: look up the exact message there.

Run the commands on the computer that hosts the folder, as the user the server runs as. `<folder>` is the folder you gave `tabularius serve`, `<database>` a hosted file's name without its ending. From a checkout `tabularius` is `npm run tabularius --`; in Docker it is `docker compose exec tabularius tabularius` (the [README](../README.md) has the Docker steps) with `/data` as the folder.

The admin calls are shown as `curl` so they can be pasted into a script; each one is a button in the admin console too, named in the text. They need the admin console password (`<console-password>`) and the header shown, which a web page on another site cannot send.

## Find your problem

| You see | Go to |
| --- | --- |
| The admin console says `Wrong admin password` and nobody remembers it | [Forgot the admin console password](#forgot-the-admin-console-password) |
| `Too many failed attempts. Try again in 900 seconds.` at the admin console | [Locked out of the admin console](#locked-out-of-the-admin-console) |
| `Invalid user account and/or password; please try again` | [Forgot the password of a file's account](#forgot-the-password-of-a-files-account) |
| `Too many failed sign-ins; try again after` a time | [An account is locked out](#an-account-is-locked-out) |
| Someone must lose access this minute | [Someone's access must end now](#someones-access-must-end-now) |
| A server-side script has been running for too long | [A script is running away](#a-script-is-running-away) |
| `port 8080 is in use: another program is already listening on` | [The port is already in use](#the-port-is-already-in-use) |
| Connections are refused or reset while the server is busy | [Too many open files](#too-many-open-files) |
| A `.fmp12` is in the folder but never appears in the list | [A file never finishes converting](#a-file-never-finishes-converting) |
| `is damaged` and `is not being served`, or `file is not a database` | [A hosted file is damaged](#a-hosted-file-is-damaged) |
| `backup failed: not enough free disk space for a backup` | [The backup could not be made: the disk is full](#the-backup-could-not-be-made-the-disk-is-full) |
| `backup.json has no signature` or `does not match its signature` when restoring | [A restore refuses a backup set as unsigned or altered](#a-restore-refuses-a-backup-set-as-unsigned-or-altered) |
| Browsers warn about the certificate | [The certificate expired, or is for the wrong name](#the-certificate-expired-or-is-for-the-wrong-name) |
| Sign-ins end early, or a certificate is "not valid yet", or backups are dated in the future | [The computer's clock was wrong](#the-computers-clock-was-wrong) |
| The folder moved and the service or backups cannot find it | [The folder was moved](#the-folder-was-moved) |
| The computer, its disk or the whole machine is gone | [The server is lost](#the-server-is-lost) |

## Before it goes wrong

Three things make every section below shorter.

- **Backups exist and are somewhere else too.** `tabularius serve` backs up every day to `<folder>/Backups`; a backup on the same disk does not survive losing the disk. Copy `Backups` off the machine (or serve with `--backup-s3`, see the [S3 tutorial](tutorials/connect-an-s3-bucket.md)).
- **A backup is checked, not trusted.** `tabularius verify-backup <folder>` reads every set back and compares its checksum. The server does this after each scheduled backup and tests a restore once a day; the [backup tutorial](tutorials/backup-and-restore.md) walks through it.
- **You know what a backup does not hold.** A set holds each hosted file (its design, records and accounts) and the container files kept outside it. It does not hold the folder's `.openhbam-*` files (the admin console password, settings, schedules, connections, API tokens for AI apps), `Documents/`, `Logs/` or certificate files. Copy those with the folder if you want them back.

## Forgot the admin console password

**You see:** the sign-in page of the admin console says `Wrong admin password`.

**Why:** the console password is kept in the folder's `.openhbam-admin` file, hashed, so it cannot be read back. Anyone who can run commands as the server's user on the machine can set a new one; that is the whole protection.

**Do:** on the machine that hosts the folder. The server can keep running.

<!-- docs-example: illustrative -->
```sh
tabularius admin-password <folder>
```

It asks twice, hidden. Without a terminal, give it the password in `TABULARIUS_PASSWORD` or on standard input.

**Check:** the new password signs in to the console at once and the old one is refused. A console tab that was signed in with the old one is signed out.

**Lost:** nothing else.

## Locked out of the admin console

**You see:** `Too many failed attempts. Try again in 900 seconds.` (the number counts down).

**Why:** five wrong console passwords from one address lock that address out for 15 minutes, so the password cannot be guessed at speed. The lock holds even for the right password, and `tabularius admin-password` does not lift it: it sets the password, but the console keeps refusing this address until the lock ends. Other addresses are not affected.

**Do:** wait the seconds shown, or sign in from another address (the lock is per address), or restart the server: the lock is kept in the server's memory, so a restart clears it (stop it with Ctrl-C and run `tabularius serve <folder>` again, or restart the service).

**Check:** the console signs in.

**Lost:** a restart ends every session: people signed in through the Data API or the web client must sign in again, and a script holding a token must sign in again.

## Forgot the password of a file's account

**You see:** the Data API answers error 212, `Invalid user account and/or password; please try again`; the web client says the same.

**Why:** an account's password is kept hashed in the file; no one can read it back.

**Do:** set a new one. From the command line, with the server running or not:

<!-- docs-example: illustrative -->
```sh
tabularius passwd <folder> <database> <account>
```

Or in the admin console: **Security health**, **Account access**, **Set password**. A running server ends the account's open sessions at their next call either way (an API token made for a script, `ohbt_...`, stays valid). The console also lifts a lockout on the account; the command line cannot reach the running server's lockouts, so it prints a note saying so when the server is running.

**Check:** the account signs in with the new password and the old one gets 212.

**Lost:** the account's open sessions, which end at their next call (the person signs in again with the new password). API tokens made for scripts stay valid; see [Someone's access must end now](#someones-access-must-end-now) if they must go too.

## An account is locked out

**You see:** the Data API answers 401 with error 212 and `Too many failed sign-ins; try again after` a time in UTC, and a `Retry-After` header with the seconds left. The right password is refused too.

**Why:** five wrong passwords for one account lock that account for 15 minutes, and 30 failures from one address across accounts lock that address; both exist so a password cannot be guessed at speed.

**Do:** wait, or lift it now. In the admin console: **Security health**, **Account access**, **Unlock** (type the account). The same call from a script:

```sh
curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -H "content-type: application/json" -X POST http://localhost:8080/tabularius/admin/v1/accounts/unlock -d '{"database":"<database>","account":"<account>"}'
```

For a blocked address, give `"address":"<address>"` in place of the account. Setting the account a new password also lifts its lock. Restarting the server clears every lock too.

**Check:** the answer is `{"ok":true,"cleared":true}` and the right password signs in. `"cleared":false` means there was no lock to lift.

**Lost:** nothing.

## Someone's access must end now

A lost laptop, a person who has left. Three things keep an account working, and each needs its own step: its **password**, its **sessions** (tokens already handed out by signing in) and its **API tokens** (standing keys for scripts and AI apps). Setting a password ends the account's sessions but not its API tokens made for scripts (`ohbt_...`), and ending sessions does not stop the account signing in again.

**Do, in this order:**

1. Turn the account off, if it is not the last account with Full Access. This ends its sessions and its API tokens in one step and refuses new sign-ins:

```sh
curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -H "content-type: application/json" -X POST http://localhost:8080/tabularius/admin/v1/health/fix-account -d '{"database":"<database>","account":"<account>","action":"deactivate"}'
```

2. If the account must stay (a shared account), set it a new password instead (**Security health**, **Account access**, **Set password**), which ends its sessions, then revoke its tokens. **Security health** lists them under **Active sessions and tokens**: **Sign out** for a session, **Revoke** for a token, or the account's name after **End every session for**. From a script:

```sh
curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" "http://localhost:8080/tabularius/admin/v1/sessions?database=<database>"
curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -H "content-type: application/json" -X POST http://localhost:8080/tabularius/admin/v1/sessions/end -d '{"database":"<database>","account":"<account>"}'
curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -H "content-type: application/json" -X POST http://localhost:8080/tabularius/admin/v1/health/revoke-token -d '{"database":"<database>","id":"<token-id>"}'
```

**Check:** a token the person held answers error 952, `Invalid FileMaker Data API token (*)`, on its next call, and a standing token is refused.

**Lost:** the person's open sessions are cut off at once, whatever they were in the middle of.

## A script is running away

**You see:** a server-side script (Perform Script on Server, a schedule, an automation or an inbound hook) is still running long after it should have ended. **Running on the server** in the admin console lists what is running and waiting.

**Why:** a script loops, or waits for something that never comes.

**Do:** **Cancel** it there, or from a script:

```sh
curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" "http://localhost:8080/tabularius/admin/v1/server-scripts"
curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -X POST http://localhost:8080/tabularius/admin/v1/server-scripts/<script-id>/cancel
```

**Check:** the answer is `{"canceled":true}` and the script moves from the running list to the recent runs, as canceled. A waiting script never starts; a running one stops at its next script step, keeping what it already saved. A script that is inside one long step (a very large Execute SQL, say) stops when that step ends. The one asking, if it was Perform Script on Server, gets error 1, `User canceled action`.

**Lost:** whatever the script had not yet done. A script started by a person in the web client or the Data API is not in this list: it runs inside that request, which the server stops after a minute (`TABULARIUS_REQUEST_BUDGET_MS`, see [troubleshooting](troubleshooting.md)), or end that person's session as above. <!-- known-difference-ok: "not yet done" is about what a stopped script had left to do, not about FileMaker behaviour -->

## The port is already in use

**You see:** `tabularius serve` stops with `error: port 8080 is in use: another program is already listening on 127.0.0.1:8080.` and the command that names the program.

**Why:** another program, often an earlier `tabularius serve` that is still running, holds the port.

**Do:** find out what holds it, stop that, or serve on another port:

<!-- docs-example: illustrative -->
```sh
tabularius doctor <folder> --port 8080
tabularius serve <folder> --port 8081
```

`doctor` says `port 8080 is in use` and names the next port to try. `lsof -nP -iTCP:8080 -sTCP:LISTEN` (macOS, Linux) names the program. For a service, `tabularius service install` names a free port when yours is taken.

**Check:** `serve` prints the addresses it listens on. Tell people the new port.

**Lost:** nothing.

## Too many open files

**You see:** while many people are connected, new connections are refused or reset (`fetch failed` from a script, "can't reach this site" in a browser). The log may show a line with `EMFILE: too many open files`, for instance `could not check Contacts for damage: EMFILE: too many open files, open ...`. When the connections close, the server answers again without a restart.

**Why:** each connection and each open file uses one of the process's allowed file handles, and the operating system's allowance is low on some systems (256 by default on macOS). The server does not raise it. Node reports the limit as `EMFILE: too many open files` to the call that hit it.

**Do:** see the limit the server runs under, count what it has open, and raise the limit where the server is started:

```sh
ulimit -n
lsof -p <process-id> | wc -l
```

In a systemd unit that is `LimitNOFILE=65536`; in a launchd job a `SoftResourceLimits` and `HardResourceLimits` of `NumberOfFiles`; in Docker Compose `ulimits: nofile: 65536`; in a terminal `ulimit -n 65536` before `tabularius serve <folder>`. (The test starts the server under a limit of 48, holds 120 connections open, and watches new connections fail and then succeed again once they close. The unit, job and Compose settings are standard operating system settings and have not been run here.)

**Check:** `lsof` shows the count well under the limit, and the refusals stop.

**Lost:** nothing. A request that was refused was never run, and a file the server could not check was not changed.

## A file never finishes converting

**You see:** a `.fmp12` is in the folder, the log says `converting Charts.fmp12` and never `converted Charts.fmp12`, and the file does not appear among the hosted files.

**Why:** a big file takes minutes, and **Hosted files** in the admin console shows a progress bar (`Converting 43%: N of M tables`). A conversion that never moves was cut off: the server stopped, was killed or lost power while converting.

**Do:** look at the folder, then start the server again. The `.fmp12` is never changed and the converted file is only published once it is whole, so there is nothing to clean up: the log says `converting Charts.fmp12` again and then the line below. If it stops each time with `couldn't convert`, the reason follows that message (see [troubleshooting](troubleshooting.md)).

<!-- docs-example: illustrative -->
```sh
tabularius doctor <folder>
tabularius serve <folder>
```

**Check:** the log says `converted Charts.fmp12: N tables, N records; now hosting Charts` and the file opens.

**Lost:** nothing.

## A hosted file is damaged

**You see:** at start the log says `can't open Contacts.openhbam.sqlite, so it is not hosted: Contacts is damaged (file is not a database) and is not being served.` (the part in brackets says what was found; a file damaged while the server runs gets `is damaged (...) and is no longer served`). Sign-ins to that file fail and the admin console lists it as closed with the reason. Every other file keeps working. `tabularius doctor <folder>` names it: `PROBLEM Damaged file`.

**Why:** a failing disk, a copy cut short, a sync tool, an interrupted restore. Nothing more is written to it.

**Do:** stop the server. Keep the damaged file where it is until the restored one is checked (copy it, with its `-wal` and `-shm` files if it has any, if you may want to try to read what is left). First see what is wrong, and pick the newest backup set that passes its check:

<!-- docs-example: illustrative -->
```sh
tabularius doctor <folder>
tabularius verify-backup <folder>
```

To look at the backup before it replaces anything, restore it into a scratch folder and read it:

<!-- docs-example: illustrative -->
```sh
tabularius restore <scratch-folder> <folder>/Backups/<backup-set> <database>
tabularius records <scratch-folder> <database> <table>
```

Then put it back in the real folder and check:

<!-- docs-example: illustrative -->
```sh
tabularius restore <folder> <backup-set> <database>
tabularius doctor <folder>
```

A restore replaces only that file, and it works even when the damaged file cannot be opened at all. When the file it replaces can still be read, the restore first compares its accounts with the backup's. If any differ (an account added since the backup, one removed since, one switched on or off since, or one with another privilege set), it lists them, restores nothing and exits with an error. Read the list, then run the same command with `--accept-account-changes` to restore anyway; the list is printed again afterwards.

<!-- docs-example: illustrative -->
```sh
tabularius restore <folder> <backup-set> <database> --accept-account-changes
```

If the damaged file was too broken to read, its accounts have no password now (see **Lost**); list them and give each one:

<!-- docs-example: illustrative -->
```sh
tabularius privileges <folder> <database>
tabularius passwd <folder> <database> <account>
```

Start the server again; the file is served on the next start, or from the admin console's Start.

**Check:** `doctor` shows `Pages: ... files read cleanly` and no `PROBLEM`, and `tabularius records` or the web client shows the records.

**Lost:** every change since the backup. Account sign-in state too: a restore normally keeps the sign-in state of the file it replaces (passwords, tokens, two-factor codes, passkeys), so that a password changed since the backup does not come back; a second-factor or local-only requirement added since stays required. Whether an account is switched off comes back as it was in the backup, so an account you turned off since is on again; the restore lists every such account and stops until you add `--accept-account-changes`. A file too broken to read that from (or an empty one) carries nothing over: every account in it has its password switched off until you set one with `tabularius passwd` (`tabularius privileges <folder> <database>` lists the accounts, each marked `no password yet`), and its tokens, passkeys and codes are gone. `tabularius restore` prints a note naming the accounts left that way.

## The backup could not be made: the disk is full

**You see:** in the log, `backup failed:`, and in the admin console's **Backups**, `Last scheduled backup ...: failed,`, followed by `not enough free disk space for a backup in <folder>/Backups: it needs about 190 KB free, 20 KB available`. `tabularius backup` prints `error:` and the same words.

**Why:** a backup that cannot fit would fill the disk the live files are on, so it is refused before anything is written. Nothing partial is left, and the older sets are kept.

**Do:** free space, or back up to another disk, then check:

<!-- docs-example: illustrative -->
```sh
tabularius backup <folder> --to <other-disk-folder>
tabularius verify-backup <folder> --from <other-disk-folder>
```

`tabularius doctor <folder>` budgets for the files, a full write-ahead log and one more backup run. If the live files themselves fill the disk, they say `could not be written: the disk is full` ([troubleshooting](troubleshooting.md)): free space first.

**Check:** `backed up N files to` a new set, and `checked: N file ok` from `verify-backup`.

**Lost:** the backups that were skipped. The files themselves are not touched by a refused backup.

## A restore refuses a backup set as unsigned or altered

**You see:** `restore` stops before anything is put back, with `backup.json has no signature, so nothing says the checksums in it are the ones this backup was made with`, or `backup.json does not match its signature: wrong passphrase (not the one the set was made with), or backup.json was edited, or it is not from this set`. `verify-backup` says the same, or ends with `it has no signature`.

**Why:** an encrypted set (a backup made with `TABULARIUS_BACKUP_KEY`) has its list of checksums signed with the passphrase, so a copy cannot be swapped for another or an older one without the passphrase. A set made before signatures existed has no signature, and neither has one whose signature was removed. A signature that does not match is a different passphrase, an edited `backup.json`, or a manifest from another set; the message cannot tell these apart.

**Do:** first try the passphrase the set was made with. While `TABULARIUS_BACKUP_KEY` is set, a set restores only if it is signed. A set from before signatures existed, or from before the passphrase was set, has no signature. If you made it and it has not been out of your hands, let `verify-backup` read every copy back and sign it, after which it restores like any other:

<!-- docs-example: illustrative -->
```sh
tabularius verify-backup <folder> <backup-set> --sign
tabularius restore <folder> <backup-set>
```

Signing is refused for a set that fails its check, and for several sets at once. It cannot tell whether the copies were swapped before it ran, so it is not a way to make a set you cannot account for trustworthy. To restore a set without signing it, add `--accept-unsigned-backup` to `restore`; that says you trust where the set has been. If you cannot account for the set, use an earlier one.

**Check:** `restored` lines from `restore`. A restore also prints `note: <file> had changes after this backup was taken` when the live file was written after the backup, since those changes are not in the restored file.

**Lost:** nothing, if the restore was refused. Nothing was replaced.

## The certificate expired, or is for the wrong name

**You see:** browsers warn that the connection is not private. `tabularius doctor <folder>` says `PROBLEM Certificate: expired 3 days ago`; asked about the address people use, it says `answers, but a browser would refuse it`.

**Why:** the certificate files in the folder's settings ran out, or were made for another name than the one people type (the address `doctor` is given). With `--https <name>` the server gets and renews its own from Let's Encrypt, which needs the name to point at the machine and port 80 to reach it.

**Do:** with your own files, put the new certificate and key where `tlsCert` and `tlsKey` in `.openhbam-settings.json` (or `--tls-cert` and `--tls-key`) name them, and restart the server: it reads them when it starts. Then check the files, and ask the address people use:

<!-- docs-example: illustrative -->
```sh
tabularius doctor <folder>
tabularius doctor <folder> --url https://<name>
```

The answer for a certificate made for other names is `PROBLEM Address: ... its certificate is for other names`; for one from an authority this computer does not trust it is `check Address: ... was not made by an authority this computer trusts` (with `--https local` each device trusts the server's own authority once, from `/tabularius/tls/`).

**Check:** `doctor` says `Certificate: valid until` the new date and `Address: ... answers`.

**Lost:** nothing. The server was running throughout; only browsers objected.

## The computer's clock was wrong

**You see:** people are signed out early, or a certificate is "not valid yet", or `tabularius doctor <folder>` says the newest backup `was made 5 days from now by this computer's clock`.

**Why:** sessions, tokens and certificates are dated, so a clock that jumps forward ends them early, and one set back cannot make them last longer. [Clock audit](clock-audit.md) says what each does; the server keeps its own elapsed-time count since it started so a backward jump gives nothing away. A backup is named by the date and time it was made.

**Do:** set the clock right (`timedatectl set-ntp true` on Linux, **Date & Time** on macOS and Windows), then take a backup so there is a good one with the right date, and look at the folder:

<!-- docs-example: illustrative -->
```sh
tabularius backup <folder>
tabularius doctor <folder>
```

A backup made while the clock was set back is named just after the newest set, so the order stays right; one made while it was ahead keeps its wrong name, and every later set is named after it until you remove it (`<folder>/Backups/<set>`) once a newer good one has been checked.

**Check:** `doctor` no longer reports a backup from the future, and people can sign in and stay signed in. A sign-in cut short by a forward jump is accepted again once the clock is corrected, as long as it still exists ([clock audit](clock-audit.md) has the rules).

**Lost:** nothing is changed in the files.

## The folder was moved

**You see:** after moving or renaming the folder, `tabularius doctor <folder>` says `no backup folder yet` with the old path, and an installed service says `installed for <old folder> but nothing answers`.

**Why:** two things hold the folder's old location as a full path: a service (its launchd, systemd or Task Scheduler definition) and any setting in `.openhbam-settings.json` that names a path (`backupDir`, `tlsCert`, `tlsKey`). The files, accounts and records are inside the folder and move with it.

**Do:** stop the server (or the service). Move the folder, then fix what names the old place:

<!-- docs-example: illustrative -->
```sh
tabularius service uninstall
tabularius service install <new-folder>
tabularius doctor <new-folder>
```

Edit `.openhbam-settings.json` in the moved folder for any path it names. For a server you start by hand, just `tabularius serve <new-folder>`. Do not copy a folder while the server is running (the write-ahead log may not come with it); stop it first or restore from a backup.

**Check:** `doctor` shows no `PROBLEM`, and the service's definition names the new folder:

<!-- docs-example: illustrative -->
```sh
tabularius service print <new-folder>
```

**Lost:** nothing, if the server was stopped first.

## The server is lost

**You see:** the machine, its disk or its folder is gone. You have backups somewhere else.

**Why / what you have:** a backup set holds each hosted file's design, records and accounts. It does not hold what [the section above](#before-it-goes-wrong) lists, and it cannot carry sign-in state to a machine that has no file to take it from: every restored account is listed as `no password yet` until you set one.

**Do:** on the new machine, install Tabularius (the [README](../README.md) has the steps) and make the folder.

1. Copy the `Backups` folder from off the lost machine to the new one, say into `<backups-folder>`. From S3, `tabularius restore <folder> <backup-set> --from s3://bucket/prefix` brings the sets down first (not run against a real bucket here; the [S3 tutorial](tutorials/connect-an-s3-bucket.md) runs against a stand-in).
2. Check the set you will use, and see its name:

<!-- docs-example: illustrative -->
```sh
tabularius verify-backup <folder> --from <backups-folder>
```

3. Restore the files:

<!-- docs-example: illustrative -->
```sh
tabularius restore <folder> <backup-set> --from <backups-folder>
```

4. Set the console password, and a password for every account (`tabularius privileges <folder> <database>` lists them):

<!-- docs-example: illustrative -->
```sh
tabularius privileges <folder> <database>
tabularius admin-password <folder>
tabularius passwd <folder> <database> <account>
```

5. Start the server, and tell people the address if it changed:

<!-- docs-example: illustrative -->
```sh
tabularius serve <folder>
```

**Check:** the records are there, and the accounts you gave a password sign in:

<!-- docs-example: illustrative -->
```sh
tabularius records <folder> <database> <table>
```

**Lost:** every change since the last backup that reached you; every account's password, API tokens, two-factor codes and passkeys (people add those again); and what a backup does not hold: the admin console password (set above), settings, schedules, connections, plug-ins, `Documents/`, logs and certificate files. If the old folder's `.openhbam-*` files survive anywhere, copy them into the new folder before step 5.
