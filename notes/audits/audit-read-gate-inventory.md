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

<!-- generated read-gate inventory -->
| Function | Store read / capability (source lines) | Gate |
| --- | --- | --- |
| [packages/cli/src/diagnostics.ts:204](../../packages/cli/src/diagnostics.ts#L204) `designCopy` | `SQLite.all` (204); `SQLite.prepare` (204, 207) | OPERATOR |
| [packages/cli/src/diagnostics.ts:443](../../packages/cli/src/diagnostics.ts#L443) `diagnostics` | `SQLite.get` (443); `SQLite.prepare` (443, 447); `SQLite.all` (447) | OPERATOR |
| [packages/cli/src/doctor.ts:139](../../packages/cli/src/doctor.ts#L139) `accountChecks` | `SQLite.all` (139); `SQLite.prepare` (139) | OPERATOR |
| [packages/cli/src/main.ts:671](../../packages/cli/src/main.ts#L671) `accountsWithPasswordOff` | `SQLite.all` (671); `SQLite.prepare` (671) | OPERATOR |
| [packages/cli/src/main.ts:700](../../packages/cli/src/main.ts#L700) `hostedRead` | `SQLite.all` (700, 703); `SQLite.prepare` (700, 703); `Store.sql` (700, 703) | OPERATOR |
| [packages/cli/src/main.ts:2296](../../packages/cli/src/main.ts#L2296) `main` | `Store.orphanContainerReport` (2296); `Store.auditLog` (2759); `SQLite.get` (2975); `SQLite.prepare` (2975) | OPERATOR |
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
| [packages/server/src/admin.ts:969](../../packages/server/src/admin.ts#L969) `Admin/handle` | `Store.externalContainerReport` (969); `Store.orphanContainerReport` (974, 978) | ADMIN |
| [packages/server/src/admin.ts:2134](../../packages/server/src/admin.ts#L2134) `Admin/audit` | `Store.auditLog` (2134) | ADMIN |
| [packages/server/src/admin.ts:2217](../../packages/server/src/admin.ts#L2217) `Admin/viewAs` | `Store.find` (2217) | ADMIN |
| [packages/server/src/admin.ts:2565](../../packages/server/src/admin.ts#L2565) `Admin/status` | `Store.externalContainerCount` (2565) | ADMIN |
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
| [packages/server/src/cleanup.ts:306](../../packages/server/src/cleanup.ts#L306) `scanData` | `Store.findIds` (306); `Store.select` (312) | CLEANUP |
| [packages/server/src/cleanup.ts:563](../../packages/server/src/cleanup.ts#L563) `keyValue` | `SQLite.get` (563); `SQLite.prepare` (563); `Store.sql` (563) | CLEANUP |
| [packages/server/src/cleanup.ts:567](../../packages/server/src/cleanup.ts#L567) `relatedIds` | `SQLite.all` (567); `SQLite.prepare` (567); `Store.sql` (567) | CLEANUP |
| [packages/server/src/cleanup.ts:684](../../packages/server/src/cleanup.ts#L684) `applyCleanup/apply` | `Store.findIds` (684, 694); `SQLite.all` (685); `SQLite.prepare` (685, 722); `Store.sql` (685, 722); `SQLite.get` (722) | CLEANUP |
| [packages/server/src/cleanup.ts:753](../../packages/server/src/cleanup.ts#L753) `snapshotField` | `SQLite.all` (753); `SQLite.prepare` (753); `Store.sql` (753) | CLEANUP |
| [packages/server/src/cleanup.ts:813](../../packages/server/src/cleanup.ts#L813) `snapshotRows` | `SQLite.all` (813); `SQLite.prepare` (813); `Store.sql` (813) | CLEANUP |
| [packages/server/src/cleanup.ts:822](../../packages/server/src/cleanup.ts#L822) `journalDeletes` | `SQLite.get` (822); `SQLite.prepare` (822); `Store.sql` (822) | CLEANUP |
| [packages/server/src/cleanup.ts:872](../../packages/server/src/cleanup.ts#L872) `updateMany` | `Store.findIds` (872) | CLEANUP |
| [packages/server/src/cleanup.ts:932](../../packages/server/src/cleanup.ts#L932) `undoCleanup` | `SQLite.get` (932, 948); `SQLite.prepare` (932, 948); `Store.sql` (932, 948) | CLEANUP |
| [packages/server/src/cleanup.ts:972](../../packages/server/src/cleanup.ts#L972) `CleanupJournal/constructor` | `Store.sql` (972) | CLEANUP |
| [packages/server/src/cleanup.ts:981](../../packages/server/src/cleanup.ts#L981) `CleanupJournal/append` | `SQLite.prepare` (981); `Store.sql` (981) | CLEANUP |
| [packages/server/src/cleanup.ts:986](../../packages/server/src/cleanup.ts#L986) `CleanupJournal/add` | `SQLite.prepare` (986); `Store.sql` (986) | CLEANUP |
| [packages/server/src/cleanup.ts:992](../../packages/server/src/cleanup.ts#L992) `CleanupJournal/get` | `SQLite.get` (992); `SQLite.prepare` (992); `Store.sql` (992) | CLEANUP |
| [packages/server/src/cleanup.ts:997](../../packages/server/src/cleanup.ts#L997) `CleanupJournal/list` | `SQLite.all` (997); `SQLite.prepare` (997); `Store.sql` (997) | CLEANUP |
| [packages/server/src/cleanup.ts:1001](../../packages/server/src/cleanup.ts#L1001) `CleanupJournal/markUndone` | `SQLite.prepare` (1001); `Store.sql` (1001) | CLEANUP |
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
| [packages/server/src/import-mapping.ts:497](../../packages/server/src/import-mapping.ts#L497) `existingKeys` | `Store.viewableIds` (497); `Store.query` (499) | IMPORT |
| [packages/server/src/import-mapping.ts:759](../../packages/server/src/import-mapping.ts#L759) `applyImportRun` | `SQLite.prepare` (759); `Store.sql` (759) | IMPORT |
| [packages/server/src/import-mapping.ts:959](../../packages/server/src/import-mapping.ts#L959) `applyImportAddStream` | `SQLite.prepare` (959); `Store.sql` (959) | IMPORT |
| [packages/server/src/import-mapping.ts:776](../../packages/server/src/import-mapping.ts#L776) `targetKeys` | `SQLite.all` (776); `SQLite.prepare` (776); `Store.sql` (776) | IMPORT |
| [packages/server/src/import-mapping.ts:788](../../packages/server/src/import-mapping.ts#L788) `journal` | `Store.sql` (788, 791, 791); `SQLite.all` (791); `SQLite.prepare` (791) | IMPORT |
| [packages/server/src/import-mapping.ts:847](../../packages/server/src/import-mapping.ts#L847) `importHistory` | `SQLite.all` (847); `SQLite.prepare` (847); `Store.sql` (847) | IMPORT |
| [packages/server/src/import-mapping.ts:854](../../packages/server/src/import-mapping.ts#L854) `undoImportRun` | `SQLite.get` (854, 877); `SQLite.prepare` (854, 877, 891); `Store.sql` (854, 877, 891) | IMPORT |
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
| [packages/server/src/pgwire.ts:660](../../packages/server/src/pgwire.ts#L660) `Connection/translate` | `Calculations.translateSQL` (660) | SQL |
| [packages/server/src/pgwire.ts:686](../../packages/server/src/pgwire.ts#L686) `Connection/catalog` | `Store.describe` (686) | SQL |
| [packages/server/src/pgwire.ts:696](../../packages/server/src/pgwire.ts#L696) `Connection/run` | `Store.select` (696) | SQL |
| [packages/server/src/pgwire.ts:746](../../packages/server/src/pgwire.ts#L746) `Connection/validateSyntax` | `SQLite.prepare` (746); `Store.sql` (746) | SQL |
| [packages/server/src/pgwire.ts:943](../../packages/server/src/pgwire.ts#L943) `Connection/describe` | `Store.describe` (943) | SQL |
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
| [packages/store/src/privileges.ts:514](../../packages/store/src/privileges.ts#L514) `privilegeSets` | `SQLite.all` (514); `SQLite.prepare` (514) | AUTH |
| [packages/store/src/privileges.ts:542](../../packages/store/src/privileges.ts#L542) `ensurePrivilegeTables` | `SQLite.all` (542); `SQLite.prepare` (542) | AUTH |
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
| [packages/store/src/store.ts:1254](../../packages/store/src/store.ts#L1254) `Store/meta` | `SQLite.get` (1254); `SQLite.prepare` (1254); `Store.sql` (1254) | CORE |
| [packages/store/src/store.ts:1262](../../packages/store/src/store.ts#L1262) `Store/persistentTable` | `Store.sql` (1262) | CORE |
| [packages/store/src/store.ts:1272](../../packages/store/src/store.ts#L1272) `Store/persistentData` | `SQLite.get` (1272) | CORE |
| [packages/store/src/store.ts:1281](../../packages/store/src/store.ts#L1281) `Store/persistentDataIds` | `SQLite.all` (1281) | CORE |
| [packages/store/src/store.ts:1287](../../packages/store/src/store.ts#L1287) `Store/setPersistentData` | `SQLite.prepare` (1287, 1291); `Store.sql` (1287, 1291) | CORE |
| [packages/store/src/store.ts:1304](../../packages/store/src/store.ts#L1304) `Store/checkpoint` | `SQLite.get` (1304); `SQLite.prepare` (1304); `Store.sql` (1304) | CORE |
| [packages/store/src/store.ts:1312](../../packages/store/src/store.ts#L1312) `Store/recordedFormat` | `Store.sql` (1312) | CORE |
| [packages/store/src/store.ts:1322](../../packages/store/src/store.ts#L1322) `Store/close` | `Store.sql` (1322) | CORE |
| [packages/store/src/store.ts:1338](../../packages/store/src/store.ts#L1338) `Store/shipWal` | `Store.sql` (1338) | CORE |
| [packages/store/src/store.ts:1349](../../packages/store/src/store.ts#L1349) `Store/trial` | `Store.sql` (1349) | CORE |
| [packages/store/src/store.ts:1354](../../packages/store/src/store.ts#L1354) `Store/trial/undo` | `Store.sql` (1354) | CORE |
| [packages/store/src/store.ts:1389](../../packages/store/src/store.ts#L1389) `Store/joinTransaction` | `Store.sql` (1389, 1390, 1392, 1394, 1400) | CORE |
| [packages/store/src/store.ts:1412](../../packages/store/src/store.ts#L1412) `Store/independentWindowWrite` | `SQLite.get` (1412); `SQLite.prepare` (1412, 1435); `Store.sql` (1412, 1415, 1430, 1435, 1438) | CORE |
| [packages/store/src/store.ts:1460](../../packages/store/src/store.ts#L1460) `Store/withWriteTransaction` | `Store.sql` (1460, 1463, 1467, 1469, 1469) | CORE |
| [packages/store/src/store.ts:1499](../../packages/store/src/store.ts#L1499) `Store/endTransaction` | `Store.sql` (1499, 1502, 1502) | CORE |
| [packages/store/src/store.ts:1528](../../packages/store/src/store.ts#L1528) `Store/backup` | `Store.sql` (1528) | CORE |
| [packages/store/src/store.ts:1618](../../packages/store/src/store.ts#L1618) `Store/dataVersion` | `SQLite.get` (1618); `SQLite.prepare` (1618); `Store.sql` (1618) | CORE |
| [packages/store/src/store.ts:1658](../../packages/store/src/store.ts#L1658) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1658) | CORE |
| [packages/store/src/store.ts:1679](../../packages/store/src/store.ts#L1679) `Store/shareResults` | `Store.sql` (1679) | CORE |
| [packages/store/src/store.ts:1689](../../packages/store/src/store.ts#L1689) `Store/versionTriggers` | `SQLite.get` (1689); `SQLite.prepare` (1689, 1694, 1695); `Store.sql` (1689, 1691, 1692, 1694, 1695, 1704, 1705); `SQLite.all` (1694, 1695) | CORE |
| [packages/store/src/store.ts:1721](../../packages/store/src/store.ts#L1721) `Store/versionNumber` | `SQLite.get` (1721); `SQLite.prepare` (1721); `Store.sql` (1721) | CORE |
| [packages/store/src/store.ts:1734](../../packages/store/src/store.ts#L1734) `Store/changeOne` | `Store.sql` (1734, 1736) | CORE |
| [packages/store/src/store.ts:1737](../../packages/store/src/store.ts#L1737) `Store/changeOne/read` | `SQLite.get` (1737); `SQLite.prepare` (1737); `Store.sql` (1737) | CORE |
| [packages/store/src/store.ts:1776](../../packages/store/src/store.ts#L1776) `Store/writeToken` | `SQLite.get` (1776); `SQLite.prepare` (1776); `Store.sql` (1776) | CORE |
| [packages/store/src/store.ts:1788](../../packages/store/src/store.ts#L1788) `Store/recordCount` | `SQLite.get` (1788); `SQLite.prepare` (1788); `Store.sql` (1788) | CORE |
| [packages/store/src/store.ts:1896](../../packages/store/src/store.ts#L1896) `Store/applyDesign` | `Store.sql` (1896, 1897, 1908, 1911, 1916, 1928, 1931, 1931); `SQLite.prepare` (1911, 1916) | CORE |
| [packages/store/src/store.ts:1989](../../packages/store/src/store.ts#L1989) `Store/auditLog` | `SQLite.all` (1989); `SQLite.prepare` (1989); `Store.sql` (1989) | CORE |
| [packages/store/src/store.ts:2029](../../packages/store/src/store.ts#L2029) `Store/securityEvents` | `Store.auditLog` (2029) | CORE |
| [packages/store/src/store.ts:2055](../../packages/store/src/store.ts#L2055) `Store/prepared` | `SQLite.prepare` (2055); `Store.sql` (2055) | CORE |
| [packages/store/src/store.ts:2070](../../packages/store/src/store.ts#L2070) `Store/recordAsOf` | `SQLite.get` (2070, 2072); `SQLite.prepare` (2070, 2072, 2074, 2075); `Store.sql` (2070, 2072, 2074, 2075); `SQLite.all` (2074, 2075) | CORE |
| [packages/store/src/store.ts:2100](../../packages/store/src/store.ts#L2100) `Store/restoreRecord` | `Store.recordAsOf` (2100); `SQLite.get` (2104); `SQLite.prepare` (2104, 2107, 2114, 2122); `Store.sql` (2104, 2107, 2114, 2122) | CORE |
| [packages/store/src/store.ts:2136](../../packages/store/src/store.ts#L2136) `Store/revertAuditEntry` | `Store.auditLog` (2136) | CORE |
| [packages/store/src/store.ts:2229](../../packages/store/src/store.ts#L2229) `Store/setAuditSettings` | `SQLite.prepare` (2229); `Store.sql` (2229) | CORE |
| [packages/store/src/store.ts:2251](../../packages/store/src/store.ts#L2251) `Store/pruneAudit` | `Store.sql` (2251, 2253, 2255); `SQLite.get` (2253); `SQLite.prepare` (2253) | CORE |
| [packages/store/src/store.ts:2333](../../packages/store/src/store.ts#L2333) `Store/audit` | `Store.sql` (2333) | CORE |
| [packages/store/src/store.ts:2422](../../packages/store/src/store.ts#L2422) `Store/securityChange` | `Store.sql` (2422, 2424); `SQLite.prepare` (2424) | CORE |
| [packages/store/src/store.ts:2471](../../packages/store/src/store.ts#L2471) `Store/logSecurity` | `Store.sql` (2471) | CORE |
| [packages/store/src/store.ts:2494](../../packages/store/src/store.ts#L2494) `Store/ensureDeleted` | `Store.sql` (2494) | CORE |
| [packages/store/src/store.ts:2499](../../packages/store/src/store.ts#L2499) `Store/deletedRows` | `SQLite.get` (2499); `SQLite.prepare` (2499, 2501, 2501); `Store.sql` (2499, 2501, 2501); `SQLite.all` (2501, 2501) | CORE |
| [packages/store/src/store.ts:2525](../../packages/store/src/store.ts#L2525) `Store/emptyDeleted` | `Store.sql` (2525, 2528, 2529, 2531, 2533); `SQLite.prepare` (2529) | CORE |
| [packages/store/src/store.ts:2540](../../packages/store/src/store.ts#L2540) `Store/designHistory` | `SQLite.all` (2540); `SQLite.prepare` (2540); `Store.sql` (2540) | CORE |
| [packages/store/src/store.ts:2547](../../packages/store/src/store.ts#L2547) `Store/scriptHistory` | `SQLite.all` (2547); `SQLite.prepare` (2547); `Store.sql` (2547) | CORE |
| [packages/store/src/store.ts:2557](../../packages/store/src/store.ts#L2557) `Store/layoutHistory` | `SQLite.all` (2557); `SQLite.prepare` (2557); `Store.sql` (2557) | CORE |
| [packages/store/src/store.ts:2586](../../packages/store/src/store.ts#L2586) `Store/designEffect/renameKey` | `SQLite.prepare` (2586); `Store.sql` (2586) | CORE |
| [packages/store/src/store.ts:2602](../../packages/store/src/store.ts#L2602) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2602); `Store.sql` (2602) | CORE |
| [packages/store/src/store.ts:2609](../../packages/store/src/store.ts#L2609) `Store/designEffect` | `Store.sql` (2609, 2614, 2619, 2624, 2627, 2633, 2644, 2645, 2647, 2660, 2661, 2664, 2666, 2672, 2673, 2674, 2679, 2681, 2685, 2688, 2689, 2691, 2694, 2700, 2702, 2709, 2710, 2712, 2713, 2714, 2715, 2722, 2723, 2725, 2725, 2727, 2728, 2729, 2733, 2737, 2739, 2777, 2779, 2781); `SQLite.get` (2644, 2660, 2672, 2673, 2685, 2689, 2725, 2733); `SQLite.prepare` (2644, 2645, 2660, 2661, 2672, 2673, 2679, 2681, 2685, 2689, 2700, 2702, 2715, 2722, 2723, 2725, 2727, 2729, 2733, 2737); `SQLite.all` (2722, 2723); `SQLite.iterate` (2727) | CORE |
| [packages/store/src/store.ts:2789](../../packages/store/src/store.ts#L2789) `Store/dropColumnIndexes` | `SQLite.all` (2789, 2791); `SQLite.prepare` (2789, 2791); `Store.sql` (2789, 2791, 2792) | CORE |
| [packages/store/src/store.ts:2801](../../packages/store/src/store.ts#L2801) `Store/recompute` | `SQLite.prepare` (2801, 2805); `Store.sql` (2801, 2805); `SQLite.iterate` (2805); `Calculations.computeStoredStyled` (2806); `Calculations.value` (2806) | CORE |
| [packages/store/src/store.ts:2821](../../packages/store/src/store.ts#L2821) `Store/linkPrincipal` | `SQLite.get` (2821); `SQLite.prepare` (2821); `Store.sql` (2821) | CORE |
| [packages/store/src/store.ts:2828](../../packages/store/src/store.ts#L2828) `Store/linkIdentity` | `SQLite.get` (2828); `SQLite.prepare` (2828); `Store.sql` (2828) | CORE |
| [packages/store/src/store.ts:2834](../../packages/store/src/store.ts#L2834) `Store/accountsSharingLockout` | `SQLite.all` (2834); `SQLite.prepare` (2834); `Store.sql` (2834) | CORE |
| [packages/store/src/store.ts:2838](../../packages/store/src/store.ts#L2838) `Store/accounts` | `SQLite.all` (2838); `SQLite.prepare` (2838); `Store.sql` (2838) | CORE |
| [packages/store/src/store.ts:2850](../../packages/store/src/store.ts#L2850) `Store/isAgent` | `SQLite.get` (2850); `SQLite.prepare` (2850); `Store.sql` (2850) | CORE |
| [packages/store/src/store.ts:2856](../../packages/store/src/store.ts#L2856) `Store/agentNeedsApproval` | `SQLite.get` (2856); `SQLite.prepare` (2856); `Store.sql` (2856) | CORE |
| [packages/store/src/store.ts:2862](../../packages/store/src/store.ts#L2862) `Store/blankPasswordAccounts` | `SQLite.all` (2862); `SQLite.prepare` (2862); `Store.sql` (2862) | CORE |
| [packages/store/src/store.ts:1239](../../packages/store/src/store.ts#L1239) `Store/hasOwnPassword` | `SQLite.get` (1239); `SQLite.prepare` (1239); `Store.sql` (1239) | CORE |
| [packages/store/src/store.ts:2873](../../packages/store/src/store.ts#L2873) `Store/unmigratedAccounts` | `SQLite.all` (2873); `SQLite.prepare` (2873); `Store.sql` (2873) | CORE |
| [packages/store/src/store.ts:2926](../../packages/store/src/store.ts#L2926) `Store/setExternalAccount` | `SQLite.get` (2926); `SQLite.prepare` (2926, 2931); `Store.sql` (2926, 2931) | CORE |
| [packages/store/src/store.ts:2944](../../packages/store/src/store.ts#L2944) `Store/refuseLookalikeAccount` | `SQLite.all` (2944); `SQLite.prepare` (2944); `Store.sql` (2944) | CORE |
| [packages/store/src/store.ts:2953](../../packages/store/src/store.ts#L2953) `Store/isExternal` | `SQLite.get` (2953); `SQLite.prepare` (2953); `Store.sql` (2953) | CORE |
| [packages/store/src/store.ts:2974](../../packages/store/src/store.ts#L2974) `Store/setAgentAccount` | `SQLite.get` (2974); `SQLite.prepare` (2974, 2980); `Store.sql` (2974, 2980) | CORE |
| [packages/store/src/store.ts:3014](../../packages/store/src/store.ts#L3014) `Store/gateAgentWrite` | `SQLite.prepare` (3014); `Store.sql` (3014) | CORE |
| [packages/store/src/store.ts:3036](../../packages/store/src/store.ts#L3036) `Store/pendingChanges` | `SQLite.all` (3036); `SQLite.prepare` (3036); `Store.sql` (3036) | CORE |
| [packages/store/src/store.ts:3050](../../packages/store/src/store.ts#L3050) `Store/approvePending` | `SQLite.get` (3050); `SQLite.prepare` (3050, 3061); `Store.sql` (3050, 3061) | CORE |
| [packages/store/src/store.ts:3071](../../packages/store/src/store.ts#L3071) `Store/rejectPending` | `SQLite.get` (3071); `SQLite.prepare` (3071, 3073); `Store.sql` (3071, 3073) | CORE |
| [packages/store/src/store.ts:3093](../../packages/store/src/store.ts#L3093) `Store/externalAccount` | `SQLite.all` (3093); `SQLite.prepare` (3093); `Store.sql` (3093) | CORE |
| [packages/store/src/store.ts:3124](../../packages/store/src/store.ts#L3124) `Store/setPassword` | `SQLite.get` (3124); `SQLite.prepare` (3124, 3126, 3135); `Store.sql` (3124, 3126, 3135) | AUTH |
| [packages/store/src/store.ts:3149](../../packages/store/src/store.ts#L3149) `Store/createAccount` | `SQLite.get` (3149); `SQLite.prepare` (3149, 3153, 3159, 3164, 3169); `Store.sql` (3149, 3153, 3159, 3164, 3169) | CORE |
| [packages/store/src/store.ts:3177](../../packages/store/src/store.ts#L3177) `Store/appendSecurityEvent` | `Store.sql` (3177) | CORE |
| [packages/store/src/store.ts:3219](../../packages/store/src/store.ts#L3219) `Store/setPasswordPolicy` | `SQLite.prepare` (3219); `Store.sql` (3219) | CORE |
| [packages/store/src/store.ts:3255](../../packages/store/src/store.ts#L3255) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3255); `Store.sql` (3255) | CORE |
| [packages/store/src/store.ts:3278](../../packages/store/src/store.ts#L3278) `Store/saveScriptTest` | `SQLite.prepare` (3278); `Store.sql` (3278) | CORE |
| [packages/store/src/store.ts:3287](../../packages/store/src/store.ts#L3287) `Store/deleteScriptTest` | `SQLite.prepare` (3287); `Store.sql` (3287) | CORE |
| [packages/store/src/store.ts:3322](../../packages/store/src/store.ts#L3322) `Store/setAiAllowed` | `SQLite.prepare` (3322); `Store.sql` (3322) | CORE |
| [packages/store/src/store.ts:3368](../../packages/store/src/store.ts#L3368) `Store/setAiPolicy` | `SQLite.prepare` (3368); `Store.sql` (3368) | CORE |
| [packages/store/src/store.ts:3337](../../packages/store/src/store.ts#L3337) `Store/setScriptNetwork` | `SQLite.prepare` (3337); `Store.sql` (3337) | CORE |
| [packages/store/src/store.ts:3357](../../packages/store/src/store.ts#L3357) `Store/setWebViewerHosts` | `SQLite.prepare` (3357); `Store.sql` (3357) | CORE |
| [packages/store/src/store.ts:3388](../../packages/store/src/store.ts#L3388) `Store/setPiiIsolation` | `SQLite.prepare` (3388); `Store.sql` (3388) | CORE |
| [packages/store/src/store.ts:3410](../../packages/store/src/store.ts#L3410) `Store/markPiiField` | `SQLite.prepare` (3410); `Store.sql` (3410) | CORE |
| [packages/store/src/store.ts:3524](../../packages/store/src/store.ts#L3524) `Store/lastSignIns` | `Store.auditLog` (3524) | CORE |
| [packages/store/src/store.ts:3727](../../packages/store/src/store.ts#L3727) `Store/unusualAccess` | `Store.auditLog` (3727, 3793) | CORE |
| [packages/store/src/store.ts:3824](../../packages/store/src/store.ts#L3824) `Store/leastPrivilege` | `SQLite.all` (3824); `SQLite.prepare` (3824); `Store.sql` (3824) | CORE |
| [packages/store/src/store.ts:3897](../../packages/store/src/store.ts#L3897) `Store/unusedAccess` | `SQLite.get` (3897); `SQLite.prepare` (3897, 3906); `Store.sql` (3897, 3906); `SQLite.all` (3906) | CORE |
| [packages/store/src/store.ts:3945](../../packages/store/src/store.ts#L3945) `Store/unusedObjects` | `SQLite.get` (3945); `SQLite.prepare` (3945, 3948); `Store.sql` (3945, 3948); `SQLite.all` (3948) | CORE |
| [packages/store/src/store.ts:3983](../../packages/store/src/store.ts#L3983) `Store/usageCounting` | `SQLite.get` (3983); `SQLite.prepare` (3983); `Store.sql` (3983) | CORE |
| [packages/store/src/store.ts:3991](../../packages/store/src/store.ts#L3991) `Store/setMustChangePassword` | `SQLite.prepare` (3991); `Store.sql` (3991) | CORE |
| [packages/store/src/store.ts:4005](../../packages/store/src/store.ts#L4005) `Store/mustChangePassword` | `SQLite.get` (4005); `SQLite.prepare` (4005); `Store.sql` (4005) | CORE |
| [packages/store/src/store.ts:4044](../../packages/store/src/store.ts#L4044) `Store/passwordDaysRemaining` | `SQLite.get` (4044); `SQLite.prepare` (4044); `Store.sql` (4044) | CORE |
| [packages/store/src/store.ts:4051](../../packages/store/src/store.ts#L4051) `Store/importAccounts` | `SQLite.all` (4051); `SQLite.prepare` (4051); `Store.sql` (4051) | CORE |
| [packages/store/src/store.ts:4074](../../packages/store/src/store.ts#L4074) `Store/canonicalAccount` | `SQLite.all` (4074); `SQLite.prepare` (4074); `Store.sql` (4074) | CORE |
| [packages/store/src/store.ts:4086](../../packages/store/src/store.ts#L4086) `Store/createLocalAccount` | `SQLite.prepare` (4086); `Store.sql` (4086) | CORE |
| [packages/store/src/store.ts:4116](../../packages/store/src/store.ts#L4116) `Store/previewAccountImport` | `Store.sql` (4116, 4117, 4126) | CORE |
| [packages/store/src/store.ts:4134](../../packages/store/src/store.ts#L4134) `Store/limitAccountImport` | `SQLite.prepare` (4134, 4135, 4138); `Store.sql` (4134, 4135, 4138); `SQLite.get` (4135) | CORE |
| [packages/store/src/store.ts:4145](../../packages/store/src/store.ts#L4145) `Store/applyAccountImport` | `Store.sql` (4145, 4153, 4182); `SQLite.get` (4153); `SQLite.prepare` (4153, 4182) | CORE |
| [packages/store/src/store.ts:4207](../../packages/store/src/store.ts#L4207) `Store/forgetStandIns` | `SQLite.prepare` (4207); `Store.sql` (4207) | CORE |
| [packages/store/src/store.ts:4240](../../packages/store/src/store.ts#L4240) `Store/deleteAccount` | `SQLite.prepare` (4240, 4241, 4242, 4244, 4248); `Store.sql` (4240, 4241, 4242, 4244, 4248) | CORE |
| [packages/store/src/store.ts:4265](../../packages/store/src/store.ts#L4265) `Store/setAccountActive` | `SQLite.prepare` (4265, 4268, 4269); `Store.sql` (4265, 4268, 4269) | AUTH |
| [packages/store/src/store.ts:4279](../../packages/store/src/store.ts#L4279) `Store/accountInactive` | `SQLite.get` (4279); `SQLite.prepare` (4279); `Store.sql` (4279) | CORE |
| [packages/store/src/store.ts:4284](../../packages/store/src/store.ts#L4284) `Store/identityAllowed` | `SQLite.get` (4284, 4290, 4296); `SQLite.prepare` (4284, 4290, 4296); `Store.sql` (4284, 4290, 4296) | CORE |
| [packages/store/src/store.ts:4304](../../packages/store/src/store.ts#L4304) `Store/externalIdentityId` | `SQLite.get` (4304, 4310); `SQLite.prepare` (4304, 4309, 4310); `Store.sql` (4304, 4309, 4310) | CORE |
| [packages/store/src/store.ts:4315](../../packages/store/src/store.ts#L4315) `Store/accountIdentityId` | `SQLite.get` (4315, 4320); `SQLite.prepare` (4315, 4319, 4320); `Store.sql` (4315, 4319, 4320) | CORE |
| [packages/store/src/store.ts:4343](../../packages/store/src/store.ts#L4343) `Store/signInMark` | `SQLite.prepare` (4343); `Store.sql` (4343) | AUTH |
| [packages/store/src/store.ts:4353](../../packages/store/src/store.ts#L4353) `Store/signInBase` | `SQLite.get` (4353); `SQLite.prepare` (4353); `Store.sql` (4353) | AUTH |
| [packages/store/src/store.ts:4355](../../packages/store/src/store.ts#L4355) `Store/signInBase/identity` | `SQLite.get` (4355); `SQLite.prepare` (4355); `Store.sql` (4355) | AUTH |
| [packages/store/src/store.ts:4367](../../packages/store/src/store.ts#L4367) `Store/ledgerRow` | `SQLite.get` (4367, 4368); `SQLite.prepare` (4367, 4368); `Store.sql` (4367, 4368) | AUTH |
| [packages/store/src/store.ts:4379](../../packages/store/src/store.ts#L4379) `Store/ledgerWrite` | `Store.sql` (4379, 4380, 4382, 4384, 4387, 4387) | AUTH |
| [packages/store/src/store.ts:4406](../../packages/store/src/store.ts#L4406) `Store/settleSignIns` | `SQLite.all` (4406, 4412); `SQLite.prepare` (4406, 4412, 4418, 4422, 4424); `Store.sql` (4406, 4412, 4418, 4422, 4424) | AUTH |
| [packages/store/src/store.ts:4435](../../packages/store/src/store.ts#L4435) `Store/securityToken` | `SQLite.get` (4435); `SQLite.prepare` (4435); `Store.sql` (4435) | CORE |
| [packages/store/src/store.ts:4443](../../packages/store/src/store.ts#L4443) `Store/accountLocalOnly` | `SQLite.get` (4443); `SQLite.prepare` (4443); `Store.sql` (4443) | CORE |
| [packages/store/src/store.ts:4448](../../packages/store/src/store.ts#L4448) `Store/accountRequires2fa` | `SQLite.get` (4448); `SQLite.prepare` (4448); `Store.sql` (4448) | CORE |
| [packages/store/src/store.ts:4454](../../packages/store/src/store.ts#L4454) `Store/setAccountLocalOnly` | `SQLite.prepare` (4454); `Store.sql` (4454) | CORE |
| [packages/store/src/store.ts:4463](../../packages/store/src/store.ts#L4463) `Store/setAccountRequire2fa` | `SQLite.prepare` (4463); `Store.sql` (4463) | CORE |
| [packages/store/src/store.ts:4492](../../packages/store/src/store.ts#L4492) `Store/createApiToken` | `SQLite.get` (4492); `SQLite.prepare` (4492, 4522); `Store.sql` (4492, 4522) | CORE |
| [packages/store/src/store.ts:4569](../../packages/store/src/store.ts#L4569) `Store/recordObjectUse` | `Store.sql` (4569) | CORE |
| [packages/store/src/store.ts:4599](../../packages/store/src/store.ts#L4599) `Store/writeUsage` | `Store.sql` (4599, 4600, 4602, 4606, 4608) | CORE |
| [packages/store/src/store.ts:4615](../../packages/store/src/store.ts#L4615) `Store/writeUsageRows` | `SQLite.prepare` (4615, 4616, 4622); `Store.sql` (4615, 4616, 4622) | CORE |
| [packages/store/src/store.ts:4627](../../packages/store/src/store.ts#L4627) `Store/writeObjectUseRows` | `SQLite.prepare` (4627, 4628, 4633); `Store.sql` (4627, 4628, 4633) | CORE |
| [packages/store/src/store.ts:4638](../../packages/store/src/store.ts#L4638) `Store/objectUseSince` | `SQLite.get` (4638); `SQLite.prepare` (4638); `Store.sql` (4638) | CORE |
| [packages/store/src/store.ts:4651](../../packages/store/src/store.ts#L4651) `Store/accountUsage` | `SQLite.get` (4651); `SQLite.prepare` (4651, 4652); `Store.sql` (4651, 4652); `SQLite.all` (4652); `Store.auditLog` (4668) | CORE |
| [packages/store/src/store.ts:4684](../../packages/store/src/store.ts#L4684) `Store/apiTokens` | `SQLite.all` (4684); `SQLite.prepare` (4684); `Store.sql` (4684) | CORE |
| [packages/store/src/store.ts:4694](../../packages/store/src/store.ts#L4694) `Store/revokeApiToken` | `SQLite.prepare` (4694); `Store.sql` (4694) | CORE |
| [packages/store/src/store.ts:4708](../../packages/store/src/store.ts#L4708) `Store/apiToken` | `SQLite.get` (4708); `SQLite.prepare` (4708, 4720); `Store.sql` (4708, 4720) | CORE |
| [packages/store/src/store.ts:4736](../../packages/store/src/store.ts#L4736) `Store/enrollTotp` | `SQLite.prepare` (4736); `Store.sql` (4736) | CORE |
| [packages/store/src/store.ts:4747](../../packages/store/src/store.ts#L4747) `Store/confirmTotp` | `SQLite.get` (4747); `SQLite.prepare` (4747, 4749); `Store.sql` (4747, 4749) | CORE |
| [packages/store/src/store.ts:4757](../../packages/store/src/store.ts#L4757) `Store/hasTotp` | `SQLite.get` (4757); `SQLite.prepare` (4757); `Store.sql` (4757) | CORE |
| [packages/store/src/store.ts:4762](../../packages/store/src/store.ts#L4762) `Store/totpAccounts` | `SQLite.all` (4762); `SQLite.prepare` (4762); `Store.sql` (4762) | CORE |
| [packages/store/src/store.ts:4768](../../packages/store/src/store.ts#L4768) `Store/disableTotp` | `SQLite.prepare` (4768); `Store.sql` (4768) | CORE |
| [packages/store/src/store.ts:4791](../../packages/store/src/store.ts#L4791) `Store/verifyTotp` | `SQLite.get` (4791); `SQLite.prepare` (4791, 4797); `Store.sql` (4791, 4797) | CORE |
| [packages/store/src/store.ts:4810](../../packages/store/src/store.ts#L4810) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4810, 4812, 4813, 4815); `Store.sql` (4810, 4812, 4813, 4815); `SQLite.get` (4812) | CORE |
| [packages/store/src/store.ts:4862](../../packages/store/src/store.ts#L4862) `Store/passkeyAllowList` | `SQLite.all` (4862); `SQLite.prepare` (4862); `Store.sql` (4862) | CORE |
| [packages/store/src/store.ts:4876](../../packages/store/src/store.ts#L4876) `Store/takeWebauthnChallenge` | `SQLite.get` (4876); `SQLite.prepare` (4876, 4878); `Store.sql` (4876, 4878) | CORE |
| [packages/store/src/store.ts:4886](../../packages/store/src/store.ts#L4886) `Store/passkeys` | `SQLite.all` (4886); `SQLite.prepare` (4886); `Store.sql` (4886) | CORE |
| [packages/store/src/store.ts:4893](../../packages/store/src/store.ts#L4893) `Store/hasPasskey` | `SQLite.get` (4893); `SQLite.prepare` (4893); `Store.sql` (4893) | CORE |
| [packages/store/src/store.ts:4898](../../packages/store/src/store.ts#L4898) `Store/passkeyIds` | `SQLite.all` (4898); `SQLite.prepare` (4898); `Store.sql` (4898) | CORE |
| [packages/store/src/store.ts:4920](../../packages/store/src/store.ts#L4920) `Store/registerPasskey` | `SQLite.prepare` (4920); `Store.sql` (4920) | CORE |
| [packages/store/src/store.ts:4931](../../packages/store/src/store.ts#L4931) `Store/removePasskey` | `SQLite.get` (4931); `SQLite.prepare` (4931, 4932); `Store.sql` (4931, 4932) | CORE |
| [packages/store/src/store.ts:4948](../../packages/store/src/store.ts#L4948) `Store/verifyPasskeyAssertion` | `SQLite.get` (4948); `SQLite.prepare` (4948, 4959); `Store.sql` (4948, 4959) | CORE |
| [packages/store/src/store.ts:4995](../../packages/store/src/store.ts#L4995) `Store/generateRecoveryCodes` | `SQLite.prepare` (4995, 4998); `Store.sql` (4995, 4998) | CORE |
| [packages/store/src/store.ts:5013](../../packages/store/src/store.ts#L5013) `Store/recoveryCodesRemaining` | `SQLite.get` (5013); `SQLite.prepare` (5013); `Store.sql` (5013) | CORE |
| [packages/store/src/store.ts:5023](../../packages/store/src/store.ts#L5023) `Store/useRecoveryCode` | `SQLite.get` (5023); `SQLite.prepare` (5023, 5025); `Store.sql` (5023, 5025) | CORE |
| [packages/store/src/store.ts:5036](../../packages/store/src/store.ts#L5036) `Store/privilegeSets` | `Store.sql` (5036) | CORE |
| [packages/store/src/store.ts:5065](../../packages/store/src/store.ts#L5065) `Store/savePrivilegeSet` | `SQLite.prepare` (5065, 5073); `Store.sql` (5065, 5073) | AUTH |
| [packages/store/src/store.ts:5108](../../packages/store/src/store.ts#L5108) `Store/deletePrivilegeSet` | `SQLite.prepare` (5108); `Store.sql` (5108) | CORE |
| [packages/store/src/store.ts:5177](../../packages/store/src/store.ts#L5177) `Store/accountPrivilegeSet` | `SQLite.get` (5177); `SQLite.prepare` (5177); `Store.sql` (5177) | CORE |
| [packages/store/src/store.ts:5191](../../packages/store/src/store.ts#L5191) `Store/setAccountPrivilegeSet` | `SQLite.get` (5191); `SQLite.prepare` (5191, 5194, 5198); `Store.sql` (5191, 5194, 5198) | AUTH |
| [packages/store/src/store.ts:5213](../../packages/store/src/store.ts#L5213) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5213); `Store.sql` (5213) | CORE |
| [packages/store/src/store.ts:5227](../../packages/store/src/store.ts#L5227) `Store/addProvisionedAccount` | `SQLite.get` (5227); `SQLite.prepare` (5227, 5231); `Store.sql` (5227, 5231) | CORE |
| [packages/store/src/store.ts:5400](../../packages/store/src/store.ts#L5400) `Store/ruleOutcome` | `Calculations.context` (5400) | CORE |
| [packages/store/src/store.ts:5441](../../packages/store/src/store.ts#L5441) `Store/allowedIds` | `SQLite.iterate` (5441); `SQLite.prepare` (5441); `Store.sql` (5441) | CORE |
| [packages/store/src/store.ts:5511](../../packages/store/src/store.ts#L5511) `Store/scopedTableSql` | `Store.viewableIds` (5511); `SQLite.all` (5514); `SQLite.prepare` (5514); `Store.sql` (5514) | GATED-STORE |
| [packages/store/src/store.ts:5546](../../packages/store/src/store.ts#L5546) `Store/previewRecordRuleCurrent` | `SQLite.get` (5546); `SQLite.prepare` (5546, 5549); `Store.sql` (5546, 5549); `SQLite.all` (5549); `Calculations.context` (5555, 5571) | CORE |
| [packages/store/src/store.ts:5723](../../packages/store/src/store.ts#L5723) `Store/passwordHash` | `SQLite.get` (5723); `SQLite.prepare` (5723); `Store.sql` (5723) | CORE |
| [packages/store/src/store.ts:5752](../../packages/store/src/store.ts#L5752) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5752); `Store.sql` (5752) | CORE |
| [packages/store/src/store.ts:5765](../../packages/store/src/store.ts#L5765) `Store/knownSharedAccount` | `SQLite.get` (5765); `SQLite.prepare` (5765); `Store.sql` (5765) | CORE |
| [packages/store/src/store.ts:5828](../../packages/store/src/store.ts#L5828) `Store/layouts` | `SQLite.all` (5828); `SQLite.prepare` (5828); `Store.sql` (5828) | CORE |
| [packages/store/src/store.ts:5849](../../packages/store/src/store.ts#L5849) `Store/image` | `SQLite.get` (5849); `SQLite.prepare` (5849); `Store.sql` (5849) | CORE |
| [packages/store/src/store.ts:5859](../../packages/store/src/store.ts#L5859) `Store/images` | `SQLite.all` (5859); `SQLite.prepare` (5859); `Store.sql` (5859) | CORE |
| [packages/store/src/store.ts:5872](../../packages/store/src/store.ts#L5872) `Store/addImage` | `Store.sql` (5872, 5873); `SQLite.prepare` (5873) | CORE |
| [packages/store/src/store.ts:5889](../../packages/store/src/store.ts#L5889) `Store/layout` | `SQLite.get` (5889); `SQLite.prepare` (5889); `Store.sql` (5889) | CORE |
| [packages/store/src/store.ts:6093](../../packages/store/src/store.ts#L6093) `Store/wordIndex` | `Store.sql` (6093, 6101, 6106); `Store.recordCount` (6105); `SQLite.get` (6106); `SQLite.prepare` (6106) | CORE |
| [packages/store/src/store.ts:6158](../../packages/store/src/store.ts#L6158) `Store/toRecord` | `Calculations.value` (6158, 6168); `Calculations.globalValue` (6162); `Calculations.unstoredStyled` (6167) | CORE |
| [packages/store/src/store.ts:6217](../../packages/store/src/store.ts#L6217) `Store/relatedValues` | `Calculations.globalValue` (6217); `Calculations.unstoredValue` (6219) | CORE |
| [packages/store/src/store.ts:6291](../../packages/store/src/store.ts#L6291) `Store/addRelated` | `relatedRows` (6291); `rowsById` (6323); `firstRelatedEach` (6346) | CORE |
| [packages/store/src/store.ts:6374](../../packages/store/src/store.ts#L6374) `Store/foundSetPage` | `rowsById` (6374) | CORE |
| [packages/store/src/store.ts:6390](../../packages/store/src/store.ts#L6390) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6390); `Store.row` (6406) | GATED-STORE |
| [packages/store/src/store.ts:6429](../../packages/store/src/store.ts#L6429) `Store/portalCountsCurrent` | `Store.canView` (6429); `Store.row` (6456) | GATED-STORE |
| [packages/store/src/store.ts:6492](../../packages/store/src/store.ts#L6492) `Store/fieldIndexCurrent` | `SQLite.iterate` (6492); `SQLite.prepare` (6492, 6497); `Store.sql` (6492, 6497); `SQLite.all` (6497) | GATED-STORE |
| [packages/store/src/store.ts:6538](../../packages/store/src/store.ts#L6538) `Store/valueListItemsCurrent` | `Store.valueListItems` (6538); `Store.get` (6552); `relatedRows` (6553); `Store.row` (6553); `SQLite.iterate` (6555); `SQLite.prepare` (6555); `Store.sql` (6555); `Calculations.related` (6565); `Calculations.value` (6569, 6570) | GATED-STORE |
| [packages/store/src/store.ts:6667](../../packages/store/src/store.ts#L6667) `Store/portalRows` | `relatedRows` (6667); `relatedIdList` (6668); `Store.viewableIds` (6671); `rowsById` (6696, 6734); `Calculations.related` (6710) | CORE |
| [packages/store/src/store.ts:6678](../../packages/store/src/store.ts#L6678) `Store/portalRows/context` | `Calculations.context` (6678) | CORE |
| [packages/store/src/store.ts:6688](../../packages/store/src/store.ts#L6688) `Store/portalRows/valueOf` | `Calculations.value` (6688) | CORE |
| [packages/store/src/store.ts:6805](../../packages/store/src/store.ts#L6805) `Store/markRepeating` | `SQLite.prepare` (6805); `Store.sql` (6805) | CORE |
| [packages/store/src/store.ts:6832](../../packages/store/src/store.ts#L6832) `Store/externalContainerCheck` | `SQLite.all` (6832); `SQLite.prepare` (6832); `Store.sql` (6832) | CORE |
| [packages/store/src/store.ts:6839](../../packages/store/src/store.ts#L6839) `Store/externalContainerCount` | `SQLite.get` (6839); `SQLite.prepare` (6839); `Store.sql` (6839) | CORE |
| [packages/store/src/store.ts:6848](../../packages/store/src/store.ts#L6848) `Store/externalContainerReport` | `SQLite.all` (6848, 6861); `SQLite.prepare` (6848, 6861); `Store.sql` (6848, 6861) | CORE |
| [packages/store/src/store.ts:6997](../../packages/store/src/store.ts#L6997) `Store/orphanContainerReport` | `SQLite.all` (6997); `SQLite.prepare` (6997); `Store.sql` (6997) | CORE |
| [packages/store/src/store.ts:7032](../../packages/store/src/store.ts#L7032) `Store/purgeOrphanContainers` | `Store.sql` (7032, 7036, 7045, 7048, 7049, 7054, 7055, 7057, 7057); `Store.orphanContainerReport` (7040); `SQLite.get` (7045); `SQLite.prepare` (7045, 7048, 7049) | CORE |
| [packages/store/src/store.ts:7070](../../packages/store/src/store.ts#L7070) `Store/containerIntact` | `SQLite.get` (7070); `SQLite.prepare` (7070); `Store.sql` (7070) | CORE |
| [packages/store/src/store.ts:7080](../../packages/store/src/store.ts#L7080) `Store/externalOf` | `SQLite.get` (7080); `SQLite.prepare` (7080); `Store.sql` (7080) | CORE |
| [packages/store/src/store.ts:7084](../../packages/store/src/store.ts#L7084) `Store/containerMeta` | `SQLite.get` (7084); `SQLite.prepare` (7084); `Store.sql` (7084) | CORE |
| [packages/store/src/store.ts:7089](../../packages/store/src/store.ts#L7089) `Store/container` | `SQLite.get` (7089); `SQLite.prepare` (7089, 7098); `Store.sql` (7089, 7098); `SQLite.all` (7098) | CORE |
| [packages/store/src/store.ts:7106](../../packages/store/src/store.ts#L7106) `Store/containerInfo` | `SQLite.get` (7106); `SQLite.prepare` (7106); `Store.sql` (7106) | CORE |
| [packages/store/src/store.ts:7140](../../packages/store/src/store.ts#L7140) `Store/containerRange` | `SQLite.all` (7140); `SQLite.prepare` (7140, 7147); `Store.sql` (7140, 7147); `SQLite.get` (7147) | CORE |
| [packages/store/src/store.ts:7165](../../packages/store/src/store.ts#L7165) `Store/addContainer` | `SQLite.all` (7165); `SQLite.prepare` (7165, 7170, 7184, 7188, 7189); `Store.sql` (7165, 7170, 7184, 7186, 7188, 7189, 7191, 7194); `SQLite.get` (7175); `Store.containerRange` (7177) | CORE |
| [packages/store/src/store.ts:7211](../../packages/store/src/store.ts#L7211) `Store/addExternalContainer` | `SQLite.prepare` (7211); `Store.sql` (7211) | CORE |
| [packages/store/src/store.ts:7229](../../packages/store/src/store.ts#L7229) `Store/writeExternalFile` | `Store.evaluateEach` (7229); `SQLite.prepare` (7252); `Store.sql` (7252) | CORE |
| [packages/store/src/store.ts:7253](../../packages/store/src/store.ts#L7253) `Store/writeExternalFile/taken` | `SQLite.get` (7253) | CORE |
| [packages/store/src/store.ts:7282](../../packages/store/src/store.ts#L7282) `Store/embeddedContainers` | `SQLite.prepare` (7282, 7283); `Store.sql` (7282, 7283); `SQLite.all` (7283); `SQLite.get` (7287) | CORE |
| [packages/store/src/store.ts:7296](../../packages/store/src/store.ts#L7296) `Store/embeddedContainerCount` | `SQLite.prepare` (7296); `Store.sql` (7296); `SQLite.get` (7297) | CORE |
| [packages/store/src/store.ts:7305](../../packages/store/src/store.ts#L7305) `Store/recoverContainersOut` | `SQLite.prepare` (7305); `Store.sql` (7305); `SQLite.get` (7308) | CORE |
| [packages/store/src/store.ts:7330](../../packages/store/src/store.ts#L7330) `Store/moveContainersOut` | `Store.sql` (7330, 7338, 7340, 7342, 7344, 7345, 7364, 7369, 7371, 7373, 7374, 7378); `SQLite.get` (7338); `SQLite.prepare` (7338, 7344, 7345); `Store.container` (7347) | CORE |
| [packages/store/src/store.ts:7387](../../packages/store/src/store.ts#L7387) `Store/moveContainersIn` | `Store.sql` (7387, 7392, 7394, 7395, 7396, 7397, 7416, 7419, 7426, 7429, 7432, 7439); `SQLite.prepare` (7394, 7395, 7396, 7397, 7426, 7432); `SQLite.get` (7399, 7426, 7432) | CORE |
| [packages/store/src/store.ts:7451](../../packages/store/src/store.ts#L7451) `Store/compactFile` | `Store.sql` (7451, 7452, 7453) | CORE |
| [packages/store/src/store.ts:7459](../../packages/store/src/store.ts#L7459) `Store/containerId` | `Store.containerId` (7459); `Store.row` (7460) | CORE |
| [packages/store/src/store.ts:7482](../../packages/store/src/store.ts#L7482) `Store/checkContainerWrite` | `Store.row` (7482) | CORE |
| [packages/store/src/store.ts:7495](../../packages/store/src/store.ts#L7495) `Store/setContainer` | `Store.sql` (7495, 7509, 7514, 7517, 7517); `Store.row` (7498); `SQLite.prepare` (7509) | CORE |
| [packages/store/src/store.ts:7551](../../packages/store/src/store.ts#L7551) `Store/orderBy` | `Store.valueListItems` (7551) | CORE |
| [packages/store/src/store.ts:7574](../../packages/store/src/store.ts#L7574) `Store/userPrefs` | `SQLite.all` (7574); `SQLite.prepare` (7574); `Store.sql` (7574) | CORE |
| [packages/store/src/store.ts:7579](../../packages/store/src/store.ts#L7579) `Store/hasTable` | `SQLite.get` (7579); `SQLite.prepare` (7579); `Store.sql` (7579) | CORE |
| [packages/store/src/store.ts:7583](../../packages/store/src/store.ts#L7583) `Store/setUserPref` | `Store.sql` (7583, 7584, 7585); `SQLite.prepare` (7584, 7585) | CORE |
| [packages/store/src/store.ts:7591](../../packages/store/src/store.ts#L7591) `Store/indexedFields` | `SQLite.all` (7591, 7592); `SQLite.prepare` (7591, 7592); `Store.sql` (7591, 7592) | CORE |
| [packages/store/src/store.ts:7613](../../packages/store/src/store.ts#L7613) `Store/addFieldIndex` | `Store.sql` (7613) | CORE |
| [packages/store/src/store.ts:7625](../../packages/store/src/store.ts#L7625) `Store/dropFieldIndex` | `SQLite.get` (7625); `SQLite.prepare` (7625); `Store.sql` (7625, 7626) | CORE |
| [packages/store/src/store.ts:7636](../../packages/store/src/store.ts#L7636) `Store/timeFind` | `Store.query` (7636, 7640, 7641); `Store.recordCount` (7643) | CORE |
| [packages/store/src/store.ts:7660](../../packages/store/src/store.ts#L7660) `Store/find` | `Store.find` (7660) | GATED-STORE |
| [packages/store/src/store.ts:7671](../../packages/store/src/store.ts#L7671) `Store/findHere` | `Store.query` (7671, 7676, 7678, 7692, 7694, 7704); `Store.recordCount` (7689); `SQLite.get` (7690, 7694); `SQLite.prepare` (7690, 7694, 7699, 7706, 7715); `Store.sql` (7690, 7694, 7699, 7706, 7715); `SQLite.all` (7699, 7706, 7715) | GATED-STORE |
| [packages/store/src/store.ts:7710](../../packages/store/src/store.ts#L7710) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7710); `SQLite.prepare` (7710); `Store.sql` (7710) | GATED-STORE |
| [packages/store/src/store.ts:7743](../../packages/store/src/store.ts#L7743) `Store/sortedPage` | `SQLite.iterate` (7743); `SQLite.prepare` (7743, 7758); `Store.sql` (7743, 7758); `SQLite.all` (7758) | CORE |
| [packages/store/src/store.ts:7815](../../packages/store/src/store.ts#L7815) `Store/relatedCriteria/matched` | `relatedRows` (7815) | CORE |
| [packages/store/src/store.ts:7818](../../packages/store/src/store.ts#L7818) `Store/relatedCriteria` | `SQLite.iterate` (7818); `SQLite.prepare` (7818); `Store.sql` (7818) | CORE |
| [packages/store/src/store.ts:7844](../../packages/store/src/store.ts#L7844) `Store/computedRows` | `Store.sql` (7844, 7847, 7848, 7849, 7851, 7861, 7862, 7863, 7866); `SQLite.prepare` (7847, 7849, 7851, 7861); `SQLite.iterate` (7851); `Calculations.globalValue` (7854); `Calculations.unstoredValue` (7855); `Calculations.related` (7858); `SQLite.all` (7861) | CORE |
| [packages/store/src/store.ts:7891](../../packages/store/src/store.ts#L7891) `Store/summaries` | `Calculations.wholeTable` (7891); `Calculations.collect` (7911, 7916) | CORE |
| [packages/store/src/store.ts:7907](../../packages/store/src/store.ts#L7907) `Store/summaries/recs` | `SQLite.iterate` (7907); `SQLite.prepare` (7907); `Store.sql` (7907) | CORE |
| [packages/store/src/store.ts:7929](../../packages/store/src/store.ts#L7929) `Store/runningSummaryValues` | `Store.viewableIds` (7929); `rowsById` (7931); `Calculations.value` (7942, 7948); `Calculations.related` (7959) | GATED-STORE |
| [packages/store/src/store.ts:7972](../../packages/store/src/store.ts#L7972) `Store/findSource` | `Store.query` (7972); `Store.sql` (7979, 7980, 7984, 7986, 7997, 7999); `SQLite.prepare` (7980, 7986); `SQLite.iterate` (7986); `Calculations.globalValue` (7990); `Calculations.unstoredValue` (7991); `Calculations.related` (7995) | CORE |
| [packages/store/src/store.ts:8018](../../packages/store/src/store.ts#L8018) `Store/previewRow` | `Store.row` (8018) | CORE |
| [packages/store/src/store.ts:8036](../../packages/store/src/store.ts#L8036) `Store/row` | `SQLite.get` (8036) | CORE |
| [packages/store/src/store.ts:8055](../../packages/store/src/store.ts#L8055) `Store/getCurrent` | `Store.get` (8055); `Store.row` (8056, 8056, 8070); `SQLite.all` (8073); `SQLite.prepare` (8073); `Store.sql` (8073) | GATED-STORE |
| [packages/store/src/store.ts:8093](../../packages/store/src/store.ts#L8093) `Store/getManyCurrent` | `Store.getMany` (8093); `SQLite.get` (8111); `SQLite.prepare` (8111); `Store.sql` (8111) | GATED-STORE |
| [packages/store/src/store.ts:8104](../../packages/store/src/store.ts#L8104) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8104) | GATED-STORE |
| [packages/store/src/store.ts:8127](../../packages/store/src/store.ts#L8127) `Store/canViewRecord` | `SQLite.get` (8127); `SQLite.prepare` (8127); `Store.sql` (8127) | GATED-STORE |
| [packages/store/src/store.ts:8135](../../packages/store/src/store.ts#L8135) `Store/canView` | `Store.canView` (8135); `Store.row` (8136) | GATED-STORE |
| [packages/store/src/store.ts:8160](../../packages/store/src/store.ts#L8160) `Store/create` | `SQLite.get` (8160, 8166); `SQLite.prepare` (8160, 8166, 8178); `Store.sql` (8160, 8166, 8178) | CORE |
| [packages/store/src/store.ts:8202](../../packages/store/src/store.ts#L8202) `Store/duplicate` | `Store.row` (8202); `SQLite.get` (8206); `SQLite.prepare` (8206, 8220); `Store.sql` (8206, 8220) | CORE |
| [packages/store/src/store.ts:8265](../../packages/store/src/store.ts#L8265) `Store/update` | `Store.row` (8265, 8272, 8283); `Store.sql` (8296, 8297, 8334, 8337) | CORE |
| [packages/store/src/store.ts:8299](../../packages/store/src/store.ts#L8299) `Store/update/undo` | `Store.sql` (8299) | CORE |
| [packages/store/src/store.ts:8441](../../packages/store/src/store.ts#L8441) `Store/setStoredCalcValues` | `SQLite.prepare` (8441, 8442); `Store.sql` (8441, 8442); `SQLite.get` (8446) | CORE |
| [packages/store/src/store.ts:8520](../../packages/store/src/store.ts#L8520) `Store/evaluateCurrent` | `Store.row` (8520, 8520); `Calculations.context` (8521); `Store.get` (8522, 8524) | GATED-STORE |
| [packages/store/src/store.ts:8556](../../packages/store/src/store.ts#L8556) `Store/evaluateEachCurrent` | `Store.row` (8556, 8556); `Calculations.context` (8561); `Store.get` (8563) | GATED-STORE |
| [packages/store/src/store.ts:8596](../../packages/store/src/store.ts#L8596) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8596); `Store.get` (8598) | GATED-STORE |
| [packages/store/src/store.ts:8617](../../packages/store/src/store.ts#L8617) `Store/evaluateRowsCurrent` | `Store.row` (8617, 8617) | GATED-STORE |
| [packages/store/src/store.ts:8631](../../packages/store/src/store.ts#L8631) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8631) | GATED-STORE |
| [packages/store/src/store.ts:8653](../../packages/store/src/store.ts#L8653) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8653) | GATED-STORE |
| [packages/store/src/store.ts:8691](../../packages/store/src/store.ts#L8691) `Store/updateRelated` | `relatedRows` (8691) | CORE |
| [packages/store/src/store.ts:8709](../../packages/store/src/store.ts#L8709) `Store/updatePortals` | `Store.row` (8709, 8744); `relatedRows` (8745) | CORE |
| [packages/store/src/store.ts:8718](../../packages/store/src/store.ts#L8718) `Store/updatePortals/portal/related` | `relatedIdList` (8718) | CORE |
| [packages/store/src/store.ts:8800](../../packages/store/src/store.ts#L8800) `Store/portalContainerTarget` | `Store.row` (8800); `relatedIdList` (8801) | CORE |
| [packages/store/src/store.ts:8814](../../packages/store/src/store.ts#L8814) `Store/checkEditable` | `Store.row` (8814) | CORE |
| [packages/store/src/store.ts:8837](../../packages/store/src/store.ts#L8837) `Store/delete` | `Store.row` (8837); `SQLite.get` (8842); `SQLite.prepare` (8842, 8844); `Store.sql` (8842, 8844) | CORE |
| [packages/store/src/store.ts:8865](../../packages/store/src/store.ts#L8865) `Store/vaultHeld` | `SQLite.get` (8865); `SQLite.prepare` (8865); `Store.sql` (8865) | CORE |
| [packages/store/src/store.ts:8872](../../packages/store/src/store.ts#L8872) `Store/forgetStandInValues` | `Store.sql` (8872, 8893); `SQLite.prepare` (8893) | CORE |
| [packages/store/src/store.ts:8907](../../packages/store/src/store.ts#L8907) `Store/restoreDeletedRow` | `SQLite.get` (8907); `SQLite.prepare` (8907, 8908, 8911); `Store.sql` (8907, 8908, 8911); `SQLite.all` (8908) | CORE |
| [packages/store/src/store.ts:8935](../../packages/store/src/store.ts#L8935) `Store/cascadeDelete` | `relatedRows` (8935) | CORE |
| [packages/store/src/store.ts:9025](../../packages/store/src/store.ts#L9025) `Store/selectIdsCurrent` | `Store.selectIds` (9025); `SQLite.all` (9031); `SQLite.prepare` (9031); `Store.sql` (9031) | GATED-STORE |
| [packages/store/src/store.ts:9039](../../packages/store/src/store.ts#L9039) `Store/countIds` | `Store.countIds` (9039); `SQLite.get` (9043); `SQLite.prepare` (9043); `Store.sql` (9043) | GATED-STORE |
| [packages/store/src/store.ts:9059](../../packages/store/src/store.ts#L9059) `Store/computeValuesCurrent` | `Store.computeValues` (9059); `Store.sql` (9065, 9069); `SQLite.all` (9069); `SQLite.prepare` (9069) | GATED-STORE |
| [packages/store/src/store.ts:9084](../../packages/store/src/store.ts#L9084) `Store/findIdsCurrent` | `Store.findIds` (9084) | GATED-STORE |
| [packages/store/src/store.ts:9090](../../packages/store/src/store.ts#L9090) `Store/findIdsHere` | `Store.query` (9090, 9095, 9097); `SQLite.iterate` (9108); `SQLite.prepare` (9108); `Store.sql` (9108) | GATED-STORE |
| [packages/store/src/store.ts:9125](../../packages/store/src/store.ts#L9125) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9125); `Store.viewableIds` (9130); `Calculations.collect` (9146); `rowsById` (9146, 9196); `Calculations.collector` (9168) | GATED-STORE |
| [packages/store/src/store.ts:9158](../../packages/store/src/store.ts#L9158) `Store/groupSummariesCurrent/key` | `Calculations.value` (9158); `Calculations.related` (9160) | GATED-STORE |
| [packages/store/src/store.ts:9194](../../packages/store/src/store.ts#L9194) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9194) | GATED-STORE |
| [packages/store/src/store.ts:9250](../../packages/store/src/store.ts#L9250) `Store/sortIdsCurrentProgress` | `SQLite.all` (9250); `SQLite.prepare` (9250, 9318); `Store.sql` (9250, 9318); `Store.valueListItems` (9258); `rowsById` (9270); `Calculations.globalValue` (9273); `Calculations.unstoredValue` (9274); `Calculations.related` (9280); `SQLite.iterate` (9318) | GATED-STORE |
| [packages/store/src/store.ts:9332](../../packages/store/src/store.ts#L9332) `Store/matchIds` | `Store.matchIds` (9332); `SQLite.all` (9338); `SQLite.prepare` (9338); `Store.sql` (9338) | CORE |
| [packages/store/src/store.ts:9356](../../packages/store/src/store.ts#L9356) `Store/truncate` | `Store.sql` (9356, 9358, 9365, 9366, 9368, 9369); `SQLite.prepare` (9358, 9365); `SQLite.all` (9360) | CORE |
| [packages/store/src/store.ts:9390](../../packages/store/src/store.ts#L9390) `Store/iterateCommitted` | `SQLite.iterate` (9390) | CORE |
| [packages/store/src/store.ts:9424](../../packages/store/src/store.ts#L9424) `Store/readOnlyChecked` | `SQLite.prepare` (9424, 9428, 9437, 9442); `SQLite.all` (9428, 9437, 9442) | CORE |
| [packages/store/src/store.ts:9464](../../packages/store/src/store.ts#L9464) `Store/refreshDecimalSqlViews` | `SQLite.get` (9464); `SQLite.prepare` (9464, 9469); `SQLite.all` (9469) | CORE |
| [packages/store/src/store.ts:9483](../../packages/store/src/store.ts#L9483) `Store/internalRoots` | `SQLite.get` (9483); `SQLite.prepare` (9483, 9485); `SQLite.all` (9485) | CORE |
| [packages/store/src/store.ts:9518](../../packages/store/src/store.ts#L9518) `Store/selectCurrent` | `SQLite.iterate` (9518) | CORE |
| [packages/store/src/store.ts:9539](../../packages/store/src/store.ts#L9539) `Store/query` | `SQLite.iterate` (9539) | CORE |
| [packages/store/src/store.ts:9573](../../packages/store/src/store.ts#L9573) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9573); `SQLite.all` (9580, 9583); `SQLite.prepare` (9580, 9583) | CORE |
| [packages/store/src/store.ts:1184](../../packages/store/src/store.ts#L1184) `Store/ensureNativeIds` | `SQLite.all` (1184, 1196); `SQLite.prepare` (1184, 1187, 1195, 1196); `Store.sql` (1184, 1187, 1190, 1194, 1195, 1196, 1199, 1201) | CORE |
| [packages/store/src/store.ts:1209](../../packages/store/src/store.ts#L1209) `Store/nativeIdGuards` | `Store.sql` (1209, 1210, 1212) | CORE |
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
| [packages/store/src/store.ts:1548](../../packages/store/src/store.ts#L1548) `Store/selfContainedCopy` | `Store.sql` (1548); `SQLite.all` (1553); `SQLite.prepare` (1553, 1555, 1556, 1557) | CORE |
| [packages/store/src/store.ts:6911](../../packages/store/src/store.ts#L6911) `Store/containerReferences` | `SQLite.all` (6911, 6930, 6932, 6938, 6951, 6962, 6976); `SQLite.prepare` (6911, 6930, 6932, 6938, 6951, 6962, 6974, 6976); `Store.sql` (6911, 6930, 6932, 6938, 6951, 6962, 6974, 6976); `SQLite.get` (6974); `Store.row` (6985) | CORE |
| [packages/store/src/store.ts:7009](../../packages/store/src/store.ts#L7009) `Store/containerIntegrityReport` | `SQLite.all` (7009); `SQLite.prepare` (7009, 7020); `Store.sql` (7009, 7020); `SQLite.get` (7020) | CORE |
<!-- end generated read-gate inventory -->
