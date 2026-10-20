# Generated privilege matrix

This audit exercises the same small generated file and caller account across eight entry-point families, split into ten test files (HTTP SQL and pgwire are separate; API-token coverage spans the HTTP families). It needs no downloaded fixture, added dependency, external service, or Claris server. The expected policy is defined independently of the production `Privileges` methods in [privilege-matrix.ts](../packages/server/test/privilege-matrix.ts). Each test creates a separate temporary store for each shape, with two records (caller-owned and someone else's), a text field, an owner field, a container, a layout, and caller-run scripts. Each mutating operation restores its initial records in `finally`, so a failing cell cannot contaminate later cells.

`0` means allowed. Other numbers are exact application denial codes, except PostgreSQL SQLSTATE. Tests check the HTTP success/error category, response codes, returned fields/rows, persisted successful mutations, and unchanged records/container references after refusals. Script error envelopes remain distinct from HTTP request errors. No expected outcome is learned from the observed response or by calling the production privilege oracle.

## Already present on main

Before implementation, `git grep main` found existing enforcement and examples in `privileges.test.ts`, `extended-privilege-surfaces.test.ts`, `mcp-privileges.test.ts`, OData/SQL/pgwire suites, and store/script privilege suites. Basic CRUD, field restrictions, calculation-based record restrictions, layout/script levels, extended-privilege gates, export/print gates, password changes and lockout were already implemented. Those implementations and individual examples were retained, rather than rebuilt. The missing item was a shared generated cross-entry-point matrix, including states and combinations that those separate examples did not exercise.

## Reproduce

```sh
node --test --test-concurrency=2 --test-reporter=spec packages/server/test/privilege-matrix-*.test.ts
node scripts/privilege-matrix.ts --check
```

Regenerate only the expected-outcome tables with `node scripts/privilege-matrix.ts`. Each entry point has its own test file. No sleeps assert timing; network operations have 10-second failure bounds. The suites are sized to stay below 60 seconds per file (CI permits 120 seconds), with test concurrency limited to two.

Final validation: 33 shapes, 4,350 passing tests/subtests, zero failures or skips. Each file was run independently with `--test-concurrency=2`; wall times include process startup. The root TypeScript check also passed. Regression tests for API-token expiry, MCP layout record restrictions and XML script denial were observed failing before their fixes.

Existing XML regressions: 18 passed, zero failed. The fixture-dependent API-token and AI privilege suites skipped 18 tests because their fixtures were unavailable. No fixtures were fetched. Generated-table freshness and `git diff --check` passed.

| Test file suffix | Wall time |
| --- | --- |
| `admin` | 10.72 s |
| `api-token` | 7.00 s |
| `dataapi` | 7.59 s |
| `mcp` | 11.15 s |
| `odata` | 6.97 s |
| `pgwire` | 7.22 s |
| `scripts` | 5.07 s |
| `sql` | 7.50 s |
| `web` | 6.68 s |
| `xml` | 5.73 s |

## Operation inventory

| Entry point | Operations exercised |
| --- | --- |
| Data API | Session creation; layout/script lists; layout metadata; list/get/find; field-bearing and empty create; duplicate; edit/delete of both records; multipart container upload/clear on both records; caller script execution; live extended-privilege revocation; password repair |
| OData | Service document; `$metadata`; list/get/count/filter; scalar and container reads; create; PATCH/PUT; container writes/clear; delete; caller script execution; allowed and rejected record-rule targets |
| Web client | Web session creation; layout menu/design; record view expressions; record pages/refresh/position; field index; history; CSV export; replace/duplicate/delete commands; URL script execution and printing |
| MCP | Database/layout descriptions; script source; numeric container reads; find/get; explicit-table and broad text search; summaries; create; single and bulk update; delete; container upload; script execution; SQL query and free-form calculation; readable alternative layouts and token layout scope |
| SQL HTTP | Table metadata; GET/POST SELECT; GET/POST CSV export; unsupported UPDATE |
| pgwire | Authentication; API tokens rejected as passwords; simple and extended query protocols; SELECT and catalog metadata; unsupported INSERT/UPDATE/DELETE; live password policy/date edits |
| XML | List/find/view; refusal of -script, -script.prefind and -script.presort with authentication and script-access precedence |
| API-token credentials | REST/web/OData/SQL/XML record reads; MCP find; Admin rejection; live password policy/date and must-change edits across every HTTP data surface; refused tokens do not update last-used time |
| Admin API touching a file | File list, client list, individual pause/resume/close/open, bulk status update, unsupported file removal; file credentials and file session tokens rejected, separate server-admin token accepted |
| Caller script engine | Named read/edit/create/delete/print scripts, both record-rule targets, anonymous export step; password expiry after policy/date edits |

This inventory is the record/security operation matrix, not an exhaustive catalog of every application feature, AI tool, OData expression, or script step. Operations absent from a protocol are not treated as authorization successes: SQL writes explicitly fail, and Admin API file removal explicitly reports unsupported.

## Expected outcomes

<!-- generated privilege tables -->

### Sign-in and raw SQL

REST/web columns are session creation codes. Expired passwords receive a repair-only token; every data operation is 212. A rejected login yields no session, so subsequent session-only route probes are 952. OData/MCP/SQL columns are credential/extended-privilege gates, before record rules. SQL JSON and CSV columns apply after that gate. PostgreSQL reports SQLSTATE.

| Shape | REST login | Web login | OData gate | MCP gate | SQL gate | SQL JSON | SQL CSV | pgwire login |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| no-access | 0 | 0 | 0 | 0 | 0 | 9 | 9 | 42501 |
| read-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| edit-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| blind-edit | 0 | 0 | 0 | 0 | 0 | 9 | 9 | 42501 |
| create-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| delete-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| field-read | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| field-write | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| field-none | 0 | 0 | 0 | 0 | 0 | 9 | 9 | 42501 |
| record-calculation | 0 | 0 | 0 | 0 | 0 | 9 | 9 | 42501 |
| table-calculation | 0 | 0 | 0 | 0 | 0 | 9 | 9 | 42501 |
| layout-view-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| fill-in-off | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| layout-records-none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| layout-none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| script-execute-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| script-none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| export-off | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 00000 |
| print-off | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| without-fmrest | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| without-fmodata | 0 | 0 | 9 | 0 | 0 | 0 | 0 | 00000 |
| without-fmmcp | 0 | 0 | 0 | 9 | 0 | 0 | 0 | 00000 |
| without-fmxdbc | 0 | 0 | 0 | 0 | 9 | 0 | 0 | 42501 |
| fmapp-only-web | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| fmwebdirect-only-web | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| without-web | 0 | 9 | 0 | 0 | 0 | 0 | 0 | 00000 |
| without-fmxml | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 00000 |
| other-keys-only | 9 | 9 | 9 | 9 | 9 | 0 | 0 | 42501 |
| no-keys | 9 | 9 | 9 | 9 | 9 | 0 | 0 | 42501 |
| expired | 0 | 0 | 212 | 212 | 212 | 0 | 0 | 28000 |
| locked | 212 | 212 | 212 | 212 | 212 | 0 | 0 | 28P01 |
| inactive | 212 | 212 | 212 | 212 | 212 | 0 | 0 | 28P01 |

### API-token record reads

These rows use an ohbt_ token issued before account restrictions are applied. Every HTTP data entry point revalidates the account on each request. Expired or must-change passwords invalidate API tokens: REST/web report 952, OData/SQL/XML report 212, and MCP reports HTTP 401 invalid_token. Password lockout does not revoke bearer credentials. Web routes use the API token’s fmrest authority. Admin routes never accept file tokens; pgwire does not accept API tokens as passwords. The in-process script engine has no bearer-token entry point; scripts entered through HTTP inherit that entry point’s authorization.

| Shape | REST | Web | OData | SQL | XML | MCP | Admin | pgwire |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| no-access | 200 | 200 | 102 | 9 | 200 | 200 | 9 | 28P01 |
| read-only | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| edit-only | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| blind-edit | 200 | 200 | 102 | 9 | 200 | 200 | 9 | 28P01 |
| create-only | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| delete-only | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| field-read | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| field-write | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| field-none | 0 | 0 | 0 | 9 | 0 | 0 | 9 | 28P01 |
| record-calculation | 0 | 0 | 0 | 9 | 0 | 0 | 9 | 28P01 |
| table-calculation | 0 | 0 | 0 | 9 | 0 | 0 | 9 | 28P01 |
| layout-view-only | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| fill-in-off | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| layout-records-none | 200 | 200 | 0 | 0 | 200 | 200 | 9 | 28P01 |
| layout-none | 105 | 105 | 0 | 0 | 105 | 105 | 9 | 28P01 |
| script-execute-only | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| script-none | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| export-off | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| print-off | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| without-fmrest | 9 | 9 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| without-fmodata | 0 | 0 | 9 | 0 | 0 | 0 | 9 | 28P01 |
| without-fmmcp | 0 | 0 | 0 | 0 | 0 | 9 | 9 | 28P01 |
| without-fmxdbc | 0 | 0 | 0 | 9 | 0 | 0 | 9 | 28P01 |
| fmapp-only-web | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| fmwebdirect-only-web | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| without-web | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| without-fmxml | 0 | 0 | 0 | 0 | 9 | 0 | 9 | 28P01 |
| other-keys-only | 9 | 9 | 9 | 9 | 0 | 9 | 9 | 28P01 |
| no-keys | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 28P01 |
| expired | 952 | 952 | 212 | 212 | 212 | HTTP 401 invalid_token | 9 | 28P01 |
| locked | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 28P01 |
| inactive | 952 | 952 | 212 | 212 | 212 | HTTP 401 invalid_token | 9 | 28P01 |

### MCP search and XML script refusal

MCP columns apply after authentication. Explicit Items searches require a layout permitting record reads (105 for no accessible layout, 200 for visible layouts denying records); broad searches omit those tables. Table and field restrictions filter search hits, with no-access tables returning no hits. A permitted alternative layout on the same table remains usable. XML columns include password authentication and fmxml gates: XML never executes scripts, returning 9 for a forbidden named script and 960 otherwise. The same rule covers -script.prefind and -script.presort.

| Shape | MCP search Items | MCP search all tables | MCP summarize | XML -findall | XML -script |
| --- | --- | --- | --- | --- | --- |
| all | 0 | 0 | 0 | 0 | 960 |
| no-access | 0 | 0 | 200 | 200 | 960 |
| read-only | 0 | 0 | 0 | 0 | 960 |
| edit-only | 0 | 0 | 0 | 0 | 960 |
| blind-edit | 0 | 0 | 200 | 200 | 960 |
| create-only | 0 | 0 | 0 | 0 | 960 |
| delete-only | 0 | 0 | 0 | 0 | 960 |
| field-read | 0 | 0 | 0 | 0 | 960 |
| field-write | 0 | 0 | 0 | 0 | 960 |
| field-none | 0 | 0 | 0 | 0 | 960 |
| record-calculation | 0 | 0 | 0 | 0 | 960 |
| table-calculation | 0 | 0 | 0 | 0 | 960 |
| layout-view-only | 0 | 0 | 0 | 0 | 960 |
| fill-in-off | 0 | 0 | 0 | 0 | 960 |
| layout-records-none | 200 | 0 | 200 | 200 | 960 |
| layout-none | 105 | 0 | 105 | 105 | 960 |
| script-execute-only | 0 | 0 | 0 | 0 | 960 |
| script-none | 0 | 0 | 0 | 0 | 9 |
| export-off | 0 | 0 | 0 | 0 | 960 |
| print-off | 0 | 0 | 0 | 0 | 960 |
| without-fmrest | 0 | 0 | 0 | 0 | 960 |
| without-fmodata | 0 | 0 | 0 | 0 | 960 |
| without-fmmcp | 0 | 0 | 0 | 0 | 960 |
| without-fmxdbc | 0 | 0 | 0 | 0 | 960 |
| fmapp-only-web | 0 | 0 | 0 | 0 | 960 |
| fmwebdirect-only-web | 0 | 0 | 0 | 0 | 960 |
| without-web | 0 | 0 | 0 | 0 | 960 |
| without-fmxml | 0 | 0 | 0 | 9 | 9 |
| other-keys-only | 0 | 0 | 0 | 0 | 960 |
| no-keys | 0 | 0 | 0 | 9 | 9 |
| expired | 0 | 0 | 0 | 212 | 212 |
| locked | 0 | 0 | 0 | 212 | 212 |
| inactive | 0 | 0 | 0 | 212 | 212 |

### Record operations through a layout

These are post-authentication codes for Data API/MCP record operations. A field-bearing create or edit supplies Name; upload targets Blob. The empty create supplies no fields. The calculation rows use the caller-owned record here; the other record is denied with 200 for reads, edits, uploads and deletes. Entry-point adaptations are listed below.

| Shape | Get/list | Find Name | Create Name | Create empty | Edit Name | Delete | Upload Blob |
| --- | --- | --- | --- | --- | --- | --- | --- |
| all | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| no-access | 200 | 102 | 201 | 200 | 201 | 200 | 201 |
| read-only | 0 | 0 | 200 | 200 | 200 | 200 | 200 |
| edit-only | 0 | 0 | 200 | 200 | 0 | 200 | 0 |
| blind-edit | 200 | 102 | 201 | 200 | 201 | 200 | 201 |
| create-only | 0 | 0 | 0 | 0 | 200 | 200 | 200 |
| delete-only | 0 | 0 | 200 | 200 | 200 | 0 | 200 |
| field-read | 0 | 0 | 201 | 0 | 201 | 0 | 201 |
| field-write | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| field-none | 0 | 102 | 201 | 0 | 201 | 0 | 201 |
| record-calculation | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| table-calculation | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| layout-view-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| fill-in-off | 0 | 0 | 200 | 200 | 200 | 200 | 200 |
| layout-records-none | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| layout-none | 105 | 105 | 105 | 105 | 105 | 105 | 105 |
| script-execute-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| script-none | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| export-off | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| print-off | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| without-fmrest | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| without-fmodata | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| without-fmmcp | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| without-fmxdbc | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| fmapp-only-web | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| fmwebdirect-only-web | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| without-web | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| without-fmxml | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| other-keys-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| no-keys | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| expired | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| locked | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| inactive | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Layout, script and output permissions

Metadata means the layout can be described; hidden fields are omitted. Execute tests use a caller-run Read script, so its record context must also be readable. Export tests use the web exporter or an anonymous Export Records step. Printing uses a named Print script. Account expiry/inactivity still takes precedence. The script engine receives an authenticated identity: extended privileges and password lockout are sign-in gates, not revocation of an already-running caller.

| Shape | Layout metadata | Read script | MCP script source | Web export | Print script | Admin file credential |
| --- | --- | --- | --- | --- | --- | --- |
| all | 0 | 0 | 0 | 0 | 0 | 9 |
| no-access | 0 | 200 | 0 | 200 | 200 | 9 |
| read-only | 0 | 0 | 0 | 0 | 0 | 9 |
| edit-only | 0 | 0 | 0 | 0 | 0 | 9 |
| blind-edit | 0 | 200 | 0 | 200 | 200 | 9 |
| create-only | 0 | 0 | 0 | 0 | 0 | 9 |
| delete-only | 0 | 0 | 0 | 0 | 0 | 9 |
| field-read | 0 | 0 | 0 | 0 | 0 | 9 |
| field-write | 0 | 0 | 0 | 0 | 0 | 9 |
| field-none | 0 | 0 | 0 | 0 | 0 | 9 |
| record-calculation | 0 | 0 | 0 | 0 | 0 | 9 |
| table-calculation | 0 | 0 | 0 | 0 | 0 | 9 |
| layout-view-only | 0 | 0 | 0 | 0 | 0 | 9 |
| fill-in-off | 0 | 0 | 0 | 0 | 0 | 9 |
| layout-records-none | 0 | 200 | 0 | 200 | 200 | 9 |
| layout-none | 105 | 105 | 0 | 105 | 105 | 9 |
| script-execute-only | 0 | 0 | 9 | 0 | 0 | 9 |
| script-none | 0 | 9 | 104 | 0 | 9 | 9 |
| export-off | 0 | 0 | 0 | 9 | 0 | 9 |
| print-off | 0 | 0 | 0 | 0 | 9 | 9 |
| without-fmrest | 0 | 0 | 0 | 0 | 0 | 9 |
| without-fmodata | 0 | 0 | 0 | 0 | 0 | 9 |
| without-fmmcp | 0 | 0 | 0 | 0 | 0 | 9 |
| without-fmxdbc | 0 | 0 | 0 | 0 | 0 | 9 |
| fmapp-only-web | 0 | 0 | 0 | 0 | 0 | 9 |
| fmwebdirect-only-web | 0 | 0 | 0 | 0 | 0 | 9 |
| without-web | 0 | 0 | 0 | 0 | 0 | 9 |
| without-fmxml | 0 | 0 | 0 | 0 | 0 | 9 |
| other-keys-only | 0 | 0 | 0 | 0 | 0 | 9 |
| no-keys | 0 | 0 | 0 | 0 | 0 | 9 |
| expired | 0 | 0 | 0 | 0 | 0 | 9 |
| locked | 0 | 0 | 0 | 0 | 0 | 9 |
| inactive | 0 | 0 | 0 | 0 | 0 | 9 |

<!-- end generated privilege tables -->

## Documented protocol and context differences

| Difference | Expected behavior and reason |
| --- | --- |
| Data API vs web/MCP error envelope | Data API errors use `messages[].code`; web route errors use `error.code`; MCP uses `isError` and a numeric code in its text JSON. Script execution can return an HTTP success with a nonzero script error. The matrix checks that inner error. |
| No REST/web session | Missing surface privilege denies login with 9; locked/inactive credentials deny login with 212. All attempted session-only operations then return 952 because no token exists. Separate tests revoke privileges from already-issued tokens and require 9. |
| OData hides tables/properties | A no-view table is absent from service metadata and entity requests return 102. Hidden fields are absent from `$metadata`; referring to one returns 102, including writes, whereas record APIs return 201 for a forbidden target field. |
| OData hides individual rows | A single entity filtered out by a view calculation returns 101 (missing), versus 200 on direct record APIs. Its absence from lists/counts and refusal of writes are asserted. |
| OData is occurrence-based | Ordinary OData reads/writes do not use a layout, so layout-none/fill-in restrictions do not narrow them. OData scripts do use a layout and retain its restrictions. |
| SQL and MCP raw readers | SQL HTTP/pgwire require `fmxdbc` and unrestricted record/field visibility. MCP SQL/free-form calculation requires `fmmcp` and unrestricted visibility. Row-limited or hidden-field accounts fail with 9 / SQLSTATE 42501 instead of receiving filtered SQL. A free-form calculation additionally needs its layout context; SQL has no layout context. |
| SQL writes | HTTP SQL is read-only and returns 8310; pgwire returns 25006. A prior authentication/visibility failure takes precedence. Neither permits mutation even for an all-records account. |
| Printing/exporting | Their flags do not disable ordinary record reads. Explicit CSV export is gated; SQL JSON and pgwire SELECT remain reads. Web/script output checks also require the readable layout context. |
| Web expressions/index | View expressions omit inaccessible records and field indexes return an empty list for a hidden field. An empty result is an allowed filtered response, not a data disclosure. Record reads and writes are tested separately. |
| MCP description/container reads | A no-view table profile returns zero records and no fields. A layout with record access `none` cannot be sampled (200). Numeric container reads require unrestricted visibility; restricted accounts must supply a signed URL from an allowed record (9 otherwise). Script source is hidden (104) for script-none and denied (9) for execute-only, while execution remains allowed. |
| MCP text search | Searches name tables, not layouts. A selected table must have a layout permitting record reads: 105 if no layout is accessible, 200 if accessible layouts deny records. Broad searches omit inaccessible tables. Search selects a readable alternative layout when available, while honoring token scope and table/field/record restrictions. |
| XML scripts | XML is read-only and never runs scripts. After authentication, a forbidden named script returns 9; otherwise script parameters return 960 because execution is unsupported here. This applies to -script, -script.prefind and -script.presort. XML errors generally use HTTP 200 with an XML error code; invalid credentials use HTTP 401. |
| Script context | The script engine opens its layout/record context before executing a step; an inaccessible table can therefore return 200 before a field-specific 201. Named scripts require execute permission; anonymous caller steps have their own data/output gates. `viewOnly` on a script is execute-only, not permission to read its text. |
| Script last error | Script results report the last executed step's error. Test scripts end at the operation under test so a later successful step cannot clear a denial. Print uses error capture to return its denial instead of waiting on a browser dialog. |
| Layout design vs fill-in | `layouts: viewOnly` permits viewing the design while record writes remain governed separately. The fill-in-off row sets layout record access to view-only. Layout record `none` forbids both reading and writing while still permitting metadata about the visible layout. |
| Extended privileges | REST needs `fmrest`; OData `fmodata`; MCP `fmmcp`; SQL `fmxdbc`; XML `fmxml`; web sessions accept either `fmapp` or `fmwebdirect`. These keys and `fmurlscript`/custom keys do not substitute for other gates. API tokens on web routes retain their `fmrest` authority. |
| Expired vs locked | An expired password gets a repair-only REST/web session and no data access; other credential-based entry points deny it. Password policy and password-date edits are checked on already-open sessions and script execution. Lockout prevents new password authentication; it does not revoke an existing authenticated script identity. Inactive identities cannot run scripts. |
| Expired API tokens | Password expiry or a required password change invalidates an account's API tokens on every use, without marking them used. REST/web return 952, OData/SQL/XML 212, and MCP HTTP 401 `invalid_token`. Policy removal or password repair restores the existing token; password lockout alone does not revoke it. Session-based password repair remains available. |
| Admin API authority | The server administrator is a separate principal, not a file privilege set. File passwords and Data API tokens always fail with 9 on file administration routes, irrespective of file rights. A server-admin token may operate the temporary hosted file. Deletion remains unsupported (21). |

## Bugs fixed by this matrix

- Layout record access `none` was ignored by shared record reads. The store now denies those reads, and MCP layout profiles cannot bypass the restriction with sample values. This preserves visible layout metadata and occurrence-based access.
- MCP text search now requires a readable layout before indexing or searching a table, including broad searches and layout-scoped API tokens.
- SQL CSV export bypassed export-off. Both GET and POST now check the source and resolved target file's export permission before querying.
- Expired-password web sessions could read data, and already-open sessions did not consistently follow password-age policy changes. Shared session authorization and pgwire now recheck expiry; password repair remains reachable. Caller script execution also follows current password policy.
- The shared API-token resolver now rejects expired-password and must-change accounts before recording token use, closing the SQL/OData/XML/MCP token bypass.
- XML reports 9 for forbidden named scripts before its general 960 refusal of script execution through a read-only interface.
- Direct named script entry bypassed execute permission. The engine now checks the caller before running a named schema script, including a schema script passed as an object; anonymous steps retain step-level checks.
- MCP discarded numeric codes for untagged store/privilege failures; raw-reader denials and bulk-update wrappers also lost them. Codes now survive to the protocol response, with atomic bulk-update rollback retained. Hidden bulk-write targets use the same 201 refusal as individual record writes.

## Claris evidence limits

These are executable expectations for this repository, not a claim that every Claris product/version returns identical HTTP statuses or error envelopes. No Claris instance was available for this audit. Exact Claris results for edit-without-view definitions, layout record-none behavior, expired/locked account responses across all protocols, and any independent fill-in flag are **unknown**. No new Claris numeric mapping or binary privilege decoding was guessed. The existing importer explicitly treats unverified field byte `0x01` conservatively; this matrix constructs explicit privilege definitions and does not alter that import policy. `fmmcp`, this MCP protocol, PostgreSQL wire access, and the web JSON routes are project-specific interfaces. <!-- known-difference: Privileges and security ;; What FileMaker answers for edit-without-view definitions, layouts with no record access and expired or locked accounts over each protocol is unknown, and field byte 0x01 of an imported privilege set is read conservatively ;; Those cases follow this project's own choice (fail closed); an imported set can hide a field FileMaker shows ;; A Claris file and server run that exercises each case -->
