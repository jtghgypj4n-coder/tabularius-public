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
| [packages/server/src/admin.ts:2173](../../packages/server/src/admin.ts#L2173) `Admin/audit` | `Store.auditLog` (2173) | ADMIN |
| [packages/server/src/admin.ts:2256](../../packages/server/src/admin.ts#L2256) `Admin/viewAs` | `Store.find` (2256) | ADMIN |
| [packages/server/src/admin.ts:2604](../../packages/server/src/admin.ts#L2604) `Admin/status` | `Store.externalContainerCount` (2604) | ADMIN |
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
| [packages/server/src/pgwire.ts:807](../../packages/server/src/pgwire.ts#L807) `Connection/translate` | `Calculations.translateSQL` (807) | SQL |
| [packages/server/src/pgwire.ts:852](../../packages/server/src/pgwire.ts#L852) `Connection/run` | `Store.selectIn` (852) | SQL |
| [packages/server/src/pgwire.ts:980](../../packages/server/src/pgwire.ts#L980) `Connection/validateSyntax` | `SQLite.prepare` (980); `Store.sql` (980) | SQL |
| [packages/server/src/pgwire.ts:828](../../packages/server/src/pgwire.ts#L828) `Connection/bareNames` | `Store.describe` (828) | SQL |
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
| [packages/store/src/store.ts:1031](../../packages/store/src/store.ts#L1031) `Store/constructor` | `Store.sql` (1031, 1033, 1035, 1036, 1040, 1044, 1045, 1056, 1061, 1066, 1067, 1071, 1072, 1073, 1080, 1084, 1088, 1089, 1090, 1095, 1099, 1102, 1103, 1105, 1106, 1109, 1110, 1114, 1115, 1119, 1120, 1123, 1125, 1128, 1129, 1133, 1134, 1138, 1139, 1142, 1143, 1144, 1147, 1148, 1151, 1152, 1154, 1154, 1155, 1155, 1156, 1159, 1163, 1165, 1168, 1169, 1170, 1173, 1174, 1176, 1178, 1179, 1183, 1184, 1186, 1190, 1192, 1193, 1194, 1194, 1198, 1199); `SQLite.get` (1035); `SQLite.prepare` (1035, 1102, 1103, 1106, 1109, 1114, 1119, 1128, 1133, 1138, 1147, 1151, 1154, 1155, 1173, 1178, 1183); `SQLite.all` (1102, 1109, 1114, 1119, 1128, 1133, 1138, 1147, 1151, 1154, 1155, 1173, 1178, 1183) | CORE |
| [packages/store/src/store.ts:1256](../../packages/store/src/store.ts#L1256) `Store/grantFullAccessClients` | `SQLite.prepare` (1256); `Store.sql` (1256) | CORE |
| [packages/store/src/store.ts:1279](../../packages/store/src/store.ts#L1279) `Store/meta` | `SQLite.get` (1279); `SQLite.prepare` (1279); `Store.sql` (1279) | CORE |
| [packages/store/src/store.ts:3534](../../packages/store/src/store.ts#L3534) `Store/webViewerChecked` | `SQLite.get` (3534); `SQLite.prepare` (3534); `Store.sql` (3534) | CORE |
| [packages/store/src/store.ts:1287](../../packages/store/src/store.ts#L1287) `Store/persistentTable` | `Store.sql` (1287) | CORE |
| [packages/store/src/store.ts:1297](../../packages/store/src/store.ts#L1297) `Store/persistentData` | `SQLite.get` (1297) | CORE |
| [packages/store/src/store.ts:1306](../../packages/store/src/store.ts#L1306) `Store/persistentDataIds` | `SQLite.all` (1306) | CORE |
| [packages/store/src/store.ts:1312](../../packages/store/src/store.ts#L1312) `Store/setPersistentData` | `SQLite.prepare` (1312, 1316); `Store.sql` (1312, 1316) | CORE |
| [packages/store/src/store.ts:1336](../../packages/store/src/store.ts#L1336) `Store/checkpoint` | `SQLite.get` (1336); `SQLite.prepare` (1336); `Store.sql` (1336) | CORE |
| [packages/store/src/store.ts:1344](../../packages/store/src/store.ts#L1344) `Store/recordedFormat` | `Store.sql` (1344) | CORE |
| [packages/store/src/store.ts:1354](../../packages/store/src/store.ts#L1354) `Store/close` | `Store.sql` (1354) | CORE |
| [packages/store/src/store.ts:1370](../../packages/store/src/store.ts#L1370) `Store/shipWal` | `Store.sql` (1370) | CORE |
| [packages/store/src/store.ts:1381](../../packages/store/src/store.ts#L1381) `Store/trial` | `Store.sql` (1381) | CORE |
| [packages/store/src/store.ts:1386](../../packages/store/src/store.ts#L1386) `Store/trial/undo` | `Store.sql` (1386) | CORE |
| [packages/store/src/store.ts:1477](../../packages/store/src/store.ts#L1477) `Store/joinTransaction` | `Store.sql` (1477, 1478, 1480, 1482, 1488) | CORE |
| [packages/store/src/store.ts:1500](../../packages/store/src/store.ts#L1500) `Store/independentWindowWrite` | `SQLite.get` (1500); `SQLite.prepare` (1500, 1523); `Store.sql` (1500, 1503, 1518, 1523, 1526) | CORE |
| [packages/store/src/store.ts:1553](../../packages/store/src/store.ts#L1553) `Store/withWriteTransaction` | `Store.sql` (1553, 1564, 1570, 1572, 1572) | CORE |
| [packages/store/src/store.ts:1622](../../packages/store/src/store.ts#L1622) `Store/endTransaction` | `Store.sql` (1622, 1625, 1625) | CORE |
| [packages/store/src/store.ts:1652](../../packages/store/src/store.ts#L1652) `Store/backup` | `Store.sql` (1652) | CORE |
| [packages/store/src/store.ts:1742](../../packages/store/src/store.ts#L1742) `Store/dataVersion` | `SQLite.get` (1742); `SQLite.prepare` (1742); `Store.sql` (1742) | CORE |
| [packages/store/src/store.ts:1782](../../packages/store/src/store.ts#L1782) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1782) | CORE |
| [packages/store/src/store.ts:1803](../../packages/store/src/store.ts#L1803) `Store/shareResults` | `Store.sql` (1803) | CORE |
| [packages/store/src/store.ts:1813](../../packages/store/src/store.ts#L1813) `Store/versionTriggers` | `SQLite.get` (1813); `SQLite.prepare` (1813, 1818, 1819); `Store.sql` (1813, 1815, 1816, 1818, 1819, 1828, 1829); `SQLite.all` (1818, 1819) | CORE |
| [packages/store/src/store.ts:1845](../../packages/store/src/store.ts#L1845) `Store/versionNumber` | `SQLite.get` (1845); `SQLite.prepare` (1845); `Store.sql` (1845) | CORE |
| [packages/store/src/store.ts:1858](../../packages/store/src/store.ts#L1858) `Store/changeOne` | `Store.sql` (1858, 1860) | CORE |
| [packages/store/src/store.ts:1861](../../packages/store/src/store.ts#L1861) `Store/changeOne/read` | `SQLite.get` (1861); `SQLite.prepare` (1861); `Store.sql` (1861) | CORE |
| [packages/store/src/store.ts:1900](../../packages/store/src/store.ts#L1900) `Store/writeToken` | `SQLite.get` (1900); `SQLite.prepare` (1900); `Store.sql` (1900) | CORE |
| [packages/store/src/store.ts:1912](../../packages/store/src/store.ts#L1912) `Store/recordCount` | `SQLite.get` (1912); `SQLite.prepare` (1912); `Store.sql` (1912) | CORE |
| [packages/store/src/store.ts:2026](../../packages/store/src/store.ts#L2026) `Store/applyDesign` | `Store.sql` (2026, 2027, 2040, 2043, 2048, 2064, 2067, 2067); `SQLite.prepare` (2043, 2048) | CORE |
| [packages/store/src/store.ts:2125](../../packages/store/src/store.ts#L2125) `Store/auditLog` | `SQLite.all` (2125); `SQLite.prepare` (2125); `Store.sql` (2125) | CORE |
| [packages/store/src/store.ts:2165](../../packages/store/src/store.ts#L2165) `Store/securityEvents` | `Store.auditLog` (2165) | CORE |
| [packages/store/src/store.ts:2191](../../packages/store/src/store.ts#L2191) `Store/prepared` | `SQLite.prepare` (2191); `Store.sql` (2191) | CORE |
| [packages/store/src/store.ts:2206](../../packages/store/src/store.ts#L2206) `Store/recordAsOf` | `SQLite.get` (2206, 2208); `SQLite.prepare` (2206, 2208, 2210, 2211); `Store.sql` (2206, 2208, 2210, 2211); `SQLite.all` (2210, 2211) | CORE |
| [packages/store/src/store.ts:2284](../../packages/store/src/store.ts#L2284) `Store/revertAuditEntry` | `Store.auditLog` (2284) | CORE |
| [packages/store/src/store.ts:2377](../../packages/store/src/store.ts#L2377) `Store/setAuditSettings` | `SQLite.prepare` (2377); `Store.sql` (2377) | CORE |
| [packages/store/src/store.ts:2399](../../packages/store/src/store.ts#L2399) `Store/pruneAudit` | `Store.sql` (2399, 2401, 2403); `SQLite.get` (2401); `SQLite.prepare` (2401) | CORE |
| [packages/store/src/store.ts:2481](../../packages/store/src/store.ts#L2481) `Store/audit` | `Store.sql` (2481) | CORE |
| [packages/store/src/store.ts:2570](../../packages/store/src/store.ts#L2570) `Store/securityChange` | `Store.sql` (2570, 2572); `SQLite.prepare` (2572) | CORE |
| [packages/store/src/store.ts:2619](../../packages/store/src/store.ts#L2619) `Store/logSecurity` | `Store.sql` (2619) | CORE |
| [packages/store/src/store.ts:2642](../../packages/store/src/store.ts#L2642) `Store/ensureDeleted` | `Store.sql` (2642) | CORE |
| [packages/store/src/store.ts:2647](../../packages/store/src/store.ts#L2647) `Store/deletedRows` | `SQLite.get` (2647); `SQLite.prepare` (2647, 2649, 2649); `Store.sql` (2647, 2649, 2649); `SQLite.all` (2649, 2649) | CORE |
| [packages/store/src/store.ts:2673](../../packages/store/src/store.ts#L2673) `Store/emptyDeleted` | `Store.sql` (2673, 2676, 2677, 2679, 2681); `SQLite.prepare` (2677) | CORE |
| [packages/store/src/store.ts:2688](../../packages/store/src/store.ts#L2688) `Store/designHistory` | `SQLite.all` (2688); `SQLite.prepare` (2688); `Store.sql` (2688) | CORE |
| [packages/store/src/store.ts:2695](../../packages/store/src/store.ts#L2695) `Store/scriptHistory` | `SQLite.all` (2695); `SQLite.prepare` (2695); `Store.sql` (2695) | CORE |
| [packages/store/src/store.ts:2705](../../packages/store/src/store.ts#L2705) `Store/layoutHistory` | `SQLite.all` (2705); `SQLite.prepare` (2705); `Store.sql` (2705) | CORE |
| [packages/store/src/store.ts:2734](../../packages/store/src/store.ts#L2734) `Store/designEffect/renameKey` | `SQLite.prepare` (2734); `Store.sql` (2734) | CORE |
| [packages/store/src/store.ts:2750](../../packages/store/src/store.ts#L2750) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2750); `Store.sql` (2750) | CORE |
| [packages/store/src/store.ts:2757](../../packages/store/src/store.ts#L2757) `Store/designEffect` | `Store.sql` (2757, 2762, 2767, 2772, 2775, 2781, 2792, 2793, 2795, 2808, 2809, 2812, 2814, 2820, 2821, 2822, 2827, 2829, 2833, 2836, 2837, 2839, 2842, 2848, 2850, 2857, 2858, 2860, 2861, 2862, 2863, 2870, 2871, 2873, 2873, 2875, 2876, 2877, 2881, 2885, 2887, 2925, 2927, 2929); `SQLite.get` (2792, 2808, 2820, 2821, 2833, 2837, 2873, 2881); `SQLite.prepare` (2792, 2793, 2808, 2809, 2820, 2821, 2827, 2829, 2833, 2837, 2848, 2850, 2863, 2870, 2871, 2873, 2875, 2877, 2881, 2885); `SQLite.all` (2870, 2871); `SQLite.iterate` (2875) | CORE |
| [packages/store/src/store.ts:2937](../../packages/store/src/store.ts#L2937) `Store/dropColumnIndexes` | `SQLite.all` (2937, 2939); `SQLite.prepare` (2937, 2939); `Store.sql` (2937, 2939, 2940) | CORE |
| [packages/store/src/store.ts:2949](../../packages/store/src/store.ts#L2949) `Store/recompute` | `SQLite.prepare` (2949, 2953); `Store.sql` (2949, 2953); `SQLite.iterate` (2953); `Calculations.computeStoredStyled` (2954); `Calculations.value` (2954) | CORE |
| [packages/store/src/store.ts:2969](../../packages/store/src/store.ts#L2969) `Store/linkPrincipal` | `SQLite.get` (2969); `SQLite.prepare` (2969); `Store.sql` (2969) | CORE |
| [packages/store/src/store.ts:2977](../../packages/store/src/store.ts#L2977) `Store/linkIdentity` | `SQLite.get` (2977); `SQLite.prepare` (2977); `Store.sql` (2977) | CORE |
| [packages/store/src/store.ts:3002](../../packages/store/src/store.ts#L3002) `Store/credentialIdentity` | `SQLite.get` (3002); `SQLite.prepare` (3002); `Store.sql` (3002) | CORE |
| [packages/store/src/store.ts:3008](../../packages/store/src/store.ts#L3008) `Store/accountsSharingLockout` | `SQLite.all` (3008); `SQLite.prepare` (3008); `Store.sql` (3008) | CORE |
| [packages/store/src/store.ts:3012](../../packages/store/src/store.ts#L3012) `Store/accounts` | `SQLite.all` (3012); `SQLite.prepare` (3012); `Store.sql` (3012) | CORE |
| [packages/store/src/store.ts:3024](../../packages/store/src/store.ts#L3024) `Store/isAgent` | `SQLite.get` (3024); `SQLite.prepare` (3024); `Store.sql` (3024) | CORE |
| [packages/store/src/store.ts:3030](../../packages/store/src/store.ts#L3030) `Store/agentNeedsApproval` | `SQLite.get` (3030); `SQLite.prepare` (3030); `Store.sql` (3030) | CORE |
| [packages/store/src/store.ts:3036](../../packages/store/src/store.ts#L3036) `Store/blankPasswordAccounts` | `SQLite.all` (3036); `SQLite.prepare` (3036); `Store.sql` (3036) | CORE |
| [packages/store/src/store.ts:1264](../../packages/store/src/store.ts#L1264) `Store/hasOwnPassword` | `SQLite.get` (1264); `SQLite.prepare` (1264); `Store.sql` (1264) | CORE |
| [packages/store/src/store.ts:3047](../../packages/store/src/store.ts#L3047) `Store/unmigratedAccounts` | `SQLite.all` (3047); `SQLite.prepare` (3047); `Store.sql` (3047) | CORE |
| [packages/store/src/store.ts:3100](../../packages/store/src/store.ts#L3100) `Store/setExternalAccount` | `SQLite.get` (3100); `SQLite.prepare` (3100, 3105); `Store.sql` (3100, 3105) | CORE |
| [packages/store/src/store.ts:3118](../../packages/store/src/store.ts#L3118) `Store/refuseLookalikeAccount` | `SQLite.all` (3118); `SQLite.prepare` (3118); `Store.sql` (3118) | CORE |
| [packages/store/src/store.ts:3127](../../packages/store/src/store.ts#L3127) `Store/isExternal` | `SQLite.get` (3127); `SQLite.prepare` (3127); `Store.sql` (3127) | CORE |
| [packages/store/src/store.ts:3148](../../packages/store/src/store.ts#L3148) `Store/setAgentAccount` | `SQLite.get` (3148); `SQLite.prepare` (3148, 3154); `Store.sql` (3148, 3154) | CORE |
| [packages/store/src/store.ts:3188](../../packages/store/src/store.ts#L3188) `Store/gateAgentWrite` | `SQLite.prepare` (3188); `Store.sql` (3188) | CORE |
| [packages/store/src/store.ts:3210](../../packages/store/src/store.ts#L3210) `Store/pendingChanges` | `SQLite.all` (3210); `SQLite.prepare` (3210); `Store.sql` (3210) | CORE |
| [packages/store/src/store.ts:3224](../../packages/store/src/store.ts#L3224) `Store/approvePending` | `SQLite.get` (3224); `SQLite.prepare` (3224, 3235); `Store.sql` (3224, 3235) | CORE |
| [packages/store/src/store.ts:3245](../../packages/store/src/store.ts#L3245) `Store/rejectPending` | `SQLite.get` (3245); `SQLite.prepare` (3245, 3247); `Store.sql` (3245, 3247) | CORE |
| [packages/store/src/store.ts:3267](../../packages/store/src/store.ts#L3267) `Store/externalAccount` | `SQLite.all` (3267); `SQLite.prepare` (3267); `Store.sql` (3267) | CORE |
| [packages/store/src/store.ts:3298](../../packages/store/src/store.ts#L3298) `Store/setPassword` | `SQLite.get` (3298); `SQLite.prepare` (3298, 3300, 3309); `Store.sql` (3298, 3300, 3309) | AUTH |
| [packages/store/src/store.ts:3323](../../packages/store/src/store.ts#L3323) `Store/createAccount` | `SQLite.get` (3323); `SQLite.prepare` (3323, 3327, 3333, 3338, 3343); `Store.sql` (3323, 3327, 3333, 3338, 3343) | CORE |
| [packages/store/src/store.ts:3351](../../packages/store/src/store.ts#L3351) `Store/appendSecurityEvent` | `Store.sql` (3351) | CORE |
| [packages/store/src/store.ts:3393](../../packages/store/src/store.ts#L3393) `Store/setPasswordPolicy` | `SQLite.prepare` (3393); `Store.sql` (3393) | CORE |
| [packages/store/src/store.ts:3429](../../packages/store/src/store.ts#L3429) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3429); `Store.sql` (3429) | CORE |
| [packages/store/src/store.ts:3452](../../packages/store/src/store.ts#L3452) `Store/saveScriptTest` | `SQLite.prepare` (3452); `Store.sql` (3452) | CORE |
| [packages/store/src/store.ts:3461](../../packages/store/src/store.ts#L3461) `Store/deleteScriptTest` | `SQLite.prepare` (3461); `Store.sql` (3461) | CORE |
| [packages/store/src/store.ts:3496](../../packages/store/src/store.ts#L3496) `Store/setAiAllowed` | `SQLite.prepare` (3496); `Store.sql` (3496) | CORE |
| [packages/store/src/store.ts:3563](../../packages/store/src/store.ts#L3563) `Store/setAiPolicy` | `SQLite.prepare` (3563); `Store.sql` (3563) | CORE |
| [packages/store/src/store.ts:3511](../../packages/store/src/store.ts#L3511) `Store/setScriptNetwork` | `SQLite.prepare` (3511); `Store.sql` (3511) | CORE |
| [packages/store/src/store.ts:3552](../../packages/store/src/store.ts#L3552) `Store/setWebViewerHosts` | `SQLite.prepare` (3552); `Store.sql` (3552) | CORE |
| [packages/store/src/store.ts:3583](../../packages/store/src/store.ts#L3583) `Store/setPiiIsolation` | `SQLite.prepare` (3583); `Store.sql` (3583) | CORE |
| [packages/store/src/store.ts:3605](../../packages/store/src/store.ts#L3605) `Store/markPiiField` | `SQLite.prepare` (3605); `Store.sql` (3605) | CORE |
| [packages/store/src/store.ts:3719](../../packages/store/src/store.ts#L3719) `Store/lastSignIns` | `Store.auditLog` (3719) | CORE |
| [packages/store/src/store.ts:3922](../../packages/store/src/store.ts#L3922) `Store/unusualAccess` | `Store.auditLog` (3922, 3988) | CORE |
| [packages/store/src/store.ts:4019](../../packages/store/src/store.ts#L4019) `Store/leastPrivilege` | `SQLite.all` (4019); `SQLite.prepare` (4019); `Store.sql` (4019) | CORE |
| [packages/store/src/store.ts:4092](../../packages/store/src/store.ts#L4092) `Store/unusedAccess` | `SQLite.get` (4092); `SQLite.prepare` (4092, 4101); `Store.sql` (4092, 4101); `SQLite.all` (4101) | CORE |
| [packages/store/src/store.ts:4140](../../packages/store/src/store.ts#L4140) `Store/unusedObjects` | `SQLite.get` (4140); `SQLite.prepare` (4140, 4143); `Store.sql` (4140, 4143); `SQLite.all` (4143) | CORE |
| [packages/store/src/store.ts:4178](../../packages/store/src/store.ts#L4178) `Store/usageCounting` | `SQLite.get` (4178); `SQLite.prepare` (4178); `Store.sql` (4178) | CORE |
| [packages/store/src/store.ts:4186](../../packages/store/src/store.ts#L4186) `Store/setMustChangePassword` | `SQLite.prepare` (4186); `Store.sql` (4186) | CORE |
| [packages/store/src/store.ts:4200](../../packages/store/src/store.ts#L4200) `Store/mustChangePassword` | `SQLite.get` (4200); `SQLite.prepare` (4200); `Store.sql` (4200) | CORE |
| [packages/store/src/store.ts:4239](../../packages/store/src/store.ts#L4239) `Store/passwordDaysRemaining` | `SQLite.get` (4239); `SQLite.prepare` (4239); `Store.sql` (4239) | CORE |
| [packages/store/src/store.ts:4246](../../packages/store/src/store.ts#L4246) `Store/importAccounts` | `SQLite.all` (4246); `SQLite.prepare` (4246); `Store.sql` (4246) | CORE |
| [packages/store/src/store.ts:4269](../../packages/store/src/store.ts#L4269) `Store/canonicalAccount` | `SQLite.all` (4269); `SQLite.prepare` (4269); `Store.sql` (4269) | CORE |
| [packages/store/src/store.ts:4281](../../packages/store/src/store.ts#L4281) `Store/createLocalAccount` | `SQLite.prepare` (4281); `Store.sql` (4281) | CORE |
| [packages/store/src/store.ts:4311](../../packages/store/src/store.ts#L4311) `Store/previewAccountImport` | `Store.sql` (4311, 4312, 4321) | CORE |
| [packages/store/src/store.ts:4329](../../packages/store/src/store.ts#L4329) `Store/limitAccountImport` | `SQLite.prepare` (4329, 4330, 4333); `Store.sql` (4329, 4330, 4333); `SQLite.get` (4330) | CORE |
| [packages/store/src/store.ts:4340](../../packages/store/src/store.ts#L4340) `Store/applyAccountImport` | `Store.sql` (4340, 4348, 4377); `SQLite.get` (4348); `SQLite.prepare` (4348, 4377) | CORE |
| [packages/store/src/store.ts:4402](../../packages/store/src/store.ts#L4402) `Store/forgetStandIns` | `SQLite.prepare` (4402); `Store.sql` (4402) | CORE |
| [packages/store/src/store.ts:4435](../../packages/store/src/store.ts#L4435) `Store/deleteAccount` | `SQLite.prepare` (4435, 4439, 4440, 4441, 4442, 4443, 4444, 4445, 4446, 4453, 4455, 4458, 4462); `Store.sql` (4435, 4439, 4440, 4441, 4442, 4443, 4444, 4445, 4446, 4453, 4455, 4458, 4462) | CORE |
| [packages/store/src/store.ts:4479](../../packages/store/src/store.ts#L4479) `Store/setAccountActive` | `SQLite.prepare` (4479, 4482, 4483); `Store.sql` (4479, 4482, 4483) | AUTH |
| [packages/store/src/store.ts:4493](../../packages/store/src/store.ts#L4493) `Store/accountInactive` | `SQLite.get` (4493); `SQLite.prepare` (4493); `Store.sql` (4493) | CORE |
| [packages/store/src/store.ts:4498](../../packages/store/src/store.ts#L4498) `Store/identityAllowed` | `SQLite.get` (4498, 4504, 4510); `SQLite.prepare` (4498, 4504, 4510); `Store.sql` (4498, 4504, 4510) | CORE |
| [packages/store/src/store.ts:4519](../../packages/store/src/store.ts#L4519) `Store/externalIdentityId` | `SQLite.get` (4519, 4525); `SQLite.prepare` (4519, 4524, 4525); `Store.sql` (4519, 4524, 4525) | CORE |
| [packages/store/src/store.ts:4530](../../packages/store/src/store.ts#L4530) `Store/accountIdentityId` | `SQLite.get` (4530, 4535); `SQLite.prepare` (4530, 4534, 4535); `Store.sql` (4530, 4534, 4535) | CORE |
| [packages/store/src/store.ts:4558](../../packages/store/src/store.ts#L4558) `Store/signInMark` | `SQLite.prepare` (4558); `Store.sql` (4558) | AUTH |
| [packages/store/src/store.ts:4568](../../packages/store/src/store.ts#L4568) `Store/signInBase` | `SQLite.get` (4568); `SQLite.prepare` (4568); `Store.sql` (4568) | AUTH |
| [packages/store/src/store.ts:4570](../../packages/store/src/store.ts#L4570) `Store/signInBase/identity` | `SQLite.get` (4570); `SQLite.prepare` (4570); `Store.sql` (4570) | AUTH |
| [packages/store/src/store.ts:4582](../../packages/store/src/store.ts#L4582) `Store/ledgerRow` | `SQLite.get` (4582, 4583); `SQLite.prepare` (4582, 4583); `Store.sql` (4582, 4583) | AUTH |
| [packages/store/src/store.ts:4594](../../packages/store/src/store.ts#L4594) `Store/ledgerWrite` | `Store.sql` (4594, 4595, 4597, 4599, 4602, 4602) | AUTH |
| [packages/store/src/store.ts:4621](../../packages/store/src/store.ts#L4621) `Store/settleSignIns` | `SQLite.all` (4621, 4627); `SQLite.prepare` (4621, 4627, 4633, 4637, 4639); `Store.sql` (4621, 4627, 4633, 4637, 4639) | AUTH |
| [packages/store/src/store.ts:4650](../../packages/store/src/store.ts#L4650) `Store/securityToken` | `SQLite.get` (4650); `SQLite.prepare` (4650); `Store.sql` (4650) | CORE |
| [packages/store/src/store.ts:4658](../../packages/store/src/store.ts#L4658) `Store/accountLocalOnly` | `SQLite.get` (4658); `SQLite.prepare` (4658); `Store.sql` (4658) | CORE |
| [packages/store/src/store.ts:4663](../../packages/store/src/store.ts#L4663) `Store/accountRequires2fa` | `SQLite.get` (4663); `SQLite.prepare` (4663); `Store.sql` (4663) | CORE |
| [packages/store/src/store.ts:4669](../../packages/store/src/store.ts#L4669) `Store/setAccountLocalOnly` | `SQLite.prepare` (4669); `Store.sql` (4669) | CORE |
| [packages/store/src/store.ts:4678](../../packages/store/src/store.ts#L4678) `Store/setAccountRequire2fa` | `SQLite.prepare` (4678); `Store.sql` (4678) | CORE |
| [packages/store/src/store.ts:4707](../../packages/store/src/store.ts#L4707) `Store/createApiToken` | `SQLite.get` (4707); `SQLite.prepare` (4707, 4737); `Store.sql` (4707, 4737) | CORE |
| [packages/store/src/store.ts:4784](../../packages/store/src/store.ts#L4784) `Store/recordObjectUse` | `Store.sql` (4784) | CORE |
| [packages/store/src/store.ts:4814](../../packages/store/src/store.ts#L4814) `Store/writeUsage` | `Store.sql` (4814, 4815, 4817, 4821, 4823) | CORE |
| [packages/store/src/store.ts:4830](../../packages/store/src/store.ts#L4830) `Store/writeUsageRows` | `SQLite.prepare` (4830, 4831, 4837); `Store.sql` (4830, 4831, 4837) | CORE |
| [packages/store/src/store.ts:4842](../../packages/store/src/store.ts#L4842) `Store/writeObjectUseRows` | `SQLite.prepare` (4842, 4843, 4848); `Store.sql` (4842, 4843, 4848) | CORE |
| [packages/store/src/store.ts:4853](../../packages/store/src/store.ts#L4853) `Store/objectUseSince` | `SQLite.get` (4853); `SQLite.prepare` (4853); `Store.sql` (4853) | CORE |
| [packages/store/src/store.ts:4866](../../packages/store/src/store.ts#L4866) `Store/accountUsage` | `SQLite.get` (4866); `SQLite.prepare` (4866, 4867); `Store.sql` (4866, 4867); `SQLite.all` (4867); `Store.auditLog` (4883) | CORE |
| [packages/store/src/store.ts:4899](../../packages/store/src/store.ts#L4899) `Store/apiTokens` | `SQLite.all` (4899); `SQLite.prepare` (4899); `Store.sql` (4899) | CORE |
| [packages/store/src/store.ts:4909](../../packages/store/src/store.ts#L4909) `Store/revokeApiToken` | `SQLite.prepare` (4909); `Store.sql` (4909) | CORE |
| [packages/store/src/store.ts:4923](../../packages/store/src/store.ts#L4923) `Store/apiToken` | `SQLite.get` (4923); `SQLite.prepare` (4923, 4935); `Store.sql` (4923, 4935) | CORE |
| [packages/store/src/store.ts:4951](../../packages/store/src/store.ts#L4951) `Store/enrollTotp` | `SQLite.prepare` (4951); `Store.sql` (4951) | CORE |
| [packages/store/src/store.ts:4962](../../packages/store/src/store.ts#L4962) `Store/confirmTotp` | `SQLite.get` (4962); `SQLite.prepare` (4962, 4964); `Store.sql` (4962, 4964) | CORE |
| [packages/store/src/store.ts:4972](../../packages/store/src/store.ts#L4972) `Store/hasTotp` | `SQLite.get` (4972); `SQLite.prepare` (4972); `Store.sql` (4972) | CORE |
| [packages/store/src/store.ts:4977](../../packages/store/src/store.ts#L4977) `Store/totpAccounts` | `SQLite.all` (4977); `SQLite.prepare` (4977); `Store.sql` (4977) | CORE |
| [packages/store/src/store.ts:4983](../../packages/store/src/store.ts#L4983) `Store/disableTotp` | `SQLite.prepare` (4983); `Store.sql` (4983) | CORE |
| [packages/store/src/store.ts:5006](../../packages/store/src/store.ts#L5006) `Store/verifyTotp` | `SQLite.get` (5006); `SQLite.prepare` (5006, 5012); `Store.sql` (5006, 5012) | CORE |
| [packages/store/src/store.ts:5025](../../packages/store/src/store.ts#L5025) `Store/issueWebauthnChallenge` | `SQLite.prepare` (5025, 5027, 5028, 5030); `Store.sql` (5025, 5027, 5028, 5030); `SQLite.get` (5027) | CORE |
| [packages/store/src/store.ts:5077](../../packages/store/src/store.ts#L5077) `Store/passkeyAllowList` | `SQLite.all` (5077); `SQLite.prepare` (5077); `Store.sql` (5077) | CORE |
| [packages/store/src/store.ts:5091](../../packages/store/src/store.ts#L5091) `Store/takeWebauthnChallenge` | `SQLite.get` (5091); `SQLite.prepare` (5091, 5093); `Store.sql` (5091, 5093) | CORE |
| [packages/store/src/store.ts:5101](../../packages/store/src/store.ts#L5101) `Store/passkeys` | `SQLite.all` (5101); `SQLite.prepare` (5101); `Store.sql` (5101) | CORE |
| [packages/store/src/store.ts:5108](../../packages/store/src/store.ts#L5108) `Store/hasPasskey` | `SQLite.get` (5108); `SQLite.prepare` (5108); `Store.sql` (5108) | CORE |
| [packages/store/src/store.ts:5113](../../packages/store/src/store.ts#L5113) `Store/passkeyIds` | `SQLite.all` (5113); `SQLite.prepare` (5113); `Store.sql` (5113) | CORE |
| [packages/store/src/store.ts:5135](../../packages/store/src/store.ts#L5135) `Store/registerPasskey` | `SQLite.prepare` (5135); `Store.sql` (5135) | CORE |
| [packages/store/src/store.ts:5146](../../packages/store/src/store.ts#L5146) `Store/removePasskey` | `SQLite.get` (5146); `SQLite.prepare` (5146, 5147); `Store.sql` (5146, 5147) | CORE |
| [packages/store/src/store.ts:5163](../../packages/store/src/store.ts#L5163) `Store/verifyPasskeyAssertion` | `SQLite.get` (5163); `SQLite.prepare` (5163, 5174); `Store.sql` (5163, 5174) | CORE |
| [packages/store/src/store.ts:5210](../../packages/store/src/store.ts#L5210) `Store/generateRecoveryCodes` | `SQLite.prepare` (5210, 5213); `Store.sql` (5210, 5213) | CORE |
| [packages/store/src/store.ts:5228](../../packages/store/src/store.ts#L5228) `Store/recoveryCodesRemaining` | `SQLite.get` (5228); `SQLite.prepare` (5228); `Store.sql` (5228) | CORE |
| [packages/store/src/store.ts:5238](../../packages/store/src/store.ts#L5238) `Store/useRecoveryCode` | `SQLite.get` (5238); `SQLite.prepare` (5238, 5240); `Store.sql` (5238, 5240) | CORE |
| [packages/store/src/store.ts:5251](../../packages/store/src/store.ts#L5251) `Store/privilegeSets` | `Store.sql` (5251) | CORE |
| [packages/store/src/store.ts:5280](../../packages/store/src/store.ts#L5280) `Store/savePrivilegeSet` | `SQLite.prepare` (5280, 5288); `Store.sql` (5280, 5288) | AUTH |
| [packages/store/src/store.ts:5323](../../packages/store/src/store.ts#L5323) `Store/deletePrivilegeSet` | `SQLite.prepare` (5323); `Store.sql` (5323) | CORE |
| [packages/store/src/store.ts:5392](../../packages/store/src/store.ts#L5392) `Store/accountPrivilegeSet` | `SQLite.get` (5392); `SQLite.prepare` (5392); `Store.sql` (5392) | CORE |
| [packages/store/src/store.ts:5406](../../packages/store/src/store.ts#L5406) `Store/setAccountPrivilegeSet` | `SQLite.get` (5406); `SQLite.prepare` (5406, 5409, 5413); `Store.sql` (5406, 5409, 5413) | AUTH |
| [packages/store/src/store.ts:5428](../../packages/store/src/store.ts#L5428) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5428); `Store.sql` (5428) | CORE |
| [packages/store/src/store.ts:5442](../../packages/store/src/store.ts#L5442) `Store/addProvisionedAccount` | `SQLite.get` (5442); `SQLite.prepare` (5442, 5446); `Store.sql` (5442, 5446) | CORE |
| [packages/store/src/store.ts:5615](../../packages/store/src/store.ts#L5615) `Store/ruleOutcome` | `Calculations.context` (5615) | CORE |
| [packages/store/src/store.ts:5656](../../packages/store/src/store.ts#L5656) `Store/allowedIds` | `SQLite.iterate` (5656); `SQLite.prepare` (5656); `Store.sql` (5656) | CORE |
| [packages/store/src/store.ts:5754](../../packages/store/src/store.ts#L5754) `Store/scopedTableSql` | `Store.viewableIds` (5754); `SQLite.all` (5757); `SQLite.prepare` (5757); `Store.sql` (5757) | GATED-STORE |
| [packages/store/src/store.ts:5789](../../packages/store/src/store.ts#L5789) `Store/previewRecordRuleCurrent` | `SQLite.get` (5789); `SQLite.prepare` (5789, 5792); `Store.sql` (5789, 5792); `SQLite.all` (5792); `Calculations.context` (5798, 5814) | CORE |
| [packages/store/src/store.ts:5966](../../packages/store/src/store.ts#L5966) `Store/passwordHash` | `SQLite.get` (5966); `SQLite.prepare` (5966); `Store.sql` (5966) | CORE |
| [packages/store/src/store.ts:5995](../../packages/store/src/store.ts#L5995) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5995); `Store.sql` (5995) | CORE |
| [packages/store/src/store.ts:6008](../../packages/store/src/store.ts#L6008) `Store/knownSharedAccount` | `SQLite.get` (6008); `SQLite.prepare` (6008); `Store.sql` (6008) | CORE |
| [packages/store/src/store.ts:6071](../../packages/store/src/store.ts#L6071) `Store/layouts` | `SQLite.all` (6071); `SQLite.prepare` (6071); `Store.sql` (6071) | CORE |
| [packages/store/src/store.ts:6092](../../packages/store/src/store.ts#L6092) `Store/image` | `SQLite.get` (6092); `SQLite.prepare` (6092); `Store.sql` (6092) | CORE |
| [packages/store/src/store.ts:6102](../../packages/store/src/store.ts#L6102) `Store/images` | `SQLite.all` (6102); `SQLite.prepare` (6102); `Store.sql` (6102) | CORE |
| [packages/store/src/store.ts:6115](../../packages/store/src/store.ts#L6115) `Store/addImage` | `Store.sql` (6115, 6116); `SQLite.prepare` (6116) | CORE |
| [packages/store/src/store.ts:6132](../../packages/store/src/store.ts#L6132) `Store/layout` | `SQLite.get` (6132); `SQLite.prepare` (6132); `Store.sql` (6132) | CORE |
| [packages/store/src/store.ts:6336](../../packages/store/src/store.ts#L6336) `Store/wordIndex` | `Store.sql` (6336, 6344, 6349); `Store.recordCount` (6348); `SQLite.get` (6349); `SQLite.prepare` (6349) | CORE |
| [packages/store/src/store.ts:6401](../../packages/store/src/store.ts#L6401) `Store/toRecord` | `Calculations.value` (6401, 6411); `Calculations.globalValue` (6405); `Calculations.unstoredStyled` (6410) | CORE |
| [packages/store/src/store.ts:6460](../../packages/store/src/store.ts#L6460) `Store/relatedValues` | `Calculations.globalValue` (6460); `Calculations.unstoredValue` (6462) | CORE |
| [packages/store/src/store.ts:6534](../../packages/store/src/store.ts#L6534) `Store/addRelated` | `relatedRows` (6534); `rowsById` (6566); `firstRelatedEach` (6589) | CORE |
| [packages/store/src/store.ts:6617](../../packages/store/src/store.ts#L6617) `Store/foundSetPage` | `rowsById` (6617) | CORE |
| [packages/store/src/store.ts:6633](../../packages/store/src/store.ts#L6633) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6633); `Store.row` (6649) | GATED-STORE |
| [packages/store/src/store.ts:6672](../../packages/store/src/store.ts#L6672) `Store/portalCountsCurrent` | `Store.canView` (6672); `Store.row` (6699) | GATED-STORE |
| [packages/store/src/store.ts:6735](../../packages/store/src/store.ts#L6735) `Store/fieldIndexCurrent` | `SQLite.iterate` (6735); `SQLite.prepare` (6735, 6740); `Store.sql` (6735, 6740); `SQLite.all` (6740) | GATED-STORE |
| [packages/store/src/store.ts:6781](../../packages/store/src/store.ts#L6781) `Store/valueListItemsCurrent` | `Store.valueListItems` (6781); `Store.get` (6795); `relatedRows` (6796); `Store.row` (6796); `SQLite.iterate` (6798); `SQLite.prepare` (6798); `Store.sql` (6798); `Calculations.related` (6808); `Calculations.value` (6812, 6813) | GATED-STORE |
| [packages/store/src/store.ts:6910](../../packages/store/src/store.ts#L6910) `Store/portalRows` | `relatedRows` (6910); `relatedIdList` (6911); `Store.viewableIds` (6914); `rowsById` (6939, 6977); `Calculations.related` (6953) | CORE |
| [packages/store/src/store.ts:6921](../../packages/store/src/store.ts#L6921) `Store/portalRows/context` | `Calculations.context` (6921) | CORE |
| [packages/store/src/store.ts:6931](../../packages/store/src/store.ts#L6931) `Store/portalRows/valueOf` | `Calculations.value` (6931) | CORE |
| [packages/store/src/store.ts:7048](../../packages/store/src/store.ts#L7048) `Store/markRepeating` | `SQLite.prepare` (7048); `Store.sql` (7048) | CORE |
| [packages/store/src/store.ts:7075](../../packages/store/src/store.ts#L7075) `Store/externalContainerCheck` | `SQLite.all` (7075); `SQLite.prepare` (7075); `Store.sql` (7075) | CORE |
| [packages/store/src/store.ts:7082](../../packages/store/src/store.ts#L7082) `Store/externalContainerCount` | `SQLite.get` (7082); `SQLite.prepare` (7082); `Store.sql` (7082) | CORE |
| [packages/store/src/store.ts:7091](../../packages/store/src/store.ts#L7091) `Store/externalContainerReport` | `SQLite.all` (7091, 7104); `SQLite.prepare` (7091, 7104); `Store.sql` (7091, 7104) | CORE |
| [packages/store/src/store.ts:7240](../../packages/store/src/store.ts#L7240) `Store/orphanContainerReport` | `SQLite.all` (7240); `SQLite.prepare` (7240); `Store.sql` (7240) | CORE |
| [packages/store/src/store.ts:7275](../../packages/store/src/store.ts#L7275) `Store/purgeOrphanContainers` | `Store.sql` (7275, 7279, 7288, 7291, 7292, 7297, 7298, 7300, 7300); `Store.orphanContainerReport` (7283); `SQLite.get` (7288); `SQLite.prepare` (7288, 7291, 7292) | CORE |
| [packages/store/src/store.ts:7313](../../packages/store/src/store.ts#L7313) `Store/containerIntact` | `SQLite.get` (7313); `SQLite.prepare` (7313); `Store.sql` (7313) | CORE |
| [packages/store/src/store.ts:7323](../../packages/store/src/store.ts#L7323) `Store/externalOf` | `SQLite.get` (7323); `SQLite.prepare` (7323); `Store.sql` (7323) | CORE |
| [packages/store/src/store.ts:7327](../../packages/store/src/store.ts#L7327) `Store/containerMeta` | `SQLite.get` (7327); `SQLite.prepare` (7327); `Store.sql` (7327) | CORE |
| [packages/store/src/store.ts:7332](../../packages/store/src/store.ts#L7332) `Store/container` | `SQLite.get` (7332); `SQLite.prepare` (7332, 7341); `Store.sql` (7332, 7341); `SQLite.all` (7341) | CORE |
| [packages/store/src/store.ts:7349](../../packages/store/src/store.ts#L7349) `Store/containerInfo` | `SQLite.get` (7349); `SQLite.prepare` (7349); `Store.sql` (7349) | CORE |
| [packages/store/src/store.ts:7383](../../packages/store/src/store.ts#L7383) `Store/containerRange` | `SQLite.all` (7383); `SQLite.prepare` (7383, 7390); `Store.sql` (7383, 7390); `SQLite.get` (7390) | CORE |
| [packages/store/src/store.ts:7408](../../packages/store/src/store.ts#L7408) `Store/addContainer` | `SQLite.all` (7408); `SQLite.prepare` (7408, 7413, 7427, 7431, 7432); `Store.sql` (7408, 7413, 7427, 7429, 7431, 7432, 7434, 7437); `SQLite.get` (7418); `Store.containerRange` (7420) | CORE |
| [packages/store/src/store.ts:7454](../../packages/store/src/store.ts#L7454) `Store/addExternalContainer` | `SQLite.prepare` (7454); `Store.sql` (7454) | CORE |
| [packages/store/src/store.ts:7472](../../packages/store/src/store.ts#L7472) `Store/writeExternalFile` | `Store.evaluateEach` (7472); `SQLite.prepare` (7495); `Store.sql` (7495) | CORE |
| [packages/store/src/store.ts:7496](../../packages/store/src/store.ts#L7496) `Store/writeExternalFile/taken` | `SQLite.get` (7496) | CORE |
| [packages/store/src/store.ts:7546](../../packages/store/src/store.ts#L7546) `Store/embeddedContainers` | `SQLite.prepare` (7546, 7547); `Store.sql` (7546, 7547); `SQLite.all` (7547); `SQLite.get` (7551) | CORE |
| [packages/store/src/store.ts:7560](../../packages/store/src/store.ts#L7560) `Store/embeddedContainerCount` | `SQLite.prepare` (7560); `Store.sql` (7560); `SQLite.get` (7561) | CORE |
| [packages/store/src/store.ts:7569](../../packages/store/src/store.ts#L7569) `Store/recoverContainersOut` | `SQLite.prepare` (7569); `Store.sql` (7569); `SQLite.get` (7572) | CORE |
| [packages/store/src/store.ts:7597](../../packages/store/src/store.ts#L7597) `Store/moveContainersOut` | `Store.sql` (7597, 7605, 7607, 7609, 7614, 7615, 7635, 7641, 7643, 7645, 7645, 7651, 7651, 7656, 7658, 7660, 7660, 7666); `SQLite.get` (7605); `SQLite.prepare` (7605, 7614, 7615); `Store.container` (7617) | CORE |
| [packages/store/src/store.ts:7675](../../packages/store/src/store.ts#L7675) `Store/moveContainersIn` | `Store.sql` (7675, 7681, 7683, 7684, 7685, 7686, 7706, 7711, 7711, 7722, 7725, 7728, 7735); `SQLite.prepare` (7683, 7684, 7685, 7686, 7722, 7728); `SQLite.get` (7688, 7722, 7728) | CORE |
| [packages/store/src/store.ts:7747](../../packages/store/src/store.ts#L7747) `Store/compactFile` | `Store.sql` (7747, 7748, 7750) | CORE |
| [packages/store/src/store.ts:7756](../../packages/store/src/store.ts#L7756) `Store/containerId` | `Store.containerId` (7756); `Store.row` (7757) | CORE |
| [packages/store/src/store.ts:7779](../../packages/store/src/store.ts#L7779) `Store/checkContainerWrite` | `Store.row` (7779) | CORE |
| [packages/store/src/store.ts:7788](../../packages/store/src/store.ts#L7788) `Store/setContainer` | `Store.sql` (7788, 7805); `Store.row` (7794); `SQLite.prepare` (7805) | CORE |
| [packages/store/src/store.ts:7838](../../packages/store/src/store.ts#L7838) `Store/orderBy` | `Store.valueListItems` (7838) | CORE |
| [packages/store/src/store.ts:7861](../../packages/store/src/store.ts#L7861) `Store/userPrefs` | `SQLite.all` (7861); `SQLite.prepare` (7861); `Store.sql` (7861) | CORE |
| [packages/store/src/store.ts:7866](../../packages/store/src/store.ts#L7866) `Store/hasTable` | `SQLite.get` (7866); `SQLite.prepare` (7866); `Store.sql` (7866) | CORE |
| [packages/store/src/store.ts:7870](../../packages/store/src/store.ts#L7870) `Store/setUserPref` | `Store.sql` (7870, 7871, 7872); `SQLite.prepare` (7871, 7872) | CORE |
| [packages/store/src/store.ts:7878](../../packages/store/src/store.ts#L7878) `Store/indexedFields` | `SQLite.all` (7878, 7879); `SQLite.prepare` (7878, 7879); `Store.sql` (7878, 7879) | CORE |
| [packages/store/src/store.ts:7900](../../packages/store/src/store.ts#L7900) `Store/addFieldIndex` | `Store.sql` (7900) | CORE |
| [packages/store/src/store.ts:7912](../../packages/store/src/store.ts#L7912) `Store/dropFieldIndex` | `SQLite.get` (7912); `SQLite.prepare` (7912); `Store.sql` (7912, 7913) | CORE |
| [packages/store/src/store.ts:7923](../../packages/store/src/store.ts#L7923) `Store/timeFind` | `Store.query` (7923, 7927, 7928); `Store.recordCount` (7930) | CORE |
| [packages/store/src/store.ts:7947](../../packages/store/src/store.ts#L7947) `Store/find` | `Store.find` (7947) | GATED-STORE |
| [packages/store/src/store.ts:7958](../../packages/store/src/store.ts#L7958) `Store/findHere` | `Store.query` (7958, 7963, 7965, 7979, 7981, 7992); `Store.recordCount` (7976); `SQLite.get` (7977, 7981); `SQLite.prepare` (7977, 7981, 7987, 7994, 8003); `Store.sql` (7977, 7981, 7987, 7994, 8003); `SQLite.all` (7987, 7994, 8003) | GATED-STORE |
| [packages/store/src/store.ts:7998](../../packages/store/src/store.ts#L7998) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7998); `SQLite.prepare` (7998); `Store.sql` (7998) | GATED-STORE |
| [packages/store/src/store.ts:8031](../../packages/store/src/store.ts#L8031) `Store/sortedPage` | `SQLite.iterate` (8031); `SQLite.prepare` (8031, 8046); `Store.sql` (8031, 8046); `SQLite.all` (8046) | CORE |
| [packages/store/src/store.ts:8103](../../packages/store/src/store.ts#L8103) `Store/relatedCriteria/matched` | `relatedRows` (8103) | CORE |
| [packages/store/src/store.ts:8106](../../packages/store/src/store.ts#L8106) `Store/relatedCriteria` | `SQLite.iterate` (8106); `SQLite.prepare` (8106); `Store.sql` (8106) | CORE |
| [packages/store/src/store.ts:8132](../../packages/store/src/store.ts#L8132) `Store/computedRows` | `Store.sql` (8132, 8135, 8136, 8137, 8139, 8149, 8150, 8151, 8154); `SQLite.prepare` (8135, 8137, 8139, 8149); `SQLite.iterate` (8139); `Calculations.globalValue` (8142); `Calculations.unstoredValue` (8143); `Calculations.related` (8146); `SQLite.all` (8149) | CORE |
| [packages/store/src/store.ts:8179](../../packages/store/src/store.ts#L8179) `Store/summaries` | `Calculations.wholeTable` (8179); `Calculations.collect` (8199, 8204) | CORE |
| [packages/store/src/store.ts:8195](../../packages/store/src/store.ts#L8195) `Store/summaries/recs` | `SQLite.iterate` (8195); `SQLite.prepare` (8195); `Store.sql` (8195) | CORE |
| [packages/store/src/store.ts:8217](../../packages/store/src/store.ts#L8217) `Store/runningSummaryValues` | `Store.viewableIds` (8217); `rowsById` (8219); `Calculations.value` (8230, 8236); `Calculations.related` (8247) | GATED-STORE |
| [packages/store/src/store.ts:8263](../../packages/store/src/store.ts#L8263) `Store/findSource` | `Store.query` (8263); `SQLite.all` (8272, 8289); `SQLite.prepare` (8272, 8280, 8288); `Store.sql` (8272, 8277, 8280, 8285, 8288, 8302, 8304); `Calculations.globalValue` (8294); `Calculations.unstoredValue` (8295); `Calculations.related` (8299) | CORE |
| [packages/store/src/store.ts:8319](../../packages/store/src/store.ts#L8319) `Store/findCandidates` | `Store.query` (8319) | CORE |
| [packages/store/src/store.ts:8354](../../packages/store/src/store.ts#L8354) `Store/previewRow` | `Store.row` (8354) | CORE |
| [packages/store/src/store.ts:8372](../../packages/store/src/store.ts#L8372) `Store/row` | `SQLite.get` (8372) | CORE |
| [packages/store/src/store.ts:8391](../../packages/store/src/store.ts#L8391) `Store/getCurrent` | `Store.get` (8391); `Store.row` (8392, 8392, 8406); `SQLite.all` (8409); `SQLite.prepare` (8409); `Store.sql` (8409) | GATED-STORE |
| [packages/store/src/store.ts:8429](../../packages/store/src/store.ts#L8429) `Store/getManyCurrent` | `Store.getMany` (8429); `SQLite.get` (8447); `SQLite.prepare` (8447); `Store.sql` (8447) | GATED-STORE |
| [packages/store/src/store.ts:8440](../../packages/store/src/store.ts#L8440) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8440) | GATED-STORE |
| [packages/store/src/store.ts:8463](../../packages/store/src/store.ts#L8463) `Store/canViewRecord` | `SQLite.get` (8463); `SQLite.prepare` (8463); `Store.sql` (8463) | GATED-STORE |
| [packages/store/src/store.ts:8481](../../packages/store/src/store.ts#L8481) `Store/canView` | `Store.canView` (8481); `Store.row` (8482) | GATED-STORE |
| [packages/store/src/store.ts:8506](../../packages/store/src/store.ts#L8506) `Store/create` | `SQLite.get` (8506, 8512); `SQLite.prepare` (8506, 8512, 8525); `Store.sql` (8506, 8512, 8525) | CORE |
| [packages/store/src/store.ts:8549](../../packages/store/src/store.ts#L8549) `Store/duplicate` | `Store.row` (8549); `SQLite.get` (8553); `SQLite.prepare` (8553, 8568); `Store.sql` (8553, 8568) | CORE |
| [packages/store/src/store.ts:8623](../../packages/store/src/store.ts#L8623) `Store/update` | `Store.row` (8623); `Store.sql` (8653, 8654, 8693, 8696) | CORE |
| [packages/store/src/store.ts:8656](../../packages/store/src/store.ts#L8656) `Store/update/undo` | `Store.sql` (8656) | CORE |
| [packages/store/src/store.ts:8801](../../packages/store/src/store.ts#L8801) `Store/setStoredCalcValues` | `SQLite.prepare` (8801, 8802); `Store.sql` (8801, 8802); `SQLite.get` (8806) | CORE |
| [packages/store/src/store.ts:8890](../../packages/store/src/store.ts#L8890) `Store/evaluateCurrent` | `Store.row` (8890, 8890, 8891, 8891); `Calculations.context` (8896); `Store.get` (8897, 8899) | GATED-STORE |
| [packages/store/src/store.ts:8931](../../packages/store/src/store.ts#L8931) `Store/evaluateEachCurrent` | `Store.row` (8931, 8931, 8936); `Calculations.context` (8937); `Store.get` (8939) | GATED-STORE |
| [packages/store/src/store.ts:8972](../../packages/store/src/store.ts#L8972) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8972); `Store.get` (8974) | GATED-STORE |
| [packages/store/src/store.ts:8993](../../packages/store/src/store.ts#L8993) `Store/evaluateRowsCurrent` | `Store.row` (8993, 8993, 8994, 8994) | GATED-STORE |
| [packages/store/src/store.ts:9008](../../packages/store/src/store.ts#L9008) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (9008) | GATED-STORE |
| [packages/store/src/store.ts:9030](../../packages/store/src/store.ts#L9030) `Store/evaluateRowsCurrent/key` | `Calculations.context` (9030) | GATED-STORE |
| [packages/store/src/store.ts:9068](../../packages/store/src/store.ts#L9068) `Store/updateRelated` | `relatedRows` (9068) | CORE |
| [packages/store/src/store.ts:9086](../../packages/store/src/store.ts#L9086) `Store/updatePortals` | `Store.row` (9086, 9122); `relatedRows` (9123) | CORE |
| [packages/store/src/store.ts:9096](../../packages/store/src/store.ts#L9096) `Store/updatePortals/portal/related` | `relatedIdList` (9096) | CORE |
| [packages/store/src/store.ts:9178](../../packages/store/src/store.ts#L9178) `Store/portalContainerTarget` | `Store.row` (9178); `relatedIdList` (9180) | CORE |
| [packages/store/src/store.ts:9193](../../packages/store/src/store.ts#L9193) `Store/checkEditable` | `Store.row` (9193) | CORE |
| [packages/store/src/store.ts:9217](../../packages/store/src/store.ts#L9217) `Store/delete` | `Store.row` (9217) | CORE |
| [packages/store/src/store.ts:9225](../../packages/store/src/store.ts#L9225) `Store/delete/run` | `SQLite.get` (9225); `SQLite.prepare` (9225, 9229); `Store.sql` (9225, 9229) | CORE |
| [packages/store/src/store.ts:9457](../../packages/store/src/store.ts#L9457) `Store/keyStepWork` | `Store.sql` (9457, 9463, 9467, 9469) | CORE |
| [packages/store/src/store.ts:9258](../../packages/store/src/store.ts#L9258) `Store/vaultHeld` | `SQLite.get` (9258); `SQLite.prepare` (9258); `Store.sql` (9258) | CORE |
| [packages/store/src/store.ts:9265](../../packages/store/src/store.ts#L9265) `Store/forgetStandInValues` | `Store.sql` (9265, 9286); `SQLite.prepare` (9286) | CORE |
| [packages/store/src/store.ts:9305](../../packages/store/src/store.ts#L9305) `Store/restoreDeletedRowLocked` | `SQLite.get` (9305); `SQLite.prepare` (9305, 9306, 9310); `Store.sql` (9305, 9306, 9310); `SQLite.all` (9306) | CORE |
| [packages/store/src/store.ts:9510](../../packages/store/src/store.ts#L9510) `Store/cascadeDelete` | `relatedRows` (9510) | CORE |
| [packages/store/src/store.ts:9600](../../packages/store/src/store.ts#L9600) `Store/selectIdsCurrent` | `Store.selectIds` (9600); `SQLite.all` (9606); `SQLite.prepare` (9606); `Store.sql` (9606) | GATED-STORE |
| [packages/store/src/store.ts:9614](../../packages/store/src/store.ts#L9614) `Store/countIds` | `Store.countIds` (9614); `SQLite.get` (9618); `SQLite.prepare` (9618); `Store.sql` (9618) | GATED-STORE |
| [packages/store/src/store.ts:9634](../../packages/store/src/store.ts#L9634) `Store/computeValuesCurrent` | `Store.computeValues` (9634); `Store.sql` (9640, 9644); `SQLite.all` (9644); `SQLite.prepare` (9644) | GATED-STORE |
| [packages/store/src/store.ts:9659](../../packages/store/src/store.ts#L9659) `Store/findIdsCurrent` | `Store.findIds` (9659) | GATED-STORE |
| [packages/store/src/store.ts:9665](../../packages/store/src/store.ts#L9665) `Store/findIdsHere` | `Store.query` (9665, 9670, 9672); `SQLite.iterate` (9683); `SQLite.prepare` (9683); `Store.sql` (9683) | GATED-STORE |
| [packages/store/src/store.ts:9700](../../packages/store/src/store.ts#L9700) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9700); `Store.viewableIds` (9705); `Calculations.collect` (9721); `rowsById` (9721, 9771); `Calculations.collector` (9743) | GATED-STORE |
| [packages/store/src/store.ts:9733](../../packages/store/src/store.ts#L9733) `Store/groupSummariesCurrent/key` | `Calculations.value` (9733); `Calculations.related` (9735) | GATED-STORE |
| [packages/store/src/store.ts:9769](../../packages/store/src/store.ts#L9769) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9769) | GATED-STORE |
| [packages/store/src/store.ts:9825](../../packages/store/src/store.ts#L9825) `Store/sortIdsCurrentProgress` | `SQLite.all` (9825); `SQLite.prepare` (9825, 9893); `Store.sql` (9825, 9893); `Store.valueListItems` (9833); `rowsById` (9845); `Calculations.globalValue` (9848); `Calculations.unstoredValue` (9849); `Calculations.related` (9855); `SQLite.iterate` (9893) | GATED-STORE |
| [packages/store/src/store.ts:9907](../../packages/store/src/store.ts#L9907) `Store/matchIds` | `Store.matchIds` (9907); `SQLite.all` (9913); `SQLite.prepare` (9913); `Store.sql` (9913) | CORE |
| [packages/store/src/store.ts:9935](../../packages/store/src/store.ts#L9935) `Store/truncate/run` | `Store.sql` (9935, 9937, 9944, 9946, 9948, 9949); `SQLite.prepare` (9937, 9944); `SQLite.all` (9939) | CORE |
| [packages/store/src/store.ts:9974](../../packages/store/src/store.ts#L9974) `Store/iterateCommitted` | `SQLite.iterate` (9974) | CORE |
| [packages/store/src/store.ts:10008](../../packages/store/src/store.ts#L10008) `Store/readOnlyChecked` | `SQLite.prepare` (10008, 10012, 10021, 10026); `SQLite.all` (10012, 10021, 10026) | CORE |
| [packages/store/src/store.ts:10048](../../packages/store/src/store.ts#L10048) `Store/refreshDecimalSqlViews` | `SQLite.get` (10048); `SQLite.prepare` (10048, 10053); `SQLite.all` (10053) | CORE |
| [packages/store/src/store.ts:10067](../../packages/store/src/store.ts#L10067) `Store/internalRoots` | `SQLite.get` (10067); `SQLite.prepare` (10067, 10069); `SQLite.all` (10069) | CORE |
| [packages/store/src/store.ts:10102](../../packages/store/src/store.ts#L10102) `Store/selectCurrent` | `SQLite.iterate` (10102) | CORE |
| [packages/store/src/store.ts:10166](../../packages/store/src/store.ts#L10166) `Store/query` | `SQLite.iterate` (10166) | CORE |
| [packages/store/src/store.ts:10200](../../packages/store/src/store.ts#L10200) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10200); `SQLite.all` (10207, 10210); `SQLite.prepare` (10207, 10210) | CORE |
| [packages/store/src/store.ts:1209](../../packages/store/src/store.ts#L1209) `Store/ensureNativeIds` | `SQLite.all` (1209, 1221); `SQLite.prepare` (1209, 1212, 1220, 1221); `Store.sql` (1209, 1212, 1215, 1219, 1220, 1221, 1224, 1226) | CORE |
| [packages/store/src/store.ts:1234](../../packages/store/src/store.ts#L1234) `Store/nativeIdGuards` | `Store.sql` (1234, 1235, 1237) | CORE |
| [packages/store/src/store.ts:10118](../../packages/store/src/store.ts#L10118) `Store/selectIn` | `Store.select` (10118) | CORE |
| [packages/store/src/store.ts:10126](../../packages/store/src/store.ts#L10126) `Store/selectHeldCurrent` | `Store.sql` (10126, 10127); `SQLite.prepare` (10127); `SQLite.iterate` (10130) | CORE |
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
| [packages/store/src/store.ts:1672](../../packages/store/src/store.ts#L1672) `Store/selfContainedCopy` | `Store.sql` (1672); `SQLite.all` (1677); `SQLite.prepare` (1677, 1679, 1680, 1681) | CORE |
| [packages/store/src/store.ts:7154](../../packages/store/src/store.ts#L7154) `Store/containerReferences` | `SQLite.all` (7154, 7173, 7175, 7181, 7194, 7205, 7219); `SQLite.prepare` (7154, 7173, 7175, 7181, 7194, 7205, 7217, 7219); `Store.sql` (7154, 7173, 7175, 7181, 7194, 7205, 7217, 7219); `SQLite.get` (7217); `Store.row` (7228) | CORE |
| [packages/store/src/store.ts:7252](../../packages/store/src/store.ts#L7252) `Store/containerIntegrityReport` | `SQLite.all` (7252); `SQLite.prepare` (7252, 7263); `Store.sql` (7252, 7263); `SQLite.get` (7263) | CORE |
| [packages/store/src/store.ts:1420](../../packages/store/src/store.ts#L1420) `Store/recoverPendingExternalFiles` | `Store.sql` (1420, 1422, 1441, 1443); `SQLite.prepare` (1422); `SQLite.get` (1431) | CORE |
| [packages/store/src/store.ts:2241](../../packages/store/src/store.ts#L2241) `Store/restoreRecord` | `Store.recordAsOf` (2241); `SQLite.get` (2245); `SQLite.prepare` (2245, 2249, 2258, 2269); `Store.sql` (2245, 2249, 2258, 2269) | CORE |
| [packages/store/src/store.ts:8880](../../packages/store/src/store.ts#L8880) `Store/recordViewable` | `Store.row` (8880) | GATED-STORE |
| [packages/server/src/compaction.ts:65](../../packages/server/src/compaction.ts#L65) `compactStore` | `SQLite.get` (65, 66, 80, 88); `SQLite.prepare` (65, 66, 80, 88) | OPERATOR |
<!-- end generated read-gate inventory -->
