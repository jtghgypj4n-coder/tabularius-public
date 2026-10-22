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
| [packages/server/src/admin.ts:978](../../packages/server/src/admin.ts#L978) `Admin/handle` | `Store.externalContainerReport` (978); `Store.orphanContainerReport` (983, 987) | ADMIN |
| [packages/server/src/admin.ts:2150](../../packages/server/src/admin.ts#L2150) `Admin/audit` | `Store.auditLog` (2150) | ADMIN |
| [packages/server/src/admin.ts:2233](../../packages/server/src/admin.ts#L2233) `Admin/viewAs` | `Store.find` (2233) | ADMIN |
| [packages/server/src/admin.ts:2581](../../packages/server/src/admin.ts#L2581) `Admin/status` | `Store.externalContainerCount` (2581) | ADMIN |
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
| [packages/store/src/store.ts:872](../../packages/store/src/store.ts#L872) `Store/metadataVersions` | `SQLite.get` (872); `SQLite.prepare` (872); `Store.sql` (872) | CORE |
| [packages/store/src/store.ts:1010](../../packages/store/src/store.ts#L1010) `Store/constructor` | `Store.sql` (1010, 1012, 1014, 1015, 1019, 1023, 1024, 1035, 1040, 1045, 1046, 1050, 1051, 1052, 1059, 1063, 1067, 1068, 1069, 1074, 1078, 1081, 1082, 1084, 1085, 1088, 1089, 1093, 1094, 1098, 1099, 1102, 1104, 1107, 1108, 1112, 1113, 1117, 1118, 1121, 1122, 1123, 1126, 1127, 1130, 1131, 1133, 1133, 1134, 1134, 1135, 1138, 1142, 1144, 1147, 1148, 1149, 1152, 1153, 1155, 1157, 1158, 1162, 1163, 1165, 1169, 1170, 1171, 1171, 1175, 1176); `SQLite.get` (1014); `SQLite.prepare` (1014, 1081, 1082, 1085, 1088, 1093, 1098, 1107, 1112, 1117, 1126, 1130, 1133, 1134, 1152, 1157, 1162); `SQLite.all` (1081, 1088, 1093, 1098, 1107, 1112, 1117, 1126, 1130, 1133, 1134, 1152, 1157, 1162) | CORE |
| [packages/store/src/store.ts:1233](../../packages/store/src/store.ts#L1233) `Store/grantFullAccessClients` | `SQLite.prepare` (1233); `Store.sql` (1233) | CORE |
| [packages/store/src/store.ts:1250](../../packages/store/src/store.ts#L1250) `Store/meta` | `SQLite.get` (1250); `SQLite.prepare` (1250); `Store.sql` (1250) | CORE |
| [packages/store/src/store.ts:1258](../../packages/store/src/store.ts#L1258) `Store/persistentTable` | `Store.sql` (1258) | CORE |
| [packages/store/src/store.ts:1268](../../packages/store/src/store.ts#L1268) `Store/persistentData` | `SQLite.get` (1268) | CORE |
| [packages/store/src/store.ts:1277](../../packages/store/src/store.ts#L1277) `Store/persistentDataIds` | `SQLite.all` (1277) | CORE |
| [packages/store/src/store.ts:1283](../../packages/store/src/store.ts#L1283) `Store/setPersistentData` | `SQLite.prepare` (1283, 1287); `Store.sql` (1283, 1287) | CORE |
| [packages/store/src/store.ts:1300](../../packages/store/src/store.ts#L1300) `Store/checkpoint` | `SQLite.get` (1300); `SQLite.prepare` (1300); `Store.sql` (1300) | CORE |
| [packages/store/src/store.ts:1308](../../packages/store/src/store.ts#L1308) `Store/recordedFormat` | `Store.sql` (1308) | CORE |
| [packages/store/src/store.ts:1318](../../packages/store/src/store.ts#L1318) `Store/close` | `Store.sql` (1318) | CORE |
| [packages/store/src/store.ts:1334](../../packages/store/src/store.ts#L1334) `Store/shipWal` | `Store.sql` (1334) | CORE |
| [packages/store/src/store.ts:1345](../../packages/store/src/store.ts#L1345) `Store/trial` | `Store.sql` (1345) | CORE |
| [packages/store/src/store.ts:1350](../../packages/store/src/store.ts#L1350) `Store/trial/undo` | `Store.sql` (1350) | CORE |
| [packages/store/src/store.ts:1385](../../packages/store/src/store.ts#L1385) `Store/joinTransaction` | `Store.sql` (1385, 1386, 1388, 1390, 1396) | CORE |
| [packages/store/src/store.ts:1408](../../packages/store/src/store.ts#L1408) `Store/independentWindowWrite` | `SQLite.get` (1408); `SQLite.prepare` (1408, 1431); `Store.sql` (1408, 1411, 1426, 1431, 1434) | CORE |
| [packages/store/src/store.ts:1456](../../packages/store/src/store.ts#L1456) `Store/withWriteTransaction` | `Store.sql` (1456, 1459, 1463, 1465, 1465) | CORE |
| [packages/store/src/store.ts:1495](../../packages/store/src/store.ts#L1495) `Store/endTransaction` | `Store.sql` (1495, 1498, 1498) | CORE |
| [packages/store/src/store.ts:1524](../../packages/store/src/store.ts#L1524) `Store/backup` | `Store.sql` (1524) | CORE |
| [packages/store/src/store.ts:1614](../../packages/store/src/store.ts#L1614) `Store/dataVersion` | `SQLite.get` (1614); `SQLite.prepare` (1614); `Store.sql` (1614) | CORE |
| [packages/store/src/store.ts:1654](../../packages/store/src/store.ts#L1654) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1654) | CORE |
| [packages/store/src/store.ts:1675](../../packages/store/src/store.ts#L1675) `Store/shareResults` | `Store.sql` (1675) | CORE |
| [packages/store/src/store.ts:1685](../../packages/store/src/store.ts#L1685) `Store/versionTriggers` | `SQLite.get` (1685); `SQLite.prepare` (1685, 1690, 1691); `Store.sql` (1685, 1687, 1688, 1690, 1691, 1700, 1701); `SQLite.all` (1690, 1691) | CORE |
| [packages/store/src/store.ts:1717](../../packages/store/src/store.ts#L1717) `Store/versionNumber` | `SQLite.get` (1717); `SQLite.prepare` (1717); `Store.sql` (1717) | CORE |
| [packages/store/src/store.ts:1730](../../packages/store/src/store.ts#L1730) `Store/changeOne` | `Store.sql` (1730, 1732) | CORE |
| [packages/store/src/store.ts:1733](../../packages/store/src/store.ts#L1733) `Store/changeOne/read` | `SQLite.get` (1733); `SQLite.prepare` (1733); `Store.sql` (1733) | CORE |
| [packages/store/src/store.ts:1772](../../packages/store/src/store.ts#L1772) `Store/writeToken` | `SQLite.get` (1772); `SQLite.prepare` (1772); `Store.sql` (1772) | CORE |
| [packages/store/src/store.ts:1784](../../packages/store/src/store.ts#L1784) `Store/recordCount` | `SQLite.get` (1784); `SQLite.prepare` (1784); `Store.sql` (1784) | CORE |
| [packages/store/src/store.ts:1896](../../packages/store/src/store.ts#L1896) `Store/applyDesign` | `Store.sql` (1896, 1897, 1910, 1913, 1918, 1932, 1935, 1935); `SQLite.prepare` (1913, 1918) | CORE |
| [packages/store/src/store.ts:1993](../../packages/store/src/store.ts#L1993) `Store/auditLog` | `SQLite.all` (1993); `SQLite.prepare` (1993); `Store.sql` (1993) | CORE |
| [packages/store/src/store.ts:2033](../../packages/store/src/store.ts#L2033) `Store/securityEvents` | `Store.auditLog` (2033) | CORE |
| [packages/store/src/store.ts:2059](../../packages/store/src/store.ts#L2059) `Store/prepared` | `SQLite.prepare` (2059); `Store.sql` (2059) | CORE |
| [packages/store/src/store.ts:2074](../../packages/store/src/store.ts#L2074) `Store/recordAsOf` | `SQLite.get` (2074, 2076); `SQLite.prepare` (2074, 2076, 2078, 2079); `Store.sql` (2074, 2076, 2078, 2079); `SQLite.all` (2078, 2079) | CORE |
| [packages/store/src/store.ts:2108](../../packages/store/src/store.ts#L2108) `Store/restoreRecord/run` | `Store.recordAsOf` (2108); `SQLite.get` (2112); `SQLite.prepare` (2112, 2116, 2125, 2136); `Store.sql` (2112, 2116, 2125, 2136) | CORE |
| [packages/store/src/store.ts:2152](../../packages/store/src/store.ts#L2152) `Store/revertAuditEntry` | `Store.auditLog` (2152) | CORE |
| [packages/store/src/store.ts:2245](../../packages/store/src/store.ts#L2245) `Store/setAuditSettings` | `SQLite.prepare` (2245); `Store.sql` (2245) | CORE |
| [packages/store/src/store.ts:2267](../../packages/store/src/store.ts#L2267) `Store/pruneAudit` | `Store.sql` (2267, 2269, 2271); `SQLite.get` (2269); `SQLite.prepare` (2269) | CORE |
| [packages/store/src/store.ts:2349](../../packages/store/src/store.ts#L2349) `Store/audit` | `Store.sql` (2349) | CORE |
| [packages/store/src/store.ts:2438](../../packages/store/src/store.ts#L2438) `Store/securityChange` | `Store.sql` (2438, 2440); `SQLite.prepare` (2440) | CORE |
| [packages/store/src/store.ts:2487](../../packages/store/src/store.ts#L2487) `Store/logSecurity` | `Store.sql` (2487) | CORE |
| [packages/store/src/store.ts:2510](../../packages/store/src/store.ts#L2510) `Store/ensureDeleted` | `Store.sql` (2510) | CORE |
| [packages/store/src/store.ts:2515](../../packages/store/src/store.ts#L2515) `Store/deletedRows` | `SQLite.get` (2515); `SQLite.prepare` (2515, 2517, 2517); `Store.sql` (2515, 2517, 2517); `SQLite.all` (2517, 2517) | CORE |
| [packages/store/src/store.ts:2541](../../packages/store/src/store.ts#L2541) `Store/emptyDeleted` | `Store.sql` (2541, 2544, 2545, 2547, 2549); `SQLite.prepare` (2545) | CORE |
| [packages/store/src/store.ts:2556](../../packages/store/src/store.ts#L2556) `Store/designHistory` | `SQLite.all` (2556); `SQLite.prepare` (2556); `Store.sql` (2556) | CORE |
| [packages/store/src/store.ts:2563](../../packages/store/src/store.ts#L2563) `Store/scriptHistory` | `SQLite.all` (2563); `SQLite.prepare` (2563); `Store.sql` (2563) | CORE |
| [packages/store/src/store.ts:2573](../../packages/store/src/store.ts#L2573) `Store/layoutHistory` | `SQLite.all` (2573); `SQLite.prepare` (2573); `Store.sql` (2573) | CORE |
| [packages/store/src/store.ts:2598](../../packages/store/src/store.ts#L2598) `Store/designEffect/renameKey` | `SQLite.prepare` (2598); `Store.sql` (2598) | CORE |
| [packages/store/src/store.ts:2614](../../packages/store/src/store.ts#L2614) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2614); `Store.sql` (2614) | CORE |
| [packages/store/src/store.ts:2621](../../packages/store/src/store.ts#L2621) `Store/designEffect` | `Store.sql` (2621, 2626, 2631, 2636, 2639, 2645, 2653, 2654, 2656, 2668, 2669, 2672, 2674, 2680, 2681, 2682, 2687, 2689, 2693, 2696, 2697, 2699, 2702, 2707, 2709, 2716, 2717, 2719, 2720, 2721, 2722, 2729, 2730, 2732, 2732, 2734, 2735, 2736, 2740, 2744, 2746, 2784, 2786, 2788); `SQLite.get` (2653, 2668, 2680, 2681, 2693, 2697, 2732, 2740); `SQLite.prepare` (2653, 2654, 2668, 2669, 2680, 2681, 2687, 2689, 2693, 2697, 2707, 2709, 2722, 2729, 2730, 2732, 2734, 2736, 2740, 2744); `SQLite.all` (2729, 2730); `SQLite.iterate` (2734) | CORE |
| [packages/store/src/store.ts:2796](../../packages/store/src/store.ts#L2796) `Store/dropColumnIndexes` | `SQLite.all` (2796, 2798); `SQLite.prepare` (2796, 2798); `Store.sql` (2796, 2798, 2799) | CORE |
| [packages/store/src/store.ts:2808](../../packages/store/src/store.ts#L2808) `Store/recompute` | `SQLite.prepare` (2808, 2812); `Store.sql` (2808, 2812); `SQLite.iterate` (2812); `Calculations.computeStoredStyled` (2813); `Calculations.value` (2813) | CORE |
| [packages/store/src/store.ts:2828](../../packages/store/src/store.ts#L2828) `Store/linkPrincipal` | `SQLite.get` (2828); `SQLite.prepare` (2828); `Store.sql` (2828) | CORE |
| [packages/store/src/store.ts:2835](../../packages/store/src/store.ts#L2835) `Store/linkIdentity` | `SQLite.get` (2835); `SQLite.prepare` (2835); `Store.sql` (2835) | CORE |
| [packages/store/src/store.ts:2841](../../packages/store/src/store.ts#L2841) `Store/accountsSharingLockout` | `SQLite.all` (2841); `SQLite.prepare` (2841); `Store.sql` (2841) | CORE |
| [packages/store/src/store.ts:2845](../../packages/store/src/store.ts#L2845) `Store/accounts` | `SQLite.all` (2845); `SQLite.prepare` (2845); `Store.sql` (2845) | CORE |
| [packages/store/src/store.ts:2857](../../packages/store/src/store.ts#L2857) `Store/isAgent` | `SQLite.get` (2857); `SQLite.prepare` (2857); `Store.sql` (2857) | CORE |
| [packages/store/src/store.ts:2863](../../packages/store/src/store.ts#L2863) `Store/agentNeedsApproval` | `SQLite.get` (2863); `SQLite.prepare` (2863); `Store.sql` (2863) | CORE |
| [packages/store/src/store.ts:2869](../../packages/store/src/store.ts#L2869) `Store/blankPasswordAccounts` | `SQLite.all` (2869); `SQLite.prepare` (2869); `Store.sql` (2869) | CORE |
| [packages/store/src/store.ts:1241](../../packages/store/src/store.ts#L1241) `Store/hasOwnPassword` | `SQLite.get` (1241); `SQLite.prepare` (1241); `Store.sql` (1241) | CORE |
| [packages/store/src/store.ts:2880](../../packages/store/src/store.ts#L2880) `Store/unmigratedAccounts` | `SQLite.all` (2880); `SQLite.prepare` (2880); `Store.sql` (2880) | CORE |
| [packages/store/src/store.ts:2933](../../packages/store/src/store.ts#L2933) `Store/setExternalAccount` | `SQLite.get` (2933); `SQLite.prepare` (2933, 2938); `Store.sql` (2933, 2938) | CORE |
| [packages/store/src/store.ts:2951](../../packages/store/src/store.ts#L2951) `Store/refuseLookalikeAccount` | `SQLite.all` (2951); `SQLite.prepare` (2951); `Store.sql` (2951) | CORE |
| [packages/store/src/store.ts:2960](../../packages/store/src/store.ts#L2960) `Store/isExternal` | `SQLite.get` (2960); `SQLite.prepare` (2960); `Store.sql` (2960) | CORE |
| [packages/store/src/store.ts:2981](../../packages/store/src/store.ts#L2981) `Store/setAgentAccount` | `SQLite.get` (2981); `SQLite.prepare` (2981, 2987); `Store.sql` (2981, 2987) | CORE |
| [packages/store/src/store.ts:3021](../../packages/store/src/store.ts#L3021) `Store/gateAgentWrite` | `SQLite.prepare` (3021); `Store.sql` (3021) | CORE |
| [packages/store/src/store.ts:3043](../../packages/store/src/store.ts#L3043) `Store/pendingChanges` | `SQLite.all` (3043); `SQLite.prepare` (3043); `Store.sql` (3043) | CORE |
| [packages/store/src/store.ts:3057](../../packages/store/src/store.ts#L3057) `Store/approvePending` | `SQLite.get` (3057); `SQLite.prepare` (3057, 3068); `Store.sql` (3057, 3068) | CORE |
| [packages/store/src/store.ts:3078](../../packages/store/src/store.ts#L3078) `Store/rejectPending` | `SQLite.get` (3078); `SQLite.prepare` (3078, 3080); `Store.sql` (3078, 3080) | CORE |
| [packages/store/src/store.ts:3100](../../packages/store/src/store.ts#L3100) `Store/externalAccount` | `SQLite.all` (3100); `SQLite.prepare` (3100); `Store.sql` (3100) | CORE |
| [packages/store/src/store.ts:3131](../../packages/store/src/store.ts#L3131) `Store/setPassword` | `SQLite.get` (3131); `SQLite.prepare` (3131, 3133, 3142); `Store.sql` (3131, 3133, 3142) | AUTH |
| [packages/store/src/store.ts:3156](../../packages/store/src/store.ts#L3156) `Store/createAccount` | `SQLite.get` (3156); `SQLite.prepare` (3156, 3160, 3166, 3171, 3176); `Store.sql` (3156, 3160, 3166, 3171, 3176) | CORE |
| [packages/store/src/store.ts:3184](../../packages/store/src/store.ts#L3184) `Store/appendSecurityEvent` | `Store.sql` (3184) | CORE |
| [packages/store/src/store.ts:3226](../../packages/store/src/store.ts#L3226) `Store/setPasswordPolicy` | `SQLite.prepare` (3226); `Store.sql` (3226) | CORE |
| [packages/store/src/store.ts:3262](../../packages/store/src/store.ts#L3262) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3262); `Store.sql` (3262) | CORE |
| [packages/store/src/store.ts:3285](../../packages/store/src/store.ts#L3285) `Store/saveScriptTest` | `SQLite.prepare` (3285); `Store.sql` (3285) | CORE |
| [packages/store/src/store.ts:3294](../../packages/store/src/store.ts#L3294) `Store/deleteScriptTest` | `SQLite.prepare` (3294); `Store.sql` (3294) | CORE |
| [packages/store/src/store.ts:3329](../../packages/store/src/store.ts#L3329) `Store/setAiAllowed` | `SQLite.prepare` (3329); `Store.sql` (3329) | CORE |
| [packages/store/src/store.ts:3375](../../packages/store/src/store.ts#L3375) `Store/setAiPolicy` | `SQLite.prepare` (3375); `Store.sql` (3375) | CORE |
| [packages/store/src/store.ts:3344](../../packages/store/src/store.ts#L3344) `Store/setScriptNetwork` | `SQLite.prepare` (3344); `Store.sql` (3344) | CORE |
| [packages/store/src/store.ts:3364](../../packages/store/src/store.ts#L3364) `Store/setWebViewerHosts` | `SQLite.prepare` (3364); `Store.sql` (3364) | CORE |
| [packages/store/src/store.ts:3395](../../packages/store/src/store.ts#L3395) `Store/setPiiIsolation` | `SQLite.prepare` (3395); `Store.sql` (3395) | CORE |
| [packages/store/src/store.ts:3417](../../packages/store/src/store.ts#L3417) `Store/markPiiField` | `SQLite.prepare` (3417); `Store.sql` (3417) | CORE |
| [packages/store/src/store.ts:3531](../../packages/store/src/store.ts#L3531) `Store/lastSignIns` | `Store.auditLog` (3531) | CORE |
| [packages/store/src/store.ts:3734](../../packages/store/src/store.ts#L3734) `Store/unusualAccess` | `Store.auditLog` (3734, 3800) | CORE |
| [packages/store/src/store.ts:3831](../../packages/store/src/store.ts#L3831) `Store/leastPrivilege` | `SQLite.all` (3831); `SQLite.prepare` (3831); `Store.sql` (3831) | CORE |
| [packages/store/src/store.ts:3904](../../packages/store/src/store.ts#L3904) `Store/unusedAccess` | `SQLite.get` (3904); `SQLite.prepare` (3904, 3913); `Store.sql` (3904, 3913); `SQLite.all` (3913) | CORE |
| [packages/store/src/store.ts:3952](../../packages/store/src/store.ts#L3952) `Store/unusedObjects` | `SQLite.get` (3952); `SQLite.prepare` (3952, 3955); `Store.sql` (3952, 3955); `SQLite.all` (3955) | CORE |
| [packages/store/src/store.ts:3990](../../packages/store/src/store.ts#L3990) `Store/usageCounting` | `SQLite.get` (3990); `SQLite.prepare` (3990); `Store.sql` (3990) | CORE |
| [packages/store/src/store.ts:3998](../../packages/store/src/store.ts#L3998) `Store/setMustChangePassword` | `SQLite.prepare` (3998); `Store.sql` (3998) | CORE |
| [packages/store/src/store.ts:4012](../../packages/store/src/store.ts#L4012) `Store/mustChangePassword` | `SQLite.get` (4012); `SQLite.prepare` (4012); `Store.sql` (4012) | CORE |
| [packages/store/src/store.ts:4051](../../packages/store/src/store.ts#L4051) `Store/passwordDaysRemaining` | `SQLite.get` (4051); `SQLite.prepare` (4051); `Store.sql` (4051) | CORE |
| [packages/store/src/store.ts:4058](../../packages/store/src/store.ts#L4058) `Store/importAccounts` | `SQLite.all` (4058); `SQLite.prepare` (4058); `Store.sql` (4058) | CORE |
| [packages/store/src/store.ts:4081](../../packages/store/src/store.ts#L4081) `Store/canonicalAccount` | `SQLite.all` (4081); `SQLite.prepare` (4081); `Store.sql` (4081) | CORE |
| [packages/store/src/store.ts:4093](../../packages/store/src/store.ts#L4093) `Store/createLocalAccount` | `SQLite.prepare` (4093); `Store.sql` (4093) | CORE |
| [packages/store/src/store.ts:4123](../../packages/store/src/store.ts#L4123) `Store/previewAccountImport` | `Store.sql` (4123, 4124, 4133) | CORE |
| [packages/store/src/store.ts:4141](../../packages/store/src/store.ts#L4141) `Store/limitAccountImport` | `SQLite.prepare` (4141, 4142, 4145); `Store.sql` (4141, 4142, 4145); `SQLite.get` (4142) | CORE |
| [packages/store/src/store.ts:4152](../../packages/store/src/store.ts#L4152) `Store/applyAccountImport` | `Store.sql` (4152, 4160, 4189); `SQLite.get` (4160); `SQLite.prepare` (4160, 4189) | CORE |
| [packages/store/src/store.ts:4214](../../packages/store/src/store.ts#L4214) `Store/forgetStandIns` | `SQLite.prepare` (4214); `Store.sql` (4214) | CORE |
| [packages/store/src/store.ts:4247](../../packages/store/src/store.ts#L4247) `Store/deleteAccount` | `SQLite.prepare` (4247, 4248, 4249, 4251, 4255); `Store.sql` (4247, 4248, 4249, 4251, 4255) | CORE |
| [packages/store/src/store.ts:4272](../../packages/store/src/store.ts#L4272) `Store/setAccountActive` | `SQLite.prepare` (4272, 4275, 4276); `Store.sql` (4272, 4275, 4276) | AUTH |
| [packages/store/src/store.ts:4286](../../packages/store/src/store.ts#L4286) `Store/accountInactive` | `SQLite.get` (4286); `SQLite.prepare` (4286); `Store.sql` (4286) | CORE |
| [packages/store/src/store.ts:4291](../../packages/store/src/store.ts#L4291) `Store/identityAllowed` | `SQLite.get` (4291, 4297, 4303); `SQLite.prepare` (4291, 4297, 4303); `Store.sql` (4291, 4297, 4303) | CORE |
| [packages/store/src/store.ts:4311](../../packages/store/src/store.ts#L4311) `Store/externalIdentityId` | `SQLite.get` (4311, 4317); `SQLite.prepare` (4311, 4316, 4317); `Store.sql` (4311, 4316, 4317) | CORE |
| [packages/store/src/store.ts:4322](../../packages/store/src/store.ts#L4322) `Store/accountIdentityId` | `SQLite.get` (4322, 4327); `SQLite.prepare` (4322, 4326, 4327); `Store.sql` (4322, 4326, 4327) | CORE |
| [packages/store/src/store.ts:4350](../../packages/store/src/store.ts#L4350) `Store/signInMark` | `SQLite.prepare` (4350); `Store.sql` (4350) | AUTH |
| [packages/store/src/store.ts:4360](../../packages/store/src/store.ts#L4360) `Store/signInBase` | `SQLite.get` (4360); `SQLite.prepare` (4360); `Store.sql` (4360) | AUTH |
| [packages/store/src/store.ts:4362](../../packages/store/src/store.ts#L4362) `Store/signInBase/identity` | `SQLite.get` (4362); `SQLite.prepare` (4362); `Store.sql` (4362) | AUTH |
| [packages/store/src/store.ts:4374](../../packages/store/src/store.ts#L4374) `Store/ledgerRow` | `SQLite.get` (4374, 4375); `SQLite.prepare` (4374, 4375); `Store.sql` (4374, 4375) | AUTH |
| [packages/store/src/store.ts:4386](../../packages/store/src/store.ts#L4386) `Store/ledgerWrite` | `Store.sql` (4386, 4387, 4389, 4391, 4394, 4394) | AUTH |
| [packages/store/src/store.ts:4413](../../packages/store/src/store.ts#L4413) `Store/settleSignIns` | `SQLite.all` (4413, 4419); `SQLite.prepare` (4413, 4419, 4425, 4429, 4431); `Store.sql` (4413, 4419, 4425, 4429, 4431) | AUTH |
| [packages/store/src/store.ts:4442](../../packages/store/src/store.ts#L4442) `Store/securityToken` | `SQLite.get` (4442); `SQLite.prepare` (4442); `Store.sql` (4442) | CORE |
| [packages/store/src/store.ts:4450](../../packages/store/src/store.ts#L4450) `Store/accountLocalOnly` | `SQLite.get` (4450); `SQLite.prepare` (4450); `Store.sql` (4450) | CORE |
| [packages/store/src/store.ts:4455](../../packages/store/src/store.ts#L4455) `Store/accountRequires2fa` | `SQLite.get` (4455); `SQLite.prepare` (4455); `Store.sql` (4455) | CORE |
| [packages/store/src/store.ts:4461](../../packages/store/src/store.ts#L4461) `Store/setAccountLocalOnly` | `SQLite.prepare` (4461); `Store.sql` (4461) | CORE |
| [packages/store/src/store.ts:4470](../../packages/store/src/store.ts#L4470) `Store/setAccountRequire2fa` | `SQLite.prepare` (4470); `Store.sql` (4470) | CORE |
| [packages/store/src/store.ts:4499](../../packages/store/src/store.ts#L4499) `Store/createApiToken` | `SQLite.get` (4499); `SQLite.prepare` (4499, 4529); `Store.sql` (4499, 4529) | CORE |
| [packages/store/src/store.ts:4576](../../packages/store/src/store.ts#L4576) `Store/recordObjectUse` | `Store.sql` (4576) | CORE |
| [packages/store/src/store.ts:4606](../../packages/store/src/store.ts#L4606) `Store/writeUsage` | `Store.sql` (4606, 4607, 4609, 4613, 4615) | CORE |
| [packages/store/src/store.ts:4622](../../packages/store/src/store.ts#L4622) `Store/writeUsageRows` | `SQLite.prepare` (4622, 4623, 4629); `Store.sql` (4622, 4623, 4629) | CORE |
| [packages/store/src/store.ts:4634](../../packages/store/src/store.ts#L4634) `Store/writeObjectUseRows` | `SQLite.prepare` (4634, 4635, 4640); `Store.sql` (4634, 4635, 4640) | CORE |
| [packages/store/src/store.ts:4645](../../packages/store/src/store.ts#L4645) `Store/objectUseSince` | `SQLite.get` (4645); `SQLite.prepare` (4645); `Store.sql` (4645) | CORE |
| [packages/store/src/store.ts:4658](../../packages/store/src/store.ts#L4658) `Store/accountUsage` | `SQLite.get` (4658); `SQLite.prepare` (4658, 4659); `Store.sql` (4658, 4659); `SQLite.all` (4659); `Store.auditLog` (4675) | CORE |
| [packages/store/src/store.ts:4691](../../packages/store/src/store.ts#L4691) `Store/apiTokens` | `SQLite.all` (4691); `SQLite.prepare` (4691); `Store.sql` (4691) | CORE |
| [packages/store/src/store.ts:4701](../../packages/store/src/store.ts#L4701) `Store/revokeApiToken` | `SQLite.prepare` (4701); `Store.sql` (4701) | CORE |
| [packages/store/src/store.ts:4715](../../packages/store/src/store.ts#L4715) `Store/apiToken` | `SQLite.get` (4715); `SQLite.prepare` (4715, 4727); `Store.sql` (4715, 4727) | CORE |
| [packages/store/src/store.ts:4743](../../packages/store/src/store.ts#L4743) `Store/enrollTotp` | `SQLite.prepare` (4743); `Store.sql` (4743) | CORE |
| [packages/store/src/store.ts:4754](../../packages/store/src/store.ts#L4754) `Store/confirmTotp` | `SQLite.get` (4754); `SQLite.prepare` (4754, 4756); `Store.sql` (4754, 4756) | CORE |
| [packages/store/src/store.ts:4764](../../packages/store/src/store.ts#L4764) `Store/hasTotp` | `SQLite.get` (4764); `SQLite.prepare` (4764); `Store.sql` (4764) | CORE |
| [packages/store/src/store.ts:4769](../../packages/store/src/store.ts#L4769) `Store/totpAccounts` | `SQLite.all` (4769); `SQLite.prepare` (4769); `Store.sql` (4769) | CORE |
| [packages/store/src/store.ts:4775](../../packages/store/src/store.ts#L4775) `Store/disableTotp` | `SQLite.prepare` (4775); `Store.sql` (4775) | CORE |
| [packages/store/src/store.ts:4798](../../packages/store/src/store.ts#L4798) `Store/verifyTotp` | `SQLite.get` (4798); `SQLite.prepare` (4798, 4804); `Store.sql` (4798, 4804) | CORE |
| [packages/store/src/store.ts:4817](../../packages/store/src/store.ts#L4817) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4817, 4819, 4820, 4822); `Store.sql` (4817, 4819, 4820, 4822); `SQLite.get` (4819) | CORE |
| [packages/store/src/store.ts:4869](../../packages/store/src/store.ts#L4869) `Store/passkeyAllowList` | `SQLite.all` (4869); `SQLite.prepare` (4869); `Store.sql` (4869) | CORE |
| [packages/store/src/store.ts:4883](../../packages/store/src/store.ts#L4883) `Store/takeWebauthnChallenge` | `SQLite.get` (4883); `SQLite.prepare` (4883, 4885); `Store.sql` (4883, 4885) | CORE |
| [packages/store/src/store.ts:4893](../../packages/store/src/store.ts#L4893) `Store/passkeys` | `SQLite.all` (4893); `SQLite.prepare` (4893); `Store.sql` (4893) | CORE |
| [packages/store/src/store.ts:4900](../../packages/store/src/store.ts#L4900) `Store/hasPasskey` | `SQLite.get` (4900); `SQLite.prepare` (4900); `Store.sql` (4900) | CORE |
| [packages/store/src/store.ts:4905](../../packages/store/src/store.ts#L4905) `Store/passkeyIds` | `SQLite.all` (4905); `SQLite.prepare` (4905); `Store.sql` (4905) | CORE |
| [packages/store/src/store.ts:4927](../../packages/store/src/store.ts#L4927) `Store/registerPasskey` | `SQLite.prepare` (4927); `Store.sql` (4927) | CORE |
| [packages/store/src/store.ts:4938](../../packages/store/src/store.ts#L4938) `Store/removePasskey` | `SQLite.get` (4938); `SQLite.prepare` (4938, 4939); `Store.sql` (4938, 4939) | CORE |
| [packages/store/src/store.ts:4955](../../packages/store/src/store.ts#L4955) `Store/verifyPasskeyAssertion` | `SQLite.get` (4955); `SQLite.prepare` (4955, 4966); `Store.sql` (4955, 4966) | CORE |
| [packages/store/src/store.ts:5002](../../packages/store/src/store.ts#L5002) `Store/generateRecoveryCodes` | `SQLite.prepare` (5002, 5005); `Store.sql` (5002, 5005) | CORE |
| [packages/store/src/store.ts:5020](../../packages/store/src/store.ts#L5020) `Store/recoveryCodesRemaining` | `SQLite.get` (5020); `SQLite.prepare` (5020); `Store.sql` (5020) | CORE |
| [packages/store/src/store.ts:5030](../../packages/store/src/store.ts#L5030) `Store/useRecoveryCode` | `SQLite.get` (5030); `SQLite.prepare` (5030, 5032); `Store.sql` (5030, 5032) | CORE |
| [packages/store/src/store.ts:5043](../../packages/store/src/store.ts#L5043) `Store/privilegeSets` | `Store.sql` (5043) | CORE |
| [packages/store/src/store.ts:5072](../../packages/store/src/store.ts#L5072) `Store/savePrivilegeSet` | `SQLite.prepare` (5072, 5080); `Store.sql` (5072, 5080) | AUTH |
| [packages/store/src/store.ts:5115](../../packages/store/src/store.ts#L5115) `Store/deletePrivilegeSet` | `SQLite.prepare` (5115); `Store.sql` (5115) | CORE |
| [packages/store/src/store.ts:5184](../../packages/store/src/store.ts#L5184) `Store/accountPrivilegeSet` | `SQLite.get` (5184); `SQLite.prepare` (5184); `Store.sql` (5184) | CORE |
| [packages/store/src/store.ts:5198](../../packages/store/src/store.ts#L5198) `Store/setAccountPrivilegeSet` | `SQLite.get` (5198); `SQLite.prepare` (5198, 5201, 5205); `Store.sql` (5198, 5201, 5205) | AUTH |
| [packages/store/src/store.ts:5220](../../packages/store/src/store.ts#L5220) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5220); `Store.sql` (5220) | CORE |
| [packages/store/src/store.ts:5234](../../packages/store/src/store.ts#L5234) `Store/addProvisionedAccount` | `SQLite.get` (5234); `SQLite.prepare` (5234, 5238); `Store.sql` (5234, 5238) | CORE |
| [packages/store/src/store.ts:5407](../../packages/store/src/store.ts#L5407) `Store/ruleOutcome` | `Calculations.context` (5407) | CORE |
| [packages/store/src/store.ts:5448](../../packages/store/src/store.ts#L5448) `Store/allowedIds` | `SQLite.iterate` (5448); `SQLite.prepare` (5448); `Store.sql` (5448) | CORE |
| [packages/store/src/store.ts:5518](../../packages/store/src/store.ts#L5518) `Store/scopedTableSql` | `Store.viewableIds` (5518); `SQLite.all` (5521); `SQLite.prepare` (5521); `Store.sql` (5521) | GATED-STORE |
| [packages/store/src/store.ts:5553](../../packages/store/src/store.ts#L5553) `Store/previewRecordRuleCurrent` | `SQLite.get` (5553); `SQLite.prepare` (5553, 5556); `Store.sql` (5553, 5556); `SQLite.all` (5556); `Calculations.context` (5562, 5578) | CORE |
| [packages/store/src/store.ts:5730](../../packages/store/src/store.ts#L5730) `Store/passwordHash` | `SQLite.get` (5730); `SQLite.prepare` (5730); `Store.sql` (5730) | CORE |
| [packages/store/src/store.ts:5759](../../packages/store/src/store.ts#L5759) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5759); `Store.sql` (5759) | CORE |
| [packages/store/src/store.ts:5772](../../packages/store/src/store.ts#L5772) `Store/knownSharedAccount` | `SQLite.get` (5772); `SQLite.prepare` (5772); `Store.sql` (5772) | CORE |
| [packages/store/src/store.ts:5835](../../packages/store/src/store.ts#L5835) `Store/layouts` | `SQLite.all` (5835); `SQLite.prepare` (5835); `Store.sql` (5835) | CORE |
| [packages/store/src/store.ts:5856](../../packages/store/src/store.ts#L5856) `Store/image` | `SQLite.get` (5856); `SQLite.prepare` (5856); `Store.sql` (5856) | CORE |
| [packages/store/src/store.ts:5866](../../packages/store/src/store.ts#L5866) `Store/images` | `SQLite.all` (5866); `SQLite.prepare` (5866); `Store.sql` (5866) | CORE |
| [packages/store/src/store.ts:5879](../../packages/store/src/store.ts#L5879) `Store/addImage` | `Store.sql` (5879, 5880); `SQLite.prepare` (5880) | CORE |
| [packages/store/src/store.ts:5896](../../packages/store/src/store.ts#L5896) `Store/layout` | `SQLite.get` (5896); `SQLite.prepare` (5896); `Store.sql` (5896) | CORE |
| [packages/store/src/store.ts:6100](../../packages/store/src/store.ts#L6100) `Store/wordIndex` | `Store.sql` (6100, 6108, 6113); `Store.recordCount` (6112); `SQLite.get` (6113); `SQLite.prepare` (6113) | CORE |
| [packages/store/src/store.ts:6165](../../packages/store/src/store.ts#L6165) `Store/toRecord` | `Calculations.value` (6165, 6175); `Calculations.globalValue` (6169); `Calculations.unstoredStyled` (6174) | CORE |
| [packages/store/src/store.ts:6224](../../packages/store/src/store.ts#L6224) `Store/relatedValues` | `Calculations.globalValue` (6224); `Calculations.unstoredValue` (6226) | CORE |
| [packages/store/src/store.ts:6298](../../packages/store/src/store.ts#L6298) `Store/addRelated` | `relatedRows` (6298); `rowsById` (6330); `firstRelatedEach` (6353) | CORE |
| [packages/store/src/store.ts:6381](../../packages/store/src/store.ts#L6381) `Store/foundSetPage` | `rowsById` (6381) | CORE |
| [packages/store/src/store.ts:6397](../../packages/store/src/store.ts#L6397) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6397); `Store.row` (6413) | GATED-STORE |
| [packages/store/src/store.ts:6436](../../packages/store/src/store.ts#L6436) `Store/portalCountsCurrent` | `Store.canView` (6436); `Store.row` (6463) | GATED-STORE |
| [packages/store/src/store.ts:6499](../../packages/store/src/store.ts#L6499) `Store/fieldIndexCurrent` | `SQLite.iterate` (6499); `SQLite.prepare` (6499, 6504); `Store.sql` (6499, 6504); `SQLite.all` (6504) | GATED-STORE |
| [packages/store/src/store.ts:6545](../../packages/store/src/store.ts#L6545) `Store/valueListItemsCurrent` | `Store.valueListItems` (6545); `Store.get` (6559); `relatedRows` (6560); `Store.row` (6560); `SQLite.iterate` (6562); `SQLite.prepare` (6562); `Store.sql` (6562); `Calculations.related` (6572); `Calculations.value` (6576, 6577) | GATED-STORE |
| [packages/store/src/store.ts:6674](../../packages/store/src/store.ts#L6674) `Store/portalRows` | `relatedRows` (6674); `relatedIdList` (6675); `Store.viewableIds` (6678); `rowsById` (6703, 6741); `Calculations.related` (6717) | CORE |
| [packages/store/src/store.ts:6685](../../packages/store/src/store.ts#L6685) `Store/portalRows/context` | `Calculations.context` (6685) | CORE |
| [packages/store/src/store.ts:6695](../../packages/store/src/store.ts#L6695) `Store/portalRows/valueOf` | `Calculations.value` (6695) | CORE |
| [packages/store/src/store.ts:6812](../../packages/store/src/store.ts#L6812) `Store/markRepeating` | `SQLite.prepare` (6812); `Store.sql` (6812) | CORE |
| [packages/store/src/store.ts:6839](../../packages/store/src/store.ts#L6839) `Store/externalContainerCheck` | `SQLite.all` (6839); `SQLite.prepare` (6839); `Store.sql` (6839) | CORE |
| [packages/store/src/store.ts:6846](../../packages/store/src/store.ts#L6846) `Store/externalContainerCount` | `SQLite.get` (6846); `SQLite.prepare` (6846); `Store.sql` (6846) | CORE |
| [packages/store/src/store.ts:6855](../../packages/store/src/store.ts#L6855) `Store/externalContainerReport` | `SQLite.all` (6855, 6868); `SQLite.prepare` (6855, 6868); `Store.sql` (6855, 6868) | CORE |
| [packages/store/src/store.ts:7003](../../packages/store/src/store.ts#L7003) `Store/orphanContainerReport` | `SQLite.all` (7003); `SQLite.prepare` (7003); `Store.sql` (7003) | CORE |
| [packages/store/src/store.ts:7038](../../packages/store/src/store.ts#L7038) `Store/purgeOrphanContainers` | `Store.sql` (7038, 7042, 7051, 7054, 7055, 7060, 7061, 7063, 7063); `Store.orphanContainerReport` (7046); `SQLite.get` (7051); `SQLite.prepare` (7051, 7054, 7055) | CORE |
| [packages/store/src/store.ts:7076](../../packages/store/src/store.ts#L7076) `Store/containerIntact` | `SQLite.get` (7076); `SQLite.prepare` (7076); `Store.sql` (7076) | CORE |
| [packages/store/src/store.ts:7086](../../packages/store/src/store.ts#L7086) `Store/externalOf` | `SQLite.get` (7086); `SQLite.prepare` (7086); `Store.sql` (7086) | CORE |
| [packages/store/src/store.ts:7090](../../packages/store/src/store.ts#L7090) `Store/containerMeta` | `SQLite.get` (7090); `SQLite.prepare` (7090); `Store.sql` (7090) | CORE |
| [packages/store/src/store.ts:7095](../../packages/store/src/store.ts#L7095) `Store/container` | `SQLite.get` (7095); `SQLite.prepare` (7095, 7104); `Store.sql` (7095, 7104); `SQLite.all` (7104) | CORE |
| [packages/store/src/store.ts:7112](../../packages/store/src/store.ts#L7112) `Store/containerInfo` | `SQLite.get` (7112); `SQLite.prepare` (7112); `Store.sql` (7112) | CORE |
| [packages/store/src/store.ts:7146](../../packages/store/src/store.ts#L7146) `Store/containerRange` | `SQLite.all` (7146); `SQLite.prepare` (7146, 7153); `Store.sql` (7146, 7153); `SQLite.get` (7153) | CORE |
| [packages/store/src/store.ts:7171](../../packages/store/src/store.ts#L7171) `Store/addContainer` | `SQLite.all` (7171); `SQLite.prepare` (7171, 7176, 7190, 7194, 7195); `Store.sql` (7171, 7176, 7190, 7192, 7194, 7195, 7197, 7200); `SQLite.get` (7181); `Store.containerRange` (7183) | CORE |
| [packages/store/src/store.ts:7217](../../packages/store/src/store.ts#L7217) `Store/addExternalContainer` | `SQLite.prepare` (7217); `Store.sql` (7217) | CORE |
| [packages/store/src/store.ts:7235](../../packages/store/src/store.ts#L7235) `Store/writeExternalFile` | `Store.evaluateEach` (7235); `SQLite.prepare` (7258); `Store.sql` (7258) | CORE |
| [packages/store/src/store.ts:7259](../../packages/store/src/store.ts#L7259) `Store/writeExternalFile/taken` | `SQLite.get` (7259) | CORE |
| [packages/store/src/store.ts:7289](../../packages/store/src/store.ts#L7289) `Store/embeddedContainers` | `SQLite.prepare` (7289, 7290); `Store.sql` (7289, 7290); `SQLite.all` (7290); `SQLite.get` (7294) | CORE |
| [packages/store/src/store.ts:7303](../../packages/store/src/store.ts#L7303) `Store/embeddedContainerCount` | `SQLite.prepare` (7303); `Store.sql` (7303); `SQLite.get` (7304) | CORE |
| [packages/store/src/store.ts:7312](../../packages/store/src/store.ts#L7312) `Store/recoverContainersOut` | `SQLite.prepare` (7312); `Store.sql` (7312); `SQLite.get` (7315) | CORE |
| [packages/store/src/store.ts:7337](../../packages/store/src/store.ts#L7337) `Store/moveContainersOut` | `Store.sql` (7337, 7345, 7347, 7349, 7351, 7352, 7371, 7376, 7378, 7380, 7381, 7385); `SQLite.get` (7345); `SQLite.prepare` (7345, 7351, 7352); `Store.container` (7354) | CORE |
| [packages/store/src/store.ts:7394](../../packages/store/src/store.ts#L7394) `Store/moveContainersIn` | `Store.sql` (7394, 7399, 7401, 7402, 7403, 7404, 7423, 7426, 7433, 7436, 7439, 7446); `SQLite.prepare` (7401, 7402, 7403, 7404, 7433, 7439); `SQLite.get` (7406, 7433, 7439) | CORE |
| [packages/store/src/store.ts:7458](../../packages/store/src/store.ts#L7458) `Store/compactFile` | `Store.sql` (7458, 7459, 7460) | CORE |
| [packages/store/src/store.ts:7466](../../packages/store/src/store.ts#L7466) `Store/containerId` | `Store.containerId` (7466); `Store.row` (7467) | CORE |
| [packages/store/src/store.ts:7489](../../packages/store/src/store.ts#L7489) `Store/checkContainerWrite` | `Store.row` (7489) | CORE |
| [packages/store/src/store.ts:7502](../../packages/store/src/store.ts#L7502) `Store/setContainer` | `Store.sql` (7502, 7516, 7521, 7524, 7524); `Store.row` (7505); `SQLite.prepare` (7516) | CORE |
| [packages/store/src/store.ts:7558](../../packages/store/src/store.ts#L7558) `Store/orderBy` | `Store.valueListItems` (7558) | CORE |
| [packages/store/src/store.ts:7581](../../packages/store/src/store.ts#L7581) `Store/userPrefs` | `SQLite.all` (7581); `SQLite.prepare` (7581); `Store.sql` (7581) | CORE |
| [packages/store/src/store.ts:7586](../../packages/store/src/store.ts#L7586) `Store/hasTable` | `SQLite.get` (7586); `SQLite.prepare` (7586); `Store.sql` (7586) | CORE |
| [packages/store/src/store.ts:7590](../../packages/store/src/store.ts#L7590) `Store/setUserPref` | `Store.sql` (7590, 7591, 7592); `SQLite.prepare` (7591, 7592) | CORE |
| [packages/store/src/store.ts:7598](../../packages/store/src/store.ts#L7598) `Store/indexedFields` | `SQLite.all` (7598, 7599); `SQLite.prepare` (7598, 7599); `Store.sql` (7598, 7599) | CORE |
| [packages/store/src/store.ts:7620](../../packages/store/src/store.ts#L7620) `Store/addFieldIndex` | `Store.sql` (7620) | CORE |
| [packages/store/src/store.ts:7632](../../packages/store/src/store.ts#L7632) `Store/dropFieldIndex` | `SQLite.get` (7632); `SQLite.prepare` (7632); `Store.sql` (7632, 7633) | CORE |
| [packages/store/src/store.ts:7643](../../packages/store/src/store.ts#L7643) `Store/timeFind` | `Store.query` (7643, 7647, 7648); `Store.recordCount` (7650) | CORE |
| [packages/store/src/store.ts:7667](../../packages/store/src/store.ts#L7667) `Store/find` | `Store.find` (7667) | GATED-STORE |
| [packages/store/src/store.ts:7678](../../packages/store/src/store.ts#L7678) `Store/findHere` | `Store.query` (7678, 7683, 7685, 7699, 7701, 7711); `Store.recordCount` (7696); `SQLite.get` (7697, 7701); `SQLite.prepare` (7697, 7701, 7706, 7713, 7722); `Store.sql` (7697, 7701, 7706, 7713, 7722); `SQLite.all` (7706, 7713, 7722) | GATED-STORE |
| [packages/store/src/store.ts:7717](../../packages/store/src/store.ts#L7717) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7717); `SQLite.prepare` (7717); `Store.sql` (7717) | GATED-STORE |
| [packages/store/src/store.ts:7750](../../packages/store/src/store.ts#L7750) `Store/sortedPage` | `SQLite.iterate` (7750); `SQLite.prepare` (7750, 7765); `Store.sql` (7750, 7765); `SQLite.all` (7765) | CORE |
| [packages/store/src/store.ts:7822](../../packages/store/src/store.ts#L7822) `Store/relatedCriteria/matched` | `relatedRows` (7822) | CORE |
| [packages/store/src/store.ts:7825](../../packages/store/src/store.ts#L7825) `Store/relatedCriteria` | `SQLite.iterate` (7825); `SQLite.prepare` (7825); `Store.sql` (7825) | CORE |
| [packages/store/src/store.ts:7851](../../packages/store/src/store.ts#L7851) `Store/computedRows` | `Store.sql` (7851, 7854, 7855, 7856, 7858, 7868, 7869, 7870, 7873); `SQLite.prepare` (7854, 7856, 7858, 7868); `SQLite.iterate` (7858); `Calculations.globalValue` (7861); `Calculations.unstoredValue` (7862); `Calculations.related` (7865); `SQLite.all` (7868) | CORE |
| [packages/store/src/store.ts:7898](../../packages/store/src/store.ts#L7898) `Store/summaries` | `Calculations.wholeTable` (7898); `Calculations.collect` (7918, 7923) | CORE |
| [packages/store/src/store.ts:7914](../../packages/store/src/store.ts#L7914) `Store/summaries/recs` | `SQLite.iterate` (7914); `SQLite.prepare` (7914); `Store.sql` (7914) | CORE |
| [packages/store/src/store.ts:7936](../../packages/store/src/store.ts#L7936) `Store/runningSummaryValues` | `Store.viewableIds` (7936); `rowsById` (7938); `Calculations.value` (7949, 7955); `Calculations.related` (7966) | GATED-STORE |
| [packages/store/src/store.ts:7982](../../packages/store/src/store.ts#L7982) `Store/findSource` | `Store.query` (7982); `SQLite.all` (7991, 8008); `SQLite.prepare` (7991, 7999, 8007); `Store.sql` (7991, 7996, 7999, 8004, 8007, 8021, 8023); `Calculations.globalValue` (8013); `Calculations.unstoredValue` (8014); `Calculations.related` (8018) | CORE |
| [packages/store/src/store.ts:8038](../../packages/store/src/store.ts#L8038) `Store/findCandidates` | `Store.query` (8038) | CORE |
| [packages/store/src/store.ts:8073](../../packages/store/src/store.ts#L8073) `Store/previewRow` | `Store.row` (8073) | CORE |
| [packages/store/src/store.ts:8091](../../packages/store/src/store.ts#L8091) `Store/row` | `SQLite.get` (8091) | CORE |
| [packages/store/src/store.ts:8110](../../packages/store/src/store.ts#L8110) `Store/getCurrent` | `Store.get` (8110); `Store.row` (8111, 8111, 8125); `SQLite.all` (8128); `SQLite.prepare` (8128); `Store.sql` (8128) | GATED-STORE |
| [packages/store/src/store.ts:8148](../../packages/store/src/store.ts#L8148) `Store/getManyCurrent` | `Store.getMany` (8148); `SQLite.get` (8166); `SQLite.prepare` (8166); `Store.sql` (8166) | GATED-STORE |
| [packages/store/src/store.ts:8159](../../packages/store/src/store.ts#L8159) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8159) | GATED-STORE |
| [packages/store/src/store.ts:8182](../../packages/store/src/store.ts#L8182) `Store/canViewRecord` | `SQLite.get` (8182); `SQLite.prepare` (8182); `Store.sql` (8182) | GATED-STORE |
| [packages/store/src/store.ts:8190](../../packages/store/src/store.ts#L8190) `Store/canView` | `Store.canView` (8190); `Store.row` (8191) | GATED-STORE |
| [packages/store/src/store.ts:8215](../../packages/store/src/store.ts#L8215) `Store/create` | `SQLite.get` (8215, 8221); `SQLite.prepare` (8215, 8221, 8234); `Store.sql` (8215, 8221, 8234) | CORE |
| [packages/store/src/store.ts:8258](../../packages/store/src/store.ts#L8258) `Store/duplicate` | `Store.row` (8258); `SQLite.get` (8262); `SQLite.prepare` (8262, 8277); `Store.sql` (8262, 8277) | CORE |
| [packages/store/src/store.ts:8322](../../packages/store/src/store.ts#L8322) `Store/update` | `Store.row` (8322, 8329, 8340); `Store.sql` (8353, 8354, 8393, 8396) | CORE |
| [packages/store/src/store.ts:8356](../../packages/store/src/store.ts#L8356) `Store/update/undo` | `Store.sql` (8356) | CORE |
| [packages/store/src/store.ts:8500](../../packages/store/src/store.ts#L8500) `Store/setStoredCalcValues` | `SQLite.prepare` (8500, 8501); `Store.sql` (8500, 8501); `SQLite.get` (8505) | CORE |
| [packages/store/src/store.ts:8579](../../packages/store/src/store.ts#L8579) `Store/evaluateCurrent` | `Store.row` (8579, 8579); `Calculations.context` (8580); `Store.get` (8581, 8583) | GATED-STORE |
| [packages/store/src/store.ts:8615](../../packages/store/src/store.ts#L8615) `Store/evaluateEachCurrent` | `Store.row` (8615, 8615); `Calculations.context` (8620); `Store.get` (8622) | GATED-STORE |
| [packages/store/src/store.ts:8655](../../packages/store/src/store.ts#L8655) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8655); `Store.get` (8657) | GATED-STORE |
| [packages/store/src/store.ts:8676](../../packages/store/src/store.ts#L8676) `Store/evaluateRowsCurrent` | `Store.row` (8676, 8676) | GATED-STORE |
| [packages/store/src/store.ts:8690](../../packages/store/src/store.ts#L8690) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8690) | GATED-STORE |
| [packages/store/src/store.ts:8712](../../packages/store/src/store.ts#L8712) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8712) | GATED-STORE |
| [packages/store/src/store.ts:8750](../../packages/store/src/store.ts#L8750) `Store/updateRelated` | `relatedRows` (8750) | CORE |
| [packages/store/src/store.ts:8768](../../packages/store/src/store.ts#L8768) `Store/updatePortals` | `Store.row` (8768, 8803); `relatedRows` (8804) | CORE |
| [packages/store/src/store.ts:8777](../../packages/store/src/store.ts#L8777) `Store/updatePortals/portal/related` | `relatedIdList` (8777) | CORE |
| [packages/store/src/store.ts:8859](../../packages/store/src/store.ts#L8859) `Store/portalContainerTarget` | `Store.row` (8859); `relatedIdList` (8860) | CORE |
| [packages/store/src/store.ts:8873](../../packages/store/src/store.ts#L8873) `Store/checkEditable` | `Store.row` (8873) | CORE |
| [packages/store/src/store.ts:8896](../../packages/store/src/store.ts#L8896) `Store/delete` | `Store.row` (8896) | CORE |
| [packages/store/src/store.ts:8904](../../packages/store/src/store.ts#L8904) `Store/delete/run` | `SQLite.get` (8904); `SQLite.prepare` (8904, 8908); `Store.sql` (8904, 8908) | CORE |
| [packages/store/src/store.ts:9130](../../packages/store/src/store.ts#L9130) `Store/keyStepWork` | `Store.sql` (9130, 9136, 9140, 9142) | CORE |
| [packages/store/src/store.ts:8933](../../packages/store/src/store.ts#L8933) `Store/vaultHeld` | `SQLite.get` (8933); `SQLite.prepare` (8933); `Store.sql` (8933) | CORE |
| [packages/store/src/store.ts:8940](../../packages/store/src/store.ts#L8940) `Store/forgetStandInValues` | `Store.sql` (8940, 8961); `SQLite.prepare` (8961) | CORE |
| [packages/store/src/store.ts:8980](../../packages/store/src/store.ts#L8980) `Store/restoreDeletedRowLocked` | `SQLite.get` (8980); `SQLite.prepare` (8980, 8981, 8985); `Store.sql` (8980, 8981, 8985); `SQLite.all` (8981) | CORE |
| [packages/store/src/store.ts:9183](../../packages/store/src/store.ts#L9183) `Store/cascadeDelete` | `relatedRows` (9183) | CORE |
| [packages/store/src/store.ts:9273](../../packages/store/src/store.ts#L9273) `Store/selectIdsCurrent` | `Store.selectIds` (9273); `SQLite.all` (9279); `SQLite.prepare` (9279); `Store.sql` (9279) | GATED-STORE |
| [packages/store/src/store.ts:9287](../../packages/store/src/store.ts#L9287) `Store/countIds` | `Store.countIds` (9287); `SQLite.get` (9291); `SQLite.prepare` (9291); `Store.sql` (9291) | GATED-STORE |
| [packages/store/src/store.ts:9307](../../packages/store/src/store.ts#L9307) `Store/computeValuesCurrent` | `Store.computeValues` (9307); `Store.sql` (9313, 9317); `SQLite.all` (9317); `SQLite.prepare` (9317) | GATED-STORE |
| [packages/store/src/store.ts:9332](../../packages/store/src/store.ts#L9332) `Store/findIdsCurrent` | `Store.findIds` (9332) | GATED-STORE |
| [packages/store/src/store.ts:9338](../../packages/store/src/store.ts#L9338) `Store/findIdsHere` | `Store.query` (9338, 9343, 9345); `SQLite.iterate` (9356); `SQLite.prepare` (9356); `Store.sql` (9356) | GATED-STORE |
| [packages/store/src/store.ts:9373](../../packages/store/src/store.ts#L9373) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9373); `Store.viewableIds` (9378); `Calculations.collect` (9394); `rowsById` (9394, 9444); `Calculations.collector` (9416) | GATED-STORE |
| [packages/store/src/store.ts:9406](../../packages/store/src/store.ts#L9406) `Store/groupSummariesCurrent/key` | `Calculations.value` (9406); `Calculations.related` (9408) | GATED-STORE |
| [packages/store/src/store.ts:9442](../../packages/store/src/store.ts#L9442) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9442) | GATED-STORE |
| [packages/store/src/store.ts:9498](../../packages/store/src/store.ts#L9498) `Store/sortIdsCurrentProgress` | `SQLite.all` (9498); `SQLite.prepare` (9498, 9566); `Store.sql` (9498, 9566); `Store.valueListItems` (9506); `rowsById` (9518); `Calculations.globalValue` (9521); `Calculations.unstoredValue` (9522); `Calculations.related` (9528); `SQLite.iterate` (9566) | GATED-STORE |
| [packages/store/src/store.ts:9580](../../packages/store/src/store.ts#L9580) `Store/matchIds` | `Store.matchIds` (9580); `SQLite.all` (9586); `SQLite.prepare` (9586); `Store.sql` (9586) | CORE |
| [packages/store/src/store.ts:9607](../../packages/store/src/store.ts#L9607) `Store/truncate/run` | `Store.sql` (9607, 9609, 9616, 9618, 9620, 9621); `SQLite.prepare` (9609, 9616); `SQLite.all` (9611) | CORE |
| [packages/store/src/store.ts:9645](../../packages/store/src/store.ts#L9645) `Store/iterateCommitted` | `SQLite.iterate` (9645) | CORE |
| [packages/store/src/store.ts:9679](../../packages/store/src/store.ts#L9679) `Store/readOnlyChecked` | `SQLite.prepare` (9679, 9683, 9692, 9697); `SQLite.all` (9683, 9692, 9697) | CORE |
| [packages/store/src/store.ts:9719](../../packages/store/src/store.ts#L9719) `Store/refreshDecimalSqlViews` | `SQLite.get` (9719); `SQLite.prepare` (9719, 9724); `SQLite.all` (9724) | CORE |
| [packages/store/src/store.ts:9738](../../packages/store/src/store.ts#L9738) `Store/internalRoots` | `SQLite.get` (9738); `SQLite.prepare` (9738, 9740); `SQLite.all` (9740) | CORE |
| [packages/store/src/store.ts:9773](../../packages/store/src/store.ts#L9773) `Store/selectCurrent` | `SQLite.iterate` (9773) | CORE |
| [packages/store/src/store.ts:9822](../../packages/store/src/store.ts#L9822) `Store/query` | `SQLite.iterate` (9822) | CORE |
| [packages/store/src/store.ts:9856](../../packages/store/src/store.ts#L9856) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9856); `SQLite.all` (9863, 9866); `SQLite.prepare` (9863, 9866) | CORE |
| [packages/store/src/store.ts:1186](../../packages/store/src/store.ts#L1186) `Store/ensureNativeIds` | `SQLite.all` (1186, 1198); `SQLite.prepare` (1186, 1189, 1197, 1198); `Store.sql` (1186, 1189, 1192, 1196, 1197, 1198, 1201, 1203) | CORE |
| [packages/store/src/store.ts:1211](../../packages/store/src/store.ts#L1211) `Store/nativeIdGuards` | `Store.sql` (1211, 1212, 1214) | CORE |
| [packages/store/src/store.ts:9789](../../packages/store/src/store.ts#L9789) `Store/selectIn` | `Store.select` (9789) | CORE |
| [packages/store/src/store.ts:9797](../../packages/store/src/store.ts#L9797) `Store/selectHeldCurrent` | `Store.sql` (9797, 9798); `SQLite.prepare` (9798); `SQLite.iterate` (9801) | CORE |
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
| [packages/store/src/store.ts:1544](../../packages/store/src/store.ts#L1544) `Store/selfContainedCopy` | `Store.sql` (1544); `SQLite.all` (1549); `SQLite.prepare` (1549, 1551, 1552, 1553) | CORE |
| [packages/store/src/store.ts:6918](../../packages/store/src/store.ts#L6918) `Store/containerReferences` | `SQLite.all` (6918, 6936, 6938, 6944, 6957, 6968, 6982); `SQLite.prepare` (6918, 6936, 6938, 6944, 6957, 6968, 6980, 6982); `Store.sql` (6918, 6936, 6938, 6944, 6957, 6968, 6980, 6982); `SQLite.get` (6980); `Store.row` (6991) | CORE |
| [packages/store/src/store.ts:7015](../../packages/store/src/store.ts#L7015) `Store/containerIntegrityReport` | `SQLite.all` (7015); `SQLite.prepare` (7015, 7026); `Store.sql` (7015, 7026); `SQLite.get` (7026) | CORE |
| [packages/server/src/compaction.ts:62](../../packages/server/src/compaction.ts#L62) `compactStore` | `SQLite.get` (62, 63, 76, 83); `SQLite.prepare` (62, 63, 76, 83) | OPERATOR |
<!-- end generated read-gate inventory -->
