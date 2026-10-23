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
| [packages/cli/src/main.ts:691](../../packages/cli/src/main.ts#L691) `accountsWithPasswordOff` | `SQLite.all` (691); `SQLite.prepare` (691) | OPERATOR |
| [packages/cli/src/main.ts:720](../../packages/cli/src/main.ts#L720) `hostedRead` | `SQLite.all` (720, 723); `SQLite.prepare` (720, 723); `Store.sql` (720, 723) | OPERATOR |
| [packages/cli/src/main.ts:2346](../../packages/cli/src/main.ts#L2346) `main` | `Store.orphanContainerReport` (2346); `Store.auditLog` (2809); `SQLite.get` (3025); `SQLite.prepare` (3025) | OPERATOR |
| [packages/scripts/src/data-api-step.ts:104](../../packages/scripts/src/data-api-step.ts#L104) `respond` | `Store.get` (104, 131, 140); `Store.find` (105, 117) | SCRIPT |
| [packages/scripts/src/engine.ts:1942](../../packages/scripts/src/engine.ts#L1942) `ScriptEngine/goToLayout` | `Store.findIds` (1942) | SCRIPT |
| [packages/scripts/src/engine.ts:2286](../../packages/scripts/src/engine.ts#L2286) `ScriptEngine/foundSet` | `Store.findIds` (2286) | SCRIPT |
| [packages/scripts/src/engine.ts:2351](../../packages/scripts/src/engine.ts#L2351) `ScriptEngine/semanticFind` | `Store.findIds` (2351, 2372) | SCRIPT |
| [packages/scripts/src/engine.ts:3267](../../packages/scripts/src/engine.ts#L3267) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3267); `Calculations.executeSQL` (3274) | SCRIPT |
| [packages/scripts/src/engine.ts:3324](../../packages/scripts/src/engine.ts#L3324) `ScriptEngine/sortIds` | `Store.sortIds` (3324); `Store.valueListItems` (3330) | SCRIPT |
| [packages/scripts/src/engine.ts:3421](../../packages/scripts/src/engine.ts#L3421) `ScriptEngine/revertTransaction` | `Store.findIds` (3421) | SCRIPT |
| [packages/scripts/src/engine.ts:3981](../../packages/scripts/src/engine.ts#L3981) `ScriptEngine/step` | `Store.fieldIndex` (3981); `Store.findIds` (4115, 4214) | SCRIPT |
| [packages/scripts/src/engine.ts:5246](../../packages/scripts/src/engine.ts#L5246) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5246) | SCRIPT |
| [packages/scripts/src/engine.ts:5254](../../packages/scripts/src/engine.ts#L5254) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5254) | SCRIPT |
| [packages/scripts/src/engine.ts:5255](../../packages/scripts/src/engine.ts#L5255) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5255) | SCRIPT |
| [packages/scripts/src/engine.ts:5408](../../packages/scripts/src/engine.ts#L5408) `ScriptEngine/get` | `Store.findIds` (5408); `Store.canViewRecord` (5499); `Store.get` (5535) | SCRIPT |
| [packages/scripts/src/engine.ts:5566](../../packages/scripts/src/engine.ts#L5566) `ScriptEngine/design` | `Store.valueListItems` (5566) | SCRIPT |
| [packages/scripts/src/engine.ts:5620](../../packages/scripts/src/engine.ts#L5620) `ScriptEngine/record` | `Store.get` (5620) | SCRIPT |
| [packages/scripts/src/engine.ts:5653](../../packages/scripts/src/engine.ts#L5653) `ScriptEngine/valueOf` | `Store.findIds` (5653, 5653); `Store.containerId` (5661) | SCRIPT |
| [packages/scripts/src/engine.ts:5678](../../packages/scripts/src/engine.ts#L5678) `ScriptEngine/lookupNext` | `Store.get` (5678); `Store.row` (5679); `Calculations.context` (5681) | SCRIPT |
| [packages/scripts/src/engine.ts:5781](../../packages/scripts/src/engine.ts#L5781) `ScriptEngine/relatedIds` | `Store.findIds` (5781); `rowsById` (5789); `Store.select` (5793); `Store.matchIds` (5807); `Store.viewableIds` (5830) | SCRIPT |
| [packages/scripts/src/engine.ts:5815](../../packages/scripts/src/engine.ts#L5815) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5815) | SCRIPT |
| [packages/scripts/src/engine.ts:6304](../../packages/scripts/src/engine.ts#L6304) `ScriptEngine/exportField` | `Store.get` (6304); `Store.containerId` (6305); `Store.container` (6307) | SCRIPT |
| [packages/scripts/src/engine.ts:6455](../../packages/scripts/src/engine.ts#L6455) `ScriptEngine/relookup` | `Store.get` (6455) | SCRIPT |
| [packages/scripts/src/engine.ts:6875](../../packages/scripts/src/engine.ts#L6875) `ScriptEngine/goToList` | `Store.findIds` (6875) | SCRIPT |
| [packages/scripts/src/engine.ts:7204](../../packages/scripts/src/engine.ts#L7204) `ScriptEngine/sourceValue` | `Store.get` (7204); `Store.containerId` (7205); `Store.container` (7206) | SCRIPT |
| [packages/scripts/src/engine.ts:7944](../../packages/scripts/src/engine.ts#L7944) `ScriptEngine/containerFile` | `Store.get` (7944); `Store.containerId` (7945); `Store.container` (7946) | SCRIPT |
| [packages/scripts/src/engine.ts:8106](../../packages/scripts/src/engine.ts#L8106) `ScriptEngine/importRecords` | `Store.findIds` (8106); `Store.get` (8126) | SCRIPT |
| [packages/scripts/src/engine.ts:8337](../../packages/scripts/src/engine.ts#L8337) `ScriptEngine/fileMakerRows` | `Store.findIds` (8337); `Store.get` (8342) | SCRIPT |
| [packages/scripts/src/engine.ts:8377](../../packages/scripts/src/engine.ts#L8377) `ScriptEngine/newRecord` | `Store.findIds` (8377) | SCRIPT |
| [packages/scripts/src/engine.ts:8682](../../packages/scripts/src/engine.ts#L8682) `ScriptEngine/performFind` | `Store.findIds` (8682) | SCRIPT |
| [packages/scripts/src/engine.ts:8707](../../packages/scripts/src/engine.ts#L8707) `ScriptEngine/findRelated` | `Store.findIds` (8707, 8717, 8720) | SCRIPT |
| [packages/scripts/src/engine.ts:8739](../../packages/scripts/src/engine.ts#L8739) `ScriptEngine/quickFind` | `Store.findIds` (8739, 8740, 8743) | SCRIPT |
| [packages/scripts/src/engine.ts:9127](../../packages/scripts/src/engine.ts#L9127) `clearRecords` | `SQLite.all` (9127); `SQLite.prepare` (9127) | SCRIPT |
| [packages/scripts/src/recorder.ts:83](../../packages/scripts/src/recorder.ts#L83) `lastSeq` | `Store.auditLog` (83) | DESIGN |
| [packages/scripts/src/recorder.ts:121](../../packages/scripts/src/recorder.ts#L121) `recordRun` | `Store.auditLog` (121) | DESIGN |
| [packages/scripts/src/script-tests.ts:213](../../packages/scripts/src/script-tests.ts#L213) `runCase` | `Store.findIds` (213); `Store.auditLog` (220, 221, 265); `Store.evaluateEach` (248) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/server/src/admin.ts:1029](../../packages/server/src/admin.ts#L1029) `Admin/handle` | `Store.externalContainerReport` (1029); `Store.orphanContainerReport` (1034, 1038) | ADMIN |
| [packages/server/src/admin.ts:2204](../../packages/server/src/admin.ts#L2204) `Admin/audit` | `Store.auditLog` (2204) | ADMIN |
| [packages/server/src/admin.ts:2287](../../packages/server/src/admin.ts#L2287) `Admin/viewAs` | `Store.find` (2287) | ADMIN |
| [packages/server/src/admin.ts:2635](../../packages/server/src/admin.ts#L2635) `Admin/status` | `Store.externalContainerCount` (2635) | ADMIN |
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
| [packages/server/src/assistant.ts:2146](../../packages/server/src/assistant.ts#L2146) `Assistant/answer` | `Store.find` (2146) | ACCOUNT |
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
| [packages/server/src/containers.ts:134](../../packages/server/src/containers.ts#L134) `ContainerFiles/send` | `Store.containerInfo` (134); `Store.container` (200); `Store.containerRange` (209) | CONTAINER |
| [packages/server/src/containers.ts:301](../../packages/server/src/containers.ts#L301) `ContainerFiles/make` | `Store.containerInfo` (301) | CONTAINER |
| [packages/server/src/containers.ts:313](../../packages/server/src/containers.ts#L313) `ContainerFiles/makeAdmitted` | `Store.container` (313) | CONTAINER |
| [packages/server/src/conversion-guide.ts:118](../../packages/server/src/conversion-guide.ts#L118) `convertedAt` | `SQLite.get` (118); `SQLite.prepare` (118); `Store.sql` (118) | DESIGN |
| [packages/server/src/conversion-guide.ts:367](../../packages/server/src/conversion-guide.ts#L367) `ConversionGuides/table` | `Store.sql` (367) | DESIGN |
| [packages/server/src/conversion-guide.ts:377](../../packages/server/src/conversion-guide.ts#L377) `ConversionGuides/saved` | `SQLite.get` (377); `SQLite.prepare` (377); `Store.sql` (377) | DESIGN |
| [packages/server/src/conversion-guide.ts:386](../../packages/server/src/conversion-guide.ts#L386) `ConversionGuides/save` | `SQLite.prepare` (386); `Store.sql` (386) | DESIGN |
| [packages/server/src/conversion.ts:308](../../packages/server/src/conversion.ts#L308) `conversionReport` | `Store.externalContainerCheck` (308) | DESIGN |
| [packages/server/src/cwp-xml.ts:457](../../packages/server/src/cwp-xml.ts#L457) `CwpXmlEndpoint/records` | `Store.find` (457, 459, 460, 466, 469); `Store.get` (465, 473) | XML |
| [packages/server/src/cwp-xml.ts:541](../../packages/server/src/cwp-xml.ts#L541) `CwpXmlEndpoint/layoutDoc` | `Store.valueListItems` (541) | XML |
| [packages/server/src/dashboards.ts:359](../../packages/server/src/dashboards.ts#L359) `Dashboards/table` | `Store.sql` (359) | DASHBOARD |
| [packages/server/src/dashboards.ts:369](../../packages/server/src/dashboards.ts#L369) `Dashboards/list` | `SQLite.all` (369); `SQLite.prepare` (369); `Store.sql` (369) | DASHBOARD |
| [packages/server/src/dashboards.ts:375](../../packages/server/src/dashboards.ts#L375) `Dashboards/get` | `SQLite.get` (375); `SQLite.prepare` (375); `Store.sql` (375) | DASHBOARD |
| [packages/server/src/dashboards.ts:389](../../packages/server/src/dashboards.ts#L389) `Dashboards/create` | `SQLite.prepare` (389); `Store.sql` (389) | DASHBOARD |
| [packages/server/src/dashboards.ts:402](../../packages/server/src/dashboards.ts#L402) `Dashboards/update` | `SQLite.prepare` (402); `Store.sql` (402) | DASHBOARD |
| [packages/server/src/dashboards.ts:409](../../packages/server/src/dashboards.ts#L409) `Dashboards/delete` | `SQLite.prepare` (409); `Store.sql` (409) | DASHBOARD |
| [packages/server/src/dataapi.ts:1953](../../packages/server/src/dataapi.ts#L1953) `DataApi/route` | `Store.get` (1953, 2175, 2198, 2206, 2253, 2277, 2297, 2334); `Store.valueListItems` (1968); `Store.find` (2130, 2177, 2367); `Store.findIds` (2134, 2372); `Store.query` (2372) | REST |
| [packages/server/src/dataapi.ts:2082](../../packages/server/src/dataapi.ts#L2082) `DataApi/route/recordOut` | `Store.portalCounts` (2082) | REST |
| [packages/server/src/dataapi.ts:2118](../../packages/server/src/dataapi.ts#L2118) `DataApi/route/shownAs` | `Store.get` (2118) | REST |
| [packages/server/src/debug.ts:192](../../packages/server/src/debug.ts#L192) `learnStoredCredentials` | `Calculations.globalValue` (192); `Store.sql` (198, 208, 208); `SQLite.iterate` (208, 208); `SQLite.prepare` (208, 208); `Store.iterateCommitted` (208) | DESIGN |
| [packages/server/src/debug.ts:343](../../packages/server/src/debug.ts#L343) `DebugApi/handle` | `Store.row` (343, 472); `Store.get` (352, 477); `Store.evaluate` (376) | DESIGN |
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
| [packages/server/src/import-mapping.ts:984](../../packages/server/src/import-mapping.ts#L984) `applyImportAddStream` | `SQLite.prepare` (984); `Store.sql` (984) | IMPORT |
| [packages/server/src/import-mapping.ts:781](../../packages/server/src/import-mapping.ts#L781) `targetKeys` | `SQLite.all` (781); `SQLite.prepare` (781); `Store.sql` (781) | IMPORT |
| [packages/server/src/import-mapping.ts:793](../../packages/server/src/import-mapping.ts#L793) `journal` | `Store.sql` (793, 796, 797, 798, 799, 800); `SQLite.all` (796); `SQLite.prepare` (796) | IMPORT |
| [packages/server/src/import-mapping.ts:863](../../packages/server/src/import-mapping.ts#L863) `importHistory` | `SQLite.all` (863); `SQLite.prepare` (863); `Store.sql` (863) | IMPORT |
| [packages/server/src/import-mapping.ts:870](../../packages/server/src/import-mapping.ts#L870) `undoImportRun` | `SQLite.get` (870, 902); `SQLite.prepare` (870, 902, 916); `Store.sql` (870, 902, 916) | IMPORT |
| [packages/server/src/import-mapping.ts:805](../../packages/server/src/import-mapping.ts#L805) `fileIdentity` | `Store.sql` (805, 806, 807); `SQLite.prepare` (806, 807); `SQLite.get` (807) | IMPORT |
| [packages/server/src/insight.ts:346](../../packages/server/src/insight.ts#L346) `webViewerScripts` | `Store.query` (346) | DESIGN |
| [packages/server/src/insight.ts:809](../../packages/server/src/insight.ts#L809) `layoutProfile/viewableIds` | `Store.viewableIds` (809) | PROFILE |
| [packages/server/src/insight.ts:813](../../packages/server/src/insight.ts#L813) `layoutProfile` | `Store.query` (813) | PROFILE |
| [packages/server/src/insight.ts:889](../../packages/server/src/insight.ts#L889) `columnProfile` | `Store.query` (889, 896, 908, 911) | PROFILE |
| [packages/server/src/insight.ts:968](../../packages/server/src/insight.ts#L968) `checkCalculation` | `Store.findIds` (968); `Store.evaluate` (972) | DESIGN |
| [packages/server/src/insight.ts:1151](../../packages/server/src/insight.ts#L1151) `solutionOverview/counts` | `Store.query` (1151) | DESIGN |
| [packages/server/src/live.ts:137](../../packages/server/src/live.ts#L137) `Live/handle` | `Store.canViewRecord` (137, 144); `Store.canView` (189) | LIVE |
| [packages/server/src/live.ts:291](../../packages/server/src/live.ts#L291) `Live/stream/listener` | `Store.canViewRecord` (291, 293) | LIVE |
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
| [packages/server/src/oauth.ts:191](../../packages/server/src/oauth.ts#L191) `OAuthServer/constructor` | `SQLite.all` (191); `SQLite.prepare` (191, 218, 220, 229, 230, 233); `SQLite.iterate` (218); `SQLite.get` (220); `Store.sql` (220, 229) | AUTH |
| [packages/server/src/oauth.ts:364](../../packages/server/src/oauth.ts#L364) `OAuthServer/register` | `SQLite.prepare` (364, 365, 366, 367, 368); `SQLite.get` (365, 367) | AUTH |
| [packages/server/src/oauth.ts:384](../../packages/server/src/oauth.ts#L384) `OAuthServer/client` | `SQLite.get` (384); `SQLite.prepare` (384) | AUTH |
| [packages/server/src/oauth.ts:485](../../packages/server/src/oauth.ts#L485) `OAuthServer/authorize/done` | `SQLite.prepare` (485, 486) | AUTH |
| [packages/server/src/oauth.ts:504](../../packages/server/src/oauth.ts#L504) `OAuthServer/authorize` | `SQLite.get` (504); `SQLite.prepare` (504, 508, 510, 517, 540, 541) | AUTH |
| [packages/server/src/oauth.ts:696](../../packages/server/src/oauth.ts#L696) `OAuthServer/token` | `SQLite.get` (696, 727, 729, 732, 745); `SQLite.prepare` (696, 727, 729, 732, 741, 744, 745, 745, 747, 749) | AUTH |
| [packages/server/src/oauth.ts:837](../../packages/server/src/oauth.ts#L837) `OAuthServer/sweep` | `SQLite.all` (837); `SQLite.prepare` (837, 839, 840, 841, 842) | AUTH |
| [packages/server/src/oauth.ts:891](../../packages/server/src/oauth.ts#L891) `OAuthServer/revoke` | `SQLite.get` (891, 892, 902, 903); `SQLite.prepare` (891, 892, 895, 902, 903, 907) | AUTH |
| [packages/server/src/oauth.ts:874](../../packages/server/src/oauth.ts#L874) `OAuthServer/managedAccess` | `SQLite.get` (874); `SQLite.prepare` (874) | AUTH |
| [packages/server/src/oauth.ts:878](../../packages/server/src/oauth.ts#L878) `OAuthServer/accessAllowed` | `SQLite.get` (878); `SQLite.prepare` (878) | AUTH |
| [packages/server/src/odata-crossjoin-worker.ts:40](../../packages/server/src/odata-crossjoin-worker.ts#L40) `join` | `SQLite.prepare` (40, 49, 58, 73); `SQLite.get` (58); `SQLite.all` (73) | JOIN |
| [packages/server/src/odata.ts:931](../../packages/server/src/odata.ts#L931) `ODataEndpoint/resource` | `Store.countIds` (931); `Store.get` (971, 978, 1085) | ODATA |
| [packages/server/src/odata.ts:1217](../../packages/server/src/odata.ts#L1217) `ODataEndpoint/lambdaFor` | `Store.selectIds` (1217); `Store.row` (1226); `relatedIdList` (1227) | ODATA |
| [packages/server/src/odata.ts:1280](../../packages/server/src/odata.ts#L1280) `ODataEndpoint/list` | `Store.selectIds` (1280); `Store.getMany` (1285); `Store.computeValues` (1286); `Store.countIds` (1291) | ODATA |
| [packages/server/src/odata.ts:1338](../../packages/server/src/odata.ts#L1338) `ODataEndpoint/applied` | `Store.selectIds` (1338); `SQLite.prepare` (1353, 1390, 1403, 1407); `Store.getMany` (1364); `SQLite.all` (1403); `SQLite.get` (1407) | ODATA |
| [packages/server/src/odata.ts:1457](../../packages/server/src/odata.ts#L1457) `ODataEndpoint/crossjoined` | `Store.selectIds` (1457); `Store.getMany` (1486, 1521) | ODATA |
| [packages/server/src/odata.ts:1557](../../packages/server/src/odata.ts#L1557) `ODataEndpoint/entity` | `Store.getMany` (1557) | ODATA |
| [packages/server/src/odata.ts:1598](../../packages/server/src/odata.ts#L1598) `ODataEndpoint/relatedIds` | `Store.row` (1598); `relatedIdList` (1601, 1616); `Store.selectIds` (1605); `Store.viewableIds` (1615) | ODATA |
| [packages/server/src/odata.ts:1624](../../packages/server/src/odata.ts#L1624) `ODataEndpoint/relatedRecords` | `Store.getMany` (1624) | ODATA |
| [packages/server/src/odata.ts:1648](../../packages/server/src/odata.ts#L1648) `ODataEndpoint/property` | `Store.containerId` (1648); `Store.container` (1654) | ODATA |
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
| [packages/server/src/pgwire.ts:791](../../packages/server/src/pgwire.ts#L791) `Connection/translate` | `Calculations.translateSQL` (791) | SQL |
| [packages/server/src/pgwire.ts:826](../../packages/server/src/pgwire.ts#L826) `Connection/catalog` | `Store.describe` (826) | SQL |
| [packages/server/src/pgwire.ts:837](../../packages/server/src/pgwire.ts#L837) `Connection/run` | `Store.selectIn` (837) | SQL |
| [packages/server/src/pgwire.ts:964](../../packages/server/src/pgwire.ts#L964) `Connection/validateSyntax` | `SQLite.prepare` (964); `Store.sql` (964) | SQL |
| [packages/server/src/pgwire.ts:1198](../../packages/server/src/pgwire.ts#L1198) `Connection/describe` | `Store.describe` (1198) | SQL |
| [packages/server/src/pgwire.ts:812](../../packages/server/src/pgwire.ts#L812) `Connection/bareNames` | `Store.describe` (812) | SQL |
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
| [packages/server/src/record-context.ts:112](../../packages/server/src/record-context.ts#L112) `describeRecord` | `Store.row` (112); `Store.get` (121); `keyValue` (127); `Store.viewableIds` (154); `relatedRows` (158, 163) | RECORD |
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
| [packages/server/src/sql.ts:102](../../packages/server/src/sql.ts#L102) `SqlEndpoint/handle` | `Calculations.translateSQL` (102); `Store.select` (107) | SQL |
| [packages/server/src/sql.ts:160](../../packages/server/src/sql.ts#L160) `SqlEndpoint/tables` | `SQLite.all` (160); `SQLite.prepare` (160); `Store.sql` (160) | SQL |
| [packages/server/src/standby.ts:281](../../packages/server/src/standby.ts#L281) `Standby/copy` | `SQLite.get` (281); `SQLite.prepare` (281) | OPERATOR |
| [packages/server/src/summarize.ts:69](../../packages/server/src/summarize.ts#L69) `summarizeRecords` | `Store.findIds` (69); `Store.select` (126, 133, 143) | SUMMARY |
| [packages/server/src/summarize.ts:184](../../packages/server/src/summarize.ts#L184) `summarizeByRecord` | `Store.evaluateEach` (184); `Store.row` (186) | SUMMARY |
| [packages/server/src/sync-console.ts:458](../../packages/server/src/sync-console.ts#L458) `SyncConsole/runCheck` | `Store.sql` (458) | DESIGN |
| [packages/server/src/sync-console.ts:463](../../packages/server/src/sync-console.ts#L463) `SyncConsole/runCheck/assertActive` | `Store.sql` (463) | DESIGN |
| [packages/server/src/warm-worker.ts:19](../../packages/server/src/warm-worker.ts#L19) `message/count` | `Store.recordCount` (19) | INTERNAL |
| [packages/server/src/warm-worker.ts:34](../../packages/server/src/warm-worker.ts#L34) `message` | `Store.find` (34) | INTERNAL |
| [packages/server/src/webclient.ts:529](../../packages/server/src/webclient.ts#L529) `WebClient/history` | `Store.get` (529) | WEB |
| [packages/server/src/webclient.ts:666](../../packages/server/src/webclient.ts#L666) `WebClient/explain` | `Store.get` (666); `Store.row` (699, 712) | WEB |
| [packages/server/src/webclient.ts:725](../../packages/server/src/webclient.ts#L725) `WebClient/index` | `Store.fieldIndex` (725) | WEB |
| [packages/server/src/webclient.ts:815](../../packages/server/src/webclient.ts#L815) `WebClient/menus` | `Store.evaluateEach` (815) | WEB |
| [packages/server/src/webclient.ts:1031](../../packages/server/src/webclient.ts#L1031) `WebClient/view` | `Store.evaluateEach` (1031, 1055, 1074); `Store.canView` (1049); `Store.previewRow` (1053, 1075); `Store.get` (1066); `Store.row` (1067, 1067) | WEB |
| [packages/server/src/webclient.ts:1052](../../packages/server/src/webclient.ts#L1052) `WebClient/view/get` | `Store.get` (1052) | WEB |
| [packages/server/src/webclient.ts:1117](../../packages/server/src/webclient.ts#L1117) `WebClient/refresh` | `Store.previewRow` (1117); `Store.getMany` (1122); `Store.foundSetRows` (1144) | WEB |
| [packages/server/src/webclient.ts:1156](../../packages/server/src/webclient.ts#L1156) `WebClient/foundIds` | `Store.findIds` (1156) | WEB |
| [packages/server/src/webclient.ts:1171](../../packages/server/src/webclient.ts#L1171) `WebClient/records` | `Store.getMany` (1171); `Store.find` (1174) | WEB |
| [packages/server/src/webclient.ts:1200](../../packages/server/src/webclient.ts#L1200) `WebClient/foundSetPortal` | `Store.foundSetRows` (1200, 1207) | WEB |
| [packages/server/src/webclient.ts:1240](../../packages/server/src/webclient.ts#L1240) `WebClient/charts/foundSet` | `Store.findIds` (1240) | WEB |
| [packages/server/src/webclient.ts:1249](../../packages/server/src/webclient.ts#L1249) `WebClient/charts` | `Calculations.context` (1249); `Store.canView` (1277); `Store.evaluateEach` (1286, 1290); `Store.evaluateRows` (1295, 1297) | WEB |
| [packages/server/src/webclient.ts:1280](../../packages/server/src/webclient.ts#L1280) `WebClient/charts/get` | `Store.get` (1280) | WEB |
| [packages/server/src/webclient.ts:1469](../../packages/server/src/webclient.ts#L1469) `WebClient/exportRecords` | `Store.getMany` (1469) | WEB |
| [packages/server/src/webclient.ts:1363](../../packages/server/src/webclient.ts#L1363) `WebClient/streamExportRecords/nextBatch` | `Store.selectIds` (1363); `Store.getMany` (1369) | WEB |
| [packages/server/src/webclient.ts:1663](../../packages/server/src/webclient.ts#L1663) `WebClient/aiReplace` | `Store.canView` (1663); `Store.getMany` (1679) | WEB |
| [packages/server/src/webclient.ts:1739](../../packages/server/src/webclient.ts#L1739) `WebClient/groups` | `Store.findIds` (1739); `Store.groupSummaries` (1745) | WEB |
| [packages/server/src/webclient.ts:1847](../../packages/server/src/webclient.ts#L1847) `WebClient/button` | `Store.findIds` (1847, 1897); `Store.evaluateEach` (1856, 1857) | WEB |
| [packages/server/src/webclient.ts:2547](../../packages/server/src/webclient.ts#L2547) `listItems` | `Store.valueListItems` (2547) | WEB |
| [packages/server/src/webclient.ts:2626](../../packages/server/src/webclient.ts#L2626) `foundIds` | `Store.findIds` (2626, 2628) | WEB |
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
| [packages/store/src/calc.ts:340](../../packages/store/src/calc.ts#L340) `Calculations/meta` | `SQLite.get` (340); `SQLite.prepare` (340); `Store.sql` (340) | CALC |
| [packages/store/src/calc.ts:345](../../packages/store/src/calc.ts#L345) `Calculations/saveMeta` | `SQLite.prepare` (345); `Store.sql` (345) | CALC |
| [packages/store/src/calc.ts:358](../../packages/store/src/calc.ts#L358) `Calculations/globalValue` | `SQLite.get` (358); `SQLite.prepare` (358); `Store.sql` (358) | CALC |
| [packages/store/src/calc.ts:382](../../packages/store/src/calc.ts#L382) `Calculations/setNextSerial` | `Store.sql` (382, 383, 389, 391, 391) | CALC |
| [packages/store/src/calc.ts:530](../../packages/store/src/calc.ts#L530) `Calculations/value` | `Calculations.globalValue` (530) | CALC |
| [packages/store/src/calc.ts:2554](../../packages/store/src/calc.ts#L2554) `Calculations/uniqueCollision` | `Calculations.value` (2554) | CALC |
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
| [packages/store/src/calc.ts:2116](../../packages/store/src/calc.ts#L2116) `Calculations/translateSQL` | `Store.scopedTableSql` (2116, 2147) | CALC |
| [packages/store/src/calc.ts:2179](../../packages/store/src/calc.ts#L2179) `Calculations/shareColumn` | `Store.recordCount` (2179) | CALC |
| [packages/store/src/calc.ts:2211](../../packages/store/src/calc.ts#L2211) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2211) | CALC |
| [packages/store/src/calc.ts:2248](../../packages/store/src/calc.ts#L2248) `Calculations/computeColumn` | `Calculations.statement` (2248); `SQLite.get` (2248); `Calculations.value` (2251) | CALC |
| [packages/store/src/calc.ts:2385](../../packages/store/src/calc.ts#L2385) `Calculations/beforeWrite` | `relatedRows` (2385); `Calculations.related` (2439); `Calculations.context` (2452) | CORE |
| [packages/store/src/calc.ts:2503](../../packages/store/src/calc.ts#L2503) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2503); `Calculations.value` (2503) | CALC |
| [packages/store/src/calc.ts:2518](../../packages/store/src/calc.ts#L2518) `Calculations/computeStoredStyled` | `Calculations.context` (2518) | CORE |
| [packages/store/src/calc.ts:2567](../../packages/store/src/calc.ts#L2567) `Calculations/validate/fail` | `Calculations.context` (2567) | CALC |
| [packages/store/src/calc.ts:2581](../../packages/store/src/calc.ts#L2581) `Calculations/validate` | `Calculations.value` (2581); `Store.valueListItems` (2602); `Calculations.context` (2616) | CALC |
| [packages/store/src/calc.ts:2678](../../packages/store/src/calc.ts#L2678) `nearest` | `SQLite.get` (2678); `SQLite.prepare` (2678); `Store.sql` (2678) | CALC |
| [packages/store/src/calc.ts:2763](../../packages/store/src/calc.ts#L2763) `containerValue` | `Store.containerInfo` (2763); `Store.containerRange` (2770); `Store.container` (2771) | CALC |
| [packages/store/src/calc.ts:2779](../../packages/store/src/calc.ts#L2779) `containerValue/read` | `Store.container` (2779) | CALC |
| [packages/store/src/calc.ts:2792](../../packages/store/src/calc.ts#L2792) `containerValue/value` | `Store.containerRange` (2792) | CALC |
| [packages/store/src/calc.ts:2910](../../packages/store/src/calc.ts#L2910) `sameValuesElsewhere` | `SQLite.all` (2910); `SQLite.prepare` (2910, 2917, 2919); `Store.sql` (2910, 2917, 2919); `Calculations.value` (2912); `SQLite.get` (2917, 2919) | CALC |
| [packages/store/src/calc.ts:3223](../../packages/store/src/calc.ts#L3223) `rowsById/flush` | `Calculations.statement` (3223); `SQLite.iterate` (3223) | CALC |
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
| [packages/store/src/stale-calcs.ts:277](../../packages/store/src/stale-calcs.ts#L277) `RefreshJournal/constructor` | `Store.sql` (277) | DESIGN |
| [packages/store/src/stale-calcs.ts:283](../../packages/store/src/stale-calcs.ts#L283) `RefreshJournal/add` | `SQLite.prepare` (283); `Store.sql` (283) | DESIGN |
| [packages/store/src/stale-calcs.ts:289](../../packages/store/src/stale-calcs.ts#L289) `RefreshJournal/get` | `SQLite.get` (289); `SQLite.prepare` (289); `Store.sql` (289) | DESIGN |
| [packages/store/src/stale-calcs.ts:294](../../packages/store/src/stale-calcs.ts#L294) `RefreshJournal/list` | `SQLite.all` (294); `SQLite.prepare` (294); `Store.sql` (294) | DESIGN |
| [packages/store/src/stale-calcs.ts:298](../../packages/store/src/stale-calcs.ts#L298) `RefreshJournal/markUndone` | `SQLite.prepare` (298); `Store.sql` (298) | DESIGN |
| [packages/store/src/stale-calcs.ts:205](../../packages/store/src/stale-calcs.ts#L205) `refreshStaleCalcsBatch` | `Store.sql` (205, 210, 228, 231); `SQLite.iterate` (210); `SQLite.prepare` (210) | DESIGN |
| [packages/store/src/stale-calcs.ts:243](../../packages/store/src/stale-calcs.ts#L243) `undoStaleRefreshBatch` | `Store.sql` (243, 261, 263) | DESIGN |
| [packages/store/src/store-format.ts:32](../../packages/store/src/store-format.ts#L32) `storedFormat` | `SQLite.get` (32); `SQLite.prepare` (32) | CORE |
| [packages/store/src/store-format.ts:50](../../packages/store/src/store-format.ts#L50) `checkFormat` | `SQLite.prepare` (50) | CORE |
| [packages/store/src/store.ts:917](../../packages/store/src/store.ts#L917) `Store/metadataVersions` | `SQLite.get` (917); `SQLite.prepare` (917); `Store.sql` (917) | CORE |
| [packages/store/src/store.ts:1056](../../packages/store/src/store.ts#L1056) `Store/constructor` | `Store.sql` (1056, 1058, 1060, 1061, 1065, 1069, 1070, 1081, 1086, 1091, 1092, 1096, 1097, 1098, 1105, 1109, 1113, 1114, 1115, 1120, 1124, 1127, 1128, 1130, 1131, 1134, 1135, 1139, 1140, 1144, 1145, 1148, 1150, 1153, 1154, 1158, 1159, 1163, 1164, 1167, 1168, 1169, 1172, 1173, 1176, 1177, 1179, 1179, 1180, 1180, 1181, 1184, 1188, 1190, 1193, 1194, 1195, 1198, 1199, 1201, 1203, 1204, 1208, 1209, 1211, 1215, 1217, 1218, 1219, 1219, 1223, 1224); `SQLite.get` (1060); `SQLite.prepare` (1060, 1127, 1128, 1131, 1134, 1139, 1144, 1153, 1158, 1163, 1172, 1176, 1179, 1180, 1198, 1203, 1208); `SQLite.all` (1127, 1134, 1139, 1144, 1153, 1158, 1163, 1172, 1176, 1179, 1180, 1198, 1203, 1208) | CORE |
| [packages/store/src/store.ts:1281](../../packages/store/src/store.ts#L1281) `Store/grantFullAccessClients` | `SQLite.prepare` (1281); `Store.sql` (1281) | CORE |
| [packages/store/src/store.ts:1304](../../packages/store/src/store.ts#L1304) `Store/meta` | `SQLite.get` (1304); `SQLite.prepare` (1304); `Store.sql` (1304) | CORE |
| [packages/store/src/store.ts:3579](../../packages/store/src/store.ts#L3579) `Store/webViewerChecked` | `SQLite.get` (3579); `SQLite.prepare` (3579); `Store.sql` (3579) | CORE |
| [packages/store/src/store.ts:1312](../../packages/store/src/store.ts#L1312) `Store/persistentTable` | `Store.sql` (1312) | CORE |
| [packages/store/src/store.ts:1322](../../packages/store/src/store.ts#L1322) `Store/persistentData` | `SQLite.get` (1322) | CORE |
| [packages/store/src/store.ts:1331](../../packages/store/src/store.ts#L1331) `Store/persistentDataIds` | `SQLite.all` (1331) | CORE |
| [packages/store/src/store.ts:1337](../../packages/store/src/store.ts#L1337) `Store/setPersistentData` | `SQLite.prepare` (1337, 1341); `Store.sql` (1337, 1341) | CORE |
| [packages/store/src/store.ts:1361](../../packages/store/src/store.ts#L1361) `Store/checkpoint` | `SQLite.get` (1361); `SQLite.prepare` (1361); `Store.sql` (1361) | CORE |
| [packages/store/src/store.ts:1369](../../packages/store/src/store.ts#L1369) `Store/recordedFormat` | `Store.sql` (1369) | CORE |
| [packages/store/src/store.ts:1379](../../packages/store/src/store.ts#L1379) `Store/close` | `Store.sql` (1379) | CORE |
| [packages/store/src/store.ts:1395](../../packages/store/src/store.ts#L1395) `Store/shipWal` | `Store.sql` (1395) | CORE |
| [packages/store/src/store.ts:1406](../../packages/store/src/store.ts#L1406) `Store/trial` | `Store.sql` (1406) | CORE |
| [packages/store/src/store.ts:1411](../../packages/store/src/store.ts#L1411) `Store/trial/undo` | `Store.sql` (1411) | CORE |
| [packages/store/src/store.ts:1507](../../packages/store/src/store.ts#L1507) `Store/joinTransaction` | `Store.sql` (1507, 1508, 1510, 1512, 1518) | CORE |
| [packages/store/src/store.ts:1530](../../packages/store/src/store.ts#L1530) `Store/independentWindowWrite` | `SQLite.get` (1530); `SQLite.prepare` (1530, 1560); `Store.sql` (1530, 1539, 1555, 1560, 1563) | CORE |
| [packages/store/src/store.ts:1592](../../packages/store/src/store.ts#L1592) `Store/withWriteTransaction` | `Store.sql` (1592, 1603, 1609, 1611, 1611) | CORE |
| [packages/store/src/store.ts:1661](../../packages/store/src/store.ts#L1661) `Store/endTransaction` | `Store.sql` (1661, 1664, 1664) | CORE |
| [packages/store/src/store.ts:1691](../../packages/store/src/store.ts#L1691) `Store/backup` | `Store.sql` (1691) | CORE |
| [packages/store/src/store.ts:1781](../../packages/store/src/store.ts#L1781) `Store/dataVersion` | `SQLite.get` (1781); `SQLite.prepare` (1781); `Store.sql` (1781) | CORE |
| [packages/store/src/store.ts:1821](../../packages/store/src/store.ts#L1821) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1821) | CORE |
| [packages/store/src/store.ts:1842](../../packages/store/src/store.ts#L1842) `Store/shareResults` | `Store.sql` (1842) | CORE |
| [packages/store/src/store.ts:1852](../../packages/store/src/store.ts#L1852) `Store/versionTriggers` | `SQLite.get` (1852); `SQLite.prepare` (1852, 1857, 1858); `Store.sql` (1852, 1854, 1855, 1857, 1858, 1867, 1868); `SQLite.all` (1857, 1858) | CORE |
| [packages/store/src/store.ts:1884](../../packages/store/src/store.ts#L1884) `Store/versionNumber` | `SQLite.get` (1884); `SQLite.prepare` (1884); `Store.sql` (1884) | CORE |
| [packages/store/src/store.ts:1897](../../packages/store/src/store.ts#L1897) `Store/changeOne` | `Store.sql` (1897, 1899) | CORE |
| [packages/store/src/store.ts:1900](../../packages/store/src/store.ts#L1900) `Store/changeOne/read` | `SQLite.get` (1900); `SQLite.prepare` (1900); `Store.sql` (1900) | CORE |
| [packages/store/src/store.ts:1939](../../packages/store/src/store.ts#L1939) `Store/writeToken` | `SQLite.get` (1939); `SQLite.prepare` (1939); `Store.sql` (1939) | CORE |
| [packages/store/src/store.ts:1951](../../packages/store/src/store.ts#L1951) `Store/recordCount` | `SQLite.get` (1951); `SQLite.prepare` (1951); `Store.sql` (1951) | CORE |
| [packages/store/src/store.ts:2065](../../packages/store/src/store.ts#L2065) `Store/applyDesign` | `Store.sql` (2065, 2066, 2079, 2082, 2087, 2103, 2106, 2106); `SQLite.prepare` (2082, 2087) | CORE |
| [packages/store/src/store.ts:2164](../../packages/store/src/store.ts#L2164) `Store/auditLog` | `SQLite.all` (2164); `SQLite.prepare` (2164); `Store.sql` (2164) | CORE |
| [packages/store/src/store.ts:2204](../../packages/store/src/store.ts#L2204) `Store/securityEvents` | `Store.auditLog` (2204) | CORE |
| [packages/store/src/store.ts:2230](../../packages/store/src/store.ts#L2230) `Store/prepared` | `SQLite.prepare` (2230); `Store.sql` (2230) | CORE |
| [packages/store/src/store.ts:2245](../../packages/store/src/store.ts#L2245) `Store/recordAsOf` | `SQLite.get` (2245, 2247); `SQLite.prepare` (2245, 2247, 2249, 2250); `Store.sql` (2245, 2247, 2249, 2250); `SQLite.all` (2249, 2250) | CORE |
| [packages/store/src/store.ts:2323](../../packages/store/src/store.ts#L2323) `Store/revertAuditEntry` | `Store.auditLog` (2323) | CORE |
| [packages/store/src/store.ts:2416](../../packages/store/src/store.ts#L2416) `Store/setAuditSettings` | `SQLite.prepare` (2416); `Store.sql` (2416) | CORE |
| [packages/store/src/store.ts:2438](../../packages/store/src/store.ts#L2438) `Store/pruneAudit` | `Store.sql` (2438, 2440, 2442); `SQLite.get` (2440); `SQLite.prepare` (2440) | CORE |
| [packages/store/src/store.ts:2520](../../packages/store/src/store.ts#L2520) `Store/audit` | `Store.sql` (2520) | CORE |
| [packages/store/src/store.ts:2613](../../packages/store/src/store.ts#L2613) `Store/securityChange` | `Store.sql` (2613, 2615); `SQLite.prepare` (2615) | CORE |
| [packages/store/src/store.ts:2662](../../packages/store/src/store.ts#L2662) `Store/logSecurity` | `Store.sql` (2662) | CORE |
| [packages/store/src/store.ts:2685](../../packages/store/src/store.ts#L2685) `Store/ensureDeleted` | `Store.sql` (2685) | CORE |
| [packages/store/src/store.ts:2690](../../packages/store/src/store.ts#L2690) `Store/deletedRows` | `SQLite.get` (2690); `SQLite.prepare` (2690, 2692, 2692); `Store.sql` (2690, 2692, 2692); `SQLite.all` (2692, 2692) | CORE |
| [packages/store/src/store.ts:2716](../../packages/store/src/store.ts#L2716) `Store/emptyDeleted` | `Store.sql` (2716, 2719, 2720, 2722, 2724); `SQLite.prepare` (2720) | CORE |
| [packages/store/src/store.ts:2731](../../packages/store/src/store.ts#L2731) `Store/designHistory` | `SQLite.all` (2731); `SQLite.prepare` (2731); `Store.sql` (2731) | CORE |
| [packages/store/src/store.ts:2738](../../packages/store/src/store.ts#L2738) `Store/scriptHistory` | `SQLite.all` (2738); `SQLite.prepare` (2738); `Store.sql` (2738) | CORE |
| [packages/store/src/store.ts:2748](../../packages/store/src/store.ts#L2748) `Store/layoutHistory` | `SQLite.all` (2748); `SQLite.prepare` (2748); `Store.sql` (2748) | CORE |
| [packages/store/src/store.ts:2777](../../packages/store/src/store.ts#L2777) `Store/designEffect/renameKey` | `SQLite.prepare` (2777); `Store.sql` (2777) | CORE |
| [packages/store/src/store.ts:2793](../../packages/store/src/store.ts#L2793) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2793); `Store.sql` (2793) | CORE |
| [packages/store/src/store.ts:2800](../../packages/store/src/store.ts#L2800) `Store/designEffect` | `Store.sql` (2800, 2805, 2810, 2815, 2818, 2824, 2835, 2836, 2838, 2851, 2852, 2855, 2857, 2863, 2864, 2865, 2870, 2872, 2876, 2879, 2880, 2882, 2885, 2891, 2893, 2900, 2901, 2903, 2904, 2905, 2906, 2913, 2914, 2916, 2916, 2918, 2919, 2920, 2924, 2928, 2930, 2968, 2970, 2972); `SQLite.get` (2835, 2851, 2863, 2864, 2876, 2880, 2916, 2924); `SQLite.prepare` (2835, 2836, 2851, 2852, 2863, 2864, 2870, 2872, 2876, 2880, 2891, 2893, 2906, 2913, 2914, 2916, 2918, 2920, 2924, 2928); `SQLite.all` (2913, 2914); `SQLite.iterate` (2918) | CORE |
| [packages/store/src/store.ts:2980](../../packages/store/src/store.ts#L2980) `Store/dropColumnIndexes` | `SQLite.all` (2980, 2982); `SQLite.prepare` (2980, 2982); `Store.sql` (2980, 2982, 2983) | CORE |
| [packages/store/src/store.ts:2992](../../packages/store/src/store.ts#L2992) `Store/recompute` | `SQLite.prepare` (2992, 2996); `Store.sql` (2992, 2996); `SQLite.iterate` (2996); `Calculations.computeStoredStyled` (2997); `Calculations.value` (2997) | CORE |
| [packages/store/src/store.ts:3012](../../packages/store/src/store.ts#L3012) `Store/linkPrincipal` | `SQLite.get` (3012); `SQLite.prepare` (3012); `Store.sql` (3012) | CORE |
| [packages/store/src/store.ts:3020](../../packages/store/src/store.ts#L3020) `Store/linkIdentity` | `SQLite.get` (3020); `SQLite.prepare` (3020); `Store.sql` (3020) | CORE |
| [packages/store/src/store.ts:3045](../../packages/store/src/store.ts#L3045) `Store/credentialIdentity` | `SQLite.get` (3045); `SQLite.prepare` (3045); `Store.sql` (3045) | CORE |
| [packages/store/src/store.ts:3051](../../packages/store/src/store.ts#L3051) `Store/accountsSharingLockout` | `SQLite.all` (3051); `SQLite.prepare` (3051); `Store.sql` (3051) | CORE |
| [packages/store/src/store.ts:3055](../../packages/store/src/store.ts#L3055) `Store/accounts` | `SQLite.all` (3055); `SQLite.prepare` (3055); `Store.sql` (3055) | CORE |
| [packages/store/src/store.ts:3067](../../packages/store/src/store.ts#L3067) `Store/isAgent` | `SQLite.get` (3067); `SQLite.prepare` (3067); `Store.sql` (3067) | CORE |
| [packages/store/src/store.ts:3073](../../packages/store/src/store.ts#L3073) `Store/agentNeedsApproval` | `SQLite.get` (3073); `SQLite.prepare` (3073); `Store.sql` (3073) | CORE |
| [packages/store/src/store.ts:3079](../../packages/store/src/store.ts#L3079) `Store/blankPasswordAccounts` | `SQLite.all` (3079); `SQLite.prepare` (3079); `Store.sql` (3079) | CORE |
| [packages/store/src/store.ts:1289](../../packages/store/src/store.ts#L1289) `Store/hasOwnPassword` | `SQLite.get` (1289); `SQLite.prepare` (1289); `Store.sql` (1289) | CORE |
| [packages/store/src/store.ts:3090](../../packages/store/src/store.ts#L3090) `Store/unmigratedAccounts` | `SQLite.all` (3090); `SQLite.prepare` (3090); `Store.sql` (3090) | CORE |
| [packages/store/src/store.ts:3143](../../packages/store/src/store.ts#L3143) `Store/setExternalAccount` | `SQLite.get` (3143); `SQLite.prepare` (3143, 3148); `Store.sql` (3143, 3148) | CORE |
| [packages/store/src/store.ts:3161](../../packages/store/src/store.ts#L3161) `Store/refuseLookalikeAccount` | `SQLite.all` (3161); `SQLite.prepare` (3161); `Store.sql` (3161) | CORE |
| [packages/store/src/store.ts:3170](../../packages/store/src/store.ts#L3170) `Store/isExternal` | `SQLite.get` (3170); `SQLite.prepare` (3170); `Store.sql` (3170) | CORE |
| [packages/store/src/store.ts:3191](../../packages/store/src/store.ts#L3191) `Store/setAgentAccount` | `SQLite.get` (3191); `SQLite.prepare` (3191, 3197); `Store.sql` (3191, 3197) | CORE |
| [packages/store/src/store.ts:3231](../../packages/store/src/store.ts#L3231) `Store/gateAgentWrite` | `SQLite.get` (3231); `SQLite.prepare` (3231, 3233); `Store.sql` (3231, 3233) | CORE |
| [packages/store/src/store.ts:3255](../../packages/store/src/store.ts#L3255) `Store/pendingChanges` | `SQLite.all` (3255); `SQLite.prepare` (3255); `Store.sql` (3255) | CORE |
| [packages/store/src/store.ts:3269](../../packages/store/src/store.ts#L3269) `Store/approvePending` | `SQLite.get` (3269); `SQLite.prepare` (3269, 3280); `Store.sql` (3269, 3280) | CORE |
| [packages/store/src/store.ts:3290](../../packages/store/src/store.ts#L3290) `Store/rejectPending` | `SQLite.get` (3290); `SQLite.prepare` (3290, 3292); `Store.sql` (3290, 3292) | CORE |
| [packages/store/src/store.ts:3312](../../packages/store/src/store.ts#L3312) `Store/externalAccount` | `SQLite.all` (3312); `SQLite.prepare` (3312); `Store.sql` (3312) | CORE |
| [packages/store/src/store.ts:3343](../../packages/store/src/store.ts#L3343) `Store/setPassword` | `SQLite.get` (3343); `SQLite.prepare` (3343, 3345, 3354); `Store.sql` (3343, 3345, 3354) | AUTH |
| [packages/store/src/store.ts:3368](../../packages/store/src/store.ts#L3368) `Store/createAccount` | `SQLite.get` (3368); `SQLite.prepare` (3368, 3372, 3378, 3383, 3388); `Store.sql` (3368, 3372, 3378, 3383, 3388) | CORE |
| [packages/store/src/store.ts:3396](../../packages/store/src/store.ts#L3396) `Store/appendSecurityEvent` | `Store.sql` (3396) | CORE |
| [packages/store/src/store.ts:3438](../../packages/store/src/store.ts#L3438) `Store/setPasswordPolicy` | `SQLite.prepare` (3438); `Store.sql` (3438) | CORE |
| [packages/store/src/store.ts:3474](../../packages/store/src/store.ts#L3474) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3474); `Store.sql` (3474) | CORE |
| [packages/store/src/store.ts:3497](../../packages/store/src/store.ts#L3497) `Store/saveScriptTest` | `SQLite.prepare` (3497); `Store.sql` (3497) | CORE |
| [packages/store/src/store.ts:3506](../../packages/store/src/store.ts#L3506) `Store/deleteScriptTest` | `SQLite.prepare` (3506); `Store.sql` (3506) | CORE |
| [packages/store/src/store.ts:3541](../../packages/store/src/store.ts#L3541) `Store/setAiAllowed` | `SQLite.prepare` (3541); `Store.sql` (3541) | CORE |
| [packages/store/src/store.ts:3608](../../packages/store/src/store.ts#L3608) `Store/setAiPolicy` | `SQLite.prepare` (3608); `Store.sql` (3608) | CORE |
| [packages/store/src/store.ts:3556](../../packages/store/src/store.ts#L3556) `Store/setScriptNetwork` | `SQLite.prepare` (3556); `Store.sql` (3556) | CORE |
| [packages/store/src/store.ts:3597](../../packages/store/src/store.ts#L3597) `Store/setWebViewerHosts` | `SQLite.prepare` (3597); `Store.sql` (3597) | CORE |
| [packages/store/src/store.ts:3628](../../packages/store/src/store.ts#L3628) `Store/setPiiIsolation` | `SQLite.prepare` (3628); `Store.sql` (3628) | CORE |
| [packages/store/src/store.ts:3650](../../packages/store/src/store.ts#L3650) `Store/markPiiField` | `SQLite.prepare` (3650); `Store.sql` (3650) | CORE |
| [packages/store/src/store.ts:3764](../../packages/store/src/store.ts#L3764) `Store/lastSignIns` | `Store.auditLog` (3764) | CORE |
| [packages/store/src/store.ts:3967](../../packages/store/src/store.ts#L3967) `Store/unusualAccess` | `Store.auditLog` (3967, 4033) | CORE |
| [packages/store/src/store.ts:4064](../../packages/store/src/store.ts#L4064) `Store/leastPrivilege` | `SQLite.all` (4064); `SQLite.prepare` (4064); `Store.sql` (4064) | CORE |
| [packages/store/src/store.ts:4137](../../packages/store/src/store.ts#L4137) `Store/unusedAccess` | `SQLite.get` (4137); `SQLite.prepare` (4137, 4146); `Store.sql` (4137, 4146); `SQLite.all` (4146) | CORE |
| [packages/store/src/store.ts:4185](../../packages/store/src/store.ts#L4185) `Store/unusedObjects` | `SQLite.get` (4185); `SQLite.prepare` (4185, 4188); `Store.sql` (4185, 4188); `SQLite.all` (4188) | CORE |
| [packages/store/src/store.ts:4223](../../packages/store/src/store.ts#L4223) `Store/usageCounting` | `SQLite.get` (4223); `SQLite.prepare` (4223); `Store.sql` (4223) | CORE |
| [packages/store/src/store.ts:4231](../../packages/store/src/store.ts#L4231) `Store/setMustChangePassword` | `SQLite.prepare` (4231); `Store.sql` (4231) | CORE |
| [packages/store/src/store.ts:4245](../../packages/store/src/store.ts#L4245) `Store/mustChangePassword` | `SQLite.get` (4245); `SQLite.prepare` (4245); `Store.sql` (4245) | CORE |
| [packages/store/src/store.ts:4284](../../packages/store/src/store.ts#L4284) `Store/passwordDaysRemaining` | `SQLite.get` (4284); `SQLite.prepare` (4284); `Store.sql` (4284) | CORE |
| [packages/store/src/store.ts:4291](../../packages/store/src/store.ts#L4291) `Store/importAccounts` | `SQLite.all` (4291); `SQLite.prepare` (4291); `Store.sql` (4291) | CORE |
| [packages/store/src/store.ts:4314](../../packages/store/src/store.ts#L4314) `Store/canonicalAccount` | `SQLite.all` (4314); `SQLite.prepare` (4314); `Store.sql` (4314) | CORE |
| [packages/store/src/store.ts:4326](../../packages/store/src/store.ts#L4326) `Store/createLocalAccount` | `SQLite.prepare` (4326); `Store.sql` (4326) | CORE |
| [packages/store/src/store.ts:4356](../../packages/store/src/store.ts#L4356) `Store/previewAccountImport` | `Store.sql` (4356, 4357, 4366) | CORE |
| [packages/store/src/store.ts:4374](../../packages/store/src/store.ts#L4374) `Store/limitAccountImport` | `SQLite.prepare` (4374, 4375, 4378); `Store.sql` (4374, 4375, 4378); `SQLite.get` (4375) | CORE |
| [packages/store/src/store.ts:4385](../../packages/store/src/store.ts#L4385) `Store/applyAccountImport` | `Store.sql` (4385, 4393, 4422); `SQLite.get` (4393); `SQLite.prepare` (4393, 4422) | CORE |
| [packages/store/src/store.ts:4447](../../packages/store/src/store.ts#L4447) `Store/forgetStandIns` | `SQLite.prepare` (4447); `Store.sql` (4447) | CORE |
| [packages/store/src/store.ts:4480](../../packages/store/src/store.ts#L4480) `Store/deleteAccount` | `SQLite.prepare` (4480, 4484, 4485, 4486, 4487, 4488, 4489, 4490, 4491, 4498, 4500, 4503, 4507); `Store.sql` (4480, 4484, 4485, 4486, 4487, 4488, 4489, 4490, 4491, 4498, 4500, 4503, 4507) | CORE |
| [packages/store/src/store.ts:4524](../../packages/store/src/store.ts#L4524) `Store/setAccountActive` | `SQLite.prepare` (4524, 4527, 4528); `Store.sql` (4524, 4527, 4528) | AUTH |
| [packages/store/src/store.ts:4538](../../packages/store/src/store.ts#L4538) `Store/accountInactive` | `SQLite.get` (4538); `SQLite.prepare` (4538); `Store.sql` (4538) | CORE |
| [packages/store/src/store.ts:4543](../../packages/store/src/store.ts#L4543) `Store/identityAllowed` | `SQLite.get` (4543, 4549, 4555); `SQLite.prepare` (4543, 4549, 4555); `Store.sql` (4543, 4549, 4555) | CORE |
| [packages/store/src/store.ts:4564](../../packages/store/src/store.ts#L4564) `Store/externalIdentityId` | `SQLite.get` (4564, 4570); `SQLite.prepare` (4564, 4569, 4570); `Store.sql` (4564, 4569, 4570) | CORE |
| [packages/store/src/store.ts:4575](../../packages/store/src/store.ts#L4575) `Store/accountIdentityId` | `SQLite.get` (4575, 4580); `SQLite.prepare` (4575, 4579, 4580); `Store.sql` (4575, 4579, 4580) | CORE |
| [packages/store/src/store.ts:4603](../../packages/store/src/store.ts#L4603) `Store/signInMark` | `SQLite.prepare` (4603); `Store.sql` (4603) | AUTH |
| [packages/store/src/store.ts:4613](../../packages/store/src/store.ts#L4613) `Store/signInBase` | `SQLite.get` (4613); `SQLite.prepare` (4613); `Store.sql` (4613) | AUTH |
| [packages/store/src/store.ts:4615](../../packages/store/src/store.ts#L4615) `Store/signInBase/identity` | `SQLite.get` (4615); `SQLite.prepare` (4615); `Store.sql` (4615) | AUTH |
| [packages/store/src/store.ts:4627](../../packages/store/src/store.ts#L4627) `Store/ledgerRow` | `SQLite.get` (4627, 4628); `SQLite.prepare` (4627, 4628); `Store.sql` (4627, 4628) | AUTH |
| [packages/store/src/store.ts:4639](../../packages/store/src/store.ts#L4639) `Store/ledgerWrite` | `Store.sql` (4639, 4640, 4642, 4644, 4647, 4647) | AUTH |
| [packages/store/src/store.ts:4666](../../packages/store/src/store.ts#L4666) `Store/settleSignIns` | `SQLite.all` (4666, 4672); `SQLite.prepare` (4666, 4672, 4678, 4682, 4684); `Store.sql` (4666, 4672, 4678, 4682, 4684) | AUTH |
| [packages/store/src/store.ts:4695](../../packages/store/src/store.ts#L4695) `Store/securityToken` | `SQLite.get` (4695); `SQLite.prepare` (4695); `Store.sql` (4695) | CORE |
| [packages/store/src/store.ts:4703](../../packages/store/src/store.ts#L4703) `Store/accountLocalOnly` | `SQLite.get` (4703); `SQLite.prepare` (4703); `Store.sql` (4703) | CORE |
| [packages/store/src/store.ts:4708](../../packages/store/src/store.ts#L4708) `Store/accountRequires2fa` | `SQLite.get` (4708); `SQLite.prepare` (4708); `Store.sql` (4708) | CORE |
| [packages/store/src/store.ts:4714](../../packages/store/src/store.ts#L4714) `Store/setAccountLocalOnly` | `SQLite.prepare` (4714); `Store.sql` (4714) | CORE |
| [packages/store/src/store.ts:4723](../../packages/store/src/store.ts#L4723) `Store/setAccountRequire2fa` | `SQLite.prepare` (4723); `Store.sql` (4723) | CORE |
| [packages/store/src/store.ts:4752](../../packages/store/src/store.ts#L4752) `Store/createApiToken` | `SQLite.get` (4752, 4780); `SQLite.prepare` (4752, 4779, 4780, 4787); `Store.sql` (4752, 4779, 4780, 4787) | CORE |
| [packages/store/src/store.ts:4834](../../packages/store/src/store.ts#L4834) `Store/recordObjectUse` | `Store.sql` (4834) | CORE |
| [packages/store/src/store.ts:4864](../../packages/store/src/store.ts#L4864) `Store/writeUsage` | `Store.sql` (4864, 4865, 4867, 4871, 4873) | CORE |
| [packages/store/src/store.ts:4880](../../packages/store/src/store.ts#L4880) `Store/writeUsageRows` | `SQLite.prepare` (4880, 4881, 4887); `Store.sql` (4880, 4881, 4887) | CORE |
| [packages/store/src/store.ts:4892](../../packages/store/src/store.ts#L4892) `Store/writeObjectUseRows` | `SQLite.prepare` (4892, 4893, 4898); `Store.sql` (4892, 4893, 4898) | CORE |
| [packages/store/src/store.ts:4903](../../packages/store/src/store.ts#L4903) `Store/objectUseSince` | `SQLite.get` (4903); `SQLite.prepare` (4903); `Store.sql` (4903) | CORE |
| [packages/store/src/store.ts:4916](../../packages/store/src/store.ts#L4916) `Store/accountUsage` | `SQLite.get` (4916); `SQLite.prepare` (4916, 4917); `Store.sql` (4916, 4917); `SQLite.all` (4917); `Store.auditLog` (4933) | CORE |
| [packages/store/src/store.ts:4949](../../packages/store/src/store.ts#L4949) `Store/apiTokens` | `SQLite.all` (4949); `SQLite.prepare` (4949); `Store.sql` (4949) | CORE |
| [packages/store/src/store.ts:4959](../../packages/store/src/store.ts#L4959) `Store/revokeApiToken` | `SQLite.prepare` (4959); `Store.sql` (4959) | CORE |
| [packages/store/src/store.ts:4973](../../packages/store/src/store.ts#L4973) `Store/apiToken` | `SQLite.get` (4973); `SQLite.prepare` (4973, 4985); `Store.sql` (4973, 4985) | CORE |
| [packages/store/src/store.ts:5001](../../packages/store/src/store.ts#L5001) `Store/enrollTotp` | `SQLite.prepare` (5001); `Store.sql` (5001) | CORE |
| [packages/store/src/store.ts:5012](../../packages/store/src/store.ts#L5012) `Store/confirmTotp` | `SQLite.get` (5012); `SQLite.prepare` (5012, 5014); `Store.sql` (5012, 5014) | CORE |
| [packages/store/src/store.ts:5022](../../packages/store/src/store.ts#L5022) `Store/hasTotp` | `SQLite.get` (5022); `SQLite.prepare` (5022); `Store.sql` (5022) | CORE |
| [packages/store/src/store.ts:5027](../../packages/store/src/store.ts#L5027) `Store/totpAccounts` | `SQLite.all` (5027); `SQLite.prepare` (5027); `Store.sql` (5027) | CORE |
| [packages/store/src/store.ts:5033](../../packages/store/src/store.ts#L5033) `Store/disableTotp` | `SQLite.prepare` (5033); `Store.sql` (5033) | CORE |
| [packages/store/src/store.ts:5056](../../packages/store/src/store.ts#L5056) `Store/verifyTotp` | `SQLite.get` (5056); `SQLite.prepare` (5056, 5062); `Store.sql` (5056, 5062) | CORE |
| [packages/store/src/store.ts:5075](../../packages/store/src/store.ts#L5075) `Store/issueWebauthnChallenge` | `SQLite.prepare` (5075, 5077, 5078, 5080); `Store.sql` (5075, 5077, 5078, 5080); `SQLite.get` (5077) | CORE |
| [packages/store/src/store.ts:5127](../../packages/store/src/store.ts#L5127) `Store/passkeyAllowList` | `SQLite.all` (5127); `SQLite.prepare` (5127); `Store.sql` (5127) | CORE |
| [packages/store/src/store.ts:5141](../../packages/store/src/store.ts#L5141) `Store/takeWebauthnChallenge` | `SQLite.get` (5141); `SQLite.prepare` (5141, 5143); `Store.sql` (5141, 5143) | CORE |
| [packages/store/src/store.ts:5151](../../packages/store/src/store.ts#L5151) `Store/passkeys` | `SQLite.all` (5151); `SQLite.prepare` (5151); `Store.sql` (5151) | CORE |
| [packages/store/src/store.ts:5158](../../packages/store/src/store.ts#L5158) `Store/hasPasskey` | `SQLite.get` (5158); `SQLite.prepare` (5158); `Store.sql` (5158) | CORE |
| [packages/store/src/store.ts:5163](../../packages/store/src/store.ts#L5163) `Store/passkeyIds` | `SQLite.all` (5163); `SQLite.prepare` (5163); `Store.sql` (5163) | CORE |
| [packages/store/src/store.ts:5185](../../packages/store/src/store.ts#L5185) `Store/registerPasskey` | `SQLite.prepare` (5185); `Store.sql` (5185) | CORE |
| [packages/store/src/store.ts:5196](../../packages/store/src/store.ts#L5196) `Store/removePasskey` | `SQLite.get` (5196); `SQLite.prepare` (5196, 5197); `Store.sql` (5196, 5197) | CORE |
| [packages/store/src/store.ts:5213](../../packages/store/src/store.ts#L5213) `Store/verifyPasskeyAssertion` | `SQLite.get` (5213); `SQLite.prepare` (5213, 5224); `Store.sql` (5213, 5224) | CORE |
| [packages/store/src/store.ts:5294](../../packages/store/src/store.ts#L5294) `Store/generateRecoveryCodes` | `SQLite.prepare` (5294, 5297); `Store.sql` (5294, 5297) | CORE |
| [packages/store/src/store.ts:5312](../../packages/store/src/store.ts#L5312) `Store/recoveryCodesRemaining` | `SQLite.get` (5312); `SQLite.prepare` (5312); `Store.sql` (5312) | CORE |
| [packages/store/src/store.ts:5253](../../packages/store/src/store.ts#L5253) `Store/unusedRecoveryHashes` | `SQLite.all` (5253); `SQLite.prepare` (5253); `Store.sql` (5253) | CORE |
| [packages/store/src/store.ts:5356](../../packages/store/src/store.ts#L5356) `Store/consumeRecoveryCode` | `SQLite.prepare` (5356); `Store.sql` (5356) | CORE |
| [packages/store/src/store.ts:5369](../../packages/store/src/store.ts#L5369) `Store/privilegeSets` | `Store.sql` (5369) | CORE |
| [packages/store/src/store.ts:5398](../../packages/store/src/store.ts#L5398) `Store/savePrivilegeSet` | `SQLite.prepare` (5398, 5406); `Store.sql` (5398, 5406) | AUTH |
| [packages/store/src/store.ts:5441](../../packages/store/src/store.ts#L5441) `Store/deletePrivilegeSet` | `SQLite.prepare` (5441); `Store.sql` (5441) | CORE |
| [packages/store/src/store.ts:5510](../../packages/store/src/store.ts#L5510) `Store/accountPrivilegeSet` | `SQLite.get` (5510); `SQLite.prepare` (5510); `Store.sql` (5510) | CORE |
| [packages/store/src/store.ts:5524](../../packages/store/src/store.ts#L5524) `Store/setAccountPrivilegeSet` | `SQLite.get` (5524); `SQLite.prepare` (5524, 5527, 5531); `Store.sql` (5524, 5527, 5531) | AUTH |
| [packages/store/src/store.ts:5546](../../packages/store/src/store.ts#L5546) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5546); `Store.sql` (5546) | CORE |
| [packages/store/src/store.ts:5560](../../packages/store/src/store.ts#L5560) `Store/addProvisionedAccount` | `SQLite.get` (5560); `SQLite.prepare` (5560, 5564); `Store.sql` (5560, 5564) | CORE |
| [packages/store/src/store.ts:5733](../../packages/store/src/store.ts#L5733) `Store/ruleOutcome` | `Calculations.context` (5733) | CORE |
| [packages/store/src/store.ts:5774](../../packages/store/src/store.ts#L5774) `Store/allowedIds` | `SQLite.iterate` (5774); `SQLite.prepare` (5774); `Store.sql` (5774) | CORE |
| [packages/store/src/store.ts:5872](../../packages/store/src/store.ts#L5872) `Store/scopedTableSql` | `Store.viewableIds` (5872); `SQLite.all` (5875); `SQLite.prepare` (5875); `Store.sql` (5875) | GATED-STORE |
| [packages/store/src/store.ts:5907](../../packages/store/src/store.ts#L5907) `Store/previewRecordRuleCurrent` | `SQLite.get` (5907); `SQLite.prepare` (5907, 5910); `Store.sql` (5907, 5910); `SQLite.all` (5910); `Calculations.context` (5916, 5932) | CORE |
| [packages/store/src/store.ts:6084](../../packages/store/src/store.ts#L6084) `Store/passwordHash` | `SQLite.get` (6084); `SQLite.prepare` (6084); `Store.sql` (6084) | CORE |
| [packages/store/src/store.ts:6113](../../packages/store/src/store.ts#L6113) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (6113); `Store.sql` (6113) | CORE |
| [packages/store/src/store.ts:6126](../../packages/store/src/store.ts#L6126) `Store/knownSharedAccount` | `SQLite.get` (6126); `SQLite.prepare` (6126); `Store.sql` (6126) | CORE |
| [packages/store/src/store.ts:6189](../../packages/store/src/store.ts#L6189) `Store/layouts` | `SQLite.all` (6189); `SQLite.prepare` (6189); `Store.sql` (6189) | CORE |
| [packages/store/src/store.ts:6210](../../packages/store/src/store.ts#L6210) `Store/image` | `SQLite.get` (6210); `SQLite.prepare` (6210); `Store.sql` (6210) | CORE |
| [packages/store/src/store.ts:6220](../../packages/store/src/store.ts#L6220) `Store/images` | `SQLite.all` (6220); `SQLite.prepare` (6220); `Store.sql` (6220) | CORE |
| [packages/store/src/store.ts:6233](../../packages/store/src/store.ts#L6233) `Store/addImage` | `Store.sql` (6233, 6234); `SQLite.prepare` (6234) | CORE |
| [packages/store/src/store.ts:6250](../../packages/store/src/store.ts#L6250) `Store/layout` | `SQLite.get` (6250); `SQLite.prepare` (6250); `Store.sql` (6250) | CORE |
| [packages/store/src/store.ts:6454](../../packages/store/src/store.ts#L6454) `Store/wordIndex` | `Store.sql` (6454, 6462, 6467); `Store.recordCount` (6466); `SQLite.get` (6467); `SQLite.prepare` (6467) | CORE |
| [packages/store/src/store.ts:6519](../../packages/store/src/store.ts#L6519) `Store/toRecord` | `Calculations.value` (6519, 6529); `Calculations.globalValue` (6523); `Calculations.unstoredStyled` (6528) | CORE |
| [packages/store/src/store.ts:6578](../../packages/store/src/store.ts#L6578) `Store/relatedValues` | `Calculations.globalValue` (6578); `Calculations.unstoredValue` (6580) | CORE |
| [packages/store/src/store.ts:6652](../../packages/store/src/store.ts#L6652) `Store/addRelated` | `relatedRows` (6652); `rowsById` (6684); `firstRelatedEach` (6707) | CORE |
| [packages/store/src/store.ts:6735](../../packages/store/src/store.ts#L6735) `Store/foundSetPage` | `rowsById` (6735) | CORE |
| [packages/store/src/store.ts:6751](../../packages/store/src/store.ts#L6751) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6751); `Store.row` (6767) | GATED-STORE |
| [packages/store/src/store.ts:6790](../../packages/store/src/store.ts#L6790) `Store/portalCountsCurrent` | `Store.canView` (6790); `Store.row` (6817) | GATED-STORE |
| [packages/store/src/store.ts:6853](../../packages/store/src/store.ts#L6853) `Store/fieldIndexCurrent` | `SQLite.iterate` (6853); `SQLite.prepare` (6853, 6858); `Store.sql` (6853, 6858); `SQLite.all` (6858) | GATED-STORE |
| [packages/store/src/store.ts:6899](../../packages/store/src/store.ts#L6899) `Store/valueListItemsCurrent` | `Store.valueListItems` (6899); `Store.get` (6913); `relatedRows` (6914); `Store.row` (6914); `SQLite.iterate` (6916); `SQLite.prepare` (6916); `Store.sql` (6916); `Calculations.related` (6926); `Calculations.value` (6930, 6931) | GATED-STORE |
| [packages/store/src/store.ts:7028](../../packages/store/src/store.ts#L7028) `Store/portalRows` | `relatedRows` (7028); `relatedIdList` (7029); `Store.viewableIds` (7032); `rowsById` (7057, 7095); `Calculations.related` (7071) | CORE |
| [packages/store/src/store.ts:7039](../../packages/store/src/store.ts#L7039) `Store/portalRows/context` | `Calculations.context` (7039) | CORE |
| [packages/store/src/store.ts:7049](../../packages/store/src/store.ts#L7049) `Store/portalRows/valueOf` | `Calculations.value` (7049) | CORE |
| [packages/store/src/store.ts:7166](../../packages/store/src/store.ts#L7166) `Store/markRepeating` | `SQLite.prepare` (7166); `Store.sql` (7166) | CORE |
| [packages/store/src/store.ts:7193](../../packages/store/src/store.ts#L7193) `Store/externalContainerCheck` | `SQLite.all` (7193); `SQLite.prepare` (7193); `Store.sql` (7193) | CORE |
| [packages/store/src/store.ts:7200](../../packages/store/src/store.ts#L7200) `Store/externalContainerCount` | `SQLite.get` (7200); `SQLite.prepare` (7200); `Store.sql` (7200) | CORE |
| [packages/store/src/store.ts:7209](../../packages/store/src/store.ts#L7209) `Store/externalContainerReport` | `SQLite.all` (7209, 7222); `SQLite.prepare` (7209, 7222); `Store.sql` (7209, 7222) | CORE |
| [packages/store/src/store.ts:7358](../../packages/store/src/store.ts#L7358) `Store/orphanContainerReport` | `SQLite.all` (7358); `SQLite.prepare` (7358); `Store.sql` (7358) | CORE |
| [packages/store/src/store.ts:7393](../../packages/store/src/store.ts#L7393) `Store/purgeOrphanContainers` | `Store.sql` (7393, 7397, 7406, 7409, 7410, 7415, 7416, 7418, 7418); `Store.orphanContainerReport` (7401); `SQLite.get` (7406); `SQLite.prepare` (7406, 7409, 7410) | CORE |
| [packages/store/src/store.ts:7431](../../packages/store/src/store.ts#L7431) `Store/containerIntact` | `SQLite.get` (7431); `SQLite.prepare` (7431); `Store.sql` (7431) | CORE |
| [packages/store/src/store.ts:7441](../../packages/store/src/store.ts#L7441) `Store/externalOf` | `SQLite.get` (7441); `SQLite.prepare` (7441); `Store.sql` (7441) | CORE |
| [packages/store/src/store.ts:7445](../../packages/store/src/store.ts#L7445) `Store/containerMeta` | `SQLite.get` (7445); `SQLite.prepare` (7445); `Store.sql` (7445) | CORE |
| [packages/store/src/store.ts:7450](../../packages/store/src/store.ts#L7450) `Store/container` | `SQLite.get` (7450); `SQLite.prepare` (7450, 7459); `Store.sql` (7450, 7459); `SQLite.all` (7459) | CORE |
| [packages/store/src/store.ts:7467](../../packages/store/src/store.ts#L7467) `Store/containerInfo` | `SQLite.get` (7467); `SQLite.prepare` (7467); `Store.sql` (7467) | CORE |
| [packages/store/src/store.ts:7501](../../packages/store/src/store.ts#L7501) `Store/containerRange` | `SQLite.all` (7501); `SQLite.prepare` (7501, 7508); `Store.sql` (7501, 7508); `SQLite.get` (7508) | CORE |
| [packages/store/src/store.ts:7526](../../packages/store/src/store.ts#L7526) `Store/addContainer` | `SQLite.all` (7526); `SQLite.prepare` (7526, 7531, 7545, 7549, 7550); `Store.sql` (7526, 7531, 7545, 7547, 7549, 7550, 7552, 7555); `SQLite.get` (7536); `Store.containerRange` (7538) | CORE |
| [packages/store/src/store.ts:7572](../../packages/store/src/store.ts#L7572) `Store/addExternalContainer` | `SQLite.prepare` (7572); `Store.sql` (7572) | CORE |
| [packages/store/src/store.ts:7590](../../packages/store/src/store.ts#L7590) `Store/writeExternalFile` | `Store.evaluateEach` (7590); `SQLite.prepare` (7613); `Store.sql` (7613) | CORE |
| [packages/store/src/store.ts:7614](../../packages/store/src/store.ts#L7614) `Store/writeExternalFile/taken` | `SQLite.get` (7614) | CORE |
| [packages/store/src/store.ts:7674](../../packages/store/src/store.ts#L7674) `Store/embeddedContainers` | `SQLite.prepare` (7674, 7675); `Store.sql` (7674, 7675); `SQLite.all` (7675); `SQLite.get` (7679) | CORE |
| [packages/store/src/store.ts:7688](../../packages/store/src/store.ts#L7688) `Store/embeddedContainerCount` | `SQLite.prepare` (7688); `Store.sql` (7688); `SQLite.get` (7689) | CORE |
| [packages/store/src/store.ts:7697](../../packages/store/src/store.ts#L7697) `Store/recoverContainersOut` | `SQLite.prepare` (7697); `Store.sql` (7697); `SQLite.get` (7700) | CORE |
| [packages/store/src/store.ts:7725](../../packages/store/src/store.ts#L7725) `Store/moveContainersOut` | `Store.sql` (7725, 7733, 7735, 7737, 7742, 7743, 7763, 7769, 7771, 7773, 7773, 7779, 7779, 7784, 7786, 7788, 7788, 7794); `SQLite.get` (7733); `SQLite.prepare` (7733, 7742, 7743); `Store.container` (7745) | CORE |
| [packages/store/src/store.ts:7803](../../packages/store/src/store.ts#L7803) `Store/moveContainersIn` | `Store.sql` (7803, 7809, 7811, 7812, 7813, 7814, 7834, 7839, 7839, 7850, 7853, 7856, 7863); `SQLite.prepare` (7811, 7812, 7813, 7814, 7850, 7856); `SQLite.get` (7816, 7850, 7856) | CORE |
| [packages/store/src/store.ts:7875](../../packages/store/src/store.ts#L7875) `Store/compactFile` | `Store.sql` (7875, 7876, 7878) | CORE |
| [packages/store/src/store.ts:7884](../../packages/store/src/store.ts#L7884) `Store/containerId` | `Store.containerId` (7884); `Store.row` (7885) | CORE |
| [packages/store/src/store.ts:7907](../../packages/store/src/store.ts#L7907) `Store/checkContainerWrite` | `Store.row` (7907) | CORE |
| [packages/store/src/store.ts:7916](../../packages/store/src/store.ts#L7916) `Store/setContainer` | `Store.sql` (7916, 7933); `Store.row` (7922); `SQLite.prepare` (7933) | CORE |
| [packages/store/src/store.ts:7966](../../packages/store/src/store.ts#L7966) `Store/orderBy` | `Store.valueListItems` (7966) | CORE |
| [packages/store/src/store.ts:7989](../../packages/store/src/store.ts#L7989) `Store/userPrefs` | `SQLite.all` (7989); `SQLite.prepare` (7989); `Store.sql` (7989) | CORE |
| [packages/store/src/store.ts:7994](../../packages/store/src/store.ts#L7994) `Store/hasTable` | `SQLite.get` (7994); `SQLite.prepare` (7994); `Store.sql` (7994) | CORE |
| [packages/store/src/store.ts:7998](../../packages/store/src/store.ts#L7998) `Store/setUserPref` | `Store.sql` (7998, 7999, 8000); `SQLite.prepare` (7999, 8000) | CORE |
| [packages/store/src/store.ts:8006](../../packages/store/src/store.ts#L8006) `Store/indexedFields` | `SQLite.all` (8006, 8007); `SQLite.prepare` (8006, 8007); `Store.sql` (8006, 8007) | CORE |
| [packages/store/src/store.ts:8028](../../packages/store/src/store.ts#L8028) `Store/addFieldIndex` | `Store.sql` (8028) | CORE |
| [packages/store/src/store.ts:8040](../../packages/store/src/store.ts#L8040) `Store/dropFieldIndex` | `SQLite.get` (8040); `SQLite.prepare` (8040); `Store.sql` (8040, 8041) | CORE |
| [packages/store/src/store.ts:8051](../../packages/store/src/store.ts#L8051) `Store/timeFind` | `Store.query` (8051, 8055, 8056); `Store.recordCount` (8058) | CORE |
| [packages/store/src/store.ts:8075](../../packages/store/src/store.ts#L8075) `Store/find` | `Store.find` (8075) | GATED-STORE |
| [packages/store/src/store.ts:8086](../../packages/store/src/store.ts#L8086) `Store/findHere` | `Store.query` (8086, 8091, 8093, 8107, 8109, 8120); `Store.recordCount` (8104); `SQLite.get` (8105, 8109); `SQLite.prepare` (8105, 8109, 8115, 8122, 8131); `Store.sql` (8105, 8109, 8115, 8122, 8131); `SQLite.all` (8115, 8122, 8131) | GATED-STORE |
| [packages/store/src/store.ts:8126](../../packages/store/src/store.ts#L8126) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (8126); `SQLite.prepare` (8126); `Store.sql` (8126) | GATED-STORE |
| [packages/store/src/store.ts:8159](../../packages/store/src/store.ts#L8159) `Store/sortedPage` | `SQLite.iterate` (8159); `SQLite.prepare` (8159, 8174); `Store.sql` (8159, 8174); `SQLite.all` (8174) | CORE |
| [packages/store/src/store.ts:8231](../../packages/store/src/store.ts#L8231) `Store/relatedCriteria/matched` | `relatedRows` (8231) | CORE |
| [packages/store/src/store.ts:8234](../../packages/store/src/store.ts#L8234) `Store/relatedCriteria` | `SQLite.iterate` (8234); `SQLite.prepare` (8234); `Store.sql` (8234) | CORE |
| [packages/store/src/store.ts:8260](../../packages/store/src/store.ts#L8260) `Store/computedRows` | `Store.sql` (8260, 8263, 8264, 8265, 8267, 8277, 8278, 8279, 8282); `SQLite.prepare` (8263, 8265, 8267, 8277); `SQLite.iterate` (8267); `Calculations.globalValue` (8270); `Calculations.unstoredValue` (8271); `Calculations.related` (8274); `SQLite.all` (8277) | CORE |
| [packages/store/src/store.ts:8307](../../packages/store/src/store.ts#L8307) `Store/summaries` | `Calculations.wholeTable` (8307); `Calculations.collect` (8327, 8332) | CORE |
| [packages/store/src/store.ts:8323](../../packages/store/src/store.ts#L8323) `Store/summaries/recs` | `SQLite.iterate` (8323); `SQLite.prepare` (8323); `Store.sql` (8323) | CORE |
| [packages/store/src/store.ts:8345](../../packages/store/src/store.ts#L8345) `Store/runningSummaryValues` | `Store.viewableIds` (8345); `rowsById` (8347); `Calculations.value` (8358, 8364); `Calculations.related` (8375) | GATED-STORE |
| [packages/store/src/store.ts:8391](../../packages/store/src/store.ts#L8391) `Store/findSource` | `Store.query` (8391); `SQLite.all` (8400, 8417); `SQLite.prepare` (8400, 8408, 8416); `Store.sql` (8400, 8405, 8408, 8413, 8416, 8430, 8432); `Calculations.globalValue` (8422); `Calculations.unstoredValue` (8423); `Calculations.related` (8427) | CORE |
| [packages/store/src/store.ts:8447](../../packages/store/src/store.ts#L8447) `Store/findCandidates` | `Store.query` (8447) | CORE |
| [packages/store/src/store.ts:8482](../../packages/store/src/store.ts#L8482) `Store/previewRow` | `Store.row` (8482) | CORE |
| [packages/store/src/store.ts:8500](../../packages/store/src/store.ts#L8500) `Store/row` | `SQLite.get` (8500) | CORE |
| [packages/store/src/store.ts:8519](../../packages/store/src/store.ts#L8519) `Store/getCurrent` | `Store.get` (8519); `Store.row` (8520, 8520, 8534); `SQLite.all` (8537); `SQLite.prepare` (8537); `Store.sql` (8537) | GATED-STORE |
| [packages/store/src/store.ts:8557](../../packages/store/src/store.ts#L8557) `Store/getManyCurrent` | `Store.getMany` (8557); `SQLite.get` (8575); `SQLite.prepare` (8575); `Store.sql` (8575) | GATED-STORE |
| [packages/store/src/store.ts:8568](../../packages/store/src/store.ts#L8568) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8568) | GATED-STORE |
| [packages/store/src/store.ts:8591](../../packages/store/src/store.ts#L8591) `Store/canViewRecord` | `SQLite.get` (8591); `SQLite.prepare` (8591); `Store.sql` (8591) | GATED-STORE |
| [packages/store/src/store.ts:8609](../../packages/store/src/store.ts#L8609) `Store/canView` | `Store.canView` (8609); `Store.row` (8610) | GATED-STORE |
| [packages/store/src/store.ts:8634](../../packages/store/src/store.ts#L8634) `Store/create` | `SQLite.get` (8634, 8640); `SQLite.prepare` (8634, 8640, 8653); `Store.sql` (8634, 8640, 8653) | CORE |
| [packages/store/src/store.ts:8677](../../packages/store/src/store.ts#L8677) `Store/duplicate` | `Store.row` (8677); `SQLite.get` (8681); `SQLite.prepare` (8681, 8696); `Store.sql` (8681, 8696) | CORE |
| [packages/store/src/store.ts:8751](../../packages/store/src/store.ts#L8751) `Store/update` | `Store.row` (8751); `Store.sql` (8781, 8782, 8821, 8824) | CORE |
| [packages/store/src/store.ts:8784](../../packages/store/src/store.ts#L8784) `Store/update/undo` | `Store.sql` (8784) | CORE |
| [packages/store/src/store.ts:8929](../../packages/store/src/store.ts#L8929) `Store/setStoredCalcValues` | `SQLite.prepare` (8929, 8930); `Store.sql` (8929, 8930); `SQLite.get` (8934) | CORE |
| [packages/store/src/store.ts:9018](../../packages/store/src/store.ts#L9018) `Store/evaluateCurrent` | `Store.row` (9018, 9018, 9019, 9019); `Calculations.context` (9024); `Store.get` (9025, 9027) | GATED-STORE |
| [packages/store/src/store.ts:9059](../../packages/store/src/store.ts#L9059) `Store/evaluateEachCurrent` | `Store.row` (9059, 9059, 9064); `Calculations.context` (9065); `Store.get` (9067) | GATED-STORE |
| [packages/store/src/store.ts:9100](../../packages/store/src/store.ts#L9100) `Store/evaluateRowsCurrent/each` | `Calculations.context` (9100); `Store.get` (9102) | GATED-STORE |
| [packages/store/src/store.ts:9121](../../packages/store/src/store.ts#L9121) `Store/evaluateRowsCurrent` | `Store.row` (9121, 9121, 9122, 9122) | GATED-STORE |
| [packages/store/src/store.ts:9136](../../packages/store/src/store.ts#L9136) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (9136) | GATED-STORE |
| [packages/store/src/store.ts:9158](../../packages/store/src/store.ts#L9158) `Store/evaluateRowsCurrent/key` | `Calculations.context` (9158) | GATED-STORE |
| [packages/store/src/store.ts:9196](../../packages/store/src/store.ts#L9196) `Store/updateRelated` | `relatedRows` (9196) | CORE |
| [packages/store/src/store.ts:9214](../../packages/store/src/store.ts#L9214) `Store/updatePortals` | `Store.row` (9214, 9250); `relatedRows` (9251) | CORE |
| [packages/store/src/store.ts:9224](../../packages/store/src/store.ts#L9224) `Store/updatePortals/portal/related` | `relatedIdList` (9224) | CORE |
| [packages/store/src/store.ts:9306](../../packages/store/src/store.ts#L9306) `Store/portalContainerTarget` | `Store.row` (9306); `relatedIdList` (9308) | CORE |
| [packages/store/src/store.ts:9321](../../packages/store/src/store.ts#L9321) `Store/checkEditable` | `Store.row` (9321) | CORE |
| [packages/store/src/store.ts:9345](../../packages/store/src/store.ts#L9345) `Store/delete` | `Store.row` (9345) | CORE |
| [packages/store/src/store.ts:9353](../../packages/store/src/store.ts#L9353) `Store/delete/run` | `SQLite.get` (9353); `SQLite.prepare` (9353, 9357); `Store.sql` (9353, 9357) | CORE |
| [packages/store/src/store.ts:9595](../../packages/store/src/store.ts#L9595) `Store/keyStepWork` | `Store.sql` (9595, 9601, 9605, 9607) | CORE |
| [packages/store/src/store.ts:9386](../../packages/store/src/store.ts#L9386) `Store/vaultHeld` | `SQLite.get` (9386); `SQLite.prepare` (9386); `Store.sql` (9386) | CORE |
| [packages/store/src/store.ts:9393](../../packages/store/src/store.ts#L9393) `Store/forgetStandInValues` | `Store.sql` (9393, 9414); `SQLite.prepare` (9414) | CORE |
| [packages/store/src/store.ts:9433](../../packages/store/src/store.ts#L9433) `Store/restoreDeletedRowLocked` | `SQLite.get` (9433, 9438); `SQLite.prepare` (9433, 9434, 9438, 9448); `Store.sql` (9433, 9434, 9438, 9448); `SQLite.all` (9434) | CORE |
| [packages/store/src/store.ts:9648](../../packages/store/src/store.ts#L9648) `Store/cascadeDelete` | `relatedRows` (9648) | CORE |
| [packages/store/src/store.ts:9738](../../packages/store/src/store.ts#L9738) `Store/selectIdsCurrent` | `Store.selectIds` (9738); `SQLite.all` (9744); `SQLite.prepare` (9744); `Store.sql` (9744) | GATED-STORE |
| [packages/store/src/store.ts:9752](../../packages/store/src/store.ts#L9752) `Store/countIds` | `Store.countIds` (9752); `SQLite.get` (9756); `SQLite.prepare` (9756); `Store.sql` (9756) | GATED-STORE |
| [packages/store/src/store.ts:9772](../../packages/store/src/store.ts#L9772) `Store/computeValuesCurrent` | `Store.computeValues` (9772); `Store.sql` (9778, 9782); `SQLite.all` (9782); `SQLite.prepare` (9782) | GATED-STORE |
| [packages/store/src/store.ts:9797](../../packages/store/src/store.ts#L9797) `Store/findIdsCurrent` | `Store.findIds` (9797) | GATED-STORE |
| [packages/store/src/store.ts:9803](../../packages/store/src/store.ts#L9803) `Store/findIdsHere` | `Store.query` (9803, 9808, 9810); `SQLite.iterate` (9821); `SQLite.prepare` (9821); `Store.sql` (9821) | GATED-STORE |
| [packages/store/src/store.ts:9838](../../packages/store/src/store.ts#L9838) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9838); `Store.viewableIds` (9843); `Calculations.collect` (9859); `rowsById` (9859, 9909); `Calculations.collector` (9881) | GATED-STORE |
| [packages/store/src/store.ts:9871](../../packages/store/src/store.ts#L9871) `Store/groupSummariesCurrent/key` | `Calculations.value` (9871); `Calculations.related` (9873) | GATED-STORE |
| [packages/store/src/store.ts:9907](../../packages/store/src/store.ts#L9907) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9907) | GATED-STORE |
| [packages/store/src/store.ts:9963](../../packages/store/src/store.ts#L9963) `Store/sortIdsCurrentProgress` | `SQLite.all` (9963); `SQLite.prepare` (9963, 10031); `Store.sql` (9963, 10031); `Store.valueListItems` (9971); `rowsById` (9983); `Calculations.globalValue` (9986); `Calculations.unstoredValue` (9987); `Calculations.related` (9993); `SQLite.iterate` (10031) | GATED-STORE |
| [packages/store/src/store.ts:10045](../../packages/store/src/store.ts#L10045) `Store/matchIds` | `Store.matchIds` (10045); `SQLite.all` (10051); `SQLite.prepare` (10051); `Store.sql` (10051) | CORE |
| [packages/store/src/store.ts:10073](../../packages/store/src/store.ts#L10073) `Store/truncate/run` | `Store.sql` (10073, 10075, 10082, 10084, 10086, 10087); `SQLite.prepare` (10075, 10082); `SQLite.all` (10077) | CORE |
| [packages/store/src/store.ts:10112](../../packages/store/src/store.ts#L10112) `Store/iterateCommitted` | `SQLite.iterate` (10112) | CORE |
| [packages/store/src/store.ts:10146](../../packages/store/src/store.ts#L10146) `Store/readOnlyChecked` | `SQLite.prepare` (10146, 10150, 10159, 10164); `SQLite.all` (10150, 10159, 10164) | CORE |
| [packages/store/src/store.ts:10186](../../packages/store/src/store.ts#L10186) `Store/refreshDecimalSqlViews` | `SQLite.get` (10186); `SQLite.prepare` (10186, 10191); `SQLite.all` (10191) | CORE |
| [packages/store/src/store.ts:10205](../../packages/store/src/store.ts#L10205) `Store/internalRoots` | `SQLite.get` (10205); `SQLite.prepare` (10205, 10207); `SQLite.all` (10207) | CORE |
| [packages/store/src/store.ts:10240](../../packages/store/src/store.ts#L10240) `Store/selectCurrent` | `SQLite.iterate` (10240) | CORE |
| [packages/store/src/store.ts:10289](../../packages/store/src/store.ts#L10289) `Store/query` | `SQLite.iterate` (10289) | CORE |
| [packages/store/src/store.ts:10323](../../packages/store/src/store.ts#L10323) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10323); `SQLite.all` (10330, 10333); `SQLite.prepare` (10330, 10333) | CORE |
| [packages/store/src/store.ts:1234](../../packages/store/src/store.ts#L1234) `Store/ensureNativeIds` | `SQLite.all` (1234, 1246); `SQLite.prepare` (1234, 1237, 1245, 1246); `Store.sql` (1234, 1237, 1240, 1244, 1245, 1246, 1249, 1251) | CORE |
| [packages/store/src/store.ts:1259](../../packages/store/src/store.ts#L1259) `Store/nativeIdGuards` | `Store.sql` (1259, 1260, 1262) | CORE |
| [packages/store/src/store.ts:10256](../../packages/store/src/store.ts#L10256) `Store/selectIn` | `Store.select` (10256) | CORE |
| [packages/store/src/store.ts:10264](../../packages/store/src/store.ts#L10264) `Store/selectHeldCurrent` | `Store.sql` (10264, 10265); `SQLite.prepare` (10265); `SQLite.iterate` (10268) | CORE |
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
| [packages/server/src/oauth.ts:861](../../packages/server/src/oauth.ts#L861) `OAuthServer/endGrant` | `SQLite.prepare` (861, 862); `SQLite.all` (862) | AUTH |
| [packages/server/src/oauth.ts:817](../../packages/server/src/oauth.ts#L817) `OAuthServer/issue/write` | `SQLite.get` (817); `SQLite.prepare` (817, 818, 819) | AUTH |
| [packages/server/src/backup.ts:268](../../packages/server/src/backup.ts#L268) `backupOnceHeld` | `SQLite.get` (268); `SQLite.prepare` (268) | OPERATOR |
| [packages/store/src/store.ts:1711](../../packages/store/src/store.ts#L1711) `Store/selfContainedCopy` | `Store.sql` (1711); `SQLite.all` (1716); `SQLite.prepare` (1716, 1718, 1719, 1720) | CORE |
| [packages/store/src/store.ts:7272](../../packages/store/src/store.ts#L7272) `Store/containerReferences` | `SQLite.all` (7272, 7291, 7293, 7299, 7312, 7323, 7337); `SQLite.prepare` (7272, 7291, 7293, 7299, 7312, 7323, 7335, 7337); `Store.sql` (7272, 7291, 7293, 7299, 7312, 7323, 7335, 7337); `SQLite.get` (7335); `Store.row` (7346) | CORE |
| [packages/store/src/store.ts:7370](../../packages/store/src/store.ts#L7370) `Store/containerIntegrityReport` | `SQLite.all` (7370); `SQLite.prepare` (7370, 7381); `Store.sql` (7370, 7381); `SQLite.get` (7381) | CORE |
| [packages/store/src/store.ts:1445](../../packages/store/src/store.ts#L1445) `Store/recoverPendingExternalFiles` | `Store.sql` (1445, 1447, 1471, 1473); `SQLite.prepare` (1447); `SQLite.get` (1458) | CORE |
| [packages/store/src/store.ts:2280](../../packages/store/src/store.ts#L2280) `Store/restoreRecord` | `Store.recordAsOf` (2280); `SQLite.get` (2284); `SQLite.prepare` (2284, 2288, 2297, 2308); `Store.sql` (2284, 2288, 2297, 2308) | CORE |
| [packages/store/src/store.ts:9008](../../packages/store/src/store.ts#L9008) `Store/recordViewable` | `Store.row` (9008) | GATED-STORE |
| [packages/server/src/compaction.ts:65](../../packages/server/src/compaction.ts#L65) `compactStore` | `SQLite.get` (65, 66, 80, 88); `SQLite.prepare` (65, 66, 80, 88) | OPERATOR |
<!-- end generated read-gate inventory -->
