# r24-11: privilege inheritance

Reviewed 2026-10-17. Synthetic generated stores only; no corpus or fixture files were opened. This report contains aggregate coverage and outcomes, not record contents. No dependencies were added, and no git, service, installation, upgrade or external-network commands were run by tests.

## Existing main work retained

Read [r17h-01's matrix report](../../docs/audit-privilege-matrix.md), its independent [policy rows](../../packages/server/test/privilege-matrix.ts), and the existing script, cross-file and calculation privilege tests first. Main already implements script-local/file-local full access, authenticated script-entry checks, PSOS identity propagation, record/field masking, token ceilings, and the cross-entry-point matrix. Those mechanisms were retained. The new work adds a composition oracle, synthetic automation adapters and targeted fixes.

Names follow the Tabularius rename merged from main (#1297). Data-at-rest names, including `.openhbam.sqlite`, are unchanged.

## Rules and evidence boundaries

| Context | Rule | Evidence |
| --- | --- | --- |
| Script full-access setting | A grant can exceed the account's direct privileges, applies only in the script's file, and does not carry into subscripts without their own grant. | Documented: [Creating and editing scripts](https://help.claris.com/en/pro-help/content/creating-editing-scripts.html), “Running scripts with full access privileges”. |
| PSOS | A separate server session uses the client's account; the client window, found set and variables are not inherited. | Documented: [Running scripts on server](https://help.claris.com/en/pro-help/content/running-scripts-on-server.html). |
| Schedule | Uses the account specified in the schedule. | Documented: [Running scripts on server](https://help.claris.com/en/pro-help/content/running-scripts-on-server.html). |
| Script trigger | Tabularius runs a triggered script with the user's privileges unless that script has the full-access setting; a trigger fired from inside a full-access script does not inherit the elevation (the safer reading). | Unverified: the [Setting up script triggers](https://help.claris.com/en/pro-help/content/script-triggers.html) notes say triggered scripts "use existing privileges", which could also mean the elevated privileges of a full-access script that fired the trigger. Not checked against FileMaker. |
| Account identity | Reports the authenticated person, including external group authentication, rather than replacing that person with the group name. | Documented: [Get(AccountName)](https://help.claris.com/en/pro-help/content/get-accountname.html). |
| Account versus effective set | AccountPrivilegeSetName identifies the account's set; CurrentPrivilegeSetName reports the evaluation set and reflects script elevation. | Documented: [Get(AccountPrivilegeSetName)](https://help.claris.com/en/pro-help/content/get-accountprivilegesetname.html), [Get(CurrentPrivilegeSetName)](https://help.claris.com/en/pro-help/content/get-currentprivilegesetname.html). |
| Related records and displayed calculations | Related fields need view access; displayed calculations and summaries over multiple records exclude inaccessible records. | Documented: [Editing record access privileges](https://help.claris.com/en/pro-help/content/record-access-privileges.html). |
| Record automations and inbound hooks | Conditions/parameters use the configured account before script entry; scripts then use their own grant. | Application security policy. Exact Claris equivalents are **unverified**. |
| MCP and AI steps | Authenticated identity and token restrictions apply; a read-only token cannot execute scripts. An elevated script cannot elevate a later independent agent step. | Application policy; Claris parity is **unverified**. |
| Outbound callbacks | Argument calculations use the current script context; returning from a capture callback grants no authority. | Application policy tested with capture-only mail. Remote recipient identity and third-party authorization are **unverified**. |

The request's absolute direct-access invariant cannot coexist with documented full-access grants. The tested invariant is **no implicit elevation beyond the active script's explicit grant and applicable token ceiling**, with restoration on return. Explicitly returning or sending data from a granted script is intentional delegation, not evidence that a subsequent frame gained permission.

`Get(PrivilegeSetName)` is not a supported name in the current calculation checker. Tests pin that rejection and exercise both supported getters. Historical alias behavior is **unverified**; no alias was invented.

## Model and generated coverage

[privilege-inheritance-model.ts](../../packages/scripts/test/privilege-inheritance-model.ts) defines account, account privilege set, effective set, effective full-access flag, the script's own setting, nesting and transition mechanism independently of production `Privileges` methods. Each frame computes elevation from the account and its own grant, never the parent's grant. Expected access and denial codes are explicit policy values rather than learned results.

Two fixed seeds (`0x2411`, `0x1701`) generate 24 graphs with 2–4 frames. A coverage assertion requires every local/server/trigger edge to exercise all four caller/callee grant combinations. Three account shapes and four operations produce 288 generated script cases. Each graph checks entry/return identity, protected reads through direct references, Evaluate, ExecuteSQL and a custom function, write/delete persistence, and forbidden-script execution. Checks include Get(LastError), returned diagnostic envelopes and a two-input noninterference regression for protected SQL predicates and denied writes.

| Surface | New evidence |
| --- | --- |
| Local scripts, PSOS, layout triggers | Generated nested graphs, mixed grants, before/after frame identity, read/write/delete/run checks, denied entry with a full-access target |
| Schedules, signed inbound hooks | Generated graphs through the real entry implementations; configured account changes and schedule edits; synthetic signed request streams |
| Record-change automations | Generated graphs and captured outbound observations; live condition/parameter privilege regressions, including full-access target scripts; dry-run condition/parameter regressions |
| MCP run_script | In-memory SDK transport; exact generated identity results; named script denial and read-only token execution ceiling |
| AI steps | Script steps followed by independent set/delete steps, mixed grants and accounts, forged found-set IDs |
| Outbound hooks | Capture-only mail arguments and caller-context restoration; a fetch stub fails if reached |
| Custom functions and calculation fields | Viewer versus writer, local saved account assignment, reassignment, mapped login, script-local elevation |
| Relationships and portal filters | Account-dependent record rules and identity predicates in portal filters |
| Conditional formats | The shared evaluateEach path used by conditional formats, labels and tooltips; no browser rendering claim |
| Stored calculations, auto-enter and validation | Writer-time behavior, reader-time behavior, validation identity, rejection atomicity and explicit retained disclosure exceptions |

The bounded generator is not an exhaustive proof. It does not cover every trigger event, no-wait PSOS/callback scheduling, Re-Login, or every cross-file account mapping. Existing synthetic cross-file tests were also run. No native FileMaker instance was available.

## Fixes

1. **Automation condition/parameter privilege omission.** Live execution and dry-run supplied only an account name to calculation evaluation. A restricted automation could test a hidden field in its condition or pass it as a script parameter. Both now pass the configured account's privileges. Target-script elevation starts only after these formulas. Four separate regressions were observed failing before this fix and passing afterwards. Authorized accounts and explicitly elevated script bodies retain their access.
2. **Calculation privilege-set identity.** Shared calculations resolved AccountPrivilegeSetName only from imported schema accounts and omitted CurrentPrivilegeSetName entirely. Saved account assignments, reassignment and mapped identities could therefore report an empty account set; evaluation-context identity could also be empty. The getter now resolves the saved/mapped account set and separately reports the effective evaluation set. Regressions cover record reads, script reads, calculations, portal predicates and mapped login. Failures were reproduced before correction.

## Retained exceptions: absolute non-disclosure is not achieved

The prior [calculation privilege review](../../docs/calculation-privileges.md) explicitly retains full-data internal write calculations. This change does not redefine that policy:

- Readable stored-calculation and auto-enter outputs can disclose a source field the later reader cannot read. Protecting the source alone does not protect a separately readable persisted result.
- A validation calculation can distinguish a hidden-value match through success versus error 507. The earlier value-list membership success/506 oracle also remains covered by its existing regression.
- Exact FileMaker parity for these hidden-source and validation cases is **unverified**. The linked general record-access documentation does not settle them. Internal write-time getter details are recorded as application behavior, not a documented Claris exception.

These are observed counterexamples to a universal “no indirect read” claim. Changing persisted-data visibility or file-integrity validation would require a separate compatibility decision; this PR fixes implicit automation escalation and incorrect identity reporting without claiming those retained behaviors are safe.

## Validation

All test commands below use [the guarded runner](../../scripts/test-privilege-inheritance.ts), which executes Node with `--test-concurrency=2`. Its child PATH contains only Node and marker-writing exit-99 stubs for launchctl, systemctl, sc, git, npm, curl and sudo. A marker makes the run fail. None was created. New tests do not spawn subprocesses or contact external services; signed inbound requests and MCP use in-memory transports. Existing HTTP regressions use loopback only.

```sh
node scripts/test-privilege-inheritance.ts

node scripts/test-privilege-inheritance.ts \
  packages/scripts/test/calc-read-privileges.test.ts \
  packages/scripts/test/cross-file-privileges.test.ts \
  packages/scripts/test/step-triggers.test.ts \
  packages/store/test/calc-privileges-noaccess.test.ts \
  packages/store/test/related-privileges.test.ts

node scripts/test-privilege-inheritance.ts \
  packages/server/test/privilege-matrix-scripts.test.ts \
  packages/server/test/privilege-matrix-mcp.test.ts

node scripts/test-privilege-inheritance.ts packages/server/test/automation-deletes.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json
```

| Final validation | Passed | Failed | Skipped | Wall time |
| --- | ---: | ---: | ---: | ---: |
| New model and regression suites | 340 | 0 | 0 | 6.09 s |
| Nearby synthetic regressions | 119 | 0 | 0 | 5.11 s |
| Existing script/MCP matrices | 1,091 | 0 | 0 | 24.76 s |
| Existing automation-delete regressions | 4 | 0 | 0 | 1.82 s |
| Root TypeScript check | 1 | 0 | 0 | — |

Total final tests: 1,554 passing, zero failures or skips. Each new file completed within the combined 6.09-second run; there are no timing assertions. An initial combined existing-regression run had 119 passes and 68 setup failures because the sandbox refused loopback binding with EPERM. The two matrices subsequently passed with loopback permission; no product assertion failed in that attempt. Fixture-dependent suites were not run, and nothing was downloaded. Different-model review remains outstanding.

## Second-model review

An independent review found no new escalation. It confirmed the four automation regressions, the five store tests and two script tests fail on main and pass here, and it found no formula evaluated with only an account name across a trust boundary; elevation is derived per frame, so nothing needs restoring after an error or abort. Fixed here with tests:

- The server surfaces (automations, schedules and hooks, MCP) walked subsets of the generated graphs that missed some caller/callee grant pairs. All surfaces now walk one subset chosen to cover every pair on every edge kind, and a test asserts that coverage.
- The portal-filter test compared the two name getters with each other, so equal-but-wrong values would pass; each getter is now also pinned to its literal for every identity.
- A script run with no explicit privileges reported an empty account set for an account whose set was assigned after import (the engine used the schema-only lookup); it now uses the account's saved set.
- The MCP formula-evaluation tool now passes the caller's privileges, so a mapped login reports its sets there too.

Corrections to claims above, and points left as they are:

- `CurrentPrivilegeSetName` reports the evaluation set only when an evaluation privilege context is supplied. Without one it falls back to the account's own set, which can never be higher; a formula that runs with full data access but no context therefore reports the lower set.
- Under a token ceiling, a script's `AccountPrivilegeSetName` returns the narrowed name (for example `Editing (token)`) while an unstored calculation field returns `Editing`. The two should be reconciled.
- The administrator "view as" preview reports an empty account set. The design-mode formula check (`design.ts`) still passes only an account name, so a mapped designer sees an empty identity there.
- Not every generated test varies grants within a chain: the AI-steps test gives both frames the same grant, the dry-run "visible" assertion holds trivially because dry runs use a copy (the empty change list is the real check), schedule time edits are not observable through a manual run, and automation chains check only the last frame's identity. The 24-graph assertion alone holds for most random seed pairs, so it is weak evidence by itself.
- A free-form MCP formula that reaches a related table in another hosted file is evaluated without privileges; MCP's read-everything check covers only the current file. Not verified further.
