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
| [packages/cli/src/main.ts:673](../../packages/cli/src/main.ts#L673) `accountsWithPasswordOff` | `SQLite.all` (673); `SQLite.prepare` (673) | OPERATOR |
| [packages/cli/src/main.ts:702](../../packages/cli/src/main.ts#L702) `hostedRead` | `SQLite.all` (702, 705); `SQLite.prepare` (702, 705); `Store.sql` (702, 705) | OPERATOR |
| [packages/cli/src/main.ts:2300](../../packages/cli/src/main.ts#L2300) `main` | `Store.orphanContainerReport` (2300); `Store.auditLog` (2763); `SQLite.get` (2979); `SQLite.prepare` (2979) | OPERATOR |
| [packages/scripts/src/data-api-step.ts:103](../../packages/scripts/src/data-api-step.ts#L103) `respond` | `Store.get` (103, 130, 139); `Store.find` (104, 116) | SCRIPT |
| [packages/scripts/src/engine.ts:1940](../../packages/scripts/src/engine.ts#L1940) `ScriptEngine/goToLayout` | `Store.findIds` (1940) | SCRIPT |
| [packages/scripts/src/engine.ts:2284](../../packages/scripts/src/engine.ts#L2284) `ScriptEngine/foundSet` | `Store.findIds` (2284) | SCRIPT |
| [packages/scripts/src/engine.ts:2349](../../packages/scripts/src/engine.ts#L2349) `ScriptEngine/semanticFind` | `Store.findIds` (2349, 2370) | SCRIPT |
| [packages/scripts/src/engine.ts:3263](../../packages/scripts/src/engine.ts#L3263) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3263); `Calculations.executeSQL` (3270) | SCRIPT |
| [packages/scripts/src/engine.ts:3320](../../packages/scripts/src/engine.ts#L3320) `ScriptEngine/sortIds` | `Store.sortIds` (3320); `Store.valueListItems` (3326) | SCRIPT |
| [packages/scripts/src/engine.ts:3417](../../packages/scripts/src/engine.ts#L3417) `ScriptEngine/revertTransaction` | `Store.findIds` (3417) | SCRIPT |
| [packages/scripts/src/engine.ts:3965](../../packages/scripts/src/engine.ts#L3965) `ScriptEngine/step` | `Store.fieldIndex` (3965); `Store.findIds` (4099, 4198) | SCRIPT |
| [packages/scripts/src/engine.ts:5219](../../packages/scripts/src/engine.ts#L5219) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5219) | SCRIPT |
| [packages/scripts/src/engine.ts:5227](../../packages/scripts/src/engine.ts#L5227) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5227) | SCRIPT |
| [packages/scripts/src/engine.ts:5228](../../packages/scripts/src/engine.ts#L5228) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5228) | SCRIPT |
| [packages/scripts/src/engine.ts:5381](../../packages/scripts/src/engine.ts#L5381) `ScriptEngine/get` | `Store.findIds` (5381); `Store.canViewRecord` (5472); `Store.get` (5508) | SCRIPT |
| [packages/scripts/src/engine.ts:5539](../../packages/scripts/src/engine.ts#L5539) `ScriptEngine/design` | `Store.valueListItems` (5539) | SCRIPT |
| [packages/scripts/src/engine.ts:5593](../../packages/scripts/src/engine.ts#L5593) `ScriptEngine/record` | `Store.get` (5593) | SCRIPT |
| [packages/scripts/src/engine.ts:5625](../../packages/scripts/src/engine.ts#L5625) `ScriptEngine/valueOf` | `Store.findIds` (5625); `Store.containerId` (5633) | SCRIPT |
| [packages/scripts/src/engine.ts:5650](../../packages/scripts/src/engine.ts#L5650) `ScriptEngine/lookupNext` | `Store.get` (5650); `Store.row` (5651); `Calculations.context` (5653) | SCRIPT |
| [packages/scripts/src/engine.ts:5753](../../packages/scripts/src/engine.ts#L5753) `ScriptEngine/relatedIds` | `Store.findIds` (5753); `rowsById` (5761); `Store.select` (5765); `Store.matchIds` (5779); `Store.viewableIds` (5802) | SCRIPT |
| [packages/scripts/src/engine.ts:5787](../../packages/scripts/src/engine.ts#L5787) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5787) | SCRIPT |
| [packages/scripts/src/engine.ts:6276](../../packages/scripts/src/engine.ts#L6276) `ScriptEngine/exportField` | `Store.get` (6276); `Store.containerId` (6277); `Store.container` (6279) | SCRIPT |
| [packages/scripts/src/engine.ts:6427](../../packages/scripts/src/engine.ts#L6427) `ScriptEngine/relookup` | `Store.get` (6427) | SCRIPT |
| [packages/scripts/src/engine.ts:6847](../../packages/scripts/src/engine.ts#L6847) `ScriptEngine/goToList` | `Store.findIds` (6847) | SCRIPT |
| [packages/scripts/src/engine.ts:7176](../../packages/scripts/src/engine.ts#L7176) `ScriptEngine/sourceValue` | `Store.get` (7176); `Store.containerId` (7177); `Store.container` (7178) | SCRIPT |
| [packages/scripts/src/engine.ts:7911](../../packages/scripts/src/engine.ts#L7911) `ScriptEngine/containerFile` | `Store.get` (7911); `Store.containerId` (7912); `Store.container` (7913) | SCRIPT |
| [packages/scripts/src/engine.ts:8073](../../packages/scripts/src/engine.ts#L8073) `ScriptEngine/importRecords` | `Store.findIds` (8073); `Store.get` (8093) | SCRIPT |
| [packages/scripts/src/engine.ts:8304](../../packages/scripts/src/engine.ts#L8304) `ScriptEngine/fileMakerRows` | `Store.findIds` (8304); `Store.get` (8309) | SCRIPT |
| [packages/scripts/src/engine.ts:8344](../../packages/scripts/src/engine.ts#L8344) `ScriptEngine/newRecord` | `Store.findIds` (8344) | SCRIPT |
| [packages/scripts/src/engine.ts:8649](../../packages/scripts/src/engine.ts#L8649) `ScriptEngine/performFind` | `Store.findIds` (8649) | SCRIPT |
| [packages/scripts/src/engine.ts:8674](../../packages/scripts/src/engine.ts#L8674) `ScriptEngine/findRelated` | `Store.findIds` (8674, 8684, 8687) | SCRIPT |
| [packages/scripts/src/engine.ts:8706](../../packages/scripts/src/engine.ts#L8706) `ScriptEngine/quickFind` | `Store.findIds` (8706, 8707, 8710) | SCRIPT |
| [packages/scripts/src/engine.ts:9094](../../packages/scripts/src/engine.ts#L9094) `clearRecords` | `SQLite.all` (9094); `SQLite.prepare` (9094) | SCRIPT |
| [packages/scripts/src/recorder.ts:83](../../packages/scripts/src/recorder.ts#L83) `lastSeq` | `Store.auditLog` (83) | DESIGN |
| [packages/scripts/src/recorder.ts:121](../../packages/scripts/src/recorder.ts#L121) `recordRun` | `Store.auditLog` (121) | DESIGN |
| [packages/scripts/src/script-tests.ts:213](../../packages/scripts/src/script-tests.ts#L213) `runCase` | `Store.findIds` (213); `Store.auditLog` (220, 221, 265); `Store.evaluateEach` (248) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/server/src/admin.ts:977](../../packages/server/src/admin.ts#L977) `Admin/handle` | `Store.externalContainerReport` (977); `Store.orphanContainerReport` (982, 986) | ADMIN |
| [packages/server/src/admin.ts:2142](../../packages/server/src/admin.ts#L2142) `Admin/audit` | `Store.auditLog` (2142) | ADMIN |
| [packages/server/src/admin.ts:2225](../../packages/server/src/admin.ts#L2225) `Admin/viewAs` | `Store.find` (2225) | ADMIN |
| [packages/server/src/admin.ts:2573](../../packages/server/src/admin.ts#L2573) `Admin/status` | `Store.externalContainerCount` (2573) | ADMIN |
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
| [packages/server/src/automations.ts:447](../../packages/server/src/automations.ts#L447) `AutomationRunner/run` | `Store.select` (447); `Store.canViewRecord` (457); `Store.evaluateEach` (460); `Store.evaluate` (466) | AUTOMATION |
| [packages/server/src/automations.ts:490](../../packages/server/src/automations.ts#L490) `AutomationRunner/runDeleted` | `Store.auditLog` (490) | AUTOMATION |
| [packages/server/src/backup-verify.ts:148](../../packages/server/src/backup-verify.ts#L148) `testRestore` | `Store.recordCount` (148) | OPERATOR |
| [packages/server/src/backup-verify.ts:188](../../packages/server/src/backup-verify.ts#L188) `integrity` | `SQLite.all` (188); `SQLite.prepare` (188, 192); `SQLite.get` (192) | OPERATOR |
| [packages/server/src/backup-verify.ts:218](../../packages/server/src/backup-verify.ts#L218) `pageCheck` | `SQLite.all` (218); `SQLite.prepare` (218, 221); `SQLite.get` (221) | OPERATOR |
| [packages/server/src/backup.ts:988](../../packages/server/src/backup.ts#L988) `accountDifferences/read` | `SQLite.all` (988, 990); `SQLite.prepare` (988, 990) | OPERATOR |
| [packages/server/src/backup.ts:1015](../../packages/server/src/backup.ts#L1015) `readNames` | `SQLite.all` (1015); `SQLite.prepare` (1015) | OPERATOR |
| [packages/server/src/backup.ts:1045](../../packages/server/src/backup.ts#L1045) `credentialsReadable` | `SQLite.all` (1045); `SQLite.prepare` (1045) | OPERATOR |
| [packages/server/src/backup.ts:1061](../../packages/server/src/backup.ts#L1061) `columnInfo` | `SQLite.all` (1061); `SQLite.prepare` (1061) | OPERATOR |
| [packages/server/src/backup.ts:1096](../../packages/server/src/backup.ts#L1096) `reconcileCredentials` | `SQLite.all` (1096, 1118, 1133, 1143, 1149); `SQLite.prepare` (1096, 1104, 1118, 1120, 1133, 1134, 1141, 1143, 1144, 1149, 1150, 1154, 1155, 1156); `SQLite.get` (1104, 1154) | OPERATOR |
| [packages/server/src/backup.ts:1099](../../packages/server/src/backup.ts#L1099) `reconcileCredentials/has` | `SQLite.all` (1099); `SQLite.prepare` (1099) | OPERATOR |
| [packages/server/src/backup.ts:1123](../../packages/server/src/backup.ts#L1123) `reconcileCredentials/accountColumns` | `SQLite.all` (1123); `SQLite.prepare` (1123) | OPERATOR |
| [packages/server/src/backup.ts:1268](../../packages/server/src/backup.ts#L1268) `stageRestorePoint` | `SQLite.get` (1268, 1270, 1271); `SQLite.prepare` (1268, 1270, 1271) | OPERATOR |
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
| [packages/server/src/containers.ts:124](../../packages/server/src/containers.ts#L124) `ContainerFiles/send` | `Store.containerInfo` (124); `Store.container` (191); `Store.containerRange` (200) | CONTAINER |
| [packages/server/src/containers.ts:290](../../packages/server/src/containers.ts#L290) `ContainerFiles/make` | `Store.containerInfo` (290) | CONTAINER |
| [packages/server/src/containers.ts:302](../../packages/server/src/containers.ts#L302) `ContainerFiles/makeAdmitted` | `Store.container` (302) | CONTAINER |
| [packages/server/src/conversion-guide.ts:118](../../packages/server/src/conversion-guide.ts#L118) `convertedAt` | `SQLite.get` (118); `SQLite.prepare` (118); `Store.sql` (118) | DESIGN |
| [packages/server/src/conversion-guide.ts:337](../../packages/server/src/conversion-guide.ts#L337) `ConversionGuides/table` | `Store.sql` (337) | DESIGN |
| [packages/server/src/conversion-guide.ts:347](../../packages/server/src/conversion-guide.ts#L347) `ConversionGuides/saved` | `SQLite.get` (347); `SQLite.prepare` (347); `Store.sql` (347) | DESIGN |
| [packages/server/src/conversion-guide.ts:353](../../packages/server/src/conversion-guide.ts#L353) `ConversionGuides/save` | `SQLite.prepare` (353); `Store.sql` (353) | DESIGN |
| [packages/server/src/conversion.ts:299](../../packages/server/src/conversion.ts#L299) `conversionReport` | `Store.externalContainerCheck` (299) | DESIGN |
| [packages/server/src/cwp-xml.ts:457](../../packages/server/src/cwp-xml.ts#L457) `CwpXmlEndpoint/records` | `Store.find` (457, 459, 460, 466, 469); `Store.get` (465, 473) | XML |
| [packages/server/src/cwp-xml.ts:541](../../packages/server/src/cwp-xml.ts#L541) `CwpXmlEndpoint/layoutDoc` | `Store.valueListItems` (541) | XML |
| [packages/server/src/dashboards.ts:327](../../packages/server/src/dashboards.ts#L327) `Dashboards/table` | `Store.sql` (327) | DASHBOARD |
| [packages/server/src/dashboards.ts:337](../../packages/server/src/dashboards.ts#L337) `Dashboards/list` | `SQLite.all` (337); `SQLite.prepare` (337); `Store.sql` (337) | DASHBOARD |
| [packages/server/src/dashboards.ts:343](../../packages/server/src/dashboards.ts#L343) `Dashboards/get` | `SQLite.get` (343); `SQLite.prepare` (343); `Store.sql` (343) | DASHBOARD |
| [packages/server/src/dashboards.ts:357](../../packages/server/src/dashboards.ts#L357) `Dashboards/create` | `SQLite.prepare` (357); `Store.sql` (357) | DASHBOARD |
| [packages/server/src/dashboards.ts:370](../../packages/server/src/dashboards.ts#L370) `Dashboards/update` | `SQLite.prepare` (370); `Store.sql` (370) | DASHBOARD |
| [packages/server/src/dashboards.ts:377](../../packages/server/src/dashboards.ts#L377) `Dashboards/delete` | `SQLite.prepare` (377); `Store.sql` (377) | DASHBOARD |
| [packages/server/src/dataapi.ts:1912](../../packages/server/src/dataapi.ts#L1912) `DataApi/route` | `Store.get` (1912, 2134, 2157, 2165, 2212, 2236, 2256, 2293); `Store.valueListItems` (1927); `Store.find` (2089, 2136, 2326); `Store.findIds` (2093, 2331); `Store.query` (2331) | REST |
| [packages/server/src/dataapi.ts:2041](../../packages/server/src/dataapi.ts#L2041) `DataApi/route/recordOut` | `Store.portalCounts` (2041) | REST |
| [packages/server/src/dataapi.ts:2077](../../packages/server/src/dataapi.ts#L2077) `DataApi/route/shownAs` | `Store.get` (2077) | REST |
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
| [packages/server/src/logs.ts:77](../../packages/server/src/logs.ts#L77) `LogShipper/follow` | `SQLite.get` (77); `SQLite.prepare` (77); `Store.sql` (77, 78, 79, 80) | ADMIN |
| [packages/server/src/logs.ts:89](../../packages/server/src/logs.ts#L89) `LogShipper/releaseIfIdle` | `Store.sql` (89) | ADMIN |
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
| [packages/server/src/oauth.ts:190](../../packages/server/src/oauth.ts#L190) `OAuthServer/constructor` | `SQLite.all` (190); `SQLite.prepare` (190, 217, 219, 222, 223, 226); `SQLite.iterate` (217); `SQLite.get` (219); `Store.sql` (219, 222) | AUTH |
| [packages/server/src/oauth.ts:357](../../packages/server/src/oauth.ts#L357) `OAuthServer/register` | `SQLite.prepare` (357, 358, 359, 360, 361); `SQLite.get` (358, 360) | AUTH |
| [packages/server/src/oauth.ts:377](../../packages/server/src/oauth.ts#L377) `OAuthServer/client` | `SQLite.get` (377); `SQLite.prepare` (377) | AUTH |
| [packages/server/src/oauth.ts:478](../../packages/server/src/oauth.ts#L478) `OAuthServer/authorize/done` | `SQLite.prepare` (478, 479) | AUTH |
| [packages/server/src/oauth.ts:497](../../packages/server/src/oauth.ts#L497) `OAuthServer/authorize` | `SQLite.get` (497); `SQLite.prepare` (497, 501, 503, 510, 533, 534) | AUTH |
| [packages/server/src/oauth.ts:689](../../packages/server/src/oauth.ts#L689) `OAuthServer/token` | `SQLite.get` (689, 720, 722, 725, 738); `SQLite.prepare` (689, 720, 722, 725, 734, 737, 738, 738, 740, 742) | AUTH |
| [packages/server/src/oauth.ts:823](../../packages/server/src/oauth.ts#L823) `OAuthServer/sweep` | `SQLite.all` (823); `SQLite.prepare` (823, 825, 826, 827, 828) | AUTH |
| [packages/server/src/oauth.ts:875](../../packages/server/src/oauth.ts#L875) `OAuthServer/revoke` | `SQLite.get` (875, 876, 886, 887); `SQLite.prepare` (875, 876, 879, 886, 887, 891) | AUTH |
| [packages/server/src/oauth.ts:860](../../packages/server/src/oauth.ts#L860) `OAuthServer/managedAccess` | `SQLite.get` (860); `SQLite.prepare` (860) | AUTH |
| [packages/server/src/oauth.ts:864](../../packages/server/src/oauth.ts#L864) `OAuthServer/accessAllowed` | `SQLite.get` (864); `SQLite.prepare` (864) | AUTH |
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
| [packages/store/src/calc.ts:306](../../packages/store/src/calc.ts#L306) `Calculations/meta` | `SQLite.get` (306); `SQLite.prepare` (306); `Store.sql` (306) | CALC |
| [packages/store/src/calc.ts:311](../../packages/store/src/calc.ts#L311) `Calculations/saveMeta` | `SQLite.prepare` (311); `Store.sql` (311) | CALC |
| [packages/store/src/calc.ts:324](../../packages/store/src/calc.ts#L324) `Calculations/globalValue` | `SQLite.get` (324); `SQLite.prepare` (324); `Store.sql` (324) | CALC |
| [packages/store/src/calc.ts:348](../../packages/store/src/calc.ts#L348) `Calculations/setNextSerial` | `Store.sql` (348, 349, 355, 357, 357) | CALC |
| [packages/store/src/calc.ts:495](../../packages/store/src/calc.ts#L495) `Calculations/value` | `Calculations.globalValue` (495) | CALC |
| [packages/store/src/calc.ts:530](../../packages/store/src/calc.ts#L530) `Calculations/computed` | `Calculations.context` (530) | CALC |
| [packages/store/src/calc.ts:545](../../packages/store/src/calc.ts#L545) `Calculations/unstoredValue` | `Calculations.unstoredStyled` (545); `Calculations.value` (545) | CALC |
| [packages/store/src/calc.ts:583](../../packages/store/src/calc.ts#L583) `Calculations/allRecords` | `SQLite.iterate` (583); `SQLite.prepare` (583); `Store.sql` (583) | CALC |
| [packages/store/src/calc.ts:594](../../packages/store/src/calc.ts#L594) `Calculations/collect` | `Calculations.collector` (594) | CALC |
| [packages/store/src/calc.ts:601](../../packages/store/src/calc.ts#L601) `Calculations/summaryInput` | `Calculations.value` (601) | CALC |
| [packages/store/src/calc.ts:625](../../packages/store/src/calc.ts#L625) `Calculations/collector/add` | `Calculations.related` (625) | CALC |
| [packages/store/src/calc.ts:638](../../packages/store/src/calc.ts#L638) `Calculations/foundSummary` | `Calculations.collect` (638) | CALC |
| [packages/store/src/calc.ts:649](../../packages/store/src/calc.ts#L649) `Calculations/summary` | `Calculations.collect` (649) | CALC |
| [packages/store/src/calc.ts:656](../../packages/store/src/calc.ts#L656) `Calculations/tableSummary` | `Calculations.wholeTable` (656) | CALC |
| [packages/store/src/calc.ts:711](../../packages/store/src/calc.ts#L711) `Calculations/globalsKey` | `Calculations.globalValue` (711) | CALC |
| [packages/store/src/calc.ts:886](../../packages/store/src/calc.ts#L886) `Calculations/summaryDependencies` | `Store.sql` (886) | CALC |
| [packages/store/src/calc.ts:925](../../packages/store/src/calc.ts#L925) `Calculations/wholeTable` | `rowsById` (925); `Store.viewableIds` (925); `Calculations.collect` (927, 1017); `Calculations.value` (988); `Store.sql` (996, 1004) | CALC |
| [packages/store/src/calc.ts:1178](../../packages/store/src/calc.ts#L1178) `Calculations/applyDelta/value` | `Calculations.value` (1178) | CALC |
| [packages/store/src/calc.ts:1250](../../packages/store/src/calc.ts#L1250) `Calculations/storedRows` | `SQLite.iterate` (1250); `SQLite.prepare` (1250); `Store.sql` (1250) | CALC |
| [packages/store/src/calc.ts:1302](../../packages/store/src/calc.ts#L1302) `Calculations/relatedRecs` | `Calculations.relatedIds` (1302); `Store.viewableIds` (1307); `rowsById` (1313) | CALC |
| [packages/store/src/calc.ts:1324](../../packages/store/src/calc.ts#L1324) `Calculations/firstRelated` | `Calculations.related` (1324, 1336, 1351); `Store.viewableIds` (1331); `Calculations.relatedIds` (1334, 1347); `Calculations.statement` (1344); `SQLite.get` (1344) | CALC |
| [packages/store/src/calc.ts:1358](../../packages/store/src/calc.ts#L1358) `Calculations/rowById` | `Calculations.statement` (1358); `SQLite.get` (1358) | CALC |
| [packages/store/src/calc.ts:1369](../../packages/store/src/calc.ts#L1369) `Calculations/relatedIds` | `Calculations.related` (1369, 1399, 1413); `rowsById` (1383, 1410); `Calculations.statement` (1394); `SQLite.all` (1394) | CALC |
| [packages/store/src/calc.ts:1476](../../packages/store/src/calc.ts#L1476) `Calculations/joinHop` | `Calculations.statement` (1476, 1478); `SQLite.get` (1476); `SQLite.iterate` (1478) | CALC |
| [packages/store/src/calc.ts:1503](../../packages/store/src/calc.ts#L1503) `Calculations/storedRelatedValues` | `Calculations.statement` (1503); `SQLite.iterate` (1503) | CALC |
| [packages/store/src/calc.ts:1522](../../packages/store/src/calc.ts#L1522) `Calculations/passStamp` | `Store.sql` (1522) | CALC |
| [packages/store/src/calc.ts:1532](../../packages/store/src/calc.ts#L1532) `Calculations/lookup` | `Store.sql` (1532) | CALC |
| [packages/store/src/calc.ts:1571](../../packages/store/src/calc.ts#L1571) `Calculations/foundSums` | `Store.sql` (1571) | CALC |
| [packages/store/src/calc.ts:1634](../../packages/store/src/calc.ts#L1634) `Calculations/hopQuery` | `Calculations.value` (1634) | CALC |
| [packages/store/src/calc.ts:1667](../../packages/store/src/calc.ts#L1667) `Calculations/columnNames` | `SQLite.all` (1667); `SQLite.prepare` (1667); `Store.sql` (1667) | CALC |
| [packages/store/src/calc.ts:1678](../../packages/store/src/calc.ts#L1678) `Calculations/statement` | `SQLite.prepare` (1678); `Store.sql` (1678) | CALC |
| [packages/store/src/calc.ts:1692](../../packages/store/src/calc.ts#L1692) `Calculations/ensureIndex` | `Store.sql` (1692, 1693) | CALC |
| [packages/store/src/calc.ts:1718](../../packages/store/src/calc.ts#L1718) `Calculations/context/records` | `Calculations.firstRelated` (1718) | CALC |
| [packages/store/src/calc.ts:1736](../../packages/store/src/calc.ts#L1736) `Calculations/context/field` | `Calculations.summary` (1736); `Calculations.globalValue` (1739); `Calculations.value` (1740) | CALC |
| [packages/store/src/calc.ts:1749](../../packages/store/src/calc.ts#L1749) `Calculations/context/related` | `Calculations.globalValue` (1749); `Calculations.value` (1751, 1762); `Calculations.related` (1764) | CALC |
| [packages/store/src/calc.ts:1784](../../packages/store/src/calc.ts#L1784) `Calculations/context/lookupNext` | `Store.canViewRecord` (1784) | CALC |
| [packages/store/src/calc.ts:1799](../../packages/store/src/calc.ts#L1799) `Calculations/context/summary` | `Calculations.value` (1799, 1809); `Calculations.related` (1811); `Calculations.summary` (1829) | CALC |
| [packages/store/src/calc.ts:1859](../../packages/store/src/calc.ts#L1859) `Calculations/context/get` | `Store.recordCount` (1859, 1863); `Calculations.statement` (1862); `SQLite.get` (1862) | CALC |
| [packages/store/src/calc.ts:1882](../../packages/store/src/calc.ts#L1882) `Calculations/context/executeSQL` | `Calculations.executeSQL` (1882) | CALC |
| [packages/store/src/calc.ts:1883](../../packages/store/src/calc.ts#L1883) `Calculations/context/persistentData` | `Store.persistentData` (1883) | CALC |
| [packages/store/src/calc.ts:1884](../../packages/store/src/calc.ts#L1884) `Calculations/context/persistentDataIds` | `Store.persistentDataIds` (1884) | CALC |
| [packages/store/src/calc.ts:1909](../../packages/store/src/calc.ts#L1909) `Calculations/design` | `Store.valueListItems` (1909) | CALC |
| [packages/store/src/calc.ts:1926](../../packages/store/src/calc.ts#L1926) `Calculations/executeSQL` | `Calculations.translateSQL` (1926); `Store.select` (1964); `Store.sql` (1975) | CALC |
| [packages/store/src/calc.ts:2080](../../packages/store/src/calc.ts#L2080) `Calculations/translateSQL` | `Store.scopedTableSql` (2080, 2111) | CALC |
| [packages/store/src/calc.ts:2143](../../packages/store/src/calc.ts#L2143) `Calculations/shareColumn` | `Store.recordCount` (2143) | CALC |
| [packages/store/src/calc.ts:2175](../../packages/store/src/calc.ts#L2175) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2175) | CALC |
| [packages/store/src/calc.ts:2212](../../packages/store/src/calc.ts#L2212) `Calculations/computeColumn` | `Calculations.statement` (2212); `SQLite.get` (2212); `Calculations.value` (2215) | CALC |
| [packages/store/src/calc.ts:2349](../../packages/store/src/calc.ts#L2349) `Calculations/beforeWrite` | `relatedRows` (2349); `Calculations.related` (2403); `Calculations.context` (2416) | CORE |
| [packages/store/src/calc.ts:2467](../../packages/store/src/calc.ts#L2467) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2467); `Calculations.value` (2467) | CALC |
| [packages/store/src/calc.ts:2481](../../packages/store/src/calc.ts#L2481) `Calculations/computeStoredStyled` | `Calculations.context` (2481) | CORE |
| [packages/store/src/calc.ts:2521](../../packages/store/src/calc.ts#L2521) `Calculations/validate/fail` | `Calculations.context` (2521) | CALC |
| [packages/store/src/calc.ts:2535](../../packages/store/src/calc.ts#L2535) `Calculations/validate` | `Calculations.value` (2535); `Store.valueListItems` (2556); `Calculations.context` (2570) | CALC |
| [packages/store/src/calc.ts:2632](../../packages/store/src/calc.ts#L2632) `nearest` | `SQLite.get` (2632); `SQLite.prepare` (2632); `Store.sql` (2632) | CALC |
| [packages/store/src/calc.ts:2718](../../packages/store/src/calc.ts#L2718) `containerValue` | `Store.containerInfo` (2718); `Store.containerRange` (2725); `Store.container` (2726) | CALC |
| [packages/store/src/calc.ts:2734](../../packages/store/src/calc.ts#L2734) `containerValue/read` | `Store.container` (2734) | CALC |
| [packages/store/src/calc.ts:2747](../../packages/store/src/calc.ts#L2747) `containerValue/value` | `Store.containerRange` (2747) | CALC |
| [packages/store/src/calc.ts:2865](../../packages/store/src/calc.ts#L2865) `sameValuesElsewhere` | `SQLite.all` (2865); `SQLite.prepare` (2865, 2872, 2874); `Store.sql` (2865, 2872, 2874); `Calculations.value` (2867); `SQLite.get` (2872, 2874) | CALC |
| [packages/store/src/calc.ts:3178](../../packages/store/src/calc.ts#L3178) `rowsById/flush` | `Calculations.statement` (3178); `SQLite.iterate` (3178) | CALC |
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
| [packages/store/src/store.ts:870](../../packages/store/src/store.ts#L870) `Store/metadataVersions` | `SQLite.get` (870); `SQLite.prepare` (870); `Store.sql` (870) | CORE |
| [packages/store/src/store.ts:1008](../../packages/store/src/store.ts#L1008) `Store/constructor` | `Store.sql` (1008, 1010, 1012, 1013, 1017, 1021, 1022, 1033, 1038, 1043, 1044, 1048, 1049, 1050, 1057, 1061, 1065, 1066, 1067, 1072, 1076, 1079, 1080, 1082, 1083, 1086, 1087, 1091, 1092, 1096, 1097, 1100, 1102, 1105, 1106, 1110, 1111, 1115, 1116, 1119, 1120, 1121, 1124, 1125, 1128, 1129, 1131, 1131, 1132, 1132, 1133, 1136, 1140, 1142, 1145, 1146, 1147, 1150, 1151, 1153, 1155, 1156, 1160, 1161, 1163, 1167, 1168, 1169, 1169, 1173, 1174); `SQLite.get` (1012); `SQLite.prepare` (1012, 1079, 1080, 1083, 1086, 1091, 1096, 1105, 1110, 1115, 1124, 1128, 1131, 1132, 1150, 1155, 1160); `SQLite.all` (1079, 1086, 1091, 1096, 1105, 1110, 1115, 1124, 1128, 1131, 1132, 1150, 1155, 1160) | CORE |
| [packages/store/src/store.ts:1231](../../packages/store/src/store.ts#L1231) `Store/grantFullAccessClients` | `SQLite.prepare` (1231); `Store.sql` (1231) | CORE |
| [packages/store/src/store.ts:1248](../../packages/store/src/store.ts#L1248) `Store/meta` | `SQLite.get` (1248); `SQLite.prepare` (1248); `Store.sql` (1248) | CORE |
| [packages/store/src/store.ts:1256](../../packages/store/src/store.ts#L1256) `Store/persistentTable` | `Store.sql` (1256) | CORE |
| [packages/store/src/store.ts:1266](../../packages/store/src/store.ts#L1266) `Store/persistentData` | `SQLite.get` (1266) | CORE |
| [packages/store/src/store.ts:1275](../../packages/store/src/store.ts#L1275) `Store/persistentDataIds` | `SQLite.all` (1275) | CORE |
| [packages/store/src/store.ts:1281](../../packages/store/src/store.ts#L1281) `Store/setPersistentData` | `SQLite.prepare` (1281, 1285); `Store.sql` (1281, 1285) | CORE |
| [packages/store/src/store.ts:1305](../../packages/store/src/store.ts#L1305) `Store/checkpoint` | `SQLite.get` (1305); `SQLite.prepare` (1305); `Store.sql` (1305) | CORE |
| [packages/store/src/store.ts:1313](../../packages/store/src/store.ts#L1313) `Store/recordedFormat` | `Store.sql` (1313) | CORE |
| [packages/store/src/store.ts:1323](../../packages/store/src/store.ts#L1323) `Store/close` | `Store.sql` (1323) | CORE |
| [packages/store/src/store.ts:1339](../../packages/store/src/store.ts#L1339) `Store/shipWal` | `Store.sql` (1339) | CORE |
| [packages/store/src/store.ts:1350](../../packages/store/src/store.ts#L1350) `Store/trial` | `Store.sql` (1350) | CORE |
| [packages/store/src/store.ts:1355](../../packages/store/src/store.ts#L1355) `Store/trial/undo` | `Store.sql` (1355) | CORE |
| [packages/store/src/store.ts:1390](../../packages/store/src/store.ts#L1390) `Store/joinTransaction` | `Store.sql` (1390, 1391, 1393, 1395, 1401) | CORE |
| [packages/store/src/store.ts:1413](../../packages/store/src/store.ts#L1413) `Store/independentWindowWrite` | `SQLite.get` (1413); `SQLite.prepare` (1413, 1436); `Store.sql` (1413, 1416, 1431, 1436, 1439) | CORE |
| [packages/store/src/store.ts:1461](../../packages/store/src/store.ts#L1461) `Store/withWriteTransaction` | `Store.sql` (1461, 1464, 1468, 1470, 1470) | CORE |
| [packages/store/src/store.ts:1500](../../packages/store/src/store.ts#L1500) `Store/endTransaction` | `Store.sql` (1500, 1503, 1503) | CORE |
| [packages/store/src/store.ts:1529](../../packages/store/src/store.ts#L1529) `Store/backup` | `Store.sql` (1529) | CORE |
| [packages/store/src/store.ts:1619](../../packages/store/src/store.ts#L1619) `Store/dataVersion` | `SQLite.get` (1619); `SQLite.prepare` (1619); `Store.sql` (1619) | CORE |
| [packages/store/src/store.ts:1659](../../packages/store/src/store.ts#L1659) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1659) | CORE |
| [packages/store/src/store.ts:1680](../../packages/store/src/store.ts#L1680) `Store/shareResults` | `Store.sql` (1680) | CORE |
| [packages/store/src/store.ts:1690](../../packages/store/src/store.ts#L1690) `Store/versionTriggers` | `SQLite.get` (1690); `SQLite.prepare` (1690, 1695, 1696); `Store.sql` (1690, 1692, 1693, 1695, 1696, 1705, 1706); `SQLite.all` (1695, 1696) | CORE |
| [packages/store/src/store.ts:1722](../../packages/store/src/store.ts#L1722) `Store/versionNumber` | `SQLite.get` (1722); `SQLite.prepare` (1722); `Store.sql` (1722) | CORE |
| [packages/store/src/store.ts:1735](../../packages/store/src/store.ts#L1735) `Store/changeOne` | `Store.sql` (1735, 1737) | CORE |
| [packages/store/src/store.ts:1738](../../packages/store/src/store.ts#L1738) `Store/changeOne/read` | `SQLite.get` (1738); `SQLite.prepare` (1738); `Store.sql` (1738) | CORE |
| [packages/store/src/store.ts:1777](../../packages/store/src/store.ts#L1777) `Store/writeToken` | `SQLite.get` (1777); `SQLite.prepare` (1777); `Store.sql` (1777) | CORE |
| [packages/store/src/store.ts:1789](../../packages/store/src/store.ts#L1789) `Store/recordCount` | `SQLite.get` (1789); `SQLite.prepare` (1789); `Store.sql` (1789) | CORE |
| [packages/store/src/store.ts:1901](../../packages/store/src/store.ts#L1901) `Store/applyDesign` | `Store.sql` (1901, 1902, 1915, 1918, 1923, 1937, 1940, 1940); `SQLite.prepare` (1918, 1923) | CORE |
| [packages/store/src/store.ts:1998](../../packages/store/src/store.ts#L1998) `Store/auditLog` | `SQLite.all` (1998); `SQLite.prepare` (1998); `Store.sql` (1998) | CORE |
| [packages/store/src/store.ts:2038](../../packages/store/src/store.ts#L2038) `Store/securityEvents` | `Store.auditLog` (2038) | CORE |
| [packages/store/src/store.ts:2064](../../packages/store/src/store.ts#L2064) `Store/prepared` | `SQLite.prepare` (2064); `Store.sql` (2064) | CORE |
| [packages/store/src/store.ts:2079](../../packages/store/src/store.ts#L2079) `Store/recordAsOf` | `SQLite.get` (2079, 2081); `SQLite.prepare` (2079, 2081, 2083, 2084); `Store.sql` (2079, 2081, 2083, 2084); `SQLite.all` (2083, 2084) | CORE |
| [packages/store/src/store.ts:2113](../../packages/store/src/store.ts#L2113) `Store/restoreRecord/run` | `Store.recordAsOf` (2113); `SQLite.get` (2117); `SQLite.prepare` (2117, 2121, 2130, 2141); `Store.sql` (2117, 2121, 2130, 2141) | CORE |
| [packages/store/src/store.ts:2157](../../packages/store/src/store.ts#L2157) `Store/revertAuditEntry` | `Store.auditLog` (2157) | CORE |
| [packages/store/src/store.ts:2250](../../packages/store/src/store.ts#L2250) `Store/setAuditSettings` | `SQLite.prepare` (2250); `Store.sql` (2250) | CORE |
| [packages/store/src/store.ts:2272](../../packages/store/src/store.ts#L2272) `Store/pruneAudit` | `Store.sql` (2272, 2274, 2276); `SQLite.get` (2274); `SQLite.prepare` (2274) | CORE |
| [packages/store/src/store.ts:2354](../../packages/store/src/store.ts#L2354) `Store/audit` | `Store.sql` (2354) | CORE |
| [packages/store/src/store.ts:2443](../../packages/store/src/store.ts#L2443) `Store/securityChange` | `Store.sql` (2443, 2445); `SQLite.prepare` (2445) | CORE |
| [packages/store/src/store.ts:2492](../../packages/store/src/store.ts#L2492) `Store/logSecurity` | `Store.sql` (2492) | CORE |
| [packages/store/src/store.ts:2515](../../packages/store/src/store.ts#L2515) `Store/ensureDeleted` | `Store.sql` (2515) | CORE |
| [packages/store/src/store.ts:2520](../../packages/store/src/store.ts#L2520) `Store/deletedRows` | `SQLite.get` (2520); `SQLite.prepare` (2520, 2522, 2522); `Store.sql` (2520, 2522, 2522); `SQLite.all` (2522, 2522) | CORE |
| [packages/store/src/store.ts:2546](../../packages/store/src/store.ts#L2546) `Store/emptyDeleted` | `Store.sql` (2546, 2549, 2550, 2552, 2554); `SQLite.prepare` (2550) | CORE |
| [packages/store/src/store.ts:2561](../../packages/store/src/store.ts#L2561) `Store/designHistory` | `SQLite.all` (2561); `SQLite.prepare` (2561); `Store.sql` (2561) | CORE |
| [packages/store/src/store.ts:2568](../../packages/store/src/store.ts#L2568) `Store/scriptHistory` | `SQLite.all` (2568); `SQLite.prepare` (2568); `Store.sql` (2568) | CORE |
| [packages/store/src/store.ts:2578](../../packages/store/src/store.ts#L2578) `Store/layoutHistory` | `SQLite.all` (2578); `SQLite.prepare` (2578); `Store.sql` (2578) | CORE |
| [packages/store/src/store.ts:2603](../../packages/store/src/store.ts#L2603) `Store/designEffect/renameKey` | `SQLite.prepare` (2603); `Store.sql` (2603) | CORE |
| [packages/store/src/store.ts:2619](../../packages/store/src/store.ts#L2619) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2619); `Store.sql` (2619) | CORE |
| [packages/store/src/store.ts:2626](../../packages/store/src/store.ts#L2626) `Store/designEffect` | `Store.sql` (2626, 2631, 2636, 2641, 2644, 2650, 2658, 2659, 2661, 2673, 2674, 2677, 2679, 2685, 2686, 2687, 2692, 2694, 2698, 2701, 2702, 2704, 2707, 2712, 2714, 2721, 2722, 2724, 2725, 2726, 2727, 2734, 2735, 2737, 2737, 2739, 2740, 2741, 2745, 2749, 2751, 2789, 2791, 2793); `SQLite.get` (2658, 2673, 2685, 2686, 2698, 2702, 2737, 2745); `SQLite.prepare` (2658, 2659, 2673, 2674, 2685, 2686, 2692, 2694, 2698, 2702, 2712, 2714, 2727, 2734, 2735, 2737, 2739, 2741, 2745, 2749); `SQLite.all` (2734, 2735); `SQLite.iterate` (2739) | CORE |
| [packages/store/src/store.ts:2801](../../packages/store/src/store.ts#L2801) `Store/dropColumnIndexes` | `SQLite.all` (2801, 2803); `SQLite.prepare` (2801, 2803); `Store.sql` (2801, 2803, 2804) | CORE |
| [packages/store/src/store.ts:2813](../../packages/store/src/store.ts#L2813) `Store/recompute` | `SQLite.prepare` (2813, 2817); `Store.sql` (2813, 2817); `SQLite.iterate` (2817); `Calculations.computeStoredStyled` (2818); `Calculations.value` (2818) | CORE |
| [packages/store/src/store.ts:2833](../../packages/store/src/store.ts#L2833) `Store/linkPrincipal` | `SQLite.get` (2833); `SQLite.prepare` (2833); `Store.sql` (2833) | CORE |
| [packages/store/src/store.ts:2840](../../packages/store/src/store.ts#L2840) `Store/linkIdentity` | `SQLite.get` (2840); `SQLite.prepare` (2840); `Store.sql` (2840) | CORE |
| [packages/store/src/store.ts:2846](../../packages/store/src/store.ts#L2846) `Store/accountsSharingLockout` | `SQLite.all` (2846); `SQLite.prepare` (2846); `Store.sql` (2846) | CORE |
| [packages/store/src/store.ts:2850](../../packages/store/src/store.ts#L2850) `Store/accounts` | `SQLite.all` (2850); `SQLite.prepare` (2850); `Store.sql` (2850) | CORE |
| [packages/store/src/store.ts:2862](../../packages/store/src/store.ts#L2862) `Store/isAgent` | `SQLite.get` (2862); `SQLite.prepare` (2862); `Store.sql` (2862) | CORE |
| [packages/store/src/store.ts:2868](../../packages/store/src/store.ts#L2868) `Store/agentNeedsApproval` | `SQLite.get` (2868); `SQLite.prepare` (2868); `Store.sql` (2868) | CORE |
| [packages/store/src/store.ts:2874](../../packages/store/src/store.ts#L2874) `Store/blankPasswordAccounts` | `SQLite.all` (2874); `SQLite.prepare` (2874); `Store.sql` (2874) | CORE |
| [packages/store/src/store.ts:1239](../../packages/store/src/store.ts#L1239) `Store/hasOwnPassword` | `SQLite.get` (1239); `SQLite.prepare` (1239); `Store.sql` (1239) | CORE |
| [packages/store/src/store.ts:2885](../../packages/store/src/store.ts#L2885) `Store/unmigratedAccounts` | `SQLite.all` (2885); `SQLite.prepare` (2885); `Store.sql` (2885) | CORE |
| [packages/store/src/store.ts:2938](../../packages/store/src/store.ts#L2938) `Store/setExternalAccount` | `SQLite.get` (2938); `SQLite.prepare` (2938, 2943); `Store.sql` (2938, 2943) | CORE |
| [packages/store/src/store.ts:2956](../../packages/store/src/store.ts#L2956) `Store/refuseLookalikeAccount` | `SQLite.all` (2956); `SQLite.prepare` (2956); `Store.sql` (2956) | CORE |
| [packages/store/src/store.ts:2965](../../packages/store/src/store.ts#L2965) `Store/isExternal` | `SQLite.get` (2965); `SQLite.prepare` (2965); `Store.sql` (2965) | CORE |
| [packages/store/src/store.ts:2986](../../packages/store/src/store.ts#L2986) `Store/setAgentAccount` | `SQLite.get` (2986); `SQLite.prepare` (2986, 2992); `Store.sql` (2986, 2992) | CORE |
| [packages/store/src/store.ts:3026](../../packages/store/src/store.ts#L3026) `Store/gateAgentWrite` | `SQLite.prepare` (3026); `Store.sql` (3026) | CORE |
| [packages/store/src/store.ts:3048](../../packages/store/src/store.ts#L3048) `Store/pendingChanges` | `SQLite.all` (3048); `SQLite.prepare` (3048); `Store.sql` (3048) | CORE |
| [packages/store/src/store.ts:3062](../../packages/store/src/store.ts#L3062) `Store/approvePending` | `SQLite.get` (3062); `SQLite.prepare` (3062, 3073); `Store.sql` (3062, 3073) | CORE |
| [packages/store/src/store.ts:3083](../../packages/store/src/store.ts#L3083) `Store/rejectPending` | `SQLite.get` (3083); `SQLite.prepare` (3083, 3085); `Store.sql` (3083, 3085) | CORE |
| [packages/store/src/store.ts:3105](../../packages/store/src/store.ts#L3105) `Store/externalAccount` | `SQLite.all` (3105); `SQLite.prepare` (3105); `Store.sql` (3105) | CORE |
| [packages/store/src/store.ts:3136](../../packages/store/src/store.ts#L3136) `Store/setPassword` | `SQLite.get` (3136); `SQLite.prepare` (3136, 3138, 3147); `Store.sql` (3136, 3138, 3147) | AUTH |
| [packages/store/src/store.ts:3161](../../packages/store/src/store.ts#L3161) `Store/createAccount` | `SQLite.get` (3161); `SQLite.prepare` (3161, 3165, 3171, 3176, 3181); `Store.sql` (3161, 3165, 3171, 3176, 3181) | CORE |
| [packages/store/src/store.ts:3189](../../packages/store/src/store.ts#L3189) `Store/appendSecurityEvent` | `Store.sql` (3189) | CORE |
| [packages/store/src/store.ts:3231](../../packages/store/src/store.ts#L3231) `Store/setPasswordPolicy` | `SQLite.prepare` (3231); `Store.sql` (3231) | CORE |
| [packages/store/src/store.ts:3267](../../packages/store/src/store.ts#L3267) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3267); `Store.sql` (3267) | CORE |
| [packages/store/src/store.ts:3290](../../packages/store/src/store.ts#L3290) `Store/saveScriptTest` | `SQLite.prepare` (3290); `Store.sql` (3290) | CORE |
| [packages/store/src/store.ts:3299](../../packages/store/src/store.ts#L3299) `Store/deleteScriptTest` | `SQLite.prepare` (3299); `Store.sql` (3299) | CORE |
| [packages/store/src/store.ts:3334](../../packages/store/src/store.ts#L3334) `Store/setAiAllowed` | `SQLite.prepare` (3334); `Store.sql` (3334) | CORE |
| [packages/store/src/store.ts:3380](../../packages/store/src/store.ts#L3380) `Store/setAiPolicy` | `SQLite.prepare` (3380); `Store.sql` (3380) | CORE |
| [packages/store/src/store.ts:3349](../../packages/store/src/store.ts#L3349) `Store/setScriptNetwork` | `SQLite.prepare` (3349); `Store.sql` (3349) | CORE |
| [packages/store/src/store.ts:3369](../../packages/store/src/store.ts#L3369) `Store/setWebViewerHosts` | `SQLite.prepare` (3369); `Store.sql` (3369) | CORE |
| [packages/store/src/store.ts:3400](../../packages/store/src/store.ts#L3400) `Store/setPiiIsolation` | `SQLite.prepare` (3400); `Store.sql` (3400) | CORE |
| [packages/store/src/store.ts:3422](../../packages/store/src/store.ts#L3422) `Store/markPiiField` | `SQLite.prepare` (3422); `Store.sql` (3422) | CORE |
| [packages/store/src/store.ts:3536](../../packages/store/src/store.ts#L3536) `Store/lastSignIns` | `Store.auditLog` (3536) | CORE |
| [packages/store/src/store.ts:3739](../../packages/store/src/store.ts#L3739) `Store/unusualAccess` | `Store.auditLog` (3739, 3805) | CORE |
| [packages/store/src/store.ts:3836](../../packages/store/src/store.ts#L3836) `Store/leastPrivilege` | `SQLite.all` (3836); `SQLite.prepare` (3836); `Store.sql` (3836) | CORE |
| [packages/store/src/store.ts:3909](../../packages/store/src/store.ts#L3909) `Store/unusedAccess` | `SQLite.get` (3909); `SQLite.prepare` (3909, 3918); `Store.sql` (3909, 3918); `SQLite.all` (3918) | CORE |
| [packages/store/src/store.ts:3957](../../packages/store/src/store.ts#L3957) `Store/unusedObjects` | `SQLite.get` (3957); `SQLite.prepare` (3957, 3960); `Store.sql` (3957, 3960); `SQLite.all` (3960) | CORE |
| [packages/store/src/store.ts:3995](../../packages/store/src/store.ts#L3995) `Store/usageCounting` | `SQLite.get` (3995); `SQLite.prepare` (3995); `Store.sql` (3995) | CORE |
| [packages/store/src/store.ts:4003](../../packages/store/src/store.ts#L4003) `Store/setMustChangePassword` | `SQLite.prepare` (4003); `Store.sql` (4003) | CORE |
| [packages/store/src/store.ts:4017](../../packages/store/src/store.ts#L4017) `Store/mustChangePassword` | `SQLite.get` (4017); `SQLite.prepare` (4017); `Store.sql` (4017) | CORE |
| [packages/store/src/store.ts:4056](../../packages/store/src/store.ts#L4056) `Store/passwordDaysRemaining` | `SQLite.get` (4056); `SQLite.prepare` (4056); `Store.sql` (4056) | CORE |
| [packages/store/src/store.ts:4063](../../packages/store/src/store.ts#L4063) `Store/importAccounts` | `SQLite.all` (4063); `SQLite.prepare` (4063); `Store.sql` (4063) | CORE |
| [packages/store/src/store.ts:4086](../../packages/store/src/store.ts#L4086) `Store/canonicalAccount` | `SQLite.all` (4086); `SQLite.prepare` (4086); `Store.sql` (4086) | CORE |
| [packages/store/src/store.ts:4098](../../packages/store/src/store.ts#L4098) `Store/createLocalAccount` | `SQLite.prepare` (4098); `Store.sql` (4098) | CORE |
| [packages/store/src/store.ts:4128](../../packages/store/src/store.ts#L4128) `Store/previewAccountImport` | `Store.sql` (4128, 4129, 4138) | CORE |
| [packages/store/src/store.ts:4146](../../packages/store/src/store.ts#L4146) `Store/limitAccountImport` | `SQLite.prepare` (4146, 4147, 4150); `Store.sql` (4146, 4147, 4150); `SQLite.get` (4147) | CORE |
| [packages/store/src/store.ts:4157](../../packages/store/src/store.ts#L4157) `Store/applyAccountImport` | `Store.sql` (4157, 4165, 4194); `SQLite.get` (4165); `SQLite.prepare` (4165, 4194) | CORE |
| [packages/store/src/store.ts:4219](../../packages/store/src/store.ts#L4219) `Store/forgetStandIns` | `SQLite.prepare` (4219); `Store.sql` (4219) | CORE |
| [packages/store/src/store.ts:4252](../../packages/store/src/store.ts#L4252) `Store/deleteAccount` | `SQLite.prepare` (4252, 4253, 4254, 4256, 4260); `Store.sql` (4252, 4253, 4254, 4256, 4260) | CORE |
| [packages/store/src/store.ts:4277](../../packages/store/src/store.ts#L4277) `Store/setAccountActive` | `SQLite.prepare` (4277, 4280, 4281); `Store.sql` (4277, 4280, 4281) | AUTH |
| [packages/store/src/store.ts:4291](../../packages/store/src/store.ts#L4291) `Store/accountInactive` | `SQLite.get` (4291); `SQLite.prepare` (4291); `Store.sql` (4291) | CORE |
| [packages/store/src/store.ts:4296](../../packages/store/src/store.ts#L4296) `Store/identityAllowed` | `SQLite.get` (4296, 4302, 4308); `SQLite.prepare` (4296, 4302, 4308); `Store.sql` (4296, 4302, 4308) | CORE |
| [packages/store/src/store.ts:4316](../../packages/store/src/store.ts#L4316) `Store/externalIdentityId` | `SQLite.get` (4316, 4322); `SQLite.prepare` (4316, 4321, 4322); `Store.sql` (4316, 4321, 4322) | CORE |
| [packages/store/src/store.ts:4327](../../packages/store/src/store.ts#L4327) `Store/accountIdentityId` | `SQLite.get` (4327, 4332); `SQLite.prepare` (4327, 4331, 4332); `Store.sql` (4327, 4331, 4332) | CORE |
| [packages/store/src/store.ts:4355](../../packages/store/src/store.ts#L4355) `Store/signInMark` | `SQLite.prepare` (4355); `Store.sql` (4355) | AUTH |
| [packages/store/src/store.ts:4365](../../packages/store/src/store.ts#L4365) `Store/signInBase` | `SQLite.get` (4365); `SQLite.prepare` (4365); `Store.sql` (4365) | AUTH |
| [packages/store/src/store.ts:4367](../../packages/store/src/store.ts#L4367) `Store/signInBase/identity` | `SQLite.get` (4367); `SQLite.prepare` (4367); `Store.sql` (4367) | AUTH |
| [packages/store/src/store.ts:4379](../../packages/store/src/store.ts#L4379) `Store/ledgerRow` | `SQLite.get` (4379, 4380); `SQLite.prepare` (4379, 4380); `Store.sql` (4379, 4380) | AUTH |
| [packages/store/src/store.ts:4391](../../packages/store/src/store.ts#L4391) `Store/ledgerWrite` | `Store.sql` (4391, 4392, 4394, 4396, 4399, 4399) | AUTH |
| [packages/store/src/store.ts:4418](../../packages/store/src/store.ts#L4418) `Store/settleSignIns` | `SQLite.all` (4418, 4424); `SQLite.prepare` (4418, 4424, 4430, 4434, 4436); `Store.sql` (4418, 4424, 4430, 4434, 4436) | AUTH |
| [packages/store/src/store.ts:4447](../../packages/store/src/store.ts#L4447) `Store/securityToken` | `SQLite.get` (4447); `SQLite.prepare` (4447); `Store.sql` (4447) | CORE |
| [packages/store/src/store.ts:4455](../../packages/store/src/store.ts#L4455) `Store/accountLocalOnly` | `SQLite.get` (4455); `SQLite.prepare` (4455); `Store.sql` (4455) | CORE |
| [packages/store/src/store.ts:4460](../../packages/store/src/store.ts#L4460) `Store/accountRequires2fa` | `SQLite.get` (4460); `SQLite.prepare` (4460); `Store.sql` (4460) | CORE |
| [packages/store/src/store.ts:4466](../../packages/store/src/store.ts#L4466) `Store/setAccountLocalOnly` | `SQLite.prepare` (4466); `Store.sql` (4466) | CORE |
| [packages/store/src/store.ts:4475](../../packages/store/src/store.ts#L4475) `Store/setAccountRequire2fa` | `SQLite.prepare` (4475); `Store.sql` (4475) | CORE |
| [packages/store/src/store.ts:4504](../../packages/store/src/store.ts#L4504) `Store/createApiToken` | `SQLite.get` (4504); `SQLite.prepare` (4504, 4534); `Store.sql` (4504, 4534) | CORE |
| [packages/store/src/store.ts:4581](../../packages/store/src/store.ts#L4581) `Store/recordObjectUse` | `Store.sql` (4581) | CORE |
| [packages/store/src/store.ts:4611](../../packages/store/src/store.ts#L4611) `Store/writeUsage` | `Store.sql` (4611, 4612, 4614, 4618, 4620) | CORE |
| [packages/store/src/store.ts:4627](../../packages/store/src/store.ts#L4627) `Store/writeUsageRows` | `SQLite.prepare` (4627, 4628, 4634); `Store.sql` (4627, 4628, 4634) | CORE |
| [packages/store/src/store.ts:4639](../../packages/store/src/store.ts#L4639) `Store/writeObjectUseRows` | `SQLite.prepare` (4639, 4640, 4645); `Store.sql` (4639, 4640, 4645) | CORE |
| [packages/store/src/store.ts:4650](../../packages/store/src/store.ts#L4650) `Store/objectUseSince` | `SQLite.get` (4650); `SQLite.prepare` (4650); `Store.sql` (4650) | CORE |
| [packages/store/src/store.ts:4663](../../packages/store/src/store.ts#L4663) `Store/accountUsage` | `SQLite.get` (4663); `SQLite.prepare` (4663, 4664); `Store.sql` (4663, 4664); `SQLite.all` (4664); `Store.auditLog` (4680) | CORE |
| [packages/store/src/store.ts:4696](../../packages/store/src/store.ts#L4696) `Store/apiTokens` | `SQLite.all` (4696); `SQLite.prepare` (4696); `Store.sql` (4696) | CORE |
| [packages/store/src/store.ts:4706](../../packages/store/src/store.ts#L4706) `Store/revokeApiToken` | `SQLite.prepare` (4706); `Store.sql` (4706) | CORE |
| [packages/store/src/store.ts:4720](../../packages/store/src/store.ts#L4720) `Store/apiToken` | `SQLite.get` (4720); `SQLite.prepare` (4720, 4732); `Store.sql` (4720, 4732) | CORE |
| [packages/store/src/store.ts:4748](../../packages/store/src/store.ts#L4748) `Store/enrollTotp` | `SQLite.prepare` (4748); `Store.sql` (4748) | CORE |
| [packages/store/src/store.ts:4759](../../packages/store/src/store.ts#L4759) `Store/confirmTotp` | `SQLite.get` (4759); `SQLite.prepare` (4759, 4761); `Store.sql` (4759, 4761) | CORE |
| [packages/store/src/store.ts:4769](../../packages/store/src/store.ts#L4769) `Store/hasTotp` | `SQLite.get` (4769); `SQLite.prepare` (4769); `Store.sql` (4769) | CORE |
| [packages/store/src/store.ts:4774](../../packages/store/src/store.ts#L4774) `Store/totpAccounts` | `SQLite.all` (4774); `SQLite.prepare` (4774); `Store.sql` (4774) | CORE |
| [packages/store/src/store.ts:4780](../../packages/store/src/store.ts#L4780) `Store/disableTotp` | `SQLite.prepare` (4780); `Store.sql` (4780) | CORE |
| [packages/store/src/store.ts:4803](../../packages/store/src/store.ts#L4803) `Store/verifyTotp` | `SQLite.get` (4803); `SQLite.prepare` (4803, 4809); `Store.sql` (4803, 4809) | CORE |
| [packages/store/src/store.ts:4822](../../packages/store/src/store.ts#L4822) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4822, 4824, 4825, 4827); `Store.sql` (4822, 4824, 4825, 4827); `SQLite.get` (4824) | CORE |
| [packages/store/src/store.ts:4874](../../packages/store/src/store.ts#L4874) `Store/passkeyAllowList` | `SQLite.all` (4874); `SQLite.prepare` (4874); `Store.sql` (4874) | CORE |
| [packages/store/src/store.ts:4888](../../packages/store/src/store.ts#L4888) `Store/takeWebauthnChallenge` | `SQLite.get` (4888); `SQLite.prepare` (4888, 4890); `Store.sql` (4888, 4890) | CORE |
| [packages/store/src/store.ts:4898](../../packages/store/src/store.ts#L4898) `Store/passkeys` | `SQLite.all` (4898); `SQLite.prepare` (4898); `Store.sql` (4898) | CORE |
| [packages/store/src/store.ts:4905](../../packages/store/src/store.ts#L4905) `Store/hasPasskey` | `SQLite.get` (4905); `SQLite.prepare` (4905); `Store.sql` (4905) | CORE |
| [packages/store/src/store.ts:4910](../../packages/store/src/store.ts#L4910) `Store/passkeyIds` | `SQLite.all` (4910); `SQLite.prepare` (4910); `Store.sql` (4910) | CORE |
| [packages/store/src/store.ts:4932](../../packages/store/src/store.ts#L4932) `Store/registerPasskey` | `SQLite.prepare` (4932); `Store.sql` (4932) | CORE |
| [packages/store/src/store.ts:4943](../../packages/store/src/store.ts#L4943) `Store/removePasskey` | `SQLite.get` (4943); `SQLite.prepare` (4943, 4944); `Store.sql` (4943, 4944) | CORE |
| [packages/store/src/store.ts:4960](../../packages/store/src/store.ts#L4960) `Store/verifyPasskeyAssertion` | `SQLite.get` (4960); `SQLite.prepare` (4960, 4971); `Store.sql` (4960, 4971) | CORE |
| [packages/store/src/store.ts:5007](../../packages/store/src/store.ts#L5007) `Store/generateRecoveryCodes` | `SQLite.prepare` (5007, 5010); `Store.sql` (5007, 5010) | CORE |
| [packages/store/src/store.ts:5025](../../packages/store/src/store.ts#L5025) `Store/recoveryCodesRemaining` | `SQLite.get` (5025); `SQLite.prepare` (5025); `Store.sql` (5025) | CORE |
| [packages/store/src/store.ts:5035](../../packages/store/src/store.ts#L5035) `Store/useRecoveryCode` | `SQLite.get` (5035); `SQLite.prepare` (5035, 5037); `Store.sql` (5035, 5037) | CORE |
| [packages/store/src/store.ts:5048](../../packages/store/src/store.ts#L5048) `Store/privilegeSets` | `Store.sql` (5048) | CORE |
| [packages/store/src/store.ts:5077](../../packages/store/src/store.ts#L5077) `Store/savePrivilegeSet` | `SQLite.prepare` (5077, 5085); `Store.sql` (5077, 5085) | AUTH |
| [packages/store/src/store.ts:5120](../../packages/store/src/store.ts#L5120) `Store/deletePrivilegeSet` | `SQLite.prepare` (5120); `Store.sql` (5120) | CORE |
| [packages/store/src/store.ts:5189](../../packages/store/src/store.ts#L5189) `Store/accountPrivilegeSet` | `SQLite.get` (5189); `SQLite.prepare` (5189); `Store.sql` (5189) | CORE |
| [packages/store/src/store.ts:5203](../../packages/store/src/store.ts#L5203) `Store/setAccountPrivilegeSet` | `SQLite.get` (5203); `SQLite.prepare` (5203, 5206, 5210); `Store.sql` (5203, 5206, 5210) | AUTH |
| [packages/store/src/store.ts:5225](../../packages/store/src/store.ts#L5225) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5225); `Store.sql` (5225) | CORE |
| [packages/store/src/store.ts:5239](../../packages/store/src/store.ts#L5239) `Store/addProvisionedAccount` | `SQLite.get` (5239); `SQLite.prepare` (5239, 5243); `Store.sql` (5239, 5243) | CORE |
| [packages/store/src/store.ts:5412](../../packages/store/src/store.ts#L5412) `Store/ruleOutcome` | `Calculations.context` (5412) | CORE |
| [packages/store/src/store.ts:5453](../../packages/store/src/store.ts#L5453) `Store/allowedIds` | `SQLite.iterate` (5453); `SQLite.prepare` (5453); `Store.sql` (5453) | CORE |
| [packages/store/src/store.ts:5523](../../packages/store/src/store.ts#L5523) `Store/scopedTableSql` | `Store.viewableIds` (5523); `SQLite.all` (5526); `SQLite.prepare` (5526); `Store.sql` (5526) | GATED-STORE |
| [packages/store/src/store.ts:5558](../../packages/store/src/store.ts#L5558) `Store/previewRecordRuleCurrent` | `SQLite.get` (5558); `SQLite.prepare` (5558, 5561); `Store.sql` (5558, 5561); `SQLite.all` (5561); `Calculations.context` (5567, 5583) | CORE |
| [packages/store/src/store.ts:5735](../../packages/store/src/store.ts#L5735) `Store/passwordHash` | `SQLite.get` (5735); `SQLite.prepare` (5735); `Store.sql` (5735) | CORE |
| [packages/store/src/store.ts:5764](../../packages/store/src/store.ts#L5764) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5764); `Store.sql` (5764) | CORE |
| [packages/store/src/store.ts:5777](../../packages/store/src/store.ts#L5777) `Store/knownSharedAccount` | `SQLite.get` (5777); `SQLite.prepare` (5777); `Store.sql` (5777) | CORE |
| [packages/store/src/store.ts:5840](../../packages/store/src/store.ts#L5840) `Store/layouts` | `SQLite.all` (5840); `SQLite.prepare` (5840); `Store.sql` (5840) | CORE |
| [packages/store/src/store.ts:5861](../../packages/store/src/store.ts#L5861) `Store/image` | `SQLite.get` (5861); `SQLite.prepare` (5861); `Store.sql` (5861) | CORE |
| [packages/store/src/store.ts:5871](../../packages/store/src/store.ts#L5871) `Store/images` | `SQLite.all` (5871); `SQLite.prepare` (5871); `Store.sql` (5871) | CORE |
| [packages/store/src/store.ts:5884](../../packages/store/src/store.ts#L5884) `Store/addImage` | `Store.sql` (5884, 5885); `SQLite.prepare` (5885) | CORE |
| [packages/store/src/store.ts:5901](../../packages/store/src/store.ts#L5901) `Store/layout` | `SQLite.get` (5901); `SQLite.prepare` (5901); `Store.sql` (5901) | CORE |
| [packages/store/src/store.ts:6105](../../packages/store/src/store.ts#L6105) `Store/wordIndex` | `Store.sql` (6105, 6113, 6118); `Store.recordCount` (6117); `SQLite.get` (6118); `SQLite.prepare` (6118) | CORE |
| [packages/store/src/store.ts:6170](../../packages/store/src/store.ts#L6170) `Store/toRecord` | `Calculations.value` (6170, 6180); `Calculations.globalValue` (6174); `Calculations.unstoredStyled` (6179) | CORE |
| [packages/store/src/store.ts:6229](../../packages/store/src/store.ts#L6229) `Store/relatedValues` | `Calculations.globalValue` (6229); `Calculations.unstoredValue` (6231) | CORE |
| [packages/store/src/store.ts:6303](../../packages/store/src/store.ts#L6303) `Store/addRelated` | `relatedRows` (6303); `rowsById` (6335); `firstRelatedEach` (6358) | CORE |
| [packages/store/src/store.ts:6386](../../packages/store/src/store.ts#L6386) `Store/foundSetPage` | `rowsById` (6386) | CORE |
| [packages/store/src/store.ts:6402](../../packages/store/src/store.ts#L6402) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6402); `Store.row` (6418) | GATED-STORE |
| [packages/store/src/store.ts:6441](../../packages/store/src/store.ts#L6441) `Store/portalCountsCurrent` | `Store.canView` (6441); `Store.row` (6468) | GATED-STORE |
| [packages/store/src/store.ts:6504](../../packages/store/src/store.ts#L6504) `Store/fieldIndexCurrent` | `SQLite.iterate` (6504); `SQLite.prepare` (6504, 6509); `Store.sql` (6504, 6509); `SQLite.all` (6509) | GATED-STORE |
| [packages/store/src/store.ts:6550](../../packages/store/src/store.ts#L6550) `Store/valueListItemsCurrent` | `Store.valueListItems` (6550); `Store.get` (6564); `relatedRows` (6565); `Store.row` (6565); `SQLite.iterate` (6567); `SQLite.prepare` (6567); `Store.sql` (6567); `Calculations.related` (6577); `Calculations.value` (6581, 6582) | GATED-STORE |
| [packages/store/src/store.ts:6679](../../packages/store/src/store.ts#L6679) `Store/portalRows` | `relatedRows` (6679); `relatedIdList` (6680); `Store.viewableIds` (6683); `rowsById` (6708, 6746); `Calculations.related` (6722) | CORE |
| [packages/store/src/store.ts:6690](../../packages/store/src/store.ts#L6690) `Store/portalRows/context` | `Calculations.context` (6690) | CORE |
| [packages/store/src/store.ts:6700](../../packages/store/src/store.ts#L6700) `Store/portalRows/valueOf` | `Calculations.value` (6700) | CORE |
| [packages/store/src/store.ts:6817](../../packages/store/src/store.ts#L6817) `Store/markRepeating` | `SQLite.prepare` (6817); `Store.sql` (6817) | CORE |
| [packages/store/src/store.ts:6844](../../packages/store/src/store.ts#L6844) `Store/externalContainerCheck` | `SQLite.all` (6844); `SQLite.prepare` (6844); `Store.sql` (6844) | CORE |
| [packages/store/src/store.ts:6851](../../packages/store/src/store.ts#L6851) `Store/externalContainerCount` | `SQLite.get` (6851); `SQLite.prepare` (6851); `Store.sql` (6851) | CORE |
| [packages/store/src/store.ts:6860](../../packages/store/src/store.ts#L6860) `Store/externalContainerReport` | `SQLite.all` (6860, 6873); `SQLite.prepare` (6860, 6873); `Store.sql` (6860, 6873) | CORE |
| [packages/store/src/store.ts:7008](../../packages/store/src/store.ts#L7008) `Store/orphanContainerReport` | `SQLite.all` (7008); `SQLite.prepare` (7008); `Store.sql` (7008) | CORE |
| [packages/store/src/store.ts:7043](../../packages/store/src/store.ts#L7043) `Store/purgeOrphanContainers` | `Store.sql` (7043, 7047, 7056, 7059, 7060, 7065, 7066, 7068, 7068); `Store.orphanContainerReport` (7051); `SQLite.get` (7056); `SQLite.prepare` (7056, 7059, 7060) | CORE |
| [packages/store/src/store.ts:7081](../../packages/store/src/store.ts#L7081) `Store/containerIntact` | `SQLite.get` (7081); `SQLite.prepare` (7081); `Store.sql` (7081) | CORE |
| [packages/store/src/store.ts:7091](../../packages/store/src/store.ts#L7091) `Store/externalOf` | `SQLite.get` (7091); `SQLite.prepare` (7091); `Store.sql` (7091) | CORE |
| [packages/store/src/store.ts:7095](../../packages/store/src/store.ts#L7095) `Store/containerMeta` | `SQLite.get` (7095); `SQLite.prepare` (7095); `Store.sql` (7095) | CORE |
| [packages/store/src/store.ts:7100](../../packages/store/src/store.ts#L7100) `Store/container` | `SQLite.get` (7100); `SQLite.prepare` (7100, 7109); `Store.sql` (7100, 7109); `SQLite.all` (7109) | CORE |
| [packages/store/src/store.ts:7117](../../packages/store/src/store.ts#L7117) `Store/containerInfo` | `SQLite.get` (7117); `SQLite.prepare` (7117); `Store.sql` (7117) | CORE |
| [packages/store/src/store.ts:7151](../../packages/store/src/store.ts#L7151) `Store/containerRange` | `SQLite.all` (7151); `SQLite.prepare` (7151, 7158); `Store.sql` (7151, 7158); `SQLite.get` (7158) | CORE |
| [packages/store/src/store.ts:7176](../../packages/store/src/store.ts#L7176) `Store/addContainer` | `SQLite.all` (7176); `SQLite.prepare` (7176, 7181, 7195, 7199, 7200); `Store.sql` (7176, 7181, 7195, 7197, 7199, 7200, 7202, 7205); `SQLite.get` (7186); `Store.containerRange` (7188) | CORE |
| [packages/store/src/store.ts:7222](../../packages/store/src/store.ts#L7222) `Store/addExternalContainer` | `SQLite.prepare` (7222); `Store.sql` (7222) | CORE |
| [packages/store/src/store.ts:7240](../../packages/store/src/store.ts#L7240) `Store/writeExternalFile` | `Store.evaluateEach` (7240); `SQLite.prepare` (7263); `Store.sql` (7263) | CORE |
| [packages/store/src/store.ts:7264](../../packages/store/src/store.ts#L7264) `Store/writeExternalFile/taken` | `SQLite.get` (7264) | CORE |
| [packages/store/src/store.ts:7293](../../packages/store/src/store.ts#L7293) `Store/embeddedContainers` | `SQLite.prepare` (7293, 7294); `Store.sql` (7293, 7294); `SQLite.all` (7294); `SQLite.get` (7298) | CORE |
| [packages/store/src/store.ts:7307](../../packages/store/src/store.ts#L7307) `Store/embeddedContainerCount` | `SQLite.prepare` (7307); `Store.sql` (7307); `SQLite.get` (7308) | CORE |
| [packages/store/src/store.ts:7316](../../packages/store/src/store.ts#L7316) `Store/recoverContainersOut` | `SQLite.prepare` (7316); `Store.sql` (7316); `SQLite.get` (7319) | CORE |
| [packages/store/src/store.ts:7341](../../packages/store/src/store.ts#L7341) `Store/moveContainersOut` | `Store.sql` (7341, 7349, 7351, 7353, 7355, 7356, 7375, 7380, 7382, 7384, 7385, 7389); `SQLite.get` (7349); `SQLite.prepare` (7349, 7355, 7356); `Store.container` (7358) | CORE |
| [packages/store/src/store.ts:7398](../../packages/store/src/store.ts#L7398) `Store/moveContainersIn` | `Store.sql` (7398, 7403, 7405, 7406, 7407, 7408, 7427, 7430, 7437, 7440, 7443, 7450); `SQLite.prepare` (7405, 7406, 7407, 7408, 7437, 7443); `SQLite.get` (7410, 7437, 7443) | CORE |
| [packages/store/src/store.ts:7462](../../packages/store/src/store.ts#L7462) `Store/compactFile` | `Store.sql` (7462, 7463, 7465) | CORE |
| [packages/store/src/store.ts:7471](../../packages/store/src/store.ts#L7471) `Store/containerId` | `Store.containerId` (7471); `Store.row` (7472) | CORE |
| [packages/store/src/store.ts:7494](../../packages/store/src/store.ts#L7494) `Store/checkContainerWrite` | `Store.row` (7494) | CORE |
| [packages/store/src/store.ts:7507](../../packages/store/src/store.ts#L7507) `Store/setContainer` | `Store.sql` (7507, 7521, 7526, 7529, 7529); `Store.row` (7510); `SQLite.prepare` (7521) | CORE |
| [packages/store/src/store.ts:7563](../../packages/store/src/store.ts#L7563) `Store/orderBy` | `Store.valueListItems` (7563) | CORE |
| [packages/store/src/store.ts:7586](../../packages/store/src/store.ts#L7586) `Store/userPrefs` | `SQLite.all` (7586); `SQLite.prepare` (7586); `Store.sql` (7586) | CORE |
| [packages/store/src/store.ts:7591](../../packages/store/src/store.ts#L7591) `Store/hasTable` | `SQLite.get` (7591); `SQLite.prepare` (7591); `Store.sql` (7591) | CORE |
| [packages/store/src/store.ts:7595](../../packages/store/src/store.ts#L7595) `Store/setUserPref` | `Store.sql` (7595, 7596, 7597); `SQLite.prepare` (7596, 7597) | CORE |
| [packages/store/src/store.ts:7603](../../packages/store/src/store.ts#L7603) `Store/indexedFields` | `SQLite.all` (7603, 7604); `SQLite.prepare` (7603, 7604); `Store.sql` (7603, 7604) | CORE |
| [packages/store/src/store.ts:7625](../../packages/store/src/store.ts#L7625) `Store/addFieldIndex` | `Store.sql` (7625) | CORE |
| [packages/store/src/store.ts:7637](../../packages/store/src/store.ts#L7637) `Store/dropFieldIndex` | `SQLite.get` (7637); `SQLite.prepare` (7637); `Store.sql` (7637, 7638) | CORE |
| [packages/store/src/store.ts:7648](../../packages/store/src/store.ts#L7648) `Store/timeFind` | `Store.query` (7648, 7652, 7653); `Store.recordCount` (7655) | CORE |
| [packages/store/src/store.ts:7672](../../packages/store/src/store.ts#L7672) `Store/find` | `Store.find` (7672) | GATED-STORE |
| [packages/store/src/store.ts:7683](../../packages/store/src/store.ts#L7683) `Store/findHere` | `Store.query` (7683, 7688, 7690, 7704, 7706, 7716); `Store.recordCount` (7701); `SQLite.get` (7702, 7706); `SQLite.prepare` (7702, 7706, 7711, 7718, 7727); `Store.sql` (7702, 7706, 7711, 7718, 7727); `SQLite.all` (7711, 7718, 7727) | GATED-STORE |
| [packages/store/src/store.ts:7722](../../packages/store/src/store.ts#L7722) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7722); `SQLite.prepare` (7722); `Store.sql` (7722) | GATED-STORE |
| [packages/store/src/store.ts:7755](../../packages/store/src/store.ts#L7755) `Store/sortedPage` | `SQLite.iterate` (7755); `SQLite.prepare` (7755, 7770); `Store.sql` (7755, 7770); `SQLite.all` (7770) | CORE |
| [packages/store/src/store.ts:7827](../../packages/store/src/store.ts#L7827) `Store/relatedCriteria/matched` | `relatedRows` (7827) | CORE |
| [packages/store/src/store.ts:7830](../../packages/store/src/store.ts#L7830) `Store/relatedCriteria` | `SQLite.iterate` (7830); `SQLite.prepare` (7830); `Store.sql` (7830) | CORE |
| [packages/store/src/store.ts:7856](../../packages/store/src/store.ts#L7856) `Store/computedRows` | `Store.sql` (7856, 7859, 7860, 7861, 7863, 7873, 7874, 7875, 7878); `SQLite.prepare` (7859, 7861, 7863, 7873); `SQLite.iterate` (7863); `Calculations.globalValue` (7866); `Calculations.unstoredValue` (7867); `Calculations.related` (7870); `SQLite.all` (7873) | CORE |
| [packages/store/src/store.ts:7903](../../packages/store/src/store.ts#L7903) `Store/summaries` | `Calculations.wholeTable` (7903); `Calculations.collect` (7923, 7928) | CORE |
| [packages/store/src/store.ts:7919](../../packages/store/src/store.ts#L7919) `Store/summaries/recs` | `SQLite.iterate` (7919); `SQLite.prepare` (7919); `Store.sql` (7919) | CORE |
| [packages/store/src/store.ts:7941](../../packages/store/src/store.ts#L7941) `Store/runningSummaryValues` | `Store.viewableIds` (7941); `rowsById` (7943); `Calculations.value` (7954, 7960); `Calculations.related` (7971) | GATED-STORE |
| [packages/store/src/store.ts:7984](../../packages/store/src/store.ts#L7984) `Store/findSource` | `Store.query` (7984); `Store.sql` (7991, 7992, 7996, 7998, 8009, 8011); `SQLite.prepare` (7992, 7998); `SQLite.iterate` (7998); `Calculations.globalValue` (8002); `Calculations.unstoredValue` (8003); `Calculations.related` (8007) | CORE |
| [packages/store/src/store.ts:8030](../../packages/store/src/store.ts#L8030) `Store/previewRow` | `Store.row` (8030) | CORE |
| [packages/store/src/store.ts:8048](../../packages/store/src/store.ts#L8048) `Store/row` | `SQLite.get` (8048) | CORE |
| [packages/store/src/store.ts:8067](../../packages/store/src/store.ts#L8067) `Store/getCurrent` | `Store.get` (8067); `Store.row` (8068, 8068, 8082); `SQLite.all` (8085); `SQLite.prepare` (8085); `Store.sql` (8085) | GATED-STORE |
| [packages/store/src/store.ts:8105](../../packages/store/src/store.ts#L8105) `Store/getManyCurrent` | `Store.getMany` (8105); `SQLite.get` (8123); `SQLite.prepare` (8123); `Store.sql` (8123) | GATED-STORE |
| [packages/store/src/store.ts:8116](../../packages/store/src/store.ts#L8116) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8116) | GATED-STORE |
| [packages/store/src/store.ts:8139](../../packages/store/src/store.ts#L8139) `Store/canViewRecord` | `SQLite.get` (8139); `SQLite.prepare` (8139); `Store.sql` (8139) | GATED-STORE |
| [packages/store/src/store.ts:8147](../../packages/store/src/store.ts#L8147) `Store/canView` | `Store.canView` (8147); `Store.row` (8148) | GATED-STORE |
| [packages/store/src/store.ts:8172](../../packages/store/src/store.ts#L8172) `Store/create` | `SQLite.get` (8172, 8178); `SQLite.prepare` (8172, 8178, 8191); `Store.sql` (8172, 8178, 8191) | CORE |
| [packages/store/src/store.ts:8215](../../packages/store/src/store.ts#L8215) `Store/duplicate` | `Store.row` (8215); `SQLite.get` (8219); `SQLite.prepare` (8219, 8234); `Store.sql` (8219, 8234) | CORE |
| [packages/store/src/store.ts:8279](../../packages/store/src/store.ts#L8279) `Store/update` | `Store.row` (8279, 8286, 8297); `Store.sql` (8310, 8311, 8350, 8353) | CORE |
| [packages/store/src/store.ts:8313](../../packages/store/src/store.ts#L8313) `Store/update/undo` | `Store.sql` (8313) | CORE |
| [packages/store/src/store.ts:8457](../../packages/store/src/store.ts#L8457) `Store/setStoredCalcValues` | `SQLite.prepare` (8457, 8458); `Store.sql` (8457, 8458); `SQLite.get` (8462) | CORE |
| [packages/store/src/store.ts:8536](../../packages/store/src/store.ts#L8536) `Store/evaluateCurrent` | `Store.row` (8536, 8536); `Calculations.context` (8537); `Store.get` (8538, 8540) | GATED-STORE |
| [packages/store/src/store.ts:8572](../../packages/store/src/store.ts#L8572) `Store/evaluateEachCurrent` | `Store.row` (8572, 8572); `Calculations.context` (8577); `Store.get` (8579) | GATED-STORE |
| [packages/store/src/store.ts:8612](../../packages/store/src/store.ts#L8612) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8612); `Store.get` (8614) | GATED-STORE |
| [packages/store/src/store.ts:8633](../../packages/store/src/store.ts#L8633) `Store/evaluateRowsCurrent` | `Store.row` (8633, 8633) | GATED-STORE |
| [packages/store/src/store.ts:8647](../../packages/store/src/store.ts#L8647) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8647) | GATED-STORE |
| [packages/store/src/store.ts:8669](../../packages/store/src/store.ts#L8669) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8669) | GATED-STORE |
| [packages/store/src/store.ts:8707](../../packages/store/src/store.ts#L8707) `Store/updateRelated` | `relatedRows` (8707) | CORE |
| [packages/store/src/store.ts:8725](../../packages/store/src/store.ts#L8725) `Store/updatePortals` | `Store.row` (8725, 8760); `relatedRows` (8761) | CORE |
| [packages/store/src/store.ts:8734](../../packages/store/src/store.ts#L8734) `Store/updatePortals/portal/related` | `relatedIdList` (8734) | CORE |
| [packages/store/src/store.ts:8816](../../packages/store/src/store.ts#L8816) `Store/portalContainerTarget` | `Store.row` (8816); `relatedIdList` (8817) | CORE |
| [packages/store/src/store.ts:8830](../../packages/store/src/store.ts#L8830) `Store/checkEditable` | `Store.row` (8830) | CORE |
| [packages/store/src/store.ts:8853](../../packages/store/src/store.ts#L8853) `Store/delete` | `Store.row` (8853) | CORE |
| [packages/store/src/store.ts:8861](../../packages/store/src/store.ts#L8861) `Store/delete/run` | `SQLite.get` (8861); `SQLite.prepare` (8861, 8865); `Store.sql` (8861, 8865) | CORE |
| [packages/store/src/store.ts:9057](../../packages/store/src/store.ts#L9057) `Store/keyStep` | `Store.sql` (9057, 9063, 9067, 9069) | CORE |
| [packages/store/src/store.ts:8890](../../packages/store/src/store.ts#L8890) `Store/vaultHeld` | `SQLite.get` (8890); `SQLite.prepare` (8890); `Store.sql` (8890) | CORE |
| [packages/store/src/store.ts:8897](../../packages/store/src/store.ts#L8897) `Store/forgetStandInValues` | `Store.sql` (8897, 8918); `SQLite.prepare` (8918) | CORE |
| [packages/store/src/store.ts:8932](../../packages/store/src/store.ts#L8932) `Store/restoreDeletedRow` | `SQLite.get` (8932); `SQLite.prepare` (8932, 8933, 8937); `Store.sql` (8932, 8933, 8937); `SQLite.all` (8933) | CORE |
| [packages/store/src/store.ts:9110](../../packages/store/src/store.ts#L9110) `Store/cascadeDelete` | `relatedRows` (9110) | CORE |
| [packages/store/src/store.ts:9200](../../packages/store/src/store.ts#L9200) `Store/selectIdsCurrent` | `Store.selectIds` (9200); `SQLite.all` (9206); `SQLite.prepare` (9206); `Store.sql` (9206) | GATED-STORE |
| [packages/store/src/store.ts:9214](../../packages/store/src/store.ts#L9214) `Store/countIds` | `Store.countIds` (9214); `SQLite.get` (9218); `SQLite.prepare` (9218); `Store.sql` (9218) | GATED-STORE |
| [packages/store/src/store.ts:9234](../../packages/store/src/store.ts#L9234) `Store/computeValuesCurrent` | `Store.computeValues` (9234); `Store.sql` (9240, 9244); `SQLite.all` (9244); `SQLite.prepare` (9244) | GATED-STORE |
| [packages/store/src/store.ts:9259](../../packages/store/src/store.ts#L9259) `Store/findIdsCurrent` | `Store.findIds` (9259) | GATED-STORE |
| [packages/store/src/store.ts:9265](../../packages/store/src/store.ts#L9265) `Store/findIdsHere` | `Store.query` (9265, 9270, 9272); `SQLite.iterate` (9283); `SQLite.prepare` (9283); `Store.sql` (9283) | GATED-STORE |
| [packages/store/src/store.ts:9300](../../packages/store/src/store.ts#L9300) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9300); `Store.viewableIds` (9305); `Calculations.collect` (9321); `rowsById` (9321, 9371); `Calculations.collector` (9343) | GATED-STORE |
| [packages/store/src/store.ts:9333](../../packages/store/src/store.ts#L9333) `Store/groupSummariesCurrent/key` | `Calculations.value` (9333); `Calculations.related` (9335) | GATED-STORE |
| [packages/store/src/store.ts:9369](../../packages/store/src/store.ts#L9369) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9369) | GATED-STORE |
| [packages/store/src/store.ts:9425](../../packages/store/src/store.ts#L9425) `Store/sortIdsCurrentProgress` | `SQLite.all` (9425); `SQLite.prepare` (9425, 9493); `Store.sql` (9425, 9493); `Store.valueListItems` (9433); `rowsById` (9445); `Calculations.globalValue` (9448); `Calculations.unstoredValue` (9449); `Calculations.related` (9455); `SQLite.iterate` (9493) | GATED-STORE |
| [packages/store/src/store.ts:9507](../../packages/store/src/store.ts#L9507) `Store/matchIds` | `Store.matchIds` (9507); `SQLite.all` (9513); `SQLite.prepare` (9513); `Store.sql` (9513) | CORE |
| [packages/store/src/store.ts:9534](../../packages/store/src/store.ts#L9534) `Store/truncate/run` | `Store.sql` (9534, 9536, 9543, 9545, 9547, 9548); `SQLite.prepare` (9536, 9543); `SQLite.all` (9538) | CORE |
| [packages/store/src/store.ts:9572](../../packages/store/src/store.ts#L9572) `Store/iterateCommitted` | `SQLite.iterate` (9572) | CORE |
| [packages/store/src/store.ts:9606](../../packages/store/src/store.ts#L9606) `Store/readOnlyChecked` | `SQLite.prepare` (9606, 9610, 9619, 9624); `SQLite.all` (9610, 9619, 9624) | CORE |
| [packages/store/src/store.ts:9646](../../packages/store/src/store.ts#L9646) `Store/refreshDecimalSqlViews` | `SQLite.get` (9646); `SQLite.prepare` (9646, 9651); `SQLite.all` (9651) | CORE |
| [packages/store/src/store.ts:9665](../../packages/store/src/store.ts#L9665) `Store/internalRoots` | `SQLite.get` (9665); `SQLite.prepare` (9665, 9667); `SQLite.all` (9667) | CORE |
| [packages/store/src/store.ts:9700](../../packages/store/src/store.ts#L9700) `Store/selectCurrent` | `SQLite.iterate` (9700) | CORE |
| [packages/store/src/store.ts:9749](../../packages/store/src/store.ts#L9749) `Store/query` | `SQLite.iterate` (9749) | CORE |
| [packages/store/src/store.ts:9783](../../packages/store/src/store.ts#L9783) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9783); `SQLite.all` (9790, 9793); `SQLite.prepare` (9790, 9793) | CORE |
| [packages/store/src/store.ts:1184](../../packages/store/src/store.ts#L1184) `Store/ensureNativeIds` | `SQLite.all` (1184, 1196); `SQLite.prepare` (1184, 1187, 1195, 1196); `Store.sql` (1184, 1187, 1190, 1194, 1195, 1196, 1199, 1201) | CORE |
| [packages/store/src/store.ts:1209](../../packages/store/src/store.ts#L1209) `Store/nativeIdGuards` | `Store.sql` (1209, 1210, 1212) | CORE |
| [packages/store/src/store.ts:9716](../../packages/store/src/store.ts#L9716) `Store/selectIn` | `Store.select` (9716) | CORE |
| [packages/store/src/store.ts:9724](../../packages/store/src/store.ts#L9724) `Store/selectHeldCurrent` | `Store.sql` (9724, 9725); `SQLite.prepare` (9725); `SQLite.iterate` (9728) | CORE |
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
| [packages/store/src/sync-apply.ts:320](../../packages/store/src/sync-apply.ts#L320) `applySyncRun` | `Store.container` (320, 321, 348); `Store.containerInfo` (334); `SQLite.prepare` (429, 632, 664, 687); `Store.sql` (429, 632, 664, 687); `SQLite.get` (664, 687) | OPERATOR |
| [packages/store/src/sync-apply.ts:450](../../packages/store/src/sync-apply.ts#L450) `applySyncRun/fail` | `SQLite.get` (450); `SQLite.prepare` (450); `Store.sql` (450) | OPERATOR |
| [packages/store/src/sync-apply.ts:580](../../packages/store/src/sync-apply.ts#L580) `applySyncRun/containerChanges` | `Store.container` (580) | OPERATOR |
| [packages/store/src/sync-apply.ts:727](../../packages/store/src/sync-apply.ts#L727) `applySyncRun/filesToSend` | `Store.containerInfo` (727); `Store.container` (731) | OPERATOR |
| [packages/store/src/sync.ts:45](../../packages/store/src/sync.ts#L45) `openForPlanning` | `SQLite.get` (45, 46); `SQLite.prepare` (45, 46) | OPERATOR |
| [packages/store/src/sync.ts:190](../../packages/store/src/sync.ts#L190) `tableExists` | `SQLite.get` (190); `SQLite.prepare` (190); `Store.sql` (190) | OPERATOR |
| [packages/store/src/sync.ts:200](../../packages/store/src/sync.ts#L200) `ensureSyncTables` | `Store.sql` (200, 214, 224) | OPERATOR |
| [packages/store/src/sync.ts:244](../../packages/store/src/sync.ts#L244) `readSyncMap` | `SQLite.all` (244); `SQLite.prepare` (244); `Store.sql` (244) | OPERATOR |
| [packages/store/src/sync.ts:265](../../packages/store/src/sync.ts#L265) `lastPullTimestamp` | `SQLite.get` (265); `SQLite.prepare` (265); `Store.sql` (265) | OPERATOR |
| [packages/store/src/sync.ts:284](../../packages/store/src/sync.ts#L284) `readLocalRecords` | `SQLite.all` (284); `SQLite.prepare` (284); `Store.sql` (284) | OPERATOR |
| [packages/store/src/text-styles.ts:22](../../packages/store/src/text-styles.ts#L22) `ensureTextStyles` | `SQLite.all` (22, 26); `SQLite.prepare` (22, 26) | CORE |
| [packages/store/src/text-styles.ts:73](../../packages/store/src/text-styles.ts#L73) `TextStyles/st` | `SQLite.prepare` (73) | CORE |
| [packages/store/src/text-styles.ts:81](../../packages/store/src/text-styles.ts#L81) `TextStyles/has` | `SQLite.all` (81) | CORE |
| [packages/store/src/text-styles.ts:94](../../packages/store/src/text-styles.ts#L94) `TextStyles/rows` | `SQLite.all` (94) | CORE |
| [packages/store/src/trace.ts:142](../../packages/store/src/trace.ts#L142) `traceDatabase/get` | `SQLite.prepare` (142) | CORE |
| [packages/store/src/words.ts:78](../../packages/store/src/words.ts#L78) `WordIndexes/ensure` | `SQLite.prepare` (78, 82); `SQLite.get` (81); `SQLite.all` (82) | CORE |
| [packages/store/src/words.ts:85](../../packages/store/src/words.ts#L85) `WordIndexes/ensure/covers` | `SQLite.get` (85, 89); `SQLite.all` (86); `SQLite.prepare` (86, 89) | CORE |
| [packages/store/src/words.ts:155](../../packages/store/src/words.ts#L155) `WordIndexes/dropAll` | `SQLite.all` (155); `SQLite.prepare` (155) | CORE |
| [packages/server/src/oauth.ts:847](../../packages/server/src/oauth.ts#L847) `OAuthServer/endGrant` | `SQLite.prepare` (847, 848); `SQLite.all` (848) | AUTH |
| [packages/server/src/oauth.ts:803](../../packages/server/src/oauth.ts#L803) `OAuthServer/issue/write` | `SQLite.get` (803); `SQLite.prepare` (803, 804, 805) | AUTH |
| [packages/server/src/backup.ts:264](../../packages/server/src/backup.ts#L264) `backupOnceHeld` | `SQLite.get` (264); `SQLite.prepare` (264) | OPERATOR |
| [packages/store/src/store.ts:1549](../../packages/store/src/store.ts#L1549) `Store/selfContainedCopy` | `Store.sql` (1549); `SQLite.all` (1554); `SQLite.prepare` (1554, 1556, 1557, 1558) | CORE |
| [packages/store/src/store.ts:6923](../../packages/store/src/store.ts#L6923) `Store/containerReferences` | `SQLite.all` (6923, 6941, 6943, 6949, 6962, 6973, 6987); `SQLite.prepare` (6923, 6941, 6943, 6949, 6962, 6973, 6985, 6987); `Store.sql` (6923, 6941, 6943, 6949, 6962, 6973, 6985, 6987); `SQLite.get` (6985); `Store.row` (6996) | CORE |
| [packages/store/src/store.ts:7020](../../packages/store/src/store.ts#L7020) `Store/containerIntegrityReport` | `SQLite.all` (7020); `SQLite.prepare` (7020, 7031); `Store.sql` (7020, 7031); `SQLite.get` (7031) | CORE |
<!-- end generated read-gate inventory -->
