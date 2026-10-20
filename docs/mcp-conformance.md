# MCP conformance

How the MCP server at `/mcp` (Streamable HTTP) and `tabularius mcp` (stdio) measures against the [Model Context Protocol specification](https://modelcontextprotocol.io/specification/2025-06-18). It answers: if a client follows the specification, will this server do what it expects? A client that tries a revision from 2024-11-05 to 2025-11-25 gets the revision it asks for (or, for one the server does not know, 2025-11-25).

The check is `packages/server/test/mcp-conformance.test.ts`, which reads the cases from `packages/server/test/data/mcp-conformance.json`. It runs in the normal suite (`npm test`), starts a real server and a real `tabularius mcp` process, and sends each case over the transports it names. Beyond the table below it also checks that:

- every tool's `inputSchema` (and `outputSchema`, where there is one) is a valid JSON Schema object, using a small checker in `packages/server/test/json-schema-lite.ts` that fails on a keyword it does not know;
- the example arguments in the [MCP reference](reference/mcp.md) fit their tool's `inputSchema`, and an example response fits the `outputSchema` of a tool that declares one;
- tool names follow the 2025-11-25 rule (1 to 128 letters, digits, `_`, `-` and `.`) and are unique;
- on stdio, standard output holds only JSON-RPC messages, one per line, nothing is written to standard error, and the process exits when the client closes its input.

## What follows the specification, and what is a choice

A **spec** row follows a requirement of the revision and section it names. A **choice** row is behaviour the specification leaves open; the server fixes it one way and the row keeps it from drifting. Where two revisions differ the later one is cited, and the earlier one's behaviour is what the server does as well unless the row says otherwise.

| Case | Revision and section | Transport | Kind |
| --- | --- | --- | --- |
| `initialize-accepts-2025-11-25` | 2025-11-25 Lifecycle › Version negotiation | both | spec |
| `initialize-accepts-2025-06-18` | 2025-06-18 Lifecycle › Version negotiation | both | spec |
| `initialize-accepts-2025-03-26` | 2025-03-26 Lifecycle › Version negotiation | both | spec |
| `initialize-accepts-2024-11-05` | 2025-03-26 Lifecycle › Version negotiation | both | spec |
| `initialize-offers-latest-for-unknown-version` | 2025-11-25 Lifecycle › Version negotiation | both | spec |
| `initialize-answers-with-info-and-capabilities` | 2025-06-18 Lifecycle › Initialization | both | spec |
| `capabilities-claim-no-list-changed` | 2025-06-18 Server › Tools, Resources, Prompts › Capabilities | both | spec |
| `initialize-without-protocol-version-is-invalid-params` | 2025-06-18 Base › Messages; JSON-RPC 2.0 §5.1 | both | spec |
| `ping-answers-an-empty-result` | 2025-06-18 Utilities › Ping | both | spec |
| `response-echoes-a-string-id` | 2025-06-18 Base › Requests | both | spec |
| `initialized-notification-gets-no-answer` | 2025-06-18 Base › Notifications | both | spec |
| `unknown-notification-gets-no-answer` | 2025-06-18 Base › Notifications | both | spec |
| `cancelling-an-unknown-request-is-ignored` | 2025-06-18 Utilities › Cancellation | both | spec |
| `progress-for-no-request-is-ignored` | 2025-06-18 Utilities › Progress | both | spec |
| `progress-token-on-a-request-is-accepted` | 2025-06-18 Utilities › Progress | both | spec |
| `unknown-method-is-method-not-found` | 2025-06-18 Base › Responses; JSON-RPC 2.0 §5.1 | both | spec |
| `logging-is-not-offered` | 2025-06-18 Server › Utilities › Logging | both | spec |
| `tools-list-returns-one-page` | 2025-06-18 Server › Utilities › Pagination | both | spec |
| `tools-list-refuses-a-cursor` | 2025-06-18 Server › Utilities › Pagination | both | spec |
| `resources-list-returns-one-page` | 2025-06-18 Server › Utilities › Pagination | both | spec |
| `resources-list-refuses-a-cursor` | 2025-06-18 Server › Utilities › Pagination | both | spec |
| `resources-templates-list-returns-one-page` | 2025-06-18 Server › Utilities › Pagination | both | spec |
| `resources-templates-list-refuses-a-cursor` | 2025-06-18 Server › Utilities › Pagination | both | spec |
| `prompts-list-returns-one-page` | 2025-06-18 Server › Utilities › Pagination | both | spec |
| `prompts-list-refuses-a-cursor` | 2025-06-18 Server › Utilities › Pagination | both | spec |
| `tools-call-unknown-tool-is-a-protocol-error` | 2025-06-18 Server › Tools › Error handling | both | spec |
| `tools-call-without-params-is-invalid-params` | 2025-06-18 Base › Messages; JSON-RPC 2.0 §5.1 | both | spec |
| `tools-call-name-must-be-text` | 2025-06-18 Server › Tools › Calling tools | both | spec |
| `tools-call-bad-arguments-is-a-tool-error` | 2025-11-25 Server › Tools › Error handling | both | spec |
| `tools-call-answers-with-content` | 2025-06-18 Server › Tools › Tool result | both | spec |
| `resources-read-unknown-uri-is-not-found` | 2025-06-18 Server › Resources › Error handling | both | spec |
| `resources-read-unknown-database-is-not-found` | 2025-06-18 Server › Resources › Error handling | both | spec |
| `resources-read-without-uri-is-invalid-params` | 2025-06-18 Base › Messages; JSON-RPC 2.0 §5.1 | both | spec |
| `prompts-get-unknown-prompt-is-invalid-params` | 2025-06-18 Server › Prompts › Error handling | both | spec |
| `prompts-get-without-name-is-invalid-params` | 2025-06-18 Server › Prompts › Error handling | both | spec |
| `completion-for-unknown-prompt-is-invalid-params` | 2025-06-18 Server › Utilities › Completion › Error handling | both | spec |
| `http-invalid-json-is-parse-error` | 2025-06-18 Base › Messages; JSON-RPC 2.0 §5.1 | http | spec |
| `http-missing-jsonrpc-is-invalid-request` | 2025-06-18 Base › Messages; JSON-RPC 2.0 §5.1 | http | spec |
| `http-null-id-is-invalid-request` | 2025-06-18 Base › Requests | http | spec |
| `http-method-must-be-text` | 2025-06-18 Base › Requests | http | spec |
| `http-message-must-be-an-object` | 2025-06-18 Base › Messages; JSON-RPC 2.0 §5.1 | http | spec |
| `http-empty-batch-is-invalid-request` | JSON-RPC 2.0 §6 | http | spec |
| `http-batch-with-a-bad-message-is-invalid-request` | JSON-RPC 2.0 §6 | http | spec |
| `http-notification-is-accepted-with-202` | 2025-06-18 Base › Transports › Streamable HTTP | http | spec |
| `http-response-message-is-accepted-with-202` | 2025-06-18 Base › Transports › Streamable HTTP | http | spec |
| `http-request-is-answered-with-json` | 2025-06-18 Base › Transports › Streamable HTTP | http | spec |
| `http-unsupported-protocol-header-is-400` | 2025-06-18 Base › Transports › Streamable HTTP › Protocol version header | http | spec |
| `http-protocol-header-2025-11-25-is-served` | 2025-06-18 Base › Transports › Streamable HTTP › Protocol version header | http | spec |
| `http-protocol-header-2025-06-18-is-served` | 2025-06-18 Base › Transports › Streamable HTTP › Protocol version header | http | spec |
| `http-protocol-header-2025-03-26-is-served` | 2025-06-18 Base › Transports › Streamable HTTP › Protocol version header | http | spec |
| `http-protocol-header-2024-11-05-is-served` | 2025-06-18 Base › Transports › Streamable HTTP › Protocol version header | http | spec |
| `http-no-protocol-header-assumes-2025-03-26` | 2025-06-18 Base › Transports › Streamable HTTP › Protocol version header | http | spec |
| `http-unneeded-session-id-is-ignored` | 2025-06-18 Base › Transports › Streamable HTTP › Session management | http | choice |
| `http-does-not-issue-a-session-id` | 2025-06-18 Base › Transports › Streamable HTTP › Session management | http | choice |
| `http-foreign-origin-is-403` | 2025-06-18 Base › Transports › Streamable HTTP › Security warning | http | spec |
| `http-put-is-405` | 2025-06-18 Base › Transports › Streamable HTTP | http | choice |
| `http-get-without-event-stream-accept-is-406` | 2025-06-18 Base › Transports › Streamable HTTP | http | choice |
| `http-get-opens-a-stream-or-is-405` | 2025-06-18 Base › Transports › Streamable HTTP › Listening for messages | http | spec |
| `http-delete-ends-nothing-or-is-405` | 2025-06-18 Base › Transports › Streamable HTTP › Session management | http | spec |
| `http-post-must-accept-json-and-event-stream` | 2025-06-18 Base › Transports › Streamable HTTP | http | choice |
| `http-post-must-send-json` | 2025-06-18 Base › Transports › Streamable HTTP | http | choice |
| `stdio-line-that-is-not-json-is-ignored` | 2025-06-18 Base › Transports › stdio | stdio | choice |
| `stdio-message-without-jsonrpc-is-ignored` | 2025-06-18 Base › Transports › stdio | stdio | choice |
| `stdio-null-id-is-ignored` | 2025-06-18 Base › Transports › stdio | stdio | choice |
| `stdio-blank-line-is-ignored` | 2025-06-18 Base › Transports › stdio | stdio | choice |
| `stdio-serves-a-request-after-ignored-lines` | 2025-06-18 Base › Transports › stdio | stdio | choice |

## Where the server is stricter or plainer than the SDK it uses

The server is built on the TypeScript MCP SDK, and `packages/server/src/mcp-conformance.ts` changes the SDK's answers where the specification asks for something else:

- **Lists are single pages.** A `cursor` is refused with `-32602`, since the server issues none, and no list returns `nextCursor`.
- **An unknown tool** is the protocol error `-32602`. Arguments that fail a tool's schema are a tool result with `isError: true` (2025-11-25 asks for this so the model can correct itself).
- **An unknown resource** is `-32002` with the `uri` in `data`; a file that is not hosted is the same.
- **Params that fail a request's schema** are `-32602` with a one-line reason, not `-32603` with the schema check's output.
- **Capabilities say what is true.** `listChanged` and resource `subscribe` are not offered, because no notification is ever sent: each HTTP request gets its own stateless server, and nothing on stdio changes the lists either.
- **A message that is not JSON-RPC** (no `"jsonrpc": "2.0"`, a `null` or non-scalar `id`, a non-string `method`, an empty batch) is `400` with `-32600`; text that is not JSON is `400` with `-32700`. Both carry `"id": null`.

## Not specified, so not claimed

- **Malformed lines on stdio.** The specification says nothing about what a server writes back for a line that is not a JSON-RPC message. This server ignores it and keeps reading, so a client never sees an error with a `null` id (the schema has no such error).
- **Requests before `initialize`.** The specification says a client should not send them and does not say what a server does. This server answers them, as it answers a stateless HTTP request with no session.
- **Session ids.** The server never assigns a `Mcp-Session-Id`, which the specification allows. `DELETE /mcp` therefore ends nothing and is answered `200`; `405` would also be allowed.
- **Progress and cancellation.** No tool sends progress notifications or reads the cancellation signal, so a running tool is not interrupted. Over HTTP a cancellation arrives in a different request from the one it names, to a server that keeps nothing between requests, so it can only be ignored.
- **Resuming a stream.** Event ids and `Last-Event-ID` are not offered; no message is ever sent on the stream that `GET /mcp` opens, so there is nothing to resume.
- **`GET /mcp`.** With `Accept: text/event-stream` the server holds an event stream open and sends nothing on it (the specification allows `405` instead).
- **Request limits and timeouts.** The specification leaves a server's ceilings to it: the number of requests in flight for one identity, the body size, and a tool's running time are this server's own, set in `packages/server/src/index.ts` and described in the [MCP reference](reference/mcp.md).

## Features of the specification this server does not offer

Nothing here is tested because nothing here exists: logging (`logging/setLevel` is `-32601`), resource subscriptions, tasks (experimental in 2025-11-25), and the client-side features sampling, roots and elicitation, which this server never asks for. Authorization (the `401` challenge and OAuth sign-in a client uses to get a token) is covered by `oauth.test.ts`, `mcp-origin.test.ts` and `mcp-signin-parity.test.ts`, not here.
