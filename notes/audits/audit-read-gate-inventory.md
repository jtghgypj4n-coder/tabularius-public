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
| [packages/cli/src/main.ts:648](../../packages/cli/src/main.ts#L648) `accountsWithPasswordOff` | `SQLite.all` (648); `SQLite.prepare` (648) | OPERATOR |
| [packages/cli/src/main.ts:677](../../packages/cli/src/main.ts#L677) `hostedRead` | `SQLite.all` (677, 680); `SQLite.prepare` (677, 680); `Store.sql` (677, 680) | OPERATOR |
| [packages/cli/src/main.ts:2252](../../packages/cli/src/main.ts#L2252) `main` | `Store.orphanContainerReport` (2252); `Store.auditLog` (2715); `SQLite.get` (2931); `SQLite.prepare` (2931) | OPERATOR |
| [packages/scripts/src/data-api-step.ts:103](../../packages/scripts/src/data-api-step.ts#L103) `respond` | `Store.get` (103, 130, 139); `Store.find` (104, 116) | SCRIPT |
| [packages/scripts/src/engine.ts:1908](../../packages/scripts/src/engine.ts#L1908) `ScriptEngine/goToLayout` | `Store.findIds` (1908) | SCRIPT |
| [packages/scripts/src/engine.ts:2245](../../packages/scripts/src/engine.ts#L2245) `ScriptEngine/foundSet` | `Store.findIds` (2245) | SCRIPT |
| [packages/scripts/src/engine.ts:2310](../../packages/scripts/src/engine.ts#L2310) `ScriptEngine/semanticFind` | `Store.findIds` (2310, 2331) | SCRIPT |
| [packages/scripts/src/engine.ts:3184](../../packages/scripts/src/engine.ts#L3184) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3184); `Calculations.executeSQL` (3191) | SCRIPT |
| [packages/scripts/src/engine.ts:3223](../../packages/scripts/src/engine.ts#L3223) `ScriptEngine/sortIds` | `Store.sortIds` (3223); `Store.valueListItems` (3229) | SCRIPT |
| [packages/scripts/src/engine.ts:3320](../../packages/scripts/src/engine.ts#L3320) `ScriptEngine/revertTransaction` | `Store.findIds` (3320) | SCRIPT |
| [packages/scripts/src/engine.ts:3868](../../packages/scripts/src/engine.ts#L3868) `ScriptEngine/step` | `Store.fieldIndex` (3868); `Store.findIds` (4002, 4097) | SCRIPT |
| [packages/scripts/src/engine.ts:5118](../../packages/scripts/src/engine.ts#L5118) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5118) | SCRIPT |
| [packages/scripts/src/engine.ts:5126](../../packages/scripts/src/engine.ts#L5126) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5126) | SCRIPT |
| [packages/scripts/src/engine.ts:5127](../../packages/scripts/src/engine.ts#L5127) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5127) | SCRIPT |
| [packages/scripts/src/engine.ts:5273](../../packages/scripts/src/engine.ts#L5273) `ScriptEngine/get` | `Store.findIds` (5273); `Store.canViewRecord` (5364); `Store.get` (5400) | SCRIPT |
| [packages/scripts/src/engine.ts:5431](../../packages/scripts/src/engine.ts#L5431) `ScriptEngine/design` | `Store.valueListItems` (5431) | SCRIPT |
| [packages/scripts/src/engine.ts:5485](../../packages/scripts/src/engine.ts#L5485) `ScriptEngine/record` | `Store.get` (5485) | SCRIPT |
| [packages/scripts/src/engine.ts:5517](../../packages/scripts/src/engine.ts#L5517) `ScriptEngine/valueOf` | `Store.findIds` (5517); `Store.containerId` (5525) | SCRIPT |
| [packages/scripts/src/engine.ts:5542](../../packages/scripts/src/engine.ts#L5542) `ScriptEngine/lookupNext` | `Store.get` (5542); `Store.row` (5543); `Calculations.context` (5545) | SCRIPT |
| [packages/scripts/src/engine.ts:5645](../../packages/scripts/src/engine.ts#L5645) `ScriptEngine/relatedIds` | `Store.findIds` (5645); `rowsById` (5653); `Store.select` (5657); `Store.matchIds` (5671); `Store.viewableIds` (5694) | SCRIPT |
| [packages/scripts/src/engine.ts:5679](../../packages/scripts/src/engine.ts#L5679) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5679) | SCRIPT |
| [packages/scripts/src/engine.ts:6168](../../packages/scripts/src/engine.ts#L6168) `ScriptEngine/exportField` | `Store.get` (6168); `Store.containerId` (6169); `Store.container` (6171) | SCRIPT |
| [packages/scripts/src/engine.ts:6317](../../packages/scripts/src/engine.ts#L6317) `ScriptEngine/relookup` | `Store.get` (6317) | SCRIPT |
| [packages/scripts/src/engine.ts:6735](../../packages/scripts/src/engine.ts#L6735) `ScriptEngine/goToList` | `Store.findIds` (6735) | SCRIPT |
| [packages/scripts/src/engine.ts:7051](../../packages/scripts/src/engine.ts#L7051) `ScriptEngine/sourceValue` | `Store.get` (7051); `Store.containerId` (7052); `Store.container` (7053) | SCRIPT |
| [packages/scripts/src/engine.ts:7759](../../packages/scripts/src/engine.ts#L7759) `ScriptEngine/containerFile` | `Store.get` (7759); `Store.containerId` (7760); `Store.container` (7761) | SCRIPT |
| [packages/scripts/src/engine.ts:7920](../../packages/scripts/src/engine.ts#L7920) `ScriptEngine/importRecords` | `Store.findIds` (7920); `Store.get` (7940) | SCRIPT |
| [packages/scripts/src/engine.ts:8138](../../packages/scripts/src/engine.ts#L8138) `ScriptEngine/fileMakerRows` | `Store.findIds` (8138); `Store.get` (8143) | SCRIPT |
| [packages/scripts/src/engine.ts:8178](../../packages/scripts/src/engine.ts#L8178) `ScriptEngine/newRecord` | `Store.findIds` (8178) | SCRIPT |
| [packages/scripts/src/engine.ts:8475](../../packages/scripts/src/engine.ts#L8475) `ScriptEngine/performFind` | `Store.findIds` (8475) | SCRIPT |
| [packages/scripts/src/engine.ts:8500](../../packages/scripts/src/engine.ts#L8500) `ScriptEngine/findRelated` | `Store.findIds` (8500, 8510, 8513) | SCRIPT |
| [packages/scripts/src/engine.ts:8532](../../packages/scripts/src/engine.ts#L8532) `ScriptEngine/quickFind` | `Store.findIds` (8532, 8533, 8536) | SCRIPT |
| [packages/scripts/src/engine.ts:8901](../../packages/scripts/src/engine.ts#L8901) `clearRecords` | `SQLite.all` (8901); `SQLite.prepare` (8901) | SCRIPT |
| [packages/scripts/src/recorder.ts:72](../../packages/scripts/src/recorder.ts#L72) `lastSeq` | `Store.auditLog` (72) | DESIGN |
| [packages/scripts/src/recorder.ts:104](../../packages/scripts/src/recorder.ts#L104) `recordRun` | `Store.auditLog` (104) | DESIGN |
| [packages/scripts/src/script-tests.ts:211](../../packages/scripts/src/script-tests.ts#L211) `runCase` | `Store.findIds` (211); `Store.auditLog` (218, 219, 261); `Store.evaluateEach` (245) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/server/src/admin.ts:964](../../packages/server/src/admin.ts#L964) `Admin/handle` | `Store.externalContainerReport` (964); `Store.orphanContainerReport` (969, 973) | ADMIN |
| [packages/server/src/admin.ts:2085](../../packages/server/src/admin.ts#L2085) `Admin/audit` | `Store.auditLog` (2085) | ADMIN |
| [packages/server/src/admin.ts:2168](../../packages/server/src/admin.ts#L2168) `Admin/viewAs` | `Store.find` (2168) | ADMIN |
| [packages/server/src/admin.ts:2516](../../packages/server/src/admin.ts#L2516) `Admin/status` | `Store.externalContainerCount` (2516) | ADMIN |
| [packages/server/src/agent.ts:154](../../packages/server/src/agent.ts#L154) `runStep/visible` | `Store.findIds` (154) | DESIGN |
| [packages/server/src/agent.ts:162](../../packages/server/src/agent.ts#L162) `runStep` | `Store.findIds` (162); `Store.auditLog` (221) | DESIGN |
| [packages/server/src/agent.ts:303](../../packages/server/src/agent.ts#L303) `dryRunPlan` | `Store.findIds` (303) | DESIGN |
| [packages/server/src/agent.ts:326](../../packages/server/src/agent.ts#L326) `runApprovedStep` | `Store.findIds` (326) | DESIGN |
| [packages/server/src/ai-output.ts:142](../../packages/server/src/ai-output.ts#L142) `storedSecretValues` | `Calculations.globalValue` (142); `Store.select` (147) | REDACTION |
| [packages/server/src/ai-policy-sql.ts:32](../../packages/server/src/ai-policy-sql.ts#L32) `sqlFieldRefs` | `SQLite.all` (32, 34); `SQLite.prepare` (32, 34) | POLICY |
| [packages/server/src/ai-policy.ts:332](../../packages/server/src/ai-policy.ts#L332) `sql` | `Store.inspectQuery` (332) | POLICY |
| [packages/server/src/ai-usage.ts:141](../../packages/server/src/ai-usage.ts#L141) `AiUsage/today` | `SQLite.get` (141); `SQLite.prepare` (141) | AUTH |
| [packages/server/src/ai-usage.ts:148](../../packages/server/src/ai-usage.ts#L148) `AiUsage/month` | `SQLite.get` (148); `SQLite.prepare` (148) | AUTH |
| [packages/server/src/ai-usage.ts:155](../../packages/server/src/ai-usage.ts#L155) `AiUsage/recent` | `SQLite.all` (155); `SQLite.prepare` (155) | AUTH |
| [packages/server/src/ai-usage.ts:163](../../packages/server/src/ai-usage.ts#L163) `AiUsage/add` | `SQLite.prepare` (163, 166) | AUTH |
| [packages/server/src/ai-usage.ts:174](../../packages/server/src/ai-usage.ts#L174) `AiUsage/question` | `SQLite.prepare` (174, 176, 177, 179) | AUTH |
| [packages/server/src/ai-usage.ts:203](../../packages/server/src/ai-usage.ts#L203) `AiUsage/importOld` | `SQLite.prepare` (203, 213, 221, 225) | AUTH |
| [packages/server/src/assistant.ts:2049](../../packages/server/src/assistant.ts#L2049) `Assistant/answer` | `Store.find` (2049) | ACCOUNT |
| [packages/server/src/automations.ts:165](../../packages/server/src/automations.ts#L165) `Saved/table` | `Store.sql` (165, 166) | AUTOMATION |
| [packages/server/src/automations.ts:176](../../packages/server/src/automations.ts#L176) `Saved/list` | `SQLite.all` (176); `SQLite.prepare` (176); `Store.sql` (176) | AUTOMATION |
| [packages/server/src/automations.ts:186](../../packages/server/src/automations.ts#L186) `Saved/save` | `SQLite.prepare` (186); `Store.sql` (186) | AUTOMATION |
| [packages/server/src/automations.ts:192](../../packages/server/src/automations.ts#L192) `Saved/delete` | `SQLite.prepare` (192, 194); `Store.sql` (192, 194) | AUTOMATION |
| [packages/server/src/automations.ts:199](../../packages/server/src/automations.ts#L199) `Saved/logRun` | `SQLite.prepare` (199, 201); `Store.sql` (199, 201) | AUTOMATION |
| [packages/server/src/automations.ts:206](../../packages/server/src/automations.ts#L206) `Saved/runs` | `SQLite.all` (206); `SQLite.prepare` (206); `Store.sql` (206) | AUTOMATION |
| [packages/server/src/automations.ts:294](../../packages/server/src/automations.ts#L294) `dryRunAutomation/truth` | `Store.evaluateEach` (294) | AUTOMATION |
| [packages/server/src/automations.ts:295](../../packages/server/src/automations.ts#L295) `dryRunAutomation` | `Store.canViewRecord` (295); `Store.findIds` (295); `Store.auditLog` (311, 339, 347); `Store.select` (324); `Store.evaluate` (340) | AUTOMATION |
| [packages/server/src/automations.ts:422](../../packages/server/src/automations.ts#L422) `AutomationRunner/changed` | `Store.auditLog` (422) | AUTOMATION |
| [packages/server/src/automations.ts:446](../../packages/server/src/automations.ts#L446) `AutomationRunner/run` | `Store.select` (446); `Store.canViewRecord` (456); `Store.evaluateEach` (459); `Store.evaluate` (465) | AUTOMATION |
| [packages/server/src/automations.ts:489](../../packages/server/src/automations.ts#L489) `AutomationRunner/runDeleted` | `Store.auditLog` (489) | AUTOMATION |
| [packages/server/src/backup-verify.ts:147](../../packages/server/src/backup-verify.ts#L147) `testRestore` | `Store.recordCount` (147) | OPERATOR |
| [packages/server/src/backup-verify.ts:187](../../packages/server/src/backup-verify.ts#L187) `integrity` | `SQLite.all` (187); `SQLite.prepare` (187, 191); `SQLite.get` (191) | OPERATOR |
| [packages/server/src/backup-verify.ts:217](../../packages/server/src/backup-verify.ts#L217) `pageCheck` | `SQLite.all` (217); `SQLite.prepare` (217, 220); `SQLite.get` (220) | OPERATOR |
| [packages/server/src/backup.ts:242](../../packages/server/src/backup.ts#L242) `backupOnce` | `SQLite.get` (242); `SQLite.prepare` (242) | OPERATOR |
| [packages/server/src/backup.ts:953](../../packages/server/src/backup.ts#L953) `accountDifferences/read` | `SQLite.all` (953, 955); `SQLite.prepare` (953, 955) | OPERATOR |
| [packages/server/src/backup.ts:980](../../packages/server/src/backup.ts#L980) `readNames` | `SQLite.all` (980); `SQLite.prepare` (980) | OPERATOR |
| [packages/server/src/backup.ts:1010](../../packages/server/src/backup.ts#L1010) `credentialsReadable` | `SQLite.all` (1010); `SQLite.prepare` (1010) | OPERATOR |
| [packages/server/src/backup.ts:1026](../../packages/server/src/backup.ts#L1026) `columnInfo` | `SQLite.all` (1026); `SQLite.prepare` (1026) | OPERATOR |
| [packages/server/src/backup.ts:1061](../../packages/server/src/backup.ts#L1061) `reconcileCredentials` | `SQLite.all` (1061, 1083, 1098, 1108, 1114); `SQLite.prepare` (1061, 1069, 1083, 1085, 1098, 1099, 1106, 1108, 1109, 1114, 1115, 1119, 1120, 1121); `SQLite.get` (1069, 1119) | OPERATOR |
| [packages/server/src/backup.ts:1064](../../packages/server/src/backup.ts#L1064) `reconcileCredentials/has` | `SQLite.all` (1064); `SQLite.prepare` (1064) | OPERATOR |
| [packages/server/src/backup.ts:1088](../../packages/server/src/backup.ts#L1088) `reconcileCredentials/accountColumns` | `SQLite.all` (1088); `SQLite.prepare` (1088) | OPERATOR |
| [packages/server/src/backup.ts:1233](../../packages/server/src/backup.ts#L1233) `stageRestorePoint` | `SQLite.get` (1233, 1235, 1236); `SQLite.prepare` (1233, 1235, 1236) | OPERATOR |
| [packages/server/src/calendar.ts:389](../../packages/server/src/calendar.ts#L389) `CalendarFeeds/feed` | `Store.find` (389) | CALENDAR |
| [packages/server/src/changes.ts:184](../../packages/server/src/changes.ts#L184) `ChangeFeed/visible` | `Store.canViewRecord` (184) | CHANGE |
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
| [packages/server/src/conversion-guide.ts:323](../../packages/server/src/conversion-guide.ts#L323) `ConversionGuides/table` | `Store.sql` (323) | DESIGN |
| [packages/server/src/conversion-guide.ts:333](../../packages/server/src/conversion-guide.ts#L333) `ConversionGuides/saved` | `SQLite.get` (333); `SQLite.prepare` (333); `Store.sql` (333) | DESIGN |
| [packages/server/src/conversion-guide.ts:339](../../packages/server/src/conversion-guide.ts#L339) `ConversionGuides/save` | `SQLite.prepare` (339); `Store.sql` (339) | DESIGN |
| [packages/server/src/conversion.ts:287](../../packages/server/src/conversion.ts#L287) `conversionReport` | `Store.externalContainerCheck` (287) | DESIGN |
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
| [packages/server/src/mcp.ts:2281](../../packages/server/src/mcp.ts#L2281) `registerResources/audit` | `Store.auditLog` (2281) | MCP |
| [packages/server/src/oauth.ts:59](../../packages/server/src/oauth.ts#L59) `storedName` | `SQLite.get` (59); `SQLite.prepare` (59); `Store.sql` (59) | AUTH |
| [packages/server/src/oauth.ts:70](../../packages/server/src/oauth.ts#L70) `legacyPasswordMark` | `SQLite.get` (70); `SQLite.prepare` (70); `Store.sql` (70) | AUTH |
| [packages/server/src/oauth.ts:164](../../packages/server/src/oauth.ts#L164) `OAuthServer/constructor/cols` | `SQLite.all` (164); `SQLite.prepare` (164) | AUTH |
| [packages/server/src/oauth.ts:170](../../packages/server/src/oauth.ts#L170) `OAuthServer/constructor` | `SQLite.all` (170); `SQLite.prepare` (170, 182, 184, 187, 188, 191); `SQLite.iterate` (182); `SQLite.get` (184); `Store.sql` (184, 187) | AUTH |
| [packages/server/src/oauth.ts:303](../../packages/server/src/oauth.ts#L303) `OAuthServer/register` | `SQLite.prepare` (303, 304, 305, 306, 309); `SQLite.get` (304, 306) | AUTH |
| [packages/server/src/oauth.ts:320](../../packages/server/src/oauth.ts#L320) `OAuthServer/client` | `SQLite.get` (320); `SQLite.prepare` (320) | AUTH |
| [packages/server/src/oauth.ts:410](../../packages/server/src/oauth.ts#L410) `OAuthServer/authorize/done` | `SQLite.prepare` (410, 411) | AUTH |
| [packages/server/src/oauth.ts:428](../../packages/server/src/oauth.ts#L428) `OAuthServer/authorize` | `SQLite.get` (428); `SQLite.prepare` (428, 432, 434, 441, 464, 465) | AUTH |
| [packages/server/src/oauth.ts:609](../../packages/server/src/oauth.ts#L609) `OAuthServer/token` | `SQLite.get` (609, 630); `SQLite.prepare` (609, 630) | AUTH |
| [packages/server/src/oauth.ts:660](../../packages/server/src/oauth.ts#L660) `OAuthServer/issue` | `SQLite.prepare` (660, 661) | AUTH |
| [packages/server/src/oauth.ts:667](../../packages/server/src/oauth.ts#L667) `OAuthServer/sweep` | `SQLite.all` (667); `SQLite.prepare` (667, 669) | AUTH |
| [packages/server/src/oauth.ts:676](../../packages/server/src/oauth.ts#L676) `OAuthServer/revoke` | `SQLite.get` (676, 683); `SQLite.prepare` (676, 683, 686) | AUTH |
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
| [packages/server/src/pii.ts:140](../../packages/server/src/pii.ts#L140) `classifyField` | `Store.query` (140) | REDACTION |
| [packages/server/src/pii.ts:289](../../packages/server/src/pii.ts#L289) `vaultTable` | `Store.sql` (289, 292) | REDACTION |
| [packages/server/src/pii.ts:298](../../packages/server/src/pii.ts#L298) `forgetVault` | `Store.sql` (298) | REDACTION |
| [packages/server/src/pii.ts:337](../../packages/server/src/pii.ts#L337) `PiiMasker/constructor` | `SQLite.get` (337); `SQLite.prepare` (337); `Store.sql` (337) | REDACTION |
| [packages/server/src/pii.ts:347](../../packages/server/src/pii.ts#L347) `PiiMasker/refresh` | `SQLite.all` (347); `SQLite.prepare` (347); `Store.sql` (347) | REDACTION |
| [packages/server/src/pii.ts:378](../../packages/server/src/pii.ts#L378) `PiiMasker/token` | `SQLite.prepare` (378, 379); `Store.sql` (378, 379); `SQLite.get` (379) | REDACTION |
| [packages/server/src/pii.ts:619](../../packages/server/src/pii.ts#L619) `piiPreview` | `Store.find` (619); `SQLite.prepare` (626); `Store.sql` (626) | REDACTION |
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
| [packages/server/src/script-failure.ts:208](../../packages/server/src/script-failure.ts#L208) `explainScriptFailure` | `Store.row` (208) | RECORD |
| [packages/server/src/security.ts:80](../../packages/server/src/security.ts#L80) `importApproximations` | `SQLite.all` (80); `SQLite.prepare` (80); `Store.sql` (80) | DESIGN |
| [packages/server/src/security.ts:116](../../packages/server/src/security.ts#L116) `securityOf` | `Store.pendingChanges` (116) | DESIGN |
| [packages/server/src/security.ts:212](../../packages/server/src/security.ts#L212) `SecurityApi/handle` | `Store.previewRecordRule` (212) | DESIGN |
| [packages/server/src/semantic-find.ts:52](../../packages/server/src/semantic-find.ts#L52) `semanticFind` | `Store.findIds` (52) | SEARCH |
| [packages/server/src/semantic-find.ts:108](../../packages/server/src/semantic-find.ts#L108) `vectorOf` | `Store.containerId` (108); `Store.containerInfo` (110); `Store.container` (112); `Store.get` (117) | SEARCH |
| [packages/server/src/sql.ts:101](../../packages/server/src/sql.ts#L101) `SqlEndpoint/handle` | `Calculations.translateSQL` (101); `Store.select` (106) | SQL |
| [packages/server/src/sql.ts:159](../../packages/server/src/sql.ts#L159) `SqlEndpoint/tables` | `SQLite.all` (159); `SQLite.prepare` (159); `Store.sql` (159) | SQL |
| [packages/server/src/standby.ts:257](../../packages/server/src/standby.ts#L257) `Standby/copy` | `SQLite.get` (257); `SQLite.prepare` (257) | OPERATOR |
| [packages/server/src/summarize.ts:67](../../packages/server/src/summarize.ts#L67) `summarizeRecords` | `Store.findIds` (67); `Store.select` (122, 129, 139) | SUMMARY |
| [packages/server/src/summarize.ts:180](../../packages/server/src/summarize.ts#L180) `summarizeByRecord` | `Store.evaluateEach` (180); `Store.row` (182) | SUMMARY |
| [packages/server/src/sync-console.ts:458](../../packages/server/src/sync-console.ts#L458) `SyncConsole/runCheck` | `Store.sql` (458) | DESIGN |
| [packages/server/src/sync-console.ts:463](../../packages/server/src/sync-console.ts#L463) `SyncConsole/runCheck/assertActive` | `Store.sql` (463) | DESIGN |
| [packages/server/src/warm-worker.ts:19](../../packages/server/src/warm-worker.ts#L19) `message/count` | `Store.recordCount` (19) | INTERNAL |
| [packages/server/src/warm-worker.ts:34](../../packages/server/src/warm-worker.ts#L34) `message` | `Store.find` (34) | INTERNAL |
| [packages/server/src/webclient.ts:442](../../packages/server/src/webclient.ts#L442) `WebClient/history` | `Store.get` (442) | WEB |
| [packages/server/src/webclient.ts:557](../../packages/server/src/webclient.ts#L557) `WebClient/explain` | `Store.get` (557); `Store.row` (590, 603) | WEB |
| [packages/server/src/webclient.ts:616](../../packages/server/src/webclient.ts#L616) `WebClient/index` | `Store.fieldIndex` (616) | WEB |
| [packages/server/src/webclient.ts:706](../../packages/server/src/webclient.ts#L706) `WebClient/menus` | `Store.evaluateEach` (706) | WEB |
| [packages/server/src/webclient.ts:919](../../packages/server/src/webclient.ts#L919) `WebClient/view` | `Store.evaluateEach` (919, 943, 962); `Store.canView` (937); `Store.previewRow` (941, 963); `Store.get` (954); `Store.row` (955, 955) | WEB |
| [packages/server/src/webclient.ts:940](../../packages/server/src/webclient.ts#L940) `WebClient/view/get` | `Store.get` (940) | WEB |
| [packages/server/src/webclient.ts:1005](../../packages/server/src/webclient.ts#L1005) `WebClient/refresh` | `Store.previewRow` (1005); `Store.getMany` (1010); `Store.foundSetRows` (1032) | WEB |
| [packages/server/src/webclient.ts:1044](../../packages/server/src/webclient.ts#L1044) `WebClient/foundIds` | `Store.findIds` (1044) | WEB |
| [packages/server/src/webclient.ts:1059](../../packages/server/src/webclient.ts#L1059) `WebClient/records` | `Store.getMany` (1059); `Store.find` (1062) | WEB |
| [packages/server/src/webclient.ts:1088](../../packages/server/src/webclient.ts#L1088) `WebClient/foundSetPortal` | `Store.foundSetRows` (1088, 1095) | WEB |
| [packages/server/src/webclient.ts:1128](../../packages/server/src/webclient.ts#L1128) `WebClient/charts/foundSet` | `Store.findIds` (1128) | WEB |
| [packages/server/src/webclient.ts:1137](../../packages/server/src/webclient.ts#L1137) `WebClient/charts` | `Calculations.context` (1137); `Store.canView` (1165); `Store.evaluateEach` (1174, 1178); `Store.evaluateRows` (1183, 1185) | WEB |
| [packages/server/src/webclient.ts:1168](../../packages/server/src/webclient.ts#L1168) `WebClient/charts/get` | `Store.get` (1168) | WEB |
| [packages/server/src/webclient.ts:1318](../../packages/server/src/webclient.ts#L1318) `WebClient/exportRecords` | `Store.getMany` (1318) | WEB |
| [packages/server/src/webclient.ts:1244](../../packages/server/src/webclient.ts#L1244) `WebClient/exportText/nextBatch` | `Store.selectIds` (1244); `Store.getMany` (1249) | WEB |
| [packages/server/src/webclient.ts:1492](../../packages/server/src/webclient.ts#L1492) `WebClient/aiReplace` | `Store.canView` (1492); `Store.getMany` (1508) | WEB |
| [packages/server/src/webclient.ts:1568](../../packages/server/src/webclient.ts#L1568) `WebClient/groups` | `Store.findIds` (1568); `Store.groupSummaries` (1574) | WEB |
| [packages/server/src/webclient.ts:1676](../../packages/server/src/webclient.ts#L1676) `WebClient/button` | `Store.findIds` (1676, 1726); `Store.evaluateEach` (1685, 1686) | WEB |
| [packages/server/src/webclient.ts:2333](../../packages/server/src/webclient.ts#L2333) `listItems` | `Store.valueListItems` (2333) | WEB |
| [packages/server/src/webclient.ts:2412](../../packages/server/src/webclient.ts#L2412) `foundIds` | `Store.findIds` (2412, 2414) | WEB |
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
| [packages/store/src/store.ts:862](../../packages/store/src/store.ts#L862) `Store/metadataVersions` | `SQLite.get` (862); `SQLite.prepare` (862); `Store.sql` (862) | CORE |
| [packages/store/src/store.ts:997](../../packages/store/src/store.ts#L997) `Store/constructor` | `Store.sql` (997, 999, 1001, 1002, 1006, 1010, 1011, 1022, 1027, 1032, 1033, 1037, 1038, 1039, 1046, 1050, 1054, 1055, 1056, 1060, 1064, 1067, 1068, 1070, 1071, 1074, 1075, 1079, 1080, 1084, 1085, 1088, 1090, 1093, 1094, 1098, 1099, 1103, 1104, 1107, 1108, 1109, 1112, 1113, 1116, 1117, 1119, 1119, 1120, 1120, 1121, 1124, 1128, 1130, 1133, 1134, 1135, 1138, 1139, 1141, 1143, 1144, 1149, 1150, 1151, 1151, 1155, 1156); `SQLite.get` (1001); `SQLite.prepare` (1001, 1067, 1068, 1071, 1074, 1079, 1084, 1093, 1098, 1103, 1112, 1116, 1119, 1120, 1138, 1143); `SQLite.all` (1067, 1074, 1079, 1084, 1093, 1098, 1103, 1112, 1116, 1119, 1120, 1138, 1143) | CORE |
| [packages/store/src/store.ts:1175](../../packages/store/src/store.ts#L1175) `Store/grantFullAccessClients` | `SQLite.prepare` (1175); `Store.sql` (1175) | CORE |
| [packages/store/src/store.ts:1192](../../packages/store/src/store.ts#L1192) `Store/meta` | `SQLite.get` (1192); `SQLite.prepare` (1192); `Store.sql` (1192) | CORE |
| [packages/store/src/store.ts:1200](../../packages/store/src/store.ts#L1200) `Store/persistentTable` | `Store.sql` (1200) | CORE |
| [packages/store/src/store.ts:1210](../../packages/store/src/store.ts#L1210) `Store/persistentData` | `SQLite.get` (1210) | CORE |
| [packages/store/src/store.ts:1219](../../packages/store/src/store.ts#L1219) `Store/persistentDataIds` | `SQLite.all` (1219) | CORE |
| [packages/store/src/store.ts:1225](../../packages/store/src/store.ts#L1225) `Store/setPersistentData` | `SQLite.prepare` (1225, 1229); `Store.sql` (1225, 1229) | CORE |
| [packages/store/src/store.ts:1242](../../packages/store/src/store.ts#L1242) `Store/checkpoint` | `SQLite.get` (1242); `SQLite.prepare` (1242); `Store.sql` (1242) | CORE |
| [packages/store/src/store.ts:1250](../../packages/store/src/store.ts#L1250) `Store/recordedFormat` | `Store.sql` (1250) | CORE |
| [packages/store/src/store.ts:1260](../../packages/store/src/store.ts#L1260) `Store/close` | `Store.sql` (1260) | CORE |
| [packages/store/src/store.ts:1276](../../packages/store/src/store.ts#L1276) `Store/shipWal` | `Store.sql` (1276) | CORE |
| [packages/store/src/store.ts:1287](../../packages/store/src/store.ts#L1287) `Store/trial` | `Store.sql` (1287) | CORE |
| [packages/store/src/store.ts:1292](../../packages/store/src/store.ts#L1292) `Store/trial/undo` | `Store.sql` (1292) | CORE |
| [packages/store/src/store.ts:1327](../../packages/store/src/store.ts#L1327) `Store/joinTransaction` | `Store.sql` (1327, 1328, 1330, 1332, 1338) | CORE |
| [packages/store/src/store.ts:1350](../../packages/store/src/store.ts#L1350) `Store/independentWindowWrite` | `SQLite.get` (1350); `SQLite.prepare` (1350, 1373); `Store.sql` (1350, 1353, 1368, 1373, 1376) | CORE |
| [packages/store/src/store.ts:1398](../../packages/store/src/store.ts#L1398) `Store/withWriteTransaction` | `Store.sql` (1398, 1401, 1405, 1407, 1407) | CORE |
| [packages/store/src/store.ts:1437](../../packages/store/src/store.ts#L1437) `Store/endTransaction` | `Store.sql` (1437, 1440, 1440) | CORE |
| [packages/store/src/store.ts:1459](../../packages/store/src/store.ts#L1459) `Store/backup` | `Store.sql` (1459) | CORE |
| [packages/store/src/store.ts:1474](../../packages/store/src/store.ts#L1474) `Store/dataVersion` | `SQLite.get` (1474); `SQLite.prepare` (1474); `Store.sql` (1474) | CORE |
| [packages/store/src/store.ts:1514](../../packages/store/src/store.ts#L1514) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1514) | CORE |
| [packages/store/src/store.ts:1535](../../packages/store/src/store.ts#L1535) `Store/shareResults` | `Store.sql` (1535) | CORE |
| [packages/store/src/store.ts:1545](../../packages/store/src/store.ts#L1545) `Store/versionTriggers` | `SQLite.get` (1545); `SQLite.prepare` (1545, 1550, 1551); `Store.sql` (1545, 1547, 1548, 1550, 1551, 1560, 1561); `SQLite.all` (1550, 1551) | CORE |
| [packages/store/src/store.ts:1577](../../packages/store/src/store.ts#L1577) `Store/versionNumber` | `SQLite.get` (1577); `SQLite.prepare` (1577); `Store.sql` (1577) | CORE |
| [packages/store/src/store.ts:1590](../../packages/store/src/store.ts#L1590) `Store/changeOne` | `Store.sql` (1590, 1592) | CORE |
| [packages/store/src/store.ts:1593](../../packages/store/src/store.ts#L1593) `Store/changeOne/read` | `SQLite.get` (1593); `SQLite.prepare` (1593); `Store.sql` (1593) | CORE |
| [packages/store/src/store.ts:1632](../../packages/store/src/store.ts#L1632) `Store/writeToken` | `SQLite.get` (1632); `SQLite.prepare` (1632); `Store.sql` (1632) | CORE |
| [packages/store/src/store.ts:1644](../../packages/store/src/store.ts#L1644) `Store/recordCount` | `SQLite.get` (1644); `SQLite.prepare` (1644); `Store.sql` (1644) | CORE |
| [packages/store/src/store.ts:1752](../../packages/store/src/store.ts#L1752) `Store/applyDesign` | `Store.sql` (1752, 1753, 1764, 1767, 1772, 1784, 1787, 1787); `SQLite.prepare` (1767, 1772) | CORE |
| [packages/store/src/store.ts:1845](../../packages/store/src/store.ts#L1845) `Store/auditLog` | `SQLite.all` (1845); `SQLite.prepare` (1845); `Store.sql` (1845) | CORE |
| [packages/store/src/store.ts:1885](../../packages/store/src/store.ts#L1885) `Store/securityEvents` | `Store.auditLog` (1885) | CORE |
| [packages/store/src/store.ts:1911](../../packages/store/src/store.ts#L1911) `Store/prepared` | `SQLite.prepare` (1911); `Store.sql` (1911) | CORE |
| [packages/store/src/store.ts:1926](../../packages/store/src/store.ts#L1926) `Store/recordAsOf` | `SQLite.get` (1926, 1928); `SQLite.prepare` (1926, 1928, 1930, 1931); `Store.sql` (1926, 1928, 1930, 1931); `SQLite.all` (1930, 1931) | CORE |
| [packages/store/src/store.ts:1956](../../packages/store/src/store.ts#L1956) `Store/restoreRecord` | `Store.recordAsOf` (1956); `SQLite.get` (1960); `SQLite.prepare` (1960, 1963, 1970, 1977); `Store.sql` (1960, 1963, 1970, 1977) | CORE |
| [packages/store/src/store.ts:1991](../../packages/store/src/store.ts#L1991) `Store/revertAuditEntry` | `Store.auditLog` (1991) | CORE |
| [packages/store/src/store.ts:2084](../../packages/store/src/store.ts#L2084) `Store/setAuditSettings` | `SQLite.prepare` (2084); `Store.sql` (2084) | CORE |
| [packages/store/src/store.ts:2106](../../packages/store/src/store.ts#L2106) `Store/pruneAudit` | `Store.sql` (2106, 2108, 2110); `SQLite.get` (2108); `SQLite.prepare` (2108) | CORE |
| [packages/store/src/store.ts:2188](../../packages/store/src/store.ts#L2188) `Store/audit` | `Store.sql` (2188) | CORE |
| [packages/store/src/store.ts:2277](../../packages/store/src/store.ts#L2277) `Store/securityChange` | `Store.sql` (2277, 2279); `SQLite.prepare` (2279) | CORE |
| [packages/store/src/store.ts:2326](../../packages/store/src/store.ts#L2326) `Store/logSecurity` | `Store.sql` (2326) | CORE |
| [packages/store/src/store.ts:2349](../../packages/store/src/store.ts#L2349) `Store/ensureDeleted` | `Store.sql` (2349) | CORE |
| [packages/store/src/store.ts:2354](../../packages/store/src/store.ts#L2354) `Store/deletedRows` | `SQLite.get` (2354); `SQLite.prepare` (2354, 2356, 2356); `Store.sql` (2354, 2356, 2356); `SQLite.all` (2356, 2356) | CORE |
| [packages/store/src/store.ts:2380](../../packages/store/src/store.ts#L2380) `Store/emptyDeleted` | `Store.sql` (2380, 2383, 2384, 2386, 2388); `SQLite.prepare` (2384) | CORE |
| [packages/store/src/store.ts:2395](../../packages/store/src/store.ts#L2395) `Store/designHistory` | `SQLite.all` (2395); `SQLite.prepare` (2395); `Store.sql` (2395) | CORE |
| [packages/store/src/store.ts:2402](../../packages/store/src/store.ts#L2402) `Store/scriptHistory` | `SQLite.all` (2402); `SQLite.prepare` (2402); `Store.sql` (2402) | CORE |
| [packages/store/src/store.ts:2412](../../packages/store/src/store.ts#L2412) `Store/layoutHistory` | `SQLite.all` (2412); `SQLite.prepare` (2412); `Store.sql` (2412) | CORE |
| [packages/store/src/store.ts:2437](../../packages/store/src/store.ts#L2437) `Store/designEffect/renameKey` | `SQLite.prepare` (2437); `Store.sql` (2437) | CORE |
| [packages/store/src/store.ts:2453](../../packages/store/src/store.ts#L2453) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2453); `Store.sql` (2453) | CORE |
| [packages/store/src/store.ts:2460](../../packages/store/src/store.ts#L2460) `Store/designEffect` | `Store.sql` (2460, 2464, 2469, 2474, 2477, 2483, 2491, 2492, 2494, 2506, 2507, 2510, 2512, 2518, 2519, 2520, 2525, 2527, 2531, 2534, 2535, 2537, 2540, 2545, 2547, 2554, 2555, 2557, 2558, 2559, 2560, 2567, 2568, 2570, 2570, 2572, 2573, 2574, 2578, 2582, 2584, 2622, 2624, 2626); `SQLite.get` (2491, 2506, 2518, 2519, 2531, 2535, 2570, 2578); `SQLite.prepare` (2491, 2492, 2506, 2507, 2518, 2519, 2525, 2527, 2531, 2535, 2545, 2547, 2560, 2567, 2568, 2570, 2572, 2574, 2578, 2582); `SQLite.all` (2567, 2568); `SQLite.iterate` (2572) | CORE |
| [packages/store/src/store.ts:2634](../../packages/store/src/store.ts#L2634) `Store/dropColumnIndexes` | `SQLite.all` (2634, 2636); `SQLite.prepare` (2634, 2636); `Store.sql` (2634, 2636, 2637) | CORE |
| [packages/store/src/store.ts:2646](../../packages/store/src/store.ts#L2646) `Store/recompute` | `SQLite.prepare` (2646, 2650); `Store.sql` (2646, 2650); `SQLite.iterate` (2650); `Calculations.computeStoredStyled` (2651); `Calculations.value` (2651) | CORE |
| [packages/store/src/store.ts:2666](../../packages/store/src/store.ts#L2666) `Store/linkPrincipal` | `SQLite.get` (2666); `SQLite.prepare` (2666); `Store.sql` (2666) | CORE |
| [packages/store/src/store.ts:2673](../../packages/store/src/store.ts#L2673) `Store/linkIdentity` | `SQLite.get` (2673); `SQLite.prepare` (2673); `Store.sql` (2673) | CORE |
| [packages/store/src/store.ts:2679](../../packages/store/src/store.ts#L2679) `Store/accountsSharingLockout` | `SQLite.all` (2679); `SQLite.prepare` (2679); `Store.sql` (2679) | CORE |
| [packages/store/src/store.ts:2683](../../packages/store/src/store.ts#L2683) `Store/accounts` | `SQLite.all` (2683); `SQLite.prepare` (2683); `Store.sql` (2683) | CORE |
| [packages/store/src/store.ts:2695](../../packages/store/src/store.ts#L2695) `Store/isAgent` | `SQLite.get` (2695); `SQLite.prepare` (2695); `Store.sql` (2695) | CORE |
| [packages/store/src/store.ts:2701](../../packages/store/src/store.ts#L2701) `Store/agentNeedsApproval` | `SQLite.get` (2701); `SQLite.prepare` (2701); `Store.sql` (2701) | CORE |
| [packages/store/src/store.ts:2707](../../packages/store/src/store.ts#L2707) `Store/blankPasswordAccounts` | `SQLite.all` (2707); `SQLite.prepare` (2707); `Store.sql` (2707) | CORE |
| [packages/store/src/store.ts:1183](../../packages/store/src/store.ts#L1183) `Store/hasOwnPassword` | `SQLite.get` (1183); `SQLite.prepare` (1183); `Store.sql` (1183) | CORE |
| [packages/store/src/store.ts:2718](../../packages/store/src/store.ts#L2718) `Store/unmigratedAccounts` | `SQLite.all` (2718); `SQLite.prepare` (2718); `Store.sql` (2718) | CORE |
| [packages/store/src/store.ts:2771](../../packages/store/src/store.ts#L2771) `Store/setExternalAccount` | `SQLite.get` (2771); `SQLite.prepare` (2771, 2776); `Store.sql` (2771, 2776) | CORE |
| [packages/store/src/store.ts:2789](../../packages/store/src/store.ts#L2789) `Store/refuseLookalikeAccount` | `SQLite.all` (2789); `SQLite.prepare` (2789); `Store.sql` (2789) | CORE |
| [packages/store/src/store.ts:2798](../../packages/store/src/store.ts#L2798) `Store/isExternal` | `SQLite.get` (2798); `SQLite.prepare` (2798); `Store.sql` (2798) | CORE |
| [packages/store/src/store.ts:2819](../../packages/store/src/store.ts#L2819) `Store/setAgentAccount` | `SQLite.get` (2819); `SQLite.prepare` (2819, 2825); `Store.sql` (2819, 2825) | CORE |
| [packages/store/src/store.ts:2859](../../packages/store/src/store.ts#L2859) `Store/gateAgentWrite` | `SQLite.prepare` (2859); `Store.sql` (2859) | CORE |
| [packages/store/src/store.ts:2881](../../packages/store/src/store.ts#L2881) `Store/pendingChanges` | `SQLite.all` (2881); `SQLite.prepare` (2881); `Store.sql` (2881) | CORE |
| [packages/store/src/store.ts:2895](../../packages/store/src/store.ts#L2895) `Store/approvePending` | `SQLite.get` (2895); `SQLite.prepare` (2895, 2906); `Store.sql` (2895, 2906) | CORE |
| [packages/store/src/store.ts:2916](../../packages/store/src/store.ts#L2916) `Store/rejectPending` | `SQLite.get` (2916); `SQLite.prepare` (2916, 2918); `Store.sql` (2916, 2918) | CORE |
| [packages/store/src/store.ts:2938](../../packages/store/src/store.ts#L2938) `Store/externalAccount` | `SQLite.all` (2938); `SQLite.prepare` (2938); `Store.sql` (2938) | CORE |
| [packages/store/src/store.ts:2969](../../packages/store/src/store.ts#L2969) `Store/setPassword` | `SQLite.get` (2969); `SQLite.prepare` (2969, 2971, 2980); `Store.sql` (2969, 2971, 2980) | AUTH |
| [packages/store/src/store.ts:2994](../../packages/store/src/store.ts#L2994) `Store/createAccount` | `SQLite.get` (2994); `SQLite.prepare` (2994, 2998, 3004, 3009, 3014); `Store.sql` (2994, 2998, 3004, 3009, 3014) | CORE |
| [packages/store/src/store.ts:3022](../../packages/store/src/store.ts#L3022) `Store/appendSecurityEvent` | `Store.sql` (3022) | CORE |
| [packages/store/src/store.ts:3064](../../packages/store/src/store.ts#L3064) `Store/setPasswordPolicy` | `SQLite.prepare` (3064); `Store.sql` (3064) | CORE |
| [packages/store/src/store.ts:3100](../../packages/store/src/store.ts#L3100) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3100); `Store.sql` (3100) | CORE |
| [packages/store/src/store.ts:3123](../../packages/store/src/store.ts#L3123) `Store/saveScriptTest` | `SQLite.prepare` (3123); `Store.sql` (3123) | CORE |
| [packages/store/src/store.ts:3132](../../packages/store/src/store.ts#L3132) `Store/deleteScriptTest` | `SQLite.prepare` (3132); `Store.sql` (3132) | CORE |
| [packages/store/src/store.ts:3167](../../packages/store/src/store.ts#L3167) `Store/setAiAllowed` | `SQLite.prepare` (3167); `Store.sql` (3167) | CORE |
| [packages/store/src/store.ts:3178](../../packages/store/src/store.ts#L3178) `Store/setAiPolicy` | `SQLite.prepare` (3178); `Store.sql` (3178) | CORE |
| [packages/store/src/store.ts:3198](../../packages/store/src/store.ts#L3198) `Store/setPiiIsolation` | `SQLite.prepare` (3198); `Store.sql` (3198) | CORE |
| [packages/store/src/store.ts:3220](../../packages/store/src/store.ts#L3220) `Store/markPiiField` | `SQLite.prepare` (3220); `Store.sql` (3220) | CORE |
| [packages/store/src/store.ts:3334](../../packages/store/src/store.ts#L3334) `Store/lastSignIns` | `Store.auditLog` (3334) | CORE |
| [packages/store/src/store.ts:3537](../../packages/store/src/store.ts#L3537) `Store/unusualAccess` | `Store.auditLog` (3537, 3603) | CORE |
| [packages/store/src/store.ts:3634](../../packages/store/src/store.ts#L3634) `Store/leastPrivilege` | `SQLite.all` (3634); `SQLite.prepare` (3634); `Store.sql` (3634) | CORE |
| [packages/store/src/store.ts:3707](../../packages/store/src/store.ts#L3707) `Store/unusedAccess` | `SQLite.get` (3707); `SQLite.prepare` (3707, 3716); `Store.sql` (3707, 3716); `SQLite.all` (3716) | CORE |
| [packages/store/src/store.ts:3755](../../packages/store/src/store.ts#L3755) `Store/unusedObjects` | `SQLite.get` (3755); `SQLite.prepare` (3755, 3758); `Store.sql` (3755, 3758); `SQLite.all` (3758) | CORE |
| [packages/store/src/store.ts:3793](../../packages/store/src/store.ts#L3793) `Store/usageCounting` | `SQLite.get` (3793); `SQLite.prepare` (3793); `Store.sql` (3793) | CORE |
| [packages/store/src/store.ts:3801](../../packages/store/src/store.ts#L3801) `Store/setMustChangePassword` | `SQLite.prepare` (3801); `Store.sql` (3801) | CORE |
| [packages/store/src/store.ts:3815](../../packages/store/src/store.ts#L3815) `Store/mustChangePassword` | `SQLite.get` (3815); `SQLite.prepare` (3815); `Store.sql` (3815) | CORE |
| [packages/store/src/store.ts:3854](../../packages/store/src/store.ts#L3854) `Store/passwordDaysRemaining` | `SQLite.get` (3854); `SQLite.prepare` (3854); `Store.sql` (3854) | CORE |
| [packages/store/src/store.ts:3861](../../packages/store/src/store.ts#L3861) `Store/importAccounts` | `SQLite.all` (3861); `SQLite.prepare` (3861); `Store.sql` (3861) | CORE |
| [packages/store/src/store.ts:3884](../../packages/store/src/store.ts#L3884) `Store/canonicalAccount` | `SQLite.all` (3884); `SQLite.prepare` (3884); `Store.sql` (3884) | CORE |
| [packages/store/src/store.ts:3896](../../packages/store/src/store.ts#L3896) `Store/createLocalAccount` | `SQLite.prepare` (3896); `Store.sql` (3896) | CORE |
| [packages/store/src/store.ts:3926](../../packages/store/src/store.ts#L3926) `Store/previewAccountImport` | `Store.sql` (3926, 3927, 3936) | CORE |
| [packages/store/src/store.ts:3944](../../packages/store/src/store.ts#L3944) `Store/limitAccountImport` | `SQLite.prepare` (3944, 3945, 3948); `Store.sql` (3944, 3945, 3948); `SQLite.get` (3945) | CORE |
| [packages/store/src/store.ts:3955](../../packages/store/src/store.ts#L3955) `Store/applyAccountImport` | `Store.sql` (3955, 3963, 3992); `SQLite.get` (3963); `SQLite.prepare` (3963, 3992) | CORE |
| [packages/store/src/store.ts:4017](../../packages/store/src/store.ts#L4017) `Store/forgetStandIns` | `SQLite.prepare` (4017); `Store.sql` (4017) | CORE |
| [packages/store/src/store.ts:4050](../../packages/store/src/store.ts#L4050) `Store/deleteAccount` | `SQLite.prepare` (4050, 4051, 4052, 4054, 4058); `Store.sql` (4050, 4051, 4052, 4054, 4058) | CORE |
| [packages/store/src/store.ts:4075](../../packages/store/src/store.ts#L4075) `Store/setAccountActive` | `SQLite.prepare` (4075, 4078, 4079); `Store.sql` (4075, 4078, 4079) | AUTH |
| [packages/store/src/store.ts:4089](../../packages/store/src/store.ts#L4089) `Store/accountInactive` | `SQLite.get` (4089); `SQLite.prepare` (4089); `Store.sql` (4089) | CORE |
| [packages/store/src/store.ts:4094](../../packages/store/src/store.ts#L4094) `Store/identityAllowed` | `SQLite.get` (4094, 4100, 4106); `SQLite.prepare` (4094, 4100, 4106); `Store.sql` (4094, 4100, 4106) | CORE |
| [packages/store/src/store.ts:4114](../../packages/store/src/store.ts#L4114) `Store/externalIdentityId` | `SQLite.get` (4114, 4120); `SQLite.prepare` (4114, 4119, 4120); `Store.sql` (4114, 4119, 4120) | CORE |
| [packages/store/src/store.ts:4125](../../packages/store/src/store.ts#L4125) `Store/accountIdentityId` | `SQLite.get` (4125, 4130); `SQLite.prepare` (4125, 4129, 4130); `Store.sql` (4125, 4129, 4130) | CORE |
| [packages/store/src/store.ts:4153](../../packages/store/src/store.ts#L4153) `Store/signInMark` | `SQLite.prepare` (4153); `Store.sql` (4153) | AUTH |
| [packages/store/src/store.ts:4163](../../packages/store/src/store.ts#L4163) `Store/signInBase` | `SQLite.get` (4163); `SQLite.prepare` (4163); `Store.sql` (4163) | AUTH |
| [packages/store/src/store.ts:4165](../../packages/store/src/store.ts#L4165) `Store/signInBase/identity` | `SQLite.get` (4165); `SQLite.prepare` (4165); `Store.sql` (4165) | AUTH |
| [packages/store/src/store.ts:4177](../../packages/store/src/store.ts#L4177) `Store/ledgerRow` | `SQLite.get` (4177, 4178); `SQLite.prepare` (4177, 4178); `Store.sql` (4177, 4178) | AUTH |
| [packages/store/src/store.ts:4189](../../packages/store/src/store.ts#L4189) `Store/ledgerWrite` | `Store.sql` (4189, 4190, 4192, 4194, 4197, 4197) | AUTH |
| [packages/store/src/store.ts:4216](../../packages/store/src/store.ts#L4216) `Store/settleSignIns` | `SQLite.all` (4216, 4222); `SQLite.prepare` (4216, 4222, 4228, 4232, 4234); `Store.sql` (4216, 4222, 4228, 4232, 4234) | AUTH |
| [packages/store/src/store.ts:4245](../../packages/store/src/store.ts#L4245) `Store/securityToken` | `SQLite.get` (4245); `SQLite.prepare` (4245); `Store.sql` (4245) | CORE |
| [packages/store/src/store.ts:4253](../../packages/store/src/store.ts#L4253) `Store/accountLocalOnly` | `SQLite.get` (4253); `SQLite.prepare` (4253); `Store.sql` (4253) | CORE |
| [packages/store/src/store.ts:4258](../../packages/store/src/store.ts#L4258) `Store/accountRequires2fa` | `SQLite.get` (4258); `SQLite.prepare` (4258); `Store.sql` (4258) | CORE |
| [packages/store/src/store.ts:4264](../../packages/store/src/store.ts#L4264) `Store/setAccountLocalOnly` | `SQLite.prepare` (4264); `Store.sql` (4264) | CORE |
| [packages/store/src/store.ts:4273](../../packages/store/src/store.ts#L4273) `Store/setAccountRequire2fa` | `SQLite.prepare` (4273); `Store.sql` (4273) | CORE |
| [packages/store/src/store.ts:4301](../../packages/store/src/store.ts#L4301) `Store/createApiToken` | `SQLite.get` (4301); `SQLite.prepare` (4301, 4329); `Store.sql` (4301, 4329) | CORE |
| [packages/store/src/store.ts:4376](../../packages/store/src/store.ts#L4376) `Store/recordObjectUse` | `Store.sql` (4376) | CORE |
| [packages/store/src/store.ts:4406](../../packages/store/src/store.ts#L4406) `Store/writeUsage` | `Store.sql` (4406, 4407, 4409, 4413, 4415) | CORE |
| [packages/store/src/store.ts:4422](../../packages/store/src/store.ts#L4422) `Store/writeUsageRows` | `SQLite.prepare` (4422, 4423, 4429); `Store.sql` (4422, 4423, 4429) | CORE |
| [packages/store/src/store.ts:4434](../../packages/store/src/store.ts#L4434) `Store/writeObjectUseRows` | `SQLite.prepare` (4434, 4435, 4440); `Store.sql` (4434, 4435, 4440) | CORE |
| [packages/store/src/store.ts:4445](../../packages/store/src/store.ts#L4445) `Store/objectUseSince` | `SQLite.get` (4445); `SQLite.prepare` (4445); `Store.sql` (4445) | CORE |
| [packages/store/src/store.ts:4458](../../packages/store/src/store.ts#L4458) `Store/accountUsage` | `SQLite.get` (4458); `SQLite.prepare` (4458, 4459); `Store.sql` (4458, 4459); `SQLite.all` (4459); `Store.auditLog` (4475) | CORE |
| [packages/store/src/store.ts:4491](../../packages/store/src/store.ts#L4491) `Store/apiTokens` | `SQLite.all` (4491); `SQLite.prepare` (4491); `Store.sql` (4491) | CORE |
| [packages/store/src/store.ts:4501](../../packages/store/src/store.ts#L4501) `Store/revokeApiToken` | `SQLite.prepare` (4501); `Store.sql` (4501) | CORE |
| [packages/store/src/store.ts:4515](../../packages/store/src/store.ts#L4515) `Store/apiToken` | `SQLite.get` (4515); `SQLite.prepare` (4515, 4527); `Store.sql` (4515, 4527) | CORE |
| [packages/store/src/store.ts:4543](../../packages/store/src/store.ts#L4543) `Store/enrollTotp` | `SQLite.prepare` (4543); `Store.sql` (4543) | CORE |
| [packages/store/src/store.ts:4554](../../packages/store/src/store.ts#L4554) `Store/confirmTotp` | `SQLite.get` (4554); `SQLite.prepare` (4554, 4556); `Store.sql` (4554, 4556) | CORE |
| [packages/store/src/store.ts:4564](../../packages/store/src/store.ts#L4564) `Store/hasTotp` | `SQLite.get` (4564); `SQLite.prepare` (4564); `Store.sql` (4564) | CORE |
| [packages/store/src/store.ts:4569](../../packages/store/src/store.ts#L4569) `Store/totpAccounts` | `SQLite.all` (4569); `SQLite.prepare` (4569); `Store.sql` (4569) | CORE |
| [packages/store/src/store.ts:4575](../../packages/store/src/store.ts#L4575) `Store/disableTotp` | `SQLite.prepare` (4575); `Store.sql` (4575) | CORE |
| [packages/store/src/store.ts:4598](../../packages/store/src/store.ts#L4598) `Store/verifyTotp` | `SQLite.get` (4598); `SQLite.prepare` (4598, 4604); `Store.sql` (4598, 4604) | CORE |
| [packages/store/src/store.ts:4617](../../packages/store/src/store.ts#L4617) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4617, 4619, 4620, 4622); `Store.sql` (4617, 4619, 4620, 4622); `SQLite.get` (4619) | CORE |
| [packages/store/src/store.ts:4669](../../packages/store/src/store.ts#L4669) `Store/passkeyAllowList` | `SQLite.all` (4669); `SQLite.prepare` (4669); `Store.sql` (4669) | CORE |
| [packages/store/src/store.ts:4683](../../packages/store/src/store.ts#L4683) `Store/takeWebauthnChallenge` | `SQLite.get` (4683); `SQLite.prepare` (4683, 4685); `Store.sql` (4683, 4685) | CORE |
| [packages/store/src/store.ts:4693](../../packages/store/src/store.ts#L4693) `Store/passkeys` | `SQLite.all` (4693); `SQLite.prepare` (4693); `Store.sql` (4693) | CORE |
| [packages/store/src/store.ts:4700](../../packages/store/src/store.ts#L4700) `Store/hasPasskey` | `SQLite.get` (4700); `SQLite.prepare` (4700); `Store.sql` (4700) | CORE |
| [packages/store/src/store.ts:4705](../../packages/store/src/store.ts#L4705) `Store/passkeyIds` | `SQLite.all` (4705); `SQLite.prepare` (4705); `Store.sql` (4705) | CORE |
| [packages/store/src/store.ts:4727](../../packages/store/src/store.ts#L4727) `Store/registerPasskey` | `SQLite.prepare` (4727); `Store.sql` (4727) | CORE |
| [packages/store/src/store.ts:4738](../../packages/store/src/store.ts#L4738) `Store/removePasskey` | `SQLite.get` (4738); `SQLite.prepare` (4738, 4739); `Store.sql` (4738, 4739) | CORE |
| [packages/store/src/store.ts:4755](../../packages/store/src/store.ts#L4755) `Store/verifyPasskeyAssertion` | `SQLite.get` (4755); `SQLite.prepare` (4755, 4766); `Store.sql` (4755, 4766) | CORE |
| [packages/store/src/store.ts:4802](../../packages/store/src/store.ts#L4802) `Store/generateRecoveryCodes` | `SQLite.prepare` (4802, 4805); `Store.sql` (4802, 4805) | CORE |
| [packages/store/src/store.ts:4820](../../packages/store/src/store.ts#L4820) `Store/recoveryCodesRemaining` | `SQLite.get` (4820); `SQLite.prepare` (4820); `Store.sql` (4820) | CORE |
| [packages/store/src/store.ts:4830](../../packages/store/src/store.ts#L4830) `Store/useRecoveryCode` | `SQLite.get` (4830); `SQLite.prepare` (4830, 4832); `Store.sql` (4830, 4832) | CORE |
| [packages/store/src/store.ts:4843](../../packages/store/src/store.ts#L4843) `Store/privilegeSets` | `Store.sql` (4843) | CORE |
| [packages/store/src/store.ts:4872](../../packages/store/src/store.ts#L4872) `Store/savePrivilegeSet` | `SQLite.prepare` (4872, 4880); `Store.sql` (4872, 4880) | AUTH |
| [packages/store/src/store.ts:4915](../../packages/store/src/store.ts#L4915) `Store/deletePrivilegeSet` | `SQLite.prepare` (4915); `Store.sql` (4915) | CORE |
| [packages/store/src/store.ts:4984](../../packages/store/src/store.ts#L4984) `Store/accountPrivilegeSet` | `SQLite.get` (4984); `SQLite.prepare` (4984); `Store.sql` (4984) | CORE |
| [packages/store/src/store.ts:4998](../../packages/store/src/store.ts#L4998) `Store/setAccountPrivilegeSet` | `SQLite.get` (4998); `SQLite.prepare` (4998, 5001, 5005); `Store.sql` (4998, 5001, 5005) | AUTH |
| [packages/store/src/store.ts:5020](../../packages/store/src/store.ts#L5020) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5020); `Store.sql` (5020) | CORE |
| [packages/store/src/store.ts:5034](../../packages/store/src/store.ts#L5034) `Store/addProvisionedAccount` | `SQLite.get` (5034); `SQLite.prepare` (5034, 5038); `Store.sql` (5034, 5038) | CORE |
| [packages/store/src/store.ts:5199](../../packages/store/src/store.ts#L5199) `Store/ruleOutcome` | `Calculations.context` (5199) | CORE |
| [packages/store/src/store.ts:5240](../../packages/store/src/store.ts#L5240) `Store/allowedIds` | `SQLite.iterate` (5240); `SQLite.prepare` (5240); `Store.sql` (5240) | CORE |
| [packages/store/src/store.ts:5310](../../packages/store/src/store.ts#L5310) `Store/scopedTableSql` | `Store.viewableIds` (5310); `SQLite.all` (5313); `SQLite.prepare` (5313); `Store.sql` (5313) | GATED-STORE |
| [packages/store/src/store.ts:5345](../../packages/store/src/store.ts#L5345) `Store/previewRecordRuleCurrent` | `SQLite.get` (5345); `SQLite.prepare` (5345, 5348); `Store.sql` (5345, 5348); `SQLite.all` (5348); `Calculations.context` (5354, 5370) | CORE |
| [packages/store/src/store.ts:5522](../../packages/store/src/store.ts#L5522) `Store/passwordHash` | `SQLite.get` (5522); `SQLite.prepare` (5522); `Store.sql` (5522) | CORE |
| [packages/store/src/store.ts:5551](../../packages/store/src/store.ts#L5551) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5551); `Store.sql` (5551) | CORE |
| [packages/store/src/store.ts:5564](../../packages/store/src/store.ts#L5564) `Store/knownSharedAccount` | `SQLite.get` (5564); `SQLite.prepare` (5564); `Store.sql` (5564) | CORE |
| [packages/store/src/store.ts:5627](../../packages/store/src/store.ts#L5627) `Store/layouts` | `SQLite.all` (5627); `SQLite.prepare` (5627); `Store.sql` (5627) | CORE |
| [packages/store/src/store.ts:5648](../../packages/store/src/store.ts#L5648) `Store/image` | `SQLite.get` (5648); `SQLite.prepare` (5648); `Store.sql` (5648) | CORE |
| [packages/store/src/store.ts:5658](../../packages/store/src/store.ts#L5658) `Store/images` | `SQLite.all` (5658); `SQLite.prepare` (5658); `Store.sql` (5658) | CORE |
| [packages/store/src/store.ts:5671](../../packages/store/src/store.ts#L5671) `Store/addImage` | `Store.sql` (5671, 5672); `SQLite.prepare` (5672) | CORE |
| [packages/store/src/store.ts:5688](../../packages/store/src/store.ts#L5688) `Store/layout` | `SQLite.get` (5688); `SQLite.prepare` (5688); `Store.sql` (5688) | CORE |
| [packages/store/src/store.ts:5892](../../packages/store/src/store.ts#L5892) `Store/wordIndex` | `Store.sql` (5892, 5900, 5905); `Store.recordCount` (5904); `SQLite.get` (5905); `SQLite.prepare` (5905) | CORE |
| [packages/store/src/store.ts:5957](../../packages/store/src/store.ts#L5957) `Store/toRecord` | `Calculations.value` (5957, 5967); `Calculations.globalValue` (5961); `Calculations.unstoredStyled` (5966) | CORE |
| [packages/store/src/store.ts:6016](../../packages/store/src/store.ts#L6016) `Store/relatedValues` | `Calculations.globalValue` (6016); `Calculations.unstoredValue` (6018) | CORE |
| [packages/store/src/store.ts:6090](../../packages/store/src/store.ts#L6090) `Store/addRelated` | `relatedRows` (6090); `rowsById` (6122); `firstRelatedEach` (6144) | CORE |
| [packages/store/src/store.ts:6172](../../packages/store/src/store.ts#L6172) `Store/foundSetPage` | `rowsById` (6172) | CORE |
| [packages/store/src/store.ts:6188](../../packages/store/src/store.ts#L6188) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6188); `Store.row` (6204) | GATED-STORE |
| [packages/store/src/store.ts:6227](../../packages/store/src/store.ts#L6227) `Store/portalCountsCurrent` | `Store.canView` (6227); `Store.row` (6254) | GATED-STORE |
| [packages/store/src/store.ts:6290](../../packages/store/src/store.ts#L6290) `Store/fieldIndexCurrent` | `SQLite.iterate` (6290); `SQLite.prepare` (6290, 6295); `Store.sql` (6290, 6295); `SQLite.all` (6295) | GATED-STORE |
| [packages/store/src/store.ts:6336](../../packages/store/src/store.ts#L6336) `Store/valueListItemsCurrent` | `Store.valueListItems` (6336); `Store.get` (6350); `relatedRows` (6351); `Store.row` (6351); `SQLite.iterate` (6353); `SQLite.prepare` (6353); `Store.sql` (6353); `Calculations.related` (6363); `Calculations.value` (6367, 6368) | GATED-STORE |
| [packages/store/src/store.ts:6465](../../packages/store/src/store.ts#L6465) `Store/portalRows` | `relatedRows` (6465); `relatedIdList` (6466); `Store.viewableIds` (6469); `rowsById` (6494, 6532); `Calculations.related` (6508) | CORE |
| [packages/store/src/store.ts:6476](../../packages/store/src/store.ts#L6476) `Store/portalRows/context` | `Calculations.context` (6476) | CORE |
| [packages/store/src/store.ts:6486](../../packages/store/src/store.ts#L6486) `Store/portalRows/valueOf` | `Calculations.value` (6486) | CORE |
| [packages/store/src/store.ts:6603](../../packages/store/src/store.ts#L6603) `Store/markRepeating` | `SQLite.prepare` (6603); `Store.sql` (6603) | CORE |
| [packages/store/src/store.ts:6630](../../packages/store/src/store.ts#L6630) `Store/externalContainerCheck` | `SQLite.all` (6630); `SQLite.prepare` (6630); `Store.sql` (6630) | CORE |
| [packages/store/src/store.ts:6637](../../packages/store/src/store.ts#L6637) `Store/externalContainerCount` | `SQLite.get` (6637); `SQLite.prepare` (6637); `Store.sql` (6637) | CORE |
| [packages/store/src/store.ts:6646](../../packages/store/src/store.ts#L6646) `Store/externalContainerReport` | `SQLite.all` (6646, 6659); `SQLite.prepare` (6646, 6659); `Store.sql` (6646, 6659) | CORE |
| [packages/store/src/store.ts:6701](../../packages/store/src/store.ts#L6701) `Store/orphanContainerReport` | `SQLite.all` (6701, 6719, 6721, 6727, 6740, 6753, 6772, 6790); `SQLite.prepare` (6701, 6719, 6721, 6727, 6740, 6753, 6770, 6772, 6790); `Store.sql` (6701, 6719, 6721, 6727, 6740, 6753, 6770, 6772, 6790); `SQLite.get` (6770); `Store.row` (6784) | CORE |
| [packages/store/src/store.ts:6801](../../packages/store/src/store.ts#L6801) `Store/purgeOrphanContainers` | `Store.sql` (6801, 6810, 6813, 6815, 6816, 6821, 6823); `Store.orphanContainerReport` (6802); `SQLite.get` (6810); `SQLite.prepare` (6810, 6815, 6816) | CORE |
| [packages/store/src/store.ts:6836](../../packages/store/src/store.ts#L6836) `Store/containerIntact` | `SQLite.get` (6836); `SQLite.prepare` (6836); `Store.sql` (6836) | CORE |
| [packages/store/src/store.ts:6846](../../packages/store/src/store.ts#L6846) `Store/externalOf` | `SQLite.get` (6846); `SQLite.prepare` (6846); `Store.sql` (6846) | CORE |
| [packages/store/src/store.ts:6850](../../packages/store/src/store.ts#L6850) `Store/containerMeta` | `SQLite.get` (6850); `SQLite.prepare` (6850); `Store.sql` (6850) | CORE |
| [packages/store/src/store.ts:6855](../../packages/store/src/store.ts#L6855) `Store/container` | `SQLite.get` (6855); `SQLite.prepare` (6855, 6864); `Store.sql` (6855, 6864); `SQLite.all` (6864) | CORE |
| [packages/store/src/store.ts:6872](../../packages/store/src/store.ts#L6872) `Store/containerInfo` | `SQLite.get` (6872); `SQLite.prepare` (6872); `Store.sql` (6872) | CORE |
| [packages/store/src/store.ts:6906](../../packages/store/src/store.ts#L6906) `Store/containerRange` | `SQLite.all` (6906); `SQLite.prepare` (6906, 6913); `Store.sql` (6906, 6913); `SQLite.get` (6913) | CORE |
| [packages/store/src/store.ts:6926](../../packages/store/src/store.ts#L6926) `Store/addContainer` | `SQLite.prepare` (6926, 6930, 6931); `Store.sql` (6926, 6928, 6930, 6931, 6933, 6936) | CORE |
| [packages/store/src/store.ts:6952](../../packages/store/src/store.ts#L6952) `Store/addExternalContainer` | `SQLite.prepare` (6952); `Store.sql` (6952) | CORE |
| [packages/store/src/store.ts:6970](../../packages/store/src/store.ts#L6970) `Store/writeExternalFile` | `Store.evaluateEach` (6970); `SQLite.prepare` (6993); `Store.sql` (6993) | CORE |
| [packages/store/src/store.ts:6994](../../packages/store/src/store.ts#L6994) `Store/writeExternalFile/taken` | `SQLite.get` (6994) | CORE |
| [packages/store/src/store.ts:7011](../../packages/store/src/store.ts#L7011) `Store/embeddedContainers` | `SQLite.prepare` (7011, 7012); `Store.sql` (7011, 7012); `SQLite.all` (7012); `SQLite.get` (7016) | CORE |
| [packages/store/src/store.ts:7025](../../packages/store/src/store.ts#L7025) `Store/embeddedContainerCount` | `SQLite.prepare` (7025); `Store.sql` (7025); `SQLite.get` (7026) | CORE |
| [packages/store/src/store.ts:7034](../../packages/store/src/store.ts#L7034) `Store/recoverContainersOut` | `SQLite.prepare` (7034); `Store.sql` (7034); `SQLite.get` (7037) | CORE |
| [packages/store/src/store.ts:7059](../../packages/store/src/store.ts#L7059) `Store/moveContainersOut` | `Store.sql` (7059, 7067, 7069, 7071, 7073, 7074, 7093, 7098, 7100, 7102, 7103, 7107); `SQLite.get` (7067); `SQLite.prepare` (7067, 7073, 7074); `Store.container` (7076) | CORE |
| [packages/store/src/store.ts:7116](../../packages/store/src/store.ts#L7116) `Store/moveContainersIn` | `Store.sql` (7116, 7120, 7122, 7123, 7124, 7125, 7144, 7147, 7154, 7157, 7160, 7167); `SQLite.prepare` (7122, 7123, 7124, 7125, 7154, 7160); `SQLite.get` (7127, 7154, 7160) | CORE |
| [packages/store/src/store.ts:7179](../../packages/store/src/store.ts#L7179) `Store/compactFile` | `Store.sql` (7179, 7180, 7181) | CORE |
| [packages/store/src/store.ts:7187](../../packages/store/src/store.ts#L7187) `Store/containerId` | `Store.containerId` (7187); `Store.row` (7188) | CORE |
| [packages/store/src/store.ts:7210](../../packages/store/src/store.ts#L7210) `Store/checkContainerWrite` | `Store.row` (7210) | CORE |
| [packages/store/src/store.ts:7220](../../packages/store/src/store.ts#L7220) `Store/setContainer` | `Store.row` (7220); `SQLite.prepare` (7231); `Store.sql` (7231) | CORE |
| [packages/store/src/store.ts:7263](../../packages/store/src/store.ts#L7263) `Store/orderBy` | `Store.valueListItems` (7263) | CORE |
| [packages/store/src/store.ts:7286](../../packages/store/src/store.ts#L7286) `Store/userPrefs` | `SQLite.all` (7286); `SQLite.prepare` (7286); `Store.sql` (7286) | CORE |
| [packages/store/src/store.ts:7291](../../packages/store/src/store.ts#L7291) `Store/hasTable` | `SQLite.get` (7291); `SQLite.prepare` (7291); `Store.sql` (7291) | CORE |
| [packages/store/src/store.ts:7295](../../packages/store/src/store.ts#L7295) `Store/setUserPref` | `Store.sql` (7295, 7296, 7297); `SQLite.prepare` (7296, 7297) | CORE |
| [packages/store/src/store.ts:7303](../../packages/store/src/store.ts#L7303) `Store/indexedFields` | `SQLite.all` (7303, 7304); `SQLite.prepare` (7303, 7304); `Store.sql` (7303, 7304) | CORE |
| [packages/store/src/store.ts:7325](../../packages/store/src/store.ts#L7325) `Store/addFieldIndex` | `Store.sql` (7325) | CORE |
| [packages/store/src/store.ts:7337](../../packages/store/src/store.ts#L7337) `Store/dropFieldIndex` | `SQLite.get` (7337); `SQLite.prepare` (7337); `Store.sql` (7337, 7338) | CORE |
| [packages/store/src/store.ts:7348](../../packages/store/src/store.ts#L7348) `Store/timeFind` | `Store.query` (7348, 7352, 7353); `Store.recordCount` (7355) | CORE |
| [packages/store/src/store.ts:7372](../../packages/store/src/store.ts#L7372) `Store/find` | `Store.find` (7372) | GATED-STORE |
| [packages/store/src/store.ts:7383](../../packages/store/src/store.ts#L7383) `Store/findHere` | `Store.query` (7383, 7388, 7390, 7404, 7406, 7416); `Store.recordCount` (7401); `SQLite.get` (7402, 7406); `SQLite.prepare` (7402, 7406, 7411, 7418, 7427); `Store.sql` (7402, 7406, 7411, 7418, 7427); `SQLite.all` (7411, 7418, 7427) | GATED-STORE |
| [packages/store/src/store.ts:7422](../../packages/store/src/store.ts#L7422) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7422); `SQLite.prepare` (7422); `Store.sql` (7422) | GATED-STORE |
| [packages/store/src/store.ts:7455](../../packages/store/src/store.ts#L7455) `Store/sortedPage` | `SQLite.iterate` (7455); `SQLite.prepare` (7455, 7470); `Store.sql` (7455, 7470); `SQLite.all` (7470) | CORE |
| [packages/store/src/store.ts:7527](../../packages/store/src/store.ts#L7527) `Store/relatedCriteria/matched` | `relatedRows` (7527) | CORE |
| [packages/store/src/store.ts:7530](../../packages/store/src/store.ts#L7530) `Store/relatedCriteria` | `SQLite.iterate` (7530); `SQLite.prepare` (7530); `Store.sql` (7530) | CORE |
| [packages/store/src/store.ts:7556](../../packages/store/src/store.ts#L7556) `Store/computedRows` | `Store.sql` (7556, 7559, 7560, 7561, 7563, 7573, 7574, 7575, 7578); `SQLite.prepare` (7559, 7561, 7563, 7573); `SQLite.iterate` (7563); `Calculations.globalValue` (7566); `Calculations.unstoredValue` (7567); `Calculations.related` (7570); `SQLite.all` (7573) | CORE |
| [packages/store/src/store.ts:7603](../../packages/store/src/store.ts#L7603) `Store/summaries` | `Calculations.wholeTable` (7603); `Calculations.collect` (7623, 7628) | CORE |
| [packages/store/src/store.ts:7619](../../packages/store/src/store.ts#L7619) `Store/summaries/recs` | `SQLite.iterate` (7619); `SQLite.prepare` (7619); `Store.sql` (7619) | CORE |
| [packages/store/src/store.ts:7641](../../packages/store/src/store.ts#L7641) `Store/runningSummaryValues` | `Store.viewableIds` (7641); `rowsById` (7643); `Calculations.value` (7654, 7660); `Calculations.related` (7671) | GATED-STORE |
| [packages/store/src/store.ts:7684](../../packages/store/src/store.ts#L7684) `Store/findSource` | `Store.query` (7684); `Store.sql` (7691, 7692, 7696, 7698, 7709, 7711); `SQLite.prepare` (7692, 7698); `SQLite.iterate` (7698); `Calculations.globalValue` (7702); `Calculations.unstoredValue` (7703); `Calculations.related` (7707) | CORE |
| [packages/store/src/store.ts:7730](../../packages/store/src/store.ts#L7730) `Store/previewRow` | `Store.row` (7730) | CORE |
| [packages/store/src/store.ts:7748](../../packages/store/src/store.ts#L7748) `Store/row` | `SQLite.get` (7748) | CORE |
| [packages/store/src/store.ts:7767](../../packages/store/src/store.ts#L7767) `Store/getCurrent` | `Store.get` (7767); `Store.row` (7768, 7768, 7782); `SQLite.all` (7785); `SQLite.prepare` (7785); `Store.sql` (7785) | GATED-STORE |
| [packages/store/src/store.ts:7805](../../packages/store/src/store.ts#L7805) `Store/getManyCurrent` | `Store.getMany` (7805); `SQLite.get` (7823); `SQLite.prepare` (7823); `Store.sql` (7823) | GATED-STORE |
| [packages/store/src/store.ts:7816](../../packages/store/src/store.ts#L7816) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (7816) | GATED-STORE |
| [packages/store/src/store.ts:7839](../../packages/store/src/store.ts#L7839) `Store/canViewRecord` | `SQLite.get` (7839); `SQLite.prepare` (7839); `Store.sql` (7839) | GATED-STORE |
| [packages/store/src/store.ts:7847](../../packages/store/src/store.ts#L7847) `Store/canView` | `Store.canView` (7847); `Store.row` (7848) | GATED-STORE |
| [packages/store/src/store.ts:7872](../../packages/store/src/store.ts#L7872) `Store/create` | `SQLite.get` (7872, 7878); `SQLite.prepare` (7872, 7878, 7889); `Store.sql` (7872, 7878, 7889) | CORE |
| [packages/store/src/store.ts:7913](../../packages/store/src/store.ts#L7913) `Store/duplicate` | `Store.row` (7913); `SQLite.get` (7917); `SQLite.prepare` (7917, 7930); `Store.sql` (7917, 7930) | CORE |
| [packages/store/src/store.ts:7975](../../packages/store/src/store.ts#L7975) `Store/update` | `Store.row` (7975, 7982, 7993); `Store.sql` (8006, 8007, 8044, 8047) | CORE |
| [packages/store/src/store.ts:8009](../../packages/store/src/store.ts#L8009) `Store/update/undo` | `Store.sql` (8009) | CORE |
| [packages/store/src/store.ts:8151](../../packages/store/src/store.ts#L8151) `Store/setStoredCalcValues` | `SQLite.prepare` (8151, 8152); `Store.sql` (8151, 8152); `SQLite.get` (8156) | CORE |
| [packages/store/src/store.ts:8230](../../packages/store/src/store.ts#L8230) `Store/evaluateCurrent` | `Store.row` (8230, 8230); `Calculations.context` (8231); `Store.get` (8232, 8234) | GATED-STORE |
| [packages/store/src/store.ts:8266](../../packages/store/src/store.ts#L8266) `Store/evaluateEachCurrent` | `Store.row` (8266, 8266); `Calculations.context` (8271); `Store.get` (8273) | GATED-STORE |
| [packages/store/src/store.ts:8306](../../packages/store/src/store.ts#L8306) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8306); `Store.get` (8308) | GATED-STORE |
| [packages/store/src/store.ts:8327](../../packages/store/src/store.ts#L8327) `Store/evaluateRowsCurrent` | `Store.row` (8327, 8327) | GATED-STORE |
| [packages/store/src/store.ts:8341](../../packages/store/src/store.ts#L8341) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8341) | GATED-STORE |
| [packages/store/src/store.ts:8363](../../packages/store/src/store.ts#L8363) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8363) | GATED-STORE |
| [packages/store/src/store.ts:8401](../../packages/store/src/store.ts#L8401) `Store/updateRelated` | `relatedRows` (8401) | CORE |
| [packages/store/src/store.ts:8419](../../packages/store/src/store.ts#L8419) `Store/updatePortals` | `Store.row` (8419, 8454); `relatedRows` (8455) | CORE |
| [packages/store/src/store.ts:8428](../../packages/store/src/store.ts#L8428) `Store/updatePortals/portal/related` | `relatedIdList` (8428) | CORE |
| [packages/store/src/store.ts:8510](../../packages/store/src/store.ts#L8510) `Store/portalContainerTarget` | `Store.row` (8510); `relatedIdList` (8511) | CORE |
| [packages/store/src/store.ts:8524](../../packages/store/src/store.ts#L8524) `Store/checkEditable` | `Store.row` (8524) | CORE |
| [packages/store/src/store.ts:8547](../../packages/store/src/store.ts#L8547) `Store/delete` | `Store.row` (8547); `SQLite.get` (8552); `SQLite.prepare` (8552, 8554); `Store.sql` (8552, 8554) | CORE |
| [packages/store/src/store.ts:8575](../../packages/store/src/store.ts#L8575) `Store/vaultHeld` | `SQLite.get` (8575); `SQLite.prepare` (8575); `Store.sql` (8575) | CORE |
| [packages/store/src/store.ts:8582](../../packages/store/src/store.ts#L8582) `Store/forgetStandInValues` | `Store.sql` (8582, 8603); `SQLite.prepare` (8603) | CORE |
| [packages/store/src/store.ts:8617](../../packages/store/src/store.ts#L8617) `Store/restoreDeletedRow` | `SQLite.get` (8617); `SQLite.prepare` (8617, 8618, 8620); `Store.sql` (8617, 8618, 8620); `SQLite.all` (8618) | CORE |
| [packages/store/src/store.ts:8644](../../packages/store/src/store.ts#L8644) `Store/cascadeDelete` | `relatedRows` (8644) | CORE |
| [packages/store/src/store.ts:8734](../../packages/store/src/store.ts#L8734) `Store/selectIdsCurrent` | `Store.selectIds` (8734); `SQLite.all` (8740); `SQLite.prepare` (8740); `Store.sql` (8740) | GATED-STORE |
| [packages/store/src/store.ts:8748](../../packages/store/src/store.ts#L8748) `Store/countIds` | `Store.countIds` (8748); `SQLite.get` (8752); `SQLite.prepare` (8752); `Store.sql` (8752) | GATED-STORE |
| [packages/store/src/store.ts:8768](../../packages/store/src/store.ts#L8768) `Store/computeValuesCurrent` | `Store.computeValues` (8768); `Store.sql` (8774, 8778); `SQLite.all` (8778); `SQLite.prepare` (8778) | GATED-STORE |
| [packages/store/src/store.ts:8793](../../packages/store/src/store.ts#L8793) `Store/findIdsCurrent` | `Store.findIds` (8793) | GATED-STORE |
| [packages/store/src/store.ts:8799](../../packages/store/src/store.ts#L8799) `Store/findIdsHere` | `Store.query` (8799, 8804, 8806); `SQLite.iterate` (8817); `SQLite.prepare` (8817); `Store.sql` (8817) | GATED-STORE |
| [packages/store/src/store.ts:8834](../../packages/store/src/store.ts#L8834) `Store/groupSummariesCurrent` | `Store.groupSummaries` (8834); `Store.viewableIds` (8839); `Calculations.collect` (8855); `rowsById` (8855, 8905); `Calculations.collector` (8877) | GATED-STORE |
| [packages/store/src/store.ts:8867](../../packages/store/src/store.ts#L8867) `Store/groupSummariesCurrent/key` | `Calculations.value` (8867); `Calculations.related` (8869) | GATED-STORE |
| [packages/store/src/store.ts:8903](../../packages/store/src/store.ts#L8903) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (8903) | GATED-STORE |
| [packages/store/src/store.ts:8926](../../packages/store/src/store.ts#L8926) `Store/sortIdsCurrent` | `Store.sortIds` (8926); `SQLite.all` (8930); `SQLite.prepare` (8930); `Store.sql` (8930) | GATED-STORE |
| [packages/store/src/store.ts:8940](../../packages/store/src/store.ts#L8940) `Store/matchIds` | `Store.matchIds` (8940); `SQLite.all` (8946); `SQLite.prepare` (8946); `Store.sql` (8946) | CORE |
| [packages/store/src/store.ts:8964](../../packages/store/src/store.ts#L8964) `Store/truncate` | `Store.sql` (8964, 8966, 8973, 8974, 8976, 8977); `SQLite.prepare` (8966, 8973); `SQLite.all` (8968) | CORE |
| [packages/store/src/store.ts:8998](../../packages/store/src/store.ts#L8998) `Store/iterateCommitted` | `SQLite.iterate` (8998) | CORE |
| [packages/store/src/store.ts:9032](../../packages/store/src/store.ts#L9032) `Store/readOnlyChecked` | `SQLite.prepare` (9032, 9036, 9045, 9050); `SQLite.all` (9036, 9045, 9050) | CORE |
| [packages/store/src/store.ts:9072](../../packages/store/src/store.ts#L9072) `Store/refreshDecimalSqlViews` | `SQLite.get` (9072); `SQLite.prepare` (9072, 9077); `SQLite.all` (9077) | CORE |
| [packages/store/src/store.ts:9091](../../packages/store/src/store.ts#L9091) `Store/internalRoots` | `SQLite.get` (9091); `SQLite.prepare` (9091, 9093); `SQLite.all` (9093) | CORE |
| [packages/store/src/store.ts:9126](../../packages/store/src/store.ts#L9126) `Store/selectCurrent` | `SQLite.iterate` (9126) | CORE |
| [packages/store/src/store.ts:9147](../../packages/store/src/store.ts#L9147) `Store/query` | `SQLite.iterate` (9147) | CORE |
| [packages/store/src/store.ts:9181](../../packages/store/src/store.ts#L9181) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9181); `SQLite.all` (9188, 9191); `SQLite.prepare` (9188, 9191) | CORE |
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
<!-- end generated read-gate inventory -->
