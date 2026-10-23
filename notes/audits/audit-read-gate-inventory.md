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
| `packages/server/src/pgwrite.ts` / `executeWrite/reader` | SQL | SQL writes (`--sql-writes`) read the table to find the records a WHERE names and to work out each new value. They run as the signed-in account, which already passed the SQL connection's gate (fmxdbc, reads every record and field) and the table's create, edit or delete privilege and the written fields' modify rights before the first read. The changes themselves go through Store.create, update and delete with the account's privileges, so every record rule and audit entry applies there. |
| `packages/server/src/pgwrite.ts` / `returningColumns` | SQL | Describes the columns RETURNING gives back (names and declared types only, no rows) for the account's own table. |
| `packages/store/src/store.ts` / `Store/selectIn` | CORE | Reads through Store.select, or, for the caller that holds the file's open transaction, through the connection holding it. No account gate here: the PostgreSQL connection checks fmxdbc and reads-everything before it calls. |
| `packages/store/src/store.ts` / `Store/selectHeldCurrent` | CORE | The same query screening as Store.select (readOnlyChecked), run on the writable connection so a transaction sees its own uncommitted changes. Only text that passed the read-only screening reaches that connection. |

<!-- generated read-gate inventory -->
| Function | Store read / capability (source lines) | Gate |
| --- | --- | --- |
| [packages/cli/src/diagnostics.ts:204](../../packages/cli/src/diagnostics.ts#L204) `designCopy` | `SQLite.all` (204); `SQLite.prepare` (204, 207) | OPERATOR |
| [packages/cli/src/diagnostics.ts:443](../../packages/cli/src/diagnostics.ts#L443) `diagnostics` | `SQLite.get` (443); `SQLite.prepare` (443, 447); `SQLite.all` (447) | OPERATOR |
| [packages/cli/src/doctor.ts:139](../../packages/cli/src/doctor.ts#L139) `accountChecks` | `SQLite.all` (139); `SQLite.prepare` (139) | OPERATOR |
| [packages/cli/src/main.ts:679](../../packages/cli/src/main.ts#L679) `accountsWithPasswordOff` | `SQLite.all` (679); `SQLite.prepare` (679) | OPERATOR |
| [packages/cli/src/main.ts:708](../../packages/cli/src/main.ts#L708) `hostedRead` | `SQLite.all` (708, 711); `SQLite.prepare` (708, 711); `Store.sql` (708, 711) | OPERATOR |
| [packages/cli/src/main.ts:2322](../../packages/cli/src/main.ts#L2322) `main` | `Store.orphanContainerReport` (2322); `Store.auditLog` (2785); `SQLite.get` (3001); `SQLite.prepare` (3001) | OPERATOR |
| [packages/scripts/src/data-api-step.ts:104](../../packages/scripts/src/data-api-step.ts#L104) `respond` | `Store.get` (104, 131, 140); `Store.find` (105, 117) | SCRIPT |
| [packages/scripts/src/engine.ts:1940](../../packages/scripts/src/engine.ts#L1940) `ScriptEngine/goToLayout` | `Store.findIds` (1940) | SCRIPT |
| [packages/scripts/src/engine.ts:2284](../../packages/scripts/src/engine.ts#L2284) `ScriptEngine/foundSet` | `Store.findIds` (2284) | SCRIPT |
| [packages/scripts/src/engine.ts:2349](../../packages/scripts/src/engine.ts#L2349) `ScriptEngine/semanticFind` | `Store.findIds` (2349, 2370) | SCRIPT |
| [packages/scripts/src/engine.ts:3263](../../packages/scripts/src/engine.ts#L3263) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3263); `Calculations.executeSQL` (3270) | SCRIPT |
| [packages/scripts/src/engine.ts:3320](../../packages/scripts/src/engine.ts#L3320) `ScriptEngine/sortIds` | `Store.sortIds` (3320); `Store.valueListItems` (3326) | SCRIPT |
| [packages/scripts/src/engine.ts:3417](../../packages/scripts/src/engine.ts#L3417) `ScriptEngine/revertTransaction` | `Store.findIds` (3417) | SCRIPT |
| [packages/scripts/src/engine.ts:3967](../../packages/scripts/src/engine.ts#L3967) `ScriptEngine/step` | `Store.fieldIndex` (3967); `Store.findIds` (4101, 4200) | SCRIPT |
| [packages/scripts/src/engine.ts:5228](../../packages/scripts/src/engine.ts#L5228) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5228) | SCRIPT |
| [packages/scripts/src/engine.ts:5236](../../packages/scripts/src/engine.ts#L5236) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5236) | SCRIPT |
| [packages/scripts/src/engine.ts:5237](../../packages/scripts/src/engine.ts#L5237) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5237) | SCRIPT |
| [packages/scripts/src/engine.ts:5390](../../packages/scripts/src/engine.ts#L5390) `ScriptEngine/get` | `Store.findIds` (5390); `Store.canViewRecord` (5481); `Store.get` (5517) | SCRIPT |
| [packages/scripts/src/engine.ts:5548](../../packages/scripts/src/engine.ts#L5548) `ScriptEngine/design` | `Store.valueListItems` (5548) | SCRIPT |
| [packages/scripts/src/engine.ts:5602](../../packages/scripts/src/engine.ts#L5602) `ScriptEngine/record` | `Store.get` (5602) | SCRIPT |
| [packages/scripts/src/engine.ts:5635](../../packages/scripts/src/engine.ts#L5635) `ScriptEngine/valueOf` | `Store.findIds` (5635, 5635); `Store.containerId` (5643) | SCRIPT |
| [packages/scripts/src/engine.ts:5660](../../packages/scripts/src/engine.ts#L5660) `ScriptEngine/lookupNext` | `Store.get` (5660); `Store.row` (5661); `Calculations.context` (5663) | SCRIPT |
| [packages/scripts/src/engine.ts:5763](../../packages/scripts/src/engine.ts#L5763) `ScriptEngine/relatedIds` | `Store.findIds` (5763); `rowsById` (5771); `Store.select` (5775); `Store.matchIds` (5789); `Store.viewableIds` (5812) | SCRIPT |
| [packages/scripts/src/engine.ts:5797](../../packages/scripts/src/engine.ts#L5797) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5797) | SCRIPT |
| [packages/scripts/src/engine.ts:6286](../../packages/scripts/src/engine.ts#L6286) `ScriptEngine/exportField` | `Store.get` (6286); `Store.containerId` (6287); `Store.container` (6289) | SCRIPT |
| [packages/scripts/src/engine.ts:6437](../../packages/scripts/src/engine.ts#L6437) `ScriptEngine/relookup` | `Store.get` (6437) | SCRIPT |
| [packages/scripts/src/engine.ts:6857](../../packages/scripts/src/engine.ts#L6857) `ScriptEngine/goToList` | `Store.findIds` (6857) | SCRIPT |
| [packages/scripts/src/engine.ts:7186](../../packages/scripts/src/engine.ts#L7186) `ScriptEngine/sourceValue` | `Store.get` (7186); `Store.containerId` (7187); `Store.container` (7188) | SCRIPT |
| [packages/scripts/src/engine.ts:7921](../../packages/scripts/src/engine.ts#L7921) `ScriptEngine/containerFile` | `Store.get` (7921); `Store.containerId` (7922); `Store.container` (7923) | SCRIPT |
| [packages/scripts/src/engine.ts:8083](../../packages/scripts/src/engine.ts#L8083) `ScriptEngine/importRecords` | `Store.findIds` (8083); `Store.get` (8103) | SCRIPT |
| [packages/scripts/src/engine.ts:8314](../../packages/scripts/src/engine.ts#L8314) `ScriptEngine/fileMakerRows` | `Store.findIds` (8314); `Store.get` (8319) | SCRIPT |
| [packages/scripts/src/engine.ts:8354](../../packages/scripts/src/engine.ts#L8354) `ScriptEngine/newRecord` | `Store.findIds` (8354) | SCRIPT |
| [packages/scripts/src/engine.ts:8659](../../packages/scripts/src/engine.ts#L8659) `ScriptEngine/performFind` | `Store.findIds` (8659) | SCRIPT |
| [packages/scripts/src/engine.ts:8684](../../packages/scripts/src/engine.ts#L8684) `ScriptEngine/findRelated` | `Store.findIds` (8684, 8694, 8697) | SCRIPT |
| [packages/scripts/src/engine.ts:8716](../../packages/scripts/src/engine.ts#L8716) `ScriptEngine/quickFind` | `Store.findIds` (8716, 8717, 8720) | SCRIPT |
| [packages/scripts/src/engine.ts:9104](../../packages/scripts/src/engine.ts#L9104) `clearRecords` | `SQLite.all` (9104); `SQLite.prepare` (9104) | SCRIPT |
| [packages/scripts/src/recorder.ts:83](../../packages/scripts/src/recorder.ts#L83) `lastSeq` | `Store.auditLog` (83) | DESIGN |
| [packages/scripts/src/recorder.ts:121](../../packages/scripts/src/recorder.ts#L121) `recordRun` | `Store.auditLog` (121) | DESIGN |
| [packages/scripts/src/script-tests.ts:213](../../packages/scripts/src/script-tests.ts#L213) `runCase` | `Store.findIds` (213); `Store.auditLog` (220, 221, 265); `Store.evaluateEach` (248) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/server/src/admin.ts:998](../../packages/server/src/admin.ts#L998) `Admin/handle` | `Store.externalContainerReport` (998); `Store.orphanContainerReport` (1003, 1007) | ADMIN |
| [packages/server/src/admin.ts:2170](../../packages/server/src/admin.ts#L2170) `Admin/audit` | `Store.auditLog` (2170) | ADMIN |
| [packages/server/src/admin.ts:2253](../../packages/server/src/admin.ts#L2253) `Admin/viewAs` | `Store.find` (2253) | ADMIN |
| [packages/server/src/admin.ts:2601](../../packages/server/src/admin.ts#L2601) `Admin/status` | `Store.externalContainerCount` (2601) | ADMIN |
| [packages/server/src/agent.ts:154](../../packages/server/src/agent.ts#L154) `runStep/visible` | `Store.findIds` (154) | DESIGN |
| [packages/server/src/agent.ts:162](../../packages/server/src/agent.ts#L162) `runStep` | `Store.findIds` (162); `Store.auditLog` (221); `Store.canViewRecord` (233) | DESIGN |
| [packages/server/src/agent.ts:307](../../packages/server/src/agent.ts#L307) `dryRunPlan` | `Store.findIds` (307) | DESIGN |
| [packages/server/src/agent.ts:330](../../packages/server/src/agent.ts#L330) `runApprovedStep` | `Store.findIds` (330) | DESIGN |
| [packages/server/src/ai-output.ts:147](../../packages/server/src/ai-output.ts#L147) `storedSecretValues` | `Calculations.globalValue` (147); `Store.select` (152) | REDACTION |
| [packages/server/src/ai-policy-sql.ts:49](../../packages/server/src/ai-policy-sql.ts#L49) `sqlFieldRefs` | `SQLite.all` (49, 51); `SQLite.prepare` (49, 51) | POLICY |
| [packages/server/src/ai-policy.ts:338](../../packages/server/src/ai-policy.ts#L338) `sql` | `Store.inspectQuery` (338) | POLICY |
| [packages/server/src/ai-usage.ts:162](../../packages/server/src/ai-usage.ts#L162) `AiUsage/today` | `SQLite.get` (162); `SQLite.prepare` (162) | AUTH |
| [packages/server/src/ai-usage.ts:169](../../packages/server/src/ai-usage.ts#L169) `AiUsage/month` | `SQLite.get` (169); `SQLite.prepare` (169) | AUTH |
| [packages/server/src/ai-usage.ts:176](../../packages/server/src/ai-usage.ts#L176) `AiUsage/recent` | `SQLite.all` (176); `SQLite.prepare` (176) | AUTH |
| [packages/server/src/ai-usage.ts:184](../../packages/server/src/ai-usage.ts#L184) `AiUsage/add` | `SQLite.prepare` (184, 187) | AUTH |
| [packages/server/src/ai-usage.ts:195](../../packages/server/src/ai-usage.ts#L195) `AiUsage/question` | `SQLite.prepare` (195, 197, 198, 200) | AUTH |
| [packages/server/src/ai-usage.ts:224](../../packages/server/src/ai-usage.ts#L224) `AiUsage/importOld` | `SQLite.prepare` (224, 234, 242, 246) | AUTH |
| [packages/server/src/assistant.ts:2076](../../packages/server/src/assistant.ts#L2076) `Assistant/answer` | `Store.find` (2076) | ACCOUNT |
| [packages/server/src/automations.ts:166](../../packages/server/src/automations.ts#L166) `Saved/table` | `Store.sql` (166, 167) | AUTOMATION |
| [packages/server/src/automations.ts:177](../../packages/server/src/automations.ts#L177) `Saved/list` | `SQLite.all` (177); `SQLite.prepare` (177); `Store.sql` (177) | AUTOMATION |
| [packages/server/src/automations.ts:187](../../packages/server/src/automations.ts#L187) `Saved/save` | `SQLite.prepare` (187); `Store.sql` (187) | AUTOMATION |
| [packages/server/src/automations.ts:193](../../packages/server/src/automations.ts#L193) `Saved/delete` | `SQLite.prepare` (193, 195); `Store.sql` (193, 195) | AUTOMATION |
| [packages/server/src/automations.ts:200](../../packages/server/src/automations.ts#L200) `Saved/logRun` | `SQLite.prepare` (200, 202); `Store.sql` (200, 202) | AUTOMATION |
| [packages/server/src/automations.ts:207](../../packages/server/src/automations.ts#L207) `Saved/runs` | `SQLite.all` (207); `SQLite.prepare` (207); `Store.sql` (207) | AUTOMATION |
| [packages/server/src/automations.ts:295](../../packages/server/src/automations.ts#L295) `dryRunAutomation/truth` | `Store.evaluateEach` (295) | AUTOMATION |
| [packages/server/src/automations.ts:296](../../packages/server/src/automations.ts#L296) `dryRunAutomation` | `Store.canViewRecord` (296); `Store.findIds` (296); `Store.auditLog` (312, 340, 348); `Store.select` (325); `Store.evaluate` (341) | AUTOMATION |
| [packages/server/src/automations.ts:423](../../packages/server/src/automations.ts#L423) `AutomationRunner/changed` | `Store.auditLog` (423) | AUTOMATION |
| [packages/server/src/automations.ts:452](../../packages/server/src/automations.ts#L452) `AutomationRunner/run` | `Store.select` (452); `Store.canViewRecord` (462); `Store.evaluateEach` (465); `Store.evaluate` (471) | AUTOMATION |
| [packages/server/src/automations.ts:498](../../packages/server/src/automations.ts#L498) `AutomationRunner/runDeleted` | `Store.auditLog` (498) | AUTOMATION |
| [packages/server/src/backup-verify.ts:148](../../packages/server/src/backup-verify.ts#L148) `testRestore` | `Store.recordCount` (148) | OPERATOR |
| [packages/server/src/backup-verify.ts:188](../../packages/server/src/backup-verify.ts#L188) `integrity` | `SQLite.all` (188); `SQLite.prepare` (188, 192); `SQLite.get` (192) | OPERATOR |
| [packages/server/src/backup-verify.ts:218](../../packages/server/src/backup-verify.ts#L218) `pageCheck` | `SQLite.all` (218); `SQLite.prepare` (218, 221); `SQLite.get` (221) | OPERATOR |
| [packages/server/src/backup.ts:997](../../packages/server/src/backup.ts#L997) `accountDifferences/read` | `SQLite.all` (997, 999); `SQLite.prepare` (997, 999) | OPERATOR |
| [packages/server/src/backup.ts:1024](../../packages/server/src/backup.ts#L1024) `readNames` | `SQLite.all` (1024); `SQLite.prepare` (1024) | OPERATOR |
| [packages/server/src/backup.ts:1054](../../packages/server/src/backup.ts#L1054) `credentialsReadable` | `SQLite.all` (1054); `SQLite.prepare` (1054) | OPERATOR |
| [packages/server/src/backup.ts:1070](../../packages/server/src/backup.ts#L1070) `columnInfo` | `SQLite.all` (1070); `SQLite.prepare` (1070) | OPERATOR |
| [packages/server/src/backup.ts:1105](../../packages/server/src/backup.ts#L1105) `reconcileCredentials` | `SQLite.all` (1105, 1127, 1142, 1152, 1158); `SQLite.prepare` (1105, 1113, 1127, 1129, 1142, 1143, 1150, 1152, 1153, 1158, 1159, 1163, 1164, 1165); `SQLite.get` (1113, 1163) | OPERATOR |
| [packages/server/src/backup.ts:1108](../../packages/server/src/backup.ts#L1108) `reconcileCredentials/has` | `SQLite.all` (1108); `SQLite.prepare` (1108) | OPERATOR |
| [packages/server/src/backup.ts:1132](../../packages/server/src/backup.ts#L1132) `reconcileCredentials/accountColumns` | `SQLite.all` (1132); `SQLite.prepare` (1132) | OPERATOR |
| [packages/server/src/backup.ts:1277](../../packages/server/src/backup.ts#L1277) `stageRestorePoint` | `SQLite.get` (1277, 1279, 1280); `SQLite.prepare` (1277, 1279, 1280) | OPERATOR |
| [packages/server/src/calendar.ts:389](../../packages/server/src/calendar.ts#L389) `CalendarFeeds/feed` | `Store.find` (389) | CALENDAR |
| [packages/server/src/changes.ts:195](../../packages/server/src/changes.ts#L195) `ChangeFeed/visible` | `Store.canViewRecord` (195) | CHANGE |
| [packages/server/src/cleanup.ts:327](../../packages/server/src/cleanup.ts#L327) `scanData` | `Store.findIds` (327); `Store.select` (333) | CLEANUP |
| [packages/server/src/cleanup.ts:617](../../packages/server/src/cleanup.ts#L617) `keyValue` | `SQLite.get` (617); `SQLite.prepare` (617); `Store.sql` (617) | CLEANUP |
| [packages/server/src/cleanup.ts:621](../../packages/server/src/cleanup.ts#L621) `relatedIds` | `SQLite.all` (621); `SQLite.prepare` (621); `Store.sql` (621) | CLEANUP |
| [packages/server/src/cleanup.ts:741](../../packages/server/src/cleanup.ts#L741) `applyCleanup/apply` | `Store.findIds` (741, 751); `SQLite.all` (742); `SQLite.prepare` (742, 779); `Store.sql` (742, 779); `SQLite.get` (779) | CLEANUP |
| [packages/server/src/cleanup.ts:810](../../packages/server/src/cleanup.ts#L810) `snapshotField` | `SQLite.all` (810); `SQLite.prepare` (810); `Store.sql` (810) | CLEANUP |
| [packages/server/src/cleanup.ts:870](../../packages/server/src/cleanup.ts#L870) `snapshotRows` | `SQLite.all` (870); `SQLite.prepare` (870); `Store.sql` (870) | CLEANUP |
| [packages/server/src/cleanup.ts:879](../../packages/server/src/cleanup.ts#L879) `journalDeletes` | `SQLite.get` (879); `SQLite.prepare` (879); `Store.sql` (879) | CLEANUP |
| [packages/server/src/cleanup.ts:929](../../packages/server/src/cleanup.ts#L929) `updateMany` | `Store.findIds` (929) | CLEANUP |
| [packages/server/src/cleanup.ts:991](../../packages/server/src/cleanup.ts#L991) `undoCleanup` | `SQLite.get` (991, 1007); `SQLite.prepare` (991, 1007); `Store.sql` (991, 1007) | CLEANUP |
| [packages/server/src/cleanup.ts:1031](../../packages/server/src/cleanup.ts#L1031) `CleanupJournal/constructor` | `Store.sql` (1031) | CLEANUP |
| [packages/server/src/cleanup.ts:1040](../../packages/server/src/cleanup.ts#L1040) `CleanupJournal/append` | `SQLite.prepare` (1040); `Store.sql` (1040) | CLEANUP |
| [packages/server/src/cleanup.ts:1045](../../packages/server/src/cleanup.ts#L1045) `CleanupJournal/add` | `SQLite.prepare` (1045); `Store.sql` (1045) | CLEANUP |
| [packages/server/src/cleanup.ts:1051](../../packages/server/src/cleanup.ts#L1051) `CleanupJournal/get` | `SQLite.get` (1051); `SQLite.prepare` (1051); `Store.sql` (1051) | CLEANUP |
| [packages/server/src/cleanup.ts:1056](../../packages/server/src/cleanup.ts#L1056) `CleanupJournal/list` | `SQLite.all` (1056); `SQLite.prepare` (1056); `Store.sql` (1056) | CLEANUP |
| [packages/server/src/cleanup.ts:1060](../../packages/server/src/cleanup.ts#L1060) `CleanupJournal/markUndone` | `SQLite.prepare` (1060); `Store.sql` (1060) | CLEANUP |
| [packages/server/src/cleanup.ts:523](../../packages/server/src/cleanup.ts#L523) `findDuplicates` | `Store.findIds` (523) | CLEANUP |
| [packages/server/src/compare.ts:206](../../packages/server/src/compare.ts#L206) `count` | `Store.query` (206) | DESIGN |
| [packages/server/src/containers.ts:130](../../packages/server/src/containers.ts#L130) `ContainerFiles/send` | `Store.containerInfo` (130); `Store.container` (196); `Store.containerRange` (205) | CONTAINER |
| [packages/server/src/containers.ts:297](../../packages/server/src/containers.ts#L297) `ContainerFiles/make` | `Store.containerInfo` (297) | CONTAINER |
| [packages/server/src/containers.ts:309](../../packages/server/src/containers.ts#L309) `ContainerFiles/makeAdmitted` | `Store.container` (309) | CONTAINER |
| [packages/server/src/conversion-guide.ts:118](../../packages/server/src/conversion-guide.ts#L118) `convertedAt` | `SQLite.get` (118); `SQLite.prepare` (118); `Store.sql` (118) | DESIGN |
| [packages/server/src/conversion-guide.ts:360](../../packages/server/src/conversion-guide.ts#L360) `ConversionGuides/table` | `Store.sql` (360) | DESIGN |
| [packages/server/src/conversion-guide.ts:370](../../packages/server/src/conversion-guide.ts#L370) `ConversionGuides/saved` | `SQLite.get` (370); `SQLite.prepare` (370); `Store.sql` (370) | DESIGN |
| [packages/server/src/conversion-guide.ts:379](../../packages/server/src/conversion-guide.ts#L379) `ConversionGuides/save` | `SQLite.prepare` (379); `Store.sql` (379) | DESIGN |
| [packages/server/src/conversion.ts:299](../../packages/server/src/conversion.ts#L299) `conversionReport` | `Store.externalContainerCheck` (299) | DESIGN |
| [packages/server/src/cwp-xml.ts:457](../../packages/server/src/cwp-xml.ts#L457) `CwpXmlEndpoint/records` | `Store.find` (457, 459, 460, 466, 469); `Store.get` (465, 473) | XML |
| [packages/server/src/cwp-xml.ts:541](../../packages/server/src/cwp-xml.ts#L541) `CwpXmlEndpoint/layoutDoc` | `Store.valueListItems` (541) | XML |
| [packages/server/src/dashboards.ts:359](../../packages/server/src/dashboards.ts#L359) `Dashboards/table` | `Store.sql` (359) | DASHBOARD |
| [packages/server/src/dashboards.ts:369](../../packages/server/src/dashboards.ts#L369) `Dashboards/list` | `SQLite.all` (369); `SQLite.prepare` (369); `Store.sql` (369) | DASHBOARD |
| [packages/server/src/dashboards.ts:375](../../packages/server/src/dashboards.ts#L375) `Dashboards/get` | `SQLite.get` (375); `SQLite.prepare` (375); `Store.sql` (375) | DASHBOARD |
| [packages/server/src/dashboards.ts:389](../../packages/server/src/dashboards.ts#L389) `Dashboards/create` | `SQLite.prepare` (389); `Store.sql` (389) | DASHBOARD |
| [packages/server/src/dashboards.ts:402](../../packages/server/src/dashboards.ts#L402) `Dashboards/update` | `SQLite.prepare` (402); `Store.sql` (402) | DASHBOARD |
| [packages/server/src/dashboards.ts:409](../../packages/server/src/dashboards.ts#L409) `Dashboards/delete` | `SQLite.prepare` (409); `Store.sql` (409) | DASHBOARD |
| [packages/server/src/dataapi.ts:1940](../../packages/server/src/dataapi.ts#L1940) `DataApi/route` | `Store.get` (1940, 2162, 2163, 2186, 2194, 2241, 2265, 2285, 2322); `Store.valueListItems` (1955); `Store.find` (2117, 2165, 2355); `Store.findIds` (2121, 2360); `Store.query` (2360) | REST |
| [packages/server/src/dataapi.ts:2069](../../packages/server/src/dataapi.ts#L2069) `DataApi/route/recordOut` | `Store.portalCounts` (2069) | REST |
| [packages/server/src/dataapi.ts:2105](../../packages/server/src/dataapi.ts#L2105) `DataApi/route/shownAs` | `Store.get` (2105) | REST |
| [packages/server/src/debug.ts:190](../../packages/server/src/debug.ts#L190) `learnStoredCredentials` | `Calculations.globalValue` (190); `Store.sql` (196, 206, 206); `SQLite.iterate` (206, 206); `SQLite.prepare` (206, 206); `Store.iterateCommitted` (206) | DESIGN |
| [packages/server/src/debug.ts:319](../../packages/server/src/debug.ts#L319) `DebugApi/handle` | `Store.row` (319, 439); `Store.get` (328, 444); `Store.evaluate` (352) | DESIGN |
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
| [packages/server/src/import-mapping.ts:500](../../packages/server/src/import-mapping.ts#L500) `existingKeys` | `Store.viewableIds` (500); `Store.query` (502) | IMPORT |
| [packages/server/src/import-mapping.ts:762](../../packages/server/src/import-mapping.ts#L762) `applyImportRun` | `SQLite.prepare` (762); `Store.sql` (762) | IMPORT |
| [packages/server/src/import-mapping.ts:962](../../packages/server/src/import-mapping.ts#L962) `applyImportAddStream` | `SQLite.prepare` (962); `Store.sql` (962) | IMPORT |
| [packages/server/src/import-mapping.ts:779](../../packages/server/src/import-mapping.ts#L779) `targetKeys` | `SQLite.all` (779); `SQLite.prepare` (779); `Store.sql` (779) | IMPORT |
| [packages/server/src/import-mapping.ts:791](../../packages/server/src/import-mapping.ts#L791) `journal` | `Store.sql` (791, 794, 794); `SQLite.all` (794); `SQLite.prepare` (794) | IMPORT |
| [packages/server/src/import-mapping.ts:850](../../packages/server/src/import-mapping.ts#L850) `importHistory` | `SQLite.all` (850); `SQLite.prepare` (850); `Store.sql` (850) | IMPORT |
| [packages/server/src/import-mapping.ts:857](../../packages/server/src/import-mapping.ts#L857) `undoImportRun` | `SQLite.get` (857, 880); `SQLite.prepare` (857, 880, 894); `Store.sql` (857, 880, 894) | IMPORT |
| [packages/server/src/insight.ts:346](../../packages/server/src/insight.ts#L346) `webViewerScripts` | `Store.query` (346) | DESIGN |
| [packages/server/src/insight.ts:809](../../packages/server/src/insight.ts#L809) `layoutProfile/viewableIds` | `Store.viewableIds` (809) | PROFILE |
| [packages/server/src/insight.ts:813](../../packages/server/src/insight.ts#L813) `layoutProfile` | `Store.query` (813) | PROFILE |
| [packages/server/src/insight.ts:889](../../packages/server/src/insight.ts#L889) `columnProfile` | `Store.query` (889, 896, 908, 911) | PROFILE |
| [packages/server/src/insight.ts:968](../../packages/server/src/insight.ts#L968) `checkCalculation` | `Store.findIds` (968); `Store.evaluate` (972) | DESIGN |
| [packages/server/src/insight.ts:1151](../../packages/server/src/insight.ts#L1151) `solutionOverview/counts` | `Store.query` (1151) | DESIGN |
| [packages/server/src/live.ts:205](../../packages/server/src/live.ts#L205) `Live/handle` | `Store.canView` (205) | LIVE |
| [packages/server/src/live.ts:279](../../packages/server/src/live.ts#L279) `Live/visibleRecord` | `Store.canViewRecord` (279) | LIVE |
| [packages/server/src/logs.ts:77](../../packages/server/src/logs.ts#L77) `LogShipper/follow` | `SQLite.get` (77); `SQLite.prepare` (77); `Store.sql` (77, 78, 79, 80) | ADMIN |
| [packages/server/src/logs.ts:89](../../packages/server/src/logs.ts#L89) `LogShipper/releaseIfIdle` | `Store.sql` (89) | ADMIN |
| [packages/server/src/mcp-design.ts:510](../../packages/server/src/mcp-design.ts#L510) `registerDesignTools/audit_log` | `Store.auditLog` (510) | DESIGN |
| [packages/server/src/mcp.ts:969](../../packages/server/src/mcp.ts#L969) `createMcpServer/find_records` | `Store.find` (969) | MCP |
| [packages/server/src/mcp.ts:982](../../packages/server/src/mcp.ts#L982) `createMcpServer/get_record` | `Store.get` (982) | MCP |
| [packages/server/src/mcp.ts:1032](../../packages/server/src/mcp.ts#L1032) `createMcpServer/update_record` | `Store.get` (1032, 1036) | MCP |
| [packages/server/src/mcp.ts:1089](../../packages/server/src/mcp.ts#L1089) `createMcpServer/evaluate_calculation` | `Store.get` (1089, 1097); `Store.find` (1090); `Store.evaluate` (1091); `Store.row` (1096) | SQL |
| [packages/server/src/mcp.ts:1164](../../packages/server/src/mcp.ts#L1164) `createMcpServer/get_container` | `Store.container` (1164) | SQL |
| [packages/server/src/mcp.ts:1188](../../packages/server/src/mcp.ts#L1188) `createMcpServer/sql_query` | `Store.queryWithOrigins` (1188) | SQL |
| [packages/server/src/mcp.ts:1345](../../packages/server/src/mcp.ts#L1345) `createMcpServer/explain_value` | `Store.get` (1345); `Store.row` (1346) | MCP |
| [packages/server/src/mcp.ts:1368](../../packages/server/src/mcp.ts#L1368) `createMcpServer/check_record` | `Store.get` (1368); `Store.row` (1370) | MCP |
| [packages/server/src/mcp.ts:1392](../../packages/server/src/mcp.ts#L1392) `createMcpServer/explain_related` | `Store.get` (1392) | MCP |
| [packages/server/src/mcp.ts:2288](../../packages/server/src/mcp.ts#L2288) `registerResources/audit` | `Store.auditLog` (2288) | MCP |
| [packages/server/src/oauth.ts:72](../../packages/server/src/oauth.ts#L72) `storedName` | `SQLite.get` (72); `SQLite.prepare` (72); `Store.sql` (72) | AUTH |
| [packages/server/src/oauth.ts:83](../../packages/server/src/oauth.ts#L83) `legacyPasswordMark` | `SQLite.get` (83); `SQLite.prepare` (83); `Store.sql` (83) | AUTH |
| [packages/server/src/oauth.ts:184](../../packages/server/src/oauth.ts#L184) `OAuthServer/constructor/cols` | `SQLite.all` (184); `SQLite.prepare` (184) | AUTH |
| [packages/server/src/oauth.ts:191](../../packages/server/src/oauth.ts#L191) `OAuthServer/constructor` | `SQLite.all` (191); `SQLite.prepare` (191, 218, 220, 223, 224, 227); `SQLite.iterate` (218); `SQLite.get` (220); `Store.sql` (220, 223) | AUTH |
| [packages/server/src/oauth.ts:358](../../packages/server/src/oauth.ts#L358) `OAuthServer/register` | `SQLite.prepare` (358, 359, 360, 361, 362); `SQLite.get` (359, 361) | AUTH |
| [packages/server/src/oauth.ts:378](../../packages/server/src/oauth.ts#L378) `OAuthServer/client` | `SQLite.get` (378); `SQLite.prepare` (378) | AUTH |
| [packages/server/src/oauth.ts:479](../../packages/server/src/oauth.ts#L479) `OAuthServer/authorize/done` | `SQLite.prepare` (479, 480) | AUTH |
| [packages/server/src/oauth.ts:498](../../packages/server/src/oauth.ts#L498) `OAuthServer/authorize` | `SQLite.get` (498); `SQLite.prepare` (498, 502, 504, 511, 534, 535) | AUTH |
| [packages/server/src/oauth.ts:690](../../packages/server/src/oauth.ts#L690) `OAuthServer/token` | `SQLite.get` (690, 721, 723, 726, 739); `SQLite.prepare` (690, 721, 723, 726, 735, 738, 739, 739, 741, 743) | AUTH |
| [packages/server/src/oauth.ts:824](../../packages/server/src/oauth.ts#L824) `OAuthServer/sweep` | `SQLite.all` (824); `SQLite.prepare` (824, 826, 827, 828, 829) | AUTH |
| [packages/server/src/oauth.ts:878](../../packages/server/src/oauth.ts#L878) `OAuthServer/revoke` | `SQLite.get` (878, 879, 889, 890); `SQLite.prepare` (878, 879, 882, 889, 890, 894) | AUTH |
| [packages/server/src/oauth.ts:861](../../packages/server/src/oauth.ts#L861) `OAuthServer/managedAccess` | `SQLite.get` (861); `SQLite.prepare` (861) | AUTH |
| [packages/server/src/oauth.ts:865](../../packages/server/src/oauth.ts#L865) `OAuthServer/accessAllowed` | `SQLite.get` (865); `SQLite.prepare` (865) | AUTH |
| [packages/server/src/odata-crossjoin-worker.ts:40](../../packages/server/src/odata-crossjoin-worker.ts#L40) `join` | `SQLite.prepare` (40, 49, 58, 73); `SQLite.get` (58); `SQLite.all` (73) | JOIN |
| [packages/server/src/odata.ts:931](../../packages/server/src/odata.ts#L931) `ODataEndpoint/resource` | `Store.countIds` (931); `Store.get` (971, 978, 1085) | ODATA |
| [packages/server/src/odata.ts:1217](../../packages/server/src/odata.ts#L1217) `ODataEndpoint/lambdaFor` | `Store.selectIds` (1217); `Store.row` (1226); `relatedIdList` (1227) | ODATA |
| [packages/server/src/odata.ts:1280](../../packages/server/src/odata.ts#L1280) `ODataEndpoint/list` | `Store.selectIds` (1280); `Store.getMany` (1285); `Store.computeValues` (1286); `Store.countIds` (1291) | ODATA |
| [packages/server/src/odata.ts:1338](../../packages/server/src/odata.ts#L1338) `ODataEndpoint/applied` | `Store.selectIds` (1338); `SQLite.prepare` (1353, 1390, 1403, 1407); `Store.getMany` (1364); `SQLite.all` (1403); `SQLite.get` (1407) | ODATA |
| [packages/server/src/odata.ts:1457](../../packages/server/src/odata.ts#L1457) `ODataEndpoint/crossjoined` | `Store.selectIds` (1457); `Store.getMany` (1486, 1521) | ODATA |
| [packages/server/src/odata.ts:1557](../../packages/server/src/odata.ts#L1557) `ODataEndpoint/entity` | `Store.getMany` (1557) | ODATA |
| [packages/server/src/odata.ts:1589](../../packages/server/src/odata.ts#L1589) `ODataEndpoint/relatedIds` | `Store.row` (1589); `relatedIdList` (1592, 1607); `Store.selectIds` (1596); `Store.viewableIds` (1606) | ODATA |
| [packages/server/src/odata.ts:1615](../../packages/server/src/odata.ts#L1615) `ODataEndpoint/relatedRecords` | `Store.getMany` (1615) | ODATA |
| [packages/server/src/odata.ts:1639](../../packages/server/src/odata.ts#L1639) `ODataEndpoint/property` | `Store.containerId` (1639); `Store.container` (1645) | ODATA |
| [packages/server/src/oidc.ts:188](../../packages/server/src/oidc.ts#L188) `Oidc/constructor` | `SQLite.all` (188, 196); `SQLite.prepare` (188, 196, 206, 207, 212, 212) | AUTH |
| [packages/server/src/oidc.ts:341](../../packages/server/src/oidc.ts#L341) `Oidc/takeGrant` | `SQLite.all` (341); `SQLite.prepare` (341) | AUTH |
| [packages/server/src/oidc.ts:392](../../packages/server/src/oidc.ts#L392) `Oidc/authorizeUrl` | `SQLite.prepare` (392, 393, 396); `SQLite.get` (393) | AUTH |
| [packages/server/src/oidc.ts:444](../../packages/server/src/oidc.ts#L444) `Oidc/callback` | `SQLite.all` (444); `SQLite.prepare` (444, 448) | AUTH |
| [packages/server/src/oidc.ts:546](../../packages/server/src/oidc.ts#L546) `Oidc/finish` | `SQLite.prepare` (546, 547, 549); `SQLite.get` (547) | AUTH |
| [packages/server/src/optimization-containers.ts:45](../../packages/server/src/optimization-containers.ts#L45) `read` | `SQLite.get` (45); `SQLite.prepare` (45); `Store.sql` (45) | DESIGN |
| [packages/server/src/optimization-containers.ts:56](../../packages/server/src/optimization-containers.ts#L56) `write` | `SQLite.prepare` (56); `Store.sql` (56) | DESIGN |
| [packages/server/src/optimization-containers.ts:146](../../packages/server/src/optimization-containers.ts#L146) `undoContainerMove` | `SQLite.prepare` (146); `Store.sql` (146); `SQLite.get` (147) | DESIGN |
| [packages/server/src/optimization-containers.ts:77](../../packages/server/src/optimization-containers.ts#L77) `planContainerMove` | `Store.embeddedContainerCount` (77) | DESIGN |
| [packages/server/src/optimization-data.ts:46](../../packages/server/src/optimization-data.ts#L46) `held` | `SQLite.get` (46); `SQLite.prepare` (46); `Store.sql` (46) | DESIGN |
| [packages/server/src/optimization-data.ts:61](../../packages/server/src/optimization-data.ts#L61) `dataFindings` | `Store.recordCount` (61) | DESIGN |
| [packages/server/src/optimization-data.ts:113](../../packages/server/src/optimization-data.ts#L113) `layoutFindings` | `Store.recordCount` (113) | DESIGN |
| [packages/server/src/optimization-fix.ts:150](../../packages/server/src/optimization-fix.ts#L150) `history` | `SQLite.get` (150); `SQLite.prepare` (150); `Store.sql` (150) | DESIGN |
| [packages/server/src/optimization-fix.ts:154](../../packages/server/src/optimization-fix.ts#L154) `keep` | `SQLite.prepare` (154); `Store.sql` (154) | DESIGN |
| [packages/server/src/optimization-fix.ts:158](../../packages/server/src/optimization-fix.ts#L158) `withHistory` | `Store.sql` (158, 161, 164, 164) | DESIGN |
| [packages/server/src/optimization.ts:120](../../packages/server/src/optimization.ts#L120) `hasTable` | `SQLite.get` (120); `SQLite.prepare` (120); `Store.sql` (120) | DESIGN |
| [packages/server/src/optimization.ts:141](../../packages/server/src/optimization.ts#L141) `containerUse` | `SQLite.get` (141); `SQLite.prepare` (141); `Store.sql` (141) | DESIGN |
| [packages/server/src/optimization.ts:269](../../packages/server/src/optimization.ts#L269) `oversizedPictures` | `SQLite.all` (269); `SQLite.prepare` (269); `Store.sql` (269) | DESIGN |
| [packages/server/src/optimization.ts:312](../../packages/server/src/optimization.ts#L312) `sizes/one` | `SQLite.get` (312); `SQLite.prepare` (312); `Store.sql` (312) | DESIGN |
| [packages/server/src/optimization.ts:316](../../packages/server/src/optimization.ts#L316) `sizes` | `SQLite.all` (316); `SQLite.prepare` (316); `Store.sql` (316) | DESIGN |
| [packages/server/src/optimization.ts:449](../../packages/server/src/optimization.ts#L449) `speedFindings` | `Store.recordCount` (449, 492, 510) | DESIGN |
| [packages/server/src/optimization.ts:564](../../packages/server/src/optimization.ts#L564) `heldBytes` | `SQLite.get` (564); `SQLite.prepare` (564); `Store.sql` (564) | DESIGN |
| [packages/server/src/pgwire.ts:772](../../packages/server/src/pgwire.ts#L772) `Connection/translate` | `Calculations.translateSQL` (772) | SQL |
| [packages/server/src/pgwire.ts:800](../../packages/server/src/pgwire.ts#L800) `Connection/catalog` | `Store.describe` (800) | SQL |
| [packages/server/src/pgwire.ts:811](../../packages/server/src/pgwire.ts#L811) `Connection/run` | `Store.selectIn` (811) | SQL |
| [packages/server/src/pgwire.ts:938](../../packages/server/src/pgwire.ts#L938) `Connection/validateSyntax` | `SQLite.prepare` (938); `Store.sql` (938) | SQL |
| [packages/server/src/pgwire.ts:1157](../../packages/server/src/pgwire.ts#L1157) `Connection/describe` | `Store.describe` (1157) | SQL |
| [packages/server/src/pgwrite.ts:404](../../packages/server/src/pgwrite.ts#L404) `returningColumns` | `Store.describe` (404) | SQL |
| [packages/server/src/pgwrite.ts:431](../../packages/server/src/pgwrite.ts#L431) `executeWrite/reader` | `Store.selectIn` (431) | SQL |
| [packages/server/src/pii.ts:122](../../packages/server/src/pii.ts#L122) `holdsOnlyUuids` | `Store.query` (122) | REDACTION |
| [packages/server/src/pii.ts:134](../../packages/server/src/pii.ts#L134) `sampledValues` | `Store.query` (134) | REDACTION |
| [packages/server/src/pii.ts:301](../../packages/server/src/pii.ts#L301) `vaultTable` | `Store.sql` (301, 304) | REDACTION |
| [packages/server/src/pii.ts:310](../../packages/server/src/pii.ts#L310) `forgetVault` | `Store.sql` (310) | REDACTION |
| [packages/server/src/pii.ts:349](../../packages/server/src/pii.ts#L349) `PiiMasker/constructor` | `SQLite.get` (349); `SQLite.prepare` (349); `Store.sql` (349) | REDACTION |
| [packages/server/src/pii.ts:359](../../packages/server/src/pii.ts#L359) `PiiMasker/refresh` | `SQLite.iterate` (359); `SQLite.prepare` (359); `Store.sql` (359) | REDACTION |
| [packages/server/src/pii.ts:402](../../packages/server/src/pii.ts#L402) `PiiMasker/token` | `SQLite.prepare` (402, 403); `Store.sql` (402, 403); `SQLite.get` (403) | REDACTION |
| [packages/server/src/pii.ts:655](../../packages/server/src/pii.ts#L655) `piiPreview` | `Store.find` (655); `SQLite.prepare` (662); `Store.sql` (662) | REDACTION |
| [packages/server/src/pii.ts:417](../../packages/server/src/pii.ts#L417) `PiiMasker/text` | `SQLite.get` (417); `SQLite.prepare` (417); `Store.sql` (417) | REDACTION |
| [packages/server/src/pii.ts:445](../../packages/server/src/pii.ts#L445) `PiiMasker/known` | `SQLite.iterate` (445); `SQLite.prepare` (445); `Store.sql` (445) | REDACTION |
| [packages/server/src/pii.ts:486](../../packages/server/src/pii.ts#L486) `PiiMasker/unmask` | `SQLite.get` (486); `SQLite.prepare` (486); `Store.sql` (486) | REDACTION |
| [packages/server/src/privilege-review.ts:274](../../packages/server/src/privilege-review.ts#L274) `reviewPrivileges` | `Store.previewRecordRule` (274) | DESIGN |
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
| [packages/server/src/record-context.ts:112](../../packages/server/src/record-context.ts#L112) `describeRecord` | `Store.row` (112); `Store.get` (121); `keyValue` (127); `Store.viewableIds` (165); `relatedRows` (169, 174) | RECORD |
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
| [packages/server/src/script-failure.ts:212](../../packages/server/src/script-failure.ts#L212) `explainScriptFailure` | `Store.row` (212) | RECORD |
| [packages/server/src/security.ts:80](../../packages/server/src/security.ts#L80) `importApproximations` | `SQLite.all` (80); `SQLite.prepare` (80); `Store.sql` (80) | DESIGN |
| [packages/server/src/security.ts:116](../../packages/server/src/security.ts#L116) `securityOf` | `Store.pendingChanges` (116) | DESIGN |
| [packages/server/src/security.ts:212](../../packages/server/src/security.ts#L212) `SecurityApi/handle` | `Store.previewRecordRule` (212) | DESIGN |
| [packages/server/src/semantic-find.ts:52](../../packages/server/src/semantic-find.ts#L52) `semanticFind` | `Store.findIds` (52) | SEARCH |
| [packages/server/src/semantic-find.ts:108](../../packages/server/src/semantic-find.ts#L108) `vectorOf` | `Store.containerId` (108); `Store.containerInfo` (110); `Store.container` (112); `Store.get` (117) | SEARCH |
| [packages/server/src/sql.ts:101](../../packages/server/src/sql.ts#L101) `SqlEndpoint/handle` | `Calculations.translateSQL` (101); `Store.select` (106) | SQL |
| [packages/server/src/sql.ts:159](../../packages/server/src/sql.ts#L159) `SqlEndpoint/tables` | `SQLite.all` (159); `SQLite.prepare` (159); `Store.sql` (159) | SQL |
| [packages/server/src/standby.ts:281](../../packages/server/src/standby.ts#L281) `Standby/copy` | `SQLite.get` (281); `SQLite.prepare` (281) | OPERATOR |
| [packages/server/src/summarize.ts:69](../../packages/server/src/summarize.ts#L69) `summarizeRecords` | `Store.findIds` (69); `Store.select` (126, 133, 143) | SUMMARY |
| [packages/server/src/summarize.ts:184](../../packages/server/src/summarize.ts#L184) `summarizeByRecord` | `Store.evaluateEach` (184); `Store.row` (186) | SUMMARY |
| [packages/server/src/sync-console.ts:458](../../packages/server/src/sync-console.ts#L458) `SyncConsole/runCheck` | `Store.sql` (458) | DESIGN |
| [packages/server/src/sync-console.ts:463](../../packages/server/src/sync-console.ts#L463) `SyncConsole/runCheck/assertActive` | `Store.sql` (463) | DESIGN |
| [packages/server/src/warm-worker.ts:19](../../packages/server/src/warm-worker.ts#L19) `message/count` | `Store.recordCount` (19) | INTERNAL |
| [packages/server/src/warm-worker.ts:34](../../packages/server/src/warm-worker.ts#L34) `message` | `Store.find` (34) | INTERNAL |
| [packages/server/src/webclient.ts:500](../../packages/server/src/webclient.ts#L500) `WebClient/history` | `Store.get` (500) | WEB |
| [packages/server/src/webclient.ts:637](../../packages/server/src/webclient.ts#L637) `WebClient/explain` | `Store.get` (637); `Store.row` (670, 683) | WEB |
| [packages/server/src/webclient.ts:696](../../packages/server/src/webclient.ts#L696) `WebClient/index` | `Store.fieldIndex` (696) | WEB |
| [packages/server/src/webclient.ts:786](../../packages/server/src/webclient.ts#L786) `WebClient/menus` | `Store.evaluateEach` (786) | WEB |
| [packages/server/src/webclient.ts:1002](../../packages/server/src/webclient.ts#L1002) `WebClient/view` | `Store.evaluateEach` (1002, 1026, 1045); `Store.canView` (1020); `Store.previewRow` (1024, 1046); `Store.get` (1037); `Store.row` (1038, 1038) | WEB |
| [packages/server/src/webclient.ts:1023](../../packages/server/src/webclient.ts#L1023) `WebClient/view/get` | `Store.get` (1023) | WEB |
| [packages/server/src/webclient.ts:1088](../../packages/server/src/webclient.ts#L1088) `WebClient/refresh` | `Store.previewRow` (1088); `Store.getMany` (1093); `Store.foundSetRows` (1115) | WEB |
| [packages/server/src/webclient.ts:1127](../../packages/server/src/webclient.ts#L1127) `WebClient/foundIds` | `Store.findIds` (1127) | WEB |
| [packages/server/src/webclient.ts:1142](../../packages/server/src/webclient.ts#L1142) `WebClient/records` | `Store.getMany` (1142); `Store.find` (1145) | WEB |
| [packages/server/src/webclient.ts:1171](../../packages/server/src/webclient.ts#L1171) `WebClient/foundSetPortal` | `Store.foundSetRows` (1171, 1178) | WEB |
| [packages/server/src/webclient.ts:1211](../../packages/server/src/webclient.ts#L1211) `WebClient/charts/foundSet` | `Store.findIds` (1211) | WEB |
| [packages/server/src/webclient.ts:1220](../../packages/server/src/webclient.ts#L1220) `WebClient/charts` | `Calculations.context` (1220); `Store.canView` (1248); `Store.evaluateEach` (1257, 1261); `Store.evaluateRows` (1266, 1268) | WEB |
| [packages/server/src/webclient.ts:1251](../../packages/server/src/webclient.ts#L1251) `WebClient/charts/get` | `Store.get` (1251) | WEB |
| [packages/server/src/webclient.ts:1440](../../packages/server/src/webclient.ts#L1440) `WebClient/exportRecords` | `Store.getMany` (1440) | WEB |
| [packages/server/src/webclient.ts:1334](../../packages/server/src/webclient.ts#L1334) `WebClient/streamExportRecords/nextBatch` | `Store.selectIds` (1334); `Store.getMany` (1340) | WEB |
| [packages/server/src/webclient.ts:1634](../../packages/server/src/webclient.ts#L1634) `WebClient/aiReplace` | `Store.canView` (1634); `Store.getMany` (1650) | WEB |
| [packages/server/src/webclient.ts:1710](../../packages/server/src/webclient.ts#L1710) `WebClient/groups` | `Store.findIds` (1710); `Store.groupSummaries` (1716) | WEB |
| [packages/server/src/webclient.ts:1818](../../packages/server/src/webclient.ts#L1818) `WebClient/button` | `Store.findIds` (1818, 1868); `Store.evaluateEach` (1827, 1828) | WEB |
| [packages/server/src/webclient.ts:2512](../../packages/server/src/webclient.ts#L2512) `listItems` | `Store.valueListItems` (2512) | WEB |
| [packages/server/src/webclient.ts:2591](../../packages/server/src/webclient.ts#L2591) `foundIds` | `Store.findIds` (2591, 2593) | WEB |
| [packages/store/src/activity.ts:374](../../packages/store/src/activity.ts#L374) `SharedRecordLocks/constructor` | `SQLite.get` (374); `SQLite.prepare` (374) | CORE |
| [packages/store/src/activity.ts:405](../../packages/store/src/activity.ts#L405) `SharedRecordLocks/count` | `SQLite.get` (405); `SQLite.prepare` (405) | CORE |
| [packages/store/src/activity.ts:409](../../packages/store/src/activity.ts#L409) `SharedRecordLocks/sweep` | `SQLite.prepare` (409) | CORE |
| [packages/store/src/activity.ts:417](../../packages/store/src/activity.ts#L417) `SharedRecordLocks/holder` | `SQLite.get` (417); `SQLite.prepare` (417) | CORE |
| [packages/store/src/activity.ts:432](../../packages/store/src/activity.ts#L432) `SharedRecordLocks/acquire` | `SQLite.prepare` (432) | CORE |
| [packages/store/src/activity.ts:446](../../packages/store/src/activity.ts#L446) `SharedRecordLocks/renew` | `SQLite.prepare` (446) | CORE |
| [packages/store/src/activity.ts:460](../../packages/store/src/activity.ts#L460) `SharedRecordLocks/release` | `SQLite.prepare` (460) | CORE |
| [packages/store/src/activity.ts:464](../../packages/store/src/activity.ts#L464) `SharedRecordLocks/releaseOwner` | `SQLite.all` (464); `SQLite.prepare` (464) | CORE |
| [packages/store/src/activity.ts:470](../../packages/store/src/activity.ts#L470) `SharedRecordLocks/all` | `SQLite.all` (470); `SQLite.prepare` (470) | CORE |
| [packages/store/src/activity.ts:474](../../packages/store/src/activity.ts#L474) `SharedRecordLocks/view` | `SQLite.get` (474); `SQLite.prepare` (474, 475) | CORE |
| [packages/store/src/activity.ts:480](../../packages/store/src/activity.ts#L480) `SharedRecordLocks/leave` | `SQLite.prepare` (480) | CORE |
| [packages/store/src/activity.ts:484](../../packages/store/src/activity.ts#L484) `SharedRecordLocks/leaveOwner` | `SQLite.all` (484); `SQLite.prepare` (484) | CORE |
| [packages/store/src/activity.ts:488](../../packages/store/src/activity.ts#L488) `SharedRecordLocks/viewers` | `SQLite.prepare` (488, 489); `SQLite.all` (489) | CORE |
| [packages/store/src/audit-anchor.ts:68](../../packages/store/src/audit-anchor.ts#L68) `checkAnchor` | `SQLite.get` (68, 70, 73); `SQLite.prepare` (68, 70, 73) | CORE |
| [packages/store/src/cache-versions.ts:11](../../packages/store/src/cache-versions.ts#L11) `ensureCacheVersions` | `SQLite.get` (11); `SQLite.prepare` (11) | CORE |
| [packages/store/src/calc.ts:340](../../packages/store/src/calc.ts#L340) `Calculations/meta` | `SQLite.get` (340); `SQLite.prepare` (340); `Store.sql` (340) | CALC |
| [packages/store/src/calc.ts:345](../../packages/store/src/calc.ts#L345) `Calculations/saveMeta` | `SQLite.prepare` (345); `Store.sql` (345) | CALC |
| [packages/store/src/calc.ts:358](../../packages/store/src/calc.ts#L358) `Calculations/globalValue` | `SQLite.get` (358); `SQLite.prepare` (358); `Store.sql` (358) | CALC |
| [packages/store/src/calc.ts:382](../../packages/store/src/calc.ts#L382) `Calculations/setNextSerial` | `Store.sql` (382, 383, 389, 391, 391) | CALC |
| [packages/store/src/calc.ts:530](../../packages/store/src/calc.ts#L530) `Calculations/value` | `Calculations.globalValue` (530) | CALC |
| [packages/store/src/calc.ts:565](../../packages/store/src/calc.ts#L565) `Calculations/computed` | `Calculations.context` (565) | CALC |
| [packages/store/src/calc.ts:580](../../packages/store/src/calc.ts#L580) `Calculations/unstoredValue` | `Calculations.unstoredStyled` (580); `Calculations.value` (580) | CALC |
| [packages/store/src/calc.ts:618](../../packages/store/src/calc.ts#L618) `Calculations/allRecords` | `SQLite.iterate` (618); `SQLite.prepare` (618); `Store.sql` (618) | CALC |
| [packages/store/src/calc.ts:629](../../packages/store/src/calc.ts#L629) `Calculations/collect` | `Calculations.collector` (629) | CALC |
| [packages/store/src/calc.ts:636](../../packages/store/src/calc.ts#L636) `Calculations/summaryInput` | `Calculations.value` (636) | CALC |
| [packages/store/src/calc.ts:660](../../packages/store/src/calc.ts#L660) `Calculations/collector/add` | `Calculations.related` (660) | CALC |
| [packages/store/src/calc.ts:673](../../packages/store/src/calc.ts#L673) `Calculations/foundSummary` | `Calculations.collect` (673) | CALC |
| [packages/store/src/calc.ts:684](../../packages/store/src/calc.ts#L684) `Calculations/summary` | `Calculations.collect` (684) | CALC |
| [packages/store/src/calc.ts:691](../../packages/store/src/calc.ts#L691) `Calculations/tableSummary` | `Calculations.wholeTable` (691) | CALC |
| [packages/store/src/calc.ts:746](../../packages/store/src/calc.ts#L746) `Calculations/globalsKey` | `Calculations.globalValue` (746) | CALC |
| [packages/store/src/calc.ts:921](../../packages/store/src/calc.ts#L921) `Calculations/summaryDependencies` | `Store.sql` (921) | CALC |
| [packages/store/src/calc.ts:960](../../packages/store/src/calc.ts#L960) `Calculations/wholeTable` | `rowsById` (960); `Store.viewableIds` (960); `Calculations.collect` (962, 1052); `Calculations.value` (1023); `Store.sql` (1031, 1039) | CALC |
| [packages/store/src/calc.ts:1213](../../packages/store/src/calc.ts#L1213) `Calculations/applyDelta/value` | `Calculations.value` (1213) | CALC |
| [packages/store/src/calc.ts:1285](../../packages/store/src/calc.ts#L1285) `Calculations/storedRows` | `SQLite.iterate` (1285); `SQLite.prepare` (1285); `Store.sql` (1285) | CALC |
| [packages/store/src/calc.ts:1337](../../packages/store/src/calc.ts#L1337) `Calculations/relatedRecs` | `Calculations.relatedIds` (1337); `Store.viewableIds` (1342); `rowsById` (1348) | CALC |
| [packages/store/src/calc.ts:1359](../../packages/store/src/calc.ts#L1359) `Calculations/firstRelated` | `Calculations.related` (1359, 1371, 1386); `Store.viewableIds` (1366); `Calculations.relatedIds` (1369, 1382); `Calculations.statement` (1379); `SQLite.get` (1379) | CALC |
| [packages/store/src/calc.ts:1393](../../packages/store/src/calc.ts#L1393) `Calculations/rowById` | `Calculations.statement` (1393); `SQLite.get` (1393) | CALC |
| [packages/store/src/calc.ts:1404](../../packages/store/src/calc.ts#L1404) `Calculations/relatedIds` | `Calculations.related` (1404, 1434, 1448); `rowsById` (1418, 1445); `Calculations.statement` (1429); `SQLite.all` (1429) | CALC |
| [packages/store/src/calc.ts:1511](../../packages/store/src/calc.ts#L1511) `Calculations/joinHop` | `Calculations.statement` (1511, 1513); `SQLite.get` (1511); `SQLite.iterate` (1513) | CALC |
| [packages/store/src/calc.ts:1540](../../packages/store/src/calc.ts#L1540) `Calculations/storedRelatedValues` | `Calculations.statement` (1540); `SQLite.iterate` (1540) | CALC |
| [packages/store/src/calc.ts:1559](../../packages/store/src/calc.ts#L1559) `Calculations/passStamp` | `Store.sql` (1559) | CALC |
| [packages/store/src/calc.ts:1569](../../packages/store/src/calc.ts#L1569) `Calculations/lookup` | `Store.sql` (1569) | CALC |
| [packages/store/src/calc.ts:1608](../../packages/store/src/calc.ts#L1608) `Calculations/foundSums` | `Store.sql` (1608) | CALC |
| [packages/store/src/calc.ts:1671](../../packages/store/src/calc.ts#L1671) `Calculations/hopQuery` | `Calculations.value` (1671) | CALC |
| [packages/store/src/calc.ts:1693](../../packages/store/src/calc.ts#L1693) `Calculations/columnNames` | `SQLite.all` (1693); `SQLite.prepare` (1693); `Store.sql` (1693) | CALC |
| [packages/store/src/calc.ts:1704](../../packages/store/src/calc.ts#L1704) `Calculations/statement` | `SQLite.prepare` (1704); `Store.sql` (1704) | CALC |
| [packages/store/src/calc.ts:1718](../../packages/store/src/calc.ts#L1718) `Calculations/ensureIndex` | `Store.sql` (1718, 1719) | CALC |
| [packages/store/src/calc.ts:1744](../../packages/store/src/calc.ts#L1744) `Calculations/context/records` | `Calculations.firstRelated` (1744) | CALC |
| [packages/store/src/calc.ts:1762](../../packages/store/src/calc.ts#L1762) `Calculations/context/field` | `Calculations.summary` (1762); `Calculations.globalValue` (1765); `Calculations.value` (1766) | CALC |
| [packages/store/src/calc.ts:1775](../../packages/store/src/calc.ts#L1775) `Calculations/context/related` | `Calculations.globalValue` (1775); `Calculations.value` (1777, 1788); `Calculations.related` (1790) | CALC |
| [packages/store/src/calc.ts:1810](../../packages/store/src/calc.ts#L1810) `Calculations/context/lookupNext` | `Store.canViewRecord` (1810) | CALC |
| [packages/store/src/calc.ts:1825](../../packages/store/src/calc.ts#L1825) `Calculations/context/summary` | `Calculations.value` (1825, 1835); `Calculations.related` (1837); `Calculations.summary` (1855) | CALC |
| [packages/store/src/calc.ts:1887](../../packages/store/src/calc.ts#L1887) `Calculations/context/get` | `Store.recordCount` (1887, 1894); `Calculations.statement` (1892); `SQLite.get` (1892) | CALC |
| [packages/store/src/calc.ts:1913](../../packages/store/src/calc.ts#L1913) `Calculations/context/executeSQL` | `Calculations.executeSQL` (1913) | CALC |
| [packages/store/src/calc.ts:1914](../../packages/store/src/calc.ts#L1914) `Calculations/context/persistentData` | `Store.persistentData` (1914) | CALC |
| [packages/store/src/calc.ts:1915](../../packages/store/src/calc.ts#L1915) `Calculations/context/persistentDataIds` | `Store.persistentDataIds` (1915) | CALC |
| [packages/store/src/calc.ts:1940](../../packages/store/src/calc.ts#L1940) `Calculations/design` | `Store.valueListItems` (1940) | CALC |
| [packages/store/src/calc.ts:1957](../../packages/store/src/calc.ts#L1957) `Calculations/executeSQL` | `Calculations.translateSQL` (1957); `Store.select` (1995); `Store.sql` (2006) | CALC |
| [packages/store/src/calc.ts:2112](../../packages/store/src/calc.ts#L2112) `Calculations/translateSQL` | `Store.scopedTableSql` (2112, 2144) | CALC |
| [packages/store/src/calc.ts:2176](../../packages/store/src/calc.ts#L2176) `Calculations/shareColumn` | `Store.recordCount` (2176) | CALC |
| [packages/store/src/calc.ts:2208](../../packages/store/src/calc.ts#L2208) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2208) | CALC |
| [packages/store/src/calc.ts:2245](../../packages/store/src/calc.ts#L2245) `Calculations/computeColumn` | `Calculations.statement` (2245); `SQLite.get` (2245); `Calculations.value` (2248) | CALC |
| [packages/store/src/calc.ts:2382](../../packages/store/src/calc.ts#L2382) `Calculations/beforeWrite` | `relatedRows` (2382); `Calculations.related` (2436); `Calculations.context` (2449) | CORE |
| [packages/store/src/calc.ts:2500](../../packages/store/src/calc.ts#L2500) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2500); `Calculations.value` (2500) | CALC |
| [packages/store/src/calc.ts:2515](../../packages/store/src/calc.ts#L2515) `Calculations/computeStoredStyled` | `Calculations.context` (2515) | CORE |
| [packages/store/src/calc.ts:2555](../../packages/store/src/calc.ts#L2555) `Calculations/validate/fail` | `Calculations.context` (2555) | CALC |
| [packages/store/src/calc.ts:2569](../../packages/store/src/calc.ts#L2569) `Calculations/validate` | `Calculations.value` (2569); `Store.valueListItems` (2590); `Calculations.context` (2604) | CALC |
| [packages/store/src/calc.ts:2666](../../packages/store/src/calc.ts#L2666) `nearest` | `SQLite.get` (2666); `SQLite.prepare` (2666); `Store.sql` (2666) | CALC |
| [packages/store/src/calc.ts:2751](../../packages/store/src/calc.ts#L2751) `containerValue` | `Store.containerInfo` (2751); `Store.containerRange` (2758); `Store.container` (2759) | CALC |
| [packages/store/src/calc.ts:2767](../../packages/store/src/calc.ts#L2767) `containerValue/read` | `Store.container` (2767) | CALC |
| [packages/store/src/calc.ts:2780](../../packages/store/src/calc.ts#L2780) `containerValue/value` | `Store.containerRange` (2780) | CALC |
| [packages/store/src/calc.ts:2898](../../packages/store/src/calc.ts#L2898) `sameValuesElsewhere` | `SQLite.all` (2898); `SQLite.prepare` (2898, 2905, 2907); `Store.sql` (2898, 2905, 2907); `Calculations.value` (2900); `SQLite.get` (2905, 2907) | CALC |
| [packages/store/src/calc.ts:3211](../../packages/store/src/calc.ts#L3211) `rowsById/flush` | `Calculations.statement` (3211); `SQLite.iterate` (3211) | CALC |
| [packages/store/src/damage.ts:93](../../packages/store/src/damage.ts#L93) `watchDatabase` | `SQLite.prepare` (93); `SQLite.iterate` (103) | CORE |
| [packages/store/src/explain-related.ts:103](../../packages/store/src/explain-related.ts#L103) `explainRelated` | `Store.row` (103); `Store.get` (193); `Calculations.value` (242); `Calculations.context` (250) | RECORD |
| [packages/store/src/explain-related.ts:183](../../packages/store/src/explain-related.ts#L183) `explainRelated/runFilter` | `Calculations.context` (183) | RECORD |
| [packages/store/src/explain-related.ts:301](../../packages/store/src/explain-related.ts#L301) `explainHop` | `keyValue` (301); `SQLite.get` (321); `SQLite.prepare` (321, 335); `Store.sql` (321, 335); `SQLite.all` (335) | RECORD |
| [packages/store/src/explain-related.ts:364](../../packages/store/src/explain-related.ts#L364) `explainCandidate` | `SQLite.get` (364, 378); `SQLite.prepare` (364, 378); `Store.sql` (364, 378); `keyValue` (375); `Calculations.context` (383) | RECORD |
| [packages/store/src/explain.ts:144](../../packages/store/src/explain.ts#L144) `explainField` | `Calculations.value` (144); `Calculations.context` (173) | RECORD |
| [packages/store/src/explain.ts:392](../../packages/store/src/explain.ts#L392) `lintFormula` | `Calculations.context` (392) | RECORD |
| [packages/store/src/export-sql.ts:230](../../packages/store/src/export-sql.ts#L230) `exportSql` | `Store.scopedTableSql` (230); `Store.select` (231, 364); `Store.container` (435) | OPERATOR |
| [packages/store/src/export-sql.ts:256](../../packages/store/src/export-sql.ts#L256) `exportSql/page` | `Store.select` (256) | OPERATOR |
| [packages/store/src/export-sql.ts:306](../../packages/store/src/export-sql.ts#L306) `exportSql/duplicates` | `Store.select` (306) | OPERATOR |
| [packages/store/src/fidelity.ts:176](../../packages/store/src/fidelity.ts#L176) `changedAfter` | `Untyped.executeSQL` (176) | DESIGN |
| [packages/store/src/fidelity.ts:196](../../packages/store/src/fidelity.ts#L196) `queryProblem` | `Calculations.translateSQL` (196); `Store.describe` (197) | DESIGN |
| [packages/store/src/fidelity.ts:214](../../packages/store/src/fidelity.ts#L214) `calcFidelity` | `Calculations.executeSQL` (214, 215, 301); `Store.sql` (219, 227, 300); `SQLite.all` (227); `SQLite.prepare` (227); `Calculations.computeStored` (263) | DESIGN |
| [packages/store/src/foreign-keys.ts:165](../../packages/store/src/foreign-keys.ts#L165) `parentHas` | `SQLite.get` (165) | CORE |
| [packages/store/src/foreign-keys.ts:172](../../packages/store/src/foreign-keys.ts#L172) `childIds` | `SQLite.all` (172) | CORE |
| [packages/store/src/foreign-keys.ts:179](../../packages/store/src/foreign-keys.ts#L179) `childrenWithKeys` | `SQLite.all` (179) | CORE |
| [packages/store/src/foreign-keys.ts:188](../../packages/store/src/foreign-keys.ts#L188) `orphans` | `SQLite.get` (188); `SQLite.all` (189) | CORE |
| [packages/store/src/fmexport.ts:236](../../packages/store/src/fmexport.ts#L236) `fmExport` | `Store.recordCount` (236); `Store.query` (237); `Store.containerInfo` (252); `Store.container` (259) | OPERATOR |
| [packages/store/src/import.ts:92](../../packages/store/src/import.ts#L92) `addExternalSizeColumn` | `SQLite.all` (92); `SQLite.prepare` (92) | OPERATOR |
| [packages/store/src/import.ts:104](../../packages/store/src/import.ts#L104) `writeDesign` | `SQLite.prepare` (104, 108) | OPERATOR |
| [packages/store/src/import.ts:122](../../packages/store/src/import.ts#L122) `importDesigns` | `SQLite.all` (122); `SQLite.prepare` (122, 136, 139, 142, 144); `SQLite.get` (136, 139) | OPERATOR |
| [packages/store/src/import.ts:162](../../packages/store/src/import.ts#L162) `applyFileAccountStatus` | `SQLite.get` (162, 164); `SQLite.prepare` (162, 164, 166, 178) | OPERATOR |
| [packages/store/src/import.ts:199](../../packages/store/src/import.ts#L199) `createStore` | `SQLite.prepare` (199, 210) | OPERATOR |
| [packages/store/src/import.ts:222](../../packages/store/src/import.ts#L222) `needsDesigns` | `SQLite.get` (222); `SQLite.prepare` (222) | OPERATOR |
| [packages/store/src/import.ts:269](../../packages/store/src/import.ts#L269) `readState` | `SQLite.get` (269); `SQLite.prepare` (269) | OPERATOR |
| [packages/store/src/import.ts:319](../../packages/store/src/import.ts#L319) `importFmp12/save` | `SQLite.prepare` (319) | OPERATOR |
| [packages/store/src/import.ts:328](../../packages/store/src/import.ts#L328) `importFmp12` | `SQLite.prepare` (328, 338, 344, 350, 354, 369, 380, 455, 456); `SQLite.get` (344, 369); `SQLite.all` (350) | OPERATOR |
| [packages/store/src/layout-speed.ts:56](../../packages/store/src/layout-speed.ts#L56) `layoutCost/recordCount` | `Store.recordCount` (56) | DESIGN |
| [packages/store/src/layout-speed.ts:419](../../packages/store/src/layout-speed.ts#L419) `speedContext` | `Store.recordCount` (419) | DESIGN |
| [packages/store/src/privileges.ts:519](../../packages/store/src/privileges.ts#L519) `privilegeSets` | `SQLite.all` (519); `SQLite.prepare` (519) | AUTH |
| [packages/store/src/privileges.ts:547](../../packages/store/src/privileges.ts#L547) `ensurePrivilegeTables` | `SQLite.all` (547); `SQLite.prepare` (547) | AUTH |
| [packages/store/src/reconvert.ts:99](../../packages/store/src/reconvert.ts#L99) `meta` | `SQLite.get` (99); `SQLite.prepare` (99) | OPERATOR |
| [packages/store/src/reconvert.ts:104](../../packages/store/src/reconvert.ts#L104) `tableExists` | `SQLite.get` (104); `SQLite.prepare` (104) | OPERATOR |
| [packages/store/src/reconvert.ts:108](../../packages/store/src/reconvert.ts#L108) `columns` | `SQLite.all` (108); `SQLite.prepare` (108) | OPERATOR |
| [packages/store/src/reconvert.ts:121](../../packages/store/src/reconvert.ts#L121) `reconvertCheck` | `SQLite.get` (121); `SQLite.prepare` (121) | OPERATOR |
| [packages/store/src/reconvert.ts:196](../../packages/store/src/reconvert.ts#L196) `build` | `SQLite.get` (196); `SQLite.prepare` (196, 199, 204); `SQLite.all` (204) | OPERATOR |
| [packages/store/src/reconvert.ts:231](../../packages/store/src/reconvert.ts#L231) `previewOf/count` | `SQLite.get` (231); `SQLite.prepare` (231) | OPERATOR |
| [packages/store/src/reconvert.ts:244](../../packages/store/src/reconvert.ts#L244) `previewOf` | `SQLite.get` (244); `SQLite.prepare` (244) | OPERATOR |
| [packages/store/src/reconvert.ts:264](../../packages/store/src/reconvert.ts#L264) `copyContainer` | `SQLite.get` (264); `SQLite.prepare` (264, 266, 272) | OPERATOR |
| [packages/store/src/reconvert.ts:301](../../packages/store/src/reconvert.ts#L301) `carryRecords` | `SQLite.prepare` (301, 304, 305, 315, 321, 322); `SQLite.all` (304, 308, 321) | OPERATOR |
| [packages/store/src/reconvert.ts:330](../../packages/store/src/reconvert.ts#L330) `carrySettings` | `SQLite.all` (330, 334, 342); `SQLite.prepare` (330, 334, 342, 343, 347); `SQLite.get` (347) | OPERATOR |
| [packages/store/src/record-chain.ts:58](../../packages/store/src/record-chain.ts#L58) `ensureRecordChain` | `SQLite.all` (58); `SQLite.prepare` (58, 67, 68, 71); `SQLite.get` (67, 68) | CORE |
| [packages/store/src/record-chain.ts:80](../../packages/store/src/record-chain.ts#L80) `linkRecordEntry` | `SQLite.prepare` (80, 81, 82, 85, 86); `SQLite.get` (81, 82) | CORE |
| [packages/store/src/record-chain.ts:93](../../packages/store/src/record-chain.ts#L93) `pruneRecordEntries` | `SQLite.prepare` (93, 94, 95, 97); `SQLite.get` (94) | CORE |
| [packages/store/src/record-chain.ts:115](../../packages/store/src/record-chain.ts#L115) `verifyRecordAudit` | `SQLite.get` (115, 129); `SQLite.prepare` (115, 119, 129, 132); `SQLite.all` (119); `SQLite.iterate` (132) | CORE |
| [packages/store/src/related.ts:134](../../packages/store/src/related.ts#L134) `keyValue` | `Calculations.value` (134) | RELATED |
| [packages/store/src/related.ts:145](../../packages/store/src/related.ts#L145) `condition` | `Store.canViewRecord` (145); `keyValue` (158) | RELATED |
| [packages/store/src/related.ts:191](../../packages/store/src/related.ts#L191) `relatedRows` | `Calculations.relatedIds` (191); `rowsById` (192); `Calculations.statement` (207, 211, 221); `SQLite.get` (207); `SQLite.all` (211); `SQLite.iterate` (221) | RELATED |
| [packages/store/src/related.ts:249](../../packages/store/src/related.ts#L249) `relatedIdList` | `Calculations.relatedIds` (249); `Calculations.statement` (254); `SQLite.iterate` (254) | RELATED |
| [packages/store/src/related.ts:292](../../packages/store/src/related.ts#L292) `relatedKeys` | `keyValue` (292) | RELATED |
| [packages/store/src/related.ts:312](../../packages/store/src/related.ts#L312) `firstRelatedEach/oneByOne` | `relatedRows` (312) | RELATED |
| [packages/store/src/related.ts:325](../../packages/store/src/related.ts#L325) `firstRelatedEach/keysOf` | `keyValue` (325) | RELATED |
| [packages/store/src/related.ts:346](../../packages/store/src/related.ts#L346) `firstRelatedEach` | `Calculations.statement` (346); `SQLite.all` (346) | RELATED |
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
| [packages/store/src/store.ts:889](../../packages/store/src/store.ts#L889) `Store/metadataVersions` | `SQLite.get` (889); `SQLite.prepare` (889); `Store.sql` (889) | CORE |
| [packages/store/src/store.ts:1029](../../packages/store/src/store.ts#L1029) `Store/constructor` | `Store.sql` (1029, 1031, 1033, 1034, 1038, 1042, 1043, 1054, 1059, 1064, 1065, 1069, 1070, 1071, 1078, 1082, 1086, 1087, 1088, 1093, 1097, 1100, 1101, 1103, 1104, 1107, 1108, 1112, 1113, 1117, 1118, 1121, 1123, 1126, 1127, 1131, 1132, 1136, 1137, 1140, 1141, 1142, 1145, 1146, 1149, 1150, 1152, 1152, 1153, 1153, 1154, 1157, 1161, 1163, 1166, 1167, 1168, 1171, 1172, 1174, 1176, 1177, 1181, 1182, 1184, 1188, 1189, 1190, 1190, 1194, 1195); `SQLite.get` (1033); `SQLite.prepare` (1033, 1100, 1101, 1104, 1107, 1112, 1117, 1126, 1131, 1136, 1145, 1149, 1152, 1153, 1171, 1176, 1181); `SQLite.all` (1100, 1107, 1112, 1117, 1126, 1131, 1136, 1145, 1149, 1152, 1153, 1171, 1176, 1181) | CORE |
| [packages/store/src/store.ts:1252](../../packages/store/src/store.ts#L1252) `Store/grantFullAccessClients` | `SQLite.prepare` (1252); `Store.sql` (1252) | CORE |
| [packages/store/src/store.ts:1275](../../packages/store/src/store.ts#L1275) `Store/meta` | `SQLite.get` (1275); `SQLite.prepare` (1275); `Store.sql` (1275) | CORE |
| [packages/store/src/store.ts:3411](../../packages/store/src/store.ts#L3411) `Store/webViewerChecked` | `SQLite.get` (3411); `SQLite.prepare` (3411); `Store.sql` (3411) | CORE |
| [packages/store/src/store.ts:1283](../../packages/store/src/store.ts#L1283) `Store/persistentTable` | `Store.sql` (1283) | CORE |
| [packages/store/src/store.ts:1293](../../packages/store/src/store.ts#L1293) `Store/persistentData` | `SQLite.get` (1293) | CORE |
| [packages/store/src/store.ts:1302](../../packages/store/src/store.ts#L1302) `Store/persistentDataIds` | `SQLite.all` (1302) | CORE |
| [packages/store/src/store.ts:1308](../../packages/store/src/store.ts#L1308) `Store/setPersistentData` | `SQLite.prepare` (1308, 1312); `Store.sql` (1308, 1312) | CORE |
| [packages/store/src/store.ts:1332](../../packages/store/src/store.ts#L1332) `Store/checkpoint` | `SQLite.get` (1332); `SQLite.prepare` (1332); `Store.sql` (1332) | CORE |
| [packages/store/src/store.ts:1340](../../packages/store/src/store.ts#L1340) `Store/recordedFormat` | `Store.sql` (1340) | CORE |
| [packages/store/src/store.ts:1350](../../packages/store/src/store.ts#L1350) `Store/close` | `Store.sql` (1350) | CORE |
| [packages/store/src/store.ts:1366](../../packages/store/src/store.ts#L1366) `Store/shipWal` | `Store.sql` (1366) | CORE |
| [packages/store/src/store.ts:1377](../../packages/store/src/store.ts#L1377) `Store/trial` | `Store.sql` (1377) | CORE |
| [packages/store/src/store.ts:1382](../../packages/store/src/store.ts#L1382) `Store/trial/undo` | `Store.sql` (1382) | CORE |
| [packages/store/src/store.ts:1417](../../packages/store/src/store.ts#L1417) `Store/joinTransaction` | `Store.sql` (1417, 1418, 1420, 1422, 1428) | CORE |
| [packages/store/src/store.ts:1440](../../packages/store/src/store.ts#L1440) `Store/independentWindowWrite` | `SQLite.get` (1440); `SQLite.prepare` (1440, 1463); `Store.sql` (1440, 1443, 1458, 1463, 1466) | CORE |
| [packages/store/src/store.ts:1488](../../packages/store/src/store.ts#L1488) `Store/withWriteTransaction` | `Store.sql` (1488, 1491, 1495, 1497, 1497) | CORE |
| [packages/store/src/store.ts:1527](../../packages/store/src/store.ts#L1527) `Store/endTransaction` | `Store.sql` (1527, 1530, 1530) | CORE |
| [packages/store/src/store.ts:1556](../../packages/store/src/store.ts#L1556) `Store/backup` | `Store.sql` (1556) | CORE |
| [packages/store/src/store.ts:1646](../../packages/store/src/store.ts#L1646) `Store/dataVersion` | `SQLite.get` (1646); `SQLite.prepare` (1646); `Store.sql` (1646) | CORE |
| [packages/store/src/store.ts:1686](../../packages/store/src/store.ts#L1686) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1686) | CORE |
| [packages/store/src/store.ts:1707](../../packages/store/src/store.ts#L1707) `Store/shareResults` | `Store.sql` (1707) | CORE |
| [packages/store/src/store.ts:1717](../../packages/store/src/store.ts#L1717) `Store/versionTriggers` | `SQLite.get` (1717); `SQLite.prepare` (1717, 1722, 1723); `Store.sql` (1717, 1719, 1720, 1722, 1723, 1732, 1733); `SQLite.all` (1722, 1723) | CORE |
| [packages/store/src/store.ts:1749](../../packages/store/src/store.ts#L1749) `Store/versionNumber` | `SQLite.get` (1749); `SQLite.prepare` (1749); `Store.sql` (1749) | CORE |
| [packages/store/src/store.ts:1762](../../packages/store/src/store.ts#L1762) `Store/changeOne` | `Store.sql` (1762, 1764) | CORE |
| [packages/store/src/store.ts:1765](../../packages/store/src/store.ts#L1765) `Store/changeOne/read` | `SQLite.get` (1765); `SQLite.prepare` (1765); `Store.sql` (1765) | CORE |
| [packages/store/src/store.ts:1804](../../packages/store/src/store.ts#L1804) `Store/writeToken` | `SQLite.get` (1804); `SQLite.prepare` (1804); `Store.sql` (1804) | CORE |
| [packages/store/src/store.ts:1816](../../packages/store/src/store.ts#L1816) `Store/recordCount` | `SQLite.get` (1816); `SQLite.prepare` (1816); `Store.sql` (1816) | CORE |
| [packages/store/src/store.ts:1928](../../packages/store/src/store.ts#L1928) `Store/applyDesign` | `Store.sql` (1928, 1929, 1942, 1945, 1950, 1966, 1969, 1969); `SQLite.prepare` (1945, 1950) | CORE |
| [packages/store/src/store.ts:2027](../../packages/store/src/store.ts#L2027) `Store/auditLog` | `SQLite.all` (2027); `SQLite.prepare` (2027); `Store.sql` (2027) | CORE |
| [packages/store/src/store.ts:2067](../../packages/store/src/store.ts#L2067) `Store/securityEvents` | `Store.auditLog` (2067) | CORE |
| [packages/store/src/store.ts:2093](../../packages/store/src/store.ts#L2093) `Store/prepared` | `SQLite.prepare` (2093); `Store.sql` (2093) | CORE |
| [packages/store/src/store.ts:2108](../../packages/store/src/store.ts#L2108) `Store/recordAsOf` | `SQLite.get` (2108, 2110); `SQLite.prepare` (2108, 2110, 2112, 2113); `Store.sql` (2108, 2110, 2112, 2113); `SQLite.all` (2112, 2113) | CORE |
| [packages/store/src/store.ts:2142](../../packages/store/src/store.ts#L2142) `Store/restoreRecord/run` | `Store.recordAsOf` (2142); `SQLite.get` (2146); `SQLite.prepare` (2146, 2151, 2160, 2171); `Store.sql` (2146, 2151, 2160, 2171) | CORE |
| [packages/store/src/store.ts:2187](../../packages/store/src/store.ts#L2187) `Store/revertAuditEntry` | `Store.auditLog` (2187) | CORE |
| [packages/store/src/store.ts:2280](../../packages/store/src/store.ts#L2280) `Store/setAuditSettings` | `SQLite.prepare` (2280); `Store.sql` (2280) | CORE |
| [packages/store/src/store.ts:2302](../../packages/store/src/store.ts#L2302) `Store/pruneAudit` | `Store.sql` (2302, 2304, 2306); `SQLite.get` (2304); `SQLite.prepare` (2304) | CORE |
| [packages/store/src/store.ts:2384](../../packages/store/src/store.ts#L2384) `Store/audit` | `Store.sql` (2384) | CORE |
| [packages/store/src/store.ts:2473](../../packages/store/src/store.ts#L2473) `Store/securityChange` | `Store.sql` (2473, 2475); `SQLite.prepare` (2475) | CORE |
| [packages/store/src/store.ts:2522](../../packages/store/src/store.ts#L2522) `Store/logSecurity` | `Store.sql` (2522) | CORE |
| [packages/store/src/store.ts:2545](../../packages/store/src/store.ts#L2545) `Store/ensureDeleted` | `Store.sql` (2545) | CORE |
| [packages/store/src/store.ts:2550](../../packages/store/src/store.ts#L2550) `Store/deletedRows` | `SQLite.get` (2550); `SQLite.prepare` (2550, 2552, 2552); `Store.sql` (2550, 2552, 2552); `SQLite.all` (2552, 2552) | CORE |
| [packages/store/src/store.ts:2576](../../packages/store/src/store.ts#L2576) `Store/emptyDeleted` | `Store.sql` (2576, 2579, 2580, 2582, 2584); `SQLite.prepare` (2580) | CORE |
| [packages/store/src/store.ts:2591](../../packages/store/src/store.ts#L2591) `Store/designHistory` | `SQLite.all` (2591); `SQLite.prepare` (2591); `Store.sql` (2591) | CORE |
| [packages/store/src/store.ts:2598](../../packages/store/src/store.ts#L2598) `Store/scriptHistory` | `SQLite.all` (2598); `SQLite.prepare` (2598); `Store.sql` (2598) | CORE |
| [packages/store/src/store.ts:2608](../../packages/store/src/store.ts#L2608) `Store/layoutHistory` | `SQLite.all` (2608); `SQLite.prepare` (2608); `Store.sql` (2608) | CORE |
| [packages/store/src/store.ts:2637](../../packages/store/src/store.ts#L2637) `Store/designEffect/renameKey` | `SQLite.prepare` (2637); `Store.sql` (2637) | CORE |
| [packages/store/src/store.ts:2653](../../packages/store/src/store.ts#L2653) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2653); `Store.sql` (2653) | CORE |
| [packages/store/src/store.ts:2660](../../packages/store/src/store.ts#L2660) `Store/designEffect` | `Store.sql` (2660, 2665, 2670, 2675, 2678, 2684, 2695, 2696, 2698, 2711, 2712, 2715, 2717, 2723, 2724, 2725, 2730, 2732, 2736, 2739, 2740, 2742, 2745, 2751, 2753, 2760, 2761, 2763, 2764, 2765, 2766, 2773, 2774, 2776, 2776, 2778, 2779, 2780, 2784, 2788, 2790, 2828, 2830, 2832); `SQLite.get` (2695, 2711, 2723, 2724, 2736, 2740, 2776, 2784); `SQLite.prepare` (2695, 2696, 2711, 2712, 2723, 2724, 2730, 2732, 2736, 2740, 2751, 2753, 2766, 2773, 2774, 2776, 2778, 2780, 2784, 2788); `SQLite.all` (2773, 2774); `SQLite.iterate` (2778) | CORE |
| [packages/store/src/store.ts:2840](../../packages/store/src/store.ts#L2840) `Store/dropColumnIndexes` | `SQLite.all` (2840, 2842); `SQLite.prepare` (2840, 2842); `Store.sql` (2840, 2842, 2843) | CORE |
| [packages/store/src/store.ts:2852](../../packages/store/src/store.ts#L2852) `Store/recompute` | `SQLite.prepare` (2852, 2856); `Store.sql` (2852, 2856); `SQLite.iterate` (2856); `Calculations.computeStoredStyled` (2857); `Calculations.value` (2857) | CORE |
| [packages/store/src/store.ts:2872](../../packages/store/src/store.ts#L2872) `Store/linkPrincipal` | `SQLite.get` (2872); `SQLite.prepare` (2872); `Store.sql` (2872) | CORE |
| [packages/store/src/store.ts:2879](../../packages/store/src/store.ts#L2879) `Store/linkIdentity` | `SQLite.get` (2879); `SQLite.prepare` (2879); `Store.sql` (2879) | CORE |
| [packages/store/src/store.ts:2885](../../packages/store/src/store.ts#L2885) `Store/accountsSharingLockout` | `SQLite.all` (2885); `SQLite.prepare` (2885); `Store.sql` (2885) | CORE |
| [packages/store/src/store.ts:2889](../../packages/store/src/store.ts#L2889) `Store/accounts` | `SQLite.all` (2889); `SQLite.prepare` (2889); `Store.sql` (2889) | CORE |
| [packages/store/src/store.ts:2901](../../packages/store/src/store.ts#L2901) `Store/isAgent` | `SQLite.get` (2901); `SQLite.prepare` (2901); `Store.sql` (2901) | CORE |
| [packages/store/src/store.ts:2907](../../packages/store/src/store.ts#L2907) `Store/agentNeedsApproval` | `SQLite.get` (2907); `SQLite.prepare` (2907); `Store.sql` (2907) | CORE |
| [packages/store/src/store.ts:2913](../../packages/store/src/store.ts#L2913) `Store/blankPasswordAccounts` | `SQLite.all` (2913); `SQLite.prepare` (2913); `Store.sql` (2913) | CORE |
| [packages/store/src/store.ts:1260](../../packages/store/src/store.ts#L1260) `Store/hasOwnPassword` | `SQLite.get` (1260); `SQLite.prepare` (1260); `Store.sql` (1260) | CORE |
| [packages/store/src/store.ts:2924](../../packages/store/src/store.ts#L2924) `Store/unmigratedAccounts` | `SQLite.all` (2924); `SQLite.prepare` (2924); `Store.sql` (2924) | CORE |
| [packages/store/src/store.ts:2977](../../packages/store/src/store.ts#L2977) `Store/setExternalAccount` | `SQLite.get` (2977); `SQLite.prepare` (2977, 2982); `Store.sql` (2977, 2982) | CORE |
| [packages/store/src/store.ts:2995](../../packages/store/src/store.ts#L2995) `Store/refuseLookalikeAccount` | `SQLite.all` (2995); `SQLite.prepare` (2995); `Store.sql` (2995) | CORE |
| [packages/store/src/store.ts:3004](../../packages/store/src/store.ts#L3004) `Store/isExternal` | `SQLite.get` (3004); `SQLite.prepare` (3004); `Store.sql` (3004) | CORE |
| [packages/store/src/store.ts:3025](../../packages/store/src/store.ts#L3025) `Store/setAgentAccount` | `SQLite.get` (3025); `SQLite.prepare` (3025, 3031); `Store.sql` (3025, 3031) | CORE |
| [packages/store/src/store.ts:3065](../../packages/store/src/store.ts#L3065) `Store/gateAgentWrite` | `SQLite.prepare` (3065); `Store.sql` (3065) | CORE |
| [packages/store/src/store.ts:3087](../../packages/store/src/store.ts#L3087) `Store/pendingChanges` | `SQLite.all` (3087); `SQLite.prepare` (3087); `Store.sql` (3087) | CORE |
| [packages/store/src/store.ts:3101](../../packages/store/src/store.ts#L3101) `Store/approvePending` | `SQLite.get` (3101); `SQLite.prepare` (3101, 3112); `Store.sql` (3101, 3112) | CORE |
| [packages/store/src/store.ts:3122](../../packages/store/src/store.ts#L3122) `Store/rejectPending` | `SQLite.get` (3122); `SQLite.prepare` (3122, 3124); `Store.sql` (3122, 3124) | CORE |
| [packages/store/src/store.ts:3144](../../packages/store/src/store.ts#L3144) `Store/externalAccount` | `SQLite.all` (3144); `SQLite.prepare` (3144); `Store.sql` (3144) | CORE |
| [packages/store/src/store.ts:3175](../../packages/store/src/store.ts#L3175) `Store/setPassword` | `SQLite.get` (3175); `SQLite.prepare` (3175, 3177, 3186); `Store.sql` (3175, 3177, 3186) | AUTH |
| [packages/store/src/store.ts:3200](../../packages/store/src/store.ts#L3200) `Store/createAccount` | `SQLite.get` (3200); `SQLite.prepare` (3200, 3204, 3210, 3215, 3220); `Store.sql` (3200, 3204, 3210, 3215, 3220) | CORE |
| [packages/store/src/store.ts:3228](../../packages/store/src/store.ts#L3228) `Store/appendSecurityEvent` | `Store.sql` (3228) | CORE |
| [packages/store/src/store.ts:3270](../../packages/store/src/store.ts#L3270) `Store/setPasswordPolicy` | `SQLite.prepare` (3270); `Store.sql` (3270) | CORE |
| [packages/store/src/store.ts:3306](../../packages/store/src/store.ts#L3306) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3306); `Store.sql` (3306) | CORE |
| [packages/store/src/store.ts:3329](../../packages/store/src/store.ts#L3329) `Store/saveScriptTest` | `SQLite.prepare` (3329); `Store.sql` (3329) | CORE |
| [packages/store/src/store.ts:3338](../../packages/store/src/store.ts#L3338) `Store/deleteScriptTest` | `SQLite.prepare` (3338); `Store.sql` (3338) | CORE |
| [packages/store/src/store.ts:3373](../../packages/store/src/store.ts#L3373) `Store/setAiAllowed` | `SQLite.prepare` (3373); `Store.sql` (3373) | CORE |
| [packages/store/src/store.ts:3440](../../packages/store/src/store.ts#L3440) `Store/setAiPolicy` | `SQLite.prepare` (3440); `Store.sql` (3440) | CORE |
| [packages/store/src/store.ts:3388](../../packages/store/src/store.ts#L3388) `Store/setScriptNetwork` | `SQLite.prepare` (3388); `Store.sql` (3388) | CORE |
| [packages/store/src/store.ts:3429](../../packages/store/src/store.ts#L3429) `Store/setWebViewerHosts` | `SQLite.prepare` (3429); `Store.sql` (3429) | CORE |
| [packages/store/src/store.ts:3460](../../packages/store/src/store.ts#L3460) `Store/setPiiIsolation` | `SQLite.prepare` (3460); `Store.sql` (3460) | CORE |
| [packages/store/src/store.ts:3482](../../packages/store/src/store.ts#L3482) `Store/markPiiField` | `SQLite.prepare` (3482); `Store.sql` (3482) | CORE |
| [packages/store/src/store.ts:3596](../../packages/store/src/store.ts#L3596) `Store/lastSignIns` | `Store.auditLog` (3596) | CORE |
| [packages/store/src/store.ts:3799](../../packages/store/src/store.ts#L3799) `Store/unusualAccess` | `Store.auditLog` (3799, 3865) | CORE |
| [packages/store/src/store.ts:3896](../../packages/store/src/store.ts#L3896) `Store/leastPrivilege` | `SQLite.all` (3896); `SQLite.prepare` (3896); `Store.sql` (3896) | CORE |
| [packages/store/src/store.ts:3969](../../packages/store/src/store.ts#L3969) `Store/unusedAccess` | `SQLite.get` (3969); `SQLite.prepare` (3969, 3978); `Store.sql` (3969, 3978); `SQLite.all` (3978) | CORE |
| [packages/store/src/store.ts:4017](../../packages/store/src/store.ts#L4017) `Store/unusedObjects` | `SQLite.get` (4017); `SQLite.prepare` (4017, 4020); `Store.sql` (4017, 4020); `SQLite.all` (4020) | CORE |
| [packages/store/src/store.ts:4055](../../packages/store/src/store.ts#L4055) `Store/usageCounting` | `SQLite.get` (4055); `SQLite.prepare` (4055); `Store.sql` (4055) | CORE |
| [packages/store/src/store.ts:4063](../../packages/store/src/store.ts#L4063) `Store/setMustChangePassword` | `SQLite.prepare` (4063); `Store.sql` (4063) | CORE |
| [packages/store/src/store.ts:4077](../../packages/store/src/store.ts#L4077) `Store/mustChangePassword` | `SQLite.get` (4077); `SQLite.prepare` (4077); `Store.sql` (4077) | CORE |
| [packages/store/src/store.ts:4116](../../packages/store/src/store.ts#L4116) `Store/passwordDaysRemaining` | `SQLite.get` (4116); `SQLite.prepare` (4116); `Store.sql` (4116) | CORE |
| [packages/store/src/store.ts:4123](../../packages/store/src/store.ts#L4123) `Store/importAccounts` | `SQLite.all` (4123); `SQLite.prepare` (4123); `Store.sql` (4123) | CORE |
| [packages/store/src/store.ts:4146](../../packages/store/src/store.ts#L4146) `Store/canonicalAccount` | `SQLite.all` (4146); `SQLite.prepare` (4146); `Store.sql` (4146) | CORE |
| [packages/store/src/store.ts:4158](../../packages/store/src/store.ts#L4158) `Store/createLocalAccount` | `SQLite.prepare` (4158); `Store.sql` (4158) | CORE |
| [packages/store/src/store.ts:4188](../../packages/store/src/store.ts#L4188) `Store/previewAccountImport` | `Store.sql` (4188, 4189, 4198) | CORE |
| [packages/store/src/store.ts:4206](../../packages/store/src/store.ts#L4206) `Store/limitAccountImport` | `SQLite.prepare` (4206, 4207, 4210); `Store.sql` (4206, 4207, 4210); `SQLite.get` (4207) | CORE |
| [packages/store/src/store.ts:4217](../../packages/store/src/store.ts#L4217) `Store/applyAccountImport` | `Store.sql` (4217, 4225, 4254); `SQLite.get` (4225); `SQLite.prepare` (4225, 4254) | CORE |
| [packages/store/src/store.ts:4279](../../packages/store/src/store.ts#L4279) `Store/forgetStandIns` | `SQLite.prepare` (4279); `Store.sql` (4279) | CORE |
| [packages/store/src/store.ts:4312](../../packages/store/src/store.ts#L4312) `Store/deleteAccount` | `SQLite.prepare` (4312, 4316, 4317, 4318, 4319, 4320, 4321, 4322, 4323, 4330, 4332, 4335, 4339); `Store.sql` (4312, 4316, 4317, 4318, 4319, 4320, 4321, 4322, 4323, 4330, 4332, 4335, 4339) | CORE |
| [packages/store/src/store.ts:4356](../../packages/store/src/store.ts#L4356) `Store/setAccountActive` | `SQLite.prepare` (4356, 4359, 4360); `Store.sql` (4356, 4359, 4360) | AUTH |
| [packages/store/src/store.ts:4370](../../packages/store/src/store.ts#L4370) `Store/accountInactive` | `SQLite.get` (4370); `SQLite.prepare` (4370); `Store.sql` (4370) | CORE |
| [packages/store/src/store.ts:4375](../../packages/store/src/store.ts#L4375) `Store/identityAllowed` | `SQLite.get` (4375, 4381, 4387); `SQLite.prepare` (4375, 4381, 4387); `Store.sql` (4375, 4381, 4387) | CORE |
| [packages/store/src/store.ts:4396](../../packages/store/src/store.ts#L4396) `Store/externalIdentityId` | `SQLite.get` (4396, 4402); `SQLite.prepare` (4396, 4401, 4402); `Store.sql` (4396, 4401, 4402) | CORE |
| [packages/store/src/store.ts:4407](../../packages/store/src/store.ts#L4407) `Store/accountIdentityId` | `SQLite.get` (4407, 4412); `SQLite.prepare` (4407, 4411, 4412); `Store.sql` (4407, 4411, 4412) | CORE |
| [packages/store/src/store.ts:4435](../../packages/store/src/store.ts#L4435) `Store/signInMark` | `SQLite.prepare` (4435); `Store.sql` (4435) | AUTH |
| [packages/store/src/store.ts:4445](../../packages/store/src/store.ts#L4445) `Store/signInBase` | `SQLite.get` (4445); `SQLite.prepare` (4445); `Store.sql` (4445) | AUTH |
| [packages/store/src/store.ts:4447](../../packages/store/src/store.ts#L4447) `Store/signInBase/identity` | `SQLite.get` (4447); `SQLite.prepare` (4447); `Store.sql` (4447) | AUTH |
| [packages/store/src/store.ts:4459](../../packages/store/src/store.ts#L4459) `Store/ledgerRow` | `SQLite.get` (4459, 4460); `SQLite.prepare` (4459, 4460); `Store.sql` (4459, 4460) | AUTH |
| [packages/store/src/store.ts:4471](../../packages/store/src/store.ts#L4471) `Store/ledgerWrite` | `Store.sql` (4471, 4472, 4474, 4476, 4479, 4479) | AUTH |
| [packages/store/src/store.ts:4498](../../packages/store/src/store.ts#L4498) `Store/settleSignIns` | `SQLite.all` (4498, 4504); `SQLite.prepare` (4498, 4504, 4510, 4514, 4516); `Store.sql` (4498, 4504, 4510, 4514, 4516) | AUTH |
| [packages/store/src/store.ts:4527](../../packages/store/src/store.ts#L4527) `Store/securityToken` | `SQLite.get` (4527); `SQLite.prepare` (4527); `Store.sql` (4527) | CORE |
| [packages/store/src/store.ts:4535](../../packages/store/src/store.ts#L4535) `Store/accountLocalOnly` | `SQLite.get` (4535); `SQLite.prepare` (4535); `Store.sql` (4535) | CORE |
| [packages/store/src/store.ts:4540](../../packages/store/src/store.ts#L4540) `Store/accountRequires2fa` | `SQLite.get` (4540); `SQLite.prepare` (4540); `Store.sql` (4540) | CORE |
| [packages/store/src/store.ts:4546](../../packages/store/src/store.ts#L4546) `Store/setAccountLocalOnly` | `SQLite.prepare` (4546); `Store.sql` (4546) | CORE |
| [packages/store/src/store.ts:4555](../../packages/store/src/store.ts#L4555) `Store/setAccountRequire2fa` | `SQLite.prepare` (4555); `Store.sql` (4555) | CORE |
| [packages/store/src/store.ts:4584](../../packages/store/src/store.ts#L4584) `Store/createApiToken` | `SQLite.get` (4584); `SQLite.prepare` (4584, 4614); `Store.sql` (4584, 4614) | CORE |
| [packages/store/src/store.ts:4661](../../packages/store/src/store.ts#L4661) `Store/recordObjectUse` | `Store.sql` (4661) | CORE |
| [packages/store/src/store.ts:4691](../../packages/store/src/store.ts#L4691) `Store/writeUsage` | `Store.sql` (4691, 4692, 4694, 4698, 4700) | CORE |
| [packages/store/src/store.ts:4707](../../packages/store/src/store.ts#L4707) `Store/writeUsageRows` | `SQLite.prepare` (4707, 4708, 4714); `Store.sql` (4707, 4708, 4714) | CORE |
| [packages/store/src/store.ts:4719](../../packages/store/src/store.ts#L4719) `Store/writeObjectUseRows` | `SQLite.prepare` (4719, 4720, 4725); `Store.sql` (4719, 4720, 4725) | CORE |
| [packages/store/src/store.ts:4730](../../packages/store/src/store.ts#L4730) `Store/objectUseSince` | `SQLite.get` (4730); `SQLite.prepare` (4730); `Store.sql` (4730) | CORE |
| [packages/store/src/store.ts:4743](../../packages/store/src/store.ts#L4743) `Store/accountUsage` | `SQLite.get` (4743); `SQLite.prepare` (4743, 4744); `Store.sql` (4743, 4744); `SQLite.all` (4744); `Store.auditLog` (4760) | CORE |
| [packages/store/src/store.ts:4776](../../packages/store/src/store.ts#L4776) `Store/apiTokens` | `SQLite.all` (4776); `SQLite.prepare` (4776); `Store.sql` (4776) | CORE |
| [packages/store/src/store.ts:4786](../../packages/store/src/store.ts#L4786) `Store/revokeApiToken` | `SQLite.prepare` (4786); `Store.sql` (4786) | CORE |
| [packages/store/src/store.ts:4800](../../packages/store/src/store.ts#L4800) `Store/apiToken` | `SQLite.get` (4800); `SQLite.prepare` (4800, 4812); `Store.sql` (4800, 4812) | CORE |
| [packages/store/src/store.ts:4828](../../packages/store/src/store.ts#L4828) `Store/enrollTotp` | `SQLite.prepare` (4828); `Store.sql` (4828) | CORE |
| [packages/store/src/store.ts:4839](../../packages/store/src/store.ts#L4839) `Store/confirmTotp` | `SQLite.get` (4839); `SQLite.prepare` (4839, 4841); `Store.sql` (4839, 4841) | CORE |
| [packages/store/src/store.ts:4849](../../packages/store/src/store.ts#L4849) `Store/hasTotp` | `SQLite.get` (4849); `SQLite.prepare` (4849); `Store.sql` (4849) | CORE |
| [packages/store/src/store.ts:4854](../../packages/store/src/store.ts#L4854) `Store/totpAccounts` | `SQLite.all` (4854); `SQLite.prepare` (4854); `Store.sql` (4854) | CORE |
| [packages/store/src/store.ts:4860](../../packages/store/src/store.ts#L4860) `Store/disableTotp` | `SQLite.prepare` (4860); `Store.sql` (4860) | CORE |
| [packages/store/src/store.ts:4883](../../packages/store/src/store.ts#L4883) `Store/verifyTotp` | `SQLite.get` (4883); `SQLite.prepare` (4883, 4889); `Store.sql` (4883, 4889) | CORE |
| [packages/store/src/store.ts:4902](../../packages/store/src/store.ts#L4902) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4902, 4904, 4905, 4907); `Store.sql` (4902, 4904, 4905, 4907); `SQLite.get` (4904) | CORE |
| [packages/store/src/store.ts:4954](../../packages/store/src/store.ts#L4954) `Store/passkeyAllowList` | `SQLite.all` (4954); `SQLite.prepare` (4954); `Store.sql` (4954) | CORE |
| [packages/store/src/store.ts:4968](../../packages/store/src/store.ts#L4968) `Store/takeWebauthnChallenge` | `SQLite.get` (4968); `SQLite.prepare` (4968, 4970); `Store.sql` (4968, 4970) | CORE |
| [packages/store/src/store.ts:4978](../../packages/store/src/store.ts#L4978) `Store/passkeys` | `SQLite.all` (4978); `SQLite.prepare` (4978); `Store.sql` (4978) | CORE |
| [packages/store/src/store.ts:4985](../../packages/store/src/store.ts#L4985) `Store/hasPasskey` | `SQLite.get` (4985); `SQLite.prepare` (4985); `Store.sql` (4985) | CORE |
| [packages/store/src/store.ts:4990](../../packages/store/src/store.ts#L4990) `Store/passkeyIds` | `SQLite.all` (4990); `SQLite.prepare` (4990); `Store.sql` (4990) | CORE |
| [packages/store/src/store.ts:5012](../../packages/store/src/store.ts#L5012) `Store/registerPasskey` | `SQLite.prepare` (5012); `Store.sql` (5012) | CORE |
| [packages/store/src/store.ts:5023](../../packages/store/src/store.ts#L5023) `Store/removePasskey` | `SQLite.get` (5023); `SQLite.prepare` (5023, 5024); `Store.sql` (5023, 5024) | CORE |
| [packages/store/src/store.ts:5040](../../packages/store/src/store.ts#L5040) `Store/verifyPasskeyAssertion` | `SQLite.get` (5040); `SQLite.prepare` (5040, 5051); `Store.sql` (5040, 5051) | CORE |
| [packages/store/src/store.ts:5087](../../packages/store/src/store.ts#L5087) `Store/generateRecoveryCodes` | `SQLite.prepare` (5087, 5090); `Store.sql` (5087, 5090) | CORE |
| [packages/store/src/store.ts:5105](../../packages/store/src/store.ts#L5105) `Store/recoveryCodesRemaining` | `SQLite.get` (5105); `SQLite.prepare` (5105); `Store.sql` (5105) | CORE |
| [packages/store/src/store.ts:5115](../../packages/store/src/store.ts#L5115) `Store/useRecoveryCode` | `SQLite.get` (5115); `SQLite.prepare` (5115, 5117); `Store.sql` (5115, 5117) | CORE |
| [packages/store/src/store.ts:5128](../../packages/store/src/store.ts#L5128) `Store/privilegeSets` | `Store.sql` (5128) | CORE |
| [packages/store/src/store.ts:5157](../../packages/store/src/store.ts#L5157) `Store/savePrivilegeSet` | `SQLite.prepare` (5157, 5165); `Store.sql` (5157, 5165) | AUTH |
| [packages/store/src/store.ts:5200](../../packages/store/src/store.ts#L5200) `Store/deletePrivilegeSet` | `SQLite.prepare` (5200); `Store.sql` (5200) | CORE |
| [packages/store/src/store.ts:5269](../../packages/store/src/store.ts#L5269) `Store/accountPrivilegeSet` | `SQLite.get` (5269); `SQLite.prepare` (5269); `Store.sql` (5269) | CORE |
| [packages/store/src/store.ts:5283](../../packages/store/src/store.ts#L5283) `Store/setAccountPrivilegeSet` | `SQLite.get` (5283); `SQLite.prepare` (5283, 5286, 5290); `Store.sql` (5283, 5286, 5290) | AUTH |
| [packages/store/src/store.ts:5305](../../packages/store/src/store.ts#L5305) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5305); `Store.sql` (5305) | CORE |
| [packages/store/src/store.ts:5319](../../packages/store/src/store.ts#L5319) `Store/addProvisionedAccount` | `SQLite.get` (5319); `SQLite.prepare` (5319, 5323); `Store.sql` (5319, 5323) | CORE |
| [packages/store/src/store.ts:5492](../../packages/store/src/store.ts#L5492) `Store/ruleOutcome` | `Calculations.context` (5492) | CORE |
| [packages/store/src/store.ts:5533](../../packages/store/src/store.ts#L5533) `Store/allowedIds` | `SQLite.iterate` (5533); `SQLite.prepare` (5533); `Store.sql` (5533) | CORE |
| [packages/store/src/store.ts:5631](../../packages/store/src/store.ts#L5631) `Store/scopedTableSql` | `Store.viewableIds` (5631); `SQLite.all` (5634); `SQLite.prepare` (5634); `Store.sql` (5634) | GATED-STORE |
| [packages/store/src/store.ts:5666](../../packages/store/src/store.ts#L5666) `Store/previewRecordRuleCurrent` | `SQLite.get` (5666); `SQLite.prepare` (5666, 5669); `Store.sql` (5666, 5669); `SQLite.all` (5669); `Calculations.context` (5675, 5691) | CORE |
| [packages/store/src/store.ts:5843](../../packages/store/src/store.ts#L5843) `Store/passwordHash` | `SQLite.get` (5843); `SQLite.prepare` (5843); `Store.sql` (5843) | CORE |
| [packages/store/src/store.ts:5872](../../packages/store/src/store.ts#L5872) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5872); `Store.sql` (5872) | CORE |
| [packages/store/src/store.ts:5885](../../packages/store/src/store.ts#L5885) `Store/knownSharedAccount` | `SQLite.get` (5885); `SQLite.prepare` (5885); `Store.sql` (5885) | CORE |
| [packages/store/src/store.ts:5948](../../packages/store/src/store.ts#L5948) `Store/layouts` | `SQLite.all` (5948); `SQLite.prepare` (5948); `Store.sql` (5948) | CORE |
| [packages/store/src/store.ts:5969](../../packages/store/src/store.ts#L5969) `Store/image` | `SQLite.get` (5969); `SQLite.prepare` (5969); `Store.sql` (5969) | CORE |
| [packages/store/src/store.ts:5979](../../packages/store/src/store.ts#L5979) `Store/images` | `SQLite.all` (5979); `SQLite.prepare` (5979); `Store.sql` (5979) | CORE |
| [packages/store/src/store.ts:5992](../../packages/store/src/store.ts#L5992) `Store/addImage` | `Store.sql` (5992, 5993); `SQLite.prepare` (5993) | CORE |
| [packages/store/src/store.ts:6009](../../packages/store/src/store.ts#L6009) `Store/layout` | `SQLite.get` (6009); `SQLite.prepare` (6009); `Store.sql` (6009) | CORE |
| [packages/store/src/store.ts:6213](../../packages/store/src/store.ts#L6213) `Store/wordIndex` | `Store.sql` (6213, 6221, 6226); `Store.recordCount` (6225); `SQLite.get` (6226); `SQLite.prepare` (6226) | CORE |
| [packages/store/src/store.ts:6278](../../packages/store/src/store.ts#L6278) `Store/toRecord` | `Calculations.value` (6278, 6288); `Calculations.globalValue` (6282); `Calculations.unstoredStyled` (6287) | CORE |
| [packages/store/src/store.ts:6337](../../packages/store/src/store.ts#L6337) `Store/relatedValues` | `Calculations.globalValue` (6337); `Calculations.unstoredValue` (6339) | CORE |
| [packages/store/src/store.ts:6411](../../packages/store/src/store.ts#L6411) `Store/addRelated` | `relatedRows` (6411); `rowsById` (6443); `firstRelatedEach` (6466) | CORE |
| [packages/store/src/store.ts:6494](../../packages/store/src/store.ts#L6494) `Store/foundSetPage` | `rowsById` (6494) | CORE |
| [packages/store/src/store.ts:6510](../../packages/store/src/store.ts#L6510) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6510); `Store.row` (6526) | GATED-STORE |
| [packages/store/src/store.ts:6549](../../packages/store/src/store.ts#L6549) `Store/portalCountsCurrent` | `Store.canView` (6549); `Store.row` (6576) | GATED-STORE |
| [packages/store/src/store.ts:6612](../../packages/store/src/store.ts#L6612) `Store/fieldIndexCurrent` | `SQLite.iterate` (6612); `SQLite.prepare` (6612, 6617); `Store.sql` (6612, 6617); `SQLite.all` (6617) | GATED-STORE |
| [packages/store/src/store.ts:6658](../../packages/store/src/store.ts#L6658) `Store/valueListItemsCurrent` | `Store.valueListItems` (6658); `Store.get` (6672); `relatedRows` (6673); `Store.row` (6673); `SQLite.iterate` (6675); `SQLite.prepare` (6675); `Store.sql` (6675); `Calculations.related` (6685); `Calculations.value` (6689, 6690) | GATED-STORE |
| [packages/store/src/store.ts:6787](../../packages/store/src/store.ts#L6787) `Store/portalRows` | `relatedRows` (6787); `relatedIdList` (6788); `Store.viewableIds` (6791); `rowsById` (6816, 6854); `Calculations.related` (6830) | CORE |
| [packages/store/src/store.ts:6798](../../packages/store/src/store.ts#L6798) `Store/portalRows/context` | `Calculations.context` (6798) | CORE |
| [packages/store/src/store.ts:6808](../../packages/store/src/store.ts#L6808) `Store/portalRows/valueOf` | `Calculations.value` (6808) | CORE |
| [packages/store/src/store.ts:6925](../../packages/store/src/store.ts#L6925) `Store/markRepeating` | `SQLite.prepare` (6925); `Store.sql` (6925) | CORE |
| [packages/store/src/store.ts:6952](../../packages/store/src/store.ts#L6952) `Store/externalContainerCheck` | `SQLite.all` (6952); `SQLite.prepare` (6952); `Store.sql` (6952) | CORE |
| [packages/store/src/store.ts:6959](../../packages/store/src/store.ts#L6959) `Store/externalContainerCount` | `SQLite.get` (6959); `SQLite.prepare` (6959); `Store.sql` (6959) | CORE |
| [packages/store/src/store.ts:6968](../../packages/store/src/store.ts#L6968) `Store/externalContainerReport` | `SQLite.all` (6968, 6981); `SQLite.prepare` (6968, 6981); `Store.sql` (6968, 6981) | CORE |
| [packages/store/src/store.ts:7117](../../packages/store/src/store.ts#L7117) `Store/orphanContainerReport` | `SQLite.all` (7117); `SQLite.prepare` (7117); `Store.sql` (7117) | CORE |
| [packages/store/src/store.ts:7152](../../packages/store/src/store.ts#L7152) `Store/purgeOrphanContainers` | `Store.sql` (7152, 7156, 7165, 7168, 7169, 7174, 7175, 7177, 7177); `Store.orphanContainerReport` (7160); `SQLite.get` (7165); `SQLite.prepare` (7165, 7168, 7169) | CORE |
| [packages/store/src/store.ts:7190](../../packages/store/src/store.ts#L7190) `Store/containerIntact` | `SQLite.get` (7190); `SQLite.prepare` (7190); `Store.sql` (7190) | CORE |
| [packages/store/src/store.ts:7200](../../packages/store/src/store.ts#L7200) `Store/externalOf` | `SQLite.get` (7200); `SQLite.prepare` (7200); `Store.sql` (7200) | CORE |
| [packages/store/src/store.ts:7204](../../packages/store/src/store.ts#L7204) `Store/containerMeta` | `SQLite.get` (7204); `SQLite.prepare` (7204); `Store.sql` (7204) | CORE |
| [packages/store/src/store.ts:7209](../../packages/store/src/store.ts#L7209) `Store/container` | `SQLite.get` (7209); `SQLite.prepare` (7209, 7218); `Store.sql` (7209, 7218); `SQLite.all` (7218) | CORE |
| [packages/store/src/store.ts:7226](../../packages/store/src/store.ts#L7226) `Store/containerInfo` | `SQLite.get` (7226); `SQLite.prepare` (7226); `Store.sql` (7226) | CORE |
| [packages/store/src/store.ts:7260](../../packages/store/src/store.ts#L7260) `Store/containerRange` | `SQLite.all` (7260); `SQLite.prepare` (7260, 7267); `Store.sql` (7260, 7267); `SQLite.get` (7267) | CORE |
| [packages/store/src/store.ts:7285](../../packages/store/src/store.ts#L7285) `Store/addContainer` | `SQLite.all` (7285); `SQLite.prepare` (7285, 7290, 7304, 7308, 7309); `Store.sql` (7285, 7290, 7304, 7306, 7308, 7309, 7311, 7314); `SQLite.get` (7295); `Store.containerRange` (7297) | CORE |
| [packages/store/src/store.ts:7331](../../packages/store/src/store.ts#L7331) `Store/addExternalContainer` | `SQLite.prepare` (7331); `Store.sql` (7331) | CORE |
| [packages/store/src/store.ts:7349](../../packages/store/src/store.ts#L7349) `Store/writeExternalFile` | `Store.evaluateEach` (7349); `SQLite.prepare` (7372); `Store.sql` (7372) | CORE |
| [packages/store/src/store.ts:7373](../../packages/store/src/store.ts#L7373) `Store/writeExternalFile/taken` | `SQLite.get` (7373) | CORE |
| [packages/store/src/store.ts:7403](../../packages/store/src/store.ts#L7403) `Store/embeddedContainers` | `SQLite.prepare` (7403, 7404); `Store.sql` (7403, 7404); `SQLite.all` (7404); `SQLite.get` (7408) | CORE |
| [packages/store/src/store.ts:7417](../../packages/store/src/store.ts#L7417) `Store/embeddedContainerCount` | `SQLite.prepare` (7417); `Store.sql` (7417); `SQLite.get` (7418) | CORE |
| [packages/store/src/store.ts:7426](../../packages/store/src/store.ts#L7426) `Store/recoverContainersOut` | `SQLite.prepare` (7426); `Store.sql` (7426); `SQLite.get` (7429) | CORE |
| [packages/store/src/store.ts:7454](../../packages/store/src/store.ts#L7454) `Store/moveContainersOut` | `Store.sql` (7454, 7462, 7464, 7466, 7471, 7472, 7492, 7498, 7500, 7502, 7502, 7508, 7508, 7513, 7515, 7517, 7517, 7523); `SQLite.get` (7462); `SQLite.prepare` (7462, 7471, 7472); `Store.container` (7474) | CORE |
| [packages/store/src/store.ts:7532](../../packages/store/src/store.ts#L7532) `Store/moveContainersIn` | `Store.sql` (7532, 7538, 7540, 7541, 7542, 7543, 7563, 7568, 7568, 7579, 7582, 7585, 7592); `SQLite.prepare` (7540, 7541, 7542, 7543, 7579, 7585); `SQLite.get` (7545, 7579, 7585) | CORE |
| [packages/store/src/store.ts:7604](../../packages/store/src/store.ts#L7604) `Store/compactFile` | `Store.sql` (7604, 7605, 7607) | CORE |
| [packages/store/src/store.ts:7613](../../packages/store/src/store.ts#L7613) `Store/containerId` | `Store.containerId` (7613); `Store.row` (7614) | CORE |
| [packages/store/src/store.ts:7636](../../packages/store/src/store.ts#L7636) `Store/checkContainerWrite` | `Store.row` (7636) | CORE |
| [packages/store/src/store.ts:7649](../../packages/store/src/store.ts#L7649) `Store/setContainer` | `Store.sql` (7649, 7663, 7668, 7671, 7671); `Store.row` (7652); `SQLite.prepare` (7663) | CORE |
| [packages/store/src/store.ts:7705](../../packages/store/src/store.ts#L7705) `Store/orderBy` | `Store.valueListItems` (7705) | CORE |
| [packages/store/src/store.ts:7728](../../packages/store/src/store.ts#L7728) `Store/userPrefs` | `SQLite.all` (7728); `SQLite.prepare` (7728); `Store.sql` (7728) | CORE |
| [packages/store/src/store.ts:7733](../../packages/store/src/store.ts#L7733) `Store/hasTable` | `SQLite.get` (7733); `SQLite.prepare` (7733); `Store.sql` (7733) | CORE |
| [packages/store/src/store.ts:7737](../../packages/store/src/store.ts#L7737) `Store/setUserPref` | `Store.sql` (7737, 7738, 7739); `SQLite.prepare` (7738, 7739) | CORE |
| [packages/store/src/store.ts:7745](../../packages/store/src/store.ts#L7745) `Store/indexedFields` | `SQLite.all` (7745, 7746); `SQLite.prepare` (7745, 7746); `Store.sql` (7745, 7746) | CORE |
| [packages/store/src/store.ts:7767](../../packages/store/src/store.ts#L7767) `Store/addFieldIndex` | `Store.sql` (7767) | CORE |
| [packages/store/src/store.ts:7779](../../packages/store/src/store.ts#L7779) `Store/dropFieldIndex` | `SQLite.get` (7779); `SQLite.prepare` (7779); `Store.sql` (7779, 7780) | CORE |
| [packages/store/src/store.ts:7790](../../packages/store/src/store.ts#L7790) `Store/timeFind` | `Store.query` (7790, 7794, 7795); `Store.recordCount` (7797) | CORE |
| [packages/store/src/store.ts:7814](../../packages/store/src/store.ts#L7814) `Store/find` | `Store.find` (7814) | GATED-STORE |
| [packages/store/src/store.ts:7825](../../packages/store/src/store.ts#L7825) `Store/findHere` | `Store.query` (7825, 7830, 7832, 7846, 7848, 7859); `Store.recordCount` (7843); `SQLite.get` (7844, 7848); `SQLite.prepare` (7844, 7848, 7854, 7861, 7870); `Store.sql` (7844, 7848, 7854, 7861, 7870); `SQLite.all` (7854, 7861, 7870) | GATED-STORE |
| [packages/store/src/store.ts:7865](../../packages/store/src/store.ts#L7865) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7865); `SQLite.prepare` (7865); `Store.sql` (7865) | GATED-STORE |
| [packages/store/src/store.ts:7898](../../packages/store/src/store.ts#L7898) `Store/sortedPage` | `SQLite.iterate` (7898); `SQLite.prepare` (7898, 7913); `Store.sql` (7898, 7913); `SQLite.all` (7913) | CORE |
| [packages/store/src/store.ts:7970](../../packages/store/src/store.ts#L7970) `Store/relatedCriteria/matched` | `relatedRows` (7970) | CORE |
| [packages/store/src/store.ts:7973](../../packages/store/src/store.ts#L7973) `Store/relatedCriteria` | `SQLite.iterate` (7973); `SQLite.prepare` (7973); `Store.sql` (7973) | CORE |
| [packages/store/src/store.ts:7999](../../packages/store/src/store.ts#L7999) `Store/computedRows` | `Store.sql` (7999, 8002, 8003, 8004, 8006, 8016, 8017, 8018, 8021); `SQLite.prepare` (8002, 8004, 8006, 8016); `SQLite.iterate` (8006); `Calculations.globalValue` (8009); `Calculations.unstoredValue` (8010); `Calculations.related` (8013); `SQLite.all` (8016) | CORE |
| [packages/store/src/store.ts:8046](../../packages/store/src/store.ts#L8046) `Store/summaries` | `Calculations.wholeTable` (8046); `Calculations.collect` (8066, 8071) | CORE |
| [packages/store/src/store.ts:8062](../../packages/store/src/store.ts#L8062) `Store/summaries/recs` | `SQLite.iterate` (8062); `SQLite.prepare` (8062); `Store.sql` (8062) | CORE |
| [packages/store/src/store.ts:8084](../../packages/store/src/store.ts#L8084) `Store/runningSummaryValues` | `Store.viewableIds` (8084); `rowsById` (8086); `Calculations.value` (8097, 8103); `Calculations.related` (8114) | GATED-STORE |
| [packages/store/src/store.ts:8130](../../packages/store/src/store.ts#L8130) `Store/findSource` | `Store.query` (8130); `SQLite.all` (8139, 8156); `SQLite.prepare` (8139, 8147, 8155); `Store.sql` (8139, 8144, 8147, 8152, 8155, 8169, 8171); `Calculations.globalValue` (8161); `Calculations.unstoredValue` (8162); `Calculations.related` (8166) | CORE |
| [packages/store/src/store.ts:8186](../../packages/store/src/store.ts#L8186) `Store/findCandidates` | `Store.query` (8186) | CORE |
| [packages/store/src/store.ts:8221](../../packages/store/src/store.ts#L8221) `Store/previewRow` | `Store.row` (8221) | CORE |
| [packages/store/src/store.ts:8239](../../packages/store/src/store.ts#L8239) `Store/row` | `SQLite.get` (8239) | CORE |
| [packages/store/src/store.ts:8258](../../packages/store/src/store.ts#L8258) `Store/getCurrent` | `Store.get` (8258); `Store.row` (8259, 8259, 8273); `SQLite.all` (8276); `SQLite.prepare` (8276); `Store.sql` (8276) | GATED-STORE |
| [packages/store/src/store.ts:8296](../../packages/store/src/store.ts#L8296) `Store/getManyCurrent` | `Store.getMany` (8296); `SQLite.get` (8314); `SQLite.prepare` (8314); `Store.sql` (8314) | GATED-STORE |
| [packages/store/src/store.ts:8307](../../packages/store/src/store.ts#L8307) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8307) | GATED-STORE |
| [packages/store/src/store.ts:8330](../../packages/store/src/store.ts#L8330) `Store/canViewRecord` | `SQLite.get` (8330); `SQLite.prepare` (8330); `Store.sql` (8330) | GATED-STORE |
| [packages/store/src/store.ts:8348](../../packages/store/src/store.ts#L8348) `Store/canView` | `Store.canView` (8348); `Store.row` (8349) | GATED-STORE |
| [packages/store/src/store.ts:8373](../../packages/store/src/store.ts#L8373) `Store/create` | `SQLite.get` (8373, 8379); `SQLite.prepare` (8373, 8379, 8392); `Store.sql` (8373, 8379, 8392) | CORE |
| [packages/store/src/store.ts:8416](../../packages/store/src/store.ts#L8416) `Store/duplicate` | `Store.row` (8416); `SQLite.get` (8420); `SQLite.prepare` (8420, 8435); `Store.sql` (8420, 8435) | CORE |
| [packages/store/src/store.ts:8487](../../packages/store/src/store.ts#L8487) `Store/update` | `Store.row` (8487, 8495, 8506); `Store.sql` (8519, 8520, 8559, 8562) | CORE |
| [packages/store/src/store.ts:8522](../../packages/store/src/store.ts#L8522) `Store/update/undo` | `Store.sql` (8522) | CORE |
| [packages/store/src/store.ts:8666](../../packages/store/src/store.ts#L8666) `Store/setStoredCalcValues` | `SQLite.prepare` (8666, 8667); `Store.sql` (8666, 8667); `SQLite.get` (8671) | CORE |
| [packages/store/src/store.ts:8754](../../packages/store/src/store.ts#L8754) `Store/evaluateCurrent` | `Store.row` (8754, 8754, 8755, 8755); `Calculations.context` (8760); `Store.get` (8761, 8763) | GATED-STORE |
| [packages/store/src/store.ts:8795](../../packages/store/src/store.ts#L8795) `Store/evaluateEachCurrent` | `Store.row` (8795, 8795, 8800); `Calculations.context` (8801); `Store.get` (8803) | GATED-STORE |
| [packages/store/src/store.ts:8836](../../packages/store/src/store.ts#L8836) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8836); `Store.get` (8838) | GATED-STORE |
| [packages/store/src/store.ts:8857](../../packages/store/src/store.ts#L8857) `Store/evaluateRowsCurrent` | `Store.row` (8857, 8857, 8858, 8858) | GATED-STORE |
| [packages/store/src/store.ts:8872](../../packages/store/src/store.ts#L8872) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8872) | GATED-STORE |
| [packages/store/src/store.ts:8894](../../packages/store/src/store.ts#L8894) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8894) | GATED-STORE |
| [packages/store/src/store.ts:8932](../../packages/store/src/store.ts#L8932) `Store/updateRelated` | `relatedRows` (8932) | CORE |
| [packages/store/src/store.ts:8950](../../packages/store/src/store.ts#L8950) `Store/updatePortals` | `Store.row` (8950, 8986); `relatedRows` (8987) | CORE |
| [packages/store/src/store.ts:8960](../../packages/store/src/store.ts#L8960) `Store/updatePortals/portal/related` | `relatedIdList` (8960) | CORE |
| [packages/store/src/store.ts:9042](../../packages/store/src/store.ts#L9042) `Store/portalContainerTarget` | `Store.row` (9042); `relatedIdList` (9044) | CORE |
| [packages/store/src/store.ts:9057](../../packages/store/src/store.ts#L9057) `Store/checkEditable` | `Store.row` (9057) | CORE |
| [packages/store/src/store.ts:9099](../../packages/store/src/store.ts#L9099) `Store/delete` | `Store.row` (9099) | CORE |
| [packages/store/src/store.ts:9107](../../packages/store/src/store.ts#L9107) `Store/delete/run` | `SQLite.get` (9107); `SQLite.prepare` (9107, 9112); `Store.sql` (9107, 9112) | CORE |
| [packages/store/src/store.ts:9334](../../packages/store/src/store.ts#L9334) `Store/keyStepWork` | `Store.sql` (9334, 9340, 9344, 9346) | CORE |
| [packages/store/src/store.ts:9137](../../packages/store/src/store.ts#L9137) `Store/vaultHeld` | `SQLite.get` (9137); `SQLite.prepare` (9137); `Store.sql` (9137) | CORE |
| [packages/store/src/store.ts:9144](../../packages/store/src/store.ts#L9144) `Store/forgetStandInValues` | `Store.sql` (9144, 9165); `SQLite.prepare` (9165) | CORE |
| [packages/store/src/store.ts:9184](../../packages/store/src/store.ts#L9184) `Store/restoreDeletedRowLocked` | `SQLite.get` (9184); `SQLite.prepare` (9184, 9185, 9189); `Store.sql` (9184, 9185, 9189); `SQLite.all` (9185) | CORE |
| [packages/store/src/store.ts:9387](../../packages/store/src/store.ts#L9387) `Store/cascadeDelete` | `relatedRows` (9387) | CORE |
| [packages/store/src/store.ts:9477](../../packages/store/src/store.ts#L9477) `Store/selectIdsCurrent` | `Store.selectIds` (9477); `SQLite.all` (9483); `SQLite.prepare` (9483); `Store.sql` (9483) | GATED-STORE |
| [packages/store/src/store.ts:9491](../../packages/store/src/store.ts#L9491) `Store/countIds` | `Store.countIds` (9491); `SQLite.get` (9495); `SQLite.prepare` (9495); `Store.sql` (9495) | GATED-STORE |
| [packages/store/src/store.ts:9511](../../packages/store/src/store.ts#L9511) `Store/computeValuesCurrent` | `Store.computeValues` (9511); `Store.sql` (9517, 9521); `SQLite.all` (9521); `SQLite.prepare` (9521) | GATED-STORE |
| [packages/store/src/store.ts:9536](../../packages/store/src/store.ts#L9536) `Store/findIdsCurrent` | `Store.findIds` (9536) | GATED-STORE |
| [packages/store/src/store.ts:9542](../../packages/store/src/store.ts#L9542) `Store/findIdsHere` | `Store.query` (9542, 9547, 9549); `SQLite.iterate` (9560); `SQLite.prepare` (9560); `Store.sql` (9560) | GATED-STORE |
| [packages/store/src/store.ts:9577](../../packages/store/src/store.ts#L9577) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9577); `Store.viewableIds` (9582); `Calculations.collect` (9598); `rowsById` (9598, 9648); `Calculations.collector` (9620) | GATED-STORE |
| [packages/store/src/store.ts:9610](../../packages/store/src/store.ts#L9610) `Store/groupSummariesCurrent/key` | `Calculations.value` (9610); `Calculations.related` (9612) | GATED-STORE |
| [packages/store/src/store.ts:9646](../../packages/store/src/store.ts#L9646) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9646) | GATED-STORE |
| [packages/store/src/store.ts:9702](../../packages/store/src/store.ts#L9702) `Store/sortIdsCurrentProgress` | `SQLite.all` (9702); `SQLite.prepare` (9702, 9770); `Store.sql` (9702, 9770); `Store.valueListItems` (9710); `rowsById` (9722); `Calculations.globalValue` (9725); `Calculations.unstoredValue` (9726); `Calculations.related` (9732); `SQLite.iterate` (9770) | GATED-STORE |
| [packages/store/src/store.ts:9784](../../packages/store/src/store.ts#L9784) `Store/matchIds` | `Store.matchIds` (9784); `SQLite.all` (9790); `SQLite.prepare` (9790); `Store.sql` (9790) | CORE |
| [packages/store/src/store.ts:9811](../../packages/store/src/store.ts#L9811) `Store/truncate/run` | `Store.sql` (9811, 9813, 9820, 9822, 9824, 9825); `SQLite.prepare` (9813, 9820); `SQLite.all` (9815) | CORE |
| [packages/store/src/store.ts:9849](../../packages/store/src/store.ts#L9849) `Store/iterateCommitted` | `SQLite.iterate` (9849) | CORE |
| [packages/store/src/store.ts:9883](../../packages/store/src/store.ts#L9883) `Store/readOnlyChecked` | `SQLite.prepare` (9883, 9887, 9896, 9901); `SQLite.all` (9887, 9896, 9901) | CORE |
| [packages/store/src/store.ts:9923](../../packages/store/src/store.ts#L9923) `Store/refreshDecimalSqlViews` | `SQLite.get` (9923); `SQLite.prepare` (9923, 9928); `SQLite.all` (9928) | CORE |
| [packages/store/src/store.ts:9942](../../packages/store/src/store.ts#L9942) `Store/internalRoots` | `SQLite.get` (9942); `SQLite.prepare` (9942, 9944); `SQLite.all` (9944) | CORE |
| [packages/store/src/store.ts:9977](../../packages/store/src/store.ts#L9977) `Store/selectCurrent` | `SQLite.iterate` (9977) | CORE |
| [packages/store/src/store.ts:10026](../../packages/store/src/store.ts#L10026) `Store/query` | `SQLite.iterate` (10026) | CORE |
| [packages/store/src/store.ts:10060](../../packages/store/src/store.ts#L10060) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10060); `SQLite.all` (10067, 10070); `SQLite.prepare` (10067, 10070) | CORE |
| [packages/store/src/store.ts:1205](../../packages/store/src/store.ts#L1205) `Store/ensureNativeIds` | `SQLite.all` (1205, 1217); `SQLite.prepare` (1205, 1208, 1216, 1217); `Store.sql` (1205, 1208, 1211, 1215, 1216, 1217, 1220, 1222) | CORE |
| [packages/store/src/store.ts:1230](../../packages/store/src/store.ts#L1230) `Store/nativeIdGuards` | `Store.sql` (1230, 1231, 1233) | CORE |
| [packages/store/src/store.ts:9993](../../packages/store/src/store.ts#L9993) `Store/selectIn` | `Store.select` (9993) | CORE |
| [packages/store/src/store.ts:10001](../../packages/store/src/store.ts#L10001) `Store/selectHeldCurrent` | `Store.sql` (10001, 10002); `SQLite.prepare` (10002); `SQLite.iterate` (10005) | CORE |
| [packages/store/src/sync-apply.ts:170](../../packages/store/src/sync-apply.ts#L170) `logRow` | `SQLite.prepare` (170); `Store.sql` (170) | OPERATOR |
| [packages/store/src/sync-apply.ts:177](../../packages/store/src/sync-apply.ts#L177) `finishRow` | `SQLite.prepare` (177); `Store.sql` (177) | OPERATOR |
| [packages/store/src/sync-apply.ts:184](../../packages/store/src/sync-apply.ts#L184) `atomically` | `Store.sql` (184, 187, 190, 191) | OPERATOR |
| [packages/store/src/sync-apply.ts:197](../../packages/store/src/sync-apply.ts#L197) `upsertMap` | `SQLite.prepare` (197); `Store.sql` (197) | OPERATOR |
| [packages/store/src/sync-apply.ts:205](../../packages/store/src/sync-apply.ts#L205) `dropMap` | `SQLite.prepare` (205, 206); `Store.sql` (205, 206) | OPERATOR |
| [packages/store/src/sync-apply.ts:241](../../packages/store/src/sync-apply.ts#L241) `heldReason` | `SQLite.get` (241); `SQLite.prepare` (241); `Store.sql` (241) | OPERATOR |
| [packages/store/src/sync-apply.ts:246](../../packages/store/src/sync-apply.ts#L246) `holdTable` | `SQLite.prepare` (246); `Store.sql` (246) | OPERATOR |
| [packages/store/src/sync-apply.ts:258](../../packages/store/src/sync-apply.ts#L258) `releaseHeldTables` | `SQLite.prepare` (258); `Store.sql` (258) | OPERATOR |
| [packages/store/src/sync-apply.ts:267](../../packages/store/src/sync-apply.ts#L267) `readSyncLog` | `SQLite.get` (267); `SQLite.prepare` (267, 269, 270); `Store.sql` (267, 269, 270); `SQLite.all` (269, 270) | OPERATOR |
| [packages/store/src/sync-apply.ts:311](../../packages/store/src/sync-apply.ts#L311) `recordsIn` | `SQLite.get` (311); `SQLite.prepare` (311); `Store.sql` (311) | OPERATOR |
| [packages/store/src/sync-apply.ts:351](../../packages/store/src/sync-apply.ts#L351) `applySyncRun` | `Store.container` (351, 352, 382); `Store.containerInfo` (368); `SQLite.prepare` (463, 729, 761, 785); `Store.sql` (463, 729, 761, 785); `SQLite.get` (761, 785) | OPERATOR |
| [packages/store/src/sync-apply.ts:484](../../packages/store/src/sync-apply.ts#L484) `applySyncRun/fail` | `SQLite.get` (484); `SQLite.prepare` (484); `Store.sql` (484) | OPERATOR |
| [packages/store/src/sync-apply.ts:675](../../packages/store/src/sync-apply.ts#L675) `applySyncRun/containerChanges` | `Store.container` (675) | OPERATOR |
| [packages/store/src/sync-apply.ts:824](../../packages/store/src/sync-apply.ts#L824) `applySyncRun/filesToSend` | `SQLite.all` (824); `SQLite.prepare` (824); `Store.sql` (824); `Store.containerInfo` (835); `Store.container` (840) | OPERATOR |
| [packages/store/src/sync-apply.ts:210](../../packages/store/src/sync-apply.ts#L210) `markContainersPending` | `SQLite.prepare` (210); `Store.sql` (210) | OPERATOR |
| [packages/store/src/sync-apply.ts:215](../../packages/store/src/sync-apply.ts#L215) `clearContainersPending` | `SQLite.prepare` (215); `Store.sql` (215) | OPERATOR |
| [packages/store/src/sync-apply.ts:230](../../packages/store/src/sync-apply.ts#L230) `owedContainers` | `SQLite.all` (230); `SQLite.prepare` (230); `Store.sql` (230) | OPERATOR |
| [packages/store/src/sync-apply.ts:579](../../packages/store/src/sync-apply.ts#L579) `applySyncRun/pullWouldChange` | `Store.container` (579, 583) | OPERATOR |
| [packages/store/src/sync.ts:45](../../packages/store/src/sync.ts#L45) `openForPlanning` | `SQLite.get` (45, 46); `SQLite.prepare` (45, 46) | OPERATOR |
| [packages/store/src/sync.ts:190](../../packages/store/src/sync.ts#L190) `tableExists` | `SQLite.get` (190); `SQLite.prepare` (190); `Store.sql` (190) | OPERATOR |
| [packages/store/src/sync.ts:200](../../packages/store/src/sync.ts#L200) `ensureSyncTables` | `Store.sql` (200, 214, 224, 232) | OPERATOR |
| [packages/store/src/sync.ts:252](../../packages/store/src/sync.ts#L252) `readSyncMap` | `SQLite.all` (252); `SQLite.prepare` (252); `Store.sql` (252) | OPERATOR |
| [packages/store/src/sync.ts:273](../../packages/store/src/sync.ts#L273) `lastPullTimestamp` | `SQLite.get` (273); `SQLite.prepare` (273); `Store.sql` (273) | OPERATOR |
| [packages/store/src/sync.ts:292](../../packages/store/src/sync.ts#L292) `readLocalRecords` | `SQLite.all` (292); `SQLite.prepare` (292); `Store.sql` (292) | OPERATOR |
| [packages/store/src/text-styles.ts:22](../../packages/store/src/text-styles.ts#L22) `ensureTextStyles` | `SQLite.all` (22, 26); `SQLite.prepare` (22, 26) | CORE |
| [packages/store/src/text-styles.ts:73](../../packages/store/src/text-styles.ts#L73) `TextStyles/st` | `SQLite.prepare` (73) | CORE |
| [packages/store/src/text-styles.ts:81](../../packages/store/src/text-styles.ts#L81) `TextStyles/has` | `SQLite.all` (81) | CORE |
| [packages/store/src/text-styles.ts:94](../../packages/store/src/text-styles.ts#L94) `TextStyles/rows` | `SQLite.all` (94) | CORE |
| [packages/store/src/trace.ts:142](../../packages/store/src/trace.ts#L142) `traceDatabase/get` | `SQLite.prepare` (142) | CORE |
| [packages/store/src/words.ts:78](../../packages/store/src/words.ts#L78) `WordIndexes/ensure` | `SQLite.prepare` (78, 82); `SQLite.get` (81); `SQLite.all` (82) | CORE |
| [packages/store/src/words.ts:85](../../packages/store/src/words.ts#L85) `WordIndexes/ensure/covers` | `SQLite.get` (85, 89); `SQLite.all` (86); `SQLite.prepare` (86, 89) | CORE |
| [packages/store/src/words.ts:155](../../packages/store/src/words.ts#L155) `WordIndexes/dropAll` | `SQLite.all` (155); `SQLite.prepare` (155) | CORE |
| [packages/server/src/oauth.ts:848](../../packages/server/src/oauth.ts#L848) `OAuthServer/endGrant` | `SQLite.prepare` (848, 849); `SQLite.all` (849) | AUTH |
| [packages/server/src/oauth.ts:804](../../packages/server/src/oauth.ts#L804) `OAuthServer/issue/write` | `SQLite.get` (804); `SQLite.prepare` (804, 805, 806) | AUTH |
| [packages/server/src/backup.ts:268](../../packages/server/src/backup.ts#L268) `backupOnceHeld` | `SQLite.get` (268); `SQLite.prepare` (268) | OPERATOR |
| [packages/store/src/store.ts:1576](../../packages/store/src/store.ts#L1576) `Store/selfContainedCopy` | `Store.sql` (1576); `SQLite.all` (1581); `SQLite.prepare` (1581, 1583, 1584, 1585) | CORE |
| [packages/store/src/store.ts:7031](../../packages/store/src/store.ts#L7031) `Store/containerReferences` | `SQLite.all` (7031, 7050, 7052, 7058, 7071, 7082, 7096); `SQLite.prepare` (7031, 7050, 7052, 7058, 7071, 7082, 7094, 7096); `Store.sql` (7031, 7050, 7052, 7058, 7071, 7082, 7094, 7096); `SQLite.get` (7094); `Store.row` (7105) | CORE |
| [packages/store/src/store.ts:7129](../../packages/store/src/store.ts#L7129) `Store/containerIntegrityReport` | `SQLite.all` (7129); `SQLite.prepare` (7129, 7140); `Store.sql` (7129, 7140); `SQLite.get` (7140) | CORE |
| [packages/store/src/store.ts:8744](../../packages/store/src/store.ts#L8744) `Store/recordViewable` | `Store.row` (8744) | GATED-STORE |
| [packages/store/src/store.ts:9085](../../packages/store/src/store.ts#L9085) `Store/deleteVisibility` | `Store.canViewRecord` (9085) | CORE |
| [packages/server/src/compaction.ts:65](../../packages/server/src/compaction.ts#L65) `compactStore` | `SQLite.get` (65, 66, 80, 88); `SQLite.prepare` (65, 66, 80, 88) | OPERATOR |
<!-- end generated read-gate inventory -->
