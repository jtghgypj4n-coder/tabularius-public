# r24-08 algorithmic complexity audit

The requested global invariant is **not established**. This PR fixes bounded text expansion, aggregate calculation work, two XML parser problems, and quadratic Markdown link scanning. The final synthetic sweep has **90 observations: 75 completed, 13 refused by implementation limits, and 2 stopped by the audit watchdog**. The two watchdog cases are portal filtering and sorting on a calculated field at 100,000 rows. These remain production gaps, not passing tests.

No corpus or fixture data was opened. Measurements and regressions use generated data. Reports contain aggregate measurements only. The measurement work ran no dependency installation, service command, upgrade or external network command.

## Existing safeguards retained

Grep found substantial prior work in the supplied main-derived checkout. It was retained:

- `packages/store/src/find.ts`: iterative NFA matching for find wildcards, 4,096-character criteria, 256 request/field parts, 4,000,000 units shared across a find, and a 128-pattern cache. This is O(text × pattern) with a work cap, not exponential backtracking. The `?` invalid-value operator is separate from wildcards.
- `packages/calc/src/regex-guard.ts`: interruptible VM regex calls at 500 ms and a 250-level pattern nesting guard. MBS/BE pattern length caps already existed. The old aggregate regex allowance was 2,000 ms; it is now 500 ms of time spent inside guarded regex calls, shared across an enclosing formula.
- `packages/calc/src/jsonpath.ts`, `jmespath.ts`: expression/depth/visit/output limits and cooperative deadlines; their existing 3,000 ms deadlines were not changed.
- `packages/server/src/request-json.ts`: pre-parse depth 64, query JSON 8 KiB, numeric token length 1,024, plus endpoint body limits. This is distinct from the calculation JSON parser benchmarked below.
- `packages/store/src/calendar.ts`: 8 MiB ICS input, 5,000 events, 366 occurrences per event, 400,000 recurrence iterations. Existing truncation notices were retained.
- `packages/server/src/odata-crossjoin.ts`: separate process isolation; at most 3 sets, 100,000 source records, 500,000 pairs, 64,000,000 input bytes, 512 MiB heap, 2 concurrent jobs, 10,000 ms deadline. Its worker ranks source rows before sorting joined combinations.
- `packages/store/src/javascript.ts`: JavaScript sandbox process/VM limits, 1,000 ms default, 64 MiB heap plus headroom, result length 1,000,000 and host-call round cap 50. Plug-in manifests allow higher limits, including 60,000 ms and 1,024 MiB. Static review only here; no sandbox process was started by the audit.
- `packages/store/src/errors.ts`: cooperative memory checks and a server event-loop watchdog. The server default remains 60,000 ms; it does not establish the requested one-second invariant.

## Changes and regression coverage

| Change | Implementation | Regression evidence |
| --- | --- | --- |
| Refuse exponential literal substitution before allocation | `calc/src/text-budget.ts`, `functions.ts`: exact non-overlapping match count, 8,000,000 UTF-16 result units, 250,000 matches; literal replacement semantics retained | Generated chained expansion, direct multiplicative expansion, sequential pairs and literal replacement tokens |
| Bound regex replacement and collection allocation | `calc/src/regex-guard.ts`: incremental accounting for literals, captures, prefix/suffix tokens; 8,000,000 input/result units; 250,000 replacement matches, split entries or match-list entries; 1,000,000 capture slots across iterator batches | Prefix/suffix and capture amplification, plain replacements, zero-width Unicode matches, replacement-token differential cases, split/match/capture ceilings |
| Bound MBS replacement/extraction/FindMatches output | `calc/src/mbs-regex.ts`: check each expanded capture and cumulative output before concatenation/join | Oversized single capture and cumulative replacement; failed FindMatches preserves the compiled reference and remains usable |
| Share formula work across Evaluate, While and custom calls | `calc/src/evaluate.ts`: 5,000,000 node steps, 2,500 ms cooperative deadline (above the 1,300 ms SetPrecision and 1,000 ms JavaScript per-call caps, which stay in force), clock checked every 1,024 steps, at every function call and at return, 500 ms of regex time shared across the formula (time outside guarded regex calls is not counted), 256 inner parsed-formula cache entries | Nested Evaluate, error inspection, repeated MBS calls, environment reuse after failure, many expensive built-in calls, non-regex work before a regex call, a recursive custom function inside the step budget |
| Propagate resource refusal through write fallbacks | `calc/src/complexity-error.ts`: mark new formula/substitution refusals so existing fallback handlers rethrow instead of storing null | Two generated database update regressions verify fields and modification IDs roll back, then a valid update succeeds |
| Avoid XML stack overflow and quadratic attribute lookup | `calc/src/xpath.ts`: 256 element levels, 8,000,000 input units, Set-based attribute uniqueness | 10/1,000/100,000 levels and attributes, exact depth boundary, duplicate and qualified attributes |
| Remove quadratic Markdown link-label retries | `server/src/docs.ts`: forward scan for labels and cached destination closing brackets | 10/1,000/100,000 delimiters, missing destinations, escaped/nested labels, allowed destinations, escaping, 500 generated comparisons with the previous grammar |

These are implementation limits, not claims of Claris compatibility. Claris behavior for limit exhaustion, replacement edge cases, ordering, parser recovery and resource budgets is **unverified** by this audit. No behavior is described here as Claris-documented, and no compatibility rule was inferred from a measurement.

## Measurement method

Reproducer: `node scripts/audit-complexity.ts`. Optional positional case names rerun only those cases. The script imports source and builds its own disposable SQLite databases; it never imports a hosted file. Each observation runs in a fresh worker with 128 MiB old generation and 16 MiB young generation limits. A one-second parent watchdog starts after module loading and setup and terminates synchronous work externally. The measurement worker is an **audit safeguard**, not a production fix. A setup watchdog also prevents a stuck setup from hanging the run.

Each cell below is **milliseconds / positive heap delta KiB / sampled RSS growth KiB**, followed by status. `OK` means the selected workload returned; `R` means an implementation refusal; `T` means the audit killed unfinished work at 1,000 ms. A refusal is not a successful query result. JSON stores the exact aggregate values and refusal class where available.

Heap is measured around the operation while retaining its answer; negative deltas are reported as zero. RSS is process-wide growth sampled by the parent at 10 ms intervals after setup. Neither is a proven peak allocation bound; zero can mean reuse/GC or a sampling interval shorter than the operation. Timeout cells have no final heap reading. SQLite native allocations are not in JavaScript heap. Times are single observations, not percentiles, and include first-use compilation/cache effects. They do not prove a hardware-independent CPU ceiling.

Most units are UTF-16 characters or generated records/items. PCRE translation uses n optional atoms; XML uses n nested elements or attributes; CSV/ICS use n rows/events; collation uses n decomposed character pairs. JSONPath uses n descendant selectors against a document depth capped at 500. Find and SQL pattern stress use up to 100 repeated wildcard/literal units against n characters. `$crossjoin` uses ceil(sqrt(n)) rows per side (16, 1,024, and 100,489 combinations); its worker is invoked directly with a 500 ms test deadline, without launching the endpoint's child process. Database population is excluded. The portal case uses a cartesian relationship and a filter that reads a reverse related aggregate; it does not exhaustively cover nested portal layouts. Calculated sort also requests a calculated summary through the generated layout, so the measurement includes that layout cost.

| Workload | 10 | 1,000 | 100,000 |
| --- | ---: | ---: | ---: |
| find-wildcards | 2.16 / 50.8 / 32.0 OK | 10.90 / 210.6 / 512.0 OK | 253.44 / 0.0 / 240.0 R |
| find-invalid | 0.97 / 25.3 / 704.0 OK | 1.00 / 28.9 / 0.0 OK | 1.27 / 491.0 / 0.0 OK |
| substitute | 1.76 / 100.4 / 0.0 OK | 2.03 / 1109.2 / 0.0 OK | 4.68 / 205.8 / 0.0 R |
| pattern-count | 1.97 / 65.5 / 0.0 OK | 4.67 / 67.7 / 32.0 OK | 3.68 / 342.8 / 0.0 OK |
| filter | 1.77 / 66.0 / 0.0 OK | 25.19 / 119.8 / 32.0 OK | 20.21 / 3960.5 / 4320.0 OK |
| regex-backtrack | 8.62 / 185.5 / 208.0 OK | 538.53 / 192.2 / 448.0 R | 505.38 / 288.9 / 368.0 R |
| regex-expand | 6.67 / 202.0 / 224.0 OK | 3.62 / 459.0 / 496.0 OK | 6.63 / 341.3 / 0.0 R |
| pcre-translate | 5.56 / 53.2 / 32.0 OK | 1.31 / 406.0 / 0.0 OK | 0.70 / 14.6 / 0.0 R |
| mbs-regex | 6.29 / 332.8 / 336.0 OK | 504.41 / 338.6 / 368.0 R | 506.59 / 500.9 / 448.0 R |
| evaluate | 3.23 / 215.4 / 0.0 OK | 9.06 / 0.0 / 0.0 OK | 76.95 / 2203.4 / 11376.0 OK |
| jsonpath | 23.15 / 0.0 / 1360.0 OK | 207.84 / 24979.9 / 32992.0 R | 0.32 / 11.2 / 0.0 R |
| jmespath | 1.49 / 51.7 / 0.0 OK | 1.24 / 106.2 / 0.0 OK | 12.30 / 5533.7 / 832.0 OK |
| sql-like | 0.11 / 4.9 / 0.0 OK | 0.11 / 6.2 / 0.0 OK | 1.01 / 132.6 / 0.0 OK |
| sql-glob | 0.14 / 4.9 / 80.0 OK | 0.13 / 6.2 / 688.0 OK | 1.00 / 102.9 / 0.0 OK |
| odata-strings | 8.02 / 80.6 / 96.0 OK | 2.30 / 81.6 / 0.0 OK | 6.05 / 218.0 / 256.0 OK |
| csv | 0.75 / 32.5 / 0.0 OK | 1.97 / 542.6 / 544.0 OK | 103.29 / 2528.6 / 7040.0 OK |
| json | 0.74 / 40.2 / 0.0 OK | 1.90 / 1386.6 / 0.0 OK | 60.22 / 13468.7 / 15664.0 OK |
| xml | 1.10 / 64.7 / 0.0 OK | 1.44 / 344.5 / 0.0 R | 2.80 / 1022.6 / 1104.0 R |
| xml-attributes | 0.89 / 46.6 / 0.0 OK | 19.97 / 1240.9 / 32.0 OK | 333.82 / 30976.4 / 28160.0 OK |
| ics | 1.34 / 133.9 / 0.0 OK | 38.25 / 49.0 / 4016.0 OK | 352.05 / 24030.7 / 47904.0 OK |
| html-escape | 3.21 / 33.7 / 0.0 OK | 2.52 / 467.7 / 0.0 OK | 227.56 / 9095.2 / 32304.0 OK |
| markdown | 5.47 / 28.8 / 16.0 OK | 0.85 / 33.1 / 0.0 OK | 4.28 / 134.3 / 0.0 OK |
| value-list-sort | 12.68 / 212.9 / 208.0 OK | 29.16 / 999.2 / 1024.0 OK | 601.31 / 7112.8 / 12448.0 OK |
| unicode-collation | 1.58 / 161.0 / 448.0 OK | 1.41 / 247.2 / 0.0 OK | 21.77 / 7231.1 / 7232.0 OK |
| custom-recursion | 5.50 / 215.3 / 1136.0 OK | 16.84 / 477.0 / 2272.0 OK | 55.25 / 2634.5 / 8768.0 R |
| cartesian | 4.67 / 249.9 / 224.0 OK | 9.00 / 1348.5 / 16.0 OK | 208.71 / 12106.2 / 23904.0 OK |
| crossjoin | 0.78 / 32.1 / 0.0 OK | 1.08 / 68.8 / 784.0 OK | 35.30 / 1784.5 / 4128.0 OK |
| portal-filter | 17.78 / 785.2 / 816.0 OK | 36.21 / 0.0 / 8320.0 OK | 1000.00 / — / 26848.0 T |
| calculated-sort | 15.86 / 691.5 / 592.0 OK | 51.90 / 1926.5 / 8736.0 OK | 1000.00 / — / 24768.0 T |
| summary | 10.75 / 583.6 / 192.0 OK | 33.62 / 1350.8 / 9136.0 OK | 479.67 / 19587.5 / 23632.0 OK |

The earlier Markdown sample at 100,000 unmatched delimiters was killed at 1,000 ms; the final sample completes in approximately 4 ms. XML depth 100,000 previously failed through native stack exhaustion; the final parser raises its own depth refusal before descending past 256. XML attribute lookup changed from repeated linear searches (quadratic total comparisons) to expected constant-time Set membership. A calculated summary crossed the one-second watchdog in the initial loaded run but completed in approximately 480 ms in the final sweep: that variability is a gap, not evidence of a hard limit.

## Inventory, worst-case classes and remaining caps

| Surface | Worst-case input class / growth | Existing or added protection; assessment |
| --- | --- | --- |
| Find `*`, `@`, `#`, `?`, literals and quotes | Many alternating stars/literals with a late mismatch, many criteria/records; O(pattern × text × records) | Existing NFA/work/length/part caps retained. `?` uses invalid-value checks. Normalization and SQLite scan costs are outside NFA step accounting. |
| Substitute | Successive replacement pairs multiply output exponentially; many tiny matches inflate temporary arrays | New exact preflight and result/match caps; no split array. Formula refusal propagates through write boundaries. |
| PatternCount | Many short non-overlapping occurrences or long common prefixes; string search plus case folding | Literal search, no user regex. 100,000-character probe passes. No independent input-byte or synchronous native-search deadline. |
| Filter | Large source and allowed-character set; O(source + allowed set), with arrays/Set proportional to input | Literal Set membership, no pattern compilation. No independent local input cap. |
| MBS RegEx and BE regex | Nested ambiguous quantifiers; captures/zero-width matches; prefix/suffix expansion | Existing 500 ms VM interruption, nesting/length guards; new result/collection caps and shared formula budget. Retained references have count caps, not a strict aggregate-byte cap. |
| PCRE-to-JS translation | Many optional atoms, group nesting, escape expansion; native compilation beyond translation | Existing 32,768 source units and 250 nesting levels. Translation stress passes/refuses. Native compilation is still outside worker isolation; general compile-memory safety is unproven. |
| Evaluate / custom functions | Nested dynamic formulas, long While loops, branching recursion; exponential total calls despite bounded depth | Existing parser nesting 1,000, custom recursion 10,000, default While 50,000; new shared work/deadline/cache limits. Parsing initial source and one long native built-in are not preempted by cooperative node checks. |
| JSONPath | Repeated recursive descent/filter projections; multiplicative visits/matches and copied paths | Existing 10,000 expression units, nesting 64, visits 2,000,000, matches 200,000, 3,000 ms. Tested amplification is refused, but deadline exceeds target. |
| JMESPath | Nested projections, sorting, deep equality, large join output | Existing 4,000 expression units, depth 256, steps 2,000,000, 20,000,000 output text, 3,000 ms. Benchmark covers sorting; nested projection/equality combinations are not exhausted. |
| SQL LIKE/GLOB | Many wildcards with late mismatches across many stored rows | Native SQLite matcher, no interpolated JS regex. Bounded pattern-length find path; direct SQL native execution still lacks a universal subsecond interrupt. Single-value probes are not table-scan guarantees. |
| OData string functions | Large operands, nested calls, repeated per-row evaluation | `contains` uses SQLite instr; prefix/suffix use escaped GLOB. Filter caps: 1,000,000 chars, 10,000 tokens, depth 32, 30,000 parameters, 256,000 SQL chars. No subsecond native scan guarantee. |
| CSV | Large quoted fields, doubled quotes, many cells; output proportional to cells/text | `store/src/delimited.ts` streams rows. Import planning caps rows at 500,000 and columns at 500; direct parser has no local byte cap. Probe uses generated quoted rows, not an exhaustive malformed-input matrix. |
| JSON | Very wide/deep trees, large numeric tokens, repeated parse/stringify copies | MBS depth 512; mutation/result guards include 1,000,000 nodes; native JSON array index cap 1,000,000 and bounded parse cache. HTTP preflight has separate tighter limits. Wide parser allocation itself is not protected by a global heap quota. |
| XML | Deep elements; many distinct attributes; namespace-map copying | New depth/input caps and linear uniqueness. XPath/XSLT and namespace-scope amplification remain outside a universal allocation/work budget. |
| ICS | Many folded lines, events and recurrence combinations | Existing input/event/occurrence/iteration caps. Large sample is returned with existing truncation behavior; `OK` is not evidence that all generated events were retained. |
| HTML sanitiser / escaping | Entity expansion, malformed tags, many characters requiring escaping | No standalone general HTML sanitiser found in searched TS sources. Measured server documentation escaping. Browser assistant builds DOM nodes; arbitrary HTML/browser DOM behavior was not dynamically measured. |
| Markdown | Repeated unmatched labels or missing link destinations; old link regex retried suffixes | Server renderer fixed and measured. Browser assistant has its own inline regex/DOM renderer; no browser timing or general Markdown-engine guarantee claimed. |
| Value-list and sort comparators | Many distinct values, reverse order, long common prefixes; O(n log n × key cost) | Existing ranks map, locale normalization and fallback comparison retained. No aggregate comparator-work cap; repeated key construction can be expensive. |
| Unicode collation | Long decomposed strings and combining marks, many sort keys | Normalization/key generation measured. No independent byte/work cap on all callers; 100,000 pairs passing is not a complexity proof. |
| Cartesian relationships | Small aggregate request fans out across stored tables; multiplicative joins | Related traversal has 10,000-row defaults/intermediate caps, but ID/aggregate paths can read more. Simple generated aggregate passes; general fan-out is unbounded by a one-second deadline. |
| `$crossjoin` | Product of source cardinalities, expensive predicates, sorting combinations | Existing process/count/byte/heap limits retained. 10-second production deadline exceeds target, although isolation protects the request event loop. Direct-worker probes pass and do not test child-process lifecycle. |
| Nested portal filters | Filter each related row and read another relationship/summary within it | Existing projection/cache reuse and cooperative memory checks. 100,000-row probe exceeds one second. No request-wide calculation budget spans all rows/portals. |
| Sort on calculated fields | Evaluate a formula for every candidate, then sort/cache values | Existing computed-value caches and memory checks; formula budgets reset per row. 100,000-row probe exceeds one second. |
| Summary recalculation | Calculate each source value, potentially following relationships, then aggregate | Existing one-pass collectors, cache invalidation and incremental summaries retained. Formula budgets do not cap the total read; initial timeout and final completion demonstrate load sensitivity. |
| JavaScript/custom plug-in sandbox | Infinite loop, allocation, repeated host rounds | Existing separate-process/VM/memory controls retained. Static inventory only; manifest maximums and round multiplication exceed a strict one-second total CPU budget. Different-model sandbox review remains outstanding. |

## Validation and limits of completion

Selected regression command (all data generated; no fixtures or compliance corpus):

```sh
node --test --test-concurrency=2 \
  packages/calc/test/{complexity,xml-complexity,regex-guard,mbs-regex,recursion,edge-cases,mbs-json,mbs-xml,xpath,collation,mbs-text,sortvalues-types}.test.ts \
  packages/server/test/docs-complexity.test.ts \
  packages/store/test/{complexity-rollback,portal-filter-cost,summary-date-extremes,value-list-sort}.test.ts
```

Result: **111 passed, 0 failed, 0 skipped**, approximately 12.5 seconds for the selected run. All selected files finished below 60 seconds. New timing assertions allow at least three times the relevant nominal budget; exact boundary, output and rollback assertions provide deterministic checks as well. Tests do not spawn application child processes. Test runner and audit commands used a stub directory first in PATH: launchctl, systemctl, sc, git, npm, curl and sudo each write a marker and exit 99. The wrapper fails if the marker exists; no marker was created. No full repository suite, fixture tests, imported compliance corpus, browser tests, service tests or network commands were run.

Typecheck: `node node_modules/typescript/bin/tsc -p tsconfig.json`: **passed, 0 diagnostics**.

The audit deliberately reports residual failures instead of treating worker termination as a product fix. Finishing the global invariant requires a shared read/statement budget with reliable cancellation for SQLite/native work, accounting across calculated rows and nested portals, allocation limits across retained plug-in state, and actual browser/sandbox measurements. These are not safely established by a few per-function timers. The one-PR changes above therefore do **not** certify the requested global invariant. No separate-model sandbox/MBS review was performed in this session; that review remains for the requested follow-up.

## Second-model review

An independent review reproduced these, all fixed with regression tests: the formula clock was read only every 1,024 steps, so a formula of many expensive built-in calls overran the deadline about tenfold (it is now also read at every function call); the regex allowance was a wall-clock deadline from the start of the formula, so slow non-regex work used it up and a later regex call returned an error string that a calculated field would store (it now counts only regex time); `Substitute` refused size-preserving work by match count and refused a large input with no matches (it now checks the result size only when there are matches and has no separate match cap); and the 2,000,000 step cap ended ordinary recursion such as Fib(25) in about 400 ms (raised to 5,000,000, about a second).

Open points from the same review, not changed:

- The 2,500 ms deadline counts time in host callbacks and in nested calculation fields, so a formula over many related rows can be refused on a slow or busy server where it succeeded before. Nested calculation environments each start with their own step budget; the outer deadline is only checked when control returns to it.
- Regex replacement, split and match-list operations still stop at 250,000 matches or 8,000,000 characters, and MBS `RegEx.ReplaceAll` reports a size error for a match-count refusal.
- The 500 ms regex time is wall-clock, so a loaded host can hit it on work that is normally faster.
- The deep-recursion case in the table above still ends with the existing depth-10,000 error rather than the new budget; the SetPrecision cap is per formula, not per call.
