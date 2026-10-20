# r19-06 — Stateful session sequence fuzz

Written against `main` at `46ade4661538`, then merged with `main` of 2026-10-18.

## Existing work retained

The initial `git grep main` found the following coverage. This item adds composition and lifecycle assertions rather than replacing these standalone suites:

- [session-clock.test.ts](../../packages/server/test/session-clock.test.ts): monotonic session expiry, wall-clock changes, absolute token expiry, and passkey challenge timing.
- [oauth.test.ts](../../packages/server/test/oauth.test.ts): authorization-code consumption, refresh rotation, revocation, and password-change checks at refresh.
- [api-tokens.test.ts](../../packages/server/test/api-tokens.test.ts): token revocation, expiry, and surface/layout scopes.
- [signin-lockout-retry-after.test.ts](../../packages/server/test/signin-lockout-retry-after.test.ts): password and passkey address lockout, unlock, and retry headers.
- [session-account-cleanup.test.ts](../../packages/server/test/session-account-cleanup.test.ts) and [sessions-admin.test.ts](../../packages/server/test/sessions-admin.test.ts): account identity cleanup and explicit session termination.

Fixture-backed suites were inspected as source only and were not executed. No customer files or corpus inputs were used.

## Added coverage

[session-sequence-harness.ts](../../packages/server/test/session-sequence-harness.ts) builds a fresh generated database with two accounts, independent private records, a forbidden secret field, and Reader/Writer privilege sets. It runs the real in-process HTTP server, local OAuth code/PKCE flow, and cryptographically valid generated WebAuthn assertions.

[session-sequence-fuzz.test.ts](../../packages/server/test/session-sequence-fuzz.test.ts) uses xorshift32 seeds `6406` and `12648430`. Each produces 34 operations: a mandatory operation-coverage prefix and a random suffix. Operations cover Basic, OAuth, passkey and API-token authentication; refresh; logout and two concurrent logouts; clock expiry; password reset; password lockout/unlock; disable/enable; token revocation; privilege reassignment; wall-clock rollback; and idle-policy edits. Requests connect only to `127.0.0.1`; two documentation addresses are passed through the configured trusted loopback proxy to exercise independent address accounting.

After every operation the independent model:

- Replays every captured access/session token from both addresses and every invalid refresh token. Consumed OAuth codes and passkey assertions are also replayed.
- Requires valid credentials to return their own records, denies old credentials, and checks read/write authority against the sign-in state.
- Checks response bodies and headers for generated secrets and captured credentials; checks both list and individual-record responses for another account's private data.
- Compares active-session count/list and exact account/address failure counters, and checks that invalidated sessions release locks and presence.
- Checks that duplicate logout cleanup executes exactly once.

Failure output contains the seed and a reduced sequence. Shrinking starts with the failing prefix, attempts deletion while preserving the same invariant failure, and is bounded to 40 attempts and a shared 40-second cutoff. It is a bounded reduction, not a promise of a globally minimal sequence. The shrinker has its own causal-pair test.

The harness uses the production expiry clock with injected wall and monotonic inputs. Its CPU-starvation watchdog is disabled because an injected hour is not an hour of blocked CPU time; real HTTP requests still have five-second abort deadlines. Test runs use a 55-second timeout. Each harness installs a stub-only PATH containing `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`, and `sudo`; each stub writes a marker and exits 99, and cleanup fails if that marker exists. Verification used the same guard around the test runner and disabled runner process isolation. No test launches a real external command.

## Defects addressed

| Defect / minimal sequence | Change and regression |
| --- | --- |
| Basic login → privilege reassignment → replay: an open session accepted the new authority. | Sessions retain a hash of sign-in credentials and authority. Changed authority requires reauthentication. Extended privileges are intersected with those present at sign-in, preserving live removal without allowing additions. Tests cover reassignment, edits to the assigned set, fresh login, and adding an extended privilege. |
| OAuth authorization or refresh → privilege reassignment → exchange/reuse: the grant could acquire authority assigned after sign-in. | Codes and refresh tokens bind identity, credentials and authority. Privilege changes revoke affected API tokens transactionally. Tests cover an unexchanged code, refresh, OAuth access, and service-token reuse. |
| Login → password reset → replay: existing sessions remained usable; OAuth access was issued with service-token provenance. | Password-derived sessions fail their next validation. New OAuth access uses delegated provenance and is revoked during password reset. Own-password repair preserves only the session that reauthenticated. Independent service tokens remain independent of the password. |
| Token authentication → revoke → replay: the cached session count remained one, retaining its resources. | A failed token lookup ends the cache entry for its owning database. Tests assert session counters, record-lock release, and presence cleanup for revocation and expiry. A wrong-database request still cannot end the owning session. |
| Disable → enable → replay: previously issued bearer tokens could become usable again. | Disabling rotates the account identity generation and revokes tokens bound to the account, mapping, or person. Tests verify that re-enabling permits fresh authentication without restoring captured credentials. |
| Authority changed and changed back (a privilege set assigned and reassigned, a set edited and edited back) → replay: a code, token or session made before the change matched again. | The sign-in mark carries a generation kept in the file (`_fm_sign_in_ledger`) that only rises. It is advanced inside the security change that commits (so it rolls back with it, and a failure to write fails the change) and on any later look, under the write lock with the state read again under it, so a change undone before anyone looked still counts and an older state is never recorded over a newer one. A mark that cannot be recorded matches nothing. A sign-in is forgotten when the next change settles after its account (a directory sign-in: its mapping) is gone; the person a directory sign-in names need not have an account here and does not decide it. The generations of the rows forgotten are folded into a floor (the `gen` of the ledger's `''` row) that every row made later starts above, so nothing issued before matches whatever is recorded after, even when a row was dropped that was still wanted; names are compared lower-cased the way the key is made. Regressions run unobserved there-and-back sequences and check every credential only at the end (`checkEach: false`). |
| An authorization code from before marks held authority (bound to the password only) was accepted after the account's authority changed. | A code must carry the current mark exactly; such a code lives a minute, so none outlasts an upgrade. Refresh tokens from before are still honoured once and rebound to authority. |

At startup, older OAuth grants whose persisted access tokens were classified as service tokens are relabelled delegated, so a password reset ends them from then on, and their refresh rows are rebound to the sign-in as it is. They stay connected. The migration follows the OAuth refresh-to-access association, not a token label, and leaves independently issued service tokens alone. A grant whose password already changed since cannot be vouched for and is ended. Codes and refresh tokens from before sign-ins were bound to authority are still accepted once if their password is unchanged. A generated persisted-grant regression covers this upgrade behavior.

[session-sequence-regressions.test.ts](../../packages/server/test/session-sequence-regressions.test.ts) contains 19 focused cases, including the cases above, failed security-batch rollback, clock and idle-policy edits, both address budgets, and repeated logout races. The failed-batch case verifies that credential/token invalidation and audit changes roll back together. Production changes add no unbounded persisted collection or new database column.

## Verification

All runs used `--test-concurrency=2` and targeted generated-input tests. Each listed file completed below 60 seconds.

| Check | Result | Measured duration |
| --- | --- | --- |
| New default sequence fuzz, two seeds plus shrinker test | 3 passed | 3.88 s |
| New focused regression file | 14 passed | 4.10 s |
| Extra seed `1`, plus shrinker test | 2 passed | 2.23 s |
| Existing generated Data API privilege matrix | 662 passed | 4.20 s |
| Existing session-clock tests | 13 passed | 0.58 s |
| Existing session-timeout tests | 4 passed | 0.71 s |
| Existing wrong-database session test | 1 passed | 0.53 s |
| Existing sign-in lockout/retry tests | 4 passed | 0.72 s |
| Existing security-audit transaction ownership and append-failure rollback cases | 2 passed | 1.09 s |
| TypeScript check of the new tests and their imported source graph | Passed | — |
| `git diff --check` | Passed | — |

The 55-second test deadline has more than three times the measured per-file runtime headroom. No wall-clock timing assertion depends on a narrow interval.

Run each new file independently:

```sh
node --experimental-test-isolation=none --test --test-concurrency=2 --test-timeout=55000 packages/server/test/session-sequence-fuzz.test.ts
node --experimental-test-isolation=none --test --test-concurrency=2 --test-timeout=55000 packages/server/test/session-sequence-regressions.test.ts
SESSION_SEQUENCE_SEED=1 node --experimental-test-isolation=none --test --test-concurrency=2 --test-timeout=55000 packages/server/test/session-sequence-fuzz.test.ts
```

## Scope and compatibility

These are Tabularius defensive invariants, not claims about Claris or other vendors. Claris behavior for these mixed lifecycle sequences, external identity-provider behavior, and hardware authenticator behavior were not established. The suite exercises local OAuth authorization-code/PKCE, not a vendor OIDC service; passkeys use generated P-256 authenticators. It covers one hosted file, two accounts and two simulated client addresses, not a multi-process cluster or cross-file privilege graph.

Password lockout remains an unauthenticated sign-in budget; it does not impose a new cap on authenticated sessions. Bearer tokens are tested from both addresses without assuming an IP-binding requirement. Privilege-set changes may require renewed sign-in and reissuance of affected API tokens, including when the change narrows authority. Idle-disconnect and comment edits alone do not revoke tokens.

No dependencies, workflow files, fixtures, publishing settings, tags, commits, or pushes were changed. The pre-existing untracked fixture entry was left alone.

## Independent review (Opus, before the pull request)

A review by a different model found these; the first three are fixed here with a test each:

1. **A service token could lock itself out.** A service token that changed its account's password through the Data API got a sign-in mark on its cached session, so a later administrator reset made every call 401 until a restart, against the rule that service tokens are independent of the password. Service-token sessions now carry no mark (`a service token that changed its own password…`).
2. **Upgrading signed out every OAuth grant**, not only the misclassified ones, because the mark formula changed. The migration now relabels and rebinds them instead (above), and codes and refresh rows with the old mark still verify while the password is unchanged.
3. **Design changes signed people out.** For a set defined by the FileMaker file, every field of a listed table is stored as hidden, so adding a field changed the sign-in mark. The mark now leaves out fields at the table's own default level (`authorityOf`, with a store test). A rename of a field the set can access still changes the mark. Also, storing the file's own default set as an account's explicit set no longer deletes its tokens.

Not changed, for you to know:

4. A file signed into with separate credentials at login (`fmDataSource`) reads that file's privileges live with no mark, so a password reset or privilege change in that other file does not end the session. This was so before this item; only disabling the account (which rotates its identity) takes effect.
5. In a multi-process deployment, `issue()` recomputes the mark instead of keeping the one it verified, so a password reset in another process between the check and the new token could leave that one access token (an hour at most) alive. Within one process the steps are synchronous.
