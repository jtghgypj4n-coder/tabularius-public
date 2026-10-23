# Link and token lifetime audit — r24-10

Date: 2026-10-17. Scope: server-issued bearer URLs, authentication credentials and adjacent download addresses. This is a source audit with generated-data regressions, not a production scan. No corpus, or fixture contents were opened. No git commands, service commands, installation, upgrade or external network operations were run. Reports contain no account data, payloads, credentials, hostnames from deployments or machine paths.

Names follow Tabularius (the command, `TABULARIUS_*`, `/tabularius/` routes); data-at-rest names such as `.openhbam-*` files are unchanged. No dependencies were added. The excluded directories were not changed.

## Existing protections retained

Main already implemented HMAC container signatures, a default one-hour link lifetime, container account identity binding, hashed API/calendar credentials, account-disable checks, current privilege checks on authenticated requests, OAuth PKCE and one-use codes/refresh rotation, bounded one-use passkey challenges, clock-rollback protection, calendar `no-store`/`no-referrer`, and session-token path redaction. This change extends those mechanisms rather than replacing them.

## Findings and fixes

1. **Unbounded signed links:** zero, negative and nonnumeric TTL configuration could produce signatures without enforced expiry. `Host` now issues deadlines no later than one hour, accepts shorter positive settings, falls back to one hour for invalid settings, and refuses missing, zero, nonfinite or noninteger deadlines. A configuration change affects newly issued links; existing links retain their signed deadline. Restarting a standalone host rotates the signing key. A link signed for a deadline more than an hour (plus a minute's clock difference) ahead is refused whatever its signature, so one made before the cap, or with a leaked key, does not outlive it.
2. **Privilege reductions did not invalidate signed links:** redemption checked account existence and disable state, but retained a read capability after a privilege assignment/definition changed. Link binding now includes a SHA-256 fingerprint of the account incarnation and assigned privilege definition. Both assignment changes and edits of the existing set invalidate previous signatures.
3. **Library-image URLs were unbound:** both web layout and design image issuance now pass the selected privilege principal into the existing signing mechanism. Disabling/deleting that account refuses its image links, as for containers and thumbnails.
4. **Bearer document leakage and caching:** all server responses get `Referrer-Policy: no-referrer`. Container, thumbnail and library-image responses use `private, no-store`, including conditional responses; their routes also apply `no-store` on refusals. Already downloaded copies and previously cached responses cannot be recalled by this change.
5. **Legacy MCP name reuse:** `ohm_` credentials previously recorded only file/account names. Production authentication now requires the original active account incarnation. Old records without that binding are refused, not silently assigned to a replacement account. Reissue through Manage Security/Connect an AI app, which already issues scoped `ohbt_` tokens. New bound legacy records are supported for library callers; the server always supplies the identity resolver.
6. **Passkey registration lifetime:** registration now refuses disabled accounts and unbound registration challenges; exact five-minute expiry is refused, including malformed stored timestamps. Deleting an account removes its bound challenges, so recreating its name cannot redeem the old registration. Successful/failed ceremonies still consume their challenge. Assertion expiry shares the same boundary fix.
7. **Incomplete query redaction:** `redactPath` now covers signatures, challenges, identifiers, refresh/ID tokens and client secrets in addition to existing token/code/state fields. This is defense in depth; normal access logs already omit query strings on these routes.

## Inventory

Entropy below describes random secret bytes, not token prefix length or public IDs. HMACs have a 256-bit signing key and 256-bit output, not independent per-link randomness. “Enforced” means checked by this implementation at redemption. These are not claims about Claris behavior.

| Surface / source | Entropy and authority | Expiry, revocation, one use | Binding and account/privilege changes | Leak persistence |
| --- | --- | --- | --- | --- |
| Container and thumbnail `sig` URLs — `host.ts`, `index.ts`, `containers.ts` | HMAC-SHA256; one file and container ID; read only; thumbnail shares the container grant | Enforced signed expiry, default/max 1 hour; shorter TTL supported. Repeatable for image loads/ranges. Key rotation invalidates all links; account removal/disable denies bound links | Canonical account incarnation plus assigned privilege definition. Changes refuse old links. No address binding. Server/system callers without a persisted principal can still issue unbound links | At most signed lifetime for a newly issued link; downloaded bytes are permanent. No individual-link revoke registry |
| Library images — `webclient.ts`, `design.ts`, `host.ts` | Same HMAC; image kind, file and image ID; read only | Same enforced deadline and key rotation; repeatable | Web/design issuance now binds the selected account. Disable/delete/set edits refuse prior links | Same bounded capability; images issued by an older version without account binding last until expiry/key rotation |
| Calendar feed addresses — `calendar.ts`, `Store.createApiToken` | 192-bit secret plus random 48-bit ID; read only, one account/file/layout, `fmrest` | Optional absolute expiry enforced; absent expiry means indefinite. Revoke feed/token by ID. Repeatable for subscription polling | Current account state, surface/layout scope and privileges checked. Delete removes token; disable refuses; privilege reductions constrain returned records/fields. No address binding | **Lasting access is possible until revocation when no expiry is chosen**; only within current scope |
| Export downloads — `webclient.ts:exportRecords` | No separate secret URL. Uses session/API authorization; account/file/layout/record/field/export privilege | Generated response, no reusable download grant; credential expiry/revocation enforced on each new request | Uses live session/API authorization and current privileges | A route URL alone grants nothing; downloaded file cannot be revoked |
| Design/report/DDR and admin log/report downloads — `design.ts`, `admin.ts` | No separate bearer URL; file Full Access or server-admin authority | Authorization on each request; ordinary session/token lifetime | File account disable/revoke applies to file reports. Server-admin credentials are separate from file accounts | Route URL alone grants nothing; saved report remains readable |
| Handover memo — `assistant.ts` | No share token. Authorized POST; file Full Access; AI generation also requires AI policy/privilege | Download generated in response; no stored bearer download address | Current authorization at request start. Long-running generation is not continuously reauthorized | A saved memo is a standalone artifact, not continuing server access |
| Add-on/package addresses — `design.ts` library, `admin.ts` plug-ins, `packages/plugins/src/package.ts` | No server-issued bearer package download URL found. Library operations require design authorization; plug-in package operations use admin authorization/local files | No independent URL expiry or one-use contract applies | Route/account/admin authorization governs the operation | Public package locations supplied by users/publishers are outside this issuer inventory |
| Password reset / first sign-in — account methods in `store.ts`, `admin.ts`, `security.ts` | No password-reset/first-sign-in URL issuer found. Generated temporary passwords start with 18 random bytes (144 bits), extended for policy length | Password must be changed; reset/password replacement revokes the old password. Not a timed, single-redemption link | Account bound; inactive accounts refused. Temporary password can authenticate password-repair attempts until changed; no mandatory time deadline found | A leaked unused temporary password can remain usable until changed/reset/disabled |
| Invitation links | No invitation-link issuer found in server/store/web source; identity-provider guest invitation comments are not a local issuer | Not applicable | Not applicable | Provider invitation behavior **unverified** |
| File API / modern MCP AI-app tokens — `store.ts`, `token-scope.ts`, `mcp.ts` | 192-bit secret + 48-bit ID; account/file; read/write narrowed by optional surfaces, layouts and read-only flag | Optional enforced absolute expiry; individually revoked by ID; repeated use | Live account and delegated identity checks, current privilege checks. Account deletion removes credentials; disable refuses. Service tokens intentionally represent the mapped account, not an IdP employee session | **Indefinite if no expiry is set**, bounded by live scope/revocation |
| Legacy MCP `ohm_` — `mcp-tokens.ts`, `index.ts` | 256 bits; file/account; current MCP privileges | Optional enforced expiry and explicit revocation. Repeatable. Name-only records now refused in production | Active original account incarnation required; subsequent tools use current privileges. No IP binding | Indefinite if configured without expiry; owner must reissue old unbound records |
| OAuth authorization code / consent — `oauth.ts` | 256 bits each; client, exact redirect, PKCE challenge, file/account | Code: enforced 60 seconds; consent: enforced 5 minutes. Atomic consume before validation; no reuse | Client/redirect/PKCE checked; account/password mark and eligibility rechecked before token issuance; disabled/deleted/replaced account refused | A code alone lacks its PKCE verifier. Consent is not an API credential |
| OAuth access / refresh — `oauth.ts` | Access uses 192-bit API secret; refresh 256 bits; client/file/account, `fmmcp` | Access: enforced 1 hour. Refresh: 30 days for local accounts; federated authorization capped at 24 hours. Single-use rotation; revoke access ID or OAuth grant ends refresh | Account/password/access eligibility rechecked; disabled account refused. Refresh bound to original client; mapped person checked for federated grants | Local refresh can sustain access through continued rotation until revoked; federated grants require a fresh sign-in after their cap |
| OAuth dynamic client secret — `oauth.ts` | 256 bits; authenticates the registered client, not a user | No intrinsic expiry; registration returns zero secret-expiry; client persistence bounded by client registration limits/cleanup | No user/account binding; cannot grant file access alone | Lasting client-authentication secret; requires separate valid user grant |
| OIDC state, nonce, verifier and Data API grant identifier — `oidc.ts` | State/nonce/request ID 192 bits; verifier/identifier 256 bits. Verifier is server-side PKCE material | Pending flow: enforced 10 minutes; identifier: enforced 5 minutes. Pending/grant rows atomically consumed; provider code validated with PKCE | Provider, issuer, subject, redirect and nonce checks; file mapping/session eligibility governs resulting access. No universal IP binding | Short flow lifetime; identifier is paired with request ID. Full provider interoperability not exercised here |
| Apple OIDC client-secret JWT — `oidc.ts:clientSecret` | ES256 signed with operator-provided P-256 key; no random bearer entropy claim; client/team/issuer scope | Five-minute `exp` claim; provider enforces acceptance, not this server. New JWT generated per exchange | Application identity, no local file-account binding; operator key revocation governs | Provider acceptance/replay behavior **unverified**; never a file-access credential by itself |
| Data API / web session, including OIDC fragment token — `dataapi.ts`, `oidc.ts` | 192 bits before optional cluster routing prefix; file/account, current privileges | Default REST idle expiry 15 minutes; configurable REST/web/privilege policy. Sign-out/admin end/restart revokes. Repeatable | Account incarnation and active mapping rechecked; disabled/replaced accounts ended. No fixed requester-IP binding | Can last with activity; web policy may permit longer idle use. URL fragment removed by `history.replaceState` in `web/src/main.ts` |
| File passkey challenges — `store.ts` | 256 bits; ceremony, RP/origin; registration bound to account | Enforced 5 minutes, now exclusive boundary; consumed by attempt. Pending table swept and count bounded (existing mechanism) | Registration refuses inactive/missing/replaced accounts; assertions require an active credential-owning account. Private key stays with authenticator | Challenge alone grants nothing without signed assertion/registration context |
| Admin passkey challenge and console cookie — `admin.ts` | 256 bits each; server admin | Challenge: enforced 5 minutes, consumed once, bounded pending pools. Cookie: rolling 12-hour lifetime; sign-out/password fingerprint change/restart clears | Admin credential context, not file-account context. Cookie HttpOnly/SameSite=Strict; Secure on HTTPS. Removing a passkey does not necessarily revoke an already issued console cookie | Cookie can sustain admin access while renewed; file account disable is not applicable |
| Admin API token — `adminapi.ts` | 256 bits; server administrator | Enforced 15-minute idle deadline and 8-hour absolute maximum, explicit sign-out and admin-password fingerprint revocation; process memory | Server admin, not a file account; no IP binding | Activity extends idle lifetime only within the 8-hour maximum; file-account disable does not revoke it |
| Local admin `x-tabularius-local` — `local-admin.ts` | 256 bits; server admin; credential file mode 0600 | Process-lifecycle file; replacement/removal revokes; no wall-clock expiry | OS file-read authority, not a file account | Leak remains useful until local token file rotates/disappears |
| TOTP enrollment URI / recovery code — `store.ts`, `totp.ts` | TOTP seed 160 bits; recovery code 48 bits each, stored as hashes | Seed remains until disabled/re-enrolled; TOTP step checks prevent replay. Recovery code consumed once; regenerate/reset invalidates old set | Second-factor/account context, not a passwordless URL. Account disable still denies authentication | Leaked enrollment seed is lasting second-factor material; no auto-expiry |
| Webhook signatures — `changes.ts`, `inbound-hooks.ts` | Outbound key 192 bits; inbound key 256 bits; HMAC-SHA256 signature is body-specific | Inbound timestamp window 5 minutes plus replay memory; explicit hook rotation/disable. Outbound recipient determines replay policy | Hook/file/script authority, not a user's browser session; configured execution permissions apply | Raw header signature does not disclose signing key, but replay depends on receiver; long-lived hook secret needs rotation |
| Upload IDs — `container-uploads.ts`, `uploads.ts` | Container ID 144 bits, file-upload ID 72 bits; opaque identifiers, **not bearer credentials** | Pending upload cleanup/cancel; completion also checks permissions | Separate account/layout or server-admin authorization required | An ID alone cannot upload/read a file |

Operator-supplied replication, global MCP, upstream connection and AI credentials are accepted/transmitted by the server but are not generated bearer-link issuers. Their entropy and rotation are operator-dependent; global MCP/replication credentials have broad service scope and no file-account-disable invariant. Keep them out of URLs. No live secrets were inspected.

## Exposure by channel

| Channel | Observed behavior and limit |
| --- | --- |
| Application access logs | Data API paths redact session tokens; normal route logging uses pathname without query. Calendar logging already normalizes/drops its secret query. Expanded helper redaction covers additional query secret names. Headers are not routinely logged. This is not a guarantee against a user putting a secret into an arbitrary label or message. |
| Audit/security events | API issuance/revocation records IDs, account targets, scope and labels, not generated secret bytes. Passkey audit records credential IDs, not challenges/private keys. SCIM records issuance/revocation events, not tokens. MCP legacy metadata excludes hashes/bindings from returned listings. |
| Errors | Authentication failures use generic invalid/expired/refused messages; generated secret values are not intentionally echoed. Tests check that download denials do not echo the submitted bearer. Arbitrary downstream/provider errors were not exhaustively fault-injected. |
| Referrers | `no-referrer` is now a server-wide response default, including authentication redirects and denied links. It does not scrub infrastructure logs that already saw the incoming URL. |
| Browser history | Query-bearing container/calendar/OAuth redirects may be recorded. Response headers cannot erase history. OIDC web login uses a fragment and the web client immediately removes it. Calendar applications may persist feed addresses separately. |
| Browser/proxy caches | Container, thumbnail and image responses now say `private, no-store`; calendar/download/auth responses already use no-store where inspected. Shared proxies must honor directives. Previously saved/cache copies cannot be revoked. |
| Infrastructure / remote recipient | Reverse-proxy/CDN/APM request logs, browser extensions, calendar sync services and OAuth client callback logs were not inspected. Operators must suppress query credentials and Authorization/Cookie/local-admin headers there. |

## Owner decisions and residual limits

- **Integration expiry policy:** calendar feeds, general API/AI tokens and SCIM provisioning currently allow indefinite use. Decide defaults/max lifetime and a rotation/grace-period UX. Silently imposing a short expiry on unattended provisioners/subscriptions would break integrations; this audit records the exception rather than claiming the universal expiry invariant is met.
- **Migration:** legacy `ohm_` records lacking original-account identity, or lacking an expiry, are now refused (and listed as needing to be made again). A new one always has an expiry: 90 days unless 1 to 3650 is asked for. The one-hour cap is for signed container and image links and OAuth access tokens, not for these. Reissue as current scoped API tokens. Old account-bound signatures also change because binding now includes privileges; reload pages to obtain new URLs. Coordinate a cluster rollout because mixed-version workers will disagree on signatures. Never-expire/greater-than-one-hour container settings now issue at most one-hour links.
- **Temporary passwords:** choose a deadline for unused first-sign-in passwords. They are forced-change credentials, not strictly single-attempt or time-limited links.
- **Fine-grained revocation:** signed links have no per-link denylist or source-session/token ID. Revoking a session or API token does not revoke its already-issued container links. Account disable/set change or signing-key rotation does. Define whether token revocation must also terminate all derived links.
- **Dynamic record policy:** privilege-definition changes invalidate links, but record data used by a row-level permission expression can change without changing that definition. Links authorize a container ID, not a re-evaluated record/field path. Treat that read grant as valid until expiry unless account/key revocation intervenes; add record-context binding if stricter behavior is required.
- **Unbound/system links and external mappings:** callers without a persisted principal remain expiry-only. Mapped external users can share a mapping's link principal; an IdP employee departure is not independently checked by a container URL. Decide whether to refuse all unbound issuance and bind both person and mapping.
- **Passwords:** setting a new password for an account ends its signed links and its `ohm_` tokens made before the change (both are tied to the account row and its password), as it ends OAuth grants.
- **Restoring access:** re-enabling an account or restoring exactly the former privilege definition can make an otherwise unexpired signed URL valid again. Account deletion/recreation does not. Decide whether administrative disable/set edits must rotate a permanent capability generation even when later reversed.
- **In-flight responses:** authorization occurs before serving/generating a response. Already-started streams/thumbnail work/AI memo generation are not continuously reauthorized when an account is disabled. No new lease or asynchronous slot mechanism was added here.
- **Service authority:** SCIM, local admin, admin sessions, global MCP and replication are not tied to ordinary file accounts. A disabled file account cannot revoke these credentials by definition. Owners should distinguish service rotation from user offboarding.
- **Claris compatibility:** URL lifetimes, scope, replay, revocation, passkey behavior, invitation/reset delivery, and privilege-change behavior in Claris are **unverified** by this audit. No behavior is labelled Claris-documented; therefore no unsupported documentation claim is made. The values above are observations of this repository only.

## Second-model review (Opus 5.5) and what changed after it

A reviewer who had not seen the first pass found no forgery, replay-after-revocation or no-expiry bypass. It found, and this PR fixed:

- Five existing test files (`inactive-work`, `mcp-onboarding`, `agent-approval` twice, `agent-accounts`) minted `ohm_` tokens without the account binding the server now requires; they now bind them. The earlier verification list left these suites out.
- The privilege fingerprint was recomputed for every link (about 100 µs with 20 sets, against 8 µs before) and ran before the expiry check, so a request with no credential could trigger it. `checkUrl` now refuses a missing or past `exp`, or a missing `sig`, before looking up any account, and the fingerprint is cached per account until the security chain moves.
- A fractional `TABULARIUS_CONTAINER_TTL` such as `0.5` fell back to the one-hour maximum, which lengthened it; any positive value now applies, with a one-second floor.
- Legacy `ohm_` tokens that the server will refuse are marked `needsReissue` in the console's token list and no longer make the console report an AI app as connected. Nothing is logged on refusal and the web console does not yet display the mark; both are left for a follow-up.

Left as they are, and said so:

- **Links die on unrelated design edits for some accounts.** For a custom privilege set imported from an `.fmp12` file with per-field lists, the fingerprint includes every current field of the table, so adding a field or renaming a table changes it and ends that account's container and image links until pages are reloaded. It fails closed (no extra access); the cost is broken images after a design edit.
- **`private, no-store` also applies to OData `$value` downloads** (they share the container sender), which loses their one-hour private cache. Performance only.
- **Not covered by a test:** `no-store` on 304, HEAD, 206/416 and refusal responses (only `Referrer-Policy` is checked on refusals); malformed stored passkey timestamps; that a standalone restart rotates the signing key; links for directory or external sign-ins (bound to the mapping account); and the production resolver in `index.ts` itself (tests use copies of it).
- Pre-existing, not introduced here: the signature input is `kind:db/id@exp#name#identity`, so a hosted file whose name starts with `image:` could collide with an image link of another file; hosted file names cannot contain `:` through `create()`, but a file copied into the folder by hand could.

## Validation

Tests use generated stores, synthetic secrets, generated authenticator responses and a tiny synthetic image. No external identity provider, model service or real calendar service is contacted. HTTP tests bind loopback only. New tests contain no child-process calls. Executed test processes inherit a stub-only PATH: `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`, and `sudo` write a marker and exit 99; the runner fails if that marker exists. Builtin thumbnails are selected.

New regressions cover TTL configuration and exact expiry, configuration edits, account disable/delete/recreation, privilege assignment/set edits, image issuance, response privacy headers, legacy MCP identity/revocation, passkey expiry/one-use/registration binding, calendar/API lifetime, SCIM rotation and its explicit policy exception, OAuth PKCE code/access/refresh expiry/reuse/revocation, query redaction, and authenticated downloads.

Provider-mediated OIDC/admin-passkey end-to-end tests that require fixtures were not run; no fixture files were opened. Source inventory is not equivalent to runtime coverage of every listed service credential. The remaining policy exceptions above are intentionally not represented as passing the requested universal invariant.

## Review notes

The changed time-dependent code has exact-boundary and TTL-setting-change regressions. It introduces no new persisted collection, counter, lease, script parser, unauthenticated quota or dependency. Existing challenge cleanup/count bounds remain in place. Tests use clock injection rather than timing assertions or real expiry waits. The new regression file completed alone in 5.48 seconds, well below the per-file budget. Local paths and tool-cache references are absent from the deliverable.

An auxiliary run of `link-lifetimes.test.ts`, `adminapi-tokens.test.ts`, `session-timeout.test.ts`, and `local-admin.test.ts` returned 51 passing assertions but **failed the command guard** (exit 99): the existing admin status path calls `serverCommit()`, which attempted a git lookup and hit the stub. No real git executable ran. That status suite was excluded from the final run; the guard remained enabled. Earlier development failures (constructor syntax, synthetic account/privilege setup and a layout that omitted its container field) were corrected before final verification.

## Final verification results

All test commands below ran with `--test-concurrency=2`, builtin thumbnails and the stub-only PATH guard described above. The guard did not fire in either passing run. Results are aggregate counts only.

```sh
node --test --test-concurrency=2 \
  packages/server/test/link-lifetimes.test.ts \
  packages/server/test/container-link-account.test.ts \
  packages/server/test/session-clock.test.ts \
  packages/server/test/calendar-feed.test.ts \
  packages/store/test/clock.test.ts \
  packages/server/test/adminapi-tokens.test.ts \
  packages/server/test/local-admin.test.ts
```

**94 passed, 0 failed, 0 skipped; 26.60 seconds total.**

```sh
node --test --test-concurrency=2 packages/server/test/link-lifetimes.test.ts
```

**22 passed, 0 failed, 0 skipped; 5.48 seconds total.**

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --incremental false
```

**PASS (exit 0), 0 diagnostics.**

Not performed: fixture/corpus-dependent suites, real Claris/provider interoperability, production proxy/browser-history inspection, real service/network command execution, commits, pushes or deployment. No claim of exhaustive runtime coverage is made for the additional source-inventoried service credentials. The non-expiring service-token, derived-link-revocation and dynamic-record-policy decisions above remain open for the owner.

## Changed locations

| File:line | Change |
| --- | --- |
| `packages/server/src/host.ts:62`, `:1018` | Bounded issuance and mandatory finite signed expiry |
| `packages/store/src/store.ts:2441`, `:3817`, `:4339`, `:4371` | Privilege-aware link binding; challenge deletion, exact expiry and registration eligibility |
| `packages/server/src/webclient.ts:282`, `:728` | Image response cache policy and account-bound layout image issuance |
| `packages/server/src/design.ts:801` | Account-bound design image issuance |
| `packages/server/src/containers.ts:132`, `:211`, `:238` | Container/thumbnail no-store responses |
| `packages/server/src/index.ts:391`, `:463`, `:510` | Production MCP identity resolver, default referrer policy and refused-container cache policy |
| `packages/server/src/mcp-tokens.ts:45`, `:73`, `:106` | Persist/check original account identity; refuse unbound legacy records in production |
| `packages/server/src/server-logs.ts:69` | Additional secret query redaction |
| `packages/server/test/link-lifetimes.test.ts:1` | Generated-data lifetime and privacy regressions |
| `docs/audits/audit-links-tokens.md:1` | Inventory, findings, exposure analysis, owner decisions and aggregate evidence |
