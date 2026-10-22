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
| [packages/cli/src/diagnostics.ts:202](../../packages/cli/src/diagnostics.ts#L202) `designCopy` | `SQLite.all` (202); `SQLite.prepare` (202, 205) | OPERATOR |
| [packages/cli/src/diagnostics.ts:441](../../packages/cli/src/diagnostics.ts#L441) `diagnostics` | `SQLite.get` (441); `SQLite.prepare` (441, 445); `SQLite.all` (445) | OPERATOR |
| [packages/cli/src/doctor.ts:139](../../packages/cli/src/doctor.ts#L139) `accountChecks` | `SQLite.all` (139); `SQLite.prepare` (139) | OPERATOR |
| [packages/cli/src/main.ts:669](../../packages/cli/src/main.ts#L669) `accountsWithPasswordOff` | `SQLite.all` (669); `SQLite.prepare` (669) | OPERATOR |
| [packages/cli/src/main.ts:698](../../packages/cli/src/main.ts#L698) `hostedRead` | `SQLite.all` (698, 701); `SQLite.prepare` (698, 701); `Store.sql` (698, 701) | OPERATOR |
| [packages/cli/src/main.ts:2288](../../packages/cli/src/main.ts#L2288) `main` | `Store.orphanContainerReport` (2288); `Store.auditLog` (2751); `SQLite.get` (2967); `SQLite.prepare` (2967) | OPERATOR |
| [packages/scripts/src/data-api-step.ts:103](../../packages/scripts/src/data-api-step.ts#L103) `respond` | `Store.get` (103, 130, 139); `Store.find` (104, 116) | SCRIPT |
| [packages/scripts/src/engine.ts:1936](../../packages/scripts/src/engine.ts#L1936) `ScriptEngine/goToLayout` | `Store.findIds` (1936) | SCRIPT |
| [packages/scripts/src/engine.ts:2273](../../packages/scripts/src/engine.ts#L2273) `ScriptEngine/foundSet` | `Store.findIds` (2273) | SCRIPT |
| [packages/scripts/src/engine.ts:2338](../../packages/scripts/src/engine.ts#L2338) `ScriptEngine/semanticFind` | `Store.findIds` (2338, 2359) | SCRIPT |
| [packages/scripts/src/engine.ts:3252](../../packages/scripts/src/engine.ts#L3252) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3252); `Calculations.executeSQL` (3259) | SCRIPT |
| [packages/scripts/src/engine.ts:3291](../../packages/scripts/src/engine.ts#L3291) `ScriptEngine/sortIds` | `Store.sortIds` (3291); `Store.valueListItems` (3297) | SCRIPT |
| [packages/scripts/src/engine.ts:3388](../../packages/scripts/src/engine.ts#L3388) `ScriptEngine/revertTransaction` | `Store.findIds` (3388) | SCRIPT |
| [packages/scripts/src/engine.ts:3936](../../packages/scripts/src/engine.ts#L3936) `ScriptEngine/step` | `Store.fieldIndex` (3936); `Store.findIds` (4070, 4165) | SCRIPT |
| [packages/scripts/src/engine.ts:5186](../../packages/scripts/src/engine.ts#L5186) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5186) | SCRIPT |
| [packages/scripts/src/engine.ts:5194](../../packages/scripts/src/engine.ts#L5194) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5194) | SCRIPT |
| [packages/scripts/src/engine.ts:5195](../../packages/scripts/src/engine.ts#L5195) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5195) | SCRIPT |
| [packages/scripts/src/engine.ts:5342](../../packages/scripts/src/engine.ts#L5342) `ScriptEngine/get` | `Store.findIds` (5342); `Store.canViewRecord` (5433); `Store.get` (5469) | SCRIPT |
| [packages/scripts/src/engine.ts:5500](../../packages/scripts/src/engine.ts#L5500) `ScriptEngine/design` | `Store.valueListItems` (5500) | SCRIPT |
| [packages/scripts/src/engine.ts:5554](../../packages/scripts/src/engine.ts#L5554) `ScriptEngine/record` | `Store.get` (5554) | SCRIPT |
| [packages/scripts/src/engine.ts:5586](../../packages/scripts/src/engine.ts#L5586) `ScriptEngine/valueOf` | `Store.findIds` (5586); `Store.containerId` (5594) | SCRIPT |
| [packages/scripts/src/engine.ts:5611](../../packages/scripts/src/engine.ts#L5611) `ScriptEngine/lookupNext` | `Store.get` (5611); `Store.row` (5612); `Calculations.context` (5614) | SCRIPT |
| [packages/scripts/src/engine.ts:5714](../../packages/scripts/src/engine.ts#L5714) `ScriptEngine/relatedIds` | `Store.findIds` (5714); `rowsById` (5722); `Store.select` (5726); `Store.matchIds` (5740); `Store.viewableIds` (5763) | SCRIPT |
| [packages/scripts/src/engine.ts:5748](../../packages/scripts/src/engine.ts#L5748) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5748) | SCRIPT |
| [packages/scripts/src/engine.ts:6237](../../packages/scripts/src/engine.ts#L6237) `ScriptEngine/exportField` | `Store.get` (6237); `Store.containerId` (6238); `Store.container` (6240) | SCRIPT |
| [packages/scripts/src/engine.ts:6386](../../packages/scripts/src/engine.ts#L6386) `ScriptEngine/relookup` | `Store.get` (6386) | SCRIPT |
| [packages/scripts/src/engine.ts:6804](../../packages/scripts/src/engine.ts#L6804) `ScriptEngine/goToList` | `Store.findIds` (6804) | SCRIPT |
| [packages/scripts/src/engine.ts:7120](../../packages/scripts/src/engine.ts#L7120) `ScriptEngine/sourceValue` | `Store.get` (7120); `Store.containerId` (7121); `Store.container` (7122) | SCRIPT |
| [packages/scripts/src/engine.ts:7828](../../packages/scripts/src/engine.ts#L7828) `ScriptEngine/containerFile` | `Store.get` (7828); `Store.containerId` (7829); `Store.container` (7830) | SCRIPT |
| [packages/scripts/src/engine.ts:7989](../../packages/scripts/src/engine.ts#L7989) `ScriptEngine/importRecords` | `Store.findIds` (7989); `Store.get` (8009) | SCRIPT |
| [packages/scripts/src/engine.ts:8215](../../packages/scripts/src/engine.ts#L8215) `ScriptEngine/fileMakerRows` | `Store.findIds` (8215); `Store.get` (8220) | SCRIPT |
| [packages/scripts/src/engine.ts:8255](../../packages/scripts/src/engine.ts#L8255) `ScriptEngine/newRecord` | `Store.findIds` (8255) | SCRIPT |
| [packages/scripts/src/engine.ts:8557](../../packages/scripts/src/engine.ts#L8557) `ScriptEngine/performFind` | `Store.findIds` (8557) | SCRIPT |
| [packages/scripts/src/engine.ts:8582](../../packages/scripts/src/engine.ts#L8582) `ScriptEngine/findRelated` | `Store.findIds` (8582, 8592, 8595) | SCRIPT |
| [packages/scripts/src/engine.ts:8614](../../packages/scripts/src/engine.ts#L8614) `ScriptEngine/quickFind` | `Store.findIds` (8614, 8615, 8618) | SCRIPT |
| [packages/scripts/src/engine.ts:8999](../../packages/scripts/src/engine.ts#L8999) `clearRecords` | `SQLite.all` (8999); `SQLite.prepare` (8999) | SCRIPT |
| [packages/scripts/src/recorder.ts:72](../../packages/scripts/src/recorder.ts#L72) `lastSeq` | `Store.auditLog` (72) | DESIGN |
| [packages/scripts/src/recorder.ts:104](../../packages/scripts/src/recorder.ts#L104) `recordRun` | `Store.auditLog` (104) | DESIGN |
| [packages/scripts/src/script-tests.ts:211](../../packages/scripts/src/script-tests.ts#L211) `runCase` | `Store.findIds` (211); `Store.auditLog` (218, 219, 262); `Store.evaluateEach` (246) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/server/src/admin.ts:966](../../packages/server/src/admin.ts#L966) `Admin/handle` | `Store.externalContainerReport` (966); `Store.orphanContainerReport` (971, 975) | ADMIN |
| [packages/server/src/admin.ts:2133](../../packages/server/src/admin.ts#L2133) `Admin/audit` | `Store.auditLog` (2133) | ADMIN |
| [packages/server/src/admin.ts:2216](../../packages/server/src/admin.ts#L2216) `Admin/viewAs` | `Store.find` (2216) | ADMIN |
| [packages/server/src/admin.ts:2564](../../packages/server/src/admin.ts#L2564) `Admin/status` | `Store.externalContainerCount` (2564) | ADMIN |
| [packages/server/src/agent.ts:154](../../packages/server/src/agent.ts#L154) `runStep/visible` | `Store.findIds` (154) | DESIGN |
| [packages/server/src/agent.ts:162](../../packages/server/src/agent.ts#L162) `runStep` | `Store.findIds` (162); `Store.auditLog` (221) | DESIGN |
| [packages/server/src/agent.ts:303](../../packages/server/src/agent.ts#L303) `dryRunPlan` | `Store.findIds` (303) | DESIGN |
| [packages/server/src/agent.ts:326](../../packages/server/src/agent.ts#L326) `runApprovedStep` | `Store.findIds` (326) | DESIGN |
| [packages/server/src/ai-output.ts:147](../../packages/server/src/ai-output.ts#L147) `storedSecretValues` | `Calculations.globalValue` (147); `Store.select` (152) | REDACTION |
| [packages/server/src/ai-policy-sql.ts:32](../../packages/server/src/ai-policy-sql.ts#L32) `sqlFieldRefs` | `SQLite.all` (32, 34); `SQLite.prepare` (32, 34) | POLICY |
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
| [packages/server/src/backup-verify.ts:147](../../packages/server/src/backup-verify.ts#L147) `testRestore` | `Store.recordCount` (147) | OPERATOR |
| [packages/server/src/backup-verify.ts:187](../../packages/server/src/backup-verify.ts#L187) `integrity` | `SQLite.all` (187); `SQLite.prepare` (187, 191); `SQLite.get` (191) | OPERATOR |
| [packages/server/src/backup-verify.ts:217](../../packages/server/src/backup-verify.ts#L217) `pageCheck` | `SQLite.all` (217); `SQLite.prepare` (217, 220); `SQLite.get` (220) | OPERATOR |
| [packages/server/src/backup.ts:242](../../packages/server/src/backup.ts#L242) `backupOnce` | `SQLite.get` (242); `SQLite.prepare` (242) | OPERATOR |
| [packages/server/src/backup.ts:966](../../packages/server/src/backup.ts#L966) `accountDifferences/read` | `SQLite.all` (966, 968); `SQLite.prepare` (966, 968) | OPERATOR |
| [packages/server/src/backup.ts:993](../../packages/server/src/backup.ts#L993) `readNames` | `SQLite.all` (993); `SQLite.prepare` (993) | OPERATOR |
| [packages/server/src/backup.ts:1023](../../packages/server/src/backup.ts#L1023) `credentialsReadable` | `SQLite.all` (1023); `SQLite.prepare` (1023) | OPERATOR |
| [packages/server/src/backup.ts:1039](../../packages/server/src/backup.ts#L1039) `columnInfo` | `SQLite.all` (1039); `SQLite.prepare` (1039) | OPERATOR |
| [packages/server/src/backup.ts:1074](../../packages/server/src/backup.ts#L1074) `reconcileCredentials` | `SQLite.all` (1074, 1096, 1111, 1121, 1127); `SQLite.prepare` (1074, 1082, 1096, 1098, 1111, 1112, 1119, 1121, 1122, 1127, 1128, 1132, 1133, 1134); `SQLite.get` (1082, 1132) | OPERATOR |
| [packages/server/src/backup.ts:1077](../../packages/server/src/backup.ts#L1077) `reconcileCredentials/has` | `SQLite.all` (1077); `SQLite.prepare` (1077) | OPERATOR |
| [packages/server/src/backup.ts:1101](../../packages/server/src/backup.ts#L1101) `reconcileCredentials/accountColumns` | `SQLite.all` (1101); `SQLite.prepare` (1101) | OPERATOR |
| [packages/server/src/backup.ts:1246](../../packages/server/src/backup.ts#L1246) `stageRestorePoint` | `SQLite.get` (1246, 1248, 1249); `SQLite.prepare` (1246, 1248, 1249) | OPERATOR |
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
| [packages/server/src/containers.ts:120](../../packages/server/src/containers.ts#L120) `ContainerFiles/send` | `Store.containerInfo` (120); `Store.container` (187); `Store.containerRange` (196) | CONTAINER |
| [packages/server/src/containers.ts:286](../../packages/server/src/containers.ts#L286) `ContainerFiles/make` | `Store.containerInfo` (286) | CONTAINER |
| [packages/server/src/containers.ts:298](../../packages/server/src/containers.ts#L298) `ContainerFiles/makeAdmitted` | `Store.container` (298) | CONTAINER |
| [packages/server/src/conversion-guide.ts:118](../../packages/server/src/conversion-guide.ts#L118) `convertedAt` | `SQLite.get` (118); `SQLite.prepare` (118); `Store.sql` (118) | DESIGN |
| [packages/server/src/conversion-guide.ts:344](../../packages/server/src/conversion-guide.ts#L344) `ConversionGuides/table` | `Store.sql` (344) | DESIGN |
| [packages/server/src/conversion-guide.ts:354](../../packages/server/src/conversion-guide.ts#L354) `ConversionGuides/saved` | `SQLite.get` (354); `SQLite.prepare` (354); `Store.sql` (354) | DESIGN |
| [packages/server/src/conversion-guide.ts:360](../../packages/server/src/conversion-guide.ts#L360) `ConversionGuides/save` | `SQLite.prepare` (360); `Store.sql` (360) | DESIGN |
| [packages/server/src/conversion.ts:305](../../packages/server/src/conversion.ts#L305) `conversionReport` | `Store.externalContainerCheck` (305) | DESIGN |
| [packages/server/src/cwp-xml.ts:457](../../packages/server/src/cwp-xml.ts#L457) `CwpXmlEndpoint/records` | `Store.find` (457, 459, 460, 466, 469); `Store.get` (465, 473) | XML |
| [packages/server/src/cwp-xml.ts:541](../../packages/server/src/cwp-xml.ts#L541) `CwpXmlEndpoint/layoutDoc` | `Store.valueListItems` (541) | XML |
| [packages/server/src/dashboards.ts:327](../../packages/server/src/dashboards.ts#L327) `Dashboards/table` | `Store.sql` (327) | DASHBOARD |
| [packages/server/src/dashboards.ts:337](../../packages/server/src/dashboards.ts#L337) `Dashboards/list` | `SQLite.all` (337); `SQLite.prepare` (337); `Store.sql` (337) | DASHBOARD |
| [packages/server/src/dashboards.ts:343](../../packages/server/src/dashboards.ts#L343) `Dashboards/get` | `SQLite.get` (343); `SQLite.prepare` (343); `Store.sql` (343) | DASHBOARD |
| [packages/server/src/dashboards.ts:357](../../packages/server/src/dashboards.ts#L357) `Dashboards/create` | `SQLite.prepare` (357); `Store.sql` (357) | DASHBOARD |
| [packages/server/src/dashboards.ts:370](../../packages/server/src/dashboards.ts#L370) `Dashboards/update` | `SQLite.prepare` (370); `Store.sql` (370) | DASHBOARD |
| [packages/server/src/dashboards.ts:377](../../packages/server/src/dashboards.ts#L377) `Dashboards/delete` | `SQLite.prepare` (377); `Store.sql` (377) | DASHBOARD |
| [packages/server/src/dataapi.ts:1911](../../packages/server/src/dataapi.ts#L1911) `DataApi/route` | `Store.get` (1911, 2133, 2156, 2164, 2211, 2235, 2255, 2292); `Store.valueListItems` (1926); `Store.find` (2088, 2135, 2325); `Store.findIds` (2092, 2330); `Store.query` (2330) | REST |
| [packages/server/src/dataapi.ts:2040](../../packages/server/src/dataapi.ts#L2040) `DataApi/route/recordOut` | `Store.portalCounts` (2040) | REST |
| [packages/server/src/dataapi.ts:2076](../../packages/server/src/dataapi.ts#L2076) `DataApi/route/shownAs` | `Store.get` (2076) | REST |
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
| [packages/server/src/import-mapping.ts:755](../../packages/server/src/import-mapping.ts#L755) `applyImportRun` | `SQLite.prepare` (755); `Store.sql` (755) | IMPORT |
| [packages/server/src/import-mapping.ts:772](../../packages/server/src/import-mapping.ts#L772) `targetKeys` | `SQLite.all` (772); `SQLite.prepare` (772); `Store.sql` (772) | IMPORT |
| [packages/server/src/import-mapping.ts:784](../../packages/server/src/import-mapping.ts#L784) `journal` | `Store.sql` (784, 787, 787); `SQLite.all` (787); `SQLite.prepare` (787) | IMPORT |
| [packages/server/src/import-mapping.ts:829](../../packages/server/src/import-mapping.ts#L829) `importHistory` | `SQLite.all` (829); `SQLite.prepare` (829); `Store.sql` (829) | IMPORT |
| [packages/server/src/import-mapping.ts:836](../../packages/server/src/import-mapping.ts#L836) `undoImportRun` | `SQLite.get` (836, 859); `SQLite.prepare` (836, 859, 873); `Store.sql` (836, 859, 873) | IMPORT |
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
| [packages/server/src/mcp.ts:963](../../packages/server/src/mcp.ts#L963) `createMcpServer/find_records` | `Store.find` (963) | MCP |
| [packages/server/src/mcp.ts:976](../../packages/server/src/mcp.ts#L976) `createMcpServer/get_record` | `Store.get` (976) | MCP |
| [packages/server/src/mcp.ts:1026](../../packages/server/src/mcp.ts#L1026) `createMcpServer/update_record` | `Store.get` (1026, 1030) | MCP |
| [packages/server/src/mcp.ts:1083](../../packages/server/src/mcp.ts#L1083) `createMcpServer/evaluate_calculation` | `Store.get` (1083, 1091); `Store.find` (1084); `Store.evaluate` (1085); `Store.row` (1090) | SQL |
| [packages/server/src/mcp.ts:1158](../../packages/server/src/mcp.ts#L1158) `createMcpServer/get_container` | `Store.container` (1158) | SQL |
| [packages/server/src/mcp.ts:1182](../../packages/server/src/mcp.ts#L1182) `createMcpServer/sql_query` | `Store.queryWithOrigins` (1182) | SQL |
| [packages/server/src/mcp.ts:1339](../../packages/server/src/mcp.ts#L1339) `createMcpServer/explain_value` | `Store.get` (1339); `Store.row` (1340) | MCP |
| [packages/server/src/mcp.ts:1362](../../packages/server/src/mcp.ts#L1362) `createMcpServer/check_record` | `Store.get` (1362); `Store.row` (1364) | MCP |
| [packages/server/src/mcp.ts:1386](../../packages/server/src/mcp.ts#L1386) `createMcpServer/explain_related` | `Store.get` (1386) | MCP |
| [packages/server/src/mcp.ts:2280](../../packages/server/src/mcp.ts#L2280) `registerResources/audit` | `Store.auditLog` (2280) | MCP |
| [packages/server/src/oauth.ts:59](../../packages/server/src/oauth.ts#L59) `storedName` | `SQLite.get` (59); `SQLite.prepare` (59); `Store.sql` (59) | AUTH |
| [packages/server/src/oauth.ts:70](../../packages/server/src/oauth.ts#L70) `legacyPasswordMark` | `SQLite.get` (70); `SQLite.prepare` (70); `Store.sql` (70) | AUTH |
| [packages/server/src/oauth.ts:164](../../packages/server/src/oauth.ts#L164) `OAuthServer/constructor/cols` | `SQLite.all` (164); `SQLite.prepare` (164) | AUTH |
| [packages/server/src/oauth.ts:170](../../packages/server/src/oauth.ts#L170) `OAuthServer/constructor` | `SQLite.all` (170); `SQLite.prepare` (170, 189, 191, 194, 195, 198); `SQLite.iterate` (189); `SQLite.get` (191); `Store.sql` (191, 194) | AUTH |
| [packages/server/src/oauth.ts:310](../../packages/server/src/oauth.ts#L310) `OAuthServer/register` | `SQLite.prepare` (310, 311, 312, 313, 316); `SQLite.get` (311, 313) | AUTH |
| [packages/server/src/oauth.ts:327](../../packages/server/src/oauth.ts#L327) `OAuthServer/client` | `SQLite.get` (327); `SQLite.prepare` (327) | AUTH |
| [packages/server/src/oauth.ts:417](../../packages/server/src/oauth.ts#L417) `OAuthServer/authorize/done` | `SQLite.prepare` (417, 418) | AUTH |
| [packages/server/src/oauth.ts:435](../../packages/server/src/oauth.ts#L435) `OAuthServer/authorize` | `SQLite.get` (435); `SQLite.prepare` (435, 439, 441, 448, 471, 472) | AUTH |
| [packages/server/src/oauth.ts:616](../../packages/server/src/oauth.ts#L616) `OAuthServer/token` | `SQLite.get` (616, 640); `SQLite.prepare` (616, 640, 644, 646) | AUTH |
| [packages/server/src/oauth.ts:697](../../packages/server/src/oauth.ts#L697) `OAuthServer/issue` | `SQLite.get` (697); `SQLite.prepare` (697, 698, 699) | AUTH |
| [packages/server/src/oauth.ts:711](../../packages/server/src/oauth.ts#L711) `OAuthServer/sweep` | `SQLite.all` (711); `SQLite.prepare` (711, 713, 714, 715) | AUTH |
| [packages/server/src/oauth.ts:747](../../packages/server/src/oauth.ts#L747) `OAuthServer/revoke` | `SQLite.get` (747, 748, 758, 759); `SQLite.prepare` (747, 748, 751, 758, 759, 763) | AUTH |
| [packages/server/src/odata-crossjoin-worker.ts:40](../../packages/server/src/odata-crossjoin-worker.ts#L40) `join` | `SQLite.prepare` (40, 49, 58, 73); `SQLite.get` (58); `SQLite.all` (73) | JOIN |
| [packages/server/src/odata.ts:926](../../packages/server/src/odata.ts#L926) `ODataEndpoint/resource` | `Store.countIds` (926); `Store.get` (966, 973, 1080) | ODATA |
| [packages/server/src/odata.ts:1212](../../packages/server/src/odata.ts#L1212) `ODataEndpoint/lambdaFor` | `Store.selectIds` (1212); `Store.row` (1221); `relatedIdList` (1222) | ODATA |
| [packages/server/src/odata.ts:1275](../../packages/server/src/odata.ts#L1275) `ODataEndpoint/list` | `Store.selectIds` (1275); `Store.getMany` (1280); `Store.computeValues` (1281); `Store.countIds` (1286) | ODATA |
| [packages/server/src/odata.ts:1333](../../packages/server/src/odata.ts#L1333) `ODataEndpoint/applied` | `Store.selectIds` (1333); `SQLite.prepare` (1348, 1385, 1398, 1402); `Store.getMany` (1359); `SQLite.all` (1398); `SQLite.get` (1402) | ODATA |
| [packages/server/src/odata.ts:1452](../../packages/server/src/odata.ts#L1452) `ODataEndpoint/crossjoined` | `Store.selectIds` (1452); `Store.getMany` (1481, 1516) | ODATA |
| [packages/server/src/odata.ts:1552](../../packages/server/src/odata.ts#L1552) `ODataEndpoint/entity` | `Store.getMany` (1552) | ODATA |
| [packages/server/src/odata.ts:1584](../../packages/server/src/odata.ts#L1584) `ODataEndpoint/relatedIds` | `Store.row` (1584); `relatedIdList` (1587, 1602); `Store.selectIds` (1591); `Store.viewableIds` (1601) | ODATA |
| [packages/server/src/odata.ts:1610](../../packages/server/src/odata.ts#L1610) `ODataEndpoint/relatedRecords` | `Store.getMany` (1610) | ODATA |
| [packages/server/src/odata.ts:1634](../../packages/server/src/odata.ts#L1634) `ODataEndpoint/property` | `Store.containerId` (1634); `Store.container` (1640) | ODATA |
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
| [packages/server/src/pgwire.ts:651](../../packages/server/src/pgwire.ts#L651) `Connection/translate` | `Calculations.translateSQL` (651) | SQL |
| [packages/server/src/pgwire.ts:677](../../packages/server/src/pgwire.ts#L677) `Connection/catalog` | `Store.describe` (677) | SQL |
| [packages/server/src/pgwire.ts:687](../../packages/server/src/pgwire.ts#L687) `Connection/run` | `Store.select` (687) | SQL |
| [packages/server/src/pgwire.ts:737](../../packages/server/src/pgwire.ts#L737) `Connection/validateSyntax` | `SQLite.prepare` (737); `Store.sql` (737) | SQL |
| [packages/server/src/pgwire.ts:918](../../packages/server/src/pgwire.ts#L918) `Connection/describe` | `Store.describe` (918) | SQL |
| [packages/server/src/pii.ts:121](../../packages/server/src/pii.ts#L121) `holdsOnlyUuids` | `Store.query` (121) | REDACTION |
| [packages/server/src/pii.ts:133](../../packages/server/src/pii.ts#L133) `sampledValues` | `Store.query` (133) | REDACTION |
| [packages/server/src/pii.ts:300](../../packages/server/src/pii.ts#L300) `vaultTable` | `Store.sql` (300, 303) | REDACTION |
| [packages/server/src/pii.ts:309](../../packages/server/src/pii.ts#L309) `forgetVault` | `Store.sql` (309) | REDACTION |
| [packages/server/src/pii.ts:348](../../packages/server/src/pii.ts#L348) `PiiMasker/constructor` | `SQLite.get` (348); `SQLite.prepare` (348); `Store.sql` (348) | REDACTION |
| [packages/server/src/pii.ts:358](../../packages/server/src/pii.ts#L358) `PiiMasker/refresh` | `SQLite.all` (358); `SQLite.prepare` (358); `Store.sql` (358) | REDACTION |
| [packages/server/src/pii.ts:389](../../packages/server/src/pii.ts#L389) `PiiMasker/token` | `SQLite.prepare` (389, 390); `Store.sql` (389, 390); `SQLite.get` (390) | REDACTION |
| [packages/server/src/pii.ts:630](../../packages/server/src/pii.ts#L630) `piiPreview` | `Store.find` (630); `SQLite.prepare` (637); `Store.sql` (637) | REDACTION |
| [packages/server/src/privilege-review.ts:162](../../packages/server/src/privilege-review.ts#L162) `reviewPrivileges` | `Store.previewRecordRule` (162) | DESIGN |
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
| [packages/server/src/record-context.ts:111](../../packages/server/src/record-context.ts#L111) `describeRecord` | `Store.row` (111); `Store.get` (120); `keyValue` (126); `Store.viewableIds` (153); `relatedRows` (157, 162) | RECORD |
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
| [packages/server/src/script-failure.ts:209](../../packages/server/src/script-failure.ts#L209) `explainScriptFailure` | `Store.row` (209) | RECORD |
| [packages/server/src/security.ts:80](../../packages/server/src/security.ts#L80) `importApproximations` | `SQLite.all` (80); `SQLite.prepare` (80); `Store.sql` (80) | DESIGN |
| [packages/server/src/security.ts:116](../../packages/server/src/security.ts#L116) `securityOf` | `Store.pendingChanges` (116) | DESIGN |
| [packages/server/src/security.ts:212](../../packages/server/src/security.ts#L212) `SecurityApi/handle` | `Store.previewRecordRule` (212) | DESIGN |
| [packages/server/src/semantic-find.ts:52](../../packages/server/src/semantic-find.ts#L52) `semanticFind` | `Store.findIds` (52) | SEARCH |
| [packages/server/src/semantic-find.ts:108](../../packages/server/src/semantic-find.ts#L108) `vectorOf` | `Store.containerId` (108); `Store.containerInfo` (110); `Store.container` (112); `Store.get` (117) | SEARCH |
| [packages/server/src/sql.ts:101](../../packages/server/src/sql.ts#L101) `SqlEndpoint/handle` | `Calculations.translateSQL` (101); `Store.select` (106) | SQL |
| [packages/server/src/sql.ts:159](../../packages/server/src/sql.ts#L159) `SqlEndpoint/tables` | `SQLite.all` (159); `SQLite.prepare` (159); `Store.sql` (159) | SQL |
| [packages/server/src/standby.ts:261](../../packages/server/src/standby.ts#L261) `Standby/copy` | `SQLite.get` (261); `SQLite.prepare` (261) | OPERATOR |
| [packages/server/src/summarize.ts:67](../../packages/server/src/summarize.ts#L67) `summarizeRecords` | `Store.findIds` (67); `Store.select` (122, 129, 139) | SUMMARY |
| [packages/server/src/summarize.ts:180](../../packages/server/src/summarize.ts#L180) `summarizeByRecord` | `Store.evaluateEach` (180); `Store.row` (182) | SUMMARY |
| [packages/server/src/sync-console.ts:458](../../packages/server/src/sync-console.ts#L458) `SyncConsole/runCheck` | `Store.sql` (458) | DESIGN |
| [packages/server/src/sync-console.ts:463](../../packages/server/src/sync-console.ts#L463) `SyncConsole/runCheck/assertActive` | `Store.sql` (463) | DESIGN |
| [packages/server/src/warm-worker.ts:19](../../packages/server/src/warm-worker.ts#L19) `message/count` | `Store.recordCount` (19) | INTERNAL |
| [packages/server/src/warm-worker.ts:34](../../packages/server/src/warm-worker.ts#L34) `message` | `Store.find` (34) | INTERNAL |
| [packages/server/src/webclient.ts:442](../../packages/server/src/webclient.ts#L442) `WebClient/history` | `Store.get` (442) | WEB |
| [packages/server/src/webclient.ts:558](../../packages/server/src/webclient.ts#L558) `WebClient/explain` | `Store.get` (558); `Store.row` (591, 604) | WEB |
| [packages/server/src/webclient.ts:617](../../packages/server/src/webclient.ts#L617) `WebClient/index` | `Store.fieldIndex` (617) | WEB |
| [packages/server/src/webclient.ts:707](../../packages/server/src/webclient.ts#L707) `WebClient/menus` | `Store.evaluateEach` (707) | WEB |
| [packages/server/src/webclient.ts:923](../../packages/server/src/webclient.ts#L923) `WebClient/view` | `Store.evaluateEach` (923, 947, 966); `Store.canView` (941); `Store.previewRow` (945, 967); `Store.get` (958); `Store.row` (959, 959) | WEB |
| [packages/server/src/webclient.ts:944](../../packages/server/src/webclient.ts#L944) `WebClient/view/get` | `Store.get` (944) | WEB |
| [packages/server/src/webclient.ts:1009](../../packages/server/src/webclient.ts#L1009) `WebClient/refresh` | `Store.previewRow` (1009); `Store.getMany` (1014); `Store.foundSetRows` (1036) | WEB |
| [packages/server/src/webclient.ts:1048](../../packages/server/src/webclient.ts#L1048) `WebClient/foundIds` | `Store.findIds` (1048) | WEB |
| [packages/server/src/webclient.ts:1063](../../packages/server/src/webclient.ts#L1063) `WebClient/records` | `Store.getMany` (1063); `Store.find` (1066) | WEB |
| [packages/server/src/webclient.ts:1092](../../packages/server/src/webclient.ts#L1092) `WebClient/foundSetPortal` | `Store.foundSetRows` (1092, 1099) | WEB |
| [packages/server/src/webclient.ts:1132](../../packages/server/src/webclient.ts#L1132) `WebClient/charts/foundSet` | `Store.findIds` (1132) | WEB |
| [packages/server/src/webclient.ts:1141](../../packages/server/src/webclient.ts#L1141) `WebClient/charts` | `Calculations.context` (1141); `Store.canView` (1169); `Store.evaluateEach` (1178, 1182); `Store.evaluateRows` (1187, 1189) | WEB |
| [packages/server/src/webclient.ts:1172](../../packages/server/src/webclient.ts#L1172) `WebClient/charts/get` | `Store.get` (1172) | WEB |
| [packages/server/src/webclient.ts:1322](../../packages/server/src/webclient.ts#L1322) `WebClient/exportRecords` | `Store.getMany` (1322) | WEB |
| [packages/server/src/webclient.ts:1248](../../packages/server/src/webclient.ts#L1248) `WebClient/exportText/nextBatch` | `Store.selectIds` (1248); `Store.getMany` (1253) | WEB |
| [packages/server/src/webclient.ts:1496](../../packages/server/src/webclient.ts#L1496) `WebClient/aiReplace` | `Store.canView` (1496); `Store.getMany` (1512) | WEB |
| [packages/server/src/webclient.ts:1572](../../packages/server/src/webclient.ts#L1572) `WebClient/groups` | `Store.findIds` (1572); `Store.groupSummaries` (1578) | WEB |
| [packages/server/src/webclient.ts:1680](../../packages/server/src/webclient.ts#L1680) `WebClient/button` | `Store.findIds` (1680, 1730); `Store.evaluateEach` (1689, 1690) | WEB |
| [packages/server/src/webclient.ts:2337](../../packages/server/src/webclient.ts#L2337) `listItems` | `Store.valueListItems` (2337) | WEB |
| [packages/server/src/webclient.ts:2416](../../packages/server/src/webclient.ts#L2416) `foundIds` | `Store.findIds` (2416, 2418) | WEB |
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
| [packages/store/src/calc.ts:285](../../packages/store/src/calc.ts#L285) `Calculations/meta` | `SQLite.get` (285); `SQLite.prepare` (285); `Store.sql` (285) | CALC |
| [packages/store/src/calc.ts:290](../../packages/store/src/calc.ts#L290) `Calculations/saveMeta` | `SQLite.prepare` (290); `Store.sql` (290) | CALC |
| [packages/store/src/calc.ts:303](../../packages/store/src/calc.ts#L303) `Calculations/globalValue` | `SQLite.get` (303); `SQLite.prepare` (303); `Store.sql` (303) | CALC |
| [packages/store/src/calc.ts:327](../../packages/store/src/calc.ts#L327) `Calculations/setNextSerial` | `Store.sql` (327, 328, 333, 335, 335) | CALC |
| [packages/store/src/calc.ts:471](../../packages/store/src/calc.ts#L471) `Calculations/value` | `Calculations.globalValue` (471) | CALC |
| [packages/store/src/calc.ts:506](../../packages/store/src/calc.ts#L506) `Calculations/computed` | `Calculations.context` (506) | CALC |
| [packages/store/src/calc.ts:521](../../packages/store/src/calc.ts#L521) `Calculations/unstoredValue` | `Calculations.unstoredStyled` (521); `Calculations.value` (521) | CALC |
| [packages/store/src/calc.ts:559](../../packages/store/src/calc.ts#L559) `Calculations/allRecords` | `SQLite.iterate` (559); `SQLite.prepare` (559); `Store.sql` (559) | CALC |
| [packages/store/src/calc.ts:570](../../packages/store/src/calc.ts#L570) `Calculations/collect` | `Calculations.collector` (570) | CALC |
| [packages/store/src/calc.ts:577](../../packages/store/src/calc.ts#L577) `Calculations/summaryInput` | `Calculations.value` (577) | CALC |
| [packages/store/src/calc.ts:601](../../packages/store/src/calc.ts#L601) `Calculations/collector/add` | `Calculations.related` (601) | CALC |
| [packages/store/src/calc.ts:614](../../packages/store/src/calc.ts#L614) `Calculations/foundSummary` | `Calculations.collect` (614) | CALC |
| [packages/store/src/calc.ts:625](../../packages/store/src/calc.ts#L625) `Calculations/summary` | `Calculations.collect` (625) | CALC |
| [packages/store/src/calc.ts:632](../../packages/store/src/calc.ts#L632) `Calculations/tableSummary` | `Calculations.wholeTable` (632) | CALC |
| [packages/store/src/calc.ts:687](../../packages/store/src/calc.ts#L687) `Calculations/globalsKey` | `Calculations.globalValue` (687) | CALC |
| [packages/store/src/calc.ts:862](../../packages/store/src/calc.ts#L862) `Calculations/summaryDependencies` | `Store.sql` (862) | CALC |
| [packages/store/src/calc.ts:901](../../packages/store/src/calc.ts#L901) `Calculations/wholeTable` | `rowsById` (901); `Store.viewableIds` (901); `Calculations.collect` (903, 993); `Calculations.value` (964); `Store.sql` (972, 980) | CALC |
| [packages/store/src/calc.ts:1154](../../packages/store/src/calc.ts#L1154) `Calculations/applyDelta/value` | `Calculations.value` (1154) | CALC |
| [packages/store/src/calc.ts:1226](../../packages/store/src/calc.ts#L1226) `Calculations/storedRows` | `SQLite.iterate` (1226); `SQLite.prepare` (1226); `Store.sql` (1226) | CALC |
| [packages/store/src/calc.ts:1278](../../packages/store/src/calc.ts#L1278) `Calculations/relatedRecs` | `Calculations.relatedIds` (1278); `Store.viewableIds` (1283); `rowsById` (1289) | CALC |
| [packages/store/src/calc.ts:1300](../../packages/store/src/calc.ts#L1300) `Calculations/firstRelated` | `Calculations.related` (1300, 1312, 1327); `Store.viewableIds` (1307); `Calculations.relatedIds` (1310, 1323); `Calculations.statement` (1320); `SQLite.get` (1320) | CALC |
| [packages/store/src/calc.ts:1334](../../packages/store/src/calc.ts#L1334) `Calculations/rowById` | `Calculations.statement` (1334); `SQLite.get` (1334) | CALC |
| [packages/store/src/calc.ts:1345](../../packages/store/src/calc.ts#L1345) `Calculations/relatedIds` | `Calculations.related` (1345, 1375, 1389); `rowsById` (1359, 1386); `Calculations.statement` (1370); `SQLite.all` (1370) | CALC |
| [packages/store/src/calc.ts:1452](../../packages/store/src/calc.ts#L1452) `Calculations/joinHop` | `Calculations.statement` (1452, 1454); `SQLite.get` (1452); `SQLite.iterate` (1454) | CALC |
| [packages/store/src/calc.ts:1479](../../packages/store/src/calc.ts#L1479) `Calculations/storedRelatedValues` | `Calculations.statement` (1479); `SQLite.iterate` (1479) | CALC |
| [packages/store/src/calc.ts:1498](../../packages/store/src/calc.ts#L1498) `Calculations/passStamp` | `Store.sql` (1498) | CALC |
| [packages/store/src/calc.ts:1508](../../packages/store/src/calc.ts#L1508) `Calculations/lookup` | `Store.sql` (1508) | CALC |
| [packages/store/src/calc.ts:1547](../../packages/store/src/calc.ts#L1547) `Calculations/foundSums` | `Store.sql` (1547) | CALC |
| [packages/store/src/calc.ts:1610](../../packages/store/src/calc.ts#L1610) `Calculations/hopQuery` | `Calculations.value` (1610) | CALC |
| [packages/store/src/calc.ts:1643](../../packages/store/src/calc.ts#L1643) `Calculations/columnNames` | `SQLite.all` (1643); `SQLite.prepare` (1643); `Store.sql` (1643) | CALC |
| [packages/store/src/calc.ts:1654](../../packages/store/src/calc.ts#L1654) `Calculations/statement` | `SQLite.prepare` (1654); `Store.sql` (1654) | CALC |
| [packages/store/src/calc.ts:1668](../../packages/store/src/calc.ts#L1668) `Calculations/ensureIndex` | `Store.sql` (1668, 1669) | CALC |
| [packages/store/src/calc.ts:1694](../../packages/store/src/calc.ts#L1694) `Calculations/context/records` | `Calculations.firstRelated` (1694) | CALC |
| [packages/store/src/calc.ts:1712](../../packages/store/src/calc.ts#L1712) `Calculations/context/field` | `Calculations.summary` (1712); `Calculations.globalValue` (1715); `Calculations.value` (1716) | CALC |
| [packages/store/src/calc.ts:1725](../../packages/store/src/calc.ts#L1725) `Calculations/context/related` | `Calculations.globalValue` (1725); `Calculations.value` (1727, 1738); `Calculations.related` (1740) | CALC |
| [packages/store/src/calc.ts:1760](../../packages/store/src/calc.ts#L1760) `Calculations/context/lookupNext` | `Store.canViewRecord` (1760) | CALC |
| [packages/store/src/calc.ts:1775](../../packages/store/src/calc.ts#L1775) `Calculations/context/summary` | `Calculations.value` (1775, 1785); `Calculations.related` (1787); `Calculations.summary` (1805) | CALC |
| [packages/store/src/calc.ts:1835](../../packages/store/src/calc.ts#L1835) `Calculations/context/get` | `Store.recordCount` (1835, 1839); `Calculations.statement` (1838); `SQLite.get` (1838) | CALC |
| [packages/store/src/calc.ts:1858](../../packages/store/src/calc.ts#L1858) `Calculations/context/executeSQL` | `Calculations.executeSQL` (1858) | CALC |
| [packages/store/src/calc.ts:1859](../../packages/store/src/calc.ts#L1859) `Calculations/context/persistentData` | `Store.persistentData` (1859) | CALC |
| [packages/store/src/calc.ts:1860](../../packages/store/src/calc.ts#L1860) `Calculations/context/persistentDataIds` | `Store.persistentDataIds` (1860) | CALC |
| [packages/store/src/calc.ts:1885](../../packages/store/src/calc.ts#L1885) `Calculations/design` | `Store.valueListItems` (1885) | CALC |
| [packages/store/src/calc.ts:1902](../../packages/store/src/calc.ts#L1902) `Calculations/executeSQL` | `Calculations.translateSQL` (1902); `Store.select` (1940); `Store.sql` (1951) | CALC |
| [packages/store/src/calc.ts:2056](../../packages/store/src/calc.ts#L2056) `Calculations/translateSQL` | `Store.scopedTableSql` (2056, 2087) | CALC |
| [packages/store/src/calc.ts:2119](../../packages/store/src/calc.ts#L2119) `Calculations/shareColumn` | `Store.recordCount` (2119) | CALC |
| [packages/store/src/calc.ts:2151](../../packages/store/src/calc.ts#L2151) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2151) | CALC |
| [packages/store/src/calc.ts:2188](../../packages/store/src/calc.ts#L2188) `Calculations/computeColumn` | `Calculations.statement` (2188); `SQLite.get` (2188); `Calculations.value` (2191) | CALC |
| [packages/store/src/calc.ts:2325](../../packages/store/src/calc.ts#L2325) `Calculations/beforeWrite` | `relatedRows` (2325); `Calculations.related` (2379); `Calculations.context` (2392) | CORE |
| [packages/store/src/calc.ts:2443](../../packages/store/src/calc.ts#L2443) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2443); `Calculations.value` (2443) | CALC |
| [packages/store/src/calc.ts:2457](../../packages/store/src/calc.ts#L2457) `Calculations/computeStoredStyled` | `Calculations.context` (2457) | CORE |
| [packages/store/src/calc.ts:2497](../../packages/store/src/calc.ts#L2497) `Calculations/validate/fail` | `Calculations.context` (2497) | CALC |
| [packages/store/src/calc.ts:2511](../../packages/store/src/calc.ts#L2511) `Calculations/validate` | `Calculations.value` (2511); `Store.valueListItems` (2532); `Calculations.context` (2546) | CALC |
| [packages/store/src/calc.ts:2608](../../packages/store/src/calc.ts#L2608) `nearest` | `SQLite.get` (2608); `SQLite.prepare` (2608); `Store.sql` (2608) | CALC |
| [packages/store/src/calc.ts:2694](../../packages/store/src/calc.ts#L2694) `containerValue` | `Store.containerInfo` (2694); `Store.containerRange` (2701); `Store.container` (2702) | CALC |
| [packages/store/src/calc.ts:2710](../../packages/store/src/calc.ts#L2710) `containerValue/read` | `Store.container` (2710) | CALC |
| [packages/store/src/calc.ts:2723](../../packages/store/src/calc.ts#L2723) `containerValue/value` | `Store.containerRange` (2723) | CALC |
| [packages/store/src/calc.ts:2841](../../packages/store/src/calc.ts#L2841) `sameValuesElsewhere` | `SQLite.all` (2841); `SQLite.prepare` (2841, 2848, 2850); `Store.sql` (2841, 2848, 2850); `Calculations.value` (2843); `SQLite.get` (2848, 2850) | CALC |
| [packages/store/src/calc.ts:3154](../../packages/store/src/calc.ts#L3154) `rowsById/flush` | `Calculations.statement` (3154); `SQLite.iterate` (3154) | CALC |
| [packages/store/src/damage.ts:93](../../packages/store/src/damage.ts#L93) `watchDatabase` | `SQLite.prepare` (93); `SQLite.iterate` (103) | CORE |
| [packages/store/src/explain-related.ts:102](../../packages/store/src/explain-related.ts#L102) `explainRelated` | `Store.row` (102); `Store.get` (190); `Calculations.value` (239); `Calculations.context` (247) | RECORD |
| [packages/store/src/explain-related.ts:180](../../packages/store/src/explain-related.ts#L180) `explainRelated/runFilter` | `Calculations.context` (180) | RECORD |
| [packages/store/src/explain-related.ts:298](../../packages/store/src/explain-related.ts#L298) `explainHop` | `keyValue` (298); `SQLite.get` (318); `SQLite.prepare` (318, 332); `Store.sql` (318, 332); `SQLite.all` (332) | RECORD |
| [packages/store/src/explain-related.ts:361](../../packages/store/src/explain-related.ts#L361) `explainCandidate` | `SQLite.get` (361, 375); `SQLite.prepare` (361, 375); `Store.sql` (361, 375); `keyValue` (372); `Calculations.context` (380) | RECORD |
| [packages/store/src/explain.ts:100](../../packages/store/src/explain.ts#L100) `explainField` | `Calculations.value` (100); `Calculations.context` (126) | RECORD |
| [packages/store/src/explain.ts:331](../../packages/store/src/explain.ts#L331) `lintFormula` | `Calculations.context` (331) | RECORD |
| [packages/store/src/export-sql.ts:229](../../packages/store/src/export-sql.ts#L229) `exportSql` | `Store.scopedTableSql` (229); `Store.select` (230, 363); `Store.container` (429) | OPERATOR |
| [packages/store/src/export-sql.ts:255](../../packages/store/src/export-sql.ts#L255) `exportSql/page` | `Store.select` (255) | OPERATOR |
| [packages/store/src/export-sql.ts:305](../../packages/store/src/export-sql.ts#L305) `exportSql/duplicates` | `Store.select` (305) | OPERATOR |
| [packages/store/src/fidelity.ts:176](../../packages/store/src/fidelity.ts#L176) `changedAfter` | `Untyped.executeSQL` (176) | DESIGN |
| [packages/store/src/fidelity.ts:196](../../packages/store/src/fidelity.ts#L196) `queryProblem` | `Calculations.translateSQL` (196); `Store.describe` (197) | DESIGN |
| [packages/store/src/fidelity.ts:214](../../packages/store/src/fidelity.ts#L214) `calcFidelity` | `Calculations.executeSQL` (214, 215, 301); `Store.sql` (219, 227, 300); `SQLite.all` (227); `SQLite.prepare` (227); `Calculations.computeStored` (263) | DESIGN |
| [packages/store/src/fmexport.ts:226](../../packages/store/src/fmexport.ts#L226) `fmExport` | `Store.recordCount` (226); `Store.query` (227); `Store.containerInfo` (242); `Store.container` (249) | OPERATOR |
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
| [packages/store/src/reconvert.ts:97](../../packages/store/src/reconvert.ts#L97) `meta` | `SQLite.get` (97); `SQLite.prepare` (97) | OPERATOR |
| [packages/store/src/reconvert.ts:102](../../packages/store/src/reconvert.ts#L102) `tableExists` | `SQLite.get` (102); `SQLite.prepare` (102) | OPERATOR |
| [packages/store/src/reconvert.ts:106](../../packages/store/src/reconvert.ts#L106) `columns` | `SQLite.all` (106); `SQLite.prepare` (106) | OPERATOR |
| [packages/store/src/reconvert.ts:119](../../packages/store/src/reconvert.ts#L119) `reconvertCheck` | `SQLite.get` (119); `SQLite.prepare` (119) | OPERATOR |
| [packages/store/src/reconvert.ts:194](../../packages/store/src/reconvert.ts#L194) `build` | `SQLite.get` (194); `SQLite.prepare` (194, 197, 202); `SQLite.all` (202) | OPERATOR |
| [packages/store/src/reconvert.ts:229](../../packages/store/src/reconvert.ts#L229) `previewOf/count` | `SQLite.get` (229); `SQLite.prepare` (229) | OPERATOR |
| [packages/store/src/reconvert.ts:242](../../packages/store/src/reconvert.ts#L242) `previewOf` | `SQLite.get` (242); `SQLite.prepare` (242) | OPERATOR |
| [packages/store/src/reconvert.ts:262](../../packages/store/src/reconvert.ts#L262) `copyContainer` | `SQLite.get` (262); `SQLite.prepare` (262, 264, 270) | OPERATOR |
| [packages/store/src/reconvert.ts:299](../../packages/store/src/reconvert.ts#L299) `carryRecords` | `SQLite.prepare` (299, 302, 303, 313, 319, 320); `SQLite.all` (302, 306, 319) | OPERATOR |
| [packages/store/src/reconvert.ts:328](../../packages/store/src/reconvert.ts#L328) `carrySettings` | `SQLite.all` (328, 332, 340); `SQLite.prepare` (328, 332, 340, 341, 345); `SQLite.get` (345) | OPERATOR |
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
| [packages/store/src/store.ts:864](../../packages/store/src/store.ts#L864) `Store/metadataVersions` | `SQLite.get` (864); `SQLite.prepare` (864); `Store.sql` (864) | CORE |
| [packages/store/src/store.ts:999](../../packages/store/src/store.ts#L999) `Store/constructor` | `Store.sql` (999, 1001, 1003, 1004, 1008, 1012, 1013, 1024, 1029, 1034, 1035, 1039, 1040, 1041, 1048, 1052, 1056, 1057, 1058, 1062, 1066, 1069, 1070, 1072, 1073, 1076, 1077, 1081, 1082, 1086, 1087, 1090, 1092, 1095, 1096, 1100, 1101, 1105, 1106, 1109, 1110, 1111, 1114, 1115, 1118, 1119, 1121, 1121, 1122, 1122, 1123, 1126, 1130, 1132, 1135, 1136, 1137, 1140, 1141, 1143, 1145, 1146, 1151, 1152, 1153, 1153, 1157, 1158); `SQLite.get` (1003); `SQLite.prepare` (1003, 1069, 1070, 1073, 1076, 1081, 1086, 1095, 1100, 1105, 1114, 1118, 1121, 1122, 1140, 1145); `SQLite.all` (1069, 1076, 1081, 1086, 1095, 1100, 1105, 1114, 1118, 1121, 1122, 1140, 1145) | CORE |
| [packages/store/src/store.ts:1177](../../packages/store/src/store.ts#L1177) `Store/grantFullAccessClients` | `SQLite.prepare` (1177); `Store.sql` (1177) | CORE |
| [packages/store/src/store.ts:1194](../../packages/store/src/store.ts#L1194) `Store/meta` | `SQLite.get` (1194); `SQLite.prepare` (1194); `Store.sql` (1194) | CORE |
| [packages/store/src/store.ts:1202](../../packages/store/src/store.ts#L1202) `Store/persistentTable` | `Store.sql` (1202) | CORE |
| [packages/store/src/store.ts:1212](../../packages/store/src/store.ts#L1212) `Store/persistentData` | `SQLite.get` (1212) | CORE |
| [packages/store/src/store.ts:1221](../../packages/store/src/store.ts#L1221) `Store/persistentDataIds` | `SQLite.all` (1221) | CORE |
| [packages/store/src/store.ts:1227](../../packages/store/src/store.ts#L1227) `Store/setPersistentData` | `SQLite.prepare` (1227, 1231); `Store.sql` (1227, 1231) | CORE |
| [packages/store/src/store.ts:1244](../../packages/store/src/store.ts#L1244) `Store/checkpoint` | `SQLite.get` (1244); `SQLite.prepare` (1244); `Store.sql` (1244) | CORE |
| [packages/store/src/store.ts:1252](../../packages/store/src/store.ts#L1252) `Store/recordedFormat` | `Store.sql` (1252) | CORE |
| [packages/store/src/store.ts:1262](../../packages/store/src/store.ts#L1262) `Store/close` | `Store.sql` (1262) | CORE |
| [packages/store/src/store.ts:1278](../../packages/store/src/store.ts#L1278) `Store/shipWal` | `Store.sql` (1278) | CORE |
| [packages/store/src/store.ts:1289](../../packages/store/src/store.ts#L1289) `Store/trial` | `Store.sql` (1289) | CORE |
| [packages/store/src/store.ts:1294](../../packages/store/src/store.ts#L1294) `Store/trial/undo` | `Store.sql` (1294) | CORE |
| [packages/store/src/store.ts:1329](../../packages/store/src/store.ts#L1329) `Store/joinTransaction` | `Store.sql` (1329, 1330, 1332, 1334, 1340) | CORE |
| [packages/store/src/store.ts:1352](../../packages/store/src/store.ts#L1352) `Store/independentWindowWrite` | `SQLite.get` (1352); `SQLite.prepare` (1352, 1375); `Store.sql` (1352, 1355, 1370, 1375, 1378) | CORE |
| [packages/store/src/store.ts:1400](../../packages/store/src/store.ts#L1400) `Store/withWriteTransaction` | `Store.sql` (1400, 1403, 1407, 1409, 1409) | CORE |
| [packages/store/src/store.ts:1439](../../packages/store/src/store.ts#L1439) `Store/endTransaction` | `Store.sql` (1439, 1442, 1442) | CORE |
| [packages/store/src/store.ts:1466](../../packages/store/src/store.ts#L1466) `Store/backup` | `Store.sql` (1466) | CORE |
| [packages/store/src/store.ts:1489](../../packages/store/src/store.ts#L1489) `Store/dataVersion` | `SQLite.get` (1489); `SQLite.prepare` (1489); `Store.sql` (1489) | CORE |
| [packages/store/src/store.ts:1529](../../packages/store/src/store.ts#L1529) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1529) | CORE |
| [packages/store/src/store.ts:1550](../../packages/store/src/store.ts#L1550) `Store/shareResults` | `Store.sql` (1550) | CORE |
| [packages/store/src/store.ts:1560](../../packages/store/src/store.ts#L1560) `Store/versionTriggers` | `SQLite.get` (1560); `SQLite.prepare` (1560, 1565, 1566); `Store.sql` (1560, 1562, 1563, 1565, 1566, 1575, 1576); `SQLite.all` (1565, 1566) | CORE |
| [packages/store/src/store.ts:1592](../../packages/store/src/store.ts#L1592) `Store/versionNumber` | `SQLite.get` (1592); `SQLite.prepare` (1592); `Store.sql` (1592) | CORE |
| [packages/store/src/store.ts:1605](../../packages/store/src/store.ts#L1605) `Store/changeOne` | `Store.sql` (1605, 1607) | CORE |
| [packages/store/src/store.ts:1608](../../packages/store/src/store.ts#L1608) `Store/changeOne/read` | `SQLite.get` (1608); `SQLite.prepare` (1608); `Store.sql` (1608) | CORE |
| [packages/store/src/store.ts:1647](../../packages/store/src/store.ts#L1647) `Store/writeToken` | `SQLite.get` (1647); `SQLite.prepare` (1647); `Store.sql` (1647) | CORE |
| [packages/store/src/store.ts:1659](../../packages/store/src/store.ts#L1659) `Store/recordCount` | `SQLite.get` (1659); `SQLite.prepare` (1659); `Store.sql` (1659) | CORE |
| [packages/store/src/store.ts:1767](../../packages/store/src/store.ts#L1767) `Store/applyDesign` | `Store.sql` (1767, 1768, 1779, 1782, 1787, 1799, 1802, 1802); `SQLite.prepare` (1782, 1787) | CORE |
| [packages/store/src/store.ts:1860](../../packages/store/src/store.ts#L1860) `Store/auditLog` | `SQLite.all` (1860); `SQLite.prepare` (1860); `Store.sql` (1860) | CORE |
| [packages/store/src/store.ts:1900](../../packages/store/src/store.ts#L1900) `Store/securityEvents` | `Store.auditLog` (1900) | CORE |
| [packages/store/src/store.ts:1926](../../packages/store/src/store.ts#L1926) `Store/prepared` | `SQLite.prepare` (1926); `Store.sql` (1926) | CORE |
| [packages/store/src/store.ts:1941](../../packages/store/src/store.ts#L1941) `Store/recordAsOf` | `SQLite.get` (1941, 1943); `SQLite.prepare` (1941, 1943, 1945, 1946); `Store.sql` (1941, 1943, 1945, 1946); `SQLite.all` (1945, 1946) | CORE |
| [packages/store/src/store.ts:1971](../../packages/store/src/store.ts#L1971) `Store/restoreRecord` | `Store.recordAsOf` (1971); `SQLite.get` (1975); `SQLite.prepare` (1975, 1978, 1985, 1992); `Store.sql` (1975, 1978, 1985, 1992) | CORE |
| [packages/store/src/store.ts:2006](../../packages/store/src/store.ts#L2006) `Store/revertAuditEntry` | `Store.auditLog` (2006) | CORE |
| [packages/store/src/store.ts:2099](../../packages/store/src/store.ts#L2099) `Store/setAuditSettings` | `SQLite.prepare` (2099); `Store.sql` (2099) | CORE |
| [packages/store/src/store.ts:2121](../../packages/store/src/store.ts#L2121) `Store/pruneAudit` | `Store.sql` (2121, 2123, 2125); `SQLite.get` (2123); `SQLite.prepare` (2123) | CORE |
| [packages/store/src/store.ts:2203](../../packages/store/src/store.ts#L2203) `Store/audit` | `Store.sql` (2203) | CORE |
| [packages/store/src/store.ts:2292](../../packages/store/src/store.ts#L2292) `Store/securityChange` | `Store.sql` (2292, 2294); `SQLite.prepare` (2294) | CORE |
| [packages/store/src/store.ts:2341](../../packages/store/src/store.ts#L2341) `Store/logSecurity` | `Store.sql` (2341) | CORE |
| [packages/store/src/store.ts:2364](../../packages/store/src/store.ts#L2364) `Store/ensureDeleted` | `Store.sql` (2364) | CORE |
| [packages/store/src/store.ts:2369](../../packages/store/src/store.ts#L2369) `Store/deletedRows` | `SQLite.get` (2369); `SQLite.prepare` (2369, 2371, 2371); `Store.sql` (2369, 2371, 2371); `SQLite.all` (2371, 2371) | CORE |
| [packages/store/src/store.ts:2395](../../packages/store/src/store.ts#L2395) `Store/emptyDeleted` | `Store.sql` (2395, 2398, 2399, 2401, 2403); `SQLite.prepare` (2399) | CORE |
| [packages/store/src/store.ts:2410](../../packages/store/src/store.ts#L2410) `Store/designHistory` | `SQLite.all` (2410); `SQLite.prepare` (2410); `Store.sql` (2410) | CORE |
| [packages/store/src/store.ts:2417](../../packages/store/src/store.ts#L2417) `Store/scriptHistory` | `SQLite.all` (2417); `SQLite.prepare` (2417); `Store.sql` (2417) | CORE |
| [packages/store/src/store.ts:2427](../../packages/store/src/store.ts#L2427) `Store/layoutHistory` | `SQLite.all` (2427); `SQLite.prepare` (2427); `Store.sql` (2427) | CORE |
| [packages/store/src/store.ts:2452](../../packages/store/src/store.ts#L2452) `Store/designEffect/renameKey` | `SQLite.prepare` (2452); `Store.sql` (2452) | CORE |
| [packages/store/src/store.ts:2468](../../packages/store/src/store.ts#L2468) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2468); `Store.sql` (2468) | CORE |
| [packages/store/src/store.ts:2475](../../packages/store/src/store.ts#L2475) `Store/designEffect` | `Store.sql` (2475, 2479, 2484, 2489, 2492, 2498, 2506, 2507, 2509, 2521, 2522, 2525, 2527, 2533, 2534, 2535, 2540, 2542, 2546, 2549, 2550, 2552, 2555, 2560, 2562, 2569, 2570, 2572, 2573, 2574, 2575, 2582, 2583, 2585, 2585, 2587, 2588, 2589, 2593, 2597, 2599, 2637, 2639, 2641); `SQLite.get` (2506, 2521, 2533, 2534, 2546, 2550, 2585, 2593); `SQLite.prepare` (2506, 2507, 2521, 2522, 2533, 2534, 2540, 2542, 2546, 2550, 2560, 2562, 2575, 2582, 2583, 2585, 2587, 2589, 2593, 2597); `SQLite.all` (2582, 2583); `SQLite.iterate` (2587) | CORE |
| [packages/store/src/store.ts:2649](../../packages/store/src/store.ts#L2649) `Store/dropColumnIndexes` | `SQLite.all` (2649, 2651); `SQLite.prepare` (2649, 2651); `Store.sql` (2649, 2651, 2652) | CORE |
| [packages/store/src/store.ts:2661](../../packages/store/src/store.ts#L2661) `Store/recompute` | `SQLite.prepare` (2661, 2665); `Store.sql` (2661, 2665); `SQLite.iterate` (2665); `Calculations.computeStoredStyled` (2666); `Calculations.value` (2666) | CORE |
| [packages/store/src/store.ts:2681](../../packages/store/src/store.ts#L2681) `Store/linkPrincipal` | `SQLite.get` (2681); `SQLite.prepare` (2681); `Store.sql` (2681) | CORE |
| [packages/store/src/store.ts:2688](../../packages/store/src/store.ts#L2688) `Store/linkIdentity` | `SQLite.get` (2688); `SQLite.prepare` (2688); `Store.sql` (2688) | CORE |
| [packages/store/src/store.ts:2694](../../packages/store/src/store.ts#L2694) `Store/accountsSharingLockout` | `SQLite.all` (2694); `SQLite.prepare` (2694); `Store.sql` (2694) | CORE |
| [packages/store/src/store.ts:2698](../../packages/store/src/store.ts#L2698) `Store/accounts` | `SQLite.all` (2698); `SQLite.prepare` (2698); `Store.sql` (2698) | CORE |
| [packages/store/src/store.ts:2710](../../packages/store/src/store.ts#L2710) `Store/isAgent` | `SQLite.get` (2710); `SQLite.prepare` (2710); `Store.sql` (2710) | CORE |
| [packages/store/src/store.ts:2716](../../packages/store/src/store.ts#L2716) `Store/agentNeedsApproval` | `SQLite.get` (2716); `SQLite.prepare` (2716); `Store.sql` (2716) | CORE |
| [packages/store/src/store.ts:2722](../../packages/store/src/store.ts#L2722) `Store/blankPasswordAccounts` | `SQLite.all` (2722); `SQLite.prepare` (2722); `Store.sql` (2722) | CORE |
| [packages/store/src/store.ts:1185](../../packages/store/src/store.ts#L1185) `Store/hasOwnPassword` | `SQLite.get` (1185); `SQLite.prepare` (1185); `Store.sql` (1185) | CORE |
| [packages/store/src/store.ts:2733](../../packages/store/src/store.ts#L2733) `Store/unmigratedAccounts` | `SQLite.all` (2733); `SQLite.prepare` (2733); `Store.sql` (2733) | CORE |
| [packages/store/src/store.ts:2786](../../packages/store/src/store.ts#L2786) `Store/setExternalAccount` | `SQLite.get` (2786); `SQLite.prepare` (2786, 2791); `Store.sql` (2786, 2791) | CORE |
| [packages/store/src/store.ts:2804](../../packages/store/src/store.ts#L2804) `Store/refuseLookalikeAccount` | `SQLite.all` (2804); `SQLite.prepare` (2804); `Store.sql` (2804) | CORE |
| [packages/store/src/store.ts:2813](../../packages/store/src/store.ts#L2813) `Store/isExternal` | `SQLite.get` (2813); `SQLite.prepare` (2813); `Store.sql` (2813) | CORE |
| [packages/store/src/store.ts:2834](../../packages/store/src/store.ts#L2834) `Store/setAgentAccount` | `SQLite.get` (2834); `SQLite.prepare` (2834, 2840); `Store.sql` (2834, 2840) | CORE |
| [packages/store/src/store.ts:2874](../../packages/store/src/store.ts#L2874) `Store/gateAgentWrite` | `SQLite.prepare` (2874); `Store.sql` (2874) | CORE |
| [packages/store/src/store.ts:2896](../../packages/store/src/store.ts#L2896) `Store/pendingChanges` | `SQLite.all` (2896); `SQLite.prepare` (2896); `Store.sql` (2896) | CORE |
| [packages/store/src/store.ts:2910](../../packages/store/src/store.ts#L2910) `Store/approvePending` | `SQLite.get` (2910); `SQLite.prepare` (2910, 2921); `Store.sql` (2910, 2921) | CORE |
| [packages/store/src/store.ts:2931](../../packages/store/src/store.ts#L2931) `Store/rejectPending` | `SQLite.get` (2931); `SQLite.prepare` (2931, 2933); `Store.sql` (2931, 2933) | CORE |
| [packages/store/src/store.ts:2953](../../packages/store/src/store.ts#L2953) `Store/externalAccount` | `SQLite.all` (2953); `SQLite.prepare` (2953); `Store.sql` (2953) | CORE |
| [packages/store/src/store.ts:2984](../../packages/store/src/store.ts#L2984) `Store/setPassword` | `SQLite.get` (2984); `SQLite.prepare` (2984, 2986, 2995); `Store.sql` (2984, 2986, 2995) | AUTH |
| [packages/store/src/store.ts:3009](../../packages/store/src/store.ts#L3009) `Store/createAccount` | `SQLite.get` (3009); `SQLite.prepare` (3009, 3013, 3019, 3024, 3029); `Store.sql` (3009, 3013, 3019, 3024, 3029) | CORE |
| [packages/store/src/store.ts:3037](../../packages/store/src/store.ts#L3037) `Store/appendSecurityEvent` | `Store.sql` (3037) | CORE |
| [packages/store/src/store.ts:3079](../../packages/store/src/store.ts#L3079) `Store/setPasswordPolicy` | `SQLite.prepare` (3079); `Store.sql` (3079) | CORE |
| [packages/store/src/store.ts:3115](../../packages/store/src/store.ts#L3115) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3115); `Store.sql` (3115) | CORE |
| [packages/store/src/store.ts:3138](../../packages/store/src/store.ts#L3138) `Store/saveScriptTest` | `SQLite.prepare` (3138); `Store.sql` (3138) | CORE |
| [packages/store/src/store.ts:3147](../../packages/store/src/store.ts#L3147) `Store/deleteScriptTest` | `SQLite.prepare` (3147); `Store.sql` (3147) | CORE |
| [packages/store/src/store.ts:3182](../../packages/store/src/store.ts#L3182) `Store/setAiAllowed` | `SQLite.prepare` (3182); `Store.sql` (3182) | CORE |
| [packages/store/src/store.ts:3228](../../packages/store/src/store.ts#L3228) `Store/setAiPolicy` | `SQLite.prepare` (3228); `Store.sql` (3228) | CORE |
| [packages/store/src/store.ts:3197](../../packages/store/src/store.ts#L3197) `Store/setScriptNetwork` | `SQLite.prepare` (3197); `Store.sql` (3197) | CORE |
| [packages/store/src/store.ts:3217](../../packages/store/src/store.ts#L3217) `Store/setWebViewerHosts` | `SQLite.prepare` (3217); `Store.sql` (3217) | CORE |
| [packages/store/src/store.ts:3248](../../packages/store/src/store.ts#L3248) `Store/setPiiIsolation` | `SQLite.prepare` (3248); `Store.sql` (3248) | CORE |
| [packages/store/src/store.ts:3270](../../packages/store/src/store.ts#L3270) `Store/markPiiField` | `SQLite.prepare` (3270); `Store.sql` (3270) | CORE |
| [packages/store/src/store.ts:3384](../../packages/store/src/store.ts#L3384) `Store/lastSignIns` | `Store.auditLog` (3384) | CORE |
| [packages/store/src/store.ts:3587](../../packages/store/src/store.ts#L3587) `Store/unusualAccess` | `Store.auditLog` (3587, 3653) | CORE |
| [packages/store/src/store.ts:3684](../../packages/store/src/store.ts#L3684) `Store/leastPrivilege` | `SQLite.all` (3684); `SQLite.prepare` (3684); `Store.sql` (3684) | CORE |
| [packages/store/src/store.ts:3757](../../packages/store/src/store.ts#L3757) `Store/unusedAccess` | `SQLite.get` (3757); `SQLite.prepare` (3757, 3766); `Store.sql` (3757, 3766); `SQLite.all` (3766) | CORE |
| [packages/store/src/store.ts:3805](../../packages/store/src/store.ts#L3805) `Store/unusedObjects` | `SQLite.get` (3805); `SQLite.prepare` (3805, 3808); `Store.sql` (3805, 3808); `SQLite.all` (3808) | CORE |
| [packages/store/src/store.ts:3843](../../packages/store/src/store.ts#L3843) `Store/usageCounting` | `SQLite.get` (3843); `SQLite.prepare` (3843); `Store.sql` (3843) | CORE |
| [packages/store/src/store.ts:3851](../../packages/store/src/store.ts#L3851) `Store/setMustChangePassword` | `SQLite.prepare` (3851); `Store.sql` (3851) | CORE |
| [packages/store/src/store.ts:3865](../../packages/store/src/store.ts#L3865) `Store/mustChangePassword` | `SQLite.get` (3865); `SQLite.prepare` (3865); `Store.sql` (3865) | CORE |
| [packages/store/src/store.ts:3904](../../packages/store/src/store.ts#L3904) `Store/passwordDaysRemaining` | `SQLite.get` (3904); `SQLite.prepare` (3904); `Store.sql` (3904) | CORE |
| [packages/store/src/store.ts:3911](../../packages/store/src/store.ts#L3911) `Store/importAccounts` | `SQLite.all` (3911); `SQLite.prepare` (3911); `Store.sql` (3911) | CORE |
| [packages/store/src/store.ts:3934](../../packages/store/src/store.ts#L3934) `Store/canonicalAccount` | `SQLite.all` (3934); `SQLite.prepare` (3934); `Store.sql` (3934) | CORE |
| [packages/store/src/store.ts:3946](../../packages/store/src/store.ts#L3946) `Store/createLocalAccount` | `SQLite.prepare` (3946); `Store.sql` (3946) | CORE |
| [packages/store/src/store.ts:3976](../../packages/store/src/store.ts#L3976) `Store/previewAccountImport` | `Store.sql` (3976, 3977, 3986) | CORE |
| [packages/store/src/store.ts:3994](../../packages/store/src/store.ts#L3994) `Store/limitAccountImport` | `SQLite.prepare` (3994, 3995, 3998); `Store.sql` (3994, 3995, 3998); `SQLite.get` (3995) | CORE |
| [packages/store/src/store.ts:4005](../../packages/store/src/store.ts#L4005) `Store/applyAccountImport` | `Store.sql` (4005, 4013, 4042); `SQLite.get` (4013); `SQLite.prepare` (4013, 4042) | CORE |
| [packages/store/src/store.ts:4067](../../packages/store/src/store.ts#L4067) `Store/forgetStandIns` | `SQLite.prepare` (4067); `Store.sql` (4067) | CORE |
| [packages/store/src/store.ts:4100](../../packages/store/src/store.ts#L4100) `Store/deleteAccount` | `SQLite.prepare` (4100, 4101, 4102, 4104, 4108); `Store.sql` (4100, 4101, 4102, 4104, 4108) | CORE |
| [packages/store/src/store.ts:4125](../../packages/store/src/store.ts#L4125) `Store/setAccountActive` | `SQLite.prepare` (4125, 4128, 4129); `Store.sql` (4125, 4128, 4129) | AUTH |
| [packages/store/src/store.ts:4139](../../packages/store/src/store.ts#L4139) `Store/accountInactive` | `SQLite.get` (4139); `SQLite.prepare` (4139); `Store.sql` (4139) | CORE |
| [packages/store/src/store.ts:4144](../../packages/store/src/store.ts#L4144) `Store/identityAllowed` | `SQLite.get` (4144, 4150, 4156); `SQLite.prepare` (4144, 4150, 4156); `Store.sql` (4144, 4150, 4156) | CORE |
| [packages/store/src/store.ts:4164](../../packages/store/src/store.ts#L4164) `Store/externalIdentityId` | `SQLite.get` (4164, 4170); `SQLite.prepare` (4164, 4169, 4170); `Store.sql` (4164, 4169, 4170) | CORE |
| [packages/store/src/store.ts:4175](../../packages/store/src/store.ts#L4175) `Store/accountIdentityId` | `SQLite.get` (4175, 4180); `SQLite.prepare` (4175, 4179, 4180); `Store.sql` (4175, 4179, 4180) | CORE |
| [packages/store/src/store.ts:4203](../../packages/store/src/store.ts#L4203) `Store/signInMark` | `SQLite.prepare` (4203); `Store.sql` (4203) | AUTH |
| [packages/store/src/store.ts:4213](../../packages/store/src/store.ts#L4213) `Store/signInBase` | `SQLite.get` (4213); `SQLite.prepare` (4213); `Store.sql` (4213) | AUTH |
| [packages/store/src/store.ts:4215](../../packages/store/src/store.ts#L4215) `Store/signInBase/identity` | `SQLite.get` (4215); `SQLite.prepare` (4215); `Store.sql` (4215) | AUTH |
| [packages/store/src/store.ts:4227](../../packages/store/src/store.ts#L4227) `Store/ledgerRow` | `SQLite.get` (4227, 4228); `SQLite.prepare` (4227, 4228); `Store.sql` (4227, 4228) | AUTH |
| [packages/store/src/store.ts:4239](../../packages/store/src/store.ts#L4239) `Store/ledgerWrite` | `Store.sql` (4239, 4240, 4242, 4244, 4247, 4247) | AUTH |
| [packages/store/src/store.ts:4266](../../packages/store/src/store.ts#L4266) `Store/settleSignIns` | `SQLite.all` (4266, 4272); `SQLite.prepare` (4266, 4272, 4278, 4282, 4284); `Store.sql` (4266, 4272, 4278, 4282, 4284) | AUTH |
| [packages/store/src/store.ts:4295](../../packages/store/src/store.ts#L4295) `Store/securityToken` | `SQLite.get` (4295); `SQLite.prepare` (4295); `Store.sql` (4295) | CORE |
| [packages/store/src/store.ts:4303](../../packages/store/src/store.ts#L4303) `Store/accountLocalOnly` | `SQLite.get` (4303); `SQLite.prepare` (4303); `Store.sql` (4303) | CORE |
| [packages/store/src/store.ts:4308](../../packages/store/src/store.ts#L4308) `Store/accountRequires2fa` | `SQLite.get` (4308); `SQLite.prepare` (4308); `Store.sql` (4308) | CORE |
| [packages/store/src/store.ts:4314](../../packages/store/src/store.ts#L4314) `Store/setAccountLocalOnly` | `SQLite.prepare` (4314); `Store.sql` (4314) | CORE |
| [packages/store/src/store.ts:4323](../../packages/store/src/store.ts#L4323) `Store/setAccountRequire2fa` | `SQLite.prepare` (4323); `Store.sql` (4323) | CORE |
| [packages/store/src/store.ts:4352](../../packages/store/src/store.ts#L4352) `Store/createApiToken` | `SQLite.get` (4352); `SQLite.prepare` (4352, 4382); `Store.sql` (4352, 4382) | CORE |
| [packages/store/src/store.ts:4429](../../packages/store/src/store.ts#L4429) `Store/recordObjectUse` | `Store.sql` (4429) | CORE |
| [packages/store/src/store.ts:4459](../../packages/store/src/store.ts#L4459) `Store/writeUsage` | `Store.sql` (4459, 4460, 4462, 4466, 4468) | CORE |
| [packages/store/src/store.ts:4475](../../packages/store/src/store.ts#L4475) `Store/writeUsageRows` | `SQLite.prepare` (4475, 4476, 4482); `Store.sql` (4475, 4476, 4482) | CORE |
| [packages/store/src/store.ts:4487](../../packages/store/src/store.ts#L4487) `Store/writeObjectUseRows` | `SQLite.prepare` (4487, 4488, 4493); `Store.sql` (4487, 4488, 4493) | CORE |
| [packages/store/src/store.ts:4498](../../packages/store/src/store.ts#L4498) `Store/objectUseSince` | `SQLite.get` (4498); `SQLite.prepare` (4498); `Store.sql` (4498) | CORE |
| [packages/store/src/store.ts:4511](../../packages/store/src/store.ts#L4511) `Store/accountUsage` | `SQLite.get` (4511); `SQLite.prepare` (4511, 4512); `Store.sql` (4511, 4512); `SQLite.all` (4512); `Store.auditLog` (4528) | CORE |
| [packages/store/src/store.ts:4544](../../packages/store/src/store.ts#L4544) `Store/apiTokens` | `SQLite.all` (4544); `SQLite.prepare` (4544); `Store.sql` (4544) | CORE |
| [packages/store/src/store.ts:4554](../../packages/store/src/store.ts#L4554) `Store/revokeApiToken` | `SQLite.prepare` (4554); `Store.sql` (4554) | CORE |
| [packages/store/src/store.ts:4568](../../packages/store/src/store.ts#L4568) `Store/apiToken` | `SQLite.get` (4568); `SQLite.prepare` (4568, 4580); `Store.sql` (4568, 4580) | CORE |
| [packages/store/src/store.ts:4596](../../packages/store/src/store.ts#L4596) `Store/enrollTotp` | `SQLite.prepare` (4596); `Store.sql` (4596) | CORE |
| [packages/store/src/store.ts:4607](../../packages/store/src/store.ts#L4607) `Store/confirmTotp` | `SQLite.get` (4607); `SQLite.prepare` (4607, 4609); `Store.sql` (4607, 4609) | CORE |
| [packages/store/src/store.ts:4617](../../packages/store/src/store.ts#L4617) `Store/hasTotp` | `SQLite.get` (4617); `SQLite.prepare` (4617); `Store.sql` (4617) | CORE |
| [packages/store/src/store.ts:4622](../../packages/store/src/store.ts#L4622) `Store/totpAccounts` | `SQLite.all` (4622); `SQLite.prepare` (4622); `Store.sql` (4622) | CORE |
| [packages/store/src/store.ts:4628](../../packages/store/src/store.ts#L4628) `Store/disableTotp` | `SQLite.prepare` (4628); `Store.sql` (4628) | CORE |
| [packages/store/src/store.ts:4651](../../packages/store/src/store.ts#L4651) `Store/verifyTotp` | `SQLite.get` (4651); `SQLite.prepare` (4651, 4657); `Store.sql` (4651, 4657) | CORE |
| [packages/store/src/store.ts:4670](../../packages/store/src/store.ts#L4670) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4670, 4672, 4673, 4675); `Store.sql` (4670, 4672, 4673, 4675); `SQLite.get` (4672) | CORE |
| [packages/store/src/store.ts:4722](../../packages/store/src/store.ts#L4722) `Store/passkeyAllowList` | `SQLite.all` (4722); `SQLite.prepare` (4722); `Store.sql` (4722) | CORE |
| [packages/store/src/store.ts:4736](../../packages/store/src/store.ts#L4736) `Store/takeWebauthnChallenge` | `SQLite.get` (4736); `SQLite.prepare` (4736, 4738); `Store.sql` (4736, 4738) | CORE |
| [packages/store/src/store.ts:4746](../../packages/store/src/store.ts#L4746) `Store/passkeys` | `SQLite.all` (4746); `SQLite.prepare` (4746); `Store.sql` (4746) | CORE |
| [packages/store/src/store.ts:4753](../../packages/store/src/store.ts#L4753) `Store/hasPasskey` | `SQLite.get` (4753); `SQLite.prepare` (4753); `Store.sql` (4753) | CORE |
| [packages/store/src/store.ts:4758](../../packages/store/src/store.ts#L4758) `Store/passkeyIds` | `SQLite.all` (4758); `SQLite.prepare` (4758); `Store.sql` (4758) | CORE |
| [packages/store/src/store.ts:4780](../../packages/store/src/store.ts#L4780) `Store/registerPasskey` | `SQLite.prepare` (4780); `Store.sql` (4780) | CORE |
| [packages/store/src/store.ts:4791](../../packages/store/src/store.ts#L4791) `Store/removePasskey` | `SQLite.get` (4791); `SQLite.prepare` (4791, 4792); `Store.sql` (4791, 4792) | CORE |
| [packages/store/src/store.ts:4808](../../packages/store/src/store.ts#L4808) `Store/verifyPasskeyAssertion` | `SQLite.get` (4808); `SQLite.prepare` (4808, 4819); `Store.sql` (4808, 4819) | CORE |
| [packages/store/src/store.ts:4855](../../packages/store/src/store.ts#L4855) `Store/generateRecoveryCodes` | `SQLite.prepare` (4855, 4858); `Store.sql` (4855, 4858) | CORE |
| [packages/store/src/store.ts:4873](../../packages/store/src/store.ts#L4873) `Store/recoveryCodesRemaining` | `SQLite.get` (4873); `SQLite.prepare` (4873); `Store.sql` (4873) | CORE |
| [packages/store/src/store.ts:4883](../../packages/store/src/store.ts#L4883) `Store/useRecoveryCode` | `SQLite.get` (4883); `SQLite.prepare` (4883, 4885); `Store.sql` (4883, 4885) | CORE |
| [packages/store/src/store.ts:4896](../../packages/store/src/store.ts#L4896) `Store/privilegeSets` | `Store.sql` (4896) | CORE |
| [packages/store/src/store.ts:4925](../../packages/store/src/store.ts#L4925) `Store/savePrivilegeSet` | `SQLite.prepare` (4925, 4933); `Store.sql` (4925, 4933) | AUTH |
| [packages/store/src/store.ts:4968](../../packages/store/src/store.ts#L4968) `Store/deletePrivilegeSet` | `SQLite.prepare` (4968); `Store.sql` (4968) | CORE |
| [packages/store/src/store.ts:5037](../../packages/store/src/store.ts#L5037) `Store/accountPrivilegeSet` | `SQLite.get` (5037); `SQLite.prepare` (5037); `Store.sql` (5037) | CORE |
| [packages/store/src/store.ts:5051](../../packages/store/src/store.ts#L5051) `Store/setAccountPrivilegeSet` | `SQLite.get` (5051); `SQLite.prepare` (5051, 5054, 5058); `Store.sql` (5051, 5054, 5058) | AUTH |
| [packages/store/src/store.ts:5073](../../packages/store/src/store.ts#L5073) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5073); `Store.sql` (5073) | CORE |
| [packages/store/src/store.ts:5087](../../packages/store/src/store.ts#L5087) `Store/addProvisionedAccount` | `SQLite.get` (5087); `SQLite.prepare` (5087, 5091); `Store.sql` (5087, 5091) | CORE |
| [packages/store/src/store.ts:5260](../../packages/store/src/store.ts#L5260) `Store/ruleOutcome` | `Calculations.context` (5260) | CORE |
| [packages/store/src/store.ts:5301](../../packages/store/src/store.ts#L5301) `Store/allowedIds` | `SQLite.iterate` (5301); `SQLite.prepare` (5301); `Store.sql` (5301) | CORE |
| [packages/store/src/store.ts:5371](../../packages/store/src/store.ts#L5371) `Store/scopedTableSql` | `Store.viewableIds` (5371); `SQLite.all` (5374); `SQLite.prepare` (5374); `Store.sql` (5374) | GATED-STORE |
| [packages/store/src/store.ts:5406](../../packages/store/src/store.ts#L5406) `Store/previewRecordRuleCurrent` | `SQLite.get` (5406); `SQLite.prepare` (5406, 5409); `Store.sql` (5406, 5409); `SQLite.all` (5409); `Calculations.context` (5415, 5431) | CORE |
| [packages/store/src/store.ts:5583](../../packages/store/src/store.ts#L5583) `Store/passwordHash` | `SQLite.get` (5583); `SQLite.prepare` (5583); `Store.sql` (5583) | CORE |
| [packages/store/src/store.ts:5612](../../packages/store/src/store.ts#L5612) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5612); `Store.sql` (5612) | CORE |
| [packages/store/src/store.ts:5625](../../packages/store/src/store.ts#L5625) `Store/knownSharedAccount` | `SQLite.get` (5625); `SQLite.prepare` (5625); `Store.sql` (5625) | CORE |
| [packages/store/src/store.ts:5688](../../packages/store/src/store.ts#L5688) `Store/layouts` | `SQLite.all` (5688); `SQLite.prepare` (5688); `Store.sql` (5688) | CORE |
| [packages/store/src/store.ts:5709](../../packages/store/src/store.ts#L5709) `Store/image` | `SQLite.get` (5709); `SQLite.prepare` (5709); `Store.sql` (5709) | CORE |
| [packages/store/src/store.ts:5719](../../packages/store/src/store.ts#L5719) `Store/images` | `SQLite.all` (5719); `SQLite.prepare` (5719); `Store.sql` (5719) | CORE |
| [packages/store/src/store.ts:5732](../../packages/store/src/store.ts#L5732) `Store/addImage` | `Store.sql` (5732, 5733); `SQLite.prepare` (5733) | CORE |
| [packages/store/src/store.ts:5749](../../packages/store/src/store.ts#L5749) `Store/layout` | `SQLite.get` (5749); `SQLite.prepare` (5749); `Store.sql` (5749) | CORE |
| [packages/store/src/store.ts:5953](../../packages/store/src/store.ts#L5953) `Store/wordIndex` | `Store.sql` (5953, 5961, 5966); `Store.recordCount` (5965); `SQLite.get` (5966); `SQLite.prepare` (5966) | CORE |
| [packages/store/src/store.ts:6018](../../packages/store/src/store.ts#L6018) `Store/toRecord` | `Calculations.value` (6018, 6028); `Calculations.globalValue` (6022); `Calculations.unstoredStyled` (6027) | CORE |
| [packages/store/src/store.ts:6077](../../packages/store/src/store.ts#L6077) `Store/relatedValues` | `Calculations.globalValue` (6077); `Calculations.unstoredValue` (6079) | CORE |
| [packages/store/src/store.ts:6151](../../packages/store/src/store.ts#L6151) `Store/addRelated` | `relatedRows` (6151); `rowsById` (6183); `firstRelatedEach` (6205) | CORE |
| [packages/store/src/store.ts:6233](../../packages/store/src/store.ts#L6233) `Store/foundSetPage` | `rowsById` (6233) | CORE |
| [packages/store/src/store.ts:6249](../../packages/store/src/store.ts#L6249) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6249); `Store.row` (6265) | GATED-STORE |
| [packages/store/src/store.ts:6288](../../packages/store/src/store.ts#L6288) `Store/portalCountsCurrent` | `Store.canView` (6288); `Store.row` (6315) | GATED-STORE |
| [packages/store/src/store.ts:6351](../../packages/store/src/store.ts#L6351) `Store/fieldIndexCurrent` | `SQLite.iterate` (6351); `SQLite.prepare` (6351, 6356); `Store.sql` (6351, 6356); `SQLite.all` (6356) | GATED-STORE |
| [packages/store/src/store.ts:6397](../../packages/store/src/store.ts#L6397) `Store/valueListItemsCurrent` | `Store.valueListItems` (6397); `Store.get` (6411); `relatedRows` (6412); `Store.row` (6412); `SQLite.iterate` (6414); `SQLite.prepare` (6414); `Store.sql` (6414); `Calculations.related` (6424); `Calculations.value` (6428, 6429) | GATED-STORE |
| [packages/store/src/store.ts:6526](../../packages/store/src/store.ts#L6526) `Store/portalRows` | `relatedRows` (6526); `relatedIdList` (6527); `Store.viewableIds` (6530); `rowsById` (6555, 6593); `Calculations.related` (6569) | CORE |
| [packages/store/src/store.ts:6537](../../packages/store/src/store.ts#L6537) `Store/portalRows/context` | `Calculations.context` (6537) | CORE |
| [packages/store/src/store.ts:6547](../../packages/store/src/store.ts#L6547) `Store/portalRows/valueOf` | `Calculations.value` (6547) | CORE |
| [packages/store/src/store.ts:6664](../../packages/store/src/store.ts#L6664) `Store/markRepeating` | `SQLite.prepare` (6664); `Store.sql` (6664) | CORE |
| [packages/store/src/store.ts:6691](../../packages/store/src/store.ts#L6691) `Store/externalContainerCheck` | `SQLite.all` (6691); `SQLite.prepare` (6691); `Store.sql` (6691) | CORE |
| [packages/store/src/store.ts:6698](../../packages/store/src/store.ts#L6698) `Store/externalContainerCount` | `SQLite.get` (6698); `SQLite.prepare` (6698); `Store.sql` (6698) | CORE |
| [packages/store/src/store.ts:6707](../../packages/store/src/store.ts#L6707) `Store/externalContainerReport` | `SQLite.all` (6707, 6720); `SQLite.prepare` (6707, 6720); `Store.sql` (6707, 6720) | CORE |
| [packages/store/src/store.ts:6762](../../packages/store/src/store.ts#L6762) `Store/orphanContainerReport` | `SQLite.all` (6762, 6780, 6782, 6788, 6801, 6814, 6833, 6851); `SQLite.prepare` (6762, 6780, 6782, 6788, 6801, 6814, 6831, 6833, 6851); `Store.sql` (6762, 6780, 6782, 6788, 6801, 6814, 6831, 6833, 6851); `SQLite.get` (6831); `Store.row` (6845) | CORE |
| [packages/store/src/store.ts:6862](../../packages/store/src/store.ts#L6862) `Store/purgeOrphanContainers` | `Store.sql` (6862, 6871, 6874, 6876, 6877, 6882, 6884); `Store.orphanContainerReport` (6863); `SQLite.get` (6871); `SQLite.prepare` (6871, 6876, 6877) | CORE |
| [packages/store/src/store.ts:6897](../../packages/store/src/store.ts#L6897) `Store/containerIntact` | `SQLite.get` (6897); `SQLite.prepare` (6897); `Store.sql` (6897) | CORE |
| [packages/store/src/store.ts:6907](../../packages/store/src/store.ts#L6907) `Store/externalOf` | `SQLite.get` (6907); `SQLite.prepare` (6907); `Store.sql` (6907) | CORE |
| [packages/store/src/store.ts:6911](../../packages/store/src/store.ts#L6911) `Store/containerMeta` | `SQLite.get` (6911); `SQLite.prepare` (6911); `Store.sql` (6911) | CORE |
| [packages/store/src/store.ts:6916](../../packages/store/src/store.ts#L6916) `Store/container` | `SQLite.get` (6916); `SQLite.prepare` (6916, 6925); `Store.sql` (6916, 6925); `SQLite.all` (6925) | CORE |
| [packages/store/src/store.ts:6933](../../packages/store/src/store.ts#L6933) `Store/containerInfo` | `SQLite.get` (6933); `SQLite.prepare` (6933); `Store.sql` (6933) | CORE |
| [packages/store/src/store.ts:6967](../../packages/store/src/store.ts#L6967) `Store/containerRange` | `SQLite.all` (6967); `SQLite.prepare` (6967, 6974); `Store.sql` (6967, 6974); `SQLite.get` (6974) | CORE |
| [packages/store/src/store.ts:6987](../../packages/store/src/store.ts#L6987) `Store/addContainer` | `SQLite.prepare` (6987, 6991, 6992); `Store.sql` (6987, 6989, 6991, 6992, 6994, 6997) | CORE |
| [packages/store/src/store.ts:7013](../../packages/store/src/store.ts#L7013) `Store/addExternalContainer` | `SQLite.prepare` (7013); `Store.sql` (7013) | CORE |
| [packages/store/src/store.ts:7031](../../packages/store/src/store.ts#L7031) `Store/writeExternalFile` | `Store.evaluateEach` (7031); `SQLite.prepare` (7054); `Store.sql` (7054) | CORE |
| [packages/store/src/store.ts:7055](../../packages/store/src/store.ts#L7055) `Store/writeExternalFile/taken` | `SQLite.get` (7055) | CORE |
| [packages/store/src/store.ts:7072](../../packages/store/src/store.ts#L7072) `Store/embeddedContainers` | `SQLite.prepare` (7072, 7073); `Store.sql` (7072, 7073); `SQLite.all` (7073); `SQLite.get` (7077) | CORE |
| [packages/store/src/store.ts:7086](../../packages/store/src/store.ts#L7086) `Store/embeddedContainerCount` | `SQLite.prepare` (7086); `Store.sql` (7086); `SQLite.get` (7087) | CORE |
| [packages/store/src/store.ts:7095](../../packages/store/src/store.ts#L7095) `Store/recoverContainersOut` | `SQLite.prepare` (7095); `Store.sql` (7095); `SQLite.get` (7098) | CORE |
| [packages/store/src/store.ts:7120](../../packages/store/src/store.ts#L7120) `Store/moveContainersOut` | `Store.sql` (7120, 7128, 7130, 7132, 7134, 7135, 7154, 7159, 7161, 7163, 7164, 7168); `SQLite.get` (7128); `SQLite.prepare` (7128, 7134, 7135); `Store.container` (7137) | CORE |
| [packages/store/src/store.ts:7177](../../packages/store/src/store.ts#L7177) `Store/moveContainersIn` | `Store.sql` (7177, 7181, 7183, 7184, 7185, 7186, 7205, 7208, 7215, 7218, 7221, 7228); `SQLite.prepare` (7183, 7184, 7185, 7186, 7215, 7221); `SQLite.get` (7188, 7215, 7221) | CORE |
| [packages/store/src/store.ts:7240](../../packages/store/src/store.ts#L7240) `Store/compactFile` | `Store.sql` (7240, 7241, 7242) | CORE |
| [packages/store/src/store.ts:7248](../../packages/store/src/store.ts#L7248) `Store/containerId` | `Store.containerId` (7248); `Store.row` (7249) | CORE |
| [packages/store/src/store.ts:7271](../../packages/store/src/store.ts#L7271) `Store/checkContainerWrite` | `Store.row` (7271) | CORE |
| [packages/store/src/store.ts:7281](../../packages/store/src/store.ts#L7281) `Store/setContainer` | `Store.row` (7281); `SQLite.prepare` (7292); `Store.sql` (7292) | CORE |
| [packages/store/src/store.ts:7324](../../packages/store/src/store.ts#L7324) `Store/orderBy` | `Store.valueListItems` (7324) | CORE |
| [packages/store/src/store.ts:7347](../../packages/store/src/store.ts#L7347) `Store/userPrefs` | `SQLite.all` (7347); `SQLite.prepare` (7347); `Store.sql` (7347) | CORE |
| [packages/store/src/store.ts:7352](../../packages/store/src/store.ts#L7352) `Store/hasTable` | `SQLite.get` (7352); `SQLite.prepare` (7352); `Store.sql` (7352) | CORE |
| [packages/store/src/store.ts:7356](../../packages/store/src/store.ts#L7356) `Store/setUserPref` | `Store.sql` (7356, 7357, 7358); `SQLite.prepare` (7357, 7358) | CORE |
| [packages/store/src/store.ts:7364](../../packages/store/src/store.ts#L7364) `Store/indexedFields` | `SQLite.all` (7364, 7365); `SQLite.prepare` (7364, 7365); `Store.sql` (7364, 7365) | CORE |
| [packages/store/src/store.ts:7386](../../packages/store/src/store.ts#L7386) `Store/addFieldIndex` | `Store.sql` (7386) | CORE |
| [packages/store/src/store.ts:7398](../../packages/store/src/store.ts#L7398) `Store/dropFieldIndex` | `SQLite.get` (7398); `SQLite.prepare` (7398); `Store.sql` (7398, 7399) | CORE |
| [packages/store/src/store.ts:7409](../../packages/store/src/store.ts#L7409) `Store/timeFind` | `Store.query` (7409, 7413, 7414); `Store.recordCount` (7416) | CORE |
| [packages/store/src/store.ts:7433](../../packages/store/src/store.ts#L7433) `Store/find` | `Store.find` (7433) | GATED-STORE |
| [packages/store/src/store.ts:7444](../../packages/store/src/store.ts#L7444) `Store/findHere` | `Store.query` (7444, 7449, 7451, 7465, 7467, 7477); `Store.recordCount` (7462); `SQLite.get` (7463, 7467); `SQLite.prepare` (7463, 7467, 7472, 7479, 7488); `Store.sql` (7463, 7467, 7472, 7479, 7488); `SQLite.all` (7472, 7479, 7488) | GATED-STORE |
| [packages/store/src/store.ts:7483](../../packages/store/src/store.ts#L7483) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7483); `SQLite.prepare` (7483); `Store.sql` (7483) | GATED-STORE |
| [packages/store/src/store.ts:7516](../../packages/store/src/store.ts#L7516) `Store/sortedPage` | `SQLite.iterate` (7516); `SQLite.prepare` (7516, 7531); `Store.sql` (7516, 7531); `SQLite.all` (7531) | CORE |
| [packages/store/src/store.ts:7588](../../packages/store/src/store.ts#L7588) `Store/relatedCriteria/matched` | `relatedRows` (7588) | CORE |
| [packages/store/src/store.ts:7591](../../packages/store/src/store.ts#L7591) `Store/relatedCriteria` | `SQLite.iterate` (7591); `SQLite.prepare` (7591); `Store.sql` (7591) | CORE |
| [packages/store/src/store.ts:7617](../../packages/store/src/store.ts#L7617) `Store/computedRows` | `Store.sql` (7617, 7620, 7621, 7622, 7624, 7634, 7635, 7636, 7639); `SQLite.prepare` (7620, 7622, 7624, 7634); `SQLite.iterate` (7624); `Calculations.globalValue` (7627); `Calculations.unstoredValue` (7628); `Calculations.related` (7631); `SQLite.all` (7634) | CORE |
| [packages/store/src/store.ts:7664](../../packages/store/src/store.ts#L7664) `Store/summaries` | `Calculations.wholeTable` (7664); `Calculations.collect` (7684, 7689) | CORE |
| [packages/store/src/store.ts:7680](../../packages/store/src/store.ts#L7680) `Store/summaries/recs` | `SQLite.iterate` (7680); `SQLite.prepare` (7680); `Store.sql` (7680) | CORE |
| [packages/store/src/store.ts:7702](../../packages/store/src/store.ts#L7702) `Store/runningSummaryValues` | `Store.viewableIds` (7702); `rowsById` (7704); `Calculations.value` (7715, 7721); `Calculations.related` (7732) | GATED-STORE |
| [packages/store/src/store.ts:7745](../../packages/store/src/store.ts#L7745) `Store/findSource` | `Store.query` (7745); `Store.sql` (7752, 7753, 7757, 7759, 7770, 7772); `SQLite.prepare` (7753, 7759); `SQLite.iterate` (7759); `Calculations.globalValue` (7763); `Calculations.unstoredValue` (7764); `Calculations.related` (7768) | CORE |
| [packages/store/src/store.ts:7791](../../packages/store/src/store.ts#L7791) `Store/previewRow` | `Store.row` (7791) | CORE |
| [packages/store/src/store.ts:7809](../../packages/store/src/store.ts#L7809) `Store/row` | `SQLite.get` (7809) | CORE |
| [packages/store/src/store.ts:7828](../../packages/store/src/store.ts#L7828) `Store/getCurrent` | `Store.get` (7828); `Store.row` (7829, 7829, 7843); `SQLite.all` (7846); `SQLite.prepare` (7846); `Store.sql` (7846) | GATED-STORE |
| [packages/store/src/store.ts:7866](../../packages/store/src/store.ts#L7866) `Store/getManyCurrent` | `Store.getMany` (7866); `SQLite.get` (7884); `SQLite.prepare` (7884); `Store.sql` (7884) | GATED-STORE |
| [packages/store/src/store.ts:7877](../../packages/store/src/store.ts#L7877) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (7877) | GATED-STORE |
| [packages/store/src/store.ts:7900](../../packages/store/src/store.ts#L7900) `Store/canViewRecord` | `SQLite.get` (7900); `SQLite.prepare` (7900); `Store.sql` (7900) | GATED-STORE |
| [packages/store/src/store.ts:7908](../../packages/store/src/store.ts#L7908) `Store/canView` | `Store.canView` (7908); `Store.row` (7909) | GATED-STORE |
| [packages/store/src/store.ts:7933](../../packages/store/src/store.ts#L7933) `Store/create` | `SQLite.get` (7933, 7939); `SQLite.prepare` (7933, 7939, 7950); `Store.sql` (7933, 7939, 7950) | CORE |
| [packages/store/src/store.ts:7974](../../packages/store/src/store.ts#L7974) `Store/duplicate` | `Store.row` (7974); `SQLite.get` (7978); `SQLite.prepare` (7978, 7991); `Store.sql` (7978, 7991) | CORE |
| [packages/store/src/store.ts:8036](../../packages/store/src/store.ts#L8036) `Store/update` | `Store.row` (8036, 8043, 8054); `Store.sql` (8067, 8068, 8105, 8108) | CORE |
| [packages/store/src/store.ts:8070](../../packages/store/src/store.ts#L8070) `Store/update/undo` | `Store.sql` (8070) | CORE |
| [packages/store/src/store.ts:8212](../../packages/store/src/store.ts#L8212) `Store/setStoredCalcValues` | `SQLite.prepare` (8212, 8213); `Store.sql` (8212, 8213); `SQLite.get` (8217) | CORE |
| [packages/store/src/store.ts:8291](../../packages/store/src/store.ts#L8291) `Store/evaluateCurrent` | `Store.row` (8291, 8291); `Calculations.context` (8292); `Store.get` (8293, 8295) | GATED-STORE |
| [packages/store/src/store.ts:8327](../../packages/store/src/store.ts#L8327) `Store/evaluateEachCurrent` | `Store.row` (8327, 8327); `Calculations.context` (8332); `Store.get` (8334) | GATED-STORE |
| [packages/store/src/store.ts:8367](../../packages/store/src/store.ts#L8367) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8367); `Store.get` (8369) | GATED-STORE |
| [packages/store/src/store.ts:8388](../../packages/store/src/store.ts#L8388) `Store/evaluateRowsCurrent` | `Store.row` (8388, 8388) | GATED-STORE |
| [packages/store/src/store.ts:8402](../../packages/store/src/store.ts#L8402) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8402) | GATED-STORE |
| [packages/store/src/store.ts:8424](../../packages/store/src/store.ts#L8424) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8424) | GATED-STORE |
| [packages/store/src/store.ts:8462](../../packages/store/src/store.ts#L8462) `Store/updateRelated` | `relatedRows` (8462) | CORE |
| [packages/store/src/store.ts:8480](../../packages/store/src/store.ts#L8480) `Store/updatePortals` | `Store.row` (8480, 8515); `relatedRows` (8516) | CORE |
| [packages/store/src/store.ts:8489](../../packages/store/src/store.ts#L8489) `Store/updatePortals/portal/related` | `relatedIdList` (8489) | CORE |
| [packages/store/src/store.ts:8571](../../packages/store/src/store.ts#L8571) `Store/portalContainerTarget` | `Store.row` (8571); `relatedIdList` (8572) | CORE |
| [packages/store/src/store.ts:8585](../../packages/store/src/store.ts#L8585) `Store/checkEditable` | `Store.row` (8585) | CORE |
| [packages/store/src/store.ts:8608](../../packages/store/src/store.ts#L8608) `Store/delete` | `Store.row` (8608); `SQLite.get` (8613); `SQLite.prepare` (8613, 8615); `Store.sql` (8613, 8615) | CORE |
| [packages/store/src/store.ts:8636](../../packages/store/src/store.ts#L8636) `Store/vaultHeld` | `SQLite.get` (8636); `SQLite.prepare` (8636); `Store.sql` (8636) | CORE |
| [packages/store/src/store.ts:8643](../../packages/store/src/store.ts#L8643) `Store/forgetStandInValues` | `Store.sql` (8643, 8664); `SQLite.prepare` (8664) | CORE |
| [packages/store/src/store.ts:8678](../../packages/store/src/store.ts#L8678) `Store/restoreDeletedRow` | `SQLite.get` (8678); `SQLite.prepare` (8678, 8679, 8681); `Store.sql` (8678, 8679, 8681); `SQLite.all` (8679) | CORE |
| [packages/store/src/store.ts:8705](../../packages/store/src/store.ts#L8705) `Store/cascadeDelete` | `relatedRows` (8705) | CORE |
| [packages/store/src/store.ts:8795](../../packages/store/src/store.ts#L8795) `Store/selectIdsCurrent` | `Store.selectIds` (8795); `SQLite.all` (8801); `SQLite.prepare` (8801); `Store.sql` (8801) | GATED-STORE |
| [packages/store/src/store.ts:8809](../../packages/store/src/store.ts#L8809) `Store/countIds` | `Store.countIds` (8809); `SQLite.get` (8813); `SQLite.prepare` (8813); `Store.sql` (8813) | GATED-STORE |
| [packages/store/src/store.ts:8829](../../packages/store/src/store.ts#L8829) `Store/computeValuesCurrent` | `Store.computeValues` (8829); `Store.sql` (8835, 8839); `SQLite.all` (8839); `SQLite.prepare` (8839) | GATED-STORE |
| [packages/store/src/store.ts:8854](../../packages/store/src/store.ts#L8854) `Store/findIdsCurrent` | `Store.findIds` (8854) | GATED-STORE |
| [packages/store/src/store.ts:8860](../../packages/store/src/store.ts#L8860) `Store/findIdsHere` | `Store.query` (8860, 8865, 8867); `SQLite.iterate` (8878); `SQLite.prepare` (8878); `Store.sql` (8878) | GATED-STORE |
| [packages/store/src/store.ts:8895](../../packages/store/src/store.ts#L8895) `Store/groupSummariesCurrent` | `Store.groupSummaries` (8895); `Store.viewableIds` (8900); `Calculations.collect` (8916); `rowsById` (8916, 8966); `Calculations.collector` (8938) | GATED-STORE |
| [packages/store/src/store.ts:8928](../../packages/store/src/store.ts#L8928) `Store/groupSummariesCurrent/key` | `Calculations.value` (8928); `Calculations.related` (8930) | GATED-STORE |
| [packages/store/src/store.ts:8964](../../packages/store/src/store.ts#L8964) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (8964) | GATED-STORE |
| [packages/store/src/store.ts:8987](../../packages/store/src/store.ts#L8987) `Store/sortIdsCurrent` | `Store.sortIds` (8987); `SQLite.all` (8991); `SQLite.prepare` (8991); `Store.sql` (8991) | GATED-STORE |
| [packages/store/src/store.ts:9001](../../packages/store/src/store.ts#L9001) `Store/matchIds` | `Store.matchIds` (9001); `SQLite.all` (9007); `SQLite.prepare` (9007); `Store.sql` (9007) | CORE |
| [packages/store/src/store.ts:9025](../../packages/store/src/store.ts#L9025) `Store/truncate` | `Store.sql` (9025, 9027, 9034, 9035, 9037, 9038); `SQLite.prepare` (9027, 9034); `SQLite.all` (9029) | CORE |
| [packages/store/src/store.ts:9059](../../packages/store/src/store.ts#L9059) `Store/iterateCommitted` | `SQLite.iterate` (9059) | CORE |
| [packages/store/src/store.ts:9093](../../packages/store/src/store.ts#L9093) `Store/readOnlyChecked` | `SQLite.prepare` (9093, 9097, 9106, 9111); `SQLite.all` (9097, 9106, 9111) | CORE |
| [packages/store/src/store.ts:9133](../../packages/store/src/store.ts#L9133) `Store/refreshDecimalSqlViews` | `SQLite.get` (9133); `SQLite.prepare` (9133, 9138); `SQLite.all` (9138) | CORE |
| [packages/store/src/store.ts:9152](../../packages/store/src/store.ts#L9152) `Store/internalRoots` | `SQLite.get` (9152); `SQLite.prepare` (9152, 9154); `SQLite.all` (9154) | CORE |
| [packages/store/src/store.ts:9187](../../packages/store/src/store.ts#L9187) `Store/selectCurrent` | `SQLite.iterate` (9187) | CORE |
| [packages/store/src/store.ts:9208](../../packages/store/src/store.ts#L9208) `Store/query` | `SQLite.iterate` (9208) | CORE |
| [packages/store/src/store.ts:9242](../../packages/store/src/store.ts#L9242) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9242); `SQLite.all` (9249, 9252); `SQLite.prepare` (9249, 9252) | CORE |
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
| [packages/store/src/sync-apply.ts:320](../../packages/store/src/sync-apply.ts#L320) `applySyncRun` | `Store.container` (320, 321, 348); `Store.containerInfo` (334); `SQLite.prepare` (429, 661, 684); `Store.sql` (429, 661, 684); `SQLite.get` (661, 684) | OPERATOR |
| [packages/store/src/sync-apply.ts:450](../../packages/store/src/sync-apply.ts#L450) `applySyncRun/fail` | `SQLite.get` (450); `SQLite.prepare` (450); `Store.sql` (450) | OPERATOR |
| [packages/store/src/sync-apply.ts:578](../../packages/store/src/sync-apply.ts#L578) `applySyncRun/containerChanges` | `Store.container` (578) | OPERATOR |
| [packages/store/src/sync-apply.ts:724](../../packages/store/src/sync-apply.ts#L724) `applySyncRun/filesToSend` | `Store.containerInfo` (724); `Store.container` (728) | OPERATOR |
| [packages/store/src/sync.ts:45](../../packages/store/src/sync.ts#L45) `openForPlanning` | `SQLite.get` (45); `SQLite.prepare` (45) | OPERATOR |
| [packages/store/src/sync.ts:188](../../packages/store/src/sync.ts#L188) `tableExists` | `SQLite.get` (188); `SQLite.prepare` (188); `Store.sql` (188) | OPERATOR |
| [packages/store/src/sync.ts:198](../../packages/store/src/sync.ts#L198) `ensureSyncTables` | `Store.sql` (198, 212, 222) | OPERATOR |
| [packages/store/src/sync.ts:242](../../packages/store/src/sync.ts#L242) `readSyncMap` | `SQLite.all` (242); `SQLite.prepare` (242); `Store.sql` (242) | OPERATOR |
| [packages/store/src/sync.ts:263](../../packages/store/src/sync.ts#L263) `lastPullTimestamp` | `SQLite.get` (263); `SQLite.prepare` (263); `Store.sql` (263) | OPERATOR |
| [packages/store/src/sync.ts:282](../../packages/store/src/sync.ts#L282) `readLocalRecords` | `SQLite.all` (282); `SQLite.prepare` (282); `Store.sql` (282) | OPERATOR |
| [packages/store/src/text-styles.ts:22](../../packages/store/src/text-styles.ts#L22) `ensureTextStyles` | `SQLite.all` (22, 26); `SQLite.prepare` (22, 26) | CORE |
| [packages/store/src/text-styles.ts:73](../../packages/store/src/text-styles.ts#L73) `TextStyles/st` | `SQLite.prepare` (73) | CORE |
| [packages/store/src/text-styles.ts:81](../../packages/store/src/text-styles.ts#L81) `TextStyles/has` | `SQLite.all` (81) | CORE |
| [packages/store/src/text-styles.ts:94](../../packages/store/src/text-styles.ts#L94) `TextStyles/rows` | `SQLite.all` (94) | CORE |
| [packages/store/src/trace.ts:137](../../packages/store/src/trace.ts#L137) `traceDatabase/get` | `SQLite.prepare` (137) | CORE |
| [packages/store/src/words.ts:78](../../packages/store/src/words.ts#L78) `WordIndexes/ensure` | `SQLite.prepare` (78, 82); `SQLite.get` (81); `SQLite.all` (82) | CORE |
| [packages/store/src/words.ts:85](../../packages/store/src/words.ts#L85) `WordIndexes/ensure/covers` | `SQLite.get` (85, 89); `SQLite.all` (86); `SQLite.prepare` (86, 89) | CORE |
| [packages/store/src/words.ts:155](../../packages/store/src/words.ts#L155) `WordIndexes/dropAll` | `SQLite.all` (155); `SQLite.prepare` (155) | CORE |
| [packages/server/src/oauth.ts:734](../../packages/server/src/oauth.ts#L734) `OAuthServer/endGrant` | `SQLite.prepare` (734, 735); `SQLite.all` (735) | AUTH |
<!-- end generated read-gate inventory -->
