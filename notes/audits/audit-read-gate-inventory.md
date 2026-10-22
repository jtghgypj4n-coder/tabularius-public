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
| [packages/cli/src/main.ts:2254](../../packages/cli/src/main.ts#L2254) `main` | `Store.orphanContainerReport` (2254); `Store.auditLog` (2717); `SQLite.get` (2933); `SQLite.prepare` (2933) | OPERATOR |
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
| [packages/server/src/oauth.ts:61](../../packages/server/src/oauth.ts#L61) `storedName` | `SQLite.get` (61); `SQLite.prepare` (61); `Store.sql` (61) | AUTH |
| [packages/server/src/oauth.ts:72](../../packages/server/src/oauth.ts#L72) `legacyPasswordMark` | `SQLite.get` (72); `SQLite.prepare` (72); `Store.sql` (72) | AUTH |
| [packages/server/src/oauth.ts:188](../../packages/server/src/oauth.ts#L188) `OAuthServer/constructor/cols` | `SQLite.all` (188); `SQLite.prepare` (188) | AUTH |
| [packages/server/src/oauth.ts:194](../../packages/server/src/oauth.ts#L194) `OAuthServer/constructor` | `SQLite.all` (194); `SQLite.prepare` (194, 214, 216, 219, 220, 223); `SQLite.iterate` (214); `SQLite.get` (216); `Store.sql` (216, 219) | AUTH |
| [packages/server/src/oauth.ts:354](../../packages/server/src/oauth.ts#L354) `OAuthServer/register` | `SQLite.prepare` (354, 355, 356, 357, 360); `SQLite.get` (355, 357) | AUTH |
| [packages/server/src/oauth.ts:371](../../packages/server/src/oauth.ts#L371) `OAuthServer/client` | `SQLite.get` (371); `SQLite.prepare` (371) | AUTH |
| [packages/server/src/oauth.ts:461](../../packages/server/src/oauth.ts#L461) `OAuthServer/authorize/done` | `SQLite.prepare` (461, 462) | AUTH |
| [packages/server/src/oauth.ts:479](../../packages/server/src/oauth.ts#L479) `OAuthServer/authorize` | `SQLite.get` (479); `SQLite.prepare` (479, 483, 485, 492, 515, 516) | AUTH |
| [packages/server/src/oauth.ts:660](../../packages/server/src/oauth.ts#L660) `OAuthServer/token` | `SQLite.get` (660); `SQLite.prepare` (660) | AUTH |
| [packages/server/src/oauth.ts:789](../../packages/server/src/oauth.ts#L789) `OAuthServer/issue` | `SQLite.prepare` (789, 790) | AUTH |
| [packages/server/src/oauth.ts:799](../../packages/server/src/oauth.ts#L799) `OAuthServer/sweep` | `SQLite.all` (799); `SQLite.prepare` (799, 801, 802, 803) | AUTH |
| [packages/server/src/oauth.ts:814](../../packages/server/src/oauth.ts#L814) `OAuthServer/revoke` | `SQLite.get` (814, 819); `SQLite.prepare` (814, 819) | AUTH |
| [packages/server/src/oauth.ts:236](../../packages/server/src/oauth.ts#L236) `OAuthServer/expireRetriesSoon` | `SQLite.prepare` (236, 237); `SQLite.get` (237) | AUTH |
| [packages/server/src/oauth.ts:690](../../packages/server/src/oauth.ts#L690) `OAuthServer/rotateRefresh` | `SQLite.get` (690, 692); `SQLite.prepare` (690, 692, 719, 720) | AUTH |
| [packages/server/src/oauth.ts:734](../../packages/server/src/oauth.ts#L734) `OAuthServer/retryRefresh` | `SQLite.get` (734); `SQLite.prepare` (734) | AUTH |
| [packages/server/src/oauth.ts:751](../../packages/server/src/oauth.ts#L751) `OAuthServer/revokeFamily` | `SQLite.all` (751); `SQLite.prepare` (751, 753) | AUTH |
| [packages/server/src/oauth.ts:775](../../packages/server/src/oauth.ts#L775) `OAuthServer/rotateEligible` | `SQLite.prepare` (775, 776, 777) | AUTH |
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
| [packages/store/src/store.ts:869](../../packages/store/src/store.ts#L869) `Store/metadataVersions` | `SQLite.get` (869); `SQLite.prepare` (869); `Store.sql` (869) | CORE |
| [packages/store/src/store.ts:978](../../packages/store/src/store.ts#L978) `Store/constructor` | `Store.sql` (978, 980, 982, 983, 987, 991, 992, 1003, 1008, 1013, 1014, 1018, 1019, 1020, 1027, 1031, 1035, 1036, 1037, 1041, 1045, 1048, 1049, 1051, 1052, 1055, 1056, 1060, 1061, 1065, 1066, 1069, 1071, 1074, 1075, 1079, 1080, 1084, 1085, 1088, 1089, 1090, 1093, 1094, 1097, 1098, 1100, 1100, 1101, 1101, 1102, 1105, 1109, 1111, 1114, 1115, 1116, 1119, 1120, 1122, 1124, 1125, 1130, 1131, 1132, 1132, 1136, 1137); `SQLite.get` (982); `SQLite.prepare` (982, 1048, 1049, 1052, 1055, 1060, 1065, 1074, 1079, 1084, 1093, 1097, 1100, 1101, 1119, 1124); `SQLite.all` (1048, 1055, 1060, 1065, 1074, 1079, 1084, 1093, 1097, 1100, 1101, 1119, 1124) | CORE |
| [packages/store/src/store.ts:1156](../../packages/store/src/store.ts#L1156) `Store/grantFullAccessClients` | `SQLite.prepare` (1156); `Store.sql` (1156) | CORE |
| [packages/store/src/store.ts:1173](../../packages/store/src/store.ts#L1173) `Store/meta` | `SQLite.get` (1173); `SQLite.prepare` (1173); `Store.sql` (1173) | CORE |
| [packages/store/src/store.ts:1181](../../packages/store/src/store.ts#L1181) `Store/persistentTable` | `Store.sql` (1181) | CORE |
| [packages/store/src/store.ts:1191](../../packages/store/src/store.ts#L1191) `Store/persistentData` | `SQLite.get` (1191) | CORE |
| [packages/store/src/store.ts:1200](../../packages/store/src/store.ts#L1200) `Store/persistentDataIds` | `SQLite.all` (1200) | CORE |
| [packages/store/src/store.ts:1206](../../packages/store/src/store.ts#L1206) `Store/setPersistentData` | `SQLite.prepare` (1206, 1210); `Store.sql` (1206, 1210) | CORE |
| [packages/store/src/store.ts:1223](../../packages/store/src/store.ts#L1223) `Store/checkpoint` | `SQLite.get` (1223); `SQLite.prepare` (1223); `Store.sql` (1223) | CORE |
| [packages/store/src/store.ts:1231](../../packages/store/src/store.ts#L1231) `Store/recordedFormat` | `Store.sql` (1231) | CORE |
| [packages/store/src/store.ts:1241](../../packages/store/src/store.ts#L1241) `Store/close` | `Store.sql` (1241) | CORE |
| [packages/store/src/store.ts:1257](../../packages/store/src/store.ts#L1257) `Store/shipWal` | `Store.sql` (1257) | CORE |
| [packages/store/src/store.ts:1268](../../packages/store/src/store.ts#L1268) `Store/trial` | `Store.sql` (1268) | CORE |
| [packages/store/src/store.ts:1273](../../packages/store/src/store.ts#L1273) `Store/trial/undo` | `Store.sql` (1273) | CORE |
| [packages/store/src/store.ts:1308](../../packages/store/src/store.ts#L1308) `Store/joinTransaction` | `Store.sql` (1308, 1309, 1311, 1313, 1319) | CORE |
| [packages/store/src/store.ts:1331](../../packages/store/src/store.ts#L1331) `Store/independentWindowWrite` | `SQLite.get` (1331); `SQLite.prepare` (1331, 1354); `Store.sql` (1331, 1334, 1349, 1354, 1357) | CORE |
| [packages/store/src/store.ts:1379](../../packages/store/src/store.ts#L1379) `Store/withWriteTransaction` | `Store.sql` (1379, 1382, 1386, 1388, 1388) | CORE |
| [packages/store/src/store.ts:1418](../../packages/store/src/store.ts#L1418) `Store/endTransaction` | `Store.sql` (1418, 1421, 1421) | CORE |
| [packages/store/src/store.ts:1440](../../packages/store/src/store.ts#L1440) `Store/backup` | `Store.sql` (1440) | CORE |
| [packages/store/src/store.ts:1455](../../packages/store/src/store.ts#L1455) `Store/dataVersion` | `SQLite.get` (1455); `SQLite.prepare` (1455); `Store.sql` (1455) | CORE |
| [packages/store/src/store.ts:1495](../../packages/store/src/store.ts#L1495) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1495) | CORE |
| [packages/store/src/store.ts:1516](../../packages/store/src/store.ts#L1516) `Store/shareResults` | `Store.sql` (1516) | CORE |
| [packages/store/src/store.ts:1526](../../packages/store/src/store.ts#L1526) `Store/versionTriggers` | `SQLite.get` (1526); `SQLite.prepare` (1526, 1531, 1532); `Store.sql` (1526, 1528, 1529, 1531, 1532, 1541, 1542); `SQLite.all` (1531, 1532) | CORE |
| [packages/store/src/store.ts:1558](../../packages/store/src/store.ts#L1558) `Store/versionNumber` | `SQLite.get` (1558); `SQLite.prepare` (1558); `Store.sql` (1558) | CORE |
| [packages/store/src/store.ts:1571](../../packages/store/src/store.ts#L1571) `Store/changeOne` | `Store.sql` (1571, 1573) | CORE |
| [packages/store/src/store.ts:1574](../../packages/store/src/store.ts#L1574) `Store/changeOne/read` | `SQLite.get` (1574); `SQLite.prepare` (1574); `Store.sql` (1574) | CORE |
| [packages/store/src/store.ts:1613](../../packages/store/src/store.ts#L1613) `Store/writeToken` | `SQLite.get` (1613); `SQLite.prepare` (1613); `Store.sql` (1613) | CORE |
| [packages/store/src/store.ts:1625](../../packages/store/src/store.ts#L1625) `Store/recordCount` | `SQLite.get` (1625); `SQLite.prepare` (1625); `Store.sql` (1625) | CORE |
| [packages/store/src/store.ts:1733](../../packages/store/src/store.ts#L1733) `Store/applyDesign` | `Store.sql` (1733, 1734, 1745, 1748, 1753, 1765, 1768, 1768); `SQLite.prepare` (1748, 1753) | CORE |
| [packages/store/src/store.ts:1826](../../packages/store/src/store.ts#L1826) `Store/auditLog` | `SQLite.all` (1826); `SQLite.prepare` (1826); `Store.sql` (1826) | CORE |
| [packages/store/src/store.ts:1866](../../packages/store/src/store.ts#L1866) `Store/securityEvents` | `Store.auditLog` (1866) | CORE |
| [packages/store/src/store.ts:1892](../../packages/store/src/store.ts#L1892) `Store/prepared` | `SQLite.prepare` (1892); `Store.sql` (1892) | CORE |
| [packages/store/src/store.ts:1907](../../packages/store/src/store.ts#L1907) `Store/recordAsOf` | `SQLite.get` (1907, 1909); `SQLite.prepare` (1907, 1909, 1911, 1912); `Store.sql` (1907, 1909, 1911, 1912); `SQLite.all` (1911, 1912) | CORE |
| [packages/store/src/store.ts:1937](../../packages/store/src/store.ts#L1937) `Store/restoreRecord` | `Store.recordAsOf` (1937); `SQLite.get` (1941); `SQLite.prepare` (1941, 1944, 1951, 1958); `Store.sql` (1941, 1944, 1951, 1958) | CORE |
| [packages/store/src/store.ts:1972](../../packages/store/src/store.ts#L1972) `Store/revertAuditEntry` | `Store.auditLog` (1972) | CORE |
| [packages/store/src/store.ts:2065](../../packages/store/src/store.ts#L2065) `Store/setAuditSettings` | `SQLite.prepare` (2065); `Store.sql` (2065) | CORE |
| [packages/store/src/store.ts:2087](../../packages/store/src/store.ts#L2087) `Store/pruneAudit` | `Store.sql` (2087, 2089, 2091); `SQLite.get` (2089); `SQLite.prepare` (2089) | CORE |
| [packages/store/src/store.ts:2169](../../packages/store/src/store.ts#L2169) `Store/audit` | `Store.sql` (2169) | CORE |
| [packages/store/src/store.ts:2258](../../packages/store/src/store.ts#L2258) `Store/securityChange` | `Store.sql` (2258, 2260); `SQLite.prepare` (2260) | CORE |
| [packages/store/src/store.ts:2307](../../packages/store/src/store.ts#L2307) `Store/logSecurity` | `Store.sql` (2307) | CORE |
| [packages/store/src/store.ts:2330](../../packages/store/src/store.ts#L2330) `Store/ensureDeleted` | `Store.sql` (2330) | CORE |
| [packages/store/src/store.ts:2335](../../packages/store/src/store.ts#L2335) `Store/deletedRows` | `SQLite.get` (2335); `SQLite.prepare` (2335, 2337, 2337); `Store.sql` (2335, 2337, 2337); `SQLite.all` (2337, 2337) | CORE |
| [packages/store/src/store.ts:2361](../../packages/store/src/store.ts#L2361) `Store/emptyDeleted` | `Store.sql` (2361, 2364, 2365, 2367, 2369); `SQLite.prepare` (2365) | CORE |
| [packages/store/src/store.ts:2376](../../packages/store/src/store.ts#L2376) `Store/designHistory` | `SQLite.all` (2376); `SQLite.prepare` (2376); `Store.sql` (2376) | CORE |
| [packages/store/src/store.ts:2383](../../packages/store/src/store.ts#L2383) `Store/scriptHistory` | `SQLite.all` (2383); `SQLite.prepare` (2383); `Store.sql` (2383) | CORE |
| [packages/store/src/store.ts:2393](../../packages/store/src/store.ts#L2393) `Store/layoutHistory` | `SQLite.all` (2393); `SQLite.prepare` (2393); `Store.sql` (2393) | CORE |
| [packages/store/src/store.ts:2418](../../packages/store/src/store.ts#L2418) `Store/designEffect/renameKey` | `SQLite.prepare` (2418); `Store.sql` (2418) | CORE |
| [packages/store/src/store.ts:2434](../../packages/store/src/store.ts#L2434) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2434); `Store.sql` (2434) | CORE |
| [packages/store/src/store.ts:2441](../../packages/store/src/store.ts#L2441) `Store/designEffect` | `Store.sql` (2441, 2445, 2450, 2455, 2458, 2464, 2472, 2473, 2475, 2487, 2488, 2491, 2493, 2499, 2500, 2501, 2506, 2508, 2512, 2515, 2516, 2518, 2521, 2526, 2528, 2535, 2536, 2538, 2539, 2540, 2541, 2548, 2549, 2551, 2551, 2553, 2554, 2555, 2559, 2563, 2565, 2603, 2605, 2607); `SQLite.get` (2472, 2487, 2499, 2500, 2512, 2516, 2551, 2559); `SQLite.prepare` (2472, 2473, 2487, 2488, 2499, 2500, 2506, 2508, 2512, 2516, 2526, 2528, 2541, 2548, 2549, 2551, 2553, 2555, 2559, 2563); `SQLite.all` (2548, 2549); `SQLite.iterate` (2553) | CORE |
| [packages/store/src/store.ts:2615](../../packages/store/src/store.ts#L2615) `Store/dropColumnIndexes` | `SQLite.all` (2615, 2617); `SQLite.prepare` (2615, 2617); `Store.sql` (2615, 2617, 2618) | CORE |
| [packages/store/src/store.ts:2627](../../packages/store/src/store.ts#L2627) `Store/recompute` | `SQLite.prepare` (2627, 2631); `Store.sql` (2627, 2631); `SQLite.iterate` (2631); `Calculations.computeStoredStyled` (2632); `Calculations.value` (2632) | CORE |
| [packages/store/src/store.ts:2647](../../packages/store/src/store.ts#L2647) `Store/linkPrincipal` | `SQLite.get` (2647); `SQLite.prepare` (2647); `Store.sql` (2647) | CORE |
| [packages/store/src/store.ts:2654](../../packages/store/src/store.ts#L2654) `Store/linkIdentity` | `SQLite.get` (2654); `SQLite.prepare` (2654); `Store.sql` (2654) | CORE |
| [packages/store/src/store.ts:2660](../../packages/store/src/store.ts#L2660) `Store/accountsSharingLockout` | `SQLite.all` (2660); `SQLite.prepare` (2660); `Store.sql` (2660) | CORE |
| [packages/store/src/store.ts:2664](../../packages/store/src/store.ts#L2664) `Store/accounts` | `SQLite.all` (2664); `SQLite.prepare` (2664); `Store.sql` (2664) | CORE |
| [packages/store/src/store.ts:2676](../../packages/store/src/store.ts#L2676) `Store/isAgent` | `SQLite.get` (2676); `SQLite.prepare` (2676); `Store.sql` (2676) | CORE |
| [packages/store/src/store.ts:2682](../../packages/store/src/store.ts#L2682) `Store/agentNeedsApproval` | `SQLite.get` (2682); `SQLite.prepare` (2682); `Store.sql` (2682) | CORE |
| [packages/store/src/store.ts:2688](../../packages/store/src/store.ts#L2688) `Store/blankPasswordAccounts` | `SQLite.all` (2688); `SQLite.prepare` (2688); `Store.sql` (2688) | CORE |
| [packages/store/src/store.ts:1164](../../packages/store/src/store.ts#L1164) `Store/hasOwnPassword` | `SQLite.get` (1164); `SQLite.prepare` (1164); `Store.sql` (1164) | CORE |
| [packages/store/src/store.ts:2699](../../packages/store/src/store.ts#L2699) `Store/unmigratedAccounts` | `SQLite.all` (2699); `SQLite.prepare` (2699); `Store.sql` (2699) | CORE |
| [packages/store/src/store.ts:2752](../../packages/store/src/store.ts#L2752) `Store/setExternalAccount` | `SQLite.get` (2752); `SQLite.prepare` (2752, 2757); `Store.sql` (2752, 2757) | CORE |
| [packages/store/src/store.ts:2770](../../packages/store/src/store.ts#L2770) `Store/refuseLookalikeAccount` | `SQLite.all` (2770); `SQLite.prepare` (2770); `Store.sql` (2770) | CORE |
| [packages/store/src/store.ts:2779](../../packages/store/src/store.ts#L2779) `Store/isExternal` | `SQLite.get` (2779); `SQLite.prepare` (2779); `Store.sql` (2779) | CORE |
| [packages/store/src/store.ts:2800](../../packages/store/src/store.ts#L2800) `Store/setAgentAccount` | `SQLite.get` (2800); `SQLite.prepare` (2800, 2806); `Store.sql` (2800, 2806) | CORE |
| [packages/store/src/store.ts:2840](../../packages/store/src/store.ts#L2840) `Store/gateAgentWrite` | `SQLite.prepare` (2840); `Store.sql` (2840) | CORE |
| [packages/store/src/store.ts:2862](../../packages/store/src/store.ts#L2862) `Store/pendingChanges` | `SQLite.all` (2862); `SQLite.prepare` (2862); `Store.sql` (2862) | CORE |
| [packages/store/src/store.ts:2876](../../packages/store/src/store.ts#L2876) `Store/approvePending` | `SQLite.get` (2876); `SQLite.prepare` (2876, 2887); `Store.sql` (2876, 2887) | CORE |
| [packages/store/src/store.ts:2897](../../packages/store/src/store.ts#L2897) `Store/rejectPending` | `SQLite.get` (2897); `SQLite.prepare` (2897, 2899); `Store.sql` (2897, 2899) | CORE |
| [packages/store/src/store.ts:2919](../../packages/store/src/store.ts#L2919) `Store/externalAccount` | `SQLite.all` (2919); `SQLite.prepare` (2919); `Store.sql` (2919) | CORE |
| [packages/store/src/store.ts:2950](../../packages/store/src/store.ts#L2950) `Store/setPassword` | `SQLite.get` (2950); `SQLite.prepare` (2950, 2952, 2961); `Store.sql` (2950, 2952, 2961) | AUTH |
| [packages/store/src/store.ts:2975](../../packages/store/src/store.ts#L2975) `Store/createAccount` | `SQLite.get` (2975); `SQLite.prepare` (2975, 2979, 2985, 2990, 2995); `Store.sql` (2975, 2979, 2985, 2990, 2995) | CORE |
| [packages/store/src/store.ts:3003](../../packages/store/src/store.ts#L3003) `Store/appendSecurityEvent` | `Store.sql` (3003) | CORE |
| [packages/store/src/store.ts:3045](../../packages/store/src/store.ts#L3045) `Store/setPasswordPolicy` | `SQLite.prepare` (3045); `Store.sql` (3045) | CORE |
| [packages/store/src/store.ts:3081](../../packages/store/src/store.ts#L3081) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3081); `Store.sql` (3081) | CORE |
| [packages/store/src/store.ts:3104](../../packages/store/src/store.ts#L3104) `Store/saveScriptTest` | `SQLite.prepare` (3104); `Store.sql` (3104) | CORE |
| [packages/store/src/store.ts:3113](../../packages/store/src/store.ts#L3113) `Store/deleteScriptTest` | `SQLite.prepare` (3113); `Store.sql` (3113) | CORE |
| [packages/store/src/store.ts:3148](../../packages/store/src/store.ts#L3148) `Store/setAiAllowed` | `SQLite.prepare` (3148); `Store.sql` (3148) | CORE |
| [packages/store/src/store.ts:3159](../../packages/store/src/store.ts#L3159) `Store/setAiPolicy` | `SQLite.prepare` (3159); `Store.sql` (3159) | CORE |
| [packages/store/src/store.ts:3179](../../packages/store/src/store.ts#L3179) `Store/setPiiIsolation` | `SQLite.prepare` (3179); `Store.sql` (3179) | CORE |
| [packages/store/src/store.ts:3201](../../packages/store/src/store.ts#L3201) `Store/markPiiField` | `SQLite.prepare` (3201); `Store.sql` (3201) | CORE |
| [packages/store/src/store.ts:3315](../../packages/store/src/store.ts#L3315) `Store/lastSignIns` | `Store.auditLog` (3315) | CORE |
| [packages/store/src/store.ts:3518](../../packages/store/src/store.ts#L3518) `Store/unusualAccess` | `Store.auditLog` (3518, 3584) | CORE |
| [packages/store/src/store.ts:3615](../../packages/store/src/store.ts#L3615) `Store/leastPrivilege` | `SQLite.all` (3615); `SQLite.prepare` (3615); `Store.sql` (3615) | CORE |
| [packages/store/src/store.ts:3688](../../packages/store/src/store.ts#L3688) `Store/unusedAccess` | `SQLite.get` (3688); `SQLite.prepare` (3688, 3697); `Store.sql` (3688, 3697); `SQLite.all` (3697) | CORE |
| [packages/store/src/store.ts:3736](../../packages/store/src/store.ts#L3736) `Store/unusedObjects` | `SQLite.get` (3736); `SQLite.prepare` (3736, 3739); `Store.sql` (3736, 3739); `SQLite.all` (3739) | CORE |
| [packages/store/src/store.ts:3774](../../packages/store/src/store.ts#L3774) `Store/usageCounting` | `SQLite.get` (3774); `SQLite.prepare` (3774); `Store.sql` (3774) | CORE |
| [packages/store/src/store.ts:3782](../../packages/store/src/store.ts#L3782) `Store/setMustChangePassword` | `SQLite.prepare` (3782); `Store.sql` (3782) | CORE |
| [packages/store/src/store.ts:3796](../../packages/store/src/store.ts#L3796) `Store/mustChangePassword` | `SQLite.get` (3796); `SQLite.prepare` (3796); `Store.sql` (3796) | CORE |
| [packages/store/src/store.ts:3835](../../packages/store/src/store.ts#L3835) `Store/passwordDaysRemaining` | `SQLite.get` (3835); `SQLite.prepare` (3835); `Store.sql` (3835) | CORE |
| [packages/store/src/store.ts:3842](../../packages/store/src/store.ts#L3842) `Store/importAccounts` | `SQLite.all` (3842); `SQLite.prepare` (3842); `Store.sql` (3842) | CORE |
| [packages/store/src/store.ts:3865](../../packages/store/src/store.ts#L3865) `Store/canonicalAccount` | `SQLite.all` (3865); `SQLite.prepare` (3865); `Store.sql` (3865) | CORE |
| [packages/store/src/store.ts:3877](../../packages/store/src/store.ts#L3877) `Store/createLocalAccount` | `SQLite.prepare` (3877); `Store.sql` (3877) | CORE |
| [packages/store/src/store.ts:3907](../../packages/store/src/store.ts#L3907) `Store/previewAccountImport` | `Store.sql` (3907, 3908, 3917) | CORE |
| [packages/store/src/store.ts:3925](../../packages/store/src/store.ts#L3925) `Store/limitAccountImport` | `SQLite.prepare` (3925, 3926, 3929); `Store.sql` (3925, 3926, 3929); `SQLite.get` (3926) | CORE |
| [packages/store/src/store.ts:3936](../../packages/store/src/store.ts#L3936) `Store/applyAccountImport` | `Store.sql` (3936, 3944, 3973); `SQLite.get` (3944); `SQLite.prepare` (3944, 3973) | CORE |
| [packages/store/src/store.ts:3998](../../packages/store/src/store.ts#L3998) `Store/forgetStandIns` | `SQLite.prepare` (3998); `Store.sql` (3998) | CORE |
| [packages/store/src/store.ts:4031](../../packages/store/src/store.ts#L4031) `Store/deleteAccount` | `SQLite.prepare` (4031, 4032, 4033, 4035, 4039); `Store.sql` (4031, 4032, 4033, 4035, 4039) | CORE |
| [packages/store/src/store.ts:4056](../../packages/store/src/store.ts#L4056) `Store/setAccountActive` | `SQLite.prepare` (4056, 4059, 4060); `Store.sql` (4056, 4059, 4060) | AUTH |
| [packages/store/src/store.ts:4070](../../packages/store/src/store.ts#L4070) `Store/accountInactive` | `SQLite.get` (4070); `SQLite.prepare` (4070); `Store.sql` (4070) | CORE |
| [packages/store/src/store.ts:4075](../../packages/store/src/store.ts#L4075) `Store/identityAllowed` | `SQLite.get` (4075, 4081, 4087); `SQLite.prepare` (4075, 4081, 4087); `Store.sql` (4075, 4081, 4087) | CORE |
| [packages/store/src/store.ts:4095](../../packages/store/src/store.ts#L4095) `Store/externalIdentityId` | `SQLite.get` (4095, 4101); `SQLite.prepare` (4095, 4100, 4101); `Store.sql` (4095, 4100, 4101) | CORE |
| [packages/store/src/store.ts:4106](../../packages/store/src/store.ts#L4106) `Store/accountIdentityId` | `SQLite.get` (4106, 4111); `SQLite.prepare` (4106, 4110, 4111); `Store.sql` (4106, 4110, 4111) | CORE |
| [packages/store/src/store.ts:4134](../../packages/store/src/store.ts#L4134) `Store/signInMark` | `SQLite.prepare` (4134); `Store.sql` (4134) | AUTH |
| [packages/store/src/store.ts:4144](../../packages/store/src/store.ts#L4144) `Store/signInBase` | `SQLite.get` (4144); `SQLite.prepare` (4144); `Store.sql` (4144) | AUTH |
| [packages/store/src/store.ts:4146](../../packages/store/src/store.ts#L4146) `Store/signInBase/identity` | `SQLite.get` (4146); `SQLite.prepare` (4146); `Store.sql` (4146) | AUTH |
| [packages/store/src/store.ts:4158](../../packages/store/src/store.ts#L4158) `Store/ledgerRow` | `SQLite.get` (4158, 4159); `SQLite.prepare` (4158, 4159); `Store.sql` (4158, 4159) | AUTH |
| [packages/store/src/store.ts:4170](../../packages/store/src/store.ts#L4170) `Store/ledgerWrite` | `Store.sql` (4170, 4171, 4173, 4175, 4178, 4178) | AUTH |
| [packages/store/src/store.ts:4197](../../packages/store/src/store.ts#L4197) `Store/settleSignIns` | `SQLite.all` (4197, 4203); `SQLite.prepare` (4197, 4203, 4209, 4213, 4215); `Store.sql` (4197, 4203, 4209, 4213, 4215) | AUTH |
| [packages/store/src/store.ts:4226](../../packages/store/src/store.ts#L4226) `Store/securityToken` | `SQLite.get` (4226); `SQLite.prepare` (4226); `Store.sql` (4226) | CORE |
| [packages/store/src/store.ts:4234](../../packages/store/src/store.ts#L4234) `Store/accountLocalOnly` | `SQLite.get` (4234); `SQLite.prepare` (4234); `Store.sql` (4234) | CORE |
| [packages/store/src/store.ts:4239](../../packages/store/src/store.ts#L4239) `Store/accountRequires2fa` | `SQLite.get` (4239); `SQLite.prepare` (4239); `Store.sql` (4239) | CORE |
| [packages/store/src/store.ts:4245](../../packages/store/src/store.ts#L4245) `Store/setAccountLocalOnly` | `SQLite.prepare` (4245); `Store.sql` (4245) | CORE |
| [packages/store/src/store.ts:4254](../../packages/store/src/store.ts#L4254) `Store/setAccountRequire2fa` | `SQLite.prepare` (4254); `Store.sql` (4254) | CORE |
| [packages/store/src/store.ts:4282](../../packages/store/src/store.ts#L4282) `Store/createApiToken` | `SQLite.get` (4282); `SQLite.prepare` (4282, 4310); `Store.sql` (4282, 4310) | CORE |
| [packages/store/src/store.ts:4357](../../packages/store/src/store.ts#L4357) `Store/recordObjectUse` | `Store.sql` (4357) | CORE |
| [packages/store/src/store.ts:4387](../../packages/store/src/store.ts#L4387) `Store/writeUsage` | `Store.sql` (4387, 4388, 4390, 4394, 4396) | CORE |
| [packages/store/src/store.ts:4403](../../packages/store/src/store.ts#L4403) `Store/writeUsageRows` | `SQLite.prepare` (4403, 4404, 4410); `Store.sql` (4403, 4404, 4410) | CORE |
| [packages/store/src/store.ts:4415](../../packages/store/src/store.ts#L4415) `Store/writeObjectUseRows` | `SQLite.prepare` (4415, 4416, 4421); `Store.sql` (4415, 4416, 4421) | CORE |
| [packages/store/src/store.ts:4426](../../packages/store/src/store.ts#L4426) `Store/objectUseSince` | `SQLite.get` (4426); `SQLite.prepare` (4426); `Store.sql` (4426) | CORE |
| [packages/store/src/store.ts:4439](../../packages/store/src/store.ts#L4439) `Store/accountUsage` | `SQLite.get` (4439); `SQLite.prepare` (4439, 4440); `Store.sql` (4439, 4440); `SQLite.all` (4440); `Store.auditLog` (4456) | CORE |
| [packages/store/src/store.ts:4472](../../packages/store/src/store.ts#L4472) `Store/apiTokens` | `SQLite.all` (4472); `SQLite.prepare` (4472); `Store.sql` (4472) | CORE |
| [packages/store/src/store.ts:4482](../../packages/store/src/store.ts#L4482) `Store/revokeApiToken` | `SQLite.prepare` (4482); `Store.sql` (4482) | CORE |
| [packages/store/src/store.ts:4496](../../packages/store/src/store.ts#L4496) `Store/apiToken` | `SQLite.get` (4496); `SQLite.prepare` (4496, 4508); `Store.sql` (4496, 4508) | CORE |
| [packages/store/src/store.ts:4524](../../packages/store/src/store.ts#L4524) `Store/enrollTotp` | `SQLite.prepare` (4524); `Store.sql` (4524) | CORE |
| [packages/store/src/store.ts:4535](../../packages/store/src/store.ts#L4535) `Store/confirmTotp` | `SQLite.get` (4535); `SQLite.prepare` (4535, 4537); `Store.sql` (4535, 4537) | CORE |
| [packages/store/src/store.ts:4545](../../packages/store/src/store.ts#L4545) `Store/hasTotp` | `SQLite.get` (4545); `SQLite.prepare` (4545); `Store.sql` (4545) | CORE |
| [packages/store/src/store.ts:4550](../../packages/store/src/store.ts#L4550) `Store/totpAccounts` | `SQLite.all` (4550); `SQLite.prepare` (4550); `Store.sql` (4550) | CORE |
| [packages/store/src/store.ts:4556](../../packages/store/src/store.ts#L4556) `Store/disableTotp` | `SQLite.prepare` (4556); `Store.sql` (4556) | CORE |
| [packages/store/src/store.ts:4579](../../packages/store/src/store.ts#L4579) `Store/verifyTotp` | `SQLite.get` (4579); `SQLite.prepare` (4579, 4585); `Store.sql` (4579, 4585) | CORE |
| [packages/store/src/store.ts:4598](../../packages/store/src/store.ts#L4598) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4598, 4600, 4601, 4603); `Store.sql` (4598, 4600, 4601, 4603); `SQLite.get` (4600) | CORE |
| [packages/store/src/store.ts:4650](../../packages/store/src/store.ts#L4650) `Store/passkeyAllowList` | `SQLite.all` (4650); `SQLite.prepare` (4650); `Store.sql` (4650) | CORE |
| [packages/store/src/store.ts:4664](../../packages/store/src/store.ts#L4664) `Store/takeWebauthnChallenge` | `SQLite.get` (4664); `SQLite.prepare` (4664, 4666); `Store.sql` (4664, 4666) | CORE |
| [packages/store/src/store.ts:4674](../../packages/store/src/store.ts#L4674) `Store/passkeys` | `SQLite.all` (4674); `SQLite.prepare` (4674); `Store.sql` (4674) | CORE |
| [packages/store/src/store.ts:4681](../../packages/store/src/store.ts#L4681) `Store/hasPasskey` | `SQLite.get` (4681); `SQLite.prepare` (4681); `Store.sql` (4681) | CORE |
| [packages/store/src/store.ts:4686](../../packages/store/src/store.ts#L4686) `Store/passkeyIds` | `SQLite.all` (4686); `SQLite.prepare` (4686); `Store.sql` (4686) | CORE |
| [packages/store/src/store.ts:4708](../../packages/store/src/store.ts#L4708) `Store/registerPasskey` | `SQLite.prepare` (4708); `Store.sql` (4708) | CORE |
| [packages/store/src/store.ts:4719](../../packages/store/src/store.ts#L4719) `Store/removePasskey` | `SQLite.get` (4719); `SQLite.prepare` (4719, 4720); `Store.sql` (4719, 4720) | CORE |
| [packages/store/src/store.ts:4736](../../packages/store/src/store.ts#L4736) `Store/verifyPasskeyAssertion` | `SQLite.get` (4736); `SQLite.prepare` (4736, 4747); `Store.sql` (4736, 4747) | CORE |
| [packages/store/src/store.ts:4783](../../packages/store/src/store.ts#L4783) `Store/generateRecoveryCodes` | `SQLite.prepare` (4783, 4786); `Store.sql` (4783, 4786) | CORE |
| [packages/store/src/store.ts:4801](../../packages/store/src/store.ts#L4801) `Store/recoveryCodesRemaining` | `SQLite.get` (4801); `SQLite.prepare` (4801); `Store.sql` (4801) | CORE |
| [packages/store/src/store.ts:4811](../../packages/store/src/store.ts#L4811) `Store/useRecoveryCode` | `SQLite.get` (4811); `SQLite.prepare` (4811, 4813); `Store.sql` (4811, 4813) | CORE |
| [packages/store/src/store.ts:4824](../../packages/store/src/store.ts#L4824) `Store/privilegeSets` | `Store.sql` (4824) | CORE |
| [packages/store/src/store.ts:4853](../../packages/store/src/store.ts#L4853) `Store/savePrivilegeSet` | `SQLite.prepare` (4853, 4861); `Store.sql` (4853, 4861) | AUTH |
| [packages/store/src/store.ts:4896](../../packages/store/src/store.ts#L4896) `Store/deletePrivilegeSet` | `SQLite.prepare` (4896); `Store.sql` (4896) | CORE |
| [packages/store/src/store.ts:4965](../../packages/store/src/store.ts#L4965) `Store/accountPrivilegeSet` | `SQLite.get` (4965); `SQLite.prepare` (4965); `Store.sql` (4965) | CORE |
| [packages/store/src/store.ts:4979](../../packages/store/src/store.ts#L4979) `Store/setAccountPrivilegeSet` | `SQLite.get` (4979); `SQLite.prepare` (4979, 4982, 4986); `Store.sql` (4979, 4982, 4986) | AUTH |
| [packages/store/src/store.ts:5001](../../packages/store/src/store.ts#L5001) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5001); `Store.sql` (5001) | CORE |
| [packages/store/src/store.ts:5015](../../packages/store/src/store.ts#L5015) `Store/addProvisionedAccount` | `SQLite.get` (5015); `SQLite.prepare` (5015, 5019); `Store.sql` (5015, 5019) | CORE |
| [packages/store/src/store.ts:5180](../../packages/store/src/store.ts#L5180) `Store/ruleOutcome` | `Calculations.context` (5180) | CORE |
| [packages/store/src/store.ts:5221](../../packages/store/src/store.ts#L5221) `Store/allowedIds` | `SQLite.iterate` (5221); `SQLite.prepare` (5221); `Store.sql` (5221) | CORE |
| [packages/store/src/store.ts:5291](../../packages/store/src/store.ts#L5291) `Store/scopedTableSql` | `Store.viewableIds` (5291); `SQLite.all` (5294); `SQLite.prepare` (5294); `Store.sql` (5294) | GATED-STORE |
| [packages/store/src/store.ts:5326](../../packages/store/src/store.ts#L5326) `Store/previewRecordRuleCurrent` | `SQLite.get` (5326); `SQLite.prepare` (5326, 5329); `Store.sql` (5326, 5329); `SQLite.all` (5329); `Calculations.context` (5335, 5351) | CORE |
| [packages/store/src/store.ts:5503](../../packages/store/src/store.ts#L5503) `Store/passwordHash` | `SQLite.get` (5503); `SQLite.prepare` (5503); `Store.sql` (5503) | CORE |
| [packages/store/src/store.ts:5532](../../packages/store/src/store.ts#L5532) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5532); `Store.sql` (5532) | CORE |
| [packages/store/src/store.ts:5545](../../packages/store/src/store.ts#L5545) `Store/knownSharedAccount` | `SQLite.get` (5545); `SQLite.prepare` (5545); `Store.sql` (5545) | CORE |
| [packages/store/src/store.ts:5603](../../packages/store/src/store.ts#L5603) `Store/layouts` | `SQLite.all` (5603); `SQLite.prepare` (5603); `Store.sql` (5603) | CORE |
| [packages/store/src/store.ts:5624](../../packages/store/src/store.ts#L5624) `Store/image` | `SQLite.get` (5624); `SQLite.prepare` (5624); `Store.sql` (5624) | CORE |
| [packages/store/src/store.ts:5634](../../packages/store/src/store.ts#L5634) `Store/images` | `SQLite.all` (5634); `SQLite.prepare` (5634); `Store.sql` (5634) | CORE |
| [packages/store/src/store.ts:5647](../../packages/store/src/store.ts#L5647) `Store/addImage` | `Store.sql` (5647, 5648); `SQLite.prepare` (5648) | CORE |
| [packages/store/src/store.ts:5664](../../packages/store/src/store.ts#L5664) `Store/layout` | `SQLite.get` (5664); `SQLite.prepare` (5664); `Store.sql` (5664) | CORE |
| [packages/store/src/store.ts:5868](../../packages/store/src/store.ts#L5868) `Store/wordIndex` | `Store.sql` (5868, 5876, 5881); `Store.recordCount` (5880); `SQLite.get` (5881); `SQLite.prepare` (5881) | CORE |
| [packages/store/src/store.ts:5933](../../packages/store/src/store.ts#L5933) `Store/toRecord` | `Calculations.value` (5933, 5943); `Calculations.globalValue` (5937); `Calculations.unstoredStyled` (5942) | CORE |
| [packages/store/src/store.ts:5992](../../packages/store/src/store.ts#L5992) `Store/relatedValues` | `Calculations.globalValue` (5992); `Calculations.unstoredValue` (5994) | CORE |
| [packages/store/src/store.ts:6066](../../packages/store/src/store.ts#L6066) `Store/addRelated` | `relatedRows` (6066); `rowsById` (6098); `firstRelatedEach` (6120) | CORE |
| [packages/store/src/store.ts:6148](../../packages/store/src/store.ts#L6148) `Store/foundSetPage` | `rowsById` (6148) | CORE |
| [packages/store/src/store.ts:6164](../../packages/store/src/store.ts#L6164) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6164); `Store.row` (6180) | GATED-STORE |
| [packages/store/src/store.ts:6203](../../packages/store/src/store.ts#L6203) `Store/portalCountsCurrent` | `Store.canView` (6203); `Store.row` (6230) | GATED-STORE |
| [packages/store/src/store.ts:6266](../../packages/store/src/store.ts#L6266) `Store/fieldIndexCurrent` | `SQLite.iterate` (6266); `SQLite.prepare` (6266, 6271); `Store.sql` (6266, 6271); `SQLite.all` (6271) | GATED-STORE |
| [packages/store/src/store.ts:6312](../../packages/store/src/store.ts#L6312) `Store/valueListItemsCurrent` | `Store.valueListItems` (6312); `Store.get` (6326); `relatedRows` (6327); `Store.row` (6327); `SQLite.iterate` (6329); `SQLite.prepare` (6329); `Store.sql` (6329); `Calculations.related` (6339); `Calculations.value` (6343, 6344) | GATED-STORE |
| [packages/store/src/store.ts:6441](../../packages/store/src/store.ts#L6441) `Store/portalRows` | `relatedRows` (6441); `relatedIdList` (6442); `Store.viewableIds` (6445); `rowsById` (6470, 6508); `Calculations.related` (6484) | CORE |
| [packages/store/src/store.ts:6452](../../packages/store/src/store.ts#L6452) `Store/portalRows/context` | `Calculations.context` (6452) | CORE |
| [packages/store/src/store.ts:6462](../../packages/store/src/store.ts#L6462) `Store/portalRows/valueOf` | `Calculations.value` (6462) | CORE |
| [packages/store/src/store.ts:6579](../../packages/store/src/store.ts#L6579) `Store/markRepeating` | `SQLite.prepare` (6579); `Store.sql` (6579) | CORE |
| [packages/store/src/store.ts:6606](../../packages/store/src/store.ts#L6606) `Store/externalContainerCheck` | `SQLite.all` (6606); `SQLite.prepare` (6606); `Store.sql` (6606) | CORE |
| [packages/store/src/store.ts:6613](../../packages/store/src/store.ts#L6613) `Store/externalContainerCount` | `SQLite.get` (6613); `SQLite.prepare` (6613); `Store.sql` (6613) | CORE |
| [packages/store/src/store.ts:6622](../../packages/store/src/store.ts#L6622) `Store/externalContainerReport` | `SQLite.all` (6622, 6635); `SQLite.prepare` (6622, 6635); `Store.sql` (6622, 6635) | CORE |
| [packages/store/src/store.ts:6677](../../packages/store/src/store.ts#L6677) `Store/orphanContainerReport` | `SQLite.all` (6677, 6695, 6697, 6703, 6716, 6729, 6748, 6766); `SQLite.prepare` (6677, 6695, 6697, 6703, 6716, 6729, 6746, 6748, 6766); `Store.sql` (6677, 6695, 6697, 6703, 6716, 6729, 6746, 6748, 6766); `SQLite.get` (6746); `Store.row` (6760) | CORE |
| [packages/store/src/store.ts:6777](../../packages/store/src/store.ts#L6777) `Store/purgeOrphanContainers` | `Store.sql` (6777, 6786, 6789, 6791, 6792, 6797, 6799); `Store.orphanContainerReport` (6778); `SQLite.get` (6786); `SQLite.prepare` (6786, 6791, 6792) | CORE |
| [packages/store/src/store.ts:6812](../../packages/store/src/store.ts#L6812) `Store/containerIntact` | `SQLite.get` (6812); `SQLite.prepare` (6812); `Store.sql` (6812) | CORE |
| [packages/store/src/store.ts:6822](../../packages/store/src/store.ts#L6822) `Store/externalOf` | `SQLite.get` (6822); `SQLite.prepare` (6822); `Store.sql` (6822) | CORE |
| [packages/store/src/store.ts:6826](../../packages/store/src/store.ts#L6826) `Store/containerMeta` | `SQLite.get` (6826); `SQLite.prepare` (6826); `Store.sql` (6826) | CORE |
| [packages/store/src/store.ts:6831](../../packages/store/src/store.ts#L6831) `Store/container` | `SQLite.get` (6831); `SQLite.prepare` (6831, 6840); `Store.sql` (6831, 6840); `SQLite.all` (6840) | CORE |
| [packages/store/src/store.ts:6848](../../packages/store/src/store.ts#L6848) `Store/containerInfo` | `SQLite.get` (6848); `SQLite.prepare` (6848); `Store.sql` (6848) | CORE |
| [packages/store/src/store.ts:6882](../../packages/store/src/store.ts#L6882) `Store/containerRange` | `SQLite.all` (6882); `SQLite.prepare` (6882, 6889); `Store.sql` (6882, 6889); `SQLite.get` (6889) | CORE |
| [packages/store/src/store.ts:6902](../../packages/store/src/store.ts#L6902) `Store/addContainer` | `SQLite.prepare` (6902, 6906, 6907); `Store.sql` (6902, 6904, 6906, 6907, 6909, 6912) | CORE |
| [packages/store/src/store.ts:6928](../../packages/store/src/store.ts#L6928) `Store/addExternalContainer` | `SQLite.prepare` (6928); `Store.sql` (6928) | CORE |
| [packages/store/src/store.ts:6946](../../packages/store/src/store.ts#L6946) `Store/writeExternalFile` | `Store.evaluateEach` (6946); `SQLite.prepare` (6969); `Store.sql` (6969) | CORE |
| [packages/store/src/store.ts:6970](../../packages/store/src/store.ts#L6970) `Store/writeExternalFile/taken` | `SQLite.get` (6970) | CORE |
| [packages/store/src/store.ts:6987](../../packages/store/src/store.ts#L6987) `Store/embeddedContainers` | `SQLite.prepare` (6987, 6988); `Store.sql` (6987, 6988); `SQLite.all` (6988); `SQLite.get` (6992) | CORE |
| [packages/store/src/store.ts:7001](../../packages/store/src/store.ts#L7001) `Store/embeddedContainerCount` | `SQLite.prepare` (7001); `Store.sql` (7001); `SQLite.get` (7002) | CORE |
| [packages/store/src/store.ts:7010](../../packages/store/src/store.ts#L7010) `Store/recoverContainersOut` | `SQLite.prepare` (7010); `Store.sql` (7010); `SQLite.get` (7013) | CORE |
| [packages/store/src/store.ts:7035](../../packages/store/src/store.ts#L7035) `Store/moveContainersOut` | `Store.sql` (7035, 7043, 7045, 7047, 7049, 7050, 7069, 7074, 7076, 7078, 7079, 7083); `SQLite.get` (7043); `SQLite.prepare` (7043, 7049, 7050); `Store.container` (7052) | CORE |
| [packages/store/src/store.ts:7092](../../packages/store/src/store.ts#L7092) `Store/moveContainersIn` | `Store.sql` (7092, 7096, 7098, 7099, 7100, 7101, 7120, 7123, 7130, 7133, 7136, 7143); `SQLite.prepare` (7098, 7099, 7100, 7101, 7130, 7136); `SQLite.get` (7103, 7130, 7136) | CORE |
| [packages/store/src/store.ts:7155](../../packages/store/src/store.ts#L7155) `Store/compactFile` | `Store.sql` (7155, 7156, 7157) | CORE |
| [packages/store/src/store.ts:7163](../../packages/store/src/store.ts#L7163) `Store/containerId` | `Store.containerId` (7163); `Store.row` (7164) | CORE |
| [packages/store/src/store.ts:7186](../../packages/store/src/store.ts#L7186) `Store/checkContainerWrite` | `Store.row` (7186) | CORE |
| [packages/store/src/store.ts:7196](../../packages/store/src/store.ts#L7196) `Store/setContainer` | `Store.row` (7196); `SQLite.prepare` (7207); `Store.sql` (7207) | CORE |
| [packages/store/src/store.ts:7239](../../packages/store/src/store.ts#L7239) `Store/orderBy` | `Store.valueListItems` (7239) | CORE |
| [packages/store/src/store.ts:7262](../../packages/store/src/store.ts#L7262) `Store/userPrefs` | `SQLite.all` (7262); `SQLite.prepare` (7262); `Store.sql` (7262) | CORE |
| [packages/store/src/store.ts:7267](../../packages/store/src/store.ts#L7267) `Store/hasTable` | `SQLite.get` (7267); `SQLite.prepare` (7267); `Store.sql` (7267) | CORE |
| [packages/store/src/store.ts:7271](../../packages/store/src/store.ts#L7271) `Store/setUserPref` | `Store.sql` (7271, 7272, 7273); `SQLite.prepare` (7272, 7273) | CORE |
| [packages/store/src/store.ts:7279](../../packages/store/src/store.ts#L7279) `Store/indexedFields` | `SQLite.all` (7279, 7280); `SQLite.prepare` (7279, 7280); `Store.sql` (7279, 7280) | CORE |
| [packages/store/src/store.ts:7301](../../packages/store/src/store.ts#L7301) `Store/addFieldIndex` | `Store.sql` (7301) | CORE |
| [packages/store/src/store.ts:7313](../../packages/store/src/store.ts#L7313) `Store/dropFieldIndex` | `SQLite.get` (7313); `SQLite.prepare` (7313); `Store.sql` (7313, 7314) | CORE |
| [packages/store/src/store.ts:7324](../../packages/store/src/store.ts#L7324) `Store/timeFind` | `Store.query` (7324, 7328, 7329); `Store.recordCount` (7331) | CORE |
| [packages/store/src/store.ts:7348](../../packages/store/src/store.ts#L7348) `Store/find` | `Store.find` (7348) | GATED-STORE |
| [packages/store/src/store.ts:7359](../../packages/store/src/store.ts#L7359) `Store/findHere` | `Store.query` (7359, 7364, 7366, 7380, 7382, 7392); `Store.recordCount` (7377); `SQLite.get` (7378, 7382); `SQLite.prepare` (7378, 7382, 7387, 7394, 7403); `Store.sql` (7378, 7382, 7387, 7394, 7403); `SQLite.all` (7387, 7394, 7403) | GATED-STORE |
| [packages/store/src/store.ts:7398](../../packages/store/src/store.ts#L7398) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7398); `SQLite.prepare` (7398); `Store.sql` (7398) | GATED-STORE |
| [packages/store/src/store.ts:7431](../../packages/store/src/store.ts#L7431) `Store/sortedPage` | `SQLite.iterate` (7431); `SQLite.prepare` (7431, 7446); `Store.sql` (7431, 7446); `SQLite.all` (7446) | CORE |
| [packages/store/src/store.ts:7503](../../packages/store/src/store.ts#L7503) `Store/relatedCriteria/matched` | `relatedRows` (7503) | CORE |
| [packages/store/src/store.ts:7506](../../packages/store/src/store.ts#L7506) `Store/relatedCriteria` | `SQLite.iterate` (7506); `SQLite.prepare` (7506); `Store.sql` (7506) | CORE |
| [packages/store/src/store.ts:7532](../../packages/store/src/store.ts#L7532) `Store/computedRows` | `Store.sql` (7532, 7535, 7536, 7537, 7539, 7549, 7550, 7551, 7554); `SQLite.prepare` (7535, 7537, 7539, 7549); `SQLite.iterate` (7539); `Calculations.globalValue` (7542); `Calculations.unstoredValue` (7543); `Calculations.related` (7546); `SQLite.all` (7549) | CORE |
| [packages/store/src/store.ts:7579](../../packages/store/src/store.ts#L7579) `Store/summaries` | `Calculations.wholeTable` (7579); `Calculations.collect` (7599, 7604) | CORE |
| [packages/store/src/store.ts:7595](../../packages/store/src/store.ts#L7595) `Store/summaries/recs` | `SQLite.iterate` (7595); `SQLite.prepare` (7595); `Store.sql` (7595) | CORE |
| [packages/store/src/store.ts:7617](../../packages/store/src/store.ts#L7617) `Store/runningSummaryValues` | `Store.viewableIds` (7617); `rowsById` (7619); `Calculations.value` (7630, 7636); `Calculations.related` (7647) | GATED-STORE |
| [packages/store/src/store.ts:7660](../../packages/store/src/store.ts#L7660) `Store/findSource` | `Store.query` (7660); `Store.sql` (7667, 7668, 7672, 7674, 7685, 7687); `SQLite.prepare` (7668, 7674); `SQLite.iterate` (7674); `Calculations.globalValue` (7678); `Calculations.unstoredValue` (7679); `Calculations.related` (7683) | CORE |
| [packages/store/src/store.ts:7706](../../packages/store/src/store.ts#L7706) `Store/previewRow` | `Store.row` (7706) | CORE |
| [packages/store/src/store.ts:7724](../../packages/store/src/store.ts#L7724) `Store/row` | `SQLite.get` (7724) | CORE |
| [packages/store/src/store.ts:7743](../../packages/store/src/store.ts#L7743) `Store/getCurrent` | `Store.get` (7743); `Store.row` (7744, 7744, 7758); `SQLite.all` (7761); `SQLite.prepare` (7761); `Store.sql` (7761) | GATED-STORE |
| [packages/store/src/store.ts:7781](../../packages/store/src/store.ts#L7781) `Store/getManyCurrent` | `Store.getMany` (7781); `SQLite.get` (7799); `SQLite.prepare` (7799); `Store.sql` (7799) | GATED-STORE |
| [packages/store/src/store.ts:7792](../../packages/store/src/store.ts#L7792) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (7792) | GATED-STORE |
| [packages/store/src/store.ts:7815](../../packages/store/src/store.ts#L7815) `Store/canViewRecord` | `SQLite.get` (7815); `SQLite.prepare` (7815); `Store.sql` (7815) | GATED-STORE |
| [packages/store/src/store.ts:7823](../../packages/store/src/store.ts#L7823) `Store/canView` | `Store.canView` (7823); `Store.row` (7824) | GATED-STORE |
| [packages/store/src/store.ts:7848](../../packages/store/src/store.ts#L7848) `Store/create` | `SQLite.get` (7848, 7854); `SQLite.prepare` (7848, 7854, 7865); `Store.sql` (7848, 7854, 7865) | CORE |
| [packages/store/src/store.ts:7889](../../packages/store/src/store.ts#L7889) `Store/duplicate` | `Store.row` (7889); `SQLite.get` (7893); `SQLite.prepare` (7893, 7906); `Store.sql` (7893, 7906) | CORE |
| [packages/store/src/store.ts:7951](../../packages/store/src/store.ts#L7951) `Store/update` | `Store.row` (7951, 7958, 7969); `Store.sql` (7982, 7983, 8020, 8023) | CORE |
| [packages/store/src/store.ts:7985](../../packages/store/src/store.ts#L7985) `Store/update/undo` | `Store.sql` (7985) | CORE |
| [packages/store/src/store.ts:8127](../../packages/store/src/store.ts#L8127) `Store/setStoredCalcValues` | `SQLite.prepare` (8127, 8128); `Store.sql` (8127, 8128); `SQLite.get` (8132) | CORE |
| [packages/store/src/store.ts:8206](../../packages/store/src/store.ts#L8206) `Store/evaluateCurrent` | `Store.row` (8206, 8206); `Calculations.context` (8207); `Store.get` (8208, 8210) | GATED-STORE |
| [packages/store/src/store.ts:8242](../../packages/store/src/store.ts#L8242) `Store/evaluateEachCurrent` | `Store.row` (8242, 8242); `Calculations.context` (8247); `Store.get` (8249) | GATED-STORE |
| [packages/store/src/store.ts:8282](../../packages/store/src/store.ts#L8282) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8282); `Store.get` (8284) | GATED-STORE |
| [packages/store/src/store.ts:8303](../../packages/store/src/store.ts#L8303) `Store/evaluateRowsCurrent` | `Store.row` (8303, 8303) | GATED-STORE |
| [packages/store/src/store.ts:8317](../../packages/store/src/store.ts#L8317) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8317) | GATED-STORE |
| [packages/store/src/store.ts:8339](../../packages/store/src/store.ts#L8339) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8339) | GATED-STORE |
| [packages/store/src/store.ts:8377](../../packages/store/src/store.ts#L8377) `Store/updateRelated` | `relatedRows` (8377) | CORE |
| [packages/store/src/store.ts:8395](../../packages/store/src/store.ts#L8395) `Store/updatePortals` | `Store.row` (8395, 8430); `relatedRows` (8431) | CORE |
| [packages/store/src/store.ts:8404](../../packages/store/src/store.ts#L8404) `Store/updatePortals/portal/related` | `relatedIdList` (8404) | CORE |
| [packages/store/src/store.ts:8486](../../packages/store/src/store.ts#L8486) `Store/portalContainerTarget` | `Store.row` (8486); `relatedIdList` (8487) | CORE |
| [packages/store/src/store.ts:8500](../../packages/store/src/store.ts#L8500) `Store/checkEditable` | `Store.row` (8500) | CORE |
| [packages/store/src/store.ts:8523](../../packages/store/src/store.ts#L8523) `Store/delete` | `Store.row` (8523); `SQLite.get` (8528); `SQLite.prepare` (8528, 8530); `Store.sql` (8528, 8530) | CORE |
| [packages/store/src/store.ts:8551](../../packages/store/src/store.ts#L8551) `Store/vaultHeld` | `SQLite.get` (8551); `SQLite.prepare` (8551); `Store.sql` (8551) | CORE |
| [packages/store/src/store.ts:8558](../../packages/store/src/store.ts#L8558) `Store/forgetStandInValues` | `Store.sql` (8558, 8579); `SQLite.prepare` (8579) | CORE |
| [packages/store/src/store.ts:8593](../../packages/store/src/store.ts#L8593) `Store/restoreDeletedRow` | `SQLite.get` (8593); `SQLite.prepare` (8593, 8594, 8596); `Store.sql` (8593, 8594, 8596); `SQLite.all` (8594) | CORE |
| [packages/store/src/store.ts:8620](../../packages/store/src/store.ts#L8620) `Store/cascadeDelete` | `relatedRows` (8620) | CORE |
| [packages/store/src/store.ts:8710](../../packages/store/src/store.ts#L8710) `Store/selectIdsCurrent` | `Store.selectIds` (8710); `SQLite.all` (8716); `SQLite.prepare` (8716); `Store.sql` (8716) | GATED-STORE |
| [packages/store/src/store.ts:8724](../../packages/store/src/store.ts#L8724) `Store/countIds` | `Store.countIds` (8724); `SQLite.get` (8728); `SQLite.prepare` (8728); `Store.sql` (8728) | GATED-STORE |
| [packages/store/src/store.ts:8744](../../packages/store/src/store.ts#L8744) `Store/computeValuesCurrent` | `Store.computeValues` (8744); `Store.sql` (8750, 8754); `SQLite.all` (8754); `SQLite.prepare` (8754) | GATED-STORE |
| [packages/store/src/store.ts:8769](../../packages/store/src/store.ts#L8769) `Store/findIdsCurrent` | `Store.findIds` (8769) | GATED-STORE |
| [packages/store/src/store.ts:8775](../../packages/store/src/store.ts#L8775) `Store/findIdsHere` | `Store.query` (8775, 8780, 8782); `SQLite.iterate` (8793); `SQLite.prepare` (8793); `Store.sql` (8793) | GATED-STORE |
| [packages/store/src/store.ts:8810](../../packages/store/src/store.ts#L8810) `Store/groupSummariesCurrent` | `Store.groupSummaries` (8810); `Store.viewableIds` (8815); `Calculations.collect` (8831); `rowsById` (8831, 8881); `Calculations.collector` (8853) | GATED-STORE |
| [packages/store/src/store.ts:8843](../../packages/store/src/store.ts#L8843) `Store/groupSummariesCurrent/key` | `Calculations.value` (8843); `Calculations.related` (8845) | GATED-STORE |
| [packages/store/src/store.ts:8879](../../packages/store/src/store.ts#L8879) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (8879) | GATED-STORE |
| [packages/store/src/store.ts:8902](../../packages/store/src/store.ts#L8902) `Store/sortIdsCurrent` | `Store.sortIds` (8902); `SQLite.all` (8906); `SQLite.prepare` (8906); `Store.sql` (8906) | GATED-STORE |
| [packages/store/src/store.ts:8916](../../packages/store/src/store.ts#L8916) `Store/matchIds` | `Store.matchIds` (8916); `SQLite.all` (8922); `SQLite.prepare` (8922); `Store.sql` (8922) | CORE |
| [packages/store/src/store.ts:8940](../../packages/store/src/store.ts#L8940) `Store/truncate` | `Store.sql` (8940, 8942, 8949, 8950, 8952, 8953); `SQLite.prepare` (8942, 8949); `SQLite.all` (8944) | CORE |
| [packages/store/src/store.ts:8974](../../packages/store/src/store.ts#L8974) `Store/iterateCommitted` | `SQLite.iterate` (8974) | CORE |
| [packages/store/src/store.ts:9008](../../packages/store/src/store.ts#L9008) `Store/readOnlyChecked` | `SQLite.prepare` (9008, 9012, 9021, 9026); `SQLite.all` (9012, 9021, 9026) | CORE |
| [packages/store/src/store.ts:9048](../../packages/store/src/store.ts#L9048) `Store/refreshDecimalSqlViews` | `SQLite.get` (9048); `SQLite.prepare` (9048, 9053); `SQLite.all` (9053) | CORE |
| [packages/store/src/store.ts:9067](../../packages/store/src/store.ts#L9067) `Store/internalRoots` | `SQLite.get` (9067); `SQLite.prepare` (9067, 9069); `SQLite.all` (9069) | CORE |
| [packages/store/src/store.ts:9102](../../packages/store/src/store.ts#L9102) `Store/selectCurrent` | `SQLite.iterate` (9102) | CORE |
| [packages/store/src/store.ts:9123](../../packages/store/src/store.ts#L9123) `Store/query` | `SQLite.iterate` (9123) | CORE |
| [packages/store/src/store.ts:9157](../../packages/store/src/store.ts#L9157) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9157); `SQLite.all` (9164, 9167); `SQLite.prepare` (9164, 9167) | CORE |
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
