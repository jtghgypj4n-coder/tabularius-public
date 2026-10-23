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
| [packages/cli/src/main.ts:681](../../packages/cli/src/main.ts#L681) `accountsWithPasswordOff` | `SQLite.all` (681); `SQLite.prepare` (681) | OPERATOR |
| [packages/cli/src/main.ts:710](../../packages/cli/src/main.ts#L710) `hostedRead` | `SQLite.all` (710, 713); `SQLite.prepare` (710, 713); `Store.sql` (710, 713) | OPERATOR |
| [packages/cli/src/main.ts:2324](../../packages/cli/src/main.ts#L2324) `main` | `Store.orphanContainerReport` (2324); `Store.auditLog` (2787); `SQLite.get` (3003); `SQLite.prepare` (3003) | OPERATOR |
| [packages/scripts/src/data-api-step.ts:103](../../packages/scripts/src/data-api-step.ts#L103) `respond` | `Store.get` (103, 130, 139); `Store.find` (104, 116) | SCRIPT |
| [packages/scripts/src/engine.ts:1942](../../packages/scripts/src/engine.ts#L1942) `ScriptEngine/goToLayout` | `Store.findIds` (1942) | SCRIPT |
| [packages/scripts/src/engine.ts:2286](../../packages/scripts/src/engine.ts#L2286) `ScriptEngine/foundSet` | `Store.findIds` (2286) | SCRIPT |
| [packages/scripts/src/engine.ts:2351](../../packages/scripts/src/engine.ts#L2351) `ScriptEngine/semanticFind` | `Store.findIds` (2351, 2372) | SCRIPT |
| [packages/scripts/src/engine.ts:3267](../../packages/scripts/src/engine.ts#L3267) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3267); `Calculations.executeSQL` (3274) | SCRIPT |
| [packages/scripts/src/engine.ts:3324](../../packages/scripts/src/engine.ts#L3324) `ScriptEngine/sortIds` | `Store.sortIds` (3324); `Store.valueListItems` (3330) | SCRIPT |
| [packages/scripts/src/engine.ts:3421](../../packages/scripts/src/engine.ts#L3421) `ScriptEngine/revertTransaction` | `Store.findIds` (3421) | SCRIPT |
| [packages/scripts/src/engine.ts:3971](../../packages/scripts/src/engine.ts#L3971) `ScriptEngine/step` | `Store.fieldIndex` (3971); `Store.findIds` (4105, 4204) | SCRIPT |
| [packages/scripts/src/engine.ts:5232](../../packages/scripts/src/engine.ts#L5232) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5232) | SCRIPT |
| [packages/scripts/src/engine.ts:5240](../../packages/scripts/src/engine.ts#L5240) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5240) | SCRIPT |
| [packages/scripts/src/engine.ts:5241](../../packages/scripts/src/engine.ts#L5241) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5241) | SCRIPT |
| [packages/scripts/src/engine.ts:5394](../../packages/scripts/src/engine.ts#L5394) `ScriptEngine/get` | `Store.findIds` (5394); `Store.canViewRecord` (5485); `Store.get` (5521) | SCRIPT |
| [packages/scripts/src/engine.ts:5552](../../packages/scripts/src/engine.ts#L5552) `ScriptEngine/design` | `Store.valueListItems` (5552) | SCRIPT |
| [packages/scripts/src/engine.ts:5606](../../packages/scripts/src/engine.ts#L5606) `ScriptEngine/record` | `Store.get` (5606) | SCRIPT |
| [packages/scripts/src/engine.ts:5638](../../packages/scripts/src/engine.ts#L5638) `ScriptEngine/valueOf` | `Store.findIds` (5638); `Store.containerId` (5646) | SCRIPT |
| [packages/scripts/src/engine.ts:5663](../../packages/scripts/src/engine.ts#L5663) `ScriptEngine/lookupNext` | `Store.get` (5663); `Store.row` (5664); `Calculations.context` (5666) | SCRIPT |
| [packages/scripts/src/engine.ts:5766](../../packages/scripts/src/engine.ts#L5766) `ScriptEngine/relatedIds` | `Store.findIds` (5766); `rowsById` (5774); `Store.select` (5778); `Store.matchIds` (5792); `Store.viewableIds` (5815) | SCRIPT |
| [packages/scripts/src/engine.ts:5800](../../packages/scripts/src/engine.ts#L5800) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5800) | SCRIPT |
| [packages/scripts/src/engine.ts:6289](../../packages/scripts/src/engine.ts#L6289) `ScriptEngine/exportField` | `Store.get` (6289); `Store.containerId` (6290); `Store.container` (6292) | SCRIPT |
| [packages/scripts/src/engine.ts:6440](../../packages/scripts/src/engine.ts#L6440) `ScriptEngine/relookup` | `Store.get` (6440) | SCRIPT |
| [packages/scripts/src/engine.ts:6860](../../packages/scripts/src/engine.ts#L6860) `ScriptEngine/goToList` | `Store.findIds` (6860) | SCRIPT |
| [packages/scripts/src/engine.ts:7189](../../packages/scripts/src/engine.ts#L7189) `ScriptEngine/sourceValue` | `Store.get` (7189); `Store.containerId` (7190); `Store.container` (7191) | SCRIPT |
| [packages/scripts/src/engine.ts:7924](../../packages/scripts/src/engine.ts#L7924) `ScriptEngine/containerFile` | `Store.get` (7924); `Store.containerId` (7925); `Store.container` (7926) | SCRIPT |
| [packages/scripts/src/engine.ts:8086](../../packages/scripts/src/engine.ts#L8086) `ScriptEngine/importRecords` | `Store.findIds` (8086); `Store.get` (8106) | SCRIPT |
| [packages/scripts/src/engine.ts:8317](../../packages/scripts/src/engine.ts#L8317) `ScriptEngine/fileMakerRows` | `Store.findIds` (8317); `Store.get` (8322) | SCRIPT |
| [packages/scripts/src/engine.ts:8357](../../packages/scripts/src/engine.ts#L8357) `ScriptEngine/newRecord` | `Store.findIds` (8357) | SCRIPT |
| [packages/scripts/src/engine.ts:8662](../../packages/scripts/src/engine.ts#L8662) `ScriptEngine/performFind` | `Store.findIds` (8662) | SCRIPT |
| [packages/scripts/src/engine.ts:8687](../../packages/scripts/src/engine.ts#L8687) `ScriptEngine/findRelated` | `Store.findIds` (8687, 8697, 8700) | SCRIPT |
| [packages/scripts/src/engine.ts:8719](../../packages/scripts/src/engine.ts#L8719) `ScriptEngine/quickFind` | `Store.findIds` (8719, 8720, 8723) | SCRIPT |
| [packages/scripts/src/engine.ts:9109](../../packages/scripts/src/engine.ts#L9109) `clearRecords` | `SQLite.all` (9109); `SQLite.prepare` (9109) | SCRIPT |
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
| [packages/server/src/agent.ts:162](../../packages/server/src/agent.ts#L162) `runStep` | `Store.findIds` (162); `Store.auditLog` (221) | DESIGN |
| [packages/server/src/agent.ts:303](../../packages/server/src/agent.ts#L303) `dryRunPlan` | `Store.findIds` (303) | DESIGN |
| [packages/server/src/agent.ts:326](../../packages/server/src/agent.ts#L326) `runApprovedStep` | `Store.findIds` (326) | DESIGN |
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
| [packages/server/src/cleanup.ts:616](../../packages/server/src/cleanup.ts#L616) `keyValue` | `SQLite.get` (616); `SQLite.prepare` (616); `Store.sql` (616) | CLEANUP |
| [packages/server/src/cleanup.ts:620](../../packages/server/src/cleanup.ts#L620) `relatedIds` | `SQLite.all` (620); `SQLite.prepare` (620); `Store.sql` (620) | CLEANUP |
| [packages/server/src/cleanup.ts:740](../../packages/server/src/cleanup.ts#L740) `applyCleanup/apply` | `Store.findIds` (740, 750); `SQLite.all` (741); `SQLite.prepare` (741, 778); `Store.sql` (741, 778); `SQLite.get` (778) | CLEANUP |
| [packages/server/src/cleanup.ts:809](../../packages/server/src/cleanup.ts#L809) `snapshotField` | `SQLite.all` (809); `SQLite.prepare` (809); `Store.sql` (809) | CLEANUP |
| [packages/server/src/cleanup.ts:869](../../packages/server/src/cleanup.ts#L869) `snapshotRows` | `SQLite.all` (869); `SQLite.prepare` (869); `Store.sql` (869) | CLEANUP |
| [packages/server/src/cleanup.ts:878](../../packages/server/src/cleanup.ts#L878) `journalDeletes` | `SQLite.get` (878); `SQLite.prepare` (878); `Store.sql` (878) | CLEANUP |
| [packages/server/src/cleanup.ts:928](../../packages/server/src/cleanup.ts#L928) `updateMany` | `Store.findIds` (928) | CLEANUP |
| [packages/server/src/cleanup.ts:990](../../packages/server/src/cleanup.ts#L990) `undoCleanup` | `SQLite.get` (990, 1006); `SQLite.prepare` (990, 1006); `Store.sql` (990, 1006) | CLEANUP |
| [packages/server/src/cleanup.ts:1030](../../packages/server/src/cleanup.ts#L1030) `CleanupJournal/constructor` | `Store.sql` (1030) | CLEANUP |
| [packages/server/src/cleanup.ts:1039](../../packages/server/src/cleanup.ts#L1039) `CleanupJournal/append` | `SQLite.prepare` (1039); `Store.sql` (1039) | CLEANUP |
| [packages/server/src/cleanup.ts:1044](../../packages/server/src/cleanup.ts#L1044) `CleanupJournal/add` | `SQLite.prepare` (1044); `Store.sql` (1044) | CLEANUP |
| [packages/server/src/cleanup.ts:1050](../../packages/server/src/cleanup.ts#L1050) `CleanupJournal/get` | `SQLite.get` (1050); `SQLite.prepare` (1050); `Store.sql` (1050) | CLEANUP |
| [packages/server/src/cleanup.ts:1055](../../packages/server/src/cleanup.ts#L1055) `CleanupJournal/list` | `SQLite.all` (1055); `SQLite.prepare` (1055); `Store.sql` (1055) | CLEANUP |
| [packages/server/src/cleanup.ts:1059](../../packages/server/src/cleanup.ts#L1059) `CleanupJournal/markUndone` | `SQLite.prepare` (1059); `Store.sql` (1059) | CLEANUP |
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
| [packages/server/src/dataapi.ts:1930](../../packages/server/src/dataapi.ts#L1930) `DataApi/route` | `Store.get` (1930, 2152, 2175, 2183, 2230, 2254, 2274, 2311); `Store.valueListItems` (1945); `Store.find` (2107, 2154, 2344); `Store.findIds` (2111, 2349); `Store.query` (2349) | REST |
| [packages/server/src/dataapi.ts:2059](../../packages/server/src/dataapi.ts#L2059) `DataApi/route/recordOut` | `Store.portalCounts` (2059) | REST |
| [packages/server/src/dataapi.ts:2095](../../packages/server/src/dataapi.ts#L2095) `DataApi/route/shownAs` | `Store.get` (2095) | REST |
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
| [packages/server/src/pgwire.ts:786](../../packages/server/src/pgwire.ts#L786) `Connection/translate` | `Calculations.translateSQL` (786) | SQL |
| [packages/server/src/pgwire.ts:820](../../packages/server/src/pgwire.ts#L820) `Connection/catalog` | `Store.describe` (820) | SQL |
| [packages/server/src/pgwire.ts:831](../../packages/server/src/pgwire.ts#L831) `Connection/run` | `Store.selectIn` (831) | SQL |
| [packages/server/src/pgwire.ts:958](../../packages/server/src/pgwire.ts#L958) `Connection/validateSyntax` | `SQLite.prepare` (958); `Store.sql` (958) | SQL |
| [packages/server/src/pgwire.ts:1177](../../packages/server/src/pgwire.ts#L1177) `Connection/describe` | `Store.describe` (1177) | SQL |
| [packages/server/src/pgwire.ts:807](../../packages/server/src/pgwire.ts#L807) `Connection/bareNames` | `Store.describe` (807) | SQL |
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
| [packages/server/src/sql.ts:101](../../packages/server/src/sql.ts#L101) `SqlEndpoint/handle` | `Calculations.translateSQL` (101); `Store.select` (106) | SQL |
| [packages/server/src/sql.ts:159](../../packages/server/src/sql.ts#L159) `SqlEndpoint/tables` | `SQLite.all` (159); `SQLite.prepare` (159); `Store.sql` (159) | SQL |
| [packages/server/src/standby.ts:281](../../packages/server/src/standby.ts#L281) `Standby/copy` | `SQLite.get` (281); `SQLite.prepare` (281) | OPERATOR |
| [packages/server/src/summarize.ts:69](../../packages/server/src/summarize.ts#L69) `summarizeRecords` | `Store.findIds` (69); `Store.select` (126, 133, 143) | SUMMARY |
| [packages/server/src/summarize.ts:184](../../packages/server/src/summarize.ts#L184) `summarizeByRecord` | `Store.evaluateEach` (184); `Store.row` (186) | SUMMARY |
| [packages/server/src/sync-console.ts:458](../../packages/server/src/sync-console.ts#L458) `SyncConsole/runCheck` | `Store.sql` (458) | DESIGN |
| [packages/server/src/sync-console.ts:463](../../packages/server/src/sync-console.ts#L463) `SyncConsole/runCheck/assertActive` | `Store.sql` (463) | DESIGN |
| [packages/server/src/warm-worker.ts:19](../../packages/server/src/warm-worker.ts#L19) `message/count` | `Store.recordCount` (19) | INTERNAL |
| [packages/server/src/warm-worker.ts:34](../../packages/server/src/warm-worker.ts#L34) `message` | `Store.find` (34) | INTERNAL |
| [packages/server/src/webclient.ts:501](../../packages/server/src/webclient.ts#L501) `WebClient/history` | `Store.get` (501) | WEB |
| [packages/server/src/webclient.ts:638](../../packages/server/src/webclient.ts#L638) `WebClient/explain` | `Store.get` (638); `Store.row` (671, 684) | WEB |
| [packages/server/src/webclient.ts:697](../../packages/server/src/webclient.ts#L697) `WebClient/index` | `Store.fieldIndex` (697) | WEB |
| [packages/server/src/webclient.ts:787](../../packages/server/src/webclient.ts#L787) `WebClient/menus` | `Store.evaluateEach` (787) | WEB |
| [packages/server/src/webclient.ts:1003](../../packages/server/src/webclient.ts#L1003) `WebClient/view` | `Store.evaluateEach` (1003, 1027, 1046); `Store.canView` (1021); `Store.previewRow` (1025, 1047); `Store.get` (1038); `Store.row` (1039, 1039) | WEB |
| [packages/server/src/webclient.ts:1024](../../packages/server/src/webclient.ts#L1024) `WebClient/view/get` | `Store.get` (1024) | WEB |
| [packages/server/src/webclient.ts:1089](../../packages/server/src/webclient.ts#L1089) `WebClient/refresh` | `Store.previewRow` (1089); `Store.getMany` (1094); `Store.foundSetRows` (1116) | WEB |
| [packages/server/src/webclient.ts:1128](../../packages/server/src/webclient.ts#L1128) `WebClient/foundIds` | `Store.findIds` (1128) | WEB |
| [packages/server/src/webclient.ts:1143](../../packages/server/src/webclient.ts#L1143) `WebClient/records` | `Store.getMany` (1143); `Store.find` (1146) | WEB |
| [packages/server/src/webclient.ts:1172](../../packages/server/src/webclient.ts#L1172) `WebClient/foundSetPortal` | `Store.foundSetRows` (1172, 1179) | WEB |
| [packages/server/src/webclient.ts:1212](../../packages/server/src/webclient.ts#L1212) `WebClient/charts/foundSet` | `Store.findIds` (1212) | WEB |
| [packages/server/src/webclient.ts:1221](../../packages/server/src/webclient.ts#L1221) `WebClient/charts` | `Calculations.context` (1221); `Store.canView` (1249); `Store.evaluateEach` (1258, 1262); `Store.evaluateRows` (1267, 1269) | WEB |
| [packages/server/src/webclient.ts:1252](../../packages/server/src/webclient.ts#L1252) `WebClient/charts/get` | `Store.get` (1252) | WEB |
| [packages/server/src/webclient.ts:1441](../../packages/server/src/webclient.ts#L1441) `WebClient/exportRecords` | `Store.getMany` (1441) | WEB |
| [packages/server/src/webclient.ts:1335](../../packages/server/src/webclient.ts#L1335) `WebClient/streamExportRecords/nextBatch` | `Store.selectIds` (1335); `Store.getMany` (1341) | WEB |
| [packages/server/src/webclient.ts:1635](../../packages/server/src/webclient.ts#L1635) `WebClient/aiReplace` | `Store.canView` (1635); `Store.getMany` (1651) | WEB |
| [packages/server/src/webclient.ts:1711](../../packages/server/src/webclient.ts#L1711) `WebClient/groups` | `Store.findIds` (1711); `Store.groupSummaries` (1717) | WEB |
| [packages/server/src/webclient.ts:1819](../../packages/server/src/webclient.ts#L1819) `WebClient/button` | `Store.findIds` (1819, 1869); `Store.evaluateEach` (1828, 1829) | WEB |
| [packages/server/src/webclient.ts:2513](../../packages/server/src/webclient.ts#L2513) `listItems` | `Store.valueListItems` (2513) | WEB |
| [packages/server/src/webclient.ts:2592](../../packages/server/src/webclient.ts#L2592) `foundIds` | `Store.findIds` (2592, 2594) | WEB |
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
| [packages/store/src/calc.ts:338](../../packages/store/src/calc.ts#L338) `Calculations/meta` | `SQLite.get` (338); `SQLite.prepare` (338); `Store.sql` (338) | CALC |
| [packages/store/src/calc.ts:343](../../packages/store/src/calc.ts#L343) `Calculations/saveMeta` | `SQLite.prepare` (343); `Store.sql` (343) | CALC |
| [packages/store/src/calc.ts:356](../../packages/store/src/calc.ts#L356) `Calculations/globalValue` | `SQLite.get` (356); `SQLite.prepare` (356); `Store.sql` (356) | CALC |
| [packages/store/src/calc.ts:380](../../packages/store/src/calc.ts#L380) `Calculations/setNextSerial` | `Store.sql` (380, 381, 387, 389, 389) | CALC |
| [packages/store/src/calc.ts:528](../../packages/store/src/calc.ts#L528) `Calculations/value` | `Calculations.globalValue` (528) | CALC |
| [packages/store/src/calc.ts:563](../../packages/store/src/calc.ts#L563) `Calculations/computed` | `Calculations.context` (563) | CALC |
| [packages/store/src/calc.ts:578](../../packages/store/src/calc.ts#L578) `Calculations/unstoredValue` | `Calculations.unstoredStyled` (578); `Calculations.value` (578) | CALC |
| [packages/store/src/calc.ts:616](../../packages/store/src/calc.ts#L616) `Calculations/allRecords` | `SQLite.iterate` (616); `SQLite.prepare` (616); `Store.sql` (616) | CALC |
| [packages/store/src/calc.ts:627](../../packages/store/src/calc.ts#L627) `Calculations/collect` | `Calculations.collector` (627) | CALC |
| [packages/store/src/calc.ts:634](../../packages/store/src/calc.ts#L634) `Calculations/summaryInput` | `Calculations.value` (634) | CALC |
| [packages/store/src/calc.ts:658](../../packages/store/src/calc.ts#L658) `Calculations/collector/add` | `Calculations.related` (658) | CALC |
| [packages/store/src/calc.ts:671](../../packages/store/src/calc.ts#L671) `Calculations/foundSummary` | `Calculations.collect` (671) | CALC |
| [packages/store/src/calc.ts:682](../../packages/store/src/calc.ts#L682) `Calculations/summary` | `Calculations.collect` (682) | CALC |
| [packages/store/src/calc.ts:689](../../packages/store/src/calc.ts#L689) `Calculations/tableSummary` | `Calculations.wholeTable` (689) | CALC |
| [packages/store/src/calc.ts:744](../../packages/store/src/calc.ts#L744) `Calculations/globalsKey` | `Calculations.globalValue` (744) | CALC |
| [packages/store/src/calc.ts:919](../../packages/store/src/calc.ts#L919) `Calculations/summaryDependencies` | `Store.sql` (919) | CALC |
| [packages/store/src/calc.ts:958](../../packages/store/src/calc.ts#L958) `Calculations/wholeTable` | `rowsById` (958); `Store.viewableIds` (958); `Calculations.collect` (960, 1050); `Calculations.value` (1021); `Store.sql` (1029, 1037) | CALC |
| [packages/store/src/calc.ts:1211](../../packages/store/src/calc.ts#L1211) `Calculations/applyDelta/value` | `Calculations.value` (1211) | CALC |
| [packages/store/src/calc.ts:1283](../../packages/store/src/calc.ts#L1283) `Calculations/storedRows` | `SQLite.iterate` (1283); `SQLite.prepare` (1283); `Store.sql` (1283) | CALC |
| [packages/store/src/calc.ts:1335](../../packages/store/src/calc.ts#L1335) `Calculations/relatedRecs` | `Calculations.relatedIds` (1335); `Store.viewableIds` (1340); `rowsById` (1346) | CALC |
| [packages/store/src/calc.ts:1357](../../packages/store/src/calc.ts#L1357) `Calculations/firstRelated` | `Calculations.related` (1357, 1369, 1384); `Store.viewableIds` (1364); `Calculations.relatedIds` (1367, 1380); `Calculations.statement` (1377); `SQLite.get` (1377) | CALC |
| [packages/store/src/calc.ts:1391](../../packages/store/src/calc.ts#L1391) `Calculations/rowById` | `Calculations.statement` (1391); `SQLite.get` (1391) | CALC |
| [packages/store/src/calc.ts:1402](../../packages/store/src/calc.ts#L1402) `Calculations/relatedIds` | `Calculations.related` (1402, 1432, 1446); `rowsById` (1416, 1443); `Calculations.statement` (1427); `SQLite.all` (1427) | CALC |
| [packages/store/src/calc.ts:1509](../../packages/store/src/calc.ts#L1509) `Calculations/joinHop` | `Calculations.statement` (1509, 1511); `SQLite.get` (1509); `SQLite.iterate` (1511) | CALC |
| [packages/store/src/calc.ts:1538](../../packages/store/src/calc.ts#L1538) `Calculations/storedRelatedValues` | `Calculations.statement` (1538); `SQLite.iterate` (1538) | CALC |
| [packages/store/src/calc.ts:1557](../../packages/store/src/calc.ts#L1557) `Calculations/passStamp` | `Store.sql` (1557) | CALC |
| [packages/store/src/calc.ts:1567](../../packages/store/src/calc.ts#L1567) `Calculations/lookup` | `Store.sql` (1567) | CALC |
| [packages/store/src/calc.ts:1606](../../packages/store/src/calc.ts#L1606) `Calculations/foundSums` | `Store.sql` (1606) | CALC |
| [packages/store/src/calc.ts:1669](../../packages/store/src/calc.ts#L1669) `Calculations/hopQuery` | `Calculations.value` (1669) | CALC |
| [packages/store/src/calc.ts:1691](../../packages/store/src/calc.ts#L1691) `Calculations/columnNames` | `SQLite.all` (1691); `SQLite.prepare` (1691); `Store.sql` (1691) | CALC |
| [packages/store/src/calc.ts:1702](../../packages/store/src/calc.ts#L1702) `Calculations/statement` | `SQLite.prepare` (1702); `Store.sql` (1702) | CALC |
| [packages/store/src/calc.ts:1716](../../packages/store/src/calc.ts#L1716) `Calculations/ensureIndex` | `Store.sql` (1716, 1717) | CALC |
| [packages/store/src/calc.ts:1742](../../packages/store/src/calc.ts#L1742) `Calculations/context/records` | `Calculations.firstRelated` (1742) | CALC |
| [packages/store/src/calc.ts:1760](../../packages/store/src/calc.ts#L1760) `Calculations/context/field` | `Calculations.summary` (1760); `Calculations.globalValue` (1763); `Calculations.value` (1764) | CALC |
| [packages/store/src/calc.ts:1773](../../packages/store/src/calc.ts#L1773) `Calculations/context/related` | `Calculations.globalValue` (1773); `Calculations.value` (1775, 1786); `Calculations.related` (1788) | CALC |
| [packages/store/src/calc.ts:1808](../../packages/store/src/calc.ts#L1808) `Calculations/context/lookupNext` | `Store.canViewRecord` (1808) | CALC |
| [packages/store/src/calc.ts:1823](../../packages/store/src/calc.ts#L1823) `Calculations/context/summary` | `Calculations.value` (1823, 1833); `Calculations.related` (1835); `Calculations.summary` (1853) | CALC |
| [packages/store/src/calc.ts:1883](../../packages/store/src/calc.ts#L1883) `Calculations/context/get` | `Store.recordCount` (1883, 1887); `Calculations.statement` (1886); `SQLite.get` (1886) | CALC |
| [packages/store/src/calc.ts:1906](../../packages/store/src/calc.ts#L1906) `Calculations/context/executeSQL` | `Calculations.executeSQL` (1906) | CALC |
| [packages/store/src/calc.ts:1907](../../packages/store/src/calc.ts#L1907) `Calculations/context/persistentData` | `Store.persistentData` (1907) | CALC |
| [packages/store/src/calc.ts:1908](../../packages/store/src/calc.ts#L1908) `Calculations/context/persistentDataIds` | `Store.persistentDataIds` (1908) | CALC |
| [packages/store/src/calc.ts:1933](../../packages/store/src/calc.ts#L1933) `Calculations/design` | `Store.valueListItems` (1933) | CALC |
| [packages/store/src/calc.ts:1950](../../packages/store/src/calc.ts#L1950) `Calculations/executeSQL` | `Calculations.translateSQL` (1950); `Store.select` (1988); `Store.sql` (1999) | CALC |
| [packages/store/src/calc.ts:2105](../../packages/store/src/calc.ts#L2105) `Calculations/translateSQL` | `Store.scopedTableSql` (2105, 2136) | CALC |
| [packages/store/src/calc.ts:2168](../../packages/store/src/calc.ts#L2168) `Calculations/shareColumn` | `Store.recordCount` (2168) | CALC |
| [packages/store/src/calc.ts:2200](../../packages/store/src/calc.ts#L2200) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2200) | CALC |
| [packages/store/src/calc.ts:2237](../../packages/store/src/calc.ts#L2237) `Calculations/computeColumn` | `Calculations.statement` (2237); `SQLite.get` (2237); `Calculations.value` (2240) | CALC |
| [packages/store/src/calc.ts:2374](../../packages/store/src/calc.ts#L2374) `Calculations/beforeWrite` | `relatedRows` (2374); `Calculations.related` (2428); `Calculations.context` (2441) | CORE |
| [packages/store/src/calc.ts:2492](../../packages/store/src/calc.ts#L2492) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2492); `Calculations.value` (2492) | CALC |
| [packages/store/src/calc.ts:2507](../../packages/store/src/calc.ts#L2507) `Calculations/computeStoredStyled` | `Calculations.context` (2507) | CORE |
| [packages/store/src/calc.ts:2547](../../packages/store/src/calc.ts#L2547) `Calculations/validate/fail` | `Calculations.context` (2547) | CALC |
| [packages/store/src/calc.ts:2561](../../packages/store/src/calc.ts#L2561) `Calculations/validate` | `Calculations.value` (2561); `Store.valueListItems` (2582); `Calculations.context` (2596) | CALC |
| [packages/store/src/calc.ts:2658](../../packages/store/src/calc.ts#L2658) `nearest` | `SQLite.get` (2658); `SQLite.prepare` (2658); `Store.sql` (2658) | CALC |
| [packages/store/src/calc.ts:2743](../../packages/store/src/calc.ts#L2743) `containerValue` | `Store.containerInfo` (2743); `Store.containerRange` (2750); `Store.container` (2751) | CALC |
| [packages/store/src/calc.ts:2759](../../packages/store/src/calc.ts#L2759) `containerValue/read` | `Store.container` (2759) | CALC |
| [packages/store/src/calc.ts:2772](../../packages/store/src/calc.ts#L2772) `containerValue/value` | `Store.containerRange` (2772) | CALC |
| [packages/store/src/calc.ts:2890](../../packages/store/src/calc.ts#L2890) `sameValuesElsewhere` | `SQLite.all` (2890); `SQLite.prepare` (2890, 2897, 2899); `Store.sql` (2890, 2897, 2899); `Calculations.value` (2892); `SQLite.get` (2897, 2899) | CALC |
| [packages/store/src/calc.ts:3203](../../packages/store/src/calc.ts#L3203) `rowsById/flush` | `Calculations.statement` (3203); `SQLite.iterate` (3203) | CALC |
| [packages/store/src/damage.ts:93](../../packages/store/src/damage.ts#L93) `watchDatabase` | `SQLite.prepare` (93); `SQLite.iterate` (103) | CORE |
| [packages/store/src/explain-related.ts:102](../../packages/store/src/explain-related.ts#L102) `explainRelated` | `Store.row` (102); `Store.get` (190); `Calculations.value` (239); `Calculations.context` (247) | RECORD |
| [packages/store/src/explain-related.ts:180](../../packages/store/src/explain-related.ts#L180) `explainRelated/runFilter` | `Calculations.context` (180) | RECORD |
| [packages/store/src/explain-related.ts:298](../../packages/store/src/explain-related.ts#L298) `explainHop` | `keyValue` (298); `SQLite.get` (318); `SQLite.prepare` (318, 332); `Store.sql` (318, 332); `SQLite.all` (332) | RECORD |
| [packages/store/src/explain-related.ts:361](../../packages/store/src/explain-related.ts#L361) `explainCandidate` | `SQLite.get` (361, 375); `SQLite.prepare` (361, 375); `Store.sql` (361, 375); `keyValue` (372); `Calculations.context` (380) | RECORD |
| [packages/store/src/explain.ts:102](../../packages/store/src/explain.ts#L102) `explainField` | `Calculations.value` (102); `Calculations.context` (128) | RECORD |
| [packages/store/src/explain.ts:337](../../packages/store/src/explain.ts#L337) `lintFormula` | `Calculations.context` (337) | RECORD |
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
| [packages/store/src/store.ts:890](../../packages/store/src/store.ts#L890) `Store/metadataVersions` | `SQLite.get` (890); `SQLite.prepare` (890); `Store.sql` (890) | CORE |
| [packages/store/src/store.ts:1029](../../packages/store/src/store.ts#L1029) `Store/constructor` | `Store.sql` (1029, 1031, 1033, 1034, 1038, 1042, 1043, 1054, 1059, 1064, 1065, 1069, 1070, 1071, 1078, 1082, 1086, 1087, 1088, 1093, 1097, 1100, 1101, 1103, 1104, 1107, 1108, 1112, 1113, 1117, 1118, 1121, 1123, 1126, 1127, 1131, 1132, 1136, 1137, 1140, 1141, 1142, 1145, 1146, 1149, 1150, 1152, 1152, 1153, 1153, 1154, 1157, 1161, 1163, 1166, 1167, 1168, 1171, 1172, 1174, 1176, 1177, 1181, 1182, 1184, 1188, 1190, 1191, 1192, 1192, 1196, 1197); `SQLite.get` (1033); `SQLite.prepare` (1033, 1100, 1101, 1104, 1107, 1112, 1117, 1126, 1131, 1136, 1145, 1149, 1152, 1153, 1171, 1176, 1181); `SQLite.all` (1100, 1107, 1112, 1117, 1126, 1131, 1136, 1145, 1149, 1152, 1153, 1171, 1176, 1181) | CORE |
| [packages/store/src/store.ts:1254](../../packages/store/src/store.ts#L1254) `Store/grantFullAccessClients` | `SQLite.prepare` (1254); `Store.sql` (1254) | CORE |
| [packages/store/src/store.ts:1277](../../packages/store/src/store.ts#L1277) `Store/meta` | `SQLite.get` (1277); `SQLite.prepare` (1277); `Store.sql` (1277) | CORE |
| [packages/store/src/store.ts:3532](../../packages/store/src/store.ts#L3532) `Store/webViewerChecked` | `SQLite.get` (3532); `SQLite.prepare` (3532); `Store.sql` (3532) | CORE |
| [packages/store/src/store.ts:1285](../../packages/store/src/store.ts#L1285) `Store/persistentTable` | `Store.sql` (1285) | CORE |
| [packages/store/src/store.ts:1295](../../packages/store/src/store.ts#L1295) `Store/persistentData` | `SQLite.get` (1295) | CORE |
| [packages/store/src/store.ts:1304](../../packages/store/src/store.ts#L1304) `Store/persistentDataIds` | `SQLite.all` (1304) | CORE |
| [packages/store/src/store.ts:1310](../../packages/store/src/store.ts#L1310) `Store/setPersistentData` | `SQLite.prepare` (1310, 1314); `Store.sql` (1310, 1314) | CORE |
| [packages/store/src/store.ts:1334](../../packages/store/src/store.ts#L1334) `Store/checkpoint` | `SQLite.get` (1334); `SQLite.prepare` (1334); `Store.sql` (1334) | CORE |
| [packages/store/src/store.ts:1342](../../packages/store/src/store.ts#L1342) `Store/recordedFormat` | `Store.sql` (1342) | CORE |
| [packages/store/src/store.ts:1352](../../packages/store/src/store.ts#L1352) `Store/close` | `Store.sql` (1352) | CORE |
| [packages/store/src/store.ts:1368](../../packages/store/src/store.ts#L1368) `Store/shipWal` | `Store.sql` (1368) | CORE |
| [packages/store/src/store.ts:1379](../../packages/store/src/store.ts#L1379) `Store/trial` | `Store.sql` (1379) | CORE |
| [packages/store/src/store.ts:1384](../../packages/store/src/store.ts#L1384) `Store/trial/undo` | `Store.sql` (1384) | CORE |
| [packages/store/src/store.ts:1475](../../packages/store/src/store.ts#L1475) `Store/joinTransaction` | `Store.sql` (1475, 1476, 1478, 1480, 1486) | CORE |
| [packages/store/src/store.ts:1498](../../packages/store/src/store.ts#L1498) `Store/independentWindowWrite` | `SQLite.get` (1498); `SQLite.prepare` (1498, 1521); `Store.sql` (1498, 1501, 1516, 1521, 1524) | CORE |
| [packages/store/src/store.ts:1551](../../packages/store/src/store.ts#L1551) `Store/withWriteTransaction` | `Store.sql` (1551, 1562, 1568, 1570, 1570) | CORE |
| [packages/store/src/store.ts:1620](../../packages/store/src/store.ts#L1620) `Store/endTransaction` | `Store.sql` (1620, 1623, 1623) | CORE |
| [packages/store/src/store.ts:1650](../../packages/store/src/store.ts#L1650) `Store/backup` | `Store.sql` (1650) | CORE |
| [packages/store/src/store.ts:1740](../../packages/store/src/store.ts#L1740) `Store/dataVersion` | `SQLite.get` (1740); `SQLite.prepare` (1740); `Store.sql` (1740) | CORE |
| [packages/store/src/store.ts:1780](../../packages/store/src/store.ts#L1780) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1780) | CORE |
| [packages/store/src/store.ts:1801](../../packages/store/src/store.ts#L1801) `Store/shareResults` | `Store.sql` (1801) | CORE |
| [packages/store/src/store.ts:1811](../../packages/store/src/store.ts#L1811) `Store/versionTriggers` | `SQLite.get` (1811); `SQLite.prepare` (1811, 1816, 1817); `Store.sql` (1811, 1813, 1814, 1816, 1817, 1826, 1827); `SQLite.all` (1816, 1817) | CORE |
| [packages/store/src/store.ts:1843](../../packages/store/src/store.ts#L1843) `Store/versionNumber` | `SQLite.get` (1843); `SQLite.prepare` (1843); `Store.sql` (1843) | CORE |
| [packages/store/src/store.ts:1856](../../packages/store/src/store.ts#L1856) `Store/changeOne` | `Store.sql` (1856, 1858) | CORE |
| [packages/store/src/store.ts:1859](../../packages/store/src/store.ts#L1859) `Store/changeOne/read` | `SQLite.get` (1859); `SQLite.prepare` (1859); `Store.sql` (1859) | CORE |
| [packages/store/src/store.ts:1898](../../packages/store/src/store.ts#L1898) `Store/writeToken` | `SQLite.get` (1898); `SQLite.prepare` (1898); `Store.sql` (1898) | CORE |
| [packages/store/src/store.ts:1910](../../packages/store/src/store.ts#L1910) `Store/recordCount` | `SQLite.get` (1910); `SQLite.prepare` (1910); `Store.sql` (1910) | CORE |
| [packages/store/src/store.ts:2024](../../packages/store/src/store.ts#L2024) `Store/applyDesign` | `Store.sql` (2024, 2025, 2038, 2041, 2046, 2062, 2065, 2065); `SQLite.prepare` (2041, 2046) | CORE |
| [packages/store/src/store.ts:2123](../../packages/store/src/store.ts#L2123) `Store/auditLog` | `SQLite.all` (2123); `SQLite.prepare` (2123); `Store.sql` (2123) | CORE |
| [packages/store/src/store.ts:2163](../../packages/store/src/store.ts#L2163) `Store/securityEvents` | `Store.auditLog` (2163) | CORE |
| [packages/store/src/store.ts:2189](../../packages/store/src/store.ts#L2189) `Store/prepared` | `SQLite.prepare` (2189); `Store.sql` (2189) | CORE |
| [packages/store/src/store.ts:2204](../../packages/store/src/store.ts#L2204) `Store/recordAsOf` | `SQLite.get` (2204, 2206); `SQLite.prepare` (2204, 2206, 2208, 2209); `Store.sql` (2204, 2206, 2208, 2209); `SQLite.all` (2208, 2209) | CORE |
| [packages/store/src/store.ts:2282](../../packages/store/src/store.ts#L2282) `Store/revertAuditEntry` | `Store.auditLog` (2282) | CORE |
| [packages/store/src/store.ts:2375](../../packages/store/src/store.ts#L2375) `Store/setAuditSettings` | `SQLite.prepare` (2375); `Store.sql` (2375) | CORE |
| [packages/store/src/store.ts:2397](../../packages/store/src/store.ts#L2397) `Store/pruneAudit` | `Store.sql` (2397, 2399, 2401); `SQLite.get` (2399); `SQLite.prepare` (2399) | CORE |
| [packages/store/src/store.ts:2479](../../packages/store/src/store.ts#L2479) `Store/audit` | `Store.sql` (2479) | CORE |
| [packages/store/src/store.ts:2568](../../packages/store/src/store.ts#L2568) `Store/securityChange` | `Store.sql` (2568, 2570); `SQLite.prepare` (2570) | CORE |
| [packages/store/src/store.ts:2617](../../packages/store/src/store.ts#L2617) `Store/logSecurity` | `Store.sql` (2617) | CORE |
| [packages/store/src/store.ts:2640](../../packages/store/src/store.ts#L2640) `Store/ensureDeleted` | `Store.sql` (2640) | CORE |
| [packages/store/src/store.ts:2645](../../packages/store/src/store.ts#L2645) `Store/deletedRows` | `SQLite.get` (2645); `SQLite.prepare` (2645, 2647, 2647); `Store.sql` (2645, 2647, 2647); `SQLite.all` (2647, 2647) | CORE |
| [packages/store/src/store.ts:2671](../../packages/store/src/store.ts#L2671) `Store/emptyDeleted` | `Store.sql` (2671, 2674, 2675, 2677, 2679); `SQLite.prepare` (2675) | CORE |
| [packages/store/src/store.ts:2686](../../packages/store/src/store.ts#L2686) `Store/designHistory` | `SQLite.all` (2686); `SQLite.prepare` (2686); `Store.sql` (2686) | CORE |
| [packages/store/src/store.ts:2693](../../packages/store/src/store.ts#L2693) `Store/scriptHistory` | `SQLite.all` (2693); `SQLite.prepare` (2693); `Store.sql` (2693) | CORE |
| [packages/store/src/store.ts:2703](../../packages/store/src/store.ts#L2703) `Store/layoutHistory` | `SQLite.all` (2703); `SQLite.prepare` (2703); `Store.sql` (2703) | CORE |
| [packages/store/src/store.ts:2732](../../packages/store/src/store.ts#L2732) `Store/designEffect/renameKey` | `SQLite.prepare` (2732); `Store.sql` (2732) | CORE |
| [packages/store/src/store.ts:2748](../../packages/store/src/store.ts#L2748) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2748); `Store.sql` (2748) | CORE |
| [packages/store/src/store.ts:2755](../../packages/store/src/store.ts#L2755) `Store/designEffect` | `Store.sql` (2755, 2760, 2765, 2770, 2773, 2779, 2790, 2791, 2793, 2806, 2807, 2810, 2812, 2818, 2819, 2820, 2825, 2827, 2831, 2834, 2835, 2837, 2840, 2846, 2848, 2855, 2856, 2858, 2859, 2860, 2861, 2868, 2869, 2871, 2871, 2873, 2874, 2875, 2879, 2883, 2885, 2923, 2925, 2927); `SQLite.get` (2790, 2806, 2818, 2819, 2831, 2835, 2871, 2879); `SQLite.prepare` (2790, 2791, 2806, 2807, 2818, 2819, 2825, 2827, 2831, 2835, 2846, 2848, 2861, 2868, 2869, 2871, 2873, 2875, 2879, 2883); `SQLite.all` (2868, 2869); `SQLite.iterate` (2873) | CORE |
| [packages/store/src/store.ts:2935](../../packages/store/src/store.ts#L2935) `Store/dropColumnIndexes` | `SQLite.all` (2935, 2937); `SQLite.prepare` (2935, 2937); `Store.sql` (2935, 2937, 2938) | CORE |
| [packages/store/src/store.ts:2947](../../packages/store/src/store.ts#L2947) `Store/recompute` | `SQLite.prepare` (2947, 2951); `Store.sql` (2947, 2951); `SQLite.iterate` (2951); `Calculations.computeStoredStyled` (2952); `Calculations.value` (2952) | CORE |
| [packages/store/src/store.ts:2967](../../packages/store/src/store.ts#L2967) `Store/linkPrincipal` | `SQLite.get` (2967); `SQLite.prepare` (2967); `Store.sql` (2967) | CORE |
| [packages/store/src/store.ts:2975](../../packages/store/src/store.ts#L2975) `Store/linkIdentity` | `SQLite.get` (2975); `SQLite.prepare` (2975); `Store.sql` (2975) | CORE |
| [packages/store/src/store.ts:3000](../../packages/store/src/store.ts#L3000) `Store/credentialIdentity` | `SQLite.get` (3000); `SQLite.prepare` (3000); `Store.sql` (3000) | CORE |
| [packages/store/src/store.ts:3006](../../packages/store/src/store.ts#L3006) `Store/accountsSharingLockout` | `SQLite.all` (3006); `SQLite.prepare` (3006); `Store.sql` (3006) | CORE |
| [packages/store/src/store.ts:3010](../../packages/store/src/store.ts#L3010) `Store/accounts` | `SQLite.all` (3010); `SQLite.prepare` (3010); `Store.sql` (3010) | CORE |
| [packages/store/src/store.ts:3022](../../packages/store/src/store.ts#L3022) `Store/isAgent` | `SQLite.get` (3022); `SQLite.prepare` (3022); `Store.sql` (3022) | CORE |
| [packages/store/src/store.ts:3028](../../packages/store/src/store.ts#L3028) `Store/agentNeedsApproval` | `SQLite.get` (3028); `SQLite.prepare` (3028); `Store.sql` (3028) | CORE |
| [packages/store/src/store.ts:3034](../../packages/store/src/store.ts#L3034) `Store/blankPasswordAccounts` | `SQLite.all` (3034); `SQLite.prepare` (3034); `Store.sql` (3034) | CORE |
| [packages/store/src/store.ts:1262](../../packages/store/src/store.ts#L1262) `Store/hasOwnPassword` | `SQLite.get` (1262); `SQLite.prepare` (1262); `Store.sql` (1262) | CORE |
| [packages/store/src/store.ts:3045](../../packages/store/src/store.ts#L3045) `Store/unmigratedAccounts` | `SQLite.all` (3045); `SQLite.prepare` (3045); `Store.sql` (3045) | CORE |
| [packages/store/src/store.ts:3098](../../packages/store/src/store.ts#L3098) `Store/setExternalAccount` | `SQLite.get` (3098); `SQLite.prepare` (3098, 3103); `Store.sql` (3098, 3103) | CORE |
| [packages/store/src/store.ts:3116](../../packages/store/src/store.ts#L3116) `Store/refuseLookalikeAccount` | `SQLite.all` (3116); `SQLite.prepare` (3116); `Store.sql` (3116) | CORE |
| [packages/store/src/store.ts:3125](../../packages/store/src/store.ts#L3125) `Store/isExternal` | `SQLite.get` (3125); `SQLite.prepare` (3125); `Store.sql` (3125) | CORE |
| [packages/store/src/store.ts:3146](../../packages/store/src/store.ts#L3146) `Store/setAgentAccount` | `SQLite.get` (3146); `SQLite.prepare` (3146, 3152); `Store.sql` (3146, 3152) | CORE |
| [packages/store/src/store.ts:3186](../../packages/store/src/store.ts#L3186) `Store/gateAgentWrite` | `SQLite.prepare` (3186); `Store.sql` (3186) | CORE |
| [packages/store/src/store.ts:3208](../../packages/store/src/store.ts#L3208) `Store/pendingChanges` | `SQLite.all` (3208); `SQLite.prepare` (3208); `Store.sql` (3208) | CORE |
| [packages/store/src/store.ts:3222](../../packages/store/src/store.ts#L3222) `Store/approvePending` | `SQLite.get` (3222); `SQLite.prepare` (3222, 3233); `Store.sql` (3222, 3233) | CORE |
| [packages/store/src/store.ts:3243](../../packages/store/src/store.ts#L3243) `Store/rejectPending` | `SQLite.get` (3243); `SQLite.prepare` (3243, 3245); `Store.sql` (3243, 3245) | CORE |
| [packages/store/src/store.ts:3265](../../packages/store/src/store.ts#L3265) `Store/externalAccount` | `SQLite.all` (3265); `SQLite.prepare` (3265); `Store.sql` (3265) | CORE |
| [packages/store/src/store.ts:3296](../../packages/store/src/store.ts#L3296) `Store/setPassword` | `SQLite.get` (3296); `SQLite.prepare` (3296, 3298, 3307); `Store.sql` (3296, 3298, 3307) | AUTH |
| [packages/store/src/store.ts:3321](../../packages/store/src/store.ts#L3321) `Store/createAccount` | `SQLite.get` (3321); `SQLite.prepare` (3321, 3325, 3331, 3336, 3341); `Store.sql` (3321, 3325, 3331, 3336, 3341) | CORE |
| [packages/store/src/store.ts:3349](../../packages/store/src/store.ts#L3349) `Store/appendSecurityEvent` | `Store.sql` (3349) | CORE |
| [packages/store/src/store.ts:3391](../../packages/store/src/store.ts#L3391) `Store/setPasswordPolicy` | `SQLite.prepare` (3391); `Store.sql` (3391) | CORE |
| [packages/store/src/store.ts:3427](../../packages/store/src/store.ts#L3427) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3427); `Store.sql` (3427) | CORE |
| [packages/store/src/store.ts:3450](../../packages/store/src/store.ts#L3450) `Store/saveScriptTest` | `SQLite.prepare` (3450); `Store.sql` (3450) | CORE |
| [packages/store/src/store.ts:3459](../../packages/store/src/store.ts#L3459) `Store/deleteScriptTest` | `SQLite.prepare` (3459); `Store.sql` (3459) | CORE |
| [packages/store/src/store.ts:3494](../../packages/store/src/store.ts#L3494) `Store/setAiAllowed` | `SQLite.prepare` (3494); `Store.sql` (3494) | CORE |
| [packages/store/src/store.ts:3561](../../packages/store/src/store.ts#L3561) `Store/setAiPolicy` | `SQLite.prepare` (3561); `Store.sql` (3561) | CORE |
| [packages/store/src/store.ts:3509](../../packages/store/src/store.ts#L3509) `Store/setScriptNetwork` | `SQLite.prepare` (3509); `Store.sql` (3509) | CORE |
| [packages/store/src/store.ts:3550](../../packages/store/src/store.ts#L3550) `Store/setWebViewerHosts` | `SQLite.prepare` (3550); `Store.sql` (3550) | CORE |
| [packages/store/src/store.ts:3581](../../packages/store/src/store.ts#L3581) `Store/setPiiIsolation` | `SQLite.prepare` (3581); `Store.sql` (3581) | CORE |
| [packages/store/src/store.ts:3603](../../packages/store/src/store.ts#L3603) `Store/markPiiField` | `SQLite.prepare` (3603); `Store.sql` (3603) | CORE |
| [packages/store/src/store.ts:3717](../../packages/store/src/store.ts#L3717) `Store/lastSignIns` | `Store.auditLog` (3717) | CORE |
| [packages/store/src/store.ts:3920](../../packages/store/src/store.ts#L3920) `Store/unusualAccess` | `Store.auditLog` (3920, 3986) | CORE |
| [packages/store/src/store.ts:4017](../../packages/store/src/store.ts#L4017) `Store/leastPrivilege` | `SQLite.all` (4017); `SQLite.prepare` (4017); `Store.sql` (4017) | CORE |
| [packages/store/src/store.ts:4090](../../packages/store/src/store.ts#L4090) `Store/unusedAccess` | `SQLite.get` (4090); `SQLite.prepare` (4090, 4099); `Store.sql` (4090, 4099); `SQLite.all` (4099) | CORE |
| [packages/store/src/store.ts:4138](../../packages/store/src/store.ts#L4138) `Store/unusedObjects` | `SQLite.get` (4138); `SQLite.prepare` (4138, 4141); `Store.sql` (4138, 4141); `SQLite.all` (4141) | CORE |
| [packages/store/src/store.ts:4176](../../packages/store/src/store.ts#L4176) `Store/usageCounting` | `SQLite.get` (4176); `SQLite.prepare` (4176); `Store.sql` (4176) | CORE |
| [packages/store/src/store.ts:4184](../../packages/store/src/store.ts#L4184) `Store/setMustChangePassword` | `SQLite.prepare` (4184); `Store.sql` (4184) | CORE |
| [packages/store/src/store.ts:4198](../../packages/store/src/store.ts#L4198) `Store/mustChangePassword` | `SQLite.get` (4198); `SQLite.prepare` (4198); `Store.sql` (4198) | CORE |
| [packages/store/src/store.ts:4237](../../packages/store/src/store.ts#L4237) `Store/passwordDaysRemaining` | `SQLite.get` (4237); `SQLite.prepare` (4237); `Store.sql` (4237) | CORE |
| [packages/store/src/store.ts:4244](../../packages/store/src/store.ts#L4244) `Store/importAccounts` | `SQLite.all` (4244); `SQLite.prepare` (4244); `Store.sql` (4244) | CORE |
| [packages/store/src/store.ts:4267](../../packages/store/src/store.ts#L4267) `Store/canonicalAccount` | `SQLite.all` (4267); `SQLite.prepare` (4267); `Store.sql` (4267) | CORE |
| [packages/store/src/store.ts:4279](../../packages/store/src/store.ts#L4279) `Store/createLocalAccount` | `SQLite.prepare` (4279); `Store.sql` (4279) | CORE |
| [packages/store/src/store.ts:4309](../../packages/store/src/store.ts#L4309) `Store/previewAccountImport` | `Store.sql` (4309, 4310, 4319) | CORE |
| [packages/store/src/store.ts:4327](../../packages/store/src/store.ts#L4327) `Store/limitAccountImport` | `SQLite.prepare` (4327, 4328, 4331); `Store.sql` (4327, 4328, 4331); `SQLite.get` (4328) | CORE |
| [packages/store/src/store.ts:4338](../../packages/store/src/store.ts#L4338) `Store/applyAccountImport` | `Store.sql` (4338, 4346, 4375); `SQLite.get` (4346); `SQLite.prepare` (4346, 4375) | CORE |
| [packages/store/src/store.ts:4400](../../packages/store/src/store.ts#L4400) `Store/forgetStandIns` | `SQLite.prepare` (4400); `Store.sql` (4400) | CORE |
| [packages/store/src/store.ts:4433](../../packages/store/src/store.ts#L4433) `Store/deleteAccount` | `SQLite.prepare` (4433, 4437, 4438, 4439, 4440, 4441, 4442, 4443, 4444, 4451, 4453, 4456, 4460); `Store.sql` (4433, 4437, 4438, 4439, 4440, 4441, 4442, 4443, 4444, 4451, 4453, 4456, 4460) | CORE |
| [packages/store/src/store.ts:4477](../../packages/store/src/store.ts#L4477) `Store/setAccountActive` | `SQLite.prepare` (4477, 4480, 4481); `Store.sql` (4477, 4480, 4481) | AUTH |
| [packages/store/src/store.ts:4491](../../packages/store/src/store.ts#L4491) `Store/accountInactive` | `SQLite.get` (4491); `SQLite.prepare` (4491); `Store.sql` (4491) | CORE |
| [packages/store/src/store.ts:4496](../../packages/store/src/store.ts#L4496) `Store/identityAllowed` | `SQLite.get` (4496, 4502, 4508); `SQLite.prepare` (4496, 4502, 4508); `Store.sql` (4496, 4502, 4508) | CORE |
| [packages/store/src/store.ts:4517](../../packages/store/src/store.ts#L4517) `Store/externalIdentityId` | `SQLite.get` (4517, 4523); `SQLite.prepare` (4517, 4522, 4523); `Store.sql` (4517, 4522, 4523) | CORE |
| [packages/store/src/store.ts:4528](../../packages/store/src/store.ts#L4528) `Store/accountIdentityId` | `SQLite.get` (4528, 4533); `SQLite.prepare` (4528, 4532, 4533); `Store.sql` (4528, 4532, 4533) | CORE |
| [packages/store/src/store.ts:4556](../../packages/store/src/store.ts#L4556) `Store/signInMark` | `SQLite.prepare` (4556); `Store.sql` (4556) | AUTH |
| [packages/store/src/store.ts:4566](../../packages/store/src/store.ts#L4566) `Store/signInBase` | `SQLite.get` (4566); `SQLite.prepare` (4566); `Store.sql` (4566) | AUTH |
| [packages/store/src/store.ts:4568](../../packages/store/src/store.ts#L4568) `Store/signInBase/identity` | `SQLite.get` (4568); `SQLite.prepare` (4568); `Store.sql` (4568) | AUTH |
| [packages/store/src/store.ts:4580](../../packages/store/src/store.ts#L4580) `Store/ledgerRow` | `SQLite.get` (4580, 4581); `SQLite.prepare` (4580, 4581); `Store.sql` (4580, 4581) | AUTH |
| [packages/store/src/store.ts:4592](../../packages/store/src/store.ts#L4592) `Store/ledgerWrite` | `Store.sql` (4592, 4593, 4595, 4597, 4600, 4600) | AUTH |
| [packages/store/src/store.ts:4619](../../packages/store/src/store.ts#L4619) `Store/settleSignIns` | `SQLite.all` (4619, 4625); `SQLite.prepare` (4619, 4625, 4631, 4635, 4637); `Store.sql` (4619, 4625, 4631, 4635, 4637) | AUTH |
| [packages/store/src/store.ts:4648](../../packages/store/src/store.ts#L4648) `Store/securityToken` | `SQLite.get` (4648); `SQLite.prepare` (4648); `Store.sql` (4648) | CORE |
| [packages/store/src/store.ts:4656](../../packages/store/src/store.ts#L4656) `Store/accountLocalOnly` | `SQLite.get` (4656); `SQLite.prepare` (4656); `Store.sql` (4656) | CORE |
| [packages/store/src/store.ts:4661](../../packages/store/src/store.ts#L4661) `Store/accountRequires2fa` | `SQLite.get` (4661); `SQLite.prepare` (4661); `Store.sql` (4661) | CORE |
| [packages/store/src/store.ts:4667](../../packages/store/src/store.ts#L4667) `Store/setAccountLocalOnly` | `SQLite.prepare` (4667); `Store.sql` (4667) | CORE |
| [packages/store/src/store.ts:4676](../../packages/store/src/store.ts#L4676) `Store/setAccountRequire2fa` | `SQLite.prepare` (4676); `Store.sql` (4676) | CORE |
| [packages/store/src/store.ts:4705](../../packages/store/src/store.ts#L4705) `Store/createApiToken` | `SQLite.get` (4705); `SQLite.prepare` (4705, 4735); `Store.sql` (4705, 4735) | CORE |
| [packages/store/src/store.ts:4782](../../packages/store/src/store.ts#L4782) `Store/recordObjectUse` | `Store.sql` (4782) | CORE |
| [packages/store/src/store.ts:4812](../../packages/store/src/store.ts#L4812) `Store/writeUsage` | `Store.sql` (4812, 4813, 4815, 4819, 4821) | CORE |
| [packages/store/src/store.ts:4828](../../packages/store/src/store.ts#L4828) `Store/writeUsageRows` | `SQLite.prepare` (4828, 4829, 4835); `Store.sql` (4828, 4829, 4835) | CORE |
| [packages/store/src/store.ts:4840](../../packages/store/src/store.ts#L4840) `Store/writeObjectUseRows` | `SQLite.prepare` (4840, 4841, 4846); `Store.sql` (4840, 4841, 4846) | CORE |
| [packages/store/src/store.ts:4851](../../packages/store/src/store.ts#L4851) `Store/objectUseSince` | `SQLite.get` (4851); `SQLite.prepare` (4851); `Store.sql` (4851) | CORE |
| [packages/store/src/store.ts:4864](../../packages/store/src/store.ts#L4864) `Store/accountUsage` | `SQLite.get` (4864); `SQLite.prepare` (4864, 4865); `Store.sql` (4864, 4865); `SQLite.all` (4865); `Store.auditLog` (4881) | CORE |
| [packages/store/src/store.ts:4897](../../packages/store/src/store.ts#L4897) `Store/apiTokens` | `SQLite.all` (4897); `SQLite.prepare` (4897); `Store.sql` (4897) | CORE |
| [packages/store/src/store.ts:4907](../../packages/store/src/store.ts#L4907) `Store/revokeApiToken` | `SQLite.prepare` (4907); `Store.sql` (4907) | CORE |
| [packages/store/src/store.ts:4921](../../packages/store/src/store.ts#L4921) `Store/apiToken` | `SQLite.get` (4921); `SQLite.prepare` (4921, 4933); `Store.sql` (4921, 4933) | CORE |
| [packages/store/src/store.ts:4949](../../packages/store/src/store.ts#L4949) `Store/enrollTotp` | `SQLite.prepare` (4949); `Store.sql` (4949) | CORE |
| [packages/store/src/store.ts:4960](../../packages/store/src/store.ts#L4960) `Store/confirmTotp` | `SQLite.get` (4960); `SQLite.prepare` (4960, 4962); `Store.sql` (4960, 4962) | CORE |
| [packages/store/src/store.ts:4970](../../packages/store/src/store.ts#L4970) `Store/hasTotp` | `SQLite.get` (4970); `SQLite.prepare` (4970); `Store.sql` (4970) | CORE |
| [packages/store/src/store.ts:4975](../../packages/store/src/store.ts#L4975) `Store/totpAccounts` | `SQLite.all` (4975); `SQLite.prepare` (4975); `Store.sql` (4975) | CORE |
| [packages/store/src/store.ts:4981](../../packages/store/src/store.ts#L4981) `Store/disableTotp` | `SQLite.prepare` (4981); `Store.sql` (4981) | CORE |
| [packages/store/src/store.ts:5004](../../packages/store/src/store.ts#L5004) `Store/verifyTotp` | `SQLite.get` (5004); `SQLite.prepare` (5004, 5010); `Store.sql` (5004, 5010) | CORE |
| [packages/store/src/store.ts:5023](../../packages/store/src/store.ts#L5023) `Store/issueWebauthnChallenge` | `SQLite.prepare` (5023, 5025, 5026, 5028); `Store.sql` (5023, 5025, 5026, 5028); `SQLite.get` (5025) | CORE |
| [packages/store/src/store.ts:5075](../../packages/store/src/store.ts#L5075) `Store/passkeyAllowList` | `SQLite.all` (5075); `SQLite.prepare` (5075); `Store.sql` (5075) | CORE |
| [packages/store/src/store.ts:5089](../../packages/store/src/store.ts#L5089) `Store/takeWebauthnChallenge` | `SQLite.get` (5089); `SQLite.prepare` (5089, 5091); `Store.sql` (5089, 5091) | CORE |
| [packages/store/src/store.ts:5099](../../packages/store/src/store.ts#L5099) `Store/passkeys` | `SQLite.all` (5099); `SQLite.prepare` (5099); `Store.sql` (5099) | CORE |
| [packages/store/src/store.ts:5106](../../packages/store/src/store.ts#L5106) `Store/hasPasskey` | `SQLite.get` (5106); `SQLite.prepare` (5106); `Store.sql` (5106) | CORE |
| [packages/store/src/store.ts:5111](../../packages/store/src/store.ts#L5111) `Store/passkeyIds` | `SQLite.all` (5111); `SQLite.prepare` (5111); `Store.sql` (5111) | CORE |
| [packages/store/src/store.ts:5133](../../packages/store/src/store.ts#L5133) `Store/registerPasskey` | `SQLite.prepare` (5133); `Store.sql` (5133) | CORE |
| [packages/store/src/store.ts:5144](../../packages/store/src/store.ts#L5144) `Store/removePasskey` | `SQLite.get` (5144); `SQLite.prepare` (5144, 5145); `Store.sql` (5144, 5145) | CORE |
| [packages/store/src/store.ts:5161](../../packages/store/src/store.ts#L5161) `Store/verifyPasskeyAssertion` | `SQLite.get` (5161); `SQLite.prepare` (5161, 5172); `Store.sql` (5161, 5172) | CORE |
| [packages/store/src/store.ts:5208](../../packages/store/src/store.ts#L5208) `Store/generateRecoveryCodes` | `SQLite.prepare` (5208, 5211); `Store.sql` (5208, 5211) | CORE |
| [packages/store/src/store.ts:5226](../../packages/store/src/store.ts#L5226) `Store/recoveryCodesRemaining` | `SQLite.get` (5226); `SQLite.prepare` (5226); `Store.sql` (5226) | CORE |
| [packages/store/src/store.ts:5236](../../packages/store/src/store.ts#L5236) `Store/useRecoveryCode` | `SQLite.get` (5236); `SQLite.prepare` (5236, 5238); `Store.sql` (5236, 5238) | CORE |
| [packages/store/src/store.ts:5249](../../packages/store/src/store.ts#L5249) `Store/privilegeSets` | `Store.sql` (5249) | CORE |
| [packages/store/src/store.ts:5278](../../packages/store/src/store.ts#L5278) `Store/savePrivilegeSet` | `SQLite.prepare` (5278, 5286); `Store.sql` (5278, 5286) | AUTH |
| [packages/store/src/store.ts:5321](../../packages/store/src/store.ts#L5321) `Store/deletePrivilegeSet` | `SQLite.prepare` (5321); `Store.sql` (5321) | CORE |
| [packages/store/src/store.ts:5390](../../packages/store/src/store.ts#L5390) `Store/accountPrivilegeSet` | `SQLite.get` (5390); `SQLite.prepare` (5390); `Store.sql` (5390) | CORE |
| [packages/store/src/store.ts:5404](../../packages/store/src/store.ts#L5404) `Store/setAccountPrivilegeSet` | `SQLite.get` (5404); `SQLite.prepare` (5404, 5407, 5411); `Store.sql` (5404, 5407, 5411) | AUTH |
| [packages/store/src/store.ts:5426](../../packages/store/src/store.ts#L5426) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5426); `Store.sql` (5426) | CORE |
| [packages/store/src/store.ts:5440](../../packages/store/src/store.ts#L5440) `Store/addProvisionedAccount` | `SQLite.get` (5440); `SQLite.prepare` (5440, 5444); `Store.sql` (5440, 5444) | CORE |
| [packages/store/src/store.ts:5613](../../packages/store/src/store.ts#L5613) `Store/ruleOutcome` | `Calculations.context` (5613) | CORE |
| [packages/store/src/store.ts:5654](../../packages/store/src/store.ts#L5654) `Store/allowedIds` | `SQLite.iterate` (5654); `SQLite.prepare` (5654); `Store.sql` (5654) | CORE |
| [packages/store/src/store.ts:5724](../../packages/store/src/store.ts#L5724) `Store/scopedTableSql` | `Store.viewableIds` (5724); `SQLite.all` (5727); `SQLite.prepare` (5727); `Store.sql` (5727) | GATED-STORE |
| [packages/store/src/store.ts:5759](../../packages/store/src/store.ts#L5759) `Store/previewRecordRuleCurrent` | `SQLite.get` (5759); `SQLite.prepare` (5759, 5762); `Store.sql` (5759, 5762); `SQLite.all` (5762); `Calculations.context` (5768, 5784) | CORE |
| [packages/store/src/store.ts:5936](../../packages/store/src/store.ts#L5936) `Store/passwordHash` | `SQLite.get` (5936); `SQLite.prepare` (5936); `Store.sql` (5936) | CORE |
| [packages/store/src/store.ts:5965](../../packages/store/src/store.ts#L5965) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5965); `Store.sql` (5965) | CORE |
| [packages/store/src/store.ts:5978](../../packages/store/src/store.ts#L5978) `Store/knownSharedAccount` | `SQLite.get` (5978); `SQLite.prepare` (5978); `Store.sql` (5978) | CORE |
| [packages/store/src/store.ts:6041](../../packages/store/src/store.ts#L6041) `Store/layouts` | `SQLite.all` (6041); `SQLite.prepare` (6041); `Store.sql` (6041) | CORE |
| [packages/store/src/store.ts:6062](../../packages/store/src/store.ts#L6062) `Store/image` | `SQLite.get` (6062); `SQLite.prepare` (6062); `Store.sql` (6062) | CORE |
| [packages/store/src/store.ts:6072](../../packages/store/src/store.ts#L6072) `Store/images` | `SQLite.all` (6072); `SQLite.prepare` (6072); `Store.sql` (6072) | CORE |
| [packages/store/src/store.ts:6085](../../packages/store/src/store.ts#L6085) `Store/addImage` | `Store.sql` (6085, 6086); `SQLite.prepare` (6086) | CORE |
| [packages/store/src/store.ts:6102](../../packages/store/src/store.ts#L6102) `Store/layout` | `SQLite.get` (6102); `SQLite.prepare` (6102); `Store.sql` (6102) | CORE |
| [packages/store/src/store.ts:6306](../../packages/store/src/store.ts#L6306) `Store/wordIndex` | `Store.sql` (6306, 6314, 6319); `Store.recordCount` (6318); `SQLite.get` (6319); `SQLite.prepare` (6319) | CORE |
| [packages/store/src/store.ts:6371](../../packages/store/src/store.ts#L6371) `Store/toRecord` | `Calculations.value` (6371, 6381); `Calculations.globalValue` (6375); `Calculations.unstoredStyled` (6380) | CORE |
| [packages/store/src/store.ts:6430](../../packages/store/src/store.ts#L6430) `Store/relatedValues` | `Calculations.globalValue` (6430); `Calculations.unstoredValue` (6432) | CORE |
| [packages/store/src/store.ts:6504](../../packages/store/src/store.ts#L6504) `Store/addRelated` | `relatedRows` (6504); `rowsById` (6536); `firstRelatedEach` (6559) | CORE |
| [packages/store/src/store.ts:6587](../../packages/store/src/store.ts#L6587) `Store/foundSetPage` | `rowsById` (6587) | CORE |
| [packages/store/src/store.ts:6603](../../packages/store/src/store.ts#L6603) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6603); `Store.row` (6619) | GATED-STORE |
| [packages/store/src/store.ts:6642](../../packages/store/src/store.ts#L6642) `Store/portalCountsCurrent` | `Store.canView` (6642); `Store.row` (6669) | GATED-STORE |
| [packages/store/src/store.ts:6705](../../packages/store/src/store.ts#L6705) `Store/fieldIndexCurrent` | `SQLite.iterate` (6705); `SQLite.prepare` (6705, 6710); `Store.sql` (6705, 6710); `SQLite.all` (6710) | GATED-STORE |
| [packages/store/src/store.ts:6751](../../packages/store/src/store.ts#L6751) `Store/valueListItemsCurrent` | `Store.valueListItems` (6751); `Store.get` (6765); `relatedRows` (6766); `Store.row` (6766); `SQLite.iterate` (6768); `SQLite.prepare` (6768); `Store.sql` (6768); `Calculations.related` (6778); `Calculations.value` (6782, 6783) | GATED-STORE |
| [packages/store/src/store.ts:6880](../../packages/store/src/store.ts#L6880) `Store/portalRows` | `relatedRows` (6880); `relatedIdList` (6881); `Store.viewableIds` (6884); `rowsById` (6909, 6947); `Calculations.related` (6923) | CORE |
| [packages/store/src/store.ts:6891](../../packages/store/src/store.ts#L6891) `Store/portalRows/context` | `Calculations.context` (6891) | CORE |
| [packages/store/src/store.ts:6901](../../packages/store/src/store.ts#L6901) `Store/portalRows/valueOf` | `Calculations.value` (6901) | CORE |
| [packages/store/src/store.ts:7018](../../packages/store/src/store.ts#L7018) `Store/markRepeating` | `SQLite.prepare` (7018); `Store.sql` (7018) | CORE |
| [packages/store/src/store.ts:7045](../../packages/store/src/store.ts#L7045) `Store/externalContainerCheck` | `SQLite.all` (7045); `SQLite.prepare` (7045); `Store.sql` (7045) | CORE |
| [packages/store/src/store.ts:7052](../../packages/store/src/store.ts#L7052) `Store/externalContainerCount` | `SQLite.get` (7052); `SQLite.prepare` (7052); `Store.sql` (7052) | CORE |
| [packages/store/src/store.ts:7061](../../packages/store/src/store.ts#L7061) `Store/externalContainerReport` | `SQLite.all` (7061, 7074); `SQLite.prepare` (7061, 7074); `Store.sql` (7061, 7074) | CORE |
| [packages/store/src/store.ts:7210](../../packages/store/src/store.ts#L7210) `Store/orphanContainerReport` | `SQLite.all` (7210); `SQLite.prepare` (7210); `Store.sql` (7210) | CORE |
| [packages/store/src/store.ts:7245](../../packages/store/src/store.ts#L7245) `Store/purgeOrphanContainers` | `Store.sql` (7245, 7249, 7258, 7261, 7262, 7267, 7268, 7270, 7270); `Store.orphanContainerReport` (7253); `SQLite.get` (7258); `SQLite.prepare` (7258, 7261, 7262) | CORE |
| [packages/store/src/store.ts:7283](../../packages/store/src/store.ts#L7283) `Store/containerIntact` | `SQLite.get` (7283); `SQLite.prepare` (7283); `Store.sql` (7283) | CORE |
| [packages/store/src/store.ts:7293](../../packages/store/src/store.ts#L7293) `Store/externalOf` | `SQLite.get` (7293); `SQLite.prepare` (7293); `Store.sql` (7293) | CORE |
| [packages/store/src/store.ts:7297](../../packages/store/src/store.ts#L7297) `Store/containerMeta` | `SQLite.get` (7297); `SQLite.prepare` (7297); `Store.sql` (7297) | CORE |
| [packages/store/src/store.ts:7302](../../packages/store/src/store.ts#L7302) `Store/container` | `SQLite.get` (7302); `SQLite.prepare` (7302, 7311); `Store.sql` (7302, 7311); `SQLite.all` (7311) | CORE |
| [packages/store/src/store.ts:7319](../../packages/store/src/store.ts#L7319) `Store/containerInfo` | `SQLite.get` (7319); `SQLite.prepare` (7319); `Store.sql` (7319) | CORE |
| [packages/store/src/store.ts:7353](../../packages/store/src/store.ts#L7353) `Store/containerRange` | `SQLite.all` (7353); `SQLite.prepare` (7353, 7360); `Store.sql` (7353, 7360); `SQLite.get` (7360) | CORE |
| [packages/store/src/store.ts:7378](../../packages/store/src/store.ts#L7378) `Store/addContainer` | `SQLite.all` (7378); `SQLite.prepare` (7378, 7383, 7397, 7401, 7402); `Store.sql` (7378, 7383, 7397, 7399, 7401, 7402, 7404, 7407); `SQLite.get` (7388); `Store.containerRange` (7390) | CORE |
| [packages/store/src/store.ts:7424](../../packages/store/src/store.ts#L7424) `Store/addExternalContainer` | `SQLite.prepare` (7424); `Store.sql` (7424) | CORE |
| [packages/store/src/store.ts:7442](../../packages/store/src/store.ts#L7442) `Store/writeExternalFile` | `Store.evaluateEach` (7442); `SQLite.prepare` (7465); `Store.sql` (7465) | CORE |
| [packages/store/src/store.ts:7466](../../packages/store/src/store.ts#L7466) `Store/writeExternalFile/taken` | `SQLite.get` (7466) | CORE |
| [packages/store/src/store.ts:7516](../../packages/store/src/store.ts#L7516) `Store/embeddedContainers` | `SQLite.prepare` (7516, 7517); `Store.sql` (7516, 7517); `SQLite.all` (7517); `SQLite.get` (7521) | CORE |
| [packages/store/src/store.ts:7530](../../packages/store/src/store.ts#L7530) `Store/embeddedContainerCount` | `SQLite.prepare` (7530); `Store.sql` (7530); `SQLite.get` (7531) | CORE |
| [packages/store/src/store.ts:7539](../../packages/store/src/store.ts#L7539) `Store/recoverContainersOut` | `SQLite.prepare` (7539); `Store.sql` (7539); `SQLite.get` (7542) | CORE |
| [packages/store/src/store.ts:7567](../../packages/store/src/store.ts#L7567) `Store/moveContainersOut` | `Store.sql` (7567, 7575, 7577, 7579, 7584, 7585, 7605, 7611, 7613, 7615, 7615, 7621, 7621, 7626, 7628, 7630, 7630, 7636); `SQLite.get` (7575); `SQLite.prepare` (7575, 7584, 7585); `Store.container` (7587) | CORE |
| [packages/store/src/store.ts:7645](../../packages/store/src/store.ts#L7645) `Store/moveContainersIn` | `Store.sql` (7645, 7651, 7653, 7654, 7655, 7656, 7676, 7681, 7681, 7692, 7695, 7698, 7705); `SQLite.prepare` (7653, 7654, 7655, 7656, 7692, 7698); `SQLite.get` (7658, 7692, 7698) | CORE |
| [packages/store/src/store.ts:7717](../../packages/store/src/store.ts#L7717) `Store/compactFile` | `Store.sql` (7717, 7718, 7720) | CORE |
| [packages/store/src/store.ts:7726](../../packages/store/src/store.ts#L7726) `Store/containerId` | `Store.containerId` (7726); `Store.row` (7727) | CORE |
| [packages/store/src/store.ts:7749](../../packages/store/src/store.ts#L7749) `Store/checkContainerWrite` | `Store.row` (7749) | CORE |
| [packages/store/src/store.ts:7758](../../packages/store/src/store.ts#L7758) `Store/setContainer` | `Store.sql` (7758, 7775); `Store.row` (7764); `SQLite.prepare` (7775) | CORE |
| [packages/store/src/store.ts:7808](../../packages/store/src/store.ts#L7808) `Store/orderBy` | `Store.valueListItems` (7808) | CORE |
| [packages/store/src/store.ts:7831](../../packages/store/src/store.ts#L7831) `Store/userPrefs` | `SQLite.all` (7831); `SQLite.prepare` (7831); `Store.sql` (7831) | CORE |
| [packages/store/src/store.ts:7836](../../packages/store/src/store.ts#L7836) `Store/hasTable` | `SQLite.get` (7836); `SQLite.prepare` (7836); `Store.sql` (7836) | CORE |
| [packages/store/src/store.ts:7840](../../packages/store/src/store.ts#L7840) `Store/setUserPref` | `Store.sql` (7840, 7841, 7842); `SQLite.prepare` (7841, 7842) | CORE |
| [packages/store/src/store.ts:7848](../../packages/store/src/store.ts#L7848) `Store/indexedFields` | `SQLite.all` (7848, 7849); `SQLite.prepare` (7848, 7849); `Store.sql` (7848, 7849) | CORE |
| [packages/store/src/store.ts:7870](../../packages/store/src/store.ts#L7870) `Store/addFieldIndex` | `Store.sql` (7870) | CORE |
| [packages/store/src/store.ts:7882](../../packages/store/src/store.ts#L7882) `Store/dropFieldIndex` | `SQLite.get` (7882); `SQLite.prepare` (7882); `Store.sql` (7882, 7883) | CORE |
| [packages/store/src/store.ts:7893](../../packages/store/src/store.ts#L7893) `Store/timeFind` | `Store.query` (7893, 7897, 7898); `Store.recordCount` (7900) | CORE |
| [packages/store/src/store.ts:7917](../../packages/store/src/store.ts#L7917) `Store/find` | `Store.find` (7917) | GATED-STORE |
| [packages/store/src/store.ts:7928](../../packages/store/src/store.ts#L7928) `Store/findHere` | `Store.query` (7928, 7933, 7935, 7949, 7951, 7961); `Store.recordCount` (7946); `SQLite.get` (7947, 7951); `SQLite.prepare` (7947, 7951, 7956, 7963, 7972); `Store.sql` (7947, 7951, 7956, 7963, 7972); `SQLite.all` (7956, 7963, 7972) | GATED-STORE |
| [packages/store/src/store.ts:7967](../../packages/store/src/store.ts#L7967) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7967); `SQLite.prepare` (7967); `Store.sql` (7967) | GATED-STORE |
| [packages/store/src/store.ts:8000](../../packages/store/src/store.ts#L8000) `Store/sortedPage` | `SQLite.iterate` (8000); `SQLite.prepare` (8000, 8015); `Store.sql` (8000, 8015); `SQLite.all` (8015) | CORE |
| [packages/store/src/store.ts:8072](../../packages/store/src/store.ts#L8072) `Store/relatedCriteria/matched` | `relatedRows` (8072) | CORE |
| [packages/store/src/store.ts:8075](../../packages/store/src/store.ts#L8075) `Store/relatedCriteria` | `SQLite.iterate` (8075); `SQLite.prepare` (8075); `Store.sql` (8075) | CORE |
| [packages/store/src/store.ts:8101](../../packages/store/src/store.ts#L8101) `Store/computedRows` | `Store.sql` (8101, 8104, 8105, 8106, 8108, 8118, 8119, 8120, 8123); `SQLite.prepare` (8104, 8106, 8108, 8118); `SQLite.iterate` (8108); `Calculations.globalValue` (8111); `Calculations.unstoredValue` (8112); `Calculations.related` (8115); `SQLite.all` (8118) | CORE |
| [packages/store/src/store.ts:8148](../../packages/store/src/store.ts#L8148) `Store/summaries` | `Calculations.wholeTable` (8148); `Calculations.collect` (8168, 8173) | CORE |
| [packages/store/src/store.ts:8164](../../packages/store/src/store.ts#L8164) `Store/summaries/recs` | `SQLite.iterate` (8164); `SQLite.prepare` (8164); `Store.sql` (8164) | CORE |
| [packages/store/src/store.ts:8186](../../packages/store/src/store.ts#L8186) `Store/runningSummaryValues` | `Store.viewableIds` (8186); `rowsById` (8188); `Calculations.value` (8199, 8205); `Calculations.related` (8216) | GATED-STORE |
| [packages/store/src/store.ts:8232](../../packages/store/src/store.ts#L8232) `Store/findSource` | `Store.query` (8232); `SQLite.all` (8241, 8258); `SQLite.prepare` (8241, 8249, 8257); `Store.sql` (8241, 8246, 8249, 8254, 8257, 8271, 8273); `Calculations.globalValue` (8263); `Calculations.unstoredValue` (8264); `Calculations.related` (8268) | CORE |
| [packages/store/src/store.ts:8288](../../packages/store/src/store.ts#L8288) `Store/findCandidates` | `Store.query` (8288) | CORE |
| [packages/store/src/store.ts:8323](../../packages/store/src/store.ts#L8323) `Store/previewRow` | `Store.row` (8323) | CORE |
| [packages/store/src/store.ts:8341](../../packages/store/src/store.ts#L8341) `Store/row` | `SQLite.get` (8341) | CORE |
| [packages/store/src/store.ts:8360](../../packages/store/src/store.ts#L8360) `Store/getCurrent` | `Store.get` (8360); `Store.row` (8361, 8361, 8375); `SQLite.all` (8378); `SQLite.prepare` (8378); `Store.sql` (8378) | GATED-STORE |
| [packages/store/src/store.ts:8398](../../packages/store/src/store.ts#L8398) `Store/getManyCurrent` | `Store.getMany` (8398); `SQLite.get` (8416); `SQLite.prepare` (8416); `Store.sql` (8416) | GATED-STORE |
| [packages/store/src/store.ts:8409](../../packages/store/src/store.ts#L8409) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8409) | GATED-STORE |
| [packages/store/src/store.ts:8432](../../packages/store/src/store.ts#L8432) `Store/canViewRecord` | `SQLite.get` (8432); `SQLite.prepare` (8432); `Store.sql` (8432) | GATED-STORE |
| [packages/store/src/store.ts:8440](../../packages/store/src/store.ts#L8440) `Store/canView` | `Store.canView` (8440); `Store.row` (8441) | GATED-STORE |
| [packages/store/src/store.ts:8465](../../packages/store/src/store.ts#L8465) `Store/create` | `SQLite.get` (8465, 8471); `SQLite.prepare` (8465, 8471, 8484); `Store.sql` (8465, 8471, 8484) | CORE |
| [packages/store/src/store.ts:8508](../../packages/store/src/store.ts#L8508) `Store/duplicate` | `Store.row` (8508); `SQLite.get` (8512); `SQLite.prepare` (8512, 8527); `Store.sql` (8512, 8527) | CORE |
| [packages/store/src/store.ts:8575](../../packages/store/src/store.ts#L8575) `Store/update` | `Store.row` (8575); `Store.sql` (8604, 8605, 8644, 8647) | CORE |
| [packages/store/src/store.ts:8607](../../packages/store/src/store.ts#L8607) `Store/update/undo` | `Store.sql` (8607) | CORE |
| [packages/store/src/store.ts:8752](../../packages/store/src/store.ts#L8752) `Store/setStoredCalcValues` | `SQLite.prepare` (8752, 8753); `Store.sql` (8752, 8753); `SQLite.get` (8757) | CORE |
| [packages/store/src/store.ts:8832](../../packages/store/src/store.ts#L8832) `Store/evaluateCurrent` | `Store.row` (8832, 8832); `Calculations.context` (8837); `Store.get` (8838, 8840) | GATED-STORE |
| [packages/store/src/store.ts:8872](../../packages/store/src/store.ts#L8872) `Store/evaluateEachCurrent` | `Store.row` (8872, 8872); `Calculations.context` (8877); `Store.get` (8879) | GATED-STORE |
| [packages/store/src/store.ts:8912](../../packages/store/src/store.ts#L8912) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8912); `Store.get` (8914) | GATED-STORE |
| [packages/store/src/store.ts:8933](../../packages/store/src/store.ts#L8933) `Store/evaluateRowsCurrent` | `Store.row` (8933, 8933) | GATED-STORE |
| [packages/store/src/store.ts:8947](../../packages/store/src/store.ts#L8947) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8947) | GATED-STORE |
| [packages/store/src/store.ts:8969](../../packages/store/src/store.ts#L8969) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8969) | GATED-STORE |
| [packages/store/src/store.ts:9007](../../packages/store/src/store.ts#L9007) `Store/updateRelated` | `relatedRows` (9007) | CORE |
| [packages/store/src/store.ts:9025](../../packages/store/src/store.ts#L9025) `Store/updatePortals` | `Store.row` (9025, 9060); `relatedRows` (9061) | CORE |
| [packages/store/src/store.ts:9034](../../packages/store/src/store.ts#L9034) `Store/updatePortals/portal/related` | `relatedIdList` (9034) | CORE |
| [packages/store/src/store.ts:9116](../../packages/store/src/store.ts#L9116) `Store/portalContainerTarget` | `Store.row` (9116); `relatedIdList` (9117) | CORE |
| [packages/store/src/store.ts:9130](../../packages/store/src/store.ts#L9130) `Store/checkEditable` | `Store.row` (9130) | CORE |
| [packages/store/src/store.ts:9154](../../packages/store/src/store.ts#L9154) `Store/delete` | `Store.row` (9154) | CORE |
| [packages/store/src/store.ts:9162](../../packages/store/src/store.ts#L9162) `Store/delete/run` | `SQLite.get` (9162); `SQLite.prepare` (9162, 9166); `Store.sql` (9162, 9166) | CORE |
| [packages/store/src/store.ts:9394](../../packages/store/src/store.ts#L9394) `Store/keyStepWork` | `Store.sql` (9394, 9400, 9404, 9406) | CORE |
| [packages/store/src/store.ts:9195](../../packages/store/src/store.ts#L9195) `Store/vaultHeld` | `SQLite.get` (9195); `SQLite.prepare` (9195); `Store.sql` (9195) | CORE |
| [packages/store/src/store.ts:9202](../../packages/store/src/store.ts#L9202) `Store/forgetStandInValues` | `Store.sql` (9202, 9223); `SQLite.prepare` (9223) | CORE |
| [packages/store/src/store.ts:9242](../../packages/store/src/store.ts#L9242) `Store/restoreDeletedRowLocked` | `SQLite.get` (9242); `SQLite.prepare` (9242, 9243, 9247); `Store.sql` (9242, 9243, 9247); `SQLite.all` (9243) | CORE |
| [packages/store/src/store.ts:9447](../../packages/store/src/store.ts#L9447) `Store/cascadeDelete` | `relatedRows` (9447) | CORE |
| [packages/store/src/store.ts:9537](../../packages/store/src/store.ts#L9537) `Store/selectIdsCurrent` | `Store.selectIds` (9537); `SQLite.all` (9543); `SQLite.prepare` (9543); `Store.sql` (9543) | GATED-STORE |
| [packages/store/src/store.ts:9551](../../packages/store/src/store.ts#L9551) `Store/countIds` | `Store.countIds` (9551); `SQLite.get` (9555); `SQLite.prepare` (9555); `Store.sql` (9555) | GATED-STORE |
| [packages/store/src/store.ts:9571](../../packages/store/src/store.ts#L9571) `Store/computeValuesCurrent` | `Store.computeValues` (9571); `Store.sql` (9577, 9581); `SQLite.all` (9581); `SQLite.prepare` (9581) | GATED-STORE |
| [packages/store/src/store.ts:9596](../../packages/store/src/store.ts#L9596) `Store/findIdsCurrent` | `Store.findIds` (9596) | GATED-STORE |
| [packages/store/src/store.ts:9602](../../packages/store/src/store.ts#L9602) `Store/findIdsHere` | `Store.query` (9602, 9607, 9609); `SQLite.iterate` (9620); `SQLite.prepare` (9620); `Store.sql` (9620) | GATED-STORE |
| [packages/store/src/store.ts:9637](../../packages/store/src/store.ts#L9637) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9637); `Store.viewableIds` (9642); `Calculations.collect` (9658); `rowsById` (9658, 9708); `Calculations.collector` (9680) | GATED-STORE |
| [packages/store/src/store.ts:9670](../../packages/store/src/store.ts#L9670) `Store/groupSummariesCurrent/key` | `Calculations.value` (9670); `Calculations.related` (9672) | GATED-STORE |
| [packages/store/src/store.ts:9706](../../packages/store/src/store.ts#L9706) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9706) | GATED-STORE |
| [packages/store/src/store.ts:9762](../../packages/store/src/store.ts#L9762) `Store/sortIdsCurrentProgress` | `SQLite.all` (9762); `SQLite.prepare` (9762, 9830); `Store.sql` (9762, 9830); `Store.valueListItems` (9770); `rowsById` (9782); `Calculations.globalValue` (9785); `Calculations.unstoredValue` (9786); `Calculations.related` (9792); `SQLite.iterate` (9830) | GATED-STORE |
| [packages/store/src/store.ts:9844](../../packages/store/src/store.ts#L9844) `Store/matchIds` | `Store.matchIds` (9844); `SQLite.all` (9850); `SQLite.prepare` (9850); `Store.sql` (9850) | CORE |
| [packages/store/src/store.ts:9872](../../packages/store/src/store.ts#L9872) `Store/truncate/run` | `Store.sql` (9872, 9874, 9881, 9883, 9885, 9886); `SQLite.prepare` (9874, 9881); `SQLite.all` (9876) | CORE |
| [packages/store/src/store.ts:9911](../../packages/store/src/store.ts#L9911) `Store/iterateCommitted` | `SQLite.iterate` (9911) | CORE |
| [packages/store/src/store.ts:9945](../../packages/store/src/store.ts#L9945) `Store/readOnlyChecked` | `SQLite.prepare` (9945, 9949, 9958, 9963); `SQLite.all` (9949, 9958, 9963) | CORE |
| [packages/store/src/store.ts:9985](../../packages/store/src/store.ts#L9985) `Store/refreshDecimalSqlViews` | `SQLite.get` (9985); `SQLite.prepare` (9985, 9990); `SQLite.all` (9990) | CORE |
| [packages/store/src/store.ts:10004](../../packages/store/src/store.ts#L10004) `Store/internalRoots` | `SQLite.get` (10004); `SQLite.prepare` (10004, 10006); `SQLite.all` (10006) | CORE |
| [packages/store/src/store.ts:10039](../../packages/store/src/store.ts#L10039) `Store/selectCurrent` | `SQLite.iterate` (10039) | CORE |
| [packages/store/src/store.ts:10088](../../packages/store/src/store.ts#L10088) `Store/query` | `SQLite.iterate` (10088) | CORE |
| [packages/store/src/store.ts:10122](../../packages/store/src/store.ts#L10122) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10122); `SQLite.all` (10129, 10132); `SQLite.prepare` (10129, 10132) | CORE |
| [packages/store/src/store.ts:1207](../../packages/store/src/store.ts#L1207) `Store/ensureNativeIds` | `SQLite.all` (1207, 1219); `SQLite.prepare` (1207, 1210, 1218, 1219); `Store.sql` (1207, 1210, 1213, 1217, 1218, 1219, 1222, 1224) | CORE |
| [packages/store/src/store.ts:1232](../../packages/store/src/store.ts#L1232) `Store/nativeIdGuards` | `Store.sql` (1232, 1233, 1235) | CORE |
| [packages/store/src/store.ts:10055](../../packages/store/src/store.ts#L10055) `Store/selectIn` | `Store.select` (10055) | CORE |
| [packages/store/src/store.ts:10063](../../packages/store/src/store.ts#L10063) `Store/selectHeldCurrent` | `Store.sql` (10063, 10064); `SQLite.prepare` (10064); `SQLite.iterate` (10067) | CORE |
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
| [packages/store/src/store.ts:1670](../../packages/store/src/store.ts#L1670) `Store/selfContainedCopy` | `Store.sql` (1670); `SQLite.all` (1675); `SQLite.prepare` (1675, 1677, 1678, 1679) | CORE |
| [packages/store/src/store.ts:7124](../../packages/store/src/store.ts#L7124) `Store/containerReferences` | `SQLite.all` (7124, 7143, 7145, 7151, 7164, 7175, 7189); `SQLite.prepare` (7124, 7143, 7145, 7151, 7164, 7175, 7187, 7189); `Store.sql` (7124, 7143, 7145, 7151, 7164, 7175, 7187, 7189); `SQLite.get` (7187); `Store.row` (7198) | CORE |
| [packages/store/src/store.ts:7222](../../packages/store/src/store.ts#L7222) `Store/containerIntegrityReport` | `SQLite.all` (7222); `SQLite.prepare` (7222, 7233); `Store.sql` (7222, 7233); `SQLite.get` (7233) | CORE |
| [packages/store/src/store.ts:1418](../../packages/store/src/store.ts#L1418) `Store/recoverPendingExternalFiles` | `Store.sql` (1418, 1420, 1439, 1441); `SQLite.prepare` (1420); `SQLite.get` (1429) | CORE |
| [packages/store/src/store.ts:2239](../../packages/store/src/store.ts#L2239) `Store/restoreRecord` | `Store.recordAsOf` (2239); `SQLite.get` (2243); `SQLite.prepare` (2243, 2247, 2256, 2267); `Store.sql` (2243, 2247, 2256, 2267) | CORE |
| [packages/server/src/compaction.ts:65](../../packages/server/src/compaction.ts#L65) `compactStore` | `SQLite.get` (65, 66, 80, 88); `SQLite.prepare` (65, 66, 80, 88) | OPERATOR |
<!-- end generated read-gate inventory -->
