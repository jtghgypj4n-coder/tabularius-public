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
| [packages/cli/src/main.ts:2404](../../packages/cli/src/main.ts#L2404) `main` | `Store.orphanContainerReport` (2404); `Store.auditLog` (2877); `SQLite.get` (3136); `SQLite.prepare` (3136) | OPERATOR |
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
| [packages/store/src/store.ts:4681](../../packages/store/src/store.ts#L4681) `Store/accountIdentityId` | `SQLite.get` (4681, 4686); `SQLite.prepare` (4681, 4685, 4686); `Store.sql` (4681, 4685, 4686) | CORE |
| [packages/store/src/store.ts:4644](../../packages/store/src/store.ts#L4644) `Store/accountInactive` | `SQLite.get` (4644); `SQLite.prepare` (4644); `Store.sql` (4644) | CORE |
| [packages/store/src/store.ts:4809](../../packages/store/src/store.ts#L4809) `Store/accountLocalOnly` | `SQLite.get` (4809); `SQLite.prepare` (4809); `Store.sql` (4809) | CORE |
| [packages/store/src/store.ts:5663](../../packages/store/src/store.ts#L5663) `Store/accountPrivilegeSet` | `SQLite.get` (5663); `SQLite.prepare` (5663); `Store.sql` (5663) | CORE |
| [packages/store/src/store.ts:4814](../../packages/store/src/store.ts#L4814) `Store/accountRequires2fa` | `SQLite.get` (4814); `SQLite.prepare` (4814); `Store.sql` (4814) | CORE |
| [packages/store/src/store.ts:5034](../../packages/store/src/store.ts#L5034) `Store/accountUsage` | `SQLite.get` (5034); `SQLite.prepare` (5034, 5035); `Store.sql` (5034, 5035); `SQLite.all` (5035); `Store.auditLog` (5051) | CORE |
| [packages/store/src/store.ts:3144](../../packages/store/src/store.ts#L3144) `Store/accounts` | `SQLite.all` (3144); `SQLite.prepare` (3144); `Store.sql` (3144) | CORE |
| [packages/store/src/store.ts:3140](../../packages/store/src/store.ts#L3140) `Store/accountsSharingLockout` | `SQLite.all` (3140); `SQLite.prepare` (3140); `Store.sql` (3140) | CORE |
| [packages/store/src/store.ts:7745](../../packages/store/src/store.ts#L7745) `Store/addContainer` | `SQLite.all` (7745); `SQLite.prepare` (7745, 7750, 7764, 7768, 7769); `Store.sql` (7745, 7750, 7764, 7766, 7768, 7769, 7771, 7774); `SQLite.get` (7755); `Store.containerRange` (7757) | CORE |
| [packages/store/src/store.ts:7791](../../packages/store/src/store.ts#L7791) `Store/addExternalContainer` | `SQLite.prepare` (7791); `Store.sql` (7791) | CORE |
| [packages/store/src/store.ts:8247](../../packages/store/src/store.ts#L8247) `Store/addFieldIndex` | `Store.sql` (8247) | CORE |
| [packages/store/src/store.ts:6452](../../packages/store/src/store.ts#L6452) `Store/addImage` | `Store.sql` (6452, 6453); `SQLite.prepare` (6453) | CORE |
| [packages/store/src/store.ts:5713](../../packages/store/src/store.ts#L5713) `Store/addProvisionedAccount` | `SQLite.get` (5713); `SQLite.prepare` (5713, 5717); `Store.sql` (5713, 5717) | CORE |
| [packages/store/src/store.ts:6871](../../packages/store/src/store.ts#L6871) `Store/addRelated` | `relatedRows` (6871); `rowsById` (6903); `firstRelatedEach` (6926) | CORE |
| [packages/store/src/store.ts:3162](../../packages/store/src/store.ts#L3162) `Store/agentNeedsApproval` | `SQLite.get` (3162); `SQLite.prepare` (3162); `Store.sql` (3162) | CORE |
| [packages/store/src/store.ts:5927](../../packages/store/src/store.ts#L5927) `Store/allowedIds` | `SQLite.iterate` (5927); `SQLite.prepare` (5927); `Store.sql` (5927) | CORE |
| [packages/store/src/store.ts:5091](../../packages/store/src/store.ts#L5091) `Store/apiToken` | `SQLite.get` (5091); `SQLite.prepare` (5091, 5104); `Store.sql` (5091, 5104) | CORE |
| [packages/store/src/store.ts:5067](../../packages/store/src/store.ts#L5067) `Store/apiTokens` | `SQLite.all` (5067); `SQLite.prepare` (5067); `Store.sql` (5067) | CORE |
| [packages/store/src/store.ts:3485](../../packages/store/src/store.ts#L3485) `Store/appendSecurityEvent` | `Store.sql` (3485) | CORE |
| [packages/store/src/store.ts:4490](../../packages/store/src/store.ts#L4490) `Store/applyAccountImport` | `Store.sql` (4490, 4498, 4527); `SQLite.get` (4498); `SQLite.prepare` (4498, 4527) | CORE |
| [packages/store/src/store.ts:2105](../../packages/store/src/store.ts#L2105) `Store/applyDesign` | `Store.sql` (2105, 2106, 2119, 2122, 2127, 2143, 2146, 2146); `SQLite.prepare` (2122, 2127) | CORE |
| [packages/store/src/store.ts:3358](../../packages/store/src/store.ts#L3358) `Store/approvePending` | `SQLite.get` (3358); `SQLite.prepare` (3358, 3369); `Store.sql` (3358, 3369) | CORE |
| [packages/store/src/store.ts:2564](../../packages/store/src/store.ts#L2564) `Store/audit` | `Store.sql` (2564) | CORE |
| [packages/store/src/store.ts:2205](../../packages/store/src/store.ts#L2205) `Store/auditLog` | `SQLite.all` (2205); `SQLite.prepare` (2205); `Store.sql` (2205) | CORE |
| [packages/store/src/store.ts:1716](../../packages/store/src/store.ts#L1716) `Store/backup` | `Store.sql` (1716) | CORE |
| [packages/store/src/store.ts:3168](../../packages/store/src/store.ts#L3168) `Store/blankPasswordAccounts` | `SQLite.all` (3168); `SQLite.prepare` (3168); `Store.sql` (3168) | CORE |
| [packages/store/src/store.ts:8828](../../packages/store/src/store.ts#L8828) `Store/canView` | `Store.canView` (8828); `Store.row` (8829) | GATED-STORE |
| [packages/store/src/store.ts:8810](../../packages/store/src/store.ts#L8810) `Store/canViewRecord` | `SQLite.get` (8810); `SQLite.prepare` (8810); `Store.sql` (8810) | GATED-STORE |
| [packages/store/src/store.ts:4419](../../packages/store/src/store.ts#L4419) `Store/canonicalAccount` | `SQLite.all` (4419); `SQLite.prepare` (4419); `Store.sql` (4419) | CORE |
| [packages/store/src/store.ts:9887](../../packages/store/src/store.ts#L9887) `Store/cascadeDelete` | `relatedRows` (9887) | CORE |
| [packages/store/src/store.ts:1935](../../packages/store/src/store.ts#L1935) `Store/changeOne` | `Store.sql` (1935, 1937) | CORE |
| [packages/store/src/store.ts:1938](../../packages/store/src/store.ts#L1938) `Store/changeOne/read` | `SQLite.get` (1938); `SQLite.prepare` (1938); `Store.sql` (1938) | CORE |
| [packages/store/src/store.ts:8126](../../packages/store/src/store.ts#L8126) `Store/checkContainerWrite` | `Store.row` (8126) | CORE |
| [packages/store/src/store.ts:9540](../../packages/store/src/store.ts#L9540) `Store/checkEditable` | `Store.row` (9540) | CORE |
| [packages/store/src/store.ts:1371](../../packages/store/src/store.ts#L1371) `Store/checkpoint` | `SQLite.get` (1371); `SQLite.prepare` (1371); `Store.sql` (1371) | CORE |
| [packages/store/src/store.ts:5699](../../packages/store/src/store.ts#L5699) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5699); `Store.sql` (5699) | CORE |
| [packages/store/src/store.ts:1389](../../packages/store/src/store.ts#L1389) `Store/close` | `Store.sql` (1389) | CORE |
| [packages/store/src/store.ts:8094](../../packages/store/src/store.ts#L8094) `Store/compactFile` | `Store.sql` (8094, 8095, 8097) | CORE |
| [packages/store/src/store.ts:10011](../../packages/store/src/store.ts#L10011) `Store/computeValuesCurrent` | `Store.computeValues` (10011); `Store.sql` (10017, 10021); `SQLite.all` (10021); `SQLite.prepare` (10021) | GATED-STORE |
| [packages/store/src/store.ts:8479](../../packages/store/src/store.ts#L8479) `Store/computedRows` | `Store.sql` (8479, 8482, 8483, 8484, 8486, 8496, 8497, 8498, 8501); `SQLite.prepare` (8482, 8484, 8486, 8496); `SQLite.iterate` (8486); `Calculations.globalValue` (8489); `Calculations.unstoredValue` (8490); `Calculations.related` (8493); `SQLite.all` (8496) | CORE |
| [packages/store/src/store.ts:5131](../../packages/store/src/store.ts#L5131) `Store/confirmTotp` | `SQLite.get` (5131); `SQLite.prepare` (5131, 5133); `Store.sql` (5131, 5133) | CORE |
| [packages/store/src/store.ts:1066](../../packages/store/src/store.ts#L1066) `Store/constructor` | `Store.sql` (1066, 1068, 1070, 1071, 1075, 1079, 1080, 1091, 1096, 1101, 1102, 1106, 1107, 1108, 1115, 1119, 1123, 1124, 1125, 1130, 1134, 1137, 1138, 1140, 1141, 1144, 1145, 1149, 1150, 1154, 1155, 1158, 1160, 1163, 1164, 1168, 1169, 1173, 1174, 1177, 1178, 1179, 1182, 1183, 1186, 1187, 1189, 1189, 1190, 1190, 1191, 1194, 1198, 1200, 1203, 1204, 1205, 1208, 1209, 1211, 1213, 1214, 1218, 1219, 1221, 1225, 1227, 1228, 1229, 1229, 1233, 1234); `SQLite.get` (1070); `SQLite.prepare` (1070, 1137, 1138, 1141, 1144, 1149, 1154, 1163, 1168, 1173, 1182, 1186, 1189, 1190, 1208, 1213, 1218); `SQLite.all` (1137, 1144, 1149, 1154, 1163, 1168, 1173, 1182, 1186, 1189, 1190, 1208, 1213, 1218) | CORE |
| [packages/store/src/store.ts:5480](../../packages/store/src/store.ts#L5480) `Store/consumeRecoveryCode` | `SQLite.prepare` (5480); `Store.sql` (5480) | CORE |
| [packages/store/src/store.ts:7669](../../packages/store/src/store.ts#L7669) `Store/container` | `SQLite.get` (7669); `SQLite.prepare` (7669, 7678); `Store.sql` (7669, 7678); `SQLite.all` (7678) | CORE |
| [packages/store/src/store.ts:8103](../../packages/store/src/store.ts#L8103) `Store/containerId` | `Store.containerId` (8103); `Store.row` (8104) | CORE |
| [packages/store/src/store.ts:7686](../../packages/store/src/store.ts#L7686) `Store/containerInfo` | `SQLite.get` (7686); `SQLite.prepare` (7686); `Store.sql` (7686) | CORE |
| [packages/store/src/store.ts:7650](../../packages/store/src/store.ts#L7650) `Store/containerIntact` | `SQLite.get` (7650); `SQLite.prepare` (7650); `Store.sql` (7650) | CORE |
| [packages/store/src/store.ts:7589](../../packages/store/src/store.ts#L7589) `Store/containerIntegrityReport` | `SQLite.all` (7589); `SQLite.prepare` (7589, 7600); `Store.sql` (7589, 7600); `SQLite.get` (7600) | CORE |
| [packages/store/src/store.ts:7664](../../packages/store/src/store.ts#L7664) `Store/containerMeta` | `SQLite.get` (7664); `SQLite.prepare` (7664); `Store.sql` (7664) | CORE |
| [packages/store/src/store.ts:7720](../../packages/store/src/store.ts#L7720) `Store/containerRange` | `SQLite.all` (7720); `SQLite.prepare` (7720, 7727); `Store.sql` (7720, 7727); `SQLite.get` (7727) | CORE |
| [packages/store/src/store.ts:7491](../../packages/store/src/store.ts#L7491) `Store/containerReferences` | `SQLite.all` (7491, 7510, 7512, 7518, 7531, 7542, 7556); `SQLite.prepare` (7491, 7510, 7512, 7518, 7531, 7542, 7554, 7556); `Store.sql` (7491, 7510, 7512, 7518, 7531, 7542, 7554, 7556); `SQLite.get` (7554); `Store.row` (7565) | CORE |
| [packages/store/src/store.ts:9991](../../packages/store/src/store.ts#L9991) `Store/countIds` | `Store.countIds` (9991); `SQLite.get` (9995); `SQLite.prepare` (9995); `Store.sql` (9995) | GATED-STORE |
| [packages/store/src/store.ts:8853](../../packages/store/src/store.ts#L8853) `Store/create` | `SQLite.get` (8853, 8859); `SQLite.prepare` (8853, 8859, 8872); `Store.sql` (8853, 8859, 8872) | CORE |
| [packages/store/src/store.ts:3457](../../packages/store/src/store.ts#L3457) `Store/createAccount` | `SQLite.get` (3457); `SQLite.prepare` (3457, 3461, 3467, 3472, 3477); `Store.sql` (3457, 3461, 3467, 3472, 3477) | CORE |
| [packages/store/src/store.ts:4867](../../packages/store/src/store.ts#L4867) `Store/createApiToken` | `SQLite.get` (4867, 4895); `SQLite.prepare` (4867, 4894, 4895, 4905); `Store.sql` (4867, 4894, 4895, 4905) | CORE |
| [packages/store/src/store.ts:4431](../../packages/store/src/store.ts#L4431) `Store/createLocalAccount` | `SQLite.prepare` (4431); `Store.sql` (4431) | CORE |
| [packages/store/src/store.ts:3134](../../packages/store/src/store.ts#L3134) `Store/credentialIdentity` | `SQLite.get` (3134); `SQLite.prepare` (3134); `Store.sql` (3134) | CORE |
| [packages/store/src/store.ts:1806](../../packages/store/src/store.ts#L1806) `Store/dataVersion` | `SQLite.get` (1806); `SQLite.prepare` (1806); `Store.sql` (1806) | CORE |
| [packages/store/src/store.ts:9583](../../packages/store/src/store.ts#L9583) `Store/delete` | `Store.row` (9583) | CORE |
| [packages/store/src/store.ts:9591](../../packages/store/src/store.ts#L9591) `Store/delete/run` | `SQLite.get` (9591); `SQLite.prepare` (9591, 9596); `Store.sql` (9591, 9596) | CORE |
| [packages/store/src/store.ts:4585](../../packages/store/src/store.ts#L4585) `Store/deleteAccount` | `SQLite.prepare` (4585, 4589, 4590, 4591, 4592, 4593, 4594, 4595, 4596, 4603, 4605, 4607, 4609, 4613); `Store.sql` (4585, 4589, 4590, 4591, 4592, 4593, 4594, 4595, 4596, 4603, 4605, 4607, 4609, 4613) | CORE |
| [packages/store/src/store.ts:5565](../../packages/store/src/store.ts#L5565) `Store/deletePrivilegeSet` | `SQLite.prepare` (5565); `Store.sql` (5565) | CORE |
| [packages/store/src/store.ts:3595](../../packages/store/src/store.ts#L3595) `Store/deleteScriptTest` | `SQLite.prepare` (3595); `Store.sql` (3595) | CORE |
| [packages/store/src/store.ts:2779](../../packages/store/src/store.ts#L2779) `Store/deletedRows` | `SQLite.get` (2779); `SQLite.prepare` (2779, 2781, 2781); `Store.sql` (2779, 2781, 2781); `SQLite.all` (2781, 2781) | CORE |
| [packages/store/src/store.ts:2889](../../packages/store/src/store.ts#L2889) `Store/designEffect` | `Store.sql` (2889, 2894, 2899, 2904, 2907, 2913, 2924, 2925, 2927, 2940, 2941, 2944, 2946, 2952, 2953, 2954, 2959, 2961, 2965, 2968, 2969, 2971, 2974, 2980, 2982, 2989, 2990, 2992, 2993, 2994, 2995, 3002, 3003, 3005, 3005, 3007, 3008, 3009, 3013, 3017, 3019, 3057, 3059, 3061); `SQLite.get` (2924, 2940, 2952, 2953, 2965, 2969, 3005, 3013); `SQLite.prepare` (2924, 2925, 2940, 2941, 2952, 2953, 2959, 2961, 2965, 2969, 2980, 2982, 2995, 3002, 3003, 3005, 3007, 3009, 3013, 3017); `SQLite.all` (3002, 3003); `SQLite.iterate` (3007) | CORE |
| [packages/store/src/store.ts:2882](../../packages/store/src/store.ts#L2882) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2882); `Store.sql` (2882) | CORE |
| [packages/store/src/store.ts:2866](../../packages/store/src/store.ts#L2866) `Store/designEffect/renameKey` | `SQLite.prepare` (2866); `Store.sql` (2866) | CORE |
| [packages/store/src/store.ts:2820](../../packages/store/src/store.ts#L2820) `Store/designHistory` | `SQLite.all` (2820); `SQLite.prepare` (2820); `Store.sql` (2820) | CORE |
| [packages/store/src/store.ts:5152](../../packages/store/src/store.ts#L5152) `Store/disableTotp` | `SQLite.prepare` (5152); `Store.sql` (5152) | CORE |
| [packages/store/src/store.ts:3069](../../packages/store/src/store.ts#L3069) `Store/dropColumnIndexes` | `SQLite.all` (3069, 3071); `SQLite.prepare` (3069, 3071); `Store.sql` (3069, 3071, 3072) | CORE |
| [packages/store/src/store.ts:8259](../../packages/store/src/store.ts#L8259) `Store/dropFieldIndex` | `SQLite.get` (8259); `SQLite.prepare` (8259); `Store.sql` (8259, 8260) | CORE |
| [packages/store/src/store.ts:8896](../../packages/store/src/store.ts#L8896) `Store/duplicate` | `Store.row` (8896); `SQLite.get` (8900); `SQLite.prepare` (8900, 8915); `Store.sql` (8900, 8915) | CORE |
| [packages/store/src/store.ts:7907](../../packages/store/src/store.ts#L7907) `Store/embeddedContainerCount` | `SQLite.prepare` (7907); `Store.sql` (7907); `SQLite.get` (7908) | CORE |
| [packages/store/src/store.ts:7893](../../packages/store/src/store.ts#L7893) `Store/embeddedContainers` | `SQLite.prepare` (7893, 7894); `Store.sql` (7893, 7894); `SQLite.all` (7894); `SQLite.get` (7898) | CORE |
| [packages/store/src/store.ts:2805](../../packages/store/src/store.ts#L2805) `Store/emptyDeleted` | `Store.sql` (2805, 2808, 2809, 2811, 2813); `SQLite.prepare` (2809) | CORE |
| [packages/store/src/store.ts:1686](../../packages/store/src/store.ts#L1686) `Store/endTransaction` | `Store.sql` (1686, 1689, 1689) | CORE |
| [packages/store/src/store.ts:5120](../../packages/store/src/store.ts#L5120) `Store/enrollTotp` | `SQLite.prepare` (5120); `Store.sql` (5120) | CORE |
| [packages/store/src/store.ts:2774](../../packages/store/src/store.ts#L2774) `Store/ensureDeleted` | `Store.sql` (2774) | CORE |
| [packages/store/src/store.ts:1244](../../packages/store/src/store.ts#L1244) `Store/ensureNativeIds` | `SQLite.all` (1244, 1256); `SQLite.prepare` (1244, 1247, 1255, 1256); `Store.sql` (1244, 1247, 1250, 1254, 1255, 1256, 1259, 1261) | CORE |
| [packages/store/src/store.ts:9237](../../packages/store/src/store.ts#L9237) `Store/evaluateCurrent` | `Store.row` (9237, 9237, 9238, 9238); `Calculations.context` (9243); `Store.get` (9244, 9246) | GATED-STORE |
| [packages/store/src/store.ts:9278](../../packages/store/src/store.ts#L9278) `Store/evaluateEachCurrent` | `Store.row` (9278, 9278, 9283); `Calculations.context` (9284); `Store.get` (9286) | GATED-STORE |
| [packages/store/src/store.ts:9340](../../packages/store/src/store.ts#L9340) `Store/evaluateRowsCurrent` | `Store.row` (9340, 9340, 9341, 9341) | GATED-STORE |
| [packages/store/src/store.ts:9319](../../packages/store/src/store.ts#L9319) `Store/evaluateRowsCurrent/each` | `Calculations.context` (9319); `Store.get` (9321) | GATED-STORE |
| [packages/store/src/store.ts:9355](../../packages/store/src/store.ts#L9355) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (9355) | GATED-STORE |
| [packages/store/src/store.ts:9377](../../packages/store/src/store.ts#L9377) `Store/evaluateRowsCurrent/key` | `Calculations.context` (9377) | GATED-STORE |
| [packages/store/src/store.ts:3401](../../packages/store/src/store.ts#L3401) `Store/externalAccount` | `SQLite.all` (3401); `SQLite.prepare` (3401); `Store.sql` (3401) | CORE |
| [packages/store/src/store.ts:7412](../../packages/store/src/store.ts#L7412) `Store/externalContainerCheck` | `SQLite.all` (7412); `SQLite.prepare` (7412); `Store.sql` (7412) | CORE |
| [packages/store/src/store.ts:7419](../../packages/store/src/store.ts#L7419) `Store/externalContainerCount` | `SQLite.get` (7419); `SQLite.prepare` (7419); `Store.sql` (7419) | CORE |
| [packages/store/src/store.ts:7428](../../packages/store/src/store.ts#L7428) `Store/externalContainerReport` | `SQLite.all` (7428, 7441); `SQLite.prepare` (7428, 7441); `Store.sql` (7428, 7441) | CORE |
| [packages/store/src/store.ts:4670](../../packages/store/src/store.ts#L4670) `Store/externalIdentityId` | `SQLite.get` (4670, 4676); `SQLite.prepare` (4670, 4675, 4676); `Store.sql` (4670, 4675, 4676) | CORE |
| [packages/store/src/store.ts:7660](../../packages/store/src/store.ts#L7660) `Store/externalOf` | `SQLite.get` (7660); `SQLite.prepare` (7660); `Store.sql` (7660) | CORE |
| [packages/store/src/store.ts:2712](../../packages/store/src/store.ts#L2712) `Store/failureAuditRoom` | `SQLite.get` (2712); `SQLite.prepare` (2712); `Store.sql` (2712) | CORE |
| [packages/store/src/store.ts:7072](../../packages/store/src/store.ts#L7072) `Store/fieldIndexCurrent` | `SQLite.iterate` (7072); `SQLite.prepare` (7072, 7077); `Store.sql` (7072, 7077); `SQLite.all` (7077) | GATED-STORE |
| [packages/store/src/store.ts:8294](../../packages/store/src/store.ts#L8294) `Store/find` | `Store.find` (8294) | GATED-STORE |
| [packages/store/src/store.ts:8666](../../packages/store/src/store.ts#L8666) `Store/findCandidates` | `Store.query` (8666) | CORE |
| [packages/store/src/store.ts:8305](../../packages/store/src/store.ts#L8305) `Store/findHere` | `Store.query` (8305, 8310, 8312, 8326, 8328, 8339); `Store.recordCount` (8323); `SQLite.get` (8324, 8328); `SQLite.prepare` (8324, 8328, 8334, 8341, 8350); `Store.sql` (8324, 8328, 8334, 8341, 8350); `SQLite.all` (8334, 8341, 8350) | GATED-STORE |
| [packages/store/src/store.ts:8345](../../packages/store/src/store.ts#L8345) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (8345); `SQLite.prepare` (8345); `Store.sql` (8345) | GATED-STORE |
| [packages/store/src/store.ts:10036](../../packages/store/src/store.ts#L10036) `Store/findIdsCurrent` | `Store.findIds` (10036) | GATED-STORE |
| [packages/store/src/store.ts:10042](../../packages/store/src/store.ts#L10042) `Store/findIdsHere` | `Store.query` (10042, 10047, 10049); `SQLite.iterate` (10060); `SQLite.prepare` (10060); `Store.sql` (10060) | GATED-STORE |
| [packages/store/src/store.ts:8610](../../packages/store/src/store.ts#L8610) `Store/findSource` | `Store.query` (8610); `SQLite.all` (8619, 8636); `SQLite.prepare` (8619, 8627, 8635); `Store.sql` (8619, 8624, 8627, 8632, 8635, 8649, 8651); `Calculations.globalValue` (8641); `Calculations.unstoredValue` (8642); `Calculations.related` (8646) | CORE |
| [packages/store/src/store.ts:9632](../../packages/store/src/store.ts#L9632) `Store/forgetStandInValues` | `Store.sql` (9632, 9653); `SQLite.prepare` (9653) | CORE |
| [packages/store/src/store.ts:4552](../../packages/store/src/store.ts#L4552) `Store/forgetStandIns` | `SQLite.prepare` (4552); `Store.sql` (4552) | CORE |
| [packages/store/src/store.ts:6954](../../packages/store/src/store.ts#L6954) `Store/foundSetPage` | `rowsById` (6954) | CORE |
| [packages/store/src/store.ts:6970](../../packages/store/src/store.ts#L6970) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6970); `Store.row` (6986) | GATED-STORE |
| [packages/store/src/store.ts:3320](../../packages/store/src/store.ts#L3320) `Store/gateAgentWrite` | `SQLite.get` (3320); `SQLite.prepare` (3320, 3322); `Store.sql` (3320, 3322) | CORE |
| [packages/store/src/store.ts:5418](../../packages/store/src/store.ts#L5418) `Store/generateRecoveryCodes` | `SQLite.prepare` (5418, 5421); `Store.sql` (5418, 5421) | CORE |
| [packages/store/src/store.ts:8738](../../packages/store/src/store.ts#L8738) `Store/getCurrent` | `Store.get` (8738); `Store.row` (8739, 8739, 8753); `SQLite.all` (8756); `SQLite.prepare` (8756); `Store.sql` (8756) | GATED-STORE |
| [packages/store/src/store.ts:8776](../../packages/store/src/store.ts#L8776) `Store/getManyCurrent` | `Store.getMany` (8776); `SQLite.get` (8794); `SQLite.prepare` (8794); `Store.sql` (8794) | GATED-STORE |
| [packages/store/src/store.ts:8787](../../packages/store/src/store.ts#L8787) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8787) | GATED-STORE |
| [packages/store/src/store.ts:1291](../../packages/store/src/store.ts#L1291) `Store/grantFullAccessClients` | `SQLite.prepare` (1291); `Store.sql` (1291) | CORE |
| [packages/store/src/store.ts:10077](../../packages/store/src/store.ts#L10077) `Store/groupSummariesCurrent` | `Store.groupSummaries` (10077); `Store.viewableIds` (10082); `Calculations.collect` (10098); `rowsById` (10098, 10148); `Calculations.collector` (10120) | GATED-STORE |
| [packages/store/src/store.ts:10146](../../packages/store/src/store.ts#L10146) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (10146) | GATED-STORE |
| [packages/store/src/store.ts:10110](../../packages/store/src/store.ts#L10110) `Store/groupSummariesCurrent/key` | `Calculations.value` (10110); `Calculations.related` (10112) | GATED-STORE |
| [packages/store/src/store.ts:1299](../../packages/store/src/store.ts#L1299) `Store/hasOwnPassword` | `SQLite.get` (1299); `SQLite.prepare` (1299); `Store.sql` (1299) | CORE |
| [packages/store/src/store.ts:5277](../../packages/store/src/store.ts#L5277) `Store/hasPasskey` | `SQLite.get` (5277); `SQLite.prepare` (5277); `Store.sql` (5277) | CORE |
| [packages/store/src/store.ts:8213](../../packages/store/src/store.ts#L8213) `Store/hasTable` | `SQLite.get` (8213); `SQLite.prepare` (8213); `Store.sql` (8213) | CORE |
| [packages/store/src/store.ts:5141](../../packages/store/src/store.ts#L5141) `Store/hasTotp` | `SQLite.get` (5141); `SQLite.prepare` (5141); `Store.sql` (5141) | CORE |
| [packages/store/src/store.ts:4649](../../packages/store/src/store.ts#L4649) `Store/identityAllowed` | `SQLite.get` (4649, 4655, 4661); `SQLite.prepare` (4649, 4655, 4661); `Store.sql` (4649, 4655, 4661) | CORE |
| [packages/store/src/store.ts:6429](../../packages/store/src/store.ts#L6429) `Store/image` | `SQLite.get` (6429); `SQLite.prepare` (6429); `Store.sql` (6429) | CORE |
| [packages/store/src/store.ts:6439](../../packages/store/src/store.ts#L6439) `Store/images` | `SQLite.all` (6439); `SQLite.prepare` (6439); `Store.sql` (6439) | CORE |
| [packages/store/src/store.ts:4396](../../packages/store/src/store.ts#L4396) `Store/importAccounts` | `SQLite.all` (4396); `SQLite.prepare` (4396); `Store.sql` (4396) | CORE |
| [packages/store/src/store.ts:1555](../../packages/store/src/store.ts#L1555) `Store/independentWindowWrite` | `SQLite.get` (1555); `SQLite.prepare` (1555, 1585); `Store.sql` (1555, 1564, 1580, 1585, 1588) | CORE |
| [packages/store/src/store.ts:8225](../../packages/store/src/store.ts#L8225) `Store/indexedFields` | `SQLite.all` (8225, 8226); `SQLite.prepare` (8225, 8226); `Store.sql` (8225, 8226) | CORE |
| [packages/store/src/store.ts:10444](../../packages/store/src/store.ts#L10444) `Store/internalRoots` | `SQLite.get` (10444); `SQLite.prepare` (10444, 10446); `SQLite.all` (10446) | CORE |
| [packages/store/src/store.ts:3156](../../packages/store/src/store.ts#L3156) `Store/isAgent` | `SQLite.get` (3156); `SQLite.prepare` (3156); `Store.sql` (3156) | CORE |
| [packages/store/src/store.ts:3259](../../packages/store/src/store.ts#L3259) `Store/isExternal` | `SQLite.get` (3259); `SQLite.prepare` (3259); `Store.sql` (3259) | CORE |
| [packages/store/src/store.ts:5194](../../packages/store/src/store.ts#L5194) `Store/issueWebauthnChallenge` | `SQLite.prepare` (5194, 5196, 5197, 5199); `Store.sql` (5194, 5196, 5197, 5199); `SQLite.get` (5196) | CORE |
| [packages/store/src/store.ts:10351](../../packages/store/src/store.ts#L10351) `Store/iterateCommitted` | `SQLite.iterate` (10351) | CORE |
| [packages/store/src/store.ts:1532](../../packages/store/src/store.ts#L1532) `Store/joinTransaction` | `Store.sql` (1532, 1533, 1535, 1537, 1543) | CORE |
| [packages/store/src/store.ts:9834](../../packages/store/src/store.ts#L9834) `Store/keyStepWork` | `Store.sql` (9834, 9840, 9844, 9846) | CORE |
| [packages/store/src/store.ts:6296](../../packages/store/src/store.ts#L6296) `Store/knownSharedAccount` | `SQLite.get` (6296); `SQLite.prepare` (6296); `Store.sql` (6296) | CORE |
| [packages/store/src/store.ts:3869](../../packages/store/src/store.ts#L3869) `Store/lastSignIns` | `Store.auditLog` (3869) | CORE |
| [packages/store/src/store.ts:6469](../../packages/store/src/store.ts#L6469) `Store/layout` | `SQLite.get` (6469); `SQLite.prepare` (6469); `Store.sql` (6469) | CORE |
| [packages/store/src/store.ts:2837](../../packages/store/src/store.ts#L2837) `Store/layoutHistory` | `SQLite.all` (2837); `SQLite.prepare` (2837); `Store.sql` (2837) | CORE |
| [packages/store/src/store.ts:6359](../../packages/store/src/store.ts#L6359) `Store/layouts` | `SQLite.all` (6359); `SQLite.prepare` (6359); `Store.sql` (6359) | CORE |
| [packages/store/src/store.ts:4169](../../packages/store/src/store.ts#L4169) `Store/leastPrivilege` | `SQLite.all` (4169); `SQLite.prepare` (4169); `Store.sql` (4169) | CORE |
| [packages/store/src/store.ts:4733](../../packages/store/src/store.ts#L4733) `Store/ledgerRow` | `SQLite.get` (4733, 4734); `SQLite.prepare` (4733, 4734); `Store.sql` (4733, 4734) | AUTH |
| [packages/store/src/store.ts:4745](../../packages/store/src/store.ts#L4745) `Store/ledgerWrite` | `Store.sql` (4745, 4746, 4748, 4750, 4753, 4753) | AUTH |
| [packages/store/src/store.ts:4479](../../packages/store/src/store.ts#L4479) `Store/limitAccountImport` | `SQLite.prepare` (4479, 4480, 4483); `Store.sql` (4479, 4480, 4483); `SQLite.get` (4480) | CORE |
| [packages/store/src/store.ts:3109](../../packages/store/src/store.ts#L3109) `Store/linkIdentity` | `SQLite.get` (3109); `SQLite.prepare` (3109); `Store.sql` (3109) | CORE |
| [packages/store/src/store.ts:3101](../../packages/store/src/store.ts#L3101) `Store/linkPrincipal` | `SQLite.get` (3101); `SQLite.prepare` (3101); `Store.sql` (3101) | CORE |
| [packages/store/src/store.ts:2738](../../packages/store/src/store.ts#L2738) `Store/logSecurity` | `Store.sql` (2738) | CORE |
| [packages/store/src/store.ts:3755](../../packages/store/src/store.ts#L3755) `Store/markPiiField` | `SQLite.prepare` (3755); `Store.sql` (3755) | CORE |
| [packages/store/src/store.ts:7385](../../packages/store/src/store.ts#L7385) `Store/markRepeating` | `SQLite.prepare` (7385); `Store.sql` (7385) | CORE |
| [packages/store/src/store.ts:10284](../../packages/store/src/store.ts#L10284) `Store/matchIds` | `Store.matchIds` (10284); `SQLite.all` (10290); `SQLite.prepare` (10290); `Store.sql` (10290) | CORE |
| [packages/store/src/store.ts:1314](../../packages/store/src/store.ts#L1314) `Store/meta` | `SQLite.get` (1314); `SQLite.prepare` (1314); `Store.sql` (1314) | CORE |
| [packages/store/src/store.ts:923](../../packages/store/src/store.ts#L923) `Store/metadataVersions` | `SQLite.get` (923); `SQLite.prepare` (923); `Store.sql` (923) | CORE |
| [packages/store/src/store.ts:8022](../../packages/store/src/store.ts#L8022) `Store/moveContainersIn` | `Store.sql` (8022, 8028, 8030, 8031, 8032, 8033, 8053, 8058, 8058, 8069, 8072, 8075, 8082); `SQLite.prepare` (8030, 8031, 8032, 8033, 8069, 8075); `SQLite.get` (8035, 8069, 8075) | CORE |
| [packages/store/src/store.ts:7944](../../packages/store/src/store.ts#L7944) `Store/moveContainersOut` | `Store.sql` (7944, 7952, 7954, 7956, 7961, 7962, 7982, 7988, 7990, 7992, 7992, 7998, 7998, 8003, 8005, 8007, 8007, 8013); `SQLite.get` (7952); `SQLite.prepare` (7952, 7961, 7962); `Store.container` (7964) | CORE |
| [packages/store/src/store.ts:4350](../../packages/store/src/store.ts#L4350) `Store/mustChangePassword` | `SQLite.get` (4350); `SQLite.prepare` (4350); `Store.sql` (4350) | CORE |
| [packages/store/src/store.ts:1269](../../packages/store/src/store.ts#L1269) `Store/nativeIdGuards` | `Store.sql` (1269, 1270, 1272) | CORE |
| [packages/store/src/store.ts:5021](../../packages/store/src/store.ts#L5021) `Store/objectUseSince` | `SQLite.get` (5021); `SQLite.prepare` (5021); `Store.sql` (5021) | CORE |
| [packages/store/src/store.ts:8185](../../packages/store/src/store.ts#L8185) `Store/orderBy` | `Store.valueListItems` (8185) | CORE |
| [packages/store/src/store.ts:7577](../../packages/store/src/store.ts#L7577) `Store/orphanContainerReport` | `SQLite.all` (7577); `SQLite.prepare` (7577); `Store.sql` (7577) | CORE |
| [packages/store/src/store.ts:5246](../../packages/store/src/store.ts#L5246) `Store/passkeyAllowList` | `SQLite.all` (5246); `SQLite.prepare` (5246); `Store.sql` (5246) | CORE |
| [packages/store/src/store.ts:5282](../../packages/store/src/store.ts#L5282) `Store/passkeyIds` | `SQLite.all` (5282); `SQLite.prepare` (5282); `Store.sql` (5282) | CORE |
| [packages/store/src/store.ts:5270](../../packages/store/src/store.ts#L5270) `Store/passkeys` | `SQLite.all` (5270); `SQLite.prepare` (5270); `Store.sql` (5270) | CORE |
| [packages/store/src/store.ts:4389](../../packages/store/src/store.ts#L4389) `Store/passwordDaysRemaining` | `SQLite.get` (4389); `SQLite.prepare` (4389); `Store.sql` (4389) | CORE |
| [packages/store/src/store.ts:3344](../../packages/store/src/store.ts#L3344) `Store/pendingChanges` | `SQLite.all` (3344); `SQLite.prepare` (3344); `Store.sql` (3344) | CORE |
| [packages/store/src/store.ts:1332](../../packages/store/src/store.ts#L1332) `Store/persistentData` | `SQLite.get` (1332) | CORE |
| [packages/store/src/store.ts:1341](../../packages/store/src/store.ts#L1341) `Store/persistentDataIds` | `SQLite.all` (1341) | CORE |
| [packages/store/src/store.ts:1322](../../packages/store/src/store.ts#L1322) `Store/persistentTable` | `Store.sql` (1322) | CORE |
| [packages/store/src/store.ts:9525](../../packages/store/src/store.ts#L9525) `Store/portalContainerTarget` | `Store.row` (9525); `relatedIdList` (9527) | CORE |
| [packages/store/src/store.ts:7009](../../packages/store/src/store.ts#L7009) `Store/portalCountsCurrent` | `Store.canView` (7009); `Store.row` (7036) | GATED-STORE |
| [packages/store/src/store.ts:7247](../../packages/store/src/store.ts#L7247) `Store/portalRows` | `relatedRows` (7247); `relatedIdList` (7248); `Store.viewableIds` (7251); `rowsById` (7276, 7314); `Calculations.related` (7290) | CORE |
| [packages/store/src/store.ts:7258](../../packages/store/src/store.ts#L7258) `Store/portalRows/context` | `Calculations.context` (7258) | CORE |
| [packages/store/src/store.ts:7268](../../packages/store/src/store.ts#L7268) `Store/portalRows/valueOf` | `Calculations.value` (7268) | CORE |
| [packages/store/src/store.ts:2271](../../packages/store/src/store.ts#L2271) `Store/prepared` | `SQLite.prepare` (2271); `Store.sql` (2271) | CORE |
| [packages/store/src/store.ts:4461](../../packages/store/src/store.ts#L4461) `Store/previewAccountImport` | `Store.sql` (4461, 4462, 4471) | CORE |
| [packages/store/src/store.ts:6060](../../packages/store/src/store.ts#L6060) `Store/previewRecordRuleCurrent` | `SQLite.get` (6060); `SQLite.prepare` (6060, 6063); `Store.sql` (6060, 6063); `SQLite.all` (6063); `Calculations.context` (6069, 6085) | CORE |
| [packages/store/src/store.ts:8701](../../packages/store/src/store.ts#L8701) `Store/previewRow` | `Store.row` (8701) | CORE |
| [packages/store/src/store.ts:5493](../../packages/store/src/store.ts#L5493) `Store/privilegeSets` | `Store.sql` (5493) | CORE |
| [packages/store/src/store.ts:2482](../../packages/store/src/store.ts#L2482) `Store/pruneAudit` | `Store.sql` (2482, 2484, 2486); `SQLite.get` (2484); `SQLite.prepare` (2484) | CORE |
| [packages/store/src/store.ts:7612](../../packages/store/src/store.ts#L7612) `Store/purgeOrphanContainers` | `Store.sql` (7612, 7616, 7625, 7628, 7629, 7634, 7635, 7637, 7637); `Store.orphanContainerReport` (7620); `SQLite.get` (7625); `SQLite.prepare` (7625, 7628, 7629) | CORE |
| [packages/store/src/store.ts:10543](../../packages/store/src/store.ts#L10543) `Store/query` | `SQLite.iterate` (10543) | CORE |
| [packages/store/src/store.ts:10577](../../packages/store/src/store.ts#L10577) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (10577); `SQLite.all` (10584, 10587); `SQLite.prepare` (10584, 10587) | CORE |
| [packages/store/src/store.ts:10385](../../packages/store/src/store.ts#L10385) `Store/readOnlyChecked` | `SQLite.prepare` (10385, 10389, 10398, 10403); `SQLite.all` (10389, 10398, 10403) | CORE |
| [packages/store/src/store.ts:3081](../../packages/store/src/store.ts#L3081) `Store/recompute` | `SQLite.prepare` (3081, 3085); `Store.sql` (3081, 3085); `SQLite.iterate` (3085); `Calculations.computeStoredStyled` (3086); `Calculations.value` (3086) | CORE |
| [packages/store/src/store.ts:2286](../../packages/store/src/store.ts#L2286) `Store/recordAsOf` | `SQLite.get` (2286, 2288); `SQLite.prepare` (2286, 2288, 2290, 2291); `Store.sql` (2286, 2288, 2290, 2291); `SQLite.all` (2290, 2291) | CORE |
| [packages/store/src/store.ts:1989](../../packages/store/src/store.ts#L1989) `Store/recordCount` | `SQLite.get` (1989); `SQLite.prepare` (1989); `Store.sql` (1989) | CORE |
| [packages/store/src/store.ts:4952](../../packages/store/src/store.ts#L4952) `Store/recordObjectUse` | `Store.sql` (4952) | CORE |
| [packages/store/src/store.ts:9227](../../packages/store/src/store.ts#L9227) `Store/recordViewable` | `Store.row` (9227) | GATED-STORE |
| [packages/store/src/store.ts:1379](../../packages/store/src/store.ts#L1379) `Store/recordedFormat` | `Store.sql` (1379) | CORE |
| [packages/store/src/store.ts:7916](../../packages/store/src/store.ts#L7916) `Store/recoverContainersOut` | `SQLite.prepare` (7916); `Store.sql` (7916); `SQLite.get` (7919) | CORE |
| [packages/store/src/store.ts:1461](../../packages/store/src/store.ts#L1461) `Store/recoverPendingExternalFiles` | `Store.sql` (1461, 1463, 1487, 1489); `SQLite.prepare` (1463); `SQLite.get` (1474) | CORE |
| [packages/store/src/store.ts:5436](../../packages/store/src/store.ts#L5436) `Store/recoveryCodesRemaining` | `SQLite.get` (5436); `SQLite.prepare` (5436); `Store.sql` (5436) | CORE |
| [packages/store/src/store.ts:10425](../../packages/store/src/store.ts#L10425) `Store/refreshDecimalSqlViews` | `SQLite.get` (10425); `SQLite.prepare` (10425, 10430); `SQLite.all` (10430) | CORE |
| [packages/store/src/store.ts:3250](../../packages/store/src/store.ts#L3250) `Store/refuseLookalikeAccount` | `SQLite.all` (3250); `SQLite.prepare` (3250); `Store.sql` (3250) | CORE |
| [packages/store/src/store.ts:5304](../../packages/store/src/store.ts#L5304) `Store/registerPasskey` | `SQLite.prepare` (5304); `Store.sql` (5304) | CORE |
| [packages/store/src/store.ts:3379](../../packages/store/src/store.ts#L3379) `Store/rejectPending` | `SQLite.get` (3379); `SQLite.prepare` (3379, 3381); `Store.sql` (3379, 3381) | CORE |
| [packages/store/src/store.ts:8453](../../packages/store/src/store.ts#L8453) `Store/relatedCriteria` | `SQLite.iterate` (8453); `SQLite.prepare` (8453); `Store.sql` (8453) | CORE |
| [packages/store/src/store.ts:8450](../../packages/store/src/store.ts#L8450) `Store/relatedCriteria/matched` | `relatedRows` (8450) | CORE |
| [packages/store/src/store.ts:6797](../../packages/store/src/store.ts#L6797) `Store/relatedValues` | `Calculations.globalValue` (6797); `Calculations.unstoredValue` (6799) | CORE |
| [packages/store/src/store.ts:5315](../../packages/store/src/store.ts#L5315) `Store/removePasskey` | `SQLite.get` (5315); `SQLite.prepare` (5315, 5316); `Store.sql` (5315, 5316) | CORE |
| [packages/store/src/store.ts:9672](../../packages/store/src/store.ts#L9672) `Store/restoreDeletedRowLocked` | `SQLite.get` (9672, 9677); `SQLite.prepare` (9672, 9673, 9677, 9687); `Store.sql` (9672, 9673, 9677, 9687); `SQLite.all` (9673) | CORE |
| [packages/store/src/store.ts:2321](../../packages/store/src/store.ts#L2321) `Store/restoreRecord` | `Store.recordAsOf` (2321); `SQLite.get` (2325); `SQLite.prepare` (2325, 2330, 2339, 2350); `Store.sql` (2325, 2330, 2339, 2350) | CORE |
| [packages/store/src/store.ts:2365](../../packages/store/src/store.ts#L2365) `Store/revertAuditEntry` | `Store.auditLog` (2365) | CORE |
| [packages/store/src/store.ts:5077](../../packages/store/src/store.ts#L5077) `Store/revokeApiToken` | `SQLite.prepare` (5077); `Store.sql` (5077) | CORE |
| [packages/store/src/store.ts:8719](../../packages/store/src/store.ts#L8719) `Store/row` | `SQLite.get` (8719) | CORE |
| [packages/store/src/store.ts:5886](../../packages/store/src/store.ts#L5886) `Store/ruleOutcome` | `Calculations.context` (5886) | CORE |
| [packages/store/src/store.ts:8564](../../packages/store/src/store.ts#L8564) `Store/runningSummaryValues` | `Store.viewableIds` (8564); `rowsById` (8566); `Calculations.value` (8577, 8583); `Calculations.related` (8594) | GATED-STORE |
| [packages/store/src/store.ts:5522](../../packages/store/src/store.ts#L5522) `Store/savePrivilegeSet` | `SQLite.prepare` (5522, 5530); `Store.sql` (5522, 5530) | AUTH |
| [packages/store/src/store.ts:3586](../../packages/store/src/store.ts#L3586) `Store/saveScriptTest` | `SQLite.prepare` (3586); `Store.sql` (3586) | CORE |
| [packages/store/src/store.ts:6025](../../packages/store/src/store.ts#L6025) `Store/scopedTableSql` | `Store.viewableIds` (6025); `SQLite.all` (6028); `SQLite.prepare` (6028); `Store.sql` (6028) | GATED-STORE |
| [packages/store/src/store.ts:2827](../../packages/store/src/store.ts#L2827) `Store/scriptHistory` | `SQLite.all` (2827); `SQLite.prepare` (2827); `Store.sql` (2827) | CORE |
| [packages/store/src/store.ts:2657](../../packages/store/src/store.ts#L2657) `Store/securityChange` | `Store.sql` (2657, 2659); `SQLite.prepare` (2659) | CORE |
| [packages/store/src/store.ts:2245](../../packages/store/src/store.ts#L2245) `Store/securityEvents` | `Store.auditLog` (2245) | CORE |
| [packages/store/src/store.ts:4801](../../packages/store/src/store.ts#L4801) `Store/securityToken` | `SQLite.get` (4801); `SQLite.prepare` (4801); `Store.sql` (4801) | CORE |
| [packages/store/src/store.ts:10479](../../packages/store/src/store.ts#L10479) `Store/selectCurrent` | `SQLite.iterate` (10479) | CORE |
| [packages/store/src/store.ts:10503](../../packages/store/src/store.ts#L10503) `Store/selectHeldCurrent` | `Store.sql` (10503, 10504); `SQLite.prepare` (10504); `SQLite.iterate` (10507) | CORE |
| [packages/store/src/store.ts:9977](../../packages/store/src/store.ts#L9977) `Store/selectIdsCurrent` | `Store.selectIds` (9977); `SQLite.all` (9983); `SQLite.prepare` (9983); `Store.sql` (9983) | GATED-STORE |
| [packages/store/src/store.ts:10495](../../packages/store/src/store.ts#L10495) `Store/selectIn` | `Store.select` (10495) | CORE |
| [packages/store/src/store.ts:1736](../../packages/store/src/store.ts#L1736) `Store/selfContainedCopy` | `Store.sql` (1736); `SQLite.all` (1741); `SQLite.prepare` (1741, 1743, 1744, 1745) | CORE |
| [packages/store/src/store.ts:4630](../../packages/store/src/store.ts#L4630) `Store/setAccountActive` | `SQLite.prepare` (4630, 4633, 4634); `Store.sql` (4630, 4633, 4634) | AUTH |
| [packages/store/src/store.ts:4820](../../packages/store/src/store.ts#L4820) `Store/setAccountLocalOnly` | `SQLite.prepare` (4820); `Store.sql` (4820) | CORE |
| [packages/store/src/store.ts:5677](../../packages/store/src/store.ts#L5677) `Store/setAccountPrivilegeSet` | `SQLite.get` (5677); `SQLite.prepare` (5677, 5680, 5684); `Store.sql` (5677, 5680, 5684) | AUTH |
| [packages/store/src/store.ts:4829](../../packages/store/src/store.ts#L4829) `Store/setAccountRequire2fa` | `SQLite.prepare` (4829); `Store.sql` (4829) | CORE |
| [packages/store/src/store.ts:3280](../../packages/store/src/store.ts#L3280) `Store/setAgentAccount` | `SQLite.get` (3280); `SQLite.prepare` (3280, 3286); `Store.sql` (3280, 3286) | CORE |
| [packages/store/src/store.ts:3630](../../packages/store/src/store.ts#L3630) `Store/setAiAllowed` | `SQLite.prepare` (3630); `Store.sql` (3630) | CORE |
| [packages/store/src/store.ts:3713](../../packages/store/src/store.ts#L3713) `Store/setAiPolicy` | `SQLite.prepare` (3713); `Store.sql` (3713) | CORE |
| [packages/store/src/store.ts:6283](../../packages/store/src/store.ts#L6283) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (6283); `Store.sql` (6283) | CORE |
| [packages/store/src/store.ts:2460](../../packages/store/src/store.ts#L2460) `Store/setAuditSettings` | `SQLite.prepare` (2460); `Store.sql` (2460) | CORE |
| [packages/store/src/store.ts:8135](../../packages/store/src/store.ts#L8135) `Store/setContainer` | `Store.sql` (8135, 8152); `Store.row` (8141); `SQLite.prepare` (8152) | CORE |
| [packages/store/src/store.ts:3232](../../packages/store/src/store.ts#L3232) `Store/setExternalAccount` | `SQLite.get` (3232); `SQLite.prepare` (3232, 3237); `Store.sql` (3232, 3237) | CORE |
| [packages/store/src/store.ts:4336](../../packages/store/src/store.ts#L4336) `Store/setMustChangePassword` | `SQLite.prepare` (4336); `Store.sql` (4336) | CORE |
| [packages/store/src/store.ts:3432](../../packages/store/src/store.ts#L3432) `Store/setPassword` | `SQLite.get` (3432); `SQLite.prepare` (3432, 3434, 3443); `Store.sql` (3432, 3434, 3443) | AUTH |
| [packages/store/src/store.ts:3527](../../packages/store/src/store.ts#L3527) `Store/setPasswordPolicy` | `SQLite.prepare` (3527); `Store.sql` (3527) | CORE |
| [packages/store/src/store.ts:1347](../../packages/store/src/store.ts#L1347) `Store/setPersistentData` | `SQLite.prepare` (1347, 1351); `Store.sql` (1347, 1351) | CORE |
| [packages/store/src/store.ts:3733](../../packages/store/src/store.ts#L3733) `Store/setPiiIsolation` | `SQLite.prepare` (3733); `Store.sql` (3733) | CORE |
| [packages/store/src/store.ts:3563](../../packages/store/src/store.ts#L3563) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3563); `Store.sql` (3563) | CORE |
| [packages/store/src/store.ts:3645](../../packages/store/src/store.ts#L3645) `Store/setScriptNetwork` | `SQLite.prepare` (3645); `Store.sql` (3645) | CORE |
| [packages/store/src/store.ts:3702](../../packages/store/src/store.ts#L3702) `Store/setSqlRequiresFmxdbc` | `SQLite.prepare` (3702); `Store.sql` (3702) | CORE |
| [packages/store/src/store.ts:9148](../../packages/store/src/store.ts#L9148) `Store/setStoredCalcValues` | `SQLite.prepare` (9148, 9149); `Store.sql` (9148, 9149); `SQLite.get` (9153) | CORE |
| [packages/store/src/store.ts:8217](../../packages/store/src/store.ts#L8217) `Store/setUserPref` | `Store.sql` (8217, 8218, 8219); `SQLite.prepare` (8218, 8219) | CORE |
| [packages/store/src/store.ts:3686](../../packages/store/src/store.ts#L3686) `Store/setWebViewerHosts` | `SQLite.prepare` (3686); `Store.sql` (3686) | CORE |
| [packages/store/src/store.ts:4772](../../packages/store/src/store.ts#L4772) `Store/settleSignIns` | `SQLite.all` (4772, 4778); `SQLite.prepare` (4772, 4778, 4784, 4788, 4790); `Store.sql` (4772, 4778, 4784, 4788, 4790) | AUTH |
| [packages/store/src/store.ts:1867](../../packages/store/src/store.ts#L1867) `Store/shareResults` | `Store.sql` (1867) | CORE |
| [packages/store/src/store.ts:1405](../../packages/store/src/store.ts#L1405) `Store/shipWal` | `Store.sql` (1405) | CORE |
| [packages/store/src/store.ts:4719](../../packages/store/src/store.ts#L4719) `Store/signInBase` | `SQLite.get` (4719); `SQLite.prepare` (4719); `Store.sql` (4719) | AUTH |
| [packages/store/src/store.ts:4721](../../packages/store/src/store.ts#L4721) `Store/signInBase/identity` | `SQLite.get` (4721); `SQLite.prepare` (4721); `Store.sql` (4721) | AUTH |
| [packages/store/src/store.ts:4709](../../packages/store/src/store.ts#L4709) `Store/signInMark` | `SQLite.prepare` (4709); `Store.sql` (4709) | AUTH |
| [packages/store/src/store.ts:10202](../../packages/store/src/store.ts#L10202) `Store/sortIdsCurrentProgress` | `SQLite.all` (10202); `SQLite.prepare` (10202, 10270); `Store.sql` (10202, 10270); `Store.valueListItems` (10210); `rowsById` (10222); `Calculations.globalValue` (10225); `Calculations.unstoredValue` (10226); `Calculations.related` (10232); `SQLite.iterate` (10270) | GATED-STORE |
| [packages/store/src/store.ts:8378](../../packages/store/src/store.ts#L8378) `Store/sortedPage` | `SQLite.iterate` (8378); `SQLite.prepare` (8378, 8393); `Store.sql` (8378, 8393); `SQLite.all` (8393) | CORE |
| [packages/store/src/store.ts:8526](../../packages/store/src/store.ts#L8526) `Store/summaries` | `Calculations.wholeTable` (8526); `Calculations.collect` (8546, 8551) | CORE |
| [packages/store/src/store.ts:8542](../../packages/store/src/store.ts#L8542) `Store/summaries/recs` | `SQLite.iterate` (8542); `SQLite.prepare` (8542); `Store.sql` (8542) | CORE |
| [packages/store/src/store.ts:5260](../../packages/store/src/store.ts#L5260) `Store/takeWebauthnChallenge` | `SQLite.get` (5260); `SQLite.prepare` (5260, 5262); `Store.sql` (5260, 5262) | CORE |
| [packages/store/src/store.ts:8270](../../packages/store/src/store.ts#L8270) `Store/timeFind` | `Store.query` (8270, 8274, 8275); `Store.recordCount` (8277) | CORE |
| [packages/store/src/store.ts:6738](../../packages/store/src/store.ts#L6738) `Store/toRecord` | `Calculations.value` (6738, 6748); `Calculations.globalValue` (6742); `Calculations.unstoredStyled` (6747) | CORE |
| [packages/store/src/store.ts:5146](../../packages/store/src/store.ts#L5146) `Store/totpAccounts` | `SQLite.all` (5146); `SQLite.prepare` (5146); `Store.sql` (5146) | CORE |
| [packages/store/src/store.ts:1416](../../packages/store/src/store.ts#L1416) `Store/trial` | `Store.sql` (1416) | CORE |
| [packages/store/src/store.ts:1421](../../packages/store/src/store.ts#L1421) `Store/trial/undo` | `Store.sql` (1421) | CORE |
| [packages/store/src/store.ts:10312](../../packages/store/src/store.ts#L10312) `Store/truncate/run` | `Store.sql` (10312, 10314, 10321, 10323, 10325, 10326); `SQLite.prepare` (10314, 10321); `SQLite.all` (10316) | CORE |
| [packages/store/src/store.ts:3179](../../packages/store/src/store.ts#L3179) `Store/unmigratedAccounts` | `SQLite.all` (3179); `SQLite.prepare` (3179); `Store.sql` (3179) | CORE |
| [packages/store/src/store.ts:4242](../../packages/store/src/store.ts#L4242) `Store/unusedAccess` | `SQLite.get` (4242); `SQLite.prepare` (4242, 4251); `Store.sql` (4242, 4251); `SQLite.all` (4251) | CORE |
| [packages/store/src/store.ts:4290](../../packages/store/src/store.ts#L4290) `Store/unusedObjects` | `SQLite.get` (4290); `SQLite.prepare` (4290, 4293); `Store.sql` (4290, 4293); `SQLite.all` (4293) | CORE |
| [packages/store/src/store.ts:5377](../../packages/store/src/store.ts#L5377) `Store/unusedRecoveryHashes` | `SQLite.all` (5377); `SQLite.prepare` (5377); `Store.sql` (5377) | CORE |
| [packages/store/src/store.ts:4072](../../packages/store/src/store.ts#L4072) `Store/unusualAccess` | `Store.auditLog` (4072, 4138) | CORE |
| [packages/store/src/store.ts:8970](../../packages/store/src/store.ts#L8970) `Store/update` | `Store.row` (8970); `Store.sql` (9000, 9001, 9040, 9043) | CORE |
| [packages/store/src/store.ts:9003](../../packages/store/src/store.ts#L9003) `Store/update/undo` | `Store.sql` (9003) | CORE |
| [packages/store/src/store.ts:9433](../../packages/store/src/store.ts#L9433) `Store/updatePortals` | `Store.row` (9433, 9469); `relatedRows` (9470) | CORE |
| [packages/store/src/store.ts:9443](../../packages/store/src/store.ts#L9443) `Store/updatePortals/portal/related` | `relatedIdList` (9443) | CORE |
| [packages/store/src/store.ts:9415](../../packages/store/src/store.ts#L9415) `Store/updateRelated` | `relatedRows` (9415) | CORE |
| [packages/store/src/store.ts:4328](../../packages/store/src/store.ts#L4328) `Store/usageCounting` | `SQLite.get` (4328); `SQLite.prepare` (4328); `Store.sql` (4328) | CORE |
| [packages/store/src/store.ts:8208](../../packages/store/src/store.ts#L8208) `Store/userPrefs` | `SQLite.all` (8208); `SQLite.prepare` (8208); `Store.sql` (8208) | CORE |
| [packages/store/src/store.ts:7118](../../packages/store/src/store.ts#L7118) `Store/valueListItemsCurrent` | `Store.valueListItems` (7118); `Store.get` (7132); `relatedRows` (7133); `Store.row` (7133); `SQLite.iterate` (7135); `SQLite.prepare` (7135); `Store.sql` (7135); `Calculations.related` (7145); `Calculations.value` (7149, 7150) | GATED-STORE |
| [packages/store/src/store.ts:9625](../../packages/store/src/store.ts#L9625) `Store/vaultHeld` | `SQLite.get` (9625); `SQLite.prepare` (9625); `Store.sql` (9625) | CORE |
| [packages/store/src/store.ts:5175](../../packages/store/src/store.ts#L5175) `Store/verifyTotp` | `SQLite.get` (5175); `SQLite.prepare` (5175, 5181); `Store.sql` (5175, 5181) | CORE |
| [packages/store/src/store.ts:1922](../../packages/store/src/store.ts#L1922) `Store/versionNumber` | `SQLite.get` (1922); `SQLite.prepare` (1922); `Store.sql` (1922) | CORE |
| [packages/store/src/store.ts:1878](../../packages/store/src/store.ts#L1878) `Store/versionTriggers` | `SQLite.get` (1878); `SQLite.prepare` (1878, 1883, 1884); `Store.sql` (1878, 1883, 1884, 1901, 1903, 1904, 1906); `SQLite.all` (1883, 1884) | CORE |
| [packages/store/src/store.ts:1846](../../packages/store/src/store.ts#L1846) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1846) | CORE |
| [packages/store/src/store.ts:3668](../../packages/store/src/store.ts#L3668) `Store/webViewerChecked` | `SQLite.get` (3668); `SQLite.prepare` (3668); `Store.sql` (3668) | CORE |
| [packages/store/src/store.ts:1617](../../packages/store/src/store.ts#L1617) `Store/withWriteTransaction` | `Store.sql` (1617, 1628, 1634, 1636, 1636) | CORE |
| [packages/store/src/store.ts:6673](../../packages/store/src/store.ts#L6673) `Store/wordIndex` | `Store.sql` (6673, 6681, 6686); `Store.recordCount` (6685); `SQLite.get` (6686); `SQLite.prepare` (6686) | CORE |
| [packages/store/src/store.ts:7809](../../packages/store/src/store.ts#L7809) `Store/writeExternalFile` | `Store.evaluateEach` (7809); `SQLite.prepare` (7832); `Store.sql` (7832) | CORE |
| [packages/store/src/store.ts:7833](../../packages/store/src/store.ts#L7833) `Store/writeExternalFile/taken` | `SQLite.get` (7833) | CORE |
| [packages/store/src/store.ts:5010](../../packages/store/src/store.ts#L5010) `Store/writeObjectUseRows` | `SQLite.prepare` (5010, 5011, 5016); `Store.sql` (5010, 5011, 5016) | CORE |
| [packages/store/src/store.ts:1977](../../packages/store/src/store.ts#L1977) `Store/writeToken` | `SQLite.get` (1977); `SQLite.prepare` (1977); `Store.sql` (1977) | CORE |
| [packages/store/src/store.ts:4982](../../packages/store/src/store.ts#L4982) `Store/writeUsage` | `Store.sql` (4982, 4983, 4985, 4989, 4991) | CORE |
| [packages/store/src/store.ts:4998](../../packages/store/src/store.ts#L4998) `Store/writeUsageRows` | `SQLite.prepare` (4998, 4999, 5005); `Store.sql` (4998, 4999, 5005) | CORE |
| [packages/store/src/store.ts:6394](../../packages/store/src/store.ts#L6394) `Store/design` | `SQLite.get` (6394) | CORE |
| [packages/store/src/store.ts:6416](../../packages/store/src/store.ts#L6416) `Store/themes` | `SQLite.get` (6416) | CORE |
| [packages/store/src/store.ts:5337](../../packages/store/src/store.ts#L5337) `Store/verifyPasskeyCredential` | `SQLite.get` (5337); `SQLite.prepare` (5337, 5349); `Store.sql` (5337, 5349) | CORE |
| [packages/store/src/store.ts:6254](../../packages/store/src/store.ts#L6254) `Store/passwordState` | `SQLite.get` (6254); `SQLite.prepare` (6254); `Store.sql` (6254) | CORE |
| [packages/store/src/store.ts:9568](../../packages/store/src/store.ts#L9568) `Store/deleteVisibility` | `Store.canViewRecord` (9568) | CORE |
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
