# Data API compatibility

This page compares Tabularius's REST API at `/fmi/data/{version}` with Claris's
[FileMaker Data API Guide](https://help.claris.com/en/data-api-guide/). It
covers every endpoint, request field, response shape, error code and header,
each marked supported, partial or missing.

✓ supported · ◐ partial · ✗ missing · ＋ Tabularius only (not in FileMaker's Data API)

A machine-readable form of these rows is the server's own [OpenAPI description](openapi.md).

Four test files check these rows:

- `packages/server/test/dataapi-response-contract.test.ts` loads the response
  contract from `dataapi-response-contract.json`, exercises each documented
  JSON endpoint against an in-process server, and checks the response and
  common error status codes. Unknown protocol keys fail. The data file lists
  shapes the public guide does not establish under `notVerified`.

- `packages/server/test/dataapi-shapes.test.ts` checks the exact response keys
  of every supported endpoint. It uses a database built in the test, so it
  needs no sample files.
- `packages/server/test/dataapi-conformance.test.ts` checks behaviour against
  the public sample files.
- `packages/server/test/dataapi-client-shapes.test.ts` sends the requests that
  community client libraries are documented to send (JSON text in query
  parameters, numbers as text, a body with no JSON content type, a trailing
  slash, a Bearer token) and checks each is answered as FileMaker Server does.

**Sources.** The response contract was checked against the live public
[Claris FileMaker Data API Guide](https://help.claris.com/en/data-api-guide/)
and its endpoint examples. Earlier behaviour notes also use the older guides
for FileMaker 17–19 and the existing conformance tests. A row marked
*(unconfirmed)* is behaviour the guide's text didn't settle. Check those <!-- known-difference-ok: explains the unconfirmed mark used by the rows below -->
against a FileMaker Server before relying on them.

## Versions and the envelope

| | Status | Notes |
| --- | --- | --- |
| `v1`, `v2`, `vLatest` in the path | ✓ | All three answer the same. |
| `{ "response": {…}, "messages": [{ "code", "message" }] }` | ✓ | `code` is a string; success is `"0"` / `"OK"`. On an error, `response` is `{}`. |
| ＋ `tabularius:denial` beside the error envelope | ＋ | A structured access-denial explanation when a privilege rule refuses a call. The `response` member remains `{}`. |
| `recordId` and `modId` as strings; counts as numbers | ✓ | |
| Number fields as JSON numbers, text as strings | ✓ | |
| `Content-Type: application/json; charset=utf-8` on every reply | ✓ | |

## Endpoints

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /databases/{db}/sessions` (log in) | ◐ | HTTP Basic `Authorization`. Answers `{token}` and the `X-FM-Data-Access-Token` header. `fmDataSource` with an account and password for each other hosted file. Or OAuth, with the `X-FM-Data-OAuth-*` headers (see OAuth below). **Missing:** OAuth for `fmDataSource`. ＋ `passwordChangeRequired: true` when the account must change its password first. |
| `DELETE /databases/{db}/sessions/{token}` (log out) | ✓ | No `Authorization` header needed. Answers `{}`. |
| `GET /validateSession` | ✓ | Answers `{isSessionInUse}` for a live token and error 952 / HTTP 401 otherwise. Checking a token doesn't keep it alive (fixed here; it used to). `isSessionInUse` is `true` while a call made with that token (a script, say) is still running, else `false`. A call using a scoped API token or another session's token doesn't count. |
| `GET /productInfo` | ✓ | `name` (`tabularius`), `dateFormat`, `timeFormat`, `timeStampFormat`. ＋ `buildDate` and `version`; the [Claris example](https://help.claris.com/en/data-api-guide/content/get-product-information.html) does not contain them. |
| `GET /databases` | ◐ | `{databases: [{name}]}`. By default Tabularius lists no file (404): FileMaker Server asks for an account and lists the files it can open, but checking an account against every file costs a password check and a failed sign-in per file, so the list is off instead. Start the server with `--list-files-publicly` (or `TABULARIUS_LIST_FILES_PUBLICLY=1`) for `{databases: [{name}]}` for anyone. Clients name the file in the address as before. |
| `GET /databases/{db}/layouts` | ✓ | `{name}` for each layout, and `{name, isFolder: true, folderLayoutNames}` for folders, in the file's order. ＋ `table` on each layout. Empty folders and layouts the account can't use are left out. |
| `GET /databases/{db}/scripts` | ✓ | `{name, isFolder}` and folders with `folderScriptNames`. Separators show as `"-"`. |
| `GET /databases/{db}/layouts/{layout}` (metadata) | ✓ | `fieldMetaData`, `portalMetaData` (by portal) and `valueLists` (when the layout uses any). `displayType` now follows how the field is shown (fixed here; it was always `editText`). `recordId` lists value lists of related values for that record; it answers as a read of that record would (101 when there is none, 200 when record access hides it). Without it they're left out. |
| `GET .../layouts/{layout}/records` (a range) | ◐ | `_offset` (default 1), `_limit` (default 100), `_sort`, `portal`, `_offset.{portal}`, `_limit.{portal}`, `dateformats` and the script parameters. Answers `dataInfo` and `data`. A bad `_sort`, `_offset` or `_limit` is now error 960 (fixed here; it was "Unknown error"). `layout.response` answers with another layout of the same table. |
| `GET .../records/{id}` (one record) | ◐ | `portal`, per-portal paging, `dateformats` and scripts. `layout.response` answers with another layout of the same table. |
| `POST .../records` (create) | ◐ | `fieldData`. `portalData` now adds related records with the new one (fixed here; it was ignored). Answers `{recordId, modId}`. `options.entrymode` and `options.prohibitmode` (both `user` or `script`). |
| `PATCH .../records/{id}` (edit) | ◐ | `fieldData` and `modId` (error 306 on a mismatch). `portalData` rows with a `recordId` edit them; rows without one add related records. `fieldData.deleteRelated` deletes related rows. Answers `{modId}`. `options.entrymode` and `options.prohibitmode`. ＋ `styles` (text formatting). |
| `POST .../records/{id}` (duplicate) | ✓ | Answers `{recordId, modId}`. |
| `DELETE .../records/{id}` | ✓ | Answers `{}`. Script parameters are given in the query string. |
| `POST .../layouts/{layout}/_find` | ◐ | `query` (with `omit: "true"`), `sort`, `offset`, `limit`, `portal`, `offset.{portal}`, `limit.{portal}`, `dateformats` and scripts. Nothing found is error 401, HTTP 500. A bad `sort`, `offset` or `limit` is error 960. `layout.response` answers with another layout of the same table. |
| `PATCH /databases/{db}/globals` | ✓ | `{globalFields: {"Table::Field": value}}`, for the session. Answers `{}`. Without `globalFields`: error 958; `globalFields` that is not an object: error 960. A `dateformats` other than 0, 1 or 2 is error 960. |
| `POST .../records/{id}/containers/{field}[/{repetition}]` | ✓ | Multipart; only the part named `upload` is read. `modId` in the query string is checked. Answers `{}` as the [Claris guide](https://help.claris.com/en/data-api-guide/content/upload-container-data.html) shows. The file is spooled to disk while it arrives and written to the field in 1 MiB pieces, not held whole. Beyond FileMaker: `?portal=<portal name>&portalRecordId=<the row's recordId>` puts the file in that row's related record (it must be one of this record's portal rows); DELETE with the same query empties it. |
| `POST .../records/{id}/container-uploads/{field}[/{repetition}]` and `GET`, `PUT ?offset=N`, `POST .../finish`, `DELETE` on `.../layouts/{layout}/container-uploads/{upload}` | beyond FileMaker | A file in pieces that can be picked up again, for files too big for one request over a connection that may drop. Not part of FileMaker's Data API. Start with `{filename, mime, size}` (and optionally `sha256`, checked at the end, and `modId`, checked at the start and again at the finish, where a mismatch drops the upload; `?portal=` and `?portalRecordId=` work as for a single upload); the answer has `uploadId`, `received` and `maxPiece` (64 MiB). `PUT ?offset=N` sends raw bytes and must start at `received` (a different offset is 409 and says where to start); `GET` says how much has arrived, so an interrupted upload asks and goes on; `finish` puts the file in the field with the same checks as a single upload, with the account's privileges at that moment, and answers `{}`; `DELETE` forgets what arrived. The most a file can be is 1 GiB, an account may have 4 uploads going in a file (429, error 212, when it asks for a fifth) and all accounts together 8 GiB. The pieces wait in a file in `TABULARIUS_UPLOAD_TMP`; an upload that receives no bytes for 24 hours (asking how far it has got does not count) (`TABULARIUS_UPLOAD_IDLE_HOURS`, 0 keeps them) is dropped, and one does not survive a restart of the server. With `--workers`, calls with the same token reach the same worker, so an upload is always found there. Another account's upload is as if it were not there (404). A read-only API token may not use these. Pieces do not hold up the session's other writes. |
| `GET .../layouts/{layout}/script/{script}` | ✓ | `script.param`. Always answers `scriptError`; Tabularius also answers `scriptResult`. The [Claris example](https://help.claris.com/en/data-api-guide/content/run-a-script.html) shows only `scriptError`, so the contract treats `scriptResult` as optional. |
| Scripts with another request | ✓ | `script`, `script.param`, `script.prerequest[.param]` and `script.presort[.param]` on get, find, create, edit, duplicate and delete. Each phase answers `scriptResult[.phase]` and `scriptError[.phase]` beside the response. |
| OAuth (`/oauth/getoauthurl` and the `X-FM-Data-OAuth-*` headers) | ✓ | Through the OpenID Connect providers set up (see the README): `GET /fmws/oauthproviderinfo`, `GET /oauth/getoauthurl` (`trackingID`, `provider` by name, `X-FMS-Return-URL`; answers the provider's address in the body and `X-FMS-Return-URL`, and `X-FMS-Request-ID`), the person sent back with `trackingID` and `identifier` (or `error`), then log in with the two headers. The file's external accounts decide, as for the web client. Differences: the return address must be this server or one the provider lists (`dataApiReturnUrls`; this computer only when listed with its port, so FileMaker Server's `http://127.0.0.1/` example needs listing); the person always picks their account at the provider; an identifier works once, within five minutes; the shape of `oauthproviderinfo`'s answer (`{data: [{Name, Slug}]}`) is not checked against FileMaker Server's *(unconfirmed)*. | <!-- known-difference: Data API ;; The shape of the oauthproviderinfo answer ({data: [{Name, Slug}]}) is not checked against FileMaker Server ;; A client written against FileMaker Server's answer may read it differently ;; A captured /fmws/oauthproviderinfo answer from FileMaker Server -->
| Claris ID sign-in (FileMaker Cloud) | ✗ | Doesn't apply. |
| ＋ Largest `_limit` | ＋ | A request may ask for at most 10,000 records (or portal rows) at a time (`TABULARIUS_DATA_API_MAX_LIMIT`, 0 for no cap). More is refused with error 960 and a message that says to page with `_offset`, not cut down, so a client that pages until it gets fewer records than it asked for fails at once instead of stopping after the first page. What FileMaker does past its own limits is not checked here. |
| ＋ Sessions per account | ＋ | One account holds at most 100 sessions in a file at once (`TABULARIUS_MAX_SESSIONS_PER_ACCOUNT`, 0 for no limit). Signing in past that ends the session used longest ago, so a script that signs in again and again keeps working. API tokens aren't counted. An account shared by many people or devices (a kiosk or a guest account) should have the limit raised, or people beyond it keep signing each other out; each eviction is logged as a warning. In a cluster each process counts its own. |
| ＋ `PATCH /databases/{db}/sessions` (change own password) | ＋ | `{oldPassword, newPassword}`. |
| ＋ `.../sessions/passkey`, `.../sessions/recovery`, `/passkey`, `/recovery-codes` | ＋ | Passkey and recovery-code sign-in, and managing them, for the web client. |

## Records in replies

| Field | Status | Notes |
| --- | --- | --- |
| `dataInfo`: `database`, `layout`, `table`, `totalRecordCount`, `foundCount`, `returnedCount` | ✓ | `table` is the layout's table occurrence. |
| `data[]`: `fieldData`, `portalData`, `recordId`, `modId` | ✓ | Related fields on the layout come as `"TO::Field"`. |
| `portalData.{portal}[]`: `recordId`, `modId`, `"TO::Field"` | ✓ | Portals are named by object name, else by table occurrence. |
| `portalDataInfo[]`: `portalObjectName`, `database`, `table`, `foundCount`, `returnedCount` | ＋ | Only for the portals returned. The public guide's record examples do not show this key; its presence on a FileMaker Server is not verified. |
| Container fields as URLs | ✓ | Signed download URLs that expire (see the README). |
| `dateformats` 0 (US), 1 (file locale), 2 (ISO 8601) | ✓ | |
| ＋ `updating`, `styles`, `portalStyles` on a record | ＋ | Only when present: values being recalculated, and text formatting. FileMaker's clients ignore extra keys. |

## Layout metadata fields

| Field | Status | Notes |
| --- | --- | --- |
| `name`, `type` (`normal`, `calculation`, `summary`), `result`, `global` | ✓ | |
| `displayType` | ✓ | `editText`, `popupList` (drop-down list), `popupMenu`, `checkBox`, `radioButtons`, `calendar`, `secureText` (a concealed edit box). It is taken from the field's first object on the layout, so a field not on the layout shows `editText`. |
| `autoEnter`, `fourDigitYear`, `maxRepeat`, `maxCharacters`, `notEmpty`, `numeric`, `timeOfDay`, `repetitionStart`, `repetitionEnd` | ✓ | Taken from the field's options. ＋ `repetitions` too. |
| `valueLists[]`: `name`, `type` (`customList`, `byField`), `values[]` of `{value, displayValue}` | ✓ | Lists of related values are listed when the request gives `recordId`. |

## Headers

| Header | Status | Notes |
| --- | --- | --- |
| `Authorization: Basic …` on log in | ✓ | |
| `Authorization: Bearer {token}` on every other call | ✓ | ＋ `X-FM-Data-Access-Token: {token}` is accepted too. ＋ Scoped API tokens (`ohbt_…`) work as bearer tokens without logging in. |
| `X-FM-Data-Access-Token` on the log-in reply | ✓ | |
| `Content-Type: application/json` on requests | ◐ | Not required: a JSON body is read whatever the header says. |
| `Content-Type: multipart/form-data` for container uploads | ✓ | |
| `X-FM-Data-OAuth-Request-Id`, `X-FM-Data-OAuth-Identifier` | ✓ | See OAuth above. |
| ＋ `X-Tabularius-OTP` | ＋ | The six-digit code for an account with two-factor sign-in. |

## Error codes and HTTP statuses

The guide gives HTTP 400-level statuses for HTTP errors and 500-level ones for
FileMaker errors, with the FileMaker code in `messages[0].code`.

| Code | When | HTTP | Status |
| --- | --- | --- | --- |
| 0 | Success | 200 | ✓ |
| 3 | Unknown path or method | 404 | ✓ |
| 9 | Insufficient privileges (missing `fmrest`, a read-only token writing) | 401 / 403 | ✓ |
| 10 | Requested data is missing (a find without `query`) | 400 | ◐ *(unconfirmed whether FileMaker Server answers 400 or 500)* | <!-- known-difference: Data API ;; Whether FileMaker Server answers 400 or 500 for a find without query (code 10) is unconfirmed; Tabularius answers 400 ;; A client that checks the HTTP status of that error sees 400 ;; A FileMaker Server run of a find with no query -->
| 101 | Record is missing | 500 | ✓ |
| 102 | Field is missing | 500 | ✓ |
| 105 | Layout is missing | 500 | ✓ |
| 200, 201 | Record or field access denied | 500 | ✓ |
| 212 | Invalid account or password, or locked out after too many tries | 401 | ✓ |
| 301 | Record is in use by another session | 503 (with Retry-After: 1) | ✓ |
| 306 | `modId` doesn't match | 500 | ✓ |
| 401 | No records match the request | 500 | ✓ |
| 500–511 | Field validation failed | 400 for 500 and 508, otherwise 500 | ✓ |
| 802 | Unable to open the file (not hosted) | 404 | ✓ |
| 812 | Log in refused: the server is blocking new users (Admin API `blocknewusers`) | 503 | ◐ *(unconfirmed which code and status FileMaker Server answers)* | <!-- known-difference: Data API ;; Which code and status FileMaker Server answers when it is blocking new users (code 812) is unconfirmed; Tabularius answers 503 ;; A client sees 503 and code 812 ;; A FileMaker Server run with new users blocked -->
| 952 | Invalid Data API token | 401 | ✓ |
| 958 | Parameter missing (`globalFields`) | 400 | ◐ *(unconfirmed, as for 10)* | <!-- known-difference: Data API ;; Whether FileMaker Server answers 400 for a missing globalFields parameter (958) is unconfirmed ;; A client sees 400 ;; A FileMaker Server run of a request without globalFields -->
| 960 | Parameter is invalid (bad JSON, `_sort`, `_offset`, `_limit`, globals) | 400 | ◐ *(unconfirmed, as for 10)* | <!-- known-difference: Data API ;; Whether FileMaker Server answers 400 for an invalid parameter such as bad JSON, _sort, _offset, _limit or globals (960) is unconfirmed ;; A client sees 400 ;; A FileMaker Server run of each bad parameter -->
| 1211 | A one-time code is needed (two-factor sign-in) | 401 | ＋ |
| −1 | Unknown error | 500 | ✓ |

## Fixed in this change

- **`validateSession`** no longer keeps the token alive. Only calls that use
  the token do, as the guide describes.
- **Create a record** accepts `portalData`, adding related records with the
  new one, as the guide's Create a record allows. It used to ignore them.
- **Field metadata `displayType`** now names how the field is shown
  (`popupList`, `checkBox`, `secureText` and so on). It used to say
  `editText` for every field.
- **A `_limit` above 10,000** (or `limit` in a find, or a portal's `_limit.{portal}`)
  is error 960 too; see `TABULARIUS_DATA_API_MAX_LIMIT`.
- **A bad `_sort`, `_offset` or `_limit`** (or `sort`, `offset` or `limit` in a
  find) is now error 960, "Parameter is invalid". It used to give −1 "Unknown
  error" or a confusing database error.
- **`layout.response`** on Get records, Get a record and Perform a find: the
  request's layout finds and sorts, and the records come back with the
  response layout's fields and portals (`dataInfo.layout` names it). A
  response layout that isn't there is error 105. One on a different table is
  error 960; FileMaker's own answer for that case is not checked here.
- **`options.entrymode` and `options.prohibitmode`** on create and edit.
  `entrymode: "script"` skips validation set to "Only during data entry"
  (fields validated "Always" are still checked). `prohibitmode: "script"` may
  change fields that prohibit modification during data entry. Both default to
  `user`, and any other value is error 960. These follow the guide's
  description; they haven't been compared with a real FileMaker Server.
- **`fmDataSource`** on log in: `[{database, username, password}]` for other
  hosted files whose tables the file's layouts show. Each is checked at log
  in, and a wrong one fails it with error 212 (a file that isn't hosted is
  802). In those files, that account's privileges apply. Without it, the
  session's own account name is used there, as before.

## Missing, by how much clients use it

1. **OAuth for `fmDataSource`** (an identity-provider sign-in for each other hosted file at log in).

## Sources

- [Log in to a database session](https://help.claris.com/archive/fm19/en/data-api-guide/content/log-in-database-session.html), [Log in to an external data source](https://help.claris.com/en/data-api-guide/content/log-in-external-data-source.html)
- [Get a range of records](https://help.claris.com/en/data-api-guide/content/get-range-of-records.html), [Perform a find request](https://help.claris.com/en/data-api-guide/content/perform-find-request.html)
- [Create a record](https://help.claris.com/en/data-api-guide/content/create-record.html), [Edit a record](https://help.claris.com/en/data-api-guide/content/edit-record.html)
- [Upload container data](https://help.claris.com/en/data-api-guide/content/upload-container-data.html), [Set global field values](https://help.claris.com/en/data-api-guide/content/set-global-field-values.html)
- [Run a script](https://help.claris.com/en/data-api-guide/content/run-a-script.html), [Run a script with another request](https://help.claris.com/en/data-api-guide/content/run-script-with-another-request.html), [Get metadata](https://help.claris.com/en/data-api-guide/content/get-metadata.html)
- [Write FileMaker Data API calls](https://help.claris.com/en/data-api-guide/content/write-data-api-calls.html), [Error responses](https://help.claris.com/en/data-api-guide/content/error-responses.html), [FileMaker error codes](https://help.claris.com/en/pro-help/content/error-codes.html)
- [FileMaker 18 Data API Guide](https://help.claris.com/archive/docs/18/en/dataapi/) (validateSession, `dateformats`, `layout.response`, OAuth headers)

### Find operators and resource limits

Find requests run in order: an include adds matching records, an omit removes them,
and a later include can restore them. An initial omit starts with all visible records;
omit-only requests work through the store, Perform Find, and the Data API.
Duplicate (`!`) groups use only records the account may view, including repetitions,
unstored calculations, and related fields. Calculated find sources are materialized
once per find and indexed by record ID.

Numeric `#` patterns match the complete stored numeric value, so `#` does not match
`30.3`; `##.#` does. Numeric `?` finds nonempty values with no digits, such as
`twelve`, while `twelve30` is not invalid for this operator. Relaxed `~` searches
on Japanese-indexed fields match inside words as well as at their start; `=` and
`==` retain their word and field constraints.

Each criterion is limited to 4,096 UTF-16 code units. Wildcard matching is iterative,
without backtracking or recursion. Per field value (or repetition), matching may visit at most 4,000,000 token positions:
each visited input position (including the end position if reached) costs pattern
token count + 1. Tokens are Unicode characters or wildcard operators; adjacent `*` operators
collapse to one token. A trailing `*` can accept the remaining value immediately once
its prefix matches. Values are streamed without allocating a character array; relaxed
matching additionally limits input normalization to 4,000,000 UTF-16 code units.
Exceeding a limit returns FileMaker find error 400, including through Perform Find
and the Data API, rather than an internal error.

These semantics follow Claris's [numeric finds](https://help.claris.com/en/pro-help/content/finding-numbers-dates-times-timestamps.html),
[text finds](https://help.claris.com/en/pro-help/content/finding-text.html), and
[ordered omit requests](https://help.claris.com/en/pro-help/content/omitting-records.html).
