# SQL statement deadline feasibility on Node 22

The proposed opt-in HTTP SQL and pgwire deadline cannot safely use a
`worker_threads` pool with `node:sqlite` on Node 22. This note records the
stopped prototype; no deadline option or changed endpoint behavior is shipped.

## Blocking observation

A worker ran an unbounded recursive CTE through `DatabaseSync.prepare(...).get()`.
The main thread called `worker.terminate()` 100 ms after starting the query.
The terminate promise was still pending two seconds later, and the Node process
remained alive until interrupted. A focused pgwire prototype returned a timeout
and answered subsequent queries, but its test process continued consuming CPU
after the assertion passed. This is consistent with termination waiting for the
native synchronous SQLite call to return; it cannot preempt that call.

The main thread can send a timeout response on schedule, but each runaway
statement would leave a worker executing and holding resources. Replacing that
worker could accumulate unbounded live threads and reads under repeated
requests. That fails the required server recovery guarantee.

A bare read-only `DatabaseSync` in a worker also does not itself reproduce the
current `Store.select()` path. The store performs read-only and internal-table
checks, parameter checks, query-function registration, and design refresh;
HTTP SQL and pgwire perform translation and live privilege checks before
`select()`. A valid off-thread implementation must share those behaviors,
including pgwire catalog functions and typed results. The stopped prototype
preflighted with `Store.describe()` in the main thread, but worker termination
alone is sufficient to reject this architecture.

## Proposed alternative

Use a small pool of **child processes** for deadline-enabled SQL. Each child
would open the store file read-only and run the same shared query executor used
by `Store.select()`. The parent would perform the existing translation and
privilege checks immediately before dispatch, enforce a deadline that includes
queue time, and send a timeout response (HTTP error code 8311; pgwire SQLSTATE
`57014`). On expiry or PostgreSQL CancelRequest, it would kill the child
process and start a replacement. An operating-system process kill can stop a
thread blocked in a native SQLite call; this must be verified on the supported
platforms before implementing the endpoints. This would add process memory and
IPC overhead, so measure warm-pool latency and memory against the current
in-process path before setting a default. Leave the feature off by default.

Pgwire's current `BEGIN`/`COMMIT` and settings are server-side session state;
pgwire does not expose uncommitted writes. A future executor should explicitly
keep any query depending on uncommitted state in-process so it can preserve
read-your-writes. Tests should cover result and privilege parity, recursive CTE
termination, replacement after a kill, simultaneous short queries, and both
simple and extended pgwire cancellation.
