# r28-12: round-3 merge review

Reviewed 2026-10-18 at checkout `0fadeb5848a792267f132f8f9d5bd9a834e23ea4`.
Result: **one bug fixed**, with four failing-before/passing-after regression cases.
Main already contains the release allow-list, dependency pruning, content checks,
and lifecycle-script suppression from #1311. Those mechanisms are retained.

## Selection and prior work

Read-only history commands only; no commit, push, fetch, or checkout operation.
The supplied `git log --since=2026-10-18 --merges` returned no entries. To avoid
an ambiguous date-only cutoff, the audit used midnight in the supplied
America/Toronto timezone:

```sh
git log --since='2026-10-18T00:00:00-04:00' --first-parent --merges --format='%H %cd %s' --date=iso-strict
git log --since-as-filter='2026-10-18T00:00:00-04:00' --first-parent --merges --format='%h %cd %s' --date=iso-strict
```

Both explicit-cutoff queries returned the same two mainline PR merges. First-parent
selection avoids counting merges of main into a feature branch as new PRs.
[Git log](https://git-scm.com/docs/git-log) documents `--since`,
`--since-as-filter`, and `--first-parent`; the expected boundary is the explicit
timestamp above, not a claim about date-only parsing.

| Merge | Local merge time | Disposition |
| --- | --- | --- |
| #1311, `aa2e48f2c68ba556474466ae85ff8e48df0e655f` | 02:09:38 -04:00 | Release contents and CLI dependency installation: reviewed below. |
| #1319, `0fadeb5848a792267f132f8f9d5bd9a834e23ea4` | 03:31:14 -04:00 | Date-function test data, tests, and documentation only; outside the requested server/store/auth/redaction/outbound/parser/CLI paths. |

Compared each merge with its first parent. No eligible merge changed server,
store, auth, redaction, or outbound runtime code. The release audit and build
helpers are included because they belong to the same eligible CLI PR.

Checked the earlier r15/r16 queue backlogs, the r25-10 task and claim, the r26-01
through r26-06 task/claim files, the r28-12 claim, and existing audit reports.
This extends #1311's existing release audit rather than introducing another
release pipeline. The six round-2 claims remain active with no closure recorded
in those claim files; conservatively exclude all six areas as requested:

| Open review | Area excluded from this pass |
| --- | --- |
| r26-01 | Sign-in, lockout, sessions, tokens, cross-route authentication. |
| r26-02 | Redaction, AI-visible policy, MCP and agent output isolation. |
| r26-03 | Backup, restore, integrity, maintenance, migrations and related filesystem races. |
| r26-04 | HTTP framing/limits, proxy trust, outbound guards and pools. |
| r26-05 | Credential detection/masking, secrets, crypto, OAuth and identity interop; includes #1311's credential-scanning rules. |
| r26-06 | Parsers, import/export and document formats; includes probing #1311's file-signature classifiers. |

## Invariants and independent inputs

Tests live in `packages/cli/test/review-round3.test.ts`. The source audit's
existing tests construct symlink entries directly; they do not exercise a real
filesystem symlink underneath a regular-file index entry. The original installer
test checks source lines; this pass evaluates the actual helper body with doubles.

| Change in #1311 | Invariant and expected result | New inputs and result |
| --- | --- | --- |
| CLI dependency installation adds `--ignore-scripts`; installer/rehearsal call sites add the same flag. | Every platform and npm-location branch of the CLI helper passes `--ignore-scripts`; a nonzero or absent status throws. [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/#ignore-scripts) says this option means npm “does not run scripts”. The throw behavior is local policy, K1. | 18 combinations: three simulated platforms, adjacent/PATH npm, status zero/nonzero/null; a space in the executable directory and a conflicting environment setting. All pass using an in-process spawn double. No install, upgrade or service command runs. Shell/PowerShell entry points were read, not executed (K3). |
| New release audit gathers indexed working-tree files and the public snapshot calls that audit. | A pre-existing filesystem symlink in any component below the supplied root yields a `symlink` finding and zero target-content bytes, even when the index says regular file. [Node filesystem documentation](https://nodejs.org/docs/latest-v22.x/api/fs.html#fslstatpath-options) specifies that “the link itself is stat-ed”; [Git ls-files](https://git-scm.com/docs/git-ls-files) distinguishes index metadata from working-tree information. Refusing links is the existing local release policy (K1). | Relative, absolute and dangling leaf links, plus a directory link above a tracked descendant: **four failures before the fix, four passes after**. Unicode/tab filename and committed dangling-link controls also pass. |
| Build delegates file selection and dependency pruning to new shared helpers. | Excluded tooling directory components stay excluded at greater depth; lookalike runtime names and dependency licences remain selected. These exact inclusion booleans are local policy, **publicly unverified** (K1), not npm or Claris requirements. | Nested tooling directories, similarly named runtime adapters, nested scoped dependencies, source maps and licence preservation: all assertions pass. Existing helpers retained. |

## Fix and evidence

`scripts/release-audit.ts:330` previously used the index mode alone to recognize
links. With an index mode of regular file, it read through a filesystem symlink,
including one in a parent directory. A dangling leaf instead caused a read error.
The collector now uses `lstatSync` on each component before descending and returns
a link entry immediately. The existing audit then emits its existing symlink
finding; no new rule, format, dependency or naming change is introduced.

All test data is generated. The git listing is an in-process builtin mock with
an exact argument check, not a git subprocess. The installation helper is
extracted from the current TypeScript AST and evaluated with in-process doubles.
The test PATH contains only stubs for launchctl, systemctl, sc, git, npm, curl and
sudo; each writes a marker and exits 99, and the test teardown asserts the marker
does not exist. No child command was invoked. No corpus or fixture files were read.

| Validation | Pass | Fail | Skip | Evidence |
| --- | ---: | ---: | ---: | --- |
| `node --test --test-concurrency=2 packages/cli/test/review-round3.test.ts`, before production fix | 4 | 4 | 0 | All four failures are the symlink reproductions. |
| Same command, after production fix | 8 | 0 | 0 | Under one second for the file; 18 installation combinations inside one test. |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --incremental false` | 1 check | 0 | 0 | Exit zero, no diagnostics. |

## KNOWN

| ID | Unknown or limit | Status |
| --- | --- | --- |
| K1 | Public specification of Tabularius release file selection, rule names and CLI failure behavior. | **Unverified publicly.** Expected values come from the merged source, existing tests and r25-10 requirements. The PR public-page fetch failed; no public page is claimed to specify those project choices. No Claris behavior is asserted. |
| K2 | Filesystem replacement concurrent with the audit. | **Unverified.** Component inspection is not an atomic filesystem snapshot. The regression proves pre-existing leaf/ancestor substitution only; it does not establish race resistance or validate an untrusted root. |
| K3 | Actual npm lifecycle suppression and Windows/Linux filesystem behavior. | **Not executed.** Public npm semantics cited above; platform tests use doubles. The filesystem regressions ran on macOS with Node 22.22.2. |
| K4 | Full release pack, public snapshot and original tree-wide tests. | **Not run under this task's constraints.** Existing integration tests invoke git and read tracked files, and build/snapshot paths invoke installation/network commands. No tests were disabled or modified to skip. |
| K5 | Open round-2 areas and later merges. | **Excluded.** Six active claims listed above; inventory is bounded to the supplied checkout. |
| K6 | Different-model review. | **Pending the follow-up review requested by the task.** This report does not claim independent model approval. |

Public documentation was checked with the browser tool after Firecrawl's network
status check failed. Reports contain aggregate test counts only, without source
data, machine paths, or tool-cache locations. Protected directories were untouched.
