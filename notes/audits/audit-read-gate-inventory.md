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
| [packages/cli/src/main.ts:653](../../packages/cli/src/main.ts#L653) `accountsWithPasswordOff` | `SQLite.all` (653); `SQLite.prepare` (653) | OPERATOR |
| [packages/cli/src/main.ts:682](../../packages/cli/src/main.ts#L682) `hostedRead` | `SQLite.all` (682, 685); `SQLite.prepare` (682, 685); `Store.sql` (682, 685) | OPERATOR |
| [packages/cli/src/main.ts:2270](../../packages/cli/src/main.ts#L2270) `main` | `Store.orphanContainerReport` (2270); `Store.auditLog` (2733); `SQLite.get` (2949); `SQLite.prepare` (2949) | OPERATOR |
| [packages/scripts/src/data-api-step.ts:103](../../packages/scripts/src/data-api-step.ts#L103) `respond` | `Store.get` (103, 130, 139); `Store.find` (104, 116) | SCRIPT |
| [packages/scripts/src/engine.ts:1920](../../packages/scripts/src/engine.ts#L1920) `ScriptEngine/goToLayout` | `Store.findIds` (1920) | SCRIPT |
| [packages/scripts/src/engine.ts:2257](../../packages/scripts/src/engine.ts#L2257) `ScriptEngine/foundSet` | `Store.findIds` (2257) | SCRIPT |
| [packages/scripts/src/engine.ts:2322](../../packages/scripts/src/engine.ts#L2322) `ScriptEngine/semanticFind` | `Store.findIds` (2322, 2343) | SCRIPT |
| [packages/scripts/src/engine.ts:3201](../../packages/scripts/src/engine.ts#L3201) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3201); `Calculations.executeSQL` (3208) | SCRIPT |
| [packages/scripts/src/engine.ts:3240](../../packages/scripts/src/engine.ts#L3240) `ScriptEngine/sortIds` | `Store.sortIds` (3240); `Store.valueListItems` (3246) | SCRIPT |
| [packages/scripts/src/engine.ts:3337](../../packages/scripts/src/engine.ts#L3337) `ScriptEngine/revertTransaction` | `Store.findIds` (3337) | SCRIPT |
| [packages/scripts/src/engine.ts:3885](../../packages/scripts/src/engine.ts#L3885) `ScriptEngine/step` | `Store.fieldIndex` (3885); `Store.findIds` (4019, 4114) | SCRIPT |
| [packages/scripts/src/engine.ts:5135](../../packages/scripts/src/engine.ts#L5135) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5135) | SCRIPT |
| [packages/scripts/src/engine.ts:5143](../../packages/scripts/src/engine.ts#L5143) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5143) | SCRIPT |
| [packages/scripts/src/engine.ts:5144](../../packages/scripts/src/engine.ts#L5144) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5144) | SCRIPT |
| [packages/scripts/src/engine.ts:5290](../../packages/scripts/src/engine.ts#L5290) `ScriptEngine/get` | `Store.findIds` (5290); `Store.canViewRecord` (5381); `Store.get` (5417) | SCRIPT |
| [packages/scripts/src/engine.ts:5448](../../packages/scripts/src/engine.ts#L5448) `ScriptEngine/design` | `Store.valueListItems` (5448) | SCRIPT |
| [packages/scripts/src/engine.ts:5502](../../packages/scripts/src/engine.ts#L5502) `ScriptEngine/record` | `Store.get` (5502) | SCRIPT |
| [packages/scripts/src/engine.ts:5534](../../packages/scripts/src/engine.ts#L5534) `ScriptEngine/valueOf` | `Store.findIds` (5534); `Store.containerId` (5542) | SCRIPT |
| [packages/scripts/src/engine.ts:5559](../../packages/scripts/src/engine.ts#L5559) `ScriptEngine/lookupNext` | `Store.get` (5559); `Store.row` (5560); `Calculations.context` (5562) | SCRIPT |
| [packages/scripts/src/engine.ts:5662](../../packages/scripts/src/engine.ts#L5662) `ScriptEngine/relatedIds` | `Store.findIds` (5662); `rowsById` (5670); `Store.select` (5674); `Store.matchIds` (5688); `Store.viewableIds` (5711) | SCRIPT |
| [packages/scripts/src/engine.ts:5696](../../packages/scripts/src/engine.ts#L5696) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5696) | SCRIPT |
| [packages/scripts/src/engine.ts:6185](../../packages/scripts/src/engine.ts#L6185) `ScriptEngine/exportField` | `Store.get` (6185); `Store.containerId` (6186); `Store.container` (6188) | SCRIPT |
| [packages/scripts/src/engine.ts:6334](../../packages/scripts/src/engine.ts#L6334) `ScriptEngine/relookup` | `Store.get` (6334) | SCRIPT |
| [packages/scripts/src/engine.ts:6752](../../packages/scripts/src/engine.ts#L6752) `ScriptEngine/goToList` | `Store.findIds` (6752) | SCRIPT |
| [packages/scripts/src/engine.ts:7073](../../packages/scripts/src/engine.ts#L7073) `ScriptEngine/sourceValue` | `Store.get` (7073); `Store.containerId` (7074); `Store.container` (7075) | SCRIPT |
| [packages/scripts/src/engine.ts:7791](../../packages/scripts/src/engine.ts#L7791) `ScriptEngine/containerFile` | `Store.get` (7791); `Store.containerId` (7792); `Store.container` (7793) | SCRIPT |
| [packages/scripts/src/engine.ts:7952](../../packages/scripts/src/engine.ts#L7952) `ScriptEngine/importRecords` | `Store.findIds` (7952); `Store.get` (7972) | SCRIPT |
| [packages/scripts/src/engine.ts:8172](../../packages/scripts/src/engine.ts#L8172) `ScriptEngine/fileMakerRows` | `Store.findIds` (8172); `Store.get` (8177) | SCRIPT |
| [packages/scripts/src/engine.ts:8212](../../packages/scripts/src/engine.ts#L8212) `ScriptEngine/newRecord` | `Store.findIds` (8212) | SCRIPT |
| [packages/scripts/src/engine.ts:8509](../../packages/scripts/src/engine.ts#L8509) `ScriptEngine/performFind` | `Store.findIds` (8509) | SCRIPT |
| [packages/scripts/src/engine.ts:8534](../../packages/scripts/src/engine.ts#L8534) `ScriptEngine/findRelated` | `Store.findIds` (8534, 8544, 8547) | SCRIPT |
| [packages/scripts/src/engine.ts:8566](../../packages/scripts/src/engine.ts#L8566) `ScriptEngine/quickFind` | `Store.findIds` (8566, 8567, 8570) | SCRIPT |
| [packages/scripts/src/engine.ts:8951](../../packages/scripts/src/engine.ts#L8951) `clearRecords` | `SQLite.all` (8951); `SQLite.prepare` (8951) | SCRIPT |
| [packages/scripts/src/recorder.ts:72](../../packages/scripts/src/recorder.ts#L72) `lastSeq` | `Store.auditLog` (72) | DESIGN |
| [packages/scripts/src/recorder.ts:104](../../packages/scripts/src/recorder.ts#L104) `recordRun` | `Store.auditLog` (104) | DESIGN |
| [packages/scripts/src/script-tests.ts:211](../../packages/scripts/src/script-tests.ts#L211) `runCase` | `Store.findIds` (211); `Store.auditLog` (218, 219, 261); `Store.evaluateEach` (245) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/server/src/admin.ts:965](../../packages/server/src/admin.ts#L965) `Admin/handle` | `Store.externalContainerReport` (965); `Store.orphanContainerReport` (970, 974) | ADMIN |
| [packages/server/src/admin.ts:2104](../../packages/server/src/admin.ts#L2104) `Admin/audit` | `Store.auditLog` (2104) | ADMIN |
| [packages/server/src/admin.ts:2187](../../packages/server/src/admin.ts#L2187) `Admin/viewAs` | `Store.find` (2187) | ADMIN |
| [packages/server/src/admin.ts:2535](../../packages/server/src/admin.ts#L2535) `Admin/status` | `Store.externalContainerCount` (2535) | ADMIN |
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
| [packages/server/src/assistant.ts:2072](../../packages/server/src/assistant.ts#L2072) `Assistant/answer` | `Store.find` (2072) | ACCOUNT |
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
| [packages/server/src/backup.ts:252](../../packages/server/src/backup.ts#L252) `backupOnce` | `SQLite.get` (252); `SQLite.prepare` (252) | OPERATOR |
| [packages/server/src/backup.ts:976](../../packages/server/src/backup.ts#L976) `accountDifferences/read` | `SQLite.all` (976, 978); `SQLite.prepare` (976, 978) | OPERATOR |
| [packages/server/src/backup.ts:1003](../../packages/server/src/backup.ts#L1003) `readNames` | `SQLite.all` (1003); `SQLite.prepare` (1003) | OPERATOR |
| [packages/server/src/backup.ts:1033](../../packages/server/src/backup.ts#L1033) `credentialsReadable` | `SQLite.all` (1033); `SQLite.prepare` (1033) | OPERATOR |
| [packages/server/src/backup.ts:1049](../../packages/server/src/backup.ts#L1049) `columnInfo` | `SQLite.all` (1049); `SQLite.prepare` (1049) | OPERATOR |
| [packages/server/src/backup.ts:1084](../../packages/server/src/backup.ts#L1084) `reconcileCredentials` | `SQLite.all` (1084, 1106, 1121, 1131, 1137); `SQLite.prepare` (1084, 1092, 1106, 1108, 1121, 1122, 1129, 1131, 1132, 1137, 1138, 1142, 1143, 1144); `SQLite.get` (1092, 1142) | OPERATOR |
| [packages/server/src/backup.ts:1087](../../packages/server/src/backup.ts#L1087) `reconcileCredentials/has` | `SQLite.all` (1087); `SQLite.prepare` (1087) | OPERATOR |
| [packages/server/src/backup.ts:1111](../../packages/server/src/backup.ts#L1111) `reconcileCredentials/accountColumns` | `SQLite.all` (1111); `SQLite.prepare` (1111) | OPERATOR |
| [packages/server/src/backup.ts:1256](../../packages/server/src/backup.ts#L1256) `stageRestorePoint` | `SQLite.get` (1256, 1258, 1259); `SQLite.prepare` (1256, 1258, 1259) | OPERATOR |
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
| [packages/server/src/containers.ts:121](../../packages/server/src/containers.ts#L121) `ContainerFiles/send` | `Store.containerInfo` (121); `Store.container` (188); `Store.containerRange` (197) | CONTAINER |
| [packages/server/src/containers.ts:287](../../packages/server/src/containers.ts#L287) `ContainerFiles/make` | `Store.containerInfo` (287) | CONTAINER |
| [packages/server/src/containers.ts:299](../../packages/server/src/containers.ts#L299) `ContainerFiles/makeAdmitted` | `Store.container` (299) | CONTAINER |
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
| [packages/server/src/mcp.ts:2280](../../packages/server/src/mcp.ts#L2280) `registerResources/audit` | `Store.auditLog` (2280) | MCP |
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
| [packages/server/src/webclient.ts:920](../../packages/server/src/webclient.ts#L920) `WebClient/view` | `Store.evaluateEach` (920, 944, 963); `Store.canView` (938); `Store.previewRow` (942, 964); `Store.get` (955); `Store.row` (956, 956) | WEB |
| [packages/server/src/webclient.ts:941](../../packages/server/src/webclient.ts#L941) `WebClient/view/get` | `Store.get` (941) | WEB |
| [packages/server/src/webclient.ts:1006](../../packages/server/src/webclient.ts#L1006) `WebClient/refresh` | `Store.previewRow` (1006); `Store.getMany` (1011); `Store.foundSetRows` (1033) | WEB |
| [packages/server/src/webclient.ts:1045](../../packages/server/src/webclient.ts#L1045) `WebClient/foundIds` | `Store.findIds` (1045) | WEB |
| [packages/server/src/webclient.ts:1060](../../packages/server/src/webclient.ts#L1060) `WebClient/records` | `Store.getMany` (1060); `Store.find` (1063) | WEB |
| [packages/server/src/webclient.ts:1089](../../packages/server/src/webclient.ts#L1089) `WebClient/foundSetPortal` | `Store.foundSetRows` (1089, 1096) | WEB |
| [packages/server/src/webclient.ts:1129](../../packages/server/src/webclient.ts#L1129) `WebClient/charts/foundSet` | `Store.findIds` (1129) | WEB |
| [packages/server/src/webclient.ts:1138](../../packages/server/src/webclient.ts#L1138) `WebClient/charts` | `Calculations.context` (1138); `Store.canView` (1166); `Store.evaluateEach` (1175, 1179); `Store.evaluateRows` (1184, 1186) | WEB |
| [packages/server/src/webclient.ts:1169](../../packages/server/src/webclient.ts#L1169) `WebClient/charts/get` | `Store.get` (1169) | WEB |
| [packages/server/src/webclient.ts:1319](../../packages/server/src/webclient.ts#L1319) `WebClient/exportRecords` | `Store.getMany` (1319) | WEB |
| [packages/server/src/webclient.ts:1245](../../packages/server/src/webclient.ts#L1245) `WebClient/exportText/nextBatch` | `Store.selectIds` (1245); `Store.getMany` (1250) | WEB |
| [packages/server/src/webclient.ts:1493](../../packages/server/src/webclient.ts#L1493) `WebClient/aiReplace` | `Store.canView` (1493); `Store.getMany` (1509) | WEB |
| [packages/server/src/webclient.ts:1569](../../packages/server/src/webclient.ts#L1569) `WebClient/groups` | `Store.findIds` (1569); `Store.groupSummaries` (1575) | WEB |
| [packages/server/src/webclient.ts:1677](../../packages/server/src/webclient.ts#L1677) `WebClient/button` | `Store.findIds` (1677, 1727); `Store.evaluateEach` (1686, 1687) | WEB |
| [packages/server/src/webclient.ts:2334](../../packages/server/src/webclient.ts#L2334) `listItems` | `Store.valueListItems` (2334) | WEB |
| [packages/server/src/webclient.ts:2413](../../packages/server/src/webclient.ts#L2413) `foundIds` | `Store.findIds` (2413, 2415) | WEB |
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
| [packages/store/src/store.ts:863](../../packages/store/src/store.ts#L863) `Store/metadataVersions` | `SQLite.get` (863); `SQLite.prepare` (863); `Store.sql` (863) | CORE |
| [packages/store/src/store.ts:972](../../packages/store/src/store.ts#L972) `Store/constructor` | `Store.sql` (972, 974, 976, 977, 981, 985, 986, 997, 1002, 1007, 1008, 1012, 1013, 1014, 1021, 1025, 1029, 1030, 1031, 1035, 1039, 1042, 1043, 1045, 1046, 1049, 1050, 1054, 1055, 1059, 1060, 1063, 1065, 1068, 1069, 1073, 1074, 1078, 1079, 1082, 1083, 1084, 1087, 1088, 1091, 1092, 1094, 1094, 1095, 1095, 1096, 1099, 1103, 1105, 1108, 1109, 1110, 1113, 1114, 1116, 1118, 1119, 1124, 1125, 1126, 1126, 1130, 1131); `SQLite.get` (976); `SQLite.prepare` (976, 1042, 1043, 1046, 1049, 1054, 1059, 1068, 1073, 1078, 1087, 1091, 1094, 1095, 1113, 1118); `SQLite.all` (1042, 1049, 1054, 1059, 1068, 1073, 1078, 1087, 1091, 1094, 1095, 1113, 1118) | CORE |
| [packages/store/src/store.ts:1150](../../packages/store/src/store.ts#L1150) `Store/grantFullAccessClients` | `SQLite.prepare` (1150); `Store.sql` (1150) | CORE |
| [packages/store/src/store.ts:1167](../../packages/store/src/store.ts#L1167) `Store/meta` | `SQLite.get` (1167); `SQLite.prepare` (1167); `Store.sql` (1167) | CORE |
| [packages/store/src/store.ts:1175](../../packages/store/src/store.ts#L1175) `Store/persistentTable` | `Store.sql` (1175) | CORE |
| [packages/store/src/store.ts:1185](../../packages/store/src/store.ts#L1185) `Store/persistentData` | `SQLite.get` (1185) | CORE |
| [packages/store/src/store.ts:1194](../../packages/store/src/store.ts#L1194) `Store/persistentDataIds` | `SQLite.all` (1194) | CORE |
| [packages/store/src/store.ts:1200](../../packages/store/src/store.ts#L1200) `Store/setPersistentData` | `SQLite.prepare` (1200, 1204); `Store.sql` (1200, 1204) | CORE |
| [packages/store/src/store.ts:1217](../../packages/store/src/store.ts#L1217) `Store/checkpoint` | `SQLite.get` (1217); `SQLite.prepare` (1217); `Store.sql` (1217) | CORE |
| [packages/store/src/store.ts:1225](../../packages/store/src/store.ts#L1225) `Store/recordedFormat` | `Store.sql` (1225) | CORE |
| [packages/store/src/store.ts:1235](../../packages/store/src/store.ts#L1235) `Store/close` | `Store.sql` (1235) | CORE |
| [packages/store/src/store.ts:1251](../../packages/store/src/store.ts#L1251) `Store/shipWal` | `Store.sql` (1251) | CORE |
| [packages/store/src/store.ts:1262](../../packages/store/src/store.ts#L1262) `Store/trial` | `Store.sql` (1262) | CORE |
| [packages/store/src/store.ts:1267](../../packages/store/src/store.ts#L1267) `Store/trial/undo` | `Store.sql` (1267) | CORE |
| [packages/store/src/store.ts:1302](../../packages/store/src/store.ts#L1302) `Store/joinTransaction` | `Store.sql` (1302, 1303, 1305, 1307, 1313) | CORE |
| [packages/store/src/store.ts:1325](../../packages/store/src/store.ts#L1325) `Store/independentWindowWrite` | `SQLite.get` (1325); `SQLite.prepare` (1325, 1348); `Store.sql` (1325, 1328, 1343, 1348, 1351) | CORE |
| [packages/store/src/store.ts:1373](../../packages/store/src/store.ts#L1373) `Store/withWriteTransaction` | `Store.sql` (1373, 1376, 1380, 1382, 1382) | CORE |
| [packages/store/src/store.ts:1412](../../packages/store/src/store.ts#L1412) `Store/endTransaction` | `Store.sql` (1412, 1415, 1415) | CORE |
| [packages/store/src/store.ts:1441](../../packages/store/src/store.ts#L1441) `Store/backup` | `Store.sql` (1441) | CORE |
| [packages/store/src/store.ts:1465](../../packages/store/src/store.ts#L1465) `Store/dataVersion` | `SQLite.get` (1465); `SQLite.prepare` (1465); `Store.sql` (1465) | CORE |
| [packages/store/src/store.ts:1505](../../packages/store/src/store.ts#L1505) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1505) | CORE |
| [packages/store/src/store.ts:1526](../../packages/store/src/store.ts#L1526) `Store/shareResults` | `Store.sql` (1526) | CORE |
| [packages/store/src/store.ts:1536](../../packages/store/src/store.ts#L1536) `Store/versionTriggers` | `SQLite.get` (1536); `SQLite.prepare` (1536, 1541, 1542); `Store.sql` (1536, 1538, 1539, 1541, 1542, 1551, 1552); `SQLite.all` (1541, 1542) | CORE |
| [packages/store/src/store.ts:1568](../../packages/store/src/store.ts#L1568) `Store/versionNumber` | `SQLite.get` (1568); `SQLite.prepare` (1568); `Store.sql` (1568) | CORE |
| [packages/store/src/store.ts:1581](../../packages/store/src/store.ts#L1581) `Store/changeOne` | `Store.sql` (1581, 1583) | CORE |
| [packages/store/src/store.ts:1584](../../packages/store/src/store.ts#L1584) `Store/changeOne/read` | `SQLite.get` (1584); `SQLite.prepare` (1584); `Store.sql` (1584) | CORE |
| [packages/store/src/store.ts:1623](../../packages/store/src/store.ts#L1623) `Store/writeToken` | `SQLite.get` (1623); `SQLite.prepare` (1623); `Store.sql` (1623) | CORE |
| [packages/store/src/store.ts:1635](../../packages/store/src/store.ts#L1635) `Store/recordCount` | `SQLite.get` (1635); `SQLite.prepare` (1635); `Store.sql` (1635) | CORE |
| [packages/store/src/store.ts:1743](../../packages/store/src/store.ts#L1743) `Store/applyDesign` | `Store.sql` (1743, 1744, 1755, 1758, 1763, 1775, 1778, 1778); `SQLite.prepare` (1758, 1763) | CORE |
| [packages/store/src/store.ts:1836](../../packages/store/src/store.ts#L1836) `Store/auditLog` | `SQLite.all` (1836); `SQLite.prepare` (1836); `Store.sql` (1836) | CORE |
| [packages/store/src/store.ts:1876](../../packages/store/src/store.ts#L1876) `Store/securityEvents` | `Store.auditLog` (1876) | CORE |
| [packages/store/src/store.ts:1902](../../packages/store/src/store.ts#L1902) `Store/prepared` | `SQLite.prepare` (1902); `Store.sql` (1902) | CORE |
| [packages/store/src/store.ts:1917](../../packages/store/src/store.ts#L1917) `Store/recordAsOf` | `SQLite.get` (1917, 1919); `SQLite.prepare` (1917, 1919, 1921, 1922); `Store.sql` (1917, 1919, 1921, 1922); `SQLite.all` (1921, 1922) | CORE |
| [packages/store/src/store.ts:1947](../../packages/store/src/store.ts#L1947) `Store/restoreRecord` | `Store.recordAsOf` (1947); `SQLite.get` (1951); `SQLite.prepare` (1951, 1954, 1961, 1968); `Store.sql` (1951, 1954, 1961, 1968) | CORE |
| [packages/store/src/store.ts:1982](../../packages/store/src/store.ts#L1982) `Store/revertAuditEntry` | `Store.auditLog` (1982) | CORE |
| [packages/store/src/store.ts:2075](../../packages/store/src/store.ts#L2075) `Store/setAuditSettings` | `SQLite.prepare` (2075); `Store.sql` (2075) | CORE |
| [packages/store/src/store.ts:2097](../../packages/store/src/store.ts#L2097) `Store/pruneAudit` | `Store.sql` (2097, 2099, 2101); `SQLite.get` (2099); `SQLite.prepare` (2099) | CORE |
| [packages/store/src/store.ts:2179](../../packages/store/src/store.ts#L2179) `Store/audit` | `Store.sql` (2179) | CORE |
| [packages/store/src/store.ts:2268](../../packages/store/src/store.ts#L2268) `Store/securityChange` | `Store.sql` (2268, 2270); `SQLite.prepare` (2270) | CORE |
| [packages/store/src/store.ts:2317](../../packages/store/src/store.ts#L2317) `Store/logSecurity` | `Store.sql` (2317) | CORE |
| [packages/store/src/store.ts:2340](../../packages/store/src/store.ts#L2340) `Store/ensureDeleted` | `Store.sql` (2340) | CORE |
| [packages/store/src/store.ts:2345](../../packages/store/src/store.ts#L2345) `Store/deletedRows` | `SQLite.get` (2345); `SQLite.prepare` (2345, 2347, 2347); `Store.sql` (2345, 2347, 2347); `SQLite.all` (2347, 2347) | CORE |
| [packages/store/src/store.ts:2371](../../packages/store/src/store.ts#L2371) `Store/emptyDeleted` | `Store.sql` (2371, 2374, 2375, 2377, 2379); `SQLite.prepare` (2375) | CORE |
| [packages/store/src/store.ts:2386](../../packages/store/src/store.ts#L2386) `Store/designHistory` | `SQLite.all` (2386); `SQLite.prepare` (2386); `Store.sql` (2386) | CORE |
| [packages/store/src/store.ts:2393](../../packages/store/src/store.ts#L2393) `Store/scriptHistory` | `SQLite.all` (2393); `SQLite.prepare` (2393); `Store.sql` (2393) | CORE |
| [packages/store/src/store.ts:2403](../../packages/store/src/store.ts#L2403) `Store/layoutHistory` | `SQLite.all` (2403); `SQLite.prepare` (2403); `Store.sql` (2403) | CORE |
| [packages/store/src/store.ts:2428](../../packages/store/src/store.ts#L2428) `Store/designEffect/renameKey` | `SQLite.prepare` (2428); `Store.sql` (2428) | CORE |
| [packages/store/src/store.ts:2444](../../packages/store/src/store.ts#L2444) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2444); `Store.sql` (2444) | CORE |
| [packages/store/src/store.ts:2451](../../packages/store/src/store.ts#L2451) `Store/designEffect` | `Store.sql` (2451, 2455, 2460, 2465, 2468, 2474, 2482, 2483, 2485, 2497, 2498, 2501, 2503, 2509, 2510, 2511, 2516, 2518, 2522, 2525, 2526, 2528, 2531, 2536, 2538, 2545, 2546, 2548, 2549, 2550, 2551, 2558, 2559, 2561, 2561, 2563, 2564, 2565, 2569, 2573, 2575, 2613, 2615, 2617); `SQLite.get` (2482, 2497, 2509, 2510, 2522, 2526, 2561, 2569); `SQLite.prepare` (2482, 2483, 2497, 2498, 2509, 2510, 2516, 2518, 2522, 2526, 2536, 2538, 2551, 2558, 2559, 2561, 2563, 2565, 2569, 2573); `SQLite.all` (2558, 2559); `SQLite.iterate` (2563) | CORE |
| [packages/store/src/store.ts:2625](../../packages/store/src/store.ts#L2625) `Store/dropColumnIndexes` | `SQLite.all` (2625, 2627); `SQLite.prepare` (2625, 2627); `Store.sql` (2625, 2627, 2628) | CORE |
| [packages/store/src/store.ts:2637](../../packages/store/src/store.ts#L2637) `Store/recompute` | `SQLite.prepare` (2637, 2641); `Store.sql` (2637, 2641); `SQLite.iterate` (2641); `Calculations.computeStoredStyled` (2642); `Calculations.value` (2642) | CORE |
| [packages/store/src/store.ts:2657](../../packages/store/src/store.ts#L2657) `Store/linkPrincipal` | `SQLite.get` (2657); `SQLite.prepare` (2657); `Store.sql` (2657) | CORE |
| [packages/store/src/store.ts:2664](../../packages/store/src/store.ts#L2664) `Store/linkIdentity` | `SQLite.get` (2664); `SQLite.prepare` (2664); `Store.sql` (2664) | CORE |
| [packages/store/src/store.ts:2670](../../packages/store/src/store.ts#L2670) `Store/accountsSharingLockout` | `SQLite.all` (2670); `SQLite.prepare` (2670); `Store.sql` (2670) | CORE |
| [packages/store/src/store.ts:2674](../../packages/store/src/store.ts#L2674) `Store/accounts` | `SQLite.all` (2674); `SQLite.prepare` (2674); `Store.sql` (2674) | CORE |
| [packages/store/src/store.ts:2686](../../packages/store/src/store.ts#L2686) `Store/isAgent` | `SQLite.get` (2686); `SQLite.prepare` (2686); `Store.sql` (2686) | CORE |
| [packages/store/src/store.ts:2692](../../packages/store/src/store.ts#L2692) `Store/agentNeedsApproval` | `SQLite.get` (2692); `SQLite.prepare` (2692); `Store.sql` (2692) | CORE |
| [packages/store/src/store.ts:2698](../../packages/store/src/store.ts#L2698) `Store/blankPasswordAccounts` | `SQLite.all` (2698); `SQLite.prepare` (2698); `Store.sql` (2698) | CORE |
| [packages/store/src/store.ts:1158](../../packages/store/src/store.ts#L1158) `Store/hasOwnPassword` | `SQLite.get` (1158); `SQLite.prepare` (1158); `Store.sql` (1158) | CORE |
| [packages/store/src/store.ts:2709](../../packages/store/src/store.ts#L2709) `Store/unmigratedAccounts` | `SQLite.all` (2709); `SQLite.prepare` (2709); `Store.sql` (2709) | CORE |
| [packages/store/src/store.ts:2762](../../packages/store/src/store.ts#L2762) `Store/setExternalAccount` | `SQLite.get` (2762); `SQLite.prepare` (2762, 2767); `Store.sql` (2762, 2767) | CORE |
| [packages/store/src/store.ts:2780](../../packages/store/src/store.ts#L2780) `Store/refuseLookalikeAccount` | `SQLite.all` (2780); `SQLite.prepare` (2780); `Store.sql` (2780) | CORE |
| [packages/store/src/store.ts:2789](../../packages/store/src/store.ts#L2789) `Store/isExternal` | `SQLite.get` (2789); `SQLite.prepare` (2789); `Store.sql` (2789) | CORE |
| [packages/store/src/store.ts:2810](../../packages/store/src/store.ts#L2810) `Store/setAgentAccount` | `SQLite.get` (2810); `SQLite.prepare` (2810, 2816); `Store.sql` (2810, 2816) | CORE |
| [packages/store/src/store.ts:2850](../../packages/store/src/store.ts#L2850) `Store/gateAgentWrite` | `SQLite.prepare` (2850); `Store.sql` (2850) | CORE |
| [packages/store/src/store.ts:2872](../../packages/store/src/store.ts#L2872) `Store/pendingChanges` | `SQLite.all` (2872); `SQLite.prepare` (2872); `Store.sql` (2872) | CORE |
| [packages/store/src/store.ts:2886](../../packages/store/src/store.ts#L2886) `Store/approvePending` | `SQLite.get` (2886); `SQLite.prepare` (2886, 2897); `Store.sql` (2886, 2897) | CORE |
| [packages/store/src/store.ts:2907](../../packages/store/src/store.ts#L2907) `Store/rejectPending` | `SQLite.get` (2907); `SQLite.prepare` (2907, 2909); `Store.sql` (2907, 2909) | CORE |
| [packages/store/src/store.ts:2929](../../packages/store/src/store.ts#L2929) `Store/externalAccount` | `SQLite.all` (2929); `SQLite.prepare` (2929); `Store.sql` (2929) | CORE |
| [packages/store/src/store.ts:2960](../../packages/store/src/store.ts#L2960) `Store/setPassword` | `SQLite.get` (2960); `SQLite.prepare` (2960, 2962, 2971); `Store.sql` (2960, 2962, 2971) | AUTH |
| [packages/store/src/store.ts:2985](../../packages/store/src/store.ts#L2985) `Store/createAccount` | `SQLite.get` (2985); `SQLite.prepare` (2985, 2989, 2995, 3000, 3005); `Store.sql` (2985, 2989, 2995, 3000, 3005) | CORE |
| [packages/store/src/store.ts:3013](../../packages/store/src/store.ts#L3013) `Store/appendSecurityEvent` | `Store.sql` (3013) | CORE |
| [packages/store/src/store.ts:3055](../../packages/store/src/store.ts#L3055) `Store/setPasswordPolicy` | `SQLite.prepare` (3055); `Store.sql` (3055) | CORE |
| [packages/store/src/store.ts:3091](../../packages/store/src/store.ts#L3091) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (3091); `Store.sql` (3091) | CORE |
| [packages/store/src/store.ts:3114](../../packages/store/src/store.ts#L3114) `Store/saveScriptTest` | `SQLite.prepare` (3114); `Store.sql` (3114) | CORE |
| [packages/store/src/store.ts:3123](../../packages/store/src/store.ts#L3123) `Store/deleteScriptTest` | `SQLite.prepare` (3123); `Store.sql` (3123) | CORE |
| [packages/store/src/store.ts:3158](../../packages/store/src/store.ts#L3158) `Store/setAiAllowed` | `SQLite.prepare` (3158); `Store.sql` (3158) | CORE |
| [packages/store/src/store.ts:3184](../../packages/store/src/store.ts#L3184) `Store/setAiPolicy` | `SQLite.prepare` (3184); `Store.sql` (3184) | CORE |
| [packages/store/src/store.ts:3173](../../packages/store/src/store.ts#L3173) `Store/setScriptNetwork` | `SQLite.prepare` (3173); `Store.sql` (3173) | CORE |
| [packages/store/src/store.ts:3204](../../packages/store/src/store.ts#L3204) `Store/setPiiIsolation` | `SQLite.prepare` (3204); `Store.sql` (3204) | CORE |
| [packages/store/src/store.ts:3226](../../packages/store/src/store.ts#L3226) `Store/markPiiField` | `SQLite.prepare` (3226); `Store.sql` (3226) | CORE |
| [packages/store/src/store.ts:3340](../../packages/store/src/store.ts#L3340) `Store/lastSignIns` | `Store.auditLog` (3340) | CORE |
| [packages/store/src/store.ts:3543](../../packages/store/src/store.ts#L3543) `Store/unusualAccess` | `Store.auditLog` (3543, 3609) | CORE |
| [packages/store/src/store.ts:3640](../../packages/store/src/store.ts#L3640) `Store/leastPrivilege` | `SQLite.all` (3640); `SQLite.prepare` (3640); `Store.sql` (3640) | CORE |
| [packages/store/src/store.ts:3713](../../packages/store/src/store.ts#L3713) `Store/unusedAccess` | `SQLite.get` (3713); `SQLite.prepare` (3713, 3722); `Store.sql` (3713, 3722); `SQLite.all` (3722) | CORE |
| [packages/store/src/store.ts:3761](../../packages/store/src/store.ts#L3761) `Store/unusedObjects` | `SQLite.get` (3761); `SQLite.prepare` (3761, 3764); `Store.sql` (3761, 3764); `SQLite.all` (3764) | CORE |
| [packages/store/src/store.ts:3799](../../packages/store/src/store.ts#L3799) `Store/usageCounting` | `SQLite.get` (3799); `SQLite.prepare` (3799); `Store.sql` (3799) | CORE |
| [packages/store/src/store.ts:3807](../../packages/store/src/store.ts#L3807) `Store/setMustChangePassword` | `SQLite.prepare` (3807); `Store.sql` (3807) | CORE |
| [packages/store/src/store.ts:3821](../../packages/store/src/store.ts#L3821) `Store/mustChangePassword` | `SQLite.get` (3821); `SQLite.prepare` (3821); `Store.sql` (3821) | CORE |
| [packages/store/src/store.ts:3860](../../packages/store/src/store.ts#L3860) `Store/passwordDaysRemaining` | `SQLite.get` (3860); `SQLite.prepare` (3860); `Store.sql` (3860) | CORE |
| [packages/store/src/store.ts:3867](../../packages/store/src/store.ts#L3867) `Store/importAccounts` | `SQLite.all` (3867); `SQLite.prepare` (3867); `Store.sql` (3867) | CORE |
| [packages/store/src/store.ts:3890](../../packages/store/src/store.ts#L3890) `Store/canonicalAccount` | `SQLite.all` (3890); `SQLite.prepare` (3890); `Store.sql` (3890) | CORE |
| [packages/store/src/store.ts:3902](../../packages/store/src/store.ts#L3902) `Store/createLocalAccount` | `SQLite.prepare` (3902); `Store.sql` (3902) | CORE |
| [packages/store/src/store.ts:3932](../../packages/store/src/store.ts#L3932) `Store/previewAccountImport` | `Store.sql` (3932, 3933, 3942) | CORE |
| [packages/store/src/store.ts:3950](../../packages/store/src/store.ts#L3950) `Store/limitAccountImport` | `SQLite.prepare` (3950, 3951, 3954); `Store.sql` (3950, 3951, 3954); `SQLite.get` (3951) | CORE |
| [packages/store/src/store.ts:3961](../../packages/store/src/store.ts#L3961) `Store/applyAccountImport` | `Store.sql` (3961, 3969, 3998); `SQLite.get` (3969); `SQLite.prepare` (3969, 3998) | CORE |
| [packages/store/src/store.ts:4023](../../packages/store/src/store.ts#L4023) `Store/forgetStandIns` | `SQLite.prepare` (4023); `Store.sql` (4023) | CORE |
| [packages/store/src/store.ts:4056](../../packages/store/src/store.ts#L4056) `Store/deleteAccount` | `SQLite.prepare` (4056, 4057, 4058, 4060, 4064); `Store.sql` (4056, 4057, 4058, 4060, 4064) | CORE |
| [packages/store/src/store.ts:4081](../../packages/store/src/store.ts#L4081) `Store/setAccountActive` | `SQLite.prepare` (4081, 4084, 4085); `Store.sql` (4081, 4084, 4085) | AUTH |
| [packages/store/src/store.ts:4095](../../packages/store/src/store.ts#L4095) `Store/accountInactive` | `SQLite.get` (4095); `SQLite.prepare` (4095); `Store.sql` (4095) | CORE |
| [packages/store/src/store.ts:4100](../../packages/store/src/store.ts#L4100) `Store/identityAllowed` | `SQLite.get` (4100, 4106, 4112); `SQLite.prepare` (4100, 4106, 4112); `Store.sql` (4100, 4106, 4112) | CORE |
| [packages/store/src/store.ts:4120](../../packages/store/src/store.ts#L4120) `Store/externalIdentityId` | `SQLite.get` (4120, 4126); `SQLite.prepare` (4120, 4125, 4126); `Store.sql` (4120, 4125, 4126) | CORE |
| [packages/store/src/store.ts:4131](../../packages/store/src/store.ts#L4131) `Store/accountIdentityId` | `SQLite.get` (4131, 4136); `SQLite.prepare` (4131, 4135, 4136); `Store.sql` (4131, 4135, 4136) | CORE |
| [packages/store/src/store.ts:4159](../../packages/store/src/store.ts#L4159) `Store/signInMark` | `SQLite.prepare` (4159); `Store.sql` (4159) | AUTH |
| [packages/store/src/store.ts:4169](../../packages/store/src/store.ts#L4169) `Store/signInBase` | `SQLite.get` (4169); `SQLite.prepare` (4169); `Store.sql` (4169) | AUTH |
| [packages/store/src/store.ts:4171](../../packages/store/src/store.ts#L4171) `Store/signInBase/identity` | `SQLite.get` (4171); `SQLite.prepare` (4171); `Store.sql` (4171) | AUTH |
| [packages/store/src/store.ts:4183](../../packages/store/src/store.ts#L4183) `Store/ledgerRow` | `SQLite.get` (4183, 4184); `SQLite.prepare` (4183, 4184); `Store.sql` (4183, 4184) | AUTH |
| [packages/store/src/store.ts:4195](../../packages/store/src/store.ts#L4195) `Store/ledgerWrite` | `Store.sql` (4195, 4196, 4198, 4200, 4203, 4203) | AUTH |
| [packages/store/src/store.ts:4222](../../packages/store/src/store.ts#L4222) `Store/settleSignIns` | `SQLite.all` (4222, 4228); `SQLite.prepare` (4222, 4228, 4234, 4238, 4240); `Store.sql` (4222, 4228, 4234, 4238, 4240) | AUTH |
| [packages/store/src/store.ts:4251](../../packages/store/src/store.ts#L4251) `Store/securityToken` | `SQLite.get` (4251); `SQLite.prepare` (4251); `Store.sql` (4251) | CORE |
| [packages/store/src/store.ts:4259](../../packages/store/src/store.ts#L4259) `Store/accountLocalOnly` | `SQLite.get` (4259); `SQLite.prepare` (4259); `Store.sql` (4259) | CORE |
| [packages/store/src/store.ts:4264](../../packages/store/src/store.ts#L4264) `Store/accountRequires2fa` | `SQLite.get` (4264); `SQLite.prepare` (4264); `Store.sql` (4264) | CORE |
| [packages/store/src/store.ts:4270](../../packages/store/src/store.ts#L4270) `Store/setAccountLocalOnly` | `SQLite.prepare` (4270); `Store.sql` (4270) | CORE |
| [packages/store/src/store.ts:4279](../../packages/store/src/store.ts#L4279) `Store/setAccountRequire2fa` | `SQLite.prepare` (4279); `Store.sql` (4279) | CORE |
| [packages/store/src/store.ts:4307](../../packages/store/src/store.ts#L4307) `Store/createApiToken` | `SQLite.get` (4307); `SQLite.prepare` (4307, 4335); `Store.sql` (4307, 4335) | CORE |
| [packages/store/src/store.ts:4382](../../packages/store/src/store.ts#L4382) `Store/recordObjectUse` | `Store.sql` (4382) | CORE |
| [packages/store/src/store.ts:4412](../../packages/store/src/store.ts#L4412) `Store/writeUsage` | `Store.sql` (4412, 4413, 4415, 4419, 4421) | CORE |
| [packages/store/src/store.ts:4428](../../packages/store/src/store.ts#L4428) `Store/writeUsageRows` | `SQLite.prepare` (4428, 4429, 4435); `Store.sql` (4428, 4429, 4435) | CORE |
| [packages/store/src/store.ts:4440](../../packages/store/src/store.ts#L4440) `Store/writeObjectUseRows` | `SQLite.prepare` (4440, 4441, 4446); `Store.sql` (4440, 4441, 4446) | CORE |
| [packages/store/src/store.ts:4451](../../packages/store/src/store.ts#L4451) `Store/objectUseSince` | `SQLite.get` (4451); `SQLite.prepare` (4451); `Store.sql` (4451) | CORE |
| [packages/store/src/store.ts:4464](../../packages/store/src/store.ts#L4464) `Store/accountUsage` | `SQLite.get` (4464); `SQLite.prepare` (4464, 4465); `Store.sql` (4464, 4465); `SQLite.all` (4465); `Store.auditLog` (4481) | CORE |
| [packages/store/src/store.ts:4497](../../packages/store/src/store.ts#L4497) `Store/apiTokens` | `SQLite.all` (4497); `SQLite.prepare` (4497); `Store.sql` (4497) | CORE |
| [packages/store/src/store.ts:4507](../../packages/store/src/store.ts#L4507) `Store/revokeApiToken` | `SQLite.prepare` (4507); `Store.sql` (4507) | CORE |
| [packages/store/src/store.ts:4521](../../packages/store/src/store.ts#L4521) `Store/apiToken` | `SQLite.get` (4521); `SQLite.prepare` (4521, 4533); `Store.sql` (4521, 4533) | CORE |
| [packages/store/src/store.ts:4549](../../packages/store/src/store.ts#L4549) `Store/enrollTotp` | `SQLite.prepare` (4549); `Store.sql` (4549) | CORE |
| [packages/store/src/store.ts:4560](../../packages/store/src/store.ts#L4560) `Store/confirmTotp` | `SQLite.get` (4560); `SQLite.prepare` (4560, 4562); `Store.sql` (4560, 4562) | CORE |
| [packages/store/src/store.ts:4570](../../packages/store/src/store.ts#L4570) `Store/hasTotp` | `SQLite.get` (4570); `SQLite.prepare` (4570); `Store.sql` (4570) | CORE |
| [packages/store/src/store.ts:4575](../../packages/store/src/store.ts#L4575) `Store/totpAccounts` | `SQLite.all` (4575); `SQLite.prepare` (4575); `Store.sql` (4575) | CORE |
| [packages/store/src/store.ts:4581](../../packages/store/src/store.ts#L4581) `Store/disableTotp` | `SQLite.prepare` (4581); `Store.sql` (4581) | CORE |
| [packages/store/src/store.ts:4604](../../packages/store/src/store.ts#L4604) `Store/verifyTotp` | `SQLite.get` (4604); `SQLite.prepare` (4604, 4610); `Store.sql` (4604, 4610) | CORE |
| [packages/store/src/store.ts:4623](../../packages/store/src/store.ts#L4623) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4623, 4625, 4626, 4628); `Store.sql` (4623, 4625, 4626, 4628); `SQLite.get` (4625) | CORE |
| [packages/store/src/store.ts:4675](../../packages/store/src/store.ts#L4675) `Store/passkeyAllowList` | `SQLite.all` (4675); `SQLite.prepare` (4675); `Store.sql` (4675) | CORE |
| [packages/store/src/store.ts:4689](../../packages/store/src/store.ts#L4689) `Store/takeWebauthnChallenge` | `SQLite.get` (4689); `SQLite.prepare` (4689, 4691); `Store.sql` (4689, 4691) | CORE |
| [packages/store/src/store.ts:4699](../../packages/store/src/store.ts#L4699) `Store/passkeys` | `SQLite.all` (4699); `SQLite.prepare` (4699); `Store.sql` (4699) | CORE |
| [packages/store/src/store.ts:4706](../../packages/store/src/store.ts#L4706) `Store/hasPasskey` | `SQLite.get` (4706); `SQLite.prepare` (4706); `Store.sql` (4706) | CORE |
| [packages/store/src/store.ts:4711](../../packages/store/src/store.ts#L4711) `Store/passkeyIds` | `SQLite.all` (4711); `SQLite.prepare` (4711); `Store.sql` (4711) | CORE |
| [packages/store/src/store.ts:4733](../../packages/store/src/store.ts#L4733) `Store/registerPasskey` | `SQLite.prepare` (4733); `Store.sql` (4733) | CORE |
| [packages/store/src/store.ts:4744](../../packages/store/src/store.ts#L4744) `Store/removePasskey` | `SQLite.get` (4744); `SQLite.prepare` (4744, 4745); `Store.sql` (4744, 4745) | CORE |
| [packages/store/src/store.ts:4761](../../packages/store/src/store.ts#L4761) `Store/verifyPasskeyAssertion` | `SQLite.get` (4761); `SQLite.prepare` (4761, 4772); `Store.sql` (4761, 4772) | CORE |
| [packages/store/src/store.ts:4808](../../packages/store/src/store.ts#L4808) `Store/generateRecoveryCodes` | `SQLite.prepare` (4808, 4811); `Store.sql` (4808, 4811) | CORE |
| [packages/store/src/store.ts:4826](../../packages/store/src/store.ts#L4826) `Store/recoveryCodesRemaining` | `SQLite.get` (4826); `SQLite.prepare` (4826); `Store.sql` (4826) | CORE |
| [packages/store/src/store.ts:4836](../../packages/store/src/store.ts#L4836) `Store/useRecoveryCode` | `SQLite.get` (4836); `SQLite.prepare` (4836, 4838); `Store.sql` (4836, 4838) | CORE |
| [packages/store/src/store.ts:4849](../../packages/store/src/store.ts#L4849) `Store/privilegeSets` | `Store.sql` (4849) | CORE |
| [packages/store/src/store.ts:4878](../../packages/store/src/store.ts#L4878) `Store/savePrivilegeSet` | `SQLite.prepare` (4878, 4886); `Store.sql` (4878, 4886) | AUTH |
| [packages/store/src/store.ts:4921](../../packages/store/src/store.ts#L4921) `Store/deletePrivilegeSet` | `SQLite.prepare` (4921); `Store.sql` (4921) | CORE |
| [packages/store/src/store.ts:4990](../../packages/store/src/store.ts#L4990) `Store/accountPrivilegeSet` | `SQLite.get` (4990); `SQLite.prepare` (4990); `Store.sql` (4990) | CORE |
| [packages/store/src/store.ts:5004](../../packages/store/src/store.ts#L5004) `Store/setAccountPrivilegeSet` | `SQLite.get` (5004); `SQLite.prepare` (5004, 5007, 5011); `Store.sql` (5004, 5007, 5011) | AUTH |
| [packages/store/src/store.ts:5026](../../packages/store/src/store.ts#L5026) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (5026); `Store.sql` (5026) | CORE |
| [packages/store/src/store.ts:5040](../../packages/store/src/store.ts#L5040) `Store/addProvisionedAccount` | `SQLite.get` (5040); `SQLite.prepare` (5040, 5044); `Store.sql` (5040, 5044) | CORE |
| [packages/store/src/store.ts:5205](../../packages/store/src/store.ts#L5205) `Store/ruleOutcome` | `Calculations.context` (5205) | CORE |
| [packages/store/src/store.ts:5246](../../packages/store/src/store.ts#L5246) `Store/allowedIds` | `SQLite.iterate` (5246); `SQLite.prepare` (5246); `Store.sql` (5246) | CORE |
| [packages/store/src/store.ts:5316](../../packages/store/src/store.ts#L5316) `Store/scopedTableSql` | `Store.viewableIds` (5316); `SQLite.all` (5319); `SQLite.prepare` (5319); `Store.sql` (5319) | GATED-STORE |
| [packages/store/src/store.ts:5351](../../packages/store/src/store.ts#L5351) `Store/previewRecordRuleCurrent` | `SQLite.get` (5351); `SQLite.prepare` (5351, 5354); `Store.sql` (5351, 5354); `SQLite.all` (5354); `Calculations.context` (5360, 5376) | CORE |
| [packages/store/src/store.ts:5528](../../packages/store/src/store.ts#L5528) `Store/passwordHash` | `SQLite.get` (5528); `SQLite.prepare` (5528); `Store.sql` (5528) | CORE |
| [packages/store/src/store.ts:5557](../../packages/store/src/store.ts#L5557) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5557); `Store.sql` (5557) | CORE |
| [packages/store/src/store.ts:5570](../../packages/store/src/store.ts#L5570) `Store/knownSharedAccount` | `SQLite.get` (5570); `SQLite.prepare` (5570); `Store.sql` (5570) | CORE |
| [packages/store/src/store.ts:5628](../../packages/store/src/store.ts#L5628) `Store/layouts` | `SQLite.all` (5628); `SQLite.prepare` (5628); `Store.sql` (5628) | CORE |
| [packages/store/src/store.ts:5649](../../packages/store/src/store.ts#L5649) `Store/image` | `SQLite.get` (5649); `SQLite.prepare` (5649); `Store.sql` (5649) | CORE |
| [packages/store/src/store.ts:5659](../../packages/store/src/store.ts#L5659) `Store/images` | `SQLite.all` (5659); `SQLite.prepare` (5659); `Store.sql` (5659) | CORE |
| [packages/store/src/store.ts:5672](../../packages/store/src/store.ts#L5672) `Store/addImage` | `Store.sql` (5672, 5673); `SQLite.prepare` (5673) | CORE |
| [packages/store/src/store.ts:5689](../../packages/store/src/store.ts#L5689) `Store/layout` | `SQLite.get` (5689); `SQLite.prepare` (5689); `Store.sql` (5689) | CORE |
| [packages/store/src/store.ts:5893](../../packages/store/src/store.ts#L5893) `Store/wordIndex` | `Store.sql` (5893, 5901, 5906); `Store.recordCount` (5905); `SQLite.get` (5906); `SQLite.prepare` (5906) | CORE |
| [packages/store/src/store.ts:5958](../../packages/store/src/store.ts#L5958) `Store/toRecord` | `Calculations.value` (5958, 5968); `Calculations.globalValue` (5962); `Calculations.unstoredStyled` (5967) | CORE |
| [packages/store/src/store.ts:6017](../../packages/store/src/store.ts#L6017) `Store/relatedValues` | `Calculations.globalValue` (6017); `Calculations.unstoredValue` (6019) | CORE |
| [packages/store/src/store.ts:6091](../../packages/store/src/store.ts#L6091) `Store/addRelated` | `relatedRows` (6091); `rowsById` (6123); `firstRelatedEach` (6145) | CORE |
| [packages/store/src/store.ts:6173](../../packages/store/src/store.ts#L6173) `Store/foundSetPage` | `rowsById` (6173) | CORE |
| [packages/store/src/store.ts:6189](../../packages/store/src/store.ts#L6189) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6189); `Store.row` (6205) | GATED-STORE |
| [packages/store/src/store.ts:6228](../../packages/store/src/store.ts#L6228) `Store/portalCountsCurrent` | `Store.canView` (6228); `Store.row` (6255) | GATED-STORE |
| [packages/store/src/store.ts:6291](../../packages/store/src/store.ts#L6291) `Store/fieldIndexCurrent` | `SQLite.iterate` (6291); `SQLite.prepare` (6291, 6296); `Store.sql` (6291, 6296); `SQLite.all` (6296) | GATED-STORE |
| [packages/store/src/store.ts:6337](../../packages/store/src/store.ts#L6337) `Store/valueListItemsCurrent` | `Store.valueListItems` (6337); `Store.get` (6351); `relatedRows` (6352); `Store.row` (6352); `SQLite.iterate` (6354); `SQLite.prepare` (6354); `Store.sql` (6354); `Calculations.related` (6364); `Calculations.value` (6368, 6369) | GATED-STORE |
| [packages/store/src/store.ts:6466](../../packages/store/src/store.ts#L6466) `Store/portalRows` | `relatedRows` (6466); `relatedIdList` (6467); `Store.viewableIds` (6470); `rowsById` (6495, 6533); `Calculations.related` (6509) | CORE |
| [packages/store/src/store.ts:6477](../../packages/store/src/store.ts#L6477) `Store/portalRows/context` | `Calculations.context` (6477) | CORE |
| [packages/store/src/store.ts:6487](../../packages/store/src/store.ts#L6487) `Store/portalRows/valueOf` | `Calculations.value` (6487) | CORE |
| [packages/store/src/store.ts:6604](../../packages/store/src/store.ts#L6604) `Store/markRepeating` | `SQLite.prepare` (6604); `Store.sql` (6604) | CORE |
| [packages/store/src/store.ts:6631](../../packages/store/src/store.ts#L6631) `Store/externalContainerCheck` | `SQLite.all` (6631); `SQLite.prepare` (6631); `Store.sql` (6631) | CORE |
| [packages/store/src/store.ts:6638](../../packages/store/src/store.ts#L6638) `Store/externalContainerCount` | `SQLite.get` (6638); `SQLite.prepare` (6638); `Store.sql` (6638) | CORE |
| [packages/store/src/store.ts:6647](../../packages/store/src/store.ts#L6647) `Store/externalContainerReport` | `SQLite.all` (6647, 6660); `SQLite.prepare` (6647, 6660); `Store.sql` (6647, 6660) | CORE |
| [packages/store/src/store.ts:6702](../../packages/store/src/store.ts#L6702) `Store/orphanContainerReport` | `SQLite.all` (6702, 6720, 6722, 6728, 6741, 6754, 6773, 6791); `SQLite.prepare` (6702, 6720, 6722, 6728, 6741, 6754, 6771, 6773, 6791); `Store.sql` (6702, 6720, 6722, 6728, 6741, 6754, 6771, 6773, 6791); `SQLite.get` (6771); `Store.row` (6785) | CORE |
| [packages/store/src/store.ts:6802](../../packages/store/src/store.ts#L6802) `Store/purgeOrphanContainers` | `Store.sql` (6802, 6811, 6814, 6816, 6817, 6822, 6824); `Store.orphanContainerReport` (6803); `SQLite.get` (6811); `SQLite.prepare` (6811, 6816, 6817) | CORE |
| [packages/store/src/store.ts:6837](../../packages/store/src/store.ts#L6837) `Store/containerIntact` | `SQLite.get` (6837); `SQLite.prepare` (6837); `Store.sql` (6837) | CORE |
| [packages/store/src/store.ts:6847](../../packages/store/src/store.ts#L6847) `Store/externalOf` | `SQLite.get` (6847); `SQLite.prepare` (6847); `Store.sql` (6847) | CORE |
| [packages/store/src/store.ts:6851](../../packages/store/src/store.ts#L6851) `Store/containerMeta` | `SQLite.get` (6851); `SQLite.prepare` (6851); `Store.sql` (6851) | CORE |
| [packages/store/src/store.ts:6856](../../packages/store/src/store.ts#L6856) `Store/container` | `SQLite.get` (6856); `SQLite.prepare` (6856, 6865); `Store.sql` (6856, 6865); `SQLite.all` (6865) | CORE |
| [packages/store/src/store.ts:6873](../../packages/store/src/store.ts#L6873) `Store/containerInfo` | `SQLite.get` (6873); `SQLite.prepare` (6873); `Store.sql` (6873) | CORE |
| [packages/store/src/store.ts:6907](../../packages/store/src/store.ts#L6907) `Store/containerRange` | `SQLite.all` (6907); `SQLite.prepare` (6907, 6914); `Store.sql` (6907, 6914); `SQLite.get` (6914) | CORE |
| [packages/store/src/store.ts:6927](../../packages/store/src/store.ts#L6927) `Store/addContainer` | `SQLite.prepare` (6927, 6931, 6932); `Store.sql` (6927, 6929, 6931, 6932, 6934, 6937) | CORE |
| [packages/store/src/store.ts:6953](../../packages/store/src/store.ts#L6953) `Store/addExternalContainer` | `SQLite.prepare` (6953); `Store.sql` (6953) | CORE |
| [packages/store/src/store.ts:6971](../../packages/store/src/store.ts#L6971) `Store/writeExternalFile` | `Store.evaluateEach` (6971); `SQLite.prepare` (6994); `Store.sql` (6994) | CORE |
| [packages/store/src/store.ts:6995](../../packages/store/src/store.ts#L6995) `Store/writeExternalFile/taken` | `SQLite.get` (6995) | CORE |
| [packages/store/src/store.ts:7020](../../packages/store/src/store.ts#L7020) `Store/embeddedContainers` | `SQLite.prepare` (7020, 7021); `Store.sql` (7020, 7021); `SQLite.all` (7021); `SQLite.get` (7025) | CORE |
| [packages/store/src/store.ts:7034](../../packages/store/src/store.ts#L7034) `Store/embeddedContainerCount` | `SQLite.prepare` (7034); `Store.sql` (7034); `SQLite.get` (7035) | CORE |
| [packages/store/src/store.ts:7043](../../packages/store/src/store.ts#L7043) `Store/recoverContainersOut` | `SQLite.prepare` (7043); `Store.sql` (7043); `SQLite.get` (7046) | CORE |
| [packages/store/src/store.ts:7068](../../packages/store/src/store.ts#L7068) `Store/moveContainersOut` | `Store.sql` (7068, 7076, 7078, 7080, 7082, 7083, 7102, 7107, 7109, 7111, 7112, 7116); `SQLite.get` (7076); `SQLite.prepare` (7076, 7082, 7083); `Store.container` (7085) | CORE |
| [packages/store/src/store.ts:7125](../../packages/store/src/store.ts#L7125) `Store/moveContainersIn` | `Store.sql` (7125, 7129, 7131, 7132, 7133, 7134, 7153, 7156, 7163, 7166, 7169, 7176); `SQLite.prepare` (7131, 7132, 7133, 7134, 7163, 7169); `SQLite.get` (7136, 7163, 7169) | CORE |
| [packages/store/src/store.ts:7188](../../packages/store/src/store.ts#L7188) `Store/compactFile` | `Store.sql` (7188, 7189, 7190) | CORE |
| [packages/store/src/store.ts:7196](../../packages/store/src/store.ts#L7196) `Store/containerId` | `Store.containerId` (7196); `Store.row` (7197) | CORE |
| [packages/store/src/store.ts:7219](../../packages/store/src/store.ts#L7219) `Store/checkContainerWrite` | `Store.row` (7219) | CORE |
| [packages/store/src/store.ts:7229](../../packages/store/src/store.ts#L7229) `Store/setContainer` | `Store.row` (7229); `SQLite.prepare` (7240); `Store.sql` (7240) | CORE |
| [packages/store/src/store.ts:7272](../../packages/store/src/store.ts#L7272) `Store/orderBy` | `Store.valueListItems` (7272) | CORE |
| [packages/store/src/store.ts:7295](../../packages/store/src/store.ts#L7295) `Store/userPrefs` | `SQLite.all` (7295); `SQLite.prepare` (7295); `Store.sql` (7295) | CORE |
| [packages/store/src/store.ts:7300](../../packages/store/src/store.ts#L7300) `Store/hasTable` | `SQLite.get` (7300); `SQLite.prepare` (7300); `Store.sql` (7300) | CORE |
| [packages/store/src/store.ts:7304](../../packages/store/src/store.ts#L7304) `Store/setUserPref` | `Store.sql` (7304, 7305, 7306); `SQLite.prepare` (7305, 7306) | CORE |
| [packages/store/src/store.ts:7312](../../packages/store/src/store.ts#L7312) `Store/indexedFields` | `SQLite.all` (7312, 7313); `SQLite.prepare` (7312, 7313); `Store.sql` (7312, 7313) | CORE |
| [packages/store/src/store.ts:7334](../../packages/store/src/store.ts#L7334) `Store/addFieldIndex` | `Store.sql` (7334) | CORE |
| [packages/store/src/store.ts:7346](../../packages/store/src/store.ts#L7346) `Store/dropFieldIndex` | `SQLite.get` (7346); `SQLite.prepare` (7346); `Store.sql` (7346, 7347) | CORE |
| [packages/store/src/store.ts:7357](../../packages/store/src/store.ts#L7357) `Store/timeFind` | `Store.query` (7357, 7361, 7362); `Store.recordCount` (7364) | CORE |
| [packages/store/src/store.ts:7381](../../packages/store/src/store.ts#L7381) `Store/find` | `Store.find` (7381) | GATED-STORE |
| [packages/store/src/store.ts:7392](../../packages/store/src/store.ts#L7392) `Store/findHere` | `Store.query` (7392, 7397, 7399, 7413, 7415, 7425); `Store.recordCount` (7410); `SQLite.get` (7411, 7415); `SQLite.prepare` (7411, 7415, 7420, 7427, 7436); `Store.sql` (7411, 7415, 7420, 7427, 7436); `SQLite.all` (7420, 7427, 7436) | GATED-STORE |
| [packages/store/src/store.ts:7431](../../packages/store/src/store.ts#L7431) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7431); `SQLite.prepare` (7431); `Store.sql` (7431) | GATED-STORE |
| [packages/store/src/store.ts:7464](../../packages/store/src/store.ts#L7464) `Store/sortedPage` | `SQLite.iterate` (7464); `SQLite.prepare` (7464, 7479); `Store.sql` (7464, 7479); `SQLite.all` (7479) | CORE |
| [packages/store/src/store.ts:7536](../../packages/store/src/store.ts#L7536) `Store/relatedCriteria/matched` | `relatedRows` (7536) | CORE |
| [packages/store/src/store.ts:7539](../../packages/store/src/store.ts#L7539) `Store/relatedCriteria` | `SQLite.iterate` (7539); `SQLite.prepare` (7539); `Store.sql` (7539) | CORE |
| [packages/store/src/store.ts:7565](../../packages/store/src/store.ts#L7565) `Store/computedRows` | `Store.sql` (7565, 7568, 7569, 7570, 7572, 7582, 7583, 7584, 7587); `SQLite.prepare` (7568, 7570, 7572, 7582); `SQLite.iterate` (7572); `Calculations.globalValue` (7575); `Calculations.unstoredValue` (7576); `Calculations.related` (7579); `SQLite.all` (7582) | CORE |
| [packages/store/src/store.ts:7612](../../packages/store/src/store.ts#L7612) `Store/summaries` | `Calculations.wholeTable` (7612); `Calculations.collect` (7632, 7637) | CORE |
| [packages/store/src/store.ts:7628](../../packages/store/src/store.ts#L7628) `Store/summaries/recs` | `SQLite.iterate` (7628); `SQLite.prepare` (7628); `Store.sql` (7628) | CORE |
| [packages/store/src/store.ts:7650](../../packages/store/src/store.ts#L7650) `Store/runningSummaryValues` | `Store.viewableIds` (7650); `rowsById` (7652); `Calculations.value` (7663, 7669); `Calculations.related` (7680) | GATED-STORE |
| [packages/store/src/store.ts:7693](../../packages/store/src/store.ts#L7693) `Store/findSource` | `Store.query` (7693); `Store.sql` (7700, 7701, 7705, 7707, 7718, 7720); `SQLite.prepare` (7701, 7707); `SQLite.iterate` (7707); `Calculations.globalValue` (7711); `Calculations.unstoredValue` (7712); `Calculations.related` (7716) | CORE |
| [packages/store/src/store.ts:7739](../../packages/store/src/store.ts#L7739) `Store/previewRow` | `Store.row` (7739) | CORE |
| [packages/store/src/store.ts:7757](../../packages/store/src/store.ts#L7757) `Store/row` | `SQLite.get` (7757) | CORE |
| [packages/store/src/store.ts:7776](../../packages/store/src/store.ts#L7776) `Store/getCurrent` | `Store.get` (7776); `Store.row` (7777, 7777, 7791); `SQLite.all` (7794); `SQLite.prepare` (7794); `Store.sql` (7794) | GATED-STORE |
| [packages/store/src/store.ts:7814](../../packages/store/src/store.ts#L7814) `Store/getManyCurrent` | `Store.getMany` (7814); `SQLite.get` (7832); `SQLite.prepare` (7832); `Store.sql` (7832) | GATED-STORE |
| [packages/store/src/store.ts:7825](../../packages/store/src/store.ts#L7825) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (7825) | GATED-STORE |
| [packages/store/src/store.ts:7848](../../packages/store/src/store.ts#L7848) `Store/canViewRecord` | `SQLite.get` (7848); `SQLite.prepare` (7848); `Store.sql` (7848) | GATED-STORE |
| [packages/store/src/store.ts:7856](../../packages/store/src/store.ts#L7856) `Store/canView` | `Store.canView` (7856); `Store.row` (7857) | GATED-STORE |
| [packages/store/src/store.ts:7881](../../packages/store/src/store.ts#L7881) `Store/create` | `SQLite.get` (7881, 7887); `SQLite.prepare` (7881, 7887, 7898); `Store.sql` (7881, 7887, 7898) | CORE |
| [packages/store/src/store.ts:7922](../../packages/store/src/store.ts#L7922) `Store/duplicate` | `Store.row` (7922); `SQLite.get` (7926); `SQLite.prepare` (7926, 7939); `Store.sql` (7926, 7939) | CORE |
| [packages/store/src/store.ts:7984](../../packages/store/src/store.ts#L7984) `Store/update` | `Store.row` (7984, 7991, 8002); `Store.sql` (8015, 8016, 8053, 8056) | CORE |
| [packages/store/src/store.ts:8018](../../packages/store/src/store.ts#L8018) `Store/update/undo` | `Store.sql` (8018) | CORE |
| [packages/store/src/store.ts:8160](../../packages/store/src/store.ts#L8160) `Store/setStoredCalcValues` | `SQLite.prepare` (8160, 8161); `Store.sql` (8160, 8161); `SQLite.get` (8165) | CORE |
| [packages/store/src/store.ts:8239](../../packages/store/src/store.ts#L8239) `Store/evaluateCurrent` | `Store.row` (8239, 8239); `Calculations.context` (8240); `Store.get` (8241, 8243) | GATED-STORE |
| [packages/store/src/store.ts:8275](../../packages/store/src/store.ts#L8275) `Store/evaluateEachCurrent` | `Store.row` (8275, 8275); `Calculations.context` (8280); `Store.get` (8282) | GATED-STORE |
| [packages/store/src/store.ts:8315](../../packages/store/src/store.ts#L8315) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8315); `Store.get` (8317) | GATED-STORE |
| [packages/store/src/store.ts:8336](../../packages/store/src/store.ts#L8336) `Store/evaluateRowsCurrent` | `Store.row` (8336, 8336) | GATED-STORE |
| [packages/store/src/store.ts:8350](../../packages/store/src/store.ts#L8350) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8350) | GATED-STORE |
| [packages/store/src/store.ts:8372](../../packages/store/src/store.ts#L8372) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8372) | GATED-STORE |
| [packages/store/src/store.ts:8410](../../packages/store/src/store.ts#L8410) `Store/updateRelated` | `relatedRows` (8410) | CORE |
| [packages/store/src/store.ts:8428](../../packages/store/src/store.ts#L8428) `Store/updatePortals` | `Store.row` (8428, 8463); `relatedRows` (8464) | CORE |
| [packages/store/src/store.ts:8437](../../packages/store/src/store.ts#L8437) `Store/updatePortals/portal/related` | `relatedIdList` (8437) | CORE |
| [packages/store/src/store.ts:8519](../../packages/store/src/store.ts#L8519) `Store/portalContainerTarget` | `Store.row` (8519); `relatedIdList` (8520) | CORE |
| [packages/store/src/store.ts:8533](../../packages/store/src/store.ts#L8533) `Store/checkEditable` | `Store.row` (8533) | CORE |
| [packages/store/src/store.ts:8556](../../packages/store/src/store.ts#L8556) `Store/delete` | `Store.row` (8556); `SQLite.get` (8561); `SQLite.prepare` (8561, 8563); `Store.sql` (8561, 8563) | CORE |
| [packages/store/src/store.ts:8584](../../packages/store/src/store.ts#L8584) `Store/vaultHeld` | `SQLite.get` (8584); `SQLite.prepare` (8584); `Store.sql` (8584) | CORE |
| [packages/store/src/store.ts:8591](../../packages/store/src/store.ts#L8591) `Store/forgetStandInValues` | `Store.sql` (8591, 8612); `SQLite.prepare` (8612) | CORE |
| [packages/store/src/store.ts:8626](../../packages/store/src/store.ts#L8626) `Store/restoreDeletedRow` | `SQLite.get` (8626); `SQLite.prepare` (8626, 8627, 8629); `Store.sql` (8626, 8627, 8629); `SQLite.all` (8627) | CORE |
| [packages/store/src/store.ts:8653](../../packages/store/src/store.ts#L8653) `Store/cascadeDelete` | `relatedRows` (8653) | CORE |
| [packages/store/src/store.ts:8743](../../packages/store/src/store.ts#L8743) `Store/selectIdsCurrent` | `Store.selectIds` (8743); `SQLite.all` (8749); `SQLite.prepare` (8749); `Store.sql` (8749) | GATED-STORE |
| [packages/store/src/store.ts:8757](../../packages/store/src/store.ts#L8757) `Store/countIds` | `Store.countIds` (8757); `SQLite.get` (8761); `SQLite.prepare` (8761); `Store.sql` (8761) | GATED-STORE |
| [packages/store/src/store.ts:8777](../../packages/store/src/store.ts#L8777) `Store/computeValuesCurrent` | `Store.computeValues` (8777); `Store.sql` (8783, 8787); `SQLite.all` (8787); `SQLite.prepare` (8787) | GATED-STORE |
| [packages/store/src/store.ts:8802](../../packages/store/src/store.ts#L8802) `Store/findIdsCurrent` | `Store.findIds` (8802) | GATED-STORE |
| [packages/store/src/store.ts:8808](../../packages/store/src/store.ts#L8808) `Store/findIdsHere` | `Store.query` (8808, 8813, 8815); `SQLite.iterate` (8826); `SQLite.prepare` (8826); `Store.sql` (8826) | GATED-STORE |
| [packages/store/src/store.ts:8843](../../packages/store/src/store.ts#L8843) `Store/groupSummariesCurrent` | `Store.groupSummaries` (8843); `Store.viewableIds` (8848); `Calculations.collect` (8864); `rowsById` (8864, 8914); `Calculations.collector` (8886) | GATED-STORE |
| [packages/store/src/store.ts:8876](../../packages/store/src/store.ts#L8876) `Store/groupSummariesCurrent/key` | `Calculations.value` (8876); `Calculations.related` (8878) | GATED-STORE |
| [packages/store/src/store.ts:8912](../../packages/store/src/store.ts#L8912) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (8912) | GATED-STORE |
| [packages/store/src/store.ts:8935](../../packages/store/src/store.ts#L8935) `Store/sortIdsCurrent` | `Store.sortIds` (8935); `SQLite.all` (8939); `SQLite.prepare` (8939); `Store.sql` (8939) | GATED-STORE |
| [packages/store/src/store.ts:8949](../../packages/store/src/store.ts#L8949) `Store/matchIds` | `Store.matchIds` (8949); `SQLite.all` (8955); `SQLite.prepare` (8955); `Store.sql` (8955) | CORE |
| [packages/store/src/store.ts:8973](../../packages/store/src/store.ts#L8973) `Store/truncate` | `Store.sql` (8973, 8975, 8982, 8983, 8985, 8986); `SQLite.prepare` (8975, 8982); `SQLite.all` (8977) | CORE |
| [packages/store/src/store.ts:9007](../../packages/store/src/store.ts#L9007) `Store/iterateCommitted` | `SQLite.iterate` (9007) | CORE |
| [packages/store/src/store.ts:9041](../../packages/store/src/store.ts#L9041) `Store/readOnlyChecked` | `SQLite.prepare` (9041, 9045, 9054, 9059); `SQLite.all` (9045, 9054, 9059) | CORE |
| [packages/store/src/store.ts:9081](../../packages/store/src/store.ts#L9081) `Store/refreshDecimalSqlViews` | `SQLite.get` (9081); `SQLite.prepare` (9081, 9086); `SQLite.all` (9086) | CORE |
| [packages/store/src/store.ts:9100](../../packages/store/src/store.ts#L9100) `Store/internalRoots` | `SQLite.get` (9100); `SQLite.prepare` (9100, 9102); `SQLite.all` (9102) | CORE |
| [packages/store/src/store.ts:9135](../../packages/store/src/store.ts#L9135) `Store/selectCurrent` | `SQLite.iterate` (9135) | CORE |
| [packages/store/src/store.ts:9156](../../packages/store/src/store.ts#L9156) `Store/query` | `SQLite.iterate` (9156) | CORE |
| [packages/store/src/store.ts:9190](../../packages/store/src/store.ts#L9190) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9190); `SQLite.all` (9197, 9200); `SQLite.prepare` (9197, 9200) | CORE |
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
