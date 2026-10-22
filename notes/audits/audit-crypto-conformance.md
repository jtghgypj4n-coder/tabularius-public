# Tabularius crypto and protocol conformance — r22-01

Date: 2026-10-17. This is a bounded source audit and executable conformance check, not a cryptographic certification.

## Scope and work dropped

The first search was `git grep` against `main` for crypto primitives, TOTP, PKCE, OIDC, WebAuthn and SigV4, excluding the protected directories and prohibited data names. The working branch already contains additional committed changes; these were preserved.

Dropped reimplementation of password hashing, encryption formats, TOTP, PKCE, code consumption, refresh issuance, passkey verification and SigV4: all already exist. Existing tests already covered two SHA1 TOTP timestamps, basic WebAuthn ES256 ceremonies, two AWS signing vectors, a published S3 signature, HMAC case 2, and several encryption round trips. Reused safe generated-input tests. Added the missing vector tables and rejection cases; the S3 example is repeated in the new generated-only suite because its original test file also opens fixtures.

No dependencies, commits, pushes, tags, publishing, workflow edits or protected-directory changes. No private database/corpus data was opened. All network services exercised by tests are fakes bound to `127.0.0.1`. Published vector request hostnames are signed as strings, never contacted.

## Findings fixed

| Finding | Change | Regression evidence |
| --- | --- | --- |
| Malformed stored scrypt digest could decode to zero bytes and compare equal for any password; truncated digests also reduced verification strength | Require exactly three fields, canonical base64, a 16-byte salt and a 32-byte digest in both sync and async paths. Existing valid hashes and cost are preserved. Exploitation requires a malformed stored verifier. | `store/test/crypto-conformance.test.ts`: password verifier rejects empty, shortened, noncanonical and extra hash fields |
| Secret comparisons in MCP/admin-token routing, replication and OAuth checked JS character lengths before comparing UTF-8 buffers, allowing malformed input to throw | Shared byte-length guard before `timingSafeEqual` | `server/test/crypto-protocols.test.ts`: constant-time secret comparison checks UTF-8 byte lengths |
| OIDC accepted an algorithm label independently of the actual signing key | Bind RSA/EC type, P-256/P-384 curve, JWK `alg`, `use` and `key_ops`; preserve the explicit RS256/384/512, PS256, ES256/384 allow-list | `oidc-conformance.test.ts`: algorithm/key binding and every allowed algorithm |
| OIDC accepted RSA keys below the JWA minimum | Require at least 2048 bits | `oidc-conformance.test.ts`: RSA signing key below the RFC 7518 minimum |
| OIDC ignored critical JOSE extensions and permissively decoded malformed compact inputs | Reject unsupported `crit`/`b64`, noncanonical base64url, non-object JSON, invalid UTF-8 and invalid `kid` types; use own-property algorithm lookup | `oidc-conformance.test.ts`: critical headers and malformed compact serialization |
| OIDC omitted `nbf`, finite NumericDate checks and the exact expiry boundary | Preserve 60-second leeway, reject at `exp + 60`, accept `nbf <= now + 60`; validate mandatory subject and issued-at types | `oidc-conformance.test.ts`: NumericDates, nbf and skew across clock edits |
| OIDC trusted discovery's issuer without binding it to configured issuer; audience arrays and authorized party were insufficiently checked | Pin discovery and token issuer; validate audience strings and require the configured client as `azp` when present or when multiple audiences are supplied | `oidc-conformance.test.ts`: audiences, authorized party and configured issuer (a trailing slash on either side is ignored; any other difference is refused) |
| OIDC selected the first compatible key when `kid` was ambiguous or absent among multiple candidates | Require a single compatible candidate; retain refresh on unknown key from the configured JWKS endpoint | `oidc-conformance.test.ts`: ambiguous kid and loopback JWKS rotation |
| WebAuthn ignored the COSE EC curve and coerced algorithm identifiers from strings | Require integer key/algorithm identifiers, P-256 and 32-byte coordinates | `webauthn-conformance.test.ts`: COSE curve and integer algorithm |
| WebAuthn CBOR accepted trailing bytes, duplicate scalar map keys and truncated length/value encodings | Bound parsing, reject these encodings, and limit nesting to 32 | `webauthn-conformance.test.ts`: CBOR malformed cases |
| Authenticator-data parsing ignored impossible backup flags and extension/trailing-data boundaries | Check BS implies BE, credential-id boundaries, ED map framing and full consumption | `webauthn-conformance.test.ts`: backup flags and extension boundaries |
| WebAuthn accepted cross-origin assertions without an explicit policy | Reject `crossOrigin: true`; current clients use top-level same-origin ceremonies | `webauthn-conformance.test.ts`: cross-origin assertions |
| WebAuthn base64url decoding silently discarded invalid characters | Require canonical unpadded base64url | `webauthn-conformance.test.ts`: malformed base64url |
| Refresh-token rotation rejected replay but left the replacement grant usable | Persist hashed token-family history; replay revokes the active refresh and access token, including after restart. Serialize rotation in SQLite. | `crypto-protocols.test.ts`: RFC 7636 and refresh replay revocation across restart |
| Script SigV4 omitted explicit headers from canonical signing | Canonicalize/merge names and values; sign explicit stable headers; exclude transport-managed headers | AWS header duplicate/order/trim/multiline and POST header/form cases |
| Script SigV4 did not collapse repeated slashes and double-escaped raw spaces/Unicode | Normalize general-service raw paths before escaping; preserve the S3 path policy | AWS slash, slashes, space and UTF-8 cases |
| Script SigV4 interpreted literal query `+` as a form-encoded space | Decode query parameters using URI rules | `sigv4-conformance.test.ts`: literal query plus |
| S3 signing duplicated canonical names when input headers differed in case, and did not fold internal tabs | Normalize names once, replace generated signing headers, fold HTTP space/tab while preserving nonbreaking space | `crypto-protocols.test.ts`: S3 canonicalization |

The initial expanded AWS run failed 12 cases. All 31 supported cases now pass. Rejection policies such as refusing ambiguous keys and unsupported critical-header forms are deliberately strict local policies; broader provider acceptance is **unverified**.

## Parameters and protocol inventory

| Area | Implementation and parameters | Evidence / limits |
| --- | --- | --- |
| Passwords | `store/src/store.ts`: scrypt, Node defaults N=16384/r=8/p=1, random 16-byte salt, 32-byte result; sync and worker-pool async checks | Generated positive/negative hashes; explicit parameter comparison. No cost migration in this change. Imported vendor verifier: PBKDF2-HMAC-SHA1, one iteration, 10-byte salt, 20-byte result, blank-password-only path; vendor compatibility **unverified**. |
| Backup/database encryption | `server/src/encrypt.ts`: AES-256-GCM; scrypt N=32768/r=8/p=1/maxmem=64 MiB, 32-byte key; random 16-byte salt; random 8-byte nonce prefix plus 32-bit chunk/record counter, 16-byte tag. Chunk finality is AAD. | Sync/async generated round trips; wrong key, tag mutation, truncation, append and record-counter mismatch reject. Complete multichunk/order and crash-atomic-output behavior **not covered** here. |
| Connection secrets | `server/src/connections.ts`: AES-256-GCM with random 12-byte IV; either scrypt with the above backup parameters and random 16-byte salt, or stored random 32-byte key | Source inventory only; vault migration, permissions and fault injection **not covered**. |
| Browser offline copies | `web/src/offline.ts`: PBKDF2-SHA256, 210000 iterations, 16-byte salt, 64 derived bytes split into AES-GCM and HMAC-SHA256 keys; random 12-byte IV; record name in AAD | Existing memory-shelf tests run: wrong password and record substitution reject. Real IndexedDB/browser persistence **not covered**. |
| Calculator crypto | `calc/src/functions.ts`, `mbs-hash.ts`: digest/HMAC adapters; RSA signatures/encryption; custom AES-GCM envelope with PBKDF2-SHA256/10000 iterations, 16-byte salt/12-byte nonce. Compatibility AES-CFB and caller-selected OpenSSL ciphers also exist. | RFC 4231 and existing generated crypto/MBS tests run. Vendor envelope compatibility and unspecified cipher behavior **unverified**. Legacy MD5/SHA1 availability is a compatibility surface, not the password scheme. |
| Vendor file encryption | `fmp12/src/file.ts`: PBKDF2-HMAC-SHA1/18000, UTF-16LE passphrase, AES-256-CBC sector decryption | Source-only inventory; vendor behavior **unverified** and corpus testing **not covered**. |
| TOTP | `store/src/totp.ts`: 20 random bytes encoded base32, SHA1, 6 digits, 30 seconds, ±1 step; constant-time code check. Store remembers last accepted step. | Six RFC times reduced from the published eight-digit values to six digits; generated login replay rejection. SHA256/SHA512 and eight-digit output **not covered**, unsupported. |
| Recovery codes | `store/src/store.ts`: default ten codes, each 6 random bytes (48 bits), SHA256 of normalized code stored, conditional one-use update and lockout | Generated use, replay and replacement tests. No standard fixes the product's count/format: cross-vendor behavior **unverified**. |
| OAuth/PKCE | SHA256/S256; verifier syntax 43–128 unreserved characters; 32 random bytes for codes, refresh tokens and client secrets; 16 bytes for client IDs. SHA256 hashes stored. Codes expire in 60 seconds. | Public RFC 7636 verifier/challenge exercised through authorization and token endpoints, malformed/wrong verifier and code replay reject. Existing redirect validation preserved. Full OAuth 2.1 conformance **unverified**; audit uses the published RFCs below. |
| Refresh family state | Hash-only history, the 32 most recent retired tokens kept per family (older ones pruned on each rotation, no global cap); active-family expiry propagated on rotation, stale/orphan rows swept. The previous token also keeps a sealed copy of the replacement pair for a 45-second retry, cleared by the next sweep or by a timer once the window closes | Per-family pruning, the 45-second retry (refused once the replacement access token has been used, which revokes the family on a second refresh) and explicit backward/forward clock edits and restart tested. Local 30-day rolling expiry and federated 24-hour maximum preserved. Old tokens discarded before this upgrade cannot be reconstructed: historical replay detection **not covered**. Cross-database crash atomicity and simultaneous multiprocess fault injection **not covered**. |
| OIDC | SHA256 PKCE; 24-byte state/nonce/request ID, 32-byte verifier/grant ID; provider JWKS verification with the allow-list above. Apple client secret uses ES256/P-256 and 300-second expiry. | JWS signature and generated claim/key tests run. Apple signing and live provider interoperability **not covered**. |
| WebAuthn | SHA256 rpId/client-data hashes; ES256/P-256 or RS256; 32-byte server challenges; UP required, UV preferred by current client policy; nonzero counters must advance; zero/zero permitted | Public ES256 COSE example, generated ES256/RS256 ceremonies and rejection tests. Certificate attestation trust is intentionally not established. |
| SCIM | 32 random bytes with token prefix, SHA256 stored, fixed-length timing-safe comparison | Generated issue/rotation/revoke/malformed-token tests. |
| Other bearer/session material | Store API token: 6-byte public ID + 24-byte secret, SHA256 stored. MCP and local-admin tokens: 32 bytes. Admin API challenges/tokens: 32 bytes. Data API session: 24-byte total hex token minus cluster-routing prefix bytes. | Source inventory; public IDs are not counted as secret entropy. Individual endpoint issuance/expiry tests outside the new suite **not covered**. |
| Cookies | Admin console uses a random 32-byte opaque server-side session handle, HttpOnly/SameSite=Strict and Secure on HTTPS | No cookie-signing primitive was found. Cookie signature vectors **not covered** (not applicable to the current design); browser cookie behavior **not covered**. |
| HMAC application uses | SHA256 in AWS signing, inbound/outbound webhooks, signed container URLs, passkey decoys, account-import previews, sync review tokens and audit anchors. URL/import/sync secrets are 32 random bytes; outgoing webhook secrets are 24 bytes, inbound 32 bytes. | RFC 4231 covers the calculation adapter and runtime HMAC algorithms; it does not prove every application's message serialization. Individual webhook/URL/anchor/review envelope conformance **not covered**. |
| Other signatures and hashes | Ed25519 plugin packages; P-256 ACME/local TLS, RSA certificate requests; SHA256 audit chains, file integrity, ETags/cache keys; Digest MD5/SHA256 with 16-byte cnonce. UUIDs and short random IDs also identify nonsecurity objects and temporary files. | Existing Digest and MBS tests run. Plugin signing, certificate lifecycle, audit-chain envelopes and each nonsecurity hash consumer **not covered**. |
| Constant-time and entropy claims | Timing-safe buffer comparisons are used where inventoried; indexed token/code hashes and public claims use ordinary equality. Random secrets use Node/OpenSSL or WebCrypto CSPRNG calls. | Source and functional checks only. Constant-time execution, RNG entropy quality and side-channel resistance **unverified**; no statistical timing claim is made. |

## Published vectors and coverage boundaries

| Source | Executed coverage | Not covered |
| --- | --- | --- |
| [RFC 4231 §4](https://www.rfc-editor.org/rfc/rfc4231#section-4) | Cases 1–7, SHA224/256/384/512 through `CryptAuthCode`; case 5 checks the specified 128-bit prefix. Expected digests are literal published data. | Independent HMAC serialization vectors for every application consumer |
| [RFC 6238 Appendix B](https://www.rfc-editor.org/rfc/rfc6238#appendix-B) | All six SHA1 times, including 20000000000 seconds | SHA256/SHA512 and eight-digit mode; only the supported six-digit reduction is asserted |
| [RFC 7636 Appendix B](https://www.rfc-editor.org/rfc/rfc7636#appendix-B) | Published S256 pair accepted through the real OAuth endpoints | Live native/mobile redirect clients |
| [RFC 7515 appendices](https://www.rfc-editor.org/rfc/rfc7515#appendix-A) | A.2 RSA and A.3 EC signatures; reject A.1 HS256, A.4 ES512, A.5 none and Appendix E critical-extension example in the OIDC profile | A.6/A.7 JSON/multisignature serialization and certificate-chain example. Unsupported algorithms are rejection tests, not positive algorithm conformance claims. |
| [RFC 7519 Appendix A](https://www.rfc-editor.org/rfc/rfc7519#appendix-A) | Both encrypted/nested examples reject as unsupported five-part JWE. A.2's inner signed JWT is RFC 7515 A.2, positively verified above. | JWE decryption; this OIDC implementation has no JWE path |
| [RFC 7518 §3](https://www.rfc-editor.org/rfc/rfc7518#section-3), [OIDC Core validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), [RFC 9700 §4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2) | Generated algorithm/claim negatives and refresh family replay revocation | Live IdPs, sender-constrained tokens, complete provider/draft certification |
| [WebAuthn §6.5.1.1 and §7](https://www.w3.org/TR/webauthn-3/#sctn-encoded-credPubKey-examples) | Exact published ES256 COSE bytes; generated RSA/EC ceremonies; rpId/origin/challenge/UP/counter/signature, parser, backup flags and cross-origin negatives | RSA example's modulus is elided by the specification, so its exact vector is **not covered**. Certificate attestation, extensions' individual semantics, full CTAP2 canonical-map ordering, backup-eligibility persistence and required-UV policy are **not covered**. |
| [AWS public SigV4 suite](https://github.com/awslabs/aws-c-auth/tree/84a26ea184d9ccd322c8164759510b3604ab13fd/tests/aws-signing-test-suite/v4) | 31 normalized header-signing cases from 38 cases at the pinned revision. Duplicate/folded HTTP header lines are converted into equivalent header values for the object-based signing API. | Seven cases with `normalize:false`: relative, relative-relative, slash-dot-slash, slash-pointless-dot, slash, slashes, space. The generic API has no mode for these. Query presigning, SigV4a and live AWS verification **not covered**. |
| [AWS S3 GET Object example](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html) | Exact published signature plus generated header canonicalization negatives | Other S3 operation/signing examples and live service testing |

The test inputs are published vectors or generated data. No guessed replacement is supplied for incomplete published examples. Vendor behavior not established by a published specification or permitted test evidence is **unverified**.

## Reproduction and validation

Run `node scripts/test-crypto-conformance.ts`. It invokes only the listed test files with `--test-concurrency=2 --test-timeout=60000`; every child inherits a stub-only `PATH`. Stubs for `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl` and `sudo` write a marker and exit 99. The runner fails if the marker exists, including when a child catches the command failure. No tests install dependencies or fetch vectors.

Typecheck: `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`.

Final validation: **137 tests total, 130 passed, 0 failed, 7 explicitly skipped** (the unsupported AWS modes listed above). The complete 12-file targeted run took **1.92 seconds**, so every file finished well below 60 seconds. The forbidden-command marker was absent. Typecheck exited **0** with no diagnostics; `git diff --check` passed. Tests contain no tight wall-clock timing assertions. Each refresh runs in its own `BEGIN IMMEDIATE` transaction, and no changed code introduces a slot or lease taken after an await. No script-text parser was changed.

## Primitive call-site index

The index below enumerates direct Node crypto imports/calls and browser WebCrypto calls in application source, including ordinary identifiers and checksums. Locations refer to this working revision. Wrappers' protocol uses and coverage limits are described above; listing a call does not claim it received a vector test.

297 call sites in 88 source files.

| Source | Primitive and line numbers |
| --- | --- |
| `packages/calc/src/functions.ts` | `sign`: 546, 806, 2110; `createHash`: 786, 907, 1908, 2179, 2180; `createHmac`: 797; `createPrivateKey`: 804, 2057; `createPublicKey`: 818, 2064, 2083; `verify`: 820, 2122; `pbkdf2Sync`: 831; `randomBytes`: 835, 836; `createCipheriv`: 837, 2190, 2212; `createDecipheriv`: 853, 2199, 2212; `generateKeyPairSync`: 2078; `publicEncrypt`: 2091; `privateDecrypt`: 2099 |
| `packages/calc/src/get.ts` | `randomUUID`: 27, 30 |
| `packages/calc/src/mbs-hash.ts` | `getHashes`: 58; `createHash`: 87, 98; `createHmac`: 93 |
| `packages/cli/src/demo.ts` | `randomInt`: 22 |
| `packages/cli/src/doctor.ts` | `X509Certificate`: 202 |
| `packages/fmp12/src/file.ts` | `pbkdf2Sync`: 109; `createDecipheriv`: 136 |
| `packages/plugins/src/package.ts` | `createHash`: 21; `generateKeyPairSync`: 36; `createPrivateKey`: 61; `createPublicKey`: 62, 117; `sign`: 63; `verify`: 117 |
| `packages/plugins/src/registry.ts` | `createHash`: 68, 191; `randomUUID`: 69 |
| `packages/plugins/src/sandboxed.ts` | `createHash`: 26 |
| `packages/scripts/src/digest-auth.ts` | `createHash`: 54; `randomBytes`: 61 |
| `packages/scripts/src/engine.ts` | `randomUUID`: 4748, 5099, 7992 |
| `packages/scripts/src/pdf.ts` | `createHash`: 312 |
| `packages/scripts/src/sigv4.ts` | `createHash`: 5; `createHmac`: 6, 92 |
| `packages/server/src/acme.ts` | `createPublicKey`: 72; `sign`: 73, 141; `createHash`: 109; `createPrivateKey`: 231; `generateKeyPairSync`: 232, 332; `X509Certificate`: 280, 335 |
| `packages/server/src/admin.ts` | `createHash`: 507, 519; `randomBytes`: 625, 699, 748 |
| `packages/server/src/adminapi.ts` | `randomBytes`: 352; `createHash`: 511 |
| `packages/server/src/automations.ts` | `randomBytes`: 235 |
| `packages/server/src/backup-external.ts` | `randomUUID`: 174 |
| `packages/server/src/backup-folder.ts` | `randomBytes`: 64 |
| `packages/server/src/backup-verify.ts` | `createHash`: 45 |
| `packages/server/src/backup.ts` | `randomUUID`: 389 |
| `packages/server/src/calendar.ts` | `createHash`: 397 |
| `packages/server/src/cert-import.ts` | `createPublicKey`: 111; `sign`: 113; `generateKeyPairSync`: 180; `X509Certificate`: 197, 215; `createPrivateKey`: 205 |
| `packages/server/src/changes.ts` | `randomBytes`: 59, 297, 298; `createHmac`: 375, 417 |
| `packages/server/src/cleanup.ts` | `randomBytes`: 985 |
| `packages/server/src/cluster.ts` | `createHash`: 412, 415; `randomBytes`: 487 |
| `packages/server/src/component-library.ts` | `randomBytes`: 72, 123 |
| `packages/server/src/conditional.ts` | `createHash`: 17 |
| `packages/server/src/connections.ts` | `createHash`: 500; `randomBytes`: 723, 767, 812, 815, 1001; `createCipheriv`: 724; `createDecipheriv`: 732; `scryptSync`: 768, 813 |
| `packages/server/src/container-uploads.ts` | `randomBytes`: 126; `createHash`: 133 |
| `packages/server/src/containers.ts` | `randomUUID`: 205 |
| `packages/server/src/conversion-files.ts` | `createHash`: 95; `randomBytes`: 97 |
| `packages/server/src/dashboards.ts` | `randomBytes`: 356 |
| `packages/server/src/dataapi.ts` | `createHash`: 80; `randomBytes`: 600, 1433 |
| `packages/server/src/debug.ts` | `randomBytes`: 375 |
| `packages/server/src/design.ts` | `createHash`: 323 |
| `packages/server/src/digests.ts` | `randomBytes`: 195, 325 |
| `packages/server/src/encrypt.ts` | `scrypt`: 22; `scryptSync`: 26, 48, 108; `createCipheriv`: 37, 185; `randomBytes`: 46, 47, 75, 76; `createDecipheriv`: 121, 161, 191 |
| `packages/server/src/file-list.ts` | `randomBytes`: 49, 59; `createHmac`: 55, 57 |
| `packages/server/src/fms-migrate.ts` | `randomBytes`: 346; `X509Certificate`: 410; `createPrivateKey`: 418 |
| `packages/server/src/fms-sync.ts` | `randomBytes`: 410 |
| `packages/server/src/host.ts` | `randomBytes`: 321; `createHmac`: 1006; `timingSafeEqual`: 1020 |
| `packages/server/src/import-mapping.ts` | `randomBytes`: 752 |
| `packages/server/src/inbound-hooks.ts` | `randomBytes`: 187, 372; `createHmac`: 377; `timingSafeEqual`: 383 |
| `packages/server/src/ldap.ts` | `randomBytes`: 89 |
| `packages/server/src/local-admin.ts` | `randomBytes`: 35; `timingSafeEqual`: 82 |
| `packages/server/src/local-tls.ts` | `createHash`: 78, 264; `createPublicKey`: 78, 94; `randomBytes`: 83; `sign`: 97; `createPrivateKey`: 159; `X509Certificate`: 160, 197, 204, 242, 262, 305; `generateKeyPairSync`: 162, 212 |
| `packages/server/src/logs.ts` | `randomBytes`: 161, 162 |
| `packages/server/src/mcp-tokens.ts` | `createHash`: 34; `randomBytes`: 69, 72; `timingSafeEqual`: 96 |
| `packages/server/src/mcp.ts` | `createHash`: 141, 221, 264 |
| `packages/server/src/oauth.ts` | `createHash`: 48, 591; `randomBytes`: 49, 284 |
| `packages/server/src/odata-batch.ts` | `randomUUID`: 202, 219 |
| `packages/server/src/oidc.ts` | `randomBytes`: 296, 382, 383, 384, 529; `timingSafeEqual`: 346; `createHash`: 412; `createPrivateKey`: 577; `sign`: 577; `createPublicKey`: 730; `verify`: 732 |
| `packages/server/src/outbox.ts` | `randomBytes`: 22 |
| `packages/server/src/pgwire.ts` | `randomBytes`: 441 |
| `packages/server/src/rag.ts` | `randomUUID`: 74 |
| `packages/server/src/replication.ts` | `randomBytes`: 74, 165 |
| `packages/server/src/restore-files.ts` | `randomUUID`: 99 |
| `packages/server/src/s3.ts` | `createHash`: 27, 89, 121; `createHmac`: 64, 91 |
| `packages/server/src/schedules.ts` | `createHash`: 169; `randomBytes`: 413 |
| `packages/server/src/scim.ts` | `createHash`: 85; `randomBytes`: 151; `timingSafeEqual`: 176; `randomUUID`: 289 |
| `packages/server/src/secrets.ts` | `timingSafeEqual`: 6 |
| `packages/server/src/server-queue.ts` | `randomUUID`: 155 |
| `packages/server/src/smtp.ts` | `randomBytes`: 89, 92 |
| `packages/server/src/sql.ts` | `createHash`: 206 |
| `packages/server/src/static-cache.ts` | `createHash`: 26 |
| `packages/server/src/sync-console.ts` | `createHash`: 257 |
| `packages/server/src/uploads.ts` | `randomBytes`: 190 |
| `packages/server/src/webclient.ts` | `randomBytes`: 1753, 1811 |
| `packages/store/src/account-provisioning.ts` | `createHash`: 80 |
| `packages/store/src/audit-anchor.ts` | `createHmac`: 33; `timingSafeEqual`: 58 |
| `packages/store/src/calc.ts` | `createHash`: 561, 1089, 1419 |
| `packages/store/src/durable.ts` | `randomUUID`: 37, 177; `createHash`: 226 |
| `packages/store/src/import.ts` | `createHash`: 264 |
| `packages/store/src/privileges.ts` | `createHash`: 300 |
| `packages/store/src/record-chain.ts` | `createHash`: 29; `randomUUID`: 69 |
| `packages/store/src/results.ts` | `randomUUID`: 32 |
| `packages/store/src/save-as-xml.ts` | `createHash`: 67 |
| `packages/store/src/security-chain.ts` | `createHash`: 53; `randomUUID`: 108 |
| `packages/store/src/stale-calcs.ts` | `randomBytes`: 269 |
| `packages/store/src/store.ts` | `createHash`: 419, 3986, 4174, 4444, 6838; `randomBytes`: 625, 635, 636, 973, 3979, 3980, 4274, 4461; `scryptSync`: 626, 726; `pbkdf2Sync`: 697; `timingSafeEqual`: 697, 727, 748, 3735, 4175; `scrypt`: 748; `randomUUID`: 971, 2885, 3721, 3878, 3888; `createHmac`: 3676, 4320, 4321, 4327, 4329 |
| `packages/store/src/sync-apply.ts` | `randomBytes`: 160; `randomUUID`: 181, 307; `createHmac`: 367 |
| `packages/store/src/text-styles.ts` | `createHash`: 61 |
| `packages/store/src/totp.ts` | `randomBytes`: 14; `createHmac`: 56; `timingSafeEqual`: 74 |
| `packages/store/src/webauthn.ts` | `createHash`: 23; `createPublicKey`: 106, 113; `verify`: 247; `createVerify`: 249 |
| `packages/web/src/layout.ts` | `WebCrypto.randomUUID`: 1235, 1242, 1311 |
| `packages/web/src/offline.ts` | `WebCrypto.importKey`: 55, 56, 62; `WebCrypto.deriveBits`: 63; `WebCrypto.getRandomValues`: 67, 87; `WebCrypto.encrypt`: 88; `WebCrypto.decrypt`: 96; `WebCrypto.sign`: 194 |
| `packages/web/src/security/account-import.ts` | `WebCrypto.randomUUID`: 48 |


## Second-model review

A different model reviewed this branch read-only and ran the targeted suites. Findings and what was done:

| Finding | Result |
| --- | --- |
| Exact issuer match refused configurations that worked before (Auth0 publishes a trailing slash, Google and Okta do not; an Entra domain tenant differs from the GUID form) | Fixed for the trailing slash: one is ignored on either side, covered by a test. A domain-form Entra tenant still differs from the issuer Entra publishes and must be configured with the published issuer: **recorded in `launch-decisions.md`** |
| SigV4 refused a literal `%` that is not an escape (`/50%off`), which signed before | Fixed: it is signed as `%25`; test for both S3 and a generic service. How AWS reads such a request is **unverified** |
| The sealed retry pair stayed on disk until the next token request | Fixed: a timer clears it when the 45-second window closes; test with a mocked timer, fails without the change |
| Two processes refreshing the same family can sign it out | Design note: RFC 9700 permits this; it was a plain failure before. **Recorded in `launch-decisions.md`** |
| COSE coordinates must be exactly 32 bytes | Kept: the spec requires it. An authenticator that strips leading zeros would be refused: **unverified** with real hardware |
| Audit rows described a 1024/100000 cap that the code does not have, omitted the retry mechanism, and quoted stale test counts | Corrected above |

Not run by the reviewer: `oauth.test.ts` and `dataapi-conformance.test.ts`, which skip without fixtures.
