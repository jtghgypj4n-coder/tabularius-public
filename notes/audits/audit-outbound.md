# r25-06: outbound request pools invariants

Reviewed 2026-10-17. Scope: the shared outbound guard, its admission pools and
request lifecycle, and their synthetic regression tests. The requested prior
`docs/audits/audit-outbound.md` did not exist in this checkout; this report creates
it. Existing behavior was established from source and `docs/outbound-requests.md`.
The supplied branch/base description was not independently verified by the original review.

## Existing protections retained

The checkout already had the shared socket lookup guard, fresh per-request
agents, eight active script requests per initiating file, four per initiating
account, FIFO within accounts and round-robin admission between accounts.
It also had total deadlines, decoded-body caps, a windowed minimum transfer
rate, operator/SSE exemptions and the r22-06 cancellation/lifecycle regressions.
These mechanisms were retained; this change adds missing coverage and fixes the
failure paths below. The pool is an admission pool, not a reusable socket pool.

## Findings fixed

| Finding | Change | Regression evidence |
| --- | --- | --- |
| IPv6 zone identifiers were discarded during classification; deprecated site-local scope could be allowed | Reject zones in parsing/host checks, and site-local scope under every policy | `net-guard-invariants`: literal, DNS, private-policy and allow-list cases |
| Refusals and some resolver/socket failures exposed internal destinations; malformed redirect errors could echo a URL | Generic refusals and URL errors; sanitized connection causes retain system codes; unknown fetch failures format generically | `net-guard-invariants`: refusals, resolver/connect causes and malformed/credential-bearing redirects; existing `network-problem` cases |
| HTTP 205 payloads were drained outside size/rate enforcement | Close every bodyless response before decoding or draining | `net-guard-invariants`: repeated plain/compressed 205 responses close, unlink signals and release capacity |
| Pre-admission streaming upload buffering could outlive its deadline or stop signal | Abort-aware reader buffering, checks around each read, cancellation without awaiting an uncooperative producer, and reader/listener cleanup | `net-guard-invariants`: deadline, caller and run-stop cancellation; producer cancellation that never settles; subsequent request succeeds |
| Unsolicited HTTP 101 could strand the request promise and admission after the socket closed | Handle the upgrade event explicitly, destroy the socket and reject the request | `net-guard-invariants`: repeated 101 failures, listener cleanup and subsequent capacity reuse |

The HTTP 101 regression was observed failing before its fix: an independent
watchdog expired after fifteen times the request deadline. The regression passes
with the explicit upgrade handler.

## Invariant evidence

| Invariant | Evidence |
| --- | --- |
| No connection, cookie, auth-header or TLS-session reuse across accounts/files | New HTTP and real TLS tests alternate identities at the same endpoint, inspect distinct sockets/agents, verify fresh TLS handshakes, and verify no implicit cookie/auth propagation |
| Proxy environment behavior matches documentation | A child Node process started with `NODE_USE_ENV_PROXY=1` and `HTTP_PROXY` in its environment: a control request made with the stock `http` module reaches the proxy, the guarded request does not (Node reads these variables only at startup, so setting them inside a running test proves nothing). HTTPS is covered by the guard's fresh per-request agent, not by a proxy trap |
| Checked address is connected address | Existing single-lookup/rebinding tests plus real IPv6-to-IPv4 fallback, mixed A/AAAA refusal before family selection, and fresh DNS checks on same-origin redirects |
| Scoped IPv6 refused | Literal, DNS, policy and allow-list regression cases |
| Redirects rechecked | All five followed redirect statuses strip credential headers on origin changes; internal targets, changing DNS, credentials, invalid URLs, backslashes, relative and protocol-relative locations exercised |
| Slow headers/body respect time caps | Existing silent-header/trickling-body tests plus new partial-header test; script-cap edits, queued deadlines, operator exemptions and upload cancellation covered |
| Compressed bodies respect size caps | Generated gzip, deflate and Brotli expansion exceeds the decoded limit; corrupt compressed streams fail; repeated failures leave capacity reusable |
| Many destination names cannot multiply active capacity | Eighty distinct hostnames produce only eight active requests/DNS lookups before cancellation; queued hosts never connect; later requests reuse capacity |
| One account cannot starve another | Existing fairness tests cover case-folded identity, FIFO, round-robin admission and independent files |
| Clean state after error, abort and cancellation | Existing r22-06 lifecycle/stop/lag suites plus compressed failures, stalled uploads, bodyless responses, upgrades and many-host cancellation; signal listeners and subsequent capacity checked |
| Minimum-rate boundary under a fake clock | Exact threshold accepted; next window resets its counter; an early burst cannot subsidize a slow tail; delayed ticks use elapsed monotonic time; operator/SSE exemptions hold |
| Failures do not reveal internal destinations | Message/cause redaction tests for internal classifications, DNS, connection failures and malformed redirects; system code retained |

## Validation

Node v22.22.2. Final focused command: **91 passed, 0 failed, 0 skipped** across
15 test files, approximately 22.5 seconds total. Every included file therefore
finished below the 60-second target. New real-time assertions have at least
threefold headroom; rate boundaries use a fake monotonic clock and fake intervals.

```sh
node --test --test-concurrency=2 \
  packages/scripts/test/net-guard.test.ts \
  packages/scripts/test/net-guard-invariants.test.ts \
  packages/scripts/test/net-guard-rate.test.ts \
  packages/scripts/test/net-guard-tls.test.ts \
  packages/scripts/test/net-guard-fairness.test.ts \
  packages/scripts/test/net-guard-lifecycle.test.ts \
  packages/scripts/test/net-guard-operator.test.ts \
  packages/scripts/test/network-problem.test.ts \
  packages/scripts/test/outbound-stop.test.ts \
  packages/scripts/test/outbound-stop-lag.test.ts \
  packages/scripts/test/outbound-loop.test.ts \
  packages/scripts/test/insert-from-url-guard.test.ts \
  packages/scripts/test/plugin-network.test.ts \
  packages/server/test/outbound-operator.test.ts \
  packages/server/test/outbound-guard-drift.test.ts
```

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json
```

Typecheck: **passed, 0 diagnostics**. The initial sandboxed test attempt could not
bind loopback listeners; the completed runs used approved local-listener access.
The selected child-process lifecycle test supplies stubs for the seven prohibited
commands and asserts that their marker is absent. The new tests spawn no child
processes. Servers, payloads, certificates and resolver answers are generated for
the tests; no external network or corpus data is used.

## Different-model security review

An earlier read-only review by a different model identified the bodyless-response and stalled
upload failures and proposed the HTTP 101 probe. The probe confirmed the third
failure. Follow-up review of all three fixes and their regressions reported no
remaining blockers. The reviewer did not run tests; execution evidence above is
from the implementing session.

## Limits and unverified behavior

- The broader repository and fixture-dependent suites were not run. Corpus
  and fixture files were not opened; restricted directories were not
  modified. No dependencies were added.
- Runtime evidence is from Node 22 on this platform. The TLS session test uses
  TLS 1.2 with certificate verification enabled and a generated test CA. Other
  operating systems and TLS versions were not exercised.
- Supported single content encodings are decoded and capped. Compound/unknown
  encodings remain opaque and are capped as received; downstream decoding needs
  its own decoded-size limit. This existing limitation is now explicit in
  `docs/outbound-requests.md`.
- Caller-provided abort reasons remain caller data. Internal destination
  redaction applies to guard-generated and transport-generated failures.
- Claris behavioral equivalence is **unverified**. This audit makes no claims
  about undocumented Claris behavior and uses no public-page quotations.

## Second review (after the original change opened)

No SSRF bypass and no admission-pool leak were found across zone ids, site-local and link-local spellings, decimal/octal/hex IPv4, mapped/compatible/NAT64/6to4/Teredo forms, mixed and rebinding DNS answers, redirects, and about 400 mixed concurrent requests with aborts. Findings, all fixed with tests:

- The proxy-environment tests could not fail because they set variables inside a running process; replaced by the child-process test described above, with a control request. The vacuous proxy trap in the TLS test was removed.
- A HEAD, 204 or 304 response naming `Content-Encoding: gzip` with no body crashed the process on the earlier code (the decoder raised an unhandled stream error). The change fixes it by not decoding bodyless responses; a regression test now covers all three.
- `::ffff:0:a.b.c.d` (SIIT) was classed public whatever it carried; it is now classified by its IPv4 address. A local-use NAT64 address (`64:ff9b:1::/48`) was classed own whatever it carried; the IPv4 address in its RFC 6052 position is now checked, so one carrying a link-local or metadata address is refused.
- Small behaviour changes for ordinary requests, all intended: an unrecognised fetch failure reads "the server could not be reached", an invalid URL throws `OutboundRefused`, HEAD responses keep their coding headers (as native fetch), string upload chunks are accepted, and operator destinations (S3, OIDC, standby) show only an error code for TLS or connect failures.
- The 101 test deadline was widened to avoid timing flakes on a slow runner.
