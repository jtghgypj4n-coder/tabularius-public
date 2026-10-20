# Script error codes

`Get ( LastError )` after a failing step, compared with FileMaker. The numbers
and meanings follow Claris's current list,
<https://help.claris.com/en/pro-help/content/error-codes.html> (read 2026-10-13).
`packages/store/src/error-codes.ts` holds every code with a short meaning, and
`packages/scripts/test/error-codes.test.ts` runs each row below.

Claris's list says what each code means, not which step returns it. So each
row also says where the expectation comes from:

- **Meaning**: the code whose meaning in Claris's list is exactly the failure.
- **Reported**: what FileMaker developers report seeing (link given).
- **Inferred**: our best reading. No FileMaker run backs it yet. <!-- known-difference-ok: explains the Inferred mark used by the rows below -->

| Failing step | Tabularius before | Tabularius now | Source |
|---|---|---|---|
| Go to Record [ Next ] on the last record (no Exit after last) | 101 | 101 | Reported ([Brian Dunning, error 101](https://www.briandunning.com/errors/96)) |
| Go to Record [ Previous ] on the first record | 101 | 101 | Inferred (same as Next) | <!-- known-difference: Scripts and script steps ;; Go to Record [ Previous ] on the first record gives 101, inferred from Next ;; A script reading Get ( LastError ) there sees 101 ;; A FileMaker run of the step on the first record -->
| Go to Record [ First ] / by number with no such record | 101 | 101 | Meaning ("Record is missing") |
| Go to Layout by a name that isn't there | 105 | 105 | Meaning |
| Perform Find / Constrain Found Set, no match | 401 | 401 | Meaning |
| Perform Find with no criteria | 400 | 400 | Meaning |
| Set Field into a calculation field | 201 | 201 | Meaning ("Field cannot be modified") |
| Set Field / Delete Record / Omit Record with no current record | 101 | 101 | Meaning |
| Set Field By Name, a field that isn't there | 102 | 102 | Meaning |
| Select Window / Close Window, a window that isn't there | 112 | 112 | Meaning |
| Go to Object, an object that isn't there | 116 | 116 | Meaning ("Layout object is missing") |
| Go to Field, a field not on the layout | 102 | 102 | Inferred | <!-- known-difference: Scripts and script steps ;; Go to Field to a field that is not on the layout gives 102, inferred ;; A script reading Get ( LastError ) there sees 102 ;; A FileMaker run of the step -->
| Go to Related Record, nothing related to the current record | 101 | 101 | Reported ([Brian Dunning, error 101](https://www.briandunning.com/errors/96)) |
| Go to Related Record, matching the found set, nothing related | 101 | **401** | Reported (same page: "returns 401 instead") |
| Undecoded Revert Transaction options, unspecified Set Revert Transaction on Error state, or undecoded binary Import Records mode | — | 3 | Tabularius capability decision based on Claris’s “Command is unavailable”; detail explains repair. No automatic transaction rollback. |
| Revert Transaction with an error code | 5000-5499 | 5000-5499 | Meaning |
| Re-Login with a wrong account name or password | 213 | **212** | Meaning ("invalid user account or password"); 213 is no longer in Claris's list |
| Delete / Reset / Enable Account, an account that isn't there | 213 | 213 | Inferred: 213 meant "User account and/or password does not exist" in FileMaker 14's list, and Claris's current list drops it | <!-- known-difference: Scripts and script steps ;; Delete, Reset or Enable Account on an account that is not there gives 213, inferred from FileMaker 14's list (Claris's current list drops it) ;; A script reading Get ( LastError ) there sees 213 ;; A FileMaker run of each step on a missing account -->
| AI steps naming an AI account Configure AI Account didn't set up | 3 | **877** | Meaning ("AI account not found") |
| Insert from URL, a malformed URL | 1631 | **1630** | Meaning ("URL format is incorrect") |
| Insert from URL, a protocol other than http/https | 1631 | **1626** | Meaning ("Protocol not supported") |
| Send Mail in outbound test mode, the test copy fails | 1631 | **1506** | Meaning ("Email messages not sent successfully") |
| Commit, validation fails (date, time, number, range, unique, existing, value list, calculation, not empty, max characters) | 500-511 | 500-511 | Meaning |
| Steps only FileMaker Pro can do (Insert from Device, Insert from Index, Get Folder Path, AppleScript), when no person can answer | 3 | 3 | Meaning ("Command is unavailable") |
| Read from Data File past the end | 10 | 10 | Meaning ("Requested data is missing") |
| Create Data File, Export Records or Save Records as PDF where the system refuses to write (a folder in the way, no permission) | the script stopped on a system error | **800** | Meaning ("Can't create the file on disk") |
| Open, Read, Write, Delete or Rename File, when the system refuses | the script stopped on a system error | **802** | Meaning ("Can't open the file") |
| Any file step when the disk is full | the script stopped on a system error | **809** | Meaning ("Disk is full") |
| Any file step with a name or path the system can't use (too long, a file where a folder should be) | the script stopped on a system error | **850** | Meaning ("Path is invalid for the operating system") |
| Import Records of a file type that can't be imported, or a damaged Excel workbook | 3 | **700** | Meaning ("Wrong file type for import") |
| Import Records of a file with nothing in it | 0, nothing added | **731** | Meaning ("The import file has no data"); a file with only a header line imports as before |

## Calculation codes (EvaluationError, and steps whose calculation fails)

The codes from 1202 up were one lower than Claris's list. "Too many
parameters" was 1205 and is now 1202, for example.

| Problem | Before | Now |
|---|---|---|
| Too few parameters | 1201 | 1201 |
| Too many parameters | 1205 | 1202 |
| Unexpected end of calculation | 1202 | 1203 |
| Number, text, field name or "(" expected | 1203 | 1204 |
| Comment not ended with */ | 1204 | 1205 |
| Text missing its closing quotation mark | 1205 | 1206 |
| Unbalanced parenthesis | 1206 | 1207 |
| Operator missing or function not found | 1207 | 1208 |
| Name missing | 1208 | 1209 |
| Expression where a field alone is needed | 1210 | 1214 |
| Recursion too deep (no FileMaker code of its own) | 1213 ("Variable already defined in Let") | 1200 (generic) |

## Left as they are, for now

- **Delete, Reset or Enable Account on a missing account (213).** Claris no longer lists 213. A FileMaker run would show what current versions return.
- **Show All Records and Sort Records with no records (0).** It isn't known whether FileMaker sets 401 here.
- **Set Field into repetition 0 (0).** It isn't known whether FileMaker sets 111.
- **The Data API's two-factor prompt (1211).** This is Tabularius's own sign-in signal, not a script error.
- **A change waiting for a person's approval (952).** This is reported to AI agents, not to scripts.

## Cross-module corrections

The [Claris error-code list](https://help.claris.com/en/pro-help/content/error-codes.html)
(checked 2026-10-15) assigns 106 to a missing table, 108 to a missing value
list, 111 to an invalid field repetition, and 960 to an invalid parameter.
Base-table lookups (including audit history/settings, record-rule previews,
field indexes, and record restoration) and OData schema operations use 106;
store, design, script-sort and web-client value-list lookups use 108; container writes use 111
for invalid repetitions; audit retention settings use 960. These are
**Meaning** mappings, not claims that each endpoint was run against FileMaker.

## SQL/OData codes observed in FileMaker

FileMaker itself returns 8309 and 8310 from ExecuteSQL/OData in practice, although
the [Claris error-code list](https://help.claris.com/en/pro-help/content/error-codes.html)
does not include them. The exact conditions are not established here; Tabularius's
existing SQL/OData refusal uses 8310 and remains compatible with its clients.

| Code | Meaning | Use |
|---|---|---|
| 8310 | SQL or OData request is invalid or not allowed | Read-only SQL refusal, inaccessible internal SQL tables, SQL parameter-count/query errors, and invalid OData expressions or schema requests. The specific message identifies the failure. |

## Application extensions

The 9000-9099 range is reserved here for Tabularius application signals. It is
outside the FileMaker codes in Claris's published list, the observed 8309/8310
SQL/OData codes, and the 5000-5499 custom Revert Transaction range. These
signals are included in the shared `errorMeaning` catalog.

| Code | Meaning | Use |
|---|---|---|
| 9000 | Passkey second factor is required | Password sign-in needs a passkey challenge at `sessions/passkey-2fa`; HTTP 401. Replaces the accidental use of calculation code 1212. The web client recognizes the shared constant. MCP has no passkey challenge endpoint. |

Claris code 1212 retains its calculation meaning. The existing authenticator
app signal 1211 remains a legacy, endpoint-specific exception listed above.

## Other codes steps return

The rows above are the failures compared with FileMaker one by one. These are
the remaining codes the script engine returns, each from the step or situation
named. `packages/scripts/test/docs-drift.test.ts` fails when the engine returns
a code that no row of this page mentions.

| Code | Meaning | Returned by |
|---|---|---|
| 1 | User canceled action | A dialog the person closes without choosing: Insert from Index, Insert Picture, Insert File, Insert from Device, Re-Login, Sort Records with the dialog. |
| 2 | Memory error | Open Data File when 100 data files are already open. |
| 5 | Command is invalid | A step missing a parameter it cannot run without (Set Web Viewer, the RAG steps' Space ID or data source, a negative repetition). |
| 9 | Insufficient privileges | A step the account's privilege set does not allow: printing, exporting a field's contents, Set Next Serial Value, Set Error Logging, Configure Persistent Data, Save a Copy as XML. |
| 20 | Canceled by a triggered script | A step whose script trigger ran before it and exited with False. |
| 100 | File is missing | A hosted file a step names is not hosted; a file in the documents folder cannot be read or its folder is missing; a table with no table occurrence. |
| 104 | Script is missing | Perform Script, Perform Script on Server, a callback script or a script trigger naming a script that is not there. |
| 200 | Record access is denied | Set Field of a global field in Find mode, when the account cannot edit the table. |
| 300 | File is locked or in use | Create, Open, Delete or Rename Data File on a file that is already open, or a file-writing step (Export Field Contents and the like) naming an open data file or a folder. |
| 715 | Excel worksheet or named range is missing | Import Records from a workbook without the sheet named. |
| 718 | XML parse error | Import Records of XML that does not parse, or an XSLT style sheet that does not. |
| 719 | XSL transform error | Import Records through an XSLT style sheet that fails. |
| 812 | Host capacity exceeded | The RAG steps' file and chunk limits; a Data API call whose JSON response cannot be assembled. |
| 829 | No PDF file is open to add to | Append PDF, or Save Records as PDF set to add to the open PDF, with no PDF open. |
| 830 | Invalid PDF file | Open PDF or Append PDF of a file that is missing, not a PDF, or cannot be joined to the open one. |
| 831 | Invalid PDF password | Open PDF of an encrypted file with no password. |
| 832 | PDF password doesn't allow changing pages | Open PDF of an encrypted file: encrypted PDFs cannot be opened here. |
| 833 | A PDF file is already open | Create PDF or Open PDF while one is already open. |
| 887 | Invalid RAG space action | Perform RAG Action (Add Data) with Tokens per Text Chunk outside 75 to 512. |
| 954 | Unsupported XML grammar | Import Records of XML that is not FMPXMLRESULT, or an export field name that cannot be an FMPDSORESULT element. |
| 1708 | Parameter value is invalid | Go to List of Records with a JSON list that does not parse. |

## Messages that say what to try

The Data API and the other endpoints that share its errors keep FileMaker's
wording first, because clients match on it, and add advice in brackets for the
bare ones: `Unable to open file (no hosted file has that name, or this account
may not open it; name the file in the address: the server lists no files unless it was started with --list-files-publicly)`, an
address or method the server doesn't have, an unknown script, a token that
timed out, a body that isn't JSON or is too big. The advice lives in `HINTS` in
`packages/store/src/error-codes.ts`; `packages/server/test/error-messages.test.ts`
fails when the server raises a code with no meaning, or one of the bare
messages without advice.
