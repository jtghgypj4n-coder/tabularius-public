# Standby servers: what is promised

A standby (`tabularius standby <folder> --primary URL --token T`) keeps a copy of every hosted file of a primary
(`tabularius serve <folder> --replication-token T`), about a second behind it, so a second machine can take over. It is
Tabularius's own feature. Nothing on this page is a claim about FileMaker Server, which this page does not compare with.

This page says what holds, what a takeover gives you, what is not copied, and what nobody has specified. A seeded model test,
`packages/server/test/standby-model.test.ts`, holds the first three; the findings it could not make hold are in
[the audit](../notes/audits/r24-02-standby-model.md).

## How it works, in the words that matter

- Only the hosted files (`<name>.openhbam.sqlite`) are copied. The standby copies each file once (SQLite's online backup, so
  people keep working), then applies the file's changes: the write-ahead log the primary takes from each file every second.
  A log holds whole pages as they were after the change, so applying a log to a copy brings the copy to the same state.
- Changes are numbered within a run (each time the primary hosts the file: a start, a reopen after a restore). The standby
  writes down the number of the last change it applied, in `.openhbam-standby.json`, a quarter of a second after it applies
  one. The primary keeps the last ten minutes (at most 256 MiB) of changes in memory.
- The standby copies the file again when the run is not the one it follows (the primary restarted), when it is further behind
  than the primary keeps (410), when a change it needs is missing, or when its file is not as it left it (see below).
- The primary lists each standby it has heard from in the last minute (admin console, and the
  `tabularius_standby_behind` and `tabularius_standby_last_seen_timestamp_seconds` metrics, where behind counts changes, not
  seconds).

## What always holds

Each line is checked by the model test (3 seeds in CI, `STANDBY_SEEDS=<n>` for more, `STANDBY_SEED=<n>` to replay one; a
failure prints the seed and every operation).

1. **The standby is never ahead of the primary.** Whenever it is looked at, a standby's file is exactly the primary's file
   as it was after some number of committed edits, and never a state the primary did not commit. The standby's position never
   goes back while the primary stays the same. At the protocol a standby that asks for a change the run never had (after the
   latest, or negative) or for another run is refused with 409.
2. **A change the standby has acknowledged stays.** Once the standby has caught up (its note equals the primary's latest change
   and the primary has nothing left to send) it holds every committed edit; later, when it is looked at, it holds that many or
   more, through standby restarts, standby crashes (notes older than the file), cut and half-delivered answers, and primary
   restarts.
3. **Retries are harmless.** A change applied twice in a row, a run of changes applied again from an earlier one (when no
   design change lies in between: see the audit), a change cut short anywhere, a standby killed after its first copy and before
   its notes were saved, and a link that drops or truncates answers all end with the copy equal to the primary at the next
   catch-up. A primary killed without warning comes back with every edit it had committed (SQLite's log), and its standby then
   copies the file again and equals it.
4. **Everything in the file comes across**: records (create, edit, delete, record ids), design changes (fields, scripts, and the
   rest of the file's design), accounts and their password hashes and privilege sets, API tokens, and containers kept in the
   file, by content (the model compares the SHA-256 of every container, and in some seeds one over a megabyte, which is stored in pieces).
5. **A standby takes no writes until it is promoted.** It has no server of its own, and its folder cannot be served while it
   runs (`serve` answers "already hosted by process N"), so nothing but replication writes to the files.

## Taking over

To take over, stop the standby and run `tabularius serve <standby folder>`.

- `serve` logs `taking over from <primary>: this folder was its standby` and removes `.openhbam-standby.json`. If a file had
  not reached a state the primary was ever in (a copy still being brought up to date, or a copy interrupted), it says which files "had not
  caught up to a whole state and may need restoring from a backup".
- The promoted server has every change the standby had acknowledged. It does not have the primary's last changes if they had
  not reached the standby: with a healthy link that is at most the changes of about one second (the primary takes its
  changes every second); with the link down or the standby stopped it is everything since. There is no way to ask the primary,
  once it is gone, which they were. For a planned switch, wait until the standby has caught up, then stop the primary.
- Accounts, passwords, privilege sets, API tokens and anything else inside the file are there. **Sessions are not**: a Data API
  or web client session lives in the memory of one server process, so a session signed in on the primary is refused (401) on
  the promoted server, as after any restart ([runbook](runbook.md#locked-out-of-the-admin-console)). People sign in again.
- A file written by a newer Tabularius than the one that is promoted is not opened, and the log says so
  (`was written by a newer Tabularius ... Update Tabularius to open it`). The standby does not notice while following; the
  first place it shows is the takeover.
- The promoted server accepts writes at once. Nothing stops the old primary if it is still running (no fencing, no witness):
  stop it first.

## Failback, and when both sides took writes

When the old primary comes back it is still a primary with its own file. Replication goes one way, from the server that has
the writes you keep to the one that does not; it never merges two histories and never chooses between them by itself.

- **A folder that has been served is not made a standby by accident.** `tabularius standby <folder>` on a folder that holds
  hosted files it did not copy stops with "already has files this standby didn't copy (...): use an empty folder, or
  --overwrite to replace them". That is the rule when both sides took writes: refuse and report. It also refuses when no
  writes were taken on the old side, because it does not compare contents.
- **`--overwrite` is the decision to keep the other side.** The folder's files are replaced by copies and what they held that
  the other side did not is gone; nothing records what it was. Keep the old folder (copy it aside) first if you may need it.
- **A file changed here is never replaced without `--overwrite`**, at start, after the main server restarts, and again
  just before a copy replaces anything. A file counts as changed here when its size or time differs from what the standby
  wrote down, or a write-ahead log or rollback journal that holds something is left beside it. A file that is missing is
  copied again unless such a log is left, an empty log or a shared-memory index left by opening the file read-only is not a
  change, and a rollback journal is removed with the old file so that it cannot be rolled back into the new copy. While a
  copy or a batch of changes is being applied the standby's notes say so (a size of -1), saved before the file is touched, so
  what a crash of the standby itself leaves, the file in either state and its log, is its own and is copied again. What a
  person writes to the file in that short window cannot be told from it. The model test "a standby does not silently discard
  writes made on its own folder" holds this.
- The same rule means a standby whose `--primary` address changed (a new name, a new port) treats its own folder as foreign
  and refuses, because the note of what it copied is for the address it followed.
- After `--overwrite` the old primary's folder is a standby of the promoted server and follows it exactly (the model
  checks this after every drill, with writes on both sides first).

## Upgrading

Upgrade the primary first, then the standby. A primary on the new name keeps answering a standby from before the rename:
it answers the old `/openhbam/replication/...` paths and sends the old `X-Openhbam-Run`, `-Seq` and `-Whole-After` headers
next to the new ones, so an old standby goes on following (a regression test plays the old standby's requests). A new
standby that reaches an older primary, or a primary started without `--replication-token`, is answered 404 and says so:
`the main server answered 404: it has no replication routes, because it was not started with --replication-token or because it
is an older version (upgrade the main server first, then this standby)`; a wrong token says `the main server refused the
replication token`. There is no version number in the exchange: the order is detected through those answers, not enforced.

## What is not copied

The standby copies the hosted files and nothing else. After a takeover these are the promoted server's own, not the
primary's: externally stored container files (`RC_Data_FMS/<file>/`, `Files/<file>/`: the audit's second finding), script
schedules and their last runs, backup and certificate settings, the admin console password and passkeys, MCP tokens,
connections and webhooks, the sync configuration, AI usage, the OAuth and search index files, logs, and the backups
(see the table of files in [ADMIN.md](../ADMIN.md) and copy the ones you need by hand). Sessions, record locks and
other in-memory state start empty.

## Not specified

These are listed rather than guessed. Each is behaviour the code has today, with no promise behind it and no test that holds it.

| What | What happens today |
| --- | --- |
| A file removed from the primary's folder | The standby keeps its copy and retries "the main server answered 404" with a delay growing to 30 seconds; a promoted standby would host a file the primary no longer has |
| A file the primary hosts after the standby started | Found at the next listing, within 10 seconds, and copied |
| Several standbys of one primary | The code lists each by address and allows two copies at a time (others get 503 and retry); no test runs more than one |
| A standby of a standby | No: a standby serves no replication routes while it runs |
| Automatic promotion, a witness or fencing | None; promotion is a person stopping the standby and starting `serve` |
| `--workers` with a standby | `serve --workers N --replication-token T` is refused at start; run one process |
| Encryption at rest with a standby | Not offered ([ADMIN.md](../ADMIN.md)); `serve` does not refuse the combination and no test runs it |
| Standby disk full, or a copy cut off | The error is logged and retried with a growing delay; the half copy is a `.standby-partial` file that the next `serve` on the folder sweeps |
| How long a takeover takes, how many seconds behind a standby may be | Not measured: lag is reported in changes, and a copy of a large file takes as long as the copy |
| A standby's own edits to its file (a command line change such as `passwd` while the standby is stopped) | The standby refuses to start or to follow the file, names it and points to `--overwrite`; see Failback below |
| What FileMaker Server does in any of these cases | Unverified: no FileMaker behaviour was consulted <!-- known-difference: Standby servers ;; Which of the standby behaviours listed on this page match FileMaker Server's own failover or cluster features is unverified; the feature is Tabularius's own ;; Someone expecting FileMaker's behaviour in a failover may see a different one ;; A FileMaker Server run or a Claris page on its failover --> |
