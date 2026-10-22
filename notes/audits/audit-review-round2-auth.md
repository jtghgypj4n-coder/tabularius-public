# r26-01 — second-round authentication review

Review date: 2026-10-18. Scope: sign-in, lockout, sessions, tokens, passkeys, OIDC/SCIM and administrator authentication. Six defects were reproduced and fixed. Existing monotonic clocks, identity generations, MFA enforcement, bounded challenge storage and token revocation were retained.

## Method

The review started from text searches over the sign-in, lockout, session, token, passkey, OIDC, SCIM and administrator-authentication code and compared each change in those areas with the behaviour it was meant to keep. Shared files (store, Data API, console, cluster, pgwire, MCP and OData sources) also hold unrelated changes; their presence is not evidence of a new authentication invariant, so only authentication hunks and their tests were reviewed. The tables below record implementation invariants, not claims about compatibility with the original product: parity for these adversarial cases is **unverified**.

## Invariants and attempted counterexamples

Test abbreviations refer to the new files: **store** = `packages/store/test/auth-review-round2.test.ts`; **HTTP** = `packages/server/test/auth-review-round2.test.ts`; **cluster**, **OIDC**, **SCIM** = the corresponding `auth-review-round2-*.test.ts` server files. “Held” means the stated probe passed, not exhaustive proof.

| Area | Invariant, one sentence per claim | Test tried | Result |
| --- | --- | --- | --- |
| Address spellings in lockout | Equivalent IP spellings must consume the same account/address failure budgets. | Store: compressed, padded, uppercase, scoped and IPv4-mapped IPv6; HTTP: alternate spellings while mixing Data API, OData, SQL and MCP. | **Broke; fixed F1.** Existing canonical-address cases alone did not cover these variants. |
| Long account names | A successful sign-in to a distinct account must not clear another account's failure counter. | Store: two accepted names with the same first 128 characters; interleave failures and successes, then unlock only the other name. | **Broke; fixed F2.** |
| Unicode-equivalent names | Unicode equivalents must share a failure budget without merging unrelated accepted names. | Store/HTTP: compatibility letters, sharp-s, soft hyphen and invisible/variation characters, plus distinct long names. | Folding **held**; truncated downstream key failed as F2. Original provisioning/Unicode tests also pass. |
| Legacy account-name collisions | Legacy account-name collisions must be diagnosable without silently changing their identities. | Read warning/grouping diff and test; rerun `host-lockout-pairs.test.ts`; new Unicode and long-name tests exercise the same folding boundary. | **Held** for the tested collisions; warning behavior unchanged. |
| Asynchronous password proof | An asynchronous password proof must still belong to the same active, password-enabled account and verifier when accepted. | Store: mutate through a second SQLite connection while scrypt awaits; reset, delete, recreate, recreate with the exact old verifier, disable password, deactivate. | **Broke; fixed F3.** Deactivation alone already held and was retained. |
| Federated session identity | Existing local and federated sessions must not inherit a replacement account's identity. | HTTP: delete/recreate both local account and external mapping through a peer; test REST and web session classes. | **Held.** |
| Idle expiry clock | Idle expiry must use elapsed time and honor edited timeout settings for sessions already open. | HTTP: forward/backward wall jumps, advance monotonic time, lower REST timeout, then make web timeout inherit it; rerun session/store clock suites. | **Held.** |
| Token revocation persistence | Persisted token revocation must survive reopening while in-memory sessions must not. | HTTP: revoke store API and MCP tokens, close/reopen the host/token manager, retry old credentials. | **Held.** |
| Cluster routing of Basic sign-in | Changing a Basic password or HTTP surface must not select a fresh worker's account failure budget. | Route matrix: 2/3/4/16 workers, folded names, changing passwords, whitespace in base64, unrelated headers; real two-worker Data API/OData guesses. | **Broke; fixed F4.** |
| Cluster routing of logout | A successful session logout must reach the owner of the session identified by the handler. | Unit and two-worker tests: percent-encoded session path, trailing/repeated slashes, mismatching Bearer/access-token/Basic headers; retry ended token. | **Broke; fixed F5.** |
| pgwire disconnect during verification | A pgwire disconnect during asynchronous verification must not acquire a signed-in slot after close. | HTTP test helper: real socket, hold verification, observe server-side disconnect, resolve verification, inspect slot acquisition. | **Held; no pgwire production change.** |
| pgwire and HTTP shared budget | Hosted pgwire and HTTP guesses in one process must count against the same account budget. | HTTP: alternate pgwire and Data API failures using equivalent IP forms, then try the correct pgwire password. | **Held.** Cross-process limitation below. |
| Passkey ceremony capacity | Capacity pressure and wall-clock changes must not evict a live passkey ceremony or apply stranger caps to authenticated registration. | HTTP: edit per-address cap, alternate IPv6 spellings, jump wall time, consume the existing ceremony, advance elapsed time to expiry, issue authenticated registration. | **Held.** Existing bounded lockout saturation/window-edit tests also pass. |
| OIDC pending-state bounds | OIDC pending state must remain bounded without evicting live sign-ins when another handler reaches capacity. | OIDC: seed 1,999 synthetic rows transactionally; race two handlers for the last slot; verify exactly 2,000 rows and unchanged live state; advance to expiry equality and retry. | **Held:** one accepted, one refused, then expired capacity recovered. The earlier change itself only improves the original test's transaction/cleanup. |
| OIDC single use | Persisted OIDC state/grants must be single-use across handlers and reject an expired grant at equality. | OIDC: reopen a handler; simultaneous denied callbacks consume one state once; grant success, replay, wrong identifier then correct identifier, exact expiry. | **Held.** |
| Federated credential rights | Federated sessions must retain a revocable mapping/person identity and cannot acquire local credential-management rights. | New peer mapping recreation test; rerun `signin-parity.test.ts` trusted-email and credential-management checks with a generated local provider. | **Held** for these cases. No public provider was contacted. |
| Cached MCP password | A cached MCP password must stop authenticating after a peer changes security state, independently of wall-clock rollback. | HTTP: warm MCP cache, reset password through a second connection, roll wall time back one day, retry old and new passwords. | **Held.** Existing MFA/replay and revoked-token loopback tests also pass. |
| Password-only surfaces and second factor | A password-only surface must enforce the account's current second-factor requirement. | HTTP: warm OData/SQL password caches, enable MFA through a peer, retry those surfaces and pgwire without a second factor. | **Held.** |
| SCIM group replacement | A SCIM group replacement must atomically commit its membership/privilege changes and release any transaction it owns. | SCIM: successful update read by peer and after closing/reopening; injected failure after privilege removal; another peer writes immediately; caller-owned outer transaction succeeds/fails then rolls back. | **Broke; fixed F6.** Original tests only inspected the writer connection. |
| Directory identity mapping | Directory authentication must map the verified directory identity rather than a privileged typed name. | Rerun synthetic `ldap-scim-signin.test.ts`; read its implementation/test diff. | **Held** in the existing regression; a live LDAP server was not exercised. |
| Console cookie and Admin API token | A console cookie must not substitute for Basic credentials when minting an Admin API token, including malformed route/method variants. | HTTP: valid cookie plus wrong password; GET, trailing slash, percent-encoded route and exact POST; check no token and `nosniff`. | **Held.** |
| Shared administrator budget | Console and Admin API failures must share the administrator budget while an already authenticated cookie remains usable. | HTTP: alternate both login endpoints and IPv6 spellings with a valid cookie attached; check blocked login and existing-cookie passkey listing. | **Held** after common F1 fix. |
| Browser metadata and Admin API tokens | Untrusted browser metadata must not mint Admin API tokens using cached Basic credentials. | Rerun synthetic Admin API token tests: cross-origin formats, Fetch Metadata, configured proxy origin, slot exhaustion attempts; route variants above. | **Held** for existing and route probes. |
| Account-bound signed URLs | A signed account-bound URL must not become valid for a recreated account with the same name. | HTTP file: names with Unicode and URL delimiters, peer recreation, reopen host with the same cluster signing key; unrelated account's URL remains valid. | **Held.** |

Other focused history matches were triaged by their changed hunks:

| Area | Invariant or scope disposition | Test tried | Result |
| --- | --- | --- | --- |
| Renamed public interfaces | Renamed public interfaces must retain authentication behavior without renaming at-rest state. | All new HTTP tests use `/tabularius/` and `x-tabularius-*`; persistence tests retain `.openhbam-*` names. | **Held** for exercised interfaces; no blanket replacement. |
| MCP last-used updates | MCP last-used updates must preserve durable token state; a diagnostic hook must not change authentication. | Read durable-update/hook diffs; token revocation/reopen probe and existing MCP regressions. | Revocation **held**; administrative passkey file-lock contention was not independently stress-tested. |
| Login body handling | Login body handling must remain bounded and catch asynchronous refusal. | Read Admin API/OIDC body-handling changes; new wrong-credential and OIDC refusal tests plus existing Admin API regressions. | Refusal probes **held**; slow-body transport exhaustion was outside this round's new tests. |
| OIDC outbound guard | OIDC provider requests use the shared outbound size/time guard. | Read discovery/token/key-fetch replacements; local generated provider exercised by OIDC and existing parity tests. | Normal guarded flow **held**; outbound network policy is not re-audited here. |
| Admin API in-flight release | Authenticated Admin API work releases its in-flight reservation. | Read `try/finally` change; existing Admin API requests and new refusal probes. | No regression observed; exhaustive in-flight saturation not newly tested. |
| Test-only timing changes | Test-only changes adjust timing comparison or an expected protocol error code. | Read changed tests; synthetic async-password and passkey tests here. | No new implementation invariant; fixture-dependent timing test not run. |
| Schedule, backup and layout changes | Matching hunks concern schedule text/backup settings/timestamps, native file metadata, responsive layouts, schedule paths or XML capability reporting rather than a new authentication mechanism. | Read matching diffs; retained existing behavior. | No authentication fix warranted. |

Broader shared-file matches (record and lock consistency, restore-account comparison and approval, audit date presentation) were not treated as sign-in invariants or changed. Restoration approval and general record concurrency are not certified by this report.

## Fixes

| Finding | Reproduced failure | Correction | Regression evidence |
| --- | --- | --- | --- |
| F1 — equivalent addresses split lockouts | Padding and alternate IPv4-mapped/scoped IPv6 forms selected separate counters. | Canonicalize valid IPv6, map IPv4-mapped addresses to IPv4, then derive account keys and IPv6 /64 budgets; retain local-address exemption. | Store address matrix and cross-route HTTP/admin budgets. |
| F2 — long-name counter collision | An attacker-controlled distinct account sharing a 128-character prefix cleared a victim's failures through successful sign-ins. | Keep short keys; use bounded prefix plus SHA-256 of the folded long name in a disjoint-length namespace. | Real accepted long accounts, alternating success/failure and isolated unlock. |
| F3 — stale asynchronous password proof | A proof begun before reset, deletion, recreation or password-disable could authenticate afterwards. | Read identity and verifier eligibility in one SQLite snapshot, then compare both after hashing; initialize legacy identity before taking the proof. | Six mutation cases, including replacement with the exact same verifier to isolate identity protection. |
| F4 — worker selection bypass | Hashing the whole Basic credential let changing passwords and surfaces select fresh worker budgets. | Route Basic sign-in by the common folded account; preserve actual token-first handlers and OAuth leader routing. | Route matrix plus real two-worker mixed-route guesses. |
| F5 — logout went to wrong worker | A header-selected worker could report logout success while the decoded path's session remained alive elsewhere. | Route Data API DELETE by its decoded path session before unrelated headers. | Owner routing matrix and actual token refusal after two-worker logout. |
| F6 — SCIM transaction leak | Releasing the savepoint neither committed nor rolled back the outer transaction owned by `setMembers`; peers saw stale rights and the writer stayed locked. | Commit owned transactions on success; roll them back after savepoint rollback on failure; preserve caller-owned transactions. | Three tests: durable success, injected partial failure/writer release, nested transaction preservation; before fix 1 passed/2 failed, after fix 3 passed. |

A reviewer from a different model reviewed the fixes read-only. Its intermediate findings prompted corrections to token-vs-Basic precedence, OAuth route normalization, atomic password snapshots and logout ownership. The final review reported no new actionable findings, including the SCIM transaction change. The reviewer did not independently run tests.

## Validation and CI profile

Run from the repository root with the existing Node/dependencies:

```sh
node scripts/test-auth-review-round2.ts
node scripts/test-auth-review-round2.ts --regression
node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
```

The runner invokes Node with `--test-concurrency=2`. It supplies a trap-only PATH for `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl` and `sudo`; each stub writes a marker and exits 99, and any marker fails the run. The real-cluster test also installs its own traps before spawning workers. This is an execution tripwire, not a general network sandbox. Test network traffic is synthetic loopback HTTP/pgwire/OIDC only. No service, installation, upgrade, git-pull or external network command is part of the profile.

The default profile is small: five new test files, two cluster workers, at most 2,000 generated OIDC rows, temporary generated databases and no corpus. It requires a Node environment supporting the repository's TypeScript/SQLite setup, available loopback sockets and child processes. No larger-runner script is needed for the selected workload. It was run on macOS with Node 22.22.2; Windows/Linux execution remains unverified. The cluster test has a 120-second ceiling and a 20-second worker-restart allowance; observed normal runs are seconds, with ample timing headroom. New per-file runs remained below 60 seconds.

| Command/profile | Outcome |
| --- | --- |
| Default synthetic audit profile | **30 passed, 0 failed, 0 skipped; command guard clean; about 5 seconds.** |
| `--regression` (12 existing synthetic test files) | **107 passed, 0 failed, 0 skipped; command guard clean.** |
| TypeScript check | **Passed, no diagnostics.** |
| Earlier broader regression attempt including `session-timeout.test.ts` | 111 assertions passed, 0 assertion failures, but the **command guard failed**: the existing admin-status path attempted optional Git version discovery. The Git stub ran; real Git did not. That file is excluded from the safe profile, and the new timeout-edit test exercises settings directly without the status path. |

## Limits and remaining behavior

- Failure counters remain process-local and volatile. The real cluster restart test confirms a replaced worker forgets its counters and old sessions. This review fixes HTTP Basic affinity, not distributed durable lockout storage. Per-address spray limits across different account owners and pgwire-on-leader versus HTTP-on-follower counters are not one global budget; single-process pgwire/HTTP sharing is tested.
- Persisted expiry uses the existing process-local epoch reference. Workers started on opposite sides of a clock correction, especially a restart during rollback, can disagree about persisted-token expiry. This is the existing limitation described in `docs/clock-audit.md`; no durable cross-process time floor is claimed or introduced.
- OIDC handler concurrency is exercised over independent database connections in one test process. The separate real-worker test covers routing, logout and restart, not a live external identity provider. Web-session checks exercise the server's web-session class, not a browser UI. Platform-specific address strings are covered, but actual Windows/Linux sockets are not.
- No corpus or customer files were opened. No fixtures or workflow files were changed. No dependency was added. Reports contain aggregate outcomes, not application data.
- The three requested unlocated item labels, live LDAP/provider integrations, fixture-dependent coverage and the explicitly noted ancillary stress cases remain unverified.
