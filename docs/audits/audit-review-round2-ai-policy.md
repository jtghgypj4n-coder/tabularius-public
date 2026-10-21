# Round-two review: AI policy, redaction, MCP and agent tools

Date: 2026-10-18. Item: r26-02. Result: **two reproduced defects fixed**, with regression coverage; existing protections that held were retained. This is a Tabularius implementation review, not a claim about Claris behavior. Claris equivalence is **unverified**. <!-- known-difference: Privileges and security ;; Whether FileMaker's AI-visible data policy and redaction match this review is not settled ;; Nothing shows; the review makes no claim about undocumented Claris behaviour ;; A FileMaker run of the same policy and redaction checks -->

## Method and history

The initial search found the AI-visible policy, calculation dependency analysis, credential dataflow, account-scoped masking, offline MCP execution and their tests already on main. No replacement implementation or dependency was introduced.

History was read using the item's explicit read-only exception. Only `git log` was used: the requested merge inventory, then `--first-parent` to distinguish PR merges from branch synchronization merges, and `-m -p` to read each merge relative to its first parent. No commit, push, checkout, status or other git command was run.

```sh
git log --since=2026-10-16 --merges -- <paths>
git log --since=2026-10-16 --merges --first-parent --format='%h %s' -- <paths>
git log --since=2026-10-16 --merges --first-parent -m -p -- <paths>
git log --since=2026-10-16 --merges --first-parent --format='%h %s' --grep='r22-\|r25-02\|r25-05'
```

Core paths: `packages/server/src/{ai-output,ai-policy,ai-policy-sql,mcp,mcp-design,mcp-sync,assistant,agent}.ts` and `packages/scripts/src/redaction.ts`; follow-up checks included `pii.ts`, `ai-access.ts`, `ai-security.ts`, and the store/script paths changed by the named r22 merges. The core-path query returned **33 PR merges**. The named-item query added **#1291 and #1296**; #1300 was already present. **No r25-02 or r25-05 merge matched the date window.** The tables below inventory all 35, including incidental hunks without a new security behavior.

The area-specific diffs and relevant regression tests were read before writing the new probes. Existing fixture-backed tests were inspected as source only and not run. All executed inputs are synthetic, generated stores, scripts and values. Reports contain aggregate results, without record payloads. No customer corpus or fixture file was opened. No files under `.github/`, `.impeccable/` or `fixtures/` were changed.

## Invariants and adversarial evidence

New probes are in `packages/server/test/ai-policy-round2.test.ts`; names below refer to their `R2` test titles. “Holds” means the stated probe passed, not a proof against every possible input. Existing regressions are included in the profile described below.

| PR / merge | Invariant | Test tried | Result |
| --- | --- | --- | --- |
| #1293 `dd90de46c` — split credentials | Credential inputs must be tainted before diagnostics regardless of assignment indirection. | Unicode variable chains at 32 and 65 aliases, script-text round trips, independent redactor instances; existing credential-dataflow tests. | Holds; no change. |
| #1297 `9c3dfd8a9` — Tabularius rename | Renamed AI routes and resources must retain their access checks without renaming stored databases. | `tabularius://` resource denials, signed `/tabularius/containers/` URLs and agent API regressions using generated `.openhbam.sqlite` files. | Holds; no blanket rename. |
| #1300 `534b2e11c` — r22-06 cancellation | Cancellation must stop agent preview work after backup and prevent another provider retry. | Abort exactly at the backup completion boundary and during response-body cleanup; verify unchanged live records and one provider attempt. | Holds; no change. |
| #1299 `9be4f7040` — sandbox regressions | Offline AI options must discard operator network, mail, AI and installation capabilities. | Supply every capability simultaneously as a throwing stub, inspect the resulting options and verify the original options remain intact. | Holds; no capability invoked. |
| #1289 `aa6cccec7` — redaction follow-ups | Credential components and restricted script traces must remain hidden without suppressing unrelated ordinary values. | Percent-encoded credential components, error substrings, typed values, independent redactors; existing restricted MCP trace regression. | Holds; no change. |
| #1279 `9321e5f66` — built-in resolution | A custom function must not lend a harmless body to a same-named unreviewed built-in. | Mixed-case custom `GetNthRecord` plus a secret-reading built-in call; spy on evaluation before execution. | Holds; zero evaluations. |
| #1213 `db7279d56` — MBS cURL | MBS credential arguments must propagate sensitivity to their inputs. | `CURL.SetOptionPassword` fed through both Unicode alias-chain lengths, with parsed and round-tripped parameters. | Holds; no plug-in or network execution. |
| #1212 `a3fb4baab` — MBS session lifetime | Session eviction must close discarded sessions and preserve identity/file/scope separation. | Cross-account, cross-file and read-only-scope sessions, followed by the 1,001st session allocation. | Holds; previous session closed once. |
| #1258 `43146a905` — MCP conformance | Missing resources must use the resource-not-found error while permission failures remain tool errors. | Missing schema resource, inaccessible layout resource and unavailable script tool. | Holds; resource code -32002 and script code 104. |
| #1245 `b395fdf51` — container accounts | A signed container link must authorize only its issuing principal for restricted MCP readers. | Two generated accounts exchange a valid signed URL; also read it as its owner. | Holds; cross-account denial and positive owner control. |
| #1242 `6f65c846d` — linear redaction | URL credential scanning must handle repeated scheme fragments without losing credential detection. | 20,000 scheme fragments ending in username-only credentials or a noncredential port, plus existing large-input regressions. | Holds; no change. |
| #1236 `74bc8d8b1` — outbound guard | Assistant provider dispatch must remain behind the AI access boundary. | Provider stub around visibility revocation and the existing assistant pre-dispatch refusal tests; offline capability probe. | Boundary tested; real provider transport and outbound-network behavior not exercised. |
| #1234 `63f0a10bc` — check solution | The new whole-solution tool must pass the shared AI policy before inspecting a protected file. | Invoke `check_solution` on an ungranted secret-bearing generated file. | Holds; refused. |
| #1232 `92f83dab3` — prompt isolation | Assistant tool scope and data-as-data instructions must survive hostile tool requests. | Request an out-of-scope layout from a mock provider, assert no found set and an error result, and check the system notice. | Holds for this deterministic tool-boundary probe; no live-model robustness claim. |
| #1221 `3a885fe74` — privilege matrix | Layout metadata must not expose counts when record access through that layout is denied. | Tool and resource reads with samples disabled, plus malformed imports through that layout. | Holds; no counts or parser-dependent error. |
| #1198 `c758d660b` — monotonic caches | Wall-clock changes must not control the MCP password-verification cache lifetime. | Backward and forward wall-clock jumps followed by expiry on the monotonic clock. | Holds; verification occurs again only after elapsed expiry. |
| #1190 `7111d9ef6` — AI-visible policy | A human's revoked AI-visible grant must stop an in-progress assistant question before another tool or provider dispatch. | Revoke while a provider response is pending and while an internal count tool completes; retain a narrowed-token positive control. | **Failed in two variants, fixed**; one provider call and no post-revocation internal tool in the provider-boundary case. |
| #1190 `7111d9ef6` — AI-visible policy | Policy checks must cover hidden dependencies and indirect output channels using current account/file state. | Zero-row finds, secret sort keys, malformed SQL, resource reads, concurrent granted/ungranted accounts, live revocation, cyclic file inheritance and reopened stores. | Holds; no additional production changes. |
| #1207 `e61eee842` — credential diagnostics | Diagnostic masking must hide remembered credentials while retaining ordinary value types. | Encoded and decoded components, embedded errors, numeric/boolean/null controls and a fresh redactor. | Holds; no change. |
| #1208 `afe5a5074` — error text | Missing-file hints must not enumerate databases owned by another account. | Both optimization tools with an unknown database and a separate inaccessible hosted file. | Holds; no private file name. |
| #1174 `9effb0494` — import authorization | Import planning and execution must check layout access before parsing supplied data. | Malformed quoted CSV through a readable layout whose record access is denied, for both MCP import tools. | Holds; authorization error precedes parsing. |
| #1169 `e19064f5d` — semantic find | Semantic search must not dispatch an embedding request for a policy-refused file. | Registered semantic tool with a throwing synthetic embedding stub and a protected source. | Holds; policy refusal before dispatch. |
| #1142 `a871c45f7` — copied-secret redaction | Copies of a secret anywhere in a returned record's parent and portals must remain hidden before projection and compaction. | Secret in one portal row copied onto its parent, sibling row and another portal; projected fields; real MCP get/find with the source portal omitted. | **Failed in two initial variants, fixed**; all copies hidden, human source intact, no shared masking state. |
| #1291 `597b4124c` — r22-02 cross-file isolation | Dynamic script names must follow declared file references and unsupported credentials must not gain administrator authority. | MCP administrator calls with undeclared and mixed-case file names, then a declared-alias positive control; existing cross-file HTTP regressions. | Holds; no change. |
| #1296 `04baf6c1c` — r22-04 SQL rewriting | SQL dependency and internal-table checks must survive quoting, predicates, ordering and nested queries. | Quoted CTE, window ordering, set-subquery predicate, multi-statement refusal and three quoting styles around the internal PII vault. | Holds; vault remains inaccessible. LIMIT 0 may be optimized away, but the whole-file gate still denies the protected source. |

These additional merges touched the selected files incidentally. Their area hunks were inspected, but the broader features were not expanded into separate audits or fixes:

| PR / merge | Invariant or change claimed by the area hunk | Test tried | Result |
| --- | --- | --- | --- |
| #1278 `1238b443e` — version policy | The assistant's MCP client must advertise the shared server version. | Source inspection of the version constant substitution. | No new security behavior; version-policy audit not repeated. |
| #1249 `3e908934c` — triggers | AI design instructions must describe the additional trigger scope. | Read changed tool-description text. | Metadata only in these paths. |
| #1187 `4012245ef` — upload authorization | Agent JSON reads must keep the explicit one-million-byte limit. | Compare the extracted parameter with its sole call-site argument. | Same limit retained; broader upload paths not retested here. |
| #1165 `aa5c1296b` — print fidelity | Design-tool instructions must describe print-column settings. | Read changed tool-description text. | Metadata only in these paths. |
| #1156 `e4d445652` — identity limits | Agent JSON parsing must use the shared bounded parser. | Inspect the parser replacement and existing agent API policy regression. | Delegation present; HTTP size/depth stress is outside this AI-policy pass. |
| #1167 `464d55fa1` — native dates | Assistant finds must select date parsing from the file's native mode. | Inspect the mode-dependent date-order argument. | Date semantics not re-audited. |
| #1166 `bb5ac9e5c` — responsive default | Design-tool instructions must state the inherited responsive default. | Read changed tool-description text. | Metadata only in these paths. |
| #1143 `8466beba6` — path handling | Agent scratch copies must inherit the source's container-reading configuration. | Inspect `readContainersLike` substitution; canceled-backup probe avoids live writes. | Container filesystem escape behavior not re-audited. |
| #1141 `d3d1bb871` — error consistency | Passkey refusal must use the shared second-factor error constant. | Inspect constant import and substitution. | No authentication behavior changed by this hunk. |
| #1144 `bf32a5ded` — import fidelity | MCP import parsing must use the shared delimiter implementation. | Inspect removal of the local parser; malformed-import authorization probe. | Import fidelity itself not re-audited. |
| #1153 `edc90a2d4` — protocol surface | Malformed assistant paths must receive the shared bad-path error. | Inspect the URIError catch branch. | No data read added; broader protocol fuzzing not repeated. |

## Fixes and retained behavior

1. `packages/server/src/assistant.ts`: the old between-turn check passed a captured `Privileges` snapshot back into policy analysis. The new checks resolve current privileges before each provider call, after its response, and before each tool. They preserve the token ceiling and independently check the original session's cross-file bindings; they do not replace those bindings with a wider account context. Changed privilege fingerprints stop the question. Already-transmitted provider requests cannot be recalled.
2. `packages/server/src/ai-output.ts`: `recordForModel` now collects secret values from the parent and all supplied portal rows before field selection or portal compaction, then masks every part against that record-local set. Input records remain untouched. The existing minimum-length and embedded-secret rules remain in force; this is not persistent value-taint tracking.

No schedules, leases, counters, script parse rules, persisted lists, unauthenticated limits or transaction caps were changed. No service, upgrade, installation, git-pull or external-network command was run. The new tests spawn no children; the profile runner launches Node by its absolute executable path with stubs for `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl` and `sudo`, and fails if any stub marker exists.

## Validation

| Command | Result |
| --- | --- |
| `node scripts/test-ai-policy-round2.ts --http` | **561 passed, 0 failed, 0 skipped**; includes the default synthetic profile plus loopback output-parity, agent-policy and cross-file tests. Approximately 69 seconds for the whole profile under concurrent local load. |
| `node --test --test-concurrency=2 packages/server/test/ai-policy-round2.test.ts` | **28 passed, 0 failed, 0 skipped** after the final additional import/MBS assertions; approximately 1.7 seconds for the file. |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | **Pass**, zero diagnostics. |

The first broader sandbox run had 409 passes and 12 setup failures because loopback binding was forbidden; the permitted loopback rerun and full profile passed. Initial test-development mistakes in tool registration, account authentication setup and store cleanup were corrected separately from the two product defects. There are no new tight timing assertions.

The default `node scripts/test-ai-policy-round2.ts` profile is suitable for a small CI runner with two test workers, 2 CPU cores, 2 GiB RAM and approximately 1 GiB temporary disk headroom. This is a conservative provisioning target, not a measured minimum. It excludes fixture-backed tests and does not require network listening. `--http` adds only local listeners. No tested case required a larger-runner profile or corpus-scale allocation.

Limits: no full repository suite, corpus, live model/provider, native Windows/Linux run or Claris comparison was attempted. The incidental-feature rows above are not claimed as behavioral re-audits. The separately requested different-model review of the two fixes remains a follow-up; no independent-review sign-off is claimed here. No commit or push was made.
