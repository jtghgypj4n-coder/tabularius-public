# Hosted file lifecycle concurrency (r17n-03)

The lifecycle regressions use temporary native stores, connected Data API
clients, and deterministic barriers at request-body, password-check, script,
and peer-close waits. They do not require fixture conversion.

## Coverage reused from main

The initial main-branch search found these cases already covered; this item
does not repeat their fault matrices:

- `crash-points-host.test.ts`: conversion and upload publication/recovery.
- `crash-points-store.test.ts`: standalone schema and container crash recovery.
- `crash-points-backup.test.ts`, `crash-points-restore.test.ts`: backup/restore
  crash boundaries.
- `close-while-warming.test.ts`: shutdown while background warming runs.
- `sync-console.test.ts`: awaited sync interrupted by pause or close/reopen.
- `adminapi.test.ts`: normal pause/resume/close/open and session termination.

The r17j-03 branch's working changes were checked to avoid overlap. Backup,
restore, encryption-write and migration fault cases remain with
`claude/r17j-03-backup-restore-integrity`. This item adds only an online-backup
success case with an overlapping client write; it changes no backup code.

## Defects and regression tests

`file-lifecycle.test.ts` verifies that checkpoint failure keeps the open store
registered, failed opening keeps the closed entry retryable, and failed open
callbacks release their connections. All close callers now end sessions,
including a previously paused file, and release locks in paused stores too.
A missing file cannot be recreated as an empty SQLite file by reopening it.

`file-lifecycle-requests.test.ts` holds writes and container uploads across
close/reopen, pause/resume, schema changes and logout. Captured connections,
file generations, schemas and sessions are checked again before work resumes.
Tests also cover queued writes during peer shutdown, a new session established
during that wait, an actual asynchronous password check, and an awaiting script
holding a record lock. Refused writes preserve committed data and release the
request slot; fresh requests can write again.

`file-lifecycle-crash.test.ts` builds on #1206's exit-without-unwinding hook.
Two HTTP clients first receive write acknowledgements; another request remains
in flight when the child exits at open/close or schema commit boundaries.
Reopening verifies every acknowledged value, SQLite integrity, schema atomicity,
fresh sessions and usable record locks. Every child has a temporary stub-bin
first in PATH for launchctl, systemctl, sc, git, npm, curl and sudo; any invocation
writes a marker, exits 99 and fails the test.

## Limits and compatibility

There is no hosted-file rename API; Admin API file deletion is explicitly
unsupported. Rename/removal tests therefore use close first, then filesystem
mutation, then reopen. Moving or unlinking an actively opened SQLite database
is not established as safe by these tests.

Claris's exact error/status values for these races are unknown. The new HTTP
409 responses using existing error code 3 are OpenHBAM retry behavior, not a
claim of Claris conformance. The peer-close barrier tests local coordination;
they do not simulate an entire failing cluster.

Run the new cases with:

```sh
node --test --test-concurrency=2 --test-reporter=spec packages/server/test/file-lifecycle.test.ts packages/server/test/file-lifecycle-requests.test.ts packages/server/test/file-lifecycle-crash.test.ts
```

Each new file completed in under five seconds during validation. Request and
child-process timeouts provide more than three times the observed duration.
