# r26-04 — second-round HTTP and outbound review

Reviewed 2026-10-18 on Node v22.22.2. All executed traffic used loopback; resolver answers, stores, payloads and certificates were synthetic. This report contains aggregate results, not database contents. No corpus or fixture files were opened, no dependencies were added, and no commit, push, service operation or installation was performed.

The initial search found the r20-08 edge limits, r18-02 shared guard and r18-05 fair admission pools already present. Those protections were retained. New failures concerned outbound framing/authority, equivalent proxy address identities, and MBS CURL redirect cleanup. This checkout also lacked the r25 fixes described below; their relevant implementations and regressions were carried forward before the second-round checks.

## History and provenance

Read-only history and parent-to-merge diffs were used. No Git mutation was performed. The inventory began with:

```sh
git log --since=2026-10-16 --merges --format='%h %s' -- packages/server packages/scripts packages/calc
```

A first-parent pass distinguished actual PR merges from main-into-topic merges; narrower passes covered `edge-limits.ts`, `request-body.ts`, `client-address.ts`, `changes.ts`, `inbound-hooks.ts`, `net-guard.ts`, `outbound.ts`, and `mbs-curl.ts`. Parent-to-merge diffs and their relevant tests established the contracts below.

| Requested change / direct follow-up | Merged PR | Merge commit | Scope considered |
| --- | --- | --- | --- |
| r18-02 | #1236 | `74bc8d8b1` | Shared guard, DNS pinning, feature adapters, inventory drift test |
| r20-08 | #1292 | `e627eced7` | HTTP setup, parser/transport budgets, body readers, proxy admission, streams |
| r18-05 | #1295 | `5b0a0cbcc` | File/account admission, cancellation, deadlines, transfer rate, operator isolation |
| MBS CURL | #1213 | `db7279d56` | Script transport, redirect handling, bounded responses, address policy |
| Custom fetch follow-up | #1293 | `dd90de46c` | Production transport cannot be replaced without the internal test capability |
| Cancellation follow-up | #1300 | `534b2e11c` | Outbound script cancellation scopes |
| Cluster release test | #1302 | `233e0fa61` | Eventual server-side slot release |
| Fast-runner lag test | #1303 | `5fa2171eb` | Event-loop sampling proportional to run duration |
| Lag retry test | #1304 | `779d082f7` | Bounded retries retain request/listener assertions |
| Tabularius rename | #1297 | `9c3dfd8a9` | Current command, environment, route and header names |
| r25-04 | **No merge found on this base** | Candidate `dcf314d09` | HTTP framing/target validation and regressions carried forward |
| r25-06 | **No merge found on this base** | Candidate `91d95b434` | Guard lifecycle/address/error fixes and regressions carried forward |

The last two entries are not represented as merged PRs. Their source/test patches applied without conflicts. The new TCP and proxy probes use additional inputs, and the feature probes exercise actual adapters rather than replacing their fetch functions. The copied framing regression's close-order assumption was corrected to wait for the server's socket-close event.

Other first-parent history hits in these shared leaf files were #1153 (`edc90a2d4`, URI error mapping), #1147 (`34b9fe20e`, durable hook state), #1160 (`e85f69cb0`, hook state updates), #1177 (`8801ef6e4`, hook log locking), #1156 (`e4d445652`, bounded hook JSON), #1187 (`4012245ef`, authentication-before-body), #1209 (`4dca782bd`, long-poll session revalidation), #1198 (`c758d660b`, monotonic polling/hook limits), #1220 (`07f46b59b`, explicit proxy trust), and #1271 (`9b524c2bc`, network error wording). Their overlapping hunks were inspected. The transport/body/proxy portions receive the checks below; this is not a new audit of their broader authentication or durable-storage implementations.

## Invariants and attempts to break them

Each invariant is a statement of this implementation's intended behavior, not a Claris compatibility claim. Test filenames below omit their `.test.ts` suffix.

| PR | Invariant | Test tried | Result |
| --- | --- | --- | --- |
| #1236 | The address connected to is the checked DNS answer, including every redirect. | `net-guard-round2`: Unicode hostname, same-origin Unicode redirect, and a second completed request after DNS changes to metadata; `net-guard-invariants`: mixed A/AAAA and IPv6 fallback. | Holds; no change to DNS pinning. |
| #1236 | Transport-generated errors do not expose internal destinations or URL credentials. | Carried `net-guard-invariants`: resolver failure causes, malformed URLs/redirects and refusal messages. | Failed on base; r25-06 sanitized errors retained, machine-readable codes preserved. |
| #1236 | Scoped or forbidden destinations stay forbidden even with administrator private-network permission. | Carried `net-guard-invariants`: zone identifiers, deprecated site-local scope, mixed DNS answers and allow-list variations. | Failed on base; carried r25-06 scope rejection. |
| #1236 / #1295 | Only the transport sets outgoing authority and message framing. | New `net-guard-round2`: a multibyte body with false Content-Length, simultaneous Transfer-Encoding/Content-Length, forged Host, proxy credentials and Connection-nominated fields. | Three failing cases on base; guard now derives framing and strips authority/hop headers. |
| #1292 / #1220 | Equivalent forwarded IP addresses share one per-address allowance. | New `http-round2`: expanded/compressed IPv6 and IPv4/mapped-IPv6 pairs while one response remains open; a distinct visitor still succeeds. | Two failures; canonicalized before identity accounting. |
| #1220 | A forwarded loopback address is never treated as a known external visitor. | New `http-round2`: hexadecimal mapped loopback, fully expanded mapped loopback with a port, and dotted mapped loopback. | Failed; canonicalization now feeds the existing loopback refusal. |
| #1292 | Protocol errors and closing responses cannot dispatch later pipelined application operations. | Carried `http-framing`: duplicate/missing Host, unsupported transfer codings, Connection fields, parser errors, Upgrade/CONNECT, delayed responses and explicit keep-alive responses. | Base framing suite: 35 failed / 60 passed; carried r25-04 fixes. Final framing suite passes. |
| #1292 | Original request targets are validated before routing or normalization. | Carried `http-targets` across production static/API routes; new `http-round2` places a malformed Unicode calendar target between valid queued requests. | Invalid targets close without dispatching the trailing operation; valid encoded names and absolute-form targets pass. |
| #1292 | Strict parsing cannot be disabled by a process-wide insecure-parser flag. | Final `http-framing` and `http-round2` under `--insecure-http-parser`. | 99 passed; explicit strict option retained. |
| #1292 / #1187 / #1156 | Small unauthenticated body limits do not replace authenticated route limits, and refused bodies commit nothing. | `edge-application`, `edge-bodies`: authenticated JSON/MCP above 64 KiB, exact/query boundaries, declared/chunked overflow, multipart overflow and incomplete uploads. | Holds; existing caps and body-reader implementation retained. |
| #1292 | Body inactivity and header deadlines cannot be extended by wall-clock edits or trickling headers. | `edge-transport`: forward/backward wall-clock edits, progressing bodies, stalled bodies and header trickles. | Holds. |
| #1292 / #1302 | Disconnects release admission while different visitors and cluster workers continue to progress. | `edge-cluster`, `edge-cli`, `edge-stream-slots`, plus explicit server-close synchronization in the carried framing test. | Holds; client-side close alone is not used as proof of server-side release. |
| #1295 | Four active requests per account and eight per file cannot be multiplied by destination names or account case variants. | New `net-guard-round2`: Unicode account case variants and cancellation/reuse; `net-guard-invariants`: many hostnames; existing fairness suite covers files, FIFO and round-robin accounts. | Holds; pools retained. Cancellation/reuse is not claimed as process restart. |
| #1295 / #1300 | Deadlines and cancellation cover queued, active, unread and upload-buffering phases without leaking slots or listeners. | Existing lifecycle/stop tests plus carried stalled-producer, bodyless 205 and unsolicited 101 cases. | Six carried outbound cases failed on base; r25-06 upload/205/101 lifecycle fixes retained. Final checks pass. |
| #1295 | Edited script time caps affect new requests, while operator traffic retains its separate policy. | `net-guard-fairness`, `net-guard-operator`, `outbound-operator`: cap edits, Infinity, occupied tenant capacity and script cancellation during webhook delivery. | Holds. |
| #1295 | An early response burst cannot subsidize a slow later window, and sparse operator/SSE traffic stays exempt. | Carried `net-guard-rate`: exact threshold, next-window reset and delayed monotonic ticks; existing real-time fairness test. | Holds. |
| #1295 / #1303 / #1304 | Repeated stopped-capable requests retain bounded listeners and a responsive event loop. | `outbound-stop-lag`: generated 1,000-request run with bounded retries; new cancellation/reuse probe. | Holds in the final profile. |
| #1295 / #1271 | Webhook responses are canceled on both success and retry, and script cancellation does not cancel operator delivery. | `changes-bodies` and `outbound-operator`: never-ending receiver bodies, retry, full script pools and canceled scripts. | Holds. |
| #1213 | Rejecting any MBS CURL redirect releases the unused current response immediately. | New `outbound-features-round2`: open redirect bodies with forbidden metadata destination, malformed Location and zero redirect budget. | Forbidden destination failed before fix; cancellation moved before all redirect checks; all three pass, existing budget error 47 preserved. |
| #1213 / #1293 | Script URL and MBS calls retain the guarded production transport and existing address restrictions. | `insert-from-url-guard`, `mbs-curl`, `plugin-network`; new MBS regression uses real guarded transport with synthetic DNS. | Holds apart from the redirect cleanup fixed above; internal custom-fetch gate retained. |
| #1236 | AI endpoints, OIDC discovery and S3 endpoints use the shared address guard. | New `outbound-features-round2`: real embedding/S3 calls followed by changed DNS, AI model probe with forbidden DNS, OIDC same-origin discovery redirect with changed DNS. | Holds; only allowed loopback hops reached receivers. |
| Import surface inventory | Calendar import does not fetch URL/ATTACH properties or a URL query argument. | New production calendar import with generated URL-bearing event and loopback receiver trap. | Holds; one generated event imported, zero trap requests. |
| Import surface inventory | Import Records does not turn a URL-looking document source into an HTTP request. | New real engine import with an absent local document and allowed loopback network. | Holds; error 100, zero imported rows, zero trap requests. This checkout has no separate remote Import Records downloader. |

The raw-connection drift scan also passes. OIDC token/JWKS requests, the assistant message endpoint, connection adapters and schedule/hook propagation were source-inspected for guard use. Their complete authentication/provider workflows were not all replayed. Calendar and Import Records are explicitly recorded as non-fetching paths rather than inventing a URL-import capability.

## Changes

New findings are fixed in:

- `packages/scripts/src/net-guard.ts:467`: derive outbound framing and authority; strip proxy/hop headers and Connection-nominated fields.
- `packages/server/src/client-address.ts:75`: normalize IPv6 and mapped IPv4 before forwarded-loopback checks and per-address limits.
- `packages/scripts/src/engine.ts:2823`: cancel an MBS CURL redirect's unread body before every rejecting branch.

Missing r25 protections were carried into `packages/server/src/http-framing.ts:15`, `packages/server/src/edge-limits.ts:57`, and the address/error/lifecycle sections of `packages/scripts/src/net-guard.ts` (notably lines 60, 270, 498, 558 and 599). Their corresponding regression suites were carried with them. Only a small set of pre-existing address/error expectations changed to match those protections.

The target validator deliberately applies a restrictive URI policy: raw non-ASCII targets, invalid escapes/UTF-8, fragments, backslashes, dot path segments and malformed authorities are refused; ordinary encoded names and absolute HTTP(S) targets remain supported. This is not a claim that every rejected target violates the HTTP standard. No second wire/body parser was added. Existing accepted unknown chunk-extension metadata remains a documented limit of the native parser; its message boundaries are tested.

## Final execution evidence

The runnable profile is `scripts/review-http-outbound.mjs`. It launches Node with `--test-concurrency=2 --test-timeout=55000`, a stub-only PATH, and marker-writing exit-99 stubs for launchctl, systemctl, sc, git, npm, curl and sudo. Any command marker fails the profile. The test runner and all its descendants inherit those restrictions. The profile excludes fixture-based tests and requires no downloaded data or new dependencies.

| Command | Passed | Failed | Skipped | Elapsed |
| --- | ---: | ---: | ---: | ---: |
| `node scripts/review-http-outbound.mjs` | 276 | 0 | 0 | 31.18 s |
| `node scripts/review-http-outbound.mjs --framing --insecure-http-parser` | 99 | 0 | 0 | 4.34 s |
| `node --test --test-concurrency=2 --test-timeout=55000 packages/server/test/outbound-features-round2.test.ts packages/scripts/test/mbs-curl.test.ts packages/scripts/test/net-guard-round2.test.ts` | 32 | 0 | 0 | 2.17 s |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --incremental false --pretty false` | 1 check | 0 | — | No diagnostics |

Counts overlap; they must not be added as unique tests. The final full profile includes the last MBS fix, framing cases and DNS-change cases. Its entire duration is below 60 seconds, so every included file completed below that target. The new deadline/rate assertions retain at least threefold headroom; close ordering uses explicit events. This profile required no larger-runner allocation, so no separate high-memory profile is needed for these cases. It is not a gigabyte-upload or saturation benchmark.

Before fixes, the carried framing suite had 35 failures and 60 passes, the carried outbound suite had six failures and 14 passes, the new guard probes had three failures and three passes, and the new proxy/Unicode framing probes had three failures and one pass. The added MBS forbidden-redirect probe also failed before its fix. An initial sandbox run could not bind loopback and was rerun with approved local-listener access. A strict-parser rerun exposed a test-only client/server close race; the corrected test waits for the server event and passes.

## Independent review and limitations

A read-only independent review (before this port) covered all changed production code, the new/carried tests and the runner. It found no blocking defect. Its requested evidence correction (pool reuse is not process restart) and raw-TCP buffering improvement were applied. It separately reviewed the final MBS redirect fix and its three regressions and found no blocker. The reviewer did not execute tests; execution results above come from the implementing session.

Not performed: live external proxy/Caddy differential replay, Windows/Linux runtime execution, full process-restart or durable-state crash testing, the entire repository suite, fixture-dependent cases, corpus workloads, and full OIDC token/JWKS or AI conversation workflows. The complete historical authentication/storage PRs that incidentally touched these files were not re-audited. The r25 merge status could not be established as merged on this base; their candidate fixes were included explicitly instead. Claris behavioral equivalence is **unverified**; this report makes no claim about undocumented Claris behavior and quotes no public pages. <!-- known-difference: Server operation ;; Whether FileMaker Server's HTTP framing and outbound-request behaviour match this review is not settled ;; Nothing shows; the report makes no claim about undocumented Claris behaviour ;; A FileMaker Server run behind a proxy that sends malformed requests -->
