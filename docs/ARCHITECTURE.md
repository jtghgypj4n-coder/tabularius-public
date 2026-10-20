# Architecture and roadmap

Goal: drop in an existing `.fmp12` file, have it hosted, and work with it from
a client, with AI built in through MCP. We keep what FileMaker does well and
drop its limits.

## Stack (defaults, open to change)

| Choice | Why |
|---|---|
| **TypeScript on Node 22.20+**, run directly with Node's type stripping | One language for the reader, server, web client and MCP server. No build step. |
| **No runtime dependencies in the reader** | It runs anywhere: CLI, server, browser, edge. |
| **Runtime dependencies**: the server uses the official MCP SDK and `zod`; the plug-in package also uses `zod` | The SDK keeps `/mcp` in step with the MCP spec; `zod` validates tools and plug-in manifests. Everything else uses only Node. |
| **SQLite** (built into Node) as the first store; Postgres next | The hosted engine runs on a real database instead of the fmp12 file: concurrent access, SQL, backups, replication. |
| **node:test** | Built in, no tooling to install. |

If parsing speed on multi-GB files becomes a problem, the decoder in
`packages/fmp12/src/chunks.ts` is small enough to port to Rust/WASM.

## Phases

Done so far: phase 1, plus the core of phases 2 and 6 (import, Data API
records/find/CRUD, MCP tools).

1. **Read**: open any unencrypted fmp12, decode schema,
   scripts, layouts and records. CLI to inspect, export JSON/CSV/SQLite.
2. **Import and host**: import an fmp12 into the engine store, keep FileMaker
   record ids, field ids and object ids so references survive. Serve a
   FileMaker **Data API–compatible REST API** and OData, plus a live
   (WebSocket) API for our own client. Accounts and privilege sets carried
   over, with existing password verifiers.
3. **Calculation engine**: decode stored formulas, then evaluate FileMaker's
   calculation language (functions, Let, custom functions, relationships,
   summaries) server-side.
4. **Client**: a web client that renders layouts (parts, fields, portals,
   buttons, themes) and supports browse, find, sort, and data entry.
   Design mode (docs/design-mode.md) changes tables, fields, relationships,
   layouts and scripts without FileMaker Pro.
5. **Scripts**: a script engine for the common steps, with triggers.
6. **AI / MCP**: an MCP server exposing the solution: schema, find, read and
   write records, run scripts, explain calculations, and build or change
   schema and layouts on request. Ships in the server from phase 2 on, so AI
   access grows with each phase.
7. **Write back** (optional): save to fmp12 so files can go back to FileMaker.

## Several users

One server process owns each hosted folder (a `.openhbam.pid` file marks
it). Stores run SQLite in WAL mode, so finds, MCP SQL and backups read while
others write. Record locks live in memory on the server, per base table and
record, owned by a Data API session; the store refuses writes to a record
locked by another session (error 301), and the session that holds a lock is
known from the request's async context, so scripts it runs can still edit.
Every write is announced to live clients over Server-Sent Events.

Under load (see `scripts/loadtest.ts`) the costs that grow with people are
per request and per live event, so the store caches each account's
privileges and each table's record count, dropping them when accounts,
privilege sets or records change, here or from another process (SQLite's
`data_version`). Events from one moment go to each stream in one write.
Passwords are hashed on the thread pool, so a crowd logging in at nine
doesn't stall everyone else. SQLite runs with `synchronous = NORMAL`: saves
don't wait on the disk, and a power cut can lose the last moments of edits
but never corrupts the file. Finds on text use a word index per table
(SQLite FTS5 over its stored text fields as a find folds them, so ligatures and
full-width letters are found by their plain letters; kept current by triggers, built on
first use and dropped on design changes; see `packages/store/src/words.ts`)
to narrow the records before applying FileMaker's exact rule, unless a tenth
or more of the records match; the AI's record search reads the same index.
The triggers call a `fm_fold` SQL function that Tabularius defines on every
connection it opens, so another program that edits records in a file with word
indexes must define it too, or first drop the `_fm_words_*` tables (Tabularius
builds them again on first use).
Everything else runs on one thread, so a query that must read a very large
table still delays other requests while it runs.

## Limits we don't copy

No per-user licensing, no closed wire protocol, real SQL access, standard
auth (OIDC/SSO) next to FileMaker accounts, versioned schema (git-friendly
exports), and no single-file lock-in.

## Repository layout

```
packages/fmp12   the reader library (container, chunks, schema, records)
packages/store   fmp12 -> SQLite import, find translation, record access, design changes
packages/scripts script engine (runs scripts server-side)
packages/server  Data API–compatible REST, MCP (HTTP + stdio), web client endpoints
packages/web     browser client: draws layouts, browse/find/edit (no build step)
packages/cli     tabularius command-line tool
docs/research    format notes and sources
scripts          fixture download
```
