# @tabularius/scripts

Runs FileMaker scripts on the Tabularius server, the way FileMaker Server runs
them: there is no user and no screen. Calculations go through
[`@tabularius/calc`](../calc); records come from [`@tabularius/store`](../store).

```ts
import { runScript } from '@tabularius/scripts';

const r = await runScript(store, 'Card - Add', { parameter: '{"title":"Hi"}', layout: 'Cards' });
r.result      // Exit Script result, as text
r.error       // Get ( LastError ) at the end (the Data API's scriptError)
r.foundCount  // found set of the current layout when the script ended
r.actions     // dialogs, Open URL, web viewer steps: for a client to show
```

## Where scripts run

- **Data API**: `GET /fmi/data/vLatest/databases/{db}/layouts/{layout}/script/{script}?script.param=…`
  returns `scriptResult` and `scriptError`. Record reads, creates, edits,
  deletes and finds accept `script`, `script.prerequest` and `script.presort`
  (each with `.param`) and return `scriptResult.prerequest` and so on, like
  FileMaker's Data API.
- **MCP**: `run_script` (database, script, parameter, layout, trace) runs a
  script; `get_script` shows its steps as text, as FileMaker's script
  workspace does.

Globals and `$$` variables last for the Data API session (and per database
for MCP), as they do for a FileMaker Server client.

## What a run does

For a step-by-step list of server script steps that error, do nothing or omit
options, see [Script step support](../../docs/script-steps-support.md).

- Each window keeps a layout, a mode and a found set per table occurrence.
  Edits are held until a commit, a layout or record change, or the end of the
  script, then written with auto-enter options applied (creation and
  modification values, serial numbers, constants, calculated values).
- Related fields read and write the first related record, or the active
  portal row after Go to Object or Go to Portal Row. Setting a related field
  creates the related record when the relationship allows creation, as in
  FileMaker. Finds and sorts take related fields; a sort uses the first
  related record.
- Error handling follows FileMaker: steps set `Get ( LastError )`, control
  steps leave it alone, and a calculation error in Set Field writes nothing.
  A commit that fails validation leaves the record open with its edits
  (`Get ( RecordOpenState )` is 2) until it is fixed or reverted; edits still
  uncommitted when the script ends are dropped.
- Transactions work as in FileMaker: Open Transaction, Commit Transaction and
  Revert Transaction (with its condition and a custom error code from 5000 to
  5499 and message) keep or undo every change in every file together. A step
  that fails on privileges (including error 9), a record lock or validation
  reverts the transaction and goes on after Commit Transaction, retaining the
  failure in Get ( LastError ), unless Set Revert Transaction on Error is off.
  A script that ends or halts inside one keeps
  none of it. Subscripts' Open and Commit Transaction give error 3. While a
  transaction is open, other clients' writes to the files it changed get 301
  (record in use), and they can read its changes before it commits. Unlike
  FileMaker, a revert also undoes Truncate Table and serial numbers.
- Windows: New Window copies the window (layout, found sets); Go to Related
  Record can match the whole found set and open its records in a new window,
  and with no related records it fails (101) before any window opens or
  layout changes; Select Window and Close Window find windows by name.
- Perform Script runs scripts in this file and in other hosted files;
  Perform Script on Server runs in a new session.
- The cursor's field is tracked as in FileMaker: Go to Field, Go to Object
  on a field, and Go to Next and Previous Field (Set Tab Order's order, else
  left to right and top to bottom, wrapping round; in a portal, from the last
  field of a row to the first field of the next row) set it, Set Field with no
  field writes to it, `Get ( ActiveFieldName )`, `( ActiveFieldTableName )`,
  `( ActiveFieldContents )` and `( ActiveRepetitionNumber )` report it, and
  leaving the record clears it.
- Steps that only affect a screen (window sizing, toolbars, zoom, scroll,
  refresh) do nothing, as on FileMaker Server. Show Custom Dialog chooses the
  first button and is returned in `actions`, with Open URL and web viewer
  steps.
- **Scripts never reach the outside world unless you allow it.** Insert from
  URL fails with error 3 unless the run has `network: true` (or a fetch
  function); the server turns that on only with `tabularius serve
  --allow-script-network`. Solutions call mail, SMS and payment services this
  way, so an imported file must not do it by accident. Send Mail is never sent,
  plug-in functions (SMTP, cURL) are not available, and external SQL sources
  are never connected. ExecuteSQL reads the hosted files, including
  FileMaker_Tables and FileMaker_Fields. When allowed, Insert from URL fetches over HTTP with the
  common cURL options.
- Import Records adds records from comma- or tab-separated files, with the
  step's field mapping, and leaves them as the found set. It reads only from
  the `documents` folder (the server uses `<folder>/Documents`, like FileMaker
  Server's Documents folder): the step's path is reduced to its file name, so a
  path from the developer's computer finds the file of that name there.
  Without the file it sets error 100. Importing from a FileMaker file reads a
  hosted file's table: the found set this run shows for that table occurrence,
  else every record.
- Insert File reads a file the step names from the same documents folder. When
  it asks a person to choose a file, the caller's `insertFile` option supplies
  one; without it the step sets error 3. The web client's buttons do: the
  script waits while the browser asks the person, and a cancel sets error 1.
- Truncate Table empties the base table the step names.
- The data file steps (Get File Exists, Get File Size, Create, Open, Write to,
  Read from, Close Data File, Get and Set Data File Position, Delete File,
  Rename File) work only in the documents folder. `Get ( DocumentsPath )` is
  `/Documents/`, and a path built on it keeps its subfolders. Any other path
  counts only by its file name. `Get ( TemporaryPath )` is a folder for the run
  that is removed when it ends, and files left open are closed then. As in
  FileMaker, up to 25 files can be open, text is UTF-16 unless the step says
  UTF-8, and reading past the end sets error 10. A file or folder link that
  leads outside `Documents` is refused; the error identifies the attempted
  path as a link.
- Tabularius Export Records writes the found set to the documents folder as
  CSV, tab-separated text, Merge, Excel (.xlsx), FMPXMLRESULT (.xml), or an
  HTML table (.html). The extension picks the format when the step does not
  name one. Excel dates, times, and timestamps use styled numeric cells.
  Excel exports refuse more than 1,048,576 rows, 16,384 columns, or 32,767
  characters in one cell before writing a file.
  CSV, tab-separated, and Merge exports prefix text with an apostrophe when
  it begins with `=`, `+`, `-`, `@`, a control character (including tab or
  carriage return), or those characters after leading whitespace. Numeric,
  date, time, and timestamp fields keep a leading minus sign. Importing the exported
  text into a text field keeps the added apostrophe. This rule is a
  Tabularius safety policy; matching Claris behavior is unverified.
- Save Records as PDF prints the current layout to a PDF in the documents
  folder: the found set, the current record or a blank record. Headers and
  footers repeat on each page, the body repeats per record, and sub-summaries
  print around each group when the found set is sorted by their break field.
  Objects are drawn at their layout positions with their theme, named and
  local styles and conditional formats: text, field values, merge fields,
  symbols, shapes, lines, portal rows, the front tab panel, and JPEG or PNG
  images from graphics and container fields. Hidden objects stay hidden. Text
  uses the standard PDF fonts (Helvetica, Times or Courier). Append sets error 3.
- Save a Copy as writes a copy of the file to the documents folder in
  Tabularius's own format (a `.fmp12` name becomes `.openhbam.sqlite`, ready to
  host). A clone keeps the design and accounts but no
  records; compacted and self-contained copies are plain copies. A name that
  is taken sets error 300.
- Copy, Cut and Paste with a target field or variable use a clipboard of the
  run's own (the server has no other). Copying a whole record sets error 3.
- Set Use System Formats does nothing: dates and numbers follow the file's
  formats on the server.
- Delete Account, Reset Account Password and Enable Account change the
  file's accounts. They need full access, or a script set to run with full
  access privileges (error 9 otherwise); an account that isn't there sets
  error 213 (FileMaker 14's "account does not exist"; Claris no longer lists it). A deactivated account can't sign in, use API tokens or match an
  identity provider's sign-in until it is activated again. "Expire password"
  is read but not enforced yet. Delete Account refuses the last full-access
  account.
- Re-Login signs the run in as another account of the file when the name and
  password are right; that account's privileges apply from the next step.
  Otherwise it sets error 212 and the account stays. It never shows a dialog.
- Set Next Serial Value sets the value the next new record of the field's
  table gets.
- Open Manage Database, Open Script Workspace, Open Manage Value Lists, Open
  Manage Data Sources and Open Manage Layouts ask the web client to open its
  Design screen at the matching tab once the script ends. Set Multi-User does
  nothing: a hosted file is always shared.
- Sort Records by Field sorts the found set by the field the step names
  (ascending or descending). Dial Phone asks the person's device to dial the
  number (a `tel:` link in the web client). Exit Application stops the script
  as Halt Script does. Print Setup does nothing on the server.
- Steps that are not implemented yet set error 3 and the script continues.
- A run stops after 1,000,000 steps or 60 seconds (`maxSteps`, `timeoutMs`),
  and yields to the server between batches of steps. The time limit also stops
  a single step whose calculation runs long (a While loop or custom function
  recursion). A formula nested deeper than the JavaScript stack allows fails
  its step with error 1200.

Pass `trace: true` to get each step's text, error code and the reason a step failed.

`testScripts(store)` runs every script of a file the way a person would start
it, to find the ones that stall or fail: on the layout of a button or trigger
that runs it, with that layout's records found and the first one current, and
with each global a relationship matches on (a "selected" ID) set to the first
related record's key. It gets the parameter that button or trigger passes,
worked out on that record; a script that only other scripts perform starts
where its caller does, with the caller's parameter. When a run stops for a
missing related record, the script runs again on the first record (of up to
500) that has one. Each script runs offline (no network, mail or
plug-ins), in an empty documents folder, and what it changes is undone
afterwards (`Store.trial`). `tabularius test-scripts <folder> [database]`
prints the results; it exits 1 when a script stalled or crashed. `--skip
NAME` (repeatable; `Upload*` matches by prefix) leaves scripts out of the
run. A skipped script can still be performed by another script, offline like
everything else.

`ScriptDebugger` runs a script under the debugger: it pauses at the first step
or at breakpoints, steps into, over and out of subscripts, halts, lists local
and global variables, and evaluates formulas where the script waits (the Data
Viewer). Time spent paused doesn't count toward `timeoutMs`. The server offers
it at `/tabularius/debug/v1` to full-access accounts, and the web client draws it
at `/app/debugger.html`. Like FileMaker Pro's, it can pause after any step
that sets an error (`pauseOnError`, with the step and error in
`previousError`), and Set Next Step (`setNextStep(index)`) moves the paused
script to another step of the same script without running the steps between.
Its watch list is the Data Viewer's, and while a script is paused the Data
Viewer window follows it: watches evaluate in the script's context and the
Current tab shows its record, local and global variables.
