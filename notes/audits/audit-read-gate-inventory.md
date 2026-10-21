# Read-gate inventory (r28-01)

This extends the generated privilege matrix already present in `docs/audit-privilege-matrix.md`, the store summary/related-privilege regressions, and `notes/audits/r22-02-cross-file-isolation.md`. Initial filename/content searches found no earlier r28-01 inventory, backlog, claims directory, or AGENTS.md in this checkout. Existing gates were retained. No private corpus or downloaded fixture was opened; all runtime inputs are generated. No real git command ran. There were no dependency changes, service operations, commits or pushes; the optional version probe was blocked by a command stub as described below.

The security policy is: an account-facing result must not disclose hidden fields, records, counts, found-set sizes, grouping, sort order or aggregates. A raw store/SQLite primitive is **not** an authorization boundary. Local operator operations, authenticated server administration, and internal materialization are separately classified below; they do not accept a restricted file account as authority. An omitted `Privileges` argument means trusted execution, not an anonymous caller.

## Public expectations and KNOWN

Public references establish the following principles; synthetic numeric results are computed from generated inputs, not claimed as vendor test results. No Claris instance was used.

| Expectation used by tests | Public page / short expression | Result expected here |
| --- | --- | --- |
| Row formula and hidden fields/tables | [Editing record access privileges](https://help.claris.com/en/pro-help/content/record-access-privileges.html): “No access”, “Boolean calculation” | Only the caller-owned row contributes; hidden fields/tables contribute no returned data. |
| Found-set cardinality and summaries | [Editing record access privileges](https://help.claris.com/en/pro-help/content/record-access-privileges.html): “found set is always filtered”, “exclude data” | One visible row; aggregate total 7 in the store regression, excluding the other row. |
| Record and layout checks both apply | [Get(RecordAccess)](https://help.claris.com/en/pro-help/content/get-recordaccess.html): “Get(LayoutAccess)” | Hidden parent/layout requests fail before portal counts. |
| Found-count meaning | [Get(FoundCount)](https://help.claris.com/en/pro-help/content/get-foundcount.html): “number of records” | Counts describe the visible found set, including portal paging and current dashboard counts. |
| Value lists and ordinary scripts | [Editing record access privileges](https://help.claris.com/en/pro-help/content/record-access-privileges.html): “does not display any values” | No hidden source values; caller-run scripts keep their account gates. |

| KNOWN | Status / boundary |
| --- | --- |
| Exact error envelopes, omission versus empty value, rejection of hidden sort/group fields | **Unverified Claris compatibility**. Tabularius security policy; the cited record-access page documents access restrictions, not these API representations. Existing protocol matrix expectations remain its own policy. |
| Live presence/event filtering, calendar headers, MCP tools, dashboards, saved digest prose and RAG spaces | **Unverified Claris compatibility**. Tabularius extensions. Expected results implement the stated invariant; there is no public Claris page establishing equivalent endpoints. |
| Historical digest payloads | Restricted readers receive run metadata with empty data/highlights and no saved prose. Re-run the dashboard for current filtered results. Existing snapshots have no row/field provenance. |
| AI digest prose for restricted accounts | Suppressed, because arbitrary prose cannot be re-filtered after row access changes. Current dashboard data remains available. |
| RAG snapshots | File-scoped documents have no row/field provenance. The server adapter now requires `readsEverything` on each operation. No claim of per-document RLA. |
| Internal/operator readers | Raw primitives have no account parameter. They are catalogued as trusted capabilities, with their account-facing caller boundary documented below. They are not independently safe to expose as routes. |
| Static inventory limits | Type-resolved references, aliases, bracket calls, destructured capabilities, raw SQLite statements and calculation/relationship reads are checked. Reflective/dynamically constructed property names and values erased to `any` are not a complete call-graph proof. |
| Runtime completeness | Generated tests exercise reader APIs and boundary families, including existing protocol matrices. They do **not** invoke every internal helper or every branch of every classified function as a restricted account. The inventory is exhaustive for the enumerated code APIs, not a claim of exhaustive execution coverage. |
| Operator diagnostics and outgoing hooks | Local diagnostics require filesystem/operator authority; change webhooks require server-admin configuration. Their internal builders do not accept a restricted account. Real service commands, thumbnail tools, external webhook/model calls and vendor conformance are unverified here. |
| Independent security review | A different-model review follows this change; it has not been performed by this author. |

## Reproduced gaps and fixes

Each row has a synthetic regression. Before fixes the four new store regressions failed; surface regressions reproduced the live and snapshot disclosures. Test data values are deliberately omitted from this report.

| Gap | Fix | Regression |
| --- | --- | --- |
| `sortIdsCurrent` trusted supplied ids and hidden sort columns | Layout/table/field checks plus record view filter before ordering | `store/test/read-gate.test.ts`: sortIds |
| `groupSummariesCurrent` grouped supplied ids and included hidden summary fields | Layout/table/group-key gate, visible ids, visible output summary fields | Same file: groupSummaries |
| `foundSetRowsCurrent` returned unfiltered supplied-id count and pagination | Filter before choosing the page and reporting count | Same file: foundSetRows |
| `portalCountsCurrent` accepted a hidden parent and reused restricted cached counts | Parent gate before fast paths; restricted callers recompute related counts | Same file: portalCounts; extended `privileges-everywhere.test.ts` cached related-row regression |
| Live locks/viewers and event ids used only table visibility | Per-record rules for snapshots, presence writes, individual events and bulk ids; missing/deleted restricted rows fail closed | `server/test/read-gate-surfaces.test.ts`: locks/viewers and fenced stream |
| Digest histories kept earlier, broader account data | Suppress unverifiable historical payloads for restricted readers on list/detail/runs routes | Same file: saved digest |
| Digest data/prose survived access changes across the summary await | Compare data/security stamps of hosted files before webhook handoff and after awaits; discard changed snapshots; release running state in `finally` | Same file: asynchronous digest, with an in-process poster |
| RAG file-only scope returned copied record data to restricted accounts | Server adapter checks unrestricted record/field visibility on every space operation; script engine also rejects restricted/scoped callers with custom backends | Same file: RAG adapter and script regressions, with generated vectors and no embedding request |

## Inventory generation and enforcement

`node scripts/read-gate-inventory.ts --check` scans only package source trees, resolves the declarations behind reads using the already installed TypeScript compiler, compares call-expression fingerprints and multiplicity with `read-gate-allowlist.json`, and checks this generated table. `node scripts/read-gate-inventory.ts` updates **only** the table after classification has been reviewed. There is deliberately no command to accept new call sites automatically.

The inventory contains **2,462 read/capability sites in 716 functions**. The initial discovery used `rg` over Store's read methods and their callers. The generator additionally includes direct `Store.sql` capability transfers, SQLite `prepare/get/all/iterate`, calculation and relationship reads, so SQL aliases and builders that bypass Store methods are visible. SQLite writes and schema/security reads are retained conservatively: their presence in the table does not mean they disclose record values. Each row names the enclosing function, every relevant source line, and its gate classification. New sites, changed call arguments, duplicate sites, removed sites and moved functions fail the allow-list test; shifting line numbers only requires regenerating the report.

The guard regression injects synthetic unlisted readers in memory, including aliases, bracket access and destructuring, without editing production source. It also checks duplicate call-site multiplicity. Passing the guard means classification is current, not that a fingerprint proves authorization: the `CORE` entries in particular are fingerprints of call text, so they show that a site did not change, not that its privilege argument is right (a `privileges` variable rebound upstream would go unnoticed).

The scan is a regression catcher, not a hard boundary. Resolution is by declaration file, so a member of a receiver typed `any` or `unknown` is reported by name (as `Untyped.<api>`). Everyday names (`get`, `find`, `select`, `query`, `row`, `describe`, `container`, `sql` and a few more) are reported only when the receiver is a Store, calculation engine or SQLite connection cast to `any`/`unknown`, directly, through a variable whose initialiser is the cast (up to four aliases deep) or by destructuring, and only for types declared in `store.ts`, `calc.ts`, `related.ts` or `node:sqlite`; on any other untyped value they would be a Map or an array. These are not found: a variable annotated `any` and assigned a reader instead of cast (`const a: any = s`, `let a: any; a = s`), an alias passed through a function parameter, an object property or an array element, a chain deeper than four, a function that returns `any`, a cast of a union, intersection or generic (`Store | Calculations`), a cast of a Store subclass declared in another file, a JSDoc cast in a `.mjs` file, `.prepare` or `.exec` on a SQLite connection cast to `any`, a computed key (`(s as any)[key]()`, `Reflect.get(s, 'find')`), a cast to a structural type, a call through a subclass that overrides the method in another file, and anything outside `packages/*/src`.

The inventory also classifies the authentication metadata reads in `Store.useRecoveryCode` and `Store.knownSharedAccount` as `CORE`. The former checks for an unused code matching the account and supplied code hash before consuming it and opening a session; the latter returns an internal account-existence boolean for sign-in lockout accounting. Both query security metadata rather than solution records, and neither returns the stored metadata to the caller.

## Route and gate ledger

The route dispatcher is `packages/server/src/index.ts`. The generated function inventory below expands these boundaries rather than replacing them with a filename-only exemption.

| ID | Entry/caller gate and data handling | Synthetic evidence |
| --- | --- | --- |
| REST | `DataApi.authorize` / `sessionPrivileges`, layout scope; `Store.find/get` apply record rules and field omission before count/data envelopes | privilege-matrix-dataapi, api-token |
| WEB | `WebClient.handle` session/layout gate; store readers receive privileges; groups/export reselect visible ids; history uses field/table concealment | privilege-matrix-web, read-gate |
| ODATA | `ODataEndpoint` authenticated privileges, visible entity sets/properties; select/count/compute and related readers pass privileges | privilege-matrix-odata |
| XML | `CwpXmlEndpoint` authentication/fmxml plus layout; `find/get` receive privileges | privilege-matrix-xml |
| SQL | HTTP `checkReadsEverything`, pgwire authentication and per-query privilege recheck, destination-file check; MCP `readsEverything` for raw SQL/formulas/numeric containers | privilege-matrix-sql, pgwire, mcp |
| MCP | `privilegesIn`, tool-specific layout/read gates; raw tools use SQL gate; `registerResources` uses `designAccess`/Full Access for whole-file resources | privilege-matrix-mcp |
| SCRIPT | ScriptEngine caller privileges, `reading`, found-set/value readers and calculation passes; related raw match ids filtered through destination `viewableIds`; export/print flags checked separately | privilege-matrix-scripts; store related/summary tests |
| GATED-STORE | `checkLayout`, local/destination privileges, `viewFilter`/`checkRecordRule`, field checks and `toRecord` masking; calculations carry privileges | read-gate, summary-privileges, privileges-everywhere |
| CALC | Calculation `Pass.privileges`, field visibility, visible related rows and `scopedTableSql`; raw materialization is internal and must not be returned directly | summary-privileges, privileges-everywhere |
| RELATED | Raw relationship primitives; caller supplies privileges or filters ids before exposure (`ScriptEngine.relatedIds`, store portals/calculation pass) | privileges-everywhere, protocol matrices |
| CALENDAR | Data API session/scoped token, readable mapping, `find(... privileges)` before event count/content | read-gate-surfaces |
| LIVE | Session per request/event, file binding, record gate for presence and event ids; design events require Full Access | read-gate-surfaces |
| CHANGE | Data API account refresh; table and `canViewRecord` check for record events. Configured webhook consumers are server-admin authority | existing change-feed code review; live synthetic fence |
| DASHBOARD | Saved definitions are metadata; `DashboardApi` computes widgets through `summarizeRecords` with requesting privileges | read-gate-surfaces |
| DIGEST | `mayRead` account ownership/Full Access plus restricted-history suppression; runner obtains current privileges and rechecks snapshot stamps before delivery | read-gate-surfaces |
| SUMMARY | `findIds` with privileges; visible grouping/measure fields; raw SELECT restricted to authorized ids, evaluated path carries privileges | read-gate-surfaces, privilege-matrix-mcp |
| PROFILE | `layoutProfile` field access and destination `viewableIds`; `columnProfile` operates on those ids. MCP layout gate precedes entry | read-gate-surfaces, privilege-matrix-mcp |
| SEARCH | Text/semantic search checks tables, visible fields, visible ids and readable layouts before hits; vectors read with privileges | privilege-matrix-mcp |
| RECORD | Explanation/context helpers use account-bearing calculation passes and visible related rows; route/tool checks parent record first | protocol matrices; related/summary tests |
| HISTORY | Web parent read gate and `hideField`/`hideTable` callbacks; MCP history is a design tool requiring Full Access | privilege-matrix-web, mcp |
| CONTAINER | Signed URL minted from privileged field read; the `index.ts` container route calls `Host.checkUrl` to validate signature, expiry and bound account identity/inactive state before raw container/range/thumbnail reads | protocol matrix container checks; actual thumbnail programs not run |
| DESIGN | `DesignApi`/`SecurityApi` Full Access; MCP design guard or `designAccess` (modifiable scripts plus readsEverything); debug Full Access. Sampling/diagnostic raw helpers inherit that caller gate | privilege-matrix-mcp, admin; static caller review |
| ADMIN | Separate server-admin authorization in `Admin.handle`/Admin API, not file credentials; includes logs/statistics | privilege-matrix-admin |
| AUTOMATION | Full Access configuration, saved execution account and current script privileges; stored run logs are privileged metadata/history | static caller review; protocol script matrix |
| CLEANUP | Scans/updates select visible ids and fields; raw undo/snapshot journal is internal to checked mutation paths; HTTP session and MCP caller gate | static caller review |
| IMPORT | Import route/layout/write privileges before target-key/undo journal access; configuration/history uses design/admin authority | static caller review |
| ACCOUNT | Assistant tool calls retain requesting account/file; model redaction does not replace the underlying read gate | protocol MCP matrix; RAG regression |
| RAG | `Assistant.scriptAi` adapter `checkRag`: current `readsEverything` plus model policy; ScriptEngine `checkRagRead` enforces account/ceiling gates; raw RagStore is an internal file-scoped cache | read-gate-surfaces |
| REDACTION | Raw secret/PII inspection is used to remove values or build account-scoped stand-ins; preview belongs to privileged design tools | static caller review |
| POLICY | SQL/AI policy inspection is an internal refusal path, not a returned record result | static caller review |
| AUTH | Account/token/identity/configuration SQL; authentication/session/admin gates, not solution record reads | protocol authentication matrices |
| JOIN | Worker receives only rows/columns already filtered by `ODataEndpoint.crossjoined`; its database is in memory | static caller review |
| OPERATOR | Local CLI/filesystem ownership, import/reconversion/sync/backup operator, or server-admin boundary; no restricted-account invocation of raw functions | static caller review; no real operator commands executed |
| INTERNAL | Summary warmer/materializer for internal caches; account-facing reads reapply gates | summary-privileges |
| CORE | Store/SQLite internals, security metadata, transactions and raw capabilities. **No independent account gate**; only the caller boundaries above authorize exposure | store and protocol regressions; static inventory |

## Validation

Run `node scripts/test-read-gate.ts` for the generated store/surface regressions and existing synthetic protocol matrix. It uses `--test-concurrency=2`, per-test timeout 55 seconds and a stub-only child PATH. Stubs for launchctl, systemctl, sc, git, npm, curl and sudo write a marker and exit 99; any marker fails the runner. Temporary synthetic release metadata prevents the existing optional git version probe, and is removed afterward. No tests are skipped or disabled.

Run `node --test --test-concurrency=2 packages/server/test/read-gate-inventory.test.ts` for the static guard, `node scripts/read-gate-inventory.ts --check` for report freshness, and `node node_modules/typescript/bin/tsc --noEmit --pretty false` for types.

Prior implementation runtime run (before this repair): **4,483 passed, 0 failed, 0 cancelled, 0 skipped**, across 20 generated-input test files in **126.52 s** total. The command-stub marker remained absent. The final inventory guard passed **3/3** in **17.11 s**; inventory freshness and TypeScript checks passed. Summed top-level test durations for the ten protocol files ranged from **12.15 to 26.69 s** (excluding module startup); the new store and surface regressions also remained well below the per-file budget. The live-stream fence has a 15-second failure bound, with observed event handling comfortably below one third of that bound. The combined hidden-field/hidden-table/row-rule solution also exercises REST, web export, XML, OData counts/aggregates, dashboards, and MCP filtered/denied readers. The first broad run passed 4,384 assertions but correctly **failed the runner** because its command stub caught the pre-existing optional version probe; synthetic build metadata removes that probe without weakening the marker check. Initial sandbox-only HTTP attempts could not bind loopback; subsequent runs used approved loopback execution.

## PR repair review after merging main

The post-merge baseline failed both inventory assertions (111 changed/unclassified fingerprints) and the cached portal-count cost assertion. Review covered each changed expression and its caller boundary. The repaired inventory has 2,454 read/capability sites in 713 functions; 33 functions carry explicit review reasons in the JSON allow-list. Obsolete `oauth.ts/passwordMark` and `calc.ts/Calculations/context/summary/group` inventory scopes were removed because their enumerated reads moved. No wildcard classifications or test relaxations were added.

Two reads required code fixes before classification: `Calculations/context/summary` could use a hidden break field or hidden summary field, and `Store/runningSummaryValues` could use a hidden restart field supplied through sort state. Both now check field visibility before reading those values. The synthetic regressions compare unrestricted results with concealed restricted results. These are Tabularius access invariants, not claims of documented Claris behavior.

`Store/portalCountsCurrent` now reuses account-free snapshot counts before querying design metadata. Every account-bearing call still resolves the current layout and checks layout/parent access before returning cached counts; restricted accounts still recompute related totals. Its new regression covers both layout argument forms, a newly hidden parent, and a layout-denied account whose record privileges otherwise read everything.

Repair validation uses generated stores only. Final regeneration and `node --no-warnings scripts/read-gate-inventory.ts --check` passed for all 2,454 sites; the final standalone inventory test run passed **3 tests, 0 failures, 0 skips** in 23.69 seconds. `npm run typecheck` passed both TypeScript projects. The focused command `node --no-warnings --test --test-concurrency=2 packages/server/test/read-gate-inventory.test.ts packages/store/test/related-path-cost.test.ts packages/store/test/read-gate.test.ts packages/store/test/summary-aggregates-generated.test.ts` passed **18 tests, 0 failures, 0 skips** in 19.81 seconds.

Each new regression was checked in a temporary source copy with only its corresponding production fix removed. The portal snapshot test, hidden GetSummary key test, and hidden running-restart test each failed as expected (**7 passed, 1 failed** per run). Restoring the pre-repair allow-list in that copy reproduced both inventory assertion failures (**1 passed, 2 failed**). The working tree was never reverted. The three new store tests completed in a file comfortably below the 60-second target; none adds timing assertions.

The initial `node scripts/test-read-gate.ts` run reached its existing 180-second overall timeout; the admin matrix also reached its existing 55-second file timeout while other checks were running. It emitted 3,719 passing test lines and one failing file line before interruption; those are partial counts. Admin rerun alone with the same 55-second file limit passed **298 tests, 0 failures, 0 skips** in 30.00 seconds. The other 19 files were rerun with the same concurrency and file limit: **4,187 passed, 1 failed, 0 skipped** in 147.11 seconds. The failure was the digest-history regression reusing a session after privilege changes; main now invalidates that session. The test now additionally asserts HTTP 401 for the revoked session, signs in again, and retains all three HTTP 200 plus hidden-data checks. `node scripts/test-read-gate.ts --surfaces` then passed **27 tests, 0 failures, 0 skips** in 4.42 seconds. Reverting only this test repair in a temporary copy reproduced the stale-session assertion (**26 passed, 1 failed**). Across the latest results for all 20 PR runtime files, **4,486 tests passed, 0 failed, 0 skipped**. All spawned test processes used the marker-writing forbidden-command stubs; no timeout or test was edited.

The broader reruns use `node --no-warnings --test --test-concurrency=2 --test-timeout=55000` under the same stub-only child environment as the PR runner. Files run:

- `packages/store/test/`: `read-gate.test.ts`, `summary-privileges.test.ts`, `found-set-portal.test.ts`, `privileges-everywhere.test.ts`.
- `packages/scripts/test/`: `ai-steps.test.ts`.
- `packages/server/test/`: `read-gate-surfaces.test.ts`, `rag-store.test.ts`, `rag-hybrid.test.ts`, `r15-rag-ai.test.ts`, `calendar-feed.test.ts`, `privilege-matrix-admin.test.ts`, `privilege-matrix-api-token.test.ts`, `privilege-matrix-dataapi.test.ts`, `privilege-matrix-mcp.test.ts`, `privilege-matrix-odata.test.ts`, `privilege-matrix-pgwire.test.ts`, `privilege-matrix-scripts.test.ts`, `privilege-matrix-sql.test.ts`, `privilege-matrix-web.test.ts`, `privilege-matrix-xml.test.ts`.

Also red on main, per the repair brief: `packages/store/test/consistency.test.ts` retains its four pre-existing failing TODO probes (SQL accent equality, date overflow, time overflow, web date normalization). The reported `packages/server/test/container-large-files.test.ts` peak-memory failure did not reproduce here after loopback access was allowed. Combined rerun: **10 passed, 0 hard failures, 4 existing TODO failures**, 12.34 seconds. The initial sandbox run had **9 passed, 1 loopback setup failure, 4 TODO failures**. Neither file was changed.

The following reasons apply to the exact enumerated expressions in each named function. Raw internal materialization and security bookkeeping are explicitly identified as trusted capabilities; they are not independently authorized readers.

| File / function | Gate | Reviewed boundary or repair |
| --- | --- | --- |
| `packages/scripts/src/engine.ts` / `ScriptEngine/record` | SCRIPT | Store.get receives the current script privileges; getCurrent checks the saved row before overlaying pending edits and masks hidden fields. The cache key includes the privilege fingerprint. |
| `packages/scripts/src/engine.ts` / `ScriptEngine/newRecord` | SCRIPT | The other-window found-set comparison calls findIds with this.reading, which carries the current script privileges; findIdsHere applies viewFilter before returning ids. |
| `packages/server/src/backup.ts` / `stageRestorePoint` | OPERATOR | The new SQLite existence probes inspect only a staged restore copy to refuse unsupported external-container replay. Entry is through local restoreAt or server-admin restorePointTo; no record payload is returned. |
| `packages/server/src/containers.ts` / `ContainerFiles/make` | CONTAINER | The new containerInfo read bounds thumbnail input after index.ts validates the signed URL through Host.checkUrl (signature, expiry and bound account identity/inactive state). This private helper is not a route. |
| `packages/server/src/containers.ts` / `ContainerFiles/makeAdmitted` | CONTAINER | The container byte read moved from make into this private admitted helper; it inherits index.ts/Host.checkUrl signed-URL validation and returns only the authorized container thumbnail. |
| `packages/server/src/oauth.ts` / `legacyPasswordMark` | AUTH | Renamed legacy password fingerprint helper: account row id/password hash are hashed for grant validation and startup migration, never returned as solution data or raw credentials. |
| `packages/server/src/oauth.ts` / `OAuthServer/constructor` | AUTH | Startup migration reads refresh grants and matching account/token provenance, relabels valid legacy delegated credentials and revokes invalid grants. These are internal authentication tables, not record results. |
| `packages/server/src/webclient.ts` / `WebClient/refresh` | WEB | getMany retains the session privileges while adding sort state; getManyCurrent filters supplied ids/found-set rows and toRecord masks fields. Hidden summary break/restart fields are now explicitly suppressed. |
| `packages/server/src/webclient.ts` / `WebClient/records` | WEB | foundIds selects visible records and getMany receives session privileges with sort state; its row filter and field masking remain in force, including the repaired summary key checks. |
| `packages/server/src/webclient.ts` / `WebClient/exportRecords` | WEB | canExport is checked, foundIds receives privileges, and each getMany batch retains them while adding sort state; hidden fields are omitted and masked fields export empty. |
| `packages/server/src/webclient.ts` / `WebClient/aiReplace` | WEB | The AI access and editable target-field checks precede getMany batches carrying session privileges; only visible rows/fields reach model input, with secret/container redaction afterward. |
| `packages/store/src/calc.ts` / `Calculations/computed` | CALC | The repetition-aware context retains the caller's Pass, including privileges. User-facing context field reads enforce field visibility; internal stored passes remain trusted materialization. |
| `packages/store/src/calc.ts` / `Calculations/context/summary` | CALC | Repaired: refuse hidden summary and break fields before direct value reads. Found-set rows come from the checked Store caller; the break-key pass carries privileges. related.clear is cache maintenance, not a record read. |
| `packages/store/src/calc.ts` / `Calculations/beforeWrite` | CORE | Repetition-aware contexts compute persisted auto-enter/stored values inside checked create/update paths. This is intentionally full-data internal materialization, not an independently account-gated reader; later toRecord/context reads apply visibility. |
| `packages/store/src/calc.ts` / `Calculations/computeStoredStyled` | CORE | Repetition-aware contexts materialize stored calculation values and styles for internal write/recompute callers. No account gate exists here; returned storage values are exposed only through checked record/calculation readers. |
| `packages/store/src/store.ts` / `Store/constructor` | CORE | The new Store.sql references register deterministic sort-key and first-repetition SQL functions. They do not read or return solution rows; opening the raw store remains an operator/internal capability. |
| `packages/store/src/store.ts` / `Store/joinTransaction` | CORE | The new createSession capability records pending transaction changes after transaction ownership checks. It is private write bookkeeping, with no account-facing row result. |
| `packages/store/src/store.ts` / `Store/independentWindowWrite` | CORE | ScriptEngine.via invokes this for checked create/update/delete/container operations in another window. The raw audit read retains only held transaction audit entries for internal replay and hash relinking; it is not returned to the caller. No independent read authorization is claimed. |
| `packages/store/src/store.ts` / `Store/setPassword` | AUTH | The new statement deletes delegated API tokens during securityChange. Password/security callers enforce their own account or Full Access authority; this raw mutation primitive does not return credential rows. |
| `packages/store/src/store.ts` / `Store/setAccountActive` | AUTH | The added statements rotate identity and revoke account/person/mapping tokens on deactivation inside securityChange. SecurityApi requires Full Access; script account-management callers check their authority. No solution data is returned. |
| `packages/store/src/store.ts` / `Store/signInMark` | AUTH | The new prepared statement persists an authentication generation after rereading the current fingerprint under ledgerWrite. Only generation plus a cryptographic fingerprint leaves this internal helper. |
| `packages/store/src/store.ts` / `Store/signInBase` | AUTH | Reads identity/password metadata solely to hash credentials and authority for session invalidation; raw metadata is not returned. |
| `packages/store/src/store.ts` / `Store/signInBase/identity` | AUTH | Reads only the selected mapping/person identity id into signInBase's hash; no solution records or raw credentials are exposed. |
| `packages/store/src/store.ts` / `Store/ledgerRow` | AUTH | Private schema-presence and main sign-in-ledger reads serve signInMark/settleSignIns. The generation is validated; ledger rows remain inside authentication bookkeeping. |
| `packages/store/src/store.ts` / `Store/ledgerWrite` | AUTH | Private SQL capabilities create the sign-in ledger and manage its transaction. Used only by signInMark/settleSignIns; no record-result exposure or independent account gate is claimed. |
| `packages/store/src/store.ts` / `Store/settleSignIns` | AUTH | Private securityChange bookkeeping reads live account names and ledger keys, removes obsolete identities and advances generations atomically. These internal authentication lists are not returned to clients. |
| `packages/store/src/store.ts` / `Store/savePrivilegeSet` | AUTH | The added token deletion revokes credentials for accounts whose authority changed. SecurityApi requires Full Access and internal bootstrap uses operator authority; no record data is returned. |
| `packages/store/src/store.ts` / `Store/setAccountPrivilegeSet` | AUTH | The added token deletion revokes credentials when an account's effective set changes. Security/admin/script-management callers authorize the mutation; this raw security primitive exposes no record rows. |
| `packages/store/src/store.ts` / `Store/portalCountsCurrent` | GATED-STORE | Account-bearing calls resolve the current layout and checkLayout/canView before any cached count. Only account-free snapshots bypass metadata refresh; restricted callers recompute related counts. |
| `packages/store/src/store.ts` / `Store/findHere` | GATED-STORE | The running-summary id query and repeated found-set portal query use where/params already combined with viewFilter; checkFieldsVisible validates find/sort fields and the public find entry checks the layout. |
| `packages/store/src/store.ts` / `Store/runningSummaryValues` | GATED-STORE | viewableIds filters rows before accumulation and source fields are checked with fieldHidden. Repaired: hidden restart fields in supplied sort state suppress the running result before calc.value; pass privileges follow calculations. related.clear only clears a cache. |
| `packages/store/src/store.ts` / `Store/getCurrent` | GATED-STORE | checkLayout and checkRecordRule precede pending-edit overlay; running-summary ids use viewFilter and toRecord masks output. opts.row references are typed row-supply capability references, not additional SQL reads. |
| `packages/store/src/store.ts` / `Store/groupSummariesCurrent` | GATED-STORE | Layout/table/group-key checks and viewableIds filter supplied ids before fraction totals collect rowsById; visible summary definitions and a privilege-bearing calculation pass govern aggregation. |

<!-- generated read-gate inventory -->
| Function | Store read / capability (source lines) | Gate |
| --- | --- | --- |
| [packages/cli/src/diagnostics.ts:202](../../packages/cli/src/diagnostics.ts#L202) `designCopy` | `SQLite.all` (202); `SQLite.prepare` (202, 205) | OPERATOR |
| [packages/cli/src/diagnostics.ts:441](../../packages/cli/src/diagnostics.ts#L441) `diagnostics` | `SQLite.get` (441); `SQLite.prepare` (441, 445); `SQLite.all` (445) | OPERATOR |
| [packages/cli/src/doctor.ts:139](../../packages/cli/src/doctor.ts#L139) `accountChecks` | `SQLite.all` (139); `SQLite.prepare` (139) | OPERATOR |
| [packages/cli/src/main.ts:645](../../packages/cli/src/main.ts#L645) `accountsWithPasswordOff` | `SQLite.all` (645); `SQLite.prepare` (645) | OPERATOR |
| [packages/cli/src/main.ts:674](../../packages/cli/src/main.ts#L674) `hostedRead` | `SQLite.all` (674, 677); `SQLite.prepare` (674, 677); `Store.sql` (674, 677) | OPERATOR |
| [packages/cli/src/main.ts:2245](../../packages/cli/src/main.ts#L2245) `main` | `Store.orphanContainerReport` (2245); `Store.auditLog` (2707); `SQLite.get` (2923); `SQLite.prepare` (2923) | OPERATOR |
| [packages/scripts/src/data-api-step.ts:103](../../packages/scripts/src/data-api-step.ts#L103) `respond` | `Store.get` (103, 130, 139); `Store.find` (104, 116) | SCRIPT |
| [packages/scripts/src/engine.ts:1908](../../packages/scripts/src/engine.ts#L1908) `ScriptEngine/goToLayout` | `Store.findIds` (1908) | SCRIPT |
| [packages/scripts/src/engine.ts:2245](../../packages/scripts/src/engine.ts#L2245) `ScriptEngine/foundSet` | `Store.findIds` (2245) | SCRIPT |
| [packages/scripts/src/engine.ts:2310](../../packages/scripts/src/engine.ts#L2310) `ScriptEngine/semanticFind` | `Store.findIds` (2310, 2331) | SCRIPT |
| [packages/scripts/src/engine.ts:3184](../../packages/scripts/src/engine.ts#L3184) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3184); `Calculations.executeSQL` (3191) | SCRIPT |
| [packages/scripts/src/engine.ts:3223](../../packages/scripts/src/engine.ts#L3223) `ScriptEngine/sortIds` | `Store.sortIds` (3223); `Store.valueListItems` (3229) | SCRIPT |
| [packages/scripts/src/engine.ts:3320](../../packages/scripts/src/engine.ts#L3320) `ScriptEngine/revertTransaction` | `Store.findIds` (3320) | SCRIPT |
| [packages/scripts/src/engine.ts:3868](../../packages/scripts/src/engine.ts#L3868) `ScriptEngine/step` | `Store.fieldIndex` (3868); `Store.findIds` (4002, 4097) | SCRIPT |
| [packages/scripts/src/engine.ts:5118](../../packages/scripts/src/engine.ts#L5118) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5118) | SCRIPT |
| [packages/scripts/src/engine.ts:5126](../../packages/scripts/src/engine.ts#L5126) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5126) | SCRIPT |
| [packages/scripts/src/engine.ts:5127](../../packages/scripts/src/engine.ts#L5127) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5127) | SCRIPT |
| [packages/scripts/src/engine.ts:5273](../../packages/scripts/src/engine.ts#L5273) `ScriptEngine/get` | `Store.findIds` (5273); `Store.canViewRecord` (5364); `Store.get` (5400) | SCRIPT |
| [packages/scripts/src/engine.ts:5431](../../packages/scripts/src/engine.ts#L5431) `ScriptEngine/design` | `Store.valueListItems` (5431) | SCRIPT |
| [packages/scripts/src/engine.ts:5485](../../packages/scripts/src/engine.ts#L5485) `ScriptEngine/record` | `Store.get` (5485) | SCRIPT |
| [packages/scripts/src/engine.ts:5517](../../packages/scripts/src/engine.ts#L5517) `ScriptEngine/valueOf` | `Store.findIds` (5517); `Store.containerId` (5525) | SCRIPT |
| [packages/scripts/src/engine.ts:5542](../../packages/scripts/src/engine.ts#L5542) `ScriptEngine/lookupNext` | `Store.get` (5542); `Store.row` (5543); `Calculations.context` (5545) | SCRIPT |
| [packages/scripts/src/engine.ts:5645](../../packages/scripts/src/engine.ts#L5645) `ScriptEngine/relatedIds` | `Store.findIds` (5645); `rowsById` (5653); `Store.select` (5657); `Store.matchIds` (5671); `Store.viewableIds` (5694) | SCRIPT |
| [packages/scripts/src/engine.ts:5679](../../packages/scripts/src/engine.ts#L5679) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5679) | SCRIPT |
| [packages/scripts/src/engine.ts:6168](../../packages/scripts/src/engine.ts#L6168) `ScriptEngine/exportField` | `Store.get` (6168); `Store.containerId` (6169); `Store.container` (6171) | SCRIPT |
| [packages/scripts/src/engine.ts:6317](../../packages/scripts/src/engine.ts#L6317) `ScriptEngine/relookup` | `Store.get` (6317) | SCRIPT |
| [packages/scripts/src/engine.ts:6735](../../packages/scripts/src/engine.ts#L6735) `ScriptEngine/goToList` | `Store.findIds` (6735) | SCRIPT |
| [packages/scripts/src/engine.ts:7051](../../packages/scripts/src/engine.ts#L7051) `ScriptEngine/sourceValue` | `Store.get` (7051); `Store.containerId` (7052); `Store.container` (7053) | SCRIPT |
| [packages/scripts/src/engine.ts:7753](../../packages/scripts/src/engine.ts#L7753) `ScriptEngine/containerFile` | `Store.get` (7753); `Store.containerId` (7754); `Store.container` (7755) | SCRIPT |
| [packages/scripts/src/engine.ts:7914](../../packages/scripts/src/engine.ts#L7914) `ScriptEngine/importRecords` | `Store.findIds` (7914); `Store.get` (7934) | SCRIPT |
| [packages/scripts/src/engine.ts:8132](../../packages/scripts/src/engine.ts#L8132) `ScriptEngine/fileMakerRows` | `Store.findIds` (8132); `Store.get` (8137) | SCRIPT |
| [packages/scripts/src/engine.ts:8172](../../packages/scripts/src/engine.ts#L8172) `ScriptEngine/newRecord` | `Store.findIds` (8172) | SCRIPT |
| [packages/scripts/src/engine.ts:8469](../../packages/scripts/src/engine.ts#L8469) `ScriptEngine/performFind` | `Store.findIds` (8469) | SCRIPT |
| [packages/scripts/src/engine.ts:8494](../../packages/scripts/src/engine.ts#L8494) `ScriptEngine/findRelated` | `Store.findIds` (8494, 8504, 8507) | SCRIPT |
| [packages/scripts/src/engine.ts:8526](../../packages/scripts/src/engine.ts#L8526) `ScriptEngine/quickFind` | `Store.findIds` (8526, 8527, 8530) | SCRIPT |
| [packages/scripts/src/engine.ts:8895](../../packages/scripts/src/engine.ts#L8895) `clearRecords` | `SQLite.all` (8895); `SQLite.prepare` (8895) | SCRIPT |
| [packages/scripts/src/recorder.ts:72](../../packages/scripts/src/recorder.ts#L72) `lastSeq` | `Store.auditLog` (72) | DESIGN |
| [packages/scripts/src/recorder.ts:104](../../packages/scripts/src/recorder.ts#L104) `recordRun` | `Store.auditLog` (104) | DESIGN |
| [packages/scripts/src/script-tests.ts:211](../../packages/scripts/src/script-tests.ts#L211) `runCase` | `Store.findIds` (211); `Store.auditLog` (218, 219, 261); `Store.evaluateEach` (245) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/server/src/admin.ts:958](../../packages/server/src/admin.ts#L958) `Admin/handle` | `Store.externalContainerReport` (958); `Store.orphanContainerReport` (963, 967) | ADMIN |
| [packages/server/src/admin.ts:2077](../../packages/server/src/admin.ts#L2077) `Admin/audit` | `Store.auditLog` (2077) | ADMIN |
| [packages/server/src/admin.ts:2160](../../packages/server/src/admin.ts#L2160) `Admin/viewAs` | `Store.find` (2160) | ADMIN |
| [packages/server/src/admin.ts:2508](../../packages/server/src/admin.ts#L2508) `Admin/status` | `Store.externalContainerCount` (2508) | ADMIN |
| [packages/server/src/agent.ts:154](../../packages/server/src/agent.ts#L154) `runStep/visible` | `Store.findIds` (154) | DESIGN |
| [packages/server/src/agent.ts:162](../../packages/server/src/agent.ts#L162) `runStep` | `Store.findIds` (162); `Store.auditLog` (221) | DESIGN |
| [packages/server/src/agent.ts:303](../../packages/server/src/agent.ts#L303) `dryRunPlan` | `Store.findIds` (303) | DESIGN |
| [packages/server/src/agent.ts:326](../../packages/server/src/agent.ts#L326) `runApprovedStep` | `Store.findIds` (326) | DESIGN |
| [packages/server/src/ai-output.ts:142](../../packages/server/src/ai-output.ts#L142) `storedSecretValues` | `Calculations.globalValue` (142); `Store.select` (147) | REDACTION |
| [packages/server/src/ai-policy-sql.ts:32](../../packages/server/src/ai-policy-sql.ts#L32) `sqlFieldRefs` | `SQLite.all` (32, 34); `SQLite.prepare` (32, 34) | POLICY |
| [packages/server/src/ai-policy.ts:332](../../packages/server/src/ai-policy.ts#L332) `sql` | `Store.inspectQuery` (332) | POLICY |
| [packages/server/src/ai-usage.ts:141](../../packages/server/src/ai-usage.ts#L141) `AiUsage/today` | `SQLite.get` (141); `SQLite.prepare` (141) | AUTH |
| [packages/server/src/ai-usage.ts:148](../../packages/server/src/ai-usage.ts#L148) `AiUsage/month` | `SQLite.get` (148); `SQLite.prepare` (148) | AUTH |
| [packages/server/src/ai-usage.ts:155](../../packages/server/src/ai-usage.ts#L155) `AiUsage/recent` | `SQLite.all` (155); `SQLite.prepare` (155) | AUTH |
| [packages/server/src/ai-usage.ts:163](../../packages/server/src/ai-usage.ts#L163) `AiUsage/add` | `SQLite.prepare` (163, 166) | AUTH |
| [packages/server/src/ai-usage.ts:174](../../packages/server/src/ai-usage.ts#L174) `AiUsage/question` | `SQLite.prepare` (174, 176, 177, 179) | AUTH |
| [packages/server/src/ai-usage.ts:203](../../packages/server/src/ai-usage.ts#L203) `AiUsage/importOld` | `SQLite.prepare` (203, 213, 221, 225) | AUTH |
| [packages/server/src/assistant.ts:2049](../../packages/server/src/assistant.ts#L2049) `Assistant/answer` | `Store.find` (2049) | ACCOUNT |
| [packages/server/src/automations.ts:165](../../packages/server/src/automations.ts#L165) `Saved/table` | `Store.sql` (165, 166) | AUTOMATION |
| [packages/server/src/automations.ts:176](../../packages/server/src/automations.ts#L176) `Saved/list` | `SQLite.all` (176); `SQLite.prepare` (176); `Store.sql` (176) | AUTOMATION |
| [packages/server/src/automations.ts:186](../../packages/server/src/automations.ts#L186) `Saved/save` | `SQLite.prepare` (186); `Store.sql` (186) | AUTOMATION |
| [packages/server/src/automations.ts:192](../../packages/server/src/automations.ts#L192) `Saved/delete` | `SQLite.prepare` (192, 194); `Store.sql` (192, 194) | AUTOMATION |
| [packages/server/src/automations.ts:199](../../packages/server/src/automations.ts#L199) `Saved/logRun` | `SQLite.prepare` (199, 201); `Store.sql` (199, 201) | AUTOMATION |
| [packages/server/src/automations.ts:206](../../packages/server/src/automations.ts#L206) `Saved/runs` | `SQLite.all` (206); `SQLite.prepare` (206); `Store.sql` (206) | AUTOMATION |
| [packages/server/src/automations.ts:294](../../packages/server/src/automations.ts#L294) `dryRunAutomation/truth` | `Store.evaluateEach` (294) | AUTOMATION |
| [packages/server/src/automations.ts:295](../../packages/server/src/automations.ts#L295) `dryRunAutomation` | `Store.canViewRecord` (295); `Store.findIds` (295); `Store.auditLog` (311, 339, 347); `Store.select` (324); `Store.evaluate` (340) | AUTOMATION |
| [packages/server/src/automations.ts:422](../../packages/server/src/automations.ts#L422) `AutomationRunner/changed` | `Store.auditLog` (422) | AUTOMATION |
| [packages/server/src/automations.ts:446](../../packages/server/src/automations.ts#L446) `AutomationRunner/run` | `Store.select` (446); `Store.canViewRecord` (456); `Store.evaluateEach` (459); `Store.evaluate` (465) | AUTOMATION |
| [packages/server/src/automations.ts:489](../../packages/server/src/automations.ts#L489) `AutomationRunner/runDeleted` | `Store.auditLog` (489) | AUTOMATION |
| [packages/server/src/backup-verify.ts:147](../../packages/server/src/backup-verify.ts#L147) `testRestore` | `Store.recordCount` (147) | OPERATOR |
| [packages/server/src/backup-verify.ts:187](../../packages/server/src/backup-verify.ts#L187) `integrity` | `SQLite.all` (187); `SQLite.prepare` (187, 191); `SQLite.get` (191) | OPERATOR |
| [packages/server/src/backup-verify.ts:217](../../packages/server/src/backup-verify.ts#L217) `pageCheck` | `SQLite.all` (217); `SQLite.prepare` (217, 220); `SQLite.get` (220) | OPERATOR |
| [packages/server/src/backup.ts:242](../../packages/server/src/backup.ts#L242) `backupOnce` | `SQLite.get` (242); `SQLite.prepare` (242) | OPERATOR |
| [packages/server/src/backup.ts:953](../../packages/server/src/backup.ts#L953) `accountDifferences/read` | `SQLite.all` (953, 955); `SQLite.prepare` (953, 955) | OPERATOR |
| [packages/server/src/backup.ts:980](../../packages/server/src/backup.ts#L980) `readNames` | `SQLite.all` (980); `SQLite.prepare` (980) | OPERATOR |
| [packages/server/src/backup.ts:1010](../../packages/server/src/backup.ts#L1010) `credentialsReadable` | `SQLite.all` (1010); `SQLite.prepare` (1010) | OPERATOR |
| [packages/server/src/backup.ts:1026](../../packages/server/src/backup.ts#L1026) `columnInfo` | `SQLite.all` (1026); `SQLite.prepare` (1026) | OPERATOR |
| [packages/server/src/backup.ts:1061](../../packages/server/src/backup.ts#L1061) `reconcileCredentials` | `SQLite.all` (1061, 1083, 1098, 1108, 1114); `SQLite.prepare` (1061, 1069, 1083, 1085, 1098, 1099, 1106, 1108, 1109, 1114, 1115, 1119, 1120, 1121); `SQLite.get` (1069, 1119) | OPERATOR |
| [packages/server/src/backup.ts:1064](../../packages/server/src/backup.ts#L1064) `reconcileCredentials/has` | `SQLite.all` (1064); `SQLite.prepare` (1064) | OPERATOR |
| [packages/server/src/backup.ts:1088](../../packages/server/src/backup.ts#L1088) `reconcileCredentials/accountColumns` | `SQLite.all` (1088); `SQLite.prepare` (1088) | OPERATOR |
| [packages/server/src/backup.ts:1233](../../packages/server/src/backup.ts#L1233) `stageRestorePoint` | `SQLite.get` (1233, 1235, 1236); `SQLite.prepare` (1233, 1235, 1236) | OPERATOR |
| [packages/server/src/calendar.ts:389](../../packages/server/src/calendar.ts#L389) `CalendarFeeds/feed` | `Store.find` (389) | CALENDAR |
| [packages/server/src/changes.ts:184](../../packages/server/src/changes.ts#L184) `ChangeFeed/visible` | `Store.canViewRecord` (184) | CHANGE |
| [packages/server/src/cleanup.ts:306](../../packages/server/src/cleanup.ts#L306) `scanData` | `Store.findIds` (306); `Store.select` (312) | CLEANUP |
| [packages/server/src/cleanup.ts:563](../../packages/server/src/cleanup.ts#L563) `keyValue` | `SQLite.get` (563); `SQLite.prepare` (563); `Store.sql` (563) | CLEANUP |
| [packages/server/src/cleanup.ts:567](../../packages/server/src/cleanup.ts#L567) `relatedIds` | `SQLite.all` (567); `SQLite.prepare` (567); `Store.sql` (567) | CLEANUP |
| [packages/server/src/cleanup.ts:684](../../packages/server/src/cleanup.ts#L684) `applyCleanup/apply` | `Store.findIds` (684, 694); `SQLite.all` (685); `SQLite.prepare` (685, 722); `Store.sql` (685, 722); `SQLite.get` (722) | CLEANUP |
| [packages/server/src/cleanup.ts:753](../../packages/server/src/cleanup.ts#L753) `snapshotField` | `SQLite.all` (753); `SQLite.prepare` (753); `Store.sql` (753) | CLEANUP |
| [packages/server/src/cleanup.ts:813](../../packages/server/src/cleanup.ts#L813) `snapshotRows` | `SQLite.all` (813); `SQLite.prepare` (813); `Store.sql` (813) | CLEANUP |
| [packages/server/src/cleanup.ts:822](../../packages/server/src/cleanup.ts#L822) `journalDeletes` | `SQLite.get` (822); `SQLite.prepare` (822); `Store.sql` (822) | CLEANUP |
| [packages/server/src/cleanup.ts:872](../../packages/server/src/cleanup.ts#L872) `updateMany` | `Store.findIds` (872) | CLEANUP |
| [packages/server/src/cleanup.ts:932](../../packages/server/src/cleanup.ts#L932) `undoCleanup` | `SQLite.get` (932, 948); `SQLite.prepare` (932, 948); `Store.sql` (932, 948) | CLEANUP |
| [packages/server/src/cleanup.ts:972](../../packages/server/src/cleanup.ts#L972) `CleanupJournal/constructor` | `Store.sql` (972) | CLEANUP |
| [packages/server/src/cleanup.ts:981](../../packages/server/src/cleanup.ts#L981) `CleanupJournal/append` | `SQLite.prepare` (981); `Store.sql` (981) | CLEANUP |
| [packages/server/src/cleanup.ts:986](../../packages/server/src/cleanup.ts#L986) `CleanupJournal/add` | `SQLite.prepare` (986); `Store.sql` (986) | CLEANUP |
| [packages/server/src/cleanup.ts:992](../../packages/server/src/cleanup.ts#L992) `CleanupJournal/get` | `SQLite.get` (992); `SQLite.prepare` (992); `Store.sql` (992) | CLEANUP |
| [packages/server/src/cleanup.ts:997](../../packages/server/src/cleanup.ts#L997) `CleanupJournal/list` | `SQLite.all` (997); `SQLite.prepare` (997); `Store.sql` (997) | CLEANUP |
| [packages/server/src/cleanup.ts:1001](../../packages/server/src/cleanup.ts#L1001) `CleanupJournal/markUndone` | `SQLite.prepare` (1001); `Store.sql` (1001) | CLEANUP |
| [packages/server/src/compare.ts:203](../../packages/server/src/compare.ts#L203) `count` | `Store.query` (203) | DESIGN |
| [packages/server/src/containers.ts:120](../../packages/server/src/containers.ts#L120) `ContainerFiles/send` | `Store.containerInfo` (120); `Store.container` (187); `Store.containerRange` (196) | CONTAINER |
| [packages/server/src/containers.ts:286](../../packages/server/src/containers.ts#L286) `ContainerFiles/make` | `Store.containerInfo` (286) | CONTAINER |
| [packages/server/src/containers.ts:298](../../packages/server/src/containers.ts#L298) `ContainerFiles/makeAdmitted` | `Store.container` (298) | CONTAINER |
| [packages/server/src/conversion-guide.ts:118](../../packages/server/src/conversion-guide.ts#L118) `convertedAt` | `SQLite.get` (118); `SQLite.prepare` (118); `Store.sql` (118) | DESIGN |
| [packages/server/src/conversion-guide.ts:323](../../packages/server/src/conversion-guide.ts#L323) `ConversionGuides/table` | `Store.sql` (323) | DESIGN |
| [packages/server/src/conversion-guide.ts:333](../../packages/server/src/conversion-guide.ts#L333) `ConversionGuides/saved` | `SQLite.get` (333); `SQLite.prepare` (333); `Store.sql` (333) | DESIGN |
| [packages/server/src/conversion-guide.ts:339](../../packages/server/src/conversion-guide.ts#L339) `ConversionGuides/save` | `SQLite.prepare` (339); `Store.sql` (339) | DESIGN |
| [packages/server/src/conversion.ts:287](../../packages/server/src/conversion.ts#L287) `conversionReport` | `Store.externalContainerCheck` (287) | DESIGN |
| [packages/server/src/cwp-xml.ts:457](../../packages/server/src/cwp-xml.ts#L457) `CwpXmlEndpoint/records` | `Store.find` (457, 459, 460, 466, 469); `Store.get` (465, 473) | XML |
| [packages/server/src/cwp-xml.ts:541](../../packages/server/src/cwp-xml.ts#L541) `CwpXmlEndpoint/layoutDoc` | `Store.valueListItems` (541) | XML |
| [packages/server/src/dashboards.ts:327](../../packages/server/src/dashboards.ts#L327) `Dashboards/table` | `Store.sql` (327) | DASHBOARD |
| [packages/server/src/dashboards.ts:337](../../packages/server/src/dashboards.ts#L337) `Dashboards/list` | `SQLite.all` (337); `SQLite.prepare` (337); `Store.sql` (337) | DASHBOARD |
| [packages/server/src/dashboards.ts:343](../../packages/server/src/dashboards.ts#L343) `Dashboards/get` | `SQLite.get` (343); `SQLite.prepare` (343); `Store.sql` (343) | DASHBOARD |
| [packages/server/src/dashboards.ts:357](../../packages/server/src/dashboards.ts#L357) `Dashboards/create` | `SQLite.prepare` (357); `Store.sql` (357) | DASHBOARD |
| [packages/server/src/dashboards.ts:370](../../packages/server/src/dashboards.ts#L370) `Dashboards/update` | `SQLite.prepare` (370); `Store.sql` (370) | DASHBOARD |
| [packages/server/src/dashboards.ts:377](../../packages/server/src/dashboards.ts#L377) `Dashboards/delete` | `SQLite.prepare` (377); `Store.sql` (377) | DASHBOARD |
| [packages/server/src/dataapi.ts:1911](../../packages/server/src/dataapi.ts#L1911) `DataApi/route` | `Store.get` (1911, 2133, 2156, 2164, 2211, 2235, 2255, 2292); `Store.valueListItems` (1926); `Store.find` (2088, 2135, 2325); `Store.findIds` (2092, 2330); `Store.query` (2330) | REST |
| [packages/server/src/dataapi.ts:2040](../../packages/server/src/dataapi.ts#L2040) `DataApi/route/recordOut` | `Store.portalCounts` (2040) | REST |
| [packages/server/src/dataapi.ts:2076](../../packages/server/src/dataapi.ts#L2076) `DataApi/route/shownAs` | `Store.get` (2076) | REST |
| [packages/server/src/debug.ts:183](../../packages/server/src/debug.ts#L183) `learnStoredCredentials` | `Calculations.globalValue` (183); `Store.sql` (189, 199, 199); `SQLite.iterate` (199, 199); `SQLite.prepare` (199, 199); `Store.iterateCommitted` (199) | DESIGN |
| [packages/server/src/debug.ts:309](../../packages/server/src/debug.ts#L309) `DebugApi/handle` | `Store.row` (309); `Store.get` (316); `Store.evaluate` (332) | DESIGN |
| [packages/server/src/design.ts:233](../../packages/server/src/design.ts#L233) `containerData` | `Store.query` (233) | DESIGN |
| [packages/server/src/design.ts:242](../../packages/server/src/design.ts#L242) `recordCount` | `Store.query` (242) | DESIGN |
| [packages/server/src/design.ts:730](../../packages/server/src/design.ts#L730) `DesignApi/handle` | `Store.auditLog` (730); `Store.evaluate` (797) | DESIGN |
| [packages/server/src/digests.ts:168](../../packages/server/src/digests.ts#L168) `Digests/table` | `Store.sql` (168) | DIGEST |
| [packages/server/src/digests.ts:179](../../packages/server/src/digests.ts#L179) `Digests/list` | `SQLite.all` (179); `SQLite.prepare` (179); `Store.sql` (179) | DIGEST |
| [packages/server/src/digests.ts:185](../../packages/server/src/digests.ts#L185) `Digests/get` | `SQLite.get` (185); `SQLite.prepare` (185); `Store.sql` (185) | DIGEST |
| [packages/server/src/digests.ts:192](../../packages/server/src/digests.ts#L192) `Digests/lastSlot` | `SQLite.get` (192); `SQLite.prepare` (192); `Store.sql` (192) | DIGEST |
| [packages/server/src/digests.ts:196](../../packages/server/src/digests.ts#L196) `Digests/markSlot` | `SQLite.prepare` (196); `Store.sql` (196) | DIGEST |
| [packages/server/src/digests.ts:204](../../packages/server/src/digests.ts#L204) `Digests/create` | `SQLite.prepare` (204); `Store.sql` (204) | DIGEST |
| [packages/server/src/digests.ts:213](../../packages/server/src/digests.ts#L213) `Digests/update` | `SQLite.prepare` (213); `Store.sql` (213) | DIGEST |
| [packages/server/src/digests.ts:221](../../packages/server/src/digests.ts#L221) `Digests/delete` | `SQLite.prepare` (221, 222); `Store.sql` (221, 222) | DIGEST |
| [packages/server/src/digests.ts:227](../../packages/server/src/digests.ts#L227) `Digests/addRun` | `SQLite.prepare` (227, 228); `Store.sql` (227, 228) | DIGEST |
| [packages/server/src/digests.ts:234](../../packages/server/src/digests.ts#L234) `Digests/runs` | `SQLite.all` (234); `SQLite.prepare` (234); `Store.sql` (234) | DIGEST |
| [packages/server/src/docs.ts:155](../../packages/server/src/docs.ts#L155) `count` | `Store.query` (155) | DESIGN |
| [packages/server/src/dry-run.ts:92](../../packages/server/src/dry-run.ts#L92) `dryRunChanges/runOnce` | `Store.auditLog` (92, 96) | DESIGN |
| [packages/server/src/find-advice.ts:99](../../packages/server/src/find-advice.ts#L99) `findAdvice` | `Store.recordCount` (99) | DESIGN |
| [packages/server/src/formula-preview.ts:31](../../packages/server/src/formula-preview.ts#L31) `previewFormula` | `Store.findIds` (31); `Store.evaluate` (42) | DESIGN |
| [packages/server/src/import-mapping.ts:497](../../packages/server/src/import-mapping.ts#L497) `existingKeys` | `Store.viewableIds` (497); `Store.query` (499) | IMPORT |
| [packages/server/src/import-mapping.ts:755](../../packages/server/src/import-mapping.ts#L755) `applyImportRun` | `SQLite.prepare` (755); `Store.sql` (755) | IMPORT |
| [packages/server/src/import-mapping.ts:772](../../packages/server/src/import-mapping.ts#L772) `targetKeys` | `SQLite.all` (772); `SQLite.prepare` (772); `Store.sql` (772) | IMPORT |
| [packages/server/src/import-mapping.ts:784](../../packages/server/src/import-mapping.ts#L784) `journal` | `Store.sql` (784, 787, 787); `SQLite.all` (787); `SQLite.prepare` (787) | IMPORT |
| [packages/server/src/import-mapping.ts:829](../../packages/server/src/import-mapping.ts#L829) `importHistory` | `SQLite.all` (829); `SQLite.prepare` (829); `Store.sql` (829) | IMPORT |
| [packages/server/src/import-mapping.ts:836](../../packages/server/src/import-mapping.ts#L836) `undoImportRun` | `SQLite.get` (836, 859); `SQLite.prepare` (836, 859, 873); `Store.sql` (836, 859, 873) | IMPORT |
| [packages/server/src/insight.ts:316](../../packages/server/src/insight.ts#L316) `webViewerScripts` | `Store.query` (316) | DESIGN |
| [packages/server/src/insight.ts:757](../../packages/server/src/insight.ts#L757) `layoutProfile/viewableIds` | `Store.viewableIds` (757) | PROFILE |
| [packages/server/src/insight.ts:761](../../packages/server/src/insight.ts#L761) `layoutProfile` | `Store.query` (761) | PROFILE |
| [packages/server/src/insight.ts:837](../../packages/server/src/insight.ts#L837) `columnProfile` | `Store.query` (837, 844, 856, 859) | PROFILE |
| [packages/server/src/insight.ts:916](../../packages/server/src/insight.ts#L916) `checkCalculation` | `Store.findIds` (916); `Store.evaluate` (920) | DESIGN |
| [packages/server/src/insight.ts:1099](../../packages/server/src/insight.ts#L1099) `solutionOverview/counts` | `Store.query` (1099) | DESIGN |
| [packages/server/src/live.ts:137](../../packages/server/src/live.ts#L137) `Live/handle` | `Store.canViewRecord` (137, 144); `Store.canView` (189) | LIVE |
| [packages/server/src/live.ts:276](../../packages/server/src/live.ts#L276) `Live/stream/listener` | `Store.canViewRecord` (276, 278) | LIVE |
| [packages/server/src/logs.ts:76](../../packages/server/src/logs.ts#L76) `LogShipper/follow` | `SQLite.get` (76); `SQLite.prepare` (76); `Store.sql` (76, 77, 78, 79) | ADMIN |
| [packages/server/src/logs.ts:88](../../packages/server/src/logs.ts#L88) `LogShipper/releaseIfIdle` | `Store.sql` (88) | ADMIN |
| [packages/server/src/mcp-design.ts:508](../../packages/server/src/mcp-design.ts#L508) `registerDesignTools/audit_log` | `Store.auditLog` (508) | DESIGN |
| [packages/server/src/mcp.ts:963](../../packages/server/src/mcp.ts#L963) `createMcpServer/find_records` | `Store.find` (963) | MCP |
| [packages/server/src/mcp.ts:976](../../packages/server/src/mcp.ts#L976) `createMcpServer/get_record` | `Store.get` (976) | MCP |
| [packages/server/src/mcp.ts:1026](../../packages/server/src/mcp.ts#L1026) `createMcpServer/update_record` | `Store.get` (1026, 1030) | MCP |
| [packages/server/src/mcp.ts:1083](../../packages/server/src/mcp.ts#L1083) `createMcpServer/evaluate_calculation` | `Store.get` (1083, 1091); `Store.find` (1084); `Store.evaluate` (1085); `Store.row` (1090) | SQL |
| [packages/server/src/mcp.ts:1158](../../packages/server/src/mcp.ts#L1158) `createMcpServer/get_container` | `Store.container` (1158) | SQL |
| [packages/server/src/mcp.ts:1182](../../packages/server/src/mcp.ts#L1182) `createMcpServer/sql_query` | `Store.queryWithOrigins` (1182) | SQL |
| [packages/server/src/mcp.ts:1339](../../packages/server/src/mcp.ts#L1339) `createMcpServer/explain_value` | `Store.get` (1339); `Store.row` (1340) | MCP |
| [packages/server/src/mcp.ts:1362](../../packages/server/src/mcp.ts#L1362) `createMcpServer/check_record` | `Store.get` (1362); `Store.row` (1364) | MCP |
| [packages/server/src/mcp.ts:1386](../../packages/server/src/mcp.ts#L1386) `createMcpServer/explain_related` | `Store.get` (1386) | MCP |
| [packages/server/src/mcp.ts:2283](../../packages/server/src/mcp.ts#L2283) `registerResources/audit` | `Store.auditLog` (2283) | MCP |
| [packages/server/src/oauth.ts:59](../../packages/server/src/oauth.ts#L59) `storedName` | `SQLite.get` (59); `SQLite.prepare` (59); `Store.sql` (59) | AUTH |
| [packages/server/src/oauth.ts:70](../../packages/server/src/oauth.ts#L70) `legacyPasswordMark` | `SQLite.get` (70); `SQLite.prepare` (70); `Store.sql` (70) | AUTH |
| [packages/server/src/oauth.ts:164](../../packages/server/src/oauth.ts#L164) `OAuthServer/constructor/cols` | `SQLite.all` (164); `SQLite.prepare` (164) | AUTH |
| [packages/server/src/oauth.ts:170](../../packages/server/src/oauth.ts#L170) `OAuthServer/constructor` | `SQLite.all` (170); `SQLite.prepare` (170, 182, 184, 187, 188, 191); `SQLite.iterate` (182); `SQLite.get` (184); `Store.sql` (184, 187) | AUTH |
| [packages/server/src/oauth.ts:303](../../packages/server/src/oauth.ts#L303) `OAuthServer/register` | `SQLite.prepare` (303, 304, 305, 306, 309); `SQLite.get` (304, 306) | AUTH |
| [packages/server/src/oauth.ts:320](../../packages/server/src/oauth.ts#L320) `OAuthServer/client` | `SQLite.get` (320); `SQLite.prepare` (320) | AUTH |
| [packages/server/src/oauth.ts:410](../../packages/server/src/oauth.ts#L410) `OAuthServer/authorize/done` | `SQLite.prepare` (410, 411) | AUTH |
| [packages/server/src/oauth.ts:428](../../packages/server/src/oauth.ts#L428) `OAuthServer/authorize` | `SQLite.get` (428); `SQLite.prepare` (428, 432, 434, 441, 464, 465) | AUTH |
| [packages/server/src/oauth.ts:609](../../packages/server/src/oauth.ts#L609) `OAuthServer/token` | `SQLite.get` (609, 630); `SQLite.prepare` (609, 630) | AUTH |
| [packages/server/src/oauth.ts:660](../../packages/server/src/oauth.ts#L660) `OAuthServer/issue` | `SQLite.prepare` (660, 661) | AUTH |
| [packages/server/src/oauth.ts:667](../../packages/server/src/oauth.ts#L667) `OAuthServer/sweep` | `SQLite.all` (667); `SQLite.prepare` (667, 669) | AUTH |
| [packages/server/src/oauth.ts:676](../../packages/server/src/oauth.ts#L676) `OAuthServer/revoke` | `SQLite.get` (676, 683); `SQLite.prepare` (676, 683, 686) | AUTH |
| [packages/server/src/odata-crossjoin-worker.ts:40](../../packages/server/src/odata-crossjoin-worker.ts#L40) `join` | `SQLite.prepare` (40, 49, 58, 73); `SQLite.get` (58); `SQLite.all` (73) | JOIN |
| [packages/server/src/odata.ts:926](../../packages/server/src/odata.ts#L926) `ODataEndpoint/resource` | `Store.countIds` (926); `Store.get` (966, 973, 1080) | ODATA |
| [packages/server/src/odata.ts:1212](../../packages/server/src/odata.ts#L1212) `ODataEndpoint/lambdaFor` | `Store.selectIds` (1212); `Store.row` (1221); `relatedIdList` (1222) | ODATA |
| [packages/server/src/odata.ts:1275](../../packages/server/src/odata.ts#L1275) `ODataEndpoint/list` | `Store.selectIds` (1275); `Store.getMany` (1280); `Store.computeValues` (1281); `Store.countIds` (1286) | ODATA |
| [packages/server/src/odata.ts:1333](../../packages/server/src/odata.ts#L1333) `ODataEndpoint/applied` | `Store.selectIds` (1333); `SQLite.prepare` (1348, 1385, 1398, 1402); `Store.getMany` (1359); `SQLite.all` (1398); `SQLite.get` (1402) | ODATA |
| [packages/server/src/odata.ts:1452](../../packages/server/src/odata.ts#L1452) `ODataEndpoint/crossjoined` | `Store.selectIds` (1452); `Store.getMany` (1481, 1516) | ODATA |
| [packages/server/src/odata.ts:1552](../../packages/server/src/odata.ts#L1552) `ODataEndpoint/entity` | `Store.getMany` (1552) | ODATA |
| [packages/server/src/odata.ts:1584](../../packages/server/src/odata.ts#L1584) `ODataEndpoint/relatedIds` | `Store.row` (1584); `relatedIdList` (1587, 1602); `Store.selectIds` (1591); `Store.viewableIds` (1601) | ODATA |
| [packages/server/src/odata.ts:1610](../../packages/server/src/odata.ts#L1610) `ODataEndpoint/relatedRecords` | `Store.getMany` (1610) | ODATA |
| [packages/server/src/odata.ts:1634](../../packages/server/src/odata.ts#L1634) `ODataEndpoint/property` | `Store.containerId` (1634); `Store.container` (1640) | ODATA |
| [packages/server/src/oidc.ts:188](../../packages/server/src/oidc.ts#L188) `Oidc/constructor` | `SQLite.all` (188, 196); `SQLite.prepare` (188, 196, 206, 207, 212, 212) | AUTH |
| [packages/server/src/oidc.ts:341](../../packages/server/src/oidc.ts#L341) `Oidc/takeGrant` | `SQLite.all` (341); `SQLite.prepare` (341) | AUTH |
| [packages/server/src/oidc.ts:392](../../packages/server/src/oidc.ts#L392) `Oidc/authorizeUrl` | `SQLite.prepare` (392, 393, 396); `SQLite.get` (393) | AUTH |
| [packages/server/src/oidc.ts:444](../../packages/server/src/oidc.ts#L444) `Oidc/callback` | `SQLite.all` (444); `SQLite.prepare` (444, 448) | AUTH |
| [packages/server/src/oidc.ts:546](../../packages/server/src/oidc.ts#L546) `Oidc/finish` | `SQLite.prepare` (546, 547, 549); `SQLite.get` (547) | AUTH |
| [packages/server/src/optimization-containers.ts:41](../../packages/server/src/optimization-containers.ts#L41) `read` | `SQLite.get` (41); `SQLite.prepare` (41); `Store.sql` (41) | DESIGN |
| [packages/server/src/optimization-containers.ts:51](../../packages/server/src/optimization-containers.ts#L51) `write` | `SQLite.prepare` (51); `Store.sql` (51) | DESIGN |
| [packages/server/src/optimization-containers.ts:72](../../packages/server/src/optimization-containers.ts#L72) `planContainerMove` | `Store.embeddedContainerCount` (72) | DESIGN |
| [packages/server/src/optimization-data.ts:46](../../packages/server/src/optimization-data.ts#L46) `held` | `SQLite.get` (46); `SQLite.prepare` (46); `Store.sql` (46) | DESIGN |
| [packages/server/src/optimization-data.ts:61](../../packages/server/src/optimization-data.ts#L61) `dataFindings` | `Store.recordCount` (61) | DESIGN |
| [packages/server/src/optimization-data.ts:113](../../packages/server/src/optimization-data.ts#L113) `layoutFindings` | `Store.recordCount` (113) | DESIGN |
| [packages/server/src/optimization-fix.ts:150](../../packages/server/src/optimization-fix.ts#L150) `history` | `SQLite.get` (150); `SQLite.prepare` (150); `Store.sql` (150) | DESIGN |
| [packages/server/src/optimization-fix.ts:154](../../packages/server/src/optimization-fix.ts#L154) `keep` | `SQLite.prepare` (154); `Store.sql` (154) | DESIGN |
| [packages/server/src/optimization.ts:119](../../packages/server/src/optimization.ts#L119) `hasTable` | `SQLite.get` (119); `SQLite.prepare` (119); `Store.sql` (119) | DESIGN |
| [packages/server/src/optimization.ts:140](../../packages/server/src/optimization.ts#L140) `containerUse` | `SQLite.get` (140); `SQLite.prepare` (140); `Store.sql` (140) | DESIGN |
| [packages/server/src/optimization.ts:268](../../packages/server/src/optimization.ts#L268) `oversizedPictures` | `SQLite.all` (268); `SQLite.prepare` (268); `Store.sql` (268) | DESIGN |
| [packages/server/src/optimization.ts:311](../../packages/server/src/optimization.ts#L311) `sizes/one` | `SQLite.get` (311); `SQLite.prepare` (311); `Store.sql` (311) | DESIGN |
| [packages/server/src/optimization.ts:315](../../packages/server/src/optimization.ts#L315) `sizes` | `SQLite.all` (315); `SQLite.prepare` (315); `Store.sql` (315) | DESIGN |
| [packages/server/src/optimization.ts:419](../../packages/server/src/optimization.ts#L419) `speedFindings` | `Store.recordCount` (419, 462, 480) | DESIGN |
| [packages/server/src/optimization.ts:534](../../packages/server/src/optimization.ts#L534) `heldBytes` | `SQLite.get` (534); `SQLite.prepare` (534); `Store.sql` (534) | DESIGN |
| [packages/server/src/pgwire.ts:651](../../packages/server/src/pgwire.ts#L651) `Connection/translate` | `Calculations.translateSQL` (651) | SQL |
| [packages/server/src/pgwire.ts:677](../../packages/server/src/pgwire.ts#L677) `Connection/catalog` | `Store.describe` (677) | SQL |
| [packages/server/src/pgwire.ts:687](../../packages/server/src/pgwire.ts#L687) `Connection/run` | `Store.select` (687) | SQL |
| [packages/server/src/pgwire.ts:737](../../packages/server/src/pgwire.ts#L737) `Connection/validateSyntax` | `SQLite.prepare` (737); `Store.sql` (737) | SQL |
| [packages/server/src/pgwire.ts:918](../../packages/server/src/pgwire.ts#L918) `Connection/describe` | `Store.describe` (918) | SQL |
| [packages/server/src/pii.ts:140](../../packages/server/src/pii.ts#L140) `classifyField` | `Store.query` (140) | REDACTION |
| [packages/server/src/pii.ts:289](../../packages/server/src/pii.ts#L289) `vaultTable` | `Store.sql` (289, 292) | REDACTION |
| [packages/server/src/pii.ts:298](../../packages/server/src/pii.ts#L298) `forgetVault` | `Store.sql` (298) | REDACTION |
| [packages/server/src/pii.ts:337](../../packages/server/src/pii.ts#L337) `PiiMasker/constructor` | `SQLite.get` (337); `SQLite.prepare` (337); `Store.sql` (337) | REDACTION |
| [packages/server/src/pii.ts:347](../../packages/server/src/pii.ts#L347) `PiiMasker/refresh` | `SQLite.all` (347); `SQLite.prepare` (347); `Store.sql` (347) | REDACTION |
| [packages/server/src/pii.ts:378](../../packages/server/src/pii.ts#L378) `PiiMasker/token` | `SQLite.prepare` (378, 379); `Store.sql` (378, 379); `SQLite.get` (379) | REDACTION |
| [packages/server/src/pii.ts:619](../../packages/server/src/pii.ts#L619) `piiPreview` | `Store.find` (619); `SQLite.prepare` (626); `Store.sql` (626) | REDACTION |
| [packages/server/src/privilege-review.ts:154](../../packages/server/src/privilege-review.ts#L154) `reviewPrivileges` | `Store.previewRecordRule` (154) | DESIGN |
| [packages/server/src/rag.ts:56](../../packages/server/src/rag.ts#L56) `RagStore/spaces` | `SQLite.all` (56); `SQLite.prepare` (56) | RAG |
| [packages/server/src/rag.ts:61](../../packages/server/src/rag.ts#L61) `RagStore/info` | `SQLite.all` (61, 66); `SQLite.prepare` (61, 63) | RAG |
| [packages/server/src/rag.ts:79](../../packages/server/src/rag.ts#L79) `RagStore/add` | `SQLite.prepare` (79, 86, 88, 89); `SQLite.get` (86) | RAG |
| [packages/server/src/rag.ts:105](../../packages/server/src/rag.ts#L105) `RagStore/sizes` | `SQLite.all` (105); `SQLite.prepare` (105) | RAG |
| [packages/server/src/rag.ts:138](../../packages/server/src/rag.ts#L138) `RagStore/hybridSearch` | `SQLite.prepare` (138, 143) | RAG |
| [packages/server/src/rag.ts:148](../../packages/server/src/rag.ts#L148) `RagStore/hybridSearch/candidates` | `SQLite.all` (148); `SQLite.iterate` (150) | RAG |
| [packages/server/src/rag.ts:186](../../packages/server/src/rag.ts#L186) `RagStore/searchSpace` | `SQLite.iterate` (186); `SQLite.prepare` (186) | RAG |
| [packages/server/src/rag.ts:208](../../packages/server/src/rag.ts#L208) `RagStore/version` | `SQLite.get` (208); `SQLite.prepare` (208) | RAG |
| [packages/server/src/rag.ts:224](../../packages/server/src/rag.ts#L224) `RagStore/load` | `SQLite.get` (224); `SQLite.prepare` (224, 231); `SQLite.iterate` (231) | RAG |
| [packages/server/src/rag.ts:270](../../packages/server/src/rag.ts#L270) `RagStore/searchCached` | `SQLite.prepare` (270); `SQLite.get` (271) | RAG |
| [packages/server/src/rag.ts:276](../../packages/server/src/rag.ts#L276) `RagStore/remove` | `SQLite.prepare` (276, 278) | RAG |
| [packages/server/src/record-context.ts:111](../../packages/server/src/record-context.ts#L111) `describeRecord` | `Store.row` (111); `Store.get` (120); `keyValue` (126); `Store.viewableIds` (153); `relatedRows` (157, 162) | RECORD |
| [packages/server/src/record-history.ts:99](../../packages/server/src/record-history.ts#L99) `recordHistory` | `Store.auditLog` (99, 152) | HISTORY |
| [packages/server/src/record-search.ts:61](../../packages/server/src/record-search.ts#L61) `searchRecords` | `Store.viewableIds` (61); `SQLite.all` (74); `SQLite.prepare` (74); `Store.sql` (74) | SEARCH |
| [packages/server/src/record-search.ts:104](../../packages/server/src/record-search.ts#L104) `searchRecords/snippet` | `SQLite.get` (104); `SQLite.prepare` (104); `Store.sql` (104) | SEARCH |
| [packages/server/src/record-search.ts:109](../../packages/server/src/record-search.ts#L109) `searchRecords/source` | `SQLite.get` (109); `SQLite.prepare` (109); `Store.sql` (109) | SEARCH |
| [packages/server/src/rule-suggestions.ts:57](../../packages/server/src/rule-suggestions.ts#L57) `suggestRules` | `Store.query` (57, 69, 86, 136, 138, 152, 153, 169) | DESIGN |
| [packages/server/src/scim.ts:118](../../packages/server/src/scim.ts#L118) `ScimDirectory/table` | `Store.sql` (118) | AUTH |
| [packages/server/src/scim.ts:124](../../packages/server/src/scim.ts#L124) `ScimDirectory/settings` | `SQLite.get` (124); `SQLite.prepare` (124); `Store.sql` (124) | AUTH |
| [packages/server/src/scim.ts:132](../../packages/server/src/scim.ts#L132) `ScimDirectory/save` | `SQLite.prepare` (132); `Store.sql` (132) | AUTH |
| [packages/server/src/scim.ts:187](../../packages/server/src/scim.ts#L187) `ScimDirectory/rows` | `SQLite.all` (187); `SQLite.prepare` (187, 190); `Store.sql` (187, 190) | AUTH |
| [packages/server/src/scim.ts:214](../../packages/server/src/scim.ts#L214) `ScimDirectory/setMemberships` | `SQLite.prepare` (214); `Store.sql` (214) | AUTH |
| [packages/server/src/scim.ts:251](../../packages/server/src/scim.ts#L251) `ScimDirectory/atomically` | `Store.sql` (251) | AUTH |
| [packages/server/src/scim.ts:291](../../packages/server/src/scim.ts#L291) `ScimDirectory/revokePersonTokens` | `SQLite.all` (291); `SQLite.prepare` (291); `Store.sql` (291) | AUTH |
| [packages/server/src/scim.ts:342](../../packages/server/src/scim.ts#L342) `ScimDirectory/create/scim_user_create` | `SQLite.prepare` (342); `Store.sql` (342) | AUTH |
| [packages/server/src/scim.ts:363](../../packages/server/src/scim.ts#L363) `ScimDirectory/update/scim_user_update` | `SQLite.prepare` (363); `Store.sql` (363) | AUTH |
| [packages/server/src/scim.ts:386](../../packages/server/src/scim.ts#L386) `ScimDirectory/remove/scim_user_remove` | `SQLite.prepare` (386); `Store.sql` (386) | AUTH |
| [packages/server/src/script-failure.ts:208](../../packages/server/src/script-failure.ts#L208) `explainScriptFailure` | `Store.row` (208) | RECORD |
| [packages/server/src/security.ts:78](../../packages/server/src/security.ts#L78) `importApproximations` | `SQLite.all` (78); `SQLite.prepare` (78); `Store.sql` (78) | DESIGN |
| [packages/server/src/security.ts:114](../../packages/server/src/security.ts#L114) `securityOf` | `Store.pendingChanges` (114) | DESIGN |
| [packages/server/src/security.ts:206](../../packages/server/src/security.ts#L206) `SecurityApi/handle` | `Store.previewRecordRule` (206) | DESIGN |
| [packages/server/src/semantic-find.ts:52](../../packages/server/src/semantic-find.ts#L52) `semanticFind` | `Store.findIds` (52) | SEARCH |
| [packages/server/src/semantic-find.ts:108](../../packages/server/src/semantic-find.ts#L108) `vectorOf` | `Store.containerId` (108); `Store.containerInfo` (110); `Store.container` (112); `Store.get` (117) | SEARCH |
| [packages/server/src/sql.ts:101](../../packages/server/src/sql.ts#L101) `SqlEndpoint/handle` | `Calculations.translateSQL` (101); `Store.select` (106) | SQL |
| [packages/server/src/sql.ts:159](../../packages/server/src/sql.ts#L159) `SqlEndpoint/tables` | `SQLite.all` (159); `SQLite.prepare` (159); `Store.sql` (159) | SQL |
| [packages/server/src/standby.ts:257](../../packages/server/src/standby.ts#L257) `Standby/copy` | `SQLite.get` (257); `SQLite.prepare` (257) | OPERATOR |
| [packages/server/src/summarize.ts:67](../../packages/server/src/summarize.ts#L67) `summarizeRecords` | `Store.findIds` (67); `Store.select` (122, 129, 139) | SUMMARY |
| [packages/server/src/summarize.ts:180](../../packages/server/src/summarize.ts#L180) `summarizeByRecord` | `Store.evaluateEach` (180); `Store.row` (182) | SUMMARY |
| [packages/server/src/sync-console.ts:458](../../packages/server/src/sync-console.ts#L458) `SyncConsole/runCheck` | `Store.sql` (458) | DESIGN |
| [packages/server/src/sync-console.ts:463](../../packages/server/src/sync-console.ts#L463) `SyncConsole/runCheck/assertActive` | `Store.sql` (463) | DESIGN |
| [packages/server/src/warm-worker.ts:19](../../packages/server/src/warm-worker.ts#L19) `message/count` | `Store.recordCount` (19) | INTERNAL |
| [packages/server/src/warm-worker.ts:34](../../packages/server/src/warm-worker.ts#L34) `message` | `Store.find` (34) | INTERNAL |
| [packages/server/src/webclient.ts:442](../../packages/server/src/webclient.ts#L442) `WebClient/history` | `Store.get` (442) | WEB |
| [packages/server/src/webclient.ts:557](../../packages/server/src/webclient.ts#L557) `WebClient/explain` | `Store.get` (557); `Store.row` (590, 603) | WEB |
| [packages/server/src/webclient.ts:616](../../packages/server/src/webclient.ts#L616) `WebClient/index` | `Store.fieldIndex` (616) | WEB |
| [packages/server/src/webclient.ts:706](../../packages/server/src/webclient.ts#L706) `WebClient/menus` | `Store.evaluateEach` (706) | WEB |
| [packages/server/src/webclient.ts:919](../../packages/server/src/webclient.ts#L919) `WebClient/view` | `Store.evaluateEach` (919, 943, 962); `Store.canView` (937); `Store.previewRow` (941, 963); `Store.get` (954); `Store.row` (955, 955) | WEB |
| [packages/server/src/webclient.ts:940](../../packages/server/src/webclient.ts#L940) `WebClient/view/get` | `Store.get` (940) | WEB |
| [packages/server/src/webclient.ts:1005](../../packages/server/src/webclient.ts#L1005) `WebClient/refresh` | `Store.previewRow` (1005); `Store.getMany` (1010); `Store.foundSetRows` (1032) | WEB |
| [packages/server/src/webclient.ts:1044](../../packages/server/src/webclient.ts#L1044) `WebClient/foundIds` | `Store.findIds` (1044) | WEB |
| [packages/server/src/webclient.ts:1059](../../packages/server/src/webclient.ts#L1059) `WebClient/records` | `Store.getMany` (1059); `Store.find` (1062) | WEB |
| [packages/server/src/webclient.ts:1088](../../packages/server/src/webclient.ts#L1088) `WebClient/foundSetPortal` | `Store.foundSetRows` (1088, 1095) | WEB |
| [packages/server/src/webclient.ts:1128](../../packages/server/src/webclient.ts#L1128) `WebClient/charts/foundSet` | `Store.findIds` (1128) | WEB |
| [packages/server/src/webclient.ts:1137](../../packages/server/src/webclient.ts#L1137) `WebClient/charts` | `Calculations.context` (1137); `Store.canView` (1165); `Store.evaluateEach` (1174, 1178); `Store.evaluateRows` (1183, 1185) | WEB |
| [packages/server/src/webclient.ts:1168](../../packages/server/src/webclient.ts#L1168) `WebClient/charts/get` | `Store.get` (1168) | WEB |
| [packages/server/src/webclient.ts:1318](../../packages/server/src/webclient.ts#L1318) `WebClient/exportRecords` | `Store.getMany` (1318) | WEB |
| [packages/server/src/webclient.ts:1244](../../packages/server/src/webclient.ts#L1244) `WebClient/exportText/nextBatch` | `Store.selectIds` (1244); `Store.getMany` (1249) | WEB |
| [packages/server/src/webclient.ts:1492](../../packages/server/src/webclient.ts#L1492) `WebClient/aiReplace` | `Store.canView` (1492); `Store.getMany` (1508) | WEB |
| [packages/server/src/webclient.ts:1568](../../packages/server/src/webclient.ts#L1568) `WebClient/groups` | `Store.findIds` (1568); `Store.groupSummaries` (1574) | WEB |
| [packages/server/src/webclient.ts:1676](../../packages/server/src/webclient.ts#L1676) `WebClient/button` | `Store.findIds` (1676, 1726); `Store.evaluateEach` (1685, 1686) | WEB |
| [packages/server/src/webclient.ts:2333](../../packages/server/src/webclient.ts#L2333) `listItems` | `Store.valueListItems` (2333) | WEB |
| [packages/server/src/webclient.ts:2412](../../packages/server/src/webclient.ts#L2412) `foundIds` | `Store.findIds` (2412, 2414) | WEB |
| [packages/store/src/activity.ts:372](../../packages/store/src/activity.ts#L372) `SharedRecordLocks/constructor` | `SQLite.get` (372); `SQLite.prepare` (372) | CORE |
| [packages/store/src/activity.ts:403](../../packages/store/src/activity.ts#L403) `SharedRecordLocks/count` | `SQLite.get` (403); `SQLite.prepare` (403) | CORE |
| [packages/store/src/activity.ts:407](../../packages/store/src/activity.ts#L407) `SharedRecordLocks/sweep` | `SQLite.prepare` (407) | CORE |
| [packages/store/src/activity.ts:415](../../packages/store/src/activity.ts#L415) `SharedRecordLocks/holder` | `SQLite.get` (415); `SQLite.prepare` (415) | CORE |
| [packages/store/src/activity.ts:430](../../packages/store/src/activity.ts#L430) `SharedRecordLocks/acquire` | `SQLite.prepare` (430) | CORE |
| [packages/store/src/activity.ts:444](../../packages/store/src/activity.ts#L444) `SharedRecordLocks/renew` | `SQLite.prepare` (444) | CORE |
| [packages/store/src/activity.ts:458](../../packages/store/src/activity.ts#L458) `SharedRecordLocks/release` | `SQLite.prepare` (458) | CORE |
| [packages/store/src/activity.ts:462](../../packages/store/src/activity.ts#L462) `SharedRecordLocks/releaseOwner` | `SQLite.all` (462); `SQLite.prepare` (462) | CORE |
| [packages/store/src/activity.ts:468](../../packages/store/src/activity.ts#L468) `SharedRecordLocks/all` | `SQLite.all` (468); `SQLite.prepare` (468) | CORE |
| [packages/store/src/activity.ts:472](../../packages/store/src/activity.ts#L472) `SharedRecordLocks/view` | `SQLite.get` (472); `SQLite.prepare` (472, 473) | CORE |
| [packages/store/src/activity.ts:478](../../packages/store/src/activity.ts#L478) `SharedRecordLocks/leave` | `SQLite.prepare` (478) | CORE |
| [packages/store/src/activity.ts:482](../../packages/store/src/activity.ts#L482) `SharedRecordLocks/leaveOwner` | `SQLite.all` (482); `SQLite.prepare` (482) | CORE |
| [packages/store/src/activity.ts:486](../../packages/store/src/activity.ts#L486) `SharedRecordLocks/viewers` | `SQLite.prepare` (486, 487); `SQLite.all` (487) | CORE |
| [packages/store/src/audit-anchor.ts:68](../../packages/store/src/audit-anchor.ts#L68) `checkAnchor` | `SQLite.get` (68, 70, 73); `SQLite.prepare` (68, 70, 73) | CORE |
| [packages/store/src/cache-versions.ts:11](../../packages/store/src/cache-versions.ts#L11) `ensureCacheVersions` | `SQLite.get` (11); `SQLite.prepare` (11) | CORE |
| [packages/store/src/calc.ts:313](../../packages/store/src/calc.ts#L313) `Calculations/meta` | `SQLite.get` (313); `SQLite.prepare` (313); `Store.sql` (313) | CALC |
| [packages/store/src/calc.ts:318](../../packages/store/src/calc.ts#L318) `Calculations/saveMeta` | `SQLite.prepare` (318); `Store.sql` (318) | CALC |
| [packages/store/src/calc.ts:331](../../packages/store/src/calc.ts#L331) `Calculations/globalValue` | `SQLite.get` (331); `SQLite.prepare` (331); `Store.sql` (331) | CALC |
| [packages/store/src/calc.ts:355](../../packages/store/src/calc.ts#L355) `Calculations/setNextSerial` | `Store.sql` (355, 356, 361, 363, 363) | CALC |
| [packages/store/src/calc.ts:499](../../packages/store/src/calc.ts#L499) `Calculations/value` | `Calculations.globalValue` (499) | CALC |
| [packages/store/src/calc.ts:534](../../packages/store/src/calc.ts#L534) `Calculations/computed` | `Calculations.context` (534) | CALC |
| [packages/store/src/calc.ts:549](../../packages/store/src/calc.ts#L549) `Calculations/unstoredValue` | `Calculations.unstoredStyled` (549); `Calculations.value` (549) | CALC |
| [packages/store/src/calc.ts:587](../../packages/store/src/calc.ts#L587) `Calculations/allRecords` | `SQLite.iterate` (587); `SQLite.prepare` (587); `Store.sql` (587) | CALC |
| [packages/store/src/calc.ts:598](../../packages/store/src/calc.ts#L598) `Calculations/collect` | `Calculations.collector` (598) | CALC |
| [packages/store/src/calc.ts:605](../../packages/store/src/calc.ts#L605) `Calculations/summaryInput` | `Calculations.value` (605) | CALC |
| [packages/store/src/calc.ts:629](../../packages/store/src/calc.ts#L629) `Calculations/collector/add` | `Calculations.related` (629) | CALC |
| [packages/store/src/calc.ts:642](../../packages/store/src/calc.ts#L642) `Calculations/foundSummary` | `Calculations.collect` (642) | CALC |
| [packages/store/src/calc.ts:653](../../packages/store/src/calc.ts#L653) `Calculations/summary` | `Calculations.collect` (653) | CALC |
| [packages/store/src/calc.ts:660](../../packages/store/src/calc.ts#L660) `Calculations/tableSummary` | `Calculations.wholeTable` (660) | CALC |
| [packages/store/src/calc.ts:715](../../packages/store/src/calc.ts#L715) `Calculations/globalsKey` | `Calculations.globalValue` (715) | CALC |
| [packages/store/src/calc.ts:890](../../packages/store/src/calc.ts#L890) `Calculations/summaryDependencies` | `Store.sql` (890) | CALC |
| [packages/store/src/calc.ts:929](../../packages/store/src/calc.ts#L929) `Calculations/wholeTable` | `rowsById` (929); `Store.viewableIds` (929); `Calculations.collect` (931, 1021); `Calculations.value` (992); `Store.sql` (1000, 1008) | CALC |
| [packages/store/src/calc.ts:1182](../../packages/store/src/calc.ts#L1182) `Calculations/applyDelta/value` | `Calculations.value` (1182) | CALC |
| [packages/store/src/calc.ts:1254](../../packages/store/src/calc.ts#L1254) `Calculations/storedRows` | `SQLite.iterate` (1254); `SQLite.prepare` (1254); `Store.sql` (1254) | CALC |
| [packages/store/src/calc.ts:1306](../../packages/store/src/calc.ts#L1306) `Calculations/relatedRecs` | `Calculations.relatedIds` (1306); `Store.viewableIds` (1311); `rowsById` (1317) | CALC |
| [packages/store/src/calc.ts:1328](../../packages/store/src/calc.ts#L1328) `Calculations/firstRelated` | `Calculations.related` (1328, 1340, 1355); `Store.viewableIds` (1335); `Calculations.relatedIds` (1338, 1351); `Calculations.statement` (1348); `SQLite.get` (1348) | CALC |
| [packages/store/src/calc.ts:1362](../../packages/store/src/calc.ts#L1362) `Calculations/rowById` | `Calculations.statement` (1362); `SQLite.get` (1362) | CALC |
| [packages/store/src/calc.ts:1373](../../packages/store/src/calc.ts#L1373) `Calculations/relatedIds` | `Calculations.related` (1373, 1403, 1417); `rowsById` (1387, 1414); `Calculations.statement` (1398); `SQLite.all` (1398) | CALC |
| [packages/store/src/calc.ts:1480](../../packages/store/src/calc.ts#L1480) `Calculations/joinHop` | `Calculations.statement` (1480, 1482); `SQLite.get` (1480); `SQLite.iterate` (1482) | CALC |
| [packages/store/src/calc.ts:1507](../../packages/store/src/calc.ts#L1507) `Calculations/storedRelatedValues` | `Calculations.statement` (1507); `SQLite.iterate` (1507) | CALC |
| [packages/store/src/calc.ts:1526](../../packages/store/src/calc.ts#L1526) `Calculations/passStamp` | `Store.sql` (1526) | CALC |
| [packages/store/src/calc.ts:1536](../../packages/store/src/calc.ts#L1536) `Calculations/lookup` | `Store.sql` (1536) | CALC |
| [packages/store/src/calc.ts:1575](../../packages/store/src/calc.ts#L1575) `Calculations/foundSums` | `Store.sql` (1575) | CALC |
| [packages/store/src/calc.ts:1638](../../packages/store/src/calc.ts#L1638) `Calculations/hopQuery` | `Calculations.value` (1638) | CALC |
| [packages/store/src/calc.ts:1671](../../packages/store/src/calc.ts#L1671) `Calculations/columnNames` | `SQLite.all` (1671); `SQLite.prepare` (1671); `Store.sql` (1671) | CALC |
| [packages/store/src/calc.ts:1682](../../packages/store/src/calc.ts#L1682) `Calculations/statement` | `SQLite.prepare` (1682); `Store.sql` (1682) | CALC |
| [packages/store/src/calc.ts:1696](../../packages/store/src/calc.ts#L1696) `Calculations/ensureIndex` | `Store.sql` (1696, 1697) | CALC |
| [packages/store/src/calc.ts:1722](../../packages/store/src/calc.ts#L1722) `Calculations/context/records` | `Calculations.firstRelated` (1722) | CALC |
| [packages/store/src/calc.ts:1740](../../packages/store/src/calc.ts#L1740) `Calculations/context/field` | `Calculations.summary` (1740); `Calculations.globalValue` (1743); `Calculations.value` (1744) | CALC |
| [packages/store/src/calc.ts:1753](../../packages/store/src/calc.ts#L1753) `Calculations/context/related` | `Calculations.globalValue` (1753); `Calculations.value` (1755, 1766); `Calculations.related` (1768) | CALC |
| [packages/store/src/calc.ts:1788](../../packages/store/src/calc.ts#L1788) `Calculations/context/lookupNext` | `Store.canViewRecord` (1788) | CALC |
| [packages/store/src/calc.ts:1803](../../packages/store/src/calc.ts#L1803) `Calculations/context/summary` | `Calculations.value` (1803, 1813); `Calculations.related` (1815); `Calculations.summary` (1833) | CALC |
| [packages/store/src/calc.ts:1863](../../packages/store/src/calc.ts#L1863) `Calculations/context/get` | `Store.recordCount` (1863, 1867); `Calculations.statement` (1866); `SQLite.get` (1866) | CALC |
| [packages/store/src/calc.ts:1886](../../packages/store/src/calc.ts#L1886) `Calculations/context/executeSQL` | `Calculations.executeSQL` (1886) | CALC |
| [packages/store/src/calc.ts:1887](../../packages/store/src/calc.ts#L1887) `Calculations/context/persistentData` | `Store.persistentData` (1887) | CALC |
| [packages/store/src/calc.ts:1888](../../packages/store/src/calc.ts#L1888) `Calculations/context/persistentDataIds` | `Store.persistentDataIds` (1888) | CALC |
| [packages/store/src/calc.ts:1913](../../packages/store/src/calc.ts#L1913) `Calculations/design` | `Store.valueListItems` (1913) | CALC |
| [packages/store/src/calc.ts:1930](../../packages/store/src/calc.ts#L1930) `Calculations/executeSQL` | `Calculations.translateSQL` (1930); `Store.select` (1968); `Store.sql` (1979) | CALC |
| [packages/store/src/calc.ts:2083](../../packages/store/src/calc.ts#L2083) `Calculations/translateSQL` | `Store.scopedTableSql` (2083, 2114) | CALC |
| [packages/store/src/calc.ts:2146](../../packages/store/src/calc.ts#L2146) `Calculations/shareColumn` | `Store.recordCount` (2146) | CALC |
| [packages/store/src/calc.ts:2178](../../packages/store/src/calc.ts#L2178) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2178) | CALC |
| [packages/store/src/calc.ts:2215](../../packages/store/src/calc.ts#L2215) `Calculations/computeColumn` | `Calculations.statement` (2215); `SQLite.get` (2215); `Calculations.value` (2218) | CALC |
| [packages/store/src/calc.ts:2352](../../packages/store/src/calc.ts#L2352) `Calculations/beforeWrite` | `relatedRows` (2352); `Calculations.related` (2406); `Calculations.context` (2419) | CORE |
| [packages/store/src/calc.ts:2470](../../packages/store/src/calc.ts#L2470) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2470); `Calculations.value` (2470) | CALC |
| [packages/store/src/calc.ts:2485](../../packages/store/src/calc.ts#L2485) `Calculations/computeStoredStyled` | `Calculations.context` (2485) | CORE |
| [packages/store/src/calc.ts:2525](../../packages/store/src/calc.ts#L2525) `Calculations/validate/fail` | `Calculations.context` (2525) | CALC |
| [packages/store/src/calc.ts:2539](../../packages/store/src/calc.ts#L2539) `Calculations/validate` | `Calculations.value` (2539); `Store.valueListItems` (2560); `Calculations.context` (2574) | CALC |
| [packages/store/src/calc.ts:2636](../../packages/store/src/calc.ts#L2636) `nearest` | `SQLite.get` (2636); `SQLite.prepare` (2636); `Store.sql` (2636) | CALC |
| [packages/store/src/calc.ts:2722](../../packages/store/src/calc.ts#L2722) `containerValue` | `Store.containerInfo` (2722); `Store.containerRange` (2729); `Store.container` (2730) | CALC |
| [packages/store/src/calc.ts:2738](../../packages/store/src/calc.ts#L2738) `containerValue/read` | `Store.container` (2738) | CALC |
| [packages/store/src/calc.ts:2751](../../packages/store/src/calc.ts#L2751) `containerValue/value` | `Store.containerRange` (2751) | CALC |
| [packages/store/src/calc.ts:2869](../../packages/store/src/calc.ts#L2869) `sameValuesElsewhere` | `SQLite.all` (2869); `SQLite.prepare` (2869, 2876, 2878); `Store.sql` (2869, 2876, 2878); `Calculations.value` (2871); `SQLite.get` (2876, 2878) | CALC |
| [packages/store/src/calc.ts:3182](../../packages/store/src/calc.ts#L3182) `rowsById/flush` | `Calculations.statement` (3182); `SQLite.iterate` (3182) | CALC |
| [packages/store/src/damage.ts:93](../../packages/store/src/damage.ts#L93) `watchDatabase` | `SQLite.prepare` (93); `SQLite.iterate` (103) | CORE |
| [packages/store/src/explain-related.ts:102](../../packages/store/src/explain-related.ts#L102) `explainRelated` | `Store.row` (102); `Store.get` (190); `Calculations.value` (239); `Calculations.context` (247) | RECORD |
| [packages/store/src/explain-related.ts:180](../../packages/store/src/explain-related.ts#L180) `explainRelated/runFilter` | `Calculations.context` (180) | RECORD |
| [packages/store/src/explain-related.ts:298](../../packages/store/src/explain-related.ts#L298) `explainHop` | `keyValue` (298); `SQLite.get` (318); `SQLite.prepare` (318, 332); `Store.sql` (318, 332); `SQLite.all` (332) | RECORD |
| [packages/store/src/explain-related.ts:361](../../packages/store/src/explain-related.ts#L361) `explainCandidate` | `SQLite.get` (361, 375); `SQLite.prepare` (361, 375); `Store.sql` (361, 375); `keyValue` (372); `Calculations.context` (380) | RECORD |
| [packages/store/src/explain.ts:102](../../packages/store/src/explain.ts#L102) `explainField` | `Calculations.value` (102); `Calculations.context` (128) | RECORD |
| [packages/store/src/explain.ts:337](../../packages/store/src/explain.ts#L337) `lintFormula` | `Calculations.context` (337) | RECORD |
| [packages/store/src/export-sql.ts:229](../../packages/store/src/export-sql.ts#L229) `exportSql` | `Store.scopedTableSql` (229); `Store.select` (230, 363); `Store.container` (429) | OPERATOR |
| [packages/store/src/export-sql.ts:255](../../packages/store/src/export-sql.ts#L255) `exportSql/page` | `Store.select` (255) | OPERATOR |
| [packages/store/src/export-sql.ts:305](../../packages/store/src/export-sql.ts#L305) `exportSql/duplicates` | `Store.select` (305) | OPERATOR |
| [packages/store/src/fidelity.ts:146](../../packages/store/src/fidelity.ts#L146) `changedAfter` | `Untyped.executeSQL` (146) | DESIGN |
| [packages/store/src/fidelity.ts:166](../../packages/store/src/fidelity.ts#L166) `queryProblem` | `Calculations.translateSQL` (166); `Store.describe` (167) | DESIGN |
| [packages/store/src/fidelity.ts:184](../../packages/store/src/fidelity.ts#L184) `calcFidelity` | `Calculations.executeSQL` (184, 185, 271); `Store.sql` (189, 197, 270); `SQLite.all` (197); `SQLite.prepare` (197); `Calculations.computeStored` (233) | DESIGN |
| [packages/store/src/fmexport.ts:226](../../packages/store/src/fmexport.ts#L226) `fmExport` | `Store.recordCount` (226); `Store.query` (227); `Store.containerInfo` (242); `Store.container` (249) | OPERATOR |
| [packages/store/src/import.ts:91](../../packages/store/src/import.ts#L91) `addExternalSizeColumn` | `SQLite.all` (91); `SQLite.prepare` (91) | OPERATOR |
| [packages/store/src/import.ts:103](../../packages/store/src/import.ts#L103) `writeDesign` | `SQLite.prepare` (103, 107) | OPERATOR |
| [packages/store/src/import.ts:121](../../packages/store/src/import.ts#L121) `importDesigns` | `SQLite.all` (121); `SQLite.prepare` (121, 137, 139) | OPERATOR |
| [packages/store/src/import.ts:157](../../packages/store/src/import.ts#L157) `applyFileAccountStatus` | `SQLite.get` (157, 159); `SQLite.prepare` (157, 159, 161, 164) | OPERATOR |
| [packages/store/src/import.ts:184](../../packages/store/src/import.ts#L184) `createStore` | `SQLite.prepare` (184, 195) | OPERATOR |
| [packages/store/src/import.ts:207](../../packages/store/src/import.ts#L207) `needsDesigns` | `SQLite.get` (207); `SQLite.prepare` (207) | OPERATOR |
| [packages/store/src/import.ts:254](../../packages/store/src/import.ts#L254) `readState` | `SQLite.get` (254); `SQLite.prepare` (254) | OPERATOR |
| [packages/store/src/import.ts:301](../../packages/store/src/import.ts#L301) `importFmp12/save` | `SQLite.prepare` (301) | OPERATOR |
| [packages/store/src/import.ts:310](../../packages/store/src/import.ts#L310) `importFmp12` | `SQLite.prepare` (310, 320, 326, 332, 336, 351, 362, 437, 438); `SQLite.get` (326, 351); `SQLite.all` (332) | OPERATOR |
| [packages/store/src/layout-speed.ts:56](../../packages/store/src/layout-speed.ts#L56) `layoutCost/recordCount` | `Store.recordCount` (56) | DESIGN |
| [packages/store/src/layout-speed.ts:419](../../packages/store/src/layout-speed.ts#L419) `speedContext` | `Store.recordCount` (419) | DESIGN |
| [packages/store/src/privileges.ts:519](../../packages/store/src/privileges.ts#L519) `privilegeSets` | `SQLite.all` (519); `SQLite.prepare` (519) | AUTH |
| [packages/store/src/privileges.ts:547](../../packages/store/src/privileges.ts#L547) `ensurePrivilegeTables` | `SQLite.all` (547); `SQLite.prepare` (547) | AUTH |
| [packages/store/src/reconvert.ts:97](../../packages/store/src/reconvert.ts#L97) `meta` | `SQLite.get` (97); `SQLite.prepare` (97) | OPERATOR |
| [packages/store/src/reconvert.ts:102](../../packages/store/src/reconvert.ts#L102) `tableExists` | `SQLite.get` (102); `SQLite.prepare` (102) | OPERATOR |
| [packages/store/src/reconvert.ts:106](../../packages/store/src/reconvert.ts#L106) `columns` | `SQLite.all` (106); `SQLite.prepare` (106) | OPERATOR |
| [packages/store/src/reconvert.ts:119](../../packages/store/src/reconvert.ts#L119) `reconvertCheck` | `SQLite.get` (119); `SQLite.prepare` (119) | OPERATOR |
| [packages/store/src/reconvert.ts:194](../../packages/store/src/reconvert.ts#L194) `build` | `SQLite.get` (194); `SQLite.prepare` (194, 197, 202); `SQLite.all` (202) | OPERATOR |
| [packages/store/src/reconvert.ts:229](../../packages/store/src/reconvert.ts#L229) `previewOf/count` | `SQLite.get` (229); `SQLite.prepare` (229) | OPERATOR |
| [packages/store/src/reconvert.ts:242](../../packages/store/src/reconvert.ts#L242) `previewOf` | `SQLite.get` (242); `SQLite.prepare` (242) | OPERATOR |
| [packages/store/src/reconvert.ts:262](../../packages/store/src/reconvert.ts#L262) `copyContainer` | `SQLite.get` (262); `SQLite.prepare` (262, 264, 270) | OPERATOR |
| [packages/store/src/reconvert.ts:299](../../packages/store/src/reconvert.ts#L299) `carryRecords` | `SQLite.prepare` (299, 302, 303, 313, 319, 320); `SQLite.all` (302, 306, 319) | OPERATOR |
| [packages/store/src/reconvert.ts:328](../../packages/store/src/reconvert.ts#L328) `carrySettings` | `SQLite.all` (328, 332, 340); `SQLite.prepare` (328, 332, 340, 341, 345); `SQLite.get` (345) | OPERATOR |
| [packages/store/src/record-chain.ts:58](../../packages/store/src/record-chain.ts#L58) `ensureRecordChain` | `SQLite.all` (58); `SQLite.prepare` (58, 67, 68, 71); `SQLite.get` (67, 68) | CORE |
| [packages/store/src/record-chain.ts:80](../../packages/store/src/record-chain.ts#L80) `linkRecordEntry` | `SQLite.prepare` (80, 81, 82, 85, 86); `SQLite.get` (81, 82) | CORE |
| [packages/store/src/record-chain.ts:93](../../packages/store/src/record-chain.ts#L93) `pruneRecordEntries` | `SQLite.prepare` (93, 94, 95, 97); `SQLite.get` (94) | CORE |
| [packages/store/src/record-chain.ts:115](../../packages/store/src/record-chain.ts#L115) `verifyRecordAudit` | `SQLite.get` (115, 129); `SQLite.prepare` (115, 119, 129, 132); `SQLite.all` (119); `SQLite.iterate` (132) | CORE |
| [packages/store/src/related.ts:107](../../packages/store/src/related.ts#L107) `keyValue` | `Calculations.value` (107) | RELATED |
| [packages/store/src/related.ts:118](../../packages/store/src/related.ts#L118) `condition` | `Store.canViewRecord` (118); `keyValue` (135) | RELATED |
| [packages/store/src/related.ts:178](../../packages/store/src/related.ts#L178) `relatedRows` | `Calculations.relatedIds` (178); `rowsById` (179); `Calculations.statement` (194, 198, 208); `SQLite.get` (194); `SQLite.all` (198); `SQLite.iterate` (208) | RELATED |
| [packages/store/src/related.ts:236](../../packages/store/src/related.ts#L236) `relatedIdList` | `Calculations.relatedIds` (236); `Calculations.statement` (241); `SQLite.iterate` (241) | RELATED |
| [packages/store/src/related.ts:279](../../packages/store/src/related.ts#L279) `relatedKeys` | `keyValue` (279) | RELATED |
| [packages/store/src/related.ts:299](../../packages/store/src/related.ts#L299) `firstRelatedEach/oneByOne` | `relatedRows` (299) | RELATED |
| [packages/store/src/related.ts:311](../../packages/store/src/related.ts#L311) `firstRelatedEach/keysOf` | `keyValue` (311) | RELATED |
| [packages/store/src/related.ts:332](../../packages/store/src/related.ts#L332) `firstRelatedEach` | `Calculations.statement` (332); `SQLite.all` (332) | RELATED |
| [packages/store/src/results.ts:56](../../packages/store/src/results.ts#L56) `ResultCache/wrote` | `SQLite.prepare` (56) | CORE |
| [packages/store/src/results.ts:65](../../packages/store/src/results.ts#L65) `ResultCache/lastWrite` | `SQLite.get` (65); `SQLite.prepare` (65) | CORE |
| [packages/store/src/results.ts:74](../../packages/store/src/results.ts#L74) `ResultCache/get` | `SQLite.get` (74); `SQLite.prepare` (74) | CORE |
| [packages/store/src/results.ts:86](../../packages/store/src/results.ts#L86) `ResultCache/put` | `SQLite.prepare` (86) | CORE |
| [packages/store/src/results.ts:110](../../packages/store/src/results.ts#L110) `ResultCache/renew` | `SQLite.prepare` (110) | CORE |
| [packages/store/src/results.ts:122](../../packages/store/src/results.ts#L122) `ResultCache/claimed` | `SQLite.get` (122); `SQLite.prepare` (122) | CORE |
| [packages/store/src/results.ts:131](../../packages/store/src/results.ts#L131) `ResultCache/release` | `SQLite.prepare` (131) | CORE |
| [packages/store/src/security-chain.ts:92](../../packages/store/src/security-chain.ts#L92) `ensureSecurityChain` | `SQLite.get` (92, 102, 103, 106, 107); `SQLite.prepare` (92, 93, 102, 103, 106, 107, 111, 114, 122); `SQLite.all` (93); `SQLite.iterate` (114) | CORE |
| [packages/store/src/security-chain.ts:132](../../packages/store/src/security-chain.ts#L132) `appendSecurityEvent` | `SQLite.prepare` (132, 134, 136, 138, 142, 144); `SQLite.get` (134, 138) | CORE |
| [packages/store/src/security-chain.ts:162](../../packages/store/src/security-chain.ts#L162) `verifySecurityAudit` | `SQLite.get` (162, 163); `SQLite.prepare` (162, 163, 167, 176); `SQLite.all` (167); `SQLite.iterate` (178) | CORE |
| [packages/store/src/stale-calcs.ts:107](../../packages/store/src/stale-calcs.ts#L107) `current` | `Calculations.computeStored` (107) | DESIGN |
| [packages/store/src/stale-calcs.ts:128](../../packages/store/src/stale-calcs.ts#L128) `findStaleCalcs` | `Store.sql` (128, 135, 158); `Store.recordCount` (133); `SQLite.iterate` (135); `SQLite.prepare` (135) | DESIGN |
| [packages/store/src/stale-calcs.ts:201](../../packages/store/src/stale-calcs.ts#L201) `refreshStaleCalcs` | `Store.sql` (201, 206, 221, 223); `SQLite.iterate` (206); `SQLite.prepare` (206) | DESIGN |
| [packages/store/src/stale-calcs.ts:240](../../packages/store/src/stale-calcs.ts#L240) `undoStaleRefresh` | `Store.sql` (240, 247, 249) | DESIGN |
| [packages/store/src/stale-calcs.ts:264](../../packages/store/src/stale-calcs.ts#L264) `RefreshJournal/constructor` | `Store.sql` (264) | DESIGN |
| [packages/store/src/stale-calcs.ts:270](../../packages/store/src/stale-calcs.ts#L270) `RefreshJournal/add` | `SQLite.prepare` (270); `Store.sql` (270) | DESIGN |
| [packages/store/src/stale-calcs.ts:276](../../packages/store/src/stale-calcs.ts#L276) `RefreshJournal/get` | `SQLite.get` (276); `SQLite.prepare` (276); `Store.sql` (276) | DESIGN |
| [packages/store/src/stale-calcs.ts:281](../../packages/store/src/stale-calcs.ts#L281) `RefreshJournal/list` | `SQLite.all` (281); `SQLite.prepare` (281); `Store.sql` (281) | DESIGN |
| [packages/store/src/stale-calcs.ts:285](../../packages/store/src/stale-calcs.ts#L285) `RefreshJournal/markUndone` | `SQLite.prepare` (285); `Store.sql` (285) | DESIGN |
| [packages/store/src/store-format.ts:32](../../packages/store/src/store-format.ts#L32) `storedFormat` | `SQLite.get` (32); `SQLite.prepare` (32) | CORE |
| [packages/store/src/store-format.ts:50](../../packages/store/src/store-format.ts#L50) `checkFormat` | `SQLite.prepare` (50) | CORE |
| [packages/store/src/store.ts:844](../../packages/store/src/store.ts#L844) `Store/metadataVersions` | `SQLite.get` (844); `SQLite.prepare` (844); `Store.sql` (844) | CORE |
| [packages/store/src/store.ts:953](../../packages/store/src/store.ts#L953) `Store/constructor` | `Store.sql` (953, 955, 957, 958, 962, 966, 967, 978, 983, 988, 989, 993, 994, 995, 1002, 1006, 1010, 1011, 1012, 1016, 1020, 1023, 1024, 1026, 1027, 1030, 1031, 1035, 1036, 1040, 1041, 1044, 1046, 1049, 1050, 1054, 1055, 1059, 1060, 1063, 1064, 1065, 1068, 1069, 1072, 1073, 1075, 1075, 1076, 1076, 1077, 1080, 1084, 1086, 1089, 1090, 1091, 1094, 1095, 1097, 1099, 1100, 1105, 1106, 1107, 1107, 1111, 1112); `SQLite.get` (957); `SQLite.prepare` (957, 1023, 1024, 1027, 1030, 1035, 1040, 1049, 1054, 1059, 1068, 1072, 1075, 1076, 1094, 1099); `SQLite.all` (1023, 1030, 1035, 1040, 1049, 1054, 1059, 1068, 1072, 1075, 1076, 1094, 1099) | CORE |
| [packages/store/src/store.ts:1131](../../packages/store/src/store.ts#L1131) `Store/grantFullAccessClients` | `SQLite.prepare` (1131); `Store.sql` (1131) | CORE |
| [packages/store/src/store.ts:1138](../../packages/store/src/store.ts#L1138) `Store/meta` | `SQLite.get` (1138); `SQLite.prepare` (1138); `Store.sql` (1138) | CORE |
| [packages/store/src/store.ts:1146](../../packages/store/src/store.ts#L1146) `Store/persistentTable` | `Store.sql` (1146) | CORE |
| [packages/store/src/store.ts:1156](../../packages/store/src/store.ts#L1156) `Store/persistentData` | `SQLite.get` (1156) | CORE |
| [packages/store/src/store.ts:1165](../../packages/store/src/store.ts#L1165) `Store/persistentDataIds` | `SQLite.all` (1165) | CORE |
| [packages/store/src/store.ts:1171](../../packages/store/src/store.ts#L1171) `Store/setPersistentData` | `SQLite.prepare` (1171, 1175); `Store.sql` (1171, 1175) | CORE |
| [packages/store/src/store.ts:1188](../../packages/store/src/store.ts#L1188) `Store/checkpoint` | `SQLite.get` (1188); `SQLite.prepare` (1188); `Store.sql` (1188) | CORE |
| [packages/store/src/store.ts:1196](../../packages/store/src/store.ts#L1196) `Store/recordedFormat` | `Store.sql` (1196) | CORE |
| [packages/store/src/store.ts:1206](../../packages/store/src/store.ts#L1206) `Store/close` | `Store.sql` (1206) | CORE |
| [packages/store/src/store.ts:1222](../../packages/store/src/store.ts#L1222) `Store/shipWal` | `Store.sql` (1222) | CORE |
| [packages/store/src/store.ts:1233](../../packages/store/src/store.ts#L1233) `Store/trial` | `Store.sql` (1233) | CORE |
| [packages/store/src/store.ts:1238](../../packages/store/src/store.ts#L1238) `Store/trial/undo` | `Store.sql` (1238) | CORE |
| [packages/store/src/store.ts:1273](../../packages/store/src/store.ts#L1273) `Store/joinTransaction` | `Store.sql` (1273, 1274, 1276, 1278, 1284) | CORE |
| [packages/store/src/store.ts:1296](../../packages/store/src/store.ts#L1296) `Store/independentWindowWrite` | `SQLite.get` (1296); `SQLite.prepare` (1296, 1319); `Store.sql` (1296, 1299, 1314, 1319, 1322) | CORE |
| [packages/store/src/store.ts:1340](../../packages/store/src/store.ts#L1340) `Store/withWriteTransaction` | `Store.sql` (1340, 1343, 1347, 1349, 1349) | CORE |
| [packages/store/src/store.ts:1377](../../packages/store/src/store.ts#L1377) `Store/endTransaction` | `Store.sql` (1377, 1380, 1380) | CORE |
| [packages/store/src/store.ts:1398](../../packages/store/src/store.ts#L1398) `Store/backup` | `Store.sql` (1398) | CORE |
| [packages/store/src/store.ts:1413](../../packages/store/src/store.ts#L1413) `Store/dataVersion` | `SQLite.get` (1413); `SQLite.prepare` (1413); `Store.sql` (1413) | CORE |
| [packages/store/src/store.ts:1453](../../packages/store/src/store.ts#L1453) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1453) | CORE |
| [packages/store/src/store.ts:1474](../../packages/store/src/store.ts#L1474) `Store/shareResults` | `Store.sql` (1474) | CORE |
| [packages/store/src/store.ts:1484](../../packages/store/src/store.ts#L1484) `Store/versionTriggers` | `SQLite.get` (1484); `SQLite.prepare` (1484, 1489, 1490); `Store.sql` (1484, 1486, 1487, 1489, 1490, 1499, 1500); `SQLite.all` (1489, 1490) | CORE |
| [packages/store/src/store.ts:1516](../../packages/store/src/store.ts#L1516) `Store/versionNumber` | `SQLite.get` (1516); `SQLite.prepare` (1516); `Store.sql` (1516) | CORE |
| [packages/store/src/store.ts:1529](../../packages/store/src/store.ts#L1529) `Store/changeOne` | `Store.sql` (1529, 1531) | CORE |
| [packages/store/src/store.ts:1532](../../packages/store/src/store.ts#L1532) `Store/changeOne/read` | `SQLite.get` (1532); `SQLite.prepare` (1532); `Store.sql` (1532) | CORE |
| [packages/store/src/store.ts:1571](../../packages/store/src/store.ts#L1571) `Store/writeToken` | `SQLite.get` (1571); `SQLite.prepare` (1571); `Store.sql` (1571) | CORE |
| [packages/store/src/store.ts:1583](../../packages/store/src/store.ts#L1583) `Store/recordCount` | `SQLite.get` (1583); `SQLite.prepare` (1583); `Store.sql` (1583) | CORE |
| [packages/store/src/store.ts:1687](../../packages/store/src/store.ts#L1687) `Store/applyDesign` | `Store.sql` (1687, 1688, 1699, 1702, 1707, 1721, 1724, 1724); `SQLite.prepare` (1702, 1707) | CORE |
| [packages/store/src/store.ts:1781](../../packages/store/src/store.ts#L1781) `Store/auditLog` | `SQLite.all` (1781); `SQLite.prepare` (1781); `Store.sql` (1781) | CORE |
| [packages/store/src/store.ts:1821](../../packages/store/src/store.ts#L1821) `Store/securityEvents` | `Store.auditLog` (1821) | CORE |
| [packages/store/src/store.ts:1847](../../packages/store/src/store.ts#L1847) `Store/prepared` | `SQLite.prepare` (1847); `Store.sql` (1847) | CORE |
| [packages/store/src/store.ts:1862](../../packages/store/src/store.ts#L1862) `Store/recordAsOf` | `SQLite.get` (1862, 1864); `SQLite.prepare` (1862, 1864, 1866, 1867); `Store.sql` (1862, 1864, 1866, 1867); `SQLite.all` (1866, 1867) | CORE |
| [packages/store/src/store.ts:1892](../../packages/store/src/store.ts#L1892) `Store/restoreRecord` | `Store.recordAsOf` (1892); `SQLite.get` (1896); `SQLite.prepare` (1896, 1899, 1906, 1913); `Store.sql` (1896, 1899, 1906, 1913) | CORE |
| [packages/store/src/store.ts:1927](../../packages/store/src/store.ts#L1927) `Store/revertAuditEntry` | `Store.auditLog` (1927) | CORE |
| [packages/store/src/store.ts:2020](../../packages/store/src/store.ts#L2020) `Store/setAuditSettings` | `SQLite.prepare` (2020); `Store.sql` (2020) | CORE |
| [packages/store/src/store.ts:2042](../../packages/store/src/store.ts#L2042) `Store/pruneAudit` | `Store.sql` (2042, 2044, 2046); `SQLite.get` (2044); `SQLite.prepare` (2044) | CORE |
| [packages/store/src/store.ts:2124](../../packages/store/src/store.ts#L2124) `Store/audit` | `Store.sql` (2124) | CORE |
| [packages/store/src/store.ts:2213](../../packages/store/src/store.ts#L2213) `Store/securityChange` | `Store.sql` (2213, 2215); `SQLite.prepare` (2215) | CORE |
| [packages/store/src/store.ts:2237](../../packages/store/src/store.ts#L2237) `Store/logSecurity` | `Store.sql` (2237) | CORE |
| [packages/store/src/store.ts:2260](../../packages/store/src/store.ts#L2260) `Store/ensureDeleted` | `Store.sql` (2260) | CORE |
| [packages/store/src/store.ts:2265](../../packages/store/src/store.ts#L2265) `Store/deletedRows` | `SQLite.get` (2265); `SQLite.prepare` (2265, 2267, 2267); `Store.sql` (2265, 2267, 2267); `SQLite.all` (2267, 2267) | CORE |
| [packages/store/src/store.ts:2291](../../packages/store/src/store.ts#L2291) `Store/emptyDeleted` | `Store.sql` (2291, 2294, 2295, 2297, 2299); `SQLite.prepare` (2295) | CORE |
| [packages/store/src/store.ts:2306](../../packages/store/src/store.ts#L2306) `Store/designHistory` | `SQLite.all` (2306); `SQLite.prepare` (2306); `Store.sql` (2306) | CORE |
| [packages/store/src/store.ts:2313](../../packages/store/src/store.ts#L2313) `Store/scriptHistory` | `SQLite.all` (2313); `SQLite.prepare` (2313); `Store.sql` (2313) | CORE |
| [packages/store/src/store.ts:2323](../../packages/store/src/store.ts#L2323) `Store/layoutHistory` | `SQLite.all` (2323); `SQLite.prepare` (2323); `Store.sql` (2323) | CORE |
| [packages/store/src/store.ts:2348](../../packages/store/src/store.ts#L2348) `Store/designEffect/renameKey` | `SQLite.prepare` (2348); `Store.sql` (2348) | CORE |
| [packages/store/src/store.ts:2364](../../packages/store/src/store.ts#L2364) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2364); `Store.sql` (2364) | CORE |
| [packages/store/src/store.ts:2371](../../packages/store/src/store.ts#L2371) `Store/designEffect` | `Store.sql` (2371, 2375, 2380, 2385, 2388, 2394, 2402, 2403, 2405, 2417, 2418, 2421, 2423, 2429, 2430, 2431, 2436, 2438, 2442, 2445, 2446, 2448, 2451, 2456, 2458, 2465, 2466, 2468, 2469, 2470, 2471, 2478, 2479, 2481, 2481, 2483, 2484, 2485, 2489, 2493, 2495, 2533, 2535, 2537); `SQLite.get` (2402, 2417, 2429, 2430, 2442, 2446, 2481, 2489); `SQLite.prepare` (2402, 2403, 2417, 2418, 2429, 2430, 2436, 2438, 2442, 2446, 2456, 2458, 2471, 2478, 2479, 2481, 2483, 2485, 2489, 2493); `SQLite.all` (2478, 2479); `SQLite.iterate` (2483) | CORE |
| [packages/store/src/store.ts:2545](../../packages/store/src/store.ts#L2545) `Store/dropColumnIndexes` | `SQLite.all` (2545, 2547); `SQLite.prepare` (2545, 2547); `Store.sql` (2545, 2547, 2548) | CORE |
| [packages/store/src/store.ts:2557](../../packages/store/src/store.ts#L2557) `Store/recompute` | `SQLite.prepare` (2557, 2561); `Store.sql` (2557, 2561); `SQLite.iterate` (2561); `Calculations.computeStoredStyled` (2562); `Calculations.value` (2562) | CORE |
| [packages/store/src/store.ts:2577](../../packages/store/src/store.ts#L2577) `Store/linkPrincipal` | `SQLite.get` (2577); `SQLite.prepare` (2577); `Store.sql` (2577) | CORE |
| [packages/store/src/store.ts:2584](../../packages/store/src/store.ts#L2584) `Store/linkIdentity` | `SQLite.get` (2584); `SQLite.prepare` (2584); `Store.sql` (2584) | CORE |
| [packages/store/src/store.ts:2590](../../packages/store/src/store.ts#L2590) `Store/accountsSharingLockout` | `SQLite.all` (2590); `SQLite.prepare` (2590); `Store.sql` (2590) | CORE |
| [packages/store/src/store.ts:2594](../../packages/store/src/store.ts#L2594) `Store/accounts` | `SQLite.all` (2594); `SQLite.prepare` (2594); `Store.sql` (2594) | CORE |
| [packages/store/src/store.ts:2606](../../packages/store/src/store.ts#L2606) `Store/isAgent` | `SQLite.get` (2606); `SQLite.prepare` (2606); `Store.sql` (2606) | CORE |
| [packages/store/src/store.ts:2612](../../packages/store/src/store.ts#L2612) `Store/agentNeedsApproval` | `SQLite.get` (2612); `SQLite.prepare` (2612); `Store.sql` (2612) | CORE |
| [packages/store/src/store.ts:2618](../../packages/store/src/store.ts#L2618) `Store/blankPasswordAccounts` | `SQLite.all` (2618); `SQLite.prepare` (2618); `Store.sql` (2618) | CORE |
| [packages/store/src/store.ts:2629](../../packages/store/src/store.ts#L2629) `Store/unmigratedAccounts` | `SQLite.all` (2629); `SQLite.prepare` (2629); `Store.sql` (2629) | CORE |
| [packages/store/src/store.ts:2682](../../packages/store/src/store.ts#L2682) `Store/setExternalAccount` | `SQLite.get` (2682); `SQLite.prepare` (2682, 2687); `Store.sql` (2682, 2687) | CORE |
| [packages/store/src/store.ts:2700](../../packages/store/src/store.ts#L2700) `Store/refuseLookalikeAccount` | `SQLite.all` (2700); `SQLite.prepare` (2700); `Store.sql` (2700) | CORE |
| [packages/store/src/store.ts:2709](../../packages/store/src/store.ts#L2709) `Store/isExternal` | `SQLite.get` (2709); `SQLite.prepare` (2709); `Store.sql` (2709) | CORE |
| [packages/store/src/store.ts:2730](../../packages/store/src/store.ts#L2730) `Store/setAgentAccount` | `SQLite.get` (2730); `SQLite.prepare` (2730, 2736); `Store.sql` (2730, 2736) | CORE |
| [packages/store/src/store.ts:2770](../../packages/store/src/store.ts#L2770) `Store/gateAgentWrite` | `SQLite.prepare` (2770); `Store.sql` (2770) | CORE |
| [packages/store/src/store.ts:2792](../../packages/store/src/store.ts#L2792) `Store/pendingChanges` | `SQLite.all` (2792); `SQLite.prepare` (2792); `Store.sql` (2792) | CORE |
| [packages/store/src/store.ts:2806](../../packages/store/src/store.ts#L2806) `Store/approvePending` | `SQLite.get` (2806); `SQLite.prepare` (2806, 2817); `Store.sql` (2806, 2817) | CORE |
| [packages/store/src/store.ts:2827](../../packages/store/src/store.ts#L2827) `Store/rejectPending` | `SQLite.get` (2827); `SQLite.prepare` (2827, 2829); `Store.sql` (2827, 2829) | CORE |
| [packages/store/src/store.ts:2849](../../packages/store/src/store.ts#L2849) `Store/externalAccount` | `SQLite.all` (2849); `SQLite.prepare` (2849); `Store.sql` (2849) | CORE |
| [packages/store/src/store.ts:2883](../../packages/store/src/store.ts#L2883) `Store/setPassword` | `SQLite.get` (2883); `SQLite.prepare` (2883, 2885, 2894); `Store.sql` (2883, 2885, 2894) | AUTH |
| [packages/store/src/store.ts:2909](../../packages/store/src/store.ts#L2909) `Store/createAccount` | `SQLite.get` (2909); `SQLite.prepare` (2909, 2913, 2919, 2924, 2929); `Store.sql` (2909, 2913, 2919, 2924, 2929) | CORE |
| [packages/store/src/store.ts:2937](../../packages/store/src/store.ts#L2937) `Store/appendSecurityEvent` | `Store.sql` (2937) | CORE |
| [packages/store/src/store.ts:2959](../../packages/store/src/store.ts#L2959) `Store/setPasswordPolicy` | `SQLite.prepare` (2959); `Store.sql` (2959) | CORE |
| [packages/store/src/store.ts:2995](../../packages/store/src/store.ts#L2995) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (2995); `Store.sql` (2995) | CORE |
| [packages/store/src/store.ts:3018](../../packages/store/src/store.ts#L3018) `Store/saveScriptTest` | `SQLite.prepare` (3018); `Store.sql` (3018) | CORE |
| [packages/store/src/store.ts:3027](../../packages/store/src/store.ts#L3027) `Store/deleteScriptTest` | `SQLite.prepare` (3027); `Store.sql` (3027) | CORE |
| [packages/store/src/store.ts:3062](../../packages/store/src/store.ts#L3062) `Store/setAiAllowed` | `SQLite.prepare` (3062); `Store.sql` (3062) | CORE |
| [packages/store/src/store.ts:3073](../../packages/store/src/store.ts#L3073) `Store/setAiPolicy` | `SQLite.prepare` (3073); `Store.sql` (3073) | CORE |
| [packages/store/src/store.ts:3093](../../packages/store/src/store.ts#L3093) `Store/setPiiIsolation` | `SQLite.prepare` (3093); `Store.sql` (3093) | CORE |
| [packages/store/src/store.ts:3115](../../packages/store/src/store.ts#L3115) `Store/markPiiField` | `SQLite.prepare` (3115); `Store.sql` (3115) | CORE |
| [packages/store/src/store.ts:3229](../../packages/store/src/store.ts#L3229) `Store/lastSignIns` | `Store.auditLog` (3229) | CORE |
| [packages/store/src/store.ts:3432](../../packages/store/src/store.ts#L3432) `Store/unusualAccess` | `Store.auditLog` (3432, 3498) | CORE |
| [packages/store/src/store.ts:3529](../../packages/store/src/store.ts#L3529) `Store/leastPrivilege` | `SQLite.all` (3529); `SQLite.prepare` (3529); `Store.sql` (3529) | CORE |
| [packages/store/src/store.ts:3602](../../packages/store/src/store.ts#L3602) `Store/unusedAccess` | `SQLite.get` (3602); `SQLite.prepare` (3602, 3611); `Store.sql` (3602, 3611); `SQLite.all` (3611) | CORE |
| [packages/store/src/store.ts:3650](../../packages/store/src/store.ts#L3650) `Store/unusedObjects` | `SQLite.get` (3650); `SQLite.prepare` (3650, 3653); `Store.sql` (3650, 3653); `SQLite.all` (3653) | CORE |
| [packages/store/src/store.ts:3688](../../packages/store/src/store.ts#L3688) `Store/usageCounting` | `SQLite.get` (3688); `SQLite.prepare` (3688); `Store.sql` (3688) | CORE |
| [packages/store/src/store.ts:3696](../../packages/store/src/store.ts#L3696) `Store/setMustChangePassword` | `SQLite.prepare` (3696); `Store.sql` (3696) | CORE |
| [packages/store/src/store.ts:3710](../../packages/store/src/store.ts#L3710) `Store/mustChangePassword` | `SQLite.get` (3710); `SQLite.prepare` (3710); `Store.sql` (3710) | CORE |
| [packages/store/src/store.ts:3749](../../packages/store/src/store.ts#L3749) `Store/passwordDaysRemaining` | `SQLite.get` (3749); `SQLite.prepare` (3749); `Store.sql` (3749) | CORE |
| [packages/store/src/store.ts:3756](../../packages/store/src/store.ts#L3756) `Store/importAccounts` | `SQLite.all` (3756); `SQLite.prepare` (3756); `Store.sql` (3756) | CORE |
| [packages/store/src/store.ts:3779](../../packages/store/src/store.ts#L3779) `Store/canonicalAccount` | `SQLite.all` (3779); `SQLite.prepare` (3779); `Store.sql` (3779) | CORE |
| [packages/store/src/store.ts:3791](../../packages/store/src/store.ts#L3791) `Store/createLocalAccount` | `SQLite.prepare` (3791); `Store.sql` (3791) | CORE |
| [packages/store/src/store.ts:3821](../../packages/store/src/store.ts#L3821) `Store/previewAccountImport` | `Store.sql` (3821, 3822, 3831) | CORE |
| [packages/store/src/store.ts:3839](../../packages/store/src/store.ts#L3839) `Store/limitAccountImport` | `SQLite.prepare` (3839, 3840, 3843); `Store.sql` (3839, 3840, 3843); `SQLite.get` (3840) | CORE |
| [packages/store/src/store.ts:3850](../../packages/store/src/store.ts#L3850) `Store/applyAccountImport` | `Store.sql` (3850, 3858, 3887); `SQLite.get` (3858); `SQLite.prepare` (3858, 3887) | CORE |
| [packages/store/src/store.ts:3912](../../packages/store/src/store.ts#L3912) `Store/forgetStandIns` | `SQLite.prepare` (3912); `Store.sql` (3912) | CORE |
| [packages/store/src/store.ts:3945](../../packages/store/src/store.ts#L3945) `Store/deleteAccount` | `SQLite.prepare` (3945, 3946, 3947, 3949, 3953); `Store.sql` (3945, 3946, 3947, 3949, 3953) | CORE |
| [packages/store/src/store.ts:3970](../../packages/store/src/store.ts#L3970) `Store/setAccountActive` | `SQLite.prepare` (3970, 3973, 3974); `Store.sql` (3970, 3973, 3974) | AUTH |
| [packages/store/src/store.ts:3984](../../packages/store/src/store.ts#L3984) `Store/accountInactive` | `SQLite.get` (3984); `SQLite.prepare` (3984); `Store.sql` (3984) | CORE |
| [packages/store/src/store.ts:3989](../../packages/store/src/store.ts#L3989) `Store/identityAllowed` | `SQLite.get` (3989, 3995, 4001); `SQLite.prepare` (3989, 3995, 4001); `Store.sql` (3989, 3995, 4001) | CORE |
| [packages/store/src/store.ts:4009](../../packages/store/src/store.ts#L4009) `Store/externalIdentityId` | `SQLite.get` (4009, 4015); `SQLite.prepare` (4009, 4014, 4015); `Store.sql` (4009, 4014, 4015) | CORE |
| [packages/store/src/store.ts:4020](../../packages/store/src/store.ts#L4020) `Store/accountIdentityId` | `SQLite.get` (4020, 4025); `SQLite.prepare` (4020, 4024, 4025); `Store.sql` (4020, 4024, 4025) | CORE |
| [packages/store/src/store.ts:4048](../../packages/store/src/store.ts#L4048) `Store/signInMark` | `SQLite.prepare` (4048); `Store.sql` (4048) | AUTH |
| [packages/store/src/store.ts:4058](../../packages/store/src/store.ts#L4058) `Store/signInBase` | `SQLite.get` (4058); `SQLite.prepare` (4058); `Store.sql` (4058) | AUTH |
| [packages/store/src/store.ts:4060](../../packages/store/src/store.ts#L4060) `Store/signInBase/identity` | `SQLite.get` (4060); `SQLite.prepare` (4060); `Store.sql` (4060) | AUTH |
| [packages/store/src/store.ts:4072](../../packages/store/src/store.ts#L4072) `Store/ledgerRow` | `SQLite.get` (4072, 4073); `SQLite.prepare` (4072, 4073); `Store.sql` (4072, 4073) | AUTH |
| [packages/store/src/store.ts:4084](../../packages/store/src/store.ts#L4084) `Store/ledgerWrite` | `Store.sql` (4084, 4085, 4087, 4089, 4092, 4092) | AUTH |
| [packages/store/src/store.ts:4111](../../packages/store/src/store.ts#L4111) `Store/settleSignIns` | `SQLite.all` (4111, 4117); `SQLite.prepare` (4111, 4117, 4123, 4127, 4129); `Store.sql` (4111, 4117, 4123, 4127, 4129) | AUTH |
| [packages/store/src/store.ts:4140](../../packages/store/src/store.ts#L4140) `Store/securityToken` | `SQLite.get` (4140); `SQLite.prepare` (4140); `Store.sql` (4140) | CORE |
| [packages/store/src/store.ts:4148](../../packages/store/src/store.ts#L4148) `Store/accountLocalOnly` | `SQLite.get` (4148); `SQLite.prepare` (4148); `Store.sql` (4148) | CORE |
| [packages/store/src/store.ts:4153](../../packages/store/src/store.ts#L4153) `Store/accountRequires2fa` | `SQLite.get` (4153); `SQLite.prepare` (4153); `Store.sql` (4153) | CORE |
| [packages/store/src/store.ts:4159](../../packages/store/src/store.ts#L4159) `Store/setAccountLocalOnly` | `SQLite.prepare` (4159); `Store.sql` (4159) | CORE |
| [packages/store/src/store.ts:4168](../../packages/store/src/store.ts#L4168) `Store/setAccountRequire2fa` | `SQLite.prepare` (4168); `Store.sql` (4168) | CORE |
| [packages/store/src/store.ts:4196](../../packages/store/src/store.ts#L4196) `Store/createApiToken` | `SQLite.get` (4196); `SQLite.prepare` (4196, 4224); `Store.sql` (4196, 4224) | CORE |
| [packages/store/src/store.ts:4271](../../packages/store/src/store.ts#L4271) `Store/recordObjectUse` | `Store.sql` (4271) | CORE |
| [packages/store/src/store.ts:4301](../../packages/store/src/store.ts#L4301) `Store/writeUsage` | `Store.sql` (4301, 4302, 4304, 4308, 4310) | CORE |
| [packages/store/src/store.ts:4317](../../packages/store/src/store.ts#L4317) `Store/writeUsageRows` | `SQLite.prepare` (4317, 4318, 4324); `Store.sql` (4317, 4318, 4324) | CORE |
| [packages/store/src/store.ts:4329](../../packages/store/src/store.ts#L4329) `Store/writeObjectUseRows` | `SQLite.prepare` (4329, 4330, 4335); `Store.sql` (4329, 4330, 4335) | CORE |
| [packages/store/src/store.ts:4340](../../packages/store/src/store.ts#L4340) `Store/objectUseSince` | `SQLite.get` (4340); `SQLite.prepare` (4340); `Store.sql` (4340) | CORE |
| [packages/store/src/store.ts:4353](../../packages/store/src/store.ts#L4353) `Store/accountUsage` | `SQLite.get` (4353); `SQLite.prepare` (4353, 4354); `Store.sql` (4353, 4354); `SQLite.all` (4354); `Store.auditLog` (4370) | CORE |
| [packages/store/src/store.ts:4386](../../packages/store/src/store.ts#L4386) `Store/apiTokens` | `SQLite.all` (4386); `SQLite.prepare` (4386); `Store.sql` (4386) | CORE |
| [packages/store/src/store.ts:4396](../../packages/store/src/store.ts#L4396) `Store/revokeApiToken` | `SQLite.prepare` (4396); `Store.sql` (4396) | CORE |
| [packages/store/src/store.ts:4410](../../packages/store/src/store.ts#L4410) `Store/apiToken` | `SQLite.get` (4410); `SQLite.prepare` (4410, 4422); `Store.sql` (4410, 4422) | CORE |
| [packages/store/src/store.ts:4438](../../packages/store/src/store.ts#L4438) `Store/enrollTotp` | `SQLite.prepare` (4438); `Store.sql` (4438) | CORE |
| [packages/store/src/store.ts:4449](../../packages/store/src/store.ts#L4449) `Store/confirmTotp` | `SQLite.get` (4449); `SQLite.prepare` (4449, 4451); `Store.sql` (4449, 4451) | CORE |
| [packages/store/src/store.ts:4459](../../packages/store/src/store.ts#L4459) `Store/hasTotp` | `SQLite.get` (4459); `SQLite.prepare` (4459); `Store.sql` (4459) | CORE |
| [packages/store/src/store.ts:4464](../../packages/store/src/store.ts#L4464) `Store/totpAccounts` | `SQLite.all` (4464); `SQLite.prepare` (4464); `Store.sql` (4464) | CORE |
| [packages/store/src/store.ts:4470](../../packages/store/src/store.ts#L4470) `Store/disableTotp` | `SQLite.prepare` (4470); `Store.sql` (4470) | CORE |
| [packages/store/src/store.ts:4493](../../packages/store/src/store.ts#L4493) `Store/verifyTotp` | `SQLite.get` (4493); `SQLite.prepare` (4493, 4499); `Store.sql` (4493, 4499) | CORE |
| [packages/store/src/store.ts:4512](../../packages/store/src/store.ts#L4512) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4512, 4514, 4515, 4517); `Store.sql` (4512, 4514, 4515, 4517); `SQLite.get` (4514) | CORE |
| [packages/store/src/store.ts:4564](../../packages/store/src/store.ts#L4564) `Store/passkeyAllowList` | `SQLite.all` (4564); `SQLite.prepare` (4564); `Store.sql` (4564) | CORE |
| [packages/store/src/store.ts:4578](../../packages/store/src/store.ts#L4578) `Store/takeWebauthnChallenge` | `SQLite.get` (4578); `SQLite.prepare` (4578, 4580); `Store.sql` (4578, 4580) | CORE |
| [packages/store/src/store.ts:4588](../../packages/store/src/store.ts#L4588) `Store/passkeys` | `SQLite.all` (4588); `SQLite.prepare` (4588); `Store.sql` (4588) | CORE |
| [packages/store/src/store.ts:4595](../../packages/store/src/store.ts#L4595) `Store/hasPasskey` | `SQLite.get` (4595); `SQLite.prepare` (4595); `Store.sql` (4595) | CORE |
| [packages/store/src/store.ts:4600](../../packages/store/src/store.ts#L4600) `Store/passkeyIds` | `SQLite.all` (4600); `SQLite.prepare` (4600); `Store.sql` (4600) | CORE |
| [packages/store/src/store.ts:4622](../../packages/store/src/store.ts#L4622) `Store/registerPasskey` | `SQLite.prepare` (4622); `Store.sql` (4622) | CORE |
| [packages/store/src/store.ts:4633](../../packages/store/src/store.ts#L4633) `Store/removePasskey` | `SQLite.get` (4633); `SQLite.prepare` (4633, 4634); `Store.sql` (4633, 4634) | CORE |
| [packages/store/src/store.ts:4650](../../packages/store/src/store.ts#L4650) `Store/verifyPasskeyAssertion` | `SQLite.get` (4650); `SQLite.prepare` (4650, 4661); `Store.sql` (4650, 4661) | CORE |
| [packages/store/src/store.ts:4697](../../packages/store/src/store.ts#L4697) `Store/generateRecoveryCodes` | `SQLite.prepare` (4697, 4700); `Store.sql` (4697, 4700) | CORE |
| [packages/store/src/store.ts:4715](../../packages/store/src/store.ts#L4715) `Store/recoveryCodesRemaining` | `SQLite.get` (4715); `SQLite.prepare` (4715); `Store.sql` (4715) | CORE |
| [packages/store/src/store.ts:4725](../../packages/store/src/store.ts#L4725) `Store/useRecoveryCode` | `SQLite.get` (4725); `SQLite.prepare` (4725, 4727); `Store.sql` (4725, 4727) | CORE |
| [packages/store/src/store.ts:4738](../../packages/store/src/store.ts#L4738) `Store/privilegeSets` | `Store.sql` (4738) | CORE |
| [packages/store/src/store.ts:4767](../../packages/store/src/store.ts#L4767) `Store/savePrivilegeSet` | `SQLite.prepare` (4767, 4775); `Store.sql` (4767, 4775) | AUTH |
| [packages/store/src/store.ts:4810](../../packages/store/src/store.ts#L4810) `Store/deletePrivilegeSet` | `SQLite.prepare` (4810); `Store.sql` (4810) | CORE |
| [packages/store/src/store.ts:4859](../../packages/store/src/store.ts#L4859) `Store/accountPrivilegeSet` | `SQLite.get` (4859); `SQLite.prepare` (4859); `Store.sql` (4859) | CORE |
| [packages/store/src/store.ts:4873](../../packages/store/src/store.ts#L4873) `Store/setAccountPrivilegeSet` | `SQLite.get` (4873); `SQLite.prepare` (4873, 4876, 4880); `Store.sql` (4873, 4876, 4880) | AUTH |
| [packages/store/src/store.ts:4895](../../packages/store/src/store.ts#L4895) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (4895); `Store.sql` (4895) | CORE |
| [packages/store/src/store.ts:4909](../../packages/store/src/store.ts#L4909) `Store/addProvisionedAccount` | `SQLite.get` (4909); `SQLite.prepare` (4909, 4913); `Store.sql` (4909, 4913) | CORE |
| [packages/store/src/store.ts:5074](../../packages/store/src/store.ts#L5074) `Store/ruleOutcome` | `Calculations.context` (5074) | CORE |
| [packages/store/src/store.ts:5115](../../packages/store/src/store.ts#L5115) `Store/allowedIds` | `SQLite.iterate` (5115); `SQLite.prepare` (5115); `Store.sql` (5115) | CORE |
| [packages/store/src/store.ts:5185](../../packages/store/src/store.ts#L5185) `Store/scopedTableSql` | `Store.viewableIds` (5185); `SQLite.all` (5188); `SQLite.prepare` (5188); `Store.sql` (5188) | GATED-STORE |
| [packages/store/src/store.ts:5220](../../packages/store/src/store.ts#L5220) `Store/previewRecordRuleCurrent` | `SQLite.get` (5220); `SQLite.prepare` (5220, 5223); `Store.sql` (5220, 5223); `SQLite.all` (5223); `Calculations.context` (5229, 5245) | CORE |
| [packages/store/src/store.ts:5397](../../packages/store/src/store.ts#L5397) `Store/passwordHash` | `SQLite.get` (5397); `SQLite.prepare` (5397); `Store.sql` (5397) | CORE |
| [packages/store/src/store.ts:5426](../../packages/store/src/store.ts#L5426) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5426); `Store.sql` (5426) | CORE |
| [packages/store/src/store.ts:5439](../../packages/store/src/store.ts#L5439) `Store/knownSharedAccount` | `SQLite.get` (5439); `SQLite.prepare` (5439); `Store.sql` (5439) | CORE |
| [packages/store/src/store.ts:5497](../../packages/store/src/store.ts#L5497) `Store/layouts` | `SQLite.all` (5497); `SQLite.prepare` (5497); `Store.sql` (5497) | CORE |
| [packages/store/src/store.ts:5518](../../packages/store/src/store.ts#L5518) `Store/image` | `SQLite.get` (5518); `SQLite.prepare` (5518); `Store.sql` (5518) | CORE |
| [packages/store/src/store.ts:5528](../../packages/store/src/store.ts#L5528) `Store/images` | `SQLite.all` (5528); `SQLite.prepare` (5528); `Store.sql` (5528) | CORE |
| [packages/store/src/store.ts:5541](../../packages/store/src/store.ts#L5541) `Store/addImage` | `Store.sql` (5541, 5542); `SQLite.prepare` (5542) | CORE |
| [packages/store/src/store.ts:5558](../../packages/store/src/store.ts#L5558) `Store/layout` | `SQLite.get` (5558); `SQLite.prepare` (5558); `Store.sql` (5558) | CORE |
| [packages/store/src/store.ts:5762](../../packages/store/src/store.ts#L5762) `Store/wordIndex` | `Store.sql` (5762, 5770, 5775); `Store.recordCount` (5774); `SQLite.get` (5775); `SQLite.prepare` (5775) | CORE |
| [packages/store/src/store.ts:5827](../../packages/store/src/store.ts#L5827) `Store/toRecord` | `Calculations.value` (5827, 5837); `Calculations.globalValue` (5831); `Calculations.unstoredStyled` (5836) | CORE |
| [packages/store/src/store.ts:5886](../../packages/store/src/store.ts#L5886) `Store/relatedValues` | `Calculations.globalValue` (5886); `Calculations.unstoredValue` (5888) | CORE |
| [packages/store/src/store.ts:5960](../../packages/store/src/store.ts#L5960) `Store/addRelated` | `relatedRows` (5960); `rowsById` (5992); `firstRelatedEach` (6014) | CORE |
| [packages/store/src/store.ts:6042](../../packages/store/src/store.ts#L6042) `Store/foundSetPage` | `rowsById` (6042) | CORE |
| [packages/store/src/store.ts:6058](../../packages/store/src/store.ts#L6058) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6058); `Store.row` (6074) | GATED-STORE |
| [packages/store/src/store.ts:6097](../../packages/store/src/store.ts#L6097) `Store/portalCountsCurrent` | `Store.canView` (6097); `Store.row` (6124) | GATED-STORE |
| [packages/store/src/store.ts:6160](../../packages/store/src/store.ts#L6160) `Store/fieldIndexCurrent` | `SQLite.iterate` (6160); `SQLite.prepare` (6160, 6165); `Store.sql` (6160, 6165); `SQLite.all` (6165) | GATED-STORE |
| [packages/store/src/store.ts:6206](../../packages/store/src/store.ts#L6206) `Store/valueListItemsCurrent` | `Store.valueListItems` (6206); `Store.get` (6220); `relatedRows` (6221); `Store.row` (6221); `SQLite.iterate` (6223); `SQLite.prepare` (6223); `Store.sql` (6223); `Calculations.related` (6233); `Calculations.value` (6237, 6238) | GATED-STORE |
| [packages/store/src/store.ts:6335](../../packages/store/src/store.ts#L6335) `Store/portalRows` | `relatedRows` (6335); `relatedIdList` (6336); `Store.viewableIds` (6339); `rowsById` (6364, 6402); `Calculations.related` (6378) | CORE |
| [packages/store/src/store.ts:6346](../../packages/store/src/store.ts#L6346) `Store/portalRows/context` | `Calculations.context` (6346) | CORE |
| [packages/store/src/store.ts:6356](../../packages/store/src/store.ts#L6356) `Store/portalRows/valueOf` | `Calculations.value` (6356) | CORE |
| [packages/store/src/store.ts:6473](../../packages/store/src/store.ts#L6473) `Store/markRepeating` | `SQLite.prepare` (6473); `Store.sql` (6473) | CORE |
| [packages/store/src/store.ts:6500](../../packages/store/src/store.ts#L6500) `Store/externalContainerCheck` | `SQLite.all` (6500); `SQLite.prepare` (6500); `Store.sql` (6500) | CORE |
| [packages/store/src/store.ts:6507](../../packages/store/src/store.ts#L6507) `Store/externalContainerCount` | `SQLite.get` (6507); `SQLite.prepare` (6507); `Store.sql` (6507) | CORE |
| [packages/store/src/store.ts:6516](../../packages/store/src/store.ts#L6516) `Store/externalContainerReport` | `SQLite.all` (6516, 6529); `SQLite.prepare` (6516, 6529); `Store.sql` (6516, 6529) | CORE |
| [packages/store/src/store.ts:6571](../../packages/store/src/store.ts#L6571) `Store/orphanContainerReport` | `SQLite.all` (6571, 6589, 6591, 6597, 6610, 6623, 6642, 6660); `SQLite.prepare` (6571, 6589, 6591, 6597, 6610, 6623, 6640, 6642, 6660); `Store.sql` (6571, 6589, 6591, 6597, 6610, 6623, 6640, 6642, 6660); `SQLite.get` (6640); `Store.row` (6654) | CORE |
| [packages/store/src/store.ts:6671](../../packages/store/src/store.ts#L6671) `Store/purgeOrphanContainers` | `Store.sql` (6671, 6680, 6683, 6685, 6686, 6691, 6693); `Store.orphanContainerReport` (6672); `SQLite.get` (6680); `SQLite.prepare` (6680, 6685, 6686) | CORE |
| [packages/store/src/store.ts:6706](../../packages/store/src/store.ts#L6706) `Store/containerIntact` | `SQLite.get` (6706); `SQLite.prepare` (6706); `Store.sql` (6706) | CORE |
| [packages/store/src/store.ts:6716](../../packages/store/src/store.ts#L6716) `Store/externalOf` | `SQLite.get` (6716); `SQLite.prepare` (6716); `Store.sql` (6716) | CORE |
| [packages/store/src/store.ts:6720](../../packages/store/src/store.ts#L6720) `Store/containerMeta` | `SQLite.get` (6720); `SQLite.prepare` (6720); `Store.sql` (6720) | CORE |
| [packages/store/src/store.ts:6725](../../packages/store/src/store.ts#L6725) `Store/container` | `SQLite.get` (6725); `SQLite.prepare` (6725, 6734); `Store.sql` (6725, 6734); `SQLite.all` (6734) | CORE |
| [packages/store/src/store.ts:6742](../../packages/store/src/store.ts#L6742) `Store/containerInfo` | `SQLite.get` (6742); `SQLite.prepare` (6742); `Store.sql` (6742) | CORE |
| [packages/store/src/store.ts:6776](../../packages/store/src/store.ts#L6776) `Store/containerRange` | `SQLite.all` (6776); `SQLite.prepare` (6776, 6783); `Store.sql` (6776, 6783); `SQLite.get` (6783) | CORE |
| [packages/store/src/store.ts:6796](../../packages/store/src/store.ts#L6796) `Store/addContainer` | `SQLite.prepare` (6796, 6800, 6801); `Store.sql` (6796, 6798, 6800, 6801, 6803, 6806) | CORE |
| [packages/store/src/store.ts:6822](../../packages/store/src/store.ts#L6822) `Store/addExternalContainer` | `SQLite.prepare` (6822); `Store.sql` (6822) | CORE |
| [packages/store/src/store.ts:6840](../../packages/store/src/store.ts#L6840) `Store/writeExternalFile` | `Store.evaluateEach` (6840); `SQLite.prepare` (6863); `Store.sql` (6863) | CORE |
| [packages/store/src/store.ts:6864](../../packages/store/src/store.ts#L6864) `Store/writeExternalFile/taken` | `SQLite.get` (6864) | CORE |
| [packages/store/src/store.ts:6881](../../packages/store/src/store.ts#L6881) `Store/embeddedContainers` | `SQLite.prepare` (6881, 6882); `Store.sql` (6881, 6882); `SQLite.all` (6882); `SQLite.get` (6886) | CORE |
| [packages/store/src/store.ts:6895](../../packages/store/src/store.ts#L6895) `Store/embeddedContainerCount` | `SQLite.prepare` (6895); `Store.sql` (6895); `SQLite.get` (6896) | CORE |
| [packages/store/src/store.ts:6904](../../packages/store/src/store.ts#L6904) `Store/recoverContainersOut` | `SQLite.prepare` (6904); `Store.sql` (6904); `SQLite.get` (6907) | CORE |
| [packages/store/src/store.ts:6929](../../packages/store/src/store.ts#L6929) `Store/moveContainersOut` | `Store.sql` (6929, 6937, 6939, 6941, 6943, 6944, 6963, 6968, 6970, 6972, 6973, 6977); `SQLite.get` (6937); `SQLite.prepare` (6937, 6943, 6944); `Store.container` (6946) | CORE |
| [packages/store/src/store.ts:6986](../../packages/store/src/store.ts#L6986) `Store/moveContainersIn` | `Store.sql` (6986, 6990, 6992, 6993, 6994, 6995, 7014, 7017, 7024, 7027, 7030, 7037); `SQLite.prepare` (6992, 6993, 6994, 6995, 7024, 7030); `SQLite.get` (6997, 7024, 7030) | CORE |
| [packages/store/src/store.ts:7049](../../packages/store/src/store.ts#L7049) `Store/compactFile` | `Store.sql` (7049, 7050, 7051) | CORE |
| [packages/store/src/store.ts:7057](../../packages/store/src/store.ts#L7057) `Store/containerId` | `Store.containerId` (7057); `Store.row` (7058) | CORE |
| [packages/store/src/store.ts:7080](../../packages/store/src/store.ts#L7080) `Store/checkContainerWrite` | `Store.row` (7080) | CORE |
| [packages/store/src/store.ts:7090](../../packages/store/src/store.ts#L7090) `Store/setContainer` | `Store.row` (7090); `SQLite.prepare` (7101); `Store.sql` (7101) | CORE |
| [packages/store/src/store.ts:7133](../../packages/store/src/store.ts#L7133) `Store/orderBy` | `Store.valueListItems` (7133) | CORE |
| [packages/store/src/store.ts:7156](../../packages/store/src/store.ts#L7156) `Store/userPrefs` | `SQLite.all` (7156); `SQLite.prepare` (7156); `Store.sql` (7156) | CORE |
| [packages/store/src/store.ts:7161](../../packages/store/src/store.ts#L7161) `Store/hasTable` | `SQLite.get` (7161); `SQLite.prepare` (7161); `Store.sql` (7161) | CORE |
| [packages/store/src/store.ts:7165](../../packages/store/src/store.ts#L7165) `Store/setUserPref` | `Store.sql` (7165, 7166, 7167); `SQLite.prepare` (7166, 7167) | CORE |
| [packages/store/src/store.ts:7173](../../packages/store/src/store.ts#L7173) `Store/indexedFields` | `SQLite.all` (7173, 7174); `SQLite.prepare` (7173, 7174); `Store.sql` (7173, 7174) | CORE |
| [packages/store/src/store.ts:7195](../../packages/store/src/store.ts#L7195) `Store/addFieldIndex` | `Store.sql` (7195) | CORE |
| [packages/store/src/store.ts:7207](../../packages/store/src/store.ts#L7207) `Store/dropFieldIndex` | `SQLite.get` (7207); `SQLite.prepare` (7207); `Store.sql` (7207, 7208) | CORE |
| [packages/store/src/store.ts:7218](../../packages/store/src/store.ts#L7218) `Store/timeFind` | `Store.query` (7218, 7222, 7223); `Store.recordCount` (7225) | CORE |
| [packages/store/src/store.ts:7242](../../packages/store/src/store.ts#L7242) `Store/find` | `Store.find` (7242) | GATED-STORE |
| [packages/store/src/store.ts:7253](../../packages/store/src/store.ts#L7253) `Store/findHere` | `Store.query` (7253, 7258, 7260, 7274, 7276, 7286); `Store.recordCount` (7271); `SQLite.get` (7272, 7276); `SQLite.prepare` (7272, 7276, 7281, 7288, 7297); `Store.sql` (7272, 7276, 7281, 7288, 7297); `SQLite.all` (7281, 7288, 7297) | GATED-STORE |
| [packages/store/src/store.ts:7292](../../packages/store/src/store.ts#L7292) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7292); `SQLite.prepare` (7292); `Store.sql` (7292) | GATED-STORE |
| [packages/store/src/store.ts:7325](../../packages/store/src/store.ts#L7325) `Store/sortedPage` | `SQLite.iterate` (7325); `SQLite.prepare` (7325, 7340); `Store.sql` (7325, 7340); `SQLite.all` (7340) | CORE |
| [packages/store/src/store.ts:7397](../../packages/store/src/store.ts#L7397) `Store/relatedCriteria/matched` | `relatedRows` (7397) | CORE |
| [packages/store/src/store.ts:7400](../../packages/store/src/store.ts#L7400) `Store/relatedCriteria` | `SQLite.iterate` (7400); `SQLite.prepare` (7400); `Store.sql` (7400) | CORE |
| [packages/store/src/store.ts:7426](../../packages/store/src/store.ts#L7426) `Store/computedRows` | `Store.sql` (7426, 7429, 7430, 7431, 7433, 7443, 7444, 7445, 7448); `SQLite.prepare` (7429, 7431, 7433, 7443); `SQLite.iterate` (7433); `Calculations.globalValue` (7436); `Calculations.unstoredValue` (7437); `Calculations.related` (7440); `SQLite.all` (7443) | CORE |
| [packages/store/src/store.ts:7473](../../packages/store/src/store.ts#L7473) `Store/summaries` | `Calculations.wholeTable` (7473); `Calculations.collect` (7493, 7498) | CORE |
| [packages/store/src/store.ts:7489](../../packages/store/src/store.ts#L7489) `Store/summaries/recs` | `SQLite.iterate` (7489); `SQLite.prepare` (7489); `Store.sql` (7489) | CORE |
| [packages/store/src/store.ts:7511](../../packages/store/src/store.ts#L7511) `Store/runningSummaryValues` | `Store.viewableIds` (7511); `rowsById` (7513); `Calculations.value` (7524, 7530); `Calculations.related` (7541) | GATED-STORE |
| [packages/store/src/store.ts:7554](../../packages/store/src/store.ts#L7554) `Store/findSource` | `Store.query` (7554); `Store.sql` (7561, 7562, 7566, 7568, 7579, 7581); `SQLite.prepare` (7562, 7568); `SQLite.iterate` (7568); `Calculations.globalValue` (7572); `Calculations.unstoredValue` (7573); `Calculations.related` (7577) | CORE |
| [packages/store/src/store.ts:7600](../../packages/store/src/store.ts#L7600) `Store/previewRow` | `Store.row` (7600) | CORE |
| [packages/store/src/store.ts:7618](../../packages/store/src/store.ts#L7618) `Store/row` | `SQLite.get` (7618) | CORE |
| [packages/store/src/store.ts:7637](../../packages/store/src/store.ts#L7637) `Store/getCurrent` | `Store.get` (7637); `Store.row` (7638, 7638, 7652); `SQLite.all` (7655); `SQLite.prepare` (7655); `Store.sql` (7655) | GATED-STORE |
| [packages/store/src/store.ts:7675](../../packages/store/src/store.ts#L7675) `Store/getManyCurrent` | `Store.getMany` (7675); `SQLite.get` (7693); `SQLite.prepare` (7693); `Store.sql` (7693) | GATED-STORE |
| [packages/store/src/store.ts:7686](../../packages/store/src/store.ts#L7686) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (7686) | GATED-STORE |
| [packages/store/src/store.ts:7709](../../packages/store/src/store.ts#L7709) `Store/canViewRecord` | `SQLite.get` (7709); `SQLite.prepare` (7709); `Store.sql` (7709) | GATED-STORE |
| [packages/store/src/store.ts:7717](../../packages/store/src/store.ts#L7717) `Store/canView` | `Store.canView` (7717); `Store.row` (7718) | GATED-STORE |
| [packages/store/src/store.ts:7742](../../packages/store/src/store.ts#L7742) `Store/create` | `SQLite.get` (7742, 7748); `SQLite.prepare` (7742, 7748, 7759); `Store.sql` (7742, 7748, 7759) | CORE |
| [packages/store/src/store.ts:7783](../../packages/store/src/store.ts#L7783) `Store/duplicate` | `Store.row` (7783); `SQLite.get` (7787); `SQLite.prepare` (7787, 7800); `Store.sql` (7787, 7800) | CORE |
| [packages/store/src/store.ts:7845](../../packages/store/src/store.ts#L7845) `Store/update` | `Store.row` (7845, 7852, 7863); `Store.sql` (7876, 7877, 7914, 7917) | CORE |
| [packages/store/src/store.ts:7879](../../packages/store/src/store.ts#L7879) `Store/update/undo` | `Store.sql` (7879) | CORE |
| [packages/store/src/store.ts:8021](../../packages/store/src/store.ts#L8021) `Store/setStoredCalcValues` | `SQLite.prepare` (8021, 8022); `Store.sql` (8021, 8022); `SQLite.get` (8026) | CORE |
| [packages/store/src/store.ts:8100](../../packages/store/src/store.ts#L8100) `Store/evaluateCurrent` | `Store.row` (8100, 8100); `Calculations.context` (8103); `Store.get` (8104, 8106) | GATED-STORE |
| [packages/store/src/store.ts:8138](../../packages/store/src/store.ts#L8138) `Store/evaluateEachCurrent` | `Store.row` (8138, 8138); `Calculations.context` (8143); `Store.get` (8145) | GATED-STORE |
| [packages/store/src/store.ts:8178](../../packages/store/src/store.ts#L8178) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8178); `Store.get` (8180) | GATED-STORE |
| [packages/store/src/store.ts:8199](../../packages/store/src/store.ts#L8199) `Store/evaluateRowsCurrent` | `Store.row` (8199, 8199) | GATED-STORE |
| [packages/store/src/store.ts:8213](../../packages/store/src/store.ts#L8213) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8213) | GATED-STORE |
| [packages/store/src/store.ts:8235](../../packages/store/src/store.ts#L8235) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8235) | GATED-STORE |
| [packages/store/src/store.ts:8273](../../packages/store/src/store.ts#L8273) `Store/updateRelated` | `relatedRows` (8273) | CORE |
| [packages/store/src/store.ts:8291](../../packages/store/src/store.ts#L8291) `Store/updatePortals` | `Store.row` (8291, 8326); `relatedRows` (8327) | CORE |
| [packages/store/src/store.ts:8300](../../packages/store/src/store.ts#L8300) `Store/updatePortals/portal/related` | `relatedIdList` (8300) | CORE |
| [packages/store/src/store.ts:8382](../../packages/store/src/store.ts#L8382) `Store/portalContainerTarget` | `Store.row` (8382); `relatedIdList` (8383) | CORE |
| [packages/store/src/store.ts:8396](../../packages/store/src/store.ts#L8396) `Store/checkEditable` | `Store.row` (8396) | CORE |
| [packages/store/src/store.ts:8419](../../packages/store/src/store.ts#L8419) `Store/delete` | `Store.row` (8419); `SQLite.get` (8424); `SQLite.prepare` (8424, 8426); `Store.sql` (8424, 8426) | CORE |
| [packages/store/src/store.ts:8447](../../packages/store/src/store.ts#L8447) `Store/vaultHeld` | `SQLite.get` (8447); `SQLite.prepare` (8447); `Store.sql` (8447) | CORE |
| [packages/store/src/store.ts:8454](../../packages/store/src/store.ts#L8454) `Store/forgetStandInValues` | `Store.sql` (8454, 8475); `SQLite.prepare` (8475) | CORE |
| [packages/store/src/store.ts:8489](../../packages/store/src/store.ts#L8489) `Store/restoreDeletedRow` | `SQLite.get` (8489); `SQLite.prepare` (8489, 8490, 8492); `Store.sql` (8489, 8490, 8492); `SQLite.all` (8490) | CORE |
| [packages/store/src/store.ts:8516](../../packages/store/src/store.ts#L8516) `Store/cascadeDelete` | `relatedRows` (8516) | CORE |
| [packages/store/src/store.ts:8606](../../packages/store/src/store.ts#L8606) `Store/selectIdsCurrent` | `Store.selectIds` (8606); `SQLite.all` (8612); `SQLite.prepare` (8612); `Store.sql` (8612) | GATED-STORE |
| [packages/store/src/store.ts:8620](../../packages/store/src/store.ts#L8620) `Store/countIds` | `Store.countIds` (8620); `SQLite.get` (8624); `SQLite.prepare` (8624); `Store.sql` (8624) | GATED-STORE |
| [packages/store/src/store.ts:8640](../../packages/store/src/store.ts#L8640) `Store/computeValuesCurrent` | `Store.computeValues` (8640); `Store.sql` (8646, 8650); `SQLite.all` (8650); `SQLite.prepare` (8650) | GATED-STORE |
| [packages/store/src/store.ts:8665](../../packages/store/src/store.ts#L8665) `Store/findIdsCurrent` | `Store.findIds` (8665) | GATED-STORE |
| [packages/store/src/store.ts:8671](../../packages/store/src/store.ts#L8671) `Store/findIdsHere` | `Store.query` (8671, 8676, 8678); `SQLite.iterate` (8689); `SQLite.prepare` (8689); `Store.sql` (8689) | GATED-STORE |
| [packages/store/src/store.ts:8706](../../packages/store/src/store.ts#L8706) `Store/groupSummariesCurrent` | `Store.groupSummaries` (8706); `Store.viewableIds` (8711); `Calculations.collect` (8727); `rowsById` (8727, 8777); `Calculations.collector` (8749) | GATED-STORE |
| [packages/store/src/store.ts:8739](../../packages/store/src/store.ts#L8739) `Store/groupSummariesCurrent/key` | `Calculations.value` (8739); `Calculations.related` (8741) | GATED-STORE |
| [packages/store/src/store.ts:8775](../../packages/store/src/store.ts#L8775) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (8775) | GATED-STORE |
| [packages/store/src/store.ts:8798](../../packages/store/src/store.ts#L8798) `Store/sortIdsCurrent` | `Store.sortIds` (8798); `SQLite.all` (8802); `SQLite.prepare` (8802); `Store.sql` (8802) | GATED-STORE |
| [packages/store/src/store.ts:8812](../../packages/store/src/store.ts#L8812) `Store/matchIds` | `Store.matchIds` (8812); `SQLite.all` (8818); `SQLite.prepare` (8818); `Store.sql` (8818) | CORE |
| [packages/store/src/store.ts:8836](../../packages/store/src/store.ts#L8836) `Store/truncate` | `Store.sql` (8836, 8838, 8845, 8846, 8848, 8849); `SQLite.prepare` (8838, 8845); `SQLite.all` (8840) | CORE |
| [packages/store/src/store.ts:8870](../../packages/store/src/store.ts#L8870) `Store/iterateCommitted` | `SQLite.iterate` (8870) | CORE |
| [packages/store/src/store.ts:8904](../../packages/store/src/store.ts#L8904) `Store/readOnlyChecked` | `SQLite.prepare` (8904, 8908, 8917, 8922); `SQLite.all` (8908, 8917, 8922) | CORE |
| [packages/store/src/store.ts:8944](../../packages/store/src/store.ts#L8944) `Store/refreshDecimalSqlViews` | `SQLite.get` (8944); `SQLite.prepare` (8944, 8949); `SQLite.all` (8949) | CORE |
| [packages/store/src/store.ts:8963](../../packages/store/src/store.ts#L8963) `Store/internalRoots` | `SQLite.get` (8963); `SQLite.prepare` (8963, 8965); `SQLite.all` (8965) | CORE |
| [packages/store/src/store.ts:8998](../../packages/store/src/store.ts#L8998) `Store/selectCurrent` | `SQLite.iterate` (8998) | CORE |
| [packages/store/src/store.ts:9019](../../packages/store/src/store.ts#L9019) `Store/query` | `SQLite.iterate` (9019) | CORE |
| [packages/store/src/store.ts:9053](../../packages/store/src/store.ts#L9053) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9053); `SQLite.all` (9060, 9063); `SQLite.prepare` (9060, 9063) | CORE |
| [packages/store/src/sync-apply.ts:170](../../packages/store/src/sync-apply.ts#L170) `logRow` | `SQLite.prepare` (170); `Store.sql` (170) | OPERATOR |
| [packages/store/src/sync-apply.ts:177](../../packages/store/src/sync-apply.ts#L177) `finishRow` | `SQLite.prepare` (177); `Store.sql` (177) | OPERATOR |
| [packages/store/src/sync-apply.ts:184](../../packages/store/src/sync-apply.ts#L184) `atomically` | `Store.sql` (184, 187, 190, 191) | OPERATOR |
| [packages/store/src/sync-apply.ts:197](../../packages/store/src/sync-apply.ts#L197) `upsertMap` | `SQLite.prepare` (197); `Store.sql` (197) | OPERATOR |
| [packages/store/src/sync-apply.ts:205](../../packages/store/src/sync-apply.ts#L205) `dropMap` | `SQLite.prepare` (205); `Store.sql` (205) | OPERATOR |
| [packages/store/src/sync-apply.ts:210](../../packages/store/src/sync-apply.ts#L210) `heldReason` | `SQLite.get` (210); `SQLite.prepare` (210); `Store.sql` (210) | OPERATOR |
| [packages/store/src/sync-apply.ts:215](../../packages/store/src/sync-apply.ts#L215) `holdTable` | `SQLite.prepare` (215); `Store.sql` (215) | OPERATOR |
| [packages/store/src/sync-apply.ts:227](../../packages/store/src/sync-apply.ts#L227) `releaseHeldTables` | `SQLite.prepare` (227); `Store.sql` (227) | OPERATOR |
| [packages/store/src/sync-apply.ts:236](../../packages/store/src/sync-apply.ts#L236) `readSyncLog` | `SQLite.get` (236); `SQLite.prepare` (236, 238, 239); `Store.sql` (236, 238, 239); `SQLite.all` (238, 239) | OPERATOR |
| [packages/store/src/sync-apply.ts:280](../../packages/store/src/sync-apply.ts#L280) `recordsIn` | `SQLite.get` (280); `SQLite.prepare` (280); `Store.sql` (280) | OPERATOR |
| [packages/store/src/sync-apply.ts:320](../../packages/store/src/sync-apply.ts#L320) `applySyncRun` | `Store.container` (320, 321, 348); `Store.containerInfo` (334); `SQLite.prepare` (429, 661, 684); `Store.sql` (429, 661, 684); `SQLite.get` (661, 684) | OPERATOR |
| [packages/store/src/sync-apply.ts:450](../../packages/store/src/sync-apply.ts#L450) `applySyncRun/fail` | `SQLite.get` (450); `SQLite.prepare` (450); `Store.sql` (450) | OPERATOR |
| [packages/store/src/sync-apply.ts:578](../../packages/store/src/sync-apply.ts#L578) `applySyncRun/containerChanges` | `Store.container` (578) | OPERATOR |
| [packages/store/src/sync-apply.ts:724](../../packages/store/src/sync-apply.ts#L724) `applySyncRun/filesToSend` | `Store.containerInfo` (724); `Store.container` (728) | OPERATOR |
| [packages/store/src/sync.ts:45](../../packages/store/src/sync.ts#L45) `openForPlanning` | `SQLite.get` (45); `SQLite.prepare` (45) | OPERATOR |
| [packages/store/src/sync.ts:188](../../packages/store/src/sync.ts#L188) `tableExists` | `SQLite.get` (188); `SQLite.prepare` (188); `Store.sql` (188) | OPERATOR |
| [packages/store/src/sync.ts:198](../../packages/store/src/sync.ts#L198) `ensureSyncTables` | `Store.sql` (198, 212, 222) | OPERATOR |
| [packages/store/src/sync.ts:242](../../packages/store/src/sync.ts#L242) `readSyncMap` | `SQLite.all` (242); `SQLite.prepare` (242); `Store.sql` (242) | OPERATOR |
| [packages/store/src/sync.ts:263](../../packages/store/src/sync.ts#L263) `lastPullTimestamp` | `SQLite.get` (263); `SQLite.prepare` (263); `Store.sql` (263) | OPERATOR |
| [packages/store/src/sync.ts:282](../../packages/store/src/sync.ts#L282) `readLocalRecords` | `SQLite.all` (282); `SQLite.prepare` (282); `Store.sql` (282) | OPERATOR |
| [packages/store/src/text-styles.ts:22](../../packages/store/src/text-styles.ts#L22) `ensureTextStyles` | `SQLite.all` (22, 26); `SQLite.prepare` (22, 26) | CORE |
| [packages/store/src/text-styles.ts:73](../../packages/store/src/text-styles.ts#L73) `TextStyles/st` | `SQLite.prepare` (73) | CORE |
| [packages/store/src/text-styles.ts:81](../../packages/store/src/text-styles.ts#L81) `TextStyles/has` | `SQLite.all` (81) | CORE |
| [packages/store/src/text-styles.ts:94](../../packages/store/src/text-styles.ts#L94) `TextStyles/rows` | `SQLite.all` (94) | CORE |
| [packages/store/src/trace.ts:137](../../packages/store/src/trace.ts#L137) `traceDatabase/get` | `SQLite.prepare` (137) | CORE |
| [packages/store/src/words.ts:78](../../packages/store/src/words.ts#L78) `WordIndexes/ensure` | `SQLite.prepare` (78, 82); `SQLite.get` (81); `SQLite.all` (82) | CORE |
| [packages/store/src/words.ts:85](../../packages/store/src/words.ts#L85) `WordIndexes/ensure/covers` | `SQLite.get` (85, 89); `SQLite.all` (86); `SQLite.prepare` (86, 89) | CORE |
| [packages/store/src/words.ts:155](../../packages/store/src/words.ts#L155) `WordIndexes/dropAll` | `SQLite.all` (155); `SQLite.prepare` (155) | CORE |
<!-- end generated read-gate inventory -->
