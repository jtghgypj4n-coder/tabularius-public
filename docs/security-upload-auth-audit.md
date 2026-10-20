# Upload and request body audit

**Upload authentication/body audit — 2026-10-16, compatibility revision**

The admin console `.fmp12` upload/convert ordering allegation from #1174 did **not** reproduce: admin and CSRF checks already precede upload creation, piece reads, and conversion. The reproduced issues were large pre-authentication envelopes and unread-body connection handling.

**Authentication boundary:** the 64 KiB limit applies only while credentials still require verification from the body: admin/Data API sign-in, OIDC callbacks, XML publishing, and MCP Basic requests whose target file is in the RPC payload. OAuth retains its existing 64 KiB forms. The shared reader checks declared sizes before reading and enforces the same byte limit incrementally for chunked requests. OData URL-known schema/script permissions still run before the reader. Inbound hooks reject missing, malformed, or stale timestamps before reading; their HMAC still requires the existing 256 KiB bounded body.

**Compatibility:** authenticated accounts retain the previous route limits regardless of privilege set or external data sources. The permission-dependent cap has been removed, including the separate SQL, SCIM, assistant, digest, and library-publish reductions. JSON is normally 10 MiB, imports 50 MiB, OData batches 32 MiB (including read-only tokens), and agent plans 1,000,000 bytes. Verified MCP API/OAuth/account tokens retain the SDK's **4 MiB HTTP envelope**. The existing **20 MiB decoded-image tool limit** remains unchanged; the 4 MiB HTTP envelope can still be the tighter bound, as on main. Basic MCP remains 64 KiB until a payload-selected file verifies its credentials. Record/field/external-file permissions, SCIM Full Access protections, token scopes, and assistant picture permissions still run as before.

**Refusal delivery and reuse:** unread refusals use `Connection: close`, finish the response, and half-close the socket's write side. The read side discards without buffering for at most **two seconds**, then is forcibly destroyed if the sender remains. This is a time bound, not a 1 MiB network-byte bound: a fast 5 MiB send-then-read client can finish writing and receive its 401. Application parsing/retention stops at the authentication cap; regression byte counters exclude the post-response discard phase. This distinction avoids claiming that all network traffic stops at 64 KiB. The socket's one-shot `destroySoon` override prevents Node's response-finish handler from immediately resetting a connection with unread data. Timers/listeners are removed on close (and after successful small-body drains).

Admin API login and Data API logout drain small optional bodies after their header/token checks, including chunked bodies, preserving the next pipelined request. Successful requests whose body has been consumed retain keep-alive. Unread refusals deliberately close, so a pipelined request following one is not promised service.

**Expect and timeouts:** the application HTTP and HTTPS listeners use `checkContinue` to run normal routing/authentication before emitting `100 Continue`. The interim response is sent only when an accepted route attaches its body reader. Body-based authentication may continue only after its small declared-size check. The HTTP edge now uses a 10-second absolute header deadline and a 300-second body inactivity deadline, rather than a fixed total request deadline. Progressing authenticated uploads may exceed 300 seconds; an incomplete body with no wire progress for 300 seconds receives 408 and closes. Byte caps still bound body-based sign-in envelopes; a caller already refused gets only the two-second drain window. See [HTTP edge limits](audits/audit-edge-limits.md) for connection budgets and proxy accounting.

**Validation**

- Node v22.22.2; no new dependencies. Tests use `--test-concurrency=2`.
- Failing-first compatibility probes reproduced 413s before source edits. Corrected tests against isolated, unchanged HEAD: **1 pass / 31 fail**. Two additional failing-first pipelining tests cover ignored chunked bodies. Initial fixture/setup failures and interrupted expensive SCIM setup runs are not counted as product regressions.
- The SCIM fixture refreshes 1,399 existing group memberships and adds one, exercising a real 1,400-member PUT without expensive bulk account-security setup. The assistant test mocks the provider only; HTTP auth/parsing remain real. OAuth tests obtain their tokens through registration, PKCE authorization, and exchange.
- `npm run typecheck`: **PASS**.
- Requested coverage: **377 distinct tests verified passing / 0 unresolved failures / 0 skipped**. The fixture-backed full run was **374 pass / 3 fail**; all three failures were temporary-harness paths (Admin HTML and MCP e2e fixture resolution). After correcting those paths, the affected files passed **16 / 0**, clearing all three failures without source changes. The initial worktree run was **251 pass / 0 fail / 126 skipped** because its expected `fixtures` link was absent. To avoid modifying that protected path, fixture-backed checks used a temporary copy; SHA-256 comparisons confirmed all **520 server source/test files** matched the worktree. Existing local fixtures were only read.
- Supplemental changed-route coverage (Admin API, agent, cleanup, digests, assistant, component library): **158 pass / 0 fail / 0 skipped**.
- Requested command (run from the temporary copy with fixture access):

  ```sh
  node --test --test-concurrency=2 packages/server/test/upload-auth-*.test.ts packages/server/test/dataapi*.test.ts packages/server/test/odata-batch.test.ts packages/server/test/scim*.test.ts packages/server/test/sql*.test.ts packages/server/test/mcp*.test.ts packages/server/test/webclient*.test.ts packages/server/test/inbound-hooks*.test.ts packages/server/test/resource-limits.test.ts
  ```

- Raw 5 MiB send-then-read refusal delivery: **20/20 received 401** in both the targeted and fixture-backed runs. An unfinished slow sender is separately checked against the two-second drain deadline.
- No commit or push; no task edits target `.impeccable/`, `.github/`, or `fixtures/`. An unrelated `.impeccable/hook.cache.json` working-tree change appeared during the session and was left alone.

**Route table**

Source filenames below are under `packages/server/src`. Auth columns include authentication and route-level authorisation; target permissions that require the payload remain after parsing. Common reader: `dataapi.ts` (`readBody`, `eachChunk`, `readJson`). “Already correct” concerns the original auth-order allegation; unread responses also use the shared connection handling described above.

| Route | Auth checks | Body reader | Order | Size cap |
|---|---|---|---|---|
| POST /tabularius/admin/v1/sign-in | `admin.ts` (CSRF; password) | `admin.ts` | CSRF → bounded body → password | 64 KiB (was 10 MiB) |
| POST /tabularius/admin/v1/passkey-sign-in | `admin.ts` (CSRF; assertion) | `admin.ts` | CSRF → bounded body → assertion | 64 KiB (was 10 MiB) |
| POST /tabularius/admin/v1/uploads | `admin.ts` (admin; CSRF) | `admin.ts` | Auth → body; ordering already correct | 10 MiB metadata; total file default 10 GiB (TABULARIUS_MAX_UPLOAD) |
| PUT /tabularius/admin/v1/uploads/{id} | `admin.ts` (admin; CSRF) | `admin.ts` → `uploads.ts` | Auth → upload/id/offset/declared-size checks → streamed body; already correct | 64 MiB per piece; also remaining declared file size |
| POST /tabularius/admin/v1/uploads/{id}/finish | `admin.ts` (admin; CSRF) | None; `admin.ts` | Auth → finish/conversion; no body reader | No payload parsing; optional small bodies drained for reuse where applicable |
| POST /tabularius/admin/v1/files/{name}/reconvert[-preview] | `admin.ts` (admin; CSRF) | `admin.ts` | Admin auth → body → file passphrase check | 10 MiB; server administrator already authorised |
| PUT /tabularius/admin/v1/sync/{database}; POST .../{check,apply} | `admin.ts` (admin; CSRF) | `admin.ts` | Admin auth → body → remote FileMaker credentials used | 10 MiB |
| POST /fmi/admin/api/v2/user/auth | `adminapi.ts` (Basic password) | `request-body.ts` (`drainSmallBody`) | Auth → optional-body drain → token | No parsing; drain up to 64 KiB, then bounded discard for larger ignored bodies |
| DELETE /fmi/data/{version}/databases/{db}/sessions/{token} | `dataapi.ts` (end token) | `request-body.ts` (`drainSmallBody`) | End session → optional-body drain → success | No parsing; drain up to 64 KiB, then bounded discard for larger ignored bodies |
| POST/PATCH /fmi/admin/api/v2/* (except login) | `adminapi.ts` | `adminapi.ts` | Admin bearer auth → body | 10 MiB |
| POST /fmi/data/{version}/databases/{db}/sessions | `dataapi.ts` (login/credentials) | `dataapi.ts` | Bounded envelope → auth (fmDataSource also contains credentials) | 64 KiB (was 10 MiB) |
| POST /fmi/data/{version}/databases/{db}/sessions/passkey | `dataapi.ts` (assertion) | `dataapi.ts` | Bounded body → assertion/challenge | 64 KiB (was 10 MiB) |
| POST /fmi/data/{version}/databases/{db}/sessions/recovery | `dataapi.ts` (recovery code) | `dataapi.ts` | Bounded body → recovery code | 64 KiB (was 10 MiB) |
| POST /fmi/data/{version}/databases/{db}/sessions/passkey-2fa | `dataapi.ts` (password; factor) | `dataapi.ts` | Password → bounded body → second factor | 64 KiB (was 10 MiB) |
| PATCH /fmi/data/{version}/databases/{db}/sessions | `dataapi.ts` | `dataapi.ts` | Session/credential-management scope → body | 10 MiB |
| POST /fmi/data/{version}/databases/{db}/passkey/register | `dataapi.ts` | `dataapi.ts` | Session/own-account scope → body | 10 MiB |
| PATCH /fmi/data/{version}/databases/{db}/globals | `dataapi.ts` (session, privileges, read-only token; layout scope, where applicable) | `dataapi.ts` | Session/scope → bounded body → payload-selected field/record/portal/script permissions | 10 MiB |
| POST /fmi/data/{version}/databases/{db}/layouts/{layout}/records | `dataapi.ts` (session, privileges, read-only token; layout scope, where applicable) | `dataapi.ts` | Session/scope → bounded body → payload-selected field/record/portal/script permissions | 10 MiB |
| PATCH /fmi/data/{version}/databases/{db}/layouts/{layout}/records/{id} | `dataapi.ts` (session, privileges, read-only token; layout scope, where applicable) | `dataapi.ts` | Session/scope → bounded body → payload-selected field/record/portal/script permissions | 10 MiB |
| POST /fmi/data/{version}/databases/{db}/layouts/{layout}/records/{id} (duplicate) | `dataapi.ts` (session, privileges, read-only token; layout scope, where applicable) | `dataapi.ts` | Session/scope → bounded body → payload-selected field/record/portal/script permissions | 10 MiB |
| POST /fmi/data/{version}/databases/{db}/layouts/{layout}/_find | `dataapi.ts` (session, privileges, read-only token; layout scope, where applicable) | `dataapi.ts` | Session/scope → bounded body → payload-selected field/record/portal/script permissions | 10 MiB |
| POST /fmi/data/{version}/databases/{db}/layouts/{layout}/records/{id}/containers/{field}[/{rep}] (+ portal query) | `dataapi.ts` (session, privileges, read-only token); target write permission | `dataapi.ts` → pipeline | Session/scope/record/field/portal authorisation → body; already correct | 1 GiB, streamed to temporary file (multipart fallback may buffer up to cap) |
| POST/PATCH /fmi/odata/v4/{db}/FileMaker_Tables or FileMaker_Indexes | `odata.ts` (sign-in; Full Access) | `odata.ts` | Auth + schema permission → body (permission moved earlier) | 10 MiB |
| POST /fmi/odata/v4/{db}/Script.{name or FMSID:id} | `odata.ts` (script permission) | `odata.ts` | Auth + script lookup/permission → body (permission moved earlier) | 10 MiB |
| POST /fmi/odata/v4/{db}/{set} | `odata.ts` (read-only token) | `odata.ts` | Auth/scope → bounded body → record/field permissions | 10 MiB |
| PATCH/PUT /fmi/odata/v4/{db}/{set}({id}) | `odata.ts` (read-only token) | `odata.ts` | Auth/scope → bounded body → record/field permissions | 10 MiB |
| POST /fmi/odata/v4/{db}/$batch | `odata.ts`; per-unit resource checks | `odata.ts` | Outer auth → bounded batch → each unit’s permissions | 32 MiB, including read-only tokens |
| PATCH/PUT /fmi/odata/v4/{db}/{set}({id})/{container}[/$value] | `odata.ts` (target write permission) | `odata.ts` | Auth + target container permission → body; already correct | 64 MiB |
| POST /tabularius/app/v1/databases/{db}/layouts/{layout}/import | `webclient.ts`; import target permissions in importRecords | `webclient.ts` | Session/layout → bounded multipart → mapped fields/found-set permissions | 50 MiB for all authenticated sessions |
| POST /tabularius/app/v1/databases/{db}/layouts/{layout}/{view,records,foundset,groups,charts,menus,button,index,position,export,undo-import,ai-replace,explain,history,revert,refresh,value-list} | `webclient.ts`; action permissions after parsing (e.g. script permissions) | `webclient.ts` | Session/layout → bounded JSON → action/field/record/script permissions | 10 MiB |
| PUT /tabularius/app/v1/databases/{db}/prefs/{key} | `webclient.ts` | `webclient.ts` | Session + own preferences + unscoped token → body | 64 KiB, already bounded |
| POST /tabularius/app/v1/databases/{db}/runs/{id}/file (Sort) | `webclient.ts` (session, privileges, run owner/file) | `webclient.ts` | Session + ownership of waiting run → body | 64 KiB |
| POST /tabularius/app/v1/databases/{db}/runs/{id}/file (Index) | `webclient.ts` (session, privileges, run owner/file) | `webclient.ts` | Session + ownership of waiting run → body | 4 MiB |
| POST /tabularius/app/v1/databases/{db}/runs/{id}/file (Dialog) | `webclient.ts` (session, privileges, run owner/file) | `webclient.ts` | Session + ownership of waiting run → body | 4 MiB |
| POST /tabularius/app/v1/databases/{db}/runs/{id}/file (Clipboard) | `webclient.ts` (session, privileges, run owner/file) | `webclient.ts` | Session + ownership of waiting run → body | 4 MiB |
| POST /tabularius/app/v1/databases/{db}/runs/{id}/file (Location) | `webclient.ts` (session, privileges, run owner/file) | `webclient.ts` | Session + ownership of waiting run → body | 4 KiB |
| POST /tabularius/app/v1/databases/{db}/runs/{id}/file (Device JSON) | `webclient.ts` (session, privileges, run owner/file) | `webclient.ts` | Session + ownership of waiting run → body | 69,970,603 bytes envelope; decoded file 50 MiB |
| POST /tabularius/app/v1/databases/{db}/runs/{id}/file (Pause/Checkpoint) | `webclient.ts` (session, privileges, run owner/file) | `webclient.ts` | Session + ownership of waiting run → body | 64 KiB |
| POST /tabularius/app/v1/databases/{db}/runs/{id}/file (File/multipart/base64) | `webclient.ts` (session, privileges, run owner/file) | `webclient.ts` | Session + ownership of waiting run → body | 69,970,603 bytes envelope; decoded file 50 MiB |
| POST /mcp (Basic) | `index.ts` (Origin; identity); `mcp.ts` (Basic password; fmmcp; token scope; MFA) | `index.ts` → SDK `webStandardStreamableHttp.js` | Origin/header identity → bounded RPC → per-file/tool auth; Basic identity is not yet verified | 64 KiB while Basic credentials remain unverified; configured before SDK body read | <!-- known-difference-ok: "not yet verified" describes the order of checks in a request, not a difference from FileMaker -->
| POST /mcp (verified account/API/OAuth/admin token or permitted local admin) | `index.ts` (server token/local channel) | `index.ts` | Verified identity → SDK body → file/tool permissions | SDK default 4 MiB |
| POST /tabularius/scim/v2/databases/{db}/{Users,Groups}; PUT/PATCH .../{id} | `scim.ts` (provisioning token); account protection | `scim.ts` | Provisioning token → bounded body → target-account/group permissions | 10 MiB; token cannot grant/remove Full Access |
| POST /tabularius/admin/v1/scim/{token,settings} | `admin.ts` (admin; CSRF) | `scim.ts` | Admin auth → body | 10 MiB |
| POST /oauth/register | `oauth.ts` (public registration, validation) | `oauth.ts` | Public bounded registration; no existing account required | 64 KiB, already bounded |
| POST /oauth/token; POST /oauth/revoke | `oauth.ts` (client secret; grant/revoke checks) | `oauth.ts` | Bounded form → client/grant/token verification | 64 KiB, already bounded |
| POST /oauth/authorize | `oauth.ts` (account password); consent/state checks in authorize | `oauth.ts` | Bounded form → credentials/consent | 64 KiB, already bounded |
| POST /tabularius/auth/v1/oidc/callback | `oidc.ts` (pending state); token verification later in callback | `oidc.ts` | Bounded form → state → provider token verification | 64 KiB (was 1 MiB JS string; now byte-counted shared reader) |
| POST /fmi/xml/{grammar}.xml | `cwp-xml.ts` (database sign-in; layout) | `cwp-xml.ts` | Bounded form identifies database → auth/layout | 64 KiB (was 1 MiB) |
| POST /tabularius/sql/v1/databases/{db} | `sql.ts` (sign-in; target file read permission) | `sql.ts` | Session → bounded SQL envelope → resolved target permission | 10 MiB; target can be another file |
| POST /tabularius/agent/v1/databases/{db}/{dry-run,step} | `agent.ts`; plan permission check | `agent.ts` | Session/AI switch → bounded plan → plan/action permissions | 1,000,000 bytes |
| POST /tabularius/cleanup/v1/databases/{db}/{scan,apply} | `cleanup.ts`; target checks in scanData/applyCleanup | `cleanup.ts` | Session → bounded payload → target permissions | 10 MiB |
| POST /tabularius/digests/v1/databases/{db}; PUT .../{id} | `digests.ts` (dashboard/webhook; owner) | `digests.ts` | Session/token scope (+ owner for PUT) → bounded body → dashboard/webhook permission | 10 MiB for all authenticated sessions |
| POST /tabularius/assistant/v1/databases/{db} | `assistant.ts` (session, AI access, then picture permission) | `assistant.ts` | Session + AI access → bounded chat → picture permission | 10 MiB for all authenticated sessions |
| POST /tabularius/assistant/v1/databases/{db}/handover | `assistant.ts` | `assistant.ts` | Session + Full Access → body | 10 MiB |
| PUT /tabularius/assistant/v1/databases/{db}/connections/{name}/secrets/{key} | `assistant.ts` (Full Access, interactive session, own draft) | `assistant.ts` | Full Access + interactive session + draft ownership → body | 10 MiB |
| POST /tabularius/security/v1/databases/{db}/accounts/import/{preview,apply} | `account-provisioning.ts` (interactive session + Full Access) | `account-provisioning.ts` | Auth + Full Access → body; revalidated after parsing | 1 MiB |
| POST/PUT security mutations under /tabularius/security/v1/databases/{db} | `security.ts` (session + Full Access) | `security.ts` | Auth + Full Access → body | 10 MiB |
| POST/PATCH /tabularius/automations/v1/databases/{db}[/{id}] | `automations.ts` (session + Full Access) | `automations.ts` | Auth + Full Access → body | 10 MiB |
| POST /tabularius/dashboards/v1/databases/{db}[?preview=1]; PUT .../{id} | `dashboards.ts` (scope; owner on PUT) | `dashboards.ts` | Session/scope (+ ownership for PUT) → body; all signed-in accounts may create/preview | 10 MiB; inaccessible widget data becomes a widget error, not permission to edit someone else’s dashboard |
| POST /tabularius/live/v1/databases/{db}/design | `live.ts` (session + Full Access) | `live.ts` | Auth + Full Access → body | 10 MiB |
| POST /tabularius/debug/v1/databases/{db}/* (evaluate/start/run controls) | `debug.ts` (session + Full Access); run ownership checks for controls | `debug.ts` | Auth + Full Access (+ run ownership) → body | 10 MiB |
| POST /tabularius/design/v1/databases/{db}/* (except library publish below) | `design.ts` (session + Full Access) | `design.ts` | Full Access gate executes before dispatch to these helper readers (even readers earlier in source order) | 10 MiB |
| POST /tabularius/design/v1/databases/{db}/library | `design.ts` (Full Access), `component-library.ts` (owning file) | `design.ts` | Full Access → bounded component selector → shared-library owner check | 10 MiB |
| POST /tabularius/hooks/v1/{id} | `inbound-hooks.ts` (enabled hook, timestamp, then body-dependent signature) | `inbound-hooks.ts` | Enabled hook + timestamp header → capped body → HMAC signature (explicit exception) | 256 KiB; Content-Length checked first and chunk accumulation bounded; timingSafeEqual on fixed-size decoded MACs |
| Cluster forwarding (all routes) | Worker route checks listed above; cluster front does not authenticate | `cluster.ts` req.pipe(out) | Streams to worker with backpressure; no aggregate body buffering or independent route handler | No front aggregate cap; worker route cap applies. Not an additional buffering fix; worker sends Connection: close on unread-body responses. |

**Remaining admin JSON routes (all share the same verified gate)**

Every row below executes `admin.ts` (admin authorisation) and `admin.ts` (CSRF) before reading; all use the existing 10 MiB JSON cap. Sync, SCIM, connection and schedule helpers are called only from that gated dispatcher.

| Route under `/tabularius/admin/v1` | Auth checks | Body reader | Order | Cap |
|---|---|---|---|---|
| `/block-new-users` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/session-timeout` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/responsive` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/notifications` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/passkeys/register` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/backup-folder` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/backup` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/files/{name}/orphan-containers` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/files/{name}/reconvert-preview` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/locked/{file}/unlock` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/relax-unverified` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB | <!-- known-difference-ok: /relax-unverified is the name of an admin route -->
| `/reconvert-all` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/files/{name}/reconvert` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/uploads` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/webhooks (POST)` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/webhooks/{id} (PATCH)` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/inbound-hooks (POST)` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/inbound-hooks/{id} (PATCH)` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/solutions/plan` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/solutions` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/ai-access/` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/pii/` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/optimization/{db}/containers[/undo]` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/optimization/{db}/{fix,undo}` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/indexes` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/script-tests/run` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/records/restore` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/audit/settings` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/field-access` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/sso-mapping` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/health/revoke-token` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/health/fix-account` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/accounts/set-password` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/accounts/unlock` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/accounts/migrate-all` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/accounts/blank-password-lan` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/stale-calcs` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/sessions/end` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/restore` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/mcp/tokens` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/message` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/clients/{id}/message` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/plugins/{id}/{enable,disable}` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/plugins/{id}/secrets/{name}` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/connections (POST)` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/connections/{id}/secrets/{name}` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/connections/{id} (PATCH)` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/sync/{db} (PUT)` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/sync/{db}/check` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/sync/{db}/apply` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/schedules (POST)` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |
| `/schedules/{id} (PATCH)` | `admin.ts` | `admin.ts` | Auth → body | 10 MiB |

**Coverage notes**

The sweep included `readBody`, `readJson`, aliases (`readRaw`), `eachChunk`, multipart parsers/streaming, request async iteration, data listeners, and request piping. `multipartUpload` is a synchronous parser of an already-read buffer, not another network reader. Host `.fmp12` upload is the admin route above; `host.ts` has no separate HTTP body reader. `sync-console.ts` and `fms-sync.ts` initiate outbound requests; inbound sync settings/check/apply bodies are the gated admin helper above. Replication serves snapshots; it does not ingest an HTTP upload body. LDAP, SMTP and PostgreSQL data listeners are non-HTTP protocols. The `res.on('data')` / `res.body` reads in FMS, S3, embeddings, AI and standby code are outbound response handling, not unauthenticated HTTP ingress. Durable `readJsonStateSync` calls read local state, not requests.

OAuth already used a 64 KiB shared byte cap. Web preferences, waiting-run ownership, Account Provisioning Full Access, Admin API bearer checks, security/design/debug/live design gates, automation Full Access and dashboard ownership were already before their readers; no speculative auth reorder was made there. Webhook HMAC verification remains constant-time with its original 256 KiB incremental cap. Its timestamp gate now precedes that reader.

The cluster front is a forwarding transport, not another application auth surface; it uses stream backpressure rather than collecting the upload. The table records that its pipe precedes worker authorisation rather than claiming that every network hop authenticates first. Cluster process/socket behaviour was inspected, not exercised by the new single-server regression suite.
