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
| [packages/server/src/containers.ts:297](../../packages/server/src/containers.ts#L297) `ContainerFiles/make` | `Store.containerInfo` (297) | CONTAINER |
| [packages/server/src/containers.ts:309](../../packages/server/src/containers.ts#L309) `ContainerFiles/makeAdmitted` | `Store.container` (309) | CONTAINER |
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
| [packages/server/src/insight.ts:316](../../packages/server/src/insight.ts#L316) `webViewerScripts` | `Store.query` (316) | DESIGN |
| [packages/server/src/insight.ts:757](../../packages/server/src/insight.ts#L757) `layoutProfile/viewableIds` | `Store.viewableIds` (757) | PROFILE |
| [packages/server/src/insight.ts:761](../../packages/server/src/insight.ts#L761) `layoutProfile` | `Store.query` (761) | PROFILE |
| [packages/server/src/insight.ts:837](../../packages/server/src/insight.ts#L837) `columnProfile` | `Store.query` (837, 844, 856, 859) | PROFILE |
| [packages/server/src/insight.ts:916](../../packages/server/src/insight.ts#L916) `checkCalculation` | `Store.findIds` (916); `Store.evaluate` (920) | DESIGN |
| [packages/server/src/insight.ts:1099](../../packages/server/src/insight.ts#L1099) `solutionOverview/counts` | `Store.query` (1099) | DESIGN |
| [packages/server/src/live.ts:137](../../packages/server/src/live.ts#L137) `Live/handle` | `Store.canViewRecord` (137, 144); `Store.canView` (189) | LIVE |
| [packages/server/src/live.ts:291](../../packages/server/src/live.ts#L291) `Live/stream/listener` | `Store.canViewRecord` (291, 293) | LIVE |
| [packages/server/src/logs.ts:76](../../packages/server/src/logs.ts#L76) `LogShipper/follow` | `SQLite.get` (76); `SQLite.prepare` (76); `Store.sql` (76, 77, 78, 79) | ADMIN |
| [packages/server/src/logs.ts:88](../../packages/server/src/logs.ts#L88) `LogShipper/releaseIfIdle` | `Store.sql` (88) | ADMIN |
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
| [packages/store/src/calc.ts:1702](../../packages/store/src/calc.ts#L1702) `Calculations/columnNames` | `SQLite.all` (1702); `SQLite.prepare` (1702); `Store.sql` (1702) | CALC |
| [packages/store/src/calc.ts:1713](../../packages/store/src/calc.ts#L1713) `Calculations/statement` | `SQLite.prepare` (1713); `Store.sql` (1713) | CALC |
| [packages/store/src/calc.ts:1727](../../packages/store/src/calc.ts#L1727) `Calculations/ensureIndex` | `Store.sql` (1727, 1728) | CALC |
| [packages/store/src/calc.ts:1753](../../packages/store/src/calc.ts#L1753) `Calculations/context/records` | `Calculations.firstRelated` (1753) | CALC |
| [packages/store/src/calc.ts:1771](../../packages/store/src/calc.ts#L1771) `Calculations/context/field` | `Calculations.summary` (1771); `Calculations.globalValue` (1774); `Calculations.value` (1775) | CALC |
| [packages/store/src/calc.ts:1784](../../packages/store/src/calc.ts#L1784) `Calculations/context/related` | `Calculations.globalValue` (1784); `Calculations.value` (1786, 1797); `Calculations.related` (1799) | CALC |
| [packages/store/src/calc.ts:1819](../../packages/store/src/calc.ts#L1819) `Calculations/context/lookupNext` | `Store.canViewRecord` (1819) | CALC |
| [packages/store/src/calc.ts:1834](../../packages/store/src/calc.ts#L1834) `Calculations/context/summary` | `Calculations.value` (1834, 1844); `Calculations.related` (1846); `Calculations.summary` (1864) | CALC |
| [packages/store/src/calc.ts:1894](../../packages/store/src/calc.ts#L1894) `Calculations/context/get` | `Store.recordCount` (1894, 1898); `Calculations.statement` (1897); `SQLite.get` (1897) | CALC |
| [packages/store/src/calc.ts:1917](../../packages/store/src/calc.ts#L1917) `Calculations/context/executeSQL` | `Calculations.executeSQL` (1917) | CALC |
| [packages/store/src/calc.ts:1918](../../packages/store/src/calc.ts#L1918) `Calculations/context/persistentData` | `Store.persistentData` (1918) | CALC |
| [packages/store/src/calc.ts:1919](../../packages/store/src/calc.ts#L1919) `Calculations/context/persistentDataIds` | `Store.persistentDataIds` (1919) | CALC |
| [packages/store/src/calc.ts:1944](../../packages/store/src/calc.ts#L1944) `Calculations/design` | `Store.valueListItems` (1944) | CALC |
| [packages/store/src/calc.ts:1961](../../packages/store/src/calc.ts#L1961) `Calculations/executeSQL` | `Calculations.translateSQL` (1961); `Store.select` (1999); `Store.sql` (2010) | CALC |
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
| [packages/store/src/calc.ts:2755](../../packages/store/src/calc.ts#L2755) `containerValue` | `Store.containerInfo` (2755); `Store.containerRange` (2762); `Store.container` (2763) | CALC |
| [packages/store/src/calc.ts:2771](../../packages/store/src/calc.ts#L2771) `containerValue/read` | `Store.container` (2771) | CALC |
| [packages/store/src/calc.ts:2784](../../packages/store/src/calc.ts#L2784) `containerValue/value` | `Store.containerRange` (2784) | CALC |
| [packages/store/src/calc.ts:2902](../../packages/store/src/calc.ts#L2902) `sameValuesElsewhere` | `SQLite.all` (2902); `SQLite.prepare` (2902, 2909, 2911); `Store.sql` (2902, 2909, 2911); `Calculations.value` (2904); `SQLite.get` (2909, 2911) | CALC |
| [packages/store/src/calc.ts:3215](../../packages/store/src/calc.ts#L3215) `rowsById/flush` | `Calculations.statement` (3215); `SQLite.iterate` (3215) | CALC |
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
| [packages/store/src/privileges.ts:519](../../packages/store/src/privileges.ts#L519) `privilegeSets` | `SQLite.all` (519); `SQLite.prepare` (519) | AUTH |
| [packages/store/src/privileges.ts:547](../../packages/store/src/privileges.ts#L547) `ensurePrivilegeTables` | `SQLite.all` (547); `SQLite.prepare` (547) | AUTH |
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
| [packages/store/src/store.ts:886](../../packages/store/src/store.ts#L886) `Store/metadataVersions` | `SQLite.get` (886); `SQLite.prepare` (886); `Store.sql` (886) | CORE |
| [packages/store/src/store.ts:1024](../../packages/store/src/store.ts#L1024) `Store/constructor` | `Store.sql` (1024, 1026, 1028, 1029, 1033, 1037, 1038, 1049, 1054, 1059, 1060, 1064, 1065, 1066, 1073, 1077, 1081, 1082, 1083, 1088, 1092, 1095, 1096, 1098, 1099, 1102, 1103, 1107, 1108, 1112, 1113, 1116, 1118, 1121, 1122, 1126, 1127, 1131, 1132, 1135, 1136, 1137, 1140, 1141, 1144, 1145, 1147, 1147, 1148, 1148, 1149, 1152, 1156, 1158, 1161, 1162, 1163, 1166, 1167, 1169, 1171, 1172, 1176, 1177, 1179, 1183, 1184, 1185, 1185, 1189, 1190); `SQLite.get` (1028); `SQLite.prepare` (1028, 1095, 1096, 1099, 1102, 1107, 1112, 1121, 1126, 1131, 1140, 1144, 1147, 1148, 1166, 1171, 1176); `SQLite.all` (1095, 1102, 1107, 1112, 1121, 1126, 1131, 1140, 1144, 1147, 1148, 1166, 1171, 1176) | CORE |
| [packages/store/src/store.ts:1247](../../packages/store/src/store.ts#L1247) `Store/grantFullAccessClients` | `SQLite.prepare` (1247); `Store.sql` (1247) | CORE |
| [packages/store/src/store.ts:1264](../../packages/store/src/store.ts#L1264) `Store/meta` | `SQLite.get` (1264); `SQLite.prepare` (1264); `Store.sql` (1264) | CORE |
| [packages/store/src/store.ts:3383](../../packages/store/src/store.ts#L3383) `Store/webViewerChecked` | `SQLite.get` (3383); `SQLite.prepare` (3383); `Store.sql` (3383) | CORE |
| [packages/store/src/store.ts:1272](../../packages/store/src/store.ts#L1272) `Store/persistentTable` | `Store.sql` (1272) | CORE |
| [packages/store/src/store.ts:1282](../../packages/store/src/store.ts#L1282) `Store/persistentData` | `SQLite.get` (1282) | CORE |
| [packages/store/src/store.ts:1291](../../packages/store/src/store.ts#L1291) `Store/persistentDataIds` | `SQLite.all` (1291) | CORE |
| [packages/store/src/store.ts:1297](../../packages/store/src/store.ts#L1297) `Store/setPersistentData` | `SQLite.prepare` (1297, 1301); `Store.sql` (1297, 1301) | CORE |
| [packages/store/src/store.ts:1314](../../packages/store/src/store.ts#L1314) `Store/checkpoint` | `SQLite.get` (1314); `SQLite.prepare` (1314); `Store.sql` (1314) | CORE |
| [packages/store/src/store.ts:1322](../../packages/store/src/store.ts#L1322) `Store/recordedFormat` | `Store.sql` (1322) | CORE |
| [packages/store/src/store.ts:1332](../../packages/store/src/store.ts#L1332) `Store/close` | `Store.sql` (1332) | CORE |
| [packages/store/src/store.ts:1348](../../packages/store/src/store.ts#L1348) `Store/shipWal` | `Store.sql` (1348) | CORE |
| [packages/store/src/store.ts:1359](../../packages/store/src/store.ts#L1359) `Store/trial` | `Store.sql` (1359) | CORE |
| [packages/store/src/store.ts:1364](../../packages/store/src/store.ts#L1364) `Store/trial/undo` | `Store.sql` (1364) | CORE |
| [packages/store/src/store.ts:1399](../../packages/store/src/store.ts#L1399) `Store/joinTransaction` | `Store.sql` (1399, 1400, 1402, 1404, 1410) | CORE |
| [packages/store/src/store.ts:1422](../../packages/store/src/store.ts#L1422) `Store/independentWindowWrite` | `SQLite.get` (1422); `SQLite.prepare` (1422, 1445); `Store.sql` (1422, 1425, 1440, 1445, 1448) | CORE |
| [packages/store/src/store.ts:1470](../../packages/store/src/store.ts#L1470) `Store/withWriteTransaction` | `Store.sql` (1470, 1473, 1477, 1479, 1479) | CORE |
| [packages/store/src/store.ts:1509](../../packages/store/src/store.ts#L1509) `Store/endTransaction` | `Store.sql` (1509, 1512, 1512) | CORE |
| [packages/store/src/store.ts:1538](../../packages/store/src/store.ts#L1538) `Store/backup` | `Store.sql` (1538) | CORE |
| [packages/store/src/store.ts:1628](../../packages/store/src/store.ts#L1628) `Store/dataVersion` | `SQLite.get` (1628); `SQLite.prepare` (1628); `Store.sql` (1628) | CORE |
| [packages/store/src/store.ts:1668](../../packages/store/src/store.ts#L1668) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1668) | CORE |
| [packages/store/src/store.ts:1689](../../packages/store/src/store.ts#L1689) `Store/shareResults` | `Store.sql` (1689) | CORE |
| [packages/store/src/store.ts:1699](../../packages/store/src/store.ts#L1699) `Store/versionTriggers` | `SQLite.get` (1699); `SQLite.prepare` (1699, 1704, 1705); `Store.sql` (1699, 1701, 1702, 1704, 1705, 1714, 1715); `SQLite.all` (1704, 1705) | CORE |
| [packages/store/src/store.ts:1731](../../packages/store/src/store.ts#L1731) `Store/versionNumber` | `SQLite.get` (1731); `SQLite.prepare` (1731); `Store.sql` (1731) | CORE |
| [packages/store/src/store.ts:1744](../../packages/store/src/store.ts#L1744) `Store/changeOne` | `Store.sql` (1744, 1746) | CORE |
| [packages/store/src/store.ts:1747](../../packages/store/src/store.ts#L1747) `Store/changeOne/read` | `SQLite.get` (1747); `SQLite.prepare` (1747); `Store.sql` (1747) | CORE |
| [packages/store/src/store.ts:1786](../../packages/store/src/store.ts#L1786) `Store/writeToken` | `SQLite.get` (1786); `SQLite.prepare` (1786); `Store.sql` (1786) | CORE |
| [packages/store/src/store.ts:1798](../../packages/store/src/store.ts#L1798) `Store/recordCount` | `SQLite.get` (1798); `SQLite.prepare` (1798); `Store.sql` (1798) | CORE |
| [packages/store/src/store.ts:1910](../../packages/store/src/store.ts#L1910) `Store/applyDesign` | `Store.sql` (1910, 1911, 1924, 1927, 1932, 1948, 1951, 1951); `SQLite.prepare` (1927, 1932) | CORE |
| [packages/store/src/store.ts:2009](../../packages/store/src/store.ts#L2009) `Store/auditLog` | `SQLite.all` (2009); `SQLite.prepare` (2009); `Store.sql` (2009) | CORE |
| [packages/store/src/store.ts:2049](../../packages/store/src/store.ts#L2049) `Store/securityEvents` | `Store.auditLog` (2049) | CORE |
| [packages/store/src/store.ts:2075](../../packages/store/src/store.ts#L2075) `Store/prepared` | `SQLite.prepare` (2075); `Store.sql` (2075) | CORE |
| [packages/store/src/store.ts:2090](../../packages/store/src/store.ts#L2090) `Store/recordAsOf` | `SQLite.get` (2090, 2092); `SQLite.prepare` (2090, 2092, 2094, 2095); `Store.sql` (2090, 2092, 2094, 2095); `SQLite.all` (2094, 2095) | CORE |
| [packages/store/src/store.ts:2124](../../packages/store/src/store.ts#L2124) `Store/restoreRecord/run` | `Store.recordAsOf` (2124); `SQLite.get` (2128); `SQLite.prepare` (2128, 2132, 2141, 2152); `Store.sql` (2128, 2132, 2141, 2152) | CORE |
| [packages/store/src/store.ts:2168](../../packages/store/src/store.ts#L2168) `Store/revertAuditEntry` | `Store.auditLog` (2168) | CORE |
| [packages/store/src/store.ts:2261](../../packages/store/src/store.ts#L2261) `Store/setAuditSettings` | `SQLite.prepare` (2261); `Store.sql` (2261) | CORE |
| [packages/store/src/store.ts:2283](../../packages/store/src/store.ts#L2283) `Store/pruneAudit` | `Store.sql` (2283, 2285, 2287); `SQLite.get` (2285); `SQLite.prepare` (2285) | CORE |
| [packages/store/src/store.ts:2365](../../packages/store/src/store.ts#L2365) `Store/audit` | `Store.sql` (2365) | CORE |
| [packages/store/src/store.ts:2454](../../packages/store/src/store.ts#L2454) `Store/securityChange` | `Store.sql` (2454, 2456); `SQLite.prepare` (2456) | CORE |
| [packages/store/src/store.ts:2503](../../packages/store/src/store.ts#L2503) `Store/logSecurity` | `Store.sql` (2503) | CORE |
| [packages/store/src/store.ts:2526](../../packages/store/src/store.ts#L2526) `Store/ensureDeleted` | `Store.sql` (2526) | CORE |
| [packages/store/src/store.ts:2531](../../packages/store/src/store.ts#L2531) `Store/deletedRows` | `SQLite.get` (2531); `SQLite.prepare` (2531, 2533, 2533); `Store.sql` (2531, 2533, 2533); `SQLite.all` (2533, 2533) | CORE |
| [packages/store/src/store.ts:2557](../../packages/store/src/store.ts#L2557) `Store/emptyDeleted` | `Store.sql` (2557, 2560, 2561, 2563, 2565); `SQLite.prepare` (2561) | CORE |
| [packages/store/src/store.ts:2572](../../packages/store/src/store.ts#L2572) `Store/designHistory` | `SQLite.all` (2572); `SQLite.prepare` (2572); `Store.sql` (2572) | CORE |
| [packages/store/src/store.ts:2579](../../packages/store/src/store.ts#L2579) `Store/scriptHistory` | `SQLite.all` (2579); `SQLite.prepare` (2579); `Store.sql` (2579) | CORE |
| [packages/store/src/store.ts:2589](../../packages/store/src/store.ts#L2589) `Store/layoutHistory` | `SQLite.all` (2589); `SQLite.prepare` (2589); `Store.sql` (2589) | CORE |
| [packages/store/src/store.ts:2614](../../packages/store/src/store.ts#L2614) `Store/designEffect/renameKey` | `SQLite.prepare` (2614); `Store.sql` (2614) | CORE |
| [packages/store/src/store.ts:2630](../../packages/store/src/store.ts#L2630) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2630); `Store.sql` (2630) | CORE |
| [packages/store/src/store.ts:2637](../../packages/store/src/store.ts#L2637) `Store/designEffect` | `Store.sql` (2637, 2642, 2647, 2652, 2655, 2661, 2669, 2670, 2672, 2684, 2685, 2688, 2690, 2696, 2697, 2698, 2703, 2705, 2709, 2712, 2713, 2715, 2718, 2723, 2725, 2732, 2733, 2735, 2736, 2737, 2738, 2745, 2746, 2748, 2748, 2750, 2751, 2752, 2756, 2760, 2762, 2800, 2802, 2804); `SQLite.get` (2669, 2684, 2696, 2697, 2709, 2713, 2748, 2756); `SQLite.prepare` (2669, 2670, 2684, 2685, 2696, 2697, 2703, 2705, 2709, 2713, 2723, 2725, 2738, 2745, 2746, 2748, 2750, 2752, 2756, 2760); `SQLite.all` (2745, 2746); `SQLite.iterate` (2750) | CORE |
| [packages/store/src/store.ts:2812](../../packages/store/src/store.ts#L2812) `Store/dropColumnIndexes` | `SQLite.all` (2812, 2814); `SQLite.prepare` (2812, 2814); `Store.sql` (2812, 2814, 2815) | CORE |
| [packages/store/src/store.ts:2824](../../packages/store/src/store.ts#L2824) `Store/recompute` | `SQLite.prepare` (2824, 2828); `Store.sql` (2824, 2828); `SQLite.iterate` (2828); `Calculations.computeStoredStyled` (2829); `Calculations.value` (2829) | CORE |
| [packages/store/src/store.ts:2844](../../packages/store/src/store.ts#L2844) `Store/linkPrincipal` | `SQLite.get` (2844); `SQLite.prepare` (2844); `Store.sql` (2844) | CORE |
| [packages/store/src/store.ts:2851](../../packages/store/src/store.ts#L2851) `Store/linkIdentity` | `SQLite.get` (2851); `SQLite.prepare` (2851); `Store.sql` (2851) | CORE |
| [packages/store/src/store.ts:2857](../../packages/store/src/store.ts#L2857) `Store/accountsSharingLockout` | `SQLite.all` (2857); `SQLite.prepare` (2857); `Store.sql` (2857) | CORE |
| [packages/store/src/store.ts:2861](../../packages/store/src/store.ts#L2861) `Store/accounts` | `SQLite.all` (2861); `SQLite.prepare` (2861); `Store.sql` (2861) | CORE |
| [packages/store/src/store.ts:2873](../../packages/store/src/store.ts#L2873) `Store/isAgent` | `SQLite.get` (2873); `SQLite.prepare` (2873); `Store.sql` (2873) | CORE |
| [packages/store/src/store.ts:2879](../../packages/store/src/store.ts#L2879) `Store/agentNeedsApproval` | `SQLite.get` (2879); `SQLite.prepare` (2879); `Store.sql` (2879) | CORE |
| [packages/store/src/store.ts:2885](../../packages/store/src/store.ts#L2885) `Store/blankPasswordAccounts` | `SQLite.all` (2885); `SQLite.prepare` (2885); `Store.sql` (2885) | CORE |
| [packages/store/src/store.ts:1255](../../packages/store/src/store.ts#L1255) `Store/hasOwnPassword` | `SQLite.get` (1255); `SQLite.prepare` (1255); `Store.sql` (1255) | CORE |
| [packages/store/src/store.ts:2896](../../packages/store/src/store.ts#L2896) `Store/unmigratedAccounts` | `SQLite.all` (2896); `SQLite.prepare` (2896); `Store.sql` (2896) | CORE |
| [packages/store/src/store.ts:2949](../../packages/store/src/store.ts#L2949) `Store/setExternalAccount` | `SQLite.get` (2949); `SQLite.prepare` (2949, 2954); `Store.sql` (2949, 2954) | CORE |
| [packages/store/src/store.ts:2967](../../packages/store/src/store.ts#L2967) `Store/refuseLookalikeAccount` | `SQLite.all` (2967); `SQLite.prepare` (2967); `Store.sql` (2967) | CORE |
| [packages/store/src/store.ts:2976](../../packages/store/src/store.ts#L2976) `Store/isExternal` | `SQLite.get` (2976); `SQLite.prepare` (2976); `Store.sql` (2976) | CORE |
| [packages/store/src/store.ts:2997](../../packages/store/src/store.ts#L2997) `Store/setAgentAccount` | `SQLite.get` (2997); `SQLite.prepare` (2997, 3003); `Store.sql` (2997, 3003) | CORE |
| [packages/store/src/store.ts:3037](../../packages/store/src/store.ts#L3037) `Store/gateAgentWrite` | `SQLite.prepare` (3037); `Store.sql` (3037) | CORE |
| [packages/store/src/store.ts:3059](../../packages/store/src/store.ts#L3059) `Store/pendingChanges` | `SQLite.all` (3059); `SQLite.prepare` (3059); `Store.sql` (3059) | CORE |
| [packages/store/src/store.ts:3073](../../packages/store/src/store.ts#L3073) `Store/approvePending` | `SQLite.get` (3073); `SQLite.prepare` (3073, 3084); `Store.sql` (3073, 3084) | CORE |
| [packages/store/src/store.ts:3094](../../packages/store/src/store.ts#L3094) `Store/rejectPending` | `SQLite.get` (3094); `SQLite.prepare` (3094, 3096); `Store.sql` (3094, 3096) | CORE |
| [packages/store/src/store.ts:3116](../../packages/store/src/store.ts#L3116) `Store/externalAccount` | `SQLite.all` (3116); `SQLite.prepare` (3116); `Store.sql` (3116) | CORE |
| [packages/store/src/store.ts:3147](../../packages/store/src/store.ts#L3147) `Store/setPassword` | `SQLite.get` (3147); `SQLite.prepare` (3147, 3149, 3158); `Store.sql` (3147, 3149, 3158) | AUTH |
| [packages/store/src/store.ts:3172](../../packages/store/src/store.ts#L3172) `Store/createAccount` | `SQLite.get` (3172); `SQLite.prepare` (3172, 3176, 3182, 3187, 3192); `Store.sql` (3172, 3176, 3182, 3187, 3192) | CORE |
| [packages/store/src/store.ts:3200](../../packages/store/src/store.ts#L3200) `Store/appendSecurityEvent` | `Store.sql` (3200) | CORE |
| [packages/store/src/store.ts:3242](../../packages/store/src/store.ts#L3242) `Store/setPasswordPolicy` | `SQLite.prepare` (3242); `Store.sql` (3242) | CORE |
| [packages/store/src/store.ts:3278](../../packages/store/src/store.ts#L3278) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3278); `Store.sql` (3278) | CORE |
| [packages/store/src/store.ts:3301](../../packages/store/src/store.ts#L3301) `Store/saveScriptTest` | `SQLite.prepare` (3301); `Store.sql` (3301) | CORE |
| [packages/store/src/store.ts:3310](../../packages/store/src/store.ts#L3310) `Store/deleteScriptTest` | `SQLite.prepare` (3310); `Store.sql` (3310) | CORE |
| [packages/store/src/store.ts:3345](../../packages/store/src/store.ts#L3345) `Store/setAiAllowed` | `SQLite.prepare` (3345); `Store.sql` (3345) | CORE |
| [packages/store/src/store.ts:3412](../../packages/store/src/store.ts#L3412) `Store/setAiPolicy` | `SQLite.prepare` (3412); `Store.sql` (3412) | CORE |
| [packages/store/src/store.ts:3360](../../packages/store/src/store.ts#L3360) `Store/setScriptNetwork` | `SQLite.prepare` (3360); `Store.sql` (3360) | CORE |
| [packages/store/src/store.ts:3401](../../packages/store/src/store.ts#L3401) `Store/setWebViewerHosts` | `SQLite.prepare` (3401); `Store.sql` (3401) | CORE |
| [packages/store/src/store.ts:3432](../../packages/store/src/store.ts#L3432) `Store/setPiiIsolation` | `SQLite.prepare` (3432); `Store.sql` (3432) | CORE |
| [packages/store/src/store.ts:3454](../../packages/store/src/store.ts#L3454) `Store/markPiiField` | `SQLite.prepare` (3454); `Store.sql` (3454) | CORE |
| [packages/store/src/store.ts:3568](../../packages/store/src/store.ts#L3568) `Store/lastSignIns` | `Store.auditLog` (3568) | CORE |
| [packages/store/src/store.ts:3771](../../packages/store/src/store.ts#L3771) `Store/unusualAccess` | `Store.auditLog` (3771, 3837) | CORE |
| [packages/store/src/store.ts:3868](../../packages/store/src/store.ts#L3868) `Store/leastPrivilege` | `SQLite.all` (3868); `SQLite.prepare` (3868); `Store.sql` (3868) | CORE |
| [packages/store/src/store.ts:3941](../../packages/store/src/store.ts#L3941) `Store/unusedAccess` | `SQLite.get` (3941); `SQLite.prepare` (3941, 3950); `Store.sql` (3941, 3950); `SQLite.all` (3950) | CORE |
| [packages/store/src/store.ts:3989](../../packages/store/src/store.ts#L3989) `Store/unusedObjects` | `SQLite.get` (3989); `SQLite.prepare` (3989, 3992); `Store.sql` (3989, 3992); `SQLite.all` (3992) | CORE |
| [packages/store/src/store.ts:4027](../../packages/store/src/store.ts#L4027) `Store/usageCounting` | `SQLite.get` (4027); `SQLite.prepare` (4027); `Store.sql` (4027) | CORE |
| [packages/store/src/store.ts:4035](../../packages/store/src/store.ts#L4035) `Store/setMustChangePassword` | `SQLite.prepare` (4035); `Store.sql` (4035) | CORE |
| [packages/store/src/store.ts:4049](../../packages/store/src/store.ts#L4049) `Store/mustChangePassword` | `SQLite.get` (4049); `SQLite.prepare` (4049); `Store.sql` (4049) | CORE |
| [packages/store/src/store.ts:4088](../../packages/store/src/store.ts#L4088) `Store/passwordDaysRemaining` | `SQLite.get` (4088); `SQLite.prepare` (4088); `Store.sql` (4088) | CORE |
| [packages/store/src/store.ts:4095](../../packages/store/src/store.ts#L4095) `Store/importAccounts` | `SQLite.all` (4095); `SQLite.prepare` (4095); `Store.sql` (4095) | CORE |
| [packages/store/src/store.ts:4118](../../packages/store/src/store.ts#L4118) `Store/canonicalAccount` | `SQLite.all` (4118); `SQLite.prepare` (4118); `Store.sql` (4118) | CORE |
| [packages/store/src/store.ts:4130](../../packages/store/src/store.ts#L4130) `Store/createLocalAccount` | `SQLite.prepare` (4130); `Store.sql` (4130) | CORE |
| [packages/store/src/store.ts:4160](../../packages/store/src/store.ts#L4160) `Store/previewAccountImport` | `Store.sql` (4160, 4161, 4170) | CORE |
| [packages/store/src/store.ts:4178](../../packages/store/src/store.ts#L4178) `Store/limitAccountImport` | `SQLite.prepare` (4178, 4179, 4182); `Store.sql` (4178, 4179, 4182); `SQLite.get` (4179) | CORE |
| [packages/store/src/store.ts:4189](../../packages/store/src/store.ts#L4189) `Store/applyAccountImport` | `Store.sql` (4189, 4197, 4226); `SQLite.get` (4197); `SQLite.prepare` (4197, 4226) | CORE |
| [packages/store/src/store.ts:4251](../../packages/store/src/store.ts#L4251) `Store/forgetStandIns` | `SQLite.prepare` (4251); `Store.sql` (4251) | CORE |
| [packages/store/src/store.ts:4284](../../packages/store/src/store.ts#L4284) `Store/deleteAccount` | `SQLite.prepare` (4284, 4288, 4289, 4290, 4291, 4292, 4293, 4294, 4295, 4302, 4304, 4307, 4311); `Store.sql` (4284, 4288, 4289, 4290, 4291, 4292, 4293, 4294, 4295, 4302, 4304, 4307, 4311) | CORE |
| [packages/store/src/store.ts:4328](../../packages/store/src/store.ts#L4328) `Store/setAccountActive` | `SQLite.prepare` (4328, 4331, 4332); `Store.sql` (4328, 4331, 4332) | AUTH |
| [packages/store/src/store.ts:4342](../../packages/store/src/store.ts#L4342) `Store/accountInactive` | `SQLite.get` (4342); `SQLite.prepare` (4342); `Store.sql` (4342) | CORE |
| [packages/store/src/store.ts:4347](../../packages/store/src/store.ts#L4347) `Store/identityAllowed` | `SQLite.get` (4347, 4353, 4359); `SQLite.prepare` (4347, 4353, 4359); `Store.sql` (4347, 4353, 4359) | CORE |
| [packages/store/src/store.ts:4368](../../packages/store/src/store.ts#L4368) `Store/externalIdentityId` | `SQLite.get` (4368, 4374); `SQLite.prepare` (4368, 4373, 4374); `Store.sql` (4368, 4373, 4374) | CORE |
| [packages/store/src/store.ts:4379](../../packages/store/src/store.ts#L4379) `Store/accountIdentityId` | `SQLite.get` (4379, 4384); `SQLite.prepare` (4379, 4383, 4384); `Store.sql` (4379, 4383, 4384) | CORE |
| [packages/store/src/store.ts:4407](../../packages/store/src/store.ts#L4407) `Store/signInMark` | `SQLite.prepare` (4407); `Store.sql` (4407) | AUTH |
| [packages/store/src/store.ts:4417](../../packages/store/src/store.ts#L4417) `Store/signInBase` | `SQLite.get` (4417); `SQLite.prepare` (4417); `Store.sql` (4417) | AUTH |
| [packages/store/src/store.ts:4419](../../packages/store/src/store.ts#L4419) `Store/signInBase/identity` | `SQLite.get` (4419); `SQLite.prepare` (4419); `Store.sql` (4419) | AUTH |
| [packages/store/src/store.ts:4431](../../packages/store/src/store.ts#L4431) `Store/ledgerRow` | `SQLite.get` (4431, 4432); `SQLite.prepare` (4431, 4432); `Store.sql` (4431, 4432) | AUTH |
| [packages/store/src/store.ts:4443](../../packages/store/src/store.ts#L4443) `Store/ledgerWrite` | `Store.sql` (4443, 4444, 4446, 4448, 4451, 4451) | AUTH |
| [packages/store/src/store.ts:4470](../../packages/store/src/store.ts#L4470) `Store/settleSignIns` | `SQLite.all` (4470, 4476); `SQLite.prepare` (4470, 4476, 4482, 4486, 4488); `Store.sql` (4470, 4476, 4482, 4486, 4488) | AUTH |
| [packages/store/src/store.ts:4499](../../packages/store/src/store.ts#L4499) `Store/securityToken` | `SQLite.get` (4499); `SQLite.prepare` (4499); `Store.sql` (4499) | CORE |
| [packages/store/src/store.ts:4507](../../packages/store/src/store.ts#L4507) `Store/accountLocalOnly` | `SQLite.get` (4507); `SQLite.prepare` (4507); `Store.sql` (4507) | CORE |
| [packages/store/src/store.ts:4512](../../packages/store/src/store.ts#L4512) `Store/accountRequires2fa` | `SQLite.get` (4512); `SQLite.prepare` (4512); `Store.sql` (4512) | CORE |
| [packages/store/src/store.ts:4518](../../packages/store/src/store.ts#L4518) `Store/setAccountLocalOnly` | `SQLite.prepare` (4518); `Store.sql` (4518) | CORE |
| [packages/store/src/store.ts:4527](../../packages/store/src/store.ts#L4527) `Store/setAccountRequire2fa` | `SQLite.prepare` (4527); `Store.sql` (4527) | CORE |
| [packages/store/src/store.ts:4556](../../packages/store/src/store.ts#L4556) `Store/createApiToken` | `SQLite.get` (4556); `SQLite.prepare` (4556, 4586); `Store.sql` (4556, 4586) | CORE |
| [packages/store/src/store.ts:4633](../../packages/store/src/store.ts#L4633) `Store/recordObjectUse` | `Store.sql` (4633) | CORE |
| [packages/store/src/store.ts:4663](../../packages/store/src/store.ts#L4663) `Store/writeUsage` | `Store.sql` (4663, 4664, 4666, 4670, 4672) | CORE |
| [packages/store/src/store.ts:4679](../../packages/store/src/store.ts#L4679) `Store/writeUsageRows` | `SQLite.prepare` (4679, 4680, 4686); `Store.sql` (4679, 4680, 4686) | CORE |
| [packages/store/src/store.ts:4691](../../packages/store/src/store.ts#L4691) `Store/writeObjectUseRows` | `SQLite.prepare` (4691, 4692, 4697); `Store.sql` (4691, 4692, 4697) | CORE |
| [packages/store/src/store.ts:4702](../../packages/store/src/store.ts#L4702) `Store/objectUseSince` | `SQLite.get` (4702); `SQLite.prepare` (4702); `Store.sql` (4702) | CORE |
| [packages/store/src/store.ts:4715](../../packages/store/src/store.ts#L4715) `Store/accountUsage` | `SQLite.get` (4715); `SQLite.prepare` (4715, 4716); `Store.sql` (4715, 4716); `SQLite.all` (4716); `Store.auditLog` (4732) | CORE |
| [packages/store/src/store.ts:4748](../../packages/store/src/store.ts#L4748) `Store/apiTokens` | `SQLite.all` (4748); `SQLite.prepare` (4748); `Store.sql` (4748) | CORE |
| [packages/store/src/store.ts:4758](../../packages/store/src/store.ts#L4758) `Store/revokeApiToken` | `SQLite.prepare` (4758); `Store.sql` (4758) | CORE |
| [packages/store/src/store.ts:4772](../../packages/store/src/store.ts#L4772) `Store/apiToken` | `SQLite.get` (4772); `SQLite.prepare` (4772, 4784); `Store.sql` (4772, 4784) | CORE |
| [packages/store/src/store.ts:4800](../../packages/store/src/store.ts#L4800) `Store/enrollTotp` | `SQLite.prepare` (4800); `Store.sql` (4800) | CORE |
| [packages/store/src/store.ts:4811](../../packages/store/src/store.ts#L4811) `Store/confirmTotp` | `SQLite.get` (4811); `SQLite.prepare` (4811, 4813); `Store.sql` (4811, 4813) | CORE |
| [packages/store/src/store.ts:4821](../../packages/store/src/store.ts#L4821) `Store/hasTotp` | `SQLite.get` (4821); `SQLite.prepare` (4821); `Store.sql` (4821) | CORE |
| [packages/store/src/store.ts:4826](../../packages/store/src/store.ts#L4826) `Store/totpAccounts` | `SQLite.all` (4826); `SQLite.prepare` (4826); `Store.sql` (4826) | CORE |
| [packages/store/src/store.ts:4832](../../packages/store/src/store.ts#L4832) `Store/disableTotp` | `SQLite.prepare` (4832); `Store.sql` (4832) | CORE |
| [packages/store/src/store.ts:4855](../../packages/store/src/store.ts#L4855) `Store/verifyTotp` | `SQLite.get` (4855); `SQLite.prepare` (4855, 4861); `Store.sql` (4855, 4861) | CORE |
| [packages/store/src/store.ts:4874](../../packages/store/src/store.ts#L4874) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4874, 4876, 4877, 4879); `Store.sql` (4874, 4876, 4877, 4879); `SQLite.get` (4876) | CORE |
| [packages/store/src/store.ts:4926](../../packages/store/src/store.ts#L4926) `Store/passkeyAllowList` | `SQLite.all` (4926); `SQLite.prepare` (4926); `Store.sql` (4926) | CORE |
| [packages/store/src/store.ts:4940](../../packages/store/src/store.ts#L4940) `Store/takeWebauthnChallenge` | `SQLite.get` (4940); `SQLite.prepare` (4940, 4942); `Store.sql` (4940, 4942) | CORE |
| [packages/store/src/store.ts:4950](../../packages/store/src/store.ts#L4950) `Store/passkeys` | `SQLite.all` (4950); `SQLite.prepare` (4950); `Store.sql` (4950) | CORE |
| [packages/store/src/store.ts:4957](../../packages/store/src/store.ts#L4957) `Store/hasPasskey` | `SQLite.get` (4957); `SQLite.prepare` (4957); `Store.sql` (4957) | CORE |
| [packages/store/src/store.ts:4962](../../packages/store/src/store.ts#L4962) `Store/passkeyIds` | `SQLite.all` (4962); `SQLite.prepare` (4962); `Store.sql` (4962) | CORE |
| [packages/store/src/store.ts:4984](../../packages/store/src/store.ts#L4984) `Store/registerPasskey` | `SQLite.prepare` (4984); `Store.sql` (4984) | CORE |
| [packages/store/src/store.ts:4995](../../packages/store/src/store.ts#L4995) `Store/removePasskey` | `SQLite.get` (4995); `SQLite.prepare` (4995, 4996); `Store.sql` (4995, 4996) | CORE |
| [packages/store/src/store.ts:5012](../../packages/store/src/store.ts#L5012) `Store/verifyPasskeyAssertion` | `SQLite.get` (5012); `SQLite.prepare` (5012, 5023); `Store.sql` (5012, 5023) | CORE |
| [packages/store/src/store.ts:5059](../../packages/store/src/store.ts#L5059) `Store/generateRecoveryCodes` | `SQLite.prepare` (5059, 5062); `Store.sql` (5059, 5062) | CORE |
| [packages/store/src/store.ts:5077](../../packages/store/src/store.ts#L5077) `Store/recoveryCodesRemaining` | `SQLite.get` (5077); `SQLite.prepare` (5077); `Store.sql` (5077) | CORE |
| [packages/store/src/store.ts:5087](../../packages/store/src/store.ts#L5087) `Store/useRecoveryCode` | `SQLite.get` (5087); `SQLite.prepare` (5087, 5089); `Store.sql` (5087, 5089) | CORE |
| [packages/store/src/store.ts:5100](../../packages/store/src/store.ts#L5100) `Store/privilegeSets` | `Store.sql` (5100) | CORE |
| [packages/store/src/store.ts:5129](../../packages/store/src/store.ts#L5129) `Store/savePrivilegeSet` | `SQLite.prepare` (5129, 5137); `Store.sql` (5129, 5137) | AUTH |
| [packages/store/src/store.ts:5172](../../packages/store/src/store.ts#L5172) `Store/deletePrivilegeSet` | `SQLite.prepare` (5172); `Store.sql` (5172) | CORE |
| [packages/store/src/store.ts:5241](../../packages/store/src/store.ts#L5241) `Store/accountPrivilegeSet` | `SQLite.get` (5241); `SQLite.prepare` (5241); `Store.sql` (5241) | CORE |
| [packages/store/src/store.ts:5255](../../packages/store/src/store.ts#L5255) `Store/setAccountPrivilegeSet` | `SQLite.get` (5255); `SQLite.prepare` (5255, 5258, 5262); `Store.sql` (5255, 5258, 5262) | AUTH |
| [packages/store/src/store.ts:5277](../../packages/store/src/store.ts#L5277) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5277); `Store.sql` (5277) | CORE |
| [packages/store/src/store.ts:5291](../../packages/store/src/store.ts#L5291) `Store/addProvisionedAccount` | `SQLite.get` (5291); `SQLite.prepare` (5291, 5295); `Store.sql` (5291, 5295) | CORE |
| [packages/store/src/store.ts:5464](../../packages/store/src/store.ts#L5464) `Store/ruleOutcome` | `Calculations.context` (5464) | CORE |
| [packages/store/src/store.ts:5505](../../packages/store/src/store.ts#L5505) `Store/allowedIds` | `SQLite.iterate` (5505); `SQLite.prepare` (5505); `Store.sql` (5505) | CORE |
| [packages/store/src/store.ts:5575](../../packages/store/src/store.ts#L5575) `Store/scopedTableSql` | `Store.viewableIds` (5575); `SQLite.all` (5578); `SQLite.prepare` (5578); `Store.sql` (5578) | GATED-STORE |
| [packages/store/src/store.ts:5610](../../packages/store/src/store.ts#L5610) `Store/previewRecordRuleCurrent` | `SQLite.get` (5610); `SQLite.prepare` (5610, 5613); `Store.sql` (5610, 5613); `SQLite.all` (5613); `Calculations.context` (5619, 5635) | CORE |
| [packages/store/src/store.ts:5787](../../packages/store/src/store.ts#L5787) `Store/passwordHash` | `SQLite.get` (5787); `SQLite.prepare` (5787); `Store.sql` (5787) | CORE |
| [packages/store/src/store.ts:5816](../../packages/store/src/store.ts#L5816) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5816); `Store.sql` (5816) | CORE |
| [packages/store/src/store.ts:5829](../../packages/store/src/store.ts#L5829) `Store/knownSharedAccount` | `SQLite.get` (5829); `SQLite.prepare` (5829); `Store.sql` (5829) | CORE |
| [packages/store/src/store.ts:5892](../../packages/store/src/store.ts#L5892) `Store/layouts` | `SQLite.all` (5892); `SQLite.prepare` (5892); `Store.sql` (5892) | CORE |
| [packages/store/src/store.ts:5913](../../packages/store/src/store.ts#L5913) `Store/image` | `SQLite.get` (5913); `SQLite.prepare` (5913); `Store.sql` (5913) | CORE |
| [packages/store/src/store.ts:5923](../../packages/store/src/store.ts#L5923) `Store/images` | `SQLite.all` (5923); `SQLite.prepare` (5923); `Store.sql` (5923) | CORE |
| [packages/store/src/store.ts:5936](../../packages/store/src/store.ts#L5936) `Store/addImage` | `Store.sql` (5936, 5937); `SQLite.prepare` (5937) | CORE |
| [packages/store/src/store.ts:5953](../../packages/store/src/store.ts#L5953) `Store/layout` | `SQLite.get` (5953); `SQLite.prepare` (5953); `Store.sql` (5953) | CORE |
| [packages/store/src/store.ts:6157](../../packages/store/src/store.ts#L6157) `Store/wordIndex` | `Store.sql` (6157, 6165, 6170); `Store.recordCount` (6169); `SQLite.get` (6170); `SQLite.prepare` (6170) | CORE |
| [packages/store/src/store.ts:6222](../../packages/store/src/store.ts#L6222) `Store/toRecord` | `Calculations.value` (6222, 6232); `Calculations.globalValue` (6226); `Calculations.unstoredStyled` (6231) | CORE |
| [packages/store/src/store.ts:6281](../../packages/store/src/store.ts#L6281) `Store/relatedValues` | `Calculations.globalValue` (6281); `Calculations.unstoredValue` (6283) | CORE |
| [packages/store/src/store.ts:6355](../../packages/store/src/store.ts#L6355) `Store/addRelated` | `relatedRows` (6355); `rowsById` (6387); `firstRelatedEach` (6410) | CORE |
| [packages/store/src/store.ts:6438](../../packages/store/src/store.ts#L6438) `Store/foundSetPage` | `rowsById` (6438) | CORE |
| [packages/store/src/store.ts:6454](../../packages/store/src/store.ts#L6454) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6454); `Store.row` (6470) | GATED-STORE |
| [packages/store/src/store.ts:6493](../../packages/store/src/store.ts#L6493) `Store/portalCountsCurrent` | `Store.canView` (6493); `Store.row` (6520) | GATED-STORE |
| [packages/store/src/store.ts:6556](../../packages/store/src/store.ts#L6556) `Store/fieldIndexCurrent` | `SQLite.iterate` (6556); `SQLite.prepare` (6556, 6561); `Store.sql` (6556, 6561); `SQLite.all` (6561) | GATED-STORE |
| [packages/store/src/store.ts:6602](../../packages/store/src/store.ts#L6602) `Store/valueListItemsCurrent` | `Store.valueListItems` (6602); `Store.get` (6616); `relatedRows` (6617); `Store.row` (6617); `SQLite.iterate` (6619); `SQLite.prepare` (6619); `Store.sql` (6619); `Calculations.related` (6629); `Calculations.value` (6633, 6634) | GATED-STORE |
| [packages/store/src/store.ts:6731](../../packages/store/src/store.ts#L6731) `Store/portalRows` | `relatedRows` (6731); `relatedIdList` (6732); `Store.viewableIds` (6735); `rowsById` (6760, 6798); `Calculations.related` (6774) | CORE |
| [packages/store/src/store.ts:6742](../../packages/store/src/store.ts#L6742) `Store/portalRows/context` | `Calculations.context` (6742) | CORE |
| [packages/store/src/store.ts:6752](../../packages/store/src/store.ts#L6752) `Store/portalRows/valueOf` | `Calculations.value` (6752) | CORE |
| [packages/store/src/store.ts:6869](../../packages/store/src/store.ts#L6869) `Store/markRepeating` | `SQLite.prepare` (6869); `Store.sql` (6869) | CORE |
| [packages/store/src/store.ts:6896](../../packages/store/src/store.ts#L6896) `Store/externalContainerCheck` | `SQLite.all` (6896); `SQLite.prepare` (6896); `Store.sql` (6896) | CORE |
| [packages/store/src/store.ts:6903](../../packages/store/src/store.ts#L6903) `Store/externalContainerCount` | `SQLite.get` (6903); `SQLite.prepare` (6903); `Store.sql` (6903) | CORE |
| [packages/store/src/store.ts:6912](../../packages/store/src/store.ts#L6912) `Store/externalContainerReport` | `SQLite.all` (6912, 6925); `SQLite.prepare` (6912, 6925); `Store.sql` (6912, 6925) | CORE |
| [packages/store/src/store.ts:7060](../../packages/store/src/store.ts#L7060) `Store/orphanContainerReport` | `SQLite.all` (7060); `SQLite.prepare` (7060); `Store.sql` (7060) | CORE |
| [packages/store/src/store.ts:7095](../../packages/store/src/store.ts#L7095) `Store/purgeOrphanContainers` | `Store.sql` (7095, 7099, 7108, 7111, 7112, 7117, 7118, 7120, 7120); `Store.orphanContainerReport` (7103); `SQLite.get` (7108); `SQLite.prepare` (7108, 7111, 7112) | CORE |
| [packages/store/src/store.ts:7133](../../packages/store/src/store.ts#L7133) `Store/containerIntact` | `SQLite.get` (7133); `SQLite.prepare` (7133); `Store.sql` (7133) | CORE |
| [packages/store/src/store.ts:7143](../../packages/store/src/store.ts#L7143) `Store/externalOf` | `SQLite.get` (7143); `SQLite.prepare` (7143); `Store.sql` (7143) | CORE |
| [packages/store/src/store.ts:7147](../../packages/store/src/store.ts#L7147) `Store/containerMeta` | `SQLite.get` (7147); `SQLite.prepare` (7147); `Store.sql` (7147) | CORE |
| [packages/store/src/store.ts:7152](../../packages/store/src/store.ts#L7152) `Store/container` | `SQLite.get` (7152); `SQLite.prepare` (7152, 7161); `Store.sql` (7152, 7161); `SQLite.all` (7161) | CORE |
| [packages/store/src/store.ts:7169](../../packages/store/src/store.ts#L7169) `Store/containerInfo` | `SQLite.get` (7169); `SQLite.prepare` (7169); `Store.sql` (7169) | CORE |
| [packages/store/src/store.ts:7203](../../packages/store/src/store.ts#L7203) `Store/containerRange` | `SQLite.all` (7203); `SQLite.prepare` (7203, 7210); `Store.sql` (7203, 7210); `SQLite.get` (7210) | CORE |
| [packages/store/src/store.ts:7228](../../packages/store/src/store.ts#L7228) `Store/addContainer` | `SQLite.all` (7228); `SQLite.prepare` (7228, 7233, 7247, 7251, 7252); `Store.sql` (7228, 7233, 7247, 7249, 7251, 7252, 7254, 7257); `SQLite.get` (7238); `Store.containerRange` (7240) | CORE |
| [packages/store/src/store.ts:7274](../../packages/store/src/store.ts#L7274) `Store/addExternalContainer` | `SQLite.prepare` (7274); `Store.sql` (7274) | CORE |
| [packages/store/src/store.ts:7292](../../packages/store/src/store.ts#L7292) `Store/writeExternalFile` | `Store.evaluateEach` (7292); `SQLite.prepare` (7315); `Store.sql` (7315) | CORE |
| [packages/store/src/store.ts:7316](../../packages/store/src/store.ts#L7316) `Store/writeExternalFile/taken` | `SQLite.get` (7316) | CORE |
| [packages/store/src/store.ts:7346](../../packages/store/src/store.ts#L7346) `Store/embeddedContainers` | `SQLite.prepare` (7346, 7347); `Store.sql` (7346, 7347); `SQLite.all` (7347); `SQLite.get` (7351) | CORE |
| [packages/store/src/store.ts:7360](../../packages/store/src/store.ts#L7360) `Store/embeddedContainerCount` | `SQLite.prepare` (7360); `Store.sql` (7360); `SQLite.get` (7361) | CORE |
| [packages/store/src/store.ts:7369](../../packages/store/src/store.ts#L7369) `Store/recoverContainersOut` | `SQLite.prepare` (7369); `Store.sql` (7369); `SQLite.get` (7372) | CORE |
| [packages/store/src/store.ts:7394](../../packages/store/src/store.ts#L7394) `Store/moveContainersOut` | `Store.sql` (7394, 7402, 7404, 7406, 7408, 7409, 7428, 7433, 7435, 7437, 7438, 7442); `SQLite.get` (7402); `SQLite.prepare` (7402, 7408, 7409); `Store.container` (7411) | CORE |
| [packages/store/src/store.ts:7451](../../packages/store/src/store.ts#L7451) `Store/moveContainersIn` | `Store.sql` (7451, 7456, 7458, 7459, 7460, 7461, 7480, 7483, 7490, 7493, 7496, 7503); `SQLite.prepare` (7458, 7459, 7460, 7461, 7490, 7496); `SQLite.get` (7463, 7490, 7496) | CORE |
| [packages/store/src/store.ts:7515](../../packages/store/src/store.ts#L7515) `Store/compactFile` | `Store.sql` (7515, 7516, 7517) | CORE |
| [packages/store/src/store.ts:7523](../../packages/store/src/store.ts#L7523) `Store/containerId` | `Store.containerId` (7523); `Store.row` (7524) | CORE |
| [packages/store/src/store.ts:7546](../../packages/store/src/store.ts#L7546) `Store/checkContainerWrite` | `Store.row` (7546) | CORE |
| [packages/store/src/store.ts:7559](../../packages/store/src/store.ts#L7559) `Store/setContainer` | `Store.sql` (7559, 7573, 7578, 7581, 7581); `Store.row` (7562); `SQLite.prepare` (7573) | CORE |
| [packages/store/src/store.ts:7615](../../packages/store/src/store.ts#L7615) `Store/orderBy` | `Store.valueListItems` (7615) | CORE |
| [packages/store/src/store.ts:7638](../../packages/store/src/store.ts#L7638) `Store/userPrefs` | `SQLite.all` (7638); `SQLite.prepare` (7638); `Store.sql` (7638) | CORE |
| [packages/store/src/store.ts:7643](../../packages/store/src/store.ts#L7643) `Store/hasTable` | `SQLite.get` (7643); `SQLite.prepare` (7643); `Store.sql` (7643) | CORE |
| [packages/store/src/store.ts:7647](../../packages/store/src/store.ts#L7647) `Store/setUserPref` | `Store.sql` (7647, 7648, 7649); `SQLite.prepare` (7648, 7649) | CORE |
| [packages/store/src/store.ts:7655](../../packages/store/src/store.ts#L7655) `Store/indexedFields` | `SQLite.all` (7655, 7656); `SQLite.prepare` (7655, 7656); `Store.sql` (7655, 7656) | CORE |
| [packages/store/src/store.ts:7677](../../packages/store/src/store.ts#L7677) `Store/addFieldIndex` | `Store.sql` (7677) | CORE |
| [packages/store/src/store.ts:7689](../../packages/store/src/store.ts#L7689) `Store/dropFieldIndex` | `SQLite.get` (7689); `SQLite.prepare` (7689); `Store.sql` (7689, 7690) | CORE |
| [packages/store/src/store.ts:7700](../../packages/store/src/store.ts#L7700) `Store/timeFind` | `Store.query` (7700, 7704, 7705); `Store.recordCount` (7707) | CORE |
| [packages/store/src/store.ts:7724](../../packages/store/src/store.ts#L7724) `Store/find` | `Store.find` (7724) | GATED-STORE |
| [packages/store/src/store.ts:7735](../../packages/store/src/store.ts#L7735) `Store/findHere` | `Store.query` (7735, 7740, 7742, 7756, 7758, 7768); `Store.recordCount` (7753); `SQLite.get` (7754, 7758); `SQLite.prepare` (7754, 7758, 7763, 7770, 7779); `Store.sql` (7754, 7758, 7763, 7770, 7779); `SQLite.all` (7763, 7770, 7779) | GATED-STORE |
| [packages/store/src/store.ts:7774](../../packages/store/src/store.ts#L7774) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7774); `SQLite.prepare` (7774); `Store.sql` (7774) | GATED-STORE |
| [packages/store/src/store.ts:7807](../../packages/store/src/store.ts#L7807) `Store/sortedPage` | `SQLite.iterate` (7807); `SQLite.prepare` (7807, 7822); `Store.sql` (7807, 7822); `SQLite.all` (7822) | CORE |
| [packages/store/src/store.ts:7879](../../packages/store/src/store.ts#L7879) `Store/relatedCriteria/matched` | `relatedRows` (7879) | CORE |
| [packages/store/src/store.ts:7882](../../packages/store/src/store.ts#L7882) `Store/relatedCriteria` | `SQLite.iterate` (7882); `SQLite.prepare` (7882); `Store.sql` (7882) | CORE |
| [packages/store/src/store.ts:7908](../../packages/store/src/store.ts#L7908) `Store/computedRows` | `Store.sql` (7908, 7911, 7912, 7913, 7915, 7925, 7926, 7927, 7930); `SQLite.prepare` (7911, 7913, 7915, 7925); `SQLite.iterate` (7915); `Calculations.globalValue` (7918); `Calculations.unstoredValue` (7919); `Calculations.related` (7922); `SQLite.all` (7925) | CORE |
| [packages/store/src/store.ts:7955](../../packages/store/src/store.ts#L7955) `Store/summaries` | `Calculations.wholeTable` (7955); `Calculations.collect` (7975, 7980) | CORE |
| [packages/store/src/store.ts:7971](../../packages/store/src/store.ts#L7971) `Store/summaries/recs` | `SQLite.iterate` (7971); `SQLite.prepare` (7971); `Store.sql` (7971) | CORE |
| [packages/store/src/store.ts:7993](../../packages/store/src/store.ts#L7993) `Store/runningSummaryValues` | `Store.viewableIds` (7993); `rowsById` (7995); `Calculations.value` (8006, 8012); `Calculations.related` (8023) | GATED-STORE |
| [packages/store/src/store.ts:8039](../../packages/store/src/store.ts#L8039) `Store/findSource` | `Store.query` (8039); `SQLite.all` (8048, 8065); `SQLite.prepare` (8048, 8056, 8064); `Store.sql` (8048, 8053, 8056, 8061, 8064, 8078, 8080); `Calculations.globalValue` (8070); `Calculations.unstoredValue` (8071); `Calculations.related` (8075) | CORE |
| [packages/store/src/store.ts:8095](../../packages/store/src/store.ts#L8095) `Store/findCandidates` | `Store.query` (8095) | CORE |
| [packages/store/src/store.ts:8130](../../packages/store/src/store.ts#L8130) `Store/previewRow` | `Store.row` (8130) | CORE |
| [packages/store/src/store.ts:8148](../../packages/store/src/store.ts#L8148) `Store/row` | `SQLite.get` (8148) | CORE |
| [packages/store/src/store.ts:8167](../../packages/store/src/store.ts#L8167) `Store/getCurrent` | `Store.get` (8167); `Store.row` (8168, 8168, 8182); `SQLite.all` (8185); `SQLite.prepare` (8185); `Store.sql` (8185) | GATED-STORE |
| [packages/store/src/store.ts:8205](../../packages/store/src/store.ts#L8205) `Store/getManyCurrent` | `Store.getMany` (8205); `SQLite.get` (8223); `SQLite.prepare` (8223); `Store.sql` (8223) | GATED-STORE |
| [packages/store/src/store.ts:8216](../../packages/store/src/store.ts#L8216) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8216) | GATED-STORE |
| [packages/store/src/store.ts:8239](../../packages/store/src/store.ts#L8239) `Store/canViewRecord` | `SQLite.get` (8239); `SQLite.prepare` (8239); `Store.sql` (8239) | GATED-STORE |
| [packages/store/src/store.ts:8247](../../packages/store/src/store.ts#L8247) `Store/canView` | `Store.canView` (8247); `Store.row` (8248) | GATED-STORE |
| [packages/store/src/store.ts:8272](../../packages/store/src/store.ts#L8272) `Store/create` | `SQLite.get` (8272, 8278); `SQLite.prepare` (8272, 8278, 8291); `Store.sql` (8272, 8278, 8291) | CORE |
| [packages/store/src/store.ts:8315](../../packages/store/src/store.ts#L8315) `Store/duplicate` | `Store.row` (8315); `SQLite.get` (8319); `SQLite.prepare` (8319, 8334); `Store.sql` (8319, 8334) | CORE |
| [packages/store/src/store.ts:8379](../../packages/store/src/store.ts#L8379) `Store/update` | `Store.row` (8379, 8386, 8397); `Store.sql` (8410, 8411, 8450, 8453) | CORE |
| [packages/store/src/store.ts:8413](../../packages/store/src/store.ts#L8413) `Store/update/undo` | `Store.sql` (8413) | CORE |
| [packages/store/src/store.ts:8557](../../packages/store/src/store.ts#L8557) `Store/setStoredCalcValues` | `SQLite.prepare` (8557, 8558); `Store.sql` (8557, 8558); `SQLite.get` (8562) | CORE |
| [packages/store/src/store.ts:8636](../../packages/store/src/store.ts#L8636) `Store/evaluateCurrent` | `Store.row` (8636, 8636); `Calculations.context` (8641); `Store.get` (8642, 8644) | GATED-STORE |
| [packages/store/src/store.ts:8676](../../packages/store/src/store.ts#L8676) `Store/evaluateEachCurrent` | `Store.row` (8676, 8676); `Calculations.context` (8681); `Store.get` (8683) | GATED-STORE |
| [packages/store/src/store.ts:8716](../../packages/store/src/store.ts#L8716) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8716); `Store.get` (8718) | GATED-STORE |
| [packages/store/src/store.ts:8737](../../packages/store/src/store.ts#L8737) `Store/evaluateRowsCurrent` | `Store.row` (8737, 8737) | GATED-STORE |
| [packages/store/src/store.ts:8751](../../packages/store/src/store.ts#L8751) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8751) | GATED-STORE |
| [packages/store/src/store.ts:8773](../../packages/store/src/store.ts#L8773) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8773) | GATED-STORE |
| [packages/store/src/store.ts:8811](../../packages/store/src/store.ts#L8811) `Store/updateRelated` | `relatedRows` (8811) | CORE |
| [packages/store/src/store.ts:8829](../../packages/store/src/store.ts#L8829) `Store/updatePortals` | `Store.row` (8829, 8864); `relatedRows` (8865) | CORE |
| [packages/store/src/store.ts:8838](../../packages/store/src/store.ts#L8838) `Store/updatePortals/portal/related` | `relatedIdList` (8838) | CORE |
| [packages/store/src/store.ts:8920](../../packages/store/src/store.ts#L8920) `Store/portalContainerTarget` | `Store.row` (8920); `relatedIdList` (8921) | CORE |
| [packages/store/src/store.ts:8934](../../packages/store/src/store.ts#L8934) `Store/checkEditable` | `Store.row` (8934) | CORE |
| [packages/store/src/store.ts:8957](../../packages/store/src/store.ts#L8957) `Store/delete` | `Store.row` (8957) | CORE |
| [packages/store/src/store.ts:8965](../../packages/store/src/store.ts#L8965) `Store/delete/run` | `SQLite.get` (8965); `SQLite.prepare` (8965, 8969); `Store.sql` (8965, 8969) | CORE |
| [packages/store/src/store.ts:9191](../../packages/store/src/store.ts#L9191) `Store/keyStepWork` | `Store.sql` (9191, 9197, 9201, 9203) | CORE |
| [packages/store/src/store.ts:8994](../../packages/store/src/store.ts#L8994) `Store/vaultHeld` | `SQLite.get` (8994); `SQLite.prepare` (8994); `Store.sql` (8994) | CORE |
| [packages/store/src/store.ts:9001](../../packages/store/src/store.ts#L9001) `Store/forgetStandInValues` | `Store.sql` (9001, 9022); `SQLite.prepare` (9022) | CORE |
| [packages/store/src/store.ts:9041](../../packages/store/src/store.ts#L9041) `Store/restoreDeletedRowLocked` | `SQLite.get` (9041); `SQLite.prepare` (9041, 9042, 9046); `Store.sql` (9041, 9042, 9046); `SQLite.all` (9042) | CORE |
| [packages/store/src/store.ts:9244](../../packages/store/src/store.ts#L9244) `Store/cascadeDelete` | `relatedRows` (9244) | CORE |
| [packages/store/src/store.ts:9334](../../packages/store/src/store.ts#L9334) `Store/selectIdsCurrent` | `Store.selectIds` (9334); `SQLite.all` (9340); `SQLite.prepare` (9340); `Store.sql` (9340) | GATED-STORE |
| [packages/store/src/store.ts:9348](../../packages/store/src/store.ts#L9348) `Store/countIds` | `Store.countIds` (9348); `SQLite.get` (9352); `SQLite.prepare` (9352); `Store.sql` (9352) | GATED-STORE |
| [packages/store/src/store.ts:9368](../../packages/store/src/store.ts#L9368) `Store/computeValuesCurrent` | `Store.computeValues` (9368); `Store.sql` (9374, 9378); `SQLite.all` (9378); `SQLite.prepare` (9378) | GATED-STORE |
| [packages/store/src/store.ts:9393](../../packages/store/src/store.ts#L9393) `Store/findIdsCurrent` | `Store.findIds` (9393) | GATED-STORE |
| [packages/store/src/store.ts:9399](../../packages/store/src/store.ts#L9399) `Store/findIdsHere` | `Store.query` (9399, 9404, 9406); `SQLite.iterate` (9417); `SQLite.prepare` (9417); `Store.sql` (9417) | GATED-STORE |
| [packages/store/src/store.ts:9434](../../packages/store/src/store.ts#L9434) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9434); `Store.viewableIds` (9439); `Calculations.collect` (9455); `rowsById` (9455, 9505); `Calculations.collector` (9477) | GATED-STORE |
| [packages/store/src/store.ts:9467](../../packages/store/src/store.ts#L9467) `Store/groupSummariesCurrent/key` | `Calculations.value` (9467); `Calculations.related` (9469) | GATED-STORE |
| [packages/store/src/store.ts:9503](../../packages/store/src/store.ts#L9503) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9503) | GATED-STORE |
| [packages/store/src/store.ts:9559](../../packages/store/src/store.ts#L9559) `Store/sortIdsCurrentProgress` | `SQLite.all` (9559); `SQLite.prepare` (9559, 9627); `Store.sql` (9559, 9627); `Store.valueListItems` (9567); `rowsById` (9579); `Calculations.globalValue` (9582); `Calculations.unstoredValue` (9583); `Calculations.related` (9589); `SQLite.iterate` (9627) | GATED-STORE |
| [packages/store/src/store.ts:9641](../../packages/store/src/store.ts#L9641) `Store/matchIds` | `Store.matchIds` (9641); `SQLite.all` (9647); `SQLite.prepare` (9647); `Store.sql` (9647) | CORE |
| [packages/store/src/store.ts:9668](../../packages/store/src/store.ts#L9668) `Store/truncate/run` | `Store.sql` (9668, 9670, 9677, 9679, 9681, 9682); `SQLite.prepare` (9670, 9677); `SQLite.all` (9672) | CORE |
| [packages/store/src/store.ts:9706](../../packages/store/src/store.ts#L9706) `Store/iterateCommitted` | `SQLite.iterate` (9706) | CORE |
| [packages/store/src/store.ts:9740](../../packages/store/src/store.ts#L9740) `Store/readOnlyChecked` | `SQLite.prepare` (9740, 9744, 9753, 9758); `SQLite.all` (9744, 9753, 9758) | CORE |
| [packages/store/src/store.ts:9780](../../packages/store/src/store.ts#L9780) `Store/refreshDecimalSqlViews` | `SQLite.get` (9780); `SQLite.prepare` (9780, 9785); `SQLite.all` (9785) | CORE |
| [packages/store/src/store.ts:9799](../../packages/store/src/store.ts#L9799) `Store/internalRoots` | `SQLite.get` (9799); `SQLite.prepare` (9799, 9801); `SQLite.all` (9801) | CORE |
| [packages/store/src/store.ts:9834](../../packages/store/src/store.ts#L9834) `Store/selectCurrent` | `SQLite.iterate` (9834) | CORE |
| [packages/store/src/store.ts:9883](../../packages/store/src/store.ts#L9883) `Store/query` | `SQLite.iterate` (9883) | CORE |
| [packages/store/src/store.ts:9917](../../packages/store/src/store.ts#L9917) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9917); `SQLite.all` (9924, 9927); `SQLite.prepare` (9924, 9927) | CORE |
| [packages/store/src/store.ts:1200](../../packages/store/src/store.ts#L1200) `Store/ensureNativeIds` | `SQLite.all` (1200, 1212); `SQLite.prepare` (1200, 1203, 1211, 1212); `Store.sql` (1200, 1203, 1206, 1210, 1211, 1212, 1215, 1217) | CORE |
| [packages/store/src/store.ts:1225](../../packages/store/src/store.ts#L1225) `Store/nativeIdGuards` | `Store.sql` (1225, 1226, 1228) | CORE |
| [packages/store/src/store.ts:9850](../../packages/store/src/store.ts#L9850) `Store/selectIn` | `Store.select` (9850) | CORE |
| [packages/store/src/store.ts:9858](../../packages/store/src/store.ts#L9858) `Store/selectHeldCurrent` | `Store.sql` (9858, 9859); `SQLite.prepare` (9859); `SQLite.iterate` (9862) | CORE |
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
| [packages/store/src/store.ts:1558](../../packages/store/src/store.ts#L1558) `Store/selfContainedCopy` | `Store.sql` (1558); `SQLite.all` (1563); `SQLite.prepare` (1563, 1565, 1566, 1567) | CORE |
| [packages/store/src/store.ts:6975](../../packages/store/src/store.ts#L6975) `Store/containerReferences` | `SQLite.all` (6975, 6993, 6995, 7001, 7014, 7025, 7039); `SQLite.prepare` (6975, 6993, 6995, 7001, 7014, 7025, 7037, 7039); `Store.sql` (6975, 6993, 6995, 7001, 7014, 7025, 7037, 7039); `SQLite.get` (7037); `Store.row` (7048) | CORE |
| [packages/store/src/store.ts:7072](../../packages/store/src/store.ts#L7072) `Store/containerIntegrityReport` | `SQLite.all` (7072); `SQLite.prepare` (7072, 7083); `Store.sql` (7072, 7083); `SQLite.get` (7083) | CORE |
| [packages/server/src/compaction.ts:62](../../packages/server/src/compaction.ts#L62) `compactStore` | `SQLite.get` (62, 63, 76, 83); `SQLite.prepare` (62, 63, 76, 83) | OPERATOR |
<!-- end generated read-gate inventory -->
