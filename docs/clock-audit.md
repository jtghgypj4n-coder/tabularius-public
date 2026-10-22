# Session and expiry clock audit

Process-local elapsed durations use `performance.now()`: session idle time,
Admin API maximum lifetime, authentication cache TTLs, lockout windows, rate
limits, and local cache/retry/execution budgets. These values never become
persisted timestamps. Session `started`/`since`, audit dates, and public API
timestamps remain epoch time. Lockout deadlines are converted to epoch time
only when returned for display and `Retry-After`; enforcement uses the stored
monotonic deadline.

## Absolute credential expiries

`packages/store/src/clock.ts` captures a fixed wall/monotonic reference when
loaded at process startup. Issuance and checks both use:

```text
effective epoch = max(current wall, startup wall + monotonic elapsed since startup)
```

The startup reference never advances to an observed forward jump. Consequently:

- A backward jump below the startup projection cannot extend an existing
  credential's deadline, even before its first check. Repeated small backward
  adjustments are guarded too.
- Relative lifetimes issued during rollback use the effective epoch. A
  30-minute token issued after a one-hour rollback works immediately and expires
  after 30 minutes of monotonic elapsed time, unless a forward jump expires it
  sooner. The guard does not rewrite existing persisted expiry dates or
  caller-supplied absolute expiry dates.
- A forward jump can temporarily expire an absolute credential. Correcting it
  restores acceptance if the credential still exists and its deadline is ahead
  of both the corrected wall and the startup projection. Expiry reached by the
  monotonic startup projection cannot be undone by rollback. Pruned, consumed, or revoked
  records are not restored.
- A credential issued while wall time is **ahead** of the startup projection
  receives that ahead-of-time expiry. If the jump is corrected, its effective
  remaining lifetime can exceed the requested duration by that offset. Fixed
  epoch expiries alone do not preserve per-credential elapsed lifetimes across
  both corrections and restarts. This is a consequence of the recoverable
  forward-jump policy, not a guarantee of strict elapsed lifetime in that case.
- A rollback of **more than five minutes** behind the startup projection emits
  a `console.warn` warning to stderr, once per process. Correcting a forward
  jump back to the projection does not trigger the warning.

Guarded issuance covers OAuth consent/code/access/refresh records, OIDC pending
state and Data API grants, API-token lifetime calculations in Manage Security,
the admin console and CLI, legacy MCP tokens, account-import previews, signed
container/image URLs, password-change dates, and WebAuthn challenges. Public
creation/last-used/audit timestamps remain wall time when they do not control
expiry. `Store.createApiToken({ expires })` continues to honor the caller's
absolute date; callers deriving a relative lifetime must use `expiryClock.now()`.
Non-expiring credentials retain their existing semantics.

Checks cover those credentials plus externally issued OIDC ID tokens. OIDC
future-date sanity checks use the same effective epoch as local issuance, so
valid pending state and grants are not rejected during rollback. Apple's client
assertion JWT timestamps, TOTP and inbound-hook timestamps remain protocol wall
time because other machines validate them. External issuers still need a
trustworthy clock. API/MCP tokens with an invalid expiry date fail closed;
equality with their expiry is expired.

## Cluster and restart limits (F3)

The reference remains process-local. With the fixed reference, workers started
against the same host clock no longer diverge merely because only one observed
a temporary forward jump: after correction, both use their startup projections.
Small startup sampling differences can still affect a boundary decision.

Workers started or restarted on opposite sides of a clock change can still
agree on a persisted expiry date but disagree about whether it has passed. A
worker started during a rollback can accept a token another worker rejects;
one started during a forward jump can keep rejecting it after correction.
Credential-hash routing reduces exposure to different workers but does not
solve worker replacement, shared signed URLs, or independent server processes.
The guard cannot detect clock changes while a process is stopped. Restarting
establishes a new reference; do not restart solely to clear rollback protection.

Sharing a reference is deferred: the clock initializes at module load, before
the cluster front process sends its start message. A correct change needs a
shared epoch/elapsed reference installed before credential operations, including
worker replacements, plus bootstrap and restart tests. Sending the wall epoch
alone would lose the elapsed interval and would not solve the problem. Persisted
expiries still depend on a trustworthy host clock across process starts.

## Host suspend and idle security (F4)

We retain `performance.now()` for idle and in-memory maximum lifetimes, without
a wall-delta heuristic. On macOS and Linux with `CLOCK_MONOTONIC`, the underlying
clock pauses during suspend. Sleep therefore does **not** consume session idle
time, Admin API maximum lifetime, authentication-cache TTLs, or lockout/rate
windows. After wake, a session idle for hours of wall time may still be accepted
until its remaining awake-time idle budget elapses; the same applies to a
cached authentication proof. A stolen session credential may thus remain usable
longer in wall time on a sleeping host. Lockout windows also retain their
remaining awake-time delay. Normal absolute expiry checks still see wall time
advance across sleep, provided the host clock is correct.
The startup projection also excludes suspended time; a later wall rollback can
therefore undo expiry that only the wall clock observed during sleep, just as
correcting a forward jump can. It cannot undo expiry reached by that projection.

Node 22 exposes no portable suspend-inclusive `CLOCK_BOOTTIME` clock without
native code. Counting positive wall deltas below a 24-hour bound would also
count ordinary forward clock corrections and could expire active sessions,
while still missing longer sleeps and sleep combined with rollback. We choose
the documented awake-time behavior to preserve isolation from clock changes.
Deployments requiring wall-time idle limits across sleep should prevent host
suspend or invalidate sessions on resume outside this clock guard.

## Literal subtraction sweep

This accounts for every original `Date.now() - x` expression in
`packages/server/src` and `packages/store/src`, including telemetry and calendar
cutoffs. Line numbers below refer to the starting revision, before this change.
Repeated expressions in a row have the same clock-domain decision.

| Original location | Expression / purpose | Decision |
| --- | --- | --- |
| `server/src/oidc.ts:596,607` | discovery and signing-key cache ages | Monotonic, including timestamp producers. |
| `server/src/pii.ts:178` | classification cache age | Monotonic. |
| `server/src/metrics.ts:173` | health uptime | Monotonic; the exported Unix start time has a separate wall timestamp. |
| `server/src/inbound-hooks.ts:286` | bad-call rate window | Monotonic, along with rate buckets and replay-cache retention. |
| `server/src/cluster.ts:646` | worker stability before resetting crash count | Monotonic. |
| `server/src/notifications.ts:95` | test-notification throttle | Monotonic; first use is not suppressed near process startup. |
| `server/src/debug.ts:180` | abandoned debugger idle expiry | Monotonic. |
| `server/src/mcp.ts:213,256` | remembered password proof TTL | Monotonic. OTP proof itself is operation-scoped, with no timed cache; existing one-use OTP tests remain. |
| `server/src/admin.ts:553` | passkey failure window | Monotonic, like password failures and admin sign-in caches. |
| `server/src/automations.ts:363` | automation definition cache age | Monotonic. |
| `server/src/assistant.ts:631,656` | provider-health TTL and credit-warning retention | Monotonic; these internal times are not displayed. |
| `store/src/store.ts:1327` | this process's read-your-writes window | Monotonic. |
| `store/src/store.ts:1329` | shared read-your-writes window | Kept wall time: the timestamp is written by other processes to SQLite and survives restart. The shared producer also remains wall time. |
| `store/src/store.ts:3375,3410` | password maximum age / days left | Guarded absolute time: password-change date is persisted. |
| `store/src/store.ts:3755,3778` | account/object usage flush intervals | Monotonic. |
| `store/src/store.ts:4085` | persisted WebAuthn challenge age | Guarded absolute time. |
| `store/src/calc.ts:813,837` | shared-result claim renewal cadence | Monotonic local cadence; the persisted claim deadline remains epoch time. |
| `store/src/errors.ts:53,88` | event-loop work budget and time left | Monotonic. |
| `server/src/change-impact.ts:165` | log lookback cutoff | Kept wall time: queries historical log dates. |
| `server/src/backup.ts:319` | newest backup age | Kept wall time: compares filesystem `mtimeMs`. |
| `server/src/replication.ts:101` | recent-standby status listing | Kept wall time: informational filtering of public epoch `at` timestamps; does not authenticate, disconnect, or extend a session. |
| `store/src/store.ts:3181` | unused-account lookback | Kept wall time: persisted audit history. |
| `store/src/store.ts:3259,3306` | unused-token / least-privilege report lookbacks | Kept wall time: persisted daily usage. |
| `store/src/store.ts:3831,3842` | usage retention cutoffs | Kept wall time: persisted calendar days. |
| `store/src/store.ts:3859` | usage report day range | Kept wall time: persisted calendar days. |
| `store/src/store.ts:4016` | deleting old WebAuthn challenge rows | Guarded epoch time, matching challenge issuance and acceptance. |
| `server/src/ai-usage.ts:179` | daily usage retention | Kept wall time: calendar-day data. |
| `server/src/schedules.ts:515,519,567,572,608` | completed run duration telemetry | Kept wall time: reporting only, no expiry/security decision. |
| `server/src/inbound-hooks.ts:337` | completed hook duration telemetry | Kept wall time: reporting only. |
| `server/src/automations.ts:405` | completed automation duration telemetry | Kept wall time: reporting only. |
| `server/src/admin.ts:1823` | script test-run duration telemetry | Kept wall time: reporting only. |
| `server/src/connections.ts:1121` | connection-test duration in message | Kept wall time: reporting only. |
| `server/src/digests.ts:369` | digest run duration telemetry | Kept wall time: reporting only. |
| `server/src/backup-verify.ts:132,180,220` | restore/set-check duration telemetry | Kept wall time: reporting only. |

The comment at `store/src/store.ts:3178` discusses arithmetic overflow in a
calendar cutoff; it is not another runtime duration check. Kept telemetry can
still report a misleading duration during a wall-clock adjustment.

## Additional duration checks found through aliases and deadlines

The sweep also inspected `const now = Date.now()`, stored deadlines, and their
producers/consumers; changing only literal subtraction expressions would leave
the original session vulnerabilities intact.

| Location | Changed to monotonic time |
| --- | --- |
| `server/src/dataapi.ts` | REST/web idle expiry, last activity, idle reporting, account-cap eviction ordering, sweep cadence, failed-sign-in log limiter. API-token session wrappers still validate their persisted token on each request. |
| `server/src/admin.ts` | Console cookie idle expiry/renewal, Basic password cache, password/passkey failure windows, lockout pruning, one-use console passkey challenge expiry. |
| `server/src/adminapi.ts` | Bearer idle expiry and absolute eight-hour **in-memory** maximum lifetime, including token-slot pruning. |
| `server/src/oidc.ts` | In-memory AI resume closure expiry and pruning. SQLite pending/grant expiry stays guarded epoch time. |
| `server/src/mcp-tokens.ts` | Throttling of last-used writes; the written date remains wall time. Bearer credential expiry uses the absolute guard. |
| `server/src/sql.ts` | Basic-auth password cache TTL. |
| `server/src/oauth.ts` | Dynamic-client registration rate window. Persisted client creation/usage dates remain wall time. |
| `server/src/surface-access.ts` | Failed-sign-in log rate window and repeat-success suppression. |
| `server/src/inbound-hooks.ts` | Per-address/per-hook rate limits and signature replay-cache retention. Signed request timestamp validation remains protocol wall time. |
| `server/src/connections.ts` | In-memory provider OAuth access-token cache lifetime. |
| `server/src/schedules.ts` | Backup-destination status cache TTL. Calendar schedule execution remains wall time. |
| `server/src/automations.ts` | Transaction settle wait limit. |
| `server/src/changes.ts` | Long-poll wait budget. |
| `server/src/containers.ts` | Failed preview-worker cooldown/backoff. |
| `server/src/semantic-find.ts` | Semantic scan time limit. |
| `server/src/pgcatalog.ts` | Regex elapsed-work budget/reset window. |
| `server/src/warmer.ts` | Maximum debounce wait. |
| `store/src/store.ts` | Password/TOTP/address failure windows and cooldowns; passkey challenge rate limiter; audit-settings cache; denial sampling, retry and append budgets; AI-refusal log throttle; cadence for publishing shared read-your-writes timestamps. |
| `store/src/calc.ts` | Local summary/SQL-result TTLs and shared-result wait limit. |
| `store/src/durable.ts` | Local state-lock acquisition budget (rounded to integer SQLite milliseconds). |
| `calc/src/javascript.ts` | Sandbox reply wait and failure cooldown. |
| `store/src/text-styles.ts` | Formatting cache recheck intervals. |

Other wall-clock uses intentionally remain:

- `store/src/activity.ts` record/view leases and `results.ts` claims use public
  or shared persisted epoch timestamps; they are not authentication sessions.
- `store.ts` account-import rate windows are persisted and shared across
  workers; they cannot use a process-relative monotonic origin.
- `odata.ts` / `odata-crossjoin-worker.ts` exchange an epoch deadline across
  processes. The parent separately enforces a `setTimeout`/kill bound. These
  are query execution jobs, not authentication caches.
- TOTP time steps and inbound-hook signed timestamps interoperate with other
  machines and stay protocol wall time. Certificates/ACME/local TLS expiry,
  calendar schedules, restore-point validation,
  audit/usage reports, and filesystem dates likewise remain epoch time.
- `server-queue.ts`, `stats-log.ts`, `profiler.ts`, replication/standby status,
  log entries, and public start/last-used/client timestamps are reporting
  values. Their presentation does not govern sign-in validity.

## Verification

F1 regressions were run before fixing their issuance paths: rollback issuance
failed for API tokens through both HTTP routes, MCP tokens, OAuth, OIDC,
container URLs, import previews, WebAuthn challenges, password creation/reset,
and the CLI. The F2 clock and API-token regressions also failed before the fixed
startup reference was implemented. Tests drive wall and monotonic time
independently, including a one-hour rollback followed by issuance of a 30-minute
token, acceptance just before its deadline, and rejection at equality.

Final `npm run typecheck` passed for both the root and web TypeScript projects.
The focused clock run passed **17 tests, failed 0, skipped 0**. The requested
session, Data API, OIDC, OAuth, Admin API, lockout, API-token and store-clock
suites (also including MCP authentication and token scope) passed **412 tests,
failed 0, skipped 0** on Node 22.22.2 with concurrency 2:

```sh
npm run typecheck
node --test --test-concurrency=2 \
  packages/server/test/*session*.test.ts \
  packages/server/test/dataapi*.test.ts \
  packages/server/test/*oidc*.test.ts \
  packages/server/test/adminapi*.test.ts \
  packages/server/test/*lockout*.test.ts \
  packages/server/test/mcp-signin-parity.test.ts \
  packages/server/test/api-tokens.test.ts \
  packages/server/test/token-file-scope.test.ts \
  packages/server/test/oauth.test.ts \
  packages/store/test/lockout.test.ts \
  packages/store/test/clock.test.ts
```

Related CLI token-expiry, password-policy, passkey, account-provisioning,
container-URL and security suites passed **42 tests, failed 0, skipped 0**:

```sh
node --test --test-concurrency=2 \
  packages/cli/test/token-expiry.test.ts \
  packages/store/test/password-policy.test.ts \
  packages/store/test/passkeys.test.ts \
  packages/store/test/account-provisioning.test.ts \
  packages/server/test/container-urls.test.ts \
  packages/server/test/security.test.ts
```

This worktree had no fixture link. Tests used a temporary source mirror with
existing fixtures; all 1,385 package files were compared against the worktree
and matched. No fixture files were modified. HTTP tests required permission to
bind temporary localhost listeners.
