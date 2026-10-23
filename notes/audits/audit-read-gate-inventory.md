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
| [packages/server/src/pgwire.ts:798](../../packages/server/src/pgwire.ts#L798) `Connection/catalog` | `Store.describe` (798) | SQL |
| [packages/server/src/pgwire.ts:809](../../packages/server/src/pgwire.ts#L809) `Connection/run` | `Store.selectIn` (809) | SQL |
| [packages/server/src/pgwire.ts:936](../../packages/server/src/pgwire.ts#L936) `Connection/validateSyntax` | `SQLite.prepare` (936); `Store.sql` (936) | SQL |
| [packages/server/src/pgwire.ts:1155](../../packages/server/src/pgwire.ts#L1155) `Connection/describe` | `Store.describe` (1155) | SQL |
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
| [packages/store/src/stale-calcs.ts:201](../../packages/store/src/stale-calcs.ts#L201) `refreshStaleCalcs` | `Store.sql` (201, 206, 221, 223); `SQLite.iterate` (206); `SQLite.prepare` (206) | DESIGN |
| [packages/store/src/stale-calcs.ts:240](../../packages/store/src/stale-calcs.ts#L240) `undoStaleRefresh` | `Store.sql` (240, 247, 249) | DESIGN |
| [packages/store/src/stale-calcs.ts:264](../../packages/store/src/stale-calcs.ts#L264) `RefreshJournal/constructor` | `Store.sql` (264) | DESIGN |
| [packages/store/src/stale-calcs.ts:270](../../packages/store/src/stale-calcs.ts#L270) `RefreshJournal/add` | `SQLite.prepare` (270); `Store.sql` (270) | DESIGN |
| [packages/store/src/stale-calcs.ts:276](../../packages/store/src/stale-calcs.ts#L276) `RefreshJournal/get` | `SQLite.get` (276); `SQLite.prepare` (276); `Store.sql` (276) | DESIGN |
| [packages/store/src/stale-calcs.ts:281](../../packages/store/src/stale-calcs.ts#L281) `RefreshJournal/list` | `SQLite.all` (281); `SQLite.prepare` (281); `Store.sql` (281) | DESIGN |
| [packages/store/src/stale-calcs.ts:285](../../packages/store/src/stale-calcs.ts#L285) `RefreshJournal/markUndone` | `SQLite.prepare` (285); `Store.sql` (285) | DESIGN |
| [packages/store/src/store-format.ts:32](../../packages/store/src/store-format.ts#L32) `storedFormat` | `SQLite.get` (32); `SQLite.prepare` (32) | CORE |
| [packages/store/src/store-format.ts:50](../../packages/store/src/store-format.ts#L50) `checkFormat` | `SQLite.prepare` (50) | CORE |
| [packages/store/src/store.ts:887](../../packages/store/src/store.ts#L887) `Store/metadataVersions` | `SQLite.get` (887); `SQLite.prepare` (887); `Store.sql` (887) | CORE |
| [packages/store/src/store.ts:1025](../../packages/store/src/store.ts#L1025) `Store/constructor` | `Store.sql` (1025, 1027, 1029, 1030, 1034, 1038, 1039, 1050, 1055, 1060, 1061, 1065, 1066, 1067, 1074, 1078, 1082, 1083, 1084, 1089, 1093, 1096, 1097, 1099, 1100, 1103, 1104, 1108, 1109, 1113, 1114, 1117, 1119, 1122, 1123, 1127, 1128, 1132, 1133, 1136, 1137, 1138, 1141, 1142, 1145, 1146, 1148, 1148, 1149, 1149, 1150, 1153, 1157, 1159, 1162, 1163, 1164, 1167, 1168, 1170, 1172, 1173, 1177, 1178, 1180, 1184, 1185, 1186, 1186, 1190, 1191); `SQLite.get` (1029); `SQLite.prepare` (1029, 1096, 1097, 1100, 1103, 1108, 1113, 1122, 1127, 1132, 1141, 1145, 1148, 1149, 1167, 1172, 1177); `SQLite.all` (1096, 1103, 1108, 1113, 1122, 1127, 1132, 1141, 1145, 1148, 1149, 1167, 1172, 1177) | CORE |
| [packages/store/src/store.ts:1248](../../packages/store/src/store.ts#L1248) `Store/grantFullAccessClients` | `SQLite.prepare` (1248); `Store.sql` (1248) | CORE |
| [packages/store/src/store.ts:1271](../../packages/store/src/store.ts#L1271) `Store/meta` | `SQLite.get` (1271); `SQLite.prepare` (1271); `Store.sql` (1271) | CORE |
| [packages/store/src/store.ts:3406](../../packages/store/src/store.ts#L3406) `Store/webViewerChecked` | `SQLite.get` (3406); `SQLite.prepare` (3406); `Store.sql` (3406) | CORE |
| [packages/store/src/store.ts:1279](../../packages/store/src/store.ts#L1279) `Store/persistentTable` | `Store.sql` (1279) | CORE |
| [packages/store/src/store.ts:1289](../../packages/store/src/store.ts#L1289) `Store/persistentData` | `SQLite.get` (1289) | CORE |
| [packages/store/src/store.ts:1298](../../packages/store/src/store.ts#L1298) `Store/persistentDataIds` | `SQLite.all` (1298) | CORE |
| [packages/store/src/store.ts:1304](../../packages/store/src/store.ts#L1304) `Store/setPersistentData` | `SQLite.prepare` (1304, 1308); `Store.sql` (1304, 1308) | CORE |
| [packages/store/src/store.ts:1328](../../packages/store/src/store.ts#L1328) `Store/checkpoint` | `SQLite.get` (1328); `SQLite.prepare` (1328); `Store.sql` (1328) | CORE |
| [packages/store/src/store.ts:1336](../../packages/store/src/store.ts#L1336) `Store/recordedFormat` | `Store.sql` (1336) | CORE |
| [packages/store/src/store.ts:1346](../../packages/store/src/store.ts#L1346) `Store/close` | `Store.sql` (1346) | CORE |
| [packages/store/src/store.ts:1362](../../packages/store/src/store.ts#L1362) `Store/shipWal` | `Store.sql` (1362) | CORE |
| [packages/store/src/store.ts:1373](../../packages/store/src/store.ts#L1373) `Store/trial` | `Store.sql` (1373) | CORE |
| [packages/store/src/store.ts:1378](../../packages/store/src/store.ts#L1378) `Store/trial/undo` | `Store.sql` (1378) | CORE |
| [packages/store/src/store.ts:1413](../../packages/store/src/store.ts#L1413) `Store/joinTransaction` | `Store.sql` (1413, 1414, 1416, 1418, 1424) | CORE |
| [packages/store/src/store.ts:1436](../../packages/store/src/store.ts#L1436) `Store/independentWindowWrite` | `SQLite.get` (1436); `SQLite.prepare` (1436, 1459); `Store.sql` (1436, 1439, 1454, 1459, 1462) | CORE |
| [packages/store/src/store.ts:1484](../../packages/store/src/store.ts#L1484) `Store/withWriteTransaction` | `Store.sql` (1484, 1487, 1491, 1493, 1493) | CORE |
| [packages/store/src/store.ts:1523](../../packages/store/src/store.ts#L1523) `Store/endTransaction` | `Store.sql` (1523, 1526, 1526) | CORE |
| [packages/store/src/store.ts:1552](../../packages/store/src/store.ts#L1552) `Store/backup` | `Store.sql` (1552) | CORE |
| [packages/store/src/store.ts:1642](../../packages/store/src/store.ts#L1642) `Store/dataVersion` | `SQLite.get` (1642); `SQLite.prepare` (1642); `Store.sql` (1642) | CORE |
| [packages/store/src/store.ts:1682](../../packages/store/src/store.ts#L1682) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1682) | CORE |
| [packages/store/src/store.ts:1703](../../packages/store/src/store.ts#L1703) `Store/shareResults` | `Store.sql` (1703) | CORE |
| [packages/store/src/store.ts:1713](../../packages/store/src/store.ts#L1713) `Store/versionTriggers` | `SQLite.get` (1713); `SQLite.prepare` (1713, 1718, 1719); `Store.sql` (1713, 1715, 1716, 1718, 1719, 1728, 1729); `SQLite.all` (1718, 1719) | CORE |
| [packages/store/src/store.ts:1745](../../packages/store/src/store.ts#L1745) `Store/versionNumber` | `SQLite.get` (1745); `SQLite.prepare` (1745); `Store.sql` (1745) | CORE |
| [packages/store/src/store.ts:1758](../../packages/store/src/store.ts#L1758) `Store/changeOne` | `Store.sql` (1758, 1760) | CORE |
| [packages/store/src/store.ts:1761](../../packages/store/src/store.ts#L1761) `Store/changeOne/read` | `SQLite.get` (1761); `SQLite.prepare` (1761); `Store.sql` (1761) | CORE |
| [packages/store/src/store.ts:1800](../../packages/store/src/store.ts#L1800) `Store/writeToken` | `SQLite.get` (1800); `SQLite.prepare` (1800); `Store.sql` (1800) | CORE |
| [packages/store/src/store.ts:1812](../../packages/store/src/store.ts#L1812) `Store/recordCount` | `SQLite.get` (1812); `SQLite.prepare` (1812); `Store.sql` (1812) | CORE |
| [packages/store/src/store.ts:1924](../../packages/store/src/store.ts#L1924) `Store/applyDesign` | `Store.sql` (1924, 1925, 1938, 1941, 1946, 1962, 1965, 1965); `SQLite.prepare` (1941, 1946) | CORE |
| [packages/store/src/store.ts:2023](../../packages/store/src/store.ts#L2023) `Store/auditLog` | `SQLite.all` (2023); `SQLite.prepare` (2023); `Store.sql` (2023) | CORE |
| [packages/store/src/store.ts:2063](../../packages/store/src/store.ts#L2063) `Store/securityEvents` | `Store.auditLog` (2063) | CORE |
| [packages/store/src/store.ts:2089](../../packages/store/src/store.ts#L2089) `Store/prepared` | `SQLite.prepare` (2089); `Store.sql` (2089) | CORE |
| [packages/store/src/store.ts:2104](../../packages/store/src/store.ts#L2104) `Store/recordAsOf` | `SQLite.get` (2104, 2106); `SQLite.prepare` (2104, 2106, 2108, 2109); `Store.sql` (2104, 2106, 2108, 2109); `SQLite.all` (2108, 2109) | CORE |
| [packages/store/src/store.ts:2138](../../packages/store/src/store.ts#L2138) `Store/restoreRecord/run` | `Store.recordAsOf` (2138); `SQLite.get` (2142); `SQLite.prepare` (2142, 2146, 2155, 2166); `Store.sql` (2142, 2146, 2155, 2166) | CORE |
| [packages/store/src/store.ts:2182](../../packages/store/src/store.ts#L2182) `Store/revertAuditEntry` | `Store.auditLog` (2182) | CORE |
| [packages/store/src/store.ts:2275](../../packages/store/src/store.ts#L2275) `Store/setAuditSettings` | `SQLite.prepare` (2275); `Store.sql` (2275) | CORE |
| [packages/store/src/store.ts:2297](../../packages/store/src/store.ts#L2297) `Store/pruneAudit` | `Store.sql` (2297, 2299, 2301); `SQLite.get` (2299); `SQLite.prepare` (2299) | CORE |
| [packages/store/src/store.ts:2379](../../packages/store/src/store.ts#L2379) `Store/audit` | `Store.sql` (2379) | CORE |
| [packages/store/src/store.ts:2468](../../packages/store/src/store.ts#L2468) `Store/securityChange` | `Store.sql` (2468, 2470); `SQLite.prepare` (2470) | CORE |
| [packages/store/src/store.ts:2517](../../packages/store/src/store.ts#L2517) `Store/logSecurity` | `Store.sql` (2517) | CORE |
| [packages/store/src/store.ts:2540](../../packages/store/src/store.ts#L2540) `Store/ensureDeleted` | `Store.sql` (2540) | CORE |
| [packages/store/src/store.ts:2545](../../packages/store/src/store.ts#L2545) `Store/deletedRows` | `SQLite.get` (2545); `SQLite.prepare` (2545, 2547, 2547); `Store.sql` (2545, 2547, 2547); `SQLite.all` (2547, 2547) | CORE |
| [packages/store/src/store.ts:2571](../../packages/store/src/store.ts#L2571) `Store/emptyDeleted` | `Store.sql` (2571, 2574, 2575, 2577, 2579); `SQLite.prepare` (2575) | CORE |
| [packages/store/src/store.ts:2586](../../packages/store/src/store.ts#L2586) `Store/designHistory` | `SQLite.all` (2586); `SQLite.prepare` (2586); `Store.sql` (2586) | CORE |
| [packages/store/src/store.ts:2593](../../packages/store/src/store.ts#L2593) `Store/scriptHistory` | `SQLite.all` (2593); `SQLite.prepare` (2593); `Store.sql` (2593) | CORE |
| [packages/store/src/store.ts:2603](../../packages/store/src/store.ts#L2603) `Store/layoutHistory` | `SQLite.all` (2603); `SQLite.prepare` (2603); `Store.sql` (2603) | CORE |
| [packages/store/src/store.ts:2632](../../packages/store/src/store.ts#L2632) `Store/designEffect/renameKey` | `SQLite.prepare` (2632); `Store.sql` (2632) | CORE |
| [packages/store/src/store.ts:2648](../../packages/store/src/store.ts#L2648) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2648); `Store.sql` (2648) | CORE |
| [packages/store/src/store.ts:2655](../../packages/store/src/store.ts#L2655) `Store/designEffect` | `Store.sql` (2655, 2660, 2665, 2670, 2673, 2679, 2690, 2691, 2693, 2706, 2707, 2710, 2712, 2718, 2719, 2720, 2725, 2727, 2731, 2734, 2735, 2737, 2740, 2746, 2748, 2755, 2756, 2758, 2759, 2760, 2761, 2768, 2769, 2771, 2771, 2773, 2774, 2775, 2779, 2783, 2785, 2823, 2825, 2827); `SQLite.get` (2690, 2706, 2718, 2719, 2731, 2735, 2771, 2779); `SQLite.prepare` (2690, 2691, 2706, 2707, 2718, 2719, 2725, 2727, 2731, 2735, 2746, 2748, 2761, 2768, 2769, 2771, 2773, 2775, 2779, 2783); `SQLite.all` (2768, 2769); `SQLite.iterate` (2773) | CORE |
| [packages/store/src/store.ts:2835](../../packages/store/src/store.ts#L2835) `Store/dropColumnIndexes` | `SQLite.all` (2835, 2837); `SQLite.prepare` (2835, 2837); `Store.sql` (2835, 2837, 2838) | CORE |
| [packages/store/src/store.ts:2847](../../packages/store/src/store.ts#L2847) `Store/recompute` | `SQLite.prepare` (2847, 2851); `Store.sql` (2847, 2851); `SQLite.iterate` (2851); `Calculations.computeStoredStyled` (2852); `Calculations.value` (2852) | CORE |
| [packages/store/src/store.ts:2867](../../packages/store/src/store.ts#L2867) `Store/linkPrincipal` | `SQLite.get` (2867); `SQLite.prepare` (2867); `Store.sql` (2867) | CORE |
| [packages/store/src/store.ts:2874](../../packages/store/src/store.ts#L2874) `Store/linkIdentity` | `SQLite.get` (2874); `SQLite.prepare` (2874); `Store.sql` (2874) | CORE |
| [packages/store/src/store.ts:2880](../../packages/store/src/store.ts#L2880) `Store/accountsSharingLockout` | `SQLite.all` (2880); `SQLite.prepare` (2880); `Store.sql` (2880) | CORE |
| [packages/store/src/store.ts:2884](../../packages/store/src/store.ts#L2884) `Store/accounts` | `SQLite.all` (2884); `SQLite.prepare` (2884); `Store.sql` (2884) | CORE |
| [packages/store/src/store.ts:2896](../../packages/store/src/store.ts#L2896) `Store/isAgent` | `SQLite.get` (2896); `SQLite.prepare` (2896); `Store.sql` (2896) | CORE |
| [packages/store/src/store.ts:2902](../../packages/store/src/store.ts#L2902) `Store/agentNeedsApproval` | `SQLite.get` (2902); `SQLite.prepare` (2902); `Store.sql` (2902) | CORE |
| [packages/store/src/store.ts:2908](../../packages/store/src/store.ts#L2908) `Store/blankPasswordAccounts` | `SQLite.all` (2908); `SQLite.prepare` (2908); `Store.sql` (2908) | CORE |
| [packages/store/src/store.ts:1256](../../packages/store/src/store.ts#L1256) `Store/hasOwnPassword` | `SQLite.get` (1256); `SQLite.prepare` (1256); `Store.sql` (1256) | CORE |
| [packages/store/src/store.ts:2919](../../packages/store/src/store.ts#L2919) `Store/unmigratedAccounts` | `SQLite.all` (2919); `SQLite.prepare` (2919); `Store.sql` (2919) | CORE |
| [packages/store/src/store.ts:2972](../../packages/store/src/store.ts#L2972) `Store/setExternalAccount` | `SQLite.get` (2972); `SQLite.prepare` (2972, 2977); `Store.sql` (2972, 2977) | CORE |
| [packages/store/src/store.ts:2990](../../packages/store/src/store.ts#L2990) `Store/refuseLookalikeAccount` | `SQLite.all` (2990); `SQLite.prepare` (2990); `Store.sql` (2990) | CORE |
| [packages/store/src/store.ts:2999](../../packages/store/src/store.ts#L2999) `Store/isExternal` | `SQLite.get` (2999); `SQLite.prepare` (2999); `Store.sql` (2999) | CORE |
| [packages/store/src/store.ts:3020](../../packages/store/src/store.ts#L3020) `Store/setAgentAccount` | `SQLite.get` (3020); `SQLite.prepare` (3020, 3026); `Store.sql` (3020, 3026) | CORE |
| [packages/store/src/store.ts:3060](../../packages/store/src/store.ts#L3060) `Store/gateAgentWrite` | `SQLite.prepare` (3060); `Store.sql` (3060) | CORE |
| [packages/store/src/store.ts:3082](../../packages/store/src/store.ts#L3082) `Store/pendingChanges` | `SQLite.all` (3082); `SQLite.prepare` (3082); `Store.sql` (3082) | CORE |
| [packages/store/src/store.ts:3096](../../packages/store/src/store.ts#L3096) `Store/approvePending` | `SQLite.get` (3096); `SQLite.prepare` (3096, 3107); `Store.sql` (3096, 3107) | CORE |
| [packages/store/src/store.ts:3117](../../packages/store/src/store.ts#L3117) `Store/rejectPending` | `SQLite.get` (3117); `SQLite.prepare` (3117, 3119); `Store.sql` (3117, 3119) | CORE |
| [packages/store/src/store.ts:3139](../../packages/store/src/store.ts#L3139) `Store/externalAccount` | `SQLite.all` (3139); `SQLite.prepare` (3139); `Store.sql` (3139) | CORE |
| [packages/store/src/store.ts:3170](../../packages/store/src/store.ts#L3170) `Store/setPassword` | `SQLite.get` (3170); `SQLite.prepare` (3170, 3172, 3181); `Store.sql` (3170, 3172, 3181) | AUTH |
| [packages/store/src/store.ts:3195](../../packages/store/src/store.ts#L3195) `Store/createAccount` | `SQLite.get` (3195); `SQLite.prepare` (3195, 3199, 3205, 3210, 3215); `Store.sql` (3195, 3199, 3205, 3210, 3215) | CORE |
| [packages/store/src/store.ts:3223](../../packages/store/src/store.ts#L3223) `Store/appendSecurityEvent` | `Store.sql` (3223) | CORE |
| [packages/store/src/store.ts:3265](../../packages/store/src/store.ts#L3265) `Store/setPasswordPolicy` | `SQLite.prepare` (3265); `Store.sql` (3265) | CORE |
| [packages/store/src/store.ts:3301](../../packages/store/src/store.ts#L3301) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3301); `Store.sql` (3301) | CORE |
| [packages/store/src/store.ts:3324](../../packages/store/src/store.ts#L3324) `Store/saveScriptTest` | `SQLite.prepare` (3324); `Store.sql` (3324) | CORE |
| [packages/store/src/store.ts:3333](../../packages/store/src/store.ts#L3333) `Store/deleteScriptTest` | `SQLite.prepare` (3333); `Store.sql` (3333) | CORE |
| [packages/store/src/store.ts:3368](../../packages/store/src/store.ts#L3368) `Store/setAiAllowed` | `SQLite.prepare` (3368); `Store.sql` (3368) | CORE |
| [packages/store/src/store.ts:3435](../../packages/store/src/store.ts#L3435) `Store/setAiPolicy` | `SQLite.prepare` (3435); `Store.sql` (3435) | CORE |
| [packages/store/src/store.ts:3383](../../packages/store/src/store.ts#L3383) `Store/setScriptNetwork` | `SQLite.prepare` (3383); `Store.sql` (3383) | CORE |
| [packages/store/src/store.ts:3424](../../packages/store/src/store.ts#L3424) `Store/setWebViewerHosts` | `SQLite.prepare` (3424); `Store.sql` (3424) | CORE |
| [packages/store/src/store.ts:3455](../../packages/store/src/store.ts#L3455) `Store/setPiiIsolation` | `SQLite.prepare` (3455); `Store.sql` (3455) | CORE |
| [packages/store/src/store.ts:3477](../../packages/store/src/store.ts#L3477) `Store/markPiiField` | `SQLite.prepare` (3477); `Store.sql` (3477) | CORE |
| [packages/store/src/store.ts:3591](../../packages/store/src/store.ts#L3591) `Store/lastSignIns` | `Store.auditLog` (3591) | CORE |
| [packages/store/src/store.ts:3794](../../packages/store/src/store.ts#L3794) `Store/unusualAccess` | `Store.auditLog` (3794, 3860) | CORE |
| [packages/store/src/store.ts:3891](../../packages/store/src/store.ts#L3891) `Store/leastPrivilege` | `SQLite.all` (3891); `SQLite.prepare` (3891); `Store.sql` (3891) | CORE |
| [packages/store/src/store.ts:3964](../../packages/store/src/store.ts#L3964) `Store/unusedAccess` | `SQLite.get` (3964); `SQLite.prepare` (3964, 3973); `Store.sql` (3964, 3973); `SQLite.all` (3973) | CORE |
| [packages/store/src/store.ts:4012](../../packages/store/src/store.ts#L4012) `Store/unusedObjects` | `SQLite.get` (4012); `SQLite.prepare` (4012, 4015); `Store.sql` (4012, 4015); `SQLite.all` (4015) | CORE |
| [packages/store/src/store.ts:4050](../../packages/store/src/store.ts#L4050) `Store/usageCounting` | `SQLite.get` (4050); `SQLite.prepare` (4050); `Store.sql` (4050) | CORE |
| [packages/store/src/store.ts:4058](../../packages/store/src/store.ts#L4058) `Store/setMustChangePassword` | `SQLite.prepare` (4058); `Store.sql` (4058) | CORE |
| [packages/store/src/store.ts:4072](../../packages/store/src/store.ts#L4072) `Store/mustChangePassword` | `SQLite.get` (4072); `SQLite.prepare` (4072); `Store.sql` (4072) | CORE |
| [packages/store/src/store.ts:4111](../../packages/store/src/store.ts#L4111) `Store/passwordDaysRemaining` | `SQLite.get` (4111); `SQLite.prepare` (4111); `Store.sql` (4111) | CORE |
| [packages/store/src/store.ts:4118](../../packages/store/src/store.ts#L4118) `Store/importAccounts` | `SQLite.all` (4118); `SQLite.prepare` (4118); `Store.sql` (4118) | CORE |
| [packages/store/src/store.ts:4141](../../packages/store/src/store.ts#L4141) `Store/canonicalAccount` | `SQLite.all` (4141); `SQLite.prepare` (4141); `Store.sql` (4141) | CORE |
| [packages/store/src/store.ts:4153](../../packages/store/src/store.ts#L4153) `Store/createLocalAccount` | `SQLite.prepare` (4153); `Store.sql` (4153) | CORE |
| [packages/store/src/store.ts:4183](../../packages/store/src/store.ts#L4183) `Store/previewAccountImport` | `Store.sql` (4183, 4184, 4193) | CORE |
| [packages/store/src/store.ts:4201](../../packages/store/src/store.ts#L4201) `Store/limitAccountImport` | `SQLite.prepare` (4201, 4202, 4205); `Store.sql` (4201, 4202, 4205); `SQLite.get` (4202) | CORE |
| [packages/store/src/store.ts:4212](../../packages/store/src/store.ts#L4212) `Store/applyAccountImport` | `Store.sql` (4212, 4220, 4249); `SQLite.get` (4220); `SQLite.prepare` (4220, 4249) | CORE |
| [packages/store/src/store.ts:4274](../../packages/store/src/store.ts#L4274) `Store/forgetStandIns` | `SQLite.prepare` (4274); `Store.sql` (4274) | CORE |
| [packages/store/src/store.ts:4307](../../packages/store/src/store.ts#L4307) `Store/deleteAccount` | `SQLite.prepare` (4307, 4311, 4312, 4313, 4314, 4315, 4316, 4317, 4318, 4325, 4327, 4330, 4334); `Store.sql` (4307, 4311, 4312, 4313, 4314, 4315, 4316, 4317, 4318, 4325, 4327, 4330, 4334) | CORE |
| [packages/store/src/store.ts:4351](../../packages/store/src/store.ts#L4351) `Store/setAccountActive` | `SQLite.prepare` (4351, 4354, 4355); `Store.sql` (4351, 4354, 4355) | AUTH |
| [packages/store/src/store.ts:4365](../../packages/store/src/store.ts#L4365) `Store/accountInactive` | `SQLite.get` (4365); `SQLite.prepare` (4365); `Store.sql` (4365) | CORE |
| [packages/store/src/store.ts:4370](../../packages/store/src/store.ts#L4370) `Store/identityAllowed` | `SQLite.get` (4370, 4376, 4382); `SQLite.prepare` (4370, 4376, 4382); `Store.sql` (4370, 4376, 4382) | CORE |
| [packages/store/src/store.ts:4391](../../packages/store/src/store.ts#L4391) `Store/externalIdentityId` | `SQLite.get` (4391, 4397); `SQLite.prepare` (4391, 4396, 4397); `Store.sql` (4391, 4396, 4397) | CORE |
| [packages/store/src/store.ts:4402](../../packages/store/src/store.ts#L4402) `Store/accountIdentityId` | `SQLite.get` (4402, 4407); `SQLite.prepare` (4402, 4406, 4407); `Store.sql` (4402, 4406, 4407) | CORE |
| [packages/store/src/store.ts:4430](../../packages/store/src/store.ts#L4430) `Store/signInMark` | `SQLite.prepare` (4430); `Store.sql` (4430) | AUTH |
| [packages/store/src/store.ts:4440](../../packages/store/src/store.ts#L4440) `Store/signInBase` | `SQLite.get` (4440); `SQLite.prepare` (4440); `Store.sql` (4440) | AUTH |
| [packages/store/src/store.ts:4442](../../packages/store/src/store.ts#L4442) `Store/signInBase/identity` | `SQLite.get` (4442); `SQLite.prepare` (4442); `Store.sql` (4442) | AUTH |
| [packages/store/src/store.ts:4454](../../packages/store/src/store.ts#L4454) `Store/ledgerRow` | `SQLite.get` (4454, 4455); `SQLite.prepare` (4454, 4455); `Store.sql` (4454, 4455) | AUTH |
| [packages/store/src/store.ts:4466](../../packages/store/src/store.ts#L4466) `Store/ledgerWrite` | `Store.sql` (4466, 4467, 4469, 4471, 4474, 4474) | AUTH |
| [packages/store/src/store.ts:4493](../../packages/store/src/store.ts#L4493) `Store/settleSignIns` | `SQLite.all` (4493, 4499); `SQLite.prepare` (4493, 4499, 4505, 4509, 4511); `Store.sql` (4493, 4499, 4505, 4509, 4511) | AUTH |
| [packages/store/src/store.ts:4522](../../packages/store/src/store.ts#L4522) `Store/securityToken` | `SQLite.get` (4522); `SQLite.prepare` (4522); `Store.sql` (4522) | CORE |
| [packages/store/src/store.ts:4530](../../packages/store/src/store.ts#L4530) `Store/accountLocalOnly` | `SQLite.get` (4530); `SQLite.prepare` (4530); `Store.sql` (4530) | CORE |
| [packages/store/src/store.ts:4535](../../packages/store/src/store.ts#L4535) `Store/accountRequires2fa` | `SQLite.get` (4535); `SQLite.prepare` (4535); `Store.sql` (4535) | CORE |
| [packages/store/src/store.ts:4541](../../packages/store/src/store.ts#L4541) `Store/setAccountLocalOnly` | `SQLite.prepare` (4541); `Store.sql` (4541) | CORE |
| [packages/store/src/store.ts:4550](../../packages/store/src/store.ts#L4550) `Store/setAccountRequire2fa` | `SQLite.prepare` (4550); `Store.sql` (4550) | CORE |
| [packages/store/src/store.ts:4579](../../packages/store/src/store.ts#L4579) `Store/createApiToken` | `SQLite.get` (4579); `SQLite.prepare` (4579, 4609); `Store.sql` (4579, 4609) | CORE |
| [packages/store/src/store.ts:4656](../../packages/store/src/store.ts#L4656) `Store/recordObjectUse` | `Store.sql` (4656) | CORE |
| [packages/store/src/store.ts:4686](../../packages/store/src/store.ts#L4686) `Store/writeUsage` | `Store.sql` (4686, 4687, 4689, 4693, 4695) | CORE |
| [packages/store/src/store.ts:4702](../../packages/store/src/store.ts#L4702) `Store/writeUsageRows` | `SQLite.prepare` (4702, 4703, 4709); `Store.sql` (4702, 4703, 4709) | CORE |
| [packages/store/src/store.ts:4714](../../packages/store/src/store.ts#L4714) `Store/writeObjectUseRows` | `SQLite.prepare` (4714, 4715, 4720); `Store.sql` (4714, 4715, 4720) | CORE |
| [packages/store/src/store.ts:4725](../../packages/store/src/store.ts#L4725) `Store/objectUseSince` | `SQLite.get` (4725); `SQLite.prepare` (4725); `Store.sql` (4725) | CORE |
| [packages/store/src/store.ts:4738](../../packages/store/src/store.ts#L4738) `Store/accountUsage` | `SQLite.get` (4738); `SQLite.prepare` (4738, 4739); `Store.sql` (4738, 4739); `SQLite.all` (4739); `Store.auditLog` (4755) | CORE |
| [packages/store/src/store.ts:4771](../../packages/store/src/store.ts#L4771) `Store/apiTokens` | `SQLite.all` (4771); `SQLite.prepare` (4771); `Store.sql` (4771) | CORE |
| [packages/store/src/store.ts:4781](../../packages/store/src/store.ts#L4781) `Store/revokeApiToken` | `SQLite.prepare` (4781); `Store.sql` (4781) | CORE |
| [packages/store/src/store.ts:4795](../../packages/store/src/store.ts#L4795) `Store/apiToken` | `SQLite.get` (4795); `SQLite.prepare` (4795, 4807); `Store.sql` (4795, 4807) | CORE |
| [packages/store/src/store.ts:4823](../../packages/store/src/store.ts#L4823) `Store/enrollTotp` | `SQLite.prepare` (4823); `Store.sql` (4823) | CORE |
| [packages/store/src/store.ts:4834](../../packages/store/src/store.ts#L4834) `Store/confirmTotp` | `SQLite.get` (4834); `SQLite.prepare` (4834, 4836); `Store.sql` (4834, 4836) | CORE |
| [packages/store/src/store.ts:4844](../../packages/store/src/store.ts#L4844) `Store/hasTotp` | `SQLite.get` (4844); `SQLite.prepare` (4844); `Store.sql` (4844) | CORE |
| [packages/store/src/store.ts:4849](../../packages/store/src/store.ts#L4849) `Store/totpAccounts` | `SQLite.all` (4849); `SQLite.prepare` (4849); `Store.sql` (4849) | CORE |
| [packages/store/src/store.ts:4855](../../packages/store/src/store.ts#L4855) `Store/disableTotp` | `SQLite.prepare` (4855); `Store.sql` (4855) | CORE |
| [packages/store/src/store.ts:4878](../../packages/store/src/store.ts#L4878) `Store/verifyTotp` | `SQLite.get` (4878); `SQLite.prepare` (4878, 4884); `Store.sql` (4878, 4884) | CORE |
| [packages/store/src/store.ts:4897](../../packages/store/src/store.ts#L4897) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4897, 4899, 4900, 4902); `Store.sql` (4897, 4899, 4900, 4902); `SQLite.get` (4899) | CORE |
| [packages/store/src/store.ts:4949](../../packages/store/src/store.ts#L4949) `Store/passkeyAllowList` | `SQLite.all` (4949); `SQLite.prepare` (4949); `Store.sql` (4949) | CORE |
| [packages/store/src/store.ts:4963](../../packages/store/src/store.ts#L4963) `Store/takeWebauthnChallenge` | `SQLite.get` (4963); `SQLite.prepare` (4963, 4965); `Store.sql` (4963, 4965) | CORE |
| [packages/store/src/store.ts:4973](../../packages/store/src/store.ts#L4973) `Store/passkeys` | `SQLite.all` (4973); `SQLite.prepare` (4973); `Store.sql` (4973) | CORE |
| [packages/store/src/store.ts:4980](../../packages/store/src/store.ts#L4980) `Store/hasPasskey` | `SQLite.get` (4980); `SQLite.prepare` (4980); `Store.sql` (4980) | CORE |
| [packages/store/src/store.ts:4985](../../packages/store/src/store.ts#L4985) `Store/passkeyIds` | `SQLite.all` (4985); `SQLite.prepare` (4985); `Store.sql` (4985) | CORE |
| [packages/store/src/store.ts:5007](../../packages/store/src/store.ts#L5007) `Store/registerPasskey` | `SQLite.prepare` (5007); `Store.sql` (5007) | CORE |
| [packages/store/src/store.ts:5018](../../packages/store/src/store.ts#L5018) `Store/removePasskey` | `SQLite.get` (5018); `SQLite.prepare` (5018, 5019); `Store.sql` (5018, 5019) | CORE |
| [packages/store/src/store.ts:5035](../../packages/store/src/store.ts#L5035) `Store/verifyPasskeyAssertion` | `SQLite.get` (5035); `SQLite.prepare` (5035, 5046); `Store.sql` (5035, 5046) | CORE |
| [packages/store/src/store.ts:5082](../../packages/store/src/store.ts#L5082) `Store/generateRecoveryCodes` | `SQLite.prepare` (5082, 5085); `Store.sql` (5082, 5085) | CORE |
| [packages/store/src/store.ts:5100](../../packages/store/src/store.ts#L5100) `Store/recoveryCodesRemaining` | `SQLite.get` (5100); `SQLite.prepare` (5100); `Store.sql` (5100) | CORE |
| [packages/store/src/store.ts:5110](../../packages/store/src/store.ts#L5110) `Store/useRecoveryCode` | `SQLite.get` (5110); `SQLite.prepare` (5110, 5112); `Store.sql` (5110, 5112) | CORE |
| [packages/store/src/store.ts:5123](../../packages/store/src/store.ts#L5123) `Store/privilegeSets` | `Store.sql` (5123) | CORE |
| [packages/store/src/store.ts:5152](../../packages/store/src/store.ts#L5152) `Store/savePrivilegeSet` | `SQLite.prepare` (5152, 5160); `Store.sql` (5152, 5160) | AUTH |
| [packages/store/src/store.ts:5195](../../packages/store/src/store.ts#L5195) `Store/deletePrivilegeSet` | `SQLite.prepare` (5195); `Store.sql` (5195) | CORE |
| [packages/store/src/store.ts:5264](../../packages/store/src/store.ts#L5264) `Store/accountPrivilegeSet` | `SQLite.get` (5264); `SQLite.prepare` (5264); `Store.sql` (5264) | CORE |
| [packages/store/src/store.ts:5278](../../packages/store/src/store.ts#L5278) `Store/setAccountPrivilegeSet` | `SQLite.get` (5278); `SQLite.prepare` (5278, 5281, 5285); `Store.sql` (5278, 5281, 5285) | AUTH |
| [packages/store/src/store.ts:5300](../../packages/store/src/store.ts#L5300) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5300); `Store.sql` (5300) | CORE |
| [packages/store/src/store.ts:5314](../../packages/store/src/store.ts#L5314) `Store/addProvisionedAccount` | `SQLite.get` (5314); `SQLite.prepare` (5314, 5318); `Store.sql` (5314, 5318) | CORE |
| [packages/store/src/store.ts:5487](../../packages/store/src/store.ts#L5487) `Store/ruleOutcome` | `Calculations.context` (5487) | CORE |
| [packages/store/src/store.ts:5528](../../packages/store/src/store.ts#L5528) `Store/allowedIds` | `SQLite.iterate` (5528); `SQLite.prepare` (5528); `Store.sql` (5528) | CORE |
| [packages/store/src/store.ts:5598](../../packages/store/src/store.ts#L5598) `Store/scopedTableSql` | `Store.viewableIds` (5598); `SQLite.all` (5601); `SQLite.prepare` (5601); `Store.sql` (5601) | GATED-STORE |
| [packages/store/src/store.ts:5633](../../packages/store/src/store.ts#L5633) `Store/previewRecordRuleCurrent` | `SQLite.get` (5633); `SQLite.prepare` (5633, 5636); `Store.sql` (5633, 5636); `SQLite.all` (5636); `Calculations.context` (5642, 5658) | CORE |
| [packages/store/src/store.ts:5810](../../packages/store/src/store.ts#L5810) `Store/passwordHash` | `SQLite.get` (5810); `SQLite.prepare` (5810); `Store.sql` (5810) | CORE |
| [packages/store/src/store.ts:5839](../../packages/store/src/store.ts#L5839) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5839); `Store.sql` (5839) | CORE |
| [packages/store/src/store.ts:5852](../../packages/store/src/store.ts#L5852) `Store/knownSharedAccount` | `SQLite.get` (5852); `SQLite.prepare` (5852); `Store.sql` (5852) | CORE |
| [packages/store/src/store.ts:5915](../../packages/store/src/store.ts#L5915) `Store/layouts` | `SQLite.all` (5915); `SQLite.prepare` (5915); `Store.sql` (5915) | CORE |
| [packages/store/src/store.ts:5936](../../packages/store/src/store.ts#L5936) `Store/image` | `SQLite.get` (5936); `SQLite.prepare` (5936); `Store.sql` (5936) | CORE |
| [packages/store/src/store.ts:5946](../../packages/store/src/store.ts#L5946) `Store/images` | `SQLite.all` (5946); `SQLite.prepare` (5946); `Store.sql` (5946) | CORE |
| [packages/store/src/store.ts:5959](../../packages/store/src/store.ts#L5959) `Store/addImage` | `Store.sql` (5959, 5960); `SQLite.prepare` (5960) | CORE |
| [packages/store/src/store.ts:5976](../../packages/store/src/store.ts#L5976) `Store/layout` | `SQLite.get` (5976); `SQLite.prepare` (5976); `Store.sql` (5976) | CORE |
| [packages/store/src/store.ts:6180](../../packages/store/src/store.ts#L6180) `Store/wordIndex` | `Store.sql` (6180, 6188, 6193); `Store.recordCount` (6192); `SQLite.get` (6193); `SQLite.prepare` (6193) | CORE |
| [packages/store/src/store.ts:6245](../../packages/store/src/store.ts#L6245) `Store/toRecord` | `Calculations.value` (6245, 6255); `Calculations.globalValue` (6249); `Calculations.unstoredStyled` (6254) | CORE |
| [packages/store/src/store.ts:6304](../../packages/store/src/store.ts#L6304) `Store/relatedValues` | `Calculations.globalValue` (6304); `Calculations.unstoredValue` (6306) | CORE |
| [packages/store/src/store.ts:6378](../../packages/store/src/store.ts#L6378) `Store/addRelated` | `relatedRows` (6378); `rowsById` (6410); `firstRelatedEach` (6433) | CORE |
| [packages/store/src/store.ts:6461](../../packages/store/src/store.ts#L6461) `Store/foundSetPage` | `rowsById` (6461) | CORE |
| [packages/store/src/store.ts:6477](../../packages/store/src/store.ts#L6477) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6477); `Store.row` (6493) | GATED-STORE |
| [packages/store/src/store.ts:6516](../../packages/store/src/store.ts#L6516) `Store/portalCountsCurrent` | `Store.canView` (6516); `Store.row` (6543) | GATED-STORE |
| [packages/store/src/store.ts:6579](../../packages/store/src/store.ts#L6579) `Store/fieldIndexCurrent` | `SQLite.iterate` (6579); `SQLite.prepare` (6579, 6584); `Store.sql` (6579, 6584); `SQLite.all` (6584) | GATED-STORE |
| [packages/store/src/store.ts:6625](../../packages/store/src/store.ts#L6625) `Store/valueListItemsCurrent` | `Store.valueListItems` (6625); `Store.get` (6639); `relatedRows` (6640); `Store.row` (6640); `SQLite.iterate` (6642); `SQLite.prepare` (6642); `Store.sql` (6642); `Calculations.related` (6652); `Calculations.value` (6656, 6657) | GATED-STORE |
| [packages/store/src/store.ts:6754](../../packages/store/src/store.ts#L6754) `Store/portalRows` | `relatedRows` (6754); `relatedIdList` (6755); `Store.viewableIds` (6758); `rowsById` (6783, 6821); `Calculations.related` (6797) | CORE |
| [packages/store/src/store.ts:6765](../../packages/store/src/store.ts#L6765) `Store/portalRows/context` | `Calculations.context` (6765) | CORE |
| [packages/store/src/store.ts:6775](../../packages/store/src/store.ts#L6775) `Store/portalRows/valueOf` | `Calculations.value` (6775) | CORE |
| [packages/store/src/store.ts:6892](../../packages/store/src/store.ts#L6892) `Store/markRepeating` | `SQLite.prepare` (6892); `Store.sql` (6892) | CORE |
| [packages/store/src/store.ts:6919](../../packages/store/src/store.ts#L6919) `Store/externalContainerCheck` | `SQLite.all` (6919); `SQLite.prepare` (6919); `Store.sql` (6919) | CORE |
| [packages/store/src/store.ts:6926](../../packages/store/src/store.ts#L6926) `Store/externalContainerCount` | `SQLite.get` (6926); `SQLite.prepare` (6926); `Store.sql` (6926) | CORE |
| [packages/store/src/store.ts:6935](../../packages/store/src/store.ts#L6935) `Store/externalContainerReport` | `SQLite.all` (6935, 6948); `SQLite.prepare` (6935, 6948); `Store.sql` (6935, 6948) | CORE |
| [packages/store/src/store.ts:7084](../../packages/store/src/store.ts#L7084) `Store/orphanContainerReport` | `SQLite.all` (7084); `SQLite.prepare` (7084); `Store.sql` (7084) | CORE |
| [packages/store/src/store.ts:7119](../../packages/store/src/store.ts#L7119) `Store/purgeOrphanContainers` | `Store.sql` (7119, 7123, 7132, 7135, 7136, 7141, 7142, 7144, 7144); `Store.orphanContainerReport` (7127); `SQLite.get` (7132); `SQLite.prepare` (7132, 7135, 7136) | CORE |
| [packages/store/src/store.ts:7157](../../packages/store/src/store.ts#L7157) `Store/containerIntact` | `SQLite.get` (7157); `SQLite.prepare` (7157); `Store.sql` (7157) | CORE |
| [packages/store/src/store.ts:7167](../../packages/store/src/store.ts#L7167) `Store/externalOf` | `SQLite.get` (7167); `SQLite.prepare` (7167); `Store.sql` (7167) | CORE |
| [packages/store/src/store.ts:7171](../../packages/store/src/store.ts#L7171) `Store/containerMeta` | `SQLite.get` (7171); `SQLite.prepare` (7171); `Store.sql` (7171) | CORE |
| [packages/store/src/store.ts:7176](../../packages/store/src/store.ts#L7176) `Store/container` | `SQLite.get` (7176); `SQLite.prepare` (7176, 7185); `Store.sql` (7176, 7185); `SQLite.all` (7185) | CORE |
| [packages/store/src/store.ts:7193](../../packages/store/src/store.ts#L7193) `Store/containerInfo` | `SQLite.get` (7193); `SQLite.prepare` (7193); `Store.sql` (7193) | CORE |
| [packages/store/src/store.ts:7227](../../packages/store/src/store.ts#L7227) `Store/containerRange` | `SQLite.all` (7227); `SQLite.prepare` (7227, 7234); `Store.sql` (7227, 7234); `SQLite.get` (7234) | CORE |
| [packages/store/src/store.ts:7252](../../packages/store/src/store.ts#L7252) `Store/addContainer` | `SQLite.all` (7252); `SQLite.prepare` (7252, 7257, 7271, 7275, 7276); `Store.sql` (7252, 7257, 7271, 7273, 7275, 7276, 7278, 7281); `SQLite.get` (7262); `Store.containerRange` (7264) | CORE |
| [packages/store/src/store.ts:7298](../../packages/store/src/store.ts#L7298) `Store/addExternalContainer` | `SQLite.prepare` (7298); `Store.sql` (7298) | CORE |
| [packages/store/src/store.ts:7316](../../packages/store/src/store.ts#L7316) `Store/writeExternalFile` | `Store.evaluateEach` (7316); `SQLite.prepare` (7339); `Store.sql` (7339) | CORE |
| [packages/store/src/store.ts:7340](../../packages/store/src/store.ts#L7340) `Store/writeExternalFile/taken` | `SQLite.get` (7340) | CORE |
| [packages/store/src/store.ts:7370](../../packages/store/src/store.ts#L7370) `Store/embeddedContainers` | `SQLite.prepare` (7370, 7371); `Store.sql` (7370, 7371); `SQLite.all` (7371); `SQLite.get` (7375) | CORE |
| [packages/store/src/store.ts:7384](../../packages/store/src/store.ts#L7384) `Store/embeddedContainerCount` | `SQLite.prepare` (7384); `Store.sql` (7384); `SQLite.get` (7385) | CORE |
| [packages/store/src/store.ts:7393](../../packages/store/src/store.ts#L7393) `Store/recoverContainersOut` | `SQLite.prepare` (7393); `Store.sql` (7393); `SQLite.get` (7396) | CORE |
| [packages/store/src/store.ts:7421](../../packages/store/src/store.ts#L7421) `Store/moveContainersOut` | `Store.sql` (7421, 7429, 7431, 7433, 7438, 7439, 7459, 7465, 7467, 7469, 7469, 7475, 7475, 7480, 7482, 7484, 7484, 7490); `SQLite.get` (7429); `SQLite.prepare` (7429, 7438, 7439); `Store.container` (7441) | CORE |
| [packages/store/src/store.ts:7499](../../packages/store/src/store.ts#L7499) `Store/moveContainersIn` | `Store.sql` (7499, 7505, 7507, 7508, 7509, 7510, 7530, 7535, 7535, 7546, 7549, 7552, 7559); `SQLite.prepare` (7507, 7508, 7509, 7510, 7546, 7552); `SQLite.get` (7512, 7546, 7552) | CORE |
| [packages/store/src/store.ts:7571](../../packages/store/src/store.ts#L7571) `Store/compactFile` | `Store.sql` (7571, 7572, 7574) | CORE |
| [packages/store/src/store.ts:7580](../../packages/store/src/store.ts#L7580) `Store/containerId` | `Store.containerId` (7580); `Store.row` (7581) | CORE |
| [packages/store/src/store.ts:7603](../../packages/store/src/store.ts#L7603) `Store/checkContainerWrite` | `Store.row` (7603) | CORE |
| [packages/store/src/store.ts:7616](../../packages/store/src/store.ts#L7616) `Store/setContainer` | `Store.sql` (7616, 7630, 7635, 7638, 7638); `Store.row` (7619); `SQLite.prepare` (7630) | CORE |
| [packages/store/src/store.ts:7672](../../packages/store/src/store.ts#L7672) `Store/orderBy` | `Store.valueListItems` (7672) | CORE |
| [packages/store/src/store.ts:7695](../../packages/store/src/store.ts#L7695) `Store/userPrefs` | `SQLite.all` (7695); `SQLite.prepare` (7695); `Store.sql` (7695) | CORE |
| [packages/store/src/store.ts:7700](../../packages/store/src/store.ts#L7700) `Store/hasTable` | `SQLite.get` (7700); `SQLite.prepare` (7700); `Store.sql` (7700) | CORE |
| [packages/store/src/store.ts:7704](../../packages/store/src/store.ts#L7704) `Store/setUserPref` | `Store.sql` (7704, 7705, 7706); `SQLite.prepare` (7705, 7706) | CORE |
| [packages/store/src/store.ts:7712](../../packages/store/src/store.ts#L7712) `Store/indexedFields` | `SQLite.all` (7712, 7713); `SQLite.prepare` (7712, 7713); `Store.sql` (7712, 7713) | CORE |
| [packages/store/src/store.ts:7734](../../packages/store/src/store.ts#L7734) `Store/addFieldIndex` | `Store.sql` (7734) | CORE |
| [packages/store/src/store.ts:7746](../../packages/store/src/store.ts#L7746) `Store/dropFieldIndex` | `SQLite.get` (7746); `SQLite.prepare` (7746); `Store.sql` (7746, 7747) | CORE |
| [packages/store/src/store.ts:7757](../../packages/store/src/store.ts#L7757) `Store/timeFind` | `Store.query` (7757, 7761, 7762); `Store.recordCount` (7764) | CORE |
| [packages/store/src/store.ts:7781](../../packages/store/src/store.ts#L7781) `Store/find` | `Store.find` (7781) | GATED-STORE |
| [packages/store/src/store.ts:7792](../../packages/store/src/store.ts#L7792) `Store/findHere` | `Store.query` (7792, 7797, 7799, 7813, 7815, 7825); `Store.recordCount` (7810); `SQLite.get` (7811, 7815); `SQLite.prepare` (7811, 7815, 7820, 7827, 7836); `Store.sql` (7811, 7815, 7820, 7827, 7836); `SQLite.all` (7820, 7827, 7836) | GATED-STORE |
| [packages/store/src/store.ts:7831](../../packages/store/src/store.ts#L7831) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7831); `SQLite.prepare` (7831); `Store.sql` (7831) | GATED-STORE |
| [packages/store/src/store.ts:7864](../../packages/store/src/store.ts#L7864) `Store/sortedPage` | `SQLite.iterate` (7864); `SQLite.prepare` (7864, 7879); `Store.sql` (7864, 7879); `SQLite.all` (7879) | CORE |
| [packages/store/src/store.ts:7936](../../packages/store/src/store.ts#L7936) `Store/relatedCriteria/matched` | `relatedRows` (7936) | CORE |
| [packages/store/src/store.ts:7939](../../packages/store/src/store.ts#L7939) `Store/relatedCriteria` | `SQLite.iterate` (7939); `SQLite.prepare` (7939); `Store.sql` (7939) | CORE |
| [packages/store/src/store.ts:7965](../../packages/store/src/store.ts#L7965) `Store/computedRows` | `Store.sql` (7965, 7968, 7969, 7970, 7972, 7982, 7983, 7984, 7987); `SQLite.prepare` (7968, 7970, 7972, 7982); `SQLite.iterate` (7972); `Calculations.globalValue` (7975); `Calculations.unstoredValue` (7976); `Calculations.related` (7979); `SQLite.all` (7982) | CORE |
| [packages/store/src/store.ts:8012](../../packages/store/src/store.ts#L8012) `Store/summaries` | `Calculations.wholeTable` (8012); `Calculations.collect` (8032, 8037) | CORE |
| [packages/store/src/store.ts:8028](../../packages/store/src/store.ts#L8028) `Store/summaries/recs` | `SQLite.iterate` (8028); `SQLite.prepare` (8028); `Store.sql` (8028) | CORE |
| [packages/store/src/store.ts:8050](../../packages/store/src/store.ts#L8050) `Store/runningSummaryValues` | `Store.viewableIds` (8050); `rowsById` (8052); `Calculations.value` (8063, 8069); `Calculations.related` (8080) | GATED-STORE |
| [packages/store/src/store.ts:8096](../../packages/store/src/store.ts#L8096) `Store/findSource` | `Store.query` (8096); `SQLite.all` (8105, 8122); `SQLite.prepare` (8105, 8113, 8121); `Store.sql` (8105, 8110, 8113, 8118, 8121, 8135, 8137); `Calculations.globalValue` (8127); `Calculations.unstoredValue` (8128); `Calculations.related` (8132) | CORE |
| [packages/store/src/store.ts:8152](../../packages/store/src/store.ts#L8152) `Store/findCandidates` | `Store.query` (8152) | CORE |
| [packages/store/src/store.ts:8187](../../packages/store/src/store.ts#L8187) `Store/previewRow` | `Store.row` (8187) | CORE |
| [packages/store/src/store.ts:8205](../../packages/store/src/store.ts#L8205) `Store/row` | `SQLite.get` (8205) | CORE |
| [packages/store/src/store.ts:8224](../../packages/store/src/store.ts#L8224) `Store/getCurrent` | `Store.get` (8224); `Store.row` (8225, 8225, 8239); `SQLite.all` (8242); `SQLite.prepare` (8242); `Store.sql` (8242) | GATED-STORE |
| [packages/store/src/store.ts:8262](../../packages/store/src/store.ts#L8262) `Store/getManyCurrent` | `Store.getMany` (8262); `SQLite.get` (8280); `SQLite.prepare` (8280); `Store.sql` (8280) | GATED-STORE |
| [packages/store/src/store.ts:8273](../../packages/store/src/store.ts#L8273) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8273) | GATED-STORE |
| [packages/store/src/store.ts:8296](../../packages/store/src/store.ts#L8296) `Store/canViewRecord` | `SQLite.get` (8296); `SQLite.prepare` (8296); `Store.sql` (8296) | GATED-STORE |
| [packages/store/src/store.ts:8304](../../packages/store/src/store.ts#L8304) `Store/canView` | `Store.canView` (8304); `Store.row` (8305) | GATED-STORE |
| [packages/store/src/store.ts:8329](../../packages/store/src/store.ts#L8329) `Store/create` | `SQLite.get` (8329, 8335); `SQLite.prepare` (8329, 8335, 8348); `Store.sql` (8329, 8335, 8348) | CORE |
| [packages/store/src/store.ts:8372](../../packages/store/src/store.ts#L8372) `Store/duplicate` | `Store.row` (8372); `SQLite.get` (8376); `SQLite.prepare` (8376, 8391); `Store.sql` (8376, 8391) | CORE |
| [packages/store/src/store.ts:8436](../../packages/store/src/store.ts#L8436) `Store/update` | `Store.row` (8436, 8443, 8454); `Store.sql` (8467, 8468, 8507, 8510) | CORE |
| [packages/store/src/store.ts:8470](../../packages/store/src/store.ts#L8470) `Store/update/undo` | `Store.sql` (8470) | CORE |
| [packages/store/src/store.ts:8614](../../packages/store/src/store.ts#L8614) `Store/setStoredCalcValues` | `SQLite.prepare` (8614, 8615); `Store.sql` (8614, 8615); `SQLite.get` (8619) | CORE |
| [packages/store/src/store.ts:8693](../../packages/store/src/store.ts#L8693) `Store/evaluateCurrent` | `Store.row` (8693, 8693); `Calculations.context` (8698); `Store.get` (8699, 8701) | GATED-STORE |
| [packages/store/src/store.ts:8733](../../packages/store/src/store.ts#L8733) `Store/evaluateEachCurrent` | `Store.row` (8733, 8733); `Calculations.context` (8738); `Store.get` (8740) | GATED-STORE |
| [packages/store/src/store.ts:8773](../../packages/store/src/store.ts#L8773) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8773); `Store.get` (8775) | GATED-STORE |
| [packages/store/src/store.ts:8794](../../packages/store/src/store.ts#L8794) `Store/evaluateRowsCurrent` | `Store.row` (8794, 8794) | GATED-STORE |
| [packages/store/src/store.ts:8808](../../packages/store/src/store.ts#L8808) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8808) | GATED-STORE |
| [packages/store/src/store.ts:8830](../../packages/store/src/store.ts#L8830) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8830) | GATED-STORE |
| [packages/store/src/store.ts:8868](../../packages/store/src/store.ts#L8868) `Store/updateRelated` | `relatedRows` (8868) | CORE |
| [packages/store/src/store.ts:8886](../../packages/store/src/store.ts#L8886) `Store/updatePortals` | `Store.row` (8886, 8921); `relatedRows` (8922) | CORE |
| [packages/store/src/store.ts:8895](../../packages/store/src/store.ts#L8895) `Store/updatePortals/portal/related` | `relatedIdList` (8895) | CORE |
| [packages/store/src/store.ts:8977](../../packages/store/src/store.ts#L8977) `Store/portalContainerTarget` | `Store.row` (8977); `relatedIdList` (8978) | CORE |
| [packages/store/src/store.ts:8991](../../packages/store/src/store.ts#L8991) `Store/checkEditable` | `Store.row` (8991) | CORE |
| [packages/store/src/store.ts:9014](../../packages/store/src/store.ts#L9014) `Store/delete` | `Store.row` (9014) | CORE |
| [packages/store/src/store.ts:9022](../../packages/store/src/store.ts#L9022) `Store/delete/run` | `SQLite.get` (9022); `SQLite.prepare` (9022, 9026); `Store.sql` (9022, 9026) | CORE |
| [packages/store/src/store.ts:9248](../../packages/store/src/store.ts#L9248) `Store/keyStepWork` | `Store.sql` (9248, 9254, 9258, 9260) | CORE |
| [packages/store/src/store.ts:9051](../../packages/store/src/store.ts#L9051) `Store/vaultHeld` | `SQLite.get` (9051); `SQLite.prepare` (9051); `Store.sql` (9051) | CORE |
| [packages/store/src/store.ts:9058](../../packages/store/src/store.ts#L9058) `Store/forgetStandInValues` | `Store.sql` (9058, 9079); `SQLite.prepare` (9079) | CORE |
| [packages/store/src/store.ts:9098](../../packages/store/src/store.ts#L9098) `Store/restoreDeletedRowLocked` | `SQLite.get` (9098); `SQLite.prepare` (9098, 9099, 9103); `Store.sql` (9098, 9099, 9103); `SQLite.all` (9099) | CORE |
| [packages/store/src/store.ts:9301](../../packages/store/src/store.ts#L9301) `Store/cascadeDelete` | `relatedRows` (9301) | CORE |
| [packages/store/src/store.ts:9391](../../packages/store/src/store.ts#L9391) `Store/selectIdsCurrent` | `Store.selectIds` (9391); `SQLite.all` (9397); `SQLite.prepare` (9397); `Store.sql` (9397) | GATED-STORE |
| [packages/store/src/store.ts:9405](../../packages/store/src/store.ts#L9405) `Store/countIds` | `Store.countIds` (9405); `SQLite.get` (9409); `SQLite.prepare` (9409); `Store.sql` (9409) | GATED-STORE |
| [packages/store/src/store.ts:9425](../../packages/store/src/store.ts#L9425) `Store/computeValuesCurrent` | `Store.computeValues` (9425); `Store.sql` (9431, 9435); `SQLite.all` (9435); `SQLite.prepare` (9435) | GATED-STORE |
| [packages/store/src/store.ts:9450](../../packages/store/src/store.ts#L9450) `Store/findIdsCurrent` | `Store.findIds` (9450) | GATED-STORE |
| [packages/store/src/store.ts:9456](../../packages/store/src/store.ts#L9456) `Store/findIdsHere` | `Store.query` (9456, 9461, 9463); `SQLite.iterate` (9474); `SQLite.prepare` (9474); `Store.sql` (9474) | GATED-STORE |
| [packages/store/src/store.ts:9491](../../packages/store/src/store.ts#L9491) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9491); `Store.viewableIds` (9496); `Calculations.collect` (9512); `rowsById` (9512, 9562); `Calculations.collector` (9534) | GATED-STORE |
| [packages/store/src/store.ts:9524](../../packages/store/src/store.ts#L9524) `Store/groupSummariesCurrent/key` | `Calculations.value` (9524); `Calculations.related` (9526) | GATED-STORE |
| [packages/store/src/store.ts:9560](../../packages/store/src/store.ts#L9560) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9560) | GATED-STORE |
| [packages/store/src/store.ts:9616](../../packages/store/src/store.ts#L9616) `Store/sortIdsCurrentProgress` | `SQLite.all` (9616); `SQLite.prepare` (9616, 9684); `Store.sql` (9616, 9684); `Store.valueListItems` (9624); `rowsById` (9636); `Calculations.globalValue` (9639); `Calculations.unstoredValue` (9640); `Calculations.related` (9646); `SQLite.iterate` (9684) | GATED-STORE |
| [packages/store/src/store.ts:9698](../../packages/store/src/store.ts#L9698) `Store/matchIds` | `Store.matchIds` (9698); `SQLite.all` (9704); `SQLite.prepare` (9704); `Store.sql` (9704) | CORE |
| [packages/store/src/store.ts:9725](../../packages/store/src/store.ts#L9725) `Store/truncate/run` | `Store.sql` (9725, 9727, 9734, 9736, 9738, 9739); `SQLite.prepare` (9727, 9734); `SQLite.all` (9729) | CORE |
| [packages/store/src/store.ts:9763](../../packages/store/src/store.ts#L9763) `Store/iterateCommitted` | `SQLite.iterate` (9763) | CORE |
| [packages/store/src/store.ts:9797](../../packages/store/src/store.ts#L9797) `Store/readOnlyChecked` | `SQLite.prepare` (9797, 9801, 9810, 9815); `SQLite.all` (9801, 9810, 9815) | CORE |
| [packages/store/src/store.ts:9837](../../packages/store/src/store.ts#L9837) `Store/refreshDecimalSqlViews` | `SQLite.get` (9837); `SQLite.prepare` (9837, 9842); `SQLite.all` (9842) | CORE |
| [packages/store/src/store.ts:9856](../../packages/store/src/store.ts#L9856) `Store/internalRoots` | `SQLite.get` (9856); `SQLite.prepare` (9856, 9858); `SQLite.all` (9858) | CORE |
| [packages/store/src/store.ts:9891](../../packages/store/src/store.ts#L9891) `Store/selectCurrent` | `SQLite.iterate` (9891) | CORE |
| [packages/store/src/store.ts:9940](../../packages/store/src/store.ts#L9940) `Store/query` | `SQLite.iterate` (9940) | CORE |
| [packages/store/src/store.ts:9974](../../packages/store/src/store.ts#L9974) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9974); `SQLite.all` (9981, 9984); `SQLite.prepare` (9981, 9984) | CORE |
| [packages/store/src/store.ts:1201](../../packages/store/src/store.ts#L1201) `Store/ensureNativeIds` | `SQLite.all` (1201, 1213); `SQLite.prepare` (1201, 1204, 1212, 1213); `Store.sql` (1201, 1204, 1207, 1211, 1212, 1213, 1216, 1218) | CORE |
| [packages/store/src/store.ts:1226](../../packages/store/src/store.ts#L1226) `Store/nativeIdGuards` | `Store.sql` (1226, 1227, 1229) | CORE |
| [packages/store/src/store.ts:9907](../../packages/store/src/store.ts#L9907) `Store/selectIn` | `Store.select` (9907) | CORE |
| [packages/store/src/store.ts:9915](../../packages/store/src/store.ts#L9915) `Store/selectHeldCurrent` | `Store.sql` (9915, 9916); `SQLite.prepare` (9916); `SQLite.iterate` (9919) | CORE |
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
| [packages/store/src/store.ts:1572](../../packages/store/src/store.ts#L1572) `Store/selfContainedCopy` | `Store.sql` (1572); `SQLite.all` (1577); `SQLite.prepare` (1577, 1579, 1580, 1581) | CORE |
| [packages/store/src/store.ts:6998](../../packages/store/src/store.ts#L6998) `Store/containerReferences` | `SQLite.all` (6998, 7017, 7019, 7025, 7038, 7049, 7063); `SQLite.prepare` (6998, 7017, 7019, 7025, 7038, 7049, 7061, 7063); `Store.sql` (6998, 7017, 7019, 7025, 7038, 7049, 7061, 7063); `SQLite.get` (7061); `Store.row` (7072) | CORE |
| [packages/store/src/store.ts:7096](../../packages/store/src/store.ts#L7096) `Store/containerIntegrityReport` | `SQLite.all` (7096); `SQLite.prepare` (7096, 7107); `Store.sql` (7096, 7107); `SQLite.get` (7107) | CORE |
| [packages/server/src/compaction.ts:65](../../packages/server/src/compaction.ts#L65) `compactStore` | `SQLite.get` (65, 66, 80, 88); `SQLite.prepare` (65, 66, 80, 88) | OPERATOR |
<!-- end generated read-gate inventory -->
