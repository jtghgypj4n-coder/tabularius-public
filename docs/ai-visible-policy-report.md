# AI-visible policy implementation report

Implements the interim recommendation in `docs/research/secret-taint-tracking.md`. No taint labels or dependencies were added.

## Behavior and review limits

- `_fm_meta.aiPolicy` is true only for newly created solutions. Missing metadata is OFF, including converted `.fmp12` files. Toggles persist through reopen.
- Privilege definitions store `aiVisible: { [baseTable]: true | string[] }`. Full Access needs explicit marks too; marks never grant normal field/record rights. Existing redaction remains in the surfaces that already used it.
- Checks conservatively include every table in a file and its referenced files, formulas and record-access rules. This can refuse an unrelated safe table. Script execution checks all saved scripts as well as actual unsaved programs and completed subcalls. Trial design/automation programs are refused when unproved.
- This is not persisted taint tracking. It cannot reconstruct old copied values after their sources disappear, and user-supplied prompt text is outside its scope.
- No commit or push was made. The final diff contains no changes under `.impeccable/`, `.github/`, or `fixtures/`. An automated edit hook briefly updated its `.impeccable` cache; that incidental change was restored to its original bytes.

## Entry-point inventory

| Entry point | Source | Coverage |
| --- | --- | --- |
| Shared assistant / connector refusal | `packages/server/src/ai-access.ts:35` | Checks the referenced-file graph and the caller’s privilege set. |
| Policy implementation | `packages/server/src/ai-policy.ts:34` | Secret-name exceptions; formula, SQL and script preflight. |
| SQL inspection without execution | `packages/store/src/store.ts:8205` | SQLite VM read sources; virtual sources and registered application functions refused. |
| MCP tool dispatcher | `packages/server/src/mcp.ts:469` | All file-naming tools, including those registered by mcp-design.ts. |
| MCP resource reads | `packages/server/src/mcp.ts:2112` | Schema, overview, conversion guide, script, layout samples, automations and audit resources. |
| Assistant conversionOverview | `packages/server/src/assistant.ts:940` | Shared preflight before provider dispatch; chat rechecks between turns. |
| Assistant handoverMemo | `packages/server/src/assistant.ts:1031` | Shared preflight before provider dispatch; chat rechecks between turns. |
| Assistant scriptDocs | `packages/server/src/assistant.ts:1063` | Shared preflight before provider dispatch; chat rechecks between turns. |
| Assistant mapImport | `packages/server/src/assistant.ts:1104` | Shared preflight before provider dispatch; chat rechecks between turns. |
| Assistant suggestScriptTests | `packages/server/src/assistant.ts:1149` | Shared preflight before provider dispatch; chat rechecks between turns. |
| Assistant fillField | `packages/server/src/assistant.ts:1190` | Shared preflight before provider dispatch; chat rechecks between turns. |
| Assistant speedIdeas | `packages/server/src/assistant.ts:1250` | Shared preflight before provider dispatch; chat rechecks between turns. |
| Assistant summarize | `packages/server/src/assistant.ts:1289` | Shared preflight before provider dispatch; chat rechecks between turns. |
| Assistant chat | `packages/server/src/assistant.ts:1413` | Shared preflight before provider dispatch; chat rechecks between turns. |
| New solution planning | `packages/server/src/assistant.ts:964` | Starts from empty scratch design and user-supplied input; no existing record source. |
| Script AI / model / embedding / RAG dispatcher | `packages/server/src/assistant.ts:1306` | refusal, generate, embed, embedImage, RAG add/search/remove/spaces/info; direct callbacks recheck policy. |
| Executing and unsaved scripts | `packages/scripts/src/engine.ts:2414` | Checks actual programs, completed subcalls and caller files before model use; unknown caller programs fail closed. |
| Script program tracking | `packages/scripts/src/engine.ts:3163` | Records actual programs rather than trusting only saved scripts. |
| Semantic find | `packages/server/src/semantic-find.ts:46` | Before record scans or embedding dispatch, including direct callers. |
| AI-built interfaces / modernize | `packages/server/src/modernize.ts:230` | Both MCP and design API callers. |
| Agent plan validation | `packages/server/src/agent.ts:66` | Before accepting a plan; scripts analyzed conservatively. |
| Agent step execution | `packages/server/src/agent.ts:148` | Also covers dry-run copies and direct execution helpers. |
| Agent HTTP API | `packages/server/src/agent.ts:371` | dry-run, step and runs/{id}/undo, including human-approved agent actions. |
| Explicit agent accounts through Data API / session APIs | `packages/server/src/dataapi.ts:128` | Standing API tokens and sessions; human Data API accounts remain unchanged. |
| AI app OAuth | `packages/server/src/oauth.ts:503` | Sign-in/eligibility and refresh; MCP rechecks on each tool invocation. |
| Web import matching | `packages/server/src/webclient.ts:1298` | Full policy refusal retained when falling back to matching by name. |
| Web AI replace | `packages/server/src/webclient.ts:1353` | Before field values are sent to the assistant. |
| Design API AI speed-up | `packages/server/src/design.ts:645` | Uses the shared assistant policy gate. |

## MCP tools

All file-naming tools below pass through the shared dispatcher before their callbacks. `get_security`, `change_security`, and `preview_privilege_set` remain available for authorized security inspection and ordinary grant changes; AI-visible exceptions are human-only. The change and preview tools refuse visibility edits, and AI design writes cannot create secret-derived calculations under the ON policy. Their existing access checks still apply. Metadata-only enumeration (`list_databases`, `solution_map`, completions and resource listings) does not execute record reads. `create_database` creates a new policy-ON file.

| Tool | Registration |
| --- | --- |
| `list_databases` | `packages/server/src/mcp.ts:667` |
| `describe_database` | `packages/server/src/mcp.ts:682` |
| `explain_access` | `packages/server/src/mcp.ts:694` |
| `who_can_access` | `packages/server/src/mcp.ts:716` |
| `preview_privilege_set` | `packages/server/src/mcp.ts:733` |
| `get_script` | `packages/server/src/mcp.ts:752` |
| `run_script` | `packages/server/src/mcp.ts:764` |
| `debug_script` | `packages/server/src/mcp.ts:826` |
| `explain_script_failure` | `packages/server/src/mcp.ts:885` |
| `find_records` | `packages/server/src/mcp.ts:913` |
| `get_record` | `packages/server/src/mcp.ts:937` |
| `describe_record` | `packages/server/src/mcp.ts:948` |
| `create_record` | `packages/server/src/mcp.ts:970` |
| `update_record` | `packages/server/src/mcp.ts:976` |
| `update_records` | `packages/server/src/mcp.ts:1001` |
| `upload_container` | `packages/server/src/mcp.ts:1018` |
| `evaluate_calculation` | `packages/server/src/mcp.ts:1038` |
| `delete_record` | `packages/server/src/mcp.ts:1068` |
| `revert_change` | `packages/server/src/mcp.ts:1077` |
| `get_container` | `packages/server/src/mcp.ts:1093` |
| `sql_query` | `packages/server/src/mcp.ts:1133` |
| `explain_solution` | `packages/server/src/mcp.ts:1154` |
| `solution_map` | `packages/server/src/mcp.ts:1172` |
| `document_solution` | `packages/server/src/mcp.ts:1195` |
| `where_used` | `packages/server/src/mcp.ts:1214` |
| `search_solution` | `packages/server/src/mcp.ts:1233` |
| `describe_layout` | `packages/server/src/mcp.ts:1244` |
| `check_calculation` | `packages/server/src/mcp.ts:1260` |
| `explain_value` | `packages/server/src/mcp.ts:1278` |
| `check_record` | `packages/server/src/mcp.ts:1303` |
| `explain_related` | `packages/server/src/mcp.ts:1325` |
| `lint_formulas` | `packages/server/src/mcp.ts:1354` |
| `check_script` | `packages/server/src/mcp.ts:1376` |
| `search_records` | `packages/server/src/mcp.ts:1393` |
| `semantic_find` | `packages/server/src/mcp.ts:1426` |
| `summarize_records` | `packages/server/src/mcp.ts:1460` |
| `list_dashboards` | `packages/server/src/mcp.ts:1500` |
| `get_dashboard` | `packages/server/src/mcp.ts:1508` |
| `save_dashboard` | `packages/server/src/mcp.ts:1520` |
| `find_data_problems` | `packages/server/src/mcp.ts:1549` |
| `fix_data_problems` | `packages/server/src/mcp.ts:1561` |
| `plan_import` | `packages/server/src/mcp.ts:1597` |
| `import_records` | `packages/server/src/mcp.ts:1625` |
| `undo_import` | `packages/server/src/mcp.ts:1639` |
| `undo_data_fix` | `packages/server/src/mcp.ts:1647` |
| `find_stale_calcs` | `packages/server/src/mcp.ts:1655` |
| `refresh_stale_calcs` | `packages/server/src/mcp.ts:1673` |
| `undo_stale_refresh` | `packages/server/src/mcp.ts:1688` |
| `list_automations` | `packages/server/src/mcp.ts:1719` |
| `try_automation` | `packages/server/src/mcp.ts:1729` |
| `save_automation` | `packages/server/src/mcp.ts:1754` |
| `delete_automation` | `packages/server/src/mcp.ts:1767` |
| `list_connections` | `packages/server/src/mcp.ts:1790` |
| `draft_connection` | `packages/server/src/mcp.ts:1808` |
| `conversion_report` | `packages/server/src/mcp.ts:1842` |
| `conversion_guide` | `packages/server/src/mcp.ts:1862` |
| `optimization_report` | `packages/server/src/mcp.ts:1882` |
| `optimization_fix` | `packages/server/src/mcp.ts:1902` |
| `optimization_move_containers` | `packages/server/src/mcp.ts:1930` |
| `migration_plan` | `packages/server/src/mcp.ts:1964` |
| `compare_solutions` | `packages/server/src/mcp.ts:1983` |
| `get_design` | `packages/server/src/mcp-design.ts:115` |
| `get_theme` | `packages/server/src/mcp-design.ts:146` |
| `get_layout_design` | `packages/server/src/mcp-design.ts:156` |
| `lint_script` | `packages/server/src/mcp-design.ts:172` |
| `lint_layout` | `packages/server/src/mcp-design.ts:187` |
| `fix_layout` | `packages/server/src/mcp-design.ts:202` |
| `speed_up_layout` | `packages/server/src/mcp-design.ts:224` |
| `review_graph` | `packages/server/src/mcp-design.ts:276` |
| `arrange_graph` | `packages/server/src/mcp-design.ts:288` |
| `restyle_layout` | `packages/server/src/mcp-design.ts:300` |
| `restyle_file` | `packages/server/src/mcp-design.ts:322` |
| `modernize_interfaces` | `packages/server/src/mcp-design.ts:353` |
| `draft_layout` | `packages/server/src/mcp-design.ts:375` |
| `change_design` | `packages/server/src/mcp-design.ts:424` |
| `check_formula` | `packages/server/src/mcp-design.ts:447` |
| `design_history` | `packages/server/src/mcp-design.ts:461` |
| `audit_log` | `packages/server/src/mcp-design.ts:467` |
| `explain_record_history` | `packages/server/src/mcp-design.ts:484` |
| `suggest_indexes` | `packages/server/src/mcp-design.ts:504` |
| `get_security` | `packages/server/src/mcp-design.ts:518` |
| `review_privileges` | `packages/server/src/mcp-design.ts:532` |
| `check_change_impact` | `packages/server/src/mcp-design.ts:553` |
| `suggest_rules` | `packages/server/src/mcp-design.ts:582` |
| `edit_layout_objects` | `packages/server/src/mcp-design.ts:594` |
| `try_design_change` | `packages/server/src/mcp-design.ts:655` |
| `paste_from_filemaker` | `packages/server/src/mcp-design.ts:685` |
| `copy_for_filemaker` | `packages/server/src/mcp-design.ts:707` |
| `list_images` | `packages/server/src/mcp-design.ts:732` |
| `add_image` | `packages/server/src/mcp-design.ts:738` |
| `change_security` | `packages/server/src/mcp-design.ts:748` |
| `sync_status` (implicit and named sources) | `packages/server/src/mcp-sync.ts:27` |
| `create_database` | `packages/server/src/mcp-design.ts:766` |

## MCP resources

| Resource | Registration |
| --- | --- |
| `schema` | `packages/server/src/mcp.ts:2140` |
| `overview` | `packages/server/src/mcp.ts:2152` |
| `conversion-guide` | `packages/server/src/mcp.ts:2165` |
| `script` | `packages/server/src/mcp.ts:2179` |
| `layout` | `packages/server/src/mcp.ts:2193` |
| `automations` | `packages/server/src/mcp.ts:2206` |
| `audit` | `packages/server/src/mcp.ts:2219` |

## Administration

| Surface | Source |
| --- | --- |
| CLI toggle | `packages/cli/src/main.ts:2015` |
| CLI info | `packages/cli/src/main.ts:2223` |
| Admin API toggle | `packages/server/src/admin.ts:928` |
| Admin console | `packages/server/admin/index.html:1791` |
| Security API | `packages/server/src/security.ts:42` |
| Privilege-set editor | `packages/web/src/security/privilege-sets.ts:230` |
| Privilege persistence and validation | `packages/store/src/privileges.ts:507` |

## Validation

- Required suite: **1,418 passed / 2 failed / 5 existing TODOs** (1,425 tests). Both failures were the existing 10-second shell subprocess timeout in `packages/cli/test/install-checksum.test.ts`: `sha256sum: match` and `shasum: binary-crlf`. The unchanged checksum file then passed alone: **23 passed / 0 failed**. These are reported separately, not counted as a clean full-suite run.
- Additional script AI, RAG, semantic-find, OAuth, modernize, shared AI-access and sync-console integration tests: **152 passed / 0 failed**. Older redaction fixtures explicitly omit policy metadata so they continue exercising legacy behavior.
- Final focused MCP policy, optional sync status and documentation-index checks: **36 passed / 0 failed**.
- `npm run typecheck`: passed.
- `npm run -s docs:reference -- --check`: passed; generated REST and MCP references are current.
- The five existing TODOs concern the CI Node-version declaration and four unverified SQL/date/time compatibility behaviors; protected CI files were not changed. <!-- known-difference: SQL and calculations ;; Four SQL, date and time compatibility behaviours are marked unverified in the test suite (as todo) and left as they are ;; Nothing shows; the tests carry a todo for each ;; A FileMaker run of the same probes (see consistency.md) -->

Required command:

```sh
node --test --test-concurrency=4 packages/server/test/mcp*.test.ts packages/server/test/assistant*.test.ts packages/server/test/agent*.test.ts packages/server/test/adminapi*.test.ts packages/store/test/*.test.ts packages/cli/test/*.test.ts
```

The full-suite log is `/tmp/x-aivisible-suite-verified.log`; isolated checksum results are `/tmp/x-aivisible-checksum-retry.log`; additional integration results are `/tmp/x-aivisible-integration-final.log`. Test batches ran sequentially, with no more than four test workers.

Refusal regressions were exercised red before the initial gates and subsequent fixes (including optional sync status and failure replay): shared MCP/assistant/agent/semantic access, direct model dispatch, quoted SQL functions, unsaved scripts, undecoded calculations, agent REST tokens, agent undo, nested serial calculations, and scripts entering through an OFF file that references an ON file. The test suite also exercises every registered file tool, explicit exceptions, ordinary privilege preservation, legacy absence, new native/compat defaults and toggle persistence.
