# Execution-refusal catch checklist

Round 3 of PR #658, based on `af093ff1`. The catch inventory from round 2 is retained below with its original line numbers. This round fixes transaction ordering and summary eligibility rather than adding error-code heuristics or changing the execution boundary.

## Round 3 fixes

- [`Store.changeOne`](../packages/store/src/store.ts#L1107) runs shared-summary preparation inside the record write's `BEGIN IMMEDIATE` transaction. A marked refusal is rethrown through the existing rollback catch before `COMMIT`, preserving the original error object. The script engine's existing failure cleanup releases the pending record lock.
- [`Calculations.applyDelta`](../packages/store/src/calc.ts#L851) returns a publisher containing only prepared values. No summary formulas run after commit, and neither local nor shared summaries are published until commit succeeds. Nested summary, SQL-result and computed-column caches are bypassed while preparing, so a failed write leaves no derived result at a version that a later write can reuse.
- [`CROSS_RECORD_FUNCTIONS`](../packages/store/src/calc.ts#L114) names the SQL, dynamic-reference, lookup and design/file functions in one list, including both `ExecuteSQL` and `BE_FileMakerSQL`. Eligibility walks the parsed formula, rejects unknown plug-in/custom calls (including bare zero-argument calls), and follows unstored field dependencies. Literal text resembling a function call remains eligible.
- Warmed sources that do not qualify for an incremental update have their reads checked before commit, under the current script's file guards, and their updated results are left for the warmer. This preserves the requested 212/rollback behavior for the reviewer's repro while excluding cross-file reads from incremental publication. Session/account cache keys are matched to the warmed source, without reusing another session's calculated value.

The six script regressions use real on-disk stores and shared results, without replacement database connections or mocked eligibility. They cover the reviewer's external occurrence `R` through `BE_FileMakerSQL`, the same query through `ExecuteSQL`, and the external occurrence through `FieldNames`, each with Error Capture On and Off. B's Worker account is disabled in the final Exit Script profiling callback. Each test checks original refusal identity/code 212, Value `original`, the unchanged data version, a closed transaction, and the released record lock.

Store regressions check an earlier prepared summary followed by a refusal, failed COMMIT, eligibility for indirect SQL/dynamic/design/plug-in calls, and nested summary/SQL cache state after rollback and version reuse. Existing related-summary sharing tests remain intact.

## Round 3 files changed

- [packages/store/src/store.ts](../packages/store/src/store.ts)
- [packages/store/src/calc.ts](../packages/store/src/calc.ts)
- [packages/scripts/test/execution-refusal.test.ts](../packages/scripts/test/execution-refusal.test.ts)
- [packages/store/test/summary-cache-guard.test.ts](../packages/store/test/summary-cache-guard.test.ts)
- [docs/execution-refusal-catches.md](execution-refusal-catches.md)

## Round 3 validation

For the deliberate failing run, both production files were saved and replaced locally with their `af093ff1` contents, retaining the new tests. A `finally` block restored the fixes. That run reported `# pass 42 / # fail 8` over the first 50 tests. After adding the two nested-cache cases, an isolated local source projection with the same two production files reverted to `af093ff1` ran all 52 final tests: `# pass 42 / # fail 10`. The reviewer's BE_FileMakerSQL cases failed because Value was `pending`; the ExecuteSQL/FieldNames cases were never checked by the old incremental path and failed with a missing refusal. The failed-COMMIT control already passed on the base.

```text
Final af093ff1 baseline:       # pass 42 / # fail 10
Fixed focused regressions:    # pass 52 / # fail 0
Scripts suite:                # pass 626 / # fail 0
Store suite:                  # pass 556 / # fail 0
Server suite:                 # pass 1121 / # fail 0
npm run test:ci (once):       # pass 2624 / # fail 0 / # cancelled 1
Timed-out file recheck:       # pass 5 / # fail 0
```

Final `npm run typecheck`, `npx tsc -b`, and `git diff --check` passed. The generated build-info change was restored. The server and CI runs each reported one pre-existing skip: unavailable private multi-file fixtures. asyncpg and the opt-in soak case both ran and passed.

The single CI command exited 1: `packages/server/test/ai-replace.test.ts` was cancelled at the existing 120,000 ms file timeout after all five of its tests had passed. The same file passed in the standalone server suite, and its isolated recheck passed all five tests in 3,156 ms with the same concurrency and timeout options (`ai-replace-recheck.tap`). CI's literal totals are zero failed tests and one cancelled file, not a clean pass. No timeout, assertion or cleanup code was changed to mask this result, and CI was not rerun.

Commands: `node --test --test-reporter=tap packages/scripts/test/execution-refusal.test.ts packages/store/test/summary-cache-guard.test.ts`; package suites use `node --test --test-concurrency=4 --test-timeout=120000 --test-reporter=tap 'packages/<package>/test/*.test.ts'`. The full run uses `npm run test:ci` once. The existing temporary Python environment from round 2 supplies asyncpg through PATH, and `TABULARIUS_SOAK=1` enables the existing opt-in soak case in the server and CI runs. No tests are skipped, weakened or disabled by these changes.

Logs: `/private/tmp/tabularius-refusal-round3/{reverted-production,final-baseline,regressions,scripts,store,server}.tap`, `test-ci.log`, `typecheck-final.log`, and `tsc-build-final.log`. The first failing run modified and restored the actual checkout; the final baseline projection avoids altering source files while the broad suites are running. As an additional control, removing preparation cache protection from the fixed source in that isolated projection made both nested-cache tests fail (`# pass 0 / # fail 2`), recorded in `cache-without-protection.tap`.

## Round 2 catch inventory (historical)

Round 2 of PR #658, based on `8f657cb8`. All catch clauses in `packages/store/src` and `packages/calc/src` were inventoried, including catches outside the earlier scripts-only review. The previous engine/Data API inventory is retained below. Locations refer to the resulting source.

Only the script engine's execution boundary marks an error. The shared weak identity set lets lower layers rethrow that same object before fallback, conversion, retry or observation. A numeric 212 by itself remains handleable (including wrong-password Re-Login). No error-code heuristic or new wrapping is used.

The key additions are store ValueListItems fallback, ExecuteSQL conversion and calculated SQL columns, formula/name resolution, value-list field computation, record-access checks, portal sort/filter, relationship keys, batched evaluation/group keys, external-container paths, validation/stored calculations, and diagnostic evaluation. Calc IsEmpty/IsValid/EvaluationError/IsValidExpression, evaluateText, SQL callbacks and custom-function recursion use the same rule. Evaluate, GetField, GetNthRecord, GetValue and Lookup/LookupNext were checked: their direct delegation adds no catch.

The earlier 79 sites (75 catch clauses plus four promise rejection handlers) are retained, and 174 store/calc catch clauses are added: 253 sites in total. Of the 249 catch clauses, 121 have an explicit refusal check. XSLT wrapper catches delegate to the guarded `wrap` method. Remaining catches and their reasons are listed, rather than silently omitted. Embedded JavaScript sandbox catches were also checked separately: host store callbacks cannot run in those child realms.

| File | Explicitly guarded catch lines | Delegates to guarded wrap | Other checked catch lines | Disposition |
| --- | --- | --- | --- | --- |
| [packages/scripts/src/engine.ts](../packages/scripts/src/engine.ts) | 1059, 1169, 1319, 1334, 1466, 1500, 1530, 1535, 1553, 1561, 1639, 1643, 1650, 1653, 1660, 1704, 1713, 1782, 1793, 1979, 2004, 2017, 2120, 2160, 2305, 2339, 2545, 2636, 2746, 2825, 3556, 3600, 3725, 3786, 3803, 3902, 4043, 4128, 4152, 4397, 4861, 5206, 5573, 5619, 5743, 5784, 6002, 6017, 6110, 6314, 6463, 6644, 6778, 6807, 6861, 6878, 7155 | — | 164, 598, 1085, 1189, 1241, 1251, 3589, 4068, 4075, 4615, 5294, 6906, 6914, 7125, 7190 | Existing execution guards, identity rethrows, Halt handling, cleanup, or non-evaluation parsing/I/O. Final commit is now inside failure cleanup. |
| [packages/scripts/src/data-api-step.ts](../packages/scripts/src/data-api-step.ts) | 50 | — | 45, 190 | Existing execution guard before converting the request error. |
| [packages/store/src/account-provisioning.ts](../packages/store/src/account-provisioning.ts) | — | — | 59 | Account CSV parsing only. |
| [packages/store/src/activity.ts](../packages/store/src/activity.ts) | — | — | 70, 267 | Transaction completion retains the original error until every file is cleaned up; record-lock catch rolls back and rethrows. |
| [packages/store/src/calc.ts](../packages/store/src/calc.ts) | 232, 368, 1485, 1547, 1716, 1872, 1918, 1931, 1950, 1991 | — | 1294, 1635, 2080 | Unchanged: native CREATE INDEX, cached-column JSON decoding, repetition JSON decoding. All computation/validation/error-conversion catches are guarded. |
| [packages/store/src/design.ts](../packages/store/src/design.ts) | — | — | 489, 2238 | Schema-only rename parsing and DesignError annotation; no evaluation or file-guard callbacks. |
| [packages/store/src/explain-related.ts](../packages/store/src/explain-related.ts) | 182, 192, 240, 385 | — | — | All filter, portal, field and evaluation explanation catches are guarded. |
| [packages/store/src/explain.ts](../packages/store/src/explain.ts) | 101, 146, 242, 332 | — | — | All evaluation and field/name-resolution catches are guarded. |
| [packages/store/src/fidelity.ts](../packages/store/src/fidelity.ts) | 153, 169, 219 | — | 198 | Evaluation/query/name-resolution catches are guarded; unchanged catch reads native stored rows only. |
| [packages/store/src/fmexport.ts](../packages/store/src/fmexport.ts) | — | — | 119 | Primitive repetition JSON decoding. |
| [packages/store/src/import.ts](../packages/store/src/import.ts) | — | — | 118, 240 | Import replay and serialized import state only; no evaluation callbacks. |
| [packages/store/src/javascript.ts](../packages/store/src/javascript.ts) | — | — | 40, 327 | Host syntax validation and process termination only. Embedded child/worker program catches are separate realms with no store/file-guard callbacks or host error identity. |
| [packages/store/src/layout-perf.ts](../packages/store/src/layout-perf.ts) | — | — | 76 | Syntax parsing over supplied names only. |
| [packages/store/src/layout-speed.ts](../packages/store/src/layout-speed.ts) | 66 | — | — | Cost estimate fallback is guarded. |
| [packages/store/src/reconvert.ts](../packages/store/src/reconvert.ts) | — | — | 203, 204 | Rollback/file cleanup and original throw; inner catch is native rollback only. |
| [packages/store/src/record-check.ts](../packages/store/src/record-check.ts) | 117, 131 | — | — | Both validation and field-explanation catches are guarded. |
| [packages/store/src/related.ts](../packages/store/src/related.ts) | 98 | — | — | Computed relationship-key fallback is guarded. |
| [packages/store/src/results.ts](../packages/store/src/results.ts) | — | — | 41, 57, 66, 75, 89, 113, 122, 131, 139 | Native result-cache DB or filesystem calls only; pending callback is outside these catches. |
| [packages/store/src/security-chain.ts](../packages/store/src/security-chain.ts) | — | — | 41, 83, 201 | UTF-8 decoding/audit verification or rollback and original throw; no calculation evaluation. |
| [packages/store/src/snippet.ts](../packages/store/src/snippet.ts) | — | — | 298 | Schema-only field-span parsing. |
| [packages/store/src/stale-calcs.ts](../packages/store/src/stale-calcs.ts) | 109 | — | 222, 248 | Evaluation fallback is guarded; remaining catches roll back and rethrow the same error. |
| [packages/store/src/store.ts](../packages/store/src/store.ts) | 1032, 1127, 1199, 3934, 3966, 4115, 4130, 4735, 4974, 5091, 5104, 5388, 5576, 5597, 5900, 6228, 6262, 6285, 6297, 6327, 6367, 6575, 6607, 6679 | — | 358, 815, 831, 871, 941, 964, 975, 1060, 1096, 1120, 1224, 1242, 1258, 1291, 1547, 1576, 1643, 2761, 2808, 3030, 3052, 3224, 3229, 3247, 3251, 3267, 3284, 3285, 3325, 3528, 3568, 4362, 4372, 4584, 5196, 5235, 5360, 5750, 5751, 5822, 6082 | Unchanged: native I/O/cache/security bookkeeping, syntax/design-only conversion, SQL-busy handling, or cleanup followed by the original throw. Evaluation, record rules, related lookups, value lists, portals, external paths and formula batches are guarded. |
| [packages/store/src/sync.ts](../packages/store/src/sync.ts) | — | — | 465 | SyncPause only is handled; other errors are rethrown unchanged. |
| [packages/store/src/table-ddl.ts](../packages/store/src/table-ddl.ts) | — | — | 20 | Primitive table-list JSON decoding. |
| [packages/store/src/text-styles.ts](../packages/store/src/text-styles.ts) | — | — | 31, 49, 115 | Native migration/JSON decoding; text callback runs outside the catches. |
| [packages/store/src/webauthn.ts](../packages/store/src/webauthn.ts) | — | — | 141 | Client JSON parsing only. |
| [packages/store/src/words.ts](../packages/store/src/words.ts) | 97 | — | 77, 121 | Retry callback is guarded; unchanged catches build native FTS indexes or roll back and rethrow. |
| [packages/calc/src/bejs.ts](../packages/calc/src/bejs.ts) | — | — | 19 | Recognized fixed programs over parsed JSON values; no host callbacks. |
| [packages/calc/src/check.ts](../packages/calc/src/check.ts) | — | — | 40 | Syntax parsing only; no formula evaluation. |
| [packages/calc/src/evaluate.ts](../packages/calc/src/evaluate.ts) | 195, 446 | — | — | Trace and custom-function recursion catches are guarded; Evaluate/GetField/GetNthRecord/lookup delegation has no intervening fallback catch. |
| [packages/calc/src/explain.ts](../packages/calc/src/explain.ts) | 99 | — | — | All evaluation and field/name-resolution catches are guarded. |
| [packages/calc/src/functions.ts](../packages/calc/src/functions.ts) | 97, 107, 117, 132, 865, 1125 | — | 702, 716, 776, 946, 1097, 1283, 1318, 1628, 1674, 1727, 1743, 1756, 1785, 1794, 1804 | Unchanged: eager arguments are already evaluated; only primitive JSON/XML, regex, URI, crypto or compression operations run inside those catches. Lazy evaluation and both SQL callbacks are guarded. |
| [packages/calc/src/image-info.ts](../packages/calc/src/image-info.ts) | — | — | 43 | Native image-header bounds checks only. |
| [packages/calc/src/index.ts](../packages/calc/src/index.ts) | 77 | — | — | No evaluation or file-guard callback in these native operations. |
| [packages/calc/src/json.ts](../packages/calc/src/json.ts) | — | — | 48, 177, 206, 279 | Primitive JSON parsing/private JsonError conversion; no host callbacks inside catches. |
| [packages/calc/src/mbs-hash.ts](../packages/calc/src/mbs-hash.ts) | — | — | 75 | Private Refused errors only are converted; input callbacks throw other errors through unchanged. |
| [packages/calc/src/xslt.ts](../packages/calc/src/xslt.ts) | 544, 1317 | 394, 408, 473, 495, 1049 | 1305, 1312 | Callback errors pass through guarded wrap/run/outer conversion; unchanged source/stylesheet catches only parse XML strings. |

Promise rejection handlers in `engine.ts` were checked separately: 766 and 778 cancel native HTTP readers; 3708 and 3718 attach rejection observers to server work whose result/refusal is handled by the waited, callback or queued path. They do not replace the execution promise or authorize continuation.

Regression tests in `packages/scripts/test/execution-refusal.test.ts` cover unstored ValueListItems, ExecuteSQL, BE_FileMakerSQL, evaluateEach, and final-commit lock cleanup with Error Capture On and Off. Each must propagate the original 212, leave the field `original`, and leave no record lock. The final commit loop runs within the same failure cleanup as script steps and callbacks.

## Round 2 files changed

- [docs/execution-refusal-catches.md](../docs/execution-refusal-catches.md)
- [packages/calc/src/evaluate.ts](../packages/calc/src/evaluate.ts)
- [packages/calc/src/execution-refusal.ts](../packages/calc/src/execution-refusal.ts)
- [packages/calc/src/explain.ts](../packages/calc/src/explain.ts)
- [packages/calc/src/functions.ts](../packages/calc/src/functions.ts)
- [packages/calc/src/index.ts](../packages/calc/src/index.ts)
- [packages/calc/src/xslt.ts](../packages/calc/src/xslt.ts)
- [packages/scripts/src/engine.ts](../packages/scripts/src/engine.ts)
- [packages/scripts/test/execution-refusal.test.ts](../packages/scripts/test/execution-refusal.test.ts)
- [packages/store/src/calc.ts](../packages/store/src/calc.ts)
- [packages/store/src/explain-related.ts](../packages/store/src/explain-related.ts)
- [packages/store/src/explain.ts](../packages/store/src/explain.ts)
- [packages/store/src/fidelity.ts](../packages/store/src/fidelity.ts)
- [packages/store/src/layout-speed.ts](../packages/store/src/layout-speed.ts)
- [packages/store/src/record-check.ts](../packages/store/src/record-check.ts)
- [packages/store/src/related.ts](../packages/store/src/related.ts)
- [packages/store/src/stale-calcs.ts](../packages/store/src/stale-calcs.ts)
- [packages/store/src/store.ts](../packages/store/src/store.ts)
- [packages/store/src/words.ts](../packages/store/src/words.ts)

## Round 2 validation

All production edits were saved, the tracked production files were replaced with their `8f657cb8` versions, and the new shared helper was removed for the deliberate failing run. The regression tests were retained. Production edits were restored in a `finally` block afterwards. All ten new regressions failed on the base, then passed with the fixes (five cases under each Error Capture setting).

```text
Production reverted to 8f657cb8: # pass 26 / # fail 10
Fixed regression file:          # pass 36 / # fail 0
Scripts suite:                 # pass 620 / # fail 0
Store suite:                   # pass 551 / # fail 0
Server suite:                  # pass 1119 / # fail 0
npm run test:ci (once):         # pass 2611 / # fail 0
Explicit soak run:             # pass 1 / # fail 0
PostgreSQL wire with asyncpg:  # pass 12 / # fail 0
```

`npm run typecheck`, `npx tsc -b`, and `git diff --check` passed. The generated build-info change was restored.

Commands: `node --test --test-reporter=tap packages/scripts/test/execution-refusal.test.ts`; each package suite used `node --test --test-concurrency=4 --test-timeout=120000 --test-reporter=tap 'packages/<package>/test/*.test.ts'`. The full run used the unchanged `npm run test:ci` command once.

The standard server and CI runs each reported three pre-existing skips: unavailable private multi-file fixtures, missing Python asyncpg, and the opt-in soak test. The soak test was subsequently run with `TABULARIUS_SOAK=1`; asyncpg was installed into a temporary virtual environment and the entire PostgreSQL wire test file was rerun with that interpreter on PATH. Both supplementary runs passed with zero skips. The private fixture test remains unavailable. No tests were skipped, weakened or disabled by these changes.

Run logs: `/private/tmp/tabularius-refusal-round2/{reverted-production,regressions,scripts,store,server,soak,pgwire}.tap`, `test-ci.log`, `typecheck-final.log`, and `tsc-build-final.log`.
