# MCP protocol conformance audit

## Baseline and scope

The current checkout already contains the merged conformance suite (`packages/server/test/mcp-conformance.test.ts`), its 66 data-driven wire cases (`packages/server/test/data/mcp-conformance.json`), the protocol fixes (`packages/server/src/mcp-conformance.ts`), and the behavior register (`docs/mcp-conformance.md`). This audit therefore drops the already completed implementation work. This pass adds the required stub `PATH` guard to both stdio child processes. No behavior in the #1034 area was changed.

The server uses the TypeScript SDK's supported handshake versions through 2025-11-25; the suite exercises the public specification revisions 2024-11-05, 2025-03-26, 2025-06-18, and 2025-11-25. The SDK also accepts 2024-10-07, but no public specification page for that revision was found, so this audit makes no claim about its conformance. The HTTP server is stateless and does not offer session IDs or event replay.

## Evidence

- The [2025-06-18 transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) supplies the stdio newline framing and clean stdout rule, the HTTP `Accept` and response rules, `Origin` validation, optional session IDs, GET/DELETE behavior, and optional SSE replay.
- The [2025-06-18 tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) and [2025-11-25 tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) supply the tool list, schema, call result, and error requirements. Each wire case names its revision and section in the case data. The [behavior register](../mcp-conformance.md) records the cases and what the specification leaves open.
- `node --test --test-concurrency=2 --test-timeout=60000 packages/server/test/mcp-conformance.test.ts`: **112 passed, 0 failed, 15.6 s** on one file. It uses generated empty host data and a server bound to loopback. Both stdio children now inherit only stubs for `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`, and `sudo` on `PATH`; a stub writes a marker and exits 99, and the test fails if the marker exists.
- `npx tsc -p tsconfig.json --noEmit`: passed. `git diff --check`: passed.

## Not specified or not offered

The [behavior register](../mcp-conformance.md#not-specified-so-not-claimed) lists malformed stdio input, pre-initialization requests, sessionless DELETE, progress/cancellation effects, SSE resume, GET stream lifetime, and request limits as choices or absent features. It also names the unsupported logging, subscriptions, tasks, and client-side features. No Claris or vendor behavior is inferred by these tests. <!-- known-difference: MCP ;; Behaviour the MCP specification leaves open (malformed stdio input, requests before initialize, sessionless DELETE, progress and cancellation effects, SSE resume, GET stream lifetime, request limits) is a Tabularius choice or not offered, not a claim of matching another server ;; An MCP client that relies on one of these behaviours may see a different answer or a refusal ;; A later MCP specification revision or tested behaviour of reference servers that pins these cases -->
