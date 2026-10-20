# r20-08 — HTTP network edge limits

Revised 2026-10-17 on Node v22.22.2 for round 2. The corrections below preserve route body caps, early 413 responses, multipart limits and slow-header 408s.

## Existing protections retained

Route byte caps remain in [dataapi.ts](../../packages/server/src/dataapi.ts) and the upload readers: ordinary JSON is 10 MiB, a container envelope is 1 GiB, and container/hosted-file pieces are 64 MiB. Verified callers retain their route limits. The shared-port plain HTTP redirect keeps its one-second idle keep-alive timeout.

The [64-level JSON guard](../../packages/server/src/request-json.ts), [64 KiB sign-in envelopes and bounded unread-body disposal](../../packages/server/src/request-body.ts), multipart part caps, and existing live-stream backpressure protections remain in place. Raw byte reads leave JSON validation and its error contract to each route's parser.

## Limits and responses

KiB/MiB/GiB below are powers of 1024. Transport settings are defined in [edge-limits.ts](../../packages/server/src/edge-limits.ts); `ServeOptions.edgeLimits` can override them at server creation. Direct connections count their socket peer. With the configured proxy header and a trusted peer, outstanding responses count the forwarded visitor instead; idle or unidentified proxy connections count only toward the total. Private Unix connections to cluster workers are exempt from per-address accounting. `--connections-per-address` / `TABULARIUS_CONNECTIONS_PER_ADDRESS` changes the default 64; the CLI flag takes precedence and must be a positive safe integer. See [server configuration](../../ADMIN.md). They are transport budgets for every connection, independent of authentication. Existing smaller limits for unverified credentials remain separate; verified callers retain their route's larger body budget. <!-- known-difference-ok: unverified refers to credentials before authentication, not vendor compatibility -->

| Case | Limit and observable response | Regression evidence |
| --- | --- | --- |
| Slow headers | 10 s absolute header deadline, checked every 1 s; `408` and close. Sending a byte repeatedly does not extend it. | `edge-transport`: injected 150 ms deadline, 10 ms checks, 20 ms trickle; independent client succeeds during attack. |
| Slow bodies | 300 s of body inactivity; wire progress renews a monotonic deadline without consuming data before authentication. System-clock edits cannot alter it. Progressing uploads have no fixed total deadline. `408` and close on a stall, or close without a second response if headers were already sent. | `edge-transport`: a progressing upload exceeds an injected 300 ms budget and succeeds; a stalled body receives 408; forward/backward clock edits preserve those outcomes; an independent client succeeds. |
| TLS handshake / no first byte on shared port | 10 s handshake deadline; shared-port protocol selection also has a 10 s first-byte deadline. Close without HTTP if HTTP has not been established. | `edge-tls`: silent sockets occupy admission slots and are closed; a TLS client remains responsive. |
| Header bytes | 16 KiB parsed header-field budget; overflow receives `431` and close, on HTTP and HTTPS. The native parser bounds the combined request line and headers to 48 KiB, including incomplete input. | `edge-transport`, `edge-tls`: oversized header plus successful independent request. |
| Header count | 100 fields, including duplicate names, Host and Connection. `431` and close. One extra parsed field detects overflow instead of silently truncating to the accepted count. | `edge-transport`: exact count accepted, one over rejected; normal request succeeds. |
| Request line | 32 KiB including method, spaces, HTTP version and CRLF; `414` and close. The combined 48 KiB parser limit can produce `431` first on a larger/incomplete input. | `edge-transport`: exact line accepted and oversized line rejected. `edge-application` accepts 8,141-byte and full 8 KiB decoded JSON queries with worst-case percent expansion. |
| Ordinary JSON | Shared `readJson` default: 10 MiB. Individual readers may set smaller caps (for example agent requests: 1,000,000 bytes). Declared oversize: `413` before reading or `100 Continue`; chunked oversize: `413` when the next chunk crosses the cap, before retaining that chunk or invoking application writes. | `edge-bodies`: injected small limits for each family, including unfinished chunked bodies. `edge-application`: actual 10 MiB JSON route, header-only refusal. |
| Upload | Container multipart: 1 GiB total envelope, streamed to a temporary file. Container/hosted-file pieces: 64 MiB each. `413` on declared or counted overflow. Existing hosted-file aggregate/size quotas remain in `uploads.ts`. | `edge-application`: actual container envelope and piece limits rejected without sending bytes; piece progress remains zero. `edge-bodies`: counted overflow preserves `413` instead of losing the response to a destroyed socket. |
| Import | Record import: 50 MiB. Import Tables: 50 MiB + 256 KiB envelope; its existing 20-file rule still returns `400`. Envelope overflow returns `413`. | `edge-application`: actual Import Tables header-only refusal; over-count form returns `413` without creating any table. Existing generated Import Tables tests pass. |
| MCP body | Installed SDK budget retained: 4 MiB for verified token/local-administrator requests; 64 KiB while Basic credentials still require a payload-selected file. `413` before `100 Continue` or on counted overflow. | `edge-application`: actual 4 MiB refusal; authenticated/local JSON and MCP requests above 64 KiB succeed. |
| gzip / deflate request bodies | Request decompression is not supported. Any non-identity Content-Encoding receives `415` before dispatch/body reading. Encoded bombs therefore never expand in the server. | `edge-bodies`: generated gzip and deflate inputs expanding to 1 MiB, with and without transmitted body bytes; zero encoded dispatches and successful ordinary clients. |
| Multipart part count | 100 parts for form-data readers; part 101 receives `413` while streaming, before an unfinished form's remaining bytes arrive. Buffered parsing validates the complete form before yielding its first part. | `edge-bodies`: 2,000-part input; isolated count overflow under the byte cap; early-yield bypass and fragmented-boundary regressions. |
| Multipart part size / metadata | A single part cannot exceed its route's total byte cap; overflow is `413`. Each part's headers are limited to 16 KiB (`413`); boundary text to 200 bytes (`400`). Single large container parts remain on disk. Multipart fallback buffering is limited to 50 MiB (`413` before whole-file allocation). | `edge-bodies`: oversized part, oversized part headers, one-byte boundary fragmentation, reduced injected fallback budget, successful single/multiple-part files and temp-file release. |
| JSON nesting | 64 container levels, including root; `400` before parsing/application writes. JSON readers enforce this at their parsing boundary; raw byte reads preserve each route’s established validation message and error code. | `edge-bodies`: excessive depth and exact-depth acceptance; `limits-json-input` and native-field regressions pass. |
| Huge JSON numbers | Numeric tokens at most 1,024 characters. Ordinary JSON also rejects values overflowing JavaScript's finite-number range, with `400`. Native exact-number reads preserve numeric source within the lexical cap, including `1e400` and integers above 2^53. Strings of digits remain strings. | `edge-bodies`: token overflow, exponent overflow, maximum finite value, direct-parser route and exact native-number round trip; zero rejected writes. |
| Bad chunk framing | Strict Node HTTP/1 parser: invalid chunk sizes/terminators and conflicting Content-Length/Transfer-Encoding or duplicate lengths receive `400` and close. | `edge-transport`: raw malformed requests followed by a pipelined write; zero writes and successful independent clients. |
| Pipelining / socket budget | Handlers execute in request order. At most 100 requests are accepted per socket, with a bounded application queue. The last accepted response closes normally; surplus requests are not dispatched and receive no synthetic 503. Cluster forwarding strips hop-by-hop response headers. | `edge-transport`: committed partial responses survive pipelining; a two-request budget handles a 1,000-request burst without extra commits. `edge-cluster`: 205 sequential requests cross front and worker budgets without errors or missing bodies. |
| Connections per address / total | Configurable 64 per real client address, 1,024 total per listener. Trusted-proxy visitors count while a response is active and receive 429 on overflow; direct overflow closes before dispatch. Worker Unix sockets do not share an address bucket. Slots return on response finish or socket close as appropriate. | `edge-transport`: direct caps, independent proxy visitors, proxy reuse and disconnect cleanup. `edge-cluster`: 64 slow requests pinned to worker 0 leave it reachable by another visitor. `edge-tls` includes sockets sending no bytes. |
| Idle keep-alive | 5 s, with Node's extra grace buffer disabled; normal close. Shared-port plain HTTP redirect retains 1 s. | `edge-transport`: injected 100 ms idle limit; independent request succeeds while idle connection waits to close. |
| Live SSE | Existing ten streams/session: opening the next succeeds and evicts the oldest. New total: 256 live streams/process; excess receives `503` with Retry-After: 1. Existing stalled-reader cutoff above 256 KiB queued output is retained. | `edge-application`: real raw SSE sockets, oldest eviction, full 256-subscriber limit, successful ordinary requests, listener counts restored after disconnect. Backpressure cutoff tested with a fake response. |
| MCP SSE | The installed SDK **does** serve GET/SSE even with a stateless transport. New caps: ten per identity and 256/process; excess receives `503` with Retry-After: 1. Slots release on response finish/close or setup failure. | `edge-application`: actual SDK GET/SSE admission, refusal and recovery. `edge-stream-slots`: total/identity saturation, explicit failure, repeated release and disconnect during asynchronous setup. |
| HTTP/2 rapid reset | HTTP/2 is not served. TLS does not negotiate h2; cleartext HTTP/2 prefaces and h2c upgrade attempts receive `400` and close. There is no HTTP/2 stream/reset handler to flood. | `edge-tls`: ALPN check. `edge-transport`: raw prior-knowledge preface and h2c upgrade, with responsive independent client. |
| WebSocket / other upgrades / CONNECT | Unsupported. `400` and close; no upgraded session is created. Unsupported Expect receives `417`. | `edge-transport`: WebSocket handshake, h2c, CONNECT and invalid Expect; ordinary requests remain responsive. |

At a completely saturated connection limit, a *new* legitimate connection cannot be distinguished from an attacker before authentication. Tests explicitly prove continued service on an admitted normal connection and recovery for new connections after a slot is released; they do not claim unlimited admission at saturation.

## Fixes and scope

- Added one shared edge factory for the application, cluster front, ACME listener and shared-port HTTP redirect. It configures absolute header and idle-body deadlines, rejects excess headers explicitly, bounds connections and pipelined work, rejects unsupported request encodings/upgrades and emits consistent parser errors on HTTP/TLS.
- Preserved connection admission before shared-port protocol detection. Initialized the handed-off HTTP server's deadline tracker; otherwise it never receives a normal listening event and its native timeout sweep is not started.
- Added a streaming multipart quota scanner. The parser uses the same delimiter rules, ignores epilogue as parts and does not interpret unanchored boundary-like payload bytes as parts. Streamed uploads use the existing non-destructive body reader, close/remove temporary files on failures, and keep whole-file fallback allocation bounded. No import or container write occurs until validation completes.
- Kept JSON structural and numeric bounds at each parsing boundary while retaining route-specific error contracts and exact native numeric-source serialization.
- Added process totals for live streams and bounded MCP SSE subscriptions. The MCP setup path rechecks socket/response liveness after its await before handing the request to the transport. Slot maps contain active entries only and have idempotent cleanup; no persisted lists or schedules were added.

The shared factory, application server, installed MCP transport and TLS/plain handoff are exercised in process. Round 2 also exercises real cluster workers over private Unix sockets, including address saturation and socket request budgets.

Claris/FileMaker Server's edge policies and responses were not measured and are unknown. These are Tabularius policies, not claims of vendor parity. No conclusions are made about an external reverse proxy's limits. The installed MCP SDK's observed GET behavior is covered locally; behavior of other SDK versions is not assumed.

## Verification

All new tests use generated data, generated certificates, fakes and raw sockets on `127.0.0.1`. The cluster regressions launch Node worker processes; the new server test harness additionally installs marker-writing, exit-99 PATH stubs for launchctl, systemctl, sc, git, npm, curl and sudo and fails on a marker. No corpus or supplied database was opened. No dependencies, workflow files or publication settings changed.

Tests run with `--test-concurrency=2`, in batches with a per-file ceiling below 60 seconds. Edge timeout values are injected down to 100–350 ms with a 3-second client safety bound. No test waits for production deadlines. Multipart chunks use asynchronous disk writes with backpressure; disconnects wait for an outstanding write before closing and removing its temporary file.

The current checkout was used to enumerate a larger suite than the requested 147-file baseline; no Git commands or main-checkout comparison were used. There were **277 attempted server test files**, including the two added edge files. **275 have passing runs** after corrections and reruns. Successful whole-file runs were all below 60 seconds; the longest was `defaults.test.ts` at 39.2 seconds. Tests used `--test-concurrency=2 --test-timeout=55000`, in batches of at most two files, with a separate 58-second process ceiling.

| Final focused check | Passing tests | Whole-file time |
| --- | ---: | ---: |
| `edge-application.test.ts` | 5 | 14.3 s |
| `edge-bodies.test.ts` | 7 | 3.1 s |
| `edge-cli.test.ts` | 4 | 28.4 s |
| `edge-cluster.test.ts` | 2 | 23.7 s |
| `edge-stream-slots.test.ts` | 1 | 0.8 s |
| `edge-tls.test.ts` | 1 | 1.1 s |
| `edge-transport.test.ts` | 18 | 2.3 s |
| `cluster-model.test.ts` (all seeds, unfiltered) | 5 | 25.4 s |
| `upload-auth-before-body.test.ts` | 49 | 10.3 s |
| `upload-auth-compatibility.test.ts` | 35 | 29.2 s |
| `account-provisioning.test.ts` | 7 | 16.2 s |
| `admin-resource-limits.test.ts` | 17 | 19.2 s |
| `inbound-hooks.test.ts` | 8 | 7.8 s |

All **38 edge regressions** and **84 upload-authentication tests** pass. The root TypeScript check, `node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false`, passes. Async body-sink tests cover backpressure, byte order, and waiting for an outstanding write before abort cleanup. Existing multipart tests retain early 413 and no-partial-import checks.

Two extra inventory checks remain outside the permitted validation environment:

- `linux-case-paths.test.ts` references the absent `fixtures/fmp12/Flicks.fmp12` from `encrypted-source.test.ts`; the fixture and test were left unchanged.
- Two integration cases in `public-url.test.ts` require `::1`. The socket guard refused those connections under the 127.0.0.1-only restriction. Its other five cases passed.

The corpus-dependent eval suite and a deliberate LAN-socket suite were excluded before execution. Under host load above 100, a body-shape file and later model runs reached the per-file ceiling. The body-shape file subsequently passed all 17 cases in 22.7 seconds. Every model seed also passed in smaller batches, followed by the complete unfiltered five-test file in 25.4 seconds. Node's compile cache stayed in temporary storage. No test coverage or model seeds were removed.

The first broad run exposed a harness exception: `defaults.test.ts` discards child-process environment settings, so its wildcard-listener cases briefly bypassed the local-bind guard. Those processes exited. The guard was extended to persist across child-process environment resets, and all five defaults tests passed again with bindings restricted to 127.0.0.1. Other guarded runs used 127.0.0.1 or private Unix sockets.

No dependencies, commits, pushes, or edits to the excluded directories were made.
