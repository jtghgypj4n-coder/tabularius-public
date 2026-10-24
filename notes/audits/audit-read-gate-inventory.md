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
| [packages/cli/src/main.ts:703](../../packages/cli/src/main.ts#L703) `accountsWithPasswordOff` | `SQLite.all` (703); `SQLite.prepare` (703) | OPERATOR |
| [packages/cli/src/main.ts:732](../../packages/cli/src/main.ts#L732) `hostedRead` | `SQLite.all` (732, 735); `SQLite.prepare` (732, 735); `Store.sql` (732, 735) | OPERATOR |
| [packages/cli/src/main.ts:2391](../../packages/cli/src/main.ts#L2391) `main` | `Store.orphanContainerReport` (2391); `Store.auditLog` (2864); `SQLite.get` (3080); `SQLite.prepare` (3080) | OPERATOR |
| [packages/scripts/src/data-api-step.ts:104](../../packages/scripts/src/data-api-step.ts#L104) `respond` | `Store.get` (104, 131, 140); `Store.find` (105, 117) | SCRIPT |
| [packages/scripts/src/engine.ts:7948](../../packages/scripts/src/engine.ts#L7948) `ScriptEngine/containerFile` | `Store.get` (7948); `Store.containerId` (7949); `Store.container` (7950) | SCRIPT |
| [packages/scripts/src/engine.ts:5566](../../packages/scripts/src/engine.ts#L5566) `ScriptEngine/design` | `Store.valueListItems` (5566) | SCRIPT |
| [packages/scripts/src/engine.ts:6304](../../packages/scripts/src/engine.ts#L6304) `ScriptEngine/exportField` | `Store.get` (6304); `Store.containerId` (6305); `Store.container` (6307) | SCRIPT |
| [packages/scripts/src/engine.ts:8341](../../packages/scripts/src/engine.ts#L8341) `ScriptEngine/fileMakerRows` | `Store.findIds` (8341); `Store.get` (8346) | SCRIPT |
| [packages/scripts/src/engine.ts:8711](../../packages/scripts/src/engine.ts#L8711) `ScriptEngine/findRelated` | `Store.findIds` (8711, 8721, 8724) | SCRIPT |
| [packages/scripts/src/engine.ts:2286](../../packages/scripts/src/engine.ts#L2286) `ScriptEngine/foundSet` | `Store.findIds` (2286) | SCRIPT |
| [packages/scripts/src/engine.ts:5408](../../packages/scripts/src/engine.ts#L5408) `ScriptEngine/get` | `Store.findIds` (5408); `Store.canViewRecord` (5499); `Store.get` (5535) | SCRIPT |
| [packages/scripts/src/engine.ts:1942](../../packages/scripts/src/engine.ts#L1942) `ScriptEngine/goToLayout` | `Store.findIds` (1942) | SCRIPT |
| [packages/scripts/src/engine.ts:6875](../../packages/scripts/src/engine.ts#L6875) `ScriptEngine/goToList` | `Store.findIds` (6875) | SCRIPT |
| [packages/scripts/src/engine.ts:8110](../../packages/scripts/src/engine.ts#L8110) `ScriptEngine/importRecords` | `Store.findIds` (8110); `Store.get` (8130) | SCRIPT |
| [packages/scripts/src/engine.ts:5678](../../packages/scripts/src/engine.ts#L5678) `ScriptEngine/lookupNext` | `Store.get` (5678); `Store.row` (5679); `Calculations.context` (5681) | SCRIPT |
| [packages/scripts/src/engine.ts:5246](../../packages/scripts/src/engine.ts#L5246) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5246) | SCRIPT |
| [packages/scripts/src/engine.ts:5254](../../packages/scripts/src/engine.ts#L5254) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5254) | SCRIPT |
| [packages/scripts/src/engine.ts:5255](../../packages/scripts/src/engine.ts#L5255) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5255) | SCRIPT |
| [packages/scripts/src/engine.ts:8381](../../packages/scripts/src/engine.ts#L8381) `ScriptEngine/newRecord` | `Store.findIds` (8381) | SCRIPT |
| [packages/scripts/src/engine.ts:8686](../../packages/scripts/src/engine.ts#L8686) `ScriptEngine/performFind` | `Store.findIds` (8686) | SCRIPT |
| [packages/scripts/src/engine.ts:8743](../../packages/scripts/src/engine.ts#L8743) `ScriptEngine/quickFind` | `Store.findIds` (8743, 8744, 8747) | SCRIPT |
| [packages/scripts/src/engine.ts:5620](../../packages/scripts/src/engine.ts#L5620) `ScriptEngine/record` | `Store.get` (5620) | SCRIPT |
| [packages/scripts/src/engine.ts:5781](../../packages/scripts/src/engine.ts#L5781) `ScriptEngine/relatedIds` | `Store.findIds` (5781); `rowsById` (5789); `Store.select` (5793); `Store.matchIds` (5807); `Store.viewableIds` (5830) | SCRIPT |
| [packages/scripts/src/engine.ts:5815](../../packages/scripts/src/engine.ts#L5815) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5815) | SCRIPT |
| [packages/scripts/src/engine.ts:6455](../../packages/scripts/src/engine.ts#L6455) `ScriptEngine/relookup` | `Store.get` (6455) | SCRIPT |
| [packages/scripts/src/engine.ts:3421](../../packages/scripts/src/engine.ts#L3421) `ScriptEngine/revertTransaction` | `Store.findIds` (3421) | SCRIPT |
| [packages/scripts/src/engine.ts:2351](../../packages/scripts/src/engine.ts#L2351) `ScriptEngine/semanticFind` | `Store.findIds` (2351, 2372) | SCRIPT |
| [packages/scripts/src/engine.ts:3324](../../packages/scripts/src/engine.ts#L3324) `ScriptEngine/sortIds` | `Store.sortIds` (3324); `Store.valueListItems` (3330) | SCRIPT |
| [packages/scripts/src/engine.ts:7204](../../packages/scripts/src/engine.ts#L7204) `ScriptEngine/sourceValue` | `Store.get` (7204); `Store.containerId` (7205); `Store.container` (7206) | SCRIPT |
| [packages/scripts/src/engine.ts:3267](../../packages/scripts/src/engine.ts#L3267) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3267); `Calculations.executeSQL` (3274) | SCRIPT |
| [packages/scripts/src/engine.ts:3981](../../packages/scripts/src/engine.ts#L3981) `ScriptEngine/step` | `Store.fieldIndex` (3981); `Store.findIds` (4115, 4214) | SCRIPT |
| [packages/scripts/src/engine.ts:5653](../../packages/scripts/src/engine.ts#L5653) `ScriptEngine/valueOf` | `Store.findIds` (5653, 5653); `Store.containerId` (5661) | SCRIPT |
| [packages/scripts/src/engine.ts:9131](../../packages/scripts/src/engine.ts#L9131) `clearRecords` | `SQLite.all` (9131); `SQLite.prepare` (9131) | SCRIPT |
| [packages/scripts/src/recorder.ts:83](../../packages/scripts/src/recorder.ts#L83) `lastSeq` | `Store.auditLog` (83) | DESIGN |
| [packages/scripts/src/recorder.ts:121](../../packages/scripts/src/recorder.ts#L121) `recordRun` | `Store.auditLog` (121) | DESIGN |
| [packages/scripts/src/script-tests.ts:213](../../packages/scripts/src/script-tests.ts#L213) `runCase` | `Store.findIds` (213); `Store.auditLog` (220, 221, 265); `Store.evaluateEach` (248) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/server/src/admin.ts:2272](../../packages/server/src/admin.ts#L2272) `Admin/audit` | `Store.auditLog` (2272) | ADMIN |
| [packages/server/src/admin.ts:1040](../../packages/server/src/admin.ts#L1040) `Admin/handle` | `Store.externalContainerReport` (1040); `Store.orphanContainerReport` (1045, 1049) | ADMIN |
| [packages/server/src/admin.ts:2703](../../packages/server/src/admin.ts#L2703) `Admin/status` | `Store.externalContainerCount` (2703) | ADMIN |
| [packages/server/src/admin.ts:2355](../../packages/server/src/admin.ts#L2355) `Admin/viewAs` | `Store.find` (2355) | ADMIN |
| [packages/server/src/agent.ts:307](../../packages/server/src/agent.ts#L307) `dryRunPlan` | `Store.findIds` (307) | DESIGN |
| [packages/server/src/agent.ts:330](../../packages/server/src/agent.ts#L330) `runApprovedStep` | `Store.findIds` (330) | DESIGN |
| [packages/server/src/agent.ts:162](../../packages/server/src/agent.ts#L162) `runStep` | `Store.findIds` (162); `Store.auditLog` (221); `Store.canViewRecord` (233) | DESIGN |
| [packages/server/src/agent.ts:154](../../packages/server/src/agent.ts#L154) `runStep/visible` | `Store.findIds` (154) | DESIGN |
| [packages/server/src/ai-output.ts:147](../../packages/server/src/ai-output.ts#L147) `storedSecretValues` | `Calculations.globalValue` (147); `Store.select` (152) | REDACTION |
| [packages/server/src/ai-policy-sql.ts:49](../../packages/server/src/ai-policy-sql.ts#L49) `sqlFieldRefs` | `SQLite.all` (49, 51); `SQLite.prepare` (49, 51) | POLICY |
| [packages/server/src/ai-policy.ts:338](../../packages/server/src/ai-policy.ts#L338) `sql` | `Store.inspectQuery` (338) | POLICY |
| [packages/server/src/ai-usage.ts:184](../../packages/server/src/ai-usage.ts#L184) `AiUsage/add` | `SQLite.prepare` (184, 187) | AUTH |
| [packages/server/src/ai-usage.ts:224](../../packages/server/src/ai-usage.ts#L224) `AiUsage/importOld` | `SQLite.prepare` (224, 234, 242, 246) | AUTH |
| [packages/server/src/ai-usage.ts:169](../../packages/server/src/ai-usage.ts#L169) `AiUsage/month` | `SQLite.get` (169); `SQLite.prepare` (169) | AUTH |
| [packages/server/src/ai-usage.ts:195](../../packages/server/src/ai-usage.ts#L195) `AiUsage/question` | `SQLite.prepare` (195, 197, 198, 200) | AUTH |
| [packages/server/src/ai-usage.ts:176](../../packages/server/src/ai-usage.ts#L176) `AiUsage/recent` | `SQLite.all` (176); `SQLite.prepare` (176) | AUTH |
| [packages/server/src/ai-usage.ts:162](../../packages/server/src/ai-usage.ts#L162) `AiUsage/today` | `SQLite.get` (162); `SQLite.prepare` (162) | AUTH |
| [packages/server/src/assistant.ts:2146](../../packages/server/src/assistant.ts#L2146) `Assistant/answer` | `Store.find` (2146) | ACCOUNT |
| [packages/server/src/automations.ts:423](../../packages/server/src/automations.ts#L423) `AutomationRunner/changed` | `Store.auditLog` (423) | AUTOMATION |
| [packages/server/src/automations.ts:452](../../packages/server/src/automations.ts#L452) `AutomationRunner/run` | `Store.select` (452); `Store.canViewRecord` (462); `Store.evaluateEach` (465); `Store.evaluate` (471) | AUTOMATION |
| [packages/server/src/automations.ts:498](../../packages/server/src/automations.ts#L498) `AutomationRunner/runDeleted` | `Store.auditLog` (498) | AUTOMATION |
| [packages/server/src/automations.ts:193](../../packages/server/src/automations.ts#L193) `Saved/delete` | `SQLite.prepare` (193, 195); `Store.sql` (193, 195) | AUTOMATION |
| [packages/server/src/automations.ts:177](../../packages/server/src/automations.ts#L177) `Saved/list` | `SQLite.all` (177); `SQLite.prepare` (177); `Store.sql` (177) | AUTOMATION |
| [packages/server/src/automations.ts:200](../../packages/server/src/automations.ts#L200) `Saved/logRun` | `SQLite.prepare` (200, 202); `Store.sql` (200, 202) | AUTOMATION |
| [packages/server/src/automations.ts:207](../../packages/server/src/automations.ts#L207) `Saved/runs` | `SQLite.all` (207); `SQLite.prepare` (207); `Store.sql` (207) | AUTOMATION |
| [packages/server/src/automations.ts:187](../../packages/server/src/automations.ts#L187) `Saved/save` | `SQLite.prepare` (187); `Store.sql` (187) | AUTOMATION |
| [packages/server/src/automations.ts:166](../../packages/server/src/automations.ts#L166) `Saved/table` | `Store.sql` (166, 167) | AUTOMATION |
| [packages/server/src/automations.ts:296](../../packages/server/src/automations.ts#L296) `dryRunAutomation` | `Store.canViewRecord` (296); `Store.findIds` (296); `Store.auditLog` (312, 340, 348); `Store.select` (325); `Store.evaluate` (341) | AUTOMATION |
| [packages/server/src/automations.ts:295](../../packages/server/src/automations.ts#L295) `dryRunAutomation/truth` | `Store.evaluateEach` (295) | AUTOMATION |
| [packages/server/src/backup-verify.ts:188](../../packages/server/src/backup-verify.ts#L188) `integrity` | `SQLite.all` (188); `SQLite.prepare` (188, 192); `SQLite.get` (192) | OPERATOR |
| [packages/server/src/backup-verify.ts:218](../../packages/server/src/backup-verify.ts#L218) `pageCheck` | `SQLite.all` (218); `SQLite.prepare` (218, 221); `SQLite.get` (221) | OPERATOR |
| [packages/server/src/backup-verify.ts:148](../../packages/server/src/backup-verify.ts#L148) `testRestore` | `Store.recordCount` (148) | OPERATOR |
| [packages/server/src/backup.ts:998](../../packages/server/src/backup.ts#L998) `accountDifferences/read` | `SQLite.all` (998, 1000); `SQLite.prepare` (998, 1000) | OPERATOR |
| [packages/server/src/backup.ts:269](../../packages/server/src/backup.ts#L269) `backupOnceHeld` | `SQLite.get` (269); `SQLite.prepare` (269) | OPERATOR |
| [packages/server/src/backup.ts:1071](../../packages/server/src/backup.ts#L1071) `columnInfo` | `SQLite.all` (1071); `SQLite.prepare` (1071) | OPERATOR |
| [packages/server/src/backup.ts:1055](../../packages/server/src/backup.ts#L1055) `credentialsReadable` | `SQLite.all` (1055); `SQLite.prepare` (1055) | OPERATOR |
| [packages/server/src/backup.ts:1025](../../packages/server/src/backup.ts#L1025) `readNames` | `SQLite.all` (1025); `SQLite.prepare` (1025) | OPERATOR |
| [packages/server/src/backup.ts:1106](../../packages/server/src/backup.ts#L1106) `reconcileCredentials` | `SQLite.all` (1106, 1128, 1143, 1153, 1159); `SQLite.prepare` (1106, 1114, 1128, 1130, 1143, 1144, 1151, 1153, 1154, 1159, 1160, 1164, 1165, 1166); `SQLite.get` (1114, 1164) | OPERATOR |
| [packages/server/src/backup.ts:1133](../../packages/server/src/backup.ts#L1133) `reconcileCredentials/accountColumns` | `SQLite.all` (1133); `SQLite.prepare` (1133) | OPERATOR |
| [packages/server/src/backup.ts:1109](../../packages/server/src/backup.ts#L1109) `reconcileCredentials/has` | `SQLite.all` (1109); `SQLite.prepare` (1109) | OPERATOR |
| [packages/server/src/backup.ts:1278](../../packages/server/src/backup.ts#L1278) `stageRestorePoint` | `SQLite.get` (1278, 1280, 1281); `SQLite.prepare` (1278, 1280, 1281) | OPERATOR |
| [packages/server/src/calendar.ts:389](../../packages/server/src/calendar.ts#L389) `CalendarFeeds/feed` | `Store.find` (389) | CALENDAR |
| [packages/server/src/changes.ts:195](../../packages/server/src/changes.ts#L195) `ChangeFeed/visible` | `Store.canViewRecord` (195) | CHANGE |
| [packages/server/src/cleanup.ts:1045](../../packages/server/src/cleanup.ts#L1045) `CleanupJournal/add` | `SQLite.prepare` (1045); `Store.sql` (1045) | CLEANUP |
| [packages/server/src/cleanup.ts:1040](../../packages/server/src/cleanup.ts#L1040) `CleanupJournal/append` | `SQLite.prepare` (1040); `Store.sql` (1040) | CLEANUP |
| [packages/server/src/cleanup.ts:1031](../../packages/server/src/cleanup.ts#L1031) `CleanupJournal/constructor` | `Store.sql` (1031) | CLEANUP |
| [packages/server/src/cleanup.ts:1051](../../packages/server/src/cleanup.ts#L1051) `CleanupJournal/get` | `SQLite.get` (1051); `SQLite.prepare` (1051); `Store.sql` (1051) | CLEANUP |
| [packages/server/src/cleanup.ts:1056](../../packages/server/src/cleanup.ts#L1056) `CleanupJournal/list` | `SQLite.all` (1056); `SQLite.prepare` (1056); `Store.sql` (1056) | CLEANUP |
| [packages/server/src/cleanup.ts:1060](../../packages/server/src/cleanup.ts#L1060) `CleanupJournal/markUndone` | `SQLite.prepare` (1060); `Store.sql` (1060) | CLEANUP |
| [packages/server/src/cleanup.ts:741](../../packages/server/src/cleanup.ts#L741) `applyCleanup/apply` | `Store.findIds` (741, 751); `SQLite.all` (742); `SQLite.prepare` (742, 779); `Store.sql` (742, 779); `SQLite.get` (779) | CLEANUP |
| [packages/server/src/cleanup.ts:523](../../packages/server/src/cleanup.ts#L523) `findDuplicates` | `Store.findIds` (523) | CLEANUP |
| [packages/server/src/cleanup.ts:879](../../packages/server/src/cleanup.ts#L879) `journalDeletes` | `SQLite.get` (879); `SQLite.prepare` (879); `Store.sql` (879) | CLEANUP |
| [packages/server/src/cleanup.ts:617](../../packages/server/src/cleanup.ts#L617) `keyValue` | `SQLite.get` (617); `SQLite.prepare` (617); `Store.sql` (617) | CLEANUP |
| [packages/server/src/cleanup.ts:621](../../packages/server/src/cleanup.ts#L621) `relatedIds` | `SQLite.all` (621); `SQLite.prepare` (621); `Store.sql` (621) | CLEANUP |
| [packages/server/src/cleanup.ts:327](../../packages/server/src/cleanup.ts#L327) `scanData` | `Store.findIds` (327); `Store.select` (333) | CLEANUP |
| [packages/server/src/cleanup.ts:810](../../packages/server/src/cleanup.ts#L810) `snapshotField` | `SQLite.all` (810); `SQLite.prepare` (810); `Store.sql` (810) | CLEANUP |
| [packages/server/src/cleanup.ts:870](../../packages/server/src/cleanup.ts#L870) `snapshotRows` | `SQLite.all` (870); `SQLite.prepare` (870); `Store.sql` (870) | CLEANUP |
| [packages/server/src/cleanup.ts:991](../../packages/server/src/cleanup.ts#L991) `undoCleanup` | `SQLite.get` (991, 1007); `SQLite.prepare` (991, 1007); `Store.sql` (991, 1007) | CLEANUP |
| [packages/server/src/cleanup.ts:929](../../packages/server/src/cleanup.ts#L929) `updateMany` | `Store.findIds` (929) | CLEANUP |
| [packages/server/src/compaction.ts:65](../../packages/server/src/compaction.ts#L65) `compactStore` | `SQLite.get` (65, 66, 80, 88); `SQLite.prepare` (65, 66, 80, 88) | OPERATOR |
| [packages/server/src/compare.ts:206](../../packages/server/src/compare.ts#L206) `count` | `Store.query` (206) | DESIGN |
| [packages/server/src/containers.ts:301](../../packages/server/src/containers.ts#L301) `ContainerFiles/make` | `Store.containerInfo` (301) | CONTAINER |
| [packages/server/src/containers.ts:313](../../packages/server/src/containers.ts#L313) `ContainerFiles/makeAdmitted` | `Store.container` (313) | CONTAINER |
| [packages/server/src/containers.ts:134](../../packages/server/src/containers.ts#L134) `ContainerFiles/send` | `Store.containerInfo` (134); `Store.container` (200); `Store.containerRange` (209) | CONTAINER |
| [packages/server/src/conversion-guide.ts:386](../../packages/server/src/conversion-guide.ts#L386) `ConversionGuides/save` | `SQLite.prepare` (386); `Store.sql` (386) | DESIGN |
| [packages/server/src/conversion-guide.ts:377](../../packages/server/src/conversion-guide.ts#L377) `ConversionGuides/saved` | `SQLite.get` (377); `SQLite.prepare` (377); `Store.sql` (377) | DESIGN |
| [packages/server/src/conversion-guide.ts:367](../../packages/server/src/conversion-guide.ts#L367) `ConversionGuides/table` | `Store.sql` (367) | DESIGN |
| [packages/server/src/conversion-guide.ts:118](../../packages/server/src/conversion-guide.ts#L118) `convertedAt` | `SQLite.get` (118); `SQLite.prepare` (118); `Store.sql` (118) | DESIGN |
| [packages/server/src/conversion.ts:308](../../packages/server/src/conversion.ts#L308) `conversionReport` | `Store.externalContainerCheck` (308) | DESIGN |
| [packages/server/src/cwp-xml.ts:541](../../packages/server/src/cwp-xml.ts#L541) `CwpXmlEndpoint/layoutDoc` | `Store.valueListItems` (541) | XML |
| [packages/server/src/cwp-xml.ts:457](../../packages/server/src/cwp-xml.ts#L457) `CwpXmlEndpoint/records` | `Store.find` (457, 459, 460, 466, 469); `Store.get` (465, 473) | XML |
| [packages/server/src/dashboards.ts:389](../../packages/server/src/dashboards.ts#L389) `Dashboards/create` | `SQLite.prepare` (389); `Store.sql` (389) | DASHBOARD |
| [packages/server/src/dashboards.ts:409](../../packages/server/src/dashboards.ts#L409) `Dashboards/delete` | `SQLite.prepare` (409); `Store.sql` (409) | DASHBOARD |
| [packages/server/src/dashboards.ts:375](../../packages/server/src/dashboards.ts#L375) `Dashboards/get` | `SQLite.get` (375); `SQLite.prepare` (375); `Store.sql` (375) | DASHBOARD |
| [packages/server/src/dashboards.ts:369](../../packages/server/src/dashboards.ts#L369) `Dashboards/list` | `SQLite.all` (369); `SQLite.prepare` (369); `Store.sql` (369) | DASHBOARD |
| [packages/server/src/dashboards.ts:359](../../packages/server/src/dashboards.ts#L359) `Dashboards/table` | `Store.sql` (359) | DASHBOARD |
| [packages/server/src/dashboards.ts:402](../../packages/server/src/dashboards.ts#L402) `Dashboards/update` | `SQLite.prepare` (402); `Store.sql` (402) | DASHBOARD |
| [packages/server/src/dataapi.ts:1954](../../packages/server/src/dataapi.ts#L1954) `DataApi/route` | `Store.get` (1954, 2176, 2199, 2207, 2254, 2278, 2298, 2335); `Store.valueListItems` (1969); `Store.find` (2131, 2178, 2368); `Store.findIds` (2135, 2373); `Store.query` (2373) | REST |
| [packages/server/src/dataapi.ts:2083](../../packages/server/src/dataapi.ts#L2083) `DataApi/route/recordOut` | `Store.portalCounts` (2083) | REST |
| [packages/server/src/dataapi.ts:2119](../../packages/server/src/dataapi.ts#L2119) `DataApi/route/shownAs` | `Store.get` (2119) | REST |
| [packages/server/src/debug.ts:344](../../packages/server/src/debug.ts#L344) `DebugApi/handle` | `Store.row` (344, 473); `Store.get` (353, 478); `Store.evaluate` (377) | DESIGN |
| [packages/server/src/debug.ts:193](../../packages/server/src/debug.ts#L193) `learnStoredCredentials` | `Calculations.globalValue` (193); `Store.sql` (199, 209, 209); `SQLite.iterate` (209, 209); `SQLite.prepare` (209, 209); `Store.iterateCommitted` (209) | DESIGN |
| [packages/server/src/design.ts:730](../../packages/server/src/design.ts#L730) `DesignApi/handle` | `Store.auditLog` (730); `Store.evaluate` (797) | DESIGN |
| [packages/server/src/design.ts:233](../../packages/server/src/design.ts#L233) `containerData` | `Store.query` (233) | DESIGN |
| [packages/server/src/design.ts:242](../../packages/server/src/design.ts#L242) `recordCount` | `Store.query` (242) | DESIGN |
| [packages/server/src/digests.ts:227](../../packages/server/src/digests.ts#L227) `Digests/addRun` | `SQLite.prepare` (227, 228); `Store.sql` (227, 228) | DIGEST |
| [packages/server/src/digests.ts:204](../../packages/server/src/digests.ts#L204) `Digests/create` | `SQLite.prepare` (204); `Store.sql` (204) | DIGEST |
| [packages/server/src/digests.ts:221](../../packages/server/src/digests.ts#L221) `Digests/delete` | `SQLite.prepare` (221, 222); `Store.sql` (221, 222) | DIGEST |
| [packages/server/src/digests.ts:185](../../packages/server/src/digests.ts#L185) `Digests/get` | `SQLite.get` (185); `SQLite.prepare` (185); `Store.sql` (185) | DIGEST |
| [packages/server/src/digests.ts:192](../../packages/server/src/digests.ts#L192) `Digests/lastSlot` | `SQLite.get` (192); `SQLite.prepare` (192); `Store.sql` (192) | DIGEST |
| [packages/server/src/digests.ts:179](../../packages/server/src/digests.ts#L179) `Digests/list` | `SQLite.all` (179); `SQLite.prepare` (179); `Store.sql` (179) | DIGEST |
| [packages/server/src/digests.ts:196](../../packages/server/src/digests.ts#L196) `Digests/markSlot` | `SQLite.prepare` (196); `Store.sql` (196) | DIGEST |
| [packages/server/src/digests.ts:234](../../packages/server/src/digests.ts#L234) `Digests/runs` | `SQLite.all` (234); `SQLite.prepare` (234); `Store.sql` (234) | DIGEST |
| [packages/server/src/digests.ts:168](../../packages/server/src/digests.ts#L168) `Digests/table` | `Store.sql` (168) | DIGEST |
| [packages/server/src/digests.ts:213](../../packages/server/src/digests.ts#L213) `Digests/update` | `SQLite.prepare` (213); `Store.sql` (213) | DIGEST |
| [packages/server/src/docs.ts:155](../../packages/server/src/docs.ts#L155) `count` | `Store.query` (155) | DESIGN |
| [packages/server/src/dry-run.ts:92](../../packages/server/src/dry-run.ts#L92) `dryRunChanges/runOnce` | `Store.auditLog` (92, 96) | DESIGN |
| [packages/server/src/find-advice.ts:99](../../packages/server/src/find-advice.ts#L99) `findAdvice` | `Store.recordCount` (99) | DESIGN |
| [packages/server/src/formula-preview.ts:31](../../packages/server/src/formula-preview.ts#L31) `previewFormula` | `Store.findIds` (31); `Store.evaluate` (42) | DESIGN |
| [packages/server/src/import-mapping.ts:984](../../packages/server/src/import-mapping.ts#L984) `applyImportAddStream` | `SQLite.prepare` (984); `Store.sql` (984) | IMPORT |
| [packages/server/src/import-mapping.ts:762](../../packages/server/src/import-mapping.ts#L762) `applyImportRun` | `SQLite.prepare` (762); `Store.sql` (762) | IMPORT |
| [packages/server/src/import-mapping.ts:500](../../packages/server/src/import-mapping.ts#L500) `existingKeys` | `Store.viewableIds` (500); `Store.query` (502) | IMPORT |
| [packages/server/src/import-mapping.ts:805](../../packages/server/src/import-mapping.ts#L805) `fileIdentity` | `Store.sql` (805, 806, 807); `SQLite.prepare` (806, 807); `SQLite.get` (807) | IMPORT |
| [packages/server/src/import-mapping.ts:863](../../packages/server/src/import-mapping.ts#L863) `importHistory` | `SQLite.all` (863); `SQLite.prepare` (863); `Store.sql` (863) | IMPORT |
| [packages/server/src/import-mapping.ts:793](../../packages/server/src/import-mapping.ts#L793) `journal` | `Store.sql` (793, 796, 797, 798, 799, 800); `SQLite.all` (796); `SQLite.prepare` (796) | IMPORT |
| [packages/server/src/import-mapping.ts:781](../../packages/server/src/import-mapping.ts#L781) `targetKeys` | `SQLite.all` (781); `SQLite.prepare` (781); `Store.sql` (781) | IMPORT |
| [packages/server/src/import-mapping.ts:870](../../packages/server/src/import-mapping.ts#L870) `undoImportRun` | `SQLite.get` (870, 902); `SQLite.prepare` (870, 902, 916); `Store.sql` (870, 902, 916) | IMPORT |
| [packages/server/src/insight.ts:968](../../packages/server/src/insight.ts#L968) `checkCalculation` | `Store.findIds` (968); `Store.evaluate` (972) | DESIGN |
| [packages/server/src/insight.ts:889](../../packages/server/src/insight.ts#L889) `columnProfile` | `Store.query` (889, 896, 908, 911) | PROFILE |
| [packages/server/src/insight.ts:813](../../packages/server/src/insight.ts#L813) `layoutProfile` | `Store.query` (813) | PROFILE |
| [packages/server/src/insight.ts:809](../../packages/server/src/insight.ts#L809) `layoutProfile/viewableIds` | `Store.viewableIds` (809) | PROFILE |
| [packages/server/src/insight.ts:1151](../../packages/server/src/insight.ts#L1151) `solutionOverview/counts` | `Store.query` (1151) | DESIGN |
| [packages/server/src/insight.ts:346](../../packages/server/src/insight.ts#L346) `webViewerScripts` | `Store.query` (346) | DESIGN |
| [packages/server/src/live.ts:138](../../packages/server/src/live.ts#L138) `Live/handle` | `Store.canViewRecord` (138, 145); `Store.canView` (190) | LIVE |
| [packages/server/src/live.ts:292](../../packages/server/src/live.ts#L292) `Live/stream/listener` | `Store.canViewRecord` (292, 294) | LIVE |
| [packages/server/src/logs.ts:77](../../packages/server/src/logs.ts#L77) `LogShipper/follow` | `SQLite.get` (77); `SQLite.prepare` (77); `Store.sql` (77, 78, 79, 80) | ADMIN |
| [packages/server/src/logs.ts:89](../../packages/server/src/logs.ts#L89) `LogShipper/releaseIfIdle` | `Store.sql` (89) | ADMIN |
| [packages/server/src/mcp-design.ts:510](../../packages/server/src/mcp-design.ts#L510) `registerDesignTools/audit_log` | `Store.auditLog` (510) | DESIGN |
| [packages/server/src/mcp.ts:1368](../../packages/server/src/mcp.ts#L1368) `createMcpServer/check_record` | `Store.get` (1368); `Store.row` (1370) | MCP |
| [packages/server/src/mcp.ts:1089](../../packages/server/src/mcp.ts#L1089) `createMcpServer/evaluate_calculation` | `Store.get` (1089, 1097); `Store.find` (1090); `Store.evaluate` (1091); `Store.row` (1096) | SQL |
| [packages/server/src/mcp.ts:1392](../../packages/server/src/mcp.ts#L1392) `createMcpServer/explain_related` | `Store.get` (1392) | MCP |
| [packages/server/src/mcp.ts:1345](../../packages/server/src/mcp.ts#L1345) `createMcpServer/explain_value` | `Store.get` (1345); `Store.row` (1346) | MCP |
| [packages/server/src/mcp.ts:969](../../packages/server/src/mcp.ts#L969) `createMcpServer/find_records` | `Store.find` (969) | MCP |
| [packages/server/src/mcp.ts:1164](../../packages/server/src/mcp.ts#L1164) `createMcpServer/get_container` | `Store.container` (1164) | SQL |
| [packages/server/src/mcp.ts:982](../../packages/server/src/mcp.ts#L982) `createMcpServer/get_record` | `Store.get` (982) | MCP |
| [packages/server/src/mcp.ts:1188](../../packages/server/src/mcp.ts#L1188) `createMcpServer/sql_query` | `Store.queryWithOrigins` (1188) | SQL |
| [packages/server/src/mcp.ts:1032](../../packages/server/src/mcp.ts#L1032) `createMcpServer/update_record` | `Store.get` (1032, 1036) | MCP |
| [packages/server/src/mcp.ts:2288](../../packages/server/src/mcp.ts#L2288) `registerResources/audit` | `Store.auditLog` (2288) | MCP |
| [packages/server/src/oauth.ts:878](../../packages/server/src/oauth.ts#L878) `OAuthServer/accessAllowed` | `SQLite.get` (878); `SQLite.prepare` (878) | AUTH |
| [packages/server/src/oauth.ts:504](../../packages/server/src/oauth.ts#L504) `OAuthServer/authorize` | `SQLite.get` (504); `SQLite.prepare` (504, 508, 510, 517, 540, 541) | AUTH |
| [packages/server/src/oauth.ts:485](../../packages/server/src/oauth.ts#L485) `OAuthServer/authorize/done` | `SQLite.prepare` (485, 486) | AUTH |
| [packages/server/src/oauth.ts:384](../../packages/server/src/oauth.ts#L384) `OAuthServer/client` | `SQLite.get` (384); `SQLite.prepare` (384) | AUTH |
| [packages/server/src/oauth.ts:191](../../packages/server/src/oauth.ts#L191) `OAuthServer/constructor` | `SQLite.all` (191); `SQLite.prepare` (191, 218, 220, 229, 230, 233); `SQLite.iterate` (218); `SQLite.get` (220); `Store.sql` (220, 229) | AUTH |
| [packages/server/src/oauth.ts:184](../../packages/server/src/oauth.ts#L184) `OAuthServer/constructor/cols` | `SQLite.all` (184); `SQLite.prepare` (184) | AUTH |
| [packages/server/src/oauth.ts:861](../../packages/server/src/oauth.ts#L861) `OAuthServer/endGrant` | `SQLite.prepare` (861, 862); `SQLite.all` (862) | AUTH |
| [packages/server/src/oauth.ts:817](../../packages/server/src/oauth.ts#L817) `OAuthServer/issue/write` | `SQLite.get` (817); `SQLite.prepare` (817, 818, 819) | AUTH |
| [packages/server/src/oauth.ts:874](../../packages/server/src/oauth.ts#L874) `OAuthServer/managedAccess` | `SQLite.get` (874); `SQLite.prepare` (874) | AUTH |
| [packages/server/src/oauth.ts:364](../../packages/server/src/oauth.ts#L364) `OAuthServer/register` | `SQLite.prepare` (364, 365, 366, 367, 368); `SQLite.get` (365, 367) | AUTH |
| [packages/server/src/oauth.ts:891](../../packages/server/src/oauth.ts#L891) `OAuthServer/revoke` | `SQLite.get` (891, 892, 902, 903); `SQLite.prepare` (891, 892, 895, 902, 903, 907) | AUTH |
| [packages/server/src/oauth.ts:837](../../packages/server/src/oauth.ts#L837) `OAuthServer/sweep` | `SQLite.all` (837); `SQLite.prepare` (837, 839, 840, 841, 842) | AUTH |
| [packages/server/src/oauth.ts:696](../../packages/server/src/oauth.ts#L696) `OAuthServer/token` | `SQLite.get` (696, 727, 729, 732, 745); `SQLite.prepare` (696, 727, 729, 732, 741, 744, 745, 745, 747, 749) | AUTH |
| [packages/server/src/oauth.ts:83](../../packages/server/src/oauth.ts#L83) `legacyPasswordMark` | `SQLite.get` (83); `SQLite.prepare` (83); `Store.sql` (83) | AUTH |
| [packages/server/src/oauth.ts:72](../../packages/server/src/oauth.ts#L72) `storedName` | `SQLite.get` (72); `SQLite.prepare` (72); `Store.sql` (72) | AUTH |
| [packages/server/src/odata-crossjoin-worker.ts:40](../../packages/server/src/odata-crossjoin-worker.ts#L40) `join` | `SQLite.prepare` (40, 49, 58, 73); `SQLite.get` (58); `SQLite.all` (73) | JOIN |
| [packages/server/src/odata.ts:1338](../../packages/server/src/odata.ts#L1338) `ODataEndpoint/applied` | `Store.selectIds` (1338); `SQLite.prepare` (1353, 1390, 1403, 1407); `Store.getMany` (1364); `SQLite.all` (1403); `SQLite.get` (1407) | ODATA |
| [packages/server/src/odata.ts:1457](../../packages/server/src/odata.ts#L1457) `ODataEndpoint/crossjoined` | `Store.selectIds` (1457); `Store.getMany` (1486, 1521) | ODATA |
| [packages/server/src/odata.ts:1557](../../packages/server/src/odata.ts#L1557) `ODataEndpoint/entity` | `Store.getMany` (1557) | ODATA |
| [packages/server/src/odata.ts:1217](../../packages/server/src/odata.ts#L1217) `ODataEndpoint/lambdaFor` | `Store.selectIds` (1217); `Store.row` (1226); `relatedIdList` (1227) | ODATA |
| [packages/server/src/odata.ts:1280](../../packages/server/src/odata.ts#L1280) `ODataEndpoint/list` | `Store.selectIds` (1280); `Store.getMany` (1285); `Store.computeValues` (1286); `Store.countIds` (1291) | ODATA |
| [packages/server/src/odata.ts:1648](../../packages/server/src/odata.ts#L1648) `ODataEndpoint/property` | `Store.containerId` (1648); `Store.container` (1654) | ODATA |
| [packages/server/src/odata.ts:1598](../../packages/server/src/odata.ts#L1598) `ODataEndpoint/relatedIds` | `Store.row` (1598); `relatedIdList` (1601, 1616); `Store.selectIds` (1605); `Store.viewableIds` (1615) | ODATA |
| [packages/server/src/odata.ts:1624](../../packages/server/src/odata.ts#L1624) `ODataEndpoint/relatedRecords` | `Store.getMany` (1624) | ODATA |
| [packages/server/src/odata.ts:931](../../packages/server/src/odata.ts#L931) `ODataEndpoint/resource` | `Store.countIds` (931); `Store.get` (971, 978, 1085) | ODATA |
| [packages/server/src/oidc.ts:393](../../packages/server/src/oidc.ts#L393) `Oidc/authorizeUrl` | `SQLite.prepare` (393, 394, 397); `SQLite.get` (394) | AUTH |
| [packages/server/src/oidc.ts:445](../../packages/server/src/oidc.ts#L445) `Oidc/callback` | `SQLite.all` (445); `SQLite.prepare` (445, 449) | AUTH |
| [packages/server/src/oidc.ts:189](../../packages/server/src/oidc.ts#L189) `Oidc/constructor` | `SQLite.all` (189, 197); `SQLite.prepare` (189, 197, 207, 208, 213, 213) | AUTH |
| [packages/server/src/oidc.ts:547](../../packages/server/src/oidc.ts#L547) `Oidc/finish` | `SQLite.prepare` (547, 548, 550); `SQLite.get` (548) | AUTH |
| [packages/server/src/oidc.ts:342](../../packages/server/src/oidc.ts#L342) `Oidc/takeGrant` | `SQLite.all` (342); `SQLite.prepare` (342) | AUTH |
| [packages/server/src/optimization-containers.ts:78](../../packages/server/src/optimization-containers.ts#L78) `planContainerMove` | `Store.embeddedContainerCount` (78) | DESIGN |
| [packages/server/src/optimization-containers.ts:46](../../packages/server/src/optimization-containers.ts#L46) `read` | `SQLite.get` (46); `SQLite.prepare` (46); `Store.sql` (46) | DESIGN |
| [packages/server/src/optimization-containers.ts:147](../../packages/server/src/optimization-containers.ts#L147) `undoContainerMove` | `SQLite.prepare` (147); `Store.sql` (147); `SQLite.get` (148) | DESIGN |
| [packages/server/src/optimization-containers.ts:57](../../packages/server/src/optimization-containers.ts#L57) `write` | `SQLite.prepare` (57); `Store.sql` (57) | DESIGN |
| [packages/server/src/optimization-data.ts:61](../../packages/server/src/optimization-data.ts#L61) `dataFindings` | `Store.recordCount` (61) | DESIGN |
| [packages/server/src/optimization-data.ts:46](../../packages/server/src/optimization-data.ts#L46) `held` | `SQLite.get` (46); `SQLite.prepare` (46); `Store.sql` (46) | DESIGN |
| [packages/server/src/optimization-data.ts:113](../../packages/server/src/optimization-data.ts#L113) `layoutFindings` | `Store.recordCount` (113) | DESIGN |
| [packages/server/src/optimization-fix.ts:150](../../packages/server/src/optimization-fix.ts#L150) `history` | `SQLite.get` (150); `SQLite.prepare` (150); `Store.sql` (150) | DESIGN |
| [packages/server/src/optimization-fix.ts:154](../../packages/server/src/optimization-fix.ts#L154) `keep` | `SQLite.prepare` (154); `Store.sql` (154) | DESIGN |
| [packages/server/src/optimization-fix.ts:158](../../packages/server/src/optimization-fix.ts#L158) `withHistory` | `Store.sql` (158, 161, 164, 164) | DESIGN |
| [packages/server/src/optimization.ts:141](../../packages/server/src/optimization.ts#L141) `containerUse` | `SQLite.get` (141); `SQLite.prepare` (141); `Store.sql` (141) | DESIGN |
| [packages/server/src/optimization.ts:120](../../packages/server/src/optimization.ts#L120) `hasTable` | `SQLite.get` (120); `SQLite.prepare` (120); `Store.sql` (120) | DESIGN |
| [packages/server/src/optimization.ts:564](../../packages/server/src/optimization.ts#L564) `heldBytes` | `SQLite.get` (564); `SQLite.prepare` (564); `Store.sql` (564) | DESIGN |
| [packages/server/src/optimization.ts:269](../../packages/server/src/optimization.ts#L269) `oversizedPictures` | `SQLite.all` (269); `SQLite.prepare` (269); `Store.sql` (269) | DESIGN |
| [packages/server/src/optimization.ts:316](../../packages/server/src/optimization.ts#L316) `sizes` | `SQLite.all` (316); `SQLite.prepare` (316); `Store.sql` (316) | DESIGN |
| [packages/server/src/optimization.ts:312](../../packages/server/src/optimization.ts#L312) `sizes/one` | `SQLite.get` (312); `SQLite.prepare` (312); `Store.sql` (312) | DESIGN |
| [packages/server/src/optimization.ts:449](../../packages/server/src/optimization.ts#L449) `speedFindings` | `Store.recordCount` (449, 492, 510) | DESIGN |
| [packages/server/src/pgwire.ts:837](../../packages/server/src/pgwire.ts#L837) `Connection/bareNames` | `Store.describe` (837) | SQL |
| [packages/server/src/pgwire.ts:851](../../packages/server/src/pgwire.ts#L851) `Connection/catalog` | `Store.describeTyped` (851) | SQL |
| [packages/server/src/pgwire.ts:1223](../../packages/server/src/pgwire.ts#L1223) `Connection/describe` | `Store.describeTyped` (1223) | SQL |
| [packages/server/src/pgwire.ts:862](../../packages/server/src/pgwire.ts#L862) `Connection/run` | `Store.selectIn` (862); `Store.describeTyped` (866) | SQL |
| [packages/server/src/pgwire.ts:814](../../packages/server/src/pgwire.ts#L814) `Connection/translate` | `Calculations.translateSQL` (814) | SQL |
| [packages/server/src/pgwire.ts:990](../../packages/server/src/pgwire.ts#L990) `Connection/validateSyntax` | `SQLite.prepare` (990); `Store.sql` (990) | SQL |
| [packages/server/src/pgwrite.ts:431](../../packages/server/src/pgwrite.ts#L431) `executeWrite/reader` | `Store.selectIn` (431) | SQL |
| [packages/server/src/pgwrite.ts:404](../../packages/server/src/pgwrite.ts#L404) `returningColumns` | `Store.describe` (404) | SQL |
| [packages/server/src/pii.ts:349](../../packages/server/src/pii.ts#L349) `PiiMasker/constructor` | `SQLite.get` (349); `SQLite.prepare` (349); `Store.sql` (349) | REDACTION |
| [packages/server/src/pii.ts:445](../../packages/server/src/pii.ts#L445) `PiiMasker/known` | `SQLite.iterate` (445); `SQLite.prepare` (445); `Store.sql` (445) | REDACTION |
| [packages/server/src/pii.ts:359](../../packages/server/src/pii.ts#L359) `PiiMasker/refresh` | `SQLite.iterate` (359); `SQLite.prepare` (359); `Store.sql` (359) | REDACTION |
| [packages/server/src/pii.ts:417](../../packages/server/src/pii.ts#L417) `PiiMasker/text` | `SQLite.get` (417); `SQLite.prepare` (417); `Store.sql` (417) | REDACTION |
| [packages/server/src/pii.ts:402](../../packages/server/src/pii.ts#L402) `PiiMasker/token` | `SQLite.prepare` (402, 403); `Store.sql` (402, 403); `SQLite.get` (403) | REDACTION |
| [packages/server/src/pii.ts:486](../../packages/server/src/pii.ts#L486) `PiiMasker/unmask` | `SQLite.get` (486); `SQLite.prepare` (486); `Store.sql` (486) | REDACTION |
| [packages/server/src/pii.ts:310](../../packages/server/src/pii.ts#L310) `forgetVault` | `Store.sql` (310) | REDACTION |
| [packages/server/src/pii.ts:122](../../packages/server/src/pii.ts#L122) `holdsOnlyUuids` | `Store.query` (122) | REDACTION |
| [packages/server/src/pii.ts:655](../../packages/server/src/pii.ts#L655) `piiPreview` | `Store.find` (655); `SQLite.prepare` (662); `Store.sql` (662) | REDACTION |
| [packages/server/src/pii.ts:134](../../packages/server/src/pii.ts#L134) `sampledValues` | `Store.query` (134) | REDACTION |
| [packages/server/src/pii.ts:301](../../packages/server/src/pii.ts#L301) `vaultTable` | `Store.sql` (301, 304) | REDACTION |
| [packages/server/src/privilege-review.ts:274](../../packages/server/src/privilege-review.ts#L274) `reviewPrivileges` | `Store.previewRecordRule` (274) | DESIGN |
| [packages/server/src/rag.ts:79](../../packages/server/src/rag.ts#L79) `RagStore/add` | `SQLite.prepare` (79, 86, 88, 89); `SQLite.get` (86) | RAG |
| [packages/server/src/rag.ts:138](../../packages/server/src/rag.ts#L138) `RagStore/hybridSearch` | `SQLite.prepare` (138, 143) | RAG |
| [packages/server/src/rag.ts:148](../../packages/server/src/rag.ts#L148) `RagStore/hybridSearch/candidates` | `SQLite.all` (148); `SQLite.iterate` (150) | RAG |
| [packages/server/src/rag.ts:61](../../packages/server/src/rag.ts#L61) `RagStore/info` | `SQLite.all` (61, 66); `SQLite.prepare` (61, 63) | RAG |
| [packages/server/src/rag.ts:224](../../packages/server/src/rag.ts#L224) `RagStore/load` | `SQLite.get` (224); `SQLite.prepare` (224, 231); `SQLite.iterate` (231) | RAG |
| [packages/server/src/rag.ts:276](../../packages/server/src/rag.ts#L276) `RagStore/remove` | `SQLite.prepare` (276, 278) | RAG |
| [packages/server/src/rag.ts:270](../../packages/server/src/rag.ts#L270) `RagStore/searchCached` | `SQLite.prepare` (270); `SQLite.get` (271) | RAG |
| [packages/server/src/rag.ts:186](../../packages/server/src/rag.ts#L186) `RagStore/searchSpace` | `SQLite.iterate` (186); `SQLite.prepare` (186) | RAG |
| [packages/server/src/rag.ts:105](../../packages/server/src/rag.ts#L105) `RagStore/sizes` | `SQLite.all` (105); `SQLite.prepare` (105) | RAG |
| [packages/server/src/rag.ts:56](../../packages/server/src/rag.ts#L56) `RagStore/spaces` | `SQLite.all` (56); `SQLite.prepare` (56) | RAG |
| [packages/server/src/rag.ts:208](../../packages/server/src/rag.ts#L208) `RagStore/version` | `SQLite.get` (208); `SQLite.prepare` (208) | RAG |
| [packages/server/src/record-context.ts:112](../../packages/server/src/record-context.ts#L112) `describeRecord` | `Store.row` (112); `Store.get` (121); `keyValue` (127); `Store.viewableIds` (154); `relatedRows` (158, 163) | RECORD |
| [packages/server/src/record-history.ts:99](../../packages/server/src/record-history.ts#L99) `recordHistory` | `Store.auditLog` (99, 152) | HISTORY |
| [packages/server/src/record-search.ts:61](../../packages/server/src/record-search.ts#L61) `searchRecords` | `Store.viewableIds` (61); `SQLite.all` (74); `SQLite.prepare` (74); `Store.sql` (74) | SEARCH |
| [packages/server/src/record-search.ts:104](../../packages/server/src/record-search.ts#L104) `searchRecords/snippet` | `SQLite.get` (104); `SQLite.prepare` (104); `Store.sql` (104) | SEARCH |
| [packages/server/src/record-search.ts:109](../../packages/server/src/record-search.ts#L109) `searchRecords/source` | `SQLite.get` (109); `SQLite.prepare` (109); `Store.sql` (109) | SEARCH |
| [packages/server/src/rule-suggestions.ts:57](../../packages/server/src/rule-suggestions.ts#L57) `suggestRules` | `Store.query` (57, 69, 86, 136, 138, 152, 153, 169) | DESIGN |
| [packages/server/src/scim.ts:283](../../packages/server/src/scim.ts#L283) `ScimDirectory/atomically` | `Store.sql` (283) | AUTH |
| [packages/server/src/scim.ts:374](../../packages/server/src/scim.ts#L374) `ScimDirectory/create/scim_user_create` | `SQLite.prepare` (374); `Store.sql` (374) | AUTH |
| [packages/server/src/scim.ts:418](../../packages/server/src/scim.ts#L418) `ScimDirectory/remove/scim_user_remove` | `SQLite.prepare` (418); `Store.sql` (418) | AUTH |
| [packages/server/src/scim.ts:323](../../packages/server/src/scim.ts#L323) `ScimDirectory/revokePersonTokens` | `SQLite.all` (323); `SQLite.prepare` (323); `Store.sql` (323) | AUTH |
| [packages/server/src/scim.ts:219](../../packages/server/src/scim.ts#L219) `ScimDirectory/rows` | `SQLite.all` (219); `SQLite.prepare` (219, 222); `Store.sql` (219, 222) | AUTH |
| [packages/server/src/scim.ts:137](../../packages/server/src/scim.ts#L137) `ScimDirectory/save` | `SQLite.prepare` (137); `Store.sql` (137) | AUTH |
| [packages/server/src/scim.ts:246](../../packages/server/src/scim.ts#L246) `ScimDirectory/setMemberships` | `SQLite.prepare` (246); `Store.sql` (246) | AUTH |
| [packages/server/src/scim.ts:129](../../packages/server/src/scim.ts#L129) `ScimDirectory/settings` | `SQLite.get` (129); `SQLite.prepare` (129); `Store.sql` (129) | AUTH |
| [packages/server/src/scim.ts:123](../../packages/server/src/scim.ts#L123) `ScimDirectory/table` | `Store.sql` (123) | AUTH |
| [packages/server/src/scim.ts:395](../../packages/server/src/scim.ts#L395) `ScimDirectory/update/scim_user_update` | `SQLite.prepare` (395); `Store.sql` (395) | AUTH |
| [packages/server/src/script-failure.ts:212](../../packages/server/src/script-failure.ts#L212) `explainScriptFailure` | `Store.row` (212) | RECORD |
| [packages/server/src/security.ts:212](../../packages/server/src/security.ts#L212) `SecurityApi/handle` | `Store.previewRecordRule` (212) | DESIGN |
| [packages/server/src/security.ts:80](../../packages/server/src/security.ts#L80) `importApproximations` | `SQLite.all` (80); `SQLite.prepare` (80); `Store.sql` (80) | DESIGN |
| [packages/server/src/security.ts:116](../../packages/server/src/security.ts#L116) `securityOf` | `Store.pendingChanges` (116) | DESIGN |
| [packages/server/src/semantic-find.ts:52](../../packages/server/src/semantic-find.ts#L52) `semanticFind` | `Store.findIds` (52) | SEARCH |
| [packages/server/src/semantic-find.ts:108](../../packages/server/src/semantic-find.ts#L108) `vectorOf` | `Store.containerId` (108); `Store.containerInfo` (110); `Store.container` (112); `Store.get` (117) | SEARCH |
| [packages/server/src/sql.ts:103](../../packages/server/src/sql.ts#L103) `SqlEndpoint/handle` | `Calculations.translateSQL` (103); `Store.select` (110) | SQL |
| [packages/server/src/sql.ts:163](../../packages/server/src/sql.ts#L163) `SqlEndpoint/tables` | `SQLite.all` (163); `SQLite.prepare` (163); `Store.sql` (163) | SQL |
| [packages/server/src/standby.ts:281](../../packages/server/src/standby.ts#L281) `Standby/copy` | `SQLite.get` (281); `SQLite.prepare` (281) | OPERATOR |
| [packages/server/src/summarize.ts:184](../../packages/server/src/summarize.ts#L184) `summarizeByRecord` | `Store.evaluateEach` (184); `Store.row` (186) | SUMMARY |
| [packages/server/src/summarize.ts:69](../../packages/server/src/summarize.ts#L69) `summarizeRecords` | `Store.findIds` (69); `Store.select` (126, 133, 143) | SUMMARY |
| [packages/server/src/sync-console.ts:458](../../packages/server/src/sync-console.ts#L458) `SyncConsole/runCheck` | `Store.sql` (458) | DESIGN |
| [packages/server/src/sync-console.ts:463](../../packages/server/src/sync-console.ts#L463) `SyncConsole/runCheck/assertActive` | `Store.sql` (463) | DESIGN |
| [packages/server/src/warm-worker.ts:34](../../packages/server/src/warm-worker.ts#L34) `message` | `Store.find` (34) | INTERNAL |
| [packages/server/src/warm-worker.ts:19](../../packages/server/src/warm-worker.ts#L19) `message/count` | `Store.recordCount` (19) | INTERNAL |
| [packages/server/src/webclient.ts:1664](../../packages/server/src/webclient.ts#L1664) `WebClient/aiReplace` | `Store.canView` (1664); `Store.getMany` (1680) | WEB |
| [packages/server/src/webclient.ts:1848](../../packages/server/src/webclient.ts#L1848) `WebClient/button` | `Store.findIds` (1848, 1898); `Store.evaluateEach` (1857, 1858) | WEB |
| [packages/server/src/webclient.ts:1250](../../packages/server/src/webclient.ts#L1250) `WebClient/charts` | `Calculations.context` (1250); `Store.canView` (1278); `Store.evaluateEach` (1287, 1291); `Store.evaluateRows` (1296, 1298) | WEB |
| [packages/server/src/webclient.ts:1241](../../packages/server/src/webclient.ts#L1241) `WebClient/charts/foundSet` | `Store.findIds` (1241) | WEB |
| [packages/server/src/webclient.ts:1281](../../packages/server/src/webclient.ts#L1281) `WebClient/charts/get` | `Store.get` (1281) | WEB |
| [packages/server/src/webclient.ts:667](../../packages/server/src/webclient.ts#L667) `WebClient/explain` | `Store.get` (667); `Store.row` (700, 713) | WEB |
| [packages/server/src/webclient.ts:1470](../../packages/server/src/webclient.ts#L1470) `WebClient/exportRecords` | `Store.getMany` (1470) | WEB |
| [packages/server/src/webclient.ts:1157](../../packages/server/src/webclient.ts#L1157) `WebClient/foundIds` | `Store.findIds` (1157) | WEB |
| [packages/server/src/webclient.ts:1201](../../packages/server/src/webclient.ts#L1201) `WebClient/foundSetPortal` | `Store.foundSetRows` (1201, 1208) | WEB |
| [packages/server/src/webclient.ts:1740](../../packages/server/src/webclient.ts#L1740) `WebClient/groups` | `Store.findIds` (1740); `Store.groupSummaries` (1746) | WEB |
| [packages/server/src/webclient.ts:530](../../packages/server/src/webclient.ts#L530) `WebClient/history` | `Store.get` (530) | WEB |
| [packages/server/src/webclient.ts:726](../../packages/server/src/webclient.ts#L726) `WebClient/index` | `Store.fieldIndex` (726) | WEB |
| [packages/server/src/webclient.ts:816](../../packages/server/src/webclient.ts#L816) `WebClient/menus` | `Store.evaluateEach` (816) | WEB |
| [packages/server/src/webclient.ts:1172](../../packages/server/src/webclient.ts#L1172) `WebClient/records` | `Store.getMany` (1172); `Store.find` (1175) | WEB |
| [packages/server/src/webclient.ts:1118](../../packages/server/src/webclient.ts#L1118) `WebClient/refresh` | `Store.previewRow` (1118); `Store.getMany` (1123); `Store.foundSetRows` (1145) | WEB |
| [packages/server/src/webclient.ts:1364](../../packages/server/src/webclient.ts#L1364) `WebClient/streamExportRecords/nextBatch` | `Store.selectIds` (1364); `Store.getMany` (1370) | WEB |
| [packages/server/src/webclient.ts:1032](../../packages/server/src/webclient.ts#L1032) `WebClient/view` | `Store.evaluateEach` (1032, 1056, 1075); `Store.canView` (1050); `Store.previewRow` (1054, 1076); `Store.get` (1067); `Store.row` (1068, 1068) | WEB |
| [packages/server/src/webclient.ts:1053](../../packages/server/src/webclient.ts#L1053) `WebClient/view/get` | `Store.get` (1053) | WEB |
| [packages/server/src/webclient.ts:2627](../../packages/server/src/webclient.ts#L2627) `foundIds` | `Store.findIds` (2627, 2629) | WEB |
| [packages/server/src/webclient.ts:2548](../../packages/server/src/webclient.ts#L2548) `listItems` | `Store.valueListItems` (2548) | WEB |
| [packages/store/src/activity.ts:430](../../packages/store/src/activity.ts#L430) `SharedRecordLocks/acquire` | `SQLite.prepare` (430) | CORE |
| [packages/store/src/activity.ts:468](../../packages/store/src/activity.ts#L468) `SharedRecordLocks/all` | `SQLite.all` (468); `SQLite.prepare` (468) | CORE |
| [packages/store/src/activity.ts:372](../../packages/store/src/activity.ts#L372) `SharedRecordLocks/constructor` | `SQLite.get` (372); `SQLite.prepare` (372) | CORE |
| [packages/store/src/activity.ts:403](../../packages/store/src/activity.ts#L403) `SharedRecordLocks/count` | `SQLite.get` (403); `SQLite.prepare` (403) | CORE |
| [packages/store/src/activity.ts:415](../../packages/store/src/activity.ts#L415) `SharedRecordLocks/holder` | `SQLite.get` (415); `SQLite.prepare` (415) | CORE |
| [packages/store/src/activity.ts:478](../../packages/store/src/activity.ts#L478) `SharedRecordLocks/leave` | `SQLite.prepare` (478) | CORE |
| [packages/store/src/activity.ts:482](../../packages/store/src/activity.ts#L482) `SharedRecordLocks/leaveOwner` | `SQLite.all` (482); `SQLite.prepare` (482) | CORE |
| [packages/store/src/activity.ts:458](../../packages/store/src/activity.ts#L458) `SharedRecordLocks/release` | `SQLite.prepare` (458) | CORE |
| [packages/store/src/activity.ts:462](../../packages/store/src/activity.ts#L462) `SharedRecordLocks/releaseOwner` | `SQLite.all` (462); `SQLite.prepare` (462) | CORE |
| [packages/store/src/activity.ts:444](../../packages/store/src/activity.ts#L444) `SharedRecordLocks/renew` | `SQLite.prepare` (444) | CORE |
| [packages/store/src/activity.ts:407](../../packages/store/src/activity.ts#L407) `SharedRecordLocks/sweep` | `SQLite.prepare` (407) | CORE |
| [packages/store/src/activity.ts:472](../../packages/store/src/activity.ts#L472) `SharedRecordLocks/view` | `SQLite.get` (472); `SQLite.prepare` (472, 473) | CORE |
| [packages/store/src/activity.ts:486](../../packages/store/src/activity.ts#L486) `SharedRecordLocks/viewers` | `SQLite.prepare` (486, 487); `SQLite.all` (487) | CORE |
| [packages/store/src/audit-anchor.ts:68](../../packages/store/src/audit-anchor.ts#L68) `checkAnchor` | `SQLite.get` (68, 70, 73); `SQLite.prepare` (68, 70, 73) | CORE |
| [packages/store/src/cache-versions.ts:11](../../packages/store/src/cache-versions.ts#L11) `ensureCacheVersions` | `SQLite.get` (11); `SQLite.prepare` (11) | CORE |
| [packages/store/src/calc.ts:618](../../packages/store/src/calc.ts#L618) `Calculations/allRecords` | `SQLite.iterate` (618); `SQLite.prepare` (618); `Store.sql` (618) | CALC |
| [packages/store/src/calc.ts:1213](../../packages/store/src/calc.ts#L1213) `Calculations/applyDelta/value` | `Calculations.value` (1213) | CALC |
| [packages/store/src/calc.ts:2385](../../packages/store/src/calc.ts#L2385) `Calculations/beforeWrite` | `relatedRows` (2385); `Calculations.related` (2439); `Calculations.context` (2452) | CORE |
| [packages/store/src/calc.ts:629](../../packages/store/src/calc.ts#L629) `Calculations/collect` | `Calculations.collector` (629) | CALC |
| [packages/store/src/calc.ts:660](../../packages/store/src/calc.ts#L660) `Calculations/collector/add` | `Calculations.related` (660) | CALC |
| [packages/store/src/calc.ts:1693](../../packages/store/src/calc.ts#L1693) `Calculations/columnNames` | `SQLite.all` (1693); `SQLite.prepare` (1693); `Store.sql` (1693) | CALC |
| [packages/store/src/calc.ts:2248](../../packages/store/src/calc.ts#L2248) `Calculations/computeColumn` | `Calculations.statement` (2248); `SQLite.get` (2248); `Calculations.value` (2251) | CALC |
| [packages/store/src/calc.ts:2503](../../packages/store/src/calc.ts#L2503) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2503); `Calculations.value` (2503) | CALC |
| [packages/store/src/calc.ts:2518](../../packages/store/src/calc.ts#L2518) `Calculations/computeStoredStyled` | `Calculations.context` (2518) | CORE |
| [packages/store/src/calc.ts:565](../../packages/store/src/calc.ts#L565) `Calculations/computed` | `Calculations.context` (565) | CALC |
| [packages/store/src/calc.ts:1913](../../packages/store/src/calc.ts#L1913) `Calculations/context/executeSQL` | `Calculations.executeSQL` (1913) | CALC |
| [packages/store/src/calc.ts:1762](../../packages/store/src/calc.ts#L1762) `Calculations/context/field` | `Calculations.summary` (1762); `Calculations.globalValue` (1765); `Calculations.value` (1766) | CALC |
| [packages/store/src/calc.ts:1887](../../packages/store/src/calc.ts#L1887) `Calculations/context/get` | `Store.recordCount` (1887, 1894); `Calculations.statement` (1892); `SQLite.get` (1892) | CALC |
| [packages/store/src/calc.ts:1810](../../packages/store/src/calc.ts#L1810) `Calculations/context/lookupNext` | `Store.canViewRecord` (1810) | CALC |
| [packages/store/src/calc.ts:1914](../../packages/store/src/calc.ts#L1914) `Calculations/context/persistentData` | `Store.persistentData` (1914) | CALC |
| [packages/store/src/calc.ts:1915](../../packages/store/src/calc.ts#L1915) `Calculations/context/persistentDataIds` | `Store.persistentDataIds` (1915) | CALC |
| [packages/store/src/calc.ts:1744](../../packages/store/src/calc.ts#L1744) `Calculations/context/records` | `Calculations.firstRelated` (1744) | CALC |
| [packages/store/src/calc.ts:1775](../../packages/store/src/calc.ts#L1775) `Calculations/context/related` | `Calculations.globalValue` (1775); `Calculations.value` (1777, 1788); `Calculations.related` (1790) | CALC |
| [packages/store/src/calc.ts:1825](../../packages/store/src/calc.ts#L1825) `Calculations/context/summary` | `Calculations.value` (1825, 1835); `Calculations.related` (1837); `Calculations.summary` (1855) | CALC |
| [packages/store/src/calc.ts:2211](../../packages/store/src/calc.ts#L2211) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2211) | CALC |
| [packages/store/src/calc.ts:1940](../../packages/store/src/calc.ts#L1940) `Calculations/design` | `Store.valueListItems` (1940) | CALC |
| [packages/store/src/calc.ts:1718](../../packages/store/src/calc.ts#L1718) `Calculations/ensureIndex` | `Store.sql` (1718, 1719) | CALC |
| [packages/store/src/calc.ts:1957](../../packages/store/src/calc.ts#L1957) `Calculations/executeSQL` | `Calculations.translateSQL` (1957); `Store.select` (1995); `Store.sql` (2006) | CALC |
| [packages/store/src/calc.ts:1359](../../packages/store/src/calc.ts#L1359) `Calculations/firstRelated` | `Calculations.related` (1359, 1371, 1386); `Store.viewableIds` (1366); `Calculations.relatedIds` (1369, 1382); `Calculations.statement` (1379); `SQLite.get` (1379) | CALC |
| [packages/store/src/calc.ts:673](../../packages/store/src/calc.ts#L673) `Calculations/foundSummary` | `Calculations.collect` (673) | CALC |
| [packages/store/src/calc.ts:1608](../../packages/store/src/calc.ts#L1608) `Calculations/foundSums` | `Store.sql` (1608) | CALC |
| [packages/store/src/calc.ts:358](../../packages/store/src/calc.ts#L358) `Calculations/globalValue` | `SQLite.get` (358); `SQLite.prepare` (358); `Store.sql` (358) | CALC |
| [packages/store/src/calc.ts:746](../../packages/store/src/calc.ts#L746) `Calculations/globalsKey` | `Calculations.globalValue` (746) | CALC |
| [packages/store/src/calc.ts:1671](../../packages/store/src/calc.ts#L1671) `Calculations/hopQuery` | `Calculations.value` (1671) | CALC |
| [packages/store/src/calc.ts:1511](../../packages/store/src/calc.ts#L1511) `Calculations/joinHop` | `Calculations.statement` (1511, 1513); `SQLite.get` (1511); `SQLite.iterate` (1513) | CALC |
| [packages/store/src/calc.ts:1569](../../packages/store/src/calc.ts#L1569) `Calculations/lookup` | `Store.sql` (1569) | CALC |
| [packages/store/src/calc.ts:340](../../packages/store/src/calc.ts#L340) `Calculations/meta` | `SQLite.get` (340); `SQLite.prepare` (340); `Store.sql` (340) | CALC |
| [packages/store/src/calc.ts:1559](../../packages/store/src/calc.ts#L1559) `Calculations/passStamp` | `Store.sql` (1559) | CALC |
| [packages/store/src/calc.ts:1404](../../packages/store/src/calc.ts#L1404) `Calculations/relatedIds` | `Calculations.related` (1404, 1434, 1448); `rowsById` (1418, 1445); `Calculations.statement` (1429); `SQLite.all` (1429) | CALC |
| [packages/store/src/calc.ts:1337](../../packages/store/src/calc.ts#L1337) `Calculations/relatedRecs` | `Calculations.relatedIds` (1337); `Store.viewableIds` (1342); `rowsById` (1348) | CALC |
| [packages/store/src/calc.ts:1393](../../packages/store/src/calc.ts#L1393) `Calculations/rowById` | `Calculations.statement` (1393); `SQLite.get` (1393) | CALC |
| [packages/store/src/calc.ts:345](../../packages/store/src/calc.ts#L345) `Calculations/saveMeta` | `SQLite.prepare` (345); `Store.sql` (345) | CALC |
| [packages/store/src/calc.ts:382](../../packages/store/src/calc.ts#L382) `Calculations/setNextSerial` | `Store.sql` (382, 383, 389, 391, 391) | CALC |
| [packages/store/src/calc.ts:2179](../../packages/store/src/calc.ts#L2179) `Calculations/shareColumn` | `Store.recordCount` (2179) | CALC |
| [packages/store/src/calc.ts:1704](../../packages/store/src/calc.ts#L1704) `Calculations/statement` | `SQLite.prepare` (1704); `Store.sql` (1704) | CALC |
| [packages/store/src/calc.ts:1540](../../packages/store/src/calc.ts#L1540) `Calculations/storedRelatedValues` | `Calculations.statement` (1540); `SQLite.iterate` (1540) | CALC |
| [packages/store/src/calc.ts:1285](../../packages/store/src/calc.ts#L1285) `Calculations/storedRows` | `SQLite.iterate` (1285); `SQLite.prepare` (1285); `Store.sql` (1285) | CALC |
| [packages/store/src/calc.ts:684](../../packages/store/src/calc.ts#L684) `Calculations/summary` | `Calculations.collect` (684) | CALC |
| [packages/store/src/calc.ts:921](../../packages/store/src/calc.ts#L921) `Calculations/summaryDependencies` | `Store.sql` (921) | CALC |
| [packages/store/src/calc.ts:636](../../packages/store/src/calc.ts#L636) `Calculations/summaryInput` | `Calculations.value` (636) | CALC |
| [packages/store/src/calc.ts:691](../../packages/store/src/calc.ts#L691) `Calculations/tableSummary` | `Calculations.wholeTable` (691) | CALC |
| [packages/store/src/calc.ts:2116](../../packages/store/src/calc.ts#L2116) `Calculations/translateSQL` | `Store.scopedTableSql` (2116, 2147) | CALC |
| [packages/store/src/calc.ts:2554](../../packages/store/src/calc.ts#L2554) `Calculations/uniqueCollision` | `Calculations.value` (2554) | CALC |
| [packages/store/src/calc.ts:580](../../packages/store/src/calc.ts#L580) `Calculations/unstoredValue` | `Calculations.unstoredStyled` (580); `Calculations.value` (580) | CALC |
| [packages/store/src/calc.ts:2581](../../packages/store/src/calc.ts#L2581) `Calculations/validate` | `Calculations.value` (2581); `Store.valueListItems` (2602); `Calculations.context` (2616) | CALC |
| [packages/store/src/calc.ts:2567](../../packages/store/src/calc.ts#L2567) `Calculations/validate/fail` | `Calculations.context` (2567) | CALC |
| [packages/store/src/calc.ts:530](../../packages/store/src/calc.ts#L530) `Calculations/value` | `Calculations.globalValue` (530) | CALC |
| [packages/store/src/calc.ts:960](../../packages/store/src/calc.ts#L960) `Calculations/wholeTable` | `rowsById` (960); `Store.viewableIds` (960); `Calculations.collect` (962, 1052); `Calculations.value` (1023); `Store.sql` (1031, 1039) | CALC |
| [packages/store/src/calc.ts:2763](../../packages/store/src/calc.ts#L2763) `containerValue` | `Store.containerInfo` (2763); `Store.containerRange` (2770); `Store.container` (2771) | CALC |
| [packages/store/src/calc.ts:2779](../../packages/store/src/calc.ts#L2779) `containerValue/read` | `Store.container` (2779) | CALC |
| [packages/store/src/calc.ts:2792](../../packages/store/src/calc.ts#L2792) `containerValue/value` | `Store.containerRange` (2792) | CALC |
| [packages/store/src/calc.ts:2678](../../packages/store/src/calc.ts#L2678) `nearest` | `SQLite.get` (2678); `SQLite.prepare` (2678); `Store.sql` (2678) | CALC |
| [packages/store/src/calc.ts:3223](../../packages/store/src/calc.ts#L3223) `rowsById/flush` | `Calculations.statement` (3223); `SQLite.iterate` (3223) | CALC |
| [packages/store/src/calc.ts:2910](../../packages/store/src/calc.ts#L2910) `sameValuesElsewhere` | `SQLite.all` (2910); `SQLite.prepare` (2910, 2917, 2919); `Store.sql` (2910, 2917, 2919); `Calculations.value` (2912); `SQLite.get` (2917, 2919) | CALC |
| [packages/store/src/damage.ts:93](../../packages/store/src/damage.ts#L93) `watchDatabase` | `SQLite.prepare` (93); `SQLite.iterate` (103) | CORE |
| [packages/store/src/exit-bundle.ts:266](../../packages/store/src/exit-bundle.ts#L266) `build` | `SQLite.prepare` (266) | EXIT-BUNDLE |
| [packages/store/src/exit-bundle.ts:289](../../packages/store/src/exit-bundle.ts#L289) `copyTables` | `SQLite.all` (289); `SQLite.prepare` (289, 295, 296, 312); `SQLite.get` (298, 309, 312) | EXIT-BUNDLE |
| [packages/store/src/exit-bundle.ts:467](../../packages/store/src/exit-bundle.ts#L467) `finish` | `SQLite.all` (467); `SQLite.prepare` (467); `Calculations.globalValue` (478) | EXIT-BUNDLE |
| [packages/store/src/exit-bundle.ts:322](../../packages/store/src/exit-bundle.ts#L322) `writeContainers` | `SQLite.all` (322, 334); `SQLite.prepare` (322, 334, 335, 365); `Store.containerInfo` (339); `Store.containerRange` (353); `SQLite.get` (365) | EXIT-BUNDLE |
| [packages/store/src/exit-bundle.ts:381](../../packages/store/src/exit-bundle.ts#L381) `writeCsv` | `SQLite.prepare` (381); `SQLite.iterate` (385) | EXIT-BUNDLE |
| [packages/store/src/explain-related.ts:364](../../packages/store/src/explain-related.ts#L364) `explainCandidate` | `SQLite.get` (364, 378); `SQLite.prepare` (364, 378); `Store.sql` (364, 378); `keyValue` (375); `Calculations.context` (383) | RECORD |
| [packages/store/src/explain-related.ts:301](../../packages/store/src/explain-related.ts#L301) `explainHop` | `keyValue` (301); `SQLite.get` (321); `SQLite.prepare` (321, 335); `Store.sql` (321, 335); `SQLite.all` (335) | RECORD |
| [packages/store/src/explain-related.ts:103](../../packages/store/src/explain-related.ts#L103) `explainRelated` | `Store.row` (103); `Store.get` (193); `Calculations.value` (242); `Calculations.context` (250) | RECORD |
| [packages/store/src/explain-related.ts:183](../../packages/store/src/explain-related.ts#L183) `explainRelated/runFilter` | `Calculations.context` (183) | RECORD |
| [packages/store/src/explain.ts:144](../../packages/store/src/explain.ts#L144) `explainField` | `Calculations.value` (144); `Calculations.context` (173) | RECORD |
| [packages/store/src/explain.ts:392](../../packages/store/src/explain.ts#L392) `lintFormula` | `Calculations.context` (392) | RECORD |
| [packages/store/src/export-sql.ts:230](../../packages/store/src/export-sql.ts#L230) `exportSql` | `Store.scopedTableSql` (230); `Store.select` (231, 364); `Store.container` (435) | OPERATOR |
| [packages/store/src/export-sql.ts:306](../../packages/store/src/export-sql.ts#L306) `exportSql/duplicates` | `Store.select` (306) | OPERATOR |
| [packages/store/src/export-sql.ts:256](../../packages/store/src/export-sql.ts#L256) `exportSql/page` | `Store.select` (256) | OPERATOR |
| [packages/store/src/fidelity.ts:214](../../packages/store/src/fidelity.ts#L214) `calcFidelity` | `Calculations.executeSQL` (214, 215, 301); `Store.sql` (219, 227, 300); `SQLite.all` (227); `SQLite.prepare` (227); `Calculations.computeStored` (263) | DESIGN |
| [packages/store/src/fidelity.ts:176](../../packages/store/src/fidelity.ts#L176) `changedAfter` | `Untyped.executeSQL` (176) | DESIGN |
| [packages/store/src/fidelity.ts:196](../../packages/store/src/fidelity.ts#L196) `queryProblem` | `Calculations.translateSQL` (196); `Store.describe` (197) | DESIGN |
| [packages/store/src/fmexport.ts:236](../../packages/store/src/fmexport.ts#L236) `fmExport` | `Store.recordCount` (236); `Store.query` (237); `Store.containerInfo` (252); `Store.container` (259) | OPERATOR |
| [packages/store/src/foreign-keys.ts:172](../../packages/store/src/foreign-keys.ts#L172) `childIds` | `SQLite.all` (172) | CORE |
| [packages/store/src/foreign-keys.ts:179](../../packages/store/src/foreign-keys.ts#L179) `childrenWithKeys` | `SQLite.all` (179) | CORE |
| [packages/store/src/foreign-keys.ts:188](../../packages/store/src/foreign-keys.ts#L188) `orphans` | `SQLite.get` (188); `SQLite.all` (189) | CORE |
| [packages/store/src/foreign-keys.ts:165](../../packages/store/src/foreign-keys.ts#L165) `parentHas` | `SQLite.get` (165) | CORE |
| [packages/store/src/import.ts:92](../../packages/store/src/import.ts#L92) `addExternalSizeColumn` | `SQLite.all` (92); `SQLite.prepare` (92) | OPERATOR |
| [packages/store/src/import.ts:162](../../packages/store/src/import.ts#L162) `applyFileAccountStatus` | `SQLite.get` (162, 164); `SQLite.prepare` (162, 164, 166, 178) | OPERATOR |
| [packages/store/src/import.ts:199](../../packages/store/src/import.ts#L199) `createStore` | `SQLite.prepare` (199, 210) | OPERATOR |
| [packages/store/src/import.ts:122](../../packages/store/src/import.ts#L122) `importDesigns` | `SQLite.all` (122); `SQLite.prepare` (122, 136, 139, 142, 144); `SQLite.get` (136, 139) | OPERATOR |
| [packages/store/src/import.ts:328](../../packages/store/src/import.ts#L328) `importFmp12` | `SQLite.prepare` (328, 338, 344, 350, 354, 369, 380, 455, 456); `SQLite.get` (344, 369); `SQLite.all` (350) | OPERATOR |
| [packages/store/src/import.ts:319](../../packages/store/src/import.ts#L319) `importFmp12/save` | `SQLite.prepare` (319) | OPERATOR |
| [packages/store/src/import.ts:222](../../packages/store/src/import.ts#L222) `needsDesigns` | `SQLite.get` (222); `SQLite.prepare` (222) | OPERATOR |
| [packages/store/src/import.ts:269](../../packages/store/src/import.ts#L269) `readState` | `SQLite.get` (269); `SQLite.prepare` (269) | OPERATOR |
| [packages/store/src/import.ts:104](../../packages/store/src/import.ts#L104) `writeDesign` | `SQLite.prepare` (104, 108) | OPERATOR |
| [packages/store/src/layout-speed.ts:56](../../packages/store/src/layout-speed.ts#L56) `layoutCost/recordCount` | `Store.recordCount` (56) | DESIGN |
| [packages/store/src/layout-speed.ts:419](../../packages/store/src/layout-speed.ts#L419) `speedContext` | `Store.recordCount` (419) | DESIGN |
| [packages/store/src/privileges.ts:547](../../packages/store/src/privileges.ts#L547) `ensurePrivilegeTables` | `SQLite.all` (547); `SQLite.prepare` (547) | AUTH |
| [packages/store/src/privileges.ts:519](../../packages/store/src/privileges.ts#L519) `privilegeSets` | `SQLite.all` (519); `SQLite.prepare` (519) | AUTH |
| [packages/store/src/reconvert.ts:196](../../packages/store/src/reconvert.ts#L196) `build` | `SQLite.get` (196); `SQLite.prepare` (196, 199, 204); `SQLite.all` (204) | OPERATOR |
| [packages/store/src/reconvert.ts:301](../../packages/store/src/reconvert.ts#L301) `carryRecords` | `SQLite.prepare` (301, 304, 305, 315, 321, 322); `SQLite.all` (304, 308, 321) | OPERATOR |
| [packages/store/src/reconvert.ts:330](../../packages/store/src/reconvert.ts#L330) `carrySettings` | `SQLite.all` (330, 334, 342); `SQLite.prepare` (330, 334, 342, 343, 347); `SQLite.get` (347) | OPERATOR |
| [packages/store/src/reconvert.ts:108](../../packages/store/src/reconvert.ts#L108) `columns` | `SQLite.all` (108); `SQLite.prepare` (108) | OPERATOR |
| [packages/store/src/reconvert.ts:264](../../packages/store/src/reconvert.ts#L264) `copyContainer` | `SQLite.get` (264); `SQLite.prepare` (264, 266, 272) | OPERATOR |
| [packages/store/src/reconvert.ts:99](../../packages/store/src/reconvert.ts#L99) `meta` | `SQLite.get` (99); `SQLite.prepare` (99) | OPERATOR |
| [packages/store/src/reconvert.ts:244](../../packages/store/src/reconvert.ts#L244) `previewOf` | `SQLite.get` (244); `SQLite.prepare` (244) | OPERATOR |
| [packages/store/src/reconvert.ts:231](../../packages/store/src/reconvert.ts#L231) `previewOf/count` | `SQLite.get` (231); `SQLite.prepare` (231) | OPERATOR |
| [packages/store/src/reconvert.ts:121](../../packages/store/src/reconvert.ts#L121) `reconvertCheck` | `SQLite.get` (121); `SQLite.prepare` (121) | OPERATOR |
| [packages/store/src/reconvert.ts:104](../../packages/store/src/reconvert.ts#L104) `tableExists` | `SQLite.get` (104); `SQLite.prepare` (104) | OPERATOR |
| [packages/store/src/record-chain.ts:58](../../packages/store/src/record-chain.ts#L58) `ensureRecordChain` | `SQLite.all` (58); `SQLite.prepare` (58, 67, 68, 71); `SQLite.get` (67, 68) | CORE |
| [packages/store/src/record-chain.ts:80](../../packages/store/src/record-chain.ts#L80) `linkRecordEntry` | `SQLite.prepare` (80, 81, 82, 85, 86); `SQLite.get` (81, 82) | CORE |
| [packages/store/src/record-chain.ts:93](../../packages/store/src/record-chain.ts#L93) `pruneRecordEntries` | `SQLite.prepare` (93, 94, 95, 97); `SQLite.get` (94) | CORE |
| [packages/store/src/record-chain.ts:115](../../packages/store/src/record-chain.ts#L115) `verifyRecordAudit` | `SQLite.get` (115, 129); `SQLite.prepare` (115, 119, 129, 132); `SQLite.all` (119); `SQLite.iterate` (132) | CORE |
| [packages/store/src/related.ts:145](../../packages/store/src/related.ts#L145) `condition` | `Store.canViewRecord` (145); `keyValue` (158) | RELATED |
| [packages/store/src/related.ts:346](../../packages/store/src/related.ts#L346) `firstRelatedEach` | `Calculations.statement` (346); `SQLite.all` (346) | RELATED |
| [packages/store/src/related.ts:325](../../packages/store/src/related.ts#L325) `firstRelatedEach/keysOf` | `keyValue` (325) | RELATED |
| [packages/store/src/related.ts:312](../../packages/store/src/related.ts#L312) `firstRelatedEach/oneByOne` | `relatedRows` (312) | RELATED |
| [packages/store/src/related.ts:134](../../packages/store/src/related.ts#L134) `keyValue` | `Calculations.value` (134) | RELATED |
| [packages/store/src/related.ts:249](../../packages/store/src/related.ts#L249) `relatedIdList` | `Calculations.relatedIds` (249); `Calculations.statement` (254); `SQLite.iterate` (254) | RELATED |
| [packages/store/src/related.ts:292](../../packages/store/src/related.ts#L292) `relatedKeys` | `keyValue` (292) | RELATED |
| [packages/store/src/related.ts:191](../../packages/store/src/related.ts#L191) `relatedRows` | `Calculations.relatedIds` (191); `rowsById` (192); `Calculations.statement` (207, 211, 221); `SQLite.get` (207); `SQLite.all` (211); `SQLite.iterate` (221) | RELATED |
| [packages/store/src/results.ts:122](../../packages/store/src/results.ts#L122) `ResultCache/claimed` | `SQLite.get` (122); `SQLite.prepare` (122) | CORE |
| [packages/store/src/results.ts:74](../../packages/store/src/results.ts#L74) `ResultCache/get` | `SQLite.get` (74); `SQLite.prepare` (74) | CORE |
| [packages/store/src/results.ts:65](../../packages/store/src/results.ts#L65) `ResultCache/lastWrite` | `SQLite.get` (65); `SQLite.prepare` (65) | CORE |
| [packages/store/src/results.ts:86](../../packages/store/src/results.ts#L86) `ResultCache/put` | `SQLite.prepare` (86) | CORE |
| [packages/store/src/results.ts:131](../../packages/store/src/results.ts#L131) `ResultCache/release` | `SQLite.prepare` (131) | CORE |
| [packages/store/src/results.ts:110](../../packages/store/src/results.ts#L110) `ResultCache/renew` | `SQLite.prepare` (110) | CORE |
| [packages/store/src/results.ts:56](../../packages/store/src/results.ts#L56) `ResultCache/wrote` | `SQLite.prepare` (56) | CORE |
| [packages/store/src/security-chain.ts:132](../../packages/store/src/security-chain.ts#L132) `appendSecurityEvent` | `SQLite.prepare` (132, 134, 136, 138, 142, 144); `SQLite.get` (134, 138) | CORE |
| [packages/store/src/security-chain.ts:92](../../packages/store/src/security-chain.ts#L92) `ensureSecurityChain` | `SQLite.get` (92, 102, 103, 106, 107); `SQLite.prepare` (92, 93, 102, 103, 106, 107, 111, 114, 122); `SQLite.all` (93); `SQLite.iterate` (114) | CORE |
| [packages/store/src/security-chain.ts:162](../../packages/store/src/security-chain.ts#L162) `verifySecurityAudit` | `SQLite.get` (162, 163); `SQLite.prepare` (162, 163, 167, 176); `SQLite.all` (167); `SQLite.iterate` (178) | CORE |
| [packages/store/src/stale-calcs.ts:283](../../packages/store/src/stale-calcs.ts#L283) `RefreshJournal/add` | `SQLite.prepare` (283); `Store.sql` (283) | DESIGN |
| [packages/store/src/stale-calcs.ts:277](../../packages/store/src/stale-calcs.ts#L277) `RefreshJournal/constructor` | `Store.sql` (277) | DESIGN |
| [packages/store/src/stale-calcs.ts:289](../../packages/store/src/stale-calcs.ts#L289) `RefreshJournal/get` | `SQLite.get` (289); `SQLite.prepare` (289); `Store.sql` (289) | DESIGN |
| [packages/store/src/stale-calcs.ts:294](../../packages/store/src/stale-calcs.ts#L294) `RefreshJournal/list` | `SQLite.all` (294); `SQLite.prepare` (294); `Store.sql` (294) | DESIGN |
| [packages/store/src/stale-calcs.ts:298](../../packages/store/src/stale-calcs.ts#L298) `RefreshJournal/markUndone` | `SQLite.prepare` (298); `Store.sql` (298) | DESIGN |
| [packages/store/src/stale-calcs.ts:107](../../packages/store/src/stale-calcs.ts#L107) `current` | `Calculations.computeStored` (107) | DESIGN |
| [packages/store/src/stale-calcs.ts:128](../../packages/store/src/stale-calcs.ts#L128) `findStaleCalcs` | `Store.sql` (128, 135, 158); `Store.recordCount` (133); `SQLite.iterate` (135); `SQLite.prepare` (135) | DESIGN |
| [packages/store/src/stale-calcs.ts:205](../../packages/store/src/stale-calcs.ts#L205) `refreshStaleCalcsBatch` | `Store.sql` (205, 210, 228, 231); `SQLite.iterate` (210); `SQLite.prepare` (210) | DESIGN |
| [packages/store/src/stale-calcs.ts:243](../../packages/store/src/stale-calcs.ts#L243) `undoStaleRefreshBatch` | `Store.sql` (243, 261, 263) | DESIGN |
| [packages/store/src/store-format.ts:50](../../packages/store/src/store-format.ts#L50) `checkFormat` | `SQLite.prepare` (50) | CORE |
| [packages/store/src/store-format.ts:32](../../packages/store/src/store-format.ts#L32) `storedFormat` | `SQLite.get` (32); `SQLite.prepare` (32) | CORE |
| [packages/store/src/store.ts:4644](../../packages/store/src/store.ts#L4644) `Store/accountIdentityId` | `SQLite.get` (4644, 4649); `SQLite.prepare` (4644, 4648, 4649); `Store.sql` (4644, 4648, 4649) | CORE |
| [packages/store/src/store.ts:4607](../../packages/store/src/store.ts#L4607) `Store/accountInactive` | `SQLite.get` (4607); `SQLite.prepare` (4607); `Store.sql` (4607) | CORE |
| [packages/store/src/store.ts:4772](../../packages/store/src/store.ts#L4772) `Store/accountLocalOnly` | `SQLite.get` (4772); `SQLite.prepare` (4772); `Store.sql` (4772) | CORE |
| [packages/store/src/store.ts:5583](../../packages/store/src/store.ts#L5583) `Store/accountPrivilegeSet` | `SQLite.get` (5583); `SQLite.prepare` (5583); `Store.sql` (5583) | CORE |
| [packages/store/src/store.ts:4777](../../packages/store/src/store.ts#L4777) `Store/accountRequires2fa` | `SQLite.get` (4777); `SQLite.prepare` (4777); `Store.sql` (4777) | CORE |
| [packages/store/src/store.ts:4988](../../packages/store/src/store.ts#L4988) `Store/accountUsage` | `SQLite.get` (4988); `SQLite.prepare` (4988, 4989); `Store.sql` (4988, 4989); `SQLite.all` (4989); `Store.auditLog` (5005) | CORE |
| [packages/store/src/store.ts:3108](../../packages/store/src/store.ts#L3108) `Store/accounts` | `SQLite.all` (3108); `SQLite.prepare` (3108); `Store.sql` (3108) | CORE |
| [packages/store/src/store.ts:3104](../../packages/store/src/store.ts#L3104) `Store/accountsSharingLockout` | `SQLite.all` (3104); `SQLite.prepare` (3104); `Store.sql` (3104) | CORE |
| [packages/store/src/store.ts:7599](../../packages/store/src/store.ts#L7599) `Store/addContainer` | `SQLite.all` (7599); `SQLite.prepare` (7599, 7604, 7618, 7622, 7623); `Store.sql` (7599, 7604, 7618, 7620, 7622, 7623, 7625, 7628); `SQLite.get` (7609); `Store.containerRange` (7611) | CORE |
| [packages/store/src/store.ts:7645](../../packages/store/src/store.ts#L7645) `Store/addExternalContainer` | `SQLite.prepare` (7645); `Store.sql` (7645) | CORE |
| [packages/store/src/store.ts:8101](../../packages/store/src/store.ts#L8101) `Store/addFieldIndex` | `Store.sql` (8101) | CORE |
| [packages/store/src/store.ts:6306](../../packages/store/src/store.ts#L6306) `Store/addImage` | `Store.sql` (6306, 6307); `SQLite.prepare` (6307) | CORE |
| [packages/store/src/store.ts:5633](../../packages/store/src/store.ts#L5633) `Store/addProvisionedAccount` | `SQLite.get` (5633); `SQLite.prepare` (5633, 5637); `Store.sql` (5633, 5637) | CORE |
| [packages/store/src/store.ts:6725](../../packages/store/src/store.ts#L6725) `Store/addRelated` | `relatedRows` (6725); `rowsById` (6757); `firstRelatedEach` (6780) | CORE |
| [packages/store/src/store.ts:3126](../../packages/store/src/store.ts#L3126) `Store/agentNeedsApproval` | `SQLite.get` (3126); `SQLite.prepare` (3126); `Store.sql` (3126) | CORE |
| [packages/store/src/store.ts:5847](../../packages/store/src/store.ts#L5847) `Store/allowedIds` | `SQLite.iterate` (5847); `SQLite.prepare` (5847); `Store.sql` (5847) | CORE |
| [packages/store/src/store.ts:5045](../../packages/store/src/store.ts#L5045) `Store/apiToken` | `SQLite.get` (5045); `SQLite.prepare` (5045, 5058); `Store.sql` (5045, 5058) | CORE |
| [packages/store/src/store.ts:5021](../../packages/store/src/store.ts#L5021) `Store/apiTokens` | `SQLite.all` (5021); `SQLite.prepare` (5021); `Store.sql` (5021) | CORE |
| [packages/store/src/store.ts:3449](../../packages/store/src/store.ts#L3449) `Store/appendSecurityEvent` | `Store.sql` (3449) | CORE |
| [packages/store/src/store.ts:4454](../../packages/store/src/store.ts#L4454) `Store/applyAccountImport` | `Store.sql` (4454, 4462, 4491); `SQLite.get` (4462); `SQLite.prepare` (4462, 4491) | CORE |
| [packages/store/src/store.ts:2071](../../packages/store/src/store.ts#L2071) `Store/applyDesign` | `Store.sql` (2071, 2072, 2085, 2088, 2093, 2109, 2112, 2112); `SQLite.prepare` (2088, 2093) | CORE |
| [packages/store/src/store.ts:3322](../../packages/store/src/store.ts#L3322) `Store/approvePending` | `SQLite.get` (3322); `SQLite.prepare` (3322, 3333); `Store.sql` (3322, 3333) | CORE |
| [packages/store/src/store.ts:2528](../../packages/store/src/store.ts#L2528) `Store/audit` | `Store.sql` (2528) | CORE |
| [packages/store/src/store.ts:2170](../../packages/store/src/store.ts#L2170) `Store/auditLog` | `SQLite.all` (2170); `SQLite.prepare` (2170); `Store.sql` (2170) | CORE |
| [packages/store/src/store.ts:1697](../../packages/store/src/store.ts#L1697) `Store/backup` | `Store.sql` (1697) | CORE |
| [packages/store/src/store.ts:3132](../../packages/store/src/store.ts#L3132) `Store/blankPasswordAccounts` | `SQLite.all` (3132); `SQLite.prepare` (3132); `Store.sql` (3132) | CORE |
| [packages/store/src/store.ts:8682](../../packages/store/src/store.ts#L8682) `Store/canView` | `Store.canView` (8682); `Store.row` (8683) | GATED-STORE |
| [packages/store/src/store.ts:8664](../../packages/store/src/store.ts#L8664) `Store/canViewRecord` | `SQLite.get` (8664); `SQLite.prepare` (8664); `Store.sql` (8664) | GATED-STORE |
| [packages/store/src/store.ts:4383](../../packages/store/src/store.ts#L4383) `Store/canonicalAccount` | `SQLite.all` (4383); `SQLite.prepare` (4383); `Store.sql` (4383) | CORE |
| [packages/store/src/store.ts:9721](../../packages/store/src/store.ts#L9721) `Store/cascadeDelete` | `relatedRows` (9721) | CORE |
| [packages/store/src/store.ts:1903](../../packages/store/src/store.ts#L1903) `Store/changeOne` | `Store.sql` (1903, 1905) | CORE |
| [packages/store/src/store.ts:1906](../../packages/store/src/store.ts#L1906) `Store/changeOne/read` | `SQLite.get` (1906); `SQLite.prepare` (1906); `Store.sql` (1906) | CORE |
| [packages/store/src/store.ts:7980](../../packages/store/src/store.ts#L7980) `Store/checkContainerWrite` | `Store.row` (7980) | CORE |
| [packages/store/src/store.ts:9394](../../packages/store/src/store.ts#L9394) `Store/checkEditable` | `Store.row` (9394) | CORE |
| [packages/store/src/store.ts:1367](../../packages/store/src/store.ts#L1367) `Store/checkpoint` | `SQLite.get` (1367); `SQLite.prepare` (1367); `Store.sql` (1367) | CORE |
| [packages/store/src/store.ts:5619](../../packages/store/src/store.ts#L5619) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5619); `Store.sql` (5619) | CORE |
| [packages/store/src/store.ts:1385](../../packages/store/src/store.ts#L1385) `Store/close` | `Store.sql` (1385) | CORE |
| [packages/store/src/store.ts:7948](../../packages/store/src/store.ts#L7948) `Store/compactFile` | `Store.sql` (7948, 7949, 7951) | CORE |
| [packages/store/src/store.ts:9845](../../packages/store/src/store.ts#L9845) `Store/computeValuesCurrent` | `Store.computeValues` (9845); `Store.sql` (9851, 9855); `SQLite.all` (9855); `SQLite.prepare` (9855) | GATED-STORE |
| [packages/store/src/store.ts:8333](../../packages/store/src/store.ts#L8333) `Store/computedRows` | `Store.sql` (8333, 8336, 8337, 8338, 8340, 8350, 8351, 8352, 8355); `SQLite.prepare` (8336, 8338, 8340, 8350); `SQLite.iterate` (8340); `Calculations.globalValue` (8343); `Calculations.unstoredValue` (8344); `Calculations.related` (8347); `SQLite.all` (8350) | CORE |
| [packages/store/src/store.ts:5085](../../packages/store/src/store.ts#L5085) `Store/confirmTotp` | `SQLite.get` (5085); `SQLite.prepare` (5085, 5087); `Store.sql` (5085, 5087) | CORE |
| [packages/store/src/store.ts:1062](../../packages/store/src/store.ts#L1062) `Store/constructor` | `Store.sql` (1062, 1064, 1066, 1067, 1071, 1075, 1076, 1087, 1092, 1097, 1098, 1102, 1103, 1104, 1111, 1115, 1119, 1120, 1121, 1126, 1130, 1133, 1134, 1136, 1137, 1140, 1141, 1145, 1146, 1150, 1151, 1154, 1156, 1159, 1160, 1164, 1165, 1169, 1170, 1173, 1174, 1175, 1178, 1179, 1182, 1183, 1185, 1185, 1186, 1186, 1187, 1190, 1194, 1196, 1199, 1200, 1201, 1204, 1205, 1207, 1209, 1210, 1214, 1215, 1217, 1221, 1223, 1224, 1225, 1225, 1229, 1230); `SQLite.get` (1066); `SQLite.prepare` (1066, 1133, 1134, 1137, 1140, 1145, 1150, 1159, 1164, 1169, 1178, 1182, 1185, 1186, 1204, 1209, 1214); `SQLite.all` (1133, 1140, 1145, 1150, 1159, 1164, 1169, 1178, 1182, 1185, 1186, 1204, 1209, 1214) | CORE |
| [packages/store/src/store.ts:5429](../../packages/store/src/store.ts#L5429) `Store/consumeRecoveryCode` | `SQLite.prepare` (5429); `Store.sql` (5429) | CORE |
| [packages/store/src/store.ts:7523](../../packages/store/src/store.ts#L7523) `Store/container` | `SQLite.get` (7523); `SQLite.prepare` (7523, 7532); `Store.sql` (7523, 7532); `SQLite.all` (7532) | CORE |
| [packages/store/src/store.ts:7957](../../packages/store/src/store.ts#L7957) `Store/containerId` | `Store.containerId` (7957); `Store.row` (7958) | CORE |
| [packages/store/src/store.ts:7540](../../packages/store/src/store.ts#L7540) `Store/containerInfo` | `SQLite.get` (7540); `SQLite.prepare` (7540); `Store.sql` (7540) | CORE |
| [packages/store/src/store.ts:7504](../../packages/store/src/store.ts#L7504) `Store/containerIntact` | `SQLite.get` (7504); `SQLite.prepare` (7504); `Store.sql` (7504) | CORE |
| [packages/store/src/store.ts:7443](../../packages/store/src/store.ts#L7443) `Store/containerIntegrityReport` | `SQLite.all` (7443); `SQLite.prepare` (7443, 7454); `Store.sql` (7443, 7454); `SQLite.get` (7454) | CORE |
| [packages/store/src/store.ts:7518](../../packages/store/src/store.ts#L7518) `Store/containerMeta` | `SQLite.get` (7518); `SQLite.prepare` (7518); `Store.sql` (7518) | CORE |
| [packages/store/src/store.ts:7574](../../packages/store/src/store.ts#L7574) `Store/containerRange` | `SQLite.all` (7574); `SQLite.prepare` (7574, 7581); `Store.sql` (7574, 7581); `SQLite.get` (7581) | CORE |
| [packages/store/src/store.ts:7345](../../packages/store/src/store.ts#L7345) `Store/containerReferences` | `SQLite.all` (7345, 7364, 7366, 7372, 7385, 7396, 7410); `SQLite.prepare` (7345, 7364, 7366, 7372, 7385, 7396, 7408, 7410); `Store.sql` (7345, 7364, 7366, 7372, 7385, 7396, 7408, 7410); `SQLite.get` (7408); `Store.row` (7419) | CORE |
| [packages/store/src/store.ts:9825](../../packages/store/src/store.ts#L9825) `Store/countIds` | `Store.countIds` (9825); `SQLite.get` (9829); `SQLite.prepare` (9829); `Store.sql` (9829) | GATED-STORE |
| [packages/store/src/store.ts:8707](../../packages/store/src/store.ts#L8707) `Store/create` | `SQLite.get` (8707, 8713); `SQLite.prepare` (8707, 8713, 8726); `Store.sql` (8707, 8713, 8726) | CORE |
| [packages/store/src/store.ts:3421](../../packages/store/src/store.ts#L3421) `Store/createAccount` | `SQLite.get` (3421); `SQLite.prepare` (3421, 3425, 3431, 3436, 3441); `Store.sql` (3421, 3425, 3431, 3436, 3441) | CORE |
| [packages/store/src/store.ts:4821](../../packages/store/src/store.ts#L4821) `Store/createApiToken` | `SQLite.get` (4821, 4849); `SQLite.prepare` (4821, 4848, 4849, 4859); `Store.sql` (4821, 4848, 4849, 4859) | CORE |
| [packages/store/src/store.ts:4395](../../packages/store/src/store.ts#L4395) `Store/createLocalAccount` | `SQLite.prepare` (4395); `Store.sql` (4395) | CORE |
| [packages/store/src/store.ts:3098](../../packages/store/src/store.ts#L3098) `Store/credentialIdentity` | `SQLite.get` (3098); `SQLite.prepare` (3098); `Store.sql` (3098) | CORE |
| [packages/store/src/store.ts:1787](../../packages/store/src/store.ts#L1787) `Store/dataVersion` | `SQLite.get` (1787); `SQLite.prepare` (1787); `Store.sql` (1787) | CORE |
| [packages/store/src/store.ts:9418](../../packages/store/src/store.ts#L9418) `Store/delete` | `Store.row` (9418) | CORE |
| [packages/store/src/store.ts:9426](../../packages/store/src/store.ts#L9426) `Store/delete/run` | `SQLite.get` (9426); `SQLite.prepare` (9426, 9430); `Store.sql` (9426, 9430) | CORE |
| [packages/store/src/store.ts:4549](../../packages/store/src/store.ts#L4549) `Store/deleteAccount` | `SQLite.prepare` (4549, 4553, 4554, 4555, 4556, 4557, 4558, 4559, 4560, 4567, 4569, 4572, 4576); `Store.sql` (4549, 4553, 4554, 4555, 4556, 4557, 4558, 4559, 4560, 4567, 4569, 4572, 4576) | CORE |
| [packages/store/src/store.ts:5514](../../packages/store/src/store.ts#L5514) `Store/deletePrivilegeSet` | `SQLite.prepare` (5514); `Store.sql` (5514) | CORE |
| [packages/store/src/store.ts:3559](../../packages/store/src/store.ts#L3559) `Store/deleteScriptTest` | `SQLite.prepare` (3559); `Store.sql` (3559) | CORE |
| [packages/store/src/store.ts:2743](../../packages/store/src/store.ts#L2743) `Store/deletedRows` | `SQLite.get` (2743); `SQLite.prepare` (2743, 2745, 2745); `Store.sql` (2743, 2745, 2745); `SQLite.all` (2745, 2745) | CORE |
| [packages/store/src/store.ts:2853](../../packages/store/src/store.ts#L2853) `Store/designEffect` | `Store.sql` (2853, 2858, 2863, 2868, 2871, 2877, 2888, 2889, 2891, 2904, 2905, 2908, 2910, 2916, 2917, 2918, 2923, 2925, 2929, 2932, 2933, 2935, 2938, 2944, 2946, 2953, 2954, 2956, 2957, 2958, 2959, 2966, 2967, 2969, 2969, 2971, 2972, 2973, 2977, 2981, 2983, 3021, 3023, 3025); `SQLite.get` (2888, 2904, 2916, 2917, 2929, 2933, 2969, 2977); `SQLite.prepare` (2888, 2889, 2904, 2905, 2916, 2917, 2923, 2925, 2929, 2933, 2944, 2946, 2959, 2966, 2967, 2969, 2971, 2973, 2977, 2981); `SQLite.all` (2966, 2967); `SQLite.iterate` (2971) | CORE |
| [packages/store/src/store.ts:2846](../../packages/store/src/store.ts#L2846) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2846); `Store.sql` (2846) | CORE |
| [packages/store/src/store.ts:2830](../../packages/store/src/store.ts#L2830) `Store/designEffect/renameKey` | `SQLite.prepare` (2830); `Store.sql` (2830) | CORE |
| [packages/store/src/store.ts:2784](../../packages/store/src/store.ts#L2784) `Store/designHistory` | `SQLite.all` (2784); `SQLite.prepare` (2784); `Store.sql` (2784) | CORE |
| [packages/store/src/store.ts:5106](../../packages/store/src/store.ts#L5106) `Store/disableTotp` | `SQLite.prepare` (5106); `Store.sql` (5106) | CORE |
| [packages/store/src/store.ts:3033](../../packages/store/src/store.ts#L3033) `Store/dropColumnIndexes` | `SQLite.all` (3033, 3035); `SQLite.prepare` (3033, 3035); `Store.sql` (3033, 3035, 3036) | CORE |
| [packages/store/src/store.ts:8113](../../packages/store/src/store.ts#L8113) `Store/dropFieldIndex` | `SQLite.get` (8113); `SQLite.prepare` (8113); `Store.sql` (8113, 8114) | CORE |
| [packages/store/src/store.ts:8750](../../packages/store/src/store.ts#L8750) `Store/duplicate` | `Store.row` (8750); `SQLite.get` (8754); `SQLite.prepare` (8754, 8769); `Store.sql` (8754, 8769) | CORE |
| [packages/store/src/store.ts:7761](../../packages/store/src/store.ts#L7761) `Store/embeddedContainerCount` | `SQLite.prepare` (7761); `Store.sql` (7761); `SQLite.get` (7762) | CORE |
| [packages/store/src/store.ts:7747](../../packages/store/src/store.ts#L7747) `Store/embeddedContainers` | `SQLite.prepare` (7747, 7748); `Store.sql` (7747, 7748); `SQLite.all` (7748); `SQLite.get` (7752) | CORE |
| [packages/store/src/store.ts:2769](../../packages/store/src/store.ts#L2769) `Store/emptyDeleted` | `Store.sql` (2769, 2772, 2773, 2775, 2777); `SQLite.prepare` (2773) | CORE |
| [packages/store/src/store.ts:1667](../../packages/store/src/store.ts#L1667) `Store/endTransaction` | `Store.sql` (1667, 1670, 1670) | CORE |
| [packages/store/src/store.ts:5074](../../packages/store/src/store.ts#L5074) `Store/enrollTotp` | `SQLite.prepare` (5074); `Store.sql` (5074) | CORE |
| [packages/store/src/store.ts:2738](../../packages/store/src/store.ts#L2738) `Store/ensureDeleted` | `Store.sql` (2738) | CORE |
| [packages/store/src/store.ts:1240](../../packages/store/src/store.ts#L1240) `Store/ensureNativeIds` | `SQLite.all` (1240, 1252); `SQLite.prepare` (1240, 1243, 1251, 1252); `Store.sql` (1240, 1243, 1246, 1250, 1251, 1252, 1255, 1257) | CORE |
| [packages/store/src/store.ts:9091](../../packages/store/src/store.ts#L9091) `Store/evaluateCurrent` | `Store.row` (9091, 9091, 9092, 9092); `Calculations.context` (9097); `Store.get` (9098, 9100) | GATED-STORE |
| [packages/store/src/store.ts:9132](../../packages/store/src/store.ts#L9132) `Store/evaluateEachCurrent` | `Store.row` (9132, 9132, 9137); `Calculations.context` (9138); `Store.get` (9140) | GATED-STORE |
| [packages/store/src/store.ts:9194](../../packages/store/src/store.ts#L9194) `Store/evaluateRowsCurrent` | `Store.row` (9194, 9194, 9195, 9195) | GATED-STORE |
| [packages/store/src/store.ts:9173](../../packages/store/src/store.ts#L9173) `Store/evaluateRowsCurrent/each` | `Calculations.context` (9173); `Store.get` (9175) | GATED-STORE |
| [packages/store/src/store.ts:9209](../../packages/store/src/store.ts#L9209) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (9209) | GATED-STORE |
| [packages/store/src/store.ts:9231](../../packages/store/src/store.ts#L9231) `Store/evaluateRowsCurrent/key` | `Calculations.context` (9231) | GATED-STORE |
| [packages/store/src/store.ts:3365](../../packages/store/src/store.ts#L3365) `Store/externalAccount` | `SQLite.all` (3365); `SQLite.prepare` (3365); `Store.sql` (3365) | CORE |
| [packages/store/src/store.ts:7266](../../packages/store/src/store.ts#L7266) `Store/externalContainerCheck` | `SQLite.all` (7266); `SQLite.prepare` (7266); `Store.sql` (7266) | CORE |
| [packages/store/src/store.ts:7273](../../packages/store/src/store.ts#L7273) `Store/externalContainerCount` | `SQLite.get` (7273); `SQLite.prepare` (7273); `Store.sql` (7273) | CORE |
| [packages/store/src/store.ts:7282](../../packages/store/src/store.ts#L7282) `Store/externalContainerReport` | `SQLite.all` (7282, 7295); `SQLite.prepare` (7282, 7295); `Store.sql` (7282, 7295) | CORE |
| [packages/store/src/store.ts:4633](../../packages/store/src/store.ts#L4633) `Store/externalIdentityId` | `SQLite.get` (4633, 4639); `SQLite.prepare` (4633, 4638, 4639); `Store.sql` (4633, 4638, 4639) | CORE |
| [packages/store/src/store.ts:7514](../../packages/store/src/store.ts#L7514) `Store/externalOf` | `SQLite.get` (7514); `SQLite.prepare` (7514); `Store.sql` (7514) | CORE |
| [packages/store/src/store.ts:2676](../../packages/store/src/store.ts#L2676) `Store/failureAuditRoom` | `SQLite.get` (2676); `SQLite.prepare` (2676); `Store.sql` (2676) | CORE |
| [packages/store/src/store.ts:6926](../../packages/store/src/store.ts#L6926) `Store/fieldIndexCurrent` | `SQLite.iterate` (6926); `SQLite.prepare` (6926, 6931); `Store.sql` (6926, 6931); `SQLite.all` (6931) | GATED-STORE |
| [packages/store/src/store.ts:8148](../../packages/store/src/store.ts#L8148) `Store/find` | `Store.find` (8148) | GATED-STORE |
| [packages/store/src/store.ts:8520](../../packages/store/src/store.ts#L8520) `Store/findCandidates` | `Store.query` (8520) | CORE |
| [packages/store/src/store.ts:8159](../../packages/store/src/store.ts#L8159) `Store/findHere` | `Store.query` (8159, 8164, 8166, 8180, 8182, 8193); `Store.recordCount` (8177); `SQLite.get` (8178, 8182); `SQLite.prepare` (8178, 8182, 8188, 8195, 8204); `Store.sql` (8178, 8182, 8188, 8195, 8204); `SQLite.all` (8188, 8195, 8204) | GATED-STORE |
| [packages/store/src/store.ts:8199](../../packages/store/src/store.ts#L8199) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (8199); `SQLite.prepare` (8199); `Store.sql` (8199) | GATED-STORE |
| [packages/store/src/store.ts:9870](../../packages/store/src/store.ts#L9870) `Store/findIdsCurrent` | `Store.findIds` (9870) | GATED-STORE |
| [packages/store/src/store.ts:9876](../../packages/store/src/store.ts#L9876) `Store/findIdsHere` | `Store.query` (9876, 9881, 9883); `SQLite.iterate` (9894); `SQLite.prepare` (9894); `Store.sql` (9894) | GATED-STORE |
| [packages/store/src/store.ts:8464](../../packages/store/src/store.ts#L8464) `Store/findSource` | `Store.query` (8464); `SQLite.all` (8473, 8490); `SQLite.prepare` (8473, 8481, 8489); `Store.sql` (8473, 8478, 8481, 8486, 8489, 8503, 8505); `Calculations.globalValue` (8495); `Calculations.unstoredValue` (8496); `Calculations.related` (8500) | CORE |
| [packages/store/src/store.ts:9466](../../packages/store/src/store.ts#L9466) `Store/forgetStandInValues` | `Store.sql` (9466, 9487); `SQLite.prepare` (9487) | CORE |
| [packages/store/src/store.ts:4516](../../packages/store/src/store.ts#L4516) `Store/forgetStandIns` | `SQLite.prepare` (4516); `Store.sql` (4516) | CORE |
| [packages/store/src/store.ts:6808](../../packages/store/src/store.ts#L6808) `Store/foundSetPage` | `rowsById` (6808) | CORE |
| [packages/store/src/store.ts:6824](../../packages/store/src/store.ts#L6824) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6824); `Store.row` (6840) | GATED-STORE |
| [packages/store/src/store.ts:3284](../../packages/store/src/store.ts#L3284) `Store/gateAgentWrite` | `SQLite.get` (3284); `SQLite.prepare` (3284, 3286); `Store.sql` (3284, 3286) | CORE |
| [packages/store/src/store.ts:5367](../../packages/store/src/store.ts#L5367) `Store/generateRecoveryCodes` | `SQLite.prepare` (5367, 5370); `Store.sql` (5367, 5370) | CORE |
| [packages/store/src/store.ts:8592](../../packages/store/src/store.ts#L8592) `Store/getCurrent` | `Store.get` (8592); `Store.row` (8593, 8593, 8607); `SQLite.all` (8610); `SQLite.prepare` (8610); `Store.sql` (8610) | GATED-STORE |
| [packages/store/src/store.ts:8630](../../packages/store/src/store.ts#L8630) `Store/getManyCurrent` | `Store.getMany` (8630); `SQLite.get` (8648); `SQLite.prepare` (8648); `Store.sql` (8648) | GATED-STORE |
| [packages/store/src/store.ts:8641](../../packages/store/src/store.ts#L8641) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8641) | GATED-STORE |
| [packages/store/src/store.ts:1287](../../packages/store/src/store.ts#L1287) `Store/grantFullAccessClients` | `SQLite.prepare` (1287); `Store.sql` (1287) | CORE |
| [packages/store/src/store.ts:9911](../../packages/store/src/store.ts#L9911) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9911); `Store.viewableIds` (9916); `Calculations.collect` (9932); `rowsById` (9932, 9982); `Calculations.collector` (9954) | GATED-STORE |
| [packages/store/src/store.ts:9980](../../packages/store/src/store.ts#L9980) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9980) | GATED-STORE |
| [packages/store/src/store.ts:9944](../../packages/store/src/store.ts#L9944) `Store/groupSummariesCurrent/key` | `Calculations.value` (9944); `Calculations.related` (9946) | GATED-STORE |
| [packages/store/src/store.ts:1295](../../packages/store/src/store.ts#L1295) `Store/hasOwnPassword` | `SQLite.get` (1295); `SQLite.prepare` (1295); `Store.sql` (1295) | CORE |
| [packages/store/src/store.ts:5231](../../packages/store/src/store.ts#L5231) `Store/hasPasskey` | `SQLite.get` (5231); `SQLite.prepare` (5231); `Store.sql` (5231) | CORE |
| [packages/store/src/store.ts:8067](../../packages/store/src/store.ts#L8067) `Store/hasTable` | `SQLite.get` (8067); `SQLite.prepare` (8067); `Store.sql` (8067) | CORE |
| [packages/store/src/store.ts:5095](../../packages/store/src/store.ts#L5095) `Store/hasTotp` | `SQLite.get` (5095); `SQLite.prepare` (5095); `Store.sql` (5095) | CORE |
| [packages/store/src/store.ts:4612](../../packages/store/src/store.ts#L4612) `Store/identityAllowed` | `SQLite.get` (4612, 4618, 4624); `SQLite.prepare` (4612, 4618, 4624); `Store.sql` (4612, 4618, 4624) | CORE |
| [packages/store/src/store.ts:6283](../../packages/store/src/store.ts#L6283) `Store/image` | `SQLite.get` (6283); `SQLite.prepare` (6283); `Store.sql` (6283) | CORE |
| [packages/store/src/store.ts:6293](../../packages/store/src/store.ts#L6293) `Store/images` | `SQLite.all` (6293); `SQLite.prepare` (6293); `Store.sql` (6293) | CORE |
| [packages/store/src/store.ts:4360](../../packages/store/src/store.ts#L4360) `Store/importAccounts` | `SQLite.all` (4360); `SQLite.prepare` (4360); `Store.sql` (4360) | CORE |
| [packages/store/src/store.ts:1536](../../packages/store/src/store.ts#L1536) `Store/independentWindowWrite` | `SQLite.get` (1536); `SQLite.prepare` (1536, 1566); `Store.sql` (1536, 1545, 1561, 1566, 1569) | CORE |
| [packages/store/src/store.ts:8079](../../packages/store/src/store.ts#L8079) `Store/indexedFields` | `SQLite.all` (8079, 8080); `SQLite.prepare` (8079, 8080); `Store.sql` (8079, 8080) | CORE |
| [packages/store/src/store.ts:10278](../../packages/store/src/store.ts#L10278) `Store/internalRoots` | `SQLite.get` (10278); `SQLite.prepare` (10278, 10280); `SQLite.all` (10280) | CORE |
| [packages/store/src/store.ts:3120](../../packages/store/src/store.ts#L3120) `Store/isAgent` | `SQLite.get` (3120); `SQLite.prepare` (3120); `Store.sql` (3120) | CORE |
| [packages/store/src/store.ts:3223](../../packages/store/src/store.ts#L3223) `Store/isExternal` | `SQLite.get` (3223); `SQLite.prepare` (3223); `Store.sql` (3223) | CORE |
| [packages/store/src/store.ts:5148](../../packages/store/src/store.ts#L5148) `Store/issueWebauthnChallenge` | `SQLite.prepare` (5148, 5150, 5151, 5153); `Store.sql` (5148, 5150, 5151, 5153); `SQLite.get` (5150) | CORE |
| [packages/store/src/store.ts:10185](../../packages/store/src/store.ts#L10185) `Store/iterateCommitted` | `SQLite.iterate` (10185) | CORE |
| [packages/store/src/store.ts:1513](../../packages/store/src/store.ts#L1513) `Store/joinTransaction` | `Store.sql` (1513, 1514, 1516, 1518, 1524) | CORE |
| [packages/store/src/store.ts:9668](../../packages/store/src/store.ts#L9668) `Store/keyStepWork` | `Store.sql` (9668, 9674, 9678, 9680) | CORE |
| [packages/store/src/store.ts:6199](../../packages/store/src/store.ts#L6199) `Store/knownSharedAccount` | `SQLite.get` (6199); `SQLite.prepare` (6199); `Store.sql` (6199) | CORE |
| [packages/store/src/store.ts:3833](../../packages/store/src/store.ts#L3833) `Store/lastSignIns` | `Store.auditLog` (3833) | CORE |
| [packages/store/src/store.ts:6323](../../packages/store/src/store.ts#L6323) `Store/layout` | `SQLite.get` (6323); `SQLite.prepare` (6323); `Store.sql` (6323) | CORE |
| [packages/store/src/store.ts:2801](../../packages/store/src/store.ts#L2801) `Store/layoutHistory` | `SQLite.all` (2801); `SQLite.prepare` (2801); `Store.sql` (2801) | CORE |
| [packages/store/src/store.ts:6262](../../packages/store/src/store.ts#L6262) `Store/layouts` | `SQLite.all` (6262); `SQLite.prepare` (6262); `Store.sql` (6262) | CORE |
| [packages/store/src/store.ts:4133](../../packages/store/src/store.ts#L4133) `Store/leastPrivilege` | `SQLite.all` (4133); `SQLite.prepare` (4133); `Store.sql` (4133) | CORE |
| [packages/store/src/store.ts:4696](../../packages/store/src/store.ts#L4696) `Store/ledgerRow` | `SQLite.get` (4696, 4697); `SQLite.prepare` (4696, 4697); `Store.sql` (4696, 4697) | AUTH |
| [packages/store/src/store.ts:4708](../../packages/store/src/store.ts#L4708) `Store/ledgerWrite` | `Store.sql` (4708, 4709, 4711, 4713, 4716, 4716) | AUTH |
| [packages/store/src/store.ts:4443](../../packages/store/src/store.ts#L4443) `Store/limitAccountImport` | `SQLite.prepare` (4443, 4444, 4447); `Store.sql` (4443, 4444, 4447); `SQLite.get` (4444) | CORE |
| [packages/store/src/store.ts:3073](../../packages/store/src/store.ts#L3073) `Store/linkIdentity` | `SQLite.get` (3073); `SQLite.prepare` (3073); `Store.sql` (3073) | CORE |
| [packages/store/src/store.ts:3065](../../packages/store/src/store.ts#L3065) `Store/linkPrincipal` | `SQLite.get` (3065); `SQLite.prepare` (3065); `Store.sql` (3065) | CORE |
| [packages/store/src/store.ts:2702](../../packages/store/src/store.ts#L2702) `Store/logSecurity` | `Store.sql` (2702) | CORE |
| [packages/store/src/store.ts:3719](../../packages/store/src/store.ts#L3719) `Store/markPiiField` | `SQLite.prepare` (3719); `Store.sql` (3719) | CORE |
| [packages/store/src/store.ts:7239](../../packages/store/src/store.ts#L7239) `Store/markRepeating` | `SQLite.prepare` (7239); `Store.sql` (7239) | CORE |
| [packages/store/src/store.ts:10118](../../packages/store/src/store.ts#L10118) `Store/matchIds` | `Store.matchIds` (10118); `SQLite.all` (10124); `SQLite.prepare` (10124); `Store.sql` (10124) | CORE |
| [packages/store/src/store.ts:1310](../../packages/store/src/store.ts#L1310) `Store/meta` | `SQLite.get` (1310); `SQLite.prepare` (1310); `Store.sql` (1310) | CORE |
| [packages/store/src/store.ts:923](../../packages/store/src/store.ts#L923) `Store/metadataVersions` | `SQLite.get` (923); `SQLite.prepare` (923); `Store.sql` (923) | CORE |
| [packages/store/src/store.ts:7876](../../packages/store/src/store.ts#L7876) `Store/moveContainersIn` | `Store.sql` (7876, 7882, 7884, 7885, 7886, 7887, 7907, 7912, 7912, 7923, 7926, 7929, 7936); `SQLite.prepare` (7884, 7885, 7886, 7887, 7923, 7929); `SQLite.get` (7889, 7923, 7929) | CORE |
| [packages/store/src/store.ts:7798](../../packages/store/src/store.ts#L7798) `Store/moveContainersOut` | `Store.sql` (7798, 7806, 7808, 7810, 7815, 7816, 7836, 7842, 7844, 7846, 7846, 7852, 7852, 7857, 7859, 7861, 7861, 7867); `SQLite.get` (7806); `SQLite.prepare` (7806, 7815, 7816); `Store.container` (7818) | CORE |
| [packages/store/src/store.ts:4314](../../packages/store/src/store.ts#L4314) `Store/mustChangePassword` | `SQLite.get` (4314); `SQLite.prepare` (4314); `Store.sql` (4314) | CORE |
| [packages/store/src/store.ts:1265](../../packages/store/src/store.ts#L1265) `Store/nativeIdGuards` | `Store.sql` (1265, 1266, 1268) | CORE |
| [packages/store/src/store.ts:4975](../../packages/store/src/store.ts#L4975) `Store/objectUseSince` | `SQLite.get` (4975); `SQLite.prepare` (4975); `Store.sql` (4975) | CORE |
| [packages/store/src/store.ts:8039](../../packages/store/src/store.ts#L8039) `Store/orderBy` | `Store.valueListItems` (8039) | CORE |
| [packages/store/src/store.ts:7431](../../packages/store/src/store.ts#L7431) `Store/orphanContainerReport` | `SQLite.all` (7431); `SQLite.prepare` (7431); `Store.sql` (7431) | CORE |
| [packages/store/src/store.ts:5200](../../packages/store/src/store.ts#L5200) `Store/passkeyAllowList` | `SQLite.all` (5200); `SQLite.prepare` (5200); `Store.sql` (5200) | CORE |
| [packages/store/src/store.ts:5236](../../packages/store/src/store.ts#L5236) `Store/passkeyIds` | `SQLite.all` (5236); `SQLite.prepare` (5236); `Store.sql` (5236) | CORE |
| [packages/store/src/store.ts:5224](../../packages/store/src/store.ts#L5224) `Store/passkeys` | `SQLite.all` (5224); `SQLite.prepare` (5224); `Store.sql` (5224) | CORE |
| [packages/store/src/store.ts:4353](../../packages/store/src/store.ts#L4353) `Store/passwordDaysRemaining` | `SQLite.get` (4353); `SQLite.prepare` (4353); `Store.sql` (4353) | CORE |
| [packages/store/src/store.ts:6157](../../packages/store/src/store.ts#L6157) `Store/passwordHash` | `SQLite.get` (6157); `SQLite.prepare` (6157); `Store.sql` (6157) | CORE |
| [packages/store/src/store.ts:3308](../../packages/store/src/store.ts#L3308) `Store/pendingChanges` | `SQLite.all` (3308); `SQLite.prepare` (3308); `Store.sql` (3308) | CORE |
| [packages/store/src/store.ts:1328](../../packages/store/src/store.ts#L1328) `Store/persistentData` | `SQLite.get` (1328) | CORE |
| [packages/store/src/store.ts:1337](../../packages/store/src/store.ts#L1337) `Store/persistentDataIds` | `SQLite.all` (1337) | CORE |
| [packages/store/src/store.ts:1318](../../packages/store/src/store.ts#L1318) `Store/persistentTable` | `Store.sql` (1318) | CORE |
| [packages/store/src/store.ts:9379](../../packages/store/src/store.ts#L9379) `Store/portalContainerTarget` | `Store.row` (9379); `relatedIdList` (9381) | CORE |
| [packages/store/src/store.ts:6863](../../packages/store/src/store.ts#L6863) `Store/portalCountsCurrent` | `Store.canView` (6863); `Store.row` (6890) | GATED-STORE |
| [packages/store/src/store.ts:7101](../../packages/store/src/store.ts#L7101) `Store/portalRows` | `relatedRows` (7101); `relatedIdList` (7102); `Store.viewableIds` (7105); `rowsById` (7130, 7168); `Calculations.related` (7144) | CORE |
| [packages/store/src/store.ts:7112](../../packages/store/src/store.ts#L7112) `Store/portalRows/context` | `Calculations.context` (7112) | CORE |
| [packages/store/src/store.ts:7122](../../packages/store/src/store.ts#L7122) `Store/portalRows/valueOf` | `Calculations.value` (7122) | CORE |
| [packages/store/src/store.ts:2236](../../packages/store/src/store.ts#L2236) `Store/prepared` | `SQLite.prepare` (2236); `Store.sql` (2236) | CORE |
| [packages/store/src/store.ts:4425](../../packages/store/src/store.ts#L4425) `Store/previewAccountImport` | `Store.sql` (4425, 4426, 4435) | CORE |
| [packages/store/src/store.ts:5980](../../packages/store/src/store.ts#L5980) `Store/previewRecordRuleCurrent` | `SQLite.get` (5980); `SQLite.prepare` (5980, 5983); `Store.sql` (5980, 5983); `SQLite.all` (5983); `Calculations.context` (5989, 6005) | CORE |
| [packages/store/src/store.ts:8555](../../packages/store/src/store.ts#L8555) `Store/previewRow` | `Store.row` (8555) | CORE |
| [packages/store/src/store.ts:5442](../../packages/store/src/store.ts#L5442) `Store/privilegeSets` | `Store.sql` (5442) | CORE |
| [packages/store/src/store.ts:2446](../../packages/store/src/store.ts#L2446) `Store/pruneAudit` | `Store.sql` (2446, 2448, 2450); `SQLite.get` (2448); `SQLite.prepare` (2448) | CORE |
| [packages/store/src/store.ts:7466](../../packages/store/src/store.ts#L7466) `Store/purgeOrphanContainers` | `Store.sql` (7466, 7470, 7479, 7482, 7483, 7488, 7489, 7491, 7491); `Store.orphanContainerReport` (7474); `SQLite.get` (7479); `SQLite.prepare` (7479, 7482, 7483) | CORE |
| [packages/store/src/store.ts:10377](../../packages/store/src/store.ts#L10377) `Store/query` | `SQLite.iterate` (10377) | CORE |
| [packages/store/src/store.ts:10411](../../packages/store/src/store.ts#L10411) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10411); `SQLite.all` (10418, 10421); `SQLite.prepare` (10418, 10421) | CORE |
| [packages/store/src/store.ts:10219](../../packages/store/src/store.ts#L10219) `Store/readOnlyChecked` | `SQLite.prepare` (10219, 10223, 10232, 10237); `SQLite.all` (10223, 10232, 10237) | CORE |
| [packages/store/src/store.ts:3045](../../packages/store/src/store.ts#L3045) `Store/recompute` | `SQLite.prepare` (3045, 3049); `Store.sql` (3045, 3049); `SQLite.iterate` (3049); `Calculations.computeStoredStyled` (3050); `Calculations.value` (3050) | CORE |
| [packages/store/src/store.ts:2251](../../packages/store/src/store.ts#L2251) `Store/recordAsOf` | `SQLite.get` (2251, 2253); `SQLite.prepare` (2251, 2253, 2255, 2256); `Store.sql` (2251, 2253, 2255, 2256); `SQLite.all` (2255, 2256) | CORE |
| [packages/store/src/store.ts:1957](../../packages/store/src/store.ts#L1957) `Store/recordCount` | `SQLite.get` (1957); `SQLite.prepare` (1957); `Store.sql` (1957) | CORE |
| [packages/store/src/store.ts:4906](../../packages/store/src/store.ts#L4906) `Store/recordObjectUse` | `Store.sql` (4906) | CORE |
| [packages/store/src/store.ts:9081](../../packages/store/src/store.ts#L9081) `Store/recordViewable` | `Store.row` (9081) | GATED-STORE |
| [packages/store/src/store.ts:1375](../../packages/store/src/store.ts#L1375) `Store/recordedFormat` | `Store.sql` (1375) | CORE |
| [packages/store/src/store.ts:7770](../../packages/store/src/store.ts#L7770) `Store/recoverContainersOut` | `SQLite.prepare` (7770); `Store.sql` (7770); `SQLite.get` (7773) | CORE |
| [packages/store/src/store.ts:1451](../../packages/store/src/store.ts#L1451) `Store/recoverPendingExternalFiles` | `Store.sql` (1451, 1453, 1477, 1479); `SQLite.prepare` (1453); `SQLite.get` (1464) | CORE |
| [packages/store/src/store.ts:5385](../../packages/store/src/store.ts#L5385) `Store/recoveryCodesRemaining` | `SQLite.get` (5385); `SQLite.prepare` (5385); `Store.sql` (5385) | CORE |
| [packages/store/src/store.ts:10259](../../packages/store/src/store.ts#L10259) `Store/refreshDecimalSqlViews` | `SQLite.get` (10259); `SQLite.prepare` (10259, 10264); `SQLite.all` (10264) | CORE |
| [packages/store/src/store.ts:3214](../../packages/store/src/store.ts#L3214) `Store/refuseLookalikeAccount` | `SQLite.all` (3214); `SQLite.prepare` (3214); `Store.sql` (3214) | CORE |
| [packages/store/src/store.ts:5258](../../packages/store/src/store.ts#L5258) `Store/registerPasskey` | `SQLite.prepare` (5258); `Store.sql` (5258) | CORE |
| [packages/store/src/store.ts:3343](../../packages/store/src/store.ts#L3343) `Store/rejectPending` | `SQLite.get` (3343); `SQLite.prepare` (3343, 3345); `Store.sql` (3343, 3345) | CORE |
| [packages/store/src/store.ts:8307](../../packages/store/src/store.ts#L8307) `Store/relatedCriteria` | `SQLite.iterate` (8307); `SQLite.prepare` (8307); `Store.sql` (8307) | CORE |
| [packages/store/src/store.ts:8304](../../packages/store/src/store.ts#L8304) `Store/relatedCriteria/matched` | `relatedRows` (8304) | CORE |
| [packages/store/src/store.ts:6651](../../packages/store/src/store.ts#L6651) `Store/relatedValues` | `Calculations.globalValue` (6651); `Calculations.unstoredValue` (6653) | CORE |
| [packages/store/src/store.ts:5269](../../packages/store/src/store.ts#L5269) `Store/removePasskey` | `SQLite.get` (5269); `SQLite.prepare` (5269, 5270); `Store.sql` (5269, 5270) | CORE |
| [packages/store/src/store.ts:9506](../../packages/store/src/store.ts#L9506) `Store/restoreDeletedRowLocked` | `SQLite.get` (9506, 9511); `SQLite.prepare` (9506, 9507, 9511, 9521); `Store.sql` (9506, 9507, 9511, 9521); `SQLite.all` (9507) | CORE |
| [packages/store/src/store.ts:2286](../../packages/store/src/store.ts#L2286) `Store/restoreRecord` | `Store.recordAsOf` (2286); `SQLite.get` (2290); `SQLite.prepare` (2290, 2294, 2303, 2314); `Store.sql` (2290, 2294, 2303, 2314) | CORE |
| [packages/store/src/store.ts:2329](../../packages/store/src/store.ts#L2329) `Store/revertAuditEntry` | `Store.auditLog` (2329) | CORE |
| [packages/store/src/store.ts:5031](../../packages/store/src/store.ts#L5031) `Store/revokeApiToken` | `SQLite.prepare` (5031); `Store.sql` (5031) | CORE |
| [packages/store/src/store.ts:8573](../../packages/store/src/store.ts#L8573) `Store/row` | `SQLite.get` (8573) | CORE |
| [packages/store/src/store.ts:5806](../../packages/store/src/store.ts#L5806) `Store/ruleOutcome` | `Calculations.context` (5806) | CORE |
| [packages/store/src/store.ts:8418](../../packages/store/src/store.ts#L8418) `Store/runningSummaryValues` | `Store.viewableIds` (8418); `rowsById` (8420); `Calculations.value` (8431, 8437); `Calculations.related` (8448) | GATED-STORE |
| [packages/store/src/store.ts:5471](../../packages/store/src/store.ts#L5471) `Store/savePrivilegeSet` | `SQLite.prepare` (5471, 5479); `Store.sql` (5471, 5479) | AUTH |
| [packages/store/src/store.ts:3550](../../packages/store/src/store.ts#L3550) `Store/saveScriptTest` | `SQLite.prepare` (3550); `Store.sql` (3550) | CORE |
| [packages/store/src/store.ts:5945](../../packages/store/src/store.ts#L5945) `Store/scopedTableSql` | `Store.viewableIds` (5945); `SQLite.all` (5948); `SQLite.prepare` (5948); `Store.sql` (5948) | GATED-STORE |
| [packages/store/src/store.ts:2791](../../packages/store/src/store.ts#L2791) `Store/scriptHistory` | `SQLite.all` (2791); `SQLite.prepare` (2791); `Store.sql` (2791) | CORE |
| [packages/store/src/store.ts:2621](../../packages/store/src/store.ts#L2621) `Store/securityChange` | `Store.sql` (2621, 2623); `SQLite.prepare` (2623) | CORE |
| [packages/store/src/store.ts:2210](../../packages/store/src/store.ts#L2210) `Store/securityEvents` | `Store.auditLog` (2210) | CORE |
| [packages/store/src/store.ts:4764](../../packages/store/src/store.ts#L4764) `Store/securityToken` | `SQLite.get` (4764); `SQLite.prepare` (4764); `Store.sql` (4764) | CORE |
| [packages/store/src/store.ts:10313](../../packages/store/src/store.ts#L10313) `Store/selectCurrent` | `SQLite.iterate` (10313) | CORE |
| [packages/store/src/store.ts:10337](../../packages/store/src/store.ts#L10337) `Store/selectHeldCurrent` | `Store.sql` (10337, 10338); `SQLite.prepare` (10338); `SQLite.iterate` (10341) | CORE |
| [packages/store/src/store.ts:9811](../../packages/store/src/store.ts#L9811) `Store/selectIdsCurrent` | `Store.selectIds` (9811); `SQLite.all` (9817); `SQLite.prepare` (9817); `Store.sql` (9817) | GATED-STORE |
| [packages/store/src/store.ts:10329](../../packages/store/src/store.ts#L10329) `Store/selectIn` | `Store.select` (10329) | CORE |
| [packages/store/src/store.ts:1717](../../packages/store/src/store.ts#L1717) `Store/selfContainedCopy` | `Store.sql` (1717); `SQLite.all` (1722); `SQLite.prepare` (1722, 1724, 1725, 1726) | CORE |
| [packages/store/src/store.ts:4593](../../packages/store/src/store.ts#L4593) `Store/setAccountActive` | `SQLite.prepare` (4593, 4596, 4597); `Store.sql` (4593, 4596, 4597) | AUTH |
| [packages/store/src/store.ts:4783](../../packages/store/src/store.ts#L4783) `Store/setAccountLocalOnly` | `SQLite.prepare` (4783); `Store.sql` (4783) | CORE |
| [packages/store/src/store.ts:5597](../../packages/store/src/store.ts#L5597) `Store/setAccountPrivilegeSet` | `SQLite.get` (5597); `SQLite.prepare` (5597, 5600, 5604); `Store.sql` (5597, 5600, 5604) | AUTH |
| [packages/store/src/store.ts:4792](../../packages/store/src/store.ts#L4792) `Store/setAccountRequire2fa` | `SQLite.prepare` (4792); `Store.sql` (4792) | CORE |
| [packages/store/src/store.ts:3244](../../packages/store/src/store.ts#L3244) `Store/setAgentAccount` | `SQLite.get` (3244); `SQLite.prepare` (3244, 3250); `Store.sql` (3244, 3250) | CORE |
| [packages/store/src/store.ts:3594](../../packages/store/src/store.ts#L3594) `Store/setAiAllowed` | `SQLite.prepare` (3594); `Store.sql` (3594) | CORE |
| [packages/store/src/store.ts:3677](../../packages/store/src/store.ts#L3677) `Store/setAiPolicy` | `SQLite.prepare` (3677); `Store.sql` (3677) | CORE |
| [packages/store/src/store.ts:6186](../../packages/store/src/store.ts#L6186) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (6186); `Store.sql` (6186) | CORE |
| [packages/store/src/store.ts:2424](../../packages/store/src/store.ts#L2424) `Store/setAuditSettings` | `SQLite.prepare` (2424); `Store.sql` (2424) | CORE |
| [packages/store/src/store.ts:7989](../../packages/store/src/store.ts#L7989) `Store/setContainer` | `Store.sql` (7989, 8006); `Store.row` (7995); `SQLite.prepare` (8006) | CORE |
| [packages/store/src/store.ts:3196](../../packages/store/src/store.ts#L3196) `Store/setExternalAccount` | `SQLite.get` (3196); `SQLite.prepare` (3196, 3201); `Store.sql` (3196, 3201) | CORE |
| [packages/store/src/store.ts:4300](../../packages/store/src/store.ts#L4300) `Store/setMustChangePassword` | `SQLite.prepare` (4300); `Store.sql` (4300) | CORE |
| [packages/store/src/store.ts:3396](../../packages/store/src/store.ts#L3396) `Store/setPassword` | `SQLite.get` (3396); `SQLite.prepare` (3396, 3398, 3407); `Store.sql` (3396, 3398, 3407) | AUTH |
| [packages/store/src/store.ts:3491](../../packages/store/src/store.ts#L3491) `Store/setPasswordPolicy` | `SQLite.prepare` (3491); `Store.sql` (3491) | CORE |
| [packages/store/src/store.ts:1343](../../packages/store/src/store.ts#L1343) `Store/setPersistentData` | `SQLite.prepare` (1343, 1347); `Store.sql` (1343, 1347) | CORE |
| [packages/store/src/store.ts:3697](../../packages/store/src/store.ts#L3697) `Store/setPiiIsolation` | `SQLite.prepare` (3697); `Store.sql` (3697) | CORE |
| [packages/store/src/store.ts:3527](../../packages/store/src/store.ts#L3527) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3527); `Store.sql` (3527) | CORE |
| [packages/store/src/store.ts:3609](../../packages/store/src/store.ts#L3609) `Store/setScriptNetwork` | `SQLite.prepare` (3609); `Store.sql` (3609) | CORE |
| [packages/store/src/store.ts:3666](../../packages/store/src/store.ts#L3666) `Store/setSqlRequiresFmxdbc` | `SQLite.prepare` (3666); `Store.sql` (3666) | CORE |
| [packages/store/src/store.ts:9002](../../packages/store/src/store.ts#L9002) `Store/setStoredCalcValues` | `SQLite.prepare` (9002, 9003); `Store.sql` (9002, 9003); `SQLite.get` (9007) | CORE |
| [packages/store/src/store.ts:8071](../../packages/store/src/store.ts#L8071) `Store/setUserPref` | `Store.sql` (8071, 8072, 8073); `SQLite.prepare` (8072, 8073) | CORE |
| [packages/store/src/store.ts:3650](../../packages/store/src/store.ts#L3650) `Store/setWebViewerHosts` | `SQLite.prepare` (3650); `Store.sql` (3650) | CORE |
| [packages/store/src/store.ts:4735](../../packages/store/src/store.ts#L4735) `Store/settleSignIns` | `SQLite.all` (4735, 4741); `SQLite.prepare` (4735, 4741, 4747, 4751, 4753); `Store.sql` (4735, 4741, 4747, 4751, 4753) | AUTH |
| [packages/store/src/store.ts:1848](../../packages/store/src/store.ts#L1848) `Store/shareResults` | `Store.sql` (1848) | CORE |
| [packages/store/src/store.ts:1401](../../packages/store/src/store.ts#L1401) `Store/shipWal` | `Store.sql` (1401) | CORE |
| [packages/store/src/store.ts:4682](../../packages/store/src/store.ts#L4682) `Store/signInBase` | `SQLite.get` (4682); `SQLite.prepare` (4682); `Store.sql` (4682) | AUTH |
| [packages/store/src/store.ts:4684](../../packages/store/src/store.ts#L4684) `Store/signInBase/identity` | `SQLite.get` (4684); `SQLite.prepare` (4684); `Store.sql` (4684) | AUTH |
| [packages/store/src/store.ts:4672](../../packages/store/src/store.ts#L4672) `Store/signInMark` | `SQLite.prepare` (4672); `Store.sql` (4672) | AUTH |
| [packages/store/src/store.ts:10036](../../packages/store/src/store.ts#L10036) `Store/sortIdsCurrentProgress` | `SQLite.all` (10036); `SQLite.prepare` (10036, 10104); `Store.sql` (10036, 10104); `Store.valueListItems` (10044); `rowsById` (10056); `Calculations.globalValue` (10059); `Calculations.unstoredValue` (10060); `Calculations.related` (10066); `SQLite.iterate` (10104) | GATED-STORE |
| [packages/store/src/store.ts:8232](../../packages/store/src/store.ts#L8232) `Store/sortedPage` | `SQLite.iterate` (8232); `SQLite.prepare` (8232, 8247); `Store.sql` (8232, 8247); `SQLite.all` (8247) | CORE |
| [packages/store/src/store.ts:8380](../../packages/store/src/store.ts#L8380) `Store/summaries` | `Calculations.wholeTable` (8380); `Calculations.collect` (8400, 8405) | CORE |
| [packages/store/src/store.ts:8396](../../packages/store/src/store.ts#L8396) `Store/summaries/recs` | `SQLite.iterate` (8396); `SQLite.prepare` (8396); `Store.sql` (8396) | CORE |
| [packages/store/src/store.ts:5214](../../packages/store/src/store.ts#L5214) `Store/takeWebauthnChallenge` | `SQLite.get` (5214); `SQLite.prepare` (5214, 5216); `Store.sql` (5214, 5216) | CORE |
| [packages/store/src/store.ts:8124](../../packages/store/src/store.ts#L8124) `Store/timeFind` | `Store.query` (8124, 8128, 8129); `Store.recordCount` (8131) | CORE |
| [packages/store/src/store.ts:6592](../../packages/store/src/store.ts#L6592) `Store/toRecord` | `Calculations.value` (6592, 6602); `Calculations.globalValue` (6596); `Calculations.unstoredStyled` (6601) | CORE |
| [packages/store/src/store.ts:5100](../../packages/store/src/store.ts#L5100) `Store/totpAccounts` | `SQLite.all` (5100); `SQLite.prepare` (5100); `Store.sql` (5100) | CORE |
| [packages/store/src/store.ts:1412](../../packages/store/src/store.ts#L1412) `Store/trial` | `Store.sql` (1412) | CORE |
| [packages/store/src/store.ts:1417](../../packages/store/src/store.ts#L1417) `Store/trial/undo` | `Store.sql` (1417) | CORE |
| [packages/store/src/store.ts:10146](../../packages/store/src/store.ts#L10146) `Store/truncate/run` | `Store.sql` (10146, 10148, 10155, 10157, 10159, 10160); `SQLite.prepare` (10148, 10155); `SQLite.all` (10150) | CORE |
| [packages/store/src/store.ts:3143](../../packages/store/src/store.ts#L3143) `Store/unmigratedAccounts` | `SQLite.all` (3143); `SQLite.prepare` (3143); `Store.sql` (3143) | CORE |
| [packages/store/src/store.ts:4206](../../packages/store/src/store.ts#L4206) `Store/unusedAccess` | `SQLite.get` (4206); `SQLite.prepare` (4206, 4215); `Store.sql` (4206, 4215); `SQLite.all` (4215) | CORE |
| [packages/store/src/store.ts:4254](../../packages/store/src/store.ts#L4254) `Store/unusedObjects` | `SQLite.get` (4254); `SQLite.prepare` (4254, 4257); `Store.sql` (4254, 4257); `SQLite.all` (4257) | CORE |
| [packages/store/src/store.ts:5326](../../packages/store/src/store.ts#L5326) `Store/unusedRecoveryHashes` | `SQLite.all` (5326); `SQLite.prepare` (5326); `Store.sql` (5326) | CORE |
| [packages/store/src/store.ts:4036](../../packages/store/src/store.ts#L4036) `Store/unusualAccess` | `Store.auditLog` (4036, 4102) | CORE |
| [packages/store/src/store.ts:8824](../../packages/store/src/store.ts#L8824) `Store/update` | `Store.row` (8824); `Store.sql` (8854, 8855, 8894, 8897) | CORE |
| [packages/store/src/store.ts:8857](../../packages/store/src/store.ts#L8857) `Store/update/undo` | `Store.sql` (8857) | CORE |
| [packages/store/src/store.ts:9287](../../packages/store/src/store.ts#L9287) `Store/updatePortals` | `Store.row` (9287, 9323); `relatedRows` (9324) | CORE |
| [packages/store/src/store.ts:9297](../../packages/store/src/store.ts#L9297) `Store/updatePortals/portal/related` | `relatedIdList` (9297) | CORE |
| [packages/store/src/store.ts:9269](../../packages/store/src/store.ts#L9269) `Store/updateRelated` | `relatedRows` (9269) | CORE |
| [packages/store/src/store.ts:4292](../../packages/store/src/store.ts#L4292) `Store/usageCounting` | `SQLite.get` (4292); `SQLite.prepare` (4292); `Store.sql` (4292) | CORE |
| [packages/store/src/store.ts:8062](../../packages/store/src/store.ts#L8062) `Store/userPrefs` | `SQLite.all` (8062); `SQLite.prepare` (8062); `Store.sql` (8062) | CORE |
| [packages/store/src/store.ts:6972](../../packages/store/src/store.ts#L6972) `Store/valueListItemsCurrent` | `Store.valueListItems` (6972); `Store.get` (6986); `relatedRows` (6987); `Store.row` (6987); `SQLite.iterate` (6989); `SQLite.prepare` (6989); `Store.sql` (6989); `Calculations.related` (6999); `Calculations.value` (7003, 7004) | GATED-STORE |
| [packages/store/src/store.ts:9459](../../packages/store/src/store.ts#L9459) `Store/vaultHeld` | `SQLite.get` (9459); `SQLite.prepare` (9459); `Store.sql` (9459) | CORE |
| [packages/store/src/store.ts:5286](../../packages/store/src/store.ts#L5286) `Store/verifyPasskeyAssertion` | `SQLite.get` (5286); `SQLite.prepare` (5286, 5297); `Store.sql` (5286, 5297) | CORE |
| [packages/store/src/store.ts:5129](../../packages/store/src/store.ts#L5129) `Store/verifyTotp` | `SQLite.get` (5129); `SQLite.prepare` (5129, 5135); `Store.sql` (5129, 5135) | CORE |
| [packages/store/src/store.ts:1890](../../packages/store/src/store.ts#L1890) `Store/versionNumber` | `SQLite.get` (1890); `SQLite.prepare` (1890); `Store.sql` (1890) | CORE |
| [packages/store/src/store.ts:1858](../../packages/store/src/store.ts#L1858) `Store/versionTriggers` | `SQLite.get` (1858); `SQLite.prepare` (1858, 1863, 1864); `Store.sql` (1858, 1860, 1861, 1863, 1864, 1873, 1874); `SQLite.all` (1863, 1864) | CORE |
| [packages/store/src/store.ts:1827](../../packages/store/src/store.ts#L1827) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1827) | CORE |
| [packages/store/src/store.ts:3632](../../packages/store/src/store.ts#L3632) `Store/webViewerChecked` | `SQLite.get` (3632); `SQLite.prepare` (3632); `Store.sql` (3632) | CORE |
| [packages/store/src/store.ts:1598](../../packages/store/src/store.ts#L1598) `Store/withWriteTransaction` | `Store.sql` (1598, 1609, 1615, 1617, 1617) | CORE |
| [packages/store/src/store.ts:6527](../../packages/store/src/store.ts#L6527) `Store/wordIndex` | `Store.sql` (6527, 6535, 6540); `Store.recordCount` (6539); `SQLite.get` (6540); `SQLite.prepare` (6540) | CORE |
| [packages/store/src/store.ts:7663](../../packages/store/src/store.ts#L7663) `Store/writeExternalFile` | `Store.evaluateEach` (7663); `SQLite.prepare` (7686); `Store.sql` (7686) | CORE |
| [packages/store/src/store.ts:7687](../../packages/store/src/store.ts#L7687) `Store/writeExternalFile/taken` | `SQLite.get` (7687) | CORE |
| [packages/store/src/store.ts:4964](../../packages/store/src/store.ts#L4964) `Store/writeObjectUseRows` | `SQLite.prepare` (4964, 4965, 4970); `Store.sql` (4964, 4965, 4970) | CORE |
| [packages/store/src/store.ts:1945](../../packages/store/src/store.ts#L1945) `Store/writeToken` | `SQLite.get` (1945); `SQLite.prepare` (1945); `Store.sql` (1945) | CORE |
| [packages/store/src/store.ts:4936](../../packages/store/src/store.ts#L4936) `Store/writeUsage` | `Store.sql` (4936, 4937, 4939, 4943, 4945) | CORE |
| [packages/store/src/store.ts:4952](../../packages/store/src/store.ts#L4952) `Store/writeUsageRows` | `SQLite.prepare` (4952, 4953, 4959); `Store.sql` (4952, 4953, 4959) | CORE |
| [packages/store/src/sync-apply.ts:352](../../packages/store/src/sync-apply.ts#L352) `applySyncRun` | `Store.container` (352, 353, 383); `Store.containerInfo` (369); `SQLite.prepare` (464, 730, 762, 786); `Store.sql` (464, 730, 762, 786); `SQLite.get` (762, 786) | OPERATOR |
| [packages/store/src/sync-apply.ts:676](../../packages/store/src/sync-apply.ts#L676) `applySyncRun/containerChanges` | `Store.container` (676) | OPERATOR |
| [packages/store/src/sync-apply.ts:485](../../packages/store/src/sync-apply.ts#L485) `applySyncRun/fail` | `SQLite.get` (485); `SQLite.prepare` (485); `Store.sql` (485) | OPERATOR |
| [packages/store/src/sync-apply.ts:825](../../packages/store/src/sync-apply.ts#L825) `applySyncRun/filesToSend` | `SQLite.all` (825); `SQLite.prepare` (825); `Store.sql` (825); `Store.containerInfo` (836); `Store.container` (841) | OPERATOR |
| [packages/store/src/sync-apply.ts:580](../../packages/store/src/sync-apply.ts#L580) `applySyncRun/pullWouldChange` | `Store.container` (580, 584) | OPERATOR |
| [packages/store/src/sync-apply.ts:185](../../packages/store/src/sync-apply.ts#L185) `atomically` | `Store.sql` (185, 188, 191, 192) | OPERATOR |
| [packages/store/src/sync-apply.ts:216](../../packages/store/src/sync-apply.ts#L216) `clearContainersPending` | `SQLite.prepare` (216); `Store.sql` (216) | OPERATOR |
| [packages/store/src/sync-apply.ts:206](../../packages/store/src/sync-apply.ts#L206) `dropMap` | `SQLite.prepare` (206, 207); `Store.sql` (206, 207) | OPERATOR |
| [packages/store/src/sync-apply.ts:178](../../packages/store/src/sync-apply.ts#L178) `finishRow` | `SQLite.prepare` (178); `Store.sql` (178) | OPERATOR |
| [packages/store/src/sync-apply.ts:242](../../packages/store/src/sync-apply.ts#L242) `heldReason` | `SQLite.get` (242); `SQLite.prepare` (242); `Store.sql` (242) | OPERATOR |
| [packages/store/src/sync-apply.ts:247](../../packages/store/src/sync-apply.ts#L247) `holdTable` | `SQLite.prepare` (247); `Store.sql` (247) | OPERATOR |
| [packages/store/src/sync-apply.ts:171](../../packages/store/src/sync-apply.ts#L171) `logRow` | `SQLite.prepare` (171); `Store.sql` (171) | OPERATOR |
| [packages/store/src/sync-apply.ts:211](../../packages/store/src/sync-apply.ts#L211) `markContainersPending` | `SQLite.prepare` (211); `Store.sql` (211) | OPERATOR |
| [packages/store/src/sync-apply.ts:231](../../packages/store/src/sync-apply.ts#L231) `owedContainers` | `SQLite.all` (231); `SQLite.prepare` (231); `Store.sql` (231) | OPERATOR |
| [packages/store/src/sync-apply.ts:268](../../packages/store/src/sync-apply.ts#L268) `readSyncLog` | `SQLite.get` (268); `SQLite.prepare` (268, 270, 271); `Store.sql` (268, 270, 271); `SQLite.all` (270, 271) | OPERATOR |
| [packages/store/src/sync-apply.ts:312](../../packages/store/src/sync-apply.ts#L312) `recordsIn` | `SQLite.get` (312); `SQLite.prepare` (312); `Store.sql` (312) | OPERATOR |
| [packages/store/src/sync-apply.ts:259](../../packages/store/src/sync-apply.ts#L259) `releaseHeldTables` | `SQLite.prepare` (259); `Store.sql` (259) | OPERATOR |
| [packages/store/src/sync-apply.ts:198](../../packages/store/src/sync-apply.ts#L198) `upsertMap` | `SQLite.prepare` (198); `Store.sql` (198) | OPERATOR |
| [packages/store/src/sync.ts:200](../../packages/store/src/sync.ts#L200) `ensureSyncTables` | `Store.sql` (200, 214, 224, 232) | OPERATOR |
| [packages/store/src/sync.ts:273](../../packages/store/src/sync.ts#L273) `lastPullTimestamp` | `SQLite.get` (273); `SQLite.prepare` (273); `Store.sql` (273) | OPERATOR |
| [packages/store/src/sync.ts:45](../../packages/store/src/sync.ts#L45) `openForPlanning` | `SQLite.get` (45, 46); `SQLite.prepare` (45, 46) | OPERATOR |
| [packages/store/src/sync.ts:292](../../packages/store/src/sync.ts#L292) `readLocalRecords` | `SQLite.all` (292); `SQLite.prepare` (292); `Store.sql` (292) | OPERATOR |
| [packages/store/src/sync.ts:252](../../packages/store/src/sync.ts#L252) `readSyncMap` | `SQLite.all` (252); `SQLite.prepare` (252); `Store.sql` (252) | OPERATOR |
| [packages/store/src/sync.ts:190](../../packages/store/src/sync.ts#L190) `tableExists` | `SQLite.get` (190); `SQLite.prepare` (190); `Store.sql` (190) | OPERATOR |
| [packages/store/src/text-styles.ts:81](../../packages/store/src/text-styles.ts#L81) `TextStyles/has` | `SQLite.all` (81) | CORE |
| [packages/store/src/text-styles.ts:94](../../packages/store/src/text-styles.ts#L94) `TextStyles/rows` | `SQLite.all` (94) | CORE |
| [packages/store/src/text-styles.ts:73](../../packages/store/src/text-styles.ts#L73) `TextStyles/st` | `SQLite.prepare` (73) | CORE |
| [packages/store/src/text-styles.ts:22](../../packages/store/src/text-styles.ts#L22) `ensureTextStyles` | `SQLite.all` (22, 26); `SQLite.prepare` (22, 26) | CORE |
| [packages/store/src/trace.ts:150](../../packages/store/src/trace.ts#L150) `traceDatabase/get` | `SQLite.prepare` (150) | CORE |
| [packages/store/src/words.ts:155](../../packages/store/src/words.ts#L155) `WordIndexes/dropAll` | `SQLite.all` (155); `SQLite.prepare` (155) | CORE |
| [packages/store/src/words.ts:78](../../packages/store/src/words.ts#L78) `WordIndexes/ensure` | `SQLite.prepare` (78, 82); `SQLite.get` (81); `SQLite.all` (82) | CORE |
| [packages/store/src/words.ts:85](../../packages/store/src/words.ts#L85) `WordIndexes/ensure/covers` | `SQLite.get` (85, 89); `SQLite.all` (86); `SQLite.prepare` (86, 89) | CORE |
<!-- end generated read-gate inventory -->
