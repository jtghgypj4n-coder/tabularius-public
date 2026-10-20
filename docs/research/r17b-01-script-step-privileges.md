# r17b-01: script step privilege audit

Scope: the cases in `packages/scripts/src/engine.ts` and their helpers that call
Store/owner methods, touch files, or invoke network capabilities. Comparisons
use the Store write/read APIs and the server's Data API, web-client, design,
script, and operator capability paths. No new privilege type is introduced.

## Truncate Table

No matching page was found by searching the local reference library.
[Claris Truncate Table](https://help.claris.com/en/pro-help/content/truncate-table.html)
requires Full Access, not just unconditional delete permission. The regression
was written and run before implementation: Reader returned `0`, expected `200`.

`Store.truncate` now takes `WriteOptions`, checks layout write access and the
owning file's Full Access privilege before locks or mutations, and retains the
account in its audit entry. The engine calls it through `via(info)` with
`this.write`. An empty table does not bypass the check. The existing all-record
lock check remains, and this operation still does not cascade related deletes.
Full-access script elevation works in the script's file; it does not grant
Full Access in another file.

## Findings and comparisons

| Step/path | Comparison and result |
| --- | --- |
| Truncate Table | Fixed the missing privilege context and Full Access check. Direct Store calls with privileges are covered as well as scripts. |
| Set Next Serial Value | Fixed direct `calc.setNextSerial`: changing entry options now requires Full Access in the owning file, like the design API. This is an implementation parity decision; the Claris step page describes changing the field definition but does not specify an explicit privilege rule. |
| Replace Field Contents | `setField` plus `commit` already checks layout, record and field writes, like `Store.update`. A denied replacement cannot reach the final serial-counter update. Tests cover ordinary and serial replacement and full-access elevation. |
| Relookup Field Contents | Writes already used `via(info).update` with `this.write`. Fixed the preceding match-field read to use the same layout/record/field privilege context instead of an unrestricted `get`. |
| Duplicate Record/Request | Fixed direct owner call to use `via(info).duplicate`, matching the normal Store duplicate path's layout check before delegating to an external owner. Tested a view-only external layout and a modifiable layout over the same table. |
| Import Records | Add/update/replace use `via(info).create/update` with write privileges; folder containers use `setContainer`. Matching filters record visibility and inaccessible match fields; hosted-file sources pass source privileges. No separate import privilege exists. Matches the normal import path's record/field enforcement. |
| Insert File, Insert Picture, Insert PDF, Insert Audio/Video | Final writes already used `setField`/`setContainer`. Added `checkContainerWrite` before reading/requesting bytes for record containers, matching the Data API upload preflight. Variable, global and Find-mode destinations retain their respective semantics. Each alias has a test. |
| Insert from Device | Device capability is supplied by the caller; result goes through `setField` or a session variable. No database bytes are read directly. |
| Export Records, Save Records as Excel/JSONL/Snapshot Link | Existing export gate, privileged field/record reads and masking agree with web-client export. No changes needed. Each export variant has a no-output denial test. |
| Export Field Contents | Kept owning-file export permission and added the current-file export gate, matching web-client export when a layout shows external data. Added record-view validation before reading container bytes, matching normal container retrieval. |
| Copy, Cut, Write to Data File | Fixed `sourceValue` container reads to validate the record before reading bytes or publishing a clipboard action. Field-level restrictions were already checked. Cut's later write denial alone was insufficient: its clipboard action had already exposed the value. Each affected step has a regression test. |
| Get ( RecordModificationCount ) used by step calculations | Fixed the unprivileged `get` to enforce layout/record visibility, matching normal record reads. Reads only metadata, without computing unrelated fields. |
| Save Records as PDF | Existing print privilege gate retained. Fixed direct container rendering to validate record access, matching ordinary privileged record reads. An inaccessible supplied record ID cannot produce a PDF. |
| Save a Copy as | Requires Full Access in `f.store`, the file actually backed up, before committing or writing. A raw SQLite copy exposes hidden records, fields and account data; FileMaker's export permission is insufficient for this output format. Cross-file, clone, data-file and mail probes cover denial and full-access success. |
| Perform Script / Perform Script on Server / callback variant / triggers | Script execution checks the destination script's access; external calls use destination account privileges. Server execution starts a fresh session using the account's privileges, not inherited caller elevation. Callback execution checks script access. Existing cross-file/server suites plus a new server-worker regression cover these paths. |
| Execute SQL | ODBC execution is unavailable (error 3); no SQL is dispatched even with Full Access. The separate `ExecuteSQL()` calculation and natural-language SQL path pass privileges to Store's SQL translator/executor. |
| Install Plug-In File | Existing operator-enabled installer plus script-file Full Access gate runs before package reading. Installer callback owns signature/trust validation, as in server installation. Test proves denial does not invoke installation and elevation can invoke it. Security-log writes intentionally record denied attempts. |
| Send Mail / Insert from URL / connection URLs | Operator-supplied mail/network capabilities, capture-only rules, outbound policy and connection authorization govern external access. Calculated input reads use script privileges; URL field outputs use normal field/container writes. Tests exercise operator-disabled mail, enabled mail, denied URL container writes, elevation and variable output without real network calls. |
| New/Delete Record, Delete All Records, Delete Portal Row, related creation | Writes use `via(info)`/Store create, update or delete with `this.write`; Store enforces record/field rules. Deleting a found set is distinct from Full Access-only table truncation. |
| Set Field/By Name, Insert calculated/text/current/last-visited/index values, Paste/Clear, Find/Replace, custom-dialog inputs | These route through field writes, container writes or pending record edits committed with the privileges of the script that made them. Index reads carry privileges. Session globals and Find requests are not persistent record mutations. |
| Open Record, Commit/Revert, transactions, undo/redo | Open Record checks editable access. Commit carries pending write privileges; rollback/revert/unlock changes transaction or session state rather than granting record access. Locks and transaction bookkeeping are deliberately direct owner calls. |
| Show/Find/Sort/related navigation, value-list/index access | Find/sort/index reads carry privileges; related candidates are intersected with viewable IDs. Follow-up fixes add the missing calculation ValueListItems context, list permissions, source checks on comparative/related-list reads, and privilege filtering of design metadata. See the function inventory below. |
| Execute FileMaker Data API | Passes `this.write` to the internal API executor, preserving the caller/elevated script privilege context. |
| Add/Delete/Enable Account, Reset Password | Existing script-file Full Access gates match account administration. Change Password checks the current account's own password-change permission; Re-Login authenticates and replaces the execution identity. |
| Configure Persistent Data, Set Error Logging, Save a Copy as XML | Existing Full Access gates precede persistent writes, log setup and design export. |
| AI/RAG/embedding/natural-language steps | Operator AI capability, per-file/account refusal callback and capture-only checks govern model access. Input field reads and result writes use script privileges; natural-language SQL carries privileges. Session AI configuration does not install credentials or alter server configuration. |

## Deliberately absent checks

- Data-file steps (Get File Exists/Size, Create/Open/Read/Write/Close Data File,
  Get/Set Data File Position, Delete/Rename File) and file plug-in callbacks
  do not require database create/edit/delete privileges. They operate in the
  configured Documents/temporary sandbox, not on database records. Field
  sources and destinations still require record/field access. In particular,
  Delete File is not governed by a table's delete privilege.
- Create/Open/Append/Close/Cancel PDF operate on session PDFs and sandboxed
  files without a print gate. Adding database records requires the existing
  Save Records as PDF print gate; container sources and destinations use field
  access. Existing PDF and sandbox suites cover these distinctions.
- Send Mail and Insert from URL do not require record-write or Full Access
  privileges merely to use an explicitly enabled operator capability. They
  can legitimately operate on constants or session variables. URL requests
  may therefore occur before a field destination rejects the result.
- Copy/Cut and Write to Data File do not acquire an export privilege gate:
  the existing product allows copying readable field values and writing
  session values. They must not bypass record/field visibility.
- Replace Field Contents' final serial-entry update has no independent design
  gate: it is reached only after successful privileged record replacements,
  corresponding to the documented “Update serial number in Entry Options”
  option in the replacement command. Standalone Set Next Serial Value has no
  such preceding record-write authorization.
- Save a Copy still produces a complete SQLite backup, or a no-records clone,
  but only with Full Access. File readers and mail attachments retain their
  normal behavior; an administrator who explicitly creates a raw backup in a
  script-readable Documents folder is authorizing disclosure of that file.
- Open URL, Dial Phone, web-viewer/JavaScript actions, timer setup and navigation
  emit client actions or change session state. Destination operations retain
  their own authorization checks; these are not direct database mutations.
  Unsupported Execute SQL/AppleScript/machine-learning-model operations fail
  without performing the requested external work. No-op UI/configuration
  cases perform no protected action.

Primary regression coverage is `packages/scripts/test/step-write-privileges.test.ts`
and the additional cases in `external-layout-viewonly.test.ts`. Existing
cross-file, server-script, container/masking, import, export/print, sandbox,
account, PDF, AI and outbound tests remain part of the requested suite.

## Security-review follow-up (2026-10-16)

The follow-up was performed on `7112d37a`, without committing or pushing. New
regressions live in `packages/scripts/test/calc-read-privileges.test.ts` and
`packages/scripts/test/step-write-privileges.test.ts`. Every production fix was
preceded by a failing regression. Existing protections and the undocumented
serial distinction have passing characterization probes, rather than invented
failures.

### Reproductions and fixes

- **ValueListItems:** a script returned `|HIDDEN-SECRET\rTOPSECRET` while its
  direct Secret read was empty. Unrestricted lists also disclosed a forbidden
  record, a forbidden related record and a custom list with access `none`.
  The engine now passes its effective privileges. Store checks the list's own
  permission before reading custom, field-based or external lists. External
  file privileges survive local full-access elevation. The calculation-field
  path now respects individual list overrides, including a permitted list
  when the default is `none`.
- **Metadata:** the shared design helper previously returned the same hidden
  fields, layouts, scripts, lists, tables, field comments and serial counters
  to Reader and Full Access. Both script and unstored-calculation callers now
  provide privileges; the helper scopes each result to its owning file.
  This follows [Claris design functions](https://help.claris.com/en/pro-help/content/design-functions.html),
  which documents that results depend on the active privilege set.
- **LookupNext:** the existing pass correctly hid inaccessible destination
  fields and records. It did not protect the source match field: with Key=7
  and Key access `none`, the Higher probe returned `higher-item`, revealing
  information about the key. The fallback now rejects hidden/masked source
  keys, and the engine validates source record access before loading the raw
  row. The inaccessible-source-record probe already denied access. Permitted
  lookup behavior and pending edits remain covered by `lookup-next.test.ts`.
- **Additional relationship/summary findings:** related ValueListItems and
  comparative `List(Items::Title)` likewise revealed a hidden source key;
  a summary field with access `none` returned `5`. Related-list traversal now
  carries privileges through each hop, including intermediate source records;
  comparative matching checks source records and keys; `summaryOver` checks
  the summary field itself. Destination record filtering and ordinary visible
  relationship behavior remain intact.

The expanded calculation/metadata/LookupNext probe run recorded **14 pass / 27
fail**, before implementation. The additional relationship/summary probes
recorded **0 pass / 3 fail**, after correcting a test setup's relationship ID.
The copy/serial selection recorded **3 pass / 4 fail** before the backup gate;
the serial characterization passed unchanged. These are deliberate red runs,
not final validation counts.

### Save a Copy decision

`rg` found no matching Save a Copy or serial-rule reference in the local
reference library. Read the live primary sources:

- [Save a Copy as](https://help.claris.com/en/pro-help/content/save-a-copy-as.html):
  complete copies, no-records clones and an option to create an email with the
  copy attached; unsupported for hosted files in Pro and on Server, Cloud and
  WebDirect. The step page itself does not state a Full Access requirement.
- [Editing other privileges](https://help.claris.com/en/pro-help/content/other-privileges.html):
  saving a copy of records is governed by Allow exporting.
- [Saving and copying files](https://help.claris.com/en/pro-help/content/saving-copying-files.html):
  describes copying the database, rather than an export of only visible fields.

**Chosen policy: require Full Access for Tabularius's raw SQLite output.** This is
an explicit format-specific restriction, not a claim that FileMaker requires
Full Access. SQLite bytes expose record data and account metadata without
FileMaker's access controls; a no-records clone still contains account data.
Blocking creation is safer than maintaining a blacklist across data-file,
attachment, plug-in and other file readers. It also preserves Claris's documented
backup/attachment workflow for an explicitly elevated script, instead of
prohibiting all database attachments. A limited-account export-authorized copy
requires such a trusted script here until a protected backup format exists.

The gate returns error 9 before a commit or file creation, and checks the script's
file even when another file's window is selected. Tests cover copy and clone,
both disclosure chains, and an elevated copy actually reaching the mail callback
with its bytes. The initial data-file exploit returned a 243461-character
Base64 string containing the raw database; the fixed run returns `9|0`.
Pre-existing or explicitly elevated backups placed in shared Documents are
still readable: this fix controls creation, not retroactive protection of files.

### Serial policy: unchanged as requested

Read [Set Next Serial Value](https://help.claris.com/en/pro-help/content/set-next-serial-value.html),
[Replace Field Contents](https://help.claris.com/en/pro-help/content/replace-field-contents.html),
and [Replacing the contents of a field](https://help.claris.com/en/pro-help/content/replacing-field-contents.html).
The first changes the field definition. The latter two document the option to
update the next serial after replacements. None states a privilege rule for
these serial-counter operations. The documented Full Access restriction on
the replacement dialog's **Perform auto-enter options for fields** toggle is a
different option and does not establish a rule for updating the serial counter.

Therefore no serial implementation changes were made: standalone Set Next
Serial Value requires Full Access; Replace Field Contents may update the next
serial after authorized replacements. The new editor probe gets error 9 for
standalone Set Next Serial Value, then replaces values with 100 and 101 and
advances the next value to 102. Existing denied-edit and elevation tests remain.

### Calculation and step read inventory

Line numbers below refer to the follow-up implementation. Scalar formatting,
math and container functions consume the values obtained through these read
callbacks and have no independent Store read. The earlier step table remains
the inventory for import, export, print, clipboard and write destinations.

| Function or step checked | File:line and result |
| --- | --- |
| Direct fields; GetField; Evaluate; GetRepetition | `packages/calc/src/functions.ts:139`, `:154`, `:191`; `packages/scripts/src/engine.ts:4719`, `:5089`, `:5140`. Use the privileged field callback; probes hide Secret. |
| GetFieldName | `packages/calc/src/functions.ts:164`. Resolves the supplied reference, without reading a record value. |
| ValueListItems | `packages/scripts/src/engine.ts:5020`; `packages/store/src/store.ts:5647`, `:5667`; `packages/store/src/calc.ts:1620`. Fixed privilege propagation, list access and related source reads. |
| ValueListIDs; ValueListNames | `packages/store/src/design-functions.ts:49`, `:48`. Filter by individual/default list access; no item values are read. |
| GetNthRecord | `packages/calc/src/functions.ts:218`; `packages/scripts/src/engine.ts:5197`. Related records use filtered related values. The current-table implementation only falls back to the current value for n=1; later rows return empty, not raw records. This existing functional limitation is unchanged. |
| List | `packages/calc/src/functions.ts:448`; `packages/scripts/src/engine.ts:5197`. Reads only visible related values. |
| Last | `packages/calc/src/functions.ts:214`; same privileged related callback. |
| Lookup; Extend | `packages/calc/src/functions.ts:199`; the ordinary field callback, with an optional calculated fallback. |
| LookupNext | `packages/scripts/src/engine.ts:5128`; `packages/store/src/calc.ts:1505`. Target protections retained; source checks added. |
| Sum; Average; Variance; VarianceP; StDev; StDevP | `packages/calc/src/functions.ts:598`, `:599`, `:607`, `:608`, `:609`, `:613`; `packages/scripts/src/engine.ts:5197`. Aggregate the callback's privileged values. |
| Count; Min; Max | `packages/calc/src/functions.ts:617`, `:624`; same privileged related values. |
| Summary fields; GetSummary | `packages/scripts/src/engine.ts:5156`, `:5179`; `packages/calc/src/functions.ts:225`. Fixed access to the summary field itself; component reads already used privileges. |
| ExecuteSQL; ExecuteSQLe calculations | `packages/scripts/src/engine.ts:4732`; `packages/store/src/calc.ts:1642`, `:1725`. Effective privileges reach SQL translation/scoped tables; hidden fields and rows stay excluded in script probes. |
| Execute SQL step | `packages/scripts/src/engine.ts:3775`. Unsupported ODBC execution; error 3, no dispatched query. |
| Get(ActiveFieldContents) | `packages/scripts/src/engine.ts:4856`. Uses readField. |
| Get(TotalRecordCount) | `packages/scripts/src/engine.ts:4867`. findIds receives this.reading. |
| Get(FoundCount); Get(RecordID); Get(RecordNumber); Get(ActiveRecordNumber) | `packages/scripts/src/engine.ts:4848`, `:4866`, `:4850`. Use the current found set, initialized by privileged findIds at `:1804`/`:2108`; do not read a raw record. |
| Get(RecordModificationCount) | `packages/scripts/src/engine.ts:4992`. Privileged get with fields=[]; existing inaccessible-record regression retained. |
| Get(RecordAccess) | `packages/scripts/src/engine.ts:4949`. checkEditable/canViewRecord use the effective owning-file privileges. |
| GetRecordIDsFromFoundSet | `packages/scripts/src/engine.ts:5014`. Same session found set, tested alongside filtered counts. |
| Other Get options | `packages/scripts/src/engine.ts:4819`. Session/window/account/schema/filesystem metadata; no other raw database-record reads. |
| FieldNames; FieldIDs | `packages/store/src/design-functions.ts:52`, `:163`. Filter layout access and fields in the owning local/external table. |
| FieldType; FieldComment | `packages/store/src/design-functions.ts:60`, `:64`, `:150`. Resolve only visible fields. |
| FieldStyle; FieldRepetitions; FieldBounds | `packages/store/src/design-functions.ts:84`. Use filtered placed fields; FieldStyle omits the name of an inaccessible list. |
| LayoutNames; LayoutIDs | `packages/store/src/design-functions.ts:40`, `:41`. Filter layout access. |
| LayoutObjectNames | `packages/store/src/design-functions.ts:97`. Inaccessible layouts produce no named objects. |
| ScriptNames; ScriptIDs | `packages/store/src/design-functions.ts:42`, `:43`. Filter script access. |
| TableNames; TableIDs | `packages/store/src/design-functions.ts:44`, `:45`. Filter table visibility in each occurrence's owning file. |
| BaseTableNames; BaseTableIDs | `packages/store/src/design-functions.ts:46`, `:47`. Filter local table visibility. |
| GetBaseTableName | `packages/store/src/design-functions.ts:74`. Requires a visible field reference. |
| GetNextSerialValue | `packages/store/src/design-functions.ts:69`. Cannot disclose the counter of a hidden field. |
| RelationInfo | `packages/store/src/design-functions.ts:101`, `:217`. Omits relationships with inaccessible tables or match fields. |
| GetTableDDL | `packages/scripts/src/engine.ts:5008`. Existing schemaVisibility filter retained. |
| GetFieldsOnLayout | `packages/scripts/src/engine.ts:5009`; `packages/store/src/calc.ts:194`. Existing layout/field privilege filtering retained. |
| DatabaseNames; WindowNames | `packages/scripts/src/engine.ts:5027`. Only files/windows already open in this script session. |
| GetLayoutObjectAttribute; ScriptStepNames | `packages/calc/src/functions.ts:1143`; `packages/scripts/src/engine.ts:5000`. No server implementation; empty result, no value read. |
| GetPersistentData; ListPersistentDataIDs | `packages/scripts/src/engine.ts:4736`; `packages/calc/src/functions.ts:1122`. Named application/session storage, not record queries; configuration is separately Full Access gated. |
| Direct related reads; related List/GetNthRecord/aggregates; Go to Related Record | `packages/scripts/src/engine.ts:5197`, `:5207`. Destination IDs are filtered at each hop; equality keys use privileged record reads, comparative keys now carry privileges to `packages/store/src/related.ts:116`. Cartesian joins obtain target IDs with this.reading. |
| Related value-list traversal | `packages/store/src/store.ts:5667`; `packages/store/src/related.ts:165`. Validates the source, preserves per-hop privileges and excludes forbidden intermediate sources. |
| Sort by value list | `packages/scripts/src/engine.ts:2974`. Already passes effective privileges; now also gets Store's individual-list gate. |
| Insert from Index | `packages/scripts/src/engine.ts:3511`; `packages/store/src/store.ts:5596`. Already passes privileges; index excludes hidden fields and records. |
| Insert from Last Visited | `packages/scripts/src/engine.ts:3477`. Calls valueOf with the previously visited ID, retaining record/field checks. |
| Relookup Field Contents | `packages/scripts/src/engine.ts:5860`. Source get and destination updates carry privileges. |
| Copy; Cut; Write to Data File; Export Field Contents; PDF container reads | `packages/scripts/src/engine.ts:6581`, `:5733`, `:7229`. Existing record/field checks precede direct container reads; retained regressions. |
| Save a Copy as | `packages/scripts/src/engine.ts:7240`. New owning-file Full Access gate before commit/backup. |
| Read from Data File; Send Mail attachments | `packages/scripts/src/engine.ts:6659`, `:8034`. Ordinary sandboxed file readers; copy-creation denial blocks both tested disclosure chains. |
| Set Next Serial Value; Replace Field Contents serial update | `packages/scripts/src/engine.ts:3538`, `:5852`. Documented uncertainty and unchanged policy described above. |

## Follow-up validation

- Node v22.22.2; no dependencies added.
- `npm run typecheck`: passed.
- The first requested-suite run returned **881 pass / 2 fail / 127 skipped**.
  Both failures were MCP copy/clone success controls that still ran as Clerk.
  `packages/server/test/access-denial-import.test.ts:220` now gives those
  controls Full Access, as it already did for XML exports, while retaining
  isolation checks. The targeted copy/XML isolation selection then passed
  **6 / 6** with no failures.
- The checkout has no `fixtures` path; fixture-dependent tests skip. No fixture
  download or symlink change was made.
- Final requested command:
  `node --test --test-concurrency=2 packages/scripts/test/*.test.ts packages/store/test/least-privilege.test.ts packages/server/test/access-denial*.test.ts`:
  **883 pass / 0 fail / 127 skipped** (1010 tests; no cancellations).
  All new security probes use synthetic stores and ran without fixtures.
- Final typecheck and `git diff --check` passed. Local HTTP test servers were
  allowed to bind localhost; test concurrency remained 2.

## Original validation (before this security-review follow-up)

- Node v22.22.2; `npm run typecheck`: passed.
- `node --test --test-concurrency=4 packages/scripts/test/*.test.ts packages/server/test/access-denial*.test.ts packages/server/test/privilege*.test.ts`:
  **958 pass, 0 fail, 0 skipped** (final implementation).
- The first sandboxed run had 924 pass / 33 fail; every failure was a
  `listen EPERM` test-server setup failure on `127.0.0.1`. The final run used
  permission to bind localhost listeners and retained concurrency 4.
- The new regression file independently passed 32 tests. The external-layout
  file adds two more regressions. Typecheck and whitespace checks passed.
