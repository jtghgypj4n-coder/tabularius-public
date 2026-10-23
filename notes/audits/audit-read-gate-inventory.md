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
| [packages/scripts/src/data-api-step.ts:104](../../packages/scripts/src/data-api-step.ts#L104) `respond` | `Store.get` (104, 131, 140); `Store.find` (105, 117) | SCRIPT |
| [packages/scripts/src/engine.ts:1940](../../packages/scripts/src/engine.ts#L1940) `ScriptEngine/goToLayout` | `Store.findIds` (1940) | SCRIPT |
| [packages/scripts/src/engine.ts:2284](../../packages/scripts/src/engine.ts#L2284) `ScriptEngine/foundSet` | `Store.findIds` (2284) | SCRIPT |
| [packages/scripts/src/engine.ts:2349](../../packages/scripts/src/engine.ts#L2349) `ScriptEngine/semanticFind` | `Store.findIds` (2349, 2370) | SCRIPT |
| [packages/scripts/src/engine.ts:3265](../../packages/scripts/src/engine.ts#L3265) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3265); `Calculations.executeSQL` (3272) | SCRIPT |
| [packages/scripts/src/engine.ts:3322](../../packages/scripts/src/engine.ts#L3322) `ScriptEngine/sortIds` | `Store.sortIds` (3322); `Store.valueListItems` (3328) | SCRIPT |
| [packages/scripts/src/engine.ts:3419](../../packages/scripts/src/engine.ts#L3419) `ScriptEngine/revertTransaction` | `Store.findIds` (3419) | SCRIPT |
| [packages/scripts/src/engine.ts:3969](../../packages/scripts/src/engine.ts#L3969) `ScriptEngine/step` | `Store.fieldIndex` (3969); `Store.findIds` (4103, 4202) | SCRIPT |
| [packages/scripts/src/engine.ts:5230](../../packages/scripts/src/engine.ts#L5230) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5230) | SCRIPT |
| [packages/scripts/src/engine.ts:5238](../../packages/scripts/src/engine.ts#L5238) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5238) | SCRIPT |
| [packages/scripts/src/engine.ts:5239](../../packages/scripts/src/engine.ts#L5239) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5239) | SCRIPT |
| [packages/scripts/src/engine.ts:5392](../../packages/scripts/src/engine.ts#L5392) `ScriptEngine/get` | `Store.findIds` (5392); `Store.canViewRecord` (5483); `Store.get` (5519) | SCRIPT |
| [packages/scripts/src/engine.ts:5550](../../packages/scripts/src/engine.ts#L5550) `ScriptEngine/design` | `Store.valueListItems` (5550) | SCRIPT |
| [packages/scripts/src/engine.ts:5604](../../packages/scripts/src/engine.ts#L5604) `ScriptEngine/record` | `Store.get` (5604) | SCRIPT |
| [packages/scripts/src/engine.ts:5637](../../packages/scripts/src/engine.ts#L5637) `ScriptEngine/valueOf` | `Store.findIds` (5637, 5637); `Store.containerId` (5645) | SCRIPT |
| [packages/scripts/src/engine.ts:5662](../../packages/scripts/src/engine.ts#L5662) `ScriptEngine/lookupNext` | `Store.get` (5662); `Store.row` (5663); `Calculations.context` (5665) | SCRIPT |
| [packages/scripts/src/engine.ts:5765](../../packages/scripts/src/engine.ts#L5765) `ScriptEngine/relatedIds` | `Store.findIds` (5765); `rowsById` (5773); `Store.select` (5777); `Store.matchIds` (5791); `Store.viewableIds` (5814) | SCRIPT |
| [packages/scripts/src/engine.ts:5799](../../packages/scripts/src/engine.ts#L5799) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5799) | SCRIPT |
| [packages/scripts/src/engine.ts:6288](../../packages/scripts/src/engine.ts#L6288) `ScriptEngine/exportField` | `Store.get` (6288); `Store.containerId` (6289); `Store.container` (6291) | SCRIPT |
| [packages/scripts/src/engine.ts:6439](../../packages/scripts/src/engine.ts#L6439) `ScriptEngine/relookup` | `Store.get` (6439) | SCRIPT |
| [packages/scripts/src/engine.ts:6859](../../packages/scripts/src/engine.ts#L6859) `ScriptEngine/goToList` | `Store.findIds` (6859) | SCRIPT |
| [packages/scripts/src/engine.ts:7188](../../packages/scripts/src/engine.ts#L7188) `ScriptEngine/sourceValue` | `Store.get` (7188); `Store.containerId` (7189); `Store.container` (7190) | SCRIPT |
| [packages/scripts/src/engine.ts:7923](../../packages/scripts/src/engine.ts#L7923) `ScriptEngine/containerFile` | `Store.get` (7923); `Store.containerId` (7924); `Store.container` (7925) | SCRIPT |
| [packages/scripts/src/engine.ts:8085](../../packages/scripts/src/engine.ts#L8085) `ScriptEngine/importRecords` | `Store.findIds` (8085); `Store.get` (8105) | SCRIPT |
| [packages/scripts/src/engine.ts:8316](../../packages/scripts/src/engine.ts#L8316) `ScriptEngine/fileMakerRows` | `Store.findIds` (8316); `Store.get` (8321) | SCRIPT |
| [packages/scripts/src/engine.ts:8356](../../packages/scripts/src/engine.ts#L8356) `ScriptEngine/newRecord` | `Store.findIds` (8356) | SCRIPT |
| [packages/scripts/src/engine.ts:8661](../../packages/scripts/src/engine.ts#L8661) `ScriptEngine/performFind` | `Store.findIds` (8661) | SCRIPT |
| [packages/scripts/src/engine.ts:8686](../../packages/scripts/src/engine.ts#L8686) `ScriptEngine/findRelated` | `Store.findIds` (8686, 8696, 8699) | SCRIPT |
| [packages/scripts/src/engine.ts:8718](../../packages/scripts/src/engine.ts#L8718) `ScriptEngine/quickFind` | `Store.findIds` (8718, 8719, 8722) | SCRIPT |
| [packages/scripts/src/engine.ts:9106](../../packages/scripts/src/engine.ts#L9106) `clearRecords` | `SQLite.all` (9106); `SQLite.prepare` (9106) | SCRIPT |
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
| [packages/server/src/dataapi.ts:1940](../../packages/server/src/dataapi.ts#L1940) `DataApi/route` | `Store.get` (1940, 2162, 2185, 2193, 2240, 2264, 2284, 2321); `Store.valueListItems` (1955); `Store.find` (2117, 2164, 2354); `Store.findIds` (2121, 2359); `Store.query` (2359) | REST |
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
| [packages/server/src/oauth.ts:830](../../packages/server/src/oauth.ts#L830) `OAuthServer/sweep` | `SQLite.all` (830); `SQLite.prepare` (830, 832, 833, 834, 835) | AUTH |
| [packages/server/src/oauth.ts:884](../../packages/server/src/oauth.ts#L884) `OAuthServer/revoke` | `SQLite.get` (884, 885, 895, 896); `SQLite.prepare` (884, 885, 888, 895, 896, 900) | AUTH |
| [packages/server/src/oauth.ts:867](../../packages/server/src/oauth.ts#L867) `OAuthServer/managedAccess` | `SQLite.get` (867); `SQLite.prepare` (867) | AUTH |
| [packages/server/src/oauth.ts:871](../../packages/server/src/oauth.ts#L871) `OAuthServer/accessAllowed` | `SQLite.get` (871); `SQLite.prepare` (871) | AUTH |
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
| [packages/store/src/calc.ts:2112](../../packages/store/src/calc.ts#L2112) `Calculations/translateSQL` | `Store.scopedTableSql` (2112, 2143) | CALC |
| [packages/store/src/calc.ts:2175](../../packages/store/src/calc.ts#L2175) `Calculations/shareColumn` | `Store.recordCount` (2175) | CALC |
| [packages/store/src/calc.ts:2207](../../packages/store/src/calc.ts#L2207) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2207) | CALC |
| [packages/store/src/calc.ts:2244](../../packages/store/src/calc.ts#L2244) `Calculations/computeColumn` | `Calculations.statement` (2244); `SQLite.get` (2244); `Calculations.value` (2247) | CALC |
| [packages/store/src/calc.ts:2381](../../packages/store/src/calc.ts#L2381) `Calculations/beforeWrite` | `relatedRows` (2381); `Calculations.related` (2435); `Calculations.context` (2448) | CORE |
| [packages/store/src/calc.ts:2499](../../packages/store/src/calc.ts#L2499) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2499); `Calculations.value` (2499) | CALC |
| [packages/store/src/calc.ts:2514](../../packages/store/src/calc.ts#L2514) `Calculations/computeStoredStyled` | `Calculations.context` (2514) | CORE |
| [packages/store/src/calc.ts:2554](../../packages/store/src/calc.ts#L2554) `Calculations/validate/fail` | `Calculations.context` (2554) | CALC |
| [packages/store/src/calc.ts:2568](../../packages/store/src/calc.ts#L2568) `Calculations/validate` | `Calculations.value` (2568); `Store.valueListItems` (2589); `Calculations.context` (2603) | CALC |
| [packages/store/src/calc.ts:2665](../../packages/store/src/calc.ts#L2665) `nearest` | `SQLite.get` (2665); `SQLite.prepare` (2665); `Store.sql` (2665) | CALC |
| [packages/store/src/calc.ts:2750](../../packages/store/src/calc.ts#L2750) `containerValue` | `Store.containerInfo` (2750); `Store.containerRange` (2757); `Store.container` (2758) | CALC |
| [packages/store/src/calc.ts:2766](../../packages/store/src/calc.ts#L2766) `containerValue/read` | `Store.container` (2766) | CALC |
| [packages/store/src/calc.ts:2779](../../packages/store/src/calc.ts#L2779) `containerValue/value` | `Store.containerRange` (2779) | CALC |
| [packages/store/src/calc.ts:2897](../../packages/store/src/calc.ts#L2897) `sameValuesElsewhere` | `SQLite.all` (2897); `SQLite.prepare` (2897, 2904, 2906); `Store.sql` (2897, 2904, 2906); `Calculations.value` (2899); `SQLite.get` (2904, 2906) | CALC |
| [packages/store/src/calc.ts:3210](../../packages/store/src/calc.ts#L3210) `rowsById/flush` | `Calculations.statement` (3210); `SQLite.iterate` (3210) | CALC |
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
| [packages/store/src/store.ts:892](../../packages/store/src/store.ts#L892) `Store/metadataVersions` | `SQLite.get` (892); `SQLite.prepare` (892); `Store.sql` (892) | CORE |
| [packages/store/src/store.ts:1033](../../packages/store/src/store.ts#L1033) `Store/constructor` | `Store.sql` (1033, 1035, 1037, 1038, 1042, 1046, 1047, 1058, 1063, 1068, 1069, 1073, 1074, 1075, 1082, 1086, 1090, 1091, 1092, 1097, 1101, 1104, 1105, 1107, 1108, 1111, 1112, 1116, 1117, 1121, 1122, 1125, 1127, 1130, 1131, 1135, 1136, 1140, 1141, 1144, 1145, 1146, 1149, 1150, 1153, 1154, 1156, 1156, 1157, 1157, 1158, 1161, 1165, 1167, 1170, 1171, 1172, 1175, 1176, 1178, 1180, 1181, 1185, 1186, 1188, 1192, 1194, 1195, 1196, 1196, 1200, 1201); `SQLite.get` (1037); `SQLite.prepare` (1037, 1104, 1105, 1108, 1111, 1116, 1121, 1130, 1135, 1140, 1149, 1153, 1156, 1157, 1175, 1180, 1185); `SQLite.all` (1104, 1111, 1116, 1121, 1130, 1135, 1140, 1149, 1153, 1156, 1157, 1175, 1180, 1185) | CORE |
| [packages/store/src/store.ts:1258](../../packages/store/src/store.ts#L1258) `Store/grantFullAccessClients` | `SQLite.prepare` (1258); `Store.sql` (1258) | CORE |
| [packages/store/src/store.ts:1281](../../packages/store/src/store.ts#L1281) `Store/meta` | `SQLite.get` (1281); `SQLite.prepare` (1281); `Store.sql` (1281) | CORE |
| [packages/store/src/store.ts:6123](../../packages/store/src/store.ts#L6123) `Store/design` | `SQLite.get` (6123) | CORE |
| [packages/store/src/store.ts:6145](../../packages/store/src/store.ts#L6145) `Store/themes` | `SQLite.get` (6145) | CORE |
| [packages/store/src/store.ts:3551](../../packages/store/src/store.ts#L3551) `Store/webViewerChecked` | `SQLite.get` (3551); `SQLite.prepare` (3551); `Store.sql` (3551) | CORE |
| [packages/store/src/store.ts:1289](../../packages/store/src/store.ts#L1289) `Store/persistentTable` | `Store.sql` (1289) | CORE |
| [packages/store/src/store.ts:1299](../../packages/store/src/store.ts#L1299) `Store/persistentData` | `SQLite.get` (1299) | CORE |
| [packages/store/src/store.ts:1308](../../packages/store/src/store.ts#L1308) `Store/persistentDataIds` | `SQLite.all` (1308) | CORE |
| [packages/store/src/store.ts:1314](../../packages/store/src/store.ts#L1314) `Store/setPersistentData` | `SQLite.prepare` (1314, 1318); `Store.sql` (1314, 1318) | CORE |
| [packages/store/src/store.ts:1338](../../packages/store/src/store.ts#L1338) `Store/checkpoint` | `SQLite.get` (1338); `SQLite.prepare` (1338); `Store.sql` (1338) | CORE |
| [packages/store/src/store.ts:1346](../../packages/store/src/store.ts#L1346) `Store/recordedFormat` | `Store.sql` (1346) | CORE |
| [packages/store/src/store.ts:1356](../../packages/store/src/store.ts#L1356) `Store/close` | `Store.sql` (1356) | CORE |
| [packages/store/src/store.ts:1372](../../packages/store/src/store.ts#L1372) `Store/shipWal` | `Store.sql` (1372) | CORE |
| [packages/store/src/store.ts:1383](../../packages/store/src/store.ts#L1383) `Store/trial` | `Store.sql` (1383) | CORE |
| [packages/store/src/store.ts:1388](../../packages/store/src/store.ts#L1388) `Store/trial/undo` | `Store.sql` (1388) | CORE |
| [packages/store/src/store.ts:1479](../../packages/store/src/store.ts#L1479) `Store/joinTransaction` | `Store.sql` (1479, 1480, 1482, 1484, 1490) | CORE |
| [packages/store/src/store.ts:1502](../../packages/store/src/store.ts#L1502) `Store/independentWindowWrite` | `SQLite.get` (1502); `SQLite.prepare` (1502, 1525); `Store.sql` (1502, 1505, 1520, 1525, 1528) | CORE |
| [packages/store/src/store.ts:1555](../../packages/store/src/store.ts#L1555) `Store/withWriteTransaction` | `Store.sql` (1555, 1566, 1572, 1574, 1574) | CORE |
| [packages/store/src/store.ts:1624](../../packages/store/src/store.ts#L1624) `Store/endTransaction` | `Store.sql` (1624, 1627, 1627) | CORE |
| [packages/store/src/store.ts:1654](../../packages/store/src/store.ts#L1654) `Store/backup` | `Store.sql` (1654) | CORE |
| [packages/store/src/store.ts:1744](../../packages/store/src/store.ts#L1744) `Store/dataVersion` | `SQLite.get` (1744); `SQLite.prepare` (1744); `Store.sql` (1744) | CORE |
| [packages/store/src/store.ts:1784](../../packages/store/src/store.ts#L1784) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1784) | CORE |
| [packages/store/src/store.ts:1805](../../packages/store/src/store.ts#L1805) `Store/shareResults` | `Store.sql` (1805) | CORE |
| [packages/store/src/store.ts:1816](../../packages/store/src/store.ts#L1816) `Store/versionTriggers` | `SQLite.get` (1816); `SQLite.prepare` (1816, 1821, 1822); `Store.sql` (1816, 1821, 1822, 1839, 1841, 1842, 1844); `SQLite.all` (1821, 1822) | CORE |
| [packages/store/src/store.ts:1860](../../packages/store/src/store.ts#L1860) `Store/versionNumber` | `SQLite.get` (1860); `SQLite.prepare` (1860); `Store.sql` (1860) | CORE |
| [packages/store/src/store.ts:1873](../../packages/store/src/store.ts#L1873) `Store/changeOne` | `Store.sql` (1873, 1875) | CORE |
| [packages/store/src/store.ts:1876](../../packages/store/src/store.ts#L1876) `Store/changeOne/read` | `SQLite.get` (1876); `SQLite.prepare` (1876); `Store.sql` (1876) | CORE |
| [packages/store/src/store.ts:1915](../../packages/store/src/store.ts#L1915) `Store/writeToken` | `SQLite.get` (1915); `SQLite.prepare` (1915); `Store.sql` (1915) | CORE |
| [packages/store/src/store.ts:1927](../../packages/store/src/store.ts#L1927) `Store/recordCount` | `SQLite.get` (1927); `SQLite.prepare` (1927); `Store.sql` (1927) | CORE |
| [packages/store/src/store.ts:2043](../../packages/store/src/store.ts#L2043) `Store/applyDesign` | `Store.sql` (2043, 2044, 2057, 2060, 2065, 2081, 2084, 2084); `SQLite.prepare` (2060, 2065) | CORE |
| [packages/store/src/store.ts:2142](../../packages/store/src/store.ts#L2142) `Store/auditLog` | `SQLite.all` (2142); `SQLite.prepare` (2142); `Store.sql` (2142) | CORE |
| [packages/store/src/store.ts:2182](../../packages/store/src/store.ts#L2182) `Store/securityEvents` | `Store.auditLog` (2182) | CORE |
| [packages/store/src/store.ts:2208](../../packages/store/src/store.ts#L2208) `Store/prepared` | `SQLite.prepare` (2208); `Store.sql` (2208) | CORE |
| [packages/store/src/store.ts:2223](../../packages/store/src/store.ts#L2223) `Store/recordAsOf` | `SQLite.get` (2223, 2225); `SQLite.prepare` (2223, 2225, 2227, 2228); `Store.sql` (2223, 2225, 2227, 2228); `SQLite.all` (2227, 2228) | CORE |
| [packages/store/src/store.ts:2301](../../packages/store/src/store.ts#L2301) `Store/revertAuditEntry` | `Store.auditLog` (2301) | CORE |
| [packages/store/src/store.ts:2394](../../packages/store/src/store.ts#L2394) `Store/setAuditSettings` | `SQLite.prepare` (2394); `Store.sql` (2394) | CORE |
| [packages/store/src/store.ts:2416](../../packages/store/src/store.ts#L2416) `Store/pruneAudit` | `Store.sql` (2416, 2418, 2420); `SQLite.get` (2418); `SQLite.prepare` (2418) | CORE |
| [packages/store/src/store.ts:2498](../../packages/store/src/store.ts#L2498) `Store/audit` | `Store.sql` (2498) | CORE |
| [packages/store/src/store.ts:2587](../../packages/store/src/store.ts#L2587) `Store/securityChange` | `Store.sql` (2587, 2589); `SQLite.prepare` (2589) | CORE |
| [packages/store/src/store.ts:2636](../../packages/store/src/store.ts#L2636) `Store/logSecurity` | `Store.sql` (2636) | CORE |
| [packages/store/src/store.ts:2659](../../packages/store/src/store.ts#L2659) `Store/ensureDeleted` | `Store.sql` (2659) | CORE |
| [packages/store/src/store.ts:2664](../../packages/store/src/store.ts#L2664) `Store/deletedRows` | `SQLite.get` (2664); `SQLite.prepare` (2664, 2666, 2666); `Store.sql` (2664, 2666, 2666); `SQLite.all` (2666, 2666) | CORE |
| [packages/store/src/store.ts:2690](../../packages/store/src/store.ts#L2690) `Store/emptyDeleted` | `Store.sql` (2690, 2693, 2694, 2696, 2698); `SQLite.prepare` (2694) | CORE |
| [packages/store/src/store.ts:2705](../../packages/store/src/store.ts#L2705) `Store/designHistory` | `SQLite.all` (2705); `SQLite.prepare` (2705); `Store.sql` (2705) | CORE |
| [packages/store/src/store.ts:2712](../../packages/store/src/store.ts#L2712) `Store/scriptHistory` | `SQLite.all` (2712); `SQLite.prepare` (2712); `Store.sql` (2712) | CORE |
| [packages/store/src/store.ts:2722](../../packages/store/src/store.ts#L2722) `Store/layoutHistory` | `SQLite.all` (2722); `SQLite.prepare` (2722); `Store.sql` (2722) | CORE |
| [packages/store/src/store.ts:2751](../../packages/store/src/store.ts#L2751) `Store/designEffect/renameKey` | `SQLite.prepare` (2751); `Store.sql` (2751) | CORE |
| [packages/store/src/store.ts:2767](../../packages/store/src/store.ts#L2767) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2767); `Store.sql` (2767) | CORE |
| [packages/store/src/store.ts:2774](../../packages/store/src/store.ts#L2774) `Store/designEffect` | `Store.sql` (2774, 2779, 2784, 2789, 2792, 2798, 2809, 2810, 2812, 2825, 2826, 2829, 2831, 2837, 2838, 2839, 2844, 2846, 2850, 2853, 2854, 2856, 2859, 2865, 2867, 2874, 2875, 2877, 2878, 2879, 2880, 2887, 2888, 2890, 2890, 2892, 2893, 2894, 2898, 2902, 2904, 2942, 2944, 2946); `SQLite.get` (2809, 2825, 2837, 2838, 2850, 2854, 2890, 2898); `SQLite.prepare` (2809, 2810, 2825, 2826, 2837, 2838, 2844, 2846, 2850, 2854, 2865, 2867, 2880, 2887, 2888, 2890, 2892, 2894, 2898, 2902); `SQLite.all` (2887, 2888); `SQLite.iterate` (2892) | CORE |
| [packages/store/src/store.ts:2954](../../packages/store/src/store.ts#L2954) `Store/dropColumnIndexes` | `SQLite.all` (2954, 2956); `SQLite.prepare` (2954, 2956); `Store.sql` (2954, 2956, 2957) | CORE |
| [packages/store/src/store.ts:2966](../../packages/store/src/store.ts#L2966) `Store/recompute` | `SQLite.prepare` (2966, 2970); `Store.sql` (2966, 2970); `SQLite.iterate` (2970); `Calculations.computeStoredStyled` (2971); `Calculations.value` (2971) | CORE |
| [packages/store/src/store.ts:2986](../../packages/store/src/store.ts#L2986) `Store/linkPrincipal` | `SQLite.get` (2986); `SQLite.prepare` (2986); `Store.sql` (2986) | CORE |
| [packages/store/src/store.ts:2994](../../packages/store/src/store.ts#L2994) `Store/linkIdentity` | `SQLite.get` (2994); `SQLite.prepare` (2994); `Store.sql` (2994) | CORE |
| [packages/store/src/store.ts:3019](../../packages/store/src/store.ts#L3019) `Store/credentialIdentity` | `SQLite.get` (3019); `SQLite.prepare` (3019); `Store.sql` (3019) | CORE |
| [packages/store/src/store.ts:3025](../../packages/store/src/store.ts#L3025) `Store/accountsSharingLockout` | `SQLite.all` (3025); `SQLite.prepare` (3025); `Store.sql` (3025) | CORE |
| [packages/store/src/store.ts:3029](../../packages/store/src/store.ts#L3029) `Store/accounts` | `SQLite.all` (3029); `SQLite.prepare` (3029); `Store.sql` (3029) | CORE |
| [packages/store/src/store.ts:3041](../../packages/store/src/store.ts#L3041) `Store/isAgent` | `SQLite.get` (3041); `SQLite.prepare` (3041); `Store.sql` (3041) | CORE |
| [packages/store/src/store.ts:3047](../../packages/store/src/store.ts#L3047) `Store/agentNeedsApproval` | `SQLite.get` (3047); `SQLite.prepare` (3047); `Store.sql` (3047) | CORE |
| [packages/store/src/store.ts:3053](../../packages/store/src/store.ts#L3053) `Store/blankPasswordAccounts` | `SQLite.all` (3053); `SQLite.prepare` (3053); `Store.sql` (3053) | CORE |
| [packages/store/src/store.ts:1266](../../packages/store/src/store.ts#L1266) `Store/hasOwnPassword` | `SQLite.get` (1266); `SQLite.prepare` (1266); `Store.sql` (1266) | CORE |
| [packages/store/src/store.ts:3064](../../packages/store/src/store.ts#L3064) `Store/unmigratedAccounts` | `SQLite.all` (3064); `SQLite.prepare` (3064); `Store.sql` (3064) | CORE |
| [packages/store/src/store.ts:3117](../../packages/store/src/store.ts#L3117) `Store/setExternalAccount` | `SQLite.get` (3117); `SQLite.prepare` (3117, 3122); `Store.sql` (3117, 3122) | CORE |
| [packages/store/src/store.ts:3135](../../packages/store/src/store.ts#L3135) `Store/refuseLookalikeAccount` | `SQLite.all` (3135); `SQLite.prepare` (3135); `Store.sql` (3135) | CORE |
| [packages/store/src/store.ts:3144](../../packages/store/src/store.ts#L3144) `Store/isExternal` | `SQLite.get` (3144); `SQLite.prepare` (3144); `Store.sql` (3144) | CORE |
| [packages/store/src/store.ts:3165](../../packages/store/src/store.ts#L3165) `Store/setAgentAccount` | `SQLite.get` (3165); `SQLite.prepare` (3165, 3171); `Store.sql` (3165, 3171) | CORE |
| [packages/store/src/store.ts:3205](../../packages/store/src/store.ts#L3205) `Store/gateAgentWrite` | `SQLite.prepare` (3205); `Store.sql` (3205) | CORE |
| [packages/store/src/store.ts:3227](../../packages/store/src/store.ts#L3227) `Store/pendingChanges` | `SQLite.all` (3227); `SQLite.prepare` (3227); `Store.sql` (3227) | CORE |
| [packages/store/src/store.ts:3241](../../packages/store/src/store.ts#L3241) `Store/approvePending` | `SQLite.get` (3241); `SQLite.prepare` (3241, 3252); `Store.sql` (3241, 3252) | CORE |
| [packages/store/src/store.ts:3262](../../packages/store/src/store.ts#L3262) `Store/rejectPending` | `SQLite.get` (3262); `SQLite.prepare` (3262, 3264); `Store.sql` (3262, 3264) | CORE |
| [packages/store/src/store.ts:3284](../../packages/store/src/store.ts#L3284) `Store/externalAccount` | `SQLite.all` (3284); `SQLite.prepare` (3284); `Store.sql` (3284) | CORE |
| [packages/store/src/store.ts:3315](../../packages/store/src/store.ts#L3315) `Store/setPassword` | `SQLite.get` (3315); `SQLite.prepare` (3315, 3317, 3326); `Store.sql` (3315, 3317, 3326) | AUTH |
| [packages/store/src/store.ts:3340](../../packages/store/src/store.ts#L3340) `Store/createAccount` | `SQLite.get` (3340); `SQLite.prepare` (3340, 3344, 3350, 3355, 3360); `Store.sql` (3340, 3344, 3350, 3355, 3360) | CORE |
| [packages/store/src/store.ts:3368](../../packages/store/src/store.ts#L3368) `Store/appendSecurityEvent` | `Store.sql` (3368) | CORE |
| [packages/store/src/store.ts:3410](../../packages/store/src/store.ts#L3410) `Store/setPasswordPolicy` | `SQLite.prepare` (3410); `Store.sql` (3410) | CORE |
| [packages/store/src/store.ts:3446](../../packages/store/src/store.ts#L3446) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3446); `Store.sql` (3446) | CORE |
| [packages/store/src/store.ts:3469](../../packages/store/src/store.ts#L3469) `Store/saveScriptTest` | `SQLite.prepare` (3469); `Store.sql` (3469) | CORE |
| [packages/store/src/store.ts:3478](../../packages/store/src/store.ts#L3478) `Store/deleteScriptTest` | `SQLite.prepare` (3478); `Store.sql` (3478) | CORE |
| [packages/store/src/store.ts:3513](../../packages/store/src/store.ts#L3513) `Store/setAiAllowed` | `SQLite.prepare` (3513); `Store.sql` (3513) | CORE |
| [packages/store/src/store.ts:3580](../../packages/store/src/store.ts#L3580) `Store/setAiPolicy` | `SQLite.prepare` (3580); `Store.sql` (3580) | CORE |
| [packages/store/src/store.ts:3528](../../packages/store/src/store.ts#L3528) `Store/setScriptNetwork` | `SQLite.prepare` (3528); `Store.sql` (3528) | CORE |
| [packages/store/src/store.ts:3569](../../packages/store/src/store.ts#L3569) `Store/setWebViewerHosts` | `SQLite.prepare` (3569); `Store.sql` (3569) | CORE |
| [packages/store/src/store.ts:3600](../../packages/store/src/store.ts#L3600) `Store/setPiiIsolation` | `SQLite.prepare` (3600); `Store.sql` (3600) | CORE |
| [packages/store/src/store.ts:3622](../../packages/store/src/store.ts#L3622) `Store/markPiiField` | `SQLite.prepare` (3622); `Store.sql` (3622) | CORE |
| [packages/store/src/store.ts:3736](../../packages/store/src/store.ts#L3736) `Store/lastSignIns` | `Store.auditLog` (3736) | CORE |
| [packages/store/src/store.ts:3939](../../packages/store/src/store.ts#L3939) `Store/unusualAccess` | `Store.auditLog` (3939, 4005) | CORE |
| [packages/store/src/store.ts:4036](../../packages/store/src/store.ts#L4036) `Store/leastPrivilege` | `SQLite.all` (4036); `SQLite.prepare` (4036); `Store.sql` (4036) | CORE |
| [packages/store/src/store.ts:4109](../../packages/store/src/store.ts#L4109) `Store/unusedAccess` | `SQLite.get` (4109); `SQLite.prepare` (4109, 4118); `Store.sql` (4109, 4118); `SQLite.all` (4118) | CORE |
| [packages/store/src/store.ts:4157](../../packages/store/src/store.ts#L4157) `Store/unusedObjects` | `SQLite.get` (4157); `SQLite.prepare` (4157, 4160); `Store.sql` (4157, 4160); `SQLite.all` (4160) | CORE |
| [packages/store/src/store.ts:4195](../../packages/store/src/store.ts#L4195) `Store/usageCounting` | `SQLite.get` (4195); `SQLite.prepare` (4195); `Store.sql` (4195) | CORE |
| [packages/store/src/store.ts:4203](../../packages/store/src/store.ts#L4203) `Store/setMustChangePassword` | `SQLite.prepare` (4203); `Store.sql` (4203) | CORE |
| [packages/store/src/store.ts:4217](../../packages/store/src/store.ts#L4217) `Store/mustChangePassword` | `SQLite.get` (4217); `SQLite.prepare` (4217); `Store.sql` (4217) | CORE |
| [packages/store/src/store.ts:4256](../../packages/store/src/store.ts#L4256) `Store/passwordDaysRemaining` | `SQLite.get` (4256); `SQLite.prepare` (4256); `Store.sql` (4256) | CORE |
| [packages/store/src/store.ts:4263](../../packages/store/src/store.ts#L4263) `Store/importAccounts` | `SQLite.all` (4263); `SQLite.prepare` (4263); `Store.sql` (4263) | CORE |
| [packages/store/src/store.ts:4286](../../packages/store/src/store.ts#L4286) `Store/canonicalAccount` | `SQLite.all` (4286); `SQLite.prepare` (4286); `Store.sql` (4286) | CORE |
| [packages/store/src/store.ts:4298](../../packages/store/src/store.ts#L4298) `Store/createLocalAccount` | `SQLite.prepare` (4298); `Store.sql` (4298) | CORE |
| [packages/store/src/store.ts:4328](../../packages/store/src/store.ts#L4328) `Store/previewAccountImport` | `Store.sql` (4328, 4329, 4338) | CORE |
| [packages/store/src/store.ts:4346](../../packages/store/src/store.ts#L4346) `Store/limitAccountImport` | `SQLite.prepare` (4346, 4347, 4350); `Store.sql` (4346, 4347, 4350); `SQLite.get` (4347) | CORE |
| [packages/store/src/store.ts:4357](../../packages/store/src/store.ts#L4357) `Store/applyAccountImport` | `Store.sql` (4357, 4365, 4394); `SQLite.get` (4365); `SQLite.prepare` (4365, 4394) | CORE |
| [packages/store/src/store.ts:4419](../../packages/store/src/store.ts#L4419) `Store/forgetStandIns` | `SQLite.prepare` (4419); `Store.sql` (4419) | CORE |
| [packages/store/src/store.ts:4452](../../packages/store/src/store.ts#L4452) `Store/deleteAccount` | `SQLite.prepare` (4452, 4456, 4457, 4458, 4459, 4460, 4461, 4462, 4463, 4470, 4472, 4475, 4479); `Store.sql` (4452, 4456, 4457, 4458, 4459, 4460, 4461, 4462, 4463, 4470, 4472, 4475, 4479) | CORE |
| [packages/store/src/store.ts:4496](../../packages/store/src/store.ts#L4496) `Store/setAccountActive` | `SQLite.prepare` (4496, 4499, 4500); `Store.sql` (4496, 4499, 4500) | AUTH |
| [packages/store/src/store.ts:4510](../../packages/store/src/store.ts#L4510) `Store/accountInactive` | `SQLite.get` (4510); `SQLite.prepare` (4510); `Store.sql` (4510) | CORE |
| [packages/store/src/store.ts:4515](../../packages/store/src/store.ts#L4515) `Store/identityAllowed` | `SQLite.get` (4515, 4521, 4527); `SQLite.prepare` (4515, 4521, 4527); `Store.sql` (4515, 4521, 4527) | CORE |
| [packages/store/src/store.ts:4536](../../packages/store/src/store.ts#L4536) `Store/externalIdentityId` | `SQLite.get` (4536, 4542); `SQLite.prepare` (4536, 4541, 4542); `Store.sql` (4536, 4541, 4542) | CORE |
| [packages/store/src/store.ts:4547](../../packages/store/src/store.ts#L4547) `Store/accountIdentityId` | `SQLite.get` (4547, 4552); `SQLite.prepare` (4547, 4551, 4552); `Store.sql` (4547, 4551, 4552) | CORE |
| [packages/store/src/store.ts:4575](../../packages/store/src/store.ts#L4575) `Store/signInMark` | `SQLite.prepare` (4575); `Store.sql` (4575) | AUTH |
| [packages/store/src/store.ts:4585](../../packages/store/src/store.ts#L4585) `Store/signInBase` | `SQLite.get` (4585); `SQLite.prepare` (4585); `Store.sql` (4585) | AUTH |
| [packages/store/src/store.ts:4587](../../packages/store/src/store.ts#L4587) `Store/signInBase/identity` | `SQLite.get` (4587); `SQLite.prepare` (4587); `Store.sql` (4587) | AUTH |
| [packages/store/src/store.ts:4599](../../packages/store/src/store.ts#L4599) `Store/ledgerRow` | `SQLite.get` (4599, 4600); `SQLite.prepare` (4599, 4600); `Store.sql` (4599, 4600) | AUTH |
| [packages/store/src/store.ts:4611](../../packages/store/src/store.ts#L4611) `Store/ledgerWrite` | `Store.sql` (4611, 4612, 4614, 4616, 4619, 4619) | AUTH |
| [packages/store/src/store.ts:4638](../../packages/store/src/store.ts#L4638) `Store/settleSignIns` | `SQLite.all` (4638, 4644); `SQLite.prepare` (4638, 4644, 4650, 4654, 4656); `Store.sql` (4638, 4644, 4650, 4654, 4656) | AUTH |
| [packages/store/src/store.ts:4667](../../packages/store/src/store.ts#L4667) `Store/securityToken` | `SQLite.get` (4667); `SQLite.prepare` (4667); `Store.sql` (4667) | CORE |
| [packages/store/src/store.ts:4675](../../packages/store/src/store.ts#L4675) `Store/accountLocalOnly` | `SQLite.get` (4675); `SQLite.prepare` (4675); `Store.sql` (4675) | CORE |
| [packages/store/src/store.ts:4680](../../packages/store/src/store.ts#L4680) `Store/accountRequires2fa` | `SQLite.get` (4680); `SQLite.prepare` (4680); `Store.sql` (4680) | CORE |
| [packages/store/src/store.ts:4686](../../packages/store/src/store.ts#L4686) `Store/setAccountLocalOnly` | `SQLite.prepare` (4686); `Store.sql` (4686) | CORE |
| [packages/store/src/store.ts:4695](../../packages/store/src/store.ts#L4695) `Store/setAccountRequire2fa` | `SQLite.prepare` (4695); `Store.sql` (4695) | CORE |
| [packages/store/src/store.ts:4724](../../packages/store/src/store.ts#L4724) `Store/createApiToken` | `SQLite.get` (4724); `SQLite.prepare` (4724, 4754); `Store.sql` (4724, 4754) | CORE |
| [packages/store/src/store.ts:4801](../../packages/store/src/store.ts#L4801) `Store/recordObjectUse` | `Store.sql` (4801) | CORE |
| [packages/store/src/store.ts:4831](../../packages/store/src/store.ts#L4831) `Store/writeUsage` | `Store.sql` (4831, 4832, 4834, 4838, 4840) | CORE |
| [packages/store/src/store.ts:4847](../../packages/store/src/store.ts#L4847) `Store/writeUsageRows` | `SQLite.prepare` (4847, 4848, 4854); `Store.sql` (4847, 4848, 4854) | CORE |
| [packages/store/src/store.ts:4859](../../packages/store/src/store.ts#L4859) `Store/writeObjectUseRows` | `SQLite.prepare` (4859, 4860, 4865); `Store.sql` (4859, 4860, 4865) | CORE |
| [packages/store/src/store.ts:4870](../../packages/store/src/store.ts#L4870) `Store/objectUseSince` | `SQLite.get` (4870); `SQLite.prepare` (4870); `Store.sql` (4870) | CORE |
| [packages/store/src/store.ts:4883](../../packages/store/src/store.ts#L4883) `Store/accountUsage` | `SQLite.get` (4883); `SQLite.prepare` (4883, 4884); `Store.sql` (4883, 4884); `SQLite.all` (4884); `Store.auditLog` (4900) | CORE |
| [packages/store/src/store.ts:4916](../../packages/store/src/store.ts#L4916) `Store/apiTokens` | `SQLite.all` (4916); `SQLite.prepare` (4916); `Store.sql` (4916) | CORE |
| [packages/store/src/store.ts:4926](../../packages/store/src/store.ts#L4926) `Store/revokeApiToken` | `SQLite.prepare` (4926); `Store.sql` (4926) | CORE |
| [packages/store/src/store.ts:4940](../../packages/store/src/store.ts#L4940) `Store/apiToken` | `SQLite.get` (4940); `SQLite.prepare` (4940, 4952); `Store.sql` (4940, 4952) | CORE |
| [packages/store/src/store.ts:4968](../../packages/store/src/store.ts#L4968) `Store/enrollTotp` | `SQLite.prepare` (4968); `Store.sql` (4968) | CORE |
| [packages/store/src/store.ts:4979](../../packages/store/src/store.ts#L4979) `Store/confirmTotp` | `SQLite.get` (4979); `SQLite.prepare` (4979, 4981); `Store.sql` (4979, 4981) | CORE |
| [packages/store/src/store.ts:4989](../../packages/store/src/store.ts#L4989) `Store/hasTotp` | `SQLite.get` (4989); `SQLite.prepare` (4989); `Store.sql` (4989) | CORE |
| [packages/store/src/store.ts:4994](../../packages/store/src/store.ts#L4994) `Store/totpAccounts` | `SQLite.all` (4994); `SQLite.prepare` (4994); `Store.sql` (4994) | CORE |
| [packages/store/src/store.ts:5000](../../packages/store/src/store.ts#L5000) `Store/disableTotp` | `SQLite.prepare` (5000); `Store.sql` (5000) | CORE |
| [packages/store/src/store.ts:5023](../../packages/store/src/store.ts#L5023) `Store/verifyTotp` | `SQLite.get` (5023); `SQLite.prepare` (5023, 5029); `Store.sql` (5023, 5029) | CORE |
| [packages/store/src/store.ts:5042](../../packages/store/src/store.ts#L5042) `Store/issueWebauthnChallenge` | `SQLite.prepare` (5042, 5044, 5045, 5047); `Store.sql` (5042, 5044, 5045, 5047); `SQLite.get` (5044) | CORE |
| [packages/store/src/store.ts:5094](../../packages/store/src/store.ts#L5094) `Store/passkeyAllowList` | `SQLite.all` (5094); `SQLite.prepare` (5094); `Store.sql` (5094) | CORE |
| [packages/store/src/store.ts:5108](../../packages/store/src/store.ts#L5108) `Store/takeWebauthnChallenge` | `SQLite.get` (5108); `SQLite.prepare` (5108, 5110); `Store.sql` (5108, 5110) | CORE |
| [packages/store/src/store.ts:5118](../../packages/store/src/store.ts#L5118) `Store/passkeys` | `SQLite.all` (5118); `SQLite.prepare` (5118); `Store.sql` (5118) | CORE |
| [packages/store/src/store.ts:5125](../../packages/store/src/store.ts#L5125) `Store/hasPasskey` | `SQLite.get` (5125); `SQLite.prepare` (5125); `Store.sql` (5125) | CORE |
| [packages/store/src/store.ts:5130](../../packages/store/src/store.ts#L5130) `Store/passkeyIds` | `SQLite.all` (5130); `SQLite.prepare` (5130); `Store.sql` (5130) | CORE |
| [packages/store/src/store.ts:5152](../../packages/store/src/store.ts#L5152) `Store/registerPasskey` | `SQLite.prepare` (5152); `Store.sql` (5152) | CORE |
| [packages/store/src/store.ts:5163](../../packages/store/src/store.ts#L5163) `Store/removePasskey` | `SQLite.get` (5163); `SQLite.prepare` (5163, 5164); `Store.sql` (5163, 5164) | CORE |
| [packages/store/src/store.ts:5180](../../packages/store/src/store.ts#L5180) `Store/verifyPasskeyAssertion` | `SQLite.get` (5180); `SQLite.prepare` (5180, 5191); `Store.sql` (5180, 5191) | CORE |
| [packages/store/src/store.ts:5227](../../packages/store/src/store.ts#L5227) `Store/generateRecoveryCodes` | `SQLite.prepare` (5227, 5230); `Store.sql` (5227, 5230) | CORE |
| [packages/store/src/store.ts:5245](../../packages/store/src/store.ts#L5245) `Store/recoveryCodesRemaining` | `SQLite.get` (5245); `SQLite.prepare` (5245); `Store.sql` (5245) | CORE |
| [packages/store/src/store.ts:5255](../../packages/store/src/store.ts#L5255) `Store/useRecoveryCode` | `SQLite.get` (5255); `SQLite.prepare` (5255, 5257); `Store.sql` (5255, 5257) | CORE |
| [packages/store/src/store.ts:5268](../../packages/store/src/store.ts#L5268) `Store/privilegeSets` | `Store.sql` (5268) | CORE |
| [packages/store/src/store.ts:5297](../../packages/store/src/store.ts#L5297) `Store/savePrivilegeSet` | `SQLite.prepare` (5297, 5305); `Store.sql` (5297, 5305) | AUTH |
| [packages/store/src/store.ts:5340](../../packages/store/src/store.ts#L5340) `Store/deletePrivilegeSet` | `SQLite.prepare` (5340); `Store.sql` (5340) | CORE |
| [packages/store/src/store.ts:5409](../../packages/store/src/store.ts#L5409) `Store/accountPrivilegeSet` | `SQLite.get` (5409); `SQLite.prepare` (5409); `Store.sql` (5409) | CORE |
| [packages/store/src/store.ts:5423](../../packages/store/src/store.ts#L5423) `Store/setAccountPrivilegeSet` | `SQLite.get` (5423); `SQLite.prepare` (5423, 5426, 5430); `Store.sql` (5423, 5426, 5430) | AUTH |
| [packages/store/src/store.ts:5445](../../packages/store/src/store.ts#L5445) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5445); `Store.sql` (5445) | CORE |
| [packages/store/src/store.ts:5459](../../packages/store/src/store.ts#L5459) `Store/addProvisionedAccount` | `SQLite.get` (5459); `SQLite.prepare` (5459, 5463); `Store.sql` (5459, 5463) | CORE |
| [packages/store/src/store.ts:5632](../../packages/store/src/store.ts#L5632) `Store/ruleOutcome` | `Calculations.context` (5632) | CORE |
| [packages/store/src/store.ts:5673](../../packages/store/src/store.ts#L5673) `Store/allowedIds` | `SQLite.iterate` (5673); `SQLite.prepare` (5673); `Store.sql` (5673) | CORE |
| [packages/store/src/store.ts:5771](../../packages/store/src/store.ts#L5771) `Store/scopedTableSql` | `Store.viewableIds` (5771); `SQLite.all` (5774); `SQLite.prepare` (5774); `Store.sql` (5774) | GATED-STORE |
| [packages/store/src/store.ts:5806](../../packages/store/src/store.ts#L5806) `Store/previewRecordRuleCurrent` | `SQLite.get` (5806); `SQLite.prepare` (5806, 5809); `Store.sql` (5806, 5809); `SQLite.all` (5809); `Calculations.context` (5815, 5831) | CORE |
| [packages/store/src/store.ts:5983](../../packages/store/src/store.ts#L5983) `Store/passwordHash` | `SQLite.get` (5983); `SQLite.prepare` (5983); `Store.sql` (5983) | CORE |
| [packages/store/src/store.ts:6012](../../packages/store/src/store.ts#L6012) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (6012); `Store.sql` (6012) | CORE |
| [packages/store/src/store.ts:6025](../../packages/store/src/store.ts#L6025) `Store/knownSharedAccount` | `SQLite.get` (6025); `SQLite.prepare` (6025); `Store.sql` (6025) | CORE |
| [packages/store/src/store.ts:6088](../../packages/store/src/store.ts#L6088) `Store/layouts` | `SQLite.all` (6088); `SQLite.prepare` (6088); `Store.sql` (6088) | CORE |
| [packages/store/src/store.ts:6158](../../packages/store/src/store.ts#L6158) `Store/image` | `SQLite.get` (6158); `SQLite.prepare` (6158); `Store.sql` (6158) | CORE |
| [packages/store/src/store.ts:6168](../../packages/store/src/store.ts#L6168) `Store/images` | `SQLite.all` (6168); `SQLite.prepare` (6168); `Store.sql` (6168) | CORE |
| [packages/store/src/store.ts:6181](../../packages/store/src/store.ts#L6181) `Store/addImage` | `Store.sql` (6181, 6182); `SQLite.prepare` (6182) | CORE |
| [packages/store/src/store.ts:6198](../../packages/store/src/store.ts#L6198) `Store/layout` | `SQLite.get` (6198); `SQLite.prepare` (6198); `Store.sql` (6198) | CORE |
| [packages/store/src/store.ts:6402](../../packages/store/src/store.ts#L6402) `Store/wordIndex` | `Store.sql` (6402, 6410, 6415); `Store.recordCount` (6414); `SQLite.get` (6415); `SQLite.prepare` (6415) | CORE |
| [packages/store/src/store.ts:6467](../../packages/store/src/store.ts#L6467) `Store/toRecord` | `Calculations.value` (6467, 6477); `Calculations.globalValue` (6471); `Calculations.unstoredStyled` (6476) | CORE |
| [packages/store/src/store.ts:6526](../../packages/store/src/store.ts#L6526) `Store/relatedValues` | `Calculations.globalValue` (6526); `Calculations.unstoredValue` (6528) | CORE |
| [packages/store/src/store.ts:6600](../../packages/store/src/store.ts#L6600) `Store/addRelated` | `relatedRows` (6600); `rowsById` (6632); `firstRelatedEach` (6655) | CORE |
| [packages/store/src/store.ts:6683](../../packages/store/src/store.ts#L6683) `Store/foundSetPage` | `rowsById` (6683) | CORE |
| [packages/store/src/store.ts:6699](../../packages/store/src/store.ts#L6699) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6699); `Store.row` (6715) | GATED-STORE |
| [packages/store/src/store.ts:6738](../../packages/store/src/store.ts#L6738) `Store/portalCountsCurrent` | `Store.canView` (6738); `Store.row` (6765) | GATED-STORE |
| [packages/store/src/store.ts:6801](../../packages/store/src/store.ts#L6801) `Store/fieldIndexCurrent` | `SQLite.iterate` (6801); `SQLite.prepare` (6801, 6806); `Store.sql` (6801, 6806); `SQLite.all` (6806) | GATED-STORE |
| [packages/store/src/store.ts:6847](../../packages/store/src/store.ts#L6847) `Store/valueListItemsCurrent` | `Store.valueListItems` (6847); `Store.get` (6861); `relatedRows` (6862); `Store.row` (6862); `SQLite.iterate` (6864); `SQLite.prepare` (6864); `Store.sql` (6864); `Calculations.related` (6874); `Calculations.value` (6878, 6879) | GATED-STORE |
| [packages/store/src/store.ts:6976](../../packages/store/src/store.ts#L6976) `Store/portalRows` | `relatedRows` (6976); `relatedIdList` (6977); `Store.viewableIds` (6980); `rowsById` (7005, 7043); `Calculations.related` (7019) | CORE |
| [packages/store/src/store.ts:6987](../../packages/store/src/store.ts#L6987) `Store/portalRows/context` | `Calculations.context` (6987) | CORE |
| [packages/store/src/store.ts:6997](../../packages/store/src/store.ts#L6997) `Store/portalRows/valueOf` | `Calculations.value` (6997) | CORE |
| [packages/store/src/store.ts:7114](../../packages/store/src/store.ts#L7114) `Store/markRepeating` | `SQLite.prepare` (7114); `Store.sql` (7114) | CORE |
| [packages/store/src/store.ts:7141](../../packages/store/src/store.ts#L7141) `Store/externalContainerCheck` | `SQLite.all` (7141); `SQLite.prepare` (7141); `Store.sql` (7141) | CORE |
| [packages/store/src/store.ts:7148](../../packages/store/src/store.ts#L7148) `Store/externalContainerCount` | `SQLite.get` (7148); `SQLite.prepare` (7148); `Store.sql` (7148) | CORE |
| [packages/store/src/store.ts:7157](../../packages/store/src/store.ts#L7157) `Store/externalContainerReport` | `SQLite.all` (7157, 7170); `SQLite.prepare` (7157, 7170); `Store.sql` (7157, 7170) | CORE |
| [packages/store/src/store.ts:7306](../../packages/store/src/store.ts#L7306) `Store/orphanContainerReport` | `SQLite.all` (7306); `SQLite.prepare` (7306); `Store.sql` (7306) | CORE |
| [packages/store/src/store.ts:7341](../../packages/store/src/store.ts#L7341) `Store/purgeOrphanContainers` | `Store.sql` (7341, 7345, 7354, 7357, 7358, 7363, 7364, 7366, 7366); `Store.orphanContainerReport` (7349); `SQLite.get` (7354); `SQLite.prepare` (7354, 7357, 7358) | CORE |
| [packages/store/src/store.ts:7379](../../packages/store/src/store.ts#L7379) `Store/containerIntact` | `SQLite.get` (7379); `SQLite.prepare` (7379); `Store.sql` (7379) | CORE |
| [packages/store/src/store.ts:7389](../../packages/store/src/store.ts#L7389) `Store/externalOf` | `SQLite.get` (7389); `SQLite.prepare` (7389); `Store.sql` (7389) | CORE |
| [packages/store/src/store.ts:7393](../../packages/store/src/store.ts#L7393) `Store/containerMeta` | `SQLite.get` (7393); `SQLite.prepare` (7393); `Store.sql` (7393) | CORE |
| [packages/store/src/store.ts:7398](../../packages/store/src/store.ts#L7398) `Store/container` | `SQLite.get` (7398); `SQLite.prepare` (7398, 7407); `Store.sql` (7398, 7407); `SQLite.all` (7407) | CORE |
| [packages/store/src/store.ts:7415](../../packages/store/src/store.ts#L7415) `Store/containerInfo` | `SQLite.get` (7415); `SQLite.prepare` (7415); `Store.sql` (7415) | CORE |
| [packages/store/src/store.ts:7449](../../packages/store/src/store.ts#L7449) `Store/containerRange` | `SQLite.all` (7449); `SQLite.prepare` (7449, 7456); `Store.sql` (7449, 7456); `SQLite.get` (7456) | CORE |
| [packages/store/src/store.ts:7474](../../packages/store/src/store.ts#L7474) `Store/addContainer` | `SQLite.all` (7474); `SQLite.prepare` (7474, 7479, 7493, 7497, 7498); `Store.sql` (7474, 7479, 7493, 7495, 7497, 7498, 7500, 7503); `SQLite.get` (7484); `Store.containerRange` (7486) | CORE |
| [packages/store/src/store.ts:7520](../../packages/store/src/store.ts#L7520) `Store/addExternalContainer` | `SQLite.prepare` (7520); `Store.sql` (7520) | CORE |
| [packages/store/src/store.ts:7538](../../packages/store/src/store.ts#L7538) `Store/writeExternalFile` | `Store.evaluateEach` (7538); `SQLite.prepare` (7561); `Store.sql` (7561) | CORE |
| [packages/store/src/store.ts:7562](../../packages/store/src/store.ts#L7562) `Store/writeExternalFile/taken` | `SQLite.get` (7562) | CORE |
| [packages/store/src/store.ts:7612](../../packages/store/src/store.ts#L7612) `Store/embeddedContainers` | `SQLite.prepare` (7612, 7613); `Store.sql` (7612, 7613); `SQLite.all` (7613); `SQLite.get` (7617) | CORE |
| [packages/store/src/store.ts:7626](../../packages/store/src/store.ts#L7626) `Store/embeddedContainerCount` | `SQLite.prepare` (7626); `Store.sql` (7626); `SQLite.get` (7627) | CORE |
| [packages/store/src/store.ts:7635](../../packages/store/src/store.ts#L7635) `Store/recoverContainersOut` | `SQLite.prepare` (7635); `Store.sql` (7635); `SQLite.get` (7638) | CORE |
| [packages/store/src/store.ts:7663](../../packages/store/src/store.ts#L7663) `Store/moveContainersOut` | `Store.sql` (7663, 7671, 7673, 7675, 7680, 7681, 7701, 7707, 7709, 7711, 7711, 7717, 7717, 7722, 7724, 7726, 7726, 7732); `SQLite.get` (7671); `SQLite.prepare` (7671, 7680, 7681); `Store.container` (7683) | CORE |
| [packages/store/src/store.ts:7741](../../packages/store/src/store.ts#L7741) `Store/moveContainersIn` | `Store.sql` (7741, 7747, 7749, 7750, 7751, 7752, 7772, 7777, 7777, 7788, 7791, 7794, 7801); `SQLite.prepare` (7749, 7750, 7751, 7752, 7788, 7794); `SQLite.get` (7754, 7788, 7794) | CORE |
| [packages/store/src/store.ts:7813](../../packages/store/src/store.ts#L7813) `Store/compactFile` | `Store.sql` (7813, 7814, 7816) | CORE |
| [packages/store/src/store.ts:7822](../../packages/store/src/store.ts#L7822) `Store/containerId` | `Store.containerId` (7822); `Store.row` (7823) | CORE |
| [packages/store/src/store.ts:7845](../../packages/store/src/store.ts#L7845) `Store/checkContainerWrite` | `Store.row` (7845) | CORE |
| [packages/store/src/store.ts:7854](../../packages/store/src/store.ts#L7854) `Store/setContainer` | `Store.sql` (7854, 7871); `Store.row` (7860); `SQLite.prepare` (7871) | CORE |
| [packages/store/src/store.ts:7904](../../packages/store/src/store.ts#L7904) `Store/orderBy` | `Store.valueListItems` (7904) | CORE |
| [packages/store/src/store.ts:7927](../../packages/store/src/store.ts#L7927) `Store/userPrefs` | `SQLite.all` (7927); `SQLite.prepare` (7927); `Store.sql` (7927) | CORE |
| [packages/store/src/store.ts:7932](../../packages/store/src/store.ts#L7932) `Store/hasTable` | `SQLite.get` (7932); `SQLite.prepare` (7932); `Store.sql` (7932) | CORE |
| [packages/store/src/store.ts:7936](../../packages/store/src/store.ts#L7936) `Store/setUserPref` | `Store.sql` (7936, 7937, 7938); `SQLite.prepare` (7937, 7938) | CORE |
| [packages/store/src/store.ts:7944](../../packages/store/src/store.ts#L7944) `Store/indexedFields` | `SQLite.all` (7944, 7945); `SQLite.prepare` (7944, 7945); `Store.sql` (7944, 7945) | CORE |
| [packages/store/src/store.ts:7966](../../packages/store/src/store.ts#L7966) `Store/addFieldIndex` | `Store.sql` (7966) | CORE |
| [packages/store/src/store.ts:7978](../../packages/store/src/store.ts#L7978) `Store/dropFieldIndex` | `SQLite.get` (7978); `SQLite.prepare` (7978); `Store.sql` (7978, 7979) | CORE |
| [packages/store/src/store.ts:7989](../../packages/store/src/store.ts#L7989) `Store/timeFind` | `Store.query` (7989, 7993, 7994); `Store.recordCount` (7996) | CORE |
| [packages/store/src/store.ts:8013](../../packages/store/src/store.ts#L8013) `Store/find` | `Store.find` (8013) | GATED-STORE |
| [packages/store/src/store.ts:8024](../../packages/store/src/store.ts#L8024) `Store/findHere` | `Store.query` (8024, 8029, 8031, 8045, 8047, 8058); `Store.recordCount` (8042); `SQLite.get` (8043, 8047); `SQLite.prepare` (8043, 8047, 8053, 8060, 8069); `Store.sql` (8043, 8047, 8053, 8060, 8069); `SQLite.all` (8053, 8060, 8069) | GATED-STORE |
| [packages/store/src/store.ts:8064](../../packages/store/src/store.ts#L8064) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (8064); `SQLite.prepare` (8064); `Store.sql` (8064) | GATED-STORE |
| [packages/store/src/store.ts:8097](../../packages/store/src/store.ts#L8097) `Store/sortedPage` | `SQLite.iterate` (8097); `SQLite.prepare` (8097, 8112); `Store.sql` (8097, 8112); `SQLite.all` (8112) | CORE |
| [packages/store/src/store.ts:8169](../../packages/store/src/store.ts#L8169) `Store/relatedCriteria/matched` | `relatedRows` (8169) | CORE |
| [packages/store/src/store.ts:8172](../../packages/store/src/store.ts#L8172) `Store/relatedCriteria` | `SQLite.iterate` (8172); `SQLite.prepare` (8172); `Store.sql` (8172) | CORE |
| [packages/store/src/store.ts:8198](../../packages/store/src/store.ts#L8198) `Store/computedRows` | `Store.sql` (8198, 8201, 8202, 8203, 8205, 8215, 8216, 8217, 8220); `SQLite.prepare` (8201, 8203, 8205, 8215); `SQLite.iterate` (8205); `Calculations.globalValue` (8208); `Calculations.unstoredValue` (8209); `Calculations.related` (8212); `SQLite.all` (8215) | CORE |
| [packages/store/src/store.ts:8245](../../packages/store/src/store.ts#L8245) `Store/summaries` | `Calculations.wholeTable` (8245); `Calculations.collect` (8265, 8270) | CORE |
| [packages/store/src/store.ts:8261](../../packages/store/src/store.ts#L8261) `Store/summaries/recs` | `SQLite.iterate` (8261); `SQLite.prepare` (8261); `Store.sql` (8261) | CORE |
| [packages/store/src/store.ts:8283](../../packages/store/src/store.ts#L8283) `Store/runningSummaryValues` | `Store.viewableIds` (8283); `rowsById` (8285); `Calculations.value` (8296, 8302); `Calculations.related` (8313) | GATED-STORE |
| [packages/store/src/store.ts:8329](../../packages/store/src/store.ts#L8329) `Store/findSource` | `Store.query` (8329); `SQLite.all` (8338, 8355); `SQLite.prepare` (8338, 8346, 8354); `Store.sql` (8338, 8343, 8346, 8351, 8354, 8368, 8370); `Calculations.globalValue` (8360); `Calculations.unstoredValue` (8361); `Calculations.related` (8365) | CORE |
| [packages/store/src/store.ts:8385](../../packages/store/src/store.ts#L8385) `Store/findCandidates` | `Store.query` (8385) | CORE |
| [packages/store/src/store.ts:8420](../../packages/store/src/store.ts#L8420) `Store/previewRow` | `Store.row` (8420) | CORE |
| [packages/store/src/store.ts:8438](../../packages/store/src/store.ts#L8438) `Store/row` | `SQLite.get` (8438) | CORE |
| [packages/store/src/store.ts:8457](../../packages/store/src/store.ts#L8457) `Store/getCurrent` | `Store.get` (8457); `Store.row` (8458, 8458, 8472); `SQLite.all` (8475); `SQLite.prepare` (8475); `Store.sql` (8475) | GATED-STORE |
| [packages/store/src/store.ts:8495](../../packages/store/src/store.ts#L8495) `Store/getManyCurrent` | `Store.getMany` (8495); `SQLite.get` (8513); `SQLite.prepare` (8513); `Store.sql` (8513) | GATED-STORE |
| [packages/store/src/store.ts:8506](../../packages/store/src/store.ts#L8506) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8506) | GATED-STORE |
| [packages/store/src/store.ts:8529](../../packages/store/src/store.ts#L8529) `Store/canViewRecord` | `SQLite.get` (8529); `SQLite.prepare` (8529); `Store.sql` (8529) | GATED-STORE |
| [packages/store/src/store.ts:8547](../../packages/store/src/store.ts#L8547) `Store/canView` | `Store.canView` (8547); `Store.row` (8548) | GATED-STORE |
| [packages/store/src/store.ts:8572](../../packages/store/src/store.ts#L8572) `Store/create` | `SQLite.get` (8572, 8578); `SQLite.prepare` (8572, 8578, 8591); `Store.sql` (8572, 8578, 8591) | CORE |
| [packages/store/src/store.ts:8615](../../packages/store/src/store.ts#L8615) `Store/duplicate` | `Store.row` (8615); `SQLite.get` (8619); `SQLite.prepare` (8619, 8634); `Store.sql` (8619, 8634) | CORE |
| [packages/store/src/store.ts:8689](../../packages/store/src/store.ts#L8689) `Store/update` | `Store.row` (8689); `Store.sql` (8719, 8720, 8759, 8762) | CORE |
| [packages/store/src/store.ts:8722](../../packages/store/src/store.ts#L8722) `Store/update/undo` | `Store.sql` (8722) | CORE |
| [packages/store/src/store.ts:8867](../../packages/store/src/store.ts#L8867) `Store/setStoredCalcValues` | `SQLite.prepare` (8867, 8868); `Store.sql` (8867, 8868); `SQLite.get` (8872) | CORE |
| [packages/store/src/store.ts:8956](../../packages/store/src/store.ts#L8956) `Store/evaluateCurrent` | `Store.row` (8956, 8956, 8957, 8957); `Calculations.context` (8962); `Store.get` (8963, 8965) | GATED-STORE |
| [packages/store/src/store.ts:8997](../../packages/store/src/store.ts#L8997) `Store/evaluateEachCurrent` | `Store.row` (8997, 8997, 9002); `Calculations.context` (9003); `Store.get` (9005) | GATED-STORE |
| [packages/store/src/store.ts:9038](../../packages/store/src/store.ts#L9038) `Store/evaluateRowsCurrent/each` | `Calculations.context` (9038); `Store.get` (9040) | GATED-STORE |
| [packages/store/src/store.ts:9059](../../packages/store/src/store.ts#L9059) `Store/evaluateRowsCurrent` | `Store.row` (9059, 9059, 9060, 9060) | GATED-STORE |
| [packages/store/src/store.ts:9074](../../packages/store/src/store.ts#L9074) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (9074) | GATED-STORE |
| [packages/store/src/store.ts:9096](../../packages/store/src/store.ts#L9096) `Store/evaluateRowsCurrent/key` | `Calculations.context` (9096) | GATED-STORE |
| [packages/store/src/store.ts:9134](../../packages/store/src/store.ts#L9134) `Store/updateRelated` | `relatedRows` (9134) | CORE |
| [packages/store/src/store.ts:9152](../../packages/store/src/store.ts#L9152) `Store/updatePortals` | `Store.row` (9152, 9188); `relatedRows` (9189) | CORE |
| [packages/store/src/store.ts:9162](../../packages/store/src/store.ts#L9162) `Store/updatePortals/portal/related` | `relatedIdList` (9162) | CORE |
| [packages/store/src/store.ts:9244](../../packages/store/src/store.ts#L9244) `Store/portalContainerTarget` | `Store.row` (9244); `relatedIdList` (9246) | CORE |
| [packages/store/src/store.ts:9259](../../packages/store/src/store.ts#L9259) `Store/checkEditable` | `Store.row` (9259) | CORE |
| [packages/store/src/store.ts:9283](../../packages/store/src/store.ts#L9283) `Store/delete` | `Store.row` (9283) | CORE |
| [packages/store/src/store.ts:9291](../../packages/store/src/store.ts#L9291) `Store/delete/run` | `SQLite.get` (9291); `SQLite.prepare` (9291, 9295); `Store.sql` (9291, 9295) | CORE |
| [packages/store/src/store.ts:9523](../../packages/store/src/store.ts#L9523) `Store/keyStepWork` | `Store.sql` (9523, 9529, 9533, 9535) | CORE |
| [packages/store/src/store.ts:9324](../../packages/store/src/store.ts#L9324) `Store/vaultHeld` | `SQLite.get` (9324); `SQLite.prepare` (9324); `Store.sql` (9324) | CORE |
| [packages/store/src/store.ts:9331](../../packages/store/src/store.ts#L9331) `Store/forgetStandInValues` | `Store.sql` (9331, 9352); `SQLite.prepare` (9352) | CORE |
| [packages/store/src/store.ts:9371](../../packages/store/src/store.ts#L9371) `Store/restoreDeletedRowLocked` | `SQLite.get` (9371); `SQLite.prepare` (9371, 9372, 9376); `Store.sql` (9371, 9372, 9376); `SQLite.all` (9372) | CORE |
| [packages/store/src/store.ts:9576](../../packages/store/src/store.ts#L9576) `Store/cascadeDelete` | `relatedRows` (9576) | CORE |
| [packages/store/src/store.ts:9666](../../packages/store/src/store.ts#L9666) `Store/selectIdsCurrent` | `Store.selectIds` (9666); `SQLite.all` (9672); `SQLite.prepare` (9672); `Store.sql` (9672) | GATED-STORE |
| [packages/store/src/store.ts:9680](../../packages/store/src/store.ts#L9680) `Store/countIds` | `Store.countIds` (9680); `SQLite.get` (9684); `SQLite.prepare` (9684); `Store.sql` (9684) | GATED-STORE |
| [packages/store/src/store.ts:9700](../../packages/store/src/store.ts#L9700) `Store/computeValuesCurrent` | `Store.computeValues` (9700); `Store.sql` (9706, 9710); `SQLite.all` (9710); `SQLite.prepare` (9710) | GATED-STORE |
| [packages/store/src/store.ts:9725](../../packages/store/src/store.ts#L9725) `Store/findIdsCurrent` | `Store.findIds` (9725) | GATED-STORE |
| [packages/store/src/store.ts:9731](../../packages/store/src/store.ts#L9731) `Store/findIdsHere` | `Store.query` (9731, 9736, 9738); `SQLite.iterate` (9749); `SQLite.prepare` (9749); `Store.sql` (9749) | GATED-STORE |
| [packages/store/src/store.ts:9766](../../packages/store/src/store.ts#L9766) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9766); `Store.viewableIds` (9771); `Calculations.collect` (9787); `rowsById` (9787, 9837); `Calculations.collector` (9809) | GATED-STORE |
| [packages/store/src/store.ts:9799](../../packages/store/src/store.ts#L9799) `Store/groupSummariesCurrent/key` | `Calculations.value` (9799); `Calculations.related` (9801) | GATED-STORE |
| [packages/store/src/store.ts:9835](../../packages/store/src/store.ts#L9835) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9835) | GATED-STORE |
| [packages/store/src/store.ts:9891](../../packages/store/src/store.ts#L9891) `Store/sortIdsCurrentProgress` | `SQLite.all` (9891); `SQLite.prepare` (9891, 9959); `Store.sql` (9891, 9959); `Store.valueListItems` (9899); `rowsById` (9911); `Calculations.globalValue` (9914); `Calculations.unstoredValue` (9915); `Calculations.related` (9921); `SQLite.iterate` (9959) | GATED-STORE |
| [packages/store/src/store.ts:9973](../../packages/store/src/store.ts#L9973) `Store/matchIds` | `Store.matchIds` (9973); `SQLite.all` (9979); `SQLite.prepare` (9979); `Store.sql` (9979) | CORE |
| [packages/store/src/store.ts:10001](../../packages/store/src/store.ts#L10001) `Store/truncate/run` | `Store.sql` (10001, 10003, 10010, 10012, 10014, 10015); `SQLite.prepare` (10003, 10010); `SQLite.all` (10005) | CORE |
| [packages/store/src/store.ts:10040](../../packages/store/src/store.ts#L10040) `Store/iterateCommitted` | `SQLite.iterate` (10040) | CORE |
| [packages/store/src/store.ts:10074](../../packages/store/src/store.ts#L10074) `Store/readOnlyChecked` | `SQLite.prepare` (10074, 10078, 10087, 10092); `SQLite.all` (10078, 10087, 10092) | CORE |
| [packages/store/src/store.ts:10114](../../packages/store/src/store.ts#L10114) `Store/refreshDecimalSqlViews` | `SQLite.get` (10114); `SQLite.prepare` (10114, 10119); `SQLite.all` (10119) | CORE |
| [packages/store/src/store.ts:10133](../../packages/store/src/store.ts#L10133) `Store/internalRoots` | `SQLite.get` (10133); `SQLite.prepare` (10133, 10135); `SQLite.all` (10135) | CORE |
| [packages/store/src/store.ts:10168](../../packages/store/src/store.ts#L10168) `Store/selectCurrent` | `SQLite.iterate` (10168) | CORE |
| [packages/store/src/store.ts:10217](../../packages/store/src/store.ts#L10217) `Store/query` | `SQLite.iterate` (10217) | CORE |
| [packages/store/src/store.ts:10251](../../packages/store/src/store.ts#L10251) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10251); `SQLite.all` (10258, 10261); `SQLite.prepare` (10258, 10261) | CORE |
| [packages/store/src/store.ts:1211](../../packages/store/src/store.ts#L1211) `Store/ensureNativeIds` | `SQLite.all` (1211, 1223); `SQLite.prepare` (1211, 1214, 1222, 1223); `Store.sql` (1211, 1214, 1217, 1221, 1222, 1223, 1226, 1228) | CORE |
| [packages/store/src/store.ts:1236](../../packages/store/src/store.ts#L1236) `Store/nativeIdGuards` | `Store.sql` (1236, 1237, 1239) | CORE |
| [packages/store/src/store.ts:10184](../../packages/store/src/store.ts#L10184) `Store/selectIn` | `Store.select` (10184) | CORE |
| [packages/store/src/store.ts:10192](../../packages/store/src/store.ts#L10192) `Store/selectHeldCurrent` | `Store.sql` (10192, 10193); `SQLite.prepare` (10193); `SQLite.iterate` (10196) | CORE |
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
| [packages/server/src/oauth.ts:854](../../packages/server/src/oauth.ts#L854) `OAuthServer/endGrant` | `SQLite.prepare` (854, 855); `SQLite.all` (855) | AUTH |
| [packages/server/src/oauth.ts:810](../../packages/server/src/oauth.ts#L810) `OAuthServer/issue/write` | `SQLite.get` (810); `SQLite.prepare` (810, 811, 812) | AUTH |
| [packages/server/src/backup.ts:268](../../packages/server/src/backup.ts#L268) `backupOnceHeld` | `SQLite.get` (268); `SQLite.prepare` (268) | OPERATOR |
| [packages/store/src/store.ts:1674](../../packages/store/src/store.ts#L1674) `Store/selfContainedCopy` | `Store.sql` (1674); `SQLite.all` (1679); `SQLite.prepare` (1679, 1681, 1682, 1683) | CORE |
| [packages/store/src/store.ts:7220](../../packages/store/src/store.ts#L7220) `Store/containerReferences` | `SQLite.all` (7220, 7239, 7241, 7247, 7260, 7271, 7285); `SQLite.prepare` (7220, 7239, 7241, 7247, 7260, 7271, 7283, 7285); `Store.sql` (7220, 7239, 7241, 7247, 7260, 7271, 7283, 7285); `SQLite.get` (7283); `Store.row` (7294) | CORE |
| [packages/store/src/store.ts:7318](../../packages/store/src/store.ts#L7318) `Store/containerIntegrityReport` | `SQLite.all` (7318); `SQLite.prepare` (7318, 7329); `Store.sql` (7318, 7329); `SQLite.get` (7329) | CORE |
| [packages/store/src/store.ts:1422](../../packages/store/src/store.ts#L1422) `Store/recoverPendingExternalFiles` | `Store.sql` (1422, 1424, 1443, 1445); `SQLite.prepare` (1424); `SQLite.get` (1433) | CORE |
| [packages/store/src/store.ts:2258](../../packages/store/src/store.ts#L2258) `Store/restoreRecord` | `Store.recordAsOf` (2258); `SQLite.get` (2262); `SQLite.prepare` (2262, 2266, 2275, 2286); `Store.sql` (2262, 2266, 2275, 2286) | CORE |
| [packages/store/src/store.ts:8946](../../packages/store/src/store.ts#L8946) `Store/recordViewable` | `Store.row` (8946) | GATED-STORE |
| [packages/server/src/compaction.ts:65](../../packages/server/src/compaction.ts#L65) `compactStore` | `SQLite.get` (65, 66, 80, 88); `SQLite.prepare` (65, 66, 80, 88) | OPERATOR |
<!-- end generated read-gate inventory -->
