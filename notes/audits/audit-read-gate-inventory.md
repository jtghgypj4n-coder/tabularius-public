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
| [packages/scripts/src/engine.ts:1938](../../packages/scripts/src/engine.ts#L1938) `ScriptEngine/goToLayout` | `Store.findIds` (1938) | SCRIPT |
| [packages/scripts/src/engine.ts:2275](../../packages/scripts/src/engine.ts#L2275) `ScriptEngine/foundSet` | `Store.findIds` (2275) | SCRIPT |
| [packages/scripts/src/engine.ts:2340](../../packages/scripts/src/engine.ts#L2340) `ScriptEngine/semanticFind` | `Store.findIds` (2340, 2361) | SCRIPT |
| [packages/scripts/src/engine.ts:3254](../../packages/scripts/src/engine.ts#L3254) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3254); `Calculations.executeSQL` (3261) | SCRIPT |
| [packages/scripts/src/engine.ts:3293](../../packages/scripts/src/engine.ts#L3293) `ScriptEngine/sortIds` | `Store.sortIds` (3293); `Store.valueListItems` (3299) | SCRIPT |
| [packages/scripts/src/engine.ts:3390](../../packages/scripts/src/engine.ts#L3390) `ScriptEngine/revertTransaction` | `Store.findIds` (3390) | SCRIPT |
| [packages/scripts/src/engine.ts:3938](../../packages/scripts/src/engine.ts#L3938) `ScriptEngine/step` | `Store.fieldIndex` (3938); `Store.findIds` (4072, 4167) | SCRIPT |
| [packages/scripts/src/engine.ts:5188](../../packages/scripts/src/engine.ts#L5188) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5188) | SCRIPT |
| [packages/scripts/src/engine.ts:5196](../../packages/scripts/src/engine.ts#L5196) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5196) | SCRIPT |
| [packages/scripts/src/engine.ts:5197](../../packages/scripts/src/engine.ts#L5197) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5197) | SCRIPT |
| [packages/scripts/src/engine.ts:5344](../../packages/scripts/src/engine.ts#L5344) `ScriptEngine/get` | `Store.findIds` (5344); `Store.canViewRecord` (5435); `Store.get` (5471) | SCRIPT |
| [packages/scripts/src/engine.ts:5502](../../packages/scripts/src/engine.ts#L5502) `ScriptEngine/design` | `Store.valueListItems` (5502) | SCRIPT |
| [packages/scripts/src/engine.ts:5556](../../packages/scripts/src/engine.ts#L5556) `ScriptEngine/record` | `Store.get` (5556) | SCRIPT |
| [packages/scripts/src/engine.ts:5588](../../packages/scripts/src/engine.ts#L5588) `ScriptEngine/valueOf` | `Store.findIds` (5588); `Store.containerId` (5596) | SCRIPT |
| [packages/scripts/src/engine.ts:5613](../../packages/scripts/src/engine.ts#L5613) `ScriptEngine/lookupNext` | `Store.get` (5613); `Store.row` (5614); `Calculations.context` (5616) | SCRIPT |
| [packages/scripts/src/engine.ts:5716](../../packages/scripts/src/engine.ts#L5716) `ScriptEngine/relatedIds` | `Store.findIds` (5716); `rowsById` (5724); `Store.select` (5728); `Store.matchIds` (5742); `Store.viewableIds` (5765) | SCRIPT |
| [packages/scripts/src/engine.ts:5750](../../packages/scripts/src/engine.ts#L5750) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5750) | SCRIPT |
| [packages/scripts/src/engine.ts:6239](../../packages/scripts/src/engine.ts#L6239) `ScriptEngine/exportField` | `Store.get` (6239); `Store.containerId` (6240); `Store.container` (6242) | SCRIPT |
| [packages/scripts/src/engine.ts:6388](../../packages/scripts/src/engine.ts#L6388) `ScriptEngine/relookup` | `Store.get` (6388) | SCRIPT |
| [packages/scripts/src/engine.ts:6806](../../packages/scripts/src/engine.ts#L6806) `ScriptEngine/goToList` | `Store.findIds` (6806) | SCRIPT |
| [packages/scripts/src/engine.ts:7135](../../packages/scripts/src/engine.ts#L7135) `ScriptEngine/sourceValue` | `Store.get` (7135); `Store.containerId` (7136); `Store.container` (7137) | SCRIPT |
| [packages/scripts/src/engine.ts:7853](../../packages/scripts/src/engine.ts#L7853) `ScriptEngine/containerFile` | `Store.get` (7853); `Store.containerId` (7854); `Store.container` (7855) | SCRIPT |
| [packages/scripts/src/engine.ts:8014](../../packages/scripts/src/engine.ts#L8014) `ScriptEngine/importRecords` | `Store.findIds` (8014); `Store.get` (8034) | SCRIPT |
| [packages/scripts/src/engine.ts:8242](../../packages/scripts/src/engine.ts#L8242) `ScriptEngine/fileMakerRows` | `Store.findIds` (8242); `Store.get` (8247) | SCRIPT |
| [packages/scripts/src/engine.ts:8282](../../packages/scripts/src/engine.ts#L8282) `ScriptEngine/newRecord` | `Store.findIds` (8282) | SCRIPT |
| [packages/scripts/src/engine.ts:8584](../../packages/scripts/src/engine.ts#L8584) `ScriptEngine/performFind` | `Store.findIds` (8584) | SCRIPT |
| [packages/scripts/src/engine.ts:8609](../../packages/scripts/src/engine.ts#L8609) `ScriptEngine/findRelated` | `Store.findIds` (8609, 8619, 8622) | SCRIPT |
| [packages/scripts/src/engine.ts:8641](../../packages/scripts/src/engine.ts#L8641) `ScriptEngine/quickFind` | `Store.findIds` (8641, 8642, 8645) | SCRIPT |
| [packages/scripts/src/engine.ts:9029](../../packages/scripts/src/engine.ts#L9029) `clearRecords` | `SQLite.all` (9029); `SQLite.prepare` (9029) | SCRIPT |
| [packages/scripts/src/recorder.ts:72](../../packages/scripts/src/recorder.ts#L72) `lastSeq` | `Store.auditLog` (72) | DESIGN |
| [packages/scripts/src/recorder.ts:104](../../packages/scripts/src/recorder.ts#L104) `recordRun` | `Store.auditLog` (104) | DESIGN |
| [packages/scripts/src/script-tests.ts:211](../../packages/scripts/src/script-tests.ts#L211) `runCase` | `Store.findIds` (211); `Store.auditLog` (218, 219, 262); `Store.evaluateEach` (246) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/server/src/admin.ts:968](../../packages/server/src/admin.ts#L968) `Admin/handle` | `Store.externalContainerReport` (968); `Store.orphanContainerReport` (973, 977) | ADMIN |
| [packages/server/src/admin.ts:2135](../../packages/server/src/admin.ts#L2135) `Admin/audit` | `Store.auditLog` (2135) | ADMIN |
| [packages/server/src/admin.ts:2218](../../packages/server/src/admin.ts#L2218) `Admin/viewAs` | `Store.find` (2218) | ADMIN |
| [packages/server/src/admin.ts:2566](../../packages/server/src/admin.ts#L2566) `Admin/status` | `Store.externalContainerCount` (2566) | ADMIN |
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
| [packages/server/src/backup-verify.ts:148](../../packages/server/src/backup-verify.ts#L148) `testRestore` | `Store.recordCount` (148) | OPERATOR |
| [packages/server/src/backup-verify.ts:188](../../packages/server/src/backup-verify.ts#L188) `integrity` | `SQLite.all` (188); `SQLite.prepare` (188, 192); `SQLite.get` (192) | OPERATOR |
| [packages/server/src/backup-verify.ts:218](../../packages/server/src/backup-verify.ts#L218) `pageCheck` | `SQLite.all` (218); `SQLite.prepare` (218, 221); `SQLite.get` (221) | OPERATOR |
| [packages/server/src/backup.ts:257](../../packages/server/src/backup.ts#L257) `backupOnce` | `SQLite.get` (257); `SQLite.prepare` (257) | OPERATOR |
| [packages/server/src/backup.ts:981](../../packages/server/src/backup.ts#L981) `accountDifferences/read` | `SQLite.all` (981, 983); `SQLite.prepare` (981, 983) | OPERATOR |
| [packages/server/src/backup.ts:1008](../../packages/server/src/backup.ts#L1008) `readNames` | `SQLite.all` (1008); `SQLite.prepare` (1008) | OPERATOR |
| [packages/server/src/backup.ts:1038](../../packages/server/src/backup.ts#L1038) `credentialsReadable` | `SQLite.all` (1038); `SQLite.prepare` (1038) | OPERATOR |
| [packages/server/src/backup.ts:1054](../../packages/server/src/backup.ts#L1054) `columnInfo` | `SQLite.all` (1054); `SQLite.prepare` (1054) | OPERATOR |
| [packages/server/src/backup.ts:1089](../../packages/server/src/backup.ts#L1089) `reconcileCredentials` | `SQLite.all` (1089, 1111, 1126, 1136, 1142); `SQLite.prepare` (1089, 1097, 1111, 1113, 1126, 1127, 1134, 1136, 1137, 1142, 1143, 1147, 1148, 1149); `SQLite.get` (1097, 1147) | OPERATOR |
| [packages/server/src/backup.ts:1092](../../packages/server/src/backup.ts#L1092) `reconcileCredentials/has` | `SQLite.all` (1092); `SQLite.prepare` (1092) | OPERATOR |
| [packages/server/src/backup.ts:1116](../../packages/server/src/backup.ts#L1116) `reconcileCredentials/accountColumns` | `SQLite.all` (1116); `SQLite.prepare` (1116) | OPERATOR |
| [packages/server/src/backup.ts:1261](../../packages/server/src/backup.ts#L1261) `stageRestorePoint` | `SQLite.get` (1261, 1263, 1264); `SQLite.prepare` (1261, 1263, 1264) | OPERATOR |
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
| [packages/server/src/webclient.ts:445](../../packages/server/src/webclient.ts#L445) `WebClient/history` | `Store.get` (445) | WEB |
| [packages/server/src/webclient.ts:582](../../packages/server/src/webclient.ts#L582) `WebClient/explain` | `Store.get` (582); `Store.row` (615, 628) | WEB |
| [packages/server/src/webclient.ts:641](../../packages/server/src/webclient.ts#L641) `WebClient/index` | `Store.fieldIndex` (641) | WEB |
| [packages/server/src/webclient.ts:731](../../packages/server/src/webclient.ts#L731) `WebClient/menus` | `Store.evaluateEach` (731) | WEB |
| [packages/server/src/webclient.ts:947](../../packages/server/src/webclient.ts#L947) `WebClient/view` | `Store.evaluateEach` (947, 971, 990); `Store.canView` (965); `Store.previewRow` (969, 991); `Store.get` (982); `Store.row` (983, 983) | WEB |
| [packages/server/src/webclient.ts:968](../../packages/server/src/webclient.ts#L968) `WebClient/view/get` | `Store.get` (968) | WEB |
| [packages/server/src/webclient.ts:1033](../../packages/server/src/webclient.ts#L1033) `WebClient/refresh` | `Store.previewRow` (1033); `Store.getMany` (1038); `Store.foundSetRows` (1060) | WEB |
| [packages/server/src/webclient.ts:1072](../../packages/server/src/webclient.ts#L1072) `WebClient/foundIds` | `Store.findIds` (1072) | WEB |
| [packages/server/src/webclient.ts:1087](../../packages/server/src/webclient.ts#L1087) `WebClient/records` | `Store.getMany` (1087); `Store.find` (1090) | WEB |
| [packages/server/src/webclient.ts:1116](../../packages/server/src/webclient.ts#L1116) `WebClient/foundSetPortal` | `Store.foundSetRows` (1116, 1123) | WEB |
| [packages/server/src/webclient.ts:1156](../../packages/server/src/webclient.ts#L1156) `WebClient/charts/foundSet` | `Store.findIds` (1156) | WEB |
| [packages/server/src/webclient.ts:1165](../../packages/server/src/webclient.ts#L1165) `WebClient/charts` | `Calculations.context` (1165); `Store.canView` (1193); `Store.evaluateEach` (1202, 1206); `Store.evaluateRows` (1211, 1213) | WEB |
| [packages/server/src/webclient.ts:1196](../../packages/server/src/webclient.ts#L1196) `WebClient/charts/get` | `Store.get` (1196) | WEB |
| [packages/server/src/webclient.ts:1346](../../packages/server/src/webclient.ts#L1346) `WebClient/exportRecords` | `Store.getMany` (1346) | WEB |
| [packages/server/src/webclient.ts:1272](../../packages/server/src/webclient.ts#L1272) `WebClient/exportText/nextBatch` | `Store.selectIds` (1272); `Store.getMany` (1277) | WEB |
| [packages/server/src/webclient.ts:1520](../../packages/server/src/webclient.ts#L1520) `WebClient/aiReplace` | `Store.canView` (1520); `Store.getMany` (1536) | WEB |
| [packages/server/src/webclient.ts:1596](../../packages/server/src/webclient.ts#L1596) `WebClient/groups` | `Store.findIds` (1596); `Store.groupSummaries` (1602) | WEB |
| [packages/server/src/webclient.ts:1704](../../packages/server/src/webclient.ts#L1704) `WebClient/button` | `Store.findIds` (1704, 1754); `Store.evaluateEach` (1713, 1714) | WEB |
| [packages/server/src/webclient.ts:2361](../../packages/server/src/webclient.ts#L2361) `listItems` | `Store.valueListItems` (2361) | WEB |
| [packages/server/src/webclient.ts:2440](../../packages/server/src/webclient.ts#L2440) `foundIds` | `Store.findIds` (2440, 2442) | WEB |
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
| [packages/store/src/export-sql.ts:230](../../packages/store/src/export-sql.ts#L230) `exportSql` | `Store.scopedTableSql` (230); `Store.select` (231, 364); `Store.container` (435) | OPERATOR |
| [packages/store/src/export-sql.ts:256](../../packages/store/src/export-sql.ts#L256) `exportSql/page` | `Store.select` (256) | OPERATOR |
| [packages/store/src/export-sql.ts:306](../../packages/store/src/export-sql.ts#L306) `exportSql/duplicates` | `Store.select` (306) | OPERATOR |
| [packages/store/src/fidelity.ts:176](../../packages/store/src/fidelity.ts#L176) `changedAfter` | `Untyped.executeSQL` (176) | DESIGN |
| [packages/store/src/fidelity.ts:196](../../packages/store/src/fidelity.ts#L196) `queryProblem` | `Calculations.translateSQL` (196); `Store.describe` (197) | DESIGN |
| [packages/store/src/fidelity.ts:214](../../packages/store/src/fidelity.ts#L214) `calcFidelity` | `Calculations.executeSQL` (214, 215, 301); `Store.sql` (219, 227, 300); `SQLite.all` (227); `SQLite.prepare` (227); `Calculations.computeStored` (263) | DESIGN |
| [packages/store/src/fmexport.ts:233](../../packages/store/src/fmexport.ts#L233) `fmExport` | `Store.recordCount` (233); `Store.query` (234); `Store.containerInfo` (249); `Store.container` (256) | OPERATOR |
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
| [packages/store/src/store.ts:865](../../packages/store/src/store.ts#L865) `Store/metadataVersions` | `SQLite.get` (865); `SQLite.prepare` (865); `Store.sql` (865) | CORE |
| [packages/store/src/store.ts:1000](../../packages/store/src/store.ts#L1000) `Store/constructor` | `Store.sql` (1000, 1002, 1004, 1005, 1009, 1013, 1014, 1025, 1030, 1035, 1036, 1040, 1041, 1042, 1049, 1053, 1057, 1058, 1059, 1063, 1067, 1070, 1071, 1073, 1074, 1077, 1078, 1082, 1083, 1087, 1088, 1091, 1093, 1096, 1097, 1101, 1102, 1106, 1107, 1110, 1111, 1112, 1115, 1116, 1119, 1120, 1122, 1122, 1123, 1123, 1124, 1127, 1131, 1133, 1136, 1137, 1138, 1141, 1142, 1144, 1146, 1147, 1152, 1153, 1154, 1154, 1158, 1159); `SQLite.get` (1004); `SQLite.prepare` (1004, 1070, 1071, 1074, 1077, 1082, 1087, 1096, 1101, 1106, 1115, 1119, 1122, 1123, 1141, 1146); `SQLite.all` (1070, 1077, 1082, 1087, 1096, 1101, 1106, 1115, 1119, 1122, 1123, 1141, 1146) | CORE |
| [packages/store/src/store.ts:1178](../../packages/store/src/store.ts#L1178) `Store/grantFullAccessClients` | `SQLite.prepare` (1178); `Store.sql` (1178) | CORE |
| [packages/store/src/store.ts:1195](../../packages/store/src/store.ts#L1195) `Store/meta` | `SQLite.get` (1195); `SQLite.prepare` (1195); `Store.sql` (1195) | CORE |
| [packages/store/src/store.ts:1203](../../packages/store/src/store.ts#L1203) `Store/persistentTable` | `Store.sql` (1203) | CORE |
| [packages/store/src/store.ts:1213](../../packages/store/src/store.ts#L1213) `Store/persistentData` | `SQLite.get` (1213) | CORE |
| [packages/store/src/store.ts:1222](../../packages/store/src/store.ts#L1222) `Store/persistentDataIds` | `SQLite.all` (1222) | CORE |
| [packages/store/src/store.ts:1228](../../packages/store/src/store.ts#L1228) `Store/setPersistentData` | `SQLite.prepare` (1228, 1232); `Store.sql` (1228, 1232) | CORE |
| [packages/store/src/store.ts:1245](../../packages/store/src/store.ts#L1245) `Store/checkpoint` | `SQLite.get` (1245); `SQLite.prepare` (1245); `Store.sql` (1245) | CORE |
| [packages/store/src/store.ts:1253](../../packages/store/src/store.ts#L1253) `Store/recordedFormat` | `Store.sql` (1253) | CORE |
| [packages/store/src/store.ts:1263](../../packages/store/src/store.ts#L1263) `Store/close` | `Store.sql` (1263) | CORE |
| [packages/store/src/store.ts:1279](../../packages/store/src/store.ts#L1279) `Store/shipWal` | `Store.sql` (1279) | CORE |
| [packages/store/src/store.ts:1290](../../packages/store/src/store.ts#L1290) `Store/trial` | `Store.sql` (1290) | CORE |
| [packages/store/src/store.ts:1295](../../packages/store/src/store.ts#L1295) `Store/trial/undo` | `Store.sql` (1295) | CORE |
| [packages/store/src/store.ts:1330](../../packages/store/src/store.ts#L1330) `Store/joinTransaction` | `Store.sql` (1330, 1331, 1333, 1335, 1341) | CORE |
| [packages/store/src/store.ts:1353](../../packages/store/src/store.ts#L1353) `Store/independentWindowWrite` | `SQLite.get` (1353); `SQLite.prepare` (1353, 1376); `Store.sql` (1353, 1356, 1371, 1376, 1379) | CORE |
| [packages/store/src/store.ts:1401](../../packages/store/src/store.ts#L1401) `Store/withWriteTransaction` | `Store.sql` (1401, 1404, 1408, 1410, 1410) | CORE |
| [packages/store/src/store.ts:1440](../../packages/store/src/store.ts#L1440) `Store/endTransaction` | `Store.sql` (1440, 1443, 1443) | CORE |
| [packages/store/src/store.ts:1469](../../packages/store/src/store.ts#L1469) `Store/backup` | `Store.sql` (1469) | CORE |
| [packages/store/src/store.ts:1493](../../packages/store/src/store.ts#L1493) `Store/dataVersion` | `SQLite.get` (1493); `SQLite.prepare` (1493); `Store.sql` (1493) | CORE |
| [packages/store/src/store.ts:1533](../../packages/store/src/store.ts#L1533) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1533) | CORE |
| [packages/store/src/store.ts:1554](../../packages/store/src/store.ts#L1554) `Store/shareResults` | `Store.sql` (1554) | CORE |
| [packages/store/src/store.ts:1564](../../packages/store/src/store.ts#L1564) `Store/versionTriggers` | `SQLite.get` (1564); `SQLite.prepare` (1564, 1569, 1570); `Store.sql` (1564, 1566, 1567, 1569, 1570, 1579, 1580); `SQLite.all` (1569, 1570) | CORE |
| [packages/store/src/store.ts:1596](../../packages/store/src/store.ts#L1596) `Store/versionNumber` | `SQLite.get` (1596); `SQLite.prepare` (1596); `Store.sql` (1596) | CORE |
| [packages/store/src/store.ts:1609](../../packages/store/src/store.ts#L1609) `Store/changeOne` | `Store.sql` (1609, 1611) | CORE |
| [packages/store/src/store.ts:1612](../../packages/store/src/store.ts#L1612) `Store/changeOne/read` | `SQLite.get` (1612); `SQLite.prepare` (1612); `Store.sql` (1612) | CORE |
| [packages/store/src/store.ts:1651](../../packages/store/src/store.ts#L1651) `Store/writeToken` | `SQLite.get` (1651); `SQLite.prepare` (1651); `Store.sql` (1651) | CORE |
| [packages/store/src/store.ts:1663](../../packages/store/src/store.ts#L1663) `Store/recordCount` | `SQLite.get` (1663); `SQLite.prepare` (1663); `Store.sql` (1663) | CORE |
| [packages/store/src/store.ts:1771](../../packages/store/src/store.ts#L1771) `Store/applyDesign` | `Store.sql` (1771, 1772, 1783, 1786, 1791, 1803, 1806, 1806); `SQLite.prepare` (1786, 1791) | CORE |
| [packages/store/src/store.ts:1864](../../packages/store/src/store.ts#L1864) `Store/auditLog` | `SQLite.all` (1864); `SQLite.prepare` (1864); `Store.sql` (1864) | CORE |
| [packages/store/src/store.ts:1904](../../packages/store/src/store.ts#L1904) `Store/securityEvents` | `Store.auditLog` (1904) | CORE |
| [packages/store/src/store.ts:1930](../../packages/store/src/store.ts#L1930) `Store/prepared` | `SQLite.prepare` (1930); `Store.sql` (1930) | CORE |
| [packages/store/src/store.ts:1945](../../packages/store/src/store.ts#L1945) `Store/recordAsOf` | `SQLite.get` (1945, 1947); `SQLite.prepare` (1945, 1947, 1949, 1950); `Store.sql` (1945, 1947, 1949, 1950); `SQLite.all` (1949, 1950) | CORE |
| [packages/store/src/store.ts:1975](../../packages/store/src/store.ts#L1975) `Store/restoreRecord` | `Store.recordAsOf` (1975); `SQLite.get` (1979); `SQLite.prepare` (1979, 1982, 1989, 1996); `Store.sql` (1979, 1982, 1989, 1996) | CORE |
| [packages/store/src/store.ts:2010](../../packages/store/src/store.ts#L2010) `Store/revertAuditEntry` | `Store.auditLog` (2010) | CORE |
| [packages/store/src/store.ts:2103](../../packages/store/src/store.ts#L2103) `Store/setAuditSettings` | `SQLite.prepare` (2103); `Store.sql` (2103) | CORE |
| [packages/store/src/store.ts:2125](../../packages/store/src/store.ts#L2125) `Store/pruneAudit` | `Store.sql` (2125, 2127, 2129); `SQLite.get` (2127); `SQLite.prepare` (2127) | CORE |
| [packages/store/src/store.ts:2207](../../packages/store/src/store.ts#L2207) `Store/audit` | `Store.sql` (2207) | CORE |
| [packages/store/src/store.ts:2296](../../packages/store/src/store.ts#L2296) `Store/securityChange` | `Store.sql` (2296, 2298); `SQLite.prepare` (2298) | CORE |
| [packages/store/src/store.ts:2345](../../packages/store/src/store.ts#L2345) `Store/logSecurity` | `Store.sql` (2345) | CORE |
| [packages/store/src/store.ts:2368](../../packages/store/src/store.ts#L2368) `Store/ensureDeleted` | `Store.sql` (2368) | CORE |
| [packages/store/src/store.ts:2373](../../packages/store/src/store.ts#L2373) `Store/deletedRows` | `SQLite.get` (2373); `SQLite.prepare` (2373, 2375, 2375); `Store.sql` (2373, 2375, 2375); `SQLite.all` (2375, 2375) | CORE |
| [packages/store/src/store.ts:2399](../../packages/store/src/store.ts#L2399) `Store/emptyDeleted` | `Store.sql` (2399, 2402, 2403, 2405, 2407); `SQLite.prepare` (2403) | CORE |
| [packages/store/src/store.ts:2414](../../packages/store/src/store.ts#L2414) `Store/designHistory` | `SQLite.all` (2414); `SQLite.prepare` (2414); `Store.sql` (2414) | CORE |
| [packages/store/src/store.ts:2421](../../packages/store/src/store.ts#L2421) `Store/scriptHistory` | `SQLite.all` (2421); `SQLite.prepare` (2421); `Store.sql` (2421) | CORE |
| [packages/store/src/store.ts:2431](../../packages/store/src/store.ts#L2431) `Store/layoutHistory` | `SQLite.all` (2431); `SQLite.prepare` (2431); `Store.sql` (2431) | CORE |
| [packages/store/src/store.ts:2456](../../packages/store/src/store.ts#L2456) `Store/designEffect/renameKey` | `SQLite.prepare` (2456); `Store.sql` (2456) | CORE |
| [packages/store/src/store.ts:2472](../../packages/store/src/store.ts#L2472) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2472); `Store.sql` (2472) | CORE |
| [packages/store/src/store.ts:2479](../../packages/store/src/store.ts#L2479) `Store/designEffect` | `Store.sql` (2479, 2483, 2488, 2493, 2496, 2502, 2510, 2511, 2513, 2525, 2526, 2529, 2531, 2537, 2538, 2539, 2544, 2546, 2550, 2553, 2554, 2556, 2559, 2564, 2566, 2573, 2574, 2576, 2577, 2578, 2579, 2586, 2587, 2589, 2589, 2591, 2592, 2593, 2597, 2601, 2603, 2641, 2643, 2645); `SQLite.get` (2510, 2525, 2537, 2538, 2550, 2554, 2589, 2597); `SQLite.prepare` (2510, 2511, 2525, 2526, 2537, 2538, 2544, 2546, 2550, 2554, 2564, 2566, 2579, 2586, 2587, 2589, 2591, 2593, 2597, 2601); `SQLite.all` (2586, 2587); `SQLite.iterate` (2591) | CORE |
| [packages/store/src/store.ts:2653](../../packages/store/src/store.ts#L2653) `Store/dropColumnIndexes` | `SQLite.all` (2653, 2655); `SQLite.prepare` (2653, 2655); `Store.sql` (2653, 2655, 2656) | CORE |
| [packages/store/src/store.ts:2665](../../packages/store/src/store.ts#L2665) `Store/recompute` | `SQLite.prepare` (2665, 2669); `Store.sql` (2665, 2669); `SQLite.iterate` (2669); `Calculations.computeStoredStyled` (2670); `Calculations.value` (2670) | CORE |
| [packages/store/src/store.ts:2685](../../packages/store/src/store.ts#L2685) `Store/linkPrincipal` | `SQLite.get` (2685); `SQLite.prepare` (2685); `Store.sql` (2685) | CORE |
| [packages/store/src/store.ts:2692](../../packages/store/src/store.ts#L2692) `Store/linkIdentity` | `SQLite.get` (2692); `SQLite.prepare` (2692); `Store.sql` (2692) | CORE |
| [packages/store/src/store.ts:2698](../../packages/store/src/store.ts#L2698) `Store/accountsSharingLockout` | `SQLite.all` (2698); `SQLite.prepare` (2698); `Store.sql` (2698) | CORE |
| [packages/store/src/store.ts:2702](../../packages/store/src/store.ts#L2702) `Store/accounts` | `SQLite.all` (2702); `SQLite.prepare` (2702); `Store.sql` (2702) | CORE |
| [packages/store/src/store.ts:2714](../../packages/store/src/store.ts#L2714) `Store/isAgent` | `SQLite.get` (2714); `SQLite.prepare` (2714); `Store.sql` (2714) | CORE |
| [packages/store/src/store.ts:2720](../../packages/store/src/store.ts#L2720) `Store/agentNeedsApproval` | `SQLite.get` (2720); `SQLite.prepare` (2720); `Store.sql` (2720) | CORE |
| [packages/store/src/store.ts:2726](../../packages/store/src/store.ts#L2726) `Store/blankPasswordAccounts` | `SQLite.all` (2726); `SQLite.prepare` (2726); `Store.sql` (2726) | CORE |
| [packages/store/src/store.ts:1186](../../packages/store/src/store.ts#L1186) `Store/hasOwnPassword` | `SQLite.get` (1186); `SQLite.prepare` (1186); `Store.sql` (1186) | CORE |
| [packages/store/src/store.ts:2737](../../packages/store/src/store.ts#L2737) `Store/unmigratedAccounts` | `SQLite.all` (2737); `SQLite.prepare` (2737); `Store.sql` (2737) | CORE |
| [packages/store/src/store.ts:2790](../../packages/store/src/store.ts#L2790) `Store/setExternalAccount` | `SQLite.get` (2790); `SQLite.prepare` (2790, 2795); `Store.sql` (2790, 2795) | CORE |
| [packages/store/src/store.ts:2808](../../packages/store/src/store.ts#L2808) `Store/refuseLookalikeAccount` | `SQLite.all` (2808); `SQLite.prepare` (2808); `Store.sql` (2808) | CORE |
| [packages/store/src/store.ts:2817](../../packages/store/src/store.ts#L2817) `Store/isExternal` | `SQLite.get` (2817); `SQLite.prepare` (2817); `Store.sql` (2817) | CORE |
| [packages/store/src/store.ts:2838](../../packages/store/src/store.ts#L2838) `Store/setAgentAccount` | `SQLite.get` (2838); `SQLite.prepare` (2838, 2844); `Store.sql` (2838, 2844) | CORE |
| [packages/store/src/store.ts:2878](../../packages/store/src/store.ts#L2878) `Store/gateAgentWrite` | `SQLite.prepare` (2878); `Store.sql` (2878) | CORE |
| [packages/store/src/store.ts:2900](../../packages/store/src/store.ts#L2900) `Store/pendingChanges` | `SQLite.all` (2900); `SQLite.prepare` (2900); `Store.sql` (2900) | CORE |
| [packages/store/src/store.ts:2914](../../packages/store/src/store.ts#L2914) `Store/approvePending` | `SQLite.get` (2914); `SQLite.prepare` (2914, 2925); `Store.sql` (2914, 2925) | CORE |
| [packages/store/src/store.ts:2935](../../packages/store/src/store.ts#L2935) `Store/rejectPending` | `SQLite.get` (2935); `SQLite.prepare` (2935, 2937); `Store.sql` (2935, 2937) | CORE |
| [packages/store/src/store.ts:2957](../../packages/store/src/store.ts#L2957) `Store/externalAccount` | `SQLite.all` (2957); `SQLite.prepare` (2957); `Store.sql` (2957) | CORE |
| [packages/store/src/store.ts:2988](../../packages/store/src/store.ts#L2988) `Store/setPassword` | `SQLite.get` (2988); `SQLite.prepare` (2988, 2990, 2999); `Store.sql` (2988, 2990, 2999) | AUTH |
| [packages/store/src/store.ts:3013](../../packages/store/src/store.ts#L3013) `Store/createAccount` | `SQLite.get` (3013); `SQLite.prepare` (3013, 3017, 3023, 3028, 3033); `Store.sql` (3013, 3017, 3023, 3028, 3033) | CORE |
| [packages/store/src/store.ts:3041](../../packages/store/src/store.ts#L3041) `Store/appendSecurityEvent` | `Store.sql` (3041) | CORE |
| [packages/store/src/store.ts:3083](../../packages/store/src/store.ts#L3083) `Store/setPasswordPolicy` | `SQLite.prepare` (3083); `Store.sql` (3083) | CORE |
| [packages/store/src/store.ts:3119](../../packages/store/src/store.ts#L3119) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3119); `Store.sql` (3119) | CORE |
| [packages/store/src/store.ts:3142](../../packages/store/src/store.ts#L3142) `Store/saveScriptTest` | `SQLite.prepare` (3142); `Store.sql` (3142) | CORE |
| [packages/store/src/store.ts:3151](../../packages/store/src/store.ts#L3151) `Store/deleteScriptTest` | `SQLite.prepare` (3151); `Store.sql` (3151) | CORE |
| [packages/store/src/store.ts:3186](../../packages/store/src/store.ts#L3186) `Store/setAiAllowed` | `SQLite.prepare` (3186); `Store.sql` (3186) | CORE |
| [packages/store/src/store.ts:3232](../../packages/store/src/store.ts#L3232) `Store/setAiPolicy` | `SQLite.prepare` (3232); `Store.sql` (3232) | CORE |
| [packages/store/src/store.ts:3201](../../packages/store/src/store.ts#L3201) `Store/setScriptNetwork` | `SQLite.prepare` (3201); `Store.sql` (3201) | CORE |
| [packages/store/src/store.ts:3221](../../packages/store/src/store.ts#L3221) `Store/setWebViewerHosts` | `SQLite.prepare` (3221); `Store.sql` (3221) | CORE |
| [packages/store/src/store.ts:3252](../../packages/store/src/store.ts#L3252) `Store/setPiiIsolation` | `SQLite.prepare` (3252); `Store.sql` (3252) | CORE |
| [packages/store/src/store.ts:3274](../../packages/store/src/store.ts#L3274) `Store/markPiiField` | `SQLite.prepare` (3274); `Store.sql` (3274) | CORE |
| [packages/store/src/store.ts:3388](../../packages/store/src/store.ts#L3388) `Store/lastSignIns` | `Store.auditLog` (3388) | CORE |
| [packages/store/src/store.ts:3591](../../packages/store/src/store.ts#L3591) `Store/unusualAccess` | `Store.auditLog` (3591, 3657) | CORE |
| [packages/store/src/store.ts:3688](../../packages/store/src/store.ts#L3688) `Store/leastPrivilege` | `SQLite.all` (3688); `SQLite.prepare` (3688); `Store.sql` (3688) | CORE |
| [packages/store/src/store.ts:3761](../../packages/store/src/store.ts#L3761) `Store/unusedAccess` | `SQLite.get` (3761); `SQLite.prepare` (3761, 3770); `Store.sql` (3761, 3770); `SQLite.all` (3770) | CORE |
| [packages/store/src/store.ts:3809](../../packages/store/src/store.ts#L3809) `Store/unusedObjects` | `SQLite.get` (3809); `SQLite.prepare` (3809, 3812); `Store.sql` (3809, 3812); `SQLite.all` (3812) | CORE |
| [packages/store/src/store.ts:3847](../../packages/store/src/store.ts#L3847) `Store/usageCounting` | `SQLite.get` (3847); `SQLite.prepare` (3847); `Store.sql` (3847) | CORE |
| [packages/store/src/store.ts:3855](../../packages/store/src/store.ts#L3855) `Store/setMustChangePassword` | `SQLite.prepare` (3855); `Store.sql` (3855) | CORE |
| [packages/store/src/store.ts:3869](../../packages/store/src/store.ts#L3869) `Store/mustChangePassword` | `SQLite.get` (3869); `SQLite.prepare` (3869); `Store.sql` (3869) | CORE |
| [packages/store/src/store.ts:3908](../../packages/store/src/store.ts#L3908) `Store/passwordDaysRemaining` | `SQLite.get` (3908); `SQLite.prepare` (3908); `Store.sql` (3908) | CORE |
| [packages/store/src/store.ts:3915](../../packages/store/src/store.ts#L3915) `Store/importAccounts` | `SQLite.all` (3915); `SQLite.prepare` (3915); `Store.sql` (3915) | CORE |
| [packages/store/src/store.ts:3938](../../packages/store/src/store.ts#L3938) `Store/canonicalAccount` | `SQLite.all` (3938); `SQLite.prepare` (3938); `Store.sql` (3938) | CORE |
| [packages/store/src/store.ts:3950](../../packages/store/src/store.ts#L3950) `Store/createLocalAccount` | `SQLite.prepare` (3950); `Store.sql` (3950) | CORE |
| [packages/store/src/store.ts:3980](../../packages/store/src/store.ts#L3980) `Store/previewAccountImport` | `Store.sql` (3980, 3981, 3990) | CORE |
| [packages/store/src/store.ts:3998](../../packages/store/src/store.ts#L3998) `Store/limitAccountImport` | `SQLite.prepare` (3998, 3999, 4002); `Store.sql` (3998, 3999, 4002); `SQLite.get` (3999) | CORE |
| [packages/store/src/store.ts:4009](../../packages/store/src/store.ts#L4009) `Store/applyAccountImport` | `Store.sql` (4009, 4017, 4046); `SQLite.get` (4017); `SQLite.prepare` (4017, 4046) | CORE |
| [packages/store/src/store.ts:4071](../../packages/store/src/store.ts#L4071) `Store/forgetStandIns` | `SQLite.prepare` (4071); `Store.sql` (4071) | CORE |
| [packages/store/src/store.ts:4104](../../packages/store/src/store.ts#L4104) `Store/deleteAccount` | `SQLite.prepare` (4104, 4105, 4106, 4108, 4112); `Store.sql` (4104, 4105, 4106, 4108, 4112) | CORE |
| [packages/store/src/store.ts:4129](../../packages/store/src/store.ts#L4129) `Store/setAccountActive` | `SQLite.prepare` (4129, 4132, 4133); `Store.sql` (4129, 4132, 4133) | AUTH |
| [packages/store/src/store.ts:4143](../../packages/store/src/store.ts#L4143) `Store/accountInactive` | `SQLite.get` (4143); `SQLite.prepare` (4143); `Store.sql` (4143) | CORE |
| [packages/store/src/store.ts:4148](../../packages/store/src/store.ts#L4148) `Store/identityAllowed` | `SQLite.get` (4148, 4154, 4160); `SQLite.prepare` (4148, 4154, 4160); `Store.sql` (4148, 4154, 4160) | CORE |
| [packages/store/src/store.ts:4168](../../packages/store/src/store.ts#L4168) `Store/externalIdentityId` | `SQLite.get` (4168, 4174); `SQLite.prepare` (4168, 4173, 4174); `Store.sql` (4168, 4173, 4174) | CORE |
| [packages/store/src/store.ts:4179](../../packages/store/src/store.ts#L4179) `Store/accountIdentityId` | `SQLite.get` (4179, 4184); `SQLite.prepare` (4179, 4183, 4184); `Store.sql` (4179, 4183, 4184) | CORE |
| [packages/store/src/store.ts:4207](../../packages/store/src/store.ts#L4207) `Store/signInMark` | `SQLite.prepare` (4207); `Store.sql` (4207) | AUTH |
| [packages/store/src/store.ts:4217](../../packages/store/src/store.ts#L4217) `Store/signInBase` | `SQLite.get` (4217); `SQLite.prepare` (4217); `Store.sql` (4217) | AUTH |
| [packages/store/src/store.ts:4219](../../packages/store/src/store.ts#L4219) `Store/signInBase/identity` | `SQLite.get` (4219); `SQLite.prepare` (4219); `Store.sql` (4219) | AUTH |
| [packages/store/src/store.ts:4231](../../packages/store/src/store.ts#L4231) `Store/ledgerRow` | `SQLite.get` (4231, 4232); `SQLite.prepare` (4231, 4232); `Store.sql` (4231, 4232) | AUTH |
| [packages/store/src/store.ts:4243](../../packages/store/src/store.ts#L4243) `Store/ledgerWrite` | `Store.sql` (4243, 4244, 4246, 4248, 4251, 4251) | AUTH |
| [packages/store/src/store.ts:4270](../../packages/store/src/store.ts#L4270) `Store/settleSignIns` | `SQLite.all` (4270, 4276); `SQLite.prepare` (4270, 4276, 4282, 4286, 4288); `Store.sql` (4270, 4276, 4282, 4286, 4288) | AUTH |
| [packages/store/src/store.ts:4299](../../packages/store/src/store.ts#L4299) `Store/securityToken` | `SQLite.get` (4299); `SQLite.prepare` (4299); `Store.sql` (4299) | CORE |
| [packages/store/src/store.ts:4307](../../packages/store/src/store.ts#L4307) `Store/accountLocalOnly` | `SQLite.get` (4307); `SQLite.prepare` (4307); `Store.sql` (4307) | CORE |
| [packages/store/src/store.ts:4312](../../packages/store/src/store.ts#L4312) `Store/accountRequires2fa` | `SQLite.get` (4312); `SQLite.prepare` (4312); `Store.sql` (4312) | CORE |
| [packages/store/src/store.ts:4318](../../packages/store/src/store.ts#L4318) `Store/setAccountLocalOnly` | `SQLite.prepare` (4318); `Store.sql` (4318) | CORE |
| [packages/store/src/store.ts:4327](../../packages/store/src/store.ts#L4327) `Store/setAccountRequire2fa` | `SQLite.prepare` (4327); `Store.sql` (4327) | CORE |
| [packages/store/src/store.ts:4356](../../packages/store/src/store.ts#L4356) `Store/createApiToken` | `SQLite.get` (4356); `SQLite.prepare` (4356, 4386); `Store.sql` (4356, 4386) | CORE |
| [packages/store/src/store.ts:4433](../../packages/store/src/store.ts#L4433) `Store/recordObjectUse` | `Store.sql` (4433) | CORE |
| [packages/store/src/store.ts:4463](../../packages/store/src/store.ts#L4463) `Store/writeUsage` | `Store.sql` (4463, 4464, 4466, 4470, 4472) | CORE |
| [packages/store/src/store.ts:4479](../../packages/store/src/store.ts#L4479) `Store/writeUsageRows` | `SQLite.prepare` (4479, 4480, 4486); `Store.sql` (4479, 4480, 4486) | CORE |
| [packages/store/src/store.ts:4491](../../packages/store/src/store.ts#L4491) `Store/writeObjectUseRows` | `SQLite.prepare` (4491, 4492, 4497); `Store.sql` (4491, 4492, 4497) | CORE |
| [packages/store/src/store.ts:4502](../../packages/store/src/store.ts#L4502) `Store/objectUseSince` | `SQLite.get` (4502); `SQLite.prepare` (4502); `Store.sql` (4502) | CORE |
| [packages/store/src/store.ts:4515](../../packages/store/src/store.ts#L4515) `Store/accountUsage` | `SQLite.get` (4515); `SQLite.prepare` (4515, 4516); `Store.sql` (4515, 4516); `SQLite.all` (4516); `Store.auditLog` (4532) | CORE |
| [packages/store/src/store.ts:4548](../../packages/store/src/store.ts#L4548) `Store/apiTokens` | `SQLite.all` (4548); `SQLite.prepare` (4548); `Store.sql` (4548) | CORE |
| [packages/store/src/store.ts:4558](../../packages/store/src/store.ts#L4558) `Store/revokeApiToken` | `SQLite.prepare` (4558); `Store.sql` (4558) | CORE |
| [packages/store/src/store.ts:4572](../../packages/store/src/store.ts#L4572) `Store/apiToken` | `SQLite.get` (4572); `SQLite.prepare` (4572, 4584); `Store.sql` (4572, 4584) | CORE |
| [packages/store/src/store.ts:4600](../../packages/store/src/store.ts#L4600) `Store/enrollTotp` | `SQLite.prepare` (4600); `Store.sql` (4600) | CORE |
| [packages/store/src/store.ts:4611](../../packages/store/src/store.ts#L4611) `Store/confirmTotp` | `SQLite.get` (4611); `SQLite.prepare` (4611, 4613); `Store.sql` (4611, 4613) | CORE |
| [packages/store/src/store.ts:4621](../../packages/store/src/store.ts#L4621) `Store/hasTotp` | `SQLite.get` (4621); `SQLite.prepare` (4621); `Store.sql` (4621) | CORE |
| [packages/store/src/store.ts:4626](../../packages/store/src/store.ts#L4626) `Store/totpAccounts` | `SQLite.all` (4626); `SQLite.prepare` (4626); `Store.sql` (4626) | CORE |
| [packages/store/src/store.ts:4632](../../packages/store/src/store.ts#L4632) `Store/disableTotp` | `SQLite.prepare` (4632); `Store.sql` (4632) | CORE |
| [packages/store/src/store.ts:4655](../../packages/store/src/store.ts#L4655) `Store/verifyTotp` | `SQLite.get` (4655); `SQLite.prepare` (4655, 4661); `Store.sql` (4655, 4661) | CORE |
| [packages/store/src/store.ts:4674](../../packages/store/src/store.ts#L4674) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4674, 4676, 4677, 4679); `Store.sql` (4674, 4676, 4677, 4679); `SQLite.get` (4676) | CORE |
| [packages/store/src/store.ts:4726](../../packages/store/src/store.ts#L4726) `Store/passkeyAllowList` | `SQLite.all` (4726); `SQLite.prepare` (4726); `Store.sql` (4726) | CORE |
| [packages/store/src/store.ts:4740](../../packages/store/src/store.ts#L4740) `Store/takeWebauthnChallenge` | `SQLite.get` (4740); `SQLite.prepare` (4740, 4742); `Store.sql` (4740, 4742) | CORE |
| [packages/store/src/store.ts:4750](../../packages/store/src/store.ts#L4750) `Store/passkeys` | `SQLite.all` (4750); `SQLite.prepare` (4750); `Store.sql` (4750) | CORE |
| [packages/store/src/store.ts:4757](../../packages/store/src/store.ts#L4757) `Store/hasPasskey` | `SQLite.get` (4757); `SQLite.prepare` (4757); `Store.sql` (4757) | CORE |
| [packages/store/src/store.ts:4762](../../packages/store/src/store.ts#L4762) `Store/passkeyIds` | `SQLite.all` (4762); `SQLite.prepare` (4762); `Store.sql` (4762) | CORE |
| [packages/store/src/store.ts:4784](../../packages/store/src/store.ts#L4784) `Store/registerPasskey` | `SQLite.prepare` (4784); `Store.sql` (4784) | CORE |
| [packages/store/src/store.ts:4795](../../packages/store/src/store.ts#L4795) `Store/removePasskey` | `SQLite.get` (4795); `SQLite.prepare` (4795, 4796); `Store.sql` (4795, 4796) | CORE |
| [packages/store/src/store.ts:4812](../../packages/store/src/store.ts#L4812) `Store/verifyPasskeyAssertion` | `SQLite.get` (4812); `SQLite.prepare` (4812, 4823); `Store.sql` (4812, 4823) | CORE |
| [packages/store/src/store.ts:4859](../../packages/store/src/store.ts#L4859) `Store/generateRecoveryCodes` | `SQLite.prepare` (4859, 4862); `Store.sql` (4859, 4862) | CORE |
| [packages/store/src/store.ts:4877](../../packages/store/src/store.ts#L4877) `Store/recoveryCodesRemaining` | `SQLite.get` (4877); `SQLite.prepare` (4877); `Store.sql` (4877) | CORE |
| [packages/store/src/store.ts:4887](../../packages/store/src/store.ts#L4887) `Store/useRecoveryCode` | `SQLite.get` (4887); `SQLite.prepare` (4887, 4889); `Store.sql` (4887, 4889) | CORE |
| [packages/store/src/store.ts:4900](../../packages/store/src/store.ts#L4900) `Store/privilegeSets` | `Store.sql` (4900) | CORE |
| [packages/store/src/store.ts:4929](../../packages/store/src/store.ts#L4929) `Store/savePrivilegeSet` | `SQLite.prepare` (4929, 4937); `Store.sql` (4929, 4937) | AUTH |
| [packages/store/src/store.ts:4972](../../packages/store/src/store.ts#L4972) `Store/deletePrivilegeSet` | `SQLite.prepare` (4972); `Store.sql` (4972) | CORE |
| [packages/store/src/store.ts:5041](../../packages/store/src/store.ts#L5041) `Store/accountPrivilegeSet` | `SQLite.get` (5041); `SQLite.prepare` (5041); `Store.sql` (5041) | CORE |
| [packages/store/src/store.ts:5055](../../packages/store/src/store.ts#L5055) `Store/setAccountPrivilegeSet` | `SQLite.get` (5055); `SQLite.prepare` (5055, 5058, 5062); `Store.sql` (5055, 5058, 5062) | AUTH |
| [packages/store/src/store.ts:5077](../../packages/store/src/store.ts#L5077) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5077); `Store.sql` (5077) | CORE |
| [packages/store/src/store.ts:5091](../../packages/store/src/store.ts#L5091) `Store/addProvisionedAccount` | `SQLite.get` (5091); `SQLite.prepare` (5091, 5095); `Store.sql` (5091, 5095) | CORE |
| [packages/store/src/store.ts:5264](../../packages/store/src/store.ts#L5264) `Store/ruleOutcome` | `Calculations.context` (5264) | CORE |
| [packages/store/src/store.ts:5305](../../packages/store/src/store.ts#L5305) `Store/allowedIds` | `SQLite.iterate` (5305); `SQLite.prepare` (5305); `Store.sql` (5305) | CORE |
| [packages/store/src/store.ts:5375](../../packages/store/src/store.ts#L5375) `Store/scopedTableSql` | `Store.viewableIds` (5375); `SQLite.all` (5378); `SQLite.prepare` (5378); `Store.sql` (5378) | GATED-STORE |
| [packages/store/src/store.ts:5410](../../packages/store/src/store.ts#L5410) `Store/previewRecordRuleCurrent` | `SQLite.get` (5410); `SQLite.prepare` (5410, 5413); `Store.sql` (5410, 5413); `SQLite.all` (5413); `Calculations.context` (5419, 5435) | CORE |
| [packages/store/src/store.ts:5587](../../packages/store/src/store.ts#L5587) `Store/passwordHash` | `SQLite.get` (5587); `SQLite.prepare` (5587); `Store.sql` (5587) | CORE |
| [packages/store/src/store.ts:5616](../../packages/store/src/store.ts#L5616) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5616); `Store.sql` (5616) | CORE |
| [packages/store/src/store.ts:5629](../../packages/store/src/store.ts#L5629) `Store/knownSharedAccount` | `SQLite.get` (5629); `SQLite.prepare` (5629); `Store.sql` (5629) | CORE |
| [packages/store/src/store.ts:5692](../../packages/store/src/store.ts#L5692) `Store/layouts` | `SQLite.all` (5692); `SQLite.prepare` (5692); `Store.sql` (5692) | CORE |
| [packages/store/src/store.ts:5713](../../packages/store/src/store.ts#L5713) `Store/image` | `SQLite.get` (5713); `SQLite.prepare` (5713); `Store.sql` (5713) | CORE |
| [packages/store/src/store.ts:5723](../../packages/store/src/store.ts#L5723) `Store/images` | `SQLite.all` (5723); `SQLite.prepare` (5723); `Store.sql` (5723) | CORE |
| [packages/store/src/store.ts:5736](../../packages/store/src/store.ts#L5736) `Store/addImage` | `Store.sql` (5736, 5737); `SQLite.prepare` (5737) | CORE |
| [packages/store/src/store.ts:5753](../../packages/store/src/store.ts#L5753) `Store/layout` | `SQLite.get` (5753); `SQLite.prepare` (5753); `Store.sql` (5753) | CORE |
| [packages/store/src/store.ts:5957](../../packages/store/src/store.ts#L5957) `Store/wordIndex` | `Store.sql` (5957, 5965, 5970); `Store.recordCount` (5969); `SQLite.get` (5970); `SQLite.prepare` (5970) | CORE |
| [packages/store/src/store.ts:6022](../../packages/store/src/store.ts#L6022) `Store/toRecord` | `Calculations.value` (6022, 6032); `Calculations.globalValue` (6026); `Calculations.unstoredStyled` (6031) | CORE |
| [packages/store/src/store.ts:6081](../../packages/store/src/store.ts#L6081) `Store/relatedValues` | `Calculations.globalValue` (6081); `Calculations.unstoredValue` (6083) | CORE |
| [packages/store/src/store.ts:6155](../../packages/store/src/store.ts#L6155) `Store/addRelated` | `relatedRows` (6155); `rowsById` (6187); `firstRelatedEach` (6209) | CORE |
| [packages/store/src/store.ts:6237](../../packages/store/src/store.ts#L6237) `Store/foundSetPage` | `rowsById` (6237) | CORE |
| [packages/store/src/store.ts:6253](../../packages/store/src/store.ts#L6253) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6253); `Store.row` (6269) | GATED-STORE |
| [packages/store/src/store.ts:6292](../../packages/store/src/store.ts#L6292) `Store/portalCountsCurrent` | `Store.canView` (6292); `Store.row` (6319) | GATED-STORE |
| [packages/store/src/store.ts:6355](../../packages/store/src/store.ts#L6355) `Store/fieldIndexCurrent` | `SQLite.iterate` (6355); `SQLite.prepare` (6355, 6360); `Store.sql` (6355, 6360); `SQLite.all` (6360) | GATED-STORE |
| [packages/store/src/store.ts:6401](../../packages/store/src/store.ts#L6401) `Store/valueListItemsCurrent` | `Store.valueListItems` (6401); `Store.get` (6415); `relatedRows` (6416); `Store.row` (6416); `SQLite.iterate` (6418); `SQLite.prepare` (6418); `Store.sql` (6418); `Calculations.related` (6428); `Calculations.value` (6432, 6433) | GATED-STORE |
| [packages/store/src/store.ts:6530](../../packages/store/src/store.ts#L6530) `Store/portalRows` | `relatedRows` (6530); `relatedIdList` (6531); `Store.viewableIds` (6534); `rowsById` (6559, 6597); `Calculations.related` (6573) | CORE |
| [packages/store/src/store.ts:6541](../../packages/store/src/store.ts#L6541) `Store/portalRows/context` | `Calculations.context` (6541) | CORE |
| [packages/store/src/store.ts:6551](../../packages/store/src/store.ts#L6551) `Store/portalRows/valueOf` | `Calculations.value` (6551) | CORE |
| [packages/store/src/store.ts:6668](../../packages/store/src/store.ts#L6668) `Store/markRepeating` | `SQLite.prepare` (6668); `Store.sql` (6668) | CORE |
| [packages/store/src/store.ts:6695](../../packages/store/src/store.ts#L6695) `Store/externalContainerCheck` | `SQLite.all` (6695); `SQLite.prepare` (6695); `Store.sql` (6695) | CORE |
| [packages/store/src/store.ts:6702](../../packages/store/src/store.ts#L6702) `Store/externalContainerCount` | `SQLite.get` (6702); `SQLite.prepare` (6702); `Store.sql` (6702) | CORE |
| [packages/store/src/store.ts:6711](../../packages/store/src/store.ts#L6711) `Store/externalContainerReport` | `SQLite.all` (6711, 6724); `SQLite.prepare` (6711, 6724); `Store.sql` (6711, 6724) | CORE |
| [packages/store/src/store.ts:6766](../../packages/store/src/store.ts#L6766) `Store/orphanContainerReport` | `SQLite.all` (6766, 6784, 6786, 6792, 6805, 6818, 6837, 6855); `SQLite.prepare` (6766, 6784, 6786, 6792, 6805, 6818, 6835, 6837, 6855); `Store.sql` (6766, 6784, 6786, 6792, 6805, 6818, 6835, 6837, 6855); `SQLite.get` (6835); `Store.row` (6849) | CORE |
| [packages/store/src/store.ts:6866](../../packages/store/src/store.ts#L6866) `Store/purgeOrphanContainers` | `Store.sql` (6866, 6875, 6878, 6880, 6881, 6886, 6888); `Store.orphanContainerReport` (6867); `SQLite.get` (6875); `SQLite.prepare` (6875, 6880, 6881) | CORE |
| [packages/store/src/store.ts:6901](../../packages/store/src/store.ts#L6901) `Store/containerIntact` | `SQLite.get` (6901); `SQLite.prepare` (6901); `Store.sql` (6901) | CORE |
| [packages/store/src/store.ts:6911](../../packages/store/src/store.ts#L6911) `Store/externalOf` | `SQLite.get` (6911); `SQLite.prepare` (6911); `Store.sql` (6911) | CORE |
| [packages/store/src/store.ts:6915](../../packages/store/src/store.ts#L6915) `Store/containerMeta` | `SQLite.get` (6915); `SQLite.prepare` (6915); `Store.sql` (6915) | CORE |
| [packages/store/src/store.ts:6920](../../packages/store/src/store.ts#L6920) `Store/container` | `SQLite.get` (6920); `SQLite.prepare` (6920, 6929); `Store.sql` (6920, 6929); `SQLite.all` (6929) | CORE |
| [packages/store/src/store.ts:6937](../../packages/store/src/store.ts#L6937) `Store/containerInfo` | `SQLite.get` (6937); `SQLite.prepare` (6937); `Store.sql` (6937) | CORE |
| [packages/store/src/store.ts:6971](../../packages/store/src/store.ts#L6971) `Store/containerRange` | `SQLite.all` (6971); `SQLite.prepare` (6971, 6978); `Store.sql` (6971, 6978); `SQLite.get` (6978) | CORE |
| [packages/store/src/store.ts:6991](../../packages/store/src/store.ts#L6991) `Store/addContainer` | `SQLite.prepare` (6991, 6995, 6996); `Store.sql` (6991, 6993, 6995, 6996, 6998, 7001) | CORE |
| [packages/store/src/store.ts:7017](../../packages/store/src/store.ts#L7017) `Store/addExternalContainer` | `SQLite.prepare` (7017); `Store.sql` (7017) | CORE |
| [packages/store/src/store.ts:7035](../../packages/store/src/store.ts#L7035) `Store/writeExternalFile` | `Store.evaluateEach` (7035); `SQLite.prepare` (7058); `Store.sql` (7058) | CORE |
| [packages/store/src/store.ts:7059](../../packages/store/src/store.ts#L7059) `Store/writeExternalFile/taken` | `SQLite.get` (7059) | CORE |
| [packages/store/src/store.ts:7084](../../packages/store/src/store.ts#L7084) `Store/embeddedContainers` | `SQLite.prepare` (7084, 7085); `Store.sql` (7084, 7085); `SQLite.all` (7085); `SQLite.get` (7089) | CORE |
| [packages/store/src/store.ts:7098](../../packages/store/src/store.ts#L7098) `Store/embeddedContainerCount` | `SQLite.prepare` (7098); `Store.sql` (7098); `SQLite.get` (7099) | CORE |
| [packages/store/src/store.ts:7107](../../packages/store/src/store.ts#L7107) `Store/recoverContainersOut` | `SQLite.prepare` (7107); `Store.sql` (7107); `SQLite.get` (7110) | CORE |
| [packages/store/src/store.ts:7132](../../packages/store/src/store.ts#L7132) `Store/moveContainersOut` | `Store.sql` (7132, 7140, 7142, 7144, 7146, 7147, 7166, 7171, 7173, 7175, 7176, 7180); `SQLite.get` (7140); `SQLite.prepare` (7140, 7146, 7147); `Store.container` (7149) | CORE |
| [packages/store/src/store.ts:7189](../../packages/store/src/store.ts#L7189) `Store/moveContainersIn` | `Store.sql` (7189, 7193, 7195, 7196, 7197, 7198, 7217, 7220, 7227, 7230, 7233, 7240); `SQLite.prepare` (7195, 7196, 7197, 7198, 7227, 7233); `SQLite.get` (7200, 7227, 7233) | CORE |
| [packages/store/src/store.ts:7252](../../packages/store/src/store.ts#L7252) `Store/compactFile` | `Store.sql` (7252, 7253, 7254) | CORE |
| [packages/store/src/store.ts:7260](../../packages/store/src/store.ts#L7260) `Store/containerId` | `Store.containerId` (7260); `Store.row` (7261) | CORE |
| [packages/store/src/store.ts:7283](../../packages/store/src/store.ts#L7283) `Store/checkContainerWrite` | `Store.row` (7283) | CORE |
| [packages/store/src/store.ts:7293](../../packages/store/src/store.ts#L7293) `Store/setContainer` | `Store.row` (7293); `SQLite.prepare` (7304); `Store.sql` (7304) | CORE |
| [packages/store/src/store.ts:7336](../../packages/store/src/store.ts#L7336) `Store/orderBy` | `Store.valueListItems` (7336) | CORE |
| [packages/store/src/store.ts:7359](../../packages/store/src/store.ts#L7359) `Store/userPrefs` | `SQLite.all` (7359); `SQLite.prepare` (7359); `Store.sql` (7359) | CORE |
| [packages/store/src/store.ts:7364](../../packages/store/src/store.ts#L7364) `Store/hasTable` | `SQLite.get` (7364); `SQLite.prepare` (7364); `Store.sql` (7364) | CORE |
| [packages/store/src/store.ts:7368](../../packages/store/src/store.ts#L7368) `Store/setUserPref` | `Store.sql` (7368, 7369, 7370); `SQLite.prepare` (7369, 7370) | CORE |
| [packages/store/src/store.ts:7376](../../packages/store/src/store.ts#L7376) `Store/indexedFields` | `SQLite.all` (7376, 7377); `SQLite.prepare` (7376, 7377); `Store.sql` (7376, 7377) | CORE |
| [packages/store/src/store.ts:7398](../../packages/store/src/store.ts#L7398) `Store/addFieldIndex` | `Store.sql` (7398) | CORE |
| [packages/store/src/store.ts:7410](../../packages/store/src/store.ts#L7410) `Store/dropFieldIndex` | `SQLite.get` (7410); `SQLite.prepare` (7410); `Store.sql` (7410, 7411) | CORE |
| [packages/store/src/store.ts:7421](../../packages/store/src/store.ts#L7421) `Store/timeFind` | `Store.query` (7421, 7425, 7426); `Store.recordCount` (7428) | CORE |
| [packages/store/src/store.ts:7445](../../packages/store/src/store.ts#L7445) `Store/find` | `Store.find` (7445) | GATED-STORE |
| [packages/store/src/store.ts:7456](../../packages/store/src/store.ts#L7456) `Store/findHere` | `Store.query` (7456, 7461, 7463, 7477, 7479, 7489); `Store.recordCount` (7474); `SQLite.get` (7475, 7479); `SQLite.prepare` (7475, 7479, 7484, 7491, 7500); `Store.sql` (7475, 7479, 7484, 7491, 7500); `SQLite.all` (7484, 7491, 7500) | GATED-STORE |
| [packages/store/src/store.ts:7495](../../packages/store/src/store.ts#L7495) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7495); `SQLite.prepare` (7495); `Store.sql` (7495) | GATED-STORE |
| [packages/store/src/store.ts:7528](../../packages/store/src/store.ts#L7528) `Store/sortedPage` | `SQLite.iterate` (7528); `SQLite.prepare` (7528, 7543); `Store.sql` (7528, 7543); `SQLite.all` (7543) | CORE |
| [packages/store/src/store.ts:7600](../../packages/store/src/store.ts#L7600) `Store/relatedCriteria/matched` | `relatedRows` (7600) | CORE |
| [packages/store/src/store.ts:7603](../../packages/store/src/store.ts#L7603) `Store/relatedCriteria` | `SQLite.iterate` (7603); `SQLite.prepare` (7603); `Store.sql` (7603) | CORE |
| [packages/store/src/store.ts:7629](../../packages/store/src/store.ts#L7629) `Store/computedRows` | `Store.sql` (7629, 7632, 7633, 7634, 7636, 7646, 7647, 7648, 7651); `SQLite.prepare` (7632, 7634, 7636, 7646); `SQLite.iterate` (7636); `Calculations.globalValue` (7639); `Calculations.unstoredValue` (7640); `Calculations.related` (7643); `SQLite.all` (7646) | CORE |
| [packages/store/src/store.ts:7676](../../packages/store/src/store.ts#L7676) `Store/summaries` | `Calculations.wholeTable` (7676); `Calculations.collect` (7696, 7701) | CORE |
| [packages/store/src/store.ts:7692](../../packages/store/src/store.ts#L7692) `Store/summaries/recs` | `SQLite.iterate` (7692); `SQLite.prepare` (7692); `Store.sql` (7692) | CORE |
| [packages/store/src/store.ts:7714](../../packages/store/src/store.ts#L7714) `Store/runningSummaryValues` | `Store.viewableIds` (7714); `rowsById` (7716); `Calculations.value` (7727, 7733); `Calculations.related` (7744) | GATED-STORE |
| [packages/store/src/store.ts:7757](../../packages/store/src/store.ts#L7757) `Store/findSource` | `Store.query` (7757); `Store.sql` (7764, 7765, 7769, 7771, 7782, 7784); `SQLite.prepare` (7765, 7771); `SQLite.iterate` (7771); `Calculations.globalValue` (7775); `Calculations.unstoredValue` (7776); `Calculations.related` (7780) | CORE |
| [packages/store/src/store.ts:7803](../../packages/store/src/store.ts#L7803) `Store/previewRow` | `Store.row` (7803) | CORE |
| [packages/store/src/store.ts:7821](../../packages/store/src/store.ts#L7821) `Store/row` | `SQLite.get` (7821) | CORE |
| [packages/store/src/store.ts:7840](../../packages/store/src/store.ts#L7840) `Store/getCurrent` | `Store.get` (7840); `Store.row` (7841, 7841, 7855); `SQLite.all` (7858); `SQLite.prepare` (7858); `Store.sql` (7858) | GATED-STORE |
| [packages/store/src/store.ts:7878](../../packages/store/src/store.ts#L7878) `Store/getManyCurrent` | `Store.getMany` (7878); `SQLite.get` (7896); `SQLite.prepare` (7896); `Store.sql` (7896) | GATED-STORE |
| [packages/store/src/store.ts:7889](../../packages/store/src/store.ts#L7889) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (7889) | GATED-STORE |
| [packages/store/src/store.ts:7912](../../packages/store/src/store.ts#L7912) `Store/canViewRecord` | `SQLite.get` (7912); `SQLite.prepare` (7912); `Store.sql` (7912) | GATED-STORE |
| [packages/store/src/store.ts:7920](../../packages/store/src/store.ts#L7920) `Store/canView` | `Store.canView` (7920); `Store.row` (7921) | GATED-STORE |
| [packages/store/src/store.ts:7945](../../packages/store/src/store.ts#L7945) `Store/create` | `SQLite.get` (7945, 7951); `SQLite.prepare` (7945, 7951, 7962); `Store.sql` (7945, 7951, 7962) | CORE |
| [packages/store/src/store.ts:7986](../../packages/store/src/store.ts#L7986) `Store/duplicate` | `Store.row` (7986); `SQLite.get` (7990); `SQLite.prepare` (7990, 8003); `Store.sql` (7990, 8003) | CORE |
| [packages/store/src/store.ts:8048](../../packages/store/src/store.ts#L8048) `Store/update` | `Store.row` (8048, 8055, 8066); `Store.sql` (8079, 8080, 8117, 8120) | CORE |
| [packages/store/src/store.ts:8082](../../packages/store/src/store.ts#L8082) `Store/update/undo` | `Store.sql` (8082) | CORE |
| [packages/store/src/store.ts:8224](../../packages/store/src/store.ts#L8224) `Store/setStoredCalcValues` | `SQLite.prepare` (8224, 8225); `Store.sql` (8224, 8225); `SQLite.get` (8229) | CORE |
| [packages/store/src/store.ts:8303](../../packages/store/src/store.ts#L8303) `Store/evaluateCurrent` | `Store.row` (8303, 8303); `Calculations.context` (8304); `Store.get` (8305, 8307) | GATED-STORE |
| [packages/store/src/store.ts:8339](../../packages/store/src/store.ts#L8339) `Store/evaluateEachCurrent` | `Store.row` (8339, 8339); `Calculations.context` (8344); `Store.get` (8346) | GATED-STORE |
| [packages/store/src/store.ts:8379](../../packages/store/src/store.ts#L8379) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8379); `Store.get` (8381) | GATED-STORE |
| [packages/store/src/store.ts:8400](../../packages/store/src/store.ts#L8400) `Store/evaluateRowsCurrent` | `Store.row` (8400, 8400) | GATED-STORE |
| [packages/store/src/store.ts:8414](../../packages/store/src/store.ts#L8414) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8414) | GATED-STORE |
| [packages/store/src/store.ts:8436](../../packages/store/src/store.ts#L8436) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8436) | GATED-STORE |
| [packages/store/src/store.ts:8474](../../packages/store/src/store.ts#L8474) `Store/updateRelated` | `relatedRows` (8474) | CORE |
| [packages/store/src/store.ts:8492](../../packages/store/src/store.ts#L8492) `Store/updatePortals` | `Store.row` (8492, 8527); `relatedRows` (8528) | CORE |
| [packages/store/src/store.ts:8501](../../packages/store/src/store.ts#L8501) `Store/updatePortals/portal/related` | `relatedIdList` (8501) | CORE |
| [packages/store/src/store.ts:8583](../../packages/store/src/store.ts#L8583) `Store/portalContainerTarget` | `Store.row` (8583); `relatedIdList` (8584) | CORE |
| [packages/store/src/store.ts:8597](../../packages/store/src/store.ts#L8597) `Store/checkEditable` | `Store.row` (8597) | CORE |
| [packages/store/src/store.ts:8620](../../packages/store/src/store.ts#L8620) `Store/delete` | `Store.row` (8620); `SQLite.get` (8625); `SQLite.prepare` (8625, 8627); `Store.sql` (8625, 8627) | CORE |
| [packages/store/src/store.ts:8648](../../packages/store/src/store.ts#L8648) `Store/vaultHeld` | `SQLite.get` (8648); `SQLite.prepare` (8648); `Store.sql` (8648) | CORE |
| [packages/store/src/store.ts:8655](../../packages/store/src/store.ts#L8655) `Store/forgetStandInValues` | `Store.sql` (8655, 8676); `SQLite.prepare` (8676) | CORE |
| [packages/store/src/store.ts:8690](../../packages/store/src/store.ts#L8690) `Store/restoreDeletedRow` | `SQLite.get` (8690); `SQLite.prepare` (8690, 8691, 8693); `Store.sql` (8690, 8691, 8693); `SQLite.all` (8691) | CORE |
| [packages/store/src/store.ts:8717](../../packages/store/src/store.ts#L8717) `Store/cascadeDelete` | `relatedRows` (8717) | CORE |
| [packages/store/src/store.ts:8807](../../packages/store/src/store.ts#L8807) `Store/selectIdsCurrent` | `Store.selectIds` (8807); `SQLite.all` (8813); `SQLite.prepare` (8813); `Store.sql` (8813) | GATED-STORE |
| [packages/store/src/store.ts:8821](../../packages/store/src/store.ts#L8821) `Store/countIds` | `Store.countIds` (8821); `SQLite.get` (8825); `SQLite.prepare` (8825); `Store.sql` (8825) | GATED-STORE |
| [packages/store/src/store.ts:8841](../../packages/store/src/store.ts#L8841) `Store/computeValuesCurrent` | `Store.computeValues` (8841); `Store.sql` (8847, 8851); `SQLite.all` (8851); `SQLite.prepare` (8851) | GATED-STORE |
| [packages/store/src/store.ts:8866](../../packages/store/src/store.ts#L8866) `Store/findIdsCurrent` | `Store.findIds` (8866) | GATED-STORE |
| [packages/store/src/store.ts:8872](../../packages/store/src/store.ts#L8872) `Store/findIdsHere` | `Store.query` (8872, 8877, 8879); `SQLite.iterate` (8890); `SQLite.prepare` (8890); `Store.sql` (8890) | GATED-STORE |
| [packages/store/src/store.ts:8907](../../packages/store/src/store.ts#L8907) `Store/groupSummariesCurrent` | `Store.groupSummaries` (8907); `Store.viewableIds` (8912); `Calculations.collect` (8928); `rowsById` (8928, 8978); `Calculations.collector` (8950) | GATED-STORE |
| [packages/store/src/store.ts:8940](../../packages/store/src/store.ts#L8940) `Store/groupSummariesCurrent/key` | `Calculations.value` (8940); `Calculations.related` (8942) | GATED-STORE |
| [packages/store/src/store.ts:8976](../../packages/store/src/store.ts#L8976) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (8976) | GATED-STORE |
| [packages/store/src/store.ts:8999](../../packages/store/src/store.ts#L8999) `Store/sortIdsCurrent` | `Store.sortIds` (8999); `SQLite.all` (9003); `SQLite.prepare` (9003); `Store.sql` (9003) | GATED-STORE |
| [packages/store/src/store.ts:9013](../../packages/store/src/store.ts#L9013) `Store/matchIds` | `Store.matchIds` (9013); `SQLite.all` (9019); `SQLite.prepare` (9019); `Store.sql` (9019) | CORE |
| [packages/store/src/store.ts:9037](../../packages/store/src/store.ts#L9037) `Store/truncate` | `Store.sql` (9037, 9039, 9046, 9047, 9049, 9050); `SQLite.prepare` (9039, 9046); `SQLite.all` (9041) | CORE |
| [packages/store/src/store.ts:9071](../../packages/store/src/store.ts#L9071) `Store/iterateCommitted` | `SQLite.iterate` (9071) | CORE |
| [packages/store/src/store.ts:9105](../../packages/store/src/store.ts#L9105) `Store/readOnlyChecked` | `SQLite.prepare` (9105, 9109, 9118, 9123); `SQLite.all` (9109, 9118, 9123) | CORE |
| [packages/store/src/store.ts:9145](../../packages/store/src/store.ts#L9145) `Store/refreshDecimalSqlViews` | `SQLite.get` (9145); `SQLite.prepare` (9145, 9150); `SQLite.all` (9150) | CORE |
| [packages/store/src/store.ts:9164](../../packages/store/src/store.ts#L9164) `Store/internalRoots` | `SQLite.get` (9164); `SQLite.prepare` (9164, 9166); `SQLite.all` (9166) | CORE |
| [packages/store/src/store.ts:9199](../../packages/store/src/store.ts#L9199) `Store/selectCurrent` | `SQLite.iterate` (9199) | CORE |
| [packages/store/src/store.ts:9220](../../packages/store/src/store.ts#L9220) `Store/query` | `SQLite.iterate` (9220) | CORE |
| [packages/store/src/store.ts:9254](../../packages/store/src/store.ts#L9254) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9254); `SQLite.all` (9261, 9264); `SQLite.prepare` (9261, 9264) | CORE |
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
