# Round-two credential review (r26-05)

Review date: 2026-10-18. This is a diff-driven review of the supplied main-based checkout, with a 2026-10-16 cutoff. Three demonstrated failures were fixed. Existing credential dataflow, redaction, transport-capability, OAuth and IdP protections were retained.

Only synthetic/generated data was used. No customer corpus or fixture content was opened. No dependencies, commits, pushes, service operations or external network commands were added or executed. Historical Git reads were limited to the item's explicit review exception. All test subprocesses inherited the audit runner's stub PATH; forbidden-command marker count was zero.

## History and scope

Discovery used `git log --since=2026-10-16 --merges -- <paths>`, followed by `--first-parent` to distinguish PRs merged into this checkout from main being merged into feature branches. Each relevant change was compared with its first parent using `git diff <merge>^1 <merge> -- <paths>`, with associated tests inspected. The path set included:

- `packages/scripts/src/{credentials,redaction,sigv4}.ts`
- `packages/plugins/src/secrets.ts`
- `packages/server/src/{oauth,oidc,scim,ldap,encrypt,connections,ai-output,debug,script-for-model}.ts`
- `packages/store/src/webauthn.ts`

Follow-through reads included the changed engine, recorder, MCP, summary and durable-state code and their tests. The broader package history was used for discovery, not treated as a request to audit unrelated features.

The first-parent path inventory contains 22 PR merges: #1293 `dd90de46c`, #1305 `1626418b8`, #1297 `9c3dfd8a9`, #1289 `aa6cccec7`, #1213 `db7279d56`, #1271 `9b524c2bc`, #1212 `a3fb4baab`, #1243 `81cb091bd`, #1242 `6f65c846d`, #1236 `74bc8d8b1`, #1232 `92f83dab3`, #1198 `c758d660b`, #1190 `7111d9ef6`, #1187 `4012245ef`, #1207 `e61eee842`, #1156 `e4d445652`, #1177 `8801ef6e4`, #1160 `e85f69cb0`, #1143 `8466beba6`, #1147 `34b9fe20e`, #1142 `a871c45f7`, #1153 `edc90a2d4`.

No first-parent PR merge for r22-01, r25-05, r25-09 or r22-11 appears in this checkout's cutoff history. Searching other refs finds feature-branch integration merges, which do not establish that those items landed on main. Their proposed changes are not represented here as reviewed merged PRs. Password hashing, encrypted-file authentication, WebAuthn and SigV4 received baseline checks; those checks do not certify the absent conformance work.

## Invariants and attempts

`New` identifies adversarial tests added in this review; `baseline` identifies retained tests from main. A passing result means the stated attempt held, not a proof against all possible inputs.

| PR | Invariant | Test tried | Result |
| --- | --- | --- | --- |
| #1147 | A malformed plug-in secrets file must not disclose its contents through an exception. | New: 3 malformed-input shapes, read and write paths, initial and cached reads; inspect messages, stacks and chained causes. | **Failed before; fixed.** Parser excerpts and causes are removed at the secrets boundary; source bytes remain unchanged. |
| #1147 | A recovery copy of secret state must remain private to its owner. | New: malformed mode-0600 input under umask 0022; inspect the generated recovery copy's bytes and mode. | **Failed before; fixed.** New recovery copies are created with mode 0600. |
| #1142 | Stored summaries must hide copied credentials under the same case-insensitive policy as model record reads. | New: 5 pairs covering non-ASCII case, whitespace, UTF-16 length thresholds and embedded copies; compare stored and unstored group/measure paths with record output and ordinary summaries. | **Failed before; fixed.** SQL summary matching now calls the shared JavaScript predicate; counts and ordinary summaries remain available. |
| #1293 | Credential inputs discovered through assignments must be hidden before diagnostic emission without changing script results. | New: Unicode variable names, repetition 2, nested Let aliases, URL construction and a failing layout step; inspect debugger state, watches, traces, profile and ScriptErrors.log. | Held; execution retains the real result, all inspected diagnostic sinks mask it. |
| #1293 | A custom fetch callback must require the internal per-run test capability. | Baseline: real child processes with unset and forged NODE_TEST_CONTEXT, alternate engine entry points, CURL and plug-in requests, copied options and forged symbols. | Held; the existing implementation was retained. |
| #1289 | Credential-learning limits must fail closed without confusing URL scaffolding with secrets. | New: 2,500 Unicode values through each independent budget; percent-encoded Unicode and punctuation-bearing userinfo; check host and ordinary-message visibility. | Held; no redaction implementation change. |
| #1289 | Limited MCP accounts must not receive Full Access script traces. | Baseline: restricted field read inside a Full Access script, compared under limited and Full Access identities, with trace on and off. | Held. |
| #1207 | Runtime and stored credential values must stay out of diagnostic snapshots and error messages. | New log/trace/profile/watch case above; baseline standalone current/evaluate, thrown errors, recordings, old values and pre-clipping snapshots. | Held. |
| #1242 | URL credential detection must remain bounded on long attacker-controlled text. | New: 20,000 mixed invalid-scheme/Unicode-separator segments with absent, password and username-only credential suffixes; baseline long-colon and long-letter scans. | Held; new timing ceiling is 3 seconds with ample observed headroom. |
| #1213 | MBS CURL credential arguments must taint their source aliases. | New: Unicode source alias passed through Let into AWS credential arguments without making a request. | Held. |
| #1190 | Compatibility-form and decomposed credential field names must still be hidden while ordinary names remain usable. | New: 4 name variants and 3 ordinary-name controls. | Held. |
| #1198 | Clock rollback must not extend authorization-code validity, and token replay must remain single-use. | New: exact five-minute code boundary during rollback; competing exchanges across 2 OAuth handlers, reopening before exchanges, wrong client, Unicode account and MCP surface restriction. | Held. |
| #1198 | JWT verification must keep issuer, audience, nonce and expiry checks when its key cache is reused. | New: generated EC keys, unknown-kid rotation, 3 wrong bindings and a forward expiry jump; assert 2 JWKS fetches. | Held; real guarded JWKS fetch uses a loopback stub. |
| #1236 | Connector and LDAP transports must reject metadata addresses before sending credentials. | New: 3 equivalent numeric metadata-host spellings on both transports; JWT/JWKS also exercises the guarded IdP path. | Held; no external endpoint was contacted. |
| #1156 | Registration JSON must be bounded and reject malformed shapes without quoting submitted material. | New: non-object JSON, depth 65 and an oversized body, followed by valid registration. | Held. |
| #1160, #1177 | Interleaved vault mutations must retain unrelated secrets and not resurrect deleted connections. | New: 2 independent instances, 2 connections, rotation, deletion and reopening; inspect logs and ciphertext. Baseline durable-state tests also exercise interleaved child-process writers. | Held. |
| #1297 | Renamed public surfaces must continue to enforce authentication while data-at-rest names remain compatible. | New tests reopen OAuth, SCIM and connector state; baseline diagnostics and SCIM group operations use `/tabularius/` routes; connector tests use `TABULARIUS_SECRETS_KEY`. | Held for exercised surfaces; no blanket rename. |
| #1305 | SCIM discovery must point at the renamed public documentation. | Read-only diff inspection of documentationUri. | Link-only change; no credential invariant changed. |
| #1243 | Cached diagnostic credential scans must invalidate after writes and avoid stale transaction state. | Baseline standalone diagnostic tests cover write invalidation, an open transaction and rollback. | Held; no second fix. |
| #1232 | Model preview secret discovery must collect stored credential values within its stated scan bound. | New: Unicode credentials across 2 tables and a global field, case-changed copies and an ordinary-value control. | Held; this review does not certify preview discovery beyond its 20,000-row-per-table bound. |
| #1187 | OIDC callback bodies must use the shared bounded body reader. | Read-only diff review; the new oversized OAuth registration case exercises the shared reader through another authentication route. | Shared reader held; fixture-backed OIDC callback integration suite was not run. |
| #1271, #1153 | Diagnostic input/error formatting must not bypass credential masking. | Baseline diagnostic error and route tests plus new failing-script log/trace case. | Held for tested sinks; changes were input formatting and malformed-path classification. |
| #1212, #1143 | Scratch diagnostic work must retain isolated session and container-access behavior. | Read-only relevant diff review; baseline recording endpoint leaves hosted records unchanged. | No credential-specific change to fix; broader JavaScript/container behavior is outside this review. |
| No new core merge: crypto baseline | Password hashing must distinguish full Unicode/NUL-containing passwords and produce independently salted hashes. | New: 2 hashes, synchronous/asynchronous verification, truncation, normalization and suffix alternatives. | Held; no hashing change. |
| No new core merge: crypto baseline | Authenticated file encryption must reject the wrong key and modified ciphertext. | New: generated binary/Unicode payload round trip, wrong key, changed final byte. | Held; no encryption change. |
| No new core merge: WebAuthn/SigV4 baseline | Signatures must bind the expected request or authenticator context. | Baseline synthetic WebAuthn key/challenge/origin/counter/RP cases and SigV4 request/body/canonical-query vectors. | Held; no crypto implementation change. |
| No new core merge: SCIM baseline | Rotating or revoking one file's provisioning token must not affect another file's token. | New: 2 files, rotation, reopening, invisible Unicode suffix and revocation; baseline protected-member rollback tests. | Held. |

## Fixes and validation

- `packages/plugins/src/secrets.ts`: discard parser details and chained causes at the secret-file boundary.
- `packages/store/src/durable.ts`: create new damaged-state copies with private permissions.
- `packages/server/src/summarize.ts`: use the existing model-output secret-copy predicate inside SQL summaries, registered once per Store through a WeakSet.
- Regression tests live in `packages/plugins/test/secrets.test.ts` and `packages/server/test/review-round2-credentials.test.ts`; other new adversarial cases are in the scripts, OAuth and IdP round-two test files.

The initial plug-in regression run had 5 passes and 2 failures; the initial summary/SCIM run had 1 pass and 1 failure. All 3 demonstrated failures passed after their fixes. Test-development failures caused by a repetition spelling, cleanup API and constructor argument were corrected in tests; they were not counted as product defects. Loopback tests initially encountered sandbox EPERM and were rerun with approved loopback access.

Reproduce the small CI profile with:

```sh
node scripts/audit-review-round2-credentials.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

The runner invokes Node with `--test-concurrency=2 --test-timeout=60000`, a generated stub PATH and a forbidden-command marker assertion. It contains no fixture-dependent suites. Optional positional file paths select a smaller subset. Service, git, npm, curl and sudo stubs write a marker and exit 99; the runner fails if any marker exists.

The final complete profile passed 228 tests with 0 failures, 0 skips and 0 cancellations in 39.5 seconds. A subsequent run of `node scripts/audit-review-round2-credentials.ts packages/server/test/review-round2-credentials.test.ts` passed 7 tests with 0 failures, including the additional preview-discovery case (229 distinct passing tests across the two runs). The default profile now includes that additional case. Typechecking passed with 0 diagnostics. All data sizes fit the small profile; no larger-runner workload or additional hardware is required for these checks. Native Windows execution and large-scale production performance were not measured.

A separate read-only reviewer (before this port) inspected all three production fixes and surrounding APIs after implementation, read-only. It reported no actionable findings. It checked SQL function registration/inspection behavior, parser-cause handling and exclusive private recovery-copy creation. It did not independently rerun tests.

Existing recovery copies are not migrated or deleted. Full external IdP vendor conformance, native Windows filesystem behavior, and the absent r22-01/r25-05/r25-09/r22-11 branch changes remain unverified. No statement here claims undocumented Claris behavior is documented. <!-- known-difference: Privileges and security ;; Whether external identity providers, native Windows file systems and FileMaker's credential handling behave as this review assumes is not settled ;; Nothing shows; the report claims no undocumented Claris behaviour ;; A run against external identity providers on Windows, and a FileMaker run of the same credential checks -->
