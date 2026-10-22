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
| [packages/server/src/logs.ts:76](../../packages/server/src/logs.ts#L76) `LogShipper/follow` | `SQLite.get` (76); `SQLite.prepare` (76); `Store.sql` (76, 77, 78, 79) | ADMIN |
| [packages/server/src/logs.ts:88](../../packages/server/src/logs.ts#L88) `LogShipper/releaseIfIdle` | `Store.sql` (88) | ADMIN |
| [packages/server/src/mcp-design.ts:506](../../packages/server/src/mcp-design.ts#L506) `registerDesignTools/audit_log` | `Store.auditLog` (506) | DESIGN |
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
| [packages/store/src/store.ts:869](../../packages/store/src/store.ts#L869) `Store/metadataVersions` | `SQLite.get` (869); `SQLite.prepare` (869); `Store.sql` (869) | CORE |
| [packages/store/src/store.ts:1007](../../packages/store/src/store.ts#L1007) `Store/constructor` | `Store.sql` (1007, 1009, 1011, 1012, 1016, 1020, 1021, 1032, 1037, 1042, 1043, 1047, 1048, 1049, 1056, 1060, 1064, 1065, 1066, 1071, 1075, 1078, 1079, 1081, 1082, 1085, 1086, 1090, 1091, 1095, 1096, 1099, 1101, 1104, 1105, 1109, 1110, 1114, 1115, 1118, 1119, 1120, 1123, 1124, 1127, 1128, 1130, 1130, 1131, 1131, 1132, 1135, 1139, 1141, 1144, 1145, 1146, 1149, 1150, 1152, 1154, 1155, 1159, 1160, 1162, 1166, 1167, 1168, 1168, 1172, 1173); `SQLite.get` (1011); `SQLite.prepare` (1011, 1078, 1079, 1082, 1085, 1090, 1095, 1104, 1109, 1114, 1123, 1127, 1130, 1131, 1149, 1154, 1159); `SQLite.all` (1078, 1085, 1090, 1095, 1104, 1109, 1114, 1123, 1127, 1130, 1131, 1149, 1154, 1159) | CORE |
| [packages/store/src/store.ts:1230](../../packages/store/src/store.ts#L1230) `Store/grantFullAccessClients` | `SQLite.prepare` (1230); `Store.sql` (1230) | CORE |
| [packages/store/src/store.ts:1247](../../packages/store/src/store.ts#L1247) `Store/meta` | `SQLite.get` (1247); `SQLite.prepare` (1247); `Store.sql` (1247) | CORE |
| [packages/store/src/store.ts:1255](../../packages/store/src/store.ts#L1255) `Store/persistentTable` | `Store.sql` (1255) | CORE |
| [packages/store/src/store.ts:1265](../../packages/store/src/store.ts#L1265) `Store/persistentData` | `SQLite.get` (1265) | CORE |
| [packages/store/src/store.ts:1274](../../packages/store/src/store.ts#L1274) `Store/persistentDataIds` | `SQLite.all` (1274) | CORE |
| [packages/store/src/store.ts:1280](../../packages/store/src/store.ts#L1280) `Store/setPersistentData` | `SQLite.prepare` (1280, 1284); `Store.sql` (1280, 1284) | CORE |
| [packages/store/src/store.ts:1297](../../packages/store/src/store.ts#L1297) `Store/checkpoint` | `SQLite.get` (1297); `SQLite.prepare` (1297); `Store.sql` (1297) | CORE |
| [packages/store/src/store.ts:1305](../../packages/store/src/store.ts#L1305) `Store/recordedFormat` | `Store.sql` (1305) | CORE |
| [packages/store/src/store.ts:1315](../../packages/store/src/store.ts#L1315) `Store/close` | `Store.sql` (1315) | CORE |
| [packages/store/src/store.ts:1331](../../packages/store/src/store.ts#L1331) `Store/shipWal` | `Store.sql` (1331) | CORE |
| [packages/store/src/store.ts:1342](../../packages/store/src/store.ts#L1342) `Store/trial` | `Store.sql` (1342) | CORE |
| [packages/store/src/store.ts:1347](../../packages/store/src/store.ts#L1347) `Store/trial/undo` | `Store.sql` (1347) | CORE |
| [packages/store/src/store.ts:1382](../../packages/store/src/store.ts#L1382) `Store/joinTransaction` | `Store.sql` (1382, 1383, 1385, 1387, 1393) | CORE |
| [packages/store/src/store.ts:1405](../../packages/store/src/store.ts#L1405) `Store/independentWindowWrite` | `SQLite.get` (1405); `SQLite.prepare` (1405, 1428); `Store.sql` (1405, 1408, 1423, 1428, 1431) | CORE |
| [packages/store/src/store.ts:1453](../../packages/store/src/store.ts#L1453) `Store/withWriteTransaction` | `Store.sql` (1453, 1456, 1460, 1462, 1462) | CORE |
| [packages/store/src/store.ts:1492](../../packages/store/src/store.ts#L1492) `Store/endTransaction` | `Store.sql` (1492, 1495, 1495) | CORE |
| [packages/store/src/store.ts:1521](../../packages/store/src/store.ts#L1521) `Store/backup` | `Store.sql` (1521) | CORE |
| [packages/store/src/store.ts:1611](../../packages/store/src/store.ts#L1611) `Store/dataVersion` | `SQLite.get` (1611); `SQLite.prepare` (1611); `Store.sql` (1611) | CORE |
| [packages/store/src/store.ts:1651](../../packages/store/src/store.ts#L1651) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1651) | CORE |
| [packages/store/src/store.ts:1672](../../packages/store/src/store.ts#L1672) `Store/shareResults` | `Store.sql` (1672) | CORE |
| [packages/store/src/store.ts:1682](../../packages/store/src/store.ts#L1682) `Store/versionTriggers` | `SQLite.get` (1682); `SQLite.prepare` (1682, 1687, 1688); `Store.sql` (1682, 1684, 1685, 1687, 1688, 1697, 1698); `SQLite.all` (1687, 1688) | CORE |
| [packages/store/src/store.ts:1714](../../packages/store/src/store.ts#L1714) `Store/versionNumber` | `SQLite.get` (1714); `SQLite.prepare` (1714); `Store.sql` (1714) | CORE |
| [packages/store/src/store.ts:1727](../../packages/store/src/store.ts#L1727) `Store/changeOne` | `Store.sql` (1727, 1729) | CORE |
| [packages/store/src/store.ts:1730](../../packages/store/src/store.ts#L1730) `Store/changeOne/read` | `SQLite.get` (1730); `SQLite.prepare` (1730); `Store.sql` (1730) | CORE |
| [packages/store/src/store.ts:1769](../../packages/store/src/store.ts#L1769) `Store/writeToken` | `SQLite.get` (1769); `SQLite.prepare` (1769); `Store.sql` (1769) | CORE |
| [packages/store/src/store.ts:1781](../../packages/store/src/store.ts#L1781) `Store/recordCount` | `SQLite.get` (1781); `SQLite.prepare` (1781); `Store.sql` (1781) | CORE |
| [packages/store/src/store.ts:1889](../../packages/store/src/store.ts#L1889) `Store/applyDesign` | `Store.sql` (1889, 1890, 1901, 1904, 1909, 1921, 1924, 1924); `SQLite.prepare` (1904, 1909) | CORE |
| [packages/store/src/store.ts:1982](../../packages/store/src/store.ts#L1982) `Store/auditLog` | `SQLite.all` (1982); `SQLite.prepare` (1982); `Store.sql` (1982) | CORE |
| [packages/store/src/store.ts:2022](../../packages/store/src/store.ts#L2022) `Store/securityEvents` | `Store.auditLog` (2022) | CORE |
| [packages/store/src/store.ts:2048](../../packages/store/src/store.ts#L2048) `Store/prepared` | `SQLite.prepare` (2048); `Store.sql` (2048) | CORE |
| [packages/store/src/store.ts:2063](../../packages/store/src/store.ts#L2063) `Store/recordAsOf` | `SQLite.get` (2063, 2065); `SQLite.prepare` (2063, 2065, 2067, 2068); `Store.sql` (2063, 2065, 2067, 2068); `SQLite.all` (2067, 2068) | CORE |
| [packages/store/src/store.ts:2093](../../packages/store/src/store.ts#L2093) `Store/restoreRecord` | `Store.recordAsOf` (2093); `SQLite.get` (2097); `SQLite.prepare` (2097, 2100, 2107, 2115); `Store.sql` (2097, 2100, 2107, 2115) | CORE |
| [packages/store/src/store.ts:2129](../../packages/store/src/store.ts#L2129) `Store/revertAuditEntry` | `Store.auditLog` (2129) | CORE |
| [packages/store/src/store.ts:2222](../../packages/store/src/store.ts#L2222) `Store/setAuditSettings` | `SQLite.prepare` (2222); `Store.sql` (2222) | CORE |
| [packages/store/src/store.ts:2244](../../packages/store/src/store.ts#L2244) `Store/pruneAudit` | `Store.sql` (2244, 2246, 2248); `SQLite.get` (2246); `SQLite.prepare` (2246) | CORE |
| [packages/store/src/store.ts:2326](../../packages/store/src/store.ts#L2326) `Store/audit` | `Store.sql` (2326) | CORE |
| [packages/store/src/store.ts:2415](../../packages/store/src/store.ts#L2415) `Store/securityChange` | `Store.sql` (2415, 2417); `SQLite.prepare` (2417) | CORE |
| [packages/store/src/store.ts:2464](../../packages/store/src/store.ts#L2464) `Store/logSecurity` | `Store.sql` (2464) | CORE |
| [packages/store/src/store.ts:2487](../../packages/store/src/store.ts#L2487) `Store/ensureDeleted` | `Store.sql` (2487) | CORE |
| [packages/store/src/store.ts:2492](../../packages/store/src/store.ts#L2492) `Store/deletedRows` | `SQLite.get` (2492); `SQLite.prepare` (2492, 2494, 2494); `Store.sql` (2492, 2494, 2494); `SQLite.all` (2494, 2494) | CORE |
| [packages/store/src/store.ts:2518](../../packages/store/src/store.ts#L2518) `Store/emptyDeleted` | `Store.sql` (2518, 2521, 2522, 2524, 2526); `SQLite.prepare` (2522) | CORE |
| [packages/store/src/store.ts:2533](../../packages/store/src/store.ts#L2533) `Store/designHistory` | `SQLite.all` (2533); `SQLite.prepare` (2533); `Store.sql` (2533) | CORE |
| [packages/store/src/store.ts:2540](../../packages/store/src/store.ts#L2540) `Store/scriptHistory` | `SQLite.all` (2540); `SQLite.prepare` (2540); `Store.sql` (2540) | CORE |
| [packages/store/src/store.ts:2550](../../packages/store/src/store.ts#L2550) `Store/layoutHistory` | `SQLite.all` (2550); `SQLite.prepare` (2550); `Store.sql` (2550) | CORE |
| [packages/store/src/store.ts:2575](../../packages/store/src/store.ts#L2575) `Store/designEffect/renameKey` | `SQLite.prepare` (2575); `Store.sql` (2575) | CORE |
| [packages/store/src/store.ts:2591](../../packages/store/src/store.ts#L2591) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2591); `Store.sql` (2591) | CORE |
| [packages/store/src/store.ts:2598](../../packages/store/src/store.ts#L2598) `Store/designEffect` | `Store.sql` (2598, 2603, 2608, 2613, 2616, 2622, 2630, 2631, 2633, 2645, 2646, 2649, 2651, 2657, 2658, 2659, 2664, 2666, 2670, 2673, 2674, 2676, 2679, 2684, 2686, 2693, 2694, 2696, 2697, 2698, 2699, 2706, 2707, 2709, 2709, 2711, 2712, 2713, 2717, 2721, 2723, 2761, 2763, 2765); `SQLite.get` (2630, 2645, 2657, 2658, 2670, 2674, 2709, 2717); `SQLite.prepare` (2630, 2631, 2645, 2646, 2657, 2658, 2664, 2666, 2670, 2674, 2684, 2686, 2699, 2706, 2707, 2709, 2711, 2713, 2717, 2721); `SQLite.all` (2706, 2707); `SQLite.iterate` (2711) | CORE |
| [packages/store/src/store.ts:2773](../../packages/store/src/store.ts#L2773) `Store/dropColumnIndexes` | `SQLite.all` (2773, 2775); `SQLite.prepare` (2773, 2775); `Store.sql` (2773, 2775, 2776) | CORE |
| [packages/store/src/store.ts:2785](../../packages/store/src/store.ts#L2785) `Store/recompute` | `SQLite.prepare` (2785, 2789); `Store.sql` (2785, 2789); `SQLite.iterate` (2789); `Calculations.computeStoredStyled` (2790); `Calculations.value` (2790) | CORE |
| [packages/store/src/store.ts:2805](../../packages/store/src/store.ts#L2805) `Store/linkPrincipal` | `SQLite.get` (2805); `SQLite.prepare` (2805); `Store.sql` (2805) | CORE |
| [packages/store/src/store.ts:2812](../../packages/store/src/store.ts#L2812) `Store/linkIdentity` | `SQLite.get` (2812); `SQLite.prepare` (2812); `Store.sql` (2812) | CORE |
| [packages/store/src/store.ts:2818](../../packages/store/src/store.ts#L2818) `Store/accountsSharingLockout` | `SQLite.all` (2818); `SQLite.prepare` (2818); `Store.sql` (2818) | CORE |
| [packages/store/src/store.ts:2822](../../packages/store/src/store.ts#L2822) `Store/accounts` | `SQLite.all` (2822); `SQLite.prepare` (2822); `Store.sql` (2822) | CORE |
| [packages/store/src/store.ts:2834](../../packages/store/src/store.ts#L2834) `Store/isAgent` | `SQLite.get` (2834); `SQLite.prepare` (2834); `Store.sql` (2834) | CORE |
| [packages/store/src/store.ts:2840](../../packages/store/src/store.ts#L2840) `Store/agentNeedsApproval` | `SQLite.get` (2840); `SQLite.prepare` (2840); `Store.sql` (2840) | CORE |
| [packages/store/src/store.ts:2846](../../packages/store/src/store.ts#L2846) `Store/blankPasswordAccounts` | `SQLite.all` (2846); `SQLite.prepare` (2846); `Store.sql` (2846) | CORE |
| [packages/store/src/store.ts:1238](../../packages/store/src/store.ts#L1238) `Store/hasOwnPassword` | `SQLite.get` (1238); `SQLite.prepare` (1238); `Store.sql` (1238) | CORE |
| [packages/store/src/store.ts:2857](../../packages/store/src/store.ts#L2857) `Store/unmigratedAccounts` | `SQLite.all` (2857); `SQLite.prepare` (2857); `Store.sql` (2857) | CORE |
| [packages/store/src/store.ts:2910](../../packages/store/src/store.ts#L2910) `Store/setExternalAccount` | `SQLite.get` (2910); `SQLite.prepare` (2910, 2915); `Store.sql` (2910, 2915) | CORE |
| [packages/store/src/store.ts:2928](../../packages/store/src/store.ts#L2928) `Store/refuseLookalikeAccount` | `SQLite.all` (2928); `SQLite.prepare` (2928); `Store.sql` (2928) | CORE |
| [packages/store/src/store.ts:2937](../../packages/store/src/store.ts#L2937) `Store/isExternal` | `SQLite.get` (2937); `SQLite.prepare` (2937); `Store.sql` (2937) | CORE |
| [packages/store/src/store.ts:2958](../../packages/store/src/store.ts#L2958) `Store/setAgentAccount` | `SQLite.get` (2958); `SQLite.prepare` (2958, 2964); `Store.sql` (2958, 2964) | CORE |
| [packages/store/src/store.ts:2998](../../packages/store/src/store.ts#L2998) `Store/gateAgentWrite` | `SQLite.prepare` (2998); `Store.sql` (2998) | CORE |
| [packages/store/src/store.ts:3020](../../packages/store/src/store.ts#L3020) `Store/pendingChanges` | `SQLite.all` (3020); `SQLite.prepare` (3020); `Store.sql` (3020) | CORE |
| [packages/store/src/store.ts:3034](../../packages/store/src/store.ts#L3034) `Store/approvePending` | `SQLite.get` (3034); `SQLite.prepare` (3034, 3045); `Store.sql` (3034, 3045) | CORE |
| [packages/store/src/store.ts:3055](../../packages/store/src/store.ts#L3055) `Store/rejectPending` | `SQLite.get` (3055); `SQLite.prepare` (3055, 3057); `Store.sql` (3055, 3057) | CORE |
| [packages/store/src/store.ts:3077](../../packages/store/src/store.ts#L3077) `Store/externalAccount` | `SQLite.all` (3077); `SQLite.prepare` (3077); `Store.sql` (3077) | CORE |
| [packages/store/src/store.ts:3108](../../packages/store/src/store.ts#L3108) `Store/setPassword` | `SQLite.get` (3108); `SQLite.prepare` (3108, 3110, 3119); `Store.sql` (3108, 3110, 3119) | AUTH |
| [packages/store/src/store.ts:3133](../../packages/store/src/store.ts#L3133) `Store/createAccount` | `SQLite.get` (3133); `SQLite.prepare` (3133, 3137, 3143, 3148, 3153); `Store.sql` (3133, 3137, 3143, 3148, 3153) | CORE |
| [packages/store/src/store.ts:3161](../../packages/store/src/store.ts#L3161) `Store/appendSecurityEvent` | `Store.sql` (3161) | CORE |
| [packages/store/src/store.ts:3203](../../packages/store/src/store.ts#L3203) `Store/setPasswordPolicy` | `SQLite.prepare` (3203); `Store.sql` (3203) | CORE |
| [packages/store/src/store.ts:3239](../../packages/store/src/store.ts#L3239) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3239); `Store.sql` (3239) | CORE |
| [packages/store/src/store.ts:3262](../../packages/store/src/store.ts#L3262) `Store/saveScriptTest` | `SQLite.prepare` (3262); `Store.sql` (3262) | CORE |
| [packages/store/src/store.ts:3271](../../packages/store/src/store.ts#L3271) `Store/deleteScriptTest` | `SQLite.prepare` (3271); `Store.sql` (3271) | CORE |
| [packages/store/src/store.ts:3306](../../packages/store/src/store.ts#L3306) `Store/setAiAllowed` | `SQLite.prepare` (3306); `Store.sql` (3306) | CORE |
| [packages/store/src/store.ts:3352](../../packages/store/src/store.ts#L3352) `Store/setAiPolicy` | `SQLite.prepare` (3352); `Store.sql` (3352) | CORE |
| [packages/store/src/store.ts:3321](../../packages/store/src/store.ts#L3321) `Store/setScriptNetwork` | `SQLite.prepare` (3321); `Store.sql` (3321) | CORE |
| [packages/store/src/store.ts:3341](../../packages/store/src/store.ts#L3341) `Store/setWebViewerHosts` | `SQLite.prepare` (3341); `Store.sql` (3341) | CORE |
| [packages/store/src/store.ts:3372](../../packages/store/src/store.ts#L3372) `Store/setPiiIsolation` | `SQLite.prepare` (3372); `Store.sql` (3372) | CORE |
| [packages/store/src/store.ts:3394](../../packages/store/src/store.ts#L3394) `Store/markPiiField` | `SQLite.prepare` (3394); `Store.sql` (3394) | CORE |
| [packages/store/src/store.ts:3508](../../packages/store/src/store.ts#L3508) `Store/lastSignIns` | `Store.auditLog` (3508) | CORE |
| [packages/store/src/store.ts:3711](../../packages/store/src/store.ts#L3711) `Store/unusualAccess` | `Store.auditLog` (3711, 3777) | CORE |
| [packages/store/src/store.ts:3808](../../packages/store/src/store.ts#L3808) `Store/leastPrivilege` | `SQLite.all` (3808); `SQLite.prepare` (3808); `Store.sql` (3808) | CORE |
| [packages/store/src/store.ts:3881](../../packages/store/src/store.ts#L3881) `Store/unusedAccess` | `SQLite.get` (3881); `SQLite.prepare` (3881, 3890); `Store.sql` (3881, 3890); `SQLite.all` (3890) | CORE |
| [packages/store/src/store.ts:3929](../../packages/store/src/store.ts#L3929) `Store/unusedObjects` | `SQLite.get` (3929); `SQLite.prepare` (3929, 3932); `Store.sql` (3929, 3932); `SQLite.all` (3932) | CORE |
| [packages/store/src/store.ts:3967](../../packages/store/src/store.ts#L3967) `Store/usageCounting` | `SQLite.get` (3967); `SQLite.prepare` (3967); `Store.sql` (3967) | CORE |
| [packages/store/src/store.ts:3975](../../packages/store/src/store.ts#L3975) `Store/setMustChangePassword` | `SQLite.prepare` (3975); `Store.sql` (3975) | CORE |
| [packages/store/src/store.ts:3989](../../packages/store/src/store.ts#L3989) `Store/mustChangePassword` | `SQLite.get` (3989); `SQLite.prepare` (3989); `Store.sql` (3989) | CORE |
| [packages/store/src/store.ts:4028](../../packages/store/src/store.ts#L4028) `Store/passwordDaysRemaining` | `SQLite.get` (4028); `SQLite.prepare` (4028); `Store.sql` (4028) | CORE |
| [packages/store/src/store.ts:4035](../../packages/store/src/store.ts#L4035) `Store/importAccounts` | `SQLite.all` (4035); `SQLite.prepare` (4035); `Store.sql` (4035) | CORE |
| [packages/store/src/store.ts:4058](../../packages/store/src/store.ts#L4058) `Store/canonicalAccount` | `SQLite.all` (4058); `SQLite.prepare` (4058); `Store.sql` (4058) | CORE |
| [packages/store/src/store.ts:4070](../../packages/store/src/store.ts#L4070) `Store/createLocalAccount` | `SQLite.prepare` (4070); `Store.sql` (4070) | CORE |
| [packages/store/src/store.ts:4100](../../packages/store/src/store.ts#L4100) `Store/previewAccountImport` | `Store.sql` (4100, 4101, 4110) | CORE |
| [packages/store/src/store.ts:4118](../../packages/store/src/store.ts#L4118) `Store/limitAccountImport` | `SQLite.prepare` (4118, 4119, 4122); `Store.sql` (4118, 4119, 4122); `SQLite.get` (4119) | CORE |
| [packages/store/src/store.ts:4129](../../packages/store/src/store.ts#L4129) `Store/applyAccountImport` | `Store.sql` (4129, 4137, 4166); `SQLite.get` (4137); `SQLite.prepare` (4137, 4166) | CORE |
| [packages/store/src/store.ts:4191](../../packages/store/src/store.ts#L4191) `Store/forgetStandIns` | `SQLite.prepare` (4191); `Store.sql` (4191) | CORE |
| [packages/store/src/store.ts:4224](../../packages/store/src/store.ts#L4224) `Store/deleteAccount` | `SQLite.prepare` (4224, 4225, 4226, 4228, 4232); `Store.sql` (4224, 4225, 4226, 4228, 4232) | CORE |
| [packages/store/src/store.ts:4249](../../packages/store/src/store.ts#L4249) `Store/setAccountActive` | `SQLite.prepare` (4249, 4252, 4253); `Store.sql` (4249, 4252, 4253) | AUTH |
| [packages/store/src/store.ts:4263](../../packages/store/src/store.ts#L4263) `Store/accountInactive` | `SQLite.get` (4263); `SQLite.prepare` (4263); `Store.sql` (4263) | CORE |
| [packages/store/src/store.ts:4268](../../packages/store/src/store.ts#L4268) `Store/identityAllowed` | `SQLite.get` (4268, 4274, 4280); `SQLite.prepare` (4268, 4274, 4280); `Store.sql` (4268, 4274, 4280) | CORE |
| [packages/store/src/store.ts:4288](../../packages/store/src/store.ts#L4288) `Store/externalIdentityId` | `SQLite.get` (4288, 4294); `SQLite.prepare` (4288, 4293, 4294); `Store.sql` (4288, 4293, 4294) | CORE |
| [packages/store/src/store.ts:4299](../../packages/store/src/store.ts#L4299) `Store/accountIdentityId` | `SQLite.get` (4299, 4304); `SQLite.prepare` (4299, 4303, 4304); `Store.sql` (4299, 4303, 4304) | CORE |
| [packages/store/src/store.ts:4327](../../packages/store/src/store.ts#L4327) `Store/signInMark` | `SQLite.prepare` (4327); `Store.sql` (4327) | AUTH |
| [packages/store/src/store.ts:4337](../../packages/store/src/store.ts#L4337) `Store/signInBase` | `SQLite.get` (4337); `SQLite.prepare` (4337); `Store.sql` (4337) | AUTH |
| [packages/store/src/store.ts:4339](../../packages/store/src/store.ts#L4339) `Store/signInBase/identity` | `SQLite.get` (4339); `SQLite.prepare` (4339); `Store.sql` (4339) | AUTH |
| [packages/store/src/store.ts:4351](../../packages/store/src/store.ts#L4351) `Store/ledgerRow` | `SQLite.get` (4351, 4352); `SQLite.prepare` (4351, 4352); `Store.sql` (4351, 4352) | AUTH |
| [packages/store/src/store.ts:4363](../../packages/store/src/store.ts#L4363) `Store/ledgerWrite` | `Store.sql` (4363, 4364, 4366, 4368, 4371, 4371) | AUTH |
| [packages/store/src/store.ts:4390](../../packages/store/src/store.ts#L4390) `Store/settleSignIns` | `SQLite.all` (4390, 4396); `SQLite.prepare` (4390, 4396, 4402, 4406, 4408); `Store.sql` (4390, 4396, 4402, 4406, 4408) | AUTH |
| [packages/store/src/store.ts:4419](../../packages/store/src/store.ts#L4419) `Store/securityToken` | `SQLite.get` (4419); `SQLite.prepare` (4419); `Store.sql` (4419) | CORE |
| [packages/store/src/store.ts:4427](../../packages/store/src/store.ts#L4427) `Store/accountLocalOnly` | `SQLite.get` (4427); `SQLite.prepare` (4427); `Store.sql` (4427) | CORE |
| [packages/store/src/store.ts:4432](../../packages/store/src/store.ts#L4432) `Store/accountRequires2fa` | `SQLite.get` (4432); `SQLite.prepare` (4432); `Store.sql` (4432) | CORE |
| [packages/store/src/store.ts:4438](../../packages/store/src/store.ts#L4438) `Store/setAccountLocalOnly` | `SQLite.prepare` (4438); `Store.sql` (4438) | CORE |
| [packages/store/src/store.ts:4447](../../packages/store/src/store.ts#L4447) `Store/setAccountRequire2fa` | `SQLite.prepare` (4447); `Store.sql` (4447) | CORE |
| [packages/store/src/store.ts:4476](../../packages/store/src/store.ts#L4476) `Store/createApiToken` | `SQLite.get` (4476); `SQLite.prepare` (4476, 4506); `Store.sql` (4476, 4506) | CORE |
| [packages/store/src/store.ts:4553](../../packages/store/src/store.ts#L4553) `Store/recordObjectUse` | `Store.sql` (4553) | CORE |
| [packages/store/src/store.ts:4583](../../packages/store/src/store.ts#L4583) `Store/writeUsage` | `Store.sql` (4583, 4584, 4586, 4590, 4592) | CORE |
| [packages/store/src/store.ts:4599](../../packages/store/src/store.ts#L4599) `Store/writeUsageRows` | `SQLite.prepare` (4599, 4600, 4606); `Store.sql` (4599, 4600, 4606) | CORE |
| [packages/store/src/store.ts:4611](../../packages/store/src/store.ts#L4611) `Store/writeObjectUseRows` | `SQLite.prepare` (4611, 4612, 4617); `Store.sql` (4611, 4612, 4617) | CORE |
| [packages/store/src/store.ts:4622](../../packages/store/src/store.ts#L4622) `Store/objectUseSince` | `SQLite.get` (4622); `SQLite.prepare` (4622); `Store.sql` (4622) | CORE |
| [packages/store/src/store.ts:4635](../../packages/store/src/store.ts#L4635) `Store/accountUsage` | `SQLite.get` (4635); `SQLite.prepare` (4635, 4636); `Store.sql` (4635, 4636); `SQLite.all` (4636); `Store.auditLog` (4652) | CORE |
| [packages/store/src/store.ts:4668](../../packages/store/src/store.ts#L4668) `Store/apiTokens` | `SQLite.all` (4668); `SQLite.prepare` (4668); `Store.sql` (4668) | CORE |
| [packages/store/src/store.ts:4678](../../packages/store/src/store.ts#L4678) `Store/revokeApiToken` | `SQLite.prepare` (4678); `Store.sql` (4678) | CORE |
| [packages/store/src/store.ts:4692](../../packages/store/src/store.ts#L4692) `Store/apiToken` | `SQLite.get` (4692); `SQLite.prepare` (4692, 4704); `Store.sql` (4692, 4704) | CORE |
| [packages/store/src/store.ts:4720](../../packages/store/src/store.ts#L4720) `Store/enrollTotp` | `SQLite.prepare` (4720); `Store.sql` (4720) | CORE |
| [packages/store/src/store.ts:4731](../../packages/store/src/store.ts#L4731) `Store/confirmTotp` | `SQLite.get` (4731); `SQLite.prepare` (4731, 4733); `Store.sql` (4731, 4733) | CORE |
| [packages/store/src/store.ts:4741](../../packages/store/src/store.ts#L4741) `Store/hasTotp` | `SQLite.get` (4741); `SQLite.prepare` (4741); `Store.sql` (4741) | CORE |
| [packages/store/src/store.ts:4746](../../packages/store/src/store.ts#L4746) `Store/totpAccounts` | `SQLite.all` (4746); `SQLite.prepare` (4746); `Store.sql` (4746) | CORE |
| [packages/store/src/store.ts:4752](../../packages/store/src/store.ts#L4752) `Store/disableTotp` | `SQLite.prepare` (4752); `Store.sql` (4752) | CORE |
| [packages/store/src/store.ts:4775](../../packages/store/src/store.ts#L4775) `Store/verifyTotp` | `SQLite.get` (4775); `SQLite.prepare` (4775, 4781); `Store.sql` (4775, 4781) | CORE |
| [packages/store/src/store.ts:4794](../../packages/store/src/store.ts#L4794) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4794, 4796, 4797, 4799); `Store.sql` (4794, 4796, 4797, 4799); `SQLite.get` (4796) | CORE |
| [packages/store/src/store.ts:4846](../../packages/store/src/store.ts#L4846) `Store/passkeyAllowList` | `SQLite.all` (4846); `SQLite.prepare` (4846); `Store.sql` (4846) | CORE |
| [packages/store/src/store.ts:4860](../../packages/store/src/store.ts#L4860) `Store/takeWebauthnChallenge` | `SQLite.get` (4860); `SQLite.prepare` (4860, 4862); `Store.sql` (4860, 4862) | CORE |
| [packages/store/src/store.ts:4870](../../packages/store/src/store.ts#L4870) `Store/passkeys` | `SQLite.all` (4870); `SQLite.prepare` (4870); `Store.sql` (4870) | CORE |
| [packages/store/src/store.ts:4877](../../packages/store/src/store.ts#L4877) `Store/hasPasskey` | `SQLite.get` (4877); `SQLite.prepare` (4877); `Store.sql` (4877) | CORE |
| [packages/store/src/store.ts:4882](../../packages/store/src/store.ts#L4882) `Store/passkeyIds` | `SQLite.all` (4882); `SQLite.prepare` (4882); `Store.sql` (4882) | CORE |
| [packages/store/src/store.ts:4904](../../packages/store/src/store.ts#L4904) `Store/registerPasskey` | `SQLite.prepare` (4904); `Store.sql` (4904) | CORE |
| [packages/store/src/store.ts:4915](../../packages/store/src/store.ts#L4915) `Store/removePasskey` | `SQLite.get` (4915); `SQLite.prepare` (4915, 4916); `Store.sql` (4915, 4916) | CORE |
| [packages/store/src/store.ts:4932](../../packages/store/src/store.ts#L4932) `Store/verifyPasskeyAssertion` | `SQLite.get` (4932); `SQLite.prepare` (4932, 4943); `Store.sql` (4932, 4943) | CORE |
| [packages/store/src/store.ts:4979](../../packages/store/src/store.ts#L4979) `Store/generateRecoveryCodes` | `SQLite.prepare` (4979, 4982); `Store.sql` (4979, 4982) | CORE |
| [packages/store/src/store.ts:4997](../../packages/store/src/store.ts#L4997) `Store/recoveryCodesRemaining` | `SQLite.get` (4997); `SQLite.prepare` (4997); `Store.sql` (4997) | CORE |
| [packages/store/src/store.ts:5007](../../packages/store/src/store.ts#L5007) `Store/useRecoveryCode` | `SQLite.get` (5007); `SQLite.prepare` (5007, 5009); `Store.sql` (5007, 5009) | CORE |
| [packages/store/src/store.ts:5020](../../packages/store/src/store.ts#L5020) `Store/privilegeSets` | `Store.sql` (5020) | CORE |
| [packages/store/src/store.ts:5049](../../packages/store/src/store.ts#L5049) `Store/savePrivilegeSet` | `SQLite.prepare` (5049, 5057); `Store.sql` (5049, 5057) | AUTH |
| [packages/store/src/store.ts:5092](../../packages/store/src/store.ts#L5092) `Store/deletePrivilegeSet` | `SQLite.prepare` (5092); `Store.sql` (5092) | CORE |
| [packages/store/src/store.ts:5161](../../packages/store/src/store.ts#L5161) `Store/accountPrivilegeSet` | `SQLite.get` (5161); `SQLite.prepare` (5161); `Store.sql` (5161) | CORE |
| [packages/store/src/store.ts:5175](../../packages/store/src/store.ts#L5175) `Store/setAccountPrivilegeSet` | `SQLite.get` (5175); `SQLite.prepare` (5175, 5178, 5182); `Store.sql` (5175, 5178, 5182) | AUTH |
| [packages/store/src/store.ts:5197](../../packages/store/src/store.ts#L5197) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5197); `Store.sql` (5197) | CORE |
| [packages/store/src/store.ts:5211](../../packages/store/src/store.ts#L5211) `Store/addProvisionedAccount` | `SQLite.get` (5211); `SQLite.prepare` (5211, 5215); `Store.sql` (5211, 5215) | CORE |
| [packages/store/src/store.ts:5384](../../packages/store/src/store.ts#L5384) `Store/ruleOutcome` | `Calculations.context` (5384) | CORE |
| [packages/store/src/store.ts:5425](../../packages/store/src/store.ts#L5425) `Store/allowedIds` | `SQLite.iterate` (5425); `SQLite.prepare` (5425); `Store.sql` (5425) | CORE |
| [packages/store/src/store.ts:5495](../../packages/store/src/store.ts#L5495) `Store/scopedTableSql` | `Store.viewableIds` (5495); `SQLite.all` (5498); `SQLite.prepare` (5498); `Store.sql` (5498) | GATED-STORE |
| [packages/store/src/store.ts:5530](../../packages/store/src/store.ts#L5530) `Store/previewRecordRuleCurrent` | `SQLite.get` (5530); `SQLite.prepare` (5530, 5533); `Store.sql` (5530, 5533); `SQLite.all` (5533); `Calculations.context` (5539, 5555) | CORE |
| [packages/store/src/store.ts:5707](../../packages/store/src/store.ts#L5707) `Store/passwordHash` | `SQLite.get` (5707); `SQLite.prepare` (5707); `Store.sql` (5707) | CORE |
| [packages/store/src/store.ts:5736](../../packages/store/src/store.ts#L5736) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5736); `Store.sql` (5736) | CORE |
| [packages/store/src/store.ts:5749](../../packages/store/src/store.ts#L5749) `Store/knownSharedAccount` | `SQLite.get` (5749); `SQLite.prepare` (5749); `Store.sql` (5749) | CORE |
| [packages/store/src/store.ts:5812](../../packages/store/src/store.ts#L5812) `Store/layouts` | `SQLite.all` (5812); `SQLite.prepare` (5812); `Store.sql` (5812) | CORE |
| [packages/store/src/store.ts:5833](../../packages/store/src/store.ts#L5833) `Store/image` | `SQLite.get` (5833); `SQLite.prepare` (5833); `Store.sql` (5833) | CORE |
| [packages/store/src/store.ts:5843](../../packages/store/src/store.ts#L5843) `Store/images` | `SQLite.all` (5843); `SQLite.prepare` (5843); `Store.sql` (5843) | CORE |
| [packages/store/src/store.ts:5856](../../packages/store/src/store.ts#L5856) `Store/addImage` | `Store.sql` (5856, 5857); `SQLite.prepare` (5857) | CORE |
| [packages/store/src/store.ts:5873](../../packages/store/src/store.ts#L5873) `Store/layout` | `SQLite.get` (5873); `SQLite.prepare` (5873); `Store.sql` (5873) | CORE |
| [packages/store/src/store.ts:6077](../../packages/store/src/store.ts#L6077) `Store/wordIndex` | `Store.sql` (6077, 6085, 6090); `Store.recordCount` (6089); `SQLite.get` (6090); `SQLite.prepare` (6090) | CORE |
| [packages/store/src/store.ts:6142](../../packages/store/src/store.ts#L6142) `Store/toRecord` | `Calculations.value` (6142, 6152); `Calculations.globalValue` (6146); `Calculations.unstoredStyled` (6151) | CORE |
| [packages/store/src/store.ts:6201](../../packages/store/src/store.ts#L6201) `Store/relatedValues` | `Calculations.globalValue` (6201); `Calculations.unstoredValue` (6203) | CORE |
| [packages/store/src/store.ts:6275](../../packages/store/src/store.ts#L6275) `Store/addRelated` | `relatedRows` (6275); `rowsById` (6307); `firstRelatedEach` (6330) | CORE |
| [packages/store/src/store.ts:6358](../../packages/store/src/store.ts#L6358) `Store/foundSetPage` | `rowsById` (6358) | CORE |
| [packages/store/src/store.ts:6374](../../packages/store/src/store.ts#L6374) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6374); `Store.row` (6390) | GATED-STORE |
| [packages/store/src/store.ts:6413](../../packages/store/src/store.ts#L6413) `Store/portalCountsCurrent` | `Store.canView` (6413); `Store.row` (6440) | GATED-STORE |
| [packages/store/src/store.ts:6476](../../packages/store/src/store.ts#L6476) `Store/fieldIndexCurrent` | `SQLite.iterate` (6476); `SQLite.prepare` (6476, 6481); `Store.sql` (6476, 6481); `SQLite.all` (6481) | GATED-STORE |
| [packages/store/src/store.ts:6522](../../packages/store/src/store.ts#L6522) `Store/valueListItemsCurrent` | `Store.valueListItems` (6522); `Store.get` (6536); `relatedRows` (6537); `Store.row` (6537); `SQLite.iterate` (6539); `SQLite.prepare` (6539); `Store.sql` (6539); `Calculations.related` (6549); `Calculations.value` (6553, 6554) | GATED-STORE |
| [packages/store/src/store.ts:6651](../../packages/store/src/store.ts#L6651) `Store/portalRows` | `relatedRows` (6651); `relatedIdList` (6652); `Store.viewableIds` (6655); `rowsById` (6680, 6718); `Calculations.related` (6694) | CORE |
| [packages/store/src/store.ts:6662](../../packages/store/src/store.ts#L6662) `Store/portalRows/context` | `Calculations.context` (6662) | CORE |
| [packages/store/src/store.ts:6672](../../packages/store/src/store.ts#L6672) `Store/portalRows/valueOf` | `Calculations.value` (6672) | CORE |
| [packages/store/src/store.ts:6789](../../packages/store/src/store.ts#L6789) `Store/markRepeating` | `SQLite.prepare` (6789); `Store.sql` (6789) | CORE |
| [packages/store/src/store.ts:6816](../../packages/store/src/store.ts#L6816) `Store/externalContainerCheck` | `SQLite.all` (6816); `SQLite.prepare` (6816); `Store.sql` (6816) | CORE |
| [packages/store/src/store.ts:6823](../../packages/store/src/store.ts#L6823) `Store/externalContainerCount` | `SQLite.get` (6823); `SQLite.prepare` (6823); `Store.sql` (6823) | CORE |
| [packages/store/src/store.ts:6832](../../packages/store/src/store.ts#L6832) `Store/externalContainerReport` | `SQLite.all` (6832, 6845); `SQLite.prepare` (6832, 6845); `Store.sql` (6832, 6845) | CORE |
| [packages/store/src/store.ts:6980](../../packages/store/src/store.ts#L6980) `Store/orphanContainerReport` | `SQLite.all` (6980); `SQLite.prepare` (6980); `Store.sql` (6980) | CORE |
| [packages/store/src/store.ts:7015](../../packages/store/src/store.ts#L7015) `Store/purgeOrphanContainers` | `Store.sql` (7015, 7019, 7028, 7031, 7032, 7037, 7038, 7040, 7040); `Store.orphanContainerReport` (7023); `SQLite.get` (7028); `SQLite.prepare` (7028, 7031, 7032) | CORE |
| [packages/store/src/store.ts:7053](../../packages/store/src/store.ts#L7053) `Store/containerIntact` | `SQLite.get` (7053); `SQLite.prepare` (7053); `Store.sql` (7053) | CORE |
| [packages/store/src/store.ts:7063](../../packages/store/src/store.ts#L7063) `Store/externalOf` | `SQLite.get` (7063); `SQLite.prepare` (7063); `Store.sql` (7063) | CORE |
| [packages/store/src/store.ts:7067](../../packages/store/src/store.ts#L7067) `Store/containerMeta` | `SQLite.get` (7067); `SQLite.prepare` (7067); `Store.sql` (7067) | CORE |
| [packages/store/src/store.ts:7072](../../packages/store/src/store.ts#L7072) `Store/container` | `SQLite.get` (7072); `SQLite.prepare` (7072, 7081); `Store.sql` (7072, 7081); `SQLite.all` (7081) | CORE |
| [packages/store/src/store.ts:7089](../../packages/store/src/store.ts#L7089) `Store/containerInfo` | `SQLite.get` (7089); `SQLite.prepare` (7089); `Store.sql` (7089) | CORE |
| [packages/store/src/store.ts:7123](../../packages/store/src/store.ts#L7123) `Store/containerRange` | `SQLite.all` (7123); `SQLite.prepare` (7123, 7130); `Store.sql` (7123, 7130); `SQLite.get` (7130) | CORE |
| [packages/store/src/store.ts:7148](../../packages/store/src/store.ts#L7148) `Store/addContainer` | `SQLite.all` (7148); `SQLite.prepare` (7148, 7153, 7167, 7171, 7172); `Store.sql` (7148, 7153, 7167, 7169, 7171, 7172, 7174, 7177); `SQLite.get` (7158); `Store.containerRange` (7160) | CORE |
| [packages/store/src/store.ts:7194](../../packages/store/src/store.ts#L7194) `Store/addExternalContainer` | `SQLite.prepare` (7194); `Store.sql` (7194) | CORE |
| [packages/store/src/store.ts:7212](../../packages/store/src/store.ts#L7212) `Store/writeExternalFile` | `Store.evaluateEach` (7212); `SQLite.prepare` (7235); `Store.sql` (7235) | CORE |
| [packages/store/src/store.ts:7236](../../packages/store/src/store.ts#L7236) `Store/writeExternalFile/taken` | `SQLite.get` (7236) | CORE |
| [packages/store/src/store.ts:7265](../../packages/store/src/store.ts#L7265) `Store/embeddedContainers` | `SQLite.prepare` (7265, 7266); `Store.sql` (7265, 7266); `SQLite.all` (7266); `SQLite.get` (7270) | CORE |
| [packages/store/src/store.ts:7279](../../packages/store/src/store.ts#L7279) `Store/embeddedContainerCount` | `SQLite.prepare` (7279); `Store.sql` (7279); `SQLite.get` (7280) | CORE |
| [packages/store/src/store.ts:7288](../../packages/store/src/store.ts#L7288) `Store/recoverContainersOut` | `SQLite.prepare` (7288); `Store.sql` (7288); `SQLite.get` (7291) | CORE |
| [packages/store/src/store.ts:7313](../../packages/store/src/store.ts#L7313) `Store/moveContainersOut` | `Store.sql` (7313, 7321, 7323, 7325, 7327, 7328, 7347, 7352, 7354, 7356, 7357, 7361); `SQLite.get` (7321); `SQLite.prepare` (7321, 7327, 7328); `Store.container` (7330) | CORE |
| [packages/store/src/store.ts:7370](../../packages/store/src/store.ts#L7370) `Store/moveContainersIn` | `Store.sql` (7370, 7375, 7377, 7378, 7379, 7380, 7399, 7402, 7409, 7412, 7415, 7422); `SQLite.prepare` (7377, 7378, 7379, 7380, 7409, 7415); `SQLite.get` (7382, 7409, 7415) | CORE |
| [packages/store/src/store.ts:7434](../../packages/store/src/store.ts#L7434) `Store/compactFile` | `Store.sql` (7434, 7435, 7436) | CORE |
| [packages/store/src/store.ts:7442](../../packages/store/src/store.ts#L7442) `Store/containerId` | `Store.containerId` (7442); `Store.row` (7443) | CORE |
| [packages/store/src/store.ts:7465](../../packages/store/src/store.ts#L7465) `Store/checkContainerWrite` | `Store.row` (7465) | CORE |
| [packages/store/src/store.ts:7478](../../packages/store/src/store.ts#L7478) `Store/setContainer` | `Store.sql` (7478, 7492, 7497, 7500, 7500); `Store.row` (7481); `SQLite.prepare` (7492) | CORE |
| [packages/store/src/store.ts:7534](../../packages/store/src/store.ts#L7534) `Store/orderBy` | `Store.valueListItems` (7534) | CORE |
| [packages/store/src/store.ts:7557](../../packages/store/src/store.ts#L7557) `Store/userPrefs` | `SQLite.all` (7557); `SQLite.prepare` (7557); `Store.sql` (7557) | CORE |
| [packages/store/src/store.ts:7562](../../packages/store/src/store.ts#L7562) `Store/hasTable` | `SQLite.get` (7562); `SQLite.prepare` (7562); `Store.sql` (7562) | CORE |
| [packages/store/src/store.ts:7566](../../packages/store/src/store.ts#L7566) `Store/setUserPref` | `Store.sql` (7566, 7567, 7568); `SQLite.prepare` (7567, 7568) | CORE |
| [packages/store/src/store.ts:7574](../../packages/store/src/store.ts#L7574) `Store/indexedFields` | `SQLite.all` (7574, 7575); `SQLite.prepare` (7574, 7575); `Store.sql` (7574, 7575) | CORE |
| [packages/store/src/store.ts:7596](../../packages/store/src/store.ts#L7596) `Store/addFieldIndex` | `Store.sql` (7596) | CORE |
| [packages/store/src/store.ts:7608](../../packages/store/src/store.ts#L7608) `Store/dropFieldIndex` | `SQLite.get` (7608); `SQLite.prepare` (7608); `Store.sql` (7608, 7609) | CORE |
| [packages/store/src/store.ts:7619](../../packages/store/src/store.ts#L7619) `Store/timeFind` | `Store.query` (7619, 7623, 7624); `Store.recordCount` (7626) | CORE |
| [packages/store/src/store.ts:7643](../../packages/store/src/store.ts#L7643) `Store/find` | `Store.find` (7643) | GATED-STORE |
| [packages/store/src/store.ts:7654](../../packages/store/src/store.ts#L7654) `Store/findHere` | `Store.query` (7654, 7659, 7661, 7675, 7677, 7687); `Store.recordCount` (7672); `SQLite.get` (7673, 7677); `SQLite.prepare` (7673, 7677, 7682, 7689, 7698); `Store.sql` (7673, 7677, 7682, 7689, 7698); `SQLite.all` (7682, 7689, 7698) | GATED-STORE |
| [packages/store/src/store.ts:7693](../../packages/store/src/store.ts#L7693) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7693); `SQLite.prepare` (7693); `Store.sql` (7693) | GATED-STORE |
| [packages/store/src/store.ts:7726](../../packages/store/src/store.ts#L7726) `Store/sortedPage` | `SQLite.iterate` (7726); `SQLite.prepare` (7726, 7741); `Store.sql` (7726, 7741); `SQLite.all` (7741) | CORE |
| [packages/store/src/store.ts:7798](../../packages/store/src/store.ts#L7798) `Store/relatedCriteria/matched` | `relatedRows` (7798) | CORE |
| [packages/store/src/store.ts:7801](../../packages/store/src/store.ts#L7801) `Store/relatedCriteria` | `SQLite.iterate` (7801); `SQLite.prepare` (7801); `Store.sql` (7801) | CORE |
| [packages/store/src/store.ts:7827](../../packages/store/src/store.ts#L7827) `Store/computedRows` | `Store.sql` (7827, 7830, 7831, 7832, 7834, 7844, 7845, 7846, 7849); `SQLite.prepare` (7830, 7832, 7834, 7844); `SQLite.iterate` (7834); `Calculations.globalValue` (7837); `Calculations.unstoredValue` (7838); `Calculations.related` (7841); `SQLite.all` (7844) | CORE |
| [packages/store/src/store.ts:7874](../../packages/store/src/store.ts#L7874) `Store/summaries` | `Calculations.wholeTable` (7874); `Calculations.collect` (7894, 7899) | CORE |
| [packages/store/src/store.ts:7890](../../packages/store/src/store.ts#L7890) `Store/summaries/recs` | `SQLite.iterate` (7890); `SQLite.prepare` (7890); `Store.sql` (7890) | CORE |
| [packages/store/src/store.ts:7912](../../packages/store/src/store.ts#L7912) `Store/runningSummaryValues` | `Store.viewableIds` (7912); `rowsById` (7914); `Calculations.value` (7925, 7931); `Calculations.related` (7942) | GATED-STORE |
| [packages/store/src/store.ts:7955](../../packages/store/src/store.ts#L7955) `Store/findSource` | `Store.query` (7955); `Store.sql` (7962, 7963, 7967, 7969, 7980, 7982); `SQLite.prepare` (7963, 7969); `SQLite.iterate` (7969); `Calculations.globalValue` (7973); `Calculations.unstoredValue` (7974); `Calculations.related` (7978) | CORE |
| [packages/store/src/store.ts:8001](../../packages/store/src/store.ts#L8001) `Store/previewRow` | `Store.row` (8001) | CORE |
| [packages/store/src/store.ts:8019](../../packages/store/src/store.ts#L8019) `Store/row` | `SQLite.get` (8019) | CORE |
| [packages/store/src/store.ts:8038](../../packages/store/src/store.ts#L8038) `Store/getCurrent` | `Store.get` (8038); `Store.row` (8039, 8039, 8053); `SQLite.all` (8056); `SQLite.prepare` (8056); `Store.sql` (8056) | GATED-STORE |
| [packages/store/src/store.ts:8076](../../packages/store/src/store.ts#L8076) `Store/getManyCurrent` | `Store.getMany` (8076); `SQLite.get` (8094); `SQLite.prepare` (8094); `Store.sql` (8094) | GATED-STORE |
| [packages/store/src/store.ts:8087](../../packages/store/src/store.ts#L8087) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8087) | GATED-STORE |
| [packages/store/src/store.ts:8110](../../packages/store/src/store.ts#L8110) `Store/canViewRecord` | `SQLite.get` (8110); `SQLite.prepare` (8110); `Store.sql` (8110) | GATED-STORE |
| [packages/store/src/store.ts:8118](../../packages/store/src/store.ts#L8118) `Store/canView` | `Store.canView` (8118); `Store.row` (8119) | GATED-STORE |
| [packages/store/src/store.ts:8143](../../packages/store/src/store.ts#L8143) `Store/create` | `SQLite.get` (8143, 8149); `SQLite.prepare` (8143, 8149, 8161); `Store.sql` (8143, 8149, 8161) | CORE |
| [packages/store/src/store.ts:8185](../../packages/store/src/store.ts#L8185) `Store/duplicate` | `Store.row` (8185); `SQLite.get` (8189); `SQLite.prepare` (8189, 8203); `Store.sql` (8189, 8203) | CORE |
| [packages/store/src/store.ts:8248](../../packages/store/src/store.ts#L8248) `Store/update` | `Store.row` (8248, 8255, 8266); `Store.sql` (8279, 8280, 8317, 8320) | CORE |
| [packages/store/src/store.ts:8282](../../packages/store/src/store.ts#L8282) `Store/update/undo` | `Store.sql` (8282) | CORE |
| [packages/store/src/store.ts:8424](../../packages/store/src/store.ts#L8424) `Store/setStoredCalcValues` | `SQLite.prepare` (8424, 8425); `Store.sql` (8424, 8425); `SQLite.get` (8429) | CORE |
| [packages/store/src/store.ts:8503](../../packages/store/src/store.ts#L8503) `Store/evaluateCurrent` | `Store.row` (8503, 8503); `Calculations.context` (8504); `Store.get` (8505, 8507) | GATED-STORE |
| [packages/store/src/store.ts:8539](../../packages/store/src/store.ts#L8539) `Store/evaluateEachCurrent` | `Store.row` (8539, 8539); `Calculations.context` (8544); `Store.get` (8546) | GATED-STORE |
| [packages/store/src/store.ts:8579](../../packages/store/src/store.ts#L8579) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8579); `Store.get` (8581) | GATED-STORE |
| [packages/store/src/store.ts:8600](../../packages/store/src/store.ts#L8600) `Store/evaluateRowsCurrent` | `Store.row` (8600, 8600) | GATED-STORE |
| [packages/store/src/store.ts:8614](../../packages/store/src/store.ts#L8614) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8614) | GATED-STORE |
| [packages/store/src/store.ts:8636](../../packages/store/src/store.ts#L8636) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8636) | GATED-STORE |
| [packages/store/src/store.ts:8674](../../packages/store/src/store.ts#L8674) `Store/updateRelated` | `relatedRows` (8674) | CORE |
| [packages/store/src/store.ts:8692](../../packages/store/src/store.ts#L8692) `Store/updatePortals` | `Store.row` (8692, 8727); `relatedRows` (8728) | CORE |
| [packages/store/src/store.ts:8701](../../packages/store/src/store.ts#L8701) `Store/updatePortals/portal/related` | `relatedIdList` (8701) | CORE |
| [packages/store/src/store.ts:8783](../../packages/store/src/store.ts#L8783) `Store/portalContainerTarget` | `Store.row` (8783); `relatedIdList` (8784) | CORE |
| [packages/store/src/store.ts:8797](../../packages/store/src/store.ts#L8797) `Store/checkEditable` | `Store.row` (8797) | CORE |
| [packages/store/src/store.ts:8820](../../packages/store/src/store.ts#L8820) `Store/delete` | `Store.row` (8820); `SQLite.get` (8825); `SQLite.prepare` (8825, 8827); `Store.sql` (8825, 8827) | CORE |
| [packages/store/src/store.ts:8848](../../packages/store/src/store.ts#L8848) `Store/vaultHeld` | `SQLite.get` (8848); `SQLite.prepare` (8848); `Store.sql` (8848) | CORE |
| [packages/store/src/store.ts:8855](../../packages/store/src/store.ts#L8855) `Store/forgetStandInValues` | `Store.sql` (8855, 8876); `SQLite.prepare` (8876) | CORE |
| [packages/store/src/store.ts:8890](../../packages/store/src/store.ts#L8890) `Store/restoreDeletedRow` | `SQLite.get` (8890); `SQLite.prepare` (8890, 8891, 8894); `Store.sql` (8890, 8891, 8894); `SQLite.all` (8891) | CORE |
| [packages/store/src/store.ts:8918](../../packages/store/src/store.ts#L8918) `Store/cascadeDelete` | `relatedRows` (8918) | CORE |
| [packages/store/src/store.ts:9008](../../packages/store/src/store.ts#L9008) `Store/selectIdsCurrent` | `Store.selectIds` (9008); `SQLite.all` (9014); `SQLite.prepare` (9014); `Store.sql` (9014) | GATED-STORE |
| [packages/store/src/store.ts:9022](../../packages/store/src/store.ts#L9022) `Store/countIds` | `Store.countIds` (9022); `SQLite.get` (9026); `SQLite.prepare` (9026); `Store.sql` (9026) | GATED-STORE |
| [packages/store/src/store.ts:9042](../../packages/store/src/store.ts#L9042) `Store/computeValuesCurrent` | `Store.computeValues` (9042); `Store.sql` (9048, 9052); `SQLite.all` (9052); `SQLite.prepare` (9052) | GATED-STORE |
| [packages/store/src/store.ts:9067](../../packages/store/src/store.ts#L9067) `Store/findIdsCurrent` | `Store.findIds` (9067) | GATED-STORE |
| [packages/store/src/store.ts:9073](../../packages/store/src/store.ts#L9073) `Store/findIdsHere` | `Store.query` (9073, 9078, 9080); `SQLite.iterate` (9091); `SQLite.prepare` (9091); `Store.sql` (9091) | GATED-STORE |
| [packages/store/src/store.ts:9108](../../packages/store/src/store.ts#L9108) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9108); `Store.viewableIds` (9113); `Calculations.collect` (9129); `rowsById` (9129, 9179); `Calculations.collector` (9151) | GATED-STORE |
| [packages/store/src/store.ts:9141](../../packages/store/src/store.ts#L9141) `Store/groupSummariesCurrent/key` | `Calculations.value` (9141); `Calculations.related` (9143) | GATED-STORE |
| [packages/store/src/store.ts:9177](../../packages/store/src/store.ts#L9177) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9177) | GATED-STORE |
| [packages/store/src/store.ts:9233](../../packages/store/src/store.ts#L9233) `Store/sortIdsCurrentProgress` | `SQLite.all` (9233); `SQLite.prepare` (9233, 9301); `Store.sql` (9233, 9301); `Store.valueListItems` (9241); `rowsById` (9253); `Calculations.globalValue` (9256); `Calculations.unstoredValue` (9257); `Calculations.related` (9263); `SQLite.iterate` (9301) | GATED-STORE |
| [packages/store/src/store.ts:9315](../../packages/store/src/store.ts#L9315) `Store/matchIds` | `Store.matchIds` (9315); `SQLite.all` (9321); `SQLite.prepare` (9321); `Store.sql` (9321) | CORE |
| [packages/store/src/store.ts:9339](../../packages/store/src/store.ts#L9339) `Store/truncate` | `Store.sql` (9339, 9341, 9348, 9349, 9351, 9352); `SQLite.prepare` (9341, 9348); `SQLite.all` (9343) | CORE |
| [packages/store/src/store.ts:9373](../../packages/store/src/store.ts#L9373) `Store/iterateCommitted` | `SQLite.iterate` (9373) | CORE |
| [packages/store/src/store.ts:9407](../../packages/store/src/store.ts#L9407) `Store/readOnlyChecked` | `SQLite.prepare` (9407, 9411, 9420, 9425); `SQLite.all` (9411, 9420, 9425) | CORE |
| [packages/store/src/store.ts:9447](../../packages/store/src/store.ts#L9447) `Store/refreshDecimalSqlViews` | `SQLite.get` (9447); `SQLite.prepare` (9447, 9452); `SQLite.all` (9452) | CORE |
| [packages/store/src/store.ts:9466](../../packages/store/src/store.ts#L9466) `Store/internalRoots` | `SQLite.get` (9466); `SQLite.prepare` (9466, 9468); `SQLite.all` (9468) | CORE |
| [packages/store/src/store.ts:9501](../../packages/store/src/store.ts#L9501) `Store/selectCurrent` | `SQLite.iterate` (9501) | CORE |
| [packages/store/src/store.ts:9550](../../packages/store/src/store.ts#L9550) `Store/query` | `SQLite.iterate` (9550) | CORE |
| [packages/store/src/store.ts:9584](../../packages/store/src/store.ts#L9584) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9584); `SQLite.all` (9591, 9594); `SQLite.prepare` (9591, 9594) | CORE |
| [packages/store/src/store.ts:1183](../../packages/store/src/store.ts#L1183) `Store/ensureNativeIds` | `SQLite.all` (1183, 1195); `SQLite.prepare` (1183, 1186, 1194, 1195); `Store.sql` (1183, 1186, 1189, 1193, 1194, 1195, 1198, 1200) | CORE |
| [packages/store/src/store.ts:1208](../../packages/store/src/store.ts#L1208) `Store/nativeIdGuards` | `Store.sql` (1208, 1209, 1211) | CORE |
| [packages/store/src/store.ts:9517](../../packages/store/src/store.ts#L9517) `Store/selectIn` | `Store.select` (9517) | CORE |
| [packages/store/src/store.ts:9525](../../packages/store/src/store.ts#L9525) `Store/selectHeldCurrent` | `Store.sql` (9525, 9526); `SQLite.prepare` (9526); `SQLite.iterate` (9529) | CORE |
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
| [packages/store/src/store.ts:1541](../../packages/store/src/store.ts#L1541) `Store/selfContainedCopy` | `Store.sql` (1541); `SQLite.all` (1546); `SQLite.prepare` (1546, 1548, 1549, 1550) | CORE |
| [packages/store/src/store.ts:6895](../../packages/store/src/store.ts#L6895) `Store/containerReferences` | `SQLite.all` (6895, 6913, 6915, 6921, 6934, 6945, 6959); `SQLite.prepare` (6895, 6913, 6915, 6921, 6934, 6945, 6957, 6959); `Store.sql` (6895, 6913, 6915, 6921, 6934, 6945, 6957, 6959); `SQLite.get` (6957); `Store.row` (6968) | CORE |
| [packages/store/src/store.ts:6992](../../packages/store/src/store.ts#L6992) `Store/containerIntegrityReport` | `SQLite.all` (6992); `SQLite.prepare` (6992, 7003); `Store.sql` (6992, 7003); `SQLite.get` (7003) | CORE |
<!-- end generated read-gate inventory -->
