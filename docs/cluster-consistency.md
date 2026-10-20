# What workers agree on

`tabularius serve --workers N` runs several processes over the same files. A random-operation test
(`packages/server/test/cluster-model.test.ts`) drives 2, 3 and 4 real workers through many people's sessions and checks
every answer, every worker's copy of the record and every live-update stream against a plain model. This page lists what
that test holds, and the few places where one worker may lag behind another.

## What always holds

- A record someone is editing cannot be edited, deleted or locked by anyone else, whichever worker they reach; the
  answer is error 301 (HTTP 409 for a lock request). Two people racing for a free lock get exactly one winner.
- Each change raises the record's modification id by one. Two edits made at the same moment by different workers get
  consecutive ids; neither is lost, and the record ends with the later one's values.
- A change made through one worker is served by every worker as soon as the answer has been given. The test reads the
  record through each worker straight after each change and waits up to 2 seconds for it to agree; the slowest it has taken
  is 29 ms (one poll plus a request).
- A person who signs out lets go of their locks.
- A script that edits takes the record's lock for the edit and lets go of it afterwards; if the person already holds
  the lock, the script uses it and leaves it held.
- Deleting a record lets go of its lock and says so (`unlock`, then `delete`), so no window keeps a "locked" mark on an
  id that is made again.
- Unlocking a record the caller does not hold changes nothing and answers `{"released": false}`.

## What may lag, and the bound

| What | Window | Bound the test holds | Why |
| --- | --- | --- | --- |
| Another worker's copy of a changed record | none seen; one request in the worst case | 2 s | Each worker reads the shared file; its record cache is dropped when the change is announced |
| A live-update stream hearing a change | milliseconds | 2 s | The change is announced to every worker, which writes it to its streams |
| Order of two events for changes made at the same moment on different workers | either order | not ordered | The events are sent from two processes; windows re-read the record rather than applying the event, so the later modification id wins either way. Changes made one after another are always heard in order |
| A lock whose worker was killed | the lease, 60 seconds | `LOCK_TTL_MS` | The lease is the only record of who holds it; `cluster.test.ts` covers the kill |
| Changes made while a stream was disconnected | until it reconnects | the window refreshes on reconnect | Streams do not replay |

Not driven by the test: importing records, records changed on disk underneath the server, and more than four workers.
