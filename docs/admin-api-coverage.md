# FileMaker Admin API: which calls Tabularius answers

Admin API tokens expire after 15 minutes idle or eight hours from issuance, even with continued use. Setting or changing the admin password invalidates existing tokens. An expired or invalidated token receives HTTP 401, code 9 (Access denied); sign in again for a new token.

Claris lists about 160 Admin API (v2) calls by name in its Admin API guide. The paths and bodies are in the Admin API Reference that is installed with FileMaker Server at `/fmi/admin/apidoc/`, which is not in this repository, so this page works from **names only**. For a call Tabularius answers, it gives the route here. For a call it does not answer, it gives no path: none is guessed. When that reference is saved into the project, a script can replace the name-level reading with a path-by-path diff.

**Answered** means a route exists here and does what the name says. **Fixed** means the route answers FileMaker's setting with a value that describes Tabularius, and a PATCH that changes nothing is accepted (tools send every value back); a PATCH that changes it answers code 21 (Not Supported) with the reason. **Not answered** means the route is unknown here (404, code 3 "Unavailable command").

The routes are in the [REST reference](reference/rest.md#admin-api). A test (`admin-api-coverage.test.ts`) keeps this page in step with it: every route named here exists, and every route the reference lists is named here.

## Answered

| Claris call | Here | Route |
| --- | --- | --- |
| Request a token | Answered | `POST /fmi/admin/api/v2/user/auth` |
| Invalidate a token | Answered | `DELETE /fmi/admin/api/v2/user/auth/{token}` |
| Server metadata | Answered | `GET /fmi/admin/api/v2/server/metadata` |
| Get server status | Answered | `GET /fmi/admin/api/v2/server/status` |
| Update server status (stop, start) | Answered | `PATCH /fmi/admin/api/v2/server/status` |
| Block new users | Answered | `GET /fmi/admin/api/v2/server/config/blocknewusers`, `PATCH /fmi/admin/api/v2/server/config/blocknewusers` |
| Security settings | Fixed | `GET /fmi/admin/api/v2/server/config/{setting}`, `PATCH /fmi/admin/api/v2/server/config/{setting}` (`security`) |
| General settings | Fixed | the same two routes (`general`) |
| Authenticated stream | Fixed | the same two routes (`authenticatedstream`) |
| Parallel backup | Fixed | the same two routes (`parallelbackup`) |
| Persistent cache | Fixed | the same two routes (`persistentcache`) |
| PHP (Custom Web Publishing) configuration | Fixed | `GET /fmi/admin/api/v2/php/config` |
| XML (Custom Web Publishing) configuration | Fixed | `/fmi/admin/api/v2/xml/config` (reports enabled: the XML interface is served, reads only) |
| HTTPS tunneling | Fixed | `/fmi/admin/api/v2/fmclients/httpstunneling` |
| List databases | Answered | `GET /fmi/admin/api/v2/databases` |
| Open, close, pause or resume all databases | Answered | `PATCH /fmi/admin/api/v2/databases` |
| Open, close, pause or resume one database | Answered | `PATCH /fmi/admin/api/v2/databases/{id}` |
| List clients | Answered | `GET /fmi/admin/api/v2/clients` |
| Disconnect a client, with a message | Answered | `DELETE /fmi/admin/api/v2/clients/{id}` |
| Send a message to a client | Answered | `POST /fmi/admin/api/v2/clients/{id}/message` |
| List schedules | Answered | `GET /fmi/admin/api/v2/schedules` |
| Get a schedule | Answered | `GET /fmi/admin/api/v2/schedules/{id}` |
| Create a script, backup or message schedule | Answered | `POST /fmi/admin/api/v2/schedules/{type}` |
| Duplicate a schedule | Answered | `POST /fmi/admin/api/v2/schedules` |
| Update, enable, disable or run a schedule | Answered | `PATCH /fmi/admin/api/v2/schedules/{id}` |
| Delete a schedule | Answered | `DELETE /fmi/admin/api/v2/schedules/{id}` |
| List plug-ins | Answered | `GET /fmi/admin/api/v2/plugins` |
| Certificate: signing request | Answered | `PATCH /fmi/admin/api/v2/server/certificate/csr` |
| Certificate: import | Answered | `PATCH /fmi/admin/api/v2/server/certificate/import` |
| Certificate: delete | Answered | `DELETE /fmi/admin/api/v2/server/certificate/delete` |

Schedules of the kinds FileMaker Server has and the Admin API shape here does not carry (a system-script schedule, a script sequence, a verify schedule) answer code 21. Tabularius has a verify schedule of its own (`kind: "verify"` on the console's `/tabularius/admin/v1/schedules`: it reads every page of the hosted files, or of one), which this Admin API does not list because the shape of Claris's `verifyType` is not known. A backup schedule reads its new set back (and one older set) unless `verifyBackup` is false. Schedule parity with FileMaker Server's schedule types is audited in `notes/audits/audit-schedule-parity.md`.

## Not answered, by name

These Claris calls have no route here. Each is a candidate once the reference is available; none is planned by name alone.

- Update the server name; update the Admin Console account; administrator contact information; administrator roles (create, update, delete); restricted access; Admin API public keys; discovery.
- Database folders: the additional database folder, the backup folder and the progressive backup folder, and the remote container folder paths; progressive backup settings; cancel a running backup; back up now.
- Remote backups: list, restore, download.
- Script error logs setting; the certificate settings for unknown revocation status; Let's Encrypt request and renew.
- Plug-in enable and disable; plug-in configuration.
- Session timeouts (FileMaker Pro and Go, and WebDirect); database filtering; simultaneous FileMaker Server Extension sessions; license information; email notifications.
- Identity provider settings (Amazon, Google, Microsoft, Apple, custom OAuth); the external account group name.
- Database remove, download and upload, and the multi-part upload calls.
- The Data API, OData and ODBC/JDBC (XDBC) settings.
- Model server; Hugging Face token.
- Standby server and server role (Tabularius has no counterpart: it is one server, or several worker processes with `serve --workers N`).

Several of these have a counterpart in the Tabularius admin console (backups, email notifications, session timeouts, identity providers, the databases themselves), reachable at `/admin/` with API routes under `/tabularius/admin/v1/` and listed in the REST reference; the FileMaker Admin API route for them is what is missing.
