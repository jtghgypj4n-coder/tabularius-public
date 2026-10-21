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

The inventory contains **2,460 read/capability sites in 715 functions**. The initial discovery used `rg` over Store's read methods and their callers. The generator additionally includes direct `Store.sql` capability transfers, SQLite `prepare/get/all/iterate`, calculation and relationship reads, so SQL aliases and builders that bypass Store methods are visible. SQLite writes and schema/security reads are retained conservatively: their presence in the table does not mean they disclose record values. Each row names the enclosing function, every relevant source line, and its gate classification. New sites, changed call arguments, duplicate sites, removed sites and moved functions fail the allow-list test; shifting line numbers only requires regenerating the report.

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
| [packages/cli/src/main.ts:642](../../packages/cli/src/main.ts#L642) `accountsWithPasswordOff` | `SQLite.all` (642); `SQLite.prepare` (642) | OPERATOR |
| [packages/cli/src/main.ts:671](../../packages/cli/src/main.ts#L671) `hostedRead` | `SQLite.all` (671, 674); `SQLite.prepare` (671, 674); `Store.sql` (671, 674) | OPERATOR |
| [packages/cli/src/main.ts:2236](../../packages/cli/src/main.ts#L2236) `main` | `Store.orphanContainerReport` (2236); `Store.auditLog` (2698); `SQLite.get` (2914); `SQLite.prepare` (2914) | OPERATOR |
| [packages/scripts/src/data-api-step.ts:103](../../packages/scripts/src/data-api-step.ts#L103) `respond` | `Store.get` (103, 130, 139); `Store.find` (104, 116) | SCRIPT |
| [packages/scripts/src/engine.ts:1908](../../packages/scripts/src/engine.ts#L1908) `ScriptEngine/goToLayout` | `Store.findIds` (1908) | SCRIPT |
| [packages/scripts/src/engine.ts:2245](../../packages/scripts/src/engine.ts#L2245) `ScriptEngine/foundSet` | `Store.findIds` (2245) | SCRIPT |
| [packages/scripts/src/engine.ts:2310](../../packages/scripts/src/engine.ts#L2310) `ScriptEngine/semanticFind` | `Store.findIds` (2310, 2331) | SCRIPT |
| [packages/scripts/src/engine.ts:3184](../../packages/scripts/src/engine.ts#L3184) `ScriptEngine/sqlByNaturalLanguage` | `Calculations.translateSQL` (3184); `Calculations.executeSQL` (3191) | SCRIPT |
| [packages/scripts/src/engine.ts:3223](../../packages/scripts/src/engine.ts#L3223) `ScriptEngine/sortIds` | `Store.sortIds` (3223); `Store.valueListItems` (3229) | SCRIPT |
| [packages/scripts/src/engine.ts:3320](../../packages/scripts/src/engine.ts#L3320) `ScriptEngine/revertTransaction` | `Store.findIds` (3320) | SCRIPT |
| [packages/scripts/src/engine.ts:3868](../../packages/scripts/src/engine.ts#L3868) `ScriptEngine/step` | `Store.fieldIndex` (3868); `Store.findIds` (4000, 4095) | SCRIPT |
| [packages/scripts/src/engine.ts:5116](../../packages/scripts/src/engine.ts#L5116) `ScriptEngine/newCalcContext/executeSQL` | `Calculations.executeSQL` (5116) | SCRIPT |
| [packages/scripts/src/engine.ts:5124](../../packages/scripts/src/engine.ts#L5124) `ScriptEngine/newCalcContext/persistentData` | `Store.persistentData` (5124) | SCRIPT |
| [packages/scripts/src/engine.ts:5125](../../packages/scripts/src/engine.ts#L5125) `ScriptEngine/newCalcContext/persistentDataIds` | `Store.persistentDataIds` (5125) | SCRIPT |
| [packages/scripts/src/engine.ts:5271](../../packages/scripts/src/engine.ts#L5271) `ScriptEngine/get` | `Store.findIds` (5271); `Store.canViewRecord` (5362); `Store.get` (5398) | SCRIPT |
| [packages/scripts/src/engine.ts:5429](../../packages/scripts/src/engine.ts#L5429) `ScriptEngine/design` | `Store.valueListItems` (5429) | SCRIPT |
| [packages/scripts/src/engine.ts:5483](../../packages/scripts/src/engine.ts#L5483) `ScriptEngine/record` | `Store.get` (5483) | SCRIPT |
| [packages/scripts/src/engine.ts:5515](../../packages/scripts/src/engine.ts#L5515) `ScriptEngine/valueOf` | `Store.findIds` (5515); `Store.containerId` (5523) | SCRIPT |
| [packages/scripts/src/engine.ts:5540](../../packages/scripts/src/engine.ts#L5540) `ScriptEngine/lookupNext` | `Store.get` (5540); `Store.row` (5541); `Calculations.context` (5543) | SCRIPT |
| [packages/scripts/src/engine.ts:5643](../../packages/scripts/src/engine.ts#L5643) `ScriptEngine/relatedIds` | `Store.findIds` (5643); `rowsById` (5651); `Store.select` (5655); `Store.matchIds` (5669); `Store.viewableIds` (5692) | SCRIPT |
| [packages/scripts/src/engine.ts:5677](../../packages/scripts/src/engine.ts#L5677) `ScriptEngine/relatedIds/matching` | `Store.matchIds` (5677) | SCRIPT |
| [packages/scripts/src/engine.ts:6164](../../packages/scripts/src/engine.ts#L6164) `ScriptEngine/exportField` | `Store.get` (6164); `Store.containerId` (6165); `Store.container` (6167) | SCRIPT |
| [packages/scripts/src/engine.ts:6310](../../packages/scripts/src/engine.ts#L6310) `ScriptEngine/relookup` | `Store.get` (6310) | SCRIPT |
| [packages/scripts/src/engine.ts:6728](../../packages/scripts/src/engine.ts#L6728) `ScriptEngine/goToList` | `Store.findIds` (6728) | SCRIPT |
| [packages/scripts/src/engine.ts:7044](../../packages/scripts/src/engine.ts#L7044) `ScriptEngine/sourceValue` | `Store.get` (7044); `Store.containerId` (7045); `Store.container` (7046) | SCRIPT |
| [packages/scripts/src/engine.ts:7746](../../packages/scripts/src/engine.ts#L7746) `ScriptEngine/containerFile` | `Store.get` (7746); `Store.containerId` (7747); `Store.container` (7748) | SCRIPT |
| [packages/scripts/src/engine.ts:7907](../../packages/scripts/src/engine.ts#L7907) `ScriptEngine/importRecords` | `Store.findIds` (7907); `Store.get` (7927) | SCRIPT |
| [packages/scripts/src/engine.ts:8125](../../packages/scripts/src/engine.ts#L8125) `ScriptEngine/fileMakerRows` | `Store.findIds` (8125); `Store.get` (8130) | SCRIPT |
| [packages/scripts/src/engine.ts:8165](../../packages/scripts/src/engine.ts#L8165) `ScriptEngine/newRecord` | `Store.findIds` (8165) | SCRIPT |
| [packages/scripts/src/engine.ts:8462](../../packages/scripts/src/engine.ts#L8462) `ScriptEngine/performFind` | `Store.findIds` (8462) | SCRIPT |
| [packages/scripts/src/engine.ts:8487](../../packages/scripts/src/engine.ts#L8487) `ScriptEngine/findRelated` | `Store.findIds` (8487, 8497, 8500) | SCRIPT |
| [packages/scripts/src/engine.ts:8519](../../packages/scripts/src/engine.ts#L8519) `ScriptEngine/quickFind` | `Store.findIds` (8519, 8520, 8523) | SCRIPT |
| [packages/scripts/src/engine.ts:8888](../../packages/scripts/src/engine.ts#L8888) `clearRecords` | `SQLite.all` (8888); `SQLite.prepare` (8888) | SCRIPT |
| [packages/scripts/src/recorder.ts:72](../../packages/scripts/src/recorder.ts#L72) `lastSeq` | `Store.auditLog` (72) | DESIGN |
| [packages/scripts/src/recorder.ts:104](../../packages/scripts/src/recorder.ts#L104) `recordRun` | `Store.auditLog` (104) | DESIGN |
| [packages/scripts/src/script-tests.ts:207](../../packages/scripts/src/script-tests.ts#L207) `runCase` | `Store.findIds` (207); `Store.auditLog` (214, 215, 256); `Store.evaluateEach` (240) | DESIGN |
| [packages/scripts/src/testrun.ts:199](../../packages/scripts/src/testrun.ts#L199) `seedSelections` | `Calculations.globalValue` (199); `Store.find` (204) | DESIGN |
| [packages/scripts/src/testrun.ts:270](../../packages/scripts/src/testrun.ts#L270) `testScript` | `Store.findIds` (270) | DESIGN |
| [packages/scripts/src/testrun.ts:306](../../packages/scripts/src/testrun.ts#L306) `recordWith` | `Store.evaluateEach` (306) | DESIGN |
| [packages/scripts/src/testrun.ts:338](../../packages/scripts/src/testrun.ts#L338) `testRun` | `Store.evaluateEach` (338) | DESIGN |
| [packages/server/src/admin.ts:958](../../packages/server/src/admin.ts#L958) `Admin/handle` | `Store.externalContainerReport` (958); `Store.orphanContainerReport` (963, 967) | ADMIN |
| [packages/server/src/admin.ts:2077](../../packages/server/src/admin.ts#L2077) `Admin/audit` | `Store.auditLog` (2077) | ADMIN |
| [packages/server/src/admin.ts:2160](../../packages/server/src/admin.ts#L2160) `Admin/viewAs` | `Store.find` (2160) | ADMIN |
| [packages/server/src/admin.ts:2508](../../packages/server/src/admin.ts#L2508) `Admin/status` | `Store.externalContainerCount` (2508) | ADMIN |
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
| [packages/server/src/debug.ts:309](../../packages/server/src/debug.ts#L309) `DebugApi/handle` | `Store.row` (309); `Store.get` (316); `Store.evaluate` (331) | DESIGN |
| [packages/server/src/design.ts:233](../../packages/server/src/design.ts#L233) `containerData` | `Store.query` (233) | DESIGN |
| [packages/server/src/design.ts:242](../../packages/server/src/design.ts#L242) `recordCount` | `Store.query` (242) | DESIGN |
| [packages/server/src/design.ts:729](../../packages/server/src/design.ts#L729) `DesignApi/handle` | `Store.auditLog` (729); `Store.evaluate` (796) | DESIGN |
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
| [packages/server/src/dry-run.ts:89](../../packages/server/src/dry-run.ts#L89) `dryRunChanges/runOnce` | `Store.auditLog` (89, 93) | DESIGN |
| [packages/server/src/find-advice.ts:99](../../packages/server/src/find-advice.ts#L99) `findAdvice` | `Store.recordCount` (99) | DESIGN |
| [packages/server/src/formula-preview.ts:30](../../packages/server/src/formula-preview.ts#L30) `previewFormula` | `Store.findIds` (30); `Store.evaluate` (41) | DESIGN |
| [packages/server/src/import-mapping.ts:497](../../packages/server/src/import-mapping.ts#L497) `existingKeys` | `Store.viewableIds` (497); `Store.query` (499) | IMPORT |
| [packages/server/src/import-mapping.ts:755](../../packages/server/src/import-mapping.ts#L755) `applyImportRun` | `SQLite.prepare` (755); `Store.sql` (755) | IMPORT |
| [packages/server/src/import-mapping.ts:772](../../packages/server/src/import-mapping.ts#L772) `targetKeys` | `SQLite.all` (772); `SQLite.prepare` (772); `Store.sql` (772) | IMPORT |
| [packages/server/src/import-mapping.ts:784](../../packages/server/src/import-mapping.ts#L784) `journal` | `Store.sql` (784, 787, 787); `SQLite.all` (787); `SQLite.prepare` (787) | IMPORT |
| [packages/server/src/import-mapping.ts:829](../../packages/server/src/import-mapping.ts#L829) `importHistory` | `SQLite.all` (829); `SQLite.prepare` (829); `Store.sql` (829) | IMPORT |
| [packages/server/src/import-mapping.ts:836](../../packages/server/src/import-mapping.ts#L836) `undoImportRun` | `SQLite.get` (836, 859); `SQLite.prepare` (836, 859, 873); `Store.sql` (836, 859, 873) | IMPORT |
| [packages/server/src/insight.ts:314](../../packages/server/src/insight.ts#L314) `webViewerScripts` | `Store.query` (314) | DESIGN |
| [packages/server/src/insight.ts:755](../../packages/server/src/insight.ts#L755) `layoutProfile/viewableIds` | `Store.viewableIds` (755) | PROFILE |
| [packages/server/src/insight.ts:759](../../packages/server/src/insight.ts#L759) `layoutProfile` | `Store.query` (759) | PROFILE |
| [packages/server/src/insight.ts:835](../../packages/server/src/insight.ts#L835) `columnProfile` | `Store.query` (835, 842, 854, 857) | PROFILE |
| [packages/server/src/insight.ts:914](../../packages/server/src/insight.ts#L914) `checkCalculation` | `Store.findIds` (914); `Store.evaluate` (918) | DESIGN |
| [packages/server/src/insight.ts:1085](../../packages/server/src/insight.ts#L1085) `solutionOverview/counts` | `Store.query` (1085) | DESIGN |
| [packages/server/src/live.ts:137](../../packages/server/src/live.ts#L137) `Live/handle` | `Store.canViewRecord` (137, 144); `Store.canView` (189) | LIVE |
| [packages/server/src/live.ts:276](../../packages/server/src/live.ts#L276) `Live/stream/listener` | `Store.canViewRecord` (276, 278) | LIVE |
| [packages/server/src/logs.ts:76](../../packages/server/src/logs.ts#L76) `LogShipper/follow` | `SQLite.get` (76); `SQLite.prepare` (76); `Store.sql` (76, 77, 78, 79) | ADMIN |
| [packages/server/src/logs.ts:88](../../packages/server/src/logs.ts#L88) `LogShipper/releaseIfIdle` | `Store.sql` (88) | ADMIN |
| [packages/server/src/mcp-design.ts:503](../../packages/server/src/mcp-design.ts#L503) `registerDesignTools/audit_log` | `Store.auditLog` (503) | DESIGN |
| [packages/server/src/mcp.ts:953](../../packages/server/src/mcp.ts#L953) `createMcpServer/find_records` | `Store.find` (953) | MCP |
| [packages/server/src/mcp.ts:966](../../packages/server/src/mcp.ts#L966) `createMcpServer/get_record` | `Store.get` (966) | MCP |
| [packages/server/src/mcp.ts:1016](../../packages/server/src/mcp.ts#L1016) `createMcpServer/update_record` | `Store.get` (1016, 1020) | MCP |
| [packages/server/src/mcp.ts:1073](../../packages/server/src/mcp.ts#L1073) `createMcpServer/evaluate_calculation` | `Store.get` (1073, 1081); `Store.find` (1074); `Store.evaluate` (1075); `Store.row` (1080) | SQL |
| [packages/server/src/mcp.ts:1148](../../packages/server/src/mcp.ts#L1148) `createMcpServer/get_container` | `Store.container` (1148) | SQL |
| [packages/server/src/mcp.ts:1172](../../packages/server/src/mcp.ts#L1172) `createMcpServer/sql_query` | `Store.queryWithOrigins` (1172) | SQL |
| [packages/server/src/mcp.ts:1329](../../packages/server/src/mcp.ts#L1329) `createMcpServer/explain_value` | `Store.get` (1329); `Store.row` (1330) | MCP |
| [packages/server/src/mcp.ts:1352](../../packages/server/src/mcp.ts#L1352) `createMcpServer/check_record` | `Store.get` (1352); `Store.row` (1354) | MCP |
| [packages/server/src/mcp.ts:1376](../../packages/server/src/mcp.ts#L1376) `createMcpServer/explain_related` | `Store.get` (1376) | MCP |
| [packages/server/src/mcp.ts:2271](../../packages/server/src/mcp.ts#L2271) `registerResources/audit` | `Store.auditLog` (2271) | MCP |
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
| [packages/server/src/privilege-review.ts:154](../../packages/server/src/privilege-review.ts#L154) `reviewPrivileges` | `Store.previewRecordRule` (154) | DESIGN |
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
| [packages/server/src/security.ts:78](../../packages/server/src/security.ts#L78) `importApproximations` | `SQLite.all` (78); `SQLite.prepare` (78); `Store.sql` (78) | DESIGN |
| [packages/server/src/security.ts:114](../../packages/server/src/security.ts#L114) `securityOf` | `Store.pendingChanges` (114) | DESIGN |
| [packages/server/src/security.ts:206](../../packages/server/src/security.ts#L206) `SecurityApi/handle` | `Store.previewRecordRule` (206) | DESIGN |
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
| [packages/server/src/webclient.ts:436](../../packages/server/src/webclient.ts#L436) `WebClient/history` | `Store.get` (436) | WEB |
| [packages/server/src/webclient.ts:551](../../packages/server/src/webclient.ts#L551) `WebClient/explain` | `Store.get` (551); `Store.row` (584, 597) | WEB |
| [packages/server/src/webclient.ts:610](../../packages/server/src/webclient.ts#L610) `WebClient/index` | `Store.fieldIndex` (610) | WEB |
| [packages/server/src/webclient.ts:700](../../packages/server/src/webclient.ts#L700) `WebClient/menus` | `Store.evaluateEach` (700) | WEB |
| [packages/server/src/webclient.ts:913](../../packages/server/src/webclient.ts#L913) `WebClient/view` | `Store.evaluateEach` (913, 937, 956); `Store.canView` (931); `Store.previewRow` (935, 957); `Store.get` (948); `Store.row` (949, 949) | WEB |
| [packages/server/src/webclient.ts:934](../../packages/server/src/webclient.ts#L934) `WebClient/view/get` | `Store.get` (934) | WEB |
| [packages/server/src/webclient.ts:999](../../packages/server/src/webclient.ts#L999) `WebClient/refresh` | `Store.previewRow` (999); `Store.getMany` (1004); `Store.foundSetRows` (1026) | WEB |
| [packages/server/src/webclient.ts:1038](../../packages/server/src/webclient.ts#L1038) `WebClient/foundIds` | `Store.findIds` (1038) | WEB |
| [packages/server/src/webclient.ts:1053](../../packages/server/src/webclient.ts#L1053) `WebClient/records` | `Store.getMany` (1053); `Store.find` (1056) | WEB |
| [packages/server/src/webclient.ts:1082](../../packages/server/src/webclient.ts#L1082) `WebClient/foundSetPortal` | `Store.foundSetRows` (1082, 1089) | WEB |
| [packages/server/src/webclient.ts:1122](../../packages/server/src/webclient.ts#L1122) `WebClient/charts/foundSet` | `Store.findIds` (1122) | WEB |
| [packages/server/src/webclient.ts:1131](../../packages/server/src/webclient.ts#L1131) `WebClient/charts` | `Calculations.context` (1131); `Store.canView` (1159); `Store.evaluateEach` (1168, 1172); `Store.evaluateRows` (1177, 1179) | WEB |
| [packages/server/src/webclient.ts:1162](../../packages/server/src/webclient.ts#L1162) `WebClient/charts/get` | `Store.get` (1162) | WEB |
| [packages/server/src/webclient.ts:1221](../../packages/server/src/webclient.ts#L1221) `WebClient/exportRecords` | `Store.getMany` (1221) | WEB |
| [packages/server/src/webclient.ts:1395](../../packages/server/src/webclient.ts#L1395) `WebClient/aiReplace` | `Store.canView` (1395); `Store.getMany` (1411) | WEB |
| [packages/server/src/webclient.ts:1471](../../packages/server/src/webclient.ts#L1471) `WebClient/groups` | `Store.findIds` (1471); `Store.groupSummaries` (1477) | WEB |
| [packages/server/src/webclient.ts:1576](../../packages/server/src/webclient.ts#L1576) `WebClient/button` | `Store.findIds` (1576, 1626); `Store.evaluateEach` (1585, 1586) | WEB |
| [packages/server/src/webclient.ts:2233](../../packages/server/src/webclient.ts#L2233) `listItems` | `Store.valueListItems` (2233) | WEB |
| [packages/server/src/webclient.ts:2312](../../packages/server/src/webclient.ts#L2312) `foundIds` | `Store.findIds` (2312, 2314) | WEB |
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
| [packages/store/src/calc.ts:2055](../../packages/store/src/calc.ts#L2055) `Calculations/translateSQL` | `Store.scopedTableSql` (2055, 2086) | CALC |
| [packages/store/src/calc.ts:2118](../../packages/store/src/calc.ts#L2118) `Calculations/shareColumn` | `Store.recordCount` (2118) | CALC |
| [packages/store/src/calc.ts:2150](../../packages/store/src/calc.ts#L2150) `Calculations/defineComputedColumn/fm_computed` | `Calculations.related` (2150) | CALC |
| [packages/store/src/calc.ts:2187](../../packages/store/src/calc.ts#L2187) `Calculations/computeColumn` | `Calculations.statement` (2187); `SQLite.get` (2187); `Calculations.value` (2190) | CALC |
| [packages/store/src/calc.ts:2324](../../packages/store/src/calc.ts#L2324) `Calculations/beforeWrite` | `relatedRows` (2324); `Calculations.related` (2378); `Calculations.context` (2391) | CORE |
| [packages/store/src/calc.ts:2442](../../packages/store/src/calc.ts#L2442) `Calculations/computeStored` | `Calculations.computeStoredStyled` (2442); `Calculations.value` (2442) | CALC |
| [packages/store/src/calc.ts:2456](../../packages/store/src/calc.ts#L2456) `Calculations/computeStoredStyled` | `Calculations.context` (2456) | CORE |
| [packages/store/src/calc.ts:2496](../../packages/store/src/calc.ts#L2496) `Calculations/validate/fail` | `Calculations.context` (2496) | CALC |
| [packages/store/src/calc.ts:2510](../../packages/store/src/calc.ts#L2510) `Calculations/validate` | `Calculations.value` (2510); `Store.valueListItems` (2531); `Calculations.context` (2545) | CALC |
| [packages/store/src/calc.ts:2607](../../packages/store/src/calc.ts#L2607) `nearest` | `SQLite.get` (2607); `SQLite.prepare` (2607); `Store.sql` (2607) | CALC |
| [packages/store/src/calc.ts:2693](../../packages/store/src/calc.ts#L2693) `containerValue` | `Store.containerInfo` (2693); `Store.containerRange` (2700); `Store.container` (2701) | CALC |
| [packages/store/src/calc.ts:2709](../../packages/store/src/calc.ts#L2709) `containerValue/read` | `Store.container` (2709) | CALC |
| [packages/store/src/calc.ts:2722](../../packages/store/src/calc.ts#L2722) `containerValue/value` | `Store.containerRange` (2722) | CALC |
| [packages/store/src/calc.ts:2840](../../packages/store/src/calc.ts#L2840) `sameValuesElsewhere` | `SQLite.all` (2840); `SQLite.prepare` (2840, 2847, 2849); `Store.sql` (2840, 2847, 2849); `Calculations.value` (2842); `SQLite.get` (2847, 2849) | CALC |
| [packages/store/src/calc.ts:3153](../../packages/store/src/calc.ts#L3153) `rowsById/flush` | `Calculations.statement` (3153); `SQLite.iterate` (3153) | CALC |
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
| [packages/store/src/fidelity.ts:146](../../packages/store/src/fidelity.ts#L146) `changedAfter` | `Untyped.executeSQL` (146) | DESIGN |
| [packages/store/src/fidelity.ts:166](../../packages/store/src/fidelity.ts#L166) `queryProblem` | `Calculations.translateSQL` (166); `Store.describe` (167) | DESIGN |
| [packages/store/src/fidelity.ts:184](../../packages/store/src/fidelity.ts#L184) `calcFidelity` | `Calculations.executeSQL` (184, 185, 271); `Store.sql` (189, 197, 270); `SQLite.all` (197); `SQLite.prepare` (197); `Calculations.computeStored` (233) | DESIGN |
| [packages/store/src/fmexport.ts:226](../../packages/store/src/fmexport.ts#L226) `fmExport` | `Store.recordCount` (226); `Store.query` (227); `Store.containerInfo` (242); `Store.container` (249) | OPERATOR |
| [packages/store/src/import.ts:91](../../packages/store/src/import.ts#L91) `addExternalSizeColumn` | `SQLite.all` (91); `SQLite.prepare` (91) | OPERATOR |
| [packages/store/src/import.ts:103](../../packages/store/src/import.ts#L103) `writeDesign` | `SQLite.prepare` (103, 107) | OPERATOR |
| [packages/store/src/import.ts:121](../../packages/store/src/import.ts#L121) `importDesigns` | `SQLite.all` (121); `SQLite.prepare` (121, 137, 139) | OPERATOR |
| [packages/store/src/import.ts:157](../../packages/store/src/import.ts#L157) `applyFileAccountStatus` | `SQLite.get` (157, 159); `SQLite.prepare` (157, 159, 161, 164) | OPERATOR |
| [packages/store/src/import.ts:184](../../packages/store/src/import.ts#L184) `createStore` | `SQLite.prepare` (184, 195) | OPERATOR |
| [packages/store/src/import.ts:207](../../packages/store/src/import.ts#L207) `needsDesigns` | `SQLite.get` (207); `SQLite.prepare` (207) | OPERATOR |
| [packages/store/src/import.ts:254](../../packages/store/src/import.ts#L254) `readState` | `SQLite.get` (254); `SQLite.prepare` (254) | OPERATOR |
| [packages/store/src/import.ts:301](../../packages/store/src/import.ts#L301) `importFmp12/save` | `SQLite.prepare` (301) | OPERATOR |
| [packages/store/src/import.ts:310](../../packages/store/src/import.ts#L310) `importFmp12` | `SQLite.prepare` (310, 320, 326, 332, 336, 351, 362, 437, 438); `SQLite.get` (326, 351); `SQLite.all` (332) | OPERATOR |
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
| [packages/store/src/store.ts:835](../../packages/store/src/store.ts#L835) `Store/metadataVersions` | `SQLite.get` (835); `SQLite.prepare` (835); `Store.sql` (835) | CORE |
| [packages/store/src/store.ts:929](../../packages/store/src/store.ts#L929) `Store/constructor` | `Store.sql` (929, 931, 933, 934, 938, 942, 943, 954, 959, 964, 965, 969, 970, 971, 978, 982, 986, 987, 988, 992, 996, 999, 1000, 1002, 1003, 1006, 1007, 1011, 1012, 1016, 1017, 1020, 1022, 1025, 1026, 1030, 1031, 1035, 1036, 1039, 1040, 1041, 1044, 1045, 1048, 1049, 1051, 1051, 1052, 1052, 1053, 1056, 1060, 1062, 1065, 1066, 1067, 1070, 1071, 1073, 1075, 1076, 1081, 1082, 1083, 1083, 1087, 1088); `SQLite.get` (933); `SQLite.prepare` (933, 999, 1000, 1003, 1006, 1011, 1016, 1025, 1030, 1035, 1044, 1048, 1051, 1052, 1070, 1075); `SQLite.all` (999, 1006, 1011, 1016, 1025, 1030, 1035, 1044, 1048, 1051, 1052, 1070, 1075) | CORE |
| [packages/store/src/store.ts:1107](../../packages/store/src/store.ts#L1107) `Store/grantFullAccessClients` | `SQLite.prepare` (1107); `Store.sql` (1107) | CORE |
| [packages/store/src/store.ts:1114](../../packages/store/src/store.ts#L1114) `Store/meta` | `SQLite.get` (1114); `SQLite.prepare` (1114); `Store.sql` (1114) | CORE |
| [packages/store/src/store.ts:1122](../../packages/store/src/store.ts#L1122) `Store/persistentTable` | `Store.sql` (1122) | CORE |
| [packages/store/src/store.ts:1132](../../packages/store/src/store.ts#L1132) `Store/persistentData` | `SQLite.get` (1132) | CORE |
| [packages/store/src/store.ts:1141](../../packages/store/src/store.ts#L1141) `Store/persistentDataIds` | `SQLite.all` (1141) | CORE |
| [packages/store/src/store.ts:1147](../../packages/store/src/store.ts#L1147) `Store/setPersistentData` | `SQLite.prepare` (1147, 1151); `Store.sql` (1147, 1151) | CORE |
| [packages/store/src/store.ts:1164](../../packages/store/src/store.ts#L1164) `Store/checkpoint` | `SQLite.get` (1164); `SQLite.prepare` (1164); `Store.sql` (1164) | CORE |
| [packages/store/src/store.ts:1172](../../packages/store/src/store.ts#L1172) `Store/recordedFormat` | `Store.sql` (1172) | CORE |
| [packages/store/src/store.ts:1182](../../packages/store/src/store.ts#L1182) `Store/close` | `Store.sql` (1182) | CORE |
| [packages/store/src/store.ts:1198](../../packages/store/src/store.ts#L1198) `Store/shipWal` | `Store.sql` (1198) | CORE |
| [packages/store/src/store.ts:1209](../../packages/store/src/store.ts#L1209) `Store/trial` | `Store.sql` (1209) | CORE |
| [packages/store/src/store.ts:1214](../../packages/store/src/store.ts#L1214) `Store/trial/undo` | `Store.sql` (1214) | CORE |
| [packages/store/src/store.ts:1249](../../packages/store/src/store.ts#L1249) `Store/joinTransaction` | `Store.sql` (1249, 1250, 1252, 1254, 1260) | CORE |
| [packages/store/src/store.ts:1272](../../packages/store/src/store.ts#L1272) `Store/independentWindowWrite` | `SQLite.get` (1272); `SQLite.prepare` (1272, 1295); `Store.sql` (1272, 1275, 1290, 1295, 1298) | CORE |
| [packages/store/src/store.ts:1316](../../packages/store/src/store.ts#L1316) `Store/withWriteTransaction` | `Store.sql` (1316, 1319, 1323, 1325, 1325) | CORE |
| [packages/store/src/store.ts:1353](../../packages/store/src/store.ts#L1353) `Store/endTransaction` | `Store.sql` (1353, 1356, 1356) | CORE |
| [packages/store/src/store.ts:1374](../../packages/store/src/store.ts#L1374) `Store/backup` | `Store.sql` (1374) | CORE |
| [packages/store/src/store.ts:1389](../../packages/store/src/store.ts#L1389) `Store/dataVersion` | `SQLite.get` (1389); `SQLite.prepare` (1389); `Store.sql` (1389) | CORE |
| [packages/store/src/store.ts:1429](../../packages/store/src/store.ts#L1429) `Store/warmSummariesCurrent` | `Calculations.wholeTable` (1429) | CORE |
| [packages/store/src/store.ts:1450](../../packages/store/src/store.ts#L1450) `Store/shareResults` | `Store.sql` (1450) | CORE |
| [packages/store/src/store.ts:1460](../../packages/store/src/store.ts#L1460) `Store/versionTriggers` | `SQLite.get` (1460); `SQLite.prepare` (1460, 1465, 1466); `Store.sql` (1460, 1462, 1463, 1465, 1466, 1475, 1476); `SQLite.all` (1465, 1466) | CORE |
| [packages/store/src/store.ts:1492](../../packages/store/src/store.ts#L1492) `Store/versionNumber` | `SQLite.get` (1492); `SQLite.prepare` (1492); `Store.sql` (1492) | CORE |
| [packages/store/src/store.ts:1505](../../packages/store/src/store.ts#L1505) `Store/changeOne` | `Store.sql` (1505, 1507) | CORE |
| [packages/store/src/store.ts:1508](../../packages/store/src/store.ts#L1508) `Store/changeOne/read` | `SQLite.get` (1508); `SQLite.prepare` (1508); `Store.sql` (1508) | CORE |
| [packages/store/src/store.ts:1547](../../packages/store/src/store.ts#L1547) `Store/writeToken` | `SQLite.get` (1547); `SQLite.prepare` (1547); `Store.sql` (1547) | CORE |
| [packages/store/src/store.ts:1559](../../packages/store/src/store.ts#L1559) `Store/recordCount` | `SQLite.get` (1559); `SQLite.prepare` (1559); `Store.sql` (1559) | CORE |
| [packages/store/src/store.ts:1663](../../packages/store/src/store.ts#L1663) `Store/applyDesign` | `Store.sql` (1663, 1664, 1675, 1678, 1683, 1695, 1698, 1698); `SQLite.prepare` (1678, 1683) | CORE |
| [packages/store/src/store.ts:1755](../../packages/store/src/store.ts#L1755) `Store/auditLog` | `SQLite.all` (1755); `SQLite.prepare` (1755); `Store.sql` (1755) | CORE |
| [packages/store/src/store.ts:1795](../../packages/store/src/store.ts#L1795) `Store/securityEvents` | `Store.auditLog` (1795) | CORE |
| [packages/store/src/store.ts:1821](../../packages/store/src/store.ts#L1821) `Store/prepared` | `SQLite.prepare` (1821); `Store.sql` (1821) | CORE |
| [packages/store/src/store.ts:1836](../../packages/store/src/store.ts#L1836) `Store/recordAsOf` | `SQLite.get` (1836, 1838); `SQLite.prepare` (1836, 1838, 1840, 1841); `Store.sql` (1836, 1838, 1840, 1841); `SQLite.all` (1840, 1841) | CORE |
| [packages/store/src/store.ts:1866](../../packages/store/src/store.ts#L1866) `Store/restoreRecord` | `Store.recordAsOf` (1866); `SQLite.get` (1870); `SQLite.prepare` (1870, 1873, 1880, 1887); `Store.sql` (1870, 1873, 1880, 1887) | CORE |
| [packages/store/src/store.ts:1901](../../packages/store/src/store.ts#L1901) `Store/revertAuditEntry` | `Store.auditLog` (1901) | CORE |
| [packages/store/src/store.ts:1994](../../packages/store/src/store.ts#L1994) `Store/setAuditSettings` | `SQLite.prepare` (1994); `Store.sql` (1994) | CORE |
| [packages/store/src/store.ts:2016](../../packages/store/src/store.ts#L2016) `Store/pruneAudit` | `Store.sql` (2016, 2018, 2020); `SQLite.get` (2018); `SQLite.prepare` (2018) | CORE |
| [packages/store/src/store.ts:2098](../../packages/store/src/store.ts#L2098) `Store/audit` | `Store.sql` (2098) | CORE |
| [packages/store/src/store.ts:2187](../../packages/store/src/store.ts#L2187) `Store/securityChange` | `Store.sql` (2187, 2189); `SQLite.prepare` (2189) | CORE |
| [packages/store/src/store.ts:2211](../../packages/store/src/store.ts#L2211) `Store/logSecurity` | `Store.sql` (2211) | CORE |
| [packages/store/src/store.ts:2234](../../packages/store/src/store.ts#L2234) `Store/ensureDeleted` | `Store.sql` (2234) | CORE |
| [packages/store/src/store.ts:2239](../../packages/store/src/store.ts#L2239) `Store/deletedRows` | `SQLite.get` (2239); `SQLite.prepare` (2239, 2241, 2241); `Store.sql` (2239, 2241, 2241); `SQLite.all` (2241, 2241) | CORE |
| [packages/store/src/store.ts:2265](../../packages/store/src/store.ts#L2265) `Store/emptyDeleted` | `Store.sql` (2265, 2268, 2269, 2271, 2273); `SQLite.prepare` (2269) | CORE |
| [packages/store/src/store.ts:2280](../../packages/store/src/store.ts#L2280) `Store/designHistory` | `SQLite.all` (2280); `SQLite.prepare` (2280); `Store.sql` (2280) | CORE |
| [packages/store/src/store.ts:2287](../../packages/store/src/store.ts#L2287) `Store/scriptHistory` | `SQLite.all` (2287); `SQLite.prepare` (2287); `Store.sql` (2287) | CORE |
| [packages/store/src/store.ts:2297](../../packages/store/src/store.ts#L2297) `Store/layoutHistory` | `SQLite.all` (2297); `SQLite.prepare` (2297); `Store.sql` (2297) | CORE |
| [packages/store/src/store.ts:2322](../../packages/store/src/store.ts#L2322) `Store/designEffect/renameKey` | `SQLite.prepare` (2322); `Store.sql` (2322) | CORE |
| [packages/store/src/store.ts:2338](../../packages/store/src/store.ts#L2338) `Store/designEffect/renameExcluded` | `SQLite.prepare` (2338); `Store.sql` (2338) | CORE |
| [packages/store/src/store.ts:2345](../../packages/store/src/store.ts#L2345) `Store/designEffect` | `Store.sql` (2345, 2349, 2354, 2359, 2362, 2368, 2376, 2377, 2379, 2391, 2392, 2395, 2397, 2403, 2404, 2405, 2410, 2412, 2416, 2419, 2420, 2422, 2425, 2430, 2432, 2439, 2440, 2442, 2443, 2444, 2445, 2452, 2453, 2455, 2455, 2457, 2458, 2459, 2463, 2467, 2469, 2507, 2509, 2511); `SQLite.get` (2376, 2391, 2403, 2404, 2416, 2420, 2455, 2463); `SQLite.prepare` (2376, 2377, 2391, 2392, 2403, 2404, 2410, 2412, 2416, 2420, 2430, 2432, 2445, 2452, 2453, 2455, 2457, 2459, 2463, 2467); `SQLite.all` (2452, 2453); `SQLite.iterate` (2457) | CORE |
| [packages/store/src/store.ts:2519](../../packages/store/src/store.ts#L2519) `Store/dropColumnIndexes` | `SQLite.all` (2519, 2521); `SQLite.prepare` (2519, 2521); `Store.sql` (2519, 2521, 2522) | CORE |
| [packages/store/src/store.ts:2531](../../packages/store/src/store.ts#L2531) `Store/recompute` | `SQLite.prepare` (2531, 2535); `Store.sql` (2531, 2535); `SQLite.iterate` (2535); `Calculations.computeStoredStyled` (2536); `Calculations.value` (2536) | CORE |
| [packages/store/src/store.ts:2551](../../packages/store/src/store.ts#L2551) `Store/linkPrincipal` | `SQLite.get` (2551); `SQLite.prepare` (2551); `Store.sql` (2551) | CORE |
| [packages/store/src/store.ts:2558](../../packages/store/src/store.ts#L2558) `Store/linkIdentity` | `SQLite.get` (2558); `SQLite.prepare` (2558); `Store.sql` (2558) | CORE |
| [packages/store/src/store.ts:2564](../../packages/store/src/store.ts#L2564) `Store/accountsSharingLockout` | `SQLite.all` (2564); `SQLite.prepare` (2564); `Store.sql` (2564) | CORE |
| [packages/store/src/store.ts:2568](../../packages/store/src/store.ts#L2568) `Store/accounts` | `SQLite.all` (2568); `SQLite.prepare` (2568); `Store.sql` (2568) | CORE |
| [packages/store/src/store.ts:2580](../../packages/store/src/store.ts#L2580) `Store/isAgent` | `SQLite.get` (2580); `SQLite.prepare` (2580); `Store.sql` (2580) | CORE |
| [packages/store/src/store.ts:2586](../../packages/store/src/store.ts#L2586) `Store/agentNeedsApproval` | `SQLite.get` (2586); `SQLite.prepare` (2586); `Store.sql` (2586) | CORE |
| [packages/store/src/store.ts:2592](../../packages/store/src/store.ts#L2592) `Store/blankPasswordAccounts` | `SQLite.all` (2592); `SQLite.prepare` (2592); `Store.sql` (2592) | CORE |
| [packages/store/src/store.ts:2603](../../packages/store/src/store.ts#L2603) `Store/unmigratedAccounts` | `SQLite.all` (2603); `SQLite.prepare` (2603); `Store.sql` (2603) | CORE |
| [packages/store/src/store.ts:2656](../../packages/store/src/store.ts#L2656) `Store/setExternalAccount` | `SQLite.get` (2656); `SQLite.prepare` (2656, 2661); `Store.sql` (2656, 2661) | CORE |
| [packages/store/src/store.ts:2674](../../packages/store/src/store.ts#L2674) `Store/refuseLookalikeAccount` | `SQLite.all` (2674); `SQLite.prepare` (2674); `Store.sql` (2674) | CORE |
| [packages/store/src/store.ts:2683](../../packages/store/src/store.ts#L2683) `Store/isExternal` | `SQLite.get` (2683); `SQLite.prepare` (2683); `Store.sql` (2683) | CORE |
| [packages/store/src/store.ts:2704](../../packages/store/src/store.ts#L2704) `Store/setAgentAccount` | `SQLite.get` (2704); `SQLite.prepare` (2704, 2710); `Store.sql` (2704, 2710) | CORE |
| [packages/store/src/store.ts:2744](../../packages/store/src/store.ts#L2744) `Store/gateAgentWrite` | `SQLite.prepare` (2744); `Store.sql` (2744) | CORE |
| [packages/store/src/store.ts:2766](../../packages/store/src/store.ts#L2766) `Store/pendingChanges` | `SQLite.all` (2766); `SQLite.prepare` (2766); `Store.sql` (2766) | CORE |
| [packages/store/src/store.ts:2780](../../packages/store/src/store.ts#L2780) `Store/approvePending` | `SQLite.get` (2780); `SQLite.prepare` (2780, 2791); `Store.sql` (2780, 2791) | CORE |
| [packages/store/src/store.ts:2801](../../packages/store/src/store.ts#L2801) `Store/rejectPending` | `SQLite.get` (2801); `SQLite.prepare` (2801, 2803); `Store.sql` (2801, 2803) | CORE |
| [packages/store/src/store.ts:2823](../../packages/store/src/store.ts#L2823) `Store/externalAccount` | `SQLite.all` (2823); `SQLite.prepare` (2823); `Store.sql` (2823) | CORE |
| [packages/store/src/store.ts:2857](../../packages/store/src/store.ts#L2857) `Store/setPassword` | `SQLite.get` (2857); `SQLite.prepare` (2857, 2859, 2868); `Store.sql` (2857, 2859, 2868) | AUTH |
| [packages/store/src/store.ts:2883](../../packages/store/src/store.ts#L2883) `Store/createAccount` | `SQLite.get` (2883); `SQLite.prepare` (2883, 2887, 2893, 2898, 2903); `Store.sql` (2883, 2887, 2893, 2898, 2903) | CORE |
| [packages/store/src/store.ts:2911](../../packages/store/src/store.ts#L2911) `Store/appendSecurityEvent` | `Store.sql` (2911) | CORE |
| [packages/store/src/store.ts:2933](../../packages/store/src/store.ts#L2933) `Store/setPasswordPolicy` | `SQLite.prepare` (2933); `Store.sql` (2933) | CORE |
| [packages/store/src/store.ts:2969](../../packages/store/src/store.ts#L2969) `Store/setRequireTotpForFullAccess` | `SQLite.prepare` (2969); `Store.sql` (2969) | CORE |
| [packages/store/src/store.ts:2992](../../packages/store/src/store.ts#L2992) `Store/saveScriptTest` | `SQLite.prepare` (2992); `Store.sql` (2992) | CORE |
| [packages/store/src/store.ts:3001](../../packages/store/src/store.ts#L3001) `Store/deleteScriptTest` | `SQLite.prepare` (3001); `Store.sql` (3001) | CORE |
| [packages/store/src/store.ts:3036](../../packages/store/src/store.ts#L3036) `Store/setAiAllowed` | `SQLite.prepare` (3036); `Store.sql` (3036) | CORE |
| [packages/store/src/store.ts:3047](../../packages/store/src/store.ts#L3047) `Store/setAiPolicy` | `SQLite.prepare` (3047); `Store.sql` (3047) | CORE |
| [packages/store/src/store.ts:3067](../../packages/store/src/store.ts#L3067) `Store/setPiiIsolation` | `SQLite.prepare` (3067); `Store.sql` (3067) | CORE |
| [packages/store/src/store.ts:3089](../../packages/store/src/store.ts#L3089) `Store/markPiiField` | `SQLite.prepare` (3089); `Store.sql` (3089) | CORE |
| [packages/store/src/store.ts:3203](../../packages/store/src/store.ts#L3203) `Store/lastSignIns` | `Store.auditLog` (3203) | CORE |
| [packages/store/src/store.ts:3406](../../packages/store/src/store.ts#L3406) `Store/unusualAccess` | `Store.auditLog` (3406, 3472) | CORE |
| [packages/store/src/store.ts:3503](../../packages/store/src/store.ts#L3503) `Store/leastPrivilege` | `SQLite.all` (3503); `SQLite.prepare` (3503); `Store.sql` (3503) | CORE |
| [packages/store/src/store.ts:3576](../../packages/store/src/store.ts#L3576) `Store/unusedAccess` | `SQLite.get` (3576); `SQLite.prepare` (3576, 3585); `Store.sql` (3576, 3585); `SQLite.all` (3585) | CORE |
| [packages/store/src/store.ts:3624](../../packages/store/src/store.ts#L3624) `Store/unusedObjects` | `SQLite.get` (3624); `SQLite.prepare` (3624, 3627); `Store.sql` (3624, 3627); `SQLite.all` (3627) | CORE |
| [packages/store/src/store.ts:3662](../../packages/store/src/store.ts#L3662) `Store/usageCounting` | `SQLite.get` (3662); `SQLite.prepare` (3662); `Store.sql` (3662) | CORE |
| [packages/store/src/store.ts:3670](../../packages/store/src/store.ts#L3670) `Store/setMustChangePassword` | `SQLite.prepare` (3670); `Store.sql` (3670) | CORE |
| [packages/store/src/store.ts:3684](../../packages/store/src/store.ts#L3684) `Store/mustChangePassword` | `SQLite.get` (3684); `SQLite.prepare` (3684); `Store.sql` (3684) | CORE |
| [packages/store/src/store.ts:3723](../../packages/store/src/store.ts#L3723) `Store/passwordDaysRemaining` | `SQLite.get` (3723); `SQLite.prepare` (3723); `Store.sql` (3723) | CORE |
| [packages/store/src/store.ts:3730](../../packages/store/src/store.ts#L3730) `Store/importAccounts` | `SQLite.all` (3730); `SQLite.prepare` (3730); `Store.sql` (3730) | CORE |
| [packages/store/src/store.ts:3753](../../packages/store/src/store.ts#L3753) `Store/canonicalAccount` | `SQLite.all` (3753); `SQLite.prepare` (3753); `Store.sql` (3753) | CORE |
| [packages/store/src/store.ts:3765](../../packages/store/src/store.ts#L3765) `Store/createLocalAccount` | `SQLite.prepare` (3765); `Store.sql` (3765) | CORE |
| [packages/store/src/store.ts:3795](../../packages/store/src/store.ts#L3795) `Store/previewAccountImport` | `Store.sql` (3795, 3796, 3805) | CORE |
| [packages/store/src/store.ts:3813](../../packages/store/src/store.ts#L3813) `Store/limitAccountImport` | `SQLite.prepare` (3813, 3814, 3817); `Store.sql` (3813, 3814, 3817); `SQLite.get` (3814) | CORE |
| [packages/store/src/store.ts:3824](../../packages/store/src/store.ts#L3824) `Store/applyAccountImport` | `Store.sql` (3824, 3832, 3861); `SQLite.get` (3832); `SQLite.prepare` (3832, 3861) | CORE |
| [packages/store/src/store.ts:3886](../../packages/store/src/store.ts#L3886) `Store/forgetStandIns` | `SQLite.prepare` (3886); `Store.sql` (3886) | CORE |
| [packages/store/src/store.ts:3919](../../packages/store/src/store.ts#L3919) `Store/deleteAccount` | `SQLite.prepare` (3919, 3920, 3921, 3923, 3927); `Store.sql` (3919, 3920, 3921, 3923, 3927) | CORE |
| [packages/store/src/store.ts:3944](../../packages/store/src/store.ts#L3944) `Store/setAccountActive` | `SQLite.prepare` (3944, 3947, 3948); `Store.sql` (3944, 3947, 3948) | AUTH |
| [packages/store/src/store.ts:3958](../../packages/store/src/store.ts#L3958) `Store/accountInactive` | `SQLite.get` (3958); `SQLite.prepare` (3958); `Store.sql` (3958) | CORE |
| [packages/store/src/store.ts:3963](../../packages/store/src/store.ts#L3963) `Store/identityAllowed` | `SQLite.get` (3963, 3969, 3975); `SQLite.prepare` (3963, 3969, 3975); `Store.sql` (3963, 3969, 3975) | CORE |
| [packages/store/src/store.ts:3983](../../packages/store/src/store.ts#L3983) `Store/externalIdentityId` | `SQLite.get` (3983, 3989); `SQLite.prepare` (3983, 3988, 3989); `Store.sql` (3983, 3988, 3989) | CORE |
| [packages/store/src/store.ts:3994](../../packages/store/src/store.ts#L3994) `Store/accountIdentityId` | `SQLite.get` (3994, 3999); `SQLite.prepare` (3994, 3998, 3999); `Store.sql` (3994, 3998, 3999) | CORE |
| [packages/store/src/store.ts:4022](../../packages/store/src/store.ts#L4022) `Store/signInMark` | `SQLite.prepare` (4022); `Store.sql` (4022) | AUTH |
| [packages/store/src/store.ts:4032](../../packages/store/src/store.ts#L4032) `Store/signInBase` | `SQLite.get` (4032); `SQLite.prepare` (4032); `Store.sql` (4032) | AUTH |
| [packages/store/src/store.ts:4034](../../packages/store/src/store.ts#L4034) `Store/signInBase/identity` | `SQLite.get` (4034); `SQLite.prepare` (4034); `Store.sql` (4034) | AUTH |
| [packages/store/src/store.ts:4046](../../packages/store/src/store.ts#L4046) `Store/ledgerRow` | `SQLite.get` (4046, 4047); `SQLite.prepare` (4046, 4047); `Store.sql` (4046, 4047) | AUTH |
| [packages/store/src/store.ts:4058](../../packages/store/src/store.ts#L4058) `Store/ledgerWrite` | `Store.sql` (4058, 4059, 4061, 4063, 4066, 4066) | AUTH |
| [packages/store/src/store.ts:4085](../../packages/store/src/store.ts#L4085) `Store/settleSignIns` | `SQLite.all` (4085, 4091); `SQLite.prepare` (4085, 4091, 4097, 4101, 4103); `Store.sql` (4085, 4091, 4097, 4101, 4103) | AUTH |
| [packages/store/src/store.ts:4114](../../packages/store/src/store.ts#L4114) `Store/securityToken` | `SQLite.get` (4114); `SQLite.prepare` (4114); `Store.sql` (4114) | CORE |
| [packages/store/src/store.ts:4122](../../packages/store/src/store.ts#L4122) `Store/accountLocalOnly` | `SQLite.get` (4122); `SQLite.prepare` (4122); `Store.sql` (4122) | CORE |
| [packages/store/src/store.ts:4127](../../packages/store/src/store.ts#L4127) `Store/accountRequires2fa` | `SQLite.get` (4127); `SQLite.prepare` (4127); `Store.sql` (4127) | CORE |
| [packages/store/src/store.ts:4133](../../packages/store/src/store.ts#L4133) `Store/setAccountLocalOnly` | `SQLite.prepare` (4133); `Store.sql` (4133) | CORE |
| [packages/store/src/store.ts:4142](../../packages/store/src/store.ts#L4142) `Store/setAccountRequire2fa` | `SQLite.prepare` (4142); `Store.sql` (4142) | CORE |
| [packages/store/src/store.ts:4170](../../packages/store/src/store.ts#L4170) `Store/createApiToken` | `SQLite.get` (4170); `SQLite.prepare` (4170, 4198); `Store.sql` (4170, 4198) | CORE |
| [packages/store/src/store.ts:4245](../../packages/store/src/store.ts#L4245) `Store/recordObjectUse` | `Store.sql` (4245) | CORE |
| [packages/store/src/store.ts:4275](../../packages/store/src/store.ts#L4275) `Store/writeUsage` | `Store.sql` (4275, 4276, 4278, 4282, 4284) | CORE |
| [packages/store/src/store.ts:4291](../../packages/store/src/store.ts#L4291) `Store/writeUsageRows` | `SQLite.prepare` (4291, 4292, 4298); `Store.sql` (4291, 4292, 4298) | CORE |
| [packages/store/src/store.ts:4303](../../packages/store/src/store.ts#L4303) `Store/writeObjectUseRows` | `SQLite.prepare` (4303, 4304, 4309); `Store.sql` (4303, 4304, 4309) | CORE |
| [packages/store/src/store.ts:4314](../../packages/store/src/store.ts#L4314) `Store/objectUseSince` | `SQLite.get` (4314); `SQLite.prepare` (4314); `Store.sql` (4314) | CORE |
| [packages/store/src/store.ts:4327](../../packages/store/src/store.ts#L4327) `Store/accountUsage` | `SQLite.get` (4327); `SQLite.prepare` (4327, 4328); `Store.sql` (4327, 4328); `SQLite.all` (4328); `Store.auditLog` (4344) | CORE |
| [packages/store/src/store.ts:4360](../../packages/store/src/store.ts#L4360) `Store/apiTokens` | `SQLite.all` (4360); `SQLite.prepare` (4360); `Store.sql` (4360) | CORE |
| [packages/store/src/store.ts:4370](../../packages/store/src/store.ts#L4370) `Store/revokeApiToken` | `SQLite.prepare` (4370); `Store.sql` (4370) | CORE |
| [packages/store/src/store.ts:4384](../../packages/store/src/store.ts#L4384) `Store/apiToken` | `SQLite.get` (4384); `SQLite.prepare` (4384, 4396); `Store.sql` (4384, 4396) | CORE |
| [packages/store/src/store.ts:4412](../../packages/store/src/store.ts#L4412) `Store/enrollTotp` | `SQLite.prepare` (4412); `Store.sql` (4412) | CORE |
| [packages/store/src/store.ts:4423](../../packages/store/src/store.ts#L4423) `Store/confirmTotp` | `SQLite.get` (4423); `SQLite.prepare` (4423, 4425); `Store.sql` (4423, 4425) | CORE |
| [packages/store/src/store.ts:4433](../../packages/store/src/store.ts#L4433) `Store/hasTotp` | `SQLite.get` (4433); `SQLite.prepare` (4433); `Store.sql` (4433) | CORE |
| [packages/store/src/store.ts:4438](../../packages/store/src/store.ts#L4438) `Store/totpAccounts` | `SQLite.all` (4438); `SQLite.prepare` (4438); `Store.sql` (4438) | CORE |
| [packages/store/src/store.ts:4444](../../packages/store/src/store.ts#L4444) `Store/disableTotp` | `SQLite.prepare` (4444); `Store.sql` (4444) | CORE |
| [packages/store/src/store.ts:4467](../../packages/store/src/store.ts#L4467) `Store/verifyTotp` | `SQLite.get` (4467); `SQLite.prepare` (4467, 4473); `Store.sql` (4467, 4473) | CORE |
| [packages/store/src/store.ts:4486](../../packages/store/src/store.ts#L4486) `Store/issueWebauthnChallenge` | `SQLite.prepare` (4486, 4488, 4489, 4491); `Store.sql` (4486, 4488, 4489, 4491); `SQLite.get` (4488) | CORE |
| [packages/store/src/store.ts:4538](../../packages/store/src/store.ts#L4538) `Store/passkeyAllowList` | `SQLite.all` (4538); `SQLite.prepare` (4538); `Store.sql` (4538) | CORE |
| [packages/store/src/store.ts:4552](../../packages/store/src/store.ts#L4552) `Store/takeWebauthnChallenge` | `SQLite.get` (4552); `SQLite.prepare` (4552, 4554); `Store.sql` (4552, 4554) | CORE |
| [packages/store/src/store.ts:4562](../../packages/store/src/store.ts#L4562) `Store/passkeys` | `SQLite.all` (4562); `SQLite.prepare` (4562); `Store.sql` (4562) | CORE |
| [packages/store/src/store.ts:4569](../../packages/store/src/store.ts#L4569) `Store/hasPasskey` | `SQLite.get` (4569); `SQLite.prepare` (4569); `Store.sql` (4569) | CORE |
| [packages/store/src/store.ts:4574](../../packages/store/src/store.ts#L4574) `Store/passkeyIds` | `SQLite.all` (4574); `SQLite.prepare` (4574); `Store.sql` (4574) | CORE |
| [packages/store/src/store.ts:4596](../../packages/store/src/store.ts#L4596) `Store/registerPasskey` | `SQLite.prepare` (4596); `Store.sql` (4596) | CORE |
| [packages/store/src/store.ts:4607](../../packages/store/src/store.ts#L4607) `Store/removePasskey` | `SQLite.get` (4607); `SQLite.prepare` (4607, 4608); `Store.sql` (4607, 4608) | CORE |
| [packages/store/src/store.ts:4624](../../packages/store/src/store.ts#L4624) `Store/verifyPasskeyAssertion` | `SQLite.get` (4624); `SQLite.prepare` (4624, 4635); `Store.sql` (4624, 4635) | CORE |
| [packages/store/src/store.ts:4671](../../packages/store/src/store.ts#L4671) `Store/generateRecoveryCodes` | `SQLite.prepare` (4671, 4674); `Store.sql` (4671, 4674) | CORE |
| [packages/store/src/store.ts:4689](../../packages/store/src/store.ts#L4689) `Store/recoveryCodesRemaining` | `SQLite.get` (4689); `SQLite.prepare` (4689); `Store.sql` (4689) | CORE |
| [packages/store/src/store.ts:4699](../../packages/store/src/store.ts#L4699) `Store/useRecoveryCode` | `SQLite.get` (4699); `SQLite.prepare` (4699, 4701); `Store.sql` (4699, 4701) | CORE |
| [packages/store/src/store.ts:4712](../../packages/store/src/store.ts#L4712) `Store/privilegeSets` | `Store.sql` (4712) | CORE |
| [packages/store/src/store.ts:4741](../../packages/store/src/store.ts#L4741) `Store/savePrivilegeSet` | `SQLite.prepare` (4741, 4749); `Store.sql` (4741, 4749) | AUTH |
| [packages/store/src/store.ts:4784](../../packages/store/src/store.ts#L4784) `Store/deletePrivilegeSet` | `SQLite.prepare` (4784); `Store.sql` (4784) | CORE |
| [packages/store/src/store.ts:4833](../../packages/store/src/store.ts#L4833) `Store/accountPrivilegeSet` | `SQLite.get` (4833); `SQLite.prepare` (4833); `Store.sql` (4833) | CORE |
| [packages/store/src/store.ts:4847](../../packages/store/src/store.ts#L4847) `Store/setAccountPrivilegeSet` | `SQLite.get` (4847); `SQLite.prepare` (4847, 4850, 4854); `Store.sql` (4847, 4850, 4854) | AUTH |
| [packages/store/src/store.ts:4869](../../packages/store/src/store.ts#L4869) `Store/clearAccountPrivilegeSet` | `SQLite.prepare` (4869); `Store.sql` (4869) | CORE |
| [packages/store/src/store.ts:4883](../../packages/store/src/store.ts#L4883) `Store/addProvisionedAccount` | `SQLite.get` (4883); `SQLite.prepare` (4883, 4887); `Store.sql` (4883, 4887) | CORE |
| [packages/store/src/store.ts:5048](../../packages/store/src/store.ts#L5048) `Store/ruleOutcome` | `Calculations.context` (5048) | CORE |
| [packages/store/src/store.ts:5089](../../packages/store/src/store.ts#L5089) `Store/allowedIds` | `SQLite.iterate` (5089); `SQLite.prepare` (5089); `Store.sql` (5089) | CORE |
| [packages/store/src/store.ts:5159](../../packages/store/src/store.ts#L5159) `Store/scopedTableSql` | `Store.viewableIds` (5159); `SQLite.all` (5162); `SQLite.prepare` (5162); `Store.sql` (5162) | GATED-STORE |
| [packages/store/src/store.ts:5194](../../packages/store/src/store.ts#L5194) `Store/previewRecordRuleCurrent` | `SQLite.get` (5194); `SQLite.prepare` (5194, 5197); `Store.sql` (5194, 5197); `SQLite.all` (5197); `Calculations.context` (5203, 5219) | CORE |
| [packages/store/src/store.ts:5371](../../packages/store/src/store.ts#L5371) `Store/passwordHash` | `SQLite.get` (5371); `SQLite.prepare` (5371); `Store.sql` (5371) | CORE |
| [packages/store/src/store.ts:5400](../../packages/store/src/store.ts#L5400) `Store/setAllowBlankPasswordFromLan` | `SQLite.prepare` (5400); `Store.sql` (5400) | CORE |
| [packages/store/src/store.ts:5413](../../packages/store/src/store.ts#L5413) `Store/knownSharedAccount` | `SQLite.get` (5413); `SQLite.prepare` (5413); `Store.sql` (5413) | CORE |
| [packages/store/src/store.ts:5471](../../packages/store/src/store.ts#L5471) `Store/layouts` | `SQLite.all` (5471); `SQLite.prepare` (5471); `Store.sql` (5471) | CORE |
| [packages/store/src/store.ts:5492](../../packages/store/src/store.ts#L5492) `Store/image` | `SQLite.get` (5492); `SQLite.prepare` (5492); `Store.sql` (5492) | CORE |
| [packages/store/src/store.ts:5502](../../packages/store/src/store.ts#L5502) `Store/images` | `SQLite.all` (5502); `SQLite.prepare` (5502); `Store.sql` (5502) | CORE |
| [packages/store/src/store.ts:5515](../../packages/store/src/store.ts#L5515) `Store/addImage` | `Store.sql` (5515, 5516); `SQLite.prepare` (5516) | CORE |
| [packages/store/src/store.ts:5532](../../packages/store/src/store.ts#L5532) `Store/layout` | `SQLite.get` (5532); `SQLite.prepare` (5532); `Store.sql` (5532) | CORE |
| [packages/store/src/store.ts:5736](../../packages/store/src/store.ts#L5736) `Store/wordIndex` | `Store.sql` (5736, 5744, 5749); `Store.recordCount` (5748); `SQLite.get` (5749); `SQLite.prepare` (5749) | CORE |
| [packages/store/src/store.ts:5801](../../packages/store/src/store.ts#L5801) `Store/toRecord` | `Calculations.value` (5801, 5811); `Calculations.globalValue` (5805); `Calculations.unstoredStyled` (5810) | CORE |
| [packages/store/src/store.ts:5860](../../packages/store/src/store.ts#L5860) `Store/relatedValues` | `Calculations.globalValue` (5860); `Calculations.unstoredValue` (5862) | CORE |
| [packages/store/src/store.ts:5934](../../packages/store/src/store.ts#L5934) `Store/addRelated` | `relatedRows` (5934); `rowsById` (5966); `firstRelatedEach` (5988) | CORE |
| [packages/store/src/store.ts:6016](../../packages/store/src/store.ts#L6016) `Store/foundSetPage` | `rowsById` (6016) | CORE |
| [packages/store/src/store.ts:6032](../../packages/store/src/store.ts#L6032) `Store/foundSetRowsCurrent` | `Store.viewableIds` (6032); `Store.row` (6048) | GATED-STORE |
| [packages/store/src/store.ts:6071](../../packages/store/src/store.ts#L6071) `Store/portalCountsCurrent` | `Store.canView` (6071); `Store.row` (6098) | GATED-STORE |
| [packages/store/src/store.ts:6134](../../packages/store/src/store.ts#L6134) `Store/fieldIndexCurrent` | `SQLite.iterate` (6134); `SQLite.prepare` (6134, 6139); `Store.sql` (6134, 6139); `SQLite.all` (6139) | GATED-STORE |
| [packages/store/src/store.ts:6180](../../packages/store/src/store.ts#L6180) `Store/valueListItemsCurrent` | `Store.valueListItems` (6180); `Store.get` (6194); `relatedRows` (6195); `Store.row` (6195); `SQLite.iterate` (6197); `SQLite.prepare` (6197); `Store.sql` (6197); `Calculations.related` (6207); `Calculations.value` (6211, 6212) | GATED-STORE |
| [packages/store/src/store.ts:6309](../../packages/store/src/store.ts#L6309) `Store/portalRows` | `relatedRows` (6309); `relatedIdList` (6310); `Store.viewableIds` (6313); `rowsById` (6338, 6376); `Calculations.related` (6352) | CORE |
| [packages/store/src/store.ts:6320](../../packages/store/src/store.ts#L6320) `Store/portalRows/context` | `Calculations.context` (6320) | CORE |
| [packages/store/src/store.ts:6330](../../packages/store/src/store.ts#L6330) `Store/portalRows/valueOf` | `Calculations.value` (6330) | CORE |
| [packages/store/src/store.ts:6447](../../packages/store/src/store.ts#L6447) `Store/markRepeating` | `SQLite.prepare` (6447); `Store.sql` (6447) | CORE |
| [packages/store/src/store.ts:6474](../../packages/store/src/store.ts#L6474) `Store/externalContainerCheck` | `SQLite.all` (6474); `SQLite.prepare` (6474); `Store.sql` (6474) | CORE |
| [packages/store/src/store.ts:6481](../../packages/store/src/store.ts#L6481) `Store/externalContainerCount` | `SQLite.get` (6481); `SQLite.prepare` (6481); `Store.sql` (6481) | CORE |
| [packages/store/src/store.ts:6490](../../packages/store/src/store.ts#L6490) `Store/externalContainerReport` | `SQLite.all` (6490, 6503); `SQLite.prepare` (6490, 6503); `Store.sql` (6490, 6503) | CORE |
| [packages/store/src/store.ts:6545](../../packages/store/src/store.ts#L6545) `Store/orphanContainerReport` | `SQLite.all` (6545, 6563, 6565, 6571, 6584, 6597, 6616, 6634); `SQLite.prepare` (6545, 6563, 6565, 6571, 6584, 6597, 6614, 6616, 6634); `Store.sql` (6545, 6563, 6565, 6571, 6584, 6597, 6614, 6616, 6634); `SQLite.get` (6614); `Store.row` (6628) | CORE |
| [packages/store/src/store.ts:6645](../../packages/store/src/store.ts#L6645) `Store/purgeOrphanContainers` | `Store.sql` (6645, 6654, 6657, 6659, 6660, 6665, 6667); `Store.orphanContainerReport` (6646); `SQLite.get` (6654); `SQLite.prepare` (6654, 6659, 6660) | CORE |
| [packages/store/src/store.ts:6680](../../packages/store/src/store.ts#L6680) `Store/containerIntact` | `SQLite.get` (6680); `SQLite.prepare` (6680); `Store.sql` (6680) | CORE |
| [packages/store/src/store.ts:6690](../../packages/store/src/store.ts#L6690) `Store/externalOf` | `SQLite.get` (6690); `SQLite.prepare` (6690); `Store.sql` (6690) | CORE |
| [packages/store/src/store.ts:6694](../../packages/store/src/store.ts#L6694) `Store/containerMeta` | `SQLite.get` (6694); `SQLite.prepare` (6694); `Store.sql` (6694) | CORE |
| [packages/store/src/store.ts:6699](../../packages/store/src/store.ts#L6699) `Store/container` | `SQLite.get` (6699); `SQLite.prepare` (6699, 6708); `Store.sql` (6699, 6708); `SQLite.all` (6708) | CORE |
| [packages/store/src/store.ts:6716](../../packages/store/src/store.ts#L6716) `Store/containerInfo` | `SQLite.get` (6716); `SQLite.prepare` (6716); `Store.sql` (6716) | CORE |
| [packages/store/src/store.ts:6750](../../packages/store/src/store.ts#L6750) `Store/containerRange` | `SQLite.all` (6750); `SQLite.prepare` (6750, 6757); `Store.sql` (6750, 6757); `SQLite.get` (6757) | CORE |
| [packages/store/src/store.ts:6770](../../packages/store/src/store.ts#L6770) `Store/addContainer` | `SQLite.prepare` (6770, 6774, 6775); `Store.sql` (6770, 6772, 6774, 6775, 6777, 6780) | CORE |
| [packages/store/src/store.ts:6796](../../packages/store/src/store.ts#L6796) `Store/addExternalContainer` | `SQLite.prepare` (6796); `Store.sql` (6796) | CORE |
| [packages/store/src/store.ts:6814](../../packages/store/src/store.ts#L6814) `Store/writeExternalFile` | `Store.evaluateEach` (6814); `SQLite.prepare` (6837); `Store.sql` (6837) | CORE |
| [packages/store/src/store.ts:6838](../../packages/store/src/store.ts#L6838) `Store/writeExternalFile/taken` | `SQLite.get` (6838) | CORE |
| [packages/store/src/store.ts:6855](../../packages/store/src/store.ts#L6855) `Store/embeddedContainers` | `SQLite.prepare` (6855, 6856); `Store.sql` (6855, 6856); `SQLite.all` (6856); `SQLite.get` (6860) | CORE |
| [packages/store/src/store.ts:6869](../../packages/store/src/store.ts#L6869) `Store/embeddedContainerCount` | `SQLite.prepare` (6869); `Store.sql` (6869); `SQLite.get` (6870) | CORE |
| [packages/store/src/store.ts:6878](../../packages/store/src/store.ts#L6878) `Store/recoverContainersOut` | `SQLite.prepare` (6878); `Store.sql` (6878); `SQLite.get` (6881) | CORE |
| [packages/store/src/store.ts:6903](../../packages/store/src/store.ts#L6903) `Store/moveContainersOut` | `Store.sql` (6903, 6911, 6913, 6915, 6917, 6918, 6937, 6942, 6944, 6946, 6947, 6951); `SQLite.get` (6911); `SQLite.prepare` (6911, 6917, 6918); `Store.container` (6920) | CORE |
| [packages/store/src/store.ts:6960](../../packages/store/src/store.ts#L6960) `Store/moveContainersIn` | `Store.sql` (6960, 6964, 6966, 6967, 6968, 6969, 6988, 6991, 6998, 7001, 7004, 7011); `SQLite.prepare` (6966, 6967, 6968, 6969, 6998, 7004); `SQLite.get` (6971, 6998, 7004) | CORE |
| [packages/store/src/store.ts:7023](../../packages/store/src/store.ts#L7023) `Store/compactFile` | `Store.sql` (7023, 7024, 7025) | CORE |
| [packages/store/src/store.ts:7031](../../packages/store/src/store.ts#L7031) `Store/containerId` | `Store.containerId` (7031); `Store.row` (7032) | CORE |
| [packages/store/src/store.ts:7054](../../packages/store/src/store.ts#L7054) `Store/checkContainerWrite` | `Store.row` (7054) | CORE |
| [packages/store/src/store.ts:7064](../../packages/store/src/store.ts#L7064) `Store/setContainer` | `Store.row` (7064); `SQLite.prepare` (7075); `Store.sql` (7075) | CORE |
| [packages/store/src/store.ts:7107](../../packages/store/src/store.ts#L7107) `Store/orderBy` | `Store.valueListItems` (7107) | CORE |
| [packages/store/src/store.ts:7130](../../packages/store/src/store.ts#L7130) `Store/userPrefs` | `SQLite.all` (7130); `SQLite.prepare` (7130); `Store.sql` (7130) | CORE |
| [packages/store/src/store.ts:7135](../../packages/store/src/store.ts#L7135) `Store/hasTable` | `SQLite.get` (7135); `SQLite.prepare` (7135); `Store.sql` (7135) | CORE |
| [packages/store/src/store.ts:7139](../../packages/store/src/store.ts#L7139) `Store/setUserPref` | `Store.sql` (7139, 7140, 7141); `SQLite.prepare` (7140, 7141) | CORE |
| [packages/store/src/store.ts:7147](../../packages/store/src/store.ts#L7147) `Store/indexedFields` | `SQLite.all` (7147, 7148); `SQLite.prepare` (7147, 7148); `Store.sql` (7147, 7148) | CORE |
| [packages/store/src/store.ts:7169](../../packages/store/src/store.ts#L7169) `Store/addFieldIndex` | `Store.sql` (7169) | CORE |
| [packages/store/src/store.ts:7181](../../packages/store/src/store.ts#L7181) `Store/dropFieldIndex` | `SQLite.get` (7181); `SQLite.prepare` (7181); `Store.sql` (7181, 7182) | CORE |
| [packages/store/src/store.ts:7192](../../packages/store/src/store.ts#L7192) `Store/timeFind` | `Store.query` (7192, 7196, 7197); `Store.recordCount` (7199) | CORE |
| [packages/store/src/store.ts:7216](../../packages/store/src/store.ts#L7216) `Store/find` | `Store.find` (7216) | GATED-STORE |
| [packages/store/src/store.ts:7227](../../packages/store/src/store.ts#L7227) `Store/findHere` | `Store.query` (7227, 7232, 7234, 7248, 7250, 7260); `Store.recordCount` (7245); `SQLite.get` (7246, 7250); `SQLite.prepare` (7246, 7250, 7255, 7262, 7271); `Store.sql` (7246, 7250, 7255, 7262, 7271); `SQLite.all` (7255, 7262, 7271) | GATED-STORE |
| [packages/store/src/store.ts:7266](../../packages/store/src/store.ts#L7266) `Store/findHere/[Symbol.iterator]` | `SQLite.iterate` (7266); `SQLite.prepare` (7266); `Store.sql` (7266) | GATED-STORE |
| [packages/store/src/store.ts:7295](../../packages/store/src/store.ts#L7295) `Store/sortedPage` | `SQLite.all` (7295, 7307); `SQLite.prepare` (7295, 7307); `Store.sql` (7295, 7307) | CORE |
| [packages/store/src/store.ts:7364](../../packages/store/src/store.ts#L7364) `Store/relatedCriteria/matched` | `relatedRows` (7364) | CORE |
| [packages/store/src/store.ts:7367](../../packages/store/src/store.ts#L7367) `Store/relatedCriteria` | `SQLite.iterate` (7367); `SQLite.prepare` (7367); `Store.sql` (7367) | CORE |
| [packages/store/src/store.ts:7393](../../packages/store/src/store.ts#L7393) `Store/computedRows` | `Store.sql` (7393, 7396, 7397, 7398, 7400, 7410, 7411, 7412, 7415); `SQLite.prepare` (7396, 7398, 7400, 7410); `SQLite.iterate` (7400); `Calculations.globalValue` (7403); `Calculations.unstoredValue` (7404); `Calculations.related` (7407); `SQLite.all` (7410) | CORE |
| [packages/store/src/store.ts:7440](../../packages/store/src/store.ts#L7440) `Store/summaries` | `Calculations.wholeTable` (7440); `Calculations.collect` (7460, 7465) | CORE |
| [packages/store/src/store.ts:7456](../../packages/store/src/store.ts#L7456) `Store/summaries/recs` | `SQLite.iterate` (7456); `SQLite.prepare` (7456); `Store.sql` (7456) | CORE |
| [packages/store/src/store.ts:7478](../../packages/store/src/store.ts#L7478) `Store/runningSummaryValues` | `Store.viewableIds` (7478); `rowsById` (7480); `Calculations.value` (7491, 7497); `Calculations.related` (7508) | GATED-STORE |
| [packages/store/src/store.ts:7521](../../packages/store/src/store.ts#L7521) `Store/findSource` | `Store.query` (7521); `Store.sql` (7528, 7529, 7533, 7535, 7546, 7548); `SQLite.prepare` (7529, 7535); `SQLite.iterate` (7535); `Calculations.globalValue` (7539); `Calculations.unstoredValue` (7540); `Calculations.related` (7544) | CORE |
| [packages/store/src/store.ts:7567](../../packages/store/src/store.ts#L7567) `Store/previewRow` | `Store.row` (7567) | CORE |
| [packages/store/src/store.ts:7585](../../packages/store/src/store.ts#L7585) `Store/row` | `SQLite.get` (7585) | CORE |
| [packages/store/src/store.ts:7604](../../packages/store/src/store.ts#L7604) `Store/getCurrent` | `Store.get` (7604); `Store.row` (7605, 7605, 7619); `SQLite.all` (7622); `SQLite.prepare` (7622); `Store.sql` (7622) | GATED-STORE |
| [packages/store/src/store.ts:7642](../../packages/store/src/store.ts#L7642) `Store/getManyCurrent` | `Store.getMany` (7642); `SQLite.get` (7660); `SQLite.prepare` (7660); `Store.sql` (7660) | GATED-STORE |
| [packages/store/src/store.ts:7653](../../packages/store/src/store.ts#L7653) `Store/getManyCurrent/[Symbol.iterator]` | `rowsById` (7653) | GATED-STORE |
| [packages/store/src/store.ts:7676](../../packages/store/src/store.ts#L7676) `Store/canViewRecord` | `SQLite.get` (7676); `SQLite.prepare` (7676); `Store.sql` (7676) | GATED-STORE |
| [packages/store/src/store.ts:7684](../../packages/store/src/store.ts#L7684) `Store/canView` | `Store.canView` (7684); `Store.row` (7685) | GATED-STORE |
| [packages/store/src/store.ts:7709](../../packages/store/src/store.ts#L7709) `Store/create` | `SQLite.get` (7709, 7715); `SQLite.prepare` (7709, 7715, 7726); `Store.sql` (7709, 7715, 7726) | CORE |
| [packages/store/src/store.ts:7750](../../packages/store/src/store.ts#L7750) `Store/duplicate` | `Store.row` (7750); `SQLite.get` (7754); `SQLite.prepare` (7754, 7767); `Store.sql` (7754, 7767) | CORE |
| [packages/store/src/store.ts:7812](../../packages/store/src/store.ts#L7812) `Store/update` | `Store.row` (7812, 7819, 7830); `Store.sql` (7843, 7844, 7881, 7884) | CORE |
| [packages/store/src/store.ts:7846](../../packages/store/src/store.ts#L7846) `Store/update/undo` | `Store.sql` (7846) | CORE |
| [packages/store/src/store.ts:7988](../../packages/store/src/store.ts#L7988) `Store/setStoredCalcValues` | `SQLite.prepare` (7988, 7989); `Store.sql` (7988, 7989); `SQLite.get` (7993) | CORE |
| [packages/store/src/store.ts:8067](../../packages/store/src/store.ts#L8067) `Store/evaluateCurrent` | `Store.row` (8067, 8067); `Calculations.context` (8068); `Store.get` (8069, 8071) | GATED-STORE |
| [packages/store/src/store.ts:8103](../../packages/store/src/store.ts#L8103) `Store/evaluateEachCurrent` | `Store.row` (8103, 8103); `Calculations.context` (8108); `Store.get` (8110) | GATED-STORE |
| [packages/store/src/store.ts:8143](../../packages/store/src/store.ts#L8143) `Store/evaluateRowsCurrent/each` | `Calculations.context` (8143); `Store.get` (8145) | GATED-STORE |
| [packages/store/src/store.ts:8164](../../packages/store/src/store.ts#L8164) `Store/evaluateRowsCurrent` | `Store.row` (8164, 8164) | GATED-STORE |
| [packages/store/src/store.ts:8178](../../packages/store/src/store.ts#L8178) `Store/evaluateRowsCurrent/found/[Symbol.iterator]` | `rowsById` (8178) | GATED-STORE |
| [packages/store/src/store.ts:8200](../../packages/store/src/store.ts#L8200) `Store/evaluateRowsCurrent/key` | `Calculations.context` (8200) | GATED-STORE |
| [packages/store/src/store.ts:8238](../../packages/store/src/store.ts#L8238) `Store/updateRelated` | `relatedRows` (8238) | CORE |
| [packages/store/src/store.ts:8256](../../packages/store/src/store.ts#L8256) `Store/updatePortals` | `Store.row` (8256, 8291); `relatedRows` (8292) | CORE |
| [packages/store/src/store.ts:8265](../../packages/store/src/store.ts#L8265) `Store/updatePortals/portal/related` | `relatedIdList` (8265) | CORE |
| [packages/store/src/store.ts:8347](../../packages/store/src/store.ts#L8347) `Store/portalContainerTarget` | `Store.row` (8347); `relatedIdList` (8348) | CORE |
| [packages/store/src/store.ts:8361](../../packages/store/src/store.ts#L8361) `Store/checkEditable` | `Store.row` (8361) | CORE |
| [packages/store/src/store.ts:8384](../../packages/store/src/store.ts#L8384) `Store/delete` | `Store.row` (8384); `SQLite.get` (8389); `SQLite.prepare` (8389, 8391); `Store.sql` (8389, 8391) | CORE |
| [packages/store/src/store.ts:8412](../../packages/store/src/store.ts#L8412) `Store/vaultHeld` | `SQLite.get` (8412); `SQLite.prepare` (8412); `Store.sql` (8412) | CORE |
| [packages/store/src/store.ts:8419](../../packages/store/src/store.ts#L8419) `Store/forgetStandInValues` | `Store.sql` (8419, 8440); `SQLite.prepare` (8440) | CORE |
| [packages/store/src/store.ts:8454](../../packages/store/src/store.ts#L8454) `Store/restoreDeletedRow` | `SQLite.get` (8454); `SQLite.prepare` (8454, 8455, 8457); `Store.sql` (8454, 8455, 8457); `SQLite.all` (8455) | CORE |
| [packages/store/src/store.ts:8481](../../packages/store/src/store.ts#L8481) `Store/cascadeDelete` | `relatedRows` (8481) | CORE |
| [packages/store/src/store.ts:8571](../../packages/store/src/store.ts#L8571) `Store/selectIdsCurrent` | `Store.selectIds` (8571); `SQLite.all` (8577); `SQLite.prepare` (8577); `Store.sql` (8577) | GATED-STORE |
| [packages/store/src/store.ts:8585](../../packages/store/src/store.ts#L8585) `Store/countIds` | `Store.countIds` (8585); `SQLite.get` (8589); `SQLite.prepare` (8589); `Store.sql` (8589) | GATED-STORE |
| [packages/store/src/store.ts:8605](../../packages/store/src/store.ts#L8605) `Store/computeValuesCurrent` | `Store.computeValues` (8605); `Store.sql` (8611, 8615); `SQLite.all` (8615); `SQLite.prepare` (8615) | GATED-STORE |
| [packages/store/src/store.ts:8630](../../packages/store/src/store.ts#L8630) `Store/findIdsCurrent` | `Store.findIds` (8630) | GATED-STORE |
| [packages/store/src/store.ts:8636](../../packages/store/src/store.ts#L8636) `Store/findIdsHere` | `Store.query` (8636, 8641, 8643); `SQLite.all` (8653); `SQLite.prepare` (8653); `Store.sql` (8653) | GATED-STORE |
| [packages/store/src/store.ts:8669](../../packages/store/src/store.ts#L8669) `Store/groupSummariesCurrent` | `Store.groupSummaries` (8669); `Store.viewableIds` (8674); `Calculations.collect` (8690); `rowsById` (8690, 8740); `Calculations.collector` (8712) | GATED-STORE |
| [packages/store/src/store.ts:8702](../../packages/store/src/store.ts#L8702) `Store/groupSummariesCurrent/key` | `Calculations.value` (8702); `Calculations.related` (8704) | GATED-STORE |
| [packages/store/src/store.ts:8738](../../packages/store/src/store.ts#L8738) `Store/groupSummariesCurrent/flush` | `Calculations.collector` (8738) | GATED-STORE |
| [packages/store/src/store.ts:8761](../../packages/store/src/store.ts#L8761) `Store/sortIdsCurrent` | `Store.sortIds` (8761); `SQLite.all` (8765); `SQLite.prepare` (8765); `Store.sql` (8765) | GATED-STORE |
| [packages/store/src/store.ts:8775](../../packages/store/src/store.ts#L8775) `Store/matchIds` | `Store.matchIds` (8775); `SQLite.all` (8781); `SQLite.prepare` (8781); `Store.sql` (8781) | CORE |
| [packages/store/src/store.ts:8799](../../packages/store/src/store.ts#L8799) `Store/truncate` | `Store.sql` (8799, 8801, 8808, 8809, 8811, 8812); `SQLite.prepare` (8801, 8808); `SQLite.all` (8803) | CORE |
| [packages/store/src/store.ts:8833](../../packages/store/src/store.ts#L8833) `Store/iterateCommitted` | `SQLite.iterate` (8833) | CORE |
| [packages/store/src/store.ts:8867](../../packages/store/src/store.ts#L8867) `Store/readOnlyChecked` | `SQLite.prepare` (8867, 8871, 8880, 8885); `SQLite.all` (8871, 8880, 8885) | CORE |
| [packages/store/src/store.ts:8907](../../packages/store/src/store.ts#L8907) `Store/refreshDecimalSqlViews` | `SQLite.get` (8907); `SQLite.prepare` (8907, 8912); `SQLite.all` (8912) | CORE |
| [packages/store/src/store.ts:8926](../../packages/store/src/store.ts#L8926) `Store/internalRoots` | `SQLite.get` (8926); `SQLite.prepare` (8926, 8928); `SQLite.all` (8928) | CORE |
| [packages/store/src/store.ts:8961](../../packages/store/src/store.ts#L8961) `Store/selectCurrent` | `SQLite.iterate` (8961) | CORE |
| [packages/store/src/store.ts:8982](../../packages/store/src/store.ts#L8982) `Store/query` | `SQLite.iterate` (8982) | CORE |
| [packages/store/src/store.ts:9016](../../packages/store/src/store.ts#L9016) `Store/queryWithOriginsCurrent` | `SQLite.iterate` (9016); `SQLite.all` (9023, 9026); `SQLite.prepare` (9023, 9026) | CORE |
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
