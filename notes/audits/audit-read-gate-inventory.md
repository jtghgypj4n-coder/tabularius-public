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
| [packages/cli/src/main.ts:653](../../packages/cli/src/main.ts#L653) `accountsWithPasswordOff` | `SQLite.all` (653); `SQLite.prepare` (653) | OPERATOR |
| [packages/cli/src/main.ts:682](../../packages/cli/src/main.ts#L682) `hostedRead` | `SQLite.all` (682, 685); `SQLite.prepare` (682, 685); `Store.sql` (682, 685) | OPERATOR |
| [packages/cli/src/main.ts:2270](../../packages/cli/src/main.ts#L2270) `main` | `Store.orphanContainerReport` (2270); `Store.auditLog` (2733); `SQLite.get` (2949); `SQLite.prepare` (2949) | OPERATOR |
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
| [packages/scripts/src/engine.ts:7759](../../packages/scripts/src/engine.ts#L7759) `ScriptEngine/containerFile` | `Store.get` (7759); `Store.containerId` (7760); `Store.container` (7761) | SCRIPT |
| [packages/scripts/src/engine.ts:7920](../../packages/scripts/src/engine.ts#L7920) `ScriptEngine/importRecords` | `Store.findIds` (7920); `Store.get` (7940) | SCRIPT |
| [packages/scripts/src/engine.ts:8138](../../packages/scripts/src/engine.ts#L8138) `ScriptEngine/fileMakerRows` | `Store.findIds` (8138); `Store.get` (8143) | SCRIPT |
| [packages/scripts/src/engine.ts:8178](../../packages/scripts/src/engine.ts#L8178) `ScriptEngine/newRecord` | `Store.findIds` (8178) | SCRIPT |
| [packages/scripts/src/engine.ts:8475](../../packages/scripts/src/engine.ts#L8475) `ScriptEngine/performFind` | `Store.findIds` (8475) | SCRIPT |
| [packages/scripts/src/engine.ts:8500](../../packages/scripts/src/engine.ts#L8500) `ScriptEngine/findRelated` | `Store.findIds` (8500, 8510, 8513) | SCRIPT |
| [packages/scripts/src/engine.ts:8532](../../packages/scripts/src/engine.ts#L8532) `ScriptEngine/quickFind` | `Store.findIds` (8532, 8533, 8536) | SCRIPT |
| [packages/scripts/src/engine.ts:8901](../../packages/scripts/src/engine.ts#L8901) `clearRecords` | `SQLite.all` (8901); `SQLite.prepare` (8901) | SCRIPT |
| [packages/scripts/src/recorder.ts:72](../../packages/scripts/src/recorder.ts#L72) `lastSeq` | `Store.auditLog` (72) | DESIGN |
| [packages/scripts/src/recorder.ts:104](../../packages/scripts/src/recorder.ts#L104) `recordRun` | `Store.auditLog` (104) | DESIGN |
| [packages/scripts/src/script-tests.ts:211](../../packages/scripts/src/script-tests.ts#L211) `runCase` | `Store.findIds` (211); `Store.auditLog` (218, 219, 261); `Store.evaluateEach` (245) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/server/src/admin.ts:964](../../packages/server/src/admin.ts#L964) `Admin/handle` | `Store.externalContainerReport` (964); `Store.orphanContainerReport` (969, 973) | ADMIN |
| [packages/server/src/admin.ts:2085](../../packages/server/src/admin.ts#L2085) `Admin/audit` | `Store.auditLog` (2085) | ADMIN |
| [packages/server/src/admin.ts:2168](../../packages/server/src/admin.ts#L2168) `Admin/viewAs` | `Store.find` (2168) | ADMIN |
| [packages/server/src/admin.ts:2516](../../packages/server/src/admin.ts#L2516) `Admin/status` | `Store.externalContainerCount` (2516) | ADMIN |
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
| [packages/server/src/backup.ts:966](../../packages/server/src/backup.ts#L966) `accountDifferences/read` | `SQLite.all` (966, 968); `SQLite.prepare` (966, 968) | OPERATOR |
| [packages/server/src/backup.ts:993](../../packages/server/src/backup.ts#L993) `readNames` | `SQLite.all` (993); `SQLite.prepare` (993) | OPERATOR |
| [packages/server/src/backup.ts:1023](../../packages/server/src/backup.ts#L1023) `credentialsReadable` | `SQLite.all` (1023); `SQLite.prepare` (1023) | OPERATOR |
| [packages/server/src/backup.ts:1039](../../packages/server/src/backup.ts#L1039) `columnInfo` | `SQLite.all` (1039); `SQLite.prepare` (1039) | OPERATOR |
| [packages/server/src/backup.ts:1074](../../packages/server/src/backup.ts#L1074) `reconcileCredentials` | `SQLite.all` (1074, 1096, 1111, 1121, 1127); `SQLite.prepare` (1074, 1082, 1096, 1098, 1111, 1112, 1119, 1121, 1122, 1127, 1128, 1132, 1133, 1134); `SQLite.get` (1082, 1132) | OPERATOR |
| [packages/server/src/backup.ts:1077](../../packages/server/src/backup.ts#L1077) `reconcileCredentials/has` | `SQLite.all` (1077); `SQLite.prepare` (1077) | OPERATOR |
| [packages/server/src/backup.ts:1101](../../packages/server/src/backup.ts#L1101) `reconcileCredentials/accountColumns` | `SQLite.all` (1101); `SQLite.prepare` (1101) | OPERATOR |
| [packages/server/src/backup.ts:1246](../../packages/server/src/backup.ts#L1246) `stageRestorePoint` | `SQLite.get` (1246, 1248, 1249); `SQLite.prepare` (1246, 1248, 1249) | OPERATOR |
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
| [packages/server/src/debug.ts:309](../../packages/server/src/debug.ts#L309) `DebugApi/handle` | `Store.row` (309, 418); `Store.get` (316, 423); `Store.evaluate` (331) | DESIGN |
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
| [packages/server/src/formula-preview.ts:30](../../packages/server/src/formula-preview.ts#L30) `previewFormula` | `Store.findIds` (30); `Store.evaluate` (41) | DESIGN |
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
| [packages/server/src/insight.ts:1087](../../packages/server/src/insight.ts#L1087) `solutionOverview/counts` | `Store.query` (1087) | DESIGN |
| [packages/server/src/live.ts:137](../../packages/server/src/live.ts#L137) `Live/handle` | `Store.canViewRecord` (137, 144); `Store.canView` (189) | LIVE |
| [packages/server/src/live.ts:276](../../packages/server/src/live.ts#L276) `Live/stream/listener` | `Store.canViewRecord` (276, 278) | LIVE |
| [packages/server/src/logs.ts:76](../../packages/server/src/logs.ts#L76) `LogShipper/follow` | `SQLite.get` (76); `SQLite.prepare` (76); `Store.sql` (76, 77, 78, 79) | ADMIN |
| [packages/server/src/logs.ts:88](../../packages/server/src/logs.ts#L88) `LogShipper/releaseIfIdle` | `Store.sql` (88) | ADMIN |
| [packages/server/src/mcp-design.ts:506](../../packages/server/src/mcp-design.ts#L506) `registerDesignTools/audit_log` | `Store.auditLog` (506) | DESIGN |
| [packages/server/src/mcp.ts:963](../../packages/server/src/mcp.ts#L963) `createMcpServer/find_records` | `Store.find` (963) | MCP |
| [packages/server/src/mcp.ts:976](../../packages/server/src/mcp.ts#L976) `createMcpServer/get_record` | `Store.get` (976) | MCP |
| [packages/server/src/mcp.ts:1026](../../packages/server/src/mcp.ts#L1026) `createMcpServer/update_record` | `Store.get` (1026, 1030) | MCP |
| [packages/server/src/mcp.ts:1083](../../packages/server/src/mcp.ts#L1083) `createMcpServer/evaluate_calculation` | `Store.get` (1083, 1091); `Store.find` (1084); `Store.evaluate` (1085); `Store.row` (1090) | SQL |
| [packages/server/src/mcp.ts:1158](../../packages/server/src/mcp.ts#L1158) `createMcpServer/get_container` | `Store.container` (1158) | SQL |
| [packages/server/src/mcp.ts:1182](../../packages/server/src/mcp.ts#L1182) `createMcpServer/sql_query` | `Store.queryWithOrigins` (1182) | SQL |
| [packages/server/src/mcp.ts:1339](../../packages/server/src/mcp.ts#L1339) `createMcpServer/explain_value` | `Store.get` (1339); `Store.row` (1340) | MCP |
| [packages/server/src/mcp.ts:1362](../../packages/server/src/mcp.ts#L1362) `createMcpServer/check_record` | `Store.get` (1362); `Store.row` (1364) | MCP |
| [packages/server/src/mcp.ts:1386](../../packages/server/src/mcp.ts#L1386) `createMcpServer/explain_related` | `Store.get` (1386) | MCP |
| [packages/server/src/mcp.ts:2281](../../packages/server/src/mcp.ts#L2281) `registerResources/audit` | `Store.auditLog` (2281) | MCP |
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
| [packages/server/src/privilege-review.ts:162](../../packages/server/src/privilege-review.ts#L162) `reviewPrivileges` | `Store.previewRecordRule` (162) | DESIGN |
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
| [packages/server/src/security.ts:80](../../packages/server/src/security.ts#L80) `importApproximations` | `SQLite.all` (80); `SQLite.prepare` (80); `Store.sql` (80) | DESIGN |
| [packages/server/src/security.ts:116](../../packages/server/src/security.ts#L116) `securityOf` | `Store.pendingChanges` (116) | DESIGN |
| [packages/server/src/security.ts:212](../../packages/server/src/security.ts#L212) `SecurityApi/handle` | `Store.previewRecordRule` (212) | DESIGN |
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
| [packages/store/src/calc.ts:285](../../packages/store/src/calc.ts#L285) `Calculations/meta` | `SQLite.get` (285); `SQLite.prepare` (285); `Store.sql` (285) | CALC |
| [packages/store/src/calc.ts:290](../../packages/store/src/calc.ts#L290) `Calculations/saveMeta` | `SQLite.prepare` (290); `Store.sql` (290) | CALC |
| [packages/store/src/calc.ts:303](../../packages/store/src/calc.ts#L303) `Calculations/globalValue` | `SQLite.get` (303); `SQLite.prepare` (303); `Store.sql` (303) | CALC |
| [packages/store/src/calc.ts:327](../../packages/store/src/calc.ts#L327) `Calculations/setNextSerial` | `Store.sql` (327, 328, 333, 335, 335) | CALC |
| [packages/store/src/calc.ts:471](../../packages/store/src/calc.ts#L471) `Calculations/value` | `Calculations.globalValue` (471) | CALC |
| [packages/store/src/calc.ts:506](../../packages/store/src/calc.ts#L506) `Calculations/computed` | `Calculations.context` (506) | CALC |
| [packages/store/src/calc.ts:521](../../packages/store/src/calc.ts#L521) `Calculations/unstoredValue` | `Calculations.unstoredStyled` (521); `Calculations.value` (521) | CALC |
| [packages/store/src/calc.ts:559](../../packages/store/src/calc.ts#L559) `Calculations/allRecords` | `SQLite.iterate` (559); `SQLite.prepare` (559); `Store.sql` (559) | CALC |
| [packages/store/src/calc.ts:570](../../packages/store/src/calc.ts#L570) `Calculations/collect` | `Calculations.collector` (570) | CALC |
| [packages/store/src/calc.ts:577](../../packages/store/src/calc.ts#L577) `Calculations/summaryInput` | `Calculations.value` (577) | CALC |
| [packages/store/src/calc.ts:601](../../packages/store/src/calc.ts#L601) `Calculations/collector/add` | `Calculations.related` (601) | CALC |
| [packages/store/src/calc.ts:614](../../packages/store/src/calc.ts#L614) `Calculations/foundSummary` | `Calculations.collect` (614) | CALC |
| [packages/store/src/calc.ts:625](../../packages/store/src/calc.ts#L625) `Calculations/summary` | `Calculations.collect` (625) | CALC |
| [packages/store/src/calc.ts:632](../../packages/store/src/calc.ts#L632) `Calculations/tableSummary` | `Calculations.wholeTable` (632) | CALC |
| [packages/store/src/calc.ts:687](../../packages/store/src/calc.ts#L687) `Calculations/globalsKey` | `Calculations.globalValue` (687) | CALC |
| [packages/store/src/calc.ts:862](../../packages/store/src/calc.ts#L862) `Calculations/summaryDependencies` | `Store.sql` (862) | CALC |
| [packages/store/src/calc.ts:901](../../packages/store/src/calc.ts#L901) `Calculations/wholeTable` | `rowsById` (901); `Store.viewableIds` (901); `Calculations.collect` (903, 993); `Calculations.value` (964); `Store.sql` (972, 980) | CALC |
| [packages/store/src/calc.ts:1154](../../packages/store/src/calc.ts#L1154) `Calculations/applyDelta/value` | `Calculations.value` (1154) | CALC |
| [packages/store/src/calc.ts:1226](../../packages/store/src/calc.ts#L1226) `Calculations/storedRows` | `SQLite.iterate` (1226); `SQLite.prepare` (1226); `Store.sql` (1226) | CALC |
| [packages/store/src/calc.ts:1278](../../packages/store/src/calc.ts#L1278) `Calculations/relatedRecs` | `Calculations.relatedIds` (1278); `Store.viewableIds` (1283); `rowsById` (1289) | CALC |
| [packages/store/src/calc.ts:1300](../../packages/store/src/calc.ts#L1300) `Calculations/firstRelated` | `Calculations.related` (1300, 1312, 1327); `Store.viewableIds` (1307); `Calculations.relatedIds` (1310, 1323); `Calculations.statement` (1320); `SQLite.get` (1320) | CALC |
| [packages/store/src/calc.ts:1334](../../packages/store/src/calc.ts#L1334) `Calculations/rowById` | `Calculations.statement` (1334); `SQLite.get` (1334) | CALC |
| [packages/store/src/calc.ts:1345](../../packages/store/src/calc.ts#L1345) `Calculations/relatedIds` | `Calculations.related` (1345, 1375, 1389); `rowsById` (1359, 1386); `Calculations.statement` (1370); `SQLite.all` (1370) | CALC |
| [packages/store/src/calc.ts:1452](../../packages/store/src/calc.ts#L1452) `Calculations/joinHop` | `Calculations.statement` (1452, 1454); `SQLite.get` (1452); `SQLite.iterate` (1454) | CALC |
| [packages/store/src/calc.ts:1479](../../packages/store/src/calc.ts#L1479) `Calculations/storedRelatedValues` | `Calculations.statement` (1479); `SQLite.iterate` (1479) | CALC |
| [packages/store/src/calc.ts:1498](../../packages/store/src/calc.ts#L1498) `Calculations/passStamp` | `Store.sql` (1498) | CALC |
| [packages/store/src/calc.ts:1508](../../packages/store/src/calc.ts#L1508) `Calculations/lookup` | `Store.sql` (1508) | CALC |
| [packages/store/src/calc.ts:1547](../../packages/store/src/calc.ts#L1547) `Calculations/foundSums` | `Store.sql` (1547) | CALC |
| [packages/store/src/calc.ts:1610](../../packages/store/src/calc.ts#L1610) `Calculations/hopQuery` | `Calculations.value` (1610) | CALC |
| [packages/store/src/calc.ts:1643](../../packages/store/src/calc.ts#L1643) `Calculations/columnNames` | `SQLite.all` (1643); `SQLite.prepare` (1643); `Store.sql` (1643) | CALC |
| [packages/store/src/calc.ts:1654](../../packages/store/src/calc.ts#L1654) `Calculations/statement` | `SQLite.prepare` (1654); `Store.sql` (1654) | CALC |
| [packages/store/src/calc.ts:1668](../../packages/store/src/calc.ts#L1668) `Calculations/ensureIndex` | `Store.sql` (1668, 1669) | CALC |
| [packages/store/src/calc.ts:1694](../../packages/store/src/calc.ts#L1694) `Calculations/context/records` | `Calculations.firstRelated` (1694) | CALC |
| [packages/store/src/calc.ts:1712](../../packages/store/src/calc.ts#L1712) `Calculations/context/field` | `Calculations.summary` (1712); `Calculations.globalValue` (1715); `Calculations.value` (1716) | CALC |
| [packages/store/src/calc.ts:1725](../../packages/store/src/calc.ts#L1725) `Calculations/context/related` | `Calculations.globalValue` (1725); `Calculations.value` (1727, 1738); `Calculations.related` (1740) | CALC |
| [packages/store/src/calc.ts:1760](../../packages/store/src/calc.ts#L1760) `Calculations/context/lookupNext` | `Store.canViewRecord` (1760) | CALC |
| [packages/store/src/calc.ts:1775](../../packages/store/src/calc.ts#L1775) `Calculations/context/summary` | `Calculations.value` (1775, 1785); `Calculations.related` (1787); `Calculations.summary` (1805) | CALC |
| [packages/store/src/calc.ts:1835](../../packages/store/src/calc.ts#L1835) `Calculations/context/get` | `Store.recordCount` (1835, 1839); `Calculations.statement` (1838); `SQLite.get` (1838) | CALC |
| [packages/store/src/calc.ts:1858](../../packages/store/src/calc.ts#L1858) `Calculations/context/executeSQL` | `Calculations.executeSQL` (1858) | CALC |
| [packages/store/src/calc.ts:1859](../../packages/store/src/calc.ts#L1859) `Calculations/context/persistentData` | `Store.persistentData` (1859) | CALC |
| [packages/store/src/calc.ts:1860](../../packages/store/src/calc.ts#L1860) `Calculations/context/persistentDataIds` | `Store.persistentDataIds` (1860) | CALC |
| [packages/store/src/calc.ts:1885](../../packages/store/src/calc.ts#L1885) `Calculations/design` | `Store.valueListItems` (1885) | CALC |
| [packages/store/src/calc.ts:1902](../../packages/store/src/calc.ts#L1902) `Calculations/executeSQL` | `Calculations.translateSQL` (1902); `Store.select` (1940); `Store.sql` (1951) | CALC |
| [packages/store/src/calc.ts:2056](../../packages/store/src/calc.ts#L2056) `Calculations/translateSQL` | `Store.scopedTableSql` (2056, 2087) | CALC |
| [packages/store/src/calc.ts:2119](../../packages/store/src/calc.ts#L2119) `Calculations/shareColumn` | `Store.recordCount` (2119) | CALC |
| [packages/store/src/calc.ts:2151](../../packages/store/src/calc.ts#L2151) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2151) | CALC |
| [packages/store/src/calc.ts:2188](../../packages/store/src/calc.ts#L2188) `Calculations/computeColumn` | `Calculations.statement` (2188); `SQLite.get` (2188); `Calculations.value` (2191) | CALC |
| [packages/store/src/calc.ts:2325](../../packages/store/src/calc.ts#L2325) `Calculations/beforeWrite` | `relatedRows` (2325); `Calculations.related` (2379); `Calculations.context` (2392) | CORE |
| [packages/store/src/calc.ts:2443](../../packages/store/src/calc.ts#L2443) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2443); `Calculations.value` (2443) | CALC |
| [packages/store/src/calc.ts:2457](../../packages/store/src/calc.ts#L2457) `Calculations/computeStoredStyled` | `Calculations.context` (2457) | CORE |
| [packages/store/src/calc.ts:2497](../../packages/store/src/calc.ts#L2497) `Calculations/validate/fail` | `Calculations.context` (2497) | CALC |
| [packages/store/src/calc.ts:2511](../../packages/store/src/calc.ts#L2511) `Calculations/validate` | `Calculations.value` (2511); `Store.valueListItems` (2532); `Calculations.context` (2546) | CALC |
| [packages/store/src/calc.ts:2608](../../packages/store/src/calc.ts#L2608) `nearest` | `SQLite.get` (2608); `SQLite.prepare` (2608); `Store.sql` (2608) | CALC |
| [packages/store/src/calc.ts:2694](../../packages/store/src/calc.ts#L2694) `containerValue` | `Store.containerInfo` (2694); `Store.containerRange` (2701); `Store.container` (2702) | CALC |
| [packages/store/src/calc.ts:2710](../../packages/store/src/calc.ts#L2710) `containerValue/read` | `Store.container` (2710) | CALC |
| [packages/store/src/calc.ts:2723](../../packages/store/src/calc.ts#L2723) `containerValue/value` | `Store.containerRange` (2723) | CALC |
| [packages/store/src/calc.ts:2841](../../packages/store/src/calc.ts#L2841) `sameValuesElsewhere` | `SQLite.all` (2841); `SQLite.prepare` (2841, 2848, 2850); `Store.sql` (2841, 2848, 2850); `Calculations.value` (2843); `SQLite.get` (2848, 2850) | CALC |
| [packages/store/src/calc.ts:3154](../../packages/store/src/calc.ts#L3154) `rowsById/flush` | `Calculations.statement` (3154); `SQLite.iterate` (3154) | CALC |
| [packages/store/src/damage.ts:93](../../packages/store/src/damage.ts#L93) `watchDatabase` | `SQLite.prepare` (93); `SQLite.iterate` (103) | CORE |
| [packages/store/src/explain-related.ts:102](../../packages/store/src/explain-related.ts#L102) `explainRelated` | `Store.row` (102); `Store.get` (190); `Calculations.value` (239); `Calculations.context` (247) | RECORD |
| [packages/store/src/explain-related.ts:180](../../packages/store/src/explain-related.ts#L180) `explainRelated/runFilter` | `Calculations.context` (180) | RECORD |
| [packages/store/src/explain-related.ts:298](../../packages/store/src/explain-related.ts#L298) `explainHop` | `keyValue` (298); `SQLite.get` (318); `SQLite.prepare` (318, 332); `Store.sql` (318, 332); `SQLite.all` (332) | RECORD |
| [packages/store/src/explain-related.ts:361](../../packages/store/src/explain-related.ts#L361) `explainCandidate` | `SQLite.get` (361, 375); `SQLite.prepare` (361, 375); `Store.sql` (361, 375); `keyValue` (372); `Calculations.context` (380) | RECORD |
| [packages/store/src/explain.ts:100](../../packages/store/src/explain.ts#L100) `explainField` | `Calculations.value` (100); `Calculations.context` (126) | RECORD |
| [packages/store/src/explain.ts:331](../../packages/store/src/explain.ts#L331) `lintFormula` | `Calculations.context` (331) | RECORD |
| [packages/store/src/export-sql.ts:229](../../packages/store/src/export-sql.ts#L229) `exportSql` | `Store.scopedTableSql` (229); `Store.select` (230, 363); `Store.container` (429) | OPERATOR |
| [packages/store/src/export-sql.ts:255](../../packages/store/src/export-sql.ts#L255) `exportSql/page` | `Store.select` (255) | OPERATOR |
| [packages/store/src/export-sql.ts:305](../../packages/store/src/export-sql.ts#L305) `exportSql/duplicates` | `Store.select` (305) | OPERATOR |
| [packages/store/src/fidelity.ts:176](../../packages/store/src/fidelity.ts#L176) `changedAfter` | `Untyped.executeSQL` (176) | DESIGN |
| [packages/store/src/fidelity.ts:196](../../packages/store/src/fidelity.ts#L196) `queryProblem` | `Calculations.translateSQL` (196); `Store.describe` (197) | DESIGN |
| [packages/store/src/fidelity.ts:214](../../packages/store/src/fidelity.ts#L214) `calcFidelity` | `Calculations.executeSQL` (214, 215, 301); `Store.sql` (219, 227, 300); `SQLite.all` (227); `SQLite.prepare` (227); `Calculations.computeStored` (263) | DESIGN |
| [packages/store/src/fmexport.ts:226](../../packages/store/src/fmexport.ts#L226) `fmExport` | `Store.recordCount` (226); `Store.query` (227); `Store.containerInfo` (242); `Store.container` (249) | OPERATOR |
| [packages/store/src/import.ts:91](../../packages/store/src/import.ts#L91) `addExternalSizeColumn` | `SQLite.all` (91); `SQLite.prepare` (91) | OPERATOR |
| [packages/store/src/import.ts:103](../../packages/store/src/import.ts#L103) `writeDesign` | `SQLite.prepare` (103, 107) | OPERATOR |
| [packages/store/src/import.ts:121](../../packages/store/src/import.ts#L121) `importDesigns` | `SQLite.all` (121); `SQLite.prepare` (121, 135, 138, 141, 143); `SQLite.get` (135, 138) | OPERATOR |
| [packages/store/src/import.ts:161](../../packages/store/src/import.ts#L161) `applyFileAccountStatus` | `SQLite.get` (161, 163); `SQLite.prepare` (161, 163, 165, 177) | OPERATOR |
| [packages/store/src/import.ts:198](../../packages/store/src/import.ts#L198) `createStore` | `SQLite.prepare` (198, 209) | OPERATOR |
| [packages/store/src/import.ts:221](../../packages/store/src/import.ts#L221) `needsDesigns` | `SQLite.get` (221); `SQLite.prepare` (221) | OPERATOR |
| [packages/store/src/import.ts:268](../../packages/store/src/import.ts#L268) `readState` | `SQLite.get` (268); `SQLite.prepare` (268) | OPERATOR |
| [packages/store/src/import.ts:315](../../packages/store/src/import.ts#L315) `importFmp12/save` | `SQLite.prepare` (315) | OPERATOR |
| [packages/store/src/import.ts:324](../../packages/store/src/import.ts#L324) `importFmp12` | `SQLite.prepare` (324, 334, 340, 346, 350, 365, 376, 451, 452); `SQLite.get` (340, 365); `SQLite.all` (346) | OPERATOR |
| [packages/store/src/layout-speed.ts:56](../../packages/store/src/layout-speed.ts#L56) `layoutCost/recordCount` | `Store.recordCount` (56) | DESIGN |
| [packages/store/src/layout-speed.ts:419](../../packages/store/src/layout-speed.ts#L419) `speedContext` | `Store.recordCount` (419) | DESIGN |
| [packages/store/src/privileges.ts:514](../../packages/store/src/privileges.ts#L514) `privilegeSets` | `SQLite.all` (514); `SQLite.prepare` (514) | AUTH |
| [packages/store/src/privileges.ts:542](../../packages/store/src/privileges.ts#L542) `ensurePrivilegeTables` | `SQLite.all` (542); `SQLite.prepare` (542) | AUTH |
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
| [packages/store/src/store.ts:862](../../packages/store/src/store.ts#L862) `Store/metadataVersions` | `SQLite.get` (862); `SQLite.prepare` (862); `Store.sql` (862) | CORE |
| [packages/store/src/store.ts:971](../../packages/store/src/store.ts#L971) `Store/constructor` | `Store.sql` (971, 973, 975, 976, 980, 984, 985, 996, 1001, 1006, 1007, 1011, 1012, 1013, 1020, 1024, 1028, 1029, 1030, 1034, 1038, 1041, 1042, 1044, 1045, 1048, 1049, 1053, 1054, 1058, 1059, 1062, 1064, 1067, 1068, 1072, 1073, 1077, 1078, 1081, 1082, 1083, 1086, 1087, 1090, 1091, 1093, 1093, 1094, 1094, 1095, 1098, 1102, 1104, 1107, 1108, 1109, 1112, 1113, 1115, 1117, 1118, 1123, 1124, 1125, 1125, 1129, 1130); `SQLite.get` (975); `SQLite.prepare` (975, 1041, 1042, 1045, 1048, 1053, 1058, 1067, 1072, 1077, 1086, 1090, 1093, 1094, 1112, 1117); `SQLite.all` (1041, 1048, 1053, 1058, 1067, 1072, 1077, 1086, 1090, 1093, 1094, 1112, 1117) | CORE |
| [packages/store/src/store.ts:1149](../../packages/store/src/store.ts#L1149) `Store/grantFullAccessClients` | `SQLite.prepare` (1149); `Store.sql` (1149) | CORE |
| [packages/store/src/store.ts:1166](../../packages/store/src/store.ts#L1166) `Store/meta` | `SQLite.get` (1166); `SQLite.prepare` (1166); `Store.sql` (1166) | CORE |
| [packages/store/src/store.ts:1174](../../packages/store/src/store.ts#L1174) `Store/persistentTable` | `Store.sql` (1174) | CORE |
| [packages/store/src/store.ts:1184](../../packages/store/src/store.ts#L1184) `Store/persistentData` | `SQLite.get` (1184) | CORE |
| [packages/store/src/store.ts:1193](../../packages/store/src/store.ts#L1193) `Store/persistentDataIds` | `SQLite.all` (1193) | CORE |
| [packages/store/src/store.ts:1199](../../packages/store/src/store.ts#L1199) `Store/setPersistentData` | `SQLite.prepare` (1199, 1203); `Store.sql` (1199, 1203) | CORE |
| [packages/store/src/store.ts:1216](../../packages/store/src/store.ts#L1216) `Store/checkpoint` | `SQLite.get` (1216); `SQLite.prepare` (1216); `Store.sql` (1216) | CORE |
| [packages/store/src/store.ts:1224](../../packages/store/src/store.ts#L1224) `Store/recordedFormat` | `Store.sql` (1224) | CORE |
| [packages/store/src/store.ts:1234](../../packages/store/src/store.ts#L1234) `Store/close` | `Store.sql` (1234) | CORE |
| [packages/store/src/store.ts:1250](../../packages/store/src/store.ts#L1250) `Store/shipWal` | `Store.sql` (1250) | CORE |
| [packages/store/src/store.ts:1261](../../packages/store/src/store.ts#L1261) `Store/trial` | `Store.sql` (1261) | CORE |
| [packages/store/src/store.ts:1266](../../packages/store/src/store.ts#L1266) `Store/trial/undo` | `Store.sql` (1266) | CORE |
| [packages/store/src/store.ts:1301](../../packages/store/src/store.ts#L1301) `Store/joinTransaction` | `Store.sql` (1301, 1302, 1304, 1306, 1312) | CORE |
| [packages/store/src/store.ts:1324](../../packages/store/src/store.ts#L1324) `Store/independentWindowWrite` | `SQLite.get` (1324); `SQLite.prepare` (1324, 1347); `Store.sql` (1324, 1327, 1342, 1347, 1350) | CORE |
| [packages/store/src/store.ts:1372](../../packages/store/src/store.ts#L1372) `Store/withWriteTransaction` | `Store.sql` (1372, 1375, 1379, 1381, 1381) | CORE |
| [packages/store/src/store.ts:1411](../../packages/store/src/store.ts#L1411) `Store/endTransaction` | `Store.sql` (1411, 1414, 1414) | CORE |
| [packages/store/src/store.ts:1438](../../packages/store/src/store.ts#L1438) `Store/backup` | `Store.sql` (1438) | CORE |
| [packages/store/src/store.ts:1461](../../packages/store/src/store.ts#L1461) `Store/dataVersion` | `SQLite.get` (1461); `SQLite.prepare` (1461); `Store.sql` (1461) | CORE |
| [packages/store/src/store.ts:1501](../../packages/store/src/store.ts#L1501) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1501) | CORE |
| [packages/store/src/store.ts:1522](../../packages/store/src/store.ts#L1522) `Store/shareResults` | `Store.sql` (1522) | CORE |
| [packages/store/src/store.ts:1532](../../packages/store/src/store.ts#L1532) `Store/versionTriggers` | `SQLite.get` (1532); `SQLite.prepare` (1532, 1537, 1538); `Store.sql` (1532, 1534, 1535, 1537, 1538, 1547, 1548); `SQLite.all` (1537, 1538) | CORE |
| [packages/store/src/store.ts:1564](../../packages/store/src/store.ts#L1564) `Store/versionNumber` | `SQLite.get` (1564); `SQLite.prepare` (1564); `Store.sql` (1564) | CORE |
| [packages/store/src/store.ts:1577](../../packages/store/src/store.ts#L1577) `Store/changeOne` | `Store.sql` (1577, 1579) | CORE |
| [packages/store/src/store.ts:1580](../../packages/store/src/store.ts#L1580) `Store/changeOne/read` | `SQLite.get` (1580); `SQLite.prepare` (1580); `Store.sql` (1580) | CORE |
| [packages/store/src/store.ts:1619](../../packages/store/src/store.ts#L1619) `Store/writeToken` | `SQLite.get` (1619); `SQLite.prepare` (1619); `Store.sql` (1619) | CORE |
| [packages/store/src/store.ts:1631](../../packages/store/src/store.ts#L1631) `Store/recordCount` | `SQLite.get` (1631); `SQLite.prepare` (1631); `Store.sql` (1631) | CORE |
| [packages/store/src/store.ts:1739](../../packages/store/src/store.ts#L1739) `Store/applyDesign` | `Store.sql` (1739, 1740, 1751, 1754, 1759, 1771, 1774, 1774); `SQLite.prepare` (1754, 1759) | CORE |
| [packages/store/src/store.ts:1832](../../packages/store/src/store.ts#L1832) `Store/auditLog` | `SQLite.all` (1832); `SQLite.prepare` (1832); `Store.sql` (1832) | CORE |
| [packages/store/src/store.ts:1872](../../packages/store/src/store.ts#L1872) `Store/securityEvents` | `Store.auditLog` (1872) | CORE |
| [packages/store/src/store.ts:1898](../../packages/store/src/store.ts#L1898) `Store/prepared` | `SQLite.prepare` (1898); `Store.sql` (1898) | CORE |
| [packages/store/src/store.ts:1913](../../packages/store/src/store.ts#L1913) `Store/recordAsOf` | `SQLite.get` (1913, 1915); `SQLite.prepare` (1913, 1915, 1917, 1918); `Store.sql` (1913, 1915, 1917, 1918); `SQLite.all` (1917, 1918) | CORE |
| [packages/store/src/store.ts:1943](../../packages/store/src/store.ts#L1943) `Store/restoreRecord` | `Store.recordAsOf` (1943); `SQLite.get` (1947); `SQLite.prepare` (1947, 1950, 1957, 1964); `Store.sql` (1947, 1950, 1957, 1964) | CORE |
| [packages/store/src/store.ts:1978](../../packages/store/src/store.ts#L1978) `Store/revertAuditEntry` | `Store.auditLog` (1978) | CORE |
| [packages/store/src/store.ts:2071](../../packages/store/src/store.ts#L2071) `Store/setAuditSettings` | `SQLite.prepare` (2071); `Store.sql` (2071) | CORE |
| [packages/store/src/store.ts:2093](../../packages/store/src/store.ts#L2093) `Store/pruneAudit` | `Store.sql` (2093, 2095, 2097); `SQLite.get` (2095); `SQLite.prepare` (2095) | CORE |
| [packages/store/src/store.ts:2175](../../packages/store/src/store.ts#L2175) `Store/audit` | `Store.sql` (2175) | CORE |
| [packages/store/src/store.ts:2264](../../packages/store/src/store.ts#L2264) `Store/securityChange` | `Store.sql` (2264, 2266); `SQLite.prepare` (2266) | CORE |
| [packages/store/src/store.ts:2313](../../packages/store/src/store.ts#L2313) `Store/logSecurity` | `Store.sql` (2313) | CORE |
| [packages/store/src/store.ts:2336](../../packages/store/src/store.ts#L2336) `Store/ensureDeleted` | `Store.sql` (2336) | CORE |
| [packages/store/src/store.ts:2341](../../packages/store/src/store.ts#L2341) `Store/deletedRows` | `SQLite.get` (2341); `SQLite.prepare` (2341, 2343, 2343); `Store.sql` (2341, 2343, 2343); `SQLite.all` (2343, 2343) | CORE |
| [packages/store/src/store.ts:2367](../../packages/store/src/store.ts#L2367) `Store/emptyDeleted` | `Store.sql` (2367, 2370, 2371, 2373, 2375); `SQLite.prepare` (2371) | CORE |
| [packages/store/src/store.ts:2382](../../packages/store/src/store.ts#L2382) `Store/designHistory` | `SQLite.all` (2382); `SQLite.prepare` (2382); `Store.sql` (2382) | CORE |
| [packages/store/src/store.ts:2389](../../packages/store/src/store.ts#L2389) `Store/scriptHistory` | `SQLite.all` (2389); `SQLite.prepare` (2389); `Store.sql` (2389) | CORE |
| [packages/store/src/store.ts:2399](../../packages/store/src/store.ts#L2399) `Store/layoutHistory` | `SQLite.all` (2399); `SQLite.prepare` (2399); `Store.sql` (2399) | CORE |
| [packages/store/src/store.ts:2424](../../packages/store/src/store.ts#L2424) `Store/designEffect/renameKey` | `SQLite.prepare` (2424); `Store.sql` (2424) | CORE |
| [packages/store/src/store.ts:2440](../../packages/store/src/store.ts#L2440) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2440); `Store.sql` (2440) | CORE |
| [packages/store/src/store.ts:2447](../../packages/store/src/store.ts#L2447) `Store/designEffect` | `Store.sql` (2447, 2451, 2456, 2461, 2464, 2470, 2478, 2479, 2481, 2493, 2494, 2497, 2499, 2505, 2506, 2507, 2512, 2514, 2518, 2521, 2522, 2524, 2527, 2532, 2534, 2541, 2542, 2544, 2545, 2546, 2547, 2554, 2555, 2557, 2557, 2559, 2560, 2561, 2565, 2569, 2571, 2609, 2611, 2613); `SQLite.get` (2478, 2493, 2505, 2506, 2518, 2522, 2557, 2565); `SQLite.prepare` (2478, 2479, 2493, 2494, 2505, 2506, 2512, 2514, 2518, 2522, 2532, 2534, 2547, 2554, 2555, 2557, 2559, 2561, 2565, 2569); `SQLite.all` (2554, 2555); `SQLite.iterate` (2559) | CORE |
| [packages/store/src/store.ts:2621](../../packages/store/src/store.ts#L2621) `Store/dropColumnIndexes` | `SQLite.all` (2621, 2623); `SQLite.prepare` (2621, 2623); `Store.sql` (2621, 2623, 2624) | CORE |
| [packages/store/src/store.ts:2633](../../packages/store/src/store.ts#L2633) `Store/recompute` | `SQLite.prepare` (2633, 2637); `Store.sql` (2633, 2637); `SQLite.iterate` (2637); `Calculations.computeStoredStyled` (2638); `Calculations.value` (2638) | CORE |
| [packages/store/src/store.ts:2653](../../packages/store/src/store.ts#L2653) `Store/linkPrincipal` | `SQLite.get` (2653); `SQLite.prepare` (2653); `Store.sql` (2653) | CORE |
| [packages/store/src/store.ts:2660](../../packages/store/src/store.ts#L2660) `Store/linkIdentity` | `SQLite.get` (2660); `SQLite.prepare` (2660); `Store.sql` (2660) | CORE |
| [packages/store/src/store.ts:2666](../../packages/store/src/store.ts#L2666) `Store/accountsSharingLockout` | `SQLite.all` (2666); `SQLite.prepare` (2666); `Store.sql` (2666) | CORE |
| [packages/store/src/store.ts:2670](../../packages/store/src/store.ts#L2670) `Store/accounts` | `SQLite.all` (2670); `SQLite.prepare` (2670); `Store.sql` (2670) | CORE |
| [packages/store/src/store.ts:2682](../../packages/store/src/store.ts#L2682) `Store/isAgent` | `SQLite.get` (2682); `SQLite.prepare` (2682); `Store.sql` (2682) | CORE |
| [packages/store/src/store.ts:2688](../../packages/store/src/store.ts#L2688) `Store/agentNeedsApproval` | `SQLite.get` (2688); `SQLite.prepare` (2688); `Store.sql` (2688) | CORE |
| [packages/store/src/store.ts:2694](../../packages/store/src/store.ts#L2694) `Store/blankPasswordAccounts` | `SQLite.all` (2694); `SQLite.prepare` (2694); `Store.sql` (2694) | CORE |
| [packages/store/src/store.ts:1157](../../packages/store/src/store.ts#L1157) `Store/hasOwnPassword` | `SQLite.get` (1157); `SQLite.prepare` (1157); `Store.sql` (1157) | CORE |
| [packages/store/src/store.ts:2705](../../packages/store/src/store.ts#L2705) `Store/unmigratedAccounts` | `SQLite.all` (2705); `SQLite.prepare` (2705); `Store.sql` (2705) | CORE |
| [packages/store/src/store.ts:2758](../../packages/store/src/store.ts#L2758) `Store/setExternalAccount` | `SQLite.get` (2758); `SQLite.prepare` (2758, 2763); `Store.sql` (2758, 2763) | CORE |
| [packages/store/src/store.ts:2776](../../packages/store/src/store.ts#L2776) `Store/refuseLookalikeAccount` | `SQLite.all` (2776); `SQLite.prepare` (2776); `Store.sql` (2776) | CORE |
| [packages/store/src/store.ts:2785](../../packages/store/src/store.ts#L2785) `Store/isExternal` | `SQLite.get` (2785); `SQLite.prepare` (2785); `Store.sql` (2785) | CORE |
| [packages/store/src/store.ts:2806](../../packages/store/src/store.ts#L2806) `Store/setAgentAccount` | `SQLite.get` (2806); `SQLite.prepare` (2806, 2812); `Store.sql` (2806, 2812) | CORE |
| [packages/store/src/store.ts:2846](../../packages/store/src/store.ts#L2846) `Store/gateAgentWrite` | `SQLite.prepare` (2846); `Store.sql` (2846) | CORE |
| [packages/store/src/store.ts:2868](../../packages/store/src/store.ts#L2868) `Store/pendingChanges` | `SQLite.all` (2868); `SQLite.prepare` (2868); `Store.sql` (2868) | CORE |
| [packages/store/src/store.ts:2882](../../packages/store/src/store.ts#L2882) `Store/approvePending` | `SQLite.get` (2882); `SQLite.prepare` (2882, 2893); `Store.sql` (2882, 2893) | CORE |
| [packages/store/src/store.ts:2903](../../packages/store/src/store.ts#L2903) `Store/rejectPending` | `SQLite.get` (2903); `SQLite.prepare` (2903, 2905); `Store.sql` (2903, 2905) | CORE |
| [packages/store/src/store.ts:2925](../../packages/store/src/store.ts#L2925) `Store/externalAccount` | `SQLite.all` (2925); `SQLite.prepare` (2925); `Store.sql` (2925) | CORE |
| [packages/store/src/store.ts:2956](../../packages/store/src/store.ts#L2956) `Store/setPassword` | `SQLite.get` (2956); `SQLite.prepare` (2956, 2958, 2967); `Store.sql` (2956, 2958, 2967) | AUTH |
| [packages/store/src/store.ts:2981](../../packages/store/src/store.ts#L2981) `Store/createAccount` | `SQLite.get` (2981); `SQLite.prepare` (2981, 2985, 2991, 2996, 3001); `Store.sql` (2981, 2985, 2991, 2996, 3001) | CORE |
| [packages/store/src/store.ts:3009](../../packages/store/src/store.ts#L3009) `Store/appendSecurityEvent` | `Store.sql` (3009) | CORE |
| [packages/store/src/store.ts:3051](../../packages/store/src/store.ts#L3051) `Store/setPasswordPolicy` | `SQLite.prepare` (3051); `Store.sql` (3051) | CORE |
| [packages/store/src/store.ts:3087](../../packages/store/src/store.ts#L3087) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3087); `Store.sql` (3087) | CORE |
| [packages/store/src/store.ts:3110](../../packages/store/src/store.ts#L3110) `Store/saveScriptTest` | `SQLite.prepare` (3110); `Store.sql` (3110) | CORE |
| [packages/store/src/store.ts:3119](../../packages/store/src/store.ts#L3119) `Store/deleteScriptTest` | `SQLite.prepare` (3119); `Store.sql` (3119) | CORE |
| [packages/store/src/store.ts:3154](../../packages/store/src/store.ts#L3154) `Store/setAiAllowed` | `SQLite.prepare` (3154); `Store.sql` (3154) | CORE |
| [packages/store/src/store.ts:3165](../../packages/store/src/store.ts#L3165) `Store/setAiPolicy` | `SQLite.prepare` (3165); `Store.sql` (3165) | CORE |
| [packages/store/src/store.ts:3185](../../packages/store/src/store.ts#L3185) `Store/setPiiIsolation` | `SQLite.prepare` (3185); `Store.sql` (3185) | CORE |
| [packages/store/src/store.ts:3207](../../packages/store/src/store.ts#L3207) `Store/markPiiField` | `SQLite.prepare` (3207); `Store.sql` (3207) | CORE |
| [packages/store/src/store.ts:3321](../../packages/store/src/store.ts#L3321) `Store/lastSignIns` | `Store.auditLog` (3321) | CORE |
| [packages/store/src/store.ts:3524](../../packages/store/src/store.ts#L3524) `Store/unusualAccess` | `Store.auditLog` (3524, 3590) | CORE |
| [packages/store/src/store.ts:3621](../../packages/store/src/store.ts#L3621) `Store/leastPrivilege` | `SQLite.all` (3621); `SQLite.prepare` (3621); `Store.sql` (3621) | CORE |
| [packages/store/src/store.ts:3694](../../packages/store/src/store.ts#L3694) `Store/unusedAccess` | `SQLite.get` (3694); `SQLite.prepare` (3694, 3703); `Store.sql` (3694, 3703); `SQLite.all` (3703) | CORE |
| [packages/store/src/store.ts:3742](../../packages/store/src/store.ts#L3742) `Store/unusedObjects` | `SQLite.get` (3742); `SQLite.prepare` (3742, 3745); `Store.sql` (3742, 3745); `SQLite.all` (3745) | CORE |
| [packages/store/src/store.ts:3780](../../packages/store/src/store.ts#L3780) `Store/usageCounting` | `SQLite.get` (3780); `SQLite.prepare` (3780); `Store.sql` (3780) | CORE |
| [packages/store/src/store.ts:3788](../../packages/store/src/store.ts#L3788) `Store/setMustChangePassword` | `SQLite.prepare` (3788); `Store.sql` (3788) | CORE |
| [packages/store/src/store.ts:3802](../../packages/store/src/store.ts#L3802) `Store/mustChangePassword` | `SQLite.get` (3802); `SQLite.prepare` (3802); `Store.sql` (3802) | CORE |
| [packages/store/src/store.ts:3841](../../packages/store/src/store.ts#L3841) `Store/passwordDaysRemaining` | `SQLite.get` (3841); `SQLite.prepare` (3841); `Store.sql` (3841) | CORE |
| [packages/store/src/store.ts:3848](../../packages/store/src/store.ts#L3848) `Store/importAccounts` | `SQLite.all` (3848); `SQLite.prepare` (3848); `Store.sql` (3848) | CORE |
| [packages/store/src/store.ts:3871](../../packages/store/src/store.ts#L3871) `Store/canonicalAccount` | `SQLite.all` (3871); `SQLite.prepare` (3871); `Store.sql` (3871) | CORE |
| [packages/store/src/store.ts:3883](../../packages/store/src/store.ts#L3883) `Store/createLocalAccount` | `SQLite.prepare` (3883); `Store.sql` (3883) | CORE |
| [packages/store/src/store.ts:3913](../../packages/store/src/store.ts#L3913) `Store/previewAccountImport` | `Store.sql` (3913, 3914, 3923) | CORE |
| [packages/store/src/store.ts:3931](../../packages/store/src/store.ts#L3931) `Store/limitAccountImport` | `SQLite.prepare` (3931, 3932, 3935); `Store.sql` (3931, 3932, 3935); `SQLite.get` (3932) | CORE |
| [packages/store/src/store.ts:3942](../../packages/store/src/store.ts#L3942) `Store/applyAccountImport` | `Store.sql` (3942, 3950, 3979); `SQLite.get` (3950); `SQLite.prepare` (3950, 3979) | CORE |
| [packages/store/src/store.ts:4004](../../packages/store/src/store.ts#L4004) `Store/forgetStandIns` | `SQLite.prepare` (4004); `Store.sql` (4004) | CORE |
| [packages/store/src/store.ts:4037](../../packages/store/src/store.ts#L4037) `Store/deleteAccount` | `SQLite.prepare` (4037, 4038, 4039, 4041, 4045); `Store.sql` (4037, 4038, 4039, 4041, 4045) | CORE |
| [packages/store/src/store.ts:4062](../../packages/store/src/store.ts#L4062) `Store/setAccountActive` | `SQLite.prepare` (4062, 4065, 4066); `Store.sql` (4062, 4065, 4066) | AUTH |
| [packages/store/src/store.ts:4076](../../packages/store/src/store.ts#L4076) `Store/accountInactive` | `SQLite.get` (4076); `SQLite.prepare` (4076); `Store.sql` (4076) | CORE |
| [packages/store/src/store.ts:4081](../../packages/store/src/store.ts#L4081) `Store/identityAllowed` | `SQLite.get` (4081, 4087, 4093); `SQLite.prepare` (4081, 4087, 4093); `Store.sql` (4081, 4087, 4093) | CORE |
| [packages/store/src/store.ts:4101](../../packages/store/src/store.ts#L4101) `Store/externalIdentityId` | `SQLite.get` (4101, 4107); `SQLite.prepare` (4101, 4106, 4107); `Store.sql` (4101, 4106, 4107) | CORE |
| [packages/store/src/store.ts:4112](../../packages/store/src/store.ts#L4112) `Store/accountIdentityId` | `SQLite.get` (4112, 4117); `SQLite.prepare` (4112, 4116, 4117); `Store.sql` (4112, 4116, 4117) | CORE |
| [packages/store/src/store.ts:4140](../../packages/store/src/store.ts#L4140) `Store/signInMark` | `SQLite.prepare` (4140); `Store.sql` (4140) | AUTH |
| [packages/store/src/store.ts:4150](../../packages/store/src/store.ts#L4150) `Store/signInBase` | `SQLite.get` (4150); `SQLite.prepare` (4150); `Store.sql` (4150) | AUTH |
| [packages/store/src/store.ts:4152](../../packages/store/src/store.ts#L4152) `Store/signInBase/identity` | `SQLite.get` (4152); `SQLite.prepare` (4152); `Store.sql` (4152) | AUTH |
| [packages/store/src/store.ts:4164](../../packages/store/src/store.ts#L4164) `Store/ledgerRow` | `SQLite.get` (4164, 4165); `SQLite.prepare` (4164, 4165); `Store.sql` (4164, 4165) | AUTH |
| [packages/store/src/store.ts:4176](../../packages/store/src/store.ts#L4176) `Store/ledgerWrite` | `Store.sql` (4176, 4177, 4179, 4181, 4184, 4184) | AUTH |
| [packages/store/src/store.ts:4203](../../packages/store/src/store.ts#L4203) `Store/settleSignIns` | `SQLite.all` (4203, 4209); `SQLite.prepare` (4203, 4209, 4215, 4219, 4221); `Store.sql` (4203, 4209, 4215, 4219, 4221) | AUTH |
| [packages/store/src/store.ts:4232](../../packages/store/src/store.ts#L4232) `Store/securityToken` | `SQLite.get` (4232); `SQLite.prepare` (4232); `Store.sql` (4232) | CORE |
| [packages/store/src/store.ts:4240](../../packages/store/src/store.ts#L4240) `Store/accountLocalOnly` | `SQLite.get` (4240); `SQLite.prepare` (4240); `Store.sql` (4240) | CORE |
| [packages/store/src/store.ts:4245](../../packages/store/src/store.ts#L4245) `Store/accountRequires2fa` | `SQLite.get` (4245); `SQLite.prepare` (4245); `Store.sql` (4245) | CORE |
| [packages/store/src/store.ts:4251](../../packages/store/src/store.ts#L4251) `Store/setAccountLocalOnly` | `SQLite.prepare` (4251); `Store.sql` (4251) | CORE |
| [packages/store/src/store.ts:4260](../../packages/store/src/store.ts#L4260) `Store/setAccountRequire2fa` | `SQLite.prepare` (4260); `Store.sql` (4260) | CORE |
| [packages/store/src/store.ts:4288](../../packages/store/src/store.ts#L4288) `Store/createApiToken` | `SQLite.get` (4288); `SQLite.prepare` (4288, 4316); `Store.sql` (4288, 4316) | CORE |
| [packages/store/src/store.ts:4363](../../packages/store/src/store.ts#L4363) `Store/recordObjectUse` | `Store.sql` (4363) | CORE |
| [packages/store/src/store.ts:4393](../../packages/store/src/store.ts#L4393) `Store/writeUsage` | `Store.sql` (4393, 4394, 4396, 4400, 4402) | CORE |
| [packages/store/src/store.ts:4409](../../packages/store/src/store.ts#L4409) `Store/writeUsageRows` | `SQLite.prepare` (4409, 4410, 4416); `Store.sql` (4409, 4410, 4416) | CORE |
| [packages/store/src/store.ts:4421](../../packages/store/src/store.ts#L4421) `Store/writeObjectUseRows` | `SQLite.prepare` (4421, 4422, 4427); `Store.sql` (4421, 4422, 4427) | CORE |
| [packages/store/src/store.ts:4432](../../packages/store/src/store.ts#L4432) `Store/objectUseSince` | `SQLite.get` (4432); `SQLite.prepare` (4432); `Store.sql` (4432) | CORE |
| [packages/store/src/store.ts:4445](../../packages/store/src/store.ts#L4445) `Store/accountUsage` | `SQLite.get` (4445); `SQLite.prepare` (4445, 4446); `Store.sql` (4445, 4446); `SQLite.all` (4446); `Store.auditLog` (4462) | CORE |
| [packages/store/src/store.ts:4478](../../packages/store/src/store.ts#L4478) `Store/apiTokens` | `SQLite.all` (4478); `SQLite.prepare` (4478); `Store.sql` (4478) | CORE |
| [packages/store/src/store.ts:4488](../../packages/store/src/store.ts#L4488) `Store/revokeApiToken` | `SQLite.prepare` (4488); `Store.sql` (4488) | CORE |
| [packages/store/src/store.ts:4502](../../packages/store/src/store.ts#L4502) `Store/apiToken` | `SQLite.get` (4502); `SQLite.prepare` (4502, 4514); `Store.sql` (4502, 4514) | CORE |
| [packages/store/src/store.ts:4530](../../packages/store/src/store.ts#L4530) `Store/enrollTotp` | `SQLite.prepare` (4530); `Store.sql` (4530) | CORE |
| [packages/store/src/store.ts:4541](../../packages/store/src/store.ts#L4541) `Store/confirmTotp` | `SQLite.get` (4541); `SQLite.prepare` (4541, 4543); `Store.sql` (4541, 4543) | CORE |
| [packages/store/src/store.ts:4551](../../packages/store/src/store.ts#L4551) `Store/hasTotp` | `SQLite.get` (4551); `SQLite.prepare` (4551); `Store.sql` (4551) | CORE |
| [packages/store/src/store.ts:4556](../../packages/store/src/store.ts#L4556) `Store/totpAccounts` | `SQLite.all` (4556); `SQLite.prepare` (4556); `Store.sql` (4556) | CORE |
| [packages/store/src/store.ts:4562](../../packages/store/src/store.ts#L4562) `Store/disableTotp` | `SQLite.prepare` (4562); `Store.sql` (4562) | CORE |
| [packages/store/src/store.ts:4585](../../packages/store/src/store.ts#L4585) `Store/verifyTotp` | `SQLite.get` (4585); `SQLite.prepare` (4585, 4591); `Store.sql` (4585, 4591) | CORE |
| [packages/store/src/store.ts:4604](../../packages/store/src/store.ts#L4604) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4604, 4606, 4607, 4609); `Store.sql` (4604, 4606, 4607, 4609); `SQLite.get` (4606) | CORE |
| [packages/store/src/store.ts:4656](../../packages/store/src/store.ts#L4656) `Store/passkeyAllowList` | `SQLite.all` (4656); `SQLite.prepare` (4656); `Store.sql` (4656) | CORE |
| [packages/store/src/store.ts:4670](../../packages/store/src/store.ts#L4670) `Store/takeWebauthnChallenge` | `SQLite.get` (4670); `SQLite.prepare` (4670, 4672); `Store.sql` (4670, 4672) | CORE |
| [packages/store/src/store.ts:4680](../../packages/store/src/store.ts#L4680) `Store/passkeys` | `SQLite.all` (4680); `SQLite.prepare` (4680); `Store.sql` (4680) | CORE |
| [packages/store/src/store.ts:4687](../../packages/store/src/store.ts#L4687) `Store/hasPasskey` | `SQLite.get` (4687); `SQLite.prepare` (4687); `Store.sql` (4687) | CORE |
| [packages/store/src/store.ts:4692](../../packages/store/src/store.ts#L4692) `Store/passkeyIds` | `SQLite.all` (4692); `SQLite.prepare` (4692); `Store.sql` (4692) | CORE |
| [packages/store/src/store.ts:4714](../../packages/store/src/store.ts#L4714) `Store/registerPasskey` | `SQLite.prepare` (4714); `Store.sql` (4714) | CORE |
| [packages/store/src/store.ts:4725](../../packages/store/src/store.ts#L4725) `Store/removePasskey` | `SQLite.get` (4725); `SQLite.prepare` (4725, 4726); `Store.sql` (4725, 4726) | CORE |
| [packages/store/src/store.ts:4742](../../packages/store/src/store.ts#L4742) `Store/verifyPasskeyAssertion` | `SQLite.get` (4742); `SQLite.prepare` (4742, 4753); `Store.sql` (4742, 4753) | CORE |
| [packages/store/src/store.ts:4789](../../packages/store/src/store.ts#L4789) `Store/generateRecoveryCodes` | `SQLite.prepare` (4789, 4792); `Store.sql` (4789, 4792) | CORE |
| [packages/store/src/store.ts:4807](../../packages/store/src/store.ts#L4807) `Store/recoveryCodesRemaining` | `SQLite.get` (4807); `SQLite.prepare` (4807); `Store.sql` (4807) | CORE |
| [packages/store/src/store.ts:4817](../../packages/store/src/store.ts#L4817) `Store/useRecoveryCode` | `SQLite.get` (4817); `SQLite.prepare` (4817, 4819); `Store.sql` (4817, 4819) | CORE |
| [packages/store/src/store.ts:4830](../../packages/store/src/store.ts#L4830) `Store/privilegeSets` | `Store.sql` (4830) | CORE |
| [packages/store/src/store.ts:4859](../../packages/store/src/store.ts#L4859) `Store/savePrivilegeSet` | `SQLite.prepare` (4859, 4867); `Store.sql` (4859, 4867) | AUTH |
| [packages/store/src/store.ts:4902](../../packages/store/src/store.ts#L4902) `Store/deletePrivilegeSet` | `SQLite.prepare` (4902); `Store.sql` (4902) | CORE |
| [packages/store/src/store.ts:4971](../../packages/store/src/store.ts#L4971) `Store/accountPrivilegeSet` | `SQLite.get` (4971); `SQLite.prepare` (4971); `Store.sql` (4971) | CORE |
| [packages/store/src/store.ts:4985](../../packages/store/src/store.ts#L4985) `Store/setAccountPrivilegeSet` | `SQLite.get` (4985); `SQLite.prepare` (4985, 4988, 4992); `Store.sql` (4985, 4988, 4992) | AUTH |
| [packages/store/src/store.ts:5007](../../packages/store/src/store.ts#L5007) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5007); `Store.sql` (5007) | CORE |
| [packages/store/src/store.ts:5021](../../packages/store/src/store.ts#L5021) `Store/addProvisionedAccount` | `SQLite.get` (5021); `SQLite.prepare` (5021, 5025); `Store.sql` (5021, 5025) | CORE |
| [packages/store/src/store.ts:5186](../../packages/store/src/store.ts#L5186) `Store/ruleOutcome` | `Calculations.context` (5186) | CORE |
| [packages/store/src/store.ts:5227](../../packages/store/src/store.ts#L5227) `Store/allowedIds` | `SQLite.iterate` (5227); `SQLite.prepare` (5227); `Store.sql` (5227) | CORE |
| [packages/store/src/store.ts:5297](../../packages/store/src/store.ts#L5297) `Store/scopedTableSql` | `Store.viewableIds` (5297); `SQLite.all` (5300); `SQLite.prepare` (5300); `Store.sql` (5300) | GATED-STORE |
| [packages/store/src/store.ts:5332](../../packages/store/src/store.ts#L5332) `Store/previewRecordRuleCurrent` | `SQLite.get` (5332); `SQLite.prepare` (5332, 5335); `Store.sql` (5332, 5335); `SQLite.all` (5335); `Calculations.context` (5341, 5357) | CORE |
| [packages/store/src/store.ts:5509](../../packages/store/src/store.ts#L5509) `Store/passwordHash` | `SQLite.get` (5509); `SQLite.prepare` (5509); `Store.sql` (5509) | CORE |
| [packages/store/src/store.ts:5538](../../packages/store/src/store.ts#L5538) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5538); `Store.sql` (5538) | CORE |
| [packages/store/src/store.ts:5551](../../packages/store/src/store.ts#L5551) `Store/knownSharedAccount` | `SQLite.get` (5551); `SQLite.prepare` (5551); `Store.sql` (5551) | CORE |
| [packages/store/src/store.ts:5609](../../packages/store/src/store.ts#L5609) `Store/layouts` | `SQLite.all` (5609); `SQLite.prepare` (5609); `Store.sql` (5609) | CORE |
| [packages/store/src/store.ts:5630](../../packages/store/src/store.ts#L5630) `Store/image` | `SQLite.get` (5630); `SQLite.prepare` (5630); `Store.sql` (5630) | CORE |
| [packages/store/src/store.ts:5640](../../packages/store/src/store.ts#L5640) `Store/images` | `SQLite.all` (5640); `SQLite.prepare` (5640); `Store.sql` (5640) | CORE |
| [packages/store/src/store.ts:5653](../../packages/store/src/store.ts#L5653) `Store/addImage` | `Store.sql` (5653, 5654); `SQLite.prepare` (5654) | CORE |
| [packages/store/src/store.ts:5670](../../packages/store/src/store.ts#L5670) `Store/layout` | `SQLite.get` (5670); `SQLite.prepare` (5670); `Store.sql` (5670) | CORE |
| [packages/store/src/store.ts:5874](../../packages/store/src/store.ts#L5874) `Store/wordIndex` | `Store.sql` (5874, 5882, 5887); `Store.recordCount` (5886); `SQLite.get` (5887); `SQLite.prepare` (5887) | CORE |
| [packages/store/src/store.ts:5939](../../packages/store/src/store.ts#L5939) `Store/toRecord` | `Calculations.value` (5939, 5949); `Calculations.globalValue` (5943); `Calculations.unstoredStyled` (5948) | CORE |
| [packages/store/src/store.ts:5998](../../packages/store/src/store.ts#L5998) `Store/relatedValues` | `Calculations.globalValue` (5998); `Calculations.unstoredValue` (6000) | CORE |
| [packages/store/src/store.ts:6072](../../packages/store/src/store.ts#L6072) `Store/addRelated` | `relatedRows` (6072); `rowsById` (6104); `firstRelatedEach` (6126) | CORE |
| [packages/store/src/store.ts:6154](../../packages/store/src/store.ts#L6154) `Store/foundSetPage` | `rowsById` (6154) | CORE |
| [packages/store/src/store.ts:6170](../../packages/store/src/store.ts#L6170) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6170); `Store.row` (6186) | GATED-STORE |
| [packages/store/src/store.ts:6209](../../packages/store/src/store.ts#L6209) `Store/portalCountsCurrent` | `Store.canView` (6209); `Store.row` (6236) | GATED-STORE |
| [packages/store/src/store.ts:6272](../../packages/store/src/store.ts#L6272) `Store/fieldIndexCurrent` | `SQLite.iterate` (6272); `SQLite.prepare` (6272, 6277); `Store.sql` (6272, 6277); `SQLite.all` (6277) | GATED-STORE |
| [packages/store/src/store.ts:6318](../../packages/store/src/store.ts#L6318) `Store/valueListItemsCurrent` | `Store.valueListItems` (6318); `Store.get` (6332); `relatedRows` (6333); `Store.row` (6333); `SQLite.iterate` (6335); `SQLite.prepare` (6335); `Store.sql` (6335); `Calculations.related` (6345); `Calculations.value` (6349, 6350) | GATED-STORE |
| [packages/store/src/store.ts:6447](../../packages/store/src/store.ts#L6447) `Store/portalRows` | `relatedRows` (6447); `relatedIdList` (6448); `Store.viewableIds` (6451); `rowsById` (6476, 6514); `Calculations.related` (6490) | CORE |
| [packages/store/src/store.ts:6458](../../packages/store/src/store.ts#L6458) `Store/portalRows/context` | `Calculations.context` (6458) | CORE |
| [packages/store/src/store.ts:6468](../../packages/store/src/store.ts#L6468) `Store/portalRows/valueOf` | `Calculations.value` (6468) | CORE |
| [packages/store/src/store.ts:6585](../../packages/store/src/store.ts#L6585) `Store/markRepeating` | `SQLite.prepare` (6585); `Store.sql` (6585) | CORE |
| [packages/store/src/store.ts:6612](../../packages/store/src/store.ts#L6612) `Store/externalContainerCheck` | `SQLite.all` (6612); `SQLite.prepare` (6612); `Store.sql` (6612) | CORE |
| [packages/store/src/store.ts:6619](../../packages/store/src/store.ts#L6619) `Store/externalContainerCount` | `SQLite.get` (6619); `SQLite.prepare` (6619); `Store.sql` (6619) | CORE |
| [packages/store/src/store.ts:6628](../../packages/store/src/store.ts#L6628) `Store/externalContainerReport` | `SQLite.all` (6628, 6641); `SQLite.prepare` (6628, 6641); `Store.sql` (6628, 6641) | CORE |
| [packages/store/src/store.ts:6683](../../packages/store/src/store.ts#L6683) `Store/orphanContainerReport` | `SQLite.all` (6683, 6701, 6703, 6709, 6722, 6735, 6754, 6772); `SQLite.prepare` (6683, 6701, 6703, 6709, 6722, 6735, 6752, 6754, 6772); `Store.sql` (6683, 6701, 6703, 6709, 6722, 6735, 6752, 6754, 6772); `SQLite.get` (6752); `Store.row` (6766) | CORE |
| [packages/store/src/store.ts:6783](../../packages/store/src/store.ts#L6783) `Store/purgeOrphanContainers` | `Store.sql` (6783, 6792, 6795, 6797, 6798, 6803, 6805); `Store.orphanContainerReport` (6784); `SQLite.get` (6792); `SQLite.prepare` (6792, 6797, 6798) | CORE |
| [packages/store/src/store.ts:6818](../../packages/store/src/store.ts#L6818) `Store/containerIntact` | `SQLite.get` (6818); `SQLite.prepare` (6818); `Store.sql` (6818) | CORE |
| [packages/store/src/store.ts:6828](../../packages/store/src/store.ts#L6828) `Store/externalOf` | `SQLite.get` (6828); `SQLite.prepare` (6828); `Store.sql` (6828) | CORE |
| [packages/store/src/store.ts:6832](../../packages/store/src/store.ts#L6832) `Store/containerMeta` | `SQLite.get` (6832); `SQLite.prepare` (6832); `Store.sql` (6832) | CORE |
| [packages/store/src/store.ts:6837](../../packages/store/src/store.ts#L6837) `Store/container` | `SQLite.get` (6837); `SQLite.prepare` (6837, 6846); `Store.sql` (6837, 6846); `SQLite.all` (6846) | CORE |
| [packages/store/src/store.ts:6854](../../packages/store/src/store.ts#L6854) `Store/containerInfo` | `SQLite.get` (6854); `SQLite.prepare` (6854); `Store.sql` (6854) | CORE |
| [packages/store/src/store.ts:6888](../../packages/store/src/store.ts#L6888) `Store/containerRange` | `SQLite.all` (6888); `SQLite.prepare` (6888, 6895); `Store.sql` (6888, 6895); `SQLite.get` (6895) | CORE |
| [packages/store/src/store.ts:6908](../../packages/store/src/store.ts#L6908) `Store/addContainer` | `SQLite.prepare` (6908, 6912, 6913); `Store.sql` (6908, 6910, 6912, 6913, 6915, 6918) | CORE |
| [packages/store/src/store.ts:6934](../../packages/store/src/store.ts#L6934) `Store/addExternalContainer` | `SQLite.prepare` (6934); `Store.sql` (6934) | CORE |
| [packages/store/src/store.ts:6952](../../packages/store/src/store.ts#L6952) `Store/writeExternalFile` | `Store.evaluateEach` (6952); `SQLite.prepare` (6975); `Store.sql` (6975) | CORE |
| [packages/store/src/store.ts:6976](../../packages/store/src/store.ts#L6976) `Store/writeExternalFile/taken` | `SQLite.get` (6976) | CORE |
| [packages/store/src/store.ts:6993](../../packages/store/src/store.ts#L6993) `Store/embeddedContainers` | `SQLite.prepare` (6993, 6994); `Store.sql` (6993, 6994); `SQLite.all` (6994); `SQLite.get` (6998) | CORE |
| [packages/store/src/store.ts:7007](../../packages/store/src/store.ts#L7007) `Store/embeddedContainerCount` | `SQLite.prepare` (7007); `Store.sql` (7007); `SQLite.get` (7008) | CORE |
| [packages/store/src/store.ts:7016](../../packages/store/src/store.ts#L7016) `Store/recoverContainersOut` | `SQLite.prepare` (7016); `Store.sql` (7016); `SQLite.get` (7019) | CORE |
| [packages/store/src/store.ts:7041](../../packages/store/src/store.ts#L7041) `Store/moveContainersOut` | `Store.sql` (7041, 7049, 7051, 7053, 7055, 7056, 7075, 7080, 7082, 7084, 7085, 7089); `SQLite.get` (7049); `SQLite.prepare` (7049, 7055, 7056); `Store.container` (7058) | CORE |
| [packages/store/src/store.ts:7098](../../packages/store/src/store.ts#L7098) `Store/moveContainersIn` | `Store.sql` (7098, 7102, 7104, 7105, 7106, 7107, 7126, 7129, 7136, 7139, 7142, 7149); `SQLite.prepare` (7104, 7105, 7106, 7107, 7136, 7142); `SQLite.get` (7109, 7136, 7142) | CORE |
| [packages/store/src/store.ts:7161](../../packages/store/src/store.ts#L7161) `Store/compactFile` | `Store.sql` (7161, 7162, 7163) | CORE |
| [packages/store/src/store.ts:7169](../../packages/store/src/store.ts#L7169) `Store/containerId` | `Store.containerId` (7169); `Store.row` (7170) | CORE |
| [packages/store/src/store.ts:7192](../../packages/store/src/store.ts#L7192) `Store/checkContainerWrite` | `Store.row` (7192) | CORE |
| [packages/store/src/store.ts:7202](../../packages/store/src/store.ts#L7202) `Store/setContainer` | `Store.row` (7202); `SQLite.prepare` (7213); `Store.sql` (7213) | CORE |
| [packages/store/src/store.ts:7245](../../packages/store/src/store.ts#L7245) `Store/orderBy` | `Store.valueListItems` (7245) | CORE |
| [packages/store/src/store.ts:7268](../../packages/store/src/store.ts#L7268) `Store/userPrefs` | `SQLite.all` (7268); `SQLite.prepare` (7268); `Store.sql` (7268) | CORE |
| [packages/store/src/store.ts:7273](../../packages/store/src/store.ts#L7273) `Store/hasTable` | `SQLite.get` (7273); `SQLite.prepare` (7273); `Store.sql` (7273) | CORE |
| [packages/store/src/store.ts:7277](../../packages/store/src/store.ts#L7277) `Store/setUserPref` | `Store.sql` (7277, 7278, 7279); `SQLite.prepare` (7278, 7279) | CORE |
| [packages/store/src/store.ts:7285](../../packages/store/src/store.ts#L7285) `Store/indexedFields` | `SQLite.all` (7285, 7286); `SQLite.prepare` (7285, 7286); `Store.sql` (7285, 7286) | CORE |
| [packages/store/src/store.ts:7307](../../packages/store/src/store.ts#L7307) `Store/addFieldIndex` | `Store.sql` (7307) | CORE |
| [packages/store/src/store.ts:7319](../../packages/store/src/store.ts#L7319) `Store/dropFieldIndex` | `SQLite.get` (7319); `SQLite.prepare` (7319); `Store.sql` (7319, 7320) | CORE |
| [packages/store/src/store.ts:7330](../../packages/store/src/store.ts#L7330) `Store/timeFind` | `Store.query` (7330, 7334, 7335); `Store.recordCount` (7337) | CORE |
| [packages/store/src/store.ts:7354](../../packages/store/src/store.ts#L7354) `Store/find` | `Store.find` (7354) | GATED-STORE |
| [packages/store/src/store.ts:7365](../../packages/store/src/store.ts#L7365) `Store/findHere` | `Store.query` (7365, 7370, 7372, 7386, 7388, 7398); `Store.recordCount` (7383); `SQLite.get` (7384, 7388); `SQLite.prepare` (7384, 7388, 7393, 7400, 7409); `Store.sql` (7384, 7388, 7393, 7400, 7409); `SQLite.all` (7393, 7400, 7409) | GATED-STORE |
| [packages/store/src/store.ts:7404](../../packages/store/src/store.ts#L7404) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7404); `SQLite.prepare` (7404); `Store.sql` (7404) | GATED-STORE |
| [packages/store/src/store.ts:7437](../../packages/store/src/store.ts#L7437) `Store/sortedPage` | `SQLite.iterate` (7437); `SQLite.prepare` (7437, 7452); `Store.sql` (7437, 7452); `SQLite.all` (7452) | CORE |
| [packages/store/src/store.ts:7509](../../packages/store/src/store.ts#L7509) `Store/relatedCriteria/matched` | `relatedRows` (7509) | CORE |
| [packages/store/src/store.ts:7512](../../packages/store/src/store.ts#L7512) `Store/relatedCriteria` | `SQLite.iterate` (7512); `SQLite.prepare` (7512); `Store.sql` (7512) | CORE |
| [packages/store/src/store.ts:7538](../../packages/store/src/store.ts#L7538) `Store/computedRows` | `Store.sql` (7538, 7541, 7542, 7543, 7545, 7555, 7556, 7557, 7560); `SQLite.prepare` (7541, 7543, 7545, 7555); `SQLite.iterate` (7545); `Calculations.globalValue` (7548); `Calculations.unstoredValue` (7549); `Calculations.related` (7552); `SQLite.all` (7555) | CORE |
| [packages/store/src/store.ts:7585](../../packages/store/src/store.ts#L7585) `Store/summaries` | `Calculations.wholeTable` (7585); `Calculations.collect` (7605, 7610) | CORE |
| [packages/store/src/store.ts:7601](../../packages/store/src/store.ts#L7601) `Store/summaries/recs` | `SQLite.iterate` (7601); `SQLite.prepare` (7601); `Store.sql` (7601) | CORE |
| [packages/store/src/store.ts:7623](../../packages/store/src/store.ts#L7623) `Store/runningSummaryValues` | `Store.viewableIds` (7623); `rowsById` (7625); `Calculations.value` (7636, 7642); `Calculations.related` (7653) | GATED-STORE |
| [packages/store/src/store.ts:7666](../../packages/store/src/store.ts#L7666) `Store/findSource` | `Store.query` (7666); `Store.sql` (7673, 7674, 7678, 7680, 7691, 7693); `SQLite.prepare` (7674, 7680); `SQLite.iterate` (7680); `Calculations.globalValue` (7684); `Calculations.unstoredValue` (7685); `Calculations.related` (7689) | CORE |
| [packages/store/src/store.ts:7712](../../packages/store/src/store.ts#L7712) `Store/previewRow` | `Store.row` (7712) | CORE |
| [packages/store/src/store.ts:7730](../../packages/store/src/store.ts#L7730) `Store/row` | `SQLite.get` (7730) | CORE |
| [packages/store/src/store.ts:7749](../../packages/store/src/store.ts#L7749) `Store/getCurrent` | `Store.get` (7749); `Store.row` (7750, 7750, 7764); `SQLite.all` (7767); `SQLite.prepare` (7767); `Store.sql` (7767) | GATED-STORE |
| [packages/store/src/store.ts:7787](../../packages/store/src/store.ts#L7787) `Store/getManyCurrent` | `Store.getMany` (7787); `SQLite.get` (7805); `SQLite.prepare` (7805); `Store.sql` (7805) | GATED-STORE |
| [packages/store/src/store.ts:7798](../../packages/store/src/store.ts#L7798) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (7798) | GATED-STORE |
| [packages/store/src/store.ts:7821](../../packages/store/src/store.ts#L7821) `Store/canViewRecord` | `SQLite.get` (7821); `SQLite.prepare` (7821); `Store.sql` (7821) | GATED-STORE |
| [packages/store/src/store.ts:7829](../../packages/store/src/store.ts#L7829) `Store/canView` | `Store.canView` (7829); `Store.row` (7830) | GATED-STORE |
| [packages/store/src/store.ts:7854](../../packages/store/src/store.ts#L7854) `Store/create` | `SQLite.get` (7854, 7860); `SQLite.prepare` (7854, 7860, 7871); `Store.sql` (7854, 7860, 7871) | CORE |
| [packages/store/src/store.ts:7895](../../packages/store/src/store.ts#L7895) `Store/duplicate` | `Store.row` (7895); `SQLite.get` (7899); `SQLite.prepare` (7899, 7912); `Store.sql` (7899, 7912) | CORE |
| [packages/store/src/store.ts:7957](../../packages/store/src/store.ts#L7957) `Store/update` | `Store.row` (7957, 7964, 7975); `Store.sql` (7988, 7989, 8026, 8029) | CORE |
| [packages/store/src/store.ts:7991](../../packages/store/src/store.ts#L7991) `Store/update/undo` | `Store.sql` (7991) | CORE |
| [packages/store/src/store.ts:8133](../../packages/store/src/store.ts#L8133) `Store/setStoredCalcValues` | `SQLite.prepare` (8133, 8134); `Store.sql` (8133, 8134); `SQLite.get` (8138) | CORE |
| [packages/store/src/store.ts:8212](../../packages/store/src/store.ts#L8212) `Store/evaluateCurrent` | `Store.row` (8212, 8212); `Calculations.context` (8213); `Store.get` (8214, 8216) | GATED-STORE |
| [packages/store/src/store.ts:8248](../../packages/store/src/store.ts#L8248) `Store/evaluateEachCurrent` | `Store.row` (8248, 8248); `Calculations.context` (8253); `Store.get` (8255) | GATED-STORE |
| [packages/store/src/store.ts:8288](../../packages/store/src/store.ts#L8288) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8288); `Store.get` (8290) | GATED-STORE |
| [packages/store/src/store.ts:8309](../../packages/store/src/store.ts#L8309) `Store/evaluateRowsCurrent` | `Store.row` (8309, 8309) | GATED-STORE |
| [packages/store/src/store.ts:8323](../../packages/store/src/store.ts#L8323) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8323) | GATED-STORE |
| [packages/store/src/store.ts:8345](../../packages/store/src/store.ts#L8345) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8345) | GATED-STORE |
| [packages/store/src/store.ts:8383](../../packages/store/src/store.ts#L8383) `Store/updateRelated` | `relatedRows` (8383) | CORE |
| [packages/store/src/store.ts:8401](../../packages/store/src/store.ts#L8401) `Store/updatePortals` | `Store.row` (8401, 8436); `relatedRows` (8437) | CORE |
| [packages/store/src/store.ts:8410](../../packages/store/src/store.ts#L8410) `Store/updatePortals/portal/related` | `relatedIdList` (8410) | CORE |
| [packages/store/src/store.ts:8492](../../packages/store/src/store.ts#L8492) `Store/portalContainerTarget` | `Store.row` (8492); `relatedIdList` (8493) | CORE |
| [packages/store/src/store.ts:8506](../../packages/store/src/store.ts#L8506) `Store/checkEditable` | `Store.row` (8506) | CORE |
| [packages/store/src/store.ts:8529](../../packages/store/src/store.ts#L8529) `Store/delete` | `Store.row` (8529); `SQLite.get` (8534); `SQLite.prepare` (8534, 8536); `Store.sql` (8534, 8536) | CORE |
| [packages/store/src/store.ts:8557](../../packages/store/src/store.ts#L8557) `Store/vaultHeld` | `SQLite.get` (8557); `SQLite.prepare` (8557); `Store.sql` (8557) | CORE |
| [packages/store/src/store.ts:8564](../../packages/store/src/store.ts#L8564) `Store/forgetStandInValues` | `Store.sql` (8564, 8585); `SQLite.prepare` (8585) | CORE |
| [packages/store/src/store.ts:8599](../../packages/store/src/store.ts#L8599) `Store/restoreDeletedRow` | `SQLite.get` (8599); `SQLite.prepare` (8599, 8600, 8602); `Store.sql` (8599, 8600, 8602); `SQLite.all` (8600) | CORE |
| [packages/store/src/store.ts:8626](../../packages/store/src/store.ts#L8626) `Store/cascadeDelete` | `relatedRows` (8626) | CORE |
| [packages/store/src/store.ts:8716](../../packages/store/src/store.ts#L8716) `Store/selectIdsCurrent` | `Store.selectIds` (8716); `SQLite.all` (8722); `SQLite.prepare` (8722); `Store.sql` (8722) | GATED-STORE |
| [packages/store/src/store.ts:8730](../../packages/store/src/store.ts#L8730) `Store/countIds` | `Store.countIds` (8730); `SQLite.get` (8734); `SQLite.prepare` (8734); `Store.sql` (8734) | GATED-STORE |
| [packages/store/src/store.ts:8750](../../packages/store/src/store.ts#L8750) `Store/computeValuesCurrent` | `Store.computeValues` (8750); `Store.sql` (8756, 8760); `SQLite.all` (8760); `SQLite.prepare` (8760) | GATED-STORE |
| [packages/store/src/store.ts:8775](../../packages/store/src/store.ts#L8775) `Store/findIdsCurrent` | `Store.findIds` (8775) | GATED-STORE |
| [packages/store/src/store.ts:8781](../../packages/store/src/store.ts#L8781) `Store/findIdsHere` | `Store.query` (8781, 8786, 8788); `SQLite.iterate` (8799); `SQLite.prepare` (8799); `Store.sql` (8799) | GATED-STORE |
| [packages/store/src/store.ts:8816](../../packages/store/src/store.ts#L8816) `Store/groupSummariesCurrent` | `Store.groupSummaries` (8816); `Store.viewableIds` (8821); `Calculations.collect` (8837); `rowsById` (8837, 8887); `Calculations.collector` (8859) | GATED-STORE |
| [packages/store/src/store.ts:8849](../../packages/store/src/store.ts#L8849) `Store/groupSummariesCurrent/key` | `Calculations.value` (8849); `Calculations.related` (8851) | GATED-STORE |
| [packages/store/src/store.ts:8885](../../packages/store/src/store.ts#L8885) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (8885) | GATED-STORE |
| [packages/store/src/store.ts:8908](../../packages/store/src/store.ts#L8908) `Store/sortIdsCurrent` | `Store.sortIds` (8908); `SQLite.all` (8912); `SQLite.prepare` (8912); `Store.sql` (8912) | GATED-STORE |
| [packages/store/src/store.ts:8922](../../packages/store/src/store.ts#L8922) `Store/matchIds` | `Store.matchIds` (8922); `SQLite.all` (8928); `SQLite.prepare` (8928); `Store.sql` (8928) | CORE |
| [packages/store/src/store.ts:8946](../../packages/store/src/store.ts#L8946) `Store/truncate` | `Store.sql` (8946, 8948, 8955, 8956, 8958, 8959); `SQLite.prepare` (8948, 8955); `SQLite.all` (8950) | CORE |
| [packages/store/src/store.ts:8980](../../packages/store/src/store.ts#L8980) `Store/iterateCommitted` | `SQLite.iterate` (8980) | CORE |
| [packages/store/src/store.ts:9014](../../packages/store/src/store.ts#L9014) `Store/readOnlyChecked` | `SQLite.prepare` (9014, 9018, 9027, 9032); `SQLite.all` (9018, 9027, 9032) | CORE |
| [packages/store/src/store.ts:9054](../../packages/store/src/store.ts#L9054) `Store/refreshDecimalSqlViews` | `SQLite.get` (9054); `SQLite.prepare` (9054, 9059); `SQLite.all` (9059) | CORE |
| [packages/store/src/store.ts:9073](../../packages/store/src/store.ts#L9073) `Store/internalRoots` | `SQLite.get` (9073); `SQLite.prepare` (9073, 9075); `SQLite.all` (9075) | CORE |
| [packages/store/src/store.ts:9108](../../packages/store/src/store.ts#L9108) `Store/selectCurrent` | `SQLite.iterate` (9108) | CORE |
| [packages/store/src/store.ts:9129](../../packages/store/src/store.ts#L9129) `Store/query` | `SQLite.iterate` (9129) | CORE |
| [packages/store/src/store.ts:9163](../../packages/store/src/store.ts#L9163) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9163); `SQLite.all` (9170, 9173); `SQLite.prepare` (9170, 9173) | CORE |
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
