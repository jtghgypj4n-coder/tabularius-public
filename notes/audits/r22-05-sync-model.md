# Tabularius offline sync model audit

Scope: the documented tier-2 record sync protocol in `sync.ts`, `sync-apply.ts`
and the Data API adapter, with two or three replicas (one remote hub and one or
two independent local stores). This is not a browser offline-copy test: that
feature queues existing-record field edits and does not allow offline creates
or deletes ([web client](../../docs/web-client.md)).

## Existing coverage and work dropped

Searched `main` before implementation and read the write leg,
`scripts/smoke-sync.ts`, and the sync sections of `ADMIN.md`.

- `packages/store/test/sync.test.ts` already covers individual policy outcomes,
  duplicate UUIDs, deletion detection, timestamps and recreated remote IDs.
- `packages/store/test/sync-apply.test.ts` already covers opt-ins, interruption,
  adoption after lost acknowledgement, stale versions, reviewed choices,
  UUID verification, and pull validation.
- `packages/server/test/fms-sync.test.ts` already covers incomplete pagination,
  bounded responses, request deadlines and transient read retries.
- `packages/server/test/fms-sync-apply.test.ts` already covers basic HTTP sync.
- `scripts/smoke-sync.ts` already exercises the console check/review/apply flow.

Dropped duplicate isolated examples, a second browser smoke test, vendor tests,
production changes, dependency additions and workflow changes. Added composition
coverage through a separate reference model, generated histories, real HTTP
fault injection, a shrinker, and current-privilege checks. No production bug was
identified; no speculative fix or duplicate bug regression was added.

## Rules and boundaries

Sources: [sync setup and conflict rules](../../ADMIN.md#keeping-a-filemaker-server-copy-in-step), the “Sending records to
FileMaker Server, and bringing them here” and “From the admin console” sections
of [ADMIN.md](../../ADMIN.md). Source comments were used to locate implementation
boundaries, not to invent vendor guarantees.

| Case | Documented rule / executable assertion | Open behavior |
| --- | --- | --- |
| Concurrent edits | Default `flag` refuses the entire run. Explicit table policy selects a record; unresolved cases require fresh per-record review tokens. Both versions remain intact before a decision. | Order-independent global winner across several independently edited replicas: **unverified**. |
| Delete versus edit | Automatic policies hold the conflict. A reviewed choice keeps the deletion or the surviving record; the latter explicitly permits recreation. | Automatic delete-wins or edit-wins: **unverified**. |
| Same key created on both sides | Before a baseline, differing records conflict; identical values are adopted. Generated histories create differing records with the same UUID. | Arbitrarily duplicated create requests delivered independently of the client retry protocol: **unverified**. |
| Field versus record merge | A decision chooses the record. Updates send only differing fields. Disjoint field edits still conflict; the oracle does not combine the two records. | Automatic field-level merging: **unverified**. |
| Tombstones | The shared-key baseline permits deletion detection. Successful deletes propagate, retries remain deleted, and a reviewed surviving-record choice can recreate. | Persistent tombstone retention/expiry, UUID reuse after all baselines are cleared, and a newly joined stale replica: **unverified**. No permanent delete-wins guarantee is asserted. |
| Clock skew | `newer-wins` compares the modification timestamps; ties and unreadable timestamps require review. Histories edit clocks forwards and backwards and test ties/unreadable values. Timestamps themselves do not transfer. | Correct physical chronology under skew, differing time zones, offset/fractional timestamp ordering: **unverified**. The documented same-time-zone requirement still applies. |
| Partial transfers | Completed record writes survive a stopped batch. Dropped requests and lost acknowledgements interrupt at a seeded write position. A clean retry must match the reference result. | Batch-wide atomicity is not promised; there is no whole-batch rollback assertion. |
| Interrupted retry | A new connection/check retries the remaining work; accepted creates are not duplicated. At completion, data and local versions remain unchanged by another retry, no further remote writes occur, and no attempt log row remains unfinished. | Exactly-once delivery outside this client/reconciliation protocol: **unverified**. |
| Duplicate/reordered/truncated transport | The actual adapter receives duplicate record IDs, reordered records across two-record pages, short pages, malformed truncated JSON, dropped requests and lost acknowledgements. Incomplete snapshots cannot cause deletes. | Arbitrary write-request reordering: **unverified**; the client dispatches record writes serially. Read-order permutations are tested. |
| Schema change mid-sync | The fake removes the layout between the initial read metadata and the write metadata request. The table is held without writes and resumes after repair. Schema and privileges never transfer as records. | Atomic schema snapshots, field/type changes after metadata caching, and arbitrary schema migration during a write: **unverified**. |
| Privileges on pushed data | A generated loopback Tabularius Data API server revokes create/edit/delete rights while a replica is offline. Each operation and its retry is denied without losing the pending write; granting rights permits recovery. A field becoming read-only is tested the same way. | Claris/vendor parity and privilege changes after a request is dispatched: **unverified**. No external server is contacted. |

“Convergence” means both participants agree after each completed pairwise sync,
and every replica agrees after quiescent full sweeps with explicit conflict
choices. An unresolved conflict deliberately prevents a full sync. “No lost
acknowledged write” means a generated local write remains present until a later
edit, deletion, or explicit policy/review outcome supersedes it; an accepted
transport write survives retry. It does not mean preserving both conflicting
values in the final record.

## Harness and reproduction

- `packages/server/test/helpers/sync-model.ts` contains the independent oracle,
  PRNG, operation generator and bounded deletion shrinker. It imports no
  production code and never reads production plans or sync maps to decide a winner.
  It tracks its own replica versions and pairwise baselines.
- `packages/server/test/helpers/sync-transport.ts` is an HTTP stand-in. All
  requests pass through the production Data API adapter. Fault order and write
  position are seeded. Every mandatory fault must actually fire. Interrupted
  batches mix updates, creates and deletes; default seeds interrupt all three
  operation types, including a committed update and delete with lost replies.
- `packages/server/test/sync-model.test.ts` checks the oracle, preservation on
  refusal, recovery, idempotency, final convergence and actual Data API privilege
  enforcement. Data is generated; no corpus or sample files are opened.
- `scripts/test-sync-model.ts` runs only this test file with
  `--test-concurrency=2`. The test worker and any descendants inherit a PATH
  containing only stubs for `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`
  and `sudo`. Each writes a marker and exits 99; any marker fails the run.
  The test also installs this guard when invoked directly. Servers bind only
  `127.0.0.1`; no child service, browser, live vendor endpoint or new dependency
  is needed.

```sh
node scripts/test-sync-model.ts
SYNC_MODEL_SEED=37 node scripts/test-sync-model.ts
```

The default seeds are `1`, `2`, `37`, and `91`: 493 operations, with both replica
counts. Failure output includes the seed, replica count, assertion identity and
shrunk JSON history. Shrinking replays fresh stores, preserves the original
assertion identity, and is bounded to 24 candidate replays / 10 seconds between
replays. It preserves the final full sweeps so an unsynced tail cannot masquerade
as a convergence failure; it does not claim a globally minimal history.

## Validation

- Final targeted runner: **3 tests passed**, approximately **6.8 seconds** for the
  file (5.2 seconds generated histories, 0.8 second privilege checks).
- Timeouts: 55 seconds for the generated histories, 15 seconds for privileges,
  60 seconds for the runner; over three times the observed passing durations.
  No narrow timing assertions were added.
- Root TypeScript check: **passed** (`node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false`).
- No commits, pushes, publication, tags, workflow edits, or changes to protected
  directories. Local machine paths and tool caches are absent from new files.
