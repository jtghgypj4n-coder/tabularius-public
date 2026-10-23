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
| [packages/scripts/src/data-api-step.ts:103](../../packages/scripts/src/data-api-step.ts#L103) `respond` | `Store.get` (103, 130, 139); `Store.find` (104, 116) | SCRIPT |
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
| [packages/scripts/src/engine.ts:5634](../../packages/scripts/src/engine.ts#L5634) `ScriptEngine/valueOf` | `Store.findIds` (5634); `Store.containerId` (5642) | SCRIPT |
| [packages/scripts/src/engine.ts:5659](../../packages/scripts/src/engine.ts#L5659) `ScriptEngine/lookupNext` | `Store.get` (5659); `Store.row` (5660); `Calculations.context` (5662) | SCRIPT |
| [packages/scripts/src/engine.ts:5762](../../packages/scripts/src/engine.ts#L5762) `ScriptEngine/relatedIds` | `Store.findIds` (5762); `rowsById` (5770); `Store.select` (5774); `Store.matchIds` (5788); `Store.viewableIds` (5811) | SCRIPT |
| [packages/scripts/src/engine.ts:5796](../../packages/scripts/src/engine.ts#L5796) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5796) | SCRIPT |
| [packages/scripts/src/engine.ts:6285](../../packages/scripts/src/engine.ts#L6285) `ScriptEngine/exportField` | `Store.get` (6285); `Store.containerId` (6286); `Store.container` (6288) | SCRIPT |
| [packages/scripts/src/engine.ts:6436](../../packages/scripts/src/engine.ts#L6436) `ScriptEngine/relookup` | `Store.get` (6436) | SCRIPT |
| [packages/scripts/src/engine.ts:6856](../../packages/scripts/src/engine.ts#L6856) `ScriptEngine/goToList` | `Store.findIds` (6856) | SCRIPT |
| [packages/scripts/src/engine.ts:7185](../../packages/scripts/src/engine.ts#L7185) `ScriptEngine/sourceValue` | `Store.get` (7185); `Store.containerId` (7186); `Store.container` (7187) | SCRIPT |
| [packages/scripts/src/engine.ts:7920](../../packages/scripts/src/engine.ts#L7920) `ScriptEngine/containerFile` | `Store.get` (7920); `Store.containerId` (7921); `Store.container` (7922) | SCRIPT |
| [packages/scripts/src/engine.ts:8082](../../packages/scripts/src/engine.ts#L8082) `ScriptEngine/importRecords` | `Store.findIds` (8082); `Store.get` (8102) | SCRIPT |
| [packages/scripts/src/engine.ts:8313](../../packages/scripts/src/engine.ts#L8313) `ScriptEngine/fileMakerRows` | `Store.findIds` (8313); `Store.get` (8318) | SCRIPT |
| [packages/scripts/src/engine.ts:8353](../../packages/scripts/src/engine.ts#L8353) `ScriptEngine/newRecord` | `Store.findIds` (8353) | SCRIPT |
| [packages/scripts/src/engine.ts:8658](../../packages/scripts/src/engine.ts#L8658) `ScriptEngine/performFind` | `Store.findIds` (8658) | SCRIPT |
| [packages/scripts/src/engine.ts:8683](../../packages/scripts/src/engine.ts#L8683) `ScriptEngine/findRelated` | `Store.findIds` (8683, 8693, 8696) | SCRIPT |
| [packages/scripts/src/engine.ts:8715](../../packages/scripts/src/engine.ts#L8715) `ScriptEngine/quickFind` | `Store.findIds` (8715, 8716, 8719) | SCRIPT |
| [packages/scripts/src/engine.ts:9103](../../packages/scripts/src/engine.ts#L9103) `clearRecords` | `SQLite.all` (9103); `SQLite.prepare` (9103) | SCRIPT |
| [packages/scripts/src/recorder.ts:83](../../packages/scripts/src/recorder.ts#L83) `lastSeq` | `Store.auditLog` (83) | DESIGN |
| [packages/scripts/src/recorder.ts:121](../../packages/scripts/src/recorder.ts#L121) `recordRun` | `Store.auditLog` (121) | DESIGN |
| [packages/scripts/src/script-tests.ts:213](../../packages/scripts/src/script-tests.ts#L213) `runCase` | `Store.findIds` (213); `Store.auditLog` (220, 221, 265); `Store.evaluateEach` (248) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/server/src/admin.ts:991](../../packages/server/src/admin.ts#L991) `Admin/handle` | `Store.externalContainerReport` (991); `Store.orphanContainerReport` (996, 1000) | ADMIN |
| [packages/server/src/admin.ts:2163](../../packages/server/src/admin.ts#L2163) `Admin/audit` | `Store.auditLog` (2163) | ADMIN |
| [packages/server/src/admin.ts:2246](../../packages/server/src/admin.ts#L2246) `Admin/viewAs` | `Store.find` (2246) | ADMIN |
| [packages/server/src/admin.ts:2594](../../packages/server/src/admin.ts#L2594) `Admin/status` | `Store.externalContainerCount` (2594) | ADMIN |
| [packages/server/src/agent.ts:154](../../packages/server/src/agent.ts#L154) `runStep/visible` | `Store.findIds` (154) | DESIGN |
| [packages/server/src/agent.ts:162](../../packages/server/src/agent.ts#L162) `runStep` | `Store.findIds` (162); `Store.auditLog` (221) | DESIGN |
| [packages/server/src/agent.ts:303](../../packages/server/src/agent.ts#L303) `dryRunPlan` | `Store.findIds` (303) | DESIGN |
| [packages/server/src/agent.ts:326](../../packages/server/src/agent.ts#L326) `runApprovedStep` | `Store.findIds` (326) | DESIGN |
| [packages/server/src/ai-output.ts:147](../../packages/server/src/ai-output.ts#L147) `storedSecretValues` | `Calculations.globalValue` (147); `Store.select` (152) | REDACTION |
| [packages/server/src/ai-policy-sql.ts:49](../../packages/server/src/ai-policy-sql.ts#L49) `sqlFieldRefs` | `SQLite.all` (49, 51); `SQLite.prepare` (49, 51) | POLICY |
| [packages/server/src/ai-policy.ts:338](../../packages/server/src/ai-policy.ts#L338) `sql` | `Store.inspectQuery` (338) | POLICY |
| [packages/server/src/ai-usage.ts:141](../../packages/server/src/ai-usage.ts#L141) `AiUsage/today` | `SQLite.get` (141); `SQLite.prepare` (141) | AUTH |
| [packages/server/src/ai-usage.ts:148](../../packages/server/src/ai-usage.ts#L148) `AiUsage/month` | `SQLite.get` (148); `SQLite.prepare` (148) | AUTH |
| [packages/server/src/ai-usage.ts:155](../../packages/server/src/ai-usage.ts#L155) `AiUsage/recent` | `SQLite.all` (155); `SQLite.prepare` (155) | AUTH |
| [packages/server/src/ai-usage.ts:163](../../packages/server/src/ai-usage.ts#L163) `AiUsage/add` | `SQLite.prepare` (163, 166) | AUTH |
| [packages/server/src/ai-usage.ts:174](../../packages/server/src/ai-usage.ts#L174) `AiUsage/question` | `SQLite.prepare` (174, 176, 177, 179) | AUTH |
| [packages/server/src/ai-usage.ts:203](../../packages/server/src/ai-usage.ts#L203) `AiUsage/importOld` | `SQLite.prepare` (203, 213, 221, 225) | AUTH |
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
| [packages/server/src/backup.ts:993](../../packages/server/src/backup.ts#L993) `accountDifferences/read` | `SQLite.all` (993, 995); `SQLite.prepare` (993, 995) | OPERATOR |
| [packages/server/src/backup.ts:1020](../../packages/server/src/backup.ts#L1020) `readNames` | `SQLite.all` (1020); `SQLite.prepare` (1020) | OPERATOR |
| [packages/server/src/backup.ts:1050](../../packages/server/src/backup.ts#L1050) `credentialsReadable` | `SQLite.all` (1050); `SQLite.prepare` (1050) | OPERATOR |
| [packages/server/src/backup.ts:1066](../../packages/server/src/backup.ts#L1066) `columnInfo` | `SQLite.all` (1066); `SQLite.prepare` (1066) | OPERATOR |
| [packages/server/src/backup.ts:1101](../../packages/server/src/backup.ts#L1101) `reconcileCredentials` | `SQLite.all` (1101, 1123, 1138, 1148, 1154); `SQLite.prepare` (1101, 1109, 1123, 1125, 1138, 1139, 1146, 1148, 1149, 1154, 1155, 1159, 1160, 1161); `SQLite.get` (1109, 1159) | OPERATOR |
| [packages/server/src/backup.ts:1104](../../packages/server/src/backup.ts#L1104) `reconcileCredentials/has` | `SQLite.all` (1104); `SQLite.prepare` (1104) | OPERATOR |
| [packages/server/src/backup.ts:1128](../../packages/server/src/backup.ts#L1128) `reconcileCredentials/accountColumns` | `SQLite.all` (1128); `SQLite.prepare` (1128) | OPERATOR |
| [packages/server/src/backup.ts:1273](../../packages/server/src/backup.ts#L1273) `stageRestorePoint` | `SQLite.get` (1273, 1275, 1276); `SQLite.prepare` (1273, 1275, 1276) | OPERATOR |
| [packages/server/src/calendar.ts:389](../../packages/server/src/calendar.ts#L389) `CalendarFeeds/feed` | `Store.find` (389) | CALENDAR |
| [packages/server/src/changes.ts:185](../../packages/server/src/changes.ts#L185) `ChangeFeed/visible` | `Store.canViewRecord` (185) | CHANGE |
| [packages/server/src/cleanup.ts:327](../../packages/server/src/cleanup.ts#L327) `scanData` | `Store.findIds` (327); `Store.select` (333) | CLEANUP |
| [packages/server/src/cleanup.ts:584](../../packages/server/src/cleanup.ts#L584) `keyValue` | `SQLite.get` (584); `SQLite.prepare` (584); `Store.sql` (584) | CLEANUP |
| [packages/server/src/cleanup.ts:588](../../packages/server/src/cleanup.ts#L588) `relatedIds` | `SQLite.all` (588); `SQLite.prepare` (588); `Store.sql` (588) | CLEANUP |
| [packages/server/src/cleanup.ts:705](../../packages/server/src/cleanup.ts#L705) `applyCleanup/apply` | `Store.findIds` (705, 715); `SQLite.all` (706); `SQLite.prepare` (706, 743); `Store.sql` (706, 743); `SQLite.get` (743) | CLEANUP |
| [packages/server/src/cleanup.ts:774](../../packages/server/src/cleanup.ts#L774) `snapshotField` | `SQLite.all` (774); `SQLite.prepare` (774); `Store.sql` (774) | CLEANUP |
| [packages/server/src/cleanup.ts:834](../../packages/server/src/cleanup.ts#L834) `snapshotRows` | `SQLite.all` (834); `SQLite.prepare` (834); `Store.sql` (834) | CLEANUP |
| [packages/server/src/cleanup.ts:843](../../packages/server/src/cleanup.ts#L843) `journalDeletes` | `SQLite.get` (843); `SQLite.prepare` (843); `Store.sql` (843) | CLEANUP |
| [packages/server/src/cleanup.ts:893](../../packages/server/src/cleanup.ts#L893) `updateMany` | `Store.findIds` (893) | CLEANUP |
| [packages/server/src/cleanup.ts:953](../../packages/server/src/cleanup.ts#L953) `undoCleanup` | `SQLite.get` (953, 969); `SQLite.prepare` (953, 969); `Store.sql` (953, 969) | CLEANUP |
| [packages/server/src/cleanup.ts:993](../../packages/server/src/cleanup.ts#L993) `CleanupJournal/constructor` | `Store.sql` (993) | CLEANUP |
| [packages/server/src/cleanup.ts:1002](../../packages/server/src/cleanup.ts#L1002) `CleanupJournal/append` | `SQLite.prepare` (1002); `Store.sql` (1002) | CLEANUP |
| [packages/server/src/cleanup.ts:1007](../../packages/server/src/cleanup.ts#L1007) `CleanupJournal/add` | `SQLite.prepare` (1007); `Store.sql` (1007) | CLEANUP |
| [packages/server/src/cleanup.ts:1013](../../packages/server/src/cleanup.ts#L1013) `CleanupJournal/get` | `SQLite.get` (1013); `SQLite.prepare` (1013); `Store.sql` (1013) | CLEANUP |
| [packages/server/src/cleanup.ts:1018](../../packages/server/src/cleanup.ts#L1018) `CleanupJournal/list` | `SQLite.all` (1018); `SQLite.prepare` (1018); `Store.sql` (1018) | CLEANUP |
| [packages/server/src/cleanup.ts:1022](../../packages/server/src/cleanup.ts#L1022) `CleanupJournal/markUndone` | `SQLite.prepare` (1022); `Store.sql` (1022) | CLEANUP |
| [packages/server/src/compare.ts:203](../../packages/server/src/compare.ts#L203) `count` | `Store.query` (203) | DESIGN |
| [packages/server/src/containers.ts:130](../../packages/server/src/containers.ts#L130) `ContainerFiles/send` | `Store.containerInfo` (130); `Store.container` (196); `Store.containerRange` (205) | CONTAINER |
| [packages/server/src/containers.ts:293](../../packages/server/src/containers.ts#L293) `ContainerFiles/make` | `Store.containerInfo` (293) | CONTAINER |
| [packages/server/src/containers.ts:305](../../packages/server/src/containers.ts#L305) `ContainerFiles/makeAdmitted` | `Store.container` (305) | CONTAINER |
| [packages/server/src/conversion-guide.ts:118](../../packages/server/src/conversion-guide.ts#L118) `convertedAt` | `SQLite.get` (118); `SQLite.prepare` (118); `Store.sql` (118) | DESIGN |
| [packages/server/src/conversion-guide.ts:360](../../packages/server/src/conversion-guide.ts#L360) `ConversionGuides/table` | `Store.sql` (360) | DESIGN |
| [packages/server/src/conversion-guide.ts:370](../../packages/server/src/conversion-guide.ts#L370) `ConversionGuides/saved` | `SQLite.get` (370); `SQLite.prepare` (370); `Store.sql` (370) | DESIGN |
| [packages/server/src/conversion-guide.ts:379](../../packages/server/src/conversion-guide.ts#L379) `ConversionGuides/save` | `SQLite.prepare` (379); `Store.sql` (379) | DESIGN |
| [packages/server/src/conversion.ts:299](../../packages/server/src/conversion.ts#L299) `conversionReport` | `Store.externalContainerCheck` (299) | DESIGN |
| [packages/server/src/cwp-xml.ts:457](../../packages/server/src/cwp-xml.ts#L457) `CwpXmlEndpoint/records` | `Store.find` (457, 459, 460, 466, 469); `Store.get` (465, 473) | XML |
| [packages/server/src/cwp-xml.ts:541](../../packages/server/src/cwp-xml.ts#L541) `CwpXmlEndpoint/layoutDoc` | `Store.valueListItems` (541) | XML |
| [packages/server/src/dashboards.ts:327](../../packages/server/src/dashboards.ts#L327) `Dashboards/table` | `Store.sql` (327) | DASHBOARD |
| [packages/server/src/dashboards.ts:337](../../packages/server/src/dashboards.ts#L337) `Dashboards/list` | `SQLite.all` (337); `SQLite.prepare` (337); `Store.sql` (337) | DASHBOARD |
| [packages/server/src/dashboards.ts:343](../../packages/server/src/dashboards.ts#L343) `Dashboards/get` | `SQLite.get` (343); `SQLite.prepare` (343); `Store.sql` (343) | DASHBOARD |
| [packages/server/src/dashboards.ts:357](../../packages/server/src/dashboards.ts#L357) `Dashboards/create` | `SQLite.prepare` (357); `Store.sql` (357) | DASHBOARD |
| [packages/server/src/dashboards.ts:370](../../packages/server/src/dashboards.ts#L370) `Dashboards/update` | `SQLite.prepare` (370); `Store.sql` (370) | DASHBOARD |
| [packages/server/src/dashboards.ts:377](../../packages/server/src/dashboards.ts#L377) `Dashboards/delete` | `SQLite.prepare` (377); `Store.sql` (377) | DASHBOARD |
| [packages/server/src/dataapi.ts:1915](../../packages/server/src/dataapi.ts#L1915) `DataApi/route` | `Store.get` (1915, 2137, 2160, 2168, 2215, 2239, 2259, 2296); `Store.valueListItems` (1930); `Store.find` (2092, 2139, 2329); `Store.findIds` (2096, 2334); `Store.query` (2334) | REST |
| [packages/server/src/dataapi.ts:2044](../../packages/server/src/dataapi.ts#L2044) `DataApi/route/recordOut` | `Store.portalCounts` (2044) | REST |
| [packages/server/src/dataapi.ts:2080](../../packages/server/src/dataapi.ts#L2080) `DataApi/route/shownAs` | `Store.get` (2080) | REST |
| [packages/server/src/debug.ts:189](../../packages/server/src/debug.ts#L189) `learnStoredCredentials` | `Calculations.globalValue` (189); `Store.sql` (195, 205, 205); `SQLite.iterate` (205, 205); `SQLite.prepare` (205, 205); `Store.iterateCommitted` (205) | DESIGN |
| [packages/server/src/debug.ts:315](../../packages/server/src/debug.ts#L315) `DebugApi/handle` | `Store.row` (315, 434); `Store.get` (324, 439); `Store.evaluate` (347) | DESIGN |
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
| [packages/server/src/import-mapping.ts:500](../../packages/server/src/import-mapping.ts#L500) `existingKeys` | `Store.viewableIds` (500); `Store.query` (502) | IMPORT |
| [packages/server/src/import-mapping.ts:762](../../packages/server/src/import-mapping.ts#L762) `applyImportRun` | `SQLite.prepare` (762); `Store.sql` (762) | IMPORT |
| [packages/server/src/import-mapping.ts:962](../../packages/server/src/import-mapping.ts#L962) `applyImportAddStream` | `SQLite.prepare` (962); `Store.sql` (962) | IMPORT |
| [packages/server/src/import-mapping.ts:779](../../packages/server/src/import-mapping.ts#L779) `targetKeys` | `SQLite.all` (779); `SQLite.prepare` (779); `Store.sql` (779) | IMPORT |
| [packages/server/src/import-mapping.ts:791](../../packages/server/src/import-mapping.ts#L791) `journal` | `Store.sql` (791, 794, 794); `SQLite.all` (794); `SQLite.prepare` (794) | IMPORT |
| [packages/server/src/import-mapping.ts:850](../../packages/server/src/import-mapping.ts#L850) `importHistory` | `SQLite.all` (850); `SQLite.prepare` (850); `Store.sql` (850) | IMPORT |
| [packages/server/src/import-mapping.ts:857](../../packages/server/src/import-mapping.ts#L857) `undoImportRun` | `SQLite.get` (857, 880); `SQLite.prepare` (857, 880, 894); `Store.sql` (857, 880, 894) | IMPORT |
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
| [packages/server/src/mcp-design.ts:508](../../packages/server/src/mcp-design.ts#L508) `registerDesignTools/audit_log` | `Store.auditLog` (508) | DESIGN |
| [packages/server/src/mcp.ts:964](../../packages/server/src/mcp.ts#L964) `createMcpServer/find_records` | `Store.find` (964) | MCP |
| [packages/server/src/mcp.ts:977](../../packages/server/src/mcp.ts#L977) `createMcpServer/get_record` | `Store.get` (977) | MCP |
| [packages/server/src/mcp.ts:1027](../../packages/server/src/mcp.ts#L1027) `createMcpServer/update_record` | `Store.get` (1027, 1031) | MCP |
| [packages/server/src/mcp.ts:1084](../../packages/server/src/mcp.ts#L1084) `createMcpServer/evaluate_calculation` | `Store.get` (1084, 1092); `Store.find` (1085); `Store.evaluate` (1086); `Store.row` (1091) | SQL |
| [packages/server/src/mcp.ts:1159](../../packages/server/src/mcp.ts#L1159) `createMcpServer/get_container` | `Store.container` (1159) | SQL |
| [packages/server/src/mcp.ts:1183](../../packages/server/src/mcp.ts#L1183) `createMcpServer/sql_query` | `Store.queryWithOrigins` (1183) | SQL |
| [packages/server/src/mcp.ts:1340](../../packages/server/src/mcp.ts#L1340) `createMcpServer/explain_value` | `Store.get` (1340); `Store.row` (1341) | MCP |
| [packages/server/src/mcp.ts:1363](../../packages/server/src/mcp.ts#L1363) `createMcpServer/check_record` | `Store.get` (1363); `Store.row` (1365) | MCP |
| [packages/server/src/mcp.ts:1387](../../packages/server/src/mcp.ts#L1387) `createMcpServer/explain_related` | `Store.get` (1387) | MCP |
| [packages/server/src/mcp.ts:2281](../../packages/server/src/mcp.ts#L2281) `registerResources/audit` | `Store.auditLog` (2281) | MCP |
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
| [packages/server/src/odata.ts:927](../../packages/server/src/odata.ts#L927) `ODataEndpoint/resource` | `Store.countIds` (927); `Store.get` (967, 974, 1081) | ODATA |
| [packages/server/src/odata.ts:1213](../../packages/server/src/odata.ts#L1213) `ODataEndpoint/lambdaFor` | `Store.selectIds` (1213); `Store.row` (1222); `relatedIdList` (1223) | ODATA |
| [packages/server/src/odata.ts:1276](../../packages/server/src/odata.ts#L1276) `ODataEndpoint/list` | `Store.selectIds` (1276); `Store.getMany` (1281); `Store.computeValues` (1282); `Store.countIds` (1287) | ODATA |
| [packages/server/src/odata.ts:1334](../../packages/server/src/odata.ts#L1334) `ODataEndpoint/applied` | `Store.selectIds` (1334); `SQLite.prepare` (1349, 1386, 1399, 1403); `Store.getMany` (1360); `SQLite.all` (1399); `SQLite.get` (1403) | ODATA |
| [packages/server/src/odata.ts:1453](../../packages/server/src/odata.ts#L1453) `ODataEndpoint/crossjoined` | `Store.selectIds` (1453); `Store.getMany` (1482, 1517) | ODATA |
| [packages/server/src/odata.ts:1553](../../packages/server/src/odata.ts#L1553) `ODataEndpoint/entity` | `Store.getMany` (1553) | ODATA |
| [packages/server/src/odata.ts:1585](../../packages/server/src/odata.ts#L1585) `ODataEndpoint/relatedIds` | `Store.row` (1585); `relatedIdList` (1588, 1603); `Store.selectIds` (1592); `Store.viewableIds` (1602) | ODATA |
| [packages/server/src/odata.ts:1611](../../packages/server/src/odata.ts#L1611) `ODataEndpoint/relatedRecords` | `Store.getMany` (1611) | ODATA |
| [packages/server/src/odata.ts:1635](../../packages/server/src/odata.ts#L1635) `ODataEndpoint/property` | `Store.containerId` (1635); `Store.container` (1641) | ODATA |
| [packages/server/src/oidc.ts:188](../../packages/server/src/oidc.ts#L188) `Oidc/constructor` | `SQLite.all` (188, 196); `SQLite.prepare` (188, 196, 206, 207, 212, 212) | AUTH |
| [packages/server/src/oidc.ts:341](../../packages/server/src/oidc.ts#L341) `Oidc/takeGrant` | `SQLite.all` (341); `SQLite.prepare` (341) | AUTH |
| [packages/server/src/oidc.ts:392](../../packages/server/src/oidc.ts#L392) `Oidc/authorizeUrl` | `SQLite.prepare` (392, 393, 396); `SQLite.get` (393) | AUTH |
| [packages/server/src/oidc.ts:444](../../packages/server/src/oidc.ts#L444) `Oidc/callback` | `SQLite.all` (444); `SQLite.prepare` (444, 448) | AUTH |
| [packages/server/src/oidc.ts:546](../../packages/server/src/oidc.ts#L546) `Oidc/finish` | `SQLite.prepare` (546, 547, 549); `SQLite.get` (547) | AUTH |
| [packages/server/src/optimization-containers.ts:45](../../packages/server/src/optimization-containers.ts#L45) `read` | `SQLite.get` (45); `SQLite.prepare` (45); `Store.sql` (45) | DESIGN |
| [packages/server/src/optimization-containers.ts:56](../../packages/server/src/optimization-containers.ts#L56) `write` | `SQLite.prepare` (56); `Store.sql` (56) | DESIGN |
| [packages/server/src/optimization-containers.ts:139](../../packages/server/src/optimization-containers.ts#L139) `undoContainerMove` | `SQLite.prepare` (139); `Store.sql` (139); `SQLite.get` (140) | DESIGN |
| [packages/server/src/optimization-containers.ts:77](../../packages/server/src/optimization-containers.ts#L77) `planContainerMove` | `Store.embeddedContainerCount` (77) | DESIGN |
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
| [packages/server/src/pgwire.ts:772](../../packages/server/src/pgwire.ts#L772) `Connection/translate` | `Calculations.translateSQL` (772) | SQL |
| [packages/server/src/pgwire.ts:798](../../packages/server/src/pgwire.ts#L798) `Connection/catalog` | `Store.describe` (798) | SQL |
| [packages/server/src/pgwire.ts:809](../../packages/server/src/pgwire.ts#L809) `Connection/run` | `Store.selectIn` (809) | SQL |
| [packages/server/src/pgwire.ts:936](../../packages/server/src/pgwire.ts#L936) `Connection/validateSyntax` | `SQLite.prepare` (936); `Store.sql` (936) | SQL |
| [packages/server/src/pgwire.ts:1155](../../packages/server/src/pgwire.ts#L1155) `Connection/describe` | `Store.describe` (1155) | SQL |
| [packages/server/src/pgwrite.ts:404](../../packages/server/src/pgwrite.ts#L404) `returningColumns` | `Store.describe` (404) | SQL |
| [packages/server/src/pgwrite.ts:431](../../packages/server/src/pgwrite.ts#L431) `executeWrite/reader` | `Store.selectIn` (431) | SQL |
| [packages/server/src/pii.ts:121](../../packages/server/src/pii.ts#L121) `holdsOnlyUuids` | `Store.query` (121) | REDACTION |
| [packages/server/src/pii.ts:133](../../packages/server/src/pii.ts#L133) `sampledValues` | `Store.query` (133) | REDACTION |
| [packages/server/src/pii.ts:300](../../packages/server/src/pii.ts#L300) `vaultTable` | `Store.sql` (300, 303) | REDACTION |
| [packages/server/src/pii.ts:309](../../packages/server/src/pii.ts#L309) `forgetVault` | `Store.sql` (309) | REDACTION |
| [packages/server/src/pii.ts:348](../../packages/server/src/pii.ts#L348) `PiiMasker/constructor` | `SQLite.get` (348); `SQLite.prepare` (348); `Store.sql` (348) | REDACTION |
| [packages/server/src/pii.ts:358](../../packages/server/src/pii.ts#L358) `PiiMasker/refresh` | `SQLite.all` (358); `SQLite.prepare` (358); `Store.sql` (358) | REDACTION |
| [packages/server/src/pii.ts:389](../../packages/server/src/pii.ts#L389) `PiiMasker/token` | `SQLite.prepare` (389, 390); `Store.sql` (389, 390); `SQLite.get` (390) | REDACTION |
| [packages/server/src/pii.ts:630](../../packages/server/src/pii.ts#L630) `piiPreview` | `Store.find` (630); `SQLite.prepare` (637); `Store.sql` (637) | REDACTION |
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
| [packages/server/src/standby.ts:261](../../packages/server/src/standby.ts#L261) `Standby/copy` | `SQLite.get` (261); `SQLite.prepare` (261) | OPERATOR |
| [packages/server/src/summarize.ts:69](../../packages/server/src/summarize.ts#L69) `summarizeRecords` | `Store.findIds` (69); `Store.select` (126, 133, 143) | SUMMARY |
| [packages/server/src/summarize.ts:184](../../packages/server/src/summarize.ts#L184) `summarizeByRecord` | `Store.evaluateEach` (184); `Store.row` (186) | SUMMARY |
| [packages/server/src/sync-console.ts:458](../../packages/server/src/sync-console.ts#L458) `SyncConsole/runCheck` | `Store.sql` (458) | DESIGN |
| [packages/server/src/sync-console.ts:463](../../packages/server/src/sync-console.ts#L463) `SyncConsole/runCheck/assertActive` | `Store.sql` (463) | DESIGN |
| [packages/server/src/warm-worker.ts:19](../../packages/server/src/warm-worker.ts#L19) `message/count` | `Store.recordCount` (19) | INTERNAL |
| [packages/server/src/warm-worker.ts:34](../../packages/server/src/warm-worker.ts#L34) `message` | `Store.find` (34) | INTERNAL |
| [packages/server/src/webclient.ts:474](../../packages/server/src/webclient.ts#L474) `WebClient/history` | `Store.get` (474) | WEB |
| [packages/server/src/webclient.ts:611](../../packages/server/src/webclient.ts#L611) `WebClient/explain` | `Store.get` (611); `Store.row` (644, 657) | WEB |
| [packages/server/src/webclient.ts:670](../../packages/server/src/webclient.ts#L670) `WebClient/index` | `Store.fieldIndex` (670) | WEB |
| [packages/server/src/webclient.ts:760](../../packages/server/src/webclient.ts#L760) `WebClient/menus` | `Store.evaluateEach` (760) | WEB |
| [packages/server/src/webclient.ts:976](../../packages/server/src/webclient.ts#L976) `WebClient/view` | `Store.evaluateEach` (976, 1000, 1019); `Store.canView` (994); `Store.previewRow` (998, 1020); `Store.get` (1011); `Store.row` (1012, 1012) | WEB |
| [packages/server/src/webclient.ts:997](../../packages/server/src/webclient.ts#L997) `WebClient/view/get` | `Store.get` (997) | WEB |
| [packages/server/src/webclient.ts:1062](../../packages/server/src/webclient.ts#L1062) `WebClient/refresh` | `Store.previewRow` (1062); `Store.getMany` (1067); `Store.foundSetRows` (1089) | WEB |
| [packages/server/src/webclient.ts:1101](../../packages/server/src/webclient.ts#L1101) `WebClient/foundIds` | `Store.findIds` (1101) | WEB |
| [packages/server/src/webclient.ts:1116](../../packages/server/src/webclient.ts#L1116) `WebClient/records` | `Store.getMany` (1116); `Store.find` (1119) | WEB |
| [packages/server/src/webclient.ts:1145](../../packages/server/src/webclient.ts#L1145) `WebClient/foundSetPortal` | `Store.foundSetRows` (1145, 1152) | WEB |
| [packages/server/src/webclient.ts:1185](../../packages/server/src/webclient.ts#L1185) `WebClient/charts/foundSet` | `Store.findIds` (1185) | WEB |
| [packages/server/src/webclient.ts:1194](../../packages/server/src/webclient.ts#L1194) `WebClient/charts` | `Calculations.context` (1194); `Store.canView` (1222); `Store.evaluateEach` (1231, 1235); `Store.evaluateRows` (1240, 1242) | WEB |
| [packages/server/src/webclient.ts:1225](../../packages/server/src/webclient.ts#L1225) `WebClient/charts/get` | `Store.get` (1225) | WEB |
| [packages/server/src/webclient.ts:1414](../../packages/server/src/webclient.ts#L1414) `WebClient/exportRecords` | `Store.getMany` (1414) | WEB |
| [packages/server/src/webclient.ts:1308](../../packages/server/src/webclient.ts#L1308) `WebClient/streamExportRecords/nextBatch` | `Store.selectIds` (1308); `Store.getMany` (1314) | WEB |
| [packages/server/src/webclient.ts:1608](../../packages/server/src/webclient.ts#L1608) `WebClient/aiReplace` | `Store.canView` (1608); `Store.getMany` (1624) | WEB |
| [packages/server/src/webclient.ts:1684](../../packages/server/src/webclient.ts#L1684) `WebClient/groups` | `Store.findIds` (1684); `Store.groupSummaries` (1690) | WEB |
| [packages/server/src/webclient.ts:1792](../../packages/server/src/webclient.ts#L1792) `WebClient/button` | `Store.findIds` (1792, 1842); `Store.evaluateEach` (1801, 1802) | WEB |
| [packages/server/src/webclient.ts:2470](../../packages/server/src/webclient.ts#L2470) `listItems` | `Store.valueListItems` (2470) | WEB |
| [packages/server/src/webclient.ts:2549](../../packages/server/src/webclient.ts#L2549) `foundIds` | `Store.findIds` (2549, 2551) | WEB |
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
| [packages/store/src/calc.ts:310](../../packages/store/src/calc.ts#L310) `Calculations/meta` | `SQLite.get` (310); `SQLite.prepare` (310); `Store.sql` (310) | CALC |
| [packages/store/src/calc.ts:315](../../packages/store/src/calc.ts#L315) `Calculations/saveMeta` | `SQLite.prepare` (315); `Store.sql` (315) | CALC |
| [packages/store/src/calc.ts:328](../../packages/store/src/calc.ts#L328) `Calculations/globalValue` | `SQLite.get` (328); `SQLite.prepare` (328); `Store.sql` (328) | CALC |
| [packages/store/src/calc.ts:352](../../packages/store/src/calc.ts#L352) `Calculations/setNextSerial` | `Store.sql` (352, 353, 359, 361, 361) | CALC |
| [packages/store/src/calc.ts:500](../../packages/store/src/calc.ts#L500) `Calculations/value` | `Calculations.globalValue` (500) | CALC |
| [packages/store/src/calc.ts:535](../../packages/store/src/calc.ts#L535) `Calculations/computed` | `Calculations.context` (535) | CALC |
| [packages/store/src/calc.ts:550](../../packages/store/src/calc.ts#L550) `Calculations/unstoredValue` | `Calculations.unstoredStyled` (550); `Calculations.value` (550) | CALC |
| [packages/store/src/calc.ts:588](../../packages/store/src/calc.ts#L588) `Calculations/allRecords` | `SQLite.iterate` (588); `SQLite.prepare` (588); `Store.sql` (588) | CALC |
| [packages/store/src/calc.ts:599](../../packages/store/src/calc.ts#L599) `Calculations/collect` | `Calculations.collector` (599) | CALC |
| [packages/store/src/calc.ts:606](../../packages/store/src/calc.ts#L606) `Calculations/summaryInput` | `Calculations.value` (606) | CALC |
| [packages/store/src/calc.ts:630](../../packages/store/src/calc.ts#L630) `Calculations/collector/add` | `Calculations.related` (630) | CALC |
| [packages/store/src/calc.ts:643](../../packages/store/src/calc.ts#L643) `Calculations/foundSummary` | `Calculations.collect` (643) | CALC |
| [packages/store/src/calc.ts:654](../../packages/store/src/calc.ts#L654) `Calculations/summary` | `Calculations.collect` (654) | CALC |
| [packages/store/src/calc.ts:661](../../packages/store/src/calc.ts#L661) `Calculations/tableSummary` | `Calculations.wholeTable` (661) | CALC |
| [packages/store/src/calc.ts:716](../../packages/store/src/calc.ts#L716) `Calculations/globalsKey` | `Calculations.globalValue` (716) | CALC |
| [packages/store/src/calc.ts:891](../../packages/store/src/calc.ts#L891) `Calculations/summaryDependencies` | `Store.sql` (891) | CALC |
| [packages/store/src/calc.ts:930](../../packages/store/src/calc.ts#L930) `Calculations/wholeTable` | `rowsById` (930); `Store.viewableIds` (930); `Calculations.collect` (932, 1022); `Calculations.value` (993); `Store.sql` (1001, 1009) | CALC |
| [packages/store/src/calc.ts:1183](../../packages/store/src/calc.ts#L1183) `Calculations/applyDelta/value` | `Calculations.value` (1183) | CALC |
| [packages/store/src/calc.ts:1255](../../packages/store/src/calc.ts#L1255) `Calculations/storedRows` | `SQLite.iterate` (1255); `SQLite.prepare` (1255); `Store.sql` (1255) | CALC |
| [packages/store/src/calc.ts:1307](../../packages/store/src/calc.ts#L1307) `Calculations/relatedRecs` | `Calculations.relatedIds` (1307); `Store.viewableIds` (1312); `rowsById` (1318) | CALC |
| [packages/store/src/calc.ts:1329](../../packages/store/src/calc.ts#L1329) `Calculations/firstRelated` | `Calculations.related` (1329, 1341, 1356); `Store.viewableIds` (1336); `Calculations.relatedIds` (1339, 1352); `Calculations.statement` (1349); `SQLite.get` (1349) | CALC |
| [packages/store/src/calc.ts:1363](../../packages/store/src/calc.ts#L1363) `Calculations/rowById` | `Calculations.statement` (1363); `SQLite.get` (1363) | CALC |
| [packages/store/src/calc.ts:1374](../../packages/store/src/calc.ts#L1374) `Calculations/relatedIds` | `Calculations.related` (1374, 1404, 1418); `rowsById` (1388, 1415); `Calculations.statement` (1399); `SQLite.all` (1399) | CALC |
| [packages/store/src/calc.ts:1481](../../packages/store/src/calc.ts#L1481) `Calculations/joinHop` | `Calculations.statement` (1481, 1483); `SQLite.get` (1481); `SQLite.iterate` (1483) | CALC |
| [packages/store/src/calc.ts:1510](../../packages/store/src/calc.ts#L1510) `Calculations/storedRelatedValues` | `Calculations.statement` (1510); `SQLite.iterate` (1510) | CALC |
| [packages/store/src/calc.ts:1529](../../packages/store/src/calc.ts#L1529) `Calculations/passStamp` | `Store.sql` (1529) | CALC |
| [packages/store/src/calc.ts:1539](../../packages/store/src/calc.ts#L1539) `Calculations/lookup` | `Store.sql` (1539) | CALC |
| [packages/store/src/calc.ts:1578](../../packages/store/src/calc.ts#L1578) `Calculations/foundSums` | `Store.sql` (1578) | CALC |
| [packages/store/src/calc.ts:1641](../../packages/store/src/calc.ts#L1641) `Calculations/hopQuery` | `Calculations.value` (1641) | CALC |
| [packages/store/src/calc.ts:1674](../../packages/store/src/calc.ts#L1674) `Calculations/columnNames` | `SQLite.all` (1674); `SQLite.prepare` (1674); `Store.sql` (1674) | CALC |
| [packages/store/src/calc.ts:1685](../../packages/store/src/calc.ts#L1685) `Calculations/statement` | `SQLite.prepare` (1685); `Store.sql` (1685) | CALC |
| [packages/store/src/calc.ts:1699](../../packages/store/src/calc.ts#L1699) `Calculations/ensureIndex` | `Store.sql` (1699, 1700) | CALC |
| [packages/store/src/calc.ts:1725](../../packages/store/src/calc.ts#L1725) `Calculations/context/records` | `Calculations.firstRelated` (1725) | CALC |
| [packages/store/src/calc.ts:1743](../../packages/store/src/calc.ts#L1743) `Calculations/context/field` | `Calculations.summary` (1743); `Calculations.globalValue` (1746); `Calculations.value` (1747) | CALC |
| [packages/store/src/calc.ts:1756](../../packages/store/src/calc.ts#L1756) `Calculations/context/related` | `Calculations.globalValue` (1756); `Calculations.value` (1758, 1769); `Calculations.related` (1771) | CALC |
| [packages/store/src/calc.ts:1791](../../packages/store/src/calc.ts#L1791) `Calculations/context/lookupNext` | `Store.canViewRecord` (1791) | CALC |
| [packages/store/src/calc.ts:1806](../../packages/store/src/calc.ts#L1806) `Calculations/context/summary` | `Calculations.value` (1806, 1816); `Calculations.related` (1818); `Calculations.summary` (1836) | CALC |
| [packages/store/src/calc.ts:1866](../../packages/store/src/calc.ts#L1866) `Calculations/context/get` | `Store.recordCount` (1866, 1870); `Calculations.statement` (1869); `SQLite.get` (1869) | CALC |
| [packages/store/src/calc.ts:1889](../../packages/store/src/calc.ts#L1889) `Calculations/context/executeSQL` | `Calculations.executeSQL` (1889) | CALC |
| [packages/store/src/calc.ts:1890](../../packages/store/src/calc.ts#L1890) `Calculations/context/persistentData` | `Store.persistentData` (1890) | CALC |
| [packages/store/src/calc.ts:1891](../../packages/store/src/calc.ts#L1891) `Calculations/context/persistentDataIds` | `Store.persistentDataIds` (1891) | CALC |
| [packages/store/src/calc.ts:1916](../../packages/store/src/calc.ts#L1916) `Calculations/design` | `Store.valueListItems` (1916) | CALC |
| [packages/store/src/calc.ts:1933](../../packages/store/src/calc.ts#L1933) `Calculations/executeSQL` | `Calculations.translateSQL` (1933); `Store.select` (1971); `Store.sql` (1982) | CALC |
| [packages/store/src/calc.ts:2088](../../packages/store/src/calc.ts#L2088) `Calculations/translateSQL` | `Store.scopedTableSql` (2088, 2119) | CALC |
| [packages/store/src/calc.ts:2151](../../packages/store/src/calc.ts#L2151) `Calculations/shareColumn` | `Store.recordCount` (2151) | CALC |
| [packages/store/src/calc.ts:2183](../../packages/store/src/calc.ts#L2183) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2183) | CALC |
| [packages/store/src/calc.ts:2220](../../packages/store/src/calc.ts#L2220) `Calculations/computeColumn` | `Calculations.statement` (2220); `SQLite.get` (2220); `Calculations.value` (2223) | CALC |
| [packages/store/src/calc.ts:2357](../../packages/store/src/calc.ts#L2357) `Calculations/beforeWrite` | `relatedRows` (2357); `Calculations.related` (2411); `Calculations.context` (2424) | CORE |
| [packages/store/src/calc.ts:2475](../../packages/store/src/calc.ts#L2475) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2475); `Calculations.value` (2475) | CALC |
| [packages/store/src/calc.ts:2489](../../packages/store/src/calc.ts#L2489) `Calculations/computeStoredStyled` | `Calculations.context` (2489) | CORE |
| [packages/store/src/calc.ts:2529](../../packages/store/src/calc.ts#L2529) `Calculations/validate/fail` | `Calculations.context` (2529) | CALC |
| [packages/store/src/calc.ts:2543](../../packages/store/src/calc.ts#L2543) `Calculations/validate` | `Calculations.value` (2543); `Store.valueListItems` (2564); `Calculations.context` (2578) | CALC |
| [packages/store/src/calc.ts:2640](../../packages/store/src/calc.ts#L2640) `nearest` | `SQLite.get` (2640); `SQLite.prepare` (2640); `Store.sql` (2640) | CALC |
| [packages/store/src/calc.ts:2726](../../packages/store/src/calc.ts#L2726) `containerValue` | `Store.containerInfo` (2726); `Store.containerRange` (2733); `Store.container` (2734) | CALC |
| [packages/store/src/calc.ts:2742](../../packages/store/src/calc.ts#L2742) `containerValue/read` | `Store.container` (2742) | CALC |
| [packages/store/src/calc.ts:2755](../../packages/store/src/calc.ts#L2755) `containerValue/value` | `Store.containerRange` (2755) | CALC |
| [packages/store/src/calc.ts:2873](../../packages/store/src/calc.ts#L2873) `sameValuesElsewhere` | `SQLite.all` (2873); `SQLite.prepare` (2873, 2880, 2882); `Store.sql` (2873, 2880, 2882); `Calculations.value` (2875); `SQLite.get` (2880, 2882) | CALC |
| [packages/store/src/calc.ts:3186](../../packages/store/src/calc.ts#L3186) `rowsById/flush` | `Calculations.statement` (3186); `SQLite.iterate` (3186) | CALC |
| [packages/store/src/damage.ts:93](../../packages/store/src/damage.ts#L93) `watchDatabase` | `SQLite.prepare` (93); `SQLite.iterate` (103) | CORE |
| [packages/store/src/explain-related.ts:102](../../packages/store/src/explain-related.ts#L102) `explainRelated` | `Store.row` (102); `Store.get` (190); `Calculations.value` (239); `Calculations.context` (247) | RECORD |
| [packages/store/src/explain-related.ts:180](../../packages/store/src/explain-related.ts#L180) `explainRelated/runFilter` | `Calculations.context` (180) | RECORD |
| [packages/store/src/explain-related.ts:298](../../packages/store/src/explain-related.ts#L298) `explainHop` | `keyValue` (298); `SQLite.get` (318); `SQLite.prepare` (318, 332); `Store.sql` (318, 332); `SQLite.all` (332) | RECORD |
| [packages/store/src/explain-related.ts:361](../../packages/store/src/explain-related.ts#L361) `explainCandidate` | `SQLite.get` (361, 375); `SQLite.prepare` (361, 375); `Store.sql` (361, 375); `keyValue` (372); `Calculations.context` (380) | RECORD |
| [packages/store/src/explain.ts:100](../../packages/store/src/explain.ts#L100) `explainField` | `Calculations.value` (100); `Calculations.context` (126) | RECORD |
| [packages/store/src/explain.ts:331](../../packages/store/src/explain.ts#L331) `lintFormula` | `Calculations.context` (331) | RECORD |
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
| [packages/store/src/reconvert.ts:98](../../packages/store/src/reconvert.ts#L98) `meta` | `SQLite.get` (98); `SQLite.prepare` (98) | OPERATOR |
| [packages/store/src/reconvert.ts:103](../../packages/store/src/reconvert.ts#L103) `tableExists` | `SQLite.get` (103); `SQLite.prepare` (103) | OPERATOR |
| [packages/store/src/reconvert.ts:107](../../packages/store/src/reconvert.ts#L107) `columns` | `SQLite.all` (107); `SQLite.prepare` (107) | OPERATOR |
| [packages/store/src/reconvert.ts:120](../../packages/store/src/reconvert.ts#L120) `reconvertCheck` | `SQLite.get` (120); `SQLite.prepare` (120) | OPERATOR |
| [packages/store/src/reconvert.ts:195](../../packages/store/src/reconvert.ts#L195) `build` | `SQLite.get` (195); `SQLite.prepare` (195, 198, 203); `SQLite.all` (203) | OPERATOR |
| [packages/store/src/reconvert.ts:230](../../packages/store/src/reconvert.ts#L230) `previewOf/count` | `SQLite.get` (230); `SQLite.prepare` (230) | OPERATOR |
| [packages/store/src/reconvert.ts:243](../../packages/store/src/reconvert.ts#L243) `previewOf` | `SQLite.get` (243); `SQLite.prepare` (243) | OPERATOR |
| [packages/store/src/reconvert.ts:263](../../packages/store/src/reconvert.ts#L263) `copyContainer` | `SQLite.get` (263); `SQLite.prepare` (263, 265, 271) | OPERATOR |
| [packages/store/src/reconvert.ts:300](../../packages/store/src/reconvert.ts#L300) `carryRecords` | `SQLite.prepare` (300, 303, 304, 314, 320, 321); `SQLite.all` (303, 307, 320) | OPERATOR |
| [packages/store/src/reconvert.ts:329](../../packages/store/src/reconvert.ts#L329) `carrySettings` | `SQLite.all` (329, 333, 341); `SQLite.prepare` (329, 333, 341, 342, 346); `SQLite.get` (346) | OPERATOR |
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
| [packages/store/src/store.ts:879](../../packages/store/src/store.ts#L879) `Store/metadataVersions` | `SQLite.get` (879); `SQLite.prepare` (879); `Store.sql` (879) | CORE |
| [packages/store/src/store.ts:1017](../../packages/store/src/store.ts#L1017) `Store/constructor` | `Store.sql` (1017, 1019, 1021, 1022, 1026, 1030, 1031, 1042, 1047, 1052, 1053, 1057, 1058, 1059, 1066, 1070, 1074, 1075, 1076, 1081, 1085, 1088, 1089, 1091, 1092, 1095, 1096, 1100, 1101, 1105, 1106, 1109, 1111, 1114, 1115, 1119, 1120, 1124, 1125, 1128, 1129, 1130, 1133, 1134, 1137, 1138, 1140, 1140, 1141, 1141, 1142, 1145, 1149, 1151, 1154, 1155, 1156, 1159, 1160, 1162, 1164, 1165, 1169, 1170, 1172, 1176, 1177, 1178, 1178, 1182, 1183); `SQLite.get` (1021); `SQLite.prepare` (1021, 1088, 1089, 1092, 1095, 1100, 1105, 1114, 1119, 1124, 1133, 1137, 1140, 1141, 1159, 1164, 1169); `SQLite.all` (1088, 1095, 1100, 1105, 1114, 1119, 1124, 1133, 1137, 1140, 1141, 1159, 1164, 1169) | CORE |
| [packages/store/src/store.ts:1240](../../packages/store/src/store.ts#L1240) `Store/grantFullAccessClients` | `SQLite.prepare` (1240); `Store.sql` (1240) | CORE |
| [packages/store/src/store.ts:1257](../../packages/store/src/store.ts#L1257) `Store/meta` | `SQLite.get` (1257); `SQLite.prepare` (1257); `Store.sql` (1257) | CORE |
| [packages/store/src/store.ts:3374](../../packages/store/src/store.ts#L3374) `Store/webViewerChecked` | `SQLite.get` (3374); `SQLite.prepare` (3374); `Store.sql` (3374) | CORE |
| [packages/store/src/store.ts:1265](../../packages/store/src/store.ts#L1265) `Store/persistentTable` | `Store.sql` (1265) | CORE |
| [packages/store/src/store.ts:1275](../../packages/store/src/store.ts#L1275) `Store/persistentData` | `SQLite.get` (1275) | CORE |
| [packages/store/src/store.ts:1284](../../packages/store/src/store.ts#L1284) `Store/persistentDataIds` | `SQLite.all` (1284) | CORE |
| [packages/store/src/store.ts:1290](../../packages/store/src/store.ts#L1290) `Store/setPersistentData` | `SQLite.prepare` (1290, 1294); `Store.sql` (1290, 1294) | CORE |
| [packages/store/src/store.ts:1307](../../packages/store/src/store.ts#L1307) `Store/checkpoint` | `SQLite.get` (1307); `SQLite.prepare` (1307); `Store.sql` (1307) | CORE |
| [packages/store/src/store.ts:1315](../../packages/store/src/store.ts#L1315) `Store/recordedFormat` | `Store.sql` (1315) | CORE |
| [packages/store/src/store.ts:1325](../../packages/store/src/store.ts#L1325) `Store/close` | `Store.sql` (1325) | CORE |
| [packages/store/src/store.ts:1341](../../packages/store/src/store.ts#L1341) `Store/shipWal` | `Store.sql` (1341) | CORE |
| [packages/store/src/store.ts:1352](../../packages/store/src/store.ts#L1352) `Store/trial` | `Store.sql` (1352) | CORE |
| [packages/store/src/store.ts:1357](../../packages/store/src/store.ts#L1357) `Store/trial/undo` | `Store.sql` (1357) | CORE |
| [packages/store/src/store.ts:1392](../../packages/store/src/store.ts#L1392) `Store/joinTransaction` | `Store.sql` (1392, 1393, 1395, 1397, 1403) | CORE |
| [packages/store/src/store.ts:1415](../../packages/store/src/store.ts#L1415) `Store/independentWindowWrite` | `SQLite.get` (1415); `SQLite.prepare` (1415, 1438); `Store.sql` (1415, 1418, 1433, 1438, 1441) | CORE |
| [packages/store/src/store.ts:1463](../../packages/store/src/store.ts#L1463) `Store/withWriteTransaction` | `Store.sql` (1463, 1466, 1470, 1472, 1472) | CORE |
| [packages/store/src/store.ts:1502](../../packages/store/src/store.ts#L1502) `Store/endTransaction` | `Store.sql` (1502, 1505, 1505) | CORE |
| [packages/store/src/store.ts:1531](../../packages/store/src/store.ts#L1531) `Store/backup` | `Store.sql` (1531) | CORE |
| [packages/store/src/store.ts:1621](../../packages/store/src/store.ts#L1621) `Store/dataVersion` | `SQLite.get` (1621); `SQLite.prepare` (1621); `Store.sql` (1621) | CORE |
| [packages/store/src/store.ts:1661](../../packages/store/src/store.ts#L1661) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1661) | CORE |
| [packages/store/src/store.ts:1682](../../packages/store/src/store.ts#L1682) `Store/shareResults` | `Store.sql` (1682) | CORE |
| [packages/store/src/store.ts:1692](../../packages/store/src/store.ts#L1692) `Store/versionTriggers` | `SQLite.get` (1692); `SQLite.prepare` (1692, 1697, 1698); `Store.sql` (1692, 1694, 1695, 1697, 1698, 1707, 1708); `SQLite.all` (1697, 1698) | CORE |
| [packages/store/src/store.ts:1724](../../packages/store/src/store.ts#L1724) `Store/versionNumber` | `SQLite.get` (1724); `SQLite.prepare` (1724); `Store.sql` (1724) | CORE |
| [packages/store/src/store.ts:1737](../../packages/store/src/store.ts#L1737) `Store/changeOne` | `Store.sql` (1737, 1739) | CORE |
| [packages/store/src/store.ts:1740](../../packages/store/src/store.ts#L1740) `Store/changeOne/read` | `SQLite.get` (1740); `SQLite.prepare` (1740); `Store.sql` (1740) | CORE |
| [packages/store/src/store.ts:1779](../../packages/store/src/store.ts#L1779) `Store/writeToken` | `SQLite.get` (1779); `SQLite.prepare` (1779); `Store.sql` (1779) | CORE |
| [packages/store/src/store.ts:1791](../../packages/store/src/store.ts#L1791) `Store/recordCount` | `SQLite.get` (1791); `SQLite.prepare` (1791); `Store.sql` (1791) | CORE |
| [packages/store/src/store.ts:1903](../../packages/store/src/store.ts#L1903) `Store/applyDesign` | `Store.sql` (1903, 1904, 1917, 1920, 1925, 1939, 1942, 1942); `SQLite.prepare` (1920, 1925) | CORE |
| [packages/store/src/store.ts:2000](../../packages/store/src/store.ts#L2000) `Store/auditLog` | `SQLite.all` (2000); `SQLite.prepare` (2000); `Store.sql` (2000) | CORE |
| [packages/store/src/store.ts:2040](../../packages/store/src/store.ts#L2040) `Store/securityEvents` | `Store.auditLog` (2040) | CORE |
| [packages/store/src/store.ts:2066](../../packages/store/src/store.ts#L2066) `Store/prepared` | `SQLite.prepare` (2066); `Store.sql` (2066) | CORE |
| [packages/store/src/store.ts:2081](../../packages/store/src/store.ts#L2081) `Store/recordAsOf` | `SQLite.get` (2081, 2083); `SQLite.prepare` (2081, 2083, 2085, 2086); `Store.sql` (2081, 2083, 2085, 2086); `SQLite.all` (2085, 2086) | CORE |
| [packages/store/src/store.ts:2115](../../packages/store/src/store.ts#L2115) `Store/restoreRecord/run` | `Store.recordAsOf` (2115); `SQLite.get` (2119); `SQLite.prepare` (2119, 2123, 2132, 2143); `Store.sql` (2119, 2123, 2132, 2143) | CORE |
| [packages/store/src/store.ts:2159](../../packages/store/src/store.ts#L2159) `Store/revertAuditEntry` | `Store.auditLog` (2159) | CORE |
| [packages/store/src/store.ts:2252](../../packages/store/src/store.ts#L2252) `Store/setAuditSettings` | `SQLite.prepare` (2252); `Store.sql` (2252) | CORE |
| [packages/store/src/store.ts:2274](../../packages/store/src/store.ts#L2274) `Store/pruneAudit` | `Store.sql` (2274, 2276, 2278); `SQLite.get` (2276); `SQLite.prepare` (2276) | CORE |
| [packages/store/src/store.ts:2356](../../packages/store/src/store.ts#L2356) `Store/audit` | `Store.sql` (2356) | CORE |
| [packages/store/src/store.ts:2445](../../packages/store/src/store.ts#L2445) `Store/securityChange` | `Store.sql` (2445, 2447); `SQLite.prepare` (2447) | CORE |
| [packages/store/src/store.ts:2494](../../packages/store/src/store.ts#L2494) `Store/logSecurity` | `Store.sql` (2494) | CORE |
| [packages/store/src/store.ts:2517](../../packages/store/src/store.ts#L2517) `Store/ensureDeleted` | `Store.sql` (2517) | CORE |
| [packages/store/src/store.ts:2522](../../packages/store/src/store.ts#L2522) `Store/deletedRows` | `SQLite.get` (2522); `SQLite.prepare` (2522, 2524, 2524); `Store.sql` (2522, 2524, 2524); `SQLite.all` (2524, 2524) | CORE |
| [packages/store/src/store.ts:2548](../../packages/store/src/store.ts#L2548) `Store/emptyDeleted` | `Store.sql` (2548, 2551, 2552, 2554, 2556); `SQLite.prepare` (2552) | CORE |
| [packages/store/src/store.ts:2563](../../packages/store/src/store.ts#L2563) `Store/designHistory` | `SQLite.all` (2563); `SQLite.prepare` (2563); `Store.sql` (2563) | CORE |
| [packages/store/src/store.ts:2570](../../packages/store/src/store.ts#L2570) `Store/scriptHistory` | `SQLite.all` (2570); `SQLite.prepare` (2570); `Store.sql` (2570) | CORE |
| [packages/store/src/store.ts:2580](../../packages/store/src/store.ts#L2580) `Store/layoutHistory` | `SQLite.all` (2580); `SQLite.prepare` (2580); `Store.sql` (2580) | CORE |
| [packages/store/src/store.ts:2605](../../packages/store/src/store.ts#L2605) `Store/designEffect/renameKey` | `SQLite.prepare` (2605); `Store.sql` (2605) | CORE |
| [packages/store/src/store.ts:2621](../../packages/store/src/store.ts#L2621) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2621); `Store.sql` (2621) | CORE |
| [packages/store/src/store.ts:2628](../../packages/store/src/store.ts#L2628) `Store/designEffect` | `Store.sql` (2628, 2633, 2638, 2643, 2646, 2652, 2660, 2661, 2663, 2675, 2676, 2679, 2681, 2687, 2688, 2689, 2694, 2696, 2700, 2703, 2704, 2706, 2709, 2714, 2716, 2723, 2724, 2726, 2727, 2728, 2729, 2736, 2737, 2739, 2739, 2741, 2742, 2743, 2747, 2751, 2753, 2791, 2793, 2795); `SQLite.get` (2660, 2675, 2687, 2688, 2700, 2704, 2739, 2747); `SQLite.prepare` (2660, 2661, 2675, 2676, 2687, 2688, 2694, 2696, 2700, 2704, 2714, 2716, 2729, 2736, 2737, 2739, 2741, 2743, 2747, 2751); `SQLite.all` (2736, 2737); `SQLite.iterate` (2741) | CORE |
| [packages/store/src/store.ts:2803](../../packages/store/src/store.ts#L2803) `Store/dropColumnIndexes` | `SQLite.all` (2803, 2805); `SQLite.prepare` (2803, 2805); `Store.sql` (2803, 2805, 2806) | CORE |
| [packages/store/src/store.ts:2815](../../packages/store/src/store.ts#L2815) `Store/recompute` | `SQLite.prepare` (2815, 2819); `Store.sql` (2815, 2819); `SQLite.iterate` (2819); `Calculations.computeStoredStyled` (2820); `Calculations.value` (2820) | CORE |
| [packages/store/src/store.ts:2835](../../packages/store/src/store.ts#L2835) `Store/linkPrincipal` | `SQLite.get` (2835); `SQLite.prepare` (2835); `Store.sql` (2835) | CORE |
| [packages/store/src/store.ts:2842](../../packages/store/src/store.ts#L2842) `Store/linkIdentity` | `SQLite.get` (2842); `SQLite.prepare` (2842); `Store.sql` (2842) | CORE |
| [packages/store/src/store.ts:2848](../../packages/store/src/store.ts#L2848) `Store/accountsSharingLockout` | `SQLite.all` (2848); `SQLite.prepare` (2848); `Store.sql` (2848) | CORE |
| [packages/store/src/store.ts:2852](../../packages/store/src/store.ts#L2852) `Store/accounts` | `SQLite.all` (2852); `SQLite.prepare` (2852); `Store.sql` (2852) | CORE |
| [packages/store/src/store.ts:2864](../../packages/store/src/store.ts#L2864) `Store/isAgent` | `SQLite.get` (2864); `SQLite.prepare` (2864); `Store.sql` (2864) | CORE |
| [packages/store/src/store.ts:2870](../../packages/store/src/store.ts#L2870) `Store/agentNeedsApproval` | `SQLite.get` (2870); `SQLite.prepare` (2870); `Store.sql` (2870) | CORE |
| [packages/store/src/store.ts:2876](../../packages/store/src/store.ts#L2876) `Store/blankPasswordAccounts` | `SQLite.all` (2876); `SQLite.prepare` (2876); `Store.sql` (2876) | CORE |
| [packages/store/src/store.ts:1248](../../packages/store/src/store.ts#L1248) `Store/hasOwnPassword` | `SQLite.get` (1248); `SQLite.prepare` (1248); `Store.sql` (1248) | CORE |
| [packages/store/src/store.ts:2887](../../packages/store/src/store.ts#L2887) `Store/unmigratedAccounts` | `SQLite.all` (2887); `SQLite.prepare` (2887); `Store.sql` (2887) | CORE |
| [packages/store/src/store.ts:2940](../../packages/store/src/store.ts#L2940) `Store/setExternalAccount` | `SQLite.get` (2940); `SQLite.prepare` (2940, 2945); `Store.sql` (2940, 2945) | CORE |
| [packages/store/src/store.ts:2958](../../packages/store/src/store.ts#L2958) `Store/refuseLookalikeAccount` | `SQLite.all` (2958); `SQLite.prepare` (2958); `Store.sql` (2958) | CORE |
| [packages/store/src/store.ts:2967](../../packages/store/src/store.ts#L2967) `Store/isExternal` | `SQLite.get` (2967); `SQLite.prepare` (2967); `Store.sql` (2967) | CORE |
| [packages/store/src/store.ts:2988](../../packages/store/src/store.ts#L2988) `Store/setAgentAccount` | `SQLite.get` (2988); `SQLite.prepare` (2988, 2994); `Store.sql` (2988, 2994) | CORE |
| [packages/store/src/store.ts:3028](../../packages/store/src/store.ts#L3028) `Store/gateAgentWrite` | `SQLite.prepare` (3028); `Store.sql` (3028) | CORE |
| [packages/store/src/store.ts:3050](../../packages/store/src/store.ts#L3050) `Store/pendingChanges` | `SQLite.all` (3050); `SQLite.prepare` (3050); `Store.sql` (3050) | CORE |
| [packages/store/src/store.ts:3064](../../packages/store/src/store.ts#L3064) `Store/approvePending` | `SQLite.get` (3064); `SQLite.prepare` (3064, 3075); `Store.sql` (3064, 3075) | CORE |
| [packages/store/src/store.ts:3085](../../packages/store/src/store.ts#L3085) `Store/rejectPending` | `SQLite.get` (3085); `SQLite.prepare` (3085, 3087); `Store.sql` (3085, 3087) | CORE |
| [packages/store/src/store.ts:3107](../../packages/store/src/store.ts#L3107) `Store/externalAccount` | `SQLite.all` (3107); `SQLite.prepare` (3107); `Store.sql` (3107) | CORE |
| [packages/store/src/store.ts:3138](../../packages/store/src/store.ts#L3138) `Store/setPassword` | `SQLite.get` (3138); `SQLite.prepare` (3138, 3140, 3149); `Store.sql` (3138, 3140, 3149) | AUTH |
| [packages/store/src/store.ts:3163](../../packages/store/src/store.ts#L3163) `Store/createAccount` | `SQLite.get` (3163); `SQLite.prepare` (3163, 3167, 3173, 3178, 3183); `Store.sql` (3163, 3167, 3173, 3178, 3183) | CORE |
| [packages/store/src/store.ts:3191](../../packages/store/src/store.ts#L3191) `Store/appendSecurityEvent` | `Store.sql` (3191) | CORE |
| [packages/store/src/store.ts:3233](../../packages/store/src/store.ts#L3233) `Store/setPasswordPolicy` | `SQLite.prepare` (3233); `Store.sql` (3233) | CORE |
| [packages/store/src/store.ts:3269](../../packages/store/src/store.ts#L3269) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3269); `Store.sql` (3269) | CORE |
| [packages/store/src/store.ts:3292](../../packages/store/src/store.ts#L3292) `Store/saveScriptTest` | `SQLite.prepare` (3292); `Store.sql` (3292) | CORE |
| [packages/store/src/store.ts:3301](../../packages/store/src/store.ts#L3301) `Store/deleteScriptTest` | `SQLite.prepare` (3301); `Store.sql` (3301) | CORE |
| [packages/store/src/store.ts:3336](../../packages/store/src/store.ts#L3336) `Store/setAiAllowed` | `SQLite.prepare` (3336); `Store.sql` (3336) | CORE |
| [packages/store/src/store.ts:3403](../../packages/store/src/store.ts#L3403) `Store/setAiPolicy` | `SQLite.prepare` (3403); `Store.sql` (3403) | CORE |
| [packages/store/src/store.ts:3351](../../packages/store/src/store.ts#L3351) `Store/setScriptNetwork` | `SQLite.prepare` (3351); `Store.sql` (3351) | CORE |
| [packages/store/src/store.ts:3392](../../packages/store/src/store.ts#L3392) `Store/setWebViewerHosts` | `SQLite.prepare` (3392); `Store.sql` (3392) | CORE |
| [packages/store/src/store.ts:3423](../../packages/store/src/store.ts#L3423) `Store/setPiiIsolation` | `SQLite.prepare` (3423); `Store.sql` (3423) | CORE |
| [packages/store/src/store.ts:3445](../../packages/store/src/store.ts#L3445) `Store/markPiiField` | `SQLite.prepare` (3445); `Store.sql` (3445) | CORE |
| [packages/store/src/store.ts:3559](../../packages/store/src/store.ts#L3559) `Store/lastSignIns` | `Store.auditLog` (3559) | CORE |
| [packages/store/src/store.ts:3762](../../packages/store/src/store.ts#L3762) `Store/unusualAccess` | `Store.auditLog` (3762, 3828) | CORE |
| [packages/store/src/store.ts:3859](../../packages/store/src/store.ts#L3859) `Store/leastPrivilege` | `SQLite.all` (3859); `SQLite.prepare` (3859); `Store.sql` (3859) | CORE |
| [packages/store/src/store.ts:3932](../../packages/store/src/store.ts#L3932) `Store/unusedAccess` | `SQLite.get` (3932); `SQLite.prepare` (3932, 3941); `Store.sql` (3932, 3941); `SQLite.all` (3941) | CORE |
| [packages/store/src/store.ts:3980](../../packages/store/src/store.ts#L3980) `Store/unusedObjects` | `SQLite.get` (3980); `SQLite.prepare` (3980, 3983); `Store.sql` (3980, 3983); `SQLite.all` (3983) | CORE |
| [packages/store/src/store.ts:4018](../../packages/store/src/store.ts#L4018) `Store/usageCounting` | `SQLite.get` (4018); `SQLite.prepare` (4018); `Store.sql` (4018) | CORE |
| [packages/store/src/store.ts:4026](../../packages/store/src/store.ts#L4026) `Store/setMustChangePassword` | `SQLite.prepare` (4026); `Store.sql` (4026) | CORE |
| [packages/store/src/store.ts:4040](../../packages/store/src/store.ts#L4040) `Store/mustChangePassword` | `SQLite.get` (4040); `SQLite.prepare` (4040); `Store.sql` (4040) | CORE |
| [packages/store/src/store.ts:4079](../../packages/store/src/store.ts#L4079) `Store/passwordDaysRemaining` | `SQLite.get` (4079); `SQLite.prepare` (4079); `Store.sql` (4079) | CORE |
| [packages/store/src/store.ts:4086](../../packages/store/src/store.ts#L4086) `Store/importAccounts` | `SQLite.all` (4086); `SQLite.prepare` (4086); `Store.sql` (4086) | CORE |
| [packages/store/src/store.ts:4109](../../packages/store/src/store.ts#L4109) `Store/canonicalAccount` | `SQLite.all` (4109); `SQLite.prepare` (4109); `Store.sql` (4109) | CORE |
| [packages/store/src/store.ts:4121](../../packages/store/src/store.ts#L4121) `Store/createLocalAccount` | `SQLite.prepare` (4121); `Store.sql` (4121) | CORE |
| [packages/store/src/store.ts:4151](../../packages/store/src/store.ts#L4151) `Store/previewAccountImport` | `Store.sql` (4151, 4152, 4161) | CORE |
| [packages/store/src/store.ts:4169](../../packages/store/src/store.ts#L4169) `Store/limitAccountImport` | `SQLite.prepare` (4169, 4170, 4173); `Store.sql` (4169, 4170, 4173); `SQLite.get` (4170) | CORE |
| [packages/store/src/store.ts:4180](../../packages/store/src/store.ts#L4180) `Store/applyAccountImport` | `Store.sql` (4180, 4188, 4217); `SQLite.get` (4188); `SQLite.prepare` (4188, 4217) | CORE |
| [packages/store/src/store.ts:4242](../../packages/store/src/store.ts#L4242) `Store/forgetStandIns` | `SQLite.prepare` (4242); `Store.sql` (4242) | CORE |
| [packages/store/src/store.ts:4275](../../packages/store/src/store.ts#L4275) `Store/deleteAccount` | `SQLite.prepare` (4275, 4279, 4280, 4281, 4282, 4283, 4284, 4285, 4286, 4293, 4295, 4298, 4302); `Store.sql` (4275, 4279, 4280, 4281, 4282, 4283, 4284, 4285, 4286, 4293, 4295, 4298, 4302) | CORE |
| [packages/store/src/store.ts:4319](../../packages/store/src/store.ts#L4319) `Store/setAccountActive` | `SQLite.prepare` (4319, 4322, 4323); `Store.sql` (4319, 4322, 4323) | AUTH |
| [packages/store/src/store.ts:4333](../../packages/store/src/store.ts#L4333) `Store/accountInactive` | `SQLite.get` (4333); `SQLite.prepare` (4333); `Store.sql` (4333) | CORE |
| [packages/store/src/store.ts:4338](../../packages/store/src/store.ts#L4338) `Store/identityAllowed` | `SQLite.get` (4338, 4344, 4350); `SQLite.prepare` (4338, 4344, 4350); `Store.sql` (4338, 4344, 4350) | CORE |
| [packages/store/src/store.ts:4359](../../packages/store/src/store.ts#L4359) `Store/externalIdentityId` | `SQLite.get` (4359, 4365); `SQLite.prepare` (4359, 4364, 4365); `Store.sql` (4359, 4364, 4365) | CORE |
| [packages/store/src/store.ts:4370](../../packages/store/src/store.ts#L4370) `Store/accountIdentityId` | `SQLite.get` (4370, 4375); `SQLite.prepare` (4370, 4374, 4375); `Store.sql` (4370, 4374, 4375) | CORE |
| [packages/store/src/store.ts:4398](../../packages/store/src/store.ts#L4398) `Store/signInMark` | `SQLite.prepare` (4398); `Store.sql` (4398) | AUTH |
| [packages/store/src/store.ts:4408](../../packages/store/src/store.ts#L4408) `Store/signInBase` | `SQLite.get` (4408); `SQLite.prepare` (4408); `Store.sql` (4408) | AUTH |
| [packages/store/src/store.ts:4410](../../packages/store/src/store.ts#L4410) `Store/signInBase/identity` | `SQLite.get` (4410); `SQLite.prepare` (4410); `Store.sql` (4410) | AUTH |
| [packages/store/src/store.ts:4422](../../packages/store/src/store.ts#L4422) `Store/ledgerRow` | `SQLite.get` (4422, 4423); `SQLite.prepare` (4422, 4423); `Store.sql` (4422, 4423) | AUTH |
| [packages/store/src/store.ts:4434](../../packages/store/src/store.ts#L4434) `Store/ledgerWrite` | `Store.sql` (4434, 4435, 4437, 4439, 4442, 4442) | AUTH |
| [packages/store/src/store.ts:4461](../../packages/store/src/store.ts#L4461) `Store/settleSignIns` | `SQLite.all` (4461, 4467); `SQLite.prepare` (4461, 4467, 4473, 4477, 4479); `Store.sql` (4461, 4467, 4473, 4477, 4479) | AUTH |
| [packages/store/src/store.ts:4490](../../packages/store/src/store.ts#L4490) `Store/securityToken` | `SQLite.get` (4490); `SQLite.prepare` (4490); `Store.sql` (4490) | CORE |
| [packages/store/src/store.ts:4498](../../packages/store/src/store.ts#L4498) `Store/accountLocalOnly` | `SQLite.get` (4498); `SQLite.prepare` (4498); `Store.sql` (4498) | CORE |
| [packages/store/src/store.ts:4503](../../packages/store/src/store.ts#L4503) `Store/accountRequires2fa` | `SQLite.get` (4503); `SQLite.prepare` (4503); `Store.sql` (4503) | CORE |
| [packages/store/src/store.ts:4509](../../packages/store/src/store.ts#L4509) `Store/setAccountLocalOnly` | `SQLite.prepare` (4509); `Store.sql` (4509) | CORE |
| [packages/store/src/store.ts:4518](../../packages/store/src/store.ts#L4518) `Store/setAccountRequire2fa` | `SQLite.prepare` (4518); `Store.sql` (4518) | CORE |
| [packages/store/src/store.ts:4547](../../packages/store/src/store.ts#L4547) `Store/createApiToken` | `SQLite.get` (4547); `SQLite.prepare` (4547, 4577); `Store.sql` (4547, 4577) | CORE |
| [packages/store/src/store.ts:4624](../../packages/store/src/store.ts#L4624) `Store/recordObjectUse` | `Store.sql` (4624) | CORE |
| [packages/store/src/store.ts:4654](../../packages/store/src/store.ts#L4654) `Store/writeUsage` | `Store.sql` (4654, 4655, 4657, 4661, 4663) | CORE |
| [packages/store/src/store.ts:4670](../../packages/store/src/store.ts#L4670) `Store/writeUsageRows` | `SQLite.prepare` (4670, 4671, 4677); `Store.sql` (4670, 4671, 4677) | CORE |
| [packages/store/src/store.ts:4682](../../packages/store/src/store.ts#L4682) `Store/writeObjectUseRows` | `SQLite.prepare` (4682, 4683, 4688); `Store.sql` (4682, 4683, 4688) | CORE |
| [packages/store/src/store.ts:4693](../../packages/store/src/store.ts#L4693) `Store/objectUseSince` | `SQLite.get` (4693); `SQLite.prepare` (4693); `Store.sql` (4693) | CORE |
| [packages/store/src/store.ts:4706](../../packages/store/src/store.ts#L4706) `Store/accountUsage` | `SQLite.get` (4706); `SQLite.prepare` (4706, 4707); `Store.sql` (4706, 4707); `SQLite.all` (4707); `Store.auditLog` (4723) | CORE |
| [packages/store/src/store.ts:4739](../../packages/store/src/store.ts#L4739) `Store/apiTokens` | `SQLite.all` (4739); `SQLite.prepare` (4739); `Store.sql` (4739) | CORE |
| [packages/store/src/store.ts:4749](../../packages/store/src/store.ts#L4749) `Store/revokeApiToken` | `SQLite.prepare` (4749); `Store.sql` (4749) | CORE |
| [packages/store/src/store.ts:4763](../../packages/store/src/store.ts#L4763) `Store/apiToken` | `SQLite.get` (4763); `SQLite.prepare` (4763, 4775); `Store.sql` (4763, 4775) | CORE |
| [packages/store/src/store.ts:4791](../../packages/store/src/store.ts#L4791) `Store/enrollTotp` | `SQLite.prepare` (4791); `Store.sql` (4791) | CORE |
| [packages/store/src/store.ts:4802](../../packages/store/src/store.ts#L4802) `Store/confirmTotp` | `SQLite.get` (4802); `SQLite.prepare` (4802, 4804); `Store.sql` (4802, 4804) | CORE |
| [packages/store/src/store.ts:4812](../../packages/store/src/store.ts#L4812) `Store/hasTotp` | `SQLite.get` (4812); `SQLite.prepare` (4812); `Store.sql` (4812) | CORE |
| [packages/store/src/store.ts:4817](../../packages/store/src/store.ts#L4817) `Store/totpAccounts` | `SQLite.all` (4817); `SQLite.prepare` (4817); `Store.sql` (4817) | CORE |
| [packages/store/src/store.ts:4823](../../packages/store/src/store.ts#L4823) `Store/disableTotp` | `SQLite.prepare` (4823); `Store.sql` (4823) | CORE |
| [packages/store/src/store.ts:4846](../../packages/store/src/store.ts#L4846) `Store/verifyTotp` | `SQLite.get` (4846); `SQLite.prepare` (4846, 4852); `Store.sql` (4846, 4852) | CORE |
| [packages/store/src/store.ts:4865](../../packages/store/src/store.ts#L4865) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4865, 4867, 4868, 4870); `Store.sql` (4865, 4867, 4868, 4870); `SQLite.get` (4867) | CORE |
| [packages/store/src/store.ts:4917](../../packages/store/src/store.ts#L4917) `Store/passkeyAllowList` | `SQLite.all` (4917); `SQLite.prepare` (4917); `Store.sql` (4917) | CORE |
| [packages/store/src/store.ts:4931](../../packages/store/src/store.ts#L4931) `Store/takeWebauthnChallenge` | `SQLite.get` (4931); `SQLite.prepare` (4931, 4933); `Store.sql` (4931, 4933) | CORE |
| [packages/store/src/store.ts:4941](../../packages/store/src/store.ts#L4941) `Store/passkeys` | `SQLite.all` (4941); `SQLite.prepare` (4941); `Store.sql` (4941) | CORE |
| [packages/store/src/store.ts:4948](../../packages/store/src/store.ts#L4948) `Store/hasPasskey` | `SQLite.get` (4948); `SQLite.prepare` (4948); `Store.sql` (4948) | CORE |
| [packages/store/src/store.ts:4953](../../packages/store/src/store.ts#L4953) `Store/passkeyIds` | `SQLite.all` (4953); `SQLite.prepare` (4953); `Store.sql` (4953) | CORE |
| [packages/store/src/store.ts:4975](../../packages/store/src/store.ts#L4975) `Store/registerPasskey` | `SQLite.prepare` (4975); `Store.sql` (4975) | CORE |
| [packages/store/src/store.ts:4986](../../packages/store/src/store.ts#L4986) `Store/removePasskey` | `SQLite.get` (4986); `SQLite.prepare` (4986, 4987); `Store.sql` (4986, 4987) | CORE |
| [packages/store/src/store.ts:5003](../../packages/store/src/store.ts#L5003) `Store/verifyPasskeyAssertion` | `SQLite.get` (5003); `SQLite.prepare` (5003, 5014); `Store.sql` (5003, 5014) | CORE |
| [packages/store/src/store.ts:5050](../../packages/store/src/store.ts#L5050) `Store/generateRecoveryCodes` | `SQLite.prepare` (5050, 5053); `Store.sql` (5050, 5053) | CORE |
| [packages/store/src/store.ts:5068](../../packages/store/src/store.ts#L5068) `Store/recoveryCodesRemaining` | `SQLite.get` (5068); `SQLite.prepare` (5068); `Store.sql` (5068) | CORE |
| [packages/store/src/store.ts:5078](../../packages/store/src/store.ts#L5078) `Store/useRecoveryCode` | `SQLite.get` (5078); `SQLite.prepare` (5078, 5080); `Store.sql` (5078, 5080) | CORE |
| [packages/store/src/store.ts:5091](../../packages/store/src/store.ts#L5091) `Store/privilegeSets` | `Store.sql` (5091) | CORE |
| [packages/store/src/store.ts:5120](../../packages/store/src/store.ts#L5120) `Store/savePrivilegeSet` | `SQLite.prepare` (5120, 5128); `Store.sql` (5120, 5128) | AUTH |
| [packages/store/src/store.ts:5163](../../packages/store/src/store.ts#L5163) `Store/deletePrivilegeSet` | `SQLite.prepare` (5163); `Store.sql` (5163) | CORE |
| [packages/store/src/store.ts:5232](../../packages/store/src/store.ts#L5232) `Store/accountPrivilegeSet` | `SQLite.get` (5232); `SQLite.prepare` (5232); `Store.sql` (5232) | CORE |
| [packages/store/src/store.ts:5246](../../packages/store/src/store.ts#L5246) `Store/setAccountPrivilegeSet` | `SQLite.get` (5246); `SQLite.prepare` (5246, 5249, 5253); `Store.sql` (5246, 5249, 5253) | AUTH |
| [packages/store/src/store.ts:5268](../../packages/store/src/store.ts#L5268) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5268); `Store.sql` (5268) | CORE |
| [packages/store/src/store.ts:5282](../../packages/store/src/store.ts#L5282) `Store/addProvisionedAccount` | `SQLite.get` (5282); `SQLite.prepare` (5282, 5286); `Store.sql` (5282, 5286) | CORE |
| [packages/store/src/store.ts:5455](../../packages/store/src/store.ts#L5455) `Store/ruleOutcome` | `Calculations.context` (5455) | CORE |
| [packages/store/src/store.ts:5496](../../packages/store/src/store.ts#L5496) `Store/allowedIds` | `SQLite.iterate` (5496); `SQLite.prepare` (5496); `Store.sql` (5496) | CORE |
| [packages/store/src/store.ts:5566](../../packages/store/src/store.ts#L5566) `Store/scopedTableSql` | `Store.viewableIds` (5566); `SQLite.all` (5569); `SQLite.prepare` (5569); `Store.sql` (5569) | GATED-STORE |
| [packages/store/src/store.ts:5601](../../packages/store/src/store.ts#L5601) `Store/previewRecordRuleCurrent` | `SQLite.get` (5601); `SQLite.prepare` (5601, 5604); `Store.sql` (5601, 5604); `SQLite.all` (5604); `Calculations.context` (5610, 5626) | CORE |
| [packages/store/src/store.ts:5778](../../packages/store/src/store.ts#L5778) `Store/passwordHash` | `SQLite.get` (5778); `SQLite.prepare` (5778); `Store.sql` (5778) | CORE |
| [packages/store/src/store.ts:5807](../../packages/store/src/store.ts#L5807) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5807); `Store.sql` (5807) | CORE |
| [packages/store/src/store.ts:5820](../../packages/store/src/store.ts#L5820) `Store/knownSharedAccount` | `SQLite.get` (5820); `SQLite.prepare` (5820); `Store.sql` (5820) | CORE |
| [packages/store/src/store.ts:5883](../../packages/store/src/store.ts#L5883) `Store/layouts` | `SQLite.all` (5883); `SQLite.prepare` (5883); `Store.sql` (5883) | CORE |
| [packages/store/src/store.ts:5904](../../packages/store/src/store.ts#L5904) `Store/image` | `SQLite.get` (5904); `SQLite.prepare` (5904); `Store.sql` (5904) | CORE |
| [packages/store/src/store.ts:5914](../../packages/store/src/store.ts#L5914) `Store/images` | `SQLite.all` (5914); `SQLite.prepare` (5914); `Store.sql` (5914) | CORE |
| [packages/store/src/store.ts:5927](../../packages/store/src/store.ts#L5927) `Store/addImage` | `Store.sql` (5927, 5928); `SQLite.prepare` (5928) | CORE |
| [packages/store/src/store.ts:5944](../../packages/store/src/store.ts#L5944) `Store/layout` | `SQLite.get` (5944); `SQLite.prepare` (5944); `Store.sql` (5944) | CORE |
| [packages/store/src/store.ts:6148](../../packages/store/src/store.ts#L6148) `Store/wordIndex` | `Store.sql` (6148, 6156, 6161); `Store.recordCount` (6160); `SQLite.get` (6161); `SQLite.prepare` (6161) | CORE |
| [packages/store/src/store.ts:6213](../../packages/store/src/store.ts#L6213) `Store/toRecord` | `Calculations.value` (6213, 6223); `Calculations.globalValue` (6217); `Calculations.unstoredStyled` (6222) | CORE |
| [packages/store/src/store.ts:6272](../../packages/store/src/store.ts#L6272) `Store/relatedValues` | `Calculations.globalValue` (6272); `Calculations.unstoredValue` (6274) | CORE |
| [packages/store/src/store.ts:6346](../../packages/store/src/store.ts#L6346) `Store/addRelated` | `relatedRows` (6346); `rowsById` (6378); `firstRelatedEach` (6401) | CORE |
| [packages/store/src/store.ts:6429](../../packages/store/src/store.ts#L6429) `Store/foundSetPage` | `rowsById` (6429) | CORE |
| [packages/store/src/store.ts:6445](../../packages/store/src/store.ts#L6445) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6445); `Store.row` (6461) | GATED-STORE |
| [packages/store/src/store.ts:6484](../../packages/store/src/store.ts#L6484) `Store/portalCountsCurrent` | `Store.canView` (6484); `Store.row` (6511) | GATED-STORE |
| [packages/store/src/store.ts:6547](../../packages/store/src/store.ts#L6547) `Store/fieldIndexCurrent` | `SQLite.iterate` (6547); `SQLite.prepare` (6547, 6552); `Store.sql` (6547, 6552); `SQLite.all` (6552) | GATED-STORE |
| [packages/store/src/store.ts:6593](../../packages/store/src/store.ts#L6593) `Store/valueListItemsCurrent` | `Store.valueListItems` (6593); `Store.get` (6607); `relatedRows` (6608); `Store.row` (6608); `SQLite.iterate` (6610); `SQLite.prepare` (6610); `Store.sql` (6610); `Calculations.related` (6620); `Calculations.value` (6624, 6625) | GATED-STORE |
| [packages/store/src/store.ts:6722](../../packages/store/src/store.ts#L6722) `Store/portalRows` | `relatedRows` (6722); `relatedIdList` (6723); `Store.viewableIds` (6726); `rowsById` (6751, 6789); `Calculations.related` (6765) | CORE |
| [packages/store/src/store.ts:6733](../../packages/store/src/store.ts#L6733) `Store/portalRows/context` | `Calculations.context` (6733) | CORE |
| [packages/store/src/store.ts:6743](../../packages/store/src/store.ts#L6743) `Store/portalRows/valueOf` | `Calculations.value` (6743) | CORE |
| [packages/store/src/store.ts:6860](../../packages/store/src/store.ts#L6860) `Store/markRepeating` | `SQLite.prepare` (6860); `Store.sql` (6860) | CORE |
| [packages/store/src/store.ts:6887](../../packages/store/src/store.ts#L6887) `Store/externalContainerCheck` | `SQLite.all` (6887); `SQLite.prepare` (6887); `Store.sql` (6887) | CORE |
| [packages/store/src/store.ts:6894](../../packages/store/src/store.ts#L6894) `Store/externalContainerCount` | `SQLite.get` (6894); `SQLite.prepare` (6894); `Store.sql` (6894) | CORE |
| [packages/store/src/store.ts:6903](../../packages/store/src/store.ts#L6903) `Store/externalContainerReport` | `SQLite.all` (6903, 6916); `SQLite.prepare` (6903, 6916); `Store.sql` (6903, 6916) | CORE |
| [packages/store/src/store.ts:7051](../../packages/store/src/store.ts#L7051) `Store/orphanContainerReport` | `SQLite.all` (7051); `SQLite.prepare` (7051); `Store.sql` (7051) | CORE |
| [packages/store/src/store.ts:7086](../../packages/store/src/store.ts#L7086) `Store/purgeOrphanContainers` | `Store.sql` (7086, 7090, 7099, 7102, 7103, 7108, 7109, 7111, 7111); `Store.orphanContainerReport` (7094); `SQLite.get` (7099); `SQLite.prepare` (7099, 7102, 7103) | CORE |
| [packages/store/src/store.ts:7124](../../packages/store/src/store.ts#L7124) `Store/containerIntact` | `SQLite.get` (7124); `SQLite.prepare` (7124); `Store.sql` (7124) | CORE |
| [packages/store/src/store.ts:7134](../../packages/store/src/store.ts#L7134) `Store/externalOf` | `SQLite.get` (7134); `SQLite.prepare` (7134); `Store.sql` (7134) | CORE |
| [packages/store/src/store.ts:7138](../../packages/store/src/store.ts#L7138) `Store/containerMeta` | `SQLite.get` (7138); `SQLite.prepare` (7138); `Store.sql` (7138) | CORE |
| [packages/store/src/store.ts:7143](../../packages/store/src/store.ts#L7143) `Store/container` | `SQLite.get` (7143); `SQLite.prepare` (7143, 7152); `Store.sql` (7143, 7152); `SQLite.all` (7152) | CORE |
| [packages/store/src/store.ts:7160](../../packages/store/src/store.ts#L7160) `Store/containerInfo` | `SQLite.get` (7160); `SQLite.prepare` (7160); `Store.sql` (7160) | CORE |
| [packages/store/src/store.ts:7194](../../packages/store/src/store.ts#L7194) `Store/containerRange` | `SQLite.all` (7194); `SQLite.prepare` (7194, 7201); `Store.sql` (7194, 7201); `SQLite.get` (7201) | CORE |
| [packages/store/src/store.ts:7219](../../packages/store/src/store.ts#L7219) `Store/addContainer` | `SQLite.all` (7219); `SQLite.prepare` (7219, 7224, 7238, 7242, 7243); `Store.sql` (7219, 7224, 7238, 7240, 7242, 7243, 7245, 7248); `SQLite.get` (7229); `Store.containerRange` (7231) | CORE |
| [packages/store/src/store.ts:7265](../../packages/store/src/store.ts#L7265) `Store/addExternalContainer` | `SQLite.prepare` (7265); `Store.sql` (7265) | CORE |
| [packages/store/src/store.ts:7283](../../packages/store/src/store.ts#L7283) `Store/writeExternalFile` | `Store.evaluateEach` (7283); `SQLite.prepare` (7306); `Store.sql` (7306) | CORE |
| [packages/store/src/store.ts:7307](../../packages/store/src/store.ts#L7307) `Store/writeExternalFile/taken` | `SQLite.get` (7307) | CORE |
| [packages/store/src/store.ts:7337](../../packages/store/src/store.ts#L7337) `Store/embeddedContainers` | `SQLite.prepare` (7337, 7338); `Store.sql` (7337, 7338); `SQLite.all` (7338); `SQLite.get` (7342) | CORE |
| [packages/store/src/store.ts:7351](../../packages/store/src/store.ts#L7351) `Store/embeddedContainerCount` | `SQLite.prepare` (7351); `Store.sql` (7351); `SQLite.get` (7352) | CORE |
| [packages/store/src/store.ts:7360](../../packages/store/src/store.ts#L7360) `Store/recoverContainersOut` | `SQLite.prepare` (7360); `Store.sql` (7360); `SQLite.get` (7363) | CORE |
| [packages/store/src/store.ts:7385](../../packages/store/src/store.ts#L7385) `Store/moveContainersOut` | `Store.sql` (7385, 7393, 7395, 7397, 7399, 7400, 7419, 7424, 7426, 7428, 7429, 7433); `SQLite.get` (7393); `SQLite.prepare` (7393, 7399, 7400); `Store.container` (7402) | CORE |
| [packages/store/src/store.ts:7442](../../packages/store/src/store.ts#L7442) `Store/moveContainersIn` | `Store.sql` (7442, 7447, 7449, 7450, 7451, 7452, 7471, 7474, 7481, 7484, 7487, 7494); `SQLite.prepare` (7449, 7450, 7451, 7452, 7481, 7487); `SQLite.get` (7454, 7481, 7487) | CORE |
| [packages/store/src/store.ts:7506](../../packages/store/src/store.ts#L7506) `Store/compactFile` | `Store.sql` (7506, 7507, 7508) | CORE |
| [packages/store/src/store.ts:7514](../../packages/store/src/store.ts#L7514) `Store/containerId` | `Store.containerId` (7514); `Store.row` (7515) | CORE |
| [packages/store/src/store.ts:7537](../../packages/store/src/store.ts#L7537) `Store/checkContainerWrite` | `Store.row` (7537) | CORE |
| [packages/store/src/store.ts:7550](../../packages/store/src/store.ts#L7550) `Store/setContainer` | `Store.sql` (7550, 7564, 7569, 7572, 7572); `Store.row` (7553); `SQLite.prepare` (7564) | CORE |
| [packages/store/src/store.ts:7606](../../packages/store/src/store.ts#L7606) `Store/orderBy` | `Store.valueListItems` (7606) | CORE |
| [packages/store/src/store.ts:7629](../../packages/store/src/store.ts#L7629) `Store/userPrefs` | `SQLite.all` (7629); `SQLite.prepare` (7629); `Store.sql` (7629) | CORE |
| [packages/store/src/store.ts:7634](../../packages/store/src/store.ts#L7634) `Store/hasTable` | `SQLite.get` (7634); `SQLite.prepare` (7634); `Store.sql` (7634) | CORE |
| [packages/store/src/store.ts:7638](../../packages/store/src/store.ts#L7638) `Store/setUserPref` | `Store.sql` (7638, 7639, 7640); `SQLite.prepare` (7639, 7640) | CORE |
| [packages/store/src/store.ts:7646](../../packages/store/src/store.ts#L7646) `Store/indexedFields` | `SQLite.all` (7646, 7647); `SQLite.prepare` (7646, 7647); `Store.sql` (7646, 7647) | CORE |
| [packages/store/src/store.ts:7668](../../packages/store/src/store.ts#L7668) `Store/addFieldIndex` | `Store.sql` (7668) | CORE |
| [packages/store/src/store.ts:7680](../../packages/store/src/store.ts#L7680) `Store/dropFieldIndex` | `SQLite.get` (7680); `SQLite.prepare` (7680); `Store.sql` (7680, 7681) | CORE |
| [packages/store/src/store.ts:7691](../../packages/store/src/store.ts#L7691) `Store/timeFind` | `Store.query` (7691, 7695, 7696); `Store.recordCount` (7698) | CORE |
| [packages/store/src/store.ts:7715](../../packages/store/src/store.ts#L7715) `Store/find` | `Store.find` (7715) | GATED-STORE |
| [packages/store/src/store.ts:7726](../../packages/store/src/store.ts#L7726) `Store/findHere` | `Store.query` (7726, 7731, 7733, 7747, 7749, 7759); `Store.recordCount` (7744); `SQLite.get` (7745, 7749); `SQLite.prepare` (7745, 7749, 7754, 7761, 7770); `Store.sql` (7745, 7749, 7754, 7761, 7770); `SQLite.all` (7754, 7761, 7770) | GATED-STORE |
| [packages/store/src/store.ts:7765](../../packages/store/src/store.ts#L7765) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7765); `SQLite.prepare` (7765); `Store.sql` (7765) | GATED-STORE |
| [packages/store/src/store.ts:7798](../../packages/store/src/store.ts#L7798) `Store/sortedPage` | `SQLite.iterate` (7798); `SQLite.prepare` (7798, 7813); `Store.sql` (7798, 7813); `SQLite.all` (7813) | CORE |
| [packages/store/src/store.ts:7870](../../packages/store/src/store.ts#L7870) `Store/relatedCriteria/matched` | `relatedRows` (7870) | CORE |
| [packages/store/src/store.ts:7873](../../packages/store/src/store.ts#L7873) `Store/relatedCriteria` | `SQLite.iterate` (7873); `SQLite.prepare` (7873); `Store.sql` (7873) | CORE |
| [packages/store/src/store.ts:7899](../../packages/store/src/store.ts#L7899) `Store/computedRows` | `Store.sql` (7899, 7902, 7903, 7904, 7906, 7916, 7917, 7918, 7921); `SQLite.prepare` (7902, 7904, 7906, 7916); `SQLite.iterate` (7906); `Calculations.globalValue` (7909); `Calculations.unstoredValue` (7910); `Calculations.related` (7913); `SQLite.all` (7916) | CORE |
| [packages/store/src/store.ts:7946](../../packages/store/src/store.ts#L7946) `Store/summaries` | `Calculations.wholeTable` (7946); `Calculations.collect` (7966, 7971) | CORE |
| [packages/store/src/store.ts:7962](../../packages/store/src/store.ts#L7962) `Store/summaries/recs` | `SQLite.iterate` (7962); `SQLite.prepare` (7962); `Store.sql` (7962) | CORE |
| [packages/store/src/store.ts:7984](../../packages/store/src/store.ts#L7984) `Store/runningSummaryValues` | `Store.viewableIds` (7984); `rowsById` (7986); `Calculations.value` (7997, 8003); `Calculations.related` (8014) | GATED-STORE |
| [packages/store/src/store.ts:8030](../../packages/store/src/store.ts#L8030) `Store/findSource` | `Store.query` (8030); `SQLite.all` (8039, 8056); `SQLite.prepare` (8039, 8047, 8055); `Store.sql` (8039, 8044, 8047, 8052, 8055, 8069, 8071); `Calculations.globalValue` (8061); `Calculations.unstoredValue` (8062); `Calculations.related` (8066) | CORE |
| [packages/store/src/store.ts:8086](../../packages/store/src/store.ts#L8086) `Store/findCandidates` | `Store.query` (8086) | CORE |
| [packages/store/src/store.ts:8121](../../packages/store/src/store.ts#L8121) `Store/previewRow` | `Store.row` (8121) | CORE |
| [packages/store/src/store.ts:8139](../../packages/store/src/store.ts#L8139) `Store/row` | `SQLite.get` (8139) | CORE |
| [packages/store/src/store.ts:8158](../../packages/store/src/store.ts#L8158) `Store/getCurrent` | `Store.get` (8158); `Store.row` (8159, 8159, 8173); `SQLite.all` (8176); `SQLite.prepare` (8176); `Store.sql` (8176) | GATED-STORE |
| [packages/store/src/store.ts:8196](../../packages/store/src/store.ts#L8196) `Store/getManyCurrent` | `Store.getMany` (8196); `SQLite.get` (8214); `SQLite.prepare` (8214); `Store.sql` (8214) | GATED-STORE |
| [packages/store/src/store.ts:8207](../../packages/store/src/store.ts#L8207) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8207) | GATED-STORE |
| [packages/store/src/store.ts:8230](../../packages/store/src/store.ts#L8230) `Store/canViewRecord` | `SQLite.get` (8230); `SQLite.prepare` (8230); `Store.sql` (8230) | GATED-STORE |
| [packages/store/src/store.ts:8238](../../packages/store/src/store.ts#L8238) `Store/canView` | `Store.canView` (8238); `Store.row` (8239) | GATED-STORE |
| [packages/store/src/store.ts:8263](../../packages/store/src/store.ts#L8263) `Store/create` | `SQLite.get` (8263, 8269); `SQLite.prepare` (8263, 8269, 8282); `Store.sql` (8263, 8269, 8282) | CORE |
| [packages/store/src/store.ts:8306](../../packages/store/src/store.ts#L8306) `Store/duplicate` | `Store.row` (8306); `SQLite.get` (8310); `SQLite.prepare` (8310, 8325); `Store.sql` (8310, 8325) | CORE |
| [packages/store/src/store.ts:8370](../../packages/store/src/store.ts#L8370) `Store/update` | `Store.row` (8370, 8377, 8388); `Store.sql` (8401, 8402, 8441, 8444) | CORE |
| [packages/store/src/store.ts:8404](../../packages/store/src/store.ts#L8404) `Store/update/undo` | `Store.sql` (8404) | CORE |
| [packages/store/src/store.ts:8548](../../packages/store/src/store.ts#L8548) `Store/setStoredCalcValues` | `SQLite.prepare` (8548, 8549); `Store.sql` (8548, 8549); `SQLite.get` (8553) | CORE |
| [packages/store/src/store.ts:8627](../../packages/store/src/store.ts#L8627) `Store/evaluateCurrent` | `Store.row` (8627, 8627); `Calculations.context` (8631); `Store.get` (8632, 8634) | GATED-STORE |
| [packages/store/src/store.ts:8666](../../packages/store/src/store.ts#L8666) `Store/evaluateEachCurrent` | `Store.row` (8666, 8666); `Calculations.context` (8671); `Store.get` (8673) | GATED-STORE |
| [packages/store/src/store.ts:8706](../../packages/store/src/store.ts#L8706) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8706); `Store.get` (8708) | GATED-STORE |
| [packages/store/src/store.ts:8727](../../packages/store/src/store.ts#L8727) `Store/evaluateRowsCurrent` | `Store.row` (8727, 8727) | GATED-STORE |
| [packages/store/src/store.ts:8741](../../packages/store/src/store.ts#L8741) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8741) | GATED-STORE |
| [packages/store/src/store.ts:8763](../../packages/store/src/store.ts#L8763) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8763) | GATED-STORE |
| [packages/store/src/store.ts:8801](../../packages/store/src/store.ts#L8801) `Store/updateRelated` | `relatedRows` (8801) | CORE |
| [packages/store/src/store.ts:8819](../../packages/store/src/store.ts#L8819) `Store/updatePortals` | `Store.row` (8819, 8854); `relatedRows` (8855) | CORE |
| [packages/store/src/store.ts:8828](../../packages/store/src/store.ts#L8828) `Store/updatePortals/portal/related` | `relatedIdList` (8828) | CORE |
| [packages/store/src/store.ts:8910](../../packages/store/src/store.ts#L8910) `Store/portalContainerTarget` | `Store.row` (8910); `relatedIdList` (8911) | CORE |
| [packages/store/src/store.ts:8924](../../packages/store/src/store.ts#L8924) `Store/checkEditable` | `Store.row` (8924) | CORE |
| [packages/store/src/store.ts:8947](../../packages/store/src/store.ts#L8947) `Store/delete` | `Store.row` (8947) | CORE |
| [packages/store/src/store.ts:8955](../../packages/store/src/store.ts#L8955) `Store/delete/run` | `SQLite.get` (8955); `SQLite.prepare` (8955, 8959); `Store.sql` (8955, 8959) | CORE |
| [packages/store/src/store.ts:9181](../../packages/store/src/store.ts#L9181) `Store/keyStepWork` | `Store.sql` (9181, 9187, 9191, 9193) | CORE |
| [packages/store/src/store.ts:8984](../../packages/store/src/store.ts#L8984) `Store/vaultHeld` | `SQLite.get` (8984); `SQLite.prepare` (8984); `Store.sql` (8984) | CORE |
| [packages/store/src/store.ts:8991](../../packages/store/src/store.ts#L8991) `Store/forgetStandInValues` | `Store.sql` (8991, 9012); `SQLite.prepare` (9012) | CORE |
| [packages/store/src/store.ts:9031](../../packages/store/src/store.ts#L9031) `Store/restoreDeletedRowLocked` | `SQLite.get` (9031); `SQLite.prepare` (9031, 9032, 9036); `Store.sql` (9031, 9032, 9036); `SQLite.all` (9032) | CORE |
| [packages/store/src/store.ts:9234](../../packages/store/src/store.ts#L9234) `Store/cascadeDelete` | `relatedRows` (9234) | CORE |
| [packages/store/src/store.ts:9324](../../packages/store/src/store.ts#L9324) `Store/selectIdsCurrent` | `Store.selectIds` (9324); `SQLite.all` (9330); `SQLite.prepare` (9330); `Store.sql` (9330) | GATED-STORE |
| [packages/store/src/store.ts:9338](../../packages/store/src/store.ts#L9338) `Store/countIds` | `Store.countIds` (9338); `SQLite.get` (9342); `SQLite.prepare` (9342); `Store.sql` (9342) | GATED-STORE |
| [packages/store/src/store.ts:9358](../../packages/store/src/store.ts#L9358) `Store/computeValuesCurrent` | `Store.computeValues` (9358); `Store.sql` (9364, 9368); `SQLite.all` (9368); `SQLite.prepare` (9368) | GATED-STORE |
| [packages/store/src/store.ts:9383](../../packages/store/src/store.ts#L9383) `Store/findIdsCurrent` | `Store.findIds` (9383) | GATED-STORE |
| [packages/store/src/store.ts:9389](../../packages/store/src/store.ts#L9389) `Store/findIdsHere` | `Store.query` (9389, 9394, 9396); `SQLite.iterate` (9407); `SQLite.prepare` (9407); `Store.sql` (9407) | GATED-STORE |
| [packages/store/src/store.ts:9424](../../packages/store/src/store.ts#L9424) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9424); `Store.viewableIds` (9429); `Calculations.collect` (9445); `rowsById` (9445, 9495); `Calculations.collector` (9467) | GATED-STORE |
| [packages/store/src/store.ts:9457](../../packages/store/src/store.ts#L9457) `Store/groupSummariesCurrent/key` | `Calculations.value` (9457); `Calculations.related` (9459) | GATED-STORE |
| [packages/store/src/store.ts:9493](../../packages/store/src/store.ts#L9493) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9493) | GATED-STORE |
| [packages/store/src/store.ts:9549](../../packages/store/src/store.ts#L9549) `Store/sortIdsCurrentProgress` | `SQLite.all` (9549); `SQLite.prepare` (9549, 9617); `Store.sql` (9549, 9617); `Store.valueListItems` (9557); `rowsById` (9569); `Calculations.globalValue` (9572); `Calculations.unstoredValue` (9573); `Calculations.related` (9579); `SQLite.iterate` (9617) | GATED-STORE |
| [packages/store/src/store.ts:9631](../../packages/store/src/store.ts#L9631) `Store/matchIds` | `Store.matchIds` (9631); `SQLite.all` (9637); `SQLite.prepare` (9637); `Store.sql` (9637) | CORE |
| [packages/store/src/store.ts:9658](../../packages/store/src/store.ts#L9658) `Store/truncate/run` | `Store.sql` (9658, 9660, 9667, 9669, 9671, 9672); `SQLite.prepare` (9660, 9667); `SQLite.all` (9662) | CORE |
| [packages/store/src/store.ts:9696](../../packages/store/src/store.ts#L9696) `Store/iterateCommitted` | `SQLite.iterate` (9696) | CORE |
| [packages/store/src/store.ts:9730](../../packages/store/src/store.ts#L9730) `Store/readOnlyChecked` | `SQLite.prepare` (9730, 9734, 9743, 9748); `SQLite.all` (9734, 9743, 9748) | CORE |
| [packages/store/src/store.ts:9770](../../packages/store/src/store.ts#L9770) `Store/refreshDecimalSqlViews` | `SQLite.get` (9770); `SQLite.prepare` (9770, 9775); `SQLite.all` (9775) | CORE |
| [packages/store/src/store.ts:9789](../../packages/store/src/store.ts#L9789) `Store/internalRoots` | `SQLite.get` (9789); `SQLite.prepare` (9789, 9791); `SQLite.all` (9791) | CORE |
| [packages/store/src/store.ts:9824](../../packages/store/src/store.ts#L9824) `Store/selectCurrent` | `SQLite.iterate` (9824) | CORE |
| [packages/store/src/store.ts:9873](../../packages/store/src/store.ts#L9873) `Store/query` | `SQLite.iterate` (9873) | CORE |
| [packages/store/src/store.ts:9907](../../packages/store/src/store.ts#L9907) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9907); `SQLite.all` (9914, 9917); `SQLite.prepare` (9914, 9917) | CORE |
| [packages/store/src/store.ts:1193](../../packages/store/src/store.ts#L1193) `Store/ensureNativeIds` | `SQLite.all` (1193, 1205); `SQLite.prepare` (1193, 1196, 1204, 1205); `Store.sql` (1193, 1196, 1199, 1203, 1204, 1205, 1208, 1210) | CORE |
| [packages/store/src/store.ts:1218](../../packages/store/src/store.ts#L1218) `Store/nativeIdGuards` | `Store.sql` (1218, 1219, 1221) | CORE |
| [packages/store/src/store.ts:9840](../../packages/store/src/store.ts#L9840) `Store/selectIn` | `Store.select` (9840) | CORE |
| [packages/store/src/store.ts:9848](../../packages/store/src/store.ts#L9848) `Store/selectHeldCurrent` | `Store.sql` (9848, 9849); `SQLite.prepare` (9849); `SQLite.iterate` (9852) | CORE |
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
| [packages/server/src/backup.ts:264](../../packages/server/src/backup.ts#L264) `backupOnceHeld` | `SQLite.get` (264); `SQLite.prepare` (264) | OPERATOR |
| [packages/store/src/store.ts:1551](../../packages/store/src/store.ts#L1551) `Store/selfContainedCopy` | `Store.sql` (1551); `SQLite.all` (1556); `SQLite.prepare` (1556, 1558, 1559, 1560) | CORE |
| [packages/store/src/store.ts:6966](../../packages/store/src/store.ts#L6966) `Store/containerReferences` | `SQLite.all` (6966, 6984, 6986, 6992, 7005, 7016, 7030); `SQLite.prepare` (6966, 6984, 6986, 6992, 7005, 7016, 7028, 7030); `Store.sql` (6966, 6984, 6986, 6992, 7005, 7016, 7028, 7030); `SQLite.get` (7028); `Store.row` (7039) | CORE |
| [packages/store/src/store.ts:7063](../../packages/store/src/store.ts#L7063) `Store/containerIntegrityReport` | `SQLite.all` (7063); `SQLite.prepare` (7063, 7074); `Store.sql` (7063, 7074); `SQLite.get` (7074) | CORE |
| [packages/server/src/compaction.ts:62](../../packages/server/src/compaction.ts#L62) `compactStore` | `SQLite.get` (62, 63, 76, 83); `SQLite.prepare` (62, 63, 76, 83) | OPERATOR |
<!-- end generated read-gate inventory -->
