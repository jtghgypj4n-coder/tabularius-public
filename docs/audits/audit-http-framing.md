# HTTP framing and parsing audit (r25-04)

Audit date: 2026-10-17. Runtime exercised: Node 22.22.2. Scope: HTTP/1.x at the shared edge, production routing/static files, and the repository's Caddy deployment configuration. All data was generated. No corpus or supplied database was opened. No dependencies were added; no git, installation, service-management or deployment commands were run.

The direct-server regression matrix passes. Live Caddy-to-origin agreement **has not been established**: no Caddy executable is installed and the local Docker daemon is unavailable. This report is not a blanket RFC-conformance certification. The parser permissiveness and compatibility restrictions below are explicit remaining qualifications.

## Existing protection retained

The initial search found the r20-08 implementation already in `edge-limits.ts`, `request-body.ts`, and the edge test suites: header/request-line budgets, connection and request budgets, body inactivity handling, serialized application dispatch, delayed `100 Continue`, bounded disposal of unread bodies, and Upgrade/CONNECT rejection. Those mechanisms remain. The installed Node parser already rejected duplicate/conflicting Content-Length, TE with CL, malformed chunk delimiters, bare LF/CR, folded headers, whitespace before colons, invalid field names, and forbidden field-value controls in the exercised cases. No second wire parser was introduced.

## Fixes and regression coverage

| Finding | Change | Regression evidence |
| --- | --- | --- |
| Duplicate Host and malformed authorities reached the application; Node's own missing-Host rejection could still allow a pipelined request to dispatch. | Validate raw field occurrences in the edge dispatch path, including HTTP/1.1 Host presence. Disable only Node's automatic Host response, replacing it with guarded rejection. | Identical/conflicting Host, missing/empty/invalid Host, and a valid request pipelined after each rejection. |
| Unsupported transfer codings and chunked HTTP/1.0 reached route readers without the required transfer decoding. | Permit only a single chunked transfer coding on HTTP/1.1; reject TE/CL combinations, duplicate lengths/codings and malformed values. | Raw-socket framing matrix, including both TE/CL field orders and positive chunked/binary-body controls. |
| Closing responses could dispatch another request between `end()` and `finish`; explicit response headers could advertise keep-alive after a client requested closure. | Stop the connection's dispatch state when closing; wait for response finish before releasing queued work; clear pending work on protocol errors. | Mixed-case/list/duplicate Connection fields, HTTP/1.0 keep-alive, immediate and delayed responses, long-target rejection, invalid Expect, queued semantic errors, and parser errors both before and after response headers. |
| Upgrade errors used a separate raw-response path that could insert an HTTP status line into an existing response. | Share the protocol-error termination path and stop queued work. If a response has begun, close without inserting another status line. | Upgrade during a partial response; h2c, CONNECT, WebSocket headers and the HTTP/2 preface. |
| Absolute-form routing could use the target's path while downstream consumers retained the unrelated Host field. Invalid escapes/dot segments could be normalized or fail within route handlers. | Validate the original target before URL normalization; use absolute-form authority for parsed/raw Host and origin-form path for downstream dispatch. Validate percent escapes once without changing encoded route segments. | Absolute-form authority/path/query checks; production API/static checks for NUL, encoded traversal, double encoding, incomplete escapes, overlong UTF-8 and invalid Unicode. |
| Process-wide insecure parsing could weaken parser defaults. | Set `insecureHTTPParser: false` explicitly for both HTTP and HTTPS. | Repeat the framing suite with Node's `--insecure-http-parser` flag. TLS and same-port HTTP redirect also reject duplicate Host; TLS rejects folding. |

Implementation: [http-framing.ts](../../packages/server/src/http-framing.ts), [edge-limits.ts](../../packages/server/src/edge-limits.ts). Tests: [http-framing.test.ts](../../packages/server/test/http-framing.test.ts), [http-targets.test.ts](../../packages/server/test/http-targets.test.ts), [edge-tls.test.ts](../../packages/server/test/edge-tls.test.ts).

## Outcomes and limits

Ambiguous or invalid framing in the rejection matrix receives one `400` response with connection closure, and no subsequent pipelined application operation runs. When response headers have already gone out, termination replaces a second status line. Existing size refusals remain `414`/`431`, and unsupported expectations remain `417`; valid traffic is not expected to receive `400`.

Valid chunk extensions are ignored; trailer fields remain separate from request headers and do not supply Host or credentials. Native parsing rejects Content-Length/Transfer-Encoding in the exercised trailer cases. Fixed-length and chunked bodies can contain binary controls and request-looking text without creating another request. Early close after `100 Continue` does not complete the body operation and returns the connection admission slot.

One grammar permissiveness remains: the installed llhttp accepts an empty value on an otherwise unrecognized chunk extension. The regression records acceptance and verifies the exact body and following message boundary. Thus a promise that **every** malformed extension gets `400` would be inaccurate. No boundary ambiguity was observed, and a second parser was not added solely for ignored metadata. Full strict-ABNF rejection of this form remains outside the delivered guarantee.

The target/authority policy deliberately rejects more than the URI grammar requires: percent-encoded registered host names, empty authorities, nonnumeric/out-of-range ports, leading double slashes (including in absolute-form paths), dot path segments, backslashes, fragments, raw non-ASCII target bytes, invalid UTF-8 escapes, and decoded path controls. Query data may contain percent-encoded line breaks, but not NUL or invalid escapes/UTF-8. Double-encoded path text remains literal: it is not decoded again to recover traversal. Also refused: an empty port (`Host: localhost:`), and an encoded `%2F` or `%5C` inside a path segment when it decodes to a dot segment or backslash (an OData key such as `Table('a%2F..%2Fb')`, or a layout name containing a backslash, must be sent another way). These are compatibility restrictions, not claims that every rejected URI violates an RFC. Ordinary encoded route names continue to work.

Validation is bounded by the existing header/line limits. No authentication-dependent caps, persisted lists, timers, leases or dependencies were introduced. No application operation is dispatched for a header/target refusal. A valid operation already in progress when a later message fails is not promised transactional rollback.

## Standards and proxy assessment

[RFC 9112, HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html), sections 2.2, 3.2, 5, 6.3, 7.1 and 9.3, defines message syntax, authority handling, framing, chunks and connection reuse. Section 3.2.2 says servers “MUST accept the absolute-form”; the implementation supports ordinary HTTP/HTTPS absolute-form while applying the restrictions above. Section 7.1.1 requires ignoring unknown chunk extensions. [RFC 9110, HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html), sections 5.5, 6.5, 7.6.1 and 10.1.1, covers field values, trailers, Connection and Expect. No undocumented Claris behavior is asserted.

The repository deployment uses `Caddyfile` through `compose.https.yaml`. The proxy target remains `tabularius:8080`; its HTTP transport now explicitly sets `versions 1.1`. There are no request-body rewrites or manual Host/Content-Length/Transfer-Encoding overrides in that configuration. Caddy documents the transport's `versions` setting and normal reverse-proxy request handling in [reverse_proxy (Caddyfile directive)](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Configuration inspection establishes the intended upstream protocol, **not** equality of parser acceptance or live message boundaries. A proxy may reject or normalize a request before the origin sees it, and downstream validation cannot recover discarded raw field lines. The floating `caddy:2` image also does not identify a tested Go/parser build. Live differential replay against the deployed image remains required before asserting the full proxy-chain invariant: compare request/body counts at the origin, verify no extra operation after rejection, and check closure/reuse on each side. Caddy configuration adaptation and live replay were not run; no image was pulled or daemon started.

## Verification

Focused suite: **134 passed, 0 failed, 0 skipped**, 12.39 seconds total. Every test file therefore completed well below 60 seconds. The raw-socket helper's 3-second response deadline provides substantial headroom over ordinary round trips. The new response-ordering tests use explicitly controlled completion, not short timer races.

```sh
node --test --test-concurrency=2 --test-timeout=60000 --test-reporter=spec \
  packages/server/test/http-framing.test.ts \
  packages/server/test/http-targets.test.ts \
  packages/server/test/edge-transport.test.ts \
  packages/server/test/edge-bodies.test.ts \
  packages/server/test/edge-tls.test.ts \
  packages/server/test/edge-stream-slots.test.ts \
  packages/server/test/edge-application.test.ts \
  packages/server/test/plain-redirect-host.test.ts \
  packages/server/test/static-cache.test.ts
```

The framing tests install the existing marker-writing, exit-99 stub PATH for launchctl, systemctl, sc, git, npm, curl and sudo. Production tests use a generated store and loopback only. Child-spawning CLI/cluster suites and fixture-dependent suites were not run.

Strict-option verification: **95 passed, 0 failed, 0 skipped**, 2.48 seconds.

```sh
node --insecure-http-parser --test --test-concurrency=2 --test-timeout=60000 \
  --test-reporter=spec packages/server/test/http-framing.test.ts
```

After replacing short test delays with explicit response-completion controls, the final framing-only rerun passed **95 tests, 0 failed, 0 skipped**, 3.93 seconds:

```sh
node --test --test-concurrency=2 --test-timeout=60000 \
  --test-reporter=spec packages/server/test/http-framing.test.ts
```

Both TypeScript checks passed (2 checks, 0 failed):

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json --incremental false
node node_modules/typescript/bin/tsc -p packages/web/tsconfig.json --incremental false
```

The audit-only known-differences marker scan passed. Only the installed Node version was exercised; other supported runtime versions, the complete repository suite, fixture-dependent tests and child-spawning CLI/cluster suites were not tested in this pass.

An earlier read-only review by a different model found no blocking security defect in the changed implementation, tests and Caddy configuration. Its requested follow-ups were addressed with documentation of stricter URI policy and regressions for a parser error before response headers and a queued semantic error after a delayed response. The Caddy runtime qualification remains open. The review did not claim to execute tests.

## Second-model review

A different model reviewed this change and found no way to get a malformed Host, Transfer-Encoding/Content-Length, Connection or target into a handler, and no crash or backtracking in the validators. It found four things, fixed with regression tests that fail on the earlier source: a pipelined request still ran after a response that closed while Node reported keep-alive (an HTTP/1.0 request without a length, or a route that sets `Connection: close` itself, such as the busy answers); a valid request still being answered was sent the 400 meant for garbage after it (it now finishes and the connection closes, with no status line spliced in); HTTP/1.0 requests got `100 Continue` (now ignored, RFC 9110 section 10.1.1); and the empty-port and encoded-separator refusals above were undocumented. The `--insecure-http-parser` rerun is not part of `npm test`; run it by hand after changing parser options.
