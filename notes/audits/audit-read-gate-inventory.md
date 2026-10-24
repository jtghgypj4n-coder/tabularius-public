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
| [packages/server/src/admin.ts:2272](../../packages/server/src/admin.ts#L2272) `Admin/audit` | `Store.auditLog` (2272) | ADMIN |
| [packages/server/src/admin.ts:1040](../../packages/server/src/admin.ts#L1040) `Admin/handle` | `Store.externalContainerReport` (1040); `Store.orphanContainerReport` (1045, 1049) | ADMIN |
| [packages/server/src/admin.ts:2703](../../packages/server/src/admin.ts#L2703) `Admin/status` | `Store.externalContainerCount` (2703) | ADMIN |
| [packages/server/src/admin.ts:2355](../../packages/server/src/admin.ts#L2355) `Admin/viewAs` | `Store.find` (2355) | ADMIN |
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
| [packages/server/src/dataapi.ts:1960](../../packages/server/src/dataapi.ts#L1960) `DataApi/route` | `Store.get` (1960, 2182, 2205, 2213, 2260, 2284, 2304, 2341); `Store.valueListItems` (1975); `Store.find` (2137, 2184, 2374); `Store.findIds` (2141, 2379); `Store.query` (2379) | REST |
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
| [packages/server/src/live.ts:138](../../packages/server/src/live.ts#L138) `Live/handle` | `Store.canViewRecord` (138, 145); `Store.canView` (190) | LIVE |
| [packages/server/src/live.ts:292](../../packages/server/src/live.ts#L292) `Live/stream/listener` | `Store.canViewRecord` (292, 294) | LIVE |
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
| [packages/server/src/pgwire.ts:851](../../packages/server/src/pgwire.ts#L851) `Connection/catalog` | `Store.describeTyped` (851) | SQL |
| [packages/server/src/pgwire.ts:1223](../../packages/server/src/pgwire.ts#L1223) `Connection/describe` | `Store.describeTyped` (1223) | SQL |
| [packages/server/src/pgwire.ts:862](../../packages/server/src/pgwire.ts#L862) `Connection/run` | `Store.selectIn` (862); `Store.describeTyped` (866) | SQL |
| [packages/server/src/pgwire.ts:814](../../packages/server/src/pgwire.ts#L814) `Connection/translate` | `Calculations.translateSQL` (814) | SQL |
| [packages/server/src/pgwire.ts:990](../../packages/server/src/pgwire.ts#L990) `Connection/validateSyntax` | `SQLite.prepare` (990); `Store.sql` (990) | SQL |
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
| [packages/server/src/record-context.ts:112](../../packages/server/src/record-context.ts#L112) `describeRecord` | `Store.row` (112); `Store.get` (121); `keyValue` (127); `Store.viewableIds` (154); `relatedRows` (158, 163) | RECORD |
| [packages/server/src/record-history.ts:99](../../packages/server/src/record-history.ts#L99) `recordHistory` | `Store.auditLog` (99, 152) | HISTORY |
| [packages/server/src/record-search.ts:61](../../packages/server/src/record-search.ts#L61) `searchRecords` | `Store.viewableIds` (61); `SQLite.all` (74); `SQLite.prepare` (74); `Store.sql` (74) | SEARCH |
| [packages/server/src/record-search.ts:104](../../packages/server/src/record-search.ts#L104) `searchRecords/snippet` | `SQLite.get` (104); `SQLite.prepare` (104); `Store.sql` (104) | SEARCH |
| [packages/server/src/record-search.ts:109](../../packages/server/src/record-search.ts#L109) `searchRecords/source` | `SQLite.get` (109); `SQLite.prepare` (109); `Store.sql` (109) | SEARCH |
| [packages/server/src/rule-suggestions.ts:57](../../packages/server/src/rule-suggestions.ts#L57) `suggestRules` | `Store.query` (57, 69, 86, 136, 138, 152, 153, 169) | DESIGN |
| [packages/server/src/scim.ts:283](../../packages/server/src/scim.ts#L283) `ScimDirectory/atomically` | `Store.sql` (283) | AUTH |
| [packages/server/src/scim.ts:374](../../packages/server/src/scim.ts#L374) `ScimDirectory/create/scim_user_create` | `SQLite.prepare` (374); `Store.sql` (374) | AUTH |
| [packages/server/src/scim.ts:418](../../packages/server/src/scim.ts#L418) `ScimDirectory/remove/scim_user_remove` | `SQLite.prepare` (418); `Store.sql` (418) | AUTH |
| [packages/server/src/scim.ts:323](../../packages/server/src/scim.ts#L323) `ScimDirectory/revokePersonTokens` | `SQLite.all` (323); `SQLite.prepare` (323); `Store.sql` (323) | AUTH |
| [packages/server/src/scim.ts:219](../../packages/server/src/scim.ts#L219) `ScimDirectory/rows` | `SQLite.all` (219); `SQLite.prepare` (219, 222); `Store.sql` (219, 222) | AUTH |
| [packages/server/src/scim.ts:137](../../packages/server/src/scim.ts#L137) `ScimDirectory/save` | `SQLite.prepare` (137); `Store.sql` (137) | AUTH |
| [packages/server/src/scim.ts:246](../../packages/server/src/scim.ts#L246) `ScimDirectory/setMemberships` | `SQLite.prepare` (246); `Store.sql` (246) | AUTH |
| [packages/server/src/scim.ts:129](../../packages/server/src/scim.ts#L129) `ScimDirectory/settings` | `SQLite.get` (129); `SQLite.prepare` (129); `Store.sql` (129) | AUTH |
| [packages/server/src/scim.ts:123](../../packages/server/src/scim.ts#L123) `ScimDirectory/table` | `Store.sql` (123) | AUTH |
| [packages/server/src/scim.ts:395](../../packages/server/src/scim.ts#L395) `ScimDirectory/update/scim_user_update` | `SQLite.prepare` (395); `Store.sql` (395) | AUTH |
| [packages/server/src/script-failure.ts:212](../../packages/server/src/script-failure.ts#L212) `explainScriptFailure` | `Store.row` (212) | RECORD |
| [packages/server/src/security.ts:212](../../packages/server/src/security.ts#L212) `SecurityApi/handle` | `Store.previewRecordRule` (212) | DESIGN |
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
| [packages/store/src/activity.ts:430](../../packages/store/src/activity.ts#L430) `SharedRecordLocks/acquire` | `SQLite.prepare` (430) | CORE |
| [packages/store/src/activity.ts:468](../../packages/store/src/activity.ts#L468) `SharedRecordLocks/all` | `SQLite.all` (468); `SQLite.prepare` (468) | CORE |
| [packages/store/src/activity.ts:372](../../packages/store/src/activity.ts#L372) `SharedRecordLocks/constructor` | `SQLite.get` (372); `SQLite.prepare` (372) | CORE |
| [packages/store/src/activity.ts:403](../../packages/store/src/activity.ts#L403) `SharedRecordLocks/count` | `SQLite.get` (403); `SQLite.prepare` (403) | CORE |
| [packages/store/src/activity.ts:415](../../packages/store/src/activity.ts#L415) `SharedRecordLocks/holder` | `SQLite.get` (415); `SQLite.prepare` (415) | CORE |
| [packages/store/src/activity.ts:478](../../packages/store/src/activity.ts#L478) `SharedRecordLocks/leave` | `SQLite.prepare` (478) | CORE |
| [packages/store/src/activity.ts:482](../../packages/store/src/activity.ts#L482) `SharedRecordLocks/leaveOwner` | `SQLite.all` (482); `SQLite.prepare` (482) | CORE |
| [packages/store/src/activity.ts:458](../../packages/store/src/activity.ts#L458) `SharedRecordLocks/release` | `SQLite.prepare` (458) | CORE |
| [packages/store/src/activity.ts:462](../../packages/store/src/activity.ts#L462) `SharedRecordLocks/releaseOwner` | `SQLite.all` (462); `SQLite.prepare` (462) | CORE |
| [packages/store/src/activity.ts:444](../../packages/store/src/activity.ts#L444) `SharedRecordLocks/renew` | `SQLite.prepare` (444) | CORE |
| [packages/store/src/activity.ts:407](../../packages/store/src/activity.ts#L407) `SharedRecordLocks/sweep` | `SQLite.prepare` (407) | CORE |
| [packages/store/src/activity.ts:472](../../packages/store/src/activity.ts#L472) `SharedRecordLocks/view` | `SQLite.get` (472); `SQLite.prepare` (472, 473) | CORE |
| [packages/store/src/activity.ts:486](../../packages/store/src/activity.ts#L486) `SharedRecordLocks/viewers` | `SQLite.prepare` (486, 487); `SQLite.all` (487) | CORE |
| [packages/store/src/audit-anchor.ts:68](../../packages/store/src/audit-anchor.ts#L68) `checkAnchor` | `SQLite.get` (68, 70, 73); `SQLite.prepare` (68, 70, 73) | CORE |
| [packages/store/src/cache-versions.ts:11](../../packages/store/src/cache-versions.ts#L11) `ensureCacheVersions` | `SQLite.get` (11); `SQLite.prepare` (11) | CORE |
| [packages/store/src/calc.ts:618](../../packages/store/src/calc.ts#L618) `Calculations/allRecords` | `SQLite.iterate` (618); `SQLite.prepare` (618); `Store.sql` (618) | CALC |
| [packages/store/src/calc.ts:1213](../../packages/store/src/calc.ts#L1213) `Calculations/applyDelta/value` | `Calculations.value` (1213) | CALC |
| [packages/store/src/calc.ts:2385](../../packages/store/src/calc.ts#L2385) `Calculations/beforeWrite` | `relatedRows` (2385); `Calculations.related` (2439); `Calculations.context` (2452) | CORE |
| [packages/store/src/calc.ts:629](../../packages/store/src/calc.ts#L629) `Calculations/collect` | `Calculations.collector` (629) | CALC |
| [packages/store/src/calc.ts:660](../../packages/store/src/calc.ts#L660) `Calculations/collector/add` | `Calculations.related` (660) | CALC |
| [packages/store/src/calc.ts:1693](../../packages/store/src/calc.ts#L1693) `Calculations/columnNames` | `SQLite.all` (1693); `SQLite.prepare` (1693); `Store.sql` (1693) | CALC |
| [packages/store/src/calc.ts:2248](../../packages/store/src/calc.ts#L2248) `Calculations/computeColumn` | `Calculations.statement` (2248); `SQLite.get` (2248); `Calculations.value` (2251) | CALC |
| [packages/store/src/calc.ts:2503](../../packages/store/src/calc.ts#L2503) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2503); `Calculations.value` (2503) | CALC |
| [packages/store/src/calc.ts:2518](../../packages/store/src/calc.ts#L2518) `Calculations/computeStoredStyled` | `Calculations.context` (2518) | CORE |
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
| [packages/store/src/calc.ts:2211](../../packages/store/src/calc.ts#L2211) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2211) | CALC |
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
| [packages/store/src/calc.ts:2179](../../packages/store/src/calc.ts#L2179) `Calculations/shareColumn` | `Store.recordCount` (2179) | CALC |
| [packages/store/src/calc.ts:1704](../../packages/store/src/calc.ts#L1704) `Calculations/statement` | `SQLite.prepare` (1704); `Store.sql` (1704) | CALC |
| [packages/store/src/calc.ts:1540](../../packages/store/src/calc.ts#L1540) `Calculations/storedRelatedValues` | `Calculations.statement` (1540); `SQLite.iterate` (1540) | CALC |
| [packages/store/src/calc.ts:1285](../../packages/store/src/calc.ts#L1285) `Calculations/storedRows` | `SQLite.iterate` (1285); `SQLite.prepare` (1285); `Store.sql` (1285) | CALC |
| [packages/store/src/calc.ts:684](../../packages/store/src/calc.ts#L684) `Calculations/summary` | `Calculations.collect` (684) | CALC |
| [packages/store/src/calc.ts:921](../../packages/store/src/calc.ts#L921) `Calculations/summaryDependencies` | `Store.sql` (921) | CALC |
| [packages/store/src/calc.ts:636](../../packages/store/src/calc.ts#L636) `Calculations/summaryInput` | `Calculations.value` (636) | CALC |
| [packages/store/src/calc.ts:691](../../packages/store/src/calc.ts#L691) `Calculations/tableSummary` | `Calculations.wholeTable` (691) | CALC |
| [packages/store/src/calc.ts:2116](../../packages/store/src/calc.ts#L2116) `Calculations/translateSQL` | `Store.scopedTableSql` (2116, 2147) | CALC |
| [packages/store/src/calc.ts:2554](../../packages/store/src/calc.ts#L2554) `Calculations/uniqueCollision` | `Calculations.value` (2554) | CALC |
| [packages/store/src/calc.ts:580](../../packages/store/src/calc.ts#L580) `Calculations/unstoredValue` | `Calculations.unstoredStyled` (580); `Calculations.value` (580) | CALC |
| [packages/store/src/calc.ts:2581](../../packages/store/src/calc.ts#L2581) `Calculations/validate` | `Calculations.value` (2581); `Store.valueListItems` (2602); `Calculations.context` (2616) | CALC |
| [packages/store/src/calc.ts:2567](../../packages/store/src/calc.ts#L2567) `Calculations/validate/fail` | `Calculations.context` (2567) | CALC |
| [packages/store/src/calc.ts:530](../../packages/store/src/calc.ts#L530) `Calculations/value` | `Calculations.globalValue` (530) | CALC |
| [packages/store/src/calc.ts:960](../../packages/store/src/calc.ts#L960) `Calculations/wholeTable` | `rowsById` (960); `Store.viewableIds` (960); `Calculations.collect` (962, 1052); `Calculations.value` (1023); `Store.sql` (1031, 1039) | CALC |
| [packages/store/src/calc.ts:2763](../../packages/store/src/calc.ts#L2763) `containerValue` | `Store.containerInfo` (2763); `Store.containerRange` (2770); `Store.container` (2771) | CALC |
| [packages/store/src/calc.ts:2779](../../packages/store/src/calc.ts#L2779) `containerValue/read` | `Store.container` (2779) | CALC |
| [packages/store/src/calc.ts:2792](../../packages/store/src/calc.ts#L2792) `containerValue/value` | `Store.containerRange` (2792) | CALC |
| [packages/store/src/calc.ts:2678](../../packages/store/src/calc.ts#L2678) `nearest` | `SQLite.get` (2678); `SQLite.prepare` (2678); `Store.sql` (2678) | CALC |
| [packages/store/src/calc.ts:3223](../../packages/store/src/calc.ts#L3223) `rowsById/flush` | `Calculations.statement` (3223); `SQLite.iterate` (3223) | CALC |
| [packages/store/src/calc.ts:2910](../../packages/store/src/calc.ts#L2910) `sameValuesElsewhere` | `SQLite.all` (2910); `SQLite.prepare` (2910, 2917, 2919); `Store.sql` (2910, 2917, 2919); `Calculations.value` (2912); `SQLite.get` (2917, 2919) | CALC |
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
| [packages/store/src/store.ts:4661](../../packages/store/src/store.ts#L4661) `Store/accountIdentityId` | `SQLite.get` (4661, 4666); `SQLite.prepare` (4661, 4665, 4666); `Store.sql` (4661, 4665, 4666) | CORE |
| [packages/store/src/store.ts:4624](../../packages/store/src/store.ts#L4624) `Store/accountInactive` | `SQLite.get` (4624); `SQLite.prepare` (4624); `Store.sql` (4624) | CORE |
| [packages/store/src/store.ts:4789](../../packages/store/src/store.ts#L4789) `Store/accountLocalOnly` | `SQLite.get` (4789); `SQLite.prepare` (4789); `Store.sql` (4789) | CORE |
| [packages/store/src/store.ts:5600](../../packages/store/src/store.ts#L5600) `Store/accountPrivilegeSet` | `SQLite.get` (5600); `SQLite.prepare` (5600); `Store.sql` (5600) | CORE |
| [packages/store/src/store.ts:4794](../../packages/store/src/store.ts#L4794) `Store/accountRequires2fa` | `SQLite.get` (4794); `SQLite.prepare` (4794); `Store.sql` (4794) | CORE |
| [packages/store/src/store.ts:5005](../../packages/store/src/store.ts#L5005) `Store/accountUsage` | `SQLite.get` (5005); `SQLite.prepare` (5005, 5006); `Store.sql` (5005, 5006); `SQLite.all` (5006); `Store.auditLog` (5022) | CORE |
| [packages/store/src/store.ts:3125](../../packages/store/src/store.ts#L3125) `Store/accounts` | `SQLite.all` (3125); `SQLite.prepare` (3125); `Store.sql` (3125) | CORE |
| [packages/store/src/store.ts:3121](../../packages/store/src/store.ts#L3121) `Store/accountsSharingLockout` | `SQLite.all` (3121); `SQLite.prepare` (3121); `Store.sql` (3121) | CORE |
| [packages/store/src/store.ts:7665](../../packages/store/src/store.ts#L7665) `Store/addContainer` | `SQLite.all` (7665); `SQLite.prepare` (7665, 7670, 7684, 7688, 7689); `Store.sql` (7665, 7670, 7684, 7686, 7688, 7689, 7691, 7694); `SQLite.get` (7675); `Store.containerRange` (7677) | CORE |
| [packages/store/src/store.ts:7711](../../packages/store/src/store.ts#L7711) `Store/addExternalContainer` | `SQLite.prepare` (7711); `Store.sql` (7711) | CORE |
| [packages/store/src/store.ts:8167](../../packages/store/src/store.ts#L8167) `Store/addFieldIndex` | `Store.sql` (8167) | CORE |
| [packages/store/src/store.ts:6372](../../packages/store/src/store.ts#L6372) `Store/addImage` | `Store.sql` (6372, 6373); `SQLite.prepare` (6373) | CORE |
| [packages/store/src/store.ts:5650](../../packages/store/src/store.ts#L5650) `Store/addProvisionedAccount` | `SQLite.get` (5650); `SQLite.prepare` (5650, 5654); `Store.sql` (5650, 5654) | CORE |
| [packages/store/src/store.ts:6791](../../packages/store/src/store.ts#L6791) `Store/addRelated` | `relatedRows` (6791); `rowsById` (6823); `firstRelatedEach` (6846) | CORE |
| [packages/store/src/store.ts:3143](../../packages/store/src/store.ts#L3143) `Store/agentNeedsApproval` | `SQLite.get` (3143); `SQLite.prepare` (3143); `Store.sql` (3143) | CORE |
| [packages/store/src/store.ts:5864](../../packages/store/src/store.ts#L5864) `Store/allowedIds` | `SQLite.iterate` (5864); `SQLite.prepare` (5864); `Store.sql` (5864) | CORE |
| [packages/store/src/store.ts:5062](../../packages/store/src/store.ts#L5062) `Store/apiToken` | `SQLite.get` (5062); `SQLite.prepare` (5062, 5075); `Store.sql` (5062, 5075) | CORE |
| [packages/store/src/store.ts:5038](../../packages/store/src/store.ts#L5038) `Store/apiTokens` | `SQLite.all` (5038); `SQLite.prepare` (5038); `Store.sql` (5038) | CORE |
| [packages/store/src/store.ts:3466](../../packages/store/src/store.ts#L3466) `Store/appendSecurityEvent` | `Store.sql` (3466) | CORE |
| [packages/store/src/store.ts:4471](../../packages/store/src/store.ts#L4471) `Store/applyAccountImport` | `Store.sql` (4471, 4479, 4508); `SQLite.get` (4479); `SQLite.prepare` (4479, 4508) | CORE |
| [packages/store/src/store.ts:2088](../../packages/store/src/store.ts#L2088) `Store/applyDesign` | `Store.sql` (2088, 2089, 2102, 2105, 2110, 2126, 2129, 2129); `SQLite.prepare` (2105, 2110) | CORE |
| [packages/store/src/store.ts:3339](../../packages/store/src/store.ts#L3339) `Store/approvePending` | `SQLite.get` (3339); `SQLite.prepare` (3339, 3350); `Store.sql` (3339, 3350) | CORE |
| [packages/store/src/store.ts:2545](../../packages/store/src/store.ts#L2545) `Store/audit` | `Store.sql` (2545) | CORE |
| [packages/store/src/store.ts:2187](../../packages/store/src/store.ts#L2187) `Store/auditLog` | `SQLite.all` (2187); `SQLite.prepare` (2187); `Store.sql` (2187) | CORE |
| [packages/store/src/store.ts:1699](../../packages/store/src/store.ts#L1699) `Store/backup` | `Store.sql` (1699) | CORE |
| [packages/store/src/store.ts:3149](../../packages/store/src/store.ts#L3149) `Store/blankPasswordAccounts` | `SQLite.all` (3149); `SQLite.prepare` (3149); `Store.sql` (3149) | CORE |
| [packages/store/src/store.ts:8748](../../packages/store/src/store.ts#L8748) `Store/canView` | `Store.canView` (8748); `Store.row` (8749) | GATED-STORE |
| [packages/store/src/store.ts:8730](../../packages/store/src/store.ts#L8730) `Store/canViewRecord` | `SQLite.get` (8730); `SQLite.prepare` (8730); `Store.sql` (8730) | GATED-STORE |
| [packages/store/src/store.ts:4400](../../packages/store/src/store.ts#L4400) `Store/canonicalAccount` | `SQLite.all` (4400); `SQLite.prepare` (4400); `Store.sql` (4400) | CORE |
| [packages/store/src/store.ts:9787](../../packages/store/src/store.ts#L9787) `Store/cascadeDelete` | `relatedRows` (9787) | CORE |
| [packages/store/src/store.ts:1918](../../packages/store/src/store.ts#L1918) `Store/changeOne` | `Store.sql` (1918, 1920) | CORE |
| [packages/store/src/store.ts:1921](../../packages/store/src/store.ts#L1921) `Store/changeOne/read` | `SQLite.get` (1921); `SQLite.prepare` (1921); `Store.sql` (1921) | CORE |
| [packages/store/src/store.ts:8046](../../packages/store/src/store.ts#L8046) `Store/checkContainerWrite` | `Store.row` (8046) | CORE |
| [packages/store/src/store.ts:9460](../../packages/store/src/store.ts#L9460) `Store/checkEditable` | `Store.row` (9460) | CORE |
| [packages/store/src/store.ts:1369](../../packages/store/src/store.ts#L1369) `Store/checkpoint` | `SQLite.get` (1369); `SQLite.prepare` (1369); `Store.sql` (1369) | CORE |
| [packages/store/src/store.ts:5636](../../packages/store/src/store.ts#L5636) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5636); `Store.sql` (5636) | CORE |
| [packages/store/src/store.ts:1387](../../packages/store/src/store.ts#L1387) `Store/close` | `Store.sql` (1387) | CORE |
| [packages/store/src/store.ts:8014](../../packages/store/src/store.ts#L8014) `Store/compactFile` | `Store.sql` (8014, 8015, 8017) | CORE |
| [packages/store/src/store.ts:9911](../../packages/store/src/store.ts#L9911) `Store/computeValuesCurrent` | `Store.computeValues` (9911); `Store.sql` (9917, 9921); `SQLite.all` (9921); `SQLite.prepare` (9921) | GATED-STORE |
| [packages/store/src/store.ts:8399](../../packages/store/src/store.ts#L8399) `Store/computedRows` | `Store.sql` (8399, 8402, 8403, 8404, 8406, 8416, 8417, 8418, 8421); `SQLite.prepare` (8402, 8404, 8406, 8416); `SQLite.iterate` (8406); `Calculations.globalValue` (8409); `Calculations.unstoredValue` (8410); `Calculations.related` (8413); `SQLite.all` (8416) | CORE |
| [packages/store/src/store.ts:5102](../../packages/store/src/store.ts#L5102) `Store/confirmTotp` | `SQLite.get` (5102); `SQLite.prepare` (5102, 5104); `Store.sql` (5102, 5104) | CORE |
| [packages/store/src/store.ts:1064](../../packages/store/src/store.ts#L1064) `Store/constructor` | `Store.sql` (1064, 1066, 1068, 1069, 1073, 1077, 1078, 1089, 1094, 1099, 1100, 1104, 1105, 1106, 1113, 1117, 1121, 1122, 1123, 1128, 1132, 1135, 1136, 1138, 1139, 1142, 1143, 1147, 1148, 1152, 1153, 1156, 1158, 1161, 1162, 1166, 1167, 1171, 1172, 1175, 1176, 1177, 1180, 1181, 1184, 1185, 1187, 1187, 1188, 1188, 1189, 1192, 1196, 1198, 1201, 1202, 1203, 1206, 1207, 1209, 1211, 1212, 1216, 1217, 1219, 1223, 1225, 1226, 1227, 1227, 1231, 1232); `SQLite.get` (1068); `SQLite.prepare` (1068, 1135, 1136, 1139, 1142, 1147, 1152, 1161, 1166, 1171, 1180, 1184, 1187, 1188, 1206, 1211, 1216); `SQLite.all` (1135, 1142, 1147, 1152, 1161, 1166, 1171, 1180, 1184, 1187, 1188, 1206, 1211, 1216) | CORE |
| [packages/store/src/store.ts:5446](../../packages/store/src/store.ts#L5446) `Store/consumeRecoveryCode` | `SQLite.prepare` (5446); `Store.sql` (5446) | CORE |
| [packages/store/src/store.ts:7589](../../packages/store/src/store.ts#L7589) `Store/container` | `SQLite.get` (7589); `SQLite.prepare` (7589, 7598); `Store.sql` (7589, 7598); `SQLite.all` (7598) | CORE |
| [packages/store/src/store.ts:8023](../../packages/store/src/store.ts#L8023) `Store/containerId` | `Store.containerId` (8023); `Store.row` (8024) | CORE |
| [packages/store/src/store.ts:7606](../../packages/store/src/store.ts#L7606) `Store/containerInfo` | `SQLite.get` (7606); `SQLite.prepare` (7606); `Store.sql` (7606) | CORE |
| [packages/store/src/store.ts:7570](../../packages/store/src/store.ts#L7570) `Store/containerIntact` | `SQLite.get` (7570); `SQLite.prepare` (7570); `Store.sql` (7570) | CORE |
| [packages/store/src/store.ts:7509](../../packages/store/src/store.ts#L7509) `Store/containerIntegrityReport` | `SQLite.all` (7509); `SQLite.prepare` (7509, 7520); `Store.sql` (7509, 7520); `SQLite.get` (7520) | CORE |
| [packages/store/src/store.ts:7584](../../packages/store/src/store.ts#L7584) `Store/containerMeta` | `SQLite.get` (7584); `SQLite.prepare` (7584); `Store.sql` (7584) | CORE |
| [packages/store/src/store.ts:7640](../../packages/store/src/store.ts#L7640) `Store/containerRange` | `SQLite.all` (7640); `SQLite.prepare` (7640, 7647); `Store.sql` (7640, 7647); `SQLite.get` (7647) | CORE |
| [packages/store/src/store.ts:7411](../../packages/store/src/store.ts#L7411) `Store/containerReferences` | `SQLite.all` (7411, 7430, 7432, 7438, 7451, 7462, 7476); `SQLite.prepare` (7411, 7430, 7432, 7438, 7451, 7462, 7474, 7476); `Store.sql` (7411, 7430, 7432, 7438, 7451, 7462, 7474, 7476); `SQLite.get` (7474); `Store.row` (7485) | CORE |
| [packages/store/src/store.ts:9891](../../packages/store/src/store.ts#L9891) `Store/countIds` | `Store.countIds` (9891); `SQLite.get` (9895); `SQLite.prepare` (9895); `Store.sql` (9895) | GATED-STORE |
| [packages/store/src/store.ts:8773](../../packages/store/src/store.ts#L8773) `Store/create` | `SQLite.get` (8773, 8779); `SQLite.prepare` (8773, 8779, 8792); `Store.sql` (8773, 8779, 8792) | CORE |
| [packages/store/src/store.ts:3438](../../packages/store/src/store.ts#L3438) `Store/createAccount` | `SQLite.get` (3438); `SQLite.prepare` (3438, 3442, 3448, 3453, 3458); `Store.sql` (3438, 3442, 3448, 3453, 3458) | CORE |
| [packages/store/src/store.ts:4838](../../packages/store/src/store.ts#L4838) `Store/createApiToken` | `SQLite.get` (4838, 4866); `SQLite.prepare` (4838, 4865, 4866, 4876); `Store.sql` (4838, 4865, 4866, 4876) | CORE |
| [packages/store/src/store.ts:4412](../../packages/store/src/store.ts#L4412) `Store/createLocalAccount` | `SQLite.prepare` (4412); `Store.sql` (4412) | CORE |
| [packages/store/src/store.ts:3115](../../packages/store/src/store.ts#L3115) `Store/credentialIdentity` | `SQLite.get` (3115); `SQLite.prepare` (3115); `Store.sql` (3115) | CORE |
| [packages/store/src/store.ts:1789](../../packages/store/src/store.ts#L1789) `Store/dataVersion` | `SQLite.get` (1789); `SQLite.prepare` (1789); `Store.sql` (1789) | CORE |
| [packages/store/src/store.ts:9484](../../packages/store/src/store.ts#L9484) `Store/delete` | `Store.row` (9484) | CORE |
| [packages/store/src/store.ts:9492](../../packages/store/src/store.ts#L9492) `Store/delete/run` | `SQLite.get` (9492); `SQLite.prepare` (9492, 9496); `Store.sql` (9492, 9496) | CORE |
| [packages/store/src/store.ts:4566](../../packages/store/src/store.ts#L4566) `Store/deleteAccount` | `SQLite.prepare` (4566, 4570, 4571, 4572, 4573, 4574, 4575, 4576, 4577, 4584, 4586, 4589, 4593); `Store.sql` (4566, 4570, 4571, 4572, 4573, 4574, 4575, 4576, 4577, 4584, 4586, 4589, 4593) | CORE |
| [packages/store/src/store.ts:5531](../../packages/store/src/store.ts#L5531) `Store/deletePrivilegeSet` | `SQLite.prepare` (5531); `Store.sql` (5531) | CORE |
| [packages/store/src/store.ts:3576](../../packages/store/src/store.ts#L3576) `Store/deleteScriptTest` | `SQLite.prepare` (3576); `Store.sql` (3576) | CORE |
| [packages/store/src/store.ts:2760](../../packages/store/src/store.ts#L2760) `Store/deletedRows` | `SQLite.get` (2760); `SQLite.prepare` (2760, 2762, 2762); `Store.sql` (2760, 2762, 2762); `SQLite.all` (2762, 2762) | CORE |
| [packages/store/src/store.ts:2870](../../packages/store/src/store.ts#L2870) `Store/designEffect` | `Store.sql` (2870, 2875, 2880, 2885, 2888, 2894, 2905, 2906, 2908, 2921, 2922, 2925, 2927, 2933, 2934, 2935, 2940, 2942, 2946, 2949, 2950, 2952, 2955, 2961, 2963, 2970, 2971, 2973, 2974, 2975, 2976, 2983, 2984, 2986, 2986, 2988, 2989, 2990, 2994, 2998, 3000, 3038, 3040, 3042); `SQLite.get` (2905, 2921, 2933, 2934, 2946, 2950, 2986, 2994); `SQLite.prepare` (2905, 2906, 2921, 2922, 2933, 2934, 2940, 2942, 2946, 2950, 2961, 2963, 2976, 2983, 2984, 2986, 2988, 2990, 2994, 2998); `SQLite.all` (2983, 2984); `SQLite.iterate` (2988) | CORE |
| [packages/store/src/store.ts:2863](../../packages/store/src/store.ts#L2863) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2863); `Store.sql` (2863) | CORE |
| [packages/store/src/store.ts:2847](../../packages/store/src/store.ts#L2847) `Store/designEffect/renameKey` | `SQLite.prepare` (2847); `Store.sql` (2847) | CORE |
| [packages/store/src/store.ts:2801](../../packages/store/src/store.ts#L2801) `Store/designHistory` | `SQLite.all` (2801); `SQLite.prepare` (2801); `Store.sql` (2801) | CORE |
| [packages/store/src/store.ts:5123](../../packages/store/src/store.ts#L5123) `Store/disableTotp` | `SQLite.prepare` (5123); `Store.sql` (5123) | CORE |
| [packages/store/src/store.ts:3050](../../packages/store/src/store.ts#L3050) `Store/dropColumnIndexes` | `SQLite.all` (3050, 3052); `SQLite.prepare` (3050, 3052); `Store.sql` (3050, 3052, 3053) | CORE |
| [packages/store/src/store.ts:8179](../../packages/store/src/store.ts#L8179) `Store/dropFieldIndex` | `SQLite.get` (8179); `SQLite.prepare` (8179); `Store.sql` (8179, 8180) | CORE |
| [packages/store/src/store.ts:8816](../../packages/store/src/store.ts#L8816) `Store/duplicate` | `Store.row` (8816); `SQLite.get` (8820); `SQLite.prepare` (8820, 8835); `Store.sql` (8820, 8835) | CORE |
| [packages/store/src/store.ts:7827](../../packages/store/src/store.ts#L7827) `Store/embeddedContainerCount` | `SQLite.prepare` (7827); `Store.sql` (7827); `SQLite.get` (7828) | CORE |
| [packages/store/src/store.ts:7813](../../packages/store/src/store.ts#L7813) `Store/embeddedContainers` | `SQLite.prepare` (7813, 7814); `Store.sql` (7813, 7814); `SQLite.all` (7814); `SQLite.get` (7818) | CORE |
| [packages/store/src/store.ts:2786](../../packages/store/src/store.ts#L2786) `Store/emptyDeleted` | `Store.sql` (2786, 2789, 2790, 2792, 2794); `SQLite.prepare` (2790) | CORE |
| [packages/store/src/store.ts:1669](../../packages/store/src/store.ts#L1669) `Store/endTransaction` | `Store.sql` (1669, 1672, 1672) | CORE |
| [packages/store/src/store.ts:5091](../../packages/store/src/store.ts#L5091) `Store/enrollTotp` | `SQLite.prepare` (5091); `Store.sql` (5091) | CORE |
| [packages/store/src/store.ts:2755](../../packages/store/src/store.ts#L2755) `Store/ensureDeleted` | `Store.sql` (2755) | CORE |
| [packages/store/src/store.ts:1242](../../packages/store/src/store.ts#L1242) `Store/ensureNativeIds` | `SQLite.all` (1242, 1254); `SQLite.prepare` (1242, 1245, 1253, 1254); `Store.sql` (1242, 1245, 1248, 1252, 1253, 1254, 1257, 1259) | CORE |
| [packages/store/src/store.ts:9157](../../packages/store/src/store.ts#L9157) `Store/evaluateCurrent` | `Store.row` (9157, 9157, 9158, 9158); `Calculations.context` (9163); `Store.get` (9164, 9166) | GATED-STORE |
| [packages/store/src/store.ts:9198](../../packages/store/src/store.ts#L9198) `Store/evaluateEachCurrent` | `Store.row` (9198, 9198, 9203); `Calculations.context` (9204); `Store.get` (9206) | GATED-STORE |
| [packages/store/src/store.ts:9260](../../packages/store/src/store.ts#L9260) `Store/evaluateRowsCurrent` | `Store.row` (9260, 9260, 9261, 9261) | GATED-STORE |
| [packages/store/src/store.ts:9239](../../packages/store/src/store.ts#L9239) `Store/evaluateRowsCurrent/each` | `Calculations.context` (9239); `Store.get` (9241) | GATED-STORE |
| [packages/store/src/store.ts:9275](../../packages/store/src/store.ts#L9275) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (9275) | GATED-STORE |
| [packages/store/src/store.ts:9297](../../packages/store/src/store.ts#L9297) `Store/evaluateRowsCurrent/key` | `Calculations.context` (9297) | GATED-STORE |
| [packages/store/src/store.ts:3382](../../packages/store/src/store.ts#L3382) `Store/externalAccount` | `SQLite.all` (3382); `SQLite.prepare` (3382); `Store.sql` (3382) | CORE |
| [packages/store/src/store.ts:7332](../../packages/store/src/store.ts#L7332) `Store/externalContainerCheck` | `SQLite.all` (7332); `SQLite.prepare` (7332); `Store.sql` (7332) | CORE |
| [packages/store/src/store.ts:7339](../../packages/store/src/store.ts#L7339) `Store/externalContainerCount` | `SQLite.get` (7339); `SQLite.prepare` (7339); `Store.sql` (7339) | CORE |
| [packages/store/src/store.ts:7348](../../packages/store/src/store.ts#L7348) `Store/externalContainerReport` | `SQLite.all` (7348, 7361); `SQLite.prepare` (7348, 7361); `Store.sql` (7348, 7361) | CORE |
| [packages/store/src/store.ts:4650](../../packages/store/src/store.ts#L4650) `Store/externalIdentityId` | `SQLite.get` (4650, 4656); `SQLite.prepare` (4650, 4655, 4656); `Store.sql` (4650, 4655, 4656) | CORE |
| [packages/store/src/store.ts:7580](../../packages/store/src/store.ts#L7580) `Store/externalOf` | `SQLite.get` (7580); `SQLite.prepare` (7580); `Store.sql` (7580) | CORE |
| [packages/store/src/store.ts:2693](../../packages/store/src/store.ts#L2693) `Store/failureAuditRoom` | `SQLite.get` (2693); `SQLite.prepare` (2693); `Store.sql` (2693) | CORE |
| [packages/store/src/store.ts:6992](../../packages/store/src/store.ts#L6992) `Store/fieldIndexCurrent` | `SQLite.iterate` (6992); `SQLite.prepare` (6992, 6997); `Store.sql` (6992, 6997); `SQLite.all` (6997) | GATED-STORE |
| [packages/store/src/store.ts:8214](../../packages/store/src/store.ts#L8214) `Store/find` | `Store.find` (8214) | GATED-STORE |
| [packages/store/src/store.ts:8586](../../packages/store/src/store.ts#L8586) `Store/findCandidates` | `Store.query` (8586) | CORE |
| [packages/store/src/store.ts:8225](../../packages/store/src/store.ts#L8225) `Store/findHere` | `Store.query` (8225, 8230, 8232, 8246, 8248, 8259); `Store.recordCount` (8243); `SQLite.get` (8244, 8248); `SQLite.prepare` (8244, 8248, 8254, 8261, 8270); `Store.sql` (8244, 8248, 8254, 8261, 8270); `SQLite.all` (8254, 8261, 8270) | GATED-STORE |
| [packages/store/src/store.ts:8265](../../packages/store/src/store.ts#L8265) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (8265); `SQLite.prepare` (8265); `Store.sql` (8265) | GATED-STORE |
| [packages/store/src/store.ts:9936](../../packages/store/src/store.ts#L9936) `Store/findIdsCurrent` | `Store.findIds` (9936) | GATED-STORE |
| [packages/store/src/store.ts:9942](../../packages/store/src/store.ts#L9942) `Store/findIdsHere` | `Store.query` (9942, 9947, 9949); `SQLite.iterate` (9960); `SQLite.prepare` (9960); `Store.sql` (9960) | GATED-STORE |
| [packages/store/src/store.ts:8530](../../packages/store/src/store.ts#L8530) `Store/findSource` | `Store.query` (8530); `SQLite.all` (8539, 8556); `SQLite.prepare` (8539, 8547, 8555); `Store.sql` (8539, 8544, 8547, 8552, 8555, 8569, 8571); `Calculations.globalValue` (8561); `Calculations.unstoredValue` (8562); `Calculations.related` (8566) | CORE |
| [packages/store/src/store.ts:9532](../../packages/store/src/store.ts#L9532) `Store/forgetStandInValues` | `Store.sql` (9532, 9553); `SQLite.prepare` (9553) | CORE |
| [packages/store/src/store.ts:4533](../../packages/store/src/store.ts#L4533) `Store/forgetStandIns` | `SQLite.prepare` (4533); `Store.sql` (4533) | CORE |
| [packages/store/src/store.ts:6874](../../packages/store/src/store.ts#L6874) `Store/foundSetPage` | `rowsById` (6874) | CORE |
| [packages/store/src/store.ts:6890](../../packages/store/src/store.ts#L6890) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6890); `Store.row` (6906) | GATED-STORE |
| [packages/store/src/store.ts:3301](../../packages/store/src/store.ts#L3301) `Store/gateAgentWrite` | `SQLite.get` (3301); `SQLite.prepare` (3301, 3303); `Store.sql` (3301, 3303) | CORE |
| [packages/store/src/store.ts:5384](../../packages/store/src/store.ts#L5384) `Store/generateRecoveryCodes` | `SQLite.prepare` (5384, 5387); `Store.sql` (5384, 5387) | CORE |
| [packages/store/src/store.ts:8658](../../packages/store/src/store.ts#L8658) `Store/getCurrent` | `Store.get` (8658); `Store.row` (8659, 8659, 8673); `SQLite.all` (8676); `SQLite.prepare` (8676); `Store.sql` (8676) | GATED-STORE |
| [packages/store/src/store.ts:8696](../../packages/store/src/store.ts#L8696) `Store/getManyCurrent` | `Store.getMany` (8696); `SQLite.get` (8714); `SQLite.prepare` (8714); `Store.sql` (8714) | GATED-STORE |
| [packages/store/src/store.ts:8707](../../packages/store/src/store.ts#L8707) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8707) | GATED-STORE |
| [packages/store/src/store.ts:1289](../../packages/store/src/store.ts#L1289) `Store/grantFullAccessClients` | `SQLite.prepare` (1289); `Store.sql` (1289) | CORE |
| [packages/store/src/store.ts:9977](../../packages/store/src/store.ts#L9977) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9977); `Store.viewableIds` (9982); `Calculations.collect` (9998); `rowsById` (9998, 10048); `Calculations.collector` (10020) | GATED-STORE |
| [packages/store/src/store.ts:10046](../../packages/store/src/store.ts#L10046) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (10046) | GATED-STORE |
| [packages/store/src/store.ts:10010](../../packages/store/src/store.ts#L10010) `Store/groupSummariesCurrent/key` | `Calculations.value` (10010); `Calculations.related` (10012) | GATED-STORE |
| [packages/store/src/store.ts:1297](../../packages/store/src/store.ts#L1297) `Store/hasOwnPassword` | `SQLite.get` (1297); `SQLite.prepare` (1297); `Store.sql` (1297) | CORE |
| [packages/store/src/store.ts:5248](../../packages/store/src/store.ts#L5248) `Store/hasPasskey` | `SQLite.get` (5248); `SQLite.prepare` (5248); `Store.sql` (5248) | CORE |
| [packages/store/src/store.ts:8133](../../packages/store/src/store.ts#L8133) `Store/hasTable` | `SQLite.get` (8133); `SQLite.prepare` (8133); `Store.sql` (8133) | CORE |
| [packages/store/src/store.ts:5112](../../packages/store/src/store.ts#L5112) `Store/hasTotp` | `SQLite.get` (5112); `SQLite.prepare` (5112); `Store.sql` (5112) | CORE |
| [packages/store/src/store.ts:4629](../../packages/store/src/store.ts#L4629) `Store/identityAllowed` | `SQLite.get` (4629, 4635, 4641); `SQLite.prepare` (4629, 4635, 4641); `Store.sql` (4629, 4635, 4641) | CORE |
| [packages/store/src/store.ts:6349](../../packages/store/src/store.ts#L6349) `Store/image` | `SQLite.get` (6349); `SQLite.prepare` (6349); `Store.sql` (6349) | CORE |
| [packages/store/src/store.ts:6359](../../packages/store/src/store.ts#L6359) `Store/images` | `SQLite.all` (6359); `SQLite.prepare` (6359); `Store.sql` (6359) | CORE |
| [packages/store/src/store.ts:4377](../../packages/store/src/store.ts#L4377) `Store/importAccounts` | `SQLite.all` (4377); `SQLite.prepare` (4377); `Store.sql` (4377) | CORE |
| [packages/store/src/store.ts:1538](../../packages/store/src/store.ts#L1538) `Store/independentWindowWrite` | `SQLite.get` (1538); `SQLite.prepare` (1538, 1568); `Store.sql` (1538, 1547, 1563, 1568, 1571) | CORE |
| [packages/store/src/store.ts:8145](../../packages/store/src/store.ts#L8145) `Store/indexedFields` | `SQLite.all` (8145, 8146); `SQLite.prepare` (8145, 8146); `Store.sql` (8145, 8146) | CORE |
| [packages/store/src/store.ts:10344](../../packages/store/src/store.ts#L10344) `Store/internalRoots` | `SQLite.get` (10344); `SQLite.prepare` (10344, 10346); `SQLite.all` (10346) | CORE |
| [packages/store/src/store.ts:3137](../../packages/store/src/store.ts#L3137) `Store/isAgent` | `SQLite.get` (3137); `SQLite.prepare` (3137); `Store.sql` (3137) | CORE |
| [packages/store/src/store.ts:3240](../../packages/store/src/store.ts#L3240) `Store/isExternal` | `SQLite.get` (3240); `SQLite.prepare` (3240); `Store.sql` (3240) | CORE |
| [packages/store/src/store.ts:5165](../../packages/store/src/store.ts#L5165) `Store/issueWebauthnChallenge` | `SQLite.prepare` (5165, 5167, 5168, 5170); `Store.sql` (5165, 5167, 5168, 5170); `SQLite.get` (5167) | CORE |
| [packages/store/src/store.ts:10251](../../packages/store/src/store.ts#L10251) `Store/iterateCommitted` | `SQLite.iterate` (10251) | CORE |
| [packages/store/src/store.ts:1515](../../packages/store/src/store.ts#L1515) `Store/joinTransaction` | `Store.sql` (1515, 1516, 1518, 1520, 1526) | CORE |
| [packages/store/src/store.ts:9734](../../packages/store/src/store.ts#L9734) `Store/keyStepWork` | `Store.sql` (9734, 9740, 9744, 9746) | CORE |
| [packages/store/src/store.ts:6216](../../packages/store/src/store.ts#L6216) `Store/knownSharedAccount` | `SQLite.get` (6216); `SQLite.prepare` (6216); `Store.sql` (6216) | CORE |
| [packages/store/src/store.ts:3850](../../packages/store/src/store.ts#L3850) `Store/lastSignIns` | `Store.auditLog` (3850) | CORE |
| [packages/store/src/store.ts:6389](../../packages/store/src/store.ts#L6389) `Store/layout` | `SQLite.get` (6389); `SQLite.prepare` (6389); `Store.sql` (6389) | CORE |
| [packages/store/src/store.ts:2818](../../packages/store/src/store.ts#L2818) `Store/layoutHistory` | `SQLite.all` (2818); `SQLite.prepare` (2818); `Store.sql` (2818) | CORE |
| [packages/store/src/store.ts:6279](../../packages/store/src/store.ts#L6279) `Store/layouts` | `SQLite.all` (6279); `SQLite.prepare` (6279); `Store.sql` (6279) | CORE |
| [packages/store/src/store.ts:4150](../../packages/store/src/store.ts#L4150) `Store/leastPrivilege` | `SQLite.all` (4150); `SQLite.prepare` (4150); `Store.sql` (4150) | CORE |
| [packages/store/src/store.ts:4713](../../packages/store/src/store.ts#L4713) `Store/ledgerRow` | `SQLite.get` (4713, 4714); `SQLite.prepare` (4713, 4714); `Store.sql` (4713, 4714) | AUTH |
| [packages/store/src/store.ts:4725](../../packages/store/src/store.ts#L4725) `Store/ledgerWrite` | `Store.sql` (4725, 4726, 4728, 4730, 4733, 4733) | AUTH |
| [packages/store/src/store.ts:4460](../../packages/store/src/store.ts#L4460) `Store/limitAccountImport` | `SQLite.prepare` (4460, 4461, 4464); `Store.sql` (4460, 4461, 4464); `SQLite.get` (4461) | CORE |
| [packages/store/src/store.ts:3090](../../packages/store/src/store.ts#L3090) `Store/linkIdentity` | `SQLite.get` (3090); `SQLite.prepare` (3090); `Store.sql` (3090) | CORE |
| [packages/store/src/store.ts:3082](../../packages/store/src/store.ts#L3082) `Store/linkPrincipal` | `SQLite.get` (3082); `SQLite.prepare` (3082); `Store.sql` (3082) | CORE |
| [packages/store/src/store.ts:2719](../../packages/store/src/store.ts#L2719) `Store/logSecurity` | `Store.sql` (2719) | CORE |
| [packages/store/src/store.ts:3736](../../packages/store/src/store.ts#L3736) `Store/markPiiField` | `SQLite.prepare` (3736); `Store.sql` (3736) | CORE |
| [packages/store/src/store.ts:7305](../../packages/store/src/store.ts#L7305) `Store/markRepeating` | `SQLite.prepare` (7305); `Store.sql` (7305) | CORE |
| [packages/store/src/store.ts:10184](../../packages/store/src/store.ts#L10184) `Store/matchIds` | `Store.matchIds` (10184); `SQLite.all` (10190); `SQLite.prepare` (10190); `Store.sql` (10190) | CORE |
| [packages/store/src/store.ts:1312](../../packages/store/src/store.ts#L1312) `Store/meta` | `SQLite.get` (1312); `SQLite.prepare` (1312); `Store.sql` (1312) | CORE |
| [packages/store/src/store.ts:923](../../packages/store/src/store.ts#L923) `Store/metadataVersions` | `SQLite.get` (923); `SQLite.prepare` (923); `Store.sql` (923) | CORE |
| [packages/store/src/store.ts:7942](../../packages/store/src/store.ts#L7942) `Store/moveContainersIn` | `Store.sql` (7942, 7948, 7950, 7951, 7952, 7953, 7973, 7978, 7978, 7989, 7992, 7995, 8002); `SQLite.prepare` (7950, 7951, 7952, 7953, 7989, 7995); `SQLite.get` (7955, 7989, 7995) | CORE |
| [packages/store/src/store.ts:7864](../../packages/store/src/store.ts#L7864) `Store/moveContainersOut` | `Store.sql` (7864, 7872, 7874, 7876, 7881, 7882, 7902, 7908, 7910, 7912, 7912, 7918, 7918, 7923, 7925, 7927, 7927, 7933); `SQLite.get` (7872); `SQLite.prepare` (7872, 7881, 7882); `Store.container` (7884) | CORE |
| [packages/store/src/store.ts:4331](../../packages/store/src/store.ts#L4331) `Store/mustChangePassword` | `SQLite.get` (4331); `SQLite.prepare` (4331); `Store.sql` (4331) | CORE |
| [packages/store/src/store.ts:1267](../../packages/store/src/store.ts#L1267) `Store/nativeIdGuards` | `Store.sql` (1267, 1268, 1270) | CORE |
| [packages/store/src/store.ts:4992](../../packages/store/src/store.ts#L4992) `Store/objectUseSince` | `SQLite.get` (4992); `SQLite.prepare` (4992); `Store.sql` (4992) | CORE |
| [packages/store/src/store.ts:8105](../../packages/store/src/store.ts#L8105) `Store/orderBy` | `Store.valueListItems` (8105) | CORE |
| [packages/store/src/store.ts:7497](../../packages/store/src/store.ts#L7497) `Store/orphanContainerReport` | `SQLite.all` (7497); `SQLite.prepare` (7497); `Store.sql` (7497) | CORE |
| [packages/store/src/store.ts:5217](../../packages/store/src/store.ts#L5217) `Store/passkeyAllowList` | `SQLite.all` (5217); `SQLite.prepare` (5217); `Store.sql` (5217) | CORE |
| [packages/store/src/store.ts:5253](../../packages/store/src/store.ts#L5253) `Store/passkeyIds` | `SQLite.all` (5253); `SQLite.prepare` (5253); `Store.sql` (5253) | CORE |
| [packages/store/src/store.ts:5241](../../packages/store/src/store.ts#L5241) `Store/passkeys` | `SQLite.all` (5241); `SQLite.prepare` (5241); `Store.sql` (5241) | CORE |
| [packages/store/src/store.ts:4370](../../packages/store/src/store.ts#L4370) `Store/passwordDaysRemaining` | `SQLite.get` (4370); `SQLite.prepare` (4370); `Store.sql` (4370) | CORE |
| [packages/store/src/store.ts:6174](../../packages/store/src/store.ts#L6174) `Store/passwordHash` | `SQLite.get` (6174); `SQLite.prepare` (6174); `Store.sql` (6174) | CORE |
| [packages/store/src/store.ts:3325](../../packages/store/src/store.ts#L3325) `Store/pendingChanges` | `SQLite.all` (3325); `SQLite.prepare` (3325); `Store.sql` (3325) | CORE |
| [packages/store/src/store.ts:1330](../../packages/store/src/store.ts#L1330) `Store/persistentData` | `SQLite.get` (1330) | CORE |
| [packages/store/src/store.ts:1339](../../packages/store/src/store.ts#L1339) `Store/persistentDataIds` | `SQLite.all` (1339) | CORE |
| [packages/store/src/store.ts:1320](../../packages/store/src/store.ts#L1320) `Store/persistentTable` | `Store.sql` (1320) | CORE |
| [packages/store/src/store.ts:9445](../../packages/store/src/store.ts#L9445) `Store/portalContainerTarget` | `Store.row` (9445); `relatedIdList` (9447) | CORE |
| [packages/store/src/store.ts:6929](../../packages/store/src/store.ts#L6929) `Store/portalCountsCurrent` | `Store.canView` (6929); `Store.row` (6956) | GATED-STORE |
| [packages/store/src/store.ts:7167](../../packages/store/src/store.ts#L7167) `Store/portalRows` | `relatedRows` (7167); `relatedIdList` (7168); `Store.viewableIds` (7171); `rowsById` (7196, 7234); `Calculations.related` (7210) | CORE |
| [packages/store/src/store.ts:7178](../../packages/store/src/store.ts#L7178) `Store/portalRows/context` | `Calculations.context` (7178) | CORE |
| [packages/store/src/store.ts:7188](../../packages/store/src/store.ts#L7188) `Store/portalRows/valueOf` | `Calculations.value` (7188) | CORE |
| [packages/store/src/store.ts:2253](../../packages/store/src/store.ts#L2253) `Store/prepared` | `SQLite.prepare` (2253); `Store.sql` (2253) | CORE |
| [packages/store/src/store.ts:4442](../../packages/store/src/store.ts#L4442) `Store/previewAccountImport` | `Store.sql` (4442, 4443, 4452) | CORE |
| [packages/store/src/store.ts:5997](../../packages/store/src/store.ts#L5997) `Store/previewRecordRuleCurrent` | `SQLite.get` (5997); `SQLite.prepare` (5997, 6000); `Store.sql` (5997, 6000); `SQLite.all` (6000); `Calculations.context` (6006, 6022) | CORE |
| [packages/store/src/store.ts:8621](../../packages/store/src/store.ts#L8621) `Store/previewRow` | `Store.row` (8621) | CORE |
| [packages/store/src/store.ts:5459](../../packages/store/src/store.ts#L5459) `Store/privilegeSets` | `Store.sql` (5459) | CORE |
| [packages/store/src/store.ts:2463](../../packages/store/src/store.ts#L2463) `Store/pruneAudit` | `Store.sql` (2463, 2465, 2467); `SQLite.get` (2465); `SQLite.prepare` (2465) | CORE |
| [packages/store/src/store.ts:7532](../../packages/store/src/store.ts#L7532) `Store/purgeOrphanContainers` | `Store.sql` (7532, 7536, 7545, 7548, 7549, 7554, 7555, 7557, 7557); `Store.orphanContainerReport` (7540); `SQLite.get` (7545); `SQLite.prepare` (7545, 7548, 7549) | CORE |
| [packages/store/src/store.ts:10443](../../packages/store/src/store.ts#L10443) `Store/query` | `SQLite.iterate` (10443) | CORE |
| [packages/store/src/store.ts:10477](../../packages/store/src/store.ts#L10477) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10477); `SQLite.all` (10484, 10487); `SQLite.prepare` (10484, 10487) | CORE |
| [packages/store/src/store.ts:10285](../../packages/store/src/store.ts#L10285) `Store/readOnlyChecked` | `SQLite.prepare` (10285, 10289, 10298, 10303); `SQLite.all` (10289, 10298, 10303) | CORE |
| [packages/store/src/store.ts:3062](../../packages/store/src/store.ts#L3062) `Store/recompute` | `SQLite.prepare` (3062, 3066); `Store.sql` (3062, 3066); `SQLite.iterate` (3066); `Calculations.computeStoredStyled` (3067); `Calculations.value` (3067) | CORE |
| [packages/store/src/store.ts:2268](../../packages/store/src/store.ts#L2268) `Store/recordAsOf` | `SQLite.get` (2268, 2270); `SQLite.prepare` (2268, 2270, 2272, 2273); `Store.sql` (2268, 2270, 2272, 2273); `SQLite.all` (2272, 2273) | CORE |
| [packages/store/src/store.ts:1972](../../packages/store/src/store.ts#L1972) `Store/recordCount` | `SQLite.get` (1972); `SQLite.prepare` (1972); `Store.sql` (1972) | CORE |
| [packages/store/src/store.ts:4923](../../packages/store/src/store.ts#L4923) `Store/recordObjectUse` | `Store.sql` (4923) | CORE |
| [packages/store/src/store.ts:9147](../../packages/store/src/store.ts#L9147) `Store/recordViewable` | `Store.row` (9147) | GATED-STORE |
| [packages/store/src/store.ts:1377](../../packages/store/src/store.ts#L1377) `Store/recordedFormat` | `Store.sql` (1377) | CORE |
| [packages/store/src/store.ts:7836](../../packages/store/src/store.ts#L7836) `Store/recoverContainersOut` | `SQLite.prepare` (7836); `Store.sql` (7836); `SQLite.get` (7839) | CORE |
| [packages/store/src/store.ts:1453](../../packages/store/src/store.ts#L1453) `Store/recoverPendingExternalFiles` | `Store.sql` (1453, 1455, 1479, 1481); `SQLite.prepare` (1455); `SQLite.get` (1466) | CORE |
| [packages/store/src/store.ts:5402](../../packages/store/src/store.ts#L5402) `Store/recoveryCodesRemaining` | `SQLite.get` (5402); `SQLite.prepare` (5402); `Store.sql` (5402) | CORE |
| [packages/store/src/store.ts:10325](../../packages/store/src/store.ts#L10325) `Store/refreshDecimalSqlViews` | `SQLite.get` (10325); `SQLite.prepare` (10325, 10330); `SQLite.all` (10330) | CORE |
| [packages/store/src/store.ts:3231](../../packages/store/src/store.ts#L3231) `Store/refuseLookalikeAccount` | `SQLite.all` (3231); `SQLite.prepare` (3231); `Store.sql` (3231) | CORE |
| [packages/store/src/store.ts:5275](../../packages/store/src/store.ts#L5275) `Store/registerPasskey` | `SQLite.prepare` (5275); `Store.sql` (5275) | CORE |
| [packages/store/src/store.ts:3360](../../packages/store/src/store.ts#L3360) `Store/rejectPending` | `SQLite.get` (3360); `SQLite.prepare` (3360, 3362); `Store.sql` (3360, 3362) | CORE |
| [packages/store/src/store.ts:8373](../../packages/store/src/store.ts#L8373) `Store/relatedCriteria` | `SQLite.iterate` (8373); `SQLite.prepare` (8373); `Store.sql` (8373) | CORE |
| [packages/store/src/store.ts:8370](../../packages/store/src/store.ts#L8370) `Store/relatedCriteria/matched` | `relatedRows` (8370) | CORE |
| [packages/store/src/store.ts:6717](../../packages/store/src/store.ts#L6717) `Store/relatedValues` | `Calculations.globalValue` (6717); `Calculations.unstoredValue` (6719) | CORE |
| [packages/store/src/store.ts:5286](../../packages/store/src/store.ts#L5286) `Store/removePasskey` | `SQLite.get` (5286); `SQLite.prepare` (5286, 5287); `Store.sql` (5286, 5287) | CORE |
| [packages/store/src/store.ts:9572](../../packages/store/src/store.ts#L9572) `Store/restoreDeletedRowLocked` | `SQLite.get` (9572, 9577); `SQLite.prepare` (9572, 9573, 9577, 9587); `Store.sql` (9572, 9573, 9577, 9587); `SQLite.all` (9573) | CORE |
| [packages/store/src/store.ts:2303](../../packages/store/src/store.ts#L2303) `Store/restoreRecord` | `Store.recordAsOf` (2303); `SQLite.get` (2307); `SQLite.prepare` (2307, 2311, 2320, 2331); `Store.sql` (2307, 2311, 2320, 2331) | CORE |
| [packages/store/src/store.ts:2346](../../packages/store/src/store.ts#L2346) `Store/revertAuditEntry` | `Store.auditLog` (2346) | CORE |
| [packages/store/src/store.ts:5048](../../packages/store/src/store.ts#L5048) `Store/revokeApiToken` | `SQLite.prepare` (5048); `Store.sql` (5048) | CORE |
| [packages/store/src/store.ts:8639](../../packages/store/src/store.ts#L8639) `Store/row` | `SQLite.get` (8639) | CORE |
| [packages/store/src/store.ts:5823](../../packages/store/src/store.ts#L5823) `Store/ruleOutcome` | `Calculations.context` (5823) | CORE |
| [packages/store/src/store.ts:8484](../../packages/store/src/store.ts#L8484) `Store/runningSummaryValues` | `Store.viewableIds` (8484); `rowsById` (8486); `Calculations.value` (8497, 8503); `Calculations.related` (8514) | GATED-STORE |
| [packages/store/src/store.ts:5488](../../packages/store/src/store.ts#L5488) `Store/savePrivilegeSet` | `SQLite.prepare` (5488, 5496); `Store.sql` (5488, 5496) | AUTH |
| [packages/store/src/store.ts:3567](../../packages/store/src/store.ts#L3567) `Store/saveScriptTest` | `SQLite.prepare` (3567); `Store.sql` (3567) | CORE |
| [packages/store/src/store.ts:5962](../../packages/store/src/store.ts#L5962) `Store/scopedTableSql` | `Store.viewableIds` (5962); `SQLite.all` (5965); `SQLite.prepare` (5965); `Store.sql` (5965) | GATED-STORE |
| [packages/store/src/store.ts:2808](../../packages/store/src/store.ts#L2808) `Store/scriptHistory` | `SQLite.all` (2808); `SQLite.prepare` (2808); `Store.sql` (2808) | CORE |
| [packages/store/src/store.ts:2638](../../packages/store/src/store.ts#L2638) `Store/securityChange` | `Store.sql` (2638, 2640); `SQLite.prepare` (2640) | CORE |
| [packages/store/src/store.ts:2227](../../packages/store/src/store.ts#L2227) `Store/securityEvents` | `Store.auditLog` (2227) | CORE |
| [packages/store/src/store.ts:4781](../../packages/store/src/store.ts#L4781) `Store/securityToken` | `SQLite.get` (4781); `SQLite.prepare` (4781); `Store.sql` (4781) | CORE |
| [packages/store/src/store.ts:10379](../../packages/store/src/store.ts#L10379) `Store/selectCurrent` | `SQLite.iterate` (10379) | CORE |
| [packages/store/src/store.ts:10403](../../packages/store/src/store.ts#L10403) `Store/selectHeldCurrent` | `Store.sql` (10403, 10404); `SQLite.prepare` (10404); `SQLite.iterate` (10407) | CORE |
| [packages/store/src/store.ts:9877](../../packages/store/src/store.ts#L9877) `Store/selectIdsCurrent` | `Store.selectIds` (9877); `SQLite.all` (9883); `SQLite.prepare` (9883); `Store.sql` (9883) | GATED-STORE |
| [packages/store/src/store.ts:10395](../../packages/store/src/store.ts#L10395) `Store/selectIn` | `Store.select` (10395) | CORE |
| [packages/store/src/store.ts:1719](../../packages/store/src/store.ts#L1719) `Store/selfContainedCopy` | `Store.sql` (1719); `SQLite.all` (1724); `SQLite.prepare` (1724, 1726, 1727, 1728) | CORE |
| [packages/store/src/store.ts:4610](../../packages/store/src/store.ts#L4610) `Store/setAccountActive` | `SQLite.prepare` (4610, 4613, 4614); `Store.sql` (4610, 4613, 4614) | AUTH |
| [packages/store/src/store.ts:4800](../../packages/store/src/store.ts#L4800) `Store/setAccountLocalOnly` | `SQLite.prepare` (4800); `Store.sql` (4800) | CORE |
| [packages/store/src/store.ts:5614](../../packages/store/src/store.ts#L5614) `Store/setAccountPrivilegeSet` | `SQLite.get` (5614); `SQLite.prepare` (5614, 5617, 5621); `Store.sql` (5614, 5617, 5621) | AUTH |
| [packages/store/src/store.ts:4809](../../packages/store/src/store.ts#L4809) `Store/setAccountRequire2fa` | `SQLite.prepare` (4809); `Store.sql` (4809) | CORE |
| [packages/store/src/store.ts:3261](../../packages/store/src/store.ts#L3261) `Store/setAgentAccount` | `SQLite.get` (3261); `SQLite.prepare` (3261, 3267); `Store.sql` (3261, 3267) | CORE |
| [packages/store/src/store.ts:3611](../../packages/store/src/store.ts#L3611) `Store/setAiAllowed` | `SQLite.prepare` (3611); `Store.sql` (3611) | CORE |
| [packages/store/src/store.ts:3694](../../packages/store/src/store.ts#L3694) `Store/setAiPolicy` | `SQLite.prepare` (3694); `Store.sql` (3694) | CORE |
| [packages/store/src/store.ts:6203](../../packages/store/src/store.ts#L6203) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (6203); `Store.sql` (6203) | CORE |
| [packages/store/src/store.ts:2441](../../packages/store/src/store.ts#L2441) `Store/setAuditSettings` | `SQLite.prepare` (2441); `Store.sql` (2441) | CORE |
| [packages/store/src/store.ts:8055](../../packages/store/src/store.ts#L8055) `Store/setContainer` | `Store.sql` (8055, 8072); `Store.row` (8061); `SQLite.prepare` (8072) | CORE |
| [packages/store/src/store.ts:3213](../../packages/store/src/store.ts#L3213) `Store/setExternalAccount` | `SQLite.get` (3213); `SQLite.prepare` (3213, 3218); `Store.sql` (3213, 3218) | CORE |
| [packages/store/src/store.ts:4317](../../packages/store/src/store.ts#L4317) `Store/setMustChangePassword` | `SQLite.prepare` (4317); `Store.sql` (4317) | CORE |
| [packages/store/src/store.ts:3413](../../packages/store/src/store.ts#L3413) `Store/setPassword` | `SQLite.get` (3413); `SQLite.prepare` (3413, 3415, 3424); `Store.sql` (3413, 3415, 3424) | AUTH |
| [packages/store/src/store.ts:3508](../../packages/store/src/store.ts#L3508) `Store/setPasswordPolicy` | `SQLite.prepare` (3508); `Store.sql` (3508) | CORE |
| [packages/store/src/store.ts:1345](../../packages/store/src/store.ts#L1345) `Store/setPersistentData` | `SQLite.prepare` (1345, 1349); `Store.sql` (1345, 1349) | CORE |
| [packages/store/src/store.ts:3714](../../packages/store/src/store.ts#L3714) `Store/setPiiIsolation` | `SQLite.prepare` (3714); `Store.sql` (3714) | CORE |
| [packages/store/src/store.ts:3544](../../packages/store/src/store.ts#L3544) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3544); `Store.sql` (3544) | CORE |
| [packages/store/src/store.ts:3626](../../packages/store/src/store.ts#L3626) `Store/setScriptNetwork` | `SQLite.prepare` (3626); `Store.sql` (3626) | CORE |
| [packages/store/src/store.ts:3683](../../packages/store/src/store.ts#L3683) `Store/setSqlRequiresFmxdbc` | `SQLite.prepare` (3683); `Store.sql` (3683) | CORE |
| [packages/store/src/store.ts:9068](../../packages/store/src/store.ts#L9068) `Store/setStoredCalcValues` | `SQLite.prepare` (9068, 9069); `Store.sql` (9068, 9069); `SQLite.get` (9073) | CORE |
| [packages/store/src/store.ts:8137](../../packages/store/src/store.ts#L8137) `Store/setUserPref` | `Store.sql` (8137, 8138, 8139); `SQLite.prepare` (8138, 8139) | CORE |
| [packages/store/src/store.ts:3667](../../packages/store/src/store.ts#L3667) `Store/setWebViewerHosts` | `SQLite.prepare` (3667); `Store.sql` (3667) | CORE |
| [packages/store/src/store.ts:4752](../../packages/store/src/store.ts#L4752) `Store/settleSignIns` | `SQLite.all` (4752, 4758); `SQLite.prepare` (4752, 4758, 4764, 4768, 4770); `Store.sql` (4752, 4758, 4764, 4768, 4770) | AUTH |
| [packages/store/src/store.ts:1850](../../packages/store/src/store.ts#L1850) `Store/shareResults` | `Store.sql` (1850) | CORE |
| [packages/store/src/store.ts:1403](../../packages/store/src/store.ts#L1403) `Store/shipWal` | `Store.sql` (1403) | CORE |
| [packages/store/src/store.ts:4699](../../packages/store/src/store.ts#L4699) `Store/signInBase` | `SQLite.get` (4699); `SQLite.prepare` (4699); `Store.sql` (4699) | AUTH |
| [packages/store/src/store.ts:4701](../../packages/store/src/store.ts#L4701) `Store/signInBase/identity` | `SQLite.get` (4701); `SQLite.prepare` (4701); `Store.sql` (4701) | AUTH |
| [packages/store/src/store.ts:4689](../../packages/store/src/store.ts#L4689) `Store/signInMark` | `SQLite.prepare` (4689); `Store.sql` (4689) | AUTH |
| [packages/store/src/store.ts:10102](../../packages/store/src/store.ts#L10102) `Store/sortIdsCurrentProgress` | `SQLite.all` (10102); `SQLite.prepare` (10102, 10170); `Store.sql` (10102, 10170); `Store.valueListItems` (10110); `rowsById` (10122); `Calculations.globalValue` (10125); `Calculations.unstoredValue` (10126); `Calculations.related` (10132); `SQLite.iterate` (10170) | GATED-STORE |
| [packages/store/src/store.ts:8298](../../packages/store/src/store.ts#L8298) `Store/sortedPage` | `SQLite.iterate` (8298); `SQLite.prepare` (8298, 8313); `Store.sql` (8298, 8313); `SQLite.all` (8313) | CORE |
| [packages/store/src/store.ts:8446](../../packages/store/src/store.ts#L8446) `Store/summaries` | `Calculations.wholeTable` (8446); `Calculations.collect` (8466, 8471) | CORE |
| [packages/store/src/store.ts:8462](../../packages/store/src/store.ts#L8462) `Store/summaries/recs` | `SQLite.iterate` (8462); `SQLite.prepare` (8462); `Store.sql` (8462) | CORE |
| [packages/store/src/store.ts:5231](../../packages/store/src/store.ts#L5231) `Store/takeWebauthnChallenge` | `SQLite.get` (5231); `SQLite.prepare` (5231, 5233); `Store.sql` (5231, 5233) | CORE |
| [packages/store/src/store.ts:8190](../../packages/store/src/store.ts#L8190) `Store/timeFind` | `Store.query` (8190, 8194, 8195); `Store.recordCount` (8197) | CORE |
| [packages/store/src/store.ts:6658](../../packages/store/src/store.ts#L6658) `Store/toRecord` | `Calculations.value` (6658, 6668); `Calculations.globalValue` (6662); `Calculations.unstoredStyled` (6667) | CORE |
| [packages/store/src/store.ts:5117](../../packages/store/src/store.ts#L5117) `Store/totpAccounts` | `SQLite.all` (5117); `SQLite.prepare` (5117); `Store.sql` (5117) | CORE |
| [packages/store/src/store.ts:1414](../../packages/store/src/store.ts#L1414) `Store/trial` | `Store.sql` (1414) | CORE |
| [packages/store/src/store.ts:1419](../../packages/store/src/store.ts#L1419) `Store/trial/undo` | `Store.sql` (1419) | CORE |
| [packages/store/src/store.ts:10212](../../packages/store/src/store.ts#L10212) `Store/truncate/run` | `Store.sql` (10212, 10214, 10221, 10223, 10225, 10226); `SQLite.prepare` (10214, 10221); `SQLite.all` (10216) | CORE |
| [packages/store/src/store.ts:3160](../../packages/store/src/store.ts#L3160) `Store/unmigratedAccounts` | `SQLite.all` (3160); `SQLite.prepare` (3160); `Store.sql` (3160) | CORE |
| [packages/store/src/store.ts:4223](../../packages/store/src/store.ts#L4223) `Store/unusedAccess` | `SQLite.get` (4223); `SQLite.prepare` (4223, 4232); `Store.sql` (4223, 4232); `SQLite.all` (4232) | CORE |
| [packages/store/src/store.ts:4271](../../packages/store/src/store.ts#L4271) `Store/unusedObjects` | `SQLite.get` (4271); `SQLite.prepare` (4271, 4274); `Store.sql` (4271, 4274); `SQLite.all` (4274) | CORE |
| [packages/store/src/store.ts:5343](../../packages/store/src/store.ts#L5343) `Store/unusedRecoveryHashes` | `SQLite.all` (5343); `SQLite.prepare` (5343); `Store.sql` (5343) | CORE |
| [packages/store/src/store.ts:4053](../../packages/store/src/store.ts#L4053) `Store/unusualAccess` | `Store.auditLog` (4053, 4119) | CORE |
| [packages/store/src/store.ts:8890](../../packages/store/src/store.ts#L8890) `Store/update` | `Store.row` (8890); `Store.sql` (8920, 8921, 8960, 8963) | CORE |
| [packages/store/src/store.ts:8923](../../packages/store/src/store.ts#L8923) `Store/update/undo` | `Store.sql` (8923) | CORE |
| [packages/store/src/store.ts:9353](../../packages/store/src/store.ts#L9353) `Store/updatePortals` | `Store.row` (9353, 9389); `relatedRows` (9390) | CORE |
| [packages/store/src/store.ts:9363](../../packages/store/src/store.ts#L9363) `Store/updatePortals/portal/related` | `relatedIdList` (9363) | CORE |
| [packages/store/src/store.ts:9335](../../packages/store/src/store.ts#L9335) `Store/updateRelated` | `relatedRows` (9335) | CORE |
| [packages/store/src/store.ts:4309](../../packages/store/src/store.ts#L4309) `Store/usageCounting` | `SQLite.get` (4309); `SQLite.prepare` (4309); `Store.sql` (4309) | CORE |
| [packages/store/src/store.ts:8128](../../packages/store/src/store.ts#L8128) `Store/userPrefs` | `SQLite.all` (8128); `SQLite.prepare` (8128); `Store.sql` (8128) | CORE |
| [packages/store/src/store.ts:7038](../../packages/store/src/store.ts#L7038) `Store/valueListItemsCurrent` | `Store.valueListItems` (7038); `Store.get` (7052); `relatedRows` (7053); `Store.row` (7053); `SQLite.iterate` (7055); `SQLite.prepare` (7055); `Store.sql` (7055); `Calculations.related` (7065); `Calculations.value` (7069, 7070) | GATED-STORE |
| [packages/store/src/store.ts:9525](../../packages/store/src/store.ts#L9525) `Store/vaultHeld` | `SQLite.get` (9525); `SQLite.prepare` (9525); `Store.sql` (9525) | CORE |
| [packages/store/src/store.ts:5303](../../packages/store/src/store.ts#L5303) `Store/verifyPasskeyAssertion` | `SQLite.get` (5303); `SQLite.prepare` (5303, 5314); `Store.sql` (5303, 5314) | CORE |
| [packages/store/src/store.ts:5146](../../packages/store/src/store.ts#L5146) `Store/verifyTotp` | `SQLite.get` (5146); `SQLite.prepare` (5146, 5152); `Store.sql` (5146, 5152) | CORE |
| [packages/store/src/store.ts:1905](../../packages/store/src/store.ts#L1905) `Store/versionNumber` | `SQLite.get` (1905); `SQLite.prepare` (1905); `Store.sql` (1905) | CORE |
| [packages/store/src/store.ts:1861](../../packages/store/src/store.ts#L1861) `Store/versionTriggers` | `SQLite.get` (1861); `SQLite.prepare` (1861, 1866, 1867); `Store.sql` (1861, 1866, 1867, 1884, 1886, 1887, 1889); `SQLite.all` (1866, 1867) | CORE |
| [packages/store/src/store.ts:1829](../../packages/store/src/store.ts#L1829) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1829) | CORE |
| [packages/store/src/store.ts:3649](../../packages/store/src/store.ts#L3649) `Store/webViewerChecked` | `SQLite.get` (3649); `SQLite.prepare` (3649); `Store.sql` (3649) | CORE |
| [packages/store/src/store.ts:1600](../../packages/store/src/store.ts#L1600) `Store/withWriteTransaction` | `Store.sql` (1600, 1611, 1617, 1619, 1619) | CORE |
| [packages/store/src/store.ts:6593](../../packages/store/src/store.ts#L6593) `Store/wordIndex` | `Store.sql` (6593, 6601, 6606); `Store.recordCount` (6605); `SQLite.get` (6606); `SQLite.prepare` (6606) | CORE |
| [packages/store/src/store.ts:7729](../../packages/store/src/store.ts#L7729) `Store/writeExternalFile` | `Store.evaluateEach` (7729); `SQLite.prepare` (7752); `Store.sql` (7752) | CORE |
| [packages/store/src/store.ts:7753](../../packages/store/src/store.ts#L7753) `Store/writeExternalFile/taken` | `SQLite.get` (7753) | CORE |
| [packages/store/src/store.ts:4981](../../packages/store/src/store.ts#L4981) `Store/writeObjectUseRows` | `SQLite.prepare` (4981, 4982, 4987); `Store.sql` (4981, 4982, 4987) | CORE |
| [packages/store/src/store.ts:1960](../../packages/store/src/store.ts#L1960) `Store/writeToken` | `SQLite.get` (1960); `SQLite.prepare` (1960); `Store.sql` (1960) | CORE |
| [packages/store/src/store.ts:4953](../../packages/store/src/store.ts#L4953) `Store/writeUsage` | `Store.sql` (4953, 4954, 4956, 4960, 4962) | CORE |
| [packages/store/src/store.ts:4969](../../packages/store/src/store.ts#L4969) `Store/writeUsageRows` | `SQLite.prepare` (4969, 4970, 4976); `Store.sql` (4969, 4970, 4976) | CORE |
| [packages/store/src/store.ts:6314](../../packages/store/src/store.ts#L6314) `Store/design` | `SQLite.get` (6314) | CORE |
| [packages/store/src/store.ts:6336](../../packages/store/src/store.ts#L6336) `Store/themes` | `SQLite.get` (6336) | CORE |
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
