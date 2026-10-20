# r31-01 — Client address attribution

Completed implementation and a separate-model security review. No git commands, commits, pushes, dependency additions, workflow edits, fixture access, or corpus access were performed. Tests use generated stores, synthetic addresses and local sockets. This report records aggregate results only.

## Existing work retained

The initial filename/content searches found no claims folder or r27–r30 backlog documents in this checkout. The existing `docs/audits/audit-edge-limits.md` describes the edge foundation retained here: explicit proxy IP/CIDR configuration, connection admission, bounded serialized pipelining, and worker transport. Existing store limits already intended IPv6 /64 grouping; this change fixes spelling/mapped-address gaps rather than adding a competing system. No comparison with another checkout or commit was attempted.

## Changes

| Location | Result |
| --- | --- |
| `packages/server/src/client-address.ts:22` | Require explicitly configured trusted addresses, including loopback. Validate IP/CIDR settings and walk selected forwarding headers from the right across trusted hops only. |
| `packages/server/src/client-address.ts:38` | Validate complete lists, node syntax, ports, brackets, quoted Forwarded parameters, escapes, duplicates, control characters and zones. Canonical socket fallback on malformed input. |
| `packages/server/src/client-address.ts:124` | Snapshot canonical attribution and trusted-forwarding provenance per request, so later requests on a reused socket cannot rewrite earlier audit identities. Kernel scope suffixes are normalized separately from rejected header zones. |
| `packages/store/src/client-ip.ts:4` | Shared canonical IP and IPv4/IPv6 /64 key functions; normalize padding, compression, case and both mapped IPv4 spellings. |
| `packages/store/src/sign-in-failures.ts:97` | Account-specific lockout keys also use the shared address bucket. Existing counters, expiry behavior, bounds and exemption policies remain in place. |
| `packages/server/src/edge-limits.ts:40` | Both direct admission and trusted proxy responses use shared /64 buckets; invalid forwarding still consumes a socket-address bucket. Existing release paths retained. |
| `packages/server/src/index.ts:472`, `packages/server/src/cluster.ts:525` | Reject a configured proxy's missing, malformed or loopback-resolving attribution before application authentication; treat an unconfigured loopback peer's forwarding headers as an unknown visitor. The socket fallback must not grant local-only/blank-password privileges or local budget exemptions. |
| `packages/server/src/cluster.ts:375` | Front overwrites internal address/provenance headers; workers restore request snapshots without resolving the external chain again. |
| `packages/server/src/admin.ts:723` | Proxy challenge reserve requires validated forwarding provenance. |
| `packages/server/src/oauth.ts:257`, `packages/server/src/account-provisioning.ts:41` | OAuth registration and account-import IP budgets use the same canonical /64 key. |
| `packages/server/src/metrics.ts:160` and HTTP attribution consumers | Metrics, audit, authentication and allow-list paths read the request snapshot. Consumers updated in admin, Data API, SQL, OIDC, OAuth, replication, calendar and inbound hooks. |
| `docs/security-defaults.md:67` | Public references, trust/migration instructions, strict acceptance policy, /64 grouping, worker semantics and KNOWN table. Generation source lives in `packages/server/test/security-defaults-table.ts`, included by `scripts/security-defaults.ts`. |

Tests cover hostile header tables, repeated fields, mixed address families, a three-proxy chain, direct and forwarded /64 admission, mapped equivalents, malformed fallback accounting, reused sockets, delayed metrics, actual worker handoff, local-only access, cross-route lockouts, proxy reserves, OAuth and account-import rotation. Former fixture-dependent client/admin coverage now uses generated data without skips. Worker-spawning tests install a PATH containing marker-writing, exit-99 stubs for launchctl, systemctl, sc, git, npm, curl and sudo; a marker fails the test.

## Standards and expected values

The complete input/result matrix and links are in [security defaults](../../docs/security-defaults.md#client-address-attribution). References checked:

- [RFC 7239 §§4,6,7.1,8.1](https://www.rfc-editor.org/rfc/rfc7239): Forwarded grammar, node forms, ordered field lists and trust boundaries.
- [MDN: X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For): right-to-left trusted-list selection and repeated-field order.
- [nginx ngx_http_realip_module](https://nginx.org/en/docs/http/ngx_http_realip_module.html): configured replacement headers and recursive trusted-address traversal.
- [RFC 5952](https://www.rfc-editor.org/rfc/rfc5952) and [RFC 4291](https://www.rfc-editor.org/rfc/rfc4291): IPv6 representation, mapped addresses and prefixes.

The /64 abuse-limit choice, port range restriction, rejection of zones/empty or obfuscated elements, missing-header HTTP 400, and loopback safeguards are explicit Tabularius policy. They are not represented as RFC-mandated response values or Claris behavior.

## Different-model review

A read-only `gpt-6-astra` review found one high-severity issue in the initial implementation: malformed or missing forwarding through a local proxy fell back to loopback and could acquire local account privileges and address-budget exemptions. Fixed by preserving socket attribution/accounting while rejecting unsafe requests before authentication, in both server modes. Regression tests cover local-only sign-in and credential-free admin/MCP paths. Follow-up reviews confirmed the fix and the final control-character, socket-scope and account-import changes, with no remaining blocking findings. The reviewer independently passed all 13 parser/snapshot tests.

Compatibility consequence: loopback proxies now require explicit trust. A configured proxy peer must provide a valid selected header. Direct local callers sharing that address need a separate listener/configuration. Forwarded loopback identities are rejected before authentication. Forwarding headers on a loopback connection nobody configured as a proxy are not rejected: that visitor is unknown (never this computer) and authentication answers it, so an unconfigured same-machine reverse proxy keeps working without local privileges. The 400 carries a plain-text reason and a log line (at most one a minute).

## Verification

All commands ran from the worktree. Final runs have **87 distinct passing tests**, **0 failures**, **0 skips**; the route file appears in two batches. Each entire batch finished below 60 seconds, so every included file did as well. No timing threshold was reduced. The sandbox initially denied local listeners; authorized local-socket reruns succeeded. An intermediate MCP expectation was updated from the old authentication refusal to the intentional pre-authentication rejection and the full affected file passed again.

| Command | Pass | Fail | Skip | Batch elapsed |
| --- | ---: | ---: | ---: | ---: |
| `node --test --test-concurrency=2 packages/server/test/client-address.test.ts packages/server/test/edge-transport.test.ts packages/server/test/edge-cluster.test.ts` | 37 | 0 | 0 | 28.4 s |
| `node --test --test-concurrency=2 packages/server/test/admin-hardening.test.ts packages/server/test/client-address-routes.test.ts packages/server/test/signin-lockout-retry-after.test.ts packages/server/test/admin-lockout-address.test.ts` | 33 | 0 | 0 | 36.2 s |
| `node --test --test-concurrency=2 packages/server/test/client-address-routes.test.ts packages/server/test/account-provisioning.test.ts` | 10 | 0 | 0 | 27.4 s |
| `node --test --test-concurrency=2 packages/store/test/lockout.test.ts` | 10 | 0 | 0 | 6.5 s |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false` | 1 check | 0 | — | — |
| `node --no-warnings scripts/security-defaults.ts --check` | 1 check | 0 | — | — |

## KNOWN / not established

| Item | Status |
| --- | --- |
| Claris proxy trust, malformed-header responses and IPv6 limits | Unverified; no claim of documented parity |
| Real proxy configuration and alternate network ingress | Not tested; operator-specific |
| All counters globally aggregated across workers or hosts | Not added; keys agree, existing counter scope/routing is retained |
| Complete repository/fixture/corpus suite | Not run; focused synthetic suites and root TypeScript check passed |
| Earlier backlog/claims outside this checkout | Not available in the supplied worktree |
| Commit, push or PR creation | Not performed, as instructed |
