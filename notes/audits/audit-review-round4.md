# r31-12: round-4 merge review

Reviewed 2026-10-18 at `87fb89978`. **One data-integrity bug fixed** in
#1341, with generated-data regressions. No security clearance is implied for the
excluded areas. The different-model review requested by the task remains pending.

## Selection and existing work

The round-3 report was absent from this checkout and was read from the existing
`x-r28-12-review-round3` sibling worktree. It is dated 2026-10-18 and records
`0fadeb584` as its reviewed head. The date-window inventory includes 15 mainline PRs;
two were already disposed of by round 3. This pass inventories the remaining 13,
including the squash commit for #1317. Using only `--merges` would miss that PR.
No r28–r30 implementation PR appears in this checkout's post-round-3 range.

Only the explicitly permitted read-only `git log` command was used:

```sh
git log --first-parent --since-as-filter='2026-10-18T00:00:00-04:00' --format='%h %cd %s' --date=iso-strict --name-only
git log --first-parent 0fadeb584..HEAD --format='%h %cd %s' --date=iso-strict
git log -1 -p --first-parent <merge> -- <reviewed-paths>
```

[Git log documentation](https://git-scm.com/docs/git-log) describes
`--first-parent` and `--since-as-filter`; the explicit timezone boundary avoids
assuming what a bare date means. The commit range deduplicates round 3's work.

Grep preceded changes. The earlier r15/r16 backlog files, r27–r30 task briefs and
claims, round-3 report, and merged summary, complexity, identity and import audit
notes were checked. Main already provides per-record fractions, ordered list
summaries, found-set calculation context, calculated break fields, Unicode group
normalization, release allow-list checks, and cleanup of earlier test servers.
Those implementations are retained. This extends their coverage and corrects
only the confirmed summary metadata collision; it does not copy unmerged sibling
implementations or repeat round 3's release collector review.

## Open-area exclusions

The claims below record ownership with no closure entry. Their status is treated
conservatively as open, rather than inferred from a branch's completion message.
Claims do not establish live PR-review status; see K4.

| Open item | Excluded area |
| --- | --- |
| r26-01 | Sign-in, lockout, sessions, tokens, cross-route authentication. |
| r26-02 | Redaction, AI-visible policy, MCP/agent output isolation. |
| r26-03 | Backup, restore, integrity, maintenance, migrations, filesystem crash/race behavior. |
| r26-04 | HTTP server handling/limits, proxy trust, outbound guards and pools. |
| r26-05 | Credential detection/masking, crypto and identity interop. |
| r26-06 | Parsers, import/export, document formats, PDF, XML and plug-in packages. |
| r26-10; r28-03 | Script resource budgets and bounded-store inventory. |
| r28-04; r28-05; r28-07 | User-content serving, plug-in boundary and settings/environment parsing. |
| r28-12 | Round-3 release collector and installation review; no duplicate filesystem/installer probes. |
| r28-18; r29-16; r30-13 | Repeating fields, aggregate/GetSummary function semantics, session globals. Scalar summary serialization and grouping changes in #1341 are reviewed below; these broader areas are not. |
| r29-05; r30-17 | Diagnostics exposure and server-to-server migration/sync. |

## PR inventory

| PR / commit | Disposition |
| --- | --- |
| #1311 / `aa2e48f2c`; #1319 / `0fadeb584` | Already inventoried by round 3; not counted again. |
| #1356 / `823d9110c` | Graceful drain, stream termination, signal handling, drain setting and diagnostic allow-list: excluded by r26-03/04, r28-07 and r29-05. No CLI/service execution. |
| #1317 / `6df359bd6` | Plug-in registry and stable-function additions: excluded by r28-05; no new plug-in boundary review. |
| #1358 / `c0f291f03` | Sync model/transport tests and runner: overlaps the open r30-17 sync work and r26-04 transport area; excluded. |
| #1359 / `3a9669c23` | Calculation functions, conformance data and notes only; outside the requested paths. |
| #1341 / `71eaefba4` | Store summary serialization, order, calculation context and calculated/Unicode break keys reviewed below. New GetSummary sort semantics, globals and repeating-field behavior excluded as above. |
| #1349 / `335fe9601` | Calculation/regex/XML budgets and Markdown scanner: excluded by r26-06/10 and r28-03/04. |
| #1370 / `03f791e77` | PDF/printing changes: excluded by r26-06. |
| #1384 / `db2340ae3` | Chart parser changes and design round-trip tests: excluded by r26-06. |
| #1367 / `db1c09b43` | Import validation and transaction changes: excluded by r26-06. |
| #1369 / `2ac0cdab3` | OIDC/SCIM changes, identity tests and load-test helper: excluded by r26-01/05. |
| #1377 / `e4e8bef50` | Test-workbench lifecycle: independently tested below. Production HTTP drain/security behavior remains excluded. |
| #1567 / `5ed7b2f4e` | Release font/measurement path allowances: independently tested with synthetic entries below. Content classifiers and filesystem collector remain excluded. |
| #1568 / `87fb89978` | Calculation inventory test data only; outside the requested paths. |

## Invariants and independent inputs

Numeric summary expectations are calculated from generated inputs using the
[Claris Options for Summary Field page](https://help.claris.com/en/pro-help/content/options-summary-field.html):
“Total of” and “Fraction of Total of”. It defines the fraction as the field value
divided by the total and requires recalculation after values or the found set
change. This supports the arithmetic, not every accepted identifier or ordering
choice. Project-specific expected values are explicitly **publicly unverified**
in K1–K3 rather than attributed to Claris.

| Change | Invariant / expected result | Independent input and result |
| --- | --- | --- |
| #1341: per-record fractions | Summary field names cannot overwrite internal denominators or have their own displayed values overwritten. Arithmetic follows the Claris page above; accepted-name handling is K2. | Prefix-shaped names on summaries of different source fields, nested prefixes, filtered/full finds, repeated cached reads, edits and projected pending rows. Two original failing-before cases; four final regression cases pass. |
| #1341: ordered list summaries | A summary list follows the full supplied found-set order even when the requested page is smaller. Exact order is local policy, K3. | Explicit noncontiguous ID order, one-row projection, ascending/descending sorts and an offset. Pass. |
| #1341: found-set calculation context | An unstored calculation over a total uses the same complete found set as the displayed summary, not just the page. Arithmetic follows the Claris summary page. | One-row pages from both explicit IDs and sorted finds, with an omitted record in the ID case. Pass. |
| #1341: calculated break fields | Groups use evaluated break-field values and change after editing their source. Exact grouping of generated inputs is local policy, K3. | An unstored identity calculation, two break levels, and an edit merging two adjacent groups. Pass. |
| #1341: normalized break keys | Canonically equivalent text retains the merged implementation's grouping behavior across nested breaks. Claris equivalence is unverified, K3. | A different composed/decomposed Unicode pair than the author's test, nested numeric breaks and an edit. Pass. |
| #1377: earlier servers retained for cleanup | Closing a workbench closes every listener and hosted store it started, including after an unsuccessful sign-in; cleanup can be repeated. [Node HTTP](https://nodejs.org/api/http.html#serverclosecallback) says close “Stops the server from accepting new connections”; workbench ownership and repeated cleanup are local policy, K1. | Three distinct loopback listeners; the middle sign-in fails. All three refuse new connections after cleanup, all three SQLite handles reject use, and the scratch directory is removed. Pass. |
| #1567: font path allowance | Allowing a generated direct font entry does not exempt its executable mode or link status; the pack still excludes deeper/lookalike directories. Local policy, K1. | Synthetic entries only: spaced filename, executable bit, link metadata and nested/lookalike paths in pack/tree scopes. Pass. The tree already permits `packages/**`; that existing broader rule is retained. |
| #1567: measurement allowance | Audit JSON is accepted in the source tree, excluded from program selection and rejected in the pack; nested audit JSON remains unlisted. Local policy, K1. | Generated direct/nested JSON entries with no filesystem collection or build. Pass. |

The author's summary model used conventional summary names and full-page checks;
the new inputs target the metadata namespace, pending projections and smaller
pages. The existing release tests gather real tracked files; these probes instead
exercise the newly added allowances with synthetic adversarial entries. The
workbench probe adds three generations and a failed sign-in to the cleanup change.

## Confirmed finding and fix

**R4-01 — medium, incorrect summary values for accepted field names.** #1341 put
fraction denominators into the same string-keyed map as displayed summary values,
using a predictable prefix. A user-defined summary name could match that internal
key and receive another field's denominator instead of its own aggregate. Both
`find` and `getMany` reproduced this before the fix. This establishes data-integrity
impact, not a cross-account disclosure; authorization review remains excluded.

`packages/store/src/store.ts:5560` and `:7167` now use numeric summary-field IDs for denominator
keys while preserving string field names for displayed values. Numeric and string
keys cannot collide. `packages/store/src/calc.ts:1416` widens the in-memory cache's key
type accordingly. Denominators remain values in the same map, so the existing
cache size accounting still includes them. No persistent format, cache limits,
authentication policy, parser grammar or data-at-rest names change.

## Validation

All new tests use generated data. No test invokes a subprocess, installer,
upgrade, service manager, git or external network command. The workbench test uses
in-process loopback HTTP. No corpus or fixture data was read. Protected directories
were not edited. No dependency was added, no check was disabled, and no commit or
push was performed.

| Validation | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| Initial `node --test --test-concurrency=2 packages/store/test/review-round4.test.ts`, before production fix | 0 | 2 | 0 |
| Expanded store review file after fix | 6 | 0 | 0 |
| CLI + server review files after correcting the probe's tree-policy assumption and allowing loopback binding | 3 | 0 | 0 |
| Final combined regression run (10 files, 12.25 seconds) | 53 | 0 | 0 |
| Root and web TypeScript projects | 2 checks | 0 | — |

Node version: 22.22.2. Nine new tests cover the independent inputs above; four
cover the confirmed bug. The new test files completed well below 60 seconds
(the store file's standalone run took 2.89 seconds; CLI and server together took
1.11 seconds). The server test's 30-second timeout has more than 3x headroom.

The first CLI/server probe run had one incorrect test expectation (the tree's
pre-existing `packages/**` allowance) and one sandbox `EPERM` on loopback bind.
The expectation was corrected to the actual pre-existing policy; the unchanged
server test passed with authorized loopback access. Neither was counted as a
production finding, and no tests were skipped to obtain a pass.

Final combined command:

```sh
node --test --test-concurrency=2 \
  packages/store/test/review-round4.test.ts \
  packages/cli/test/review-round4.test.ts \
  packages/server/test/review-round4.test.ts \
  packages/store/test/summary-model.test.ts \
  packages/store/test/found-set-summaries.test.ts \
  packages/store/test/summary-cache-guard.test.ts \
  packages/store/test/summary-date-extremes.test.ts \
  packages/store/test/summary-privileges.test.ts \
  packages/scripts/test/summary-model.test.ts \
  packages/server/test/summary-model.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --incremental false
node node_modules/typescript/bin/tsc -p packages/web/tsconfig.json --incremental false
```

The existing summary suites are regression coverage for the changed map
representation, not independent approval of the open security/function reviews.

## KNOWN

| ID | Unknown or limit | Status |
| --- | --- | --- |
| K1 | Public specification of the exact Tabularius release allow-list, finding names, test-helper ownership and cleanup behavior. | **Unverified publicly.** Expected values come from the merged code and existing tests. The Node HTTP page supports connection closure, not these project policies. |
| K2 | Claris treatment of the adversarial summary identifiers. | [About naming fields](https://help.claris.com/en/pro-help/content/naming-fields.html) says “Do not use” and lists “: (colon)”. Tabularius currently accepts these names; this fix preserves correct results for its accepted inputs. FileMaker acceptance/behavior is **unverified**, not claimed compatible. |
| K3 | List order under sorting, exact Unicode break equivalence, and all calculated-break edge cases. | **Unverified Claris parity.** The [summary options page](https://help.claris.com/en/pro-help/content/options-summary-field.html) supports found-set arithmetic but does not settle these exact expectations. Existing project behavior is tested and retained. |
| K4 | Closure of open reviews and PRs merged after the supplied head. | **Unverified.** Local claims contain no closure entry. Exclusions are conservative; inventory is bounded to the supplied checkout and does not establish current remote status. |
| K5 | Full repository/build/release audit, platform lifecycle, live FileMaker parity and browser E2E. | **Not run.** Existing release integration tests execute git/read the tracked tree; build/lifecycle paths invoke prohibited commands. Targeted generated-data tests were used without modifying or disabling the original suites. |
| K6 | Different-model review of this fix. | **Pending the requested follow-up.** No independent-model approval is claimed. |

Firecrawl's account/network check failed; the browser tool verified the cited
public pages instead. This report contains aggregate outcomes, no source records,
private machine paths or tool-cache locations.
