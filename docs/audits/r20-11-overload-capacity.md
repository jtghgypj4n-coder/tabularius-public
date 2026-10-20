# R20-11 overload and launch-day capacity

Measured 2026-10-17 on macOS 25.4, Apple M5 Max (18 reported CPUs), 128 GiB RAM, Node 22.22.2. All traffic stayed on `127.0.0.1`. `scripts/loadtest.ts --synthetic` generated temporary files with an Items table and 5,000 to 30,000 synthetic records; no customer or corpus file was used. Each offered-load phase lasted three seconds. The results describe this machine and workload, not a service guarantee.

## Existing limits on main

Main already bounded the Data API write queue and returned 503 with `Retry-After` for a full or expired wait (`packages/server/test/resource-limits.test.ts`). It also limited server-side scripts (`packages/server/src/server-queue.ts`) and in-flight requests per authenticated identity on individual surfaces (`packages/server/src/in-flight.ts`). Those limits remain; none was a global HTTP admission gate.

## Capacity measurements

The mixed workload kept one live-update stream per signed-in session and browsed, found, locked, edited, and unlocked records. It is closed-loop: each simulated person waits for one operation to finish before sending the next. Thus completed requests per second fall when the server slows; they are not an independent arrival-rate threshold.

| Workers | Records | Sessions | Completed requests/s | Find p95 | Sign-in p95 | 503s | Server RSS first → peak |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5,000 | 64 | 850 | 311 ms | 332 ms | 0 | 193 → 408 MiB |
| 1 | 5,000 | 96 | 629 | 805 ms | 433 ms | 20 | 200 → 393 MiB |
| 1 | 10,000 | 64 | 747 | 286 ms | 331 ms | 0 | 193 → 394 MiB |
| 1 | 10,000 | 96 | 583 | 717 ms | 438 ms | 23 | 200 → 389 MiB |
| 1 | 30,000 | 96 | 474 | 795 ms | 435 ms | 14 | 200 → 379 MiB |
| 2 | 5,000 | 96 | 1,029 | 402 ms | 272 ms | 0 | 223 → 332 MiB* |

With the recommended gate, mixed-workload p95 stayed below one second through **96 tested concurrent sessions**. At 96 sessions the gate shed 14–23 requests, depending on file size, before a one-second p95 crossing was observed. Therefore these runs do not identify a session count at which p95 exceeds one second; they identify the earlier shed point. The server's 100-token-per-process limit prevents this harness from testing more than 100 signed-in sessions on one worker. `*` The two-worker RSS sample is the worker that served metrics, not the sum of both workers.

A fixed-arrival find-only mode (`--rate`) used 16 signed-in sessions and 5,000 records. It sent the stated number of finds per second regardless of whether prior finds had finished. p95 includes 503 responses.

| Offered finds/s | Find p95 | HTTP 503 | Server RSS first → peak |
| ---: | ---: | ---: | ---: |
| 800 | 28.6 ms | 0 | 191 → 365 MiB |
| 1,000 | 105.3 ms | 60 | 190 → 395 MiB |
| 1,200 | 2,019 ms | 179 | 190 → 413 MiB |

The first measured rate with p95 over one second was **1,200 offered finds/s**, with the crossing bracketed between 1,000 and 1,200 finds/s. Shedding already began at 1,000 finds/s, so 800 finds/s was the highest tested rate without refusals. RSS rose with the number of accepted requests and open sessions, from roughly 190 MiB before traffic to 365 MiB at 800 finds/s and 413 MiB at 1,200 finds/s. The three-second samples do not establish a long-term memory leak or a steady-state memory ceiling.

## Overload behavior and recommendation

The new per-worker gate admits at most 32 short HTTP requests, waits at most 64 more for a targeted 750 ms, and answers overflow or expired waits with HTTP 503 and `Retry-After: 1`. Two slots are reserved for priority work. Sign-in, app/static assets, and metrics have priority over normal calls; finds and exports are last in the queue. One client address may hold at most three quarters of the ordinary slots, plus two priority slots. Health bypasses admission. Long-lived live-update streams use their separate stream bound and do not hold short-request slots. Queue depth and shed count appear as `tabularius_request_gate_queue_depth` and `tabularius_request_gate_shed_total`; worker metrics are summed on the cluster leader. A blocked event loop can delay the queue timer, so the 750 ms target is not a hard wall-clock response guarantee.

For this machine and the tested launch-day mix, start with **`serve --workers 2`**, **`TABULARIUS_REQUEST_LIMIT=32`**, and **`TABULARIUS_REQUEST_QUEUE=64`** (the gate defaults). The two-worker 96-session run stayed below one second at p95 without 503s. Keep at least about 1 GiB of headroom for the serving processes and remeasure with the actual solution, network, and client mix before raising the gate. More workers increase aggregate admission and memory use; they are not a substitute for measuring a real deployment.

The focused generated-data HTTP test sent 24 simultaneous requests against an 8-slot/4-waiter gate. It checked bounded health, sign-in, and static responses; a second address receiving an ordinary slot; 503 with `Retry-After: 1` and Data API code 301 for shed work; and empty queue plus successful requests after load stopped. The test took about 1.2 seconds. The test creates no child process. Load runs used a stub PATH for `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`, and `sudo`, and checked that no stub was invoked.

Limit found while merging with main: the per-address share is counted on the socket peer, not on the forwarded visitor that the edge limits use. Behind a reverse proxy every visitor therefore shares one address's share (22 of the 30 ordinary slots at the defaults), and slow request bodies hold their slots until the body is read. Tests that deliberately hold more than 22 requests from one address (`admin-resource-limits`, `edge-cluster`) raise `requestLimit` to 256. Counting the forwarded visitor, as `edge-limits.ts` does, is the follow-up; until then, behind a proxy raise `TABULARIUS_REQUEST_LIMIT`.

Claris/FileMaker Server overload scheduling and capacity for an equivalent file were not measured here; no parity claim is made.
