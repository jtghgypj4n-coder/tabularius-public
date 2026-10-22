# Backup review, round two — r26-03

Reviewed 2026-10-18 against the supplied main-based worktree. **Three bugs fixed; 29 new adversarial tests; 180 existing regression tests pass across the initial run and the localhost retry.** No dependencies, commits, pushes, service operations, installs, upgrades, or network commands were used. Fixtures and corpus data were not opened. All exercised databases, accounts, containers, and journals were generated for tests; this report contains aggregate results only.

Main already contained durable restore journals, exclusive restore claims, crash hooks, corruption classification, credential reconciliation, schedule history bounds, and newer-format refusal. Those implementations were retained. The fixes are limited to account comparison, point-in-time cancellation, and deleted schedule counters.

## History and scope

Discovery used the requested read-only history exception, followed by first-parent merge diffs (`git diff <merge>^1 <merge> -- <scoped paths>`). First-parent enumeration avoids counting merges of main *into* development branches as separate releases. No other kind of git operation was used.

```sh
git log --since=2026-10-16 --merges --first-parent --format='%h %cs %s' -- \
  packages/server/src/backup.ts packages/server/src/backup-external.ts \
  packages/server/src/backup-folder.ts packages/server/src/backup-info.ts \
  packages/server/src/backup-verify.ts packages/server/src/restore-files.ts \
  packages/server/src/schedules.ts packages/server/src/integrity-worker.ts \
  packages/server/src/optimization-containers.ts packages/store/src/crash-point.ts \
  packages/store/src/durable.ts packages/store/src/store-format.ts \
  packages/cli/src/newer-files.ts scripts/rehearse-upgrade.ts
```

The wider discovery also inspected host/store changes and their crash, integrity, migration, and container tests. The table below lists all 22 first-parent merges returned for the focused paths, including incidental changes explicitly excluded from behavioral claims.

| Requested item | Merge found | Scope resolution |
| --- | --- | --- |
| r17d-02 | #1206, `075ce7cb6`, 2026-10-16 | Crash hooks and recovery ordering reviewed. |
| r18-01 | #1238, `5073964e3`, 2026-10-17 | Corruption, integrity workers, full/read-only failures reviewed. |
| r21-01 | #1272, `e47d57ca4`, 2026-10-17 | Format guard and migration entry points reviewed; the historical checkout/upgrade rehearsal was read, not executed. |
| r19-02, r19-03 | No matching merged item labels found | No PR number or claimed change inferred. Related merged backup/restore changes are listed separately below. | <!-- known-difference-ok: lists which review items matched no merged change; it says nothing about FileMaker behaviour -->
| r25-03, r25-14, r25-20 | No matching merged item labels found | No PR number or claimed change inferred. Their item-specific second-round coverage remains unverified. | <!-- known-difference-ok: lists which review items matched no merged change; it says nothing about FileMaker behaviour -->

Container GC originated in #1127 (`5c0905358`), before this review window. Its existing synthetic orphan/undo/shared-root suite was run as baseline coverage; it was not presented as a newly merged r25 change or rewritten. Container movement and compatibility migration crash boundaries added by #1206 were exercised by the existing synthetic crash suite.

## Invariants and attempted breaks

New test files below are in `packages/server/test/`:

- **R2**: `backup-review-round2.test.ts` — restore routes, accounts, cancellation, copy failures, formats.
- **Recovery**: `backup-review-recovery.test.ts` — process exits, rollback, simultaneous claims, disk and integrity failures.
- **Schedules**: `backup-review-schedules.test.ts` — edits, overlap, deletion, restart, bounded history.
- **State**: `backup-review-state.test.ts` — manifest writers, cleanup, aliases, elapsed-time caching, encrypted formats, credentials.

The original tests read alongside the scoped diffs included `crash-points-harness.ts`, `crash-sync.ts`, `restore-recovery.test.ts`, `backup-integrity.test.ts`, `backup-disk.test.ts`, `backup-durability.test.ts`, `store-corruption.test.ts`, `schedule-parity.test.ts`, the relevant schedule/destination tests, `restore-credentials.test.ts`, `restore-account-differences.test.ts`, `newer-store.test.ts`, `store-format.test.ts`, `state-followups.test.ts`, and durable-state tests. Fixture-dependent cases were excluded from execution. Tests below add different routes, loop positions, names, failure boundaries, or concurrency to those cases.

| PR / merge | Invariant | Test tried | Result |
| --- | --- | --- | --- |
| #1147 `34b9fe20e` | Malformed state is preserved and cannot silently become an empty document. | State: repeated malformed Unicode-key JSON reads, evidence count, then an explicit valid replacement. | Holds: original bytes retained; one evidence copy; replacement readable. |
| #1143 `8466beba6` | Backup destinations cannot alias the hosted folder's external container tree. | State: a symlink alias plus a nonexistent Unicode child destination, through both validation entry points. | Holds: refused before creating the destination. |
| #1150 `2afc7abb2` | Server and restore ownership exclude one another until release or process death, including aliases. | Recovery: two actual processes simultaneously claim different aliases of one Unicode folder; kill the winning owner and reclaim through the alias. | Holds: exactly one owner, immediate reclaim after death. Existing pending-journal startup tests also pass. |
| #1160 `e85f69cb0` | Locked state updates preserve changes made by competing processes. | State: two processes update one manifest through different aliases, then read it after both exit. | Holds: all 24 updates retained. |
| #1168 `51df1bf75` | Backup destination listings cache probes for one minute and refresh when the destination changes. | State: remove the destination during its cached interval, advance elapsed time, then edit to a new destination. | Holds: cached answer expires; edit clears the old failure. |
| #1177 `8801ef6e4` | Manifest editors share a lock and cleanup retains active foreign writers while removing stale local leftovers. | State: concurrent manifest updates; future timestamps after a backward clock jump; live foreign PID versus stale own PID. | Holds: no lost updates; only the eligible stale temporary file removed. |
| #1185 `0ad78543b` | Backup labels remain distinct and sortable when wall time repeats or moves backward. | R2: queue three backups with repeated/backward timestamps and verify every resulting set. | Holds: three distinct verified sets. Existing repeated progressive-log test also passes. |
| #1196 `61d843ccf` | Daily claims survive restart, schedule edits reset the claim, and persisted histories stay bounded. | Schedules: 60 daily runs, duplicate attempt, time edit, restart, duplicate attempt again, then removal. | Holds: at most 14 daily keys and 50 history entries; edited schedule runs; restart blocks duplicate; removal clears persisted state. |
| #1198 `c758d660b` | Backup destination cache age follows elapsed time rather than the wall clock. | State: move `Date.now()` backward while advancing the monotonic test clock beyond cache expiry. | Holds: missing destination is detected. |
| #1206 `075ce7cb6` | An interrupted restore returns an entire batch to its prior generation and recovery is repeatable. | Recovery: Unicode database/WAL/container-directory batch, exit at the third save or publication, then a second exit during rollback; recover twice. | Holds: every prior component recovered; journal removed. |
| #1206 `075ce7cb6` | A failed copy or publication leaves the previous recoverable generation intact. | R2/Recovery: injected ENOSPC and EACCES after backup copy and at the second restore replacement, with retry and WAL assertions. | Holds: no half-published backup; previous set retained; restore rolls back; retry succeeds. Existing encrypted/container/migration crash tests pass. |
| #1209 `4dca782bd` | Restoring cannot silently replace current credential state with revoked historical credentials. | State: Unicode account, permission-denied current store, then damaged current store; R2: a later incompatible credential table. | Holds for exercised cases: permissions refuse without changing staging; damaged current credentials disable old passwords; later failure rolls back the reconciliation. |
| #1236 `74bc8d8b1` | The scoped diff forwards the outbound allowlist to scheduled scripts. | Read the scoped diff; it changes script networking, not backup/restore/integrity execution. | Excluded from behavioral testing in this backup review; no network requests made to test it. |
| #1238 `5073964e3` | Disk-full writes roll back without marking a sound file damaged, while integrity read damage blocks later operations. | Recovery: real SQLite `max_page_count` exhaustion after an earlier statement in the transaction; injected extended short-read error; actual POSIX read denial. | Holds: zero partial rows; subsequent write succeeds; short read poisons later access; permission failure is unreadable, not damaged. |
| #1251 `0a5496902` | Verify schedules do not overlap and per-schedule skipped-run bookkeeping ends when the schedule is deleted. | Schedules: blocked verify operation plus interval edit; four create/skip/edit/delete cycles. | **Failed, fixed:** deleted IDs accumulated in `skipped`; `remove()` now deletes the counter. Overlap and rearming held. |
| #1271 `9b524c2bc` | A test restore of a store with no user tables explains its empty state instead of claiming usable records. | R2: generated empty store, backup, scratch test restore. | Holds: unsuccessful result with the `tabularius new` explanation. |
| #1272 `e47d57ca4` | Newer or unreadable store format metadata is refused before reconciliation writes. | R2: unsafe-integer boundary, non-ASCII digit string, and numeric overflow; compare staged bytes after refusal. | Holds: refusal without modification. Existing format/open/design/reconvert guard tests pass. Historical-build rehearsal not run. |
| #1285 `95d7cad82` | Damage in the current file permits recovery with credentials disabled, while a permission failure still refuses. | State: the same generated Unicode account source first made unreadable, then overwritten with non-database bytes. | Holds: permission failure leaves staging unchanged; damage disables all historical passwords. |
| #1301 `31e4b24cf` | Account-change refusal compares every distinct stored account and reports the correct name before publication. | R2: two legacy/import-style Unicode names that SQLite NOCASE keeps distinct, changing only one; full-set and point-in-time routes; ASCII and composed/decomposed controls. | **Failed, fixed:** Unicode lowercasing collapsed distinct identities and missed the change. Both maps now use the existing ASCII-only `accountKey`; both routes refuse, report the changed identity, and leave live bytes unchanged. |
| #1300 `534b2e11c` | A cancelled restore cannot publish staged files and must release its folder claim. | R2: already-aborted signal and cancellation while staging the second database through `restoreAt`. | **Failed, fixed:** `restoreAt` ignored the shared signal option. Entry, per-file, post-await, and pre-publication checks now reject; both live files remain unchanged and staging/claim are released. |
| #1297 `9c3dfd8a9` | The Tabularius interface rename preserves existing data-at-rest filenames. | R2/State plus existing API regressions: new command text and encryption checks with unchanged store/sidecar names; `/tabularius/` schedule routes. | Holds for exercised surfaces; no blanket replacement performed. |
| #1306 `4c245d3a1` | Encrypted newer stores are inspectable with a key, and a live plaintext working copy takes precedence. | State: Unicode filename, newer encrypted copy, missing-key inventory, ciphertext byte comparison, then a current-format plaintext counterpart. | Holds: encrypted format found without ciphertext changes; plaintext counterpart wins. No upgrade command executed. |
| #1307 `b020294cd` | Cross-format credential reconciliation refuses unknown restored columns and commits no earlier table changes on failure. | R2: unknown column in a later credential table after earlier reconciliation work, plus malformed/newer format boundaries. | Holds: refusal and byte-identical staged database. Existing live newer-format quarantine tests pass. |

## Fixes and independent review

- `packages/server/src/backup.ts:831` and `:855`: use the existing SQLite-compatible account identity key for account-difference maps and display names. This closes a refusal bypass for distinct Unicode account names; both restore routes have regressions.
- `packages/server/src/backup.ts:1073`: honor the supplied cancellation signal through point-in-time staging and immediately before synchronous batch publication. Regression cases cover an already-cancelled request and cancellation during the second database, including claim cleanup. On this repository the check runs after the set's manifest is verified and each file is staged (so an already-cancelled request is seen after the first staging step, and its staged copy is cleaned up), not at function entry.
- `packages/server/src/schedules.ts:534`: delete the skipped-run counter when deleting its schedule. Regression includes interval edits, timer replacement, repeated deletion, and separate bounded-history/restart checks.

An independent read-only review (before this port) read the changed production code and review tests. It reported no actionable security findings. Its suggested stronger assertions—checking the reported Unicode name and cancellation during a second staged database—were added and passed. This was a code review, not a claim that the reviewer reran tests.

## Reproduction and results

All runs use Node 22.22.2 and `--test-concurrency=2`. `backup-review-guard.ts` installs a stub-only PATH inherited by every spawned child: `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`, and `sudo` write a marker and exit 99. The test process fails if the marker exists. Children use the absolute Node executable. No forbidden-command marker was observed.

The new profile is suitable for CI: four small test files, synthetic data, two concurrent test files, 15-second child timeouts and 30-second async process-test timeouts. The final new profile completes in under 10 seconds here; no new file approaches the 60-second target. Disk exhaustion uses a real SQLite page limit plus deterministic filesystem failure injection rather than filling the runner disk. This work required no larger-runner data or memory profile.

```sh
node --no-warnings --test --test-concurrency=2 --test-reporter=spec \
  packages/server/test/backup-review-*.test.ts
```

**29 passed, 0 failed, 0 skipped.** Before fixes, four restore assertions failed across the two restore bugs; the schedule deletion probe separately demonstrated retained counters. Preliminary test-setup mistakes were corrected before final counts and are not reported as product defects.

```sh
node --no-warnings --import ./packages/server/test/backup-review-guard.ts \
  --test --test-concurrency=2 --test-reporter=spec \
  packages/server/test/crash-points-backup.test.ts \
  packages/server/test/crash-points-restore.test.ts \
  packages/server/test/crash-points-store.test.ts \
  packages/server/test/restore-recovery.test.ts \
  packages/server/test/backup-integrity.test.ts \
  packages/server/test/backup-disk.test.ts \
  packages/server/test/backup-durability.test.ts \
  packages/server/test/backup-external.test.ts \
  packages/server/test/restore-account-differences.test.ts \
  packages/server/test/schedule-parity.test.ts \
  packages/server/test/newer-store.test.ts \
  packages/server/test/orphan-containers.test.ts \
  packages/store/test/store-format.test.ts
```

Initial sandbox run: **170 passed, 10 failed**, all ten because localhost listeners were denied with `listen EPERM`; no assertion failure in the exercised non-HTTP cases. The affected files were rerun with local listener permission and the same stub PATH:

```sh
node --no-warnings --import ./packages/server/test/backup-review-guard.ts \
  --test --test-concurrency=2 --test-reporter=spec \
  packages/server/test/backup-disk.test.ts \
  packages/server/test/backup-durability.test.ts \
  packages/server/test/newer-store.test.ts \
  packages/server/test/restore-recovery.test.ts \
  packages/server/test/schedule-parity.test.ts
```

Retry: **46 passed, 0 failed, 0 skipped**, resolving all ten listener failures. Counting each test once, the existing regression profile has **180 passing tests**. Together with the new profile, **209 distinct tests pass**.

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
```

**Pass: zero diagnostics.** No dependency installation was needed.

## Limits

- Five requested item labels could not be mapped to merged PRs; their specific changes cannot be certified by this review.
- Physical power loss, an actually full filesystem, native Windows/Linux execution, cross-machine shared storage, and separate PID namespaces were not exercised. Process-kill tests cover application crash ordering; injected platform branches do not certify a different operating system. Concurrent-owner evidence is for separate processes on one host and filesystem.
- The checkout/upgrade rehearsal was not executed because it invokes git/worktree operations outside the read-only history exception. No service/install/upgrade test was run.
- Fixture-dependent host conversion/upload, imported-file, and corpus tests were excluded. The original corruption suite's shell/chmod subprocess cases were not run; new generated-data tests cover SQLite-full, permission denial, and integrity error classification directly.
- Claris parity is **unverified** here. No undocumented Claris behavior is asserted; the invariants above describe Tabularius code and measured tests. <!-- known-difference: Server operation ;; Whether FileMaker's backup, restore and account handling match this review is not settled ;; Nothing shows; the review asserts no undocumented Claris behaviour ;; A FileMaker run of the same backup and restore checks -->
