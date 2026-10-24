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
| [packages/cli/src/main.ts:711](../../packages/cli/src/main.ts#L711) `accountsWithPasswordOff` | `SQLite.all` (711); `SQLite.prepare` (711) | OPERATOR |
| [packages/cli/src/main.ts:740](../../packages/cli/src/main.ts#L740) `hostedRead` | `SQLite.all` (740, 743); `SQLite.prepare` (740, 743); `Store.sql` (740, 743) | OPERATOR |
| [packages/cli/src/main.ts:2399](../../packages/cli/src/main.ts#L2399) `main` | `Store.orphanContainerReport` (2399); `Store.auditLog` (2872); `SQLite.get` (3131); `SQLite.prepare` (3131) | OPERATOR |
| [packages/scripts/src/data-api-step.ts:104](../../packages/scripts/src/data-api-step.ts#L104) `respond` | `Store.get` (104, 131, 140); `Store.find` (105, 117) | SCRIPT |
| [packages/scripts/src/engine.ts:7962](../../packages/scripts/src/engine.ts#L7962) `ScriptEngine/containerFile` | `Store.get` (7962); `Store.containerId` (7963); `Store.container` (7964) | SCRIPT |
| [packages/scripts/src/engine.ts:5580](../../packages/scripts/src/engine.ts#L5580) `ScriptEngine/design` | `Store.valueListItems` (5580) | SCRIPT |
| [packages/scripts/src/engine.ts:6318](../../packages/scripts/src/engine.ts#L6318) `ScriptEngine/exportField` | `Store.get` (6318); `Store.containerId` (6319); `Store.container` (6321) | SCRIPT |
| [packages/scripts/src/engine.ts:8359](../../packages/scripts/src/engine.ts#L8359) `ScriptEngine/fileMakerRows` | `Store.findIds` (8359); `Store.get` (8364) | SCRIPT |
| [packages/scripts/src/engine.ts:8729](../../packages/scripts/src/engine.ts#L8729) `ScriptEngine/findRelated` | `Store.findIds` (8729, 8739, 8742) | SCRIPT |
| [packages/scripts/src/engine.ts:2297](../../packages/scripts/src/engine.ts#L2297) `ScriptEngine/foundSet` | `Store.findIds` (2297) | SCRIPT |
| [packages/scripts/src/engine.ts:5420](../../packages/scripts/src/engine.ts#L5420) `ScriptEngine/get` | `Store.findIds` (5420); `Store.canViewRecord` (5513); `Store.get` (5549) | SCRIPT |
| [packages/scripts/src/engine.ts:1953](../../packages/scripts/src/engine.ts#L1953) `ScriptEngine/goToLayout` | `Store.findIds` (1953) | SCRIPT |
| [packages/scripts/src/engine.ts:6889](../../packages/scripts/src/engine.ts#L6889) `ScriptEngine/goToList` | `Store.findIds` (6889) | SCRIPT |
| [packages/scripts/src/engine.ts:8128](../../packages/scripts/src/engine.ts#L8128) `ScriptEngine/importRecords` | `Store.findIds` (8128); `Store.get` (8148) | SCRIPT |
| [packages/scripts/src/engine.ts:5692](../../packages/scripts/src/engine.ts#L5692) `ScriptEngine/lookupNext` | `Store.get` (5692); `Store.row` (5693); `Calculations.context` (5695) | SCRIPT |
| [packages/scripts/src/engine.ts:5258](../../packages/scripts/src/engine.ts#L5258) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5258) | SCRIPT |
| [packages/scripts/src/engine.ts:5266](../../packages/scripts/src/engine.ts#L5266) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5266) | SCRIPT |
| [packages/scripts/src/engine.ts:5267](../../packages/scripts/src/engine.ts#L5267) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5267) | SCRIPT |
| [packages/scripts/src/engine.ts:8399](../../packages/scripts/src/engine.ts#L8399) `ScriptEngine/newRecord` | `Store.findIds` (8399) | SCRIPT |
| [packages/scripts/src/engine.ts:8704](../../packages/scripts/src/engine.ts#L8704) `ScriptEngine/performFind` | `Store.findIds` (8704) | SCRIPT |
| [packages/scripts/src/engine.ts:8761](../../packages/scripts/src/engine.ts#L8761) `ScriptEngine/quickFind` | `Store.findIds` (8761, 8762, 8765) | SCRIPT |
| [packages/scripts/src/engine.ts:5634](../../packages/scripts/src/engine.ts#L5634) `ScriptEngine/record` | `Store.get` (5634) | SCRIPT |
| [packages/scripts/src/engine.ts:5795](../../packages/scripts/src/engine.ts#L5795) `ScriptEngine/relatedIds` | `Store.findIds` (5795); `rowsById` (5803); `Store.select` (5807); `Store.matchIds` (5821); `Store.viewableIds` (5844) | SCRIPT |
| [packages/scripts/src/engine.ts:5829](../../packages/scripts/src/engine.ts#L5829) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5829) | SCRIPT |
| [packages/scripts/src/engine.ts:6469](../../packages/scripts/src/engine.ts#L6469) `ScriptEngine/relookup` | `Store.get` (6469) | SCRIPT |
| [packages/scripts/src/engine.ts:3432](../../packages/scripts/src/engine.ts#L3432) `ScriptEngine/revertTransaction` | `Store.findIds` (3432) | SCRIPT |
| [packages/scripts/src/engine.ts:2362](../../packages/scripts/src/engine.ts#L2362) `ScriptEngine/semanticFind` | `Store.findIds` (2362, 2383) | SCRIPT |
| [packages/scripts/src/engine.ts:3335](../../packages/scripts/src/engine.ts#L3335) `ScriptEngine/sortIds` | `Store.sortIds` (3335); `Store.valueListItems` (3341) | SCRIPT |
| [packages/scripts/src/engine.ts:7218](../../packages/scripts/src/engine.ts#L7218) `ScriptEngine/sourceValue` | `Store.get` (7218); `Store.containerId` (7219); `Store.container` (7220) | SCRIPT |
| [packages/scripts/src/engine.ts:3278](../../packages/scripts/src/engine.ts#L3278) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3278); `Calculations.executeSQL` (3285) | SCRIPT |
| [packages/scripts/src/engine.ts:3992](../../packages/scripts/src/engine.ts#L3992) `ScriptEngine/step` | `Store.fieldIndex` (3992); `Store.findIds` (4126, 4225) | SCRIPT |
| [packages/scripts/src/engine.ts:5667](../../packages/scripts/src/engine.ts#L5667) `ScriptEngine/valueOf` | `Store.findIds` (5667, 5667); `Store.containerId` (5675) | SCRIPT |
| [packages/scripts/src/engine.ts:9151](../../packages/scripts/src/engine.ts#L9151) `clearRecords` | `SQLite.all` (9151); `SQLite.prepare` (9151) | SCRIPT |
| [packages/scripts/src/recorder.ts:83](../../packages/scripts/src/recorder.ts#L83) `lastSeq` | `Store.auditLog` (83) | DESIGN |
| [packages/scripts/src/recorder.ts:121](../../packages/scripts/src/recorder.ts#L121) `recordRun` | `Store.auditLog` (121) | DESIGN |
| [packages/scripts/src/script-tests.ts:213](../../packages/scripts/src/script-tests.ts#L213) `runCase` | `Store.findIds` (213); `Store.auditLog` (220, 221, 265); `Store.evaluateEach` (248) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/server/src/admin.ts:2271](../../packages/server/src/admin.ts#L2271) `Admin/audit` | `Store.auditLog` (2271) | ADMIN |
| [packages/server/src/admin.ts:1040](../../packages/server/src/admin.ts#L1040) `Admin/handle` | `Store.externalContainerReport` (1040); `Store.orphanContainerReport` (1045, 1049) | ADMIN |
| [packages/server/src/admin.ts:2702](../../packages/server/src/admin.ts#L2702) `Admin/status` | `Store.externalContainerCount` (2702) | ADMIN |
| [packages/server/src/admin.ts:2354](../../packages/server/src/admin.ts#L2354) `Admin/viewAs` | `Store.find` (2354) | ADMIN |
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
| [packages/server/src/backup.ts:999](../../packages/server/src/backup.ts#L999) `accountDifferences/read` | `SQLite.all` (999, 1001); `SQLite.prepare` (999, 1001) | OPERATOR |
| [packages/server/src/backup.ts:269](../../packages/server/src/backup.ts#L269) `backupOnceHeld` | `SQLite.get` (269); `SQLite.prepare` (269) | OPERATOR |
| [packages/server/src/backup.ts:1072](../../packages/server/src/backup.ts#L1072) `columnInfo` | `SQLite.all` (1072); `SQLite.prepare` (1072) | OPERATOR |
| [packages/server/src/backup.ts:1056](../../packages/server/src/backup.ts#L1056) `credentialsReadable` | `SQLite.all` (1056); `SQLite.prepare` (1056) | OPERATOR |
| [packages/server/src/backup.ts:1026](../../packages/server/src/backup.ts#L1026) `readNames` | `SQLite.all` (1026); `SQLite.prepare` (1026) | OPERATOR |
| [packages/server/src/backup.ts:1107](../../packages/server/src/backup.ts#L1107) `reconcileCredentials` | `SQLite.all` (1107, 1129, 1144, 1154, 1160); `SQLite.prepare` (1107, 1115, 1129, 1131, 1144, 1145, 1152, 1154, 1155, 1160, 1161, 1165, 1166, 1167); `SQLite.get` (1115, 1165) | OPERATOR |
| [packages/server/src/backup.ts:1134](../../packages/server/src/backup.ts#L1134) `reconcileCredentials/accountColumns` | `SQLite.all` (1134); `SQLite.prepare` (1134) | OPERATOR |
| [packages/server/src/backup.ts:1110](../../packages/server/src/backup.ts#L1110) `reconcileCredentials/has` | `SQLite.all` (1110); `SQLite.prepare` (1110) | OPERATOR |
| [packages/server/src/backup.ts:1279](../../packages/server/src/backup.ts#L1279) `stageRestorePoint` | `SQLite.get` (1279, 1281, 1282); `SQLite.prepare` (1279, 1281, 1282) | OPERATOR |
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
| [packages/server/src/conversion-guide.ts:413](../../packages/server/src/conversion-guide.ts#L413) `ConversionGuides/save` | `SQLite.prepare` (413); `Store.sql` (413) | DESIGN |
| [packages/server/src/conversion-guide.ts:404](../../packages/server/src/conversion-guide.ts#L404) `ConversionGuides/saved` | `SQLite.get` (404); `SQLite.prepare` (404); `Store.sql` (404) | DESIGN |
| [packages/server/src/conversion-guide.ts:394](../../packages/server/src/conversion-guide.ts#L394) `ConversionGuides/table` | `Store.sql` (394) | DESIGN |
| [packages/server/src/conversion-guide.ts:138](../../packages/server/src/conversion-guide.ts#L138) `convertedAt` | `SQLite.get` (138); `SQLite.prepare` (138); `Store.sql` (138) | DESIGN |
| [packages/server/src/conversion.ts:339](../../packages/server/src/conversion.ts#L339) `conversionReport` | `Store.externalContainerCheck` (339) | DESIGN |
| [packages/server/src/cwp-xml.ts:541](../../packages/server/src/cwp-xml.ts#L541) `CwpXmlEndpoint/layoutDoc` | `Store.valueListItems` (541) | XML |
| [packages/server/src/cwp-xml.ts:457](../../packages/server/src/cwp-xml.ts#L457) `CwpXmlEndpoint/records` | `Store.find` (457, 459, 460, 466, 469); `Store.get` (465, 473) | XML |
| [packages/server/src/dashboards.ts:389](../../packages/server/src/dashboards.ts#L389) `Dashboards/create` | `SQLite.prepare` (389); `Store.sql` (389) | DASHBOARD |
| [packages/server/src/dashboards.ts:409](../../packages/server/src/dashboards.ts#L409) `Dashboards/delete` | `SQLite.prepare` (409); `Store.sql` (409) | DASHBOARD |
| [packages/server/src/dashboards.ts:375](../../packages/server/src/dashboards.ts#L375) `Dashboards/get` | `SQLite.get` (375); `SQLite.prepare` (375); `Store.sql` (375) | DASHBOARD |
| [packages/server/src/dashboards.ts:369](../../packages/server/src/dashboards.ts#L369) `Dashboards/list` | `SQLite.all` (369); `SQLite.prepare` (369); `Store.sql` (369) | DASHBOARD |
| [packages/server/src/dashboards.ts:359](../../packages/server/src/dashboards.ts#L359) `Dashboards/table` | `Store.sql` (359) | DASHBOARD |
| [packages/server/src/dashboards.ts:402](../../packages/server/src/dashboards.ts#L402) `Dashboards/update` | `SQLite.prepare` (402); `Store.sql` (402) | DASHBOARD |
| [packages/server/src/dataapi.ts:1960](../../packages/server/src/dataapi.ts#L1960) `DataApi/route` | `Store.get` (1960, 2182, 2183, 2206, 2214, 2261, 2285, 2305, 2342); `Store.valueListItems` (1975); `Store.find` (2137, 2185, 2375); `Store.findIds` (2141, 2380); `Store.query` (2380) | REST |
| [packages/server/src/dataapi.ts:2089](../../packages/server/src/dataapi.ts#L2089) `DataApi/route/recordOut` | `Store.portalCounts` (2089) | REST |
| [packages/server/src/dataapi.ts:2125](../../packages/server/src/dataapi.ts#L2125) `DataApi/route/shownAs` | `Store.get` (2125) | REST |
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
| [packages/server/src/import-mapping.ts:1004](../../packages/server/src/import-mapping.ts#L1004) `applyImportAddStream` | `SQLite.prepare` (1004); `Store.sql` (1004) | IMPORT |
| [packages/server/src/import-mapping.ts:780](../../packages/server/src/import-mapping.ts#L780) `applyImportRun` | `SQLite.prepare` (780); `Store.sql` (780) | IMPORT |
| [packages/server/src/import-mapping.ts:500](../../packages/server/src/import-mapping.ts#L500) `existingKeys` | `Store.viewableIds` (500); `Store.query` (502) | IMPORT |
| [packages/server/src/import-mapping.ts:824](../../packages/server/src/import-mapping.ts#L824) `fileIdentity` | `Store.sql` (824, 825, 826); `SQLite.prepare` (825, 826); `SQLite.get` (826) | IMPORT |
| [packages/server/src/import-mapping.ts:883](../../packages/server/src/import-mapping.ts#L883) `importHistory` | `SQLite.all` (883); `SQLite.prepare` (883); `Store.sql` (883) | IMPORT |
| [packages/server/src/import-mapping.ts:812](../../packages/server/src/import-mapping.ts#L812) `journal` | `Store.sql` (812, 815, 816, 817, 818, 819); `SQLite.all` (815); `SQLite.prepare` (815) | IMPORT |
| [packages/server/src/import-mapping.ts:800](../../packages/server/src/import-mapping.ts#L800) `targetKeys` | `SQLite.all` (800); `SQLite.prepare` (800); `Store.sql` (800) | IMPORT |
| [packages/server/src/import-mapping.ts:890](../../packages/server/src/import-mapping.ts#L890) `undoImportRun` | `SQLite.get` (890, 922); `SQLite.prepare` (890, 922, 936); `Store.sql` (890, 922, 936) | IMPORT |
| [packages/server/src/insight.ts:1018](../../packages/server/src/insight.ts#L1018) `checkCalculation` | `Store.findIds` (1018); `Store.evaluate` (1022) | DESIGN |
| [packages/server/src/insight.ts:939](../../packages/server/src/insight.ts#L939) `columnProfile` | `Store.query` (939, 946, 958, 961) | PROFILE |
| [packages/server/src/insight.ts:863](../../packages/server/src/insight.ts#L863) `layoutProfile` | `Store.query` (863) | PROFILE |
| [packages/server/src/insight.ts:859](../../packages/server/src/insight.ts#L859) `layoutProfile/viewableIds` | `Store.viewableIds` (859) | PROFILE |
| [packages/server/src/insight.ts:1201](../../packages/server/src/insight.ts#L1201) `solutionOverview/counts` | `Store.query` (1201) | DESIGN |
| [packages/server/src/insight.ts:396](../../packages/server/src/insight.ts#L396) `webViewerScripts` | `Store.query` (396) | DESIGN |
| [packages/server/src/live.ts:206](../../packages/server/src/live.ts#L206) `Live/handle` | `Store.canView` (206) | LIVE |
| [packages/server/src/live.ts:?](../../packages/server/src/live.ts#L1) `Live/stream/listener` |  | LIVE |
| [packages/server/src/live.ts:280](../../packages/server/src/live.ts#L280) `Live/visibleRecord` | `Store.canViewRecord` (280) | LIVE |
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
| [packages/server/src/pgwire.ts:853](../../packages/server/src/pgwire.ts#L853) `Connection/catalog` | `Store.describeTyped` (853) | SQL |
| [packages/server/src/pgwire.ts:1225](../../packages/server/src/pgwire.ts#L1225) `Connection/describe` | `Store.describeTyped` (1225) | SQL |
| [packages/server/src/pgwire.ts:864](../../packages/server/src/pgwire.ts#L864) `Connection/run` | `Store.selectIn` (864); `Store.describeTyped` (868) | SQL |
| [packages/server/src/pgwire.ts:814](../../packages/server/src/pgwire.ts#L814) `Connection/translate` | `Calculations.translateSQL` (814) | SQL |
| [packages/server/src/pgwire.ts:992](../../packages/server/src/pgwire.ts#L992) `Connection/validateSyntax` | `SQLite.prepare` (992); `Store.sql` (992) | SQL |
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
| [packages/server/src/record-context.ts:112](../../packages/server/src/record-context.ts#L112) `describeRecord` | `Store.row` (112); `Store.get` (121); `keyValue` (127); `Store.viewableIds` (165); `relatedRows` (169, 174) | RECORD |
| [packages/server/src/record-history.ts:99](../../packages/server/src/record-history.ts#L99) `recordHistory` | `Store.auditLog` (99, 152) | HISTORY |
| [packages/server/src/record-search.ts:61](../../packages/server/src/record-search.ts#L61) `searchRecords` | `Store.viewableIds` (61); `SQLite.all` (74); `SQLite.prepare` (74); `Store.sql` (74) | SEARCH |
| [packages/server/src/record-search.ts:104](../../packages/server/src/record-search.ts#L104) `searchRecords/snippet` | `SQLite.get` (104); `SQLite.prepare` (104); `Store.sql` (104) | SEARCH |
| [packages/server/src/record-search.ts:109](../../packages/server/src/record-search.ts#L109) `searchRecords/source` | `SQLite.get` (109); `SQLite.prepare` (109); `Store.sql` (109) | SEARCH |
| [packages/server/src/rule-suggestions.ts:57](../../packages/server/src/rule-suggestions.ts#L57) `suggestRules` | `Store.query` (57, 69, 86, 136, 138, 152, 153, 169) | DESIGN |
| [packages/server/src/scim.ts:292](../../packages/server/src/scim.ts#L292) `ScimDirectory/atomically` | `Store.sql` (292) | AUTH |
| [packages/server/src/scim.ts:404](../../packages/server/src/scim.ts#L404) `ScimDirectory/create/scim_user_create` | `SQLite.prepare` (404); `Store.sql` (404) | AUTH |
| [packages/server/src/scim.ts:454](../../packages/server/src/scim.ts#L454) `ScimDirectory/remove/scim_user_remove` | `SQLite.prepare` (454); `Store.sql` (454) | AUTH |
| [packages/server/src/scim.ts:353](../../packages/server/src/scim.ts#L353) `ScimDirectory/revokePersonTokens` | `SQLite.all` (353); `SQLite.prepare` (353); `Store.sql` (353) | AUTH |
| [packages/server/src/scim.ts:226](../../packages/server/src/scim.ts#L226) `ScimDirectory/rows` | `SQLite.all` (226); `SQLite.prepare` (226, 231); `Store.sql` (226, 231) | AUTH |
| [packages/server/src/scim.ts:144](../../packages/server/src/scim.ts#L144) `ScimDirectory/save` | `SQLite.prepare` (144); `Store.sql` (144) | AUTH |
| [packages/server/src/scim.ts:255](../../packages/server/src/scim.ts#L255) `ScimDirectory/setMemberships` | `SQLite.prepare` (255); `Store.sql` (255) | AUTH |
| [packages/server/src/scim.ts:136](../../packages/server/src/scim.ts#L136) `ScimDirectory/settings` | `SQLite.get` (136); `SQLite.prepare` (136); `Store.sql` (136) | AUTH |
| [packages/server/src/scim.ts:123](../../packages/server/src/scim.ts#L123) `ScimDirectory/table` | `Store.sql` (123, 125); `SQLite.all` (125); `SQLite.prepare` (125) | AUTH |
| [packages/server/src/scim.ts:427](../../packages/server/src/scim.ts#L427) `ScimDirectory/update/scim_user_update` | `SQLite.prepare` (427); `Store.sql` (427) | AUTH |
| [packages/server/src/scim.ts:128](../../packages/server/src/scim.ts#L128) `ScimDirectory/table/scim_identity_column` | `SQLite.all` (128); `SQLite.prepare` (128); `Store.sql` (128, 129) | AUTH |
| [packages/server/src/scim.ts:331](../../packages/server/src/scim.ts#L331) `ScimDirectory/rebind` | `SQLite.prepare` (331); `Store.sql` (331) | AUTH |
| [packages/server/src/script-failure.ts:212](../../packages/server/src/script-failure.ts#L212) `explainScriptFailure` | `Store.row` (212) | RECORD |
| [packages/server/src/security.ts:217](../../packages/server/src/security.ts#L217) `SecurityApi/handle` | `Store.previewRecordRule` (217) | DESIGN |
| [packages/server/src/security.ts:80](../../packages/server/src/security.ts#L80) `importApproximations` | `SQLite.all` (80); `SQLite.prepare` (80); `Store.sql` (80) | DESIGN |
| [packages/server/src/security.ts:116](../../packages/server/src/security.ts#L116) `securityOf` | `Store.pendingChanges` (116) | DESIGN |
| [packages/server/src/semantic-find.ts:52](../../packages/server/src/semantic-find.ts#L52) `semanticFind` | `Store.findIds` (52) | SEARCH |
| [packages/server/src/semantic-find.ts:108](../../packages/server/src/semantic-find.ts#L108) `vectorOf` | `Store.containerId` (108); `Store.containerInfo` (110); `Store.container` (112); `Store.get` (117) | SEARCH |
| [packages/server/src/sql.ts:103](../../packages/server/src/sql.ts#L103) `SqlEndpoint/handle` | `Calculations.translateSQL` (103); `Store.select` (110) | SQL |
| [packages/server/src/sql.ts:163](../../packages/server/src/sql.ts#L163) `SqlEndpoint/tables` | `SQLite.all` (163); `SQLite.prepare` (163); `Store.sql` (163) | SQL |
| [packages/server/src/standby.ts:283](../../packages/server/src/standby.ts#L283) `Standby/copy` | `SQLite.get` (283); `SQLite.prepare` (283) | OPERATOR |
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
| [packages/store/src/activity.ts:464](../../packages/store/src/activity.ts#L464) `SharedRecordLocks/acquire` | `SQLite.prepare` (464) | CORE |
| [packages/store/src/activity.ts:502](../../packages/store/src/activity.ts#L502) `SharedRecordLocks/all` | `SQLite.all` (502); `SQLite.prepare` (502) | CORE |
| [packages/store/src/activity.ts:406](../../packages/store/src/activity.ts#L406) `SharedRecordLocks/constructor` | `SQLite.get` (406); `SQLite.prepare` (406) | CORE |
| [packages/store/src/activity.ts:437](../../packages/store/src/activity.ts#L437) `SharedRecordLocks/count` | `SQLite.get` (437); `SQLite.prepare` (437) | CORE |
| [packages/store/src/activity.ts:449](../../packages/store/src/activity.ts#L449) `SharedRecordLocks/holder` | `SQLite.get` (449); `SQLite.prepare` (449) | CORE |
| [packages/store/src/activity.ts:521](../../packages/store/src/activity.ts#L521) `SharedRecordLocks/leave` | `SQLite.prepare` (521) | CORE |
| [packages/store/src/activity.ts:525](../../packages/store/src/activity.ts#L525) `SharedRecordLocks/leaveOwner` | `SQLite.all` (525); `SQLite.prepare` (525) | CORE |
| [packages/store/src/activity.ts:492](../../packages/store/src/activity.ts#L492) `SharedRecordLocks/release` | `SQLite.prepare` (492) | CORE |
| [packages/store/src/activity.ts:496](../../packages/store/src/activity.ts#L496) `SharedRecordLocks/releaseOwner` | `SQLite.all` (496); `SQLite.prepare` (496) | CORE |
| [packages/store/src/activity.ts:478](../../packages/store/src/activity.ts#L478) `SharedRecordLocks/renew` | `SQLite.prepare` (478) | CORE |
| [packages/store/src/activity.ts:441](../../packages/store/src/activity.ts#L441) `SharedRecordLocks/sweep` | `SQLite.prepare` (441) | CORE |
| [packages/store/src/activity.ts:508](../../packages/store/src/activity.ts#L508) `SharedRecordLocks/view` | `SQLite.prepare` (508, 509, 510, 511); `SQLite.get` (509, 510) | CORE |
| [packages/store/src/activity.ts:529](../../packages/store/src/activity.ts#L529) `SharedRecordLocks/viewers` | `SQLite.prepare` (529, 530); `SQLite.all` (530) | CORE |
| [packages/store/src/audit-anchor.ts:71](../../packages/store/src/audit-anchor.ts#L71) `checkAnchor` | `SQLite.get` (71, 74, 78, 81); `SQLite.prepare` (71, 74, 78, 81) | CORE |
| [packages/store/src/cache-versions.ts:11](../../packages/store/src/cache-versions.ts#L11) `ensureCacheVersions` | `SQLite.get` (11); `SQLite.prepare` (11) | CORE |
| [packages/store/src/calc.ts:618](../../packages/store/src/calc.ts#L618) `Calculations/allRecords` | `SQLite.iterate` (618); `SQLite.prepare` (618); `Store.sql` (618) | CALC |
| [packages/store/src/calc.ts:1213](../../packages/store/src/calc.ts#L1213) `Calculations/applyDelta/value` | `Calculations.value` (1213) | CALC |
| [packages/store/src/calc.ts:2386](../../packages/store/src/calc.ts#L2386) `Calculations/beforeWrite` | `relatedRows` (2386); `Calculations.related` (2440); `Calculations.context` (2453) | CORE |
| [packages/store/src/calc.ts:629](../../packages/store/src/calc.ts#L629) `Calculations/collect` | `Calculations.collector` (629) | CALC |
| [packages/store/src/calc.ts:660](../../packages/store/src/calc.ts#L660) `Calculations/collector/add` | `Calculations.related` (660) | CALC |
| [packages/store/src/calc.ts:1693](../../packages/store/src/calc.ts#L1693) `Calculations/columnNames` | `SQLite.all` (1693); `SQLite.prepare` (1693); `Store.sql` (1693) | CALC |
| [packages/store/src/calc.ts:2249](../../packages/store/src/calc.ts#L2249) `Calculations/computeColumn` | `Calculations.statement` (2249); `SQLite.get` (2249); `Calculations.value` (2252) | CALC |
| [packages/store/src/calc.ts:2504](../../packages/store/src/calc.ts#L2504) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2504); `Calculations.value` (2504) | CALC |
| [packages/store/src/calc.ts:2519](../../packages/store/src/calc.ts#L2519) `Calculations/computeStoredStyled` | `Calculations.context` (2519) | CORE |
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
| [packages/store/src/calc.ts:2212](../../packages/store/src/calc.ts#L2212) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2212) | CALC |
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
| [packages/store/src/calc.ts:2180](../../packages/store/src/calc.ts#L2180) `Calculations/shareColumn` | `Store.recordCount` (2180) | CALC |
| [packages/store/src/calc.ts:1704](../../packages/store/src/calc.ts#L1704) `Calculations/statement` | `SQLite.prepare` (1704); `Store.sql` (1704) | CALC |
| [packages/store/src/calc.ts:1540](../../packages/store/src/calc.ts#L1540) `Calculations/storedRelatedValues` | `Calculations.statement` (1540); `SQLite.iterate` (1540) | CALC |
| [packages/store/src/calc.ts:1285](../../packages/store/src/calc.ts#L1285) `Calculations/storedRows` | `SQLite.iterate` (1285); `SQLite.prepare` (1285); `Store.sql` (1285) | CALC |
| [packages/store/src/calc.ts:684](../../packages/store/src/calc.ts#L684) `Calculations/summary` | `Calculations.collect` (684) | CALC |
| [packages/store/src/calc.ts:921](../../packages/store/src/calc.ts#L921) `Calculations/summaryDependencies` | `Store.sql` (921) | CALC |
| [packages/store/src/calc.ts:636](../../packages/store/src/calc.ts#L636) `Calculations/summaryInput` | `Calculations.value` (636) | CALC |
| [packages/store/src/calc.ts:691](../../packages/store/src/calc.ts#L691) `Calculations/tableSummary` | `Calculations.wholeTable` (691) | CALC |
| [packages/store/src/calc.ts:2116](../../packages/store/src/calc.ts#L2116) `Calculations/translateSQL` | `Store.scopedTableSql` (2116, 2148) | CALC |
| [packages/store/src/calc.ts:2555](../../packages/store/src/calc.ts#L2555) `Calculations/uniqueCollision` | `Calculations.value` (2555) | CALC |
| [packages/store/src/calc.ts:580](../../packages/store/src/calc.ts#L580) `Calculations/unstoredValue` | `Calculations.unstoredStyled` (580); `Calculations.value` (580) | CALC |
| [packages/store/src/calc.ts:2582](../../packages/store/src/calc.ts#L2582) `Calculations/validate` | `Calculations.value` (2582); `Store.valueListItems` (2603); `Calculations.context` (2617) | CALC |
| [packages/store/src/calc.ts:2568](../../packages/store/src/calc.ts#L2568) `Calculations/validate/fail` | `Calculations.context` (2568) | CALC |
| [packages/store/src/calc.ts:530](../../packages/store/src/calc.ts#L530) `Calculations/value` | `Calculations.globalValue` (530) | CALC |
| [packages/store/src/calc.ts:960](../../packages/store/src/calc.ts#L960) `Calculations/wholeTable` | `rowsById` (960); `Store.viewableIds` (960); `Calculations.collect` (962, 1052); `Calculations.value` (1023); `Store.sql` (1031, 1039) | CALC |
| [packages/store/src/calc.ts:2764](../../packages/store/src/calc.ts#L2764) `containerValue` | `Store.containerInfo` (2764); `Store.containerRange` (2771); `Store.container` (2772) | CALC |
| [packages/store/src/calc.ts:2780](../../packages/store/src/calc.ts#L2780) `containerValue/read` | `Store.container` (2780) | CALC |
| [packages/store/src/calc.ts:2793](../../packages/store/src/calc.ts#L2793) `containerValue/value` | `Store.containerRange` (2793) | CALC |
| [packages/store/src/calc.ts:2679](../../packages/store/src/calc.ts#L2679) `nearest` | `SQLite.get` (2679); `SQLite.prepare` (2679); `Store.sql` (2679) | CALC |
| [packages/store/src/calc.ts:3224](../../packages/store/src/calc.ts#L3224) `rowsById/flush` | `Calculations.statement` (3224); `SQLite.iterate` (3224) | CALC |
| [packages/store/src/calc.ts:2911](../../packages/store/src/calc.ts#L2911) `sameValuesElsewhere` | `SQLite.all` (2911); `SQLite.prepare` (2911, 2918, 2920); `Store.sql` (2911, 2918, 2920); `Calculations.value` (2913); `SQLite.get` (2918, 2920) | CALC |
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
| [packages/store/src/explain.ts:395](../../packages/store/src/explain.ts#L395) `lintFormula` | `Calculations.context` (395) | RECORD |
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
| [packages/store/src/store.ts:4666](../../packages/store/src/store.ts#L4666) `Store/accountIdentityId` | `SQLite.get` (4666, 4671); `SQLite.prepare` (4666, 4670, 4671); `Store.sql` (4666, 4670, 4671) | CORE |
| [packages/store/src/store.ts:4629](../../packages/store/src/store.ts#L4629) `Store/accountInactive` | `SQLite.get` (4629); `SQLite.prepare` (4629); `Store.sql` (4629) | CORE |
| [packages/store/src/store.ts:4794](../../packages/store/src/store.ts#L4794) `Store/accountLocalOnly` | `SQLite.get` (4794); `SQLite.prepare` (4794); `Store.sql` (4794) | CORE |
| [packages/store/src/store.ts:5648](../../packages/store/src/store.ts#L5648) `Store/accountPrivilegeSet` | `SQLite.get` (5648); `SQLite.prepare` (5648); `Store.sql` (5648) | CORE |
| [packages/store/src/store.ts:4799](../../packages/store/src/store.ts#L4799) `Store/accountRequires2fa` | `SQLite.get` (4799); `SQLite.prepare` (4799); `Store.sql` (4799) | CORE |
| [packages/store/src/store.ts:5019](../../packages/store/src/store.ts#L5019) `Store/accountUsage` | `SQLite.get` (5019); `SQLite.prepare` (5019, 5020); `Store.sql` (5019, 5020); `SQLite.all` (5020); `Store.auditLog` (5036) | CORE |
| [packages/store/src/store.ts:3129](../../packages/store/src/store.ts#L3129) `Store/accounts` | `SQLite.all` (3129); `SQLite.prepare` (3129); `Store.sql` (3129) | CORE |
| [packages/store/src/store.ts:3125](../../packages/store/src/store.ts#L3125) `Store/accountsSharingLockout` | `SQLite.all` (3125); `SQLite.prepare` (3125); `Store.sql` (3125) | CORE |
| [packages/store/src/store.ts:7730](../../packages/store/src/store.ts#L7730) `Store/addContainer` | `SQLite.all` (7730); `SQLite.prepare` (7730, 7735, 7749, 7753, 7754); `Store.sql` (7730, 7735, 7749, 7751, 7753, 7754, 7756, 7759); `SQLite.get` (7740); `Store.containerRange` (7742) | CORE |
| [packages/store/src/store.ts:7776](../../packages/store/src/store.ts#L7776) `Store/addExternalContainer` | `SQLite.prepare` (7776); `Store.sql` (7776) | CORE |
| [packages/store/src/store.ts:8232](../../packages/store/src/store.ts#L8232) `Store/addFieldIndex` | `Store.sql` (8232) | CORE |
| [packages/store/src/store.ts:6437](../../packages/store/src/store.ts#L6437) `Store/addImage` | `Store.sql` (6437, 6438); `SQLite.prepare` (6438) | CORE |
| [packages/store/src/store.ts:5698](../../packages/store/src/store.ts#L5698) `Store/addProvisionedAccount` | `SQLite.get` (5698); `SQLite.prepare` (5698, 5702); `Store.sql` (5698, 5702) | CORE |
| [packages/store/src/store.ts:6856](../../packages/store/src/store.ts#L6856) `Store/addRelated` | `relatedRows` (6856); `rowsById` (6888); `firstRelatedEach` (6911) | CORE |
| [packages/store/src/store.ts:3147](../../packages/store/src/store.ts#L3147) `Store/agentNeedsApproval` | `SQLite.get` (3147); `SQLite.prepare` (3147); `Store.sql` (3147) | CORE |
| [packages/store/src/store.ts:5912](../../packages/store/src/store.ts#L5912) `Store/allowedIds` | `SQLite.iterate` (5912); `SQLite.prepare` (5912); `Store.sql` (5912) | CORE |
| [packages/store/src/store.ts:5076](../../packages/store/src/store.ts#L5076) `Store/apiToken` | `SQLite.get` (5076); `SQLite.prepare` (5076, 5089); `Store.sql` (5076, 5089) | CORE |
| [packages/store/src/store.ts:5052](../../packages/store/src/store.ts#L5052) `Store/apiTokens` | `SQLite.all` (5052); `SQLite.prepare` (5052); `Store.sql` (5052) | CORE |
| [packages/store/src/store.ts:3470](../../packages/store/src/store.ts#L3470) `Store/appendSecurityEvent` | `Store.sql` (3470) | CORE |
| [packages/store/src/store.ts:4475](../../packages/store/src/store.ts#L4475) `Store/applyAccountImport` | `Store.sql` (4475, 4483, 4512); `SQLite.get` (4483); `SQLite.prepare` (4483, 4512) | CORE |
| [packages/store/src/store.ts:2090](../../packages/store/src/store.ts#L2090) `Store/applyDesign` | `Store.sql` (2090, 2091, 2104, 2107, 2112, 2128, 2131, 2131); `SQLite.prepare` (2107, 2112) | CORE |
| [packages/store/src/store.ts:3343](../../packages/store/src/store.ts#L3343) `Store/approvePending` | `SQLite.get` (3343); `SQLite.prepare` (3343, 3354); `Store.sql` (3343, 3354) | CORE |
| [packages/store/src/store.ts:2549](../../packages/store/src/store.ts#L2549) `Store/audit` | `Store.sql` (2549) | CORE |
| [packages/store/src/store.ts:2190](../../packages/store/src/store.ts#L2190) `Store/auditLog` | `SQLite.all` (2190); `SQLite.prepare` (2190); `Store.sql` (2190) | CORE |
| [packages/store/src/store.ts:1701](../../packages/store/src/store.ts#L1701) `Store/backup` | `Store.sql` (1701) | CORE |
| [packages/store/src/store.ts:3153](../../packages/store/src/store.ts#L3153) `Store/blankPasswordAccounts` | `SQLite.all` (3153); `SQLite.prepare` (3153); `Store.sql` (3153) | CORE |
| [packages/store/src/store.ts:8813](../../packages/store/src/store.ts#L8813) `Store/canView` | `Store.canView` (8813); `Store.row` (8814) | GATED-STORE |
| [packages/store/src/store.ts:8795](../../packages/store/src/store.ts#L8795) `Store/canViewRecord` | `SQLite.get` (8795); `SQLite.prepare` (8795); `Store.sql` (8795) | GATED-STORE |
| [packages/store/src/store.ts:4404](../../packages/store/src/store.ts#L4404) `Store/canonicalAccount` | `SQLite.all` (4404); `SQLite.prepare` (4404); `Store.sql` (4404) | CORE |
| [packages/store/src/store.ts:9872](../../packages/store/src/store.ts#L9872) `Store/cascadeDelete` | `relatedRows` (9872) | CORE |
| [packages/store/src/store.ts:1920](../../packages/store/src/store.ts#L1920) `Store/changeOne` | `Store.sql` (1920, 1922) | CORE |
| [packages/store/src/store.ts:1923](../../packages/store/src/store.ts#L1923) `Store/changeOne/read` | `SQLite.get` (1923); `SQLite.prepare` (1923); `Store.sql` (1923) | CORE |
| [packages/store/src/store.ts:8111](../../packages/store/src/store.ts#L8111) `Store/checkContainerWrite` | `Store.row` (8111) | CORE |
| [packages/store/src/store.ts:9525](../../packages/store/src/store.ts#L9525) `Store/checkEditable` | `Store.row` (9525) | CORE |
| [packages/store/src/store.ts:1371](../../packages/store/src/store.ts#L1371) `Store/checkpoint` | `SQLite.get` (1371); `SQLite.prepare` (1371); `Store.sql` (1371) | CORE |
| [packages/store/src/store.ts:5684](../../packages/store/src/store.ts#L5684) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5684); `Store.sql` (5684) | CORE |
| [packages/store/src/store.ts:1389](../../packages/store/src/store.ts#L1389) `Store/close` | `Store.sql` (1389) | CORE |
| [packages/store/src/store.ts:8079](../../packages/store/src/store.ts#L8079) `Store/compactFile` | `Store.sql` (8079, 8080, 8082) | CORE |
| [packages/store/src/store.ts:9996](../../packages/store/src/store.ts#L9996) `Store/computeValuesCurrent` | `Store.computeValues` (9996); `Store.sql` (10002, 10006); `SQLite.all` (10006); `SQLite.prepare` (10006) | GATED-STORE |
| [packages/store/src/store.ts:8464](../../packages/store/src/store.ts#L8464) `Store/computedRows` | `Store.sql` (8464, 8467, 8468, 8469, 8471, 8481, 8482, 8483, 8486); `SQLite.prepare` (8467, 8469, 8471, 8481); `SQLite.iterate` (8471); `Calculations.globalValue` (8474); `Calculations.unstoredValue` (8475); `Calculations.related` (8478); `SQLite.all` (8481) | CORE |
| [packages/store/src/store.ts:5116](../../packages/store/src/store.ts#L5116) `Store/confirmTotp` | `SQLite.get` (5116); `SQLite.prepare` (5116, 5118); `Store.sql` (5116, 5118) | CORE |
| [packages/store/src/store.ts:1066](../../packages/store/src/store.ts#L1066) `Store/constructor` | `Store.sql` (1066, 1068, 1070, 1071, 1075, 1079, 1080, 1091, 1096, 1101, 1102, 1106, 1107, 1108, 1115, 1119, 1123, 1124, 1125, 1130, 1134, 1137, 1138, 1140, 1141, 1144, 1145, 1149, 1150, 1154, 1155, 1158, 1160, 1163, 1164, 1168, 1169, 1173, 1174, 1177, 1178, 1179, 1182, 1183, 1186, 1187, 1189, 1189, 1190, 1190, 1191, 1194, 1198, 1200, 1203, 1204, 1205, 1208, 1209, 1211, 1213, 1214, 1218, 1219, 1221, 1225, 1227, 1228, 1229, 1229, 1233, 1234); `SQLite.get` (1070); `SQLite.prepare` (1070, 1137, 1138, 1141, 1144, 1149, 1154, 1163, 1168, 1173, 1182, 1186, 1189, 1190, 1208, 1213, 1218); `SQLite.all` (1137, 1144, 1149, 1154, 1163, 1168, 1173, 1182, 1186, 1189, 1190, 1208, 1213, 1218) | CORE |
| [packages/store/src/store.ts:5465](../../packages/store/src/store.ts#L5465) `Store/consumeRecoveryCode` | `SQLite.prepare` (5465); `Store.sql` (5465) | CORE |
| [packages/store/src/store.ts:7654](../../packages/store/src/store.ts#L7654) `Store/container` | `SQLite.get` (7654); `SQLite.prepare` (7654, 7663); `Store.sql` (7654, 7663); `SQLite.all` (7663) | CORE |
| [packages/store/src/store.ts:8088](../../packages/store/src/store.ts#L8088) `Store/containerId` | `Store.containerId` (8088); `Store.row` (8089) | CORE |
| [packages/store/src/store.ts:7671](../../packages/store/src/store.ts#L7671) `Store/containerInfo` | `SQLite.get` (7671); `SQLite.prepare` (7671); `Store.sql` (7671) | CORE |
| [packages/store/src/store.ts:7635](../../packages/store/src/store.ts#L7635) `Store/containerIntact` | `SQLite.get` (7635); `SQLite.prepare` (7635); `Store.sql` (7635) | CORE |
| [packages/store/src/store.ts:7574](../../packages/store/src/store.ts#L7574) `Store/containerIntegrityReport` | `SQLite.all` (7574); `SQLite.prepare` (7574, 7585); `Store.sql` (7574, 7585); `SQLite.get` (7585) | CORE |
| [packages/store/src/store.ts:7649](../../packages/store/src/store.ts#L7649) `Store/containerMeta` | `SQLite.get` (7649); `SQLite.prepare` (7649); `Store.sql` (7649) | CORE |
| [packages/store/src/store.ts:7705](../../packages/store/src/store.ts#L7705) `Store/containerRange` | `SQLite.all` (7705); `SQLite.prepare` (7705, 7712); `Store.sql` (7705, 7712); `SQLite.get` (7712) | CORE |
| [packages/store/src/store.ts:7476](../../packages/store/src/store.ts#L7476) `Store/containerReferences` | `SQLite.all` (7476, 7495, 7497, 7503, 7516, 7527, 7541); `SQLite.prepare` (7476, 7495, 7497, 7503, 7516, 7527, 7539, 7541); `Store.sql` (7476, 7495, 7497, 7503, 7516, 7527, 7539, 7541); `SQLite.get` (7539); `Store.row` (7550) | CORE |
| [packages/store/src/store.ts:9976](../../packages/store/src/store.ts#L9976) `Store/countIds` | `Store.countIds` (9976); `SQLite.get` (9980); `SQLite.prepare` (9980); `Store.sql` (9980) | GATED-STORE |
| [packages/store/src/store.ts:8838](../../packages/store/src/store.ts#L8838) `Store/create` | `SQLite.get` (8838, 8844); `SQLite.prepare` (8838, 8844, 8857); `Store.sql` (8838, 8844, 8857) | CORE |
| [packages/store/src/store.ts:3442](../../packages/store/src/store.ts#L3442) `Store/createAccount` | `SQLite.get` (3442); `SQLite.prepare` (3442, 3446, 3452, 3457, 3462); `Store.sql` (3442, 3446, 3452, 3457, 3462) | CORE |
| [packages/store/src/store.ts:4852](../../packages/store/src/store.ts#L4852) `Store/createApiToken` | `SQLite.get` (4852, 4880); `SQLite.prepare` (4852, 4879, 4880, 4890); `Store.sql` (4852, 4879, 4880, 4890) | CORE |
| [packages/store/src/store.ts:4416](../../packages/store/src/store.ts#L4416) `Store/createLocalAccount` | `SQLite.prepare` (4416); `Store.sql` (4416) | CORE |
| [packages/store/src/store.ts:3119](../../packages/store/src/store.ts#L3119) `Store/credentialIdentity` | `SQLite.get` (3119); `SQLite.prepare` (3119); `Store.sql` (3119) | CORE |
| [packages/store/src/store.ts:1791](../../packages/store/src/store.ts#L1791) `Store/dataVersion` | `SQLite.get` (1791); `SQLite.prepare` (1791); `Store.sql` (1791) | CORE |
| [packages/store/src/store.ts:9568](../../packages/store/src/store.ts#L9568) `Store/delete` | `Store.row` (9568) | CORE |
| [packages/store/src/store.ts:9576](../../packages/store/src/store.ts#L9576) `Store/delete/run` | `SQLite.get` (9576); `SQLite.prepare` (9576, 9581); `Store.sql` (9576, 9581) | CORE |
| [packages/store/src/store.ts:4570](../../packages/store/src/store.ts#L4570) `Store/deleteAccount` | `SQLite.prepare` (4570, 4574, 4575, 4576, 4577, 4578, 4579, 4580, 4581, 4588, 4590, 4592, 4594, 4598); `Store.sql` (4570, 4574, 4575, 4576, 4577, 4578, 4579, 4580, 4581, 4588, 4590, 4592, 4594, 4598) | CORE |
| [packages/store/src/store.ts:5550](../../packages/store/src/store.ts#L5550) `Store/deletePrivilegeSet` | `SQLite.prepare` (5550); `Store.sql` (5550) | CORE |
| [packages/store/src/store.ts:3580](../../packages/store/src/store.ts#L3580) `Store/deleteScriptTest` | `SQLite.prepare` (3580); `Store.sql` (3580) | CORE |
| [packages/store/src/store.ts:2764](../../packages/store/src/store.ts#L2764) `Store/deletedRows` | `SQLite.get` (2764); `SQLite.prepare` (2764, 2766, 2766); `Store.sql` (2764, 2766, 2766); `SQLite.all` (2766, 2766) | CORE |
| [packages/store/src/store.ts:2874](../../packages/store/src/store.ts#L2874) `Store/designEffect` | `Store.sql` (2874, 2879, 2884, 2889, 2892, 2898, 2909, 2910, 2912, 2925, 2926, 2929, 2931, 2937, 2938, 2939, 2944, 2946, 2950, 2953, 2954, 2956, 2959, 2965, 2967, 2974, 2975, 2977, 2978, 2979, 2980, 2987, 2988, 2990, 2990, 2992, 2993, 2994, 2998, 3002, 3004, 3042, 3044, 3046); `SQLite.get` (2909, 2925, 2937, 2938, 2950, 2954, 2990, 2998); `SQLite.prepare` (2909, 2910, 2925, 2926, 2937, 2938, 2944, 2946, 2950, 2954, 2965, 2967, 2980, 2987, 2988, 2990, 2992, 2994, 2998, 3002); `SQLite.all` (2987, 2988); `SQLite.iterate` (2992) | CORE |
| [packages/store/src/store.ts:2867](../../packages/store/src/store.ts#L2867) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2867); `Store.sql` (2867) | CORE |
| [packages/store/src/store.ts:2851](../../packages/store/src/store.ts#L2851) `Store/designEffect/renameKey` | `SQLite.prepare` (2851); `Store.sql` (2851) | CORE |
| [packages/store/src/store.ts:2805](../../packages/store/src/store.ts#L2805) `Store/designHistory` | `SQLite.all` (2805); `SQLite.prepare` (2805); `Store.sql` (2805) | CORE |
| [packages/store/src/store.ts:5137](../../packages/store/src/store.ts#L5137) `Store/disableTotp` | `SQLite.prepare` (5137); `Store.sql` (5137) | CORE |
| [packages/store/src/store.ts:3054](../../packages/store/src/store.ts#L3054) `Store/dropColumnIndexes` | `SQLite.all` (3054, 3056); `SQLite.prepare` (3054, 3056); `Store.sql` (3054, 3056, 3057) | CORE |
| [packages/store/src/store.ts:8244](../../packages/store/src/store.ts#L8244) `Store/dropFieldIndex` | `SQLite.get` (8244); `SQLite.prepare` (8244); `Store.sql` (8244, 8245) | CORE |
| [packages/store/src/store.ts:8881](../../packages/store/src/store.ts#L8881) `Store/duplicate` | `Store.row` (8881); `SQLite.get` (8885); `SQLite.prepare` (8885, 8900); `Store.sql` (8885, 8900) | CORE |
| [packages/store/src/store.ts:7892](../../packages/store/src/store.ts#L7892) `Store/embeddedContainerCount` | `SQLite.prepare` (7892); `Store.sql` (7892); `SQLite.get` (7893) | CORE |
| [packages/store/src/store.ts:7878](../../packages/store/src/store.ts#L7878) `Store/embeddedContainers` | `SQLite.prepare` (7878, 7879); `Store.sql` (7878, 7879); `SQLite.all` (7879); `SQLite.get` (7883) | CORE |
| [packages/store/src/store.ts:2790](../../packages/store/src/store.ts#L2790) `Store/emptyDeleted` | `Store.sql` (2790, 2793, 2794, 2796, 2798); `SQLite.prepare` (2794) | CORE |
| [packages/store/src/store.ts:1671](../../packages/store/src/store.ts#L1671) `Store/endTransaction` | `Store.sql` (1671, 1674, 1674) | CORE |
| [packages/store/src/store.ts:5105](../../packages/store/src/store.ts#L5105) `Store/enrollTotp` | `SQLite.prepare` (5105); `Store.sql` (5105) | CORE |
| [packages/store/src/store.ts:2759](../../packages/store/src/store.ts#L2759) `Store/ensureDeleted` | `Store.sql` (2759) | CORE |
| [packages/store/src/store.ts:1244](../../packages/store/src/store.ts#L1244) `Store/ensureNativeIds` | `SQLite.all` (1244, 1256); `SQLite.prepare` (1244, 1247, 1255, 1256); `Store.sql` (1244, 1247, 1250, 1254, 1255, 1256, 1259, 1261) | CORE |
| [packages/store/src/store.ts:9222](../../packages/store/src/store.ts#L9222) `Store/evaluateCurrent` | `Store.row` (9222, 9222, 9223, 9223); `Calculations.context` (9228); `Store.get` (9229, 9231) | GATED-STORE |
| [packages/store/src/store.ts:9263](../../packages/store/src/store.ts#L9263) `Store/evaluateEachCurrent` | `Store.row` (9263, 9263, 9268); `Calculations.context` (9269); `Store.get` (9271) | GATED-STORE |
| [packages/store/src/store.ts:9325](../../packages/store/src/store.ts#L9325) `Store/evaluateRowsCurrent` | `Store.row` (9325, 9325, 9326, 9326) | GATED-STORE |
| [packages/store/src/store.ts:9304](../../packages/store/src/store.ts#L9304) `Store/evaluateRowsCurrent/each` | `Calculations.context` (9304); `Store.get` (9306) | GATED-STORE |
| [packages/store/src/store.ts:9340](../../packages/store/src/store.ts#L9340) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (9340) | GATED-STORE |
| [packages/store/src/store.ts:9362](../../packages/store/src/store.ts#L9362) `Store/evaluateRowsCurrent/key` | `Calculations.context` (9362) | GATED-STORE |
| [packages/store/src/store.ts:3386](../../packages/store/src/store.ts#L3386) `Store/externalAccount` | `SQLite.all` (3386); `SQLite.prepare` (3386); `Store.sql` (3386) | CORE |
| [packages/store/src/store.ts:7397](../../packages/store/src/store.ts#L7397) `Store/externalContainerCheck` | `SQLite.all` (7397); `SQLite.prepare` (7397); `Store.sql` (7397) | CORE |
| [packages/store/src/store.ts:7404](../../packages/store/src/store.ts#L7404) `Store/externalContainerCount` | `SQLite.get` (7404); `SQLite.prepare` (7404); `Store.sql` (7404) | CORE |
| [packages/store/src/store.ts:7413](../../packages/store/src/store.ts#L7413) `Store/externalContainerReport` | `SQLite.all` (7413, 7426); `SQLite.prepare` (7413, 7426); `Store.sql` (7413, 7426) | CORE |
| [packages/store/src/store.ts:4655](../../packages/store/src/store.ts#L4655) `Store/externalIdentityId` | `SQLite.get` (4655, 4661); `SQLite.prepare` (4655, 4660, 4661); `Store.sql` (4655, 4660, 4661) | CORE |
| [packages/store/src/store.ts:7645](../../packages/store/src/store.ts#L7645) `Store/externalOf` | `SQLite.get` (7645); `SQLite.prepare` (7645); `Store.sql` (7645) | CORE |
| [packages/store/src/store.ts:2697](../../packages/store/src/store.ts#L2697) `Store/failureAuditRoom` | `SQLite.get` (2697); `SQLite.prepare` (2697); `Store.sql` (2697) | CORE |
| [packages/store/src/store.ts:7057](../../packages/store/src/store.ts#L7057) `Store/fieldIndexCurrent` | `SQLite.iterate` (7057); `SQLite.prepare` (7057, 7062); `Store.sql` (7057, 7062); `SQLite.all` (7062) | GATED-STORE |
| [packages/store/src/store.ts:8279](../../packages/store/src/store.ts#L8279) `Store/find` | `Store.find` (8279) | GATED-STORE |
| [packages/store/src/store.ts:8651](../../packages/store/src/store.ts#L8651) `Store/findCandidates` | `Store.query` (8651) | CORE |
| [packages/store/src/store.ts:8290](../../packages/store/src/store.ts#L8290) `Store/findHere` | `Store.query` (8290, 8295, 8297, 8311, 8313, 8324); `Store.recordCount` (8308); `SQLite.get` (8309, 8313); `SQLite.prepare` (8309, 8313, 8319, 8326, 8335); `Store.sql` (8309, 8313, 8319, 8326, 8335); `SQLite.all` (8319, 8326, 8335) | GATED-STORE |
| [packages/store/src/store.ts:8330](../../packages/store/src/store.ts#L8330) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (8330); `SQLite.prepare` (8330); `Store.sql` (8330) | GATED-STORE |
| [packages/store/src/store.ts:10021](../../packages/store/src/store.ts#L10021) `Store/findIdsCurrent` | `Store.findIds` (10021) | GATED-STORE |
| [packages/store/src/store.ts:10027](../../packages/store/src/store.ts#L10027) `Store/findIdsHere` | `Store.query` (10027, 10032, 10034); `SQLite.iterate` (10045); `SQLite.prepare` (10045); `Store.sql` (10045) | GATED-STORE |
| [packages/store/src/store.ts:8595](../../packages/store/src/store.ts#L8595) `Store/findSource` | `Store.query` (8595); `SQLite.all` (8604, 8621); `SQLite.prepare` (8604, 8612, 8620); `Store.sql` (8604, 8609, 8612, 8617, 8620, 8634, 8636); `Calculations.globalValue` (8626); `Calculations.unstoredValue` (8627); `Calculations.related` (8631) | CORE |
| [packages/store/src/store.ts:9617](../../packages/store/src/store.ts#L9617) `Store/forgetStandInValues` | `Store.sql` (9617, 9638); `SQLite.prepare` (9638) | CORE |
| [packages/store/src/store.ts:4537](../../packages/store/src/store.ts#L4537) `Store/forgetStandIns` | `SQLite.prepare` (4537); `Store.sql` (4537) | CORE |
| [packages/store/src/store.ts:6939](../../packages/store/src/store.ts#L6939) `Store/foundSetPage` | `rowsById` (6939) | CORE |
| [packages/store/src/store.ts:6955](../../packages/store/src/store.ts#L6955) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6955); `Store.row` (6971) | GATED-STORE |
| [packages/store/src/store.ts:3305](../../packages/store/src/store.ts#L3305) `Store/gateAgentWrite` | `SQLite.get` (3305); `SQLite.prepare` (3305, 3307); `Store.sql` (3305, 3307) | CORE |
| [packages/store/src/store.ts:5403](../../packages/store/src/store.ts#L5403) `Store/generateRecoveryCodes` | `SQLite.prepare` (5403, 5406); `Store.sql` (5403, 5406) | CORE |
| [packages/store/src/store.ts:8723](../../packages/store/src/store.ts#L8723) `Store/getCurrent` | `Store.get` (8723); `Store.row` (8724, 8724, 8738); `SQLite.all` (8741); `SQLite.prepare` (8741); `Store.sql` (8741) | GATED-STORE |
| [packages/store/src/store.ts:8761](../../packages/store/src/store.ts#L8761) `Store/getManyCurrent` | `Store.getMany` (8761); `SQLite.get` (8779); `SQLite.prepare` (8779); `Store.sql` (8779) | GATED-STORE |
| [packages/store/src/store.ts:8772](../../packages/store/src/store.ts#L8772) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8772) | GATED-STORE |
| [packages/store/src/store.ts:1291](../../packages/store/src/store.ts#L1291) `Store/grantFullAccessClients` | `SQLite.prepare` (1291); `Store.sql` (1291) | CORE |
| [packages/store/src/store.ts:10062](../../packages/store/src/store.ts#L10062) `Store/groupSummariesCurrent` | `Store.groupSummaries` (10062); `Store.viewableIds` (10067); `Calculations.collect` (10083); `rowsById` (10083, 10133); `Calculations.collector` (10105) | GATED-STORE |
| [packages/store/src/store.ts:10131](../../packages/store/src/store.ts#L10131) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (10131) | GATED-STORE |
| [packages/store/src/store.ts:10095](../../packages/store/src/store.ts#L10095) `Store/groupSummariesCurrent/key` | `Calculations.value` (10095); `Calculations.related` (10097) | GATED-STORE |
| [packages/store/src/store.ts:1299](../../packages/store/src/store.ts#L1299) `Store/hasOwnPassword` | `SQLite.get` (1299); `SQLite.prepare` (1299); `Store.sql` (1299) | CORE |
| [packages/store/src/store.ts:5262](../../packages/store/src/store.ts#L5262) `Store/hasPasskey` | `SQLite.get` (5262); `SQLite.prepare` (5262); `Store.sql` (5262) | CORE |
| [packages/store/src/store.ts:8198](../../packages/store/src/store.ts#L8198) `Store/hasTable` | `SQLite.get` (8198); `SQLite.prepare` (8198); `Store.sql` (8198) | CORE |
| [packages/store/src/store.ts:5126](../../packages/store/src/store.ts#L5126) `Store/hasTotp` | `SQLite.get` (5126); `SQLite.prepare` (5126); `Store.sql` (5126) | CORE |
| [packages/store/src/store.ts:4634](../../packages/store/src/store.ts#L4634) `Store/identityAllowed` | `SQLite.get` (4634, 4640, 4646); `SQLite.prepare` (4634, 4640, 4646); `Store.sql` (4634, 4640, 4646) | CORE |
| [packages/store/src/store.ts:6414](../../packages/store/src/store.ts#L6414) `Store/image` | `SQLite.get` (6414); `SQLite.prepare` (6414); `Store.sql` (6414) | CORE |
| [packages/store/src/store.ts:6424](../../packages/store/src/store.ts#L6424) `Store/images` | `SQLite.all` (6424); `SQLite.prepare` (6424); `Store.sql` (6424) | CORE |
| [packages/store/src/store.ts:4381](../../packages/store/src/store.ts#L4381) `Store/importAccounts` | `SQLite.all` (4381); `SQLite.prepare` (4381); `Store.sql` (4381) | CORE |
| [packages/store/src/store.ts:1540](../../packages/store/src/store.ts#L1540) `Store/independentWindowWrite` | `SQLite.get` (1540); `SQLite.prepare` (1540, 1570); `Store.sql` (1540, 1549, 1565, 1570, 1573) | CORE |
| [packages/store/src/store.ts:8210](../../packages/store/src/store.ts#L8210) `Store/indexedFields` | `SQLite.all` (8210, 8211); `SQLite.prepare` (8210, 8211); `Store.sql` (8210, 8211) | CORE |
| [packages/store/src/store.ts:10429](../../packages/store/src/store.ts#L10429) `Store/internalRoots` | `SQLite.get` (10429); `SQLite.prepare` (10429, 10431); `SQLite.all` (10431) | CORE |
| [packages/store/src/store.ts:3141](../../packages/store/src/store.ts#L3141) `Store/isAgent` | `SQLite.get` (3141); `SQLite.prepare` (3141); `Store.sql` (3141) | CORE |
| [packages/store/src/store.ts:3244](../../packages/store/src/store.ts#L3244) `Store/isExternal` | `SQLite.get` (3244); `SQLite.prepare` (3244); `Store.sql` (3244) | CORE |
| [packages/store/src/store.ts:5179](../../packages/store/src/store.ts#L5179) `Store/issueWebauthnChallenge` | `SQLite.prepare` (5179, 5181, 5182, 5184); `Store.sql` (5179, 5181, 5182, 5184); `SQLite.get` (5181) | CORE |
| [packages/store/src/store.ts:10336](../../packages/store/src/store.ts#L10336) `Store/iterateCommitted` | `SQLite.iterate` (10336) | CORE |
| [packages/store/src/store.ts:1517](../../packages/store/src/store.ts#L1517) `Store/joinTransaction` | `Store.sql` (1517, 1518, 1520, 1522, 1528) | CORE |
| [packages/store/src/store.ts:9819](../../packages/store/src/store.ts#L9819) `Store/keyStepWork` | `Store.sql` (9819, 9825, 9829, 9831) | CORE |
| [packages/store/src/store.ts:6281](../../packages/store/src/store.ts#L6281) `Store/knownSharedAccount` | `SQLite.get` (6281); `SQLite.prepare` (6281); `Store.sql` (6281) | CORE |
| [packages/store/src/store.ts:3854](../../packages/store/src/store.ts#L3854) `Store/lastSignIns` | `Store.auditLog` (3854) | CORE |
| [packages/store/src/store.ts:6454](../../packages/store/src/store.ts#L6454) `Store/layout` | `SQLite.get` (6454); `SQLite.prepare` (6454); `Store.sql` (6454) | CORE |
| [packages/store/src/store.ts:2822](../../packages/store/src/store.ts#L2822) `Store/layoutHistory` | `SQLite.all` (2822); `SQLite.prepare` (2822); `Store.sql` (2822) | CORE |
| [packages/store/src/store.ts:6344](../../packages/store/src/store.ts#L6344) `Store/layouts` | `SQLite.all` (6344); `SQLite.prepare` (6344); `Store.sql` (6344) | CORE |
| [packages/store/src/store.ts:4154](../../packages/store/src/store.ts#L4154) `Store/leastPrivilege` | `SQLite.all` (4154); `SQLite.prepare` (4154); `Store.sql` (4154) | CORE |
| [packages/store/src/store.ts:4718](../../packages/store/src/store.ts#L4718) `Store/ledgerRow` | `SQLite.get` (4718, 4719); `SQLite.prepare` (4718, 4719); `Store.sql` (4718, 4719) | AUTH |
| [packages/store/src/store.ts:4730](../../packages/store/src/store.ts#L4730) `Store/ledgerWrite` | `Store.sql` (4730, 4731, 4733, 4735, 4738, 4738) | AUTH |
| [packages/store/src/store.ts:4464](../../packages/store/src/store.ts#L4464) `Store/limitAccountImport` | `SQLite.prepare` (4464, 4465, 4468); `Store.sql` (4464, 4465, 4468); `SQLite.get` (4465) | CORE |
| [packages/store/src/store.ts:3094](../../packages/store/src/store.ts#L3094) `Store/linkIdentity` | `SQLite.get` (3094); `SQLite.prepare` (3094); `Store.sql` (3094) | CORE |
| [packages/store/src/store.ts:3086](../../packages/store/src/store.ts#L3086) `Store/linkPrincipal` | `SQLite.get` (3086); `SQLite.prepare` (3086); `Store.sql` (3086) | CORE |
| [packages/store/src/store.ts:2723](../../packages/store/src/store.ts#L2723) `Store/logSecurity` | `Store.sql` (2723) | CORE |
| [packages/store/src/store.ts:3740](../../packages/store/src/store.ts#L3740) `Store/markPiiField` | `SQLite.prepare` (3740); `Store.sql` (3740) | CORE |
| [packages/store/src/store.ts:7370](../../packages/store/src/store.ts#L7370) `Store/markRepeating` | `SQLite.prepare` (7370); `Store.sql` (7370) | CORE |
| [packages/store/src/store.ts:10269](../../packages/store/src/store.ts#L10269) `Store/matchIds` | `Store.matchIds` (10269); `SQLite.all` (10275); `SQLite.prepare` (10275); `Store.sql` (10275) | CORE |
| [packages/store/src/store.ts:1314](../../packages/store/src/store.ts#L1314) `Store/meta` | `SQLite.get` (1314); `SQLite.prepare` (1314); `Store.sql` (1314) | CORE |
| [packages/store/src/store.ts:923](../../packages/store/src/store.ts#L923) `Store/metadataVersions` | `SQLite.get` (923); `SQLite.prepare` (923); `Store.sql` (923) | CORE |
| [packages/store/src/store.ts:8007](../../packages/store/src/store.ts#L8007) `Store/moveContainersIn` | `Store.sql` (8007, 8013, 8015, 8016, 8017, 8018, 8038, 8043, 8043, 8054, 8057, 8060, 8067); `SQLite.prepare` (8015, 8016, 8017, 8018, 8054, 8060); `SQLite.get` (8020, 8054, 8060) | CORE |
| [packages/store/src/store.ts:7929](../../packages/store/src/store.ts#L7929) `Store/moveContainersOut` | `Store.sql` (7929, 7937, 7939, 7941, 7946, 7947, 7967, 7973, 7975, 7977, 7977, 7983, 7983, 7988, 7990, 7992, 7992, 7998); `SQLite.get` (7937); `SQLite.prepare` (7937, 7946, 7947); `Store.container` (7949) | CORE |
| [packages/store/src/store.ts:4335](../../packages/store/src/store.ts#L4335) `Store/mustChangePassword` | `SQLite.get` (4335); `SQLite.prepare` (4335); `Store.sql` (4335) | CORE |
| [packages/store/src/store.ts:1269](../../packages/store/src/store.ts#L1269) `Store/nativeIdGuards` | `Store.sql` (1269, 1270, 1272) | CORE |
| [packages/store/src/store.ts:5006](../../packages/store/src/store.ts#L5006) `Store/objectUseSince` | `SQLite.get` (5006); `SQLite.prepare` (5006); `Store.sql` (5006) | CORE |
| [packages/store/src/store.ts:8170](../../packages/store/src/store.ts#L8170) `Store/orderBy` | `Store.valueListItems` (8170) | CORE |
| [packages/store/src/store.ts:7562](../../packages/store/src/store.ts#L7562) `Store/orphanContainerReport` | `SQLite.all` (7562); `SQLite.prepare` (7562); `Store.sql` (7562) | CORE |
| [packages/store/src/store.ts:5231](../../packages/store/src/store.ts#L5231) `Store/passkeyAllowList` | `SQLite.all` (5231); `SQLite.prepare` (5231); `Store.sql` (5231) | CORE |
| [packages/store/src/store.ts:5267](../../packages/store/src/store.ts#L5267) `Store/passkeyIds` | `SQLite.all` (5267); `SQLite.prepare` (5267); `Store.sql` (5267) | CORE |
| [packages/store/src/store.ts:5255](../../packages/store/src/store.ts#L5255) `Store/passkeys` | `SQLite.all` (5255); `SQLite.prepare` (5255); `Store.sql` (5255) | CORE |
| [packages/store/src/store.ts:4374](../../packages/store/src/store.ts#L4374) `Store/passwordDaysRemaining` | `SQLite.get` (4374); `SQLite.prepare` (4374); `Store.sql` (4374) | CORE |
| [packages/store/src/store.ts:?](../../packages/store/src/store.ts#L1) `Store/passwordHash` |  | CORE |
| [packages/store/src/store.ts:3329](../../packages/store/src/store.ts#L3329) `Store/pendingChanges` | `SQLite.all` (3329); `SQLite.prepare` (3329); `Store.sql` (3329) | CORE |
| [packages/store/src/store.ts:1332](../../packages/store/src/store.ts#L1332) `Store/persistentData` | `SQLite.get` (1332) | CORE |
| [packages/store/src/store.ts:1341](../../packages/store/src/store.ts#L1341) `Store/persistentDataIds` | `SQLite.all` (1341) | CORE |
| [packages/store/src/store.ts:1322](../../packages/store/src/store.ts#L1322) `Store/persistentTable` | `Store.sql` (1322) | CORE |
| [packages/store/src/store.ts:9510](../../packages/store/src/store.ts#L9510) `Store/portalContainerTarget` | `Store.row` (9510); `relatedIdList` (9512) | CORE |
| [packages/store/src/store.ts:6994](../../packages/store/src/store.ts#L6994) `Store/portalCountsCurrent` | `Store.canView` (6994); `Store.row` (7021) | GATED-STORE |
| [packages/store/src/store.ts:7232](../../packages/store/src/store.ts#L7232) `Store/portalRows` | `relatedRows` (7232); `relatedIdList` (7233); `Store.viewableIds` (7236); `rowsById` (7261, 7299); `Calculations.related` (7275) | CORE |
| [packages/store/src/store.ts:7243](../../packages/store/src/store.ts#L7243) `Store/portalRows/context` | `Calculations.context` (7243) | CORE |
| [packages/store/src/store.ts:7253](../../packages/store/src/store.ts#L7253) `Store/portalRows/valueOf` | `Calculations.value` (7253) | CORE |
| [packages/store/src/store.ts:2256](../../packages/store/src/store.ts#L2256) `Store/prepared` | `SQLite.prepare` (2256); `Store.sql` (2256) | CORE |
| [packages/store/src/store.ts:4446](../../packages/store/src/store.ts#L4446) `Store/previewAccountImport` | `Store.sql` (4446, 4447, 4456) | CORE |
| [packages/store/src/store.ts:6045](../../packages/store/src/store.ts#L6045) `Store/previewRecordRuleCurrent` | `SQLite.get` (6045); `SQLite.prepare` (6045, 6048); `Store.sql` (6045, 6048); `SQLite.all` (6048); `Calculations.context` (6054, 6070) | CORE |
| [packages/store/src/store.ts:8686](../../packages/store/src/store.ts#L8686) `Store/previewRow` | `Store.row` (8686) | CORE |
| [packages/store/src/store.ts:5478](../../packages/store/src/store.ts#L5478) `Store/privilegeSets` | `Store.sql` (5478) | CORE |
| [packages/store/src/store.ts:2467](../../packages/store/src/store.ts#L2467) `Store/pruneAudit` | `Store.sql` (2467, 2469, 2471); `SQLite.get` (2469); `SQLite.prepare` (2469) | CORE |
| [packages/store/src/store.ts:7597](../../packages/store/src/store.ts#L7597) `Store/purgeOrphanContainers` | `Store.sql` (7597, 7601, 7610, 7613, 7614, 7619, 7620, 7622, 7622); `Store.orphanContainerReport` (7605); `SQLite.get` (7610); `SQLite.prepare` (7610, 7613, 7614) | CORE |
| [packages/store/src/store.ts:10528](../../packages/store/src/store.ts#L10528) `Store/query` | `SQLite.iterate` (10528) | CORE |
| [packages/store/src/store.ts:10562](../../packages/store/src/store.ts#L10562) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10562); `SQLite.all` (10569, 10572); `SQLite.prepare` (10569, 10572) | CORE |
| [packages/store/src/store.ts:10370](../../packages/store/src/store.ts#L10370) `Store/readOnlyChecked` | `SQLite.prepare` (10370, 10374, 10383, 10388); `SQLite.all` (10374, 10383, 10388) | CORE |
| [packages/store/src/store.ts:3066](../../packages/store/src/store.ts#L3066) `Store/recompute` | `SQLite.prepare` (3066, 3070); `Store.sql` (3066, 3070); `SQLite.iterate` (3070); `Calculations.computeStoredStyled` (3071); `Calculations.value` (3071) | CORE |
| [packages/store/src/store.ts:2271](../../packages/store/src/store.ts#L2271) `Store/recordAsOf` | `SQLite.get` (2271, 2273); `SQLite.prepare` (2271, 2273, 2275, 2276); `Store.sql` (2271, 2273, 2275, 2276); `SQLite.all` (2275, 2276) | CORE |
| [packages/store/src/store.ts:1974](../../packages/store/src/store.ts#L1974) `Store/recordCount` | `SQLite.get` (1974); `SQLite.prepare` (1974); `Store.sql` (1974) | CORE |
| [packages/store/src/store.ts:4937](../../packages/store/src/store.ts#L4937) `Store/recordObjectUse` | `Store.sql` (4937) | CORE |
| [packages/store/src/store.ts:9212](../../packages/store/src/store.ts#L9212) `Store/recordViewable` | `Store.row` (9212) | GATED-STORE |
| [packages/store/src/store.ts:1379](../../packages/store/src/store.ts#L1379) `Store/recordedFormat` | `Store.sql` (1379) | CORE |
| [packages/store/src/store.ts:7901](../../packages/store/src/store.ts#L7901) `Store/recoverContainersOut` | `SQLite.prepare` (7901); `Store.sql` (7901); `SQLite.get` (7904) | CORE |
| [packages/store/src/store.ts:1455](../../packages/store/src/store.ts#L1455) `Store/recoverPendingExternalFiles` | `Store.sql` (1455, 1457, 1481, 1483); `SQLite.prepare` (1457); `SQLite.get` (1468) | CORE |
| [packages/store/src/store.ts:5421](../../packages/store/src/store.ts#L5421) `Store/recoveryCodesRemaining` | `SQLite.get` (5421); `SQLite.prepare` (5421); `Store.sql` (5421) | CORE |
| [packages/store/src/store.ts:10410](../../packages/store/src/store.ts#L10410) `Store/refreshDecimalSqlViews` | `SQLite.get` (10410); `SQLite.prepare` (10410, 10415); `SQLite.all` (10415) | CORE |
| [packages/store/src/store.ts:3235](../../packages/store/src/store.ts#L3235) `Store/refuseLookalikeAccount` | `SQLite.all` (3235); `SQLite.prepare` (3235); `Store.sql` (3235) | CORE |
| [packages/store/src/store.ts:5289](../../packages/store/src/store.ts#L5289) `Store/registerPasskey` | `SQLite.prepare` (5289); `Store.sql` (5289) | CORE |
| [packages/store/src/store.ts:3364](../../packages/store/src/store.ts#L3364) `Store/rejectPending` | `SQLite.get` (3364); `SQLite.prepare` (3364, 3366); `Store.sql` (3364, 3366) | CORE |
| [packages/store/src/store.ts:8438](../../packages/store/src/store.ts#L8438) `Store/relatedCriteria` | `SQLite.iterate` (8438); `SQLite.prepare` (8438); `Store.sql` (8438) | CORE |
| [packages/store/src/store.ts:8435](../../packages/store/src/store.ts#L8435) `Store/relatedCriteria/matched` | `relatedRows` (8435) | CORE |
| [packages/store/src/store.ts:6782](../../packages/store/src/store.ts#L6782) `Store/relatedValues` | `Calculations.globalValue` (6782); `Calculations.unstoredValue` (6784) | CORE |
| [packages/store/src/store.ts:5300](../../packages/store/src/store.ts#L5300) `Store/removePasskey` | `SQLite.get` (5300); `SQLite.prepare` (5300, 5301); `Store.sql` (5300, 5301) | CORE |
| [packages/store/src/store.ts:9657](../../packages/store/src/store.ts#L9657) `Store/restoreDeletedRowLocked` | `SQLite.get` (9657, 9662); `SQLite.prepare` (9657, 9658, 9662, 9672); `Store.sql` (9657, 9658, 9662, 9672); `SQLite.all` (9658) | CORE |
| [packages/store/src/store.ts:2306](../../packages/store/src/store.ts#L2306) `Store/restoreRecord` | `Store.recordAsOf` (2306); `SQLite.get` (2310); `SQLite.prepare` (2310, 2315, 2324, 2335); `Store.sql` (2310, 2315, 2324, 2335) | CORE |
| [packages/store/src/store.ts:2350](../../packages/store/src/store.ts#L2350) `Store/revertAuditEntry` | `Store.auditLog` (2350) | CORE |
| [packages/store/src/store.ts:5062](../../packages/store/src/store.ts#L5062) `Store/revokeApiToken` | `SQLite.prepare` (5062); `Store.sql` (5062) | CORE |
| [packages/store/src/store.ts:8704](../../packages/store/src/store.ts#L8704) `Store/row` | `SQLite.get` (8704) | CORE |
| [packages/store/src/store.ts:5871](../../packages/store/src/store.ts#L5871) `Store/ruleOutcome` | `Calculations.context` (5871) | CORE |
| [packages/store/src/store.ts:8549](../../packages/store/src/store.ts#L8549) `Store/runningSummaryValues` | `Store.viewableIds` (8549); `rowsById` (8551); `Calculations.value` (8562, 8568); `Calculations.related` (8579) | GATED-STORE |
| [packages/store/src/store.ts:5507](../../packages/store/src/store.ts#L5507) `Store/savePrivilegeSet` | `SQLite.prepare` (5507, 5515); `Store.sql` (5507, 5515) | AUTH |
| [packages/store/src/store.ts:3571](../../packages/store/src/store.ts#L3571) `Store/saveScriptTest` | `SQLite.prepare` (3571); `Store.sql` (3571) | CORE |
| [packages/store/src/store.ts:6010](../../packages/store/src/store.ts#L6010) `Store/scopedTableSql` | `Store.viewableIds` (6010); `SQLite.all` (6013); `SQLite.prepare` (6013); `Store.sql` (6013) | GATED-STORE |
| [packages/store/src/store.ts:2812](../../packages/store/src/store.ts#L2812) `Store/scriptHistory` | `SQLite.all` (2812); `SQLite.prepare` (2812); `Store.sql` (2812) | CORE |
| [packages/store/src/store.ts:2642](../../packages/store/src/store.ts#L2642) `Store/securityChange` | `Store.sql` (2642, 2644); `SQLite.prepare` (2644) | CORE |
| [packages/store/src/store.ts:2230](../../packages/store/src/store.ts#L2230) `Store/securityEvents` | `Store.auditLog` (2230) | CORE |
| [packages/store/src/store.ts:4786](../../packages/store/src/store.ts#L4786) `Store/securityToken` | `SQLite.get` (4786); `SQLite.prepare` (4786); `Store.sql` (4786) | CORE |
| [packages/store/src/store.ts:10464](../../packages/store/src/store.ts#L10464) `Store/selectCurrent` | `SQLite.iterate` (10464) | CORE |
| [packages/store/src/store.ts:10488](../../packages/store/src/store.ts#L10488) `Store/selectHeldCurrent` | `Store.sql` (10488, 10489); `SQLite.prepare` (10489); `SQLite.iterate` (10492) | CORE |
| [packages/store/src/store.ts:9962](../../packages/store/src/store.ts#L9962) `Store/selectIdsCurrent` | `Store.selectIds` (9962); `SQLite.all` (9968); `SQLite.prepare` (9968); `Store.sql` (9968) | GATED-STORE |
| [packages/store/src/store.ts:10480](../../packages/store/src/store.ts#L10480) `Store/selectIn` | `Store.select` (10480) | CORE |
| [packages/store/src/store.ts:1721](../../packages/store/src/store.ts#L1721) `Store/selfContainedCopy` | `Store.sql` (1721); `SQLite.all` (1726); `SQLite.prepare` (1726, 1728, 1729, 1730) | CORE |
| [packages/store/src/store.ts:4615](../../packages/store/src/store.ts#L4615) `Store/setAccountActive` | `SQLite.prepare` (4615, 4618, 4619); `Store.sql` (4615, 4618, 4619) | AUTH |
| [packages/store/src/store.ts:4805](../../packages/store/src/store.ts#L4805) `Store/setAccountLocalOnly` | `SQLite.prepare` (4805); `Store.sql` (4805) | CORE |
| [packages/store/src/store.ts:5662](../../packages/store/src/store.ts#L5662) `Store/setAccountPrivilegeSet` | `SQLite.get` (5662); `SQLite.prepare` (5662, 5665, 5669); `Store.sql` (5662, 5665, 5669) | AUTH |
| [packages/store/src/store.ts:4814](../../packages/store/src/store.ts#L4814) `Store/setAccountRequire2fa` | `SQLite.prepare` (4814); `Store.sql` (4814) | CORE |
| [packages/store/src/store.ts:3265](../../packages/store/src/store.ts#L3265) `Store/setAgentAccount` | `SQLite.get` (3265); `SQLite.prepare` (3265, 3271); `Store.sql` (3265, 3271) | CORE |
| [packages/store/src/store.ts:3615](../../packages/store/src/store.ts#L3615) `Store/setAiAllowed` | `SQLite.prepare` (3615); `Store.sql` (3615) | CORE |
| [packages/store/src/store.ts:3698](../../packages/store/src/store.ts#L3698) `Store/setAiPolicy` | `SQLite.prepare` (3698); `Store.sql` (3698) | CORE |
| [packages/store/src/store.ts:6268](../../packages/store/src/store.ts#L6268) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (6268); `Store.sql` (6268) | CORE |
| [packages/store/src/store.ts:2445](../../packages/store/src/store.ts#L2445) `Store/setAuditSettings` | `SQLite.prepare` (2445); `Store.sql` (2445) | CORE |
| [packages/store/src/store.ts:8120](../../packages/store/src/store.ts#L8120) `Store/setContainer` | `Store.sql` (8120, 8137); `Store.row` (8126); `SQLite.prepare` (8137) | CORE |
| [packages/store/src/store.ts:3217](../../packages/store/src/store.ts#L3217) `Store/setExternalAccount` | `SQLite.get` (3217); `SQLite.prepare` (3217, 3222); `Store.sql` (3217, 3222) | CORE |
| [packages/store/src/store.ts:4321](../../packages/store/src/store.ts#L4321) `Store/setMustChangePassword` | `SQLite.prepare` (4321); `Store.sql` (4321) | CORE |
| [packages/store/src/store.ts:3417](../../packages/store/src/store.ts#L3417) `Store/setPassword` | `SQLite.get` (3417); `SQLite.prepare` (3417, 3419, 3428); `Store.sql` (3417, 3419, 3428) | AUTH |
| [packages/store/src/store.ts:3512](../../packages/store/src/store.ts#L3512) `Store/setPasswordPolicy` | `SQLite.prepare` (3512); `Store.sql` (3512) | CORE |
| [packages/store/src/store.ts:1347](../../packages/store/src/store.ts#L1347) `Store/setPersistentData` | `SQLite.prepare` (1347, 1351); `Store.sql` (1347, 1351) | CORE |
| [packages/store/src/store.ts:3718](../../packages/store/src/store.ts#L3718) `Store/setPiiIsolation` | `SQLite.prepare` (3718); `Store.sql` (3718) | CORE |
| [packages/store/src/store.ts:3548](../../packages/store/src/store.ts#L3548) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3548); `Store.sql` (3548) | CORE |
| [packages/store/src/store.ts:3630](../../packages/store/src/store.ts#L3630) `Store/setScriptNetwork` | `SQLite.prepare` (3630); `Store.sql` (3630) | CORE |
| [packages/store/src/store.ts:3687](../../packages/store/src/store.ts#L3687) `Store/setSqlRequiresFmxdbc` | `SQLite.prepare` (3687); `Store.sql` (3687) | CORE |
| [packages/store/src/store.ts:9133](../../packages/store/src/store.ts#L9133) `Store/setStoredCalcValues` | `SQLite.prepare` (9133, 9134); `Store.sql` (9133, 9134); `SQLite.get` (9138) | CORE |
| [packages/store/src/store.ts:8202](../../packages/store/src/store.ts#L8202) `Store/setUserPref` | `Store.sql` (8202, 8203, 8204); `SQLite.prepare` (8203, 8204) | CORE |
| [packages/store/src/store.ts:3671](../../packages/store/src/store.ts#L3671) `Store/setWebViewerHosts` | `SQLite.prepare` (3671); `Store.sql` (3671) | CORE |
| [packages/store/src/store.ts:4757](../../packages/store/src/store.ts#L4757) `Store/settleSignIns` | `SQLite.all` (4757, 4763); `SQLite.prepare` (4757, 4763, 4769, 4773, 4775); `Store.sql` (4757, 4763, 4769, 4773, 4775) | AUTH |
| [packages/store/src/store.ts:1852](../../packages/store/src/store.ts#L1852) `Store/shareResults` | `Store.sql` (1852) | CORE |
| [packages/store/src/store.ts:1405](../../packages/store/src/store.ts#L1405) `Store/shipWal` | `Store.sql` (1405) | CORE |
| [packages/store/src/store.ts:4704](../../packages/store/src/store.ts#L4704) `Store/signInBase` | `SQLite.get` (4704); `SQLite.prepare` (4704); `Store.sql` (4704) | AUTH |
| [packages/store/src/store.ts:4706](../../packages/store/src/store.ts#L4706) `Store/signInBase/identity` | `SQLite.get` (4706); `SQLite.prepare` (4706); `Store.sql` (4706) | AUTH |
| [packages/store/src/store.ts:4694](../../packages/store/src/store.ts#L4694) `Store/signInMark` | `SQLite.prepare` (4694); `Store.sql` (4694) | AUTH |
| [packages/store/src/store.ts:10187](../../packages/store/src/store.ts#L10187) `Store/sortIdsCurrentProgress` | `SQLite.all` (10187); `SQLite.prepare` (10187, 10255); `Store.sql` (10187, 10255); `Store.valueListItems` (10195); `rowsById` (10207); `Calculations.globalValue` (10210); `Calculations.unstoredValue` (10211); `Calculations.related` (10217); `SQLite.iterate` (10255) | GATED-STORE |
| [packages/store/src/store.ts:8363](../../packages/store/src/store.ts#L8363) `Store/sortedPage` | `SQLite.iterate` (8363); `SQLite.prepare` (8363, 8378); `Store.sql` (8363, 8378); `SQLite.all` (8378) | CORE |
| [packages/store/src/store.ts:8511](../../packages/store/src/store.ts#L8511) `Store/summaries` | `Calculations.wholeTable` (8511); `Calculations.collect` (8531, 8536) | CORE |
| [packages/store/src/store.ts:8527](../../packages/store/src/store.ts#L8527) `Store/summaries/recs` | `SQLite.iterate` (8527); `SQLite.prepare` (8527); `Store.sql` (8527) | CORE |
| [packages/store/src/store.ts:5245](../../packages/store/src/store.ts#L5245) `Store/takeWebauthnChallenge` | `SQLite.get` (5245); `SQLite.prepare` (5245, 5247); `Store.sql` (5245, 5247) | CORE |
| [packages/store/src/store.ts:8255](../../packages/store/src/store.ts#L8255) `Store/timeFind` | `Store.query` (8255, 8259, 8260); `Store.recordCount` (8262) | CORE |
| [packages/store/src/store.ts:6723](../../packages/store/src/store.ts#L6723) `Store/toRecord` | `Calculations.value` (6723, 6733); `Calculations.globalValue` (6727); `Calculations.unstoredStyled` (6732) | CORE |
| [packages/store/src/store.ts:5131](../../packages/store/src/store.ts#L5131) `Store/totpAccounts` | `SQLite.all` (5131); `SQLite.prepare` (5131); `Store.sql` (5131) | CORE |
| [packages/store/src/store.ts:1416](../../packages/store/src/store.ts#L1416) `Store/trial` | `Store.sql` (1416) | CORE |
| [packages/store/src/store.ts:1421](../../packages/store/src/store.ts#L1421) `Store/trial/undo` | `Store.sql` (1421) | CORE |
| [packages/store/src/store.ts:10297](../../packages/store/src/store.ts#L10297) `Store/truncate/run` | `Store.sql` (10297, 10299, 10306, 10308, 10310, 10311); `SQLite.prepare` (10299, 10306); `SQLite.all` (10301) | CORE |
| [packages/store/src/store.ts:3164](../../packages/store/src/store.ts#L3164) `Store/unmigratedAccounts` | `SQLite.all` (3164); `SQLite.prepare` (3164); `Store.sql` (3164) | CORE |
| [packages/store/src/store.ts:4227](../../packages/store/src/store.ts#L4227) `Store/unusedAccess` | `SQLite.get` (4227); `SQLite.prepare` (4227, 4236); `Store.sql` (4227, 4236); `SQLite.all` (4236) | CORE |
| [packages/store/src/store.ts:4275](../../packages/store/src/store.ts#L4275) `Store/unusedObjects` | `SQLite.get` (4275); `SQLite.prepare` (4275, 4278); `Store.sql` (4275, 4278); `SQLite.all` (4278) | CORE |
| [packages/store/src/store.ts:5362](../../packages/store/src/store.ts#L5362) `Store/unusedRecoveryHashes` | `SQLite.all` (5362); `SQLite.prepare` (5362); `Store.sql` (5362) | CORE |
| [packages/store/src/store.ts:4057](../../packages/store/src/store.ts#L4057) `Store/unusualAccess` | `Store.auditLog` (4057, 4123) | CORE |
| [packages/store/src/store.ts:8955](../../packages/store/src/store.ts#L8955) `Store/update` | `Store.row` (8955); `Store.sql` (8985, 8986, 9025, 9028) | CORE |
| [packages/store/src/store.ts:8988](../../packages/store/src/store.ts#L8988) `Store/update/undo` | `Store.sql` (8988) | CORE |
| [packages/store/src/store.ts:9418](../../packages/store/src/store.ts#L9418) `Store/updatePortals` | `Store.row` (9418, 9454); `relatedRows` (9455) | CORE |
| [packages/store/src/store.ts:9428](../../packages/store/src/store.ts#L9428) `Store/updatePortals/portal/related` | `relatedIdList` (9428) | CORE |
| [packages/store/src/store.ts:9400](../../packages/store/src/store.ts#L9400) `Store/updateRelated` | `relatedRows` (9400) | CORE |
| [packages/store/src/store.ts:4313](../../packages/store/src/store.ts#L4313) `Store/usageCounting` | `SQLite.get` (4313); `SQLite.prepare` (4313); `Store.sql` (4313) | CORE |
| [packages/store/src/store.ts:8193](../../packages/store/src/store.ts#L8193) `Store/userPrefs` | `SQLite.all` (8193); `SQLite.prepare` (8193); `Store.sql` (8193) | CORE |
| [packages/store/src/store.ts:7103](../../packages/store/src/store.ts#L7103) `Store/valueListItemsCurrent` | `Store.valueListItems` (7103); `Store.get` (7117); `relatedRows` (7118); `Store.row` (7118); `SQLite.iterate` (7120); `SQLite.prepare` (7120); `Store.sql` (7120); `Calculations.related` (7130); `Calculations.value` (7134, 7135) | GATED-STORE |
| [packages/store/src/store.ts:9610](../../packages/store/src/store.ts#L9610) `Store/vaultHeld` | `SQLite.get` (9610); `SQLite.prepare` (9610); `Store.sql` (9610) | CORE |
| [packages/store/src/store.ts:?](../../packages/store/src/store.ts#L1) `Store/verifyPasskeyAssertion` |  | CORE |
| [packages/store/src/store.ts:5160](../../packages/store/src/store.ts#L5160) `Store/verifyTotp` | `SQLite.get` (5160); `SQLite.prepare` (5160, 5166); `Store.sql` (5160, 5166) | CORE |
| [packages/store/src/store.ts:1907](../../packages/store/src/store.ts#L1907) `Store/versionNumber` | `SQLite.get` (1907); `SQLite.prepare` (1907); `Store.sql` (1907) | CORE |
| [packages/store/src/store.ts:1863](../../packages/store/src/store.ts#L1863) `Store/versionTriggers` | `SQLite.get` (1863); `SQLite.prepare` (1863, 1868, 1869); `Store.sql` (1863, 1868, 1869, 1886, 1888, 1889, 1891); `SQLite.all` (1868, 1869) | CORE |
| [packages/store/src/store.ts:1831](../../packages/store/src/store.ts#L1831) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1831) | CORE |
| [packages/store/src/store.ts:3653](../../packages/store/src/store.ts#L3653) `Store/webViewerChecked` | `SQLite.get` (3653); `SQLite.prepare` (3653); `Store.sql` (3653) | CORE |
| [packages/store/src/store.ts:1602](../../packages/store/src/store.ts#L1602) `Store/withWriteTransaction` | `Store.sql` (1602, 1613, 1619, 1621, 1621) | CORE |
| [packages/store/src/store.ts:6658](../../packages/store/src/store.ts#L6658) `Store/wordIndex` | `Store.sql` (6658, 6666, 6671); `Store.recordCount` (6670); `SQLite.get` (6671); `SQLite.prepare` (6671) | CORE |
| [packages/store/src/store.ts:7794](../../packages/store/src/store.ts#L7794) `Store/writeExternalFile` | `Store.evaluateEach` (7794); `SQLite.prepare` (7817); `Store.sql` (7817) | CORE |
| [packages/store/src/store.ts:7818](../../packages/store/src/store.ts#L7818) `Store/writeExternalFile/taken` | `SQLite.get` (7818) | CORE |
| [packages/store/src/store.ts:4995](../../packages/store/src/store.ts#L4995) `Store/writeObjectUseRows` | `SQLite.prepare` (4995, 4996, 5001); `Store.sql` (4995, 4996, 5001) | CORE |
| [packages/store/src/store.ts:1962](../../packages/store/src/store.ts#L1962) `Store/writeToken` | `SQLite.get` (1962); `SQLite.prepare` (1962); `Store.sql` (1962) | CORE |
| [packages/store/src/store.ts:4967](../../packages/store/src/store.ts#L4967) `Store/writeUsage` | `Store.sql` (4967, 4968, 4970, 4974, 4976) | CORE |
| [packages/store/src/store.ts:4983](../../packages/store/src/store.ts#L4983) `Store/writeUsageRows` | `SQLite.prepare` (4983, 4984, 4990); `Store.sql` (4983, 4984, 4990) | CORE |
| [packages/store/src/store.ts:6379](../../packages/store/src/store.ts#L6379) `Store/design` | `SQLite.get` (6379) | CORE |
| [packages/store/src/store.ts:6401](../../packages/store/src/store.ts#L6401) `Store/themes` | `SQLite.get` (6401) | CORE |
| [packages/store/src/store.ts:5322](../../packages/store/src/store.ts#L5322) `Store/verifyPasskeyCredential` | `SQLite.get` (5322); `SQLite.prepare` (5322, 5334); `Store.sql` (5322, 5334) | CORE |
| [packages/store/src/store.ts:6239](../../packages/store/src/store.ts#L6239) `Store/passwordState` | `SQLite.get` (6239); `SQLite.prepare` (6239); `Store.sql` (6239) | CORE |
| [packages/store/src/store.ts:9553](../../packages/store/src/store.ts#L9553) `Store/deleteVisibility` | `Store.canViewRecord` (9553) | CORE |
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
| [packages/store/src/native-compat.ts:61](../../packages/store/src/native-compat.ts#L61) `storedState/meta` | `SQLite.get` (61); `SQLite.prepare` (61) | OPERATOR |
| [packages/store/src/native-compat.ts:91](../../packages/store/src/native-compat.ts#L91) `dateFields` | `SQLite.all` (91); `SQLite.prepare` (91) | OPERATOR |
| [packages/store/src/native-compat.ts:115](../../packages/store/src/native-compat.ts#L115) `inspectUpgrade` | `SQLite.get` (115); `SQLite.prepare` (115, 123); `SQLite.iterate` (123) | OPERATOR |
| [packages/store/src/native-compat.ts:157](../../packages/store/src/native-compat.ts#L157) `upgradeNativeFile` | `SQLite.iterate` (157); `SQLite.prepare` (157, 158, 164) | OPERATOR |
<!-- end generated read-gate inventory -->
