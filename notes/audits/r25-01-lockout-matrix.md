# r25-01 — Sign-in lockout matrix

## Baseline and scope

The requested `docs/audits/audit-auth.md` is absent from this checkout, and no separately named r6-01 report was found. The existing password-spraying and passkey-throttle/address-unlock implementation was read first in `sign-in-failures.ts`, `store.ts`, `admin.ts`, and `signin-lockout-retry-after.test.ts`. Existing protections and tests were retained. Local documentation used: `docs/moving-a-solution.md` (Lockout), `docs/text-comparison.md`, `docs/remote-connector-exposure.md`, and `docs/clock-audit.md`.

This report describes Tabularius behavior. Claris parity for these limits, address/name folding, restart behavior, and response timing is **unverified**; no undocumented Claris behavior is inferred. No corpus or fixture contents were opened. Tests use generated stores, generated authenticator keys, and loopback sockets. No new dependency, service command, installation, upgrade, external network request, or child-process launch was added to the tests. No git commands were run.

## Rules exercised

- File credentials: five failed attempts per folded account and canonical full address within fifteen minutes; a fifteen-minute lock starts at the threshold. A different address retains its own account budget.
- Password spraying: thirty failures across names in one file and IPv4 address or IPv6 /64 within fifteen minutes; passwords, passkeys and recovery failures share that budget. A success clears its account counter but does not replenish the address budget. A blocked password retry also counts toward the address budget.
- Loopback and unknown proxy visitors retain the existing shared-address-budget exemption. Account budgets still apply. Visitors behind an unconfigured or untrusted proxy share the unknown account/address identity; visitors behind a NAT share its address budget. These are explicit limits on isolation between legitimate users.
- The console uses a separate five-failure budget per IPv4 address or IPv6 /64, shared by console password/passkey sign-in, Admin API password authentication, and console Basic authentication on backup/restore endpoints. File locks do not lock the console, or vice versa.
- Existing authenticated cookies, session tokens, SCIM provisioning tokens, and OAuth code/refresh credentials are not password guesses. They retain their independent authentication checks. OAuth password grants are unsupported; the authorize form is the password route. Token exchange covers Admin API password-to-token issuance and OAuth code/refresh exchange.
- Counters are volatile and bounded by the existing file limiter. Restart/fresh Store state resets counters; historical audit events remain. This change does not introduce lock persistence or a distributed limiter. Multi-process restart/cluster behavior is not claimed.
- Elapsed time determines expiry. Wall-clock changes affect only presented deadlines. Editing the failure window expires eligible counters, while changing the configured lock duration does not shorten an already issued lock.

## Fixes

1. **Equivalent IP spellings.** Main already canonicalizes the client address before account keys and address grouping (`client-ip.ts`). The remaining gap was the check for this computer and unknown visitors, which compared the raw spelling: `::ffff:7f00:1` or `0:0:0:0:0:0:0:1` would have spent a shared address budget that `127.0.0.1` and `::1` are exempt from. That check, the shared-source test and the sign-in challenge allowance now use one canonical spelling.
2. **Forwarded loopback spellings.** Already handled on main: a loopback address in a trusted proxy's header, in any spelling, is refused before authentication. The boundary test now asserts that refusal.
3. **A successful asynchronous hash crossing a newly issued address lock.** Already handled on main (the address budget is rechecked before an account counter is touched). Store, HTTP session and pgwire tests start a real password hash, exhaust the address budget before its callback, and verify rejection.
4. **Timer expiry lacked a file-lock audit event.** Expiry now emits one existing `lockout-cleared` event with `via: timer`, distinguishing account and address scope and second-factor locks. Expiry is observed lazily during the next limiter operation, not by a background timer, so the event carries `expiredAt`, the time the lock actually ended. The sweep runs inside sign-in checks, so recording never throws out of one: if the file is held by another session's transaction, busy or read-only, the event waits in a bounded list (256) and is written by the next lock check or unlock. An administrator's address or account unlock after expiry first observes the expiry, so the timer event is kept and no admin-clear event is claimed when only the timer cleared the lock.

Left as main has it: a wrong password that completes after its address was locked is not counted toward the account, because a locked address must not admit new entries. Only attempts already in flight when the lock was issued can complete that way.

## Coverage

| Surface or invariant | Evidence |
| --- | --- |
| Data API Basic, web sign-in, OData, XML publishing, SQL, MCP, OAuth authorize password, passkey second-factor password | Parameterized HTTP matrix verifies the account threshold, both final address-budget increments, known/unknown response parity, and attempts split across routes. Secondary Data API credentials are checked against the target file budget. The Store matrix exercises the complete address budget; HTTP tests seed its middle to avoid redundant expensive hashes. |
| pgwire/SQL | Real startup/password exchanges, mixed Store/transport failures, parallel bursts, known/unknown locked SQLSTATE/message equality, legitimate sign-in from another address, unlock, and delayed-success rejection. |
| Passwordless passkey and recovery | Complete address-threshold runs, locked response equality, Retry-After, and refusal of a password sign-in after the same address is blocked. Existing passkey enumeration/challenge-budget tests are retained. |
| Admin console, console passkey, Admin API token issuance, backup/restore | Generated passkey registration; failures split across all password gates; locked responses include Retry-After. Existing authenticated cookie/Admin API token access and file/console budget isolation are asserted. Backup/restore calls are rejected at authentication and do not perform a backup or restoration. |
| SCIM and OAuth token exchange | Invalid-token/code rejection, SCIM hosted/unhosted refusal equality, unsupported password grant, one-use authorization code, refresh, and valid bearer access during a file password lock. |
| Forwarded address headers | All three supported headers; configured and unconfigured trust, configured CIDR and untrusted peers, equivalent IP spellings, forged loopback, and unknown-client behavior. |
| Account variants | Case, Unicode compatibility/canonical normalization, ignorable characters and spaces share the established lockout fold. Trailing dots, cross-script confusables and literal percent escapes remain separate lookup names, still subject to the address budget. OAuth form percent decoding is exercised. No lookup alias is invented. |
| Concurrency and time | Parallel failures, deterministic check/completion races, slow attempts outside the window, edited durations, wall-clock jumps, exact expiry, and fresh-instance restart behavior. |
| Unlock and isolation | Account and equivalent-address admin unlocks, no-op unlocks, timer expiry, expiry immediately followed by admin unlock, and audit-event counts/scope. Other addresses/networks and existing authenticated sessions remain usable under the stated rules. |

Response tests compare status, body and every response header except HTTP Date. OAuth's echoed submitted account form value is normalized; it is caller input. Frozen injected clocks make lock deadlines exactly comparable. Timing checks interleave known and unknown attempts and allow a median difference of three times the faster median plus 100 ms of scheduling noise. This broad tolerance provides at least 3× headroom; it is a regression guard, not proof against statistical timing analysis. Pgwire compares SQLSTATE and message because it has no HTTP headers.

## Verification and review

The selected suites below pass on this branch. Fixture-dependent suites are not part of the selected run.

```sh
node --test --test-concurrency=2 \
  packages/store/test/lockout.test.ts \
  packages/store/test/lockout-matrix.test.ts \
  packages/store/test/passkey-enumeration.test.ts \
  packages/server/test/lockout-matrix.test.ts \
  packages/server/test/lockout-data-routes.test.ts \
  packages/server/test/lockout-tool-routes.test.ts \
  packages/server/test/lockout-auth-routes.test.ts \
  packages/server/test/lockout-boundaries.test.ts \
  packages/server/test/pgwire-lockout-matrix.test.ts \
  packages/server/test/signin-lockout-retry-after.test.ts \
  packages/server/test/host-lockout-pairs.test.ts
```

Earlier runs caught test setup/count assertions, noisy timing under load, and a combined matrix exceeding the deliberately strict 60-second test timeout. Those issues were corrected: all responses use identical frozen presentation clocks; timing assertions retain 3× plus 100 ms headroom; idle HTTP sockets are closed at teardown; and the credential matrix is divided into three small route groups. The final selected suites pass with real password hashes. Across the seven new test files, the largest sum of reported test-body durations is 18.2 seconds (process startup is excluded).

Typecheck command:

```sh
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

The new tests launch no child processes, so the child-process stub-PATH requirement is not triggered.

This port has had no security review yet. An earlier read-only review of the original change found that an administrator's address unlock after expiry could delete the entry before the timer event was written; the sweep-before-remove step in fix 4 and the two expiry-then-unlock cases cover it. The review did not audit unrelated route implementations.

## Limits

The absent auth audit could not be read. No Claris server, real identity provider, distributed deployment, process/service restart, browser, or production corpus was exercised. The restart test models lost process state by opening a fresh Store; it does not launch a child process. Passkey challenge payloads necessarily contain fresh challenges and credential identifiers; exact byte parity assertions target authentication refusals, not challenge issuance. Existing password-verification caches and bearer credentials remain governed by their established validity rules.
