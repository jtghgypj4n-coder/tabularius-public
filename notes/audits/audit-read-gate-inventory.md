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
| [packages/scripts/src/engine.ts:7964](../../packages/scripts/src/engine.ts#L7964) `ScriptEngine/containerFile` | `Store.get` (7964); `Store.containerId` (7965); `Store.container` (7966) | SCRIPT |
| [packages/scripts/src/engine.ts:5582](../../packages/scripts/src/engine.ts#L5582) `ScriptEngine/design` | `Store.valueListItems` (5582) | SCRIPT |
| [packages/scripts/src/engine.ts:6320](../../packages/scripts/src/engine.ts#L6320) `ScriptEngine/exportField` | `Store.get` (6320); `Store.containerId` (6321); `Store.container` (6323) | SCRIPT |
| [packages/scripts/src/engine.ts:8361](../../packages/scripts/src/engine.ts#L8361) `ScriptEngine/fileMakerRows` | `Store.findIds` (8361); `Store.get` (8366) | SCRIPT |
| [packages/scripts/src/engine.ts:8731](../../packages/scripts/src/engine.ts#L8731) `ScriptEngine/findRelated` | `Store.findIds` (8731, 8741, 8744) | SCRIPT |
| [packages/scripts/src/engine.ts:2297](../../packages/scripts/src/engine.ts#L2297) `ScriptEngine/foundSet` | `Store.findIds` (2297) | SCRIPT |
| [packages/scripts/src/engine.ts:5422](../../packages/scripts/src/engine.ts#L5422) `ScriptEngine/get` | `Store.findIds` (5422); `Store.canViewRecord` (5515); `Store.get` (5551) | SCRIPT |
| [packages/scripts/src/engine.ts:1953](../../packages/scripts/src/engine.ts#L1953) `ScriptEngine/goToLayout` | `Store.findIds` (1953) | SCRIPT |
| [packages/scripts/src/engine.ts:6891](../../packages/scripts/src/engine.ts#L6891) `ScriptEngine/goToList` | `Store.findIds` (6891) | SCRIPT |
| [packages/scripts/src/engine.ts:8130](../../packages/scripts/src/engine.ts#L8130) `ScriptEngine/importRecords` | `Store.findIds` (8130); `Store.get` (8150) | SCRIPT |
| [packages/scripts/src/engine.ts:5694](../../packages/scripts/src/engine.ts#L5694) `ScriptEngine/lookupNext` | `Store.get` (5694); `Store.row` (5695); `Calculations.context` (5697) | SCRIPT |
| [packages/scripts/src/engine.ts:5260](../../packages/scripts/src/engine.ts#L5260) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5260) | SCRIPT |
| [packages/scripts/src/engine.ts:5268](../../packages/scripts/src/engine.ts#L5268) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5268) | SCRIPT |
| [packages/scripts/src/engine.ts:5269](../../packages/scripts/src/engine.ts#L5269) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5269) | SCRIPT |
| [packages/scripts/src/engine.ts:8401](../../packages/scripts/src/engine.ts#L8401) `ScriptEngine/newRecord` | `Store.findIds` (8401) | SCRIPT |
| [packages/scripts/src/engine.ts:8706](../../packages/scripts/src/engine.ts#L8706) `ScriptEngine/performFind` | `Store.findIds` (8706) | SCRIPT |
| [packages/scripts/src/engine.ts:8763](../../packages/scripts/src/engine.ts#L8763) `ScriptEngine/quickFind` | `Store.findIds` (8763, 8764, 8767) | SCRIPT |
| [packages/scripts/src/engine.ts:5636](../../packages/scripts/src/engine.ts#L5636) `ScriptEngine/record` | `Store.get` (5636) | SCRIPT |
| [packages/scripts/src/engine.ts:5797](../../packages/scripts/src/engine.ts#L5797) `ScriptEngine/relatedIds` | `Store.findIds` (5797); `rowsById` (5805); `Store.select` (5809); `Store.matchIds` (5823); `Store.viewableIds` (5846) | SCRIPT |
| [packages/scripts/src/engine.ts:5831](../../packages/scripts/src/engine.ts#L5831) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5831) | SCRIPT |
| [packages/scripts/src/engine.ts:6471](../../packages/scripts/src/engine.ts#L6471) `ScriptEngine/relookup` | `Store.get` (6471) | SCRIPT |
| [packages/scripts/src/engine.ts:3431](../../packages/scripts/src/engine.ts#L3431) `ScriptEngine/revertTransaction` | `Store.findIds` (3431) | SCRIPT |
| [packages/scripts/src/engine.ts:2362](../../packages/scripts/src/engine.ts#L2362) `ScriptEngine/semanticFind` | `Store.findIds` (2362, 2383) | SCRIPT |
| [packages/scripts/src/engine.ts:3334](../../packages/scripts/src/engine.ts#L3334) `ScriptEngine/sortIds` | `Store.sortIds` (3334); `Store.valueListItems` (3340) | SCRIPT |
| [packages/scripts/src/engine.ts:7220](../../packages/scripts/src/engine.ts#L7220) `ScriptEngine/sourceValue` | `Store.get` (7220); `Store.containerId` (7221); `Store.container` (7222) | SCRIPT |
| [packages/scripts/src/engine.ts:3277](../../packages/scripts/src/engine.ts#L3277) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3277); `Calculations.executeSQL` (3284) | SCRIPT |
| [packages/scripts/src/engine.ts:3991](../../packages/scripts/src/engine.ts#L3991) `ScriptEngine/step` | `Store.fieldIndex` (3991); `Store.findIds` (4125, 4224) | SCRIPT |
| [packages/scripts/src/engine.ts:5669](../../packages/scripts/src/engine.ts#L5669) `ScriptEngine/valueOf` | `Store.findIds` (5669, 5669); `Store.containerId` (5677) | SCRIPT |
| [packages/scripts/src/engine.ts:9153](../../packages/scripts/src/engine.ts#L9153) `clearRecords` | `SQLite.all` (9153); `SQLite.prepare` (9153) | SCRIPT |
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
| [packages/server/src/agent.ts:316](../../packages/server/src/agent.ts#L316) `dryRunPlan` | `Store.findIds` (316) | DESIGN |
| [packages/server/src/agent.ts:339](../../packages/server/src/agent.ts#L339) `runApprovedStep` | `Store.findIds` (339) | DESIGN |
| [packages/server/src/agent.ts:162](../../packages/server/src/agent.ts#L162) `runStep` | `Store.findIds` (162); `Store.auditLog` (230); `Store.canViewRecord` (242) | DESIGN |
| [packages/server/src/agent.ts:154](../../packages/server/src/agent.ts#L154) `runStep/visible` | `Store.findIds` (154) | DESIGN |
| [packages/server/src/ai-output.ts:147](../../packages/server/src/ai-output.ts#L147) `storedSecretValues` | `Calculations.globalValue` (147); `Store.select` (152) | REDACTION |
| [packages/server/src/ai-policy-sql.ts:49](../../packages/server/src/ai-policy-sql.ts#L49) `sqlFieldRefs` | `SQLite.all` (49, 51); `SQLite.prepare` (49, 51) | POLICY |
| [packages/server/src/ai-policy.ts:338](../../packages/server/src/ai-policy.ts#L338) `sql` | `Store.inspectQuery` (338) | POLICY |
| [packages/server/src/ai-usage.ts:187](../../packages/server/src/ai-usage.ts#L187) `AiUsage/add` | `SQLite.prepare` (187, 190) | AUTH |
| [packages/server/src/ai-usage.ts:227](../../packages/server/src/ai-usage.ts#L227) `AiUsage/importOld` | `SQLite.prepare` (227, 237, 245, 249) | AUTH |
| [packages/server/src/ai-usage.ts:172](../../packages/server/src/ai-usage.ts#L172) `AiUsage/month` | `SQLite.get` (172); `SQLite.prepare` (172) | AUTH |
| [packages/server/src/ai-usage.ts:198](../../packages/server/src/ai-usage.ts#L198) `AiUsage/question` | `SQLite.prepare` (198, 200, 201, 203) | AUTH |
| [packages/server/src/ai-usage.ts:179](../../packages/server/src/ai-usage.ts#L179) `AiUsage/recent` | `SQLite.all` (179); `SQLite.prepare` (179) | AUTH |
| [packages/server/src/ai-usage.ts:165](../../packages/server/src/ai-usage.ts#L165) `AiUsage/today` | `SQLite.get` (165); `SQLite.prepare` (165) | AUTH |
| [packages/server/src/assistant.ts:2152](../../packages/server/src/assistant.ts#L2152) `Assistant/answer` | `Store.find` (2152) | ACCOUNT |
| [packages/server/src/automations.ts:435](../../packages/server/src/automations.ts#L435) `AutomationRunner/changed` | `Store.auditLog` (435) | AUTOMATION |
| [packages/server/src/automations.ts:466](../../packages/server/src/automations.ts#L466) `AutomationRunner/run` | `Store.select` (466); `Store.canViewRecord` (476); `Store.evaluateEach` (479); `Store.evaluate` (485) | AUTOMATION |
| [packages/server/src/automations.ts:512](../../packages/server/src/automations.ts#L512) `AutomationRunner/runDeleted` | `Store.auditLog` (512) | AUTOMATION |
| [packages/server/src/automations.ts:195](../../packages/server/src/automations.ts#L195) `Saved/delete` | `SQLite.prepare` (195, 197); `Store.sql` (195, 197) | AUTOMATION |
| [packages/server/src/automations.ts:179](../../packages/server/src/automations.ts#L179) `Saved/list` | `SQLite.all` (179); `SQLite.prepare` (179); `Store.sql` (179) | AUTOMATION |
| [packages/server/src/automations.ts:202](../../packages/server/src/automations.ts#L202) `Saved/logRun` | `SQLite.prepare` (202, 204); `Store.sql` (202, 204) | AUTOMATION |
| [packages/server/src/automations.ts:209](../../packages/server/src/automations.ts#L209) `Saved/runs` | `SQLite.all` (209); `SQLite.prepare` (209); `Store.sql` (209) | AUTOMATION |
| [packages/server/src/automations.ts:189](../../packages/server/src/automations.ts#L189) `Saved/save` | `SQLite.prepare` (189); `Store.sql` (189) | AUTOMATION |
| [packages/server/src/automations.ts:168](../../packages/server/src/automations.ts#L168) `Saved/table` | `Store.sql` (168, 169) | AUTOMATION |
| [packages/server/src/automations.ts:308](../../packages/server/src/automations.ts#L308) `dryRunAutomation` | `Store.canViewRecord` (308); `Store.findIds` (308); `Store.auditLog` (324, 352, 360); `Store.select` (337); `Store.evaluate` (353) | AUTOMATION |
| [packages/server/src/automations.ts:307](../../packages/server/src/automations.ts#L307) `dryRunAutomation/truth` | `Store.evaluateEach` (307) | AUTOMATION |
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
| [packages/server/src/conversion-guide.ts:420](../../packages/server/src/conversion-guide.ts#L420) `ConversionGuides/save` | `SQLite.prepare` (420); `Store.sql` (420) | DESIGN |
| [packages/server/src/conversion-guide.ts:411](../../packages/server/src/conversion-guide.ts#L411) `ConversionGuides/saved` | `SQLite.get` (411); `SQLite.prepare` (411); `Store.sql` (411) | DESIGN |
| [packages/server/src/conversion-guide.ts:401](../../packages/server/src/conversion-guide.ts#L401) `ConversionGuides/table` | `Store.sql` (401) | DESIGN |
| [packages/server/src/conversion-guide.ts:138](../../packages/server/src/conversion-guide.ts#L138) `convertedAt` | `SQLite.get` (138); `SQLite.prepare` (138); `Store.sql` (138) | DESIGN |
| [packages/server/src/conversion.ts:345](../../packages/server/src/conversion.ts#L345) `conversionReport` | `Store.externalContainerCheck` (345) | DESIGN |
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
| [packages/server/src/digests.ts:231](../../packages/server/src/digests.ts#L231) `Digests/addRun` | `SQLite.prepare` (231, 232); `Store.sql` (231, 232) | DIGEST |
| [packages/server/src/digests.ts:208](../../packages/server/src/digests.ts#L208) `Digests/create` | `SQLite.prepare` (208); `Store.sql` (208) | DIGEST |
| [packages/server/src/digests.ts:225](../../packages/server/src/digests.ts#L225) `Digests/delete` | `SQLite.prepare` (225, 226); `Store.sql` (225, 226) | DIGEST |
| [packages/server/src/digests.ts:189](../../packages/server/src/digests.ts#L189) `Digests/get` | `SQLite.get` (189); `SQLite.prepare` (189); `Store.sql` (189) | DIGEST |
| [packages/server/src/digests.ts:196](../../packages/server/src/digests.ts#L196) `Digests/lastSlot` | `SQLite.get` (196); `SQLite.prepare` (196); `Store.sql` (196) | DIGEST |
| [packages/server/src/digests.ts:183](../../packages/server/src/digests.ts#L183) `Digests/list` | `SQLite.all` (183); `SQLite.prepare` (183); `Store.sql` (183) | DIGEST |
| [packages/server/src/digests.ts:200](../../packages/server/src/digests.ts#L200) `Digests/markSlot` | `SQLite.prepare` (200); `Store.sql` (200) | DIGEST |
| [packages/server/src/digests.ts:238](../../packages/server/src/digests.ts#L238) `Digests/runs` | `SQLite.all` (238); `SQLite.prepare` (238); `Store.sql` (238) | DIGEST |
| [packages/server/src/digests.ts:172](../../packages/server/src/digests.ts#L172) `Digests/table` | `Store.sql` (172) | DIGEST |
| [packages/server/src/digests.ts:217](../../packages/server/src/digests.ts#L217) `Digests/update` | `SQLite.prepare` (217); `Store.sql` (217) | DIGEST |
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
| [packages/server/src/live.ts:280](../../packages/server/src/live.ts#L280) `Live/visibleRecord` | `Store.canViewRecord` (280) | LIVE |
| [packages/server/src/logs.ts:77](../../packages/server/src/logs.ts#L77) `LogShipper/follow` | `SQLite.get` (77); `SQLite.prepare` (77); `Store.sql` (77, 78, 79, 80) | ADMIN |
| [packages/server/src/logs.ts:89](../../packages/server/src/logs.ts#L89) `LogShipper/releaseIfIdle` | `Store.sql` (89) | ADMIN |
| [packages/server/src/mcp-design.ts:510](../../packages/server/src/mcp-design.ts#L510) `registerDesignTools/audit_log` | `Store.auditLog` (510) | DESIGN |
| [packages/server/src/mcp.ts:1358](../../packages/server/src/mcp.ts#L1358) `createMcpServer/check_record` | `Store.get` (1358); `Store.row` (1360) | MCP |
| [packages/server/src/mcp.ts:1079](../../packages/server/src/mcp.ts#L1079) `createMcpServer/evaluate_calculation` | `Store.get` (1079, 1087); `Store.find` (1080); `Store.evaluate` (1081); `Store.row` (1086) | SQL |
| [packages/server/src/mcp.ts:1382](../../packages/server/src/mcp.ts#L1382) `createMcpServer/explain_related` | `Store.get` (1382) | MCP |
| [packages/server/src/mcp.ts:1335](../../packages/server/src/mcp.ts#L1335) `createMcpServer/explain_value` | `Store.get` (1335); `Store.row` (1336) | MCP |
| [packages/server/src/mcp.ts:959](../../packages/server/src/mcp.ts#L959) `createMcpServer/find_records` | `Store.find` (959) | MCP |
| [packages/server/src/mcp.ts:1154](../../packages/server/src/mcp.ts#L1154) `createMcpServer/get_container` | `Store.container` (1154) | SQL |
| [packages/server/src/mcp.ts:972](../../packages/server/src/mcp.ts#L972) `createMcpServer/get_record` | `Store.get` (972) | MCP |
| [packages/server/src/mcp.ts:1178](../../packages/server/src/mcp.ts#L1178) `createMcpServer/sql_query` | `Store.queryWithOrigins` (1178) | SQL |
| [packages/server/src/mcp.ts:1022](../../packages/server/src/mcp.ts#L1022) `createMcpServer/update_record` | `Store.get` (1022, 1026) | MCP |
| [packages/server/src/mcp.ts:2279](../../packages/server/src/mcp.ts#L2279) `registerResources/audit` | `Store.auditLog` (2279) | MCP |
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
| [packages/server/src/pii.ts:347](../../packages/server/src/pii.ts#L347) `PiiMasker/constructor` | `SQLite.get` (347); `SQLite.prepare` (347); `Store.sql` (347) | REDACTION |
| [packages/server/src/pii.ts:443](../../packages/server/src/pii.ts#L443) `PiiMasker/known` | `SQLite.iterate` (443); `SQLite.prepare` (443); `Store.sql` (443) | REDACTION |
| [packages/server/src/pii.ts:357](../../packages/server/src/pii.ts#L357) `PiiMasker/refresh` | `SQLite.iterate` (357); `SQLite.prepare` (357); `Store.sql` (357) | REDACTION |
| [packages/server/src/pii.ts:415](../../packages/server/src/pii.ts#L415) `PiiMasker/text` | `SQLite.get` (415); `SQLite.prepare` (415); `Store.sql` (415) | REDACTION |
| [packages/server/src/pii.ts:400](../../packages/server/src/pii.ts#L400) `PiiMasker/token` | `SQLite.prepare` (400, 401); `Store.sql` (400, 401); `SQLite.get` (401) | REDACTION |
| [packages/server/src/pii.ts:484](../../packages/server/src/pii.ts#L484) `PiiMasker/unmask` | `SQLite.get` (484); `SQLite.prepare` (484); `Store.sql` (484) | REDACTION |
| [packages/server/src/pii.ts:308](../../packages/server/src/pii.ts#L308) `forgetVault` | `Store.sql` (308) | REDACTION |
| [packages/server/src/pii.ts:122](../../packages/server/src/pii.ts#L122) `holdsOnlyUuids` | `Store.query` (122) | REDACTION |
| [packages/server/src/pii.ts:653](../../packages/server/src/pii.ts#L653) `piiPreview` | `Store.find` (653); `SQLite.prepare` (660); `Store.sql` (660) | REDACTION |
| [packages/server/src/pii.ts:134](../../packages/server/src/pii.ts#L134) `sampledValues` | `Store.query` (134) | REDACTION |
| [packages/server/src/pii.ts:299](../../packages/server/src/pii.ts#L299) `vaultTable` | `Store.sql` (299, 302) | REDACTION |
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
| [packages/server/src/standby.ts:414](../../packages/server/src/standby.ts#L414) `Standby/copy` | `SQLite.get` (414); `SQLite.prepare` (414) | OPERATOR |
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
| [packages/store/src/activity.ts:498](../../packages/store/src/activity.ts#L498) `SharedRecordLocks/acquire` | `SQLite.prepare` (498) | CORE |
| [packages/store/src/activity.ts:536](../../packages/store/src/activity.ts#L536) `SharedRecordLocks/all` | `SQLite.all` (536); `SQLite.prepare` (536) | CORE |
| [packages/store/src/activity.ts:440](../../packages/store/src/activity.ts#L440) `SharedRecordLocks/constructor` | `SQLite.get` (440); `SQLite.prepare` (440) | CORE |
| [packages/store/src/activity.ts:471](../../packages/store/src/activity.ts#L471) `SharedRecordLocks/count` | `SQLite.get` (471); `SQLite.prepare` (471) | CORE |
| [packages/store/src/activity.ts:483](../../packages/store/src/activity.ts#L483) `SharedRecordLocks/holder` | `SQLite.get` (483); `SQLite.prepare` (483) | CORE |
| [packages/store/src/activity.ts:555](../../packages/store/src/activity.ts#L555) `SharedRecordLocks/leave` | `SQLite.prepare` (555) | CORE |
| [packages/store/src/activity.ts:559](../../packages/store/src/activity.ts#L559) `SharedRecordLocks/leaveOwner` | `SQLite.all` (559); `SQLite.prepare` (559) | CORE |
| [packages/store/src/activity.ts:526](../../packages/store/src/activity.ts#L526) `SharedRecordLocks/release` | `SQLite.prepare` (526) | CORE |
| [packages/store/src/activity.ts:530](../../packages/store/src/activity.ts#L530) `SharedRecordLocks/releaseOwner` | `SQLite.all` (530); `SQLite.prepare` (530) | CORE |
| [packages/store/src/activity.ts:512](../../packages/store/src/activity.ts#L512) `SharedRecordLocks/renew` | `SQLite.prepare` (512) | CORE |
| [packages/store/src/activity.ts:475](../../packages/store/src/activity.ts#L475) `SharedRecordLocks/sweep` | `SQLite.prepare` (475) | CORE |
| [packages/store/src/activity.ts:542](../../packages/store/src/activity.ts#L542) `SharedRecordLocks/view` | `SQLite.prepare` (542, 543, 544, 545); `SQLite.get` (543, 544) | CORE |
| [packages/store/src/activity.ts:563](../../packages/store/src/activity.ts#L563) `SharedRecordLocks/viewers` | `SQLite.prepare` (563, 564); `SQLite.all` (564) | CORE |
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
| [packages/store/src/import.ts:168](../../packages/store/src/import.ts#L168) `applyFileAccountStatus` | `SQLite.get` (168, 170); `SQLite.prepare` (168, 170, 172, 184) | OPERATOR |
| [packages/store/src/import.ts:205](../../packages/store/src/import.ts#L205) `createStore` | `SQLite.prepare` (205, 216) | OPERATOR |
| [packages/store/src/import.ts:124](../../packages/store/src/import.ts#L124) `importDesigns` | `SQLite.all` (124); `SQLite.prepare` (124, 138, 141, 144, 146); `SQLite.get` (138, 141) | OPERATOR |
| [packages/store/src/import.ts:334](../../packages/store/src/import.ts#L334) `importFmp12` | `SQLite.prepare` (334, 344, 350, 356, 360, 375, 386, 461, 462); `SQLite.get` (350, 375); `SQLite.all` (356) | OPERATOR |
| [packages/store/src/import.ts:325](../../packages/store/src/import.ts#L325) `importFmp12/save` | `SQLite.prepare` (325) | OPERATOR |
| [packages/store/src/import.ts:228](../../packages/store/src/import.ts#L228) `needsDesigns` | `SQLite.get` (228); `SQLite.prepare` (228) | OPERATOR |
| [packages/store/src/import.ts:275](../../packages/store/src/import.ts#L275) `readState` | `SQLite.get` (275); `SQLite.prepare` (275) | OPERATOR |
| [packages/store/src/import.ts:104](../../packages/store/src/import.ts#L104) `writeDesign` | `SQLite.prepare` (104, 108) | OPERATOR |
| [packages/store/src/layout-speed.ts:56](../../packages/store/src/layout-speed.ts#L56) `layoutCost/recordCount` | `Store.recordCount` (56) | DESIGN |
| [packages/store/src/layout-speed.ts:419](../../packages/store/src/layout-speed.ts#L419) `speedContext` | `Store.recordCount` (419) | DESIGN |
| [packages/store/src/privileges.ts:547](../../packages/store/src/privileges.ts#L547) `ensurePrivilegeTables` | `SQLite.all` (547); `SQLite.prepare` (547) | AUTH |
| [packages/store/src/privileges.ts:519](../../packages/store/src/privileges.ts#L519) `privilegeSets` | `SQLite.all` (519); `SQLite.prepare` (519) | AUTH |
| [packages/store/src/reconvert.ts:186](../../packages/store/src/reconvert.ts#L186) `build` | `SQLite.get` (186); `SQLite.prepare` (186, 189, 194); `SQLite.all` (194) | OPERATOR |
| [packages/store/src/reconvert.ts:291](../../packages/store/src/reconvert.ts#L291) `carryRecords` | `SQLite.prepare` (291, 294, 295, 305, 311, 312); `SQLite.all` (294, 298, 311) | OPERATOR |
| [packages/store/src/reconvert.ts:320](../../packages/store/src/reconvert.ts#L320) `carrySettings` | `SQLite.all` (320, 324, 332); `SQLite.prepare` (320, 324, 332, 333, 337); `SQLite.get` (337) | OPERATOR |
| [packages/store/src/reconvert.ts:98](../../packages/store/src/reconvert.ts#L98) `columns` | `SQLite.all` (98); `SQLite.prepare` (98) | OPERATOR |
| [packages/store/src/reconvert.ts:254](../../packages/store/src/reconvert.ts#L254) `copyContainer` | `SQLite.get` (254); `SQLite.prepare` (254, 256, 262) | OPERATOR |
| [packages/store/src/reconvert.ts:89](../../packages/store/src/reconvert.ts#L89) `meta` | `SQLite.get` (89); `SQLite.prepare` (89) | OPERATOR |
| [packages/store/src/reconvert.ts:234](../../packages/store/src/reconvert.ts#L234) `previewOf` | `SQLite.get` (234); `SQLite.prepare` (234) | OPERATOR |
| [packages/store/src/reconvert.ts:221](../../packages/store/src/reconvert.ts#L221) `previewOf/count` | `SQLite.get` (221); `SQLite.prepare` (221) | OPERATOR |
| [packages/store/src/reconvert.ts:111](../../packages/store/src/reconvert.ts#L111) `reconvertCheck` | `SQLite.get` (111); `SQLite.prepare` (111) | OPERATOR |
| [packages/store/src/reconvert.ts:94](../../packages/store/src/reconvert.ts#L94) `tableExists` | `SQLite.get` (94); `SQLite.prepare` (94) | OPERATOR |
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
| [packages/store/src/store.ts:4671](../../packages/store/src/store.ts#L4671) `Store/accountIdentityId` | `SQLite.get` (4671, 4676); `SQLite.prepare` (4671, 4675, 4676); `Store.sql` (4671, 4675, 4676) | CORE |
| [packages/store/src/store.ts:4634](../../packages/store/src/store.ts#L4634) `Store/accountInactive` | `SQLite.get` (4634); `SQLite.prepare` (4634); `Store.sql` (4634) | CORE |
| [packages/store/src/store.ts:4799](../../packages/store/src/store.ts#L4799) `Store/accountLocalOnly` | `SQLite.get` (4799); `SQLite.prepare` (4799); `Store.sql` (4799) | CORE |
| [packages/store/src/store.ts:5653](../../packages/store/src/store.ts#L5653) `Store/accountPrivilegeSet` | `SQLite.get` (5653); `SQLite.prepare` (5653); `Store.sql` (5653) | CORE |
| [packages/store/src/store.ts:4804](../../packages/store/src/store.ts#L4804) `Store/accountRequires2fa` | `SQLite.get` (4804); `SQLite.prepare` (4804); `Store.sql` (4804) | CORE |
| [packages/store/src/store.ts:5024](../../packages/store/src/store.ts#L5024) `Store/accountUsage` | `SQLite.get` (5024); `SQLite.prepare` (5024, 5025); `Store.sql` (5024, 5025); `SQLite.all` (5025); `Store.auditLog` (5041) | CORE |
| [packages/store/src/store.ts:3134](../../packages/store/src/store.ts#L3134) `Store/accounts` | `SQLite.all` (3134); `SQLite.prepare` (3134); `Store.sql` (3134) | CORE |
| [packages/store/src/store.ts:3130](../../packages/store/src/store.ts#L3130) `Store/accountsSharingLockout` | `SQLite.all` (3130); `SQLite.prepare` (3130); `Store.sql` (3130) | CORE |
| [packages/store/src/store.ts:7735](../../packages/store/src/store.ts#L7735) `Store/addContainer` | `SQLite.all` (7735); `SQLite.prepare` (7735, 7740, 7754, 7758, 7759); `Store.sql` (7735, 7740, 7754, 7756, 7758, 7759, 7761, 7764); `SQLite.get` (7745); `Store.containerRange` (7747) | CORE |
| [packages/store/src/store.ts:7781](../../packages/store/src/store.ts#L7781) `Store/addExternalContainer` | `SQLite.prepare` (7781); `Store.sql` (7781) | CORE |
| [packages/store/src/store.ts:8237](../../packages/store/src/store.ts#L8237) `Store/addFieldIndex` | `Store.sql` (8237) | CORE |
| [packages/store/src/store.ts:6442](../../packages/store/src/store.ts#L6442) `Store/addImage` | `Store.sql` (6442, 6443); `SQLite.prepare` (6443) | CORE |
| [packages/store/src/store.ts:5703](../../packages/store/src/store.ts#L5703) `Store/addProvisionedAccount` | `SQLite.get` (5703); `SQLite.prepare` (5703, 5707); `Store.sql` (5703, 5707) | CORE |
| [packages/store/src/store.ts:6861](../../packages/store/src/store.ts#L6861) `Store/addRelated` | `relatedRows` (6861); `rowsById` (6893); `firstRelatedEach` (6916) | CORE |
| [packages/store/src/store.ts:3152](../../packages/store/src/store.ts#L3152) `Store/agentNeedsApproval` | `SQLite.get` (3152); `SQLite.prepare` (3152); `Store.sql` (3152) | CORE |
| [packages/store/src/store.ts:5917](../../packages/store/src/store.ts#L5917) `Store/allowedIds` | `SQLite.iterate` (5917); `SQLite.prepare` (5917); `Store.sql` (5917) | CORE |
| [packages/store/src/store.ts:5081](../../packages/store/src/store.ts#L5081) `Store/apiToken` | `SQLite.get` (5081); `SQLite.prepare` (5081, 5094); `Store.sql` (5081, 5094) | CORE |
| [packages/store/src/store.ts:5057](../../packages/store/src/store.ts#L5057) `Store/apiTokens` | `SQLite.all` (5057); `SQLite.prepare` (5057); `Store.sql` (5057) | CORE |
| [packages/store/src/store.ts:3475](../../packages/store/src/store.ts#L3475) `Store/appendSecurityEvent` | `Store.sql` (3475) | CORE |
| [packages/store/src/store.ts:4480](../../packages/store/src/store.ts#L4480) `Store/applyAccountImport` | `Store.sql` (4480, 4488, 4517); `SQLite.get` (4488); `SQLite.prepare` (4488, 4517) | CORE |
| [packages/store/src/store.ts:2095](../../packages/store/src/store.ts#L2095) `Store/applyDesign` | `Store.sql` (2095, 2096, 2109, 2112, 2117, 2133, 2136, 2136); `SQLite.prepare` (2112, 2117) | CORE |
| [packages/store/src/store.ts:3348](../../packages/store/src/store.ts#L3348) `Store/approvePending` | `SQLite.get` (3348); `SQLite.prepare` (3348, 3359); `Store.sql` (3348, 3359) | CORE |
| [packages/store/src/store.ts:2554](../../packages/store/src/store.ts#L2554) `Store/audit` | `Store.sql` (2554) | CORE |
| [packages/store/src/store.ts:2195](../../packages/store/src/store.ts#L2195) `Store/auditLog` | `SQLite.all` (2195); `SQLite.prepare` (2195); `Store.sql` (2195) | CORE |
| [packages/store/src/store.ts:1706](../../packages/store/src/store.ts#L1706) `Store/backup` | `Store.sql` (1706) | CORE |
| [packages/store/src/store.ts:3158](../../packages/store/src/store.ts#L3158) `Store/blankPasswordAccounts` | `SQLite.all` (3158); `SQLite.prepare` (3158); `Store.sql` (3158) | CORE |
| [packages/store/src/store.ts:8818](../../packages/store/src/store.ts#L8818) `Store/canView` | `Store.canView` (8818); `Store.row` (8819) | GATED-STORE |
| [packages/store/src/store.ts:8800](../../packages/store/src/store.ts#L8800) `Store/canViewRecord` | `SQLite.get` (8800); `SQLite.prepare` (8800); `Store.sql` (8800) | GATED-STORE |
| [packages/store/src/store.ts:4409](../../packages/store/src/store.ts#L4409) `Store/canonicalAccount` | `SQLite.all` (4409); `SQLite.prepare` (4409); `Store.sql` (4409) | CORE |
| [packages/store/src/store.ts:9877](../../packages/store/src/store.ts#L9877) `Store/cascadeDelete` | `relatedRows` (9877) | CORE |
| [packages/store/src/store.ts:1925](../../packages/store/src/store.ts#L1925) `Store/changeOne` | `Store.sql` (1925, 1927) | CORE |
| [packages/store/src/store.ts:1928](../../packages/store/src/store.ts#L1928) `Store/changeOne/read` | `SQLite.get` (1928); `SQLite.prepare` (1928); `Store.sql` (1928) | CORE |
| [packages/store/src/store.ts:8116](../../packages/store/src/store.ts#L8116) `Store/checkContainerWrite` | `Store.row` (8116) | CORE |
| [packages/store/src/store.ts:9530](../../packages/store/src/store.ts#L9530) `Store/checkEditable` | `Store.row` (9530) | CORE |
| [packages/store/src/store.ts:1371](../../packages/store/src/store.ts#L1371) `Store/checkpoint` | `SQLite.get` (1371); `SQLite.prepare` (1371); `Store.sql` (1371) | CORE |
| [packages/store/src/store.ts:5689](../../packages/store/src/store.ts#L5689) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5689); `Store.sql` (5689) | CORE |
| [packages/store/src/store.ts:1389](../../packages/store/src/store.ts#L1389) `Store/close` | `Store.sql` (1389) | CORE |
| [packages/store/src/store.ts:8084](../../packages/store/src/store.ts#L8084) `Store/compactFile` | `Store.sql` (8084, 8085, 8087) | CORE |
| [packages/store/src/store.ts:10001](../../packages/store/src/store.ts#L10001) `Store/computeValuesCurrent` | `Store.computeValues` (10001); `Store.sql` (10007, 10011); `SQLite.all` (10011); `SQLite.prepare` (10011) | GATED-STORE |
| [packages/store/src/store.ts:8469](../../packages/store/src/store.ts#L8469) `Store/computedRows` | `Store.sql` (8469, 8472, 8473, 8474, 8476, 8486, 8487, 8488, 8491); `SQLite.prepare` (8472, 8474, 8476, 8486); `SQLite.iterate` (8476); `Calculations.globalValue` (8479); `Calculations.unstoredValue` (8480); `Calculations.related` (8483); `SQLite.all` (8486) | CORE |
| [packages/store/src/store.ts:5121](../../packages/store/src/store.ts#L5121) `Store/confirmTotp` | `SQLite.get` (5121); `SQLite.prepare` (5121, 5123); `Store.sql` (5121, 5123) | CORE |
| [packages/store/src/store.ts:1066](../../packages/store/src/store.ts#L1066) `Store/constructor` | `Store.sql` (1066, 1068, 1070, 1071, 1075, 1079, 1080, 1091, 1096, 1101, 1102, 1106, 1107, 1108, 1115, 1119, 1123, 1124, 1125, 1130, 1134, 1137, 1138, 1140, 1141, 1144, 1145, 1149, 1150, 1154, 1155, 1158, 1160, 1163, 1164, 1168, 1169, 1173, 1174, 1177, 1178, 1179, 1182, 1183, 1186, 1187, 1189, 1189, 1190, 1190, 1191, 1194, 1198, 1200, 1203, 1204, 1205, 1208, 1209, 1211, 1213, 1214, 1218, 1219, 1221, 1225, 1227, 1228, 1229, 1229, 1233, 1234); `SQLite.get` (1070); `SQLite.prepare` (1070, 1137, 1138, 1141, 1144, 1149, 1154, 1163, 1168, 1173, 1182, 1186, 1189, 1190, 1208, 1213, 1218); `SQLite.all` (1137, 1144, 1149, 1154, 1163, 1168, 1173, 1182, 1186, 1189, 1190, 1208, 1213, 1218) | CORE |
| [packages/store/src/store.ts:5470](../../packages/store/src/store.ts#L5470) `Store/consumeRecoveryCode` | `SQLite.prepare` (5470); `Store.sql` (5470) | CORE |
| [packages/store/src/store.ts:7659](../../packages/store/src/store.ts#L7659) `Store/container` | `SQLite.get` (7659); `SQLite.prepare` (7659, 7668); `Store.sql` (7659, 7668); `SQLite.all` (7668) | CORE |
| [packages/store/src/store.ts:8093](../../packages/store/src/store.ts#L8093) `Store/containerId` | `Store.containerId` (8093); `Store.row` (8094) | CORE |
| [packages/store/src/store.ts:7676](../../packages/store/src/store.ts#L7676) `Store/containerInfo` | `SQLite.get` (7676); `SQLite.prepare` (7676); `Store.sql` (7676) | CORE |
| [packages/store/src/store.ts:7640](../../packages/store/src/store.ts#L7640) `Store/containerIntact` | `SQLite.get` (7640); `SQLite.prepare` (7640); `Store.sql` (7640) | CORE |
| [packages/store/src/store.ts:7579](../../packages/store/src/store.ts#L7579) `Store/containerIntegrityReport` | `SQLite.all` (7579); `SQLite.prepare` (7579, 7590); `Store.sql` (7579, 7590); `SQLite.get` (7590) | CORE |
| [packages/store/src/store.ts:7654](../../packages/store/src/store.ts#L7654) `Store/containerMeta` | `SQLite.get` (7654); `SQLite.prepare` (7654); `Store.sql` (7654) | CORE |
| [packages/store/src/store.ts:7710](../../packages/store/src/store.ts#L7710) `Store/containerRange` | `SQLite.all` (7710); `SQLite.prepare` (7710, 7717); `Store.sql` (7710, 7717); `SQLite.get` (7717) | CORE |
| [packages/store/src/store.ts:7481](../../packages/store/src/store.ts#L7481) `Store/containerReferences` | `SQLite.all` (7481, 7500, 7502, 7508, 7521, 7532, 7546); `SQLite.prepare` (7481, 7500, 7502, 7508, 7521, 7532, 7544, 7546); `Store.sql` (7481, 7500, 7502, 7508, 7521, 7532, 7544, 7546); `SQLite.get` (7544); `Store.row` (7555) | CORE |
| [packages/store/src/store.ts:9981](../../packages/store/src/store.ts#L9981) `Store/countIds` | `Store.countIds` (9981); `SQLite.get` (9985); `SQLite.prepare` (9985); `Store.sql` (9985) | GATED-STORE |
| [packages/store/src/store.ts:8843](../../packages/store/src/store.ts#L8843) `Store/create` | `SQLite.get` (8843, 8849); `SQLite.prepare` (8843, 8849, 8862); `Store.sql` (8843, 8849, 8862) | CORE |
| [packages/store/src/store.ts:3447](../../packages/store/src/store.ts#L3447) `Store/createAccount` | `SQLite.get` (3447); `SQLite.prepare` (3447, 3451, 3457, 3462, 3467); `Store.sql` (3447, 3451, 3457, 3462, 3467) | CORE |
| [packages/store/src/store.ts:4857](../../packages/store/src/store.ts#L4857) `Store/createApiToken` | `SQLite.get` (4857, 4885); `SQLite.prepare` (4857, 4884, 4885, 4895); `Store.sql` (4857, 4884, 4885, 4895) | CORE |
| [packages/store/src/store.ts:4421](../../packages/store/src/store.ts#L4421) `Store/createLocalAccount` | `SQLite.prepare` (4421); `Store.sql` (4421) | CORE |
| [packages/store/src/store.ts:3124](../../packages/store/src/store.ts#L3124) `Store/credentialIdentity` | `SQLite.get` (3124); `SQLite.prepare` (3124); `Store.sql` (3124) | CORE |
| [packages/store/src/store.ts:1796](../../packages/store/src/store.ts#L1796) `Store/dataVersion` | `SQLite.get` (1796); `SQLite.prepare` (1796); `Store.sql` (1796) | CORE |
| [packages/store/src/store.ts:9573](../../packages/store/src/store.ts#L9573) `Store/delete` | `Store.row` (9573) | CORE |
| [packages/store/src/store.ts:9581](../../packages/store/src/store.ts#L9581) `Store/delete/run` | `SQLite.get` (9581); `SQLite.prepare` (9581, 9586); `Store.sql` (9581, 9586) | CORE |
| [packages/store/src/store.ts:4575](../../packages/store/src/store.ts#L4575) `Store/deleteAccount` | `SQLite.prepare` (4575, 4579, 4580, 4581, 4582, 4583, 4584, 4585, 4586, 4593, 4595, 4597, 4599, 4603); `Store.sql` (4575, 4579, 4580, 4581, 4582, 4583, 4584, 4585, 4586, 4593, 4595, 4597, 4599, 4603) | CORE |
| [packages/store/src/store.ts:5555](../../packages/store/src/store.ts#L5555) `Store/deletePrivilegeSet` | `SQLite.prepare` (5555); `Store.sql` (5555) | CORE |
| [packages/store/src/store.ts:3585](../../packages/store/src/store.ts#L3585) `Store/deleteScriptTest` | `SQLite.prepare` (3585); `Store.sql` (3585) | CORE |
| [packages/store/src/store.ts:2769](../../packages/store/src/store.ts#L2769) `Store/deletedRows` | `SQLite.get` (2769); `SQLite.prepare` (2769, 2771, 2771); `Store.sql` (2769, 2771, 2771); `SQLite.all` (2771, 2771) | CORE |
| [packages/store/src/store.ts:2879](../../packages/store/src/store.ts#L2879) `Store/designEffect` | `Store.sql` (2879, 2884, 2889, 2894, 2897, 2903, 2914, 2915, 2917, 2930, 2931, 2934, 2936, 2942, 2943, 2944, 2949, 2951, 2955, 2958, 2959, 2961, 2964, 2970, 2972, 2979, 2980, 2982, 2983, 2984, 2985, 2992, 2993, 2995, 2995, 2997, 2998, 2999, 3003, 3007, 3009, 3047, 3049, 3051); `SQLite.get` (2914, 2930, 2942, 2943, 2955, 2959, 2995, 3003); `SQLite.prepare` (2914, 2915, 2930, 2931, 2942, 2943, 2949, 2951, 2955, 2959, 2970, 2972, 2985, 2992, 2993, 2995, 2997, 2999, 3003, 3007); `SQLite.all` (2992, 2993); `SQLite.iterate` (2997) | CORE |
| [packages/store/src/store.ts:2872](../../packages/store/src/store.ts#L2872) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2872); `Store.sql` (2872) | CORE |
| [packages/store/src/store.ts:2856](../../packages/store/src/store.ts#L2856) `Store/designEffect/renameKey` | `SQLite.prepare` (2856); `Store.sql` (2856) | CORE |
| [packages/store/src/store.ts:2810](../../packages/store/src/store.ts#L2810) `Store/designHistory` | `SQLite.all` (2810); `SQLite.prepare` (2810); `Store.sql` (2810) | CORE |
| [packages/store/src/store.ts:5142](../../packages/store/src/store.ts#L5142) `Store/disableTotp` | `SQLite.prepare` (5142); `Store.sql` (5142) | CORE |
| [packages/store/src/store.ts:3059](../../packages/store/src/store.ts#L3059) `Store/dropColumnIndexes` | `SQLite.all` (3059, 3061); `SQLite.prepare` (3059, 3061); `Store.sql` (3059, 3061, 3062) | CORE |
| [packages/store/src/store.ts:8249](../../packages/store/src/store.ts#L8249) `Store/dropFieldIndex` | `SQLite.get` (8249); `SQLite.prepare` (8249); `Store.sql` (8249, 8250) | CORE |
| [packages/store/src/store.ts:8886](../../packages/store/src/store.ts#L8886) `Store/duplicate` | `Store.row` (8886); `SQLite.get` (8890); `SQLite.prepare` (8890, 8905); `Store.sql` (8890, 8905) | CORE |
| [packages/store/src/store.ts:7897](../../packages/store/src/store.ts#L7897) `Store/embeddedContainerCount` | `SQLite.prepare` (7897); `Store.sql` (7897); `SQLite.get` (7898) | CORE |
| [packages/store/src/store.ts:7883](../../packages/store/src/store.ts#L7883) `Store/embeddedContainers` | `SQLite.prepare` (7883, 7884); `Store.sql` (7883, 7884); `SQLite.all` (7884); `SQLite.get` (7888) | CORE |
| [packages/store/src/store.ts:2795](../../packages/store/src/store.ts#L2795) `Store/emptyDeleted` | `Store.sql` (2795, 2798, 2799, 2801, 2803); `SQLite.prepare` (2799) | CORE |
| [packages/store/src/store.ts:1676](../../packages/store/src/store.ts#L1676) `Store/endTransaction` | `Store.sql` (1676, 1679, 1679) | CORE |
| [packages/store/src/store.ts:5110](../../packages/store/src/store.ts#L5110) `Store/enrollTotp` | `SQLite.prepare` (5110); `Store.sql` (5110) | CORE |
| [packages/store/src/store.ts:2764](../../packages/store/src/store.ts#L2764) `Store/ensureDeleted` | `Store.sql` (2764) | CORE |
| [packages/store/src/store.ts:1244](../../packages/store/src/store.ts#L1244) `Store/ensureNativeIds` | `SQLite.all` (1244, 1256); `SQLite.prepare` (1244, 1247, 1255, 1256); `Store.sql` (1244, 1247, 1250, 1254, 1255, 1256, 1259, 1261) | CORE |
| [packages/store/src/store.ts:9227](../../packages/store/src/store.ts#L9227) `Store/evaluateCurrent` | `Store.row` (9227, 9227, 9228, 9228); `Calculations.context` (9233); `Store.get` (9234, 9236) | GATED-STORE |
| [packages/store/src/store.ts:9268](../../packages/store/src/store.ts#L9268) `Store/evaluateEachCurrent` | `Store.row` (9268, 9268, 9273); `Calculations.context` (9274); `Store.get` (9276) | GATED-STORE |
| [packages/store/src/store.ts:9330](../../packages/store/src/store.ts#L9330) `Store/evaluateRowsCurrent` | `Store.row` (9330, 9330, 9331, 9331) | GATED-STORE |
| [packages/store/src/store.ts:9309](../../packages/store/src/store.ts#L9309) `Store/evaluateRowsCurrent/each` | `Calculations.context` (9309); `Store.get` (9311) | GATED-STORE |
| [packages/store/src/store.ts:9345](../../packages/store/src/store.ts#L9345) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (9345) | GATED-STORE |
| [packages/store/src/store.ts:9367](../../packages/store/src/store.ts#L9367) `Store/evaluateRowsCurrent/key` | `Calculations.context` (9367) | GATED-STORE |
| [packages/store/src/store.ts:3391](../../packages/store/src/store.ts#L3391) `Store/externalAccount` | `SQLite.all` (3391); `SQLite.prepare` (3391); `Store.sql` (3391) | CORE |
| [packages/store/src/store.ts:7402](../../packages/store/src/store.ts#L7402) `Store/externalContainerCheck` | `SQLite.all` (7402); `SQLite.prepare` (7402); `Store.sql` (7402) | CORE |
| [packages/store/src/store.ts:7409](../../packages/store/src/store.ts#L7409) `Store/externalContainerCount` | `SQLite.get` (7409); `SQLite.prepare` (7409); `Store.sql` (7409) | CORE |
| [packages/store/src/store.ts:7418](../../packages/store/src/store.ts#L7418) `Store/externalContainerReport` | `SQLite.all` (7418, 7431); `SQLite.prepare` (7418, 7431); `Store.sql` (7418, 7431) | CORE |
| [packages/store/src/store.ts:4660](../../packages/store/src/store.ts#L4660) `Store/externalIdentityId` | `SQLite.get` (4660, 4666); `SQLite.prepare` (4660, 4665, 4666); `Store.sql` (4660, 4665, 4666) | CORE |
| [packages/store/src/store.ts:7650](../../packages/store/src/store.ts#L7650) `Store/externalOf` | `SQLite.get` (7650); `SQLite.prepare` (7650); `Store.sql` (7650) | CORE |
| [packages/store/src/store.ts:2702](../../packages/store/src/store.ts#L2702) `Store/failureAuditRoom` | `SQLite.get` (2702); `SQLite.prepare` (2702); `Store.sql` (2702) | CORE |
| [packages/store/src/store.ts:7062](../../packages/store/src/store.ts#L7062) `Store/fieldIndexCurrent` | `SQLite.iterate` (7062); `SQLite.prepare` (7062, 7067); `Store.sql` (7062, 7067); `SQLite.all` (7067) | GATED-STORE |
| [packages/store/src/store.ts:8284](../../packages/store/src/store.ts#L8284) `Store/find` | `Store.find` (8284) | GATED-STORE |
| [packages/store/src/store.ts:8656](../../packages/store/src/store.ts#L8656) `Store/findCandidates` | `Store.query` (8656) | CORE |
| [packages/store/src/store.ts:8295](../../packages/store/src/store.ts#L8295) `Store/findHere` | `Store.query` (8295, 8300, 8302, 8316, 8318, 8329); `Store.recordCount` (8313); `SQLite.get` (8314, 8318); `SQLite.prepare` (8314, 8318, 8324, 8331, 8340); `Store.sql` (8314, 8318, 8324, 8331, 8340); `SQLite.all` (8324, 8331, 8340) | GATED-STORE |
| [packages/store/src/store.ts:8335](../../packages/store/src/store.ts#L8335) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (8335); `SQLite.prepare` (8335); `Store.sql` (8335) | GATED-STORE |
| [packages/store/src/store.ts:10026](../../packages/store/src/store.ts#L10026) `Store/findIdsCurrent` | `Store.findIds` (10026) | GATED-STORE |
| [packages/store/src/store.ts:10032](../../packages/store/src/store.ts#L10032) `Store/findIdsHere` | `Store.query` (10032, 10037, 10039); `SQLite.iterate` (10050); `SQLite.prepare` (10050); `Store.sql` (10050) | GATED-STORE |
| [packages/store/src/store.ts:8600](../../packages/store/src/store.ts#L8600) `Store/findSource` | `Store.query` (8600); `SQLite.all` (8609, 8626); `SQLite.prepare` (8609, 8617, 8625); `Store.sql` (8609, 8614, 8617, 8622, 8625, 8639, 8641); `Calculations.globalValue` (8631); `Calculations.unstoredValue` (8632); `Calculations.related` (8636) | CORE |
| [packages/store/src/store.ts:9622](../../packages/store/src/store.ts#L9622) `Store/forgetStandInValues` | `Store.sql` (9622, 9643); `SQLite.prepare` (9643) | CORE |
| [packages/store/src/store.ts:4542](../../packages/store/src/store.ts#L4542) `Store/forgetStandIns` | `SQLite.prepare` (4542); `Store.sql` (4542) | CORE |
| [packages/store/src/store.ts:6944](../../packages/store/src/store.ts#L6944) `Store/foundSetPage` | `rowsById` (6944) | CORE |
| [packages/store/src/store.ts:6960](../../packages/store/src/store.ts#L6960) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6960); `Store.row` (6976) | GATED-STORE |
| [packages/store/src/store.ts:3310](../../packages/store/src/store.ts#L3310) `Store/gateAgentWrite` | `SQLite.get` (3310); `SQLite.prepare` (3310, 3312); `Store.sql` (3310, 3312) | CORE |
| [packages/store/src/store.ts:5408](../../packages/store/src/store.ts#L5408) `Store/generateRecoveryCodes` | `SQLite.prepare` (5408, 5411); `Store.sql` (5408, 5411) | CORE |
| [packages/store/src/store.ts:8728](../../packages/store/src/store.ts#L8728) `Store/getCurrent` | `Store.get` (8728); `Store.row` (8729, 8729, 8743); `SQLite.all` (8746); `SQLite.prepare` (8746); `Store.sql` (8746) | GATED-STORE |
| [packages/store/src/store.ts:8766](../../packages/store/src/store.ts#L8766) `Store/getManyCurrent` | `Store.getMany` (8766); `SQLite.get` (8784); `SQLite.prepare` (8784); `Store.sql` (8784) | GATED-STORE |
| [packages/store/src/store.ts:8777](../../packages/store/src/store.ts#L8777) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8777) | GATED-STORE |
| [packages/store/src/store.ts:1291](../../packages/store/src/store.ts#L1291) `Store/grantFullAccessClients` | `SQLite.prepare` (1291); `Store.sql` (1291) | CORE |
| [packages/store/src/store.ts:10067](../../packages/store/src/store.ts#L10067) `Store/groupSummariesCurrent` | `Store.groupSummaries` (10067); `Store.viewableIds` (10072); `Calculations.collect` (10088); `rowsById` (10088, 10138); `Calculations.collector` (10110) | GATED-STORE |
| [packages/store/src/store.ts:10136](../../packages/store/src/store.ts#L10136) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (10136) | GATED-STORE |
| [packages/store/src/store.ts:10100](../../packages/store/src/store.ts#L10100) `Store/groupSummariesCurrent/key` | `Calculations.value` (10100); `Calculations.related` (10102) | GATED-STORE |
| [packages/store/src/store.ts:1299](../../packages/store/src/store.ts#L1299) `Store/hasOwnPassword` | `SQLite.get` (1299); `SQLite.prepare` (1299); `Store.sql` (1299) | CORE |
| [packages/store/src/store.ts:5267](../../packages/store/src/store.ts#L5267) `Store/hasPasskey` | `SQLite.get` (5267); `SQLite.prepare` (5267); `Store.sql` (5267) | CORE |
| [packages/store/src/store.ts:8203](../../packages/store/src/store.ts#L8203) `Store/hasTable` | `SQLite.get` (8203); `SQLite.prepare` (8203); `Store.sql` (8203) | CORE |
| [packages/store/src/store.ts:5131](../../packages/store/src/store.ts#L5131) `Store/hasTotp` | `SQLite.get` (5131); `SQLite.prepare` (5131); `Store.sql` (5131) | CORE |
| [packages/store/src/store.ts:4639](../../packages/store/src/store.ts#L4639) `Store/identityAllowed` | `SQLite.get` (4639, 4645, 4651); `SQLite.prepare` (4639, 4645, 4651); `Store.sql` (4639, 4645, 4651) | CORE |
| [packages/store/src/store.ts:6419](../../packages/store/src/store.ts#L6419) `Store/image` | `SQLite.get` (6419); `SQLite.prepare` (6419); `Store.sql` (6419) | CORE |
| [packages/store/src/store.ts:6429](../../packages/store/src/store.ts#L6429) `Store/images` | `SQLite.all` (6429); `SQLite.prepare` (6429); `Store.sql` (6429) | CORE |
| [packages/store/src/store.ts:4386](../../packages/store/src/store.ts#L4386) `Store/importAccounts` | `SQLite.all` (4386); `SQLite.prepare` (4386); `Store.sql` (4386) | CORE |
| [packages/store/src/store.ts:1545](../../packages/store/src/store.ts#L1545) `Store/independentWindowWrite` | `SQLite.get` (1545); `SQLite.prepare` (1545, 1575); `Store.sql` (1545, 1554, 1570, 1575, 1578) | CORE |
| [packages/store/src/store.ts:8215](../../packages/store/src/store.ts#L8215) `Store/indexedFields` | `SQLite.all` (8215, 8216); `SQLite.prepare` (8215, 8216); `Store.sql` (8215, 8216) | CORE |
| [packages/store/src/store.ts:10434](../../packages/store/src/store.ts#L10434) `Store/internalRoots` | `SQLite.get` (10434); `SQLite.prepare` (10434, 10436); `SQLite.all` (10436) | CORE |
| [packages/store/src/store.ts:3146](../../packages/store/src/store.ts#L3146) `Store/isAgent` | `SQLite.get` (3146); `SQLite.prepare` (3146); `Store.sql` (3146) | CORE |
| [packages/store/src/store.ts:3249](../../packages/store/src/store.ts#L3249) `Store/isExternal` | `SQLite.get` (3249); `SQLite.prepare` (3249); `Store.sql` (3249) | CORE |
| [packages/store/src/store.ts:5184](../../packages/store/src/store.ts#L5184) `Store/issueWebauthnChallenge` | `SQLite.prepare` (5184, 5186, 5187, 5189); `Store.sql` (5184, 5186, 5187, 5189); `SQLite.get` (5186) | CORE |
| [packages/store/src/store.ts:10341](../../packages/store/src/store.ts#L10341) `Store/iterateCommitted` | `SQLite.iterate` (10341) | CORE |
| [packages/store/src/store.ts:1522](../../packages/store/src/store.ts#L1522) `Store/joinTransaction` | `Store.sql` (1522, 1523, 1525, 1527, 1533) | CORE |
| [packages/store/src/store.ts:9824](../../packages/store/src/store.ts#L9824) `Store/keyStepWork` | `Store.sql` (9824, 9830, 9834, 9836) | CORE |
| [packages/store/src/store.ts:6286](../../packages/store/src/store.ts#L6286) `Store/knownSharedAccount` | `SQLite.get` (6286); `SQLite.prepare` (6286); `Store.sql` (6286) | CORE |
| [packages/store/src/store.ts:3859](../../packages/store/src/store.ts#L3859) `Store/lastSignIns` | `Store.auditLog` (3859) | CORE |
| [packages/store/src/store.ts:6459](../../packages/store/src/store.ts#L6459) `Store/layout` | `SQLite.get` (6459); `SQLite.prepare` (6459); `Store.sql` (6459) | CORE |
| [packages/store/src/store.ts:2827](../../packages/store/src/store.ts#L2827) `Store/layoutHistory` | `SQLite.all` (2827); `SQLite.prepare` (2827); `Store.sql` (2827) | CORE |
| [packages/store/src/store.ts:6349](../../packages/store/src/store.ts#L6349) `Store/layouts` | `SQLite.all` (6349); `SQLite.prepare` (6349); `Store.sql` (6349) | CORE |
| [packages/store/src/store.ts:4159](../../packages/store/src/store.ts#L4159) `Store/leastPrivilege` | `SQLite.all` (4159); `SQLite.prepare` (4159); `Store.sql` (4159) | CORE |
| [packages/store/src/store.ts:4723](../../packages/store/src/store.ts#L4723) `Store/ledgerRow` | `SQLite.get` (4723, 4724); `SQLite.prepare` (4723, 4724); `Store.sql` (4723, 4724) | AUTH |
| [packages/store/src/store.ts:4735](../../packages/store/src/store.ts#L4735) `Store/ledgerWrite` | `Store.sql` (4735, 4736, 4738, 4740, 4743, 4743) | AUTH |
| [packages/store/src/store.ts:4469](../../packages/store/src/store.ts#L4469) `Store/limitAccountImport` | `SQLite.prepare` (4469, 4470, 4473); `Store.sql` (4469, 4470, 4473); `SQLite.get` (4470) | CORE |
| [packages/store/src/store.ts:3099](../../packages/store/src/store.ts#L3099) `Store/linkIdentity` | `SQLite.get` (3099); `SQLite.prepare` (3099); `Store.sql` (3099) | CORE |
| [packages/store/src/store.ts:3091](../../packages/store/src/store.ts#L3091) `Store/linkPrincipal` | `SQLite.get` (3091); `SQLite.prepare` (3091); `Store.sql` (3091) | CORE |
| [packages/store/src/store.ts:2728](../../packages/store/src/store.ts#L2728) `Store/logSecurity` | `Store.sql` (2728) | CORE |
| [packages/store/src/store.ts:3745](../../packages/store/src/store.ts#L3745) `Store/markPiiField` | `SQLite.prepare` (3745); `Store.sql` (3745) | CORE |
| [packages/store/src/store.ts:7375](../../packages/store/src/store.ts#L7375) `Store/markRepeating` | `SQLite.prepare` (7375); `Store.sql` (7375) | CORE |
| [packages/store/src/store.ts:10274](../../packages/store/src/store.ts#L10274) `Store/matchIds` | `Store.matchIds` (10274); `SQLite.all` (10280); `SQLite.prepare` (10280); `Store.sql` (10280) | CORE |
| [packages/store/src/store.ts:1314](../../packages/store/src/store.ts#L1314) `Store/meta` | `SQLite.get` (1314); `SQLite.prepare` (1314); `Store.sql` (1314) | CORE |
| [packages/store/src/store.ts:923](../../packages/store/src/store.ts#L923) `Store/metadataVersions` | `SQLite.get` (923); `SQLite.prepare` (923); `Store.sql` (923) | CORE |
| [packages/store/src/store.ts:8012](../../packages/store/src/store.ts#L8012) `Store/moveContainersIn` | `Store.sql` (8012, 8018, 8020, 8021, 8022, 8023, 8043, 8048, 8048, 8059, 8062, 8065, 8072); `SQLite.prepare` (8020, 8021, 8022, 8023, 8059, 8065); `SQLite.get` (8025, 8059, 8065) | CORE |
| [packages/store/src/store.ts:7934](../../packages/store/src/store.ts#L7934) `Store/moveContainersOut` | `Store.sql` (7934, 7942, 7944, 7946, 7951, 7952, 7972, 7978, 7980, 7982, 7982, 7988, 7988, 7993, 7995, 7997, 7997, 8003); `SQLite.get` (7942); `SQLite.prepare` (7942, 7951, 7952); `Store.container` (7954) | CORE |
| [packages/store/src/store.ts:4340](../../packages/store/src/store.ts#L4340) `Store/mustChangePassword` | `SQLite.get` (4340); `SQLite.prepare` (4340); `Store.sql` (4340) | CORE |
| [packages/store/src/store.ts:1269](../../packages/store/src/store.ts#L1269) `Store/nativeIdGuards` | `Store.sql` (1269, 1270, 1272) | CORE |
| [packages/store/src/store.ts:5011](../../packages/store/src/store.ts#L5011) `Store/objectUseSince` | `SQLite.get` (5011); `SQLite.prepare` (5011); `Store.sql` (5011) | CORE |
| [packages/store/src/store.ts:8175](../../packages/store/src/store.ts#L8175) `Store/orderBy` | `Store.valueListItems` (8175) | CORE |
| [packages/store/src/store.ts:7567](../../packages/store/src/store.ts#L7567) `Store/orphanContainerReport` | `SQLite.all` (7567); `SQLite.prepare` (7567); `Store.sql` (7567) | CORE |
| [packages/store/src/store.ts:5236](../../packages/store/src/store.ts#L5236) `Store/passkeyAllowList` | `SQLite.all` (5236); `SQLite.prepare` (5236); `Store.sql` (5236) | CORE |
| [packages/store/src/store.ts:5272](../../packages/store/src/store.ts#L5272) `Store/passkeyIds` | `SQLite.all` (5272); `SQLite.prepare` (5272); `Store.sql` (5272) | CORE |
| [packages/store/src/store.ts:5260](../../packages/store/src/store.ts#L5260) `Store/passkeys` | `SQLite.all` (5260); `SQLite.prepare` (5260); `Store.sql` (5260) | CORE |
| [packages/store/src/store.ts:4379](../../packages/store/src/store.ts#L4379) `Store/passwordDaysRemaining` | `SQLite.get` (4379); `SQLite.prepare` (4379); `Store.sql` (4379) | CORE |
| [packages/store/src/store.ts:3334](../../packages/store/src/store.ts#L3334) `Store/pendingChanges` | `SQLite.all` (3334); `SQLite.prepare` (3334); `Store.sql` (3334) | CORE |
| [packages/store/src/store.ts:1332](../../packages/store/src/store.ts#L1332) `Store/persistentData` | `SQLite.get` (1332) | CORE |
| [packages/store/src/store.ts:1341](../../packages/store/src/store.ts#L1341) `Store/persistentDataIds` | `SQLite.all` (1341) | CORE |
| [packages/store/src/store.ts:1322](../../packages/store/src/store.ts#L1322) `Store/persistentTable` | `Store.sql` (1322) | CORE |
| [packages/store/src/store.ts:9515](../../packages/store/src/store.ts#L9515) `Store/portalContainerTarget` | `Store.row` (9515); `relatedIdList` (9517) | CORE |
| [packages/store/src/store.ts:6999](../../packages/store/src/store.ts#L6999) `Store/portalCountsCurrent` | `Store.canView` (6999); `Store.row` (7026) | GATED-STORE |
| [packages/store/src/store.ts:7237](../../packages/store/src/store.ts#L7237) `Store/portalRows` | `relatedRows` (7237); `relatedIdList` (7238); `Store.viewableIds` (7241); `rowsById` (7266, 7304); `Calculations.related` (7280) | CORE |
| [packages/store/src/store.ts:7248](../../packages/store/src/store.ts#L7248) `Store/portalRows/context` | `Calculations.context` (7248) | CORE |
| [packages/store/src/store.ts:7258](../../packages/store/src/store.ts#L7258) `Store/portalRows/valueOf` | `Calculations.value` (7258) | CORE |
| [packages/store/src/store.ts:2261](../../packages/store/src/store.ts#L2261) `Store/prepared` | `SQLite.prepare` (2261); `Store.sql` (2261) | CORE |
| [packages/store/src/store.ts:4451](../../packages/store/src/store.ts#L4451) `Store/previewAccountImport` | `Store.sql` (4451, 4452, 4461) | CORE |
| [packages/store/src/store.ts:6050](../../packages/store/src/store.ts#L6050) `Store/previewRecordRuleCurrent` | `SQLite.get` (6050); `SQLite.prepare` (6050, 6053); `Store.sql` (6050, 6053); `SQLite.all` (6053); `Calculations.context` (6059, 6075) | CORE |
| [packages/store/src/store.ts:8691](../../packages/store/src/store.ts#L8691) `Store/previewRow` | `Store.row` (8691) | CORE |
| [packages/store/src/store.ts:5483](../../packages/store/src/store.ts#L5483) `Store/privilegeSets` | `Store.sql` (5483) | CORE |
| [packages/store/src/store.ts:2472](../../packages/store/src/store.ts#L2472) `Store/pruneAudit` | `Store.sql` (2472, 2474, 2476); `SQLite.get` (2474); `SQLite.prepare` (2474) | CORE |
| [packages/store/src/store.ts:7602](../../packages/store/src/store.ts#L7602) `Store/purgeOrphanContainers` | `Store.sql` (7602, 7606, 7615, 7618, 7619, 7624, 7625, 7627, 7627); `Store.orphanContainerReport` (7610); `SQLite.get` (7615); `SQLite.prepare` (7615, 7618, 7619) | CORE |
| [packages/store/src/store.ts:10533](../../packages/store/src/store.ts#L10533) `Store/query` | `SQLite.iterate` (10533) | CORE |
| [packages/store/src/store.ts:10567](../../packages/store/src/store.ts#L10567) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10567); `SQLite.all` (10574, 10577); `SQLite.prepare` (10574, 10577) | CORE |
| [packages/store/src/store.ts:10375](../../packages/store/src/store.ts#L10375) `Store/readOnlyChecked` | `SQLite.prepare` (10375, 10379, 10388, 10393); `SQLite.all` (10379, 10388, 10393) | CORE |
| [packages/store/src/store.ts:3071](../../packages/store/src/store.ts#L3071) `Store/recompute` | `SQLite.prepare` (3071, 3075); `Store.sql` (3071, 3075); `SQLite.iterate` (3075); `Calculations.computeStoredStyled` (3076); `Calculations.value` (3076) | CORE |
| [packages/store/src/store.ts:2276](../../packages/store/src/store.ts#L2276) `Store/recordAsOf` | `SQLite.get` (2276, 2278); `SQLite.prepare` (2276, 2278, 2280, 2281); `Store.sql` (2276, 2278, 2280, 2281); `SQLite.all` (2280, 2281) | CORE |
| [packages/store/src/store.ts:1979](../../packages/store/src/store.ts#L1979) `Store/recordCount` | `SQLite.get` (1979); `SQLite.prepare` (1979); `Store.sql` (1979) | CORE |
| [packages/store/src/store.ts:4942](../../packages/store/src/store.ts#L4942) `Store/recordObjectUse` | `Store.sql` (4942) | CORE |
| [packages/store/src/store.ts:9217](../../packages/store/src/store.ts#L9217) `Store/recordViewable` | `Store.row` (9217) | GATED-STORE |
| [packages/store/src/store.ts:1379](../../packages/store/src/store.ts#L1379) `Store/recordedFormat` | `Store.sql` (1379) | CORE |
| [packages/store/src/store.ts:7906](../../packages/store/src/store.ts#L7906) `Store/recoverContainersOut` | `SQLite.prepare` (7906); `Store.sql` (7906); `SQLite.get` (7909) | CORE |
| [packages/store/src/store.ts:1460](../../packages/store/src/store.ts#L1460) `Store/recoverPendingExternalFiles` | `Store.sql` (1460, 1462, 1486, 1488); `SQLite.prepare` (1462); `SQLite.get` (1473) | CORE |
| [packages/store/src/store.ts:5426](../../packages/store/src/store.ts#L5426) `Store/recoveryCodesRemaining` | `SQLite.get` (5426); `SQLite.prepare` (5426); `Store.sql` (5426) | CORE |
| [packages/store/src/store.ts:10415](../../packages/store/src/store.ts#L10415) `Store/refreshDecimalSqlViews` | `SQLite.get` (10415); `SQLite.prepare` (10415, 10420); `SQLite.all` (10420) | CORE |
| [packages/store/src/store.ts:3240](../../packages/store/src/store.ts#L3240) `Store/refuseLookalikeAccount` | `SQLite.all` (3240); `SQLite.prepare` (3240); `Store.sql` (3240) | CORE |
| [packages/store/src/store.ts:5294](../../packages/store/src/store.ts#L5294) `Store/registerPasskey` | `SQLite.prepare` (5294); `Store.sql` (5294) | CORE |
| [packages/store/src/store.ts:3369](../../packages/store/src/store.ts#L3369) `Store/rejectPending` | `SQLite.get` (3369); `SQLite.prepare` (3369, 3371); `Store.sql` (3369, 3371) | CORE |
| [packages/store/src/store.ts:8443](../../packages/store/src/store.ts#L8443) `Store/relatedCriteria` | `SQLite.iterate` (8443); `SQLite.prepare` (8443); `Store.sql` (8443) | CORE |
| [packages/store/src/store.ts:8440](../../packages/store/src/store.ts#L8440) `Store/relatedCriteria/matched` | `relatedRows` (8440) | CORE |
| [packages/store/src/store.ts:6787](../../packages/store/src/store.ts#L6787) `Store/relatedValues` | `Calculations.globalValue` (6787); `Calculations.unstoredValue` (6789) | CORE |
| [packages/store/src/store.ts:5305](../../packages/store/src/store.ts#L5305) `Store/removePasskey` | `SQLite.get` (5305); `SQLite.prepare` (5305, 5306); `Store.sql` (5305, 5306) | CORE |
| [packages/store/src/store.ts:9662](../../packages/store/src/store.ts#L9662) `Store/restoreDeletedRowLocked` | `SQLite.get` (9662, 9667); `SQLite.prepare` (9662, 9663, 9667, 9677); `Store.sql` (9662, 9663, 9667, 9677); `SQLite.all` (9663) | CORE |
| [packages/store/src/store.ts:2311](../../packages/store/src/store.ts#L2311) `Store/restoreRecord` | `Store.recordAsOf` (2311); `SQLite.get` (2315); `SQLite.prepare` (2315, 2320, 2329, 2340); `Store.sql` (2315, 2320, 2329, 2340) | CORE |
| [packages/store/src/store.ts:2355](../../packages/store/src/store.ts#L2355) `Store/revertAuditEntry` | `Store.auditLog` (2355) | CORE |
| [packages/store/src/store.ts:5067](../../packages/store/src/store.ts#L5067) `Store/revokeApiToken` | `SQLite.prepare` (5067); `Store.sql` (5067) | CORE |
| [packages/store/src/store.ts:8709](../../packages/store/src/store.ts#L8709) `Store/row` | `SQLite.get` (8709) | CORE |
| [packages/store/src/store.ts:5876](../../packages/store/src/store.ts#L5876) `Store/ruleOutcome` | `Calculations.context` (5876) | CORE |
| [packages/store/src/store.ts:8554](../../packages/store/src/store.ts#L8554) `Store/runningSummaryValues` | `Store.viewableIds` (8554); `rowsById` (8556); `Calculations.value` (8567, 8573); `Calculations.related` (8584) | GATED-STORE |
| [packages/store/src/store.ts:5512](../../packages/store/src/store.ts#L5512) `Store/savePrivilegeSet` | `SQLite.prepare` (5512, 5520); `Store.sql` (5512, 5520) | AUTH |
| [packages/store/src/store.ts:3576](../../packages/store/src/store.ts#L3576) `Store/saveScriptTest` | `SQLite.prepare` (3576); `Store.sql` (3576) | CORE |
| [packages/store/src/store.ts:6015](../../packages/store/src/store.ts#L6015) `Store/scopedTableSql` | `Store.viewableIds` (6015); `SQLite.all` (6018); `SQLite.prepare` (6018); `Store.sql` (6018) | GATED-STORE |
| [packages/store/src/store.ts:2817](../../packages/store/src/store.ts#L2817) `Store/scriptHistory` | `SQLite.all` (2817); `SQLite.prepare` (2817); `Store.sql` (2817) | CORE |
| [packages/store/src/store.ts:2647](../../packages/store/src/store.ts#L2647) `Store/securityChange` | `Store.sql` (2647, 2649); `SQLite.prepare` (2649) | CORE |
| [packages/store/src/store.ts:2235](../../packages/store/src/store.ts#L2235) `Store/securityEvents` | `Store.auditLog` (2235) | CORE |
| [packages/store/src/store.ts:4791](../../packages/store/src/store.ts#L4791) `Store/securityToken` | `SQLite.get` (4791); `SQLite.prepare` (4791); `Store.sql` (4791) | CORE |
| [packages/store/src/store.ts:10469](../../packages/store/src/store.ts#L10469) `Store/selectCurrent` | `SQLite.iterate` (10469) | CORE |
| [packages/store/src/store.ts:10493](../../packages/store/src/store.ts#L10493) `Store/selectHeldCurrent` | `Store.sql` (10493, 10494); `SQLite.prepare` (10494); `SQLite.iterate` (10497) | CORE |
| [packages/store/src/store.ts:9967](../../packages/store/src/store.ts#L9967) `Store/selectIdsCurrent` | `Store.selectIds` (9967); `SQLite.all` (9973); `SQLite.prepare` (9973); `Store.sql` (9973) | GATED-STORE |
| [packages/store/src/store.ts:10485](../../packages/store/src/store.ts#L10485) `Store/selectIn` | `Store.select` (10485) | CORE |
| [packages/store/src/store.ts:1726](../../packages/store/src/store.ts#L1726) `Store/selfContainedCopy` | `Store.sql` (1726); `SQLite.all` (1731); `SQLite.prepare` (1731, 1733, 1734, 1735) | CORE |
| [packages/store/src/store.ts:4620](../../packages/store/src/store.ts#L4620) `Store/setAccountActive` | `SQLite.prepare` (4620, 4623, 4624); `Store.sql` (4620, 4623, 4624) | AUTH |
| [packages/store/src/store.ts:4810](../../packages/store/src/store.ts#L4810) `Store/setAccountLocalOnly` | `SQLite.prepare` (4810); `Store.sql` (4810) | CORE |
| [packages/store/src/store.ts:5667](../../packages/store/src/store.ts#L5667) `Store/setAccountPrivilegeSet` | `SQLite.get` (5667); `SQLite.prepare` (5667, 5670, 5674); `Store.sql` (5667, 5670, 5674) | AUTH |
| [packages/store/src/store.ts:4819](../../packages/store/src/store.ts#L4819) `Store/setAccountRequire2fa` | `SQLite.prepare` (4819); `Store.sql` (4819) | CORE |
| [packages/store/src/store.ts:3270](../../packages/store/src/store.ts#L3270) `Store/setAgentAccount` | `SQLite.get` (3270); `SQLite.prepare` (3270, 3276); `Store.sql` (3270, 3276) | CORE |
| [packages/store/src/store.ts:3620](../../packages/store/src/store.ts#L3620) `Store/setAiAllowed` | `SQLite.prepare` (3620); `Store.sql` (3620) | CORE |
| [packages/store/src/store.ts:3703](../../packages/store/src/store.ts#L3703) `Store/setAiPolicy` | `SQLite.prepare` (3703); `Store.sql` (3703) | CORE |
| [packages/store/src/store.ts:6273](../../packages/store/src/store.ts#L6273) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (6273); `Store.sql` (6273) | CORE |
| [packages/store/src/store.ts:2450](../../packages/store/src/store.ts#L2450) `Store/setAuditSettings` | `SQLite.prepare` (2450); `Store.sql` (2450) | CORE |
| [packages/store/src/store.ts:8125](../../packages/store/src/store.ts#L8125) `Store/setContainer` | `Store.sql` (8125, 8142); `Store.row` (8131); `SQLite.prepare` (8142) | CORE |
| [packages/store/src/store.ts:3222](../../packages/store/src/store.ts#L3222) `Store/setExternalAccount` | `SQLite.get` (3222); `SQLite.prepare` (3222, 3227); `Store.sql` (3222, 3227) | CORE |
| [packages/store/src/store.ts:4326](../../packages/store/src/store.ts#L4326) `Store/setMustChangePassword` | `SQLite.prepare` (4326); `Store.sql` (4326) | CORE |
| [packages/store/src/store.ts:3422](../../packages/store/src/store.ts#L3422) `Store/setPassword` | `SQLite.get` (3422); `SQLite.prepare` (3422, 3424, 3433); `Store.sql` (3422, 3424, 3433) | AUTH |
| [packages/store/src/store.ts:3517](../../packages/store/src/store.ts#L3517) `Store/setPasswordPolicy` | `SQLite.prepare` (3517); `Store.sql` (3517) | CORE |
| [packages/store/src/store.ts:1347](../../packages/store/src/store.ts#L1347) `Store/setPersistentData` | `SQLite.prepare` (1347, 1351); `Store.sql` (1347, 1351) | CORE |
| [packages/store/src/store.ts:3723](../../packages/store/src/store.ts#L3723) `Store/setPiiIsolation` | `SQLite.prepare` (3723); `Store.sql` (3723) | CORE |
| [packages/store/src/store.ts:3553](../../packages/store/src/store.ts#L3553) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3553); `Store.sql` (3553) | CORE |
| [packages/store/src/store.ts:3635](../../packages/store/src/store.ts#L3635) `Store/setScriptNetwork` | `SQLite.prepare` (3635); `Store.sql` (3635) | CORE |
| [packages/store/src/store.ts:3692](../../packages/store/src/store.ts#L3692) `Store/setSqlRequiresFmxdbc` | `SQLite.prepare` (3692); `Store.sql` (3692) | CORE |
| [packages/store/src/store.ts:9138](../../packages/store/src/store.ts#L9138) `Store/setStoredCalcValues` | `SQLite.prepare` (9138, 9139); `Store.sql` (9138, 9139); `SQLite.get` (9143) | CORE |
| [packages/store/src/store.ts:8207](../../packages/store/src/store.ts#L8207) `Store/setUserPref` | `Store.sql` (8207, 8208, 8209); `SQLite.prepare` (8208, 8209) | CORE |
| [packages/store/src/store.ts:3676](../../packages/store/src/store.ts#L3676) `Store/setWebViewerHosts` | `SQLite.prepare` (3676); `Store.sql` (3676) | CORE |
| [packages/store/src/store.ts:4762](../../packages/store/src/store.ts#L4762) `Store/settleSignIns` | `SQLite.all` (4762, 4768); `SQLite.prepare` (4762, 4768, 4774, 4778, 4780); `Store.sql` (4762, 4768, 4774, 4778, 4780) | AUTH |
| [packages/store/src/store.ts:1857](../../packages/store/src/store.ts#L1857) `Store/shareResults` | `Store.sql` (1857) | CORE |
| [packages/store/src/store.ts:1405](../../packages/store/src/store.ts#L1405) `Store/shipWal` | `Store.sql` (1405) | CORE |
| [packages/store/src/store.ts:4709](../../packages/store/src/store.ts#L4709) `Store/signInBase` | `SQLite.get` (4709); `SQLite.prepare` (4709); `Store.sql` (4709) | AUTH |
| [packages/store/src/store.ts:4711](../../packages/store/src/store.ts#L4711) `Store/signInBase/identity` | `SQLite.get` (4711); `SQLite.prepare` (4711); `Store.sql` (4711) | AUTH |
| [packages/store/src/store.ts:4699](../../packages/store/src/store.ts#L4699) `Store/signInMark` | `SQLite.prepare` (4699); `Store.sql` (4699) | AUTH |
| [packages/store/src/store.ts:10192](../../packages/store/src/store.ts#L10192) `Store/sortIdsCurrentProgress` | `SQLite.all` (10192); `SQLite.prepare` (10192, 10260); `Store.sql` (10192, 10260); `Store.valueListItems` (10200); `rowsById` (10212); `Calculations.globalValue` (10215); `Calculations.unstoredValue` (10216); `Calculations.related` (10222); `SQLite.iterate` (10260) | GATED-STORE |
| [packages/store/src/store.ts:8368](../../packages/store/src/store.ts#L8368) `Store/sortedPage` | `SQLite.iterate` (8368); `SQLite.prepare` (8368, 8383); `Store.sql` (8368, 8383); `SQLite.all` (8383) | CORE |
| [packages/store/src/store.ts:8516](../../packages/store/src/store.ts#L8516) `Store/summaries` | `Calculations.wholeTable` (8516); `Calculations.collect` (8536, 8541) | CORE |
| [packages/store/src/store.ts:8532](../../packages/store/src/store.ts#L8532) `Store/summaries/recs` | `SQLite.iterate` (8532); `SQLite.prepare` (8532); `Store.sql` (8532) | CORE |
| [packages/store/src/store.ts:5250](../../packages/store/src/store.ts#L5250) `Store/takeWebauthnChallenge` | `SQLite.get` (5250); `SQLite.prepare` (5250, 5252); `Store.sql` (5250, 5252) | CORE |
| [packages/store/src/store.ts:8260](../../packages/store/src/store.ts#L8260) `Store/timeFind` | `Store.query` (8260, 8264, 8265); `Store.recordCount` (8267) | CORE |
| [packages/store/src/store.ts:6728](../../packages/store/src/store.ts#L6728) `Store/toRecord` | `Calculations.value` (6728, 6738); `Calculations.globalValue` (6732); `Calculations.unstoredStyled` (6737) | CORE |
| [packages/store/src/store.ts:5136](../../packages/store/src/store.ts#L5136) `Store/totpAccounts` | `SQLite.all` (5136); `SQLite.prepare` (5136); `Store.sql` (5136) | CORE |
| [packages/store/src/store.ts:1416](../../packages/store/src/store.ts#L1416) `Store/trial` | `Store.sql` (1416) | CORE |
| [packages/store/src/store.ts:1421](../../packages/store/src/store.ts#L1421) `Store/trial/undo` | `Store.sql` (1421) | CORE |
| [packages/store/src/store.ts:10302](../../packages/store/src/store.ts#L10302) `Store/truncate/run` | `Store.sql` (10302, 10304, 10311, 10313, 10315, 10316); `SQLite.prepare` (10304, 10311); `SQLite.all` (10306) | CORE |
| [packages/store/src/store.ts:3169](../../packages/store/src/store.ts#L3169) `Store/unmigratedAccounts` | `SQLite.all` (3169); `SQLite.prepare` (3169); `Store.sql` (3169) | CORE |
| [packages/store/src/store.ts:4232](../../packages/store/src/store.ts#L4232) `Store/unusedAccess` | `SQLite.get` (4232); `SQLite.prepare` (4232, 4241); `Store.sql` (4232, 4241); `SQLite.all` (4241) | CORE |
| [packages/store/src/store.ts:4280](../../packages/store/src/store.ts#L4280) `Store/unusedObjects` | `SQLite.get` (4280); `SQLite.prepare` (4280, 4283); `Store.sql` (4280, 4283); `SQLite.all` (4283) | CORE |
| [packages/store/src/store.ts:5367](../../packages/store/src/store.ts#L5367) `Store/unusedRecoveryHashes` | `SQLite.all` (5367); `SQLite.prepare` (5367); `Store.sql` (5367) | CORE |
| [packages/store/src/store.ts:4062](../../packages/store/src/store.ts#L4062) `Store/unusualAccess` | `Store.auditLog` (4062, 4128) | CORE |
| [packages/store/src/store.ts:8960](../../packages/store/src/store.ts#L8960) `Store/update` | `Store.row` (8960); `Store.sql` (8990, 8991, 9030, 9033) | CORE |
| [packages/store/src/store.ts:8993](../../packages/store/src/store.ts#L8993) `Store/update/undo` | `Store.sql` (8993) | CORE |
| [packages/store/src/store.ts:9423](../../packages/store/src/store.ts#L9423) `Store/updatePortals` | `Store.row` (9423, 9459); `relatedRows` (9460) | CORE |
| [packages/store/src/store.ts:9433](../../packages/store/src/store.ts#L9433) `Store/updatePortals/portal/related` | `relatedIdList` (9433) | CORE |
| [packages/store/src/store.ts:9405](../../packages/store/src/store.ts#L9405) `Store/updateRelated` | `relatedRows` (9405) | CORE |
| [packages/store/src/store.ts:4318](../../packages/store/src/store.ts#L4318) `Store/usageCounting` | `SQLite.get` (4318); `SQLite.prepare` (4318); `Store.sql` (4318) | CORE |
| [packages/store/src/store.ts:8198](../../packages/store/src/store.ts#L8198) `Store/userPrefs` | `SQLite.all` (8198); `SQLite.prepare` (8198); `Store.sql` (8198) | CORE |
| [packages/store/src/store.ts:7108](../../packages/store/src/store.ts#L7108) `Store/valueListItemsCurrent` | `Store.valueListItems` (7108); `Store.get` (7122); `relatedRows` (7123); `Store.row` (7123); `SQLite.iterate` (7125); `SQLite.prepare` (7125); `Store.sql` (7125); `Calculations.related` (7135); `Calculations.value` (7139, 7140) | GATED-STORE |
| [packages/store/src/store.ts:9615](../../packages/store/src/store.ts#L9615) `Store/vaultHeld` | `SQLite.get` (9615); `SQLite.prepare` (9615); `Store.sql` (9615) | CORE |
| [packages/store/src/store.ts:5165](../../packages/store/src/store.ts#L5165) `Store/verifyTotp` | `SQLite.get` (5165); `SQLite.prepare` (5165, 5171); `Store.sql` (5165, 5171) | CORE |
| [packages/store/src/store.ts:1912](../../packages/store/src/store.ts#L1912) `Store/versionNumber` | `SQLite.get` (1912); `SQLite.prepare` (1912); `Store.sql` (1912) | CORE |
| [packages/store/src/store.ts:1868](../../packages/store/src/store.ts#L1868) `Store/versionTriggers` | `SQLite.get` (1868); `SQLite.prepare` (1868, 1873, 1874); `Store.sql` (1868, 1873, 1874, 1891, 1893, 1894, 1896); `SQLite.all` (1873, 1874) | CORE |
| [packages/store/src/store.ts:1836](../../packages/store/src/store.ts#L1836) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1836) | CORE |
| [packages/store/src/store.ts:3658](../../packages/store/src/store.ts#L3658) `Store/webViewerChecked` | `SQLite.get` (3658); `SQLite.prepare` (3658); `Store.sql` (3658) | CORE |
| [packages/store/src/store.ts:1607](../../packages/store/src/store.ts#L1607) `Store/withWriteTransaction` | `Store.sql` (1607, 1618, 1624, 1626, 1626) | CORE |
| [packages/store/src/store.ts:6663](../../packages/store/src/store.ts#L6663) `Store/wordIndex` | `Store.sql` (6663, 6671, 6676); `Store.recordCount` (6675); `SQLite.get` (6676); `SQLite.prepare` (6676) | CORE |
| [packages/store/src/store.ts:7799](../../packages/store/src/store.ts#L7799) `Store/writeExternalFile` | `Store.evaluateEach` (7799); `SQLite.prepare` (7822); `Store.sql` (7822) | CORE |
| [packages/store/src/store.ts:7823](../../packages/store/src/store.ts#L7823) `Store/writeExternalFile/taken` | `SQLite.get` (7823) | CORE |
| [packages/store/src/store.ts:5000](../../packages/store/src/store.ts#L5000) `Store/writeObjectUseRows` | `SQLite.prepare` (5000, 5001, 5006); `Store.sql` (5000, 5001, 5006) | CORE |
| [packages/store/src/store.ts:1967](../../packages/store/src/store.ts#L1967) `Store/writeToken` | `SQLite.get` (1967); `SQLite.prepare` (1967); `Store.sql` (1967) | CORE |
| [packages/store/src/store.ts:4972](../../packages/store/src/store.ts#L4972) `Store/writeUsage` | `Store.sql` (4972, 4973, 4975, 4979, 4981) | CORE |
| [packages/store/src/store.ts:4988](../../packages/store/src/store.ts#L4988) `Store/writeUsageRows` | `SQLite.prepare` (4988, 4989, 4995); `Store.sql` (4988, 4989, 4995) | CORE |
| [packages/store/src/store.ts:6384](../../packages/store/src/store.ts#L6384) `Store/design` | `SQLite.get` (6384) | CORE |
| [packages/store/src/store.ts:6406](../../packages/store/src/store.ts#L6406) `Store/themes` | `SQLite.get` (6406) | CORE |
| [packages/store/src/store.ts:5327](../../packages/store/src/store.ts#L5327) `Store/verifyPasskeyCredential` | `SQLite.get` (5327); `SQLite.prepare` (5327, 5339); `Store.sql` (5327, 5339) | CORE |
| [packages/store/src/store.ts:6244](../../packages/store/src/store.ts#L6244) `Store/passwordState` | `SQLite.get` (6244); `SQLite.prepare` (6244); `Store.sql` (6244) | CORE |
| [packages/store/src/store.ts:9558](../../packages/store/src/store.ts#L9558) `Store/deleteVisibility` | `Store.canViewRecord` (9558) | CORE |
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
| [packages/server/src/inbound-hooks.ts:290](../../packages/server/src/inbound-hooks.ts#L290) `InboundHooks/claim` | `SQLite.get` (290, 298, 299); `SQLite.prepare` (290, 294, 295, 298, 299, 301) | AUTH |
<!-- end generated read-gate inventory -->
