# r25-08: cross-origin invariant audit and fixes

Date: 2026-10-17. Scope: the HTTP route table, ambient credentials, browser isolation, and the fixes below. No hosted corpus or fixture files were opened. All test data was generated. This report contains aggregate results, route names and source references, not records, credentials or local machine paths.

## Prior work and inventory

Read first: `SECURITY.md`'s cookies/CORS section and `packages/server/test/security-cookies-cors.test.ts` (the r17 security-documentation work), plus `docs/remote-connector-exposure.md`, `docs/threat-model.md`, and existing MCP/public-origin tests. The exposure document explicitly says “a plan only”; the threat model still calls r20-07 future work. No completed r20-07 live-exposure report was found in this checkout. Its execution is not claimed here.

Main already had Strict, HttpOnly admin cookies, a mutation header, password/passkey authentication, an Admin API login Origin/Fetch Metadata check, a MCP Origin allow-list with Host restrictions, credentialless OAuth CORS, denied WebSocket upgrades, and framing restrictions. These were retained. The r17 cookie/CORS test now runs against an empty generated host instead of depending on a fixture.

[The generated route inventory](r25-08-cross-origin-routes.md) lists all **436** route-table method/path entries: **255** non-GET/HEAD and **181** GET/HEAD. It includes public reads as well as protected reads, so filtering by verb cannot hide a data-bearing or stateful GET. It supplements the table with **13** OAuth/MCP entries read directly from their dispatchers. Combined action placeholders remain route families, not a claim that every parameter value was exercised.

`scripts/audit-cross-origin.ts` reproduces that inventory. A regression checks its exact match to the current table; the existing reference tests also check route-expression coverage against server source. The browser probes **152** console entries and **266** file/API/capability entries with a cross-origin console cookie. Generic mutation bodies are intentionally omitted: each probe must fail before any dangerous handler can act. Public shells, identity-provider callbacks and explicit protocol capabilities have the exceptions below.

## Findings fixed

1. **Logout bypassed its documented mutation-header requirement.** The sign-out handler ran before the shared console mutation check. It now requires `x-tabularius-admin: 1` before revoking a session or clearing its cookie. Regression checks verify a failed logout preserves the session and emits no clearing cookie; a valid logout revokes it.
2. **Ambient request context was not checked consistently.** Console reads/writes and Basic-capable file routes now share `sameOriginRequest`, dispatched before authentication, body parsing and side effects. Cross-origin or opaque Origin, foreign Referer when Origin is absent, and Fetch Metadata other than `same-origin`/`none` fail. Admin API login uses the same helper while retaining its API error shape. OAuth authorization POST and originless non-bearer MCP requests also receive the guard. Session creation cannot bypass it by adding an unrelated token header.
3. **Missing browser provenance could still authenticate console GETs.** Different-model review identified plain HTTP without Origin/Referer/Fetch Metadata. A same-site browser can send the Strict cookie in that case. Cookie and console Basic requests now need `x-tabularius-console: 1` or `x-tabularius-admin: 1` when all provenance is absent. This also protects the conversion-guide GET, which can generate/save a guide and optionally invoke the configured assistant. The regression proves that its generator is not called. The console page's Referrer-Policy is now `same-origin`, preserving proof for its download/new-window links without sending referrers to other origins.
4. **Trusted Host configuration must survive TLS termination.** Arbitrary DNS Host/Origin equality is not trust. Without an explicit public URL, only IP literals, localhost names and operator-configured HTTPS origins qualify. The cluster front passes those HTTPS origins to workers in a dedicated internal option. External MCP caller origins never become console origins. Regression covers reconstructed worker options, accepted operator origins and rejected MCP-only origins.

Both cookie names accepted by the compatibility layer are protected. Legacy routes/headers are canonicalized before the shared dispatcher guard. No data-at-rest names changed.

## Browser and protocol evidence

| Case | Observed result / assertion |
| --- | --- |
| Different-origin credentialed simple fetch and no-cors POST | Actual console response is 403, not merely an unreadable successful response. |
| Form POST between sibling subdomains | Strict cookie is present; sign-out is 403; session survives. |
| JSON/custom-header mutation | OPTIONS is denied; browser sends no actual mutation. |
| Same hostname, different ports | Cookie is sent (`same-site`); request is denied as cross-origin. |
| localhost versus 127.0.0.1 | Strict cookie is absent (`cross-site`); request is still denied. |
| Plain HTTP, same hostname/different ports, no-referrer no-cors GET | Cookie is present, all three provenance headers are absent, and the server returns 403. The browser reaches the server; local-network blocking is not mistaken for server protection. |
| Sandboxed opaque origin | Real sandboxed iframe sends a POST that receives 403. Raw Origin-null probes are denied too. |
| Origin/Referer/Fetch Metadata combinations | Raw tests cover foreign/opaque/malformed/list origins, different scheme/port/host, foreign Referer, same-site/cross-site/invalid Fetch Metadata, missing metadata, public URL and forged forwarded headers. |
| DNS name resolving to loopback | Chromium uses a resolver mapping; same-origin requests under that unconfigured DNS name receive 403. Raw HTTP tests preserve Host, including no-Origin probes. This tests Host policy, not DNS TTL rebinding or a live DNS service. |
| Bearer SSE | Same-origin fetch with a real synthetic file-session token opens the live stream; abort closes it. |
| EventSource | Console cookies cannot open protected live/MCP/console streams; adding a file token to the live URL query does not authenticate it. Live streams require the supported header token. |
| WebSocket | Browser connection fails; `edge-limits.ts` rejects Upgrade with 400. No WebSocket application endpoint exists. |
| Framing | Chromium rejects admin, app and docs frames. Their CSP includes `frame-ancestors 'none'`; X-Frame-Options remains DENY. |
| Logout | Hostile requests do not revoke the session. Same-origin logout with the mutation header does. |
| OAuth preflight cache | Two noncredentialed JSON POSTs to registration cause one OPTIONS and two actual requests. Credentialed CORS fails, and that cache entry does not authorize console sign-out. |
| Origin reflection, null, wildcard, Vary | OAuth returns a constant `*`, including to null-origin preflights, with no Allow-Credentials; no origin is reflected. Console/file APIs grant no CORS access. A constant wildcard needs no `Vary: Origin`; guarded denials and sensitive console responses are no-store. |

The harness uses installed Chromium through the existing Playwright dependency, local HTTP servers and fresh profiles. It does not intercept requests for the CORS/cache tests, disable CORS or add an external service. Its child-process PATH contains only command stubs; `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl` and `sudo` write a failure marker and exit 99. The marker must remain absent. No service/install/upgrade/git-pull commands run.

## Explicit exemptions and boundaries

The route inventory labels every exemption. Authorization still applies; being exempt from an ambient-credential check is not permission to act.

| Class | Routes and reason |
| --- | --- |
| File bearer/header tokens | Authenticated Data API reads/writes and scripts; `/tabularius/app/`, live, changes, design, debug, security, assistant, automations, cleanup, dashboards, digests and agent routes require a file session/API token. Cookies cannot supply it. SQL/OData/XML token authentication is likewise explicit. A bearer/header-token request can reach these handlers, but no CORS grant lets another website read it. |
| Server bearer tokens | FileMaker Admin API routes after login, SCIM and replication require their own explicit tokens. Console cookies and local implicit admin authority do not substitute. |
| MCP | Any Origin is still checked by the existing MCP allow-list, public URL or constrained same-origin fallback. Originless bearer clients retain native access. Originless Basic/local calls receive the new context check. Cookies alone do not establish MCP identity; a same-origin direct loopback call can use the existing local-authority policy when no server token is configured. |
| URL capabilities | Container/layout-image URLs require signatures. Calendar subscription URLs require a read-only API token scoped to one layout. Data API session deletion takes the session token in its path. Possession is explicit, not supplied by the browser cookie jar. These URLs must still be kept private. |
| Inbound hooks | A configured webhook secret/signature authenticates the request; a console cookie does not. |
| OAuth | Registration is intentionally public. Token/revoke require possession of protocol credentials; authorization POST requires same-origin context and account proof. Discovery and registration/token/revoke have credentialless wildcard CORS. Authorization GET shows the sign-in flow and may initiate OIDC; it does not grant a console-cookie account. |
| OIDC | Cross-origin provider callbacks are intentional and use the existing pending state/nonce/PKCE and one-time grant checks. They cannot be replaced by a blanket same-origin filter. The live external-provider flow was not exercised here. |
| Public documents and navigation | Health, static application/admin shells, docs, certificate trust material, discovery and explicitly enabled file listings are public. `/fmi/webd/{database}` redirects to the app; URL-requested scripts subsequently require a file session and the `fmurlscript` privilege. This opt-in URL automation is not claimed to be a rejected cross-origin navigation. |

**Residual native Basic read ambiguity:** SQL, XML and OData must accept native Basic clients without browser provenance headers. Such a GET is indistinguishable from a plain-HTTP browser GET with suppressed Referer and no Fetch Metadata. Their read-only handlers can therefore serve it. SOP/CORS prevents an attacking script from reading a cross-origin fetch response, but navigation, downloads, timing effects and server-side read work remain possible. This is an explicit exception to blanket server-side rejection of every cross-origin data GET, not a claim that Origin alone solves it. Console Basic GETs do not have this exception. Strict rejection for those file protocols would require a new mandatory native-client proof or removing their Basic support; neither protocol change was introduced in this item.

## Compatibility and review

For DNS-hosted ambient access, configure `--public-url` or use operator-configured `--https` domains. Unconfigured arbitrary DNS names are refused. Native console cookie/Basic requests lacking all browser provenance must send one of the console/admin headers; direct bookmarks to protected HTTP API/download URLs can consequently be denied. Opening `/admin/` and using its links retains provenance. Native file Basic clients and bearer clients remain supported.

An independent read-only review by a different model found the missing-provenance case and the cluster HTTPS-origin propagation regression. Both received fixes and regressions. Its remaining native Basic read boundary is disclosed above. No review ran git, contacted another person, opened hosted data or changed files.

Whether the original product has behavior corresponding to these Tabularius-specific origin/cookie policies is **unverified**. This report makes no claim that it documents or implements these policies. <!-- known-difference: Privileges and security ;; Whether the original product applies the same origin and cookie rules to its browser-facing routes is unknown ;; Tabularius refuses cross-site requests that carry saved credentials, whatever the original does ;; A run of the same cross-site requests against the original server -->

Public references used for browser semantics:

- [WHATWG Fetch Standard, CORS protocol and credentials](https://fetch.spec.whatwg.org/#cors-protocol-and-credentials): credentialed responses cannot use the wildcard grant. Its [HTTP-cache guidance](https://fetch.spec.whatwg.org/#cors-protocol-and-http-caches) distinguishes a constant wildcard from origin-dependent responses requiring `Vary`.
- [W3C Fetch Metadata Request Headers](https://www.w3.org/TR/fetch-metadata/): distinguishes `same-site` from `same-origin`; metadata is a defense in addition to origin/proof checks, not authentication.
- [W3C Content Security Policy Level 3, frame-ancestors](https://www.w3.org/TR/CSP3/#directive-frame-ancestors): the directive restricts which ancestors may embed a resource.

## Reproduction and limits

Run the scoped checks with no fixture dependency:

```sh
node --test --test-concurrency=2 packages/server/test/{cross-origin,cross-origin-browser,security-cookies-cors,page-security-headers,adminapi-tokens,mcp-origin,reference-docs}.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
node scripts/audit-cross-origin.ts --check
```

Final results: **53 passed, 0 failed, 0 skipped**, including **10 browser subtests**, in **3.77 seconds** for the combined test command. TypeScript completed with **0 diagnostics**. The inventory check passed. Earlier development failures were harness defects (Node mock-env availability, Host normalization, browser navigation/auth-dialog handling and request interception), a sandbox loopback-listen restriction, and the reviewer-discovered cases; they were corrected rather than skipped. The final browser file runs well below its 60-second budget, and its waits have more than threefold headroom over observed completion.

Not performed: a live exposure review, external DNS rebinding, TLS certificate issuance, a live identity provider, other browser engines, fixture/corpus-dependent suites, deployment. The native Basic read exception above prevents claiming universal server-side rejection for all data GETs.

## Real-browser check

`packages/web/e2e/cross-site.e2e.ts` does the central case in a real browser: a page on another site cannot use the browser's saved login to change data. A control request from the server's own page, with the same saved login, shows the login works, so a refusal is the guard and not a failed login. A page on another port of the same host is refused too.
