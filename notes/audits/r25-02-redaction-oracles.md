# r25-02: indirect secret channels

Scope: generated synthetic stores, AI/tool outputs, personal-data isolation enabled. No corpus or fixture data was opened. This report contains aggregate test counts, not record contents. No dependency, deployment or data-at-rest naming changes.

## Existing protection retained

Main already had a conservative pre-execution AI policy, custom-function and SQL dependency analysis, relationship/lookup propagation, atomic design-change guards, secret-value output redaction, a personal-data isolation tool allowlist, account-scoped stand-in vaults, and resource gates. Those remain the primary protections. The new tests cover both policy-ON refusal and isolation-only behavior on legacy/policy-OFF stores.

The two settings are independent. With the AI-visible policy ON, an unexempted secret anywhere in the reachable schema refuses data operations, including for Full Access. Personal-data isolation alone masks permitted record fields and blocks operations whose results cannot be checked. It permits the explicitly documented signals below; it is not noninterference without declassification or persisted value provenance.

## Fixes

| Gap | Change | Regression |
| --- | --- | --- |
| A summary could outlive protection of its source when only the source was exempted; AI could create a secret summary under a table exception. | Summary dependency edges follow the source field, including transitive chains and unknown sources. New/changed secret summaries use the existing atomic design guard. | Summary read refusal; whole-batch design refusal. |
| Numeric calculations, custom/dynamic reads, code-shaped results and numeric lookups could bypass personal classification. | All calculation, auto-enter calculation, lookup and summary fields are personal by default, before number/key/value-list exemptions. Human field marks still override classification. Removed the incomplete ten-pass textual dependency heuristic. | Derived-type and predicate probes; schema/mark cache invalidation. |
| Numeric credentials could be probed with finds/ranges or sent as short numeric import samples. | Secret-name detection also classifies personal fields and import sample headers. | Credential criteria refusals; credential sample masking. |
| Import headers could contain a mistaken first data row or an unseen personal value. | Only exact case-insensitive matches to supplied target field names retain the canonical schema name. Other headers become column positions. | Captured model-bound import request with arbitrary headers and a credential sample. |

The more conservative classification can hide safe calculated totals and codes. An administrator must review and explicitly mark them Not personal to expose them. Import matching can lose useful header hints; existing target field names and masked samples remain available.

## Channel evidence

The generated paired-store test changes protected text and numeric values while keeping the schema, caller and probe arguments fixed. It compares complete returned payloads, requires the actual policy refusal rather than a validation/unknown-tool error, and checks absence of protected bytes. A generated relationship and portal have secret-dependent membership, and a generated text container contains protected data.

| Channel | Boundary and evidence |
| --- | --- |
| Calculated fields and custom functions | Policy dependency gate; isolation-only derived-field classification and record masking. |
| ExecuteSQL, Evaluate, Lookup, GetField, GetNthRecord, JSON construction | Formula/SQL gate and isolation tool refusal; derived numeric field classification tested independently. |
| Relationships and portals | Whole reachable schema policy; paired relationship membership, portal record read and explanation probes. |
| Finds, sorts, ranges, summaries, aggregates, counts, Get(FoundCount) | Paired policy refusals; isolation-only numeric/derived criteria probes. Allowed isolation signals are listed below. |
| Import mapping names | Model dispatch captured in memory; arbitrary headers withheld and credential samples masked. MCP import planning refused. |
| Errors and Get(LastError), script traces/debugger | Paired formula, script and debugger refusals before execution. Existing isolation write-error normalization retained. |
| Audit and activity entries | Audit/history/automation tools refused; audit and automation resources refused. The MCP catalog has no raw activity-log tool. |
| Backups listed by AI | The MCP catalog has no backup-list/content tool. Hosted database names remain metadata; listing is compared across worlds. Backup/service commands were not invoked. |
| Layouts, container text, value lists | Layout/schema/resource and container-tool refusals; field-sourced value list formula refused. |
| Renamed/aliased fields | Rename refused before mutation; existing alias/custom-function policy tests retained. Human renames remain a limitation below. |
| MCP resources and prompts | Paired resource reads refuse; listings agree. Prompt generation returns caller-supplied instructions, not record reads. |
| Cached output across accounts | Warm stand-in caches cannot resolve another account's token or reuse it in criteria. Existing vault deletion/cache regressions retained. This is application cache evidence, not a claim about a model provider's retention. |

## Documented residual signals and limits

| Signal or limit | Policy meaning |
| --- | --- |
| Schema/file/layout/field/script/value-list/account names, refusal field/privilege names, static design text | Existing public schema metadata. Personal data placed in design labels or names can still be exposed; pattern masking is not a complete design-content classifier. |
| Stand-in equality, kind, repetition, empty/nonempty, stable record identifiers and row counts | Deliberate isolation behavior. Stand-ins support whole-value equality finds; emptiness and any-value finds remain available. The vault's numeric token identifiers are not a hidden-value noninterference guarantee. |
| Ordering and relationship/portal membership | Isolation permits sorts and normal record relationships. These can disclose ordering/membership when the separate AI policy permits the source. Use the AI policy without secret exceptions to refuse such channels. |
| Explicit AI-visible exceptions and Not personal marks | Human declassification. Source-only AI-visible exceptions do not automatically exempt secret-derived fields, including summaries. A whole-table exception explicitly includes its fields. |
| Short numeric/yes-no spreadsheet samples and known target field headers | Existing import sample declassification, except headers identified as personal or secret. A target-field header is canonical schema; arbitrary headers are now withheld. |
| Human renames and old copies into ordinary fields | No persisted taint/provenance is introduced. A human rename or a previously materialized ordinary-field copy can lose source information. AI renames and new secret-derived summary construction are guarded under the ON policy. |
| Sample-based classification of ordinary text | Existing bounded sample and ten-minute refresh remain. Derived-field classification no longer depends on that sample or a regex dependency depth. |
| User-supplied prompt text and provider-side retention | Outside this record-output invariant. Prompts can repeat what their caller supplied; application account-cache isolation does not establish provider cache erasure. |
| Timing, resource use and concurrent policy edits during in-flight operations | No constant-time or transactional policy-snapshot guarantee was added or tested. Paired tests compare payloads, not timing. |

These are Tabularius policy statements. Claris equivalence for these security behaviors is **unverified**; this audit makes no claim that Claris documents or implements the same invariant.

## Validation

All new tests generate their stores locally, use in-memory MCP transports and stub the model dispatch. They spawn no child processes or network requests. Test runs use `--test-concurrency=2` and a stub-only PATH: launchctl, systemctl, sc, git, npm, curl and sudo write a failure marker and exit 99. The marker is checked after runs.

Commands below use `NODE` for the absolute Node executable and `STUB_PATH` for the temporary stub-only directory. No machine-specific paths are part of the deliverable.

```sh
PATH="$STUB_PATH" "$NODE" --test --test-concurrency=2 \
  packages/server/test/redaction-oracles.test.ts \
  packages/server/test/mcp-ai-policy.test.ts \
  packages/server/test/mcp-ai-policy-custom-functions.test.ts \
  packages/server/test/mcp-ai-policy-relationships.test.ts \
  packages/server/test/mcp-ai-policy-probes.test.ts \
  packages/server/test/mcp-ai-policy-sync.test.ts \
  packages/server/test/assistant-ai-policy-analysis.test.ts \
  packages/server/test/assistant-ai-policy.test.ts \
  packages/server/test/pii-vault-cache.test.ts \
  packages/server/test/pii-vault-delete.test.ts
test ! -e "$STUB_PATH/marker"

PATH="$STUB_PATH" "$NODE" --test --test-concurrency=2 packages/server/test/redaction-oracles.test.ts
test ! -e "$STUB_PATH/marker"

PATH="$STUB_PATH" "$NODE" node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
```

- Broader generated-data suite: **322 passed, 0 failed, 0 skipped** across ten files.
- Final regression-file rerun: **8 passed, 0 failed, 0 skipped**, approximately **17.4 seconds** including startup. The paired case covers **31 tool probes and 6 resource reads**, plus listings and prompt output.
- TypeScript: **passed, 0 diagnostics**. An initial check identified a now-unreachable classifier branch; it was removed before the successful check.
- Baseline, before fixes: **1 passed, 4 failed** in the initial five-test regression set. The failures demonstrated summary read/design gaps, derived classification and import headers.
- Forbidden-command markers: **0**. No new test spawns child processes or accesses the network.
- Independent different-model security review and final delta review: **0 security findings** from an earlier read-only review of the original change, inspection only. The final review included the unreachable-condition cleanup and portal/container regression setup. It identified one stale dependency-analysis statement in the policy documentation; that statement was corrected to match existing literal-reference and custom-function support.

Not performed: full-repository/fixture/corpus tests, live provider calls, backup or service commands, Claris equivalence testing, timing-channel proof or persisted-provenance migration. No git command, commit or push was performed. Historical ordinary-field copies, schema-embedded data and the permitted residual signals above prevent claiming complete information-flow protection.

## Second-model review

A different model reviewed this change. It found no remaining leak path through summaries (including a summary of a summary), the field shapes checked, import headers, or mark ordering and cache invalidation, and it confirmed that human marks always win. Fixed after the review, with tests:

- The usual `Get ( UUID )` primary key became personal, so a find on a child's key field returned zero records with no error. That one formula is now exempt; the other calculation rules are unchanged.
- The paired-worlds test above runs with the AI-visible policy on, so every probe stopped at the same first policy refusal and the per-channel logic was never reached. A second paired test runs with isolation only and the policy off, over derived-value finds, ranges, a summary and calculation probes.

Documented rather than changed: marking a secret-named field Not personal lifts its protection (a human declassification the console does not warn about); a mark follows a field's name, so a re-created field with the same name inherits it; and `docs/personal-data-isolation.md` now says the calculation rule outranks the key and value-list exemptions.
