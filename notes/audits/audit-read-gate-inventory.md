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
| [packages/server/src/logs.ts:77](../../packages/server/src/logs.ts#L77) `LogShipper/follow` | `SQLite.get` (77); `SQLite.prepare` (77); `Store.sql` (77, 78, 79, 80) | ADMIN |
| [packages/server/src/logs.ts:89](../../packages/server/src/logs.ts#L89) `LogShipper/releaseIfIdle` | `Store.sql` (89) | ADMIN |
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
| [packages/store/src/store.ts:2582](../../packages/store/src/store.ts#L2582) `Store/designEffect/renameKey` | `SQLite.prepare` (2582); `Store.sql` (2582) | CORE |
| [packages/store/src/store.ts:2598](../../packages/store/src/store.ts#L2598) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2598); `Store.sql` (2598) | CORE |
| [packages/store/src/store.ts:2605](../../packages/store/src/store.ts#L2605) `Store/designEffect` | `Store.sql` (2605, 2610, 2615, 2620, 2623, 2629, 2637, 2638, 2640, 2652, 2653, 2656, 2658, 2664, 2665, 2666, 2671, 2673, 2677, 2680, 2681, 2683, 2686, 2691, 2693, 2700, 2701, 2703, 2704, 2705, 2706, 2713, 2714, 2716, 2716, 2718, 2719, 2720, 2724, 2728, 2730, 2768, 2770, 2772); `SQLite.get` (2637, 2652, 2664, 2665, 2677, 2681, 2716, 2724); `SQLite.prepare` (2637, 2638, 2652, 2653, 2664, 2665, 2671, 2673, 2677, 2681, 2691, 2693, 2706, 2713, 2714, 2716, 2718, 2720, 2724, 2728); `SQLite.all` (2713, 2714); `SQLite.iterate` (2718) | CORE |
| [packages/store/src/store.ts:2780](../../packages/store/src/store.ts#L2780) `Store/dropColumnIndexes` | `SQLite.all` (2780, 2782); `SQLite.prepare` (2780, 2782); `Store.sql` (2780, 2782, 2783) | CORE |
| [packages/store/src/store.ts:2792](../../packages/store/src/store.ts#L2792) `Store/recompute` | `SQLite.prepare` (2792, 2796); `Store.sql` (2792, 2796); `SQLite.iterate` (2796); `Calculations.computeStoredStyled` (2797); `Calculations.value` (2797) | CORE |
| [packages/store/src/store.ts:2812](../../packages/store/src/store.ts#L2812) `Store/linkPrincipal` | `SQLite.get` (2812); `SQLite.prepare` (2812); `Store.sql` (2812) | CORE |
| [packages/store/src/store.ts:2819](../../packages/store/src/store.ts#L2819) `Store/linkIdentity` | `SQLite.get` (2819); `SQLite.prepare` (2819); `Store.sql` (2819) | CORE |
| [packages/store/src/store.ts:2825](../../packages/store/src/store.ts#L2825) `Store/accountsSharingLockout` | `SQLite.all` (2825); `SQLite.prepare` (2825); `Store.sql` (2825) | CORE |
| [packages/store/src/store.ts:2829](../../packages/store/src/store.ts#L2829) `Store/accounts` | `SQLite.all` (2829); `SQLite.prepare` (2829); `Store.sql` (2829) | CORE |
| [packages/store/src/store.ts:2841](../../packages/store/src/store.ts#L2841) `Store/isAgent` | `SQLite.get` (2841); `SQLite.prepare` (2841); `Store.sql` (2841) | CORE |
| [packages/store/src/store.ts:2847](../../packages/store/src/store.ts#L2847) `Store/agentNeedsApproval` | `SQLite.get` (2847); `SQLite.prepare` (2847); `Store.sql` (2847) | CORE |
| [packages/store/src/store.ts:2853](../../packages/store/src/store.ts#L2853) `Store/blankPasswordAccounts` | `SQLite.all` (2853); `SQLite.prepare` (2853); `Store.sql` (2853) | CORE |
| [packages/store/src/store.ts:1238](../../packages/store/src/store.ts#L1238) `Store/hasOwnPassword` | `SQLite.get` (1238); `SQLite.prepare` (1238); `Store.sql` (1238) | CORE |
| [packages/store/src/store.ts:2864](../../packages/store/src/store.ts#L2864) `Store/unmigratedAccounts` | `SQLite.all` (2864); `SQLite.prepare` (2864); `Store.sql` (2864) | CORE |
| [packages/store/src/store.ts:2917](../../packages/store/src/store.ts#L2917) `Store/setExternalAccount` | `SQLite.get` (2917); `SQLite.prepare` (2917, 2922); `Store.sql` (2917, 2922) | CORE |
| [packages/store/src/store.ts:2935](../../packages/store/src/store.ts#L2935) `Store/refuseLookalikeAccount` | `SQLite.all` (2935); `SQLite.prepare` (2935); `Store.sql` (2935) | CORE |
| [packages/store/src/store.ts:2944](../../packages/store/src/store.ts#L2944) `Store/isExternal` | `SQLite.get` (2944); `SQLite.prepare` (2944); `Store.sql` (2944) | CORE |
| [packages/store/src/store.ts:2965](../../packages/store/src/store.ts#L2965) `Store/setAgentAccount` | `SQLite.get` (2965); `SQLite.prepare` (2965, 2971); `Store.sql` (2965, 2971) | CORE |
| [packages/store/src/store.ts:3005](../../packages/store/src/store.ts#L3005) `Store/gateAgentWrite` | `SQLite.prepare` (3005); `Store.sql` (3005) | CORE |
| [packages/store/src/store.ts:3027](../../packages/store/src/store.ts#L3027) `Store/pendingChanges` | `SQLite.all` (3027); `SQLite.prepare` (3027); `Store.sql` (3027) | CORE |
| [packages/store/src/store.ts:3041](../../packages/store/src/store.ts#L3041) `Store/approvePending` | `SQLite.get` (3041); `SQLite.prepare` (3041, 3052); `Store.sql` (3041, 3052) | CORE |
| [packages/store/src/store.ts:3062](../../packages/store/src/store.ts#L3062) `Store/rejectPending` | `SQLite.get` (3062); `SQLite.prepare` (3062, 3064); `Store.sql` (3062, 3064) | CORE |
| [packages/store/src/store.ts:3084](../../packages/store/src/store.ts#L3084) `Store/externalAccount` | `SQLite.all` (3084); `SQLite.prepare` (3084); `Store.sql` (3084) | CORE |
| [packages/store/src/store.ts:3115](../../packages/store/src/store.ts#L3115) `Store/setPassword` | `SQLite.get` (3115); `SQLite.prepare` (3115, 3117, 3126); `Store.sql` (3115, 3117, 3126) | AUTH |
| [packages/store/src/store.ts:3140](../../packages/store/src/store.ts#L3140) `Store/createAccount` | `SQLite.get` (3140); `SQLite.prepare` (3140, 3144, 3150, 3155, 3160); `Store.sql` (3140, 3144, 3150, 3155, 3160) | CORE |
| [packages/store/src/store.ts:3168](../../packages/store/src/store.ts#L3168) `Store/appendSecurityEvent` | `Store.sql` (3168) | CORE |
| [packages/store/src/store.ts:3210](../../packages/store/src/store.ts#L3210) `Store/setPasswordPolicy` | `SQLite.prepare` (3210); `Store.sql` (3210) | CORE |
| [packages/store/src/store.ts:3246](../../packages/store/src/store.ts#L3246) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3246); `Store.sql` (3246) | CORE |
| [packages/store/src/store.ts:3269](../../packages/store/src/store.ts#L3269) `Store/saveScriptTest` | `SQLite.prepare` (3269); `Store.sql` (3269) | CORE |
| [packages/store/src/store.ts:3278](../../packages/store/src/store.ts#L3278) `Store/deleteScriptTest` | `SQLite.prepare` (3278); `Store.sql` (3278) | CORE |
| [packages/store/src/store.ts:3313](../../packages/store/src/store.ts#L3313) `Store/setAiAllowed` | `SQLite.prepare` (3313); `Store.sql` (3313) | CORE |
| [packages/store/src/store.ts:3359](../../packages/store/src/store.ts#L3359) `Store/setAiPolicy` | `SQLite.prepare` (3359); `Store.sql` (3359) | CORE |
| [packages/store/src/store.ts:3328](../../packages/store/src/store.ts#L3328) `Store/setScriptNetwork` | `SQLite.prepare` (3328); `Store.sql` (3328) | CORE |
| [packages/store/src/store.ts:3348](../../packages/store/src/store.ts#L3348) `Store/setWebViewerHosts` | `SQLite.prepare` (3348); `Store.sql` (3348) | CORE |
| [packages/store/src/store.ts:3379](../../packages/store/src/store.ts#L3379) `Store/setPiiIsolation` | `SQLite.prepare` (3379); `Store.sql` (3379) | CORE |
| [packages/store/src/store.ts:3401](../../packages/store/src/store.ts#L3401) `Store/markPiiField` | `SQLite.prepare` (3401); `Store.sql` (3401) | CORE |
| [packages/store/src/store.ts:3515](../../packages/store/src/store.ts#L3515) `Store/lastSignIns` | `Store.auditLog` (3515) | CORE |
| [packages/store/src/store.ts:3718](../../packages/store/src/store.ts#L3718) `Store/unusualAccess` | `Store.auditLog` (3718, 3784) | CORE |
| [packages/store/src/store.ts:3815](../../packages/store/src/store.ts#L3815) `Store/leastPrivilege` | `SQLite.all` (3815); `SQLite.prepare` (3815); `Store.sql` (3815) | CORE |
| [packages/store/src/store.ts:3888](../../packages/store/src/store.ts#L3888) `Store/unusedAccess` | `SQLite.get` (3888); `SQLite.prepare` (3888, 3897); `Store.sql` (3888, 3897); `SQLite.all` (3897) | CORE |
| [packages/store/src/store.ts:3936](../../packages/store/src/store.ts#L3936) `Store/unusedObjects` | `SQLite.get` (3936); `SQLite.prepare` (3936, 3939); `Store.sql` (3936, 3939); `SQLite.all` (3939) | CORE |
| [packages/store/src/store.ts:3974](../../packages/store/src/store.ts#L3974) `Store/usageCounting` | `SQLite.get` (3974); `SQLite.prepare` (3974); `Store.sql` (3974) | CORE |
| [packages/store/src/store.ts:3982](../../packages/store/src/store.ts#L3982) `Store/setMustChangePassword` | `SQLite.prepare` (3982); `Store.sql` (3982) | CORE |
| [packages/store/src/store.ts:3996](../../packages/store/src/store.ts#L3996) `Store/mustChangePassword` | `SQLite.get` (3996); `SQLite.prepare` (3996); `Store.sql` (3996) | CORE |
| [packages/store/src/store.ts:4035](../../packages/store/src/store.ts#L4035) `Store/passwordDaysRemaining` | `SQLite.get` (4035); `SQLite.prepare` (4035); `Store.sql` (4035) | CORE |
| [packages/store/src/store.ts:4042](../../packages/store/src/store.ts#L4042) `Store/importAccounts` | `SQLite.all` (4042); `SQLite.prepare` (4042); `Store.sql` (4042) | CORE |
| [packages/store/src/store.ts:4065](../../packages/store/src/store.ts#L4065) `Store/canonicalAccount` | `SQLite.all` (4065); `SQLite.prepare` (4065); `Store.sql` (4065) | CORE |
| [packages/store/src/store.ts:4077](../../packages/store/src/store.ts#L4077) `Store/createLocalAccount` | `SQLite.prepare` (4077); `Store.sql` (4077) | CORE |
| [packages/store/src/store.ts:4107](../../packages/store/src/store.ts#L4107) `Store/previewAccountImport` | `Store.sql` (4107, 4108, 4117) | CORE |
| [packages/store/src/store.ts:4125](../../packages/store/src/store.ts#L4125) `Store/limitAccountImport` | `SQLite.prepare` (4125, 4126, 4129); `Store.sql` (4125, 4126, 4129); `SQLite.get` (4126) | CORE |
| [packages/store/src/store.ts:4136](../../packages/store/src/store.ts#L4136) `Store/applyAccountImport` | `Store.sql` (4136, 4144, 4173); `SQLite.get` (4144); `SQLite.prepare` (4144, 4173) | CORE |
| [packages/store/src/store.ts:4198](../../packages/store/src/store.ts#L4198) `Store/forgetStandIns` | `SQLite.prepare` (4198); `Store.sql` (4198) | CORE |
| [packages/store/src/store.ts:4231](../../packages/store/src/store.ts#L4231) `Store/deleteAccount` | `SQLite.prepare` (4231, 4232, 4233, 4235, 4239); `Store.sql` (4231, 4232, 4233, 4235, 4239) | CORE |
| [packages/store/src/store.ts:4256](../../packages/store/src/store.ts#L4256) `Store/setAccountActive` | `SQLite.prepare` (4256, 4259, 4260); `Store.sql` (4256, 4259, 4260) | AUTH |
| [packages/store/src/store.ts:4270](../../packages/store/src/store.ts#L4270) `Store/accountInactive` | `SQLite.get` (4270); `SQLite.prepare` (4270); `Store.sql` (4270) | CORE |
| [packages/store/src/store.ts:4275](../../packages/store/src/store.ts#L4275) `Store/identityAllowed` | `SQLite.get` (4275, 4281, 4287); `SQLite.prepare` (4275, 4281, 4287); `Store.sql` (4275, 4281, 4287) | CORE |
| [packages/store/src/store.ts:4295](../../packages/store/src/store.ts#L4295) `Store/externalIdentityId` | `SQLite.get` (4295, 4301); `SQLite.prepare` (4295, 4300, 4301); `Store.sql` (4295, 4300, 4301) | CORE |
| [packages/store/src/store.ts:4306](../../packages/store/src/store.ts#L4306) `Store/accountIdentityId` | `SQLite.get` (4306, 4311); `SQLite.prepare` (4306, 4310, 4311); `Store.sql` (4306, 4310, 4311) | CORE |
| [packages/store/src/store.ts:4334](../../packages/store/src/store.ts#L4334) `Store/signInMark` | `SQLite.prepare` (4334); `Store.sql` (4334) | AUTH |
| [packages/store/src/store.ts:4344](../../packages/store/src/store.ts#L4344) `Store/signInBase` | `SQLite.get` (4344); `SQLite.prepare` (4344); `Store.sql` (4344) | AUTH |
| [packages/store/src/store.ts:4346](../../packages/store/src/store.ts#L4346) `Store/signInBase/identity` | `SQLite.get` (4346); `SQLite.prepare` (4346); `Store.sql` (4346) | AUTH |
| [packages/store/src/store.ts:4358](../../packages/store/src/store.ts#L4358) `Store/ledgerRow` | `SQLite.get` (4358, 4359); `SQLite.prepare` (4358, 4359); `Store.sql` (4358, 4359) | AUTH |
| [packages/store/src/store.ts:4370](../../packages/store/src/store.ts#L4370) `Store/ledgerWrite` | `Store.sql` (4370, 4371, 4373, 4375, 4378, 4378) | AUTH |
| [packages/store/src/store.ts:4397](../../packages/store/src/store.ts#L4397) `Store/settleSignIns` | `SQLite.all` (4397, 4403); `SQLite.prepare` (4397, 4403, 4409, 4413, 4415); `Store.sql` (4397, 4403, 4409, 4413, 4415) | AUTH |
| [packages/store/src/store.ts:4426](../../packages/store/src/store.ts#L4426) `Store/securityToken` | `SQLite.get` (4426); `SQLite.prepare` (4426); `Store.sql` (4426) | CORE |
| [packages/store/src/store.ts:4434](../../packages/store/src/store.ts#L4434) `Store/accountLocalOnly` | `SQLite.get` (4434); `SQLite.prepare` (4434); `Store.sql` (4434) | CORE |
| [packages/store/src/store.ts:4439](../../packages/store/src/store.ts#L4439) `Store/accountRequires2fa` | `SQLite.get` (4439); `SQLite.prepare` (4439); `Store.sql` (4439) | CORE |
| [packages/store/src/store.ts:4445](../../packages/store/src/store.ts#L4445) `Store/setAccountLocalOnly` | `SQLite.prepare` (4445); `Store.sql` (4445) | CORE |
| [packages/store/src/store.ts:4454](../../packages/store/src/store.ts#L4454) `Store/setAccountRequire2fa` | `SQLite.prepare` (4454); `Store.sql` (4454) | CORE |
| [packages/store/src/store.ts:4483](../../packages/store/src/store.ts#L4483) `Store/createApiToken` | `SQLite.get` (4483); `SQLite.prepare` (4483, 4513); `Store.sql` (4483, 4513) | CORE |
| [packages/store/src/store.ts:4560](../../packages/store/src/store.ts#L4560) `Store/recordObjectUse` | `Store.sql` (4560) | CORE |
| [packages/store/src/store.ts:4590](../../packages/store/src/store.ts#L4590) `Store/writeUsage` | `Store.sql` (4590, 4591, 4593, 4597, 4599) | CORE |
| [packages/store/src/store.ts:4606](../../packages/store/src/store.ts#L4606) `Store/writeUsageRows` | `SQLite.prepare` (4606, 4607, 4613); `Store.sql` (4606, 4607, 4613) | CORE |
| [packages/store/src/store.ts:4618](../../packages/store/src/store.ts#L4618) `Store/writeObjectUseRows` | `SQLite.prepare` (4618, 4619, 4624); `Store.sql` (4618, 4619, 4624) | CORE |
| [packages/store/src/store.ts:4629](../../packages/store/src/store.ts#L4629) `Store/objectUseSince` | `SQLite.get` (4629); `SQLite.prepare` (4629); `Store.sql` (4629) | CORE |
| [packages/store/src/store.ts:4642](../../packages/store/src/store.ts#L4642) `Store/accountUsage` | `SQLite.get` (4642); `SQLite.prepare` (4642, 4643); `Store.sql` (4642, 4643); `SQLite.all` (4643); `Store.auditLog` (4659) | CORE |
| [packages/store/src/store.ts:4675](../../packages/store/src/store.ts#L4675) `Store/apiTokens` | `SQLite.all` (4675); `SQLite.prepare` (4675); `Store.sql` (4675) | CORE |
| [packages/store/src/store.ts:4685](../../packages/store/src/store.ts#L4685) `Store/revokeApiToken` | `SQLite.prepare` (4685); `Store.sql` (4685) | CORE |
| [packages/store/src/store.ts:4699](../../packages/store/src/store.ts#L4699) `Store/apiToken` | `SQLite.get` (4699); `SQLite.prepare` (4699, 4711); `Store.sql` (4699, 4711) | CORE |
| [packages/store/src/store.ts:4727](../../packages/store/src/store.ts#L4727) `Store/enrollTotp` | `SQLite.prepare` (4727); `Store.sql` (4727) | CORE |
| [packages/store/src/store.ts:4738](../../packages/store/src/store.ts#L4738) `Store/confirmTotp` | `SQLite.get` (4738); `SQLite.prepare` (4738, 4740); `Store.sql` (4738, 4740) | CORE |
| [packages/store/src/store.ts:4748](../../packages/store/src/store.ts#L4748) `Store/hasTotp` | `SQLite.get` (4748); `SQLite.prepare` (4748); `Store.sql` (4748) | CORE |
| [packages/store/src/store.ts:4753](../../packages/store/src/store.ts#L4753) `Store/totpAccounts` | `SQLite.all` (4753); `SQLite.prepare` (4753); `Store.sql` (4753) | CORE |
| [packages/store/src/store.ts:4759](../../packages/store/src/store.ts#L4759) `Store/disableTotp` | `SQLite.prepare` (4759); `Store.sql` (4759) | CORE |
| [packages/store/src/store.ts:4782](../../packages/store/src/store.ts#L4782) `Store/verifyTotp` | `SQLite.get` (4782); `SQLite.prepare` (4782, 4788); `Store.sql` (4782, 4788) | CORE |
| [packages/store/src/store.ts:4801](../../packages/store/src/store.ts#L4801) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4801, 4803, 4804, 4806); `Store.sql` (4801, 4803, 4804, 4806); `SQLite.get` (4803) | CORE |
| [packages/store/src/store.ts:4853](../../packages/store/src/store.ts#L4853) `Store/passkeyAllowList` | `SQLite.all` (4853); `SQLite.prepare` (4853); `Store.sql` (4853) | CORE |
| [packages/store/src/store.ts:4867](../../packages/store/src/store.ts#L4867) `Store/takeWebauthnChallenge` | `SQLite.get` (4867); `SQLite.prepare` (4867, 4869); `Store.sql` (4867, 4869) | CORE |
| [packages/store/src/store.ts:4877](../../packages/store/src/store.ts#L4877) `Store/passkeys` | `SQLite.all` (4877); `SQLite.prepare` (4877); `Store.sql` (4877) | CORE |
| [packages/store/src/store.ts:4884](../../packages/store/src/store.ts#L4884) `Store/hasPasskey` | `SQLite.get` (4884); `SQLite.prepare` (4884); `Store.sql` (4884) | CORE |
| [packages/store/src/store.ts:4889](../../packages/store/src/store.ts#L4889) `Store/passkeyIds` | `SQLite.all` (4889); `SQLite.prepare` (4889); `Store.sql` (4889) | CORE |
| [packages/store/src/store.ts:4911](../../packages/store/src/store.ts#L4911) `Store/registerPasskey` | `SQLite.prepare` (4911); `Store.sql` (4911) | CORE |
| [packages/store/src/store.ts:4922](../../packages/store/src/store.ts#L4922) `Store/removePasskey` | `SQLite.get` (4922); `SQLite.prepare` (4922, 4923); `Store.sql` (4922, 4923) | CORE |
| [packages/store/src/store.ts:4939](../../packages/store/src/store.ts#L4939) `Store/verifyPasskeyAssertion` | `SQLite.get` (4939); `SQLite.prepare` (4939, 4950); `Store.sql` (4939, 4950) | CORE |
| [packages/store/src/store.ts:4986](../../packages/store/src/store.ts#L4986) `Store/generateRecoveryCodes` | `SQLite.prepare` (4986, 4989); `Store.sql` (4986, 4989) | CORE |
| [packages/store/src/store.ts:5004](../../packages/store/src/store.ts#L5004) `Store/recoveryCodesRemaining` | `SQLite.get` (5004); `SQLite.prepare` (5004); `Store.sql` (5004) | CORE |
| [packages/store/src/store.ts:5014](../../packages/store/src/store.ts#L5014) `Store/useRecoveryCode` | `SQLite.get` (5014); `SQLite.prepare` (5014, 5016); `Store.sql` (5014, 5016) | CORE |
| [packages/store/src/store.ts:5027](../../packages/store/src/store.ts#L5027) `Store/privilegeSets` | `Store.sql` (5027) | CORE |
| [packages/store/src/store.ts:5056](../../packages/store/src/store.ts#L5056) `Store/savePrivilegeSet` | `SQLite.prepare` (5056, 5064); `Store.sql` (5056, 5064) | AUTH |
| [packages/store/src/store.ts:5099](../../packages/store/src/store.ts#L5099) `Store/deletePrivilegeSet` | `SQLite.prepare` (5099); `Store.sql` (5099) | CORE |
| [packages/store/src/store.ts:5168](../../packages/store/src/store.ts#L5168) `Store/accountPrivilegeSet` | `SQLite.get` (5168); `SQLite.prepare` (5168); `Store.sql` (5168) | CORE |
| [packages/store/src/store.ts:5182](../../packages/store/src/store.ts#L5182) `Store/setAccountPrivilegeSet` | `SQLite.get` (5182); `SQLite.prepare` (5182, 5185, 5189); `Store.sql` (5182, 5185, 5189) | AUTH |
| [packages/store/src/store.ts:5204](../../packages/store/src/store.ts#L5204) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5204); `Store.sql` (5204) | CORE |
| [packages/store/src/store.ts:5218](../../packages/store/src/store.ts#L5218) `Store/addProvisionedAccount` | `SQLite.get` (5218); `SQLite.prepare` (5218, 5222); `Store.sql` (5218, 5222) | CORE |
| [packages/store/src/store.ts:5391](../../packages/store/src/store.ts#L5391) `Store/ruleOutcome` | `Calculations.context` (5391) | CORE |
| [packages/store/src/store.ts:5432](../../packages/store/src/store.ts#L5432) `Store/allowedIds` | `SQLite.iterate` (5432); `SQLite.prepare` (5432); `Store.sql` (5432) | CORE |
| [packages/store/src/store.ts:5502](../../packages/store/src/store.ts#L5502) `Store/scopedTableSql` | `Store.viewableIds` (5502); `SQLite.all` (5505); `SQLite.prepare` (5505); `Store.sql` (5505) | GATED-STORE |
| [packages/store/src/store.ts:5537](../../packages/store/src/store.ts#L5537) `Store/previewRecordRuleCurrent` | `SQLite.get` (5537); `SQLite.prepare` (5537, 5540); `Store.sql` (5537, 5540); `SQLite.all` (5540); `Calculations.context` (5546, 5562) | CORE |
| [packages/store/src/store.ts:5714](../../packages/store/src/store.ts#L5714) `Store/passwordHash` | `SQLite.get` (5714); `SQLite.prepare` (5714); `Store.sql` (5714) | CORE |
| [packages/store/src/store.ts:5743](../../packages/store/src/store.ts#L5743) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5743); `Store.sql` (5743) | CORE |
| [packages/store/src/store.ts:5756](../../packages/store/src/store.ts#L5756) `Store/knownSharedAccount` | `SQLite.get` (5756); `SQLite.prepare` (5756); `Store.sql` (5756) | CORE |
| [packages/store/src/store.ts:5819](../../packages/store/src/store.ts#L5819) `Store/layouts` | `SQLite.all` (5819); `SQLite.prepare` (5819); `Store.sql` (5819) | CORE |
| [packages/store/src/store.ts:5840](../../packages/store/src/store.ts#L5840) `Store/image` | `SQLite.get` (5840); `SQLite.prepare` (5840); `Store.sql` (5840) | CORE |
| [packages/store/src/store.ts:5850](../../packages/store/src/store.ts#L5850) `Store/images` | `SQLite.all` (5850); `SQLite.prepare` (5850); `Store.sql` (5850) | CORE |
| [packages/store/src/store.ts:5863](../../packages/store/src/store.ts#L5863) `Store/addImage` | `Store.sql` (5863, 5864); `SQLite.prepare` (5864) | CORE |
| [packages/store/src/store.ts:5880](../../packages/store/src/store.ts#L5880) `Store/layout` | `SQLite.get` (5880); `SQLite.prepare` (5880); `Store.sql` (5880) | CORE |
| [packages/store/src/store.ts:6084](../../packages/store/src/store.ts#L6084) `Store/wordIndex` | `Store.sql` (6084, 6092, 6097); `Store.recordCount` (6096); `SQLite.get` (6097); `SQLite.prepare` (6097) | CORE |
| [packages/store/src/store.ts:6149](../../packages/store/src/store.ts#L6149) `Store/toRecord` | `Calculations.value` (6149, 6159); `Calculations.globalValue` (6153); `Calculations.unstoredStyled` (6158) | CORE |
| [packages/store/src/store.ts:6208](../../packages/store/src/store.ts#L6208) `Store/relatedValues` | `Calculations.globalValue` (6208); `Calculations.unstoredValue` (6210) | CORE |
| [packages/store/src/store.ts:6282](../../packages/store/src/store.ts#L6282) `Store/addRelated` | `relatedRows` (6282); `rowsById` (6314); `firstRelatedEach` (6337) | CORE |
| [packages/store/src/store.ts:6365](../../packages/store/src/store.ts#L6365) `Store/foundSetPage` | `rowsById` (6365) | CORE |
| [packages/store/src/store.ts:6381](../../packages/store/src/store.ts#L6381) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6381); `Store.row` (6397) | GATED-STORE |
| [packages/store/src/store.ts:6420](../../packages/store/src/store.ts#L6420) `Store/portalCountsCurrent` | `Store.canView` (6420); `Store.row` (6447) | GATED-STORE |
| [packages/store/src/store.ts:6483](../../packages/store/src/store.ts#L6483) `Store/fieldIndexCurrent` | `SQLite.iterate` (6483); `SQLite.prepare` (6483, 6488); `Store.sql` (6483, 6488); `SQLite.all` (6488) | GATED-STORE |
| [packages/store/src/store.ts:6529](../../packages/store/src/store.ts#L6529) `Store/valueListItemsCurrent` | `Store.valueListItems` (6529); `Store.get` (6543); `relatedRows` (6544); `Store.row` (6544); `SQLite.iterate` (6546); `SQLite.prepare` (6546); `Store.sql` (6546); `Calculations.related` (6556); `Calculations.value` (6560, 6561) | GATED-STORE |
| [packages/store/src/store.ts:6658](../../packages/store/src/store.ts#L6658) `Store/portalRows` | `relatedRows` (6658); `relatedIdList` (6659); `Store.viewableIds` (6662); `rowsById` (6687, 6725); `Calculations.related` (6701) | CORE |
| [packages/store/src/store.ts:6669](../../packages/store/src/store.ts#L6669) `Store/portalRows/context` | `Calculations.context` (6669) | CORE |
| [packages/store/src/store.ts:6679](../../packages/store/src/store.ts#L6679) `Store/portalRows/valueOf` | `Calculations.value` (6679) | CORE |
| [packages/store/src/store.ts:6796](../../packages/store/src/store.ts#L6796) `Store/markRepeating` | `SQLite.prepare` (6796); `Store.sql` (6796) | CORE |
| [packages/store/src/store.ts:6823](../../packages/store/src/store.ts#L6823) `Store/externalContainerCheck` | `SQLite.all` (6823); `SQLite.prepare` (6823); `Store.sql` (6823) | CORE |
| [packages/store/src/store.ts:6830](../../packages/store/src/store.ts#L6830) `Store/externalContainerCount` | `SQLite.get` (6830); `SQLite.prepare` (6830); `Store.sql` (6830) | CORE |
| [packages/store/src/store.ts:6839](../../packages/store/src/store.ts#L6839) `Store/externalContainerReport` | `SQLite.all` (6839, 6852); `SQLite.prepare` (6839, 6852); `Store.sql` (6839, 6852) | CORE |
| [packages/store/src/store.ts:6987](../../packages/store/src/store.ts#L6987) `Store/orphanContainerReport` | `SQLite.all` (6987); `SQLite.prepare` (6987); `Store.sql` (6987) | CORE |
| [packages/store/src/store.ts:7022](../../packages/store/src/store.ts#L7022) `Store/purgeOrphanContainers` | `Store.sql` (7022, 7026, 7035, 7038, 7039, 7044, 7045, 7047, 7047); `Store.orphanContainerReport` (7030); `SQLite.get` (7035); `SQLite.prepare` (7035, 7038, 7039) | CORE |
| [packages/store/src/store.ts:7060](../../packages/store/src/store.ts#L7060) `Store/containerIntact` | `SQLite.get` (7060); `SQLite.prepare` (7060); `Store.sql` (7060) | CORE |
| [packages/store/src/store.ts:7070](../../packages/store/src/store.ts#L7070) `Store/externalOf` | `SQLite.get` (7070); `SQLite.prepare` (7070); `Store.sql` (7070) | CORE |
| [packages/store/src/store.ts:7074](../../packages/store/src/store.ts#L7074) `Store/containerMeta` | `SQLite.get` (7074); `SQLite.prepare` (7074); `Store.sql` (7074) | CORE |
| [packages/store/src/store.ts:7079](../../packages/store/src/store.ts#L7079) `Store/container` | `SQLite.get` (7079); `SQLite.prepare` (7079, 7088); `Store.sql` (7079, 7088); `SQLite.all` (7088) | CORE |
| [packages/store/src/store.ts:7096](../../packages/store/src/store.ts#L7096) `Store/containerInfo` | `SQLite.get` (7096); `SQLite.prepare` (7096); `Store.sql` (7096) | CORE |
| [packages/store/src/store.ts:7130](../../packages/store/src/store.ts#L7130) `Store/containerRange` | `SQLite.all` (7130); `SQLite.prepare` (7130, 7137); `Store.sql` (7130, 7137); `SQLite.get` (7137) | CORE |
| [packages/store/src/store.ts:7155](../../packages/store/src/store.ts#L7155) `Store/addContainer` | `SQLite.all` (7155); `SQLite.prepare` (7155, 7160, 7174, 7178, 7179); `Store.sql` (7155, 7160, 7174, 7176, 7178, 7179, 7181, 7184); `SQLite.get` (7165); `Store.containerRange` (7167) | CORE |
| [packages/store/src/store.ts:7201](../../packages/store/src/store.ts#L7201) `Store/addExternalContainer` | `SQLite.prepare` (7201); `Store.sql` (7201) | CORE |
| [packages/store/src/store.ts:7219](../../packages/store/src/store.ts#L7219) `Store/writeExternalFile` | `Store.evaluateEach` (7219); `SQLite.prepare` (7242); `Store.sql` (7242) | CORE |
| [packages/store/src/store.ts:7243](../../packages/store/src/store.ts#L7243) `Store/writeExternalFile/taken` | `SQLite.get` (7243) | CORE |
| [packages/store/src/store.ts:7272](../../packages/store/src/store.ts#L7272) `Store/embeddedContainers` | `SQLite.prepare` (7272, 7273); `Store.sql` (7272, 7273); `SQLite.all` (7273); `SQLite.get` (7277) | CORE |
| [packages/store/src/store.ts:7286](../../packages/store/src/store.ts#L7286) `Store/embeddedContainerCount` | `SQLite.prepare` (7286); `Store.sql` (7286); `SQLite.get` (7287) | CORE |
| [packages/store/src/store.ts:7295](../../packages/store/src/store.ts#L7295) `Store/recoverContainersOut` | `SQLite.prepare` (7295); `Store.sql` (7295); `SQLite.get` (7298) | CORE |
| [packages/store/src/store.ts:7320](../../packages/store/src/store.ts#L7320) `Store/moveContainersOut` | `Store.sql` (7320, 7328, 7330, 7332, 7334, 7335, 7354, 7359, 7361, 7363, 7364, 7368); `SQLite.get` (7328); `SQLite.prepare` (7328, 7334, 7335); `Store.container` (7337) | CORE |
| [packages/store/src/store.ts:7377](../../packages/store/src/store.ts#L7377) `Store/moveContainersIn` | `Store.sql` (7377, 7382, 7384, 7385, 7386, 7387, 7406, 7409, 7416, 7419, 7422, 7429); `SQLite.prepare` (7384, 7385, 7386, 7387, 7416, 7422); `SQLite.get` (7389, 7416, 7422) | CORE |
| [packages/store/src/store.ts:7441](../../packages/store/src/store.ts#L7441) `Store/compactFile` | `Store.sql` (7441, 7442, 7444) | CORE |
| [packages/store/src/store.ts:7450](../../packages/store/src/store.ts#L7450) `Store/containerId` | `Store.containerId` (7450); `Store.row` (7451) | CORE |
| [packages/store/src/store.ts:7473](../../packages/store/src/store.ts#L7473) `Store/checkContainerWrite` | `Store.row` (7473) | CORE |
| [packages/store/src/store.ts:7486](../../packages/store/src/store.ts#L7486) `Store/setContainer` | `Store.sql` (7486, 7500, 7505, 7508, 7508); `Store.row` (7489); `SQLite.prepare` (7500) | CORE |
| [packages/store/src/store.ts:7542](../../packages/store/src/store.ts#L7542) `Store/orderBy` | `Store.valueListItems` (7542) | CORE |
| [packages/store/src/store.ts:7565](../../packages/store/src/store.ts#L7565) `Store/userPrefs` | `SQLite.all` (7565); `SQLite.prepare` (7565); `Store.sql` (7565) | CORE |
| [packages/store/src/store.ts:7570](../../packages/store/src/store.ts#L7570) `Store/hasTable` | `SQLite.get` (7570); `SQLite.prepare` (7570); `Store.sql` (7570) | CORE |
| [packages/store/src/store.ts:7574](../../packages/store/src/store.ts#L7574) `Store/setUserPref` | `Store.sql` (7574, 7575, 7576); `SQLite.prepare` (7575, 7576) | CORE |
| [packages/store/src/store.ts:7582](../../packages/store/src/store.ts#L7582) `Store/indexedFields` | `SQLite.all` (7582, 7583); `SQLite.prepare` (7582, 7583); `Store.sql` (7582, 7583) | CORE |
| [packages/store/src/store.ts:7604](../../packages/store/src/store.ts#L7604) `Store/addFieldIndex` | `Store.sql` (7604) | CORE |
| [packages/store/src/store.ts:7616](../../packages/store/src/store.ts#L7616) `Store/dropFieldIndex` | `SQLite.get` (7616); `SQLite.prepare` (7616); `Store.sql` (7616, 7617) | CORE |
| [packages/store/src/store.ts:7627](../../packages/store/src/store.ts#L7627) `Store/timeFind` | `Store.query` (7627, 7631, 7632); `Store.recordCount` (7634) | CORE |
| [packages/store/src/store.ts:7651](../../packages/store/src/store.ts#L7651) `Store/find` | `Store.find` (7651) | GATED-STORE |
| [packages/store/src/store.ts:7662](../../packages/store/src/store.ts#L7662) `Store/findHere` | `Store.query` (7662, 7667, 7669, 7683, 7685, 7695); `Store.recordCount` (7680); `SQLite.get` (7681, 7685); `SQLite.prepare` (7681, 7685, 7690, 7697, 7706); `Store.sql` (7681, 7685, 7690, 7697, 7706); `SQLite.all` (7690, 7697, 7706) | GATED-STORE |
| [packages/store/src/store.ts:7701](../../packages/store/src/store.ts#L7701) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7701); `SQLite.prepare` (7701); `Store.sql` (7701) | GATED-STORE |
| [packages/store/src/store.ts:7734](../../packages/store/src/store.ts#L7734) `Store/sortedPage` | `SQLite.iterate` (7734); `SQLite.prepare` (7734, 7749); `Store.sql` (7734, 7749); `SQLite.all` (7749) | CORE |
| [packages/store/src/store.ts:7806](../../packages/store/src/store.ts#L7806) `Store/relatedCriteria/matched` | `relatedRows` (7806) | CORE |
| [packages/store/src/store.ts:7809](../../packages/store/src/store.ts#L7809) `Store/relatedCriteria` | `SQLite.iterate` (7809); `SQLite.prepare` (7809); `Store.sql` (7809) | CORE |
| [packages/store/src/store.ts:7835](../../packages/store/src/store.ts#L7835) `Store/computedRows` | `Store.sql` (7835, 7838, 7839, 7840, 7842, 7852, 7853, 7854, 7857); `SQLite.prepare` (7838, 7840, 7842, 7852); `SQLite.iterate` (7842); `Calculations.globalValue` (7845); `Calculations.unstoredValue` (7846); `Calculations.related` (7849); `SQLite.all` (7852) | CORE |
| [packages/store/src/store.ts:7882](../../packages/store/src/store.ts#L7882) `Store/summaries` | `Calculations.wholeTable` (7882); `Calculations.collect` (7902, 7907) | CORE |
| [packages/store/src/store.ts:7898](../../packages/store/src/store.ts#L7898) `Store/summaries/recs` | `SQLite.iterate` (7898); `SQLite.prepare` (7898); `Store.sql` (7898) | CORE |
| [packages/store/src/store.ts:7920](../../packages/store/src/store.ts#L7920) `Store/runningSummaryValues` | `Store.viewableIds` (7920); `rowsById` (7922); `Calculations.value` (7933, 7939); `Calculations.related` (7950) | GATED-STORE |
| [packages/store/src/store.ts:7963](../../packages/store/src/store.ts#L7963) `Store/findSource` | `Store.query` (7963); `Store.sql` (7970, 7971, 7975, 7977, 7988, 7990); `SQLite.prepare` (7971, 7977); `SQLite.iterate` (7977); `Calculations.globalValue` (7981); `Calculations.unstoredValue` (7982); `Calculations.related` (7986) | CORE |
| [packages/store/src/store.ts:8009](../../packages/store/src/store.ts#L8009) `Store/previewRow` | `Store.row` (8009) | CORE |
| [packages/store/src/store.ts:8027](../../packages/store/src/store.ts#L8027) `Store/row` | `SQLite.get` (8027) | CORE |
| [packages/store/src/store.ts:8046](../../packages/store/src/store.ts#L8046) `Store/getCurrent` | `Store.get` (8046); `Store.row` (8047, 8047, 8061); `SQLite.all` (8064); `SQLite.prepare` (8064); `Store.sql` (8064) | GATED-STORE |
| [packages/store/src/store.ts:8084](../../packages/store/src/store.ts#L8084) `Store/getManyCurrent` | `Store.getMany` (8084); `SQLite.get` (8102); `SQLite.prepare` (8102); `Store.sql` (8102) | GATED-STORE |
| [packages/store/src/store.ts:8095](../../packages/store/src/store.ts#L8095) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (8095) | GATED-STORE |
| [packages/store/src/store.ts:8118](../../packages/store/src/store.ts#L8118) `Store/canViewRecord` | `SQLite.get` (8118); `SQLite.prepare` (8118); `Store.sql` (8118) | GATED-STORE |
| [packages/store/src/store.ts:8126](../../packages/store/src/store.ts#L8126) `Store/canView` | `Store.canView` (8126); `Store.row` (8127) | GATED-STORE |
| [packages/store/src/store.ts:8151](../../packages/store/src/store.ts#L8151) `Store/create` | `SQLite.get` (8151, 8157); `SQLite.prepare` (8151, 8157, 8169); `Store.sql` (8151, 8157, 8169) | CORE |
| [packages/store/src/store.ts:8193](../../packages/store/src/store.ts#L8193) `Store/duplicate` | `Store.row` (8193); `SQLite.get` (8197); `SQLite.prepare` (8197, 8211); `Store.sql` (8197, 8211) | CORE |
| [packages/store/src/store.ts:8256](../../packages/store/src/store.ts#L8256) `Store/update` | `Store.row` (8256, 8263, 8274); `Store.sql` (8287, 8288, 8325, 8328) | CORE |
| [packages/store/src/store.ts:8290](../../packages/store/src/store.ts#L8290) `Store/update/undo` | `Store.sql` (8290) | CORE |
| [packages/store/src/store.ts:8432](../../packages/store/src/store.ts#L8432) `Store/setStoredCalcValues` | `SQLite.prepare` (8432, 8433); `Store.sql` (8432, 8433); `SQLite.get` (8437) | CORE |
| [packages/store/src/store.ts:8511](../../packages/store/src/store.ts#L8511) `Store/evaluateCurrent` | `Store.row` (8511, 8511); `Calculations.context` (8512); `Store.get` (8513, 8515) | GATED-STORE |
| [packages/store/src/store.ts:8547](../../packages/store/src/store.ts#L8547) `Store/evaluateEachCurrent` | `Store.row` (8547, 8547); `Calculations.context` (8552); `Store.get` (8554) | GATED-STORE |
| [packages/store/src/store.ts:8587](../../packages/store/src/store.ts#L8587) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8587); `Store.get` (8589) | GATED-STORE |
| [packages/store/src/store.ts:8608](../../packages/store/src/store.ts#L8608) `Store/evaluateRowsCurrent` | `Store.row` (8608, 8608) | GATED-STORE |
| [packages/store/src/store.ts:8622](../../packages/store/src/store.ts#L8622) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8622) | GATED-STORE |
| [packages/store/src/store.ts:8644](../../packages/store/src/store.ts#L8644) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8644) | GATED-STORE |
| [packages/store/src/store.ts:8682](../../packages/store/src/store.ts#L8682) `Store/updateRelated` | `relatedRows` (8682) | CORE |
| [packages/store/src/store.ts:8700](../../packages/store/src/store.ts#L8700) `Store/updatePortals` | `Store.row` (8700, 8735); `relatedRows` (8736) | CORE |
| [packages/store/src/store.ts:8709](../../packages/store/src/store.ts#L8709) `Store/updatePortals/portal/related` | `relatedIdList` (8709) | CORE |
| [packages/store/src/store.ts:8791](../../packages/store/src/store.ts#L8791) `Store/portalContainerTarget` | `Store.row` (8791); `relatedIdList` (8792) | CORE |
| [packages/store/src/store.ts:8805](../../packages/store/src/store.ts#L8805) `Store/checkEditable` | `Store.row` (8805) | CORE |
| [packages/store/src/store.ts:8828](../../packages/store/src/store.ts#L8828) `Store/delete` | `Store.row` (8828); `SQLite.get` (8833); `SQLite.prepare` (8833, 8835); `Store.sql` (8833, 8835) | CORE |
| [packages/store/src/store.ts:8856](../../packages/store/src/store.ts#L8856) `Store/vaultHeld` | `SQLite.get` (8856); `SQLite.prepare` (8856); `Store.sql` (8856) | CORE |
| [packages/store/src/store.ts:8863](../../packages/store/src/store.ts#L8863) `Store/forgetStandInValues` | `Store.sql` (8863, 8884); `SQLite.prepare` (8884) | CORE |
| [packages/store/src/store.ts:8898](../../packages/store/src/store.ts#L8898) `Store/restoreDeletedRow` | `SQLite.get` (8898); `SQLite.prepare` (8898, 8899, 8902); `Store.sql` (8898, 8899, 8902); `SQLite.all` (8899) | CORE |
| [packages/store/src/store.ts:8926](../../packages/store/src/store.ts#L8926) `Store/cascadeDelete` | `relatedRows` (8926) | CORE |
| [packages/store/src/store.ts:9016](../../packages/store/src/store.ts#L9016) `Store/selectIdsCurrent` | `Store.selectIds` (9016); `SQLite.all` (9022); `SQLite.prepare` (9022); `Store.sql` (9022) | GATED-STORE |
| [packages/store/src/store.ts:9030](../../packages/store/src/store.ts#L9030) `Store/countIds` | `Store.countIds` (9030); `SQLite.get` (9034); `SQLite.prepare` (9034); `Store.sql` (9034) | GATED-STORE |
| [packages/store/src/store.ts:9050](../../packages/store/src/store.ts#L9050) `Store/computeValuesCurrent` | `Store.computeValues` (9050); `Store.sql` (9056, 9060); `SQLite.all` (9060); `SQLite.prepare` (9060) | GATED-STORE |
| [packages/store/src/store.ts:9075](../../packages/store/src/store.ts#L9075) `Store/findIdsCurrent` | `Store.findIds` (9075) | GATED-STORE |
| [packages/store/src/store.ts:9081](../../packages/store/src/store.ts#L9081) `Store/findIdsHere` | `Store.query` (9081, 9086, 9088); `SQLite.iterate` (9099); `SQLite.prepare` (9099); `Store.sql` (9099) | GATED-STORE |
| [packages/store/src/store.ts:9116](../../packages/store/src/store.ts#L9116) `Store/groupSummariesCurrent` | `Store.groupSummaries` (9116); `Store.viewableIds` (9121); `Calculations.collect` (9137); `rowsById` (9137, 9187); `Calculations.collector` (9159) | GATED-STORE |
| [packages/store/src/store.ts:9149](../../packages/store/src/store.ts#L9149) `Store/groupSummariesCurrent/key` | `Calculations.value` (9149); `Calculations.related` (9151) | GATED-STORE |
| [packages/store/src/store.ts:9185](../../packages/store/src/store.ts#L9185) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (9185) | GATED-STORE |
| [packages/store/src/store.ts:9241](../../packages/store/src/store.ts#L9241) `Store/sortIdsCurrentProgress` | `SQLite.all` (9241); `SQLite.prepare` (9241, 9309); `Store.sql` (9241, 9309); `Store.valueListItems` (9249); `rowsById` (9261); `Calculations.globalValue` (9264); `Calculations.unstoredValue` (9265); `Calculations.related` (9271); `SQLite.iterate` (9309) | GATED-STORE |
| [packages/store/src/store.ts:9323](../../packages/store/src/store.ts#L9323) `Store/matchIds` | `Store.matchIds` (9323); `SQLite.all` (9329); `SQLite.prepare` (9329); `Store.sql` (9329) | CORE |
| [packages/store/src/store.ts:9347](../../packages/store/src/store.ts#L9347) `Store/truncate` | `Store.sql` (9347, 9349, 9356, 9357, 9359, 9360); `SQLite.prepare` (9349, 9356); `SQLite.all` (9351) | CORE |
| [packages/store/src/store.ts:9381](../../packages/store/src/store.ts#L9381) `Store/iterateCommitted` | `SQLite.iterate` (9381) | CORE |
| [packages/store/src/store.ts:9415](../../packages/store/src/store.ts#L9415) `Store/readOnlyChecked` | `SQLite.prepare` (9415, 9419, 9428, 9433); `SQLite.all` (9419, 9428, 9433) | CORE |
| [packages/store/src/store.ts:9455](../../packages/store/src/store.ts#L9455) `Store/refreshDecimalSqlViews` | `SQLite.get` (9455); `SQLite.prepare` (9455, 9460); `SQLite.all` (9460) | CORE |
| [packages/store/src/store.ts:9474](../../packages/store/src/store.ts#L9474) `Store/internalRoots` | `SQLite.get` (9474); `SQLite.prepare` (9474, 9476); `SQLite.all` (9476) | CORE |
| [packages/store/src/store.ts:9509](../../packages/store/src/store.ts#L9509) `Store/selectCurrent` | `SQLite.iterate` (9509) | CORE |
| [packages/store/src/store.ts:9530](../../packages/store/src/store.ts#L9530) `Store/query` | `SQLite.iterate` (9530) | CORE |
| [packages/store/src/store.ts:9564](../../packages/store/src/store.ts#L9564) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9564); `SQLite.all` (9571, 9574); `SQLite.prepare` (9571, 9574) | CORE |
| [packages/store/src/store.ts:1183](../../packages/store/src/store.ts#L1183) `Store/ensureNativeIds` | `SQLite.all` (1183, 1195); `SQLite.prepare` (1183, 1186, 1194, 1195); `Store.sql` (1183, 1186, 1189, 1193, 1194, 1195, 1198, 1200) | CORE |
| [packages/store/src/store.ts:1208](../../packages/store/src/store.ts#L1208) `Store/nativeIdGuards` | `Store.sql` (1208, 1209, 1211) | CORE |
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
| [packages/store/src/store.ts:6902](../../packages/store/src/store.ts#L6902) `Store/containerReferences` | `SQLite.all` (6902, 6920, 6922, 6928, 6941, 6952, 6966); `SQLite.prepare` (6902, 6920, 6922, 6928, 6941, 6952, 6964, 6966); `Store.sql` (6902, 6920, 6922, 6928, 6941, 6952, 6964, 6966); `SQLite.get` (6964); `Store.row` (6975) | CORE |
| [packages/store/src/store.ts:6999](../../packages/store/src/store.ts#L6999) `Store/containerIntegrityReport` | `SQLite.all` (6999); `SQLite.prepare` (6999, 7010); `Store.sql` (6999, 7010); `SQLite.get` (7010) | CORE |
<!-- end generated read-gate inventory -->
