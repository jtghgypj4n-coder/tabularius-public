# Tabularius cross-file isolation — r22-02

## Baseline and scope

Searched `main` first with `git grep` for `audit-paths`, `audit-cache`,
`r17h-01`, privilege matrices, and cross-file isolation. The three requested
named reports are absent from the tracked tree; their findings are **unverified**.
There was no tracked `notes/` directory. Read the existing
[token file-scope audit](../../docs/token-file-scope-audit.md),
[external-source documentation](../../docs/design-mode.md#external-data-sources),
and the privilege-matrix and cross-file tests before adding coverage.

Dropped duplicate work on read-only/layout token ceilings, full-access script
elevation, portal field/row restrictions, external-account deactivation, and
Admin API privilege-set permutations. Those already have generated-input tests
on `main`. Kept their production implementation and added the missing
bidirectional file-boundary matrix. Corpus-dependent tests were not run.

The fixture generates logical A and B as `Aé` and `Bé`, with identical table,
record, container and script ids but different sentinel values. Each has an
exclusive account, plus `Shared` with different passwords: full access in A,
read-only records in B. A has a relationship, an external occurrence/layout,
and a declared source alias `Destination` pointing to B. B has no reverse
source. All listeners and the deterministic model fake use `127.0.0.1`.

## Invariants and matrix

A file-bound credential cannot enter another file's endpoint, even when both
files contain the same account name. A declared external-source operation uses
the destination's own privileges. An exclusive A account has no implicit B
access. A separately authenticated `fmDataSource` account may supply that
destination authority; its identity generation must remain valid. B cannot
traverse back into A without its own declaration.

Basic passwords are verified independently in each destination file. Server
administration and signed container URLs are separate documented authorities,
not privileges acquired from a file account. Credential-free local MCP
administration remains available; supplying an unsupported credential cannot
select that mode.

| Entry point / state | Assertion and evidence |
| --- | --- |
| Data API | Both session and API tokens refuse foreign reads, writes and scripts; source sessions remain usable after refusals. External reads and related fields resolve B; B denies writes. An A-only account cannot read B. |
| OData | Foreign record reads, writes and script requests are refused. Warming the source's Basic authentication does not validate its password in the destination. |
| SQL HTTP and PostgreSQL wire | Foreign credentials fail; simple and extended SQL can read the declared external occurrence, cannot invent a reverse occurrence, cannot use database qualifiers to bypass the graph, and cannot write. |
| MCP tools | Generated from the registered input schemas: 89 file-targeting tools × 10 filename variants × 2 directions = 1,780 refusals. Schema-validation failures fail the matrix rather than count as authorization evidence. Includes data, design, scripts, containers, audit and AI tools. |
| MCP resources | Every registered resource template is tested against every foreign filename variant in both directions. Listed resources remain in the authenticated file. Real HTTP tests verify both API-token and unsupported-session authentication behavior. |
| Web client routes | Foreign layout and record routes reject both credential types before exposing data. |
| Scripts / Perform Script | Declared alias and hosted-name calls work from A; B's record privileges remain effective. Reverse by-name calls fail before execution. Existing generated tests also cover listed scripts, server scripts, full-access callers and file triggers. |
| ExecuteSQL | Repeated local reads with equal schema ids retain each file's values. A's declared external occurrence reads B; B has no reverse occurrence. No destination account or revoked destination reads produces no visible rows, including after warming. |
| Backups and restore | File sessions and API tokens cannot list/create backups or inspect/execute restore through the console gate. Tests do not perform a restore or invoke backup utilities. |
| Containers / signed URLs | Equal numeric container ids return distinct bytes. A signature cannot transfer to the other file or its name variants. A file token alone cannot replace a signed URL. Authorized downloads warm the read path first. |
| Audit log | Foreign design-audit HTTP access and MCP audit tools/resources are refused. |
| Sessions | Wrong-file requests do not expire the source session. Logout cannot end a destination session through another database path. Correct-file logout remains idempotent. Live client listings are file-local; server session administration is refused. |
| Metrics | File credentials cannot read server metrics through the console route. |
| Live streams | Foreign subscriptions are refused. With a valid subscription, a foreign change followed by a visible local change proves that a forbidden foreign event was not emitted. A local event is the synchronization fence; no timing-based absence assertion is used. |
| AI assistant | A local model fake attempts a tool read of the other file's private layout. The internal tool remains pinned to the authenticated file and refuses the read. An authorized related value in A remains an allowed external-source read. |
| Schedules | File credentials cannot list/create server schedules. File automation/digest endpoints and MCP tools also reject foreign targets. |
| Plug-in state | Data API, OData and MCP keep global variables and compiled RegEx handles separate despite identical account/script ids. Disabling a built-in pack by a case variant affects only that file. |
| Caches | Warm Basic authentication, ExecuteSQL results, privileges, per-file script sessions, plug-in configuration and AI stand-in vaults are exercised. Equal stand-in ids resolve only the current file's values. Source inspection additionally confirms store-local privilege/relationship caches, per-store PII maps, container-thumbnail keys containing path/id/incarnation, and result databases beside each store. |

Filename inputs include original/lower/upper case, NFC/NFD Unicode forms,
trailing dots, `..`, a traversal-shaped name, and encoded/double-encoded forms.
HTTP inputs pass through actual URL parsing and decoding; MCP uses literal
tool arguments/resource URIs; SQL uses quoted qualifiers. Each must retain the
file boundary regardless of whether routing rejects or resolves the spelling.
These are Tabularius security assertions. Claris/vendor/standard equivalence
for normalization, error choices, plug-in state and same-name external-account
behavior is **unverified**; no compatibility behavior is inferred.

## Reproduced violations and fixes

Each bug has one regression test in
[`cross-file-regressions.test.ts`](../../packages/server/test/cross-file-regressions.test.ts).

1. **Undeclared by-name script traversal.** Before the fix, B's calculated
   `Aé::Read` returned A's sentinel despite having no external source. The script
   resolver now requires a declared source, accepting either its alias or its
   resolved hosted filename. B's own permissions still govern A → B calls.
2. **Destination-account replacement inherited a login.** An authenticated
   `fmDataSource` stored only the account name. Deleting it and creating a new,
   more privileged account with that name kept the old session authorized.
   Bindings now retain and recheck the destination account's identity generation,
   including across the password-verification await. Fresh credentials establish
   a fresh binding. The regression includes replacement during verification.
3. **MCP credential fallback acquired administrator authority.** On loopback,
   sending a Data API session bearer to MCP fell through to local administrator
   mode and returned the other file's record. Local administrator fallback now
   requires the absence of an authorization header. Valid file API tokens keep
   their normal file binding; unsupported bearers get 401.
4. **Logout ignored its database path.** A DELETE under A could end a known B
   session. The handler now compares the session's bound file before ending it.
   The regression checks both directions and correct-file logout controls.

Production changes are limited to `packages/scripts/src/engine.ts`,
`packages/server/src/dataapi.ts`, and `packages/server/src/index.ts`.

## Reproduction and limits

Run `node scripts/test-cross-file-isolation.ts`. The runner selects only the
eight generated-input test files, uses `--test-concurrency=2`, sets a 55-second
test timeout, and gives every child a stub-only PATH. `launchctl`, `systemctl`,
`sc`, `git`, `npm`, `curl`, and `sudo` stubs write a marker and exit 99; a marker
fails the run. No dependencies, corpus input, workflow edits, publishing,
commits, or pushes are needed.

Final verification: **66 tests passed, zero failures/skips**, across eight files
in **18.21 seconds total**, so every file completed below 60 seconds. The
55-second timeout has more than three times that entire-run duration as
headroom. `node node_modules/typescript/bin/tsc --noEmit --pretty false` passed,
as did `git diff --check`. No forbidden-command marker was produced. There are
four regression tests, one per reproduced bug; the other new tests form the
matrix and positive controls.

The matrix covers every entry-point category above, every registered
file-targeting MCP tool and every MCP resource template. HTTP rows exercise
the shared file gates through representative read/write/execute routes; they
are not a claim to enumerate every route/body combination. Native vendor
plug-ins, thumbnail subprocesses, actual backup restoration, filesystem
normalization on other operating systems and live vendor conformance remain
**unverified** by this generated matrix.
