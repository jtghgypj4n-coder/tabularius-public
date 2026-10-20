# In-memory lease and TTL clocks

Elapsed lifetimes held only by one process use
`packages/store/src/monotonic.ts`'s `monotonicClock.now()`, backed by
`performance.now()`. A forward or backward wall-clock correction must not
expire them early, extend them, or reset an allowance. Tests can replace the
one clock's `now` method and advance elapsed time independently of `Date.now()`.
Existing per-instance `now` options remain available and take elapsed milliseconds.
Do not persist monotonic values, compare them between processes, or format them
as dates. Suspend behavior follows the platform's monotonic clock.

## Timers covered here

| Timer | Existing policy, preserved |
| --- | --- |
| In-memory record locks | 60 seconds from acquire/renew; expired at equality; other owners cannot acquire a live lock. |
| Record and design presence | 45 seconds from view/renew; expired at equality; presence does not lock a record. |
| Incomplete uploads | Configured idle interval (default 24 hours); expired at equality; 0 disables cleanup; active writes and conversion remain protected. |
| AI credential-file rechecks | At most once per second; first check works even at monotonic time zero. File modification stamps still detect changes. |
| Fault-log allowance | Existing cap per minute, with suppressed faults summarized next minute; buckets now use elapsed minutes. |
| Cluster follower-log allowance | Existing cap until more than 60 seconds have elapsed. |
| Standby presence | Retained through 60 seconds after the latest request; removed after that. |
| Replication change buffer | Existing ten-minute retention and byte cap, pruned on incoming changes; always retain the newest change. |

Locks and presence keep their public `expires` values as epoch milliseconds
computed at acquire/renew. These are display estimates: local enforcement uses
separate, private monotonic deadlines even if the wall clock later changes.
Standby `at` values, encoded replication log timestamps, and upload start/finish
timestamps likewise remain wall time. No monotonic bookkeeping is added to
their public response shapes.

## Shared and persisted state

`SharedRecordLocks` still stores and compares epoch milliseconds in SQLite,
including its inherited `othersIn()` path. Its optional `now` arguments are epoch
time; those on the in-memory `RecordLocks` implementation are monotonic time.
Shared leases can be observed by processes started at different times, so a
process-relative clock cannot replace their stored expiry values. Their existing
wall-clock sensitivity is unchanged. Durable result claims, shared mail limits,
filesystem ages, protocol timestamps, calendar schedules and persisted expiries
also keep their current clock domains. This change does not redesign shared
lease coordination or migrate script execution budgets and reporting durations.

## Overlap review

Compared against fetched `origin/main` (`0af50040`) before editing. None of the
eight timers above was already fixed there. Work already covered elsewhere was
dropped from this change:

- PR #1198 (`1f978a36`, `claude/session-monotonic-idle`): session idle/lifetime,
  authentication and other cache/rate windows, execution waits, the in-memory
  admin passkey challenges, and guarded absolute expiries including persisted
  WebAuthn challenges. That PR's clock audit leaves record/view leases on wall
  time; this note updates the policy for their in-memory implementation only.
- PR #1196 (`07221d89`, `claude/time-followups`): single-read SQL NOW(), audit
  filtering by sequence, Admin API ISO timestamps, and durable daily-run keys.
- Running `claude/time-dst-leftovers`: no origin ref was available at review;
  inspected its local branch and uncommitted worktree diff. It covers calendar
  arithmetic/DST and browser-versus-server clock documentation. Those files are
  untouched here.

## Claris behavior

Searched the local reference library, then read the official
[Open Record/Request documentation](https://help.claris.com/en/pro-help/content/open-record-request.html)
and [Disconnect idle users guidance](https://help.claris.com/en/security-guide/content/disconnect-idle-users.html).
Claris describes exclusive record editing and configurable inactivity limits,
but these pages do not specify a monotonic clock or this application's record
lease/presence durations. Existing durations, renewal/release behavior, ownership
checks and error behavior are preserved. Presence remains an application feature.

## Regression evidence

Before production changes, all 16 regression cases failed: eight timers, each
with a separate one-hour forward and backward wall jump. The unchanged shared
lease compatibility case passed. Tests advance clocks without sleeping and also
check renewal, expiry boundaries, public epoch timestamps and replication wire
timestamps. Run with Node 22 and `--test-concurrency=2`:

```sh
node --test --test-concurrency=2 packages/store/test/record-lease-clock.test.ts packages/server/test/lease-clock.test.ts
npm run typecheck
```
