# r30-10 — embedding in other pages

## Result and scope

**The existing app denies framing. The requested page-embedding feature is absent
from this checkout, so its token and messaging invariants are unverified.** This
is an audit with regression coverage; production behavior is unchanged, following
the task's instruction that audits are read-only unless explicitly marked “and fix”.

Searched filenames for earlier backlogs, claims folders, r27–r29 reports and
`AGENTS.md` before tracing embedding code. None were present in the permitted
checkout paths. The existing `claims-wait.test.ts` concerns synchronization, not
work ownership. Also searched existing audit reports for framing and page embeds;
no overlapping page-embed report was found. No history was consulted and no git
command was run.

The named [embed-endpoint.ts](../../packages/server/src/embed-endpoint.ts#L1)
implements outbound **AI vector embeddings**. Its `EmbedEndpoint` carries a model
URL and optional model key, not a browser capability. It was left unchanged.
Existing [static HTML headers](../../packages/server/src/webclient.ts#L524),
[admin headers](../../packages/server/src/admin.ts#L773) and
[HTTP regressions](../../packages/server/test/page-security-headers.test.ts#L24)
already provide frame denial and were retained. Existing API-token read-only and
layout ceilings in [dataapi.ts](../../packages/server/src/dataapi.ts#L145) are
reusable foundations, not evidence of an embed-token implementation.

## Expected behavior and evidence

Public sources establish browser behavior; they do not specify Tabularius token
lifetime or routes. No Claris compatibility claim is made. Short source
expressions only are quoted below.

| Boundary | Public basis / expectation | Observed or coverage |
| --- | --- | --- |
| Ordinary app cannot be framed | [W3C CSP3, frame-ancestors](https://www.w3.org/TR/CSP3/#directive-frame-ancestors): `'none'`, `DENY`; every ancestor is checked | Existing HTTP tests assert both headers. New Chromium test checks an actual blocked frame, no committed app document and no app-module requests. |
| Top-level app still loads | [W3C CSP3 navigation response check](https://www.w3.org/TR/CSP3/#frame-ancestors-navigation-response): `Allowed` for a non-child navigable | New browser test checks response headers and rendered sign-in heading. |
| Hostile parent cannot opt into framing | [W3C CSP3](https://www.w3.org/TR/CSP3/#directive-frame-ancestors): enforcement is delivered with the response | New browser test supplies query flags, an arbitrary invalid token string and malformed/command-shaped messages without a parent sandbox; app and admin documents remain blocked. This is **not** an expired-token test. |
| Parent actually supports child frames | [HTML iframe element](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-iframe-element) | A synthetic ordinary child loads before each blocked-frame test, avoiding a false pass from a broken parent. |
| Only configured origins can embed | [W3C CSP3](https://www.w3.org/TR/CSP3/#directive-frame-ancestors): ancestor origin matching | No configuration or page-embed route found. Deny-all is present; successful authorized embedding is unverified. |
| Messages validate origin and shape on both sides | [HTML cross-document messaging security](https://html.spec.whatwg.org/multipage/web-messaging.html#security-postmsg): `origin`, “expected format” | No page-embed bridge found. Blocked pages cannot exercise a bridge. Internal web-viewer messages are a separate feature and were not changed. |
| Embed cannot navigate parent or read cookies | [HTML iframe sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox): “opaque origin”, `allow-top-navigation` | No executable embed exists to test. A cross-origin frame alone is not proof of a no-navigation guarantee; future embedding needs an explicit isolation design. |
| Short-lived, layout-limited, read-only token; no admin session | Task-defined product invariant; [OAuth security BCP §2.3](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.3) gives general least-privilege guidance, not a Tabularius TTL | No embed credential flow found. Existing generic API tokens are not substituted for embed tokens. |

## KNOWN

| Unknown / gap | Status and required follow-up |
| --- | --- |
| Intended page-embed source file or unmerged earlier work | The supplied filename points to vector embeddings; no earlier backlog/claim artifact was available in this checkout. |
| Allowed-origin positive browser scenario | Blocked by missing origin configuration and page-embed endpoint. |
| Expired embed token; lifetime changes / revocation | Blocked by missing issuance and verification flow. No expiry duration was guessed and no fake expired-token test was added. |
| Layout restriction, default read-only behavior and explicit writable configuration | Unverified for embeds; generic API-token coverage is not an embed result. |
| Admin-session isolation and parent cookie access | Unverified for a working embed. Current frame denial prevents the framed document from executing, which is a narrower result. |
| Both sides of a working cross-window protocol | Unverified; no page-embed protocol found. |
| Firefox, WebKit and reverse-proxy header rewriting | Not exercised by this Chromium-only local harness. |
| Claris embedding behavior | Unverified; no Claris documentation was used to infer it. |

## Validation

Added [embedding-boundary.e2e.ts](../../packages/web/e2e/embedding-boundary.e2e.ts).
All inputs are generated, the host is empty, and browser contexts allow requests
only to the two synthetic loopback origins. Chromium inherits a stub-only PATH
for `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`, `sudo`; stubs write a
marker and exit 99. Cleanup checks that marker after closing Chromium. There are
no skipped or disabled tests, fixture reads, new dependencies or production edits.

Focused command (local listener/browser permissions required):

```sh
node --test --test-concurrency=2 --test-reporter=spec packages/web/e2e/embedding-boundary.e2e.ts packages/server/test/page-security-headers.test.ts
```

The first corrected run passed **7 tests, 0 failures, 0 skips** (6 leaf checks
plus the enclosing browser test), in 5.11 seconds; the browser test took 4.08
seconds. The final post-review run also passed **7 tests, 0 failures, 0 skips**
in 31.19 seconds; the browser test took 23.45 seconds, below the per-file target.

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
```

TypeScript passed on the final revision: **exit 0, 0 diagnostics**.
No web production source changed.

Initial sandbox run failed at loopback `listen` with EPERM before assertions
(0 pass, 4 fail). The permitted local-browser run exposed a test-authoring error:
the empty host renders a file-name input, not the database select used by populated
hosts (5 pass, 2 fail including the enclosing test). The check now waits for the
actual sign-in heading. No production bug was changed or bypassed.

A post-review run encountered a Chromium startup timeout at 15 seconds
(3 pass, 1 fail, 0 skips). The startup allowance is now 45 seconds, with a
55-second enclosing test limit; assertion timeouts remain 10 seconds. These are
harness allowances, not token lifetime assumptions.

## Independent security review

Selected reviewer model: **gpt-6-astra**, high reasoning, separate context,
read-only review of the new test/report and narrow supporting code. No blocking
security findings. One low-severity cleanup finding was fixed: the test now owns
its temporary directory before awaiting server startup, so startup rejection also
removes it. The reviewer rechecked that change and confirmed it resolved, with
no remaining findings. Review did not execute tests or independently repeat the
repository-wide search.

The reviewer also confirmed that hostile messages sent to the initial iframe
window do not test an executable app bridge; the messaging invariant remains
unverified above. This audit does not certify a working embedding feature.
