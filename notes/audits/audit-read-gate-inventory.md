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
| [packages/cli/src/main.ts:682](../../packages/cli/src/main.ts#L682) `accountsWithPasswordOff` | `SQLite.all` (682); `SQLite.prepare` (682) | OPERATOR |
| [packages/cli/src/main.ts:711](../../packages/cli/src/main.ts#L711) `hostedRead` | `SQLite.all` (711, 714); `SQLite.prepare` (711, 714); `Store.sql` (711, 714) | OPERATOR |
| [packages/cli/src/main.ts:2328](../../packages/cli/src/main.ts#L2328) `main` | `Store.orphanContainerReport` (2328); `Store.auditLog` (2791); `SQLite.get` (3007); `SQLite.prepare` (3007) | OPERATOR |
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
| [packages/server/src/admin.ts:1030](../../packages/server/src/admin.ts#L1030) `Admin/handle` | `Store.externalContainerReport` (1030); `Store.orphanContainerReport` (1035, 1039) | ADMIN |
| [packages/server/src/admin.ts:2205](../../packages/server/src/admin.ts#L2205) `Admin/audit` | `Store.auditLog` (2205) | ADMIN |
| [packages/server/src/admin.ts:2288](../../packages/server/src/admin.ts#L2288) `Admin/viewAs` | `Store.find` (2288) | ADMIN |
| [packages/server/src/admin.ts:2636](../../packages/server/src/admin.ts#L2636) `Admin/status` | `Store.externalContainerCount` (2636) | ADMIN |
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
| [packages/server/src/dataapi.ts:1941](../../packages/server/src/dataapi.ts#L1941) `DataApi/route` | `Store.get` (1941, 2163, 2186, 2194, 2241, 2265, 2285, 2322); `Store.valueListItems` (1956); `Store.find` (2118, 2165, 2355); `Store.findIds` (2122, 2360); `Store.query` (2360) | REST |
| [packages/server/src/dataapi.ts:2070](../../packages/server/src/dataapi.ts#L2070) `DataApi/route/recordOut` | `Store.portalCounts` (2070) | REST |
| [packages/server/src/dataapi.ts:2106](../../packages/server/src/dataapi.ts#L2106) `DataApi/route/shownAs` | `Store.get` (2106) | REST |
| [packages/server/src/debug.ts:193](../../packages/server/src/debug.ts#L193) `learnStoredCredentials` | `Calculations.globalValue` (193); `Store.sql` (199, 209, 209); `SQLite.iterate` (209, 209); `SQLite.prepare` (209, 209); `Store.iterateCommitted` (209) | DESIGN |
| [packages/server/src/debug.ts:344](../../packages/server/src/debug.ts#L344) `DebugApi/handle` | `Store.row` (344, 473); `Store.get` (353, 478); `Store.evaluate` (377) | DESIGN |
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
| [packages/server/src/live.ts:138](../../packages/server/src/live.ts#L138) `Live/handle` | `Store.canViewRecord` (138, 145); `Store.canView` (190) | LIVE |
| [packages/server/src/live.ts:292](../../packages/server/src/live.ts#L292) `Live/stream/listener` | `Store.canViewRecord` (292, 294) | LIVE |
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
| [packages/server/src/oidc.ts:189](../../packages/server/src/oidc.ts#L189) `Oidc/constructor` | `SQLite.all` (189, 197); `SQLite.prepare` (189, 197, 207, 208, 213, 213) | AUTH |
| [packages/server/src/oidc.ts:342](../../packages/server/src/oidc.ts#L342) `Oidc/takeGrant` | `SQLite.all` (342); `SQLite.prepare` (342) | AUTH |
| [packages/server/src/oidc.ts:393](../../packages/server/src/oidc.ts#L393) `Oidc/authorizeUrl` | `SQLite.prepare` (393, 394, 397); `SQLite.get` (394) | AUTH |
| [packages/server/src/oidc.ts:445](../../packages/server/src/oidc.ts#L445) `Oidc/callback` | `SQLite.all` (445); `SQLite.prepare` (445, 449) | AUTH |
| [packages/server/src/oidc.ts:547](../../packages/server/src/oidc.ts#L547) `Oidc/finish` | `SQLite.prepare` (547, 548, 550); `SQLite.get` (548) | AUTH |
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
| [packages/server/src/webclient.ts:530](../../packages/server/src/webclient.ts#L530) `WebClient/history` | `Store.get` (530) | WEB |
| [packages/server/src/webclient.ts:667](../../packages/server/src/webclient.ts#L667) `WebClient/explain` | `Store.get` (667); `Store.row` (700, 713) | WEB |
| [packages/server/src/webclient.ts:726](../../packages/server/src/webclient.ts#L726) `WebClient/index` | `Store.fieldIndex` (726) | WEB |
| [packages/server/src/webclient.ts:816](../../packages/server/src/webclient.ts#L816) `WebClient/menus` | `Store.evaluateEach` (816) | WEB |
| [packages/server/src/webclient.ts:1032](../../packages/server/src/webclient.ts#L1032) `WebClient/view` | `Store.evaluateEach` (1032, 1056, 1075); `Store.canView` (1050); `Store.previewRow` (1054, 1076); `Store.get` (1067); `Store.row` (1068, 1068) | WEB |
| [packages/server/src/webclient.ts:1053](../../packages/server/src/webclient.ts#L1053) `WebClient/view/get` | `Store.get` (1053) | WEB |
| [packages/server/src/webclient.ts:1118](../../packages/server/src/webclient.ts#L1118) `WebClient/refresh` | `Store.previewRow` (1118); `Store.getMany` (1123); `Store.foundSetRows` (1145) | WEB |
| [packages/server/src/webclient.ts:1157](../../packages/server/src/webclient.ts#L1157) `WebClient/foundIds` | `Store.findIds` (1157) | WEB |
| [packages/server/src/webclient.ts:1172](../../packages/server/src/webclient.ts#L1172) `WebClient/records` | `Store.getMany` (1172); `Store.find` (1175) | WEB |
| [packages/server/src/webclient.ts:1201](../../packages/server/src/webclient.ts#L1201) `WebClient/foundSetPortal` | `Store.foundSetRows` (1201, 1208) | WEB |
| [packages/server/src/webclient.ts:1241](../../packages/server/src/webclient.ts#L1241) `WebClient/charts/foundSet` | `Store.findIds` (1241) | WEB |
| [packages/server/src/webclient.ts:1250](../../packages/server/src/webclient.ts#L1250) `WebClient/charts` | `Calculations.context` (1250); `Store.canView` (1278); `Store.evaluateEach` (1287, 1291); `Store.evaluateRows` (1296, 1298) | WEB |
| [packages/server/src/webclient.ts:1281](../../packages/server/src/webclient.ts#L1281) `WebClient/charts/get` | `Store.get` (1281) | WEB |
| [packages/server/src/webclient.ts:1470](../../packages/server/src/webclient.ts#L1470) `WebClient/exportRecords` | `Store.getMany` (1470) | WEB |
| [packages/server/src/webclient.ts:1364](../../packages/server/src/webclient.ts#L1364) `WebClient/streamExportRecords/nextBatch` | `Store.selectIds` (1364); `Store.getMany` (1370) | WEB |
| [packages/server/src/webclient.ts:1664](../../packages/server/src/webclient.ts#L1664) `WebClient/aiReplace` | `Store.canView` (1664); `Store.getMany` (1680) | WEB |
| [packages/server/src/webclient.ts:1740](../../packages/server/src/webclient.ts#L1740) `WebClient/groups` | `Store.findIds` (1740); `Store.groupSummaries` (1746) | WEB |
| [packages/server/src/webclient.ts:1848](../../packages/server/src/webclient.ts#L1848) `WebClient/button` | `Store.findIds` (1848, 1898); `Store.evaluateEach` (1857, 1858) | WEB |
| [packages/server/src/webclient.ts:2548](../../packages/server/src/webclient.ts#L2548) `listItems` | `Store.valueListItems` (2548) | WEB |
| [packages/server/src/webclient.ts:2627](../../packages/server/src/webclient.ts#L2627) `foundIds` | `Store.findIds` (2627, 2629) | WEB |
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
| [packages/store/src/calc.ts:2116](../../packages/store/src/calc.ts#L2116) `Calculations/translateSQL` | `Store.scopedTableSql` (2116, 2147) | CALC |
| [packages/store/src/calc.ts:2179](../../packages/store/src/calc.ts#L2179) `Calculations/shareColumn` | `Store.recordCount` (2179) | CALC |
| [packages/store/src/calc.ts:2211](../../packages/store/src/calc.ts#L2211) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2211) | CALC |
| [packages/store/src/calc.ts:2248](../../packages/store/src/calc.ts#L2248) `Calculations/computeColumn` | `Calculations.statement` (2248); `SQLite.get` (2248); `Calculations.value` (2251) | CALC |
| [packages/store/src/calc.ts:2385](../../packages/store/src/calc.ts#L2385) `Calculations/beforeWrite` | `relatedRows` (2385); `Calculations.related` (2439); `Calculations.context` (2452) | CORE |
| [packages/store/src/calc.ts:2503](../../packages/store/src/calc.ts#L2503) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2503); `Calculations.value` (2503) | CALC |
| [packages/store/src/calc.ts:2518](../../packages/store/src/calc.ts#L2518) `Calculations/computeStoredStyled` | `Calculations.context` (2518) | CORE |
| [packages/store/src/calc.ts:2558](../../packages/store/src/calc.ts#L2558) `Calculations/validate/fail` | `Calculations.context` (2558) | CALC |
| [packages/store/src/calc.ts:2572](../../packages/store/src/calc.ts#L2572) `Calculations/validate` | `Calculations.value` (2572); `Store.valueListItems` (2593); `Calculations.context` (2607) | CALC |
| [packages/store/src/calc.ts:2669](../../packages/store/src/calc.ts#L2669) `nearest` | `SQLite.get` (2669); `SQLite.prepare` (2669); `Store.sql` (2669) | CALC |
| [packages/store/src/calc.ts:2754](../../packages/store/src/calc.ts#L2754) `containerValue` | `Store.containerInfo` (2754); `Store.containerRange` (2761); `Store.container` (2762) | CALC |
| [packages/store/src/calc.ts:2770](../../packages/store/src/calc.ts#L2770) `containerValue/read` | `Store.container` (2770) | CALC |
| [packages/store/src/calc.ts:2783](../../packages/store/src/calc.ts#L2783) `containerValue/value` | `Store.containerRange` (2783) | CALC |
| [packages/store/src/calc.ts:2901](../../packages/store/src/calc.ts#L2901) `sameValuesElsewhere` | `SQLite.all` (2901); `SQLite.prepare` (2901, 2908, 2910); `Store.sql` (2901, 2908, 2910); `Calculations.value` (2903); `SQLite.get` (2908, 2910) | CALC |
| [packages/store/src/calc.ts:3214](../../packages/store/src/calc.ts#L3214) `rowsById/flush` | `Calculations.statement` (3214); `SQLite.iterate` (3214) | CALC |
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
| [packages/store/src/store.ts:898](../../packages/store/src/store.ts#L898) `Store/metadataVersions` | `SQLite.get` (898); `SQLite.prepare` (898); `Store.sql` (898) | CORE |
| [packages/store/src/store.ts:1037](../../packages/store/src/store.ts#L1037) `Store/constructor` | `Store.sql` (1037, 1039, 1041, 1042, 1046, 1050, 1051, 1062, 1067, 1072, 1073, 1077, 1078, 1079, 1086, 1090, 1094, 1095, 1096, 1101, 1105, 1108, 1109, 1111, 1112, 1115, 1116, 1120, 1121, 1125, 1126, 1129, 1131, 1134, 1135, 1139, 1140, 1144, 1145, 1148, 1149, 1150, 1153, 1154, 1157, 1158, 1160, 1160, 1161, 1161, 1162, 1165, 1169, 1171, 1174, 1175, 1176, 1179, 1180, 1182, 1184, 1185, 1189, 1190, 1192, 1196, 1198, 1199, 1200, 1200, 1204, 1205); `SQLite.get` (1041); `SQLite.prepare` (1041, 1108, 1109, 1112, 1115, 1120, 1125, 1134, 1139, 1144, 1153, 1157, 1160, 1161, 1179, 1184, 1189); `SQLite.all` (1108, 1115, 1120, 1125, 1134, 1139, 1144, 1153, 1157, 1160, 1161, 1179, 1184, 1189) | CORE |
| [packages/store/src/store.ts:1262](../../packages/store/src/store.ts#L1262) `Store/grantFullAccessClients` | `SQLite.prepare` (1262); `Store.sql` (1262) | CORE |
| [packages/store/src/store.ts:1285](../../packages/store/src/store.ts#L1285) `Store/meta` | `SQLite.get` (1285); `SQLite.prepare` (1285); `Store.sql` (1285) | CORE |
| [packages/store/src/store.ts:3560](../../packages/store/src/store.ts#L3560) `Store/webViewerChecked` | `SQLite.get` (3560); `SQLite.prepare` (3560); `Store.sql` (3560) | CORE |
| [packages/store/src/store.ts:1293](../../packages/store/src/store.ts#L1293) `Store/persistentTable` | `Store.sql` (1293) | CORE |
| [packages/store/src/store.ts:1303](../../packages/store/src/store.ts#L1303) `Store/persistentData` | `SQLite.get` (1303) | CORE |
| [packages/store/src/store.ts:1312](../../packages/store/src/store.ts#L1312) `Store/persistentDataIds` | `SQLite.all` (1312) | CORE |
| [packages/store/src/store.ts:1318](../../packages/store/src/store.ts#L1318) `Store/setPersistentData` | `SQLite.prepare` (1318, 1322); `Store.sql` (1318, 1322) | CORE |
| [packages/store/src/store.ts:1342](../../packages/store/src/store.ts#L1342) `Store/checkpoint` | `SQLite.get` (1342); `SQLite.prepare` (1342); `Store.sql` (1342) | CORE |
| [packages/store/src/store.ts:1350](../../packages/store/src/store.ts#L1350) `Store/recordedFormat` | `Store.sql` (1350) | CORE |
| [packages/store/src/store.ts:1360](../../packages/store/src/store.ts#L1360) `Store/close` | `Store.sql` (1360) | CORE |
| [packages/store/src/store.ts:1376](../../packages/store/src/store.ts#L1376) `Store/shipWal` | `Store.sql` (1376) | CORE |
| [packages/store/src/store.ts:1387](../../packages/store/src/store.ts#L1387) `Store/trial` | `Store.sql` (1387) | CORE |
| [packages/store/src/store.ts:1392](../../packages/store/src/store.ts#L1392) `Store/trial/undo` | `Store.sql` (1392) | CORE |
| [packages/store/src/store.ts:1488](../../packages/store/src/store.ts#L1488) `Store/joinTransaction` | `Store.sql` (1488, 1489, 1491, 1493, 1499) | CORE |
| [packages/store/src/store.ts:1511](../../packages/store/src/store.ts#L1511) `Store/independentWindowWrite` | `SQLite.get` (1511); `SQLite.prepare` (1511, 1541); `Store.sql` (1511, 1520, 1536, 1541, 1544) | CORE |
| [packages/store/src/store.ts:1573](../../packages/store/src/store.ts#L1573) `Store/withWriteTransaction` | `Store.sql` (1573, 1584, 1590, 1592, 1592) | CORE |
| [packages/store/src/store.ts:1642](../../packages/store/src/store.ts#L1642) `Store/endTransaction` | `Store.sql` (1642, 1645, 1645) | CORE |
| [packages/store/src/store.ts:1672](../../packages/store/src/store.ts#L1672) `Store/backup` | `Store.sql` (1672) | CORE |
| [packages/store/src/store.ts:1762](../../packages/store/src/store.ts#L1762) `Store/dataVersion` | `SQLite.get` (1762); `SQLite.prepare` (1762); `Store.sql` (1762) | CORE |
| [packages/store/src/store.ts:1802](../../packages/store/src/store.ts#L1802) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1802) | CORE |
| [packages/store/src/store.ts:1823](../../packages/store/src/store.ts#L1823) `Store/shareResults` | `Store.sql` (1823) | CORE |
| [packages/store/src/store.ts:1833](../../packages/store/src/store.ts#L1833) `Store/versionTriggers` | `SQLite.get` (1833); `SQLite.prepare` (1833, 1838, 1839); `Store.sql` (1833, 1835, 1836, 1838, 1839, 1848, 1849); `SQLite.all` (1838, 1839) | CORE |
| [packages/store/src/store.ts:1865](../../packages/store/src/store.ts#L1865) `Store/versionNumber` | `SQLite.get` (1865); `SQLite.prepare` (1865); `Store.sql` (1865) | CORE |
| [packages/store/src/store.ts:1878](../../packages/store/src/store.ts#L1878) `Store/changeOne` | `Store.sql` (1878, 1880) | CORE |
| [packages/store/src/store.ts:1881](../../packages/store/src/store.ts#L1881) `Store/changeOne/read` | `SQLite.get` (1881); `SQLite.prepare` (1881); `Store.sql` (1881) | CORE |
| [packages/store/src/store.ts:1920](../../packages/store/src/store.ts#L1920) `Store/writeToken` | `SQLite.get` (1920); `SQLite.prepare` (1920); `Store.sql` (1920) | CORE |
| [packages/store/src/store.ts:1932](../../packages/store/src/store.ts#L1932) `Store/recordCount` | `SQLite.get` (1932); `SQLite.prepare` (1932); `Store.sql` (1932) | CORE |
| [packages/store/src/store.ts:2046](../../packages/store/src/store.ts#L2046) `Store/applyDesign` | `Store.sql` (2046, 2047, 2060, 2063, 2068, 2084, 2087, 2087); `SQLite.prepare` (2063, 2068) | CORE |
| [packages/store/src/store.ts:2145](../../packages/store/src/store.ts#L2145) `Store/auditLog` | `SQLite.all` (2145); `SQLite.prepare` (2145); `Store.sql` (2145) | CORE |
| [packages/store/src/store.ts:2185](../../packages/store/src/store.ts#L2185) `Store/securityEvents` | `Store.auditLog` (2185) | CORE |
| [packages/store/src/store.ts:2211](../../packages/store/src/store.ts#L2211) `Store/prepared` | `SQLite.prepare` (2211); `Store.sql` (2211) | CORE |
| [packages/store/src/store.ts:2226](../../packages/store/src/store.ts#L2226) `Store/recordAsOf` | `SQLite.get` (2226, 2228); `SQLite.prepare` (2226, 2228, 2230, 2231); `Store.sql` (2226, 2228, 2230, 2231); `SQLite.all` (2230, 2231) | CORE |
| [packages/store/src/store.ts:2304](../../packages/store/src/store.ts#L2304) `Store/revertAuditEntry` | `Store.auditLog` (2304) | CORE |
| [packages/store/src/store.ts:2397](../../packages/store/src/store.ts#L2397) `Store/setAuditSettings` | `SQLite.prepare` (2397); `Store.sql` (2397) | CORE |
| [packages/store/src/store.ts:2419](../../packages/store/src/store.ts#L2419) `Store/pruneAudit` | `Store.sql` (2419, 2421, 2423); `SQLite.get` (2421); `SQLite.prepare` (2421) | CORE |
| [packages/store/src/store.ts:2501](../../packages/store/src/store.ts#L2501) `Store/audit` | `Store.sql` (2501) | CORE |
| [packages/store/src/store.ts:2594](../../packages/store/src/store.ts#L2594) `Store/securityChange` | `Store.sql` (2594, 2596); `SQLite.prepare` (2596) | CORE |
| [packages/store/src/store.ts:2643](../../packages/store/src/store.ts#L2643) `Store/logSecurity` | `Store.sql` (2643) | CORE |
| [packages/store/src/store.ts:2666](../../packages/store/src/store.ts#L2666) `Store/ensureDeleted` | `Store.sql` (2666) | CORE |
| [packages/store/src/store.ts:2671](../../packages/store/src/store.ts#L2671) `Store/deletedRows` | `SQLite.get` (2671); `SQLite.prepare` (2671, 2673, 2673); `Store.sql` (2671, 2673, 2673); `SQLite.all` (2673, 2673) | CORE |
| [packages/store/src/store.ts:2697](../../packages/store/src/store.ts#L2697) `Store/emptyDeleted` | `Store.sql` (2697, 2700, 2701, 2703, 2705); `SQLite.prepare` (2701) | CORE |
| [packages/store/src/store.ts:2712](../../packages/store/src/store.ts#L2712) `Store/designHistory` | `SQLite.all` (2712); `SQLite.prepare` (2712); `Store.sql` (2712) | CORE |
| [packages/store/src/store.ts:2719](../../packages/store/src/store.ts#L2719) `Store/scriptHistory` | `SQLite.all` (2719); `SQLite.prepare` (2719); `Store.sql` (2719) | CORE |
| [packages/store/src/store.ts:2729](../../packages/store/src/store.ts#L2729) `Store/layoutHistory` | `SQLite.all` (2729); `SQLite.prepare` (2729); `Store.sql` (2729) | CORE |
| [packages/store/src/store.ts:2758](../../packages/store/src/store.ts#L2758) `Store/designEffect/renameKey` | `SQLite.prepare` (2758); `Store.sql` (2758) | CORE |
| [packages/store/src/store.ts:2774](../../packages/store/src/store.ts#L2774) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2774); `Store.sql` (2774) | CORE |
| [packages/store/src/store.ts:2781](../../packages/store/src/store.ts#L2781) `Store/designEffect` | `Store.sql` (2781, 2786, 2791, 2796, 2799, 2805, 2816, 2817, 2819, 2832, 2833, 2836, 2838, 2844, 2845, 2846, 2851, 2853, 2857, 2860, 2861, 2863, 2866, 2872, 2874, 2881, 2882, 2884, 2885, 2886, 2887, 2894, 2895, 2897, 2897, 2899, 2900, 2901, 2905, 2909, 2911, 2949, 2951, 2953); `SQLite.get` (2816, 2832, 2844, 2845, 2857, 2861, 2897, 2905); `SQLite.prepare` (2816, 2817, 2832, 2833, 2844, 2845, 2851, 2853, 2857, 2861, 2872, 2874, 2887, 2894, 2895, 2897, 2899, 2901, 2905, 2909); `SQLite.all` (2894, 2895); `SQLite.iterate` (2899) | CORE |
| [packages/store/src/store.ts:2961](../../packages/store/src/store.ts#L2961) `Store/dropColumnIndexes` | `SQLite.all` (2961, 2963); `SQLite.prepare` (2961, 2963); `Store.sql` (2961, 2963, 2964) | CORE |
| [packages/store/src/store.ts:2973](../../packages/store/src/store.ts#L2973) `Store/recompute` | `SQLite.prepare` (2973, 2977); `Store.sql` (2973, 2977); `SQLite.iterate` (2977); `Calculations.computeStoredStyled` (2978); `Calculations.value` (2978) | CORE |
| [packages/store/src/store.ts:2993](../../packages/store/src/store.ts#L2993) `Store/linkPrincipal` | `SQLite.get` (2993); `SQLite.prepare` (2993); `Store.sql` (2993) | CORE |
| [packages/store/src/store.ts:3001](../../packages/store/src/store.ts#L3001) `Store/linkIdentity` | `SQLite.get` (3001); `SQLite.prepare` (3001); `Store.sql` (3001) | CORE |
| [packages/store/src/store.ts:3026](../../packages/store/src/store.ts#L3026) `Store/credentialIdentity` | `SQLite.get` (3026); `SQLite.prepare` (3026); `Store.sql` (3026) | CORE |
| [packages/store/src/store.ts:3032](../../packages/store/src/store.ts#L3032) `Store/accountsSharingLockout` | `SQLite.all` (3032); `SQLite.prepare` (3032); `Store.sql` (3032) | CORE |
| [packages/store/src/store.ts:3036](../../packages/store/src/store.ts#L3036) `Store/accounts` | `SQLite.all` (3036); `SQLite.prepare` (3036); `Store.sql` (3036) | CORE |
| [packages/store/src/store.ts:3048](../../packages/store/src/store.ts#L3048) `Store/isAgent` | `SQLite.get` (3048); `SQLite.prepare` (3048); `Store.sql` (3048) | CORE |
| [packages/store/src/store.ts:3054](../../packages/store/src/store.ts#L3054) `Store/agentNeedsApproval` | `SQLite.get` (3054); `SQLite.prepare` (3054); `Store.sql` (3054) | CORE |
| [packages/store/src/store.ts:3060](../../packages/store/src/store.ts#L3060) `Store/blankPasswordAccounts` | `SQLite.all` (3060); `SQLite.prepare` (3060); `Store.sql` (3060) | CORE |
| [packages/store/src/store.ts:1270](../../packages/store/src/store.ts#L1270) `Store/hasOwnPassword` | `SQLite.get` (1270); `SQLite.prepare` (1270); `Store.sql` (1270) | CORE |
| [packages/store/src/store.ts:3071](../../packages/store/src/store.ts#L3071) `Store/unmigratedAccounts` | `SQLite.all` (3071); `SQLite.prepare` (3071); `Store.sql` (3071) | CORE |
| [packages/store/src/store.ts:3124](../../packages/store/src/store.ts#L3124) `Store/setExternalAccount` | `SQLite.get` (3124); `SQLite.prepare` (3124, 3129); `Store.sql` (3124, 3129) | CORE |
| [packages/store/src/store.ts:3142](../../packages/store/src/store.ts#L3142) `Store/refuseLookalikeAccount` | `SQLite.all` (3142); `SQLite.prepare` (3142); `Store.sql` (3142) | CORE |
| [packages/store/src/store.ts:3151](../../packages/store/src/store.ts#L3151) `Store/isExternal` | `SQLite.get` (3151); `SQLite.prepare` (3151); `Store.sql` (3151) | CORE |
| [packages/store/src/store.ts:3172](../../packages/store/src/store.ts#L3172) `Store/setAgentAccount` | `SQLite.get` (3172); `SQLite.prepare` (3172, 3178); `Store.sql` (3172, 3178) | CORE |
| [packages/store/src/store.ts:3212](../../packages/store/src/store.ts#L3212) `Store/gateAgentWrite` | `SQLite.get` (3212); `SQLite.prepare` (3212, 3214); `Store.sql` (3212, 3214) | CORE |
| [packages/store/src/store.ts:3236](../../packages/store/src/store.ts#L3236) `Store/pendingChanges` | `SQLite.all` (3236); `SQLite.prepare` (3236); `Store.sql` (3236) | CORE |
| [packages/store/src/store.ts:3250](../../packages/store/src/store.ts#L3250) `Store/approvePending` | `SQLite.get` (3250); `SQLite.prepare` (3250, 3261); `Store.sql` (3250, 3261) | CORE |
| [packages/store/src/store.ts:3271](../../packages/store/src/store.ts#L3271) `Store/rejectPending` | `SQLite.get` (3271); `SQLite.prepare` (3271, 3273); `Store.sql` (3271, 3273) | CORE |
| [packages/store/src/store.ts:3293](../../packages/store/src/store.ts#L3293) `Store/externalAccount` | `SQLite.all` (3293); `SQLite.prepare` (3293); `Store.sql` (3293) | CORE |
| [packages/store/src/store.ts:3324](../../packages/store/src/store.ts#L3324) `Store/setPassword` | `SQLite.get` (3324); `SQLite.prepare` (3324, 3326, 3335); `Store.sql` (3324, 3326, 3335) | AUTH |
| [packages/store/src/store.ts:3349](../../packages/store/src/store.ts#L3349) `Store/createAccount` | `SQLite.get` (3349); `SQLite.prepare` (3349, 3353, 3359, 3364, 3369); `Store.sql` (3349, 3353, 3359, 3364, 3369) | CORE |
| [packages/store/src/store.ts:3377](../../packages/store/src/store.ts#L3377) `Store/appendSecurityEvent` | `Store.sql` (3377) | CORE |
| [packages/store/src/store.ts:3419](../../packages/store/src/store.ts#L3419) `Store/setPasswordPolicy` | `SQLite.prepare` (3419); `Store.sql` (3419) | CORE |
| [packages/store/src/store.ts:3455](../../packages/store/src/store.ts#L3455) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3455); `Store.sql` (3455) | CORE |
| [packages/store/src/store.ts:3478](../../packages/store/src/store.ts#L3478) `Store/saveScriptTest` | `SQLite.prepare` (3478); `Store.sql` (3478) | CORE |
| [packages/store/src/store.ts:3487](../../packages/store/src/store.ts#L3487) `Store/deleteScriptTest` | `SQLite.prepare` (3487); `Store.sql` (3487) | CORE |
| [packages/store/src/store.ts:3522](../../packages/store/src/store.ts#L3522) `Store/setAiAllowed` | `SQLite.prepare` (3522); `Store.sql` (3522) | CORE |
| [packages/store/src/store.ts:3589](../../packages/store/src/store.ts#L3589) `Store/setAiPolicy` | `SQLite.prepare` (3589); `Store.sql` (3589) | CORE |
| [packages/store/src/store.ts:3537](../../packages/store/src/store.ts#L3537) `Store/setScriptNetwork` | `SQLite.prepare` (3537); `Store.sql` (3537) | CORE |
| [packages/store/src/store.ts:3578](../../packages/store/src/store.ts#L3578) `Store/setWebViewerHosts` | `SQLite.prepare` (3578); `Store.sql` (3578) | CORE |
| [packages/store/src/store.ts:3609](../../packages/store/src/store.ts#L3609) `Store/setPiiIsolation` | `SQLite.prepare` (3609); `Store.sql` (3609) | CORE |
| [packages/store/src/store.ts:3631](../../packages/store/src/store.ts#L3631) `Store/markPiiField` | `SQLite.prepare` (3631); `Store.sql` (3631) | CORE |
| [packages/store/src/store.ts:3745](../../packages/store/src/store.ts#L3745) `Store/lastSignIns` | `Store.auditLog` (3745) | CORE |
| [packages/store/src/store.ts:3948](../../packages/store/src/store.ts#L3948) `Store/unusualAccess` | `Store.auditLog` (3948, 4014) | CORE |
| [packages/store/src/store.ts:4045](../../packages/store/src/store.ts#L4045) `Store/leastPrivilege` | `SQLite.all` (4045); `SQLite.prepare` (4045); `Store.sql` (4045) | CORE |
| [packages/store/src/store.ts:4118](../../packages/store/src/store.ts#L4118) `Store/unusedAccess` | `SQLite.get` (4118); `SQLite.prepare` (4118, 4127); `Store.sql` (4118, 4127); `SQLite.all` (4127) | CORE |
| [packages/store/src/store.ts:4166](../../packages/store/src/store.ts#L4166) `Store/unusedObjects` | `SQLite.get` (4166); `SQLite.prepare` (4166, 4169); `Store.sql` (4166, 4169); `SQLite.all` (4169) | CORE |
| [packages/store/src/store.ts:4204](../../packages/store/src/store.ts#L4204) `Store/usageCounting` | `SQLite.get` (4204); `SQLite.prepare` (4204); `Store.sql` (4204) | CORE |
| [packages/store/src/store.ts:4212](../../packages/store/src/store.ts#L4212) `Store/setMustChangePassword` | `SQLite.prepare` (4212); `Store.sql` (4212) | CORE |
| [packages/store/src/store.ts:4226](../../packages/store/src/store.ts#L4226) `Store/mustChangePassword` | `SQLite.get` (4226); `SQLite.prepare` (4226); `Store.sql` (4226) | CORE |
| [packages/store/src/store.ts:4265](../../packages/store/src/store.ts#L4265) `Store/passwordDaysRemaining` | `SQLite.get` (4265); `SQLite.prepare` (4265); `Store.sql` (4265) | CORE |
| [packages/store/src/store.ts:4272](../../packages/store/src/store.ts#L4272) `Store/importAccounts` | `SQLite.all` (4272); `SQLite.prepare` (4272); `Store.sql` (4272) | CORE |
| [packages/store/src/store.ts:4295](../../packages/store/src/store.ts#L4295) `Store/canonicalAccount` | `SQLite.all` (4295); `SQLite.prepare` (4295); `Store.sql` (4295) | CORE |
| [packages/store/src/store.ts:4307](../../packages/store/src/store.ts#L4307) `Store/createLocalAccount` | `SQLite.prepare` (4307); `Store.sql` (4307) | CORE |
| [packages/store/src/store.ts:4337](../../packages/store/src/store.ts#L4337) `Store/previewAccountImport` | `Store.sql` (4337, 4338, 4347) | CORE |
| [packages/store/src/store.ts:4355](../../packages/store/src/store.ts#L4355) `Store/limitAccountImport` | `SQLite.prepare` (4355, 4356, 4359); `Store.sql` (4355, 4356, 4359); `SQLite.get` (4356) | CORE |
| [packages/store/src/store.ts:4366](../../packages/store/src/store.ts#L4366) `Store/applyAccountImport` | `Store.sql` (4366, 4374, 4403); `SQLite.get` (4374); `SQLite.prepare` (4374, 4403) | CORE |
| [packages/store/src/store.ts:4428](../../packages/store/src/store.ts#L4428) `Store/forgetStandIns` | `SQLite.prepare` (4428); `Store.sql` (4428) | CORE |
| [packages/store/src/store.ts:4461](../../packages/store/src/store.ts#L4461) `Store/deleteAccount` | `SQLite.prepare` (4461, 4465, 4466, 4467, 4468, 4469, 4470, 4471, 4472, 4479, 4481, 4484, 4488); `Store.sql` (4461, 4465, 4466, 4467, 4468, 4469, 4470, 4471, 4472, 4479, 4481, 4484, 4488) | CORE |
| [packages/store/src/store.ts:4505](../../packages/store/src/store.ts#L4505) `Store/setAccountActive` | `SQLite.prepare` (4505, 4508, 4509); `Store.sql` (4505, 4508, 4509) | AUTH |
| [packages/store/src/store.ts:4519](../../packages/store/src/store.ts#L4519) `Store/accountInactive` | `SQLite.get` (4519); `SQLite.prepare` (4519); `Store.sql` (4519) | CORE |
| [packages/store/src/store.ts:4524](../../packages/store/src/store.ts#L4524) `Store/identityAllowed` | `SQLite.get` (4524, 4530, 4536); `SQLite.prepare` (4524, 4530, 4536); `Store.sql` (4524, 4530, 4536) | CORE |
| [packages/store/src/store.ts:4545](../../packages/store/src/store.ts#L4545) `Store/externalIdentityId` | `SQLite.get` (4545, 4551); `SQLite.prepare` (4545, 4550, 4551); `Store.sql` (4545, 4550, 4551) | CORE |
| [packages/store/src/store.ts:4556](../../packages/store/src/store.ts#L4556) `Store/accountIdentityId` | `SQLite.get` (4556, 4561); `SQLite.prepare` (4556, 4560, 4561); `Store.sql` (4556, 4560, 4561) | CORE |
| [packages/store/src/store.ts:4584](../../packages/store/src/store.ts#L4584) `Store/signInMark` | `SQLite.prepare` (4584); `Store.sql` (4584) | AUTH |
| [packages/store/src/store.ts:4594](../../packages/store/src/store.ts#L4594) `Store/signInBase` | `SQLite.get` (4594); `SQLite.prepare` (4594); `Store.sql` (4594) | AUTH |
| [packages/store/src/store.ts:4596](../../packages/store/src/store.ts#L4596) `Store/signInBase/identity` | `SQLite.get` (4596); `SQLite.prepare` (4596); `Store.sql` (4596) | AUTH |
| [packages/store/src/store.ts:4608](../../packages/store/src/store.ts#L4608) `Store/ledgerRow` | `SQLite.get` (4608, 4609); `SQLite.prepare` (4608, 4609); `Store.sql` (4608, 4609) | AUTH |
| [packages/store/src/store.ts:4620](../../packages/store/src/store.ts#L4620) `Store/ledgerWrite` | `Store.sql` (4620, 4621, 4623, 4625, 4628, 4628) | AUTH |
| [packages/store/src/store.ts:4647](../../packages/store/src/store.ts#L4647) `Store/settleSignIns` | `SQLite.all` (4647, 4653); `SQLite.prepare` (4647, 4653, 4659, 4663, 4665); `Store.sql` (4647, 4653, 4659, 4663, 4665) | AUTH |
| [packages/store/src/store.ts:4676](../../packages/store/src/store.ts#L4676) `Store/securityToken` | `SQLite.get` (4676); `SQLite.prepare` (4676); `Store.sql` (4676) | CORE |
| [packages/store/src/store.ts:4684](../../packages/store/src/store.ts#L4684) `Store/accountLocalOnly` | `SQLite.get` (4684); `SQLite.prepare` (4684); `Store.sql` (4684) | CORE |
| [packages/store/src/store.ts:4689](../../packages/store/src/store.ts#L4689) `Store/accountRequires2fa` | `SQLite.get` (4689); `SQLite.prepare` (4689); `Store.sql` (4689) | CORE |
| [packages/store/src/store.ts:4695](../../packages/store/src/store.ts#L4695) `Store/setAccountLocalOnly` | `SQLite.prepare` (4695); `Store.sql` (4695) | CORE |
| [packages/store/src/store.ts:4704](../../packages/store/src/store.ts#L4704) `Store/setAccountRequire2fa` | `SQLite.prepare` (4704); `Store.sql` (4704) | CORE |
| [packages/store/src/store.ts:4733](../../packages/store/src/store.ts#L4733) `Store/createApiToken` | `SQLite.get` (4733, 4761); `SQLite.prepare` (4733, 4760, 4761, 4768); `Store.sql` (4733, 4760, 4761, 4768) | CORE |
| [packages/store/src/store.ts:4815](../../packages/store/src/store.ts#L4815) `Store/recordObjectUse` | `Store.sql` (4815) | CORE |
| [packages/store/src/store.ts:4845](../../packages/store/src/store.ts#L4845) `Store/writeUsage` | `Store.sql` (4845, 4846, 4848, 4852, 4854) | CORE |
| [packages/store/src/store.ts:4861](../../packages/store/src/store.ts#L4861) `Store/writeUsageRows` | `SQLite.prepare` (4861, 4862, 4868); `Store.sql` (4861, 4862, 4868) | CORE |
| [packages/store/src/store.ts:4873](../../packages/store/src/store.ts#L4873) `Store/writeObjectUseRows` | `SQLite.prepare` (4873, 4874, 4879); `Store.sql` (4873, 4874, 4879) | CORE |
| [packages/store/src/store.ts:4884](../../packages/store/src/store.ts#L4884) `Store/objectUseSince` | `SQLite.get` (4884); `SQLite.prepare` (4884); `Store.sql` (4884) | CORE |
| [packages/store/src/store.ts:4897](../../packages/store/src/store.ts#L4897) `Store/accountUsage` | `SQLite.get` (4897); `SQLite.prepare` (4897, 4898); `Store.sql` (4897, 4898); `SQLite.all` (4898); `Store.auditLog` (4914) | CORE |
| [packages/store/src/store.ts:4930](../../packages/store/src/store.ts#L4930) `Store/apiTokens` | `SQLite.all` (4930); `SQLite.prepare` (4930); `Store.sql` (4930) | CORE |
| [packages/store/src/store.ts:4940](../../packages/store/src/store.ts#L4940) `Store/revokeApiToken` | `SQLite.prepare` (4940); `Store.sql` (4940) | CORE |
| [packages/store/src/store.ts:4954](../../packages/store/src/store.ts#L4954) `Store/apiToken` | `SQLite.get` (4954); `SQLite.prepare` (4954, 4966); `Store.sql` (4954, 4966) | CORE |
| [packages/store/src/store.ts:4982](../../packages/store/src/store.ts#L4982) `Store/enrollTotp` | `SQLite.prepare` (4982); `Store.sql` (4982) | CORE |
| [packages/store/src/store.ts:4993](../../packages/store/src/store.ts#L4993) `Store/confirmTotp` | `SQLite.get` (4993); `SQLite.prepare` (4993, 4995); `Store.sql` (4993, 4995) | CORE |
| [packages/store/src/store.ts:5003](../../packages/store/src/store.ts#L5003) `Store/hasTotp` | `SQLite.get` (5003); `SQLite.prepare` (5003); `Store.sql` (5003) | CORE |
| [packages/store/src/store.ts:5008](../../packages/store/src/store.ts#L5008) `Store/totpAccounts` | `SQLite.all` (5008); `SQLite.prepare` (5008); `Store.sql` (5008) | CORE |
| [packages/store/src/store.ts:5014](../../packages/store/src/store.ts#L5014) `Store/disableTotp` | `SQLite.prepare` (5014); `Store.sql` (5014) | CORE |
| [packages/store/src/store.ts:5037](../../packages/store/src/store.ts#L5037) `Store/verifyTotp` | `SQLite.get` (5037); `SQLite.prepare` (5037, 5043); `Store.sql` (5037, 5043) | CORE |
| [packages/store/src/store.ts:5056](../../packages/store/src/store.ts#L5056) `Store/issueWebauthnChallenge` | `SQLite.prepare` (5056, 5058, 5059, 5061); `Store.sql` (5056, 5058, 5059, 5061); `SQLite.get` (5058) | CORE |
| [packages/store/src/store.ts:5108](../../packages/store/src/store.ts#L5108) `Store/passkeyAllowList` | `SQLite.all` (5108); `SQLite.prepare` (5108); `Store.sql` (5108) | CORE |
| [packages/store/src/store.ts:5122](../../packages/store/src/store.ts#L5122) `Store/takeWebauthnChallenge` | `SQLite.get` (5122); `SQLite.prepare` (5122, 5124); `Store.sql` (5122, 5124) | CORE |
| [packages/store/src/store.ts:5132](../../packages/store/src/store.ts#L5132) `Store/passkeys` | `SQLite.all` (5132); `SQLite.prepare` (5132); `Store.sql` (5132) | CORE |
| [packages/store/src/store.ts:5139](../../packages/store/src/store.ts#L5139) `Store/hasPasskey` | `SQLite.get` (5139); `SQLite.prepare` (5139); `Store.sql` (5139) | CORE |
| [packages/store/src/store.ts:5144](../../packages/store/src/store.ts#L5144) `Store/passkeyIds` | `SQLite.all` (5144); `SQLite.prepare` (5144); `Store.sql` (5144) | CORE |
| [packages/store/src/store.ts:5166](../../packages/store/src/store.ts#L5166) `Store/registerPasskey` | `SQLite.prepare` (5166); `Store.sql` (5166) | CORE |
| [packages/store/src/store.ts:5177](../../packages/store/src/store.ts#L5177) `Store/removePasskey` | `SQLite.get` (5177); `SQLite.prepare` (5177, 5178); `Store.sql` (5177, 5178) | CORE |
| [packages/store/src/store.ts:5194](../../packages/store/src/store.ts#L5194) `Store/verifyPasskeyAssertion` | `SQLite.get` (5194); `SQLite.prepare` (5194, 5205); `Store.sql` (5194, 5205) | CORE |
| [packages/store/src/store.ts:5241](../../packages/store/src/store.ts#L5241) `Store/generateRecoveryCodes` | `SQLite.prepare` (5241, 5244); `Store.sql` (5241, 5244) | CORE |
| [packages/store/src/store.ts:5259](../../packages/store/src/store.ts#L5259) `Store/recoveryCodesRemaining` | `SQLite.get` (5259); `SQLite.prepare` (5259); `Store.sql` (5259) | CORE |
| [packages/store/src/store.ts:5269](../../packages/store/src/store.ts#L5269) `Store/useRecoveryCode` | `SQLite.get` (5269); `SQLite.prepare` (5269, 5271); `Store.sql` (5269, 5271) | CORE |
| [packages/store/src/store.ts:5282](../../packages/store/src/store.ts#L5282) `Store/privilegeSets` | `Store.sql` (5282) | CORE |
| [packages/store/src/store.ts:5311](../../packages/store/src/store.ts#L5311) `Store/savePrivilegeSet` | `SQLite.prepare` (5311, 5319); `Store.sql` (5311, 5319) | AUTH |
| [packages/store/src/store.ts:5354](../../packages/store/src/store.ts#L5354) `Store/deletePrivilegeSet` | `SQLite.prepare` (5354); `Store.sql` (5354) | CORE |
| [packages/store/src/store.ts:5423](../../packages/store/src/store.ts#L5423) `Store/accountPrivilegeSet` | `SQLite.get` (5423); `SQLite.prepare` (5423); `Store.sql` (5423) | CORE |
| [packages/store/src/store.ts:5437](../../packages/store/src/store.ts#L5437) `Store/setAccountPrivilegeSet` | `SQLite.get` (5437); `SQLite.prepare` (5437, 5440, 5444); `Store.sql` (5437, 5440, 5444) | AUTH |
| [packages/store/src/store.ts:5459](../../packages/store/src/store.ts#L5459) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5459); `Store.sql` (5459) | CORE |
| [packages/store/src/store.ts:5473](../../packages/store/src/store.ts#L5473) `Store/addProvisionedAccount` | `SQLite.get` (5473); `SQLite.prepare` (5473, 5477); `Store.sql` (5473, 5477) | CORE |
| [packages/store/src/store.ts:5646](../../packages/store/src/store.ts#L5646) `Store/ruleOutcome` | `Calculations.context` (5646) | CORE |
| [packages/store/src/store.ts:5687](../../packages/store/src/store.ts#L5687) `Store/allowedIds` | `SQLite.iterate` (5687); `SQLite.prepare` (5687); `Store.sql` (5687) | CORE |
| [packages/store/src/store.ts:5785](../../packages/store/src/store.ts#L5785) `Store/scopedTableSql` | `Store.viewableIds` (5785); `SQLite.all` (5788); `SQLite.prepare` (5788); `Store.sql` (5788) | GATED-STORE |
| [packages/store/src/store.ts:5820](../../packages/store/src/store.ts#L5820) `Store/previewRecordRuleCurrent` | `SQLite.get` (5820); `SQLite.prepare` (5820, 5823); `Store.sql` (5820, 5823); `SQLite.all` (5823); `Calculations.context` (5829, 5845) | CORE |
| [packages/store/src/store.ts:5997](../../packages/store/src/store.ts#L5997) `Store/passwordHash` | `SQLite.get` (5997); `SQLite.prepare` (5997); `Store.sql` (5997) | CORE |
| [packages/store/src/store.ts:6026](../../packages/store/src/store.ts#L6026) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (6026); `Store.sql` (6026) | CORE |
| [packages/store/src/store.ts:6039](../../packages/store/src/store.ts#L6039) `Store/knownSharedAccount` | `SQLite.get` (6039); `SQLite.prepare` (6039); `Store.sql` (6039) | CORE |
| [packages/store/src/store.ts:6102](../../packages/store/src/store.ts#L6102) `Store/layouts` | `SQLite.all` (6102); `SQLite.prepare` (6102); `Store.sql` (6102) | CORE |
| [packages/store/src/store.ts:6123](../../packages/store/src/store.ts#L6123) `Store/image` | `SQLite.get` (6123); `SQLite.prepare` (6123); `Store.sql` (6123) | CORE |
| [packages/store/src/store.ts:6133](../../packages/store/src/store.ts#L6133) `Store/images` | `SQLite.all` (6133); `SQLite.prepare` (6133); `Store.sql` (6133) | CORE |
| [packages/store/src/store.ts:6146](../../packages/store/src/store.ts#L6146) `Store/addImage` | `Store.sql` (6146, 6147); `SQLite.prepare` (6147) | CORE |
| [packages/store/src/store.ts:6163](../../packages/store/src/store.ts#L6163) `Store/layout` | `SQLite.get` (6163); `SQLite.prepare` (6163); `Store.sql` (6163) | CORE |
| [packages/store/src/store.ts:6367](../../packages/store/src/store.ts#L6367) `Store/wordIndex` | `Store.sql` (6367, 6375, 6380); `Store.recordCount` (6379); `SQLite.get` (6380); `SQLite.prepare` (6380) | CORE |
| [packages/store/src/store.ts:6432](../../packages/store/src/store.ts#L6432) `Store/toRecord` | `Calculations.value` (6432, 6442); `Calculations.globalValue` (6436); `Calculations.unstoredStyled` (6441) | CORE |
| [packages/store/src/store.ts:6491](../../packages/store/src/store.ts#L6491) `Store/relatedValues` | `Calculations.globalValue` (6491); `Calculations.unstoredValue` (6493) | CORE |
| [packages/store/src/store.ts:6565](../../packages/store/src/store.ts#L6565) `Store/addRelated` | `relatedRows` (6565); `rowsById` (6597); `firstRelatedEach` (6620) | CORE |
| [packages/store/src/store.ts:6648](../../packages/store/src/store.ts#L6648) `Store/foundSetPage` | `rowsById` (6648) | CORE |
| [packages/store/src/store.ts:6664](../../packages/store/src/store.ts#L6664) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6664); `Store.row` (6680) | GATED-STORE |
| [packages/store/src/store.ts:6703](../../packages/store/src/store.ts#L6703) `Store/portalCountsCurrent` | `Store.canView` (6703); `Store.row` (6730) | GATED-STORE |
| [packages/store/src/store.ts:6766](../../packages/store/src/store.ts#L6766) `Store/fieldIndexCurrent` | `SQLite.iterate` (6766); `SQLite.prepare` (6766, 6771); `Store.sql` (6766, 6771); `SQLite.all` (6771) | GATED-STORE |
| [packages/store/src/store.ts:6812](../../packages/store/src/store.ts#L6812) `Store/valueListItemsCurrent` | `Store.valueListItems` (6812); `Store.get` (6826); `relatedRows` (6827); `Store.row` (6827); `SQLite.iterate` (6829); `SQLite.prepare` (6829); `Store.sql` (6829); `Calculations.related` (6839); `Calculations.value` (6843, 6844) | GATED-STORE |
| [packages/store/src/store.ts:6941](../../packages/store/src/store.ts#L6941) `Store/portalRows` | `relatedRows` (6941); `relatedIdList` (6942); `Store.viewableIds` (6945); `rowsById` (6970, 7008); `Calculations.related` (6984) | CORE |
| [packages/store/src/store.ts:6952](../../packages/store/src/store.ts#L6952) `Store/portalRows/context` | `Calculations.context` (6952) | CORE |
| [packages/store/src/store.ts:6962](../../packages/store/src/store.ts#L6962) `Store/portalRows/valueOf` | `Calculations.value` (6962) | CORE |
| [packages/store/src/store.ts:7079](../../packages/store/src/store.ts#L7079) `Store/markRepeating` | `SQLite.prepare` (7079); `Store.sql` (7079) | CORE |
| [packages/store/src/store.ts:7106](../../packages/store/src/store.ts#L7106) `Store/externalContainerCheck` | `SQLite.all` (7106); `SQLite.prepare` (7106); `Store.sql` (7106) | CORE |
| [packages/store/src/store.ts:7113](../../packages/store/src/store.ts#L7113) `Store/externalContainerCount` | `SQLite.get` (7113); `SQLite.prepare` (7113); `Store.sql` (7113) | CORE |
| [packages/store/src/store.ts:7122](../../packages/store/src/store.ts#L7122) `Store/externalContainerReport` | `SQLite.all` (7122, 7135); `SQLite.prepare` (7122, 7135); `Store.sql` (7122, 7135) | CORE |
| [packages/store/src/store.ts:7271](../../packages/store/src/store.ts#L7271) `Store/orphanContainerReport` | `SQLite.all` (7271); `SQLite.prepare` (7271); `Store.sql` (7271) | CORE |
| [packages/store/src/store.ts:7306](../../packages/store/src/store.ts#L7306) `Store/purgeOrphanContainers` | `Store.sql` (7306, 7310, 7319, 7322, 7323, 7328, 7329, 7331, 7331); `Store.orphanContainerReport` (7314); `SQLite.get` (7319); `SQLite.prepare` (7319, 7322, 7323) | CORE |
| [packages/store/src/store.ts:7344](../../packages/store/src/store.ts#L7344) `Store/containerIntact` | `SQLite.get` (7344); `SQLite.prepare` (7344); `Store.sql` (7344) | CORE |
| [packages/store/src/store.ts:7354](../../packages/store/src/store.ts#L7354) `Store/externalOf` | `SQLite.get` (7354); `SQLite.prepare` (7354); `Store.sql` (7354) | CORE |
| [packages/store/src/store.ts:7358](../../packages/store/src/store.ts#L7358) `Store/containerMeta` | `SQLite.get` (7358); `SQLite.prepare` (7358); `Store.sql` (7358) | CORE |
| [packages/store/src/store.ts:7363](../../packages/store/src/store.ts#L7363) `Store/container` | `SQLite.get` (7363); `SQLite.prepare` (7363, 7372); `Store.sql` (7363, 7372); `SQLite.all` (7372) | CORE |
| [packages/store/src/store.ts:7380](../../packages/store/src/store.ts#L7380) `Store/containerInfo` | `SQLite.get` (7380); `SQLite.prepare` (7380); `Store.sql` (7380) | CORE |
| [packages/store/src/store.ts:7414](../../packages/store/src/store.ts#L7414) `Store/containerRange` | `SQLite.all` (7414); `SQLite.prepare` (7414, 7421); `Store.sql` (7414, 7421); `SQLite.get` (7421) | CORE |
| [packages/store/src/store.ts:7439](../../packages/store/src/store.ts#L7439) `Store/addContainer` | `SQLite.all` (7439); `SQLite.prepare` (7439, 7444, 7458, 7462, 7463); `Store.sql` (7439, 7444, 7458, 7460, 7462, 7463, 7465, 7468); `SQLite.get` (7449); `Store.containerRange` (7451) | CORE |
| [packages/store/src/store.ts:7485](../../packages/store/src/store.ts#L7485) `Store/addExternalContainer` | `SQLite.prepare` (7485); `Store.sql` (7485) | CORE |
| [packages/store/src/store.ts:7503](../../packages/store/src/store.ts#L7503) `Store/writeExternalFile` | `Store.evaluateEach` (7503); `SQLite.prepare` (7526); `Store.sql` (7526) | CORE |
| [packages/store/src/store.ts:7527](../../packages/store/src/store.ts#L7527) `Store/writeExternalFile/taken` | `SQLite.get` (7527) | CORE |
| [packages/store/src/store.ts:7587](../../packages/store/src/store.ts#L7587) `Store/embeddedContainers` | `SQLite.prepare` (7587, 7588); `Store.sql` (7587, 7588); `SQLite.all` (7588); `SQLite.get` (7592) | CORE |
| [packages/store/src/store.ts:7601](../../packages/store/src/store.ts#L7601) `Store/embeddedContainerCount` | `SQLite.prepare` (7601); `Store.sql` (7601); `SQLite.get` (7602) | CORE |
| [packages/store/src/store.ts:7610](../../packages/store/src/store.ts#L7610) `Store/recoverContainersOut` | `SQLite.prepare` (7610); `Store.sql` (7610); `SQLite.get` (7613) | CORE |
| [packages/store/src/store.ts:7638](../../packages/store/src/store.ts#L7638) `Store/moveContainersOut` | `Store.sql` (7638, 7646, 7648, 7650, 7655, 7656, 7676, 7682, 7684, 7686, 7686, 7692, 7692, 7697, 7699, 7701, 7701, 7707); `SQLite.get` (7646); `SQLite.prepare` (7646, 7655, 7656); `Store.container` (7658) | CORE |
| [packages/store/src/store.ts:7716](../../packages/store/src/store.ts#L7716) `Store/moveContainersIn` | `Store.sql` (7716, 7722, 7724, 7725, 7726, 7727, 7747, 7752, 7752, 7763, 7766, 7769, 7776); `SQLite.prepare` (7724, 7725, 7726, 7727, 7763, 7769); `SQLite.get` (7729, 7763, 7769) | CORE |
| [packages/store/src/store.ts:7788](../../packages/store/src/store.ts#L7788) `Store/compactFile` | `Store.sql` (7788, 7789, 7791) | CORE |
| [packages/store/src/store.ts:7797](../../packages/store/src/store.ts#L7797) `Store/containerId` | `Store.containerId` (7797); `Store.row` (7798) | CORE |
| [packages/store/src/store.ts:7820](../../packages/store/src/store.ts#L7820) `Store/checkContainerWrite` | `Store.row` (7820) | CORE |
| [packages/store/src/store.ts:7829](../../packages/store/src/store.ts#L7829) `Store/setContainer` | `Store.sql` (7829, 7846); `Store.row` (7835); `SQLite.prepare` (7846) | CORE |
| [packages/store/src/store.ts:7879](../../packages/store/src/store.ts#L7879) `Store/orderBy` | `Store.valueListItems` (7879) | CORE |
| [packages/store/src/store.ts:7902](../../packages/store/src/store.ts#L7902) `Store/userPrefs` | `SQLite.all` (7902); `SQLite.prepare` (7902); `Store.sql` (7902) | CORE |
| [packages/store/src/store.ts:7907](../../packages/store/src/store.ts#L7907) `Store/hasTable` | `SQLite.get` (7907); `SQLite.prepare` (7907); `Store.sql` (7907) | CORE |
| [packages/store/src/store.ts:7911](../../packages/store/src/store.ts#L7911) `Store/setUserPref` | `Store.sql` (7911, 7912, 7913); `SQLite.prepare` (7912, 7913) | CORE |
| [packages/store/src/store.ts:7919](../../packages/store/src/store.ts#L7919) `Store/indexedFields` | `SQLite.all` (7919, 7920); `SQLite.prepare` (7919, 7920); `Store.sql` (7919, 7920) | CORE |
| [packages/store/src/store.ts:7941](../../packages/store/src/store.ts#L7941) `Store/addFieldIndex` | `Store.sql` (7941) | CORE |
| [packages/store/src/store.ts:7953](../../packages/store/src/store.ts#L7953) `Store/dropFieldIndex` | `SQLite.get` (7953); `SQLite.prepare` (7953); `Store.sql` (7953, 7954) | CORE |
| [packages/store/src/store.ts:7964](../../packages/store/src/store.ts#L7964) `Store/timeFind` | `Store.query` (7964, 7968, 7969); `Store.recordCount` (7971) | CORE |
| [packages/store/src/store.ts:7988](../../packages/store/src/store.ts#L7988) `Store/find` | `Store.find` (7988) | GATED-STORE |
| [packages/store/src/store.ts:7999](../../packages/store/src/store.ts#L7999) `Store/findHere` | `Store.query` (7999, 8004, 8006, 8020, 8022, 8033); `Store.recordCount` (8017); `SQLite.get` (8018, 8022); `SQLite.prepare` (8018, 8022, 8028, 8035, 8044); `Store.sql` (8018, 8022, 8028, 8035, 8044); `SQLite.all` (8028, 8035, 8044) | GATED-STORE |
| [packages/store/src/store.ts:8039](../../packages/store/src/store.ts#L8039) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (8039); `SQLite.prepare` (8039); `Store.sql` (8039) | GATED-STORE |
| [packages/store/src/store.ts:8072](../../packages/store/src/store.ts#L8072) `Store/sortedPage` | `SQLite.iterate` (8072); `SQLite.prepare` (8072, 8087); `Store.sql` (8072, 8087); `SQLite.all` (8087) | CORE |
| [packages/store/src/store.ts:8144](../../packages/store/src/store.ts#L8144) `Store/relatedCriteria/matched` | `relatedRows` (8144) | CORE |
| [packages/store/src/store.ts:8147](../../packages/store/src/store.ts#L8147) `Store/relatedCriteria` | `SQLite.iterate` (8147); `SQLite.prepare` (8147); `Store.sql` (8147) | CORE |
| [packages/store/src/store.ts:8173](../../packages/store/src/store.ts#L8173) `Store/computedRows` | `Store.sql` (8173, 8176, 8177, 8178, 8180, 8190, 8191, 8192, 8195); `SQLite.prepare` (8176, 8178, 8180, 8190); `SQLite.iterate` (8180); `Calculations.globalValue` (8183); `Calculations.unstoredValue` (8184); `Calculations.related` (8187); `SQLite.all` (8190) | CORE |
| [packages/store/src/store.ts:8220](../../packages/store/src/store.ts#L8220) `Store/summaries` | `Calculations.wholeTable` (8220); `Calculations.collect` (8240, 8245) | CORE |
| [packages/store/src/store.ts:8236](../../packages/store/src/store.ts#L8236) `Store/summaries/recs` | `SQLite.iterate` (8236); `SQLite.prepare` (8236); `Store.sql` (8236) | CORE |
| [packages/store/src/store.ts:8258](../../packages/store/src/store.ts#L8258) `Store/runningSummaryValues` | `Store.viewableIds` (8258); `rowsById` (8260); `Calculations.value` (8271, 8277); `Calculations.related` (8288) | GATED-STORE |
| [packages/store/src/store.ts:8304](../../packages/store/src/store.ts#L8304) `Store/findSource` | `Store.query` (8304); `SQLite.all` (8313, 8330); `SQLite.prepare` (8313, 8321, 8329); `Store.sql` (8313, 8318, 8321, 8326, 8329, 8343, 8345); `Calculations.globalValue` (8335); `Calculations.unstoredValue` (8336); `Calculations.related` (8340) | CORE |
| [packages/store/src/store.ts:8360](../../packages/store/src/store.ts#L8360) `Store/findCandidates` | `Store.query` (8360) | CORE |
| [packages/store/src/store.ts:8395](../../packages/store/src/store.ts#L8395) `Store/previewRow` | `Store.row` (8395) | CORE |
| [packages/store/src/store.ts:8413](../../packages/store/src/store.ts#L8413) `Store/row` | `SQLite.get` (8413) | CORE |
| [packages/store/src/store.ts:8432](../../packages/store/src/store.ts#L8432) `Store/getCurrent` | `Store.get` (8432); `Store.row` (8433, 8433, 8447); `SQLite.all` (8450); `SQLite.prepare` (8450); `Store.sql` (8450) | GATED-STORE |
| [packages/store/src/store.ts:8470](../../packages/store/src/store.ts#L8470) `Store/getManyCurrent` | `Store.getMany` (8470); `SQLite.get` (8488); `SQLite.prepare` (8488); `Store.sql` (8488) | GATED-STORE |
| [packages/store/src/store.ts:8481](../../packages/store/src/store.ts#L8481) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8481) | GATED-STORE |
| [packages/store/src/store.ts:8504](../../packages/store/src/store.ts#L8504) `Store/canViewRecord` | `SQLite.get` (8504); `SQLite.prepare` (8504); `Store.sql` (8504) | GATED-STORE |
| [packages/store/src/store.ts:8522](../../packages/store/src/store.ts#L8522) `Store/canView` | `Store.canView` (8522); `Store.row` (8523) | GATED-STORE |
| [packages/store/src/store.ts:8547](../../packages/store/src/store.ts#L8547) `Store/create` | `SQLite.get` (8547, 8553); `SQLite.prepare` (8547, 8553, 8566); `Store.sql` (8547, 8553, 8566) | CORE |
| [packages/store/src/store.ts:8590](../../packages/store/src/store.ts#L8590) `Store/duplicate` | `Store.row` (8590); `SQLite.get` (8594); `SQLite.prepare` (8594, 8609); `Store.sql` (8594, 8609) | CORE |
| [packages/store/src/store.ts:8664](../../packages/store/src/store.ts#L8664) `Store/update` | `Store.row` (8664); `Store.sql` (8694, 8695, 8734, 8737) | CORE |
| [packages/store/src/store.ts:8697](../../packages/store/src/store.ts#L8697) `Store/update/undo` | `Store.sql` (8697) | CORE |
| [packages/store/src/store.ts:8842](../../packages/store/src/store.ts#L8842) `Store/setStoredCalcValues` | `SQLite.prepare` (8842, 8843); `Store.sql` (8842, 8843); `SQLite.get` (8847) | CORE |
| [packages/store/src/store.ts:8931](../../packages/store/src/store.ts#L8931) `Store/evaluateCurrent` | `Store.row` (8931, 8931, 8932, 8932); `Calculations.context` (8937); `Store.get` (8938, 8940) | GATED-STORE |
| [packages/store/src/store.ts:8972](../../packages/store/src/store.ts#L8972) `Store/evaluateEachCurrent` | `Store.row` (8972, 8972, 8977); `Calculations.context` (8978); `Store.get` (8980) | GATED-STORE |
| [packages/store/src/store.ts:9013](../../packages/store/src/store.ts#L9013) `Store/evaluateRowsCurrent/each` | `Calculations.context` (9013); `Store.get` (9015) | GATED-STORE |
| [packages/store/src/store.ts:9034](../../packages/store/src/store.ts#L9034) `Store/evaluateRowsCurrent` | `Store.row` (9034, 9034, 9035, 9035) | GATED-STORE |
| [packages/store/src/store.ts:9049](../../packages/store/src/store.ts#L9049) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (9049) | GATED-STORE |
| [packages/store/src/store.ts:9071](../../packages/store/src/store.ts#L9071) `Store/evaluateRowsCurrent/key` | `Calculations.context` (9071) | GATED-STORE |
| [packages/store/src/store.ts:9109](../../packages/store/src/store.ts#L9109) `Store/updateRelated` | `relatedRows` (9109) | CORE |
| [packages/store/src/store.ts:9127](../../packages/store/src/store.ts#L9127) `Store/updatePortals` | `Store.row` (9127, 9163); `relatedRows` (9164) | CORE |
| [packages/store/src/store.ts:9137](../../packages/store/src/store.ts#L9137) `Store/updatePortals/portal/related` | `relatedIdList` (9137) | CORE |
| [packages/store/src/store.ts:9219](../../packages/store/src/store.ts#L9219) `Store/portalContainerTarget` | `Store.row` (9219); `relatedIdList` (9221) | CORE |
| [packages/store/src/store.ts:9234](../../packages/store/src/store.ts#L9234) `Store/checkEditable` | `Store.row` (9234) | CORE |
| [packages/store/src/store.ts:9258](../../packages/store/src/store.ts#L9258) `Store/delete` | `Store.row` (9258) | CORE |
| [packages/store/src/store.ts:9266](../../packages/store/src/store.ts#L9266) `Store/delete/run` | `SQLite.get` (9266); `SQLite.prepare` (9266, 9270); `Store.sql` (9266, 9270) | CORE |
| [packages/store/src/store.ts:9498](../../packages/store/src/store.ts#L9498) `Store/keyStepWork` | `Store.sql` (9498, 9504, 9508, 9510) | CORE |
| [packages/store/src/store.ts:9299](../../packages/store/src/store.ts#L9299) `Store/vaultHeld` | `SQLite.get` (9299); `SQLite.prepare` (9299); `Store.sql` (9299) | CORE |
| [packages/store/src/store.ts:9306](../../packages/store/src/store.ts#L9306) `Store/forgetStandInValues` | `Store.sql` (9306, 9327); `SQLite.prepare` (9327) | CORE |
| [packages/store/src/store.ts:9346](../../packages/store/src/store.ts#L9346) `Store/restoreDeletedRowLocked` | `SQLite.get` (9346); `SQLite.prepare` (9346, 9347, 9351); `Store.sql` (9346, 9347, 9351); `SQLite.all` (9347) | CORE |
| [packages/store/src/store.ts:9551](../../packages/store/src/store.ts#L9551) `Store/cascadeDelete` | `relatedRows` (9551) | CORE |
| [packages/store/src/store.ts:9641](../../packages/store/src/store.ts#L9641) `Store/selectIdsCurrent` | `Store.selectIds` (9641); `SQLite.all` (9647); `SQLite.prepare` (9647); `Store.sql` (9647) | GATED-STORE |
| [packages/store/src/store.ts:9655](../../packages/store/src/store.ts#L9655) `Store/countIds` | `Store.countIds` (9655); `SQLite.get` (9659); `SQLite.prepare` (9659); `Store.sql` (9659) | GATED-STORE |
| [packages/store/src/store.ts:9675](../../packages/store/src/store.ts#L9675) `Store/computeValuesCurrent` | `Store.computeValues` (9675); `Store.sql` (9681, 9685); `SQLite.all` (9685); `SQLite.prepare` (9685) | GATED-STORE |
| [packages/store/src/store.ts:9700](../../packages/store/src/store.ts#L9700) `Store/findIdsCurrent` | `Store.findIds` (9700) | GATED-STORE |
| [packages/store/src/store.ts:9706](../../packages/store/src/store.ts#L9706) `Store/findIdsHere` | `Store.query` (9706, 9711, 9713); `SQLite.iterate` (9724); `SQLite.prepare` (9724); `Store.sql` (9724) | GATED-STORE |
| [packages/store/src/store.ts:9741](../../packages/store/src/store.ts#L9741) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9741); `Store.viewableIds` (9746); `Calculations.collect` (9762); `rowsById` (9762, 9812); `Calculations.collector` (9784) | GATED-STORE |
| [packages/store/src/store.ts:9774](../../packages/store/src/store.ts#L9774) `Store/groupSummariesCurrent/key` | `Calculations.value` (9774); `Calculations.related` (9776) | GATED-STORE |
| [packages/store/src/store.ts:9810](../../packages/store/src/store.ts#L9810) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9810) | GATED-STORE |
| [packages/store/src/store.ts:9866](../../packages/store/src/store.ts#L9866) `Store/sortIdsCurrentProgress` | `SQLite.all` (9866); `SQLite.prepare` (9866, 9934); `Store.sql` (9866, 9934); `Store.valueListItems` (9874); `rowsById` (9886); `Calculations.globalValue` (9889); `Calculations.unstoredValue` (9890); `Calculations.related` (9896); `SQLite.iterate` (9934) | GATED-STORE |
| [packages/store/src/store.ts:9948](../../packages/store/src/store.ts#L9948) `Store/matchIds` | `Store.matchIds` (9948); `SQLite.all` (9954); `SQLite.prepare` (9954); `Store.sql` (9954) | CORE |
| [packages/store/src/store.ts:9976](../../packages/store/src/store.ts#L9976) `Store/truncate/run` | `Store.sql` (9976, 9978, 9985, 9987, 9989, 9990); `SQLite.prepare` (9978, 9985); `SQLite.all` (9980) | CORE |
| [packages/store/src/store.ts:10015](../../packages/store/src/store.ts#L10015) `Store/iterateCommitted` | `SQLite.iterate` (10015) | CORE |
| [packages/store/src/store.ts:10049](../../packages/store/src/store.ts#L10049) `Store/readOnlyChecked` | `SQLite.prepare` (10049, 10053, 10062, 10067); `SQLite.all` (10053, 10062, 10067) | CORE |
| [packages/store/src/store.ts:10089](../../packages/store/src/store.ts#L10089) `Store/refreshDecimalSqlViews` | `SQLite.get` (10089); `SQLite.prepare` (10089, 10094); `SQLite.all` (10094) | CORE |
| [packages/store/src/store.ts:10108](../../packages/store/src/store.ts#L10108) `Store/internalRoots` | `SQLite.get` (10108); `SQLite.prepare` (10108, 10110); `SQLite.all` (10110) | CORE |
| [packages/store/src/store.ts:10143](../../packages/store/src/store.ts#L10143) `Store/selectCurrent` | `SQLite.iterate` (10143) | CORE |
| [packages/store/src/store.ts:10192](../../packages/store/src/store.ts#L10192) `Store/query` | `SQLite.iterate` (10192) | CORE |
| [packages/store/src/store.ts:10226](../../packages/store/src/store.ts#L10226) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10226); `SQLite.all` (10233, 10236); `SQLite.prepare` (10233, 10236) | CORE |
| [packages/store/src/store.ts:1215](../../packages/store/src/store.ts#L1215) `Store/ensureNativeIds` | `SQLite.all` (1215, 1227); `SQLite.prepare` (1215, 1218, 1226, 1227); `Store.sql` (1215, 1218, 1221, 1225, 1226, 1227, 1230, 1232) | CORE |
| [packages/store/src/store.ts:1240](../../packages/store/src/store.ts#L1240) `Store/nativeIdGuards` | `Store.sql` (1240, 1241, 1243) | CORE |
| [packages/store/src/store.ts:10159](../../packages/store/src/store.ts#L10159) `Store/selectIn` | `Store.select` (10159) | CORE |
| [packages/store/src/store.ts:10167](../../packages/store/src/store.ts#L10167) `Store/selectHeldCurrent` | `Store.sql` (10167, 10168); `SQLite.prepare` (10168); `SQLite.iterate` (10171) | CORE |
| [packages/store/src/sync-apply.ts:171](../../packages/store/src/sync-apply.ts#L171) `logRow` | `SQLite.prepare` (171); `Store.sql` (171) | OPERATOR |
| [packages/store/src/sync-apply.ts:178](../../packages/store/src/sync-apply.ts#L178) `finishRow` | `SQLite.prepare` (178); `Store.sql` (178) | OPERATOR |
| [packages/store/src/sync-apply.ts:185](../../packages/store/src/sync-apply.ts#L185) `atomically` | `Store.sql` (185, 188, 191, 192) | OPERATOR |
| [packages/store/src/sync-apply.ts:198](../../packages/store/src/sync-apply.ts#L198) `upsertMap` | `SQLite.prepare` (198); `Store.sql` (198) | OPERATOR |
| [packages/store/src/sync-apply.ts:206](../../packages/store/src/sync-apply.ts#L206) `dropMap` | `SQLite.prepare` (206, 207); `Store.sql` (206, 207) | OPERATOR |
| [packages/store/src/sync-apply.ts:242](../../packages/store/src/sync-apply.ts#L242) `heldReason` | `SQLite.get` (242); `SQLite.prepare` (242); `Store.sql` (242) | OPERATOR |
| [packages/store/src/sync-apply.ts:247](../../packages/store/src/sync-apply.ts#L247) `holdTable` | `SQLite.prepare` (247); `Store.sql` (247) | OPERATOR |
| [packages/store/src/sync-apply.ts:259](../../packages/store/src/sync-apply.ts#L259) `releaseHeldTables` | `SQLite.prepare` (259); `Store.sql` (259) | OPERATOR |
| [packages/store/src/sync-apply.ts:268](../../packages/store/src/sync-apply.ts#L268) `readSyncLog` | `SQLite.get` (268); `SQLite.prepare` (268, 270, 271); `Store.sql` (268, 270, 271); `SQLite.all` (270, 271) | OPERATOR |
| [packages/store/src/sync-apply.ts:312](../../packages/store/src/sync-apply.ts#L312) `recordsIn` | `SQLite.get` (312); `SQLite.prepare` (312); `Store.sql` (312) | OPERATOR |
| [packages/store/src/sync-apply.ts:352](../../packages/store/src/sync-apply.ts#L352) `applySyncRun` | `Store.container` (352, 353, 383); `Store.containerInfo` (369); `SQLite.prepare` (464, 730, 762, 786); `Store.sql` (464, 730, 762, 786); `SQLite.get` (762, 786) | OPERATOR |
| [packages/store/src/sync-apply.ts:485](../../packages/store/src/sync-apply.ts#L485) `applySyncRun/fail` | `SQLite.get` (485); `SQLite.prepare` (485); `Store.sql` (485) | OPERATOR |
| [packages/store/src/sync-apply.ts:676](../../packages/store/src/sync-apply.ts#L676) `applySyncRun/containerChanges` | `Store.container` (676) | OPERATOR |
| [packages/store/src/sync-apply.ts:825](../../packages/store/src/sync-apply.ts#L825) `applySyncRun/filesToSend` | `SQLite.all` (825); `SQLite.prepare` (825); `Store.sql` (825); `Store.containerInfo` (836); `Store.container` (841) | OPERATOR |
| [packages/store/src/sync-apply.ts:211](../../packages/store/src/sync-apply.ts#L211) `markContainersPending` | `SQLite.prepare` (211); `Store.sql` (211) | OPERATOR |
| [packages/store/src/sync-apply.ts:216](../../packages/store/src/sync-apply.ts#L216) `clearContainersPending` | `SQLite.prepare` (216); `Store.sql` (216) | OPERATOR |
| [packages/store/src/sync-apply.ts:231](../../packages/store/src/sync-apply.ts#L231) `owedContainers` | `SQLite.all` (231); `SQLite.prepare` (231); `Store.sql` (231) | OPERATOR |
| [packages/store/src/sync-apply.ts:580](../../packages/store/src/sync-apply.ts#L580) `applySyncRun/pullWouldChange` | `Store.container` (580, 584) | OPERATOR |
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
| [packages/store/src/store.ts:1692](../../packages/store/src/store.ts#L1692) `Store/selfContainedCopy` | `Store.sql` (1692); `SQLite.all` (1697); `SQLite.prepare` (1697, 1699, 1700, 1701) | CORE |
| [packages/store/src/store.ts:7185](../../packages/store/src/store.ts#L7185) `Store/containerReferences` | `SQLite.all` (7185, 7204, 7206, 7212, 7225, 7236, 7250); `SQLite.prepare` (7185, 7204, 7206, 7212, 7225, 7236, 7248, 7250); `Store.sql` (7185, 7204, 7206, 7212, 7225, 7236, 7248, 7250); `SQLite.get` (7248); `Store.row` (7259) | CORE |
| [packages/store/src/store.ts:7283](../../packages/store/src/store.ts#L7283) `Store/containerIntegrityReport` | `SQLite.all` (7283); `SQLite.prepare` (7283, 7294); `Store.sql` (7283, 7294); `SQLite.get` (7294) | CORE |
| [packages/store/src/store.ts:1426](../../packages/store/src/store.ts#L1426) `Store/recoverPendingExternalFiles` | `Store.sql` (1426, 1428, 1452, 1454); `SQLite.prepare` (1428); `SQLite.get` (1439) | CORE |
| [packages/store/src/store.ts:2261](../../packages/store/src/store.ts#L2261) `Store/restoreRecord` | `Store.recordAsOf` (2261); `SQLite.get` (2265); `SQLite.prepare` (2265, 2269, 2278, 2289); `Store.sql` (2265, 2269, 2278, 2289) | CORE |
| [packages/store/src/store.ts:8921](../../packages/store/src/store.ts#L8921) `Store/recordViewable` | `Store.row` (8921) | GATED-STORE |
| [packages/server/src/compaction.ts:65](../../packages/server/src/compaction.ts#L65) `compactStore` | `SQLite.get` (65, 66, 80, 88); `SQLite.prepare` (65, 66, 80, 88) | OPERATOR |
<!-- end generated read-gate inventory -->
