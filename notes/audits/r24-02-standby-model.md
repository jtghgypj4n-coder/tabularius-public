# Standby and replication: a model-based test

Item r24-02. `packages/server/test/standby-model.test.ts` runs a real `serve` with a replication token, a real `Standby` and a
loopback proxy that cuts or truncates the link, driven by a seeded generator, against a plain model of what the primary
committed. What it holds, and what a person can rely on, is written in [standby servers](../../docs/standby-guarantees.md). This page
is what it found.

## What the model does

- **Reference:** one digest per committed edit (records and their ids, fields, scripts, accounts' password hashes, containers
  by SHA-256). The standby's file, read from a copy while the standby is stopped, must equal one of them.
- **Generator** (seeded, 24 steps per seed): edits (create, update, delete, new field, new script, password change, container up
  to over a megabyte), burst of edits, settle (wait for the standby to catch up), inspect, standby restart, standby crash (its
  notes put back to the last settled ones), partition (cut, or answers cut in half), heal, clean primary restart, and a
  failover drill: promote the standby (planned after catching up, or with the primary cut off and still taking writes), write on
  both sides, then fail back (refused, then `--overwrite`) and check the old primary follows the promoted one exactly. After
  each drill the roles are swapped and the run goes on.
- **Checked** after steps and at the end: never ahead of the primary's committed states, never behind what it acknowledged or
  what it held before, equal to the primary after a catch-up, the 409 answers for an impossible position, takeover logging,
  the refusal to make a served folder a standby, sign-in with the promoted file's passwords and the Data API on the promoted
  server, a session from the old primary refused. Separate tests cover repeated, replayed and cut-short changes at the file
  level, the old-name standby, the clear messages, a standby folder that cannot be served, a newer file format at takeover,
  API tokens and sessions after takeover, a crash after the first copy, and a primary killed with SIGKILL.
- **Seeds:** 5 in CI. 25 seeds (`STANDBY_SEEDS=25`) passed, after the fixes below, in about 105 s. With a deliberately broken standby
  (its position set one change too high after each copy) the model fails at the first catch-up, with the seed and history.

## Fixed in this change (regression tests included)

1. **A standby from before the rename looped on a primary that was upgraded first.** The old standby reads the run and position
   of a copy from `x-openhbam-run` and `x-openhbam-seq` (the pre-rename code, from the rename commit, read exactly those); the
   upgraded primary answers its old paths but sent only `x-tabularius-*`, so the standby saw no run, was told "the server
   restarted" at once, and copied the file again without delay. [upgrading.md](../../docs/upgrading.md) says to upgrade the primary first,
   so that was the order that broke. The primary now sends both header names on copies and changes. Test: "a standby on the old
   product name keeps following a primary that was upgraded first".
2. **The reverse order gave an unhelpful message.** A new standby against an older primary (or one without
   `--replication-token`) said only "can't reach ...: the main server answered 404". It now says the main server has no replication
   routes and to upgrade it first. Test: "a standby says what is wrong ...".
3. **A standby that crashed in the quarter second after its first copy could not start again.** The note of the copy was saved
   after a delay, so the folder held a hosted file the notes did not mention and the next start refused it as foreign ("already
   has files this standby didn't copy"), which needed `--overwrite`. The note (marked as not whole, so a takeover warns) is now
   saved before the file appears. Test: "a standby that crashed right after its first copy ...". The model found it on its
   second seed.

## Not fixed: three findings, each with a `todo` test that fails today

These tests run, report their failure as expected (`# TODO` in the output) and become ordinary tests the day they pass. None is
skipped.

### 1. A standby silently discards writes made to its own folder

The header of `standby.ts` says a file changed by anything else "is never overwritten unless asked". The code does the
opposite for a file it is following: if the file's size or time differs from what the standby wrote down, it logs
`<file> changed here since it was last updated: copying it again` and copies the primary's file over it. Repro: let a standby
catch up, stop it, change a record in its file (a script, `tabularius passwd`, a Store opened by hand), start it again; the
change is gone, with one log line. This is the "both sides took writes: pick one silently" case that the design asks to
refuse and report. Test: "a standby does not silently discard writes made on its own folder".

Why it is not fixed here: the same difference, a file that is not as its notes say, is what a standby crash leaves (the notes
are saved a quarter second after a change is applied), and copying again is the right recovery for that. Telling the two
apart needs something the notes do not hold, for example a hash of the file as the standby left it, or the notes saved before
each apply. Refusing in both cases would make every standby crash need `--overwrite`. Decision for the owner: keep the
recovery and add the hash, or save the notes before each apply and refuse on any difference.

### 2. Containers stored outside the file are not copied

A container field set to open external storage keeps its files in `RC_Data_FMS/<file>/...` beside the hosted file, and the file
holds only the path. The standby copies only `<name>.openhbam.sqlite`, so after a takeover those containers are missing
(`containerIntact` is false, the record shows the field but not the bytes). The Backups copy these folders (ADMIN.md); the
standby does not. Repro in the test: external storage on a container field, `setContainer`, catch up; the standby folder has
no `RC_Data_FMS`. Test: "a container stored outside the file (open external storage) reaches the standby, by hash".

Why it is not fixed here: it needs a way to list and fetch the files of the folder with their hashes, a place for removals, and
a decision on very large files; that is a feature. Until then copy the folder by hand (the guarantees page says so).

### 3. Applying changes over a copy that already holds a later design change fails

`replication.ts` says a copy "may already hold some changes after `seq`; applying those again is harmless". It is for
data changes. When a design change (a new field is enough) lies between the first change applied again and the state of the
copy, applying the earlier logs fails with `database disk image is malformed` and leaves the file torn until a later
change repairs it or the standby copies the file again, which its next retry does, because the file no longer matches its
notes. Repro: four changes, the third a new field, a copy taken after all four, then changes 2 to 4 applied again.
Test: "changes replayed over a copy that already holds a later design change are harmless".

How likely: the copy is taken while people work, so it can hold changes after the position it reports; this needs a design
change in that window, which is rare. The effect is a short period with a damaged standby file and an extra copy; a takeover
in that moment would find a file that does not open, and the log would say the file had not reached a whole state. Options for
the owner: make the primary's copy at a point between two changes (hold the log shipper while the backup runs), or have the
standby copy again at once when applying a change fails, instead of after the retry delay.

## Behaviour read from the code and left unspecified

Listed on [the guarantees page](../../docs/standby-guarantees.md#not-specified): files removed on the primary, several standbys, a
standby of a standby, no fencing, encryption at rest, lag in seconds, what FileMaker does. None of it is promised and none of it is
tested, other than as noted there.

## Limits of this work

The model runs in one process (the standby and the primary are objects in it, the link is a local proxy), so network faults other
than cut and truncated answers (reordering, slow links, a half-open connection that never closes) are not played. A power loss is
not played either: the primary is killed with SIGKILL, which leaves SQLite's log intact, and the standby is stopped, not killed;
its crash is played by putting back older notes. `--workers`, TLS, encryption at rest and more than one standby are not run. The
typecheck was not run in this environment.
