# Security mutation audit

Completed 2026-10-16: **599 valid mutants, 593 killed, 6 equivalent exclusions, 0 unresolved survivors, 0 unresolved timeouts.** These counts cover the explicit scopes below, not all security behavior.

## Baseline and scope

The requested tooling, `mutate` npm command, and audit report were absent from both local `main` (`46ade466`) and the worktree's starting commit (`b3aaf352`). Local `main` was older than the supplied branch; no branch was changed. Existing privilege, path, lockout, origin, token and sandbox regression tests were retained and reused. No production guard was changed. No Claris-specific value was inferred: this audit tests the repository's implemented contracts, not independently verified Claris behavior. <!-- known-difference: Security checks ;; The mutation audit tests this repository's implemented contracts, not Claris behaviour checked against a Claris instance ;; Nothing shows; where a Claris product answers differently the audit would not notice ;; A run of the same cases against a Claris instance -->

Targets include privilege decisions (`privileges.ts`), password verification and sign-in lockout (`store.ts`), password second-factor policy, token scope and local admin bearer verification, path containment (`safe-path.ts`), browser origin checks, mail rate limits, and the JavaScript/plug-in sandbox boundaries. Line filters on the large store and sandbox modules explicitly limit the audited surface; they are not whole-file coverage claims.

## Runner

```sh
npm run mutate -- packages/server/src/public-origin.ts \
  --tests=packages/server/test/origin-mutation.test.ts \
  --report=mutation-report.json
```

The npm command runs under `nice -n 19`; executing the script directly also requires niceness at least 19. There is one sequential mutation campaign, with Node test concurrency fixed at 2. Before the baseline and each mutant, `sysctl -n vm.loadavg` must report load1 at most 90. Higher load is polled every 30 seconds; twenty continuous minutes above 90 stops the run and preserves partial results. A failed load read also stops the run. Waiting uses a monotonic clock.

Only Node built-ins are used; no dependencies were added. TypeScript's types are stripped with Node's built-in stripper to preserve source offsets. The mutator flips equality/ordering and boolean operators, removes unary negation, replaces an `if` condition with `false`, replaces explicitly terminated return expressions with `undefined` (or `false` for an existing `undefined`), and removes explicitly terminated throws. Each candidate makes one change. Comments and ordinary strings/templates are opaque. This is a conservative lexer, not a full JavaScript parser; ASI returns, template interpolations and other unsupported forms are not comprehensive mutation coverage.

The sandbox's generated programs can be included explicitly:

```sh
npm run mutate -- packages/calc/src/javascript.ts \
  --raw=CHILD --lines=78:130 \
  --tests=packages/store/test/javascript-functions.test.ts,packages/store/test/sandbox-bootstrap-mutation.test.ts \
  --report=sandbox-mutation-report.json
```

`--raw` accepts named, non-interpolated `String.raw` programs. Their code is parsed without execution before testing. Strings inside those programs remain opaque; mutation coverage does not include every embedded prelude string or every sandbox configuration value.

Tests are selected through static imports, re-exports, literal dynamic imports/`require`, and workspace package barrels. Type-only edges may overselect. Computed imports cannot be discovered. `--tests=a.test.ts,b.test.ts` restricts the selection, and rejects tests outside that dependency graph. The unmodified selection must pass first and contain at least one passing test. `--test-name=regexp` narrows test names further. Broad barrels can otherwise select many tests; review the selection with `--list` before a large run.

A synchronous Node loader hook supplies the mutant under the original module URL. The source file and its relative imports stay in place; production files are never overwritten. Temporary hooks and syntax-check files are removed on completion. A source change during a campaign stops the runner. `--timeout=60000` is the default hard deadline per test invocation (up to 120000); the whole child process group is killed on expiry. Syntax checking is also time-boxed. Results distinguish `killed`, `survived`, `invalid`, and `timeout`; invalid syntax and timeouts are not reported as kills. SIGINT/SIGTERM stop child work and preserve partial results.

JSON reports include the target's SHA-256, selected tests, mutant IDs, exact edits, outcomes and bounded failure output. Reports can contain local diagnostic paths and should be reviewed/redacted before sharing. `--ids=id,id` reruns individual candidates. `--lines=start:end` scopes a large module. Mutant IDs are line, operation and source offset, so they are tied to that source version. The default `npm test` command does not run mutation campaigns.

## Evidence

The initial pilot deliberately selected only `public-origin.test.ts`. Its survivors are relative to that selection; existing `mcp-origin.test.ts` and `public-url.test.ts` already cover many of the other exports. The new `origin-mutation.test.ts` exercises direct boundary decisions without starting servers, including malformed authorities, forwarded-header arrays, missing hosts and warning-observer replacement. Existing tests were neither weakened nor deleted.

The runner has focused tests for all mutation classes, exact edit round trips (including parameterised raw programs), opaque literals/types, import cycles and barrels, the load threshold/cutoff, and subprocess failures/deadlines. It does not use elapsed-time performance assertions.

## Final kill counts

Each candidate is counted once, using its final observed outcome after targeted reruns. Equivalent exclusions remain reported as survivors by the runner; they are reviewed here, never silently counted as kills. All 593 non-equivalent candidates were killed by test failures. No final invalid, unrun, or deadline-only result is included in that number.

| Target | Audited lines | Valid mutants | Killed | Equivalent |
| --- | --- | ---: | ---: | ---: |
| `packages/server/src/public-origin.ts` | Whole module | 62 | 60 | 2 |
| `packages/server/src/local-admin.ts` | Whole module | 32 | 32 | 0 |
| `packages/server/src/mail-limit.ts` | Whole module | 25 | 25 | 0 |
| `packages/store/src/safe-path.ts` | Whole module | 96 | 94 | 2 |
| `packages/store/src/privileges.ts` | 141–143; 253–453 | 115 | 113 | 2 |
| `packages/store/src/store.ts` | 680–701; 3926–3943; 4848–4981 | 145 | 145 | 0 |
| `packages/server/src/password-login-policy.ts` | Whole module | 22 | 22 | 0 |
| `packages/server/src/token-scope.ts` | Whole module | 38 | 38 | 0 |
| `packages/server/src/adminapi.ts` | 288–300 | 17 | 17 | 0 |
| `packages/calc/src/javascript.ts` | CHILD raw program, 78–130 | 6 | 6 | 0 |
| `packages/plugins/src/sandboxed.ts` | 40–107 | 41 | 41 | 0 |
| **Total** | | **599** | **593** | **6** |

The three `store.ts` scopes are password hashing (20/20 killed), API-token verification (41/41), and sign-in/lockout policy (84/84). The other large modules are explicitly scoped as shown. This is a conservative mutation-operator audit, not a claim of complete branch coverage or Claris compatibility. Claris behavior beyond the repository's established fixtures remains unknown; no undocumented verifier bytes or response values were invented.

The initial path pass used the existing broad path-handling tests and was stopped after 39 candidates to avoid repeatedly rebuilding their large directory tree. Fast direct path tests completed all 96 candidates. Five mutations made the common-root search loop forever; a dedicated child-process termination assertion killed them on rerun. Its three-second deadline has ample headroom over the roughly 100 ms unmodified run. The lockout sweep OR mutant first exceeded a 15-second campaign deadline; a scan-count assertion subsequently killed it without a large repeated sweep. These initial timeouts were not credited as kills.

A runner defect discovered during the first pass treated inherited `Object.prototype` names as operators. It generated three non-mutations: `local-admin.ts` `35:operator:1681`, `mail-limit.ts` `27:operator:1244`, and `privileges.ts` `263:operator:13174`. All three were discarded before these counts. The operator lookup now requires an own property, with a regression test. Syntax validation strips TypeScript before checking JavaScript and separately parses requested raw programs, so malformed generated syntax cannot earn a kill.

## Equivalent survivors

These are the complete final survivor list. Each exclusion is limited to the current module and its actual consumers.

| Target | Mutant ID | Reason for exclusion |
| --- | --- | --- |
| `packages/server/src/public-origin.ts` | `14:return:955` | httpOrigin is private. Replacing this invalid-input undefined with false preserves every caller: falsy checks reject it, and allowlist comparison is against an already validated, nonempty origin string. |
| `packages/server/src/public-origin.ts` | `15:return:1021` | The URL-parser exception returns the same private falsy sentinel as above; false and undefined lead to identical public decisions. |
| `packages/store/src/safe-path.ts` | `17:return:752` | approvedLink is private. Its missing-link sentinel is consumed only by !approved guards; false and undefined both return undefined from the public resolver. |
| `packages/store/src/safe-path.ts` | `27:return:1247` | The final missing-link sentinel has the same private falsy-only consumers; no exported return value or access decision changes. |
| `packages/store/src/privileges.ts` | `380:branch:18107` | Without this early full-access branch, fieldAccess calls table(), whose full-access branch returns ALL. ALL has view=true and no field restrictions, so the result remains modifiable. |
| `packages/store/src/privileges.ts` | `442:operator:21966` | Changing the OR between the nonobject/null guards to AND lets null and primitive file values reach WeakMap.get. That returns undefined for them, so the optional usage callback still cannot run. Object file values behave identically. |

A separate apparent redundancy in `safe-path.ts` (`17:branch:716`) was **not** discarded: a deterministic replacement/inode-reuse snapshot test demonstrates why the early non-link refusal matters and kills its removal.

## Regression coverage and validation

The new tests cover both password verification paths, dummy-hash work and post-await lockouts; token secrets for existing IDs, expiry edits and live identity mappings; import and cross-file privilege ceilings; malformed and forwarded origins; mount aliases, retargeting, filesystem errors and races; persisted mail counters and failed writes; lockout expiry, sweep throttling and bounded memory; and sandbox host-side modules, sockets, DNS, redirects and mail adapters. Network/mail adapters in the plug-in tests are in-memory doubles.

Existing tests were retained without weakening or deletion. The Admin API test file only gained an authentication-syntax case. Production guard sources and the normal npm test command are unchanged. The mutator's focused unit tests run normally; mutation campaigns require the separate npm command.

Final validation: **83 tests passed, 0 failed, 0 skipped**, across all 14 changed test files at concurrency 2 in **9.10 seconds total**. This also bounds every individual file well below 60 seconds. The focused strict TypeScript check of the runner and changed tests passed. The npm entry point's `--list` selection was checked. Mutations ran sequentially under niceness 19; high-load pauses occurred, but none lasted twenty continuous minutes.

```sh
nice -n 19 node --no-warnings --test --test-concurrency=2 --test-timeout=60000 \
  packages/server/test/*mutation*.test.ts \
  packages/store/test/*mutation*.test.ts \
  packages/plugins/test/sandbox-boundary-mutation.test.ts \
  packages/server/test/adminapi-tokens.test.ts
```

The typecheck used the existing TypeScript installation with `--noEmit --target es2023 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --erasableSyntaxOnly --verbatimModuleSyntax --strict --skipLibCheck --types node`, passing `scripts/mutate.ts` and those same test files. No dependency was installed.

## Resolved survivor inventory

Every ID below survived at least one selected-test pass and was subsequently killed. Initial survival means the selected tests missed the mutation, not that every test elsewhere in the repository would miss it. The origin pilot is included. The six final equivalents appear only in the table above. IDs refer to the unchanged source at starting commit `b3aaf352`; use `--list` to see each exact edit, and `--ids=` to reproduce a subset.

<details>
<summary>Resolved IDs and importing test selections</summary>

### origin: `packages/server/src/public-origin.ts`

Tests used across passes: [`packages/server/test/origin-mutation.test.ts`](../packages/server/test/origin-mutation.test.ts), [`packages/server/test/public-origin.test.ts`](../packages/server/test/public-origin.test.ts).

```text
14:branch:905, 20:return:1271, 25:boolean:1502, 30:branch:1712, 30:operator:1718, 30:operator:1759,
31:throw:1808, 45:branch:2857, 45:operator:2876, 45:return:2898, 47:boolean:2959, 47:branch:2959,
47:return:2975, 48:branch:2988, 48:operator:3037, 48:return:3057, 49:branch:3069, 49:operator:3079,
50:branch:3104, 50:operator:3130, 50:return:3149, 54:branch:3456, 54:return:3489, 56:boolean:3520,
56:boolean:3521, 58:boolean:3668, 58:branch:3668, 58:operator:3673, 58:operator:3680, 58:return:3699,
62:return:3924, 62:operator:3933, 62:operator:3949, 62:operator:3984, 62:operator:4001, 80:operator:4835
```

### local-token: `packages/server/src/local-admin.ts`

Tests used across passes: [`packages/server/test/local-admin.test.ts`](../packages/server/test/local-admin.test.ts), [`packages/server/test/security-mutation-io.test.ts`](../packages/server/test/security-mutation-io.test.ts).

```text
68:branch:2922
```

### mail-limit: `packages/server/src/mail-limit.ts`

Tests used across passes: [`packages/server/test/mail-limit.test.ts`](../packages/server/test/mail-limit.test.ts), [`packages/server/test/security-mutation-io.test.ts`](../packages/server/test/security-mutation-io.test.ts).

```text
43:operator:2077, 45:operator:2201, 52:branch:2513, 52:operator:2534, 52:throw:2570, 62:branch:3042,
62:return:3109
```

### safe-path: `packages/store/src/safe-path.ts`

Tests used across passes: [`packages/server/test/path-handling.test.ts`](../packages/server/test/path-handling.test.ts), [`packages/server/test/path-liveness-mutation.test.ts`](../packages/server/test/path-liveness-mutation.test.ts), [`packages/server/test/path-mutation.test.ts`](../packages/server/test/path-mutation.test.ts).

```text
6:operator:286, 6:operator:317, 14:branch:640, 17:branch:716, 22:operator:945, 22:operator:979,
22:operator:1013, 23:operator:1059, 46:branch:2184, 49:branch:2303, 68:operator:3224, 81:branch:3730,
81:operator:3735, 81:return:3762, 85:branch:3866, 85:return:3897, 102:branch:4607, 102:return:4696,
113:branch:5153, 113:operator:5158, 118:branch:5331, 134:branch:6119, 137:branch:6218, 137:return:6273,
142:branch:6393, 142:return:6482, 148:branch:6670, 148:return:6725
```

### privileges: `packages/store/src/privileges.ts`

Tests used across passes: [`packages/store/test/privilege-masking.test.ts`](../packages/store/test/privilege-masking.test.ts), [`packages/store/test/privilege-mutation.test.ts`](../packages/store/test/privilege-mutation.test.ts), [`packages/store/test/privilege-options.test.ts`](../packages/store/test/privilege-options.test.ts), [`packages/store/test/privilege-pertable.test.ts`](../packages/store/test/privilege-pertable.test.ts).

```text
274:return:13724, 279:operator:13998, 283:return:14078, 288:return:14258, 300:branch:14649, 300:return:14667,
301:operator:14721, 301:operator:14749, 301:boolean:14763, 301:operator:14808, 306:return:14977,
306:operator:14987, 306:operator:14999, 306:operator:15076, 310:branch:15178, 310:return:15196,
315:branch:15465, 315:return:15483, 316:return:15508, 320:branch:15607, 320:return:15625, 321:return:15650,
326:branch:15851, 326:return:15869, 327:return:15887, 351:branch:16647, 351:return:16665, 358:operator:17028,
358:operator:17038, 358:operator:17048, 359:operator:17106, 359:operator:17126, 359:operator:17136,
359:operator:17144, 360:operator:17169, 360:operator:17188, 360:operator:17205, 360:operator:17215,
360:boolean:17219, 360:operator:17233, 360:operator:17243, 361:branch:17263, 362:throw:17279,
394:boolean:18822, 394:branch:18822, 394:return:18851, 396:return:18935, 396:operator:18979, 402:return:19445,
403:operator:19602, 408:operator:19824, 410:return:19929, 416:return:20313, 416:operator:20320,
422:branch:20626, 422:throw:20647, 423:branch:20717, 423:throw:20754, 425:operator:21033, 430:branch:21150,
430:operator:21168, 430:throw:21180, 431:operator:21330, 432:operator:21406, 442:branch:21866,
442:operator:21876, 442:boolean:21879, 442:operator:21893, 442:operator:21933, 442:operator:21953,
442:operator:21979
```

### password: `packages/store/src/store.ts`

Tests used across passes: [`packages/store/test/lockout.test.ts`](../packages/store/test/lockout.test.ts), [`packages/store/test/password-mutation.test.ts`](../packages/store/test/password-mutation.test.ts).

```text
681:branch:33602, 681:return:33638, 683:branch:33741, 683:operator:33761, 683:operator:33770,
683:return:33787, 696:branch:34430, 696:return:34466, 698:branch:34586, 698:operator:34593,
698:operator:34606, 698:boolean:34609, 698:operator:34615, 698:boolean:34618, 698:return:34632,
700:return:34709
```

### lockout: `packages/store/src/store.ts`

Tests used across passes: [`packages/store/test/lockout-mutation.test.ts`](../packages/store/test/lockout-mutation.test.ts), [`packages/store/test/lockout.test.ts`](../packages/store/test/lockout.test.ts), [`packages/store/test/password-mutation.test.ts`](../packages/store/test/password-mutation.test.ts).

```text
4851:branch:281672, 4858:branch:282097, 4859:return:282196, 4859:operator:282230, 4859:operator:282244,
4868:return:282743, 4868:operator:282793, 4868:boolean:282796, 4876:branch:283294, 4876:return:283316,
4879:branch:283471, 4879:operator:283483, 4880:boolean:283568, 4880:operator:283580, 4880:operator:283604,
4881:boolean:283658, 4881:branch:283658, 4881:return:283676, 4883:branch:283792, 4883:operator:283825,
4883:boolean:283828, 4883:operator:283845, 4883:boolean:283848, 4883:operator:283882, 4883:boolean:283885,
4883:operator:283920, 4883:return:283953, 4884:return:283975, 4897:return:284579, 4897:operator:284618,
4902:return:284757, 4920:operator:286039, 4921:operator:286100, 4933:branch:286578, 4933:operator:286608,
4943:branch:287154, 4945:branch:287236, 4945:operator:287244, 4946:operator:287402, 4948:branch:287476,
4948:operator:287495, 4948:operator:287504, 4948:operator:287532, 4950:branch:287620, 4950:operator:287660,
4953:branch:287867, 4953:operator:287886, 4963:operator:288169
```

### second-factor: `packages/server/src/password-login-policy.ts`

Tests used across passes: [`packages/server/test/password-login-policy-mutation.test.ts`](../packages/server/test/password-login-policy-mutation.test.ts), [`packages/server/test/require-2fa.test.ts`](../packages/server/test/require-2fa.test.ts), [`packages/server/test/signin-parity.test.ts`](../packages/server/test/signin-parity.test.ts).

```text
10:operator:430, 10:operator:465, 11:branch:509, 12:boolean:543, 12:branch:543, 12:return:556, 13:boolean:648,
13:branch:648, 15:return:763, 17:branch:872, 17:operator:893, 18:return:936, 21:branch:1033, 21:operator:1066,
21:boolean:1069, 21:operator:1101, 23:return:1208, 25:branch:1378, 25:operator:1412, 25:boolean:1415,
27:return:1520, 29:return:1661
```

### token-scope: `packages/server/src/token-scope.ts`

Tests used across passes: [`packages/server/test/token-file-scope.test.ts`](../packages/server/test/token-file-scope.test.ts), [`packages/server/test/token-scope-mutation.test.ts`](../packages/server/test/token-scope-mutation.test.ts).

```text
19:operator:1147, 19:boolean:1151, 19:boolean:1152, 19:operator:1168, 19:boolean:1171, 19:boolean:1172,
23:boolean:1348, 23:branch:1348, 36:branch:2058, 44:branch:2583, 44:return:2606, 48:branch:2764,
50:branch:2838, 52:branch:2964, 52:operator:2971, 55:return:3087, 64:branch:3518
```

### api-token: `packages/store/src/store.ts`

Tests used across passes: [`packages/server/test/api-tokens.test.ts`](../packages/server/test/api-tokens.test.ts), [`packages/store/test/api-token-mutation.test.ts`](../packages/store/test/api-token-mutation.test.ts).

```text
3928:branch:229176, 3928:return:229187, 3934:branch:229725, 3934:operator:229752, 3934:return:229791,
3935:operator:229822, 3935:return:229870, 3936:branch:229889, 3936:return:229931, 3938:branch:230093,
3938:operator:230122, 3938:operator:230140, 3938:boolean:230158, 3938:operator:230168, 3938:operator:230202,
3938:return:230241, 3939:branch:230260, 3939:return:230326, 3940:branch:230345, 3940:boolean:230358,
3940:operator:230393, 3940:boolean:230396, 3940:operator:230437, 3940:return:230488, 3942:operator:230880,
3942:operator:230894, 3942:operator:230912
```

### admin-origin: `packages/server/src/adminapi.ts`

Tests used across passes: [`packages/server/test/adminapi-tokens.test.ts`](../packages/server/test/adminapi-tokens.test.ts).

```text
299:branch:14815, 299:throw:14868
```

### sandbox: `packages/calc/src/javascript.ts`

Tests used across passes: [`packages/store/test/javascript-functions.test.ts`](../packages/store/test/javascript-functions.test.ts), [`packages/store/test/sandbox-bootstrap-mutation.test.ts`](../packages/store/test/sandbox-bootstrap-mutation.test.ts).

```text
102:raw-CHILD-throw:5544, 116:raw-CHILD-branch:6249, 116:raw-CHILD-operator:6281, 119:raw-CHILD-throw:6344
```

### plugin-boundary: `packages/plugins/src/sandboxed.ts`

Tests used across passes: [`packages/plugins/test/sandbox-boundary-mutation.test.ts`](../packages/plugins/test/sandbox-boundary-mutation.test.ts), [`packages/plugins/test/sandboxed.test.ts`](../packages/plugins/test/sandboxed.test.ts).

```text
72:return:4630, 75:throw:4744, 78:branch:5093, 78:return:5117, 85:branch:5605, 85:throw:5633, 92:branch:6310,
92:return:6367, 93:branch:6387, 93:throw:6406, 104:throw:7034
```

</details>

The five path candidates initially detected only by a deadline were also killed by the new liveness assertion: `6:return:273`, `6:operator:277`, `6:boolean:289`, `6:boolean:320`, and `40:boolean:1898`. They are separate from the resolved-survivor inventory because they never passed the selected tests.
