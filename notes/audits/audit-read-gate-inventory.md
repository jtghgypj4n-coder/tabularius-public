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
| [packages/scripts/src/data-api-step.ts:104](../../packages/scripts/src/data-api-step.ts#L104) `respond` | `Store.get` (104, 131, 140); `Store.find` (105, 117) | SCRIPT |
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
| [packages/scripts/src/engine.ts:5635](../../packages/scripts/src/engine.ts#L5635) `ScriptEngine/valueOf` | `Store.findIds` (5635, 5635); `Store.containerId` (5643) | SCRIPT |
| [packages/scripts/src/engine.ts:5660](../../packages/scripts/src/engine.ts#L5660) `ScriptEngine/lookupNext` | `Store.get` (5660); `Store.row` (5661); `Calculations.context` (5663) | SCRIPT |
| [packages/scripts/src/engine.ts:5763](../../packages/scripts/src/engine.ts#L5763) `ScriptEngine/relatedIds` | `Store.findIds` (5763); `rowsById` (5771); `Store.select` (5775); `Store.matchIds` (5789); `Store.viewableIds` (5812) | SCRIPT |
| [packages/scripts/src/engine.ts:5797](../../packages/scripts/src/engine.ts#L5797) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5797) | SCRIPT |
| [packages/scripts/src/engine.ts:6286](../../packages/scripts/src/engine.ts#L6286) `ScriptEngine/exportField` | `Store.get` (6286); `Store.containerId` (6287); `Store.container` (6289) | SCRIPT |
| [packages/scripts/src/engine.ts:6437](../../packages/scripts/src/engine.ts#L6437) `ScriptEngine/relookup` | `Store.get` (6437) | SCRIPT |
| [packages/scripts/src/engine.ts:6857](../../packages/scripts/src/engine.ts#L6857) `ScriptEngine/goToList` | `Store.findIds` (6857) | SCRIPT |
| [packages/scripts/src/engine.ts:7186](../../packages/scripts/src/engine.ts#L7186) `ScriptEngine/sourceValue` | `Store.get` (7186); `Store.containerId` (7187); `Store.container` (7188) | SCRIPT |
| [packages/scripts/src/engine.ts:7921](../../packages/scripts/src/engine.ts#L7921) `ScriptEngine/containerFile` | `Store.get` (7921); `Store.containerId` (7922); `Store.container` (7923) | SCRIPT |
| [packages/scripts/src/engine.ts:8083](../../packages/scripts/src/engine.ts#L8083) `ScriptEngine/importRecords` | `Store.findIds` (8083); `Store.get` (8103) | SCRIPT |
| [packages/scripts/src/engine.ts:8314](../../packages/scripts/src/engine.ts#L8314) `ScriptEngine/fileMakerRows` | `Store.findIds` (8314); `Store.get` (8319) | SCRIPT |
| [packages/scripts/src/engine.ts:8354](../../packages/scripts/src/engine.ts#L8354) `ScriptEngine/newRecord` | `Store.findIds` (8354) | SCRIPT |
| [packages/scripts/src/engine.ts:8659](../../packages/scripts/src/engine.ts#L8659) `ScriptEngine/performFind` | `Store.findIds` (8659) | SCRIPT |
| [packages/scripts/src/engine.ts:8684](../../packages/scripts/src/engine.ts#L8684) `ScriptEngine/findRelated` | `Store.findIds` (8684, 8694, 8697) | SCRIPT |
| [packages/scripts/src/engine.ts:8716](../../packages/scripts/src/engine.ts#L8716) `ScriptEngine/quickFind` | `Store.findIds` (8716, 8717, 8720) | SCRIPT |
| [packages/scripts/src/engine.ts:9104](../../packages/scripts/src/engine.ts#L9104) `clearRecords` | `SQLite.all` (9104); `SQLite.prepare` (9104) | SCRIPT |
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
| [packages/store/src/stale-calcs.ts:201](../../packages/store/src/stale-calcs.ts#L201) `refreshStaleCalcs` | `Store.sql` (201, 206, 221, 223); `SQLite.iterate` (206); `SQLite.prepare` (206) | DESIGN |
| [packages/store/src/stale-calcs.ts:240](../../packages/store/src/stale-calcs.ts#L240) `undoStaleRefresh` | `Store.sql` (240, 247, 249) | DESIGN |
| [packages/store/src/stale-calcs.ts:264](../../packages/store/src/stale-calcs.ts#L264) `RefreshJournal/constructor` | `Store.sql` (264) | DESIGN |
| [packages/store/src/stale-calcs.ts:270](../../packages/store/src/stale-calcs.ts#L270) `RefreshJournal/add` | `SQLite.prepare` (270); `Store.sql` (270) | DESIGN |
| [packages/store/src/stale-calcs.ts:276](../../packages/store/src/stale-calcs.ts#L276) `RefreshJournal/get` | `SQLite.get` (276); `SQLite.prepare` (276); `Store.sql` (276) | DESIGN |
| [packages/store/src/stale-calcs.ts:281](../../packages/store/src/stale-calcs.ts#L281) `RefreshJournal/list` | `SQLite.all` (281); `SQLite.prepare` (281); `Store.sql` (281) | DESIGN |
| [packages/store/src/stale-calcs.ts:285](../../packages/store/src/stale-calcs.ts#L285) `RefreshJournal/markUndone` | `SQLite.prepare` (285); `Store.sql` (285) | DESIGN |
| [packages/store/src/store-format.ts:32](../../packages/store/src/store-format.ts#L32) `storedFormat` | `SQLite.get` (32); `SQLite.prepare` (32) | CORE |
| [packages/store/src/store-format.ts:50](../../packages/store/src/store-format.ts#L50) `checkFormat` | `SQLite.prepare` (50) | CORE |
| [packages/store/src/store.ts:889](../../packages/store/src/store.ts#L889) `Store/metadataVersions` | `SQLite.get` (889); `SQLite.prepare` (889); `Store.sql` (889) | CORE |
| [packages/store/src/store.ts:1027](../../packages/store/src/store.ts#L1027) `Store/constructor` | `Store.sql` (1027, 1029, 1031, 1032, 1036, 1040, 1041, 1052, 1057, 1062, 1063, 1067, 1068, 1069, 1076, 1080, 1084, 1085, 1086, 1091, 1095, 1098, 1099, 1101, 1102, 1105, 1106, 1110, 1111, 1115, 1116, 1119, 1121, 1124, 1125, 1129, 1130, 1134, 1135, 1138, 1139, 1140, 1143, 1144, 1147, 1148, 1150, 1150, 1151, 1151, 1152, 1155, 1159, 1161, 1164, 1165, 1166, 1169, 1170, 1172, 1174, 1175, 1179, 1180, 1182, 1186, 1187, 1188, 1188, 1192, 1193); `SQLite.get` (1031); `SQLite.prepare` (1031, 1098, 1099, 1102, 1105, 1110, 1115, 1124, 1129, 1134, 1143, 1147, 1150, 1151, 1169, 1174, 1179); `SQLite.all` (1098, 1105, 1110, 1115, 1124, 1129, 1134, 1143, 1147, 1150, 1151, 1169, 1174, 1179) | CORE |
| [packages/store/src/store.ts:1250](../../packages/store/src/store.ts#L1250) `Store/grantFullAccessClients` | `SQLite.prepare` (1250); `Store.sql` (1250) | CORE |
| [packages/store/src/store.ts:1273](../../packages/store/src/store.ts#L1273) `Store/meta` | `SQLite.get` (1273); `SQLite.prepare` (1273); `Store.sql` (1273) | CORE |
| [packages/store/src/store.ts:3408](../../packages/store/src/store.ts#L3408) `Store/webViewerChecked` | `SQLite.get` (3408); `SQLite.prepare` (3408); `Store.sql` (3408) | CORE |
| [packages/store/src/store.ts:1281](../../packages/store/src/store.ts#L1281) `Store/persistentTable` | `Store.sql` (1281) | CORE |
| [packages/store/src/store.ts:1291](../../packages/store/src/store.ts#L1291) `Store/persistentData` | `SQLite.get` (1291) | CORE |
| [packages/store/src/store.ts:1300](../../packages/store/src/store.ts#L1300) `Store/persistentDataIds` | `SQLite.all` (1300) | CORE |
| [packages/store/src/store.ts:1306](../../packages/store/src/store.ts#L1306) `Store/setPersistentData` | `SQLite.prepare` (1306, 1310); `Store.sql` (1306, 1310) | CORE |
| [packages/store/src/store.ts:1330](../../packages/store/src/store.ts#L1330) `Store/checkpoint` | `SQLite.get` (1330); `SQLite.prepare` (1330); `Store.sql` (1330) | CORE |
| [packages/store/src/store.ts:1338](../../packages/store/src/store.ts#L1338) `Store/recordedFormat` | `Store.sql` (1338) | CORE |
| [packages/store/src/store.ts:1348](../../packages/store/src/store.ts#L1348) `Store/close` | `Store.sql` (1348) | CORE |
| [packages/store/src/store.ts:1364](../../packages/store/src/store.ts#L1364) `Store/shipWal` | `Store.sql` (1364) | CORE |
| [packages/store/src/store.ts:1375](../../packages/store/src/store.ts#L1375) `Store/trial` | `Store.sql` (1375) | CORE |
| [packages/store/src/store.ts:1380](../../packages/store/src/store.ts#L1380) `Store/trial/undo` | `Store.sql` (1380) | CORE |
| [packages/store/src/store.ts:1415](../../packages/store/src/store.ts#L1415) `Store/joinTransaction` | `Store.sql` (1415, 1416, 1418, 1420, 1426) | CORE |
| [packages/store/src/store.ts:1438](../../packages/store/src/store.ts#L1438) `Store/independentWindowWrite` | `SQLite.get` (1438); `SQLite.prepare` (1438, 1461); `Store.sql` (1438, 1441, 1456, 1461, 1464) | CORE |
| [packages/store/src/store.ts:1486](../../packages/store/src/store.ts#L1486) `Store/withWriteTransaction` | `Store.sql` (1486, 1489, 1493, 1495, 1495) | CORE |
| [packages/store/src/store.ts:1525](../../packages/store/src/store.ts#L1525) `Store/endTransaction` | `Store.sql` (1525, 1528, 1528) | CORE |
| [packages/store/src/store.ts:1554](../../packages/store/src/store.ts#L1554) `Store/backup` | `Store.sql` (1554) | CORE |
| [packages/store/src/store.ts:1644](../../packages/store/src/store.ts#L1644) `Store/dataVersion` | `SQLite.get` (1644); `SQLite.prepare` (1644); `Store.sql` (1644) | CORE |
| [packages/store/src/store.ts:1684](../../packages/store/src/store.ts#L1684) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1684) | CORE |
| [packages/store/src/store.ts:1705](../../packages/store/src/store.ts#L1705) `Store/shareResults` | `Store.sql` (1705) | CORE |
| [packages/store/src/store.ts:1715](../../packages/store/src/store.ts#L1715) `Store/versionTriggers` | `SQLite.get` (1715); `SQLite.prepare` (1715, 1720, 1721); `Store.sql` (1715, 1717, 1718, 1720, 1721, 1730, 1731); `SQLite.all` (1720, 1721) | CORE |
| [packages/store/src/store.ts:1747](../../packages/store/src/store.ts#L1747) `Store/versionNumber` | `SQLite.get` (1747); `SQLite.prepare` (1747); `Store.sql` (1747) | CORE |
| [packages/store/src/store.ts:1760](../../packages/store/src/store.ts#L1760) `Store/changeOne` | `Store.sql` (1760, 1762) | CORE |
| [packages/store/src/store.ts:1763](../../packages/store/src/store.ts#L1763) `Store/changeOne/read` | `SQLite.get` (1763); `SQLite.prepare` (1763); `Store.sql` (1763) | CORE |
| [packages/store/src/store.ts:1802](../../packages/store/src/store.ts#L1802) `Store/writeToken` | `SQLite.get` (1802); `SQLite.prepare` (1802); `Store.sql` (1802) | CORE |
| [packages/store/src/store.ts:1814](../../packages/store/src/store.ts#L1814) `Store/recordCount` | `SQLite.get` (1814); `SQLite.prepare` (1814); `Store.sql` (1814) | CORE |
| [packages/store/src/store.ts:1926](../../packages/store/src/store.ts#L1926) `Store/applyDesign` | `Store.sql` (1926, 1927, 1940, 1943, 1948, 1964, 1967, 1967); `SQLite.prepare` (1943, 1948) | CORE |
| [packages/store/src/store.ts:2025](../../packages/store/src/store.ts#L2025) `Store/auditLog` | `SQLite.all` (2025); `SQLite.prepare` (2025); `Store.sql` (2025) | CORE |
| [packages/store/src/store.ts:2065](../../packages/store/src/store.ts#L2065) `Store/securityEvents` | `Store.auditLog` (2065) | CORE |
| [packages/store/src/store.ts:2091](../../packages/store/src/store.ts#L2091) `Store/prepared` | `SQLite.prepare` (2091); `Store.sql` (2091) | CORE |
| [packages/store/src/store.ts:2106](../../packages/store/src/store.ts#L2106) `Store/recordAsOf` | `SQLite.get` (2106, 2108); `SQLite.prepare` (2106, 2108, 2110, 2111); `Store.sql` (2106, 2108, 2110, 2111); `SQLite.all` (2110, 2111) | CORE |
| [packages/store/src/store.ts:2140](../../packages/store/src/store.ts#L2140) `Store/restoreRecord/run` | `Store.recordAsOf` (2140); `SQLite.get` (2144); `SQLite.prepare` (2144, 2148, 2157, 2168); `Store.sql` (2144, 2148, 2157, 2168) | CORE |
| [packages/store/src/store.ts:2184](../../packages/store/src/store.ts#L2184) `Store/revertAuditEntry` | `Store.auditLog` (2184) | CORE |
| [packages/store/src/store.ts:2277](../../packages/store/src/store.ts#L2277) `Store/setAuditSettings` | `SQLite.prepare` (2277); `Store.sql` (2277) | CORE |
| [packages/store/src/store.ts:2299](../../packages/store/src/store.ts#L2299) `Store/pruneAudit` | `Store.sql` (2299, 2301, 2303); `SQLite.get` (2301); `SQLite.prepare` (2301) | CORE |
| [packages/store/src/store.ts:2381](../../packages/store/src/store.ts#L2381) `Store/audit` | `Store.sql` (2381) | CORE |
| [packages/store/src/store.ts:2470](../../packages/store/src/store.ts#L2470) `Store/securityChange` | `Store.sql` (2470, 2472); `SQLite.prepare` (2472) | CORE |
| [packages/store/src/store.ts:2519](../../packages/store/src/store.ts#L2519) `Store/logSecurity` | `Store.sql` (2519) | CORE |
| [packages/store/src/store.ts:2542](../../packages/store/src/store.ts#L2542) `Store/ensureDeleted` | `Store.sql` (2542) | CORE |
| [packages/store/src/store.ts:2547](../../packages/store/src/store.ts#L2547) `Store/deletedRows` | `SQLite.get` (2547); `SQLite.prepare` (2547, 2549, 2549); `Store.sql` (2547, 2549, 2549); `SQLite.all` (2549, 2549) | CORE |
| [packages/store/src/store.ts:2573](../../packages/store/src/store.ts#L2573) `Store/emptyDeleted` | `Store.sql` (2573, 2576, 2577, 2579, 2581); `SQLite.prepare` (2577) | CORE |
| [packages/store/src/store.ts:2588](../../packages/store/src/store.ts#L2588) `Store/designHistory` | `SQLite.all` (2588); `SQLite.prepare` (2588); `Store.sql` (2588) | CORE |
| [packages/store/src/store.ts:2595](../../packages/store/src/store.ts#L2595) `Store/scriptHistory` | `SQLite.all` (2595); `SQLite.prepare` (2595); `Store.sql` (2595) | CORE |
| [packages/store/src/store.ts:2605](../../packages/store/src/store.ts#L2605) `Store/layoutHistory` | `SQLite.all` (2605); `SQLite.prepare` (2605); `Store.sql` (2605) | CORE |
| [packages/store/src/store.ts:2634](../../packages/store/src/store.ts#L2634) `Store/designEffect/renameKey` | `SQLite.prepare` (2634); `Store.sql` (2634) | CORE |
| [packages/store/src/store.ts:2650](../../packages/store/src/store.ts#L2650) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2650); `Store.sql` (2650) | CORE |
| [packages/store/src/store.ts:2657](../../packages/store/src/store.ts#L2657) `Store/designEffect` | `Store.sql` (2657, 2662, 2667, 2672, 2675, 2681, 2692, 2693, 2695, 2708, 2709, 2712, 2714, 2720, 2721, 2722, 2727, 2729, 2733, 2736, 2737, 2739, 2742, 2748, 2750, 2757, 2758, 2760, 2761, 2762, 2763, 2770, 2771, 2773, 2773, 2775, 2776, 2777, 2781, 2785, 2787, 2825, 2827, 2829); `SQLite.get` (2692, 2708, 2720, 2721, 2733, 2737, 2773, 2781); `SQLite.prepare` (2692, 2693, 2708, 2709, 2720, 2721, 2727, 2729, 2733, 2737, 2748, 2750, 2763, 2770, 2771, 2773, 2775, 2777, 2781, 2785); `SQLite.all` (2770, 2771); `SQLite.iterate` (2775) | CORE |
| [packages/store/src/store.ts:2837](../../packages/store/src/store.ts#L2837) `Store/dropColumnIndexes` | `SQLite.all` (2837, 2839); `SQLite.prepare` (2837, 2839); `Store.sql` (2837, 2839, 2840) | CORE |
| [packages/store/src/store.ts:2849](../../packages/store/src/store.ts#L2849) `Store/recompute` | `SQLite.prepare` (2849, 2853); `Store.sql` (2849, 2853); `SQLite.iterate` (2853); `Calculations.computeStoredStyled` (2854); `Calculations.value` (2854) | CORE |
| [packages/store/src/store.ts:2869](../../packages/store/src/store.ts#L2869) `Store/linkPrincipal` | `SQLite.get` (2869); `SQLite.prepare` (2869); `Store.sql` (2869) | CORE |
| [packages/store/src/store.ts:2876](../../packages/store/src/store.ts#L2876) `Store/linkIdentity` | `SQLite.get` (2876); `SQLite.prepare` (2876); `Store.sql` (2876) | CORE |
| [packages/store/src/store.ts:2882](../../packages/store/src/store.ts#L2882) `Store/accountsSharingLockout` | `SQLite.all` (2882); `SQLite.prepare` (2882); `Store.sql` (2882) | CORE |
| [packages/store/src/store.ts:2886](../../packages/store/src/store.ts#L2886) `Store/accounts` | `SQLite.all` (2886); `SQLite.prepare` (2886); `Store.sql` (2886) | CORE |
| [packages/store/src/store.ts:2898](../../packages/store/src/store.ts#L2898) `Store/isAgent` | `SQLite.get` (2898); `SQLite.prepare` (2898); `Store.sql` (2898) | CORE |
| [packages/store/src/store.ts:2904](../../packages/store/src/store.ts#L2904) `Store/agentNeedsApproval` | `SQLite.get` (2904); `SQLite.prepare` (2904); `Store.sql` (2904) | CORE |
| [packages/store/src/store.ts:2910](../../packages/store/src/store.ts#L2910) `Store/blankPasswordAccounts` | `SQLite.all` (2910); `SQLite.prepare` (2910); `Store.sql` (2910) | CORE |
| [packages/store/src/store.ts:1258](../../packages/store/src/store.ts#L1258) `Store/hasOwnPassword` | `SQLite.get` (1258); `SQLite.prepare` (1258); `Store.sql` (1258) | CORE |
| [packages/store/src/store.ts:2921](../../packages/store/src/store.ts#L2921) `Store/unmigratedAccounts` | `SQLite.all` (2921); `SQLite.prepare` (2921); `Store.sql` (2921) | CORE |
| [packages/store/src/store.ts:2974](../../packages/store/src/store.ts#L2974) `Store/setExternalAccount` | `SQLite.get` (2974); `SQLite.prepare` (2974, 2979); `Store.sql` (2974, 2979) | CORE |
| [packages/store/src/store.ts:2992](../../packages/store/src/store.ts#L2992) `Store/refuseLookalikeAccount` | `SQLite.all` (2992); `SQLite.prepare` (2992); `Store.sql` (2992) | CORE |
| [packages/store/src/store.ts:3001](../../packages/store/src/store.ts#L3001) `Store/isExternal` | `SQLite.get` (3001); `SQLite.prepare` (3001); `Store.sql` (3001) | CORE |
| [packages/store/src/store.ts:3022](../../packages/store/src/store.ts#L3022) `Store/setAgentAccount` | `SQLite.get` (3022); `SQLite.prepare` (3022, 3028); `Store.sql` (3022, 3028) | CORE |
| [packages/store/src/store.ts:3062](../../packages/store/src/store.ts#L3062) `Store/gateAgentWrite` | `SQLite.prepare` (3062); `Store.sql` (3062) | CORE |
| [packages/store/src/store.ts:3084](../../packages/store/src/store.ts#L3084) `Store/pendingChanges` | `SQLite.all` (3084); `SQLite.prepare` (3084); `Store.sql` (3084) | CORE |
| [packages/store/src/store.ts:3098](../../packages/store/src/store.ts#L3098) `Store/approvePending` | `SQLite.get` (3098); `SQLite.prepare` (3098, 3109); `Store.sql` (3098, 3109) | CORE |
| [packages/store/src/store.ts:3119](../../packages/store/src/store.ts#L3119) `Store/rejectPending` | `SQLite.get` (3119); `SQLite.prepare` (3119, 3121); `Store.sql` (3119, 3121) | CORE |
| [packages/store/src/store.ts:3141](../../packages/store/src/store.ts#L3141) `Store/externalAccount` | `SQLite.all` (3141); `SQLite.prepare` (3141); `Store.sql` (3141) | CORE |
| [packages/store/src/store.ts:3172](../../packages/store/src/store.ts#L3172) `Store/setPassword` | `SQLite.get` (3172); `SQLite.prepare` (3172, 3174, 3183); `Store.sql` (3172, 3174, 3183) | AUTH |
| [packages/store/src/store.ts:3197](../../packages/store/src/store.ts#L3197) `Store/createAccount` | `SQLite.get` (3197); `SQLite.prepare` (3197, 3201, 3207, 3212, 3217); `Store.sql` (3197, 3201, 3207, 3212, 3217) | CORE |
| [packages/store/src/store.ts:3225](../../packages/store/src/store.ts#L3225) `Store/appendSecurityEvent` | `Store.sql` (3225) | CORE |
| [packages/store/src/store.ts:3267](../../packages/store/src/store.ts#L3267) `Store/setPasswordPolicy` | `SQLite.prepare` (3267); `Store.sql` (3267) | CORE |
| [packages/store/src/store.ts:3303](../../packages/store/src/store.ts#L3303) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3303); `Store.sql` (3303) | CORE |
| [packages/store/src/store.ts:3326](../../packages/store/src/store.ts#L3326) `Store/saveScriptTest` | `SQLite.prepare` (3326); `Store.sql` (3326) | CORE |
| [packages/store/src/store.ts:3335](../../packages/store/src/store.ts#L3335) `Store/deleteScriptTest` | `SQLite.prepare` (3335); `Store.sql` (3335) | CORE |
| [packages/store/src/store.ts:3370](../../packages/store/src/store.ts#L3370) `Store/setAiAllowed` | `SQLite.prepare` (3370); `Store.sql` (3370) | CORE |
| [packages/store/src/store.ts:3437](../../packages/store/src/store.ts#L3437) `Store/setAiPolicy` | `SQLite.prepare` (3437); `Store.sql` (3437) | CORE |
| [packages/store/src/store.ts:3385](../../packages/store/src/store.ts#L3385) `Store/setScriptNetwork` | `SQLite.prepare` (3385); `Store.sql` (3385) | CORE |
| [packages/store/src/store.ts:3426](../../packages/store/src/store.ts#L3426) `Store/setWebViewerHosts` | `SQLite.prepare` (3426); `Store.sql` (3426) | CORE |
| [packages/store/src/store.ts:3457](../../packages/store/src/store.ts#L3457) `Store/setPiiIsolation` | `SQLite.prepare` (3457); `Store.sql` (3457) | CORE |
| [packages/store/src/store.ts:3479](../../packages/store/src/store.ts#L3479) `Store/markPiiField` | `SQLite.prepare` (3479); `Store.sql` (3479) | CORE |
| [packages/store/src/store.ts:3593](../../packages/store/src/store.ts#L3593) `Store/lastSignIns` | `Store.auditLog` (3593) | CORE |
| [packages/store/src/store.ts:3796](../../packages/store/src/store.ts#L3796) `Store/unusualAccess` | `Store.auditLog` (3796, 3862) | CORE |
| [packages/store/src/store.ts:3893](../../packages/store/src/store.ts#L3893) `Store/leastPrivilege` | `SQLite.all` (3893); `SQLite.prepare` (3893); `Store.sql` (3893) | CORE |
| [packages/store/src/store.ts:3966](../../packages/store/src/store.ts#L3966) `Store/unusedAccess` | `SQLite.get` (3966); `SQLite.prepare` (3966, 3975); `Store.sql` (3966, 3975); `SQLite.all` (3975) | CORE |
| [packages/store/src/store.ts:4014](../../packages/store/src/store.ts#L4014) `Store/unusedObjects` | `SQLite.get` (4014); `SQLite.prepare` (4014, 4017); `Store.sql` (4014, 4017); `SQLite.all` (4017) | CORE |
| [packages/store/src/store.ts:4052](../../packages/store/src/store.ts#L4052) `Store/usageCounting` | `SQLite.get` (4052); `SQLite.prepare` (4052); `Store.sql` (4052) | CORE |
| [packages/store/src/store.ts:4060](../../packages/store/src/store.ts#L4060) `Store/setMustChangePassword` | `SQLite.prepare` (4060); `Store.sql` (4060) | CORE |
| [packages/store/src/store.ts:4074](../../packages/store/src/store.ts#L4074) `Store/mustChangePassword` | `SQLite.get` (4074); `SQLite.prepare` (4074); `Store.sql` (4074) | CORE |
| [packages/store/src/store.ts:4113](../../packages/store/src/store.ts#L4113) `Store/passwordDaysRemaining` | `SQLite.get` (4113); `SQLite.prepare` (4113); `Store.sql` (4113) | CORE |
| [packages/store/src/store.ts:4120](../../packages/store/src/store.ts#L4120) `Store/importAccounts` | `SQLite.all` (4120); `SQLite.prepare` (4120); `Store.sql` (4120) | CORE |
| [packages/store/src/store.ts:4143](../../packages/store/src/store.ts#L4143) `Store/canonicalAccount` | `SQLite.all` (4143); `SQLite.prepare` (4143); `Store.sql` (4143) | CORE |
| [packages/store/src/store.ts:4155](../../packages/store/src/store.ts#L4155) `Store/createLocalAccount` | `SQLite.prepare` (4155); `Store.sql` (4155) | CORE |
| [packages/store/src/store.ts:4185](../../packages/store/src/store.ts#L4185) `Store/previewAccountImport` | `Store.sql` (4185, 4186, 4195) | CORE |
| [packages/store/src/store.ts:4203](../../packages/store/src/store.ts#L4203) `Store/limitAccountImport` | `SQLite.prepare` (4203, 4204, 4207); `Store.sql` (4203, 4204, 4207); `SQLite.get` (4204) | CORE |
| [packages/store/src/store.ts:4214](../../packages/store/src/store.ts#L4214) `Store/applyAccountImport` | `Store.sql` (4214, 4222, 4251); `SQLite.get` (4222); `SQLite.prepare` (4222, 4251) | CORE |
| [packages/store/src/store.ts:4276](../../packages/store/src/store.ts#L4276) `Store/forgetStandIns` | `SQLite.prepare` (4276); `Store.sql` (4276) | CORE |
| [packages/store/src/store.ts:4309](../../packages/store/src/store.ts#L4309) `Store/deleteAccount` | `SQLite.prepare` (4309, 4313, 4314, 4315, 4316, 4317, 4318, 4319, 4320, 4327, 4329, 4332, 4336); `Store.sql` (4309, 4313, 4314, 4315, 4316, 4317, 4318, 4319, 4320, 4327, 4329, 4332, 4336) | CORE |
| [packages/store/src/store.ts:4353](../../packages/store/src/store.ts#L4353) `Store/setAccountActive` | `SQLite.prepare` (4353, 4356, 4357); `Store.sql` (4353, 4356, 4357) | AUTH |
| [packages/store/src/store.ts:4367](../../packages/store/src/store.ts#L4367) `Store/accountInactive` | `SQLite.get` (4367); `SQLite.prepare` (4367); `Store.sql` (4367) | CORE |
| [packages/store/src/store.ts:4372](../../packages/store/src/store.ts#L4372) `Store/identityAllowed` | `SQLite.get` (4372, 4378, 4384); `SQLite.prepare` (4372, 4378, 4384); `Store.sql` (4372, 4378, 4384) | CORE |
| [packages/store/src/store.ts:4393](../../packages/store/src/store.ts#L4393) `Store/externalIdentityId` | `SQLite.get` (4393, 4399); `SQLite.prepare` (4393, 4398, 4399); `Store.sql` (4393, 4398, 4399) | CORE |
| [packages/store/src/store.ts:4404](../../packages/store/src/store.ts#L4404) `Store/accountIdentityId` | `SQLite.get` (4404, 4409); `SQLite.prepare` (4404, 4408, 4409); `Store.sql` (4404, 4408, 4409) | CORE |
| [packages/store/src/store.ts:4432](../../packages/store/src/store.ts#L4432) `Store/signInMark` | `SQLite.prepare` (4432); `Store.sql` (4432) | AUTH |
| [packages/store/src/store.ts:4442](../../packages/store/src/store.ts#L4442) `Store/signInBase` | `SQLite.get` (4442); `SQLite.prepare` (4442); `Store.sql` (4442) | AUTH |
| [packages/store/src/store.ts:4444](../../packages/store/src/store.ts#L4444) `Store/signInBase/identity` | `SQLite.get` (4444); `SQLite.prepare` (4444); `Store.sql` (4444) | AUTH |
| [packages/store/src/store.ts:4456](../../packages/store/src/store.ts#L4456) `Store/ledgerRow` | `SQLite.get` (4456, 4457); `SQLite.prepare` (4456, 4457); `Store.sql` (4456, 4457) | AUTH |
| [packages/store/src/store.ts:4468](../../packages/store/src/store.ts#L4468) `Store/ledgerWrite` | `Store.sql` (4468, 4469, 4471, 4473, 4476, 4476) | AUTH |
| [packages/store/src/store.ts:4495](../../packages/store/src/store.ts#L4495) `Store/settleSignIns` | `SQLite.all` (4495, 4501); `SQLite.prepare` (4495, 4501, 4507, 4511, 4513); `Store.sql` (4495, 4501, 4507, 4511, 4513) | AUTH |
| [packages/store/src/store.ts:4524](../../packages/store/src/store.ts#L4524) `Store/securityToken` | `SQLite.get` (4524); `SQLite.prepare` (4524); `Store.sql` (4524) | CORE |
| [packages/store/src/store.ts:4532](../../packages/store/src/store.ts#L4532) `Store/accountLocalOnly` | `SQLite.get` (4532); `SQLite.prepare` (4532); `Store.sql` (4532) | CORE |
| [packages/store/src/store.ts:4537](../../packages/store/src/store.ts#L4537) `Store/accountRequires2fa` | `SQLite.get` (4537); `SQLite.prepare` (4537); `Store.sql` (4537) | CORE |
| [packages/store/src/store.ts:4543](../../packages/store/src/store.ts#L4543) `Store/setAccountLocalOnly` | `SQLite.prepare` (4543); `Store.sql` (4543) | CORE |
| [packages/store/src/store.ts:4552](../../packages/store/src/store.ts#L4552) `Store/setAccountRequire2fa` | `SQLite.prepare` (4552); `Store.sql` (4552) | CORE |
| [packages/store/src/store.ts:4581](../../packages/store/src/store.ts#L4581) `Store/createApiToken` | `SQLite.get` (4581); `SQLite.prepare` (4581, 4611); `Store.sql` (4581, 4611) | CORE |
| [packages/store/src/store.ts:4658](../../packages/store/src/store.ts#L4658) `Store/recordObjectUse` | `Store.sql` (4658) | CORE |
| [packages/store/src/store.ts:4688](../../packages/store/src/store.ts#L4688) `Store/writeUsage` | `Store.sql` (4688, 4689, 4691, 4695, 4697) | CORE |
| [packages/store/src/store.ts:4704](../../packages/store/src/store.ts#L4704) `Store/writeUsageRows` | `SQLite.prepare` (4704, 4705, 4711); `Store.sql` (4704, 4705, 4711) | CORE |
| [packages/store/src/store.ts:4716](../../packages/store/src/store.ts#L4716) `Store/writeObjectUseRows` | `SQLite.prepare` (4716, 4717, 4722); `Store.sql` (4716, 4717, 4722) | CORE |
| [packages/store/src/store.ts:4727](../../packages/store/src/store.ts#L4727) `Store/objectUseSince` | `SQLite.get` (4727); `SQLite.prepare` (4727); `Store.sql` (4727) | CORE |
| [packages/store/src/store.ts:4740](../../packages/store/src/store.ts#L4740) `Store/accountUsage` | `SQLite.get` (4740); `SQLite.prepare` (4740, 4741); `Store.sql` (4740, 4741); `SQLite.all` (4741); `Store.auditLog` (4757) | CORE |
| [packages/store/src/store.ts:4773](../../packages/store/src/store.ts#L4773) `Store/apiTokens` | `SQLite.all` (4773); `SQLite.prepare` (4773); `Store.sql` (4773) | CORE |
| [packages/store/src/store.ts:4783](../../packages/store/src/store.ts#L4783) `Store/revokeApiToken` | `SQLite.prepare` (4783); `Store.sql` (4783) | CORE |
| [packages/store/src/store.ts:4797](../../packages/store/src/store.ts#L4797) `Store/apiToken` | `SQLite.get` (4797); `SQLite.prepare` (4797, 4809); `Store.sql` (4797, 4809) | CORE |
| [packages/store/src/store.ts:4825](../../packages/store/src/store.ts#L4825) `Store/enrollTotp` | `SQLite.prepare` (4825); `Store.sql` (4825) | CORE |
| [packages/store/src/store.ts:4836](../../packages/store/src/store.ts#L4836) `Store/confirmTotp` | `SQLite.get` (4836); `SQLite.prepare` (4836, 4838); `Store.sql` (4836, 4838) | CORE |
| [packages/store/src/store.ts:4846](../../packages/store/src/store.ts#L4846) `Store/hasTotp` | `SQLite.get` (4846); `SQLite.prepare` (4846); `Store.sql` (4846) | CORE |
| [packages/store/src/store.ts:4851](../../packages/store/src/store.ts#L4851) `Store/totpAccounts` | `SQLite.all` (4851); `SQLite.prepare` (4851); `Store.sql` (4851) | CORE |
| [packages/store/src/store.ts:4857](../../packages/store/src/store.ts#L4857) `Store/disableTotp` | `SQLite.prepare` (4857); `Store.sql` (4857) | CORE |
| [packages/store/src/store.ts:4880](../../packages/store/src/store.ts#L4880) `Store/verifyTotp` | `SQLite.get` (4880); `SQLite.prepare` (4880, 4886); `Store.sql` (4880, 4886) | CORE |
| [packages/store/src/store.ts:4899](../../packages/store/src/store.ts#L4899) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4899, 4901, 4902, 4904); `Store.sql` (4899, 4901, 4902, 4904); `SQLite.get` (4901) | CORE |
| [packages/store/src/store.ts:4951](../../packages/store/src/store.ts#L4951) `Store/passkeyAllowList` | `SQLite.all` (4951); `SQLite.prepare` (4951); `Store.sql` (4951) | CORE |
| [packages/store/src/store.ts:4965](../../packages/store/src/store.ts#L4965) `Store/takeWebauthnChallenge` | `SQLite.get` (4965); `SQLite.prepare` (4965, 4967); `Store.sql` (4965, 4967) | CORE |
| [packages/store/src/store.ts:4975](../../packages/store/src/store.ts#L4975) `Store/passkeys` | `SQLite.all` (4975); `SQLite.prepare` (4975); `Store.sql` (4975) | CORE |
| [packages/store/src/store.ts:4982](../../packages/store/src/store.ts#L4982) `Store/hasPasskey` | `SQLite.get` (4982); `SQLite.prepare` (4982); `Store.sql` (4982) | CORE |
| [packages/store/src/store.ts:4987](../../packages/store/src/store.ts#L4987) `Store/passkeyIds` | `SQLite.all` (4987); `SQLite.prepare` (4987); `Store.sql` (4987) | CORE |
| [packages/store/src/store.ts:5009](../../packages/store/src/store.ts#L5009) `Store/registerPasskey` | `SQLite.prepare` (5009); `Store.sql` (5009) | CORE |
| [packages/store/src/store.ts:5020](../../packages/store/src/store.ts#L5020) `Store/removePasskey` | `SQLite.get` (5020); `SQLite.prepare` (5020, 5021); `Store.sql` (5020, 5021) | CORE |
| [packages/store/src/store.ts:5037](../../packages/store/src/store.ts#L5037) `Store/verifyPasskeyAssertion` | `SQLite.get` (5037); `SQLite.prepare` (5037, 5048); `Store.sql` (5037, 5048) | CORE |
| [packages/store/src/store.ts:5084](../../packages/store/src/store.ts#L5084) `Store/generateRecoveryCodes` | `SQLite.prepare` (5084, 5087); `Store.sql` (5084, 5087) | CORE |
| [packages/store/src/store.ts:5102](../../packages/store/src/store.ts#L5102) `Store/recoveryCodesRemaining` | `SQLite.get` (5102); `SQLite.prepare` (5102); `Store.sql` (5102) | CORE |
| [packages/store/src/store.ts:5112](../../packages/store/src/store.ts#L5112) `Store/useRecoveryCode` | `SQLite.get` (5112); `SQLite.prepare` (5112, 5114); `Store.sql` (5112, 5114) | CORE |
| [packages/store/src/store.ts:5125](../../packages/store/src/store.ts#L5125) `Store/privilegeSets` | `Store.sql` (5125) | CORE |
| [packages/store/src/store.ts:5154](../../packages/store/src/store.ts#L5154) `Store/savePrivilegeSet` | `SQLite.prepare` (5154, 5162); `Store.sql` (5154, 5162) | AUTH |
| [packages/store/src/store.ts:5197](../../packages/store/src/store.ts#L5197) `Store/deletePrivilegeSet` | `SQLite.prepare` (5197); `Store.sql` (5197) | CORE |
| [packages/store/src/store.ts:5266](../../packages/store/src/store.ts#L5266) `Store/accountPrivilegeSet` | `SQLite.get` (5266); `SQLite.prepare` (5266); `Store.sql` (5266) | CORE |
| [packages/store/src/store.ts:5280](../../packages/store/src/store.ts#L5280) `Store/setAccountPrivilegeSet` | `SQLite.get` (5280); `SQLite.prepare` (5280, 5283, 5287); `Store.sql` (5280, 5283, 5287) | AUTH |
| [packages/store/src/store.ts:5302](../../packages/store/src/store.ts#L5302) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5302); `Store.sql` (5302) | CORE |
| [packages/store/src/store.ts:5316](../../packages/store/src/store.ts#L5316) `Store/addProvisionedAccount` | `SQLite.get` (5316); `SQLite.prepare` (5316, 5320); `Store.sql` (5316, 5320) | CORE |
| [packages/store/src/store.ts:5489](../../packages/store/src/store.ts#L5489) `Store/ruleOutcome` | `Calculations.context` (5489) | CORE |
| [packages/store/src/store.ts:5530](../../packages/store/src/store.ts#L5530) `Store/allowedIds` | `SQLite.iterate` (5530); `SQLite.prepare` (5530); `Store.sql` (5530) | CORE |
| [packages/store/src/store.ts:5628](../../packages/store/src/store.ts#L5628) `Store/scopedTableSql` | `Store.viewableIds` (5628); `SQLite.all` (5631); `SQLite.prepare` (5631); `Store.sql` (5631) | GATED-STORE |
| [packages/store/src/store.ts:5663](../../packages/store/src/store.ts#L5663) `Store/previewRecordRuleCurrent` | `SQLite.get` (5663); `SQLite.prepare` (5663, 5666); `Store.sql` (5663, 5666); `SQLite.all` (5666); `Calculations.context` (5672, 5688) | CORE |
| [packages/store/src/store.ts:5840](../../packages/store/src/store.ts#L5840) `Store/passwordHash` | `SQLite.get` (5840); `SQLite.prepare` (5840); `Store.sql` (5840) | CORE |
| [packages/store/src/store.ts:5869](../../packages/store/src/store.ts#L5869) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5869); `Store.sql` (5869) | CORE |
| [packages/store/src/store.ts:5882](../../packages/store/src/store.ts#L5882) `Store/knownSharedAccount` | `SQLite.get` (5882); `SQLite.prepare` (5882); `Store.sql` (5882) | CORE |
| [packages/store/src/store.ts:5945](../../packages/store/src/store.ts#L5945) `Store/layouts` | `SQLite.all` (5945); `SQLite.prepare` (5945); `Store.sql` (5945) | CORE |
| [packages/store/src/store.ts:5966](../../packages/store/src/store.ts#L5966) `Store/image` | `SQLite.get` (5966); `SQLite.prepare` (5966); `Store.sql` (5966) | CORE |
| [packages/store/src/store.ts:5976](../../packages/store/src/store.ts#L5976) `Store/images` | `SQLite.all` (5976); `SQLite.prepare` (5976); `Store.sql` (5976) | CORE |
| [packages/store/src/store.ts:5989](../../packages/store/src/store.ts#L5989) `Store/addImage` | `Store.sql` (5989, 5990); `SQLite.prepare` (5990) | CORE |
| [packages/store/src/store.ts:6006](../../packages/store/src/store.ts#L6006) `Store/layout` | `SQLite.get` (6006); `SQLite.prepare` (6006); `Store.sql` (6006) | CORE |
| [packages/store/src/store.ts:6210](../../packages/store/src/store.ts#L6210) `Store/wordIndex` | `Store.sql` (6210, 6218, 6223); `Store.recordCount` (6222); `SQLite.get` (6223); `SQLite.prepare` (6223) | CORE |
| [packages/store/src/store.ts:6275](../../packages/store/src/store.ts#L6275) `Store/toRecord` | `Calculations.value` (6275, 6285); `Calculations.globalValue` (6279); `Calculations.unstoredStyled` (6284) | CORE |
| [packages/store/src/store.ts:6334](../../packages/store/src/store.ts#L6334) `Store/relatedValues` | `Calculations.globalValue` (6334); `Calculations.unstoredValue` (6336) | CORE |
| [packages/store/src/store.ts:6408](../../packages/store/src/store.ts#L6408) `Store/addRelated` | `relatedRows` (6408); `rowsById` (6440); `firstRelatedEach` (6463) | CORE |
| [packages/store/src/store.ts:6491](../../packages/store/src/store.ts#L6491) `Store/foundSetPage` | `rowsById` (6491) | CORE |
| [packages/store/src/store.ts:6507](../../packages/store/src/store.ts#L6507) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6507); `Store.row` (6523) | GATED-STORE |
| [packages/store/src/store.ts:6546](../../packages/store/src/store.ts#L6546) `Store/portalCountsCurrent` | `Store.canView` (6546); `Store.row` (6573) | GATED-STORE |
| [packages/store/src/store.ts:6609](../../packages/store/src/store.ts#L6609) `Store/fieldIndexCurrent` | `SQLite.iterate` (6609); `SQLite.prepare` (6609, 6614); `Store.sql` (6609, 6614); `SQLite.all` (6614) | GATED-STORE |
| [packages/store/src/store.ts:6655](../../packages/store/src/store.ts#L6655) `Store/valueListItemsCurrent` | `Store.valueListItems` (6655); `Store.get` (6669); `relatedRows` (6670); `Store.row` (6670); `SQLite.iterate` (6672); `SQLite.prepare` (6672); `Store.sql` (6672); `Calculations.related` (6682); `Calculations.value` (6686, 6687) | GATED-STORE |
| [packages/store/src/store.ts:6784](../../packages/store/src/store.ts#L6784) `Store/portalRows` | `relatedRows` (6784); `relatedIdList` (6785); `Store.viewableIds` (6788); `rowsById` (6813, 6851); `Calculations.related` (6827) | CORE |
| [packages/store/src/store.ts:6795](../../packages/store/src/store.ts#L6795) `Store/portalRows/context` | `Calculations.context` (6795) | CORE |
| [packages/store/src/store.ts:6805](../../packages/store/src/store.ts#L6805) `Store/portalRows/valueOf` | `Calculations.value` (6805) | CORE |
| [packages/store/src/store.ts:6922](../../packages/store/src/store.ts#L6922) `Store/markRepeating` | `SQLite.prepare` (6922); `Store.sql` (6922) | CORE |
| [packages/store/src/store.ts:6949](../../packages/store/src/store.ts#L6949) `Store/externalContainerCheck` | `SQLite.all` (6949); `SQLite.prepare` (6949); `Store.sql` (6949) | CORE |
| [packages/store/src/store.ts:6956](../../packages/store/src/store.ts#L6956) `Store/externalContainerCount` | `SQLite.get` (6956); `SQLite.prepare` (6956); `Store.sql` (6956) | CORE |
| [packages/store/src/store.ts:6965](../../packages/store/src/store.ts#L6965) `Store/externalContainerReport` | `SQLite.all` (6965, 6978); `SQLite.prepare` (6965, 6978); `Store.sql` (6965, 6978) | CORE |
| [packages/store/src/store.ts:7114](../../packages/store/src/store.ts#L7114) `Store/orphanContainerReport` | `SQLite.all` (7114); `SQLite.prepare` (7114); `Store.sql` (7114) | CORE |
| [packages/store/src/store.ts:7149](../../packages/store/src/store.ts#L7149) `Store/purgeOrphanContainers` | `Store.sql` (7149, 7153, 7162, 7165, 7166, 7171, 7172, 7174, 7174); `Store.orphanContainerReport` (7157); `SQLite.get` (7162); `SQLite.prepare` (7162, 7165, 7166) | CORE |
| [packages/store/src/store.ts:7187](../../packages/store/src/store.ts#L7187) `Store/containerIntact` | `SQLite.get` (7187); `SQLite.prepare` (7187); `Store.sql` (7187) | CORE |
| [packages/store/src/store.ts:7197](../../packages/store/src/store.ts#L7197) `Store/externalOf` | `SQLite.get` (7197); `SQLite.prepare` (7197); `Store.sql` (7197) | CORE |
| [packages/store/src/store.ts:7201](../../packages/store/src/store.ts#L7201) `Store/containerMeta` | `SQLite.get` (7201); `SQLite.prepare` (7201); `Store.sql` (7201) | CORE |
| [packages/store/src/store.ts:7206](../../packages/store/src/store.ts#L7206) `Store/container` | `SQLite.get` (7206); `SQLite.prepare` (7206, 7215); `Store.sql` (7206, 7215); `SQLite.all` (7215) | CORE |
| [packages/store/src/store.ts:7223](../../packages/store/src/store.ts#L7223) `Store/containerInfo` | `SQLite.get` (7223); `SQLite.prepare` (7223); `Store.sql` (7223) | CORE |
| [packages/store/src/store.ts:7257](../../packages/store/src/store.ts#L7257) `Store/containerRange` | `SQLite.all` (7257); `SQLite.prepare` (7257, 7264); `Store.sql` (7257, 7264); `SQLite.get` (7264) | CORE |
| [packages/store/src/store.ts:7282](../../packages/store/src/store.ts#L7282) `Store/addContainer` | `SQLite.all` (7282); `SQLite.prepare` (7282, 7287, 7301, 7305, 7306); `Store.sql` (7282, 7287, 7301, 7303, 7305, 7306, 7308, 7311); `SQLite.get` (7292); `Store.containerRange` (7294) | CORE |
| [packages/store/src/store.ts:7328](../../packages/store/src/store.ts#L7328) `Store/addExternalContainer` | `SQLite.prepare` (7328); `Store.sql` (7328) | CORE |
| [packages/store/src/store.ts:7346](../../packages/store/src/store.ts#L7346) `Store/writeExternalFile` | `Store.evaluateEach` (7346); `SQLite.prepare` (7369); `Store.sql` (7369) | CORE |
| [packages/store/src/store.ts:7370](../../packages/store/src/store.ts#L7370) `Store/writeExternalFile/taken` | `SQLite.get` (7370) | CORE |
| [packages/store/src/store.ts:7400](../../packages/store/src/store.ts#L7400) `Store/embeddedContainers` | `SQLite.prepare` (7400, 7401); `Store.sql` (7400, 7401); `SQLite.all` (7401); `SQLite.get` (7405) | CORE |
| [packages/store/src/store.ts:7414](../../packages/store/src/store.ts#L7414) `Store/embeddedContainerCount` | `SQLite.prepare` (7414); `Store.sql` (7414); `SQLite.get` (7415) | CORE |
| [packages/store/src/store.ts:7423](../../packages/store/src/store.ts#L7423) `Store/recoverContainersOut` | `SQLite.prepare` (7423); `Store.sql` (7423); `SQLite.get` (7426) | CORE |
| [packages/store/src/store.ts:7451](../../packages/store/src/store.ts#L7451) `Store/moveContainersOut` | `Store.sql` (7451, 7459, 7461, 7463, 7468, 7469, 7489, 7495, 7497, 7499, 7499, 7505, 7505, 7510, 7512, 7514, 7514, 7520); `SQLite.get` (7459); `SQLite.prepare` (7459, 7468, 7469); `Store.container` (7471) | CORE |
| [packages/store/src/store.ts:7529](../../packages/store/src/store.ts#L7529) `Store/moveContainersIn` | `Store.sql` (7529, 7535, 7537, 7538, 7539, 7540, 7560, 7565, 7565, 7576, 7579, 7582, 7589); `SQLite.prepare` (7537, 7538, 7539, 7540, 7576, 7582); `SQLite.get` (7542, 7576, 7582) | CORE |
| [packages/store/src/store.ts:7601](../../packages/store/src/store.ts#L7601) `Store/compactFile` | `Store.sql` (7601, 7602, 7604) | CORE |
| [packages/store/src/store.ts:7610](../../packages/store/src/store.ts#L7610) `Store/containerId` | `Store.containerId` (7610); `Store.row` (7611) | CORE |
| [packages/store/src/store.ts:7633](../../packages/store/src/store.ts#L7633) `Store/checkContainerWrite` | `Store.row` (7633) | CORE |
| [packages/store/src/store.ts:7646](../../packages/store/src/store.ts#L7646) `Store/setContainer` | `Store.sql` (7646, 7660, 7665, 7668, 7668); `Store.row` (7649); `SQLite.prepare` (7660) | CORE |
| [packages/store/src/store.ts:7702](../../packages/store/src/store.ts#L7702) `Store/orderBy` | `Store.valueListItems` (7702) | CORE |
| [packages/store/src/store.ts:7725](../../packages/store/src/store.ts#L7725) `Store/userPrefs` | `SQLite.all` (7725); `SQLite.prepare` (7725); `Store.sql` (7725) | CORE |
| [packages/store/src/store.ts:7730](../../packages/store/src/store.ts#L7730) `Store/hasTable` | `SQLite.get` (7730); `SQLite.prepare` (7730); `Store.sql` (7730) | CORE |
| [packages/store/src/store.ts:7734](../../packages/store/src/store.ts#L7734) `Store/setUserPref` | `Store.sql` (7734, 7735, 7736); `SQLite.prepare` (7735, 7736) | CORE |
| [packages/store/src/store.ts:7742](../../packages/store/src/store.ts#L7742) `Store/indexedFields` | `SQLite.all` (7742, 7743); `SQLite.prepare` (7742, 7743); `Store.sql` (7742, 7743) | CORE |
| [packages/store/src/store.ts:7764](../../packages/store/src/store.ts#L7764) `Store/addFieldIndex` | `Store.sql` (7764) | CORE |
| [packages/store/src/store.ts:7776](../../packages/store/src/store.ts#L7776) `Store/dropFieldIndex` | `SQLite.get` (7776); `SQLite.prepare` (7776); `Store.sql` (7776, 7777) | CORE |
| [packages/store/src/store.ts:7787](../../packages/store/src/store.ts#L7787) `Store/timeFind` | `Store.query` (7787, 7791, 7792); `Store.recordCount` (7794) | CORE |
| [packages/store/src/store.ts:7811](../../packages/store/src/store.ts#L7811) `Store/find` | `Store.find` (7811) | GATED-STORE |
| [packages/store/src/store.ts:7822](../../packages/store/src/store.ts#L7822) `Store/findHere` | `Store.query` (7822, 7827, 7829, 7843, 7845, 7856); `Store.recordCount` (7840); `SQLite.get` (7841, 7845); `SQLite.prepare` (7841, 7845, 7851, 7858, 7867); `Store.sql` (7841, 7845, 7851, 7858, 7867); `SQLite.all` (7851, 7858, 7867) | GATED-STORE |
| [packages/store/src/store.ts:7862](../../packages/store/src/store.ts#L7862) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7862); `SQLite.prepare` (7862); `Store.sql` (7862) | GATED-STORE |
| [packages/store/src/store.ts:7895](../../packages/store/src/store.ts#L7895) `Store/sortedPage` | `SQLite.iterate` (7895); `SQLite.prepare` (7895, 7910); `Store.sql` (7895, 7910); `SQLite.all` (7910) | CORE |
| [packages/store/src/store.ts:7967](../../packages/store/src/store.ts#L7967) `Store/relatedCriteria/matched` | `relatedRows` (7967) | CORE |
| [packages/store/src/store.ts:7970](../../packages/store/src/store.ts#L7970) `Store/relatedCriteria` | `SQLite.iterate` (7970); `SQLite.prepare` (7970); `Store.sql` (7970) | CORE |
| [packages/store/src/store.ts:7996](../../packages/store/src/store.ts#L7996) `Store/computedRows` | `Store.sql` (7996, 7999, 8000, 8001, 8003, 8013, 8014, 8015, 8018); `SQLite.prepare` (7999, 8001, 8003, 8013); `SQLite.iterate` (8003); `Calculations.globalValue` (8006); `Calculations.unstoredValue` (8007); `Calculations.related` (8010); `SQLite.all` (8013) | CORE |
| [packages/store/src/store.ts:8043](../../packages/store/src/store.ts#L8043) `Store/summaries` | `Calculations.wholeTable` (8043); `Calculations.collect` (8063, 8068) | CORE |
| [packages/store/src/store.ts:8059](../../packages/store/src/store.ts#L8059) `Store/summaries/recs` | `SQLite.iterate` (8059); `SQLite.prepare` (8059); `Store.sql` (8059) | CORE |
| [packages/store/src/store.ts:8081](../../packages/store/src/store.ts#L8081) `Store/runningSummaryValues` | `Store.viewableIds` (8081); `rowsById` (8083); `Calculations.value` (8094, 8100); `Calculations.related` (8111) | GATED-STORE |
| [packages/store/src/store.ts:8127](../../packages/store/src/store.ts#L8127) `Store/findSource` | `Store.query` (8127); `SQLite.all` (8136, 8153); `SQLite.prepare` (8136, 8144, 8152); `Store.sql` (8136, 8141, 8144, 8149, 8152, 8166, 8168); `Calculations.globalValue` (8158); `Calculations.unstoredValue` (8159); `Calculations.related` (8163) | CORE |
| [packages/store/src/store.ts:8183](../../packages/store/src/store.ts#L8183) `Store/findCandidates` | `Store.query` (8183) | CORE |
| [packages/store/src/store.ts:8218](../../packages/store/src/store.ts#L8218) `Store/previewRow` | `Store.row` (8218) | CORE |
| [packages/store/src/store.ts:8236](../../packages/store/src/store.ts#L8236) `Store/row` | `SQLite.get` (8236) | CORE |
| [packages/store/src/store.ts:8255](../../packages/store/src/store.ts#L8255) `Store/getCurrent` | `Store.get` (8255); `Store.row` (8256, 8256, 8270); `SQLite.all` (8273); `SQLite.prepare` (8273); `Store.sql` (8273) | GATED-STORE |
| [packages/store/src/store.ts:8293](../../packages/store/src/store.ts#L8293) `Store/getManyCurrent` | `Store.getMany` (8293); `SQLite.get` (8311); `SQLite.prepare` (8311); `Store.sql` (8311) | GATED-STORE |
| [packages/store/src/store.ts:8304](../../packages/store/src/store.ts#L8304) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8304) | GATED-STORE |
| [packages/store/src/store.ts:8327](../../packages/store/src/store.ts#L8327) `Store/canViewRecord` | `SQLite.get` (8327); `SQLite.prepare` (8327); `Store.sql` (8327) | GATED-STORE |
| [packages/store/src/store.ts:8345](../../packages/store/src/store.ts#L8345) `Store/canView` | `Store.canView` (8345); `Store.row` (8346) | GATED-STORE |
| [packages/store/src/store.ts:8370](../../packages/store/src/store.ts#L8370) `Store/create` | `SQLite.get` (8370, 8376); `SQLite.prepare` (8370, 8376, 8389); `Store.sql` (8370, 8376, 8389) | CORE |
| [packages/store/src/store.ts:8413](../../packages/store/src/store.ts#L8413) `Store/duplicate` | `Store.row` (8413); `SQLite.get` (8417); `SQLite.prepare` (8417, 8432); `Store.sql` (8417, 8432) | CORE |
| [packages/store/src/store.ts:8484](../../packages/store/src/store.ts#L8484) `Store/update` | `Store.row` (8484, 8492, 8503); `Store.sql` (8516, 8517, 8556, 8559) | CORE |
| [packages/store/src/store.ts:8519](../../packages/store/src/store.ts#L8519) `Store/update/undo` | `Store.sql` (8519) | CORE |
| [packages/store/src/store.ts:8663](../../packages/store/src/store.ts#L8663) `Store/setStoredCalcValues` | `SQLite.prepare` (8663, 8664); `Store.sql` (8663, 8664); `SQLite.get` (8668) | CORE |
| [packages/store/src/store.ts:8751](../../packages/store/src/store.ts#L8751) `Store/evaluateCurrent` | `Store.row` (8751, 8751, 8752, 8752); `Calculations.context` (8757); `Store.get` (8758, 8760) | GATED-STORE |
| [packages/store/src/store.ts:8792](../../packages/store/src/store.ts#L8792) `Store/evaluateEachCurrent` | `Store.row` (8792, 8792, 8797); `Calculations.context` (8798); `Store.get` (8800) | GATED-STORE |
| [packages/store/src/store.ts:8833](../../packages/store/src/store.ts#L8833) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8833); `Store.get` (8835) | GATED-STORE |
| [packages/store/src/store.ts:8854](../../packages/store/src/store.ts#L8854) `Store/evaluateRowsCurrent` | `Store.row` (8854, 8854, 8855, 8855) | GATED-STORE |
| [packages/store/src/store.ts:8869](../../packages/store/src/store.ts#L8869) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8869) | GATED-STORE |
| [packages/store/src/store.ts:8891](../../packages/store/src/store.ts#L8891) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8891) | GATED-STORE |
| [packages/store/src/store.ts:8929](../../packages/store/src/store.ts#L8929) `Store/updateRelated` | `relatedRows` (8929) | CORE |
| [packages/store/src/store.ts:8947](../../packages/store/src/store.ts#L8947) `Store/updatePortals` | `Store.row` (8947, 8983); `relatedRows` (8984) | CORE |
| [packages/store/src/store.ts:8957](../../packages/store/src/store.ts#L8957) `Store/updatePortals/portal/related` | `relatedIdList` (8957) | CORE |
| [packages/store/src/store.ts:9039](../../packages/store/src/store.ts#L9039) `Store/portalContainerTarget` | `Store.row` (9039); `relatedIdList` (9041) | CORE |
| [packages/store/src/store.ts:9054](../../packages/store/src/store.ts#L9054) `Store/checkEditable` | `Store.row` (9054) | CORE |
| [packages/store/src/store.ts:9077](../../packages/store/src/store.ts#L9077) `Store/delete` | `Store.row` (9077) | CORE |
| [packages/store/src/store.ts:9085](../../packages/store/src/store.ts#L9085) `Store/delete/run` | `SQLite.get` (9085); `SQLite.prepare` (9085, 9089); `Store.sql` (9085, 9089) | CORE |
| [packages/store/src/store.ts:9311](../../packages/store/src/store.ts#L9311) `Store/keyStepWork` | `Store.sql` (9311, 9317, 9321, 9323) | CORE |
| [packages/store/src/store.ts:9114](../../packages/store/src/store.ts#L9114) `Store/vaultHeld` | `SQLite.get` (9114); `SQLite.prepare` (9114); `Store.sql` (9114) | CORE |
| [packages/store/src/store.ts:9121](../../packages/store/src/store.ts#L9121) `Store/forgetStandInValues` | `Store.sql` (9121, 9142); `SQLite.prepare` (9142) | CORE |
| [packages/store/src/store.ts:9161](../../packages/store/src/store.ts#L9161) `Store/restoreDeletedRowLocked` | `SQLite.get` (9161); `SQLite.prepare` (9161, 9162, 9166); `Store.sql` (9161, 9162, 9166); `SQLite.all` (9162) | CORE |
| [packages/store/src/store.ts:9364](../../packages/store/src/store.ts#L9364) `Store/cascadeDelete` | `relatedRows` (9364) | CORE |
| [packages/store/src/store.ts:9454](../../packages/store/src/store.ts#L9454) `Store/selectIdsCurrent` | `Store.selectIds` (9454); `SQLite.all` (9460); `SQLite.prepare` (9460); `Store.sql` (9460) | GATED-STORE |
| [packages/store/src/store.ts:9468](../../packages/store/src/store.ts#L9468) `Store/countIds` | `Store.countIds` (9468); `SQLite.get` (9472); `SQLite.prepare` (9472); `Store.sql` (9472) | GATED-STORE |
| [packages/store/src/store.ts:9488](../../packages/store/src/store.ts#L9488) `Store/computeValuesCurrent` | `Store.computeValues` (9488); `Store.sql` (9494, 9498); `SQLite.all` (9498); `SQLite.prepare` (9498) | GATED-STORE |
| [packages/store/src/store.ts:9513](../../packages/store/src/store.ts#L9513) `Store/findIdsCurrent` | `Store.findIds` (9513) | GATED-STORE |
| [packages/store/src/store.ts:9519](../../packages/store/src/store.ts#L9519) `Store/findIdsHere` | `Store.query` (9519, 9524, 9526); `SQLite.iterate` (9537); `SQLite.prepare` (9537); `Store.sql` (9537) | GATED-STORE |
| [packages/store/src/store.ts:9554](../../packages/store/src/store.ts#L9554) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9554); `Store.viewableIds` (9559); `Calculations.collect` (9575); `rowsById` (9575, 9625); `Calculations.collector` (9597) | GATED-STORE |
| [packages/store/src/store.ts:9587](../../packages/store/src/store.ts#L9587) `Store/groupSummariesCurrent/key` | `Calculations.value` (9587); `Calculations.related` (9589) | GATED-STORE |
| [packages/store/src/store.ts:9623](../../packages/store/src/store.ts#L9623) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9623) | GATED-STORE |
| [packages/store/src/store.ts:9679](../../packages/store/src/store.ts#L9679) `Store/sortIdsCurrentProgress` | `SQLite.all` (9679); `SQLite.prepare` (9679, 9747); `Store.sql` (9679, 9747); `Store.valueListItems` (9687); `rowsById` (9699); `Calculations.globalValue` (9702); `Calculations.unstoredValue` (9703); `Calculations.related` (9709); `SQLite.iterate` (9747) | GATED-STORE |
| [packages/store/src/store.ts:9761](../../packages/store/src/store.ts#L9761) `Store/matchIds` | `Store.matchIds` (9761); `SQLite.all` (9767); `SQLite.prepare` (9767); `Store.sql` (9767) | CORE |
| [packages/store/src/store.ts:9788](../../packages/store/src/store.ts#L9788) `Store/truncate/run` | `Store.sql` (9788, 9790, 9797, 9799, 9801, 9802); `SQLite.prepare` (9790, 9797); `SQLite.all` (9792) | CORE |
| [packages/store/src/store.ts:9826](../../packages/store/src/store.ts#L9826) `Store/iterateCommitted` | `SQLite.iterate` (9826) | CORE |
| [packages/store/src/store.ts:9860](../../packages/store/src/store.ts#L9860) `Store/readOnlyChecked` | `SQLite.prepare` (9860, 9864, 9873, 9878); `SQLite.all` (9864, 9873, 9878) | CORE |
| [packages/store/src/store.ts:9900](../../packages/store/src/store.ts#L9900) `Store/refreshDecimalSqlViews` | `SQLite.get` (9900); `SQLite.prepare` (9900, 9905); `SQLite.all` (9905) | CORE |
| [packages/store/src/store.ts:9919](../../packages/store/src/store.ts#L9919) `Store/internalRoots` | `SQLite.get` (9919); `SQLite.prepare` (9919, 9921); `SQLite.all` (9921) | CORE |
| [packages/store/src/store.ts:9954](../../packages/store/src/store.ts#L9954) `Store/selectCurrent` | `SQLite.iterate` (9954) | CORE |
| [packages/store/src/store.ts:10003](../../packages/store/src/store.ts#L10003) `Store/query` | `SQLite.iterate` (10003) | CORE |
| [packages/store/src/store.ts:10037](../../packages/store/src/store.ts#L10037) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10037); `SQLite.all` (10044, 10047); `SQLite.prepare` (10044, 10047) | CORE |
| [packages/store/src/store.ts:1203](../../packages/store/src/store.ts#L1203) `Store/ensureNativeIds` | `SQLite.all` (1203, 1215); `SQLite.prepare` (1203, 1206, 1214, 1215); `Store.sql` (1203, 1206, 1209, 1213, 1214, 1215, 1218, 1220) | CORE |
| [packages/store/src/store.ts:1228](../../packages/store/src/store.ts#L1228) `Store/nativeIdGuards` | `Store.sql` (1228, 1229, 1231) | CORE |
| [packages/store/src/store.ts:9970](../../packages/store/src/store.ts#L9970) `Store/selectIn` | `Store.select` (9970) | CORE |
| [packages/store/src/store.ts:9978](../../packages/store/src/store.ts#L9978) `Store/selectHeldCurrent` | `Store.sql` (9978, 9979); `SQLite.prepare` (9979); `SQLite.iterate` (9982) | CORE |
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
| [packages/store/src/store.ts:1574](../../packages/store/src/store.ts#L1574) `Store/selfContainedCopy` | `Store.sql` (1574); `SQLite.all` (1579); `SQLite.prepare` (1579, 1581, 1582, 1583) | CORE |
| [packages/store/src/store.ts:7028](../../packages/store/src/store.ts#L7028) `Store/containerReferences` | `SQLite.all` (7028, 7047, 7049, 7055, 7068, 7079, 7093); `SQLite.prepare` (7028, 7047, 7049, 7055, 7068, 7079, 7091, 7093); `Store.sql` (7028, 7047, 7049, 7055, 7068, 7079, 7091, 7093); `SQLite.get` (7091); `Store.row` (7102) | CORE |
| [packages/store/src/store.ts:7126](../../packages/store/src/store.ts#L7126) `Store/containerIntegrityReport` | `SQLite.all` (7126); `SQLite.prepare` (7126, 7137); `Store.sql` (7126, 7137); `SQLite.get` (7137) | CORE |
| [packages/store/src/store.ts:8741](../../packages/store/src/store.ts#L8741) `Store/recordViewable` | `Store.row` (8741) | GATED-STORE |
| [packages/server/src/compaction.ts:65](../../packages/server/src/compaction.ts#L65) `compactStore` | `SQLite.get` (65, 66, 80, 88); `SQLite.prepare` (65, 66, 80, 88) | OPERATOR |
<!-- end generated read-gate inventory -->
